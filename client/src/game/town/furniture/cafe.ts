/**
 * What the cafe is made of: the marble-topped counter with its slatted timber front, the back counter with open shelves and the orange espresso machine, the brass rack hung
 * over the counter, the woven bistro stool, the slatted booth with navy cushions, the round-backed chair, the round flush light in the white ceiling, the joints of the marble floor, and what
 * hangs on its walls (the brass lamps, the navy panels, the bright picture, the air-conditioning unit and the blue and white diamond tiles). Real sizes: the counter's top at 1.0 m, a stool's
 * seat at 0.76, a booth's table at 0.74 and its seat at 0.48.
 */
import type { Decor, Item } from "../../../sim/inside/design.js";
import { hash01, type Rgb } from "../meshBuilder.js";
import { tintOf, type Geo } from "./kit.js";

/** Timber the colour of the cafe's: the oak, warmed toward orange. */
const TIMBER: Rgb = [1.25, 0.9, 0.62];
/** Navy for a cushion or a panel, as a multiple of `cloth`'s and `plaster`'s albedo. */
const NAVY_CLOTH: Rgb = [0.1, 0.4, 1.9];

/** The counter: a plinth, a body behind slats of timber laid across it with a gap between each, and a marble top that overhangs them by 5 cm, with a low brass kick rail. */
export function cafeCounter(g: Geo, it: Item): void {
  const L = g.at(it.s, it.d, it.face);
  const len = it.p[0] ?? 2;
  const h = len / 2;
  L.box(-0.28, 0.26, -h, h, 0.08, 0.965, "dark_wood", { tint: [0.4, 0.4, 0.4] });
  L.box(-0.28, 0.27, -h, h, 0, 0.08, "dark_wood", { tint: [0.5, 0.5, 0.5] }, true, false);
  // The slats across the front: 6.5 cm boards with 1.5 cm between them, each its own tone.
  const rows = Math.floor((0.965 - 0.08) / 0.08);
  for (let k = 0; k < rows; k++) {
    const y0 = 0.08 + k * 0.08 + 0.008;
    const t = 0.85 + 0.3 * hash01(k * 11 + it.id + g.seed, 16);
    L.poly([[0.275, -h, y0], [0.275, h, y0], [0.275, h, y0 + 0.065], [0.275, -h, y0 + 0.065]], [1, 0, 0], "oak", { tint: [TIMBER[0] * t, TIMBER[1] * t, TIMBER[2] * t] });
  }
  // The top: marble, 3.5 cm thick, 5 cm proud of the slats.
  L.box(-0.325, 0.325, -h - 0.02, h + 0.02, 0.965, 1.0, "marble_tile", { tint: [1.12, 1.12, 1.1] });
  L.tubeR(0.31, 0.16, -h + 0.05, h - 0.05, 0.018, 6, "brass");
}

/** The orange espresso machine, standing on the back counter at 0.93 m: a body, a dome, two group heads in steel and a drip tray. It faces the room. */
export function espresso(g: Geo, it: Item): void {
  const L = g.at(it.s, it.d, it.face);
  const orange = { tint: [1.7, 0.55, 0.15] as Rgb };
  L.box(-0.2, 0.2, -0.3, 0.3, 0.93, 1.2, "painted", orange);
  L.frustum(0.0, 0, 1.2, 1.28, 0.22, 0.14, 8, "painted", orange, false);
  for (const r of [-0.12, 0.12]) L.box(0.2, 0.28, r - 0.03, r + 0.03, 1.02, 1.09, "steel", undefined, true, false);
  L.box(0.2, 0.3, -0.26, 0.26, 0.93, 0.96, "steel", { tint: [0.7, 0.7, 0.7] });
}

