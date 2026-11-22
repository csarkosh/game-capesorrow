# Architecture

Cape Sorrow is a game on [`@csarkosh/engine`](https://github.com/csarkosh/engine), which draws the world, runs the
netcode and the deterministic simulation, and owns the page. The game gives the engine's shell one page definition and
one identity, and lays two things of its own over the engine's world: a generated port town, and the title page. The
game's rules are still the engine's walking and nothing else. This file says what is true of the repository today, in
the order the pieces depend on each other: the engine and what the game hands it, the town, the title page, hosting, and
what is still scaffold and unfinished.

## The engine and what the game hands it

The game installs the engine as a release's tarball (the address in `client/package.json`; it is on v0.2.6). The engine
makes the world from a seed: the coast (the engine's `olympic` terrain, with its cove, its highway and its massif), the
forest and the clutter on it, the weather and the sky. A game registers the coast with a place laid over it, and the
world is then the engine's coast with that place's ground.

`client/src/main.ts` registers the shipped files and the terrain (`terrain.ts`, which imports `coast.ts`, which registers
the coast with `CAPE_PLACE`: see "The ground the game lays over the coast"), then calls the engine's `startShell` with
`CAPE_PAGE` (`client/src/page.ts`), a `PageGame`:

- `game`: the game a session is of (`EMPTY_GAME`, `client/src/game.ts`). Its renderer is the engine's, made with the town's renderer part (`townParts`), its start is the town's (`townStart`), and its rules (`WALK_RULES`, `client/src/sim.ts`) are the engine's walking, with two things set: `constrain` is the town's buildings as walls, and `spawn` searches out from the town's start for the first place a hull stands free.
- `side`: the game's own of the page (`createCapePage`), which the shell calls at the page's own points: it shows the title page, repaints it, shows a panel by its address, and keeps the mode. Nothing plays before a session starts.
- `identity` (`client/src/identity.ts`): the game's name, its word for a session (`case`), what a nameless player is called (`Detective`), and the prefix of everything it keeps in the browser (`capesorrow`).
- `away`: what the page for a visitor whose browser cannot play shows of the game: no still, and the same credits the Credits screen shows.
- `protocol`, `worldWorker`, `statusLine`, `scene`, `probeState`: the session's wire version, the worker that makes its world (`world.worker.ts`, handed the town's start and the chunk cells its first spawn reads, `townSpawnCells`), a line of status, the staged scenes (none), and the state the tier check measures the renderer on.

## The town

The town is simulation code in `client/src/sim/town/`: every machine computes the same town from the world's seed, with
nothing sent over the wire. The folder's rules (the arithmetic allowed, no trigonometry, bearings as triples, one random
stream per stage, `TOWN_GEN`) are in `AGENTS.md`, and `client/test/architecture.test.ts` and `client/test/town/banned.test.ts`
enforce them.

### The site

A plan is made from a `TownSite` (`site.ts`) and nothing else of the ground: the town's own seed (the world's, mixed with
which town this is), an anchor on the highway's centre line, and, in the town's own frame (origin at the anchor, +x
inland, +z north, metres), the shoreline's x and the highway's x sampled every 16 m along z, 512 m either way of the
anchor, and how far inland of the highway the made ground reaches (320 m). `siteFor(worldSeed)` (`siteFor.ts`) reads it off
the engine's coast at the cove: the highway's line, and for each sample the shore found by a seaward scan from the highway
and then a fixed number of bisection steps, so every machine finds the same bits. It reads the coast's own ground, as it is
without a town laid over it (`coastGround`), so the site does not move when the town's ground is laid. Where a headland stands
at a sample the shore is the headland's tip; where the cove opens it is the cove's. There is one site, at the engine's cove.

### The plan

`planTown(site, kind)` (`plan.ts`) returns a plain-data `TownPlan`: the history, the plats and the seam between them, the
streets, blocks, lots, buildings, the landmarks, the made ground (`fill`), the `quay` and the `spawn`. The stages run in a
fixed order, each on a stream of its own: names, history, plats and streets, lots, buildings, landmarks. The history is drawn
first (`port/history.ts`) and every part of the form is derived from it, so that a difference between two towns has a cause a
player can name. `planFor(worldSeed)` (`planFor.ts`) is the plan on the world's own site, cached. A kind of town is a recipe
(`recipes.ts`) and a folder beside `port/`; the shared code never asks the kind, and only the large port exists. `TOWN_GEN` is
the generator's version and is part of every plan.

On the real coast the shore runs near north to south, the highway stands 70 to 270 m inland of it, and at the cove two narrow
headlands run out to sea, so the cove is a natural harbour. The old plat stands at the cove behind a straight quay, partly on
made ground; the land company's compass plat wraps around it; the mill and the public port's terminal take the flats' shore;
the highway, which the engine paints and the town does not draw over, runs through, and blocks keep clear of it. A plan has 30
to 55 blocks and 220 to 420 buildings (`client/test/town/size.test.ts`).

