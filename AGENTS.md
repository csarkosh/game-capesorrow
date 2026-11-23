# game-capesorrow — working context

Cape Sorrow is a game in which a detective investigates paranormal reports across the Pacific Northwest, in an open,
procedurally generated coastal Washington. It is part PNW life and detective sim, part supernatural horror.

It is built on [`@csarkosh/engine`](https://github.com/csarkosh/engine), as its sister game Day Hike is, and is served
at [games.csarko.sh/capesorrow](https://games.csarko.sh/capesorrow). What exists is a title page, and, behind Play, a
generated port town on the engine's coast: Play starts the agent at the door of the FBI office, with
the town's streets and buildings to walk through, and the buildings are walls. The game's rules are still the engine's
walking and nothing else: no case, no people, no sound or interface of the game's own. The public page says "In
development." and offers Play under it, played alone until there is a server. See [`README.md`](README.md) for what it is and [`ARCHITECTURE.md`](ARCHITECTURE.md) for how it is built.

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
| `client/` | The game: `package.json` (the engine, installed from a release's tarball), `index.html`, `town.html` (the dev-only map page), `src/`, `test/`, `levels/`, `public/`, `vite.config.ts`, `tsconfig.json`. See the next rows. |
| `client/src/` | **Cape Sorrow's own:** `main.ts` (starts the engine's shell with the page definition), `page.ts` (`CAPE_PAGE`, the definition the shell is handed, and `createCapePage`, the game's own of the page), `identity.ts` (the game's name, word for a session and storage prefix). **Carrying the town:** `coast.ts` (registers the engine's coast with `CAPE_PLACE` laid over it), `terrain.ts` (the world's passes, importing `coast.ts`), `sim.ts` (the rules: the engine's walking, with `constrain` set to the town's buildings and the spawn searched out from the town's start), `game.ts` (the session's game: the engine's renderer made with `townParts`, and the start), `world.worker.ts` (the world's worker, handed the town's start and the cells its first spawn reads). **Still the engine's empty game, unchanged** (written by the engine's `tools/new-game.mjs`): `hud.ts`, `net.ts`, `assets.ts` and `client/levels/yard.json` (the level a forest world must carry, with no brushes), and the walking rules' own names (`WALK_*`, `EMPTY_GAME`), which stay as they are until the game's rules replace them. The files that carry the town are still the scaffold's files in name and shape. |
| `client/src/game/` | The title page, in Day Hike's visual language and with no background: `words.ts` (every word the page says that is the game's own, as constants), `landingModel.ts` (what the page shows, as data: whether the build can play, Play or "In development.", the Settings page, the panel focus rule), `landing.ts` (paints the model: the styles and the DOM), `credits.ts` (the credits the Credits screen and the turned-away page show). The town drawn is in `game/town/`, next row. |
| `client/src/sim/town/` | The town, as pure deterministic simulation code that every machine computes alike (no DOM; the rules are under [The simulation's rules](#the-simulations-rules)). The plan: `site.ts` (the `TownSite` a plan is made from: the shore and the highway as samples, and a grid of the coast's own heights), `siteFor.ts` (`siteFor(worldSeed)`: the site read off the engine's coast at the cove, on the highway, cached), `land.ts` (what the plan knows of the land, derived once per site from that grid: height, slope, whether a cell is buildable, and how much land there is), `rail.ts` (where the railroad's main line runs: the world's, and the plan keeps its corridor clear), `plan.ts` (`planTown(site, kind)`), `planFor.ts` (`planFor(worldSeed)`: the plan on that site, cached), `recipes.ts` (one recipe per `TownKind`; only `port` exists), `types.ts`, `version.ts` (`TOWN_GEN`), `rng.ts` (one seeded stream per stage), `bearings.ts` (grid bearings as Pythagorean triples), `geom.ts` (plane geometry), `shore.ts` (the shore and the highway read from a site), `lots.ts` (cutting a block into lots), `ways.ts` (a street's right of way: its roadway, sidewalks and verge), `lotIndex.ts` (which lot a point is in), `yardShapes.ts` (where a lot's drive and front walk lie), `streetField.ts` (how the ground sits under the streets: the roadway cut down by the curb's height, the trough under the pavement, the ditch, and the walking field `withStreets`), `junctions.ts` and `junctionShape.ts` (where streets meet: each junction's legs, corners, kind, control, marked crosswalks and ramps, `plan.junctions`, and the shapes of its pavement and corners), `names.ts` (placeholder names), and `port/` (the large port: `history.ts` first, then `layout.ts` for the two plats, the made ground, streets and blocks (the old plat laid at the best landing, the company's blocks taken over the land by `growth.ts`, which spends the history's block budget on the cheapest land first), `stairs.ts` for the public stairs where a street would climb over 15 percent, `spur.ts` for the town's own track curving from the main line, `outskirts.ts` for the single buildings past the last blocks, `ends.ts` for cutting streets back to what they serve and naming their ends, `trim.ts` for cutting them back again to what the buildings serve once the buildings stand, `roads.ts` for the roads out of town and where they go, `rules.ts` for the lot rules, `buildings.ts`, `edges.ts` for what stands beside each street (which sides have a sidewalk and a curb, the pours and their decades, the curb's height, the repaving: decided by the history), `yards.ts` for how each lot's ground is kept, `props/` for what stands in the streets, yards and docks (vehicles, boat trailers, utility poles and wires, fences, bins, mailboxes, gear: `index.ts` the stage, `tuning.ts` every authored number, `context.ts` the lots, streets and keep-out boxes it reads, `boxes.ts`, `vehicles.ts`, `poles.ts`, `fences.ts`, `yardProps.ts`, `dedupe.ts`; `plan.props`, its own stream `props`), `landmarks.ts` with the spawn at the FBI office's door, `decks.ts` for the apron, piers and wharf as decks, `harbour.ts` for the boat basin, boats, pilings, the mill's water, the terminal's yard and barge, and the lights, and `business/` for what is in the buildings: `trades.ts` (the trades and their counted mix), `index.ts` (units, tenants, past tenants, rooms and windows above), `units.ts`, `tenants.ts`, `signs.ts`, `interiors.ts`, `windows.ts`; its data is `plan.uses`, with its own stream, `business`, and `game/town/` draws all of it). The ground the game lays over the coast: `place.ts` (`CAPE_PLACE`, the overlay the engine's coast is registered with), `ground.ts` (the made ground: a graded plane over the coast's, keeping relief), `cover.ts` (how much the plan's blocks cover a place), `fill.ts` (the fill behind the quay, read from the plan), `shoreSpline.ts` (the site's shore between its samples), `blend.ts` (the coast's climb to the massif drawn out behind the town: how far inland it ends, over how long a stretch of coast and where, drawn from the world's seed), `reading.ts` (whether the site is being read), `clearing.ts` (the forest, ground cover and loose rock kept off or let into the town by the lot, the yard weight the engine's shore rules read, and the cliff bands kept off where the town's cover holds and along the roads out). Where the player is: `start.ts` (`townStart`), `spawnCells.ts` (the chunk cells the first spawn reads), `solid.ts` (the buildings as oriented rectangles the player is pushed out of, and the harbour's rails held to: `townConstrain`), `propSolid.ts` (the props' boxes, pushed out of first, the walls last), `decks.ts` (the decks over the water as ground: `deckTopAt`, the wrapped ground field `withDecks`, the rails), `levels.ts` (the quay's, decks' and floats' heights and the apron's width), `hull.ts` (the hull's radius). |
| `client/src/townMap/`, `client/town.html` | The map page for looking at plans, served by the dev server at `/town.html` and not part of the build (see [Looking at towns](#looking-at-towns)): `svg.ts` (`planSvg`, `sheetSvg`, pure; each unit's frontage and name, the names shown when zoomed in), `main.ts` (the page: the real coast of a world seed, its history, legend, counts, the businesses by street, and the contact sheet), `realSite.ts` (the world's own site for a world seed, the made ground's reach inland held to at least 320 m; the page and the tests use it), `syntheticSite.ts` (a wavy shore with a cove and a bending highway from a seed, for `?site=synthetic` and a few odd-shape tests). |
| `client/src/game/town/` | The town drawn: pure geometry builders that turn the plan and the ground's height into plain arrays (`meshBuilder.ts`, `streetGeometry.ts` for streets with their curbs, verges and ramps, `junctionGeometry.ts` and `junctionPaint.ts` for each junction's one pavement, curb returns, corners and paint, `signGeometry.ts` and `signFont.ts` for STOP signs, street-name blades and the rest, `surface.ts` for the flat surfaces and the roadways that overlap none, `junctionWorld.ts`, `endsGeometry.ts` for the made ends of streets, `groundGeometry.ts` for the paved ground between buildings, `roadGeometry.ts` for the roads out and their destinations, `buildingGeometry.ts` (the shell and its roof, and the order the rest is drawn in), `buildingKit.ts` (a wall as a frame, `cutWall`, quads and boxes on a wall), `openingsGeometry.ts` (every wall's holes and what fills them), `frontGeometry.ts` (a commercial front from its units), `roomGeometry.ts` (the room behind a unit's glass: its furnishings and lights, lit by the room's baked light), `roomLight.ts` (the light field of a room: its lights, the day, shadows), `roomShell.ts` (the floor, walls and ceiling as lit grids on the town's layers), `roomDressing.ts` (what a trade hangs on its walls and stands in its window), `roomKit.ts`, `windowDressing.ts` (blinds as slats, curtains, paper as sheets), `windowGeometry.ts` (a window with depth: frame, glass, a shallow room, curtains, blinds, a fan, an air-conditioner), `shopSigns.ts`, `signStyle.ts`, `signAtlas.ts` and `signPaint.ts` (the signs: their forms, their lettering's faces and colours, the atlas as a plan of rectangles, and the canvas that paints it), `buildingWear.ts` (wear by cause), `buildingParts.ts` (porches, chimneys, additions, rooftop units, canopies, by kind and history), `pileGeometry.ts` for decks, piles and bull rails, `quayGeometry.ts` for the quay's apron, wall, fenders, ladders and bollards, `boatGeometry.ts` for boats, `harbourGeometry.ts` for pilings, the log pond, the burner, the terminal's yard and barge and the lights, `stairGeometry.ts` for public stairs as steps with a handrail, `props/` for the props drawn (`vehicleGeometry.ts` and `vehicleStyle.ts` for vehicles lofted through stations with arches cut, glass over a dark cabin and wear by cause; `trailerGeometry.ts` boat trailers, boats, tarps and weeds; `poleGeometry.ts` poles, wires and service drops; `fenceGeometry.ts`; `yardPropGeometry.ts` bins, mailboxes and gear; `kit.ts` places on the ground that pitch and roll with it; `index.ts`), `walkGeometry.ts` for a sidewalk's slabs, joints, cracks, heave and weeds, `roadWear.ts` for utility cuts, sealed cracks, potholes, the gutter's band, manholes and drains, `yardGeometry.ts` for drives, front walks, bare and mossy patches and the worn verge, `groundNoise.ts` and `groundTally.ts` (the hashes the wear is drawn from, and a count of what was laid), `townGeometry.ts` for the batches by 128 m cell, `palette.ts`, `townTypes.ts`), the textures' side of it (`townLayers.ts`: the manifest as data; `townSurface.ts`: a polygon's surface, its UV frame in metres and its wear; `buildingSurfaces.ts` and `groundSurfaces.ts`: which layer a building or a flat colour of the ground wears), and `townParts.ts`, the renderer part that makes a Lite mesh of each batch under the town's material plugin (`townMaterial.ts`), the textures' arrays (`townTextures.ts`) and the engine's air and wetness. See ARCHITECTURE.md, "How the town is drawn" and "The town's textures". |
| `client/src/sim/town/rail*.ts`, `powerLine.ts`, `client/src/game/town/rail*.ts` | **The railroad's main line and the power line, for the whole coast** (see ARCHITECTURE.md, "The railroad and the power line"). Simulation: `rail.ts` (the line's centre, the contract), `railGround.ts` (the bench graded at the highway's grade line, laid over the place's ground; `RAIL_REACH`, the bank), `railSpans.ts` (where the line meets the sea, by chunk: causeways and trestles), `railClearing.ts` (the feature mask shut along the line), `railBank.ts` (the bench's and the bank's widths, which the plan keeps its blocks clear of), `railSpur.ts` (the town's spur as the world has it: its polyline, the heights of its bed, its trestles), `railDeck.ts` (a trestle's deck as ground, the main line's and the spur's: `withTrestles`, `constrainTrestle`), `railCrossings.ts` (`crossingsFor`: the plan's crossings in the world), `powerLine.ts` (the poles beside the highway). Drawn: `railGeometry.ts` (cells of 128 m in three levels of detail), `railWorld.ts` (what a cell is built from), `spurGeometry.ts` (the town's spur as track, in the town's batches), `railParts.ts` (the stream by the camera's place, made by `townParts.ts`). Tests in `client/test/townRail/`. |
| `client/test/` | The client suite (vitest, no DOM library): `town/` (the plan: determinism and its pinned digests, banned arithmetic, history, validity, size, variety, the map's SVG and the contact sheet), `townGround/` (the site, the made ground, the fill, the clearing, the start), `townWorld/` (the geometry, the renderer part, the solid buildings, the decks and rails walked with the engine's movement, the harbour's geometry, and `depthSeparation.test.ts`, which finds faces of a building that the depth buffer cannot tell apart), `architecture.test.ts` (the layering and arithmetic rules for `client/src/sim/`), the scaffold's two tests (`game.test.ts`, `walk.test.ts`, with the renames the page took), the title page's tests under `game/`, `page.test.ts`, and `setup/identity.ts` (every test runs under the game's identity). |
| `client/assets/textures/`, `tools/textures/` | **The town's texture layers** (see ARCHITECTURE.md, "The town's textures"): `client/assets/textures/town.<layer>.color.webp` and `town.<layer>.data.webp` for each of 22 layers (512 x 512; in Git LFS) and `town.layers.json`, the manifest the code and its tests read. They are written by `tools/textures/build.py` from the CC0 sources on the external disk (read only), never by hand: `python3 -I tools/textures/build.py` (Pillow and numpy; `--sources DIR` if the sources are elsewhere than `/Volumes/CyrusExtSSD/dayhike-lab/capesorrow-textures`; `--check` says whether the committed manifest is what the script would write). Adding or changing a layer is editing `LAYERS` there, running it, adding the layer's name to `LAYER_NAMES` in `townLayers.ts`, and crediting the work in `CREDITS.md`. |
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
| `ARCHITECTURE.md` | The engine and what the game hands it, the town (site, plan, ground, drawing, collision, start), the title page, hosting, and what is still scaffold and unfinished. |
| `LICENSE` | GPL-3.0. `package.json` says `GPL-3.0-only`. |
| `CREDITS.md` | Credits for the third-party work that is Cape Sorrow's own (the town's 21 catalogue texture sets, CC0), rendered by the in-game Credits screen beside the engine's (`client/src/game/credits.ts`). The engine's shipped works are credited in the package's `CREDITS.md`, and the screen shows both lists as one. |
| `package.json`, `package-lock.json` | npm workspaces root (`client`, `server`; the engine is a dependency of the client and its server of `server/`, in the lockfile with its release's hash); scripts for dev, build, typecheck, lint, test, the gate and the deploy. The lockfile began as Day Hike's, so that every platform's optional native packages stay in it: never regenerate it from nothing, or Linux CI fails. |
| `tsconfig.base.json` | Shared TypeScript compiler options extended by `client/`. |
| `eslint.config.js` | Flat ESLint config. It has none of Day Hike's `sim/` and `net/` layering rules: the layering of `client/src/sim/` is held by `client/test/architecture.test.ts` instead. |
| `.dockerignore` | Build context excludes for the server's Docker image. |
| `.gitattributes` | Git LFS tracking for shipped binaries (the town's texture layers are the first; check with `git check-attr filter <file>` and `git lfs ls-files`); `\n` line endings for text. |
| `.gitignore` | Build output, local state, worktrees and `docs/superpowers/` excluded from version control. |

The engine is its own repository, `csarkosh/engine` (checked out beside this one at `~/Projects/engine` when working on
both), and Cape Sorrow installs it as a release's tarball: `client/package.json` names the address under
`https://github.com/csarkosh/engine/releases/`, and the package's modules are imported as `@csarkosh/engine/<path>`.
Moving to a new engine version is editing that address and running `npm install` (commit the lockfile). The engine's
scripts (the push gate) run from the installed package's `node_modules/@csarkosh/engine/tools`, through the root
`package.json`'s scripts, and read `ENGINE_GATE` and `ENGINE_LAB`. To try an engine change here before it is released,
pack it there (`npm pack`) and install the tarball by path (`npm install ../engine/csarkosh-engine-<version>.tgz -w client`),
and never commit that: the committed address is always a release's.

## The simulation's rules

`client/src/sim/` is what every machine computes to build the same world: the town's plan and ground. Two machines that
disagree by one bit make different towns and cannot meet, so the folder keeps to rules that `client/test/architecture.test.ts`
and `client/test/town/banned.test.ts` enforce over every file in it (a file added there is held to them with no change):

- **Arithmetic** is `+ - * /` and the `Math` functions that are exactly specified: `floor`, `round`, `abs`, `min`, `max`, `sqrt`, `imul` (and the constant `PI`). No trigonometry, `pow`, `exp`, `log`, `hypot` or `cbrt`, no `**`, no `Math.random`, no `Date`.
- **Angles are never computed.** A grid's bearing is a Pythagorean triple `(a, b, c)` with `a*a + b*b = c*c` (`bearings.ts`), the direction `(a/c, b/c)`, and a rotation is exact arithmetic on it. The degrees written beside a triple are for display, and no decision is made on a computed angle.
- **Order never comes from a collection.** No `Set`; a `Map` only as a module's own cache at the top level (`const NAME = new Map<…>()`), looked up by key and never walked; no `.values()`, `.keys()`, `.entries()` or `.forEach()` on one, no `Object.keys`, `Object.values`, `Object.entries` or `for…in`, and no `.sort()` without a comparator.
- **One random stream per stage** (`rng.ts`): the stage's own constant hashed with the town's seed, so a draw added in one stage changes no other stage's. Never renumber a stage's constant: add a new one.
- **Imports** reach only the engine's simulation (`@csarkosh/engine/sim/…`) and the folder itself: nothing of `game/`, `townMap/`, Babylon or the engine's `game/`.
- **`TOWN_GEN`** (`version.ts`) is the generator's version. It is part of every plan (`plan.version`) and of the place's tunables, so of the level id, and it **must be raised whenever the same site would give a different plan**: a change to a stage's draws, a table, a constant that shapes the output, or the order things are made in. The pinned digests in `client/test/town/determinism.test.ts` fail when it is forgotten; raise the number in the same commit and re-pin (the generator is unreleased and stands at 13 (12 is the drawing's): the town laid over the land, with stairs, the railroad's corridor, crossings and spur, the outskirts, the layout's clearance of the main line's bank, the junctions, what is in the buildings (7), what stands beside each street and how each lot is kept (8), fewer blinds on offices' and bars' windows (9), what stands in the streets, yards and docks, `plan.props` (10), and the two together (11), and the town made to fit its houses: the grid held to the lots the houses fill, a short business street, streets cut back to what they serve, shops' sidewalks (13); the pins are replaced as it changes).
- **Every constant that shapes the ground goes in the place's tunables.** `CAPE_PLACE` (`place.ts`) hands the engine a `tunables` record (the ground's and the cover's, the blend's, the clearing's, the shore search's, the town's seed constants and `TOWN_GEN`), which the engine joins to the coast's own and makes part of the level id, so peers whose ground differs do not meet. A new constant that moves the ground or the shore is added to its module's tunables record, and the made ground has its own version, `TOWN_GROUND`, raised when its arithmetic changes (it is 8: the streets are cut into it, deeper under sidewalks; the props change neither the made ground nor the clearing masks).

## Looking at towns

The map page is the way to judge a plan without the world. With `npm run dev` running, `http://localhost:5174/town.html?seed=7`
shows the town on the real coast of world seed 7: the map (pan with the mouse, zoom with the wheel; it draws the roads out with their destinations, and the made ends of streets), its history, a legend
and the counts; add `&site=synthetic` for the synthetic site's coast. `http://localhost:5174/town.html?sheet=12&from=1` is
the contact sheet: twelve towns from consecutive seeds, each with its name, what it was founded for and its bearings. The
page is development only and is not in the build. To write the sheet and each town as SVG files, run
`TOWN_SHEET_DIR=<dir> npx vitest run test/town/sheet.test.ts` from `client/` (`TOWN_SHEET_FROM` sets the first seed,
`TOWN_SHEET_ALSO` lists more world seeds as `1,7`). The map shades the land under the town (green buildable, olive gentle but held out, brown steep), marks the blocks left as woods (rust where the land said no, green where the budget ran out), the main line and its corridor, the spur, the crossings and the outlying buildings, and the contact sheet says under each town where its bay ends and how many hectares are buildable; without `TOWN_SHEET_DIR` that test only checks that the functions run.

## Hosting

The game is served from the shared site `games.csarko.sh` (Firebase Hosting site `fps-csarko`, Google Cloud project
`fps-csarko`), at `/capesorrow/`. The site, the domain and its root belong to Day Hike's repository, whose `_infra/`
owns them. This repository owns only `/capesorrow/` and its rules (`tools/deploy/site.rules.json`), and deploys them with
the engine's `tools/site/deploy.mjs` (in engine release v0.2.3 or later), which merges this game's files and rules into
the live site and refuses to release if any other game's file would change: neither game's deploy touches the other's.
There is no `_infra/` here, and there will not be until the game has a resource of its own.

The server is not deployed. A client built without a signaling address is played alone: the public page says
"In development." and offers Play under it (`client/src/game/landingModel.ts`), and the engine's shell shows no party
box. When the game has a server, `production.json` gains a `signaling_url`, and the deploy bakes it into the build as
`VITE_SIGNALING_URL`. The `deploy-production` skill has the
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
