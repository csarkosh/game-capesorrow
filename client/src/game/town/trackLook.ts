/**
 * The look of the railroad's track: what its parts are made of and how uneven they are, shared by the main line (`railGeometry.ts`) and the
 * town's spur (`spurGeometry.ts`). Pure functions that write into a `MeshBuilder`.
 *
 * - **Materials.** Every part is given a texture layer of the town's (`townLayers.ts`) on a frame that runs along the track, so the grain goes
 *   the right way: gravel on the bed (tinted grey-brown, darker and oiled between the rails, paler at the shoulders, with mud in the low
 *   spots and growth where the bed is old), weathered planks on the ties (creosote black, bleached silver-grey, new pale), aged metal on the
 *   rails (a bright worn band on the head of a used line, rust all over a spur's), rust on the plates and spikes, planks or asphalt on a
 *   crossing, and weathered timber with dark stains below each joint on a trestle.
 * - **Shape.** The bed is a heap: a crowned cross section with sloping shoulders whose toe wanders, a grid whose vertices are pushed by noise
 *   of the world's position (so cells and levels of detail agree where they meet), stones spilled past the shoulder, and low spots. Ties are
 *   individuals (skewed, tilted, sunk or proud, a few split, one in forty gone or new). Rails keep their line and gauge; a spur's dip a few
 *   millimetres at its joints, which have fish plates.
 * - **Not alike.** What a stretch is like (fresh ballast, old and weedy, a run of new ties) comes from smooth noise of the world's position
 *   (`stretchAt`), so it is the same for any level of detail and any cell.
 *
 * Nothing here is in `sim/`: it draws, it never decides where anything stands.
 */
import { MeshBuilder, hash01, scaled, type Rgb, type Vec3 } from "./meshBuilder.js";
import { withMat } from "./materials.js";
import { edgeFrame, type Surface, type WearKind } from "./townSurface.js";
import type { LayerName } from "./townLayers.js";
import { BALLAST_TOP, BALLAST_TOP_HALF, RAIL_FOOT, RAIL_TOP, TIE_BOTTOM, TIE_HALF_LENGTH, TIE_HALF_WIDTH, TIE_TOP, pointOf, type Frame } from "./railConstants.js";
import { RAIL_BED_HALF, RAIL_GAUGE } from "../../sim/town/rail.js";

/** What differs between the main line (kept up, used) and the spur (older, dirtier, rusted). */
export type Look = { readonly seed: number; readonly spur: boolean };

// ---------------------------------------------------------------------------------------------------------------------------- noise

function lattice(ix: number, iz: number, salt: number): number {
  return hash01(Math.imul(ix, 73856093) ^ Math.imul(iz, 19349663), salt);
}

/** Smooth value noise of a place, 0 to 1 (a lattice of one unit). */
export function vnoise(x: number, z: number, salt = 0): number {
  const ix = Math.floor(x);
  const iz = Math.floor(z);
  const fx = x - ix;
  const fz = z - iz;
  const sx = fx * fx * (3 - 2 * fx);
  const sz = fz * fz * (3 - 2 * fz);
  const a = lattice(ix, iz, salt);
  const b = lattice(ix + 1, iz, salt);
  const c = lattice(ix, iz + 1, salt);
  const d = lattice(ix + 1, iz + 1, salt);
  const top = a + (b - a) * sx;
  return top + (c + (d - c) * sx - top) * sz;
}

/** A hash of a place (to a few centimetres) and a salt, 0 to 1: what a thing standing there is like. */
export function hashAt(x: number, z: number, salt: number): number {
  return lattice(Math.round(x * 40), Math.round(z * 40), salt);
}

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));
const mix = (a: number, b: number, t: number): number => a + (b - a) * t;

// ---------------------------------------------------------------------------------------------------------------------------- stretches

/** What a stretch of track is like: how old its ballast is (0 fresh, 1 old), how weedy, how much mud has pumped up. */
export type Stretch = { readonly age: number; readonly weeds: number; readonly mud: number };

/** The stretch at a place: smooth, over some 70 m, so a freshly ballasted stretch and an old weedy one follow each other along the line. */
export function stretchAt(look: Look, x: number, z: number): Stretch {
  const salt = (look.seed & 0xfff) + 11;
  const n = clamp((vnoise(x / 70 + z / 90, z / 70 - x / 90, salt) - 0.5) * 2.1 + 0.5, 0, 1);
  if (look.spur) {
    const age = 0.55 + 0.45 * n;
    return { age, weeds: 0.5 + 0.5 * n, mud: 0.35 + 0.5 * n };
  }
  return { age: n * 0.9, weeds: 0.04 + 0.4 * Math.max(0, n - 0.55) * 2.2, mud: Math.max(0, n - 0.6) * 1.6 };
}

/** Whether a tie at a place is in a run of new ties (a crew replaced them), by smooth noise of the place. */
function newRunAt(look: Look, x: number, z: number): boolean {
  return vnoise(x / 14, z / 14, (look.seed & 0xfff) + 71) > (look.spur ? 0.86 : 0.8);
}

