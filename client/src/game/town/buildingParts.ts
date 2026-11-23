/**
 * The parts that stop a building being a box, by its kind, its age, its material and its own history. Every one is caused: by the plan (the
 * kind, the era, the state, the units and the door it already has) or by a roll from the building's id that stands for one named thing, in a
 * comment at the roll. Nothing is built on a wall that stands against its neighbour, and the low tier leaves off the small trim.
 *
 * - Houses and dwellings: a concrete foundation and water table; corner boards; steps to the door and, on a house of 1900 to 1950, a porch with
 *   a roof of its own (an enclosed one in another siding, for one owner in six, who closed it in); a brick chimney; gutters and downspouts; a
 *   meter and its conduit on a side wall; in the present day a heat pump or a propane tank in the yard; and what the years added: a lean-to at
 *   the back in a different siding and roof (1970), a carport at the side (a roll for one owner's 1980s), a patch of newer siding where a
 *   board was replaced, a section of new roof, a blue or brown tarp weighed down on an old roof that has been neglected.
 * - Flat roofs: rooftop units, vents and a roof hatch (the units of a building that was remodelled after 1970; vents and the hatch on all); a fire
 *   escape of the old multi-storey brick blocks, on the back or a side that faces nothing.
 * - By kind: a gas station's canopy on columns with its pumps; a motel's covered walkway and its row of doors and windows; a church's bell cote
 *   (a landmark church has its steeple); a fire hall's hose tower; a portico on a bank, courthouse, lodge hall or school; a warehouse's ridge vent.
 * - What is authored, not researched: every dimension, colour and chance below.
 */
import type { Building, BuildingUse, LandmarkRole } from "../../sim/town/types.js";
import { hash01, scaled, type MeshBuilder, type Rgb, type Vec3 } from "./meshBuilder.js";
import { pane, pickOf, wat, wbox, wquad, type WallRef } from "./buildingKit.js";
import { agingOf } from "./buildingWear.js";
import type { Xf } from "./roomGeometry.js";
import type { Surface } from "./townSurface.js";
import type { Detail, TownGround } from "./townTypes.js";

export type PartsIn = {
  readonly g: TownGround;
  readonly b: Building;
  readonly role: LandmarkRole | null;
  readonly out: MeshBuilder;
  readonly glass: MeshBuilder;
  readonly detail: Detail;
  readonly refs: readonly WallRef[];
  readonly frontAt: number;
  readonly use: BuildingUse | undefined;
  readonly xf: Xf | null;
  readonly floorY: number;
  readonly frontFloorY: number;
  readonly baseY: number;
  readonly wallTop: number;
  readonly H: number;
  readonly roofKind: "flat" | "gable" | "hip" | "shed" | "ruin";
  readonly rise: number;
  /** A point of the roof's frame: along the long axis, across it, height. */
  readonly P: (s1: number, s2: number, y: number) => Vec3;
  readonly L: number;
  readonly S: number;
  readonly e2: readonly [number, number];
  readonly wall: Rgb;
  readonly blocked: readonly boolean[];
  readonly vacant: boolean;
  readonly wallSurface: (i: number) => Surface;
  readonly lotOut: number;
};

const CONCRETE: Rgb = [0.4, 0.4, 0.38];
const TRIM: Rgb = [0.66, 0.66, 0.62];
const METAL: Rgb = [0.34, 0.36, 0.38];
const DARK: Rgb = [0.1, 0.1, 0.11];
const BRICK: Rgb = [0.36, 0.15, 0.11];
const SIDINGS: readonly Rgb[] = [[0.5, 0.49, 0.45], [0.38, 0.17, 0.12], [0.2, 0.28, 0.36], [0.42, 0.37, 0.25], [0.18, 0.27, 0.2], [0.62, 0.6, 0.55]];

export function partsGeometry(i: PartsIn): void {
  const { b, role } = i;
  const full = i.detail === "full";
  const dwelling = b.kind === "house" || b.kind === "apartment" || b.kind === "boarding house";
  if (dwelling) housePart(i, full);
  else if (b.roof === "flat" || i.roofKind === "flat") flatRoofParts(i, full);
  kindParts(i, full, role);
  if (full) gutters(i);
}

function eachWall(i: PartsIn, fn: (w: WallRef, k: number) => void): void {
  i.refs.forEach((w, k) => {
    if (!i.blocked[k]) fn(w, k);
  });
}