How the history decides the form:

| In the history | In the plan |
|---|---|
| What the town was founded for (sawmill, cannery, customs act, railroad bet) and when | The town's name, the founder's, and with a customs act a customs house among the landmarks |
| What the first plat was laid to: the wagon road that became the highway, or (where the highway runs near north) the line of the first wharf or a railroad's survey | The old plat's bearing: the highway's own line, or one 22 to 37 degrees off the compass; so the highway is the old main street, or cuts across the old blocks |
| The second plat, a land company's or a railroad's, laid to the compass | The compass plat wrapped around the old one; where the two bearings differ by 25 degrees or more, a seam where the grids do not line up |
| A railroad, and when | A rail line along the quay and the flats' shore, between the water and the town, and a depot at the wharf street; none without a railroad |
| A fire, and whether it took the waterfront too | A core of the later era and material (brick, or concrete after 1921), the main street widened; without a fire an older core, some of it in wood |
| The 1893 bust | More vacant buildings, and a boom-era hotel never filled |
| The county seat | A courthouse on the hill if the town is the seat, and none otherwise |
| The public port after 1911, what it handles | A terminal on the flats |
| The mill: which side, when it opened, closed or working, cleaned up or not | The mill's site on the north or south flats; a closed mill's site has no open mill building, a cleared one fewer buildings than a fenced one |
| The present-day layer | The core's vacant share, a tsunami refuge on the hill or not, a strip of motels and big stores along the highway or not |

The streets are the two plats' grids, the wharf street, the rail and alleys where a block has them; blocks are cut by the
shore and the highway; a district's lot rule (`port/rules.ts`) cuts its lots, with real widths (commercial lots 7.5 to 15 m,
house lots 15 m); each lot is built on or left empty, with a kind, an era, a material, a roof and a state (open, vacant or
ruin) that follow from its district and the history. Landmarks reserve their blocks before the lots are cut and are bound to
the buildings that take them afterwards: the FBI office (a leased floor of a federal building or an office block, one block
off the main street), the hotel, the bank, a lodge hall, a depot, the port's terminal, two churches, the high school, the
hospital, and as the history says a customs house, a courthouse and a tsunami refuge. Grids are turned to bearings that are
Pythagorean triples (`bearings.ts`), so a plat's rotation is exact arithmetic.

### The ground the game lays over the coast

What the game lays over the engine's coast is `CAPE_PLACE` (`place.ts`), a `CoastOverlay` that the coast is registered with
(`coast.ts`). It is made of:

- **The made ground** (`ground.ts`). The town stands on fill, as the real ports of this coast do. Inside its footprint (480 m north and south of the cove, 320 m inland of the highway) the ground is a graded plane over the coast's own: 2.5 m above the sea at the water's edge, rising inland at a grade set at each z so that its height at the highway is exactly the highway's grade line, and easing to a hill of constant grade (0.06) inland of the highway. Outside the footprint the ground is the coast's own, with a blend of 40 m between; at the water's edge the fill ends in a bank down to the coast's own ground. Its height and slope are exact derivatives, as the engine's passes are.
- **The fill behind the quay** (`fill.ts`). Where the plan's straight quay lies seaward of the natural shore, convex polygons of fill (`plan.fill`) raise the ground to the quay's height over what was sea, with a 6 m bank at the quay's edge. The plan reads the coast's own ground and the made ground reads the plan's fill, so nothing loops. The shore between the site's samples is a monotone cubic spline (`shoreSpline.ts`), so the gradient stays exact.
- **The climb to the massif drawn out** (`blend.ts`). On the coast's own the climb ends 40 to 500 m inland of the shore, so the ground behind the highway would rise tens of metres in the town's first hundred and sixty. Inside a window along the shore the climb ends 1900 m inland (the engine's `blend` hook), so the hill inland of the highway is a slope and not a wall. The highway does not move; its grade line, which follows the ground, comes down with the foot of the hill.
- **The forest cleared** (`clearing.ts`). No cliff band, tree, ground clutter or loose rock stands on the made ground, all returning over the blend (`cliffKeepD` and `featureMask`, the overlay's hooks), and the clutter keeps clear of a clearing about the player's start.

Every constant that shapes this ground is in the overlay's tunables, which the engine makes part of the level id.

### How the town is drawn

`client/src/game/town/` turns the plan and the ground's height into plain arrays (positions, normals, vertex colours,
indices), with no renderer, so the builders are tested as pure functions:

- **Streets** (`streetGeometry.ts`): strips cut every 4 m along their length and into bands (two halves of carriageway and a sidewalk down each side on main streets, avenues and streets; a timber deck for the wharf), each vertex at the ground's height plus a small lift so the layers never share a height. A crossing is drawn once, by rank. Strips are cut at the edge of the engine's painted highway. The rail is ballast, ties and two rails. Ground under the sea is not drawn.
- **Buildings** (`buildingGeometry.ts`): shells on the plan's oriented rectangles, roofs by kind (flat with a parapet, gable, hip, shed), windows and doors, vacant buildings duller and boarded, ruins roofless and broken at the top, and one touch for each landmark (a flagpole and portico for the FBI office, a steeple, an open tower on legs for the refuge, a mill's stack). Colour comes from the material and the building's id; no random call is made.
- **The quay, piers and the wharf** (`pileGeometry.ts`): the quay as an apron, a low curb and a face down into the water; piers, the decks the terminal's sheds stand on, and the wharf street's deck, each on rows of piles.
- **Batches** (`townGeometry.ts`): by cells of 128 m, one set of arrays for what lies flat and one for what stands, built as a generator of slices the engine's scheduler spreads over frames, so no frame stalls on the town.

