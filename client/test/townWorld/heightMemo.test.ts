import { describe, expect, it } from "vitest";
import { HEIGHT_MEMO_CAP, heightMemo, townGround } from "../../src/game/town/townGeometry.js";
import { elevationSampleAt } from "@csarkosh/engine/sim/terrain";
import { streetLiftD } from "../../src/sim/town/streetField.js";
import "../../src/terrain.js";

/** The ground's height table is bounded: past its cap it is emptied, and a height forgotten is read again as the same number. */
describe("the ground's remembered heights", () => {
  const read = (x: number, z: number): number => Math.sin(x * 0.37) * 4 + Math.cos(z * 0.11) * 2 + x * z * 1e-4;

  /** A walk that wanders, doubles back and asks the same point twice running. */
  function walk(n: number): [number, number][] {
    const out: [number, number][] = [];
    let x = -120;
    let z = 40;
    for (let i = 0; i < n; i++) {
      x += Math.sin(i * 0.013) * 0.7 + 0.2;
      z += Math.cos(i * 0.007) * 0.9 - 0.1;
      out.push([x, z]);
      if (i % 3 === 0) out.push([x, z]);
      if (i % 50 === 49) out.push(out[out.length - 40] as [number, number]);
    }
    return out;
  }

  it("gives the same numbers with its cap hit as without one, and never holds more than the cap", () => {
    const capped = heightMemo(read, 64);
    const free = heightMemo(read, Infinity);
    let most = 0;
    for (const [x, z] of walk(3000)) {
      expect(capped.at(x, z)).toBe(free.at(x, z));
      most = Math.max(most, capped.size());
    }
    expect(most).toBeLessThanOrEqual(64);
    expect(most).toBe(64);
    expect(free.size()).toBeGreaterThan(64 * 20);
  });

  it("reads a remembered point once and a point after the table was emptied again", () => {
    let reads = 0;
    const m = heightMemo((x, z) => (reads++, read(x, z)), 4);
    m.at(1, 1);
    m.at(1, 1);
    expect(reads).toBe(1);
    for (let i = 2; i < 12; i++) m.at(i, 1);
    expect(m.size()).toBeLessThanOrEqual(4);
    const before = reads;
    m.at(1, 1);
    expect(reads).toBe(before + 1);
    expect(m.at(1, 1)).toBe(read(1, 1));
  });

  it("is bounded for the town's ground, whose heights are the engine's field and the streets' lift", () => {
    expect(HEIGHT_MEMO_CAP).toBe(32768);
    const seed = 20261121;
    const g = townGround(seed);
    for (let i = 0; i < 400; i++) {
      const x = -250 + i * 1.37;
      const z = 90 - i * 0.61;
      expect(g.heightAt(x, z)).toBe(elevationSampleAt(seed, x, z).h + streetLiftD(seed, x, z).v);
      expect(g.heightAt(x, z)).toBe(elevationSampleAt(seed, x, z).h + streetLiftD(seed, x, z).v);
    }
  });
});
