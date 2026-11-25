/**
 * The people who stand in the open shops (`people.ts`), drawn: the renderer's side, made as the vehicles' is (`props/vehicleParts.ts`).
 *
 * - **A body each, a model's bodies one draw.** Each of the five models is the engine's skinned model (`loadSkinnedModel`): its one clip,
 *   `idle`, is baked once into a table, and each person is an instance with a matrix of their own and a place in the clip of their own (a
 *   start offset and a rate), so no two move in step. The clock is the renderer's (`skinClock`): a body that plays on costs nothing a frame.
 * - **They arrive when their files have.** Nothing holds the first frame: the loads begin once the town's geometry is made (`begin`), and a
 *   model that does not load is left out, said once on the console; the town stands without that person.
 * - **Only the near ones are drawn.** Every quarter second the people within `REACH` of the eye (less on the low tier) are written to their
 *   models' matrices and clip parameters and shown; a quarter second in which the set has not changed writes nothing.
 * - **They wear the town's air, and are darker than the open sky would make them**, since they stand indoors (`dress`).
 */
import type { EngineContext, MaterialPlugin, SceneContext } from "@babylonjs/lite";
import { modelUrl } from "@csarkosh/engine/game/assetUrls";
import { DRAW_ORDER, createDrawOrders } from "@csarkosh/engine/game/lite/drawOrder";
import { loadSkinnedModel, type SkinClock, type SkinnedModel } from "@csarkosh/engine/game/lite/skinnedModels";
import type { FrameUploads } from "@csarkosh/engine/game/lite/frameUploads";
import { SKIN_CLOCK_FOLD, writeBodyMatrix, writeClipParams } from "@csarkosh/engine/game/skinInstances";
import manifest from "../../../assets/models/people.json" with { type: "json" };
import { PERSON_MODELS, type Person, type PersonModel, type PersonWorld } from "./people.js";

/** How far from the eye a person is drawn (m), and on the low tier. */
export const PEOPLE_REACH = 60;
export const PEOPLE_REACH_LOW = 35;
/** How often the set drawn is worked out again, seconds. */
export const PEOPLE_STEP = 0.25;

/**
 * How much the base colour is darkened: the models' textures were lit for the open sky, and these people stand in a room. Only a little:
 * they stand at the front of the room, which is its bright part, behind glass that keeps back a third of them already (at 0.6 they were
 * grey ghosts).
 */
export const INDOOR_DARKEN = 0.92;

/** The height of the seat the sitting clips were made for (m): a chair's, and a bar stool's. */
export const CHAIR_CLIP_SEAT = 0.46;
export const STOOL_CLIP_SEAT = 0.75;

export type PeoplePartsHost = {
  readonly engine: EngineContext;
  readonly scene: SceneContext;
  readonly air: () => MaterialPlugin;
  readonly clock: SkinClock;
  readonly uploads: FrameUploads;
  readonly eye: { readonly x: number; readonly y: number; readonly z: number };
  readonly low: boolean;
};

/** A person with the place they stand at in the world. */
export type PlacedPerson = { readonly person: Person; readonly at: PersonWorld };

export type PeopleParts = {
  /** Begins loading the models the people use. Once. */
  begin(): void;
  /** One frame: `dt` seconds on. Works out who is near on each quarter second and writes them; sends the clock on a frame that shows anyone. */
  step(dt: number): void;
  /** Models landed, and the people shown now. */
  stats(): { models: number; shown: number };
  /** Resolves once every model has landed (or failed). */
  readonly settled: Promise<void>;
  dispose(): void;
};

type Batch = {
  readonly id: PersonModel;
  readonly people: PlacedPerson[];
  model: SkinnedModel | null;
  /** The people shown, as indices into `people`, in the order they are written. */
  shown: number[];
};

/** The file's size in the manifest, counted as uploaded once its model has landed. */
function bytesOf(id: string): number {
  return manifest.people.find((p) => p.id === id)?.bytes ?? 0;
}

