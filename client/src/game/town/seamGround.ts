/**
 * The ground at a house's walls, by the household's own record (`houseSeam.ts`): the drip line under the eaves, the bed or the bare earth along the
 * walls, the worn pad at the steps, the worn path from the door to the street where there is no walk, and a puddle where water stands.
 *
 * - **The drip line**: a band 0.3 to 0.9 m wide along each wall where rain falls off the roof and nothing is mown: wear full at the foundation, none at
 *   its outer edge (the method of `groundStains.ts`: the ground's own material cuts the edge ragged), darker and wetter than the lawn. By the house: bare
 *   wet soil (the commonest), moss on the shaded and let-go ones, gravel or old bark on the kept ones, a planted bed (a few shrubs of different sizes, one
 *   dead, a border of stones that has shifted) on some, a concrete walk on a few, and none but weeds on the neglected. Wider at a wall that faces down the
 *   slope, where the water runs off, and narrower on the uphill side.
 * - A kept house keeps its front bed; a neglected one has soil and weeds at every wall.
 *
 * Laid as marks of `RANK.mark` over the ground (`surface.ts` cuts one off another of its rank, and the walk and drive are base surfaces: none is laid over
 * a walk, a drive, the steps or a porch).
 */
import { bearingU, bearingV } from "../../sim/town/bearings.js";
import { lotIdAt } from "../../sim/town/lotIndex.js";
import { inYardRect, yardShape, type YardRect } from "../../sim/town/yardShapes.js";
import type { Rgb } from "./meshBuilder.js";
import { hash01, scaled } from "./meshBuilder.js";
import { neglectOf, seamHouses, type HouseSeam } from "./houseSeam.js";
import { RANK, type Over } from "./groundSurfaces.js";
import { GRAVEL } from "./palette.js";
import { Surface, type P2 } from "./surface.js";
import type { Detail, Sink, TownGround } from "./townTypes.js";
import { wat } from "./buildingKit.js";
import { spoutOf } from "./houseSeam.js";

/** A mark lies this much over the ground (as the yard's own patches do). */
const LIFT = 0.04;
/** The lawn's patches lie as the yard's own do (`yardGeometry.ts`). */
const YARD = 0.04;
/** The foundation stands this far out of the wall's face, and the band starts just past it. */
const FOUND = 0.11;
const clamp01 = (x: number): number => Math.max(0, Math.min(1, x));

export type Bed = "soil" | "moss" | "gravel" | "bark" | "weeds" | "walk" | "planted";

/** Which kind of ground a house keeps at its walls (a roll of its own, moved by its upkeep and its yard). */
export function bedOf(g: TownGround, h: HouseSeam): Bed {
  const b = h.b;
  const neg = neglectOf(g.plan, b);
  const r = hash01(b.id, 900);
  const y = g.plan.yards[b.lot];
  if (neg < 0.3) return r < 0.4 ? "planted" : r < 0.65 ? "bark" : r < 0.85 ? "gravel" : "soil";
  if (neg < 0.65) return r < 0.14 ? "planted" : r < 0.28 ? "gravel" : r < 0.4 ? "walk" : r < 0.55 ? "weeds" : y?.kind === "mossy" ? "moss" : "soil";
  return r < 0.4 ? "soil" : r < 0.65 ? "moss" : "weeds";
}

const LOOK: Readonly<Record<Bed, { colour: Rgb; over: Over }>> = {
  soil: { colour: [0.07, 0.055, 0.04], over: { layer: "mud", tint: [0.26, 0.26, 0.27], wearKind: "growth", dirt: 0.1 } },
  moss: { colour: [0.06, 0.09, 0.04], over: { layer: "mud", tint: [0.6, 0.72, 0.45], wearKind: "growth" } },
  gravel: { colour: [0.3, 0.29, 0.27], over: { layer: "gravel", tint: [0.85, 0.82, 0.76], wearKind: "damp", dirt: 0.15 } },
  bark: { colour: [0.11, 0.065, 0.035], over: { layer: "mud", tint: [1, 0.72, 0.5], wearKind: "damp" } },
  weeds: { colour: [0.08, 0.065, 0.045], over: { layer: "mud", tint: [0.65, 0.62, 0.5], wearKind: "growth" } },
  walk: { colour: [0.4, 0.4, 0.38], over: { layer: "sidewalk", tint: [0.75, 0.74, 0.7], wear: 0.3, wearKind: "moss", dirt: 0.3 } },
  planted: { colour: [0.05, 0.04, 0.03], over: { layer: "mud", tint: [0.22, 0.22, 0.23], wearKind: "growth" } },
};

