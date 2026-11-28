/**
 * How lit the player's arms are, where the player stands: one number for the arms' material (`townMaterial.ts`, `ARM_CODE`: `material.armLevel`.x scales the arms' albedo before the scene's
 * light falls on it), written each frame by the renderer's part. Pure.
 *
 * The arms are drawn with a copy of the town's indoor material, whose vertices have no baked light of their own; without this they took the room's own light at any hour, and stood
 * as bright as noon against a black street. So:
 *
 * - **Outdoors** the level is what everything unlit outdoors has at the hour: the night's floor (`ARM_NIGHT_FLOOR`) up to 1 at full day, by how much day there is (`daylightAt`).
 * - **In a room** it is the room's own: `ARM_ROOM_OPEN` where the room is lit (its unit is open), and in a shut room only `ARM_ROOM_SHUT` and a share of the day coming in at the glass.
 * - **The torch's lift**: a hand that holds a lit torch is faintly lit by it, by no more than `ARM_LIFT_MAX` of its albedo, added over what the level lets through. The lift is
 *   added to a glow, which the material multiplies by the hour's lit gain (about 3 at night), so it is written as that much over the gain.
 */
export const ARM_NIGHT_FLOOR = 0.1;
export const ARM_ROOM_OPEN = 0.55;
export const ARM_ROOM_SHUT = 0.14;
export const ARM_LIFT_MAX = 0.15;

export type ArmPlace = "street" | "open room" | "shut room";

/** The arms' level, 0 to 1: `daylight` is how much day there is (0 to 1, `daylightAt`). */
export function armLevel(daylight: number, place: ArmPlace): number {
  const day = Math.min(1, Math.max(0, daylight));
  if (place === "street") return ARM_NIGHT_FLOOR + (1 - ARM_NIGHT_FLOOR) * day;
  if (place === "open room") return ARM_ROOM_OPEN;
  return ARM_ROOM_SHUT + 0.3 * day;
}

/** The torch's lift written to the material: `lit` is how far the torch's light has come on (0 to 1), `litGain` the hour's lit gain (`litGainAt`, at least 1). */
export function armLift(lit: number, litGain: number): number {
  return (ARM_LIFT_MAX * Math.min(1, Math.max(0, lit))) / Math.max(1, litGain);
}
