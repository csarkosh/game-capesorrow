/**
 * What a measuring tool may read of the car and the local player's ride (`globalThis.__capeCar`, set by `townParts.ts` while the town's
 * part lives): every answer is a copy, so nothing a tool does reaches a record the game moves.
 */
import { doorPlace } from "../../sim/car/seats.js";
import type { Car, Ride } from "../../sim/car/types.js";
import type { CarPose } from "./carPose.js";

/** The one lamp as the last frame wrote it: whether it is on, where it stands and points, its cone and reach, and the brightness and colour the frame handed the renderer (the scene's spot light, which the town's materials receive, is written from these). */
export type LampSeen = { on: boolean; x: number; y: number; z: number; dx: number; dy: number; dz: number; angle: number; range: number; intensity: number; r: number; g: number; b: number };

export type CarDebug = {
  /** Every car as this frame drew it. */
  cars(): { id: number; x: number; y: number; z: number; hx: number; hz: number; speed: number; steer: number; lights: boolean; driver: number; seats: number[] }[];
  /** The local player as this frame's state has it, or null before there is one. */
  self(): { x: number; y: number; z: number; yaw: number; pitch: number; ride: { car: number; seat: number; phase: number; ticks: number } } | null;
  /** The camera as the last frame wrote it while the local player is in the car (its place, yaw, pitch, lens and how far into the seat, 0 to 1, how far from the aim point the chase stood: `CHASE_BACK`, and more at speed, when nothing was in the way; and the cinematic shot held, 0 for the chase), or null. */
  camera(): { x: number; y: number; z: number; yaw: number; pitch: number; fov: number; seated: number; pulled: number; shot: number } | null;
  /** Where a walker stands to use each seat's door of a car (seat 0 is the driver's), or an empty list for an unknown car. */
  doors(id: number): { x: number; z: number }[];
  /** The line the door shows now, or null. */
  prompt(): string | null;
  /** The one lamp as the last frame wrote it, or null before a frame has. */
  lamp(): LampSeen | null;
  /** What the car's voice was last fed (the note, the levels of the engine and the tyres, the surface under the nearest car and its distance from the listener), or null when no car was within earshot. */
  sound(): { hz: number; engine: number; tyres: number; surface: number; distance: number } | null;
};

/** What the answers are built from: the state as the last frame had it, and the poses the car's part holds. */
export type CarDebugSource = {
  state(): { cars: readonly Car[]; localId: number; players: ReadonlyMap<number, { pos: { x: number; y: number; z: number }; yaw: number; pitch: number; ride?: Ride }> } | null;
  pose(id: number): CarPose | null;
  /** The camera's last written record, or null when it is the walker's own. */
  camera?(): { x: number; y: number; z: number; yaw: number; pitch: number; fov: number; seated: number; pulled: number; shot?: number } | null;
  /** The line the door shows. */
  prompt?(): string | null;
  /** The lamp as the last frame wrote it, or null before there is one. */
  lamp?(): LampSeen | null;
  /** What the voice was last fed. */
  sound?(): { hz: number; engine: number; tyres: number; surface: number; distance: number } | null;
};

export function carDebug(source: CarDebugSource): CarDebug {
  return {
    cars() {
      const state = source.state();
      const out: ReturnType<CarDebug["cars"]> = [];
      if (state === null) return out;
      for (const c of state.cars) {
        const p = source.pose(c.id);
        if (p === null) continue;
        out.push({ id: p.id, x: p.x, y: p.y, z: p.z, hx: p.hx, hz: p.hz, speed: p.speed, steer: p.steer, lights: p.lights, driver: p.driver, seats: [...c.seats] });
      }
      return out;
    },
    self() {
      const state = source.state();
      const me = state?.players.get(state.localId);
      if (state === null || me === undefined) return null;
      const ride = me.ride ?? { car: 0, seat: 0, phase: 0, ticks: 0 };
      return { x: me.pos.x, y: me.pos.y, z: me.pos.z, yaw: me.yaw, pitch: me.pitch, ride: { car: ride.car, seat: ride.seat, phase: ride.phase, ticks: ride.ticks } };
    },
    camera() {
      const c = source.camera?.() ?? null;
      return c === null ? null : { x: c.x, y: c.y, z: c.z, yaw: c.yaw, pitch: c.pitch, fov: c.fov, seated: c.seated, pulled: c.pulled, shot: c.shot ?? 0 };
    },
    prompt: () => source.prompt?.() ?? null,
    sound() {
      const v = source.sound?.() ?? null;
      return v === null ? null : { hz: v.hz, engine: v.engine, tyres: v.tyres, surface: v.surface, distance: v.distance };
    },
    lamp() {
      const l = source.lamp?.() ?? null;
      return l === null ? null : { ...l };
    },
    doors(id) {
      const car = source.state()?.cars.find((c) => c.id === id);
      if (car === undefined) return [];
      const out: { x: number; z: number }[] = [];
      for (let seat = 0; seat < 4; seat++) {
        const at = { x: 0, z: 0 };
        doorPlace(car, seat, at);
        out.push(at);
      }
      return out;
    },
  };
}
