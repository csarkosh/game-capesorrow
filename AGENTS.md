# game-capesorrow — working context

Cape Sorrow is a game in which a detective investigates paranormal reports across the Pacific Northwest, in an open,
procedurally generated coastal Washington. It is part PNW life and detective sim, part supernatural horror.

It is built on [`@csarkosh/engine`](https://github.com/csarkosh/engine), as its sister game Day Hike is, and is served
at [games.csarko.sh/capesorrow](https://games.csarko.sh/capesorrow). Nothing of the game exists yet: what the page
shows is a title page, and what Play starts (in development only) is the engine's empty game. The public page says
"In development." See [`README.md`](README.md) for what it is and [`ARCHITECTURE.md`](ARCHITECTURE.md) for how it is
built.

## Starting development work

Before writing code for a new task, create a fresh git worktree branched from the latest
`origin/main`:

```bash
git fetch origin
git worktree add -b worktree-<name> .claude/worktrees/<name> origin/main
```

- Always branch from freshly fetched `origin/main` — never from the local checkout's HEAD, and never reuse an existing worktree or branch for new work.
- One worktree per task; convention is directory `.claude/worktrees/<name>` on branch `worktree-<name>`.
- The default branch is `main` (there is no `master`).
- `.claude/worktrees/` is gitignored. Skills live in `.agents/skills/`; `.claude/skills` is a symlink to it so Claude Code discovers them.

**Load-sensitive work runs in the cloud, never on this Mac**: other workstreams always run on it, so it is never quiet
enough for timed work. The client suite (its time limits), frame times and captures run on GitHub's runners or on rented
rigs; this machine runs only what load cannot fail (lint, the tools suite, a build), and anything else only when the
owner asks for it by name. Before pushing, `npm run gate` decides: a change confined to tooling or docs is gated here in
seconds; any other is gated by the `test` workflow, which the gate dispatches on the pushed branch (the `github-push`
skill). Never answer a timing failure on this machine by running it again here.

**Nothing may bill while idle.** Everything scales to zero, and idle is free: never add a resource that bills while idle
without saying so first.

**Large and flat-file output goes on the external disk** named by `ENGINE_LAB`, never in the repository and never the
laptop's own disk: recordings, captures, renders, frame-time and rig logs. Nothing of the repository lives there: no
worktree, symlink or `node_modules`. If it is not mounted, ask.

**CI is started by hand only.** No push or pull request starts a run, because runner minutes cost time and money:
`.github/workflows/test.yml` is `workflow_dispatch` alone, and `npm run gate` or an agent starts it on purpose.

## Layout

| Path | What |
|---|---|
| `client/` | The game: `package.json` (the engine, installed from a release's tarball), `index.html`, `src/`, `test/`, `levels/`, `public/`, `vite.config.ts`, `tsconfig.json`. See the next rows. |
| `client/src/` | **Scaffold:** `{game.ts, sim.ts, hud.ts, net.ts, coast.ts, terrain.ts, assets.ts, world.worker.ts}` and `client/levels/yard.json` are the engine's empty game (a walkable yard on the engine's coast), written by the engine's `tools/new-game.mjs` and not yet changed. **Play starts it in development until Cape Sorrow's own game replaces it**; their names (`WALK_*`, `EMPTY_GAME`) are the engine's and stay as they are until then. **Cape Sorrow's own:** `main.ts` (starts the engine's shell with the page definition), `page.ts` (`CAPE_PAGE`, the definition the shell is handed, and `createCapePage`, the game's own of the page), `identity.ts` (the game's name, word for a session and storage prefix). |
| `client/src/game/` | The title page, in Day Hike's visual language and with no background: `words.ts` (every word the page says that is the game's own, as constants), `landingModel.ts` (what the page shows, as data: whether the build can play, Play or "In development.", the Settings page, the panel focus rule), `landing.ts` (paints the model: the styles and the DOM), `credits.ts` (the credits the Credits screen and the turned-away page show). |
| `client/src/sim/town/` | The town plan generator, pure deterministic simulation code (no DOM; arithmetic limited to `+ - * /`, `floor`, `round`, `abs`, `min`, `max`, `sqrt`, `imul`; grid bearings are Pythagorean triples; one seeded stream per stage). `site.ts` (the `TownSite` a plan is made from), `plan.ts` (`planTown(site, kind)`), `planFor.ts` (`planFor(worldSeed)`: the plan on the site `siteFor` reads off the coast, cached), `recipes.ts` (one recipe per `TownKind`), `types.ts`, `version.ts` (`TOWN_GEN`, raised whenever a site would give a different plan), `rng.ts`, `bearings.ts`, `geom.ts`, `shore.ts`, `lots.ts`, `names.ts`, and `port/` (the large port: `history.ts`, `layout.ts`, `rules.ts`, `buildings.ts`, `landmarks.ts`). `client/test/town/banned.test.ts` enforces the arithmetic rules over every file here. |
| `client/src/townMap/`, `client/town.html` | The map page for looking at plans, served by the dev server at `/town.html` and not part of the build: `svg.ts` (`planSvg`, `sheetSvg`, pure), `main.ts` (the page: the real coast of a world seed, its history, legend, counts, and the contact sheet at `?sheet=12&from=1`), `realSite.ts` (the world's own site for a world seed, the made ground's reach inland held to at least 320 m; the page and the tests use it), `syntheticSite.ts` (a wavy shore with a cove and a bending highway from a seed, for `?site=synthetic` and a few odd-shape tests). |
| `client/test/` | The client suite (vitest, no DOM library): the scaffold's two tests (`game.test.ts`, `walk.test.ts`, with the renames the page took), the title page's tests under `game/`, `page.test.ts`, and `setup/identity.ts` (every test runs under the game's identity). |
| `client/public/` | `favicon.svg`, a placeholder mark. The engine's own public files (the KTX2 decoder) are added to the build by its preset. |
| `server/` | Cape Sorrow's part of the signaling and telemetry server, and nothing else: `game.json` (the game it serves: its admin app id, telemetry dataset and log bucket, and the origins allowed), `package.json` and the `Dockerfile`. The server's code is the engine's, `@csarkosh/engine-server` (the Node `ws` server: introduces peers in a room, then steps out; takes telemetry on `POST /t`), installed from the release named in `server/package.json`; moving to a new release is editing that address and running `npm install`. Its README (`node_modules/@csarkosh/engine-server/README.md`) lists the settings and the environment variables. `npm run dev:server` runs it with Node's `--watch` from `node_modules`. **Not deployed**: it runs in development only. |
| `tools/deploy/` | `client.mjs` (builds the client under `/capesorrow/` and publishes it to its path on the shared site with the engine's `tools/site/deploy.mjs`), `verify.mjs` (proves the result from outside), `production.json` (the public addresses), `site.rules.json` (this game's hosting rules), `lib/` (the pure parts: arguments, the build's environment, the site tool's argument list, the verify checks; and the parts that run things) and `test/`. |
| `tools/docs/` | The docs file-name test (`test/`). |
| `tools/vitest.config.mjs` | The tools suite's config: plain Node ESM tests under `tools/**/test/`. |
| `docs/` | Design docs and verification notes, grouped by subject. Does not exist until the first doc is written (git holds no empty folder); every file is named `YYYY-MM-DD-<topic>.md`; see [Docs](#docs). |
| `.agents/skills/` | Agent skills. `.claude/skills` is a symlink to it so Claude Code discovers them. |
| `.claude/settings.json` | Imports the shared skill plugins from [`csarkosh/skills-general`](https://github.com/csarkosh/skills-general); see [Skills](#skills). |
| `.github/workflows/test.yml` | CI, **started by hand only**: typecheck and lint (`static`), the tools suite (`tools`), the client suite on one runner with its test time limits scaled by `TEST_TIME_SCALE` (`client`), the client built as the deploy builds it (`build`), and a final `gates` job that fails unless the others passed. `npm run gate` dispatches it on the pushed branch for every change outside tooling and docs, and follows it (the `github-push` skill). |
| `AGENTS.md` | This file. `CLAUDE.md` points here. |
| `README.md` | Human-facing overview of the game. |
| `ARCHITECTURE.md` | The engine and what the game hands it, the title page's parts, hosting, and what is scaffold. |
| `LICENSE` | GPL-3.0. `package.json` says `GPL-3.0-only`. |
| `CREDITS.md` | Credits for the third-party work that is Cape Sorrow's own (none yet), rendered by the in-game Credits screen beside the engine's (`client/src/game/credits.ts`). The engine's shipped works are credited in the package's `CREDITS.md`, and the screen shows both lists as one. |
| `package.json`, `package-lock.json` | npm workspaces root (`client`, `server`; the engine is a dependency of the client and its server of `server/`, in the lockfile with its release's hash); scripts for dev, build, typecheck, lint, test, the gate and the deploy. The lockfile began as Day Hike's, so that every platform's optional native packages stay in it: never regenerate it from nothing, or Linux CI fails. |
| `tsconfig.base.json` | Shared TypeScript compiler options extended by `client/`. |
| `eslint.config.js` | Flat ESLint config. It has none of Day Hike's `sim/` and `net/` layering rules: those folders do not exist here (the scaffold's are files). |
| `.dockerignore` | Build context excludes for the server's Docker image. |
| `.gitattributes` | Git LFS tracking for shipped binaries (none yet: the first model or texture lands in LFS); `\n` line endings for text. |
| `.gitignore` | Build output, local state, worktrees and `docs/superpowers/` excluded from version control. |

The engine is its own repository, `csarkosh/engine` (checked out beside this one at `~/Projects/engine` when working on
both), and Cape Sorrow installs it as a release's tarball: `client/package.json` names the address under
`https://github.com/csarkosh/engine/releases/`, and the package's modules are imported as `@csarkosh/engine/<path>`.
Moving to a new engine version is editing that address and running `npm install` (commit the lockfile). The engine's
scripts (the push gate) run from the installed package's `node_modules/@csarkosh/engine/tools`, through the root
`package.json`'s scripts, and read `ENGINE_GATE` and `ENGINE_LAB`. To try an engine change here before it is released,
pack it there (`npm pack`) and install the tarball by path (`npm install ../engine/csarkosh-engine-<version>.tgz -w client`),
and never commit that: the committed address is always a release's.

## Hosting

The game is served from the shared site `games.csarko.sh` (Firebase Hosting site `fps-csarko`, Google Cloud project
`fps-csarko`), at `/capesorrow/`. The site, the domain and its root belong to Day Hike's repository, whose `_infra/`
owns them. This repository owns only `/capesorrow/` and its rules (`tools/deploy/site.rules.json`), and deploys them with
the engine's `tools/site/deploy.mjs` (in engine release v0.2.3 or later), which merges this game's files and rules into
the live site and refuses to release if any other game's file would change: neither game's deploy touches the other's.
There is no `_infra/` here, and there will not be until the game has a resource of its own.

The server is not deployed. A client built without a signaling address cannot play, and its public page says
"In development." (`client/src/game/landingModel.ts`, `canPlay`). When the game has a server, `production.json` gains a
`signaling_url`, and the deploy bakes it into the build as `VITE_SIGNALING_URL`. The `deploy-production` skill has the
steps.

## Docs

Every file committed under `docs/` is named `YYYY-MM-DD-<topic>.md`:

- `YYYY-MM-DD` is the date the doc was written, which is today's date for a new doc. Keep the original date when you revise the doc later.
- `<topic>` is lowercase kebab-case: letters, digits and single hyphens.
- Group docs into a folder by subject, such as `docs/rendering/2026-09-14-stylized-shader-looks.md`.

`tools/docs/test/docNames.test.mjs` fails `npm test` if any file under `docs/` breaks this rule.

A doc describes the game and how it is built, never how the work on it was organised. Implementation plans, step lists
and working notes are not committed: keep them under `docs/superpowers/` (research, `plans/`, `specs/`, and the agents'
runs), which `.gitignore` keeps out of the repository and the file-name test skips. A design doc records what was built
in its own terms (an "As built" section, or the amendments as they landed), never by pointing at a step of a plan.

## Skills

This repository's own skills, in `.agents/skills/`:

- `deploy-production` — shipping this repository to production: deploying the client to its path on the shared Firebase Hosting site, and verifying what's live.
- `github-push` — pushing work to the `game-capesorrow` GitHub repository, and writing the commit message before a push.

Shared skills, imported from the [`csarkosh/skills-general`](https://github.com/csarkosh/skills-general) plugin marketplace rather than copied here:

- `general:doc-preview` — opening a repo document (spec, research note, design doc) as a styled page in Chrome on this machine, without publishing it. Claude Code and Codex.
- `general-claude:doc-artifact` — publishing a repo document as a claude.ai Artifact. Claude Code only.

To change a shared skill, change it in `skills-general`, not here. Claude Code reads the import from `.claude/settings.json`; on a machine that has never installed the plugins, run `claude plugin install general@csarkosh` and `claude plugin install general-claude@csarkosh` once. Codex has no per-repository import, so install once per machine with `codex plugin marketplace add csarkosh/skills-general` and `codex plugin add general@csarkosh`.

Read a skill's `SKILL.md` before using it.
