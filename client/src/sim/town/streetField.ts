/**
 * How the ground sits under the streets: the roadway is what lies low.
 *
 * A real street is graded so that the sidewalk and the lots beside it stand at one level and the roadway lies a curb's face
 * below: 15 cm where the street was rebuilt (6 in, the research), less where overlays of asphalt buried the old curb
 * (`port/edges.ts` gives each stretch of roadway its `curb`), none where the street has no curb. So the made ground is cut
 * down along every roadway, by the curb's height, across the roadway and the pavement of every junction, and the sidewalk,
 * the verge and the lawns behind it keep the ground's own height. The drawing lays the street's surfaces on this ground
 * (a depth step ahead of the terrain), and the walking reads the same ground, so a person steps off a curb and down.
 *
 * - **The lowering `lower`** is `D * W`: `D` the curb's height there (a roadway's two sides may differ: the roadway lies across
 *   them like a crown's fall; a paving stretch's seam blends over 1.2 m, so a street's level steps where it was overlaid) and `W`
 *   a window, 1 over the roadway up to the curb line and falling to 0 over the next 30 cm (a grade of 0.94 at the steepest for a curb of 15 cm: a person can stand on it) (under the curb's top, which the drawing lays flat at the lots' level). A
 *   junction's pavement is lowered by the deepest of its legs' curbs, by the same window on its outline. Where two items overlap
 *   the deeper wins.
 * - **A shallow ditch** (`DITCH_DEPTH`, 22 cm) lies along a side that has none of a curb: a bump 1.8 m wide that begins beyond the
 *   shoulder. It is taken out where another street's roadway crosses it (a culvert).
 * - **The hidden trough.** (Under every roadway, with or without a curb.) The engine draws the terrain as a mesh whose vertices stand 1 m apart (2 m on the low tier), too
 *   coarse for a step of 15 cm over a few: its mesh would stand over the roadway beside the curb. The terrain is therefore cut a
 *   further `HIDDEN` (20 cm) under the roadway and its curbs, fading out over the metre beyond (under the sidewalk, which is laid
 *   over it), and what is walked and drawn is the terrain plus that: `streetLiftD`. Nothing grows or is seen in the trough: the
 *   mask (`clearing.ts`) is shut there.
 *
 * `withStreets` is the walking's side of it. Both are exact in their derivatives, as the made ground is. Simulation code: `+ - * /`, `floor`, `abs`, `min`, `max`, `sqrt` only.
 */
import type { Vec3 } from "@csarkosh/engine/sim/core";
import type { GroundField } from "@csarkosh/engine/sim/ground";
import { COVE_Z } from "@csarkosh/engine/sim/olympic";
import type { TerrainSample } from "@csarkosh/engine/sim/terrain";
import { GROUND_NORMAL_Y } from "@csarkosh/engine/sim/constants";
import { smootherstepD } from "./fill.js";
import { hasPavement } from "./junctions.js";
import { pavementPolygon } from "./junctionShape.js";
import { pavingAt } from "./port/edges.js";
import { pavedGround } from "./pavedGround.js";
import { planFor } from "./planFor.js";
import { siteFor } from "./siteFor.js";
import type { Junction, JunctionLeg, Street, StreetEdge, TownPlan, Vec } from "./types.js";

/** How far past the curb line the window falls, and how far inside it begins (metres): the roadway is whole to the curb line, and the ground is the lots' by `CURB_OUT` beyond it. */
export const CURB_IN = 0;
export const CURB_OUT = 0.3;
/** The extra cut of the terrain under a roadway and its curbs, metres, and the metres over which it fades beyond them. */
export const HIDDEN = 0.2;
export const HIDDEN_FADE = 1.4;
/** Under a sidewalk's pours the terrain is cut this much (and fades out over `WALK_FADE` beyond them): a slab lies a centimetre or two over the ground, which the terrain's mesh would poke through. */
export const HIDDEN_WALK = 0.12;
export const WALK_FADE = 0.6;
/** Under the town's other paved ground (a paved district's blocks and a lone business's apron, `pavedGround.ts`) the terrain is cut this much, fading out over `WALK_FADE` beyond it: a patch lies 4.8 cm over a ground that keeps its relief, which the terrain's mesh (an upper envelope) would stand over. */
export const HIDDEN_PAVED = 0.12;
/** A seam between two stretches of paving blends over this many metres. */
export const SEAM = 1.2;
/** A ditch: its depth, its width and how far beyond the pavement's edge its middle is (the shoulder's width, a metre and a half, and a little). */
export const DITCH_DEPTH = 0.22;
export const DITCH_WIDTH = 1.8;
export const DITCH_OFFSET = 2.6;
/** The roadway's window falls to nothing at the end of a street over this many metres. */
const END_FADE = 0.25;
const CELL = 16;
const sqrt = Math.sqrt;