/** The ground slope under a house, as the unit direction it falls (x, z) and how steep (rise over run). */
function fall(g: TownGround, h: HouseSeam): { x: number; z: number; steep: number } {
  const c = h.b.centre;
  const ax = g.anchor.x;
  const az = g.anchor.z;
  const d = Math.max(h.b.halfAlong, h.b.halfAcross) + 1;
  const gx = (g.heightAt(ax + c.x + d, az + c.z) - g.heightAt(ax + c.x - d, az + c.z)) / (2 * d);
  const gz = (g.heightAt(ax + c.x, az + c.z + d) - g.heightAt(ax + c.x, az + c.z - d)) / (2 * d);
  const l = Math.sqrt(gx * gx + gz * gz);
  return l < 1e-6 ? { x: 0, z: 0, steep: 0 } : { x: -gx / l, z: -gz / l, steep: l };
}

/** The tone of one patch of the band: the house's own kind most of the time, another now and then (a wall's ground is never of one piece). */
function toneFor(kind: Bed, key: number, i: number): { colour: Rgb; over: Over } {
  const r = hash01(key, i + 970);
  const alt: Bed[] = kind === "soil" ? ["soil", "soil", "moss", "weeds"] : kind === "moss" ? ["moss", "moss", "soil", "weeds"] : kind === "gravel" ? ["gravel", "gravel", "gravel", "soil"] : kind === "bark" ? ["bark", "bark", "bark", "soil"] : kind === "weeds" ? ["weeds", "moss", "soil", "weeds"] : kind === "planted" ? ["planted", "planted", "planted", "soil"] : [kind];
  const t = alt[Math.min(alt.length - 1, Math.floor(r * alt.length))] as Bed;
  return LOOK[t === "walk" ? "soil" : t];
}

