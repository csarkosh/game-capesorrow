/**
 * Vehicles as plain arrays. Each body is lofted through stations from the rear bumper to the nose (`vehicleStyle.ts`: not a box, with rounded
 * shoulders, tumblehome, a raked bonnet and screen, and wheel arches cut by raising the lower edge of the stations over each wheel), smooth
 * shaded, in the painted-metal layer with a tint and wear by cause: road grime low on the body, rust at the arches and sills of old ones,
 * a faded clear coat on roofs and bonnets, and green algae along the window seals of one that has not moved. Glass is the town's see-through
 * effect (`clear`) over a dark cabin with seats you can make out; wheels are tyres with rims in the arches; bumpers, lamps, mirrors, door seams, a
 * plain plate. States are drawn by cause: a work vehicle has its gear, a project car stands on blocks with no wheels (some under a tarp), a
 * derelict sits low on flat tyres with its paint gone.
 *
 * The low tier lofts through fewer stations and columns, with simpler wheels, and leaves off the interior, mirrors, seams and handles.
 */
import type { MeshBuilder, Rgb, Vec3 } from "../meshBuilder.js";
import type { Detail } from "../townTypes.js";
import type { Vehicle } from "../../../sim/town/types.js";
import type { TownGround } from "../townTypes.js";
import type { WearKind } from "../townSurface.js";
import { RANK } from "../groundSurfaces.js";
import { drawnAsModel } from "./vehicleFleet.js";
import { D, P, groundAt, lbox, lquadX, lquadZ, mix, mixC, placeOn, rnd, type Place } from "./kit.js";
import { BUMPER, CABIN, CHROME, GLASS_CAR, LAMP, PAINT, PLATE, RIM, SEAT, SHAPES, TAIL, TARP_BLUE, TARP_SILVER, TYRE, UNDER, paintTint, type Shape, type Station } from "./vehicleStyle.js";

type Sink = (x: number, z: number) => MeshBuilder;
export type VehicleSinks = { readonly solid: Sink; readonly glass: Sink; readonly flat?: Sink };

type Opts = {
  readonly sx: number;
  readonly sw: number;
  readonly xOff: number;
  readonly len: number;
  readonly paint: Rgb;
  readonly age: number;
  readonly idle: number;
  readonly detail: Detail;
  readonly flat: boolean;
  readonly wheels: boolean;
  readonly seed: number;
  /** Where the cab's loft begins in the vehicle (a work truck's cab is the shape's whole length at its front). */
  readonly sy: number;
};

const clamp01 = (x: number): number => Math.min(1, Math.max(0, x));

/** The right half's columns (ids 1 to 7: sill, low, belt, c4, c5, c6, crown): all of them on the full tier, four on the low one. */
const COLS_FULL = [1, 3, 5, 6, 7];
const COLS_LOW = [1, 3, 5, 7];

/** The loft's stations: the shape's own, plus a ring around each axle for the arch and the ends of the glass. */
function stationsOf(sh: Shape, o: Opts, r: number): { x: number; st: Station; crease: boolean }[] {
  const base = sh.stations.map((s): Station => [s[0] * o.sx, s[1] * o.sy, s[2] * o.sy, s[3] * o.sw, s[4] * o.sw]);
  const at = (x: number): Station => {
    for (let i = 0; i < base.length - 1; i++) {
      const a = base[i] as Station;
      const b = base[i + 1] as Station;
      if (x >= a[0] - 1e-9 && x <= b[0] + 1e-9) {
        const t = b[0] === a[0] ? 0 : (x - a[0]) / (b[0] - a[0]);
        return [x, mix(a[1], b[1], t), mix(a[2], b[2], t), mix(a[3], b[3], t), mix(a[4], b[4], t)];
      }
    }
    return base[base.length - 1] as Station;
  };
  const xs: { x: number; crease: boolean }[] = base.map((s, i) => ({ x: s[0], crease: sh.creases.includes(i) }));
  const ra = r + 0.07;
  const dxs = [-1, -0.45, 0.45, 1];
  // The low tier lofts through the shape's own stations only (no arches cut, the glass in whole intervals).
  if (o.detail !== "low") {
    for (const a of sh.axles) for (const d of dxs) xs.push({ x: a * o.sx + d * ra, crease: false });
    for (const [a, b] of [...sh.side, ...sh.screens]) {
      xs.push({ x: a * o.sx, crease: false });
      xs.push({ x: b * o.sx, crease: false });
    }
  }
  xs.sort((p, q) => p.x - q.x);
  const out: { x: number; st: Station; crease: boolean }[] = [];
  for (const e of xs) {
    const last = out[out.length - 1];
    if (last !== undefined && e.x - last.x < 0.025) {
      if (e.crease) last.crease = true;
      continue;
    }
    out.push({ x: e.x, st: at(Math.min(e.x, (base[base.length - 1] as Station)[0])), crease: e.crease });
  }
  return out;
}

