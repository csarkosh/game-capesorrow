/**
 * The town's junctions: every place where streets meet, found from the plan's streets, each one a record the drawing and any
 * later traffic or pathfinding read (`plan.junctions`). Simulation code: `+ - * /`, `floor`, `abs`, `min`, `max`, `sqrt` only; the
 * figures are those of the published research on how a small-town intersection is built ("How a small-town street
 * intersection is built", the sections named beside each figure), and each one the research could not find is authored here,
 * and says so.
 *
 * **How a junction is found.** Two streets of the grid (street, avenue, main) meet where their centre lines cross, or where one
 * ends within the other's right of way (a T). A street that ends on the highway meets it. Meetings that lie within
 * `CLUSTER` metres of each other are one junction. Each junction gets its **legs**, one per direction a street runs out of it,
 * counter-clockwise, each with the street's widths and the state highway's bed edge as legs of its own (`engine`, with no roadway
 * of ours). The shapes are solved (`junctionShape.ts`): the corner between two legs is a curb return tangent to both curbs;
 * how far from the junction each leg's roadway begins (`mouth`) and its verge, sidewalk and curb (`bandLeft`, `bandRight`) follow.
 * Where two junctions' pavements would leave a street less than `MIN_STRIP` between them they are one compound junction.
 *
 * **Control** (section 4). Two quiet residential streets crossing within 15 degrees of square meet with no control: the research
 * lists that as an option for a corner with a clear view, and it is what this does. A T's stem stops; where streets cross
 * more than 15 degrees off square (the MUTCD's 75 to 90 range), the lesser street stops; a residential street meeting the
 * avenue, a main street or the highway stops; a marked crosswalk (the school's and the hospital's corners) puts a STOP on the
 * lesser street too; and the one or two busiest corners of the core (the junction of the heaviest streets, nearest the core's
 * middle) stop all ways. There are no signals in this pass.
 *
 * **Radius** (section 1): 10 ft (3.0 m) where two neighbourhood streets meet (Seattle), 20 ft (6.1 m) with a main street or the
 * avenue (Seattle's "no more than 20 ft" for other street types), 30 ft (9.1 m) to the highway's edge (WSDOT, a passenger car).
 * Authored (no source gives one): at an obtuse corner the tangent keeps its square length and the radius grows with the angle,
 * and at an acute one the tangent stops at `REACH_MAX` and the radius shrinks to give it.
 *
 * **Marked crosswalks** (section 3): the legs of the main street and the avenue, the school's and the hospital's corners, and the
 * highway's two legs at the junctions of the core; every other crossing is legal and unmarked. **Ramps** (section 2, section 7):
 * every rebuilt corner has them; an older block of houses may keep ramp-less corners: authored, 60 percent of the old plat's
 * residential junctions and 30 percent of the land company's (the later plat) draw an unrebuilt corner, from the junctions' own
 * stream; anything on the main street, the avenue, the highway, in the core or at a school or the hospital was rebuilt.
 *
 * **Sharp crossings** (section 5): the seam's crossings lie outside WSDOT's 60 to 120 degrees. Where two streets cross within
 * 60 degrees, the lesser street's nearer leg is closed with a planter and a sign (a legacy of the plat), and the junction is a
 * tee of what is left. A small triangular island is not made. A street that meets the highway is never closed for its angle: it
 * runs on and joins at whatever angle it has, with an acute corner and a stop sign.
 */
import { ROAD_BED_HALF } from "@csarkosh/engine/sim/road";
import { segDist, type Vec } from "./geom.js";
import { chance, type Rng } from "./rng.js";
import { areaOf, isSimple, onLeg, pavementPolygon, polygonsOverlap, solveJunction, type Solved } from "./junctionShape.js";
import { walkAt } from "./port/edges.js";
import type { Block, Building, Junction, JunctionControl, JunctionCorner, JunctionKind, JunctionLeg, Landmark, RailCrossing, Road, SideEdge, Street, StreetEdge, StreetEnd, StreetKind } from "./types.js";

// ---- Figures from the research, with the section that gives each.
/** Corner radius where two neighbourhood streets meet, 10 ft (section 1, Seattle). */
export const RADIUS_STREET = 3.0;
/** Corner radius with a main street or the avenue, 20 ft (section 1, Seattle: no more than 20 ft for other street types). */
export const RADIUS_MAIN = 6.1;
/** Corner radius to the highway's edge, 30 ft for a passenger car (section 1, WSDOT). */
export const RADIUS_HIGHWAY = 9.1;
/** A marked crosswalk's width along the street, 10 ft (section 3, WSDOT's ladder crosswalk). */
export const CROSSWALK_WIDTH = 3.05;
/** The stop line is at least 4 ft before the crosswalk (section 3, MUTCD), 12 to 24 in wide: 18 in. */
export const STOP_LINE_GAP = 1.22;
export const STOP_LINE_WIDTH = 0.46;
/** No parking within 20 ft of a crosswalk, marked or not, and 30 ft on the approach to a STOP sign (section 3, RCW 46.61.570). */
export const NO_PARK_CROSSWALK = 6.1;
export const NO_PARK_STOP = 9.1;
/** A STOP sign's width across its flats, 30 in on a single-lane road (section 4, MUTCD 2B), and its offset behind the curb face, 1 ft (MUTCD 2A). */
export const STOP_SIGN_SIZE = 0.76;
export const SIGN_BEHIND_CURB = 0.3;
/** A STOP sign stands this far beyond its stop line's near edge (before the crosswalk, from the approach), metres. */
export const STOP_SIGN_AFTER = 0.5;
/** The sine of 15 degrees: a crossing within this of square needs no control by the MUTCD's 75 to 90 (section 4), and the least sine of a "skew". */
export const SQUARE_SKEW = 0.2588;
/** A crossing this sharp (60 degrees) is outside WSDOT's range (section 5): the cosine of 60 degrees. */
export const SHARP_SKEW = 0.5;
/** The distance from the rail's centre line at which the stop line stands, and the crossbucks (section 6: at least 15 ft from the nearest rail; the track's half gauge is 0.72 m, so 5.6 m is 4.9 m from it). */
export const RAIL_STOP_LINE = 5.6;
export const RAIL_CROSSBUCK = 4;

// ---- Values authored here: the research found no figure.
/** An unmarked crosswalk's width along the street: the sidewalk's own width, about 2 m (authored; section 3 defines it by the sidewalk's prolongation but gives no number). */
export const UNMARKED_CROSSWALK = 2;
/** How far from the stop sign's line a stop line stands with no marked crosswalk: 4 ft is the least (section 3); 6 ft here (authored). */
export const UNMARKED_STOP_GAP = 1.8;
/** How far short of a crosswalk (or of the junction, where it is unmarked) the centre line's dashes end (section 3: the manual gives none, authored: 5 ft). */
export const CENTRE_SHORT = 1.5;
/** The meetings of streets that lie within this of each other are one junction, metres. */
const CLUSTER = 3.5;
/** The least a street's strip may be between two junctions, and the least a leg may be to count, metres. */
const MIN_STRIP = 2;
const MIN_LEG = 3;

/** Two streets whose directions' cosine exceeds this lie nearly one along the other (about 26 degrees). */
const PARALLEL_COS = 0.9;

const GRID: readonly StreetKind[] = ["street", "avenue", "main"];

type Pt = { x: number; z: number };

function isGrid(k: StreetKind): boolean {
  return GRID.includes(k);
}

