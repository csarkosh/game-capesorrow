/**
 * Every `Sign` of the plan, drawn where its `place` puts it, in the form of its kind and the manner of its style and decade. A sign is a
 * backing of solid geometry (a board, a box, a post, brackets) and a face: a quad in the sign layer mapped to a rectangle of the lettering
 * atlas (`signAtlas.ts`), which the renderer's side paints from the `SignSpec` this file gives with it (`signPaint.ts`). The words are the plan's
 * lines, set in a face, weight, case and colours rolled from the sign's own number (`signStyle.ts`); its condition fades, peels, rusts and
 * wears the letters away in the painter, and lights are the face's glow: a lit backlit box glows evenly, lit neon only in its tubes (its
 * ground is dark), a lit OPEN sign in the window.
 *
 * Forms by kind. fascia: a board over the windows across the bay; banner: vinyl hung on the fascia, sagging, a corner loose; blade: a double
 * face on a bracket; glass: lettering on a pane (gold leaf in arcs on an old front, cut vinyl on a new one); wall: paint on a side wall;
 * ghost: the same, large and mostly gone; pole: a post at the lot's edge with a sign on it (the gas station's with its price rows, the motel's
 * with its VACANCY); sandwich: an A-frame on the sidewalk; open: a small sign in the glass; lease: the notice taped up; board: a church's or a
 * civic building's, on posts at the lot's edge or a plaque on the wall.
 *
 * A lit sign follows its unit's opening hours (`leftOn`): the face's vertices carry the hours code (`MeshBuilder.withHours`) and the sign layer's material decodes it.
 *
 * Authored, not researched: every size, the glow strengths, the sag and the loose corner of a banner, the colours (`signStyle.ts`).
 */
import { withMat } from "./materials.js";
import { faceUnder, isClear, standOff } from "./faceLedger.js";
import { paintOff } from "./paint.js";
import { hash01, scaled, type MeshBuilder, type Rgb, type Vec3 } from "./meshBuilder.js";
import { coloursOf } from "./signStyle.js";
import { blockOfLot, signColours } from "./accents.js";
import { insideOther } from "./openingsGeometry.js";
import { hoursCode, unitHours, wrapHour, type Hours } from "./hours.js";
import { xp, type Xf } from "./roomGeometry.js";
import { glassOffOf, isMasonry } from "./windowGeometry.js";
import type { Building, BuildingUse, Sign, Unit } from "../../sim/town/types.js";
import type { Detail, SignAtlasLike, SignSpec, TownGround } from "./townTypes.js";

export type SignIn = {
  readonly solid: MeshBuilder;
  readonly face: MeshBuilder;
  readonly g: TownGround;
  readonly b: Building;
  readonly use: BuildingUse;
  readonly xf: Xf;
  readonly atlas: SignAtlasLike;
  readonly floorY: number;
  readonly wallTop: number;
  readonly detail: Detail;
  /** The renderer draws a shop's panes opaque with their own depth (`townBlur.ts`): what hangs in the glass is not behind the pane's plane, where it would not be seen. */
  readonly through?: boolean;
};

/** Where a shop window's glass stood before the deeper reveals of a masonry wall (7 cm in): the offsets below that hang in the window are set from it. */
const GLASS_OF_OLD = -0.07;

/** How much further in than before a building's windows have their glass (0 on the low tier and in a thin wall, where it stands where it always did): what hangs in the window moves with it, so none is left in front of the glass or across it. */
const glassShift = (i: SignIn): number => glassOffOf(i.detail === "full", isMasonry(i.b.material)) - GLASS_OF_OLD;

/** Where a sign stands: a point on the wall or the ground, the outward normal and the viewer's right. */
type Pl = { x: number; z: number; nx: number; nz: number; rx: number; rz: number; free: boolean };

function placeOf(xf: Xf, s: Sign["place"]): Pl {
  const t = { x: xf.tx, z: xf.tz };
  const n = { x: xf.nx, z: xf.nz };
  const mk = (p: Vec3, nx: number, nz: number, free = false): Pl => ({ x: p[0], z: p[2], nx, nz, rx: -nz, rz: nx, free });
  switch (s.wall) {
    case "front": return mk(xp(xf, s.s, 0, 0), n.x, n.z);
    case "left": return mk(xp(xf, 0, s.s, 0), -t.x, -t.z);
    case "right": return mk(xp(xf, xf.width, s.s, 0), t.x, t.z);
    case "back": return mk(xp(xf, s.s, xf.depth, 0), -n.x, -n.z);
    default: return mk(xp(xf, s.s, -s.out, 0), n.x, n.z, true);
  }
}

const longest = (lines: readonly string[]): number => lines.reduce((m, l) => Math.max(m, l.length), 1);
/** Width of a block of lines set `lineH` metres tall: about 0.6 of the line's height a letter, and a margin. */
const textWidth = (lines: readonly string[], lineH: number): number => longest(lines) * lineH * 0.62 + 0.4;

/** The faces drawn so far in a building's signs, to keep each a step from the next (`quad` in `drawSign`). */
const FACES = new WeakMap<SignIn, { sg: number; nx: number; nz: number; off: number; x: number; z: number; w: number; y0: number; h: number }[]>();


