/**
 * What stands beside each street's roadway and how the roadway was laid: which sides have a sidewalk and a curb, where the
 * sidewalk stops, when each stretch of it was poured, how much of the curb shows, where the roadway was repaved. The history
 * decides, as it did in the real towns of this coast (Raymond, South Bend, Ilwaco, Hoquiam): a town pours its sidewalks where
 * the money is, block by block over a century, and a street of the town's later additions or edges never got them.
 *
 * - **The core** (the main street, the avenue, streets between shops and the civic blocks): a sidewalk on both sides all the
 *   way, wide, kept up, each block poured in its own decade.
 * - **The old plat's house streets**: usually both sides (88 percent of sides have any), but old: a stretch here and there
 *   missing (a gap every 100 m or so, 5 to 25 m long), the rest poured over the decades and worn.
 * - **The company's later plat**: none, one side (the first one the owners laid) or both; where there is one it may stop
 *   mid-block, where the money ran out.
 * - **The edges** (the last streets of the later plat, far from the core): mostly none; where there is one it is on the side
 *   near the town and stops short. No curb on a side that has no sidewalk (and none on many that have); the asphalt ends in
 *   a ragged edge against a gravel shoulder, with a shallow ditch beyond it on more than half.
 * - **Curbs** are poured with the sidewalk and stand 15 cm (6 in, the research) over the gutter where the street was
 *   rebuilt; each overlay of asphalt since buried 3.5 cm of it, to not less than 5 cm. A stretch of roadway has its own paving
 *   (a decade and a wear), so a street's curb steps down where it was overlaid, with the seam across the roadway.
 *
 * Every number here is authored: the research found no source for any share of sidewalk coverage, the length of a pour or
 * the wear of a decade. They follow how such towns look. One stream, `edges`, so a draw added here moves no other stage.
 */
import { contains, dist, type Poly, type Vec } from "../geom.js";
import { lotIdAt } from "../lotIndex.js";
import { chance, int, next, range, type Rng } from "../rng.js";
import type { Block, Building, District, History, Lot, Paving, SideEdge, Street, StreetEdge, TownPlan, WalkRun } from "../types.js";

export type EdgeInput = {
  readonly streets: readonly Street[];
  readonly blocks: readonly Block[];
  readonly lots: readonly Lot[];
  readonly buildings: readonly Building[];
  readonly history: History;
  readonly rng: Rng;
};

/** The year the town's present is taken at, for the age of a pour. */
const NOW = 2026;
/** A street's curb and gutter, the face that shows where it was rebuilt, and what an overlay of asphalt buries. */
export const CURB_REBUILT = 0.15;
export const CURB_OVERLAY = 0.035;
export const CURB_LEAST = 0.05;
/** The streets of the later plat farther than this from the core (metres) are the town's edge. */
export const EDGE_DISTANCE = 400;
/** Samples along a street, metres apart, that say which districts it runs between. */
const SAMPLE = 15;

const PAVED_DISTRICTS: readonly District[] = ["core", "dock", "waterfront", "mill", "industrial", "highway strip", "civic"];

/** The decades a pour may be of, with the weight of each (authored: the booms, the New Deal, the 1950s, and the odd patch since). */
const DECADES: readonly (readonly [number, number])[] = [
  [1900, 0.8], [1910, 1.6], [1920, 3], [1930, 2], [1940, 0.8], [1950, 3], [1960, 2.5], [1970, 2], [1980, 1.5], [1990, 2.2], [2000, 1.6], [2010, 1.6], [2020, 0.6],
];

function decadeFrom(rng: Rng, least: number, most = 2020): number {
  let total = 0;
  for (const [d, w] of DECADES) if (d >= least && d <= most) total += w;
  let x = next(rng) * total;
  for (const [d, w] of DECADES) {
    if (d < least || d > most) continue;
    x -= w;
    if (x < 0) return d;
  }
  return Math.min(most, Math.max(least, 2000));
}

/** Whether a point stands in a block, and the block's district. */
function districtAt(blocks: readonly Block[], p: Vec): District | null {
  for (const b of blocks) if (contains(b.polygon as Poly, p)) return b.district;
  return null;
}

/** The lot a point stands in, or -1 (through the lots' own index, `lotIndex.ts`, which needs only the plan's lots). */
function lotAt(index: TownPlan, p: Vec): number {
  return lotIdAt(index, p.x, p.z);
}

/** The sidewalk's runs: the stretches `[from, to]` covered, minus the gaps, cut into pours of 18 to 60 m, each with a decade. */
function pours(rng: Rng, from: number, to: number, gaps: readonly (readonly [number, number])[], least: number): { s0: number; s1: number; decade: number }[] {
  // The covered intervals: [from, to] minus the gaps.
  let spans: [number, number][] = [[from, to]];
  for (const [g0, g1] of gaps) {
    const next: [number, number][] = [];
    for (const [a, b] of spans) {
      if (g1 <= a || g0 >= b) next.push([a, b]);
      else {
        if (g0 > a) next.push([a, g0]);
        if (g1 < b) next.push([g1, b]);
      }
    }
    spans = next;
  }
  const out: { s0: number; s1: number; decade: number }[] = [];
  for (const [a, b] of spans) {
    if (b - a < 1.5) continue;
    let s = a;
    while (s < b - 1e-6) {
      let e = s + range(rng, 18, 60);
      if (b - e < 9) e = b;
      out.push({ s0: s, s1: Math.min(e, b), decade: decadeFrom(rng, least) });
      s = e;
    }
  }
  return out;
}

