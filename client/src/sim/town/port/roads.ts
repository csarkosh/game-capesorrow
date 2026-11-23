/**
 * The roads out of town: the game's way out to its other places, later. A few roads leave, as real ones do, each continuing
 * from the end of a grid street as a curving road that follows the land, narrowing from paved to gravel to two wheel tracks,
 * and ending at something: a cemetery on the hill, a landing where logs were loaded, a gravel pit, a water tank, a gate.
 *
 * - **Inland**, one or two from the grid's inland ends, up the hill: a county road to the cemetery (always), and, on most
 *   towns, an old logging road to a landing, a gravel pit or a water tank.
 * - **Along the shore's flats**, north and south, from the grid's north and south ends, where there is room between the
 *   water and the highway and the highway is not the way (a shore road is kept at least `SHORE_ROAD_FROM_HIGHWAY` metres west of it).
 *
 * **How a road finds its line.** It is stepped across the site's ground (`site.ground`, the coast's own heights on a 16 m grid) in
 * steps of `STEP` metres. At each step the heading may turn by none, or by one of three small turns either way, each turn an exact
 * Pythagorean rotation (no angle is computed); every candidate is costed by the grade along it (a hard limit and a soft one), the
 * grade across it, how far it turns, how far it points from where the road is going, and (inland) a reward for climbing; a step into
 * a block, near a building's block, near another road, near the highway, or into the sea is not taken. The cheapest candidate wins, ties
 * going to the straighter. A road stops at its destination: after its least length, at the first place the ground is flat enough, or at
 * its greatest. All of it is `+ - * /` and `sqrt` on the grid's heights, so every machine steps the same line.
 */
import { dist, segDist, type Poly, type Vec } from "../geom.js";
import type { TownNames } from "../names.js";
import { chance, int, pick, shuffled, type Rng } from "../rng.js";
import { roadAt, shoreAt } from "../shore.js";
import { groundAt, type TownSite } from "../site.js";
import type { Destination, DestinationKind, HistoryEvent, Landmark, Road, RoadPoint, RoadSurface, Street, StreetEnd } from "../types.js";

/** The step along a road, metres. */
export const STEP = 12;
/** The turns a step may take, as Pythagorean triples (cos, sin): 7.6, 16.3 and 22.6 degrees, and the larger ones below. */
const TURN_TRIPLES = [
  { c: 112 / 113, s: 15 / 113 },
  { c: 24 / 25, s: 7 / 25 },
  { c: 12 / 13, s: 5 / 13 },
  // The larger turns, for ground too steep to climb straight: a road takes the slope at a slant, and turns back on itself.
  { c: 4 / 5, s: 3 / 5 },
  { c: 3 / 5, s: 4 / 5 },
  { c: 5 / 13, s: 12 / 13 },
  { c: 0, s: 1 },
] as const;
/** The grade a step is held to, hard and soft (a soft grade costs, a hard one is not taken). */
export const GRADE_HARD = 0.09;
/** Where the strict limits find no road of at least the least length, the relaxed ones are tried: a step may be this much steeper. */
export const GRADE_RELAX = 0.01;
export const GRADE_SOFT = 0.05;
/** The grade a road is held to over any two steps (about 20 m): the coast's own ground is rougher between the grid's points than the grid says, and the limit leaves room for it. */
export const GRADE_RUN = 0.07;
/** A road keeps this far from a block, from the highway's centre line, from another road. */
export const BLOCK_CLEAR = 10;
/** Past the first steps a road keeps this far from every block: the made ground's fade lies about the town, and a road there would not lie on the ground it was stepped over. */
export const BLOCK_FAR = 110;
export const HIGHWAY_CLEAR = 36;
export const ROAD_CLEAR = 26;
/** A shore road keeps this far west of the highway, and from the water, metres; the ground it runs on is at least this high. */
export const SHORE_ROAD_FROM_HIGHWAY = 26;
export const SHORE_CLEAR = 18;
export const LAND_HEIGHT = 3;
/** A road's least and greatest length, metres; it stops at the first flat place after the least. */
export const LEAST_LENGTH = 300;
export const MOST_LENGTH = 480;
/** The ground is flat enough for a destination where its slope is under this. */
export const FLAT_ENOUGH = 0.08;
/** Steps held out of the clearances at a road's start, where it leaves the town. */
const FREE_STEPS = 14;
/** A road may leave a junction where no block stands within this of the line ahead of it, metres. */
const EXIT_CLEAR = 14;

