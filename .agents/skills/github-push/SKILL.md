---
name: github-push
description: Use when pushing work to the game-capesorrow GitHub repository — "push this", "push it up", "commit and push", "ship it", or any push to origin. Also use before writing a commit message for work that is going to be pushed.
---

# Pushing to GitHub

`game-capesorrow` is a public, open-source repository with no reviewers. Nothing runs on a push or a pull request: the
`test` workflow is started by hand, and only when the section below says so (runner minutes cost time and money). A test
run says whether a change works but never why it was made, so the commit message is the only record of why a change
exists. It is written for the person reading `git log` months later with no memory of this session — usually the author —
and anyone on the internet can read it too, so it describes the change and never anything private about how the work was
done.

Remote: `origin`, once the repository is on GitHub (SSH; `gh auth` is configured for it). Default branch: `main`.

## The commit message

Every commit message is three parts, in this order, then the trailers the session's instructions give.

**1. Subject line.** Conventional Commits type, imperative mood, no trailing period, under 72 characters. The types: `feat`,
`fix`, `chore`, `docs`, `refactor`, `test`, `build`.

**2. A `## What` section.** Prose, one short paragraph. What the change is meant to accomplish — the outcome in the running
game or the codebase, stated so it makes sense to someone who has not seen the diff. This is the part `git log` readers
actually read.

**3. A `## How` section.** A list, one entry per meaningful change, **sequenced logically from beginning to end**: the
order a reader would trace the change through the system — entry point first, then what it calls, then what that touches,
then tests. Not alphabetical, not the order `git status` happens to print. Lead each entry with the file path in
backticks.

Full shape:

```
<type>: <subject under 72 chars>

## What

<One paragraph: what this change is meant to accomplish.>

## How

- `path/to/entry-point.ts` — <what this change does>
- `path/to/next-thing.ts` — <what this change does>
- `path/to/thing.test.ts` — <what this covers>
```

Say what each `How` entry does and, where it is not obvious, why it is that way: a constraint or a decision a future reader
would otherwise have to rediscover from the code.

## One commit per concern

Unrelated work gets its own commit even when it is pushed in the same breath. A tooling or skill change riding inside a
gameplay commit makes the gameplay commit unrevertable without collateral damage.

## Before pushing

**Nothing load-sensitive runs on the development machine**: other workstreams always run on it, so it is never quiet enough
for the client suite's time limits, and a timing failure there says nothing about the change. The cloud comes first; the
Mac runs only what load cannot fail.

```bash
npm run gate -- --plan    # which plan this branch needs, and why
npm run gate              # run it
```

