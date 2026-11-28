/**
 * The people who stand in the open shops (`people.ts`), drawn: the renderer's side, made as the vehicles' is (`props/vehicleParts.ts`).
 *
 * - **A body each, a model's bodies one draw.** Each of the five models is the engine's skinned model (`loadSkinnedModel`): its clips are
 *   baked once into a table, and each person is an instance with a matrix of their own and a place in their clip of their own (a start
 *   offset and a rate), so no two move in step. The clock is the renderer's (`skinClock`): a body that plays on costs nothing a frame.
 * - **The files hold the clips faster than life.** The table has sixty rows for each second of a file's clip, and a row is every bone's
 *   matrix. People who stand and sit move slowly, so the files hold each clip two and a half times too fast and a body plays it at
 *   `CLIP_STORED` of its rate: twenty-four rows to a second of movement, and a table two fifths the size.
 * - **A bone is two texels of the table, not four.** The table holds each bone as a turn, a place and one size (`clipLayout`), and the
 *   shader rebuilds its matrix: half the table's memory (5.3 MB a model where it was 10.7). The models' matrices are that but for a
 *   shear of a few parts in a hundred thousand, which moves no point of a body by more than 0.055 mm.
 * - **They arrive when their files have.** Nothing holds the first frame: the loads begin once the town's geometry is made (`begin`), and a
 *   model that does not load is left out, said once on the console; the town stands without that person.
 * - **Only the near ones are drawn.** Every quarter second the people within `REACH` of the eye (less on the low tier) are written to their
 *   models' matrices and clip parameters and shown; a quarter second in which the set has not changed writes nothing.
 * - **A cup or a phone only in the hand that holds one.** Each model has two small primitives skinned to the right hand, with materials named
 *   `prop.cup` and `prop.phone`. The engine draws every primitive with the same bodies, so as they came everyone would hold both. They are not
 *   drawn by the engine (`dress` says no); each is given a matrix array of its own here, the same size as the bodies' (a thing's instance k is
 *   body k, since the clip a body plays is read by the instance's index), holding the body's own matrix for a body that holds that thing
 *   (`handHeld.ts`) and a matrix that draws nothing for every other.
* - **Walkers** (`walkers.ts`) are bodies of the same models playing `walk`, after the standers in each model's matrices. Where a walker is is a function of
 *   the hour alone, so their matrices are written every frame they are shown (a few dozen at most), from an hour that runs on between the day clock's
 *   pushes by the skin clock's own seconds; their clip floats are written once, when the set shown changes: the clip's rate is the speed over the stride
 *   the model's file says (`walk` in `people.json`), so that a foot planted on the pavement stays where it is. A walker comes out of a door and goes in at
 *   one in full view: nothing holds them back at the two ends, and they hold nothing.
 * - **A soft dark under each one shown** (`peopleShade.ts`): written with the set a model shows, in one draw for everyone, and let go with the part. A walker's is written every frame, with its body, under one key of its own for all of them (`walkers`), and taken away the frame the last one is not shown.
 * - **They wear the town's air, and are darker than the open sky would make them**, since they stand indoors (`dress`).
 */
import { flushThinInstances, markMaterialUboDirty, setMeshVisible, setThinInstanceCount, setThinInstances, type EngineContext, type MaterialPlugin, type PbrMaterialProps, type SceneContext } from "@babylonjs/lite";
import { modelUrl } from "@csarkosh/engine/game/assetUrls";
import { DRAW_ORDER, createDrawOrders } from "@csarkosh/engine/game/lite/drawOrder";
import { loadSkinnedModel, type SkinClock, type SkinnedModel, type SkinnedPart } from "@csarkosh/engine/game/lite/skinnedModels";
import type { FrameUploads } from "@csarkosh/engine/game/lite/frameUploads";
import { SKIN_CLOCK_FOLD, writeBodyMatrix, writeClipParams, type BakedClip } from "@csarkosh/engine/game/skinInstances";
import manifest from "../../../assets/models/people.json" with { type: "json" };
import { isOpen, wrapHour, type Hours } from "./hours.js";
import type { Held } from "./handHeld.js";
import { HOUR_S } from "../dayClock.js";
import { PERSON_MODELS, type Activity, type PersonModel, type PersonSeat, type PersonWorld } from "./people.js";
import { alongAt, pathSpeed, type Walker } from "./walkers.js";
import type { LampList } from "./lampLight.js";
import { emptyPeopleLamps, peopleLampPlugin, writePeopleLamps } from "./peopleLight.js";
import { personShade, type PeopleShade, type ShadePlace } from "./peopleShade.js";
import { WALK_VENUE, type Nudge, type Seen } from "./peopleReact.js";
import type { Venue } from "../peopleWords.js";

