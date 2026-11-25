// What the street sees of each open shop: the first four metres of its room behind the glass (`FRONT_ZONE`). For every open unit on the
// three world seeds the plan's furnishings are measured over that band: how much of its width (less the door's zone) has something
// standing in it, how many furnishings are centred in it and how many of those show over a sill, whether the service point reaches into
// it, and whether the door's zone and a way in from it are clear. The table by room type is printed.
import { describe, expect, it } from "vitest";
import { FRONT_ZONE } from "../../src/game/town/people.js";
import type { Furnishing, InteriorType, TownPlan, Unit } from "../../src/sim/town/types.js";
import { planFor } from "../../src/sim/town/planFor.js";
import { WORLD_SEEDS } from "./world.js";

/** A sill's height: a furnishing this tall or taller shows over it. */
const TALL = 0.9;
/** The way in from the door's zone must be this wide. */
const WAY = 1.0;
const SERVICE = new Set<string>(["counter", "checkout"]);

type Row = { readonly seed: number; readonly building: number; readonly unit: number; readonly type: InteriorType; readonly width: number; readonly wide: number; readonly share: number; readonly inBand: number; readonly tall: number; readonly service: boolean; readonly thin: boolean };

const extents = (f: Furnishing): { s0: number; s1: number; d0: number; d1: number } => {
  const ex = (Math.abs(f.dir.x) * f.sx + Math.abs(f.dir.z) * f.sd) / 2;
  const ez = (Math.abs(f.dir.z) * f.sx + Math.abs(f.dir.x) * f.sd) / 2;
  return { s0: f.s - ex, s1: f.s + ex, d0: f.d - ez, d1: f.d + ez };
};

/** The union of intervals, clipped to [lo, hi], with the stretch [cut0, cut1] taken out; returns its length. */
function covered(spans: readonly (readonly [number, number])[], lo: number, hi: number, cut0: number, cut1: number): number {
  const list = spans.map(([a, b]) => [Math.max(lo, a), Math.min(hi, b)] as [number, number]).filter(([a, b]) => b > a).sort((p, q) => p[0] - q[0]);
  let total = 0;
  let end = -Infinity;
  for (const [a0, b0] of list) {
    const a = Math.max(a0, end);
    if (b0 > a) {
      // The part of [a, b0] outside the door's zone.
      total += Math.max(0, Math.min(b0, cut0) - a) + Math.max(0, b0 - Math.max(a, cut1));
      end = b0;
    }
  }
  return total;
}

function measure(unit: Unit): { width: number; wide: number; share: number; inBand: number; tall: number; service: boolean } {
  const room = unit.interior;
  const lo = unit.s0 + 0.24;
  const hi = unit.s1 - 0.24;
  const cut0 = Math.max(lo, unit.door.s - unit.door.width / 2 - 0.45);
  const cut1 = Math.min(hi, unit.door.s + unit.door.width / 2 + 0.45);
  const width = hi - lo - Math.max(0, cut1 - cut0);
  const spans: [number, number][] = [];
  let inBand = 0;
  let tall = 0;
  let service = false;
  for (const f of room.furnishings) {
    if (f.kind === "partition") continue;
    const e = extents(f);
    if (e.d0 < FRONT_ZONE && e.d1 > 0) spans.push([e.s0, e.s1]);
    if (e.d0 < FRONT_ZONE && e.d1 > 0 && SERVICE.has(f.kind)) service = true;
    if (f.d >= 0 && f.d < FRONT_ZONE) {
      inBand++;
      if (f.h >= TALL) tall++;
    }
  }
  return { width, wide: unit.s1 - unit.s0, share: width > 0 ? covered(spans, lo, hi, cut0, cut1) / width : 1, inBand, tall, service };
}

/** Whether a body WAY wide can walk from the door's zone to the back of the band without crossing a furnishing: slice by slice, a free interval that overlaps one reached before it by WAY. */
export function wayInClear(unit: Unit): boolean {
  const lo = unit.s0 + 0.24;
  const hi = unit.s1 - 0.24;
  const boxes = unit.interior.furnishings.map(extents);
  const free = (d: number): [number, number][] => {
    const blocked = boxes.filter((e) => d > e.d0 - 0.01 && d < e.d1 + 0.01).map((e) => [e.s0, e.s1] as const).sort((p, q) => p[0] - q[0]);
    const out: [number, number][] = [];
    let at = lo;
    for (const [a, b] of blocked) {
      if (a - at >= WAY - 1e-6) out.push([at, a]);
      at = Math.max(at, b);
    }
    if (hi - at >= WAY - 1e-6) out.push([at, hi]);
    return out;
  };
  const doorLo = unit.door.s - unit.door.width / 2 - 0.45;
  const doorHi = unit.door.s + unit.door.width / 2 + 0.45;
  let reached: [number, number][] = free(2.4).filter(([a, b]) => Math.min(b, doorHi) - Math.max(a, doorLo) >= WAY - 1e-6);
  for (let d = 2.5; d <= FRONT_ZONE + 1e-9; d += 0.1) {
    const here = free(d).filter(([a, b]) => reached.some(([c, e]) => Math.min(b, e) - Math.max(a, c) >= WAY - 1e-6));
    if (here.length === 0) return false;
    reached = here;
  }
  return true;
}

