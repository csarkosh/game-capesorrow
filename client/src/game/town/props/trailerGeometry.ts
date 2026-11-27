/**
 * Boat trailers, and the boats on them. A trailer is a steel frame (two rails, an A-frame tongue to a hitch, a winch post, an axle with two wheels
 * and fenders, bunks under the hull, rear lamps); a boat is lofted through six stations from the transom to the bow: an aluminium skiff
 * (the town's sheet metal layer, riveted lines, a bench or two, an outboard on the transom) or a small fibreglass runabout (painted metal, a console
 * and a windscreen). Some are under a tarp, drawn over the hull in a plain tarp colour with sag between its lashings. Weeds are grown through a trailer that
 * has stood: tufts of dry grass round the wheels and under the hull, more where the yard is not kept.
 */
import { withMat } from "../materials.js";
import type { MeshBuilder, Rgb, Vec3 } from "../meshBuilder.js";
import type { Detail, TownGround } from "../townTypes.js";
import type { BoatTrailer } from "../../../sim/town/types.js";
import { D, P, lbox, mix, mixC, placeOn, rnd, tube, type Place } from "./kit.js";
import { CHROME, GLASS_CAR, PAINT, PLATE, TAIL, TARP_BLUE, TARP_SILVER, TYRE, paintTint } from "./vehicleStyle.js";
import { trailerShade } from "./vehicleShade.js";
import type { VehicleSinks } from "./vehicleGeometry.js";

const FRAME: Rgb = [0.05, 0.05, 0.055];
const GALV: Rgb = [0.22, 0.23, 0.24];

/** Stations from the transom (0) to the bow (1): half beam, gunwale height and keel depth factors. */
const T = [0, 0.16, 0.4, 0.65, 0.85, 1];
const HB = [0.92, 1, 1, 0.84, 0.5, 0.02];
const GH = [1, 0.98, 0.95, 1.02, 1.1, 1.22];
const KD = [0.55, 0.9, 1, 0.9, 0.7, 0.45];

