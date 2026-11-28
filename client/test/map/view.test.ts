import { describe, expect, it } from "vitest";
import { mapFrameFor } from "../../src/game/map/mapFeed.js";
import { DRIVE_ACROSS, FOOT_ACROSS, LOOK_SECONDS, MAX_MPP, MIN_MPP, NIGHT_SECONDS, aimView, directionOnScreen, eased, isNight, largeView, minimapScale, minimapView, moving, newViewState, openLarge, panLarge, screenToWorld, snapView, stepView, worldToScreen, wrapPi, zoomLarge } from "../../src/game/map/mapView.js";
import { newRide } from "../../src/sim/car/rules.js";
import { GOING_IN, GOING_OUT, INSIDE, OUTSIDE, newInside } from "../../src/sim/inside/rooms.js";
import { ENTERING, FOOT, LEAVING, SEATED, type Car, type Ride } from "../../src/sim/car/types.js";
import type { Walker } from "../../src/sim.js";

const walker = (ride: Ride = newRide(), inside: Walker["inside"] = newInside(), yaw = 0.5): Walker => ({ id: 7, pos: { x: 100, y: 0, z: 200 }, vel: { x: 0, y: 0, z: 0 }, yaw, pitch: 0, grounded: true, lastProcessedInput: 0, ride, inside });
const car = (over: Partial<Car> = {}): Car => ({ id: 3, x: 110, y: 0, z: 210, hx: 0.6, hz: 0.8, speed: 5, slip: 0, steer: 0, controls: { throttle: 0, turn: 0, handbrake: false }, lights: false, owed: 0, seats: [7, 0, 0, 0], ...over });

describe("what the map is told of the local player", () => {
  it("follows the ride: on foot is the walker's place and facing, seated is the car's place and nose", () => {
    const foot = mapFrameFor(1, [car()], walker(), 12, true, false)!;
    expect([foot.driving, foot.x, foot.z, foot.heading]).toEqual([false, 100, 200, 0.5]);
    const seat = mapFrameFor(1, [car()], walker({ car: 3, seat: 0, phase: SEATED, ticks: 0 }), 12, true, false)!;
    expect(seat.driving).toBe(true);
    expect([seat.x, seat.z]).toEqual([110, 210]);
    // The car's nose, whatever the free look is: the heading of (0.6, 0.8) about the vector (sin, cos).
    expect(Math.sin(seat.heading)).toBeCloseTo(0.6, 6);
    expect(Math.cos(seat.heading)).toBeCloseTo(0.8, 6);
    // Getting in or out is still on foot; a car that is not in the list is no car.
    for (const phase of [ENTERING, LEAVING, FOOT] as Ride["phase"][]) expect(mapFrameFor(1, [car()], walker({ car: 3, seat: 0, phase, ticks: 5 }), 12, true, false)!.driving, `${phase}`).toBe(false);
    expect(mapFrameFor(1, [], walker({ car: 3, seat: 0, phase: SEATED, ticks: 0 }), 12, true, false)!.driving).toBe(false);
  });

  it("names the room only while the player is in it, and has nothing without a player or a world", () => {
    expect(mapFrameFor(1, [], walker(newRide(), { place: 2, phase: INSIDE, ticks: 0 }), 12, true, false)!.place).toBe(2);
    expect(mapFrameFor(1, [], walker(newRide(), { place: 2, phase: GOING_OUT, ticks: 3 }), 12, true, false)!.place).toBe(2);
    expect(mapFrameFor(1, [], walker(newRide(), { place: 2, phase: GOING_IN, ticks: 3 }), 12, true, false)!.place).toBe(0);
    expect(mapFrameFor(1, [], walker(newRide(), { place: 0, phase: OUTSIDE, ticks: 0 }), 12, true, false)!.place).toBe(0);
    expect(mapFrameFor(1, [], undefined, 12, true, false)).toBeNull();
    expect(mapFrameFor(null, [], walker(), 12, true, false)).toBeNull();
  });
});

