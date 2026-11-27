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
import { STEP, smootherstepInto } from "./fill.js";
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

/** Where `sideDepthInto` leaves its answer: the curb's height and its slope along the street. */
const SIDE = { v: 0, ds: 0 };

/** The curb's height at `s` along a side: the paving's, where the side has a curb. With its slope along the street. Left in `SIDE`. */
function sideDepthInto(edge: StreetEdge, k: 0 | 1, s: number): void {
  const side = edge.sides[k];
  if (!side.curb) {
    SIDE.v = 0;
    SIDE.ds = 0;
    return;
  }
  const pv = edge.paving;
  let v = (pavingAt(pv, s) as { curb: number }).curb;
  let ds = 0;
  for (let i = 0; i + 1 < pv.length; i++) {
    const b = (pv[i] as { s1: number }).s1;
    if (s > b - SEAM / 2 && s < b + SEAM / 2) {
      const a = (pv[i] as { curb: number }).curb;
      const c = (pv[i + 1] as { curb: number }).curb;
      smootherstepInto(b - SEAM / 2, b + SEAM / 2, s);
      v = a + (c - a) * STEP.v;
      ds = (c - a) * STEP.d;
    }
  }
  SIDE.v = v;
  SIDE.ds = ds;
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
    sideDepthInto(edge, 0, s);
    const d0 = SIDE.v;
    sideDepthInto(edge, 1, s);
    depth = Math.max(depth, d0, SIDE.v);
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

/**
 * The rectangle of the plan's frame the street field's grid spans, null where it has no cell: a point outside it is in no cell, so the
 * channel there is all zeros (`channelInto`) and the streets cut nothing.
 */
export function streetFieldExtentOf(plan: TownPlan): { x0: number; z0: number; x1: number; z1: number } | null {
  const f = fieldOf(plan);
  if (!(f.nx > 0 && f.nz > 0)) return null;
  return { x0: f.x0, z0: f.z0, x1: f.x0 + f.nx * CELL, z1: f.z0 + f.nz * CELL };
}

/** A value and its partials in the plan's x and z, in one pair of registers; `mul3Into` leaves a product's here. */
const M3 = { a: 0, b: 0, c: 0 };

/** The product of two values with their partials (`a` and `b` are (value, d/dx, d/dz)): the value, and the product rule for each partial. Left in `M3`. */
function mul3Into(a0: number, a1: number, a2: number, b0: number, b1: number, b2: number): void {
  M3.a = a0 * b0;
  M3.b = a1 * b0 + a0 * b1;
  M3.c = a2 * b0 + a0 * b2;
}

/** What a street channel does at a point: the roadway's lowering and the trough's extra cut, each with its partials in the plan's x and z, and the roadway window's greatest value (for the ditch). */
type Out = { lv: number; ldx: number; ldz: number; hv: number; hdx: number; hdz: number; road: number; dv: number; ddx: number; ddz: number };

/** The trough under a roadway's curb and beyond it, fading out over `HIDDEN_FADE`: raises `o.hv` if this cut is deeper. */
function roadTrough(r: Rect, o: Out, at: number, sign: number, ws0: number, ws1: number, ws2: number): void {
  smootherstepInto(r.cw + CURB_IN, r.cw + CURB_IN + HIDDEN_FADE, at);
  const whV = STEP.v;
  const whD = STEP.d;
  const WH0 = 1 - whV;
  const WH1 = 0;
  const WH2 = -whD * sign;
  mul3Into(WH0, WH1, WH2, 1, 0, 0);
  const g0 = M3.a;
  const g1 = M3.b;
  const g2 = M3.c;
  mul3Into(g0, g1, g2, ws0, ws1, ws2);
  const h = M3.a * HIDDEN;
  if (h > o.hv) {
    o.hv = h;
    o.hdx = HIDDEN * (M3.b * r.tx + M3.c * -r.tz);
    o.hdz = HIDDEN * (M3.b * r.tz + M3.c * r.tx);
  }
}

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
  smootherstepInto(-END_FADE, END_FADE, s);
  const aV = STEP.v;
  const aD = STEP.d;
  smootherstepInto(-END_FADE, END_FADE, r.len - s);
  const bV = STEP.v;
  const bD = STEP.d;
  const ws0 = aV * bV;
  const ws1 = aD * bV - aV * bD;
  const ws2 = 0;
  // Across: 1 over the roadway, 0 beyond its curb.
  smootherstepInto(r.cw - CURB_IN, r.cw + CURB_OUT, at);
  const wlV = STEP.v;
  const wlD = STEP.d;
  const W0 = 1 - wlV;
  const W1 = 0;
  const W2 = -wlD * sign;
  const road = W0 * ws0;
  if (road > o.road) o.road = road;
  // The curb's height: the left side's (t > 0) and the right's, the roadway lying across them.
  sideDepthInto(r.edge, 0, s < 0 ? 0 : s > r.len ? r.len : s);
  const dl = SIDE.v;
  const dlS = SIDE.ds;
  sideDepthInto(r.edge, 1, s < 0 ? 0 : s > r.len ? r.len : s);
  const dr = SIDE.v;
  const drS = SIDE.ds;
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
    const Dm0 = dr * (1 - u) + dl * u;
    const Dm1 = drS * (1 - u) + dlS * u;
    const Dm2 = (dl - dr) * du;
    // The lowering: Dm * W * ws, partials in (s, t).
    mul3Into(Dm0, Dm1, Dm2, W0, W1, W2);
    const m0 = M3.a;
    const m1 = M3.b;
    const m2 = M3.c;
    mul3Into(m0, m1, m2, ws0, ws1, ws2);
    if (M3.a > o.lv) {
      o.lv = M3.a;
      o.ldx = M3.b * r.tx + M3.c * -r.tz;
      o.ldz = M3.b * r.tz + M3.c * r.tx;
    }
    // The trough: HIDDEN * its window * ws * smoothstep(Dm).
    roadTrough(r, o, at, sign, ws0, ws1, ws2);
  } else if (at <= r.cw + HIDDEN_FADE + CURB_IN) {
    roadTrough(r, o, at, sign, ws0, ws1, ws2);
  }
  // The trough under a sidewalk's pours.
  const sideW = r.edge.sides[t > 0 ? 0 : 1];
  if (sideW.walk > 0 && at > r.hw - sideW.walk - 0.5 && at < r.hw + WALK_FADE + 0.2) {
    smootherstepInto(r.hw - sideW.walk - 0.4, r.hw - sideW.walk, at);
    const innV = STEP.v;
    const innD = STEP.d;
    smootherstepInto(r.hw + 0.1, r.hw + 0.1 + WALK_FADE, at);
    const outV = STEP.v;
    const outD = STEP.d;
    const lat0 = innV * (1 - outV);
    const lat1 = (innD * (1 - outV) - innV * outD) * sign;
    // lat holds d/dt in slot 1 for the sidewalk zone; the along window is built from the runs that reach here.
    let along = 0;
    let alongD = 0;
    for (const run of sideW.runs) {
      if (s < run.s0 - 0.6 || s > run.s1 + 0.6) continue;
      smootherstepInto(run.s0 - 0.5, run.s0 + 0.1, s);
      const a0V = STEP.v;
      const a0D = STEP.d;
      smootherstepInto(run.s1 - 0.1, run.s1 + 0.5, s);
      const a1V = STEP.v;
      const a1D = STEP.d;
      const v = a0V * (1 - a1V);
      if (v > along) {
        along = v;
        alongD = a0D * (1 - a1V) - a0V * a1D;
      }
    }
    if (along > 0) {
      const h = HIDDEN_WALK * lat0 * along;
      if (h > o.hv) {
        const dt = HIDDEN_WALK * lat1 * along;
        const ds = HIDDEN_WALK * lat0 * alongD;
        o.hv = h;
        o.hdx = ds * r.tx + dt * -r.tz;
        o.hdz = ds * r.tz + dt * r.tx;
      }
    }
  }
  // A ditch beside a side with no curb.
  const side = r.edge.sides[t > 0 ? 0 : 1];
  if (side.ditch && at > r.cw + DITCH_OFFSET - DITCH_WIDTH && at < r.cw + DITCH_OFFSET + DITCH_WIDTH) {
    const c = r.cw + side.verge + 0.9;
    smootherstepInto(0, DITCH_WIDTH / 2 + 0.4, at > c ? at - c : c - at);
    const bumpV = STEP.v;
    const bumpD = STEP.d;
    const dd = at > c ? 1 : -1;
    // 1 at the middle, 0 at its edges; fades in along the street over 8 m from its ends.
    smootherstepInto(4, 12, s);
    const e0V = STEP.v;
    const e0D = STEP.d;
    smootherstepInto(4, 12, r.len - s);
    const e1V = STEP.v;
    const e1D = STEP.d;
    const al0 = e0V * e1V;
    const al1 = e0D * e1V - e0V * e1D;
    const al2 = 0;
    const ac0 = 1 - bumpV;
    const ac1 = 0;
    const ac2 = -bumpD * dd * sign;
    mul3Into(ac0, ac1, ac2, al0, al1, al2);
    const v = M3.a * DITCH_DEPTH;
    if (v > o.dv) {
      o.dv = v;
      o.ddx = DITCH_DEPTH * (M3.b * r.tx + M3.c * -r.tz);
      o.ddz = DITCH_DEPTH * (M3.b * r.tz + M3.c * r.tx);
    }
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
    smootherstepInto(-WALK_FADE, 0, sd);
    const hp = HIDDEN_PAVED * STEP.v;
    if (hp > o.hv) {
      o.hv = hp;
      o.hdx = HIDDEN_PAVED * STEP.d * gx;
      o.hdz = HIDDEN_PAVED * STEP.d * gz;
    }
    return;
  }
  smootherstepInto(-CURB_OUT, CURB_IN, sd);
  const wV = STEP.v;
  const wD = STEP.d;
  if (wV > o.road) o.road = wV;
  const L = p.depth * wV;
  if (L > o.lv) {
    o.lv = L;
    o.ldx = p.depth * wD * gx;
    o.ldz = p.depth * wD * gz;
  }
  smootherstepInto(-HIDDEN_FADE - CURB_IN, -CURB_IN, sd);
  const h = HIDDEN * STEP.v;
  if (h > o.hv) {
    o.hv = h;
    o.hdx = HIDDEN * STEP.d * gx;
    o.hdz = HIDDEN * STEP.d * gz;
  }
}

