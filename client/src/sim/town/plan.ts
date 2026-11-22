/**
 * `planTown(site, kind)`: the town plan, a pure function of a site and a kind.
 *
 * The stages run in a fixed order and each draws from a stream of its own (see `rng.ts`):
 * names, history, plats (with streets and blocks), lots, buildings, landmarks. The history is drawn
 * first and everything after it is derived from it. Nothing here asks which kind of town it is making:
 * the recipe (`recipes.ts`) supplies each step.
 */
import { bbox, type Poly } from "./geom.js";
import { cutBlock, type LotDraft } from "./lots.js";
import { makeNames } from "./names.js";
import { stageRng } from "./rng.js";
import { RECIPES, type Streams } from "./recipes.js";
import { analyseShore } from "./shore.js";
import type { TownSite } from "./site.js";
import { TOWN_GEN } from "./version.js";
import type { Block, Lot, Street, TownKind, TownPlan } from "./types.js";

/** Makes the plan of a town on a site. Deterministic: every machine computes the same plan. */
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
  };
  const names = makeNames(stageRng(seed, "names"));
  const { history, townName } = recipe.history(streams.history, names, analyseShore(site));

  const layout = recipe.layout(site, history, names, streams);
  const blocks: Block[] = layout.blocks.slice();

  // Landmarks reserve their places before the lots are cut.
  const lmPlan = recipe.landmarkPlan(layout, history, streams.landmarks);
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
    const cut = cutBlock(block.polygon, meta.frame, rule, plat.alley, streams.lots, res);
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
    if (cut.alley) {
      streets.push({ id: streets.length, a: cut.alley.a, b: cut.alley.b, width: cut.alley.width, kind: "alley", plat: block.plat, name: "alley" });
    }
  }

  const buildings = recipe.buildings({ site, history, layout, blocks, lots, drafts }, streams.buildings);
  const landmarks = recipe.bindLandmarks(history, names, townName, lots, buildings);
  const fbi = landmarks.find((l) => l.role === "fbi");
  if (!fbi) throw new Error("the plan has no FBI office");
  const spawn = recipe.spawn(buildings[fbi.building]!);

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
  return {
    version: TOWN_GEN,
    kind,
    seed,
    name: townName,
    history,
    plats: layout.plats,
    seams: layout.seams,
    streets,
    blocks,
    lots,
    buildings,
    landmarks,
    spawn,
    bounds: bb,
    counts: { plats: layout.plats.length, streets: streets.length, blocks: blocks.length, lots: lots.length, buildings: buildings.length, open, vacant, ruin },
  };
}
