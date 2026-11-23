/**
 * What a working Pacific Northwest harbour has, as plan data in the town's frame, decided by the history and drawn from the
 * harbour's own stream: the boat basin (main floats parallel to the quay, each reached by a gangway from the quay's apron, with
 * finger floats and slips), the boats (moored in the slips and alongside piers, a few at anchor, a tug), the pilings (the fields
 * of dead piles where a cannery's or a mill's wharf was pulled down, and dolphins off the pier ends), the mill's water (a log
 * pond held by a boom, a jack ladder, a closed mill's rusting wigwam burner), the port's terminal (its yard by what it handles,
 * a loaded barge and tug at its wharf), and the lights.
 *
 * Depth is not read from the ground (the plan never reads it): it is the distance seaward of the site's shore times the
 * coast's beach grade (`BEACH_GRADE`), no deeper than `MAX_DEPTH`; `test/townWorld/harbour.test.ts` checks it against the
 * coast's real sea floor.
 *
 * What the history decides: a town founded on a cannery or that handles seafood has a full basin of working boats; a mill town
 * has fewer and more pleasure boats; the vacant share of the town's storefronts is also the share of empty slips and of
 * derelict boats; a closed mill and a cannery leave fields of pilings; a working mill has a log pond with logs in it, a closed
 * one an empty boom (and its burner, if the era suits); the terminal's yard follows `history.port.handles`, and one that stands
 * idle (more likely where the town is emptier) has an empty yard and no barge.
 *
 * Simulation code: `+ - * /`, `floor`, `abs`, `min`, `max`, `sqrt` only; every draw is from the `harbour` stream.
 */
import { bearingU, bearingV } from "../bearings.js";
import { centroid, contains, orient, orientedRect, overlapDepth, segDist, type Poly } from "../geom.js";
import { DECK_TOP, FLOAT_TOP, QUAY_APRON } from "../levels.js";
import { chance, int, next, pick, range, weighted, type Rng } from "../rng.js";
import { analyseShore, shoreAt } from "../shore.js";
import type { TownSite } from "../site.js";
import type {
  Barge,
  Boat,
  BoatKind,
  BoatState,
  Building,
  Burner,
  CargoKind,
  Deck,
  FloatingLog,
  Harbour,
  History,
  HistoryEvent,
  Light,
  LogPond,
  Piling,
  PilingField,
  Slip,
  Street,
  Terminal,
  Vec,
  YardItem,
} from "../types.js";
import type { Layout } from "./layout.js";

/**
 * The depth estimate, from the site's shore alone. The coast's floor is level with the water's edge for the first ~9 m (the
 * bank of the made ground and the beach), then falls at the coast's grade, `BEACH_GRADE`, to `COVE_DEPTH` at `COVE_REACH` m out, and
 * on at `OFFSHORE_GRADE`. The cove's floor, between its two headlands, is deeper than the open coast's, which shelves at `OPEN_GRADE`.
 * Estimated low on purpose; the harbour test checks it against the coast's real floor.
 */
export const SHORE_FLAT = 9;
export const BEACH_GRADE = 0.065;
export const COVE_DEPTH = 2.3;
export const COVE_REACH = 44;
export const OFFSHORE_GRADE = 0.014;
/** Outside the headlands the floor falls this much per metre from the shore's flat, and a headland's tongue is land this far either side of its tip and this far back. */
export const OPEN_GRADE = 0.011;
export const COVE_MARGIN = 45;
export const TONGUE_HALF = 34;
export const TONGUE_REACH = 40;
export const MAX_DEPTH = 5;
/** The sea floor must be this much deeper than a boat's draft, and this deep under a float, metres. */
export const KEEL_CLEARANCE = 0.4;
export const FLOAT_DEPTH = 0.8;
/** Where the main float's centre stands seaward of the quay's line, metres, and its width. */
export const FLOAT_OFFSET = 22;
export const FLOAT_WIDTH = 3;
export const FINGER_WIDTH = 1.2;
export const GANGWAY_WIDTH = 1.6;
/** The slip classes: the pitch between fingers, the finger's length and the longest boat it takes. */
const SLIP_CLASSES = {
  small: { pitch: 4.8, finger: 8, boat: 7.5 },
  medium: { pitch: 6.2, finger: 12, boat: 11.5 },
  large: { pitch: 7.6, finger: 16, boat: 15.5 },
} as const;
type SlipClass = keyof typeof SLIP_CLASSES;

/** Authored placeholder names for boats, ordinary English, not sourced. */
export const BOAT_NAMES: readonly string[] = [
  "Sea Otter", "Kittiwake", "Bonnie B", "Westerly", "Pacific Star", "Lucky Strike", "Dawn Patrol", "Tern", "Margaret Rose",
  "Northern Light", "Cape Hope", "Halibut Hannah", "Silver Spray", "Ocean Pearl", "Sea Wolf", "Rosalie", "Mary Jean", "Gull",
  "Little Dipper", "Kay-Lynn", "Wanderer", "Evening Star", "Nellie G", "Salty Dog", "Island Girl", "Tide Runner", "Sandpiper",
  "Harbor Lass", "Fair Wind", "Three Sisters", "Miss Vicki", "Old Glory", "Cormorant", "Windfall", "Jenny Lind", "Trade Wind",
  "Heron", "Blue Heron", "Anna Marie", "Second Wind",
];

/** The headlands' tips and the light on each: found from the site's shore, where it runs far seaward of its neighbours. */
function headlandTips(site: TownSite, coveZ: number): { south: Vec | null; north: Vec | null } {
  const n = site.shoreX.length;
  const spike = (i: number): boolean => {
    const a = site.shoreX[Math.max(0, i - 3)]!;
    const b = site.shoreX[Math.min(n - 1, i + 3)]!;
    return site.shoreX[i]! < Math.min(a, b) - 50;
  };
  let south: Vec | null = null;
  let north: Vec | null = null;
  let bestS = Infinity;
  let bestN = Infinity;
  for (let i = 0; i < n; i++) {
    if (!spike(i)) continue;
    const z = site.z0 + i * site.step;
    const d = Math.abs(z - coveZ);
    if (z <= coveZ && d < bestS) {
      bestS = d;
      south = { x: site.shoreX[i]!, z };
    }
    if (z > coveZ && d < bestN) {
      bestN = d;
      north = { x: site.shoreX[i]!, z };
    }
  }
  return { south, north };
}

