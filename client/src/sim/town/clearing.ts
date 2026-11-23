/**
 * What grows where the town is, lot by lot. The engine asks the place for a feature mask at a point (its trees' cell
 * centres, its ground cover, its loose rock and driftwood), and the cliff bands' keep, and the heights its shore rules
 * read; this answers all of them from the plan:
 *
 * - **Streets, buildings, paved blocks.** (Ground cover on a street's right of way is by its parts, `gridFactor`: shut within `PAVEMENT_CLEAR` of the roadway, almost shut on the sidewalk and shoulder, the lot's own grass on the verge; and a yard is its lot's own, `YARD_MASK`.) No tree stands where its trunk could fall on a street's right of way or
 *   within `TREE_BUILDING_CLEAR` of a building, and none on a paved block (the core, the dock end, the working
 *   waterfront, the mill's site, industrial flats, the highway strip's lots) or a few metres of it. A tree is placed
 *   by its cell's centre and stands up to `TREE_JITTER` from it, so the mask is shut over that much more than the trunk's own clearance, and
 *   rises over `TREE_RAMP` beyond. No grass or ground cover stands on a street or within `CLUTTER_BUILDING_CLEAR` of a
 *   building, nor on a paved block.
 * - **Yards.** On house lots (residential and mill housing blocks), the churchyard, the school's and hospital's grounds
 *   and vacant lots, ground cover grows whole and trees stand at `YARD_TREE` of the forest's density. The engine paints
 *   the ground by its height, so the made flats (2 to 3 m) would be painted as the beach's pebble, and trees and grass
 *   would not grow there; the place's `shoreStrip` hook says what the shore's rules read there, so on a yard they read
 *   the ground `YARD_LIFT` m higher, as ground that can bear grass and trees, and paints as it. `meadow` thickens the
 *   yard's grass.
 * - **Beyond the outermost blocks the forest is whole**, right up to the back fences: where the town's own windows
 *   fall away the mask is 1.
 * - **Loose rock and driftwood** stay off the town, returning over its cover's fade.
 *
 * The cliff bands are still kept off the old rectangle (the engine hands `cliffKeepD` no seed, so no plan): see `townKeepD`.
 */
import { COVE_Z, roadCenterX } from "@csarkosh/engine/sim/olympic";
import { UNIT_KEEP } from "@csarkosh/engine/sim/cliffs";
import type { FeatureMask } from "@csarkosh/engine/sim/features";
import { bearingU, bearingV } from "./bearings.js";
import { coverD } from "./cover.js";
import { smootherstepD } from "./ground.js";
import { QUAY_BANK, fillWindowD, type FillArea } from "./fill.js";
import { orient } from "./geom.js";
import { lotIdAt } from "./lotIndex.js";
import { walkAt } from "./port/edges.js";
import { inYardRect, yardShape } from "./yardShapes.js";
import { planFor } from "./planFor.js";
import { readingSite } from "./reading.js";
import { siteFor } from "./siteFor.js";
import type { District, TownPlan, YardKind } from "./types.js";

/** The farthest a tree stands from its cell's centre, in x or z summed as a diagonal (the engine's jitter of 0.7 of a 10 m cell), metres. */
export const TREE_JITTER = 5;
/** A trunk keeps this far from a street's right of way. */
export const TREE_STREET_CLEAR = 1.5;
/** A trunk keeps this far from a building's footprint: its canopy's reach. */
export const TREE_BUILDING_CLEAR = 3.5;
/** The tree mask opens over this many metres past its shut distance. */
export const TREE_RAMP = 4;
/** Ground cover keeps this far from a building and from a street's right of way. */
export const CLUTTER_BUILDING_CLEAR = 2;
export const CLUTTER_STREET_CLEAR = 0.5;
export const CLUTTER_RAMP = 2;
/** The farthest a piece of ground cover stands from its cell's centre (the engine's jitter of its largest cell on the town), metres: the mask is shut over that much more than the clearance. */
export const CLUTTER_JITTER = 2;
/** A yard's trees, as a share of the forest's density. */
export const YARD_TREE = 0.22;
/** A yard's ground cover, as a share of the forest floor's. */
export const YARD_CLUTTER = 1;
/** `meadow`: how much denser a yard's grass reads. */
export const YARD_MEADOW = 0.6;
/**
 * What each kind of yard leaves of the forest (`port/yards.ts` says which lot has which): trees as a share of the forest's, the ground cover's
 * density (the engine's blades stand taller where it is over 1) and `meadow`. A mown lawn is thin and short; a shaggy one thick and full
 * of weeds; a tall one waist-high; bare ground has next to nothing; a mossy yard stands under trees; brush is the lot going back to the
 * woods. Authored; the contrast is meant to be sharp at a property line, as in life.
 */