export const ROAD_TUNABLES = { STEP, GRADE_HARD, GRADE_SOFT, GRADE_RUN, GRADE_RELAX, BLOCK_CLEAR, BLOCK_FAR, HIGHWAY_CLEAR, ROAD_CLEAR, SHORE_ROAD_FROM_HIGHWAY, SHORE_CLEAR, LAND_HEIGHT, LEAST_LENGTH, MOST_LENGTH, FLAT_ENOUGH };

type Box = { x0: number; z0: number; x1: number; z1: number };

type Surfaces = { paved: number; gravel: number };

/** How long each surface lasts along a road, by its kind: where it is paved to, and where gravel gives way to tracks. */
const SURFACES: Record<Road["kind"], Surfaces> = {
  county: { paved: 130, gravel: 260 },
  logging: { paved: 36, gravel: 150 },
  shore: { paved: 70, gravel: 190 },
};

/** The road's width at a distance along it: from the street's roadway, narrowing over the paved length to 6 m, over the gravel to 4.2 m, then two wheel tracks. */
function widthAt(s: number, start: number, kind: Road["kind"], length: number): number {
  const { paved, gravel } = SURFACES[kind];
  if (s <= paved) return start + ((6 - start) * s) / paved;
  if (s <= gravel) return 6 + ((4.2 - 6) * (s - paved)) / (gravel - paved);
  return Math.max(3, 4.2 + ((3 - 4.2) * (s - gravel)) / Math.max(1, length - gravel));
}

function surfaceAt(s: number, kind: Road["kind"]): RoadSurface {
  const { paved, gravel } = SURFACES[kind];
  return s <= paved ? "paved" : s <= gravel ? "gravel" : "tracks";
}

type Terrain = {
  /** The height at a point of the site's frame. */
  h(x: number, z: number): number;
  /** The slope's magnitude there. */
  slope(x: number, z: number): number;
};

function terrainOf(site: TownSite): Terrain | null {
  const grid = site.ground;
  if (grid === undefined) return null;
  const e = 6;
  return {
    h: (x, z) => groundAt(grid, x, z),
    slope: (x, z) => {
      const dx = (groundAt(grid, x + e, z) - groundAt(grid, x - e, z)) / (2 * e);
      const dz = (groundAt(grid, x, z + e) - groundAt(grid, x, z - e)) / (2 * e);
      return Math.sqrt(dx * dx + dz * dz);
    },
  };
}

type Course = {
  site: TownSite;
  terrain: Terrain;
  blocks: readonly Poly[];
  boxes: readonly Box[];
  roads: readonly (readonly Vec[])[];
  /** Which way the road is going (a unit vector), and whether it climbs. */
  toward: Vec;
  climb: boolean;
  shore: boolean;
  /** What the limits are loosened by (0, or `GRADE_RELAX`). */
  relax: number;
};

function boxOf(poly: Poly): Box {
  let x0 = Infinity;
  let z0 = Infinity;
  let x1 = -Infinity;
  let z1 = -Infinity;
  for (const p of poly) {
    x0 = Math.min(x0, p.x);
    z0 = Math.min(z0, p.z);
    x1 = Math.max(x1, p.x);
    z1 = Math.max(z1, p.z);
  }
  return { x0, z0, x1, z1 };
}

/** The distance from a point to the nearest block (0 inside it). */
function blockDistance(c: Course, p: Vec, reach: number): number {
  let d = Infinity;
  for (let i = 0; i < c.blocks.length; i++) {
    const b = c.boxes[i] as Box;
    if (p.x < b.x0 - reach || p.x > b.x1 + reach || p.z < b.z0 - reach || p.z > b.z1 + reach) continue;
    const poly = c.blocks[i] as Poly;
    for (let k = 0; k < poly.length; k++) d = Math.min(d, segDist(p, poly[k] as Vec, poly[(k + 1) % poly.length] as Vec));
    if (inside(poly, p)) return 0;
  }
  return d;
}

function inside(poly: Poly, p: Vec): boolean {
  let neg = false;
  let pos = false;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i] as Vec;
    const b = poly[(i + 1) % poly.length] as Vec;
    const cross = (b.x - a.x) * (p.z - a.z) - (b.z - a.z) * (p.x - a.x);
    if (cross < 0) neg = true;
    if (cross > 0) pos = true;
  }
  return !(neg && pos);
}

