/**
 * The large port's landmarks: the buildings that are the town's face and the game's anchors. They are
 * chosen in two steps. First a place is reserved for each in the block plan (before lots are cut, so
 * that the lots can be cut around them); then, once buildings stand, each landmark is bound to the
 * building that took its place, and the spawn is put at the municipal building's door.
 */
import { facingYaw } from "@csarkosh/engine/sim/facing";
import { area, bbox, centroid, dist, segDist, toLocal, type Vec } from "../geom.js";
import type { Reservation } from "../lots.js";
import type { TownNames } from "../names.js";
import { chance, int, pick, type Rng } from "../rng.js";
import type { Block, Building, History, Landmark, LandmarkRole, Lot, Spawn } from "../types.js";
import type { BlockMeta, Layout } from "./layout.js";
import { RAIL_OFFSET } from "../rail.js";
import { RELIEF_LIMIT } from "../levels.js";
import { gradedHeight, heightAt, landOf } from "../land.js";
import { roadAt, shoreAt } from "../shore.js";
import type { TownSite } from "../site.js";

export type LandmarkPlan = {
  /** The reserved lots: a block carries at most one for each of its two rows (`lo` and `hi`). */
  readonly reservations: Reservation[];
};

const area0 = (b: Block): number => area(b.polygon);

/** Is a four-cornered polygon one of right angles (every corner within about 8 degrees of square)? */
function squarish(poly: readonly Vec[]): boolean {
  if (poly.length !== 4) return false;
  for (let i = 0; i < 4; i++) {
    const a = poly[i] as Vec;
    const b = poly[(i + 1) % 4] as Vec;
    const c = poly[(i + 2) % 4] as Vec;
    const ux = b.x - a.x;
    const uz = b.z - a.z;
    const vx = c.x - b.x;
    const vz = c.z - b.z;
    const l = Math.sqrt((ux * ux + uz * uz) * (vx * vx + vz * vz));
    if (l < 1e-6 || Math.abs(ux * vx + uz * vz) / l > 0.14) return false;
  }
  return true;
}

/** The block, among candidates, whose centroid is nearest a target point. */
function nearest(blocks: readonly Block[], ids: readonly number[], target: Vec): number {
  let best = -1;
  let bestD = Infinity;
  for (const id of ids) {
    const d = dist(centroid(blocks[id]!.polygon), target);
    if (d < bestD) {
      bestD = d;
      best = id;
    }
  }
  return best;
}

