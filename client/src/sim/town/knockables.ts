/**
 * What a car knocks down: the things in the town that give way when a car is driven into them, where a building, a parked vehicle, a
 * dumpster or a utility pole stops it. The signs at the junctions (`junctionSigns.ts`, but the one that stands on a planter), and of
 * what the props stage put down (`port/props/`): a sidewalk's trash cans that stand, its newspaper boxes, its sign posts and its
 * benches, the wheeled carts that stand, the drums, the stacks of pallets, and the mailboxes, on a post or in a cluster. A hydrant, a
 * planter and everything larger are as they were.
 *
 * Each is, in the world, a point with a radius, or for the long ones (a bench, a stack of pallets, a cluster of mailboxes) an oriented
 * box, in a fixed order (the junctions' signs, then the furniture, the bins and the mailboxes, each in the plan's order): its place in
 * the list is its id, the same on every machine. `knock.ts` is what a car does to them.
 *
 * A cart, a drum, a stack of pallets, a bench and a mailbox are also boxes of the props' solids, which a walker is still held out of;
 * the car's own grid of solids (`carPropSolids`, `propSolid.ts`) leaves them out, so the car meets them here instead.
 *
 * Simulation code: `+ - * /`, `floor`, `min`, `max`, `sqrt` only; the cache is only a lookup.
 */
import { POST_BEHIND, junctionSigns, signedJunctions } from "./junctionSigns.js";
import { planFor } from "./planFor.js";
import { siteFor } from "./siteFor.js";
import type { Bin, Box, Furniture, Mailbox, TownPlan } from "./types.js";

export type KnockKind = "stop" | "dead end" | "blades" | "pavement ends" | "trash can" | "newspaper box" | "sign post" | "bench" | "cart" | "drum" | "pallets" | "mailbox" | "mailbox cluster";

/** What a hit takes from the car, by kind: a share of its speed, and a further speed (m/s). A post set in the ground takes more than a can that stands on it. */
export const KNOCK_LOSS: { readonly [K in KnockKind]: readonly [share: number, flat: number] } = {
  "bench": [0.18, 0.9],
  "mailbox cluster": [0.15, 0.8],
  "pallets": [0.14, 0.7],
  "stop": [0.12, 0.6],
  "dead end": [0.12, 0.6],
  "blades": [0.12, 0.6],
  "pavement ends": [0.12, 0.6],
  "sign post": [0.1, 0.5],
  "newspaper box": [0.1, 0.5],
  "drum": [0.1, 0.5],
  "mailbox": [0.08, 0.4],
  "trash can": [0.06, 0.3],
  "cart": [0.05, 0.25],
};

/** How far from its centre each round kind is met, metres. */
export const KNOCK_RADIUS: { readonly [K in Exclude<KnockKind, keyof typeof KNOCK_BOX>]: number } = {
  "stop": 0.12, "dead end": 0.12, "blades": 0.12, "pavement ends": 0.12, "sign post": 0.1,
  "newspaper box": 0.28, "drum": 0.3, "mailbox": 0.15, "trash can": 0.28, "cart": 0.34,
};

/** The long kinds, met as boxes: each one's length along its own heading and its width across, metres, where the props' solids hold no box of it to read them from. */
export const KNOCK_BOX = { "bench": [1.7, 0.6], "pallets": [1.2, 1.0], "mailbox cluster": [0.5, 0.9] } as const;

/** Whether a kind is met as a box. */
export function isBoxKind(kind: KnockKind): kind is keyof typeof KNOCK_BOX {
  return kind === "bench" || kind === "pallets" || kind === "mailbox cluster";
}

export type Knockable = {
  /** Its place in the town's list. */
  readonly id: number;
  readonly kind: KnockKind;
  /** Its centre in the world, and the radius it is met at (a box's is its half diagonal: what its grid cells are found by). */
  readonly x: number;
  readonly z: number;
  readonly r: number;
  /** Whether it is met as a box, and the box: a unit vector along it and its half extents along and across (a round one's are its radius, along +x). */
  readonly box: boolean;
  readonly ux: number;
  readonly uz: number;
  readonly hu: number;
  readonly hv: number;
  /** Its centre in the plan's frame, as the props stage put it down (a sign's is the world's less the anchor). */
  readonly px: number;
  readonly pz: number;
};

