import { describe, expect, it } from "vitest";
import { cameraAxes, restAxes } from "@csarkosh/engine/game/lite/cameraPose";
import { PLAYER_EYE_OFFSET } from "@csarkosh/engine/sim/constants";
import { faceYaw } from "../../src/game/doors.js";
import { TORCH_ANGLE } from "../../src/game/hand/handLight.js";
import { lensWorld, newHandPose, newHandState, stepHand } from "../../src/game/hand/handPose.js";
import { DAZZLE_REACH, inBeam } from "../../src/game/town/peopleDazzle.js";
import { arriveAt, insideRooms, spotOf } from "../../src/sim/inside/rooms.js";
import "../../src/terrain.js";

const SEED = 20261121;

describe("the cafe's counter, for looking at a face in the torch", () => {
  const room = insideRooms(SEED).find((r) => r.name === "cafe")!;
  const staff = room.design.people.find((p) => p.role === "staff")!;
  const spot = spotOf(room, "counter")!;

  it("is a named place of the cafe's design, two to three metres from the person behind the counter, with no seated customer within 1.2 m", () => {
    expect(staff).toBeDefined();
    expect(spot).toBeDefined();
    const d = Math.hypot(spot.s - staff.s, spot.d - staff.d);
    expect(d).toBeGreaterThan(1.5);
    expect(d).toBeLessThan(3.2);
    for (const p of room.design.people.filter((q) => q.sits !== null)) expect(Math.hypot(spot.s - p.s, spot.d - p.d), `a customer at ${p.s},${p.d}`).toBeGreaterThanOrEqual(1.2 - 1e-9);
  });

  // The way to look: the word whose direction is nearest to the way from the player to the person, in the room's frame (the staff's own `face` runs from them to the player).
  const wanted = { s: staff.s - spot.s, d: staff.d - spot.d };
  const words: [string, number, number][] = [["left", -1, 0], ["right", 1, 0], ["front", 0, -1], ["back", 0, 1]];
  const face = words.reduce((best, w) => (w[1] * wanted.s + w[2] * wanted.d > best[1] * wanted.s + best[2] * wanted.d ? w : best))[0];

  it("puts the barista in the torch's cone, near and facing the player, when the player looks the way the word says", () => {
    const here = arriveAt(room, spot);
    const there = arriveAt(room, { s: staff.s, d: staff.d, y: 0 });
    const yaw = faceYaw(room, face);
    const axes = cameraAxes(yaw, 0, 0, restAxes());
    const pose = newHandPose();
    const state = newHandState();
    for (let i = 0; i < 90; i++) stepHand(state, { dt: 1 / 60, want: true, hidden: false, speed: 0, sprinting: false, yaw, pitch: 0, clear: 1, aspect: 1.6 }, pose);
    const lens = { x: 0, y: 0, z: 0, dx: 0, dy: 0, dz: 0 };
    const eyeY = here.y + PLAYER_EYE_OFFSET;
    lensWorld(here.x, eyeY, here.z, axes, pose, lens);
    // The barista's head and the way they face: the room's (s, d) is the world's t * s - n * d.
    const floor = there.y - 0.9;
    const head = { x: there.x, y: floor + 1.62, z: there.z };
    const v = [head.x - lens.x, head.y - lens.y, head.z - lens.z];
    const dist = Math.hypot(v[0]!, v[1]!, v[2]!);
    const angle = Math.acos((v[0]! * lens.dx + v[1]! * lens.dy + v[2]! * lens.dz) / dist);
    const fx = room.tx * staff.face.s - room.nx * staff.face.d;
    const fz = room.tz * staff.face.s - room.nz * staff.face.d;
    const person = { key: 1, x: head.x, y: floor, z: head.z, yaw: Math.atan2(fx, fz), scale: 1, walking: false, seated: false, sheltered: true, partner: -1, venue: "cafe" as const };
    process.stdout.write(`the cafe's counter (seed ${SEED}): look ${face}; the barista is ${dist.toFixed(2)} m from the lens, ${((angle * 180) / Math.PI).toFixed(1)} degrees off the torch's axis (the cone's half angle is ${(((TORCH_ANGLE / 2) * 180) / Math.PI).toFixed(1)}), eye height ${(eyeY - floor).toFixed(2)} m over the floor\n`);
    expect(dist).toBeLessThan(DAZZLE_REACH);
    expect(angle).toBeLessThan(TORCH_ANGLE / 2);
    const torch = { lit: true, x: lens.x, y: lens.y, z: lens.z, dx: lens.dx, dy: lens.dy, dz: lens.dz };
    const player = { x: here.x, y: floor, z: here.z, vx: 0, vz: 0, onFoot: true };
    expect(inBeam(person, 0, 0, torch, TORCH_ANGLE / 2, player, () => false)).toBe(true);
  });
});
