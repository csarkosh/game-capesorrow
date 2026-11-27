/**
 * The soft dark on the ground under and round a parked vehicle. The sky is high cloud, so there is no sun shadow to cast; what a car does
 * make is the dark of the ground it hides from the sky: deepest under the body, and fading out over a hand to half a metre past the sills and
 * bumpers. Without it a car looks set down on the street (the dark patch it had was a ragged stain inside its outline).
 *
 * It is the same kind of sheet as the dark at a wall's foot (`footShade.ts`): see-through, one dark colour, read by `townMaterial.ts` by its
 * seed (`FOOT_SEED`) with the cover taken from the sheet's own v, in the same layer (`shade`) and drawn the same way (`townParts.ts`).
 * One sheet a vehicle, of shared corners in rings round its footprint (a rectangle with rounded corners) from the middle out: v is 1 from the middle to
 * a little inside the outline and falls smoothly to 0 at the outer ring, so there is no edge and no seam.
 *
 * - The ground's height is asked at each corner of the sheet, so it follows a slope and a road's crown. At a curb the road is 15 cm under the
 *   walk, and the sheet climbs it in the one ring that crosses the curb's line (it lies on the curb's face and top there); where the ground
 *   is far from the plane under the vehicle (the end of a deck, a ditch) the corner is held on that plane and is clear, so the dark never
 *   hangs over a drop.
 * - How far it reaches and how deep it is are the vehicle's own: a roll by its id, and its kind and lift (a pickup or a truck, and a car up on
 *   blocks, lets more sky in under it than a sedan does: lighter and wider).
 * - Boat trailers have it too (`trailerShade`), on their own footprint. Only what the plan parks. A vehicle that moves would need the kind that follows a body (`peopleShade.ts`).
 *
 * Full tier only: the low tier has none (as the walls' feet have none).
 */
import type { BoatTrailer, Vehicle } from "../../../sim/town/types.js";
import { hash01, type MeshBuilder, type Vec3 } from "../meshBuilder.js";
import type { TownGround } from "../townTypes.js";
import { FOOT_COLOUR, FOOT_SEED } from "../footShade.js";
import { groundAt, placeOn } from "./kit.js";

/** The sheet lies this much over the ground, metres: a little over the vehicle's own plane under its tyres, which are on the ground. */
export const SHADE_LIFT = 0.03;
/** The corner radius of the footprint's outline, metres. */
const CORNER = 0.5;
/** Segments to a corner, and how many corners the long sides are cut in between (the short sides are not). */
const ARC = 3;
const MIDS = 2;
/** Where the rings stand, metres from the outline (inward is negative): two inside, where it is full, the rest by fractions of the reach. */
const INSIDE = [-(CORNER - 0.05), -0.12];
const OUTSIDE = [0.25, 0.5, 0.75, 1];
/** The dark is full this far inside the outline and eases to nothing at the reach. */
const FULL_DEPTH = 0.15;
/** A corner this far (metres) off the plane under the vehicle is held on the plane and is clear. */
const DROP = 0.35;

/** What the vehicle's kind and lift say of how much sky gets under it: how far the dark reaches past the outline (m) and how deep it is (0 to 1). */
const KIND: Record<Vehicle["kind"], { reach: number; dark: number }> = {
  sedan: { reach: 0.42, dark: 0.94 },
  suv: { reach: 0.47, dark: 0.9 },
  van: { reach: 0.5, dark: 0.88 },
  pickup: { reach: 0.54, dark: 0.82 },
  "work truck": { reach: 0.58, dark: 0.78 },
  camper: { reach: 0.52, dark: 0.82 },
};

/** How far the dark reaches from vehicle `v` and how deep it is: its kind's, moved by a roll on its id; a car on blocks has more sky under it, a derelict on flat tyres less. */
export function vehicleShadeLook(v: Pick<Vehicle, "id" | "kind" | "state">): { reach: number; dark: number } {
  const k = KIND[v.kind];
  const up = v.state === "project" ? 1.25 : v.state === "derelict" ? 0.85 : 1;
  const open = v.state === "project" ? 0.8 : v.state === "derelict" ? 1.08 : 1;
  const reach = k.reach * up * (0.85 + 0.3 * hash01(v.id, 881));
  const dark = Math.min(0.97, k.dark * open * (0.92 + 0.16 * hash01(v.id, 882)));
  return { reach, dark };
}

/** How much of the dark is left at `d` metres out from the outline (negative is inside): 1 inside, 0 at the reach, smooth between. */
export function shadeProfile(d: number, reach: number): number {
  const t = Math.min(1, Math.max(0, (d + FULL_DEPTH) / (reach + FULL_DEPTH)));
  return 1 - t * t * (3 - 2 * t);
}

