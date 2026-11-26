/**
 * The car's half of a session: the line at a car's door ("Click to get in"), the page's lamp button answering for the car's lights, and the
 * console's `carhome`, which puts the car back at the office. It is the day's clock's half (`walkSide`, handed in) with these added.
 */
import type { CommandSpec } from "@csarkosh/engine/game/commands";
import type { SessionHost, SessionSide } from "@csarkosh/engine/game/sessionGame";
import type { AmbientAudio } from "@csarkosh/engine/game/ambientAudio";
import type { WalkClient, WalkHost, WalkRenderer } from "../../game.js";
import type { WalkHud } from "../../hud.js";
import { returnCar } from "../../sim/car/rules.js";
import { surfaceAt } from "../../sim/car/surface.js";
import { doorNear, seatFor } from "../../sim/car/seats.js";
import { INTERACT_BIT, LEAVE_SPEED } from "../../sim/car/tuning.js";
import { SEATED, FOOT, type Car, type Ride, type Surface } from "../../sim/car/types.js";
import type { WalkState, WalkWorld, Walker } from "../../sim.js";
import { HEARD_WITHIN, earshot, carVoice, thudStrength, type CarMark, type CarSoundApi } from "./carSound.js";
import { CAR_RETURNED, GET_IN, GET_OUT, HOST_RETURNS_CAR, NO_ROOM_TO_GET_OUT } from "../words.js";

type CapeSide = SessionSide<WalkWorld, WalkState, Walker, WalkRenderer, WalkHost, WalkClient>;
type CapeHost = SessionHost<WalkWorld, WalkRenderer, AmbientAudio & CarSoundApi, WalkHud>;

/** How long after a click a player still seated is told there is no room, and how long that line stands in Get out's place, seconds. */
export const NO_ROOM_AFTER = 0.3, NO_ROOM_SHOWN = 1.6;

function carOf(cars: readonly Car[], id: number): Car | undefined {
  for (let i = 0; i < cars.length; i++) if ((cars[i] as Car).id === id) return cars[i];
  return undefined;
}

/** Whether a seated player is in a car slow enough to leave. */
function slowEnough(ride: Ride, cars: readonly Car[]): boolean {
  const car = carOf(cars, ride.car);
  return car !== undefined && Math.abs(car.speed) < LEAVE_SPEED;
}

/** What the line at the door says: to get in beside a door with a seat to take, to get out when seated and nearly stopped, else nothing. */
export function promptFor(self: Walker | undefined, cars: readonly Car[]): string | null {
  if (self === undefined) return null;
  const ride = self.ride;
  if (ride.phase === FOOT) {
    for (let i = 0; i < cars.length; i++) {
      const car = cars[i] as Car;
      const door = doorNear(car, self.pos.x, self.pos.z);
      if (door >= 0 && seatFor(car, door) >= 0) return GET_IN;
    }
    return null;
  }
  return ride.phase === SEATED && slowEnough(ride, cars) ? GET_OUT : null;
}

/** Whether the page's lamp button reads lit: the player is seated in a car whose lights are on. */
export function litBy(self: Walker | undefined, cars: readonly Car[]): boolean {
  if (self === undefined || self.ride.phase !== SEATED) return false;
  return carOf(cars, self.ride.car)?.lights === true;
}

/** A click that may change nothing: when it was made (seconds, or -1), whether the button was down a step ago, and until when the no-room line stands. */
export type ClickWatch = { at: number; held: boolean; until: number };

export function newClickWatch(): ClickWatch {
  return { at: -1, held: false, until: -1 };
}

/**
 * One step of the watch for a click that changed nothing. A press (the button going down) by a seated player in a car slow enough to leave is
 * noted; when `NO_ROOM_AFTER` has passed and the player is still seated, there was no door to leave by, and this answers true once (the no-room
 * line then stands for `NO_ROOM_SHOWN`). A player who has begun leaving, or is no longer seated, cancels it.
 */
export function watchClick(w: ClickWatch, now: number, down: boolean, ride: Ride | undefined, slow: boolean): boolean {
  const pressed = down && !w.held;
  w.held = down;
  const seated = ride !== undefined && ride.phase === SEATED;
  if (pressed && seated && slow && w.at < 0) w.at = now;
  if (w.at < 0) return false;
  if (!seated) {
    w.at = -1;
    return false;
  }
  // The small allowance keeps a step of exactly 0.3 s from falling a rounding short of it.
  if (now - w.at < NO_ROOM_AFTER - 1e-9) return false;
  w.at = -1;
  w.until = now + NO_ROOM_SHOWN;
  return true;
}

/** The line to show: Get out gives way to the no-room line while it stands. */
export function lineFor(w: ClickWatch, now: number, line: string | null): string | null {
  return line === GET_OUT && now < w.until ? NO_ROOM_TO_GET_OUT : line;
}

/** The line the door shows now, for a measuring tool (`__capeCar.prompt()`). */
let shown: string | null = null;
export function promptShown(): string | null {
  return shown;
}

/** What the car's voice was last fed, for a measuring tool (`__capeCar.sound()`): the note, the two levels, the surface and the distance. */
export type VoiceSeen = { hz: number; engine: number; tyres: number; surface: number; distance: number };
const voice: VoiceSeen = { hz: 0, engine: 0, tyres: 0, surface: 0, distance: 0 };
let voiceOn = false;
export function voiceShown(): VoiceSeen | null {
  return voiceOn ? { ...voice } : null;
}

