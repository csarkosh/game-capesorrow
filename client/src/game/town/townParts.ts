/**
 * Cape Sorrow's side of a renderer (`renderGame.ts`): the engine's own with no parts of a game's (`noParts`: its look, its
 * api, every point at rest) and, joined to the scene once it is registered, the town.
 *
 * - **The geometry is the pure builders'** (`townGeometry.ts`): batches of arrays by cell of 128 m, one for what lies
 *   flat on the ground and one for what stands. Here each batch is a Lite mesh (`createMeshFromData`, with vertex colours)
 *   under a matt PBR material that wears the air (fog), the weather's wet look at a prop's cap, and, for the flat
 *   layer, a depth step ahead of the terrain (`ahead`), as the engine's own props are.
 * - **Built over frames**: the geometry and then a mesh a slice are a job of the renderer's scheduler (`host.jobs`),
 *   the cells nearest the start first, so no frame stalls on the town. `waiting()` says how many are not yet made.
 * - **Culled here, since Lite culls no mesh**: each frame `seen` shows a cell's meshes while its bounding sphere is in
 *   the view's planes, and, for the standing layer, while it reaches into the rain's cover map's square (a hidden mesh is
 *   left out of that pass too).
 * - **Cover for the rain**: the standing layer's meshes (the buildings, the piers) are registered with the rain's cover
 *   map (`hardCover`, which is there on the tiers above low); the streets are not, they are what the rain lands on.
 * - **Tiers**: the low tier builds its buildings without the upper storeys' windows, the window frames and the sills
 *   (`Detail`); the geometry is otherwise the same on all three.
 */
import {
  addToScene, createPbrMaterial, createTexture2DArray, disposeMeshGpu, updateTexture2DArrayFromPixels, markMaterialUboDirty, removeFromScene, setMeshVisible,
  type Mesh, type PbrMaterialProps, type SceneContext,
} from "@babylonjs/lite";
import { DRAW_ORDER, SEE_THROUGH_ORDER, createDrawOrders } from "@csarkosh/engine/game/lite/drawOrder";
import { baseColourPlugin, surfaceSplitPlugin, surfaceWetPlugin } from "@csarkosh/engine/game/lite/forestPlugins";
import { noParts, type NoPartsApi } from "@csarkosh/engine/game/lite/noParts";
import { createLeaner } from "./leanMesh.js";
import { townBlurPlugin } from "./townBlur.js";
import { packSurface } from "./surfacePack.js";
import type { RenderGame, RenderHost, RenderPlayer, RenderSide, RenderState } from "@csarkosh/engine/game/lite/renderGame";
import type { ViewFrustumPlane } from "@csarkosh/engine/game/lite/cameraPose";
import { PROP_ROUGHNESS } from "@csarkosh/engine/game/propBoxes";
import type { Slices } from "@csarkosh/engine/game/syncJobs";
import { WET_CAP } from "@csarkosh/engine/game/wetSurface";
import { townStart } from "../../sim/town/start.js";
import { createHighwayStream, type HighwayStream } from "./highwayParts.js";
import { createRailStream, type RailStream } from "./railParts.js";
import { SignAtlas } from "./signAtlas.js";
import { createPaintSurface, paintRequest } from "./signPaint.js";
import { townGeometry, townGround, type TownBatch } from "./townGeometry.js";
import { fleetOf } from "./props/vehicleFleet.js";
import { createVehicleParts, type VehicleParts } from "./props/vehicleParts.js";
import { groundAt } from "./props/kit.js";
import { createCarParts, type CarParts } from "../car/carParts.js";
import { carDebug, type CarDebug, type CarDebugSource, type LampSeen } from "../car/carDebug.js";
import { headlightsFor, litFor } from "../car/headlights.js";
import { promptShown, voiceShown } from "../car/side.js";
import { FOOT, SEATED, type Car, type Ride } from "../../sim/car/types.js";
import { townSolids } from "../../sim/town/solid.js";
import { propSolids } from "../../sim/town/propSolid.js";
import { BOX_MARGIN, PROP_THIN_HALF, PROP_TOP, boxBlocks, carBlocks, newChase, seatStep, seatTarget, stepChase, underGround } from "../car/chaseCamera.js";
import { NO_SHOT, newCine, stepCine } from "../car/cineCamera.js";
import { createViewKeys, type KeyTarget } from "../car/viewKeys.js";
import { peopleFor, personWorld } from "./people.js";
import { openDowntownUnits, outdoorPeopleFor, outdoorWorld } from "./outdoorPeople.js";
import { createPeopleShade } from "./peopleShade.js";
import { createInsideParts, hidesTown, insidePeople, whereOf, type InsideParts } from "./insideParts.js";
import type { Inside } from "../../sim/inside/rooms.js";
import { createPeopleParts, type PeopleParts, type PlacedPerson } from "./peopleParts.js";
import { newReact, nudgeOf, pairUp, stepReact, venueOfReason, venueOfTrade, type ReactPlayer, type Seen } from "./peopleReact.js";
import { captionsOf, showCaptions, type Caption } from "./speech.js";
import { cameraAxes, restAxes } from "@csarkosh/engine/game/lite/cameraPose";
import { PLAYER_HALF } from "@csarkosh/engine/sim/constants";
import { heldBy, tradeAt } from "./handHeld.js";
import { alongAt, walkCapacity, walkerJob, walkerWorld, type Walker } from "./walkers.js";
import { doorsFor, hiddenByDoor, movingDoors, type DoorBook } from "./openDoors.js";
import { standInGeometry } from "./props/vehicleStandIn.js";
import { MAX_DOORS, RANK_UNITS, emptyTownReady, knockMatrix, townSurfacePlugin, writeDoors, writeKnocked, writeLamps, type KnockMove, type TownReady } from "./townMaterial.js";
import { fallenBy, knockMoves, newKnocked, stepKnocked } from "./knocked.js";
import { MARKS_MOST, markMatrices, newStruck, rockOf, shoveMove, stepStruck, struckMoves, struckSolids } from "./struck.js";
import { createDamageParts, type DamageParts } from "./damageParts.js";
import type { CarPose } from "../car/carPose.js";
import type { Vehicle } from "../../sim/town/types.js";
import { knockablesFor } from "../../sim/town/knockables.js";
import { MAX_LAMPS, emptyLampList, fillLamps, type Lamp } from "./lampLight.js";
import { lampSites } from "./props/lamps.js";
import { daylightAt, litGainAt } from "../../look.js";
import { createTownTextures, type TownTextures } from "./townTextures.js";
import { createPackedMesh, packedBytes } from "./vertexPack.js";

