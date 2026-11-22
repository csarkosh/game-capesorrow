#!/usr/bin/env node
// Prove the deploy is serving what it should, from outside.
//
// Everything here is checked against the live site over the network, with no reference to what
// the deploy script believed it did. A deploy that exits 0 is not evidence; this is. Each check
// prints a ✓ or a ✗ line, and any ✗ makes the exit non-zero. A total outage is still a list of ✗
// lines, not a stack trace.
//
// Usage: npm run deploy:verify [-- --base <url>] [-- --sha <build tag>]
//   --base <url>   check another address of this game (a preview channel's) instead of site_url
//   --sha <tag>    the build tag the bundle must name (default: any commit's, not "dirty" on production)

import { baseOf } from './lib/buildEnv.mjs';
import { production } from './lib/preconditions.mjs';
import { reach } from './lib/reach.mjs';
import {
  checkedBase, contentTypeFits, DAYHIKE_PAGE, DAYHIKE_TITLE, entryScript, findBuildTags, GAMES_INDEX, isBuildTag, isImmutable,
  isNoCache, locationOf, modulePreloads, pageTitle, parseVerifyArgs, referencedUrls, SITE_ROOT, TITLE, VERIFY_USAGE,
} from './lib/verifyChecks.mjs';

const args = parseVerifyArgs(process.argv.slice(2));
if ('error' in args) {
  console.error(`\n✗ ${args.error}. ${VERIFY_USAGE}\n`);
  process.exit(1);
}

const prod = production();
const siteUrl = checkedBase(prod.site_url, args.base);
const basePath = args.base === null ? baseOf(prod.site_url) : `${new URL(siteUrl).pathname.replace(/\/+$/, '')}/`;

const failures = [];
function check(ok, what, detail) {
  if (ok) {
    console.log(`  ✓ ${what}`);
  } else {
    console.log(`  ✗ ${what} — ${detail}`);
    failures.push(what);
  }
}
const type = (res) => res.headers.get('content-type');
const isHtml = (res) => /^text\/html\b/i.test(type(res) ?? '');

async function verify() {
  console.log(`\nVerifying ${siteUrl}/\n`);

  // 1. The page loads: 200, HTML, this game's title, and not cached without asking.
  const pageUrl = `${siteUrl}/`;
  const page = await reach(pageUrl);
  check(page.status === 200, `${pageUrl} answers 200`, `got ${page.status}`);
  const html = page.status === 200 ? await page.text() : '';
  check(isHtml(page), 'the page is HTML', `content-type: ${type(page)}`);
  check(pageTitle(html) === TITLE, `the page's title is ${TITLE}`, `title was ${JSON.stringify(pageTitle(html))}`);
  check(isNoCache(page.headers.get('cache-control')), 'the page is not cached', `cache-control: ${page.headers.get('cache-control')}`);

  // 2. Every file the page names under its base answers 200 with a type that fits it; the entry
  // script is JavaScript, not the page again.
  const entry = entryScript(html, pageUrl);
  check(entry !== null, 'the page names an entry script', 'no <script type="module" src> found: did the build succeed?');
  const named = referencedUrls(html, pageUrl, basePath);
  check(named.length > 0, 'the page names files under its base', `none found under ${basePath}`);
  const answers = await Promise.all(named.map(async (url) => [url, await reach(url, { method: 'HEAD' })]));
  const bad = answers.filter(([url, res]) => res.status !== 200 || !contentTypeFits(url, type(res)));
  check(
    bad.length === 0,
    `all ${named.length} files the page names answer 200 with a fitting content type`,
    bad.slice(0, 5).map(([url, res]) => `${url} → ${res.status} ${type(res)}`).join('; ') + (bad.length > 5 ? ` and ${bad.length - 5} more` : ''),
  );

  // 3. The entry script is JavaScript, and cached for good under assets/ (its name carries a hash).
  let entrySource = '';
  if (entry !== null) {
    const script = await reach(entry);
    check(script.status === 200 && /javascript/i.test(type(script) ?? ''), `the entry script is JavaScript`, `${entry} → ${script.status} ${type(script)}`);
    entrySource = script.status === 200 ? await script.text() : '';
    check(new URL(entry).pathname.startsWith(`${basePath}assets/`), 'the entry script is under assets/', `${entry}`);
    check(isImmutable(script.headers.get('cache-control')), 'a hashed file under assets/ is cached as immutable', `${entry}: cache-control ${script.headers.get('cache-control')}`);
  }

  // 4. A deep address under the base answers the same page (the rewrite), where the router reads it.
  const deepUrl = `${siteUrl}/settings`;
  const deep = await reach(deepUrl);
  const deepHtml = deep.status === 200 ? await deep.text() : '';
  check(deep.status === 200 && isHtml(deep) && deepHtml === html && html !== '', `${deepUrl} answers the same page`, `status ${deep.status}, ${isHtml(deep) ? 'the body differs' : `content-type ${type(deep)}`}`);

  // 5. The bundle names the build: the tag `VITE_BUILD_SHA` carries is in the entry chunk or one it
  // imports statically (the page's modulepreloads).
  if (entry !== null && entrySource !== '') {
    let tags = findBuildTags(entrySource);
    for (const chunk of tags.length > 0 ? [] : modulePreloads(html, pageUrl)) {
      const res = await reach(chunk);
      if (res.status === 200) tags = findBuildTags(await res.text());
      if (tags.length > 0) break;
    }
    const tag = tags[0];
    check(tag !== undefined, 'the bundle names its build', 'no VITE_BUILD_SHA in the entry chunk or the chunks it imports: was it built by `npm run deploy:client`?');
    if (tag !== undefined) {
      if (args.sha !== null) check(tag === args.sha, `the bundle names the build ${args.sha}`, `it names ${tag}`);
      else check(isBuildTag(tag), `the bundle names a commit's build (${tag})`, `${JSON.stringify(tag)} is not a commit's short sha`);
      // Production is built from a commit; a preview channel (--base) may be a dirty tree's.
      if (args.base === null) check(!tag.endsWith('-dirty'), 'the build is of a clean tree', `${tag} was built from uncommitted changes`);
    }
  } else if (entry !== null) {
    check(false, 'the bundle names its build', 'the entry script could not be read');
  }

  // 6. Day Hike is untouched: its page still answers as itself, and the shared site's root still
  // redirects to the list of games.
  const dayhike = await reach(DAYHIKE_PAGE);
  const dayhikeHtml = dayhike.status === 200 ? await dayhike.text() : '';
  check(dayhike.status === 200 && isHtml(dayhike) && pageTitle(dayhikeHtml) === DAYHIKE_TITLE, `${DAYHIKE_PAGE} still answers as ${DAYHIKE_TITLE}`, `status ${dayhike.status}, title ${JSON.stringify(pageTitle(dayhikeHtml))}`);
  const root = await reach(SITE_ROOT, { redirect: 'manual' });
  check(root.status === 301 && locationOf(root.headers, SITE_ROOT) === GAMES_INDEX, `${SITE_ROOT} still redirects (301) to ${GAMES_INDEX}`, `status ${root.status}, location ${root.headers.get('location')}`);
}

try {
  await verify();
} catch (err) {
  console.log(`  ✗ verification aborted — ${err instanceof Error ? err.message : String(err)}`);
  failures.push('aborted');
}

if (failures.length > 0) {
  console.error(`\n✗ ${failures.length} check(s) failed\n`);
  process.exit(1);
}
console.log('\n✓ deploy verified\n');