export const YARD_MASK: Readonly<Record<YardKind, { tree: number; clutter: number; meadow: number }>> = {
  paved: { tree: 0, clutter: 0, meadow: 0 },
  mown: { tree: 0.15, clutter: 0.4, meadow: 0 },
  shaggy: { tree: 0.2, clutter: 1.1, meadow: 0.8 },
  tall: { tree: 0.25, clutter: 2.1, meadow: 1 },
  bare: { tree: 0.05, clutter: 0.1, meadow: 0 },
  mossy: { tree: 0.32, clutter: 0.7, meadow: 0.2 },
  brush: { tree: 0.32, clutter: 2.4, meadow: 1 },
};
/** The share of its lot's ground cover a street's verge keeps (the owner mows it, or does not), and of its meadow. */
export const VERGE_CLUTTER = 0.7;
export const VERGE_MEADOW = 0.5;
/** Ground cover keeps this far past a roadway's edge (the curb, the gutter and a margin for the blades' jitter) off: nothing grows in the trough. */
export const PAVEMENT_CLEAR = 1.0;
/** How much of the grass the back 45 cm of a sidewalk lets through (grass over the edge), and on a shoulder of gravel. */
export const WALK_EDGE_CLUTTER = 0.3;
export const SHOULDER_CLUTTER = 0.12;
/** An alley's wheel tracks keep the grass off between these distances from its middle (the grass grows between and beside them). */
export const TRACK_FROM = 0.4;
export const TRACK_TO = 1.3;
/** How many metres higher the shore's rules read a yard's ground (`shoreStrip`'s lift). */
export const YARD_LIFT = 12;
/** A block's own window falls over this many metres outside its edges. */
export const BLOCK_MARGIN = 4;
/** The strip that reads as soil (not beach) runs this many metres past a street's right of way before it falls to nothing. */
export const STRIP_RAMP = 2;

/** While the site is read (before there is a plan) the cliff bands are kept off this rectangle: this far along the shore either way of the cove and this far inland of the highway, metres, the bands returning over `READ_KEEP_EDGE`. It holds everything the plan builds on and the roads out of it, which the world then keeps clear of the bands too (`ROAD_KEEP_*`). */
export const READ_KEEP_Z = 1000;
export const READ_KEEP_INLAND = 1000;
export const READ_KEEP_EDGE = 40;
/** The cliff bands are kept off a road out of town to this far from its centre line, and return over `ROAD_KEEP_RAMP` more, metres. */
export const ROAD_KEEP_HALF = 8;
export const ROAD_KEEP_RAMP = 14;

/** What the clearing declares of itself for the level id. */
export const CLEARING_TUNABLES: Readonly<Record<string, number>> = {
  YARD_MOWN_TREE: YARD_MASK.mown.tree,
  YARD_MOWN_CLUTTER: YARD_MASK.mown.clutter,
  YARD_MOWN_MEADOW: YARD_MASK.mown.meadow,
  YARD_SHAGGY_TREE: YARD_MASK.shaggy.tree,
  YARD_SHAGGY_CLUTTER: YARD_MASK.shaggy.clutter,
  YARD_SHAGGY_MEADOW: YARD_MASK.shaggy.meadow,
  YARD_TALL_TREE: YARD_MASK.tall.tree,
  YARD_TALL_CLUTTER: YARD_MASK.tall.clutter,
  YARD_TALL_MEADOW: YARD_MASK.tall.meadow,
  YARD_BARE_TREE: YARD_MASK.bare.tree,
  YARD_BARE_CLUTTER: YARD_MASK.bare.clutter,
  YARD_BARE_MEADOW: YARD_MASK.bare.meadow,
  YARD_MOSSY_TREE: YARD_MASK.mossy.tree,
  YARD_MOSSY_CLUTTER: YARD_MASK.mossy.clutter,
  YARD_MOSSY_MEADOW: YARD_MASK.mossy.meadow,
  YARD_BRUSH_TREE: YARD_MASK.brush.tree,
  YARD_BRUSH_CLUTTER: YARD_MASK.brush.clutter,
  YARD_BRUSH_MEADOW: YARD_MASK.brush.meadow,
  TREE_JITTER,
  TREE_STREET_CLEAR,
  TREE_BUILDING_CLEAR,
  TREE_RAMP,
  CLUTTER_BUILDING_CLEAR,
  CLUTTER_STREET_CLEAR,
  CLUTTER_RAMP,
  CLUTTER_JITTER,
  YARD_TREE,
  YARD_CLUTTER,
  YARD_MEADOW,
  YARD_LIFT,
  VERGE_CLUTTER,
  VERGE_MEADOW,
  PAVEMENT_CLEAR,
  WALK_EDGE_CLUTTER,
  SHOULDER_CLUTTER,
  TRACK_FROM,
  TRACK_TO,
  BLOCK_MARGIN,
  STRIP_RAMP,
  READ_KEEP_Z,
  READ_KEEP_INLAND,
  READ_KEEP_EDGE,
  ROAD_KEEP_HALF,
  ROAD_KEEP_RAMP,
};

/**
 * How much of the cliff bands the coast keeps at a place in the road's frame, 1 all of them and 0 none. It follows what the
 * town covers: the bands are gone where the plan's cover is whole (its blocks, the quay and the fill) and along the roads out
 * of town, and return as the cover falls away, so a hillside the town did not build on keeps its cliffs. While the site is read
 * there is no plan yet, and the bands are kept off the rectangle `READ_KEEP_*` instead, so the roads are routed over ground
 * with no bands and the world lays them over ground with none.
 */
