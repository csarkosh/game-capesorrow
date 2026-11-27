/**
 * Utility poles, their crossarms, insulators, transformers and streetlights, the wires between them and the service drops to the buildings.
 * A pole is a tapered timber of the weathered-boards layer (it leans where the plan says it does, with the stub of its predecessor beside it
 * on some). The wires are thin smooth tubes (three sides), wider than a real wire so that they do not shimmer at a distance, hung in a
 * parabola with a sag of about one and a half per cent of the span (the sag is drawing, where trigonometry is allowed): three conductors on
 * the arm or the pins, a neutral below, a telephone cable below that. A streetlight's head has a lens under it that glows by its own night code
 * (`props/lamps.ts`: dead, sodium or white; dull grey glass by day).
 */
import { withMat } from "../materials.js";
import type { MeshBuilder, Rgb, Vec3 } from "../meshBuilder.js";
import type { Surface } from "../townSurface.js";
import type { Detail, TownGround } from "../townTypes.js";
import type { Drop, Pole } from "../../../sim/town/types.js";
import { P, mixC, post, rnd, tube, lbox, placeOn } from "./kit.js";
import { LAMP_COLOUR, LENS_DROP, LENS_GLOW, lampCode, lampKind } from "./lamps.js";

type Sink = (x: number, z: number) => MeshBuilder;
const WOOD: Rgb = [0.2, 0.16, 0.12];
const INSULATOR: Rgb = [0.34, 0.3, 0.26];
const STEEL: Rgb = [0.1, 0.1, 0.11];
const WIRE: Rgb = [0.035, 0.035, 0.04];
const CABLE: Rgb = [0.09, 0.09, 0.1];

/** The line's direction at a pole, and across it. */
function lineAxes(g: TownGround, p: Pole, next: Pole | null): { tx: number; tz: number; nx: number; nz: number } {
  let tx: number;
  let tz: number;
  if (next !== null) {
    tx = next.x - p.x;
    tz = next.z - p.z;
  } else {
    const s = g.plan.streets[p.street]!;
    tx = s.b.x - s.a.x;
    tz = s.b.z - s.a.z;
  }
  const l = Math.sqrt(tx * tx + tz * tz) || 1;
  tx /= l;
  tz /= l;
  return { tx, tz, nx: -tz, nz: tx };
}

/** Where the wires leave a pole: three conductors, a neutral and a cable, in the world. */
export function attachments(g: TownGround, p: Pole, next: Pole | null): Vec3[] {
  const { nx, nz } = lineAxes(g, p, next);
  const wx = g.anchor.x + p.x;
  const wz = g.anchor.z + p.z;
  const gh = g.heightAt(wx, wz);
  const at = (h: number, lat: number): Vec3 => {
    const t = h / p.height;
    return [wx + p.lx * t * t + nx * lat, gh + h, wz + p.lz * t * t + nz * lat];
  };
  const top = p.height;
  if (p.arm === 1) return [at(top - 0.1, -0.9), at(top + 0.12, 0), at(top - 0.1, 0.9), at(top - 1.7, 0.55), at(top - 2.5, -0.2)];
  return [at(top - 0.4, -0.5), at(top + 0.1, 0), at(top - 0.4, 0.5), at(top - 1.5, 0.4), at(top - 2.4, -0.15)];
}

