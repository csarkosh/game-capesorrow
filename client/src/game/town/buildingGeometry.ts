/**
 * A building as arrays: a shell on its oriented rectangle (`centre`, `halfAlong`, `halfAcross`, `bearing`), and what the plan says is in it.
 *
 * - **Walls** go from below the lowest ground under the footprint (so no gap shows on a slope) up to the eave, four
 *   flat faces facing outward, cut around their openings (`openingsGeometry.ts`, `buildingKit.ts`): a commercial front is its
 *   units (`frontGeometry.ts`), a house its windows and door (`windowGeometry.ts`), the other walls few and uneven openings. A
 *   building standing on piles (no lot) starts at its deck.
 * - **Roofs** by kind: `flat` has a roof surface and a low parapet round it; `gable` has its ridge along the longer
 *   side and a gable end on each short wall (the ridge of an old wooden one sags); `hip` is a true hip, four faces with a short ridge; `shed` is a single
 *   slope, high at the back, with trapezoid side walls. The pitched roofs overhang the walls by `EAVE` m, with an underside and a board along each edge. A `ruin` is
 *   roofless, lower, and its walls are broken at the top in runs of about a metre, with inner faces and a little rubble.
 * - **Behind the glass** of each unit the plan's room (`roomGeometry.ts`); **signs** from the plan (`shopSigns.ts`); **parts** (`buildingParts.ts`) and
 *   **wear** (`buildingWear.ts`) by kind, age and history.
 * - **Colour** from `material` and the building's id (`vary`): no random call anywhere.
 * - **The sky a wall sees** is baked into its corners (`skyShade.ts`): darker at its foot and under its eave.
 * - **A landmark** carries one touch: the municipal building a flagpole, a portico and a cornice; a church a steeple; the tsunami
 *   refuge is an open platform on legs with stairs; the mill a smokestack.
 */
import { bearingU, bearingV } from "../../sim/town/bearings.js";
import type { Building, BuildingKind, LandmarkRole } from "../../sim/town/types.js";
import { hash01, greyed, scaled, type MeshBuilder, type Rgb, type Vec3 } from "./meshBuilder.js";
import { roofStyle, roofTint, wallStyle, wallTint } from "./buildingSurfaces.js";
import { edgeFrame, groundFrame, wallFrame, type Cut, type Fx, type Shade, type Surface } from "./townSurface.js";
import { SOFFIT_SHADE, flatShade, wallShade, type GroundLine, type RoofPlane } from "./skyShade.js";
import { footShade } from "./footShade.js";
import { cutWall, doorIn, pairedDoors, wallRef, wbox, wquad, type Hole, type WallRef } from "./buildingKit.js";
import { withMat } from "./materials.js";
import { FOOT, roofWear, wallWear, type WallWear } from "./buildingWear.js";
import { blockedWalls, cutWalls, planWalls, type PlanCtx } from "./openingsGeometry.js";
import { wallTone } from "./wallTone.js";
import { roofGear, roofSlopeDecals } from "./roofTone.js";
import { lotDepthOut, partsGeometry, porticoAt, wallMatOf } from "./buildingParts.js";
import type { Xf } from "./roomGeometry.js";
import { signsGeometry } from "./shopSigns.js";
import {
  FLAG_POLE, FLAG_RED, ROOF_METAL, ROOF_SHINGLE, ROOF_TAR, STONE_TRIM, vary, wallColour,
} from "./palette.js";
import type { BuildingExtras, Detail, Sink, TownGround } from "./townTypes.js";

/** How far the windows and doors lie off the wall's face, metres. */
export const PROUD = 0.03;
export const EAVE = 0.35;
/** How deep the board along a pitched roof's edge is (its fascia along the eave, its barge board up the rake), metres. */
export const ROOF_EDGE = 0.16;
/** The underside of a roof's overhang: bare boards, which see the ground and none of the sky (`skyShade.ts`). */
const SOFFIT: Rgb = [0.3, 0.27, 0.22];
const SOFFIT_SKY = flatShade(SOFFIT_SHADE);

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
  "municipal building": "civic",
  courthouse: "civic",
  "tsunami refuge": "civic",
  tavern: "shop",
  "boarding house": "house",
  depot: "industrial",
  "customs house": "civic",
  silo: "industrial",
  garage: "industrial",
  restaurant: "shop",
  "fire hall": "industrial",
  "shake mill": "industrial",
  junkyard: "industrial",
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