export function townKeepD(u: number, uDz: number, z: number, seed: number): { v: number; dx: number; dz: number } {
  if (readingSite()) {
    const wi = smootherstepD(READ_KEEP_INLAND, READ_KEEP_INLAND + READ_KEEP_EDGE, u);
    if (wi.v === 1) return UNIT_KEEP;
    const az = z - COVE_Z < 0 ? COVE_Z - z : z - COVE_Z;
    const wz = smootherstepD(READ_KEEP_Z, READ_KEEP_Z + READ_KEEP_EDGE, az);
    if (wz.v === 1) return UNIT_KEEP;
    const iv = 1 - wi.v;
    const zv = 1 - wz.v;
    const sz = z - COVE_Z < 0 ? -1 : 1;
    return { v: 1 - iv * zv, dx: zv * wi.d, dz: zv * wi.d * uDz + iv * wz.d * sz };
  }
  const plan = planFor(seed);
  const site = siteFor(seed);
  const xf = roadCenterX(seed, z) + u - site.anchor.x;
  const zr = z - COVE_Z;
  const cov = coverD(plan, xf, zr);
  const box = fillBoxOf(plan);
  const rd = roadWeightD(plan, xf, zr);
  if (cov.v === 0 && rd.v === 0 && (xf < box.x0 || xf > box.x1 || zr < box.z0 || zr > box.z1)) return UNIT_KEEP;
  const f = xf < box.x0 || xf > box.x1 || zr < box.z0 || zr > box.z1 ? NO_WEIGHT : fillWindowD(plan.fill, xf, zr);
  // The cover united with the fill's window: the town covers a point if either does.
  const town = { v: 1 - (1 - cov.v) * (1 - f.v), dx: (1 - f.v) * cov.dx + (1 - cov.v) * f.dx, dz: (1 - f.v) * cov.dz + (1 - cov.v) * f.dz };
  // And the corridors of the roads out: the bands are kept off a road's own width.
  const c = 1 - (1 - town.v) * (1 - rd.v);
  if (c === 0) return UNIT_KEEP;
  return { v: 1 - c, dx: -((1 - rd.v) * town.dx + (1 - town.v) * rd.dx), dz: -((1 - rd.v) * town.dz + (1 - town.v) * rd.dz) };
}

type RoadBox = { readonly x0: number; readonly z0: number; readonly x1: number; readonly z1: number; readonly segs: readonly (readonly [number, number, number, number])[] };
const ROAD_BOXES = new WeakMap<TownPlan, readonly RoadBox[]>();

function roadBoxesOf(plan: TownPlan): readonly RoadBox[] {
  let boxes = ROAD_BOXES.get(plan);
  if (boxes === undefined) {
    const reach = ROAD_KEEP_HALF + ROAD_KEEP_RAMP;
    boxes = plan.roads.map((road) => {
      const segs: [number, number, number, number][] = [];
      let x0 = Infinity;
      let z0 = Infinity;
      let x1 = -Infinity;
      let z1 = -Infinity;
      for (let i = 1; i < road.points.length; i++) {
        const a = road.points[i - 1] as { x: number; z: number };
        const b = road.points[i] as { x: number; z: number };
        segs.push([a.x, a.z, b.x, b.z]);
        x0 = Math.min(x0, a.x, b.x);
        z0 = Math.min(z0, a.z, b.z);
        x1 = Math.max(x1, a.x, b.x);
        z1 = Math.max(z1, a.z, b.z);
      }
      return { x0: x0 - reach, z0: z0 - reach, x1: x1 + reach, z1: z1 + reach, segs };
    });
    ROAD_BOXES.set(plan, boxes);
  }
  return boxes;
}

/** How much the roads out of town hold a place, 0 to 1 with its gradient: 1 within `ROAD_KEEP_HALF` of a road's line, falling to 0 over `ROAD_KEEP_RAMP`. */
function roadWeightD(plan: TownPlan, x: number, z: number): { v: number; dx: number; dz: number } {
  let rest = 1;
  let restDx = 0;
  let restDz = 0;
  for (const box of roadBoxesOf(plan)) {
    if (x < box.x0 || x > box.x1 || z < box.z0 || z > box.z1) continue;
    for (const seg of box.segs) {
      const abx = seg[2] - seg[0];
      const abz = seg[3] - seg[1];
      const l2 = abx * abx + abz * abz;
      let t = l2 === 0 ? 0 : ((x - seg[0]) * abx + (z - seg[1]) * abz) / l2;
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      const ex = x - (seg[0] + abx * t);
      const ez = z - (seg[1] + abz * t);
      const d = Math.sqrt(ex * ex + ez * ez);
      if (d >= ROAD_KEEP_HALF + ROAD_KEEP_RAMP) continue;
      let w = 1;
      let wdx = 0;
      let wdz = 0;
      if (d > ROAD_KEEP_HALF) {
        const sm = smootherstepD(ROAD_KEEP_HALF, ROAD_KEEP_HALF + ROAD_KEEP_RAMP, d);
        w = 1 - sm.v;
        wdx = (-sm.d * ex) / d;
        wdz = (-sm.d * ez) / d;
      }
      if (w === 1) return { v: 1, dx: 0, dz: 0 };
      restDx = (1 - w) * restDx - rest * wdx;
      restDz = (1 - w) * restDz - rest * wdz;
      rest *= 1 - w;
    }
  }
  return { v: 1 - rest, dx: 0 - restDx, dz: 0 - restDz };
}

