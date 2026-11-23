/**
 * The decks of the old harbour as plan data: the quay's apron along each wet stretch of the quay, each pier, the deck a shed
 * on piles stands on, and the wharf street's. Every one is an oriented rectangle with the height of its top (`DECK_TOP`).
 * The floats and gangways of the boat basin (`harbour.ts`) are added to the same list by the plan.
 *
 * The apron is the strip of the quay between the quay's line and the wall's face: where the made ground's bank falls away
 * under it, it is a deck, so a person can walk to the wall's edge and no further.
 */
import { bearingU } from "../bearings.js";
import { DECK_TOP, QUAY_APRON } from "../levels.js";
import type { Building, Deck, Quay, Street } from "../types.js";

/** How much wider than the shed a shed's platform is, on every side, metres. */
export const SHED_MARGIN = 1;

export function portDecks(quay: Quay, buildings: readonly Building[], streets: readonly Street[]): Deck[] {
  const decks: Deck[] = [];
  const add = (d: Omit<Deck, "id">): void => {
    decks.push({ id: decks.length, ...d });
  };
  for (const w of quay.wet) {
    const dx = w.b.x - w.a.x;
    const dz = w.b.z - w.a.z;
    const len = Math.sqrt(dx * dx + dz * dz);
    if (!(len > 0.5)) continue;
    const axis = { x: dx / len, z: dz / len };
    const mid = { x: (w.a.x + w.b.x) / 2, z: (w.a.z + w.b.z) / 2 };
    add({
      kind: "apron",
      centre: { x: mid.x + (quay.seaward.x * QUAY_APRON) / 2, z: mid.z + (quay.seaward.z * QUAY_APRON) / 2 },
      axis,
      halfAlong: len / 2,
      halfAcross: QUAY_APRON / 2,
      top: DECK_TOP,
      topEnd: DECK_TOP,
      building: null,
    });
  }
  for (const b of buildings) {
    if (b.lot !== -1) continue;
    const margin = b.kind === "pier" ? 0 : SHED_MARGIN;
    add({
      kind: b.kind === "pier" ? "pier" : "shed",
      centre: b.centre,
      axis: bearingU(b.bearing),
      halfAlong: b.halfAlong + margin,
      halfAcross: b.halfAcross + margin,
      top: DECK_TOP,
      topEnd: DECK_TOP,
      building: b.id,
    });
  }
  for (const s of streets) {
    if (s.kind !== "wharf") continue;
    const dx = s.b.x - s.a.x;
    const dz = s.b.z - s.a.z;
    const len = Math.sqrt(dx * dx + dz * dz);
    if (!(len > 0.5)) continue;
    add({
      kind: "wharf",
      centre: { x: (s.a.x + s.b.x) / 2, z: (s.a.z + s.b.z) / 2 },
      axis: { x: dx / len, z: dz / len },
      halfAlong: len / 2,
      halfAcross: s.width / 2,
      top: DECK_TOP,
      topEnd: DECK_TOP,
      building: null,
    });
  }
  return decks;
}
