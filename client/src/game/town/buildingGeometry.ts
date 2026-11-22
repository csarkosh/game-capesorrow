/**
 * A building as arrays: a shell on its oriented rectangle (`centre`, `halfAlong`, `halfAcross`, `bearing`).
 *
 * - **Walls** go from below the lowest ground under the footprint (so no gap shows on a slope) up to the eave, four
 *   flat quads facing outward. A building standing on piles (no lot) starts at its deck.
 * - **Roofs** by kind: `flat` has a roof surface and a low parapet round it; `gable` has its ridge along the longer
 *   side and a gable end on each short wall; `hip` is a true hip, four faces with a short ridge; `shed` is a single
 *   slope, high at the back, with trapezoid side walls. The pitched roofs overhang the walls by `EAVE` m. A `ruin` is
 *   roofless, lower, and its walls are broken at the top in runs of about a metre, with inner faces and a little rubble.
 * - **Windows** are rows of dark rectangles per storey on the street-facing wall and the sides, laid `PROUD` m off the
 *   wall (a light frame under the glass on the full detail), a house with a door and a few windows, a storefront with
 *   one wide band of glass at street level and a door, a warehouse, mill, cannery or shed with a big door and few windows.
 *   A vacant building is duller, its ground-floor glass and door boarded in plywood.
 * - **Colour** from `material` and the building's id (`vary`): no random call anywhere.
 * - **A landmark** carries one touch: the FBI office a flagpole, a portico and a cornice; a church a steeple; the tsunami
 *   refuge is an open platform on legs with stairs; the mill a smokestack.
 */
import { bearingU, bearingV } from "../../sim/town/bearings.js";
import type { Building, BuildingKind, LandmarkRole } from "../../sim/town/types.js";
import { hash01, greyed, scaled, type MeshBuilder, type Rgb, type Vec3 } from "./meshBuilder.js";
import {
  BIG_DOOR, DOOR, FLAG_POLE, FLAG_RED, FRAME, GLASS, PLYWOOD, ROOF_METAL, ROOF_SHINGLE, ROOF_TAR, STONE_TRIM, vary, wallColour,
} from "./palette.js";
import type { Detail, Sink, TownGround } from "./townTypes.js";

/** How far the windows and doors lie off the wall's face, metres. */
export const PROUD = 0.03;
export const EAVE = 0.35;

type Profile = "shop" | "house" | "civic" | "industrial" | "church";

const PROFILE: Record<BuildingKind, Profile> = {
  storefront: "shop",
  hotel: "civic",
  bank: "civic",
  "lodge hall": "civic",
  church: "church",
  house: "house",
  apartment: "house",
  warehouse: "industrial",
  "mill shed": "industrial",
  cannery: "industrial",
  "port terminal shed": "industrial",
  "gas station": "shop",
  motel: "house",
  "big-box store": "industrial",
  school: "civic",
  hospital: "civic",
  office: "civic",
  "federal building": "civic",
  courthouse: "civic",
  "tsunami refuge": "civic",
  tavern: "shop",
  "boarding house": "house",
  depot: "industrial",
  "customs house": "civic",
  silo: "industrial",
  garage: "industrial",
  restaurant: "shop",
  pier: "industrial",
};

type Wall = {
  /** The wall's two ends (world x, z), looking at it from outside from left to right, and its outward normal. */
  ax: number;
  az: number;
  bx: number;
  bz: number;
  nx: number;
  nz: number;
  length: number;
  front: boolean;
  /** The wall's top at each end, metres. */
  topA: number;
  topB: number;
};

type Opening = { s0: number; s1: number; y0: number; y1: number; colour: Rgb; frame: boolean };

/** The few numbers every part of one building is built from. */
type Frame = {
  cx: number;
  cz: number;
  ux: number;
  uz: number;
  vx: number;
  vz: number;
  hu: number;
  hv: number;
};

const dot = (ax: number, az: number, bx: number, bz: number): number => ax * bx + az * bz;