const NO_WEIGHT = { v: 0, dx: 0, dz: 0 };
const FILL_BOXES = new WeakMap<TownPlan, { x0: number; z0: number; x1: number; z1: number }>();

/** The box the plan's fill (its bank included) lies in, found once per plan. */
function fillBoxOf(plan: TownPlan): { x0: number; z0: number; x1: number; z1: number } {
  let box = FILL_BOXES.get(plan);
  if (box === undefined) {
    box = { x0: Infinity, z0: Infinity, x1: -Infinity, z1: -Infinity };
    for (const area of plan.fill) {
      for (const p of area.polygon) {
        box = { x0: Math.min(box.x0, p.x - QUAY_BANK), z0: Math.min(box.z0, p.z - QUAY_BANK), x1: Math.max(box.x1, p.x + QUAY_BANK), z1: Math.max(box.z1, p.z + QUAY_BANK) };
      }
    }
    FILL_BOXES.set(plan, box);
  }
  return box;
}

/** How much the town covers a world point, 0 to 1: the plan's cover (its blocks and the quay) united with the plan's fill, its bank included. */
export function townCover(seed: number, x: number, z: number, fill: readonly FillArea[] = planFor(seed).fill): number {
  const site = siteFor(seed);
  const cover = coverD(planFor(seed), x - site.anchor.x, z - COVE_Z).v;
  if (fill.length === 0) return cover;
  return 1 - (1 - cover) * (1 - fillWindowD(fill, x - site.anchor.x, z - COVE_Z).v);
}

/** Which districts are paved: the ground between their buildings is the town's own surface. The rest are yards. */
const PAVED: Readonly<Record<District, boolean>> = {
  core: true,
  dock: true,
  waterfront: true,
  mill: true,
  "mill housing": false,
  residential: false,
  "highway strip": true,
  civic: false,
  industrial: true,
  outskirts: false,
};

/** Whether a district's blocks are paved (its lots' ground is the town's surface) and not yards. */
export function isPaved(district: District): boolean {
  return PAVED[district];
}

type Edge = { readonly nx: number; readonly nz: number; readonly c: number };
type Footprint = { readonly cx: number; readonly cz: number; readonly ux: number; readonly uz: number; readonly vx: number; readonly vz: number; readonly hu: number; readonly hv: number };
/** A cleared place: a destination's, and whether its ground cover is cleared too. */
type Disc = { readonly x: number; readonly z: number; readonly r: number; readonly bare: boolean };
type Streetway = { readonly ax: number; readonly az: number; readonly bx: number; readonly bz: number; readonly half: number; readonly kind: "grid" | "alley" | "other"; readonly id: number; readonly cw: number };

const CELL = 16;
/** The farthest any rule here reaches from an item: the tree's, over a building (shut distance plus ramp). */
const REACH = 24;

type Index = {
  readonly x0: number;
  readonly z0: number;
  readonly nx: number;
  readonly nz: number;
  readonly blocks: readonly { edges: readonly Edge[]; paved: boolean }[];
  readonly buildings: readonly Footprint[];
  readonly streets: readonly Streetway[];
  readonly discs: readonly Disc[];
  /** Per cell: the blocks, buildings and streets within reach. */
  readonly cellBlocks: readonly (readonly number[])[];
  readonly cellBuildings: readonly (readonly number[])[];
  readonly cellStreets: readonly (readonly number[])[];
  readonly cellDiscs: readonly (readonly number[])[];
};

const INDEX = new WeakMap<TownPlan, Index>();

/** The half width of a street that nothing grows on: its right of way. */
function wayHalf(st: { width: number }): number {
  return st.width / 2;
}