/** A street's weight in who stops: the lesser street stops. */
function weight(kind: StreetKind | "road"): number {
  switch (kind) {
    case "highway":
      return 5;
    case "main":
      return 4;
    case "avenue":
      return 3;
    default:
      return 1;
  }
}

/** A direction's place round the compass as a number in [0, 4), growing counter-clockwise, with no angle computed. */
function diamond(dx: number, dz: number): number {
  const p = dz / (Math.abs(dx) + Math.abs(dz));
  if (dx < 0) return 2 - p;
  if (dz < 0) return 4 + p;
  return p;
}

type G = { street: Street; ax: number; az: number; tx: number; tz: number; length: number; hw: number };

function prep(street: Street): G | null {
  const dx = street.b.x - street.a.x;
  const dz = street.b.z - street.a.z;
  const length = Math.sqrt(dx * dx + dz * dz);
  if (!(length > 0.1)) return null;
  return { street, ax: street.a.x, az: street.a.z, tx: dx / length, tz: dz / length, length, hw: street.width / 2 };
}

/** A meeting of streets: a point, the streets that meet there, and for the highway the segment (an index into `plan.streets`). */
type Meeting = { x: number; z: number; a: number; b: number; seg: number; side: number };

export type JunctionInput = {
  readonly streets: readonly Street[];
  readonly roads: readonly Road[];
  readonly ends: readonly StreetEnd[];
  readonly rail: readonly RailCrossing[];
  readonly blocks: readonly Block[];
  readonly buildings: readonly Building[];
  readonly landmarks: readonly Landmark[];
  /** What stands beside each street (`port/edges.ts`), by street id: which legs have a curb and a sidewalk on which side. */
  readonly edges: readonly StreetEdge[];
  readonly rng: Rng;
};

/** A leg before it is shaped. */
type RawLeg = {
  street: number;
  road: number;
  kind: StreetKind | "road";
  name: string;
  x: number;
  z: number;
  dx: number;
  dz: number;
  from: number;
  to: number;
  roadway: number;
  walk: number;
  width: number;
  half: number;
  outer: number;
  engine: boolean;
};

type Built = {
  raw: RawLeg[];
  solved: Solved;
  /** The legs of a street cut where it lies along another (a crossing under 26 degrees), each with the distance its strip is held back. */
  cuts: { leg: RawLeg; mouth: number }[];
  /** The legs a sharp crossing closed with a planter. */
  shut: { leg: RawLeg; left: number; right: number; mouth: number }[];
  /** Every corner takes the 10 ft radius, because the returns of two junctions close together would meet. */
  tight: boolean;
  /** How many legs the cluster had before any was closed. */
  wasLegs: number;
  /** The cosine of the angle between the two heaviest streets (the sine of their angle off square), or of the pair a cut was made for. */
  skew: number;
  streets: number[];
  hasEngine: boolean;
};

/**
 * Which sides of a leg have a curb and a sidewalk just beyond its mouth (`port/edges.ts` says where each street's side has its
 * pours). The highway's edge is the engine's, and counts as having both so a street's own side decides the corner. A leg that is
 * not a street of the grid has none.
 */
function sidesOf(inp: JunctionInput, l: RawLeg, mouth: number): { curbLeft: boolean; curbRight: boolean; walkLeft: boolean; walkRight: boolean } {
  if (l.engine) return { curbLeft: true, curbRight: true, walkLeft: true, walkRight: true };
  const st = inp.streets[l.street];
  const edge = inp.edges[l.street];
  if (st === undefined || edge === undefined || l.street < 0) return { curbLeft: false, curbRight: false, walkLeft: false, walkRight: false };
  const dx = st.b.x - st.a.x;
  const dz = st.b.z - st.a.z;
  const len = Math.sqrt(dx * dx + dz * dz);
  if (!(len > 0.1)) return { curbLeft: false, curbRight: false, walkLeft: false, walkRight: false };
  const tx = dx / len;
  const tz = dz / len;
  const fwd = l.dx * tx + l.dz * tz > 0;
  const so = (l.x - st.a.x) * tx + (l.z - st.a.z) * tz;
  // Just beyond the mouth along the leg, and at the junction's own middle: a sidewalk counts if it is at either.
  const sBeyond = so + (fwd ? 1 : -1) * (mouth + 1.5);
  const has = (side: SideEdge): boolean => side.walk > 0 && (walkAt(side, sBeyond) !== null || walkAt(side, so) !== null);
  const left = edge.sides[fwd ? 0 : 1];
  const right = edge.sides[fwd ? 1 : 0];
  return { curbLeft: left.curb, curbRight: right.curb, walkLeft: has(left), walkRight: has(right) };
}

function legPlain(l: RawLeg): JunctionLeg {
  return { ...l, mouth: 0, bandLeft: 0, bandRight: 0, marked: false, stops: false, stopLine: null, holdBack: 0, centreEnd: 0, deadEnd: false, closed: false, curbLeft: false, curbRight: false, walkLeft: false, walkRight: false };
}

