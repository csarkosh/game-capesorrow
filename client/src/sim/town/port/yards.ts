/**
 * How each lot's ground is kept, from the lot's own story: the building on it (its state and era), the district, and a roll
 * of the lot's own (the `yards` stream). Neighbours differ, as they do in life: one lawn mown to the roots, the next shaggy
 * and full of dandelions, a third gone to waist-high grass and blackberry, and a house with its yard bare dirt and gravel
 * where the trucks park.
 *
 * - **A vacant lot** (no building) is being taken back: mostly grass over the knee or brush, a share bare.
 * - **A ruin** is brush; a **vacant building**'s yard is shaggy or tall, some mossy.
 * - **An open building's yard**: mown, shaggy, mossy (under trees, old lots more), bare, a few tall. Outlying lots are
 *   barer and wilder; the churchyard and the school's and hospital's grounds are kept. Lots of a paved district have no yard.
 * - **Drives and walks**: a house lot has a drive about as often as not (gravel, dirt or a concrete strip) and a front walk
 *   six times in ten; a walk is as broken as the yard is neglected.
 *
 * Every share is authored (the research found none): they follow how the small towns of this coast look. Nothing here reads
 * a drawing; the mask (`clearing.ts`) and the ground drawing (`game/town/yardGeometry.ts`) read what this says.
 */
import { weighted, chance, range, next, type Rng } from "../rng.js";
import { lineShapeDist, PROP_OFFSET, type Line } from "../railKeepOut.js";
import type { Block, Building, District, Lot, Yard, YardKind } from "../types.js";

const PAVED: readonly District[] = ["core", "dock", "waterfront", "mill", "industrial", "highway strip"];

/** The yard kinds, by the share of each in a given situation. */
type Table = readonly (readonly [YardKind, number])[];

const VACANT_LOT: Table = [["tall", 0.35], ["brush", 0.3], ["shaggy", 0.2], ["bare", 0.15]];
const RUIN: Table = [["brush", 0.6], ["tall", 0.4]];
const VACANT_BUILDING: Table = [["tall", 0.35], ["shaggy", 0.3], ["brush", 0.15], ["mossy", 0.2]];
const OPEN_HOUSE: Table = [["mown", 0.32], ["shaggy", 0.22], ["mossy", 0.14], ["bare", 0.14], ["tall", 0.12], ["brush", 0.06]];
const OPEN_OLD: Table = [["mown", 0.26], ["shaggy", 0.2], ["mossy", 0.26], ["bare", 0.12], ["tall", 0.1], ["brush", 0.06]];
const OPEN_OUTLYING: Table = [["mown", 0.2], ["shaggy", 0.2], ["bare", 0.3], ["tall", 0.15], ["mossy", 0.08], ["brush", 0.07]];
/** A lot the railroad crosses: the corridor's gravel and weeds, nobody's lawn. */
const RAIL_SIDE: Table = [["bare", 0.45], ["brush", 0.35], ["tall", 0.2]];
const OPEN_CIVIC: Table = [["mown", 0.75], ["shaggy", 0.15], ["mossy", 0.1]];

/** How kept each kind is, 0 to 1 (the middle of a range the lot's own roll moves). */
const KEPT: Readonly<Record<YardKind, number>> = { paved: 1, mown: 0.9, shaggy: 0.5, tall: 0.25, bare: 0.45, mossy: 0.6, brush: 0.05 };

export type YardInput = {
  readonly blocks: readonly Block[];
  readonly lots: readonly Lot[];
  readonly buildings: readonly Building[];
  /** The railroad's lines (the main line's and the spur's centres). */
  readonly tracks: readonly Line[];
  readonly rng: Rng;
};

export function planYards(inp: YardInput): Yard[] {
  const { blocks, lots, buildings, tracks, rng } = inp;
  const onLot: (Building | undefined)[] = lots.map(() => undefined);
  for (const b of buildings) if (b.lot >= 0 && b.kind !== "pier") onLot[b.lot] = b;
  const out: Yard[] = [];
  for (const lot of lots) {
    const district = (blocks[lot.block] as Block).district;
    const b = onLot[lot.id];
    if (PAVED.includes(district)) {
      out.push({ lot: lot.id, kind: "paved", kept: 1, drive: null, walk: null });
      continue;
    }
    let table: Table;
    const railSide = tracks.some((t) => t.length > 1 && lineShapeDist(t, lot.polygon) < PROP_OFFSET);
    if (railSide) table = RAIL_SIDE;
    else if (b === undefined) table = VACANT_LOT;
    else if (b.state === "ruin") table = RUIN;
    else if (b.state === "vacant") table = VACANT_BUILDING;
    else if (district === "civic") table = OPEN_CIVIC;
    else if (district === "outskirts") table = OPEN_OUTLYING;
    else if (b.era <= 1930) table = OPEN_OLD;
    else table = OPEN_HOUSE;
    const kind = weighted(rng, table);
    const kept = Math.min(1, Math.max(0, KEPT[kind] + range(rng, -0.12, 0.12)));
    const house = b !== undefined && (b.kind === "house" || b.kind === "boarding house" || b.kind === "apartment") && b.state !== "ruin";
    let drive: Yard["drive"] = null;
    if (house && !railSide && chance(rng, kind === "bare" ? 0.9 : 0.5)) {
      const k = next(rng);
      drive = {
        kind: kind === "bare" ? (k < 0.6 ? "dirt" : "gravel") : k < 0.5 ? "gravel" : k < 0.7 ? "dirt" : "concrete",
        at: range(rng, 0.2, 0.8),
        width: range(rng, 2.8, 3.4),
      };
    } else {
      next(rng);
      next(rng);
      next(rng);
    }
    const walk = b !== undefined && b.state !== "ruin" && chance(rng, 0.6) ? { wear: Math.min(1, Math.max(0, (1 - kept) * 0.85 + range(rng, 0, 0.2))) } : null;
    out.push({ lot: lot.id, kind, kept, drive, walk });
  }
  return out;
}