/** The console's `carhome`: no argument, applied by the game's own half; kept out of the address (its value is its default). */
export const CAR_COMMANDS: readonly CommandSpec[] = [
  {
    name: "carhome",
    kind: "view",
    validate: (args) => (args.length === 0 ? null : "carhome takes no argument"),
    scriptValue: () => true,
    defaultValue: true,
  },
];

const FLASH_MS = 2500;

/**
 * The session's own half with the car's added to `base` (the day's clock's): after each frame's sync, the page's prompt line is set from the
 * state that frame drew; the lamp button reads the car; `carhome` is the host's.
 */
export function createCapeSide(host: CapeHost, base: CapeSide, clock: () => number = () => performance.now() / 1000): CapeSide {
  let cars: readonly Car[] = [];
  // The host's own world, once this screen hosts: `carhome` is the host's to say, and the page's active world is its own only then.
  let hostWorld: WalkWorld | null = null;
  const watch = newClickWatch();
  // What each car was at the last frame that saw it, for the thud; and the local player's ride at that frame, for the door. Cleared with the world.
  const marks = new Map<number, CarMark>();
  let lastPhase = -1;
  const feed = { speed: 0, throttle: 0, surface: 0 as Surface, distance: 0 };
  const forget = (): void => {
    marks.clear();
    lastPhase = -1;
    voiceOn = false;
  };
  let line: string | null = null;
  const press = { down: () => host.touchModel.interactDown(), up: () => host.touchModel.interactUp() };
  const set = (next: string | null): void => {
    if (next === line) return;
    line = next;
    shown = next;
    host.hud.setPrompt(next, next !== null && host.touchStart ? press : undefined);
  };
  /** The car's voice, the thud and the door of this frame. The ear is the local player's own place: seated, that is the car's, whatever the chase camera does. */
  const hear = (world: WalkWorld | undefined, state: WalkState, self: Walker | undefined): void => {
    const audio = host.ambient;
    const list = state.cars;
    let nearest: Car | null = null;
    let best = HEARD_WITHIN;
    for (let i = 0; i < list.length; i++) {
      const c = list[i] as Car;
      if (self !== undefined) {
        const d = Math.hypot(c.x - self.pos.x, c.z - self.pos.z);
        if (d < best) {
          best = d;
          nearest = c;
        }
      }
      const m = marks.get(c.id);
      if (m === undefined) {
        marks.set(c.id, { tick: state.tick, x: c.x, z: c.z, speed: c.speed });
        continue;
      }
      const hit = thudStrength(m, { tick: state.tick, x: c.x, z: c.z, speed: c.speed });
      if (hit > 0 && self !== undefined) {
        const heard = earshot(Math.hypot(c.x - self.pos.x, c.z - self.pos.z));
        if (heard > 0) audio.thud(hit * heard);
      }
      m.tick = state.tick;
      m.x = c.x;
      m.z = c.z;
      m.speed = c.speed;
    }
    if (marks.size > list.length) for (const id of marks.keys()) if (carOf(list, id) === undefined) marks.delete(id);
    if (nearest === null) {
      voiceOn = false;
      audio.car(null);
    } else {
      const seed = world === undefined ? state.rngSeed : world.forest.seed;
      feed.speed = nearest.speed;
      feed.throttle = nearest.controls.throttle;
      feed.surface = surfaceAt(seed, nearest.x, nearest.z);
      feed.distance = best;
      const v = carVoice(feed.speed, feed.throttle, feed.surface, feed.distance);
      voice.hz = v.hz;
      voice.engine = v.engine;
      voice.tyres = v.tyres;
      voice.surface = feed.surface;
      voice.distance = best;
      voiceOn = true;
      audio.car(feed);
    }
    const phase = self === undefined ? -1 : self.ride.phase;
    if (lastPhase >= 0 && phase >= 0 && (phase === FOOT) !== (lastPhase === FOOT)) audio.door();
    lastPhase = phase;
  };
  return {
    ...base,
    worldIn(...args) {
      base.worldIn(...args);
      forget();
    },
    atRest(...args) {
      base.atRest(...args);
      forget();
    },
    hostStarted(h) {
      base.hostStarted(h);
      hostWorld = (h as { world: WalkWorld }).world;
    },
    dispose() {
      base.dispose();
      line = null;
      shown = null;
      hostWorld = null;
      forget();
      host.ambient.car(null);
    },
    lampOn: (self) => litBy(self, cars),
    afterSync(world, state, localId, self, cmd) {
      base.afterSync(world, state, localId, self, cmd);
      cars = state.cars;
      const now = clock();
      const ride = self?.ride;
      const down = cmd !== null && (cmd.buttons & INTERACT_BIT) !== 0;
      watchClick(watch, now, down, ride, ride !== undefined && slowEnough(ride, cars));
      set(lineFor(watch, now, promptFor(self, cars)));
      hear(world as WalkWorld | undefined, state, self);
    },
    applyOwnView(name, args) {
      if (name !== "carhome") return base.applyOwnView(name, args);
      const world = host.activeWorld;
      // Before a world is in (an address read as the page loads) there is nothing to bring back.
      if (world === null) return true;
      if (world !== hostWorld) {
        host.hud.flash(HOST_RETURNS_CAR, FLASH_MS);
        return true;
      }
      const list = world.state.cars;
      for (let i = 0; i < list.length; i++) returnCar(world, (list[i] as Car).id);
      host.hud.flash(CAR_RETURNED, FLASH_MS);
      return true;
    },
  };
}
