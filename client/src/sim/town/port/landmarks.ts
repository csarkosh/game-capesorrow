/**
 * The large port's landmarks: the buildings that are the town's face and the game's anchors. They are
 * chosen in two steps. First a place is reserved for each in the block plan (before lots are cut, so
 * that the lots can be cut around them); then, once buildings stand, each landmark is bound to the
 * building that took its place, and the spawn is put at the FBI office's door.
 */
import { facingYaw } from "@csarkosh/engine/sim/facing";
import { area, centroid, dist, type Vec } from "../geom.js";
import type { Reservation } from "../lots.js";
import type { TownNames } from "../names.js";
import { chance, int, pick, type Rng } from "../rng.js";
import type { Block, Building, History, Landmark, LandmarkRole, Lot, Spawn } from "../types.js";
import type { BlockMeta, Layout } from "./layout.js";
import { RAIL_OFFSET } from "../rail.js";
import { roadAt } from "../shore.js";
import type { TownSite } from "../site.js";

export type LandmarkPlan = {
  readonly reservations: Reservation[];
  /** Blocks that become civic (the school's, the hospital's, the courthouse's). */
  readonly civic: number[];
};

const area0 = (b: Block): number => area(b.polygon);

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
  const used: boolean[] = [];
  const reservations: Reservation[] = [];
  const civic: number[] = [];
  const isOld = (id: number): boolean => meta[id]!.tag === "old";
  const ids = (f: (b: Block, m: BlockMeta) => boolean): number[] => {
    const out: number[] = [];
    for (const b of blocks) if (!used[b.id] && f(b, meta[b.id]!)) out.push(b.id);
    return out;
  };
  const reserve = (block: number, role: string, side: "lo" | "hi", width: number, whole = false): void => {
    if (block < 0) return;
    used[block] = true;
    reservations.push({ block, role, side, at: chance(rng, 0.5) ? "start" : "end", width, whole });
  };
  const coreRows = old.coreRows;
  const rowLo = coreRows.length > 0 ? Math.min(...coreRows) : 0;
  const rowHi = coreRows.length > 0 ? Math.max(...coreRows) : 0;
  /** The side of a block that faces the main street: the core's rows lie either side of it, the lower row's high side and the upper row's low side. */
  const toMain = (id: number): "lo" | "hi" => (meta[id]!.row >= old.mainLine ? "lo" : "hi");

  // The FBI office: one block off the main street, beside the core.
  const fbiVariant: "federal" | "office" = chance(rng, 0.6) ? "federal" : "office";
  let fbiBlocks = ids((b, x) => isOld(b.id) && (x.row === rowHi + 1 || x.row === rowLo - 1) && Math.abs(x.d) < 1.5);
  if (fbiBlocks.length === 0) fbiBlocks = ids((b) => isOld(b.id) && b.district === "core");
  if (fbiBlocks.length === 0) fbiBlocks = ids((b) => isOld(b.id));
  if (fbiBlocks.length === 0) fbiBlocks = ids(() => true);
  // A whole four-cornered block, so that the lot at its street is a plain one.
  const plain = fbiBlocks.filter((id) => blocks[id]!.polygon.length === 4);
  const fbi = fbiBlocks.length > 0 ? pick(rng, plain.length > 0 ? plain : fbiBlocks) : -1;
  reserve(fbi, fbiVariant === "federal" ? "fbi-federal" : "fbi-office", "lo", fbiVariant === "federal" ? int(rng, 26, 30) : int(rng, 22, 26));

  // The boom-era hotel, the bank and the lodge hall, on the blocks that face the main street.
  const coreAny = ids((b) => b.district === "core");
  const facing = ids((b) => isOld(b.id) && b.district === "core");
  const hotel = facing.length > 0 ? nearest(blocks, facing, layout.wharfFoot) : coreAny.length > 0 ? nearest(blocks, coreAny, layout.wharfFoot) : -1;
  if (hotel >= 0) reserve(hotel, "hotel", toMain(hotel), int(rng, 26, 32));
  const rest = facing.filter((id) => !used[id]);
  if (rest.length > 0) {
    const b = pick(rng, rest);
    reserve(b, "bank", toMain(b), 15);
  }
  const lodges = ids((b) => b.district === "core");
  if (lodges.length > 0) reserve(pick(rng, lodges), "lodge", "hi", 15);
  if (history.founding.purpose === "customs") {
    const c = ids((b) => isOld(b.id) && b.district === "core");
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
    const cand = ids((b) => b.district !== "civic" && b.polygon.length === 4 && b.polygon.every((q) => q.x < railX(q.z)) && Math.abs(area0(b)) >= 1500);
    const pool = cand.length > 0 ? cand : ids((b, x) => isOld(b.id) && x.row === 0);
    const pick1 = pool.length > 0 ? pool : ids(() => true);
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

  // Churches: two, on residential blocks near the core.
  const resid = ids((b) => b.district === "residential" || b.district === "mill housing");
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

  // The civic blocks, whole, on the hill inland of the highway: the high school, the hospital, the courthouse if the town is the seat.
  const hill = (min: number) => (b: Block): boolean => {
    const c = centroid(b.polygon);
    return b.plat === "company" && (b.district === "residential" || b.district === "mill housing") && c.x > roadAt(site, c.z) + 25 && Math.abs(area0(b)) >= min;
  };
  const hillAt = (dx: number, dz: number): Vec => {
    const z = layout.coreCentre.z + dz;
    return { x: roadAt(site, z) + dx, z };
  };
  const bigAny = (min: number): number[] => {
    for (const mn of [min, 4500, 3000, 1800]) {
      const found = ids(hill(mn));
      if (found.length > 0) return found;
    }
    return ids((b) => b.plat === "company" && (b.district === "residential" || b.district === "mill housing") && Math.abs(area0(b)) >= 1800);
  };
  const school = nearest(blocks, bigAny(6500), hillAt(150, int(rng, -150, 150)));
  if (school >= 0) {
    reserve(school, "school", "lo", 0, true);
    civic.push(school);
  }
  const hospital = nearest(blocks, bigAny(6500), hillAt(230, int(rng, -250, 250)));
  if (hospital >= 0) {
    reserve(hospital, "hospital", "lo", 0, true);
    civic.push(hospital);
  }
  if (history.countySeat.isSeat) {
    const ch = nearest(blocks, bigAny(4500), hillAt(90, int(rng, -60, 60)));
    if (ch >= 0) {
      reserve(ch, "courthouse", "lo", 0, true);
      civic.push(ch);
    }
  }
  if (history.present.tsunamiRefuge) {
    const cand = ids(hill(1800));
    const r = nearest(blocks, cand.length > 0 ? cand : ids((b) => b.district === "residential" && b.plat === "company"), hillAt(60, int(rng, 60, 200)));
    if (r >= 0) reserve(r, "refuge", "hi", 22);
  }
  return { reservations, civic };
}

