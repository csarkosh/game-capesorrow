/**
 * Utility poles and their wires. A line of wooden poles runs down one side of each street (the side and the spacing vary by the street's
 * era: tighter and more ragged in the old plat, wider on the edges), every 35 to 45 m, behind the curb in the verge (or at the edge of a
 * narrow sidewalk), or at the shoulder's edge where the street has no curb; never in a drive's mouth, an alley's or a junction's corner
 * (the keep-out boxes of `context.ts`). The older streets carry crossarms with insulators, the newer pin brackets; some poles lean,
 * some carry a transformer can, some have the stub of the pole they replaced beside them, a streetlight reaches out from one near some
 * junctions. Every building that is lived in (or kept power to) is dropped a service wire from the nearest pole of its street.
 */
import { bearingU, bearingV } from "../../bearings.js";
import { chance, range, next } from "../../rng.js";
import type { Drop, Pole } from "../../types.js";
import { boxAt } from "./boxes.js";
import { at, sub, type Context, type StreetFrame } from "./context.js";
import { put, type Out } from "./out.js";
import * as T from "./tuning.js";
import { TAG } from "./vehicles.js";

type MutablePole = { -readonly [K in keyof Pole]: Pole[K] };

/** Which side of a street the line stands on, and how far from the centre line its poles stand. */
function lineSide(ctx: Context, f: StreetFrame): { side: 0 | 1; t: number } | null {
  const rng = sub(ctx.seed0, TAG.pole, f.street.id * 5);
  const sides: (0 | 1)[] = next(rng) < 0.5 ? [0, 1] : [1, 0];
  for (const side of sides) {
    const e = f.edge.sides[side];
    // Which side has the lots with buildings (the line goes where the service is).
    const t = e.curb
      ? f.hw + 0.18 + (e.verge >= T.POLE_VERGE_MIN ? e.verge * 0.5 : T.POLE_ON_WALK)
      : f.hw + Math.max(0.5, e.verge - T.POLE_SHOULDER_IN);
    if (e.curb || e.verge >= 0.6) return { side, t: (side === 0 ? 1 : -1) * t };
  }
  return null;
}