/** The cafe's back counter at the wall: a lower counter in timber with a marble top at 0.93 m, three open timber shelves over it with bottles and tumblers, and a strip of light under each. */
export function cafeBack(g: Geo, it: Item): void {
  const L = g.at(it.s, it.d, it.face);
  const len = it.p[0] ?? 2;
  const h = len / 2;
  const look = { tint: TIMBER };
  L.box(-0.25, 0.25, -h, h, 0.08, 0.9, "oak", { tint: [0.9, 0.62, 0.42] });
  L.box(-0.25, 0.25, -h, h, 0, 0.08, "dark_wood", { tint: [0.5, 0.5, 0.5] }, true, false);
  L.box(-0.25, 0.27, -h - 0.01, h + 0.01, 0.9, 0.93, "marble_tile", { tint: [1.12, 1.12, 1.1] });
  const shelves = [1.25, 1.58, 1.9];
  const ups = Math.max(2, Math.round(len / 1.4) + 1);
  for (let i = 0; i < ups; i++) {
    const r = -h + 0.02 + (i * (len - 0.04)) / (ups - 1);
    L.box(-0.25, -0.03, r - 0.02, r + 0.02, 0.93, 2.06, "oak", look);
  }
  L.box(-0.25, -0.03, -h, h, 2.06, 2.1, "oak", look);
  const BOT: readonly Rgb[] = [[0.55, 0.3, 0.08], [0.1, 0.32, 0.12], [0.75, 0.8, 0.75], [0.07, 0.05, 0.04], [0.55, 0.1, 0.08], [0.5, 0.4, 0.12]];
  const per = Math.max(1, Math.min(18, Math.floor((len - 0.2) / 0.17)));
  shelves.forEach((y, row) => {
    L.box(-0.25, -0.03, -h + 0.04, h - 0.04, y, y + 0.03, "oak", look);
    L.poly([[-0.05, -h + 0.1, y + 0.3], [-0.05, h - 0.1, y + 0.3], [-0.05, h - 0.1, y + 0.325], [-0.05, -h + 0.1, y + 0.325]], [1, 0, 0], "paper", { glow: 1.4, tint: [1, 0.85, 0.55] });
    for (let k = 0; k < per; k++) {
      const id = it.id * 911 + row * 97 + k;
      if (hash01(id + g.seed, 32) < 0.2) continue;
      const col = BOT[Math.floor(hash01(id + g.seed, 33) * BOT.length)] as Rgb;
      const tall = 0.18 + hash01(id, 34) * 0.12;
      const r = -h + 0.12 + k * ((len - 0.24) / Math.max(1, per - 1));
      const tint = [col[0] * 2.2, col[1] * 2.2, col[2] * 2.2] as const;
      if (hash01(id, 35) < 0.3) L.frustum(-0.12, r, y + 0.03, y + 0.11, 0.032, 0.036, 5, "glass", { tint: [1.5, 1.6, 1.6] }, false, false);
      else {
        L.frustum(-0.12, r, y + 0.03, y + 0.03 + tall * 0.6, 0.032, 0.032, 4, "glass", { tint }, false, false);
        L.frustum(-0.12, r, y + 0.03 + tall * 0.6, y + 0.03 + tall, 0.014, 0.011, 4, "glass", { tint }, false, true);
      }
    }
  });
}

