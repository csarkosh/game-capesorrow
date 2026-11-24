/**
 * Fences, by household. Most front yards have none. A tidy mown lot may have a picket fence round its front yard (missing and leaning
 * pickets, peeling paint, a gate that hangs); an open house a weathered grey board fence along a side and the back (moss, a panel down); an edge or
 * outlying lot post-and-wire; a working yard (the garage, the boat yard, the junkyard, the warehouse) and now and then a house with dogs
 * or gear a chain-link fence all round. A fence follows the lot line, inside it by a hand's width; it stops where a drive or the front
 * walk passes (a gate hangs there on a picket, wire or chain fence), and where a building stands against the line.
 */
import { bearingU, bearingV } from "../../bearings.js";
import { chance, next, range, weighted, type Rng } from "../../rng.js";
import type { Fence, FenceKind } from "../../types.js";
import { boxAt, inside, overlap, type Box } from "./boxes.js";
import { sub, type Context, type LotInfo } from "./context.js";
import type { Out } from "./out.js";
import * as T from "./tuning.js";
import { TAG } from "./vehicles.js";

type Edge = { ax: number; az: number; bx: number; bz: number; kind: "front" | "side" | "back"; len: number };

function edgesOf(info: LotInfo): Edge[] {
  const poly = info.poly;
  const out: Edge[] = [];
  // Which polygon edge is the frontage: the one that starts at (ox, oz). The back is the edge whose outward normal points most nearly into the lot.
  let frontIdx = -1;
  let backIdx = -1;
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i]!;
    if (Math.abs(p.x - info.ox) < 1e-6 && Math.abs(p.z - info.oz) < 1e-6) frontIdx = i;
  }
  let bestBack = -Infinity;
  for (let i = 0; i < poly.length; i++) {
    if (i === frontIdx) continue;
    const p = poly[i]!;
    const q = poly[(i + 1) % poly.length]!;
    const ex = q.x - p.x;
    const ez = q.z - p.z;
    const len = Math.sqrt(ex * ex + ez * ez);
    if (len < 1) continue;
    const outward = (ez / len) * info.dx + (-ex / len) * info.dz;
    if (outward > bestBack) {
      bestBack = outward;
      backIdx = i;
    }
  }
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i]!;
    const q = poly[(i + 1) % poly.length]!;
    const len = Math.sqrt((q.x - p.x) * (q.x - p.x) + (q.z - p.z) * (q.z - p.z));
    if (len < 1) continue;
    out.push({ ax: p.x, az: p.z, bx: q.x, bz: q.z, kind: i === frontIdx ? "front" : i === backIdx ? "back" : "side", len });
  }
  return out;
}

/**
 * Whether a panel stands in the mouth of a drive of another lot (its own lot's drive is a gap in its run): where two lots meet with no street between
 * them (a block the old plat's edge cut in two), one lot's fence along the line would cross the other's drive.
 */
function inAnotherDrive(ctx: Context, info: LotInfo, panel: Box): boolean {
  for (const o of ctx.lots) {
    const d = o.shape.drive;
    if (o === info || d === null) continue;
    if (Math.abs(d.x - panel.cx) > 14 || Math.abs(d.z - panel.cz) > 14) continue;
    if (overlap(panel, boxAt(d.x - d.dx * 3, d.z - d.dz * 3, d.dx, d.dz, 6, 2 * d.half)) > 0.02) return true;
  }
  return false;
}

/** The box a porch takes in front of a house built 1900 to 1949 (a metre either side of the porch's reach), or null. */
function porchBox(info: LotInfo): Box | null {
  const b = info.building;
  if (b === undefined || b.kind !== "house" || b.front === null || b.era < 1900 || b.era >= 1950) return null;
  const u = bearingU(b.bearing);
  const v = bearingV(b.bearing);
  const fu = b.front.x * u.x + b.front.z * u.z;
  const fv = b.front.x * v.x + b.front.z * v.z;
  const alongFront = Math.abs(fu) > Math.abs(fv);
  const axis = alongFront ? u : v;
  const sign = (alongFront ? fu : fv) > 0 ? 1 : -1;
  const half = alongFront ? b.halfAlong : b.halfAcross;
  const wide = alongFront ? b.halfAcross : b.halfAlong;
  const fx = axis.x * sign;
  const fz = axis.z * sign;
  return { cx: b.centre.x + fx * (half + 1.1), cz: b.centre.z + fz * (half + 1.1), ux: fx, uz: fz, hu: 1.1, hv: wide };
}