// ---------------------------------------------------------------------------------------------------------------------------- surfaces

/** A surface described apart from where it lies: its frame is made along the polygon it is given to (`alongSurface`). */
export type SurfaceSpec = {
  readonly layer: LayerName;
  readonly tint?: Rgb;
  readonly wear?: number | ((p: Vec3) => number);
  readonly wearKind?: WearKind;
  readonly streaks?: boolean;
  readonly wear2?: number | ((p: Vec3) => number);
  readonly wearKind2?: WearKind;
  readonly streaks2?: boolean;
};

/**
 * The surface of a polygon that has an edge `a` to `b` it runs along and `toward` a point of its plane off the edge: the grain runs from `a`
 * to `b`, and its coordinate along is the point's own along that direction, so neighbouring polygons of one run meet with no seam.
 */
export function alongSurface(spec: SurfaceSpec, a: Vec3, b: Vec3, toward: Vec3, shift = 0): Surface | undefined {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const dz = b[2] - a[2];
  if (!(dx * dx + dy * dy + dz * dz > 1e-12)) return undefined;
  const f = edgeFrame(a, b, toward);
  const along = f.origin[0] * f.u[0] + f.origin[1] * f.u[1] + f.origin[2] * f.u[2];
  const origin: Vec3 = [a[0] - f.u[0] * (along - shift), a[1] - f.u[1] * (along - shift), a[2] - f.u[2] * (along - shift)];
  return {
    layer: spec.layer,
    frame: { origin, u: f.u, v: f.v },
    ...(spec.tint === undefined ? {} : { tint: spec.tint }),
    ...(spec.wear === undefined ? {} : { wear: spec.wear }),
    ...(spec.wearKind === undefined ? {} : { wearKind: spec.wearKind }),
    ...(spec.streaks === undefined ? {} : { streaks: spec.streaks }),
    ...(spec.wear2 === undefined ? {} : { wear2: spec.wear2 }),
    ...(spec.wearKind2 === undefined ? {} : { wearKind2: spec.wearKind2 }),
    ...(spec.streaks2 === undefined ? {} : { streaks2: spec.streaks2 }),
  };
}

// ---------------------------------------------------------------------------------------------------------------------------- the bed

/** The ballast's top edge (the half width where the crown ends and the shoulder begins), metres. */
const EDGE = BALLAST_TOP_HALF;
/** How far a bed's toe may wander in from the bench's edge, metres: low frequency (shared by every level), then the near level's own. */
const TOE_WANDER = 0.18;
const TOE_WANDER_NEAR = 0.05;
/** The crown: how much higher the middle of the bed's top stands than its edges, metres. */
const CROWN = 0.012;

/** The toe of the bed's side at a frame: its half width, wandering in from `RAIL_BED_HALF`. `near` adds the finer wander. */
export function toeOf(look: Look, f: Frame, side: number, near: boolean): number {
  const x = f.x;
  const z = f.z;
  const salt = (look.seed & 0xfff) + (side > 0 ? 31 : 37);
  let w = TOE_WANDER * vnoise(x / 25 + z / 25, z / 25 - x / 25, salt);
  if (near) w += TOE_WANDER_NEAR * vnoise(z / 2.5, x / 2.5, salt + 5);
  return RAIL_BED_HALF - w;
}

/** How far a point of the bed's top is pushed by noise, metres: lumps, and low spots where mud has pumped up. Within -2.2 and +2 cm. */
export function lumps(look: Look, x: number, z: number): number {
  const s = (look.seed & 0xfff) + 3;
  const a = (vnoise(x * 0.9, z * 0.9, s) - 0.5) * 0.034 + (vnoise(x * 2.1, z * 2.1, s + 1) - 0.5) * 0.016;
  const l = vnoise(x * 0.3, z * 0.3, s + 2);
  const low = l > 0.74 ? ((l - 0.74) / 0.26) * 0.03 : 0;
  return clamp(a - low, -0.022, 0.008);
}

/** Whether a place is a low spot where mud has pumped up (the same noise `lumps` lowers by). */
function lowSpot(look: Look, x: number, z: number): number {
  const l = vnoise(x * 0.3, z * 0.3, (look.seed & 0xfff) + 5);
  return l > 0.74 ? Math.min(1, (l - 0.74) / 0.12) : 0;
}

/** The bed's height over the bench at a place `off` across the line, given the toe's half width there. */
export function bedDy(look: Look, x: number, z: number, off: number, toe: number, near: boolean): number {
  const a = Math.abs(off);
  const bump = near ? lumps(look, x, z) : 0;
  if (a <= EDGE) return BALLAST_TOP + CROWN * (1 - (a * a) / (EDGE * EDGE)) + bump;
  const t = clamp((a - EDGE) / (toe - EDGE), 0, 1);
  return (BALLAST_TOP + bump) * (1 - t) * (1 - 0.2 * t);
}

