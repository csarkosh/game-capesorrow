/**
 * Growth: tufts of grass and weed that stand in the seams of the town. A tuft is three to five thin upright blades, each one triangle (three corners, dark at
 * the foot and light at the tip), leaning outward from its root, 8 to 35 cm tall, in two or three dull greens and a dead straw colour. They are drawn in the
 * standing layer in vertex colour (no texture), so a blade costs three vertices.
 *
 * Where they grow is the cause's: where the ground is cracked (the seam between wall and sidewalk, the kerb line, the sidewalk's joints and cracks, a gone slab),
 * round the foot of everything that stands (poles, hydrants, bins, sign posts, mailboxes, fence lines) and along the feet of the buildings' side and back walls,
 * where nobody walks. More where the street is little used, the run is worn, the lot beside it is let go or the building is vacant; none on the walking line of a
 * busy front. The sidewalk builder (`walkGeometry.ts`) says where its seams are (`plant`); this file adds the rest from the plan and lays all of it.
 *
 * Blades stand at least 6 cm off any wall and lean away from it (the depth buffer's finder, `depthSeparation.test.ts`, holds the whole town to zero faces
 * within 2.45 cm that look one way), and no two blades of a tuft look the same way.
 */
import type { MeshBuilder, Rgb, Vec3 } from "./meshBuilder.js";
import { hash01 } from "./meshBuilder.js";
import type { TownGround, Detail } from "./townTypes.js";
import type { Building } from "../../sim/town/types.js";
import { levelOf } from "./buildingWear.js";

type Sink = (x: number, z: number) => MeshBuilder;

/** A place where something grows: world x and z, how many tufts (a fraction is a chance), how tall (0 low, 1 tall), how dead (0 green, 1 straw), and the way the wall is (`ax`, `az`: unit, away from it; 0, 0 for none). */
export type Site = { readonly blades?: number; readonly wide?: number; readonly x: number; readonly z: number; readonly n: number; readonly tall: number; readonly dry: number; readonly ax: number; readonly az: number; readonly seed: number };

let sites: Site[] = [];
/** The directions the blades already stand in, by cell of 0.4 m: two blades near each other never look one way (the finder holds faces that do, and lie within 2.45 cm, apart). */
let claimed = new Map<number, number[]>();

function claim(x: number, z: number, ang: number): number {
  let a = ang;
  for (let tries = 0; tries < 12; tries++) {
    let clash = false;
    const cx = Math.floor(x / 0.4);
    const cz = Math.floor(z / 0.4);
    for (let i = -1; i <= 1 && !clash; i++) {
      for (let j = -1; j <= 1 && !clash; j++) {
        for (const q of claimed.get((cx + i) * 100003 + (cz + j)) ?? []) {
          let d = Math.abs(a - q) % (Math.PI * 2);
          if (d > Math.PI) d = Math.PI * 2 - d;
          if (d < 0.14) clash = true;
        }
      }
    }
    if (!clash) break;
    a += 0.19;
  }
  const key = Math.floor(x / 0.4) * 100003 + Math.floor(z / 0.4);
  const l = claimed.get(key);
  if (l === undefined) claimed.set(key, [a]);
  else l.push(a);
  return a;
}

/** Forgets the sites of the last build (`townGeometry` calls it first). */
export function resetGrowth(): void {
  sites = [];
  claimed = new Map();
}

/** Plants a site (the sidewalk builder's seams). */
export function plant(x: number, z: number, n: number, tall: number, dry: number, seed: number, ax = 0, az = 0): void {
  sites.push({ x, z, n, tall, dry, ax, az, seed });
}

// Dark and olive greens (the standing layer lights them, and the overcast takes a good deal of it); a tuft in six is dead straw.
const GREENS: readonly Rgb[] = [
  [0.42, 0.62, 0.16],
  [0.5, 0.66, 0.2],
  [0.36, 0.56, 0.13],
  [0.52, 0.6, 0.22],
];
const STRAW: Rgb = [0.62, 0.5, 0.28];
const FOOT_COLOUR = (c: Rgb): Rgb => [c[0] * 0.7, c[1] * 0.75, c[2] * 0.6];
const LIGHT_TIP = (c: Rgb): Rgb => [c[0] * 1.25, c[1] * 1.2, c[2] * 1.0];