export function buildingGeometry(g: TownGround, b: Building, role: LandmarkRole | null, sink: Sink, detail: Detail): void {
  const u = bearingU(b.bearing);
  const v = bearingV(b.bearing);
  const f: Frame = { cx: g.anchor.x + b.centre.x, cz: g.anchor.z + b.centre.z, ux: u.x, uz: u.z, vx: v.x, vz: v.z, hu: b.halfAlong, hv: b.halfAcross };
  const out = sink(f.cx, f.cz);
  const ruin = b.state === "ruin";
  const vacant = b.state === "vacant";
  const onPiles = b.lot === -1;

  const corner = (su: number, sv: number): [number, number] => [f.cx + f.ux * f.hu * su + f.vx * f.hv * sv, f.cz + f.uz * f.hu * su + f.vz * f.hv * sv];

  // The ground under the footprint: the lowest point sets the walls' base, the front's highest the floor.
  let low = Infinity;
  for (const su of [-1, 0, 1]) {
    for (const sv of [-1, 0, 1]) {
      const [x, z] = corner(su, sv);
      low = Math.min(low, g.heightAt(x, z));
    }
  }
  const deck = onPiles ? g.deckAt(f.cx, f.cz) : 0;
  const baseY = onPiles ? deck : low - 0.3;

  // Which wall is the front: the one whose normal is nearest the lot's front direction.
  const fr = b.front ?? { x: -v.x, z: -v.z };
  const walls: Wall[] = [];
  const sides: [number, number, number, number, number, number][] = [
    // su, sv of the two ends, and the outward normal
    [1, -1, 1, 1, u.x, u.z],
    [-1, 1, -1, -1, -u.x, -u.z],
    [1, 1, -1, 1, v.x, v.z],
    [-1, -1, 1, -1, -v.x, -v.z],
  ];
  let frontAt = 0;
  let best = -Infinity;
  sides.forEach((s, i) => {
    const d = dot(s[4], s[5], fr.x, fr.z);
    if (d > best) {
      best = d;
      frontAt = i;
    }
  });

  // Roof geometry's own frame: e1 the long axis, e2 the short.
  const long = f.hu >= f.hv;
  const e1: [number, number] = long ? [f.ux, f.uz] : [f.vx, f.vz];
  const e2: [number, number] = long ? [f.vx, f.vz] : [f.ux, f.uz];
  const L = long ? f.hu : f.hv;
  const S = long ? f.hv : f.hu;

  // The floor: the front's highest ground (never under the base). A building's height is above its floor.
  const fs = sides[frontAt] as (typeof sides)[number];
  const fa = corner(fs[0], fs[1]);
  const fb = corner(fs[2], fs[3]);
  const floorY = onPiles ? deck + 0.1 : Math.max(baseY + 0.3, g.heightAt(fa[0], fa[1]) + 0.1, g.heightAt(fb[0], fb[1]) + 0.1, g.heightAt((fa[0] + fb[0]) / 2, (fa[1] + fb[1]) / 2) + 0.1);

  const H = floorY + (ruin ? Math.max(2.6, b.height * 0.6) : b.height);
  const roofKind = ruin ? "ruin" : b.roof;
  let rise = 0;
  if (roofKind === "gable" || roofKind === "hip") rise = Math.min(Math.max(S * 0.55, 1.2), 4, Math.max(0.8, H - 2.5));
  const shedDrop = roofKind === "shed" ? Math.min(1.5, Math.max(0.6, H * 0.2)) : 0;
  const wallTop = H - rise;
  // The shed's high side is the one away from the front.
  const shedSign = dot(e2[0], e2[1], fr.x, fr.z) < 0 ? 1 : -1;
  const topFor = (su: number, sv: number): number => {
    if (roofKind === "flat") return H + 0.5;
    if (roofKind === "shed") {
      const along2 = long ? sv : su;
      return along2 === shedSign ? H : H - shedDrop;
    }
    return wallTop;
  };

  sides.forEach((s, i) => {
    const [ax, az] = corner(s[0], s[1]);
    const [bx, bz] = corner(s[2], s[3]);
    walls.push({
      ax, az, bx, bz, nx: s[4], nz: s[5], length: Math.sqrt((bx - ax) * (bx - ax) + (bz - az) * (bz - az)), front: i === frontAt,
      topA: topFor(s[0], s[1]), topB: topFor(s[2], s[3]),
    });
  });

  // Colours.
  let wall = vary(wallColour(b.material, b.id), b.id);
  let roofColour: Rgb = b.material === "metal" || roofKind === "shed" ? ROOF_METAL : roofKind === "flat" ? ROOF_TAR : vary(ROOF_SHINGLE, b.id, 5);
  if (vacant) {
    wall = scaled(greyed(wall, 0.35), 0.78);
    roofColour = scaled(roofColour, 0.8);
  }
  if (ruin) wall = scaled(greyed(wall, 0.45), 0.62);
  const inner = scaled(wall, 0.6);

  if (role === "tsunami refuge") {
    refugeGeometry(g, f, b, out, baseY, H, walls, frontAt, floorY);
    return;
  }

  // ---- the walls
  for (const w of walls) {
    const hint: Vec3 = [w.nx, 0, w.nz];
    if (ruin) {
      brokenWall(out, w, baseY, floorY, H, wall, inner, b.id);
    } else {
      out.poly([[w.ax, baseY, w.az], [w.bx, baseY, w.bz], [w.bx, w.topB, w.bz], [w.ax, w.topA, w.az]], hint, wall);
    }
  }

  // ---- the roof
  const P = (s1: number, s2: number, y: number): Vec3 => [f.cx + e1[0] * s1 + e2[0] * s2, y, f.cz + e1[1] * s1 + e2[1] * s2];
  if (roofKind === "flat") {
    const inset = 0.3;
    out.poly([P(-L + inset, -S + inset, H), P(L - inset, -S + inset, H), P(L - inset, S - inset, H), P(-L + inset, S - inset, H)], [0, 1, 0], roofColour);
    // The parapet's inner faces, and its top.
    const e: [number, number][] = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
    for (let i = 0; i < 4; i++) {
      const [sa, ta] = e[i] as [number, number];
      const [sb, tb] = e[(i + 1) % 4] as [number, number];
      const a = P(sa * (L - inset), ta * (S - inset), H);
      const c = P(sb * (L - inset), tb * (S - inset), H);
      // The inner face looks into the roof: toward its centre from the middle of the edge it stands on.
      const hintIn: Vec3 = [f.cx - (a[0] + c[0]) / 2, 0, f.cz - (a[2] + c[2]) / 2];
      out.poly([a, c, [c[0], H + 0.5, c[2]], [a[0], H + 0.5, a[2]]], hintIn, inner);
      const ao = P(sa * L, ta * S, H + 0.5);
      const co = P(sb * L, tb * S, H + 0.5);
      out.poly([ao, co, [c[0], H + 0.5, c[2]], [a[0], H + 0.5, a[2]]], [0, 1, 0], wall);
    }
  } else if (roofKind === "gable") {
    const Le = L + EAVE;
    const Se = S + EAVE;
    const he = wallTop - 0.15;
    for (const side of [-1, 1]) {
      out.poly([P(-Le, side * Se, he), P(Le, side * Se, he), P(Le, 0, H), P(-Le, 0, H)], [e2[0] * side * 0.6, 1, e2[1] * side * 0.6], roofColour);
    }
    // The gable ends, on the short walls.
    for (const end of [-1, 1]) {
      out.poly([P(end * L, -S, wallTop), P(end * L, S, wallTop), P(end * L, 0, H)], [e1[0] * end, 0, e1[1] * end], wall);
    }
  } else if (roofKind === "hip") {
    const Le = L + EAVE;
    const Se = S + EAVE;
    const he = wallTop - 0.15;
    const r = Math.max(0.2, L - S);
    for (const side of [-1, 1]) {
      out.poly([P(-Le, side * Se, he), P(Le, side * Se, he), P(r, 0, H), P(-r, 0, H)], [e2[0] * side * 0.6, 1, e2[1] * side * 0.6], roofColour);
    }
    for (const end of [-1, 1]) {
      out.poly([P(end * Le, -Se, he), P(end * Le, Se, he), P(end * r, 0, H)], [e1[0] * end * 0.6, 1, e1[1] * end * 0.6], scaled(roofColour, 0.92));
    }
  } else if (roofKind === "shed") {
    const Le = L + EAVE;
    const Se = S + EAVE;
    out.poly([P(-Le, shedSign * Se, H + 0.1), P(Le, shedSign * Se, H + 0.1), P(Le, -shedSign * Se, H - shedDrop - 0.1), P(-Le, -shedSign * Se, H - shedDrop - 0.1)], [-e2[0] * shedSign * 0.4, 1, -e2[1] * shedSign * 0.4], roofColour);
  }

  // ---- ruins: rubble inside the walls
  if (ruin) {
    for (let k = 0; k < 4; k++) {
      const su = (hash01(b.id, 40 + k) - 0.5) * 1.5 * (f.hu - 1);
      const sv = (hash01(b.id, 50 + k) - 0.5) * 1.5 * (f.hv - 1);
      const x = f.cx + f.ux * su + f.vx * sv;
      const z = f.cz + f.uz * su + f.vz * sv;
      const h = 0.3 + hash01(b.id, 60 + k) * 0.5;
      const half = 0.4 + hash01(b.id, 70 + k) * 0.5;
      out.box(x, z, g.heightAt(x, z) - 0.1, f.ux, f.uz, half, half * 0.8, h + 0.1, inner, scaled(inner, 0.8));
    }
  }

  // ---- doors and windows
  if (!ruin) {
    const open = openings(b, walls, frontAt, floorY, wallTop, H, vacant, detail, g);
    for (const [i, list] of open.entries()) {
      const w = walls[i] as Wall;
      for (const o of list) {
        const tx = (w.bx - w.ax) / w.length;
        const tz = (w.bz - w.az) / w.length;
        const at = (s: number, y: number, lift: number): Vec3 => [w.ax + tx * s + w.nx * lift, y, w.az + tz * s + w.nz * lift];
        const hint: Vec3 = [w.nx, 0, w.nz];
        if (o.frame && detail === "full") {
          const m = 0.1;
          out.poly([at(o.s0 - m, o.y0 - m, PROUD), at(o.s1 + m, o.y0 - m, PROUD), at(o.s1 + m, o.y1 + m, PROUD), at(o.s0 - m, o.y1 + m, PROUD)], hint, FRAME);
        }
        const lift = o.frame && detail === "full" ? PROUD + 0.015 : PROUD;
        out.poly([at(o.s0, o.y0, lift), at(o.s1, o.y0, lift), at(o.s1, o.y1, lift), at(o.s0, o.y1, lift)], hint, o.colour);
      }
    }
  } else {
    // A ruin keeps a few empty openings in its front wall, where the wall still stands.
    const w = walls[frontAt] as Wall;
    const tx = (w.bx - w.ax) / w.length;
    const tz = (w.bz - w.az) / w.length;
    for (let k = 0; k < 2; k++) {
      const s = (w.length * (k + 1)) / 3;
      const at = (ss: number, y: number): Vec3 => [w.ax + tx * ss + w.nx * PROUD, y, w.az + tz * ss + w.nz * PROUD];
      const y0 = floorY + 0.9;
      // Only under the run of broken wall that is high enough there.
      if (wallRunTop(b.id, w, s, floorY, H) > y0 + 1.5) out.poly([at(s - 0.5, y0), at(s + 0.5, y0), at(s + 0.5, y0 + 1.3), at(s - 0.5, y0 + 1.3)], [w.nx, 0, w.nz], GLASS);
    }
  }

  landmarkTouch(g, role, f, b, out, walls, frontAt, e1, e2, L, S, wallTop, H, floorY, baseY);
}