type Col = { readonly kind: "skirt" | "toe" | "slope" | "top"; readonly side: number; readonly at: number };

/** The columns of the bed's grid across its section, left to right, at a level of detail. */
function columns(lod: 0 | 1 | 2, skirt: boolean): Col[] {
  const out: Col[] = [];
  const half = (side: number): Col[] => {
    const c: Col[] = [];
    if (skirt) c.push({ kind: "skirt", side, at: 0 });
    c.push({ kind: "toe", side, at: 0 });
    if (lod === 0) c.push({ kind: "slope", side, at: 0.5 });
    c.push({ kind: "top", side, at: EDGE });
    if (lod === 0) for (const o of [1.25, 0.95, 0.5]) c.push({ kind: "top", side, at: o });
    if (lod === 1) c.push({ kind: "top", side, at: 0.9 });
    return c;
  };
  out.push(...half(-1));
  out.push({ kind: "top", side: 1, at: 0 });
  const right = half(1).reverse();
  out.push(...right);
  return out;
}

/** The bed's tint at an offset: grey-brown, darker and oily between the rails, paler and dusty at the shoulders, browner when old. */
function ballastTint(st: Stretch, off: number, jitter: number): Rgb {
  const a = Math.abs(off);
  const old = st.age;
  const base: Rgb = [mix(0.9, 0.82, old), mix(0.86, 0.74, old), mix(0.8, 0.62, old)];
  let k = mix(1.12, 0.94, old);
  if (a < 0.95) k *= 0.72 - 0.1 * old;
  else if (a > 1.35) k *= 1.1;
  k *= 0.92 + 0.16 * jitter;
  return [base[0] * k, base[1] * k, base[2] * k];
}

/** The bed's tint at a lower level of detail, which has fewer vertices to say it with: the same average of the near level's. */
const MEAN_TIES = 0.86;

/**
 * The bed over a run of frames: a crowned section with sloping shoulders, one grid. At the near level (`lod` 0) its vertices are pushed by
 * noise and its toe wanders more; at the others it is the same outline and the same tone with the lumps left out. `skirt` is how deep the
 * skirt goes under the toe (0 for none). Wound to face out, with a back, so no side shows empty.
 */
export function bedGrid(b: MeshBuilder, frames: readonly Frame[], look: Look, lod: 0 | 1 | 2, skirt: number): void {
  if (frames.length < 2) return;
  const cols = columns(lod, skirt > 0);
  const near = lod === 0;
  const rows: Vec3[][] = [];
  const inside: Vec3[] = [];
  const offs: number[][] = [];
  const lows: number[][] = [];
  const stretches: Stretch[] = [];
  for (const f of frames) {
    const toeL = toeOf(look, f, -1, near);
    const toeR = toeOf(look, f, 1, near);
    const row: Vec3[] = [];
    const rowOff: number[] = [];
    const rowLow: number[] = [];
    for (const c of cols) {
      const toe = c.side < 0 ? toeL : toeR;
      let off: number;
      let dy: number;
      if (c.kind === "skirt") {
        off = c.side * toe;
        dy = -skirt;
      } else if (c.kind === "toe") {
        off = c.side * toe;
        dy = 0;
      } else if (c.kind === "slope") {
        off = c.side * (EDGE + (toe - EDGE) * c.at);
        dy = bedDy(look, f.x + f.nx * off, f.z + f.nz * off, off, toe, near);
      } else {
        off = c.side * c.at;
        dy = bedDy(look, f.x + f.nx * off, f.z + f.nz * off, off, toe, near);
      }
      row.push(pointOf(f, off, dy));
      rowOff.push(off);
      rowLow.push(near || lod === 1 ? lowSpot(look, f.x + f.nx * off, f.z + f.nz * off) : 0);
    }
    rows.push(row);
    offs.push(rowOff);
    lows.push(rowLow);
    inside.push([f.x, f.g - 4, f.z]);
    stretches.push(stretchAt(look, f.x, f.z));
  }
  const tint = (i: number, j: number): Rgb => {
    const f = frames[i] as Frame;
    const off = (offs[i] as number[])[j] as number;
    const c = cols[j] as Col;
    const jit = vnoise(f.x * 1.7 + off * 1.3, f.z * 1.7, (look.seed & 0xfff) + 9);
    let t = ballastTint(stretches[i] as Stretch, off, jit);
    // Where ties lie over the bed, the average is darker than the bare gravel: the levels without ties say it in the bed's own tone.
    if (lod !== 0 && Math.abs(off) < 1.3 && c.kind === "top") t = scaled(t, MEAN_TIES);
    if (lod === 2) {
      // One tone across a far strip: the mean of its dark middle and pale shoulders.
      const st = stretches[i] as Stretch;
      t = scaled(ballastTint(st, 1.1, 0.5), 0.94);
    }
    return t;
  };
  withMat("gravel", () => b.grid(
    rows,
    inside,
    {
      colour: (i, j) => scaled(tint(i, j), 0.22),
      layer: "gravel",
      tint,
      uv: (i, j) => {
        const f = frames[i] as Frame;
        const off = (offs[i] as number[])[j] as number;
        return [off + 3.7, f.z * 0.999 + f.x * 0.04];
      },
      wear: (i, j) => {
        const off = (offs[i] as number[])[j] as number;
        const st = stretches[i] as Stretch;
        const a = Math.abs(off);
        if (a < 0.95) return [0.16 + 0.2 * st.age, "oil"];
        return [0.1 + 0.4 * st.age, "grime"];
      },
      wear2: (i, j) => {
        const st = stretches[i] as Stretch;
        const low = (lows[i] as number[])[j] as number;
        const off = (offs[i] as number[])[j] as number;
        if (low > 0) return [0.4 + 0.55 * low * Math.max(0.4, st.mud), "grime"];
        const a = Math.abs(off);
        if (st.age > 0.5 && a > 1.1) return [(st.age - 0.5) * 0.9 * (0.4 + st.weeds), "growth"];
        return [0, "moss"];
      },
      back: true,
    },
  ));
}