/** The offset a face is laid at: asked for, or a step (3 cm) in front of any face already laid over its place (`FACES`). */
function stepOff(i: SignIn, pl: Pl, cx: number, y0: number, ww: number, hh: number, sg: number, offAsked: number, behind?: { readonly ww: number; readonly hh: number; readonly y0: number; readonly d: number }): number {
  const reg = FACES.get(i) ?? [];
  FACES.set(i, reg);
  const wx = pl.x + pl.rx * cx;
  const wz = pl.z + pl.rz * cx;
  const clashes = (off: number, w: number, y: number, h: number): boolean =>
    reg.some((f) => f.sg === sg && f.nx === pl.nx && f.nz === pl.nz && Math.abs(f.off - off) < 0.03 && Math.abs((f.x - wx) * pl.rx + (f.z - wz) * pl.rz) < (f.w + w) / 2 && f.y0 < y + h && y < f.y0 + f.h);
  let off = offAsked;
  // A board's own front, `d` behind the face on it, is a face too: no other face within 3 cm of it.
  for (let tries = 0; tries < 8; tries++) {
    const clash = reg.find((f) => f.sg === sg && f.nx === pl.nx && f.nz === pl.nz && Math.abs(f.off - off) < 0.03 && Math.abs((f.x - wx) * pl.rx + (f.z - wz) * pl.rz) < (f.w + ww) / 2 && f.y0 < y0 + hh && y0 < f.y0 + f.h);
    if (clash !== undefined) {
      off = clash.off + 0.03;
      continue;
    }
    if (behind !== undefined && clashes(off - behind.d, behind.ww, behind.y0, behind.hh)) {
      off += 0.03;
      continue;
    }
    break;
  }
  reg.push({ sg, nx: pl.nx, nz: pl.nz, off, x: wx, z: wz, w: ww, y0, h: hh });
  if (behind !== undefined) reg.push({ sg, nx: pl.nx, nz: pl.nz, off: off - behind.d, x: wx, z: wz, w: behind.ww, y0: behind.y0, h: behind.hh });
  return off;
}

/** The paint signs laid so far on a building's walls (`paintSign`), so that a sign painted over another lies one rank of paint above it. */
const PAINTED = new WeakMap<SignIn, { nx: number; nz: number; x: number; z: number; w: number; y0: number; h: number; rank: number }[]>();

/** The rank of paint of a sign painted on a wall (a ghost sign's old lettering too): over the wall's tone (rank 1), a sill's streak (2) and a patch of siding (3). Its lettering is in the one face with it (the atlas). */
const SIGN_RANK = 4;

export function signsGeometry(i: SignIn): void {
  const { use } = i;
  // Every sign of the plan is drawn; faces that fall on one another are each a step in front of the last (`quad` in `drawSign`).
  use.units.forEach((u) => u.signs.forEach((s, k) => drawSign(i, s, u, k)));
  use.signs.forEach((s, k) => drawSign(i, s, null, k + 40));
  windowLife(i);
}