/** The brass rack hung over the counter on four rods: a frame 0.5 m deep with a rail round it and a row of wine bottles standing on it, all in brass and glass. `p0` its length. */
export function brassRack(g: Geo, it: Item): void {
  const L = g.at(it.s, it.d, it.face);
  const len = it.p[0] ?? 3;
  const h = len / 2;
  const y = it.p[1] ?? 2.15;
  L.box(-0.25, -0.235, -h, h, y, y + 0.025, "brass", undefined, true, false);
  L.box(0.235, 0.25, -h, h, y, y + 0.025, "brass", undefined, true, false);
  L.box(-0.25, 0.25, -h, -h + 0.015, y, y + 0.025, "brass", undefined, true, false);
  L.box(-0.25, 0.25, h - 0.015, h, y, y + 0.025, "brass", undefined, true, false);
  // A dark glass shelf in the frame, and a rail standing 14 cm over it along the front.
  L.poly([[-0.23, -h + 0.02, y + 0.012], [-0.23, h - 0.02, y + 0.012], [0.23, h - 0.02, y + 0.012], [0.23, -h + 0.02, y + 0.012]], [0, 0, 1], "glass", { tint: [0.35, 0.4, 0.4] });
  L.tubeR(0.24, y + 0.15, -h, h, 0.008, 4, "brass");
  // The four rods to the ceiling.
  for (const r of [-h + 0.15, h - 0.15]) for (const f of [-0.22, 0.22]) L.box(f - 0.008, f + 0.008, r - 0.008, r + 0.008, y + 0.025, g.ceiling, "brass", undefined, true, false);
  // The bottles: dark glass, a row on the rack, 20 cm apart.
  const n = Math.min(22, Math.floor((len - 0.3) / 0.2));
  for (let k = 0; k < n; k++) {
    const id = it.id * 53 + k;
    const r = -h + 0.25 + k * ((len - 0.5) / Math.max(1, n - 1));
    const tall = 0.3 + hash01(id + g.seed, 36) * 0.04;
    const col: Rgb = hash01(id + g.seed, 37) < 0.7 ? [0.1, 0.07, 0.1] : [0.15, 0.3, 0.14];
    const tint = [col[0] * 2.2, col[1] * 2.2, col[2] * 2.2] as const;
    L.frustum(0.0, r, y + 0.025, y + 0.025 + tall * 0.62, 0.037, 0.037, 4, "glass", { tint }, false, false);
    L.frustum(0.0, r, y + 0.025 + tall * 0.62, y + 0.025 + tall, 0.016, 0.012, 4, "glass", { tint }, false, true);
  }
}

/** The woven bistro stool: a woven seat of 8 sides at 0.76 m, four timber legs with a ring of stretchers, a curved back of three facets with a woven panel in a blue frame. */
export function bistroStool(g: Geo, it: Item): void {
  const L = g.at(it.s, it.d, it.face);
  const t = tintOf(it.id + g.seed, 17, 0.08);
  const frame = { tint: [TIMBER[0] * t[0], TIMBER[1] * t[1], TIMBER[2] * t[2]] as Rgb };
  L.frustum(0, 0, 0.72, 0.76, 0.2, 0.2, 8, "cane", { tint: [1.5, 1.5, 1.5] });
  for (const [a, b] of [[0.14, 0.14], [0.14, -0.14], [-0.14, 0.14], [-0.14, -0.14]] as const) L.box(a - 0.014, a + 0.014, b - 0.014, b + 0.014, 0, 0.72, "oak", frame, true, false);
  // The foot ring: four stretchers 25 cm up, as thin strips.
  for (const s of [-0.14, 0.14]) {
    L.poly([[-0.14, s, 0.25], [0.14, s, 0.25], [0.14, s, 0.28], [-0.14, s, 0.28]], [0, s, 0], "oak", frame);
    L.poly([[s, -0.14, 0.25], [s, 0.14, 0.25], [s, 0.14, 0.28], [s, -0.14, 0.28]], [s, 0, 0], "oak", frame);
  }
  // The back, behind the seat: uprights at its two sides and three facets between, leaning back a little, with a blue top rail.
  const facets: [number, number, number, number][] = [[-0.17, -0.2, -0.22, -0.07], [-0.22, -0.07, -0.22, 0.07], [-0.22, 0.07, -0.17, 0.2]];
  for (const [f0, r0, f1, r1] of facets) {
    L.poly([[f0, r0, 0.8], [f1, r1, 0.8], [f1, r1, 1.12], [f0, r0, 1.12]], [1, 0, 0], "cane", { tint: [1.5, 1.5, 1.5] });
    L.poly([[f0, r0, 1.12], [f1, r1, 1.12], [f1, r1, 1.15], [f0, r0, 1.15]], [0, 0, 1], "cloth", { tint: [0.1, 0.3, 1.6] });
  }
  for (const r of [-0.2, 0.2]) L.box(-0.2, -0.16, r - 0.014, r + 0.014, 0.72, 1.15, "oak", frame, true, false);
}

