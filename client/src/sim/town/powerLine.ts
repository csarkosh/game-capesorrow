/**
 * The power line beside the highway: wooden poles every `POLE_SPACING` m or so on the highway's inland side, just beyond its
 * shoulder, along the whole coast. A pure function of the world's seed: pole `k` stands near `z = k * POLE_SPACING`, nudged
 * along the line by a hash of `k` so they are not a ruler's row, and moved along it again where it would stand in a town
 * street's roadway (a street that meets the highway), to the nearest clear place.
 *
 * Simulation code: `+ - * /`, `floor`, `abs`, `min`, `max`, `sqrt`, `imul` only.
 */
import { roadCenterX } from "@csarkosh/engine/sim/olympic";
import { planFor } from "./planFor.js";
import { siteFor } from "./siteFor.js";

/** The distance between poles along the line, metres. */
export const POLE_SPACING = 45;
/** How far inland of the highway's centre line a pole stands: beyond its bed (5.5 m) and shoulder. */
export const POLE_OFFSET = 9;
/** A pole's own nudge along the line, either way at most this, metres. */
export const POLE_JITTER = 3;
/** A pole keeps this far from a street's roadway edge, metres. */
export const POLE_STREET_CLEAR = 1.2;
/** A pole is shifted along the line in steps of this, up to `POLE_SHIFT_MAX` times either way. */
export const POLE_SHIFT_STEP = 2;
export const POLE_SHIFT_MAX = 12;
/** A pole's height above its foot, metres. */
export const POLE_HEIGHT = 9.5;

export const POWER_TUNABLES: Readonly<Record<string, number>> = { POLE_SPACING, POLE_OFFSET, POLE_JITTER };

export type Pole = {
  /** The pole's index along the line. */
  readonly k: number;
  readonly x: number;
  readonly z: number;
};

/** A hash of an integer to [0, 1), by multiplication only. */
function hash01(n: number): number {
  let h = Math.imul(n | 0, 0x85ebca6b) ^ 0x2c1b3c6d;
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

type Way = { ax: number; az: number; bx: number; bz: number; half: number };
const WAYS = new Map<number, readonly Way[]>();

/** The town's ways in the world that a pole might stand in: streets and roads out, with the half width of their roadways. */
function waysOf(seed: number): readonly Way[] {
  let w = WAYS.get(seed);
  if (w === undefined) {
    const plan = planFor(seed);
    const a = siteFor(seed).anchor;
    const list: Way[] = [];
    for (const st of plan.streets) {
      if (st.kind === "highway" || st.kind === "rail" || st.kind === "wharf") continue;
      list.push({ ax: a.x + st.a.x, az: a.z + st.a.z, bx: a.x + st.b.x, bz: a.z + st.b.z, half: st.roadway / 2 });
    }
    for (const road of plan.roads) {
      for (let i = 1; i < road.points.length; i++) {
        const p = road.points[i - 1] as { x: number; z: number; width: number };
        const q = road.points[i] as { x: number; z: number; width: number };
        list.push({ ax: a.x + p.x, az: a.z + p.z, bx: a.x + q.x, bz: a.z + q.z, half: (p.width + q.width) / 4 });
      }
    }
    w = list;
    WAYS.set(seed, w);
  }
  return w;
}

function clearOfWays(ways: readonly Way[], x: number, z: number): boolean {
  for (const w of ways) {
    const ex = w.bx - w.ax;
    const ez = w.bz - w.az;
    const l2 = ex * ex + ez * ez;
    let t = l2 === 0 ? 0 : ((x - w.ax) * ex + (z - w.az) * ez) / l2;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    const dx = x - (w.ax + ex * t);
    const dz = z - (w.az + ez * t);
    const r = w.half + POLE_STREET_CLEAR;
    if (dx * dx + dz * dz < r * r) return false;
  }
  return true;
}

/** Pole `k`: where it stands, clear of every street's roadway. */
export function poleAt(seed: number, k: number): Pole {
  const ways = waysOf(seed);
  const z0 = k * POLE_SPACING + (hash01(k) - 0.5) * 2 * POLE_JITTER;
  const at = (z: number): number => roadCenterX(seed, z) + POLE_OFFSET;
  for (let i = 0; i <= POLE_SHIFT_MAX; i++) {
    for (const sign of i === 0 ? [1] : [1, -1]) {
      const z = z0 + sign * i * POLE_SHIFT_STEP;
      const x = at(z);
      if (clearOfWays(ways, x, z)) return { k, x, z };
    }
  }
  return { k, x: at(z0), z: z0 };
}

/** The poles whose z lies in [z0, z1), in order. */
export function polesIn(seed: number, z0: number, z1: number): Pole[] {
  const out: Pole[] = [];
  // A pole's nudge and shift move it at most this far from its nominal place.
  const slack = POLE_JITTER + POLE_SHIFT_STEP * POLE_SHIFT_MAX;
  for (let k = Math.floor((z0 - slack) / POLE_SPACING); k <= Math.floor((z1 + slack) / POLE_SPACING); k++) {
    const p = poleAt(seed, k);
    if (p.z >= z0 && p.z < z1) out.push(p);
  }
  return out;
}