/**
 * Stones spilled past the bed's shoulders: a few small blocks of gravel on the bench, more where the stretch is old. At the near level only.
 * `row` is the frame (the bench's height is its `g`).
 */
export function spill(b: MeshBuilder, look: Look, f: Frame, key: number, ground: (x: number, z: number) => number): void {
  const st = stretchAt(look, f.x, f.z);
  for (const side of [-1, 1]) {
    const h = hashAt(f.x + side, f.z, 91 + key);
    if (h > 0.18 + 0.3 * st.age) continue;
    const toe = toeOf(look, f, side, true);
    const off = side * (toe + 0.05 + 0.35 * hashAt(f.x, f.z + side, 92));
    const half = 0.025 + 0.03 * hashAt(f.x - side, f.z, 93);
    const x = f.x + f.nx * off;
    const z = f.z + f.nz * off;
    const turn = hashAt(x, z, 94) * 3;
    const ux = Math.cos(turn);
    const uz = Math.sin(turn);
    const tone = 0.8 + 0.4 * hashAt(x, z, 95);
    withMat("gravel", () => texBox(b, x, z, Math.max(f.g, ground(x, z)) - 0.01, ux, uz, half, half * 0.8, 0.06 + half, { layer: "gravel", tint: [0.85 * tone, 0.8 * tone, 0.75 * tone] }, true));
  }
}

// ---------------------------------------------------------------------------------------------------------------------------- boxes with a surface

/**
 * A box in a turned frame (like `MeshBuilder.box`) whose walls and top wear a surface: `turned` lays the grain up the walls (a post), else
 * along them (a beam). `bottom` adds the underside in the walls' colour darkened.
 */
export function texBox(b: MeshBuilder, cx: number, cz: number, y0: number, ux: number, uz: number, halfU: number, halfV: number, height: number, spec: SurfaceSpec, turned: boolean, colour: Rgb = [0.2, 0.17, 0.14], bottom = true): void {
  const vx = uz;
  const vz = -ux;
  const c = (su: number, sv: number): [number, number] => [cx + ux * halfU * su + vx * halfV * sv, cz + uz * halfU * su + vz * halfV * sv];
  const y1 = y0 + height;
  const [p00, p10, p11, p01] = [c(-1, -1), c(1, -1), c(1, 1), c(-1, 1)];
  const wall = (a: [number, number], bq: [number, number], hint: Vec3): void => {
    const lo: Vec3 = [a[0], y0, a[1]];
    const lb: Vec3 = [bq[0], y0, bq[1]];
    const hb: Vec3 = [bq[0], y1, bq[1]];
    const ha: Vec3 = [a[0], y1, a[1]];
    const sf = turned ? alongSurface(spec, lo, ha, lb) : alongSurface(spec, lo, lb, ha);
    b.poly([lo, lb, hb, ha], hint, colour, sf);
  };
  wall(p00, p10, [-vx, 0, -vz]);
  wall(p10, p11, [ux, 0, uz]);
  wall(p11, p01, [vx, 0, vz]);
  wall(p01, p00, [-ux, 0, -uz]);
  const t0: Vec3 = [p00[0], y1, p00[1]];
  const t1: Vec3 = [p10[0], y1, p10[1]];
  const t2: Vec3 = [p11[0], y1, p11[1]];
  const t3: Vec3 = [p01[0], y1, p01[1]];
  b.poly([t0, t1, t2, t3], [0, 1, 0], colour, alongSurface(spec, t0, t1, t3));
  if (bottom) b.poly([[p00[0], y0, p00[1]], [p10[0], y0, p10[1]], [p11[0], y0, p11[1]], [p01[0], y0, p01[1]]], [0, -1, 0], scaled(colour, 0.5));
}

// ---------------------------------------------------------------------------------------------------------------------------- ties

