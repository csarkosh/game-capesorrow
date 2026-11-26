/**
 * What stands at the foot of a house's walls, by the household (`houseSeam.ts`): the foundation's own look, and the things that live at the seam.
 *
 * - **The foundation** is not one even band. By the house's era and a roll of its own it is poured concrete (tone changes at the pours, form lines, a
 *   crack), block (a few blocks stained, mortar lines), brick (with a vent) or post and pier with a skirt of boards that are not level, one of them
 *   missing on a house that has been let go, showing dark underneath. Dirt splashes up it from the ground and algae climbs it, each in columns of
 *   different heights, more on the shaded side and on the neglected houses. Every piece follows the ground at its foot (the walls run down to the lowest
 *   ground, so on a slope the foundation shows more at the low end). All of it is paint lying flush on the foundation's face, in ranks (`L`).
 * - **Things at the seam**: one to three a house, mostly at the sides and the back: a hose and its bib, a downspout's splash block with a pipe leading
 *   across the lawn, a stack of firewood, a ladder or a wheelbarrow leaning on the wall, a bucket, a pile of boards, and a crawl-space hatch. Never the
 *   same set on neighbours (a roll of the house's id).
 *
 * Full tier only: the low tier has its drip band (`seamGround.ts`) and its coarse growth.
 */
import { bearingU, bearingV } from "../../sim/town/bearings.js";
import { isClear } from "./faceLedger.js";
import { paintOff } from "./paint.js";
import { wat, type WallRef } from "./buildingKit.js";
import { neglectOf, seamHouses, type HouseSeam } from "./houseSeam.js";
import type { MeshBuilder, Rgb, Vec3 } from "./meshBuilder.js";
import { withMat, type MatRef } from "./materials.js";
import { hash01, scaled } from "./meshBuilder.js";
import type { Sink, TownGround } from "./townTypes.js";

const clamp01 = (x: number): number => Math.max(0, Math.min(1, x));
const CONCRETE: Rgb = [0.3, 0.3, 0.28];
const BRICK: Rgb = [0.2, 0.14, 0.12];
const WOOD: Rgb = [0.3, 0.25, 0.19];
const DARK: Rgb = [0.025, 0.025, 0.03];
/** How far a crawl-space hatch's frame stands off the foundation's face, metres: a real thing, not paint (its door is a step, 3 cm, further out). */
const HATCH_OFF = 0.03;
/** The ranks of paint a foundation's marks are in (`paint.ts`), over the foundation's own face and one over the next: the stretches of its pours and the skirt's dark, then the lines (courses, cracks, the vent, a skirt's boards), then algae, then the splash of mud. They lie flush, 2 mm a rank. */
const L = { base: 1, line: 2, algae: 3, mud: 4 } as const;

type Kind = "concrete" | "block" | "brick" | "pier";

function foundationOf(h: HouseSeam): Kind {
  const b = h.b;
  const r = hash01(b.id, 910);
  if (b.era < 1900) return r < 0.4 ? "pier" : r < 0.65 ? "brick" : r < 0.75 ? "block" : "concrete";
  if (b.era < 1950) return r < 0.4 ? "concrete" : r < 0.7 ? "block" : r < 0.9 ? "pier" : "brick";
  return r < 0.5 ? "concrete" : r < 0.9 ? "block" : "pier";
}

export function seamWall(g: TownGround, solid: Sink): void {
  for (const h of seamHouses()) {
    const b = h.b;
    if (b.kind !== "house") continue;
    const yard = g.plan.yards[b.lot];
    if (yard === undefined) continue;
    const out = solid(g.anchor.x + b.centre.x, g.anchor.z + b.centre.z);
    const neg = neglectOf(g.plan, b);
    foundation(g, h, out, neg);
    things(g, h, out, neg);
    doorstep(h, out, neg);
  }
}