export const STREET_TUNABLES: Readonly<Record<string, number>> = { HIDDEN_PAVED, HIDDEN_WALK, WALK_FADE, CURB_IN, CURB_OUT, HIDDEN, HIDDEN_FADE, SEAM, DITCH_DEPTH, DITCH_WIDTH, DITCH_OFFSET, END_FADE };

/** A value and its partials. */
type D3 = [number, number, number];

type Rect = {
  readonly kind: 0;
  readonly ax: number;
  readonly az: number;
  readonly tx: number;
  readonly tz: number;
  readonly len: number;
  readonly cw: number;
  readonly hw: number;
  readonly edge: StreetEdge;
};
type Poly = { readonly kind: 1; readonly paved?: boolean; readonly pts: readonly Vec[]; readonly depth: number; readonly x0: number; readonly z0: number; readonly x1: number; readonly z1: number };
type Item = Rect | Poly;

type Field = { readonly items: readonly Item[]; readonly x0: number; readonly z0: number; readonly nx: number; readonly nz: number; readonly cells: readonly (readonly number[])[] };

const FIELDS = new WeakMap<TownPlan, Field>();

/** The curb's height at `s` along a side: the paving's, where the side has a curb. With its slope along the street. */
function sideDepth(edge: StreetEdge, k: 0 | 1, s: number): [number, number] {
  const side = edge.sides[k];
  if (!side.curb) return [0, 0];
  const pv = edge.paving;
  let v = (pavingAt(pv, s) as { curb: number }).curb;
  let ds = 0;
  for (let i = 0; i + 1 < pv.length; i++) {
    const b = (pv[i] as { s1: number }).s1;
    if (s > b - SEAM / 2 && s < b + SEAM / 2) {
      const a = (pv[i] as { curb: number }).curb;
      const c = (pv[i + 1] as { curb: number }).curb;
      const sm = smootherstepD(b - SEAM / 2, b + SEAM / 2, s);
      v = a + (c - a) * sm.v;
      ds = (c - a) * sm.d;
    }
  }
  return [v, ds];
}

function junctionDepth(plan: TownPlan, j: Junction): number {
  let depth = 0;
  for (const l of j.legs) {
    if (l.engine || l.street < 0 || l.closed) continue;
    const st = plan.streets[l.street] as Street | undefined;
    const edge = plan.edges[l.street];
    if (st === undefined || edge === undefined) continue;
    const len = Math.sqrt((st.b.x - st.a.x) * (st.b.x - st.a.x) + (st.b.z - st.a.z) * (st.b.z - st.a.z));
    const tx = (st.b.x - st.a.x) / len;
    const tz = (st.b.z - st.a.z) / len;
    const fwd = l.dx * tx + l.dz * tz > 0;
    const so = (l.x - st.a.x) * tx + (l.z - st.a.z) * tz + (fwd ? 1 : -1) * (l.mouth + 1);
    const s = so < 0 ? 0 : so > len ? len : so;
    if (!(l.curbLeft || l.curbRight)) continue;
    depth = Math.max(depth, sideDepth(edge, 0, s)[0], sideDepth(edge, 1, s)[0]);
  }
  return depth;
}