type Pose = { x: number; z: number; heading: Vec };

/** What `planHarbour` is handed. */
export type HarbourInput = {
  readonly site: TownSite;
  readonly layout: Layout;
  readonly history: History;
  readonly buildings: readonly Building[];
  readonly streets: readonly Street[];
  /** The decks of the old harbour (the apron, piers, sheds' platforms, the wharf), whose ids come first. */
  readonly decks: readonly Deck[];
};

type Spec = { kind: BoatKind; length: number; beam: number; draft: number };

const BEAM_OF: Record<BoatKind, number> = { troller: 0.28, gillnetter: 0.3, crabber: 0.33, tug: 0.36, skiff: 0.38, sailboat: 0.3, pleasure: 0.34 };
const DRAFT_OF: Record<BoatKind, number> = { troller: 0.12, gillnetter: 0.1, crabber: 0.11, tug: 0.16, skiff: 0.1, sailboat: 0.17, pleasure: 0.09 };
const LENGTH_OF: Record<BoatKind, [number, number]> = {
  troller: [9, 15.5],
  gillnetter: [8, 11],
  crabber: [14, 20],
  tug: [12, 15],
  skiff: [4.5, 6.5],
  sailboat: [7.5, 15],
  pleasure: [6.5, 15],
};

export type HarbourOut = { harbour: Harbour; decks: Deck[] };