/** A cell's mesh with what the view's test needs of it. */
type Made = { mesh: Mesh; layer: TownBatch["layer"]; x: number; y: number; z: number; radius: number; shown: boolean; /** The model this car stands in for, until the model's meshes are made. */ model?: string };

/**
 * How far toward the eye the flat layer is drawn, so that it lies over the terrain it is laid on: steps of a 24-bit depth buffer (the
 * engine's `ahead`). Positive: the renderer's depth runs from 1 at the near plane to 0 far away, so toward the eye is up. With it negative
 * the layer is drawn behind the terrain instead, and a surface with no cut under it (a yard's drive, a walk, a patch) is seen only from a
 * few metres (`depthLead.test.ts`).
 *
 * The slope's share of the engine's offset is not used (0). It is worked out at each vertex and drawn as the triangle's own run between
 * them, so two flat surfaces at one place get different shares of it wherever their triangles differ, by far more than a rank's step: a
 * patch of large triangles on a roadway of small ones was eaten by the roadway in a wedge that moved with the eye, and the ground was drawn
 * over the foot of a wall or a step near by. The steps alone are the same at every point of every surface, so the ranks hold.
 */
export const FLAT_AHEAD_UNITS = 120;
export const FLAT_AHEAD_SLOPE = 0;
/** Where among the see-through draws a room's haze stands: after the cars' shadows and before the lettering and the glass, which are laid over it. */
export const HAZE_ORDER = SEE_THROUGH_ORDER.lettering - 1;
/** Where the lettering stands on a tier whose glass writes its whole pixel (`townBlur.ts`): after the glass. */
export const LETTERING_OVER_GLASS = SEE_THROUGH_ORDER.glass + 1;

/** The state of a game that has no cars. */
const NO_CARS: readonly Car[] = [];
const NO_POSES: readonly CarPose[] = [];

/** What a measuring tool may read of the town's people (`globalThis.__capePeople`, while the town's part lives). */
export type PeopleDebug = {
  /** Everyone drawn at the last frame, where their schedule has them. */
  seen(): Seen[];
  /** The lines being said now. */
  said(): { key: number; text: string; x: number; y: number; z: number; age: number; life: number; kind: string }[];
  /** How far a person is moved off their schedule now (`peopleReact.ts`), or null for one who is not. */
  moved(key: number): { dx: number; dy: number; dz: number; yaw: number; lx: number; lz: number; lean: number } | null;
  /** Makes a person react as if a car came at them from behind (`car`) or someone walked into their back (`walker`), by the frame's own rules: for looking at a reaction without driving at anyone. Answers whether they did. */
  provoke(key: number, what: "car" | "walker"): boolean;
};

/** How far the hour moves before the materials are written again (a hundredth of an hour). */
const HOUR_STEP = 0.01;
/** Where the dark at the walls' feet stands (`footShade.ts`): over the water, before the cars' shadows and everything laid over the ground after them. */
export const SHADE_ORDER = SEE_THROUGH_ORDER.carShadow - 1;
/** The dark at the walls' feet is drawn this many depth steps ahead of where it lies: past the flat ground's own (`FLAT_AHEAD_UNITS`) and its highest rank's, which it lies over. */
export const SHADE_AHEAD_UNITS = FLAT_AHEAD_UNITS + 16 * RANK_UNITS;
/** How far the eye moves before the lamp list is chosen again, metres. */
const LAMP_EYE_STEP = 0.25;
/** The lamps the low tier is lit by (a loop of twelve in each fragment, not twenty-four). */
const LOW_LAMPS = 12;

/** How long a slice of the walkers' making runs before the frame is given back (milliseconds). */
const WALK_SLICE_MS = 4;

/** Takes out of `list`, in place and keeping its order, each stand-in whose model `ready` says is made, and hands it to `drop` once. A stand-in of a model that is not ready (its file still loading, or failed) stays. */
export function retireStandIns<T extends { model?: string }>(list: T[], ready: (model: string) => boolean, drop: (m: T) => void): void {
  let kept = -1;
  for (let i = 0; i < list.length; i++) {
    const m = list[i] as T;
    if (m.model !== undefined && ready(m.model)) {
      if (kept < 0) kept = i;
      drop(m);
    } else if (kept >= 0) list[kept++] = m;
  }
  if (kept >= 0) list.length = kept;
}

/** The bounding sphere of a batch's positions: the middle of its box and half the box's diagonal. */
export function boundsOf(positions: Float32Array): { x: number; y: number; z: number; radius: number } {
  const lo = [Infinity, Infinity, Infinity];
  const hi = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < positions.length; i += 3) {
    for (let a = 0; a < 3; a++) {
      const p = positions[i + a] as number;
      if (p < (lo[a] as number)) lo[a] = p;
      if (p > (hi[a] as number)) hi[a] = p;
    }
  }
  const x = ((lo[0] as number) + (hi[0] as number)) / 2;
  const y = ((lo[1] as number) + (hi[1] as number)) / 2;
  const z = ((lo[2] as number) + (hi[2] as number)) / 2;
  const dx = (hi[0] as number) - (lo[0] as number);
  const dy = (hi[1] as number) - (lo[1] as number);
  const dz = (hi[2] as number) - (lo[2] as number);
  return { x, y, z, radius: Math.sqrt(dx * dx + dy * dy + dz * dz) / 2 };
}

function inView(planes: readonly ViewFrustumPlane[], m: Made): boolean {
  for (const plane of planes) {
    if (plane.normal.x * m.x + plane.normal.y * m.y + plane.normal.z * m.z + plane.d <= -m.radius) return false;
  }
  return true;
}

