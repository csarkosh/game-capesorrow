#!/usr/bin/env node
// Re-records the title film with one command, with the rig up (its Chrome listening on --remote).
//
//   npm run recording:take -- --out <frames dir> [--remote <port>] [--fresh]
//
// 1. `recording:channel` builds the film page and publishes it to a preview channel; its address is read from what it prints.
// 2. The engine's `record.mjs` records that page's frames into --out.
// 3. The engine's `encode.mjs` encodes them into `client/assets/video/title.mp4` and `title.still.webp`, and checks the loop's seam.
// Each step stops the run if it fails. Commit the two files after you have looked at them.

import { spawnSync } from 'node:child_process';
import { encodeArgsFor, filmUrlFrom, parseTakeArgs, recordArgs, TAKE_USAGE } from './lib/takeArgs.mjs';

const args = parseTakeArgs(process.argv.slice(2));
if ('error' in args) {
  console.error(`\n✗ ${args.error}. ${TAKE_USAGE}\n`);
  process.exit(1);
}

function stop(what) {
  console.error(`\n✗ ${what}\n`);
  process.exit(1);
}

console.log('→ publishing the film page to its channel');
const channel = spawnSync('npm', ['run', 'recording:channel'], { encoding: 'utf8', stdio: ['inherit', 'pipe', 'inherit'] });
process.stdout.write(channel.stdout ?? '');
if (channel.status !== 0) stop('recording:channel failed');
const url = filmUrlFrom(channel.stdout ?? '');
if (url === null) stop('recording:channel printed no address for the film page');

console.log(`→ recording ${url}`);
const record = spawnSync('node', recordArgs({ url, ...args }), { stdio: 'inherit' });
if (record.status !== 0) stop('the recording failed (run it again to resume)');

console.log('→ encoding');
const encode = spawnSync('node', encodeArgsFor(args), { stdio: 'inherit' });
if (encode.status !== 0) stop('the encode failed');

console.log('\n✓ client/assets/video/title.mp4 and title.still.webp are written; look, then commit');
