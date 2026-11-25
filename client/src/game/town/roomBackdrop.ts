/**
 * The back of a room, painted: what the street sees past the front of a shop is not the room but a picture of it, out of focus.
 *
 * A room is seen only through its glass, and only its front needs to be there. `BACKDROP_AT` metres behind the glass (`roomLight.ts`) the room as it is
 * drawn ends at a flat sheet, and on the sheet is the rest of the room as a person standing at the window would see it with the glass
 * steamed: the floor running back, the side walls closing in, the ceiling, the back wall, each furnishing that stands further in as a
 * soft block of its own colour (a shelf run's is its stock's colours, speckled), and each lamp that is on as a glow. The picture is a
 * coarse lattice of colours (`CELL` apart) that the renderer blends between, which is what makes it out of focus: nothing in it has an
 * edge. It is laid most of the way into the room's veil (`roomLight.ts`), and wholly into it at its own edges, so that the floor, the
 * walls and the ceiling in front of it, which have run to the veil by the time they reach it, meet it without a line.
 *
 * It is there so that a room need be furnished and drawn only at its front, and still be lit and full to its back wall: nothing behind
 * the sheet is drawn at all (`roomGeometry.ts`), which is most of what a room was. A vacant unit has no sheet: its bareness is the point.
 */
import { hash01, scaled, type Rgb } from "./meshBuilder.js";
import { goodsOf } from "./roomDressing.js";
import { xd, xp, type Ctx } from "./roomKit.js";
import { VEIL_FULL } from "./roomLight.js";

/** What the sheet is made of: the painted layer laid 125 times its true size, so that its grain is a soft mottle and nothing on the sheet has an edge. */
const SHEET = { mat: "painted", scale: 0.008 } as const;
import type { Furnishing, FurnishingKind, RoomLight } from "../../sim/town/types.js";

/** The lattice's spacing, metres: the picture's focus. */
const CELL = 0.3;
/** The eye the picture is drawn for: its height over the floor and how far in front of the sheet it stands, metres. */
const EYE = 1.55;
const STAND = 4.5;
/** How much of the picture is the veil at its middle (the rest is the room painted), and over what distance from its edges it becomes all veil. */
const SHEET_VEIL = 0.12;
const EDGE = 0.45;
/** The albedo that the veil's light makes the veil of: the picture's surfaces are lit by the veil over this. */
const VEIL_ALBEDO = 0.55;

const WOOD: Rgb = [0.34, 0.23, 0.14];
const STEEL: Rgb = [0.72, 0.73, 0.75];
const SHELF: Rgb = [0.5, 0.48, 0.44];
const GREEN: Rgb = [0.2, 0.42, 0.18];
const TUBE: Rgb = [1.0, 0.95, 0.84];
const WARM: Rgb = [1.0, 0.8, 0.52];

/** The kinds that carry stock: their block is speckled with the trade's goods. */
const STOCKED: ReadonlySet<FurnishingKind> = new Set<FurnishingKind>(["shelf run", "rack", "endcap", "cooler", "bin", "stand", "display case", "stacked crates", "stack"]);

const smooth = (t: number): number => {
  const u = Math.min(1, Math.max(0, t));
  return u * u * (3 - 2 * u);
};
/** 1 inside `a`..`b`, falling to 0 over `soft` outside it. */
const within = (x: number, a: number, b: number, soft: number): number => smooth((x - a) / soft + 1) * smooth((b - x) / soft + 1);
const mix = (a: Rgb, b: Rgb, t: number): Rgb => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

/** A furnishing's own colour in the picture. */
function blockColour(c: Ctx, f: Furnishing): Rgb {
  switch (f.kind) {
    case "table": case "booth": case "bench": case "desk": case "pool table": case "hightable": case "windowbar": case "stool row": case "leaner": return WOOD;
    case "counter": case "checkout": return c.base;
    case "washer row": case "machine": case "lift": case "water cooler": case "cart": return STEEL;
    case "partition": return scaled(c.paint, 0.8);
    case "plant": return GREEN;
    case "couch": return [0.32, 0.2, 0.2];
    case "cabinet": return [0.45, 0.46, 0.44];
    default: return SHELF;
  }
}

type Block = { readonly s0: number; readonly s1: number; readonly y0: number; readonly y1: number; readonly colour: Rgb; readonly stocked: boolean; readonly depth: number; readonly seed: number };

/**
 * Lays the sheet into `c.out`: across the room at `cut` behind the glass, floor to ceiling, facing the street. `floor`, `wall` and
 * `ceiling` are the room's paints; `dead` says which of the plan's lights have failed.
 */
