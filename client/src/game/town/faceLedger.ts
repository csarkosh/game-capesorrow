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

export function resetLedger(): void {
  LEDGER.clear();
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
