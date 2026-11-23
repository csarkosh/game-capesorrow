/**
 * What the railroad's cells are built from, for a world seed: the engine's ground, the highway's grade line, the line's
 * centre, the town's crossings of it, the sea's runs along it and the poles of the power line beside the highway. Each is a
 * pure function of the seed, found where it is asked.
 */
import { roadGradeAt } from "@csarkosh/engine/sim/olympic";
import { elevationSampleAt } from "@csarkosh/engine/sim/terrain";
import { planFor } from "../../sim/town/planFor.js";
import { polesIn } from "../../sim/town/powerLine.js";
import { railCenterX } from "../../sim/town/rail.js";
import { crossingsFor } from "../../sim/town/railCrossings.js";
import { railSpansIn } from "../../sim/town/railSpans.js";
import { siteFor } from "../../sim/town/siteFor.js";
import type { RailWorld } from "./railGeometry.js";

const WORLDS = new Map<number, RailWorld>();

/** The railroad's world for a seed, made once. */
export function railWorld(seed: number): RailWorld {
  let w = WORLDS.get(seed);
  if (w === undefined) {
    w = {
      seed,
      heightAt: (x, z) => elevationSampleAt(seed, x, z).h,
      gradeAt: (z) => roadGradeAt(seed, z).h,
      centreX: (z) => railCenterX(seed, z),
      crossings: crossingsFor(planFor(seed), seed, siteFor(seed).anchor),
      spans: (z0, z1) => railSpansIn(seed, z0, z1),
      poles: (z0, z1) => polesIn(seed, z0, z1),
    };
    WORLDS.set(seed, w);
  }
  return w;
}
