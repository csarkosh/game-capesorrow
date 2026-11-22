// Shared checks and helpers for the deploy scripts.
//
// These scripts are the interface a deploy skill drives, so every failure has to be specific
// enough to act on: which precondition failed, and what to run to fix it. A generic non-zero
// exit is not enough.

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { buildTagOf } from './buildEnv.mjs';
import { checkProduction } from './siteDeploy.mjs';

/** Exits with a message naming the fix, rather than a stack trace. */
export function fail(message) {
  console.error(`\n✗ ${message}\n`);
  process.exit(1);
}

export function run(file, args, options = {}) {
  return execFileSync(file, args, { encoding: 'utf8', stdio: 'pipe', ...options });
}

/** Streams output through, for long builds where silence looks like a hang. */
export function runLoud(file, args, options = {}) {
  return execFileSync(file, args, { stdio: 'inherit', ...options });
}

export function requireCommand(command, install) {
  try {
    run('which', [command]);
  } catch {
    fail(`\`${command}\` is not on PATH. ${install}`);
  }
}

/**
 * Where production is: `tools/deploy/production.json`, committed. They are addresses, not
 * configuration: every one of them is already public. There is no Terraform in this repository
 * (the shared site's infrastructure is Day Hike's repository's), so this file is the only source.
 */
const PRODUCTION_PATH = 'tools/deploy/production.json';

export function production() {
  if (!existsSync(PRODUCTION_PATH)) fail(`${PRODUCTION_PATH} is missing. Run this from the repository root.`);
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(PRODUCTION_PATH, 'utf8'));
  } catch (error) {
    fail(`${PRODUCTION_PATH} is not valid JSON: ${error.message}`);
  }
  const checked = checkProduction(parsed);
  if (!checked.ok) fail(`${PRODUCTION_PATH} ${checked.error}.`);
  return checked.production;
}

/** Whether the working tree has uncommitted changes (untracked files count). */
export function treeIsDirty() {
  try {
    return run('git', ['status', '--porcelain']).trim() !== '';
  } catch {
    return fail('could not read git status. Run this from inside the git repository.');
  }
}

/**
 * The commit the working tree is at, as a tag: the short sha, with `-dirty` when the tree has
 * uncommitted changes, so an untested local change is never mistaken for a committed one. The
 * client build bakes it in (`VITE_BUILD_SHA`).
 */
export function buildTag() {
  let sha;
  try {
    sha = run('git', ['rev-parse', '--short', 'HEAD']).trim();
  } catch {
    return fail('could not read the current commit. Run this from inside the git repository, with at least one commit.');
  }
  return buildTagOf(sha, treeIsDirty());
}

/**
 * `gcloud` is on PATH, has an active account, and its active project is the one `production.json`
 * names: a deploy that targets the wrong project fails in ways that look like success.
 */
export function requireGcloudProject(expected) {
  requireCommand('gcloud', 'Install the Google Cloud CLI.');
  const accounts = run('gcloud', ['auth', 'list', '--filter=status:ACTIVE', '--format=value(account)']).trim();
  if (accounts === '') fail('no active gcloud account. Run `gcloud auth login`.');
  const actual = run('gcloud', ['config', 'get-value', 'project']).trim();
  if (actual !== expected) {
    fail(`gcloud project is \`${actual}\` but ${PRODUCTION_PATH} names \`${expected}\`. Run \`gcloud config set project ${expected}\`.`);
  }
}