describe("the view's maths", () => {
  const out = { x: 0, y: 0 };

  it("is north up on foot: east to the right, north up the screen, the player at the middle", () => {
    const v = minimapView(newViewState(), 220, 220, 1000, 2000, 1.2);
    expect(v.turn).toBeCloseTo(0, 12);
    expect([v.markX, v.markY]).toEqual([110, 110]);
    worldToScreen(v, 1000, 2000, out);
    expect([out.x, out.y]).toEqual([110, 110]);
    worldToScreen(v, 1000 + 50 * v.mpp, 2000, out);
    expect(out.x).toBeCloseTo(160, 6);
    worldToScreen(v, 1000, 2000 + 50 * v.mpp, out);
    expect(out.y).toBeCloseTo(60, 6);
    // 180 m across the minimap.
    expect(v.mpp * 220).toBeCloseTo(FOOT_ACROSS, 6);
  });

  it("points the facing cone on foot to (sin yaw, -cos yaw) on the screen, whatever the yaw", () => {
    for (const yaw of [0, 0.3, 1.2, 2.5, -1, -2.9, Math.PI]) {
      const v = minimapView(newViewState(), 220, 220, 0, 0, yaw);
      directionOnScreen(v, Math.sin(yaw), Math.cos(yaw), out);
      expect(out.x, `${yaw}`).toBeCloseTo(Math.sin(yaw), 9);
      expect(out.y, `${yaw}`).toBeCloseTo(-Math.cos(yaw), 9);
    }
  });

  it("is heading up driving: a point ahead of the car is above the mark, and the mark sits a third of the way up", () => {
    const s = newViewState();
    snapView(s, true, false);
    for (const h of [0, 0.7, 2, -1.5, 3.1]) {
      const v = minimapView(s, 220, 220, 500, -300, h);
      expect(v.markY).toBeCloseTo((220 * 2) / 3, 6);
      expect(v.markX).toBe(110);
      const ahead = worldToScreen(v, 500 + Math.sin(h) * 80, -300 + Math.cos(h) * 80, { x: 0, y: 0 });
      expect(ahead.x, `${h}`).toBeCloseTo(110, 6);
      expect(ahead.y, `${h}`).toBeLessThan(v.markY);
      // A point to the right of the car (by its heading) is to the right on the screen.
      const right = worldToScreen(v, 500 + Math.cos(h) * 40, -300 - Math.sin(h) * 40, { x: 0, y: 0 });
      expect(right.x).toBeGreaterThan(110);
      expect(v.mpp * 220).toBeCloseTo(DRIVE_ACROSS, 6);
    }
  });

  it("agrees between the world and the screen, both ways, in every view", () => {
    const s = newViewState();
    const views = [minimapView(s, 220, 220, 12, 34, 0.9), largeView({ ...s, lcx: 55, lcz: -77, lmpp: 2.5 }, 800, 600)];
    s.look = 0.37;
    views.push(minimapView(s, 148, 148, -50, 20, -2));
    for (const v of views) {
      for (const [x, z] of [[0, 0], [100, -50], [-400, 900], [12, 34]] as const) {
        const p = worldToScreen(v, x, z, { x: 0, y: 0 });
        const w = screenToWorld(v, p.x, p.y, { x: 0, z: 0 });
        expect(w.x).toBeCloseTo(x, 6);
        expect(w.z).toBeCloseTo(z, 6);
      }
    }
  });

  it("opens the large map on the player at the minimap's scale, north up, and holds zoom to 0.25 to 8 m a pixel", () => {
    const s = newViewState();
    const mm = minimapView(s, 220, 220, 5, 6, 1);
    openLarge(s, 5, 6, mm.mpp);
    const big = largeView(s, 800, 600);
    expect([big.cx, big.cz, big.mpp, big.turn]).toEqual([5, 6, mm.mpp, 0]);
    for (let i = 0; i < 40; i++) zoomLarge(s, 1.7, 400, 300, 800, 600);
    expect(s.lmpp).toBe(MIN_MPP);
    for (let i = 0; i < 60; i++) zoomLarge(s, 1 / 1.7, 400, 300, 800, 600);
    expect(s.lmpp).toBe(MAX_MPP);
    // A scale asked for beyond the limits is held to them.
    openLarge(s, 0, 0, 100);
    expect(s.lmpp).toBe(MAX_MPP);
    openLarge(s, 0, 0, 0.001);
    expect(s.lmpp).toBe(MIN_MPP);
  });

  it("keeps the point under the pointer where it is when it zooms, and follows a drag", () => {
    const s = newViewState();
    openLarge(s, 100, 100, 1);
    const at = (): { x: number; z: number } => screenToWorld(largeView(s, 800, 600), 650, 120, { x: 0, z: 0 });
    const before = at();
    zoomLarge(s, 2.3, 650, 120, 800, 600);
    expect(s.lmpp).toBeCloseTo(1 / 2.3, 9);
    expect(at().x).toBeCloseTo(before.x, 6);
    expect(at().z).toBeCloseTo(before.z, 6);
    // Dragging the map 40 px right and 10 down moves what is under the pointer with it.
    const p = worldToScreen(largeView(s, 800, 600), 100, 100, { x: 0, y: 0 });
    panLarge(s, 40, 10);
    const q = worldToScreen(largeView(s, 800, 600), 100, 100, { x: 0, y: 0 });
    expect(q.x - p.x).toBeCloseTo(40, 6);
    expect(q.y - p.y).toBeCloseTo(10, 6);
  });

  it("eases the look in 0.6 s and the night in 0.5 s, and ends exactly at its target", () => {
    const s = newViewState();
    expect(moving(s)).toBe(false);
    aimView(s, true, true);
    expect(moving(s)).toBe(true);
    stepView(s, 0.3);
    expect(s.look).toBeCloseTo(0.3 / LOOK_SECONDS, 9);
    expect(s.night).toBeCloseTo(0.3 / NIGHT_SECONDS, 9);
    // The scale, the turn and the mark's place are between the two looks, partway.
    const mid = minimapView(s, 220, 220, 0, 0, 1);
    expect(mid.mpp).toBeGreaterThan(FOOT_ACROSS / 220);
    expect(mid.mpp).toBeLessThan(DRIVE_ACROSS / 220);
    expect(mid.markY).toBeGreaterThan(110);
    expect(mid.markY).toBeLessThan(220 * (2 / 3));
    stepView(s, 0.3);
    expect(s.look).toBe(1);
    expect(s.night).toBe(1);
    expect(moving(s)).toBe(false);
    aimView(s, false, false);
    for (let i = 0; i < 100; i++) stepView(s, 0.016);
    expect([s.look, s.night]).toEqual([0, 0]);
    expect(minimapScale(eased(0), 220, 220)).toBeCloseTo(FOOT_ACROSS / 220, 9);
    expect(minimapScale(eased(1), 220, 220)).toBeCloseTo(DRIVE_ACROSS / 220, 9);
  });

  it("is night from 19:00 to 6:00", () => {
    expect([5.99, 6, 12, 18.99, 19, 23.5, 0].map(isNight)).toEqual([true, false, false, false, true, true, true]);
    expect(Math.abs(wrapPi(3 * Math.PI))).toBeCloseTo(Math.PI, 9);
    expect(Math.abs(wrapPi(-3 * Math.PI))).toBeCloseTo(Math.PI, 9);
  });
});
