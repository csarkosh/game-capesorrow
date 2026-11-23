/**
 * Boats as plain arrays: a hull lofted through six stations with a sheer line (not a box), a deck, a wheelhouse with dark
 * windows, and the kind's gear in a few simple shapes. The waterline is the sea's level, so the keel lies `draft` under it.
 *
 * - **Hull**: six stations from stern to bow. Each is a ring of nine points (the deck edge, the waterline, the bilge, the
 *   keel and back up the other side) whose half-breadth, depth and height of the sheer follow the station's own factor; the
 *   transom closes the stern. Below the waterline the hull is antifouling red.
 * - **A kind**: trollers carry a mast and two long trolling poles; gillnetters a net drum on the stern; crabbers crab pots
 *   stacked on the deck and a boom; tugs a tall wheelhouse, a stack and push knees; skiffs an outboard; sailboats a mast, a
 *   boom and a furled sail; pleasure boats a cabin with a windscreen.
 * - **State**: working boats are painted; a derelict lists a few degrees, is faded, and has lost its poles, pots, drum and most
 *   of its mast; a sunk one lies with its deck under the water and only its wheelhouse above it.
 * Boats do not move: there is no bobbing.
 */
import { hash01, greyed, scaled, type MeshBuilder, type Rgb, type Vec3 } from "./meshBuilder.js";
import { GLASS } from "./palette.js";
import type { Boat } from "../../sim/town/types.js";

/** Hull colours, picked by a boat's colour index. */
export const HULL_COLOURS: readonly Rgb[] = [
  [0.82, 0.83, 0.82],
  [0.1, 0.17, 0.32],
  [0.52, 0.1, 0.08],
  [0.1, 0.27, 0.18],
  [0.45, 0.47, 0.5],
  [0.09, 0.09, 0.1],
  [0.78, 0.72, 0.52],
  [0.12, 0.4, 0.43],
];
const ANTIFOUL: Rgb = [0.32, 0.09, 0.07];
const HOUSE: Rgb = [0.86, 0.86, 0.84];
const DECK_GREY: Rgb = [0.36, 0.34, 0.3];
const POLE: Rgb = [0.55, 0.52, 0.45];
const NET: Rgb = [0.6, 0.38, 0.14];
const POT: Rgb = [0.28, 0.3, 0.28];
const BLACK: Rgb = [0.07, 0.07, 0.08];
const SAIL: Rgb = [0.88, 0.87, 0.82];

/** Stern to bow: where each station lies along the length (0 to 1), and its half-breadth, keel depth and sheer, as fractions. */
const T = [0, 0.18, 0.4, 0.62, 0.84, 1];
const HALF = [0.86, 0.98, 1, 0.94, 0.64, 0.04];
const DEPTH = [0.55, 0.85, 1, 0.92, 0.66, 0.3];
const SHEER = [0.86, 0.76, 0.72, 0.82, 1.02, 1.3];

type Frame = { cx: number; cz: number; hx: number; hz: number; ax: number; az: number; cosR: number; sinR: number; dy: number };

/** Hull dimensions the kinds share. */
function freeboard(b: Boat): number {
  return b.kind === "skiff" ? 0.5 : b.kind === "sailboat" ? 0.9 : 0.05 * b.length + 0.4;
}