function fieldOf(plan: TownPlan): Field {
  let f = FIELDS.get(plan);
  if (f !== undefined) return f;
  const items: Item[] = [];
  const boxes: [number, number, number, number][] = [];
  for (const st of plan.streets) {
    if (st.kind !== "street" && st.kind !== "main" && st.kind !== "avenue") continue;
    const edge = plan.edges[st.id];
    if (edge === undefined) continue;
    const len = Math.sqrt((st.b.x - st.a.x) * (st.b.x - st.a.x) + (st.b.z - st.a.z) * (st.b.z - st.a.z));
    if (!(len > 0.1)) continue;
    const cw = st.roadway / 2;
    const reach = Math.max(cw + DITCH_OFFSET + DITCH_WIDTH + 0.5, st.width / 2 + WALK_FADE + 1);
    items.push({ kind: 0, ax: st.a.x, az: st.a.z, tx: (st.b.x - st.a.x) / len, tz: (st.b.z - st.a.z) / len, len, cw, hw: st.width / 2, edge });
    boxes.push([Math.min(st.a.x, st.b.x) - reach, Math.min(st.a.z, st.b.z) - reach, Math.max(st.a.x, st.b.x) + reach, Math.max(st.a.z, st.b.z) + reach]);
  }
  for (const j of plan.junctions) {
    if (!hasPavement(j) || j.legs.length < 2) continue;
    const pts = pavementPolygon(j.legs as readonly JunctionLeg[], j.corners);
    if (pts.length < 3) continue;
    let x0 = Infinity;
    let z0 = Infinity;
    let x1 = -Infinity;
    let z1 = -Infinity;
    for (const p of pts) {
      x0 = Math.min(x0, p.x);
      z0 = Math.min(z0, p.z);
      x1 = Math.max(x1, p.x);
      z1 = Math.max(z1, p.z);
    }
    items.push({ kind: 1, pts, depth: junctionDepth(plan, j), x0, z0, x1, z1 });
    boxes.push([x0 - HIDDEN_FADE - 1, z0 - HIDDEN_FADE - 1, x1 + HIDDEN_FADE + 1, z1 + HIDDEN_FADE + 1]);
  }
  // The terrain is cut out of sight under the other paved ground too (no lowering: the patch lies on the ground's own level).
  for (const g of pavedGround(plan)) {
    let x0 = Infinity;
    let z0 = Infinity;
    let x1 = -Infinity;
    let z1 = -Infinity;
    for (const p of g.polygon) {
      x0 = Math.min(x0, p.x);
      z0 = Math.min(z0, p.z);
      x1 = Math.max(x1, p.x);
      z1 = Math.max(z1, p.z);
    }
    items.push({ kind: 1, paved: true, pts: g.polygon, depth: 0, x0, z0, x1, z1 });
    boxes.push([x0 - WALK_FADE - 1, z0 - WALK_FADE - 1, x1 + WALK_FADE + 1, z1 + WALK_FADE + 1]);
  }
  let x0 = Infinity;
  let z0 = Infinity;
  let x1 = -Infinity;
  let z1 = -Infinity;
  for (const b of boxes) {
    x0 = Math.min(x0, b[0]);
    z0 = Math.min(z0, b[1]);
    x1 = Math.max(x1, b[2]);
    z1 = Math.max(z1, b[3]);
  }
  if (items.length === 0) {
    f = { items, x0: 0, z0: 0, nx: 0, nz: 0, cells: [] };
    FIELDS.set(plan, f);
    return f;
  }
  x0 = Math.floor(x0 / CELL) * CELL;
  z0 = Math.floor(z0 / CELL) * CELL;
  const nx = Math.floor((x1 - x0) / CELL) + 1;
  const nz = Math.floor((z1 - z0) / CELL) + 1;
  const cells: number[][] = [];
  for (let i = 0; i < nx * nz; i++) cells.push([]);
  for (let k = 0; k < boxes.length; k++) {
    const b = boxes[k] as [number, number, number, number];
    for (let i = Math.floor((b[0] - x0) / CELL); i <= Math.floor((b[2] - x0) / CELL); i++) {
      for (let j = Math.floor((b[1] - z0) / CELL); j <= Math.floor((b[3] - z0) / CELL); j++) (cells[i * nz + j] as number[]).push(k);
    }
  }
  f = { items, x0, z0, nx, nz, cells };
  FIELDS.set(plan, f);
  return f;
}

const ZERO3: [number, number, number] = [0, 0, 0];
const mul3 = (a: D3, b: D3): D3 => [a[0] * b[0], a[1] * b[0] + a[0] * b[1], a[2] * b[0] + a[0] * b[2]];

/** What a street channel does at a point: the roadway's lowering and the trough's extra cut, each with its partials in the plan's x and z, and the roadway window's greatest value (for the ditch). */
type Out = { lower: [number, number, number]; hide: [number, number, number]; road: number; ditch: [number, number, number] };

