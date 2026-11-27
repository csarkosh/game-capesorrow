import "../../src/terrain.js";
import { afterEach, describe, expect, it, vi } from "vitest";
import { timeLimit } from "@csarkosh/engine/testing/timeLimit";
import { PLAYER_HALF } from "@csarkosh/engine/sim/constants";
import { addPlayer } from "@csarkosh/engine/sim/tick";
import { createCapeSide, promptFor } from "../../src/game/car/side.js";
import { darkFor, doorLine, faceYaw, goinTarget, INSIDE_COMMANDS } from "../../src/game/doors.js";
import { GO_IN, GO_OUT, HOST_PUTS_IN } from "../../src/game/words.js";
import { WALK_SIDE } from "../../src/game.js";
import { createWalkHud, DARK_MS, CLEAR_MS } from "../../src/hud.js";
import { WALK_RULES, type Walker } from "../../src/sim.js";
import { doorPlace } from "../../src/sim/car/seats.js";
import { newCar } from "../../src/sim/car/start.js";
import { newRide } from "../../src/sim/car/rules.js";
import { arriveIn, arriveOut, GOING_IN, GOING_OUT, INSIDE, newInside, OUTSIDE, roomOf, type Inside, type InsideRoom } from "../../src/sim/inside/rooms.js";
import { worldFor } from "../townWorld/world.js";

const SEED = 20261121;
const room = (id: number): InsideRoom => roomOf(SEED, id) as InsideRoom;

const walker = (pos: { x: number; y: number; z: number }, inside: Inside = newInside()): Walker => ({
  id: 1, pos, vel: { x: 0, y: 0, z: 0 }, yaw: 0, pitch: 0, grounded: true, lastProcessedInput: 0, ride: newRide(), inside,
});
const atStreet = (id: number, inside: Inside = newInside()): Walker => {
  const at = arriveOut(room(id));
  return walker({ x: at.x, y: room(id).streetY + PLAYER_HALF.y, z: at.z }, inside);
};

describe("the line at a door", () => {
  it("offers to go in at a street door, with the same test as the host's press", () => {
    for (const id of [1, 2, 3]) expect(doorLine(atStreet(id), SEED), `${id}`).toBe(GO_IN);
    const away = atStreet(1);
    away.pos = { ...away.pos, x: away.pos.x + room(1).nx * 6, z: away.pos.z + room(1).nz * 6 };
    expect(doorLine(away, SEED)).toBeNull();
    expect(doorLine(undefined, SEED)).toBeNull();
    expect(doorLine(atStreet(1), null)).toBeNull();
  }, timeLimit(60_000));

  it("offers to go out at the room's door, and nothing deeper in", () => {
    const at = arriveIn(room(2));
    expect(doorLine(walker(at, { place: 2, phase: INSIDE, ticks: 0 }), SEED)).toBe(GO_OUT);
    const deep = { x: at.x - room(2).nx * 5, y: at.y, z: at.z - room(2).nz * 5 };
    expect(doorLine(walker(deep, { place: 2, phase: INSIDE, ticks: 0 }), SEED)).toBeNull();
  }, timeLimit(60_000));

  it("says nothing during a hold, and gives way to the car's line", () => {
    expect(doorLine(atStreet(1, { place: 1, phase: GOING_IN, ticks: 5 }), SEED)).toBeNull();
    const at = arriveIn(room(1));
    expect(doorLine(walker(at, { place: 1, phase: GOING_OUT, ticks: 5 }), SEED)).toBeNull();
    // A car whose door is at the street door: the car's line wins.
    const car = newCar(SEED, 1);
    const p = atStreet(1);
    car.y = p.pos.y - PLAYER_HALF.y;
    car.speed = 0;
    const door = { x: 0, z: 0 };
    doorPlace(car, 0, door);
    car.x += p.pos.x - door.x;
    car.z += p.pos.z - door.z;
    const line = promptFor(p, [car], SEED);
    expect(line).not.toBeNull();
    expect(line).not.toBe(GO_IN);
    expect(promptFor(atStreet(1), [], SEED)).toBe(GO_IN);
    expect(promptFor(walker(arriveIn(room(1)), { place: 1, phase: INSIDE, ticks: 0 }), [car], SEED)).toBe(GO_OUT);
  }, timeLimit(60_000));
});

