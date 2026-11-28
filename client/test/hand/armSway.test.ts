import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { LEFT_ARM, LOWER_SHARE, MAX_DIP, MAX_PITCH, MAX_ROLL, RIGHT_ARM, createArmSway, type Sway } from "../../src/game/hand/armSway.js";

const DT = 1 / 60;
const DEG = Math.PI / 180;

/** Runs the sway over a path of one arm's `raised` (the other hidden), and returns every frame's offset. */
function run(path: (t: number) => number, seconds: number, side: "right" | "left" = "right", scale = 0.5): { t: number; s: Sway }[] {
  const sway = createArmSway();
  const out: { t: number; s: Sway }[] = [];
  const at = (t: number): [number | null, number | null] => (side === "right" ? [path(t), null] : [null, path(t)]);
  sway.step(DT, ...at(0), scale, false);
  for (let i = 1; i <= Math.round(seconds / DT); i++) {
    const t = i * DT;
    const s = sway.step(DT, ...at(t), scale, false);
    out.push({ t, s: { ...s } });
  }
  return out;
}

const rise = (over: number) => (t: number): number => Math.min(1, t / over);

describe("what an arm coming up does to the view", () => {
  it("dips the eye, pitches it down and rolls it toward the right arm, peaking near the middle of the raise, at about the tuned size", () => {
    const frames = run(rise(0.25), 1);
    const peakDip = Math.min(...frames.map((f) => f.s.dy));
    const at = frames.find((f) => f.s.dy === peakDip) as { t: number; s: Sway };
    // About 1.5 cm, 0.8 degrees down and 0.5 degrees to the right (a negative roll), at the middle of the 0.25 s raise or a little after.
    expect(peakDip).toBeLessThan(-0.012);
    expect(peakDip).toBeGreaterThan(-0.018);
    expect(at.t).toBeGreaterThan(0.08);
    expect(at.t).toBeLessThan(0.22);
    expect(at.s.pitch / DEG).toBeGreaterThan(0.6);
    expect(at.s.pitch / DEG).toBeLessThan(1);
    expect(at.s.roll / DEG).toBeLessThan(-0.35);
    expect(at.s.roll / DEG).toBeGreaterThan(-0.65);
    expect(-RIGHT_ARM.dip).toBe(-0.015);
  });

  it("rolls the other way and dips more for the left arm (the watch): the head turns a little to the wrist", () => {
    const right = run(rise(0.25), 1, "right");
    const left = run(rise(0.25), 1, "left");
    const dipOf = (f: { s: Sway }[]): number => Math.min(...f.map((x) => x.s.dy));
    expect(dipOf(left)).toBeLessThan(dipOf(right));
    expect(dipOf(left)).toBeLessThan(-0.017);
    const peakLeft = left.find((f) => f.s.dy === dipOf(left)) as { s: Sway };
    expect(peakLeft.s.pitch / DEG).toBeGreaterThan(1);
    expect(peakLeft.s.pitch / DEG).toBeLessThan(1.4);
    expect(peakLeft.s.roll).toBeGreaterThan(0);
    expect(peakLeft.s.roll / DEG).toBeLessThan(0.7);
    expect([LEFT_ARM.dip, RIGHT_ARM.dip]).toEqual([0.02, 0.015]);
  });

  it("settles to nothing within 0.5 s after the arm stops, with a slight overshoot and no more", () => {
    const frames = run(rise(0.25), 1.2);
    for (const f of frames.filter((x) => x.t >= 0.25 + 0.5)) {
      expect(Math.abs(f.s.dy), `${f.t}`).toBeLessThan(0.0002);
      expect(Math.abs(f.s.pitch / DEG)).toBeLessThan(0.02);
      expect(Math.abs(f.s.roll / DEG)).toBeLessThan(0.02);
    }
    // The overshoot is a little over the line (a rise of the eye) and small.
    const over = Math.max(...frames.map((f) => f.s.dy));
    expect(over).toBeGreaterThan(0);
    expect(over).toBeLessThan(0.003);
  });

  it("adds nothing while an arm is held up, however long", () => {
    const frames = run(rise(0.25), 4);
    for (const f of frames.filter((x) => x.t > 1.2)) expect(Math.abs(f.s.dy)).toBeLessThan(1e-4);
    // And nothing for an arm that is up from the first frame.
    const still = run(() => 1, 2);
    for (const f of still) expect([f.s.dy, f.s.pitch, f.s.roll]).toEqual([0, 0, 0]);
  });
});

