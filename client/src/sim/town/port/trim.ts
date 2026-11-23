/**
 * Streets serve buildings. The grid was laid over the land first and the buildings were put on its lots after, so some of the
 * streets it made run on past the last house: along a block whose lots stand empty, or beside woods the plan left. Once the
 * buildings stand, `trimStreets` cuts each street back to what it serves:
 *
 * - from each free end inward to the first stretch with a building standing within `SERVE` metres of it, or to the first junction
 *   with another street, whichever comes first (a junction is never lost by this, and the end that is left on a junction is the
 *   centre of it, as every grid street's end is);
 * - a street that serves nothing is dropped if the rest of the network stays whole without it (it is then the way to nothing), and
 *   kept if it is the way between two others;
 * - an alley is dropped where under `ALLEY_SERVES` of it has a building near, and is never shortened (an alley that ended in a made end
 *   would be strange).
 *
 * The stretches cut away are the unbuilt plat: its lots stay in the plan, the streets that would have reached them are gone, and the ends
 * that are left are made ends (`ends.ts`) as every end of the grid is. So the grid reaches only as far as the town was built.
 */
import { bearingU, bearingV } from "../bearings.js";
import { area, dist, lerpVec, orientedRect, segCross, segDist, segSegDist, type Poly, type Vec } from "../geom.js";
import type { Block, Building, Lot, Seam, Street } from "../types.js";
import { SIZING } from "./sizing.js";

/** A street serves a building whose wall stands within this of it, metres (a lot's depth to the house, and its setback). AUTHORED. */
export const SERVE = SIZING.SERVE;
/** A building standing on a lot of more than this area (a school's ground, a hospital's, a mill's yard) is served by every street along the lot, m2. AUTHORED. */
export const GROUND = SIZING.GROUND;
/** Stations along a street, metres apart. */
const STEP = 4;
/** A cut street is dropped if under this long, metres. */
const LEAST = 8;
/** An alley with less than this share of its stations beside a building is dropped. AUTHORED, NOT RESEARCHED. */
export const ALLEY_SERVES = SIZING.ALLEY_SERVES;
/** A street keeps this far past its last served station, metres (a shop front is up to 24 m wide, and its door may be at the far end of it). AUTHORED. */
const MARGIN = SIZING.MARGIN;
/** Two streets meet where their rights of way touch (with this to spare), metres. */
const TOUCH = 0.6;

const TRIMMED: readonly Street["kind"][] = ["street", "main", "avenue", "alley"];

/** A street the trimming leaves alone: the plats' seam (the old plat's edge, where the two grids meet) stays whole, for what is recorded of it. */
const whole = (st: Street): boolean => st.seam === true;

type Rect = { readonly poly: Poly; readonly c: Vec; readonly r: number };

/** What a building is served as: its footprint, or the lot's whole ground where the lot is a big one. */
export function rectOf(b: Building, lots: readonly Lot[]): Rect {
  const lot = b.lot >= 0 ? lots[b.lot] : undefined;
  if (lot !== undefined && Math.abs(area(lot.polygon)) > GROUND) {
    let x = 0;
    let z = 0;
    for (const q of lot.polygon) {
      x += q.x;
      z += q.z;
    }
    const c = { x: x / lot.polygon.length, z: z / lot.polygon.length };
    let r = 0;
    for (const q of lot.polygon) r = Math.max(r, dist(c, q));
    return { poly: lot.polygon, c, r };
  }
  const poly = orientedRect(b.centre, b.halfAlong, b.halfAcross, bearingU(b.bearing), bearingV(b.bearing));
  return { poly, c: b.centre, r: Math.sqrt(b.halfAlong * b.halfAlong + b.halfAcross * b.halfAcross) };
}

/** Whether any of the rectangles stands within `SERVE` of the point (its wall, or the point inside it). */
export function served(rects: readonly Rect[], p: Vec): boolean {
  for (const q of rects) {
    if (dist(q.c, p) - q.r > SERVE) continue;
    let inside = true;
    for (let k = 0; k < q.poly.length; k++) {
      const a = q.poly[k] as Vec;
      const b = q.poly[(k + 1) % q.poly.length] as Vec;
      if (segDist(p, a, b) <= SERVE) return true;
      if ((b.x - a.x) * (p.z - a.z) - (b.z - a.z) * (p.x - a.x) < 0) inside = false;
    }
    if (inside) return true;
  }
  return false;
}

type Cur = { st: Street; a: Vec; b: Vec };

/** Whether two streets' rights of way touch. */
function touch(p: Cur, q: Cur): boolean {
  return segSegDist(p.a, p.b, q.a, q.b) <= (p.st.width + q.st.width) / 2 + TOUCH;
}

