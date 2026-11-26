import { describe, expect, it } from "vitest";
import { carPose, newCarPose } from "../../src/game/car/carPose.js";
import { drawnFrom, sedanFile, type FilePart } from "./sedanFile.js";

/** A point of the model as the matrix, column by column, puts it in the world. */
function through(m: ArrayLike<number>, p: readonly [number, number, number]): [number, number, number] {
  return [0, 1, 2].map((r) => (m[r] as number) * p[0] + (m[4 + r] as number) * p[1] + (m[8 + r] as number) * p[2] + (m[12 + r] as number)) as [number, number, number];
}

/** The mean place, in `positions`, of the vertices whose place in the file satisfies `where` (x along the file's nose, y up). */
function centroid(file: Float32Array, positions: Float32Array, where: (x: number, y: number) => boolean): [number, number, number] {
  const sum = [0, 0, 0];
  let n = 0;
  for (let i = 0; i < file.length; i += 3) {
    if (!where(file[i] as number, file[i + 1] as number)) continue;
    for (let k = 0; k < 3; k++) sum[k] = (sum[k] as number) + (positions[i + k] as number);
    n++;
  }
  expect(n).toBeGreaterThan(0);
  return [(sum[0] as number) / n, (sum[1] as number) / n, (sum[2] as number) / n];
}

describe("the real sedan, drawn from the loader's model and posed", () => {
  const file = sedanFile();
  const pose = newCarPose();
  const hx = 0.6, hz = 0.8;
  carPose(null, { id: 1, x: 100, y: 0, z: 50, hx, hz, speed: 0, slip: 0, steer: 0, controls: { throttle: 0, turn: 0, handbrake: false }, lights: false, seats: [0, 0, 0, 0] }, 1, () => 0, pose);
  const ahead = (world: readonly number[]): number => ((world[0] as number) - 100) * hx + ((world[2] as number) - 50) * hz;
  const left = (world: readonly number[]): number => ((world[0] as number) - 100) * -hz + ((world[2] as number) - 50) * hx;

  // The file's greenhouse lies toward its tail (the glass above the waist spans x -1.45 to 0.87, the bonnet runs on to +2.35 and the boot
  // only to -2.4), the interior ends at +0.94 where the dash is, and the manifest's front wheels are at +x: the nose is +x in the file.
  it("has the bonnet's end (the paint far forward in the file, low) ahead of the car's centre along the heading", () => {
    const paint = file.get("paint") as FilePart;
    const nose = centroid(paint.positions, drawnFrom(paint.positions), (x, y) => x > 2.0 && y < 0.8);
    expect(ahead(through(pose.matrix, nose))).toBeGreaterThan(2);
  });

  it("has the windscreen's glass (the cabin glass forward of the cabin's middle) ahead of the car's centre, and the rear window behind", () => {
    const glass = file.get("glass") as FilePart;
    const drawn = drawnFrom(glass.positions);
    const screen = centroid(glass.positions, drawn, (x, y) => y > 0.9 && x > -0.2);
    const rear = centroid(glass.positions, drawn, (x, y) => y > 0.9 && x < -0.9);
    expect(ahead(through(pose.matrix, screen))).toBeGreaterThan(0);
    expect(ahead(through(pose.matrix, rear))).toBeLessThan(-0.8);
  });

  it("has the front axle (the wheels the manifest puts at +x, that steer) ahead of the rear one", () => {
    const tyre = file.get("tyre") as FilePart;
    const drawn = drawnFrom(tyre.positions);
    let front = 0, nf = 0;
    for (let i = 0; i < drawn.length; i += 3) {
      if ((tyre.positions[i] as number) > 0.5) {
        front += ahead(through(pose.matrix, [drawn[i] as number, drawn[i + 1] as number, drawn[i + 2] as number]));
        nf++;
      }
    }
    expect(front / nf).toBeGreaterThan(1);
  });

  it("puts the file's left side (-z in the file, where the steering wheel of a US sedan is) on the heading's left (-hz, hx)", () => {
    const paint = file.get("paint") as FilePart;
    const drawn = drawnFrom(paint.positions);
    // The file's left-most vertex of the body (lowest z).
    let lowest = 0;
    for (let i = 0; i < paint.positions.length; i += 3) if ((paint.positions[i + 2] as number) < (paint.positions[lowest + 2] as number)) lowest = i;
    const world = through(pose.matrix, [drawn[lowest] as number, drawn[lowest + 1] as number, drawn[lowest + 2] as number]);
    expect(left(world)).toBeGreaterThan(0.8);
  });

  it("has the steering wheel's side (the dash and column region of the interior, heavier on the file's -z) on the heading's left", () => {
    const interior = file.get("interior") as FilePart;
    const drawn = drawnFrom(interior.positions);
    // The dash, column and wheel stand at x 0.3 to 0.8, y 0.8 to 1.1, and the file has two thirds of what is there on its -z side (the driver's).
    const at = centroid(interior.positions, drawn, (x, y) => x > 0.3 && x < 0.8 && y > 0.8 && y < 1.1);
    let neg = 0, all = 0;
    for (let i = 0; i < interior.positions.length; i += 3) {
      const x = interior.positions[i] as number, y = interior.positions[i + 1] as number;
      if (x > 0.3 && x < 0.8 && y > 0.8 && y < 1.1) {
        all++;
        if ((interior.positions[i + 2] as number) < 0) neg++;
      }
    }
    expect(neg / all).toBeGreaterThan(0.6);
    expect(left(through(pose.matrix, at))).toBeGreaterThan(0.05);
  });
});