function rectAt(r: Rect, x: number, z: number, o: Out): void {
  const dx = x - r.ax;
  const dz = z - r.az;
  const s = dx * r.tx + dz * r.tz;
  const t = -dx * r.tz + dz * r.tx;
  const at = t < 0 ? -t : t;
  const reach = Math.max(r.cw + DITCH_OFFSET + DITCH_WIDTH, r.hw + WALK_FADE + 0.5);
  if (at > reach || s < -1 || s > r.len + 1) return;
  const sign = t < 0 ? -1 : 1;
  // The window along the street: it ends over END_FADE at either end.
  const a = smootherstepD(-END_FADE, END_FADE, s);
  const b = smootherstepD(-END_FADE, END_FADE, r.len - s);
  const ws: D3 = [a.v * b.v, a.d * b.v - a.v * b.d, 0];
  // Across: 1 over the roadway, 0 beyond its curb.
  const wl = smootherstepD(r.cw - CURB_IN, r.cw + CURB_OUT, at);
  const W: D3 = [(1 - wl.v), 0, -wl.d * sign];
  const road = W[0] * ws[0];
  if (road > o.road) o.road = road;
  // The curb's height: the left side's (t > 0) and the right's, the roadway lying across them.
  const [dl, dlS] = sideDepth(r.edge, 0, s < 0 ? 0 : s > r.len ? r.len : s);
  const [dr, drS] = sideDepth(r.edge, 1, s < 0 ? 0 : s > r.len ? r.len : s);
  if (at <= r.cw + CURB_OUT) {
    let u = (t + r.cw) / (2 * r.cw);
    let du = 1 / (2 * r.cw);
    if (u < 0) {
      u = 0;
      du = 0;
    } else if (u > 1) {
      u = 1;
      du = 0;
    }
    const Dm: D3 = [dr * (1 - u) + dl * u, drS * (1 - u) + dlS * u, (dl - dr) * du];
    // The lowering: Dm * W * ws, partials in (s, t).
    const L = mul3(mul3(Dm, W), ws);
    if (L[0] > o.lower[0]) {
      o.lower = [L[0], L[1] * r.tx + L[2] * -r.tz, L[1] * r.tz + L[2] * r.tx];
    }
    // The trough: HIDDEN * its window * ws * smoothstep(Dm).
    const wh = smootherstepD(r.cw + CURB_IN, r.cw + CURB_IN + HIDDEN_FADE, at);
    const G: D3 = [1, 0, 0];
    const WH: D3 = [1 - wh.v, 0, -wh.d * sign];
    const H = mul3(mul3(WH, G), ws);
    const h = H[0] * HIDDEN;
    if (h > o.hide[0]) o.hide = [h, HIDDEN * (H[1] * r.tx + H[2] * -r.tz), HIDDEN * (H[1] * r.tz + H[2] * r.tx)];
  } else if (at <= r.cw + HIDDEN_FADE + CURB_IN) {
    const wh = smootherstepD(r.cw + CURB_IN, r.cw + CURB_IN + HIDDEN_FADE, at);
    const G: D3 = [1, 0, 0];
    const WH: D3 = [1 - wh.v, 0, -wh.d * sign];
    const H = mul3(mul3(WH, G), ws);
    const h = H[0] * HIDDEN;
    if (h > o.hide[0]) o.hide = [h, HIDDEN * (H[1] * r.tx + H[2] * -r.tz), HIDDEN * (H[1] * r.tz + H[2] * r.tx)];
  }
  // The trough under a sidewalk's pours.
  const sideW = r.edge.sides[t > 0 ? 0 : 1];
  if (sideW.walk > 0 && at > r.hw - sideW.walk - 0.5 && at < r.hw + WALK_FADE + 0.2) {
    const inn = smootherstepD(r.hw - sideW.walk - 0.4, r.hw - sideW.walk, at);
    const out = smootherstepD(r.hw + 0.1, r.hw + 0.1 + WALK_FADE, at);
    const lat: D3 = [inn.v * (1 - out.v), (inn.d * (1 - out.v) - inn.v * out.d) * sign, 0];
    // lat holds d/dt in slot 1 for the sidewalk zone; the along window is built from the runs that reach here.
    let along = 0;
    let alongD = 0;
    for (const run of sideW.runs) {
      if (s < run.s0 - 0.6 || s > run.s1 + 0.6) continue;
      const a0 = smootherstepD(run.s0 - 0.5, run.s0 + 0.1, s);
      const a1 = smootherstepD(run.s1 - 0.1, run.s1 + 0.5, s);
      const v = a0.v * (1 - a1.v);
      if (v > along) {
        along = v;
        alongD = a0.d * (1 - a1.v) - a0.v * a1.d;
      }
    }
    if (along > 0) {
      const h = HIDDEN_WALK * lat[0] * along;
      if (h > o.hide[0]) {
        const dt = HIDDEN_WALK * lat[1] * along;
        const ds = HIDDEN_WALK * lat[0] * alongD;
        o.hide = [h, ds * r.tx + dt * -r.tz, ds * r.tz + dt * r.tx];
      }
    }
  }
  // A ditch beside a side with no curb.
  const side = r.edge.sides[t > 0 ? 0 : 1];
  if (side.ditch && at > r.cw + DITCH_OFFSET - DITCH_WIDTH && at < r.cw + DITCH_OFFSET + DITCH_WIDTH) {
    const c = r.cw + side.verge + 0.9;
    const bump = smootherstepD(0, DITCH_WIDTH / 2 + 0.4, at > c ? at - c : c - at);
    const dd = at > c ? 1 : -1;
    // 1 at the middle, 0 at its edges; fades in along the street over 8 m from its ends.
    const e0 = smootherstepD(4, 12, s);
    const e1 = smootherstepD(4, 12, r.len - s);
    const along: D3 = [e0.v * e1.v, e0.d * e1.v - e0.v * e1.d, 0];
    const across: D3 = [1 - bump.v, 0, -bump.d * dd * sign];
    const K = mul3(across, along);
    const v = K[0] * DITCH_DEPTH;
    if (v > o.ditch[0]) o.ditch = [v, DITCH_DEPTH * (K[1] * r.tx + K[2] * -r.tz), DITCH_DEPTH * (K[1] * r.tz + K[2] * r.tx)];
  }
}

