import { describe, expect, it } from "vitest";
import { JUNCTION_FILL, UNIT_STROKE, labelLines, planSvg, sheetSvg } from "../../src/townMap/svg.js";
import { hasPavement } from "../../src/sim/town/junctions.js";
import { townFor } from "./sites.js";

/** Every tag opened is closed, in order (the SVG is made of nested elements and self-closed ones). */
function wellFormed(svg: string): boolean {
  const stack: string[] = [];
  for (const m of svg.matchAll(/<(\/?)([a-zA-Z][\w-]*)([^>]*?)(\/?)>/g)) {
    const [, close, name, , self] = m;
    if (self) continue;
    if (close) {
      if (stack.pop() !== name) return false;
    } else stack.push(name!);
  }
  return stack.length === 0;
}

describe("the plan's SVG", () => {
  const { plan, site } = townFor(4);
  const svg = planSvg(plan, site, { lots: true });

  it("is well formed, with a viewBox and no NaN", () => {
    expect(svg.startsWith("<svg ")).toBe(true);
    expect(svg.endsWith("</svg>")).toBe(true);
    expect(svg).toMatch(/viewBox="0 0 [\d.]+ [\d.]+"/);
    expect(svg).not.toMatch(/NaN|undefined|Infinity/);
    expect(wellFormed(svg)).toBe(true);
  });

  it("labels every landmark, the FBI office most prominently", () => {
    for (const l of plan.landmarks) expect(svg).toContain(l.name.replace(/&/g, "&amp;"));
    const fbi = plan.landmarks.find((l) => l.role === "fbi")!;
    const esc = (t: string): string => t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
    const sizeOf = (name: string): number => {
      const el = svg.split("<text ").find((t) => t.includes(`>${esc(name)}</text>`));
      return Number(/font-size="(\d+)"/.exec(el ?? "")![1]);
    };
    const others = plan.landmarks.filter((l) => l.role !== "fbi").map((l) => sizeOf(l.name));
    expect(sizeOf(fbi.name)).toBeGreaterThan(Math.max(...others));
  });

  it("draws the sea, the highway, the rail, the blocks, the buildings, the seam, the spawn, the scale and the north arrow", () => {
    expect(svg).toContain("#0c1822"); // the sea
    expect(svg).toContain("#9a8d72"); // the highway
    expect((svg.match(/<polygon /g) ?? []).length).toBeGreaterThan(plan.blocks.length + plan.buildings.length);
    expect(svg).toContain("#ff8c2a"); // the seam
    expect(svg).toContain("#3affa0"); // the spawn
    expect(svg).toContain("100 m");
    expect(svg).toContain(">N<");
  });

  it("draws the made ground differently from natural land, and the quay", () => {
    expect(svg).toContain("#3a3a30");
    expect(svg).toContain("#e8e0c8");
    expect((svg.match(/fill="#3a3a30"/g) ?? []).length).toBe(plan.fill.length);
  });

  it("draws the roads out by their surface, each destination as a place with its label, and the made ends", () => {
    expect(plan.roads.length).toBeGreaterThan(0);
    expect(svg).toContain("#7d8084"); // paved
    for (const road of plan.roads) expect(svg).toContain(road.destination.name.replace(/&/g, "&amp;"));
    expect(svg).toContain("#ffcf7a"); // a destination's marker
    expect(plan.ends.filter((e) => e.kind !== "landing").length).toBeGreaterThan(0);
    expect(svg).toMatch(/stroke="#d04040" stroke-width="3"|fill="#8a7a58"/);
    // The view reaches the roads' destinations.
    const vb = /viewBox="0 0 ([\d.]+) ([\d.]+)"/.exec(svg);
    expect(Number(vb?.[1])).toBeGreaterThan(plan.bounds.x1 - plan.bounds.x0);
  });

  it("draws vacant and ruined buildings differently from open ones", () => {
    expect(plan.counts.vacant).toBeGreaterThan(0);
    expect(svg).toContain('fill="url(#vacant)"');
    if (plan.counts.ruin > 0) expect(svg).toContain('fill="url(#ruin)"');
  });

  it("draws the junctions by kind and control, the marked crosswalks and the STOP signs", () => {
    const paved = plan.junctions.filter(hasPavement);
    for (const k of ["four-way", "tee", "highway"] as const) if (paved.some((j) => j.kind === k)) expect(svg).toContain(`fill="${JUNCTION_FILL[k]}" fill-opacity="0.7"`);
    // A red dot with a white rim for each STOP sign, a ring for each all-way stop, a dashed white bar for each marked crosswalk.
    expect((svg.match(/fill="#d02020" stroke="#ffffff"/g) ?? []).length).toBe(paved.reduce((n, j) => n + j.legs.filter((l) => l.stops).length, 0));
    expect((svg.match(/r="12" fill="none" stroke="#d02020"/g) ?? []).length).toBe(paved.filter((j) => j.control === "all-way").length);
    expect((svg.match(/stroke="#ffffff" stroke-width="2.2" stroke-dasharray="1.2 0.9"/g) ?? []).length).toBe(paved.reduce((n, j) => n + j.legs.filter((l) => l.marked && !l.engine).length, 0));
  });

  it("draws each unit's frontage in the colour of its state, its door, and its name and trade when zoomed", () => {
    const units = plan.uses.flatMap((u) => u.units);
    expect(units.length).toBeGreaterThan(40);
    for (const colour of Object.values(UNIT_STROKE)) expect(svg).toContain(`stroke="${colour}" stroke-width="1.1"`);
    expect((svg.match(/stroke="#ffffff" stroke-width="0.7"/g) ?? []).length).toBeGreaterThanOrEqual(units.length);
    const esc = (t: string): string => t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
    expect(svg).toContain(".zoomed .unit-names");
    expect(svg).toContain('<g class="unit-names">');
    for (const u of units.slice(0, 40)) if (u.tenant) expect(svg).toContain(esc(labelLines(u.tenant.name)[0]!));
    // A thumbnail leaves them out.
    expect(planSvg(plan, site, { bare: true })).not.toContain("unit-names");
    expect(wellFormed(svg)).toBe(true);
    expect(labelLines("Halvorsen Hardware")).toEqual(["Halvorsen", "Hardware"]);
    expect(labelLines("LAUNDROMAT")).toEqual(["LAUNDROMAT"]);
  });

  it("escapes names", () => {
    const s = planSvg({ ...plan, name: `A <b> & "c"` }, site, {});
    expect(s).toContain("A &lt;b&gt; &amp; &quot;c&quot;");
    expect(wellFormed(s)).toBe(true);
  });

  it("makes a contact sheet of several towns, each captioned", () => {
    const entries = [1, 2, 3, 4, 5, 6].map((s) => townFor(s));
    const sheet = sheetSvg(entries, 3);
    expect(wellFormed(sheet)).toBe(true);
    for (const e of entries) {
      expect(sheet).toContain(e.plan.name.replace(/&/g, "&amp;").replace(/'/g, "'"));
      expect(sheet).toContain(`seed ${e.plan.seed}`);
    }
  });
});
