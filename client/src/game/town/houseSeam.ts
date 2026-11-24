/**
 * Where a house meets the ground: what the house builder tells the passes that dress the seam (`seamGround.ts`, `seamThings.ts`, the growth at the
 * walls in `growth.ts`). The builder (`buildingParts.ts`) notes each house as it draws it: its walls, the foundation's top, the door and the steps or
 * porch at it. The passes that follow read that and the household's own record (the yard's upkeep, the house's era and state), so the seam is
 * dressed by cause: a kept house keeps a clean edge on the street side only; a neglected one has the weeds up to every wall.
 */
import type { Building, TownPlan, Yard } from "../../sim/town/types.js";
import type { WallRef } from "./buildingKit.js";

export type HouseSeam = {
  readonly b: Building;
  readonly refs: readonly WallRef[];
  readonly blocked: readonly boolean[];
  readonly frontAt: number;
  readonly roofKind: string;
  /** What the house builder has already stood on the ground against a wall (a heat pump, a propane tank): the stations along wall `k`, which the things at the seam keep clear of. */
  /** The owner's addition, if it has one: the wall it is built against, its extent along it and how far it reaches out. */
  added: { readonly k: number; readonly s0: number; readonly s1: number; readonly depth: number } | null;
  /** How far out of its wall's face the foundation stands, by wall. */
  readonly foundOff: readonly number[];
  readonly occupied: { readonly k: number; readonly s0: number; readonly s1: number }[];
  readonly baseY: number;
  /** The top of the foundation band, over the lowest ground (it is the same all the way round). */
  readonly foundTop: number;
  /** The front door: its station on the front wall, the half width of what stands at it (the steps or the porch), how far that reaches out from the wall. */
  readonly door: { readonly s: number; readonly half: number; readonly out: number; readonly porch: { readonly s0: number; readonly s1: number } | null } | null;
};

let seen: HouseSeam[] = [];

export function resetSeam(): void {
  seen = [];
}

export function noteHouse(h: HouseSeam): void {
  seen.push(h);
}

export function seamHouses(): readonly HouseSeam[] {
  return seen;
}

const clamp01 = (x: number): number => Math.max(0, Math.min(1, x));

/** How let go the ground round a house is, 0 (kept to the wall) to 1 (nobody has been here in years), from the yard's own upkeep and the house's state. */
export function neglectOf(plan: TownPlan, b: Building): number {
  const y: Yard | undefined = plan.yards[b.lot];
  const kept = y === undefined ? 0.5 : y.kept;
  return clamp01(1 - kept + (b.state === "vacant" ? 0.3 : 0) + (b.state === "ruin" ? 1 : 0));
}