export function planLandmarks(site: TownSite, layout: Layout, history: History, rng: Rng): LandmarkPlan {
  const { blocks, meta, old } = layout;
  /** The rows of each block already reserved. */
  const taken: { lo: boolean; hi: boolean }[] = blocks.map(() => ({ lo: false, hi: false }));
  const reservations: Reservation[] = [];
  const isOld = (id: number): boolean => meta[id]!.tag === "old";
  const inDowntown = layout.downtown;
  /** The blocks that pass the test and have a row free (a block's two rows each take one landmark). */
  const ids = (f: (b: Block, m: BlockMeta) => boolean): number[] => {
    const out: number[] = [];
    for (const b of blocks) if (!(taken[b.id]!.lo && taken[b.id]!.hi) && f(b, meta[b.id]!)) out.push(b.id);
    return out;
  };
  /** Reserves a lot in a block, on the wanted row if it is free, else on the other; a block's rows each take one. */
  const reserve = (block: number, role: string, side: "lo" | "hi", width: number): void => {
    if (block < 0) return;
    const row = !taken[block]![side] ? side : side === "lo" ? "hi" : "lo";
    taken[block]![row] = true;
    reservations.push({ block, role, side: row, at: chance(rng, 0.5) ? "start" : "end", width, whole: false });
  };
  const land = landOf(site);
  const coreRows = old.coreRows;
  /** The side of a block that faces the main street: the core's rows lie either side of it, the lower row's high side and the upper row's low side. */
  const toMain = (id: number): "lo" | "hi" => (!isOld(id) || meta[id]!.row >= old.mainLine ? "lo" : "hi");
  /** The blocks of the downtown that are not the dock block: where the town's civic and commercial landmarks stand. */
  const hosts = (): number[] => ids((b) => inDowntown.includes(b.id) && b.district !== "dock");

  // The municipal building, shared by the sheriff and the town's government: on a street (not the highway) in one of the downtown's core blocks, a whole four-cornered block
  // of the old plat's core rows preferred so that the lot at the street is a plain one, away from the water and the highway.
  // The made ground's height at a point, as the land can guess it: the graded plane, pulled toward the land's own height by at most the relief (`ground.ts`); a start under 2 m is no start.
  const madeHeight = (p: Vec): number => {
    const plane = gradedHeight(site, land, p.x, p.z);
    return plane + Math.max(-RELIEF_LIMIT, Math.min(RELIEF_LIMIT, heightAt(land, p.x, p.z) - plane));
  };
  // Its street is a street (a lot that fronts the highway stands a lane's width and the railroad's corridor off it, too far for a door on the sidewalk): the row's frontage is measured.
  const frontGap = (id: number, side: "lo" | "hi"): { gap: number; mid: Vec } => {
    const m = meta[id]!;
    const loc = blocks[id]!.polygon.map((p) => toLocal(m.frame, p));
    const bb = bbox(loc.map((l) => ({ x: l.u, z: l.v })));
    const swap = bb.x1 - bb.x0 < bb.z1 - bb.z0;
    const ts = loc.map((l) => (swap ? l.u : l.v));
    const t0 = Math.min(...ts);
    const t1 = Math.max(...ts);
    const reach = (t1 - t0) * 0.2;
    // The middle of the row's frontage: the mean of the corners at its edge of the block.
    let mx = 0;
    let mz = 0;
    let n = 0;
    for (let i = 0; i < ts.length; i++) {
      if (side === "lo" ? ts[i]! > t0 + reach : ts[i]! < t1 - reach) continue;
      mx += blocks[id]!.polygon[i]!.x;
      mz += blocks[id]!.polygon[i]!.z;
      n++;
    }
    const mid = { x: mx / Math.max(1, n), z: mz / Math.max(1, n) };
    let gap = Infinity;
    for (const st of layout.streets) if (st.kind !== "highway" && st.kind !== "rail" && st.kind !== "alley" && st.kind !== "stair") gap = Math.min(gap, segDist(mid, st.a, st.b) - st.width / 2);
    return { gap, mid };
  };
  const rowsFree = (id: number): ("lo" | "hi")[] => (["lo", "hi"] as const).filter((r) => !taken[id]![r]);
  const hallSlots: { id: number; side: "lo" | "hi"; rank: number }[] = [];
  for (const id of ids((b) => inDowntown.includes(b.id))) {
    const b = blocks[id]!;
    for (const side of rowsFree(id)) {
      const { gap, mid } = frontGap(id, side);
      // Core blocks of the old plat beside the main street first, then any core block, then any other; a front on a street (within 5 m of its pavement) before one that is not.
      const where = b.district === "core" && isOld(id) && coreRows.includes(meta[id]!.row) ? 0 : b.district === "core" ? 1 : 2;
      // A block near the highway has the railroad's clearance to keep: the building would stand back from its street, too far for a door on the sidewalk.
      let hwy = Infinity;
      for (const q of b.polygon) hwy = Math.min(hwy, Math.abs(q.x - roadAt(site, q.z)));
      // ... and one by the water stands low: the player's start is on ground above the sea.
      const c = centroid(b.polygon);
      hallSlots.push({ id, side, rank: (gap <= 5 ? 0 : 6) + (hwy < 70 ? 12 : 0) + (c.x - shoreAt(site, c.z) < 110 ? 4 : 0) + (madeHeight(mid) < 2.3 ? 30 : 0) + where * 2 + (side === toMain(id) ? 0 : 1) + (squarish(b.polygon) ? 0 : 20) + (Math.abs(area0(b)) < 3000 ? 20 : 0) });
    }
  }
  // On a core block wherever one has a row for it: a block of the highway strip is the edge of the town, and holds it only where no core block can.
  const coreSlots = hallSlots.filter((x) => blocks[x.id]!.district === "core");
  if (coreSlots.length > 0) hallSlots.splice(0, hallSlots.length, ...coreSlots);
  hallSlots.sort((p, q) => p.rank - q.rank || dist(centroid(blocks[p.id]!.polygon), layout.coreCentre) - dist(centroid(blocks[q.id]!.polygon), layout.coreCentre) || p.id - q.id);
  const best = hallSlots.filter((x) => x.rank === (hallSlots[0]?.rank ?? 0));
  const hallAt = best.length > 0 ? pick(rng, best.slice(0, 2)) : null;
  if (hallAt) reserve(hallAt.id, "municipal", hallAt.side, int(rng, 26, 30));

  // The boom-era hotel, the bank and the lodge hall: on the downtown's core blocks, the hotel nearest the wharf street's foot, facing the main street where a row is free.
  const coreHosts = (): number[] => ids((b) => inDowntown.includes(b.id) && b.district === "core");
  const anyHost = (): number[] => {
    const c = coreHosts();
    if (c.length > 0) return c;
    const h = hosts();
    return h.length > 0 ? h : ids((b) => inDowntown.includes(b.id));
  };
  const hotelAt = nearest(blocks, anyHost(), layout.wharfFoot);
  if (hotelAt >= 0) reserve(hotelAt, "hotel", toMain(hotelAt), int(rng, 26, 32));
  const bankList = anyHost();
  const bankAt = bankList.length > 0 ? pick(rng, bankList) : -1;
  if (bankAt >= 0) reserve(bankAt, "bank", toMain(bankAt), 15);
  const lodgeList = anyHost();
  const lodgeAt = lodgeList.length > 0 ? pick(rng, lodgeList) : -1;
  if (lodgeAt >= 0) reserve(lodgeAt, "lodge", "hi", 15);
  if (history.founding.purpose === "customs") {
    const c = anyHost();
    if (c.length > 0) {
      const b = pick(rng, c);
      reserve(b, "customs", toMain(b), 24);
    }
  }

  // The depot stands beside the railroad's main line (`rail.ts`), which runs seaward of the highway: the block beside it, on its seaward side, nearest the core.
  if (history.railroad) {
    const railX = (z: number): number => roadAt(site, z) - RAIL_OFFSET;
    const beside = (b: Block): number => {
      let d = Infinity;
      for (const q of b.polygon) d = Math.min(d, railX(q.z) - q.x);
      return d;
    };
    // A plain four-cornered block, so that the depot's lot is a plain one.
    const cand0 = ids((b, x) => x.site !== "terminal" && b.polygon.length === 4 && b.polygon.every((q) => q.x < railX(q.z)) && Math.abs(area0(b)) >= 1500);
    // A block cut oblique by the shore or the highway can give the depot's lot only a sliver: a block of right angles is preferred.
    // The old plat's quay row, where the track meets the wharf street, is the first choice; then the blocks of right angles seaward of the line.
    const quayOnes = ids((b, x) => isOld(b.id) && x.row === 0 && x.site !== "terminal" && b.district !== "core" && squarish(b.polygon));
    const squareOnes = cand0.filter((id) => squarish(blocks[id]!.polygon));
    const cand = quayOnes.length > 0 ? quayOnes : squareOnes.length > 0 ? squareOnes : cand0;
    const pool = cand.length > 0 ? cand : ids((b, x) => isOld(b.id) && x.row === 0);
    const pick1 = pool.length > 0 ? pool : ids((_b, x) => x.site !== "terminal");
    let best = -1;
    let bestScore = Infinity;
    for (const id of pick1) {
      // A yard of houses is no place for a depot: the town's working districts are preferred.
      const houses = blocks[id]!.district === "residential" || blocks[id]!.district === "mill housing";
      const score = beside(blocks[id]!) + 0.25 * dist(centroid(blocks[id]!.polygon), layout.coreCentre) + (houses ? 150 : 0);
      if (score < bestScore) {
        bestScore = score;
        best = id;
      }
    }
    if (best >= 0) reserve(best, "depot", "hi", 24);
  }
  const term = ids((b, x) => x.site === "terminal");
  if (term.length > 0) {
    let best = term[0]!;
    for (const id of term) if (Math.abs(area0(blocks[id]!)) > Math.abs(area0(blocks[best]!))) best = id;
    reserve(best, "terminal", "hi", 45);
  }

  // Churches: two, on residential blocks near the core (outside the downtown: churches stay spread out).
  const resid = ids((b) => !inDowntown.includes(b.id) && (b.district === "residential" || b.district === "mill housing"));
  const nearCore = resid
    .map((id) => ({ id, d: dist(centroid(blocks[id]!.polygon), layout.coreCentre) }))
    .filter((x) => x.d > 90 && x.d < 460)
    .sort((p, q) => p.d - q.d || p.id - q.id);
  const first = nearCore.slice(0, 5);
  if (first.length > 0) {
    const c1 = pick(rng, first).id;
    reserve(c1, "church", "lo", 22);
    const second = nearCore.filter((x) => x.id !== c1).slice(0, 8);
    if (second.length > 0) reserve(pick(rng, second).id, "church", "hi", 22);
  }

  // The high school, the hospital and, where the town is the county seat, the courthouse: lots in the downtown's outer blocks (a free row of a block that is not the dock's).
  const civicAt = (role: string, lo: number, hi: number): void => {
    const list = hosts().sort((p, q) => (meta[p]!.edge === meta[q]!.edge ? 0 : meta[p]!.edge ? -1 : 1) || dist(centroid(blocks[q]!.polygon), layout.coreCentre) - dist(centroid(blocks[p]!.polygon), layout.coreCentre) || p - q);
    if (list.length === 0) return;
    const id = pick(rng, list.slice(0, 3));
    reserve(id, role, toMain(id) === "lo" ? "hi" : "lo", int(rng, lo, hi));
  };
  civicAt("school", 46, 60);
  civicAt("hospital", 42, 54);
  if (history.countySeat.isSeat) civicAt("courthouse", 40, 50);
  if (history.present.tsunamiRefuge) {
    // On high ground inland of the highway: a block of the land company's plat.
    const hill = (b: Block): boolean => {
      const c = centroid(b.polygon);
      return b.plat === "company" && !inDowntown.includes(b.id) && (b.district === "residential" || b.district === "mill housing") && c.x > roadAt(site, c.z) + 25 && Math.abs(area0(b)) >= 1800;
    };
    const hillAt = (dx: number, dz: number): Vec => {
      const z = layout.coreCentre.z + dz;
      return { x: roadAt(site, z) + dx, z };
    };
    const cand = ids((b) => hill(b));
    const r = nearest(blocks, cand.length > 0 ? cand : ids((b) => !inDowntown.includes(b.id) && b.district === "residential" && b.plat === "company"), hillAt(60, int(rng, 60, 200)));
    if (r >= 0) reserve(r, "refuge", "hi", 22);
  }
  return { reservations };
}

