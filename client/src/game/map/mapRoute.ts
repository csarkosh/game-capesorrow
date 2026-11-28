/**
 * Routes over the town's streets. A graph is made from the map's street segments (nodes where streets cross or meet, and at their ends;
 * edges along the streets between them), and a route is the shortest way over it from one world point to another, for a person on foot
 * (every street, the stairs and alleys and the wharf included) or in a car (no stairs). Pure: no canvas and no DOM.
 */
import { ALLEY, STAIR, TRACK, type MapData, type Seg } from "./mapData.js";

export type Profile = "foot" | "drive";

/** Two nodes closer than this are one, metres. */
const MERGE = 1;
/** A street's end within this of another street's right of way (its edge, half the right of way's width from the centre line) is on it, metres. */
const TOUCH = 1.5;
/** An alley ends a little way from the street it opens on, behind its lot line: an alley's end within this of a street's right of way opens on it, metres. */
const ALLEY_MOUTH = 6;
/** Past this far from every street, a start is off the streets and goes straight to the nearest one, metres. */
export const SNAP_START = 60;

type Edge = { readonly a: number; readonly b: number; readonly len: number; readonly cls: number; readonly name: string };

export type Graph = {
  readonly nodeX: readonly number[];
  readonly nodeZ: readonly number[];
  readonly edges: readonly Edge[];
  /** For each node, the indices of its edges. */
  readonly around: readonly (readonly number[])[];
  readonly buildMs: number;
};

const GRAPHS = new Map<MapData, Graph>();

/** The street graph of a map's data, made on first asking. */
export function graphFor(data: MapData): Graph {
  let g = GRAPHS.get(data);
  if (g === undefined) {
    g = buildGraph(data.segments);
    GRAPHS.set(data, g);
  }
  return g;
}

function nearOn(s: Seg, x: number, z: number): { t: number; d: number } {
  const dx = s.x1 - s.x0;
  const dz = s.z1 - s.z0;
  const l2 = dx * dx + dz * dz;
  const t = l2 > 0 ? Math.min(1, Math.max(0, ((x - s.x0) * dx + (z - s.z0) * dz) / l2)) : 0;
  return { t, d: Math.hypot(s.x0 + dx * t - x, s.z0 + dz * t - z) };
}