export function poleGeometry(g: TownGround, solid: Sink, p: Pole, next: Pole | null, detail: Detail): void {
  const m = solid(p.x, p.z);
  const wx = g.anchor.x + p.x;
  const wz = g.anchor.z + p.z;
  const gh = g.heightAt(wx, wz) - 0.1;
  const { tx, tz, nx, nz } = lineAxes(g, p, next);
  const wood = mixC(WOOD, [0.28, 0.25, 0.22], rnd(p.seed, 1) * 0.6);
  const sides = detail === "low" ? 4 : 5;
  const surf = (a: Vec3, tan: Vec3): Surface => ({ layer: "planks_weathered", frame: { origin: a, u: [0, 1, 0], v: tan }, tint: [0.75 + rnd(p.seed, 2) * 0.2, 0.72, 0.68], wear: 0.12 + rnd(p.seed, 3) * 0.3, wearKind: "algae", wear2: 0.2, wearKind2: "grime" });
  withMat("wood", () => post(m, [wx, gh, wz], p.height + 0.1, 0.19, 0.12, p.lx, p.lz, sides, wood, detail === "low" ? undefined : surf));
  const top = p.height;
  const at = (h: number, lat: number): [number, number] => {
    const t = h / p.height;
    return [wx + p.lx * t * t + nx * lat, wz + p.lz * t * t + nz * lat];
  };
  if (p.arm === 1) {
    const [cx, cz] = at(top - 0.35, 0);
    withMat("wood", () => m.box(cx, cz, gh + top - 0.35, nx, nz, 1.2, 0.07, 0.11, [0.17, 0.13, 0.1], [0.19, 0.15, 0.12]));
    if (detail !== "low") {
      for (const sg of [1, -1]) {
        const [bx, bz] = at(top - 0.1, sg * 0.95);
        const [ax, az] = at(top - 0.95, 0);
        withMat("wood", () => m.prism([ax, gh + top - 0.95, az], [bx, gh + top - 0.35, bz], 0.025, 3, [0.15, 0.12, 0.09], null));
      }
      for (const lat of [-0.9, 0, 0.9]) {
        const [ix, iz] = at(top - 0.24, lat);
        withMat("painted", () => m.prism([ix, gh + top - 0.24, iz], [ix, gh + top - 0.02, iz], 0.035, 3, INSULATOR, null));
      }
    }
  } else if (detail !== "low") {
    const [cx, cz] = at(top - 0.52, 0);
    withMat("wood", () => m.box(cx, cz, gh + top - 0.52, nx, nz, 0.55, 0.05, 0.08, [0.15, 0.12, 0.1], [0.17, 0.14, 0.11]));
    for (const lat of [-0.5, 0.5, 0]) {
      const [ix, iz] = at(lat === 0 ? top : top - 0.45, lat);
      withMat("painted", () => m.prism([ix, gh + (lat === 0 ? top : top - 0.45), iz], [ix, gh + (lat === 0 ? top + 0.12 : top - 0.28), iz], 0.032, 3, INSULATOR, null));
    }
  }
  if (p.transformer) {
    const [cx, cz] = at(top - 1.2, 0.3 * (rnd(p.seed, 5) < 0.5 ? 1 : -1));
    withMat("steel", () => m.cylinder(cx, cz, gh + top - 1.55, 0.21, 0.62, detail === "low" ? 5 : 8, [0.22, 0.25, 0.23], [0.2, 0.22, 0.21]));
    if (detail !== "low") withMat("painted", () => m.cylinder(cx, cz, gh + top - 0.93, 0.03, 0.14, 4, INSULATOR, INSULATOR));
  }
  if (p.light !== null) {
    const lt = p.light;
    const [bx, bz] = at(top - 0.7, 0);
    const ex = bx + p.light.ox * 2.6;
    const ez = bz + p.light.oz * 2.6;
    withMat("steel", () => m.prism([bx, gh + top - 0.7, bz], [ex, gh + top - 0.35, ez], 0.045, 4, STEEL, STEEL));
    const hx = ex + p.light.ox * 0.15;
    const hz = ez + p.light.oz * 0.15;
    const yh = gh + top - 0.52;
    withMat("steel", () => m.box(hx, hz, yh, lt.ox, lt.oz, 0.3, 0.14, 0.16, [0.2, 0.21, 0.22], [0.22, 0.23, 0.24]));
    // The lens: a shallow bowl under the head (its sides, which butt the head's underside, and a face). Dull grey glass by day; a lit one glows by its own night code, a dead one never does.
    const kind = lampKind(p.seed);
    const lens = LAMP_COLOUR[kind];
    const lx = hx + lt.ox * 0.02;
    const lz = hz + lt.oz * 0.02;
    const vx = lt.oz;
    const vz = -lt.ox;
    const hu = 0.22;
    const hv = 0.09;
    const yl = yh - LENS_DROP;
    const c = (su: number, sv: number): [number, number, number] => [lx + lt.ox * hu * su + vx * hv * sv, yl, lz + lt.oz * hu * su + vz * hv * sv];
    withMat("painted", () => {
      m.box(lx, lz, yl, lt.ox, lt.oz, hu, hv, LENS_DROP, [0.16, 0.17, 0.18], [0.16, 0.17, 0.18], false, null);
      const face = (): void => m.poly([c(-1, -1), c(1, -1), c(1, 1), c(-1, 1)], [0, -1, 0], lens);
      if (kind === "dead") face();
      else m.withHours(lampCode(p.seed), () => m.withGlow(LENS_GLOW, face));
    });
  }
  if (p.stub && detail !== "low") {
    const sx = wx + tx * 0.9;
    const sz = wz + tz * 0.9;
    withMat("wood", () => post(m, [sx, gh, sz], 1.5 + rnd(p.seed, 7) * 0.8, 0.17, 0.14, 0.05, 0.02, sides, mixC(wood, [0.1, 0.09, 0.08], 0.3), surf));
  }
  void P;
  void lbox;
  void placeOn;
}

