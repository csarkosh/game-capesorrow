import { describe, expect, it } from "vitest";
import { createIndoorWeather, dry, indoors, INDOOR_HUSH } from "../../src/game/insideWeather.js";
import { GOING_IN, GOING_OUT, INSIDE, OUTSIDE } from "../../src/sim/inside/rooms.js";

const RAIN = { cloudCover: 1, mist: 0.6, rain: 1, wetness: 1, dread: 0 };
const at = (phase: 0 | 1 | 2 | 3) => ({ place: 1, phase, ticks: 0 });

function host() {
  const calls: string[] = [];
  const h = {
    renderer: { setView: (hour: number, w: typeof RAIN) => void calls.push(`view ${hour} rain ${w.rain} wet ${w.wetness}`) },
    ambient: { setHush: (s: number) => void calls.push(`hush ${s}`) },
    appliedHour: 9,
    appliedWeather: RAIN,
  };
  return { h, calls };
}

describe("the weather of a player in a room", () => {
  it("is a room's from the hold at the street door until the way out", () => {
    expect(([OUTSIDE, GOING_IN, INSIDE, GOING_OUT] as const).map((p) => indoors(at(p)))).toEqual([false, true, true, false]);
    expect(indoors(undefined)).toBe(false);
  });
  it("takes the rain out and nothing else", () => {
    expect(dry(RAIN)).toEqual({ ...RAIN, rain: 0 });
  });
  it("puts the view's rain out at once going in, hushes the sound, and puts both back going out", () => {
    const { h, calls } = host();
    const w = createIndoorWeather(h);
    w.step(at(OUTSIDE));
    expect(calls).toEqual([]);
    w.step(at(GOING_IN));
    w.step(at(INSIDE));
    expect(calls).toEqual(["view 9 rain 0 wet 1", `hush ${INDOOR_HUSH}`]);
    expect(w.weather().rain).toBe(0);
    w.step(at(GOING_OUT));
    expect(calls.slice(2)).toEqual(["view 9 rain 1 wet 1", "hush 0"]);
    expect(w.weather().rain).toBe(1);
  });
  it("puts the rain out again when the console changes the weather in a room", () => {
    const { h, calls } = host();
    const w = createIndoorWeather(h);
    w.step(at(INSIDE));
    h.appliedWeather = { ...RAIN, rain: 0.5 };
    w.step(at(INSIDE));
    expect(calls.filter((c) => c.startsWith("view"))).toEqual(["view 9 rain 0 wet 1", "view 9 rain 0 wet 1"]);
  });
});