export function findJunctions(inp: JunctionInput): Junction[] {
  const { streets } = inp;
  const hwSegs = streets.filter((s) => s.kind === "highway");
  const grid: G[] = [];
  for (const st of streets) {
    if (!isGrid(st.kind)) continue;
    const g = prep(st);
    if (g !== null) grid.push(g);
  }
  const byId = (id: number): G | undefined => grid.find((g) => g.street.id === id);

  // ---- Meetings.
  const meetings: Meeting[] = [];
  for (let i = 0; i < grid.length; i++) {
    for (let j = i + 1; j < grid.length; j++) {
      const a = grid[i] as G;
      const b = grid[j] as G;
      const den = a.tx * b.tz - a.tz * b.tx;
      if (Math.abs(den) < 0.17) continue;
      const rx = b.ax - a.ax;
      const rz = b.az - a.az;
      const ti = (rx * b.tz - rz * b.tx) / den;
      const tj = (rx * a.tz - rz * a.tx) / den;
      if (ti < -(b.hw + 0.8) || ti > a.length + b.hw + 0.8 || tj < -(a.hw + 0.8) || tj > b.length + a.hw + 0.8) continue;
      meetings.push({ x: a.ax + a.tx * ti, z: a.az + a.tz * ti, a: a.street.id, b: b.street.id, seg: -1, side: 0 });
    }
  }
  // A street that ends on the highway.
  for (const g of grid) {
    for (const end of [0, 1] as const) {
      const ex = end === 0 ? g.ax : g.ax + g.tx * g.length;
      const ez = end === 0 ? g.az : g.az + g.tz * g.length;
      let best = -1;
      let bestD = Infinity;
      for (const h of hwSegs) {
        const d = segDist({ x: ex, z: ez }, h.a, h.b);
        if (d < bestD) {
          bestD = d;
          best = h.id;
        }
      }
      if (best < 0 || bestD > ROAD_BED_HALF + 3) continue;
      const h = streets[best] as Street;
      const hl = Math.sqrt((h.b.x - h.a.x) * (h.b.x - h.a.x) + (h.b.z - h.a.z) * (h.b.z - h.a.z));
      const hx = (h.b.x - h.a.x) / hl;
      const hz = (h.b.z - h.a.z) / hl;
      // The street's line meets the highway's centre line.
      const den = g.tx * hz - g.tz * hx;
      if (Math.abs(den) < 0.05) continue;
      const t = ((h.a.x - g.ax) * hz - (h.a.z - g.az) * hx) / den;
      if (Math.abs(t - (end === 0 ? 0 : g.length)) > (ROAD_BED_HALF + 3) / Math.abs(den) + 1) continue;
      // Which side of the highway the street lies on: from its end on the highway toward its other end, against the highway's left normal.
      const awayX = end === 0 ? g.tx : -g.tx;
      const awayZ = end === 0 ? g.tz : -g.tz;
      meetings.push({ x: g.ax + g.tx * t, z: g.az + g.tz * t, a: g.street.id, b: -1, seg: best, side: -hz * awayX + hx * awayZ > 0 ? 1 : -1 });
    }
  }

  // ---- Clusters by nearness.
  const parent = meetings.map((_, i) => i);
  const find = (i: number): number => {
    let r = i;
    while (parent[r] !== r) r = parent[r] as number;
    return r;
  };
  for (let i = 0; i < meetings.length; i++) {
    for (let j = i + 1; j < meetings.length; j++) {
      const p = meetings[i] as Meeting;
      const q = meetings[j] as Meeting;
      if ((p.seg >= 0) !== (q.seg >= 0)) continue;
      if (p.seg >= 0 && q.seg >= 0 && (Math.abs(p.seg - q.seg) > 2 || p.side !== q.side)) continue;
      if ((p.x - q.x) * (p.x - q.x) + (p.z - q.z) * (p.z - q.z) < CLUSTER * CLUSTER) parent[find(j)] = find(i);
    }
  }
  let clusters: number[][] = [];
  for (let i = 0; i < meetings.length; i++) {
    if (find(i) !== i) continue;
    clusters.push(meetings.map((_, k) => k).filter((k) => find(k) === i));
  }

  // ---- Legs of a cluster, and the shapes that follow.
  /** The radius of a corner between two legs; `tight` (two junctions' returns would meet) gives every corner the neighbourhood streets' 10 ft (authored). */
  const radiusFor = (tight: boolean) => (raw: readonly RawLeg[]) => (i: number, j: number): number => {
    if (tight) return RADIUS_STREET;
    const a = raw[i] as RawLeg;
    const b = raw[j] as RawLeg;
    if (a.engine || b.engine) return RADIUS_HIGHWAY;
    return weight(a.kind) > 1 || weight(b.kind) > 1 ? RADIUS_MAIN : RADIUS_STREET;
  };

  const build = (members: readonly number[], tight = false): Built | null => {
    const radiusOf = radiusFor(tight);
    // The corners solved for the legs as they are. The highway's two edge legs stand at one point, which is the cluster's middle projected on the edge; the
    // pavement's stretch along the edge lies between where the curb returns leave it, and where the point is outside that stretch the pavement's outline would
    // run out to it and back, so the point is moved to the middle of the stretch and the corners solved again.
    const solveWith = (all: RawLeg[], plain: boolean): Solved => {
      const only = plain ? (i: number, j: number): boolean => (all[i] as RawLeg).engine || (all[j] as RawLeg).engine : undefined;
      let sv = solveJunction(all, radiusOf(all), only);
      const eng = all.filter((l) => l.engine);
      if (eng.length === 2) {
        const h = eng[0] as RawLeg;
        let lo = Infinity;
        let hi = -Infinity;
        for (const k of sv.corners) {
          const a = all[k.from] as RawLeg;
          const b = all[k.to] as RawLeg;
          if (a.engine === b.engine || k.shape === "straight") continue;
          const p = k.shape === "arc" ? (a.engine ? k.ta : k.tb) : (k.v as Vec);
          const u = (p.x - h.x) * h.dx + (p.z - h.z) * h.dz;
          lo = Math.min(lo, u);
          hi = Math.max(hi, u);
        }
        if (lo <= hi && (lo > 1e-6 || hi < -1e-6)) {
          const mid = (lo + hi) / 2;
          for (const l of eng) {
            l.x += h.dx * mid;
            l.z += h.dz * mid;
          }
          sv = solveJunction(all, radiusOf(all), only);
        }
      }
      return sv;
    };
    const ms = members.map((k) => meetings[k] as Meeting);
    let qx = 0;
    let qz = 0;
    for (const m of ms) {
      qx += m.x;
      qz += m.z;
    }
    qx /= ms.length;
    qz /= ms.length;
    const ids: number[] = [];
    let seg = -1;
    for (const m of ms) {
      if (!ids.includes(m.a)) ids.push(m.a);
      if (m.b >= 0 && !ids.includes(m.b)) ids.push(m.b);
      if (m.seg >= 0 && seg < 0) seg = m.seg;
    }
    ids.sort((p, q) => p - q);
    const raw: RawLeg[] = [];
    for (const id of ids) {
      const g = byId(id);
      if (g === undefined) continue;
      const sq = (qx - g.ax) * g.tx + (qz - g.az) * g.tz;
      const ox = g.ax + g.tx * sq;
      const oz = g.az + g.tz * sq;
      const way = g.street;
      const common = { street: id, road: -1, kind: way.kind, name: way.name, x: ox, z: oz, roadway: way.roadway, walk: way.walk, width: way.width, half: way.roadway / 2, outer: g.hw, engine: false };
      // Forward (toward b): the street's segment covers from `max(0, -sq)` to `length - sq`.
      raw.push({ ...common, dx: g.tx, dz: g.tz, from: Math.max(0, -sq), to: g.length - sq });
      raw.push({ ...common, dx: -g.tx, dz: -g.tz, from: Math.max(0, sq - g.length), to: sq });
    }
    let hasEngine = false;
    if (seg >= 0) {
      const h = streets[seg] as Street;
      const hl = Math.sqrt((h.b.x - h.a.x) * (h.b.x - h.a.x) + (h.b.z - h.a.z) * (h.b.z - h.a.z));
      const hx = (h.b.x - h.a.x) / hl;
      const hz = (h.b.z - h.a.z) / hl;
      const side = (ms.find((m) => m.seg >= 0) as Meeting).side;
      // The highway's centre line at the cluster, and its bed edge on the street's side.
      const along = (qx - h.a.x) * hx + (qz - h.a.z) * hz;
      const cx = h.a.x + hx * along;
      const cz = h.a.z + hz * along;
      const ex = cx - hz * ROAD_BED_HALF * side;
      const ez = cz + hx * ROAD_BED_HALF * side;
      const e = { street: seg, road: -1, kind: "highway" as const, name: h.name, x: ex, z: ez, roadway: h.roadway, walk: 0, width: ROAD_BED_HALF * 2, half: 0, outer: 0, engine: true, from: 0, to: 1000 };
      raw.push({ ...e, dx: hx, dz: hz }, { ...e, dx: -hx, dz: -hz });
      hasEngine = true;
      // A street's strip begins beyond the bed's edge, where its roadway's near corner clears it by 0.3 m. A leg that runs away from the highway
      // starts that far from where it stands (its reference point is the cluster's middle, not always on the centre line, and a street that meets
      // the highway at a sharp angle beside another street is in a cluster whose middle is a good way off it).
      const nx = -hz * side;
      const nz = hx * side;
      for (const l of raw) {
        if (l.engine) continue;
        const sinPhi = Math.max(Math.abs(l.dx * hz - l.dz * hx), 0.05);
        const cosPhi = Math.abs(l.dx * hx + l.dz * hz);
        const away = l.dx * nx + l.dz * nz;
        if (away > 0.05) {
          const stand = (l.x - cx) * nx + (l.z - cz) * nz;
          l.from = Math.max(l.from, (ROAD_BED_HALF + l.half * cosPhi + 0.3 - stand) / away);
        } else l.from = Math.max(l.from, (ROAD_BED_HALF + l.half * cosPhi + 0.3) / sinPhi);
      }
    }
    // Two streets that cross within about 26 degrees (the seam's sharpest crossings) lie one along the other for dozens of metres: the lesser is
    // cut there, its two legs held back until its roadway clears the other's, each closed with a planter.
    const cuts: { leg: RawLeg; mouth: number }[] = [];
    for (let i = 0; i < ids.length; i++) {
      for (let k = i + 1; k < ids.length; k++) {
        const la = raw.filter((l) => l.street === ids[i] && !l.engine);
        const lb = raw.filter((l) => l.street === ids[k] && !l.engine);
        const a = la[0];
        const b = lb[0];
        if (a === undefined || b === undefined) continue;
        const dot = Math.abs(a.dx * b.dx + a.dz * b.dz);
        if (dot <= PARALLEL_COS) continue;
        const total = (x: RawLeg[]): number => x.reduce((sum, l) => sum + Math.max(0, l.to - l.from), 0);
        const lesser = weight(a.kind) !== weight(b.kind) ? (weight(a.kind) < weight(b.kind) ? la : lb) : total(la) <= total(lb) ? la : lb;
        const other = lesser === la ? a : b;
        const sin = Math.max(Math.sqrt(Math.max(0, 1 - dot * dot)), 0.05);
        for (const l of lesser) {
          const hold = (other.half + l.half + 1.5) / sin + 2;
          if (hold < l.to - MIN_LEG) cuts.push({ leg: l, mouth: Math.max(hold, l.from) });
        }
        for (const l of lesser) {
          const at = raw.indexOf(l);
          if (at >= 0) raw.splice(at, 1);
        }
      }
    }
    // Legs that are too short are gone (a stub the pavement covers); the rest are put in order, and any two nearly the same way lose the lesser.
    let legs = raw.filter((l) => l.engine || l.to - l.from > MIN_LEG);
    legs.sort((p, q) => diamond(p.dx, p.dz) - diamond(q.dx, q.dz) || p.street - q.street);
    let solved: Solved | null = null;
    for (let pass = 0; pass < 6; pass++) {
      let again = false;
      for (let i = 0; i < legs.length && !again; i++) {
        const a = legs[i] as RawLeg;
        const b = legs[(i + 1) % legs.length] as RawLeg;
        if (legs.length < 3) break;
        const cross = a.dx * b.dz - a.dz * b.dx;
        const dot = a.dx * b.dx + a.dz * b.dz;
        if (cross > 0 && dot > 0.9) {
          const drop = a.engine ? b : b.engine ? a : a.to - a.from <= b.to - b.from ? a : b;
          legs = legs.filter((l) => l !== drop);
          again = true;
        }
      }
      if (legs.length < 2) return null;
      solved = solveWith(legs, false);
      // A leg shorter than its mouth is a stub the pavement covers.
      const short = legs.findIndex((l, i) => !l.engine && (solved as Solved).mouth[i]! > l.to - MIN_STRIP * 0.5 && l.to - l.from < (solved as Solved).mouth[i]! + MIN_STRIP);
      if (short >= 0 && legs.length > 2) {
        const drop = legs[short] as RawLeg;
        legs = legs.filter((l) => l !== drop);
        again = true;
      }
      if (!again) break;
    }
    if (solved === null || legs.length < 2) return null;
    // The angle between the two heaviest streets (the sine of their angle off square), and what a crossing of two town streets within 60 degrees does:
    // the lesser street's nearer leg is closed with a planter, and the pavement is solved again without it. A street that meets the highway is never
    // closed for its angle: it runs on and joins, with an acute corner.
    const top = legs.slice().sort((p, q) => weight(q.kind) - weight(p.kind) || p.street - q.street);
    const first = top[0] as RawLeg;
    const second = top.find((l) => l.street !== first.street) ?? first;
    // Two streets in one line (one street cut where it crosses something) cross at no angle.
    const cosine = Math.abs(first.dx * second.dx + first.dz * second.dz);
    const angle = cosine > 0.995 ? 0 : cosine;
    const skew = cuts.length > 0 ? Math.max(angle, PARALLEL_COS + 0.001) : angle;
    const wasLegs = legs.length;
    const shutLegs: RawLeg[] = [];
    if (angle > SHARP_SKEW && angle < 0.995 && legs.length >= 3 && !hasEngine) {
      const minor = legs.filter((l) => !l.engine && l.street !== first.street && weight(l.kind) <= weight(first.kind));
      const nearer = minor.sort((p, q) => p.to - q.to || p.street - q.street)[0];
      const pick = nearer === undefined ? [] : [nearer];
      if (pick.length > 0) {
        shutLegs.push(...pick);
        legs = legs.filter((l) => !pick.includes(l));
        solved = solveWith(legs, false);
      }
    }
    // A closed leg's strip begins where its curbs leave the pavement that is left.
    let shaped = legs.map((l, i) => ({ ...l, mouth: (solved as Solved).mouth[i] as number, bandLeft: (solved as Solved).bandLeft[i] as number, bandRight: (solved as Solved).bandRight[i] as number }));
    let poly = shaped.length >= 2 ? pavementPolygon(shaped, (solved as Solved).corners) : [];
    // Where the highway is in the junction, an acute corner that cannot take its return (two streets that meet each other near the highway, each at a
    // sharp angle to it, leave no room for both returns on the one edge) has none: the curbs meet at a point on the highway's edge, as a plain corner does.
    if (hasEngine && legs.length >= 3 && (poly.length < 3 || !isSimple(poly))) {
      solved = solveWith(legs, true);
      shaped = legs.map((l, i) => ({ ...l, mouth: (solved as Solved).mouth[i] as number, bandLeft: (solved as Solved).bandLeft[i] as number, bandRight: (solved as Solved).bandRight[i] as number }));
      poly = pavementPolygon(shaped, (solved as Solved).corners);
    }
    // Where even that leaves two streets' near curbs crossing one another (two streets that cross each other a few metres from the highway, each
    // meeting it at a sharp angle: the wider street's pavement takes in the other's mouth on the edge), the lesser street is the one closed with
    // a planter, as at any crossing within 60 degrees, and the pavement is solved again without it; the street whose closing leaves a simple pavement
    // is the one closed, the lesser first.
    const resolve = (): void => {
      solved = solveWith(legs, false);
      shaped = legs.map((l, i) => ({ ...l, mouth: (solved as Solved).mouth[i] as number, bandLeft: (solved as Solved).bandLeft[i] as number, bandRight: (solved as Solved).bandRight[i] as number }));
      poly = pavementPolygon(shaped, (solved as Solved).corners);
      if (!isSimple(poly)) {
        solved = solveWith(legs, true);
        shaped = legs.map((l, i) => ({ ...l, mouth: (solved as Solved).mouth[i] as number, bandLeft: (solved as Solved).bandLeft[i] as number, bandRight: (solved as Solved).bandRight[i] as number }));
        poly = pavementPolygon(shaped, (solved as Solved).corners);
      }
    };
    for (let guard = 0; guard < 6 && hasEngine && legs.length >= 4 && !isSimple(poly); guard++) {
      const keep = legs;
      const streetIds: number[] = [];
      for (const l of legs.slice().sort((p, q) => weight(p.kind) - weight(q.kind) || q.street - p.street)) if (!l.engine && !streetIds.includes(l.street)) streetIds.push(l.street);
      if (streetIds.length < 2) break;
      let done = false;
      for (const id of streetIds) {
        legs = keep.filter((l) => l.street !== id || l.engine);
        resolve();
        if (isSimple(poly)) {
          shutLegs.push(...keep.filter((l) => !l.engine && l.street === id));
          done = true;
          break;
        }
      }
      if (!done) {
        // No one street's closing is enough: the lesser is closed and the next round looks again.
        const id = streetIds[0] as number;
        legs = keep.filter((l) => l.street !== id || l.engine);
        shutLegs.push(...keep.filter((l) => !l.engine && l.street === id));
        resolve();
      }
    }
    // A through street left alone has no pavement of its own: its roadway is the rectangle along it.
    if (poly.length < 3 && shaped.length === 2) {
      const t = shaped[0] as (typeof shaped)[number];
      poly = [onLeg(t, -60, -t.half), onLeg(t, 60, -t.half), onLeg(t, 60, t.half), onLeg(t, -60, t.half)];
    }
    const shut = shutLegs.map((leg) => {
      const left = exitOf(poly, leg, leg.half);
      const right = exitOf(poly, leg, -leg.half);
      return { leg, left, right, mouth: Math.max(leg.from, left, right) };
    });
    return { raw: legs, solved, cuts, shut, wasLegs, skew, tight, streets: ids, hasEngine };
  };

  // ---- Merge clusters whose strips between would be too short.
  const intervals = (b: Built): { street: number; lo: number; hi: number }[] => {
    const out: { street: number; lo: number; hi: number }[] = [];
    for (const id of b.streets) {
      const g = byId(id);
      if (g === undefined) continue;
      let lo = 1e6;
      let hi = -1e6;
      let any = false;
      for (let i = 0; i < b.raw.length; i++) {
        const l = b.raw[i] as RawLeg;
        if (l.street !== id) continue;
        any = true;
        const so = (l.x - g.ax) * g.tx + (l.z - g.az) * g.tz;
        const m = b.solved.mouth[i] as number;
        const fwd = l.dx * g.tx + l.dz * g.tz > 0;
        if (fwd) hi = Math.max(hi, so + m);
        else lo = Math.min(lo, so - m);
      }
      for (const c of [...b.cuts, ...b.shut.map((q) => ({ leg: q.leg, mouth: q.mouth }))]) {
        if (c.leg.street !== id) continue;
        any = true;
        const so = (c.leg.x - g.ax) * g.tx + (c.leg.z - g.az) * g.tz;
        if (c.leg.dx * g.tx + c.leg.dz * g.tz > 0) hi = Math.max(hi, so + c.mouth);
        else lo = Math.min(lo, so - c.mouth);
      }
      if (!any) continue;
      // A street with a leg one way only is cut to its end that way.
      const all = [...b.raw, ...b.cuts.map((c) => c.leg), ...b.shut.map((q) => q.leg)];
      const hasFwd = all.some((l) => l.street === id && l.dx * g.tx + l.dz * g.tz > 0);
      const hasBack = all.some((l) => l.street === id && l.dx * g.tx + l.dz * g.tz < 0);
      out.push({ street: id, lo: hasBack ? lo : -1e6, hi: hasFwd ? hi : 1e6 });
    }
    return out;
  };

  let tight: boolean[] = clusters.map(() => false);
  let built: (Built | null)[] = clusters.map((c) => build(c));
  for (let pass = 0; pass < 12; pass++) {
    const conflicts: [number, number][] = [];
    const list: { street: number; c: number; lo: number; hi: number }[] = [];
    for (let c = 0; c < built.length; c++) {
      const b = built[c];
      if (b === null || b === undefined) continue;
      for (const iv of intervals(b)) list.push({ street: iv.street, c, lo: iv.lo, hi: iv.hi });
    }
    list.sort((p, q) => p.street - q.street || p.lo - q.lo);
    for (let i = 0; i + 1 < list.length; i++) {
      const p = list[i] as (typeof list)[number];
      const q = list[i + 1] as (typeof list)[number];
      if (p.street !== q.street || p.c === q.c) continue;
      if (q.lo - p.hi < MIN_STRIP) conflicts.push([p.c, q.c]);
    }
    // Pavements that would overlap conflict too.
    const polys = built.map((b) => (b === null ? [] : pavementPolygon(b.raw.map((l, i) => ({ ...l, mouth: b.solved.mouth[i] as number, bandLeft: b.solved.bandLeft[i] as number, bandRight: b.solved.bandRight[i] as number })), b.solved.corners)));
    for (let p = 0; p < polys.length; p++) {
      for (let q = p + 1; q < polys.length; q++) if (polygonsOverlap(polys[p] as Vec[], polys[q] as Vec[])) conflicts.push([p, q]);
    }
    if (conflicts.length === 0) break;
    // First the corners are tightened to 10 ft; only where that is not enough are the junctions one.
    let tightened = false;
    const merge: [number, number][] = [];
    for (const [p, q] of conflicts) {
      if (!tight[p] || !tight[q]) {
        for (const c of [p, q]) {
          if (!tight[c]) {
            tight[c] = true;
            built[c] = build(clusters[c] as number[], true);
            tightened = true;
          }
        }
      } else merge.push([p, q]);
    }
    if (tightened) continue;
    const into = clusters.map((_, i) => i);
    const root = (i: number): number => {
      let r = i;
      while (into[r] !== r) r = into[r] as number;
      return r;
    };
    for (const [p, q] of merge) into[root(q)] = root(p);
    const next: number[][] = [];
    for (let i = 0; i < clusters.length; i++) {
      if (root(i) !== i) continue;
      next.push(clusters.flatMap((c, k) => (root(k) === i ? c : [])));
    }
    clusters = next;
    tight = clusters.map(() => false);
    built = clusters.map((c) => build(c));
  }

  // ---- Records.
  const core = coreOf(inp);
  const civic = civicSpots(inp);
  const out: Junction[] = [];
  type Pre = { x: number; z: number; legs: JunctionLeg[]; corners: JunctionCorner[]; closed: JunctionLeg[]; streets: number[]; kind: JunctionKind; stem: number; skew: number; legacy: "planter" | null; core: boolean; civic: boolean; weight: number; hasEngine: boolean; tight: boolean };
  const pres: Pre[] = [];
  for (const b of built) {
    if (b === null) continue;
    pres.push(finish(b, inp, core, civic));
  }

  // Decide control, marks, ramps; all-way stops at the busiest corners of the core.
  const coreMid = coreMiddle(inp);
  const ranked = pres
    .map((p, i) => ({ p, i }))
    .filter(({ p }) => p.core && !p.hasEngine && p.legs.length >= 3 && p.weight >= 2)
    .sort((a, b) => b.p.weight - a.p.weight || dist2(a.p, coreMid) - dist2(b.p, coreMid) || a.i - b.i);
  const allWay: number[] = ranked.slice(0, 2).map((r) => r.i);

  for (let i = 0; i < pres.length; i++) out.push(decide(pres[i] as (typeof pres)[number], out.length, allWay.includes(i), inp));

  // The legs that end in a dead end carry a sign.
  markDeadEnds(out, inp, byId);

  // ---- The junctions that share no pavement.
  addAlleys(out, inp, grid);
  addRoadEnds(out, inp);
  addStairs(out, inp, grid);
  addRail(out, inp);
  return out.map((j, id) => ({ ...j, id }));
}

