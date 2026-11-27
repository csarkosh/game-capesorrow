import { describe, expect, it } from "vitest";
import { GEAR_SPEEDS, HEARD_WITHIN, THUD_DROP, carSound, carVoice, thudStrength, type CarMark } from "../../src/game/car/carSound.js";
import { GRAVEL, OPEN, PAVED, TRACKS } from "../../src/sim/car/types.js";
import { FakeContext, FakeNode, reaches } from "./fakeAudio.js";

describe("the car's voice", () => {
  it("idles near 40 Hz and the note rises with speed within a gear", () => {
    expect(carVoice(0, 0, PAVED, 0).hz).toBeCloseTo(40, 0);
    expect(carVoice(8, 1, PAVED, 0).hz).toBeGreaterThan(carVoice(4, 1, PAVED, 0).hz);
    expect(carVoice(18, 1, PAVED, 0).hz).toBeGreaterThan(carVoice(12, 1, PAVED, 0).hz);
    expect(carVoice(29, 1, PAVED, 0).hz).toBeGreaterThan(carVoice(21, 1, PAVED, 0).hz);
  });

  it("drops the note at each gear change, and never past the top of the range", () => {
    for (const g of GEAR_SPEEDS) {
      expect(carVoice(g + 0.01, 1, PAVED, 0).hz).toBeLessThan(carVoice(g - 0.01, 1, PAVED, 0).hz);
    }
    expect(carVoice(60, 1, PAVED, 0).hz).toBe(carVoice(30, 1, PAVED, 0).hz);
    expect(carVoice(-12, 1, PAVED, 0).hz).toBe(carVoice(12, 1, PAVED, 0).hz);
  });

  it("is louder under throttle than coasting at the same speed", () => {
    for (const speed of [0, 5, 20]) {
      expect(carVoice(speed, 1, PAVED, 0).engine).toBeGreaterThan(carVoice(speed, 0, PAVED, 0).engine);
    }
    expect(carVoice(5, 0, PAVED, 0).engine).toBeGreaterThan(0);
  });

  it("makes the tyres louder on gravel than on pavement, and silent at rest", () => {
    expect(carVoice(10, 0, GRAVEL, 0).tyres).toBeGreaterThan(carVoice(10, 0, PAVED, 0).tyres);
    expect(carVoice(10, 0, TRACKS, 0).tyres).toBeGreaterThan(carVoice(10, 0, PAVED, 0).tyres);
    expect(carVoice(10, 0, OPEN, 0).tyres).toBeGreaterThan(carVoice(10, 0, PAVED, 0).tyres);
    for (const s of [PAVED, GRAVEL, TRACKS, OPEN] as const) expect(carVoice(0, 1, s, 0).tyres).toBe(0);
    expect(carVoice(30, 1, GRAVEL, 0).tyres).toBeLessThanOrEqual(1);
  });

  it("has no engine in a car with nobody at the wheel, and tyres only while it rolls", () => {
    expect(carVoice(0, 0, PAVED, 0, false).engine).toBe(0);
    expect(carVoice(5, 0, PAVED, 0, false)).toMatchObject({ engine: 0 });
    expect(carVoice(5, 0, PAVED, 0, false).tyres).toBeGreaterThan(0);
    expect(carVoice(0, 0, PAVED, 0, false).tyres).toBe(0);
    expect(carVoice(0, 0, PAVED, 0, true).engine).toBeGreaterThan(0);
  });

  it("writes into the record it is given and returns it", () => {
    const out = { hz: 0, engine: 0, tyres: 0 };
    expect(carVoice(8, 1, GRAVEL, 3, true, out)).toBe(out);
    expect(out).toEqual(carVoice(8, 1, GRAVEL, 3));
  });

  it("falls with distance and is silent past 80 m", () => {
    expect(carVoice(20, 1, PAVED, 81)).toMatchObject({ engine: 0, tyres: 0 });
    expect(carVoice(20, 1, PAVED, HEARD_WITHIN)).toMatchObject({ engine: 0, tyres: 0 });
    const near = carVoice(20, 1, GRAVEL, 5), mid = carVoice(20, 1, GRAVEL, 40), far = carVoice(20, 1, GRAVEL, 79);
    expect(near.engine).toBeGreaterThan(mid.engine);
    expect(mid.engine).toBeGreaterThan(far.engine);
    expect(far.engine).toBeGreaterThan(0);
    expect(near.tyres).toBeGreaterThan(mid.tyres);
    expect(carVoice(20, 1, PAVED, 0).engine).toBeLessThanOrEqual(1);
  });
});

const mark = (over: Partial<CarMark> = {}): CarMark => ({ tick: 100, x: 0, z: 0, speed: 20, ...over });