const CREOSOTE: Rgb = [0.5, 0.46, 0.42];
const BLEACHED: Rgb = [1.2, 1.15, 1.07];
const WEATHERED: Rgb = [1.0, 0.92, 0.84];
const NEW_PALE: Rgb = [1.5, 1.2, 0.85];

/** The flat colours the tie's tints stand for when there is no texture. */
function tieFlat(tint: Rgb): Rgb {
  return [tint[0] * 0.13, tint[1] * 0.1, tint[2] * 0.08];
}

/** The rail's plate stands this far from a tie's middle along it, metres. */
const PLATE_AT = RAIL_GAUGE / 2;

/**
 * A slab along a tie's axis `(ux, uz)` from `a0` to `a1` from the centre `(cx, cz)`, `hw` half wide, from `y0` up to the heights `top0` and `top1`
 * at its ends (so it can tilt), with a surface whose grain runs along its length. The top is a grid cut where the rails' plates stand, so the
 * rust stain round each can be said at its vertices.
 */
function slab(b: MeshBuilder, cx: number, cz: number, ux: number, uz: number, a0: number, a1: number, hw: number, y0: number, top0: number, top1: number, tint: Rgb, key: number, plates: boolean): void {
  const vx = uz;
  const vz = -ux;
  const at = (a: number, w: number): [number, number] => [cx + ux * a + vx * w, cz + uz * a + vz * w];
  const topAt = (a: number): number => top0 + ((top1 - top0) * (a - a0)) / (a1 - a0);
  const flat = tieFlat(tint);
  const shift = key * 1.37;
  const spec = (wear: number | ((p: Vec3) => number), kind: WearKind = "grime"): SurfaceSpec => ({ layer: "planks_weathered", tint, wear, wearKind: kind });
  // The top: a grid with columns cut round each plate.
  const cuts = [a0];
  if (plates) for (const c of [-PLATE_AT, PLATE_AT]) if (c > a0 + 0.05 && c < a1 - 0.05) cuts.push(c);
  cuts.push(a1);
  const rows: Vec3[][] = [[], []];
  for (const a of cuts) {
    const l = at(a, -hw);
    const r = at(a, hw);
    (rows[0] as Vec3[]).push([l[0], topAt(a), l[1]]);
    (rows[1] as Vec3[]).push([r[0], topAt(a), r[1]]);
  }
  withMat("wood", () => b.grid(
    rows,
    [cx, y0 - 1, cz],
    {
      colour: flat,
      layer: "planks_weathered",
      tint,
      uv: (i, j) => [((cuts[j] as number) + shift) * 1.0, (i === 0 ? -hw : hw) * 1.0],
      wear: (i, j) => {
        const a = cuts[j] as number;
        return [plates && Math.abs(Math.abs(a) - PLATE_AT) < 0.01 ? 0.3 : 0.03, "rust"];
      },
      wear2: () => [0.18, "grime"],
    },
  ));
  // The sides and ends, with the grain along the slab.
  const corner = (a: number, w: number, y: number): Vec3 => {
    const p = at(a, w);
    return [p[0], y, p[1]];
  };
  const side = (w: number, hint: Vec3): void => {
    const a = corner(a0, w, y0);
    const bq = corner(a1, w, y0);
    const hb = corner(a1, w, topAt(a1));
    const ha = corner(a0, w, topAt(a0));
    b.poly([a, bq, hb, ha], hint, flat, alongSurface(spec(0.16), a, bq, ha, shift));
  };
  side(-hw, [-vx, 0, -vz]);
  side(hw, [vx, 0, vz]);
  const end = (a: number, hint: Vec3): void => {
    const l = corner(a, -hw, y0);
    const r = corner(a, hw, y0);
    const hr = corner(a, hw, topAt(a));
    const hl = corner(a, -hw, topAt(a));
    // End grain: darker, split and weathered, the planks' grain turned across.
    b.poly([l, r, hr, hl], hint, scaled(flat, 0.8), alongSurface(spec(0.45), l, hl, r, shift));
  };
  end(a0, [-ux, 0, -uz]);
  end(a1, [ux, 0, uz]);
}