/** Whether another building stands within a metre of this wall's middle (a wall shared or nearly: its own foundation stands where a decal would). */
function neighbourAt(g: TownGround, b: HouseSeam["b"], w: WallRef): boolean {
  const mx = w.ax + w.tx * (w.length / 2) - g.anchor.x;
  const mz = w.az + w.tz * (w.length / 2) - g.anchor.z;
  for (const o of g.plan.buildings) {
    if (o.id === b.id || o.kind === "pier") continue;
    if (Math.abs(o.centre.x - mx) > 40 || Math.abs(o.centre.z - mz) > 40) continue;
    const u = bearingU(o.bearing);
    const v = bearingV(o.bearing);
    for (const off of [0.5, 1, 2]) {
      const px = mx + w.nx * off - o.centre.x;
      const pz = mz + w.nz * off - o.centre.z;
      if (Math.abs(px * u.x + pz * u.z) < o.halfAlong + 0.8 && Math.abs(px * v.x + pz * v.z) < o.halfAcross + 0.8) return true;
    }
  }
  return false;
}

/** What stands at the front door by the household: a mat, then a pot of something, a pair of boots or a broom against the wall (one in a house, a roll of its own); a kept house has the pot and the mat, a let-go one the boots and the broom. */
function doorstep(h: HouseSeam, out: MeshBuilder, neg: number): void {
  const d = h.door;
  const b = h.b;
  if (d === null) return;
  const w = h.refs[h.frontAt] as WallRef;
  const porch = d.porch !== null;
  const depth = d.out;
  if (!porch && depth < 0.4) return;
  const y = d.floorY;
  const at = (s: number, off: number): Vec3 => wat(w, s, y, off);
  // The mat, in front of the door: a low woven rectangle, no underside.
  if (hash01(b.id, 4000) < 0.65 - 0.35 * neg) {
    const c = at(d.s, 0.1 + (Math.min(depth, 0.9) - 0.1) * 0.5);
    const tone = 0.7 + 0.6 * hash01(b.id, 4001);
    withMat("rope", () => out.box(c[0], c[2], y, w.tx, w.tz, 0.32, Math.min(0.25, (depth - 0.1) / 2), 0.025, scaled([0.3, 0.22, 0.14], tone), scaled([0.34, 0.26, 0.16], tone), true, null));
  }
  const r = hash01(b.id, 4010);
  const side = hash01(b.id, 4011) < 0.5 ? -1 : 1;
  const sOff = porch ? Math.min(d.half - 0.5, 0.9) : 0.62;
  if (!porch && r < 0.5) return;
  if (r < 0.5 - 0.3 * neg && porch) {
    // A pot with a plant in it, beside the door.
    const c = at(d.s + side * sOff, 0.35);
    withMat("brick", () => out.cylinder(c[0], c[2], y, 0.15, 0.3, 7, [0.45, 0.2, 0.12], [0.1, 0.07, 0.04], 0.12));
    withMat("plant", () => out.cylinder(c[0], c[2], y + 0.3, 0.1, 0.22, 6, [0.1, 0.22, 0.07], [0.12, 0.26, 0.08], 0.2));
  } else if (r < 0.8) {
    // A pair of boots by the door, one fallen over.
    for (let k = 0; k < 2; k++) {
      const c = at(d.s + side * (sOff + 0.15 * k), 0.3 + 0.12 * k);
      withMat("rubber", () => out.box(c[0], c[2], y, w.tx, w.tz, k === 0 ? 0.05 : 0.13, k === 0 ? 0.13 : 0.05, k === 0 ? 0.22 : 0.1, [0.08, 0.07, 0.05], [0.1, 0.09, 0.06], true, null));
    }
  } else if (porch) {
    // A broom leaning on the wall beside the door.
    const c = at(d.s + side * sOff, 0.2);
    withMat("wood", () => out.prism([c[0] + w.nx * 0.28, y + 0.02, c[2] + w.nz * 0.28], [c[0] + w.nx * 0.06, y + 1.25, c[2] + w.nz * 0.06], 0.012, 4, [0.4, 0.3, 0.17], [0.4, 0.3, 0.17]));
    withMat("rope", () => out.prism([c[0] + w.nx * 0.32, y + 0.02, c[2] + w.nz * 0.32], [c[0] + w.nx * 0.26, y + 0.3, c[2] + w.nz * 0.26], 0.05, 5, [0.5, 0.42, 0.2], [0.5, 0.42, 0.2]));
  }
}

/** The ground's height at a station on a wall, a hand out from its face. */
function groundAt(g: TownGround, w: WallRef, s: number): number {
  const p = wat(w, s, 0, 0.25);
  return g.heightAt(p[0], p[2]);
}

