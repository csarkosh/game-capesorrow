---
name: deploy-production
description: Use when shipping game-portashton to production — "deploy", "deploy to prod", "push it live", "ship this to production", "release", or verifying that what is live matches main. Covers the client on the shared Firebase Hosting site; there is no server to deploy yet.
---

# Deploying to production

The game is live at **https://games.csarko.sh/portashton**. One thing ships there, and one does not:

| Piece | Where | What ships it |
| --- | --- | --- |
| Client (`client/dist`) | Firebase Hosting site `fps-csarko`, at the path `/portashton/`: a free CDN, on the site Day Hike shares | `npm run deploy:client` |
| Server (`server/`: the engine's server, `@csarkosh/engine-server`, from the release `server/package.json` names) | **Not deployed.** There is no Cloud Run service, no infrastructure of this game's own, and no `_infra/` | nothing yet |

Until there is a server, the client is built with no signaling address and is played alone: the public page shows
"In development." with Play under it and no party box, and that is correct. `npm run deploy:verify` checks the result from the outside,
against the real public URLs.

Deploys are local scripts by choice. There is no CI deploy, so **the gates below are the only thing standing between a
mistake and production.**

## The shared site

`games.csarko.sh` is one Firebase Hosting site that holds more than one game. Day Hike's repository owns the site, the
domain and its root (its `_infra/`, and the 301 from `games.csarko.sh/` to `csarko.sh/games`); this repository owns only
`/portashton/` and its rules, `tools/deploy/site.rules.json`.

A Firebase Hosting release is the whole site at once, so a naive deploy of one game would replace the other's. The
deploy therefore never runs `firebase deploy` itself. It runs the engine's shared-site tool,
`node_modules/@csarkosh/engine/tools/site/deploy.mjs` (engine release v0.2.3 or later; the deploy says so and stops, before
building, where the installed engine does not have it). The tool reads the live site, merges this game's files and rules
under `/portashton/` into it, skips source maps and dotfiles, and **refuses to release if any other game's file would
change**. That refusal is the guard: if it fires, stop and say so; never work around it.

Never use the Firebase console or the `firebase` CLI to change the site by hand for this game.

## The sequence

```bash
git fetch origin && git status -sb    # 1. be on main, synced, clean
npm run gate                          #    the gates (github-push says how)
npm run deploy:client -- --dry-run    # 2. the whole deploy but the release: build, merge, list
npm run deploy:client                 # 3. release
npm run deploy:verify                 # 4. prove it from outside
```

Every step earns its place:

**1. Commit first.** The build is tagged with the current commit (`VITE_BUILD_SHA`, which the engine's telemetry rows
and the bundle carry), and the release message is `portashton <tag>`, so a release traces back to a source state. A dirty
tree tags `<sha>-dirty`, which is how an untested local change announces itself; the deploy refuses one unless it is going
to a preview channel (`--channel <name>`) or is a dry run. Never deploy a dirty tree to production: commit.

**2. The dry run is free.** It builds and runs the tool with its `--dry-run`, which releases nothing, so what the merge
would change under `/portashton/` is read before anything is live. Read it: a change to another game's path is a mistake,
whatever the tool decides.

**3. A preview channel** (`npm run deploy:client -- --channel <name>`) releases the build to a Firebase Hosting preview
channel instead of the live site. Check it with `npm run deploy:verify -- --base <the channel's URL for /portashton>`.

**The title film's page** is a development page: `npm run recording:channel` (`deploy:client -- --channel film --mode film`) builds
it with `vite build --mode film` and publishes it to the preview channel `film`, where the recording is made (`npm run
recording:take`). `--mode` goes to a named preview channel only, a dry run included, and the channel `live`, which is Firebase
Hosting's production channel, is refused for every deploy: production is `deploy:client` with no `--channel`. `deploy:verify`
checks that production's `/portashton/title.html` is not the film's page.

**4. Verify is not optional.** A client change can break production without any test failing: nothing in the suite loads
a real bundle from a real host. `deploy:verify` prints a line a check and exits non-zero on any ✗: the page answers 200 as
HTML with the title `Something Haunts Port Ashton`; every file it names under `/portashton/` answers 200 with a fitting content type (the
entry script is JavaScript, not the page again); a hashed file under `assets/` is immutable and the page itself `no-cache`;
`/portashton/settings` answers the same page; the bundle names the build; and **Day Hike is untouched** (`/dayhike/`
answers 200 as `Day Hike`, and the site's root still 301s to `https://csarko.sh/games`). `-- --sha <tag>` demands the
exact build.

## What the scripts need

Three values describing production, from `tools/deploy/production.json` (committed, all public): the project
(`fps-csarko`), the hosting site (`fps-csarko`) and the site URL (`https://games.csarko.sh/portashton`). There is no
Terraform here to ask. You still need, locally:

- **`gcloud` authenticated**, with the active project set to `fps-csarko`. The script refuses to run when the active
  project differs, because a deploy that targets the wrong project fails in ways that look like success.
- **The engine release that has the site tool** (v0.2.3 or later) installed: `client/package.json` names the release, and
  moving to one is editing that address and `npm install`.

There is no Docker and no Git LFS step: nothing here builds an image, and the repository holds no model or texture of its
own (the engine's shipped files come whole inside its tarball).

## Rolling back

**Redeploy the older commit.** There is no per-game rollback in Firebase, and **never roll back in Firebase's console**:
that rolls the whole site back, which rolls Day Hike back with it. Check out the commit that was good (a detached
worktree is the clean way: `git worktree add .claude/worktrees/rollback <good-sha>`, then `npm ci` there), and run
`npm run deploy:client` from it. The tool merges that build over this game's path and, as always, leaves other games'
files alone. Follow up by getting `main` back to a good state: a rolled-back site that nobody fixes is one deploy away
from undoing the rollback.

`firebase hosting:disable` exists and takes the whole site down to a placeholder, Day Hike with it. Never use it for this
game.

## When the game has a server

Nothing here is ready for it; the steps are the change to make, in order, each said to the owner first because each
creates something that may bill (nothing may bill while idle):

1. The server's infrastructure, in a repository place that owns it (this repository has no `_infra/`; say where it goes).
2. `signaling_url` in `tools/deploy/production.json`: then `deploy:client` builds with `VITE_SIGNALING_URL`
   (`tools/deploy/lib/buildEnv.mjs`), the build can play, and the title page offers Play.
3. `deploy:verify` checks for a signaling address and a WebSocket handshake, as Day Hike's does; add them with the server.

## After deploying

Report what actually shipped: the build tag, the commit, and the `deploy:verify` result. If a check failed, say which one
and what it means — never report a deploy as done on the strength of the scripts exiting zero.