function polyAt(p: Poly, x: number, z: number, o: Out): void {
  if (x < p.x0 - HIDDEN_FADE - 0.5 || x > p.x1 + HIDDEN_FADE + 0.5 || z < p.z0 - HIDDEN_FADE - 0.5 || z > p.z1 + HIDDEN_FADE + 0.5) return;
  const pts = p.pts;
  let best = Infinity;
  let qx = 0;
  let qz = 0;
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const a = pts[i] as Vec;
    const b = pts[j] as Vec;
    if (a.z > z !== b.z > z && x < ((b.x - a.x) * (z - a.z)) / (b.z - a.z) + a.x) inside = !inside;
    const ex = b.x - a.x;
    const ez = b.z - a.z;
    const l2 = ex * ex + ez * ez;
    let t = l2 > 0 ? ((x - a.x) * ex + (z - a.z) * ez) / l2 : 0;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    const cx = a.x + ex * t;
    const cz = a.z + ez * t;
    const d2 = (x - cx) * (x - cx) + (z - cz) * (z - cz);
    if (d2 < best) {
      best = d2;
      qx = cx;
      qz = cz;
    }
  }
  const d = Math.sqrt(best);
  const sd = inside ? d : -d;
  const gx = d > 1e-9 ? ((x - qx) / d) * (inside ? 1 : -1) : 0;
  const gz = d > 1e-9 ? ((z - qz) / d) * (inside ? 1 : -1) : 0;
  if (p.paved === true) {
    // Other paved ground: only the terrain's cut, 1 inside the polygon and gone `WALK_FADE` outside it.
    const wp = smootherstepD(-WALK_FADE, 0, sd);
    const hp = HIDDEN_PAVED * wp.v;
    if (hp > o.hide[0]) o.hide = [hp, HIDDEN_PAVED * wp.d * gx, HIDDEN_PAVED * wp.d * gz];
    return;
  }
  const w = smootherstepD(-CURB_OUT, CURB_IN, sd);
  if (w.v > o.road) o.road = w.v;
  const L = p.depth * w.v;
  if (L > o.lower[0]) o.lower = [L, p.depth * w.d * gx, p.depth * w.d * gz];
  const wh = smootherstepD(-HIDDEN_FADE - CURB_IN, -CURB_IN, sd);
  const h = HIDDEN * wh.v;
  if (h > o.hide[0]) o.hide = [h, HIDDEN * wh.d * gx, HIDDEN * wh.d * gz];
}

/** The one record every channel lookup writes into and returns (the simulation is single-threaded and each caller reads it at once): no allocation on the ground's hot path. */
const SCRATCH: Out = { lower: [0, 0, 0], hide: [0, 0, 0], road: 0, ditch: [0, 0, 0] };

/** The channel at a point of the plan's frame. */
function channelAt(plan: TownPlan, x: number, z: number): Out {
  const o = SCRATCH;
  o.lower = ZERO3;
  o.hide = ZERO3;
  o.ditch = ZERO3;
  o.road = 0;
  const f = fieldOf(plan);
  if (f.nx === 0) return o;
  const i = Math.floor((x - f.x0) / CELL);
  const j = Math.floor((z - f.z0) / CELL);
  if (i < 0 || j < 0 || i >= f.nx || j >= f.nz) return o;
  const list = f.cells[i * f.nz + j] as readonly number[];
  for (let k = 0; k < list.length; k++) {
    const it = f.items[list[k] as number] as Item;
    if (it.kind === 0) rectAt(it, x, z, o);
    else polyAt(it, x, z, o);
  }
  return o;
}

