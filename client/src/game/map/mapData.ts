/**
 * The map's data: what a street map of the town draws, made once per world seed from the town's plan and site, in world metres (the plan's
 * frame less the site's anchor, as everything of the game's world is). Pure: no canvas and no DOM. Every feature is put in a grid of
 * `CELL`-metre cells (a feature that crosses several is in each), so that a view draws only the cells it shows.
 *
 * The map is a reader of the simulation's plan and rooms and nothing in `client/src/sim/` reads it.
 */
import { roadCenterX } from "@csarkosh/engine/sim/olympic";
import { hasPavement } from "../../sim/town/junctions.js";
import { pavementPolygon } from "../../sim/town/junctionShape.js";
import { planFor } from "../../sim/town/planFor.js";
import { RAIL_OFFSET } from "../../sim/town/rail.js";
import { siteFor } from "../../sim/town/siteFor.js";
import { ARRIVE_OUT } from "../../sim/inside/rooms.js";
import type { Building, StreetKind } from "../../sim/town/types.js";
import { MAP_BAR_NAME, MAP_CAFE_NAME, MAP_LODGING_NAME, MAP_OFFICE_NAME } from "../words.js";

/** The side of a grid cell, metres. */
export const CELL = 64;
/** How far the highway and the shore are carried north and south of the site, metres from the anchor's z. */
export const REACH = 3000;
/** The pieces the highway's carried-on stretch is cut into, metres. */
const PIECE = 32;
/** The street classes, in drawing order of importance: what a street segment is, for its colour and its width. */
export const HIGHWAY = 0, AVENUE = 1, MAIN = 2, STREET = 3, ALLEY = 4, WHARF = 5, ROAD = 6, TRACK = 7, STAIR = 8, RAIL = 9;
export const CLASS_COUNT = 10;

/** A polygon as x, z pairs in a flat list. */
export type Poly = number[];

/** A straight stretch of a street, road, stair or railroad: its ends, its roadway's width and its class. */
export type Seg = { readonly x0: number; readonly z0: number; readonly x1: number; readonly z1: number; readonly w: number; readonly cls: number; readonly name: string; /** The right of way's width, edge to edge: a street that meets this one ends at its edge, half of this from the centre line. */ readonly rw?: number };

/** A street's name at a place along it: where, which way the street runs (a unit vector) and how long the run of street it belongs to is. */
export type Label = { readonly x: number; readonly z: number; readonly dx: number; readonly dz: number; readonly text: string; readonly run: number; readonly cls: number };

export type PlaceKind = "bar" | "cafe" | "lodging" | "office";

/** One of the four places a player can walk into: its id (the room's), its name, the point in the street at its door, and its building. */
export type MapPlace = { readonly id: number; readonly kind: PlaceKind; readonly name: string; readonly x: number; readonly z: number; readonly building: number };

export type MapCell = {
  readonly cx: number;
  readonly cz: number;
  readonly green: Poly[];
  readonly block: Poly[];
  readonly made: Poly[];
  readonly deck: Poly[];
  readonly pavement: Poly[];
  readonly building: Poly[];
  readonly enterable: Poly[];
  readonly landmark: Poly[];
  readonly streets: Seg[];
  readonly stairs: Seg[];
  readonly rails: Seg[];
  readonly labels: Label[];
};

export type MapCounts = {
  readonly cells: number;
  readonly segments: number;
  readonly pavements: number;
  readonly blocks: number;
  readonly buildings: number;
  readonly enterable: number;
  readonly landmarks: number;
  readonly woods: number;
  readonly made: number;
  readonly decks: number;
  readonly labels: number;
  readonly vertices: number;
};

export type MapData = {
  readonly seed: number;
  /** The shoreline as x, z pairs from south to north, the site's samples with the shore carried straight on (due south and due north, at the end samples' x) to `REACH`: `shoreExtended` says it was. The sea is west of it. */
  readonly shore: readonly number[];
  readonly shoreExtended: true;
  /** The land's east edge, and the world the map covers in z. */
  readonly east: number;
  readonly z0: number;
  readonly z1: number;
  readonly quay: { readonly x0: number; readonly z0: number; readonly x1: number; readonly z1: number };
  readonly places: readonly MapPlace[];
  readonly landmarks: readonly { readonly name: string; readonly role: string; readonly x: number; readonly z: number; readonly building: number }[];
  /** Every street, road out, stair and highway stretch once (the railroad is apart: `rails`): what routes are made from. */
  readonly segments: readonly Seg[];
  readonly rails: readonly Seg[];
  readonly cells: ReadonlyMap<number, MapCell>;
  readonly counts: MapCounts;
  /** How long making the data took, milliseconds. */
  readonly buildMs: number;
};