export function backdrop(c: Ctx, cut: number, furnishings: readonly Furnishing[], lights: readonly RoomLight[], dead: readonly boolean[], floor: Rgb, wall: Rgb, ceiling: Rgb): void {
  const { out, xf } = c;
  const w = c.s1 - c.s0;
  const top = c.ceiling;
  const nu = Math.max(2, Math.round(w / CELL) + 1);
  const nv = Math.max(2, Math.round(top / CELL) + 1);
  const us: number[] = [];
  const vs: number[] = [];
  for (let i = 0; i < nu; i++) us.push(i / (nu - 1));
  for (let j = 0; j < nv; j++) vs.push(j / (nv - 1));
  const veilC = c.field.veil;
  // The light the picture's surfaces are lit by: the veil's, over the albedo that makes the veil of it.
  const light: Rgb = [veilC[0] / VEIL_ALBEDO, veilC[1] / VEIL_ALBEDO, veilC[2] / VEIL_ALBEDO];
  const lit = (a: Rgb, k: number): Rgb => [a[0] * light[0] * k, a[1] * light[1] * k, a[2] * light[2] * k];
  // One-point perspective from an eye opposite the room's middle: a point `d` behind the glass is drawn toward the eye's own place on the sheet.
  const sc = (c.s0 + c.s1) / 2;
  const shrink = (d: number): number => STAND / (STAND + Math.max(0, d - cut));
  const ps = (s: number, d: number): number => sc + (s - sc) * shrink(d);
  const py = (y: number, d: number): number => EYE + (y - EYE) * shrink(d);
  const back = c.d1;
  const sL = ps(c.s0, back);
  const sR = ps(c.s1, back);
  const yFloor = py(0, back);
  const yCeil = py(top, back);
  // The furnishings behind the sheet, the furthest first, each as the face it shows the street.
  const blocks: Block[] = [];
  for (let k = 0; k < furnishings.length; k++) {
    const f = furnishings[k] as Furnishing;
    const ex = (Math.abs(f.dir.x) * f.sx + Math.abs(f.dir.z) * f.sd) / 2;
    const ez = (Math.abs(f.dir.z) * f.sx + Math.abs(f.dir.x) * f.sd) / 2;
    if (f.d + ez <= cut + 0.1 || f.h < 0.3) continue;
    const d = Math.max(cut, f.d - ez);
    blocks.push({ s0: ps(f.s - ex, d), s1: ps(f.s + ex, d), y0: py(0, d), y1: py(f.kind === "partition" ? Math.min(f.h, top) : f.h, d), colour: blockColour(c, f), stocked: STOCKED.has(f.kind), depth: d, seed: c.seed + k * 37 });
  }
  blocks.sort((a, b) => b.depth - a.depth);
  const glows: { s: number; y: number; r: number; colour: Rgb; p: number }[] = [];
  for (let k = 0; k < lights.length; k++) {
    const l = lights[k] as RoomLight;
    if (!l.on || dead[k] === true || l.d <= cut || l.kind === "neon") continue;
    const k2 = shrink(l.d);
    glows.push({ s: ps(l.s, l.d), y: py(l.h, l.d), r: 0.2 + 0.5 * k2, colour: l.kind === "tube" ? TUBE : WARM, p: (c.lit ? 0.55 : 0.2) * (0.5 + 0.5 * k2) });
  }
  const wallLit = lit(wall, 0.8);
  const sideLit = lit(wall, 0.62);
  const floorLit = lit(floor, 1);
  const ceilLit = lit(ceiling, 0.55);
  const origin = xp(xf, c.s0, cut, c.floorY);
  out.litGrid(origin, xd(xf, w, 0), [0, top, 0], us, vs, xd(xf, 0, -1), (i, j) => {
    const s = c.s0 + (us[i] as number) * w;
    const y = (vs[j] as number) * top;
    // The room's box: the back wall in the middle, the side walls, the floor and the ceiling round it, each running into the next.
    let col = wallLit;
    const side = Math.max(smooth((sL - s) / 0.3 + 0.5), smooth((s - sR) / 0.3 + 0.5));
    col = mix(col, sideLit, side);
    col = mix(col, floorLit, smooth((yFloor - y) / 0.3 + 0.5));
    col = mix(col, ceilLit, smooth((y - yCeil) / 0.3 + 0.5));
    for (const b of blocks) {
      const k = within(s, b.s0, b.s1, 0.22) * within(y, b.y0, b.y1, 0.18);
      if (k <= 0.001) continue;
      // Stock is many colours: each place on a stocked block has one of the trade's, half into the shelf's own.
      const own = b.stocked ? mix(b.colour, goodsOf(c.trade, b.seed + i * 7 + j * 13), 0.6) : scaled(b.colour, 0.85 + 0.3 * hash01(b.seed + i * 3 + j, 955));
      col = mix(col, lit(own, 0.85), k * 0.9);
    }
    for (const g of glows) {
      const q = ((s - g.s) * (s - g.s) + (y - g.y) * (y - g.y)) / (g.r * g.r);
      const k = g.p / (1 + q * q);
      col = [col[0] + g.colour[0] * k, col[1] + g.colour[1] * k, col[2] + g.colour[2] * k];
    }
    // Into the veil: half of it everywhere, all of it at the sheet's edges, where the room in front has run to the veil too.
    const edge = Math.min(s - c.s0, c.s1 - s, y, top - y);
    const v = VEIL_FULL - (VEIL_FULL - SHEET_VEIL) * smooth(edge / EDGE);
    return mix(col, veilC, v);
  }, SHEET, { glow: 1 });
}