/** How far from the eye a person is drawn (m), and on the low tier. */
export const PEOPLE_REACH = 60;
export const PEOPLE_REACH_LOW = 35;
/** The same for the people outside, who are seen along a whole street (and on the low tier). */
export const OUTDOOR_REACH = 110;
export const OUTDOOR_REACH_LOW = 60;
/** A person outside is shown or hidden only farther than this from the eye, or out of the view (half the width of it, radians, which is wider than any view the game has). */
export const NO_POP_DISTANCE = 35;
export const OUT_OF_VIEW = (80 * Math.PI) / 180;
/** How often the set drawn is worked out again, seconds. */
export const PEOPLE_STEP = 0.25;
/** Seconds of a model file's clip to a second of the movement it holds: the files' clips are stored two and a half times too fast. */
export const CLIP_STORED = 0.4;

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
  /** The eye and the way it looks (yaw 0 faces +z, growing toward +x). */
  readonly eye: { readonly x: number; readonly y: number; readonly z: number; readonly yaw: number };
  readonly low: boolean;
  /** The dark under each person shown (`peopleShade.ts`): written with the set shown; none on the low tier. */
  readonly shade?: PeopleShade;
};

/** What a body needs of a person: the model, the clip, the seat, and how they vary. A person of a room (`people.ts`) and one outside (`outdoorPeople.ts`) both are. */
export type Body = {
  readonly model: PersonModel;
  readonly activity: Activity;
  readonly seat: PersonSeat | null;
  readonly scale: number;
  readonly offset: number;
  readonly rate: number;
};

/**
 * A person with the place they stand at in the world. `hours`: the hours they are shown. A person of a room (`outdoor` false) is shown at the hour
 * as it is (their unit's opening hours; null: always). A person outside (`outdoor`) changes only out of sight (`mayChange`).
 */
export type PlacedPerson = {
  readonly person: Body; readonly at: PersonWorld; readonly hours: Hours | null; readonly outdoor: boolean; /** What they hold in the right hand (`heldBy`). */ readonly held: Held;
  /** The one they stand or sit with, as a place in the list the parts were made with, and the kind of place they are at (what two together talk of): `peopleReact.ts` reads both. */
  readonly partner?: number;
  readonly venue?: Venue;
  /** The id of the room (`sim/inside/rooms.ts`) this person stands in the hidden copy of, over the street: shown only while the local player is where that room is (`setInside`), and nobody else is shown then. */
  readonly room?: number;
};

/** The things the models carry in a hand, by the name of the primitive's material. */
export const PROP_MATERIALS: ReadonlyMap<string, Exclude<Held, null>> = new Map([["prop.cup", "cup"], ["prop.phone", "phone"]]);

/** The people who walk: the list, and where each is at an hour (null where not walking). */
export type Walking = {
  /** The most walkers at once: each model's batch has room for that many. */
  readonly cap: number;
  /** The walkers, or null until they have been made (they are a job of the scheduler's, not wanted on the first frame). */
  readonly get: () => readonly Walker[] | null;
  readonly at: (w: Walker, hour: number) => PersonWorld | null;
};

/** The key of a walker among the people (`Seen.key`): past every stander's, which is their place in the list the parts were made with. */
export const WALKER_KEY = 1_000_000;