/** The top of a ruin's wall at `s` along it (the runs of `brokenWall`). */
function wallRunTop(id: number, w: Wall, s: number, floorY: number, H: number): number {
  const run = Math.floor(s / 1.2);
  return floorY + (H - floorY) * (0.45 + 0.55 * hash01(id * 31 + Math.floor(w.ax * 3) + run, 80));
}

/** A ruin's wall: runs of about a metre, each to its own height, an inner face, and the top of each run left open. */
function brokenWall(out: MeshBuilder, w: Wall, baseY: number, floorY: number, H: number, colour: Rgb, inner: Rgb, id: number): void {
  const runs = Math.max(1, Math.ceil(w.length / 1.2));
  const tx = (w.bx - w.ax) / w.length;
  const tz = (w.bz - w.az) / w.length;
  const out3: Vec3 = [w.nx, 0, w.nz];
  const in3: Vec3 = [-w.nx, 0, -w.nz];
  for (let r = 0; r < runs; r++) {
    const s0 = (r / runs) * w.length;
    const s1 = ((r + 1) / runs) * w.length;
    const h0 = floorY + (H - floorY) * (0.45 + 0.55 * hash01(id * 31 + Math.floor(w.ax * 3) + Math.floor(s0 / 1.2), 80));
    const h1 = floorY + (H - floorY) * (0.45 + 0.55 * hash01(id * 31 + Math.floor(w.ax * 3) + Math.floor(s1 / 1.2 - 1e-9), 80));
    const a: Vec3 = [w.ax + tx * s0, 0, w.az + tz * s0];
    const b: Vec3 = [w.ax + tx * s1, 0, w.az + tz * s1];
    // A run stands level to the lower of its two ends' heights, so the line is stepped.
    const top = Math.min(h0, h1);
    out.poly([[a[0], baseY, a[2]], [b[0], baseY, b[2]], [b[0], top, b[2]], [a[0], top, a[2]]], out3, colour);
    out.poly([[a[0], baseY, a[2]], [b[0], baseY, b[2]], [b[0], top, b[2]], [a[0], top, a[2]]], in3, inner);
  }
}