// ---- Houses
function housePart(i: PartsIn, full: boolean): void {
  const { b, out, refs, frontAt, floorY, baseY } = i;
  const { age, neglect } = agingOf(b);
  const front = refs[frontAt] as WallRef;
  // The foundation: a concrete skirt round the base, from under the ground to a hand over the floor.
  eachWall(i, (w) => wquad(out, w, 0, baseY, w.length, i.frontFloorY + 0.15, 0.025, CONCRETE, undefined));
  if (full) {
    // Corner boards: painted boards up each corner, proud of the siding.
    const trim = b.material === "wood" ? scaled(TRIM, 0.95 + 0.1 * hash01(b.id, 500)) : scaled(i.wall, 1.15);
    i.refs.forEach((w) => {
      wbox(out, w, -0.06, 0.1, floorY + 0.15, i.wallTop, 0, 0.04, trim, trim);
      wbox(out, w, w.length - 0.1, w.length + 0.06, floorY + 0.15, i.wallTop, 0, 0.04, trim, trim);
    });
  }
  // Steps and a porch at the front door.
  const door = i.use?.door ?? null;
  if (i.xf !== null && door !== null) {
    const sw = stationOf(front, i.xf, door.s);
    const porch = b.era >= 1900 && b.era < 1950 && hash01(b.id, 501) < 0.6;
    const rise = Math.max(0, i.frontFloorY - i.g.heightAt(front.ax + front.tx * sw + front.nx * 1.0, front.az + front.tz * sw + front.nz * 1.0));
    if (porch) {
      // A porch: a deck at the floor's height, two posts and a roof of its own sloping to the front, a rail. One in six was closed in, in another siding.
      const pw = Math.min(front.length - 0.6, 3.6);
      const pd = 1.7;
      const s0 = Math.max(0.2, sw - pw / 2);
      const s1 = Math.min(front.length - 0.2, s0 + pw);
      const closed = hash01(b.id, 502) < 0.17;
      const floor = i.frontFloorY;
      wbox(out, front, s0, s1, Math.max(baseY, floor - 0.9), floor + 0.05, 0, pd, CONCRETE, [0.34, 0.26, 0.18]);
      const top = Math.min(i.wallTop - 0.3, floor + 2.5);
      const roof = pickOf(SIDINGS, b.id, 503);
      if (closed) {
        wbox(out, front, s0, s1, floor + 0.05, top - 0.05, 0.02, pd, scaled(roof, 0.9), scaled(roof, 0.9));
        wquad(out, front, s0 + 0.3, floor + 1.0, s1 - 0.3, floor + 1.9, pd + 0.01, [0.5, 0.55, 0.6], undefined, { glow: 0.3 });
        pane(i.glass, front, s0 + 0.3, floor + 1.0, s1 - 0.3, floor + 1.9, pd + 0.03);
      } else {
        for (const s of [s0 + 0.1, s1 - 0.1]) wbox(out, front, s - 0.07, s + 0.07, floor + 0.05, top, pd - 0.2, pd - 0.06, TRIM, TRIM);
        if (full) wbox(out, front, s0, s1, floor + 0.7, floor + 0.78, pd - 0.08, pd, TRIM, TRIM);
      }
      out.poly([wat(front, s0 - 0.15, top, 0), wat(front, s1 + 0.15, top, 0), wat(front, s1 + 0.15, top - 0.35, pd + 0.2), wat(front, s0 - 0.15, top - 0.35, pd + 0.2)], [front.nx * 0.5, 1, front.nz * 0.5], i.vacant ? [0.12, 0.11, 0.1] : [0.13, 0.12, 0.12]);
      out.poly([wat(front, s0 - 0.15, top, 0), wat(front, s0 - 0.15, top - 0.35, pd + 0.2), wat(front, s0 - 0.15, top - 0.35, 0)], [-front.tx, 0, -front.tz], scaled(i.wall, 0.8));
    } else {
      // Steps: as many as the ground needs, in concrete or timber, with a stoop at the top.
      const n = Math.max(1, Math.min(6, Math.round((rise + 0.1) / 0.18)));
      const timber = hash01(b.id, 504) < 0.4;
      for (let k = 0; k < n; k++) wbox(out, front, sw - 0.6, sw + 0.6, i.frontFloorY - (n - k) * (rise / n) - 0.02, i.frontFloorY - (n - k - 1) * (rise / n), 0, 0.3 * (n - k) + 0.1, timber ? [0.34, 0.25, 0.16] : CONCRETE, timber ? [0.4, 0.3, 0.2] : [0.45, 0.45, 0.43]);
    }
  }
  // A chimney, on a pitched roof of a house built before 1980 (a flue: a stove, a furnace): brick, off the ridge's middle.
  if (i.roofKind !== "flat" && i.roofKind !== "shed" && b.era < 1980 && hash01(b.id, 505) < 0.7) {
    const at = (hash01(b.id, 506) - 0.5) * i.L * 1.1;
    const p = i.P(at, 0, i.H);
    i.out.box(p[0], p[2], i.H - 0.4, 1, 0, 0.3, 0.3, 1.5 + hash01(b.id, 507) * 0.5, scaled(BRICK, 0.9 + hash01(b.id, 508) * 0.3), [0.25, 0.23, 0.22]);
  }
  if (full) {
    meterAndConduit(i);
    // The yard's machines of the present day: a heat pump on the side, a propane tank for a house with no gas line.
    const side = refs.findIndex((w, k) => k !== frontAt && !i.blocked[k] && w.nx * front.nx + w.nz * front.nz > -0.5 && w.nx * front.nx + w.nz * front.nz < 0.5);
    if (side >= 0) {
      const w = refs[side] as WallRef;
      if (hash01(b.id, 509) < 0.35) {
        const s = w.length * (0.25 + 0.5 * hash01(b.id, 510));
        const p = wat(w, s, 0, 0.5);
        i.out.box(p[0], p[2], i.g.heightAt(p[0], p[2]), -w.nz, w.nx, 0.4, 0.22, 0.75, [0.72, 0.72, 0.7], [0.6, 0.6, 0.58]);
        i.out.box(p[0] + w.nx * 0.2, p[2] + w.nz * 0.2, i.g.heightAt(p[0], p[2]) + 0.3, -w.nz, w.nx, 0.3, 0.02, 0.4, [0.2, 0.2, 0.22], [0.2, 0.2, 0.22]);
      } else if (hash01(b.id, 511) < 0.3) {
        const s = w.length * (0.2 + 0.6 * hash01(b.id, 512));
        const p = wat(w, s, 0, 1.2);
        const y = i.g.heightAt(p[0], p[2]);
        i.out.prism([p[0] - w.tx * 0.9, y + 0.45, p[2] - w.tz * 0.9], [p[0] + w.tx * 0.9, y + 0.45, p[2] + w.tz * 0.9], 0.4, 6, [0.85, 0.85, 0.82], [0.8, 0.8, 0.78]);
        i.out.box(p[0], p[2], y, w.tx, w.tz, 0.5, 0.04, 0.2, [0.3, 0.3, 0.3], [0.3, 0.3, 0.3]);
      }
    }
  }
  // What the years added or mended.
  addition(i);
  repairs(i, age, neglect);
}