/** A cell's key in `MapData.cells`. */
export function cellKey(cx: number, cz: number): number {
  return (cx + 4096) * 8192 + (cz + 4096);
}

const CLASS_OF: Record<StreetKind, number> = { highway: HIGHWAY, avenue: AVENUE, main: MAIN, street: STREET, alley: ALLEY, wharf: WHARF, rail: RAIL, stair: STAIR };

const DATA = new Map<number, MapData>();

/** The map's data for a world seed, made on first asking and kept. */
export function mapDataFor(seed: number): MapData {
  let data = DATA.get(seed);
  if (data === undefined) {
    data = buildMapData(seed);
    DATA.set(seed, data);
  }
  return data;
}

/** The shore's x at a z, along the shoreline (the sea lies to the west of it). */
export function shoreAt(data: Pick<MapData, "shore">, z: number): number {
  const s = data.shore;
  const n = s.length / 2;
  if (z <= (s[1] as number)) return s[0] as number;
  for (let i = 1; i < n; i++) {
    const z1 = s[i * 2 + 1] as number;
    if (z <= z1) {
      const z0 = s[i * 2 - 1] as number;
      const t = z1 > z0 ? (z - z0) / (z1 - z0) : 0;
      return (s[i * 2 - 2] as number) * (1 - t) + (s[i * 2] as number) * t;
    }
  }
  return s[(n - 1) * 2] as number;
}

function newCell(cx: number, cz: number): MapCell {
  return { cx, cz, green: [], block: [], made: [], deck: [], pavement: [], building: [], enterable: [], landmark: [], streets: [], stairs: [], rails: [], labels: [] };
}

/** Puts features in the cells they touch. */
class Grid {
  readonly cells = new Map<number, MapCell>();
  vertices = 0;
  at(cx: number, cz: number): MapCell {
    const k = cellKey(cx, cz);
    let c = this.cells.get(k);
    if (c === undefined) {
      c = newCell(cx, cz);
      this.cells.set(k, c);
    }
    return c;
  }
  poly(field: "green" | "block" | "made" | "deck" | "pavement" | "building" | "enterable" | "landmark", p: Poly): void {
    let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
    for (let i = 0; i < p.length; i += 2) {
      x0 = Math.min(x0, p[i] as number);
      x1 = Math.max(x1, p[i] as number);
      z0 = Math.min(z0, p[i + 1] as number);
      z1 = Math.max(z1, p[i + 1] as number);
    }
    this.vertices += p.length / 2;
    for (let cx = Math.floor(x0 / CELL); cx <= Math.floor(x1 / CELL); cx++) for (let cz = Math.floor(z0 / CELL); cz <= Math.floor(z1 / CELL); cz++) this.at(cx, cz)[field].push(p);
  }
  seg(field: "streets" | "stairs" | "rails", s: Seg): void {
    const len = Math.hypot(s.x1 - s.x0, s.z1 - s.z0);
    const n = Math.max(1, Math.ceil(len / (CELL / 4)));
    const seen = new Set<number>();
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      const cx = Math.floor((s.x0 + (s.x1 - s.x0) * t) / CELL);
      const cz = Math.floor((s.z0 + (s.z1 - s.z0) * t) / CELL);
      const k = cellKey(cx, cz);
      if (seen.has(k)) continue;
      seen.add(k);
      this.at(cx, cz)[field].push(s);
    }
  }
}

/** The corners of a building's footprint as a flat polygon, in the plan's frame. */
function footprintOf(b: Building, ax: number, az: number): Poly {
  const ux = b.bearing.a / b.bearing.c;
  const uz = b.bearing.b / b.bearing.c;
  const vx = uz;
  const vz = -ux;
  const out: Poly = [];
  for (const [su, sv] of [[-1, -1], [1, -1], [1, 1], [-1, 1]] as const) {
    out.push(ax + b.centre.x + ux * b.halfAlong * su + vx * b.halfAcross * sv, az + b.centre.z + uz * b.halfAlong * su + vz * b.halfAcross * sv);
  }
  return out;
}

