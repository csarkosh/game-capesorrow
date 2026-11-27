/**
 * The room a player walks into, as meshes: the renderer's side of `insideGeometry.ts`.
 *
 * - **Where the local player is.** `where` is the room's id while the player's phase is INSIDE or GOING_OUT, else 0. The room to have built is
 *   that, or the room being entered once the hold at its door is past its first 12 ticks, when the screen is already dark, so the build's hitch
 *   is not seen; a player who is simply INSIDE with nothing built (a join, a console command) has it built at once. A room is built whole and at
 *   once (a few thousand polygons), and never kept while the player is in the street: it is let go the frame the phase is OUTSIDE again.
 * - **Its own material.** The town's solid material without the wet look (a floor indoors is not wet with the rain), which is the one thing the
 *   engine's air is not: the air also carries the display curve and the grade on the tiers that have no post chain, so a material without it
 *   would come out another colour. It stays.
 * - **Rain.** The mesh is NOT registered as hard cover. The engine draws drips under hard cover (the canopy's water, a state it keeps ten minutes), which a roof there
 *   would show in the room; with no cover under the room they are not covered by anything. No streak falls because the view's rain is put out while the player is in a room
 *   (`insideWeather.ts`, which also says why the lens needs that).
 * - **The town is hidden while the player is inside** (phase INSIDE only): it is below the floor and costs frame time. It is shown again in
 *   GOING_OUT, so the street is there when the screen clears (`hidesTown`, read by `townParts.ts`).
 * - **The room's own textures** (`interiorTextures.ts`, imported here and nowhere else). A room drawn from a design (`design.legacy` false) is drawn on the rooms'
 *   own arrays (`interior.layers.json`: marble, carpet, oak, dark wood, cloth, glazed tile, cane and the few outdoor layers the rooms use), which are fetched
 *   and made the first time the local player starts to walk into such a room (the first frame of the hold at its door) or is put straight in one, never with
 *   the town, and kept for the session. The room is built once they are ready, and until then the part tells the session that the room is not drawn
 *   (`insideReady.ts`), which keeps the screen dark. If they do not load (a warning, once) the room is built on the town's arrays, as the rooms were drawn before they had a
 *   set (`insideLayers.ts` lays the room's layers on whichever arrays it is drawn on), so a player is never left in the dark. A room drawn the old way
 *   (`legacy`) never waits for them and never reads them.
 * - **People.** `insidePeople` stands copies of each room's unit's people in the hidden room, over the whole room, for `peopleParts.ts` to show
 *   while the local player is where that room is.
 */
import { addToScene, createMeshFromData, disposeMeshGpu, removeFromScene, type Mesh, type PbrMaterialProps, type SceneContext, type EngineContext } from "@babylonjs/lite";
import type { FrameUploads } from "@csarkosh/engine/game/lite/frameUploads";
import { DOOR_TICKS, GOING_IN, GOING_OUT, INSIDE, insideRooms, roomOf, type Inside, type InsideRoom } from "../../sim/inside/rooms.js";
import { buildingLevels } from "./buildingGeometry.js";
import { heldBy, tradeAt } from "./handHeld.js";
import { unitHours } from "./hours.js";
import { insideGeometry } from "./insideGeometry.js";
import { retargetLayers } from "./insideLayers.js";
import { createInteriorTextures } from "./interiorTextures.js";
import { setRoomDrawn } from "../insideReady.js";
import { PERSON_MODELS, roomPeople, type Activity, type PersonModel } from "./people.js";
import type { PlacedPerson } from "./peopleParts.js";
import { xd, xp } from "./roomKit.js";
import { packSurface } from "./surfacePack.js";
import type { TownTextureSet } from "./townMaterial.js";
import type { Detail, TownGround } from "./townTypes.js";

/** How many ticks into the hold at the street door the room is built: the screen is dark by then (the hold is `DOOR_TICKS` and the fade takes the first of it). */
export const BUILD_AFTER = 12;

/** The id of the room the player is where: its id in INSIDE and GOING_OUT, else 0. */
export function whereOf(inside: Inside | undefined): number {
  return inside !== undefined && (inside.phase === INSIDE || inside.phase === GOING_OUT) ? inside.place : 0;
}

