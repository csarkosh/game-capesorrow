/**
 * Bins, mailboxes and gear. A wheeled cart is a tapered body with a lid and two wheels (some on their side); a dumpster a steel box of the painted-metal
 * layer with rust and its hinged lids; pallets are weathered boards; a drum is rusted steel. A mailbox stands on a timber post (some lean on it), a flag up or down; a
 * cluster box is a grey cabinet of doors. Crab pots are round frames of wire stacked five to eight high and leaning, with a rope and a buoy on top; buoys lie in
 * strings in the colours of the harbour; totes, coiled line and net piles lie on the deck; firewood, a propane tank and stacked pallets stand in yards.
 */
import type { MeshBuilder, Rgb, Vec3 } from "../meshBuilder.js";
import type { Surface } from "../townSurface.js";
import type { Detail, TownGround } from "../townTypes.js";
import type { Bin, Gear, Mailbox } from "../../../sim/town/types.js";
import { D, P, lbox, lcylY, mixC, placeOn, rnd, tube, type Place } from "./kit.js";

type Sink = (x: number, z: number) => MeshBuilder;

const CART: readonly Rgb[] = [[0.03, 0.12, 0.05], [0.03, 0.07, 0.2], [0.09, 0.09, 0.1], [0.012, 0.012, 0.015]];
const LID: readonly Rgb[] = [[0.02, 0.09, 0.04], [0.02, 0.05, 0.15], [0.07, 0.07, 0.08], [0.01, 0.01, 0.012]];
const MAILBOX: readonly Rgb[] = [[0.01, 0.01, 0.012], [0.25, 0.26, 0.27], [0.5, 0.5, 0.48], [0.03, 0.12, 0.06], [0.04, 0.07, 0.2], [0.3, 0.03, 0.03]];
const BUOY: readonly Rgb[] = [[0.5, 0.04, 0.03], [0.5, 0.35, 0.03], [0.5, 0.5, 0.48], [0.03, 0.12, 0.3], [0.04, 0.3, 0.1], [0.4, 0.12, 0.02]];

function metal(o: Vec3, c: Rgb, wear: number, kind: "rust" | "grime" = "rust"): Surface {
  // The painted-metal layer: ribbed sheet, as a dumpster's sides are. Its tint is the paint over the layer's own mean (a green).
  const mean: Rgb = [0.0184, 0.0927, 0.0192];
  return { layer: "metal_painted", frame: { origin: o, u: [1, 0, 0], v: [0, 1, 0] }, tint: [Math.min(40, c[0] / mean[0]), Math.min(40, c[1] / mean[1]), Math.min(40, c[2] / mean[2])], wear, wearKind: kind, wear2: 0.2, wearKind2: "grime" };
}

function cart(m: MeshBuilder, pl: Place, b: Bin, tipped: boolean): void {
  const c = CART[b.colour % CART.length] as Rgb;
  const lid = LID[b.colour % LID.length] as Rgb;
  const wheel: Rgb = [0.02, 0.02, 0.02];
  if (!tipped) {
    // A body wider at the top, lid hinged at the back (toward -x).
    const w0 = 0.26;
    const w1 = 0.36;
    const pts = (y: number, h: number, hw: number): Vec3[] => [P(pl, -h, y, -hw), P(pl, h, y, -hw), P(pl, h, y, hw), P(pl, -h, y, hw)];
    const lo = pts(0.06, 0.24, w0);
    const hi = pts(1.02, 0.31, w1);
    for (let i = 0; i < 4; i++) {
      const j = (i + 1) % 4;
      const mx = (lo[i]![0] + lo[j]![0]) / 2 - pl.ox;
      const mz = (lo[i]![2] + lo[j]![2]) / 2 - pl.oz;
      m.poly([lo[i] as Vec3, lo[j] as Vec3, hi[j] as Vec3, hi[i] as Vec3], [mx, 0, mz], c);
    }
    lbox(m, pl, -0.33, 0.33, 1.02, 1.07, -0.39, 0.39, lid);
    lbox(m, pl, -0.3, -0.18, 0.0, 0.2, -0.3, 0.3, wheel);
  } else {
    lbox(m, pl, -0.5, 0.5, 0.0, 0.56, -0.3, 0.3, c);
    lbox(m, pl, 0.5, 0.56, 0.0, 0.6, -0.34, 0.34, lid);
    lbox(m, pl, -0.46, -0.3, 0.0, 0.16, -0.28, 0.28, wheel);
  }
}