export function createPeopleParts(host: PeoplePartsHost, placed: readonly PlacedPerson[]): PeopleParts {
  const batches = new Map<PersonModel, Batch>();
  for (const id of PERSON_MODELS) {
    // A chair is not drawn on the low tier, so nobody sits there.
    const people = placed.filter((p) => p.person.model === id && !(host.low && p.person.seat !== null));
    if (people.length > 0) batches.set(id, { id, people, model: null, shown: [] });
  }
  const loads = new AbortController();
  const missing = new Set<string>();
  const orders = createDrawOrders(DRAW_ORDER.bodies);
  const reach = host.low ? PEOPLE_REACH_LOW : PEOPLE_REACH;
  let pending = 0;
  let landed = 0;
  let began = false;
  let disposed = false;
  let since = PEOPLE_STEP;
  // The clock's folds when the first model lands (it is not read before then).
  let folds = -1;
  let resolveSettled: () => void = () => undefined;
  const settled = new Promise<void>((resolve) => {
    resolveSettled = resolve;
  });
  if (batches.size === 0) resolveSettled();

  const done = (): void => {
    pending--;
    if (pending === 0) resolveSettled();
  };

  function begin(): void {
    if (began || disposed) return;
    began = true;
    pending = batches.size;
    for (const batch of batches.values()) {
      void loadSkinnedModel(host.engine, host.scene, modelUrl(`models/${batch.id}.glb`), {
        capacity: batch.people.length,
        clock: host.clock,
        signal: loads.signal,
        // The material keeps the file's own textures and wears the town's air; indoors, so darker than the sky would light it.
        dress(part) {
          const base = part.material.baseColorFactor ?? [1, 1, 1, 1];
          part.material.baseColorFactor = [base[0] * INDOOR_DARKEN, base[1] * INDOOR_DARKEN, base[2] * INDOOR_DARKEN, base[3]];
          part.material.usePhysicalLightFalloff = true;
          part.material.plugins = [host.air()];
          orders.take(part.material);
          part.mesh.renderOrder = orders.of(part.material) ?? DRAW_ORDER.bodies;
          return true;
        },
        uploads: host.uploads,
      }).then(
        (model) => {
          if (disposed) {
            model.dispose();
            return;
          }
          if (!model.clips.has("idle")) {
            model.dispose();
            console.warn(`the person model ${batch.id} has no idle clip; its people are not drawn`);
            done();
            return;
          }
          batch.model = model;
          landed++;
          host.uploads.count("geometry", bytesOf(batch.id), 4);
          since = PEOPLE_STEP;
          done();
        },
        (error: unknown) => {
          if (disposed || loads.signal.aborted) return;
          console.warn(`the person model ${batch.id} could not be loaded; its people are not drawn:`, error);
          done();
        },
      );
    }
  }

  function step(dt: number): void {
    if (disposed) return;
    since += dt;
    if (folds < 0) folds = host.clock.folds;
    const refold = host.clock.folds !== folds;
    let any = false;
    if (since >= PEOPLE_STEP || refold) {
      since = 0;
      folds = host.clock.folds;
      const eye = host.eye;
      const reach2 = reach * reach;
      for (const batch of batches.values()) {
        const model = batch.model;
        if (model === null) continue;
        const next: number[] = [];
        for (const [i, p] of batch.people.entries()) {
          const dx = p.at.x - eye.x;
          const dz = p.at.z - eye.z;
          if (dx * dx + dz * dz <= reach2) next.push(i);
        }
        const same = next.length === batch.shown.length && next.every((v, k) => v === batch.shown[k]);
        if (same && !refold) continue;
        const idle = model.clips.get("idle");
        if (idle === undefined) continue;
        batch.shown = next;
        for (const [k, i] of next.entries()) {
          const { person, at } = batch.people[i] as PlacedPerson;
          // The clip they play: their activity's, or idle (said once) where this model lacks it.
          let clip = model.clips.get(person.activity);
          if (clip === undefined) {
            if (!missing.has(`${batch.id}:${person.activity}`)) {
              missing.add(`${batch.id}:${person.activity}`);
              console.warn(`the person model ${batch.id} has no ${person.activity} clip; its people do that standing idle`);
            }
            clip = idle;
          }
          // A sitter's body is on the floor under the middle of the seat, raised by the seat's height less the one the clip was made for.
          const y = at.y + (person.seat === null || clip === idle ? 0 : person.seat.top - (person.seat.family === "stool" ? STOOL_CLIP_SEAT : CHAIR_CLIP_SEAT));
          writeBodyMatrix(model.matrices, k, at.x, y, at.z, at.yaw, person.scale);
          // A fold of the clock writes every body's floats again. Where in the clip a body is now is worked out from the clock's whole run, so a
          // body that was already shown goes on from where it was when the set changes, and does not start again.
          model.clipParams[k * 8] = -1;
          const run = host.clock.folds * SKIN_CLOCK_FOLD + host.clock.seconds;
          writeClipParams(model.clipParams, k, clip, (person.offset + run * person.rate) % clip.seconds, person.rate, host.clock.seconds, true);
        }
        model.show(next.length, true, true);
      }
    }
    for (const batch of batches.values()) if (batch.shown.length > 0) any = true;
    // The shared clock is sent on a frame that shows a body.
    if (any) host.clock.send(host.uploads);
  }

  return {
    begin,
    step,
    stats() {
      let shown = 0;
      for (const b of batches.values()) shown += b.shown.length;
      return { models: landed, shown };
    },
    settled,
    dispose() {
      disposed = true;
      loads.abort();
      for (const b of batches.values()) {
        b.model?.dispose();
        b.model = null;
        b.shown = [];
      }
    },
  };
}
