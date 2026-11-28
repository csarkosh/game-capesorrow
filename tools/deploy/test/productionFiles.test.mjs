import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { checkProduction } from '../lib/siteDeploy.mjs';

const read = (relative) => readFileSync(fileURLToPath(new URL(`../../../${relative}`, import.meta.url)), 'utf8');

describe('tools/deploy/production.json', () => {
  const text = read('tools/deploy/production.json');
  const file = JSON.parse(text);

  it("names the shared site's project and hosting site, and this game's path on it, and nothing else yet", () => {
    expect(file).toEqual({
      '//': expect.stringContaining('Every value is public'),
      gcp_project_id: 'fps-csarko',
      hosting_site_id: 'fps-csarko',
      site_url: 'https://games.csarko.sh/portashton',
    });
    // No signaling address until the game has a server: the build cannot play and says so.
    expect('signaling_url' in file).toBe(false);
    expect(checkProduction(file).ok).toBe(true);
  });

  it('holds no email address, no absolute path of a machine and no key', () => {
    expect(text).not.toMatch(/[\w.+-]+@[\w-]+\.[\w.-]+/);
    expect(text).not.toMatch(/\/Users\/|\/home\/|[A-Z]:\\/);
    // The values, not the note that says nothing secret belongs here.
    const values = Object.entries(file).filter(([key]) => key !== '//').map(([, value]) => value).join('\n');
    expect(values).not.toMatch(/AIza|-----BEGIN|secret|token/i);
  });
});

describe('tools/deploy/site.rules.json', () => {
  const rules = JSON.parse(read('tools/deploy/site.rules.json'));

  it("rewrites this game's path to its page, and caches what is under assets/ for good, and says nothing of any other path", () => {
    expect(rules).toEqual({
      rewrites: [{ source: '/portashton/**', destination: '/portashton/index.html' }],
      headers: [{ source: '/portashton/assets/**', headers: [{ key: 'Cache-Control', value: 'public, max-age=31536000, immutable' }] }],
    });
    const sources = [...rules.rewrites, ...rules.headers].map((r) => r.source);
    for (const source of sources) expect(source.startsWith('/portashton/'), source).toBe(true);
  });

  it("matches where the client's build puts its hashed files: assets/ under the base (the hashed file names are Vite's default)", () => {
    const config = read('client/vite.config.ts');
    expect(config).toContain('process.env.PORTASHTON_BASE ?? "/"');
    expect(config).not.toMatch(/assetsDir|entryFileNames|chunkFileNames|assetFileNames/);
  });
});
