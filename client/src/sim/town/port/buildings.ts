/**
 * The large port's buildings: one per built lot, with a kind, an era, a material and a state that
 * follow from the district and from the history. Core buildings fill their lot's width wall to wall at
 * the street line; houses sit back from the street with side yards; the working waterfront's piers
 * and sheds on piles run out over the water.
 *
 * THE ORDER OF USES ALONG THE WORKING WATERFRONT IS AUTHORED, NOT SOURCED: the research found no
 * Sanborn-map ordering for any town. From the mill's end to the dock end it runs: lumber docks and
 * warehouses, the public port's terminal, the wharf street (with the depot), warehouses and, at the
 * dock end, the canneries and the rough waterfront. The building mixes and their shares are authored
 * too: the research has no building inventories for large ports.
 */
import { orientedRect, type Vec } from "../geom.js";
import { COMPASS, bearingU, bearingV } from "../bearings.js";
import { fitRect, lotExtents, type LotDraft, type Want } from "../lots.js";
import { chance, int, next, pick, range, shuffled, weighted, type Rng } from "../rng.js";
import type { TownSite } from "../site.js";
import type { Block, Building, BuildingKind, BuildingState, Gap, History, Lot, Material, Roof } from "../types.js";
import { onMadeGround, type BlockMeta, type Layout } from "./layout.js";
import { SIZING } from "./sizing.js";

const dec = (y: number): number => Math.floor(y / 10) * 10;

/** Buildings kept apart by the lot that was cut for them, before the final numbering. */
type Draft = {
  lot: number;
  centre: Vec;
  halfAlong: number;
  halfAcross: number;
  bearing: Building["bearing"];
  storeys: number;
  height: number;
  roof: Roof;
  kind: BuildingKind;
  era: number;
  material: Material;
  state: BuildingState;
  front: Vec | null;
  /** Never thinned out. */
  keep: boolean;
  /** The lot's draw and its district's chance of being built on: built when the draw is under the chance (plus the town's fill). */
  u: number;
  occ: number;
  /** The lot is the public port's terminal yard: the town's fill does not raise its chance (the cargo needs the open ground). */
  yard: boolean;
};

const ROLE_KIND: Record<string, BuildingKind> = {
  "fbi-federal": "federal building",
  "fbi-office": "office",
  hotel: "hotel",
  bank: "bank",
  lodge: "lodge hall",
  customs: "customs house",
  depot: "depot",
  terminal: "port terminal shed",
  church: "church",
  school: "school",
  hospital: "hospital",
  courthouse: "courthouse",
  refuge: "tsunami refuge",
};

/**
 * HOW MANY BUILDINGS THE TOWN HOLDS. AUTHORED, NOT RESEARCHED. The plan's blocks are taken until their lots come to about the buildings the town holds
 * (`growth.ts`), and the town's fill raises every district's chance of being built on until `MIN_BUILDINGS` stand on the grid's lots (a town of few
 * blocks is built fuller). Past a cap the houses thin out, one a lot, to keep the map small: the owner's rule is a condensed map, but the cap is
 * set above what the blocks hold (it was 330 to 430 over a town that held 300 and fewer shops) so that it is a safety, not what shapes the town.
 */
export const MIN_BUILDINGS = SIZING.MIN_BUILDINGS;
/** ... and, where the blocks hold more lots than that, this share of the lots (a town whose history gave it room is built as full as the rest, not emptier). */
export const FILL = SIZING.FILL;
export const HOUSE_CAP: readonly [number, number] = SIZING.HOUSE_CAP;

const SHOP_KINDS: readonly BuildingKind[] = ["storefront", "tavern", "office"];
const HOUSE_KINDS: readonly BuildingKind[] = ["house", "apartment"];

export type BuildInput = {
  site: TownSite;
  history: History;
  layout: Layout;
  blocks: readonly Block[];
  lots: readonly Lot[];
  drafts: readonly LotDraft[];
};