/** The doors and windows of each wall (by the wall's index), for a building that is not a ruin. */
function openings(b: Building, walls: readonly Wall[], frontAt: number, floorY: number, wallTop: number, H: number, vacant: boolean, detail: Detail, g: TownGround): Opening[][] {
  const profile = PROFILE[b.kind];
  const result: Opening[][] = walls.map(() => []);
  const storeys = Math.max(1, b.storeys);
  const fh = (wallTop - floorY) / storeys;
  const lowStoreys = detail === "low" ? 1 : storeys;
  const glassColour = (k: number): Rgb => scaled(GLASS, 0.8 + hash01(b.id * 7 + k, 90) * 0.7);
  const boards = (s0: number, s1: number, y0: number, y1: number, frame: boolean, out: Opening[]): void => {
    // Plywood in panels of about 1.2 m, each its own shade.
    const n = Math.max(1, Math.round((s1 - s0) / 1.2));
    for (let i = 0; i < n; i++) {
      out.push({ s0: s0 + ((s1 - s0) * i) / n + 0.02, s1: s0 + ((s1 - s0) * (i + 1)) / n - 0.02, y0, y1, colour: scaled(PLYWOOD, 0.85 + hash01(b.id * 13 + i, 95) * 0.3), frame });
    }
  };
  walls.forEach((w, i) => {
    const out = result[i] as Opening[];
    const isFront = i === frontAt;
    const back = !isFront && dot(w.nx, w.nz, (walls[frontAt] as Wall).nx, (walls[frontAt] as Wall).nz) < -0.5;
    if (back && profile !== "civic") return;
    if (w.length < 2.4) return;
    const grounded = (s: number): number => {
      const tx = (w.bx - w.ax) / w.length;
      const tz = (w.bz - w.az) / w.length;
      return g.heightAt(w.ax + tx * s, w.az + tz * s);
    };
    // Street level, and the door.
    let doorAt = -1;
    if (isFront) {
      if (profile === "shop") {
        const sx = 0.6;
        const ex = w.length - 0.6;
        const y0 = floorY + 0.45;
        const y1 = floorY + Math.min(2.9, fh - 0.5);
        const dw = 1.1;
        doorAt = sx + 0.15 + dw / 2;
        if (vacant) boards(sx + dw + 0.3, ex, y0, y1, false, out);
        else out.push({ s0: sx + dw + 0.3, s1: ex, y0, y1, colour: glassColour(0), frame: false });
        out.push({ s0: doorAt - dw / 2, s1: doorAt + dw / 2, y0: floorY, y1: floorY + 2.2, colour: vacant ? PLYWOOD : DOOR, frame: false });
      } else if (profile === "industrial") {
        const dw = Math.min(3.6, w.length * 0.6);
        doorAt = w.length / 2;
        out.push({ s0: doorAt - dw / 2, s1: doorAt + dw / 2, y0: floorY, y1: floorY + Math.min(3.8, wallTop - floorY - 0.5), colour: vacant ? PLYWOOD : BIG_DOOR, frame: false });
      } else {
        doorAt = w.length / 2;
        const dw = profile === "church" ? 1.8 : 1.1;
        out.push({ s0: doorAt - dw / 2, s1: doorAt + dw / 2, y0: floorY, y1: floorY + (profile === "church" ? 3 : 2.2), colour: vacant ? PLYWOOD : DOOR, frame: false });
      }
    }
    if (profile === "industrial") {
      // A few small high windows on the sides, none where a storey is too low.
      if (!isFront && detail === "full" && wallTop - floorY > 4) {
        const n = Math.min(3, Math.floor(w.length / 6));
        for (let k = 0; k < n; k++) {
          const s = (w.length * (k + 1)) / (n + 1);
          out.push({ s0: s - 0.5, s1: s + 0.5, y0: floorY + 2.6, y1: floorY + 3.4, colour: glassColour(k), frame: true });
        }
      }
      return;
    }
    const spacing = profile === "house" ? 3.2 : profile === "church" ? 3.6 : 3;
    const n = Math.max(0, Math.floor((w.length - 1.6) / spacing) + 1);
    const ww = profile === "church" ? 0.8 : 1;
    const wh = Math.min(profile === "church" ? 2.2 : 1.4, fh * 0.55);
    for (let k = 0; k < Math.min(storeys, lowStoreys); k++) {
      // The shop's street level is the band and the door; its upper storeys are windows.
      if (k === 0 && isFront && profile === "shop") continue;
      for (let j = 0; j < n; j++) {
        const s = w.length / 2 + (j - (n - 1) / 2) * spacing;
        if (k === 0 && doorAt >= 0 && Math.abs(s - doorAt) < 1.3) continue;
        const y0 = Math.max(floorY + k * fh + fh * 0.3, k === 0 ? grounded(s) + 0.9 : 0);
        if (y0 + wh > wallTop - 0.25) continue;
        if (vacant && k === 0 && isFront) boards(s - ww / 2, s + ww / 2, y0, y0 + wh, true, out);
        else out.push({ s0: s - ww / 2, s1: s + ww / 2, y0, y1: y0 + wh, colour: glassColour(j + k * 5), frame: true });
      }
    }
    void H;
  });
  return result;
}