/** A tie plate under a rail, canted a little toward the outside, with spikes. */
function plate(b: MeshBuilder, cx: number, cz: number, ux: number, uz: number, a: number, tieTop: number, g: number, key: number, spikes: boolean): void {
  const inner = a < 0 ? 1 : -1;
  const top = g + RAIL_FOOT - 0.0005;
  // The plate rests on the tie: its top is the rail foot's underside at its inner edge, falling away outward (a cant, so its top is not a plane parallel to the tie's).
  if (top - tieTop < 0.01) return;
  const rust: SurfaceSpec = { layer: "rust", tint: [0.55 + 0.2 * hash01(key, 5), 0.45, 0.38], wear: 0.1, wearKind: "rust" };
  // The plate's two ends along the tie: inner at `a + inner*0.1`, outer at `a - inner*0.1`, the outer lower.
  const lo = a - 0.1;
  const hi = a + 0.1;
  const vx = uz;
  const vz = -ux;
  const at = (s: number, w: number): [number, number] => [cx + ux * s + vx * w, cz + uz * s + vz * w];
  const yIn = top;
  const yOut = top - 0.012;
  const h0 = inner > 0 ? yOut : yIn;
  const h1 = inner > 0 ? yIn : yOut;
  const w = 0.085;
  const corner = (s: number, ww: number, y: number): Vec3 => {
    const p = at(s, ww);
    return [p[0], y, p[1]];
  };
  const yb = tieTop - 0.004;
  const flat: Rgb = [0.12, 0.07, 0.05];
  const q = (p0: Vec3, p1: Vec3, p2: Vec3, p3: Vec3, hint: Vec3): void => {
    b.poly([p0, p1, p2, p3], hint, flat, alongSurface(rust, p0, p1, p3));
  };
  q(corner(lo, -w, h0), corner(hi, -w, h1), corner(hi, w, h1), corner(lo, w, h0), [0, 1, 0]);
  q(corner(lo, -w, yb), corner(hi, -w, yb), corner(hi, -w, h1), corner(lo, -w, h0), [-vx, 0, -vz]);
  q(corner(hi, w, yb), corner(lo, w, yb), corner(lo, w, h0), corner(hi, w, h1), [vx, 0, vz]);
  if (!spikes) return;
  // Two spikes on the plate's outer side of the foot: a thin pyramid each, rust-brown.
  for (const sw of [key % 2 === 0 ? -0.05 : 0.05]) {
    const s = a - inner * 0.085;
    const base = at(s, sw);
    const yb2 = h0 + (h1 - h0) * ((s - lo) / (hi - lo));
    const r = 0.011;
    const p0: Vec3 = [base[0] - ux * r, yb2, base[1] - uz * r];
    const p1: Vec3 = [base[0] + vx * r, yb2, base[1] + vz * r];
    const p2: Vec3 = [base[0] + ux * r, yb2, base[1] + uz * r];
    const tip: Vec3 = [base[0], yb2 + 0.04, base[1]];
    const sp: Surface = alongSurface({ layer: "rust", tint: [0.6, 0.38, 0.28], wear: 0.3, wearKind: "rust" }, p0, tip, p1) as Surface;
    // A thin spike seen from the side: one upright triangle, its face turned along the tie so that it shows from the track.
    b.poly([p0, p2, tip], [-vx, 0.3, -vz], flat, sp);
  }
}

/**
 * One tie at a frame (its centre's place): an individual, or nothing (one in forty is gone). `full` adds the plates and spikes. The frame's `g` is
 * the bench's height.
 */
export function tieAt(b: MeshBuilder, look: Look, f: Frame, full: boolean): void {
  const h = (salt: number): number => hashAt(f.x, f.z, 200 + salt);
  if (h(0) < 0.025) return;
  const st = stretchAt(look, f.x, f.z);
  const fresh = newRunAt(look, f.x, f.z) && h(1) < 0.88;
  const isNew = fresh || h(2) < 0.02;
  // Its look: creosote, weathered brown, or bleached silver-grey by its age; a new one pale.
  const pick = h(3) + (look.spur ? 0.12 : 0) * st.age;
  const sun = h(4);
  const tint: Rgb = isNew ? scaled(NEW_PALE, 0.95 + 0.1 * sun) : pick < 0.5 ? scaled(CREOSOTE, 0.8 + 0.4 * sun) : pick < 0.82 ? scaled(WEATHERED, 0.8 + 0.3 * sun) : scaled(BLEACHED, 0.8 + 0.3 * sun);
  const skew = (h(5) - 0.5) * 0.07;
  const cs = Math.cos(skew);
  const sn = Math.sin(skew);
  const ux = f.nx * cs - f.nz * sn;
  const uz = f.nz * cs + f.nx * sn;
  // Sunk or proud: more sunk than proud (the plates and the rail's foot stand at the proud side's height).
  const dy = -0.03 + h(6) * 0.026 + (isNew ? 0.004 : 0);
  const tilt = (h(7) - 0.5) * 0.02;
  const L = TIE_HALF_LENGTH + (h(8) - 0.5) * 0.1;
  const hw = TIE_HALF_WIDTH + (h(9) - 0.5) * 0.012;
  const cx = f.x + (h(10) - 0.5) * 0.03 * f.nz;
  const cz = f.z - (h(10) - 0.5) * 0.03 * f.nx;
  const y0 = f.g + TIE_BOTTOM + dy - 0.01;
  const topAt = (a: number): number => f.g + TIE_TOP + dy + (tilt * a) / L;
  const key = Math.floor(h(11) * 1000);
  const split = !isNew && h(12) < 0.08;
  if (split) {
    const side = h(13) < 0.5 ? -1 : 1;
    const cut = side * (L - 0.4 - 0.2 * h(14));
    // The long piece and the end piece, a centimetre apart, the end piece a little turned down.
    if (side > 0) {
      slab(b, cx, cz, ux, uz, -L, cut - 0.006, hw, y0, topAt(-L), topAt(cut - 0.006), tint, key, full);
      slab(b, cx, cz, ux, uz, cut + 0.006, L, hw - 0.004, y0 - 0.006, topAt(cut + 0.006) - 0.008, topAt(L) - 0.012, tint, key + 1, false);
    } else {
      slab(b, cx, cz, ux, uz, cut + 0.006, L, hw, y0, topAt(cut + 0.006), topAt(L), tint, key, full);
      slab(b, cx, cz, ux, uz, -L, cut - 0.006, hw - 0.004, y0 - 0.006, topAt(-L) - 0.012, topAt(cut - 0.006) - 0.008, tint, key + 1, false);
    }
  } else slab(b, cx, cz, ux, uz, -L, L, hw, y0, topAt(-L), topAt(L), tint, key, full);
  if (full) for (const a of [-PLATE_AT, PLATE_AT]) plate(b, cx, cz, ux, uz, a, topAt(a), f.g, key + (a < 0 ? 0 : 7), true);
}

