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
import type { Drop, Pole, StreetKind } from "../../types.js";
import { boxAt } from "./boxes.js";
import { at, sub, type Context, type StreetFrame } from "./context.js";
import { put, type Out } from "./out.js";
import * as T from "./tuning.js";
import { TAG } from "./vehicles.js";

/** The streets whose junctions always have a light. */
const MAJOR: readonly StreetKind[] = ["highway", "avenue", "main"];

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
  // Street lights. A light at every junction that a highway, avenue or main street takes part in, and at about half of the others (alleys, stairs, the rail and a street's
  // bare end have none); then along each avenue and main street a light wherever the next one is more than `LIGHT_GAP` m off. Each lamp is its own random stream, so no pole's
  // other draws move.
  const lit = (p: Pole): boolean => p.light !== null;
  const armOf = (p: MutablePole): void => {
    const f = ctx.frames[p.street] as StreetFrame;
    // The arm reaches toward the roadway's centre line.
    const sc = (p.x - f.ax) * f.tx + (p.z - f.az) * f.tz;
    const c = at(f, sc, 0);
    const ox = c.x - p.x;
    const oz = c.z - p.z;
    const l = Math.sqrt(ox * ox + oz * oz);
    if (l > 0.1) p.light = { ox: ox / l, oz: oz / l };
  };
  for (const j of ctx.plan.junctions) {
    if (j.legs.length < 3 || j.kind === "alley" || j.kind === "rail" || j.kind === "stair" || j.kind === "road end") continue;
    const rng = sub(ctx.seed0, TAG.pole, 100000 + j.id);
    const major = j.kind === "highway" || j.streets.some((sid) => MAJOR.includes(ctx.plan.streets[sid]?.kind as StreetKind));
    if (!chance(rng, T.JUNCTION_LIGHT) && !major) continue;
    let best: MutablePole | null = null;
    let bestD = major ? T.JUNCTION_POLE_REACH_MAJOR : T.JUNCTION_POLE_REACH;
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
    if (best !== null) {
      armOf(best);
      continue;
    }
    if (!major) continue;
    // No pole of the line is near a major junction (a highway's, where the line is the street's): a pole of its own is set beside it, on the first of its streets and offsets that has room, and carries the light alone (no wires).
    const lr = sub(ctx.seed0, TAG.pole, 300000 + j.id);
    let placed = false;
    for (const sid of j.streets) {
      const f = ctx.frames[sid];
      if (f === undefined || f.street.kind === "highway" || f.street.kind === "rail" || f.street.kind === "wharf" || f.street.kind === "stair" || f.street.kind === "alley") continue;
      const line = lineSide(ctx, f);
      if (line === null) continue;
      const sj = (j.x - f.ax) * f.tx + (j.z - f.az) * f.tz;
      for (const off of [9, -9, 12, -12, 15, -15, 19, -19, 24, -24]) {
        const ss = sj + off;
        if (ss < 3 || ss > f.length - 3) continue;
        const p = at(f, ss, line.t);
        if (!put(ctx, out, boxAt(p.x, p.z, f.tx, f.tz, 0.42, 0.42), "pole", { margin: 0.5 })) continue;
        const id = out.poles.length;
        const pole: MutablePole = {
          id, street: f.street.id, x: p.x, z: p.z, height: range(lr, T.POLE_HEIGHT.min, T.POLE_HEIGHT.max), lx: 0, lz: 0, arm: 0, transformer: false, light: null, stub: false, next: -1, seed: Math.floor(next(lr) * 0x7fffffff),
        };
        out.poles.push(pole);
        armOf(pole);
        placed = true;
        break;
      }
      if (placed) break;
    }
  }
  // Along an avenue or main street (the highway's own line is not this plan's): where the next light is far, the pole of the street that best splits the gap carries one.
  for (const f of ctx.frames) {
    if (f === undefined || (f.street.kind !== "main" && f.street.kind !== "avenue")) continue;
    const poles = (byStreet[f.street.id] ?? []).map((pid) => out.poles[pid] as MutablePole);
    if (poles.length === 0) continue;
    const along = (p: Pole): number => (p.x - f.ax) * f.tx + (p.z - f.az) * f.tz;
    // The poles tried (an arm that could not be drawn leaves the pole dark: it is not tried again).
    const tried: number[] = [];
    for (;;) {
      // The lights that serve this street: those of any pole within a verge of its line, and the street's two ends.
      const marks: number[] = [0, f.length];
      for (const p of out.poles) {
        if (!lit(p)) continue;
        const lat = Math.abs((p.x - f.ax) * f.nx + (p.z - f.az) * f.nz);
        const sp = along(p);
        if (lat < T.LIGHT_REACH_ACROSS && sp > -T.LIGHT_REACH_ACROSS && sp < f.length + T.LIGHT_REACH_ACROSS) marks.push(sp);
      }
      marks.sort((x, y) => x - y);
      let lo = 0;
      let hi = 0;
      for (let i = 1; i < marks.length; i++) {
        if ((marks[i] as number) - (marks[i - 1] as number) > hi - lo) {
          lo = marks[i - 1] as number;
          hi = marks[i] as number;
        }
      }
      if (hi - lo <= T.LIGHT_GAP) break;
      const mid = (lo + hi) / 2;
      let pick: MutablePole | null = null;
      let pd = Infinity;
      for (const p of poles) {
        if (lit(p) || tried.includes(p.id)) continue;
        const sp = along(p);
        if (sp <= lo + 10 || sp >= hi - 10) continue;
        const d = Math.abs(sp - mid);
        if (d < pd) {
          pd = d;
          pick = p;
        }
      }
      if (pick === null) break;
      tried.push(pick.id);
      armOf(pick);
    }
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
