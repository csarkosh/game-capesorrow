// What the production client build bakes in, as data: the base it is served under, the address of
// the site (invites are built on it), the commit it is of and, once the game has a server, the
// address of its signaling. Pure: `preconditions.mjs` reads the files and git, this decides.

/** Vite's `base` for a site URL: its path with a trailing slash (`https://games.csarko.sh/capesorrow` is `/capesorrow/`). */
export function baseOf(siteUrl) {
  return `${new URL(siteUrl).pathname.replace(/\/+$/, '')}/`;
}

/** The path the game owns on the shared site, without a trailing slash (`/capesorrow`). */
export function sitePathOf(siteUrl) {
  return new URL(siteUrl).pathname.replace(/\/+$/, '');
}

/**
 * The commit a build is of, as a tag: the short sha, with `-dirty` where the tree has uncommitted
 * changes, so an untested local change is never mistaken for a committed one.
 */
export function buildTagOf(sha, dirty) {
  return dirty ? `${sha}-dirty` : sha;
}

/**
 * The client's WebSocket address for the signaling service Cloud Run reports as https: the
 * WebSocket scheme and the path the server binds.
 */
export function signalingWsUrl(signalingUrl) {
  return `${signalingUrl.replace(/\/+$/, '').replace(/^https:/, 'wss:')}/ws`;
}

/**
 * Every value the bundle bakes in. There is no signaling address until `production.json` has a
 * `signaling_url` (the game has no server deployed): then none is passed, the build cannot play,
 * and its title page says it is in development (`client/src/game/landingModel.ts`).
 *
 * @param {{ site_url: string, signaling_url?: string }} production
 * @param {string} tag the build tag (`buildTagOf`)
 * @returns {Record<string, string>}
 */
export function productionEnv(production, tag) {
  /** @type {Record<string, string>} */
  const env = {
    CAPESORROW_BASE: baseOf(production.site_url),
    VITE_WEB_BASE: production.site_url,
    VITE_BUILD_SHA: tag,
  };
  if (production.signaling_url) env.VITE_SIGNALING_URL = signalingWsUrl(production.signaling_url);
  return env;
}