function dumpster(m: MeshBuilder, pl: Place, b: Bin): void {
  const colours: readonly Rgb[] = [[0.03, 0.1, 0.05], [0.03, 0.06, 0.16], [0.1, 0.09, 0.08], [0.2, 0.05, 0.03]];
  const c = colours[b.colour % 4] as Rgb;
  const w = 0.62;
  const wear = 0.1 + rnd(b.seed, 1) * 0.2;
  const sf = (o: Vec3): Surface => metal(o, c, wear);
  const q = (pts: Vec3[], hint: Vec3): void => m.poly(pts, hint, c, sf(pts[0] as Vec3));
  q([P(pl, 0.95, 0.2, -w), P(pl, 0.95, 0.2, w), P(pl, 0.95, 1.2, w), P(pl, 0.95, 1.2, -w)], D(pl, 1, 0, 0));
  q([P(pl, -0.95, 0.2, w), P(pl, -0.95, 0.2, -w), P(pl, -0.95, 1.2, -w), P(pl, -0.95, 1.2, w)], D(pl, -1, 0, 0));
  q([P(pl, -0.95, 0.2, w), P(pl, 0.95, 0.2, w), P(pl, 0.95, 1.2, w), P(pl, -0.95, 1.2, w)], D(pl, 0, 0, 1));
  q([P(pl, 0.95, 0.2, -w), P(pl, -0.95, 0.2, -w), P(pl, -0.95, 1.2, -w), P(pl, 0.95, 1.2, -w)], D(pl, 0, 0, -1));
  // Lids: two slabs, one propped open on some.
  const open = rnd(b.seed, 2) < 0.35;
  m.poly([P(pl, -0.97, 1.2, -w - 0.02), P(pl, 0.0, 1.2, -w - 0.02), P(pl, 0.0, 1.26, w + 0.02), P(pl, -0.97, 1.26, w + 0.02)].map((p) => p) as Vec3[], [0, 1, 0], mixC(c, [0.02, 0.02, 0.02], 0.2));
  if (open) m.poly([P(pl, 0.0, 1.2, -w - 0.02), P(pl, 0.1, 1.9, -w - 0.02), P(pl, 0.1, 1.9, w + 0.02), P(pl, 0.0, 1.2, w + 0.02)], D(pl, -0.8, 0.4, 0), c);
  else m.poly([P(pl, 0.0, 1.2, -w - 0.02), P(pl, 0.97, 1.2, -w - 0.02), P(pl, 0.97, 1.26, w + 0.02), P(pl, 0.0, 1.26, w + 0.02)], [0, 1, 0], mixC(c, [0.02, 0.02, 0.02], 0.2));
  for (const x of [-0.7, 0.7]) for (const z of [-0.55, 0.55]) lbox(m, pl, x - 0.05, x + 0.05, 0.0, 0.2, z - 0.05, z + 0.05, [0.02, 0.02, 0.02]);
}

function pallets(m: MeshBuilder, pl: Place, b: Bin): void {
  const n = 1 + Math.floor(rnd(b.seed, 1) * 4);
  const s: Surface = { layer: "planks_weathered", frame: { origin: [pl.ox, pl.y0, pl.oz], u: [1, 0, 0], v: [0, 0, 1] }, tint: [0.9, 0.85, 0.75], wear: 0.2, wearKind: "algae" };
  void s;
  for (let k = 0; k < n; k++) {
    const y = k * 0.15;
    const o = (rnd(b.seed, 10 + k) - 0.5) * 0.12;
    lbox(m, pl, -0.6 + o, 0.6 + o, y, y + 0.14, -0.5 + o, 0.5 + o, [0.26, 0.2, 0.13], [0.33, 0.26, 0.17]);
  }
}

