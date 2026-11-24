/**
 * Every wall's openings: the holes `cutWall` leaves and what fills each. A commercial front is its units (`frontGeometry.ts`); a house's
 * windows and door are the plan's records of the dwelling (`plan.uses[b].windows`, `.door`), each by its treatment; the other walls of a
 * block, and the walls of the buildings the plan has no units for (a church, a hall, a warehouse, a fire hall), have the few, uneven openings
 * of such a wall: small windows at uneven stations, a back door with a light over it, a loading door, a big door, and none at all on a
 * wall that stands against its neighbour.
 *
 * What is authored: the window sizes by age (tall and narrow before 1940, wider and lower after), the loading doors' size, the door colours,
 * the share of windows of a house that an owner replaced with vinyl (three in ten before 1990, a roll per window from the building's id: one
 * owner's remodel, which is why the neighbours do not match), and the pale roll-up shutters. What the plan causes: each window's station, storey,
 * treatment and sill, the door's station, a vacant building's boards.
 */
import { bearingU, bearingV } from "../../sim/town/bearings.js";
import type { Building, BuildingUse, TownPlan, WindowState } from "../../sim/town/types.js";
import { hash01, scaled, type MeshBuilder, type Rgb } from "./meshBuilder.js";
import { cutWall, pane, pickOf, reveal, wat, wbox, wquad, type Hole, type WallRef } from "./buildingKit.js";
import { planFront } from "./frontGeometry.js";
import type { Xf } from "./roomGeometry.js";
import { drawWindow, type WinCtx } from "./windowGeometry.js";
import type { Detail, FillReport, TownGround } from "./townTypes.js";
import type { Surface } from "./townSurface.js";

export type WallPlan = { holes: Hole[]; draws: (() => void)[] };

export type PlanCtx = {
  readonly g: TownGround;
  readonly b: Building;
  readonly use: BuildingUse | undefined;
  readonly walls: readonly WallRef[];
  readonly frontAt: number;
  readonly xf: Xf | null;
  readonly floorY: number;
  /** The floor at the front door: lower than `floorY` where the lot slopes up from the street. Set by the builder after the context is made. */
  frontFloorY: number;
  readonly wallTop: number;
  readonly out: MeshBuilder;
  readonly glass: MeshBuilder;
  readonly detail: Detail;
  readonly wall: Rgb;
  readonly report?: FillReport;
  readonly vacant: boolean;
  readonly profile: "shop" | "house" | "civic" | "industrial" | "church";
  readonly surfaceOf: (w: WallRef, band?: 0 | 1) => Surface;
  /** The height of the wall's foot band over its base, or undefined for no band. */
  readonly bandY?: number;
};

// ---- Which walls stand against a neighbour (nothing is built there that could not be seen).
const GRIDS = new WeakMap<TownPlan, Map<number, number[]>>();
const CELL = 16;
function gridOf(plan: TownPlan, ax: number, az: number): Map<number, number[]> {
  let grid = GRIDS.get(plan);
  if (grid === undefined) {
    const built = new Map<number, number[]>();
    for (const b of plan.buildings) {
      const r = Math.max(b.halfAlong, b.halfAcross) * 1.5;
      for (let x = Math.floor((b.centre.x - r) / CELL); x <= Math.floor((b.centre.x + r) / CELL); x++) {
        for (let z = Math.floor((b.centre.z - r) / CELL); z <= Math.floor((b.centre.z + r) / CELL); z++) {
          const key = x * 4096 + z;
          const list = built.get(key);
          if (list === undefined) built.set(key, [b.id]);
          else list.push(b.id);
        }
      }
    }
    GRIDS.set(plan, built);
    grid = built;
  }
  void ax;
  void az;
  return grid;
}