// ---------------------------------------------------------------------------------------------------------------------------- rails

/** The surfaces of a rail's head top and of the rest of its section: a used line's head is bright, a spur's is rust all over. */
export function railSpecs(look: Look, x: number, z: number): { top: SurfaceSpec; side: SurfaceSpec; flatTop: Rgb; flatSide: Rgb } {
  const w = 0.5 + 0.4 * vnoise(x / 11 + z / 11, z / 11 - x / 11, (look.seed & 0xfff) + 61);
  if (look.spur) {
    return {
      top: { layer: "rust", tint: [0.78, 0.55, 0.4], wear: 0.3, wearKind: "rust" },
      side: { layer: "rust", tint: [0.6, 0.38, 0.27], wear: 0.45, wearKind: "rust" },
      flatTop: [0.22, 0.13, 0.09],
      flatSide: [0.17, 0.1, 0.07],
    };
  }
  return {
    top: { layer: "metal_aged", tint: [1.05, 1.02, 0.98], wear: 0.04, wearKind: "rust" },
    side: { layer: "metal_aged", tint: [0.62, 0.5, 0.44], wear: w * 0.55, wearKind: "rust", wear2: 0.2, wearKind2: "grime", streaks2: true },
    flatTop: [0.34, 0.31, 0.29],
    flatSide: [0.2, 0.15, 0.12],
  };
}

/** The spacing of a jointed rail's joints, metres, and how deep a low joint dips, and how far it dips along. */
export const JOINT = 12;
const JOINT_DIP = 0.008;
const JOINT_REACH = 3;

/** How far a jointed rail's top is lowered at a distance `s` along its run (a low joint every `JOINT` m, by its own luck). */
export function dipAt(look: Look, s: number, run: number): number {
  const k = Math.round(s / JOINT);
  const d = Math.abs(s - k * JOINT);
  if (d >= JOINT_REACH) return 0;
  const luck = hash01(k + run * 131, (look.seed & 0xfff) + 17);
  const t = 1 - d / JOINT_REACH;
  return -JOINT_DIP * (0.2 + 0.8 * luck) * t * t;
}

/** Fish plates over a joint of the spur's rails: two bars, one each side of the web, bolted. */
export function jointBars(b: MeshBuilder, f: Frame, along: Vec3, dip: number): void {
  const ax = along[0];
  const az = along[2];
  const vx = az;
  const vz = -ax;
  for (const rail of [-RAIL_GAUGE / 2, RAIL_GAUGE / 2]) {
    const cx = f.x + f.nx * rail;
    const cz = f.z + f.nz * rail;
    for (const side of [rail < 0 ? -1 : 1]) {
      // A bar against the web, under the head and over the foot's ledge: 0.5 m long, 3 cm high (a grade of a few percent lifts its ends a centimetre off the rail's line, so it keeps under the head), 2.5 cm thick.
      withMat("rusty", () => texBox(b, cx + vx * side * 0.0325, cz + vz * side * 0.0325, f.g + RAIL_FOOT + 0.04 + dip, ax, az, 0.26, 0.0125, 0.03, { layer: "rust", tint: [0.55, 0.36, 0.27], wear: 0.4, wearKind: "rust" }, false, [0.17, 0.1, 0.07], false));
    }
  }
}

// ---------------------------------------------------------------------------------------------------------------------------- weeds

const GREENS: readonly Rgb[] = [
  [0.4, 0.58, 0.15],
  [0.48, 0.62, 0.19],
  [0.34, 0.52, 0.12],
  [0.5, 0.56, 0.2],
];
const STRAW: Rgb = [0.6, 0.48, 0.27];

/**
 * A tuft of weed rooted at (x, y, z): three to six thin upright blades, each one triangle (dark at the foot, lighter at the tip), no two
 * leaning the same way, lit by a normal turned up so the sky reaches them (the method of the town's own tufts, `growth.ts`).
 */
