/**
 * The town thins out instead of stopping. Past the last full blocks, along the highway north and south, and along the roads out, there
 * are scattered single buildings on their own lots, each with a reason to be there: a gas station and a motel on the highway where the
 * through traffic is, a tavern just past the limits, a church on land given for it, houses on large lots, a junkyard where land is cheap,
 * a shake mill, a volunteer fire hall. There are fewer the further out (`OUT_P0` falling to nothing at `OUT_REACH`), and each stands only on
 * land the plan can build on (`land.ts`: gentle, high enough, off the railroad's corridor and the highway's bed, not on a headland's tongue).
 *
 * Each building stands in a lot that is a block of its own (district `outskirts`), so its ground and its clearing come through the cover and
 * the clearing as any block's do. Lots and buildings stand on the compass axes, facing the highway or the road they are beside.
 */
import { COMPASS } from "../bearings.js";
import { buildableAt, type Land } from "../land.js";
import { RAIL_OFFSET, RAIL_CORRIDOR_HALF } from "../rail.js";
import { chance, pick, range, weighted, type Rng } from "../rng.js";
import { roadAt, shoreAt } from "../shore.js";
import type { TownSite } from "../site.js";
import { segDist, type Poly, type Vec } from "../geom.js";
import { polyGap } from "./growth.js";
import { SIZING } from "./sizing.js";
import type { Block, Building, Street, BuildingKind, BuildingState, History, Lot, Material, Outskirt, Road, Roof } from "../types.js";

/** How far past the town's last block the highway's buildings reach, metres (it was 560: the town is condensed, so this is about half, and the single buildings of its thin edge stand nearer it; AUTHORED), and the spacing of the places along it. */
export const OUT_REACH = SIZING.OUT_REACH;
export const OUT_START = 70;
export const OUT_STEP = 34;
/** The chance of a place at the town's edge having a building, falling to nothing at `OUT_REACH` as the fraction left to the power 1.25. */
export const OUT_P0 = 0.8;
/** Along a road out: how far from the street's end, the spacing, the chance at the start, how far off the road's centre line the lot's edge stands, metres. */
export const OUT_ROAD_REACH = 240;
export const OUT_ROAD_STEP = 60;
export const OUT_ROAD_P0 = 0.45;
export const OUT_ROAD_OFFSET = 20;
/** A lot keeps this far from the town's blocks, from another lot and from a road out, metres. */
export const OUT_BLOCK_CLEAR = 10;
export const OUT_LOT_CLEAR = 8;
export const OUT_ROAD_CLEAR = 12;
/** A lot's ground is tested this far inside its edges (so the highway's bed and the rail's corridor margin do not count against a lot beside them), metres. */
const INSET = 2.5;
/** A lot beside the highway stands this far off its centre line on the east side (just off the bed), and this much seaward of the rail's corridor on the west. */
const EAST_EDGE = 14;
const WEST_EDGE = RAIL_OFFSET + RAIL_CORRIDOR_HALF + 4;

/** The places a lot is tried at when the ground does not take it: how far along the highway it is shifted, metres, and its size as a share of the draw. */
const TRIES: readonly (readonly [number, number])[] = [[0, 1], [22, 1], [-22, 1], [0, 0.8], [30, 0.8], [-30, 0.8]];

export const OUTSKIRT_TUNABLES = { OUT_REACH, OUT_START, OUT_STEP, OUT_P0, OUT_ROAD_REACH, OUT_ROAD_STEP, OUT_ROAD_P0, OUT_ROAD_OFFSET, OUT_BLOCK_CLEAR, OUT_LOT_CLEAR, OUT_ROAD_CLEAR };

type Kind = {
  readonly kind: BuildingKind;
  /** The lot's frontage along the road and its depth, and the building's: along the frontage, and deep. */
  readonly lotW: [number, number];
  readonly lotD: [number, number];
  readonly w: [number, number];
  readonly d: [number, number];
  readonly setback: [number, number];
  readonly storeys: number;
  readonly roof: Roof;
  readonly height: [number, number];
  readonly materials: readonly Material[];
  readonly era: [number, number];
  readonly reason: string;
};

