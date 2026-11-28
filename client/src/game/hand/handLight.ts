/**
 * The torch's light as the engine is handed it: the engine's one lamp (`RenderLamp`) moved to the torch's lens, as `car/headlights.ts` moves it to the car's
 * nose, and given the torch's own brightness, colour, cone and reach. Pure: no engine, no DOM (the types only).
 *
 * **Brightness.** The engine's lamp is tuned for a hiker's head lamp at the engine's own exposure (`LAMP_INTENSITY`). This game grades its night dark (`look.ts`:
 * the night's exposure is 0.28), and the grade darkens everything the scene's lights light, which the town's own glows are lifted back from (`litGainAt`) and the
 * engine's lamp is not. So at the stock brightness the beam was lost in the dark. The headlights are raised by `HEADLIGHT_GAIN` (6) for the same reason, tuned by
 * eye; the torch takes the same gain, `TORCH_GAIN`, from a hand that is higher over the ground than the car's nose and so throws more steeply.
 */
import { LAMP_COLOUR, LAMP_INTENSITY, type LampState } from "@csarkosh/engine/game/lampParams";
import type { RenderLamp } from "@csarkosh/engine/game/lite/renderGame";

/** The torch's beam: a full cone (radians) tighter than the car's (the engine's is 1.5), how far it reaches (m), and its colour (a small torch's warm white). */
export const TORCH_ANGLE = 1;
export const TORCH_RANGE = 22;
export const TORCH_COLOUR: readonly [number, number, number] = [1, 0.96, 0.86];
/**
 * The torch's intensity as a multiple of the engine's walker lamp's (`LAMP_INTENSITY`) under the night's grade: the headlights' gain, for the same dark grade.
 * By day the grade is not dark and the same gain whites out whatever is near (a face two metres off was blank), so the gain follows the hour as the town's
 * glows do: `TORCH_GAIN` times the hour's lit gain over the night's (`torchGainFor`), which is `TORCH_GAIN` at night and about a third of it at noon.
 */
export const TORCH_GAIN = 6;
/** The lit gain of the deepest night (`look.ts`, `litGainAt`), which `TORCH_GAIN` was set under. */
export const NIGHT_LIT_GAIN = 0.86 / 0.28;
/** The torch's gain at an hour whose lit gain (`litGainAt`) is `litGain`. */
export function torchGainFor(litGain: number): number {
  return TORCH_GAIN * Math.min(1, Math.max(1, litGain) / NIGHT_LIT_GAIN);
}
export { LAMP_INTENSITY };

/** What the lamp is given, written in place so that a frame allocates nothing. */
export type TorchState = { intensity: number; colour: { r: number; g: number; b: number } };

export function newTorchState(): TorchState {
  return { intensity: 0, colour: { r: TORCH_COLOUR[0], g: TORCH_COLOUR[1], b: TORCH_COLOUR[2] } };
}

/**
 * Lights the torch: the lamp at the lens (`place`: its position and unit axis in the world), the torch's cone and reach, and its brightness and colour in place of
 * the walker lamp's, from the engine's own state (which dread dims and tints) taken as it stands. `arrive` (0 to 1) is how far the hand has come up: the light comes
 * on as it arrives. `litGain` is the hour's (`litGainAt`).
 */
export function lightTorch(lamp: RenderLamp, place: { x: number; y: number; z: number; dx: number; dy: number; dz: number }, arrive: number, state: TorchState, litGain = NIGHT_LIT_GAIN): void {
  const at = lamp.at;
  at.x = place.x;
  at.y = place.y;
  at.z = place.z;
  at.dx = place.dx;
  at.dy = place.dy;
  at.dz = place.dz;
  at.angle = TORCH_ANGLE;
  at.range = TORCH_RANGE;
  const eng = lamp.lit.state;
  state.intensity = eng.intensity * torchGainFor(litGain) * arrive;
  state.colour.r = TORCH_COLOUR[0] * (eng.colour.r / LAMP_COLOUR[0]);
  state.colour.g = TORCH_COLOUR[1] * (eng.colour.g / LAMP_COLOUR[1]);
  state.colour.b = TORCH_COLOUR[2] * (eng.colour.b / LAMP_COLOUR[2]);
  lamp.lit.state = state as LampState;
}