function buildMapData(seed: number): MapData {
  const t0 = performance.now();
  const plan = planFor(seed);
  const site = siteFor(seed);
  const ax = site.anchor.x;
  const az = site.anchor.z;
  const grid = new Grid();
  const segments: Seg[] = [];
  const rails: Seg[] = [];

  // The shore, carried straight on north and south of the site's samples.
  const shore: number[] = [];
  const n = site.shoreX.length;
  shore.push(ax + (site.shoreX[0] as number), az - REACH);
  for (let i = 0; i < n; i++) shore.push(ax + (site.shoreX[i] as number), az + site.z0 + i * site.step);
  shore.push(ax + (site.shoreX[n - 1] as number), az + REACH);

  // Streets, stairs and the highway.
  let highZ0 = Infinity, highZ1 = -Infinity;
  let highS: { x: number; z: number } | null = null;
  let highN: { x: number; z: number } | null = null;
  const addStreet = (s: Seg): void => {
    segments.push(s);
    grid.seg(s.cls === STAIR ? "stairs" : "streets", s);
  };
  for (const st of plan.streets) {
    const cls = CLASS_OF[st.kind];
    const s: Seg = { x0: ax + st.a.x, z0: az + st.a.z, x1: ax + st.b.x, z1: az + st.b.z, w: st.kind === "stair" ? Math.max(st.roadway, 3) : st.roadway, cls, name: st.name, rw: st.width };
    if (cls === RAIL) {
      rails.push(s);
      grid.seg("rails", s);
      continue;
    }
    addStreet(s);
    if (cls === HIGHWAY) {
      if (s.z0 < highZ0) {
        highZ0 = s.z0;
        highS = { x: s.x0, z: s.z0 };
      }
      if (s.z1 > highZ1) {
        highZ1 = s.z1;
        highN = { x: s.x1, z: s.z1 };
      }
    }
  }
  // The highway carried on, by the world's own line for it.
  const carry = (from: { x: number; z: number } | null, to: number, name: string): void => {
    if (from === null) return;
    const dir = to > from.z ? 1 : -1;
    let px = from.x;
    let pz = from.z;
    while ((to - pz) * dir > 1e-6) {
      const z = dir > 0 ? Math.min(to, pz + PIECE) : Math.max(to, pz - PIECE);
      const x = roadCenterX(seed, z);
      addStreet({ x0: px, z0: pz, x1: x, z1: z, w: 11, cls: HIGHWAY, name, rw: 24 });
      px = x;
      pz = z;
    }
  };
  const hwName = plan.streets.find((s) => s.kind === "highway")?.name ?? "";
  carry(highN, az + REACH, hwName);
  carry(highS, az - REACH, hwName);

  // Roads out of town.
  for (const road of plan.roads) {
    for (let i = 1; i < road.points.length; i++) {
      const a = road.points[i - 1]!;
      const b = road.points[i]!;
      addStreet({ x0: ax + a.x, z0: az + a.z, x1: ax + b.x, z1: az + b.z, w: (a.width + b.width) / 2, cls: b.surface === "paved" ? ROAD : TRACK, name: road.name, rw: (a.width + b.width) / 2 + 4 });
    }
  }

  // The railroad: the main line, carried on by the world's line for it, and the town's spur.
  const main = plan.rail.main;
  if (main.length > 1) {
    for (let i = 1; i < main.length; i++) {
      const a = main[i - 1]!;
      const b = main[i]!;
      const s: Seg = { x0: ax + a.x, z0: az + a.z, x1: ax + b.x, z1: az + b.z, w: 1.6, cls: RAIL, name: "" };
      rails.push(s);
      grid.seg("rails", s);
    }
    const carryRail = (from: { x: number; z: number }, to: number): void => {
      const dir = to > from.z ? 1 : -1;
      let px = ax + from.x;
      let pz = az + from.z;
      while ((to - pz) * dir > 1e-6) {
        const z = dir > 0 ? Math.min(to, pz + PIECE * 2) : Math.max(to, pz - PIECE * 2);
        const x = roadCenterX(seed, z) - RAIL_OFFSET;
        const s: Seg = { x0: px, z0: pz, x1: x, z1: z, w: 1.6, cls: RAIL, name: "" };
        rails.push(s);
        grid.seg("rails", s);
        px = x;
        pz = z;
      }
    };
    carryRail(main[main.length - 1]!, az + REACH);
    carryRail(main[0]!, az - REACH);
  }
  for (const sp of plan.rail.spurs) {
    for (let i = 1; i < sp.points.length; i++) {
      const a = sp.points[i - 1]!;
      const b = sp.points[i]!;
      const s: Seg = { x0: ax + a.x, z0: az + a.z, x1: ax + b.x, z1: az + b.z, w: 1.6, cls: RAIL, name: "" };
      rails.push(s);
      grid.seg("rails", s);
    }
  }

  // Ground: made ground, woods, blocks, the decks over the water, and the junctions' pavements.
  const shift = (poly: readonly { x: number; z: number }[]): Poly => {
    const out: Poly = [];
    for (const p of poly) out.push(ax + p.x, az + p.z);
    return out;
  };
  for (const f of plan.fill) grid.poly("made", shift(f.polygon));
  for (const w of plan.woods) grid.poly("green", shift(w.polygon));
  for (const b of plan.blocks) grid.poly("block", shift(b.polygon));
  for (const d of plan.decks) {
    const px = d.axis.z;
    const pz = -d.axis.x;
    const p: Poly = [];
    for (const [a, b] of [[-1, -1], [1, -1], [1, 1], [-1, 1]] as const) p.push(ax + d.centre.x + d.axis.x * d.halfAlong * a + px * d.halfAcross * b, az + d.centre.z + d.axis.z * d.halfAlong * a + pz * d.halfAcross * b);
    grid.poly("deck", p);
  }
  let pavements = 0;
  for (const j of plan.junctions) {
    if (j.kind === "alley" || !hasPavement(j)) continue;
    const shape = pavementPolygon(j.legs, j.corners);
    if (shape.length < 3) continue;
    grid.poly("pavement", shift(shape));
    pavements++;
  }

  // The four places, from the plan alone: the rooms' own list would build every room's design first.
  const landmarkBuildings = new Set<number>();
  for (const l of plan.landmarks) if (l.building >= 0) landmarkBuildings.add(l.building);
  const hall = plan.landmarks.find((l) => l.role === "municipal building");
  const places: MapPlace[] = [];
  const specs = [["bar", plan.places.bar, MAP_BAR_NAME], ["cafe", plan.places.cafe, MAP_CAFE_NAME], ["lodging", plan.places.lodging, MAP_LODGING_NAME], ["office", plan.places.office, MAP_OFFICE_NAME]] as const;
  for (let i = 0; i < specs.length; i++) {
    const [kind, place, fallback] = specs[i] as (typeof specs)[number];
    const use = plan.uses[place.building];
    const fr = use?.frame;
    if (fr === undefined || fr === null) continue;
    let doorS: number;
    let name: string;
    if (kind === "office") {
      if (place.door === null) continue;
      doorS = place.door.s;
      name = hall?.name ?? fallback;
    } else {
      const unit = use?.units.find((u) => u.id === place.unit);
      if (unit === undefined) continue;
      doorS = unit.door.s;
      name = unit.tenant?.name ?? fallback;
    }
    // The point `arriveOut` of the room gives: 0.9 m out from the street door, along the front's outward normal.
    places.push({ id: i + 1, kind, name: name.length > 0 ? name : fallback, x: ax + fr.origin.x + fr.t.x * doorS + fr.n.x * ARRIVE_OUT, z: az + fr.origin.z + fr.t.z * doorS + fr.n.z * ARRIVE_OUT, building: place.building });
  }
  const enterable = new Set<number>(places.map((p) => p.building));
  let nEnterable = 0;
  let nLandmark = 0;
  for (const b of plan.buildings) {
    const fp = footprintOf(b, ax, az);
    if (enterable.has(b.id)) {
      grid.poly("enterable", fp);
      nEnterable++;
    } else if (landmarkBuildings.has(b.id)) {
      grid.poly("landmark", fp);
      nLandmark++;
    } else grid.poly("building", fp);
  }
  const landmarks = plan.landmarks.map((l) => {
    const b = plan.buildings[l.building];
    return { name: l.name, role: l.role, x: ax + (l.at?.x ?? b?.centre.x ?? 0), z: az + (l.at?.z ?? b?.centre.z ?? 0), building: l.building };
  });

  const labels = labelsOf(segments);
  for (const l of labels) grid.at(Math.floor(l.x / CELL), Math.floor(l.z / CELL)).labels.push(l);

  const data: MapData = {
    seed,
    shore,
    shoreExtended: true,
    east: ax + 6000,
    z0: az - REACH,
    z1: az + REACH,
    quay: { x0: ax + plan.quay.a.x, z0: az + plan.quay.a.z, x1: ax + plan.quay.b.x, z1: az + plan.quay.b.z },
    places,
    landmarks,
    segments,
    rails,
    cells: grid.cells,
    counts: {
      cells: grid.cells.size,
      segments: segments.length,
      pavements,
      blocks: plan.blocks.length,
      buildings: plan.buildings.length,
      enterable: nEnterable,
      landmarks: nLandmark,
      woods: plan.woods.length,
      made: plan.fill.length,
      decks: plan.decks.length,
      labels: labels.length,
      vertices: grid.vertices,
    },
    buildMs: 0,
  };
  return { ...data, buildMs: performance.now() - t0 };
}