/** A long knockable's box: a unit vector along it and its half extents along and across. */
export type KnockBox = { readonly ux: number; readonly uz: number; readonly hu: number; readonly hv: number };

/** A knockable of `kind` at (x, z) in the world: a long kind by `box` (or its kind's own size along +x), a round one by its kind's radius. Its plan place is the world's until the caller says otherwise. */
export function knockableAt(id: number, kind: KnockKind, x: number, z: number, box?: KnockBox): Knockable {
  if (!isBoxKind(kind)) {
    const r = KNOCK_RADIUS[kind];
    return { id, kind, x, z, r, box: false, ux: 1, uz: 0, hu: r, hv: r, px: x, pz: z };
  }
  const b = box ?? { ux: 1, uz: 0, hu: KNOCK_BOX[kind][0] / 2, hv: KNOCK_BOX[kind][1] / 2 };
  return { id, kind, x, z, r: Math.sqrt(b.hu * b.hu + b.hv * b.hv), box: true, ux: b.ux, uz: b.uz, hu: b.hu, hv: b.hv, px: x, pz: z };
}

/** The town's knockables and a grid of 16 m cells over them: a cell lists the ids whose circle (grown by `REACH`) touches it. */
export type Knockables = {
  readonly list: readonly Knockable[];
  readonly x0: number;
  readonly z0: number;
  readonly cols: number;
  readonly rows: number;
  readonly start: Int32Array;
  readonly ids: Int32Array;
};

export const KNOCK_CELL = 16;
/** How far past its own radius a knockable is listed in the cells: the most a car's centre can be from one it touches is under this. */
export const KNOCK_REACH = 4;

const MADE = new Map<number, Knockables>();

/** What a piece of sidewalk furniture is knocked down as, or null: a can that stands (one that lies on its side already, state 2, is not knocked down again), a newspaper box, a sign post, a bench. */
export function furnitureKnock(f: Furniture): KnockKind | null {
  if (f.kind === "trash can") return f.state !== 2 ? "trash can" : null;
  return f.kind === "newspaper box" || f.kind === "sign post" || f.kind === "bench" ? f.kind : null;
}

/** What a bin is knocked down as, or null: a cart that stands, a drum, a stack of pallets. */
export function binKnock(b: Bin): KnockKind | null {
  return b.kind === "cart" || b.kind === "drum" || b.kind === "pallets" ? b.kind : null;
}

/** What a mailbox is knocked down as: one on a post, or a cluster. */
export function mailboxKnock(m: Mailbox): KnockKind | null {
  return m.kind === "post" ? "mailbox" : "mailbox cluster";
}

/** The knockables of a plan whose frame stands at `anchor` in the world, in their fixed order. */
export function knockablesOf(plan: TownPlan, anchor: { x: number; z: number }): Knockable[] {
  const out: Knockable[] = [];
  /** A prop at (px, pz) of the plan's frame facing (hx, hz): a round one by its radius, a long one by the box the props' solids hold of it (or its kind's own size along its heading, where they hold none). */
  const add = (kind: KnockKind, px: number, pz: number, hx: number, hz: number): void => {
    let box: KnockBox | undefined;
    if (isBoxKind(kind)) {
      box = { ux: hx, uz: hz, hu: KNOCK_BOX[kind][0] / 2, hv: KNOCK_BOX[kind][1] / 2 };
      for (const b of plan.props.solids) {
        if (b.cx !== px || b.cz !== pz) continue;
        box = { ux: b.ux, uz: b.uz, hu: b.hu, hv: b.hv };
        break;
      }
    }
    out.push({ ...knockableAt(out.length, kind, anchor.x + px, anchor.z + pz, box), px, pz });
  };
  for (const s of junctionSigns(signedJunctions(plan, anchor.x, anchor.z), anchor.x, anchor.z)) {
    if (s.kind === "planter") continue;
    // What is met is the post, which stands a little behind the sign's face.
    const x = s.x - s.nx * POST_BEHIND;
    const z = s.z - s.nz * POST_BEHIND;
    out.push({ ...knockableAt(out.length, s.kind, x, z), px: x - anchor.x, pz: z - anchor.z });
  }
  for (const f of plan.props.furniture) {
    const kind = furnitureKnock(f);
    if (kind !== null) add(kind, f.x, f.z, f.hx, f.hz);
  }
  for (const b of plan.props.bins) {
    const kind = binKnock(b);
    if (kind !== null) add(kind, b.x, b.z, b.hx, b.hz);
  }
  for (const m of plan.props.mailboxes) {
    const kind = mailboxKnock(m);
    if (kind !== null) add(kind, m.x, m.z, m.hx, m.hz);
  }
  return out;
}

