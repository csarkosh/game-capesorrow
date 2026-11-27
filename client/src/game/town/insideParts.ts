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
 * - **People.** `insidePeople` stands copies of each room's unit's people in the hidden room, over the whole room, for `peopleParts.ts` to show
 *   while the local player is where that room is.
 */
import { addToScene, createMeshFromData, disposeMeshGpu, removeFromScene, type Mesh, type PbrMaterialProps, type SceneContext, type EngineContext } from "@babylonjs/lite";
import type { FrameUploads } from "@csarkosh/engine/game/lite/frameUploads";
import { DOOR_TICKS, GOING_IN, GOING_OUT, INSIDE, insideRooms, roomOf, type Inside, type InsideRoom } from "../../sim/inside/rooms.js";
import { buildingLevels } from "./buildingGeometry.js";
import { heldBy, tradeAt } from "./handHeld.js";
import { insideGeometry } from "./insideGeometry.js";
import { PERSON_MODELS, roomPeople, type PersonModel } from "./people.js";
import { municipalInterior } from "../../sim/inside/municipal.js";
import type { PlacedPerson } from "./peopleParts.js";
import { xd, xp } from "./roomKit.js";
import { packSurface } from "./surfacePack.js";
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
};

export type InsideParts = {
  /** One frame: where the local player is by the rooms (undefined for a state with no record of it). Builds the room or lets it go. */
  frame(inside: Inside | undefined): void;
  /** The id of the room that is built, or 0. */
  built(): number;
  dispose(): void;
};

export function createInsideParts(host: InsideHost): InsideParts {
  let room = 0;
  let mesh: Mesh | null = null;

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
    const made = createMeshFromData(host.engine, `inside_${r.id}`, a.positions, a.normals, a.indices, a.uvs, undefined, undefined, a.colors);
    if (host.textured) made.pluginVertexData = packSurface(a.surface);
    made.material = host.material;
    made.renderOrder = host.order;
    addToScene(host.scene, made);
    host.uploads.count("geometry", a.positions.byteLength + a.normals.byteLength + a.colors.byteLength + a.uvs.byteLength + a.surface.byteLength + a.indices.byteLength, 4);
    host.uploads.made();
    mesh = made;
    room = r.id;
  };

  return {
    frame(inside) {
      const want = wantedOf(inside);
      if (want === room) return;
      drop();
      if (want === 0) return;
      const r = roomOf(host.ground.seed, want);
      if (r !== undefined) build(r);
    },
    built: () => room,
    dispose: drop,
  };
}

/** The people of the municipal building's room (`sim/inside/municipal.ts` fixes where they stand and what they do), in the room's frame placed in the world. */
function hallPeople(g: TownGround, room: InsideRoom): PlacedPerson[] {
  const b = g.plan.buildings[room.building];
  const xf = b === undefined ? null : buildingLevels(g, b).xf;
  if (xf === null) return [];
  const m = municipalInterior(g.seed);
  return m.people.map((p, i): PlacedPerson => {
    const at = xp(xf, p.s, p.d, room.floorY);
    const way = xd(xf, p.face.s, p.face.d);
    const model = PERSON_MODELS[(i * 2 + room.building) % PERSON_MODELS.length] as PersonModel;
    return {
      person: { model, activity: p.activity, seat: p.sits === null ? null : { furnishing: 0, top: p.sits, family: "chair" }, scale: 0.97 + 0.02 * ((i + room.building) % 3), offset: 7 * (i + 1), rate: 0.95 + 0.05 * (i % 3) },
      at: { x: at[0], y: at[1], z: at[2], yaw: Math.atan2(way[0], way[2]) },
      hours: null,
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
    if (room.unit === -1) {
      out.push(...hallPeople(g, room));
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
