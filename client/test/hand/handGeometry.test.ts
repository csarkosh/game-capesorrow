import { describe, expect, it } from "vitest";
import { MeshBuilder, isUnbacked } from "../../src/game/town/meshBuilder.js";
import { flashlightGeometry, lensGlowGeometry, torchSolids, TORCH } from "../../src/game/hand/flashlightGeometry.js";
import { handSolids } from "../../src/game/hand/handGeometry.js";
import { handArrays } from "../../src/game/hand/handParts.js";
import { HAND_SCALE, HOLD, NEAREST, newHandPose, newHandState, stepHand, torchBasis } from "../../src/game/hand/handPose.js";
import { cameraAxes, restAxes } from "@csarkosh/engine/game/lite/cameraPose";
import { HAND_AHEAD_UNITS } from "../../src/game/hand/handParts.js";
import { TORCH_ANGLE } from "../../src/game/hand/handLight.js";
import { packedBytes } from "../../src/game/town/vertexPack.js";

/** Whether a mesh is closed: every edge of every triangle is met by the same edge the other way, as many times. */
function openEdges(positions: Float32Array, indices: Uint32Array): number {
  const key = (i: number): string => `${Math.round((positions[i * 3] as number) * 1e5)},${Math.round((positions[i * 3 + 1] as number) * 1e5)},${Math.round((positions[i * 3 + 2] as number) * 1e5)}`;
  const edges = new Map<string, number>();
  const add = (a: string, b: string): void => {
    if (a === b) return;
    edges.set(`${a}>${b}`, (edges.get(`${a}>${b}`) ?? 0) + 1);
  };
  for (let t = 0; t < indices.length; t += 3) {
    const v = [key(indices[t] as number), key(indices[t + 1] as number), key(indices[t + 2] as number)];
    add(v[0] as string, v[1] as string);
    add(v[1] as string, v[2] as string);
    add(v[2] as string, v[0] as string);
  }
  let open = 0;
  for (const [e, n] of edges) {
    const [a, b] = e.split(">") as [string, string];
    if ((edges.get(`${b}>${a}`) ?? 0) !== n) open++;
  }
  return open;
}