export function planHarbour(input: HarbourInput, rng: Rng): HarbourOut {
  const { site, layout, history, buildings } = input;
  const quay = layout.quay;
  const S = quay.seaward;
  const T0 = { x: quay.b.x - quay.a.x, z: quay.b.z - quay.a.z };
  const tl = Math.sqrt(T0.x * T0.x + T0.z * T0.z);
  const T = { x: T0.x / tl, z: T0.z / tl };
  const oldU = bearingU(layout.old.bearing);
  const fishing = history.founding.purpose === "cannery" || history.port.handles === "seafood";
  const vacant = history.present.vacantShare;
  const millClosed = history.mill.fate === "closed";

  // ---- Depth, and what may be where.
  const facts = analyseShore(site);
  const tips = headlandTips(site, facts.coveZ);
  // The cove's deep water lies between the two headlands; outside them the coast shelves gently (`OPEN_GRADE`).
  const spanLo = (tips.south?.z ?? facts.coveZ - 110) + COVE_MARGIN;
  const spanHi = (tips.north?.z ?? facts.coveZ + 110) - COVE_MARGIN;
  const depthAt = (p: Vec): number => {
    for (const t of [tips.south, tips.north]) if (t !== null && Math.abs(p.z - t.z) < TONGUE_HALF && p.x > t.x - TONGUE_REACH) return 0;
    const d = shoreAt(site, p.z) - p.x - SHORE_FLAT;
    if (!(d > 0)) return 0;
    if (p.z < spanLo || p.z > spanHi) return Math.min(MAX_DEPTH, d * OPEN_GRADE);
    return Math.min(MAX_DEPTH, d * BEACH_GRADE <= COVE_DEPTH ? d * BEACH_GRADE : COVE_DEPTH + (d - COVE_DEPTH / BEACH_GRADE) * OFFSHORE_GRADE);
  };
  const inWater = (poly: Poly, need: number): boolean => {
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i]!;
      const b = poly[(i + 1) % poly.length]!;
      if (depthAt(a) < need || depthAt({ x: (a.x + b.x) / 2, z: (a.z + b.z) / 2 }) < need) return false;
    }
    return depthAt(centroid(poly)) >= need;
  };
  const rectOf = (c: Vec, ax: Vec, hA: number, hB: number): Poly => orient(orientedRect(c, hA, hB, ax, { x: ax.z, z: -ax.x }));
  const taken: Poly[] = input.decks.map((d) => rectOf(d.centre, d.axis, d.halfAlong, d.halfAcross));
  const clear = (poly: Poly, gap: number): boolean => taken.every((q) => overlapDepth(poly, q) <= -gap);
  const boatPoly = (c: Vec, h: Vec, length: number, beam: number): Poly => rectOf(c, h, length / 2, beam / 2);

  const decks: Deck[] = [];
  let nextId = input.decks.length;
  const addDeck = (kind: "float" | "gangway", centre: Vec, axis: Vec, hA: number, hB: number, top: number, topEnd: number): number => {
    const id = nextId++;
    decks.push({ id, kind, centre, axis, halfAlong: hA, halfAcross: hB, top, topEnd, building: null });
    return id;
  };
  const at = (w: { a: Vec }, s: number, off: number): Vec => ({ x: w.a.x + T.x * s + S.x * off, z: w.a.z + T.z * s + S.z * off });

  // ---- Which piers are the quay's, which the mill's and which the terminal's, in the order the buildings were made.
  type PierInfo = { deck: Deck; kind: "quay" | "shore"; wharf: boolean; site: "mill" | "terminal" | null; dir: Vec; halfLong: number; halfWide: number; start: Vec };
  const piers: PierInfo[] = [];
  {
    let spotIx = 0;
    for (const b of buildings) {
      if (b.lot !== -1 || b.kind !== "pier") continue;
      const spot = layout.pierSpots[spotIx++];
      const deck = input.decks.find((d) => d.building === b.id);
      if (spot === undefined || deck === undefined) continue;
      const alongLong = b.halfAlong >= b.halfAcross;
      const long = alongLong ? { x: deck.axis.x, z: deck.axis.z } : { x: deck.axis.z, z: -deck.axis.x };
      const dir = long.x <= 0 ? long : { x: -long.x, z: -long.z };
      const halfLong = alongLong ? b.halfAlong : b.halfAcross;
      const halfWide = alongLong ? b.halfAcross : b.halfAlong;
      const site2 = layout.meta[spot.block]?.site ?? null;
      piers.push({ deck, kind: spot.kind, wharf: false, site: site2, dir, halfLong, halfWide, start: { x: b.centre.x - dir.x * halfLong, z: b.centre.z - dir.z * halfLong } });
    }
  }

  // The wharf street's deck is a pier too, the public port's own wharf in the deep water of the cove.
  for (const d of input.decks) {
    if (d.kind !== "wharf") continue;
    piers.push({ deck: d, kind: "quay", wharf: true, site: null, dir: d.axis, halfLong: d.halfAlong, halfWide: d.halfAcross, start: { x: d.centre.x - d.axis.x * d.halfAlong, z: d.centre.z - d.axis.z * d.halfAlong } });
  }

  // ---- The boat basin: the free stretches of each wet reach, the main floats, gangways, fingers and slips.
  const floats: number[] = [];
  const gangways: number[] = [];
  const slips: Slip[] = [];
  const boats: Boat[] = [];
  const slipBoatSlots: { slip: number; cls: SlipClass; pose: Pose; length: number }[] = [];

  type Interval = { reach: number; s0: number; s1: number };
  const intervals: Interval[] = [];
  for (let ri = 0; ri < quay.wet.length; ri++) {
    const w = quay.wet[ri]!;
    const len = Math.sqrt((w.b.x - w.a.x) * (w.b.x - w.a.x) + (w.b.z - w.a.z) * (w.b.z - w.a.z));
    let free: [number, number][] = [[8, len - 8]];
    for (const d of input.decks) {
      if (d.kind !== "pier" && d.kind !== "wharf") continue;
      let lo = Infinity;
      let hi = -Infinity;
      let near = Infinity;
      for (const su of [-1, 1]) {
        for (const sv of [-1, 1]) {
          const px = d.centre.x + d.axis.x * d.halfAlong * su - d.axis.z * d.halfAcross * sv;
          const pz = d.centre.z + d.axis.z * d.halfAlong * su + d.axis.x * d.halfAcross * sv;
          lo = Math.min(lo, (px - w.a.x) * T.x + (pz - w.a.z) * T.z);
          hi = Math.max(hi, (px - w.a.x) * T.x + (pz - w.a.z) * T.z);
          near = Math.min(near, (px - w.a.x) * S.x + (pz - w.a.z) * S.z);
        }
      }
      if (near > 60) continue;
      lo -= 9;
      hi += 9;
      const out: [number, number][] = [];
      for (const [a, b] of free) {
        if (hi <= a || lo >= b) out.push([a, b]);
        else {
          if (lo > a) out.push([a, lo]);
          if (hi < b) out.push([hi, b]);
        }
      }
      free = out;
    }
    for (const [a, b] of free) if (b - a >= 26) intervals.push({ reach: ri, s0: a, s1: b });
  }
  intervals.sort((p, q) => q.s1 - q.s0 - (p.s1 - p.s0) || p.reach - q.reach || p.s0 - q.s0);
  const nFloats = Math.min(intervals.length, fishing || chance(rng, 0.55) ? 2 : 1);
  const maxLen = Math.floor(range(rng, 40, 120));
  for (let k = 0; k < nFloats; k++) {
    const iv = intervals[k]!;
    const w = quay.wet[iv.reach]!;
    const room = iv.s1 - iv.s0;
    const lf = Math.min(maxLen, room);
    const s0 = iv.s0 + (room - lf) * next(rng);
    const sc = s0 + lf / 2;
    // The fingers first, by class, along the float's seaward side.
    const fl0 = s0;
    const fl1 = s0 + lf;
    const centre = at(w, sc, FLOAT_OFFSET);
    const mainPoly = rectOf(centre, T, lf / 2, FLOAT_WIDTH / 2);
    if (!inWater(mainPoly, FLOAT_DEPTH) || !clear(mainPoly, 0.5)) continue;
    const fingers: { s: number; cls: SlipClass; ok: boolean }[] = [];
    const weights: [SlipClass, number][] = fishing ? [["small", 2], ["medium", 5], ["large", 3]] : [["small", 4], ["medium", 4], ["large", 2]];
    let s = fl0 + 1.4;
    let cls = weighted(rng, weights);
    while (s + SLIP_CLASSES[cls].pitch < fl1 - 0.6) {
      fingers.push({ s, cls, ok: true });
      s += SLIP_CLASSES[cls].pitch;
      cls = weighted(rng, weights);
    }
    fingers.push({ s, cls, ok: true });
    const fingerPolys: Poly[] = [];
    for (const f of fingers) {
      const fl = SLIP_CLASSES[f.cls].finger;
      const edge = FLOAT_OFFSET + FLOAT_WIDTH / 2;
      const c = at(w, f.s, edge - 0.3 + (fl + 0.3) / 2);
      const poly = rectOf(c, S, (fl + 0.3) / 2, FINGER_WIDTH / 2);
      f.ok = inWater(poly, FLOAT_DEPTH) && clear(poly, 0.3);
      fingerPolys.push(poly);
    }
    // The gangway: from the apron's seaward edge down to the float, near the middle of it.
    const sg = sc + range(rng, -lf / 6, lf / 6);
    const gStart = QUAY_APRON - 0.2;
    const gEnd = FLOAT_OFFSET - FLOAT_WIDTH / 2 + 0.5;
    const gc = at(w, sg, (gStart + gEnd) / 2);
    const gPoly = rectOf(gc, S, (gEnd - gStart) / 2, GANGWAY_WIDTH / 2);
    // A finger too near the gangway is dropped: it is clear space for the walk.
    const fid = addDeck("float", centre, T, lf / 2, FLOAT_WIDTH / 2, FLOAT_TOP, FLOAT_TOP);
    floats.push(fid);
    gangways.push(addDeck("gangway", gc, S, (gEnd - gStart) / 2, GANGWAY_WIDTH / 2, DECK_TOP, FLOAT_TOP - 0.02));
    taken.push(mainPoly, gPoly);
    const placed: boolean[] = [];
    for (let i = 0; i < fingers.length; i++) {
      const f = fingers[i]!;
      const fl = SLIP_CLASSES[f.cls].finger;
      const edge = FLOAT_OFFSET + FLOAT_WIDTH / 2;
      const c = at(w, f.s, edge - 0.3 + (fl + 0.3) / 2);
      if (f.ok) {
        floats.push(addDeck("float", c, S, (fl + 0.3) / 2, FINGER_WIDTH / 2, FLOAT_TOP, FLOAT_TOP));
        taken.push(fingerPolys[i]!);
      }
      placed.push(f.ok);
    }
    for (let i = 0; i + 1 < fingers.length; i++) {
      if (!placed[i] || !placed[i + 1]) continue;
      const f = fingers[i]!;
      const edge = FLOAT_OFFSET + FLOAT_WIDTH / 2;
      // The slip's boat lies from the float's edge outward; the next finger may be of another class, so the slip is the shorter of the two fingers' reach.
      const fl = Math.min(SLIP_CLASSES[fingers[i]!.cls].finger, SLIP_CLASSES[fingers[i + 1]!.cls].finger);
      const pitch = fingers[i + 1]!.s - f.s;
      const pos = at(w, f.s + pitch / 2, edge + fl / 2);
      slips.push({ x: pos.x, z: pos.z, heading: S, width: pitch - FINGER_WIDTH, length: fl, boat: null });
      const k2: SlipClass = fl >= 16 ? "large" : fl >= 12 ? "medium" : "small";
      slipBoatSlots.push({ slip: slips.length - 1, cls: k2, pose: { x: pos.x, z: pos.z, heading: S }, length: fl });
    }
  }

  // ---- The boats.
  const fill = Math.max(0.25, (fishing ? 0.95 : history.founding.purpose === "sawmill" ? 0.7 : 0.62) - vacant * 0.7);
  const pDerelict = Math.min(0.5, vacant * 0.35 + (millClosed ? 0.04 : 0) - 0.02);
  const mkSpec = (kind: BoatKind, maxLength: number): Spec => {
    const [lo, hi] = LENGTH_OF[kind];
    const length = Math.round(range(rng, lo, Math.max(lo, Math.min(hi, maxLength))) * 2) / 2;
    return { kind, length, beam: Math.round(length * BEAM_OF[kind] * 10) / 10, draft: Math.round(length * DRAFT_OF[kind] * 10) / 10 };
  };
  const kindFor = (cls: SlipClass): BoatKind => {
    if (cls === "small") return weighted<BoatKind>(rng, [["skiff", 5], ["pleasure", 3], ["gillnetter", fishing ? 2 : 0.5]]);
    if (cls === "medium")
      return fishing
        ? weighted<BoatKind>(rng, [["gillnetter", 4], ["troller", 4], ["sailboat", 1], ["pleasure", 1]])
        : weighted<BoatKind>(rng, [["troller", 2], ["gillnetter", 1.5], ["sailboat", 3], ["pleasure", 3]]);
    return fishing
      ? weighted<BoatKind>(rng, [["troller", 4], ["crabber", 4], ["sailboat", 1], ["pleasure", 1]])
      : weighted<BoatKind>(rng, [["troller", 2], ["crabber", 1.5], ["sailboat", 3], ["pleasure", 2]]);
  };
  const boatState = (): BoatState => (chance(rng, pDerelict) ? "derelict" : "working");
  const addBoat = (spec: Spec, pose: Pose, state: BoatState, mooring: Boat["mooring"]): number => {
    const id = boats.length;
    boats.push({
      id,
      kind: spec.kind,
      x: pose.x,
      z: pose.z,
      heading: pose.heading,
      length: spec.length,
      beam: spec.beam,
      draft: spec.draft,
      state,
      colour: int(rng, 0, 7),
      name: int(rng, 0, BOAT_NAMES.length - 1),
      mooring,
    });
    taken.push(boatPoly(pose, pose.heading, spec.length, spec.beam));
    return id;
  };
  // A place in the water for a boat: a footprint in water deeper than its draft, clear of everything standing.
  const berthOk = (c: Vec, h: Vec, spec: Spec, gap: number): boolean => {
    const poly = boatPoly(c, h, spec.length, spec.beam);
    return inWater(poly, spec.draft + KEEL_CLEARANCE) && clear(poly, gap);
  };

  for (const slot of slipBoatSlots) {
    if (!chance(rng, fill)) continue;
    const spec = mkSpec(kindFor(slot.cls), SLIP_CLASSES[slot.cls].boat);
    const wide = slips[slot.slip]!.width;
    if (spec.beam > wide - 0.9) continue;
    // Stern to the float, bow out, or the other way round.
    const bowOut = chance(rng, 0.75);
    const h = bowOut ? S : { x: -S.x, z: -S.z };
    const back = FLOAT_OFFSET + FLOAT_WIDTH / 2 + 0.35 + spec.length / 2;
    const base = slips[slot.slip]!;
    // The slip's centre is at its middle; move it along the slip's axis to the float's edge.
    const c = { x: base.x - S.x * (base.length / 2) + S.x * (back - (FLOAT_OFFSET + FLOAT_WIDTH / 2)), z: base.z - S.z * (base.length / 2) + S.z * (back - (FLOAT_OFFSET + FLOAT_WIDTH / 2)) };
    if (!berthOk(c, h, spec, 0.05)) continue;
    const id = addBoat(spec, { x: c.x, z: c.z, heading: h }, boatState(), "slip");
    slips[slot.slip] = { ...slips[slot.slip]!, boat: id };
  }

  // Alongside the quay's piers (and the mill's): the basin side, one or two boats a side.
  for (const p of piers) {
    if (p.site === "terminal") continue;
    for (const side of [1, -1]) {
      if (!chance(rng, fill * 0.55)) continue;
      const n = { x: -p.dir.z * side, z: p.dir.x * side };
      let t = -p.halfLong + 3;
      for (let tries = 0; tries < 2; tries++) {
        const kind = weighted<BoatKind>(rng, fishing ? [["crabber", 4], ["troller", 4], ["tug", 1], ["gillnetter", 2]] : [["troller", 3], ["crabber", 2], ["tug", 1], ["pleasure", 2], ["sailboat", 2]]);
        const spec = mkSpec(kind, 20);
        const along = t + spec.length / 2 + 1;
        if (along + spec.length / 2 > p.halfLong + 6) break;
        const centre = { x: p.deck.centre.x + p.dir.x * along + n.x * (p.halfWide + spec.beam / 2 + 0.4), z: p.deck.centre.z + p.dir.z * along + n.z * (p.halfWide + spec.beam / 2 + 0.4) };
        if (berthOk(centre, p.dir, spec, 0.15)) addBoat(spec, { x: centre.x, z: centre.z, heading: p.dir }, boatState(), "pier");
        t = along + spec.length / 2 + 0.8;
      }
    }
  }

  // At anchor in the open basin: a few, seaward of the floats, swung in different directions.
  const headings: Vec[] = [S, { x: -S.x, z: -S.z }, oldU, { x: -oldU.x, z: -oldU.z }, { x: (3 * oldU.x + 4 * S.x) / 5, z: (3 * oldU.z + 4 * S.z) / 5 }, { x: (3 * oldU.x - 4 * S.x) / 5, z: (3 * oldU.z - 4 * S.z) / 5 }];
  const nAnchor = chance(rng, 0.8) ? int(rng, 1, 5) : 0;
  for (let k = 0; k < nAnchor && quay.wet.length > 0; k++) {
    for (let tries = 0; tries < 12; tries++) {
      const w = quay.wet[int(rng, 0, quay.wet.length - 1)]!;
      const len = Math.sqrt((w.b.x - w.a.x) * (w.b.x - w.a.x) + (w.b.z - w.a.z) * (w.b.z - w.a.z));
      const c = at(w, range(rng, 10, len - 10), range(rng, 40, 62));
      const kind = weighted<BoatKind>(rng, [["sailboat", 3], ["troller", 2], ["crabber", 1], ["pleasure", 2]]);
      const spec = mkSpec(kind, 18);
      const h = pick(rng, headings);
      // Room to swing.
      const swing = Math.max(spec.length, 12);
      const ring = boatPoly(c, h, swing * 1.6, swing * 1.6);
      if (berthOk(c, h, spec, 0.2) && clear(ring, 0)) {
        addBoat(spec, { x: c.x, z: c.z, heading: h }, boatState(), "anchor");
        break;
      }
    }
  }
  // One derelict, if there are several, has gone down at its mooring: only its wheelhouse is above water.
  {
    const derelicts = boats.filter((b) => b.state === "derelict" && (b.mooring === "slip" || b.mooring === "pier"));
    if (derelicts.length >= 2 && chance(rng, 0.7)) {
      const b = derelicts[int(rng, 0, derelicts.length - 1)]!;
      boats[b.id] = { ...b, state: "sunk" };
    }
  }

  // ---- The terminal: its pier, its yard, its barge and tug.
  const terminalPiers = piers.filter((p) => p.site === "terminal").sort((a, b) => b.halfLong * b.halfWide - a.halfLong * a.halfWide || a.deck.id - b.deck.id);
  const idle = chance(rng, 0.12 + vacant * 0.6);
  const handles: CargoKind = history.port.handles;
  const yard: YardItem[] = [];
  let barge: Barge | null = null;
  let spout: Vec | null = null;
  const blockPolys: Poly[] = [];
  for (let i = 0; i < layout.blocks.length; i++) if (layout.meta[i]!.site === "terminal") blockPolys.push(orient(layout.blocks[i]!.polygon));
  const solidRects: Poly[] = buildings.filter((b) => b.lot !== -1 ? true : b.kind !== "pier").map((b) => orient(orientedRect(b.centre, b.halfAlong, b.halfAcross, bearingU(b.bearing), bearingV(b.bearing))));
  const streetOk = (poly: Poly, gap: number): boolean =>
    input.streets.every((st) => {
      if (st.kind === "highway") return true;
      return poly.every((p) => segDist(p, st.a, st.b) > st.width / 2 + gap) && poly.every((_, i) => segDist({ x: (poly[i]!.x + poly[(i + 1) % poly.length]!.x) / 2, z: (poly[i]!.z + poly[(i + 1) % poly.length]!.z) / 2 }, st.a, st.b) > st.width / 2 + gap);
    });
  const landOk = (poly: Poly, blocks: readonly Poly[]): boolean =>
    poly.every((p) => blocks.some((b) => contains(b, p, -0.5))) && solidRects.every((r) => overlapDepth(poly, r) <= -0.8) && yardTaken.every((r) => overlapDepth(poly, r) <= -1) && streetOk(poly, 0.5);
  const yardTaken: Poly[] = [];
  const COMPASS_X = { x: 0, z: 1 };
  const place = (blocks: readonly Poly[], hx: number, hz: number, tries: number): Vec | null => {
    if (blocks.length === 0) return null;
    for (let k = 0; k < tries; k++) {
      const b = blocks[int(rng, 0, blocks.length - 1)]!;
      let x0 = Infinity;
      let x1 = -Infinity;
      let z0 = Infinity;
      let z1 = -Infinity;
      for (const p of b) {
        x0 = Math.min(x0, p.x);
        x1 = Math.max(x1, p.x);
        z0 = Math.min(z0, p.z);
        z1 = Math.max(z1, p.z);
      }
      const c = { x: range(rng, x0, x1), z: range(rng, z0, z1) };
      const poly = orient(orientedRect(c, hz, hx, COMPASS_X, { x: 1, z: 0 }));
      if (landOk(poly, blocks)) {
        yardTaken.push(poly);
        return c;
      }
    }
    return null;
  };
  if (!idle) {
    const want: { kind: YardItem["kind"]; hx: number; hz: number; height: number; n: number; count: number }[] = [];
    if (handles === "logs") {
      for (let k = 0; k < int(rng, 3, 5); k++) want.push({ kind: "log stack", hx: 5.5, hz: 6.5, height: 4.2, n: 8, count: 1 });
      if (chance(rng, 0.5)) want.push({ kind: "chip pile", hx: 8, hz: 8, height: 9, n: 0, count: 1 });
    } else if (handles === "grain") {
      for (let k = 0; k < int(rng, 3, 4); k++) want.push({ kind: "silo", hx: 4.5, hz: 4.5, height: 24, n: 0, count: 1 });
      want.push({ kind: "bulk shed", hx: 8, hz: 14, height: 9, n: 0, count: 1 });
    } else if (handles === "seafood") {
      for (let k = 0; k < int(rng, 3, 5); k++) want.push({ kind: "containers", hx: 3.2, hz: 8, height: 5.2, n: 4, count: 1 });
    } else if (handles === "autos") {
      for (let k = 0; k < int(rng, 4, 6); k++) want.push({ kind: "cars", hx: 5, hz: 9, height: 1.5, n: 12, count: 1 });
    } else {
      for (let k = 0; k < int(rng, 4, 6); k++) want.push({ kind: "containers", hx: 3.2, hz: 8, height: 5.2, n: 4, count: 1 });
    }
    for (const w of want) {
      const c = place(blockPolys, w.hx, w.hz, 200);
      if (c !== null) yard.push({ kind: w.kind, x: c.x, z: c.z, halfX: w.hx, halfZ: w.hz, height: w.height, n: w.n });
    }
    // Its barge at the wharf, and the tug beside it.
    // The port's wharf: the wharf street's pier in the cove's deep water first, then the terminal's own and the quay's piers.
    const wharfPiers = piers.filter((q) => q.wharf).concat(terminalPiers, piers.filter((q) => !q.wharf && q.site === null).sort((a, b) => b.halfLong - a.halfLong || a.deck.id - b.deck.id));
    for (const p of wharfPiers) {
      if (barge !== null) break;
      const sheds = input.decks.filter((d) => d.kind === "shed" && Math.abs(d.centre.x - p.deck.centre.x) + Math.abs(d.centre.z - p.deck.centre.z) < p.halfLong + 14);
      const wide = Math.max(p.halfWide, ...sheds.map((d) => Math.max(d.halfAlong, d.halfAcross)));
      const cargo: Barge["cargo"] = handles === "logs" ? (chance(rng, 0.35) ? "chips" : "logs") : handles === "grain" ? "grain" : handles === "autos" ? "vehicles" : "containers";
      const spec = { length: 26, beam: 8 };
      for (const side of [1, -1]) {
        if (barge !== null) break;
        const n = { x: -p.dir.z * side, z: p.dir.x * side };
        for (const along of [p.halfLong - 14, p.halfLong - 24, p.halfLong - 6, 0]) {
          const c = { x: p.deck.centre.x + p.dir.x * along + n.x * (wide + spec.beam / 2 + 0.5), z: p.deck.centre.z + p.dir.z * along + n.z * (wide + spec.beam / 2 + 0.5) };
          const poly = boatPoly(c, p.dir, spec.length, spec.beam);
          if (inWater(poly, 1.6 + KEEL_CLEARANCE) && clear(poly, 0.2)) {
            barge = { x: c.x, z: c.z, heading: p.dir, length: spec.length, beam: spec.beam, cargo };
            taken.push(poly);
            // The tug lies at the barge's stern, in line.
            const tugSpec = mkSpec("tug", 14);
            const tc = { x: c.x - p.dir.x * (spec.length / 2 + tugSpec.length / 2 + 0.8), z: c.z - p.dir.z * (spec.length / 2 + tugSpec.length / 2 + 0.8) };
            if (berthOk(tc, p.dir, tugSpec, 0.1)) addBoat(tugSpec, { x: tc.x, z: tc.z, heading: p.dir }, "working", "terminal");
            if (handles === "grain" || cargo === "chips") spout = { x: p.deck.centre.x + p.dir.x * (p.halfLong - 1) + n.x * (p.halfWide - 0.8), z: p.deck.centre.z + p.dir.z * (p.halfLong - 1) + n.z * (p.halfWide - 0.8) };
            break;
          }
        }
      }
    }
  }
  const terminal: Terminal | null = blockPolys.length > 0 || terminalPiers.length > 0 ? { cargo: handles, idle, yard, barge, spout } : null;
  // A tug for the basin when the terminal has none: at a quay pier or a slip's end.
  if (!boats.some((b) => b.kind === "tug") && chance(rng, 0.6)) {
    const tugSpec = mkSpec("tug", 14);
    for (const p of piers) {
      if (p.kind !== "quay") continue;
      const n = { x: -p.dir.z, z: p.dir.x };
      const c = { x: p.deck.centre.x + p.dir.x * (p.halfLong - tugSpec.length / 2 - 1) + n.x * (p.halfWide + tugSpec.beam / 2 + 0.4), z: p.deck.centre.z + p.dir.z * (p.halfLong - tugSpec.length / 2 - 1) + n.z * (p.halfWide + tugSpec.beam / 2 + 0.4) };
      if (berthOk(c, p.dir, tugSpec, 0.15)) {
        addBoat(tugSpec, { x: c.x, z: c.z, heading: p.dir }, "working", "pier");
        break;
      }
    }
  }

  // ---- The mill's water: a log pond (floating logs, or an empty boom), its jack ladder, and a closed mill's burner.
  const millBlocks: Poly[] = [];
  for (let i = 0; i < layout.blocks.length; i++) if (layout.meta[i]!.site === "mill") millBlocks.push(orient(layout.blocks[i]!.polygon));
  let logPond: LogPond | null = null;
  let burner: Burner | null = null;
  const pilings: PilingField[] = [];
  const pileAt = (x: number, z: number, top: number, kind: Piling["kind"]): Piling => {
    const lean = kind === "dead" ? 0.05 : 0.01;
    return { x, z, top, lean: { x: range(rng, -lean, lean), z: range(rng, -lean, lean) }, radius: Math.round(range(rng, 0.16, 0.24) * 100) / 100, kind };
  };
  if (millBlocks.length > 0) {
    let zlo = Infinity;
    let zhi = -Infinity;
    for (const b of millBlocks) for (const p of b) {
      zlo = Math.min(zlo, p.z);
      zhi = Math.max(zhi, p.z);
    }
    const zm = (zlo + zhi) / 2;
    const HZ = 22;
    const HX = 15;
    const candidates = [0, 38, -38, 76, -76, 114, -114, 152, -152].map((o) => zm + o);
    let pondZ: number | null = null;
    let pondX = 0;
    for (const zc of candidates) {
      let shore = Infinity;
      for (let z = zc - HZ; z <= zc + HZ; z += 4) shore = Math.min(shore, shoreAt(site, z));
      const xLand = shore - SHORE_FLAT - 4;
      const c = { x: xLand - HX, z: zc };
      const poly = rectOf(c, { x: 0, z: 1 }, HZ + 1, HX + 1);
      if (inWater(poly, 0.02) && clear(poly, 2)) {
        pondZ = zc;
        pondX = c.x;
        break;
      }
    }
    if (pondZ !== null) {
      const working = !millClosed;
      const centre = { x: pondX, z: pondZ };
      taken.push(rectOf(centre, { x: 0, z: 1 }, HZ + 1, HX + 1));
      // The boom: piles every 7 m along the seaward side and the two ends, sticks chained between them.
      const piles: Piling[] = [];
      const seaX = centre.x - HX;
      for (let z = pondZ - HZ; z <= pondZ + HZ + 0.01; z += (2 * HZ) / 6) piles.push(pileAt(seaX, z, range(rng, 1.7, 2.1), "boom"));
      for (const sign of [-1, 1]) for (let x = seaX + 7.5; x <= centre.x + HX + 0.01; x += 7.5) piles.push(pileAt(x, pondZ + sign * HZ, range(rng, 1.7, 2.1), "boom"));
      const logs: FloatingLog[] = [];
      if (working) {
        const nl = int(rng, 24, 46);
        for (let k = 0; k < nl; k++) {
          const lenL = range(rng, 8, 13);
          const lx = range(rng, seaX + 3, centre.x + HX - 3);
          const lz = range(rng, pondZ - HZ + lenL / 2 + 1, pondZ + HZ - lenL / 2 - 1);
          const tilt = range(rng, -0.12, 0.12);
          logs.push({ x: lx, z: lz, heading: { x: tilt, z: Math.sqrt(1 - tilt * tilt) }, length: lenL, radius: Math.round(range(rng, 0.3, 0.55) * 100) / 100 });
        }
      }
      // The jack ladder from the pond's landward edge up to a jack house on the mill's side, over whatever stands between.
      let jackLadder: LogPond["jackLadder"] = null;
      if (working) {
        const a = { x: centre.x + HX, z: pondZ };
        for (const dz of [0, 8, -8, 14, -14]) {
          const b = { x: a.x + 30, z: pondZ + dz };
          const strip = orient(orientedRect({ x: (a.x + b.x) / 2, z: pondZ + dz / 2 }, 15.2, 1.6, { x: 1, z: 0 }, { x: 0, z: 1 }));
          const house = orient(orientedRect({ x: b.x + 2.5, z: b.z }, 3.5, 3.5, { x: 1, z: 0 }, { x: 0, z: 1 }));
          if (solidRects.every((r) => overlapDepth(strip, r) <= -1 && overlapDepth(house, r) <= -1) && input.decks.every((d) => overlapDepth(strip, rectOf(d.centre, d.axis, d.halfAlong, d.halfAcross)) <= -1)) {
            jackLadder = { a, b: { x: b.x, z: b.z }, bottom: -0.3, top: 8.5, width: 2.4 };
            break;
          }
        }
      }
      logPond = { centre, halfX: HX, halfZ: HZ, working, piles, logs, jackLadder };
    }
    // A closed mill: its old wharf is a field of dead pilings, and a wigwam burner may stand on its site.
    if (millClosed) {
      const year = history.mill.closedYear! + int(rng, 0, 4);
      const field = pilingField(site, rng, centre0(pondZ ?? zm, pondX), 7, 11, taken, inWater, pileAt, rectOf, clear, "mill", year, zm);
      if (field !== null) pilings.push(field);
      if (history.mill.startYear <= 1965 && chance(rng, history.mill.cleanup ? 0.2 : 0.65)) {
        const c = place(millBlocks, 7.5, 7.5, 200);
        if (c !== null) burner = { x: c.x, z: c.z, radius: 7, height: Math.round(range(rng, 14, 18)) };
      }
    }
  }
  // The cannery's wharf, or an old fish dock, on the quay's dock end.
  const cannery = history.founding.purpose === "cannery";
  if (cannery || chance(rng, 0.35)) {
    const w = quay.wet[layout.old.dockDir > 0 ? quay.wet.length - 1 : 0];
    if (w !== undefined) {
      const len = Math.sqrt((w.b.x - w.a.x) * (w.b.x - w.a.x) + (w.b.z - w.a.z) * (w.b.z - w.a.z));
      const dockS = layout.old.dockDir > 0 ? len - 22 : 22;
      const year = cannery ? int(rng, 1962, 1985) : int(rng, 1950, 1990);
      for (const shift of [0, 18, -18, 36, -36]) {
        const base = at(w, Math.max(10, Math.min(len - 10, dockS - layout.old.dockDir * shift)), 16);
        const field = pilingField(site, rng, base, 4, 10, taken, inWater, pileAt, rectOf, clear, cannery ? "cannery" : "dock", year, base.z, T);
        if (field !== null) {
          pilings.push(field);
          break;
        }
      }
    }
  }
  // Dolphins: three piles lashed together, off the end of each of the longer piers.
  const dolphins: Piling[] = [];
  for (const p of piers) {
    if (p.halfLong < 14 || p.site === "mill") continue;
    const c = { x: p.deck.centre.x + p.dir.x * (p.halfLong + 6), z: p.deck.centre.z + p.dir.z * (p.halfLong + 6) };
    const poly = rectOf(c, p.dir, 1.2, 1.2);
    if (!inWater(poly, 1) || !clear(poly, 1.5)) continue;
    taken.push(poly);
    for (let k = 0; k < 3; k++) {
      const a = k === 0 ? 0 : k === 1 ? 0.866 : -0.866;
      const b = k === 0 ? 1 : -0.5;
      dolphins.push({ x: c.x + 0.45 * (p.dir.x * b + -p.dir.z * a), z: c.z + 0.45 * (p.dir.z * b + p.dir.x * a), top: 4.2 + 0.1 * k, lean: { x: -(0.45 * (p.dir.x * b + -p.dir.z * a)) * 0.06, z: -(0.45 * (p.dir.z * b + p.dir.x * a)) * 0.06 }, radius: 0.22, kind: "dolphin" });
    }
  }

  // ---- The lights.
  const lights: Light[] = [];
  const lightSide = chance(rng, 0.5);
  if (tips.south !== null) lights.push({ kind: lightSide ? "harbour light" : "day beacon", x: tips.south.x + 3, z: tips.south.z, height: lightSide ? 7 : 5.5 });
  if (tips.north !== null) lights.push({ kind: lightSide ? "day beacon" : "harbour light", x: tips.north.x + 3, z: tips.north.z, height: lightSide ? 5.5 : 7 });
  const longest = piers.slice().sort((a, b) => b.halfLong - a.halfLong || a.deck.id - b.deck.id)[0];
  if (longest !== undefined) lights.push({ kind: "pier light", x: longest.deck.centre.x + longest.dir.x * (longest.halfLong - 0.7), z: longest.deck.centre.z + longest.dir.z * (longest.halfLong - 0.7), height: 4.5 });

  // ---- The sentences.
  const events: HistoryEvent[] = [];
  const ev = (year: number, text: string): void => {
    events.push({ year, kind: "harbour", text });
  };
  ev(history.port.year, quay.wall === "timber" ? "The port builds its quay as a timber crib wall with a timber cap, and the harbour's piers run out from it." : `The waterfront is rebuilt after the fire as a wall of steel sheet piling with a concrete cap.`);
  const lightYear = int(rng, 1893, 1915);
  if (lights.some((l) => l.kind === "harbour light")) ev(lightYear, "The Lighthouse Board sets a small white light on one headland and a day beacon on the other, to mark the cove's mouth.");
  for (const f of pilings) {
    if (f.origin === "cannery") ev(f.year, `The cannery's wharf was pulled down in ${f.year}; its pilings still stand.`);
    else if (f.origin === "mill") ev(f.year, `The mill's wharf was pulled down in ${f.year}; its pilings still stand in the water beside the old log pond.`);
    else ev(f.year, `The fish dock burned in ${f.year}; its pilings still stand.`);
  }
  if (logPond !== null) {
    if (logPond.working) ev(2000, `The mill still floats its logs in a pond held by a boom of ${logPond.logs.length} logs' worth of sticks chained between piles, and hauls them up the jack ladder.`);
    else ev(history.mill.closedYear! + 1, "The mill's log pond lies empty, its boom sticks still chained to their piles.");
  }
  if (burner !== null) ev(history.mill.closedYear!, "The mill's wigwam burner, a rusting steel cone, still stands on its site.");
  const working = boats.filter((b) => b.state === "working").length;
  const derelict = boats.filter((b) => b.state !== "working").length;
  const empty = slips.filter((s) => s.boat === null).length;
  ev(2026, `The boat basin holds ${boats.length} boats: ${working} at work, ${derelict} derelict or sunk, with ${empty} of its ${slips.length} slips empty.`);
  if (terminal !== null) {
    ev(
      2026,
      terminal.idle
        ? `The port's terminal, built to handle ${handles}, stands idle: its yard is empty and no barge is at its wharf.`
        : barge !== null
          ? `The port's terminal handles ${handles}, and a loaded barge lies at its wharf with a tug beside it.`
          : `The port's terminal handles ${handles}.`,
    );
  }

  const harbour: Harbour = { boats, slips, floats, gangways, pilings, dolphins, logPond, burner, terminal, lights, events };
  return { harbour, decks };
}

