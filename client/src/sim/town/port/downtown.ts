/**
 * The downtown: one connected set of blocks that holds every business of the town. The rule (AUTHORED, NOT RESEARCHED):
 *
 * 1. Two blocks are neighbours when both stand beside one street (the highway too: the old plat stands either side of it) and no more than `DT_LINK` apart
 *    (`DT_LINK_HIGHWAY` across the highway). The plan's `downtown` and its tests use the same rule (`blockNeighbours`).
 * 2. It starts from the old core (the business street's blocks) and the dock block by the quay, and takes the blocks between them, by the shortest way along the
 *    streets, block to block. A town with no old plat starts from the block nearest where the core would be.
 * 3. The highway strip (the gas stations, motels, garages, the big-box store) is at its edge on the highway: up to `DT_STRIP_MAX` neighbouring blocks beside the highway,
 *    where the history gives the town a strip.
 * 4. It grows outward, one neighbouring block at a time, always the one nearest the core and the dock, until its blocks hold the lots the old plan gave to shops, the dock and the
 *    strip (`DT_EXTRA` more), and the rows its landmarks need (a block has two, one landmark each); a block of mill housing, industry or a sliver is taken only where the
 *    landmarks have no row else.
 * 5. A block it holds is "core" (the dock block stays "dock", the strip's blocks "highway strip"). The blocks between the old core and the dock and the blocks added are its outer
 *    blocks (`BlockMeta.edge`, where one has a street to a block outside it): they are built thinner and hold a few houses, so its edge is ragged. A block outside it that would have
 *    been the strip is what it would have been had none been drawn (`plain`).
 *
 * Streets, blocks and the made ground are the layout's own: only each block's district changes.
 */
import { area, centroid, dist, segSegDist, type Poly, type Vec } from "../geom.js";
import { roadAt } from "../shore.js";
import type { TownSite } from "../site.js";
import type { Block, District, History, Street, StreetKind } from "../types.js";
import type { BlockMeta } from "./layout.js";
import { polyGap } from "./growth.js";
import { SIZING } from "./sizing.js";

/** The streets that join blocks: not the railroad, an alley or a stair. The highway does (the old plat stands either side of it, and blocks keep clear of it by the railroad's corridor). */
const JOINING: readonly StreetKind[] = ["avenue", "main", "street", "wharf", "highway"];

type StreetLike = Pick<Street, "a" | "b" | "width" | "kind">;

const edgeDist = (poly: Poly, a: Vec, b: Vec): number => {
  let d = Infinity;
  for (let k = 0; k < poly.length; k++) d = Math.min(d, segSegDist(poly[k]!, poly[(k + 1) % poly.length]!, a, b));
  return d;
};

/** For each block, the ids of the blocks that stand beside one of the same streets (a block's edge within half the street's width and a metre of it) and no more than `DT_LINK` apart, ascending. */
export function blockNeighbours(blocks: readonly { readonly polygon: Poly }[], streets: readonly StreetLike[]): number[][] {
  const out: number[][] = blocks.map(() => []);
  for (const st of streets) {
    if (!JOINING.includes(st.kind)) continue;
    const hwy = st.kind === "highway";
    const beside: number[] = [];
    for (let i = 0; i < blocks.length; i++) if (edgeDist(blocks[i]!.polygon, st.a, st.b) <= (hwy ? SIZING.DT_BESIDE_HIGHWAY : st.width / 2 + 1)) beside.push(i);
    for (const i of beside) {
      for (const j of beside) {
        if (j <= i || out[i]!.includes(j)) continue;
        if (polyGap(blocks[i]!.polygon, blocks[j]!.polygon) > (hwy ? SIZING.DT_LINK_HIGHWAY : SIZING.DT_LINK)) continue;
        out[i]!.push(j);
        out[j]!.push(i);
      }
    }
  }
  return out.map((s) => s.sort((p, q) => p - q));
}

export type DowntownInput = {
  readonly site: TownSite;
  readonly history: History;
  readonly blocks: readonly Block[];
  readonly meta: readonly BlockMeta[];
  readonly streets: readonly StreetLike[];
  /** The district each block would have with no downtown: what a block outside it keeps (the highway strip drawn for it is replaced by this). */
  readonly plain: readonly District[];
  /** The old core's centre: where the downtown starts in a town that has no old plat. */
  readonly centre: Vec;
};

export type DowntownOut = {
  /** The downtown's block ids, ascending. */
  readonly downtown: number[];
  /** Every block's district. */
  readonly districts: District[];
  /** Per block: an outer block of the downtown. */
  readonly edge: boolean[];
};