/** The cheapest next point from `p` heading `d`, or null where none may be taken. */
function nextStep(c: Course, line: readonly Vec[], d: Vec, step: number): { p: Vec; d: Vec } | null {
  const t = c.terrain;
  const p = line[line.length - 1] as Vec;
  // The point a step before this one: from it to the candidate is two steps of road, 24 m along it (the grade over 20 m is measured along the road).
  const back = line[Math.max(0, line.length - 2)] as Vec;
  const backLength = line.length >= 2 ? 2 * STEP : STEP;
  const here = t.h(p.x, p.z);
  const hBack = t.h(back.x, back.z);
  let best: { p: Vec; d: Vec } | null = null;
  let bestCost = Infinity;
  // Straight first, then the small turn each way, the middle, the large: ties go to the straighter.
  const options: { c: number; s: number; w: number }[] = [{ c: 1, s: 0, w: 0 }];
  for (let k = 0; k < TURN_TRIPLES.length; k++) {
    const tr = TURN_TRIPLES[k] as (typeof TURN_TRIPLES)[number];
    options.push({ c: tr.c, s: tr.s, w: k + 1 }, { c: tr.c, s: -tr.s, w: k + 1 });
  }
  for (const o of options) {
    const nd = { x: d.x * o.c - d.z * o.s, z: d.x * o.s + d.z * o.c };
    const q = { x: p.x + nd.x * STEP, z: p.z + nd.z * STEP };
    const hq = t.h(q.x, q.z);
    const g = Math.abs(hq - here) / STEP;
    if (g > GRADE_HARD + c.relax) continue;
    if (hq < LAND_HEIGHT) continue;
    // Over the last 24 m as well: no 20 m of the road is steeper than the grade held to.
    if (Math.abs(hq - hBack) / backLength > GRADE_RUN + c.relax) continue;
    // A look further along the same heading: the road is not led up to a wall.
    const far = { x: q.x + nd.x * STEP * 2, z: q.z + nd.z * STEP * 2 };
    const gFar = Math.abs(t.h(far.x, far.z) - hq) / (STEP * 2);
    // Across the road.
    const nx = nd.z;
    const nz = -nd.x;
    const cross = Math.abs(t.h(q.x + nx * 4, q.z + nz * 4) - t.h(q.x - nx * 4, q.z - nz * 4)) / 8;
    // The first steps leave the street's end, near the blocks about it, but never into one.
    if (blockDistance(c, q, BLOCK_CLEAR) < (step >= 2 ? BLOCK_CLEAR : 3)) continue;
    if (step >= FREE_STEPS) {
      if (blockDistance(c, q, BLOCK_FAR) < BLOCK_FAR) continue;
      let near = false;
      for (const r of c.roads) {
        for (let i = 0; i < r.length && !near; i++) if (dist(q, r[i] as Vec) < ROAD_CLEAR) near = true;
        if (near) break;
      }
      if (near) continue;
    }
    const hwy = roadAt(c.site, q.z);
    if (c.shore) {
      if (q.x > hwy - SHORE_ROAD_FROM_HIGHWAY) continue;
      if (q.x < shoreAt(c.site, q.z) + SHORE_CLEAR) continue;
    } else if (Math.abs(q.x - hwy) < HIGHWAY_CLEAR) continue;
    const soft = g > GRADE_SOFT + c.relax ? (g - GRADE_SOFT - c.relax) * 120 : 0;
    const softFar = gFar > GRADE_SOFT + c.relax ? (gFar - GRADE_SOFT - c.relax) * 40 : 0;
    const signed = (hq - here) / STEP;
    const climb = c.climb ? -0.9 * Math.min(Math.max(signed, 0), 0.06) : 0;
    const cost = 6 * g + soft + softFar + 3 * cross + 2.2 * (1 - (nd.x * c.toward.x + nd.z * c.toward.z)) + 0.03 * o.w * o.w + climb;
    if (cost < bestCost - 1e-12) {
      bestCost = cost;
      best = { p: q, d: nd };
    }
  }
  return best;
}

/** A road's line from a street end: stepped to its destination, or null where it finds no way. */
function route(c: Course, start: Vec, dir: Vec): Vec[] | null {
  const line: Vec[] = [start];
  let p = start;
  let d = dir;
  const most = Math.floor(MOST_LENGTH / STEP);
  const least = Math.floor(LEAST_LENGTH / STEP);
  for (let k = 0; k < most; k++) {
    const nx = nextStep(c, line, d, k);
    if (nx === null) break;
    p = nx.p;
    d = nx.d;
    line.push(p);
    if (k + 1 >= least && c.terrain.slope(p.x, p.z) < FLAT_ENOUGH) break;
  }
  return line.length * STEP >= (c.shore || c.relax > GRADE_RELAX ? 150 : LEAST_LENGTH * 0.9) ? line : null;
}