/** The id of the room to have built: the one the player is where, or the one being entered once the screen is dark; else 0. */
export function wantedOf(inside: Inside | undefined): number {
  if (inside === undefined) return 0;
  if (inside.phase === GOING_IN && inside.ticks <= DOOR_TICKS - BUILD_AFTER) return inside.place;
  return whereOf(inside);
}

/** Whether the town is hidden: while the player is inside, and not while they are on the way out. */
export function hidesTown(inside: Inside | undefined): boolean {
  return inside !== undefined && inside.phase === INSIDE;
}

/** What `insideParts` is made with: the renderer's pieces, and the world. */
export type InsideHost = {
  readonly engine: EngineContext;
  readonly scene: SceneContext;
  /** The town's solid material without the wet look (`townParts.ts`). */
  readonly material: PbrMaterialProps;
  /** Where the material draws among the scenery. */
  readonly order: number;
  /** Whether the material wears the town's textures, which want the surface data packed. */
  readonly textured: boolean;
  readonly ground: TownGround;
  readonly detail: Detail;
  readonly uploads: FrameUploads;
  /**
   * What the rooms' own textures need of the renderer (`townParts.ts`): null where the town has no textures at all. `make` is given the arrays when they have been
   * made and returns the material that reads them (the town's indoor material, on the rooms' layers) and what to tell it when they have landed.
   */
  readonly interior: {
    readonly low: boolean;
    readonly signal: AbortSignal;
    make(textures: TownTextureSet): { readonly material: PbrMaterialProps; landed(filled: boolean): void };
  } | null;
};

export type InsideParts = {
  /** One frame: where the local player is by the rooms (undefined for a state with no record of it). Builds the room or lets it go. */
  frame(inside: Inside | undefined): void;
  /** The id of the room that is built, or 0. */
  built(): number;
  dispose(): void;
};

/** Where the rooms' own textures are: not asked for, being fetched, landed, or not loaded (the town's are used). */
type Textures = "idle" | "loading" | "ready" | "failed";

export function createInsideParts(host: InsideHost): InsideParts {
  let room = 0;
  let mesh: Mesh | null = null;
  let textures: Textures = "idle";
  let rooms: { readonly material: PbrMaterialProps; landed(filled: boolean): void } | null = null;
  setRoomDrawn(false);

  /** Fetches and makes the rooms' arrays, once: the first time it is called, and never if there is nowhere to put them. */
  const fetchTextures = (): void => {
    if (textures !== "idle") return;
    const interior = host.interior;
    if (interior === null || !host.textured) {
      textures = "failed";
      return;
    }
    textures = "loading";
    try {
      const arrays = createInteriorTextures(host.engine, interior.low, interior.signal, (filled) => {
        textures = filled ? "ready" : "failed";
        rooms?.landed(filled);
      });
      rooms = interior.make(arrays);
    } catch (error) {
      // The arrays could not be made (no device to make them on): the rooms are drawn on the town's.
      console.warn("the rooms' texture arrays could not be made; the room is drawn with the town's textures:", error);
      textures = "failed";
    }
  };

  const drop = (): void => {
    if (mesh === null) return;
    removeFromScene(host.scene, mesh);
    disposeMeshGpu(mesh);
    host.uploads.dropped();
    mesh = null;
    room = 0;
  };

  const build = (r: InsideRoom): void => {
    const a = insideGeometry(host.ground, r, host.detail);
    // A designed room is drawn on the rooms' own arrays if they landed, else on the town's (`insideLayers.ts`).
    const own = !r.design.legacy && textures === "ready" && rooms !== null;
    if (host.textured && !r.design.legacy) retargetLayers(a, own ? "interior" : "town");
    const made = createMeshFromData(host.engine, `inside_${r.id}`, a.positions, a.normals, a.indices, a.uvs, undefined, undefined, a.colors);
    if (host.textured) made.pluginVertexData = packSurface(a.surface);
    made.material = own && rooms !== null ? rooms.material : host.material;
    made.renderOrder = host.order;
    addToScene(host.scene, made);
    host.uploads.count("geometry", a.positions.byteLength + a.normals.byteLength + a.colors.byteLength + a.uvs.byteLength + a.surface.byteLength + a.indices.byteLength, 4);
    host.uploads.made();
    mesh = made;
    room = r.id;
  };

  return {
    frame(inside) {
      const here = whereOf(inside);
      // The rooms' arrays are asked for as the player starts to walk into a designed room, or finds themselves in one.
      const going = inside !== undefined && inside.phase === GOING_IN ? inside.place : here;
      if (going !== 0) {
        const target = roomOf(host.ground.seed, going);
        if (target !== undefined && !target.design.legacy) fetchTextures();
      }
      const want = wantedOf(inside);
      if (want !== room) {
        drop();
        const r = want === 0 ? undefined : roomOf(host.ground.seed, want);
        // A designed room waits for its textures, and the screen with it (`insideReady.ts`); a failed fetch is no reason to wait.
        if (r !== undefined && (r.design.legacy || textures !== "loading")) build(r);
      }
      // Drawn: the player is in no room, or the room they are in is built, or there is no such room to build.
      setRoomDrawn(here === 0 || room === here || roomOf(host.ground.seed, here) === undefined);
    },
    built: () => room,
    dispose() {
      drop();
      setRoomDrawn(true);
    },
  };
}

