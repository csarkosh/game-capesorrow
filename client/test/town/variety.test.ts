import { describe, expect, it } from "vitest";
import { SEEDS, townFor } from "./sites.js";

describe("towns that a person would see as different", () => {
  const plans = SEEDS.map((s) => ({ seed: s, ...townFor(s) }));

  it("prints a one-line summary per seed", () => {
    const lines = plans.map(({ seed, plan }) => {
      const h = plan.history;
      const s = plan.seams[0];
      return [
        `seed ${String(seed).padStart(2)}`,
        plan.name.padEnd(22),
        `${h.founding.purpose} ${h.founding.year}`.padEnd(15),
        `grid ${String(plan.plats[0]!.bearing.deg).padStart(6)}deg/${h.firstPlat.basis}`.padEnd(22),
        `seam ${s ? Math.round(s.angle) : "-"}deg`,
        h.fire ? `fire ${h.fire.year} (${h.fire.burned})` : "no fire",
        h.railroad ? `rail ${h.railroad.year}` : "no rail",
        `mill ${h.mill.fate}${h.mill.fate === "closed" ? ` ${h.mill.closedYear}${h.mill.cleanup ? " cleanup" : ""}` : ""}`,
        h.countySeat.isSeat ? "seat" : "",
        `${plan.counts.blocks} blocks`,
        `${plan.counts.buildings} buildings`,
        `${plan.counts.vacant} vacant`,
      ].join("  ");
    });
    console.log(lines.join("\n"));
    expect(lines.length).toBe(40);
  });

  it("have at least 4 waterfront bearings, 3 founding purposes, and both sides of each historical question", () => {
    const set = <T,>(f: (p: (typeof plans)[number]) => T): T[] => {
      const out: T[] = [];
      for (const p of plans) {
        const v = f(p);
        if (!out.includes(v)) out.push(v);
      }
      return out;
    };
    expect(set((p) => p.plan.plats[0]!.bearing.deg).length).toBeGreaterThanOrEqual(4);
    expect(set((p) => p.plan.history.founding.purpose).length).toBeGreaterThanOrEqual(3);
    expect(set((p) => p.plan.history.fire !== null)).toHaveLength(2);
    expect(set((p) => p.plan.history.railroad !== null)).toHaveLength(2);
    expect(set((p) => p.plan.history.mill.fate)).toHaveLength(2);
    expect(set((p) => p.plan.history.countySeat.isSeat)).toHaveLength(2);
    expect(set((p) => p.plan.history.boom.bust1893)).toHaveLength(2);
    expect(set((p) => p.plan.plats[0]!.alley !== null)).toHaveLength(2);
    expect(set((p) => p.plan.history.firstPlat.basis).length).toBeGreaterThanOrEqual(2);
  });

  it("have block counts, building counts and names that span a real range", () => {
    const blocks = plans.map((p) => p.plan.counts.blocks);
    expect(Math.max(...blocks) - Math.min(...blocks)).toBeGreaterThanOrEqual(10);
    const names = plans.map((p) => p.plan.name);
    expect(names.filter((n, i) => names.indexOf(n) === i).length).toBeGreaterThanOrEqual(30);
    const widths = plans.map((p) => p.plan.plats[0]!.block.along.toFixed(1));
    expect(widths.filter((n, i) => widths.indexOf(n) === i).length).toBeGreaterThanOrEqual(15);
  });

  it("vary the layout itself, not only its numbers: where the mill is, which way the dock end lies, the columns and rows", () => {
    const millSides = new Set<number>();
    const colRows = new Set<string>();
    for (const { plan } of plans) {
      const claim = plan.plats[0]!;
      colRows.add(`${claim.columns}x${claim.rows}`);
      const mill = plan.landmarks.find((l) => l.role === "mill")!;
      const b = plan.buildings[mill.building]!;
      const dx = b.centre.x - claim.origin.x;
      const dz = b.centre.z - claim.origin.z;
      // Which end of the plat the mill stands at, along the plat's own axis.
      const u = (dx * claim.bearing.a + dz * claim.bearing.b) / claim.bearing.c;
      millSides.add(u > (claim.columns * claim.block.along) / 2 ? 1 : -1);
    }
    expect(millSides.size).toBe(2);
    expect(colRows.size).toBeGreaterThanOrEqual(5);
  });
});