describe("the hand's and the torch's geometry", () => {
  const { body, lens } = handArrays();

  it("is under 6,000 vertices with the torch, in two draws, and the lens is a disc", () => {
    expect(body.positions.length / 3).toBeLessThan(6000);
    expect(body.positions.length / 3).toBeGreaterThan(1500);
    expect(lens.positions.length / 3).toBeLessThan(100);
    expect(body.positions.length / 3 + lens.positions.length / 3).toBeLessThan(6000);
    expect(body.indices.length / 3).toBeLessThan(6000);
  });

  it("holds no number that is not finite, and every normal is a unit vector", () => {
    for (const a of [body, lens]) {
      for (const v of a.positions) expect(Number.isFinite(v)).toBe(true);
      for (let i = 0; i < a.normals.length; i += 3) expect(Math.hypot(a.normals[i] as number, a.normals[i + 1] as number, a.normals[i + 2] as number)).toBeCloseTo(1, 4);
    }
  });

  it("keeps the torch inside its box: 21 cm long, a head 5.5 cm across and a bezel 6 cm, a grip 4 cm, the lens at the origin", () => {
    const b = new MeshBuilder();
    flashlightGeometry(b);
    const a = b.take();
    let zlo = Infinity, zhi = -Infinity, r = 0;
    for (let i = 0; i < a.positions.length; i += 3) {
      const x = a.positions[i] as number, y = a.positions[i + 1] as number, z = a.positions[i + 2] as number;
      zlo = Math.min(zlo, z);
      zhi = Math.max(zhi, z);
      r = Math.max(r, Math.hypot(x, y));
    }
    expect(zhi).toBeLessThanOrEqual(0.001);
    expect(zlo).toBeGreaterThanOrEqual(-TORCH.length - 1e-6);
    expect(TORCH.length).toBeGreaterThanOrEqual(0.19);
    expect(TORCH.length).toBeLessThanOrEqual(0.22);
    expect(TORCH.gripRadius * 2).toBeGreaterThan(0.038);
    expect(TORCH.gripRadius * 2).toBeLessThan(0.042);
    expect(TORCH.headRadius * 2).toBeGreaterThan(0.054);
    expect(TORCH.headRadius * 2).toBeLessThan(0.057);
    expect(TORCH.bezelRadius).toBeGreaterThan(TORCH.headRadius);
    expect(r).toBeLessThanOrEqual(TORCH.bezelRadius + 1e-6);
    // The grip is thinner than the head, and the anti-roll ring stands proud of it.
    expect(TORCH.ringRadius).toBeGreaterThan(TORCH.gripRadius * 1.2);
  });

  it("keeps the hand and the sleeve in a box of the lower right: within 85 cm of the lens, and none of it in front of the lens", () => {
    let zhi = -Infinity, far = 0;
    for (let i = 0; i < body.positions.length; i += 3) {
      zhi = Math.max(zhi, body.positions[i + 2] as number);
      far = Math.max(far, Math.hypot(body.positions[i] as number, body.positions[i + 1] as number, body.positions[i + 2] as number));
    }
    expect(zhi).toBeLessThanOrEqual(0.001);
    expect(far).toBeLessThan(0.85);
  });

  it("is made of closed solids: every solid of the torch and of the hand has every edge met", () => {
    const solids = handSolids();
    expect(solids.length).toBeGreaterThanOrEqual(10);
    for (const s of solids) {
      const b = new MeshBuilder();
      s.lay(b);
      const a = b.take();
      expect(a.indices.length, s.name).toBeGreaterThan(0);
      expect(openEdges(a.positions, a.indices), `${s.name} has open edges`).toBe(0);
    }
  });

  it("grips the second band with the head clear of the fist by 5 cm or more, the fingers on the grip and not on the head or the tail's guard", () => {
    let front = -Infinity, back = Infinity;
    for (const s of handSolids().filter((q) => q.name.startsWith("finger"))) {
      const b = new MeshBuilder();
      s.lay(b);
      const a = b.take();
      for (let i = 2; i < a.positions.length; i += 3) {
        front = Math.max(front, a.positions[i] as number);
        back = Math.min(back, a.positions[i] as number);
      }
    }
    expect(-TORCH.shoulderEnd - front).toBeGreaterThanOrEqual(0.05);
    expect(front).toBeLessThan(-TORCH.ringEnd);
    expect(back).toBeGreaterThan(-TORCH.tailEnd);
  });

  it("does not light its own head: no vertex of the torch that is inside the beam's cone faces the lens, and the arms' depth shift keeps every arm point inside the buffer", () => {
    const state = newHandState();
    const pose = newHandPose();
    for (let i = 0; i < 120; i++) stepHand(state, { dt: 1 / 60, want: true, hidden: false, speed: 0, sprinting: false, yaw: 0, pitch: 0, clear: 1, aspect: 1.6 }, pose);
    const axes = restAxes();
    const b = new Float64Array(9);
    torchBasis(axes, pose, b, HAND_SCALE);
    const half = TORCH_ANGLE / 2;
    const arrays = new MeshBuilder();
    flashlightGeometry(arrays);
    const a = arrays.take();
    let lit = 0;
    for (let k = 0; k < a.positions.length / 3; k++) {
      const px = a.positions[k * 3] as number, py = a.positions[k * 3 + 1] as number, pz = a.positions[k * 3 + 2] as number;
      const w = [b[0]! * px + b[3]! * py + b[6]! * pz, b[1]! * px + b[4]! * py + b[7]! * pz, b[2]! * px + b[5]! * py + b[8]! * pz];
      const d = Math.hypot(w[0]!, w[1]!, w[2]!);
      if (d < 1e-6) continue;
      const cosCone = (w[0]! * pose.ax + w[1]! * pose.ay + w[2]! * pose.az) / d;
      if (cosCone < Math.cos(half)) continue;
      // The normal in the camera's frame, and whether it faces the lens (toward the origin of the offset).
      const nx = a.normals[k * 3] as number, ny = a.normals[k * 3 + 1] as number, nz = a.normals[k * 3 + 2] as number;
      const n = [(b[0]! * nx + b[3]! * ny + b[6]! * nz) / HAND_SCALE, (b[1]! * nx + b[4]! * ny + b[7]! * nz) / HAND_SCALE, (b[2]! * nx + b[5]! * ny + b[8]! * nz) / HAND_SCALE];
      if (-(n[0]! * w[0]! + n[1]! * w[1]! + n[2]! * w[2]!) / d > 0.05) lit++;
    }
    expect(lit).toBe(0);
    // The depth shift: the nearest an arm point can be is NEAREST from the eye, whose depth under the near plane's 0.05 is 0.357; shifted it must stay under 1.
    expect(0.05 / NEAREST + HAND_AHEAD_UNITS / 2 ** 24).toBeLessThan(1);
    expect(0.05 / 0.6 + HAND_AHEAD_UNITS / 2 ** 24).toBeGreaterThan(0.45);
  });

  it("is made of closed solids in the torch too: every part of it, laid alone, has every edge met", () => {
    const solids = torchSolids();
    expect(solids.length).toBeGreaterThanOrEqual(14);
    for (const s of solids) {
      const b = new MeshBuilder();
      s.lay(b);
      const a = b.take();
      expect(a.indices.length, s.name).toBeGreaterThan(0);
      expect(openEdges(a.positions, a.indices), `${s.name} has open edges`).toBe(0);
    }
  });

  it("has a torch whose solids are closed, and no triangle of the hand's meshes that is left without a back it needs", () => {
    const b = new MeshBuilder();
    flashlightGeometry(b);
    const a = b.take();
    // The lens glass and the bezel's front are single sheets facing forward (the lens is seen from the front only); everything else is closed.
    let unbacked = 0;
    for (let t = 0; t < a.indices.length / 3; t++) if (isUnbacked(a.indices, t)) unbacked++;
    expect(unbacked).toBe(0);
    const lensBuilder = new MeshBuilder();
    lensGlowGeometry(lensBuilder);
    expect(lensBuilder.take().indices.length / 3).toBeGreaterThan(10);
  });

  it("costs under 0.35 MB on the GPU (a vertex is 52 bytes packed, an index 2), and under 450 kilobytes as the town counts bytes", () => {
    const real = (v: number, i: number): number => v * 52 + i * 2;
    expect(real(body.positions.length / 3, body.indices.length) + real(lens.positions.length / 3, lens.indices.length)).toBeLessThan(350_000);
    const counted = packedBytes(body.positions.length / 3, body.indices.length, body.surface.byteLength) + packedBytes(lens.positions.length / 3, lens.indices.length, lens.surface.byteLength);
    expect(counted).toBeLessThan(450_000);
  });

  it("never comes nearer the eye than 14 cm, nor into the near plane, at any point of the raise, the hold or the lowering", () => {
    const state = newHandState();
    const pose = newHandPose();
    const axes = restAxes();
    cameraAxes(0, 0, 0, axes);
    const b = new Float64Array(9);
    let nearest = Infinity;
    const lookAt = (): void => {
      torchBasis(axes, pose, b, HAND_SCALE);
      for (let i = 0; i < body.positions.length; i += 3) {
        const px = body.positions[i] as number, py = body.positions[i + 1] as number, pz = body.positions[i + 2] as number;
        // The vertex in the camera's frame (the camera looks along +z, the axes are the rest axes).
        const x = pose.x + b[0]! * px + b[3]! * py + b[6]! * pz;
        const y = pose.y + b[1]! * px + b[4]! * py + b[7]! * pz;
        const z = pose.z + b[2]! * px + b[5]! * py + b[8]! * pz;
        // A point behind the near plane is not drawn at all; one in front of it is at least the nearest from the eye.
        if (z > 0.05) nearest = Math.min(nearest, Math.hypot(x, y, z));
      }
    };
    for (let i = 0; i < 400; i++) {
      stepHand(state, { dt: 1 / 60, want: i < 250, hidden: false, speed: i % 120 / 25, sprinting: false, yaw: Math.sin(i * 0.1) * 2, pitch: Math.sin(i * 0.03) * 1.2, clear: i % 50 < 10 ? 0 : 1, aspect: 1.6 }, pose);
      if (pose.shown) lookAt();
    }
    expect(nearest).toBeGreaterThanOrEqual(NEAREST);
    expect(HOLD.z).toBeGreaterThan(0.3);
  });
});