function drawSign(i: SignIn, sign: Sign, unit: Unit | null, k: number): void {
  const { solid, b, xf, atlas, g } = i;
  const pl = placeOf(xf, sign.place);
  const seed = (b.id * 131 + (unit?.id ?? 9) * 17 + k * 7 + sign.place.s * 3) | 0;
  const hall = b.kind === "municipal building" && unit === null;
  // The municipal building's boards are read from across the street: a dark ground with cream letters, or a cream one with dark, whichever the board's own number gives.
  const hallColours = (): { bg: [number, number, number]; fg: [number, number, number]; accent: [number, number, number] } =>
    hash01(seed, 640) < 0.7 ? { bg: [24, 40, 32], fg: [240, 232, 200], accent: [200, 170, 90] } : { bg: [236, 228, 200], fg: [26, 30, 40], accent: [140, 40, 30] };
  const col = hall ? hallColours() : signColours(coloursOf(sign.style, sign.kind, seed), sign.kind, blockOfLot(g.plan.lots, b.lot, b.id), seed);
  const lines = sign.lines.length > 0 ? sign.lines : [""];
  const nLines = lines.length;
  const bay = unit === null ? xf.width : unit.s1 - unit.s0;
  const ground = pl.free ? g.heightAt(pl.x, pl.z) : i.floorY;
  // A board of the building's own that would hang over a unit's sign on the same wall hangs a sign's height above it.
  const over = unit === null ? i.use.units.flatMap((u) => u.signs).find((q) => q.place.wall === sign.place.wall && (q.kind === "fascia" || q.kind === "board" || q.kind === "banner") && Math.abs(q.place.s - sign.place.s) < 2.5 && Math.abs(q.place.h - sign.place.h) < 0.9) : undefined;
  const lift = over === undefined ? 0 : over.place.h + 0.95 - sign.place.h;
  const y = (pl.free ? ground : i.floorY) + sign.place.h + lift;
  const old = sign.style === "hand-painted";
  const neon = sign.style === "neon and porcelain";
  const box = sign.style === "backlit box";
  const base = (off: number): Vec3 => [pl.x + pl.nx * off, 0, pl.z + pl.nz * off];
  void base;

  // The size of the face, by kind.
  let w = 1;
  let h = 0.5;
  let clear = false;
  switch (sign.kind) {
    case "fascia": h = nLines > 1 ? 0.85 : 0.6; w = Math.min(bay - 0.2, Math.max(textWidth(lines, h / nLines * 0.75), bay * 0.72)); break;
    case "banner": h = 0.8; w = Math.min(bay - 0.3, 3.4); break;
    case "blade": w = 0.6; h = 0.5; break;
    case "glass": h = Math.min(0.9, nLines * 0.24 + 0.16); w = Math.min(1.9, textWidth(lines, h / nLines * 0.7)); clear = true; break;
    case "wall": w = 3 + hash01(seed, 620) * 2.5; h = 1.2 + hash01(seed, 621) * 0.8; clear = true; break;
    case "ghost": w = 3.4 + hash01(seed, 622) * 2.4; h = 1.6 + hash01(seed, 623) * 1; clear = true; break;
    case "pole": {
      const gas = lines.length >= 4 && (lines[1] ?? "").startsWith("REGULAR");
      w = gas ? 2 : 1.7;
      h = gas ? 2.5 : 0.5 + nLines * 0.4;
      break;
    }
    case "sandwich": w = 0.62; h = 0.92; break;
    case "open": w = 0.5; h = 0.26; break;
    case "lease": w = 0.4; h = 0.55; break;
    default: {
      if (hall) {
        // The name over the portico has letters of 0.4 m; the boards beside the door of 0.26 m (read from 15 m and more).
        const letter = longest(lines) > 12 ? 0.4 : 0.26;
        h = letter * nLines + 0.3;
        w = Math.min(bay - 1, textWidth(lines, letter));
      } else {
        h = 0.5 + nLines * 0.2;
        w = Math.min(2.4, textWidth(lines, 0.2) + 0.2);
      }
      break;
    }
  }
  // Lettering on the glass stays inside the opening it is on (it is on the pane, not on the wall beside it); on an opening that is boarded or bricked up it is on the boards or the brick.
  let glassOff = -0.015 + glassShift(i);
  if (unit !== null && (sign.kind === "glass" || sign.kind === "open" || sign.kind === "lease")) {
    const o = unit.openings.find((q) => sign.place.s >= Math.min(q.s0, q.s1) - 0.05 && sign.place.s <= Math.max(q.s0, q.s1) + 0.05);
    if (o !== undefined) {
      w = Math.min(w, Math.max(0.3, Math.abs(o.s1 - o.s0) - 0.14));
      if (o.cover === "boarded") glassOff = 0.09;
      else if (o.cover === "bricked") glassOff = 0.03;
    }
  }
  const spec: SignSpec = { kind: sign.kind, style: sign.style, lines, decade: sign.decade, condition: sign.condition, lit: sign.lit, seed, bg: col.bg, fg: col.fg, accent: col.accent, clear, w, h };
  const at = atlas.place(w, h, spec);
  // A lit sign follows its unit's hours (`hours.ts`): an OPEN sign only while the unit is open; any other lit sign while it is open and, for half the shops (signs are left on), a while after it
  // shuts, if that is in the evening; never in the dead of night, except for a trade that never shuts. A unit that is shut for the day or vacant has no hours, and its sign is dark.
  const hours = unit === null ? null : unitHours(b, unit);
  const signHours = hours === null || sign.kind === "open" ? hours : leftOn(hours, seed);
  const dark = unit !== null && signHours === null;
  const glow = !sign.lit || dark ? 0 : neon || sign.kind === "open" ? 2.1 : box ? 1.05 : 0;
  const code = unit === null || glow === 0 ? 0 : hoursCode(signHours);
  const ink: Rgb = old ? [0.08, 0.07, 0.06] : [0.17, 0.17, 0.18];

  /** The face as a quad at `off` off the wall, centred `cx` along the viewer's right, its bottom `y0` up, facing out (or the other way when `back`). */
  const quad = (cx: number, y0: number, ww: number, hh: number, offAsked: number, back = false, behind?: Parameters<typeof stepOff>[8]): number => {
    if (at === null) return offAsked;
    const sg = back ? -1 : 1;
    // A face laid where another already is (a new board over an old, two records of one place) stands a step in front of it: never within 3 cm of another.
    let off = stepOff(i, pl, cx, y0, ww, hh, sg, offAsked, behind);
    // And a step further out than any face of the wall's own that lies within 2.45 cm of it (`faceLedger.ts`).
    const ea = pl.x + pl.rx * (cx - ww / 2) + pl.nx * off;
    const eb = pl.x + pl.rx * (cx + ww / 2) + pl.nx * off;
    off += sg * standOff(pl.nx * sg, pl.nz * sg, ea, pl.z + pl.rz * (cx - ww / 2) + pl.nz * off, eb, pl.z + pl.rz * (cx + ww / 2) + pl.nz * off, y0, y0 + hh);
    const c = (dr: number, yy: number): Vec3 => [pl.x + pl.rx * (cx + sg * dr) + pl.nx * off, yy, pl.z + pl.rz * (cx + sg * dr) + pl.nz * off];
    i.face.polyUv([c(-ww / 2, y0 + hh), c(ww / 2, y0 + hh), c(ww / 2, y0), c(-ww / 2, y0)], [[at.u0, at.v0], [at.u1, at.v0], [at.u1, at.v1], [at.u0, at.v1]], [pl.nx * sg, 0, pl.nz * sg], [1, 1, 1], { glow });
    return off;
  };
  /**
   * A sign painted on a wall, or on what is on the wall: flush, a rank of paint (`SIGN_RANK`) 2 mm over the face it is on, and no face of the ledger. Where a
   * board stands on the wall under it (the plywood over a window), it is painted on the board, 2 mm over the board's own face and not the wall's; where another
   * sign is painted under it, a rank over that. The lettering is the face's own atlas, so it has no face of its own to put a rank above.
   */
  const paintSign = (cx: number, y0: number, ww: number, hh: number): void => {
    if (at === null) return;
    const xa = pl.x + pl.rx * (cx - ww / 2);
    const za = pl.z + pl.rz * (cx - ww / 2);
    const xb = pl.x + pl.rx * (cx + ww / 2);
    const zb = pl.z + pl.rz * (cx + ww / 2);
    const on = faceUnder(pl.nx, pl.nz, xa, za, xb, zb, y0, y0 + hh);
    const reg = PAINTED.get(i) ?? [];
    PAINTED.set(i, reg);
    let rank = SIGN_RANK;
    for (const f of reg) {
      if (f.nx === pl.nx && f.nz === pl.nz && Math.abs((f.x - pl.x - pl.rx * cx) * pl.rx + (f.z - pl.z - pl.rz * cx) * pl.rz) < (f.w + ww) / 2 && f.y0 < y0 + hh && y0 < f.y0 + f.h) rank = Math.max(rank, f.rank + 1);
    }
    reg.push({ nx: pl.nx, nz: pl.nz, x: pl.x + pl.rx * cx, z: pl.z + pl.rz * cx, w: ww, y0, h: hh, rank });
    const off = on + paintOff(rank);
    const c = (dr: number, yy: number): Vec3 => [pl.x + pl.rx * (cx + dr) + pl.nx * off, yy, pl.z + pl.rz * (cx + dr) + pl.nz * off];
    i.face.polyUv([c(-ww / 2, y0 + hh), c(ww / 2, y0 + hh), c(ww / 2, y0), c(-ww / 2, y0)], [[at.u0, at.v0], [at.u1, at.v0], [at.u1, at.v1], [at.u0, at.v1]], [pl.nx, 0, pl.nz], [1, 1, 1], { glow, paint: rank });
  };
  /** A box on the wall: `off0` to `off1` off it, centred `cx`, `ww` wide, from `y0` up `hh`. */
  const obox = (cx0: number, y0: number, ww0: number, hh: number, off0: number, off1: number, side: Rgb, top: Rgb = side, topFace = true, under = true): void => {
    // A board does not end at, or in, the wall of the building beside it (its end would lie within millimetres of that wall's face): it is cut back from the end that does, a hand at a time.
    const beyond = (t: number): boolean => insideOther(i.g.plan, i.b.id, pl.x + pl.rx * t + pl.nx * ((off0 + off1) / 2) - i.g.anchor.x, pl.z + pl.rz * t + pl.nz * ((off0 + off1) / 2) - i.g.anchor.z);
    let lo = cx0 - ww0 / 2;
    let hi = cx0 + ww0 / 2;
    for (let tries = 0; tries < 4 && beyond(lo - 0.04); tries++) lo += 0.06;
    for (let tries = 0; tries < 4 && beyond(hi + 0.04); tries++) hi -= 0.06;
    // Nor with an end within 2.45 cm of the end of a box already laid on the wall (a door's casing): cut back a step at a time (`faceLedger.ts`).
    const endAt = (t: number, sg: 1 | -1): boolean => isClear(pl.rx * sg, pl.rz * sg, pl.x + pl.rx * t + pl.nx * off0, pl.z + pl.rz * t + pl.nz * off0, pl.x + pl.rx * t + pl.nx * off1, pl.z + pl.rz * t + pl.nz * off1, y0, y0 + hh);
    for (let tries = 0; tries < 6 && !endAt(lo, -1); tries++) lo += 0.03;
    for (let tries = 0; tries < 6 && !endAt(hi, 1); tries++) hi -= 0.03;
    const cx = (lo + hi) / 2;
    const ww = hi - lo;
    const mx = pl.x + pl.rx * cx + pl.nx * ((off0 + off1) / 2);
    const mz = pl.z + pl.rz * cx + pl.nz * ((off0 + off1) / 2);
    withMat("painted", () => solid.box(mx, mz, y0, pl.rx, pl.rz, ww / 2, (off1 - off0) / 2, hh, side, top, topFace, under ? undefined : null));
  };
  const halfBay = (cx: number): number => Math.max(-bay / 2 + w / 2, Math.min(bay / 2 - w / 2, cx));
  void halfBay;

  i.face.withHours(code, () => {
  switch (sign.kind) {
    case "fascia": {
      // The board spans the sign's width; its colour is dark and its edge a trim.
      const top = Math.min(y + h / 2, i.wallTop - 0.15);
      const y0 = top - h;
      // The board's front stands 3 cm behind the face on it, and clear of any other face on the wall.
      // The board's front is where no face of the wall's is within 2.45 cm of it (`faceLedger.ts`).
      const bw = (w + 0.1) / 2;
      const front = 0.18 + standOff(pl.nx, pl.nz, pl.x - pl.rx * bw + pl.nx * 0.18, pl.z - pl.rz * bw + pl.nz * 0.18, pl.x + pl.rx * bw + pl.nx * 0.18, pl.z + pl.rz * bw + pl.nz * 0.18, y0 - 0.03, y0 + h + 0.07);
      const off = quad(0, y0, w, h, front + 0.03, false, { ww: w + 0.1, hh: h + 0.1, y0: y0 - 0.03, d: 0.03 });
      // The board's top is left open: it would lie within a few centimetres of a portico's or a pilaster's top on the same wall, and no one sees it.
      obox(0, y0 - 0.03, w + 0.1, h + 0.1, 0, off - 0.03, ink, scaled(ink, 1.6), false, false);
      break;
    }
    case "banner": {
      // Vinyl hung from grommets, sagging between them, one lower corner come loose. Six columns, each its own bottom.
      if (at === null) break;
      const n = 6;
      const loose = hash01(seed, 624) < 0.5 ? 1 : -1;
      // Hung clear of any other face on the wall (a second banner, a board): its columns lean out a centimetre each from there.
      const hang = stepOff(i, pl, 0, y - h / 2, w, h, 1, 0.3);
      for (let c = 0; c < n; c++) {
        const a = -w / 2 + (w * c) / n;
        const e = -w / 2 + (w * (c + 1)) / n;
        const sag = (m: number): number => 0.1 * Math.sin(((m / n) * n * Math.PI) % Math.PI) * 0.6 + (loose > 0 ? (m / n) * (m / n) * 0.35 : ((n - m) / n) * ((n - m) / n) * 0.35);
        const yt = y + h / 2;
        const ya = yt - h + (sag(c) > 0 ? -sag(c) * 0.3 : 0);
        const ye = yt - h + (sag(c + 1) > 0 ? -sag(c + 1) * 0.3 : 0);
        const pt = (dr: number, yy: number, off: number): Vec3 => [pl.x + pl.rx * dr + pl.nx * off, yy, pl.z + pl.rz * dr + pl.nz * off];
        const u = (m: number): number => at.u0 + ((at.u1 - at.u0) * m) / n;
        const vb = (yy: number): number => at.v0 + ((at.v1 - at.v0) * (yt - yy)) / h;
        i.face.polyUv([pt(a, yt, hang + 0.01 * c), pt(e, yt, hang + 0.01 * (c + 1)), pt(e, ye, hang + 0.01 + 0.01 * (c + 1)), pt(a, ya, hang + 0.01 + 0.01 * c)], [[u(c), at.v0], [u(c + 1), at.v0], [u(c + 1), vb(ye)], [u(c), vb(ya)]], [pl.nx, 0, pl.nz], [1, 1, 1], { glow: 0 });
      }
      break;
    }
    case "blade": {
      // A bracket from the wall and a board hanging from it by two short chains, facing along the wall both ways.
      const out = Math.max(0.6, sign.place.out);
      const yt = y + h / 2;
      withMat("steel", () => solid.prism([pl.x + pl.nx * 0.02, yt + 0.05, pl.z + pl.nz * 0.02], [pl.x + pl.nx * (out + 0.05), yt + 0.05, pl.z + pl.nz * (out + 0.05)], 0.02, 4, [0.08, 0.08, 0.08]));
      const bx = pl.x + pl.nx * (out - 0.2);
      const bz = pl.z + pl.nz * (out - 0.2);
      const ww = w;
      // The board stands across the bracket (its faces along the wall): its own frame is the wall's normal as its "right".
      const pb: Pl = { x: bx, z: bz, nx: pl.rx, nz: pl.rz, rx: -pl.rz, rz: pl.rx, free: true };
      if (at !== null) {
        for (const back of [false, true]) {
          const sg = back ? -1 : 1;
          const c = (dr: number, yy: number): Vec3 => [pb.x + pb.rx * sg * dr + pb.nx * sg * 0.05, yy, pb.z + pb.rz * sg * dr + pb.nz * sg * 0.05];
          i.face.polyUv([c(-ww / 2, yt - 0.05), c(ww / 2, yt - 0.05), c(ww / 2, yt - 0.05 - h), c(-ww / 2, yt - 0.05 - h)], [[at.u0, at.v0], [at.u1, at.v0], [at.u1, at.v1], [at.u0, at.v1]], [pb.nx * sg, 0, pb.nz * sg], [1, 1, 1], { glow });
        }
      }
      withMat("painted", () => solid.box(bx, bz, yt - 0.05 - h, pl.rx, pl.rz, 0.02, ww / 2 + 0.02, h, ink, ink));
      break;
    }
    case "glass": {
      // On the pane: just behind the window's face, the lettering alone.
      quad(0, y - h / 2, w, h, glassOff);
      break;
    }
    case "wall":
    case "ghost": {
      // Paint: flush on the wall, or on the plywood of a boarded window that it is painted over (`paintSign`).
      paintSign(0, y - h / 2, w, h);
      break;
    }
    case "pole": {
      // A post at the lot's edge to `place.h`, the sign on top of it, a face each way.
      const gas = lines.length >= 4 && (lines[1] ?? "").startsWith("REGULAR");
      const top = ground + sign.place.h;
      const px = pl.x;
      const pz = pl.z;
      withMat("steel", () => solid.box(px, pz, ground - 0.1, pl.rx, pl.rz, 0.08, 0.08, top - ground, [0.28, 0.28, 0.3], [0.28, 0.28, 0.3]));
      const y0 = top - (gas ? 0.2 : 0.1);
      withMat("painted", () => solid.box(px, pz, y0 - h + 0.2, pl.rx, pl.rz, w / 2, 0.12, h, ink, scaled(ink, 1.5)));
      quad(0, y0 - h + 0.2, w - 0.1, h - 0.1, 0.15);
      quad(0, y0 - h + 0.2, w - 0.1, h - 0.1, -0.15, true);
      break;
    }
    case "sandwich": {
      // Two panels leaning against each other, each with the face.
      const lean = 0.28;
      const by = g.heightAt(pl.x, pl.z);
      if (at !== null) {
        for (const back of [false, true]) {
          const sg = back ? -1 : 1;
          const c = (dr: number, yy: number, off: number): Vec3 => [pl.x + pl.rx * dr + pl.nx * sg * off, yy, pl.z + pl.rz * dr + pl.nz * sg * off];
          i.face.polyUv([c(-w / 2 * sg, by + h, 0.03), c(w / 2 * sg, by + h, 0.03), c(w / 2 * sg, by, lean), c(-w / 2 * sg, by, lean)], [[at.u0, at.v0], [at.u1, at.v0], [at.u1, at.v1], [at.u0, at.v1]], [pl.nx * sg, 0.3, pl.nz * sg], [1, 1, 1], { glow: 0 });
        }
      }
      const frame: Rgb = [0.35, 0.25, 0.15];
      withMat("boards", () => {
        for (const sg of [-1, 1]) solid.prism([pl.x + pl.rx * sg * (w / 2 + 0.02), by + h, pl.z + pl.rz * sg * (w / 2 + 0.02)], [pl.x + pl.rx * sg * (w / 2 + 0.02) + pl.nx * lean, by, pl.z + pl.rz * sg * (w / 2 + 0.02) + pl.nz * lean], 0.015, 4, frame, null);
        for (const sg of [-1, 1]) solid.prism([pl.x + pl.rx * sg * (w / 2 + 0.02), by + h, pl.z + pl.rz * sg * (w / 2 + 0.02)], [pl.x + pl.rx * sg * (w / 2 + 0.02) - pl.nx * lean, by, pl.z + pl.rz * sg * (w / 2 + 0.02) - pl.nz * lean], 0.015, 4, frame, null);
      });
      break;
    }
    case "open": {
      // Hung in the glass on two cords: a small box with its tubes. Where the pane is drawn opaque with its own depth, what is behind its plane is not seen but through it,
      // out of focus: the box hangs 2 cm behind the pane, and the lit lettering is laid on the pane's face, 1.2 cm in front of it.
      if (i.through === true) {
        obox(0, y - h / 2, w, h, -0.13 + glassShift(i), -0.09 + glassShift(i), [0.05, 0.05, 0.06]);
        quad(0, y - h / 2, w, h, -0.058 + glassShift(i));
        break;
      }
      obox(0, y - h / 2, w, h, -0.18 + glassShift(i), -0.14 + glassShift(i), [0.05, 0.05, 0.06]);
      quad(0, y - h / 2, w, h, -0.11 + glassShift(i));
      break;
    }
    case "lease": {
      // In the glass, or, on a boarded unit, taped to the plywood.
      quad(0, y - h / 2, w, h, unit?.state === "vacant boarded" ? Math.max(glassOff, 0.09) : glassOff);
      break;
    }
    default: {
      // A board: on two posts at the lot's edge, or a plaque on the wall.
      if (pl.free) {
        const top = ground + sign.place.h + h / 2;
        for (const sg of [-1, 1]) withMat("wood", () => solid.box(pl.x + pl.rx * sg * (w / 2 - 0.05), pl.z + pl.rz * sg * (w / 2 - 0.05), ground - 0.1, pl.rx, pl.rz, 0.12, 0.12, top - ground + 0.04, [0.3, 0.2, 0.12], [0.3, 0.2, 0.12]));
        obox(0, top - h, w, h, -0.05, 0.05, ink, scaled(ink, 1.5));
        quad(0, top - h + 0.04, w - 0.08, h - 0.08, 0.08);
        quad(0, top - h + 0.04, w - 0.08, h - 0.08, -0.08, true);
      } else {
        const y0 = y - h / 2;
        // The board's front stands where no face of the wall's is within 2.45 cm of it, and so does the lettering 3 cm in front of that (a deep sill or lintel on the wall is a face at a plane the lettering could land on, and would push the board's own front onto it).
        const bw = (w + 0.12) / 2;
        const spot = (at: number): boolean => isClear(pl.nx, pl.nz, pl.x - pl.rx * bw + pl.nx * at, pl.z - pl.rz * bw + pl.nz * at, pl.x + pl.rx * bw + pl.nx * at, pl.z + pl.rz * bw + pl.nz * at, y0 - 0.04, y0 + h + 0.04);
        let front = 0.13;
        for (let tries = 0; tries < 8 && !(spot(front) && spot(front + 0.03)); tries++) front += 0.03;
        // (Noted as laid, as the board's front.)
        front += standOff(pl.nx, pl.nz, pl.x - pl.rx * bw + pl.nx * front, pl.z - pl.rz * bw + pl.nz * front, pl.x + pl.rx * bw + pl.nx * front, pl.z + pl.rz * bw + pl.nz * front, y0 - 0.04, y0 + h + 0.04);
        const off = quad(0, y0, w, h, front + 0.03, false, { ww: w + 0.12, hh: h + 0.08, y0: y0 - 0.04, d: 0.03 });
        obox(0, y0 - 0.04, w + 0.12, h + 0.08, 0, off - 0.03, ink, scaled(ink, 1.4));
      }
      break;
    }
  }
  });
}

