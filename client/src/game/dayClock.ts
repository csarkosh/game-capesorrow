/**
 * The day's clock: the hour of day moves on its own. Pure: no engine's page, no DOM.
 *
 * The hour is the console's hour (`base.hour`, set by `/time`) plus the time since that base was set, at `HOUR_S` real seconds to a
 * game hour (a 48 minute day), wrapped to 0 up to 24. The time is counted in the world's ticks (`state.tick`, which every peer
 * shares) with the engine's own tick length, never in wall-clock time, so every player sees one hour. The clock starts at tick 0
 * from the base's hour; when the console sets a new hour it starts again from that hour at the tick it is first seen.
 *
 * Pushing an hour to the renderer recomputes the sky (`setView`), which is dear, so `stepClock` says to push only when the hour has
 * moved more than `PUSH_GATE` of an hour from the one last applied, measured round the circle (23.99 to 0.0 is a move of 0.01).
 */
import { TICK_DT } from "@csarkosh/engine/sim/constants";

/** Real seconds to a game hour. */
export const HOUR_S = 120;
/** The least the hour must move from the one applied before it is pushed again, in hours. */
export const PUSH_GATE = 0.01;
const DAY = 24;

/** The clock's own memory: the console's hour it counts from, and the tick it was set at. */
export type DayClock = { baseHour: number; baseTick: number };

/** A clock that counts from `baseHour` at tick 0 (a world's start). */
export function startClock(baseHour: number): DayClock {
  return { baseHour, baseTick: 0 };
}

/** `h` wrapped to 0 up to 24. */
export function wrapHour(h: number): number {
  const m = h % DAY;
  return m < 0 ? m + DAY : m;
}

/** How far apart two hours are round the circle, 0 to 12. */
export function hourGap(a: number, b: number): number {
  const d = Math.abs(wrapHour(a) - wrapHour(b));
  return Math.min(d, DAY - d);
}

/** The hour at `tick` for a clock: its base hour plus the ticks since, wrapped. */
export function clockHour(clock: DayClock, tick: number): number {
  return wrapHour(clock.baseHour + ((tick - clock.baseTick) * TICK_DT) / HOUR_S);
}

/**
 * One frame of the clock. `baseHour` is the console's hour as it stands, `applied` the hour last pushed. A new base hour restarts
 * the clock from it at `tick` (and a tick before the clock's own, a new world, restarts it at tick 0). Returns the clock to keep
 * and the hour to push, or null when the hour is within the gate of `applied`. The clock is not changed in place.
 */
export function stepClock(clock: DayClock, baseHour: number, tick: number, applied: number): { clock: DayClock; push: number | null } {
  let c = clock;
  if (baseHour !== c.baseHour) c = { baseHour, baseTick: tick };
  else if (tick < c.baseTick) c = { baseHour, baseTick: 0 };
  const hour = clockHour(c, tick);
  return { clock: c, push: hourGap(hour, applied) > PUSH_GATE ? hour : null };
}
