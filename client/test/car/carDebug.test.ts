import { describe, expect, it } from "vitest";
import { carDebug } from "../../src/game/car/carDebug.js";
import { newCarPose } from "../../src/game/car/carPose.js";
import { doorPlace } from "../../src/sim/car/seats.js";
import { SEATED, type Car, type Ride } from "../../src/sim/car/types.js";

const car: Car = { id: 1, x: 5, y: 1, z: 7, hx: 0, hz: 1, speed: 3, slip: 0, steer: 0.2, controls: { throttle: 1, turn: 0, handbrake: false }, lights: true, seats: [9, 0, 0, 0] };
const pose = newCarPose();
Object.assign(pose, { id: 1, x: 5, y: 1.1, z: 7, hx: 0, hz: 1, speed: 3, steer: 0.2, lights: true, driver: 9 });
const players = new Map([[9, { pos: { x: 5, y: 1.6, z: 7 }, yaw: 0.5, pitch: -0.1, ride: { car: 1, seat: 0, phase: SEATED, ticks: 4 } as Ride }]]);
const debug = carDebug({ state: () => ({ cars: [car], localId: 9, players }), pose: (id) => (id === 1 ? pose : null) });

describe("the car's reading for measuring tools", () => {
  it("answers for the cars, the local player and the doors", () => {
    expect(debug.cars()).toEqual([{ id: 1, x: 5, y: 1.1, z: 7, hx: 0, hz: 1, speed: 3, steer: 0.2, lights: true, driver: 9, seats: [9, 0, 0, 0] }]);
    expect(debug.self()).toEqual({ x: 5, y: 1.6, z: 7, yaw: 0.5, pitch: -0.1, ride: { car: 1, seat: 0, phase: SEATED, ticks: 4 } });
    const doors = debug.doors(1);
    expect(doors).toHaveLength(4);
    const want = { x: 0, z: 0 };
    doorPlace(car, 0, want);
    expect(doors[0]).toEqual(want);
    expect(debug.doors(99)).toEqual([]);
  });

  it("gives copies: changing an answer changes neither the next answer nor the game's records", () => {
    const a = debug.cars();
    (a[0] as { x: number; seats: number[] }).x = 999;
    (a[0] as { seats: number[] }).seats[0] = 0;
    const s = debug.self();
    (s as { ride: { car: number } }).ride.car = 42;
    debug.doors(1)[0]!.x = 123;
    expect(debug.cars()[0]?.x).toBe(5);
    expect(debug.cars()[0]?.seats).toEqual([9, 0, 0, 0]);
    expect(debug.self()?.ride.car).toBe(1);
    expect(car.seats[0]).toBe(9);
    expect(players.get(9)?.ride?.car).toBe(1);
    expect(debug.doors(1)[0]?.x).not.toBe(123);
  });

  it("answers the camera as a copy, and null where the camera is the walker's", () => {
    const held = { x: 1, y: 2, z: 3, yaw: 0.5, pitch: 0.1, fov: 1.2, seated: 0.5, pulled: 4.5 };
    let on = true;
    const withCamera = carDebug({ state: () => null, pose: () => null, camera: () => (on ? held : null) });
    const a = withCamera.camera();
    expect(a).toEqual(held);
    (a as { x: number }).x = 99;
    expect(withCamera.camera()?.x).toBe(1);
    on = false;
    expect(withCamera.camera()).toBeNull();
    expect(carDebug({ state: () => null, pose: () => null }).camera()).toBeNull();
  });

  it("answers nothing before there is a state", () => {
    const none = carDebug({ state: () => null, pose: () => null });
    expect(none.cars()).toEqual([]);
    expect(none.self()).toBeNull();
    expect(none.doors(1)).toEqual([]);
  });
});
