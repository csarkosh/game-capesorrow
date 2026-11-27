import { describe, expect, it } from "vitest";
import { timeLimit } from "@csarkosh/engine/testing/timeLimit";
import { CAR_RETURNED, GET_IN, GET_OUT, HOST_RETURNS_CAR, NO_ROOM_TO_GET_OUT } from "../../src/game/words.js";
import { CAR_COMMANDS, NO_ROOM_AFTER, NO_ROOM_SHOWN, createCapeSide, lineFor, litBy, newClickWatch, promptFor, promptShown, watchClick } from "../../src/game/car/side.js";
import { WALK_SIDE } from "../../src/game.js";
import { carVoice } from "../../src/game/car/carSound.js";
import { voiceShown } from "../../src/game/car/side.js";
import type { WalkState, Walker } from "../../src/sim.js";
import { newRide } from "../../src/sim/car/rules.js";
import { newInside } from "../../src/sim/inside/rooms.js";
import { doorPlace } from "../../src/sim/car/seats.js";
import { INTERACT_BIT, LEAVE_SPEED } from "../../src/sim/car/tuning.js";
import { newCar } from "../../src/sim/car/start.js";
import { ENTERING, FOOT, LEAVING, SEATED, type Car, type Ride } from "../../src/sim/car/types.js";
import { WORLD_SEEDS, worldFor } from "../townWorld/world.js";

const seed = WORLD_SEEDS[0] as number;

const car = (over: Partial<Car> = {}): Car => ({
  id: 1, x: 10, y: 0, z: 20, hx: 0, hz: 1, speed: 0, slip: 0, steer: 0,
  controls: { throttle: 0, turn: 0, handbrake: false }, lights: false, owed: 0, seats: [0, 0, 0, 0], ...over,
});
const walker = (x: number, z: number, ride: Ride = newRide()): Walker => ({ id: 7, pos: { x, y: 0, z }, vel: { x: 0, y: 0, z: 0 }, yaw: 0, pitch: 0, grounded: true, lastProcessedInput: 0, ride, inside: newInside() });
const seated = (seat = 0, car_ = 1): Ride => ({ car: car_, seat, phase: SEATED, ticks: 0 });
/** Where a walker stands at a car's door. */
const atDoor = (c: Car, seat: number): { x: number; z: number } => {
  const at = { x: 0, z: 0 };
  doorPlace(c, seat, at);
  return at;
};

describe("what the line at the door says", () => {
  it("offers to get in beside a door and not from 3 m away", () => {
    const c = car();
    const door = atDoor(c, 0);
    expect(promptFor(walker(door.x, door.z), [c])).toBe(GET_IN);
    expect(promptFor(walker(door.x - 3, door.z), [c])).toBeNull();
    expect(promptFor(undefined, [c])).toBeNull();
  }, timeLimit(60_000));

  it("offers to get out only when seated and nearly stopped", () => {
    const stopped = car({ speed: LEAVE_SPEED - 0.1, seats: [7, 0, 0, 0] });
    const moving = car({ speed: LEAVE_SPEED + 0.1, seats: [7, 0, 0, 0] });
    const reversing = car({ speed: -(LEAVE_SPEED + 0.1), seats: [7, 0, 0, 0] });
    expect(promptFor(walker(10, 20, seated()), [stopped])).toBe(GET_OUT);
    expect(promptFor(walker(10, 20, seated()), [moving])).toBeNull();
    expect(promptFor(walker(10, 20, seated()), [reversing])).toBeNull();
    // A passenger is offered the door as the driver is.
    expect(promptFor(walker(10, 20, seated(2)), [car({ seats: [3, 0, 7, 0] })])).toBe(GET_OUT);
  }, timeLimit(60_000));

  it("offers nothing to a walker when every seat is taken, and nothing while getting in or out", () => {
    const full = car({ seats: [3, 4, 5, 6] });
    const door = atDoor(full, 1);
    expect(promptFor(walker(door.x, door.z), [full])).toBeNull();
    const c = car();
    const at = atDoor(c, 0);
    expect(promptFor(walker(at.x, at.z, { car: 1, seat: 0, phase: ENTERING, ticks: 30 }), [c])).toBeNull();
    expect(promptFor(walker(at.x, at.z, { car: 1, seat: 0, phase: LEAVING, ticks: 30 }), [c])).toBeNull();
  }, timeLimit(60_000));
});