/** The four corners' arcs of the footprint's rounded rectangle `d` metres out, as points (forward, left) of the vehicle, counter-clockwise: the same count at every `d`. */
function ring(hl: number, hw: number, d: number): [number, number][] {
  const r = CORNER + d;
  const a = hl - CORNER;
  const b = hw - CORNER;
  const out: [number, number][] = [];
  const corners: [number, number, number][] = [[a, b, 0], [-a, b, 0.5], [-a, -b, 1], [a, -b, 1.5]];
  for (const [cx, cz, turns] of corners) {
    for (let i = 0; i <= ARC; i++) {
      const t = (turns + (0.5 * i) / ARC) * Math.PI;
      out.push([cx + r * Math.cos(t), cz + r * Math.sin(t)]);
    }
  }
  return out;
}

/**
 * The corners of the sheet: from the middle out, ring by ring, each ring's corners counter-clockwise from the front left, and the outline at
 * index 0. Points are in the vehicle's frame (forward, left), with the v each carries.
 */
export function shadePoints(hl: number, hw: number, reach: number): { a: number; c: number; v: number }[][] {
  const ds = [...INSIDE, ...OUTSIDE.map((f) => f * reach)];
  return ds.map((d) => {
    const v = Math.sqrt(shadeProfile(d, reach));
    const base = ring(hl, hw, d);
    // The long sides (the first run between corners 0 and 1, and between 2 and 3) are cut into `MIDS + 1` parts.
    const pts: [number, number][] = [];
    const per = ARC + 1;
    for (let k = 0; k < 4; k++) {
      for (let i = 0; i < per; i++) pts.push(base[k * per + i] as [number, number]);
      if (k % 2 === 0) {
        const from = base[k * per + ARC] as [number, number];
        const to = base[((k + 1) % 4) * per] as [number, number];
        for (let m = 1; m <= MIDS; m++) pts.push([from[0] + ((to[0] - from[0]) * m) / (MIDS + 1), from[1] + ((to[1] - from[1]) * m) / (MIDS + 1)]);
      }
    }
    return pts.map(([a, c]) => ({ a, c, v }));
  });
}

/** How far the dark reaches from boat trailer `t` and how deep it is: about a pickup's (the bed stands high and open), lighter still for a bare flat one, rolled by its id. */
export function trailerShadeLook(t: Pick<BoatTrailer, "id" | "boat">): { reach: number; dark: number } {
  const bare = t.boat === "none";
  return { reach: (bare ? 0.5 : 0.54) * (0.85 + 0.3 * hash01(t.id, 883)), dark: Math.min(0.97, (bare ? 0.64 : 0.8) * (0.92 + 0.16 * hash01(t.id, 884))) };
}

/** Lays the dark under `v` into `sheet` (the world's frame: `v.x, v.z` are the plan's, `g.anchor` moves them). */
export function vehicleShade(g: TownGround, sheet: MeshBuilder, v: Vehicle): void {
  laySheet(g, sheet, v, vehicleShadeLook(v));
}

/** The same under a boat trailer, on its own footprint. */
export function trailerShade(g: TownGround, sheet: MeshBuilder, t: BoatTrailer): void {
  laySheet(g, sheet, t, trailerShadeLook(t));
}

function laySheet(g: TownGround, sheet: MeshBuilder, v: { readonly x: number; readonly z: number; readonly hx: number; readonly hz: number; readonly length: number; readonly width: number }, { reach, dark }: { reach: number; dark: number }): void {
  const hl = v.length / 2;
  const hw = v.width / 2;
  // The plane under the vehicle's four ends, with no lift: a vehicle on blocks is raised and the ground is not.
  const pl = placeOn(g, v.x, v.z, v.hx, v.hz, v.length, v.width, 0);
  const rings = shadePoints(hl, hw, reach);
  const points: Vec3[] = [];
  const uvs: [number, number][] = [];
  const at = (a: number, c: number, vee: number): void => {
    const x = pl.ox + pl.fx * a + pl.lx * c;
    const z = pl.oz + pl.fz * a + pl.lz * c;
    const plane = pl.y0 + pl.pitch * a + pl.roll * c;
    const h = groundAt(g, x, z);
    // Far from the plane under the vehicle there is no ground to lie on (past a deck's end, down a ditch): held on the plane and clear.
    const held = Math.abs(h - plane) > DROP;
    points.push([x, (held ? plane : h) + SHADE_LIFT, z]);
    uvs.push([0, held ? 0 : vee]);
  };
  at(0, 0, 1);
  for (const r of rings) for (const p of r) at(p.a, p.c, p.v);
  const n = (rings[0] as unknown[]).length;
  const tris: number[] = [];
  // The middle to the first ring, and each ring to the next.
  for (let i = 0; i < n; i++) tris.push(0, 1 + i, 1 + ((i + 1) % n));
  for (let k = 0; k + 1 < rings.length; k++) {
    const o0 = 1 + k * n;
    const o1 = 1 + (k + 1) * n;
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      tris.push(o0 + i, o1 + i, o1 + j, o0 + i, o1 + j, o0 + j);
    }
  }
  sheet.sheet(points, uvs, tris, [0, 1, 0], FOOT_COLOUR, { clear: 0.5, seed: FOOT_SEED, size: [FOOT_COLOUR[0], FOOT_COLOUR[1]], tilt: [FOOT_COLOUR[2], dark] });
}
