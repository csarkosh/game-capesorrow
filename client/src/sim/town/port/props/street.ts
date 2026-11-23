/**
 * What stands on the sidewalks and what lies on them, each from its cause (never scattered; every number is authored, none researched).
 *
 * - **Trash cans** at the foot of a food trade's front (a cafe, diner, tavern, bakery, the mini mart), and at the corner where a run begins: kept, overflowing
 *   (more where the street is old and little kept up), and now and then knocked over.
 * - **Newspaper boxes** by the post office, a cafe, a diner, the grocery and the mini mart; one in four stands empty with its door open.
 * - **Benches** on the main street and the avenue where the traffic is, a few to a block, facing the shops.
 * - **Hydrants** at the corners of the blocks. **Sign posts** at the corners of the main street (parking, loading, no parking), leaning.
 * - **Planters** by the shops (not the food trades, who have a can): most are dead or weedy; a vacant unit's is always dead.
 * - **Bike racks** by the cafes, the bookstore, the gallery. A **utility pedestal** on the verge of an older street now and then.
 * - **Litter** collects: round a can (more of it when it overflows), at the door of a tavern or the mini mart (cups and cigarette ends), at the door of a
 *   vacant unit (paper and boxes), against the kerb along a run (more on the lee side, the north-east, since the weather comes off the sea from the
 *   south-west), and a bag caught at the foot of a fence.
 *
 * Nothing stands within 2 m of a door (along the street) or in the walking line of a sidewalk (the middle of its width): furniture is on the kerb side, planters on
 * the shop side only where the sidewalk is wide. Only the bench is solid.
 */
import { chance, next, range } from "../../rng.js";
import type { FurnitureKind, LitterKind, Trade, Vec, WalkRun } from "../../types.js";
import { boxAt } from "./boxes.js";
import { segDist } from "../../geom.js";
import { sub, type Context, type LotInfo, type StreetFrame } from "./context.js";
import { put, type Out } from "./out.js";
import { TAG } from "./vehicles.js";

const FOOD: readonly Trade[] = ["cafe", "diner", "restaurant", "tavern", "bakery", "espresso stand", "pizza and burgers", "convenience store"];
const PAPERS: readonly Trade[] = ["post office", "cafe", "diner", "grocery", "convenience store"];
const BIKES: readonly Trade[] = ["cafe", "bookstore", "gallery", "espresso stand", "game shop"];
const SMOKY: readonly Trade[] = ["tavern", "convenience store", "bait and tackle", "smoke shop", "liquor store"];
/** The share of a can that is overflowing, by the street's era (the older ones are kept less). */
const OVERFLOW: Readonly<Record<"core" | "old" | "later" | "edge", number>> = { core: 0.3, old: 0.35, later: 0.2, edge: 0.15 };

type Spot = { readonly sign: 1 | -1; readonly t0: number; readonly walk: number };
type R = { state: number };

/** A point `s` along a street and `t` to its left. */
function pt(f: StreetFrame, s: number, t: number): Vec {
  return { x: f.ax + f.tx * s + f.nx * t, z: f.az + f.tz * s + f.nz * t };
}

function runAt(runs: readonly WalkRun[], s: number): boolean {
  for (const r of runs) if (s > r.s0 + 0.8 && s < r.s1 - 0.8) return true;
  return false;
}

/** The stations along the street of a lot's doors (its units' and its stair's), for keeping them clear. */
function doorStations(info: LotInfo, f: StreetFrame): number[] {
  const use = info.use;
  if (use === undefined || use.frame === null || use.frame === undefined) return [];
  const fr = use.frame;
  const out: number[] = [];
  const station = (sd: number): number => (fr.origin.x + fr.t.x * sd - f.ax) * f.tx + (fr.origin.z + fr.t.z * sd - f.az) * f.tz;
  for (const u of use.units) out.push(station(u.door.s));
  if (use.stair !== null && use.stair !== undefined) out.push(station(use.stair.s));
  return out;
}