/** The loft of a body: returns nothing, draws into `m` (the body and its dark cabin) and `gl` (the glass). */
function loft(m: MeshBuilder, gl: MeshBuilder, pl: Place, sh: Shape, o: Opts): void {
  const low = o.detail === "low";
  const cols = low ? COLS_LOW : COLS_FULL;
  const rFlat = o.flat ? sh.r * 0.84 : sh.r;
  const ra = sh.r + 0.07;
  const ay = rFlat;
  const sts = stationsOf(sh, o, sh.r);
  const half = (id: number, s: Station, sill: number): [number, number] => {
    const [, top, belt, w, wTop] = s;
    const dh = top - belt;
    switch (id) {
      case 1: return [w - 0.05, sill];
      case 2: return [w - 0.012, Math.max(mix(sill, belt, 0.45), sill + 0.09)];
      case 3: return [w, belt];
      case 4: return [mix(w, wTop, 0.35), belt + 0.38 * dh];
      case 5: return [mix(w, wTop, 0.85), belt + 0.82 * dh];
      case 6: return [wTop * 0.62, top - 0.02];
      default: return [0, top];
    }
  };
  const archY = (x: number): number => {
    let y = o.flat ? sh.sill - 0.04 : sh.sill;
    for (const a of sh.axles) {
      const d = x - (a * o.sx);
      if (o.detail !== "low" && Math.abs(d) < ra) y = Math.max(y, ay + Math.sqrt(ra * ra - d * d) - 0.0);
    }
    return y;
  };
  const bedX0 = sh.bed === undefined ? 0 : sh.bed.x0 * o.sx;
  const bedX1 = sh.bed === undefined ? 0 : sh.bed.x1 * o.sx;
  const inBed = (x: number): boolean => sh.bed !== undefined && x >= bedX0 - 1e-6 && x <= bedX1 + 1e-6;
  const L = (x: number): number => x + o.xOff - o.len / 2;
  const rowsPts: Vec3[][] = [];
  const meta: { x: number; belt: number; top: number; sill: number }[] = [];
  for (const e of sts) {
    const sill = archY(e.x + 0);
    const st: Station = inBed(e.x) ? [e.x, e.st[2] + 0.02, e.st[2], e.st[3], e.st[3] - 0.09] : e.st;
    const right = cols.map((id) => half(id, st, sill));
    const row: Vec3[] = [];
    for (let k = 0; k < right.length; k++) row.push(P(pl, L(e.x), (right[k] as [number, number])[1], -(right[k] as [number, number])[0]));
    for (let k = right.length - 2; k >= 0; k--) row.push(P(pl, L(e.x), (right[k] as [number, number])[1], (right[k] as [number, number])[0]));
    rowsPts.push(row);
    meta.push({ x: e.x, belt: st[2], top: st[1], sill });
  }
  const nc = cols.length;
  const ncol = nc * 2 - 1;
  const mid = nc - 1;
  // The column id (1 to 7) of point j of a row, and which side it is on.
  const idOf = (j: number): number => cols[j <= mid ? j : ncol - 1 - j] as number;
  const interval = (i: number): { x: number; side: boolean; screen: boolean } => {
    const x = ((meta[i] as { x: number }).x + (meta[i + 1] as { x: number }).x) / 2;
    return { x, side: sh.side.some(([a, b]) => x > a * o.sx && x < b * o.sx), screen: sh.screens.some(([a, b]) => x > a * o.sx && x < b * o.sx) };
  };
  const glassQuad = (i: number, j: number): boolean => {
    const a = idOf(j);
    const b = idOf(j + 1);
    const { side, screen } = interval(i);
    // A pair of columns on one side between the belt and the roof's edge is side glass; any pair from the belt to the crown is screen glass.
    const lo = Math.min(a, b);
    const hi = Math.max(a, b);
    if (screen && lo >= 3) return true;
    if (side && lo >= 3 && hi <= 5) return true;
    return false;
  };
  const opening = (i: number, j: number): boolean => {
    const x = (((meta[i] as { x: number }).x + (meta[i + 1] as { x: number }).x) / 2);
    if (!inBed(x)) return false;
    return Math.min(idOf(j), idOf(j + 1)) >= 5;
  };
  // The painted loft, in segments that share normals only within a segment (a crease starts a new one).
  const breaks: number[] = [0];
  sts.forEach((e, i) => {
    if (e.crease && i > 0) breaks.push(i);
  });
  breaks.push(sts.length - 1);
  const wearAt = (i: number, j: number): { rust: number; algae: number; grime: number; fade: number } => {
    const mt = meta[i] as { x: number; belt: number; top: number; sill: number };
    const p = (rowsPts[i] as Vec3[])[j] as Vec3;
    const y = p[1] - pl.y0;
    const id = idOf(j);
    let near = 0;
    for (const a of sh.axles) near = Math.max(near, clamp01(1 - (Math.abs(mt.x - a * o.sx) - ra) / 0.35));
    const lowBody = id <= 2 ? 1 : id === 3 ? 0.25 : 0;
    const rust = o.age > 0.4 ? (o.age - 0.3) * (near * lowBody * 0.75 + (id === 1 ? 0.25 : 0)) : 0;
    const seal = id >= 3 && id <= 5 ? 1 : 0;
    const algae = o.idle > 0.45 ? (o.idle - 0.3) * seal * 1.05 : 0;
    const grime = clamp01(1 - (y - o.sy * 0.2) / Math.max(0.3, mt.belt - 0.1)) * (0.25 + o.idle * 0.45) * 0.8 + o.idle * 0.1;
    const fade = id >= 5 || mt.top - mt.belt < 0.2 ? o.age * 0.55 : o.age * 0.08;
    return { rust, algae, grime, fade };
  };
  const shade = (c: Rgb, fade: number): Rgb => mixC(c, [0.42, 0.42, 0.4], fade);
  for (let b = 0; b < breaks.length - 1; b++) {
    const i0 = breaks[b] as number;
    const i1 = breaks[b + 1] as number;
    const a0 = i0;
    const a1 = i1;
    // The rows of this segment, and (for a crease) a bridge of one row of quads to the next segment.
    const rows = rowsPts.slice(a0, a1 + 1);
    const centre: Vec3 = P(pl, L(o.len / 2), 0.7, 0);
    const look = (ii: number, j: number) => ({ ii: ii + a0, j });
    const colourOf = (ii: number, j: number): Rgb => shade(o.paint, wearAt(look(ii, j).ii, j).fade);
    const uvLen: number[][] = rows.map((row) => {
      const acc: number[] = [0];
      for (let j = 1; j < row.length; j++) {
        const p = row[j - 1] as Vec3;
        const q = row[j] as Vec3;
        acc.push((acc[j - 1] as number) + Math.sqrt((p[0] - q[0]) * (p[0] - q[0]) + (p[1] - q[1]) * (p[1] - q[1]) + (p[2] - q[2]) * (p[2] - q[2])));
      }
      return acc;
    });
    m.grid(rows, centre, {
      colour: colourOf,
      layer: "roof_bitumen",
      tint: (ii, j) => paintTint(colourOf(ii, j)),
      uv: (ii, j) => [(meta[ii + a0] as { x: number }).x * 6, (uvLen[ii] as number[])[j] as number * 6],
      wear: (ii, j) => {
        const w = wearAt(look(ii, j).ii, j);
        const kind: WearKind = w.rust >= w.algae ? "rust" : "algae";
        return [Math.max(w.rust, w.algae), kind];
      },
      wear2: (ii, j) => [wearAt(look(ii, j).ii, j).grime, "grime"],
    }, (ii, j) => {
      const gi = ii + a0;
      return glassQuad(gi, j) || opening(gi, j);
    });
  }
  // The glass over a dark cabin, a window at a time: for each window (a range of the shape), its first and last rows and the coarse cells between them (columns belt, roof's
  // edge, crown, roof's edge, belt): the glass a quad per cell, the dark sheet inside it the same quad drawn inward.
  const coarse: number[] = [];
  for (let j = 0; j < ncol; j++) if (idOf(j) === 3 || idOf(j) === 5 || idOf(j) === 7) coarse.push(j);
  for (const [a, b] of [...sh.side, ...sh.screens]) {
    const xa = a * o.sx;
    const xb = b * o.sx;
    let i0 = -1;
    let i1 = -1;
    for (let i = 0; i < sts.length; i++) {
      const x = (meta[i] as { x: number }).x;
      if (i0 < 0 && x >= xa - 0.03) i0 = i;
      if (x <= xb + 0.03) i1 = i;
    }
    if (i0 < 0 || i1 <= i0) continue;
    const mi = Math.min(sts.length - 2, Math.floor((i0 + i1) / 2));
    const ctr = P(pl, L((meta[mi] as { x: number }).x), (meta[mi] as { belt: number }).belt - 0.1, 0);
    for (let k = 0; k < coarse.length - 1; k++) {
      const j0 = coarse[k] as number;
      const j1 = coarse[k + 1] as number;
      if (!glassQuad(mi, j0) || !glassQuad(mi, j1 - 1)) continue;
      const pa = (rowsPts[i0] as Vec3[])[j0] as Vec3;
      const pb = (rowsPts[i0] as Vec3[])[j1] as Vec3;
      const pc = (rowsPts[i1] as Vec3[])[j1] as Vec3;
      const pd = (rowsPts[i1] as Vec3[])[j0] as Vec3;
      const n = faceNormal(pa, pb, pc, pd, ctr);
      if (low) {
        m.poly([pa, pb, pc, pd], n, GLASS_CAR);
        continue;
      }
      gl.poly([pa, pb, pc, pd], n, GLASS_CAR, undefined, { clear: 0.5 });
      const inset = (p: Vec3): Vec3 => [p[0] + (ctr[0] - p[0]) * 0.1, p[1] + (ctr[1] - p[1]) * 0.1, p[2] + (ctr[2] - p[2]) * 0.1];
      m.poly([inset(pa), inset(pb), inset(pc), inset(pd)], n, CABIN);
    }
  }
  // The ends: the first and last rings are caps.
  const cap = (ri: number, face: 1 | -1): void => m.poly(rowsPts[ri] as Vec3[], D(pl, face, 0, 0), shade(o.paint, o.age * 0.2));
  cap(0, -1);
  cap(rowsPts.length - 1, 1);
  // The underside, so the car is not seen through from below.
  const first = rowsPts[0] as Vec3[];
  const last = rowsPts[rowsPts.length - 1] as Vec3[];
  m.poly([first[0] as Vec3, first[ncol - 1] as Vec3, last[ncol - 1] as Vec3, last[0] as Vec3], [0, -1, 0], UNDER);
  // The arches' inner walls: a dark half disc inboard of each opening, so the arch does not show through to the sky.
  if (!low) for (const a of sh.axles) {
    const wA = ((sts.find((e) => e.x >= a * o.sx)?.st ?? (sts[0] as { st: Station }).st) as Station)[3];
    for (const sg of [1, -1]) {
      const pts: Vec3[] = [];
      const n = low ? 4 : 7;
      for (let k = 0; k <= n; k++) {
        const th = (k / n) * Math.PI;
        pts.push(P(pl, L(a * o.sx) + Math.cos(th) * ra * 0.98, ay + Math.sin(th) * ra * 0.98, sg * (wA - 0.4)));
      }
      m.poly(pts, D(pl, 0, 0, sg), UNDER);
    }
  }
  // The bed: floor, inner walls and the cab's back wall.
  if (sh.bed !== undefined) {
    const f = sh.bed.floor * o.sy;
    const wb = (sts.find((e) => e.x >= bedX0 + 0.3)?.st ?? (sts[0] as { st: Station }).st)[3] - 0.09;
    const railTop = (sts.find((e) => e.x >= bedX0 + 0.3)?.st ?? (sts[0] as { st: Station }).st)[2] + 0.02;
    const liner: Rgb = [0.02, 0.02, 0.022];
    m.poly([P(pl, L(bedX0), f, -wb), P(pl, L(bedX1), f, -wb), P(pl, L(bedX1), f, wb), P(pl, L(bedX0), f, wb)], [0, 1, 0], liner);
    for (const sg of [1, -1]) m.poly([P(pl, L(bedX0), f, sg * wb), P(pl, L(bedX1), f, sg * wb), P(pl, L(bedX1), railTop, sg * wb), P(pl, L(bedX0), railTop, sg * wb)], D(pl, 0, 0, -sg), shade(o.paint, o.age * 0.2));
    m.poly([P(pl, L(bedX1), f, -wb), P(pl, L(bedX1), f, wb), P(pl, L(bedX1), railTop, wb), P(pl, L(bedX1), railTop, -wb)], D(pl, -1, 0, 0), liner);
    m.poly([P(pl, L(bedX0), f, wb), P(pl, L(bedX0), f, -wb), P(pl, L(bedX0), railTop, -wb), P(pl, L(bedX0), railTop, wb)], D(pl, 1, 0, 0), liner);
  }
}