/** The station on a wall (from its start) of the front's station `s`. */
function stationOf(w: WallRef, xf: Xf, s: number): number {
  const x = xf.ox + xf.tx * s;
  const z = xf.oz + xf.tz * s;
  return (x - w.ax) * w.tx + (z - w.az) * w.tz;
}

/** A meter on a side wall and its conduit up to the eave: a grey box at hand height and a pipe, with a service mast. */
function meterAndConduit(i: PartsIn): void {
  const { b, refs, frontAt, out, floorY } = i;
  const k = refs.findIndex((w, j) => j !== frontAt && !i.blocked[j] && w.nx * (refs[frontAt] as WallRef).nx + w.nz * (refs[frontAt] as WallRef).nz > -0.5);
  if (k < 0) return;
  const w = refs[k] as WallRef;
  const s = w.length * (0.55 + 0.35 * hash01(b.id, 513));
  wbox(out, w, s - 0.15, s + 0.15, floorY + 1.3, floorY + 1.8, 0, 0.14, [0.7, 0.7, 0.68], [0.7, 0.7, 0.68]);
  out.prism(wat(w, s, floorY + 1.8, 0.07), wat(w, s, i.wallTop, 0.07), 0.018, 4, [0.45, 0.45, 0.47], null);
  out.prism(wat(w, s, floorY + 1.3, 0.07), wat(w, s, floorY + 0.3, 0.07), 0.018, 4, [0.45, 0.45, 0.47], null);
}