export function seamGround(g: TownGround, flat: Sink, detail: Detail): void {
  const surf = new Surface(g, flat);
  const ax = g.anchor.x;
  const az = g.anchor.z;
  const plan = g.plan;
  for (const h of seamHouses()) {
    const b = h.b;
    if (b.kind !== "house" && b.kind !== "boarding house") continue;
    const yard = plan.yards[b.lot];
    if (yard === undefined || yard.kind === "paved") continue;
    const neg = neglectOf(plan, b);
    const bed = bedOf(g, h);
    const shape = yardShape(plan, b.lot);
    const rects: YardRect[] = [];
    if (shape.drive !== null && yard.drive !== null) rects.push(shape.drive);
    if (shape.walk !== null && yard.walk !== null) rects.push(shape.walk);
    const onRect = (x: number, z: number): boolean => rects.some((r) => inYardRect(r, x - ax, z - az, 0.35));
    const slope = fall(g, h);
    const look = LOOK[bed];
    const baseW = (0.45 + 0.5 * hash01(b.id, 901) + 0.2 * neg) * (bed === "weeds" ? 0.6 : bed === "walk" ? 1.2 : 1);
    h.refs.forEach((w, k) => {
      if (h.blocked[k]) return;
      const front = k === h.frontAt;
      // A planted bed lies along the front and one side; the rest of the house has bare soil.
      const kindHere: Bed = bed === "planted" && !(front || k === (h.frontAt + 1) % h.refs.length) ? "soil" : bed;
      const lk = kindHere === bed ? look : LOOK[kindHere];
      // The wall that faces down the slope sheds its water out over the lawn: wider; the uphill one has the earth banked against it: narrower.
      const down = clamp01(0.5 + 0.5 * (w.nx * slope.x + w.nz * slope.z) * Math.min(1, slope.steep * 8));
      const wallW = baseW * (0.75 + 0.7 * down) * (0.85 + 0.3 * hash01(b.id * 7 + k, 902));
      const wide = (s: number): number => Math.max(0.28, Math.min(0.95, wallW * (0.55 + 0.9 * hash01(b.id * 31 + k, Math.floor(s / 0.9) + 910))));
      const doorGap = front && h.door !== null ? (h.door.porch !== null ? [h.door.porch.s0 - 0.25, h.door.porch.s1 + 0.25] : [h.door.s - h.door.half - 0.45, h.door.s + h.door.half + 0.45]) : null;
      const planted = kindHere === "planted";
      let s = 0;
      let i = 0;
      while (s < w.length - 0.05) {
        const s1 = Math.min(w.length, s + (detail === "low" ? 3.5 : 1.9) + 1.4 * hash01(b.id * 13 + k, i + 920));
        i++;
        const sa = s;
        s = s1;
        if (doorGap !== null && s1 > (doorGap[0] as number) && sa < (doorGap[1] as number)) continue;
        // The low tier lays the band on the sides and the back only, and not on a wall that is shorter than a room.
        if (detail === "low" && (front || w.length < 3)) continue;
        // A run of the wall the owner has cleaned or built over: a gap in the band now and then (more where it is kept up).
        if (hash01(b.id * 17 + k, i + 930) < 0.12 * (1 - neg)) continue;
        const w0 = wide(sa);
        const w1 = wide(s1);
        const ext = (a: number, o: number): P2 => [w.ax + w.tx * a + w.nx * o, w.az + w.tz * a + w.nz * o];
        // Wear: full along the foundation, none at the outer edge, which the ground's own noise then breaks.
        const reach = (a: number): number => wide(a);
        const wear = (p: readonly [number, number, number]): number => {
          const a = (p[0] - w.ax) * w.tx + (p[2] - w.az) * w.tz;
          const o = (p[0] - w.ax) * w.nx + (p[2] - w.az) * w.nz;
          return clamp01((1 - (o - FOUND) / (reach(a) - FOUND)) / 0.4);
        };
        const sa2 = sa === 0 ? -0.12 : sa;
        const sb2 = s1 === w.length ? w.length + 0.12 : s1;
        const pts: P2[] = [ext(sa2, FOUND + 0.02), ext(sb2, FOUND + 0.02), ext(sb2, w1), ext(sa2, w0)];
        if (pts.some((q) => onRect(q[0], q[1]))) continue;
        const mid = ext((sa + s1) / 2, (w0 + w1) / 2);
        if (onRect(mid[0], mid[1])) continue;
        const over: Over = { ...lk.over, rank: RANK.mark, ...(lk.over.wear === undefined ? { wear } : {}) };
        if (kindHere === "walk") {
          // A strip of concrete against the wall with a ragged outer edge, its joints every 1.2 m; weeds stand in them (`growth.ts`).
          const j = (n: number): number => 0.03 * (hash01(b.id * 5 + k, i * 4 + n) - 0.5) * 2;
          surf.flat([ext(sa2, FOUND + 0.02), ext(sb2, FOUND + 0.02), ext(sb2, 0.62 + j(1)), ext(sa2, 0.62 + j(2))], LIFT, lk.colour, over);
          continue;
        }
        // The low tier's band is one flat piece at full wear.
        const { wear: _w, ...rest } = over;
        void _w;
        if (detail === "low") {
          surf.flat(pts, LIFT, lk.colour, { ...rest, wear: 0.8 });
          continue;
        }
        // One ragged patch: wear full at the foundation, falling away outward, the outer edge wandering by 15 to 40 cm along its length, wider at a downspout; each patch its own tone.
        const tone = toneFor(kindHere, b.id * 19 + k, i);
        const spoutHere = spoutOf(h, k);
        const wp = ((w0 + w1) / 2) * (Math.abs((sa + s1) / 2 - spoutHere) < 1.4 ? 1.7 : 1);
        const n = Math.max(3, Math.ceil((sb2 - sa2) / 0.5));
        const outer: P2[] = [];
        for (let q = n; q >= 0; q--) {
          const a = sa2 + ((sb2 - sa2) * q) / n;
          const o = Math.max(0.3, Math.min(1.2, wp * (0.55 + 0.75 * hash01(b.id * 23 + k, i * 17 + q + 940))));
          outer.push(ext(a, o));
        }
        const poly: P2[] = [ext(sa2, FOUND + 0.02), ext(sb2, FOUND + 0.02), ...outer];
        const ring = (p: readonly [number, number, number]): number => ((p[0] - w.ax) * w.nx + (p[2] - w.az) * w.nz < FOUND + 0.06 ? 1 : 0.3 + 0.4 * hash01(Math.round(((p[0] - w.ax) * w.tx + (p[2] - w.az) * w.tz) * 7) + b.id * 5, k + 960));
        surf.flat(poly, LIFT, tone.colour, { ...tone.over, rank: RANK.mark, wear: ring });
      }
      void planted;
    });
    if (detail === "low") continue;
    pad(g, surf, h, neg, onRect);
    if (shape.walk === null || yard.walk === null) wornPath(g, surf, h, neg, shape.front, rects);
    puddle(g, surf, h, neg, yard.kind, onRect);
    lawn(g, surf, h, neg, yard.kind, onRect);
  }
}

