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
anchor, how far inland of the highway the made ground reaches (320 m), and a grid of the coast's own heights (8 m apart, out to 1.1 km inland and along the shore) that roads out of town are routed over. `siteFor(worldSeed)` (`siteFor.ts`) reads it off
the engine's coast at the cove: the highway's line, and for each sample the shore found by a seaward scan from the highway
and then a fixed number of bisection steps, so every machine finds the same bits. It reads the coast's own ground, as it is
without a town laid over it (`coastGround`), so the site does not move when the town's ground is laid. Where a headland stands
at a sample the shore is the headland's tip; where the cove opens it is the cove's. There is one site, at the engine's cove.

### The plan

`planTown(site, kind)` (`plan.ts`) returns a plain-data `TownPlan`: the history, the plats and the seam between them, the
streets and their ends, the roads out of town, blocks, lots, buildings, the landmarks, the made ground (`fill`), the `quay` and the `spawn`. The stages run in a
fixed order, each on a stream of its own: names, history, plats and streets, lots, buildings, landmarks. The history is drawn
first (`port/history.ts`) and every part of the form is derived from it, so that a difference between two towns has a cause a
player can name. `planFor(worldSeed)` (`planFor.ts`) is the plan on the world's own site, cached. A kind of town is a recipe
(`recipes.ts`) and a folder beside `port/`; the shared code never asks the kind, and only the large port exists. `TOWN_GEN` is
the generator's version (2) and is part of every plan.

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

The streets are the two plats' grids, the wharf street, the rail and alleys where a block has them. Rights of way are those of a small
Northwest town (`ways.ts`): an ordinary street 14 to 16 m with a roadway of 7.5 to 9 m, sidewalks of 1.7 m and a grass verge between
sidewalk and curb (a sidewalk in its place between shops and on the working waterfront); the main street 18 m with 11 m of roadway and
sidewalks of 3.5 m (20, 12 and 4 after a fire); the one avenue 20 m with 12 m of roadway and a painted median; alleys 4 m of gravel with no
sidewalk; nothing is wider than 12 m of roadway beside the highway's 11 m bed. The blocks keep their centre-line sizes, so lots gain the
difference. A grid street runs only as far as the last block it serves (`port/ends.ts` cuts every stub past its last intersection or fronting
lot, with 4 m past the last lot); each end that is no junction is named in `plan.ends` as a landing at the water or a made end, a turnaround or a
barricade. A few roads leave town (`plan.roads`, `port/roads.ts`): from the grid's inland ends a county road to the cemetery on the hill (every
town) and on most an old logging road to a landing, a gravel pit or a water tank, and, where a street on the flats side reaches the grid's end and
there is room, a road along the shore's flats to a landing, a gate or a pit (none of the forty tested seeds has one). Each road is stepped across the
site's ground grid in 12 m steps, the heading turning by exact Pythagorean rotations, costed by the grade along and across it, held to 9 percent a step
and 7 percent over the last 24 m (loosened only where no road is found), and narrows from paved to gravel to two wheel tracks; its destination is a
landmark of no building (`Landmark.at`) and a sentence of the history. Blocks are cut by the shore and the highway; a district's lot rule
(`port/rules.ts`) cuts its lots, with real widths (commercial lots 7.5 to 15 m, house lots 15 m); each lot is built on or left empty, with a kind, an era, a material, a roof and a state (open, vacant or
ruin) that follow from its district and the history. Landmarks reserve their blocks before the lots are cut and are bound to
the buildings that take them afterwards: the FBI office (a leased floor of a federal building or an office block, one block
off the main street), the hotel, the bank, a lodge hall, a depot, the port's terminal, two churches, the high school, the
hospital, and as the history says a customs house, a courthouse and a tsunami refuge. Grids are turned to bearings that are
Pythagorean triples (`bearings.ts`), so a plat's rotation is exact arithmetic.

### The harbour