describe("the screen's dark", () => {
  it("is decided by the phase the host has told, dark going in and going out and clear otherwise", () => {
    const dark = (inside: Inside): boolean => darkFor(walker({ x: 0, y: 0, z: 0 }, inside));
    expect([dark(newInside()), dark({ place: 1, phase: GOING_IN, ticks: 5 }), dark({ place: 1, phase: INSIDE, ticks: 0 }), dark({ place: 1, phase: GOING_OUT, ticks: 5 })]).toEqual([false, true, false, true]);
    expect(darkFor(undefined)).toBe(false);
  });
});

describe("the page's black cover", () => {
  type El = { className: string; style: Record<string, string>; textContent: string; children: El[]; hidden: boolean; classList: { toggle(): void }; append(...c: El[]): void; remove(): void; addEventListener(): void };
  const made: El[] = [];
  const make = (): El => {
    const el: El = { className: "", style: {}, textContent: "", children: [], hidden: false, classList: { toggle: () => undefined }, append(...c) { this.children.push(...c); }, remove: () => undefined, addEventListener: () => undefined };
    made.push(el);
    return el;
  };
  afterEach(() => {
    vi.unstubAllGlobals();
    made.length = 0;
  });

  it("fades to black in 200 ms and clear in 450 ms, as a full-screen layer that takes no clicks, first in the page so every line is over it", () => {
    vi.stubGlobal("document", { createElement: make });
    const container = make();
    const hud = createWalkHud(container as unknown as HTMLElement, null);
    const root = container.children[1] as El;
    const cover = root.children[0] as El;
    expect(cover.className).toBe("dark");
    expect(root.children.map((c) => c.className)).toEqual(["dark", "line status", "line flash", "line prompt", ""]);
    // The style puts it over the whole screen, clear to begin with, and ignoring the pointer.
    const css = (container.children[0] as El).textContent;
    expect(css).toMatch(/\.walk-hud \.dark \{[^}]*inset: 0[^}]*opacity: 0[^}]*pointer-events: none/);
    hud.setDark(true);
    expect(cover.style.opacity).toBe("1");
    expect(cover.style.transition).toContain(`${DARK_MS}ms`);
    hud.setDark(false);
    expect(cover.style.opacity).toBe("0");
    expect(cover.style.transition).toContain(`${CLEAR_MS}ms`);
    expect([DARK_MS, CLEAR_MS]).toEqual([200, 450]);
  }, timeLimit(60_000));
});