function foundation(g: TownGround, h: HouseSeam, out: MeshBuilder, neg: number): void {
  const b = h.b;
  const kind = foundationOf(h);
  const top = h.foundTop;
  const shop = g.plan.uses.some((u) => u.building === b.id && u.units.some((un) => un.tenant !== null && un.tenant !== undefined));
  h.refs.forEach((w, k) => {
    if (h.blocked[k] || (shop && k === h.frontAt)) return;
    // The wall an addition is built on has its foundation set out a step by the faces of the addition (`faceLedger.ts`): left as it is.
    if (neighbourAt(g, b, w) || h.added?.k === k) return;
    const key = b.id * 41 + k;
    const fo = h.foundOff[k] as number;
    /** How far out a rank of paint lies from the foundation's face. */
    const lie = (rank: number): number => fo + paintOff(rank);
    const north = w.nz > 0.3;
    // A column of the foundation from `s0` to `s1`, over the ground at its feet, up to `y1` (or less), off the wall `off`.
    // The foundation stops at the front door, where the steps or the porch stand (`buildingParts.ts`): so does everything on it.
    const gap: [number, number] | null = k === h.frontAt && h.door !== null ? [h.door.s - h.door.half, h.door.s + h.door.half] : null;
    const inGap = (a: number, e: number): boolean => gap !== null && a < gap[1] && e > gap[0];
    const col = (s0: number, s1: number, rank: number, colour: Rgb, hMax = 9, tilt = 0, mat: MatRef = "concrete"): boolean => {
      if (gap !== null && inGap(s0, s1)) {
        // Cut at the door: what is left of it on either side.
        let any = false;
        if (gap[0] - s0 > 0.1) any = col(s0, gap[0], rank, colour, hMax, tilt, mat) || any;
        if (s1 - gap[1] > 0.1) any = col(gap[1], s1, rank, colour, hMax, tilt, mat) || any;
        return any;
      }
      const ya = groundAt(g, w, s0) - 0.03;
      const yb = groundAt(g, w, s1) - 0.03;
      const t0 = Math.min(top, Math.max(ya, yb) + hMax);
      if (top - Math.max(ya, yb) < 0.07) return false;
      // A fence or its post that stands against the wall keeps the dressing off (its boxes would stand in the same planes).
      const mp = wat(w, (s0 + s1) / 2, 0, 0.15);
      if (fenceWithin(g, mp[0] - g.anchor.x, mp[2] - g.anchor.z, 0.5 + (s1 - s0) / 2)) return false;
      const ta = Math.max(ya + 0.03, Math.min(top, ya + hMax + 0.03) - tilt);
      const tb = Math.max(yb + 0.03, Math.min(top, yb + hMax + 0.03) + tilt);
      void t0;
      // At the wall's foot it sees the sky the wall sees there (`skyShade.ts`): darkest at the ground.
      const sky = h.shade[k];
      const off = lie(rank);
      out.poly([wat(w, s0, ya, off), wat(w, s1, yb, off), wat(w, s1, tb, off), wat(w, s0, ta, off)], [w.nx, 0, w.nz], colour, sky === undefined ? mat : typeof mat === "string" ? { mat, shade: sky } : { ...mat, shade: sky }, { paint: rank });
      return true;
    };
    // The tops over the ground at both feet: at least this, or the wall's foundation does not show here at all.
    const exposed = (s: number): number => top - groundAt(g, w, s);
    // The pours or blocks, in stretches of 0.8 to 1.6 m.
    const stretches: number[] = [0];
    for (let s = 0, i = 0; s < w.length - 0.05; i++) {
      s = Math.min(w.length, s + 2 + 2 * hash01(key, 1100 + i));
      stretches.push(s);
    }
    if (kind === "pier") {
      // The skirt: a dark gap over the whole wall, boards on it, none quite level, one gone on a house that has been let go.
      col(-0.05, w.length + 0.05, L.base, DARK, 9, 0, "soil");
      let missing = false;
      for (let i = 0; i + 1 < stretches.length; i++) {
        const s0 = (stretches[i] as number) + 0.02 + 0.03 * hash01(key, 1200 + i);
        const s1 = (stretches[i + 1] as number) - 0.02 - 0.03 * hash01(key, 1300 + i);
        if (s1 - s0 < 0.2) continue;
        if (!missing && hash01(key, 1400) < 0.2 + 0.6 * neg && hash01(key, 1401 + i) < 0.3) {
          missing = true;
          continue;
        }
        const tone = 0.6 + 0.5 * hash01(key, 1500 + i);
        col(s0, s1, L.line, scaled(WOOD, tone), Math.max(0.12, exposed(s0) - 0.14 * hash01(key, 1650 + i)), 0.12 * (hash01(key, 1600 + i) - 0.5), "wood");
      }
      void exposed;
    } else {
      const base = kind === "brick" ? BRICK : CONCRETE;
      for (let i = 0; i + 1 < stretches.length; i++) {
        const s0 = stretches[i] as number;
        const s1 = stretches[i + 1] as number;
        const tone = kind === "brick" ? 0.8 + 0.4 * hash01(key, 1700 + i) : 0.84 + 0.26 * hash01(key, 1700 + i);
        const tint: Rgb = [base[0] * tone * (0.96 + 0.08 * hash01(key, 1750 + i)), base[1] * tone, base[2] * tone * (0.94 + 0.1 * hash01(key, 1760 + i))];
        col(s0, s1, L.base, tint, 9, 0, kind === "brick" ? "brick" : kind === "block" ? "formed" : "concrete");
      }
      // Courses and form lines: thin dark lines along the whole wall, in runs with gaps, each at its own height over the ground.
      const lineColour = scaled(base, kind === "brick" ? 1.9 : 0.55);
      for (let c = 0; c < (kind === "brick" ? 1 : 0); c++) {
        let s = 0;
        let i = 0;
        while (s < w.length - 0.3) {
          const s1 = Math.min(w.length, s + 1.5 + 2.5 * hash01(key + c, 1900 + i));
          i++;
          const a = s;
          s = s1 + 0.15 + 0.5 * hash01(key + c, 1950 + i);
          if (hash01(key + c, 2000 + i) < 0.45) continue;
          const y0a = groundAt(g, w, a) + 0.1 + 0.15 * c + 0.012 * hash01(key + c, 2050 + i);
          const y0b = groundAt(g, w, s1) + 0.1 + 0.15 * c + 0.012 * hash01(key + c, 2060 + i);
          if (y0a + 0.02 > top || y0b + 0.02 > top || inGap(a, s1)) continue;
          out.poly([wat(w, a, y0a, lie(L.line)), wat(w, s1, y0b, lie(L.line)), wat(w, s1, y0b + 0.014, lie(L.line)), wat(w, a, y0a + 0.014, lie(L.line))], [w.nx, 0, w.nz], lineColour, "brick", { paint: L.line });
        }
      }
      if (kind === "concrete" && hash01(key, 2100) < 0.55) {
        // A crack from the top down, wandering, in four short runs.
        let s = w.length * (0.15 + 0.7 * hash01(key, 2101));
        let y = top - 0.01;
        for (let i = 0; i < 4; i++) {
          const ds = (hash01(key, 2110 + i) - 0.5) * 0.14;
          const dy = 0.05 + 0.04 * hash01(key, 2120 + i);
          if (y - dy < groundAt(g, w, s) + 0.02 || inGap(s - 0.1, s + 0.1)) break;
          out.poly([wat(w, s, y, lie(L.line)), wat(w, s + ds, y - dy, lie(L.line)), wat(w, s + ds + 0.012, y - dy, lie(L.line)), wat(w, s + 0.012, y, lie(L.line))], [w.nx, 0, w.nz], [0.05, 0.05, 0.05], "concrete", { paint: L.line });
          s += ds;
          y -= dy;
        }
      }
      if (kind === "brick") {
        // A vent: a dark grille a hand above the ground.
        const vs = w.length * (0.2 + 0.6 * hash01(key, 2200));
        const g0 = groundAt(g, w, vs);
        if (top - g0 > 0.35 && !inGap(vs, vs + 0.4)) out.poly([wat(w, vs, g0 + 0.17, lie(L.line)), wat(w, vs + 0.4, g0 + 0.17, lie(L.line)), wat(w, vs + 0.4, g0 + 0.33, lie(L.line)), wat(w, vs, g0 + 0.33, lie(L.line))], [w.nx, 0, w.nz], [0.04, 0.04, 0.04], "steel", { paint: L.line });
      }
    }
    // Algae climbs the foundation in uneven columns on the shaded walls and the neglected, and the splash of mud goes up from the ground, higher in some places than others.
    const algae = clamp01((north ? 0.5 : 0.1) + 0.35 * neg);
    for (let s = 0, i = 0; s < w.length - 0.1; i++) {
      const s1 = Math.min(w.length, s + 1.4 + 1.4 * hash01(key, 2300 + i));
      if (hash01(key, 2350 + i) < algae) col(s, s1, L.algae, scaled([0.2, 0.28, 0.13], 0.7 + 0.5 * hash01(key, 2360 + i)), 0.1 + 0.95 * hash01(key, 2370 + i) * (0.45 + 0.55 * algae), 0, "plant");
      s = s1;
    }
    for (let s = 0, i = 0; s < w.length - 0.1; i++) {
      const s1 = Math.min(w.length, s + 0.9 + 1.4 * hash01(key, 2400 + i));
      if (hash01(key, 2430 + i) < 0.5) col(s, s1, L.mud, scaled([0.14, 0.12, 0.1], 0.7 + 0.5 * hash01(key, 2410 + i)), 0.06 + 0.3 * hash01(key, 2420 + i) * (0.6 + 0.9 * neg), 0, "soil");
      s = s1;
    }
  });
  // A crawl-space hatch on one of the walls that is not the front, where the foundation stands tall enough.
  const hk = h.refs.findIndex((w, k) => k !== h.frontAt && !h.blocked[k] && w.length > 2.5);
  if (hk >= 0 && hash01(b.id, 2500) < 0.5) {
    const w = h.refs[hk] as WallRef;
    const s = w.length * (0.2 + 0.6 * hash01(b.id, 2501));
    const g0 = Math.max(groundAt(g, w, s), groundAt(g, w, s + 0.6));
    if (h.foundTop - g0 > 0.45) {
      const y0 = g0 + 0.03;
      const y1 = y0 + 0.4;
      h.occupied.push({ k: hk, s0: s - 0.3, s1: s + 0.95 });
      // A real frame and door over the foundation's paint, so as its own layer: 3 cm and then 6 cm off the foundation's face.
      const o = (h.foundOff[hk] as number) + HATCH_OFF;
      out.poly([wat(w, s - 0.04, y0 - 0.04, o), wat(w, s + 0.64, y0 - 0.04, o), wat(w, s + 0.64, y1 + 0.04, o), wat(w, s - 0.04, y1 + 0.04, o)], [w.nx, 0, w.nz], [0.34, 0.33, 0.3], "painted");
      out.poly([wat(w, s, y0, o + 0.03), wat(w, s + 0.6, y0, o + 0.03), wat(w, s + 0.6, y1, o + 0.03), wat(w, s, y1, o + 0.03)], [w.nx, 0, w.nz], [0.2, 0.17, 0.12], "boards");
    }
  }
}