/** The people a design places itself (`Design.people`), in the room's frame placed in the world: the municipal building's and the bar's. */
function designPeople(g: TownGround, room: InsideRoom): PlacedPerson[] {
  const b = g.plan.buildings[room.building];
  const xf = b === undefined ? null : buildingLevels(g, b).xf;
  if (xf === null) return [];
  // A unit's people are there while it is open; the municipal building's never leave.
  const unit = b === undefined ? undefined : g.plan.uses[room.building]?.units.find((u) => u.id === room.unit);
  const hours = b === undefined || unit === undefined ? null : unitHours(b, unit);
  return room.design.people.map((p, i): PlacedPerson => {
    const at = xp(xf, room.s0 + p.s, p.d, room.floorY + (p.y ?? 0));
    const way = xd(xf, p.face.s, p.face.d);
    const model = PERSON_MODELS[(i * 2 + room.building) % PERSON_MODELS.length] as PersonModel;
    return {
      person: {
        model, activity: p.activity as Activity, seat: p.sits === null ? null : { furnishing: 0, top: p.sits, family: p.family }, scale: 0.97 + 0.02 * ((i + room.building) % 3), offset: 7 * (i + 1),
        rate: 0.95 + 0.05 * (i % 3),
      },
      at: { x: at[0], y: at[1], z: at[2], yaw: Math.atan2(way[0], way[2]) },
      hours,
      outdoor: false,
      held: null,
      room: room.id,
    };
  });
}

/**
 * The people of the rooms, standing in their hidden copies: each room's unit's people placed over the whole room (`roomPeople`), feet on the
 * floor the player walks on, each tagged with the room's id so that `peopleParts.ts` shows them only to a player in that room.
 */
export function insidePeople(g: TownGround): PlacedPerson[] {
  const out: PlacedPerson[] = [];
  for (const room of insideRooms(g.seed)) {
    if (room.design.people.length > 0) {
      out.push(...designPeople(g, room));
      continue;
    }
    const b = g.plan.buildings[room.building];
    const unit = g.plan.uses[room.building]?.units.find((u) => u.id === room.unit);
    const xf = b === undefined ? null : buildingLevels(g, b).xf;
    if (b === undefined || unit === undefined || xf === null) continue;
    for (const person of roomPeople(b, unit)) {
      const at = xp(xf, person.s, person.d, room.floorY);
      const way = xd(xf, person.face.s, person.face.d);
      out.push({ person, at: { x: at[0], y: at[1], z: at[2], yaw: Math.atan2(way[0], way[2]) }, hours: person.hours, outdoor: false, held: heldBy(person.activity, tradeAt(g.plan, person.building, person.unit)), room: room.id });
    }
  }
  return out;
}