/**
 * The street-name labels: the segments of one name and class are joined into runs wherever one's end is another's start, and each run
 * of 20 m or more takes one label for every 250 m of its length, each in the middle of its share, turned along the street there.
 * Alleys, stairs and wheel tracks carry none.
 */
export function labelsOf(segments: readonly Seg[]): Label[] {
  const byName = new Map<string, Seg[]>();
  for (const s of segments) {
    if (s.name === "" || s.cls === ALLEY || s.cls === STAIR || s.cls === TRACK) continue;
    const key = `${s.name}|${s.cls}`;
    const list = byName.get(key);
    if (list === undefined) byName.set(key, [s]);
    else list.push(s);
  }
  const out: Label[] = [];
  const at = (x: number, z: number): string => `${x.toFixed(1)},${z.toFixed(1)}`;
  for (const list of byName.values()) {
    // The segments by the ends they have.
    const ends = new Map<string, number[]>();
    list.forEach((s, i) => {
      for (const k of [at(s.x0, s.z0), at(s.x1, s.z1)]) {
        const e = ends.get(k);
        if (e === undefined) ends.set(k, [i]);
        else e.push(i);
      }
    });
    const used = new Array<boolean>(list.length).fill(false);
    const other = (k: string): number => (ends.get(k) ?? []).find((j) => !used[j]) ?? -1;
    for (let i = 0; i < list.length; i++) {
      if (used[i]) continue;
      used[i] = true;
      const first = list[i] as Seg;
      const pts: { x: number; z: number }[] = [{ x: first.x0, z: first.z0 }, { x: first.x1, z: first.z1 }];
      // Forward from the last point, then backward from the first.
      for (const dir of [1, -1]) {
        for (;;) {
          const tip = dir > 0 ? pts[pts.length - 1]! : pts[0]!;
          const j = other(at(tip.x, tip.z));
          if (j < 0) break;
          used[j] = true;
          const s = list[j] as Seg;
          const far = at(s.x0, s.z0) === at(tip.x, tip.z) ? { x: s.x1, z: s.z1 } : { x: s.x0, z: s.z0 };
          if (dir > 0) pts.push(far);
          else pts.unshift(far);
        }
      }
      let len = 0;
      for (let k = 1; k < pts.length; k++) len += Math.hypot(pts[k]!.x - pts[k - 1]!.x, pts[k]!.z - pts[k - 1]!.z);
      if (len < 20) continue;
      const count = Math.max(1, Math.round(len / 250));
      for (let c = 0; c < count; c++) {
        let want = ((c + 0.5) * len) / count;
        for (let k = 1; k < pts.length; k++) {
          const a = pts[k - 1]!;
          const b = pts[k]!;
          const l = Math.hypot(b.x - a.x, b.z - a.z);
          if (want <= l || k === pts.length - 1) {
            const t = l > 0 ? Math.min(1, want / l) : 0;
            out.push({ x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t, dx: l > 0 ? (b.x - a.x) / l : 1, dz: l > 0 ? (b.z - a.z) / l : 0, text: first.name, run: len, cls: first.cls });
            break;
          }
          want -= l;
        }
      }
    }
  }
  return out;
}