const KINDS: Record<string, Kind> = {
  gas: { kind: "gas station", lotW: [40, 60], lotD: [35, 50], w: [12, 14], d: [9, 10], setback: [14, 20], storeys: 1, roof: "flat", height: [4.4, 4.8], materials: ["stucco", "metal"], era: [1950, 1990], reason: "a gas station on the highway where the last blocks end, for the through traffic" },
  motel: { kind: "motel", lotW: [70, 90], lotD: [40, 55], w: [34, 40], d: [11, 12.5], setback: [10, 16], storeys: 1, roof: "hip", height: [4, 5], materials: ["stucco", "wood"], era: [1950, 1975], reason: "a motel on the highway beyond the last blocks, for travellers who do not stop in town" },
  house: { kind: "house", lotW: [36, 60], lotD: [45, 75], w: [9, 12], d: [8, 11], setback: [10, 20], storeys: 1, roof: "gable", height: [4.5, 6], materials: ["wood", "stucco"], era: [1920, 1990], reason: "a house on a large lot, from before the town's lots reached it or by those who wanted room" },
  church: { kind: "church", lotW: [50, 70], lotD: [60, 80], w: [12, 15], d: [24, 30], setback: [12, 20], storeys: 1, roof: "gable", height: [12, 15], materials: ["wood"], era: [1900, 1960], reason: "a church on land given for it, outside the town's lots" },
  tavern: { kind: "tavern", lotW: [45, 60], lotD: [40, 55], w: [14, 18], d: [10, 13], setback: [10, 16], storeys: 1, roof: "gable", height: [5, 6.5], materials: ["wood", "stucco"], era: [1930, 1975], reason: "a tavern just past the town's limits, where the town's rules end" },
  junkyard: { kind: "junkyard", lotW: [60, 85], lotD: [60, 85], w: [10, 14], d: [7, 10], setback: [10, 20], storeys: 1, roof: "shed", height: [3, 4], materials: ["metal"], era: [1950, 1990], reason: "a junkyard, where land is cheap and nobody minds the view" },
  shake: { kind: "shake mill", lotW: [60, 85], lotD: [55, 80], w: [26, 32], d: [13, 16], setback: [8, 14], storeys: 1, roof: "gable", height: [7, 9], materials: ["wood", "metal"], era: [1920, 1965], reason: "a shake mill beside the highway, near the cedar and the road to take the shakes out" },
  fire: { kind: "fire hall", lotW: [45, 60], lotD: [45, 60], w: [15, 18], d: [16, 20], setback: [8, 14], storeys: 1, roof: "flat", height: [6, 7.5], materials: ["concrete", "stucco"], era: [1950, 1985], reason: "a volunteer fire hall at the town's edge, where the district's engines stand" },
  garage: { kind: "garage", lotW: [40, 55], lotD: [40, 50], w: [12, 16], d: [13, 16], setback: [8, 14], storeys: 1, roof: "gable", height: [4.5, 6], materials: ["metal", "wood"], era: [1930, 1980], reason: "a repair garage on the highway, for those the town's garages do not reach" },
};

export type OutskirtsInput = {
  readonly site: TownSite;
  readonly land: Land;
  readonly history: History;
  readonly blocks: readonly Block[];
  readonly roads: readonly Road[];
  /** The town's streets (the highway is the lot's own side, kept by its offset). */
  readonly streets: readonly Street[];
  /** The next ids to hand out. */
  readonly nextBlock: number;
  readonly nextLot: number;
  readonly nextBuilding: number;
};

export type OutskirtsOut = { blocks: Block[]; lots: Lot[]; buildings: Building[]; outskirts: Outskirt[] };

function rect(x0: number, z0: number, x1: number, z1: number): Poly {
  return [{ x: x0, z: z0 }, { x: x1, z: z0 }, { x: x1, z: z1 }, { x: x0, z: z1 }];
}