function hull(m: MeshBuilder, gl: MeshBuilder, pl: Place, t: BoatTrailer, y0: number, detail: Detail): void {
  const Lb = t.length - 1.5;
  const B = t.boat === "skiff" ? 1.75 : 2.1;
  const H = t.boat === "skiff" ? 0.6 : 0.85;
  const depth = t.boat === "skiff" ? 0.38 : 0.5;
  const x0 = -t.length / 2 + 0.1;
  const alu = t.boat === "skiff";
  const paint = mixC(PAINT[t.colour % PAINT.length] as Rgb, [0.5, 0.5, 0.5], 0.3);
  const white: Rgb = mixC([0.5, 0.5, 0.48], paint, 0.12);
  const rows: Vec3[][] = [];
  const insides: Vec3[] = [];
  for (let i = 0; i < T.length; i++) {
    const x = x0 + (T[i] as number) * Lb;
    const hb = (B / 2) * (HB[i] as number);
    const gh = H * (GH[i] as number);
    const kd = depth * (KD[i] as number);
    // Gunwale (right), chine, keel, chine, gunwale (left): the V of a skiff, the rounder bilge of a runabout.
    const ch = alu ? hb * 0.78 : hb * 0.9;
    rows.push([P(pl, x, y0 + gh, -hb), P(pl, x, y0 + (alu ? 0.12 : 0.2), -ch), P(pl, x, y0 - kd * (alu ? 0.5 : 0.75), -ch * 0.55), P(pl, x, y0 - kd, 0), P(pl, x, y0 - kd * (alu ? 0.5 : 0.75), ch * 0.55), P(pl, x, y0 + (alu ? 0.12 : 0.2), ch), P(pl, x, y0 + gh, hb)]);
    insides.push(P(pl, x, y0 + 0.2, 0));
  }
  const tint: Rgb = alu ? [3.2, 3.2, 3.3] : paintTint(white);
  const colour: Rgb = alu ? [0.36, 0.37, 0.38] : white;
  const inner: Rgb = alu ? [0.14, 0.15, 0.16] : [0.3, 0.3, 0.28];
  // Each side its own sheet, so that every quad of it faces away from the centre line; its back is the hull's inside, dark.
  for (const half of [0, 1]) {
    withMat(alu ? "sheet" : "painted", () => m.grid(rows.map((r) => (half === 0 ? r.slice(0, 4) : r.slice(3))), insides, {
      colour,
      back: inner,
      layer: alu ? "roof_metal" : "roof_bitumen",
      tint,
      uv: (i, j) => [(T[i] as number) * Lb, j * 0.5],
      wear: () => [alu ? 0.08 : t.weeds * 0.3, alu ? "grime" : "algae"],
      wear2: (_, j) => [j === 0 || j === 3 ? 0.1 + t.weeds * 0.2 : 0.02, "grime"],
    }));
  }
  // The transom, and inside: a floor and the bench, dark.
  const hullMat = alu ? "sheet" : "painted";
  withMat(hullMat, () => m.poly(rows[0] as Vec3[], D(pl, -1, 0, 0), colour, undefined, { back: { colour: inner } }));
  const fl = (x: number, c: number): Vec3 => P(pl, x, y0 + 0.17, c);
  withMat(hullMat, () => m.poly([fl(x0 + 0.1, -B * 0.4), fl(x0 + Lb * 0.78, -B * 0.28), fl(x0 + Lb * 0.78, B * 0.28), fl(x0 + 0.1, B * 0.4)], [0, 1, 0], inner));
  if (detail === "low") return;
  // A bench, a console and an outboard.
  withMat(hullMat, () => {
    lbox(m, pl, x0 + Lb * 0.45, x0 + Lb * 0.5, y0 + 0.17, y0 + 0.42, -B * 0.4, B * 0.4, alu ? GALV : white);
    lbox(m, pl, x0 + Lb * 0.62, x0 + Lb * 0.7, y0 + 0.17, y0 + 0.55, -B * 0.34, B * 0.34, alu ? GALV : white);
  });
  const motor: Rgb = [0.05, 0.05, 0.06];
  withMat("painted", () => {
    lbox(m, pl, x0 - 0.22, x0 - 0.03, y0 + H * 0.5, y0 + H * 0.5 + 0.3, -0.12, 0.12, mixC(motor, paint, 0.3));
    lbox(m, pl, x0 - 0.2, x0 - 0.12, y0 - 0.25, y0 + H * 0.5, -0.04, 0.04, motor);
    lbox(m, pl, x0 - 0.3, x0 - 0.1, y0 - 0.32, y0 - 0.22, -0.1, 0.1, motor);
  });
  if (!alu) {
    withMat("painted", () => lbox(m, pl, x0 + Lb * 0.52, x0 + Lb * 0.6, y0 + 0.17, y0 + 0.75, 0.05, B * 0.3, white));
    const xs = x0 + Lb * 0.56;
    gl.poly([P(pl, xs, y0 + 0.75, -B * 0.4), P(pl, xs, y0 + 0.75, B * 0.4), P(pl, xs + 0.3, y0 + 1.1, B * 0.38), P(pl, xs + 0.3, y0 + 1.1, -B * 0.38)], D(pl, 1, 0.6, 0), GLASS_CAR, undefined, { clear: 0.55 });
  }
}

