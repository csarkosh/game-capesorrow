/**
 * The light the town's lamps throw (street lamps, the harbour's lights, a home's porch light), as the town's material adds it: the nearest
 * few lamps to the eye, in a fixed list the material reads (`townMaterial.ts`, `townLampCode`). Pure: no engine, no DOM.
 *
 * A lamp is where its lens is, its colour, its range (metres, where its light has gone), its strength (how bright, 1 for a street lamp)
 * and its night code (`hours.ts`: when it is on). Each frame `fillLamps` takes the `MAX_LAMPS` lit lamps nearest the eye, and writes for
 * each its position and range, its colour and its strength times how lit its code is at the hour.
 *
 * A lamp never pops in or out of the list. A lamp that is not in the nearest `MAX_LAMPS` is one the eye has not come near; as the eye moves a
 * lamp changes places with the one beyond it only when they are the same distance off, so each lamp's strength also falls to nothing as its
 * distance from the eye nears the cut-off, and the cut-off is the lesser of `LAMP_REACH` and the distance of the first lit lamp that did not
 * make the list: the one that comes in is at the cut-off, at strength 0, and the one that goes out leaves the same way.
 */
import { nightShare } from "./hours.js";

/** The most lamps a frame lights the town by. */
export const MAX_LAMPS = 24;
/** The farthest lamp from the eye that is used, metres. */
export const LAMP_REACH = 130;
/** A lamp's strength starts to fall at this share of the cut-off, and is nothing at it. */
const FADE_FROM = 0.6;

export type Lamp = {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly r: number;
  readonly g: number;
  readonly b: number;
  /** Where the light has gone, metres from the lens. */
  readonly range: number;
  /** How bright it is: 1 is a street lamp. */
  readonly strength: number;
  /** The lamp's night code (`nightCode`): when it is on. */
  readonly code: number;
};

/** What the material is written from: `pos` is x, y, z and range of each lamp, `col` its colour and its strength now; the first `count` are used. */
export type LampList = { readonly pos: Float32Array; readonly col: Float32Array; count: number };

export function emptyLampList(): LampList {
  return { pos: new Float32Array(MAX_LAMPS * 4), col: new Float32Array(MAX_LAMPS * 4), count: 0 };
}

const smooth = (a: number, b: number, x: number): number => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/**
 * Fills `out` with the lit lamps nearest the eye at (`ex`, `ey`, `ez`) at `hour`, as the header says. In the day no lamp is lit and the
 * count is 0, which the material takes as a reason to skip its loop. `max` (at most `MAX_LAMPS`) is the list's length, which the low tier cuts.
 */
export function fillLamps(lamps: readonly Lamp[], ex: number, ey: number, ez: number, hour: number, out: LampList, max = MAX_LAMPS): void {
  // Only the lit lamps within reach are kept and sorted (tens of them at most), so a day frame allocates nothing.
  const view: { i: number; d: number; share: number }[] = [];
  const reach2 = LAMP_REACH * LAMP_REACH;
  for (let i = 0; i < lamps.length; i++) {
    const l = lamps[i] as Lamp;
    const dx = l.x - ex;
    const dz = l.z - ez;
    const d2 = dx * dx + dz * dz + (l.y - ey) * (l.y - ey);
    if (d2 >= reach2) continue;
    const share = nightShare(l.code, hour);
    if (share > 0) view.push({ i, d: Math.sqrt(d2), share });
  }
  view.sort((a, b) => a.d - b.d);
  const cut = Math.min(LAMP_REACH, view.length > max ? (view[max] as { d: number }).d : LAMP_REACH);
  let count = 0;
  for (let k = 0; k < Math.min(view.length, max); k++) {
    const e = view[k] as { i: number; d: number; share: number };
    if (e.d >= cut) break;
    const l = lamps[e.i] as Lamp;
    out.pos[count * 4] = l.x;
    out.pos[count * 4 + 1] = l.y;
    out.pos[count * 4 + 2] = l.z;
    out.pos[count * 4 + 3] = l.range;
    out.col[count * 4] = l.r;
    out.col[count * 4 + 1] = l.g;
    out.col[count * 4 + 2] = l.b;
    out.col[count * 4 + 3] = l.strength * e.share * (1 - smooth(cut * FADE_FROM, cut, e.d));
    count++;
  }
  out.count = count;
}
