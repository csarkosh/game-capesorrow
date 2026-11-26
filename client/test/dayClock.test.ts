import { describe, expect, it } from "vitest";
import { TICK_DT } from "@csarkosh/engine/sim/constants";
import { HOUR_S, PUSH_GATE, clockHour, hourGap, startClock, stepClock, wrapHour } from "../src/game/dayClock.js";

const TICKS_PER_HOUR = HOUR_S / TICK_DT;

describe("the day's clock", () => {
  it("runs at 120 real seconds to a game hour and wraps at 24", () => {
    const c = startClock(12);
    expect(clockHour(c, 0)).toBe(12);
    expect(clockHour(c, TICKS_PER_HOUR)).toBeCloseTo(13, 9);
    expect(clockHour(c, TICKS_PER_HOUR * 12.5)).toBeCloseTo(0.5, 9);
    expect(clockHour(startClock(23.5), TICKS_PER_HOUR)).toBeCloseTo(0.5, 9);
    expect(wrapHour(-1)).toBe(23);
    expect(wrapHour(48.25)).toBeCloseTo(0.25, 9);
  });

  it("restarts from a new base hour at the tick it is first seen", () => {
    let c = startClock(12);
    const first = stepClock(c, 12, 1000, 12);
    c = first.clock;
    expect(c).toEqual({ baseHour: 12, baseTick: 0 });
    const set = stepClock(c, 22, 5000, 12);
    expect(set.clock).toEqual({ baseHour: 22, baseTick: 5000 });
    expect(set.push).toBe(22);
    expect(clockHour(set.clock, 5000 + TICKS_PER_HOUR)).toBeCloseTo(23, 9);
  });

  it("restarts at tick 0 when the world's tick goes back", () => {
    const r = stepClock({ baseHour: 8, baseTick: 9000 }, 8, 10, 8);
    expect(r.clock).toEqual({ baseHour: 8, baseTick: 0 });
  });

  it("gates the push by the hour's move from the applied hour, round midnight too", () => {
    const c = startClock(23.99);
    expect(stepClock(c, 23.99, 0, 23.99).push).toBeNull();
    const ticksFor = (h: number): number => Math.ceil(h * TICKS_PER_HOUR);
    // 23.99 to 0.0 is 0.01: not past the gate.
    expect(hourGap(23.99, 0)).toBeCloseTo(0.01, 9);
    expect(stepClock(c, 23.99, ticksFor(PUSH_GATE * 0.9), 23.99).push).toBeNull();
    const past = stepClock(c, 23.99, ticksFor(0.02), 23.99);
    expect(past.push).not.toBeNull();
    expect(past.push as number).toBeCloseTo(0.01, 2);
    // And an applied hour on the far side of midnight is near, not 24 away.
    expect(stepClock(startClock(0.005), 0.005, 0, 23.999).push).toBeNull();
  });
});
