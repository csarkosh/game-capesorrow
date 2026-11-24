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
import { neglectOf, seamHouses } from "./houseSeam.js";

type Sink = (x: number, z: number) => MeshBuilder;

/** A place where something grows: world x and z, how many tufts (a fraction is a chance), how tall (0 low, 1 tall), how dead (0 green, 1 straw), and the way the wall is (`ax`, `az`: unit, away from it; 0, 0 for none). */
export type Site = { readonly card?: number; readonly big?: "fern" | "dock" | "bramble"; readonly thick?: number; readonly fern?: boolean; readonly high?: number; readonly blades?: number; readonly wide?: number; readonly x: number; readonly z: number; readonly n: number; readonly tall: number; readonly dry: number; readonly ax: number; readonly az: number; readonly seed: number };

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
const FERN_GREENS: readonly Rgb[] = [[0.2, 0.42, 0.14], [0.26, 0.46, 0.16], [0.17, 0.36, 0.12]];
const CANES: readonly Rgb[] = [[0.34, 0.26, 0.12], [0.4, 0.28, 0.14], [0.26, 0.3, 0.12]];
const STRAW: Rgb = [0.62, 0.5, 0.28];
const FOOT_COLOUR = (c: Rgb): Rgb => [c[0] * 0.7, c[1] * 0.75, c[2] * 0.6];
const LIGHT_TIP = (c: Rgb): Rgb => [c[0] * 1.25, c[1] * 1.2, c[2] * 1.0];

