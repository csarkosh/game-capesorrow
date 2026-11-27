/**
 * The light of a designed room, baked into the colours of its vertices: what a room that a person stands in is lit by is its own lights, the day through the panes of its front,
 * and a little that bounces. Each light (`Design.lights`) lights what is near it by the inverse square of its distance in its own reach, more on a face turned to it
 * than away (a face turned away still has a third), so a room is pools of light with dimmer floor between them and dark in its corners, at the foot of its walls and up at
 * the ceiling's edge, and under what stands on the floor (a table, a counter). There are no shadows. The lights are brought to an exposure by the brightest place on the
 * floor (`Mood.exposure`), not the mean, so a bar of a few bulbs is a dim room with bright pools and not a room evenly half lit.
 *
 * The object it makes is a `RoomField` as well (the room kit's `shade`, `fbox` and the front wall's builder read one), with `lit` for a face whose way is known.
 */
import type { Design } from "../../sim/inside/design.js";
import { FRONT_WALL } from "../../sim/inside/design.js";
import type { Rgb } from "./meshBuilder.js";
import type { RoomField } from "./roomLight.js";

/** The colour of an overcast day. */
const SKY: Rgb = [0.62, 0.68, 0.76];
const CORNER_DARK = 0.45;
const CORNER_REACH = 0.9;
const EDGE_DARK = 0.3;
const EDGE_REACH = 0.45;

/** A pane the day comes through: along the front wall, and how much of the day it lets through (0 to 1). */
export type DayPane = { readonly s0: number; readonly s1: number; readonly through: number };

export type BakedLight = RoomField & {
  /** The light on a face at (s, d, y) whose unit normal is (ns, nd, ny), in the room's frame. The array is the light's own, reused: read it before the next call. */
  lit(s: number, d: number, y: number, ns: number, nd: number, ny: number): Rgb;
  /** The gain the lights were brought to. */
  readonly gain: number;
};

export function bakeLight(design: Design, panes: readonly DayPane[]): BakedLight {
  const { lights, mood } = design;
  const W = design.width;
  const D = design.depth;
  const H = design.height;
  // What stands on the floor and throws a dark under it: the big blocks that are about a table's height or more.
  const feet = design.blocks.filter((b) => b.y1 >= 0.6 && b.y0 < 0.3 && b.ha * b.hb >= 0.1).map((b) => ({ ...b }));
  const sum = (s: number, d: number, y: number, ns: number, nd: number, ny: number, out: [number, number, number]): void => {
    out[0] = 0;
    out[1] = 0;
    out[2] = 0;
    for (let i = 0; i < lights.length; i++) {
      const l = lights[i] as (typeof lights)[number];
      const dx = l.s - s;
      const dd = l.d - d;
      const dy = l.y - y;
      const q2 = dx * dx + dd * dd + dy * dy;
      const k = 1 + q2 / (l.reach * l.reach);
      if (k > 60) continue;
      const len = Math.sqrt(q2) + 1e-4;
      const c = (ns * dx + nd * dd + ny * dy) / len;
      const wrap = 0.33 + 0.67 * (0.5 + 0.5 * c);
      const a = (l.power * wrap) / (k * k);
      out[0] += l.tone[0] * a;
      out[1] += l.tone[1] * a;
      out[2] += l.tone[2] * a;
    }
  };
  // The exposure: the brightest place on the floor, lit by every light, is brought to it.
  const tmp: [number, number, number] = [0, 0, 0];
  let peak = 0;
  for (let b = 0; b <= D * 2; b++) for (let a = 0; a <= W * 2; a++) {
    sum(a * 0.5, b * 0.5, 0.05, 0, 0, 1, tmp);
    peak = Math.max(peak, (tmp[0] + tmp[1] + tmp[2]) / 3);
  }
  const gain = peak > 1e-4 ? mood.exposure / peak : 1;
  const out: [number, number, number] = [0, 0, 0];
  const scratch: [number, number, number] = [0, 0, 0];
  const dayAt = (s: number, d: number): number => {
    let day = 0;
    for (const o of panes) {
      if (o.through <= 0) continue;
      const away = s < o.s0 ? o.s0 - s : s > o.s1 ? s - o.s1 : 0;
      const lateral = Math.max(0, 1 - away / (1.5 + d * 0.25));
      day += o.through * lateral / (1 + (d * d) / (2.6 * 2.6));
    }
    return Math.min(1.1, day);
  };
  const occlusion = (s: number, d: number, y: number, ny: number): number => {
    const eS = Math.min(s, W - s);
    const eD = Math.min(d - FRONT_WALL, D - d);
    const e = Math.max(0, Math.min(eS, eD));
    const c = Math.sqrt(Math.max(0, eS) * Math.max(0, eS) + Math.max(0, eD) * Math.max(0, eD));
    let k = 1 - CORNER_DARK * Math.exp(-c / CORNER_REACH);
    if (ny > 0.5 || ny < -0.5) k *= 1 - EDGE_DARK * Math.exp(-e / EDGE_REACH);
    else k *= (1 - EDGE_DARK * Math.exp(-Math.max(0, y) / EDGE_REACH)) * (1 - EDGE_DARK * Math.exp(-Math.max(0, H - y) / EDGE_REACH));
    return k;
  };
  const under = (s: number, d: number): number => {
    let k = 1;
    for (const f of feet) {
      const dx = s - f.s;
      const dz = d - f.d;
      const u = Math.abs(dx * f.ax + dz * f.ad);
      const v = Math.abs(-dx * f.ad + dz * f.ax);
      const dist = Math.sqrt(Math.max(0, u - f.ha) ** 2 + Math.max(0, v - f.hb) ** 2);
      const near = 1 - dist / 0.4;
      if (near > 0) k *= 1 - 0.55 * Math.min(1, near);
    }
    return Math.max(0.3, k);
  };
  const lit = (s: number, d: number, y: number, ns: number, nd: number, ny: number): Rgb => {
    sum(s, d, y, ns, nd, ny, out);
    const day = dayAt(s, d) * mood.day;
    let k = occlusion(s, d, y, ny);
    // Under a table or beside a counter the floor and the foot of what stands there are dark.
    if (y < 0.45) k *= under(s, d);
    scratch[0] = (out[0] * gain + mood.ambient[0] * mood.ambientK + SKY[0] * day) * k;
    scratch[1] = (out[1] * gain + mood.ambient[1] * mood.ambientK + SKY[1] * day) * k;
    scratch[2] = (out[2] * gain + mood.ambient[2] * mood.ambientK + SKY[2] * day) * k;
    return scratch;
  };
  let mean = 0;
  let n = 0;
  for (let b = 0; b <= D * 2; b += 2) for (let a = 0; a <= W * 2; a += 2) {
    const c = lit(a * 0.5, b * 0.5, 0.05, 0, 0, 1);
    mean += (c[0] + c[1] + c[2]) / 3;
    n++;
  }
  mean = n > 0 ? mean / n : 0;
  return {
    gain,
    mean,
    dead: [],
    veil: [mean, mean, mean],
    lit,
    at: (s, d, y, up) => lit(s, d, y, 0, 0, up),
    under: (s, d) => under(s, d),
  };
}
