/**
 * The upright faces laid on a building's walls, so that no two that look the same way stand within 2.45 cm of one plane over a place they
 * both cover (the depth buffer cannot tell them apart). A trim board, a plate, a frame, a sticker and a sign are each put on a wall by their
 * own builders at their own offsets; a face asked for where another already is stands a step (3 cm) further out instead.
 *
 * A face is noted by its horizontal extent (two points of the plane) and its height; it is looked up by its normal (to 0.0025) and the
 * 5 cm bucket of its distance along it. Pure, and cleared at the start of a build (`resetLedger`).
 */

type Face = { readonly d: number; readonly t0: number; readonly t1: number; readonly y0: number; readonly y1: number };

const LEDGER = new Map<string, Face[]>();

/** How far apart two faces of one plane are put, metres: more than the 2.45 cm that the depth buffer is held to at the height of an upper storey. */
export const LEDGER_STEP = 0.03;
/** A face within this of another's plane, and over its place, is a clash. */
const NEAR = 0.0245;

/** The standing pieces laid on the ground, as circles in plan, so that no two pieces are laid through each other. */
const STANDING: { x: number; z: number; r: number }[] = [];

export function resetLedger(): void {
  LEDGER.clear();
  STANDING.length = 0;
}

/** Whether a piece of plan radius `r` at (x, z) clears every piece noted. */
export function standClear(x: number, z: number, r: number): boolean {
  return !STANDING.some((o) => Math.hypot(o.x - x, o.z - z) < o.r + r);
}

/** Notes a piece as laid. */
export function noteStanding(x: number, z: number, r: number): void {
  STANDING.push({ x, z, r });
}

const key = (nx: number, nz: number, bucket: number): string => `${Math.round(nx * 400)},${Math.round(nz * 400)},${bucket}`;

/** The faces that clash with one that looks along (nx, nz), runs from (xa, za) to (xb, zb) at height y0 to y1, and stands `push` metres out along its normal. */
function clash(nx: number, nz: number, xa: number, za: number, xb: number, zb: number, y0: number, y1: number, push: number): boolean {
  const d = nx * xa + nz * za + push;
  const ta = -nz * xa + nx * za;
  const tb = -nz * xb + nx * zb;
  const t0 = Math.min(ta, tb);
  const t1 = Math.max(ta, tb);
  const b = Math.floor(d / 0.05);
  for (let k = b - 1; k <= b + 1; k++) {
    const list = LEDGER.get(key(nx, nz, k));
    if (list === undefined) continue;
    for (const f of list) if (Math.abs(f.d - d) < NEAR && f.t0 < t1 - 1e-4 && t0 < f.t1 - 1e-4 && f.y0 < y1 - 1e-4 && y0 < f.y1 - 1e-4) return true;
  }
  return false;
}

/** Whether a face that looks along (nx, nz), runs from (xa, za) to (xb, zb) at height y0 to y1 is clear of every face noted. */
export function isClear(nx: number, nz: number, xa: number, za: number, xb: number, zb: number, y0: number, y1: number): boolean {
  return !clash(nx, nz, xa, za, xb, zb, Math.min(y0, y1), Math.max(y0, y1), 0);
}

/** Notes a face as laid. */
export function noteFace(nx: number, nz: number, xa: number, za: number, xb: number, zb: number, y0: number, y1: number, push = 0): void {
  const d = nx * xa + nz * za + push;
  const ta = -nz * xa + nx * za;
  const tb = -nz * xb + nx * zb;
  const k = key(nx, nz, Math.floor(d / 0.05));
  const list = LEDGER.get(k);
  const f: Face = { d, t0: Math.min(ta, tb), t1: Math.max(ta, tb), y0: Math.min(y0, y1), y1: Math.max(y0, y1) };
  if (list === undefined) LEDGER.set(k, [f]);
  else list.push(f);
}

/**
 * How far out along its normal (or back along it, for `dir` -1) a face must stand so that none noted lies within 2.45 cm of its plane over its
 * place: 0, or 3 cm, 6 cm and on. The face is then noted at that distance.
 */
export function standOff(nx: number, nz: number, xa: number, za: number, xb: number, zb: number, y0: number, y1: number, dir: 1 | -1 = 1): number {
  let push = 0;
  for (let tries = 0; tries < 8 && clash(nx, nz, xa, za, xb, zb, Math.min(y0, y1), Math.max(y0, y1), dir * push); tries++) push += LEDGER_STEP;
  noteFace(nx, nz, xa, za, xb, zb, y0, y1, dir * push);
  return push;
}

/** How far a board may stand off a wall and still be one that paint is laid on (`faceUnder`): plywood over a window stands 6 cm, trim up to 8, and a step more where the ledger moved it. */
export const BOARD_REACH = 0.12;

/**
 * How far out of the plane through (xa, za) and (xb, zb) (the wall's own, with its normal (nx, nz)) the outermost face that is noted over the place stands, for
 * paint that is to lie on it (a sign painted over the plywood on a window lies on the plywood, not on the wall behind it): 0 where there is none, and no
 * face counts that stands within 2.45 cm of the plane (the wall's own) or farther than `reach` out. Paint is itself no face of the ledger.
 */
export function faceUnder(nx: number, nz: number, xa: number, za: number, xb: number, zb: number, y0: number, y1: number, reach = BOARD_REACH): number {
  const d = nx * xa + nz * za;
  const ta = -nz * xa + nx * za;
  const tb = -nz * xb + nx * zb;
  const t0 = Math.min(ta, tb);
  const t1 = Math.max(ta, tb);
  const lo = Math.min(y0, y1);
  const hi = Math.max(y0, y1);
  let out = 0;
  for (let k = Math.floor(d / 0.05) - 1; k <= Math.floor((d + reach) / 0.05) + 1; k++) {
    const list = LEDGER.get(key(nx, nz, k));
    if (list === undefined) continue;
    for (const f of list) {
      const off = f.d - d;
      if (off > NEAR && off <= reach && off > out && f.t0 < t1 - 1e-4 && t0 < f.t1 - 1e-4 && f.y0 < hi - 1e-4 && lo < f.y1 - 1e-4) out = off;
    }
  }
  return out;
}