`townParts.ts` is the renderer part: a `RenderGame` that wraps the engine's `noParts` and, once the scene is registered, makes
a Lite mesh of each batch as a job of the scheduler, the cells nearest the start first, under the engine's air and wet look as
its props are, with the flat layer drawn a depth step ahead of the terrain. Lite culls no mesh, so each frame shows a cell's
meshes while its bounding sphere is in the view's planes. The standing meshes are registered as hard cover for the rain (on
the tiers above low). The low tier builds its buildings without the upper storeys' windows, the frames and the sills; the
geometry is otherwise the same on all three tiers. One thing to know of Lite: its PBR pipelines are built when the scene is
registered, and know vertex colours only if a mesh of the scene had them then, so `townParts` stands one hidden triangle of no
size with a colour a vertex in the scene from the start (`early`), as the engine's lake panorama does.

### How the town is collided with

The engine's colliders are axis-aligned boxes and the old plat's grid is turned, so `townConstrain` (`sim/town/solid.ts`, the
rules' `constrain`, which runs on every machine after a player's move) collides a hull of 0.4 m radius in plan with each
building's exact oriented rectangle: out along the direction of least penetration (a corner pushes along the line from the
corner, a centre inside is taken out by the nearest side), the velocity's part into the wall removed so a walker slides, a fixed
eight passes for two walls meeting. A grid of 16 m cells, built once per world seed, names the few buildings near a place. A
building is a column from the ground to the sky; nothing reads the player's height. Buildings of no lot (the piers and the sheds
on piles) are not solid.

### Where the player starts

The plan's `spawn` is on the street side of the FBI office's door, 2 m out, facing away from the building (`port/landmarks.ts`).
`townStart(worldSeed)` (`start.ts`) is that place in world coordinates, the site's anchor plus the spawn, with its yaw. The
session's `startOf`, the world's worker and the rules' spawn all name it, so every peer agrees with nothing exchanged, and the
rules search out from it for the first place a hull stands free. The map page (`client/town.html`, `client/src/townMap/`; see
`AGENTS.md`) draws plans and a contact sheet of consecutive seeds in development, and is not part of the build.

### Known limits

- One kind of town (the large port) and one site, at the engine's cove. The recipe structure is there for others; none is written.
- The names (the town's, the streets', the founder's, the hotel's, the mill's) are authored placeholders in ordinary English, Scots, Scandinavian and Spanish-looking words, not sourced. The building mixes and their shares are authored, and so is the order of uses along the working waterfront (lumber docks and warehouses, the terminal, the wharf street and depot, warehouses, then the canneries and the rough dock end): the research found no source for either. The history's dates and shares follow the research on Washington ports; the rest of the numbers are authored.
- Pier and wharf decks are drawn but cannot be walked on: the rules treat piers and sheds on piles as no wall and give the deck no floor.
- No lamps, no street markings and no interiors: buildings are shells, and a door is drawn, not opened.
- No Native places or people are generated, by decision, until they can come from the nations' own sources; no name in the generator is a Native word.
- The town is an unreleased generator: `TOWN_GEN` is 1, and its digests are replaced when it changes until a first release.

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
outside, including that Day Hike is as it was. The map page is not in the build. There is no server deployed and no
infrastructure of this game's own, so the public page says `In development.` and Play is offered in development only.

## What is still scaffold

`client/src/{hud.ts, net.ts, assets.ts}` and `client/levels/yard.json` are the engine's empty game as its
`tools/new-game.mjs` wrote them and are unchanged: a HUD of a line of status, a snapshot format of a position and a look, the
engine's shipped trees, cliffs and sounds (the game has no shipped files of its own), and the level a forest world must carry,
with no brushes. The walking rules keep the engine's names (`WALK_*`, `EMPTY_GAME`), and `sim.ts`, `game.ts` and
`world.worker.ts`, which now carry the town, are still the scaffold's files in shape. They are to be replaced by Cape Sorrow's
own rules and parts: there is no case, no people, no sound of the game's own, and nothing to do in the town but walk. Likewise
the favicon is a placeholder, and `CREDITS.md` has no entry because the game has no third-party work of its own yet.
