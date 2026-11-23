/**
 * Marks laid on the street, each with its cause (flat marks of their own ranks over the roadway, which the flat ground's depth order keeps apart):
 *
 * - **Oil** where an engine has stood: a soaked patch and a few drips under each parked vehicle's engine end, a trail of drips from its front end (where it
 *   has been pulling in and out), darker the older the vehicle; and a paler, older blotch in some kerb stalls that stand empty now.
 * - **Tyre scuffs**: short black smears along the kerb by the wheels of a parked vehicle, where it has scraped the kerb parking.
 * - **A damp low place** where the gutter dips (a puddle: a dark smooth patch), and, in the stretches between, either leaf and needle drift or sand against
 *   the kerb (the sand on the kerbs whose face looks at the water, the leaves along the shady ones), one feature to a stretch of nine metres of kerb.
 *
 * Soft irregular outlines (seven to nine points, each moved by a roll; kept star-shaped so a fan of triangles fills them), never a regular polygon. Ranks: oil 8,
 * leaves and sand 6, puddles 9, scuffs 10 (above the vehicle's own dark at 7). Marks of one rank are kept apart by their places, not by cutting.
 * Full tier only: the low tier has none.
 */
import type { MeshBuilder, Rgb, Vec3 } from "./meshBuilder.js";
import { hash01 } from "./meshBuilder.js";
import type { TownGround } from "./townTypes.js";
import type { Vehicle } from "../../sim/town/types.js";

type Sink = (x: number, z: number) => MeshBuilder;

/** Lies this much over the ground (the roadway's own height is the ground's, the street's trough included). */
const LIFT = 0.012;
const MARGIN = 14;

type Ring = { readonly x: number; readonly z: number; readonly ux: number; readonly uz: number };

