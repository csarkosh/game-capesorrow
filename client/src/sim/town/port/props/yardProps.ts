/**
 * Bins, mailboxes and gear, each from its cause.
 *
 * - **Wheeled carts** stand by the side of a lived-in house (put away), or have been left at the curb on the verge; one is on its side
 *   now and then. Commercial buildings have a dumpster, pallets and a grease drum behind them, away from the street.
 * - **Mailboxes** stand on posts at the curb on every street side with no sidewalk (no delivery to a door): in ragged groups of two to
 *   four on the edge streets, one to a lot on the later ones' streets, some with a cluster box where a later addition has them; some
 *   lean on their posts.
 * - **Gear**: crab pots in stacks of five to eight, strings of buoys, totes, coiled line and net piles in a fisherman's yard (a lot near
 *   the harbour or in a mill's housing) and on the working piers and the quay; firewood, a propane tank and pallets in an ordinary yard.
 */
import { chance, int, next, range, weighted, type Rng } from "../../rng.js";
import type { Deck, GearKind } from "../../types.js";
import { boxAt, turned } from "./boxes.js";
import { at, sub, drawOf, pickIndex, type Context, type LotInfo, type StreetFrame } from "./context.js";
import { put, type Out } from "./out.js";
import * as T from "./tuning.js";
import { scatter } from "./vehicles.js";
import { TAG } from "./vehicles.js";

/** A point beside a building's wall, outside it: tried a few times for a free one, with the heading along the wall. */
function besideBuilding(ctx: Context, out: Out, info: LotInfo, rng: Rng, length: number, width: number, avoidFront: boolean): { x: number; z: number; hx: number; hz: number } | null {
  const b = info.building;
  if (b === undefined) return null;
  const ux = b.bearing.a / b.bearing.c;
  const uz = b.bearing.b / b.bearing.c;
  const vx = -uz;
  const vz = ux;
  for (let k = 0; k < 14; k++) {
    // Which wall: along-u ends or across-v sides.
    const wall = Math.floor(next(rng) * 4);
    const sg = wall % 2 === 0 ? 1 : -1;
    const alongU = wall < 2;
    const nx = alongU ? ux * sg : vx * sg;
    const nz = alongU ? uz * sg : vz * sg;
    if (avoidFront && b.front !== null && nx * b.front.x + nz * b.front.z > 0.7) continue;
    const reach = alongU ? b.halfAlong : b.halfAcross;
    const span = alongU ? b.halfAcross : b.halfAlong;
    const tx = alongU ? vx : ux;
    const tz = alongU ? vz : uz;
    const off = range(rng, -span + length / 2 + 0.3, span - length / 2 - 0.3);
    if (!(span > length / 2 + 0.3)) continue;
    const gap = 0.55 + width / 2 + range(rng, 0, 0.6);
    const x = b.centre.x + nx * (reach + gap) + tx * off;
    const z = b.centre.z + nz * (reach + gap) + tz * off;
    const box = boxAt(x, z, tx, tz, length, width);
    if (ctx.occ.hits(box, 0.3)) continue;
    // In the lot.
    const h = turned(tx * (next(rng) < 0.5 ? 1 : -1), tz, range(rng, -0.05, 0.05));
    void h;
    return { x, z, hx: tx, hz: tz };
  }
  return null;
}