function dist2(p: Pt, q: Pt): number {
  return (p.x - q.x) * (p.x - q.x) + (p.z - q.z) * (p.z - q.z);
}

/** Where the core of the town is, as polygons: the blocks of the core and the civic blocks. */
function coreOf(inp: JunctionInput): readonly (readonly Vec[])[] {
  return inp.blocks.filter((b) => b.district === "core" || b.district === "civic").map((b) => b.polygon);
}

function coreMiddle(inp: JunctionInput): Pt {
  let x = 0;
  let z = 0;
  let n = 0;
  for (const b of inp.blocks) {
    if (b.district !== "core") continue;
    for (const p of b.polygon) {
      x += p.x;
      z += p.z;
      n++;
    }
  }
  return n === 0 ? { x: 0, z: 0 } : { x: x / n, z: z / n };
}

function nearPoly(poly: readonly Vec[], p: Pt, reach: number): boolean {
  for (let k = 0; k < poly.length; k++) if (segDist(p, poly[k] as Vec, poly[(k + 1) % poly.length] as Vec) <= reach) return true;
  return false;
}

/** The school's and the hospital's places. */
function civicSpots(inp: JunctionInput): Vec[] {
  const spots: Vec[] = [];
  for (const l of inp.landmarks) {
    if (l.role !== "high school" && l.role !== "hospital") continue;
    const b = inp.buildings[l.building];
    if (b !== undefined) spots.push(b.centre);
  }
  return spots;
}