/**
 * The hours a lit sign (not an OPEN sign) is on, from its unit's: for about half the shops (signs are left on) it stays lit for one to three hours after the unit shuts when that is
 * in the evening (a shut between 15:00 and 22:00), and never into the small hours; the rest are lit while the unit is open. A trade that never shuts has a sign that is always on.
 */
export function leftOn(hours: Hours, seed: number): Hours {
  if (hours === "always" || hash01(seed, 730) >= 0.5) return hours;
  const shut = hours.close < hours.open ? hours.close + 24 : hours.close;
  if (shut < 15 || shut > 22) return hours;
  return { open: hours.open, close: wrapHour(shut + 1 + Math.floor(hash01(seed, 731) * 3)) };
}

const PAPER_COLOURS: readonly [number, number, number][] = [[246, 240, 170], [250, 250, 245], [172, 214, 234], [244, 176, 170], [202, 230, 182], [240, 214, 160]];
const NOTICES: readonly (readonly string[])[] = [
  ["LOST CAT", "Gray tabby, Biscuit", "555-0161"], ["YARD SALE", "Saturday 8 to 2", "Fourth Street"], ["CHOWDER FEED", "Fire hall, Sat 5 pm", "$10 a bowl"],
  ["HELP WANTED", "Apply within"], ["BOAT FOR SALE", "16 ft skiff", "555-0172"], ["BAKE SALE", "Sunday after church"],
  ["LOST DOG", "Brown lab, collar", "555-0188"], ["PORT COMMISSION", "Thursday 7 pm", "Open to all"], ["FREE KITTENS", "Ask inside"],
  ["TIDE TABLES", "Free, this month"], ["SEWING LESSONS", "Wednesdays", "555-0134"], ["FOUND KEYS", "Ask at the counter"],
];
const STICKERS: readonly (readonly string[])[] = [["ATM"], ["PUSH"], ["PULL"], ["WELCOME"], ["NO SMOKING"], ["EXIT"], ["COLD DRINKS"], ["OPEN"]];
const HOURS: readonly (readonly string[])[] = [["Mon-Fri 9-5", "Closed weekends"], ["Mon-Sat 10-6", "Closed Sunday"], ["Daily 7-3"], ["Tue-Sat 11-7", "Closed Sun, Mon"], ["Mon-Fri 8-4:30", "Sat 9-noon"], ["Daily 6 am-9 pm"]];