/** The blades of one tuft rooted at (x, y, z), into `m`: five to nine, narrow (1 to 3 cm at the foot), 8 to 30 cm tall, leaning different ways, a few bent over. */
function tuft(m: MeshBuilder, x: number, y: number, z: number, s: Site, k: number, blades: number, dry: number, small: boolean): void {
  const r = (i: number): number => hash01(s.seed * 131 + k * 17 + i, 4242);
  const base = r(0) * Math.PI * 2;
  const hMax = Math.min(0.3, (small ? 0.12 : 0.17) + (small ? 0.06 : 0.12) * s.tall * (0.5 + 0.5 * r(1)) + 0.04 * r(2));
  const tuftDry = r(3) < dry * 0.4;
  const walled = s.ax !== 0 || s.az !== 0;
  for (let b = 0; b < blades; b++) {
    // Round a free root the blades fan over the whole circle; against a wall, over the half that leans away from it (no two of a tuft look the same way).
    const ang = walled
      ? Math.atan2(s.az, s.ax) + ((b + 0.5) / blades - 0.5) * Math.PI * 0.94 + 0.1 * (r(10 + b) - 0.5)
      : base + ((b + 0.25 * (r(10 + b) - 0.5)) / blades) * Math.PI * 2;
    const ang2 = claim(x, z, ang);
    const dx = Math.cos(ang2);
    const dz = Math.sin(ang2);
    const h = hMax * (0.4 + 0.6 * r(20 + b));
    // One blade in five is bent over: its tip lies far out and low.
    const bent = r(25 + b) < 0.2;
    const lean = h * (bent ? 0.55 + 0.35 * r(30 + b) : 0.1 + 0.4 * r(30 + b));
    const tipY = bent ? y + h * (0.55 + 0.2 * r(35 + b)) : y + h;
    const w = 0.005 + 0.01 * r(40 + b);
    // The foot is a few cm off the root, so the blades fan.
    const fx = x + dx * 0.03 * r(50 + b);
    const fz = z + dz * 0.03 * r(60 + b);
    const px = -dz;
    const pz = dx;
    const tip: Vec3 = [fx + dx * lean, tipY, fz + dz * lean];
    const colour = tuftDry || r(70 + b) < 0.08 ? STRAW : (GREENS[Math.floor(r(80 + b) * GREENS.length)] as Rgb);
    const tipColour = LIGHT_TIP(colour);
    const foot = FOOT_COLOUR(colour);
    const pa: Vec3 = [fx - px * w, y, fz - pz * w];
    const pb: Vec3 = [fx + px * w, y, fz + pz * w];
    // The blade's own normal is sideways, so the sky never reaches it: it is lit by that normal turned halfway up (it still faces the way the blade is wound, so the face stays one the renderer draws).
    const ux = pb[0] - pa[0];
    const uy = pb[1] - pa[1];
    const uz = pb[2] - pa[2];
    const vx = tip[0] - pa[0];
    const vy = tip[1] - pa[1];
    const vz = tip[2] - pa[2];
    let gx = uy * vz - uz * vy;
    let gy = uz * vx - ux * vz;
    let gz = ux * vy - uy * vx;
    const gl = Math.sqrt(gx * gx + gy * gy + gz * gz) || 1;
    const sgn = (gx * dx + gy * 0.15 + gz * dz) / gl < 0 ? -1 : 1;
    gx = (sgn * gx) / gl;
    gy = (sgn * gy) / gl;
    gz = (sgn * gz) / gl;
    const lx = gx * 0.7;
    const ly = gy * 0.7 + 0.7;
    const lz = gz * 0.7;
    const ll = Math.sqrt(lx * lx + ly * ly + lz * lz);
    m.poly([pa, pb, tip], [dx, 0.15, dz], [foot, foot, tipColour], undefined, { glow: 0.1, normal: [lx / ll, ly / ll, lz / ll] });
  }
}


