/**
 * `planTown(site, kind)`: the town plan, a pure function of a site and a kind.
 *
 * The stages run in a fixed order and each draws from a stream of its own (see `rng.ts`):
 * names, history, plats (with streets and blocks), lots, buildings, landmarks. The history is drawn
 * first and everything after it is derived from it. Nothing here asks which kind of town it is making:
 * the recipe (`recipes.ts`) supplies each step.
 */
import { bbox, contains, lerpVec, segCross, segSegDist, type Poly, type Vec } from "./geom.js";
import { RAIL_OFFSET } from "./rail.js";
import { wetRuns } from "./port/spur.js";
import { shoreAt } from "./shore.js";
import { CROSSING_MIN_SIN } from "./railCrossings.js";
import { cutBlock, type LotDraft } from "./lots.js";
import { makeNames } from "./names.js";
import { stageRng } from "./rng.js";
import { findEnds } from "./port/ends.js";
import { planOutskirts } from "./port/outskirts.js";
import { landOf } from "./land.js";
import { findJunctions } from "./junctions.js";
import { planEdges } from "./port/edges.js";
import { planYards } from "./port/yards.js";
import { planProps } from "./port/props/index.js";
import { describeRoads, planRoads } from "./port/roads.js";
import { wayOf } from "./ways.js";
import { RECIPES, type Streams } from "./recipes.js";
import { analyseShore } from "./shore.js";
import type { TownSite } from "./site.js";
import { TOWN_GEN } from "./version.js";
import type { Block, History, Landmark, Lot, RailCrossing, Road, Street, TownKind, TownPlan } from "./types.js";

/** Makes the plan of a town on a site. Deterministic: every machine computes the same plan. */
/**
 * Where the streets and the roads out cross the railroad's main line (`rail.ts`, the highway's line shifted `RAIL_OFFSET` seaward) at grade,
 * with each way's direction there (seaward) and widths. A way that meets the line at under about twelve degrees is no crossing; alleys,
 * the wharf and the highway are none.
 */
function railCrossings(site: TownSite, streets: readonly Street[], roads: readonly Road[]): RailCrossing[] {
  const out: RailCrossing[] = [];
  const consider = (way: number, road: boolean, a: Vec, b: Vec, roadway: number, width: number, paved: boolean): void => {
    for (let i = 0; i < site.roadX.length - 1; i++) {
      const z0 = site.z0 + i * site.step;
      const c = segCross(a, b, { x: site.roadX[i]! - RAIL_OFFSET, z: z0 }, { x: site.roadX[i + 1]! - RAIL_OFFSET, z: z0 + site.step });
      if (!c) continue;
      const p = lerpVec(a, b, c.t);
      const len = Math.sqrt((b.x - a.x) * (b.x - a.x) + (b.z - a.z) * (b.z - a.z));
      let dx = (b.x - a.x) / len;
      let dz = (b.z - a.z) / len;
      if (dx > 0) {
        dx = -dx;
        dz = -dz;
      }
      // The line's direction in this stretch, and the sine of the angle between the way and it.
      const lx = site.roadX[i + 1]! - site.roadX[i]!;
      const ll = Math.sqrt(lx * lx + site.step * site.step);
      const sin = Math.abs(dx * (site.step / ll) - dz * (lx / ll));
      if (sin < CROSSING_MIN_SIN) continue;
      out.push({ x: p.x, z: p.z, way, road, dx, dz, roadway, width, paved });
    }
  };
  for (const st of streets) {
    if (st.kind === "highway" || st.kind === "rail" || st.kind === "wharf" || st.kind === "alley") continue;
    consider(st.id, false, st.a, st.b, st.roadway, st.width, true);
  }
  for (const road of roads) {
    for (let i = 1; i < road.points.length; i++) {
      const a = road.points[i - 1] as { x: number; z: number; width: number; surface: string };
      const b = road.points[i] as { x: number; z: number; width: number; surface: string };
      consider(road.id, true, a, b, (a.width + b.width) / 2, (a.width + b.width) / 2 + 2, a.surface === "paved");
    }
  }
  out.sort((p, q) => p.z - q.z || p.x - q.x);
  return out;
}