export function buildGraph(segs: readonly Seg[]): Graph {
  const t0 = performance.now();
  const n = segs.length;
  const splits: number[][] = segs.map(() => [0, 1]);
  // Where a segment's end is moved to: onto the side of the street it meets.
  const ends: ({ x: number; z: number } | null)[][] = segs.map(() => [null, null]);
  for (let i = 0; i < n; i++) {
    const p = segs[i] as Seg;
    const rx = p.x1 - p.x0;
    const rz = p.z1 - p.z0;
    const pl = Math.hypot(rx, rz);
    for (let j = i + 1; j < n; j++) {
      const q = segs[j] as Seg;
      if (Math.max(p.x0, p.x1) + TOUCH < Math.min(q.x0, q.x1) || Math.max(q.x0, q.x1) + TOUCH < Math.min(p.x0, p.x1)) continue;
      if (Math.max(p.z0, p.z1) + TOUCH < Math.min(q.z0, q.z1) || Math.max(q.z0, q.z1) + TOUCH < Math.min(p.z0, p.z1)) continue;
      const sx = q.x1 - q.x0;
      const sz = q.z1 - q.z0;
      const ql = Math.hypot(sx, sz);
      const den = rx * sz - rz * sx;
      if (Math.abs(den) > 1e-9 && pl > 0 && ql > 0) {
        const t = ((q.x0 - p.x0) * sz - (q.z0 - p.z0) * sx) / den;
        const u = ((q.x0 - p.x0) * rz - (q.z0 - p.z0) * rx) / den;
        if (t > -TOUCH / pl && t < 1 + TOUCH / pl && u > -TOUCH / ql && u < 1 + TOUCH / ql) {
          (splits[i] as number[]).push(Math.min(1, Math.max(0, t)));
          (splits[j] as number[]).push(Math.min(1, Math.max(0, u)));
        }
      }
    }
  }
  // A street's end that stops at another's right of way (a stem of a tee, an alley's mouth) opens on the nearest street's centre line.
  for (let i = 0; i < n; i++) {
    const a = segs[i] as Seg;
    for (let e = 0; e < 2; e++) {
      const ex = e === 0 ? a.x0 : a.x1;
      const ez = e === 0 ? a.z0 : a.z1;
      let best: { j: number; t: number; d: number; gap: number } | null = null;
      for (let j = 0; j < n; j++) {
        if (j === i) continue;
        const b = segs[j] as Seg;
        const near = nearOn(b, ex, ez);
        if (!(near.t > 0 && near.t < 1)) continue;
        // How far the end is from the other's right of way's edge: the stem stops at the edge, not at the centre line.
        const gap = near.d - (b.rw ?? b.w) / 2;
        if (gap < (a.cls === ALLEY ? ALLEY_MOUTH : TOUCH) && (best === null || gap < best.gap)) best = { j, t: near.t, d: near.d, gap };
      }
      if (best === null) continue;
      const b = segs[best.j] as Seg;
      (splits[best.j] as number[]).push(best.t);
      if (best.d > MERGE) (ends[i] as ({ x: number; z: number } | null)[])[e] = { x: b.x0 + (b.x1 - b.x0) * best.t, z: b.z0 + (b.z1 - b.z0) * best.t };
    }
  }
  const nodeX: number[] = [];
  const nodeZ: number[] = [];
  const hash = new Map<string, number[]>();
  const node = (x: number, z: number): number => {
    const cx = Math.floor(x / 2);
    const cz = Math.floor(z / 2);
    for (let a = cx - 1; a <= cx + 1; a++) {
      for (let b = cz - 1; b <= cz + 1; b++) {
        for (const id of hash.get(`${a},${b}`) ?? []) if (Math.hypot(nodeX[id] as number - x, nodeZ[id] as number - z) < MERGE) return id;
      }
    }
    const id = nodeX.length;
    nodeX.push(x);
    nodeZ.push(z);
    const k = `${cx},${cz}`;
    const list = hash.get(k);
    if (list === undefined) hash.set(k, [id]);
    else list.push(id);
    return id;
  };
  const edges: Edge[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < n; i++) {
    const s = segs[i] as Seg;
    const ts = (splits[i] as number[]).slice().sort((a, b) => a - b);
    const e0 = (ends[i] as ({ x: number; z: number } | null)[])[0] ?? null;
    const e1 = (ends[i] as ({ x: number; z: number } | null)[])[1] ?? null;
    let prev = -1;
    let prevT = -1;
    for (const t of ts) {
      if (prev >= 0 && t - prevT < 1e-6) continue;
      const at = t === 0 && e0 !== null ? e0 : t === 1 && e1 !== null ? e1 : { x: s.x0 + (s.x1 - s.x0) * t, z: s.z0 + (s.z1 - s.z0) * t };
      const id = node(at.x, at.z);
      if (prev >= 0 && id !== prev) {
        const key = prev < id ? `${prev}:${id}:${s.cls}` : `${id}:${prev}:${s.cls}`;
        if (!seen.has(key)) {
          seen.add(key);
          edges.push({ a: prev, b: id, len: Math.hypot((nodeX[id] as number) - (nodeX[prev] as number), (nodeZ[id] as number) - (nodeZ[prev] as number)), cls: s.cls, name: s.name });
        }
      }
      prev = id;
      prevT = t;
    }
  }
  const around: number[][] = nodeX.map(() => []);
  edges.forEach((e, i) => {
    (around[e.a] as number[]).push(i);
    (around[e.b] as number[]).push(i);
  });
  return { nodeX, nodeZ, edges, around, buildMs: performance.now() - t0 };
}

/** Whether a profile may use a street of the class. */
export function allowed(profile: Profile, cls: number): boolean {
  return profile === "foot" || cls !== STAIR;
}

/** What a metre of a street costs the search: the same everywhere, but dearer where a person would rather not (stairs on foot; alleys and wheel tracks driving). */
function cost(profile: Profile, cls: number): number {
  if (profile === "foot") return cls === STAIR ? 1.3 : 1;
  return cls === ALLEY || cls === TRACK ? 1.5 : 1;
}

/** A point of a street: the edge, how far along it (0 to 1), where it is and how far the point asked for was from it. */
export type Snap = { readonly edge: number; readonly t: number; readonly x: number; readonly z: number; readonly dist: number };