/** How many of the streets (the alleys left out) can be reached from the highway through streets that touch. */
function reach(cur: readonly (Cur | null)[]): number {
  const live: Cur[] = [];
  for (const c of cur) if (c !== null && c.st.kind !== "alley") live.push(c);
  if (live.length === 0) return 0;
  const seen: boolean[] = live.map(() => false);
  const root = live.findIndex((c) => c.st.kind === "highway");
  const start = root >= 0 ? root : 0;
  const queue = [start];
  seen[start] = true;
  for (let h = 0; h < queue.length; h++) {
    const p = live[queue[h] as number] as Cur;
    for (let j = 0; j < live.length; j++) {
      if (seen[j] === true) continue;
      if (touch(p, live[j] as Cur)) {
        seen[j] = true;
        queue.push(j);
      }
    }
  }
  return queue.length;
}

/** Where `c`'s line meets another street's centre line near the station point `p`: the centre of their junction, or `p` if the lines do not cross. */
function junctionCentre(c: Cur, cur: readonly (Cur | null)[], me: number, p: Vec): Vec {
  let best: Vec | null = null;
  let bestD = Infinity;
  const len = dist(c.a, c.b);
  if (len < 1e-6) return p;
  const ux = (c.b.x - c.a.x) / len;
  const uz = (c.b.z - c.a.z) / len;
  const a2 = { x: c.a.x - ux * 2, z: c.a.z - uz * 2 };
  const b2 = { x: c.b.x + ux * 2, z: c.b.z + uz * 2 };
  for (let j = 0; j < cur.length; j++) {
    const o = cur[j];
    if (j === me || o === null || o === undefined || o.st.kind === "alley") continue;
    if (segDist(p, o.a, o.b) > (c.st.width + o.st.width) / 2 + TOUCH) continue;
    // The other street's line run on a little at each end, so that a street whose end stops just short of this one still crosses it.
    const ol = dist(o.a, o.b);
    if (ol < 1e-6) continue;
    const ex = ((o.b.x - o.a.x) / ol) * c.st.width;
    const ez = ((o.b.z - o.a.z) / ol) * c.st.width;
    const x = segCross(a2, b2, { x: o.a.x - ex, z: o.a.z - ez }, { x: o.b.x + ex, z: o.b.z + ez });
    if (!x) continue;
    const q = lerpVec(a2, b2, x.t);
    const d = dist(q, p);
    if (d < bestD) {
      bestD = d;
      best = q;
    }
  }
  return best ?? p;
}

/**
 * The streets cut back to what the buildings serve, renumbered; and `map`, which gives each old street id its new id (-1 where the street
 * was dropped), for what refers to a street by id.
 */
export function trimStreets(streets: readonly Street[], buildings: readonly Building[], lots: readonly Lot[], blocks: readonly Block[]): { streets: Street[]; map: number[] } {
  const first = trim(streets, buildings, lots, []);
  // A block with a building on it touches a street. Where the trimming left one without (a block of sheds set back from the street, say), the trimming is done again
  // with that block's frontage counted as served, so that the street that reaches it stays.
  const built: boolean[] = blocks.map(() => false);
  for (const b of buildings) if (b.lot >= 0 && lots[b.lot] !== undefined) built[(lots[b.lot] as Lot).block] = true;
  const forced: Poly[] = [];
  for (const block of blocks) {
    if (!built[block.id] || block.district === "outskirts") continue;
    let touching = false;
    for (const st of first.streets) {
      if (st.kind === "alley" || st.kind === "rail") continue;
      let d = Infinity;
      for (let k = 0; k < block.polygon.length; k++) d = Math.min(d, segSegDist(block.polygon[k] as Vec, block.polygon[(k + 1) % block.polygon.length] as Vec, st.a, st.b));
      if (d - st.width / 2 <= 0.6) touching = true;
    }
    if (!touching) forced.push(block.polygon);
  }
  return forced.length === 0 ? first : trim(streets, buildings, lots, forced);
}