const DESTINATION_RADIUS: Record<DestinationKind, number> = { cemetery: 28, landing: 22, "gravel pit": 18, "water tank": 9, gate: 7 };

/**
 * Where a grid street's end is a junction (the grown town closes its outer edge with a street across) and nothing stands beyond it: a road
 * may leave from there, straight on past the last intersection, as a country road leaves a town's last corner.
 */
function outwardEnds(streets: readonly Street[], ends: readonly StreetEnd[], blocks: readonly Poly[], boxes: readonly Box[]): StreetEnd[] {
  const out: StreetEnd[] = [];
  const clearAhead = (p: Vec): boolean => {
    for (let i = 0; i < blocks.length; i++) {
      const b = boxes[i] as Box;
      if (p.x < b.x0 - EXIT_CLEAR || p.x > b.x1 + EXIT_CLEAR || p.z < b.z0 - EXIT_CLEAR || p.z > b.z1 + EXIT_CLEAR) continue;
      const poly = blocks[i] as Poly;
      if (inside(poly, p)) return false;
      for (let k = 0; k < poly.length; k++) if (segDist(p, poly[k] as Vec, poly[(k + 1) % poly.length] as Vec) < EXIT_CLEAR) return false;
    }
    return true;
  };
  for (const st of streets) {
    if (st.kind !== "street" && st.kind !== "main" && st.kind !== "avenue") continue;
    for (const at of ["a", "b"] as const) {
      if (ends.some((e) => e.street === st.id && e.at === at)) continue;
      const p = at === "a" ? st.a : st.b;
      const q = at === "a" ? st.b : st.a;
      const len = dist(p, q);
      if (len < 1e-6) continue;
      const dir = { x: (p.x - q.x) / len, z: (p.z - q.z) / len };
      let free = true;
      for (const t of [20, 40, 65]) if (!clearAhead({ x: p.x + dir.x * t, z: p.z + dir.z * t })) free = false;
      if (free) out.push({ street: st.id, at, x: p.x, z: p.z, dx: dir.x, dz: dir.z, kind: "turnaround" });
    }
  }
  return out;
}

/** The roads out of a town. `ends` are the plan's street ends: the road that continues one is no end, and is left out of the list returned. */
export function planRoads(
  site: TownSite,
  streets: readonly Street[],
  ends: readonly StreetEnd[],
  blocks: readonly Poly[],
  names: TownNames,
  townName: string,
  rng: Rng,
): { roads: Road[]; ends: StreetEnd[] } {
  const terrain = terrainOf(site);
  if (terrain === null) return { roads: [], ends: ends.slice() };
  const lines: Vec[][] = [];
  const roads: Road[] = [];
  const taken: StreetEnd[] = [];
  const boxes = blocks.map(boxOf);
  const grid: readonly Street["kind"][] = ["street", "main", "avenue"];
  const exits = outwardEnds(streets, ends, blocks, boxes);
  const usable = [...ends.filter((e) => e.kind !== "landing" && grid.includes((streets[e.street] as Street).kind)), ...exits];
  const named = names.named.length > 0 ? names.named : ["Back"];

  const make = (kind: Road["kind"], end: StreetEnd, toward: Vec, dest: DestinationKind, label: string, relax = 0): boolean => {
    const course: Course = { site, terrain, blocks, boxes, roads: lines, toward, climb: kind !== "shore", shore: kind === "shore", relax };
    const line = route(course, { x: end.x, z: end.z }, { x: end.dx, z: end.dz });
    if (line === null) return false;
    const st = streets[end.street] as Street;
    let length = 0;
    const points: RoadPoint[] = line.map((p, i) => {
      if (i > 0) length += dist(p, line[i - 1] as Vec);
      return { x: p.x, z: p.z, width: 0, surface: "paved" as RoadSurface };
    });
    const total = length;
    let s = 0;
    const shaped: RoadPoint[] = points.map((p, i) => {
      if (i > 0) s += dist(p, points[i - 1] as RoadPoint);
      return { x: p.x, z: p.z, width: widthAt(s, st.roadway, kind, total), surface: surfaceAt(s, kind) };
    });
    const last = shaped[shaped.length - 1] as RoadPoint;
    const destination: Destination = { kind: dest, name: label, x: last.x, z: last.z, radius: DESTINATION_RADIUS[dest] };
    roads.push({ id: roads.length, name: `${pick(rng, named)} ${kind === "county" ? "County Road" : kind === "logging" ? "Logging Road" : "Shore Road"}`, kind, from: { street: end.street, at: end.at }, points: shaped, destination, length: total });
    lines.push(line);
    taken.push(end);
    return true;
  };

  // Inland: from the grid's ends that point inland, away from the highway, a county road to the cemetery on the hill.
  const east = shuffled(rng, usable.filter((e) => e.dx > 0.85 && e.x - roadAt(site, e.z) > 120));
  let made = 0;
  // The county road to the cemetery: every end tried with the strict limits first, and only then with the relaxed, and on the steepest hills the most relaxed with a shorter road.
  for (const relax of [0, GRADE_RELAX, 2.5 * GRADE_RELAX]) {
    for (const e of east) {
      if (made === 0 && make("county", e, { x: 1, z: 0 }, "cemetery", `${townName} Cemetery`, relax)) made++;
    }
    if (made > 0) break;
  }
  for (const e of east) {
    if (made === 1 && Math.abs(e.z - (roads[0] as Road).points[0]!.z) > 120 && chance(rng, 0.75)) {
      const kind = pick(rng, ["landing", "gravel pit", "water tank"] as const);
      const label = kind === "landing" ? `${pick(rng, named)} Landing` : kind === "gravel pit" ? `County gravel pit` : `${townName} Water Tank`;
      if (make("logging", e, { x: 1, z: 0 }, kind, label)) made++;
    }
    if (made >= 2) break;
  }

  // Along the shore's flats, north and south, where there is room between the water and the highway.
  for (const north of [true, false]) {
    const cands = usable.filter((e) => (north ? e.dz > 0.85 : e.dz < -0.85) && e.x < roadAt(site, e.z) - SHORE_ROAD_FROM_HIGHWAY - 6 && !taken.includes(e));
    cands.sort((a, b) => (north ? b.z - a.z : a.z - b.z) || a.x - b.x);
    for (const e of cands.slice(0, 3)) {
      const kind = pick(rng, ["landing", "gate", "gravel pit"] as const);
      const label = kind === "landing" ? `${pick(rng, named)} Landing` : kind === "gate" ? `${names.millCompany} gate` : `County gravel pit`;
      if (make("shore", e, { x: 0, z: north ? 1 : -1 }, kind, label)) break;
    }
  }
  return { roads, ends: ends.filter((e) => !taken.includes(e)) };
}