/** The one record every channel lookup writes into (the simulation is single-threaded and each caller reads it at once): no allocation on the ground's hot path. */
const SCRATCH: Out = { lv: 0, ldx: 0, ldz: 0, hv: 0, hdx: 0, hdz: 0, road: 0, dv: 0, ddx: 0, ddz: 0 };

/** The channel at a point of the plan's frame, left in `SCRATCH`. */
function channelInto(plan: TownPlan, x: number, z: number): void {
  const o = SCRATCH;
  o.lv = 0;
  o.ldx = 0;
  o.ldz = 0;
  o.hv = 0;
  o.hdx = 0;
  o.hdz = 0;
  o.dv = 0;
  o.ddx = 0;
  o.ddz = 0;
  o.road = 0;
  const f = fieldOf(plan);
  if (f.nx === 0) return;
  const i = Math.floor((x - f.x0) / CELL);
  const j = Math.floor((z - f.z0) / CELL);
  if (i < 0 || j < 0 || i >= f.nx || j >= f.nz) return;
  const list = f.cells[i * f.nz + j] as readonly number[];
  for (let k = 0; k < list.length; k++) {
    const it = f.items[list[k] as number] as Item;
    if (it.kind === 0) rectAt(it, x, z, o);
    else polyAt(it, x, z, o);
  }
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
  const plan = ensure(seed);
  channelInto(plan, x - lastAx, z - COVE_Z);
  const o = SCRATCH;
  // A ditch is taken out where a roadway is.
  const k = 1 - o.road;
  const v = o.lv + o.dv * k;
  if (v === 0) return { v: 0, dx: 0, dz: 0 };
  return { v, dx: o.ldx + o.ddx * k, dz: o.ldz + o.ddz * k };
}