function tarp(m: MeshBuilder, pl: Place, t: BoatTrailer, y0: number, detail: Detail): void {
  const Lb = t.length - 1.5;
  const B = t.boat === "skiff" ? 1.75 : 2.1;
  const H = t.boat === "skiff" ? 0.6 : 0.85;
  const x0 = -t.length / 2 + 0.1;
  const colour: Rgb = rnd(t.seed, 3) < 0.7 ? TARP_BLUE : TARP_SILVER;
  const rows: Vec3[][] = [];
  const ins: Vec3[] = [];
  const N = 7;
  for (let i = 0; i <= N; i++) {
    const u = i / N;
    const x = x0 - 0.05 + u * (Lb + 0.15);
    const w = (B / 2) * (0.5 + 0.55 * Math.sin(Math.min(1, u * 1.1 + 0.05) * Math.PI * 0.95 + 0.1)) + 0.1;
    const crest = H + 0.15 + 0.32 * Math.sin(u * Math.PI) + 0.04 * Math.sin(u * 17 + t.seed);
    rows.push([P(pl, x, y0 + 0.25, -w * 1.05), P(pl, x, y0 + H * 0.8, -w * 1.08), P(pl, x, y0 + crest - 0.06, -w * 0.5), P(pl, x, y0 + crest, 0), P(pl, x, y0 + crest - 0.06, w * 0.5), P(pl, x, y0 + H * 0.8, w * 1.08), P(pl, x, y0 + 0.25, w * 1.05)]);
    ins.push(P(pl, x, y0 + 0.2, 0));
  }
  withMat("cloth", () => {
    m.grid(rows, ins, { colour, back: true });
    m.poly(rows[0] as Vec3[], D(pl, -1, 0, 0), mixC(colour, [0, 0, 0], 0.3), undefined, { back: true });
    m.poly(rows[N] as Vec3[], D(pl, 1, 0, 0), mixC(colour, [0, 0, 0], 0.3), undefined, { back: true });
  });
  // The lashings: rope round the hull in three places.
  for (const u of detail === "low" ? [] : [0.25, 0.5, 0.75]) {
    const x = x0 + u * Lb;
    const r = rows[Math.round(u * N)] as Vec3[];
    withMat("rope", () => tube(m, [r[1] as Vec3, P(pl, x, y0 - 0.1, -0.6), P(pl, x, y0 - 0.2, 0), P(pl, x, y0 - 0.1, 0.6), r[5] as Vec3], 0.015, [0.25, 0.22, 0.15], 3));
  }
}

function weeds(m: MeshBuilder, pl: Place, t: BoatTrailer, detail: Detail): void {
  const n = Math.round((detail === "low" ? 3 : 4) + t.weeds * (detail === "low" ? 5 : 14));
  if (t.weeds < 0.08) return;
  const dry: Rgb = [0.2, 0.2, 0.08];
  const green: Rgb = [0.08, 0.16, 0.05];
  for (let k = 0; k < n; k++) {
    const x = (rnd(t.seed, 10 + k) - 0.5) * (t.length - 1.5) + (rnd(t.seed, 40 + k) < 0.5 ? 0 : -0.3);
    const z = (rnd(t.seed, 70 + k) < 0.5 ? -1 : 1) * (0.35 + rnd(t.seed, 90 + k) * 0.7);
    const h = 0.35 + rnd(t.seed, 120 + k) * 0.65 * (0.4 + t.weeds);
    const c = mixC(dry, green, rnd(t.seed, 150 + k));
    for (let b = 0; b < 3; b++) {
      const a = (b / 3) * Math.PI + rnd(t.seed, 180 + k) * 2;
      const dx = Math.cos(a) * 0.07;
      const dz = Math.sin(a) * 0.07;
      const bend = 0.12 + 0.1 * rnd(t.seed, 200 + k + b);
      withMat("plant", () => {
        m.poly([P(pl, x - dx, -0.02, z - dz), P(pl, x + dx, -0.02, z + dz), P(pl, x + bend * Math.cos(a + 1.5), h, z + bend * Math.sin(a + 1.5))], D(pl, -Math.sin(a), 0.2, Math.cos(a)), c);
        m.poly([P(pl, x + dx, -0.02, z + dz), P(pl, x - dx, -0.02, z - dz), P(pl, x + bend * Math.cos(a + 1.5), h, z + bend * Math.sin(a + 1.5))], D(pl, Math.sin(a), 0.2, -Math.cos(a)), c);
      });
    }
  }
}