const MAINS = new WeakMap<Graph, Partial<Record<Profile, Uint8Array>>>();

/** Which nodes lie in the largest connected piece of the graph for a profile: a street that joins none (a pier's walk, an alley cut off) is not one to be sent to. */
function mainOf(g: Graph, profile: Profile): Uint8Array {
  let by = MAINS.get(g);
  if (by === undefined) {
    by = {};
    MAINS.set(g, by);
  }
  let main = by[profile];
  if (main === undefined) {
    const n = g.nodeX.length;
    const label = new Int32Array(n).fill(-1);
    let best = -1;
    let bestSize = 0;
    for (let s = 0; s < n; s++) {
      if (label[s] !== -1) continue;
      const stack = [s];
      label[s] = s;
      let size = 0;
      while (stack.length > 0) {
        const u = stack.pop() as number;
        size++;
        for (const ei of g.around[u] as readonly number[]) {
          const e = g.edges[ei] as Edge;
          if (!allowed(profile, e.cls)) continue;
          const v = e.a === u ? e.b : e.a;
          if (label[v] === -1) {
            label[v] = s;
            stack.push(v);
          }
        }
      }
      if (size > bestSize) {
        bestSize = size;
        best = s;
      }
    }
    main = new Uint8Array(n);
    for (let i = 0; i < n; i++) main[i] = label[i] === best ? 1 : 0;
    by[profile] = main;
  }
  return main;
}

/** The nearest point of an edge the profile may use in the graph's main piece, or null for a graph with none. */
export function snapTo(g: Graph, profile: Profile, x: number, z: number): Snap | null {
  let best: Snap | null = null;
  const main = mainOf(g, profile);
  for (let i = 0; i < g.edges.length; i++) {
    const e = g.edges[i] as Edge;
    if (!allowed(profile, e.cls) || main[e.a] !== 1) continue;
    const ax = g.nodeX[e.a] as number;
    const az = g.nodeZ[e.a] as number;
    const dx = (g.nodeX[e.b] as number) - ax;
    const dz = (g.nodeZ[e.b] as number) - az;
    const l2 = dx * dx + dz * dz;
    const t = l2 > 0 ? Math.min(1, Math.max(0, ((x - ax) * dx + (z - az) * dz) / l2)) : 0;
    const px = ax + dx * t;
    const pz = az + dz * t;
    const d = Math.hypot(px - x, pz - z);
    if (best === null || d < best.dist) best = { edge: i, t, x: px, z: pz, dist: d };
  }
  return best;
}

/** The shortest way over the graph from a snapped start to every node: the cost to each, and the edge each is reached by (-1 for the start's own ends). */
function search(g: Graph, profile: Profile, s: Snap): { dist: Float64Array; via: Int32Array; metres: Float64Array } {
  const n = g.nodeX.length;
  const dist = new Float64Array(n).fill(Infinity);
  const via = new Int32Array(n).fill(-1);
  // The plain length of the way to each node, which is not its cost where a street is dear.
  const metres = new Float64Array(n).fill(Infinity);
  const e = g.edges[s.edge] as Edge;
  const w = cost(profile, e.cls);
  dist[e.a] = s.t * e.len * w;
  dist[e.b] = (1 - s.t) * e.len * w;
  metres[e.a] = s.t * e.len;
  metres[e.b] = (1 - s.t) * e.len;
  // A small binary heap of (cost, node).
  const hc: number[] = [];
  const hn: number[] = [];
  const push = (c: number, v: number): void => {
    let i = hc.length;
    hc.push(c);
    hn.push(v);
    while (i > 0) {
      const p = (i - 1) >> 1;
      if ((hc[p] as number) <= c) break;
      hc[i] = hc[p] as number;
      hn[i] = hn[p] as number;
      i = p;
    }
    hc[i] = c;
    hn[i] = v;
  };
  const pop = (): number => {
    const top = hn[0] as number;
    const c = hc.pop() as number;
    const v = hn.pop() as number;
    if (hc.length > 0) {
      let i = 0;
      for (;;) {
        let k = i * 2 + 1;
        if (k >= hc.length) break;
        if (k + 1 < hc.length && (hc[k + 1] as number) < (hc[k] as number)) k++;
        if ((hc[k] as number) >= c) break;
        hc[i] = hc[k] as number;
        hn[i] = hn[k] as number;
        i = k;
      }
      hc[i] = c;
      hn[i] = v;
    }
    return top;
  };
  push(dist[e.a] as number, e.a);
  push(dist[e.b] as number, e.b);
  const done = new Uint8Array(n);
  while (hc.length > 0) {
    const u = pop();
    if (done[u] === 1) continue;
    done[u] = 1;
    for (const ei of g.around[u] as readonly number[]) {
      const ed = g.edges[ei] as Edge;
      if (!allowed(profile, ed.cls)) continue;
      const v = ed.a === u ? ed.b : ed.a;
      const c = (dist[u] as number) + ed.len * cost(profile, ed.cls);
      if (c < (dist[v] as number)) {
        dist[v] = c;
        via[v] = ei;
        metres[v] = (metres[u] as number) + ed.len;
        push(c, v);
      }
    }
  }
  return { dist, via, metres };
}

