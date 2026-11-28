// The engine's shared-site deploy tool, and how this game calls it. Pure: the argument list and the
// rules of when a deploy may go are data here, and `tools/deploy/client.mjs` runs them.
//
// The shared site (`games.csarko.sh`) holds more than one game. The engine's tool merges this
// game's files and rules into the live site under its own path, leaves every other game's alone,
// and refuses to release if any other game's file would change.

/** The tool's place in the installed engine package, from the repository root. */
export const SITE_TOOL = 'node_modules/@csarkosh/engine/tools/site/deploy.mjs';

/** The engine release that has the tool, for the sentence that says what to do where it is missing. */
export const SITE_TOOL_RELEASE = 'v0.2.3';

/** What the deploy says where the tool is not in the installed engine. */
export const SITE_TOOL_MISSING = `${SITE_TOOL} is not in the installed engine: it is in engine release ${SITE_TOOL_RELEASE} or later. Move client/package.json to that release's tarball, run \`npm install\`, and deploy again.`;

/** Where this game's built files are and where its hosting rules are, from the repository root. */
export const CLIENT_DIST = 'client/dist';
export const SITE_RULES = 'tools/deploy/site.rules.json';

/**
 * Why a deploy must not go ahead as asked, or null. A dirty tree is refused for production: a build
 * is tagged with its commit, and a dirty one names no commit. A preview channel or a dry run
 * releases nothing to production, so it may be dirty.
 */
export function deployRefusal({ dirty, channel, dryRun }) {
  if (dirty && channel === null && !dryRun) {
    return 'the working tree is not clean. Commit first (the build is tagged with the commit), or deploy to a preview channel with `--channel <name>`, or check the plan with `--dry-run`.';
  }
  return null;
}

/**
 * The arguments of the engine's tool, in the order its interface names them.
 *
 * @param {{ project: string, site: string, path: string, tag: string, channel: string | null, dryRun: boolean }} what
 * @returns {string[]}
 */
export function siteDeployArgs({ project, site, path, tag, channel, dryRun }) {
  const args = ['--project', project, '--site', site, '--path', path, '--dir', CLIENT_DIST, '--rules', SITE_RULES];
  if (channel !== null) args.push('--channel', channel);
  if (dryRun) args.push('--dry-run');
  args.push('--message', `portashton ${tag}`);
  return args;
}

/**
 * The production file as the deploy needs it, or the sentence saying what is wrong with it.
 *
 * @param {unknown} value the parsed file
 * @returns {{ ok: true, production: { gcp_project_id: string, hosting_site_id: string, site_url: string, signaling_url?: string } } | { ok: false, error: string }}
 */
export function checkProduction(value) {
  if (value === null || typeof value !== 'object') return { ok: false, error: 'is not a JSON object' };
  const p = /** @type {Record<string, unknown>} */ (value);
  for (const key of ['gcp_project_id', 'hosting_site_id', 'site_url']) {
    if (typeof p[key] !== 'string' || p[key] === '') return { ok: false, error: `has no \`${key}\`` };
  }
  let url;
  try {
    url = new URL(/** @type {string} */ (p.site_url));
  } catch {
    return { ok: false, error: '`site_url` is not an address' };
  }
  if (url.protocol !== 'https:' || url.pathname.replace(/\/+$/, '') === '') {
    return { ok: false, error: '`site_url` must be an https address with the game\'s path (https://games.csarko.sh/portashton)' };
  }
  if (p.signaling_url !== undefined && (typeof p.signaling_url !== 'string' || !/^https:\/\//.test(p.signaling_url))) {
    return { ok: false, error: '`signaling_url` must be an https address' };
  }
  return { ok: true, production: /** @type {never} */ (p) };
}