/** A booth: two slatted benches facing across a marble table on one black pedestal, a high back of horizontal slats to each bench, navy cushions on seat and back. It faces the room; the wall is behind it. */
export function booth(g: Geo, it: Item): void {
  const L = g.at(it.s, it.d, it.face);
  const t = tintOf(it.id + g.seed, 18, 0.06);
  const wood = { tint: [TIMBER[0] * t[0], TIMBER[1] * t[1], TIMBER[2] * t[2]] as Rgb };
  const navy = { tint: NAVY_CLOTH };
  // The table: a marble top at 0.74 m on a black pedestal and a round foot.
  L.box(-0.5, 0.5, -0.37, 0.37, 0.7, 0.74, "marble_tile", { tint: [1.12, 1.12, 1.1] });
  L.frustum(0, 0, 0.03, 0.7, 0.04, 0.04, 6, "steel", { tint: [0.12, 0.12, 0.12] }, false, false);
  L.frustum(0, 0, 0, 0.03, 0.2, 0.18, 8, "steel", { tint: [0.12, 0.12, 0.12] });
  for (const sg of [-1, 1]) {
    const r = (a: number): number => sg * a;
    const lo = Math.min(r(0.42), r(0.92));
    const hi = Math.max(r(0.42), r(0.92));
    // The bench's body: its table-side face in slats, its ends solid.
    for (let k = 0; k < 5; k++) {
      const y0 = 0.02 + k * 0.08;
      L.poly([[-0.575, r(0.42), y0], [0.575, r(0.42), y0], [0.575, r(0.42), y0 + 0.065], [-0.575, r(0.42), y0 + 0.065]], [0, -sg, 0], "oak", wood);
    }
    L.box(-0.575, -0.555, lo, hi, 0, 0.4, "oak", wood, true, false);
    L.box(0.555, 0.575, lo, hi, 0, 0.4, "oak", wood, true, false);
    L.box(-0.555, 0.555, r(0.8), r(0.92), 0, 0.4, "dark_wood", { tint: [0.4, 0.4, 0.4] }, true, false);
    // The navy seat cushion with a pale piping line along its edge.
    L.box(-0.55, 0.55, Math.min(r(0.44), r(0.92)), Math.max(r(0.44), r(0.92)), 0.4, 0.48, "cloth", navy);
    // The high back: two posts, six slats between them with gaps, and a navy cushion against the lower slats.
    for (const f of [-0.555, 0.555]) L.box(f - 0.025, f + 0.025, r(0.93) - 0.03, r(0.93) + 0.03, 0.4, 1.15, "oak", wood, true, false);
    for (let k = 0; k < 6; k++) {
      const y0 = 0.56 + k * 0.1;
      L.poly([[-0.53, r(0.93), y0], [0.53, r(0.93), y0], [0.53, r(0.93), y0 + 0.075], [-0.53, r(0.93), y0 + 0.075]], [0, -sg, 0], "oak", wood);
    }
    L.box(-0.5, 0.5, Math.min(r(0.86), r(0.9)), Math.max(r(0.86), r(0.9)), 0.52, 0.95, "cloth", navy);
  }
}

/** An upholstered chair with a round back: a round seat at 0.46 m on four black legs, a back of three facets running round behind the sitter to 0.85 m, in tan leather. */
export function roundChair(g: Geo, it: Item): void {
  const L = g.at(it.s, it.d, it.face);
  const t = tintOf(it.id + g.seed, 19, 0.1);
  const look = { tint: [1.5 * t[0], 1.3 * t[1], 1.2 * t[2]] as Rgb };
  L.frustum(0, 0, 0.4, 0.46, 0.22, 0.22, 8, "leather", look);
  for (const [a, b] of [[0.13, 0.13], [0.13, -0.13], [-0.13, 0.13], [-0.13, -0.13]] as const) L.box(a - 0.012, a + 0.012, b - 0.012, b + 0.012, 0, 0.4, "steel", { tint: [0.12, 0.12, 0.12] }, true, false);
  const facets: [number, number, number, number][] = [[-0.0, -0.24, -0.19, -0.17], [-0.19, -0.17, -0.24, 0.0], [-0.24, 0.0, -0.19, 0.17], [-0.19, 0.17, 0.0, 0.24]];
  for (const [f0, r0, f1, r1] of facets) L.poly([[f0, r0, 0.46], [f1, r1, 0.46], [f1, r1, 0.85], [f0, r0, 0.85]], [-1, 0, 0], "leather", look);
}