/** A cluster's records: the shaped legs, the corners, the kind and the angle. */
function finish(b: Built, inp: JunctionInput, core: readonly (readonly Vec[])[], civic: readonly Vec[]): {
  x: number; z: number; legs: JunctionLeg[]; corners: JunctionCorner[]; closed: JunctionLeg[]; streets: number[]; kind: JunctionKind; stem: number; skew: number; legacy: "planter" | null; core: boolean; civic: boolean; weight: number; hasEngine: boolean; tight: boolean;
} {
  const raw = b.raw;
  const solved = b.solved;
  let x = 0;
  let z = 0;
  for (const l of raw) {
    x += l.x;
    z += l.z;
  }
  x /= raw.length;
  z /= raw.length;
  const skew = b.skew;
  const wasLegs = b.wasLegs;
  let kind: JunctionKind;
  if (b.hasEngine) kind = "highway";
  else if (wasLegs >= 4) kind = skew > SQUARE_SKEW ? "skew" : "four-way";
  else if (wasLegs === 3) kind = "tee";
  else kind = "bend";
  let legacy: "planter" | null = null;
  const closed = b.shut;
  if (closed.length > 0) legacy = "planter";
  const cutLegs: JunctionLeg[] = b.cuts.map((c) => ({ ...legPlain(c.leg), mouth: c.mouth, bandLeft: c.mouth, bandRight: c.mouth, closed: true }));
  const legs: JunctionLeg[] = raw.map((l, i) => {
    const mouth = solved.mouth[i] as number;
    return { ...legPlain(l), mouth, bandLeft: solved.bandLeft[i] as number, bandRight: solved.bandRight[i] as number, ...sidesOf(inp, l, mouth) };
  });
  // A corner has its curb return and its sidewalk only where both legs it joins have them on the sides that meet there; else the pavement turns in a plain radius into gravel.
  const corners = solved.corners.map((k): JunctionCorner => {
    const a = legs[k.from] as JunctionLeg;
    const c = legs[k.to] as JunctionLeg;
    return { ...k, curb: k.shape === "straight" ? a.curbLeft && c.curbRight : a.curbLeft && c.curbRight, walk: a.walkLeft && c.walkRight };
  });
  const closedLegs: JunctionLeg[] = closed.map((q) => ({ ...legPlain(q.leg), mouth: q.mouth, bandLeft: q.left, bandRight: q.right, closed: true }));
  // The stem of a three-way junction: the leg the other two lie most nearly in a line across.
  let stem = -1;
  if (legs.length === 3) {
    let best = Infinity;
    for (let i = 0; i < 3; i++) {
      const a = legs[(i + 1) % 3] as JunctionLeg;
      const c = legs[(i + 2) % 3] as JunctionLeg;
      const d = a.dx * c.dx + a.dz * c.dz;
      if (d < best) {
        best = d;
        stem = i;
      }
    }
  }
  const inCore = core.some((p) => nearPoly(p, { x, z }, 14));
  const near = civic.some((c) => dist2(c, { x, z }) < 45 * 45);
  const weightSum = raw.reduce((s, l) => s + (l.engine ? 0 : weight(l.kind)), 0);
  const streetsIds = b.streets.slice();
  if (cutLegs.length > 0) legacy = "planter";
  return { x, z, legs, corners, closed: [...closedLegs, ...cutLegs], streets: streetsIds, kind, stem, skew, legacy, core: inCore, civic: near, weight: weightSum, hasEngine: b.hasEngine, tight: b.tight };
}