export function boatGeometry(sink: (x: number, z: number) => MeshBuilder, b: Boat): void {
  const hx = b.heading.x;
  const hz = b.heading.z;
  const list = b.state === "working" ? 0 : ((3 + 4 * hash01(b.id, 31)) * Math.PI) / 180 * (hash01(b.id, 32) < 0.5 ? -1 : 1);
  const f = freeboard(b);
  const sinkBy = b.state === "sunk" ? f * 0.8 + 0.5 : 0;
  const fr: Frame = { cx: b.x, cz: b.z, hx, hz, ax: hz, az: -hx, cosR: Math.cos(list), sinR: Math.sin(list), dy: -sinkBy };
  const m = sink(b.x, b.z);
  // Local (x along the boat, y up from the waterline, z across) to the world, rolled about the boat's long axis.
  const P = (lx: number, ly: number, lz: number): Vec3 => {
    const ry = ly * fr.cosR - lz * fr.sinR;
    const rz = ly * fr.sinR + lz * fr.cosR;
    return [fr.cx + fr.hx * lx + fr.ax * rz, ry + fr.dy, fr.cz + fr.hz * lx + fr.az * rz];
  };
  const D = (lx: number, ly: number, lz: number): Vec3 => {
    const ry = ly * fr.cosR - lz * fr.sinR;
    const rz = ly * fr.sinR + lz * fr.cosR;
    return [fr.hx * lx + fr.ax * rz, ry, fr.hz * lx + fr.az * rz];
  };
  const derelict = b.state !== "working";
  const base = HULL_COLOURS[b.colour % HULL_COLOURS.length] as Rgb;
  const hull: Rgb = derelict ? scaled(greyed(base, 0.7), 0.75) : base;
  const house: Rgb = derelict ? scaled(greyed(HOUSE, 0.5), 0.7) : b.kind === "tug" || b.kind === "troller" ? (b.colour % 2 === 0 ? HOUSE : scaled(base, 1.15)) : HOUSE;
  const antifoul: Rgb = derelict ? scaled(ANTIFOUL, 0.7) : ANTIFOUL;
  const deck: Rgb = derelict ? scaled(DECK_GREY, 0.8) : DECK_GREY;
  const L = b.length;
  const B = b.beam;
  const Dr = b.draft;
  const x = (t: number): number => (t - 0.5) * L;
  const ring = (i: number): Vec3[] => {
    const hb = (B / 2) * (HALF[i] as number);
    const d = Dr * (DEPTH[i] as number);
    const s = f * (SHEER[i] as number);
    const xi = x(T[i] as number);
    const right: [number, number][] = [[s, hb], [0, hb * 0.97], [-d * 0.45, hb * 0.8], [-d * 0.85, hb * 0.4], [-d, 0]];
    const out: Vec3[] = right.map(([y, z]) => P(xi, y, z));
    for (let k = 3; k >= 0; k--) {
      const [y, z] = right[k] as [number, number];
      out.push(P(xi, y, -z));
    }
    return out;
  };
  const rings = T.map((_, i) => ring(i));
  // The hull's skin: quads between stations, each ring's nine points in a loop (the last back to the first is the open deck's width).
  const centreY = -Dr * 0.2;
  for (let i = 0; i < T.length - 1; i++) {
    for (let k = 0; k < 8; k++) {
      const a0 = rings[i]![k] as Vec3;
      const a1 = rings[i]![k + 1] as Vec3;
      const b0 = rings[i + 1]![k] as Vec3;
      const b1 = rings[i + 1]![k + 1] as Vec3;
      const my = (a0[1] + a1[1] + b0[1] + b1[1]) / 4 - fr.dy;
      const mx = (a0[0] + a1[0] + b0[0] + b1[0]) / 4 - fr.cx;
      const mz = (a0[2] + a1[2] + b0[2] + b1[2]) / 4 - fr.cz;
      // Outward from the boat's own axis: sideways and down.
      const along = mx * fr.hx + mz * fr.hz;
      const hint: Vec3 = [mx - fr.hx * along, my - centreY, mz - fr.hz * along];
      // The two upper segments of each side are above the waterline.
      const above = k === 0 || k === 7;
      m.poly([a0, a1, b1, b0], hint, above ? hull : antifoul);
    }
  }
  // The transom closes the stern, and the deck covers the hull between the sheer lines.
  m.poly(rings[0] as Vec3[], D(-1, 0, 0), hull);
  for (let i = 0; i < T.length - 1; i++) {
    const r0 = rings[i] as Vec3[];
    const r1 = rings[i + 1] as Vec3[];
    m.poly([r0[0] as Vec3, r1[0] as Vec3, r1[8] as Vec3, r0[8] as Vec3], D(0, 1, 0), deck);
  }
  const deckY = f * 0.74;
  const house1 = (x0: number, x1: number, y1: number, half: number, colour: Rgb, windows: boolean): void => {
    const c = (lx: number, ly: number, lz: number): Vec3 => P(lx, ly, lz);
    const y0 = deckY;
    const top = deckY + y1;
    const faces: [Vec3[], Vec3][] = [
      [[c(x0, y0, -half), c(x1, y0, -half), c(x1, top, -half), c(x0, top, -half)], D(0, 0, -1)],
      [[c(x0, y0, half), c(x1, y0, half), c(x1, top, half), c(x0, top, half)], D(0, 0, 1)],
      [[c(x1, y0, -half), c(x1, y0, half), c(x1, top, half), c(x1, top, -half)], D(1, 0, 0)],
      [[c(x0, y0, -half), c(x0, y0, half), c(x0, top, half), c(x0, top, -half)], D(-1, 0, 0)],
    ];
    for (const [pts, hint] of faces) m.poly(pts, hint, colour);
    m.poly([c(x0, top, -half), c(x1, top, -half), c(x1, top, half), c(x0, top, half)], D(0, 1, 0), scaled(colour, 0.9));
    if (!windows) return;
    // Dark windows, a band round the upper part: on both sides, the front and the back.
    const wy0 = deckY + y1 * 0.45;
    const wy1 = deckY + y1 * 0.85;
    const eps = 0.02;
    const lenH = x1 - x0;
    for (const sgn of [-1, 1]) {
      const n = Math.max(1, Math.round(lenH / 1.1));
      for (let k = 0; k < n; k++) {
        const a = x0 + (lenH * (k + 0.15)) / n;
        const e = x0 + (lenH * (k + 0.85)) / n;
        m.poly([c(a, wy0, sgn * (half + eps)), c(e, wy0, sgn * (half + eps)), c(e, wy1, sgn * (half + eps)), c(a, wy1, sgn * (half + eps))], D(0, 0, sgn), GLASS);
      }
    }
    m.poly([c(x1 + eps, wy0, -half + 0.12), c(x1 + eps, wy0, half - 0.12), c(x1 + eps, wy1, half - 0.12), c(x1 + eps, wy1, -half + 0.12)], D(1, 0, 0), GLASS);
    m.poly([c(x0 - eps, wy0, -half + 0.12), c(x0 - eps, wy0, half - 0.12), c(x0 - eps, wy1, half - 0.12), c(x0 - eps, wy1, -half + 0.12)], D(-1, 0, 0), GLASS);
  };
  const stick = (p0: Vec3, p1: Vec3, r: number, colour: Rgb, sides = 4): void => m.prism(p0, p1, r, sides, colour, colour);
  const gear = !derelict;
  const sunk = b.state === "sunk";

  switch (b.kind) {
    case "troller": {
      const hxm = x(0.42);
      house1(hxm - L * 0.12, hxm + L * 0.1, 1.9, B * 0.34, house, true);
      const mastX = hxm + L * 0.2;
      const mastTop = gear ? deckY + L * 0.5 : deckY + L * 0.18;
      if (!sunk) stick(P(mastX, deckY, 0), P(mastX, mastTop, 0), 0.07, POLE, 6);
      if (gear) {
        for (const sgn of [-1, 1]) {
          stick(P(mastX, deckY + 1.6, sgn * 0.1), P(mastX - L * 0.2, deckY + L * 0.32, sgn * (B / 2 + L * 0.42)), 0.04, POLE);
        }
        // Stays from the mast's head to the bow and the stern.
        stick(P(mastX, mastTop, 0), P(x(1) - 0.4, deckY + 0.3, 0), 0.012, BLACK, 3);
      }
      break;
    }
    case "gillnetter": {
      const hxm = x(0.4);
      house1(hxm - L * 0.12, hxm + L * 0.1, 1.8, B * 0.34, house, true);
      if (gear) m.prism(P(x(0.08), deckY + 0.7, -B * 0.32), P(x(0.08), deckY + 0.7, B * 0.32), 0.48 + 0.02 * L, 10, NET, scaled(NET, 0.7));
      if (!sunk) stick(P(hxm + L * 0.03, deckY + 1.8, 0), P(hxm + L * 0.03, deckY + 3.6, 0), 0.05, POLE, 6);
      break;
    }
    case "crabber": {
      const hxm = x(0.72);
      house1(hxm - L * 0.1, hxm + L * 0.08, 2.1, B * 0.36, house, true);
      if (gear) {
        // Pots stacked on the working deck, aft of the house, three high.
        const cols = Math.max(2, Math.floor((L * 0.45) / 1.2));
        for (let cx = 0; cx < cols; cx++) {
          for (const sgn of [-1, 1]) {
            const high = 2 + ((cx + (sgn > 0 ? 1 : 0)) % 2);
            const xl = x(0.08) + cx * 1.2;
            const zl = sgn * B * 0.22;
            const pts = (y: number): Vec3[] => [P(xl - 0.5, y, zl - 0.5), P(xl + 0.5, y, zl - 0.5), P(xl + 0.5, y, zl + 0.5), P(xl - 0.5, y, zl + 0.5)];
            const lo = pts(deckY);
            const hi = pts(deckY + high * 0.78);
            for (let q = 0; q < 4; q++) m.poly([lo[q] as Vec3, lo[(q + 1) % 4] as Vec3, hi[(q + 1) % 4] as Vec3, hi[q] as Vec3], D(q === 0 ? 0 : q === 1 ? 1 : q === 2 ? 0 : -1, 0, q === 0 ? -1 : q === 2 ? 1 : 0), POT);
            m.poly(hi, D(0, 1, 0), scaled(POT, 1.2));
          }
        }
        // The boom and its crane post.
        stick(P(hxm - L * 0.1, deckY, B * 0.3), P(hxm - L * 0.1, deckY + 3.2, B * 0.3), 0.09, POLE, 6);
        stick(P(hxm - L * 0.1, deckY + 3.1, B * 0.3), P(hxm - L * 0.3, deckY + 2.4, B * 0.55), 0.05, POLE);
      }
      break;
    }
    case "tug": {
      const hxm = x(0.45);
      house1(hxm - L * 0.15, hxm + L * 0.15, 3, B * 0.4, house, true);
      house1(hxm - L * 0.12, hxm + L * 0.1, 1.2, B * 0.3, house, true);
      m.cylinder(P(hxm - L * 0.2, 0, 0)[0], P(hxm - L * 0.2, 0, 0)[2], P(0, deckY, 0)[1], 0.4, 3.4, 8, b.colour % 2 === 0 ? [0.5, 0.08, 0.06] : BLACK, BLACK);
      // Push knees: a black block at the bow.
      const k0 = x(0.94);
      for (const sgn of [-1, 1]) m.prism(P(k0, deckY - 0.3, sgn * B * 0.25), P(k0, deckY + 1.2, sgn * B * 0.25), 0.28, 6, BLACK, BLACK);
      break;
    }
    case "skiff": {
      // An outboard on the transom and a bench.
      const ox = x(0.02);
      m.prism(P(ox, deckY + 0.55, 0), P(ox, deckY - 0.2, 0), 0.13, 6, BLACK, BLACK);
      m.poly([P(ox - 0.3, deckY + 0.55, -0.22), P(ox + 0.3, deckY + 0.55, -0.22), P(ox + 0.3, deckY + 0.55, 0.22), P(ox - 0.3, deckY + 0.55, 0.22)], D(0, 1, 0), BLACK);
      m.poly([P(x(0.5) - 0.2, deckY + 0.05, -B * 0.4), P(x(0.5) + 0.2, deckY + 0.05, -B * 0.4), P(x(0.5) + 0.2, deckY + 0.05, B * 0.4), P(x(0.5) - 0.2, deckY + 0.05, B * 0.4)], D(0, 1, 0), [0.45, 0.35, 0.22]);
      break;
    }
    case "sailboat": {
      house1(x(0.34), x(0.6), 0.75, B * 0.28, house, false);
      const mastX = x(0.55);
      const h = gear ? L * 1.25 : L * 0.4;
      if (!sunk) stick(P(mastX, deckY, 0), P(mastX, deckY + h, 0), 0.06, POLE, 6);
      if (gear) {
        const boomY = deckY + 1.3;
        stick(P(mastX, boomY, 0), P(x(0.04), boomY + 0.1, 0), 0.05, POLE);
        // The furled sail, a long white roll on the boom.
        m.prism(P(mastX - 0.2, boomY + 0.18, 0), P(x(0.1), boomY + 0.2, 0), 0.16, 6, SAIL, SAIL);
        stick(P(mastX, deckY + h, 0), P(x(1) - 0.3, deckY + 0.4, 0), 0.012, BLACK, 3);
        stick(P(mastX, deckY + h, 0), P(x(0.02), deckY + 0.5, 0), 0.012, BLACK, 3);
      }
      break;
    }
    case "pleasure": {
      house1(x(0.3), x(0.66), 1.3, B * 0.34, house, true);
      // A windscreen's slope on the front of the cabin and a small arch for the radar.
      if (gear) stick(P(x(0.36), deckY + 1.3, 0), P(x(0.36), deckY + 2.1, 0), 0.04, POLE, 6);
      break;
    }
  }
}
