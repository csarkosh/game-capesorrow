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
 * Authored, not researched: every size, the glow strengths, the sag and the loose corner of a banner, the colours (`signStyle.ts`).
 */
import { hash01, scaled, type MeshBuilder, type Rgb, type Vec3 } from "./meshBuilder.js";
import { coloursOf } from "./signStyle.js";
import { xp, type Xf } from "./roomGeometry.js";
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
};

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

export function signsGeometry(i: SignIn): void {
  const { use } = i;
  use.units.forEach((u) => u.signs.forEach((s, k) => drawSign(i, s, u, k)));
  use.signs.forEach((s, k) => drawSign(i, s, null, k + 40));
}

function drawSign(i: SignIn, sign: Sign, unit: Unit | null, k: number): void {
  const { solid, b, xf, atlas, g } = i;
  const pl = placeOf(xf, sign.place);
  const seed = (b.id * 131 + (unit?.id ?? 9) * 17 + k * 7 + sign.place.s * 3) | 0;
  const col = coloursOf(sign.style, sign.kind, seed);
  const lines = sign.lines.length > 0 ? sign.lines : [""];
  const nLines = lines.length;
  const bay = unit === null ? xf.width : unit.s1 - unit.s0;
  const ground = pl.free ? g.heightAt(pl.x, pl.z) : i.floorY;
  const y = (pl.free ? ground : i.floorY) + sign.place.h;
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
    default: h = 0.5 + nLines * 0.2; w = Math.min(2.4, textWidth(lines, 0.2) + 0.2); break;
  }
  const spec: SignSpec = { kind: sign.kind, style: sign.style, lines, decade: sign.decade, condition: sign.condition, lit: sign.lit, seed, bg: col.bg, fg: col.fg, accent: col.accent, clear, w, h };
  const at = atlas.place(w, h, spec);
  const glow = !sign.lit ? 0 : neon || sign.kind === "open" ? 2.1 : box ? 1.05 : 0;
  const ink: Rgb = old ? [0.08, 0.07, 0.06] : [0.17, 0.17, 0.18];

  /** The face as a quad at `off` off the wall, centred `cx` along the viewer's right, its bottom `y0` up, facing out (or the other way when `back`). */
  const quad = (cx: number, y0: number, ww: number, hh: number, off: number, back = false): void => {
    if (at === null) return;
    const sg = back ? -1 : 1;
    const c = (dr: number, yy: number): Vec3 => [pl.x + pl.rx * (cx + sg * dr) + pl.nx * off, yy, pl.z + pl.rz * (cx + sg * dr) + pl.nz * off];
    i.face.polyUv([c(-ww / 2, y0 + hh), c(ww / 2, y0 + hh), c(ww / 2, y0), c(-ww / 2, y0)], [[at.u0, at.v0], [at.u1, at.v0], [at.u1, at.v1], [at.u0, at.v1]], [pl.nx * sg, 0, pl.nz * sg], [1, 1, 1], { glow });
  };
  /** A box on the wall: `off0` to `off1` off it, centred `cx`, `ww` wide, from `y0` up `hh`. */
  const obox = (cx: number, y0: number, ww: number, hh: number, off0: number, off1: number, side: Rgb, top: Rgb = side): void => {
    const mx = pl.x + pl.rx * cx + pl.nx * ((off0 + off1) / 2);
    const mz = pl.z + pl.rz * cx + pl.nz * ((off0 + off1) / 2);
    solid.box(mx, mz, y0, pl.rx, pl.rz, ww / 2, (off1 - off0) / 2, hh, side, top);
  };
  const halfBay = (cx: number): number => Math.max(-bay / 2 + w / 2, Math.min(bay / 2 - w / 2, cx));
  void halfBay;

  switch (sign.kind) {
    case "fascia": {
      // The board spans the sign's width; its colour is dark and its edge a trim.
      const top = Math.min(y + h / 2, i.wallTop - 0.15);
      const y0 = top - h;
      obox(0, y0 - 0.03, w + 0.1, h + 0.06, 0, 0.1, ink, scaled(ink, 1.6));
      quad(0, y0, w, h, 0.105);
      break;
    }
    case "banner": {
      // Vinyl hung from grommets, sagging between them, one lower corner come loose. Six columns, each its own bottom.
      if (at === null) break;
      const n = 6;
      const loose = hash01(seed, 624) < 0.5 ? 1 : -1;
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
        i.face.polyUv([pt(a, yt, 0.13 + 0.01 * c), pt(e, yt, 0.13 + 0.01 * (c + 1)), pt(e, ye, 0.14 + 0.01 * (c + 1)), pt(a, ya, 0.14 + 0.01 * c)], [[u(c), at.v0], [u(c + 1), at.v0], [u(c + 1), vb(ye)], [u(c), vb(ya)]], [pl.nx, 0, pl.nz], [1, 1, 1], { glow: 0 });
      }
      break;
    }
    case "blade": {
      // A bracket from the wall and a board hanging from it by two short chains, facing along the wall both ways.
      const out = Math.max(0.6, sign.place.out);
      const yt = y + h / 2;
      solid.prism([pl.x + pl.nx * 0.02, yt + 0.05, pl.z + pl.nz * 0.02], [pl.x + pl.nx * (out + 0.05), yt + 0.05, pl.z + pl.nz * (out + 0.05)], 0.02, 4, [0.08, 0.08, 0.08]);
      const bx = pl.x + pl.nx * (out - 0.2);
      const bz = pl.z + pl.nz * (out - 0.2);
      const ww = w;
      // The board stands across the bracket (its faces along the wall): its own frame is the wall's normal as its "right".
      const pb: Pl = { x: bx, z: bz, nx: pl.rx, nz: pl.rz, rx: -pl.rz, rz: pl.rx, free: true };
      if (at !== null) {
        for (const back of [false, true]) {
          const sg = back ? -1 : 1;
          const c = (dr: number, yy: number): Vec3 => [pb.x + pb.rx * sg * dr + pb.nx * sg * 0.03, yy, pb.z + pb.rz * sg * dr + pb.nz * sg * 0.03];
          i.face.polyUv([c(-ww / 2, yt - 0.05), c(ww / 2, yt - 0.05), c(ww / 2, yt - 0.05 - h), c(-ww / 2, yt - 0.05 - h)], [[at.u0, at.v0], [at.u1, at.v0], [at.u1, at.v1], [at.u0, at.v1]], [pb.nx * sg, 0, pb.nz * sg], [1, 1, 1], { glow });
        }
      }
      solid.box(bx, bz, yt - 0.05 - h, pl.rx, pl.rz, 0.02, ww / 2 + 0.02, h, ink, ink);
      break;
    }
    case "glass": {
      // On the pane: just behind the window's face, the lettering alone.
      quad(0, y - h / 2, w, h, -0.04);
      break;
    }
    case "wall":
    case "ghost": {
      quad(0, y - h / 2, w, h, 0.015);
      break;
    }
    case "pole": {
      // A post at the lot's edge to `place.h`, the sign on top of it, a face each way.
      const gas = lines.length >= 4 && (lines[1] ?? "").startsWith("REGULAR");
      const top = ground + sign.place.h;
      const px = pl.x;
      const pz = pl.z;
      solid.box(px, pz, ground - 0.1, pl.rx, pl.rz, 0.12, 0.12, top - ground, [0.28, 0.28, 0.3], [0.28, 0.28, 0.3]);
      const y0 = top - (gas ? 0.2 : 0.1);
      solid.box(px, pz, y0 - h + 0.2, pl.rx, pl.rz, w / 2, 0.12, h, ink, scaled(ink, 1.5));
      quad(0, y0 - h + 0.2, w - 0.1, h - 0.1, 0.125);
      quad(0, y0 - h + 0.2, w - 0.1, h - 0.1, -0.125, true);
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
      for (const sg of [-1, 1]) solid.prism([pl.x + pl.rx * sg * (w / 2 + 0.02), by + h, pl.z + pl.rz * sg * (w / 2 + 0.02)], [pl.x + pl.rx * sg * (w / 2 + 0.02) + pl.nx * lean, by, pl.z + pl.rz * sg * (w / 2 + 0.02) + pl.nz * lean], 0.015, 4, frame, null);
      for (const sg of [-1, 1]) solid.prism([pl.x + pl.rx * sg * (w / 2 + 0.02), by + h, pl.z + pl.rz * sg * (w / 2 + 0.02)], [pl.x + pl.rx * sg * (w / 2 + 0.02) - pl.nx * lean, by, pl.z + pl.rz * sg * (w / 2 + 0.02) - pl.nz * lean], 0.015, 4, frame, null);
      break;
    }
    case "open": {
      // Hung in the glass on two cords: a small box with its tubes.
      obox(0, y - h / 2, w, h, -0.14, -0.1, [0.05, 0.05, 0.06]);
      quad(0, y - h / 2, w, h, -0.095);
      break;
    }
    case "lease": {
      quad(0, y - h / 2, w, h, -0.05);
      break;
    }
    default: {
      // A board: on two posts at the lot's edge, or a plaque on the wall.
      if (pl.free) {
        const top = ground + sign.place.h + h / 2;
        for (const sg of [-1, 1]) solid.box(pl.x + pl.rx * sg * (w / 2 - 0.05), pl.z + pl.rz * sg * (w / 2 - 0.05), ground - 0.1, pl.rx, pl.rz, 0.06, 0.06, top - ground + 0.1, [0.3, 0.2, 0.12], [0.3, 0.2, 0.12]);
        obox(0, top - h, w, h, -0.05, 0.05, ink, scaled(ink, 1.5));
        quad(0, top - h + 0.04, w - 0.08, h - 0.08, 0.055);
        quad(0, top - h + 0.04, w - 0.08, h - 0.08, -0.055, true);
      } else {
        const y0 = y - h / 2;
        obox(0, y0 - 0.04, w + 0.12, h + 0.08, 0, 0.06, ink, scaled(ink, 1.4));
        quad(0, y0, w, h, 0.065);
      }
      break;
    }
  }
}
