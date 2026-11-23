/**
 * The props stage: what stands in the streets, yards and docks, decided from the history the plan already holds (a lot's era, its yard's
 * kind, whether its building is lived in, vacant or a ruin, the trade of its open units, the street's era and edge, the nearness of the
 * harbour), never scattered. It runs last, on a stream of its own (`props`): nothing above it changes. Each category draws from a
 * sub-stream of the stage's (`context.sub`), so a draw added to one moves no other. See `tuning.ts` for every authored number.
 *
 * The order matters, because the first to take a place keeps it: the keep-out boxes (junctions, drives, walks, alleys, ends, the spawn)
 * and the buildings come first, then fences (they stop at the drives), poles, yard props and mailboxes, the sidewalk's furniture and litter (`street.ts`), and last the vehicles.
 */
import type { PlanProps } from "../../types.js";
import { stageRng } from "../../rng.js";
import { contextOf, type BasePlan } from "./context.js";
import { planFences } from "./fences.js";
import { Out } from "./out.js";
import { planPoles } from "./poles.js";
import { planStreet } from "./street.js";
import { planVehicles } from "./vehicles.js";
import { planYardProps } from "./yardProps.js";
import { dedupe } from "./dedupe.js";

export function planProps(plan: BasePlan): PlanProps {
  const seed0 = stageRng(plan.seed, "props").state;
  const ctx = contextOf(plan, seed0);
  const out = new Out();
  planFences(ctx, out);
  planPoles(ctx, out);
  planYardProps(ctx, out);
  planStreet(ctx, out);
  planVehicles(ctx, out);
  const props: PlanProps = { vehicles: out.vehicles, trailers: out.trailers, poles: out.poles, drops: out.drops, fences: out.fences, bins: out.bins, mailboxes: out.mailboxes, gear: out.gear, furniture: out.furniture, litter: out.litter, solids: out.solids };
  return dedupe(ctx, props);
}