type Spot = { readonly w: WallRef; readonly k: number; readonly s: number };

/** The things at the seam: one to three, picked by the house's own roll from those its walls have room for. */
function things(g: TownGround, h: HouseSeam, out: MeshBuilder, neg: number): void {
  const b = h.b;
  const walls = h.refs.map((w, k) => ({ w, k })).filter(({ k }) => !h.blocked[k] && k !== h.frontAt && h.refs[k]!.length > 2.2);
  if (walls.length === 0) return;
  const used = new Map<number, [number, number][]>();
  for (const o of h.occupied) used.set(o.k, [...(used.get(o.k) ?? []), [o.s0, o.s1]]);
  const count = 1 + (hash01(b.id, 3000) < 0.12 ? 1 : 0) + (neg > 0.5 && hash01(b.id, 3001) < 0.5 ? 1 : 0);
  const KINDS = ["hose", "drain", "wood", "ladder", "barrow", "bucket", "boards"] as const;
  const picked: string[] = [];
  for (let j = 0; picked.length < count && j < 12; j++) {
    const kind = KINDS[Math.floor(hash01(b.id, 3010 + j) * KINDS.length)] as (typeof KINDS)[number];
    if (picked.includes(kind)) continue;
    // A house with an addition (posts and a roof stood clear of the wall by a rule of their own) keeps its big things off its walls.
    if (h.added !== null && (kind === "wood" || kind === "ladder" || kind === "barrow" || kind === "boards")) continue;
    // Look for a place on the walls, the back and then the sides first by the roll; clear of the faces already hung there and of one another.
    const need = kind === "wood" ? 1.7 : kind === "ladder" ? 0.8 : kind === "barrow" ? 1.0 : kind === "boards" ? 1.9 : kind === "hose" ? 0.9 : kind === "drain" ? 0.7 : 0.4;
    const a = Math.floor(hash01(b.id, 3100 + j) * walls.length);
    let placed = false;
    for (let t = 0; t < walls.length * 3 && !placed; t++) {
      const { w, k } = walls[(a + t) % walls.length] as { w: WallRef; k: number };
      const free = w.length - 1.2 - need;
      if (free < 0) continue;
      const s0 = 0.6 + free * hash01(b.id * 7 + k, 3200 + j + t * 13);
      const taken = used.get(k) ?? [];
      if (taken.some(([x0, x1]) => s0 < x1 + 0.4 && s0 + need > x0 - 0.4)) continue;
      if (!spotClear(g, w, s0, need, kind) || nearAddition(h, w, s0, need)) continue;
      taken.push([s0, s0 + need]);
      used.set(k, taken);
      place(g, h, out, kind, { w, k, s: s0 }, neg, j);
      placed = true;
    }
    if (placed) picked.push(kind);
  }
}