/** The municipal building's lot's front, door and the spawn: on the street side of the door, 2 m out, facing away from the building. */
export function spawnAt(b: Building): Spawn {
  const f = b.front ?? { x: 0, z: 1 };
  // The front wall's distance from the centre along the front vector: the half extent along the axis the front lies on.
  const U = { x: b.bearing.a / b.bearing.c, z: b.bearing.b / b.bearing.c };
  const alongU = Math.abs(f.x * U.x + f.z * U.z) > 0.5;
  const half = alongU ? b.halfAlong : b.halfAcross;
  const x = b.centre.x + f.x * (half + 2);
  const z = b.centre.z + f.z * (half + 2);
  return { x, z, yaw: facingYaw(f.x, f.z) };
}

const ROLE_OF: Record<string, LandmarkRole> = {
  municipal: "municipal building",
  hotel: "hotel",
  bank: "bank",
  lodge: "lodge",
  customs: "customs house",
  depot: "depot",
  terminal: "port terminal",
  church: "church",
  school: "high school",
  hospital: "hospital",
  courthouse: "courthouse",
  refuge: "tsunami refuge",
};

export function roleOf(role: string): LandmarkRole | null {
  return ROLE_OF[role] ?? null;
}

/** Binds landmarks to the buildings that stand on their lots, naming and describing each. */
export function bindLandmarks(
  history: History,
  names: TownNames,
  townName: string,
  lots: readonly Lot[],
  buildings: readonly Building[],
): Landmark[] {
  const out: Landmark[] = [];
  const add = (role: LandmarkRole, name: string, building: number, text: string): void => {
    out.push({ id: out.length, role, name, building, text });
  };
  const byLot = (lotId: number): Building | undefined => buildings.find((b) => b.lot === lotId);
  let saint = 0;
  let lodge = 0;
  // The municipal building first, so that it is landmark 0.
  const order = lots
    .filter((l) => l.role !== null)
    .slice()
    .sort((p, q) => rank(p.role!) - rank(q.role!) || p.id - q.id);
  for (const lot of order) {
    const b = byLot(lot.id);
    const role = roleOf(lot.role!);
    if (!b || !role) continue;
    const era = `${b.era}s`;
    switch (lot.role) {
      case "municipal":
        add("municipal building", `${townName} Municipal Building`, b.id, `The municipal building (built in the ${era}), where the sheriff and the town's government share a roof, on a block of the downtown beside the main street.`);
        break;
      case "hotel":
        add("hotel", names.hotel, b.id, history.boom.bust1893 ? `The boom-era hotel, built on the hope of the ${history.boom.peakYear} boom and never filled after 1893.` : `The hotel of the ${history.boom.peakYear} boom.`);
        break;
      case "bank":
        add("bank", `${townName} Savings Bank`, b.id, `The bank of the downtown, built in the ${era}.`);
        break;
      case "lodge":
        add("lodge", `${names.lodges[lodge++ % names.lodges.length]!} Lodge`, b.id, `The lodge hall, built in the ${era}.`);
        break;
      case "customs":
        add("customs house", `${townName} Customs House`, b.id, `The customs house of the port of entry the town was made.`);
        break;
      case "depot":
        add("depot", `${townName} Depot`, b.id, `The railroad depot, where the track along the shore meets the wharf street.`);
        break;
      case "terminal":
        add("port terminal", `Port of ${townName} Terminal`, b.id, `The public port's terminal (created in ${history.port.year}), which handles ${history.port.handles}.`);
        break;
      case "church":
        add("church", `${names.saints[saint++ % names.saints.length]!} Church`, b.id, `A church of the old town.`);
        break;
      case "school":
        add("high school", `${townName} High School`, b.id, `The high school, on a block at the edge of the downtown.`);
        break;
      case "hospital":
        add("hospital", `${townName} Community Hospital`, b.id, `The hospital, built in the ${era} at the edge of the downtown.`);
        break;
      case "courthouse":
        add("courthouse", `${history.countySeat.county} Courthouse`, b.id, `The county courthouse, beside the downtown: ${townName} is the county seat.`);
        break;
      case "refuge":
        add("tsunami refuge", `${townName} Tsunami Refuge Tower`, b.id, `A vertical refuge for the tsunami, on high ground.`);
        break;
      default:
        break;
    }
  }
  // The mill: the largest building on the mill's site.
  let mill: Building | undefined;
  let millArea = -1;
  for (const b of buildings) {
    if (b.kind !== "mill shed" || b.lot < 0) continue;
    const a = b.halfAlong * b.halfAcross;
    if (a > millArea) {
      millArea = a;
      mill = b;
    }
  }
  if (mill) {
    add(
      "mill",
      `${history.mill.company} mill`,
      mill.id,
      history.mill.fate === "working"
        ? `The mill still works; it has been cutting since ${history.mill.startYear}.`
        : `The mill, closed in ${history.mill.closedYear}; ${history.mill.cleanup ? "its site is in cleanup and most of it is cleared" : "its site stands fenced, the sheds as they were left"}.`,
    );
  }
  return out;
}

function rank(role: string): number {
  if (role === "municipal") return 0;
  const order = ["hotel", "bank", "lodge", "customs", "depot", "terminal", "church", "school", "hospital", "courthouse", "refuge"];
  const i = order.indexOf(role);
  return i < 0 ? 99 : i + 1;
}