function drum(m: MeshBuilder, pl: Place, b: Bin): void {
  const c: Rgb = rnd(b.seed, 1) < 0.5 ? [0.16, 0.06, 0.03] : [0.05, 0.08, 0.15];
  lcylY(m, pl, 0, 0, 0.0, 0.88, 0.29, 0.29, 8, c, mixC(c, [0.2, 0.2, 0.2], 0.4));
  for (const y of [0.25, 0.62]) lcylY(m, pl, 0, 0, y, y + 0.04, 0.3, 0.3, 8, mixC(c, [0, 0, 0], 0.4), null);
}

export function binGeometry(g: TownGround, solid: Sink, b: Bin, detail: Detail): void {
  const m = solid(b.x, b.z);
  const big = b.kind === "dumpster";
  const pl = placeOn(g, b.x, b.z, b.hx, b.hz, big ? 1.9 : b.kind === "pallets" ? 1.2 : 0.7, big ? 1.3 : b.kind === "pallets" ? 1.0 : 0.7);
  if (detail === "low") {
    if (b.kind === "pallets") return;
    lbox(m, pl, big ? -0.95 : -0.3, big ? 0.95 : 0.3, 0, big ? 1.25 : b.kind === "drum" ? 0.88 : b.kind === "cart tipped" ? 0.6 : 1.05, big ? -0.62 : -0.3, big ? 0.62 : 0.3, big ? [0.03, 0.09, 0.05] : (CART[b.colour % CART.length] as Rgb));
    return;
  }
  if (b.kind === "cart") cart(m, pl, b, false);
  else if (b.kind === "cart tipped") cart(m, pl, b, true);
  else if (b.kind === "dumpster") dumpster(m, pl, b);
  else if (b.kind === "pallets") pallets(m, pl, b);
  else drum(m, pl, b);
}

export function mailboxGeometry(g: TownGround, solid: Sink, mb: Mailbox, detail: Detail): void {
  const m = solid(mb.x, mb.z);
  const pl = placeOn(g, mb.x, mb.z, mb.hx, mb.hz, 0.5, 0.3);
  if (mb.kind === "cluster") {
    const c: Rgb = mb.colour === 0 ? [0.18, 0.19, 0.2] : [0.08, 0.13, 0.1];
    lbox(m, pl, -0.2, 0.2, 0.0, 1.25, -0.46, 0.46, c);
    for (let r = 0; r < 4; r++) for (let k = 0; k < 4; k++) {
      const y = 0.4 + r * 0.19;
      const z = -0.36 + k * 0.24;
      m.poly([P(pl, 0.203, y, z - 0.09), P(pl, 0.203, y, z + 0.09), P(pl, 0.203, y + 0.15, z + 0.09), P(pl, 0.203, y + 0.15, z - 0.09)], D(pl, 1, 0, 0), mixC(c, [0, 0, 0], 0.4));
    }
    return;
  }
  const c = MAILBOX[mb.colour % MAILBOX.length] as Rgb;
  const lean = mb.lean;
  const base = P(pl, 0, 0, 0);
  // The post leans: the top stands off sideways by `lean` metres.
  const side = D(pl, 0, 0, 1);
  const top: Vec3 = [base[0] + side[0] * lean, base[1] + 1.05, base[2] + side[2] * lean];
  m.prism([base[0], base[1] - 0.05, base[2]], top, 0.045, 4, [0.2, 0.15, 0.1], [0.2, 0.15, 0.1]);
  const bx = top[0];
  const bz = top[2];
  const by = top[1];
  const fx = D(pl, 1, 0, 0);
  const lz = D(pl, 0, 0, 1);
  const hb: Vec3 = [fx[0], 0, fx[2]];
  const hl: Vec3 = [lz[0], 0, lz[2]];
  const corner = (a: number, y: number, z: number): Vec3 => [bx + hb[0] * a + hl[0] * z, by + y, bz + hb[2] * a + hl[2] * z];
  const L = detail === "low" ? 0.26 : 0.3;
  const W = 0.11;
  const sides: [Vec3[], Vec3][] = [
    [[corner(-L, 0.02, -W), corner(L, 0.02, -W), corner(L, 0.18, -W), corner(-L, 0.18, -W)], [-hl[0], 0, -hl[2]]],
    [[corner(L, 0.02, W), corner(-L, 0.02, W), corner(-L, 0.18, W), corner(L, 0.18, W)], hl],
    [[corner(L, 0.02, -W), corner(L, 0.02, W), corner(L, 0.18, W), corner(L, 0.18, -W)], hb],
    [[corner(-L, 0.02, W), corner(-L, 0.02, -W), corner(-L, 0.18, -W), corner(-L, 0.18, W)], [-hb[0], 0, -hb[2]]],
    [[corner(-L, 0.18, -W), corner(L, 0.18, -W), corner(L, 0.18, W), corner(-L, 0.18, W)], [0, 1, 0]],
  ];
  for (const [pts, h] of sides) m.poly(pts, h, c);
  // The flag, up or down, and the door's seam.
  const up = rnd(mb.seed, 1) < 0.3;
  m.poly([corner(-0.05, 0.1, W + 0.005), corner(0.05, 0.1, W + 0.005), corner(0.05, up ? 0.3 : 0.14, W + 0.005), corner(-0.05, up ? 0.3 : 0.14, W + 0.005)], hl, [0.5, 0.06, 0.04]);
}