/** Whether a fence run passes within `r` of a point of the plan's frame. */
function fenceWithin(g: TownGround, x: number, z: number, r: number): boolean {
  for (const f of g.plan.props.fences) {
    const dx = f.bx - f.ax;
    const dz = f.bz - f.az;
    const l2 = dx * dx + dz * dz;
    if (l2 < 1e-6) continue;
    const t = Math.max(0, Math.min(1, ((x - f.ax) * dx + (z - f.az) * dz) / l2));
    const qx = f.ax + dx * t - x;
    const qz = f.az + dz * t - z;
    if (qx * qx + qz * qz < r * r) return true;
  }
  return false;
}

/** Whether a fence runs within 0.7 m of a thing's place (its footprint's corners and middle). */
function nearFence(g: TownGround, w: WallRef, s0: number, need: number, depth: number): boolean {
  const ax = g.anchor.x;
  const az = g.anchor.z;
  const pts: [number, number][] = [];
  for (const s of [s0 - 0.1, s0 + need / 2, s0 + need + 0.1]) {
    for (const o of [0.2, depth / 2, depth + 0.1]) {
      const p = wat(w, s, 0, o);
      pts.push([p[0] - ax, p[2] - az]);
    }
  }
  for (const f of g.plan.props.fences) {
    const dx = f.bx - f.ax;
    const dz = f.bz - f.az;
    const l2 = dx * dx + dz * dz;
    if (l2 < 1e-6) continue;
    for (const [x, z] of pts) {
      const t = Math.max(0, Math.min(1, ((x - f.ax) * dx + (z - f.az) * dz) / l2));
      const qx = f.ax + dx * t - x;
      const qz = f.az + dz * t - z;
      if (qx * qx + qz * qz < 0.49) return true;
    }
  }
  return false;
}