export function planPoles(ctx: Context, out: Out): void {
  const byStreet: number[][] = ctx.frames.map(() => []);
  for (const f of ctx.frames) {
    if (f === undefined) continue;
    const st = f.street;
    if (st.kind !== "main" && st.kind !== "avenue" && st.kind !== "street") continue;
    const rng = sub(ctx.seed0, TAG.pole, f.street.id * 5 + 1);
    const line = lineSide(ctx, f);
    if (line === null) continue;
    const era = f.edge.era;
    const [lo, hi] = T.POLE_SPACING[era];
    const arm: 0 | 1 | 2 = chance(rng, T.CROSSARM[era]) ? 1 : 2;
    let s = range(rng, 6, lo);
    let prev = -1;
    while (s < f.length - 5) {
      let placed = false;
      for (const nudge of [0, 1.5, -1.5, 3, -3, 4.5, -4.5, 6, -6]) {
        const ss = s + nudge;
        if (ss < 3 || ss > f.length - 3) continue;
        const p = at(f, ss, line.t);
        if (!put(ctx, out, boxAt(p.x, p.z, f.tx, f.tz, 0.42, 0.42), "pole", { margin: 0.5 })) continue;
        const leans = chance(rng, T.POLE_LEAN);
        const la = leans ? range(rng, 0.12, 0.55) : range(rng, 0, 0.04);
        const dir = next(rng) < 0.5 ? 1 : -1;
        const along = next(rng) < 0.5;
        const id = out.poles.length;
        const pole: MutablePole = {
          id, street: st.id, x: p.x, z: p.z, height: range(rng, T.POLE_HEIGHT.min, T.POLE_HEIGHT.max), lx: (along ? f.tx : f.nx) * la * dir, lz: (along ? f.tz : f.nz) * la * dir,
          arm, transformer: chance(rng, T.POLE_TRANSFORMER), light: null, stub: chance(rng, T.POLE_STUB), next: -1, seed: Math.floor(next(rng) * 0x7fffffff),
        };
        if (pole.stub) {
          const sp = at(f, ss + 0.9, line.t);
          const stub = boxAt(sp.x, sp.z, f.tx, f.tz, 0.4, 0.4);
          if (put(ctx, out, stub, "pole", { margin: 0.1 })) pole.stub = true;
          else pole.stub = false;
        }
        out.poles.push(pole);
        (byStreet[st.id] as number[]).push(id);
        if (prev >= 0) (out.poles[prev] as MutablePole).next = id;
        prev = id;
        s = ss;
        placed = true;
        break;
      }
      s += placed ? range(rng, lo, hi) : range(rng, 8, 14);
    }
  }
  // A streetlight arm at some junctions: on the nearest pole of one of its streets that stands within 22 m of it.
  for (const j of ctx.plan.junctions) {
    if (j.legs.length < 3 || j.kind === "alley" || j.kind === "rail" || j.kind === "stair" || j.kind === "road end") continue;
    const rng = sub(ctx.seed0, TAG.pole, 100000 + j.id);
    if (!chance(rng, T.JUNCTION_LIGHT)) continue;
    let best: MutablePole | null = null;
    let bestD = 22;
    for (const sid of j.streets) {
      for (const pid of byStreet[sid] ?? []) {
        const p = out.poles[pid] as MutablePole;
        const d = Math.sqrt((p.x - j.x) * (p.x - j.x) + (p.z - j.z) * (p.z - j.z));
        if (d < bestD && p.light === null) {
          bestD = d;
          best = p;
        }
      }
    }
    if (best === null) continue;
    const f = ctx.frames[best.street] as StreetFrame;
    // The arm reaches toward the roadway's centre line.
    const sc = (best.x - f.ax) * f.tx + (best.z - f.az) * f.tz;
    const c = at(f, sc, 0);
    const ox = c.x - best.x;
    const oz = c.z - best.z;
    const l = Math.sqrt(ox * ox + oz * oz);
    if (l > 0.1) best.light = { ox: ox / l, oz: oz / l };
  }
  // Service drops: each building that has power, from the nearest pole of the street it fronts.
  for (const info of ctx.lots) {
    const b = info.building;
    if (b === undefined || b.state === "ruin" || b.front === null || info.street < 0) continue;
    const rng = sub(ctx.seed0, TAG.pole, 200000 + b.id);
    if (b.state === "vacant" && !chance(rng, 0.6)) continue;
    const poles = byStreet[info.street] ?? [];
    if (poles.length === 0) continue;
    const f = ctx.frames[info.street] as StreetFrame;
    const sb = (b.centre.x - f.ax) * f.tx + (b.centre.z - f.az) * f.tz;
    let bestP = -1;
    let bd = Infinity;
    for (const pid of poles) {
      const p = out.poles[pid] as Pole;
      const d = Math.abs((p.x - f.ax) * f.tx + (p.z - f.az) * f.tz - sb);
      if (d < bd) {
        bd = d;
        bestP = pid;
      }
    }
    const p = out.poles[bestP] as Pole;
    const u = bearingU(b.bearing);
    const v = bearingV(b.bearing);
    const fr = b.front;
    const reach = Math.abs(fr.x * u.x + fr.z * u.z) * b.halfAlong + Math.abs(fr.x * v.x + fr.z * v.z) * b.halfAcross;
    const wx = -fr.z;
    const wz = fr.x;
    const hw = Math.abs(wx * u.x + wz * u.z) * b.halfAlong + Math.abs(wx * v.x + wz * v.z) * b.halfAcross;
    const lat = (p.x - b.centre.x) * wx + (p.z - b.centre.z) * wz;
    const off = Math.max(-hw + 0.8, Math.min(hw - 0.8, lat));
    const ax = b.centre.x + fr.x * (reach + 0.05) + wx * off;
    const az = b.centre.z + fr.z * (reach + 0.05) + wz * off;
    const d = Math.sqrt((ax - p.x) * (ax - p.x) + (az - p.z) * (az - p.z));
    if (d > T.DROP_REACH) continue;
    const drop: Drop = { pole: bestP, building: b.id, x: ax, z: az, y: Math.max(2.4, Math.min(b.height - 0.5, 6.2)) };
    out.drops.push(drop);
  }
}