/** The one distinguishing touch of a landmark's building. */
function landmarkTouch(
  g: TownGround, role: LandmarkRole | null, f: Frame, b: Building, out: MeshBuilder, walls: readonly Wall[], frontAt: number,
  e1: [number, number], e2: [number, number], L: number, S: number, wallTop: number, H: number, floorY: number, baseY: number,
): void {
  if (role === null || b.state === "ruin") return;
  const w = walls[frontAt] as Wall;
  const tx = (w.bx - w.ax) / w.length;
  const tz = (w.bz - w.az) / w.length;
  const mid: [number, number] = [(w.ax + w.bx) / 2, (w.az + w.bz) / 2];
  if (role === "fbi") {
    // A plain, formal front: a stone cornice along the top of the front wall, a portico over the door, a flagpole with its flag.
    const top = Math.max(w.topA, w.topB);
    out.box(mid[0] + w.nx * 0.15, mid[1] + w.nz * 0.15, top - 0.5, tx, tz, w.length / 2 + 0.1, 0.25, 0.5, STONE_TRIM, STONE_TRIM);
    const px = mid[0] + w.nx * 1.2;
    const pz = mid[1] + w.nz * 1.2;
    const slab = floorY + 3.3;
    out.box(px, pz, slab, tx, tz, 2.2, 1.3, 0.35, STONE_TRIM, STONE_TRIM);
    for (const s of [-1.7, 1.7]) {
      const cx = px + tx * s + w.nx * 0.7;
      const cz = pz + tz * s + w.nz * 0.7;
      out.box(cx, cz, floorY, tx, tz, 0.17, 0.17, slab - floorY, STONE_TRIM, STONE_TRIM);
    }
    const bx = w.ax + tx * 0.8 + w.nx * 2.2;
    const bz = w.az + tz * 0.8 + w.nz * 2.2;
    const by = g.heightAt(bx, bz);
    out.box(bx, bz, by, 1, 0, 0.05, 0.05, 8.5, FLAG_POLE, FLAG_POLE);
    const fx = bx + tx * 0.7;
    const fz = bz + tz * 0.7;
    const flag = [[bx + tx * 0.05, by + 8.4, bz + tz * 0.05], [fx + tx * 0.5, by + 8.4, fz + tz * 0.5], [fx + tx * 0.5, by + 7.5, fz + tz * 0.5], [bx + tx * 0.05, by + 7.5, bz + tz * 0.05]] as Vec3[];
    out.poly(flag, [w.nx, 0, w.nz], FLAG_RED);
    out.poly(flag, [-w.nx, 0, -w.nz], FLAG_RED);
  } else if (role === "church") {
    // A steeple over the front: a square tower and a spire.
    const half = Math.min(1.7, w.length / 2 - 0.3);
    const cx = mid[0] + w.nx * 0.2;
    const cz = mid[1] + w.nz * 0.2;
    const tower = H + 3.5;
    out.box(cx, cz, baseY, tx, tz, half, half, tower - baseY, scaled(wallColour(b.material, b.id), 0.95), ROOF_SHINGLE);
    const apex: Vec3 = [cx, tower + half * 3.2, cz];
    const c = (su: number, sv: number): Vec3 => [cx + tx * half * su + w.nx * half * sv, tower, cz + tz * half * su + w.nz * half * sv];
    const ring = [c(-1, -1), c(1, -1), c(1, 1), c(-1, 1)];
    for (let i = 0; i < 4; i++) {
      const p = ring[i] as Vec3;
      const q = ring[(i + 1) % 4] as Vec3;
      const mx = (p[0] + q[0]) / 2 - cx;
      const mz = (p[2] + q[2]) / 2 - cz;
      out.poly([p, q, apex], [mx, 0.5, mz], ROOF_SHINGLE);
    }
  } else if (role === "mill") {
    // A smokestack at one end.
    const x = f.cx + e1[0] * L * 0.6;
    const z = f.cz + e1[1] * L * 0.6;
    out.box(x, z, baseY, e1[0], e1[1], 1.1, 1.1, H + 12 - baseY, wallColour("brick", b.id), scaled(wallColour("brick", b.id), 0.5));
  }
  void e2;
  void S;
  void wallTop;
}