export function planDowntown(input: DowntownInput): DowntownOut {
  const { site, history, blocks, meta, streets, plain, centre } = input;
  const n = blocks.length;
  const adj = blockNeighbours(blocks, streets);
  const areaOf = blocks.map((b) => Math.abs(area(b.polygon)));
  const cent = blocks.map((b) => centroid(b.polygon));
  const tentative = blocks.map((b) => b.district);

  const core = blocks.filter((b) => b.district === "core").map((b) => b.id);
  let dock = blocks.filter((b) => b.district === "dock").map((b) => b.id);
  // Where the land took the dock district's block, the quay's row block nearest where it would have been (two columns past the wharf street, toward the dock end) is the dock block.
  if (dock.length === 0) {
    const row0 = blocks.filter((b) => meta[b.id]!.tag === "old" && meta[b.id]!.row === 0 && meta[b.id]!.site === null && b.district !== "core").map((b) => b.id);
    row0.sort((p, q) => Math.abs(meta[p]!.d - 2) - Math.abs(meta[q]!.d - 2) || p - q);
    if (row0.length > 0) dock = [row0[0]!];
  }

  const inSet = new Array<boolean>(n).fill(false);
  const members: number[] = [];
  const add = (i: number): void => {
    if (inSet[i]) return;
    inSet[i] = true;
    members.push(i);
  };
  // 1. The core, then the dock, joined by the shortest ways along the streets (block to block, each step the distance between centres). A town without an old plat has no core: the block
  // nearest where the core would be is its one.
  const seeds = [...core, ...dock];
  if (seeds.length === 0) {
    let best = -1;
    for (let i = 0; i < n; i++) if (meta[i]!.site === null && areaOf[i]! >= SIZING.DT_MIN_AREA && (best < 0 || dist(cent[i]!, centre) < dist(cent[best]!, centre))) best = i;
    if (best < 0) for (let i = 0; i < n; i++) if (best < 0 || dist(cent[i]!, centre) < dist(cent[best]!, centre)) best = i;
    if (best >= 0) seeds.push(best);
  }
  // It starts from the seed that reaches the most of the others, along the streets.
  const reach = (from: number): number => {
    const seen = new Array<boolean>(n).fill(false);
    seen[from] = true;
    const queue = [from];
    for (let q = 0; q < queue.length; q++) {
      for (const v of adj[queue[q]!]!) {
        if (seen[v] || meta[v]!.site !== null) continue;
        seen[v] = true;
        queue.push(v);
      }
    }
    return seeds.filter((s) => seen[s]).length;
  };
  let start = -1;
  let startReach = -1;
  for (const s of seeds) {
    const r = reach(s);
    if (r > startReach) {
      startReach = r;
      start = s;
    }
  }
  if (start >= 0) add(start);
  const pending = seeds.filter((i) => !inSet[i]);
  while (pending.length > 0) {
    const best = new Array<number>(n).fill(Infinity);
    const from = new Array<number>(n).fill(-1);
    const done = new Array<boolean>(n).fill(false);
    for (const i of members) best[i] = 0;
    for (;;) {
      let u = -1;
      for (let i = 0; i < n; i++) if (!done[i] && best[i]! < Infinity && (u < 0 || best[i]! < best[u]!)) u = i;
      if (u < 0) break;
      done[u] = true;
      for (const v of adj[u]!) {
        if (meta[v]!.site !== null) continue;
        const w = best[u]! + dist(cent[u]!, cent[v]!);
        if (w < best[v]!) {
          best[v] = w;
          from[v] = u;
        }
      }
    }
    // The nearest pending seed the set can reach.
    let target = -1;
    for (const i of pending) if (best[i]! < Infinity && (target < 0 || best[i]! < best[target]!)) target = i;
    if (target < 0) break;
    for (let v = target; v >= 0 && !inSet[v]; v = from[v]!) add(v);
    pending.splice(0, pending.length, ...pending.filter((i) => !inSet[i]));
  }
  // The old core and the dock block keep their full streets; the blocks between them and the blocks added are the downtown's thinner blocks (`edge`) where they have a street to a block outside it.
  const isSeed = new Array<boolean>(n).fill(false);
  for (const i of seeds) if (inSet[i]) isSeed[i] = true;

  // 2. Growth: the lots the old plan gave to shops, the dock and the strip, and what it spread (`DT_EXTRA`).
  const lotsOf = (i: number): number => Math.max(1, Math.round(areaOf[i]! / SIZING.DT_LOT));
  let want = SIZING.DT_EXTRA;
  for (let i = 0; i < n; i++) {
    if (tentative[i] === "core" || tentative[i] === "dock") want += lotsOf(i);
    else if (tentative[i] === "highway strip") want += Math.round(areaOf[i]! / 1400);
  }
  let have = 0;
  for (const i of members) have += lotsOf(i);
  // The landmarks need rows: the hotel, bank, lodge hall, municipal building (and the customs house) stand on core blocks, the school, hospital (and the courthouse) on core or strip blocks;
  // a block has two rows, one landmark each.
  const customs = history.founding.purpose === "customs" ? 1 : 0;
  const coreNeeded = Math.floor((5 + customs) / 2);
  const hostsNeeded = Math.floor((7 + customs + (history.countySeat.isSeat ? 1 : 0)) / 2);
  const coreHosts = (): number => members.filter((i) => !strip[i] && !(dock.includes(i) && !core.includes(i))).length;
  const hosts = (): number => members.filter((i) => !(dock.includes(i) && !core.includes(i))).length;
  const refs = seeds.map((i) => cent[i]!);
  const nearHighway = (i: number): number => {
    let near = Infinity;
    for (const q of blocks[i]!.polygon) near = Math.min(near, Math.abs(q.x - roadAt(site, q.z)));
    return near;
  };
  const eligible = (i: number): boolean => meta[i]!.site === null && areaOf[i]! >= SIZING.DT_MIN_AREA && !["mill", "waterfront", "industrial", "mill housing", "civic"].includes(tentative[i]!);
  // The highway strip (motels, gas stations, garages, the big-box store) is at the downtown's edge on the highway: as many of its blocks as the old plan drew along it (at most `DT_STRIP_MAX`).
  const strip = new Array<boolean>(n).fill(false);
  let stripCount = 0;
  const stripWanted = history.present.highwayStrip ? Math.min(SIZING.DT_STRIP_MAX, Math.max(1, tentative.filter((d) => d === "highway strip").length)) : 0;
  const nearest = (accept: (v: number) => boolean): number => {
    let pick = -1;
    let pickD = Infinity;
    for (const m of members) {
      for (const v of adj[m]!) {
        if (inSet[v] || !accept(v)) continue;
        let d = Infinity;
        for (const r of refs) d = Math.min(d, dist(cent[v]!, r));
        if (d < pickD - 1e-9 || (Math.abs(d - pickD) <= 1e-9 && v < pick)) {
          pick = v;
          pickD = d;
        }
      }
    }
    return pick;
  };
  while (members.length > 0 && stripCount < stripWanted) {
    const v = nearest((x) => eligible(x) && nearHighway(x) <= SIZING.DT_STRIP_NEAR);
    if (v < 0) break;
    add(v);
    strip[v] = true;
    stripCount++;
    // A strip block's lots are large (30 to 60 m wide): it holds about a fifth of a core block's buildings.
    have += Math.max(1, Math.round(areaOf[v]! / 1400)) - lotsOf(v);
  }
  // Blocks beside the set, the nearest to the core and the dock first. A block of mill housing or industry, or a small one, is taken only where the landmarks have no row else (the municipal
  // building, the hotel, the school ... must stand in the downtown).
  const roomShort = (): boolean => hosts() < hostsNeeded || coreHosts() < coreNeeded;
  while (members.length > 0 && (have < want || roomShort())) {
    let pick = nearest(eligible);
    if (pick < 0 && roomShort()) pick = nearest((v) => meta[v]!.site === null && !["mill", "waterfront"].includes(tentative[v]!));
    if (pick < 0) break;
    add(pick);
    have += lotsOf(pick);
  }

  // 3. Districts: what the downtown holds is core (the dock block stays the dock), and an added block beside the highway may be the strip; the rest are what they would be.
  const districts: District[] = [];
  for (let i = 0; i < n; i++) {
    if (!inSet[i]) {
      districts.push(tentative[i] === "highway strip" || tentative[i] === "core" || tentative[i] === "dock" ? plain[i]! : tentative[i]!);
      continue;
    }
    if (isSeed[i]) {
      districts.push(dock.includes(i) ? "dock" : "core");
      continue;
    }
    districts.push(strip[i] ? "highway strip" : "core");
  }
  const edge = blocks.map((b) => inSet[b.id]! && !isSeed[b.id]! && adj[b.id]!.some((j) => !inSet[j]));
  return { downtown: members.slice().sort((p, q) => p - q), districts, edge };
}