The made ground along the quay is one convex polygon for each stretch of the quay with water seaward (`plan.quay.wet`), with collinear quay-side edges and no overlap, so the bank along the quay is one smooth slope. `plan.decks` lists every deck over the water (the quay's apron along each wet stretch, piers, the platforms of sheds on piles, the wharf street, and the boat basin's floats and gangways) as an oriented rectangle with the height of its top (`DECK_TOP` 2.6 m, floats `FLOAT_TOP` 0.4 m, a gangway's from one to the other): the one list the walking and the drawing both read. `plan.harbour` (`port/harbour.ts`, its own random stream) holds the rest, decided by the history:

- **The basin and its boats.** One or two main floats parallel to the quay, 22 m out, each reached by a gangway from the apron, with finger floats and slips of three classes. A cannery town or a seafood port keeps a full basin of working boats; a mill, customs or railhead town fewer and more pleasure boats and sailboats; the share of the core's vacant storefronts is also the share of empty slips and the weight of derelicts (a few degrees' list, faded, gear gone) and of one that has sunk at its mooring. Boats (`{ id, kind, x, z, heading, length, beam, draft, state, colour, name, mooring }`; troller, gillnetter, crabber, tug, skiff, sailboat, pleasure; 4.5 to 20 m) lie in slips, alongside piers, a few at anchor, and a tug by the terminal's barge. They do not move.
- **Pilings.** Fields of dead piles (uneven tops, some leaning, gaps) where a closed mill's or a cannery's wharf was pulled down (or an old fish dock), with the year in a sentence of the history's list; dolphins (three piles lashed) off the longer pier ends.
- **The mill's water.** A working mill has a log pond held by a boom of sticks chained between piles, floating logs, and a jack ladder to a jack house; a closed mill's boom is empty and, if the mill is old enough and not cleared, the rusting wigwam burner stands on its site.
- **The terminal.** A yard by what the port handles (decks of logs in trapezoid stacks and perhaps a chip pile, silos and a bulk shed, rows of containers, rows of cars), on the terminal's open lots (the terminal's blocks are built to 42 per cent so there is room), and at the port's wharf (the wharf street's pier, in the cove's deep water) a loaded barge with its tug and, for grain and chips, a loading spout. A terminal the history says is idle (more likely the emptier the town) has an empty yard and no barge.
- **Lights.** A white harbour light on one headland's tip and a day beacon on the other (the tongues are the samples where the site's shore runs far seaward), and a light at the end of the longest pier. Structures only: no lamps are lit.

Depth is not read from the ground (the plan reads the site alone): it is estimated from the distance seaward of the shore, one way in the cove between its headlands and a shallower one outside, and checked in `test/town/harbour.test.ts` against the coast's real floor, which finds about 2 per cent of boat footprint points over a sea stack the site cannot see.

### The ground the game lays over the coast

What the game lays over the engine's coast is `CAPE_PLACE` (`place.ts`), a `CoastOverlay` that the coast is registered with
(`coast.ts`). It is made of:

