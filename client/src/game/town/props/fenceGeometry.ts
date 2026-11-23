/**
 * Fences, drawn along the lot lines the plan gave them, following the ground (every post stands on the ground at its own place, so a panel steps with
 * the slope). A **picket** fence has posts, two rails and a picket every hand's width, some missing or leaning, the paint (painted-siding layer, peeling by wear) in one of
 * six colours; a **board** fence is vertical weathered boards (the weathered-boards layer, with moss and grime, a panel leaning or down); **post-and-wire**
 * has timber posts and three thin strands; **chain-link** is galvanized posts and a top rail with the mesh as a faint see-through sheet in the town's
 * glass layer (a mesh of real wires would shimmer: the sheet cannot, and the rail and posts say what it is). A gate hangs in the gap the plan left, shut or swung.
 */
import type { MeshBuilder, Rgb, Vec3 } from "../meshBuilder.js";
import type { Surface } from "../townSurface.js";
import type { Detail, TownGround } from "../townTypes.js";
import type { Fence } from "../../../sim/town/types.js";
import { groundAt, mixC, rnd, tube } from "./kit.js";

type Sink = (x: number, z: number) => MeshBuilder;

const PICKET_PAINT: readonly Rgb[] = [[0.55, 0.55, 0.52], [0.5, 0.46, 0.34], [0.22, 0.32, 0.4], [0.2, 0.3, 0.2], [0.3, 0.3, 0.3], [0.3, 0.26, 0.2]];
const GALV: Rgb = [0.3, 0.31, 0.32];
const TIMBER: Rgb = [0.2, 0.17, 0.13];
const PANEL = 2.4;
/** How far behind the posts' plane the pickets and the mesh stand, and how far in front of it the top rail: the posts' broad faces lie in that plane. */
const BEHIND = 0.03;
const RAIL_OUT = 0.035;

/** The places posts already stand, by 40 cm cell: a run of fence that meets another at a corner shares the post (two posts at one place are two sets of faces in one plane). */
export type PostBook = Map<string, [number, number][]>;

/** Whether a post stands within 20 cm of (x, z) already; if not, it is entered. */
function postTaken(book: PostBook, x: number, z: number): boolean {
  const cx = Math.floor(x / 0.4);
  const cz = Math.floor(z / 0.4);
  for (let i = -1; i <= 1; i++) {
    for (let j = -1; j <= 1; j++) {
      for (const q of book.get(`${cx + i},${cz + j}`) ?? []) if ((q[0] - x) * (q[0] - x) + (q[1] - z) * (q[1] - z) < 0.04) return true;
    }
  }
  const key = `${cx},${cz}`;
  const list = book.get(key);
  if (list === undefined) book.set(key, [[x, z]]);
  else list.push([x, z]);
  return false;
}

/** Whether a place is at a building's wall or under it (a run of fence laid along a wall lies in the wall's plane: its faces are the wall's, drawn twice). */
export type AtWall = (x: number, z: number) => boolean;