/** The blades of one tuft rooted at (x, y, z), into `m`: five to nine, narrow (1 to 3 cm at the foot), 8 to 30 cm tall, leaning different ways, a few bent over. */
function tuft(m: MeshBuilder, x: number, y: number, z: number, s: Site, k: number, blades: number, dry: number, small: boolean): void {
  const r = (i: number): number => hash01(s.seed * 131 + k * 17 + i, 4242);
  const base = r(0) * Math.PI * 2;
  const big = s.big;
  const hMax = big !== undefined ? (big === "bramble" ? 0.8 + 0.4 * r(1) : 0.55 + 0.45 * r(1)) : Math.min(s.high === undefined ? 0.3 : 0.62, (small ? 0.12 : 0.17) + (small ? 0.06 : 0.12) * s.tall * (0.5 + 0.5 * r(1)) + 0.04 * r(2) + (s.high ?? 0) * (0.4 + 0.6 * r(5)));
  const fern = s.fern === true || big === "fern";
  const wm = s.thick ?? 1;
  const pitch = 0.13 + 0.04 * r(7);
  const tuftDry = !fern && r(3) < dry * (s.card !== undefined ? 0.1 : 0.4);
  const walled = s.ax !== 0 || s.az !== 0;
  for (let b = 0; b < blades; b++) {
    // Round a free root the blades fan over the whole circle; against a wall, over the half that leans away from it (no two of a tuft look the same way).
    const ang = walled
      ? Math.atan2(s.az, s.ax) + ((b + 0.5) / blades - 0.5) * Math.PI * 0.94 + 0.1 * (r(10 + b) - 0.5)
      : base + ((b + 0.25 * (r(10 + b) - 0.5)) / blades) * Math.PI * 2;
    // A card: the blades stand side by side in one plane facing outward and turned by `card` radians, each 3.5 cm further out than the last (no two faces within 2.45 cm), so they close into a leafy screen.
    const cardAng = s.card === undefined ? 0 : Math.atan2(s.az, s.ax) + s.card;
    const ang2 = s.card === undefined ? claim(x, z, ang) : cardAng + 0.12 * (r(10 + b) - 0.5);
    const dx = Math.cos(ang2);
    const dz = Math.sin(ang2);
    const h = hMax * (s.card !== undefined ? 0.3 + 0.8 * r(20 + b) * r(21 + b) + 0.35 * r(22 + b) : 0.4 + 0.6 * r(20 + b));
    // One blade in five is bent over: its tip lies far out and low.
    const bent = r(25 + b) < (fern ? 0.7 : big === "bramble" ? 0.8 : big === "dock" ? 0.45 : 0.2);
    const lean = h * (bent ? 0.55 + 0.35 * r(30 + b) : 0.1 + 0.4 * r(30 + b));
    const tipY = bent ? y + h * (0.55 + 0.2 * r(35 + b)) : y + h;
    const w = s.card !== undefined ? pitch * 0.62 * (0.9 + 0.3 * r(40 + b)) : (big === "fern" || s.fern === true ? 0.03 + 0.03 * r(40 + b) : big === "dock" ? 0.045 + 0.035 * r(40 + b) : big === "bramble" ? 0.008 + 0.006 * r(40 + b) : 0.005 + 0.01 * r(40 + b)) * wm;
    // The foot is a few cm off the root, so the blades fan.
    const px = -dz;
    const pz = dx;
    const along = s.card === undefined ? 0 : (b - (blades - 1) / 2) * pitch;
    const out = s.card === undefined ? 0.03 * r(50 + b) : 0.035 * ((b * 2) % blades) * 1;
    const fx = x + dx * out + px * along;
    const fz = z + dz * out + pz * along;
    const tip: Vec3 = [fx + dx * lean, tipY, fz + dz * lean];
    const colour0 = big === "bramble" ? CANES[Math.floor(r(80 + b) * CANES.length)] as Rgb : fern ? FERN_GREENS[Math.floor(r(80 + b) * FERN_GREENS.length)] as Rgb : tuftDry || r(70 + b) < 0.08 ? STRAW : (GREENS[Math.floor(r(80 + b) * GREENS.length)] as Rgb);
    // The weeds at a wall are a dark, dull green (the tufts of the street's seams are the pale ones).
    const colour: Rgb = s.high !== undefined || big !== undefined ? [colour0[0] * 0.5, colour0[1] * 0.58, colour0[2] * 0.5] : colour0;
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
  // A house's seam, by its own record: the weeds stand up to every wall of a house nobody keeps, and a kept one keeps a clean edge on the street side only; ferns on the north side; round the steps and the porch posts.
  const seamed = new Set<number>();
  for (const h of seamHouses()) {
    const b = h.b;
    if (b.kind !== "house" && b.kind !== "boarding house") continue;
    seamed.add(b.id);
    const neg = neglectOf(plan, b);
    const kept = neg < 0.3;
    const long = h.refs.reduce((m, w, k) => (w.length > (h.refs[m] as (typeof h.refs)[number]).length ? k : m), 0);
    h.refs.forEach((w, k) => {
      if (h.blocked[k]) return;
      const front = k === h.frontAt;
      // The street front of a kept house is trimmed to the wall; the front of a tired one is let go a little; the other walls are the mower's last stretch.
      const dens = front ? (kept ? 0 : 0.15 + 0.7 * neg) : kept ? 0.22 : 0.45 + 0.55 * neg;
      if (dens <= 0.02) return;
      const north = w.nz > 0.5;
      const doorS = front && h.door !== null ? h.door : null;
      // A downspout stands at one end of the long walls: the water runs there and the growth is rank.
      const spout = (h.roofKind === "gable" || h.roofKind === "hip" || h.roofKind === "shed") && Math.abs(w.length - (h.refs[long] as (typeof h.refs)[number]).length) <= 0.1 ? (roll(b.id * 3 + k, 551) < 0.5 ? 0.15 : w.length - 0.15) : -9;
      let i = 0;
      for (let d = 0.12; d < w.length - 0.1; d += 1.4 + 0.8 * roll(b.id * 53 + k, i), i++) {
        const corner = Math.min(d, w.length - d) < 0.9;
        const rank = Math.abs(d - spout) < 0.9;
        // Runs of one to three metres stand thick, with gaps of a metre or two between them (more of the wall is thick the more let go the house is).
        const run = roll(b.id * 83 + k, Math.floor(d / 1.7));
        if (!corner && !rank && run > dens * (north ? 1.25 : 1)) continue;
        if (doorS !== null && Math.abs(d - doorS.s) < doorS.half + 0.4) continue;
        const off = 0.17 + 0.4 * roll(b.id * 61 + k, i + 200) * roll(b.id * 61 + k, i + 210);
        const px = w.ax + w.tx * d + w.nx * off;
        const pz = w.az + w.tz * d + w.nz * off;
        lay({ x: px, z: pz, n: 1, blades: corner || rank ? 7 : 5, card: (roll(b.id * 29 + k, i + 600) < 0.5 ? -1 : 1) * (0.25 + 0.9 * roll(b.id * 29 + k, i + 610)), wide: 0.02, tall: 0.55 + 0.45 * roll(b.id * 71 + k, i + 400), high: (corner || rank ? 0.35 : 0.14) + 0.22 * neg, dry: 0.15 + 0.5 * neg, ax: w.nx, az: w.nz, seed: b.id * 977 + k * 101 + i });
      }
      // Something larger every few metres in a run that is thick: a fern on the shaded side, dock, a bramble cane or two.
      for (let d = 0.8 + 1.5 * roll(b.id * 5 + k, 1), j = 0; d < w.length - 0.4; d += 4 + 3 * roll(b.id * 5 + k, 2 + j), j++) {
        const rank = Math.abs(d - spout) < 1.2;
        if (!rank && roll(b.id * 83 + k, Math.floor(d / 1.7)) > dens * (north ? 1.25 : 1)) continue;
        if (doorS !== null && Math.abs(d - doorS.s) < doorS.half + 0.7) continue;
        const rr = roll(b.id * 7 + k, 30 + j);
        const big = north && rr < 0.6 ? "fern" : rr < 0.55 ? "dock" : rr < 0.8 ? "fern" : "bramble";
        const off = 0.28 + 0.3 * roll(b.id * 7 + k, 40 + j);
        lay({ x: w.ax + w.tx * d + w.nx * off, z: w.az + w.tz * d + w.nz * off, n: 1, blades: big === "bramble" ? 3 : 5, big, wide: 0.1, tall: 1, dry: 0.1, ax: w.nx, az: w.nz, seed: b.id * 977 + k * 101 + 500 + j });
      }
    });
    // Round the steps and the porch's posts: weeds stand where the mower and the broom do not reach.
    if (h.door !== null && neg > 0.3) {
      const w = h.refs[h.frontAt] as (typeof h.refs)[number];
      const spots: [number, number][] = [[h.door.s - h.door.half - 0.35, 0.3], [h.door.s + h.door.half + 0.35, 0.3]];
      if (h.door.porch !== null) spots.push([h.door.porch.s0 + 0.1, h.door.out - 0.1], [h.door.porch.s1 - 0.1, h.door.out - 0.1]);
      spots.forEach(([s, out], i) => {
        if (roll(b.id * 13, i + 700) > 0.3 + 0.7 * neg) return;
        const side = i % 2 === 0 ? -1 : 1;
        lay({ x: w.ax + w.tx * (s + side * 0.18) + w.nx * (out + 0.1), z: w.az + w.tz * (s + side * 0.18) + w.nz * (out + 0.1), n: 2, wide: 0.12, tall: 0.5, high: 0.1 + 0.2 * neg, dry: 0.3, ax: 0, az: 0, seed: b.id * 977 + 800 + i });
      });
    }
  }
  for (const b of plan.buildings) {
    if (b.kind === "pier") continue;
    if (seamed.has(b.id)) continue;
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