/** The FBI office's lot's front, door and the spawn: on the street side of the door, 2 m out, facing away from the building. */
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
  "fbi-federal": "fbi",
  "fbi-office": "fbi",
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
  // The FBI office first, so that it is landmark 0.
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
      case "fbi-federal":
        add("fbi", "FBI Resident Agency", b.id, `A small resident agency on a leased floor of the old Federal Building and Post Office (built in the ${era}), one block off the main street.`);
        break;
      case "fbi-office":
        add("fbi", "FBI Resident Agency", b.id, `A small resident agency on a leased floor of a ${era} office block, one block off the main street.`);
        break;
      case "hotel":
        add("hotel", names.hotel, b.id, history.boom.bust1893 ? `The boom-era hotel, built on the hope of the ${history.boom.peakYear} boom and never filled after 1893.` : `The hotel of the ${history.boom.peakYear} boom.`);
        break;
      case "bank":
        add("bank", `${townName} Savings Bank`, b.id, `The bank of the core, built in the ${era}.`);
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
        add("high school", `${townName} High School`, b.id, `The high school, on a block of the land company's plat.`);
        break;
      case "hospital":
        add("hospital", `${townName} Community Hospital`, b.id, `The hospital, built in the ${era} at the edge of the old town.`);
        break;
      case "courthouse":
        add("courthouse", `${history.countySeat.county} Courthouse`, b.id, `The county courthouse on the hill: ${townName} is the county seat.`);
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
  if (role.startsWith("fbi")) return 0;
  const order = ["hotel", "bank", "lodge", "customs", "depot", "terminal", "church", "school", "hospital", "courthouse", "refuge"];
  const i = order.indexOf(role);
  return i < 0 ? 99 : i + 1;
}