function faceNormal(a: Vec3, b: Vec3, c: Vec3, d: Vec3, inside: Vec3): Vec3 {
  const ux = c[0] - a[0];
  const uy = c[1] - a[1];
  const uz = c[2] - a[2];
  const wx = d[0] - b[0];
  const wy = d[1] - b[1];
  const wz = d[2] - b[2];
  const n: Vec3 = [uy * wz - uz * wy, uz * wx - ux * wz, ux * wy - uy * wx];
  const dot = n[0] * (a[0] - inside[0]) + n[1] * (a[1] - inside[1]) + n[2] * (a[2] - inside[2]);
  return dot < 0 ? [-n[0], -n[1], -n[2]] : n;
}

/** A tyre on a rim at the local place (x, y of its centre, z of its outer face), its face out to the side `sg`: the tread smooth round, a dark face and a lighter rim. */
function wheel(m: MeshBuilder, pl: Place, x: number, y: number, z: number, r: number, tw: number, sg: number, detail: Detail, flat: boolean, paintRim: Rgb): void {
  const n = detail === "low" ? 6 : 9;
  const sq = flat ? 0.93 : 1;
  const ring = (rad: number, zz: number): Vec3[] => Array.from({ length: n + 1 }, (_, i) => P(pl, x + Math.cos((i / n) * Math.PI * 2) * rad, y + Math.sin((i / n) * Math.PI * 2) * rad * sq - (flat ? 0.015 : 0), zz));
  m.grid([ring(r, z - sg * tw), ring(r, z)], P(pl, x, y, z - sg * tw / 2), { colour: TYRE });
  // The tyre's face and the rim's disc 3 cm proud of it (a hub that stands out, not a second face laid on the first).
  m.poly(ring(r, z).slice(0, n), D(pl, 0, 0, sg), TYRE);
  m.poly(ring(r * 0.62, z + sg * 0.03).slice(0, n), D(pl, 0, 0, sg), paintRim);
}

