#!/usr/bin/env node
// Build the client and publish it to its path on the shared site.
//
// The shared site (games.csarko.sh, Firebase Hosting site `fps-csarko`) is Day Hike's repository's:
// it owns the site, the domain and its root. This game owns only `/capesorrow/` and its rules
// (`site.rules.json`), and ships them with the engine's `tools/site/deploy.mjs`, which merges this
// game's files and rules into the live site, skips source maps and dotfiles, leaves every other
// game's files alone, and refuses to release if any other game's file would change. So neither
// game's deploy touches the other's.
//
// Usage: npm run deploy:client [-- --channel <name>] [-- --dry-run]
//   --channel <name>  a Firebase Hosting preview channel, not production (a dirty tree may go)
//   --dry-run         everything but the release (a dirty tree may go)

import { existsSync } from 'node:fs';
import { parseDeployArgs, USAGE } from './lib/args.mjs';
import { sitePathOf } from './lib/buildEnv.mjs';
import { buildClient } from './lib/buildClient.mjs';
import { fail, production, requireCommand, requireGcloudProject, runLoud, treeIsDirty } from './lib/preconditions.mjs';
import { deployRefusal, SITE_TOOL, SITE_TOOL_MISSING, siteDeployArgs } from './lib/siteDeploy.mjs';

const args = parseDeployArgs(process.argv.slice(2));
if ('error' in args) fail(`${args.error}. ${USAGE}`);
const { channel, dryRun } = args;

requireCommand('npm', 'Install Node 22 or later.');
const prod = production();
requireGcloudProject(prod.gcp_project_id);

const refusal = deployRefusal({ dirty: treeIsDirty(), channel, dryRun });
if (refusal !== null) fail(refusal);

// Before the build, which takes a while: the tool that ships it must be there.
if (!existsSync(SITE_TOOL)) fail(SITE_TOOL_MISSING);

console.log(`→ site      ${prod.hosting_site_id} (project ${prod.gcp_project_id}), path ${sitePathOf(prod.site_url)}`);
if (channel !== null) console.log(`→ channel   ${channel}`);
if (dryRun) console.log('→ dry run: nothing will be released');

const env = buildClient();

runLoud(
  'node',
  [
    SITE_TOOL,
    ...siteDeployArgs({
      project: prod.gcp_project_id,
      site: prod.hosting_site_id,
      path: sitePathOf(prod.site_url),
      tag: env.VITE_BUILD_SHA,
      channel,
      dryRun,
    }),
  ],
);

console.log(dryRun ? '\n✓ dry run done; nothing was released' : channel !== null ? `\n✓ client published to channel ${channel}` : '\n✓ client published');
if (!dryRun && channel === null) console.log('  Next: npm run deploy:verify');