- **The cover** (`cover.ts`). The made ground follows the plan, not a rectangle: its weight is the smooth union of a window over each block polygon (whole to 16 m beyond a block's edge, falling to nothing over the next 160 m) and a window about the quay's line, found through a 24 m grid so a terrain sample tests only the blocks near it. Beyond it the ground is the coast's own.
- **The made ground** (`ground.ts`). Where the cover holds, the ground is a graded plane over the coast's own, built as before: 2.5 m above the sea at the water's edge, rising at a grade set at each z so that its height at the highway is exactly the highway's grade line, easing to a hill of 4 percent inland of the highway that steepens to 8 percent between 200 and 420 m (where the coast's own hill does), with a bank at the water's edge. It keeps relief: a saturated share of the coast's own height over the plane (0.12 on the flats, 0.2 on the hill, at most 1.2 m either way: the coast's own humps under the town are tens of metres across and several high) and low relief of its own from the engine's derivative-carrying noise (3 m of amplitude on the flats, 2 on the hill, 140 m wavelength). None of it stands on the fill, within 14 m of the quay, within 14 m of the highway or by the water's edge, each opening smoothly. Measured over ten seeds, on the flats a street is at most 11.0 percent steep along its length (typically 0.4), a block rises and falls 1.5 m at most (0.4 typically) and a building's footprint spans 1.5 m at most (0.16); on the hill 8.4 percent (2.6), 7.9 m across a block counting the hill's own grade (3.7), and a footprint 5.4 m at most (0.7), the 17 of 2283 over 2.5 m being the 60 m school and hospital and a few deep shops. Its height and slope are exact derivatives, as the engine's passes are.
- **The fill behind the quay** (`fill.ts`). Where the plan's straight quay lies seaward of the natural shore, one convex polygon of fill for each wet stretch of the quay (`plan.fill`, `plan.quay.wet`) raises the ground to the quay's height over what was sea, with a 6 m bank at the quay's edge: flat, at the quay's height (`levels.ts`, shared with the harbour's decks and apron, which stand a step above it), and exactly as the harbour was built to; the relief window is shut on it and within 14 m of the quay's line, so the apron and every pier's landward end meet the ground. The plan reads the coast's own ground and the made ground reads the plan's fill, so nothing loops. The shore between the site's samples is a monotone cubic spline (`shoreSpline.ts`), so the gradient stays exact.
- **The climb to the massif drawn out** (`blend.ts`). On the coast's own the climb ends 40 to 500 m inland of the shore, so the ground behind the highway would rise tens of metres in the town's first hundred and sixty. Inside a window along the shore the climb ends 1900 m inland (the engine's `blend` hook), so the hill inland of the highway is a slope and not a wall. The highway does not move; its grade line, which follows the ground, comes down with the foot of the hill.
- **The forest by the lot** (`clearing.ts`). The engine asks the place for a feature mask at a tree cell's centre or a ground-cover sample: shut over every street's right of way and 1.5 m of it, every building's footprint and 3.5 m of it (more, by the engine's tree jitter of up to 5 m, since a tree stands off its cell's centre), every paved block (the core, the dock end, the working waterfront, the mill's site, industrial flats, the highway strip) and the cleared places about a road's destination; open on yards (house lots, the churchyard, the school's and hospital's grounds, vacant lots) at 22 percent of the forest's trees and whole for ground cover; whole beyond the outermost blocks, up to the back fences; and no loose rock or driftwood on the town. The engine paints the ground by its height (sand and pebble under 4 m) and gates grass on 7 m and trees on 4 m, and its mask's `meadow` only thickens the grass and `bare` is not read, so a yard on the made flats (2 to 3 m) would paint as the beach's pebble; the place's `shoreStrip` hook says a yard's ground reads 12 m higher to the shore's rules, so a yard paints as grass and bears trees and grass, and `meadow` thickens its lawn. A road clears the forest only to its own width and a ditch, so the trees close over it. The cliff bands are still kept off the old rectangle (the engine hands `cliffKeepD` no seed, so no plan).

Every constant that shapes this ground is in the overlay's tunables, which the engine makes part of the level id.

### How the town is drawn

`client/src/game/town/` turns the plan and the ground's height into plain arrays (positions, normals, vertex colours,
indices), with no renderer, so the builders are tested as pure functions:

- **Streets** (`streetGeometry.ts`): strips cut every 4 m along their length, each street at its true width: two halves of roadway between curbs, a grass verge and a sidewalk down each side as the street's `roadway` and `walk` say (a wharf is a timber deck), each vertex at the ground's height plus a small lift so the layers never share a height. A curb is a strip 4.5 cm over the roadway with its face toward the road; paint is a dashed yellow centre line on streets and the main street, parking stalls along both curbs and zebra crosswalks beside each cross street on the main street, a painted median on the avenue, and a stop bar where a street meets the highway; curb and paint are cut where another roadway crosses them. A crossing is drawn once, by rank. Strips are cut at the edge of the engine's painted highway. The rail is ballast, ties and two rails. Ground under the sea is not drawn.
- **Made ends** (`endsGeometry.ts`): the pavement stops at a clean line and gravel runs beyond for 6 m, a bulb for a turnaround, a barricade of two striped boards on three posts, a timber bumper at a landing.
- **Paved ground** (`groundGeometry.ts`): on each block of a paved district a patch 4.8 cm over the ground in 8 m tiles (a concrete walk in the core, gravel on the dock end, the mill's site and industrial flats, asphalt on the waterfront and the highway strip, which has a row of painted stalls where a whole stall fits clear of the buildings).
- **Roads out** (`roadGeometry.ts`): strips by surface (asphalt, gravel, two wheel tracks) narrowing along the road, and each destination drawn crudely: a cemetery's fence and headstones, a landing's logs, a pit, a tank on legs, a gate.
- **Buildings** (`buildingGeometry.ts`): shells on the plan's oriented rectangles (on sloping ground the floor is the highest ground under the footprint and the walls run down to the lowest), roofs by kind (flat with a parapet, gable, hip, shed), windows and doors, vacant buildings duller and boarded, ruins roofless and broken at the top, and one touch for each landmark (a flagpole and portico for the FBI office, a steeple, an open tower on legs for the refuge, a mill's stack). Colour comes from the material and the building's id; no random call is made.
- **The quay** (`quayGeometry.ts`): along each wet stretch an apron (a deck) and a straight wall a hand's width beyond its edge, so the bank is hidden: timber cribwork under a timber cap, or, where a fire after 1921 took the waterfront, steel sheet piling under a concrete cap (`plan.quay.wall`), with wales or a corrugated face, fender piles every 6 m, ladders every 40 m and bollards every 15 m.
- **Decks and rails** (`pileGeometry.ts`): each deck of `plan.decks` with its top at exactly the height the walking uses, a skirt, and piles for piers and sheds; a timber bull rail with posts along every edge the simulation holds a walker back from.
- **Boats and the harbour's things** (`boatGeometry.ts`, `harbourGeometry.ts`): hulls lofted through six stations with a sheer line, wheelhouses with dark windows and the kind's gear; piles, boom sticks and logs, the jack ladder, the burner, the yard's stacks, silos, containers and cars, the barge, and the lights.
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

### The railroad and the power line

The railroad's main line runs the whole coast, beside the highway on its seaward side (`rail.ts`: the highway's centre less `RAIL_OFFSET`, 16 m), and the power line runs beside the highway on its inland side. Neither begins or ends at the town: the town's own tracks leave the main line, and its streets cross it.