function indexOf(plan: TownPlan): Index {
  const hit = INDEX.get(plan);
  if (hit !== undefined) return hit;
  const blocks: { edges: Edge[]; paved: boolean }[] = [];
  const blockBox: { x0: number; z0: number; x1: number; z1: number }[] = [];
  for (const b of plan.blocks) {
    const poly = orient(b.polygon);
    const edges: Edge[] = [];
    let x0 = Infinity;
    let z0 = Infinity;
    let x1 = -Infinity;
    let z1 = -Infinity;
    for (let i = 0; i < poly.length; i++) {
      const p = poly[i] as { x: number; z: number };
      const q = poly[(i + 1) % poly.length] as { x: number; z: number };
      const ex = q.x - p.x;
      const ez = q.z - p.z;
      const len = Math.sqrt(ex * ex + ez * ez);
      if (!(len > 1e-9)) continue;
      const nx = -ez / len;
      const nz = ex / len;
      edges.push({ nx, nz, c: nx * p.x + nz * p.z });
      x0 = Math.min(x0, p.x);
      z0 = Math.min(z0, p.z);
      x1 = Math.max(x1, p.x);
      z1 = Math.max(z1, p.z);
    }
    if (edges.length < 3) continue;
    blocks.push({ edges, paved: PAVED[b.district] });
    blockBox.push({ x0, z0, x1, z1 });
  }
  const buildings: Footprint[] = [];
  const bldBox: { x0: number; z0: number; x1: number; z1: number }[] = [];
  for (const b of plan.buildings) {
    // A pier's deck stands over water, and its shed on piles is no yard's: only buildings of a lot.
    if (b.lot === -1) continue;
    const u = bearingU(b.bearing);
    const v = bearingV(b.bearing);
    const r = Math.abs(u.x) * b.halfAlong + Math.abs(v.x) * b.halfAcross;
    const s = Math.abs(u.z) * b.halfAlong + Math.abs(v.z) * b.halfAcross;
    buildings.push({ cx: b.centre.x, cz: b.centre.z, ux: u.x, uz: u.z, vx: v.x, vz: v.z, hu: b.halfAlong, hv: b.halfAcross });
    bldBox.push({ x0: b.centre.x - r, z0: b.centre.z - s, x1: b.centre.x + r, z1: b.centre.z + s });
  }
  const streets: Streetway[] = [];
  const stBox: { x0: number; z0: number; x1: number; z1: number }[] = [];
  for (const st of plan.streets) {
    // The wharf is a deck over water; the highway is the engine's own, cleared by its rules.
    if (st.kind === "highway" || st.kind === "wharf") continue;
    const half = wayHalf(st);
    const grid = st.kind === "street" || st.kind === "main" || st.kind === "avenue";
    streets.push({ ax: st.a.x, az: st.a.z, bx: st.b.x, bz: st.b.z, half, kind: grid ? "grid" : st.kind === "alley" ? "alley" : "other", id: st.id, cw: st.roadway / 2 });
    stBox.push({ x0: Math.min(st.a.x, st.b.x) - half, z0: Math.min(st.a.z, st.b.z) - half, x1: Math.max(st.a.x, st.b.x) + half, z1: Math.max(st.a.z, st.b.z) + half });
  }
  // The roads out of town clear the forest as streets do: to their own width, the trees closing over them beyond.
  for (const road of plan.roads) {
    for (let i = 1; i < road.points.length; i++) {
      const a = road.points[i - 1] as { x: number; z: number; width: number };
      const b = road.points[i] as { x: number; z: number; width: number };
      const half = (a.width + b.width) / 4;
      streets.push({ ax: a.x, az: a.z, bx: b.x, bz: b.z, half, kind: "other", id: -1, cw: half });
      stBox.push({ x0: Math.min(a.x, b.x) - half, z0: Math.min(a.z, b.z) - half, x1: Math.max(a.x, b.x) + half, z1: Math.max(a.z, b.z) + half });
    }
  }
  // And the destinations: a cleared place about each, of ground cover too where it was worked (a landing, a pit, the tank's pad, the gate).
  const discs: Disc[] = plan.roads.map((r) => ({ x: r.destination.x, z: r.destination.z, r: r.destination.radius, bare: r.destination.kind !== "cemetery" }));
  const discBox = discs.map((d) => ({ x0: d.x - d.r, z0: d.z - d.r, x1: d.x + d.r, z1: d.z + d.r }));
  let bx0 = Infinity;
  let bz0 = Infinity;
  let bx1 = -Infinity;
  let bz1 = -Infinity;
  for (const bb of [...blockBox, ...bldBox, ...stBox, ...discBox]) {
    bx0 = Math.min(bx0, bb.x0 - REACH);
    bz0 = Math.min(bz0, bb.z0 - REACH);
    bx1 = Math.max(bx1, bb.x1 + REACH);
    bz1 = Math.max(bz1, bb.z1 + REACH);
  }
  const nx = Math.floor((bx1 - bx0) / CELL) + 1;
  const nz = Math.floor((bz1 - bz0) / CELL) + 1;
  const cellBlocks: number[][] = [];
  const cellBuildings: number[][] = [];
  const cellStreets: number[][] = [];
  const cellDiscs: number[][] = [];
  for (let i = 0; i < nx * nz; i++) {
    cellBlocks.push([]);
    cellBuildings.push([]);
    cellStreets.push([]);
    cellDiscs.push([]);
  }
  const put = (cells: number[][], box: { x0: number; z0: number; x1: number; z1: number }, k: number, reach: number): void => {
    const i0 = Math.floor((box.x0 - reach - bx0) / CELL);
    const i1 = Math.floor((box.x1 + reach - bx0) / CELL);
    const j0 = Math.floor((box.z0 - reach - bz0) / CELL);
    const j1 = Math.floor((box.z1 + reach - bz0) / CELL);
    for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) (cells[i * nz + j] as number[]).push(k);
  };
  for (let k = 0; k < blocks.length; k++) put(cellBlocks, blockBox[k] as (typeof blockBox)[number], k, BLOCK_MARGIN + TREE_JITTER * 1.5);
  for (let k = 0; k < buildings.length; k++) put(cellBuildings, bldBox[k] as (typeof bldBox)[number], k, TREE_BUILDING_CLEAR + TREE_JITTER + TREE_RAMP);
  for (let k = 0; k < streets.length; k++) put(cellStreets, stBox[k] as (typeof stBox)[number], k, TREE_STREET_CLEAR + TREE_JITTER + TREE_RAMP);
  for (let k = 0; k < discs.length; k++) put(cellDiscs, discBox[k] as (typeof discBox)[number], k, TREE_STREET_CLEAR + TREE_JITTER + TREE_RAMP);
  const index: Index = { x0: bx0, z0: bz0, nx, nz, blocks, buildings, streets, discs, cellBlocks, cellBuildings, cellStreets, cellDiscs };
  INDEX.set(plan, index);
  return index;
}