describe("the lamp the page's button shows", () => {
  it("is on only for a seated player whose car's lights are on", () => {
    const lit = car({ lights: true, seats: [7, 0, 0, 0] });
    const dark = car({ lights: false, seats: [7, 0, 0, 0] });
    expect(litBy(walker(0, 0, seated()), [lit])).toBe(true);
    expect(litBy(walker(0, 0, seated()), [dark])).toBe(false);
    expect(litBy(walker(0, 0), [lit])).toBe(false);
    expect(litBy(walker(0, 0, { car: 1, seat: 0, phase: LEAVING, ticks: 3 }), [lit])).toBe(false);
    expect(litBy(walker(0, 0, seated(0, 9)), [lit])).toBe(false);
    expect(litBy(undefined, [lit])).toBe(false);
  }, timeLimit(60_000));
});

describe("the click that changes nothing", () => {
  const FIRST = 100;
  it("says there is no room when a stopped, seated player clicked and 0.3 s later is still seated", () => {
    const w = newClickWatch();
    expect(watchClick(w, FIRST, true, seated(), true)).toBe(false);
    expect(watchClick(w, FIRST + NO_ROOM_AFTER - 0.05, false, seated(), true)).toBe(false);
    expect(watchClick(w, FIRST + NO_ROOM_AFTER, false, seated(), true)).toBe(true);
    // Said once.
    expect(watchClick(w, FIRST + NO_ROOM_AFTER + 0.1, false, seated(), true)).toBe(false);
  }, timeLimit(60_000));

  it("says nothing when the click began leaving, or on foot, or in a car going too fast", () => {
    const left = newClickWatch();
    watchClick(left, FIRST, true, seated(), true);
    expect(watchClick(left, FIRST + 0.1, false, { car: 1, seat: 0, phase: LEAVING, ticks: 30 }, true)).toBe(false);
    expect(watchClick(left, FIRST + 0.4, false, { car: 1, seat: 0, phase: FOOT, ticks: 0 }, true)).toBe(false);
    const fast = newClickWatch();
    watchClick(fast, FIRST, true, seated(), false);
    expect(watchClick(fast, FIRST + 0.4, false, seated(), false)).toBe(false);
    const walking = newClickWatch();
    watchClick(walking, FIRST, true, newRide(), false);
    expect(watchClick(walking, FIRST + 0.4, false, newRide(), false)).toBe(false);
  }, timeLimit(60_000));

  it("counts a held button as one click", () => {
    const w = newClickWatch();
    let said = 0;
    for (let i = 0; i <= 40; i++) if (watchClick(w, FIRST + i * 0.05, true, seated(), true)) said++;
    expect(said).toBe(1);
  }, timeLimit(60_000));

  it("puts the no-room line in the place of Get out for a moment, and only then", () => {
    const w = newClickWatch();
    watchClick(w, FIRST, true, seated(), true);
    watchClick(w, FIRST + NO_ROOM_AFTER, false, seated(), true);
    expect(lineFor(w, FIRST + NO_ROOM_AFTER + 0.1, GET_OUT)).toBe(NO_ROOM_TO_GET_OUT);
    expect(lineFor(w, FIRST + NO_ROOM_AFTER + 0.1, GET_IN)).toBe(GET_IN);
    expect(lineFor(w, FIRST + NO_ROOM_AFTER + 0.1, null)).toBeNull();
    expect(lineFor(w, FIRST + NO_ROOM_AFTER + NO_ROOM_SHOWN + 0.1, GET_OUT)).toBe(GET_OUT);
  }, timeLimit(60_000));
});