/** Whether the point (plan x, z) lies in a building other than `self`. */
export function insideOther(plan: TownPlan, self: number, x: number, z: number): boolean {
  const list = gridOf(plan, x, z).get(Math.floor(x / CELL) * 4096 + Math.floor(z / CELL));
  if (list === undefined) return false;
  for (const id of list) {
    if (id === self) continue;
    const o = plan.buildings[id];
    if (o === undefined || o.kind === "pier") continue;
    const u = bearingU(o.bearing);
    const v = bearingV(o.bearing);
    const dx = x - o.centre.x;
    const dz = z - o.centre.z;
    if (Math.abs(dx * u.x + dz * u.z) < o.halfAlong && Math.abs(dx * v.x + dz * v.z) < o.halfAcross) return true;
  }
  return false;
}

/** The walls that look out on nothing: they stand within 0.7 m of another building, at the middle and a quarter along. */
export function blockedWalls(c: PlanCtx): boolean[] {
  const a = c.g.anchor;
  return c.walls.map((w) => {
    let hit = 0;
    for (const k of [0.25, 0.5, 0.75]) {
      const x = w.ax + w.tx * w.length * k + w.nx * 0.7 - a.x;
      const z = w.az + w.tz * w.length * k + w.nz * 0.7 - a.z;
      if (insideOther(c.g.plan, c.b.id, x, z)) hit++;
    }
    return hit >= 2;
  });
}

const DOORS: readonly Rgb[] = [[0.16, 0.09, 0.05], [0.12, 0.2, 0.15], [0.3, 0.1, 0.08], [0.14, 0.14, 0.16], [0.4, 0.36, 0.3], [0.25, 0.3, 0.4]];
const RAINCOLOURS = { shutter: [0.62, 0.64, 0.66] as Rgb };