function bins(ctx: Context, out: Out, info: LotInfo): void {
  const b = info.building;
  if (b === undefined || b.state === "ruin") return;
  const rng = sub(ctx.seed0, TAG.bin, info.lot.id);
  const house = b.kind === "house" || b.kind === "boarding house" || b.kind === "apartment";
  const lotId = info.lot.id;
  if (house) {
    if (b.state !== "open" && !chance(rng, 0.3)) return;
    if (!chance(rng, T.CART_HOUSE)) return;
    const n = chance(rng, T.CART_SECOND) ? 2 : 1;
    const outAtCurb = chance(rng, T.CART_OUT) && info.street >= 0;
    for (let i = 0; i < n; i++) {
      const colour = pickIndex(T.CART_COLOURS, next(rng));
      const tipped = chance(rng, T.CART_TIPPED);
      if (outAtCurb) {
        const f = ctx.frames[info.street] as StreetFrame;
        const e = f.edge.sides[info.side];
        const room = e.curb ? e.verge : e.verge - 0.5;
        if (room < 0.8) continue;
        const sg = info.side === 0 ? 1 : -1;
        const s = (info.ox + info.tx * info.frontLen * range(rng, 0.2, 0.8) - f.ax) * f.tx + (info.oz + info.tz * info.frontLen * range(rng, 0.2, 0.8) - f.az) * f.tz;
        const p = at(f, s + i * 0.9, sg * (f.hw + (e.curb ? 0.18 + e.verge * 0.45 : 0.5 + room * 0.3)));
        // The lid opens toward the street's far side: the cart faces the roadway (its handle on the lot's side).
        const h = turned(-f.nx * sg, -f.nz * sg, range(rng, -0.25, 0.25));
        const hd = tipped ? turned(f.tx, f.tz, range(rng, -0.3, 0.3)) : h;
        const box = boxAt(p.x, p.z, hd.x, hd.z, tipped ? 1.0 : 0.62, tipped ? 0.62 : 0.72);
        if (put(ctx, out, box, "bin", { margin: 0.3 })) out.bins.push({ id: out.id(), kind: tipped ? "cart tipped" : "cart", x: p.x, z: p.z, hx: hd.x, hz: hd.z, colour, lot: lotId, seed: Math.floor(next(rng) * 0x7fffffff) });
      } else {
        const sp = besideBuilding(ctx, out, info, rng, 0.62, 0.72, true);
        if (sp === null) continue;
        const h = turned(sp.hx, sp.hz, range(rng, -0.08, 0.08));
        const box = boxAt(sp.x, sp.z, h.x, h.z, tipped ? 1.0 : 0.62, tipped ? 0.62 : 0.72);
        if (put(ctx, out, box, "bin", { lot: info, margin: 0.2 })) out.bins.push({ id: out.id(), kind: tipped ? "cart tipped" : "cart", x: sp.x, z: sp.z, hx: h.x, hz: h.z, colour, lot: lotId, seed: Math.floor(next(rng) * 0x7fffffff) });
      }
    }
    return;
  }
  // Behind a commercial building: a dumpster, pallets, a drum. Only buildings that serve the public or work.
  if (b.state !== "open" || !(b.kind === "storefront" || b.kind === "restaurant" || b.kind === "tavern" || b.kind === "big-box store" || b.kind === "gas station" || b.kind === "warehouse" || b.kind === "motel" || b.kind === "hotel" || b.kind === "garage" || b.kind === "cannery" || b.kind === "mill shed")) return;
  const draw = drawOf(b, info.use);
  const count = (draw > 0.5 ? 1 : 0) + (chance(rng, 0.5) ? 1 : 0) + (chance(rng, 0.3) ? 1 : 0);
  for (let i = 0; i < count; i++) {
    const kind = weighted(rng, T.BIN_KIND_BEHIND);
    const length = kind === "dumpster" ? 1.9 : kind === "pallets" ? 1.2 : 0.62;
    const width = kind === "dumpster" ? 1.3 : kind === "pallets" ? 1.0 : 0.62;
    const sp = scatter(ctx, out, info, rng, length, width, { depth0: Math.max(2, info.depth * 0.45), depth1: info.depth - 0.8, heading: (r) => turned(info.tx, info.tz, range(r, -0.08, 0.08)), margin: 0.5, inset: 0.5 });
    if (sp === null) continue;
    out.bins.push({ id: out.id(), kind, x: sp.x, z: sp.z, hx: sp.hx, hz: sp.hz, colour: Math.floor(next(rng) * 4), lot: lotId, seed: Math.floor(next(rng) * 0x7fffffff) });
    const box = boxAt(sp.x, sp.z, sp.hx, sp.hz, length, width);
    put(ctx, out, box, "bin", { margin: 0.3 });
  }
}