export function buildPort(input: BuildInput, rng: Rng): { buildings: Building[]; gaps: Gap[] } {
  const { site, history, layout, blocks, lots, drafts } = input;
  const out: Draft[] = [];
  const gaps: Gap[] = [];
  const fire = history.fire;
  const bust = history.boom.bust1893;
  const millClosed = history.mill.fate === "closed";
  const decline = (bust ? 0.08 : 0) + (millClosed ? 0.06 : 0);

  /** Era and material of the core's commercial stock: the rebuilt one after a fire, the old one if there was none. */
  const coreStock = (): { era: number; material: Material } => {
    if (chance(rng, 0.12)) return { era: dec(1950 + int(rng, 0, 30)), material: "concrete" };
    if (fire) {
      const span = bust && fire.year <= 1893 ? 1893 - fire.year : 14;
      const y = fire.year + int(rng, 0, span);
      return { era: dec(y), material: y >= 1922 ? pick(rng, ["concrete", "brick"] as const) : "brick" };
    }
    const y = 1883 + int(rng, 0, bust ? 10 : 32);
    return { era: dec(y), material: y < 1895 && chance(rng, 0.5) ? "wood" : "brick" };
  };
  /** The old stock of a district the fire did not reach: wood, from before. */
  const oldStock = (): { era: number; material: Material } => ({ era: dec(1880 + int(rng, 0, 25)), material: chance(rng, 0.65) ? "wood" : "brick" });
  const rebuilt = fire !== null && fire.burned === "both";

  const stockFor = (kind: BuildingKind, district: string, m: BlockMeta, lotRole: string | null): { era: number; material: Material } => {
    if (lotRole) {
      switch (lotRole) {
        case "fbi-federal":
          return { era: 1930, material: pick(rng, ["brick", "stone"] as const) };
        case "fbi-office":
          return { era: 1970, material: "concrete" };
        case "hotel":
          if (!fire && bust) return { era: dec(history.boom.peakYear), material: "brick" };
          return coreStockNoInfill();
        case "bank":
          return { ...coreStockNoInfill(), material: pick(rng, ["stone", "brick"] as const) };
        case "lodge":
          return coreStockNoInfill();
        case "customs":
          return { ...coreStockNoInfill(), material: "stone" };
        case "depot":
          // A depot in the burned core was rebuilt with it.
          if (fire && district === "core") return coreStockNoInfill();
          return { era: dec(history.railroad?.year ?? 1900), material: chance(rng, 0.7) ? "wood" : "brick" };
        case "terminal":
          return { era: dec(history.port.year + int(rng, 0, 50)), material: pick(rng, ["metal", "concrete"] as const) };
        case "church":
          return { era: dec(1890 + int(rng, 0, 60)), material: chance(rng, 0.7) ? "wood" : "brick" };
        case "school":
          return { era: dec(1925 + int(rng, 0, 40)), material: chance(rng, 0.7) ? "brick" : "concrete" };
        case "hospital":
          return { era: dec(1950 + int(rng, 0, 25)), material: "concrete" };
        case "courthouse":
          return { era: dec(1905 + int(rng, 0, 25)), material: pick(rng, ["stone", "brick"] as const) };
        case "refuge":
          return { era: pick(rng, [2010, 2020] as const), material: "concrete" };
        default:
          break;
      }
    }
    switch (district) {
      case "core":
        return coreStock();
      case "dock":
        return rebuilt ? coreStockNoInfill() : oldStock();
      case "waterfront": {
        if (kind === "port terminal shed" || kind === "silo") return { era: dec(history.port.year + int(rng, 0, 60)), material: pick(rng, ["metal", "concrete"] as const) };
        if (rebuilt) return coreStockNoInfill();
        if (chance(rng, 0.35)) return { era: dec(1950 + int(rng, 0, 40)), material: "metal" };
        return oldStock();
      }
      case "mill":
        return { era: dec(history.mill.startYear + int(rng, 0, 50)), material: chance(rng, 0.6) ? "wood" : "metal" };
      case "mill housing":
        return { era: dec(history.mill.startYear + int(rng, 0, 40)), material: "wood" };
      case "residential": {
        const claim = m.frame === layout.old.frame;
        const era = claim ? dec(1885 + int(rng, 0, 45)) : dec(1905 + int(rng, 0, 65));
        return { era, material: era >= 1950 && chance(rng, 0.35) ? "stucco" : "wood" };
      }
      case "highway strip":
        if (kind === "big-box store") return { era: dec(1980 + int(rng, 0, 25)), material: "concrete" };
        if (kind === "restaurant") return { era: dec(1960 + int(rng, 0, 30)), material: "stucco" };
        return { era: dec(1950 + int(rng, 0, 19)), material: pick(rng, ["stucco", "concrete", "metal"] as const) };
      case "industrial":
        return { era: dec(1940 + int(rng, 0, 50)), material: "metal" };
      default:
        return { era: 1950, material: "concrete" };
    }
  };
  const coreStockNoInfill = (): { era: number; material: Material } => {
    if (fire) {
      const span = bust && fire.year <= 1893 ? 1893 - fire.year : 14;
      const y = fire.year + int(rng, 0, span);
      return { era: dec(y), material: y >= 1922 ? pick(rng, ["concrete", "brick"] as const) : "brick" };
    }
    const y = 1883 + int(rng, 0, bust ? 10 : 32);
    return { era: dec(y), material: y < 1895 && chance(rng, 0.5) ? "wood" : "brick" };
  };

  const kindFor = (district: string, m: BlockMeta, lotW: number): BuildingKind => {
    const cannery = history.founding.purpose === "cannery";
    switch (district) {
      case "core":
        return weighted<BuildingKind>(rng, [["storefront", 78], ["tavern", SIZING.TAVERN_CORE], ["office", 8], ["storefront", 8]]);
      case "dock":
        return weighted<BuildingKind>(rng, [["tavern", SIZING.TAVERN_DOCK], ["boarding house", 22], ["storefront", 33], ["warehouse", 20], ["cannery", cannery ? 25 : 4]]);
      case "waterfront":
        return weighted<BuildingKind>(rng, [["port terminal shed", 55], ["warehouse", 30], ["silo", history.port.handles === "grain" ? 25 : 0], ["garage", 5]]);
      case "mill":
        return chance(rng, 0.9) ? "mill shed" : "warehouse";
      case "mill housing":
        return "house";
      case "residential":
        return lotW >= 15 && chance(rng, 0.06) ? "apartment" : "house";
      case "highway strip":
        return weighted<BuildingKind>(rng, [["motel", SIZING.STRIP_MOTEL], ["gas station", SIZING.STRIP_GAS], ["restaurant", 18], ["storefront", SIZING.STRIP_SHOPS], ["big-box store", lotW >= 40 ? 10 : 0], ["garage", 8]]);
      case "industrial":
        return weighted<BuildingKind>(rng, [["warehouse", 70], ["garage", 30]]);
      default:
        return "warehouse";
    }
  };

  const wantFor = (kind: BuildingKind, W: number, D: number, alley: boolean): Want => {
    const r = (lo: number, hi: number): number => range(rng, lo, hi);
    switch (kind) {
      case "storefront":
      case "tavern":
      case "office":
      case "bank":
      case "hotel":
      case "lodge hall":
        return { width: W - 0.2, depth: Math.min(D - (alley ? 2 : 0.6), D * r(0.8, 1)), setback: 0 };
      case "boarding house":
        return { width: W - 0.2, depth: D * r(0.75, 0.95), setback: 0 };
      case "house":
        return { width: Math.min(W - 3.5, r(8, 11)), depth: r(8, 11.5), setback: r(4.5, 7), slide: r(0.3, 0.7) };
      case "apartment":
        return { width: Math.min(W - 3, r(11, 14)), depth: r(13, 17), setback: r(3, 4) };
      case "warehouse":
        return { width: W - 3, depth: D * r(0.55, 0.9), setback: r(2, 4) };
      case "mill shed":
        return { width: Math.min(W - 6, 70), depth: Math.min(D * r(0.6, 0.85), 45), setback: r(6, 12) };
      case "cannery":
      case "port terminal shed":
        return { width: Math.min(W - 4, 70), depth: Math.min(D * 0.8, 40), setback: r(2, 5) };
      case "silo":
        return { width: 14, depth: 14, setback: 4 };
      case "motel":
        return { width: Math.min(W - 4, 36), depth: r(11, 12.5), setback: r(9, 14) };
      case "gas station":
        return { width: 12, depth: 9, setback: r(12, 18) };
      case "restaurant":
        return { width: 16, depth: 11, setback: 12 };
      case "big-box store":
        return { width: W - 8, depth: Math.min(D * 0.7, 55), setback: D * 0.2 };
      case "garage":
        return { width: 12, depth: 14, setback: 3 };
      case "church":
        return { width: r(12, 15), depth: r(24, 30), setback: 5 };
      case "school":
        return { width: Math.min(W * 0.7, 80), depth: Math.min(D * 0.35, 30), setback: D * 0.15 };
      case "hospital":
        return { width: Math.min(W * 0.7, 70), depth: Math.min(D * 0.5, 45), setback: D * 0.12 };
      case "courthouse":
        return { width: Math.min(W * 0.55, 50), depth: Math.min(D * 0.3, 30), setback: D * 0.2 };
      case "tsunami refuge":
        return { width: 12, depth: 12, setback: 5 };
      case "depot":
        return { width: W - 3, depth: 10, setback: 3 };
      case "customs house":
        return { width: W - 1, depth: D * 0.7, setback: 1 };
      case "federal building":
        return { width: W - 1, depth: D * 0.75, setback: 0 };
      default:
        return { width: W - 2, depth: D * 0.7, setback: 0 };
    }
  };

  const storeysFor = (kind: BuildingKind, era: number, material: Material): number => {
    switch (kind) {
      case "storefront":
      case "tavern":
        return era < 1890 && material === "wood" ? weighted(rng, [[1, 4], [2, 6]]) : weighted(rng, [[1, 2], [2, 5], [3, 3], [4, 1]]);
      case "office":
        return weighted(rng, [[2, 4], [3, 4], [4, 2]]);
      case "hotel":
        return int(rng, 4, 5);
      case "bank":
        return 2;
      case "lodge hall":
        return int(rng, 2, 3);
      case "boarding house":
        return int(rng, 2, 3);
      case "house":
        return weighted(rng, [[1, 6], [2, 4]]);
      case "apartment":
        return int(rng, 2, 3);
      case "warehouse":
        return weighted(rng, [[1, 6], [2, 4]]);
      case "motel":
        return weighted(rng, [[1, 5], [2, 5]]);
      case "federal building":
        return 3;
      case "courthouse":
        return int(rng, 2, 3);
      case "school":
        return 2;
      case "hospital":
        return int(rng, 3, 4);
      case "customs house":
        return int(rng, 2, 3);
      case "tsunami refuge":
        return 4;
      default:
        return 1;
    }
  };

  const roofFor = (kind: BuildingKind, era: number): Roof => {
    switch (kind) {
      case "storefront":
      case "tavern":
      case "office":
      case "bank":
      case "hotel":
      case "lodge hall":
      case "federal building":
      case "school":
      case "hospital":
      case "big-box store":
      case "tsunami refuge":
      case "silo":
        return "flat";
      case "house":
        return weighted<Roof>(rng, [["gable", 65], ["hip", 30], ["shed", era >= 1950 ? 15 : 3]]);
      case "apartment":
      case "boarding house":
        return era >= 1950 ? "flat" : "hip";
      case "warehouse":
      case "garage":
        return weighted<Roof>(rng, [["gable", 60], ["flat", 25], ["shed", 15]]);
      case "mill shed":
      case "cannery":
      case "port terminal shed":
        return weighted<Roof>(rng, [["gable", 70], ["shed", 30]]);
      case "motel":
        return weighted<Roof>(rng, [["hip", 45], ["flat", 35], ["gable", 20]]);
      case "church":
      case "gas station":
      case "restaurant":
        return kind === "church" ? "gable" : "flat";
      case "courthouse":
      case "customs house":
      case "depot":
        return "hip";
      default:
        return "gable";
    }
  };

  const heightFor = (kind: BuildingKind, storeys: number, roof: Roof): number => {
    const rise = roof === "gable" ? 2.2 : roof === "hip" ? 1.9 : roof === "shed" ? 1.2 : 0.7;
    let h: number;
    switch (kind) {
      case "storefront":
      case "tavern":
      case "office":
      case "bank":
      case "hotel":
      case "lodge hall":
      case "federal building":
        h = 4.5 + (storeys - 1) * 3.6;
        break;
      case "house":
      case "boarding house":
        h = 2.8 * storeys + 0.3;
        break;
      case "apartment":
        h = 3 * storeys;
        break;
      case "warehouse":
        h = 5.5 * storeys;
        break;
      case "mill shed":
        h = range(rng, 9, 14);
        break;
      case "cannery":
      case "port terminal shed":
        h = range(rng, 8, 10.5);
        break;
      case "silo":
        h = range(rng, 28, 36);
        break;
      case "big-box store":
        h = 8.5;
        break;
      case "motel":
        h = 3.2 * storeys;
        break;
      case "school":
      case "hospital":
        h = 4 * storeys;
        break;
      case "courthouse":
      case "customs house":
        h = 4.5 * storeys + 2;
        break;
      case "church":
        h = range(rng, 8, 10) + 4;
        break;
      case "tsunami refuge":
        h = range(rng, 15, 17);
        break;
      case "depot":
        h = 5.5;
        break;
      default:
        h = 4.5;
        break;
    }
    return Math.round((h + (kind === "church" || kind === "silo" || kind === "tsunami refuge" ? 0 : rise)) * 10) / 10;
  };

  // Lots by block, to find each mill block's largest lot.
  let largestMillLot = -1;
  {
    let best = -1;
    let bestA = -1;
    for (const lot of lots) {
      if (lot.district !== "mill") continue;
      const e = lotExtents(drafts[lot.id]!);
      const a = (e.sb - e.sa) * (e.tb - e.ta);
      if (a > bestA) {
        bestA = a;
        best = lot.id;
      }
    }
    largestMillLot = best;
  }

  const occupancy = (district: string, kind: string, m: BlockMeta): number => {
    // The public port's terminal is mostly yard: about half its lots are open ground for the cargo (`harbour.ts` fills them).
    if (m.site === "terminal" && district !== "civic") return 0.42;
    switch (district) {
      case "core":
        return fire ? 0.92 : 0.95;
      case "dock":
        return 0.86 - decline;
      case "waterfront":
        return 0.88 - decline;
      case "mill":
        return history.mill.fate === "working" ? 0.95 : history.mill.cleanup ? 0.2 : 0.85;
      case "mill housing":
        return 0.76 - decline;
      case "residential": {
        const claim = m.frame === layout.old.frame;
        return (claim ? 0.8 : 0.62) - decline;
      }
      case "highway strip":
        return kind === "big-box store" ? 0.9 : 0.6;
      case "industrial":
        return 0.7;
      default:
        return 0.7;
    }
  };

  // ---- Walk the lots.
  for (const lot of lots) {
    const draft = drafts[lot.id]!;
    const block = blocks[lot.block]!;
    const m = layout.meta[lot.block]!;
    const ext = lotExtents(draft);
    const W = ext.sb - ext.sa;
    const D = ext.tb - ext.ta;
    const role = lot.role;
    const district = block.district;
    const kind: BuildingKind = role ? ROLE_KIND[role]! : lot.id === largestMillLot ? "mill shed" : kindFor(district, m, W);
    const forced = role !== null || lot.id === largestMillLot;
    const occ = occupancy(district, kind, m);
    const u = next(rng);
    const alleyPlat = layout.plats.find((p) => p.id === block.plat)?.alley ?? null;
    const want = wantFor(kind, W, D, alleyPlat !== null);
    let fit = fitRect(draft, want);
    // A landmark's place is held for it: if the building wanted will not fit, a smaller one will.
    if (!fit && forced) fit = fitRect(draft, { width: W * 0.6, depth: D * 0.5, setback: 0 }) ?? fitRect(draft, { width: W * 0.35, depth: D * 0.3, setback: 0 });
    if (!fit) {
      gaps.push({ lot: lot.id, why: "poor corner" });
      continue;
    }
    const st = stockFor(kind, district, m, role);
    const storeys = storeysFor(kind, st.era, st.material);
    const roof = roofFor(kind, st.era);
    const height = heightFor(kind, storeys, roof);
    const bearing = m.bearing;
    const halfAlong = draft.swap ? fit.halfT : fit.halfS;
    const halfAcross = draft.swap ? fit.halfS : fit.halfT;
    // State: the mill follows its fate, the rest the district's decline.
    let state: BuildingState = "open";
    if (district === "mill") {
      if (history.mill.fate === "closed") state = history.mill.cleanup ? "ruin" : chance(rng, 0.5) ? "vacant" : "ruin";
    } else if (role === null) {
      const vac =
        district === "dock" ? 0.22 : district === "waterfront" ? 0.12 + (millClosed ? 0.1 : 0) : HOUSE_KINDS.includes(kind) ? 0.06 + (bust ? 0.05 : 0) : district === "highway strip" ? (kind === "big-box store" ? 0.35 : 0.22) : 0.05;
      const ruin = district === "dock" ? 0.1 : district === "waterfront" ? 0.08 : district === "core" ? 0 : 0.02;
      const x = next(rng);
      state = x < ruin ? "ruin" : x < ruin + vac ? "vacant" : "open";
      if (district === "core") state = "open"; // set exactly below
    } else if (role === "hotel" && bust && chance(rng, 0.4)) state = "vacant";
    else if (role === "church" && chance(rng, 0.12)) state = "vacant";
    else if (role === "depot" && chance(rng, 0.5)) state = "vacant";
    out.push({
      lot: lot.id,
      centre: fit.centre,
      halfAlong,
      halfAcross,
      bearing,
      storeys,
      height,
      roof,
      kind,
      era: st.era,
      material: st.material,
      state,
      front: { x: draft.T.x * draft.frontSign, z: draft.T.z * draft.frontSign },
      keep: forced,
      u,
      occ,
      yard: m.site === "terminal" && district !== "civic",
    });
  }

  // Nothing stands in the sea but what belongs there: drop any building that is not landward of the shoreline.
  const polyOf = (d: Draft): Vec[] => orientedRect(d.centre, d.halfAlong, d.halfAcross, bearingU(d.bearing), bearingV(d.bearing));
  const onLand = out.filter((d) => onMadeGround(site, layout.fill, polyOf(d)) || d.keep);
  for (const d of out) if (!onLand.includes(d)) gaps.push({ lot: d.lot, why: "shore" });

  // The town's fill: the chance of each district is raised, together, until enough of the plan is built (a plan of few blocks is built fuller).
  const MIN_BUILT = MIN_BUILDINGS;
  let boost = 0;
  const wanted = Math.max(MIN_BUILT, Math.floor(FILL * lots.length));
  while (boost < 0.6 && onLand.filter((d) => d.keep || d.u < d.occ + (d.yard ? 0 : boost)).length < wanted) boost += 0.03;
  let kept = onLand.filter((d) => d.keep || d.u < d.occ + (d.yard ? 0 : boost));
  // A lot the town did not build is a house taken down (or a plot never built) and left to brush; the terminal's open yard is the harbour's, not a gap.
  for (const d of onLand) if (!kept.includes(d) && !d.yard) gaps.push({ lot: d.lot, why: "demolished" });

  // The core's vacancy, exactly: the share of its storefronts the present layer says stand empty.
  const shops = kept.filter((d) => !d.keep && SHOP_KINDS.includes(d.kind) && blocks[lots[d.lot]!.block]!.district === "core");
  const nVacant = Math.round(shops.length * history.present.vacantShare);
  const order = shuffled(rng, shops);
  for (let i = 0; i < order.length; i++) order[i]!.state = i < nVacant ? "vacant" : "open";

  // The town is condensed: past a cap, the houses thin out (they are what a map can lose without losing the story).
  const cap = int(rng, HOUSE_CAP[0], HOUSE_CAP[1]);
  if (kept.length > cap) {
    const houses = shuffled(rng, kept.filter((d) => !d.keep && HOUSE_KINDS.includes(d.kind)));
    let excess = kept.length - cap;
    const dropped: Draft[] = [];
    for (const h of houses) {
      if (excess <= 0) break;
      dropped.push(h);
      excess--;
    }
    kept = kept.filter((d) => !dropped.includes(d));
    for (const d of dropped) gaps.push({ lot: d.lot, why: "demolished" });
  }

  // ---- Piers, and the sheds on piles at their ends, where the layout found water for them: from the quay and from the flats' shore.
  const piers: Draft[] = [];
  for (const spot of layout.pierSpots) {
    const block = blocks[spot.block];
    const m = block ? layout.meta[spot.block]! : null;
    const shoreSite = m?.site ?? null;
    const dockSide = spot.kind === "quay" && m !== null && m.d > 0;
    const cannery = history.founding.purpose === "cannery" && dockSide && chance(rng, 0.6);
    const terminalShed = shoreSite === "terminal" && chance(rng, 0.7);
    const shedLen = (cannery || terminalShed) && spot.length >= 54 ? 24 : 0;
    const pierLen = spot.length - shedLen;
    const bearing = spot.kind === "quay" ? layout.old.bearing : COMPASS;
    const mk = (s0: number, s1: number, w: number, kind: BuildingKind, state: BuildingState, material: Material, h: number): Draft => {
      // The rectangle from s0 to s1 metres along the pier's own line, `w` wide.
      const mid = (s0 + s1) / 2;
      const c: Vec = { x: spot.origin.x + spot.dir.x * mid, z: spot.origin.z + spot.dir.z * mid };
      return {
        lot: -1,
        centre: c,
        halfAlong: w / 2,
        halfAcross: (s1 - s0) / 2,
        bearing,
        storeys: 1,
        height: h,
        roof: kind === "pier" ? "flat" : "gable",
        kind,
        era: kind === "pier" ? dec(1880 + int(rng, 0, 90)) : dec(1900 + int(rng, 0, 80)),
        material,
        state,
        front: null,
        keep: false,
        u: 0,
        occ: 1,
        yard: false,
      };
    };
    const pierState: BuildingState = millClosed && shoreSite === "mill" && chance(rng, 0.5) ? "ruin" : "open";
    piers.push(mk(0, pierLen, spot.width, "pier", pierState, "wood", 2.5));
    if (shedLen > 0) {
      const kind: BuildingKind = cannery ? "cannery" : "port terminal shed";
      piers.push(mk(pierLen, pierLen + shedLen, Math.max(spot.width + 4, 16), kind, "open", cannery ? "wood" : "metal", 9));
    }
  }

  const all = [...kept, ...piers];
  const buildings: Building[] = all.map((d, id) => ({
    id,
    lot: d.lot,
    centre: d.centre,
    halfAlong: d.halfAlong,
    halfAcross: d.halfAcross,
    bearing: d.bearing,
    storeys: d.storeys,
    height: d.height,
    roof: d.roof,
    kind: d.kind,
    era: d.era,
    material: d.material,
    state: d.state,
    front: d.front,
  }));
  return { buildings, gaps: gaps.sort((p, q) => p.lot - q.lot) };
}