/** A lean-to at the back, or a carport at the side: the one thing an owner added, in a different siding and roof. */
function addition(i: PartsIn): void {
  const { b, refs, frontAt, out } = i;
  const { age } = agingOf(b);
  // The owner of one house in three of before 1990 added to it, in 1970 or after (a roll from its id).
  if (b.kind !== "house" || b.era >= 1990 || hash01(b.id, 520) > 0.34 + 0.2 * age) return;
  const front = refs[frontAt] as WallRef;
  let k = refs.findIndex((w) => w.nx * front.nx + w.nz * front.nz < -0.9);
  if (hash01(b.id, 521) < 0.35) k = refs.findIndex((w, j) => j !== frontAt && Math.abs(w.nx * front.nx + w.nz * front.nz) < 0.1 && !i.blocked[j]);
  if (k < 0 || i.blocked[k]) return;
  const w = refs[k] as WallRef;
  const along = Math.min(w.length * (0.4 + 0.4 * hash01(b.id, 522)), 6);
  const s0 = (w.length - along) * hash01(b.id, 523);
  const s1 = s0 + along;
  const depth = 2.3 + hash01(b.id, 524) * 1.2;
  const top = i.floorY + 2.7;
  const low = i.floorY + 2.3;
  const base = i.baseY;
  const siding = pickOf(SIDINGS, b.id, 525);
  const sf = i.wallSurface(k);
  const layer = hash01(b.id, 526) < 0.5 ? "planks_weathered" : "siding_painted";
  const surf: Surface = { layer, frame: sf.frame, ...(layer === "siding_painted" ? {} : { tint: [0.9, 0.9, 0.9] as Rgb }), wear: 0.12 + 0.3 * age, wearKind: "algae", wear2: 0.1, wearKind2: "grime", streaks2: true };
  const carport = hash01(b.id, 527) < 0.4 && k !== i.frontAt;
  const rc: Rgb = hash01(b.id, 528) < 0.6 ? [0.3, 0.34, 0.38] : [0.2, 0.2, 0.2];
  const roofSurf: Surface = { layer: "roof_metal", frame: sf.frame, tint: [1, 1, 1], wear: 0.25 * age + 0.1, wearKind: "rust", streaks: true };
  const quad = (p: Vec3[], hint: Vec3, col: Rgb, s?: Surface): void => out.poly(p, hint, col, s);
  const g = (s: number, off: number): number => i.g.heightAt(w.ax + w.tx * s + w.nx * off, w.az + w.tz * s + w.nz * off) - 0.3;
  if (carport) {
    // Posts and a roof: open on three sides, at the side of the house.
    for (const [s, off] of [[s0, depth], [s1, depth], [s1, 0.05]] as const) {
      const p = wat(w, s, 0, off);
      i.out.box(p[0], p[2], g(s, off), w.tx, w.tz, 0.06, 0.06, low - g(s, off) + 0.2, [0.3, 0.3, 0.3], [0.3, 0.3, 0.3]);
    }
  } else {
    quad([wat(w, s0, base, depth), wat(w, s1, base, depth), wat(w, s1, low, depth), wat(w, s0, low, depth)], [w.nx, 0, w.nz], siding, surf);
    quad([wat(w, s0, base, 0), wat(w, s0, base, depth), wat(w, s0, low, depth), wat(w, s0, top, 0)], [-w.tx, 0, -w.tz], siding, surf);
    quad([wat(w, s1, base, 0), wat(w, s1, base, depth), wat(w, s1, low, depth), wat(w, s1, top, 0)], [w.tx, 0, w.tz], siding, surf);
    // A window in the end, and a door in the face: they are lit and glassed, never dark.
    const ws = (s0 + s1) / 2;
    wquad(out, w, ws - 0.5, i.floorY + 1.0, ws + 0.5, i.floorY + 1.9, depth + 0.012, [0.55, 0.5, 0.4], undefined, { glow: 0.4 });
    pane(i.glass, w, ws - 0.5, i.floorY + 1.0, ws + 0.5, i.floorY + 1.9, depth + 0.03);
  }
  out.poly([wat(w, s0 - 0.1, top + 0.1, 0), wat(w, s1 + 0.1, top + 0.1, 0), wat(w, s1 + 0.1, low, depth + 0.2), wat(w, s0 - 0.1, low, depth + 0.2)], [w.nx * 0.4, 1, w.nz * 0.4], rc, roofSurf);
}