function wheelsOf(m: MeshBuilder, pl: Place, sh: Shape, o: Opts, v: Vehicle, wAt: (x: number) => number): void {
  const r = o.flat ? sh.r * 0.84 : sh.r;
  const rim: Rgb = v.age > 0.55 || v.kind === "work truck" ? [0.2, 0.2, 0.2] : mixC(RIM, [0.5, 0.5, 0.52], rnd(v.seed, 4) * 0.8);
  for (const a of sh.axles) {
    const x = a * o.sx + o.xOff - o.len / 2;
    for (const sg of [1, -1]) wheel(m, pl, x, r, sg * (wAt(a * o.sx) - 0.06), r, sh.tw, sg, o.detail, o.flat, rim);
  }
}

/** A box seen through the glass: seats and the dash. */
function interior(m: MeshBuilder, pl: Place, sh: Shape, o: Opts, wAt: (x: number) => number, beltAt: (x: number) => number): void {
  for (const sx of sh.seats) {
    const x = sx * o.sx + o.xOff - o.len / 2;
    const y0 = Math.max(0.5 * o.sy, sh.sill + 0.2);
    const w = wAt(sx * o.sx) - 0.15;
    lbox(m, pl, x - 0.3, x - 0.2, y0, beltAt(sx * o.sx) + 0.3, -w, w, SEAT);
  }
  const dx = (sh.mirror - 0.5) * o.sx + o.xOff - o.len / 2;
  lbox(m, pl, dx, dx + 0.3, beltAt(sh.mirror * o.sx) - 0.25, beltAt(sh.mirror * o.sx) + 0.02, -(wAt(sh.mirror * o.sx) - 0.1), wAt(sh.mirror * o.sx) - 0.1, [0.02, 0.02, 0.022]);
}