export function planWalls(c: PlanCtx): WallPlan[] {
  const { b, walls, out, glass, floorY, wallTop, detail, use } = c;
  const plans: WallPlan[] = walls.map(() => ({ holes: [], draws: [] }));
  const blocked = blockedWalls(c);
  const storeys = Math.max(1, b.storeys);
  const fh = (wallTop - floorY) / storeys;
  const old = b.era < 1940;
  const ctxW: WinCtx = { ...(c.report === undefined ? {} : { report: c.report }), out, glass, detail, id: b.id, era: b.era, surface: c.surfaceOf, trim: old ? [0.55, 0.52, 0.46] : [0.68, 0.68, 0.65], wall: c.wall };
  const front = walls[c.frontAt] as WallRef;
  const groundAt = (w: WallRef, s: number): number => c.g.heightAt(w.ax + w.tx * s, w.az + w.tz * s);
  const units = use !== undefined && use.units.length > 0 && c.xf !== null;

  if (units && use !== undefined && c.xf !== null) {
    const f = planFront({ ...(c.report === undefined ? {} : { report: c.report }), out, glass, w: front, xf: c.xf, b, use, floorY: c.frontFloorY, wallTop, detail, wall: c.wall, surface: c.surfaceOf, groundAt: (s) => groundAt(front, s) });
    const p = plans[c.frontAt] as WallPlan;
    p.holes.push(...f.holes);
    p.draws.push(() => f.draw());
  } else if (c.profile === "house" && use !== undefined && c.xf !== null && use.windows.length + (use.door ? 1 : 0) > 0) {
    houseWindows({ ...c, floorY: c.frontFloorY }, plans, blocked, ctxW, fh);
  } else if (c.profile === "industrial") {
    industrialFront({ ...c, floorY: c.frontFloorY }, plans);
  } else {
    plainFront({ ...c, floorY: c.frontFloorY }, plans, ctxW, fh);
  }

  // The other walls: few, uneven openings; a back door; a loading door. Never an even grid, and none against a neighbour.
  walls.forEach((w, i) => {
    if (i === c.frontAt && (plans[i] as WallPlan).holes.length > 0) return;
    if (blocked[i] || w.length < 2.4) return;
    const p = plans[i] as WallPlan;
    const isBack = front.nx * w.nx + front.nz * w.nz < -0.9;
    const seed = b.id * 7 + i;
    const rear = isBack;
    if (c.profile === "house" && use !== undefined && use.windows.length > 0) return;
    // The windows: a few, each at its own station, size and storey; a second storey has fewer.
    const maxN = c.profile === "industrial" ? 2 : c.profile === "church" ? Math.floor(w.length / 3) : Math.min(4, Math.floor(w.length / 4));
    let n = Math.floor(hash01(seed, 461) * (maxN + 1));
    if (c.profile === "church") n = Math.max(2, Math.floor(w.length / 3.2));
    if (units && b.storeys > 1 && !isBack) n = Math.max(n, 1);
    for (let k = 0; k < n; k++) {
      const s = c.profile === "church" ? (w.length * (k + 0.5)) / n : 1 + (w.length - 2) * ((k + hash01(seed * 3 + k, 462) * 0.7) / Math.max(1, n));
      const storey = c.profile === "industrial" ? 0 : Math.min(storeys - 1, Math.floor(hash01(seed * 5 + k, 463) * storeys));
      const ww = c.profile === "church" ? 0.9 : 0.7 + hash01(seed * 7 + k, 464) * 0.5;
      const wh = c.profile === "church" ? 2.4 : c.profile === "industrial" ? 0.8 : 0.9 + hash01(seed * 11 + k, 465) * 0.5;
      const y0 = c.profile === "industrial" ? floorY + 2.6 : floorY + storey * fh + (c.profile === "church" ? 1.2 : 0.95 + hash01(seed * 13 + k, 466) * 0.3);
      if (y0 + wh > wallTop - 0.3) continue;
      if (groundAt(w, s) > y0 - 0.2) continue;
      const hole: Hole = { s0: s - ww / 2, s1: s + ww / 2, y0, y1: y0 + wh };
      if (p.holes.some((h) => h.s0 < hole.s1 + 0.3 && h.s1 > hole.s0 - 0.3)) continue;
      p.holes.push(hole);
      const state = c.vacant ? "boarded" : pickOf(["blinds", "curtained", "dark", "lit", "blinds"] as const, seed * 17 + k, 467);
      p.draws.push(() => drawWindow({ ...ctxW, detail: "low" }, w, hole.s0, hole.s1, hole.y0, hole.y1, c.profile === "industrial" && !c.vacant ? "dark" : state, "none", seed * 19 + k, hash01(seed + k, 468) < 0.25 && b.era > 1960));
    }
    if (rear && w.length > 3) backDoor(c, w, p, seed, floorY);
  });
  return plans;
}