/** Whether nothing stands in the door's zone (the door's width and 0.45 m either side, 2.4 m deep). */
export function doorZoneClear(unit: Unit): boolean {
  const s0 = unit.door.s - unit.door.width / 2 - 0.45;
  const s1 = unit.door.s + unit.door.width / 2 + 0.45;
  return unit.interior.furnishings.every((f) => {
    if (f.kind === "partition") return true;
    const e = extents(f);
    return !(e.s1 > s0 && e.s0 < s1 && e.d0 < 2.4);
  });
}

function rowsFor(seed: number, plan: TownPlan): { rows: Row[]; units: Unit[] } {
  const rows: Row[] = [];
  const units: Unit[] = [];
  for (const use of plan.uses) {
    for (const unit of use.units) {
      if (unit.state !== "open") continue;
      const m = measure(unit);
      rows.push({ seed, building: use.building, unit: unit.id, type: unit.interior.type, ...m, thin: unit.interior.thin });
      units.push(unit);
    }
  }
  return { rows, units };
}

const median = (v: readonly number[]): number => {
  const s = [...v].sort((a, b) => a - b);
  return s.length === 0 ? 0 : (s[Math.floor((s.length - 1) / 2)] as number);
};

describe("the front of each open shop's room", () => {
  const all: Row[] = [];
  for (const seed of WORLD_SEEDS) {
    const plan = planFor(seed);
    const { rows, units } = rowsFor(seed, plan);
    all.push(...rows);

    it(`seed ${seed}: the door's zone is clear and a way in at least ${WAY} m wide runs from it through the band`, () => {
      for (const [k, unit] of units.entries()) {
        const r = rows[k] as Row;
        expect(doorZoneClear(unit), `building ${r.building} unit ${r.unit} door zone`).toBe(true);
        expect(wayInClear(unit), `building ${r.building} unit ${r.unit} way in`).toBe(true);
      }
    });

    it(`seed ${seed}: no open unit that is not deliberately thin is under 0.45 furnished, and every one 2.6 m wide or more has something tall in the band`, () => {
      for (const r of rows) {
        if (!r.thin) expect(r.share, `building ${r.building} unit ${r.unit} (${r.type})`).toBeGreaterThanOrEqual(0.45);
        if (r.wide >= 2.6) expect(r.tall, `building ${r.building} unit ${r.unit} (${r.type}) has nothing 0.9 m or taller in the band`).toBeGreaterThan(0);
      }
    });
  }

  it("the median share of the band's width furnished is at least 0.7 in each kind of room; about one open unit in six is thin", () => {
    const types = [...new Set(all.map((r) => r.type))].sort();
    const lines: string[] = ["type | units | share median / worst | in band median / worst | tall median / worst | service in band | thin"];
    for (const t of types) {
      const rs = all.filter((r) => r.type === t);
      const share = rs.map((r) => r.share);
      const inBand = rs.map((r) => r.inBand);
      const tall = rs.map((r) => r.tall);
      lines.push(`${t} | ${rs.length} | ${median(share).toFixed(2)} / ${Math.min(...share).toFixed(2)} | ${median(inBand)} / ${Math.min(...inBand)} | ${median(tall)} / ${Math.min(...tall)} | ${((100 * rs.filter((r) => r.service).length) / rs.length).toFixed(0)}% | ${rs.filter((r) => r.thin).length}`);
    }
    console.log(`\n${lines.join("\n")}`);
    for (const t of types) {
      const rs = all.filter((r) => r.type === t);
      if (rs.length >= 5) expect(median(rs.map((r) => r.share)), t).toBeGreaterThanOrEqual(0.7);
    }
    const thin = all.filter((r) => r.thin).length;
    expect(thin / all.length).toBeLessThan(0.25);
  });
});