/** A round flush light in the ceiling: a brass ring 5 cm deep and a bright disc in it. The item's place is its centre on the ceiling. */
export function flushLight(g: Geo, it: Item): void {
  const L = g.at(it.s, it.d, it.face);
  const y = g.ceiling;
  L.frustum(0, 0, y - 0.05, y, 0.17, 0.17, 10, "brass", undefined, false, false);
  const ring = Array.from({ length: 10 }, (_, i): [number, number, number] => [Math.cos((i / 10) * Math.PI * 2) * 0.15, Math.sin((i / 10) * Math.PI * 2) * 0.15, y - 0.056]);
  L.poly(ring, [0, 0, -1], "paper", { glow: 3, tint: [1, 0.92, 0.78] });
}

/** The joints of a tiled floor: thin dark strips across the room every 30 cm (`p0` width, `p1` the first `d`, `p2` the last), a hand's breadth over the floor's grain; the tiles are 60 by 30 cm laid in a brick bond, of which the long joints are drawn. */
export function floorJoints(g: Geo, it: Item): void {
  const L = g.at(0, 0, { s: 1, d: 0 });
  const w = it.p[0] ?? 4;
  const d0 = it.p[1] ?? 0.15;
  const d1 = it.p[2] ?? 4;
  const pitch = it.p[3] ?? 0.3;
  for (let d = d0 + pitch; d < d1 - 0.05; d += pitch) L.poly([[0, d, 0.002], [w, d, 0.002], [w, d + 0.007, 0.002], [0, d + 0.007, 0.002]], [0, 0, 1], "brass", { tint: [0.45, 0.4, 0.3], k: 0.8 });
}

/** A brass wall lamp with a glowing cream shade: a plate, an arm and a shade of 6 sides. `y` is the shade's centre. */
export function wallLamp(g: Geo, dc: Decor): void {
  const L = g.at(dc.s, dc.d, dc.face);
  L.box(0, 0.015, -0.03, 0.03, dc.y - 0.1, dc.y + 0.1, "brass", undefined, true, false);
  L.box(0.015, 0.1, -0.008, 0.008, dc.y - 0.05, dc.y - 0.034, "brass", undefined, true, false);
  // The shade stands on the arm: a glowing frustum, wider at its foot.
  L.frustum(0.11, 0, dc.y - 0.04, dc.y + 0.1, 0.055, 0.04, 6, "paper", { glow: 1.6, tint: [1, 0.88, 0.62] }, false, true);
}

/** A panel of navy panelling: a raised rectangle with its corners cut, in a slightly lighter navy, with a darker rim. */
export function panel(g: Geo, dc: Decor): void {
  const L = g.at(dc.s, dc.d, dc.face);
  const w = dc.w / 2;
  const h = dc.h / 2;
  const oct = (hw: number, hh: number, c: number, f: number): [number, number, number][] => [
    [f, -hw + c, dc.y - hh], [f, hw - c, dc.y - hh], [f, hw, dc.y - hh + c], [f, hw, dc.y + hh - c], [f, hw - c, dc.y + hh], [f, -hw + c, dc.y + hh], [f, -hw, dc.y + hh - c], [f, -hw, dc.y - hh + c],
  ];
  L.poly(oct(w, h, 0.12, 0.012), [1, 0, 0], "painted", { tint: [0.04, 0.07, 0.17] });
  L.poly(oct(w - 0.04, h - 0.04, 0.1, 0.025), [1, 0, 0], "painted", { tint: [0.07, 0.11, 0.26] });
}