/** Where a leg's curb line (offset `side` from its centre) leaves the pavement polygon, from the leg's reference point. */
function exitOf(poly: readonly Vec[], l: RawLeg, side: number): number {
  const o = onLeg(l, 0, side);
  let best = Infinity;
  for (let k = 0; k < poly.length; k++) {
    const p = poly[k] as Vec;
    const q = poly[(k + 1) % poly.length] as Vec;
    const ex = q.x - p.x;
    const ez = q.z - p.z;
    const den = l.dx * ez - l.dz * ex;
    if (Math.abs(den) < 1e-9) continue;
    const s = ((p.x - o.x) * ez - (p.z - o.z) * ex) / den;
    const u = ((p.x - o.x) * l.dz - (p.z - o.z) * l.dx) / den;
    if (u < -1e-6 || u > 1 + 1e-6 || s < 0) continue;
    best = Math.min(best, s);
  }
  return best === Infinity ? Math.max(l.from, 0) : best;
}

/** Control, marked crosswalks, stop lines, parking hold-backs, ramps and the street-name blades of a junction. */
function decide(p: ReturnType<typeof finish>, id: number, allWay: boolean, inp: JunctionInput): Junction {
  const rng = inp.rng;
  const heavy = p.legs.reduce((m, l) => Math.max(m, l.engine ? 5 : weight(l.kind)), 0);
  const marked = (l: JunctionLeg): boolean => (l.engine ? p.core : l.kind === "main" || l.kind === "avenue" || p.civic);
  // Who stops.
  const stops = p.legs.map((l, i): boolean => {
    if (l.engine) return false;
    if (allWay) return true;
    const w = weight(l.kind);
    if (w < heavy) return true;
    // Streets of equal weight: a tee's stem, the lesser street of a skewed crossing, and either one at a marked crosswalk.
    if (p.legs.length === 3 && p.stem === i) return true;
    if (p.legs.length === 3) return false;
    if (p.kind === "skew" || p.civic) {
      const ids = p.legs.filter((m) => !m.engine).map((m) => m.street);
      const minor = ids.reduce((a, b) => (b > a ? b : a), -1);
      return l.street === minor;
    }
    return false;
  });
  const legs: JunctionLeg[] = p.legs.map((l, i) => {
    const m = marked(l);
    const crosswalk = m ? CROSSWALK_WIDTH : UNMARKED_CROSSWALK;
    const stop = stops[i] as boolean;
    const stopLine = stop ? l.mouth + (m ? CROSSWALK_WIDTH + STOP_LINE_GAP : UNMARKED_STOP_GAP) : null;
    let hold = crosswalk + NO_PARK_CROSSWALK;
    if (stopLine !== null) hold = Math.max(hold, stopLine - l.mouth + STOP_LINE_WIDTH + SIGN_BEHIND_CURB + NO_PARK_STOP);
    return { ...l, marked: m, stops: stop, stopLine, holdBack: hold, centreEnd: l.mouth + crosswalk + CENTRE_SHORT };
  });
  const anyStop = stops.some((s) => s);
  const control: JunctionControl = allWay ? "all-way" : anyStop ? "stop" : "none";
  // Ramps: rebuilt corners have them (the main street, the avenue, the highway, the core, the school and the hospital always); an older block of houses may not.
  const residential = !p.hasEngine && !p.core && !p.civic && p.legs.every((l) => l.kind === "street");
  let ramps = true;
  if (residential) {
    const plat = p.streets.length > 0 ? (inp.streets[p.streets[0] as number] as Street).plat : null;
    const old = plat === "old";
    ramps = !chance(rng, old ? 0.6 : 0.3);
  }
  // Blades: at the first corner between two legs of different streets, preferring the two heaviest.
  let blades: Junction["blades"] = null;
  const idx = p.corners.findIndex((k) => k.shape !== "straight" && (legs[k.from] as JunctionLeg).street !== (legs[k.to] as JunctionLeg).street);
  if (idx >= 0) {
    const k = p.corners[idx] as JunctionCorner;
    blades = { corner: idx, legs: [k.from, k.to] };
  }
  const dotted = legs.some((l) => (l.kind === "main" || l.kind === "avenue") && legs.some((m) => m !== l && m.street === l.street));
  return {
    id,
    kind: p.kind,
    x: p.x,
    z: p.z,
    legs,
    corners: p.corners,
    closed: p.closed,
    stem: p.stem,
    streets: p.streets,
    skew: p.skew,
    legacy: p.legacy,
    tight: p.tight,
    control,
    ramps,
    civic: p.civic,
    core: p.core,
    dotted,
    blades,
    alley: null,
    pavementEnds: null,
    rail: null,
  };
}