export type PeopleParts = {
  /** Begins loading the models the people use. Once. */
  begin(): void;
  /** Calls `visit` with each person drawn at the last step, where their schedule has them (before any nudge): the standers by their place in the list, the walkers by `WALKER_KEY` and their id. */
  each(visit: (p: Seen) => void): void;
  /** What moves a body off its schedule from now on (`peopleReact.ts`, `nudgeOf`), or null for nothing: asked for every body drawn, every frame, with the body's key and the yaw its schedule gives it. */
  setNudge(nudge: ((key: number, yaw: number, out: Nudge) => boolean) | null): void;
  /** One frame: `dt` seconds on. Works out who is near on each quarter second and writes them; sends the clock on a frame that shows anyone. */
  step(dt: number): void;
  /** The hour of day, 0 to 24: who is shown is worked out again at once when it moves. */
  setHour(hour: number): void;
  /** The id of the room the local player is where (0 in the street): only the people of that room are shown, or, in the street, only those of no room. */
  setInside(room: number): void;
  /** The hour of day the people are drawn at now (the last hour pushed, run on by the skin clock): the doors that open for the walkers use this one (`openDoors.ts`). */
  hourNow(): number;
  /** The lamps nearest the eye, and the hour's glow gain: the light the people take (`peopleLight.ts`). */
  setLamps(list: LampList, glow: number): void;
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
  /** For each person, whether they are shown (a person outside keeps what they were until they change out of sight) and whether that has been decided at all. */
  on: Uint8Array;
  decided: Uint8Array;
  /** The walkers of this model, and which are shown now (indices into `walkers`, in the order written after the standers), and where each of those was at the last step. */
  walkers: Walker[];
  walking: number[];
  wplaces: (PersonWorld | null)[];
  /** For each person, whether their body was written moved off its schedule at the last step (so it is written back when the move is over). */
  nudged: Uint8Array;
  /** For each walker: where in the clip they were (clip seconds) at the clock's run `wat`, the clip rate written, and the 5 percent step of their ground speed it was made for. */
  wphase: Float64Array;
  wat: Float64Array;
  wrate: Float64Array;
  wbin: Float64Array;
  /** The things in the hand: the primitive and the matrices it is drawn with, one for each body of the model (`capacity`). */
  things: { readonly kind: Exclude<Held, null>; readonly part: SkinnedPart; readonly matrices: Float32Array }[];
};

/** The file's size in the manifest, counted as uploaded once its model has landed. */
function bytesOf(id: string): number {
  return manifest.people.find((p) => p.id === id)?.bytes ?? 0;
}

/**
 * Whether a person at (`dx`, `dz`) from the eye (squared distance `d2`), the eye looking along `yaw`, may be shown or hidden without being seen to
 * pop: when they are farther than `NO_POP_DISTANCE`, or behind or beside the view (the way the eye looks is known, its width is taken as the widest
 * the game has). A person who has not changed waits, so a smoker outstays closing by a minute if you stand and watch them.
 */
export function mayChange(dx: number, dz: number, d2: number, yaw: number): boolean {
  if (d2 > NO_POP_DISTANCE * NO_POP_DISTANCE) return true;
  const d = Math.sqrt(d2);
  if (d < 1e-6) return false;
  return (dx * Math.sin(yaw) + dz * Math.cos(yaw)) / d < Math.cos(OUT_OF_VIEW);
}

/**
 * A body's matrix with a nudge over it: shifted, lifted and turned, and leaned by `n.lean` radians toward (`n.lx`, `n.lz`) about its feet (with d the
 * way of the lean and u up, R = I + (cos - 1)(d d^T + u u^T) + sin (d u^T - u d^T) takes u toward d: the three axes are turned, the feet stay).
 */
export function writeNudged(out: Float32Array, index: number, x: number, y: number, z: number, yaw: number, scale: number, n: Nudge): void {
  writeBodyMatrix(out, index, x + n.dx, y + n.dy, z + n.dz, yaw + n.yaw, scale);
  if (n.lean === 0) return;
  const c = Math.cos(n.lean);
  const s = Math.sin(n.lean);
  const k1 = c - 1;
  const at = index * 16;
  for (let col = 0; col < 3; col++) {
    const vx = out[at + col * 4] as number;
    const vy = out[at + col * 4 + 1] as number;
    const vz = out[at + col * 4 + 2] as number;
    const along = n.lx * vx + n.lz * vz;
    out[at + col * 4] = vx + k1 * n.lx * along + s * n.lx * vy;
    out[at + col * 4 + 1] = vy + k1 * vy - s * along;
    out[at + col * 4 + 2] = vz + k1 * n.lz * along + s * n.lz * vy;
  }
}