export function fenceGeometry(g: TownGround, sinks: { solid: Sink; glass: Sink }, f: Fence, detail: Detail, book: PostBook = new Map(), atWall: AtWall = () => false): void {
  const ax = g.anchor.x + f.ax;
  const az = g.anchor.z + f.az;
  const bx = g.anchor.x + f.bx;
  const bz = g.anchor.z + f.bz;
  const len = Math.sqrt((bx - ax) * (bx - ax) + (bz - az) * (bz - az));
  if (len < 0.5) return;
  const dx = (bx - ax) / len;
  const dz = (bz - az) / len;
  const nx = -dz;
  const nz = dx;
  const m = sinks.solid(ax, az);
  const gl = sinks.glass(ax, az);
  const low = detail === "low";
  const step = f.kind === "wire" || f.kind === "chain" ? 3 : PANEL;
  const n = Math.max(1, Math.round(len / step));
  const gate = f.gate;
  const inGate = (s: number): boolean => gate !== null && s > gate.at - gate.width / 2 + 0.01 && s < gate.at + gate.width / 2 - 0.01;
  const at = (s: number): { x: number; z: number; y: number } => {
    const x = ax + dx * s;
    const z = az + dz * s;
    return { x, z, y: groundAt(g, x, z) - 0.03 };
  };
  const H = f.kind === "picket" ? 1.05 : f.kind === "board" ? 1.8 : f.kind === "wire" ? 1.15 : 1.5;
  const paint = PICKET_PAINT[f.paint % PICKET_PAINT.length] as Rgb;
  const old = f.wear;
  const surfBoard = (o: Vec3): Surface => ({ layer: "planks_weathered", frame: { origin: o, u: [0, 1, 0], v: [dx, 0, dz] }, tint: [0.85 + rnd(f.seed, 3) * 0.2, 0.84, 0.8], wear: 0.1 + old * 0.5, wearKind: "moss", wear2: 0.15 + old * 0.2, wearKind2: "grime", streaks2: true });
  const surfPicket = (o: Vec3): Surface => ({ layer: "siding_painted", frame: { origin: o, u: [dx, 0, dz], v: [0, 1, 0] }, tint: paint, wear: old * 0.75, wearKind: "peel", wear2: 0.1, wearKind2: "grime" });
  // A post is two crossed quads, upright (a leaning one tilts); the low tier leaves the posts of a wire and chain fence out.
  const postBox = (s: number, h: number, w: number, c: Rgb, lean = 0): void => {
    const p = at(s);
    if (low && (f.kind === "wire" || f.kind === "chain")) return;
    if (atWall(p.x, p.z) || postTaken(book, p.x, p.z)) return;
    const tx = p.x + nx * lean;
    const tz = p.z + nz * lean;
    m.poly([[p.x - dx * w, p.y, p.z - dz * w], [p.x + dx * w, p.y, p.z + dz * w], [tx + dx * w, p.y + h, tz + dz * w], [tx - dx * w, p.y + h, tz - dz * w]], [nx, 0, nz], c);
    m.poly([[p.x + dx * w, p.y, p.z + dz * w], [p.x - dx * w, p.y, p.z - dz * w], [tx - dx * w, p.y + h, tz - dz * w], [tx + dx * w, p.y + h, tz + dz * w]], [-nx, 0, -nz], c);
    if (!low) {
      m.poly([[p.x - nx * w, p.y, p.z - nz * w], [p.x + nx * w, p.y, p.z + nz * w], [tx + nx * w, p.y + h, tz + nz * w], [tx - nx * w, p.y + h, tz - nz * w]], [dx, 0, dz], c);
    }
  };
  // Posts.
  const postC: Rgb = f.kind === "chain" ? GALV : f.kind === "picket" ? mixC(paint, TIMBER, 0.2) : mixC(TIMBER, [0.3, 0.28, 0.25], rnd(f.seed, 1) * 0.6);
  for (let k = 0; k <= n; k++) {
    const s = (len * k) / n;
    if (inGate(s)) continue;
    const leans = rnd(f.seed, 50 + k) < old * 0.3;
    postBox(s, H + (f.kind === "picket" ? 0.1 : 0.05), f.kind === "chain" ? 0.04 : f.kind === "board" ? 0.06 : 0.05, postC, leans ? 0.15 + rnd(f.seed, 80 + k) * 0.2 : 0);
  }
  for (let k = 0; k < n; k++) {
    const s0 = (len * k) / n;
    const s1 = (len * (k + 1)) / n;
    const mid = (s0 + s1) / 2;
    if (inGate(mid)) continue;
    const a = at(s0);
    const b = at(s1);
    if (atWall((a.x + b.x) / 2, (a.z + b.z) / 2)) continue;
    const missing = rnd(f.seed, 100 + k);
    if (f.kind === "board") {
      const down = missing < old * 0.2;
      const lean = down ? 0.4 + rnd(f.seed, 130 + k) * 0.8 : missing < old * 0.4 ? 0.1 + rnd(f.seed, 131 + k) * 0.2 : 0;
      const sg = rnd(f.seed, 160 + k) < 0.5 ? 1 : -1;
      const top = (p: { x: number; z: number; y: number }, side: number): Vec3 => [p.x + nx * lean * side * sg * (down ? 1.3 : 1), p.y + H * (down ? 0.55 : 1 - lean * 0.3), p.z + nz * lean * side * sg * (down ? 1.3 : 1)];
      const face = (hint: Vec3, off: number): void => {
        const o = off;
        m.poly([[a.x + nx * o, a.y, a.z + nz * o], [b.x + nx * o, b.y, b.z + nz * o], top({ x: b.x + nx * o, z: b.z + nz * o, y: b.y }, 1), top({ x: a.x + nx * o, z: a.z + nz * o, y: a.y }, 1)], hint, [0.3, 0.28, 0.25], surfBoard([a.x, a.y, a.z]));
      };
      face([nx, 0.2 * lean * sg, nz], 0.045);
      if (!low) face([-nx, 0.2 * lean * sg, -nz], -0.045);
      // The cap along the top.
      if (!low && !down) m.poly([[a.x + nx * 0.07, a.y + H, a.z + nz * 0.07], [b.x + nx * 0.07, b.y + H, b.z + nz * 0.07], [b.x - nx * 0.07, b.y + H, b.z - nz * 0.07], [a.x - nx * 0.07, a.y + H, a.z - nz * 0.07]], [0, 1, 0], mixC(TIMBER, [0.3, 0.28, 0.25], 0.4));
    } else if (f.kind === "picket") {
      if (!low) for (const y of [0.25, 0.75]) m.poly([[a.x + nx * 0.03, a.y + y, a.z + nz * 0.03], [b.x + nx * 0.03, b.y + y, b.z + nz * 0.03], [b.x + nx * 0.03, b.y + y + 0.07, b.z + nz * 0.03], [a.x + nx * 0.03, a.y + y + 0.07, a.z + nz * 0.03]], [nx, 0, nz], postC);
      if (low) {
        m.poly([[a.x - nx * BEHIND, a.y + 0.05, a.z - nz * BEHIND], [b.x - nx * BEHIND, b.y + 0.05, b.z - nz * BEHIND], [b.x - nx * BEHIND, b.y + H - 0.05, b.z - nz * BEHIND], [a.x - nx * BEHIND, a.y + H - 0.05, a.z - nz * BEHIND]], [nx, 0, nz], paint);
        continue;
      }
      const count = Math.max(2, Math.round((s1 - s0) / 0.14));
      for (let i = 0; i < count; i++) {
        const r = rnd(f.seed, 300 + k * 40 + i);
        if (r < old * 0.18) continue;
        const t = (i + 0.5) / count;
        // Behind the posts' plane (and the rails in front of it), so a picket by a post is not a face in the post's own plane.
        const px = a.x + (b.x - a.x) * t - nx * BEHIND;
        const pz = a.z + (b.z - a.z) * t - nz * BEHIND;
        const py = a.y + (b.y - a.y) * t;
        const w = 0.042;
        const lean = r > 1 - old * 0.12 ? (r - 0.9) * 2 : 0;
        const h = H - 0.05 - (r < old * 0.3 ? 0.18 : 0);
        const o: Vec3 = [px, py, pz];
        const q: Vec3[] = [[px - dx * w, py + 0.04, pz - dz * w], [px + dx * w, py + 0.04, pz + dz * w], [px + dx * w + nx * lean, py + h, pz + dz * w + nz * lean], [px + nx * lean * 1.1, py + h + 0.07, pz + nz * lean * 1.1], [px - dx * w + nx * lean, py + h, pz - dz * w + nz * lean]];
        m.poly(q, [nx, 0, nz], paint, surfPicket(o));
      }
    } else if (f.kind === "wire") {
      if (low) continue;
      for (const y of [0.4, 0.78, 1.1]) {
        if (rnd(f.seed, 200 + k * 3 + Math.floor(y * 10)) < old * 0.15) continue;
        const pts: Vec3[] = [];
        for (let i = 0; i <= 1; i++) {
          const t = i;
          pts.push([a.x + (b.x - a.x) * t + nx * 0.05, a.y + (b.y - a.y) * t + y - 0.05 * Math.sin(t * Math.PI), a.z + (b.z - a.z) * t + nz * 0.05]);
        }
        tube(m, pts, 0.018, [0.18, 0.17, 0.16], 3);
      }
    } else {
      // Chain-link: the mesh as a see-through sheet (both ways), a top rail, a tension wire at the foot.
      const top = (p: { x: number; z: number; y: number }, w: number): Vec3 => [p.x, p.y + H - 0.05 - (rnd(f.seed, 400 + k) < old * 0.15 ? 0.4 * w : 0), p.z];
      const back = (p: Vec3): Vec3 => [p[0] - nx * BEHIND, p[1], p[2] - nz * BEHIND];
      const pa: Vec3 = back([a.x, a.y + 0.06, a.z]);
      const pb: Vec3 = back([b.x, b.y + 0.06, b.z]);
      gl.poly([pa, pb, back(top(b, 1)), back(top(a, 0))], [nx, 0, nz], [0.45, 0.46, 0.48], undefined, { clear: 0.8 });
      // The top rail stands in front of the posts' plane, so its faces are not within 2 cm of theirs.
      if (!low) tube(m, [[a.x + nx * RAIL_OUT, a.y + H, a.z + nz * RAIL_OUT], [b.x + nx * RAIL_OUT, b.y + H, b.z + nz * RAIL_OUT]], 0.022, GALV, 3);
    }
  }
  // The gate.
  if (gate !== null && !atWall(ax + dx * gate.at, az + dz * gate.at)) {
    const s0 = gate.at - gate.width / 2;
    const hinge = at(s0);
    const th = gate.open * 1.3;
    const ex = Math.cos(th) * gate.width;
    const ez = Math.sin(th) * gate.width * (rnd(f.seed, 9) < 0.5 ? 1 : -1);
    const tipX = hinge.x + dx * ex + nx * ez;
    const tipZ = hinge.z + dz * ex + nz * ez;
    const tipY = groundAt(g, tipX, tipZ) - 0.03 + (gate.open > 0.5 ? -0.08 : 0);
    postBox(s0, H + 0.1, 0.06, postC);
    postBox(gate.at + gate.width / 2, H + 0.1, 0.06, postC);
    const hh = H * 0.9;
    const gx = tipZ - hinge.z;
    const gz = -(tipX - hinge.x);
    const gl2 = Math.sqrt(gx * gx + gz * gz) || 1;
    // The leaf stands 3 cm to the side its face looks along, and what is fixed to it 4 cm: nothing of it lies within 2 cm of the posts' plane or of its own.
    const sh = (p: Vec3, d: number): Vec3 => [p[0] + (gx / gl2) * d, p[1], p[2] + (gz / gl2) * d];
    const q: Vec3[] = [sh([hinge.x, hinge.y + 0.15, hinge.z], 0.03), sh([tipX, tipY + 0.15, tipZ], 0.03), sh([tipX, tipY + hh, tipZ], 0.03), sh([hinge.x, hinge.y + hh, hinge.z], 0.03)];
    if (f.kind === "chain") {
      gl.poly(q, [gx / gl2, 0, gz / gl2], [0.45, 0.46, 0.48], undefined, { clear: 0.8 });
      gl.poly([q[1] as Vec3, q[0] as Vec3, q[3] as Vec3, q[2] as Vec3], [-gx / gl2, 0, -gz / gl2], [0.45, 0.46, 0.48], undefined, { clear: 0.8 });
      tube(m, [sh(q[3] as Vec3, 0.01), sh(q[2] as Vec3, 0.01)], 0.022, GALV, 3);
    } else if (f.kind === "wire") {
      for (const y of [0.4, 0.78, 1.1]) tube(m, [sh([hinge.x, hinge.y + y, hinge.z], 0.04), sh([tipX, tipY + y, tipZ], 0.04)], 0.02, [0.3, 0.26, 0.2], 3);
    } else {
      const sf: Surface = f.kind === "board" ? surfBoard([hinge.x, hinge.y, hinge.z]) : surfPicket([hinge.x, hinge.y, hinge.z]);
      const c: Rgb = f.kind === "board" ? [0.3, 0.28, 0.25] : paint;
      m.poly(q, [gx / gl2, 0, gz / gl2], c, sf);
      m.poly([q[1] as Vec3, q[0] as Vec3, q[3] as Vec3, q[2] as Vec3], [-gx / gl2, 0, -gz / gl2], c, sf);
      m.prism(sh([hinge.x, hinge.y + 0.2, hinge.z], 0.07), sh([tipX, tipY + hh - 0.05, tipZ], 0.07), 0.025, 3, postC, null);
    }
  }
}