describe("what an arm going down does", () => {
  it("is about half of the raise, the other way, and settles", () => {
    const up = run(rise(0.25), 1);
    const down = run((t) => 1 - Math.min(1, t / 0.25), 1);
    const upDip = Math.min(...up.map((f) => f.s.dy));
    const downRise = Math.max(...down.map((f) => f.s.dy));
    // The eye comes up (a positive dy), the pitch comes up (negative) and the roll goes back (positive for the right arm).
    expect(downRise).toBeGreaterThan(0);
    expect(downRise / -upDip).toBeGreaterThan(LOWER_SHARE * 0.8);
    expect(downRise / -upDip).toBeLessThan(LOWER_SHARE * 1.3);
    const atPeak = down.find((f) => f.s.dy === downRise) as { s: Sway };
    expect(atPeak.s.pitch).toBeLessThan(0);
    expect(atPeak.s.roll).toBeGreaterThan(0);
    for (const f of down.filter((x) => x.t >= 0.75)) expect(Math.abs(f.s.dy)).toBeLessThan(0.0002);
  });
});

describe("two arms, and when there is nothing", () => {
  it("adds the two arms' offsets, clamped", () => {
    const sway = createArmSway();
    sway.step(DT, 0, 0, 0.5, false);
    let worst = { dy: 0, pitch: 0, roll: 0 };
    let sum = { dy: 0 };
    const single = createArmSway();
    single.step(DT, 0, null, 0.5, false);
    for (let i = 1; i <= 30; i++) {
      const raised = Math.min(1, (i * DT) / 0.25);
      const s = sway.step(DT, raised, raised, 0.5, false);
      worst = { dy: Math.min(worst.dy, s.dy), pitch: Math.max(worst.pitch, s.pitch), roll: Math.max(worst.roll, Math.abs(s.roll)) };
      sum = { dy: Math.min(sum.dy, single.step(DT, raised, null, 0.5, false).dy) };
    }
    // More than the right arm alone, and within the limits.
    expect(worst.dy).toBeLessThan(sum.dy);
    expect(worst.dy).toBeGreaterThanOrEqual(-MAX_DIP);
    expect(worst.pitch).toBeLessThanOrEqual(MAX_PITCH);
    // The two rolls are opposite and mostly cancel; never beyond the limit.
    expect(worst.roll).toBeLessThanOrEqual(MAX_ROLL);
    // A violent raise of both is held to the clamps.
    const hard = createArmSway();
    hard.step(DT, 0, 0, 3, false);
    const s = hard.step(DT, 1, 1, 3, false);
    expect(s.dy).toBeGreaterThanOrEqual(-MAX_DIP);
    expect(s.pitch).toBeLessThanOrEqual(MAX_PITCH);
    expect(Math.abs(s.roll)).toBeLessThanOrEqual(MAX_ROLL);
    for (let i = 0; i < 12; i++) {
      const t = hard.step(DT, Math.min(1, i * 0.4), Math.min(1, i * 0.4), 3, false);
      expect(t.dy).toBeGreaterThanOrEqual(-MAX_DIP);
      expect(t.pitch).toBeLessThanOrEqual(MAX_PITCH);
    }
  });

  it("is nothing when the bob's scale is 0, scaled by it otherwise, and nothing while paused or with the arms hidden", () => {
    const off = run(rise(0.25), 1, "right", 0);
    for (const f of off) expect([f.s.dy, f.s.pitch, f.s.roll]).toEqual([0, 0, 0]);
    const tuned = Math.min(...run(rise(0.25), 1, "right", 0.5).map((f) => f.s.dy));
    const half = Math.min(...run(rise(0.25), 1, "right", 0.25).map((f) => f.s.dy));
    const double = Math.min(...run(rise(0.25), 1, "right", 1).map((f) => f.s.dy));
    expect(half / tuned).toBeCloseTo(0.5, 2);
    expect(double / tuned).toBeCloseTo(2, 2);
    // Paused: nothing, and what was in motion is dropped (it does not come back after).
    const sway = createArmSway();
    sway.step(DT, 0, null, 0.5, false);
    let moving = 0;
    for (let i = 1; i <= 10; i++) moving = sway.step(DT, i / 10, null, 0.5, false).dy;
    expect(moving).toBeLessThan(0);
    expect(sway.step(DT, 1, null, 0.5, true)).toEqual({ dy: 0, pitch: 0, roll: 0 });
    expect(sway.step(DT, 1, null, 0.5, false)).toEqual({ dy: 0, pitch: 0, roll: 0 });
    // Hidden arms (a car, a door): nothing, and a hidden arm's motion is dropped.
    const hidden = createArmSway();
    hidden.step(DT, 0, 0, 0.5, false);
    hidden.step(DT, 0.5, 0.5, 0.5, false);
    expect(hidden.step(DT, null, null, 0.5, false)).toEqual({ dy: 0, pitch: 0, roll: 0 });
    // A hitch of a long frame is not a motion.
    const hitch = createArmSway();
    hitch.step(DT, 0, null, 0.5, false);
    expect(hitch.step(0.5, 1, null, 0.5, false)).toEqual({ dy: 0, pitch: 0, roll: 0 });
  });

  it("is pure: it takes no Babylon and no DOM", () => {
    const src = readFileSync(new URL("../../src/game/hand/armSway.ts", import.meta.url), "utf8");
    expect(src).not.toMatch(/@babylonjs|document\.|window\.|\bnew Mesh\b/);
    expect(src).not.toMatch(/^import /m);
  });
});
