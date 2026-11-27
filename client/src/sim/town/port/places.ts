/**
 * The places every town has: the municipal building (and with it the player's office), a lodging, a bar and a cafe, each open for business in the downtown.
 *
 * The municipal building is reserved like any landmark (`landmarks.ts`); `ensureMunicipal` is the fallback that cannot fail, for the case that its lot gave no building: a building of the
 * downtown is made the municipal building. The lodging, the bar and the cafe are guaranteed by the buildings (`buildings.ts`: a lodging and a tavern stand open) and the business stage
 * (`business/index.ts`: their bays are open), and `placesOf` only finds them in the finished plan.
 */

import type { Building, BuildingUse, Landmark, Lot, Place, Places, Trade } from "../types.js";

/** The municipal building's pair of doors: a pair 2.3 m wide, centred on its front under the portico (`game/town/openingsGeometry.ts` draws them there). */
export const MUNICIPAL_DOOR_WIDTH = 2.3;

/** If no building stands on a lot reserved for the municipal building, makes one of a building of the downtown (a shop or office, the broadest first): its lot's role, its kind and its stock. */
export function ensureMunicipal(downtown: readonly number[], lots: Lot[], buildings: Building[]): void {
  if (buildings.some((b) => b.lot >= 0 && lots[b.lot]!.role === "municipal")) return;
  const inDown = (b: Building): boolean => b.lot >= 0 && downtown.includes(lots[b.lot]!.block) && lots[b.lot]!.role === null;
  const rank = (b: Building): number => (b.kind === "storefront" || b.kind === "office" ? 2 : b.kind === "house" || b.kind === "apartment" ? 0 : 1);
  const pool = buildings.filter(inDown).sort((p, q) => rank(q) - rank(p) || q.halfAlong * q.halfAcross - p.halfAlong * p.halfAcross || p.id - q.id);
  const b = pool[0] ?? buildings.filter((x) => x.lot >= 0 && lots[x.lot]!.role === null)[0]!;
  lots[b.lot] = { ...lots[b.lot]!, role: "municipal" };
  buildings[b.id] = { ...b, kind: "municipal building", state: "open", era: 1930, material: "brick", storeys: 3, roof: "flat", height: 12.4 };
}

const LODGING: readonly Trade[] = ["hotel", "motel", "rooming house"];

/** Finds the four places in the finished plan: the first open unit of the trade in the downtown (an open hotel first, a tavern building for the bar), the municipal building as the office. */
export function placesOf(downtown: readonly number[], lots: readonly Lot[], buildings: readonly Building[], uses: readonly BuildingUse[], landmarks: readonly Landmark[]): Places {
  const find = (trades: readonly Trade[], prefer: (b: Building) => number): Place => {
    let best: { place: Place; score: number } | null = null;
    for (const use of uses) {
      const b = buildings[use.building]!;
      if (b.lot < 0 || !downtown.includes(lots[b.lot]!.block)) continue;
      for (const u of use.units) {
        if (u.state !== "open" || u.tenant === null || !trades.includes(u.tenant.trade)) continue;
        const score = prefer(b);
        if (best === null || score > best.score) best = { place: { building: b.id, unit: u.id, door: null }, score };
      }
    }
    if (best === null) throw new Error(`the plan has no open ${trades[0]} in its downtown`);
    return best.place;
  };
  const hall = landmarks.find((l) => l.role === "municipal building");
  if (!hall) throw new Error("the plan has no municipal building");
  const hotel = landmarks.filter((l) => l.role === "hotel").map((l) => l.building);
  return {
    office: { building: hall.building, unit: null, door: { s: Math.round(((uses[hall.building]!.frame?.width ?? 0) / 2) * 100) / 100, width: MUNICIPAL_DOOR_WIDTH } },
    lodging: find(LODGING, (b) => (hotel.includes(b.id) ? 2 : b.kind === "hotel" ? 1 : 0)),
    bar: find(["tavern"], (b) => (b.kind === "tavern" ? 1 : 0)),
    cafe: find(["cafe"], () => 0),
  };
}