/** Where the steps or the porch meet the ground: a worn pad, bare earth trodden hard, wider than the steps and ragged at its edge. */
function pad(g: TownGround, surf: Surface, h: HouseSeam, neg: number, onRect: (x: number, z: number) => boolean): void {
  const d = h.door;
  if (d === null) return;
  const w = h.refs[h.frontAt] as (typeof h.refs)[number];
  const b = h.b;
  const out = d.out + 0.35 + 0.25 * hash01(b.id, 940);
  const half = d.half + 0.4;
  const shift = (hash01(b.id, 941) - 0.5) * 0.4;
  const p = (s: number, o: number): P2 => {
    const q = wat(w, d.s + shift + s, 0, o);
    return [q[0], q[2]];
  };
  const j = (n: number): number => 0.07 * (hash01(b.id * 3 + n, 945) - 0.5) * 2;
  const mid = (out + FOUND + 0.02) / 2;
  // Eight corners with a roll on each: a pad trodden to bare earth, uneven at its edge (a hand's breadth), its ends under the steps.
  const corners: P2[] = [p(-half, FOUND + 0.02), p(0, FOUND + 0.02), p(half, FOUND + 0.02), p(half + 0.12 + j(1), mid + j(2)), p(half + 0.05 + j(3), out + j(4)), p(j(5), out + 0.08 + j(6)), p(-half - 0.05 + j(7), out + j(8)), p(-half - 0.12 + j(9), mid + j(10))];
  if (corners.some((q) => onRect(q[0], q[1]))) return;
  void neg;
  surf.fill(corners, LIFT, LOOK.soil.colour, 1, { ...LOOK.soil.over, wearKind: "damp", rank: RANK.mark, wear: 1 });
}

/** A worn path from the door to the street where no walk was laid: bare earth, a hand's width at its edges wandering. */
function wornPath(g: TownGround, surf: Surface, h: HouseSeam, neg: number, front: { a: { x: number; z: number }; b: { x: number; z: number } } | null, rects: readonly YardRect[]): void {
  const d = h.door;
  if (d === null || front === null) return;
  const w = h.refs[h.frontAt] as (typeof h.refs)[number];
  const b = h.b;
  const ax = g.anchor.x;
  const az = g.anchor.z;
  // The frontage point nearest the door's line out: straight out from the door to the frontage (the walk would go this way).
  const start = wat(w, d.s, 0, d.out + 0.5);
  const fx = front.b.x - front.a.x;
  const fz = front.b.z - front.a.z;
  const fl = Math.sqrt(fx * fx + fz * fz);
  if (fl < 1) return;
  const tx = fx / fl;
  const tz = fz / fl;
  const nx0 = -tz;
  const nz0 = tx;
  // Distance from the start to the frontage line, along the line's normal (toward the street).
  const toLine = ((front.a.x + ax - start[0]) * nx0 + (front.a.z + az - start[2]) * nz0);
  const dist = Math.abs(toLine);
  if (dist < 1.5 || dist > 14) return;
  const dir = toLine > 0 ? 1 : -1;
  const dx = nx0 * dir;
  const dz = nz0 * dir;
  const px = -dz;
  const pz = dx;
  const hw = 0.3 + 0.22 * hash01(b.id, 950) - 0.1 * neg * 0;
  const n = Math.max(2, Math.ceil(dist / 1.3));
  let lat0 = 0;
  const wearAmount = 0.75 + 0.25 * hash01(b.id, 951);
  for (let i = 0; i < n; i++) {
    const a0 = (dist * i) / n;
    const a1 = (dist * (i + 1)) / n;
    const lat1 = (hash01(b.id * 3, i + 960) - 0.5) * 0.5;
    const c = (a: number, l: number, s: number): P2 => [start[0] + dx * a + px * (l + s), start[2] + dz * a + pz * (l + s)];
    const pts: P2[] = [c(a0, lat0, -hw), c(a1, lat1, -hw), c(a1, lat1, hw), c(a0, lat0, hw)];
    lat0 = lat1;
    if (pts.some((q) => rects.some((r) => inYardRect(r, q[0] - ax, q[1] - az, 0.3)))) continue;
    surf.flat(pts, LIFT, LOOK.soil.colour, { ...LOOK.soil.over, wearKind: "damp", rank: RANK.mark, wear: wearAmount });
  }
}