export const townParts: RenderGame<RenderState<RenderPlayer>, RenderPlayer, NoPartsApi> = (host: RenderHost) => {
  const base = noParts(host);
  const made: Made[] = [];
  // The meshes whose arrays the GPU has not yet all taken (`leanMesh.ts`).
  const leaner = createLeaner();
  const owner = {};
  let disposed = false;
  let building = false;
  let left = 0;
  let hardCover: { add(mesh: Mesh): void; remove(mesh: Mesh): void } | undefined;
  let standing: SceneContext | null = null;
  let seed: Mesh | null = null;
  let seedScene: SceneContext | null = null;
  // The textures' arrays and the loads that fill them; the materials that read them.
  let textures: TownTextures | null = null;
  const loading = new AbortController();
  const textured: PbrMaterialProps[] = [];
  // The railroad and the power line, streamed along the coast by the camera's place (`railParts.ts`).
  let rail: RailStream | null = null;
  // The highway outside the town's strip, streamed the same way (`highwayParts.ts`).
  let highway: HighwayStream | null = null;
  // The parked vehicles that stand as real models (`props/vehicleParts.ts`), on the tiers above low: loaded once the town's geometry is made.
  let vehicles: VehicleParts | null = null;
  // The car the players drive (`../car/carParts.ts`): made with the town, loaded once it stands, posed from the state's cars each frame.
  let car: CarParts | null = null;
  // The state the last frame was handed, for the console's reading of the car (`__capeCar`).
  const held: NonNullable<ReturnType<CarDebugSource["state"]>> = { cars: NO_CARS, localId: 0, players: new Map() };
  let holding = false;
  // The chase camera (`../car/chaseCamera.ts`): its state, the eye it eases from, the shot it answers, and what the console reads. The chase is new
  // for each world (this part is made again) and starts over whenever the player is on foot or rides another car; a car that jumps is snapped to.
  const chase = newChase();
  const chaseEye = { x: 0, y: 0, z: 0, yaw: 0, pitch: 0, roll: 0 };
  const chaseLook = { yaw: 0, pitch: 0, behind: false };
  const chaseShot = { fov: 0 as number | null, centre: { x: 0, z: 0 }, coverAtEye: false };
  const chaseSeen = { x: 0, y: 0, z: 0, yaw: 0, pitch: 0, fov: 0, seated: 0, pulled: 0, shot: NO_SHOT };
  // The view's own keys (`../car/viewKeys.ts`): C looks behind, V is the cinematic view (`../car/cineCamera.ts`), which is cut to and from and
  // is the seated player's only: on foot it is off again. The chase is stepped under it all the while, so the view comes back to a camera
  // that is already behind the car.
  const viewKeys = createViewKeys(typeof window === "undefined" ? null : (window as unknown as KeyTarget), () => typeof document !== "undefined" && document.pointerLockElement !== null);
  const cine = newCine();
  let cineOn = false;
  const cinePose = { x: 0, y: 0, z: 0, yaw: 0, pitch: 0, roll: 0 };
  let chasing = false;
  // The one lamp as the last frame wrote it, for the console's reading (`__capeCar.lamp()`).
  const lampSeen: LampSeen = { on: false, x: 0, y: 0, z: 0, dx: 0, dy: 0, dz: 1, angle: 0, range: 0, intensity: 0, r: 0, g: 0, b: 0 };
  let lampWritten = false;
  // How far into the seat the camera is shown: the ride's own value followed at a bounded rate, so a refused leave eases back out.
  let shownSeat = 0;
  let chasedCar = 0;
  let lastSeconds = -1;
  let drawnGround: ((x: number, z: number) => number) | null = null;
  let worldSeed = 0;
  // Whether a point stands in the way of the camera (`chaseCamera.ts`): the drawn ground, a building's footprint (the plan carries no height for it, so a column), a prop's
  // box that is not thin (smaller half-extent at least `PROP_THIN_HALF`) and lower than `PROP_TOP` over the ground there, or another car. One cell of each grid, nothing allocated.
  const blocked = (x: number, y: number, z: number): boolean => {
    if (boxBlocks(townSolids(worldSeed), x, y, z, 0, Infinity, BOX_MARGIN)) return true;
    if (drawnGround !== null && underGround(drawnGround, x, y, z)) return true;
    if (drawnGround !== null && boxBlocks(propSolids(worldSeed), x, y, z, PROP_THIN_HALF, drawnGround(x, z) + PROP_TOP, BOX_MARGIN)) return true;
    return carBlocks(held.cars, chasedCar, x, y, z);
  };
  // The room a player walks into, built while the local player is in it (`insideParts.ts`), and where the local player is by the rooms as the last frame said.
  let inside: InsideParts | null = null;
  let whereNow = 0;
  let townHidden = false;
  // The people standing in the open shops (`peopleParts.ts`): loaded with the vehicles, once the town is made, and drawn when near.
  let people: PeopleParts | null = null;
  // The people who walk are made a few milliseconds at a time once the town stands, and shown when they are done (`walkerJob`).
  let walkerList: readonly Walker[] | null = null;
  // The doors the walkers open (`openDoors.ts`), made with the walkers, and whether any was written moving last frame.
  let doors: DoorBook | null = null;
  let doorsMoving = false;
  /** Writes the doors that are open now, at the hour the people are drawn at, as the vertex stage's uniforms (the ten nearest the eye if more are moving). */
  const moveDoors = (): void => {
    if (doors === null || ready === null || people === null) return;
    const moving = movingDoors(doors, people.hourNow());
    if (moving.length === 0 && !doorsMoving) return;
    const eye = host.pose;
    const near = (m: (typeof moving)[number]): number => (m.hx - eye.x) * (m.hx - eye.x) + (m.hz - eye.z) * (m.hz - eye.z);
    const list = moving.length > MAX_DOORS ? [...moving].sort((p, q) => near(p) - near(q)).slice(0, MAX_DOORS) : moving;
    writeDoors(ready, list);
    doorsMoving = list.length > 0;
    for (const m of textured) markMaterialUboDirty(m);
  };
  // The hour of day last written to the materials (12 until a frame says otherwise), and their record.
  let shownHour = 12;
  // What the cars have knocked down and is not standing now (`knocked.ts`), what they have struck that does not give way (`struck.ts`: the marks left
  // and the things shoved), the cars both are worked out from, and whether anything was written moved last frame.
  const knocked = newKnocked();
  const struck = newStruck();
  const knockCars: CarPose[] = [];
  const knockList: KnockMove[] = [];
  let knockedDown = false;
  // The marks of damage, drawn (`damageParts.ts`), and the parked vehicles drawn moved as models last frame, to be put back when their shove is over.
  let damage: DamageParts | null = null;
  const markBuffer = new Float32Array(MARKS_MOST * 16);
  const shoveMatrix = new Float32Array(16);
  let movedModels: Vehicle[] = [];
  let movedNow: Vehicle[] = [];
  /** The things the frame's cars run into go down or are shoved and marked, the ones whose time is up are put back, and the vertex stage, the vehicles' models and the marks are told. */
  const layDown = (cars: readonly Car[], dt: number): void => {
    if (ready === null || drawnGround === null || car === null) return;
    knockCars.length = 0;
    for (const c of cars) {
      const p = car.pose(c.id);
      if (p !== null) knockCars.push(p);
    }
    const ground = drawnGround;
    const solids = struckSolids(worldSeed);
    stepKnocked(knocked, knockablesFor(worldSeed), knockCars, dt, (k) => ground(k.x, k.z));
    stepStruck(struck, solids, knockCars, dt);
    // A parked vehicle that is a model is moved by its own matrix; one that is part of the town's batches, and a dumpster, by the vertex stage.
    movedNow.length = 0;
    for (const s of struck.shoves) {
      const solid = solids[s.solid];
      if (solid === undefined || solid.vehicle === null || vehicles === null) continue;
      vehicles.moved(solid.vehicle, knockMatrix(shoveMove(s, solid), shoveMatrix));
      movedNow.push(solid.vehicle);
    }
    for (const v of movedModels) if (!movedNow.includes(v)) vehicles?.moved(v, null);
    const spare = movedModels;
    movedModels = movedNow;
    movedNow = spare;
    damage?.frame(markBuffer, markMatrices(struck, solids, markBuffer));
    const moving = knocked.list.length > 0 || struck.shoves.length > 0;
    if (!moving && !knockedDown) return;
    knockList.length = 0;
    writeKnocked(ready, struckMoves(struck, solids, knockMoves(knocked, knockList)));
    knockedDown = moving;
    for (const m of textured) markMaterialUboDirty(m);
  };
  // How the people answer the player (`peopleReact.ts`): who is drawn, the local player, what each says, and the view the captions are placed on.
  const react = newReact();
  const seen: Seen[] = [];
  const captions: Caption[] = [];
  const speechAxes = restAxes();
  const reactPlayer = { x: 0, y: 0, z: 0, vx: 0, vz: 0, onFoot: true };
  /** Whether a place is in a building or a thing that stands: nobody jumps or is knocked into one. */
  const standBlocked = (x: number, z: number): boolean =>
    boxBlocks(townSolids(worldSeed), x, 0, z, 0, Infinity, 0.25) || boxBlocks(propSolids(worldSeed), x, 0, z, 0, Infinity, 0.25);
  const nowhereBlocked = (): boolean => false;
  /** The people drawn answer the cars and the local player: a jump from a car, a step back from a shove, a greeting, a word between two. */
  const answer = (state: { readonly players: ReadonlyMap<number, unknown> }, localId: number, dt: number): void => {
    if (people === null) return;
    seen.length = 0;
    people.each((p) => seen.push(p));
    const me = state.players.get(localId) as { pos: { x: number; y: number; z: number }; vel: { x: number; y: number; z: number }; ride?: Ride } | undefined;
    let player: ReactPlayer | null = null;
    if (me !== undefined) {
      reactPlayer.x = me.pos.x;
      reactPlayer.y = me.pos.y - PLAYER_HALF.y;
      reactPlayer.z = me.pos.z;
      reactPlayer.vx = me.vel.x;
      reactPlayer.vz = me.vel.z;
      reactPlayer.onFoot = me.ride === undefined || me.ride.phase === FOOT;
      player = reactPlayer;
    }
    // In a room the town's walls are not the room's: nobody is held out of them there.
    stepReact(react, seen, whereNow === 0 ? knockCars : NO_POSES, player, dt, shownHour, whereNow === 0 ? standBlocked : nowhereBlocked);
  };
  let ready: TownReady | null = null;
  // Every lamp the town has (once the town's plan is known), the nearest lit ones to the eye as the materials were last written, and where the eye and the hour then were.
  let lamps: readonly Lamp[] = [];
  const lampList = emptyLampList();
  let lampEye = { x: Infinity, y: 0, z: 0 };
  let lampHour = -1;
  let lampsLit = false;
  let lampMax = MAX_LAMPS;

  const side: RenderSide<RenderState<RenderPlayer>, RenderPlayer> = {
    ...base.side,
    // The shops' glass reads the frame the opaque draws left, to show each room out of focus (`townBlur.ts`): the medium and low tiers keep it too (the low tier's scene pass is broken by the engine's renderer, `lite/renderer.ts`).
    keepsFrame: true,

    // The renderer hands the hour of day with the view each frame (the console's `time`): the town's shaders and its people follow it.
    wildlife: {
      ...base.side.wildlife,
      look(state, x, y, z, yaw, pitch, fov, aspect, hour, mist) {
        base.side.wildlife.look(state, x, y, z, yaw, pitch, fov, aspect, hour, mist);
        // What the people are saying, placed on this frame's view for the HUD (`speech.ts`).
        showCaptions(captionsOf(react.said, x, y, z, cameraAxes(yaw, pitch, 0, speechAxes), fov, aspect, captions));
        const moved = Math.abs(hour - shownHour) > HOUR_STEP;
        if (moved) {
          shownHour = hour;
          if (ready !== null) {
            ready.townHour[0] = hour;
            ready.townGlow[0] = litGainAt(hour);
            ready.townDay[0] = daylightAt(hour);
            for (const m of textured) markMaterialUboDirty(m);
          }
          people?.setHour(hour);
        }
        // The lamps' light: the nearest lit lamps to the eye, written when the eye or the hour has moved (and not at all through the day, when no lamp is lit).
        if (ready !== null && lamps.length > 0) {
          const near = (x - lampEye.x) * (x - lampEye.x) + (z - lampEye.z) * (z - lampEye.z) + (y - lampEye.y) * (y - lampEye.y) < LAMP_EYE_STEP * LAMP_EYE_STEP;
          if (!near || Math.abs(hour - lampHour) > HOUR_STEP) {
            lampEye = { x, y, z };
            lampHour = hour;
            fillLamps(lamps, x, y, z, hour, lampList, lampMax);
            if (lampList.count > 0 || lampsLit) {
              lampsLit = lampList.count > 0;
              writeLamps(ready, lampList);
              people?.setLamps(lampList, litGainAt(hour));
              for (const m of textured) markMaterialUboDirty(m);
            }
          }
        }
      },
    },

    early({ engine, scene }) {
      // Lite builds the PBR pipelines of a scene's meshes by the build made when the scene is registered, and that build knows
      // vertex colours only if a mesh of the scene had them then (the engine's lake panorama does the same): so one mesh that
      // is never shown stands in the scene from the start with a colour a vertex, a triangle of no size.
      seed = createPackedMesh(engine, "town_colour_seed", {
        positions: new Float32Array(9), normals: new Float32Array([0, 1, 0, 0, 1, 0, 0, 1, 0]), indices: new Uint32Array([0, 1, 2]), uvs: undefined, colors: new Float32Array(12).fill(1),
      });
      seed.material = createPbrMaterial({ baseColorFactor: [1, 1, 1, 1], metallicFactor: 0, roughnessFactor: PROP_ROUGHNESS });
      setMeshVisible(seed, false);
      addToScene(scene, seed);
      seedScene = scene;
    },

    late({ engine, scene, shared, air, wetAt, ahead, skinClock, hardCover: cover, behind }) {
      const forest = host.forest;
      if (forest === null) return;
      hardCover = cover;
      standing = scene;
      const wet = wetAt(WET_CAP.prop);
      const orders = createDrawOrders(DRAW_ORDER.scenery);
      const low = host.tier === "low";
      ready = emptyTownReady();
      ready.townHour[0] = shownHour;
      ready.townGlow[0] = litGainAt(shownHour);
      ready.townDay[0] = daylightAt(shownHour);
      const readied = ready;
      try {
        textures = createTownTextures(engine, low, loading.signal, (filled) => {
          if (!filled || disposed) return;
          readied.townReady[0] = 1;
          for (const m of textured) markMaterialUboDirty(m);
        });
      } catch (error) {
        // The arrays could not be made (no device to make them on): the town stays flat colour, as it was.
        console.warn("the town's texture arrays could not be made; the town stays flat colour:", error);
        textures = null;
      }
      const material = (flat: boolean, wearsTextures: boolean): PbrMaterialProps => {
        // The vertex colours carry the colour (or the paint the textures are multiplied by): the material's own is white.
        const m = createPbrMaterial({ baseColorFactor: [1, 1, 1, 1], metallicFactor: 0, roughnessFactor: PROP_ROUGHNESS, usePhysicalLightFalloff: true });
        m.plugins = [
          baseColourPlugin(), ...(wearsTextures && textures !== null ? [townSurfacePlugin(textures, readied, low, undefined, flat)] : []),
          surfaceWetPlugin(wet, shared), ...(flat ? [ahead(FLAT_AHEAD_UNITS, FLAT_AHEAD_SLOPE)] : []), air(),
        ];
        orders.take(m);
        if (wearsTextures) textured.push(m);
        return m;
      };
      // The town's own draw before the railroad's, so where a crossing's panel lies flush with a street the panel is drawn last.
      const wearsTextures = textures !== null;
      // Whether the rooms are seen through their glass out of focus: the frame behind the glass is kept, and the glass has its plugin.
      const through = behind !== undefined && wearsTextures;
      const town = { flat: material(true, wearsTextures), solid: material(false, wearsTextures) };
      // The material of the room a player walks into: the town's solid one with no wet look (a floor indoors is not wet with the rain; the split of the colour that the wet look ends with is kept). It keeps the air, which also carries the display curve and the grade of the tiers with no post chain.
      const indoor = createPbrMaterial({ baseColorFactor: [1, 1, 1, 1], metallicFactor: 0, roughnessFactor: PROP_ROUGHNESS, usePhysicalLightFalloff: true });
      indoor.plugins = [baseColourPlugin(), ...(wearsTextures && textures !== null ? [townSurfacePlugin(textures, readied, low, undefined, false)] : []), surfaceSplitPlugin(), air()];
      orders.take(indoor);
      if (wearsTextures) textured.push(indoor);
      // The glass: blended over what is behind it (the rooms), after every opaque draw, with the town's plugin for the sky's reflection. It needs the plugin, so without the textures' arrays there is no glass drawn (the openings show their rooms).
      const glassMaterial = (): PbrMaterialProps => {
        const m = createPbrMaterial({ baseColorFactor: [1, 1, 1, 1], metallicFactor: 0, roughnessFactor: 0.1, alphaBlend: true, usePhysicalLightFalloff: true });
        m.plugins = [baseColourPlugin(), ...(textures !== null ? [townSurfacePlugin(textures, readied, low)] : []), air()];
        if (textures !== null) textured.push(m);
        return m;
      };
      // The glass of a shop's pane where the frame behind the glass is kept (`townBlur.ts`): the same, opaque. It reads its room from the kept frame, out of focus, and writes the whole pixel, its own depth,
      // and in the frame's alpha how much of the lines behind it it hides, which the engine's line reads (`look.ts`, `lineThrough`).
      const throughMaterial = (): PbrMaterialProps | null => {
        if (!through || behind === undefined || textures === null) return null;
        const m = createPbrMaterial({ baseColorFactor: [1, 1, 1, 1], metallicFactor: 0, roughnessFactor: 0.1, usePhysicalLightFalloff: true });
        m.plugins = [baseColourPlugin(), townSurfacePlugin(textures, readied, low), townBlurPlugin(behind, shared, low), air()];
        orders.take(m);
        textured.push(m);
        return m;
      };
      // The lettering's atlas (`signAtlas.ts`): planned while the town is built, made at the height its rows reach once every sign is placed, and painted then.
      const atlas = new SignAtlas(low ? 2048 : 4096, low ? 1024 : 2048, low ? 36 : 56);
      let atlasTexture: ReturnType<typeof createTexture2DArray> | null = null;
      const signMaterial = (tex: NonNullable<typeof atlasTexture>): PbrMaterialProps => {
        const m = createPbrMaterial({ baseColorFactor: [1, 1, 1, 1], metallicFactor: 0, roughnessFactor: 0.7, alphaBlend: true, usePhysicalLightFalloff: true });
        m.plugins = [baseColourPlugin(), townSurfacePlugin(textures as NonNullable<typeof textures>, readied, low, tex), air()];
        textured.push(m);
        return m;
      };
      // The dark at the walls' feet (`footShade.ts`): the glass's material, which reads a sheet by its seed, drawn ahead of the flat ground it lies over.
      const shadeMaterial = (): PbrMaterialProps => {
        const m = createPbrMaterial({ baseColorFactor: [1, 1, 1, 1], metallicFactor: 0, roughnessFactor: 1, alphaBlend: true, usePhysicalLightFalloff: true });
        m.plugins = [baseColourPlugin(), ...(textures !== null ? [townSurfacePlugin(textures, readied, low)] : []), ahead(SHADE_AHEAD_UNITS, 0), air()];
        if (textures !== null) textured.push(m);
        return m;
      };
      const seeThrough = wearsTextures ? { glass: glassMaterial(), through: throughMaterial(), sign: null as PbrMaterialProps | null, shade: low ? null : shadeMaterial() } : null;
      // The railroad's own materials (its draw order is its own, after the town's), reading the same texture layers and wear.
      const materials = { flat: material(true, wearsTextures), solid: material(false, wearsTextures) };
      worldSeed = forest.seed;
      const start = townStart(worldSeed);
      const railDraw = { engine, scene, materials, textured: wearsTextures, orders: { flat: orders.of(materials.flat) ?? DRAW_ORDER.scenery, solid: orders.of(materials.solid) ?? DRAW_ORDER.scenery } };
      rail = createRailStream(host, railDraw, worldSeed);
      // The highway's cells share the railroad's flat material (the town's own, with the depth lead of the flat ground) and its draw order.
      highway = createHighwayStream(host, railDraw, worldSeed, low);

      const ground = townGround(worldSeed);
      drawnGround = (x, z) => groundAt(ground, x, z);
      const fleet = low ? [] : fleetOf(ground, "full");
      if (!low) {
        vehicles = createVehicleParts({ engine, scene, shared, air, wet, jobs: host.jobs, eye: host.pose, uploaded: (bytes) => host.uploads.count("geometry", bytes, 4) }, fleet);
      }

      car = createCarParts({ engine, scene, shared, air, wet, jobs: host.jobs, eye: host.pose, uploaded: (bytes) => host.uploads.count("geometry", bytes, 4), groundAt: (x, z) => groundAt(ground, x, z), ahead });
      damage = createDamageParts({ engine, scene, air, ahead });
      (globalThis as { __capeCar?: CarDebug }).__capeCar = carDebug({ state: () => (holding ? held : null), pose: (id) => car?.pose(id) ?? null, camera: () => (chasing ? chaseSeen : null), prompt: promptShown, sound: voiceShown, lamp: () => (lampWritten ? lampSeen : null), knocked: () => knocked.list.map((d) => ({ id: d.id, kind: d.kind, x: d.x, z: d.z, angle: fallenBy(d), age: d.age })), struck: () => ({ hits: struck.hits, marks: struck.marks.map((m) => ({ solid: m.solid, x: m.x, y: m.y, z: m.z, size: m.size, age: m.age })), shoves: struck.shoves.map((q) => ({ solid: q.solid, kind: struckSolids(worldSeed)[q.solid]?.kind ?? "", sx: q.sx, sz: q.sz, angle: rockOf(q), since: q.since })) }) });
      // What a measuring tool may read of the people: who is drawn (where their schedule has them), what is being said, and how far a person is moved off their schedule. Copies.
      (globalThis as { __capePeople?: PeopleDebug }).__capePeople = {
        seen: () => seen.map((p) => ({ ...p })),
        said: () => react.said.map((q) => ({ ...q })),
        moved(key) {
          const n = { dx: 0, dy: 0, dz: 0, yaw: 0, lx: 1, lz: 0, lean: 0 };
          return nudgeOf(react, key, 0, n) ? n : null;
        },
        provoke(key, what) {
          const p = seen.find((q) => q.key === key);
          if (p === undefined) return false;
          // The same rules as a frame's, with a car or a walker made up for the purpose: a car coming at them from behind, or someone walking into their back.
          const bx = -Math.sin(p.yaw);
          const bz = -Math.cos(p.yaw);
          const before = react.said.length;
          // (One in a room is taken to be in the open for it: there is no other way to look at a jump up close.)
          if (what === "car") stepReact(react, seen.map((q) => (q.key === key ? { ...q, sheltered: false } : q)), [{ x: p.x + bx * 5 + bz * 0.3, z: p.z + bz * 5 - bx * 0.3, hx: -bx, hz: -bz, speed: 9, slip: 0 }], null, 0, shownHour, whereNow === 0 ? standBlocked : nowhereBlocked);
          else stepReact(react, seen, NO_POSES, { x: p.x + bx * 0.45, y: p.y, z: p.z + bz * 0.45, vx: -bx * 1.4, vz: -bz * 1.4, onFoot: true }, 0, shownHour, whereNow === 0 ? standBlocked : nowhereBlocked);
          return react.said.length > before || nudgeOf(react, key, 0, { dx: 0, dy: 0, dz: 0, yaw: 0, lx: 1, lz: 0, lean: 0 });
        },
      };
      const plan = ground.plan;
      inside = createInsideParts({ engine, scene, material: indoor, order: orders.of(indoor) ?? DRAW_ORDER.scenery, textured: wearsTextures, ground, detail: low ? "low" : "full", uploads: host.uploads });
      lamps = lampSites(ground);
      lampMax = low ? LOW_LAMPS : MAX_LAMPS;
      const roomers = peopleFor(plan);
      const outside = outdoorPeopleFor(plan, ground.anchor);
      const placedBare: PlacedPerson[] = [
        ...roomers.map((person) => ({ person, at: personWorld(ground, plan, person), hours: person.hours, outdoor: false, held: heldBy(person.activity, tradeAt(plan, person.building, person.unit)), venue: venueOfTrade(tradeAt(plan, person.building, person.unit)) })),
        // Two who stand together outside are each other's partner, by their places in this list.
        ...outside.map((person) => ({ person, at: outdoorWorld(ground, person), hours: person.hours, outdoor: true, held: heldBy(person.activity, tradeAt(plan, person.building, person.unit)), venue: venueOfReason(person.reason), ...(person.partner < 0 ? {} : { partner: roomers.length + person.partner }) })),
        // The copies of the three rooms' people in the hidden rooms, shown only to a player in that room.
        ...insidePeople(ground),
      ];
      // In a room, two near each other are together (`pairUp`): the ones at one table, side by side at the bar.
      const together = pairUp(placedBare.map((p, i) => ({ x: p.at.x, z: p.at.z, group: p.outdoor ? `o${i}` : `${p.room ?? 0}:${Math.round(p.at.y * 4)}:${(p.person as { building?: number }).building ?? -1}:${(p.person as { unit?: number }).unit ?? -1}` })));
      // A room's people talk of what the room is (its copy's as the room's own do).
      const venued = (p: PlacedPerson): PlacedPerson => {
        if (p.venue !== undefined) return p;
        const of = p.person as { building?: number; unit?: number };
        return of.building === undefined || of.unit === undefined ? p : { ...p, venue: venueOfTrade(tradeAt(plan, of.building, of.unit)) };
      };
      const placed = placedBare.map((p, i): PlacedPerson => venued(p.outdoor || (together[i] as number) < 0 ? p : { ...p, partner: together[i] as number }));
      const walkCap = walkCapacity(openDowntownUnits(plan));
      // The soft dark under each person shown (`peopleShade.ts`): one draw, written by the people's part with the set it shows and each frame for the walkers; not on the low tier.
      const shade = low ? undefined : createPeopleShade({ engine, scene, air, ahead, aheadUnits: SHADE_AHEAD_UNITS, order: SHADE_ORDER + 0.5 }, placed.length + walkCap);
      people = createPeopleParts(
        { engine, scene, air, clock: skinClock, uploads: host.uploads, eye: host.pose, low, ...(shade === undefined ? {} : { shade }) },
        placed,
        { cap: walkCap, get: () => walkerList, at: (w, hour) => {
          const along = alongAt(w, hour);
          return along >= 0 && doors !== null && hiddenByDoor(doors, w, along, hour) ? null : walkerWorld(ground, w, hour);
        },
        },
      );
      people.setHour(shownHour);
      people.setInside(whereNow);
      people.setNudge((key, yaw, out) => nudgeOf(react, key, yaw, out));
      {
        const job = walkerJob(plan, ground.anchor);
        const slice = (): void => {
          if (disposed) return;
          const until = performance.now() + WALK_SLICE_MS;
          while (performance.now() < until) {
            const step = job.next();
            if (step.done === true) {
              walkerList = step.value;
              doors = low ? null : doorsFor(plan, ground.anchor, walkerList);
              return;
            }
          }
          setTimeout(slice, 0);
        };
        setTimeout(slice, 0);
      }

      // The paint surface and its pixels are this function's alone: they are let go when it returns.
      function* paintAtlas(texture: NonNullable<typeof atlasTexture>): Slices {
        const surface = createPaintSurface(atlas.width, atlas.fittedHeight);
        if (surface === null) return;
        for (let k = 0; k < atlas.requests.length; k++) {
          paintRequest(surface, atlas.requests[k] as (typeof atlas.requests)[number]);
          if (k % 24 === 23) yield;
        }
        const px = surface.ctx.getImageData(0, 0, atlas.width, atlas.fittedHeight);
        updateTexture2DArrayFromPixels(engine, texture, new Uint8Array(px.data.buffer));
        host.uploads.count("textures", px.data.byteLength, 4);
      }

      function* build(): Slices {
        const batches: TownBatch[] = yield* townGeometry(ground, host.tier === "low" ? "low" : "full", start, atlas, through);
        // A code-built car for each model vehicle until its model lands (and for good where its file fails): made first, so they stand with the town's first cells.
        if (fleet.length > 0) batches.unshift(...(yield* standInGeometry(ground, fleet)));
        // The atlas is as tall as its signs reach (the sign batches' UV are already in its terms); made, painted a few signs a slice and uploaded once.
        if (seeThrough !== null) {
          try {
            atlasTexture = createTexture2DArray(engine, atlas.width, atlas.fittedHeight, 1, { mipMaps: true, srgb: true });
          } catch (error) {
            console.warn("the town's lettering atlas could not be made; its signs are not drawn:", error);
          }
          if (atlasTexture !== null) {
            seeThrough.sign = signMaterial(atlasTexture);
            yield* paintAtlas(atlasTexture);
          }
        }
        left = batches.length;
        for (const batch of batches) {
          if (disposed) return;
          const a = batch.arrays;
          if (((batch.layer === "glass" || batch.layer === "haze") && seeThrough === null) || (batch.layer === "through" && (seeThrough === null || seeThrough.through === null)) || (batch.layer === "sign" && (seeThrough === null || seeThrough.sign === null)) || (batch.layer === "shade" && (seeThrough === null || seeThrough.shade === null))) {
            left--;
            continue;
          }
          const mesh = createPackedMesh(engine, `town_${batch.layer}_${batch.cx}_${batch.cz}`, a);
          if (wearsTextures) mesh.pluginVertexData = packSurface(a.surface);
          if (batch.layer === "shade") {
            mesh.material = (seeThrough as NonNullable<typeof seeThrough>).shade as PbrMaterialProps;
            mesh.renderOrder = SHADE_ORDER;
          } else if (batch.layer === "through") {
            // A marked pane is an opaque draw, first in the half of the frame after the break: it writes its own depth and the whole pixel (`townBlur.ts`).
            const own = (seeThrough as NonNullable<typeof seeThrough>).through as PbrMaterialProps;
            mesh.material = own;
            mesh.renderOrder = orders.of(own) ?? DRAW_ORDER.scenery;
            mesh.afterBreak = true;
          } else if (batch.layer === "glass" || batch.layer === "sign" || batch.layer === "haze") {
            // A blended mesh stands at the world's origin among the see-through draws (`drawOrder.ts`); its place says where in them.
            const set = seeThrough as NonNullable<typeof seeThrough>;
            // A room's haze is the glass's material (its sheets say what they are), drawn before the lettering and the glass, which are laid over it.
            mesh.material = batch.layer === "sign" ? (set.sign as PbrMaterialProps) : set.glass;
            // Where a pane reads the frame behind it, it is drawn in the half after the break and writes its whole pixel (its layer above): the lettering is
            // then drawn after the glass, not before it, and stands in front of the pane's depth.
            mesh.renderOrder = batch.layer === "glass" ? SEE_THROUGH_ORDER.glass : batch.layer === "sign" ? (through ? LETTERING_OVER_GLASS : SEE_THROUGH_ORDER.lettering) : HAZE_ORDER;
          } else {
            mesh.material = town[batch.layer];
            mesh.renderOrder = orders.of(town[batch.layer]) ?? DRAW_ORDER.scenery;
          }
          addToScene(scene, mesh);
          host.uploads.count("geometry", packedBytes(a.positions.length / 3, a.indices.length, a.surface.byteLength), 4);
          host.uploads.made();
          if (batch.layer === "solid") hardCover?.add(mesh);
          made.push({ mesh, layer: batch.layer, ...boundsOf(a.positions), shown: true, ...(batch.model === undefined ? {} : { model: batch.model }) });
          leaner.add(mesh);
          left--;
          yield;
        }
        building = false;
        // The town stands; now the vehicles' files are asked for, and each lands when it has.
        vehicles?.begin();
        car?.begin();
        people?.begin();
      }

      building = true;
      host.jobs.begin(owner, build(), false, "town");
    },

    begin(state, localId, alpha, dt) {
      base.side.begin(state, localId, alpha, dt);
      held.cars = (state as { cars?: readonly Car[] }).cars ?? NO_CARS;
      held.localId = localId;
      held.players = state.players as unknown as typeof held.players;
      holding = true;
      const me = state.players.get(localId) as { ride?: Ride } | undefined;
      const driven = me?.ride?.phase === SEATED && me.ride.seat === 0 ? me.ride.car : 0;
      car?.frame((state as { cars?: readonly Car[] }).cars ?? NO_CARS, state.tick, alpha, dt, driven);
      layDown(held.cars, dt);
      // Where the local player is by the rooms: the room is built or let go, the people and the town follow.
      const by = (me as { inside?: Inside } | undefined)?.inside;
      inside?.frame(by);
      whereNow = whereOf(by);
      townHidden = hidesTown(by);
      people?.setInside(whereNow);
      answer(state, localId, dt);
    },

    shot(seconds, pose, local, state, localId, alpha) {
      const dt = lastSeconds < 0 ? 0 : seconds - lastSeconds;
      lastSeconds = seconds;
      const ride = (local as { ride?: Ride }).ride;
      const drawn = ride !== undefined && ride.phase !== FOOT && drawnGround !== null ? (car?.pose(ride.car) ?? null) : null;
      if (ride === undefined || drawn === null || drawnGround === null) {
        chase.started = false;
        chasing = false;
        shownSeat = 0;
        viewKeys.cineOff();
        cineOn = false;
        return base.side.shot(seconds, pose, local, state, localId, alpha);
      }
      if (ride.car !== chasedCar) chase.started = false;
      chasedCar = ride.car;
      shownSeat = seatStep(shownSeat, seatTarget(ride.phase, ride.ticks), dt);
      const seated = shownSeat;
      Object.assign(chaseEye, pose);
      chaseLook.yaw = local.yaw;
      chaseLook.pitch = local.pitch;
      chaseLook.behind = viewKeys.behind();
      const widen = stepChase(chase, drawn, chaseLook, seated, dt, blocked, drawnGround, chaseEye, pose);
      chaseShot.fov = host.lens.fov + widen;
      // The cinematic view, for a player who is in the seat: it begins with a cut and ends with one.
      const wasCine = cineOn;
      cineOn = viewKeys.cine() && ride.phase === SEATED && seated >= 1;
      if (cineOn) {
        if (!wasCine) cine.shot = NO_SHOT;
        chaseShot.fov = stepCine(cine, drawn, dt, blocked, drawnGround, cinePose);
        Object.assign(pose, cinePose);
      } else if (ride.phase !== SEATED) {
        viewKeys.cineOff();
      }
      chaseSeen.shot = cineOn ? cine.shot : NO_SHOT;
      chaseShot.centre.x = drawn.x;
      chaseShot.centre.z = drawn.z;
      chasing = true;
      chaseSeen.x = pose.x;
      chaseSeen.y = pose.y;
      chaseSeen.z = pose.z;
      chaseSeen.yaw = pose.yaw;
      chaseSeen.pitch = pose.pitch;
      chaseSeen.fov = chaseShot.fov;
      chaseSeen.seated = seated;
      chaseSeen.pulled = chase.back;
      return chaseShot;
    },

    // The lamp is the car's while the local player is seated in a car with its lights on, and off when that car's lights are off; on foot, as the engine has it.
    lampOn(local) {
      const ride = (local as { ride?: Ride }).ride;
      return litFor(ride, ride === undefined ? null : (car?.pose(ride.car) ?? null));
    },

    lamp(lamp) {
      base.side.lamp(lamp);
      const ride = held.players.get(held.localId)?.ride;
      headlightsFor(lamp, ride, ride === undefined || ride.phase !== SEATED ? null : (car?.pose(ride.car) ?? null));
      lampSeen.on = lamp.lit.on;
      lampSeen.x = lamp.at.x;
      lampSeen.y = lamp.at.y;
      lampSeen.z = lamp.at.z;
      lampSeen.dx = lamp.at.dx;
      lampSeen.dy = lamp.at.dy;
      lampSeen.dz = lamp.at.dz;
      lampSeen.angle = lamp.at.angle;
      lampSeen.range = lamp.at.range;
      lampSeen.intensity = lamp.lit.state.intensity;
      lampSeen.r = lamp.lit.state.colour.r;
      lampSeen.g = lamp.lit.state.colour.g;
      lampSeen.b = lamp.lit.state.colour.b;
      lampWritten = true;
    },

    bodies(dt, lamp) {
      base.side.bodies(dt, lamp);
      people?.step(dt);
      moveDoors();
    },

    seen(planes, cover) {
      base.side.seen(planes, cover);
      rail?.seen(planes);
      highway?.seen(planes);
      vehicles?.seen(planes);
      car?.seen(planes);
      // A stand-in car goes for good the moment its model's meshes are made: out of the scene, its buffers let go, out of this list.
      if (vehicles !== null) {
        const models = vehicles;
        retireStandIns(made, (model) => models.ready(model), (m) => {
          if (m.layer === "solid") hardCover?.remove(m.mesh);
          if (standing !== null) removeFromScene(standing, m.mesh);
          leaner.remove(m.mesh);
          disposeMeshGpu(m.mesh);
          host.uploads.dropped();
        });
      }
      leaner.step();
      for (const m of made) {
        let want = inView(planes, m);
        // The standing layer is cover for the rain: shown to the map's pass while it reaches into the map's square.
        if (!want && m.layer === "solid" && cover !== null && Math.abs(m.x - cover.x) <= cover.half + m.radius && Math.abs(m.z - cover.z) <= cover.half + m.radius) want = true;
        // The town is below the floor of the room the player is in: it is not drawn, nor shown to the rain's map.
        if (townHidden) want = false;
        if (want !== m.shown) {
          m.shown = want;
          setMeshVisible(m.mesh, want);
        }
      }
    },

    waiting: () => (building ? Math.max(1, left) : 0) + (textures?.pending() ?? 0),

    release() {
      if (seed !== null && seedScene !== null) {
        removeFromScene(seedScene, seed);
        disposeMeshGpu(seed);
      }
      seed = null;
      seedScene = null;
      base.side.release();
    },

    releaseBodies() {
      disposed = true;
      loading.abort();
      textures = null;
      textured.length = 0;
      rail?.dispose();
      rail = null;
      highway?.dispose();
      highway = null;
      vehicles?.dispose();
      vehicles = null;
      car?.dispose();
      car = null;
      holding = false;
      chasing = false;
      chase.started = false;
      shownSeat = 0;
      viewKeys.dispose();
      cineOn = false;
      react.minds.clear();
      react.said.length = 0;
      showCaptions([]);
      knocked.list.length = 0;
      struck.marks.length = 0;
      struck.shoves.length = 0;
      struck.seen.length = 0;
      movedModels.length = 0;
      damage?.dispose();
      damage = null;
      knockedDown = false;
      drawnGround = null;
      held.cars = NO_CARS;
      held.players = new Map();
      delete (globalThis as { __capeCar?: CarDebug }).__capeCar;
      delete (globalThis as { __capePeople?: PeopleDebug }).__capePeople;
      people?.dispose();
      people = null;
      inside?.dispose();
      inside = null;
      whereNow = 0;
      townHidden = false;
      lamps = [];
      host.jobs.cancel(owner);
      for (const m of made) {
        if (m.layer === "solid") hardCover?.remove(m.mesh);
        if (standing !== null) removeFromScene(standing, m.mesh);
        disposeMeshGpu(m.mesh);
        host.uploads.dropped();
      }
      made.length = 0;
      leaner.clear();
      building = false;
      base.side.releaseBodies();
    },
  };
  return { side, api: base.api };
};