type Said = { prompt: [string | null, unknown][]; flash: string[]; down: number; up: number; voice: ({ speed: number; throttle: number; surface: number; distance: number; driven: boolean } | null)[]; thuds: number[]; doors: number };
/** A page's host with the parts the car's side reads, and a record of what it was told. */
const heard = { hz: 0, engine: 0, tyres: 0 };
function pageHost(touch: boolean): { host: never; said: Said; world: { current: unknown } } {
  const said: Said = { prompt: [], flash: [], down: 0, up: 0, voice: [], thuds: [], doors: 0 };
  const world = { current: null as unknown };
  const host = {
    base: { hour: 12 }, appliedHour: 12, appliedWeather: {}, renderer: { setView: () => undefined },
    touchStart: touch,
    touchModel: { interactDown: () => said.down++, interactUp: () => said.up++ },
    ambient: { voice: () => heard, car: (s: { speed: number; throttle: number; surface: number; distance: number; driven: boolean } | null) => { if (s !== null) carVoice(s.speed, s.throttle, s.surface as 0, s.distance, s.driven, heard); said.voice.push(s === null ? null : { ...s }); }, thud: (v: number) => said.thuds.push(v), door: () => said.doors++ },
    hud: { setDark: () => undefined, setPrompt: (line: string | null, press?: unknown) => said.prompt.push([line, press]), flash: (line: string) => said.flash.push(line) },
    get activeWorld() { return world.current; },
  };
  return { host: host as never, said, world };
}