/** The legs whose street ends in a made dead end with no other junction between: each carries a DEAD END sign. */
function markDeadEnds(out: Junction[], inp: JunctionInput, byId: (id: number) => G | undefined): void {
  for (let a = 0; a < out.length; a++) {
    const j = out[a] as Junction;
    const legs = j.legs.map((l): JunctionLeg => {
      if (l.engine || l.street < 0) return l;
      const g = byId(l.street);
      if (g === undefined) return l;
      const fwd = l.dx * g.tx + l.dz * g.tz > 0;
      const farEnd = fwd ? "b" : "a";
      const end = inp.ends.find((e) => e.street === l.street && e.at === farEnd);
      if (end === undefined || end.kind === "landing") return l;
      const so = (l.x - g.ax) * g.tx + (l.z - g.az) * g.tz;
      for (let c = 0; c < out.length; c++) {
        if (c === a) continue;
        for (const m of (out[c] as Junction).legs) {
          if (m.street !== l.street) continue;
          const sm = (m.x - g.ax) * g.tx + (m.z - g.az) * g.tz;
          if (fwd ? sm > so + 1 : sm < so - 1) return l;
        }
      }
      return { ...l, deadEnd: true };
    });
    out[a] = { ...j, legs };
  }
}

/** The alley mouths: where an alley's end meets a street's right of way. */
function addAlleys(out: Junction[], inp: JunctionInput, grid: readonly G[]): void {
  for (const al of inp.streets) {
    if (al.kind !== "alley") continue;
    const adx = al.b.x - al.a.x;
    const adz = al.b.z - al.a.z;
    const alen = Math.sqrt(adx * adx + adz * adz);
    if (!(alen > 0.1)) continue;
    for (const end of [0, 1] as const) {
      const e = end === 0 ? al.a : al.b;
      // The direction out of the street: along the alley, away from the end.
      const ux = (end === 0 ? adx : -adx) / alen;
      const uz = (end === 0 ? adz : -adz) / alen;
      let best: G | null = null;
      let bestD = Infinity;
      for (const g of grid) {
        const d = segDist(e, g.street.a, g.street.b);
        if (d < bestD) {
          bestD = d;
          best = g;
        }
      }
      if (best === null || bestD > best.hw + 2.5) continue;
      const g = best;
      const s = (e.x - g.ax) * g.tx + (e.z - g.az) * g.tz;
      if (s < 1 || s > g.length - 1) continue;
      // Where a street is cut (a leg closed with a planter held it back) there is no street for the alley to open on.
      let cutOff = false;
      for (const j of out) {
        for (const c of j.closed) {
          if (c.street !== g.street.id) continue;
          const so = (c.x - g.ax) * g.tx + (c.z - g.az) * g.tz;
          if (c.dx * g.tx + c.dz * g.tz > 0 ? s <= so + c.mouth + 2 : s >= so - c.mouth - 2) cutOff = true;
        }
      }
      if (cutOff) continue;
      // The point on the street's centre line, the side the alley is on, and the alley's line to the street's lot line.
      const lat = (e.x - g.ax) * g.tz - (e.z - g.az) * g.tx;
      const nz = lat > 0 ? 1 : -1;
      const nx = g.tz * nz;
      const nzz = -g.tx * nz;
      const away = ux * nx + uz * nzz;
      if (away < 0.5) continue;
      const gap = Math.max(0, Math.abs(lat) - g.hw);
      const lotX = e.x - ux * (gap / away);
      const lotZ = e.z - uz * (gap / away);
      const centre = { x: g.ax + g.tx * s, z: g.az + g.tz * s };
      const street = g.street;
      const common = { street: street.id, road: -1, kind: street.kind, name: street.name, x: centre.x, z: centre.z, from: 0, roadway: street.roadway, walk: street.walk, width: street.width, half: street.roadway / 2, outer: g.hw, engine: false };
      const legs: JunctionLeg[] = [
        legPlain({ ...common, dx: g.tx, dz: g.tz, to: g.length - s }),
        legPlain({ ...common, dx: -g.tx, dz: -g.tz, to: s }),
        legPlain({ street: al.id, road: -1, kind: "alley", name: al.name, x: lotX, z: lotZ, dx: ux, dz: uz, from: 0, to: alen, roadway: al.roadway, walk: 0, width: al.width, half: al.width / 2, outer: al.width / 2, engine: false }),
      ];
      out.push({
        id: -1, kind: "alley", x: lotX, z: lotZ, legs, corners: [], closed: [], stem: 2, streets: [street.id, al.id].sort((p, q) => p - q), skew: 0, legacy: null, tight: false, control: "none", ramps: false, civic: false, core: false, dotted: false, blades: null,
        alley: { x: lotX, z: lotZ, dx: ux, dz: uz, width: al.width, street: street.id }, pavementEnds: null, rail: null,
      });
    }
  }
}