export function wireGeometry(g: TownGround, solid: Sink, a: Pole, b: Pole, detail: Detail): void {
  const A = attachments(g, a, b);
  const B = attachments(g, b, a);
  const dx = B[1]![0] - A[1]![0];
  const dz = B[1]![2] - A[1]![2];
  const d = Math.sqrt(dx * dx + dz * dz);
  if (d < 6 || d > 120) return;
  const m = solid(a.x, a.z);
  const segs = Math.max(3, Math.min(detail === "low" ? 3 : 5, Math.round(d / 7)));
  const ks = detail === "low" ? [0, 1, 2] : [0, 1, 2, 3, 4];
  for (const k of ks) {
    const sag = d * 0.016 * (0.8 + 0.4 * rnd(a.seed, 20 + k)) * (k === 4 ? 1.3 : 1);
    const pts: Vec3[] = [];
    for (let i = 0; i <= segs; i++) {
      const t = i / segs;
      const p0 = A[k] as Vec3;
      const p1 = B[k] as Vec3;
      pts.push([p0[0] + (p1[0] - p0[0]) * t, p0[1] + (p1[1] - p0[1]) * t - 4 * sag * t * (1 - t), p0[2] + (p1[2] - p0[2]) * t]);
    }
    tube(m, pts, k === 4 ? 0.05 : 0.034, k === 4 ? CABLE : WIRE, 3, true);
  }
}

export function dropGeometry(g: TownGround, solid: Sink, d: Drop, pole: Pole, detail: Detail): void {
  if (detail === "low") return;
  const A = attachments(g, pole, null);
  const at = A[3] as Vec3;
  const wx = g.anchor.x + d.x;
  const wz = g.anchor.z + d.z;
  const to: Vec3 = [wx, g.heightAt(wx, wz) + d.y, wz];
  const len = Math.sqrt((to[0] - at[0]) * (to[0] - at[0]) + (to[2] - at[2]) * (to[2] - at[2]));
  if (len < 2) return;
  // The wire is hung from the bracket on the pole's side that faces the house: from the other it would cross the pole itself, its sides along the pole's facets.
  const { nx, nz } = lineAxes(g, pole, null);
  const px = g.anchor.x + pole.x;
  const pz = g.anchor.z + pole.z;
  const lat = (at[0] - px) * nx + (at[2] - pz) * nz;
  const side = (to[0] - px) * nx + (to[2] - pz) * nz >= 0 ? 1 : -1;
  const shift = side * Math.abs(lat) - lat;
  const from: Vec3 = [at[0] + nx * shift, at[1], at[2] + nz * shift];
  const segs = 4;
  const sag = len * 0.02;
  const pts: Vec3[] = [];
  for (let i = 0; i <= segs; i++) {
    const t = i / segs;
    pts.push([from[0] + (to[0] - from[0]) * t, from[1] + (to[1] - from[1]) * t - 4 * sag * t * (1 - t), from[2] + (to[2] - from[2]) * t]);
  }
  tube(solid(d.x, d.z), pts, 0.03, WIRE, 3, true);
}