export function planEdges(inp: EdgeInput): StreetEdge[] {
  const { streets, blocks, lots, buildings, history, rng } = inp;
  // How each lot stands, by lot id: 0 built and open, 1 a vacant building or a ruin or no building at all (a vacant lot).
  const lotState: number[] = lots.map(() => 1);
  for (const b of buildings) {
    if (b.lot < 0) continue;
    lotState[b.lot] = b.state === "open" ? 0 : 1;
  }

  // The core's middle: the mean of the core blocks' corners, for how far a street is from where the town began.
  let cx = 0;
  let cz = 0;
  let cn = 0;
  for (const b of blocks) {
    if (b.district !== "core") continue;
    for (const p of b.polygon) {
      cx += p.x;
      cz += p.z;
      cn++;
    }
  }
  const core: Vec = cn > 0 ? { x: cx / cn, z: cz / cn } : { x: 0, z: 0 };
  const lotsOnly = { lots } as unknown as TownPlan;
  const platYear = (id: string | null): number => (id === "old" ? history.firstPlat.year : history.secondPlat.year);

  const out: StreetEdge[] = [];
  for (const st of streets) {
    const len = dist(st.a, st.b);
    const none = (): SideEdge => ({ walk: 0, curb: false, runs: [], verge: 0, ditch: false });
    const grid = st.kind === "street" || st.kind === "main" || st.kind === "avenue";
    if (!grid || !(len > 1)) {
      out.push({ street: st.id, sides: [none(), none()], paving: [{ s0: 0, s1: Math.max(len, 1), decade: 1990, curb: 0, wear: 0.5 }], use: st.kind === "highway" ? 1 : 0.05, era: "edge" });
      continue;
    }
    const tx = (st.b.x - st.a.x) / len;
    const tz = (st.b.z - st.a.z) / len;
    // Left is the normal (-tz, tx), as the drawing's `nx`, `nz`.
    const at = (s: number, t: number): Vec => ({ x: st.a.x + tx * s - tz * t, z: st.a.z + tz * s + tx * t });
    const hw = st.width / 2;
    const cw = st.roadway / 2;

    // ---- Where the street stands: the share of its frontage on paved blocks, and its distance from the core.
    let samples = 0;
    let paved = 0;
    const side: [number, number] = [0, 0];
    const sideN: [number, number] = [0, 0];
    const kinds: (District | null)[][] = [[], []];
    for (let s = SAMPLE / 2; s < len; s += SAMPLE) {
      for (const k of [0, 1] as const) {
        const d = districtAt(blocks, at(s, (k === 0 ? 1 : -1) * (hw + 6)));
        kinds[k]!.push(d);
        sideN[k]++;
        if (d !== null && PAVED_DISTRICTS.includes(d)) {
          paved++;
          side[k]++;
        }
        samples++;
      }
    }
    const pavedShare = samples > 0 ? paved / samples : 0;
    const mid = at(len / 2, 0);
    const fromCore = dist(mid, core);
    let era: StreetEdge["era"];
    if (st.kind === "main" || st.kind === "avenue" || pavedShare >= 0.4) era = "core";
    else if (st.plat === "old") era = fromCore > 430 ? "later" : "old";
    else era = fromCore > EDGE_DISTANCE || len < 55 ? "edge" : "later";
    // An old street's frontage is residential; a later one that stands near the core is the same as the later plat's.
    const use = era === "core" ? (st.kind === "street" ? 0.8 : 1) : era === "old" ? 0.5 : era === "later" ? 0.35 : 0.15;

    // ---- Each side: whether it has a sidewalk, a curb and which stretches.
    const least = Math.floor(platYear(st.plat) / 10) * 10 + 10;
    const sides: SideEdge[] = [];
    // Which sides of a later street get a sidewalk, and how far it goes before the money ran out.
    const laterSides = ((): [boolean, boolean] => {
      if (era === "core" || era === "old") return [true, true];
      const r = next(rng);
      if (era === "later") {
        if (r < 0.35) return [false, false];
        if (r < 0.8) return chance(rng, 0.5) ? [true, false] : [false, true];
        return [true, true];
      }
      if (r < 0.6) return [false, false];
      if (r < 0.9) return chance(rng, 0.5) ? [true, false] : [false, true];
      return [true, true];
    })();
    for (const k of [0, 1] as const) {
      let hasWalk = laterSides[k];
      // An old street's side has none at all now and then (a fifth of the house streets lose one side).
      if (era === "old" && chance(rng, 0.12)) hasWalk = false;
      const vacantNear = (s: number): boolean => {
        const l = lotAt(lotsOnly, at(s, (k === 0 ? 1 : -1) * (hw + 4)));
        return l < 0 ? false : lotState[l] === 1;
      };
      let runs: WalkRun[] = [];
      if (hasWalk) {
        let from = 0;
        let to = len;
        const gaps: [number, number][] = [];
        if (era === "old" || era === "later") {
          // A gap every 100 m or so, 5 to 25 m long (old: 0.9 a hundred metres; later: 0.5).
          const perM = era === "old" ? 0.009 : 0.005;
          let s = range(rng, 0, 40);
          while (s < len) {
            if (next(rng) < perM * 40) {
              const gl = range(rng, 5, 25);
              gaps.push([s, Math.min(len, s + gl)]);
              s += gl;
            }
            s += 40;
          }
        }
        if (era === "later" || era === "edge") {
          // The sidewalk stops where the money ran out: from the end nearer the core, partway along the street.
          const nearA = dist(st.a, core) <= dist(st.b, core);
          const stop = range(rng, 0.35, 1.0) * len;
          if (stop < len - 6) {
            if (nearA) to = stop;
            else from = len - stop;
          }
        }
        const raw = pours(rng, from, to, gaps, least);
        runs = raw.map((p) => {
          const age = (NOW - p.decade) / 280;
          const base = era === "core" ? 0.04 : era === "old" ? 0.2 : 0.1;
          const vac = vacantNear((p.s0 + p.s1) / 2) ? 0.22 : 0;
          return { s0: p.s0, s1: p.s1, decade: p.decade, wear: Math.min(1, Math.max(0, base + age + vac + range(rng, -0.08, 0.2))) };
        });
      }
      // A curb and gutter: with every sidewalk of the core and the old plat, on most of the later ones, and left where a sidewalk
      // was lost from an old street; none on the town's edges unless a sidewalk is there.
      let curb: boolean;
      if (era === "core") curb = true;
      else if (era === "old") curb = hasWalk || chance(rng, 0.7);
      else if (era === "later") curb = hasWalk && chance(rng, 0.8);
      else curb = hasWalk && chance(rng, 0.35);
      const inner = cw + (curb ? 0.18 : 0);
      // Without a sidewalk the open strip beside the pavement is a gravel shoulder, 0.9 to 1.6 m wide (wider where the right of way is).
      const verge = hasWalk && runs.length > 0 ? Math.max(0, hw - st.walk - inner) : Math.max(0, Math.min(hw - inner, range(rng, 0.9, 1.6)));
      sides.push({ walk: hasWalk && runs.length > 0 ? st.walk : 0, curb, runs, verge, ditch: !curb && !(hasWalk && runs.length > 0) && (era === "later" || era === "edge") && chance(rng, 0.55) });
    }
    void side;
    void sideN;

    // ---- The roadway's paving: one to four stretches, each laid at its own time.
    const cuts: number[] = [0];
    const extra = len > 140 ? int(rng, 0, 2) : len > 60 ? int(rng, 0, 1) : 0;
    for (let i = 0; i < extra; i++) {
      const s = range(rng, 0.18, 0.82) * len;
      if (cuts.every((c) => Math.abs(c - s) > 28)) cuts.push(s);
    }
    cuts.sort((a, b) => a - b);
    cuts.push(len);
    const anyCurb = sides.some((s) => s.curb);
    const paving: Paving[] = [];
    for (let i = 0; i + 1 < cuts.length; i++) {
      const decade = era === "core" ? decadeFrom(rng, 1970) : era === "old" ? decadeFrom(rng, 1950) : decadeFrom(rng, 1960);
      const overlays = era === "old" ? int(rng, 1, 3) : era === "core" ? int(rng, 0, 2) : int(rng, 0, 1);
      const curb = anyCurb ? Math.max(CURB_LEAST, CURB_REBUILT - CURB_OVERLAY * overlays) : 0;
      // Wear: its age, and less used streets are mended less (potholes, patches and cracks come with it).
      const wear = Math.min(1, Math.max(0, (NOW - decade) / 70 + (1 - use) * 0.35 + range(rng, -0.1, 0.12)));
      paving.push({ s0: cuts[i] as number, s1: cuts[i + 1] as number, decade, curb, wear });
    }
    out.push({ street: st.id, sides: [sides[0] as SideEdge, sides[1] as SideEdge], paving, use, era });
  }
  return out;
}

/** Whether a street side has its sidewalk at `s` metres from the street's `a`. */
export function walkAt(side: SideEdge, s: number): WalkRun | null {
  for (const r of side.runs) if (s >= r.s0 - 1e-6 && s <= r.s1 + 1e-6) return r;
  return null;
}

/** The paving at `s`: the stretch it falls in. */
export function pavingAt(paving: readonly Paving[], s: number): Paving {
  for (const p of paving) if (s < p.s1) return p;
  return paving[paving.length - 1] as Paving;
}