describe("when a car hits something hard enough to thud", () => {
  it("answers a strength for a fall of more than 3 m/s in one tick, and none for less", () => {
    expect(thudStrength(mark(), mark({ tick: 101, speed: 20 - THUD_DROP - 0.5 }))).toBeGreaterThan(0);
    expect(thudStrength(mark(), mark({ tick: 101, speed: 20 - THUD_DROP + 0.1 }))).toBe(0);
    expect(thudStrength(mark(), mark({ tick: 101, speed: 19.9 }))).toBe(0);
  });

  it("scales the threshold by the ticks the frame spans", () => {
    expect(thudStrength(mark(), mark({ tick: 103, speed: 20 - 2 * THUD_DROP }))).toBe(0);
    expect(thudStrength(mark(), mark({ tick: 103, speed: 20 - 4 * THUD_DROP }))).toBeGreaterThan(0);
  });

  it("is louder for a harder stop, within 0 to 1", () => {
    const soft = thudStrength(mark(), mark({ tick: 101, speed: 15 }));
    const hard = thudStrength(mark(), mark({ tick: 101, speed: 0 }));
    expect(hard).toBeGreaterThan(soft);
    expect(hard).toBeLessThanOrEqual(1);
    expect(soft).toBeGreaterThan(0);
  });

  it("counts a car in reverse by its speed and not its sign, and not a car speeding up", () => {
    expect(thudStrength(mark({ speed: -6 }), mark({ tick: 101, speed: 0 }))).toBeGreaterThan(0);
    expect(thudStrength(mark({ speed: 0 }), mark({ tick: 101, speed: 10 }))).toBe(0);
  });

  it("is silent when the car was brought back (it moved far with no speed to cover it) or the frame is no later", () => {
    expect(thudStrength(mark(), mark({ tick: 101, speed: 0, x: 300, z: -200 }))).toBe(0);
    expect(thudStrength(mark(), mark({ tick: 100, speed: 0 }))).toBe(0);
    expect(thudStrength(mark(), mark({ tick: 90, speed: 0 }))).toBe(0);
    // A long gap is a tab come back, not a stop.
    expect(thudStrength(mark(), mark({ tick: 100 + 600, speed: 0 }))).toBe(0);
  });
});

/** The gains the voices end in: the ones that feed the bus directly. */
const voices = (ctx: FakeContext, bus: FakeNode): FakeNode[] => ctx.of("gain").filter((n) => n.outputs.has(bus));

type Rig = { ctx: FakeContext; side: ReturnType<typeof carSound>["side"]; api: ReturnType<typeof carSound>["api"]; bus: FakeNode; noise: unknown };

function rig(): Rig {
  const ctx = new FakeContext();
  const { side, api } = carSound();
  const bus = new FakeNode("world", ctx);
  const noise = { duration: 2 };
  side.unlocked({ ctx, noise, world: bus, scene: new FakeNode("scene", ctx), master: new FakeNode("master", ctx), ear: {}, random: () => 0.5, muffle: () => undefined } as never);
  return { ctx, side, api, bus, noise };
}