/** An air-conditioning unit high on a wall: a pale box with louvres and a dark grille. */
export function acUnit(g: Geo, dc: Decor): void {
  const L = g.at(dc.s, dc.d, dc.face);
  const w = dc.w / 2;
  const h = dc.h / 2;
  L.box(0, 0.2, -w, w, dc.y - h, dc.y + h, "painted", { tint: [1.4, 1.4, 1.35] });
  for (let k = 0; k < 3; k++) L.poly([[0.205, -w + 0.05, dc.y - h + 0.04 + k * 0.03], [0.205, w - 0.05, dc.y - h + 0.04 + k * 0.03], [0.205, w - 0.05, dc.y - h + 0.055 + k * 0.03], [0.205, -w + 0.05, dc.y - h + 0.055 + k * 0.03]], [1, 0, 0], "painted", { tint: [0.5, 0.5, 0.5] });
  L.poly([[0.205, -w + 0.05, dc.y + 0.02], [0.205, w - 0.05, dc.y + 0.02], [0.205, w - 0.05, dc.y + h - 0.03], [0.205, -w + 0.05, dc.y + h - 0.03]], [1, 0, 0], "painted", { tint: [0.9, 0.9, 0.88] });
}

/** A large bright picture: a thin frame round a sky in pink, a band of green below it, a sun and a pale figure. */
export function picture(g: Geo, dc: Decor): void {
  const L = g.at(dc.s, dc.d, dc.face);
  const w = dc.w / 2;
  const h = dc.h / 2;
  const y0 = dc.y - h;
  const y1 = dc.y + h;
  L.box(0, 0.03, -w, -w + 0.04, y0, y1, "brass", undefined, true, false);
  L.box(0, 0.03, w - 0.04, w, y0, y1, "brass", undefined, true, false);
  L.box(0, 0.03, -w, w, y0, y0 + 0.04, "brass", undefined, true, false);
  L.box(0, 0.03, -w, w, y1 - 0.04, y1, "brass", undefined, true, false);
  const horizon = y0 + dc.h * 0.38;
  L.poly([[0.02, -w + 0.04, horizon], [0.02, w - 0.04, horizon], [0.02, w - 0.04, y1 - 0.04], [0.02, -w + 0.04, y1 - 0.04]], [1, 0, 0], "painted", { glow: 0.9, tint: [0.95, 0.55, 0.6] });
  L.poly([[0.02, -w + 0.04, y0 + 0.04], [0.02, w - 0.04, y0 + 0.04], [0.02, w - 0.04, horizon], [0.02, -w + 0.04, horizon]], [1, 0, 0], "painted", { glow: 0.9, tint: [0.3, 0.6, 0.35] });
  const sun = Array.from({ length: 8 }, (_, i): [number, number, number] => [0.03, w * 0.35 + Math.cos((i / 8) * Math.PI * 2) * 0.16, y1 - dc.h * 0.25 + Math.sin((i / 8) * Math.PI * 2) * 0.16]);
  L.poly(sun, [1, 0, 0], "painted", { glow: 0.9, tint: [1, 0.9, 0.7] });
  L.poly([[0.03, -w * 0.3 - 0.06, horizon - 0.02], [0.03, -w * 0.3 + 0.06, horizon - 0.02], [0.03, -w * 0.3 + 0.04, horizon + dc.h * 0.3], [0.03, -w * 0.3 - 0.04, horizon + dc.h * 0.3]], [1, 0, 0], "painted", { glow: 0.9, tint: [0.97, 0.88, 0.85] });
}

/** Blue and white glazed tile laid on the diagonal: the wall behind is white, and the blue diamonds of 20 cm tiles stand 1 cm out from it, in three blues. `w` along the wall, `h` high. */
export function tileWall(g: Geo, dc: Decor): void {
  const L = g.at(dc.s, dc.d, dc.face);
  const e = 0.2 / Math.SQRT2;
  const step = 2 * e;
  const nr = Math.floor(dc.w / step);
  const nu = Math.floor(dc.h / step);
  const blues: Rgb[] = [[0.18, 0.4, 0.85], [0.3, 0.55, 0.9], [0.12, 0.28, 0.65]];
  for (let j = 0; j < nu; j++) {
    for (let i = 0; i < nr; i++) {
      const r = -dc.w / 2 + e + i * step;
      const y = dc.y - dc.h / 2 + e + j * step;
      const b = blues[Math.floor(hash01(i * 31 + j * 7 + g.seed, 38) * blues.length)] as Rgb;
      L.poly([[0.012, r, y - e], [0.012, r + e, y], [0.012, r, y + e], [0.012, r - e, y]], [1, 0, 0], "glazed_tile", { tint: b });
    }
  }
}