export function groundStains(g: TownGround, flat: Sink): void {
  const ax = g.anchor.x;
  const az = g.anchor.z;
  const plan = g.plan;
  const vehicles = plan.props.vehicles;
  const roll = (a: number, b: number, c = 0): number => hash01(Math.imul(a + 1, 7919) ^ Math.imul(b + 3, 104729), c + 9001);

  // Marks of one rank never overlap: a blob that would touch another of its rank (within the two radii, widened) is not laid.
  const taken = new Map<number, { x: number; z: number; r: number }[]>();
  const free = (rank: number, x: number, z: number, r: number): boolean => {
    const list = taken.get(rank) ?? [];
    for (const q of list) if ((q.x - x) * (q.x - x) + (q.z - z) * (q.z - z) < (q.r + r) * (q.r + r)) return false;
    list.push({ x, z, r });
    taken.set(rank, list);
    return true;
  };
  /** A soft blob at (x, z) (plan frame), `ux`,`uz` its long axis, half lengths `a` and `b`, seven to nine points, each swung by `seed`. */
  const blob = (x: number, z: number, ux: number, uz: number, a: number, b: number, colour: Rgb, rank: number, seed: number): void => {
    if (!free(rank, x, z, Math.max(a, b) * 1.25)) return;
    const n = 8;
    const pts: Vec3[] = [];
    const rot = (roll(seed, 2) - 0.5) * 0.5;
    // The ground under the blob is a plane through the heights at its centre and its two ends and sides (a street may slope, and a kerb may be near).
    const hc = g.heightAt(ax + x, az + z);
    const gu = (g.heightAt(ax + x + ux * a, az + z + uz * a) - g.heightAt(ax + x - ux * a, az + z - uz * a)) / (2 * a);
    const gv = (g.heightAt(ax + x - uz * b, az + z + ux * b) - g.heightAt(ax + x + uz * b, az + z - ux * b)) / (-2 * b);
    for (let k = 0; k < n; k++) {
      const ang = ((k + 0.3 * (roll(seed, 10 + k) - 0.5)) / n) * Math.PI * 2 + rot;
      // An ellipse with the radius moved a few per cent: soft and uneven, and convex enough for a fan of triangles.
      const r = 0.92 + 0.16 * roll(seed, 30 + k);
      const lx = Math.cos(ang) * a * r;
      const lz = Math.sin(ang) * b * r;
      const px = x + ux * lx - uz * lz;
      const pz = z + uz * lx + ux * lz;
      pts.push([ax + px, hc + gu * lx + gv * lz + LIFT, az + pz]);
    }
    flat(ax + x, az + z).poly(pts, [0, 1, 0], colour, undefined, { rank });
  };

  const OIL: Rgb = [0.006, 0.006, 0.008];
  const OLD_OIL: Rgb = [0.03, 0.03, 0.034];

  // ---- under and in front of each parked vehicle
  const near = new Map<number, Vehicle[]>();
  const cellOf = (x: number, z: number): number => Math.floor(x / 8) * 4096 + Math.floor(z / 8);
  for (const v of vehicles) {
    const k = cellOf(v.x, v.z);
    const l = near.get(k);
    if (l === undefined) near.set(k, [v]);
    else l.push(v);
  }
  const vehicleNear = (x: number, z: number, r: number): boolean => {
    for (let i = -1; i <= 1; i++) {
      for (let j = -1; j <= 1; j++) {
        const l = near.get(cellOf(x + i * 8, z + j * 8));
        if (l === undefined) continue;
        for (const v of l) {
          if ((v.x - x) * (v.x - x) + (v.z - z) * (v.z - z) < r * r) return true;
        }
      }
    }
    return false;
  };
  for (const v of vehicles) {
    const seed = v.seed;
    // The engine is at the front end of the body (a few of the old pickups and the vans, rear: not told apart here).
    const hl = v.length / 2;
    const oil = 0.25 + 0.6 * v.age + 0.3 * v.idle;
    if (roll(seed, 100) > oil) continue;
    const ex = v.x + v.hx * hl * 0.45;
    const ez = v.z + v.hz * hl * 0.45;
    const ux = v.hx;
    const uz = v.hz;
    // The soaked patch under the engine, and its drips beside it; both sit under the body, with the trail beyond the bumper in view.
    blob(ex, ez, ux, uz, 0.32 + 0.2 * oil, 0.22 + 0.12 * oil, OIL, 8, seed * 3 + 1);
    for (let k = 0; k < 3; k++) {
      // Beyond the bumper, where it has been pulling in: drips spaced down the line it took.
      const d = hl + 0.35 + k * (0.45 + 0.3 * roll(seed, 110 + k));
      const lat = (roll(seed, 120 + k) - 0.5) * 0.5;
      blob(v.x + ux * d - uz * lat, v.z + uz * d + ux * lat, ux, uz, 0.05 + 0.04 * roll(seed, 130 + k), 0.04 + 0.03 * roll(seed, 140 + k), OIL, 8, seed * 5 + k);
    }
  }

  // ---- along each curbed side of the town's streets
  const lee = plan.quay.seaward;
  for (const st of plan.streets) {
    if (st.kind !== "street" && st.kind !== "main" && st.kind !== "avenue") continue;
    const e = plan.edges[st.id];
    if (e === undefined) continue;
    const dx = st.b.x - st.a.x;
    const dz = st.b.z - st.a.z;
    const len = Math.sqrt(dx * dx + dz * dz);
    if (len < 2 * MARGIN + 6) continue;
    const tx = dx / len;
    const tz = dz / len;
    const nx = -tz;
    const nz = tx;
    const hw = st.roadway / 2;
    for (const side of [0, 1] as const) {
      if (!e.sides[side].curb) continue;
      const sg = side === 0 ? 1 : -1;
      // The kerb's face looks into the road: (−sg·n). Sand lodges where that face looks at the water; leaves where the sidewalk beyond is shady (a verge: trees).
      const faceSea = -sg * (nx * lee.x + nz * lee.z);
      const verge = e.sides[side].verge;
      const at = (s: number, t: number): [number, number] => [st.a.x + tx * s + nx * t * sg, st.a.z + tz * s + nz * t * sg];
      // Leaves drifted along the sidewalk's back edge (against the building's foot and in its doorways), more under trees (a verge) and where the run is little used.
      const sw = e.sides[side];
      if (sw.walk >= 1.5) {
        const tb = hw + 0.2 + sw.verge + sw.walk - 0.28;
        for (const run of sw.runs) {
          for (let s = run.s0 + 2; s < run.s1 - 2; s += 7.5) {
            const seed = st.id * 4001 + side * 211 + Math.floor(s);
            if (roll(seed, 80) > 0.3 + 0.25 * Math.min(1, sw.verge / 1.5) + 0.2 * (1 - e.use)) continue;
            const n = 2 + Math.floor(roll(seed, 81) * 3);
            for (let k = 0; k < n; k++) {
              const [qx, qz] = at(s + (k - 1) * 0.5 + (roll(seed, 82 + k) - 0.5) * 0.4, tb - 0.2 * roll(seed, 90 + k));
              blob(qx, qz, tx, tz, 0.12 + 0.2 * roll(seed, 100 + k), 0.06 + 0.07 * roll(seed, 110 + k), roll(seed, 120 + k) < 0.5 ? [0.1, 0.06, 0.025] : [0.08, 0.07, 0.025], 6, seed * 13 + k);
            }
          }
        }
      }
      let step = 0;
      for (let s = MARGIN; s < len - MARGIN; s += 9) {
        const seed = st.id * 977 + side * 131 + step++;
        const sj = s + roll(seed, 1) * 4;
        // Where the roadway dips toward the gutter: lower than its two neighbours 2.5 m either way.
        const [x0, z0] = at(sj, hw - 0.35);
        const hAt = (ss: number): number => g.heightAt(ax + at(ss, hw - 0.35)[0], az + at(ss, hw - 0.35)[1]);
        const h = g.heightAt(ax + x0, az + z0);
        const low = h < (hAt(sj - 2.5) + hAt(sj + 2.5)) / 2 - 0.004;
        const [px, pz] = at(sj, hw - 0.3);
        if (vehicleNear(px, pz, 2.4)) {
          // A car stands here: its tyres have scraped the kerb. Two smears by the wheels.
          if (roll(seed, 5) < 0.6 + 0.3 * e.use) {
            for (const o of [-1.2, 1.3]) {
              const [qx, qz] = at(sj + o, hw - 0.12);
              const w = 0.08 + 0.05 * roll(seed, 6);
              const l = 0.5 + 0.5 * roll(seed + o, 7);
              flat(ax + qx, az + qz).poly([[ax + qx - tx * l / 2 - nx * sg * w, g.heightAt(ax + qx, az + qz) + LIFT, az + qz - tz * l / 2 - nz * sg * w], [ax + qx + tx * l / 2 - nx * sg * w * 0.6, g.heightAt(ax + qx, az + qz) + LIFT, az + qz + tz * l / 2 - nz * sg * w * 0.6], [ax + qx + tx * l / 2 + nx * sg * w * 0.6, g.heightAt(ax + qx, az + qz) + LIFT, az + qz + tz * l / 2 + nz * sg * w * 0.6], [ax + qx - tx * l / 2 + nx * sg * w, g.heightAt(ax + qx, az + qz) + LIFT, az + qz - tz * l / 2 + nz * sg * w]], [0, 1, 0], [0.01, 0.01, 0.012], undefined, { rank: 10 });
            }
          }
          continue;
        }
        if (low && roll(seed, 8) < 0.7) {
          // A puddle in the dip: long along the gutter, dark and smooth.
          {
            const b = 0.25 + 0.25 * roll(seed, 11);
            const [qx, qz] = at(sj, hw - 0.1 - b * 1.2);
            blob(qx, qz, tx, tz, 0.9 + 1.2 * roll(seed, 9), b, [0.012, 0.015, 0.02], 9, seed);
          }
        } else if (faceSea > 0.3 && roll(seed, 12) < 0.55) {
          // Sand drifted against the kerb that faces the water: pale, long and low.
          {
            const b = 0.15 + 0.18 * roll(seed, 14);
            const [qx, qz] = at(sj, hw - 0.1 - b * 1.2);
            blob(qx, qz, tx, tz, 0.7 + 1.1 * roll(seed, 13), b, [0.3, 0.26, 0.19], 6, seed);
          }
        } else if (roll(seed, 15) < 0.3 + 0.3 * Math.min(1, verge / 1.5) + 0.2 * (1 - e.use)) {
          // Leaf and needle drift along the gutter: brown and ochre, in two or three pieces.
          const n = 2 + Math.floor(roll(seed, 16) * 2);
          for (let k = 0; k < n; k++) {
            const [qx, qz] = at(sj + (k - 1) * 0.9 + (roll(seed, 20 + k) - 0.5) * 0.4, hw - 0.3 - 0.1 * roll(seed, 30 + k));
            blob(qx, qz, tx, tz, 0.3 + 0.35 * roll(seed, 40 + k), 0.08 + 0.1 * roll(seed, 50 + k), roll(seed, 60 + k) < 0.5 ? [0.1, 0.06, 0.025] : [0.07, 0.065, 0.025], 6, seed * 11 + k);
          }
        } else if (roll(seed, 70) < 0.3 + 0.2 * e.use) {
          // An empty kerb stall's old oil: pale and wide, with a few drips.
          const [qx, qz] = at(sj, hw - 1.3);
          blob(qx, qz, tx, tz, 0.35, 0.25, OLD_OIL, 8, seed + 3);
          blob(qx + tx * 0.7, qz + tz * 0.7, tx, tz, 0.07, 0.05, OLD_OIL, 8, seed + 4);
        }
      }
    }
  }
  void (undefined as unknown as Ring);
}