/** The gap between two axis-aligned rectangles (0 where they touch or overlap). */
function rectGap(a: Poly, b: Poly): number {
  const ax0 = a[0]!.x;
  const az0 = a[0]!.z;
  const ax1 = a[2]!.x;
  const az1 = a[2]!.z;
  const bx0 = b[0]!.x;
  const bz0 = b[0]!.z;
  const bx1 = b[2]!.x;
  const bz1 = b[2]!.z;
  const dx = Math.max(0, bx0 - ax1, ax0 - bx1);
  const dz = Math.max(0, bz0 - az1, az0 - bz1);
  return Math.sqrt(dx * dx + dz * dz);
}

/** Does every part of a lot (tested every 8 m inside its edges) stand on land that can be built on? */
function groundOk(land: Land, site: TownSite, lot: Poly): boolean {
  const x0 = lot[0]!.x + INSET;
  const z0 = lot[0]!.z + INSET;
  const x1 = lot[2]!.x - INSET;
  const z1 = lot[2]!.z - INSET;
  const nx = Math.max(1, -Math.floor(-(x1 - x0) / 8));
  const nz = Math.max(1, -Math.floor(-(z1 - z0) / 8));
  for (let i = 0; i <= nx; i++) {
    for (let j = 0; j <= nz; j++) {
      const x = x0 + ((x1 - x0) * i) / nx;
      const z = z0 + ((z1 - z0) * j) / nz;
      if (!buildableAt(land, x, z)) return false;
      if (x < shoreAt(site, z) + 20) return false;
    }
  }
  return true;
}

