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
import { KNOCK_FROM, touching } from "../../sim/car/knock.js";
import { surfaceAt } from "../../sim/car/surface.js";
import { knockablesFor } from "../../sim/town/knockables.js";
import { boardSeat, slowForDoors } from "../../sim/car/seats.js";
import { INTERACT_BIT } from "../../sim/car/tuning.js";
import { SEATED, FOOT, type Car, type Ride, type Surface } from "../../sim/car/types.js";
import type { WalkState, WalkWorld, Walker } from "../../sim.js";
import { HEARD_WITHIN, earshot, thudStrength, type CarMark, type CarSoundApi } from "./carSound.js";
import { OUTSIDE, roomOf } from "../../sim/inside/rooms.js";
import { insidePut } from "../../sim/inside/rules.js";
import { darkFor, doorLine, faceYaw, goinTarget } from "../doors.js";
import { CAR_RETURNED, GET_IN, GET_OUT, HOST_PUTS_IN, HOST_RETURNS_CAR, NO_ROOM_TO_GET_OUT } from "../words.js";
import { captionsShown } from "../town/speech.js";

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
  return car !== undefined && slowForDoors(car);
}

/**
 * What the line at the door says: the car's line first, to get in beside a door with a seat to take, or to get out when seated and nearly stopped;
 * else a building's (`doorLine`: go in at a street door, go out at a room's door); else nothing. `seed` is the world's, or null where there is none.
 */
export function promptFor(self: Walker | undefined, cars: readonly Car[], seed: number | null = null): string | null {
  if (self === undefined) return null;
  const ride = self.ride;
  if (ride.phase === FOOT) {
    // A player in a room is 60 m over the street: no car's door is theirs.
    if (self.inside.phase === OUTSIDE) {
      for (let i = 0; i < cars.length; i++) {
        const car = cars[i] as Car;
        if (boardSeat(car, self.pos) >= 0) return GET_IN;
      }
    }
    return doorLine(self, seed);
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

/** How loud a thing that gives way is when a car going `speed` (m/s over the ground) knocks it down, 0 to 1: a clatter at a crawl, most of a thud at 20 m/s. */
export function knockLoudness(speed: number): number {
  return Math.min(1, 0.2 + Math.max(speed, 0) / 30);
}

/** The line the door shows now, for a measuring tool (`__portAshtonCar.prompt()`). */
let shown: string | null = null;
export function promptShown(): string | null {
  return shown;
}

/** What the car's voice was last fed, for a measuring tool (`__portAshtonCar.sound()`): the note, the two levels, the surface and the distance. */
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
  // What `goin` last asked (a place's name), until the host's local player is in a world to be put there; and that player's id, as the last frame knew it.
  let goin: readonly string[] | null = null;
  // What each car was at the last frame that saw it, for the thud; and the local player's ride at that frame, for the door. Cleared with the world.
  const marks = new Map<number, CarMark>();
  let lastPhase = -1;
  const feed = { speed: 0, throttle: 0, surface: 0 as Surface, distance: 0, driven: false, slip: 0 };
  const now_: CarMark = { tick: 0, x: 0, z: 0, speed: 0 };
  // The things that give way (`sim/town/knockables.ts`) that some car's body touched at the last frame, and at this one: one newly touched by a moving car is a hit, and is heard.
  let touched = new Set<number>();
  let touchedNow = new Set<number>();
  const forget = (): void => {
    touched.clear();
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
    // The town's knockables are read only where there is a car to touch them.
    const knockables = list.length === 0 ? null : knockablesFor(world === undefined ? state.rngSeed : world.forest.seed);
    touchedNow.clear();
    for (let i = 0; i < list.length; i++) {
      const c = list[i] as Car;
      const fast = Math.hypot(c.speed, c.slip);
      if (knockables !== null) touching(knockables, c.x, c.z, c.hx, c.hz, (k) => {
        touchedNow.add(k.id);
        if (touched.has(k.id) || fast < KNOCK_FROM || self === undefined) return;
        const heard = earshot(Math.hypot(k.x - self.pos.x, k.z - self.pos.z));
        if (heard > 0) audio.thud(knockLoudness(fast) * heard);
      });
      // The speed over the ground, along the heading and sliding across it: a slide takes speed from along the heading and is no hit.
      const over = Math.hypot(c.speed, c.slip);
      if (self !== undefined && (c.seats[0] !== 0 || over > 0.05)) {
        const d = Math.hypot(c.x - self.pos.x, c.z - self.pos.z);
        if (d < best) {
          best = d;
          nearest = c;
        }
      }
      const m = marks.get(c.id);
      if (m === undefined) {
        marks.set(c.id, { tick: state.tick, x: c.x, z: c.z, speed: over });
        continue;
      }
      now_.tick = state.tick;
      now_.x = c.x;
      now_.z = c.z;
      now_.speed = over;
      const hit = thudStrength(m, now_);
      if (hit > 0 && self !== undefined) {
        const heard = earshot(Math.hypot(c.x - self.pos.x, c.z - self.pos.z));
        if (heard > 0) audio.thud(hit * heard);
      }
      m.tick = state.tick;
      m.x = c.x;
      m.z = c.z;
      m.speed = over;
    }
    const spare = touched;
    touched = touchedNow;
    touchedNow = spare;
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
      feed.driven = nearest.seats[0] !== 0;
      feed.slip = nearest.slip;
      audio.car(feed);
      const v = audio.voice();
      voice.hz = v.hz;
      voice.engine = v.engine;
      voice.tyres = v.tyres;
      voice.surface = feed.surface;
      voice.distance = best;
      voiceOn = true;
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
      goin = null;
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
      const seed = world === undefined ? null : (world as WalkWorld).forest.seed;
      set(lineFor(watch, now, promptFor(self, cars, seed)));
      // What the town's people are saying this frame, over their heads (`town/speech.ts`: the renderer's part leaves it there).
      host.hud.setSpeech(captionsShown());
      host.hud.setDark(darkFor(self));
      if (goin !== null && world !== undefined && self !== undefined) {
        // `goin` is the host's to do, between its ticks, on its own world and its own player.
        const asked = goin;
        goin = null;
        if (world !== hostWorld) host.hud.flash(HOST_PUTS_IN, FLASH_MS);
        else {
          const target = goinTarget(seed as number, asked[0] as string);
          const mine = (world as WalkWorld).state.players.get(localId);
          if (target !== undefined && mine !== undefined && insidePut(world as WalkWorld, mine, target, asked[1]) && asked[2] !== undefined && target !== 0) {
            const room = roomOf(seed as number, target);
            if (room !== undefined) host.input.setLook(faceYaw(room, asked[2]), 0);
          }
        }
      }
      hear(world as WalkWorld | undefined, state, self);
    },
    applyOwnView(name, args) {
      if (name === "goin") {
        // Asked before a world or a player stands (an address read as the page loads), it waits for the first frame that has both.
        goin = args.length === 0 ? ["out"] : args;
        return true;
      }
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