describe("the car's graph", () => {
  it("makes nothing before unlock, and ignores the voice's calls then", () => {
    const { side, api } = carSound();
    expect(() => {
      api.car({ speed: 10, throttle: 1, surface: PAVED, distance: 3, driven: true });
      api.thud(1);
      api.door();
    }).not.toThrow();
    expect(() => side.disposed()).not.toThrow();
  });

  it("builds on unlock: two saws and the looped noise, started once, all reaching the world's bus", () => {
    const { ctx, bus, noise } = rig();
    const saws = ctx.of("oscillator");
    expect(saws).toHaveLength(2);
    for (const s of saws) expect(s.type).toBe("sawtooth");
    const sources = ctx.of("source");
    expect(sources).toHaveLength(1);
    expect(sources[0]?.loop).toBe(true);
    expect(sources[0]?.buffer).toBe(noise);
    for (const n of [...saws, ...sources]) {
      expect(n.started).toBe(1);
      expect(reaches(n, bus)).toBe(true);
    }
    // Everything starts silent.
    const out = voices(ctx, bus);
    expect(out).toHaveLength(2);
    for (const g of out) expect(g.gain.target()).toBe(0);
  });

  it("follows the voice, smoothed, without making a node per call, and never starts a source again", () => {
    const { ctx, api, bus } = rig();
    const made = ctx.nodes.length, started = ctx.starts;
    const feed = { speed: 20, throttle: 1, surface: GRAVEL as 1, distance: 4, driven: true };
    for (let i = 0; i < 50; i++) {
      ctx.now += 0.016;
      api.car(feed);
    }
    expect(ctx.nodes.length).toBe(made);
    expect(ctx.starts).toBe(started);
    const want = carVoice(20, 1, GRAVEL, 4);
    const [low, high] = ctx.of("oscillator");
    expect((low as FakeNode).frequency.target()).toBeCloseTo(want.hz, 3);
    expect((high as FakeNode).frequency.target()).toBeCloseTo(want.hz * 1.5, 3);
    const gains = voices(ctx, bus).map((g) => g.gain.target());
    expect(Math.max(...gains)).toBeGreaterThan(0);
    for (const n of ctx.nodes) for (const c of [...n.gain.calls, ...n.frequency.calls]) expect(c.kind).not.toBe("set");
  });

  it("works the voice out into one record, the same one every frame, with no bare change of a running parameter", () => {
    const { ctx, api } = rig();
    const bare = ctx.nodes.map((n) => [n.gain.bare, n.frequency.bare, n.detune.bare, n.Q.bare]);
    const first = api.voice();
    for (let i = 0; i < 100; i++) {
      ctx.now += 0.016;
      api.car({ speed: i % 30, throttle: 1, surface: GRAVEL, distance: 4, driven: true });
      expect(api.voice()).toBe(first);
    }
    expect(first).toEqual(carVoice(99 % 30, 1, GRAVEL, 4));
    expect(ctx.nodes.map((n) => [n.gain.bare, n.frequency.bare, n.detune.bare, n.Q.bare])).toEqual(bare);
  });

  it("eases every change over the time constant chosen", () => {
    const { ctx, api } = rig();
    api.car({ speed: 10, throttle: 1, surface: PAVED, distance: 2, driven: true });
    const targets = ctx.nodes.flatMap((n) => [...n.gain.calls, ...n.frequency.calls]).filter((c) => c.kind === "target");
    expect(targets.length).toBeGreaterThan(0);
    for (const c of targets) expect(c.constant).toBe(0.06);
  });

  it("keeps the engine and the tyres well under full scale at their loudest", () => {
    const { ctx, api, bus } = rig();
    api.car({ speed: 30, throttle: 1, surface: GRAVEL, distance: 0, driven: true });
    ctx.now += 0.3;
    // The loudest path from each source to the bus: the gains along it multiplied (a saw and the noise are at most 1 before them).
    const best = (n: FakeNode): number => {
      if (n === bus) return 1;
      let top = 0;
      for (const o of n.outputs) top = Math.max(top, best(o));
      return top * (n.kind === "gain" ? n.gain.target() : 1);
    };
    const total = [...ctx.of("oscillator"), ...ctx.of("source")].reduce((sum, n) => sum + best(n), 0);
    expect(total).toBeGreaterThan(0.05);
    expect(total).toBeLessThan(0.3);
  });

  it("falls silent when the page stops feeding it", () => {
    const { ctx, api, bus } = rig();
    api.car({ speed: 20, throttle: 1, surface: PAVED, distance: 2, driven: true });
    expect(Math.max(...voices(ctx, bus).map((g) => g.gain.target()))).toBeGreaterThan(0);
    ctx.now += 5;
    expect(Math.max(...voices(ctx, bus).map((g) => g.gain.target()))).toBe(0);
  });

  it("falls silent when given no car", () => {
    const { ctx, api, bus } = rig();
    api.car({ speed: 20, throttle: 1, surface: PAVED, distance: 2, driven: true });
    api.car(null);
    expect(Math.max(...voices(ctx, bus).map((g) => g.gain.target()))).toBe(0);
  });

  it("plays a thud and a door as one-shots that stop and disconnect themselves, with an attack", () => {
    const { ctx, api, bus } = rig();
    const before = ctx.of("source").length;
    api.thud(1);
    api.door();
    const shots = ctx.of("source").slice(before);
    expect(shots).toHaveLength(2);
    for (const s of shots) {
      expect(s.started).toBe(1);
      expect(s.stopped).toBe(1);
      expect(reaches(s, bus)).toBe(true);
    }
    const envelopes = ctx.nodes.filter((n) => n.kind === "gain" && n.gain.calls.some((c) => c.kind === "ramp" && c.value > 0));
    expect(envelopes).toHaveLength(2);
    for (const e of envelopes) {
      const first = e.gain.calls[0];
      expect(first?.value).toBe(0);
      const up = e.gain.calls.find((c) => c.kind === "ramp" && c.value > 0);
      expect((up?.at ?? 0) - ctx.now).toBeGreaterThanOrEqual(0.003);
      expect((up?.at ?? 1) - ctx.now).toBeLessThan(0.02);
      expect(up?.value).toBeLessThan(0.4);
    }
    // The shot is done: its end takes it out of the graph.
    for (const s of shots) s.onended?.();
    for (const s of shots) expect(s.disconnected).toBeGreaterThan(0);
  });

  it("stops every source and disconnects every node on disposal, the one-shots in flight too, and goes inert", () => {
    const { ctx, api, side } = rig();
    api.thud(0.8);
    api.door();
    side.disposed();
    for (const n of ctx.nodes) {
      if (n.kind === "oscillator" || n.kind === "source") expect(n.stopped).toBeGreaterThanOrEqual(1);
      expect(n.disconnected).toBeGreaterThan(0);
    }
    const made = ctx.nodes.length;
    api.car({ speed: 10, throttle: 1, surface: PAVED, distance: 1, driven: true });
    api.thud(1);
    api.door();
    expect(ctx.nodes.length).toBe(made);
  });

  it("builds again when the bus unlocks again after a disposal", () => {
    const { ctx, side } = rig();
    side.disposed();
    const bus = new FakeNode("world", ctx);
    side.unlocked({ ctx, noise: {}, world: bus, scene: bus, master: bus, ear: {}, random: () => 0.5, muffle: () => undefined } as never);
    const live = ctx.of("oscillator").filter((o) => o.stopped === 0);
    expect(live).toHaveLength(2);
    for (const o of live) expect(reaches(o, bus)).toBe(true);
  });
});