/** A back door of steel with a light over it and a step; and, on a warehouse, a loading door on its dock. */
function backDoor(c: PlanCtx, w: WallRef, p: WallPlan, seed: number, floorY: number): void {
  const { out, b } = c;
  const s = 1.2 + hash01(seed, 470) * (w.length - 2.4);
  const col = pickOf(DOORS, seed, 471);
  const hole: Hole = { s0: s - 0.5, s1: s + 0.5, y0: floorY, y1: floorY + 2.05 };
  if (p.holes.some((h) => h.s0 < hole.s1 + 0.4 && h.s1 > hole.s0 - 0.4)) return;
  p.holes.push(hole);
  p.draws.push(() => {
    reveal(out, w, hole.s0, hole.s1, hole.y0, hole.y1, 0.12, scaled(c.wall, 0.8), [0.4, 0.4, 0.38]);
    wquad(out, w, hole.s0 + 0.02, hole.y0, hole.s1 - 0.02, hole.y1, -0.1, c.vacant ? [0.42, 0.31, 0.18] : col);
    wbox(out, w, hole.s0 - 0.1, hole.s1 + 0.1, hole.y0 - 0.12, hole.y0, 0, 0.5, [0.4, 0.4, 0.38], [0.44, 0.44, 0.42], false);
    // The light over it: a cage lamp, lit while the building is kept.
    wbox(out, w, s - 0.1, s + 0.1, hole.y1 + 0.2, hole.y1 + 0.4, 0, 0.18, [0.2, 0.2, 0.2], [0.9, 0.85, 0.7]);
  });
  if (b.kind === "warehouse" || b.kind === "storefront" || b.kind === "big-box store") {
    const s2 = hole.s1 + 1.6;
    if (s2 + 1.4 < w.length) {
      const dock: Hole = { s0: s2, s1: s2 + 2.4, y0: floorY + 0.9, y1: floorY + 3.0 };
      if (!p.holes.some((h) => h.s0 < dock.s1 + 0.3 && h.s1 > dock.s0 - 0.3)) {
        p.holes.push(dock);
        p.draws.push(() => {
          reveal(out, w, dock.s0, dock.s1, dock.y0, dock.y1, 0.2, [0.3, 0.3, 0.3]);
          wquad(out, w, dock.s0, dock.y0, dock.s1, dock.y1, -0.15, RAINCOLOURS.shutter, { layer: "shutter", frame: c.surfaceOf(w).frame, tint: [0.7, 0.7, 0.7], wear: 0.2, wearKind: "rust" });
          // The dock: a concrete platform at its sill.
          wbox(out, w, dock.s0 - 0.3, dock.s1 + 0.3, c.g.heightAt(w.ax + w.tx * s2 + w.nx * 1.2, w.az + w.tz * s2 + w.nz * 1.2) - 0.1, dock.y0, 0, 1.8, [0.4, 0.4, 0.38], [0.45, 0.45, 0.43]);
        });
      }
    }
  }
}

/** The front of a building with no units and no dwelling records: one door, and windows by the building's kind. */
function plainFront(c: PlanCtx, plans: WallPlan[], ctxW: WinCtx, fh: number): void {
  const { b, walls, frontAt, out, glass, floorY, wallTop, vacant } = c;
  const w = walls[frontAt] as WallRef;
  const p = plans[frontAt] as WallPlan;
  const church = c.profile === "church";
  const dw = church ? 1.8 : 1.1;
  const doorS = w.length / 2 + (hash01(b.id, 480) - 0.5) * (church ? 0 : w.length * 0.3);
  const hole: Hole = { s0: doorS - dw / 2, s1: doorS + dw / 2, y0: floorY, y1: floorY + (church ? 3 : 2.2) };
  p.holes.push(hole);
  p.draws.push(() => {
    reveal(out, w, hole.s0, hole.s1, hole.y0, hole.y1, 0.2, scaled(c.wall, 0.8), [0.4, 0.4, 0.38]);
    if (vacant) wquad(out, w, hole.s0, hole.y0, hole.s1, hole.y1, 0.02, [0.42, 0.31, 0.18], { layer: "plywood", frame: c.surfaceOf(w).frame, tint: [2.2, 2.2, 2.2], wear: 0.2, wearKind: "peel" });
    else {
      const col = pickOf(DOORS, b.id, 481);
      const L = hole.s0 + 0.03;
      const R = hole.s1 - 0.03;
      if (church) {
        wquad(out, w, L, hole.y0, R, hole.y1, -0.18, col);
        wquad(out, w, L, hole.y0 + 1.0, R, hole.y1 - 0.2, -0.15, scaled(col, 0.8));
      } else {
        // The leaf in four pieces round its light, the glass a step behind it.
        wquad(out, w, L, hole.y0, R, hole.y0 + 1.0, -0.18, col);
        wquad(out, w, L, hole.y0 + 1.9, R, hole.y1, -0.18, col);
        wquad(out, w, L, hole.y0 + 1.0, hole.s0 + 0.15, hole.y0 + 1.9, -0.18, col);
        wquad(out, w, hole.s1 - 0.15, hole.y0 + 1.0, R, hole.y0 + 1.9, -0.18, col);
        pane(glass, w, hole.s0 + 0.15, hole.y0 + 1.0, hole.s1 - 0.15, hole.y0 + 1.9, -0.21);
      }
    }
  });
  const spacing = church ? 3.6 : b.kind === "school" || b.kind === "hospital" ? 2.6 : 3.4;
  const n = Math.max(0, Math.floor((w.length - 1.6) / spacing) + 1);
  const ww = church ? 0.85 : 1.0;
  const wh = Math.min(church ? 2.4 : 1.5, fh * 0.55);
  for (let k = 0; k < Math.min(Math.max(1, b.storeys), 4); k++) {
    for (let j = 0; j < n; j++) {
      // Spacing follows the plan of the building but each bay's own: the rhythm drifts a little, as a hand-built wall does.
      const s = w.length / 2 + (j - (n - 1) / 2) * spacing + (hash01(b.id * 3 + j, 482) - 0.5) * 0.5;
      if (k === 0 && Math.abs(s - doorS) < 1.5) continue;
      const y0 = floorY + k * fh + fh * 0.3 + (church ? 0.2 : 0);
      if (y0 + wh > wallTop - 0.25) continue;
      if (c.g.heightAt(w.ax + w.tx * s, w.az + w.tz * s) > y0 - 0.3) continue;
      const hh: Hole = { s0: s - ww / 2, s1: s + ww / 2, y0, y1: y0 + wh };
      p.holes.push(hh);
      const state = vacant ? "boarded" : pickOf(["blinds", "curtained", "lit", "dark", "blinds"] as const, b.id * 5 + j + k, 483);
      p.draws.push(() => drawWindow(ctxW, w, hh.s0, hh.s1, hh.y0, hh.y1, state, "none", k * 9 + j, hash01(b.id * 7 + j, 484) < 0.2 && b.era > 1960));
    }
  }
}