describe("the console's goin", () => {
  const [spec] = INSIDE_COMMANDS;

  it("takes a place, bar, cafe, lodging, office or out, then a place of the room and a way to look, and leaves out of the address", () => {
    expect(INSIDE_COMMANDS).toHaveLength(1);
    expect(spec?.name).toBe("goin");
    expect(spec?.kind).toBe("view");
    for (const place of ["bar", "cafe", "lodging", "office", "out"]) expect(spec?.validate([place]), place).toBeNull();
    for (const ok of [["lodging", "room"], ["bar", "back"], ["cafe", "back", "front"], ["lodging", "flight", "left"], ["office", "gallery", "right"]]) expect(spec?.validate(ok), ok.join(" ")).toBeNull();
    for (const bad of [[], ["roof"], ["bar", "Cafe!"], [""], ["bar", "back", "up"], ["bar", "back", "front", "x"], ["out", "back"]]) expect(spec?.validate(bad), bad.join(" ")).toMatch(/goin takes/);
    expect(spec?.scriptValue?.(["out"])).toBe(spec?.defaultValue);
    expect(spec?.scriptValue?.(["bar"])).not.toBe(spec?.defaultValue);
    // The address keeps the whole of it.
    expect(spec?.scriptValue?.(["cafe", "back", "front"])).toBe("cafe back front");
  });

  it("turns the view toward the street, the back wall, left or right as one comes in", () => {
    const r = room(2);
    const dir = (face: string): { s: number; d: number } => {
      const yaw = faceYaw(r, face);
      const x = Math.sin(yaw);
      const z = Math.cos(yaw);
      return { s: x * r.tx + z * r.tz, d: -(x * r.nx + z * r.nz) };
    };
    expect(dir("front").d).toBeCloseTo(-1, 6);
    expect(dir("back").d).toBeCloseTo(1, 6);
    expect(dir("left").s).toBeCloseTo(-1, 6);
    expect(dir("right").s).toBeCloseTo(1, 6);
  });

  it("names rooms by their id in a world", () => {
    expect([goinTarget(SEED, "bar"), goinTarget(SEED, "cafe"), goinTarget(SEED, "lodging"), goinTarget(SEED, "office"), goinTarget(SEED, "out"), goinTarget(SEED, "roof")]).toEqual([1, 2, 3, 4, 0, undefined]);
  });

  /** A page's host with the parts the side reads, and a record of what the hud was told. */
  function pageHost(): { host: never; dark: boolean[]; flash: string[]; world: { current: unknown } } {
    const dark: boolean[] = [];
    const flash: string[] = [];
    const world = { current: null as unknown };
    const host = {
      base: { hour: 12 }, appliedHour: 12, appliedWeather: {}, renderer: { setView: () => undefined }, touchStart: false,
      touchModel: { interactDown: () => undefined, interactUp: () => undefined },
      ambient: { voice: () => ({ hz: 0, engine: 0, tyres: 0 }), car: () => undefined, thud: () => undefined, door: () => undefined },
      hud: { setDark: (d: boolean) => dark.push(d), setPrompt: () => undefined, flash: (l: string) => flash.push(l) },
      get activeWorld() { return world.current; },
    };
    return { host: host as never, dark, flash, world };
  }
  const stateOf = (world: ReturnType<typeof worldFor>) => world.state;

  it("waits for a world and a player when asked before either, as a link's address is read, then puts the host's player in the room", () => {
    const { host, flash, world: page } = pageHost();
    const side = createCapeSide(host, WALK_SIDE);
    // The address is read as the page loads: no world yet.
    expect(side.applyOwnView("goin", ["bar"])).toBe(true);
    const world = worldFor(SEED);
    world.state = { tick: 0, players: new Map(), nextEntityId: 1, rngSeed: SEED | 0, cars: [newCar(SEED, 1)] };
    // A frame with a world but no player yet: it keeps waiting.
    side.afterSync(world, stateOf(world), 1, undefined, null);
    side.hostStarted({ world } as never);
    page.current = world;
    const me = addPlayer(world, WALK_RULES);
    expect(me.inside.phase).toBe(OUTSIDE);
    side.afterSync(world, stateOf(world), me.id, me, null);
    expect(me.inside).toEqual({ place: 1, phase: INSIDE, ticks: 0 });
    expect(me.pos.y).toBeCloseTo(room(1).floorY + PLAYER_HALF.y, 9);
    expect(flash).toEqual([]);
    // Done once: a later frame does not put them back.
    me.inside = newInside();
    side.afterSync(world, stateOf(world), me.id, me, null);
    expect(me.inside.phase).toBe(OUTSIDE);
    // And out again.
    side.applyOwnView("goin", ["lodging"]);
    side.afterSync(world, stateOf(world), me.id, me, null);
    expect(me.inside.place).toBe(3);
    side.applyOwnView("goin", ["out"]);
    side.afterSync(world, stateOf(world), me.id, me, null);
    expect(me.inside).toEqual(newInside());
    expect(me.pos.y).toBeLessThan(room(3).floorY - 30);
  }, timeLimit(60_000));

  it("tells a follower only the host can, and does not move them", () => {
    const { host, flash } = pageHost();
    const side = createCapeSide(host, WALK_SIDE);
    const mine = worldFor(SEED);
    mine.state = { tick: 0, players: new Map(), nextEntityId: 1, rngSeed: SEED | 0, cars: [newCar(SEED, 1)] };
    side.hostStarted({ world: mine } as never);
    const theirs = { ...mine, state: { ...mine.state, players: new Map() } };
    const me = addPlayer(theirs, WALK_RULES);
    side.applyOwnView("goin", ["bar"]);
    side.afterSync(theirs, theirs.state, me.id, me, null);
    expect(me.inside.phase).toBe(OUTSIDE);
    expect(flash).toEqual([HOST_PUTS_IN]);
  }, timeLimit(60_000));

  it("sets the cover from the local player's phase every frame", () => {
    const { host, dark } = pageHost();
    const side = createCapeSide(host, WALK_SIDE);
    const me = atStreet(1);
    const world = worldFor(SEED);
    for (const inside of [newInside(), { place: 1, phase: GOING_IN, ticks: 9 } as Inside, { place: 1, phase: INSIDE, ticks: 0 } as Inside, { place: 1, phase: GOING_OUT, ticks: 9 } as Inside]) {
      me.inside = inside;
      side.afterSync(world, stateOf(world), me.id, me, null);
    }
    expect(dark).toEqual([false, true, false, true]);
  }, timeLimit(60_000));
});