export function planOutskirts(input: OutskirtsInput, rng: Rng): OutskirtsOut {
  const { site, land, history, blocks, roads, streets } = input;
  const out: OutskirtsOut = { blocks: [], lots: [], buildings: [], outskirts: [] };
  const taken: Poly[] = [];
  const used: string[] = [];
  const zEdge = site.z0 + (site.shoreX.length - 1) * site.step - 60;
  const zFar = site.z0 + 60;
  let zLo = Infinity;
  let zHi = -Infinity;
  for (const b of blocks) {
    for (const q of b.polygon) {
      zLo = Math.min(zLo, q.z);
      zHi = Math.max(zHi, q.z);
    }
  }
  const declined = history.present.vacantShare;

  const fits = (lot: Poly): boolean => {
    if (!groundOk(land, site, lot)) return false;
    for (const b of blocks) if (polyGap(lot, b.polygon) < OUT_BLOCK_CLEAR) return false;
    for (const st of streets) {
      if (st.kind === "highway") continue;
      for (const c of [lot[0]!, lot[1]!, lot[2]!, lot[3]!, { x: (lot[0]!.x + lot[2]!.x) / 2, z: (lot[0]!.z + lot[2]!.z) / 2 }]) if (segDist(c, st.a, st.b) < st.width / 2 + OUT_LOT_CLEAR) return false;
      // A street running through the lot: its ends inside it.
      for (const e of [st.a, st.b]) if (e.x > lot[0]!.x - 6 && e.x < lot[2]!.x + 6 && e.z > lot[0]!.z - 6 && e.z < lot[2]!.z + 6) return false;
    }
    for (const t of taken) if (rectGap(lot, t) < OUT_LOT_CLEAR) return false;
    // A road out: no point of its line (every 6 m) comes within the clear distance of the lot.
    for (const road of roads) {
      for (let i = 1; i < road.points.length; i++) {
        const a = road.points[i - 1] as Vec;
        const b = road.points[i] as Vec;
        if (Math.max(a.x, b.x) < lot[0]!.x - OUT_ROAD_CLEAR || Math.min(a.x, b.x) > lot[2]!.x + OUT_ROAD_CLEAR || Math.max(a.z, b.z) < lot[0]!.z - OUT_ROAD_CLEAR || Math.min(a.z, b.z) > lot[2]!.z + OUT_ROAD_CLEAR) continue;
        for (const c of [{ x: (lot[0]!.x + lot[2]!.x) / 2, z: (lot[0]!.z + lot[2]!.z) / 2 }, lot[0]!, lot[1]!, lot[2]!, lot[3]!]) {
          if (segDist(c, a, b) < OUT_ROAD_CLEAR) return false;
        }
        const len = Math.sqrt((b.x - a.x) * (b.x - a.x) + (b.z - a.z) * (b.z - a.z));
        for (let s = 0; s <= len; s += 6) {
          const p = { x: a.x + ((b.x - a.x) * s) / len, z: a.z + ((b.z - a.z) * s) / len };
          if (p.x > lot[0]!.x - OUT_ROAD_CLEAR && p.x < lot[2]!.x + OUT_ROAD_CLEAR && p.z > lot[0]!.z - OUT_ROAD_CLEAR && p.z < lot[2]!.z + OUT_ROAD_CLEAR) return false;
        }
      }
    }
    return true;
  };

  /** Chooses what stands on a place: `near` is how far from the town, `road` for a place on a road out. */
  const choose = (near: number, road: boolean, gasLeft: boolean, motelLeft: boolean): string => {
    const hwy = history.present.highwayStrip;
    const table: [string, number][] = [["house", road ? 14 : 9]];
    if (!road && hwy && gasLeft && near < 200) table.push(["gas", 40]);
    if (!road && hwy && motelLeft && near < 300) table.push(["motel", 24]);
    if (!road) table.push(["garage", 1.2]);
    if (!used.includes("church")) table.push(["church", 1.2]);
    if (!used.includes("tavern") && !road) table.push(["tavern", 1.6]);
    if (!used.includes("junkyard")) table.push(["junkyard", road ? 3 : 1.4]);
    if (!used.includes("shake") && !road) table.push(["shake", 1.6]);
    if (!used.includes("fire") && !road && near < 260) table.push(["fire", 2.2]);
    return weighted(rng, table);
  };

  const make = (key: string, lot: Poly, front: Vec, where: Outskirt["where"]): void => {
    const k = KINDS[key] as Kind;
    const width = lot[2]!.z - lot[0]!.z;
    const depth = lot[2]!.x - lot[0]!.x;
    const w = range(rng, k.w[0], k.w[1]);
    const d = range(rng, k.d[0], k.d[1]);
    const back = Math.max(2, Math.min(k.setback[1], depth - d - 3));
    const setback = Math.min(range(rng, k.setback[0], k.setback[1]), back);
    // The front is the lot's side toward the highway or the road: its x is -1 (the lot lies east of it) or +1.
    const cx = front.x < 0 ? lot[0]!.x + setback + d / 2 : lot[2]!.x - setback - d / 2;
    const cz = (lot[0]!.z + lot[2]!.z) / 2 + range(rng, -1, 1) * Math.max(0, (width - w) / 2 - 3);
    const era = Math.round(range(rng, k.era[0], k.era[1]) / 10) * 10;
    const state: BuildingState = chance(rng, 0.05 + declined * 0.1) ? "ruin" : chance(rng, declined * 0.55) ? "vacant" : "open";
    const blockId = input.nextBlock + out.blocks.length;
    const lotId = input.nextLot + out.lots.length;
    const id = input.nextBuilding + out.buildings.length;
    out.blocks.push({ id: blockId, plat: "outskirts", polygon: lot, district: "outskirts", cell: null });
    out.lots.push({ id: lotId, block: blockId, polygon: lot, district: "outskirts", front, role: null });
    out.buildings.push({
      id,
      lot: lotId,
      centre: { x: cx, z: cz },
      halfAlong: w / 2,
      halfAcross: d / 2,
      bearing: COMPASS,
      storeys: k.storeys,
      height: Math.round(range(rng, k.height[0], k.height[1]) * 10) / 10,
      roof: k.roof,
      kind: k.kind,
      era,
      material: pick(rng, k.materials),
      state,
      front,
    });
    out.outskirts.push({ building: id, reason: k.reason, where });
    taken.push(lot);
    if (key === "church" || key === "tavern" || key === "junkyard" || key === "shake" || key === "fire") used.push(key);
  };

  // Along the highway, north and south of the town: from its last block outward, fewer the further out.
  for (const north of [true, false]) {
    let gas = true;
    let motel = true;
    for (let off = OUT_START; off <= OUT_REACH; off += OUT_STEP) {
      const z = north ? zHi + off : zLo - off;
      if (z > zEdge || z < zFar) break;
      const left = 1 - off / OUT_REACH;
      const p = OUT_P0 * left * Math.sqrt(Math.sqrt(left));
      // Only the highway's inland side: a lot on the sea's side would have to reach the highway across the railroad's line, and the plan records its crossings only for streets and roads.
      for (const side of ["east"] as const) {
        if (!chance(rng, p)) continue;
        const near = off;
        const key = choose(near, false, gas, motel);
        const k = KINDS[key] as Kind;
        const lotW = range(rng, k.lotW[0], k.lotW[1]);
        const lotD = range(rng, k.lotD[0], k.lotD[1]);
        // The ground may not take the lot where the draw put it: it is tried shifted along the highway and a size smaller.
        let lot: Poly | null = null;
        for (const [shift, shrink] of TRIES) {
          const zz = z + shift;
          if (zz > zEdge || zz < zFar) continue;
          const w = lotW * shrink;
          const d = lotD * shrink;
          // The highway bends: the lot keeps clear of it along its whole frontage.
          const rs = [-0.5, -0.25, 0, 0.25, 0.5].map((f) => roadAt(site, zz + f * w));
          const east = Math.max(...rs);
          const west = Math.min(...rs);
          const cand = side === "east" ? rect(east + EAST_EDGE, zz - w / 2, east + EAST_EDGE + d, zz + w / 2) : rect(west - WEST_EDGE - d, zz - w / 2, west - WEST_EDGE, zz + w / 2);
          if (fits(cand)) {
            lot = cand;
            break;
          }
        }
        if (lot === null) continue;
        make(key, lot, { x: side === "east" ? -1 : 1, z: 0 }, north ? "north" : "south");
        if (key === "gas") gas = false;
        if (key === "motel") motel = false;
      }
    }
  }

  // Along each road out of town, near the town: houses on large lots, now and then a junkyard.
  for (const road of roads) {
    let s = OUT_ROAD_STEP;
    let along = 0;
    let flip = false;
    for (let i = 1; i < road.points.length && along <= OUT_ROAD_REACH; i++) {
      const a = road.points[i - 1] as Vec;
      const b = road.points[i] as Vec;
      const len = Math.sqrt((b.x - a.x) * (b.x - a.x) + (b.z - a.z) * (b.z - a.z));
      while (s <= along + len && s <= OUT_ROAD_REACH) {
        const t = (s - along) / len;
        const at = { x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t };
        s += OUT_ROAD_STEP;
        flip = !flip;
        if (!chance(rng, OUT_ROAD_P0 * (1 - (s - OUT_ROAD_STEP) / OUT_ROAD_REACH))) continue;
        const key = choose(s, true, false, false);
        const k = KINDS[key] as Kind;
        const lotW = range(rng, k.lotW[0], k.lotW[1]);
        const lotD = range(rng, k.lotD[0], k.lotD[1]);
        // The lot lies on the side of the road the draw says, its front toward the road (the roads out run east and west of the axes' own; a lot faces east or west).
        const east = flip;
        let lot: Poly | null = null;
        for (const [shift, shrink] of TRIES) {
          const w = lotW * shrink;
          const d = lotD * shrink;
          const cand = east ? rect(at.x + OUT_ROAD_OFFSET, at.z + shift - w / 2, at.x + OUT_ROAD_OFFSET + d, at.z + shift + w / 2) : rect(at.x - OUT_ROAD_OFFSET - d, at.z + shift - w / 2, at.x - OUT_ROAD_OFFSET, at.z + shift + w / 2);
          if (fits(cand)) {
            lot = cand;
            break;
          }
        }
        if (lot === null) continue;
        make(key, lot, { x: east ? -1 : 1, z: 0 }, "road");
      }
      along += len;
    }
  }
  return out;
}