describe("the car's half of a session", () => {
  const state = (cars: Car[], players: Walker[]): WalkState => ({ tick: 1, players: new Map(players.map((p) => [p.id, p])), nextEntityId: 9, rngSeed: 1, cars });

  it("hands the page's prompt only when the line changes, and the touch interact as what a press of it does", () => {
    const { host, said } = pageHost(true);
    const side = createCapeSide(host, WALK_SIDE);
    const c = car();
    const door = atDoor(c, 0);
    const me = walker(door.x, door.z);
    const s = state([c], [me]);
    side.afterSync(undefined as never, s, 7, me, null);
    side.afterSync(undefined as never, s, 7, me, null);
    expect(said.prompt).toHaveLength(1);
    expect(said.prompt[0]?.[0]).toBe(GET_IN);
    const press = said.prompt[0]?.[1] as { down(): void; up(): void };
    press.down();
    press.up();
    expect([said.down, said.up]).toEqual([1, 1]);
    expect(promptShown()).toBe(GET_IN);
    side.afterSync(undefined as never, s, 7, walker(door.x - 5, door.z), null);
    expect(said.prompt.at(-1)).toEqual([null, undefined]);
    expect(promptShown()).toBeNull();
  }, timeLimit(60_000));

  it("gives no press to a screen with a keyboard", () => {
    const { host, said } = pageHost(false);
    const side = createCapeSide(host, WALK_SIDE);
    const c = car();
    const door = atDoor(c, 0);
    const me = walker(door.x, door.z);
    side.afterSync(undefined as never, state([c], [me]), 7, me, null);
    expect(said.prompt[0]).toEqual([GET_IN, undefined]);
  }, timeLimit(60_000));

  it("shows no room in Get out's place when a stopped, seated player's click leaves them seated 0.3 s on, for a moment", () => {
    const { host, said } = pageHost(false);
    let now = 50;
    const side = createCapeSide(host, WALK_SIDE, () => now);
    const c = car({ seats: [7, 0, 0, 0] });
    const me = walker(10, 20, seated());
    const s = state([c], [me]);
    const click = { seq: 1, moveX: 0, moveZ: 0, yaw: 0, pitch: 0, buttons: INTERACT_BIT };
    side.afterSync(undefined as never, s, 7, me, click);
    expect(said.prompt.at(-1)?.[0]).toBe(GET_OUT);
    now += NO_ROOM_AFTER - 0.1;
    side.afterSync(undefined as never, s, 7, me, null);
    expect(said.prompt.at(-1)?.[0]).toBe(GET_OUT);
    now += 0.1;
    side.afterSync(undefined as never, s, 7, me, null);
    expect(said.prompt.at(-1)?.[0]).toBe(NO_ROOM_TO_GET_OUT);
    now += NO_ROOM_SHOWN + 0.1;
    side.afterSync(undefined as never, s, 7, me, null);
    expect(said.prompt.at(-1)?.[0]).toBe(GET_OUT);
    // A click that did start leaving shows nothing of the kind.
    const leaving = walker(10, 20, { car: 1, seat: 0, phase: LEAVING, ticks: 30 });
    now += 5;
    side.afterSync(undefined as never, s, 7, me, click);
    now += 0.1;
    side.afterSync(undefined as never, s, 7, leaving, null);
    now += 0.3;
    side.afterSync(undefined as never, s, 7, leaving, null);
    expect(said.prompt.at(-1)?.[0]).toBeNull();
  }, timeLimit(60_000));

  it("answers the page's lamp button from the car", () => {
    const { host } = pageHost(false);
    const side = createCapeSide(host, WALK_SIDE);
    const c = car({ lights: true, seats: [7, 0, 0, 0] });
    const me = walker(10, 20, seated());
    side.afterSync(undefined as never, state([c], [me]), 7, me, null);
    expect(side.lampOn(me)).toBe(true);
    expect(side.lampOn(walker(0, 0))).toBe(false);
  }, timeLimit(60_000));

  it("brings the car back on the host between ticks, and tells a follower only the host can", () => {
    const { host, said, world } = pageHost(false);
    const side = createCapeSide(host, WALK_SIDE);
    const mine = worldFor(seed);
    mine.state = { tick: 0, players: new Map(), nextEntityId: 1, rngSeed: seed | 0, cars: [newCar(seed, 1)] };
    side.hostStarted({ world: mine } as never);
    world.current = mine;
    const start = { x: mine.state.cars[0]?.x, z: mine.state.cars[0]?.z };
    const away = mine.state.cars[0] as Car;
    away.x += 50;
    away.z -= 30;
    away.lights = true;
    expect(side.applyOwnView("carhome", [])).toBe(true);
    expect({ x: away.x, z: away.z, lights: away.lights }).toEqual({ ...start, lights: false });
    expect(said.flash).toEqual([CAR_RETURNED]);
    // A world that is not the host's: a follower's.
    world.current = { ...mine };
    away.x += 50;
    expect(side.applyOwnView("carhome", [])).toBe(true);
    expect(away.x).not.toBe(start.x);
    expect(said.flash).toEqual([CAR_RETURNED, HOST_RETURNS_CAR]);
    // Before any world, as a link's address is read: nothing to bring back, and nothing said.
    world.current = null;
    expect(side.applyOwnView("carhome", [])).toBe(true);
    expect(said.flash).toHaveLength(2);
    expect(side.applyOwnView("something else", [])).toBe(false);
  }, timeLimit(60_000));

  it("names the console command with no argument, and keeps it out of the address", () => {
    const [spec] = CAR_COMMANDS;
    expect(CAR_COMMANDS).toHaveLength(1);
    expect(spec?.name).toBe("carhome");
    expect(spec?.kind).toBe("view");
    expect(spec?.validate([])).toBeNull();
    expect(spec?.validate(["now"])).toMatch(/no argument/);
    expect(spec?.scriptValue?.([])).toBe(spec?.defaultValue);
  }, timeLimit(60_000));

  describe("the car's sound", () => {
    const at = (tick: number, cars: Car[], players: Walker[]): WalkState => ({ ...state(cars, players), tick });

    it("feeds the nearest car, whoever drives it, and none when no car is within 80 m", () => {
      const { host, said } = pageHost(false);
      const side = createCapeSide(host, WALK_SIDE);
      const me = walker(0, 0);
      const near = car({ id: 1, x: 12, z: 5, speed: 7, seats: [9, 0, 0, 0], controls: { throttle: 1, turn: 0, handbrake: false } });
      const far = car({ id: 2, x: 60, z: 0, speed: 20, seats: [8, 0, 0, 0] });
      side.afterSync(undefined as never, at(1, [far, near], [me]), 7, me, null);
      const fed = said.voice.at(-1);
      expect(fed?.speed).toBe(7);
      expect(fed?.throttle).toBe(1);
      expect(fed?.distance).toBeCloseTo(13, 6);
      expect(voiceShown()).toMatchObject({ distance: fed?.distance, surface: fed?.surface });
      expect(voiceShown()?.engine).toBeGreaterThan(0);
      side.afterSync(undefined as never, at(2, [car({ id: 2, x: 90, z: 0, seats: [8, 0, 0, 0] })], [me]), 7, me, null);
      expect(said.voice.at(-1)).toBeNull();
      expect(voiceShown()).toBeNull();
    }, timeLimit(60_000));

    it("hears a car with a driver at rest idle, and an empty one silent or only rolling", () => {
      const { host, said } = pageHost(false);
      const side = createCapeSide(host, WALK_SIDE);
      const me = walker(0, 0);
      const feed = (tick: number, c: Car[]): void => side.afterSync(undefined as never, at(tick, c, [me]), 7, me, null);
      feed(1, [car({ x: 5, z: 0, speed: 0, seats: [9, 0, 0, 0] })]);
      expect(said.voice.at(-1)?.driven).toBe(true);
      expect(voiceShown()?.engine).toBeGreaterThan(0);
      feed(2, [car({ x: 5, z: 0, speed: 0 })]);
      expect(said.voice.at(-1)).toBeNull();
      expect(voiceShown()).toBeNull();
      feed(3, [car({ x: 5, z: 0, speed: 5 })]);
      expect(said.voice.at(-1)?.driven).toBe(false);
      expect(voiceShown()?.engine).toBe(0);
      expect(voiceShown()?.tyres).toBeGreaterThan(0);
    }, timeLimit(60_000));

    it("chooses a far car with a driver over a near empty one at rest", () => {
      const { host, said } = pageHost(false);
      const side = createCapeSide(host, WALK_SIDE);
      const me = walker(0, 0);
      const empty = car({ id: 1, x: 5, z: 0 });
      const driven = car({ id: 2, x: 50, z: 0, seats: [9, 0, 0, 0] });
      side.afterSync(undefined as never, at(1, [empty, driven], [me]), 7, me, null);
      expect(said.voice.at(-1)?.distance).toBe(50);
    }, timeLimit(60_000));

    it("hears the local player's own place, so a seated driver's car is beside them", () => {
      const { host, said } = pageHost(false);
      const side = createCapeSide(host, WALK_SIDE);
      const c = car({ x: 30, z: 40, seats: [7, 0, 0, 0] });
      side.afterSync(undefined as never, at(1, [c], [walker(30, 40, seated())]), 7, walker(30, 40, seated()), null);
      expect(said.voice.at(-1)?.distance).toBe(0);
    }, timeLimit(60_000));

    it("thuds on a hard stop, scaled by the ticks between frames, and not for brisk braking", () => {
      const { host, said } = pageHost(false);
      const side = createCapeSide(host, WALK_SIDE);
      const me = walker(10, 20);
      side.afterSync(undefined as never, at(10, [car({ speed: 15 })], [me]), 7, me, null);
      expect(said.thuds).toEqual([]);
      side.afterSync(undefined as never, at(11, [car({ speed: 14 })], [me]), 7, me, null);
      expect(said.thuds).toEqual([]);
      side.afterSync(undefined as never, at(12, [car({ speed: 6 })], [me]), 7, me, null);
      expect(said.thuds).toHaveLength(1);
      expect(said.thuds[0]).toBeGreaterThan(0);
      // Four ticks between frames allow 12 m/s of braking before it is a hit.
      side.afterSync(undefined as never, at(16, [car({ speed: 6 })], [me]), 7, me, null);
      side.afterSync(undefined as never, at(20, [car({ speed: 0 })], [me]), 7, me, null);
      expect(said.thuds).toHaveLength(1);
    }, timeLimit(60_000));

    it("does not thud on the first frame a car is seen, on one put back at the office, or on a new world's first frame", () => {
      const { host, said } = pageHost(false);
      const side = createCapeSide(host, WALK_SIDE);
      const me = walker(10, 20);
      side.afterSync(undefined as never, at(10, [car({ speed: 0 })], [me]), 7, me, null);
      expect(said.thuds).toEqual([]);
      side.afterSync(undefined as never, at(11, [car({ speed: 20 })], [me]), 7, me, null);
      side.afterSync(undefined as never, at(12, [car({ speed: 0, x: 400, z: 400 })], [me]), 7, me, null);
      expect(said.thuds).toEqual([]);
      side.afterSync(undefined as never, at(13, [car({ speed: 25, x: 400, z: 400 })], [me]), 7, me, null);
      side.worldIn(undefined as never);
      side.afterSync(undefined as never, at(14, [car({ speed: 0, x: 400, z: 400 })], [me]), 7, me, null);
      expect(said.thuds).toEqual([]);
    }, timeLimit(60_000));

    it("does not thud on a car out of earshot, and softens one far off", () => {
      const { host, said } = pageHost(false);
      const side = createCapeSide(host, WALK_SIDE);
      const me = walker(0, 0);
      const run = (x: number, tick: number, speed: number): void => side.afterSync(undefined as never, at(tick, [car({ x, z: 0, speed })], [me]), 7, me, null);
      run(100, 1, 20);
      run(100, 2, 0);
      expect(said.thuds).toEqual([]);
      run(3, 3, 20);
      run(3, 4, 0);
      run(60, 5, 20);
      run(60, 6, 0);
      expect(said.thuds).toHaveLength(2);
      expect(said.thuds[0]).toBeGreaterThan(said.thuds[1] as number);
    }, timeLimit(60_000));

    it("keeps a record only for the cars there are", () => {
      const { host, said } = pageHost(false);
      const side = createCapeSide(host, WALK_SIDE);
      const me = walker(10, 20);
      side.afterSync(undefined as never, at(1, [car({ id: 5, speed: 20 })], [me]), 7, me, null);
      side.afterSync(undefined as never, at(2, [], [me]), 7, me, null);
      // Car 5 comes back with no record kept: it is seen afresh, not compared with the car it was.
      side.afterSync(undefined as never, at(3, [car({ id: 5, speed: 0 })], [me]), 7, me, null);
      expect(said.thuds).toEqual([]);
    }, timeLimit(60_000));

    it("sounds the door when the local player's ride starts and when it ends, and not while it goes on", () => {
      const { host, said } = pageHost(false);
      const side = createCapeSide(host, WALK_SIDE);
      const c = car({ seats: [7, 0, 0, 0] });
      const frame = (tick: number, ride: Ride): void => {
        const me = walker(10, 20, ride);
        side.afterSync(undefined as never, at(tick, [c], [me]), 7, me, null);
      };
      frame(1, newRide());
      expect(said.doors).toBe(0);
      frame(2, { car: 1, seat: 0, phase: ENTERING, ticks: 0 });
      expect(said.doors).toBe(1);
      frame(3, { car: 1, seat: 0, phase: ENTERING, ticks: 20 });
      frame(4, seated());
      frame(5, seated());
      expect(said.doors).toBe(1);
      frame(6, { car: 1, seat: 0, phase: LEAVING, ticks: 0 });
      expect(said.doors).toBe(1);
      frame(7, newRide());
      expect(said.doors).toBe(2);
    }, timeLimit(60_000));

    it("lets the car go silent when the session ends", () => {
      const { host, said } = pageHost(false);
      const side = createCapeSide(host, WALK_SIDE);
      const me = walker(10, 20);
      side.afterSync(undefined as never, at(1, [car()], [me]), 7, me, null);
      side.dispose();
      expect(said.voice.at(-1)).toBeNull();
      expect(voiceShown()).toBeNull();
    }, timeLimit(60_000));
  });
});