/** Where `streetLiftInto` leaves its answer: the trough's cut and its partials (all 0 where there is none). Read at once, before any other call. */
export const LIFT = { v: 0, dx: 0, dz: 0 };

/** The trough's cut under a world point, with its partials, left in `LIFT`: the terrain stands this far under the surface that is walked and drawn. */
export function streetLiftInto(seed: number, x: number, z: number): void {
  const plan = ensure(seed);
  channelInto(plan, x - lastAx, z - COVE_Z);
  const o = SCRATCH;
  LIFT.v = o.hv;
  LIFT.dx = o.hdx;
  LIFT.dz = o.hdz;
}

/** The trough's cut under a world point, with its partials: the terrain stands this far under the surface that is walked and drawn. */
export function streetLiftD(seed: number, x: number, z: number): { v: number; dx: number; dz: number } {
  streetLiftInto(seed, x, z);
  return LIFT.v === 0 ? NO_LIFT : { v: LIFT.v, dx: LIFT.dx, dz: LIFT.dz };
}

/** Where `streetChannelInto` leaves the ground with the streets cut into it. Read at once, before any other call. */
export const CHANNEL = { h: 0, dx: 0, dz: 0 };

/**
 * The place's ground with the streets cut into it, left in `CHANNEL`: the made ground (`bh`, `bdx`, `bdz`) less the roadway's
 * lowering and the trough. Answers false, and writes nothing, where neither is there: the made ground stands.
 */
