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
import type { Block, Building, BuildingUse, Deck, District, Gap, Harbour, History, Landmark, Lot, Spawn, Street, TownKind } from "./types.js";
import type { BlockMeta, Layout } from "./port/layout.js";
import { makeHistory } from "./port/history.js";
import { layoutPort } from "./port/layout.js";
import { buildPort } from "./port/buildings.js";
import { portDecks } from "./port/decks.js";
import { planHarbour, type HarbourOut } from "./port/harbour.js";
import { bindLandmarks, planLandmarks, spawnAt } from "./port/landmarks.js";
import { LOT_RULES } from "./port/rules.js";
import { planUses } from "./port/business/index.js";
import type { BizInput } from "./port/business/ctx.js";

export type Streams = {
  readonly history: Rng;
  readonly plats: Rng;
  readonly streets: Rng;
  readonly lots: Rng;
  readonly buildings: Rng;
  readonly landmarks: Rng;
  readonly harbour: Rng;
};

export type LandmarkPlanOut = {
  readonly reservations: Reservation[];
};

export type Recipe = {
  history(rng: Rng, names: TownNames, shore: ShoreFacts): { history: History; townName: string };
  layout(site: TownSite, history: History, names: TownNames, s: Streams): Layout;
  landmarkPlan(site: TownSite, layout: Layout, history: History, rng: Rng): LandmarkPlanOut;
  lotRule(block: Block, meta: BlockMeta, layout: Layout): LotRule;
  /** The buildings on the lots, and why each lot left empty is. */
  buildings(input: { site: TownSite; history: History; layout: Layout; blocks: readonly Block[]; lots: readonly Lot[]; drafts: readonly LotDraft[] }, rng: Rng): { buildings: Building[]; gaps: Gap[] };
  bindLandmarks(history: History, names: TownNames, townName: string, lots: readonly Lot[], buildings: readonly Building[]): Landmark[];
  spawn(hall: Building): Spawn;
  /** The decks of the old harbour: the quay's apron, the piers, the sheds' platforms and the wharf. */
  decks(layout: Layout, buildings: readonly Building[], streets: readonly Street[]): Deck[];
  /** The boat basin, boats, pilings, the mill's water, the terminal and the lights, and the floats' and gangways' decks. */
  harbour(input: { site: TownSite; layout: Layout; history: History; buildings: readonly Building[]; streets: readonly Street[]; decks: readonly Deck[] }, rng: Rng): HarbourOut;
  /** What is in each building: its units, tenants, names, signs, rooms and windows. Made last, from the finished plan and a stream of its own. */
  uses(input: BizInput, rng: Rng): BuildingUse[];
};

const PORT: Recipe = {
  history: makeHistory,
  layout: (site, history, names, s) => layoutPort(site, history, names, s.plats, s.streets),
  landmarkPlan: (site, layout, history, rng) => {
    const p = planLandmarks(site, layout, history, rng);
    return { reservations: p.reservations };
  },
  lotRule: (block) => LOT_RULES[block.district],
  buildings: buildPort,
  bindLandmarks,
  spawn: spawnAt,
  decks: (layout, buildings, streets) => portDecks(layout.quay, buildings, streets),
  harbour: (input, rng) => planHarbour(input, rng),
  uses: planUses,
};

export const RECIPES: Record<TownKind, Recipe> = { port: PORT };

export type { District, Harbour };
