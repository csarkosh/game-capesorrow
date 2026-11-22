# Architecture

Cape Sorrow is a game on [`@csarkosh/engine`](https://github.com/csarkosh/engine), which draws the world, runs the
netcode and the deterministic simulation, and owns the page. The game gives the engine's shell one page definition and
one identity; everything else is the engine's. This file says what is true of the repository today. Most of what a game
is does not exist yet.

## What the game hands the engine

`client/src/main.ts` registers the shipped files and the terrain, then calls the engine's `startShell` with `CAPE_PAGE`
(`client/src/page.ts`), a `PageGame`:

- `game`: the game a session is of (`EMPTY_GAME`: see Scaffold below).
- `side`: the game's own of the page (`createCapePage`), which the shell calls at the page's own points: it shows the
  title page, repaints it, shows a panel by its address, and keeps the mode. Nothing plays before a session starts.
- `identity` (`client/src/identity.ts`): the game's name, its word for a session (`case`), what a nameless player is
  called (`Detective`), and the prefix of everything it keeps in the browser (`capesorrow`).
- `away`: what the page for a visitor whose browser cannot play shows of the game: no still, and the same credits the
  Credits screen shows.
- `protocol`, `worldWorker`, `statusLine`, `scene`, `probeState`: the session's wire version, the worker that makes its
  world, a line of status, the staged scenes (none), and the state the tier check measures the renderer on.

## The title page

Built in `client/src/game/` in the visual language of Day Hike's title page (the same dark ground and vignette, the
monospace type, the filled and hollow buttons, the panel slide, the focus and `inert` handling), with no background still
or loop and no downloads, join box or update banner, since there is no desktop app.

- `words.ts` holds every word the page says that is the game's own, as constants.
- `landingModel.ts` decides what the page shows, as data, so the decisions are tested without a DOM: `canPlay` (the dev
  server, or a build given a signaling address, `VITE_SIGNALING_URL`, which the engine's net layer reads in the same
  way), then Play, `Loading…` while the world builds, `Waiting for the host…` for a follower, or, where the build cannot
  play, the quiet line `In development.` in Play's place.
- `landing.ts` paints the model with DOM APIs only (`textContent`, never `innerHTML`) and slides between the home panel and
  the Settings and Credits panels. Settings and Credits are the engine's screens (`renderSettings`, `renderCredits`).
- The panels have addresses, `/settings` and `/credits`, which the shell routes: `showPanel` slides the page to the panel,
  so the browser's Back closes it.
- `credits.ts` merges the repository's `CREDITS.md` (no entry yet) with the engine's `ENGINE_CREDITS`, in the order of the
  ids, then the engine's display pass.

## Hosting

The client is a static Vite build under the base `/capesorrow/` (`CAPESORROW_BASE`), published to its path on the shared
Firebase Hosting site `games.csarko.sh`, which Day Hike's repository owns. The deploy (`tools/deploy/client.mjs`) uses the
engine's shared-site tool, which merges this game's files and rules (`tools/deploy/site.rules.json`: a rewrite of every
address under `/capesorrow/` to its page, and an immutable cache header on `/capesorrow/assets/`, where Vite puts the
hashed files) into the live site without touching another game's. `tools/deploy/verify.mjs` checks the result from
outside, including that Day Hike is as it was. There is no server deployed and no infrastructure of this game's own.

## What is scaffold

`client/src/{game.ts, sim.ts, hud.ts, net.ts, coast.ts, terrain.ts, assets.ts, world.worker.ts}` and
`client/levels/yard.json` are the engine's empty game as its `tools/new-game.mjs` wrote them: a walkable yard on the
engine's coast, with the engine's shipped trees, cliffs and sounds, and a snapshot format of a position and a look. Play
starts it in development. They are to be replaced by Cape Sorrow's own world, rules and parts, and until then keep the
engine's names. Likewise the favicon is a placeholder, and `CREDITS.md` has no entry because the game has no third-party
work of its own yet.