/** Cuts a run along an edge (inset into the lot) at the gaps, and makes a Fence of each piece. */
function runs(ctx: Context, out: Out, info: LotInfo, rng: Rng, e: Edge, kind: FenceKind, paint: number, wear: number, gaps: { at: number; width: number; leaf: boolean }[], keepAway = true): void {
  const dx = (e.bx - e.ax) / e.len;
  const dz = (e.bz - e.az) / e.len;
  // Inward (the polygon is counter-clockwise): the left of the edge.
  const nx = -dz;
  const nz = dx;
  const inset = 0.26;
  // The run's ends are drawn in from the corners until the line is inside the lot (an acute corner takes more).
  let lo = 0.3;
  let hi = e.len - 0.3;
  const inLot = (s: number): boolean => inside(info.poly, e.ax + nx * inset + dx * s, e.az + nz * inset + dz * s, -0.08);
  while (lo < hi && !inLot(lo)) lo += 0.25;
  while (hi > lo && !inLot(hi)) hi -= 0.25;
  const x0 = e.ax + nx * inset + dx * lo;
  const z0 = e.az + nz * inset + dz * lo;
  const len = hi - lo;
  if (len < 1.2) return;
  // A house of the porch years has its porch past the front wall (`buildingParts.ts`: two metres, with its posts and rail): no panel runs through it.
  const porch = porchBox(info);
  const sorted = gaps.map((g) => ({ ...g, at: g.at + 0.3 - lo })).sort((a, b) => a.at - b.at);
  let cur = 0;
  const pieces: { s0: number; s1: number; gate: Fence["gate"] }[] = [];
  let carry: Fence["gate"] = null;
  for (const g of sorted) {
    const g0 = g.at - g.width / 2;
    const g1 = g.at + g.width / 2;
    if (g1 < 0 || g0 > len) continue;
    if (g0 - cur > 0.9) pieces.push({ s0: cur, s1: g0, gate: g.leaf ? { at: g.at, width: g.width, open: chance(rng, T.GATE_OPEN) ? range(rng, 0.25, 1) : 0 } : null });
    else if (g.leaf) carry = { at: g.at, width: g.width, open: chance(rng, T.GATE_OPEN) ? range(rng, 0.25, 1) : 0 };
    cur = Math.max(cur, g1);
  }
  if (len - cur > 0.9) pieces.push({ s0: cur, s1: len, gate: null });
  if (carry !== null && pieces.length > 0) pieces[0] = { ...(pieces[0] as (typeof pieces)[number]), gate: carry };
  for (const pc of pieces) {
    // Panels that stand clear of the buildings: a run stops where one stands on the line.
    let a = pc.s0;
    let ok0 = -1;
    const step = T.PANEL;
    const segs: [number, number][] = [];
    for (let s = pc.s0; s < pc.s1 - 0.05; s += step) {
      const s1 = Math.min(pc.s1, s + step);
      const mx = x0 + dx * (s + s1) / 2;
      const mz = z0 + dz * (s + s1) / 2;
      const panel = boxAt(mx, mz, dx, dz, s1 - s, 0.2);
      const hit = keepAway && (ctx.bocc.hits(panel, 0.05) || ctx.occ.hits(panel, 0.3, "keep:spawn") || ctx.occ.hits(panel, 0, "keep:rail") || (porch !== null && overlap(panel, porch) > -0.05) || inAnotherDrive(ctx, info, panel));
      if (!hit) {
        if (ok0 < 0) ok0 = s;
        a = s1;
      } else if (ok0 >= 0) {
        segs.push([ok0, a]);
        ok0 = -1;
      }
    }
    if (ok0 >= 0) segs.push([ok0, a]);
    for (const [s0, s1] of segs) {
      if (s1 - s0 < 0.9) continue;
      const f: Fence = {
        id: out.id(), lot: info.lot.id, kind, ax: x0 + dx * s0, az: z0 + dz * s0, bx: x0 + dx * s1, bz: z0 + dz * s1, wear, paint, seed: Math.floor(next(rng) * 0x7fffffff),
        gate: pc.gate === null ? null : { at: pc.gate.at - s0, width: pc.gate.width, open: pc.gate.open },
      };
      out.fences.push(f);
      // A walker is held to it: a box a panel long.
      for (let s = s0; s < s1 - 0.01; s += step) {
        const e1 = Math.min(s1, s + step);
        const box = boxAt(x0 + dx * (s + e1) / 2, z0 + dz * (s + e1) / 2, dx, dz, e1 - s, 0.14);
        // Two runs that meet at a corner overlap a little there: only the first is a wall.
        if (!ctx.occ.hits(box, 0, "fence")) out.solids.push(box);
        ctx.occ.add(box, "fence");
      }
    }
  }
}