/** Whether the thing's place, a metre or so deep, is within reach of the owner's addition (a lean-to built out from another wall, whose end faces it must stand clear of). */
function nearAddition(h: HouseSeam, w: WallRef, s0: number, need: number): boolean {
  const a = h.added;
  if (a === null) return false;
  const aw = h.refs[a.k] as WallRef;
  for (const s of [s0 - 0.2, s0 + need / 2, s0 + need + 0.2]) {
    for (const off of [0.2, 0.9, 1.4, 1.9]) {
      const p = wat(w, s, 0, off);
      const along = (p[0] - aw.ax) * aw.tx + (p[2] - aw.az) * aw.tz;
      const out = (p[0] - aw.ax) * aw.nx + (p[2] - aw.az) * aw.nz;
      if (along > a.s0 - 1 && along < a.s1 + 1 && out > -0.5 && out < a.depth + 1) return true;
    }
  }
  return false;
}

/** Whether the face a thing stands before, and its ends, are clear of the faces hung on the wall (`faceLedger.ts`); and the ground is not too steep. */
function spotClear(g: TownGround, w: WallRef, s0: number, need: number, kind: string): boolean {
  const y0 = groundAt(g, w, s0);
  const depth = kind === "wood" ? 0.9 : kind === "boards" ? 0.6 : kind === "barrow" ? 1.3 : kind === "ladder" ? 1.0 : 0.6;
  const a = wat(w, s0 - 0.1, 0, 0.2);
  const bb = wat(w, s0 + need + 0.1, 0, 0.2);
  const c = wat(w, s0 - 0.1, 0, depth);
  const d = wat(w, s0 + need + 0.1, 0, depth);
  const hi = y0 + (kind === "ladder" ? 2.5 : 1);
  if (nearFence(g, w, s0, need, depth)) return false;
  return isClear(w.nx, w.nz, a[0], a[2], bb[0], bb[2], y0 - 0.1, hi) && isClear(-w.tx, -w.tz, a[0], a[2], c[0], c[2], y0 - 0.1, hi) && isClear(w.tx, w.tz, bb[0], bb[2], d[0], d[2], y0 - 0.1, hi) && isClear(w.nx, w.nz, c[0], c[2], d[0], d[2], y0 - 0.1, hi) && Math.abs(groundAt(g, w, s0 + need) - y0) < 0.35;
}