/** `trimStreets`' work: the stretches within reach of a `forced` polygon count as served as well. */
function trim(streets: readonly Street[], buildings: readonly Building[], lots: readonly Lot[], forced: readonly Poly[]): { streets: Street[]; map: number[] } {
  const rects = buildings.filter((b) => b.kind !== "pier").map((b) => rectOf(b, lots));
  const near = (p: Vec, hw: number): boolean => {
    for (const poly of forced) for (let k = 0; k < poly.length; k++) if (segDist(p, poly[k] as Vec, poly[(k + 1) % poly.length] as Vec) <= hw + TOUCH) return true;
    return false;
  };
  let cur: (Cur | null)[] = streets.map((st) => ({ st, a: st.a, b: st.b }));
  for (let pass = 0; pass < 5; pass++) {
    let changed = false;
    const next: (Cur | null)[] = cur.slice();
    for (let i = 0; i < cur.length; i++) {
      const c = cur[i];
      if (c === null || c === undefined || !TRIMMED.includes(c.st.kind) || whole(c.st)) continue;
      const len = dist(c.a, c.b);
      const n = Math.max(1, -Math.floor(-len / STEP));
      const at = (k: number): Vec => lerpVec(c.a, c.b, k / n);
      const hit: boolean[] = [];
      let count = 0;
      for (let k = 0; k <= n; k++) {
        const h = served(rects, at(k)) || (forced.length > 0 && near(at(k), c.st.width / 2));
        hit.push(h);
        if (h) count++;
      }
      if (c.st.kind === "alley") {
        if (count / (n + 1) < ALLEY_SERVES) {
          next[i] = null;
          changed = true;
        }
        continue;
      }
      // The stations where another street (not an alley) meets this one.
      const meets: boolean[] = [];
      for (let k = 0; k <= n; k++) {
        const p = at(k);
        let m = false;
        for (let j = 0; j < cur.length && !m; j++) {
          const o = cur[j];
          if (j === i || o === null || o === undefined || o.st.kind === "alley") continue;
          if (segDist(p, o.a, o.b) <= (c.st.width + o.st.width) / 2 + TOUCH) m = true;
        }
        meets.push(m);
      }
      const stop = (k: number): boolean => (hit[k] as boolean) || (meets[k] as boolean);
      let lo = 0;
      while (lo <= n && !stop(lo)) lo++;
      // Nothing served and no junction: the way to nothing, dealt with below.
      if (lo > n) continue;
      let hi = n;
      while (hi > lo && !stop(hi)) hi--;
      let a = c.a;
      let b = c.b;
      if (lo > 0) a = (hit[lo] as boolean) ? lerpVec(c.a, c.b, Math.max(0, (lo * len) / n - MARGIN) / len) : junctionCentre(c, cur, i, at(lo));
      if (hi < n) b = (hit[hi] as boolean) ? lerpVec(c.a, c.b, Math.min(len, (hi * len) / n + MARGIN) / len) : junctionCentre(c, cur, i, at(hi));
      if (a === c.a && b === c.b) continue;
      if (dist(a, b) < LEAST) {
        next[i] = null;
        changed = true;
        continue;
      }
      next[i] = { st: c.st, a, b };
      changed = true;
    }
    cur = next;
    // Streets that serve nothing go if the network stays whole without them, the longest first.
    const idle: number[] = [];
    for (let i = 0; i < cur.length; i++) {
      const c = cur[i];
      if (c === null || c === undefined || !TRIMMED.includes(c.st.kind) || c.st.kind === "alley" || whole(c.st)) continue;
      const n = Math.max(1, -Math.floor(-dist(c.a, c.b) / STEP));
      let any = false;
      for (let k = 0; k <= n && !any; k++) any = served(rects, lerpVec(c.a, c.b, k / n)) || (forced.length > 0 && near(lerpVec(c.a, c.b, k / n), c.st.width / 2));
      if (!any) idle.push(i);
    }
    idle.sort((p, q) => dist((cur[q] as Cur).a, (cur[q] as Cur).b) - dist((cur[p] as Cur).a, (cur[p] as Cur).b) || p - q);
    for (const i of idle) {
      const keep = cur[i] as Cur;
      const before = reach(cur);
      cur[i] = null;
      // Whole without it: what could be reached before, but for the street itself, still can.
      if (reach(cur) >= before - 1) changed = true;
      else cur[i] = keep;
    }
    if (!changed) break;
  }
  // An alley that touches no street (the streets it ran between were cut back) is dropped: every street is in one network.
  for (let i = 0; i < cur.length; i++) {
    const c = cur[i];
    if (c === null || c === undefined || c.st.kind !== "alley") continue;
    if (!cur.some((o) => o !== null && o !== undefined && o.st.kind !== "alley" && segSegDist(c.a, c.b, o.a, o.b) <= (c.st.width + o.st.width) / 2 + 0.5)) cur[i] = null;
  }
  const out: Street[] = [];
  const map: number[] = [];
  for (const c of cur) {
    if (c === null || c === undefined) {
      map.push(-1);
      continue;
    }
    map.push(out.length);
    out.push({ ...c.st, id: out.length, a: c.a, b: c.b });
  }
  return { streets: out, map };
}

/** The seams with their street renumbered by `map` (a seam whose street was dropped has none, -1). */
export function remapSeams(seams: readonly Seam[], map: readonly number[]): Seam[] {
  return seams.map((s) => ({ ...s, street: s.street >= 0 ? (map[s.street] ?? -1) : -1 }));
}