/** The few numbers every part of one building is built from. */
export type Frame = {
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

/** Where a building stands and at what heights: its frame, the ground under it, its floor, the floor at the street door and its front wall's frame. */
export type BuildingLevels = {
  readonly f: Frame;
  readonly onPiles: boolean;
  readonly baseY: number;
  readonly floorY: number;
  /** The floor at the street door: the room of a shop on the front is at this height (`openingsGeometry.ts`). */
  readonly frontFloorY: number;
  readonly frontAt: number;
  readonly fr: { readonly x: number; readonly z: number };
  /** The four walls' ends and outward normals: su, sv of the two ends, then the normal. */
  readonly sides: readonly (readonly [number, number, number, number, number, number])[];
  readonly corner: (su: number, sv: number) => [number, number];
  /** The building's front wall frame in the world (`BuildingUse.frame` plus the anchor), or null for a pier. */
  readonly xf: Xf | null;
};

/**
 * The heights a building is drawn at, from the ground under it: the walls' base, the floor, the floor at the street door. One place, so
 * that what is put in a room later (a person) stands on the floor that is drawn.
 */
export function buildingLevels(g: TownGround, b: Building): BuildingLevels {
  const u = bearingU(b.bearing);
  const v = bearingV(b.bearing);
  const f: Frame = { cx: g.anchor.x + b.centre.x, cz: g.anchor.z + b.centre.z, ux: u.x, uz: u.z, vx: v.x, vz: v.z, hu: b.halfAlong, hv: b.halfAcross };
  const onPiles = b.lot === -1;
  const corner = (su: number, sv: number): [number, number] => [f.cx + f.ux * f.hu * su + f.vx * f.hv * sv, f.cz + f.uz * f.hu * su + f.vz * f.hv * sv];

  // The ground under the footprint: the lowest point sets the walls' base, the highest the floor (on sloping ground a
  // building stands on the highest ground under it, its walls running down to the lowest).
  let low = Infinity;
  let high = -Infinity;
  for (const su of [-1, -0.5, 0, 0.5, 1]) {
    for (const sv of [-1, -0.5, 0, 0.5, 1]) {
      const [x, z] = corner(su, sv);
      const h = g.heightAt(x, z);
      low = Math.min(low, h);
      high = Math.max(high, h);
    }
  }
  const deck = onPiles ? g.deckAt(f.cx, f.cz) : 0;
  const baseY = onPiles ? deck : low - 0.3;

  // Which wall is the front: the one whose normal is nearest the lot's front direction.
  const fr = b.front ?? { x: -v.x, z: -v.z };
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

  // The floor: the highest ground under the footprint (never under the base). A building's height is above its floor.
  const floorY = onPiles ? deck + 0.1 : Math.max(baseY + 0.3, high + 0.1);

  // The floor at the street door: the building stands on the highest ground under it, but a front on a slope is entered from the sidewalk.
  const fs = sides[frontAt] as (typeof sides)[number];
  const [ax, az] = corner(fs[0], fs[1]);
  const [bx, bz] = corner(fs[2], fs[3]);
  const fw = wallRef(ax, az, bx, bz, fs[4], fs[5]);
  let frontGround = -Infinity;
  for (let k = 0; k <= 6; k++) frontGround = Math.max(frontGround, g.heightAt(fw.ax + fw.tx * fw.length * (k / 6) + fw.nx * 1.2, fw.az + fw.tz * fw.length * (k / 6) + fw.nz * 1.2));
  const frontFloorY = onPiles ? floorY : Math.max(baseY + 0.3, Math.min(floorY, frontGround + 0.12));

  const use = g.plan.uses[b.id];
  const uf = use?.frame ?? null;
  const xf: Xf | null = uf === null ? null : { ox: g.anchor.x + uf.origin.x, oz: g.anchor.z + uf.origin.z, nx: uf.n.x, nz: uf.n.z, tx: uf.t.x, tz: uf.t.z, width: uf.width, depth: uf.depth };
  return { f, onPiles, baseY, floorY, frontFloorY, frontAt, fr, sides, corner, xf };
}

/** A building's roof: its kind (a ruin has none), its own frame (e1 the long axis, e2 the short, `L` and `S` the half lengths along them), its heights, and the roof as planes. */
export type RoofShape = {
  readonly roofKind: Building["roof"] | "ruin";
  readonly long: boolean;
  readonly e1: [number, number];
  readonly e2: [number, number];
  readonly L: number;
  readonly S: number;
  /** The roof's top: the ridge of a pitched roof, the surface of a flat one. */
  readonly H: number;
  readonly rise: number;
  readonly shedDrop: number;
  readonly wallTop: number;
  /** A shed's high side, along e2: the one away from the front. */
  readonly shedSign: number;
  /** The roof as planes, as `buildingGeometry` lays it: a gable's two slopes, a hip's four, a shed's one. A flat roof lies under its walls' tops and a ruin has none: no planes. */
  readonly planes: readonly RoofPlane[];
  /** Where two planes meet over a wall: a gable end's ridge line. */
  readonly creases: readonly Cut[];
};

/** The roof over a building that stands at `levels`: one place, so that what is drawn and the sky a wall sees under it (`skyShade.ts`) agree. */
export function roofOver(b: Building, levels: BuildingLevels): RoofShape {
  const { f, floorY, fr } = levels;
  const ruin = b.state === "ruin";
  const long = f.hu >= f.hv;
  const e1: [number, number] = long ? [f.ux, f.uz] : [f.vx, f.vz];
  const e2: [number, number] = long ? [f.vx, f.vz] : [f.ux, f.uz];
  const L = long ? f.hu : f.hv;
  const S = long ? f.hv : f.hu;
  const H = floorY + (ruin ? Math.max(2.6, b.height * 0.6) : b.height);
  const roofKind = ruin ? "ruin" : b.roof;
  let rise = 0;
  if (roofKind === "gable" || roofKind === "hip") rise = Math.min(Math.max(S * 0.55, 1.2), 4, Math.max(0.8, H - 2.5));
  const shedDrop = roofKind === "shed" ? Math.min(1.5, Math.max(0.6, H * 0.2)) : 0;
  const wallTop = H - rise;
  // The shed's high side is the one away from the front.
  const shedSign = dot(e2[0], e2[1], fr.x, fr.z) < 0 ? 1 : -1;
  const planes: RoofPlane[] = [];
  const creases: Cut[] = [];
  if (roofKind === "gable" || roofKind === "hip") {
    const he = wallTop - 0.15;
    const fall = (H - he) / (S + EAVE);
    for (const side of [-1, 1]) planes.push({ x: f.cx, z: f.cz, y: H, gx: -fall * side * e2[0], gz: -fall * side * e2[1] });
    if (roofKind === "gable") {
      // A gable end is under both slopes, which meet over its middle: the ridge's line.
      creases.push([e2[0], 0, e2[1], -(e2[0] * f.cx + e2[1] * f.cz)]);
    } else {
      const r = Math.max(0.2, L - S);
      const endFall = (H - he) / (L + EAVE - r);
      for (const end of [-1, 1]) planes.push({ x: f.cx, z: f.cz, y: H + endFall * r, gx: -endFall * end * e1[0], gz: -endFall * end * e1[1] });
    }
  } else if (roofKind === "shed") {
    const climb = (shedDrop + 0.2) / (2 * (S + EAVE));
    planes.push({ x: f.cx, z: f.cz, y: H - shedDrop / 2, gx: climb * shedSign * e2[0], gz: climb * shedSign * e2[1] });
  }
  return { roofKind, long, e1, e2, L, S, H, rise, shedDrop, wallTop, shedSign, planes, creases };
}

export function buildingGeometry(g: TownGround, b: Building, role: LandmarkRole | null, sink: Sink, detail: Detail, extra?: BuildingExtras): void {
  const levels = buildingLevels(g, b);
  const { f, onPiles, baseY, floorY, frontAt, sides, corner, xf, frontFloorY } = levels;
  const out = sink(f.cx, f.cz);
  const glass = extra === undefined ? out : extra.glass(f.cx, f.cz);
  const haze = extra?.haze?.(f.cx, f.cz);
  const ruin = b.state === "ruin";
  const vacant = b.state === "vacant";
  const walls: Wall[] = [];

  // The roof's own frame (e1 the long axis, e2 the short), its heights, and its planes (`roofOver`).
  const { roofKind, long, e1, e2, L, S, H, rise, shedDrop, wallTop, shedSign, planes: roofPlanes, creases } = roofOver(b, levels);
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

  // ---- Surfaces: the walls' texture, from the plan's material; its frame runs along the wall and up from the base, the
  // walls end to end round the building (a, b, c, d in the order round) so the courses meet at the corners.
  const style = wallStyle(b);
  const around = [0, 2, 1, 3];
  const alongAt: number[] = [0, 0, 0, 0];
  let run = 0;
  for (const i of around) {
    alongAt[i] = run;
    run += (walls[i] as Wall).length;
  }
  const frameOf = (i: number, turned: boolean): Surface["frame"] => {
    const w = walls[i] as Wall;
    return wallFrame(w.ax, w.az, (w.bx - w.ax) / w.length, (w.bz - w.az) / w.length, baseY, alongAt[i] as number, turned);
  };
  const wears: (WallWear | undefined)[] = [];

  // ---- The sky each wall sees (`skyShade.ts`): darker at its foot, along the ground it stands on, and under the roof that overhangs it (`roofOver`'s planes).
  const shades: (Shade | undefined)[] = [];
  const shadeOf = (i: number): Shade => {
    const w = walls[i] as Wall;
    const tx = (w.bx - w.ax) / w.length;
    const tz = (w.bz - w.az) / w.length;
    // The ground just outside the wall, near each end (a building on piles stands on its deck): a straight line between the two.
    const groundAt = (s: number): number => (onPiles ? baseY : Math.max(baseY, g.heightAt(w.ax + tx * s + w.nx * 0.4, w.az + tz * s + w.nz * 0.4)));
    const s0 = Math.min(0.5, w.length / 4);
    const s1 = w.length - s0;
    const y0 = groundAt(s0);
    const rise = (groundAt(s1) - y0) / (s1 - s0);
    const line: GroundLine = { ax: w.ax, az: w.az, tx, tz, y: y0 - rise * s0, rise };
    return (shades[i] ??= wallShade(line, roofPlanes, creases));
  };
  // The ground at the walls' feet is darker with them (`footShade.ts`).
  const shadeSink = extra?.shade?.(f.cx, f.cz);
  if (shadeSink !== undefined) footShade(g, shadeSink, b, walls, onPiles, baseY);
  const wallSurface = (i: number, band: 0 | 1 = 1): Surface => {
    const w = walls[i] as Wall;
    const wear = (wears[i] ??= wallWear(b, style, w.nx, w.nz, baseY));
    return {
      layer: style.layer,
      frame: frameOf(i, style.turned),
      ...(style.paint ? {} : { tint: wallTint(b) }),
      ...(band === 0 ? wear.foot : wear.upper),
      shade: shades[i] ?? shadeOf(i),
    };
  };

  if (role === "tsunami refuge") {
    withMat("concrete", () => refugeGeometry(g, f, b, out, baseY, H, walls, frontAt, floorY));
    return;
  }

  // ---- the walls, cut around their openings (`openingsGeometry.ts`); a ruin's are broken instead
  const refs: WallRef[] = walls.map((w) => wallRef(w.ax, w.az, w.bx, w.bz, w.nx, w.nz));
  const use = g.plan.uses[b.id];
  const planCtx: PlanCtx = {
    g, b, use, walls: refs, frontAt, xf, portico: porticoAt(b, role, xf !== null, refs[frontAt] as WallRef), floorY, frontFloorY, wallTop, out, glass, detail, wall, vacant, profile: PROFILE[b.kind], ...(extra?.report === undefined ? {} : { report: extra.report }), ...(haze === undefined ? {} : { haze }), ...(extra?.through === true ? { through: true } : {}),
    surfaceOf: (r, band) => wallSurface(refs.indexOf(r), band), bandY: baseY + FOOT,
  };
  let drawSigns = (): void => {};
  let laterTone = (): void => {};
  if (ruin) {
    for (const w of walls) brokenWall(out, w, baseY, floorY, H, wall, inner, b.id, wallSurface(walls.indexOf(w)));
  } else {
    const plans = planWalls(planCtx);
    const tops = walls.map((w): [number, number] => [w.topA, w.topB]);
    cutWalls(planCtx, plans, tops, baseY);
    laterTone = () => wallTone({ out, b, walls: refs, holes: plans.map((p) => p.holes), tops, baseY, colour: wall, surfaceOf: (w, band) => wallSurface(refs.indexOf(w), band), frontAt, low: detail === "low", paint: style.paint });
    // The signs are drawn once the building's parts are (below), so each is put where no face of the wall's is within 2.45 cm of it (`faceLedger.ts`).
    if (extra !== undefined && use !== undefined && xf !== null) {
      const sign = extra.sign(f.cx, f.cz);
      drawSigns = () => signsGeometry({ solid: out, face: sign, g, b, use, xf, atlas: extra.atlas, floorY: planCtx.frontFloorY, wallTop, detail, ...(extra.through === true ? { through: true } : {}) });
    }
  }

  // ---- the roof
  const P = (s1: number, s2: number, y: number): Vec3 => [f.cx + e1[0] * s1 + e2[0] * s2, y, f.cz + e1[1] * s1 + e2[1] * s2];
  // A roof's texture: shingles and ribs run along the eave and down the slope; a flat roof's lies on the world's x and z.
  const roofLook = roofKind === "ruin" ? null : roofStyle(b, roofKind);
  const roofPaint = roofLook?.layer === "roof_shingle";
  // A roof's wear follows the slope: mossy on the north side, dry on the south, rusting in streaks where it is metal (`buildingWear.ts`).
  const roofSurface = (frame: Surface["frame"], nx = 0, nz = 0): Surface | undefined =>
    roofLook === null || roofKind === "ruin" ? undefined : { layer: roofLook.layer, frame, ...(roofPaint ? {} : { tint: roofTint(b) }), ...roofWear(b, roofKind, roofLook.layer === "roof_metal", nx, nz) };
  // A pitched roof has edges: its underside (seen from the street under the overhang, where a sheet with one face showed the sky), and a board
  // hanging from each edge, the fascia along an eave and the barge board up a rake, so the roof reads as a thing with thickness.
  const under = (surface: Surface | undefined): Fx | undefined =>
    surface === undefined ? undefined : { back: { colour: SOFFIT, surface: { layer: "planks_weathered", frame: surface.frame, tint: [0.85, 0.85, 0.85], shade: SOFFIT_SKY } } };
  const edgeTrim: Rgb = scaled(b.material === "wood" ? vary([0.6, 0.6, 0.56], b.id, 9) : scaled(roofColour, 0.75), vacant ? 0.8 : 1);
  // A board has a thickness: its inner face stands 3 cm in from its outer one. Two roofs that meet edge to edge (attached buildings a pair of
  // eaves apart) would otherwise have one's outer face and the other's inner face in one plane, looking the same way.
  // Where another building stands against the wall a board's end reaches past (`blockedWalls`: within 0.7 m, a pair of eaves), the two
  // roofs' overhangs run into each other, and their boards along one line would lie in one plane: the board stops at its own wall there.
  const shut = blockedWalls(planCtx);
  const shutToward = (dx: number, dz: number): boolean => walls.some((w, k) => shut[k] === true && w.nx * dx + w.nz * dz > 0.9);
  const edgeBoard = (p0: Vec3, q0: Vec3, hint: Vec3): void => {
    const hx = q0[0] - p0[0];
    const hz = q0[2] - p0[2];
    const run = Math.sqrt(hx * hx + hz * hz);
    const along = (a: Vec3, b: Vec3, t: number): Vec3 => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
    const trim = run > 2 * EAVE + 0.1;
    const p = trim && shutToward(-hx / run, -hz / run) ? along(p0, q0, EAVE / run) : p0;
    const q = trim && shutToward(hx / run, hz / run) ? along(q0, p0, EAVE / run) : q0;
    out.poly([p, q, [q[0], q[1] - ROOF_EDGE, q[2]], [p[0], p[1] - ROOF_EDGE, p[2]]], hint, edgeTrim, "painted");
    const pi: Vec3 = [p[0] - hint[0] * 0.03, p[1], p[2] - hint[2] * 0.03];
    const qi: Vec3 = [q[0] - hint[0] * 0.03, q[1], q[2] - hint[2] * 0.03];
    out.poly([qi, pi, [pi[0], pi[1] - ROOF_EDGE, pi[2]], [qi[0], qi[1] - ROOF_EDGE, qi[2]]], [-hint[0], 0, -hint[2]], scaled(edgeTrim, 0.7), "painted");
  };
  if (roofKind === "flat") {
    const inset = 0.3;
    out.poly([P(-L + inset, -S + inset, H), P(L - inset, -S + inset, H), P(L - inset, S - inset, H), P(-L + inset, S - inset, H)], [0, 1, 0], roofColour, roofSurface(groundFrame(g.anchor)));
    // The parapet's inner faces, and its top.
    const e: [number, number][] = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
    for (let i = 0; i < 4; i++) {
      const [sa, ta] = e[i] as [number, number];
      const [sb, tb] = e[(i + 1) % 4] as [number, number];
      const a = P(sa * (L - inset), ta * (S - inset), H);
      const c = P(sb * (L - inset), tb * (S - inset), H);
      // The inner face looks into the roof: toward its centre from the middle of the edge it stands on.
      const hintIn: Vec3 = [f.cx - (a[0] + c[0]) / 2, 0, f.cz - (a[2] + c[2]) / 2];
      out.poly([a, c, [c[0], H + 0.5, c[2]], [a[0], H + 0.5, a[2]]], hintIn, inner, wallMatOf(b.material));
      const ao = P(sa * L, ta * S, H + 0.5);
      const co = P(sb * L, tb * S, H + 0.5);
      out.poly([ao, co, [c[0], H + 0.5, c[2]], [a[0], H + 0.5, a[2]]], [0, 1, 0], wall, wallMatOf(b.material));
    }
  } else if (roofKind === "gable") {
    const Le = L + EAVE;
    const Se = S + EAVE;
    const he = wallTop - 0.15;
    for (const side of [-1, 1]) {
      const a = P(-Le, side * Se, he);
      const fr = roofSurface(edgeFrame(a, P(Le, side * Se, he), P(-Le, 0, H)), e2[0] * side, e2[1] * side);
      if (b.era < 1925 && b.material === "wood") {
        // The ridge of a roof of a hundred years sags between its walls: an old frame's own settling.
        const sag = 0.08 + hash01(b.id, 65) * 0.14;
        const mid = P(0, 0, H - sag);
        const eaveMid = P(0, side * Se, he - sag * 0.35);
        const hint: Vec3 = [e2[0] * side * 0.6, 1, e2[1] * side * 0.6];
        out.poly([a, eaveMid, mid, P(-Le, 0, H)], hint, roofColour, fr, under(fr));
        out.poly([eaveMid, P(Le, side * Se, he), P(Le, 0, H), mid], hint, roofColour, fr, under(fr));
        edgeBoard(a, eaveMid, [e2[0] * side, 0, e2[1] * side]);
        edgeBoard(eaveMid, P(Le, side * Se, he), [e2[0] * side, 0, e2[1] * side]);
      } else {
        out.poly([a, P(Le, side * Se, he), P(Le, 0, H), P(-Le, 0, H)], [e2[0] * side * 0.6, 1, e2[1] * side * 0.6], roofColour, fr, under(fr));
        edgeBoard(a, P(Le, side * Se, he), [e2[0] * side, 0, e2[1] * side]);
        roofSlopeDecals(out, b, [a, P(Le, side * Se, he), P(Le, 0, H), P(-Le, 0, H)], fr, e2[0] * side, e2[1] * side, roofColour, side, detail === "low");
      }
    }
    // The barge boards up each rake.
    for (const end of [-1, 1]) for (const side of [-1, 1]) edgeBoard(P(end * Le, side * Se, he), P(end * Le, 0, H), [e1[0] * end, 0, e1[1] * end]);
    // The gable ends, on the short walls: the wall's own texture, carried up from the wall below.
    for (const end of [-1, 1]) {
      const i = walls.findIndex((w) => dot(w.nx, w.nz, e1[0] * end, e1[1] * end) > 0.9);
      out.poly([P(end * L, -S, wallTop), P(end * L, S, wallTop), P(end * L, 0, H)], [e1[0] * end, 0, e1[1] * end], wall, i < 0 ? undefined : wallSurface(i));
    }
  } else if (roofKind === "hip") {
    const Le = L + EAVE;
    const Se = S + EAVE;
    const he = wallTop - 0.15;
    const r = Math.max(0.2, L - S);
    for (const side of [-1, 1]) {
      const a = P(-Le, side * Se, he);
      const hipSurface = roofSurface(edgeFrame(a, P(Le, side * Se, he), P(-r, 0, H)), e2[0] * side, e2[1] * side);
      out.poly([a, P(Le, side * Se, he), P(r, 0, H), P(-r, 0, H)], [e2[0] * side * 0.6, 1, e2[1] * side * 0.6], roofColour, hipSurface, under(hipSurface));
      edgeBoard(a, P(Le, side * Se, he), [e2[0] * side, 0, e2[1] * side]);
      roofSlopeDecals(out, b, [a, P(Le, side * Se, he), P(r, 0, H), P(-r, 0, H)], hipSurface, e2[0] * side, e2[1] * side, roofColour, side, detail === "low");
    }
    for (const end of [-1, 1]) {
      const a = P(end * Le, -Se, he);
      const endSurface = roofSurface(edgeFrame(a, P(end * Le, Se, he), P(end * r, 0, H)), e1[0] * end, e1[1] * end);
      out.poly([a, P(end * Le, Se, he), P(end * r, 0, H)], [e1[0] * end * 0.6, 1, e1[1] * end * 0.6], scaled(roofColour, 0.92), endSurface, under(endSurface));
      edgeBoard(a, P(end * Le, Se, he), [e1[0] * end, 0, e1[1] * end]);
    }
  } else if (roofKind === "shed") {
    const Le = L + EAVE;
    const Se = S + EAVE;
    const low0 = P(-Le, -shedSign * Se, H - shedDrop - 0.1);
    const shedSurface = roofSurface(edgeFrame(low0, P(Le, -shedSign * Se, H - shedDrop - 0.1), P(-Le, shedSign * Se, H + 0.1)), -e2[0] * shedSign, -e2[1] * shedSign);
    out.poly([P(-Le, shedSign * Se, H + 0.1), P(Le, shedSign * Se, H + 0.1), P(Le, -shedSign * Se, H - shedDrop - 0.1), low0], [-e2[0] * shedSign * 0.4, 1, -e2[1] * shedSign * 0.4], roofColour, shedSurface, under(shedSurface));
    edgeBoard(low0, P(Le, -shedSign * Se, H - shedDrop - 0.1), [-e2[0] * shedSign, 0, -e2[1] * shedSign]);
    edgeBoard(P(-Le, shedSign * Se, H + 0.1), P(Le, shedSign * Se, H + 0.1), [e2[0] * shedSign, 0, e2[1] * shedSign]);
    for (const end of [-1, 1]) edgeBoard(P(end * Le, -shedSign * Se, H - shedDrop - 0.1), P(end * Le, shedSign * Se, H + 0.1), [e1[0] * end, 0, e1[1] * end]);
    roofSlopeDecals(out, b, [P(-Le, shedSign * Se, H + 0.1), P(Le, shedSign * Se, H + 0.1), P(Le, -shedSign * Se, H - shedDrop - 0.1), low0], shedSurface, -e2[0] * shedSign, -e2[1] * shedSign, roofColour, 0, detail === "low");
  }

  // ---- an antenna or a dish on the ridge
  if (!ruin && !onPiles && b.kind === "house" && (roofKind === "gable" || roofKind === "hip")) {
    const s1 = L * (0.25 + 0.5 * hash01(b.id, 6172)) * (hash01(b.id, 6173) < 0.5 ? 1 : -1);
    const pt = P(s1, 0, H);
    roofGear(out, b, pt[0], pt[1], pt[2], 0, detail === "low");
  }

  // ---- the parts that are not the shell: porches, chimneys, additions, rooftop units, canopies, by the building's kind and its own history (`buildingParts.ts`)
  if (!ruin && !onPiles) {
    partsGeometry({
      g, b, role, out, glass, detail, refs, frontAt, use, xf, floorY, frontFloorY: planCtx.frontFloorY, baseY, wallTop, H,
      roofKind: roofKind as "flat" | "gable" | "hip" | "shed", rise, P, L, S, e2, wall, blocked: blockedWalls(planCtx), vacant, wallSurface,
      lotOut: xf === null ? 0 : lotDepthOut(g, b, xf),
    });
  }

  drawSigns();
  // The wall's tone at the scale of metres (a dark lower third, patches, a ghost sign; `wallTone.ts`), after everything that hangs on the wall, so it is put clear of those and they of nothing of it.
  laterTone();

  // ---- ruins: rubble inside the walls
  if (ruin) {
    // Each lump lies clear of the ones before it (a lump dropped on another is tried again with another draw, and given up after a few): two boxes that meet have faces a hair apart.
    const lumps: { x: number; z: number; r: number }[] = [];
    for (let k = 0; k < 4; k++) {
      for (let t = 0; t < 5; t++) {
        const su = (hash01(b.id, 40 + k + 100 * t) - 0.5) * 1.5 * (f.hu - 1);
        const sv = (hash01(b.id, 50 + k + 100 * t) - 0.5) * 1.5 * (f.hv - 1);
        const x = f.cx + f.ux * su + f.vx * sv;
        const z = f.cz + f.uz * su + f.vz * sv;
        const h = 0.3 + hash01(b.id, 60 + k) * 0.5;
        const half = 0.4 + hash01(b.id, 70 + k) * 0.5;
        const r = half * 1.3;
        if (lumps.some((q) => (q.x - x) * (q.x - x) + (q.z - z) * (q.z - z) < (q.r + r + 0.1) * (q.r + r + 0.1))) continue;
        lumps.push({ x, z, r });
        withMat(wallMatOf(b.material), () => out.box(x, z, g.heightAt(x, z) - 0.1, f.ux, f.uz, half, half * 0.8, h + 0.1, inner, scaled(inner, 0.8)));
        break;
      }
    }
  }

  // ---- (the doors and windows are drawn with the walls: a ruin keeps its broken wall and the sky through it)

  // The street door of the ground floor, where a unit holds it (the one nearest the middle): a portico belongs over that door, not the wall's middle.
  let streetDoor: number | null = null;
  if (use !== undefined && xf !== null) {
    const mid = xf.width / 2;
    for (const u of use.units) if (streetDoor === null || Math.abs(u.door.s - mid) < Math.abs(streetDoor - mid)) streetDoor = u.door.s;
  }
  landmarkTouch(g, role, f, b, out, walls, frontAt, e1, e2, L, S, wallTop, H, floorY, baseY, streetDoor);
}

/** A ruin's wall: runs of about a metre, each to its own height, an inner face, and the top of each run left open. */
function brokenWall(out: MeshBuilder, w: Wall, baseY: number, floorY: number, H: number, colour: Rgb, inner: Rgb, id: number, surface: Surface): void {
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
    out.poly([[a[0], baseY, a[2]], [b[0], baseY, b[2]], [b[0], top, b[2]], [a[0], top, a[2]]], out3, colour, surface);
    out.poly([[a[0], baseY, a[2]], [b[0], baseY, b[2]], [b[0], top, b[2]], [a[0], top, a[2]]], in3, inner, surface);
  }
}

