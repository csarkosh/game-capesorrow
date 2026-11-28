import { describe, it, expect } from 'vitest';
import {
  checkedBase, contentTypeFits, entryScript, findBuildTags, isBuildTag, isImmutable, isNoCache, locationOf, modulePreloads, mp4Named, pageTitle,
  parseVerifyArgs, referencedUrls,
} from '../lib/verifyChecks.mjs';

const PAGE = 'https://games.csarko.sh/portashton/';
const BASE = '/portashton/';
// The shape Vite writes for this game's page under its base.
const HTML = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>Something Haunts Port Ashton</title>
    <meta name="description" content="A detective, a stretch of the Washington coast, and reports nobody believed." />
    <link rel="icon" href="/portashton/favicon.svg" type="image/svg+xml" />
    <script>(function () { var s = 'src="/not/a/tag.js"'; })();</script>
    <script type="module" crossorigin src="/portashton/assets/index-DYFmS29j.js"></script>
    <link rel="modulepreload" crossorigin href="/portashton/assets/engine-CikSKhBB.js">
    <link rel="modulepreload" crossorigin href="/portashton/assets/scene-D4epPTlq.js">
    <link rel="stylesheet" href="https://fonts.example.invalid/x.css">
    <link rel="preload" href="/dayhike/assets/other.js">
  </head>
  <body><div id="app"></div></body>
</html>`;

describe('parseVerifyArgs', () => {
  it('takes no arguments, a base and a sha', () => {
    expect(parseVerifyArgs([])).toEqual({ base: null, sha: null });
    expect(parseVerifyArgs(['--base', 'https://chan.example.invalid/portashton'])).toEqual({ base: 'https://chan.example.invalid/portashton', sha: null });
    expect(parseVerifyArgs(['--sha', 'abc1234', '--base', 'http://localhost:4173/portashton/'])).toEqual({ base: 'http://localhost:4173/portashton/', sha: 'abc1234' });
  });
  it('refuses an unknown option, a missing value and a base that is not an address', () => {
    expect(parseVerifyArgs(['--url', 'x'])).toEqual({ error: 'unknown argument "--url"' });
    expect(parseVerifyArgs(['--base'])).toEqual({ error: '--base needs a value' });
    expect(parseVerifyArgs(['--sha', '--base', 'x'])).toEqual({ error: '--sha needs a value' });
    expect(parseVerifyArgs(['--base', 'nope'])).toEqual({ error: '--base is not an address' });
    expect(parseVerifyArgs(['--base', 'ftp://x/y'])).toEqual({ error: '--base must be an http(s) address' });
  });
  it('checks the site URL, or the base without its trailing slash', () => {
    expect(checkedBase('https://games.csarko.sh/portashton', null)).toBe('https://games.csarko.sh/portashton');
    expect(checkedBase('https://games.csarko.sh/portashton', 'https://c.example.invalid/portashton/')).toBe('https://c.example.invalid/portashton');
  });
});

describe('reading the page', () => {
  it('finds the title', () => {
    expect(pageTitle(HTML)).toBe('Something Haunts Port Ashton');
    expect(pageTitle('<html></html>')).toBe(null);
  });

  it("lists what the page names under its base, once each, in order, and no script's text, other origin or other game's path", () => {
    expect(referencedUrls(HTML, PAGE, BASE)).toEqual([
      'https://games.csarko.sh/portashton/assets/index-DYFmS29j.js',
      'https://games.csarko.sh/portashton/favicon.svg',
      'https://games.csarko.sh/portashton/assets/engine-CikSKhBB.js',
      'https://games.csarko.sh/portashton/assets/scene-D4epPTlq.js',
    ]);
    expect(referencedUrls('<link rel="icon" href="favicon.svg"><link rel="icon" href="favicon.svg">', PAGE, BASE)).toEqual(['https://games.csarko.sh/portashton/favicon.svg']);
  });

  it('finds the entry script and the modules preloaded', () => {
    expect(entryScript(HTML, PAGE)).toBe('https://games.csarko.sh/portashton/assets/index-DYFmS29j.js');
    expect(entryScript('<script>1</script>', PAGE)).toBe(null);
    expect(modulePreloads(HTML, PAGE)).toEqual([
      'https://games.csarko.sh/portashton/assets/engine-CikSKhBB.js',
      'https://games.csarko.sh/portashton/assets/scene-D4epPTlq.js',
    ]);
  });
});

describe('contentTypeFits', () => {
  const at = (path) => `https://games.csarko.sh/portashton/${path}`;
  it('wants JavaScript for a script, and not the page again', () => {
    expect(contentTypeFits(at('assets/index-a.js'), 'text/javascript; charset=utf-8')).toBe(true);
    expect(contentTypeFits(at('assets/index-a.js'), 'application/javascript')).toBe(true);
    expect(contentTypeFits(at('assets/index-a.js'), 'text/html; charset=utf-8')).toBe(false);
  });
  it('wants the type of each other kind the build writes', () => {
    expect(contentTypeFits(at('favicon.svg'), 'image/svg+xml')).toBe(true);
    expect(contentTypeFits(at('favicon.svg'), 'text/html')).toBe(false);
    expect(contentTypeFits(at('assets/x.css'), 'text/css')).toBe(true);
    expect(contentTypeFits(at('libs/ktx2/x.wasm'), 'application/wasm')).toBe(true);
    expect(contentTypeFits(at('assets/a.mp3'), 'audio/mpeg')).toBe(true);
    expect(contentTypeFits(at('assets/a.glb'), 'model/gltf-binary')).toBe(true);
    expect(contentTypeFits(at('assets/a.js.map'), 'application/json')).toBe(true);
  });
  it('wants anything but HTML of a file whose extension says nothing, and a type at all', () => {
    expect(contentTypeFits(at('libs/x.bin'), 'application/octet-stream')).toBe(true);
    expect(contentTypeFits(at('libs/x.bin'), 'text/html')).toBe(false);
    expect(contentTypeFits(at('assets/index-a.js'), null)).toBe(false);
    expect(contentTypeFits(at('assets/index-a.js'), '')).toBe(false);
  });
});