function details(m: MeshBuilder, pl: Place, sh: Shape, o: Opts, v: Vehicle, wAt: (x: number) => number, beltAt: (x: number) => number): void {
  const L = o.len;
  const front = o.xOff - L / 2 + sh.L * o.sx;
  const rear = o.xOff - L / 2;
  const lowTier = o.detail === "low";
  const old = v.age > 0.5;
  const bumperC: Rgb = old || v.kind === "work truck" ? CHROME : mixC(BUMPER, o.paint, 0.3);
  const wF = wAt(sh.L * o.sx - 0.1);
  const wR = wAt(0.1);
  if (!lowTier) {
    lbox(m, pl, front - 0.1, front + 0.04, 0.34, 0.62, -(wF - 0.04), wF - 0.04, bumperC);
    lbox(m, pl, rear - 0.04, rear + 0.1, 0.34, 0.6, -(wR - 0.04), wR - 0.04, bumperC);
  }
  // Lamps and a grille at the nose, tail lamps and a plate at the tail.
  const yN = Math.max(beltAt(sh.L * o.sx) - 0.04, 0.7);
  for (const sg of [1, -1]) {
    lquadX(m, pl, front + 0.025, Math.max(yN - 0.12, 0.66), yN + 0.04, sg * wF * 0.55, sg * wF * 0.93, 1, LAMP);
    lquadX(m, pl, rear - 0.025, Math.max(beltAt(0.05) - 0.16, 0.66), Math.max(beltAt(0.05) - 0.02, 0.7), sg * wR * 0.6, sg * wR * 0.95, -1, TAIL);
  }
  if (lowTier) return;
  lquadX(m, pl, front + 0.025, Math.max(yN - 0.12, 0.66), yN + 0.02, -wF * 0.45, wF * 0.45, 1, [0.02, 0.02, 0.025]);
  lquadX(m, pl, rear - 0.06, 0.5, 0.64, -0.2, 0.2, -1, PLATE);
  for (const sg of [1, -1]) {
    const mx = sh.mirror * o.sx + o.xOff - o.len / 2;
    const w = wAt(sh.mirror * o.sx);
    lquadZ(m, pl, sg * (w + 0.12), mx - 0.05, mx + 0.04, beltAt(sh.mirror * o.sx) + 0.1, beltAt(sh.mirror * o.sx) + 0.25, sg as 1 | -1, [0.03, 0.03, 0.035]);
    lquadZ(m, pl, sg * (w + 0.12), mx - 0.05, mx + 0.04, beltAt(sh.mirror * o.sx) + 0.1, beltAt(sh.mirror * o.sx) + 0.25, -sg as 1 | -1, [0.03, 0.03, 0.035]);
    for (const dxm of sh.doors) {
      const x = dxm * o.sx + o.xOff - o.len / 2;
      const w2 = wAt(dxm * o.sx);
      lquadZ(m, pl, sg * (w2 + 0.02), x - 0.006, x + 0.006, sh.sill + 0.12, beltAt(dxm * o.sx) - 0.02, sg as 1 | -1, [0.008, 0.008, 0.01]);
    }
  }
}

/** The widest half-width and the belt at a local x of the shape, from its stations (for the details that sit on the body). */
function profileAt(sh: Shape, o: Opts): { wAt: (x: number) => number; beltAt: (x: number) => number } {
  const interp = (x: number, k: 2 | 3): number => {
    const st = sh.stations;
    for (let i = 0; i < st.length - 1; i++) {
      const a = st[i] as Station;
      const b = st[i + 1] as Station;
      if (x / o.sx >= a[0] && x / o.sx <= b[0]) {
        const t = b[0] === a[0] ? 0 : (x / o.sx - a[0]) / (b[0] - a[0]);
        return mix(a[k], b[k], t) * (k === 3 ? o.sw : o.sy);
      }
    }
    const e = st[st.length - 1] as Station;
    return e[k] * (k === 3 ? o.sw : o.sy);
  };
  return { wAt: (x) => interp(x, 3), beltAt: (x) => interp(x, 2) };
}