/** A block's window at a point: 1 inside it, falling to 0 `BLOCK_MARGIN` metres outside its edges. */
function blockWindow(edges: readonly Edge[], x: number, z: number): number {
  let v = 1;
  for (let i = 0; i < edges.length; i++) {
    const e = edges[i] as Edge;
    const d = e.nx * x + e.nz * z - e.c;
    if (d <= -BLOCK_MARGIN) return 0;
    if (d < 0) v *= smootherstepD(-BLOCK_MARGIN, 0, d).v;
  }
  return v;
}

/** A block's window with its edges moved out by `off` metres (1 inside them and up to `off` beyond, falling to 0 over `ramp` more). */
function blockWindowOff(edges: readonly Edge[], x: number, z: number, off: number, ramp: number): number {
  let v = 1;
  for (let i = 0; i < edges.length; i++) {
    const e = edges[i] as Edge;
    const d = e.nx * x + e.nz * z - e.c;
    if (d <= -off - ramp) return 0;
    if (d < -off) v *= smootherstepD(-off - ramp, -off, d).v;
  }
  return v;
}

/** The distance from a point to a building's footprint (0 inside it). */
function footprintDistance(f: Footprint, x: number, z: number): number {
  const dx = x - f.cx;
  const dz = z - f.cz;
  const lu = Math.abs(dx * f.ux + dz * f.uz) - f.hu;
  const lv = Math.abs(dx * f.vx + dz * f.vz) - f.hv;
  const a = lu > 0 ? lu : 0;
  const b = lv > 0 ? lv : 0;
  return Math.sqrt(a * a + b * b);
}

/** The distance from a point to a street's surface (its right of way), 0 on it. */
function streetDistance(s: Streetway, x: number, z: number): number {
  const abx = s.bx - s.ax;
  const abz = s.bz - s.az;
  const l2 = abx * abx + abz * abz;
  let t = l2 === 0 ? 0 : ((x - s.ax) * abx + (z - s.az) * abz) / l2;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  const dx = x - (s.ax + abx * t);
  const dz = z - (s.az + abz * t);
  const d = Math.sqrt(dx * dx + dz * dz) - s.half;
  return d > 0 ? d : 0;
}

/** What the town leaves of the forest at a point of the plan's frame: a share of its trees, of its ground cover, and the yard weight. */
export type Clear = { tree: number; clutter: number; yard: number; meadow: number };

const OPEN: Clear = Object.freeze({ tree: 1, clutter: 1, yard: 0, meadow: 0 });

/** The street's own frame at a point: how far along it, how far to its left (signed), and its length. */
function streetCoords(s: Streetway, x: number, z: number): { s: number; t: number; len: number } {
  const abx = s.bx - s.ax;
  const abz = s.bz - s.az;
  const len = Math.sqrt(abx * abx + abz * abz);
  const tx = abx / len;
  const tz = abz / len;
  return { s: (x - s.ax) * tx + (z - s.az) * tz, t: -(x - s.ax) * tz + (z - s.az) * tx, len };
}

/**
 * What a street's right of way lets grow at a point inside it: nothing within `PAVEMENT_CLEAR` of the roadway's edge (the curb, the gutter
 * and the trough under them), nothing on a sidewalk's slabs but a little over the back 45 cm, a little on a gravel shoulder, and on a
 * verge the grass of the lot beside it (the owner's mowing), thinned.
 */
function gridFactor(plan: TownPlan, sw: Streetway, x: number, z: number): { clutter: number; meadow: number } {
  const c = streetCoords(sw, x, z);
  if (c.s < -0.5 || c.s > c.len + 0.5) return { clutter: 1, meadow: 1 };
  const at = c.t < 0 ? -c.t : c.t;
  if (at <= sw.cw + PAVEMENT_CLEAR) return { clutter: 0, meadow: 0 };
  const edge = plan.edges[sw.id];
  if (edge === undefined) return { clutter: 1, meadow: 1 };
  const side = edge.sides[c.t > 0 ? 0 : 1];
  const run = side.walk > 0 ? walkAt(side, c.s) : null;
  if (run !== null && at >= sw.half - side.walk) return { clutter: at > sw.half - 0.45 ? WALK_EDGE_CLUTTER : 0, meadow: 0 };
  if (!side.curb && at < sw.cw + side.verge) return { clutter: SHOULDER_CLUTTER, meadow: 0 };
  // The verge: the grass of the lot beside it, four metres past the right of way's edge.
  const abx = sw.bx - sw.ax;
  const abz = sw.bz - sw.az;
  const len = Math.sqrt(abx * abx + abz * abz);
  const sgn = c.t > 0 ? 1 : -1;
  const px = sw.ax + (abx / len) * c.s - (abz / len) * sgn * (sw.half + 4);
  const pz = sw.az + (abz / len) * c.s + (abx / len) * sgn * (sw.half + 4);
  const id = lotIdAt(plan, px, pz);
  const y = id >= 0 ? plan.yards[id] : undefined;
  if (y === undefined || y.kind === "paved") return { clutter: id >= 0 ? 0 : 1, meadow: 0 };
  const m = YARD_MASK[y.kind];
  // The grass comes up from the pavement's edge over the next 0.8 m, not as a wall.
  const ramp = smootherstepD(sw.cw + PAVEMENT_CLEAR, sw.cw + PAVEMENT_CLEAR + 0.8, at).v;
  return { clutter: m.clutter * VERGE_CLUTTER * ramp, meadow: m.meadow * VERGE_MEADOW * ramp };
}

