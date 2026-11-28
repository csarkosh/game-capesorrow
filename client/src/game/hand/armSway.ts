/**
 * The view's small answer to an arm coming up or going down, in the manner of the walk's bob (`@csarkosh/engine/game/viewBob`): a transient offset of the eye, so that
 * raising the torch or the watch is felt in the head as well as seen in the hand. Pure: no Babylon and no DOM; the pose is the game's `shot` hook's, and the arms ride it.
 *
 * Each arm's `raised` (0 to 1) is differentiated, and the rate drives a spring that is damped just short of critical: an arm coming up gives a short reach (the view dips,
 * pitches down and rolls a little toward the arm) that peaks near the middle of the raise and settles back within about 0.4 s with a slight overshoot; going down gives about half of
 * that the other way, and settles. Holding an arm up adds nothing once it has settled, and the two arms' offsets add, clamped.
 *
 * Strictly a view effect, as the bob is: the sim's aim, `interact` and what the player reaches for are never changed, and two peers may differ. It is scaled by the setting that
 * scales the bob (`/bob`: 0 is off, the engine's default of 0.5 is the tuned strength) and is nothing at all while the arms are hidden (a door's hold, a car) or the game is paused.
 *
 * Signs, as the engine's camera has them (`cameraPose.ts`): a positive pitch looks down; a positive roll tilts the camera's up toward its left (the head to the left), so a roll
 * toward the right is negative.
 */

/** What one arm adds when it rises, at the tuned strength: the eye's dip in metres, the pitch down and the roll toward the arm's side in radians. */
export type ArmGains = { readonly dip: number; readonly pitch: number; readonly roll: number };

const DEG = Math.PI / 180;
/** The right arm (the torch): the view dips 1.5 cm, pitches down 0.8 degrees and rolls 0.5 degrees toward the right. */
export const RIGHT_ARM: ArmGains = { dip: 0.015, pitch: 0.8 * DEG, roll: -0.5 * DEG };
/** The left arm (the watch): the head dips 2 cm, pitches down 1.2 degrees and rolls 0.5 degrees toward the left (the head turning a little to the wrist). */
export const LEFT_ARM: ArmGains = { dip: 0.02, pitch: 1.2 * DEG, roll: 0.5 * DEG };
/** What lowering an arm does, as a share of raising it (the other way). */
export const LOWER_SHARE = 0.5;
/** The spring's natural frequency in radians a second (a period of 0.28 s) and its damping ratio: a peak at about 0.15 s, settled inside 0.4 s. */
export const OMEGA = (2 * Math.PI) / 0.28, ZETA = 0.5;
/** Seconds of rate that make one unit of reach: a raise of `raised` from 0 to 1 in 0.25 s (a rate of 4 a second) peaks at about 1. */
export const RATE_TO_REACH = 0.217;
/** The most the two arms together can add: the dip in metres, the pitch and the roll in radians. */
export const MAX_DIP = 0.03, MAX_PITCH = 2 * DEG, MAX_ROLL = 0.8 * DEG;
/** The strength at which the offsets are as above: the engine's default bob scale. */
export const TUNED_SCALE = 0.5;

/** The offset to add to the eye this frame: `dy` (negative is a dip), `pitch` and `roll` in radians. */
export type Sway = { dy: number; pitch: number; roll: number };

type Spring = { prev: number; x: number; v: number; placed: boolean };

export type ArmSway = {
  /**
   * Steps the sway `dt` seconds on and returns the offset. `right` and `left` are the arms' `raised`, or null while an arm is hidden; `scale` is the bob's scale (0 is off);
   * `paused` is true while the game is paused. The returned record is reused by the next call.
   */
  step(dt: number, right: number | null, left: number | null, scale: number, paused: boolean): Sway;
  reset(): void;
};

function newSpring(): Spring {
  return { prev: 0, x: 0, v: 0, placed: false };
}

/** The substep of the spring's integration, seconds: small enough that it is stable at its frequency. */
const SUBSTEP = 1 / 240;
/** A frame longer than this is a hitch, not a motion: the spring is let be. */
const MAX_FRAME = 0.1;

/** Moves a spring `dt` seconds toward the reach its arm's rate asks for; the reach is in units where 1 is a tuned raise's peak. */
function stepSpring(s: Spring, raised: number, dt: number): void {
  if (!s.placed) {
    s.placed = true;
    s.prev = raised;
    return;
  }
  if (dt <= 0 || dt > MAX_FRAME) {
    s.prev = raised;
    return;
  }
  const rate = (raised - s.prev) / dt;
  s.prev = raised;
  // Lowering gives a share of what raising does.
  const target = rate * RATE_TO_REACH * (rate < 0 ? LOWER_SHARE : 1);
  let left = dt;
  while (left > 1e-9) {
    const h = Math.min(SUBSTEP, left);
    s.v += (OMEGA * OMEGA * (target - s.x) - 2 * ZETA * OMEGA * s.v) * h;
    s.x += s.v * h;
    left -= h;
  }
}

export function createArmSway(): ArmSway {
  const right = newSpring();
  const left = newSpring();
  const out: Sway = { dy: 0, pitch: 0, roll: 0 };
  const clear = (): Sway => {
    Object.assign(right, newSpring());
    Object.assign(left, newSpring());
    out.dy = 0;
    out.pitch = 0;
    out.roll = 0;
    return out;
  };
  return {
    step(dt, r, l, scale, paused) {
      // Nothing at all while paused, while the bob is off, or while both arms are hidden: and what was left of a motion is dropped, not carried back in.
      if (paused || !(scale > 0)) return clear();
      if (r === null) Object.assign(right, newSpring());
      else stepSpring(right, r, dt);
      if (l === null) Object.assign(left, newSpring());
      else stepSpring(left, l, dt);
      const k = scale / TUNED_SCALE;
      // A reach dips the eye and pitches it down; its sign gives the other way for lowering.
      const dy = -(RIGHT_ARM.dip * right.x + LEFT_ARM.dip * left.x) * k;
      const pitch = (RIGHT_ARM.pitch * right.x + LEFT_ARM.pitch * left.x) * k;
      const roll = (RIGHT_ARM.roll * right.x + LEFT_ARM.roll * left.x) * k;
      // (`+ 0` makes a negative zero a zero.)
      out.dy = Math.max(-MAX_DIP, Math.min(MAX_DIP, dy)) + 0;
      out.pitch = Math.max(-MAX_PITCH, Math.min(MAX_PITCH, pitch)) + 0;
      out.roll = Math.max(-MAX_ROLL, Math.min(MAX_ROLL, roll)) + 0;
      return out;
    },
    reset() {
      clear();
    },
  };
}

/**
 * What the game's session writes for the view to read: the bob's scale as the engine last set it (the engine keeps it to itself, so the session sees it go by),
 * and whether the game is paused.
 */
export const SWAY_INPUT: { scale: number; paused: boolean } = { scale: TUNED_SCALE, paused: false };