The gate (the engine's `tools/gate.mjs`, run from the installed package: `node_modules/@csarkosh/engine/tools/gate.mjs`)
reads what the branch changes against `origin/main`, committed or not, and picks one of two plans (the engine's
`tools/gate/plan.mjs`):

- **light**: only tooling, docs or agent files changed (`tools/`, `docs/`, `.agents/`, `.claude/`, `README.md`,
  `AGENTS.md`, `CLAUDE.md`, `ARCHITECTURE.md`, `LICENSE`). Lint and the tools suite, here, in seconds: neither has a time
  limit, so load cannot fail them, and nothing the client suite tests was touched.
- **cloud**: anything else (the game, the server settings, the build, dependencies, CI, `CREDITS.md`). The gate dispatches the
  `test` workflow on GitHub's runners for this branch and follows it to its end; its exit is the run's. It runs what is
  pushed, so push the work branch first (never `main`); the gate refuses, saying what to do, while the branch is
  unpushed, behind, or has game files uncommitted.

Where `ENGINE_GATE` names a runner, the gate hands this checkout to it instead. `npm run gate -- <client test files>` runs
only those files here, as the runners run them (limits scaled by 3): a check while working, not the gate. `npm run gate --
--local` is the whole gate on this machine, only when the owner asks for it by name, never as a fallback when the cloud
plan says to push first.

Read the report. A failing gate is reported to the user before pushing, not after.

The `test` workflow (`.github/workflows/test.yml`) runs the same commands on GitHub's runners, **only when started by hand**
(`workflow_dispatch`; no push or pull request triggers it): typecheck and lint in one job (`static`), the tools suite
(`tools`), the client suite on one runner (`client`, its time limits scaled by `TEST_TIME_SCALE`, which the engine's
time-limit helper reads), the client built as the deploy builds it (`build`), and a final `gates` job that fails unless
every other job passed. `gates` is the one result to read. It is a pass-or-fail check; nothing it times means anything,
because the runners are shared machines. Every explicit time limit in the client suite is written
`timeLimit(<ms>)` (`@csarkosh/engine/testing/timeLimit`), so the factor applies to it.

Started by hand otherwise (`workflow_dispatch`), only when the owner asks:

```bash
gh workflow run test.yml --ref <branch>                      # start it; prints nothing
gh run list --branch <branch> --workflow test.yml --limit 1   # the run just started
gh run watch <run-id> --exit-status                          # follow it; exits non-zero on failure
gh run view <run-id> --log-failed                            # only the failing steps' output
```

The repository is public, so an unfinished commit is as visible as a finished one: before any push, read the diff for an
email address, a personal detail, an absolute path of a machine or a secret, and never bypass a pre-push hook with
`--no-verify`.

## Never push a large or binary file into git history

Git history is append-only in practice. A binary committed by accident is still in every clone forever, and removing it
means rewriting history that has already been pushed. **Stage explicit paths. Never `git add -A`, never `git add .`.**

Three layers stop this, and the third is the one that actually catches mistakes:

1. **`.gitignore`** — `node_modules/`, build output (`dist/`, `site/`), archives (`.zip`, `.7z`, `.rar`, `.tar`, `.tar.gz`,
   `.tgz`, `.dmg`).
2. **`.gitattributes`** — `.glb`, `.webp`, `.ktx2`, `.mp3`, `.mp4`, `.wasm`, `.png`, `.jpg` and `.ico` are tracked through
   **Git LFS**, so the object database stores a ~130-byte pointer instead of the file. The repository has no such file yet
   (the engine's shipped files live in the engine's repository and come in its tarball); the first model, texture or sound
   committed lands in LFS because of these lines. `tools/deploy/test/lfsAttributes.test.mjs` holds them.
3. **The check below** — run it before every push. `.gitignore` does not protect against `git add -f` or against a file
   that was already tracked before a rule existed.

```bash
# Anything large or binary about to leave the machine. Empty output means clean.
git rev-list --objects origin/main..HEAD |
  git cat-file --batch-check='%(objecttype) %(objectname) %(objectsize) %(rest)' |
  awk '$1=="blob" && $3 > 262144 {printf "%8.1f KB  %s\n", $3/1024, $4}' | sort -rn
```

A hit is not automatically wrong — `package-lock.json` is a legitimate ~130 KB of text. Judge it: **text is fine, binary is
not.** A binary in that list means it escaped LFS, so check `.gitattributes` covers its extension and confirm with:

```bash
git lfs status          # binaries must read "LFS:", never "Git:"
git lfs ls-files        # what LFS is actually tracking
```

If a binary was staged as `Git:`, unstage it, fix `.gitattributes`, and re-add. Once it is committed and pushed, the fix is
`git lfs migrate`, which rewrites history — report that to the user rather than doing it.

When the repository first gets an LFS file, two things change: `git-lfs` must be installed on any machine that clones
(`brew install git-lfs && git lfs install`), or the working tree gets pointer files where the files should be; and the
`test` workflow needs the LFS steps Day Hike's has (a job that fills the Actions cache from the object ids, and a check in
each job that reads them), which are the bandwidth-saving way to read them in CI. Add them in the commit that adds the file.
LFS storage and bandwidth are metered per account, and storage counts every version ever pushed.

## Pushing is not shipping

A push, to `main` or to a work branch, puts nothing in front of players: nothing reaches them until `main` is deployed.
Deployment and rollback are the `deploy-production` skill's. The commit format above is what makes a rollback target
identifiable there.