/** A warehouse, mill, cannery, shed or fire hall: a big door at an uneven station, and a few small windows on the sides (the walls loop). */
function industrialFront(c: PlanCtx, plans: WallPlan[]): void {
  const { b, walls, frontAt, out, floorY, wallTop, vacant } = c;
  const w = walls[frontAt] as WallRef;
  const p = plans[frontAt] as WallPlan;
  const dw = Math.min(b.kind === "fire hall" ? 3.4 : 3.6, w.length * 0.6);
  const doorAt = w.length / 2 + (hash01(b.id, 485) - 0.5) * w.length * 0.35;
  const hole: Hole = { s0: doorAt - dw / 2, s1: doorAt + dw / 2, y0: floorY, y1: floorY + Math.min(3.8, wallTop - floorY - 0.5) };
  p.holes.push(hole);
  const bays = b.kind === "fire hall" && w.length > 9 ? 2 : 1;
  p.draws.push(() => {
    reveal(out, w, hole.s0, hole.s1, hole.y0, hole.y1, 0.2, [0.3, 0.3, 0.3]);
    for (let k = 0; k < bays; k++) {
      const a = hole.s0 + ((hole.s1 - hole.s0) * k) / bays + 0.02;
      const e = hole.s0 + ((hole.s1 - hole.s0) * (k + 1)) / bays - 0.02;
      if (vacant) wquad(out, w, a, hole.y0, e, hole.y1, -0.12, [0.42, 0.31, 0.18], { layer: "plywood", frame: c.surfaceOf(w).frame, tint: [2.2, 2.2, 2.2], wear: 0.2, wearKind: "peel" });
      else {
        const sc: Surface = { layer: "shutter", frame: c.surfaceOf(w).frame, tint: b.kind === "fire hall" ? [1.1, 0.5, 0.4] : [0.75, 0.75, 0.75], wear: 0.25, wearKind: "rust", streaks: true };
        wquad(out, w, a, hole.y0, e, hole.y1, -0.12, b.kind === "fire hall" ? [0.6, 0.12, 0.1] : [0.18, 0.2, 0.22], sc);
        if (b.kind === "fire hall") out.poly([wat(w, a + 0.2, hole.y1 - 1.3, -0.1), wat(w, e - 0.2, hole.y1 - 1.3, -0.1), wat(w, e - 0.2, hole.y1 - 0.5, -0.1), wat(w, a + 0.2, hole.y1 - 0.5, -0.1)], [w.nx, 0, w.nz], [0.55, 0.6, 0.62]);
      }
    }
  });
  // A man door beside it.
  const ms = doorAt + dw / 2 + 1.2;
  if (ms + 0.6 < w.length) {
    const md: Hole = { s0: ms - 0.5, s1: ms + 0.5, y0: floorY, y1: floorY + 2.05 };
    p.holes.push(md);
    p.draws.push(() => {
      reveal(out, w, md.s0, md.s1, md.y0, md.y1, 0.12, [0.3, 0.3, 0.3]);
      wquad(out, w, md.s0 + 0.02, md.y0, md.s1 - 0.02, md.y1, -0.1, vacant ? [0.42, 0.31, 0.18] : pickOf(DOORS, b.id, 486));
    });
  }
}