/** A patch of newer siding where boards were replaced, a section of new roof, and a tarp weighed down on a neglected roof. */
function repairs(i: PartsIn, age: number, neglect: number): void {
  const { b, refs, out } = i;
  if (i.detail !== "full") return;
  // One wall has a patch of siding of another batch: a rectangle where the owner replaced boards (a roll: one wall of one house in four).
  if (b.material === "wood" && hash01(b.id, 530) < 0.28 + 0.2 * age) {
    const k = Math.floor(hash01(b.id, 531) * refs.length);
    const w = refs[k] as WallRef;
    if (!i.blocked[k] && w.length > 3) {
      const s = 0.8 + hash01(b.id, 532) * (w.length - 2.6);
      const sf = i.wallSurface(k);
      const tint: Rgb = hash01(b.id, 533) < 0.5 ? [1.2, 1.18, 1.1] : [0.8, 0.82, 0.85];
      wquad(out, w, s, i.floorY + 0.3 + hash01(b.id, 534) * 0.8, s + 1.1 + hash01(b.id, 535) * 0.9, i.floorY + 1.8 + hash01(b.id, 534) * 0.8, 0.015, scaled(i.wall, 1.15), { ...sf, tint: sf.layer === "siding_painted" ? undefined : tint, wear: 0.02, wear2: 0 });
    }
  }
  // The roof: a patch of newer shingle, or a tarp. A tarp is on a roof that is neglected or that a storm has taken a part of (a roll for one in eight of the old).
  if ((i.roofKind === "gable" || i.roofKind === "hip") && b.kind !== "church") {
    const tarp = hash01(b.id, 536) < 0.06 + 0.1 * neglect + 0.05 * age;
    const patch = !tarp && hash01(b.id, 537) < 0.25 + 0.2 * age;
    if (tarp || patch) {
      const side = hash01(b.id, 538) < 0.5 ? -1 : 1;
      const Se = i.S + 0.35;
      const a = (hash01(b.id, 539) - 0.5) * i.L * 1.2;
      const wd = tarp ? 1.8 + hash01(b.id, 540) * 1.6 : 1.4 + hash01(b.id, 541);
      const s1 = Math.max(-i.L + 0.3, a - wd / 2);
      const s2 = Math.min(i.L - 0.3, a + wd / 2);
      const he = i.wallTop - 0.15;
      const yAt = (t: number): number => he + (i.H - he) * (1 - Math.abs(t) / Se) + 0.03;
      const t0 = side * Se * 0.9;
      const t1 = side * Se * (tarp ? 0.28 : 0.45);
      const col: Rgb = tarp ? pickOf([[0.1, 0.22, 0.5], [0.3, 0.22, 0.12], [0.45, 0.46, 0.48], [0.1, 0.22, 0.5]] as readonly Rgb[], b.id, 542) : scaled([0.13, 0.12, 0.12], 1.5 + hash01(b.id, 543) * 0.4);
      const hint: Vec3 = [i.e2[0] * side * 0.6, 1, i.e2[1] * side * 0.6];
      out.poly([i.P(s1, t0, yAt(t0)), i.P(s2, t0, yAt(t0)), i.P(s2, t1, yAt(t1)), i.P(s1, t1, yAt(t1))], hint, col, tarp ? undefined : { layer: "roof_shingle", frame: { origin: i.P(s1, t0, yAt(t0)), u: [i.P(s2, t0, 0)[0] - i.P(s1, t0, 0)[0], 0, i.P(s2, t0, 0)[2] - i.P(s1, t0, 0)[2]], v: [0, 1, 0] }, tint: [1.5, 1.5, 1.5], wear: 0.02 });
      if (tarp) {
        // Weighed down: a row of old tires and boards along its lower edge.
        for (let k = 0; k < 4; k++) {
          const s = s1 + ((s2 - s1) * (k + 0.5)) / 4;
          const p = i.P(s, t0 + side * -0.1, yAt(t0) + 0.04);
          out.cylinder(p[0], p[2], p[1], 0.22, 0.14, 6, [0.07, 0.07, 0.07], [0.09, 0.09, 0.09]);
        }
      }
    }
  }
}