/** A route: its points as x, z pairs from the start to the goal, the street name of each stretch between two points, and its length in metres. */
export type Route = {
  pts: number[];
  names: string[];
  length: number;
  readonly profile: Profile;
  /** The start was farther than `SNAP_START` from every street, so the route begins with a straight run to the nearest. */
  readonly offStreet: boolean;
  /** The route has no street to follow (there was none to reach): a straight line. */
  readonly straight: boolean;
};

function finish(pts: number[], names: string[], profile: Profile, offStreet: boolean, straight: boolean): Route {
  // Points that coincide are one.
  const p: number[] = [pts[0] as number, pts[1] as number];
  const nm: string[] = [];
  let length = 0;
  for (let i = 2; i < pts.length; i += 2) {
    const d = Math.hypot((pts[i] as number) - (p[p.length - 2] as number), (pts[i + 1] as number) - (p[p.length - 1] as number));
    if (d < 0.05 && i < pts.length - 2) continue;
    p.push(pts[i] as number, pts[i + 1] as number);
    nm.push(names[i / 2 - 1] as string);
    length += d;
  }
  return { pts: p, names: nm, length, profile, offStreet, straight };
}

/** The route from (`sx`, `sz`) to (`gx`, `gz`): to the nearest point of a street each way, along the streets between, then straight to the goal. */
export function planRoute(g: Graph, profile: Profile, sx: number, sz: number, gx: number, gz: number): Route {
  const s = snapTo(g, profile, sx, sz);
  const t = snapTo(g, profile, gx, gz);
  const straight = (): Route => finish([sx, sz, gx, gz], [""], profile, false, true);
  if (s === null || t === null) return straight();
  const found = search(g, profile, s);
  const se = g.edges[s.edge] as Edge;
  const te = g.edges[t.edge] as Edge;
  const tw = cost(profile, te.cls);
  // The best way to the goal's point: by one end of its edge or the other, or straight along the edge from the start's when they share one.
  let best = Infinity;
  let end = -1;
  const viaA = (found.dist[te.a] as number) + t.t * te.len * tw;
  const viaB = (found.dist[te.b] as number) + (1 - t.t) * te.len * tw;
  if (viaA < best) {
    best = viaA;
    end = te.a;
  }
  if (viaB < best) {
    best = viaB;
    end = te.b;
  }
  const same = s.edge === t.edge;
  const direct = same ? Math.abs(t.t - s.t) * se.len * cost(profile, se.cls) : Infinity;
  const pts: number[] = [sx, sz, s.x, s.z];
  const names: string[] = [""];
  if (same && direct <= best) {
    pts.push(t.x, t.z);
    names.push(se.name);
  } else {
    if (end < 0 || !Number.isFinite(best)) return straight();
    // Back from the goal's end of its edge to the start's, then turned around.
    const chain: number[] = [];
    let at = end;
    while ((found.via[at] as number) >= 0) {
      const ei = found.via[at] as number;
      chain.push(ei);
      const ed = g.edges[ei] as Edge;
      at = ed.a === at ? ed.b : ed.a;
    }
    // `at` is an end of the start's own edge.
    pts.push(g.nodeX[at] as number, g.nodeZ[at] as number);
    names.push(se.name);
    let node = at;
    for (let i = chain.length - 1; i >= 0; i--) {
      const ed = g.edges[chain[i] as number] as Edge;
      node = ed.a === node ? ed.b : ed.a;
      pts.push(g.nodeX[node] as number, g.nodeZ[node] as number);
      names.push(ed.name);
    }
    pts.push(t.x, t.z);
    names.push(te.name);
  }
  pts.push(gx, gz);
  names.push("");
  return finish(pts, names, profile, s.dist > SNAP_START, false);
}