/** The tsunami refuge: an open platform on legs, a rail round it, and a stair up along the back. */
function refugeGeometry(g: TownGround, f: Frame, b: Building, out: MeshBuilder, baseY: number, H: number, walls: readonly Wall[], frontAt: number, floorY: number): void {
  const conc: Rgb = vary([0.42, 0.42, 0.4], b.id);
  const platform = Math.max(H, 3.5);
  const slab = 0.45;
  const { cx, cz, ux, uz, vx, vz, hu, hv } = f;
  const P = (su: number, sv: number, y: number): Vec3 => [cx + ux * su + vx * sv, y, cz + uz * su + vz * sv];
  // The platform's top and its edge.
  out.box(cx, cz, platform - slab, ux, uz, hu, hv, slab, conc, scaled(conc, 1.1));
  // Legs: a row each side every ~5 m.
  const nu = Math.max(1, Math.round((2 * hu) / 5));
  const nv = Math.max(1, Math.round((2 * hv) / 5));
  for (let i = 0; i <= nu; i++) {
    for (let j = 0; j <= nv; j++) {
      if (i > 0 && i < nu && j > 0 && j < nv) continue;
      const su = -hu + 0.5 + (i / nu) * (2 * hu - 1);
      const sv = -hv + 0.5 + (j / nv) * (2 * hv - 1);
      const x = cx + ux * su + vx * sv;
      const z = cz + uz * su + vz * sv;
      const bottom = Math.min(g.heightAt(x, z), baseY) - 0.3;
      out.box(x, z, bottom, ux, uz, 0.3, 0.3, platform - slab - bottom, conc, conc);
    }
  }
  // A rail: posts at the corners and two rails, all round.
  const railTop = platform + 1.1;
  const pts: [number, number][] = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
  for (let i = 0; i < 4; i++) {
    const [sa, ta] = pts[i] as [number, number];
    const [sb, tb] = pts[(i + 1) % 4] as [number, number];
    const a = P(sa * (hu - 0.15), ta * (hv - 0.15), 0);
    const c = P(sb * (hu - 0.15), tb * (hv - 0.15), 0);
    const len = Math.sqrt((c[0] - a[0]) * (c[0] - a[0]) + (c[2] - a[2]) * (c[2] - a[2]));
    const dx = (c[0] - a[0]) / len;
    const dz = (c[2] - a[2]) / len;
    for (const y of [platform + 0.5, railTop - 0.05]) out.box((a[0] + c[0]) / 2, (a[2] + c[2]) / 2, y, dx, dz, len / 2, 0.04, 0.08, FLAG_POLE, FLAG_POLE);
    out.box(a[0], a[2], platform, 1, 0, 0.05, 0.05, 1.1, FLAG_POLE, FLAG_POLE);
  }
  // A small roof on four posts over the middle, for shelter.
  const roofY = platform + 3.2;
  for (const [su, sv] of [[-1, -1], [1, -1], [1, 1], [-1, 1]] as const) {
    const x = cx + ux * su * hu * 0.4 + vx * sv * hv * 0.4;
    const z = cz + uz * su * hu * 0.4 + vz * sv * hv * 0.4;
    out.box(x, z, platform, 1, 0, 0.1, 0.1, roofY - platform, FLAG_POLE, FLAG_POLE);
  }
  out.box(cx, cz, roofY, ux, uz, hu * 0.5, hv * 0.5, 0.2, ROOF_METAL, ROOF_METAL);
  // The stair: a slope along the side away from the front, from the ground to the platform.
  const w = walls[frontAt] as Wall;
  const back = dot(vx, vz, w.nx, w.nz) > 0 ? -1 : 1;
  const steps = platform / 0.18;
  const run = Math.min(2 * hu, steps * 0.28);
  const s0 = -run / 2;
  const s1 = run / 2;
  const sv = back * (hv + 1);
  const foot = P(s0, sv, 0);
  const g0 = Math.min(g.heightAt(foot[0], foot[2]), baseY);
  const slope = [P(s0, sv - 0.8, g0), P(s1, sv - 0.8, platform), P(s1, sv + 0.8, platform), P(s0, sv + 0.8, g0)];
  out.poly(slope, [0, 1, 0], conc);
  for (const side of [-1, 1]) out.poly([P(s0, sv + side * 0.8, g0), P(s1, sv + side * 0.8, platform), P(s1, sv + side * 0.8, g0 - 0.3), P(s0, sv + side * 0.8, g0 - 0.3)], [vx * side, 0, vz * side], scaled(conc, 0.8));
  void floorY;
}