/** The plan and the anchor's x of the seed last asked about: one world is asked millions of times in a row. */
let lastSeed = Number.NaN;
let lastPlan: TownPlan | null = null;
let lastAx = 0;
function ensure(seed: number): TownPlan {
  if (seed !== lastSeed || lastPlan === null) {
    lastPlan = planFor(seed);
    lastAx = siteFor(seed).anchor.x;
    lastSeed = seed;
  }
  return lastPlan;
}

const NO_LIFT = Object.freeze({ v: 0, dx: 0, dz: 0 });

/** The lowering of the roadway (and the ditch) at a world point, with its partials: the made ground less this is the surface walked. */
export function streetLowerD(seed: number, x: number, z: number): { v: number; dx: number; dz: number } {
  const o = channelAt(ensure(seed), x - lastAx, z - COVE_Z);
  // A ditch is taken out where a roadway is.
  const k = 1 - o.road;
  const v = o.lower[0] + o.ditch[0] * k;
  if (v === 0) return { v: 0, dx: 0, dz: 0 };
  return { v, dx: o.lower[1] + o.ditch[1] * k, dz: o.lower[2] + o.ditch[2] * k };
}

/** The trough's cut under a world point, with its partials: the terrain stands this far under the surface that is walked and drawn. */
export function streetLiftD(seed: number, x: number, z: number): { v: number; dx: number; dz: number } {
  const o = channelAt(ensure(seed), x - lastAx, z - COVE_Z);
  return o.hide === ZERO3 ? NO_LIFT : { v: o.hide[0], dx: o.hide[1], dz: o.hide[2] };
}

/**
 * The place's ground with the streets cut into it: the made ground (`base`) less the roadway's lowering and the trough. Where
 * neither is there it is `base`, the same object.
 */
export function streetChannelD(seed: number, x: number, z: number, base: TerrainSample): TerrainSample {
  const o = channelAt(ensure(seed), x - lastAx, z - COVE_Z);
  const k = 1 - o.road;
  const lv = o.lower[0] + o.ditch[0] * k;
  const hv = o.hide[0];
  if (lv === 0 && hv === 0) return base;
  return {
    h: base.h - lv - hv,
    dx: base.dx - (o.lower[1] + o.ditch[1] * k) - o.hide[1],
    dz: base.dz - (o.lower[2] + o.ditch[2] * k) - o.hide[2],
  };
}

/**
 * The engine's ground field with the streets' trough filled: what a person walks on is the terrain plus `streetLiftD`, which is the
 * surface the street is drawn on (the roadway a curb's face under the sidewalk, the ditch, the verge at the lots' level). Away from every
 * street it is the base field's own answers.
 */
export function withStreets(base: GroundField, seed: number): GroundField {
  return {
    heightAt(x, z) {
      const lift = streetLiftD(seed, x, z).v;
      return lift === 0 ? base.heightAt(x, z) : base.heightAt(x, z) + lift;
    },
    normalAt(x, z, out: Vec3) {
      base.normalAt(x, z, out);
      const lift = streetLiftD(seed, x, z);
      if (lift.v === 0 && lift.dx === 0 && lift.dz === 0) return;
      // The base normal is (-dx, 1, -dz) over its length: add the lift's slope to its gradient.
      const ny = out.y > 1e-6 ? out.y : 1e-6;
      const gx = -out.x / ny + lift.dx;
      const gz = -out.z / ny + lift.dz;
      const inv = 1 / sqrt(1 + gx * gx + gz * gz);
      out.x = -gx * inv;
      out.y = inv;
      out.z = -gz * inv;
    },
    standNormalY: (x, z) => base.standNormalY?.(x, z) ?? GROUND_NORMAL_Y,
    above(x, y, z) {
      const lift = streetLiftD(seed, x, z).v;
      // Over a street's trough the answer is `y - heightAt > 0` with this field's own height, to the bit.
      if (lift !== 0) return y - (base.heightAt(x, z) + lift) > 0;
      if (base.above !== undefined) return base.above(x, y, z);
      return y - base.heightAt(x, z) > 0;
    },
  };
}