export function planTown(site: TownSite, kind: TownKind): TownPlan {
  const recipe = RECIPES[kind];
  const seed = site.seed;
  const streams: Streams = {
    history: stageRng(seed, "history"),
    plats: stageRng(seed, "plats"),
    streets: stageRng(seed, "streets"),
    lots: stageRng(seed, "lots"),
    buildings: stageRng(seed, "buildings"),
    landmarks: stageRng(seed, "landmarks"),
    harbour: stageRng(seed, "harbour"),
  };
  const names = makeNames(stageRng(seed, "names"));
  const { history, townName } = recipe.history(streams.history, names, analyseShore(site));

  const layout = recipe.layout(site, history, names, streams);
  const blocks: Block[] = layout.blocks.slice();

  // Landmarks reserve their places before the lots are cut.
  const lmPlan = recipe.landmarkPlan(site, layout, history, streams.landmarks);
  for (const id of lmPlan.civic) blocks[id] = { ...blocks[id]!, district: "civic" };

  // Lots, and the alleys between them.
  const lots: Lot[] = [];
  const drafts: LotDraft[] = [];
  const streets: Street[] = layout.streets.slice();
  for (const block of blocks) {
    const meta = layout.meta[block.id]!;
    const plat = layout.plats.find((p) => p.id === block.plat)!;
    const res = lmPlan.reservations.find((r) => r.block === block.id);
    const rule = recipe.lotRule(block, meta, layout);
    // An alley only runs through a plain four-cornered block: where a block is cut oblique its alley would end on no street.
    const cut = cutBlock(block.polygon, meta.frame, rule, block.polygon.length === 4 ? plat.alley : null, streams.lots, res);
    for (const d of cut.lots) {
      lots.push({
        id: lots.length,
        block: block.id,
        polygon: d.polygon,
        district: block.district,
        front: { x: d.T.x * d.frontSign, z: d.T.z * d.frontSign },
        role: d.role,
      });
      drafts.push(d);
    }
    if (cut.alley && streets.some((st) => st.kind !== "alley" && Math.min(segSegDist(cut.alley!.a, cut.alley!.b, st.a, st.b)) <= (st.width + cut.alley!.width) / 2 + 0.5)) {
      streets.push({ id: streets.length, a: cut.alley.a, b: cut.alley.b, width: cut.alley.width, ...wayOf("alley", cut.alley.width), kind: "alley", plat: block.plat, name: "alley" });
    }
  }

  const madeEnds = findEnds(streets, site, layout.quay, layout.fill, stageRng(seed, "ends"));
  // The roads out of town continue some of those ends from the grid; where a road leaves, the street has no end to make.
  const rngRoads = stageRng(seed, "roads");
  const { roads, ends } = planRoads(site, streets, madeEnds, blocks.map((b) => b.polygon), names, townName, rngRoads);
  const buildings = recipe.buildings({ site, history, layout, blocks, lots, drafts }, streams.buildings);
  const bound = recipe.bindLandmarks(history, names, townName, lots, buildings);
  // The roads out: a sentence of the history for each, and each destination among the landmarks.
  const described = describeRoads(roads, streets, names, townName, history.founding.year, rngRoads);
  const landmarks: Landmark[] = [...bound, ...described.landmarks.map((l, i) => ({ ...l, id: bound.length + i }))];
  const fbi = landmarks.find((l) => l.role === "fbi");
  if (!fbi) throw new Error("the plan has no FBI office");
  const spawn = recipe.spawn(buildings[fbi.building]!);

  const oldDecks = recipe.decks(layout, buildings, streets);
  const harbourOut = recipe.harbour({ site, layout, history, buildings, streets, decks: oldDecks }, streams.harbour);
  const decks = [...oldDecks, ...harbourOut.decks];
  // What the roads out and the harbour have to tell joins the history's list, in order of year and then of the order they were told.
  const told = [...history.events, ...described.events, ...harbourOut.harbour.events].map((e, i) => ({ e, i }));
  told.sort((p, q) => p.e.year - q.e.year || p.i - q.i);
  const fullHistory: History = { ...history, events: told.map((t) => t.e) };

  // The town thins out past its last full blocks: single buildings on lots of their own, appended to the blocks, lots and buildings.
  const edge = planOutskirts({ site, land: landOf(site), history, blocks, roads, streets, nextBlock: blocks.length, nextLot: lots.length, nextBuilding: buildings.length }, stageRng(seed, "outskirts"));
  blocks.push(...edge.blocks);
  lots.push(...edge.lots);
  buildings.push(...edge.buildings);

  // The spur's stretches over open water are carried on a trestle: a point is over water where it is seaward of the shore, off the fill, and off every deck the harbour built (the apron, the piers).
  const deckAt = (p: Vec): boolean => decks.some((d) => Math.abs((p.x - d.centre.x) * d.axis.x + (p.z - d.centre.z) * d.axis.z) <= d.halfAlong + 3 && Math.abs((p.x - d.centre.x) * -d.axis.z + (p.z - d.centre.z) * d.axis.x) <= d.halfAcross + 3);
  const spurs = layout.spurs.map((sp) => ({ ...sp, wet: wetRuns(sp.points, (p) => p.x < shoreAt(site, p.z) - 0.5 && !layout.fill.some((f) => contains(f.polygon, p, 2)) && !deckAt(p), (p) => !deckAt(p)) }));

  const all: Poly[] = [...blocks.map((b) => b.polygon), ...streets.map((s) => [s.a, s.b])];
  const bb = bbox(all.flat());
  let open = 0;
  let vacant = 0;
  let ruin = 0;
  for (const b of buildings) {
    if (b.state === "open") open++;
    else if (b.state === "vacant") vacant++;
    else ruin++;
  }
  // What is in the buildings, from the finished plan and the business stream alone: nothing above it changes.
  const uses = recipe.uses({ history: fullHistory, townName, names, buildings, lots, blocks, streets, landmarks, harbour: harbourOut.harbour }, stageRng(seed, "business"));
  const crossings = railCrossings(site, streets, roads);
  // What stands beside each street's roadway (sidewalks, curbs, repaving), then the junctions that follow it, then each lot's yard.
  const edges = planEdges({ streets, blocks, lots, buildings, history, rng: stageRng(seed, "edges") });
  const junctions = findJunctions({ streets, roads, ends, rail: crossings, blocks, buildings, landmarks, edges, rng: stageRng(seed, "junctions") });
  const yards = planYards({ blocks, lots, buildings, rng: stageRng(seed, "yards") });
  const base: Omit<TownPlan, "props"> = {
    version: TOWN_GEN,
    kind,
    seed,
    name: townName,
    history: fullHistory,
    plats: layout.plats,
    seams: layout.seams,
    streets,
    ends,
    roads,
    blocks,
    lots,
    buildings,
    uses,
    landmarks,
    rail: { crossings, spurs },
    outskirts: edge.outskirts,
    woods: layout.woods,
    spawn,
    junctions,
    edges,
    yards,
    decks,
    harbour: harbourOut.harbour,
    fill: layout.fill,
    quay: layout.quay,
    bounds: bb,
    counts: { plats: layout.plats.length, streets: streets.length, blocks: blocks.length - edge.blocks.length, outskirts: edge.outskirts.length, lots: lots.length, buildings: buildings.length, open, vacant, ruin },
  };
  // What stands in the streets, yards and docks: the last stage, on a stream of its own, from the finished plan.
  return { ...base, props: planProps(base) };
}
