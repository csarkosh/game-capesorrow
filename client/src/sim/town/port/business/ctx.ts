/** What every part of the business stage shares: the town's facts, the name registry, and a random stream of a building's own. */
import { hashSeed, type Rng } from "../../rng.js";
import type { TownNames } from "../../names.js";
import type { Block, Building, Harbour, History, Landmark, Lot, Street } from "../../types.js";

/** The year the town is in. */
export const NOW = 2026;

export const r2 = (n: number): number => Math.round(n * 100) / 100;
export const r1 = (n: number): number => Math.round(n * 10) / 10;
export const dec = (y: number): number => Math.floor(y / 10) * 10;

export type BizInput = {
  readonly history: History;
  readonly townName: string;
  readonly names: TownNames;
  readonly buildings: readonly Building[];
  readonly lots: readonly Lot[];
  readonly blocks: readonly Block[];
  readonly streets: readonly Street[];
  readonly landmarks: readonly Landmark[];
  readonly harbour: Harbour;
  /** The downtown's block ids (`port/downtown.ts`): the town's lodging, bar and cafe are always open in them. */
  readonly downtown: readonly number[];
};

export type BizCtx = BizInput & {
  readonly town: string;
  /** The stage's seed, from which each building's stream is derived. */
  readonly base: number;
  /** The town fishes: the history or the harbour says so. Marine trades follow it and nothing else. */
  readonly fishing: boolean;
  /** A town on the tourist road (the history's highway strip): kites, taffy and galleries. */
  readonly tourist: boolean;
  /** The county seat: lawyers, a title company, bail bonds. */
  readonly seat: boolean;
  /** A mill town: a union hall, a saw and chain shop (the history always has a mill; a mill that closed counts, for the hall outlives it). */
  readonly millTown: boolean;
  readonly families: readonly string[];
  readonly streetWords: readonly string[];
  readonly taken: (name: string) => boolean;
  readonly take: (name: string) => void;
};

/** The stream of building `id` for one purpose (`salt`): its own, so that what one building draws never moves another's. */
export function sub(base: number, id: number, salt: number): Rng {
  return { state: hashSeed(base, id * 16 + salt) };
}

export function districtOf(ctx: BizCtx, b: Building): string {
  if (b.lot < 0) return "waterfront";
  const lot = ctx.lots[b.lot];
  const block = lot ? ctx.blocks[lot.block] : undefined;
  return block ? block.district : "outskirts";
}

/** The index into a trade's multipliers: core, dock (and the waterfront), highway strip, anywhere else. */
export function districtIndex(district: string): number {
  return district === "core" ? 0 : district === "dock" || district === "waterfront" ? 1 : district === "highway strip" ? 2 : 3;
}