- **The bed** (`railGround.ts`, composed into the place's `shapeD` after the town's ground). The engine lays the highway's corridor over a place's ground within 30 m of its centre, which takes in the line, so the bed answers `staged + k (g - staged)`, `g` the grade line and `k` the bed's weight: the corridor's own weight then cancels and the ground the engine draws is `(1 - k) N + k g`. The bench is exactly the highway's grade line for that z (`RAIL_BENCH_HALF` 2.75 m either side, flat across, the grade line's slope along), falling or rising to the land over a bank whose width grows with how far the grade line stands from the land (2 m on level ground, up to 30 m, cubic ease), so a cut or a fill is never needlessly steep. The gradient is exact (tested against finite differences) and a sample farther than `RAIL_REACH` (33 m) of the line returns the town's answer as the same object after one comparison. Measured on ten seeds along 6 km: the bench differs from the grade line by under 4e-15 m; the shaping stage costs 0.07 us far from the line (as before), and 0.16 us on and beside it against 0.05 to 0.07 before, of a whole terrain sample of 1.2 us.
- **The sea** (`railSpans.ts`). Where the ground at the line's centre, as the engine would leave it with no railroad, is under 0.4 m, a run of such points (merged across gaps under 24 m) is a span, cached in chunks of 256 m so a terrain sample does not scan the coast: a causeway (the bench as fill, drawn with riprap) where it is under 2.5 m deep and 60 m long, otherwise a trestle (the ground is left, the bed's weight is taken away over 10 m at each end, and the track is carried on a deck: `railDeck.ts` makes the deck floor, like the harbour's, and holds a walker inboard of its guard rails). The natural coast does not reach the line: over 400 seeds that plan a town, along 18 km of coast each, the lowest ground at the line is 1.5 m, so no causeway or trestle stands on it; both are tested with spans laid by hand.
- **Nothing grows on it** (`railClearing.ts`, composed into the place's `featureMask`). Trees are shut within the corridor's 5 m and a tree's jitter of 3.5 m (a trunk stands up to that far from its cell's centre), opening over 3 m; ground cover within the corridor and 1.5 m, opening over 2 m; loose rock and driftwood as trees (a rock's cell is wider).
- **The track drawn** (`railGeometry.ts`, `railParts.ts`). Cells of 128 m along z, each a pure function of the seed and the cell's index, in three levels: the full cell (ballast with sloped sides and a skirt into the bench, gravel shoulders, ties every 0.55 m as boxes, rails with foot, web and head, crossings, trestles, poles with crossarms and wires), the plain one (no ties, 16 m cuts) and the far one (a ballast strip and poles, 32 m cuts). A rail's head is 0.36 m over the bench, its gauge 1.435 m, so a spur can meet it. `railParts.ts` is a part of the renderer's side that `townParts.ts` makes: each frame it wants every cell within 4300 m of the camera (the fog is 4000 m in clear weather) at the level its distance gives (full within 260 m, plain within 1300 m, with 60 m of room before a level changes), begins a job of the engine's scheduler for each (one owner a cell, at most four begun at once, nearest first, held for the engine's streamed upload budget), culls by the view's planes as the town does, and releases cells past 4700 m. At the town's start that is about 68 cells, 88 meshes, 67 thousand vertices and 33 thousand triangles (the town's own is 80 batches, 210 thousand vertices, 105 thousand triangles); the slowest cell takes under 2 ms to make.
- **Crossings** (`railCrossings.ts`). `crossingsFor(plan, seed, anchor)` finds where each street and road out crosses the line by bisection along its segments (the plan's list will replace it behind the same call): a panel carries the roadway over the rails flush with their heads on ramps either side, crossbucks stand on posts on the right of each approach, and a stop line crosses the lane that comes from the highway's side.
- **The power line** (`powerLine.ts`). Poles every 45 m (nudged by a hash of their index) at 9 m inland of the highway's centre, moved along the line to the nearest place clear of any street's roadway; each carries a crossarm with three insulators and three wires to the next pole, as sagging ribbons. Structures only.

### Known limits

- One kind of town (the large port) and one site, at the engine's cove. The recipe structure is there for others; none is written.
- The names (the town's, the streets', the founder's, the hotel's, the mill's) are authored placeholders in ordinary English, Scots, Scandinavian and Spanish-looking words, not sourced. The building mixes and their shares are authored, and so is the order of uses along the working waterfront (lumber docks and warehouses, the terminal, the wharf street and depot, warehouses, then the canneries and the rough dock end): the research found no source for either. The history's dates and shares follow the research on Washington ports; the rest of the numbers are authored.
- The harbour is plan data and structures: boats do not move or bob, no lamp is lit, bollards, fenders, ladders and boats are not solid, a gangway is not a ramp the rules know beyond its floor, and the depth under a boat is estimated from the shore alone, so a sea stack can stand under one now and then. The mill's pond sits on the coast's shallow flats, where the logs lie near the bottom. The boat names, colours, slip classes, the yard's items and the share of terminals idle are authored, not sourced.
- No lamps and no interiors: buildings are shells, and a door is drawn, not opened. Barricades, bumpers, fences, headstones and tanks are drawn, not walls.
- The made ground holds the highway's grade line and the quay's height, so its relief is modest on the flats (a block rises and falls half a metre) and rolls on the hill; its edge, where it meets the coast's own hill, fades over 160 m. A building 60 m wide on the hill's grade spans up to 5.4 m of height.
- Yards have few trees: a trunk keeps 3.5 m from a building, and a tree stands up to 5 m from its cell's centre, so only a yard's open middle bears one. The cliff bands are kept off the old rectangle whether or not the plan built there.
- A road along the shore's flats is planned but no tested seed has room for one; the destinations are crude and stand on the ground as it is, not graded.
- The railroad: on the coast's cliffs the line, 16 m seaward of the highway and at its grade line, sometimes stands on a ledge over the land's own steep face (a fill of 9 m at the worst of ten seeds along 6 km), where the bank saturates and a wall of the land's own steepness shows; the line is drawn level across, with ties and rails that do not follow a bank. A crossing's panel spans the whole right of way and is flat shaded (no joints), its crossbucks are two boards on a post with no lights or bells, and a tie is a box that does not tilt with the grade (under 2 cm). A trestle and a causeway are built and tested but the natural coast has none. The power line's poles are straight and unlit.
- No Native places or people are generated, by decision, until they can come from the nations' own sources; no name in the generator is a Native word.
- The town is an unreleased generator: `TOWN_GEN` is 3, and its digests are replaced when it changes until a first release.

## The title page

Built in `client/src/game/` in the visual language of Day Hike's title page (the same dark ground and vignette, the
monospace type, the filled and hollow buttons, the panel slide, the focus and `inert` handling), with no background still
or loop and no downloads, join box or update banner, since there is no desktop app.

- `words.ts` holds every word the page says that is the game's own, as constants.
- `landingModel.ts` decides what the page shows, as data, so the decisions are tested without a DOM: the quiet line
  `In development.` on every build while the game is that, and under it Play, `Loading…` while the world builds, or
  `Waiting for the host…` for a follower. Play is offered whether or not the build was given a signaling address: with no
  server the game is played alone, and the engine's shell shows no party.
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