function pot(m: MeshBuilder, pl: Place, x: number, z: number, y: number, tilt: number, tiltZ: number, colour: Rgb): void {
  const sides = 5;
  const ring = (yy: number, r: number, ox: number, oz: number): Vec3[] => Array.from({ length: sides }, (_, i) => P(pl, x + ox + Math.cos((i / sides) * Math.PI * 2) * r, yy, z + oz + Math.sin((i / sides) * Math.PI * 2) * r));
  const a = ring(y, 0.46, 0, 0);
  const b = ring(y + 0.32, 0.4, tilt * 0.32, tiltZ * 0.32);
  for (let i = 0; i < sides; i++) {
    const j = (i + 1) % sides;
    const mid = ((i + 0.5) / sides) * Math.PI * 2;
    m.poly([a[i] as Vec3, a[j] as Vec3, b[j] as Vec3, b[i] as Vec3], D(pl, Math.cos(mid), 0, Math.sin(mid)), colour);
  }
  m.poly(b, [0, 1, 0], mixC(colour, [0.35, 0.33, 0.25], 0.35));
}

export function gearGeometry(g: TownGround, solid: Sink, o: Gear, detail: Detail): void {
  const m = solid(o.x, o.z);
  const pl = placeOn(g, o.x, o.z, o.hx, o.hz, 1.4, 1.2);
  const low = detail === "low";
  if (low && o.kind !== "pots" && o.kind !== "totes" && o.kind !== "firewood" && o.kind !== "pallet stack") return;
  switch (o.kind) {
    case "pots": {
      const wire: Rgb = rnd(o.seed, 1) < 0.5 ? [0.2, 0.24, 0.17] : [0.28, 0.17, 0.08];
      const lx = (rnd(o.seed, 2) - 0.5) * 0.14;
      const lz = (rnd(o.seed, 3) - 0.5) * 0.14;
      if (low) {
        const p0 = P(pl, 0, 0, 0);
        m.cylinder(p0[0], p0[2], p0[1], 0.44, o.n * 0.3, 5, wire, mixC(wire, [0.3, 0.28, 0.2], 0.3), 0.4);
        break;
      }
      for (let k = 0; k < o.n; k++) pot(m, pl, 0, 0, k * 0.3, lx * (k / 6), lz * (k / 6), k % 2 === 0 ? wire : mixC(wire, [0.04, 0.04, 0.04], 0.55));
      const buoy = BUOY[o.colour % BUOY.length] as Rgb;
      m.cylinder(P(pl, 0.2, 0, 0.1)[0], P(pl, 0.2, 0, 0.1)[2], P(pl, 0, o.n * 0.3 + 0.32, 0)[1], 0.11, 0.2, 5, buoy, buoy, 0.07);
      if (!low) tube(m, [P(pl, 0, o.n * 0.3 + 0.3, 0), P(pl, 0.35, o.n * 0.3 + 0.1, 0.2), P(pl, 0.5, 0.05, 0.3)], 0.02, [0.3, 0.25, 0.14], 3);
      break;
    }
    case "buoys":
      for (let k = 0; k < o.n; k++) {
        const c = BUOY[(o.colour + k) % BUOY.length] as Rgb;
        const x = (k - o.n / 2) * 0.27;
        const z = (rnd(o.seed, k) - 0.5) * 0.3;
        const p = P(pl, x, 0, z);
        m.cylinder(p[0], p[2], p[1], 0.13, 0.24, 5, c, c, 0.03);
      }
      if (!low) tube(m, [P(pl, -o.n * 0.13, 0.12, 0), P(pl, 0, 0.1, 0.1), P(pl, o.n * 0.13, 0.12, 0)], 0.015, [0.35, 0.3, 0.2], 3);
      break;
    case "totes": {
      const c = mixC([0.03, 0.12, 0.25], [0.3, 0.1, 0.03], rnd(o.seed, 1)) as Rgb;
      for (let k = 0; k < o.n; k++) lbox(m, pl, -0.5, 0.5, k * 0.36, k * 0.36 + 0.34, -0.3 + (k % 2) * 0.1, 0.3 + (k % 2) * 0.1, k === 0 ? c : mixC(c, [0.2, 0.2, 0.2], 0.3), mixC(c, [0.15, 0.15, 0.15], 0.3));
      break;
    }
    case "coil": {
      const rope: Rgb = [0.3, 0.24, 0.13];
      const n = 5;
      for (let k = 0; k < (low ? 1 : 3); k++) {
        const pts: Vec3[] = [];
        for (let i = 0; i <= n; i++) pts.push(P(pl, Math.cos((i / n) * Math.PI * 2) * (0.34 - k * 0.1), 0.05 + k * 0.05, Math.sin((i / n) * Math.PI * 2) * (0.34 - k * 0.1)));
        tube(m, pts, 0.05, rope, 4);
      }
      break;
    }
    case "net": {
      const rows: Vec3[][] = [];
      for (let i = 0; i < 5; i++) {
        const row: Vec3[] = [];
        for (let j = 0; j < 5; j++) {
          const fx = (i - 2) / 2;
          const fz = (j - 2) / 2;
          const h = Math.max(0.05, 0.4 * (1 - fx * fx) * (1 - fz * fz) + 0.05 * (rnd(o.seed, i * 5 + j) - 0.5));
          row.push(P(pl, fx * 0.8, h, fz * 0.65));
        }
        rows.push(row);
      }
      const c: Rgb = rnd(o.seed, 99) < 0.5 ? [0.14, 0.2, 0.12] : [0.3, 0.2, 0.08];
      m.grid(rows, P(pl, 0, -0.3, 0), { colour: c });
      break;
    }
    case "firewood": {
      const L = 1.8;
      lbox(m, pl, -L / 2, L / 2, 0.0, 0.92, -0.2, 0.2, [0.17, 0.1, 0.05]);
      if (!low) for (let r = 0; r < 3; r++) for (let k = 0; k < 4; k++) {
        const z = -0.17 + (r % 2) * 0.05 + 0;
        void z;
        const y = 0.12 + r * 0.3;
        const x = -0.7 + k * 0.45;
        m.poly(Array.from({ length: 5 }, (_, i) => P(pl, x + Math.cos((i / 5) * Math.PI * 2) * 0.16, y + Math.sin((i / 5) * Math.PI * 2) * 0.13, 0.201)), D(pl, 0, 0, 1), mixC([0.38, 0.28, 0.17], [0.25, 0.17, 0.1], rnd(o.seed, r * 8 + k)));
      }
      lbox(m, pl, -L / 2 - 0.05, L / 2 + 0.05, 0.92, 0.97, -0.26, 0.26, [0.05, 0.1, 0.2]);
      break;
    }
    case "propane": {
      const white: Rgb = [0.5, 0.5, 0.46];
      for (const k of [-0.3, 0.3]) {
        const p = P(pl, 0, 0.0, k);
        m.cylinder(p[0], p[2], p[1], 0.17, 0.75, 8, white, white, 0.14);
      }
      break;
    }
    case "pallet stack":
      for (let k = 0; k < o.n; k++) {
        const off = (rnd(o.seed, 10 + k) - 0.5) * 0.1;
        lbox(m, pl, -0.6 + off, 0.6 + off, k * 0.15, k * 0.15 + 0.14, -0.5 + off, 0.5 + off, [0.26, 0.2, 0.13], [0.33, 0.26, 0.17]);
      }
      break;
  }
}