export function createPeopleParts(host: PeoplePartsHost, placed: readonly PlacedPerson[], walk: Walking = { cap: 0, get: () => [], at: () => null }): PeopleParts {
  const batches = new Map<PersonModel, Batch>();
  for (const id of PERSON_MODELS) {
    // A chair is not drawn on the low tier, so nobody sits there.
    const people = placed.filter((p) => p.person.model === id && !(host.low && !p.outdoor && p.person.seat !== null));
    if (people.length > 0 || walk.cap > 0) {
      batches.set(id, {
        id, people, model: null, shown: [], on: new Uint8Array(people.length), decided: new Uint8Array(people.length), walkers: [], walking: [], wplaces: [], nudged: new Uint8Array(people.length),
        wphase: new Float64Array(0), wat: new Float64Array(0), wrate: new Float64Array(0), wbin: new Float64Array(0), things: [],
      });
    }
  }
  // Each person's key: their place in the list the parts were made with.
  const keyOf = new Map<PlacedPerson, number>();
  for (const [i, p] of placed.entries()) keyOf.set(p, i);
  let nudge: ((key: number, yaw: number, out: Nudge) => boolean) | null = null;
  const moved: Nudge = { dx: 0, dy: 0, dz: 0, yaw: 0, lx: 1, lz: 0, lean: 0 };
  /** A sitter's body is on the floor under the middle of the seat, raised by the seat's height less the one the clip was made for. */
  const seatLift = (person: Body, sitting: boolean): number => (person.seat === null || !sitting ? 0 : person.seat.top - (person.seat.family === "stool" ? STOOL_CLIP_SEAT : CHAIR_CLIP_SEAT));
  const loads = new AbortController();
  const missing = new Set<string>();
  const orders = createDrawOrders(DRAW_ORDER.bodies);
  const reach = host.low ? PEOPLE_REACH_LOW : PEOPLE_REACH;
  const outReach = host.low ? OUTDOOR_REACH_LOW : OUTDOOR_REACH;
  // The lamps' light on the bodies: one record, the materials of every model read it.
  const lamps = emptyPeopleLamps();
  const dressed: PbrMaterialProps[] = [];
  let pending = 0;
  let landed = 0;
  let began = false;
  let disposed = false;
  let since = PEOPLE_STEP;
  // The room the local player is where (0: the street).
  let inside = 0;
  // The hour of day: nobody is shown in a unit that is shut at it. `hourRun` is the clock's run when it was pushed.
  let hour = 12;
  let hourRun = 0;
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
        capacity: batch.people.length + walk.cap,
        clipLayout: "rigid",
        clock: host.clock,
        signal: loads.signal,
        // The material keeps the file's own textures and wears the town's air; indoors, so darker than the sky would light it.
        dress(part) {
          const base = part.material.baseColorFactor ?? [1, 1, 1, 1];
          part.material.baseColorFactor = [base[0] * INDOOR_DARKEN, base[1] * INDOOR_DARKEN, base[2] * INDOOR_DARKEN, base[3]];
          part.material.usePhysicalLightFalloff = true;
          part.material.plugins = [host.air(), peopleLampPlugin(lamps)];
          dressed.push(part.material);
          orders.take(part.material);
          part.mesh.renderOrder = orders.of(part.material) ?? DRAW_ORDER.bodies;
          // A thing in the hand is drawn by this file and not by the engine (see above).
          return !PROP_MATERIALS.has(part.name);
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
          for (const part of model.parts) {
            const kind = PROP_MATERIALS.get(part.name);
            if (kind === undefined) continue;
            // Its own matrices, of the bodies' count: all of them draw nothing until a body that holds it is shown.
            const matrices = new Float32Array(model.capacity * 16);
            setThinInstances(part.mesh, matrices, model.capacity);
            setThinInstanceCount(part.mesh, 0);
            batch.things.push({ kind, part, matrices });
          }
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

  /** The clock's whole run, seconds (the skin clock's, which folds). */
  const runNow = (): number => host.clock.folds * SKIN_CLOCK_FOLD + host.clock.seconds;
  /** The hour of day now: the last hour pushed, run on by the clock's own seconds since (the day clock pushes only every hundredth of an hour). */
  const hourNow = (): number => wrapHour(hour + ((runNow() - hourRun) / HOUR_S));
  // The walkers: the real seconds of a clip cycle and the metres of a stride the file says, for a model.
  // `stored` is the seconds of the file's walk clip to a second of the movement it holds: 1 where the other clips hold their movement at `CLIP_STORED`.
  const walkSpec = (id: PersonModel): { stride: number; stored: number } => {
    const entry = manifest.people.find((p) => p.id === id);
    return { stride: entry?.walk.stride_m ?? 1.25, stored: entry?.walk.stored ?? 1 };
  };
  // Once the walkers have been made, each model's are taken from the list.
  let walkersMade = walk.cap === 0;
  let walkShadeDrawn = false;

  /** Writes a walker's clip floats at the rate that matches their ground speed now (speed x the path's, over the stride and size), from where in the clip they are. */
  function writeWalker(batch: Batch, model: SkinnedModel, i: number, k: number, clip: BakedClip, spec: { stride: number; stored: number }, now: number): void {
    const w = batch.walkers[i] as Walker;
    const run = runNow();
    const bin = Math.round(pathSpeed(w, Math.max(alongAt(w, now), 0)) * 20) / 20;
    const rate = (w.speed * bin * spec.stored) / (spec.stride * w.scale);
    // Where they are in the clip now: from the start (their own offset) at the rate they had until now.
    const phase = batch.wat[i] === -1 ? w.offset * spec.stored : (batch.wphase[i] as number) + (run - (batch.wat[i] as number)) * (batch.wrate[i] as number);
    const at = ((phase % clip.seconds) + clip.seconds) % clip.seconds;
    batch.wphase[i] = at;
    batch.wat[i] = run;
    batch.wrate[i] = rate;
    batch.wbin[i] = bin;
    model.clipParams[k * 8] = -1;
    writeClipParams(model.clipParams, k, clip, at, rate, host.clock.seconds, true);
  }

  function step(dt: number): void {
    if (disposed) return;
    since += dt;
    if (folds < 0) folds = host.clock.folds;
    const refold = host.clock.folds !== folds;
    let any = false;
    const standerStep = since >= PEOPLE_STEP || refold;
    if (standerStep) {
      since = 0;
      folds = host.clock.folds;
    }
    const eye = host.eye;
    const reach2 = reach * reach;
    const outReach2 = outReach * outReach;
    const now = hourNow();
    const walkShade: ShadePlace[] = [];
    if (!walkersMade) {
      const list = walk.get();
      if (list !== null) {
        walkersMade = true;
        for (const batch of batches.values()) {
          batch.walkers = list.filter((w) => w.model === batch.id);
          batch.wphase = new Float64Array(batch.walkers.length);
          batch.wat = new Float64Array(batch.walkers.length).fill(-1);
          batch.wrate = new Float64Array(batch.walkers.length);
          batch.wbin = new Float64Array(batch.walkers.length).fill(-1);
        }
      }
    }
    for (const batch of batches.values()) {
      const model = batch.model;
      if (model === null) continue;
      // The walkers shown: walking now and within the eye's reach. Looked at every frame, so one is shown the frame they leave a door and hidden the frame they arrive.
      const wnext: number[] = [];
      const places: (PersonWorld | null)[] = [];
      for (const [i, w] of inside === 0 ? batch.walkers.entries() : []) {
        const at = walk.at(w, now);
        if (at === null) continue;
        const dx = at.x - eye.x;
        const dz = at.z - eye.z;
        if (dx * dx + dz * dz > outReach2) continue;
        // The batch has room for `walk.cap` walkers at once (the town's ceiling, which the trips keep under): one more is not drawn.
        if (wnext.length >= walk.cap) break;
        wnext.push(i);
        places.push(at);
      }
      const wsame = wnext.length === batch.walking.length && wnext.every((v, k) => v === batch.walking[k]);
      let changed = !wsame;
      let next = batch.shown;
      if (standerStep) {
        next = [];
        for (const [i, p] of batch.people.entries()) {
          // Where the player is in a room, that room's people are shown and nobody else; in the street, not a room's.
          if ((p.room ?? 0) !== inside) continue;
          const dx = p.at.x - eye.x;
          const dz = p.at.z - eye.z;
          const d2 = dx * dx + dz * dz;
          if (!p.outdoor) {
            if (d2 <= reach2 && (p.hours === null || isOpen(p.hours, hour))) next.push(i);
            continue;
          }
          const inReach = d2 <= outReach2;
          const want = inReach && (p.hours === null || isOpen(p.hours, hour));
          if (batch.decided[i] === 0) {
            batch.decided[i] = 1;
            batch.on[i] = want ? 1 : 0;
          } else if (want !== (batch.on[i] === 1)) {
            // Beyond the reach no one sees them; within it, a change waits until they are far or out of the view.
            if (!inReach || mayChange(dx, dz, d2, eye.yaw)) batch.on[i] = want ? 1 : 0;
          }
          if (batch.on[i] === 1) next.push(i);
        }
        const same = next.length === batch.shown.length && next.every((v, k) => v === batch.shown[k]);
        if (!same || refold) changed = true;
      }
      const idle = model.clips.get("idle");
      if (idle === undefined) continue;
      if (changed) {
        batch.shown = next;
        batch.walking = wnext;
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
          const y = at.y + seatLift(person, clip !== idle);
          writeBodyMatrix(model.matrices, k, at.x, y, at.z, at.yaw, person.scale);
          batch.nudged[i] = 0;
          // A fold of the clock writes every body's floats again. Where in the clip a body is now is worked out from the clock's whole run, so a
          // body that was already shown goes on from where it was when the set changes, and does not start again.
          model.clipParams[k * 8] = -1;
          const run = runNow();
          writeClipParams(model.clipParams, k, clip, ((person.offset + run * person.rate) * CLIP_STORED) % clip.seconds, person.rate * CLIP_STORED, host.clock.seconds, true);
        }
        // The walkers follow the standers: their clip floats are written once, with a rate that makes the feet keep to the ground (speed = stride x size x rate).
        const spec = walkSpec(batch.id);
        const walkClip = model.clips.get("walk");
        if (walkClip === undefined && wnext.length > 0 && !missing.has(`${batch.id}:walk`)) {
          missing.add(`${batch.id}:walk`);
          console.warn(`the person model ${batch.id} has no walk clip; its walkers glide standing idle`);
        }
        for (const [q, i] of wnext.entries()) writeWalker(batch, model, i, next.length + q, walkClip ?? idle, spec, now);
        host.shade?.write(batch.id, next.map((i) => personShade(batch.people[i] as PlacedPerson)));
        // The things in the hand: the body's own matrix for a body that holds one, and none that draws for the rest (a walker holds nothing).
        for (const thing of batch.things) {
          let holders = 0;
          for (const [k, i] of next.entries()) {
            const at = k * 16;
            if ((batch.people[i] as PlacedPerson).held === thing.kind) {
              thing.matrices.set(model.matrices.subarray(at, at + 16), at);
              holders++;
            } else thing.matrices.fill(0, at, at + 16);
          }
          thing.matrices.fill(0, next.length * 16, (next.length + wnext.length) * 16);
          setThinInstanceCount(thing.part.mesh, holders > 0 ? next.length + wnext.length : 0);
          setMeshVisible(thing.part.mesh, holders > 0);
          if (holders > 0) host.uploads.count("instances", (next.length + wnext.length) * 64);
        }
      }
      // A stander who is moved off their schedule (`setNudge`: made to jump, knocked back, turned to the player) is written every frame they are, and
      // once more, back where they stand, when it is over; what they hold goes with them.
      let restood = false;
      if (nudge !== null || batch.nudged.some((v) => v === 1)) {
        for (const [k, i] of batch.shown.entries()) {
          const { person, at } = batch.people[i] as PlacedPerson;
          const off = nudge !== null && nudge(keyOf.get(batch.people[i] as PlacedPerson) as number, at.yaw, moved);
          if (!off && batch.nudged[i] === 0) continue;
          const y = at.y + seatLift(person, model.clips.has(person.activity));
          if (off) writeNudged(model.matrices, k, at.x, y, at.z, at.yaw, person.scale, moved);
          else writeBodyMatrix(model.matrices, k, at.x, y, at.z, at.yaw, person.scale);
          batch.nudged[i] = off ? 1 : 0;
          restood = true;
          for (const thing of batch.things) {
            if ((batch.people[i] as PlacedPerson).held !== thing.kind) continue;
            thing.matrices.set(model.matrices.subarray(k * 16, k * 16 + 16), k * 16);
            flushThinInstances(thing.part.mesh, k, 1);
          }
        }
      }
      // The walkers' matrices, every frame they are shown; and a walker whose ground speed has moved by a twentieth (a pair's outer one in a bend) has
      // their clip's rate written again, from where in the clip they are, so that their feet keep to the ground.
      let reclipped = changed;
      const walkClip2 = model.clips.get("walk") ?? idle;
      const spec2 = walkSpec(batch.id);
      for (const [q, i] of wnext.entries()) {
        const w = batch.walkers[i] as Walker;
        const at = places[q] as PersonWorld;
        if (nudge !== null && nudge(WALKER_KEY + w.id, at.yaw, moved)) writeNudged(model.matrices, batch.shown.length + q, at.x, at.y, at.z, at.yaw, w.scale, moved);
        else writeBodyMatrix(model.matrices, batch.shown.length + q, at.x, at.y, at.z, at.yaw, w.scale);
        walkShade.push(personShade({ at, person: { seat: null, scale: w.scale } }));
        if (!changed && Math.abs(Math.round(pathSpeed(w, alongAt(w, now)) * 20) / 20 - (batch.wbin[i] as number)) > 1e-6) {
          writeWalker(batch, model, i, batch.shown.length + q, walkClip2, spec2, now);
          reclipped = true;
        }
      }
      batch.wplaces = places;
      if (changed || restood || wnext.length > 0) model.show(batch.shown.length + wnext.length, true, reclipped);
    }
    // The walkers' dark moves with them every frame, under one key for all, and goes the frame the last of them is not shown.
    if (walkShade.length > 0 || walkShadeDrawn) host.shade?.write("walkers", walkShade);
    walkShadeDrawn = walkShade.length > 0;
    for (const batch of batches.values()) if (batch.shown.length > 0 || batch.walking.length > 0) any = true;
    // The shared clock is sent on a frame that shows a body.
    if (any) host.clock.send(host.uploads);
  }

  return {
    begin,
    step,
    each(visit) {
      for (const batch of batches.values()) {
        if (batch.model === null) continue;
        for (const i of batch.shown) {
          const p = batch.people[i] as PlacedPerson;
          visit({ key: keyOf.get(p) as number, x: p.at.x, y: p.at.y, z: p.at.z, yaw: p.at.yaw, scale: p.person.scale, walking: false, seated: p.person.seat !== null, sheltered: !p.outdoor, fixed: p.room !== undefined, partner: p.partner ?? -1, venue: p.venue ?? "street" });
        }
        for (const [q, i] of batch.walking.entries()) {
          const at = batch.wplaces[q];
          const w = batch.walkers[i];
          if (at === null || at === undefined || w === undefined) continue;
          visit({ key: WALKER_KEY + w.id, x: at.x, y: at.y, z: at.z, yaw: at.yaw, scale: w.scale, walking: true, seated: false, sheltered: false, partner: w.partner < 0 ? -1 : WALKER_KEY + w.partner, venue: WALK_VENUE[w.reason] });
        }
      }
    },
    setNudge(next) {
      nudge = next;
    },
    setHour(next) {
      if (next === hour) return;
      hourRun = runNow();
      hour = next;
      since = PEOPLE_STEP;
    },
    hourNow,
    setInside(room) {
      if (room === inside) return;
      inside = room;
      since = PEOPLE_STEP;
    },
    setLamps(list, glow) {
      writePeopleLamps(lamps, list, glow);
      for (const m of dressed) markMaterialUboDirty(m);
    },
    stats() {
      let shown = 0;
      for (const b of batches.values()) shown += b.shown.length;
      return { models: landed, shown };
    },
    settled,
    dispose() {
      disposed = true;
      loads.abort();
      host.shade?.dispose();
      for (const b of batches.values()) {
        b.model?.dispose();
        b.model = null;
        b.shown = [];
      }
    },
  };
}