/** A dip where water stands: a smooth dark patch on some lawns, a few metres from the house. */
function puddle(g: TownGround, surf: Surface, h: HouseSeam, neg: number, kind: string, onRect: (x: number, z: number) => boolean): void {
  const b = h.b;
  const chance = kind === "mossy" ? 0.5 : kind === "bare" ? 0.45 : kind === "tall" || kind === "shaggy" ? 0.3 : 0.12;
  if (hash01(b.id, 970) > chance) return;
  const ax = g.anchor.x;
  const az = g.anchor.z;
  const ang = hash01(b.id, 971) * Math.PI * 2;
  const reachA = Math.max(b.halfAlong, b.halfAcross);
  const dd = reachA + 1.5 + 3 * hash01(b.id, 972);
  const cx = ax + b.centre.x + Math.cos(ang) * dd;
  const cz = az + b.centre.z + Math.sin(ang) * dd;
  // On the lot only: its own yard's ground (the plan's lot index says whose it is).
  const r = 0.4 + 0.5 * hash01(b.id, 973) + 0.2 * neg;
  const pts: P2[] = [];
  for (let k = 0; k < 8; k++) {
    const a = (k / 8) * Math.PI * 2 + 0.2 * (hash01(b.id * 9 + k, 974) - 0.5);
    const rr = r * (0.8 + 0.4 * hash01(b.id * 9 + k, 975));
    pts.push([cx + Math.cos(a) * rr * 1.3, cz + Math.sin(a) * rr]);
  }
  if (pts.some((q) => onRect(q[0], q[1]) || lotIdAt(g.plan, q[0] - ax, q[1] - az) !== b.lot)) return;
  surf.fill(pts, LIFT, scaled(LOOK.soil.colour, 0.8), 1, { ...LOOK.soil.over, rank: RANK.mark, wear: 1, tint: [0.35, 0.34, 0.34] });
}

/** The tones the lawn comes in, by cause: clover and fresh grass (bright), a dull mossy green, dry straw, and bare worn earth. */
const LAWN: Readonly<Record<"clover" | "dull" | "straw" | "bare", { layer: "moss" | "mud"; tint: Rgb }>> = {
  clover: { layer: "moss", tint: [0.95, 1.3, 0.6] },
  dull: { layer: "moss", tint: [0.85, 1.0, 0.8] },
  straw: { layer: "moss", tint: [1.4, 1.2, 0.62] },
  bare: { layer: "mud", tint: [1.0, 0.9, 0.8] },
};

/** Whether (x, z) (world) is inside a building's footprint grown by `m` metres. */
function nearBuilding(g: TownGround, x: number, z: number, m: number): boolean {
  const px = x - g.anchor.x;
  const pz = z - g.anchor.z;
  for (const o of g.plan.buildings) {
    if (o.kind === "pier" || Math.abs(o.centre.x - px) > 30 || Math.abs(o.centre.z - pz) > 30) continue;
    const u = bearingU(o.bearing);
    const v = bearingV(o.bearing);
    const dx = px - o.centre.x;
    const dz = pz - o.centre.z;
    if (Math.abs(dx * u.x + dz * u.z) < o.halfAlong + m && Math.abs(dx * v.x + dz * v.z) < o.halfAcross + m) return true;
  }
  return false;
}

/**
 * The lawn is not one plane of one green: patches of clover, dull moss, straw and bare worn earth cover a third to a half of a let-go yard (a few on a kept one, which
 * is even), each a fan from its middle (wear full there, falling to the rim, which the ground's noise cuts ragged), and humps of earth 3 to 6 cm high here and there
 * that the light catches. By the yard's kind: a mossy one is dull and green, a bare one earth and straw, a tall or shaggy one straw and clover.
 */