export function trailerGeometry(g: TownGround, sinks: VehicleSinks, t: BoatTrailer, detail: Detail): void {
  const m = sinks.solid(t.x, t.z);
  const gl = sinks.glass(t.x, t.z);
  if (sinks.shade !== undefined && detail !== "low") trailerShade(g, sinks.shade(t.x, t.z), t);
  const pl = placeOn(g, t.x, t.z, t.hx, t.hz, t.length, t.width);
  const L = t.length;
  const rear = -L / 2;
  const front = L / 2;
  const railTop = 0.62;
  withMat("steel", () => {
    // The rails and cross members, the tongue and the hitch.
    for (const z of [-0.55, 0.55]) lbox(m, pl, rear, front - 1.35, railTop - 0.12, railTop, z - 0.04, z + 0.04, GALV);
    for (const x of [rear + 0.2, rear + 1.5, front - 1.5]) lbox(m, pl, x - 0.03, x + 0.03, railTop - 0.1, railTop - 0.04, -0.55, 0.55, GALV);
    m.prism(P(pl, front - 1.35, railTop - 0.06, -0.55), P(pl, front, railTop - 0.15, 0), 0.035, 4, GALV);
    m.prism(P(pl, front - 1.35, railTop - 0.06, 0.55), P(pl, front, railTop - 0.15, 0), 0.035, 4, GALV);
    lbox(m, pl, front - 0.12, front + 0.05, railTop - 0.28, railTop - 0.12, -0.05, 0.05, FRAME);
    lbox(m, pl, front - 1.55, front - 1.45, railTop, railTop + 0.5, -0.04, 0.04, FRAME);
    // A jack wheel under the tongue.
    m.prism(P(pl, front - 0.3, railTop - 0.2, 0), P(pl, front - 0.3, 0.14, 0), 0.025, 4, FRAME);
    // The axle, wheels and fenders.
    const ax = rear + L * 0.36;
    const r = 0.28;
    for (const sg of [1, -1]) {
      const n = detail === "low" ? 8 : 10;
      const ring = (rad: number, z: number): Vec3[] => Array.from({ length: n + 1 }, (_, i) => P(pl, ax + Math.cos((i / n) * Math.PI * 2) * rad, r + Math.sin((i / n) * Math.PI * 2) * rad, z));
      m.grid([ring(r, sg * 0.84), ring(r, sg * 1.0)], P(pl, ax, r, sg * 0.92), { colour: TYRE, mat: "rubber" });
      // The face, and the hub 3 cm proud of it.
      m.poly(ring(r, sg * 1.0).slice(0, n), D(pl, 0, 0, sg), TYRE, "rubber");
      m.poly(ring(r * 0.6, sg * 1.03).slice(0, n), D(pl, 0, 0, sg), [0.3, 0.3, 0.32], "steel");
      lbox(m, pl, ax - 0.4, ax + 0.4, r + 0.32, r + 0.35, sg * 0.8, sg * 1.05, GALV);
    }
    lbox(m, pl, ax - 0.05, ax + 0.05, r - 0.04, r + 0.04, -0.9, 0.9, FRAME);
    lbox(m, pl, rear - 0.03, rear + 0.04, railTop - 0.2, railTop - 0.1, -0.5, 0.5, [0.06, 0.06, 0.06]);
    for (const sg of [1, -1]) withMat("painted", () => lbox(m, pl, rear - 0.05, rear + 0.02, railTop - 0.2, railTop - 0.13, sg * 0.37, sg * 0.47, TAIL, TAIL, false));
  });
  // Bunks, carpeted, and the boat.
  if (t.boat !== "none") {
    withMat("cloth", () => {
      for (const z of [-0.45, 0.45]) lbox(m, pl, rear + 0.5, front - 1.7, railTop, railTop + 0.08, z - 0.06, z + 0.06, [0.08, 0.1, 0.09]);
    });
    hull(m, gl, pl, t, railTop + 0.52, detail);
    if (t.tarp) tarp(m, pl, t, railTop + 0.52, detail);
  }
  weeds(m, pl, t, detail);
  void CHROME;
  void PLATE;
  void mix;
}
