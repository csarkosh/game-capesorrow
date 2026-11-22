/**
 * Town kinds and their recipes. A recipe is everything that differs between kinds of town: the
 * history that is drawn, the ground plan, the rule for cutting a district's lots, the buildings, the
 * landmarks. The shared code in `plan.ts` only runs a recipe's steps in order; no shared code asks
 * which kind of town it is making. A new kind (an oyster town, a company mill town, ...) is a new
 * entry in `RECIPES` and a folder beside `port/`.
 */
import type { LotDraft, LotRule, Reservation } from "./lots.js";
import type { TownNames } from "./names.js";
import type { Rng } from "./rng.js";
import type { ShoreFacts } from "./shore.js";
import type { TownSite } from "./site.js";
import type { Block, Building, District, History, Landmark, Lot, Spawn, TownKind } from "./types.js";
import type { BlockMeta, Layout } from "./port/layout.js";
import { makeHistory } from "./port/history.js";
import { layoutPort } from "./port/layout.js";
import { buildPort } from "./port/buildings.js";
import { bindLandmarks, planLandmarks, spawnAt } from "./port/landmarks.js";
import { LOT_RULES } from "./port/rules.js";

export type Streams = {
  readonly history: Rng;
  readonly plats: Rng;
  readonly streets: Rng;
  readonly lots: Rng;
  readonly buildings: Rng;
  readonly landmarks: Rng;
};

export type LandmarkPlanOut = {
  readonly reservations: Reservation[];
  readonly civic: number[];
};

export type Recipe = {
  history(rng: Rng, names: TownNames, shore: ShoreFacts): { history: History; townName: string };
  layout(site: TownSite, history: History, names: TownNames, s: Streams): Layout;
  landmarkPlan(site: TownSite, layout: Layout, history: History, rng: Rng): LandmarkPlanOut;
  lotRule(block: Block, meta: BlockMeta, layout: Layout): LotRule;
  buildings(input: { site: TownSite; history: History; layout: Layout; blocks: readonly Block[]; lots: readonly Lot[]; drafts: readonly LotDraft[] }, rng: Rng): Building[];
  bindLandmarks(history: History, names: TownNames, townName: string, lots: readonly Lot[], buildings: readonly Building[]): Landmark[];
  spawn(fbi: Building): Spawn;
};

const PORT: Recipe = {
  history: makeHistory,
  layout: (site, history, names, s) => layoutPort(site, history, names, s.plats, s.streets),
  landmarkPlan: (site, layout, history, rng) => {
    const p = planLandmarks(site, layout, history, rng);
    return { reservations: p.reservations, civic: p.civic };
  },
  lotRule: (block) => LOT_RULES[block.district],
  buildings: buildPort,
  bindLandmarks,
  spawn: spawnAt,
};

export const RECIPES: Record<TownKind, Recipe> = { port: PORT };

export type { District };