export function streetChannelInto(seed: number, x: number, z: number, bh: number, bdx: number, bdz: number): boolean {
  const plan = ensure(seed);
  channelInto(plan, x - lastAx, z - COVE_Z);
  const o = SCRATCH;
  const k = 1 - o.road;
  const lv = o.lv + o.dv * k;
  const hv = o.hv;
  if (lv === 0 && hv === 0) return false;
  CHANNEL.h = bh - lv - hv;
  CHANNEL.dx = bdx - (o.ldx + o.ddx * k) - o.hdx;
  CHANNEL.dz = bdz - (o.ldz + o.ddz * k) - o.hdz;
  return true;
}

/**
 * The place's ground with the streets cut into it: the made ground (`base`) less the roadway's lowering and the trough. Where
 * neither is there it is `base`, the same object.
 */
export function streetChannelD(seed: number, x: number, z: number, base: TerrainSample): TerrainSample {
  if (!streetChannelInto(seed, x, z, base.h, base.dx, base.dz)) return base;
  return { h: CHANNEL.h, dx: CHANNEL.dx, dz: CHANNEL.dz };
}

/**
 * The engine's ground field with the streets' trough filled: what a person walks on is the terrain plus `streetLiftD`, which is the
 * surface the street is drawn on (the roadway a curb's face under the sidewalk, the ditch, the verge at the lots' level). Away from every
 * street it is the base field's own answers.
 */
export function withStreets(base: GroundField, seed: number): GroundField {
  return {
    heightAt(x, z) {
      streetLiftInto(seed, x, z);
      const lift = LIFT.v;
      return lift === 0 ? base.heightAt(x, z) : base.heightAt(x, z) + lift;
    },
    normalAt(x, z, out: Vec3) {
      base.normalAt(x, z, out);
      streetLiftInto(seed, x, z);
      const liftV = LIFT.v;
      const liftDx = LIFT.dx;
      const liftDz = LIFT.dz;
      if (liftV === 0 && liftDx === 0 && liftDz === 0) return;
      // The base normal is (-dx, 1, -dz) over its length: add the lift's slope to its gradient.
      const ny = out.y > 1e-6 ? out.y : 1e-6;
      const gx = -out.x / ny + liftDx;
      const gz = -out.z / ny + liftDz;
      const inv = 1 / sqrt(1 + gx * gx + gz * gz);
      out.x = -gx * inv;
      out.y = inv;
      out.z = -gz * inv;
    },
    standNormalY: (x, z) => base.standNormalY?.(x, z) ?? GROUND_NORMAL_Y,
    above(x, y, z) {
      streetLiftInto(seed, x, z);
      const lift = LIFT.v;
      // Over a street's trough the answer is `y - heightAt > 0` with this field's own height, to the bit.
      if (lift !== 0) return y - (base.heightAt(x, z) + lift) > 0;
      if (base.above !== undefined) return base.above(x, y, z);
      return y - base.heightAt(x, z) > 0;
    },
  };
}