function place(g: TownGround, h: HouseSeam, out: MeshBuilder, kind: string, at: Spot, neg: number, j: number): void {
  const { w, s } = at;
  const b = h.b;
  const hs = (n: number): number => hash01(b.id * 53 + j, 3300 + n);
  const gy = (sx: number, off: number): number => {
    const p = wat(w, sx, 0, off);
    return g.heightAt(p[0], p[2]);
  };
  const ctr = (sx: number, off: number): Vec3 => wat(w, sx, gy(sx, off), off);
  if (kind === "hose") {
    // A bib on the foundation and a hose coiled under it, its end trailing across the grass.
    const bib = wat(w, s + 0.15, gy(s + 0.15, 0.2) + 0.4, 0.2);
    withMat("steel", () => out.box(bib[0], bib[2], bib[1], w.tx, w.tz, 0.03, 0.05, 0.07, [0.45, 0.38, 0.22], [0.5, 0.42, 0.25]));
    const c = ctr(s + 0.6, 0.45);
    withMat("rubber", () => out.cylinder(c[0], c[2], c[1], 0.2, 0.1, 8, [0.06, 0.2, 0.1], [0.05, 0.16, 0.08], 0.17));
    withMat("rubber", () => out.prism([bib[0] + w.nx * 0.05, bib[1] - 0.02, bib[2] + w.nz * 0.05], [c[0] - w.tx * 0.1, c[1] + 0.1, c[2] - w.tz * 0.1], 0.014, 4, [0.06, 0.2, 0.1], [0.06, 0.2, 0.1]));
    const e = ctr(s + 0.9 + 1.4 * hs(1), 0.9 + 1.6 * hs(2));
    withMat("rubber", () => out.prism([c[0] + w.tx * 0.15, c[1] + 0.04, c[2] + w.tz * 0.15], [e[0], e[1] + 0.03, e[2]], 0.014, 4, [0.06, 0.2, 0.1], [0.06, 0.2, 0.1]));
  } else if (kind === "drain") {
    // A splash block under the downspout, or a pipe that leads the water off across the lawn.
    const c = ctr(s + 0.3, 0.38);
    if (hs(3) < 0.5) {
      withMat("concrete", () => out.box(c[0], c[2], c[1], w.tx, w.tz, 0.28, 0.14, 0.07, [0.5, 0.5, 0.48], [0.55, 0.55, 0.52]));
    } else {
      const e = ctr(s + 0.3 + (hs(4) - 0.5) * 1.5, 2.2 + 2 * hs(5));
      withMat("plastic", () => out.prism([c[0], c[1] + 0.06, c[2]], [e[0], e[1] + 0.05, e[2]], 0.055, 6, [0.07, 0.07, 0.08], [0.07, 0.07, 0.08]));
    }
  } else if (kind === "wood") {
    // A stack of split firewood against the wall, under a tarp on a house that is let go.
    const c = ctr(s + 0.85, 0.5);
    const hgt = 0.6 + 0.3 * hs(6);
    withMat("wood", () => out.box(c[0], c[2], c[1], w.tx, w.tz, 0.72, 0.25, hgt, [0.27, 0.18, 0.1], [0.3, 0.21, 0.12]));
    if (neg > 0.3 || hs(7) < 0.35) withMat("cloth", () => out.box(c[0], c[2], c[1] + hgt, w.tx, w.tz, 0.8, 0.38, 0.05, [0.1, 0.22, 0.45], [0.12, 0.25, 0.5]));
  } else if (kind === "ladder") {
    // A ladder leaning against the wall.
    const base = ctr(s + 0.4, 0.75);
    const top = wat(w, s + 0.4, base[1] + 2.5, 0.09);
    const tone: Rgb = hs(8) < 0.5 ? [0.58, 0.58, 0.6] : [0.4, 0.3, 0.17];
    for (const sd of [-0.2, 0.2]) withMat(hs(8) < 0.5 ? "sheet" : "wood", () => out.prism([base[0] + w.tx * sd, base[1], base[2] + w.tz * sd], [top[0] + w.tx * sd, top[1], top[2] + w.tz * sd], 0.022, 4, tone, tone));
    for (let r = 1; r <= 3; r++) {
      const f = r / 4;
      const px = base[0] + (top[0] - base[0]) * f;
      const py = base[1] + (top[1] - base[1]) * f;
      const pz = base[2] + (top[2] - base[2]) * f;
      withMat(hs(8) < 0.5 ? "sheet" : "wood", () => out.prism([px - w.tx * 0.2, py, pz - w.tz * 0.2], [px + w.tx * 0.2, py, pz + w.tz * 0.2], 0.014, 4, tone, tone));
    }
  } else if (kind === "barrow") {
    // A wheelbarrow tipped against the wall, wheel to the wall: its tray, its wheel and its two handles.
    const c = ctr(s + 0.5, 0.65);
    const col: Rgb = hs(9) < 0.5 ? [0.1, 0.28, 0.12] : [0.35, 0.12, 0.08];
    withMat("steel", () => out.box(c[0], c[2], c[1] + 0.3, w.tx, w.tz, 0.22, 0.4, 0.2, col, [0.06, 0.05, 0.04]));
    const wheel = wat(w, s + 0.5, c[1], 0.3);
    withMat("rubber", () => out.box(wheel[0], wheel[2], wheel[1], w.tx, w.tz, 0.04, 0.14, 0.3, [0.05, 0.05, 0.05], [0.08, 0.08, 0.08]));
    for (const sd of [-0.18, 0.18]) withMat("wood", () => out.prism([c[0] + w.tx * sd + w.nx * 0.35, c[1] + 0.32, c[2] + w.tz * sd + w.nz * 0.35], [c[0] + w.tx * sd + w.nx * 0.95, c[1] + 0.02, c[2] + w.tz * sd + w.nz * 0.95], 0.022, 4, [0.4, 0.3, 0.18], [0.4, 0.3, 0.18]));
  } else if (kind === "bucket") {
    const c = ctr(s + 0.2, 0.4);
    withMat("plastic", () => out.cylinder(c[0], c[2], c[1], 0.15, 0.34, 8, hs(10) < 0.5 ? [0.82, 0.78, 0.7] : [0.7, 0.3, 0.08], [0.06, 0.06, 0.06], 0.17));
  } else {
    // A pile of old boards, lying about, each at its own turn.
    const c = ctr(s + 0.9, 0.45);
    // A stack of boards: a thick pile and a few loose ones on it, each at its own turn (none lies in the plane of the drip band's 4 cm).
    const n = 2 + Math.floor(hs(11) * 3);
    withMat("wood", () => out.box(c[0], c[2], c[1], w.tx, w.tz, 0.85, 0.2, 0.17, [0.34, 0.28, 0.2], [0.36, 0.3, 0.22]));
    for (let i = 0; i < n; i++) {
      const turn = (hs(20 + i) - 0.5) * 0.5;
      const ux = w.tx * Math.cos(turn) + w.nx * Math.sin(turn);
      const uz = w.tz * Math.cos(turn) + w.nz * Math.sin(turn);
      withMat("wood", () => out.box(c[0] + (hs(30 + i) - 0.5) * 0.2, c[2] + (hs(40 + i) - 0.5) * 0.1, c[1] + 0.2 + i * 0.07, ux, uz, 0.8 - 0.2 * hs(50 + i), 0.09, 0.04, scaled([0.38, 0.32, 0.24], 0.7 + 0.5 * hs(60 + i)), scaled([0.4, 0.34, 0.26], 0.7 + 0.5 * hs(60 + i))));
    }
  }
}