export function tuft(m: MeshBuilder, x: number, y: number, z: number, seed: number, blades: number, tall: number, dry: number): void {
  const r = (i: number): number => hash01(seed * 131 + i * 17, 4243);
  const base = r(0) * Math.PI * 2;
  const hMax = 0.1 + 0.16 * tall * (0.5 + 0.5 * r(1));
  const dead = r(3) < dry;
  for (let b = 0; b < blades; b++) {
    const ang = base + ((b + 0.25 * (r(10 + b) - 0.5)) / blades) * Math.PI * 2;
    const dx = Math.cos(ang);
    const dz = Math.sin(ang);
    const h = hMax * (0.4 + 0.6 * r(20 + b));
    const bent = r(25 + b) < 0.2;
    const lean = h * (bent ? 0.55 + 0.35 * r(30 + b) : 0.1 + 0.4 * r(30 + b));
    const tipY = bent ? y + h * (0.55 + 0.2 * r(35 + b)) : y + h;
    const w = 0.005 + 0.009 * r(40 + b);
    const fx = x + dx * 0.03 * r(50 + b);
    const fz = z + dz * 0.03 * r(60 + b);
    const px = -dz;
    const pz = dx;
    const tip: Vec3 = [fx + dx * lean, tipY, fz + dz * lean];
    const colour = dead || r(70 + b) < 0.08 ? STRAW : (GREENS[Math.floor(r(80 + b) * GREENS.length)] as Rgb);
    const foot: Rgb = [colour[0] * 0.7, colour[1] * 0.75, colour[2] * 0.6];
    const tipC: Rgb = [colour[0] * 1.25, colour[1] * 1.2, colour[2]];
    const pa: Vec3 = [fx - px * w, y, fz - pz * w];
    const pb: Vec3 = [fx + px * w, y, fz + pz * w];
    const ux = pb[0] - pa[0];
    const uz = pb[2] - pa[2];
    const vx = tip[0] - pa[0];
    const vy = tip[1] - pa[1];
    const vz = tip[2] - pa[2];
    let gx = 0 * vz - uz * vy;
    let gy = uz * vx - ux * vz;
    let gz = ux * vy - 0 * vx;
    const gl = Math.sqrt(gx * gx + gy * gy + gz * gz) || 1;
    const sgn = (gx * dx + gy * 0.15 + gz * dz) / gl < 0 ? -1 : 1;
    gx = (sgn * gx) / gl;
    gy = (sgn * gy) / gl;
    gz = (sgn * gz) / gl;
    const lx = gx * 0.7;
    const ly = gy * 0.7 + 0.7;
    const lz = gz * 0.7;
    const ll = Math.sqrt(lx * lx + ly * ly + lz * lz);
    withMat("plant", () => m.poly([pa, pb, tip], [dx, 0.15, dz], [foot, foot, tipC], undefined, { glow: 0.1, normal: [lx / ll, ly / ll, lz / ll] }));
  }
}

/**
 * The weeds of a stretch of bed at a frame: between the ties and along the shoulders, by the stretch's weediness (sparse on the main line, thick
 * on the spur). `row` tells this frame's place in the run so tufts keep their own seeds.
 */
export function weedsAt(b: MeshBuilder, look: Look, f: Frame, key: number, cribs: boolean): void {
  const st = stretchAt(look, f.x, f.z);
  const t: readonly [number, number] = [-f.nz, f.nx];
  const rnd = (salt: number): number => hashAt(f.x, f.z, 300 + salt + key);
  const toeL = toeOf(look, f, -1, true);
  const toeR = toeOf(look, f, 1, true);
  const place = (off: number, along: number, salt: number): void => {
    const x = f.x + f.nx * off + t[0] * along;
    const z = f.z + f.nz * off + t[1] * along;
    const toe = off < 0 ? toeL : toeR;
    const y = f.g + bedDy(look, x, z, off, toe, true) - 0.005;
    const seed = Math.floor(rnd(salt) * 1e6) + 1;
    tuft(b, x, y, z, seed, 3 + Math.floor(rnd(salt + 1) * 3.99), 0.35 + 0.65 * st.weeds, 0.15 + 0.3 * st.age);
  };
  // In the cribs between ties, off the rails' line.
  if (cribs && rnd(0) < st.weeds * 0.32) {
    const side = rnd(1) < 0.5 ? -1 : 1;
    const off = side * (0.95 + 0.4 * rnd(2));
    place(off, 0.275, 3);
  }
  // Along the shoulders: clumps.
  if (rnd(10) < st.weeds * 0.22) {
    const side = rnd(11) < 0.5 ? -1 : 1;
    const toe = side < 0 ? toeL : toeR;
    place(side * (EDGE + (toe - EDGE) * (0.3 + 0.5 * rnd(12))), 0, 13);
  }
}

// Not used by name elsewhere, but kept with the rails so a level that wants the foot or head height reads one place.
export const RAIL_HEIGHTS = { foot: RAIL_FOOT, top: RAIL_TOP } as const;