/** Gutters along the eaves of a pitched roof and a downspout at its corners. */
function gutters(i: PartsIn): void {
  if (i.roofKind !== "gable" && i.roofKind !== "hip" && i.roofKind !== "shed") return;
  const long = i.refs.reduce((m, w, k) => (w.length > (i.refs[m] as WallRef).length ? k : m), 0);
  const gutter: Rgb = hash01(i.b.id, 550) < 0.5 ? [0.62, 0.62, 0.6] : [0.18, 0.12, 0.08];
  i.refs.forEach((w, k) => {
    if (i.blocked[k] || Math.abs(w.length - (i.refs[long] as WallRef).length) > 0.1 && i.roofKind !== "shed") return;
    wbox(i.out, w, -0.3, w.length + 0.3, i.wallTop - 0.2, i.wallTop - 0.08, 0.32, 0.44, gutter, gutter);
    // The downspout: at the end the water runs to, down to the ground.
    const s = hash01(i.b.id * 3 + k, 551) < 0.5 ? 0.15 : w.length - 0.15;
    const p = wat(w, s, 0, 0.06);
    i.out.prism([p[0], i.wallTop - 0.2, p[2]], [p[0], i.g.heightAt(p[0], p[2]) + 0.1, p[2]], 0.03, 4, gutter, null);
  });
}

// ---- Flat roofs
function flatRoofParts(i: PartsIn, full: boolean): void {
  const { b, out } = i;
  const H = i.H + 0.02;
  const hv = (n: number): number => hash01(b.id, n);
  const at = (a: number, c: number): Vec3 => i.P(a * (i.L - 1.2), c * (i.S - 1), H);
  // A hatch to the roof from the stair, and vents of the old plumbing: on every old block.
  const hp = at(hv(560) * 1.6 - 0.8, hv(561) * 1.2 - 0.6);
  out.box(hp[0], hp[2], H, 1, 0, 0.5, 0.5, 0.55, [0.3, 0.3, 0.3], [0.36, 0.36, 0.36]);
  if (!full) return;
  const nVents = 1 + Math.floor(hv(562) * 3);
  for (let k = 0; k < nVents; k++) {
    const p = at(hv(570 + k) * 2 - 1, hv(580 + k) * 2 - 1);
    out.cylinder(p[0], p[2], H, 0.07, 0.8 + hv(590 + k) * 0.6, 6, METAL, [0.2, 0.2, 0.22]);
    out.cylinder(p[0], p[2], H + 0.9 + hv(590 + k) * 0.6, 0.14, 0.06, 6, DARK, DARK);
  }
  // The air handlers of a building remodelled after 1970 (its tenant's heating and cooling): boxes with a fan.
  if (b.era >= 1900 && hv(563) < 0.55) {
    const n = 1 + Math.floor(hv(564) * 2);
    for (let k = 0; k < n; k++) {
      const p = at(hv(600 + k) * 2 - 1, hv(610 + k) * 2 - 1);
      out.box(p[0], p[2], H, 1, 0, 0.8, 0.55, 0.75, [0.6, 0.62, 0.62], [0.5, 0.52, 0.52]);
      out.cylinder(p[0], p[2], H + 0.75, 0.3, 0.04, 8, DARK, [0.15, 0.15, 0.16]);
    }
  }
  fireEscape(i);
}

/** An iron fire escape of an old brick block of three storeys or more: landings at each upper floor, a rail, and stairs between. Only where no wall faces it. */
function fireEscape(i: PartsIn): void {
  const { b } = i;
  if (b.material !== "brick" || b.era >= 1940 || b.storeys < 2 || hash01(b.id, 565) < 0.4) return;
  const front = i.refs[i.frontAt] as WallRef;
  const k = i.refs.findIndex((w, j) => !i.blocked[j] && (hash01(b.id, 566) < 0.5 ? w.nx * front.nx + w.nz * front.nz < -0.9 : Math.abs(w.nx * front.nx + w.nz * front.nz) < 0.1));
  if (k < 0) return;
  const w = i.refs[k] as WallRef;
  if (w.length < 6) return;
  const s0 = 1.5 + hash01(b.id, 567) * (w.length - 4.5);
  const fh = (i.wallTop - i.floorY) / b.storeys;
  const iron: Rgb = [0.1, 0.1, 0.1];
  for (let st = 1; st < b.storeys; st++) {
    const y = i.floorY + st * fh + 0.2;
    wbox(i.out, w, s0, s0 + 2.2, y - 0.05, y, 0, 1.0, iron, [0.12, 0.12, 0.12]);
    i.out.prism(wat(w, s0, y + 1.0, 1.0), wat(w, s0 + 2.2, y + 1.0, 1.0), 0.02, 4, iron, null);
    i.out.prism(wat(w, s0, y, 1.0), wat(w, s0, y + 1.0, 1.0), 0.02, 4, iron, null);
    i.out.prism(wat(w, s0 + 2.2, y, 1.0), wat(w, s0 + 2.2, y + 1.0, 1.0), 0.02, 4, iron, null);
    // The stair to the landing below: a pair of stringers on a slant.
    const yl = y - fh;
    for (const off of [0.15, 0.95]) i.out.prism(wat(w, s0 + 0.2, y, off), wat(w, s0 + 1.8, Math.max(yl, i.floorY + 2.5), off), 0.025, 4, iron, null);
  }
  // The drop ladder at the bottom.
  i.out.prism(wat(w, s0 + 1.8, i.floorY + 2.7, 0.5), wat(w, s0 + 1.8, i.g.heightAt(w.ax + w.tx * (s0 + 1.8), w.az + w.tz * (s0 + 1.8)) + 0.3, 0.5), 0.025, 4, iron, null);
}