/** An alley: the wheel tracks keep the grass off; between them and beside them it grows. */
function alleyFactor(sw: Streetway, x: number, z: number): { clutter: number; meadow: number } {
  const c = streetCoords(sw, x, z);
  const at = c.t < 0 ? -c.t : c.t;
  return at > TRACK_FROM && at < TRACK_TO ? { clutter: 0, meadow: 0 } : { clutter: 0.8, meadow: 0.5 };
}

/** What the town leaves of the forest at a point of the plan's frame. */
export function clearAt(plan: TownPlan, xf: number, zr: number): Clear {
  const index = indexOf(plan);
  const i = Math.floor((xf - index.x0) / CELL);
  const j = Math.floor((zr - index.z0) / CELL);
  if (i < 0 || j < 0 || i >= index.nx || j >= index.nz) return OPEN;
  const cell = i * index.nz + j;
  let paved = 0;
  let yard = 0;
  // Beyond a paved block's edge nothing is let grow that could stand on it: an instance stands off its cell's middle by its jitter
  // (the ground here reads as soil, not sand, under the strip, so the beach no longer keeps those out: `townStripWeight`).
  let pavedTree = 0;
  let pavedClutter = 0;
  const blocks = index.cellBlocks[cell] as readonly number[];
  for (let k = 0; k < blocks.length; k++) {
    const b = index.blocks[blocks[k] as number] as (typeof index.blocks)[number];
    const w = blockWindow(b.edges, xf, zr);
    if (b.paved) {
      const wt = blockWindowOff(b.edges, xf, zr, TREE_JITTER * 1.5, BLOCK_MARGIN);
      if (wt > pavedTree) pavedTree = wt;
      const wc = blockWindowOff(b.edges, xf, zr, CLUTTER_JITTER * 1.5, BLOCK_MARGIN);
      if (wc > pavedClutter) pavedClutter = wc;
    }
    if (w === 0) continue;
    if (b.paved) paved = 1 - (1 - paved) * (1 - w);
    else yard = 1 - (1 - yard) * (1 - w);
  }
  // The town's own ground: paved, or yard (where the two meet a block's margin, paved wins).
  const town = 1 - (1 - paved) * (1 - yard);
  const lawn = yard * (1 - paved);
  // A yard is its lot's: its kind (`port/yards.ts`) says how thick and tall the grass stands and how many trees, and a drive or a walk keeps the grass off.
  let treeY = YARD_TREE;
  let clutterY = YARD_CLUTTER;
  let meadowY = YARD_MEADOW;
  let driveShut = false;
  if (lawn > 0) {
    const id = lotIdAt(plan, xf, zr);
    const yard2 = id >= 0 ? plan.yards[id] : undefined;
    if (yard2 !== undefined && yard2.kind !== "paved") {
      const m = YARD_MASK[yard2.kind];
      treeY = m.tree;
      clutterY = m.clutter;
      meadowY = m.meadow;
      const shape = yardShape(plan, id);
      if ((shape.drive !== null && inYardRect(shape.drive, xf, zr, 0.3)) || (shape.walk !== null && inYardRect(shape.walk, xf, zr, 0.2))) driveShut = true;
    }
  }
  let tree = 1 - town + lawn * treeY;
  let clutter = 1 - town + lawn * clutterY;
  let meadow = lawn * meadowY;
  if (driveShut) {
    clutter = 0;
    tree = 0;
    meadow = 0;
  }
  const streets = index.cellStreets[cell] as readonly number[];
  for (let k = 0; k < streets.length; k++) {
    const sw = index.streets[streets[k] as number] as Streetway;
    const d = streetDistance(sw, xf, zr);
    const shut = TREE_STREET_CLEAR + TREE_JITTER;
    if (d < shut + TREE_RAMP) tree *= smootherstepD(shut, shut + TREE_RAMP, d).v;
    if (sw.kind === "other") {
      const cshut = CLUTTER_STREET_CLEAR + CLUTTER_JITTER;
      if (d < cshut + CLUTTER_RAMP) clutter *= smootherstepD(cshut, cshut + CLUTTER_RAMP, d).v;
    } else if (d <= 0) {
      const z = sw.kind === "alley" ? alleyFactor(sw, xf, zr) : gridFactor(plan, sw, xf, zr);
      clutter *= z.clutter;
      meadow *= z.meadow;
    }
  }
  const discs = index.cellDiscs[cell] as readonly number[];
  for (let k = 0; k < discs.length; k++) {
    const dc = index.discs[discs[k] as number] as Disc;
    const ddx = xf - dc.x;
    const ddz = zr - dc.z;
    const d = Math.max(0, Math.sqrt(ddx * ddx + ddz * ddz) - dc.r);
    const shut = TREE_STREET_CLEAR + TREE_JITTER;
    if (d < shut + TREE_RAMP) tree *= smootherstepD(shut, shut + TREE_RAMP, d).v;
    const cshut = CLUTTER_STREET_CLEAR + CLUTTER_JITTER;
    if (dc.bare && d < cshut + CLUTTER_RAMP) clutter *= smootherstepD(cshut, cshut + CLUTTER_RAMP, d).v;
  }
  const buildings = index.cellBuildings[cell] as readonly number[];
  for (let k = 0; k < buildings.length; k++) {
    const d = footprintDistance(index.buildings[buildings[k] as number] as Footprint, xf, zr);
    const shut = TREE_BUILDING_CLEAR + TREE_JITTER;
    if (d < shut + TREE_RAMP) tree *= smootherstepD(shut, shut + TREE_RAMP, d).v;
    const cshut = CLUTTER_BUILDING_CLEAR + CLUTTER_JITTER;
    if (d < cshut + CLUTTER_RAMP) clutter *= smootherstepD(cshut, cshut + CLUTTER_RAMP, d).v;
  }
  if (pavedTree > 0) tree *= 1 - pavedTree;
  if (pavedClutter > 0) {
    clutter *= 1 - pavedClutter;
    meadow *= 1 - pavedClutter;
  }
  return { tree, clutter, yard: lawn, meadow };
}