function mailboxes(ctx: Context, out: Out): void {
  for (const f of ctx.frames) {
    if (f === undefined) continue;
    const st = f.street;
    if (st.kind !== "main" && st.kind !== "avenue" && st.kind !== "street") continue;
    for (const side of [0, 1] as const) {
      const e = f.edge.sides[side];
      if (e.walk > 0 && e.runs.length > 0) continue;
      const sg = side === 0 ? 1 : -1;
      // The lots of this side with someone to deliver to, in order along the street.
      const lots = ctx.lots.filter((l) => l.street === st.id && l.side === side && l.building !== undefined && l.building.state === "open" && l.lived && (l.building.kind === "house" || l.building.kind === "boarding house" || l.building.kind === "apartment"));
      const key = (l: LotInfo): number => (l.ox + l.tx * l.frontLen * 0.5 - f.ax) * f.tx + (l.oz + l.tz * l.frontLen * 0.5 - f.az) * f.tz;
      lots.sort((a, b) => key(a) - key(b));
      const rng = sub(ctx.seed0, TAG.mail, st.id * 3 + side);
      const t = e.curb ? f.hw + 0.18 + Math.min(e.verge * 0.5, 0.9) : f.hw + Math.max(0.55, Math.min(e.verge + 0.2, 1.6));
      const era = f.edge.era;
      let i = 0;
      while (i < lots.length) {
        const run = era === "edge" ? int(rng, 2, 4) : era === "later" ? int(rng, 1, 3) : 1;
        const group = lots.slice(i, i + run);
        i += run;
        const mid = group.reduce((a, l) => a + key(l), 0) / group.length + range(rng, -3, 3);
        const members = group.filter(() => chance(rng, T.MAILBOX));
        if (members.length === 0) continue;
        if (era === "later" && members.length >= 2 && chance(rng, T.CLUSTER_LATER)) {
          const p = at(f, Math.max(3, Math.min(f.length - 3, mid)), sg * t);
          const face = turned(-f.nx * sg, -f.nz * sg, 0);
          const box = boxAt(p.x, p.z, f.tx, f.tz, 0.9, 0.5);
          if (put(ctx, out, box, "mailbox", { margin: 0.3 })) out.mailboxes.push({ id: out.id(), kind: "cluster", x: p.x, z: p.z, hx: face.x, hz: face.z, lean: 0, colour: Math.floor(next(rng) * 2), lot: (members[0] as LotInfo).lot.id, seed: Math.floor(next(rng) * 0x7fffffff) });
          continue;
        }
        const n = members.length;
        for (let k = 0; k < n; k++) {
          const lot = members[k] as LotInfo;
          const s = Math.max(3, Math.min(f.length - 3, mid + (k - (n - 1) / 2) * range(rng, 0.7, 1.15) + (n === 1 ? range(rng, -4, 4) : 0)));
          const p = at(f, s, sg * (t + range(rng, -0.12, 0.2)));
          const lean = chance(rng, T.MAILBOX_LEAN) ? range(rng, 0.06, 0.28) * (next(rng) < 0.5 ? 1 : -1) : 0;
          const face = turned(-f.nx * sg, -f.nz * sg, range(rng, -0.2, 0.2));
          const box = boxAt(p.x, p.z, f.tx, f.tz, 0.34, 0.34);
          if (put(ctx, out, box, "mailbox", { margin: 0.25 })) out.mailboxes.push({ id: out.id(), kind: "post", x: p.x, z: p.z, hx: face.x, hz: face.z, lean, colour: Math.floor(next(rng) * 6), lot: lot.lot.id, seed: Math.floor(next(rng) * 0x7fffffff) });
        }
      }
    }
  }
}

/** The solid footprint a kind of gear takes. */
function gearSize(kind: GearKind, n: number): [number, number] {
  switch (kind) {
    case "pots": return [1.15, 1.15];
    case "buoys": return [0.9, 0.9];
    case "totes": return [1.1, 0.8 + 0.1 * Math.min(2, n)];
    case "coil": return [0.9, 0.9];
    case "net": return [1.7, 1.4];
    case "firewood": return [1.9, 0.9];
    case "propane": return [0.5, 0.5];
    case "pallet stack": return [1.2, 1.0];
  }
}