export function planStreet(ctx: Context, out: Out): void {
  const spotOf = (f: StreetFrame, side: 0 | 1): Spot | null => {
    const e = f.edge.sides[side];
    if (e.walk < 1.5 || e.runs.length === 0) return null;
    return { sign: side === 0 ? 1 : -1, t0: f.hw + 0.2 + e.verge, walk: e.walk };
  };

  const place = (kind: FurnitureKind, x: number, z: number, hx: number, hz: number, size: readonly [number, number], state: number, lean: number, lot: number, rng: R, solid: boolean): boolean => {
    const box = boxAt(x, z, hx, hz, size[0], size[1]);
    if (!put(ctx, out, box, "furniture", { margin: 0.25, solid })) return false;
    out.furniture.push({ id: out.id(), kind, x, z, hx, hz, state, lean, colour: Math.floor(next(rng) * 6), lot, seed: Math.floor(next(rng) * 0x7fffffff) });
    return true;
  };
  // Litter keeps 0.4 m between its pieces, and out of every keep-out and building.
  const litterAt: Vec[] = [];
  const drop = (kind: LitterKind, x: number, z: number, rng: R): boolean => {
    for (const q of litterAt) if ((q.x - x) * (q.x - x) + (q.z - z) * (q.z - z) < 0.16) return false;
    const a = next(rng) * 2 - 1;
    const c = Math.sqrt(Math.max(0, 1 - a * a));
    if (ctx.occ.hits(boxAt(x, z, 1, 0, 0.14, 0.14), 0.15)) return false;
    for (const st of rails) if (segDist({ x, z }, st.a, st.b) < st.width / 2 + 3) return false;
    litterAt.push({ x, z });
    out.litter.push({ x, z, hx: c * (next(rng) < 0.5 ? 1 : -1), hz: a, kind, seed: Math.floor(next(rng) * 0x7fffffff) });
    return true;
  };
  // Litter is laid once everything that stands has its place, so none lands on a can or a bench: a spill is a request, run at the end.
  const pending: (() => void)[] = [];
  /** A cluster of pieces within `r` metres of (s, t) along a street. */
  const spill = (f: StreetFrame, s: number, t: number, count: number, r: number, kinds: readonly LitterKind[], rng: R): void => {
    pending.push(() => {
      for (let k = 0; k < count; k++) {
        const p = pt(f, s + range(rng, -r, r), t + range(rng, -r * 0.4, r * 0.4));
        drop(kinds[Math.floor(next(rng) * kinds.length)] as LitterKind, p.x, p.z, rng);
      }
    });
  };
  const rails = ctx.plan.streets.filter((st) => st.kind === "rail");

  // ---- the corners of each run: a hydrant, a sign post, a can, litter against the kerb
  for (const f of ctx.frames) {
    if (f === undefined) continue;
    const k = f.street.kind;
    if (k !== "main" && k !== "avenue" && k !== "street") continue;
    for (const side of [0, 1] as const) {
      const sp = spotOf(f, side);
      if (sp === null) continue;
      const e = f.edge.sides[side];
      const rng = sub(ctx.seed0, TAG.furn, f.street.id * 4 + side);
      const curb = sp.t0 + 0.4;
      for (const run of e.runs) {
        const corners: [number, number][] = [[run.s0 + 1.6, 1], [run.s1 - 1.6, -1]];
        for (const [s, dir] of corners) {
          if (s < 2 || s > f.length - 2) continue;
          const p = pt(f, s, sp.sign * curb);
          if (chance(rng, 0.16 + (side === 0 ? 0.06 : 0))) {
            place("hydrant", p.x, p.z, f.tx, f.tz, [0.45, 0.45], 0, 0, -1, rng, false);
            continue;
          }
          if (k === "main" && chance(rng, 0.5)) {
            const lean = range(rng, -0.12, 0.12);
            if (place("sign post", p.x, p.z, f.tx * dir, f.tz * dir, [0.25, 0.25], chance(rng, 0.2) ? 1 : chance(rng, 0.2) ? 2 : 0, lean, -1, rng, false)) continue;
          }
          if (chance(rng, 0.4)) {
            const q = pt(f, s + dir * 1.1, sp.sign * curb);
            const state = chance(rng, OVERFLOW[f.edge.era]) ? 1 : chance(rng, 0.08) ? 2 : 0;
            if (place("trash can", q.x, q.z, f.tx, f.tz, [0.6, 0.6], state, state === 2 ? 0 : range(rng, -0.04, 0.04), -1, rng, false)) spill(f, s + dir * 1.1, sp.sign * (curb + 0.35), state === 1 ? 5 : state === 2 ? 3 : 1, 1.1, ["cup", "paper", "can", "bottle"], rng);
          }
        }
        // Against the kerb, more on the lee (north-east) side: caught cans, cups, paper.
        const lee = sp.sign * (f.nx + f.nz) > 0 ? 1 : 0.4;
        const n = Math.floor(((run.s1 - run.s0) / 16) * lee * (0.7 + f.edge.use));
        for (let j = 0; j < n; j++) {
          const s = range(rng, run.s0 + 2, run.s1 - 2);
          spill(f, s, sp.sign * (sp.t0 + 0.15), 2 + Math.floor(next(rng) * 3), 1.4, ["can", "cup", "paper", "paper", "butt", "bottle"], rng);
        }
      }
    }
  }

  // ---- by the frontages
  for (const info of ctx.lots) {
    const b = info.building;
    if (b === undefined || info.street < 0 || info.frontLen < 4) continue;
    const f = ctx.frames[info.street];
    if (f === undefined) continue;
    const k = f.street.kind;
    if (k !== "main" && k !== "avenue" && k !== "street") continue;
    const sp = spotOf(f, info.side);
    if (sp === null) continue;
    const rng = sub(ctx.seed0, TAG.furn, 1000 + info.lot.id);
    const mx = info.ox + info.tx * info.frontLen * 0.5;
    const mz = info.oz + info.tz * info.frontLen * 0.5;
    const s0 = (mx - f.ax) * f.tx + (mz - f.az) * f.tz;
    const e = f.edge.sides[info.side];
    if (!runAt(e.runs, s0)) continue;
    const trade = info.trade;
    const vacant = b.state === "vacant" || (info.use !== undefined && info.use.units.some((u) => u.state.startsWith("vacant")));
    const doors = doorStations(info, f);
    const free = (s: number): boolean => doors.every((d) => Math.abs(d - s) > 2) && runAt(e.runs, s);
    const curb = sp.t0 + 0.4;
    const shop = sp.t0 + sp.walk - 0.4;
    const spots = (): number => s0 + range(rng, -info.frontLen * 0.3, info.frontLen * 0.3);
    const old = f.edge.era === "core" || f.edge.era === "old";
    if (trade !== null && FOOD.includes(trade) && chance(rng, 0.55)) {
      const s = spots();
      if (free(s)) {
        const p = pt(f, s, sp.sign * curb);
        const state = chance(rng, OVERFLOW[f.edge.era] + 0.1) ? 1 : chance(rng, 0.07) ? 2 : 0;
        if (place("trash can", p.x, p.z, f.tx, f.tz, [0.6, 0.6], state, state === 2 ? 0 : range(rng, -0.04, 0.04), info.lot.id, rng, false)) spill(f, s, sp.sign * (curb + 0.35), state === 1 ? 6 : state === 2 ? 3 : 2, 1.2, ["cup", "paper", "can", "bottle", "bag"], rng);
      }
    }
    if (trade !== null && PAPERS.includes(trade) && chance(rng, 0.75)) {
      const s = spots();
      if (free(s)) {
        const p = pt(f, s, sp.sign * curb);
        place("newspaper box", p.x, p.z, -f.nx * sp.sign, -f.nz * sp.sign, [0.45, 0.4], chance(rng, 0.25) ? 1 : 0, range(rng, -0.03, 0.03), info.lot.id, rng, false);
      }
    }
    if ((k === "main" || k === "avenue") && f.edge.use > 0.5 && sp.walk >= 3 && chance(rng, 0.3)) {
      const s = spots();
      if (free(s)) {
        const p = pt(f, s, sp.sign * curb);
        place("bench", p.x, p.z, f.tx, f.tz, [1.7, 0.6], 0, 0, info.lot.id, rng, true);
      }
    }
    if (trade !== null && BIKES.includes(trade) && chance(rng, 0.55)) {
      const s = spots();
      if (free(s)) {
        const p = pt(f, s, sp.sign * curb);
        place("bike rack", p.x, p.z, f.tx, f.tz, [1.3, 0.4], 0, 0, info.lot.id, rng, false);
      }
    }
    // A planter on the shop side of a wide sidewalk, or the one a vacant unit left: most are dead or gone to weed.
    if (sp.walk >= 2.8 && (vacant || (trade !== null && !FOOD.includes(trade) && chance(rng, 0.5))) && chance(rng, 0.8)) {
      const s = s0 + (chance(rng, 0.5) ? 1 : -1) * info.frontLen * 0.34;
      if (free(s)) {
        const p = pt(f, s, sp.sign * shop);
        place("planter", p.x, p.z, f.tx, f.tz, [0.8, 0.5], vacant || chance(rng, 0.45) ? 1 : 0, 0, info.lot.id, rng, false);
      }
    }
    if (k === "street" && old && e.verge > 0.7 && chance(rng, 0.06)) {
      const p = pt(f, s0 + range(rng, -3, 3), sp.sign * (f.hw + 0.2 + e.verge * 0.5));
      place("pedestal", p.x, p.z, f.tx, f.tz, [0.55, 0.45], 0, range(rng, -0.03, 0.03), info.lot.id, rng, false);
    }
    // Litter at the doors that make it: a tavern's and the mini mart's (cups, ends), a vacant unit's (paper, boxes).
    const lr = sub(ctx.seed0, TAG.litter, info.lot.id);
    for (const d of doors) {
      if (!runAt(e.runs, d)) continue;
      const near = sp.t0 + sp.walk - 0.9;
      if (trade !== null && SMOKY.includes(trade) && chance(lr, 0.85)) spill(f, d + range(lr, -1.2, 1.2), sp.sign * near, 5, 1.3, ["butt", "butt", "cup", "can", "butt"], lr);
      if (vacant && chance(lr, 0.8)) spill(f, d, sp.sign * (near + 0.2), 4, 1.1, ["paper", "box", "paper", "bag"], lr);
    }
  }

  for (const run of pending) run();

  // ---- a bag (or a cup) caught at the foot of a fence
  for (let i = 0; i < out.fences.length; i++) {
    const fe = out.fences[i] as (typeof out.fences)[number];
    const rng = sub(ctx.seed0, TAG.litter, 500000 + i);
    if (!chance(rng, 0.3)) continue;
    const ex = fe.bx - fe.ax;
    const ez = fe.bz - fe.az;
    const len = Math.sqrt(ex * ex + ez * ez);
    if (!(len > 2)) continue;
    const s = range(rng, 0.8, len - 0.8);
    const side = next(rng) < 0.5 ? 1 : -1;
    const x = fe.ax + (ex / len) * s - (ez / len) * 0.28 * side;
    const z = fe.az + (ez / len) * s + (ex / len) * 0.28 * side;
    drop(next(rng) < 0.6 ? "bag" : "paper", x, z, rng);
  }
}