function loads(m: MeshBuilder, pl: Place, v: Vehicle, sh: Shape, o: Opts): void {
  const rear = o.xOff - o.len / 2;
  const box = (x0: number, x1: number, y0: number, y1: number, z0: number, z1: number, c: Rgb): void => lbox(m, pl, rear + x0, rear + x1, y0, y1, z0, z1, c);
  if (v.kind === "pickup" && sh.bed !== undefined) {
    const f = sh.bed.floor * o.sy;
    if (v.load === "gear") {
      box(0.25, 0.85, f, f + 0.35, -0.8, -0.25, [0.12, 0.12, 0.13]);
      box(0.3, 0.8, f, f + 0.22, 0.2, 0.7, [0.2, 0.1, 0.04]);
      box(1.1, 1.7, f, f + 0.18, -0.6, 0.55, [0.06, 0.07, 0.09]);
    } else if (v.load === "firewood") {
      for (let k = 0; k < 14; k++) box(0.25 + (k % 4) * 0.38, 0.6 + (k % 4) * 0.38, f + Math.floor(k / 4) * 0.2, f + 0.2 + Math.floor(k / 4) * 0.2, -0.75, 0.75, mixC([0.2, 0.12, 0.06], [0.28, 0.18, 0.1], rnd(v.seed, k)));
    } else if (v.load === "rack" || v.load === "ladder") {
      const top = 1.95 * o.sy;
      for (const x of [0.35, 1.75]) for (const z of [-0.84, 0.84]) box(x - 0.025, x + 0.025, f, top + 0.03, z - 0.025, z + 0.025, [0.1, 0.1, 0.11]);
      for (const z of [-0.84, 0.84]) box(0.35, 1.75, top - 0.05, top, z - 0.025, z + 0.025, [0.1, 0.1, 0.11]);
      if (v.load === "ladder") for (const z of [-0.2, 0.2]) box(-0.5, 2.9, top + 0.0, top + 0.05, z - 0.02, z + 0.02, [0.45, 0.46, 0.48]);
    }
  } else if (v.kind === "van" && v.load === "rack") {
    const top = 2.02 * o.sy;
    for (const z of [-0.8, 0.8]) box(0.4, 3.3, top, top + 0.06, z - 0.025, z + 0.025, [0.1, 0.1, 0.11]);
    for (const x of [0.6, 1.8, 3.1]) box(x - 0.02, x + 0.02, top, top + 0.08, -0.8, 0.8, [0.1, 0.1, 0.11]);
    box(-0.4, 3.6, top + 0.06, top + 0.1, -0.2, 0.2, [0.45, 0.46, 0.48]);
  }
}

/** A tarp over a body: its rings pushed out and up from the beltline's axis, drawn smooth, in a plain tarp colour. */
function tarpOver(m: MeshBuilder, pl: Place, sh: Shape, o: Opts, seed: number): void {
  const sts = sh.stations.map((s): Station => [s[0] * o.sx, s[1] * o.sy, s[2] * o.sy, s[3] * o.sw, s[4] * o.sw]);
  const colour = rnd(seed, 9) < 0.7 ? TARP_BLUE : TARP_SILVER;
  const L = (x: number): number => x + o.xOff - o.len / 2;
  const rows: Vec3[][] = [];
  const first = sts[1] as Station;
  const lastS = sts[sts.length - 2] as Station;
  const picks = [first, ...sts.slice(2, sts.length - 2), lastS];
  const sag = (i: number): number => 0.03 + 0.04 * Math.sin((i / Math.max(1, picks.length - 1)) * Math.PI * 3);
  picks.forEach((s, i) => {
    const [x, top, belt, w, wTop] = s;
    const lo = 0.5;
    const pts: [number, number][] = [[w * 1.05, lo], [w * 1.07, belt * 0.8], [mix(w, wTop, 0.6) * 1.08, belt + (top - belt) * 0.5 + 0.03], [wTop * 0.7 * 1.08, top + 0.1 + sag(i)], [0, top + 0.12 + sag(i)]];
    const row: Vec3[] = [];
    for (const [z, y] of pts) row.push(P(pl, L(x), y, -z));
    for (let k = pts.length - 2; k >= 0; k--) row.push(P(pl, L(x), (pts[k] as [number, number])[1], (pts[k] as [number, number])[0]));
    rows.push(row);
  });
  m.grid(rows, P(pl, L(o.len / 2), 0.7, 0), { colour });
  // The ends tucked in.
  m.poly(rows[0] as Vec3[], D(pl, -1, 0, 0), colour);
  m.poly(rows[rows.length - 1] as Vec3[], D(pl, 1, 0, 0), colour);
}

function blocks(m: MeshBuilder, pl: Place, sh: Shape, o: Opts): void {
  for (const a of sh.axles) {
    const x = a * o.sx + o.xOff - o.len / 2;
    for (const sg of [1, -1]) lbox(m, pl, x - 0.2, x + 0.2, 0, o.sy * 0.36, sg * 0.62 - 0.2, sg * 0.62 + 0.2, [0.22, 0.22, 0.21]);
  }
}