/** The one distinguishing touch of a landmark's building. */
function landmarkTouch(
  g: TownGround, role: LandmarkRole | null, f: Frame, b: Building, out: MeshBuilder, walls: readonly Wall[], frontAt: number,
  e1: [number, number], e2: [number, number], L: number, S: number, wallTop: number, H: number, floorY: number, baseY: number, streetDoor: number | null,
): void {
  if (role === null || b.state === "ruin") return;
  const w = walls[frontAt] as Wall;
  const tx = (w.bx - w.ax) / w.length;
  const tz = (w.bz - w.az) / w.length;
  const mid: [number, number] = [(w.ax + w.bx) / 2, (w.az + w.bz) / 2];
  if (role === "municipal building") {
    withMat("concrete", () => {
      // A plain, formal front: a stone cornice along the top of the front wall, a portico over the door, a flagpole with its flag.
      const top = Math.max(w.topA, w.topB);
      out.box(mid[0] + w.nx * 0.15, mid[1] + w.nz * 0.15, top - 0.46, tx, tz, w.length / 2 + 0.1, 0.25, 0.5, STONE_TRIM, STONE_TRIM);
      // Over the street door where the ground floor has one (a unit's door can be at the end of its front, not its middle); over the middle otherwise.
      const slab = floorY + 3.3;
      if (streetDoor === null) {
        const px = mid[0] + w.nx * 1.2;
        const pz = mid[1] + w.nz * 1.2;
        out.box(px, pz, slab, tx, tz, 2.2, 1.3, 0.35, STONE_TRIM, STONE_TRIM);
        for (const s of [-1.7, 1.7]) {
          const cx = px + tx * s + w.nx * 0.7;
          const cz = pz + tz * s + w.nz * 0.7;
          out.box(cx, cz, floorY, tx, tz, 0.17, 0.17, slab - floorY, STONE_TRIM, STONE_TRIM);
        }
      } else {
        // A canopy 3.4 m long ending a metre past the door (or at the corner), carried on one column at its far end: a column at the door's side would stand in the doorway.
        // The unit's `s` runs along the front as the street sees it; the wall runs the other way round (the front's right end is the wall's start).
        const door = w.length - streetDoor;
        const c = Math.max(1.8, Math.min(door + 0.9, w.length - 1.7));
        const px = w.ax + tx * c + w.nx * 1.2;
        const pz = w.az + tz * c + w.nz * 1.2;
        out.box(px, pz, slab, tx, tz, 1.7, 1.3, 0.35, STONE_TRIM, STONE_TRIM);
        const lc = door < c ? 1.45 : -1.45;
        out.box(px + tx * lc + w.nx * 0.7, pz + tz * lc + w.nz * 0.7, floorY, tx, tz, 0.17, 0.17, slab - floorY, STONE_TRIM, STONE_TRIM);
      }
      const bx = w.ax + tx * 0.8 + w.nx * 2.2;
      const bz = w.az + tz * 0.8 + w.nz * 2.2;
      const by = g.heightAt(bx, bz);
      withMat("steel", () => out.box(bx, bz, by, 1, 0, 0.05, 0.05, 8.5, FLAG_POLE, FLAG_POLE));
      const fx = bx + tx * 0.7;
      const fz = bz + tz * 0.7;
      const flag = [[bx + tx * 0.05, by + 8.4, bz + tz * 0.05], [fx + tx * 0.5, by + 8.4, fz + tz * 0.5], [fx + tx * 0.5, by + 7.5, fz + tz * 0.5], [bx + tx * 0.05, by + 7.5, bz + tz * 0.05]] as Vec3[];
      out.poly(flag, [w.nx, 0, w.nz], FLAG_RED, "cloth");
      out.poly(flag, [-w.nx, 0, -w.nz], FLAG_RED, "cloth");
    });
  } else if (role === "church") {
    // A steeple over the front: a square tower of the church's own walls, entered at its foot by a pair of doors, with louvres at the bells and a shingled spire.
    const half = Math.min(1.7, w.length / 2 - 0.3);
    const cx = mid[0] + w.nx * 0.2;
    const cz = mid[1] + w.nz * 0.2;
    const tower = H + 3.5;
    const colour = scaled(wallColour(b.material, b.id), 0.95);
    const style = wallStyle(b);
    const at = (su: number, sv: number): [number, number] => [cx + tx * half * su + w.nx * half * sv, cz + tz * half * su + w.nz * half * sv];
    // The four walls round, each looking out: the front first.
    const faces: [number, number, number, number, number, number][] = [[-1, 1, 1, 1, w.nx, w.nz], [1, 1, 1, -1, tx, tz], [1, -1, -1, -1, -w.nx, -w.nz], [-1, -1, -1, 1, -tx, -tz]];
    let along = 0;
    // The sill of the doors: a step over the ground before the tower, as the building's own street door is.
    let before = -Infinity;
    for (let k = 0; k <= 4; k++) before = Math.max(before, g.heightAt(cx + tx * half * (k / 2 - 1) + w.nx * (half + 1), cz + tz * half * (k / 2 - 1) + w.nz * (half + 1)));
    const sill = Math.max(baseY + 0.3, Math.min(floorY, before + 0.12));
    faces.forEach(([sa, va, sb, vb, nx, nz], k) => {
      const [ax, az] = at(sa, va);
      const [bx, bz] = at(sb, vb);
      const r = wallRef(ax, az, bx, bz, nx, nz);
      const surface: Surface = { layer: style.layer, frame: wallFrame(ax, az, r.tx, r.tz, baseY, along, style.turned), ...(style.paint ? {} : { tint: wallTint(b) }) };
      along += r.length;
      const m = r.length / 2;
      const holes: Hole[] = [];
      // The belfry: a louvred opening high on every face.
      const lw = Math.min(0.5, half * 0.4);
      const louvre: Hole = { s0: m - lw, s1: m + lw, y0: tower - 2.0, y1: tower - 0.7 };
      holes.push(louvre);
      const dw = Math.min(0.85, half - 0.35);
      const door: Hole = { s0: m - dw, s1: m + dw, y0: sill, y1: sill + 2.5 };
      if (k === 0) holes.push(door);
      cutWall(out, r, baseY, tower, tower, holes, colour, () => surface);
      const lo = doorIn(out, r, louvre, 0.1, [0.07, 0.07, 0.07], "boards", scaled(colour, 0.8));
      for (let y = louvre.y0 + 0.08; y < louvre.y1 - 0.1; y += 0.2) wquad(out, r, louvre.s0, y, louvre.s1, y + 0.11, lo + 0.03, [0.2, 0.19, 0.17], "boards");
      // A band of trim under the spire's eave.
      // The front's and the back's run on round the corners, and the sides' stop at them: no two of them lie in one plane.
      const lap = k % 2 === 0 ? 0.06 : 0;
      wbox(out, r, -lap, r.length + lap, tower - 0.32, tower - 0.1, 0, 0.06, [0.6, 0.59, 0.55], [0.6, 0.59, 0.55], true, "painted");
      if (k === 0) {
        pairedDoors(out, r, door, 0.16, [0.3, 0.1, 0.08], scaled(colour, 0.8), [0.4, 0.4, 0.38]);
        // The head over the doors, and the stoop before them: a slab of concrete and, where the ground is lower, a step down from it.
        wbox(out, r, door.s0 - 0.12, door.s1 + 0.12, door.y1, door.y1 + 0.14, 0, 0.07, [0.6, 0.59, 0.55], [0.6, 0.59, 0.55], true, "painted");
        const ground = g.heightAt(cx + w.nx * (half + 0.6), cz + w.nz * (half + 0.6));
        wbox(out, r, door.s0 - 0.35, door.s1 + 0.35, Math.min(ground, sill) - 0.15, sill, 0, 1.0, [0.4, 0.4, 0.38], [0.45, 0.45, 0.43], false, "concrete");
        if (sill - ground > 0.24) wbox(out, r, door.s0 - 0.35, door.s1 + 0.35, ground - 0.15, sill - (sill - ground) / 2, 1.0, 1.35, [0.4, 0.4, 0.38], [0.45, 0.45, 0.43], false, "concrete");
      }
    });
    withMat("shingle", () => {
      const eave = half + 0.18;
      const apex: Vec3 = [cx, tower + half * 3.2, cz];
      const c = (su: number, sv: number): Vec3 => [cx + tx * eave * su + w.nx * eave * sv, tower - 0.06, cz + tz * eave * su + w.nz * eave * sv];
      const ring = [c(-1, -1), c(1, -1), c(1, 1), c(-1, 1)];
      for (let i = 0; i < 4; i++) {
        const p = ring[i] as Vec3;
        const q = ring[(i + 1) % 4] as Vec3;
        const mx = (p[0] + q[0]) / 2 - cx;
        const mz = (p[2] + q[2]) / 2 - cz;
        out.poly([p, q, apex], [mx, 0.5, mz], ROOF_SHINGLE, undefined, { back: true });
      }
      // The spire's underside, which its eave shows.
      out.poly(ring, [0, -1, 0], scaled(ROOF_SHINGLE, 0.6), "painted");
    });
  } else if (role === "mill") {
    // A smokestack at one end.
    const x = f.cx + e1[0] * L * 0.6;
    const z = f.cz + e1[1] * L * 0.6;
    withMat("brick", () => out.box(x, z, baseY, e1[0], e1[1], 1.1, 1.1, H + 12 - baseY, wallColour("brick", b.id), scaled(wallColour("brick", b.id), 0.5)));
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
    for (const y of [platform + 0.5, railTop - 0.05]) withMat("steel", () => out.box((a[0] + c[0]) / 2, (a[2] + c[2]) / 2, y, dx, dz, len / 2 - 0.05, 0.025, 0.08, FLAG_POLE, FLAG_POLE));
    withMat("steel", () => out.box(a[0], a[2], platform, 1, 0, 0.05, 0.05, 1.1, FLAG_POLE, FLAG_POLE));
  }
  // A small roof on four posts over the middle, for shelter.
  const roofY = platform + 3.2;
  for (const [su, sv] of [[-1, -1], [1, -1], [1, 1], [-1, 1]] as const) {
    const x = cx + ux * su * hu * 0.4 + vx * sv * hv * 0.4;
    const z = cz + uz * su * hu * 0.4 + vz * sv * hv * 0.4;
    withMat("steel", () => out.box(x, z, platform, 1, 0, 0.1, 0.1, roofY - platform, FLAG_POLE, FLAG_POLE));
  }
  withMat("sheet", () => out.box(cx, cz, roofY, ux, uz, hu * 0.5, hv * 0.5, 0.2, ROOF_METAL, ROOF_METAL));
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
  out.poly(slope, [0, 1, 0], conc, undefined, { back: { colour: scaled(conc, 0.55) } });
  for (const side of [-1, 1]) out.poly([P(s0, sv + side * 0.8, g0), P(s1, sv + side * 0.8, platform), P(s1, sv + side * 0.8, g0 - 0.3), P(s0, sv + side * 0.8, g0 - 0.3)], [vx * side, 0, vz * side], scaled(conc, 0.8));
  void floorY;
}