/** Where a street's end goes on as a road out of town: the street's and the road's legs, and where the pavement ends. */
function addRoadEnds(out: Junction[], inp: JunctionInput): void {
  for (const r of inp.roads) {
    const st = inp.streets[r.from.street];
    if (st === undefined) continue;
    const p0 = r.from.at === "a" ? st.a : st.b;
    const q = r.from.at === "a" ? st.b : st.a;
    const sl = Math.sqrt((q.x - p0.x) * (q.x - p0.x) + (q.z - p0.z) * (q.z - p0.z)) || 1;
    const sdx = (q.x - p0.x) / sl;
    const sdz = (q.z - p0.z) / sl;
    const pts = r.points;
    const first = pts[0] as Road["points"][number];
    let k = 1;
    while (k < pts.length - 1 && (pts[k]!.x - first.x) * (pts[k]!.x - first.x) + (pts[k]!.z - first.z) * (pts[k]!.z - first.z) < 1) k++;
    const rl = Math.sqrt((pts[k]!.x - first.x) * (pts[k]!.x - first.x) + (pts[k]!.z - first.z) * (pts[k]!.z - first.z)) || 1;
    const rdx = (pts[k]!.x - first.x) / rl;
    const rdz = (pts[k]!.z - first.z) / rl;
    const legs: JunctionLeg[] = [
      legPlain({ street: st.id, road: -1, kind: st.kind, name: st.name, x: p0.x, z: p0.z, dx: sdx, dz: sdz, from: 0, to: sl, roadway: st.roadway, walk: st.walk, width: st.width, half: st.roadway / 2, outer: st.width / 2, engine: false }),
      legPlain({ street: -1, road: r.id, kind: "road", name: r.name, x: first.x, z: first.z, dx: rdx, dz: rdz, from: 0, to: r.length, roadway: first.width, walk: 0, width: first.width, half: first.width / 2, outer: first.width / 2, engine: false }),
    ];
    // The pavement ends where the road's surface first is not paved (a clean line; at its start when it never was).
    let at = pts.findIndex((p) => p.surface !== "paved");
    if (at < 0) at = pts.length - 1;
    const e = pts[at] as Road["points"][number];
    const prev = pts[Math.max(0, at - 1)] as Road["points"][number];
    const el = Math.sqrt((e.x - prev.x) * (e.x - prev.x) + (e.z - prev.z) * (e.z - prev.z)) || 1;
    const edx = at === 0 ? rdx : (e.x - prev.x) / el;
    const edz = at === 0 ? rdz : (e.z - prev.z) / el;
    out.push({
      id: -1, kind: "road end", x: p0.x, z: p0.z, legs, corners: [], closed: [], stem: -1, streets: [st.id], skew: 0, legacy: null, tight: false, control: "none", ramps: false, civic: false, core: false, dotted: false, blades: null, alley: null,
      pavementEnds: { x: e.x, z: e.z, dx: edx, dz: edz }, rail: null,
    });
  }
}

/** A flight of public steps meeting a street: no pavement of its own, and the street's strip runs on to it. */
function addStairs(out: Junction[], inp: JunctionInput, grid: readonly G[]): void {
  for (const st of inp.streets) {
    if (st.kind !== "stair") continue;
    const dx = st.b.x - st.a.x;
    const dz = st.b.z - st.a.z;
    const len = Math.sqrt(dx * dx + dz * dz);
    if (!(len > 0.1)) continue;
    for (const end of [0, 1] as const) {
      const e = end === 0 ? st.a : st.b;
      let best: G | null = null;
      let bestD = Infinity;
      for (const g of grid) {
        const d = segDist(e, g.street.a, g.street.b);
        if (d < bestD) {
          bestD = d;
          best = g;
        }
      }
      if (best === null || bestD > best.hw + 0.6) continue;
      const g = best;
      const s = (e.x - g.ax) * g.tx + (e.z - g.az) * g.tz;
      const common = { street: g.street.id, road: -1, kind: g.street.kind, name: g.street.name, from: 0, roadway: g.street.roadway, walk: g.street.walk, width: g.street.width, half: g.street.roadway / 2, outer: g.hw, engine: false };
      const legs: JunctionLeg[] = [];
      const o = { x: g.ax + g.tx * Math.max(0, Math.min(g.length, s)), z: g.az + g.tz * Math.max(0, Math.min(g.length, s)) };
      if (g.length - s > 1) legs.push(legPlain({ ...common, x: o.x, z: o.z, dx: g.tx, dz: g.tz, to: g.length - s }));
      if (s > 1) legs.push(legPlain({ ...common, x: o.x, z: o.z, dx: -g.tx, dz: -g.tz, to: s }));
      legs.push(legPlain({ street: st.id, road: -1, kind: "stair", name: st.name, x: e.x, z: e.z, dx: (end === 0 ? dx : -dx) / len, dz: (end === 0 ? dz : -dz) / len, from: 0, to: len, roadway: st.roadway, walk: 0, width: st.width, half: st.roadway / 2, outer: st.width / 2, engine: false }));
      out.push({
        id: -1, kind: "stair", x: e.x, z: e.z, legs, corners: [], closed: [], stem: -1, streets: [g.street.id, st.id].sort((p, q) => p - q), skew: 0, legacy: null, tight: false, control: "none", ramps: false, civic: false, core: false, dotted: false, blades: null, alley: null,
        pavementEnds: null, rail: null,
      });
    }
  }
}

/** The crossings of the railroad's main line: crossbucks on the right of each approach and a stop line, from the line's centre. */
function addRail(out: Junction[], inp: JunctionInput): void {
  for (const c of inp.rail) {
    const st = c.road ? undefined : inp.streets[c.way];
    const kind: StreetKind | "road" = st === undefined ? "road" : st.kind;
    const name = st === undefined ? (inp.roads.find((r) => r.id === c.way)?.name ?? "road") : st.name;
    const common = { street: st === undefined ? -1 : st.id, road: st === undefined ? c.way : -1, kind, name, x: c.x, z: c.z, from: 0, to: 40, roadway: c.roadway, walk: st === undefined ? 0 : st.walk, width: c.width, half: c.roadway / 2, outer: c.width / 2, engine: false };
    const legs: JunctionLeg[] = [legPlain({ ...common, dx: c.dx, dz: c.dz }), legPlain({ ...common, dx: -c.dx, dz: -c.dz })];
    out.push({
      id: -1, kind: "rail", x: c.x, z: c.z, legs, corners: [], closed: [], stem: -1, streets: st === undefined ? [] : [st.id], skew: 0, legacy: null, tight: false, control: "crossbuck", ramps: false, civic: false, core: false, dotted: false, blades: null, alley: null,
      pavementEnds: null, rail: { crossbuck: RAIL_CROSSBUCK, stopLine: RAIL_STOP_LINE },
    });
  }
}

/** Whether a junction has a pavement of its own (a polygon of roadway the legs end on). */
export function hasPavement(j: Junction): boolean {
  return j.kind === "four-way" || j.kind === "tee" || j.kind === "skew" || j.kind === "highway" || j.kind === "bend";
}

export { areaOf };

/** Where a leg's STOP sign stands: along the leg from its reference point, and to the left of its direction (the right of the approach), 1 ft behind the curb's face. */
export function stopSignSpot(l: { readonly stopLine: number | null; readonly half: number }): { s: number; lat: number } | null {
  if (l.stopLine === null) return null;
  return { s: l.stopLine + STOP_SIGN_AFTER, lat: l.half + SIGN_BEHIND_CURB };
}