/** A work truck: a cab (the van's front, shortened) on a frame with a flatbed or a service rack. */
const CAB: Shape = {
  L: 2.2, W: 2.1, sill: 0.42, axles: [], r: 0.45, tw: 0.28,
  stations: [[0.0, 2.1, 1.2, 1.0, 0.9], [0.15, 2.15, 1.2, 1.02, 0.92], [0.9, 2.15, 1.2, 1.02, 0.92], [1.3, 1.8, 1.2, 1.0, 0.9], [1.45, 1.35, 1.15, 1.0, 0.9], [1.95, 1.28, 1.1, 0.98, 0.9], [2.2, 1.0, 0.8, 0.95, 0.86]],
  creases: [], side: [[0.2, 1.2]], screens: [[1.28, 1.45]], doors: [0.2, 1.25], mirror: 1.35, seats: [0.75],
};

export function vehicleGeometry(g: TownGround, sinks: VehicleSinks, v: Vehicle, detail: Detail, paintOver?: Rgb): void {
  // The low tier draws three vehicles in five (the rest are left out by their number).
  if (detail === "low" && (v.id % 5 === 0 || v.id % 5 === 3)) return;
  const m = sinks.solid(v.x, v.z);
  const gl = sinks.glass(v.x, v.z);
  const paint = paintOver ?? (PAINT[v.colour % PAINT.length] as Rgb);
  const derelict = v.state === "derelict";
  const project = v.state === "project";
  const camper = v.kind === "camper";
  const wk = v.kind === "work truck";
  const sag = derelict ? -0.05 : 0;
  const lift = project ? 0.3 : sag;
  const pl = placeOn(g, v.x, v.z, v.hx, v.hz, v.length, v.width, lift);
  // The dark of the ground under it (there is no shadow in the scene): an eight-cornered patch drawn on the ground, inside the body's footprint, seen in the gap under the sills.
  if (sinks.flat !== undefined) {
    const hl = v.length / 2 - 0.3;
    const hw = v.width / 2 - 0.22;
    const c: Array<[number, number]> = [[hl, hw * 0.6], [hl * 0.8, hw], [-hl * 0.8, hw], [-hl, hw * 0.6], [-hl, -hw * 0.6], [-hl * 0.8, -hw], [hl * 0.8, -hw], [hl, -hw * 0.6]];
    sinks.flat(v.x, v.z).poly(c.map(([a, b]): Vec3 => [pl.ox + pl.fx * a + pl.lx * b, groundAt(g, pl.ox + pl.fx * a + pl.lx * b, pl.oz + pl.fz * a + pl.lz * b) + 0.012, pl.oz + pl.fz * a + pl.lz * b]), [0, 1, 0], [0.012, 0.012, 0.012], undefined, { rank: RANK.stain });
  }
  // On the full tier a vehicle with a model is that model's (`vehicleFleet.ts`): what is left of it here is the dark of the ground under it.
  if (drawnAsModel(v, detail)) return;
  if (camper) {
    camperGeometry(m, gl, pl, v, detail);
    return;
  }
  const base = wk ? CAB : SHAPES[v.kind as "sedan" | "suv" | "van" | "pickup"];
  const sx = wk ? 1 : v.length / base.L;
  const sw = v.width / base.W;
  const xOff = wk ? v.length - CAB.L : 0;
  const sh: Shape = wk ? { ...CAB, axles: [CAB.L - 0.95], r: 0.45 } : base;
  const o: Opts = { sx, sw, xOff, len: v.length, paint, age: derelict ? Math.max(v.age, 0.85) : v.age, idle: v.idle, detail, flat: derelict, wheels: !project, seed: v.seed, sy: 1 };
  const { wAt, beltAt } = profileAt(sh, o);
  const T0 = m.vertices;
  loft(m, gl, pl, sh, o);
  const T1 = m.vertices;
  if (!project) wheelsOf(m, pl, sh, o, v, wAt);
  else blocks(m, pl, sh, o);
  if (wk) workTruck(m, pl, v, o, wAt);
  details(m, pl, sh, o, v, wAt, beltAt);
  if (detail !== "low") interior(m, pl, sh, o, wAt, beltAt);
  loads(m, pl, v, sh, o);
  void T0;
  void T1;
  if (project && v.load !== "none" ? true : project && rnd(v.seed, 21) < 0.55) tarpOver(m, pl, sh, o, v.seed);
  else if (derelict && v.load === "tarp") tarpOver(m, pl, sh, o, v.seed);
}