// ---- By kind
function kindParts(i: PartsIn, full: boolean, role: LandmarkRole | null): void {
  const { b, out, refs, frontAt } = i;
  const front = refs[frontAt] as WallRef;
  switch (b.kind) {
    case "gas station": gasStation(i); break;
    case "motel": motelWalk(i); break;
    case "church":
      if (role === null && i.roofKind === "gable") {
        // A bell cote over the front gable: a small tower of the wall's own colour with a pointed roof.
        const q = i.P(-i.L * 0.8, 0, i.H);
        out.box(q[0], q[2], i.H - 0.2, 1, 0, 0.45, 0.45, 1.4, scaled(i.wall, 1.1), TRIM);
        const apex: Vec3 = [q[0], i.H + 2.6, q[2]];
        for (const [dx, dz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]] as const) {
          const a: Vec3 = [q[0] + dx * 0.55, i.H + 1.2, q[2] + dz * 0.55];
          const c: Vec3 = [q[0] - dz * 0.55, i.H + 1.2, q[2] + dx * 0.55];
          out.poly([a, c, apex], [dx - dz, 0.6, dz + dx], [0.13, 0.12, 0.12]);
        }
      }
      break;
    case "fire hall": {
      // The hose tower: a square tower at one end of the front, higher than the roof, with a flat cap.
      const w = front;
      const s = w.length * 0.85;
      const p = wat(w, s, 0, 1.0);
      out.box(p[0], p[2], i.baseY, w.tx, w.tz, 1.1, 1.1, i.H + 3.4 - i.baseY, scaled(i.wall, 0.95), [0.2, 0.2, 0.2]);
      break;
    }
    case "bank":
    case "courthouse":
    case "lodge hall":
    case "school":
    case "hotel":
      if (role !== "fbi" && i.xf !== null) {
        // A portico at the door: a slab on two columns, the way a building that means to be taken seriously does it.
        const w = front;
        const s = w.length / 2;
        const top = i.frontFloorY + Math.min(3.4, i.wallTop - i.frontFloorY - 0.4);
        wbox(out, w, s - 2.0, s + 2.0, top, top + 0.3, 0, 1.6, [0.5, 0.48, 0.44], [0.55, 0.53, 0.5], true);
        for (const sg of [-1.7, 1.7]) wbox(out, w, s + sg - 0.15, s + sg + 0.15, i.frontFloorY, top, 1.3, 1.6, [0.52, 0.5, 0.46], [0.52, 0.5, 0.46]);
      }
      break;
    case "warehouse":
    case "mill shed":
    case "cannery":
      if (full && i.roofKind === "gable") {
        // A ridge vent: a low cap along the ridge's middle.
        const a = i.P(-i.L * 0.4, 0, i.H);
        const c = i.P(i.L * 0.4, 0, i.H);
        out.prism([a[0], i.H + 0.15, a[2]], [c[0], i.H + 0.15, c[2]], 0.22, 4, [0.3, 0.3, 0.3], [0.3, 0.3, 0.3]);
      }
      break;
    default:
      break;
  }
}

/** The lot's depth in front of a building's face, metres (0 where there is none): how far a canopy may reach toward the street. */
export function lotDepthOut(g: TownGround, b: Building, xf: Xf): number {
  if (b.lot < 0) return 0;
  const lot = g.plan.lots[b.lot];
  if (lot === undefined) return 0;
  let best = 0;
  for (const v of lot.polygon) best = Math.max(best, (g.anchor.x + v.x - xf.ox) * xf.nx + (g.anchor.z + v.z - xf.oz) * xf.nz);
  return best;
}

