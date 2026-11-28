/**
 * The title film's camera: a slow drift in from the sea toward the town, placed from the town's plan (the quay's middle, its seaward
 * normal, the downtown's centre) so any world gives a valid path. All keys look at one point inland of the downtown.
 */
import type { CameraPath } from "@csarkosh/engine/game/film/cameraPath";
import { seedFromToken } from "@csarkosh/engine/game/seed";
import { planFor } from "../sim/town/planFor.js";
import { siteFor } from "../sim/town/siteFor.js";

/** The film's world: the game mints a token per session, the film plays one fixed token. */
export const TITLE_TOKEN = "portashton-title";
export const TITLE_SEED = seedFromToken(TITLE_TOKEN);

/** Film length, s. */
export const TITLE_SECONDS = 32;
/**
 * Where the drift starts and ends: metres seaward of the quay's middle, and metres up. Within COMFORT (2 m/s) over the film's length, with
 * little to spare (1.62 of the 2 m/s is used): a retune of any distance here, or of `TITLE_SECONDS`, must re-run `client/test/film/titlePath.test.ts`.
 */
export const START_SEAWARD = 300;
export const START_UP = 40;
export const END_SEAWARD = 262;
export const END_UP = 32;
/** What every key looks at: metres inland of the downtown's centre, and metres up. */
export const LOOK_INLAND = 60;
export const LOOK_UP = 5;
export const TITLE_FOV = 0.9;
const KEYS = 4;

/** The downtown's centre in the world: the mean of its blocks' corners (the town's frame) plus the frame's anchor. */
export function downtownCentre(worldSeed: number): { x: number; z: number } {
  const plan = planFor(worldSeed);
  let x = 0;
  let z = 0;
  let n = 0;
  for (const id of plan.downtown) {
    for (const p of plan.blocks[id]!.polygon) {
      x += p.x;
      z += p.z;
      n++;
    }
  }
  const a = siteFor(worldSeed).anchor;
  return { x: x / n + a.x, z: z / n + a.z };
}

export function titlePath(worldSeed: number): CameraPath {
  const { quay } = planFor(worldSeed);
  // The quay's line runs past the harbour (its middle can stand on a headland), so the drift is laid out from the middle of the longest wet stretch, where water lies seaward.
  let reach = quay;
  let longest = -1;
  for (const w of quay.wet) {
    const len = Math.hypot(w.b.x - w.a.x, w.b.z - w.a.z);
    if (len > longest) {
      longest = len;
      reach = { ...quay, a: w.a, b: w.b };
    }
  }
  const anchor = siteFor(worldSeed).anchor;
  const mx = (reach.a.x + reach.b.x) / 2 + anchor.x;
  const mz = (reach.a.z + reach.b.z) / 2 + anchor.z;
  const { x: sx, z: sz } = quay.seaward;
  const c = downtownCentre(worldSeed);
  const look = [c.x - sx * LOOK_INLAND, LOOK_UP, c.z - sz * LOOK_INLAND] as const;
  const keys = [];
  for (let i = 0; i < KEYS; i++) {
    const u = i / (KEYS - 1);
    const d = START_SEAWARD + (END_SEAWARD - START_SEAWARD) * u;
    keys.push({
      t: TITLE_SECONDS * u,
      at: [mx + sx * d, START_UP + (END_UP - START_UP) * u, mz + sz * d] as const,
      look,
      fov: TITLE_FOV,
    });
  }
  return { keys };
}