/** Whether a box of the props' solids is a knockable's own: the props stage puts the box of a cart, a drum, a stack of pallets, a bench and a mailbox down at the prop's own place. */
export function isKnockableBox(b: Box, list: readonly Knockable[]): boolean {
  for (let i = 0; i < list.length; i++) {
    const k = list[i] as Knockable;
    if (b.cx === k.px && b.cz === k.pz && (k.box || k.kind === "cart" || k.kind === "drum" || k.kind === "mailbox")) return true;
  }
  return false;
}

/** The grid over a list of knockables. */
export function knockGrid(list: readonly Knockable[]): Knockables {
  if (list.length === 0) return { list, x0: 0, z0: 0, cols: 0, rows: 0, start: new Int32Array(1), ids: new Int32Array(0) };
  let lowX = Infinity, lowZ = Infinity, highX = -Infinity, highZ = -Infinity;
  for (const k of list) {
    lowX = Math.min(lowX, k.x - k.r - KNOCK_REACH);
    lowZ = Math.min(lowZ, k.z - k.r - KNOCK_REACH);
    highX = Math.max(highX, k.x + k.r + KNOCK_REACH);
    highZ = Math.max(highZ, k.z + k.r + KNOCK_REACH);
  }
  const x0 = Math.floor(lowX / KNOCK_CELL) * KNOCK_CELL;
  const z0 = Math.floor(lowZ / KNOCK_CELL) * KNOCK_CELL;
  const cols = Math.floor((highX - x0) / KNOCK_CELL) + 1;
  const rows = Math.floor((highZ - z0) / KNOCK_CELL) + 1;
  const count = new Int32Array(cols * rows + 1);
  const span = (k: Knockable): [number, number, number, number] => [
    Math.floor((k.x - k.r - KNOCK_REACH - x0) / KNOCK_CELL), Math.floor((k.x + k.r + KNOCK_REACH - x0) / KNOCK_CELL),
    Math.floor((k.z - k.r - KNOCK_REACH - z0) / KNOCK_CELL), Math.floor((k.z + k.r + KNOCK_REACH - z0) / KNOCK_CELL),
  ];
  for (const k of list) {
    const [c0, c1, r0, r1] = span(k);
    for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) count[r * cols + c + 1] = (count[r * cols + c + 1] as number) + 1;
  }
  for (let i = 1; i < count.length; i++) count[i] = (count[i] as number) + (count[i - 1] as number);
  const start = count.slice();
  const fill = count.slice(0, cols * rows);
  const ids = new Int32Array(start[cols * rows] as number);
  for (const k of list) {
    const [c0, c1, r0, r1] = span(k);
    for (let r = r0; r <= r1; r++) {
      for (let c = c0; c <= c1; c++) {
        const cell = r * cols + c;
        ids[fill[cell] as number] = k.id;
        fill[cell] = (fill[cell] as number) + 1;
      }
    }
  }
  return { list, x0, z0, cols, rows, start, ids };
}

/** The knockables of a world seed's town, made once. */
export function knockablesFor(worldSeed: number): Knockables {
  let made = MADE.get(worldSeed);
  if (made === undefined) {
    made = knockGrid(knockablesOf(planFor(worldSeed), siteFor(worldSeed).anchor));
    MADE.set(worldSeed, made);
  }
  return made;
}