function workTruck(m: MeshBuilder, pl: Place, v: Vehicle, o: Opts, wAt: (x: number) => number): void {
  const rear = -v.length / 2;
  const cabX = v.length - CAB.L;
  const frame: Rgb = [0.03, 0.03, 0.035];
  const paint = o.paint;
  const r = 0.45;
  // The frame, the rear wheels and the bed.
  lbox(m, pl, rear + 0.1, rear + cabX, 0.55, 0.75, -0.55, 0.55, frame);
  for (const ax of [1.1, 2.55]) for (const sg of [1, -1]) wheel(m, pl, rear + ax, r, sg * 0.98, r, 0.3, sg, o.detail, o.flat, [0.18, 0.18, 0.18]);
  void wAt;
  if (v.load === "flatbed" || v.load === "none") {
    lbox(m, pl, rear + 0.0, rear + cabX - 0.1, 0.9, 1.0, -1.02, 1.02, [0.1, 0.09, 0.08], [0.18, 0.12, 0.07]);
    lbox(m, pl, rear + cabX - 0.12, rear + cabX - 0.05, 1.0, 1.9, -1.02, 1.02, paint);
    for (const sg of [1, -1]) lbox(m, pl, rear + 0.02, rear + cabX - 0.14, 1.0, 1.14, sg * 1.0, sg * 1.04, frame);
    lbox(m, pl, rear + 0.5, rear + 1.4, 1.0, 1.5, -0.5, 0.45, [0.12, 0.1, 0.07]);
    lbox(m, pl, rear + 2.0, rear + 3.0, 1.0, 1.25, 0.1, 0.9, [0.3, 0.3, 0.32]);
  } else {
    // A service body: lockers down the sides and a rack over.
    lbox(m, pl, rear + 0.0, rear + cabX - 0.1, 0.8, 1.55, -1.05, 1.05, paint);
    for (const z of [-0.95, 0.95]) lbox(m, pl, rear + 0.0, rear + cabX - 0.1, 1.55, 1.62, z - 0.03, z + 0.03, frame);
    lbox(m, pl, rear + 0.1, rear + cabX - 0.1, 1.62, 1.68, -0.2, 0.2, [0.45, 0.46, 0.48]);
    for (const x of [0.5, 1.6, 2.7]) lbox(m, pl, rear + x, rear + x + 0.04, 1.55, 1.71, -0.95, 0.95, frame);
  }
  lbox(m, pl, rear - 0.02, rear + 0.06, 0.55, 0.72, -1.0, 1.0, [0.06, 0.06, 0.06]);
  lquadX(m, pl, rear - 0.05, 0.62, 0.78, -0.2, 0.2, -1, PLATE);
  for (const sg of [1, -1]) lquadX(m, pl, rear - 0.026, 0.8, 0.94, sg * 0.5, sg * 0.9, -1, TAIL);
}

function camperGeometry(m: MeshBuilder, gl: MeshBuilder, pl: Place, v: Vehicle, detail: Detail): void {
  const paint = mixC(PAINT[v.colour % PAINT.length] as Rgb, [0.55, 0.55, 0.52], 0.55);
  const stations: Station[] = [[0.0, 2.3, 1.9, 1.0, 0.85], [0.15, 2.8, 2.0, 1.14, 1.0], [3.0, 2.9, 2.0, 1.16, 1.02], [5.5, 2.85, 2.0, 1.16, 1.0], [5.9, 2.6, 1.9, 1.12, 0.95], [6.2, 2.2, 1.7, 1.02, 0.82]];
  const sh: Shape = { L: 6.2, W: 2.3, sill: 0.5, axles: [3.0], r: 0.33, tw: 0.2, stations, creases: [], side: [], screens: [], doors: [], mirror: 0, seats: [] };
  const sx = (v.length - 0.4) / 6.2;
  const o: Opts = { sx, sw: v.width / 2.3, xOff: 0, len: v.length - 0.4, paint, age: v.state === "derelict" ? 0.95 : v.age, idle: v.idle, detail, flat: v.state === "derelict", wheels: true, seed: v.seed, sy: 1 };
  const pl2 = { ...pl, ox: pl.ox + pl.fx * 0.2, oz: pl.oz + pl.fz * 0.2 };
  loft(m, gl, pl2, sh, o);
  const { wAt } = profileAt(sh, o);
  wheelsOf(m, pl2, { ...sh, tw: 0.2 }, o, v, wAt);
  const rear = -(v.length - 0.4) / 2;
  const frame: Rgb = [0.05, 0.05, 0.05];
  // The A-frame tongue and a jack, windows and a door, a stripe.
  m.prism(P(pl, v.length / 2 - 0.3, 0.6, -0.3), P(pl, v.length / 2 + 1.3, 0.55, 0), 0.04, 4, frame);
  m.prism(P(pl, v.length / 2 - 0.3, 0.6, 0.3), P(pl, v.length / 2 + 1.3, 0.55, 0), 0.04, 4, frame);
  for (const sg of [1, -1]) {
    const w = 1.16 * o.sw + 0.004;
    lquadZ(m, pl, sg * w, rear + 1.1, rear + 2.1, 1.3, 1.85, sg as 1 | -1, GLASS_CAR);
    lquadZ(m, pl, sg * w, rear + 3.6, rear + 4.5, 1.3, 1.85, sg as 1 | -1, GLASS_CAR);
    if (sg > 0) lquadZ(m, pl, sg * w, rear + 2.5, rear + 3.3, 0.7, 2.2, 1, mixC(paint, [0.4, 0.4, 0.4], 0.5));
    // The stripe runs either side of the door on the side that has one, so it lies over no other panel.
    const stripe = mixC([0.1, 0.18, 0.3], paint, v.age * 0.4);
    const runs: [number, number][] = sg > 0 ? [[rear + 0.2, rear + 2.5], [rear + 3.3, rear + v.length - 0.9]] : [[rear + 0.2, rear + v.length - 0.9]];
    for (const [z0, z1] of runs) if (z1 - z0 > 0.05) lquadZ(m, pl, sg * (w + 0.001), z0, z1, 1.0, 1.12, sg as 1 | -1, stripe);
  }
}
