// The parts of `npm run deploy:verify` that are decisions about text and headers, as pure
// functions, so a test holds each without a network. `verify.mjs` fetches and prints.

/** Day Hike's page and the shared site's root, which a deploy of this game must leave as they are. */
export const DAYHIKE_PAGE = 'https://games.csarko.sh/dayhike/';
export const DAYHIKE_TITLE = 'Day Hike';
export const SITE_ROOT = 'https://games.csarko.sh/';
export const GAMES_INDEX = 'https://csarko.sh/games';

/** The title this game's page carries. */
export const TITLE = 'Something Haunts Port Ashton';

export const VERIFY_USAGE = 'Usage: npm run deploy:verify [-- --base <url>] [-- --sha <build tag>]';

/**
 * `{ base, sha }` from the arguments after the script's name (each null where not given), or
 * `{ error }`. `--base` checks another address of this game (a preview channel); `--sha` is the
 * build tag the bundle must name.
 *
 * @param {readonly string[]} argv
 * @returns {{ base: string | null, sha: string | null } | { error: string }}
 */
export function parseVerifyArgs(argv) {
  /** @type {{ base: string | null, sha: string | null }} */
  const out = { base: null, sha: null };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const key = arg === '--base' ? 'base' : arg === '--sha' ? 'sha' : null;
    if (key === null) return { error: `unknown argument ${JSON.stringify(arg)}` };
    const value = argv[i + 1];
    if (value === undefined || value.startsWith('--')) return { error: `${arg} needs a value` };
    out[key] = value;
    i++;
  }
  if (out.base !== null) {
    try {
      const url = new URL(out.base);
      if (url.protocol !== 'https:' && url.protocol !== 'http:') return { error: '--base must be an http(s) address' };
    } catch {
      return { error: '--base is not an address' };
    }
  }
  return out;
}

/** The address to check, without a trailing slash: `--base` where given, else the site URL. */
export function checkedBase(siteUrl, base) {
  return (base ?? siteUrl).replace(/\/+$/, '');
}

/** The text of the page's `<title>`, or null. */
export function pageTitle(html) {
  const found = /<title>([^<]*)<\/title>/i.exec(html);
  return found ? /** @type {string} */ (found[1]).trim() : null;
}

/** Every attribute `name` of the tags named, in document order, unquoted. */
function attributes(html, tagNames, name) {
  const found = [];
  for (const tag of html.matchAll(new RegExp(`<(?:${tagNames})\\b[^>]*>`, 'gi'))) {
    const value = new RegExp(`\\s${name}\\s*=\\s*"([^"]*)"`, 'i').exec(tag[0]);
    if (value) found.push(/** @type {string} */ (value[1]));
  }
  return found;
}

/**
 * Every address the page names with a `src` or an `href` (scripts, stylesheets, icons, preloads),
 * resolved against the page and kept where it is on the page's own origin and under `basePath`:
 * the files this game's deploy is answerable for. In order, each once.
 *
 * @param {string} html
 * @param {string} pageUrl the address the page was fetched from, ending in `/`
 * @param {string} basePath the game's path on the site, with a trailing slash (`/portashton/`)
 */
export function referencedUrls(html, pageUrl, basePath) {
  const page = new URL(pageUrl);
  const seen = new Set();
  for (const ref of [...attributes(html, 'script|img|source|audio|video', 'src'), ...attributes(html, 'link|a', 'href')]) {
    let url;
    try {
      url = new URL(ref, page);
    } catch {
      continue;
    }
    url.hash = '';
    if (url.origin === page.origin && url.pathname.startsWith(basePath)) seen.add(url.href);
  }
  return [...seen];
}

/**
 * The `.mp4` addresses the page's html names, in order. The title film is fetched by the script
 * after `load`, never by the html, so a page that names one (a `<video src>`, a preload) would fetch
 * it before Play for everyone, save-data and reduced motion included.
 */
export function mp4Named(html) {
  return [...html.matchAll(/[^\s"'<>=()]*\.mp4\b[^\s"'<>)]*/gi)].map((m) => m[0]);
}

/** The entry script: the first `<script type="module" src>`, as an address, or null. */
export function entryScript(html, pageUrl) {
  for (const tag of html.matchAll(/<script\b[^>]*>/gi)) {
    if (!/\stype\s*=\s*"module"/i.test(tag[0])) continue;
    const src = /\ssrc\s*=\s*"([^"]*)"/i.exec(tag[0]);
    if (src) return new URL(/** @type {string} */ (src[1]), pageUrl).href;
  }
  return null;
}

/** The modules the page preloads: the entry's static imports, as addresses. */
export function modulePreloads(html, pageUrl) {
  const found = [];
  for (const tag of html.matchAll(/<link\b[^>]*>/gi)) {
    if (!/\srel\s*=\s*"modulepreload"/i.test(tag[0])) continue;
    const href = /\shref\s*=\s*"([^"]*)"/i.exec(tag[0]);
    if (href) found.push(new URL(/** @type {string} */ (href[1]), pageUrl).href);
  }
  return found;
}

/** The content types a file name's extension answers with, where the extension says. */
const TYPES = [
  [/\.m?js$/, /^(?:text|application)\/(?:x-)?javascript\b/],
  [/\.css$/, /^text\/css\b/],
  [/\.svg$/, /^image\/svg\+xml\b/],
  [/\.json$/, /^application\/json\b/],
  [/\.wasm$/, /^application\/wasm\b/],
  [/\.png$/, /^image\/png\b/],
  [/\.webp$/, /^image\/webp\b/],
  [/\.ico$/, /^image\/(?:x-icon|vnd\.microsoft\.icon)\b/],
  [/\.mp3$/, /^audio\/(?:mpeg|mp3)\b/],
  [/\.glb$/, /^(?:model\/gltf-binary|application\/octet-stream)\b/],
];

/**
 * Whether a file's content type fits its address. Where the extension is known the type must be
 * its own; for any other file it must at least not be HTML, which is what the site's catch-all
 * rewrite answers for a file that is not there, with a 200.
 */
export function contentTypeFits(url, contentType) {
  if (contentType === null || contentType === undefined || contentType === '') return false;
  const path = new URL(url).pathname;
  const known = TYPES.find(([ext]) => ext.test(path));
  if (known) return known[1].test(contentType.toLowerCase());
  return !/^text\/html\b/i.test(contentType);
}

/** Whether a Cache-Control header makes a file immutable for good. */
export function isImmutable(cacheControl) {
  return /\bimmutable\b/i.test(cacheControl ?? '') && /\bmax-age=\d{6,}\b/i.test(cacheControl ?? '');
}

/** Whether a Cache-Control header keeps a page from being kept without asking. */
export function isNoCache(cacheControl) {
  return /\bno-cache\b|\bno-store\b/i.test(cacheControl ?? '');
}

/**
 * The build tags a bundle's source names: Vite writes `import.meta.env` into a chunk as an object
 * that carries `VITE_BUILD_SHA` where the build was given one.
 */
export function findBuildTags(source) {
  return [...source.matchAll(/VITE_BUILD_SHA\s*:\s*[`"']([^`"']*)[`"']/g)].map((m) => /** @type {string} */ (m[1]));
}

/** Whether a tag is a commit's short sha, with `-dirty` where its tree was. */
export function isBuildTag(tag) {
  return /^[0-9a-f]{7,40}(?:-dirty)?$/.test(tag);
}

/** What a `Location` header says, or null: a redirect's target as an absolute address. */
export function locationOf(headers, from) {
  const value = headers.get('location');
  return value === null ? null : new URL(value, from).href;
}