function centre0(z: number, x: number): Vec {
  return { x, z };
}

/**
 * A field of dead pilings, in rows, with gaps where piles have gone, at uneven heights and some leaning: a rectangle `rows` by
 * `cols` piles with jitter, clear of what stands, in water. `at` is its middle (or, for the mill, the water off the mill's shore).
 */
function pilingField(
  site: TownSite,
  rng: Rng,
  middle: Vec,
  rows: number,
  cols: number,
  taken: readonly Poly[],
  inWater: (poly: Poly, need: number) => boolean,
  pileAt: (x: number, z: number, top: number, kind: Piling["kind"]) => Piling,
  rectOf: (c: Vec, ax: Vec, hA: number, hB: number) => Poly,
  clear: (poly: Poly, gap: number) => boolean,
  origin: PilingField["origin"],
  year: number,
  zHint: number,
  axis: Vec = { x: 0, z: 1 },
): PilingField | null {
  const dx = 3.2;
  const dz = 3.6;
  const hAlong = ((cols - 1) * dz) / 2 + 1;
  const hAcross = ((rows - 1) * dx) / 2 + 1;
  // For the mill's wharf, the field stands off the shore at the mill's latitude: shift it clear of what is there.
  let c = middle;
  if (origin === "mill") {
    let found = false;
    for (const off of [0, 40, -40, 72, -72, 100, -100, 130, -130, 160, -160, 200, -200]) {
      const z = zHint + off;
      const x = shoreAt(site, z) - SHORE_FLAT - 6 - hAcross;
      const trial = { x, z };
      if (inWater(rectOf(trial, axis, hAlong, hAcross), 0.02) && clear(rectOf(trial, axis, hAlong, hAcross), 3)) {
        c = trial;
        found = true;
        break;
      }
    }
    if (!found) return null;
  } else if (!inWater(rectOf(c, axis, hAlong, hAcross), 1) || !clear(rectOf(c, axis, hAlong, hAcross), 3)) return null;
  const ax = axis;
  const across = { x: -ax.z, z: ax.x };
  const piles: Piling[] = [];
  for (let r = 0; r < rows; r++) {
    for (let k = 0; k < cols; k++) {
      if (chance(rng, 0.22)) continue;
      const u = (k - (cols - 1) / 2) * dz + range(rng, -0.35, 0.35);
      const v = (r - (rows - 1) / 2) * dx + range(rng, -0.3, 0.3);
      const x = c.x + ax.x * u + across.x * v;
      const z = c.z + ax.z * u + across.z * v;
      // Uneven tops: most stand to a height, some have broken off short, a few are nubs at the water.
      const roll = next(rng);
      const top = roll < 0.12 ? range(rng, 0.2, 0.6) : roll < 0.4 ? range(rng, 0.8, 1.6) : range(rng, 1.8, 3.8);
      piles.push(pileAt(x, z, Math.round(top * 100) / 100, "dead"));
    }
  }
  return { origin, year, piles };
}

