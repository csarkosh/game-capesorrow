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

## The town plan

A town is made from its history. `planTown(site, kind)` (`client/src/sim/town/plan.ts`) takes a `TownSite` (the shoreline and the highway as samples, and nothing else of the ground) and a `TownKind` and returns a plain-data `TownPlan`: the history, the plats and the seam between them, the streets, blocks, lots, buildings, the landmarks and the spawn. The history is drawn first (what the town was founded for and when, who laid which plat to what, the railroad, a fire, the 1893 bust, the county seat, the public port, the mill's fate, the present-day layer) and every part of the form is derived from it, so that a difference between two towns has a cause a player can name. A kind of town is a recipe (`recipes.ts`) and a folder beside `port/`; the shared code never asks the kind.

On the real coast the old plat stands at the cove behind a straight quay, partly on made ground (`plan.fill`, `plan.quay`); the land company's compass plat wraps around it, the mill and the public port's terminal take the flats' shore, and the highway runs through. The plan is made on every machine when a world starts, so it is simulation code: only exactly specified arithmetic, grid bearings as Pythagorean triples, and one independent random stream per stage, so that a draw added in one stage changes no other. `TOWN_GEN` names the generator's version and is part of the plan. `client/town.html` (development only) draws plans and a contact sheet of consecutive seeds.

## The town in the world

The plan is drawn and collided with by the game's own code, on top of the engine's world.

- **Solid.** The engine's colliders are axis-aligned boxes and the old plat's grid is turned, so `townConstrain` (`client/src/sim/town/solid.ts`, the rules' `constrain`) collides a hull of 0.4 m radius in plan with each building's exact oriented rectangle: out along the direction of least penetration (a corner pushes along the line from the corner), the velocity's part into the wall removed so a walker slides, a fixed eight passes for two walls meeting. A grid of 16 m cells names the few buildings near a place. Piers and the sheds on piles (buildings of no lot) are not solid.
- **Drawn.** `client/src/game/town/` builds, with no renderer, plain arrays (positions, normals, vertex colours, indices) for the streets (strips cut every 4 m on the ground plus a small lift; a crossing is drawn once by layers; cut at the edge of the engine's painted highway), the buildings (shells, roofs by kind, windows, doors, vacant and ruined states, a touch for each landmark), the quay, the piers and their piles, batched by 128 m cells into one mesh for what lies flat and one for what stands. `townParts.ts` is a `RenderGame` that wraps the engine's `noParts` and, once the scene is registered, makes a Lite mesh of each batch as a job of the engine's scheduler, under the air and the wet look as the engine's props are, culled by the view's planes (Lite culls no mesh), the standing meshes registered as hard cover for the rain.
- **One thing to know of Lite.** Its PBR pipelines are built when the scene is registered, and know vertex colours only if a mesh of the scene had them then: `townParts` stands one hidden triangle of no size with a colour a vertex in the scene from the start (`early`), as the engine's lake panorama does.

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
engine's names. Two of them already carry the town: `sim.ts`'s rules have a `constrain` (the buildings are walls) and
`game.ts`'s renderer is made with `townParts`. Likewise the favicon is a placeholder, and `CREDITS.md` has no entry because the game has no third-party
work of its own yet.
