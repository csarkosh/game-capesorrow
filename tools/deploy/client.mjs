#!/usr/bin/env node
// Build the client and publish it to its path on the shared site.
//
// The shared site (games.csarko.sh, Firebase Hosting site `fps-csarko`) is Day Hike's repository's:
// it owns the site, the domain and its root. This game owns only `/portashton/` and its rules
// (`site.rules.json`), and ships them with the engine's `tools/site/deploy.mjs`, which merges this
// game's files and rules into the live site, skips source maps and dotfiles, leaves every other
// game's files alone, and refuses to release if any other game's file would change. So neither
// game's deploy touches the other's.
//
// Usage: npm run deploy:client [-- --channel <name>] [-- --dry-run] [-- --mode <name>]
//   --channel <name>  a Firebase Hosting preview channel, not production (a dirty tree may go)
//   --dry-run         everything but the release (a dirty tree may go)
//   --mode <name>     vite's build mode; `film` adds the title film's page (title.html), for a preview channel only

import { existsSync } from 'node:fs';
import { parseDeployArgs, USAGE } from './lib/args.mjs';
import { sitePathOf } from './lib/buildEnv.mjs';
import { buildClient } from './lib/buildClient.mjs';
import { lfsPointersUnder } from './lib/lfsPointers.mjs';
import { fail, production, requireCommand, requireGcloudProject, runLoud, treeIsDirty } from './lib/preconditions.mjs';
import { deployRefusal, SITE_TOOL, SITE_TOOL_MISSING, siteDeployArgs } from './lib/siteDeploy.mjs';

const args = parseDeployArgs(process.argv.slice(2));
if ('error' in args) fail(`${args.error}. ${USAGE}`);
const { channel, dryRun, mode } = args;
if (mode !== null && channel === null && !dryRun) fail('a build in another mode (the title film\'s page) goes to a preview channel only: add --channel <name>.');

requireCommand('npm', 'Install Node 22 or later.');
const prod = production();
requireGcloudProject(prod.gcp_project_id);

const refusal = deployRefusal({ dirty: treeIsDirty(), channel, dryRun });
if (refusal !== null) fail(refusal);

// Before the build, which takes a while: the tool that ships it must be there.
if (!existsSync(SITE_TOOL)) fail(SITE_TOOL_MISSING);

// The textures are Git LFS objects. Unfetched, the build would ship their pointer files as if they were images.
if (existsSync('client/assets')) {
  const pointers = lfsPointersUnder('client/assets');
  if (pointers.length > 0) fail(`${pointers.length} file(s) under client/assets are Git LFS pointers, not the files (the first: ${pointers[0]}). Run: git lfs install && git lfs pull`);
}

console.log(`→ site      ${prod.hosting_site_id} (project ${prod.gcp_project_id}), path ${sitePathOf(prod.site_url)}`);
if (channel !== null) console.log(`→ channel   ${channel}`);
if (mode !== null) console.log(`→ mode      ${mode}`);
if (dryRun) console.log('→ dry run: nothing will be released');

const env = buildClient(mode);

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