/** One line that says what a town's harbour holds: for the map page's list and the tests' report. */
export function harbourSummary(h: Harbour): string {
  const count = (state: BoatState): number => h.boats.filter((b) => b.state === state).length;
  const kinds: BoatKind[] = ["troller", "gillnetter", "crabber", "tug", "skiff", "sailboat", "pleasure"];
  const by = kinds
    .map((k) => `${h.boats.filter((b) => b.kind === k).length}${k.slice(0, 2)}`)
    .join(" ");
  const piles = h.pilings.reduce((n, f) => n + f.piles.length, 0);
  const t = h.terminal;
  return (
    `boats ${h.boats.length} (${count("working")} working, ${count("derelict")} derelict, ${count("sunk")} sunk; ${by}), ` +
    `slips ${h.slips.length} (${h.slips.filter((s) => s.boat === null).length} empty), floats ${h.floats.length}, gangways ${h.gangways.length}, ` +
    `dead piles ${piles}, dolphins ${h.dolphins.length / 3}, ` +
    `pond ${h.logPond === null ? "none" : h.logPond.working ? `working (${h.logPond.logs.length} logs${h.logPond.jackLadder ? ", jack ladder" : ""})` : "empty boom"}, burner ${h.burner ? "yes" : "no"}, ` +
    `terminal ${t === null ? "none" : `${t.cargo} ${t.idle ? "idle" : `${t.yard.length} items${t.barge ? ", barge" : ", no barge"}`}`}, lights ${h.lights.length}`
  );
}