/**
 * How far each goal is from a start along the streets, metres: the whole route's length, as `planRoute` would give it, for every goal in
 * one search. Used where several routes' lengths are wanted and none is drawn (the list of the four places).
 */
export function routeLengths(g: Graph, profile: Profile, sx: number, sz: number, goals: readonly { x: number; z: number }[]): number[] {
  const s = snapTo(g, profile, sx, sz);
  if (s === null) return goals.map((p) => Math.hypot(p.x - sx, p.z - sz));
  const found = search(g, profile, s);
  const se = g.edges[s.edge] as Edge;
  return goals.map((p) => {
    const t = snapTo(g, profile, p.x, p.z);
    if (t === null) return Math.hypot(p.x - sx, p.z - sz);
    const te = g.edges[t.edge] as Edge;
    const w = cost(profile, te.cls);
    const viaA = (found.dist[te.a] as number) + t.t * te.len * w;
    const viaB = (found.dist[te.b] as number) + (1 - t.t) * te.len * w;
    let along = viaA <= viaB ? (found.metres[te.a] as number) + t.t * te.len : (found.metres[te.b] as number) + (1 - t.t) * te.len;
    if (s.edge === t.edge && Math.abs(t.t - s.t) * se.len * cost(profile, se.cls) < Math.min(viaA, viaB)) along = Math.abs(t.t - s.t) * se.len;
    return Math.hypot(s.x - sx, s.z - sz) + along + Math.hypot(p.x - t.x, p.z - t.z);
  });
}

/** The distance from (`x`, `z`) to a route's first `window` stretches, and where the nearest point of them is (stretch and the fraction along it). */
export function nearRoute(r: Route, x: number, z: number, window = 12): { d: number; seg: number; t: number } {
  let best = { d: Infinity, seg: 0, t: 0 };
  const last = Math.min(r.pts.length / 2 - 1, window);
  for (let i = 0; i < last; i++) {
    const ax = r.pts[i * 2] as number;
    const az = r.pts[i * 2 + 1] as number;
    const dx = (r.pts[i * 2 + 2] as number) - ax;
    const dz = (r.pts[i * 2 + 3] as number) - az;
    const l2 = dx * dx + dz * dz;
    const t = l2 > 0 ? Math.min(1, Math.max(0, ((x - ax) * dx + (z - az) * dz) / l2)) : 0;
    const d = Math.hypot(ax + dx * t - x, az + dz * t - z);
    if (d < best.d) best = { d, seg: i, t };
  }
  return best;
}

/** Drops the part of a route already travelled: what lies before the nearest point of its first stretches to (`x`, `z`) is cut away, and the length is what is left. */
export function advanceRoute(r: Route, x: number, z: number): void {
  const near = nearRoute(r, x, z);
  if (near.seg === 0 && near.t === 0) return;
  const i = near.seg;
  const ax = r.pts[i * 2] as number;
  const az = r.pts[i * 2 + 1] as number;
  const px = ax + ((r.pts[i * 2 + 2] as number) - ax) * near.t;
  const pz = az + ((r.pts[i * 2 + 3] as number) - az) * near.t;
  r.pts.splice(0, i * 2 + 2, px, pz);
  r.names.splice(0, i);
  let len = 0;
  for (let k = 2; k < r.pts.length; k += 2) len += Math.hypot((r.pts[k] as number) - (r.pts[k - 2] as number), (r.pts[k + 1] as number) - (r.pts[k - 1] as number));
  r.length = len;
}

/** The name of the street nearest to a point, or "" when none is within `within` metres. */
export function streetNear(g: Graph, profile: Profile, x: number, z: number, within = 18): string {
  const s = snapTo(g, profile, x, z);
  if (s === null || s.dist > within) return "";
  return (g.edges[s.edge] as Edge).name;
}
