import { describe, expect, it } from "vitest";
import { timeLimit } from "@csarkosh/engine/testing/timeLimit";
import { splitWheels } from "../../src/game/car/carPose.js";
import { manifestOf } from "../../src/game/town/props/vehicleManifest.js";
import { drawnFrom, loaded, sedanFile, type FilePart } from "./sedanFile.js";
import { WHEEL_RADIUS } from "../../src/sim/car/tuning.js";

const WHEELS = manifestOf("vehicle.sedan_a").wheels;
/** Where each wheel's axle is in the model: the manifest's contact point lifted by the radius. */
const centres = WHEELS.map((w) => [w.x, w.y + w.r, w.z] as const);

/** A ring of `n` triangles round an axle along z, as a small tyre. */
function ring(into: { p: number[]; i: number[] }, c: readonly [number, number, number], n: number, r: number): void {
  const base = into.p.length / 3;
  into.p.push(c[0], c[1], c[2]);
  for (let k = 0; k < n; k++) {
    const a = (k / n) * 2 * Math.PI;
    into.p.push(c[0] + r * Math.cos(a), c[1] + r * Math.sin(a), c[2]);
  }
  for (let k = 0; k < n; k++) into.i.push(base, base + 1 + k, base + 1 + ((k + 1) % n));
}

function mesh(order: readonly number[]): { positions: Float32Array; indices: Uint32Array } {
  const into = { p: [] as number[], i: [] as number[] };
  for (const w of order) ring(into, centres[w] as (typeof centres)[number], 12, 0.3);
  return { positions: new Float32Array(into.p), indices: new Uint32Array(into.i) };
}

const radiusOf = (positions: Float32Array): number => {
  let m = 0;
  for (let i = 0; i < positions.length; i += 3) m = Math.max(m, Math.hypot(positions[i] as number, positions[i + 1] as number, positions[i + 2] as number));
  return m;
};

describe("cutting the tyre mesh into its wheels", () => {
  it("cuts four small rings into four wheels: every triangle in exactly one, each within its radius of its axle", () => {
    const { positions, indices } = mesh([0, 1, 2, 3]);
    const parts = splitWheels(positions, indices, WHEELS);
    expect(parts).toHaveLength(4);
    expect(parts.reduce((n, w) => n + w.indices.length, 0)).toBe(indices.length);
    for (const w of parts) {
      expect(w.indices.length).toBe(36);
      expect(radiusOf(w.positions)).toBeLessThanOrEqual(WHEEL_RADIUS + 1e-6);
      // The axle is the origin: the ring's own middle vertex is at it.
      expect(Math.hypot(w.positions[0] as number, w.positions[1] as number, w.positions[2] as number)).toBeLessThan(1e-6);
    }
  }, timeLimit(30_000));

  it("answers in the manifest's order, each wheel with its own axle's place", () => {
    const parts = splitWheels(...(Object.values(mesh([3, 2, 1, 0])) as [Float32Array, Uint32Array]), WHEELS);
    for (const [k, w] of parts.entries()) {
      const c = centres[k] as (typeof centres)[number];
      expect(w.centre).toEqual([c[0], c[1], c[2]]);
    }
  }, timeLimit(30_000));

  it("gives each wheel vertices of its own, with their source, so no vertex is shared between wheels", () => {
    const { positions, indices } = mesh([0, 1, 2, 3]);
    const parts = splitWheels(positions, indices, WHEELS);
    const seen = new Set<number>();
    for (const w of parts) {
      expect(w.source.length * 3).toBe(w.positions.length);
      for (const s of w.source) {
        expect(seen.has(s)).toBe(false);
        seen.add(s);
      }
      for (const i of w.indices) expect(i).toBeLessThan(w.source.length);
    }
  }, timeLimit(30_000));

  it("puts a triangle that straddles two wheels in one of them, whole, and loses none", () => {
    const { positions, indices } = mesh([0, 1, 2, 3]);
    // One triangle whose corners are the axles of two wheels' rings.
    const into = { p: Array.from(positions), i: Array.from(indices) };
    const n = into.p.length / 3;
    const a = centres[0] as (typeof centres)[number];
    const b = centres[1] as (typeof centres)[number];
    into.p.push(a[0], a[1] + 0.1, a[2], b[0], b[1] + 0.1, b[2], a[0], a[1] + 0.2, a[2]);
    into.i.push(n, n + 1, n + 2);
    const parts = splitWheels(new Float32Array(into.p), new Uint32Array(into.i), WHEELS);
    expect(parts.reduce((s, w) => s + w.indices.length, 0)).toBe(into.i.length);
    expect(parts.map((w) => w.indices.length).sort()).toEqual([36, 36, 36, 39]);
  }, timeLimit(30_000));

  it("cuts the real sedan's tyre mesh, as the car is drawn from it, into four clean wheels: no triangle straddles two", () => {
    const tyre = sedanFile().get("tyre") as FilePart;
    // As the loader gives it (the mirror of x) and the car turns it (a half turn), not as the file has it.
    const positions = drawnFrom(tyre.positions);
    const indices = tyre.indices;
    const parts = splitWheels(positions, indices, WHEELS);
    expect(parts).toHaveLength(4);
    expect(parts.reduce((n, w) => n + w.indices.length, 0)).toBe(indices.length);
    // The same count each: the four wheels are one wheel copied, and none holds a triangle of another's.
    expect(new Set(parts.map((w) => w.indices.length)).size).toBe(1);
    // No vertex had to be copied for a second wheel: the mesh's triangles are all clean.
    expect(parts.reduce((n, w) => n + w.source.length, 0)).toBeLessThanOrEqual(positions.length / 3);
    for (const w of parts) expect(radiusOf(w.positions)).toBeLessThan(WHEEL_RADIUS * 1.1);
  }, timeLimit(30_000));

  it("cuts the mesh as the loader gives it (nose at -x) badly: the wheels would sit off their axles by the axles' difference", () => {
    // Why the turn is needed: uncorrected, the tyre at the nose end is cut about the rear axle's place.
    const tyre = sedanFile().get("tyre") as FilePart;
    const parts = splitWheels(loaded(tyre.positions), tyre.indices, WHEELS);
    const worst = Math.max(...parts.map((w) => radiusOf(w.positions)));
    expect(worst).toBeGreaterThan(WHEEL_RADIUS * 1.5);
  }, timeLimit(30_000));
});
