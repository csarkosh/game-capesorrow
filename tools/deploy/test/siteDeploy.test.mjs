import { describe, it, expect } from 'vitest';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { checkProduction, CLIENT_DIST, deployRefusal, SITE_RULES, SITE_TOOL, SITE_TOOL_MISSING, SITE_TOOL_RELEASE, siteDeployArgs } from '../lib/siteDeploy.mjs';

const root = (relative) => fileURLToPath(new URL(`../../../${relative}`, import.meta.url));

describe('the engine site tool', () => {
  it("is called as the engine's interface says, in its order", () => {
    expect(siteDeployArgs({ project: 'fps-csarko', site: 'fps-csarko', path: '/capesorrow', tag: 'abc1234', channel: null, dryRun: false })).toEqual([
      '--project', 'fps-csarko', '--site', 'fps-csarko', '--path', '/capesorrow', '--dir', 'client/dist', '--rules', 'tools/deploy/site.rules.json',
      '--message', 'capesorrow abc1234',
    ]);
  });

  it('adds the channel and the dry run where asked, before the message', () => {
    const args = siteDeployArgs({ project: 'p', site: 's', path: '/capesorrow', tag: 'abc1234-dirty', channel: 'try-it', dryRun: true });
    expect(args.slice(-5)).toEqual(['--channel', 'try-it', '--dry-run', '--message', 'capesorrow abc1234-dirty']);
  });

  it('is at the place in the engine package the interface names, and says which release has it where it is missing', () => {
    expect(SITE_TOOL).toBe('node_modules/@csarkosh/engine/tools/site/deploy.mjs');
    expect(SITE_TOOL_RELEASE).toBe('v0.2.3');
    expect(SITE_TOOL_MISSING).toContain('v0.2.3 or later');
    expect(SITE_TOOL_MISSING).toContain(SITE_TOOL);
  });

  it("is given this game's rules file and the client's build, which are there", () => {
    expect(SITE_RULES).toBe('tools/deploy/site.rules.json');
    expect(CLIENT_DIST).toBe('client/dist');
    expect(existsSync(root(SITE_RULES))).toBe(true);
  });
});

describe('deployRefusal', () => {
  it('refuses a dirty tree for production', () => {
    expect(deployRefusal({ dirty: true, channel: null, dryRun: false })).toMatch(/not clean/);
  });
  it('lets a dirty tree go to a preview channel or as a dry run', () => {
    expect(deployRefusal({ dirty: true, channel: 'try-it', dryRun: false })).toBe(null);
    expect(deployRefusal({ dirty: true, channel: null, dryRun: true })).toBe(null);
  });
  it('lets a clean tree go anywhere', () => {
    expect(deployRefusal({ dirty: false, channel: null, dryRun: false })).toBe(null);
  });
});

describe('checkProduction', () => {
  const good = { gcp_project_id: 'fps-csarko', hosting_site_id: 'fps-csarko', site_url: 'https://games.csarko.sh/capesorrow' };
  it('accepts the file as it is, with or without a signaling address', () => {
    expect(checkProduction(good)).toEqual({ ok: true, production: good });
    expect(checkProduction({ ...good, signaling_url: 'https://signal.example.invalid' }).ok).toBe(true);
  });
  it('says what is wrong with a file that is not', () => {
    expect(checkProduction(null)).toEqual({ ok: false, error: 'is not a JSON object' });
    expect(checkProduction({ ...good, gcp_project_id: undefined })).toEqual({ ok: false, error: 'has no `gcp_project_id`' });
    expect(checkProduction({ ...good, hosting_site_id: '' })).toEqual({ ok: false, error: 'has no `hosting_site_id`' });
    expect(checkProduction({ ...good, site_url: 'nope' }).ok).toBe(false);
    expect(checkProduction({ ...good, site_url: 'https://games.csarko.sh/' }).ok).toBe(false);
    expect(checkProduction({ ...good, site_url: 'http://games.csarko.sh/capesorrow' }).ok).toBe(false);
    expect(checkProduction({ ...good, signaling_url: 'ws://x' }).ok).toBe(false);
  });
});