function lawn(g: TownGround, surf: Surface, h: HouseSeam, neg: number, kind: string, onRect: (x: number, z: number) => boolean): void {
  const b = h.b;
  const ax = g.anchor.x;
  const az = g.anchor.z;
  const reachA = Math.max(b.halfAlong, b.halfAcross);
  const count = Math.round(2 + 4.5 * neg);
  const mix: readonly (keyof typeof LAWN)[] = kind === "mossy" ? ["dull", "dull", "clover", "bare"] : kind === "bare" ? ["bare", "bare", "straw", "dull"] : kind === "tall" || kind === "brush" ? ["straw", "straw", "clover", "dull"] : kind === "shaggy" ? ["clover", "straw", "dull", "bare"] : ["clover", "clover", "dull", "straw"];
  const lot = g.plan.lots[b.lot];
  let bx0 = Infinity;
  let bx1 = -Infinity;
  let bz0 = Infinity;
  let bz1 = -Infinity;
  for (const q of lot?.polygon ?? []) {
    bx0 = Math.min(bx0, q.x);
    bx1 = Math.max(bx1, q.x);
    bz0 = Math.min(bz0, q.z);
    bz1 = Math.max(bz1, q.z);
  }
  void reachA;
  const place = (key: number, rmin: number, rmax: number, tries: number): { cx: number; cz: number; r: number } | null => {
    if (!(bx1 > bx0)) return null;
    for (let t = 0; t < tries * 4; t++) {
      const r = rmin + (rmax - rmin) * hash01(key, 1020 + t);
      const cx = ax + bx0 + (bx1 - bx0) * hash01(key, 1000 + t);
      const cz = az + bz0 + (bz1 - bz0) * hash01(key, 1010 + t);
      let ok = lotIdAt(g.plan, cx - ax, cz - az) === b.lot && !nearBuilding(g, cx, cz, r * 1.2 + 0.8) && !onRect(cx, cz);
      for (let q = 0; q < 6 && ok; q++) {
        const px = cx + Math.cos(q) * r * 1.3;
        const pz = cz + Math.sin(q) * r;
        if (lotIdAt(g.plan, px - ax, pz - az) !== b.lot || onRect(px, pz)) ok = false;
      }
      if (ok) return { cx, cz, r };
    }
    return null;
  };
  const fan = (cx: number, cz: number, r: number, key: number, tone: { layer: "moss" | "mud"; tint: Rgb }, lift0: number): void => {
    // A ragged ring of six or seven corners round the middle; the middle is raised for a hump (each triangle of the fan has its own corner lifts).
    const n = 6;
    const pts: P2[] = [];
    const rot = hash01(key, 1100) * 3;
    const sq = 0.6 + 0.5 * hash01(key, 1101);
    for (let q = 0; q < n; q++) {
      const a = (q / n) * Math.PI * 2 + rot + 0.3 * (hash01(key, 1110 + q) - 0.5);
      const rr = r * (0.65 + 0.7 * hash01(key, 1120 + q));
      pts.push([cx + Math.cos(a) * rr * 1.2, cz + Math.sin(a) * rr * sq]);
    }
    const over: Over = { layer: tone.layer, tint: tone.tint, frame: { origin: [cx, 0, cz], u: [1, 0, 0], v: [0, 0, 1] }, rank: RANK.mark };
    for (let q = 0; q < n; q++) {
      const a = pts[q] as P2;
      const c = pts[(q + 1) % n] as P2;
      surf.poly([[cx, cz, lift0], [a[0], a[1], YARD], [c[0], c[1], YARD]], GRAVEL, over);
    }
  };
  for (let i = 0; i < count; i++) {
    const key = b.id * 131 + i * 7;
    const at = place(key, 1.5, 3 + 1 * neg, 3);
    if (at === null) continue;
    const t = mix[Math.min(mix.length - 1, Math.floor(hash01(key, 1200) * mix.length))] as keyof typeof LAWN;
    fan(at.cx, at.cz, at.r, key, LAWN[t], YARD);
  }
  // Humps: low mounds of earth, a few on any lawn (more where it is let go).
  const humps = Math.round(1 + 2 * neg);
  for (let i = 0; i < humps; i++) {
    const key = b.id * 137 + i * 11 + 5;
    const at = place(key, 0.8, 1.5, 3);
    if (at === null) continue;
    fan(at.cx, at.cz, at.r, key, LAWN[kind === "bare" ? "bare" : "dull"], YARD + 0.03 + 0.03 * hash01(key, 1300));
  }
}