/** A house's windows and door, the plan's records (`plan.uses[b].windows`, `.door`). */
function houseWindows(c: PlanCtx, plans: WallPlan[], blocked: boolean[], ctxW: WinCtx, fh: number): void {
  const { b, walls, out, glass, floorY, wallTop, g } = c;
  const use = c.use as BuildingUse;
  const xf = c.xf as Xf;
  const world = (s: number, d: number): [number, number] => [xf.ox + xf.tx * s - xf.nx * d, xf.oz + xf.tz * s - xf.nz * d];
  const wallOf = (name: WindowState["wall"]): number => walls.findIndex((w) => (name === "front" ? xf.nx : name === "left" ? -xf.tx : xf.tx) * w.nx + (name === "front" ? xf.nz : name === "left" ? -xf.tz : xf.tz) * w.nz > 0.9);
  const stationOn = (i: number, name: WindowState["wall"], s: number): number => {
    const w = walls[i] as WallRef;
    const [x, z] = name === "front" ? world(s, 0) : world(name === "left" ? 0 : xf.width, s);
    return (x - w.ax) * w.tx + (z - w.az) * w.tz;
  };
  const old = b.era < 1940;
  use.windows.forEach((wd, k) => {
    const i = wallOf(wd.wall);
    if (i < 0 || blocked[i]) return;
    const w = walls[i] as WallRef;
    const s = stationOn(i, wd.wall, wd.s);
    // This owner's window: one in about three of the windows of a house of before 1990 were replaced by the owner at some point.
    const replaced = b.era < 1990 && hash01(b.id * 53 + k, 490) < 0.3;
    const ww = (old ? 0.85 : 1.05) * (replaced ? 1.2 : 1);
    const wh = Math.min(old ? 1.5 : 1.3, fh * 0.52) * (replaced ? 0.85 : 1);
    const y0 = floorY + wd.storey * fh + 0.85 + (replaced ? 0.1 : 0);
    if (y0 + wh > wallTop - 0.2) return;
    if (g.heightAt(w.ax + w.tx * s, w.az + w.tz * s) > y0 - 0.25) return;
    const hole: Hole = { s0: s - ww / 2, s1: s + ww / 2, y0, y1: y0 + wh };
    (plans[i] as WallPlan).holes.push(hole);
    (plans[i] as WallPlan).draws.push(() => drawWindow({ ...ctxW, era: replaced ? 2005 : b.era, detail: i === c.frontAt ? ctxW.detail : "low" }, w, hole.s0, hole.s1, hole.y0, hole.y1, wd.state, wd.sill, k, replaced));
  });
  if (use.door !== null) {
    const fi = c.frontAt;
    const w = walls[fi] as WallRef;
    const s = stationOn(fi, "front", use.door.s);
    const hole: Hole = { s0: s - use.door.width / 2, s1: s + use.door.width / 2, y0: floorY, y1: floorY + 2.1 };
    (plans[fi] as WallPlan).holes.push(hole);
    // A door from another decade: a share of the doors are the modern steel door of a later owner, grey or white.
    const other = hash01(b.id, 491) < 0.3;
    (plans[fi] as WallPlan).draws.push(() => {
      reveal(out, w, hole.s0, hole.s1, hole.y0, hole.y1, 0.14, scaled(c.wall, 0.8), [0.4, 0.38, 0.34]);
      if (c.vacant) {
        wquad(out, w, hole.s0, hole.y0, hole.s1, hole.y1, 0.02, [0.42, 0.31, 0.18], { layer: "plywood", frame: c.surfaceOf(w).frame, tint: [2.2, 2.2, 2.2], wear: 0.2, wearKind: "peel" });
        return;
      }
      const col = other ? pickOf([[0.45, 0.45, 0.43], [0.62, 0.62, 0.6], [0.2, 0.25, 0.3]] as readonly Rgb[], b.id, 492) : pickOf(DOORS, b.id, 493);
      const L = hole.s0 + 0.02;
      const R = hole.s1 - 0.02;
      if (other) {
        wquad(out, w, L, hole.y0, R, hole.y1, -0.12, col);
        wquad(out, w, hole.s0 + 0.12, hole.y0 + 0.2, hole.s1 - 0.12, hole.y0 + 0.9, -0.09, scaled(col, 0.85));
        wquad(out, w, hole.s0 + 0.12, hole.y0 + 1.2, hole.s1 - 0.12, hole.y0 + 1.9, -0.09, scaled(col, 0.85));
      } else {
        // A door with a light: the leaf in four pieces round the pane (the pane is not hidden behind a leaf drawn whole), the glass a step behind it.
        wquad(out, w, L, hole.y0, R, hole.y0 + 1.25, -0.12, col);
        wquad(out, w, L, hole.y0 + 1.9, R, hole.y1, -0.12, col);
        wquad(out, w, L, hole.y0 + 1.25, hole.s0 + 0.18, hole.y0 + 1.9, -0.12, col);
        wquad(out, w, hole.s1 - 0.18, hole.y0 + 1.25, R, hole.y0 + 1.9, -0.12, col);
        wquad(out, w, hole.s0 + 0.12, hole.y0 + 0.2, hole.s1 - 0.12, hole.y0 + 0.9, -0.09, scaled(col, 0.85));
        pane(glass, w, hole.s0 + 0.18, hole.y0 + 1.25, hole.s1 - 0.18, hole.y0 + 1.9, -0.15);
      }
      // The handle.
      out.poly([wat(w, hole.s1 - 0.2, hole.y0 + 1.0, -0.1), wat(w, hole.s1 - 0.14, hole.y0 + 1.0, -0.1), wat(w, hole.s1 - 0.14, hole.y0 + 1.06, -0.1), wat(w, hole.s1 - 0.2, hole.y0 + 1.06, -0.1)], [w.nx, 0, w.nz], [0.6, 0.55, 0.3]);
    });
  }
}

/** Cuts every wall around its holes, then draws what fills each. The walls' own surface is `surfaceOf`. */
export function cutWalls(c: PlanCtx, plans: readonly WallPlan[], tops: readonly [number, number][], baseY: number): void {
  c.walls.forEach((w, i) => {
    const p = plans[i] as WallPlan;
    const t = tops[i] as [number, number];
    cutWall(c.out, w, baseY, t[0], t[1], p.holes, c.wall, (band) => c.surfaceOf(w, band), c.bandY);
    for (const d of p.draws) d();
  });
}