/**
 * What a small-town shop window carries beyond its plan's signs (`unit.signs`): the hours on the door (a plate with the day's word on it:
 * OPEN, or CLOSED and when it is back), flyers and the community's notices taped up at irregular places and slightly crooked, a faded
 * poster, stickers by the door; on a boarded front the notices are taped to the plywood. Each is a small face in the sign layer, its
 * lettering painted at 2.5 times the atlas's density (a plate 30 cm wide is the size of a page: it must be readable at the glass).
 * Invented words, no names of businesses; which unit gets how many is rolled from the unit's own number and what its record says (a
 * vacant unit's glass has more paper, a shut one's the hours).
 */
function windowLife(i: SignIn): void {
  const { use, b, xf, face, atlas } = i;
  if (i.detail !== "full" || (globalThis as { NOLIFE?: boolean }).NOLIFE === true) return;
  const front = placeOf(xf, { wall: "front", s: 0, h: 0, out: 0, door: "none" });
  const paint = (cx: number, y0: number, ww: number, hh: number, off: number, lines: readonly string[], seed: number, bg: readonly [number, number, number], fg: readonly [number, number, number], cond: number, tilt: number, k = 2): void => {
    const spec: SignSpec = { kind: "board", style: "vinyl", lines, decade: 2020, condition: cond, lit: false, seed, bg, fg, accent: fg, clear: false, w: ww * k, h: hh * k };
    const at = atlas.place(ww * k, hh * k, spec);
    if (at === null) return;
    const so = stepOff(i, front, cx, y0, ww, hh, 1, off);
    const o = so + standOff(front.nx, front.nz, front.x + front.rx * (cx - ww / 2) + front.nx * so, front.z + front.rz * (cx - ww / 2) + front.nz * so, front.x + front.rx * (cx + ww / 2) + front.nx * so, front.z + front.rz * (cx + ww / 2) + front.nz * so, y0, y0 + hh);
    const mx = cx;
    const my = y0 + hh / 2;
    const rot = (dr: number, dy: number): Vec3 => {
      const c = Math.cos(tilt);
      const sn = Math.sin(tilt);
      return [front.x + front.rx * (mx + dr * c - dy * sn) + front.nx * o, my + dr * sn + dy * c, front.z + front.rz * (mx + dr * c - dy * sn) + front.nz * o];
    };
    face.polyUv([rot(-ww / 2, hh / 2), rot(ww / 2, hh / 2), rot(ww / 2, -hh / 2), rot(-ww / 2, -hh / 2)], [[at.u0, at.v0], [at.u1, at.v0], [at.u1, at.v1], [at.u0, at.v1]], [front.nx, 0, front.nz], [1, 1, 1], { glow: 0.12 });
  };
  for (const u of use.units) {
    const seed = b.id * 977 + u.id * 53;
    const r = (k: number): number => hash01(seed, 900 + k);
    const boarded = u.state === "vacant boarded";
    const vacant = u.state.startsWith("vacant");
    const openings = u.openings.filter((o) => o.cover !== "bricked");
    // The notices: more on glass that has been empty (boards and paper hold them), fewer where the plan has put its own lettering.
    const n = Math.floor(r(0) * (vacant ? 3.2 : 2.6)) + (boarded ? 1 : 0) + (u.past.length >= 3 ? 1 : 0);
    for (let k = 0; k < n && openings.length > 0; k++) {
      const o = openings[Math.floor(r(1 + k * 5) * openings.length) % openings.length] as Unit["openings"][number];
      const lo = Math.min(o.s0, o.s1);
      const hi = Math.max(o.s0, o.s1);
      const ww = 0.26;
      const hh = 0.34;
      if (hi - lo < ww + 0.3) continue;
      // Near an edge of the glass, as they are taped; the height anywhere up the pane.
      const left = r(3 + k * 5) < 0.5;
      const cx = left ? lo + 0.12 + ww / 2 + r(4 + k * 5) * 0.25 : hi - 0.12 - ww / 2 - r(4 + k * 5) * 0.25;
      const y0 = i.floorY + o.sill + 0.12 + r(5 + k * 5) * Math.max(0.05, o.head - o.sill - hh - 0.35);
      const lines = NOTICES[Math.floor(r(6 + k * 5) * NOTICES.length) % NOTICES.length] as readonly string[];
      const faded = vacant ? 0.3 + r(7 + k) * 0.3 : 0.55 + r(7 + k) * 0.4;
      paint(cx, y0, ww, hh, boarded || o.cover === "boarded" ? 0.09 : -0.015 + glassShift(i), lines, seed + k * 31, PAPER_COLOURS[Math.floor(r(8 + k * 5) * PAPER_COLOURS.length) % PAPER_COLOURS.length] as [number, number, number], [30, 30, 36], faded, (r(9 + k * 5) - 0.5) * 0.12);
    }
    if (boarded || openings.length === 0) continue;
    // A sticker or two by the door, at the height of a hand.
    const stickers = r(20) < 0.55 ? 1 + Math.floor(r(21) * 2) : 0;
    for (let k = 0; k < stickers; k++) {
      const lines = STICKERS[Math.floor(r(22 + k) * STICKERS.length) % STICKERS.length] as readonly string[];
      const side = r(24 + k) < 0.5 ? -1 : 1;
      const cx = u.door.s + side * (u.door.width / 2 + 0.16);
      paint(cx, i.floorY + 1.3 + r(26 + k) * 0.25, 0.14, 0.1, 0.06, lines, seed + 7 + k, [30, 50, 90], [240, 240, 235], 0.8, 0, 2.5);
    }
    // The hours, on the door's glass: a plate, white or black, with OPEN or CLOSED over the times.
    const rec = u.door.recess;
    const leaf = -(rec > 0 ? rec : 0.1) - 0.02;
    const plateW = 0.26;
    const plateH = 0.34;
    const cx = u.door.s + (u.door.width / 2 - 0.14 - plateW / 2 - 0.02) * (r(30) < 0.5 ? 1 : -1);
    const hours = HOURS[Math.floor(r(31) * HOURS.length) % HOURS.length] as readonly string[];
    const shut = u.state === "closed for the day";
    const lines = vacant ? [] : shut ? ["CLOSED", ...(r(32) < 0.5 ? ["Back at 1:30"] : hours.slice(0, 1))] : ["OPEN", ...hours];
    if (lines.length > 0) paint(cx, i.floorY + 1.18, plateW, plateH, leaf + 0.03, lines, seed + 91, r(33) < 0.5 ? [238, 238, 230] : [28, 28, 32], r(33) < 0.5 ? [160, 30, 30] : [235, 235, 225], 0.9, (r(34) - 0.5) * 0.04, 2.5);
  }
}