/** Everything of the growth, into the standing layer. */
export function growthGeometry(g: TownGround, solid: Sink, detail: Detail): void {
  const low = detail === "low";
  const ax = g.anchor.x;
  const az = g.anchor.z;
  const plan = g.plan;
  const lay = (s: Site): void => {
    // Low tier: a third of the sites, three blades each, taller.
    const roll = hash01(s.seed, 777);
    const count = s.n < 1 ? (roll < s.n ? 1 : 0) : Math.floor(s.n + (roll < s.n - Math.floor(s.n) ? 1 : 0));
    if (count === 0) return;
    if (low && hash01(s.seed, 778) > 0.06) return;
    const m = solid(s.x, s.z);
    const spread = s.wide ?? 0.07;
    for (let k = 0; k < count; k++) {
      let ox = (hash01(s.seed * 7 + k, 91) - 0.5) * spread * 2 * (k === 0 ? 0 : 1);
      let oz = (hash01(s.seed * 7 + k, 92) - 0.5) * spread * 2 * (k === 0 ? 0 : 1);
      // Against a wall a clump spreads along it and outward, never in toward it.
      const inward = ox * s.ax + oz * s.az;
      if ((s.ax !== 0 || s.az !== 0) && inward < 0) {
        ox -= 2 * inward * s.ax;
        oz -= 2 * inward * s.az;
      }
      const x = s.x + ox;
      const z = s.z + oz;
      const y = g.heightAt(x, z) + 0.02;
      tuft(m, x, y, z, s, k, low ? 3 : (s.blades ?? 5 + Math.floor(hash01(s.seed, 95 + k) * 4.99)), s.dry, s.tall < 0.25);
    }
  };
  for (const s of sites) lay(s);

  const roll = (a: number, b: number, c = 0): number => hash01(Math.imul(a + 1, 7919) ^ Math.imul(b + 3, 104729), c + 31337);

  // ---- round the foot of what stands
  const foot = (x: number, z: number, seed: number, n: number, tall: number, dry: number): void => lay({ x: x + ax, z: z + az, n, tall, dry, ax: 0, az: 0, seed });
  for (const p of plan.props.poles) {
    // Poles stand along the street at the sidewalk's edge: weeds round the base, more under the older ones.
    foot(p.x + 0.16, p.z + 0.1, p.seed * 5 + 1, 1, 0.7, 0.3);
  }
  for (const f of plan.props.furniture) {
    const n = f.kind === "hydrant" ? 1 : f.kind === "sign post" ? 1 : f.kind === "trash can" ? 1 : f.kind === "planter" ? 1 : 0.6;
    // At the side away from the walking line: toward the lot (hx, hz point where the thing faces: the street).
    foot(f.x - f.hx * 0.3 + f.hz * 0.12, f.z - f.hz * 0.3 - f.hx * 0.12, f.seed * 5 + 3, n, 0.55, 0.3);
  }
  for (const b of plan.props.bins) {
    foot(b.x - b.hz * 0.8, b.z + b.hx * 0.8, b.seed * 5 + 5, 1, 0.8, 0.4);
    foot(b.x + b.hz * 0.8, b.z - b.hx * 0.8, b.seed * 5 + 6, 0.5, 0.8, 0.4);
  }
  for (const mb of plan.props.mailboxes) foot(mb.x + 0.15, mb.z + 0.1, mb.seed * 5 + 7, 1.2, 0.6, 0.3);
  // Fence lines: a tuft at some posts (every 2.4 m or so), each on one side of the line or the other.
  for (const f of plan.props.fences) {
    const dx = f.bx - f.ax;
    const dz = f.bz - f.az;
    const len = Math.hypot(dx, dz);
    if (len < 1) continue;
    const tx = dx / len;
    const tz = dz / len;
    const keep = 0.12 + 0.25 * f.wear;
    for (let d = 0.6, i = 0; d < len - 0.3; d += 1.6 + 1.6 * roll(f.id, i), i++) {
      if (roll(f.id * 31 + i, 5) > keep) continue;
      if (f.gate !== null && Math.abs(d - f.gate.at) < f.gate.width / 2 + 0.2) continue;
      const side = roll(f.id * 17 + i, 6) < 0.5 ? 1 : -1;
      foot(f.ax + tx * d - tz * 0.2 * side, f.az + tz * d + tx * 0.2 * side, f.seed * 3 + i, 1, 0.9, 0.4 + 0.3 * f.wear);
    }
  }

  // ---- along the feet of the buildings' side and back walls, where nobody walks
  const alongFoot = (b: Building, x0: number, z0: number, x1: number, z1: number, awayX: number, awayZ: number, density: number, tag: number): void => {
    const len = Math.hypot(x1 - x0, z1 - z0);
    const tx = (x1 - x0) / len;
    const tz = (z1 - z0) / len;
    // The foot grows in runs with gaps: a stretch of about three metres is green or bare by the building's own weathering, and in a green one the clumps stand close.
    const level = levelOf(b);
    // The foot is a ragged fringe: clumps of three to six tufts a couple of metres apart, with gaps (and the run gating above: green or bare by the building's own weathering).
    for (let d = 0.3, i = 0; d < len - 0.3; d += 1.6 + 2.4 * roll(b.id * 53 + tag, i), i++) {
      if (roll(b.id * 83 + tag, Math.floor(d / 3)) > 0.65 + 0.35 * level) continue;
      if (roll(b.id * 59 + tag, i + 100) > density) continue;
      const off = 0.14 + 0.16 * roll(b.id * 61 + tag, i + 200);
      const x = x0 + tx * d + awayX * off;
      const z = z0 + tz * d + awayZ * off;
      const count = 3 + Math.floor(roll(b.id * 67 + tag, i + 300) * 2.99);
      lay({ x: x + ax, z: z + az, n: count, wide: 0.2, tall: 0.35 + 0.65 * roll(b.id * 71 + tag, i + 400), dry: 0.2 + 0.4 * (b.state === "open" ? 0 : 1), ax: awayX, az: awayZ, seed: b.id * 977 + tag * 101 + i });
    }
  };
  for (const b of plan.buildings) {
    if (b.kind === "pier") continue;
    const fx = b.front?.x ?? 0;
    const fz = b.front?.z ?? 1;
    const ux = -fz;
    const uz = fx;
    const hA = b.halfAlong;
    const hB = b.halfAcross;
    const cx = b.centre.x;
    const cz = b.centre.z;
    const house = b.kind === "house";
    const neglect = b.state === "ruin" ? 1 : b.state === "vacant" ? 0.8 : 0.45;
    const density = (house ? 0.04 : 0.95) * (0.75 + 0.3 * neglect) * (0.8 + 0.2 * Math.min(1, (2026 - b.era) / 100));
    // The back wall (the far side from the street) and the two sides, from the back corner toward the front; the clearance off the wall's plane is the tuft's own.
    alongFoot(b, cx - fx * hB - ux * hA, cz - fz * hB - uz * hA, cx - fx * hB + ux * hA, cz - fz * hB + uz * hA, -fx, -fz, density, 1);
    alongFoot(b, cx - fx * hB - ux * hA, cz - fz * hB - uz * hA, cx + fx * hB * 0.55 - ux * hA, cz + fz * hB * 0.55 - uz * hA, -ux, -uz, density * 0.55, 2);
    alongFoot(b, cx - fx * hB + ux * hA, cz - fz * hB + uz * hA, cx + fx * hB * 0.55 + ux * hA, cz + fz * hB * 0.55 + uz * hA, ux, uz, density * 0.55, 3);
  }
}