function gearIn(ctx: Context, out: Out, rng: Rng, kind: GearKind, p: { x: number; z: number; hx: number; hz: number }, lot: number, info: LotInfo | null): boolean {
  const n = kind === "pots" ? int(rng, T.POTS_STACK.min, T.POTS_STACK.max) : kind === "totes" ? int(rng, 1, 3) : kind === "buoys" ? int(rng, 3, 7) : kind === "pallet stack" ? int(rng, 1, 5) : 1;
  const [l, w] = gearSize(kind, n);
  const box = boxAt(p.x, p.z, p.hx, p.hz, l, w);
  const solid = kind !== "coil" && kind !== "buoys" && kind !== "net";
  if (!put(ctx, out, box, "gear", { lot: info, margin: 0.3, solid })) return false;
  out.gear.push({ id: out.id(), kind, x: p.x, z: p.z, hx: p.hx, hz: p.hz, n, colour: Math.floor(next(rng) * 6), lot, seed: Math.floor(next(rng) * 0x7fffffff) });
  return true;
}

function yardGear(ctx: Context, out: Out, info: LotInfo): void {
  const b = info.building;
  if (b === undefined || b.state === "ruin") return;
  const rng = sub(ctx.seed0, TAG.gear, info.lot.id);
  const house = b.kind === "house" || b.kind === "boarding house";
  if (!house) return;
  const fisher = info.harbour < T.HARBOUR_NEAR * 0.8 || info.lot.district === "mill housing" || info.lot.district === "dock";
  const lived = b.state === "open";
  if (fisher && lived && chance(rng, 0.5)) {
    const n = 1 + int(rng, 0, 2);
    for (let i = 0; i < n; i++) {
      const kind = weighted(rng, T.FISHER_GEAR);
      const sp = besideBuilding(ctx, out, info, rng, 1.2, 1.2, i === 0 ? false : true);
      if (sp !== null) gearIn(ctx, out, rng, kind, { ...sp, ...turnedXZ(sp, rng) }, info.lot.id, info);
    }
  }
  if (chance(rng, lived ? 0.4 : 0.1)) {
    const kind = weighted(rng, T.YARD_GEAR);
    const sp = besideBuilding(ctx, out, info, rng, 1.2, 1.0, true);
    if (sp !== null) gearIn(ctx, out, rng, kind, { ...sp, ...turnedXZ(sp, rng) }, info.lot.id, info);
  }
}

function turnedXZ(p: { hx: number; hz: number }, rng: Rng): { hx: number; hz: number } {
  const h = turned(p.hx, p.hz, range(rng, -0.3, 0.3));
  return { hx: h.x, hz: h.z };
}

/** Gear on the working piers and the quay: along one edge of a deck, leaving the middle clear to walk. */
function deckGear(ctx: Context, out: Out): void {
  const plan = ctx.plan;
  const working = plan.harbour.boats.some((b) => b.state === "working");
  const decks: readonly Deck[] = plan.decks.filter((d) => d.kind === "pier" || d.kind === "wharf" || d.kind === "apron");
  for (const d of decks) {
    const rng = sub(ctx.seed0, TAG.gear, 500000 + d.id);
    const alongLong = d.halfAlong >= d.halfAcross;
    const ax = alongLong ? d.axis.x : -d.axis.z;
    const az = alongLong ? d.axis.z : d.axis.x;
    const half = alongLong ? d.halfAlong : d.halfAcross;
    const short = alongLong ? d.halfAcross : d.halfAlong;
    if (short < 1.9 || half < 5) continue;
    const vx = -az;
    const vz = ax;
    const every = d.kind === "apron" ? 12 : 9;
    const p = working ? 0.55 : 0.2;
    for (let a = -half + 3; a < half - 2; a += every * range(rng, 0.7, 1.4)) {
      if (!chance(rng, p)) continue;
      const edge = next(rng) < 0.5 ? 1 : -1;
      const lat = edge * (short - 1.5 - range(rng, 0, Math.max(0, Math.min(1.5, short - 2.6))));
      const x = d.centre.x + ax * a + vx * lat;
      const z = d.centre.z + az * a + vz * lat;
      const kind = weighted(rng, T.FISHER_GEAR);
      const h = turned(ax, az, range(rng, -0.25, 0.25));
      gearIn(ctx, out, rng, kind, { x, z, hx: h.x, hz: h.z }, -1, null);
    }
  }
}

export function planYardProps(ctx: Context, out: Out): void {
  for (const info of ctx.lots) {
    bins(ctx, out, info);
    yardGear(ctx, out, info);
  }
  mailboxes(ctx, out);
  deckGear(ctx, out);
}