/** A gas station: a flat canopy on columns in front of the building, two pump islands under it, each pump with its lit display. */
function gasStation(i: PartsIn): void {
  const { b, xf, out } = i;
  if (xf === null || b.state === "ruin") return;
  const depth = Math.min(6.5, i.lotOut - 1.2);
  if (depth < 3.2) return;
  const W = xf.width;
  const s0 = W * 0.1 - 1;
  const s1 = W * 0.9 + 1;
  const front = i.refs[i.frontAt] as WallRef;
  const ground = i.frontFloorY;
  const top = ground + 4.4;
  const col: Rgb = pickOf([[0.75, 0.75, 0.72], [0.5, 0.1, 0.1], [0.15, 0.3, 0.2]] as readonly Rgb[], b.id, 570);
  wbox(out, front, s0, s1, top, top + 0.55, 0, depth, scaled(col, 0.9), [0.4, 0.4, 0.4], true);
  wbox(out, front, s0, s1, top + 0.25, top + 0.3, depth, depth + 0.02, [0.95, 0.9, 0.8], [0.95, 0.9, 0.8]);
  const cols = [s0 + 0.6, s1 - 0.6];
  for (const s of cols) for (const d of [depth - 0.4]) wbox(out, front, s - 0.2, s + 0.2, ground - 0.1, top, d - 0.2, d + 0.2, [0.7, 0.7, 0.68], [0.7, 0.7, 0.68]);
  const lit = b.state === "open";
  for (const s of [W * 0.3, W * 0.7]) {
    const d = depth * 0.5;
    wbox(out, front, s - 0.9, s + 0.9, ground - 0.1, ground + 0.2, d - 0.5, d + 0.5, [0.55, 0.55, 0.53], [0.6, 0.6, 0.58]);
    for (const sg of [-0.5, 0.5]) {
      wbox(out, front, s + sg - 0.25, s + sg + 0.25, ground + 0.2, ground + 1.5, d - 0.2, d + 0.2, col, scaled(col, 1.1));
      wquad(out, front, s + sg - 0.2, ground + 1.0, s + sg + 0.2, ground + 1.3, d + 0.205, [0.1, 0.1, 0.12], undefined, { glow: lit ? 1.6 : 0.2 });
    }
  }
}

/** A motel: a covered walkway along the front on posts, and the row of doors with a window beside each. */
function motelWalk(i: PartsIn): void {
  const { b, out, glass } = i;
  const front = i.refs[i.frontAt] as WallRef;
  const top = i.frontFloorY + 2.7;
  wbox(out, front, 0, front.length, top, top + 0.25, 0, 1.8, [0.45, 0.4, 0.34], [0.2, 0.2, 0.2], true);
  for (let s = 0.4; s < front.length; s += 3.4) wbox(out, front, s - 0.06, s + 0.06, i.frontFloorY, top, 1.6, 1.72, [0.5, 0.5, 0.5], [0.5, 0.5, 0.5]);
  // The units' doors: numbered, a lit window beside each, every 3.4 m, none where the lobby is.
  const lobby = i.use?.units[0];
  const door: Rgb = pickOf([[0.4, 0.1, 0.08], [0.1, 0.25, 0.3], [0.15, 0.15, 0.17]] as readonly Rgb[], b.id, 571);
  for (let s = 2.2, n = 101; s + 2.4 < front.length; s += 3.4, n++) {
    if (lobby !== undefined && stationOf(front, i.xf as Xf, lobby.s0) - 0.5 < s && s < stationOf(front, i.xf as Xf, lobby.s1) + 0.5) continue;
    wquad(out, front, s, i.frontFloorY, s + 0.95, i.frontFloorY + 2.05, 0.03, door);
    wquad(out, front, s + 0.2, i.frontFloorY + 1.75, s + 0.45, i.frontFloorY + 1.9, 0.04, [0.9, 0.85, 0.7]);
    // The window: a curtained pane lit from inside, in a frame.
    const lit = b.state === "open" && hash01(b.id * 7 + n, 572) < 0.35;
    wquad(out, front, s + 1.3, i.frontFloorY + 0.95, s + 2.2, i.frontFloorY + 1.95, 0.02, lit ? [0.9, 0.75, 0.45] : [0.38, 0.34, 0.3], undefined, { glow: lit ? 1 : 0.2 });
    pane(glass, front, s + 1.3, i.frontFloorY + 0.95, s + 2.2, i.frontFloorY + 1.95, 0.035);
    wquad(out, front, s + 1.25, i.frontFloorY + 0.9, s + 2.25, i.frontFloorY + 0.95, 0.03, [0.7, 0.7, 0.66]);
  }
}