describe('the headers', () => {
  it('holds immutable only for a long max-age and the word', () => {
    expect(isImmutable('public, max-age=31536000, immutable')).toBe(true);
    expect(isImmutable('public, max-age=31536000')).toBe(false);
    expect(isImmutable('public, max-age=60, immutable')).toBe(false);
    expect(isImmutable(null)).toBe(false);
  });
  it('holds a page uncached where it says no-cache or no-store', () => {
    expect(isNoCache('no-cache')).toBe(true);
    expect(isNoCache('public, max-age=0, no-cache')).toBe(true);
    expect(isNoCache('no-store')).toBe(true);
    expect(isNoCache('public, max-age=3600')).toBe(false);
    expect(isNoCache(null)).toBe(false);
  });
  it('reads a redirect target as an absolute address', () => {
    const headers = new Headers({ location: 'https://csarko.sh/games' });
    expect(locationOf(headers, 'https://games.csarko.sh/')).toBe('https://csarko.sh/games');
    expect(locationOf(new Headers({ location: '/games' }), 'https://games.csarko.sh/')).toBe('https://games.csarko.sh/games');
    expect(locationOf(new Headers(), 'https://games.csarko.sh/')).toBe(null);
  });
});

describe('the build tag', () => {
  // Vite writes `import.meta.env` into a chunk as an object, with the variables the build was given.
  const CHUNK = 'function a(){return f({BASE_URL:`/portashton/`,DEV:!1,MODE:`production`,PROD:!0,SSR:!1,VITE_BUILD_SHA:`abc1234`},location)}';
  it('is found where the chunk carries it, and not where it does not', () => {
    expect(findBuildTags(CHUNK)).toEqual(['abc1234']);
    expect(findBuildTags(CHUNK.replace('VITE_BUILD_SHA', 'VITE_OTHER'))).toEqual([]);
    expect(findBuildTags('{VITE_BUILD_SHA:"abc1234-dirty"}')).toEqual(['abc1234-dirty']);
    expect(findBuildTags('{DEV:!1}')).toEqual([]);
  });
  it("is a commit's short sha, with -dirty where its tree was, and never the development fallback", () => {
    for (const tag of ['abc1234', '0123456789abcdef0123456789abcdef01234567', 'abc1234-dirty']) expect(isBuildTag(tag), tag).toBe(true);
    for (const tag of ['dev', '', 'abc12', 'ABC1234', 'abc1234-dirt', 'zzz1234']) expect(isBuildTag(tag), tag).toBe(false);
  });
});

describe('the title film', () => {
  it('is not named by the page: a .mp4 in the html fails, and a page without one passes', () => {
    expect(mp4Named(HTML)).toEqual([]);
    expect(mp4Named(`${HTML}<video src="/portashton/assets/title-Ab12.mp4"></video>`)).toEqual(['/portashton/assets/title-Ab12.mp4']);
    expect(mp4Named('<link rel="preload" href="/portashton/assets/title-Ab12.MP4?x=1">')).toHaveLength(1);
  });
});
