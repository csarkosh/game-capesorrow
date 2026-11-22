import { describe, it, expect } from 'vitest';
import { baseOf, buildTagOf, productionEnv, signalingWsUrl, sitePathOf } from '../lib/buildEnv.mjs';

const SITE = 'https://games.csarko.sh/capesorrow';

describe('the base and the path', () => {
  it("are the site URL's path, with and without the trailing slash", () => {
    expect(baseOf(SITE)).toBe('/capesorrow/');
    expect(baseOf(`${SITE}/`)).toBe('/capesorrow/');
    expect(sitePathOf(SITE)).toBe('/capesorrow');
    expect(sitePathOf(`${SITE}/`)).toBe('/capesorrow');
  });
});

describe('buildTagOf', () => {
  it('is the sha, and the sha with -dirty where the tree was', () => {
    expect(buildTagOf('abc1234', false)).toBe('abc1234');
    expect(buildTagOf('abc1234', true)).toBe('abc1234-dirty');
  });
});

describe('signalingWsUrl', () => {
  it('turns the service address into the WebSocket address the server binds', () => {
    expect(signalingWsUrl('https://signal.example.invalid')).toBe('wss://signal.example.invalid/ws');
    expect(signalingWsUrl('https://signal.example.invalid/')).toBe('wss://signal.example.invalid/ws');
  });
});

describe('productionEnv', () => {
  it('builds under the game\'s path, names the site and the commit, and passes NO signaling address while there is none', () => {
    const env = productionEnv({ site_url: SITE }, 'abc1234');
    expect(env).toEqual({ CAPESORROW_BASE: '/capesorrow/', VITE_WEB_BASE: SITE, VITE_BUILD_SHA: 'abc1234' });
    expect('VITE_SIGNALING_URL' in env).toBe(false);
    expect(productionEnv({ site_url: SITE, signaling_url: '' }, 'abc1234').VITE_SIGNALING_URL).toBeUndefined();
  });

  it('passes the signaling address as a WebSocket address once production.json has one', () => {
    const env = productionEnv({ site_url: SITE, signaling_url: 'https://signal.example.invalid' }, 'abc1234-dirty');
    expect(env).toEqual({
      CAPESORROW_BASE: '/capesorrow/',
      VITE_WEB_BASE: SITE,
      VITE_BUILD_SHA: 'abc1234-dirty',
      VITE_SIGNALING_URL: 'wss://signal.example.invalid/ws',
    });
  });
});