/**
 * A sentence of the history for each road, and a landmark for each destination (a place that is no building, with its position).
 * The year is drawn from the roads' own stream, between the town's founding and 1948.
 */
export function describeRoads(roads: readonly Road[], streets: readonly Street[], names: TownNames, townName: string, foundedIn: number, rng: Rng): { events: HistoryEvent[]; landmarks: Omit<Landmark, "id">[] } {
  const events: HistoryEvent[] = [];
  const landmarks: Omit<Landmark, "id">[] = [];
  for (const road of roads) {
    const year = int(rng, foundedIn + 12, 1948);
    const street = (streets[road.from.street] as Street).name;
    const d = road.destination;
    let text: string;
    let line: string;
    switch (d.kind) {
      case "cemetery":
        text = `The county lays ${road.name} up the hill from the end of ${street} to ${d.name}, because the old burying ground by the water had filled and flooded.`;
        line = `${d.name}, on the hill at the end of ${road.name}, which leaves ${street} paved and ends in two wheel tracks.`;
        break;
      case "landing":
        text = `The ${names.millCompany} cuts ${road.name} out from the end of ${street} to ${d.name}, where logs were loaded; the pavement stops, then the gravel, and the last of it is two wheel tracks under the trees.`;
        line = `${d.name}, a cleared flat where logs were loaded, at the end of ${road.name} off ${street}.`;
        break;
      case "gravel pit":
        text = `The county opens a gravel pit at the end of ${road.name}, which leaves ${street}, and hauls from it for the streets of ${townName}.`;
        line = `${d.name}, at the end of ${road.name} off ${street}: a pit the county dug for its roads.`;
        break;
      case "water tank":
        text = `${townName} builds a water tank on the hill above ${street} and a road to it, ${road.name}.`;
        line = `${d.name}, on the hill at the end of ${road.name} off ${street}.`;
        break;
      case "gate":
        text = `The ${names.millCompany} gates ${road.name} where the town's shore road gives out, and the road beyond is the company's.`;
        line = `${d.name}, across ${road.name}, the shore road that leaves from ${street}.`;
        break;
    }
    events.push({ year, kind: "road", text });
    landmarks.push({ role: d.kind, name: d.name, building: -1, at: { x: d.x, z: d.z }, text: line });
  }
  return { events, landmarks };
}