export function planFences(ctx: Context, out: Out): void {
  for (const info of ctx.lots) {
    const b = info.building;
    if (info.frontLen < 4 || info.lot.district === "highway strip" && b === undefined) continue;
    const rng = sub(ctx.seed0, TAG.fence, info.lot.id);
    const yk = info.yard.kind;
    const kept = info.yard.kept;
    const house = b !== undefined && (b.kind === "house" || b.kind === "boarding house" || b.kind === "apartment");
    const edges = edgesOf(info);
    const front = edges.find((e) => e.kind === "front");
    const sides = edges.filter((e) => e.kind === "side");
    const back = edges.find((e) => e.kind === "back");
    const outlying = info.lot.district === "outskirts" || (info.street >= 0 && ctx.frames[info.street]?.edge.era === "edge");
    const working = b !== undefined && b.state !== "ruin" && ((T.FENCED_KINDS as readonly string[]).includes(b.kind) || (info.trade !== null && T.FENCED_TRADES.includes(info.trade)));
    const wearOf = (): number => Math.min(1, Math.max(0, (1 - kept) * 0.85 + range(rng, 0, 0.25) + (b !== undefined && b.era <= 1930 ? 0.1 : 0)));
    // The gaps in the front run: the drive (an open gap, or a gate) and the front walk.
    const frontGaps = (leafDrive: boolean): { at: number; width: number; leaf: boolean }[] => {
      const gaps: { at: number; width: number; leaf: boolean }[] = [];
      const drive = info.shape.drive;
      if (drive !== null) gaps.push({ at: (drive.x - info.ox) * info.tx + (drive.z - info.oz) * info.tz - 0.3, width: drive.half * 2 + 1.0, leaf: leafDrive });
      const walk = info.shape.walk;
      if (walk !== null) gaps.push({ at: (walk.x - info.ox) * info.tx + (walk.z - info.oz) * info.tz - 0.3, width: 1.25, leaf: true });
      return gaps;
    };
    // Chain-link all round.
    if ((working && chance(rng, T.CHAIN_WORK)) || (house && b!.state === "open" && kept < 0.75 && chance(rng, T.CHAIN_HOUSE))) {
      const w = 0.2 + range(rng, 0, 0.4);
      for (const e of edges) {
        if (e.kind === "front") runs(ctx, out, info, rng, e, "chain", 0, w, frontGaps(true));
        else runs(ctx, out, info, rng, e, "chain", 0, w, []);
      }
      continue;
    }
    if (b === undefined) continue;
    // The front.
    if (front !== undefined && house && b.state !== "ruin" && (yk === "mown" || yk === "shaggy" || yk === "mossy") && !outlying && chance(rng, T.PICKET_FRONT * (0.45 + kept))) {
      runs(ctx, out, info, rng, front, "picket", Math.floor(next(rng) * 6), wearOf(), frontGaps(false));
    } else if (front !== undefined && (outlying || yk === "bare" || yk === "tall") && b.state !== "ruin" && chance(rng, T.WIRE_EDGE * (outlying ? 1 : 0.4))) {
      runs(ctx, out, info, rng, front, "wire", 0, wearOf(), frontGaps(true));
      for (const e of sides) if (chance(rng, 0.6)) runs(ctx, out, info, rng, e, "wire", 0, wearOf(), []);
      continue;
    }
    // A side and the back, in weathered boards.
    if ((house || b.kind === "storefront" || b.kind === "garage") && chance(rng, T.BOARD_SIDE * (b.state === "open" ? 1 : 0.8)) && sides.length > 0) {
      const side = sides[Math.floor(next(rng) * sides.length)] as Edge;
      const w = wearOf();
      runs(ctx, out, info, rng, side, "board", Math.floor(next(rng) * 3), w, [{ at: side.len * range(rng, 0.3, 0.7) - 0.3, width: 1.1, leaf: true }]);
      if (back !== undefined && chance(rng, 0.6)) runs(ctx, out, info, rng, back, "board", Math.floor(next(rng) * 3), w, []);
    }
  }
}

export { weighted };
