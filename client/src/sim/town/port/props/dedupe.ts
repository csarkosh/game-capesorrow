/**
 * No two neighbouring lots carry the same set. A lot's set is what it holds (the kinds and colours of its vehicles, trailers, bins,
 * gear and the kind, paint and wear of its fences); where two lots that touch hold the same non-empty set, the later one's first
 * item is repainted (or its fence worn a little differently).
 */
import type { Bin, BoatTrailer, Fence, Gear, PlanProps, Vehicle } from "../../types.js";
import type { Context } from "./context.js";
import { PAINT_COUNT, PAINT_NEIGHBOUR } from "./tuning.js";

type M<T> = { -readonly [K in keyof T]: T[K] };

export function signatures(p: PlanProps, lots: number): string[][] {
  const sig: string[][] = Array.from({ length: lots }, () => []);
  for (const v of p.vehicles) if (v.lot >= 0) (sig[v.lot] as string[]).push(`v${v.kind}${v.colour}${v.state}`);
  for (const t of p.trailers) if (t.lot >= 0) (sig[t.lot] as string[]).push(`t${t.boat}${t.colour}${t.tarp ? "T" : ""}`);
  for (const b of p.bins) (sig[b.lot] as string[]).push(`b${b.kind}${b.colour}`);
  for (const g of p.gear) if (g.lot >= 0) (sig[g.lot] as string[]).push(`g${g.kind}${g.n}${g.colour}`);
  for (const f of p.fences) (sig[f.lot] as string[]).push(`f${f.kind}${f.paint}${Math.round(f.wear * 8)}`);
  return sig.map((s) => s.slice().sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)));
}

export function dedupe(ctx: Context, props: PlanProps): PlanProps {
  const vehicles = props.vehicles.map((v) => ({ ...v })) as M<Vehicle>[];
  const trailers = props.trailers.map((v) => ({ ...v })) as M<BoatTrailer>[];
  const bins = props.bins.map((v) => ({ ...v })) as M<Bin>[];
  const gear = props.gear.map((v) => ({ ...v })) as M<Gear>[];
  const fences = props.fences.map((v) => ({ ...v })) as M<Fence>[];
  const work: PlanProps = { ...props, vehicles, trailers, bins, gear, fences };
  for (let pass = 0; pass < 3; pass++) {
    let changed = false;
    const sig = signatures(work, ctx.lots.length);
    for (const info of ctx.lots) {
      const mine = sig[info.lot.id] as string[];
      if (mine.length === 0) continue;
      const key = mine.join("|");
      const clash = info.neighbours.some((n) => n < info.lot.id && (sig[n] as string[]).join("|") === key);
      if (!clash) continue;
      const id = info.lot.id;
      const v = vehicles.find((x) => x.lot === id);
      const t = trailers.find((x) => x.lot === id);
      const b = bins.find((x) => x.lot === id);
      const f = fences.find((x) => x.lot === id);
      const g = gear.find((x) => x.lot === id);
      if (v !== undefined) v.colour = (v.colour + 1) % PAINT_COUNT;
      else if (t !== undefined) t.colour = (t.colour + 1) % 8;
      else if (b !== undefined) b.colour = (b.colour + 1) % 4;
      else if (g !== undefined) g.colour = (g.colour + 1) % 6;
      else if (f !== undefined) for (const x of fences) if (x.lot === id) x.wear = Math.min(1, x.wear + 0.13) === x.wear ? Math.max(0, x.wear - 0.13) : Math.min(1, x.wear + 0.13);
      changed = true;
    }
    if (!changed) break;
  }
  neighbours(vehicles);
  return work;
}

/** Two parked vehicles of one model within `PAINT_NEIGHBOUR` of each other are never one paint: the later one takes the next colour that none of its model's neighbours wears. The worn models (derelicts, the covered car) keep their own textures, so their index is not a paint. */
function neighbours(vehicles: M<Vehicle>[]): void {
  const lim = PAINT_NEIGHBOUR * PAINT_NEIGHBOUR;
  for (let i = 0; i < vehicles.length; i++) {
    const v = vehicles[i] as M<Vehicle>;
    if (v.model === "" || v.state === "derelict" || v.state === "project") continue;
    const worn: number[] = [];
    for (let j = 0; j < vehicles.length; j++) {
      const o = vehicles[j] as M<Vehicle>;
      if (j === i || o.model !== v.model) continue;
      const dx = o.x - v.x;
      const dz = o.z - v.z;
      if (dx * dx + dz * dz <= lim) worn.push(o.colour);
    }
    // Only vehicles before it have settled; a later one that shares is moved when its turn comes.
    if (!vehicles.slice(0, i).some((o) => o.model === v.model && o.colour === v.colour && (o.x - v.x) * (o.x - v.x) + (o.z - v.z) * (o.z - v.z) <= lim)) continue;
    for (let k = 1; k < PAINT_COUNT; k++) {
      const c = (v.colour + k) % PAINT_COUNT;
      if (!worn.includes(c)) {
        v.colour = c;
        break;
      }
    }
  }
}