/**
 * The feature mask the engine reads at a point: trees and ground cover by the lot (see the header), the yard's grass
 * thickened by `meadow`, and nothing loose on the town.
 */
export function townFeatureMask(seed: number, x: number, z: number): FeatureMask {
  const plan = planFor(seed);
  const site = siteFor(seed);
  const xf = x - site.anchor.x;
  const zr = z - COVE_Z;
  const c = clearAt(plan, xf, zr);
  const cover = coverD(plan, xf, zr).v;
  const loose = cover === 0 ? 1 : 1 - cover;
  if (c.tree === 1 && c.clutter === 1 && c.meadow === 0 && loose === 1) return { tree: 1, clutter: 1, meadow: 0, bare: 0 };
  return { tree: c.tree, clutter: c.clutter, meadow: c.meadow, bare: 0, loose };
}

/** The place's shore strip (`CoastOverlay.shoreStrip`): a yard's weight, which lifts the height the shore's rules read there by `YARD_LIFT`. */
export function townYardWeight(seed: number, x: number, z: number): number {
  const plan = planFor(seed);
  const site = siteFor(seed);
  return clearAt(plan, x - site.anchor.x, z - COVE_Z).yard;
}

/**
 * The place's shore strip (`CoastOverlay.shoreStrip`): how far a place is made ground that is not beach, 0 to 1. The engine
 * paints the terrain by its height, and the town's flats (2 to 3 m) would paint as pebble and sand, so where the town is the
 * shore's rules read the ground `YARD_LIFT` m higher, as ground that paints as soil. That is a yard (the lot's lawn), a paved
 * block (the core, the dock end, the working waterfront: its pavement is laid over soil, and the margin around it shows) and every
 * street's right of way (roadway, curbs, sidewalks, shoulders, verge, and the junctions' pavement, which lies within the streets'
 * ways) and `STRIP_RAMP` beyond it. Under a street the terrain is cut out of sight (`streetField.ts`), so what shows of it where
 * the drawn surface fails to hide it (an edge, a coarse ring) is dirt at the edge of the asphalt, never a stripe of sand.
 */
export function townStripWeight(seed: number, x: number, z: number): number {
  const plan = planFor(seed);
  const site = siteFor(seed);
  const xf = x - site.anchor.x;
  const zr = z - COVE_Z;
  const index = indexOf(plan);
  const i = Math.floor((xf - index.x0) / CELL);
  const j = Math.floor((zr - index.z0) / CELL);
  if (i < 0 || j < 0 || i >= index.nx || j >= index.nz) return 0;
  const cell = i * index.nz + j;
  let w = 0;
  const blocks = index.cellBlocks[cell] as readonly number[];
  for (let k = 0; k < blocks.length; k++) {
    const b = index.blocks[blocks[k] as number] as (typeof index.blocks)[number];
    const bw = blockWindow(b.edges, xf, zr);
    if (bw > w) w = bw;
  }
  const streets = index.cellStreets[cell] as readonly number[];
  for (let k = 0; k < streets.length; k++) {
    const d = streetDistance(index.streets[streets[k] as number] as Streetway, xf, zr);
    if (d >= STRIP_RAMP) continue;
    const sw = 1 - smootherstepD(0, STRIP_RAMP, d).v;
    if (sw > w) w = sw;
  }
  // The yard's own weight is its lawn's (a block's window with the paved blocks' taken out): never less than it was.
  const yard = clearAt(plan, xf, zr).yard;
  return yard > w ? yard : w;
}
