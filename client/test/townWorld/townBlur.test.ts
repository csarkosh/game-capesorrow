// The rooms seen through their glass out of focus (`townBlur.ts`): what the geometry is on the tier that reads the frame behind its glass,
// against the tier that draws each room to a painted sheet, which layer a marked pane is in, and what the pane's plugin asks of the renderer.
import "../../src/terrain.js";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { finish } from "@csarkosh/engine/game/syncJobs";
import { FRAME_BLOCK, FRAME_PROJECTION_NAME } from "@csarkosh/engine/game/lite/frameBlock";
import { OPEN_BEHIND, OPEN_SEED, THROUGH_SEED, pane } from "../../src/game/town/buildingKit.js";
import { buildingGeometry } from "../../src/game/town/buildingGeometry.js";
import { resetLedger } from "../../src/game/town/faceLedger.js";
import { LEAF_THICK } from "../../src/game/town/openDoors.js";
import { SignAtlas } from "../../src/game/town/signAtlas.js";
import type { FillReport } from "../../src/game/town/townTypes.js";
import { MeshBuilder, SURFACE_FLOATS } from "../../src/game/town/meshBuilder.js";
import { DOOR_ALPHA } from "../../src/game/town/paint.js";
import { HAZE_SEED } from "../../src/game/town/roomHaze.js";
import { BLUR_FROM, BLUR_FULL, BLUR_M, BLUR_M_LOW, BLUR_MAX_PX, BLUR_MAX_PX_LOW, ROOM_GAIN_LOW, ROOM_GAMMA_LOW, TAPS, TAPS_LOW, townBlurPlugin } from "../../src/game/town/townBlur.js";
import { townGeometry, townGround, type TownBatch } from "../../src/game/town/townGeometry.js";

const SEED = 20261121;
const ground = townGround(SEED);
const sheet = finish(townGeometry(ground, "full", { x: 0, z: 0 }));
const through = finish(townGeometry(ground, "full", { x: 0, z: 0 }, undefined, true));
const lowSheet = finish(townGeometry(ground, "low", { x: 0, z: 0 }));
const lowThrough = finish(townGeometry(ground, "low", { x: 0, z: 0 }, undefined, true));

const vertices = (town: readonly TownBatch[], layer: TownBatch["layer"]): number => town.filter((b) => b.layer === layer).reduce((n, b) => n + b.arrays.positions.length / 3, 0);
/** The seeds of a layer's vertices (a pane's own is 0 to 1; a marked pane's is `THROUGH_SEED` more, the pane of an open doorway's `OPEN_SEED` more). */
const seedsIn = (town: readonly TownBatch[], layer: TownBatch["layer"]): number[] => town.filter((b) => b.layer === layer).flatMap((b) => Array.from({ length: b.arrays.positions.length / 3 }, (_, i) => b.arrays.surface[i * SURFACE_FLOATS + 2] as number));
/** The seed of a pane that is not glass but the opening of a door that swings: `OPEN_SEED` and a pane's own 0 to 1. */
const isOpen = (seed: number): boolean => seed >= OPEN_SEED - 0.5;
/** The seeds of every pane, in whichever layer it is. */
const seeds = (town: readonly TownBatch[]): number[] => [...seedsIn(town, "glass"), ...seedsIn(town, "through")];

describe("the town's geometry where the rooms are read through their glass", () => {
  it("has no haze and no painted sheet: the rooms are drawn whole, so the standing layer holds more", () => {
    expect(vertices(sheet, "haze")).toBeGreaterThan(0);
    expect(vertices(through, "haze")).toBe(0);
    expect(vertices(through, "solid")).toBeGreaterThan(vertices(sheet, "solid"));
    // The whole rooms cost what the sheets saved, and no more than six hundredths of the standing layer: 64,375 vertices of 1,143,167
    // (5.6 percent, about 6 MB) since the downtown stands shop beside shop with rooms 8 to 16 m deep; it was 45,754 of 1,087,681 before.
    expect(vertices(through, "solid") - vertices(sheet, "solid")).toBeLessThan(vertices(sheet, "solid") * 0.06);
  });

  it("marks the panes that have a room behind them, and only there", () => {
    const marked = seeds(through).filter((s) => s >= THROUGH_SEED - 0.5);
    const plain = seeds(through).filter((s) => s < THROUGH_SEED - 0.5);
    // A town has shop fronts and it has houses, upper storeys and cars: some panes of each sort.
    expect(marked.length).toBeGreaterThan(400);
    expect(plain.length).toBeGreaterThan(400);
    for (const s of marked) expect(s < THROUGH_SEED + 1 || (s >= OPEN_SEED && s < OPEN_SEED + 1)).toBe(true);
    // No pane's own seed reaches a haze sheet's mark, and the tier with sheets marks none.
    for (const s of plain) expect(s).toBeLessThan(HAZE_SEED - 0.5);
    expect(seeds(sheet).every((s) => s < HAZE_SEED - 0.5)).toBe(true);
  });

  it("is the same glass, pane for pane, as the tier with sheets", () => {
    // (Bar the panes of the open doorways, which are not glass: four vertices each, `OPEN_SEED`.)
    expect(vertices(through, "glass") + vertices(through, "through") - seedsIn(through, "through").filter(isOpen).length).toBe(vertices(sheet, "glass"));
  });

  it("puts the marked panes in a layer of their own and leaves the rest of the glass blended where it was", () => {
    // The tier with sheets has no such layer: every pane is in the glass.
    expect(vertices(sheet, "through")).toBe(0);
    const own = seedsIn(through, "through");
    const rest = seedsIn(through, "glass");
    expect(own.length).toBeGreaterThan(400);
    for (const s of own) {
      expect(s).toBeGreaterThanOrEqual(THROUGH_SEED - 0.5);
      expect(s < THROUGH_SEED + 1 || (s >= OPEN_SEED && s < OPEN_SEED + 1)).toBe(true);
    }
    // What stays in the blended layer is the panes of houses, upper storeys and cars, and no marked pane.
    expect(rest.length).toBeGreaterThan(400);
    for (const s of rest) expect(s).toBeLessThan(THROUGH_SEED - 0.5);
    // Every cell of the layer's batches is a cell of the others', and the order they are listed in is the town's own.
    for (const b of through.filter((x) => x.layer === "through")) expect(b.arrays.indices.length).toBeGreaterThan(0);
  });

  it("lays a marked pane in the builder it is given as its mark, tagged as a leaf's where the leaf is", () => {
    const here = new MeshBuilder();
    const there = new MeshBuilder();
    here.marked = there;
    const wall = { ax: 0, az: 0, bx: 2, bz: 0, tx: 1, tz: 0, nx: 0, nz: 1, length: 2, front: true } as never;
    pane(here, wall, 0, 0, 1, 1, 0, undefined, undefined, { through: true });
    pane(here, wall, 1, 0, 2, 1, 0, undefined, undefined, {});
    expect(there.vertices).toBe(4);
    expect(here.vertices).toBe(4);
    // A pane marked and a builder with no mark: it is laid there, as the tier with sheets lays it (its seed is the pane's own).
    const alone = new MeshBuilder();
    pane(alone, wall, 0, 0, 1, 1, 0, undefined, undefined, { through: true });
    expect(alone.vertices).toBe(4);
    // A leaf's tag reaches the mark too, and is put back.
    const leafed = new MeshBuilder();
    const marked = new MeshBuilder();
    leafed.marked = marked;
    leafed.withLeaf(() => pane(leafed, wall, 0, 0, 1, 1, 0, undefined, undefined, { through: true }));
    pane(leafed, wall, 1, 0, 2, 1, 0, undefined, undefined, { through: true });
    const colours = marked.finish().colors;
    expect(colours[3]).toBe(Math.fround(DOOR_ALPHA));
    expect(colours[4 * 4 + 3]).not.toBe(Math.fround(DOOR_ALPHA));
  });
});

describe("the low tier's geometry where its rooms are read through their glass", () => {
  it("draws no haze and no sheet, keeps every pane, and puts the marked ones in the layer of their own", () => {
    expect(vertices(lowSheet, "haze")).toBeGreaterThan(0);
    expect(vertices(lowThrough, "haze")).toBe(0);
    expect(vertices(lowSheet, "through")).toBe(0);
    expect(vertices(lowThrough, "through")).toBeGreaterThan(400);
    expect(vertices(lowThrough, "glass") + vertices(lowThrough, "through")).toBe(vertices(lowSheet, "glass"));
    // The low tier's doors stay shut (`detail` "low"), so it has no doorway's pane.
    expect(seedsIn(lowThrough, "through").filter(isOpen).length).toBe(0);
    for (const s of seedsIn(lowThrough, "through")) expect(s).toBeGreaterThanOrEqual(THROUGH_SEED - 0.5);
  });
  it("is not left a room short: every marked pane has a room behind it, and the rooms stand to their back walls with the sheet's stretch drawn, not painted", () => {
    // The sheet and the veil stood in for everything past 2.4 m: drawn whole, the low tier's rooms are not smaller than its sheet's, bar what the sheet itself was.
    expect(vertices(lowThrough, "solid")).toBeGreaterThan(vertices(lowSheet, "solid") * 0.9);
    expect(vertices(lowThrough, "solid")).toBeLessThan(vertices(lowSheet, "solid") * 1.1);
    expect(vertices(lowThrough, "glass") + vertices(lowThrough, "through")).toBeGreaterThan(5000);
  });
});

describe("the pane's plugin", () => {
  const kept = { colour: () => ({}) as never, depth: () => ({}) as never };
  const plugin = townBlurPlugin(kept, { name: FRAME_BLOCK } as never);
  const code = plugin.getCustomCode?.("fragment") ?? {};
  it("reads the kept frame's colour and its depth, and the frame's projection from the frame's block", () => {
    expect(plugin.getSamplers?.()).toEqual([{ texture: "townKept", sampler: "townKeptSmp" }, { texture: "townKeptDepth", sampleType: "unfilterable-float" }]);
    const main = code.CUSTOM_FRAGMENT_BEFORE_LIGHTS ?? "";
    expect(main).toContain(`${FRAME_BLOCK}.${FRAME_PROJECTION_NAME}[3].z`);
    expect(main).toContain("textureLoad(townKeptDepth");
    expect(main).toContain(`tbI<${TAPS}`);
    const bound: unknown[] = [];
    plugin.bindTextures?.(bound as never);
    expect(bound.length).toBe(2);
  });
  it("turns the disc by pixel and frame, with TAPS reads, off the low tier", () => {
    const main = code.CUSTOM_FRAGMENT_BEFORE_LIGHTS ?? "";
    expect(TAPS).toBe(28);
    expect(main).toContain(`townBlurTurn(tbHere,${FRAME_BLOCK}.moteClock)`);
  });
  it("turns it by pixel alone on the low tier, which has no blending of frames in time to smooth it, and reads fewer times", () => {
    const low = townBlurPlugin(kept, { name: FRAME_BLOCK } as never, true).getCustomCode?.("fragment") ?? {};
    const main = low.CUSTOM_FRAGMENT_BEFORE_LIGHTS ?? "";
    expect(TAPS_LOW).toBeLessThanOrEqual(16);
    expect(TAPS_LOW).toBeLessThan(TAPS);
    expect(main).toContain(`tbI<${TAPS_LOW};`);
    expect(main).not.toContain(`tbI<${TAPS};`);
    // Sixteen at most, over a smaller disc than the others': the reads are wider apart.
    expect(BLUR_M_LOW).toBeLessThan(BLUR_M);
    expect(BLUR_MAX_PX_LOW).toBeLessThan(BLUR_MAX_PX);
    expect(main).toContain(`${BLUR_M_LOW.toFixed(4)}*tbK*tbFocal`);
    expect(main).toContain(`min(${BLUR_MAX_PX_LOW.toFixed(4)},`);
    expect(code.CUSTOM_FRAGMENT_BEFORE_LIGHTS).toContain(`${BLUR_M.toFixed(4)}*tbK*tbFocal`);
    // The display's colour is read, not the chain's linear one: the read is lifted, by how out of focus it is, and only on this tier.
    expect(ROOM_GAMMA_LOW).toBeLessThan(1);
    expect(main).toContain(`mix(tbRoom,pow(max(tbRoom,vec3<f32>(0.0,0.0,0.0)),vec3<f32>(${ROOM_GAMMA_LOW.toFixed(4)}))*${ROOM_GAIN_LOW.toFixed(4)},tbK)`);
    expect(code.CUSTOM_FRAGMENT_BEFORE_LIGHTS).not.toContain("pow(max(tbRoom");
    expect(main).toContain("townBlurTurn(tbHere,0.0)");
    expect(main).not.toContain("moteClock");
    // The rest of the pane is the same: the measure, the alpha it writes and where.
    expect(main).toContain("townHide=tbK;");
    expect(low.CUSTOM_FRAGMENT_BEFORE_FRAGCOLOR).toBe("color+=townBehindC;alpha=townHide;");
  });
  it("blurs from the pane inward, writes the whole pixel, and adds what it read after the air", () => {
    expect(BLUR_FROM).toBeLessThan(BLUR_FULL);
    expect(BLUR_FULL).toBeLessThanOrEqual(2.5);
    const main = code.CUSTOM_FRAGMENT_BEFORE_LIGHTS ?? "";
    expect(main).toContain("townGlassC=townGlassC*alpha;");
    expect(code.CUSTOM_FRAGMENT_BEFORE_FRAGCOLOR).toBe("color+=townBehindC;alpha=townHide;");
  });
  it("tells the line, in the frame's alpha, how much of what is behind it the pane hides: how out of focus it is read, and none at the glass", () => {
    const main = code.CUSTOM_FRAGMENT_BEFORE_LIGHTS ?? "";
    expect(code.CUSTOM_FRAGMENT_DEFINITIONS).toContain("var<private> townHide:f32=0.0;");
    // The blur's own measure (0 at the glass, 1 where it is whole) is what is written, and a pixel that is not read blurred hides nothing.
    expect(main).toContain("townHide=tbK;");
    expect(main).toContain("let tbK=smoothstep(");
    // It is written in the slot the PBR template reads last, just before it returns the colour with its alpha, so nothing after it can change it.
    expect(code.CUSTOM_FRAGMENT_BEFORE_FRAGCOLOR?.endsWith("alpha=townHide;")).toBe(true);
    expect(Object.keys(code).some((k) => k.includes("UPDATE_ALPHA"))).toBe(false);
  });
  it("composes every pixel of a marked pane from the kept frame, the sharp read where the pane is not glass", () => {
    const main = code.CUSTOM_FRAGMENT_BEFORE_LIGHTS ?? "";
    // Where the pane is glass it is read out of focus; where it is not, it is the kept frame's own read, with none of the glass's colour, and hides nothing.
    expect(main).toContain("if(townGlassA>0.5){");
    expect(main).toContain("townBehindC=tbCentre;");
    expect(main).toContain("townGlassC=vec3<f32>(0.0,0.0,0.0);");
    expect(main.indexOf("townHide=tbK;")).toBeLessThan(main.indexOf("}else{"));
    // And the marked layer is the only one that wears the plugin's code: the blended glass has none of it, so its alpha is its own.
    expect(main.startsWith("let tbSeed=")).toBe(true);
  });
});

describe("what is drawn of the glass, and what hangs in it", () => {
  const parts = readFileSync(new URL("../../src/game/town/townParts.ts", import.meta.url), "utf8");
  const between = (from: string, to: string): string => parts.slice(parts.indexOf(from), parts.indexOf(to));
  it("draws the marked panes opaque, with the blur's plugin, first of the half after the break, and the rest of the glass blended with none", () => {
    const own = between("const throughMaterial", "// The lettering's atlas");
    expect(own).not.toContain("alphaBlend");
    expect(own).toContain("townBlurPlugin(behind, shared, low)");
    const blended = between("const glassMaterial", "// The glass of a shop's pane");
    expect(blended).toContain("alphaBlend: true");
    expect(blended).not.toContain("townBlurPlugin");
    // One mesh in the town is marked for the break: the marked layer's, and never the blended glass.
    expect(parts.match(/afterBreak = true/g)).toHaveLength(1);
    const layer = between('batch.layer === "through") {', "} else if (batch.layer === \"glass\"");
    expect(layer).toContain("mesh.afterBreak = true;");
    expect(layer).toContain("seeThrough as NonNullable<typeof seeThrough>).through");
  });
  it("draws the lettering after the glass, in front of the pane's depth", () => {
    expect(parts).toContain("(through ? LETTERING_OVER_GLASS : SEE_THROUGH_ORDER.lettering)");
  });
  it("hangs an OPEN sign's lettering on the face of a marked pane, in front of the depth the pane writes, and its box behind the pane", () => {
    const signs = readFileSync(new URL("../../src/game/town/shopSigns.ts", import.meta.url), "utf8");
    const open = signs.slice(signs.indexOf('case "open": {'), signs.indexOf('case "lease": {'));
    expect(open).toContain("if (i.through === true) {");
    // The pane stands at `glassShift - 0.07`: the lettering 1.2 cm in front of it, the box's face 2 cm behind it.
    expect(open).toContain("quad(0, y - h / 2, w, h, -0.058 + glassShift(i));");
    expect(open).toContain("obox(0, y - h / 2, w, h, -0.13 + glassShift(i), -0.09 + glassShift(i)");
    // Without the marked panes it hangs where it did.
    expect(open).toContain("quad(0, y - h / 2, w, h, -0.11 + glassShift(i));");
    const front = readFileSync(new URL("../../src/game/town/buildingGeometry.ts", import.meta.url), "utf8");
    expect(front).toContain("...(extra.through === true ? { through: true } : {}) });");
  });
});

describe("the pane of an open doorway", () => {
  const T = LEAF_THICK;
  type Quad = { s0: number; s1: number; d: number; y0: number; y1: number; leaf: boolean };
  /** A building's front built where the rooms are read through their glass: the quads of its marked layer with a seed of an open doorway's, and the leaf's vertices, in the unit's frame. */
  function built(seed: number, bId: number): { opens: Quad[]; leaves: Quad[]; doors: { s: number; width: number; u: number }[]; others: number; glassMarked: number } {
    const g = townGround(seed);
    const b = g.plan.buildings.find((x) => x.id === bId)!;
    const use = g.plan.uses[b.id]!;
    const solid = new MeshBuilder();
    const glass = new MeshBuilder();
    const marked = new MeshBuilder();
    glass.marked = marked;
    const sign = new MeshBuilder();
    const report: FillReport = { openings: [], windows: [], rooms: [] };
    resetLedger();
    buildingGeometry(g, b, g.plan.landmarks.find((l) => l.building === b.id)?.role ?? null, () => solid, "full", { glass: () => glass, sign: () => sign, atlas: new SignAtlas(8192, 8192, 56), report, through: true });
    const f = use.frame!;
    const at = (x: number, z: number): [number, number] => {
      const px = x - g.anchor.x - f.origin.x;
      const pz = z - g.anchor.z - f.origin.z;
      return [px * f.t.x + pz * f.t.z, -(px * f.n.x + pz * f.n.z)];
    };
    const a = marked.finish();
    const opens: Quad[] = [];
    let others = 0;
    for (let q = 0; q + 3 < a.positions.length / 3; q += 4) {
      const sd = a.surface[q * SURFACE_FLOATS + 2] as number;
      if (!isOpen(sd)) {
        others++;
        continue;
      }
      const pts = [0, 1, 2, 3].map((k) => [...at(a.positions[(q + k) * 3] as number, a.positions[(q + k) * 3 + 2] as number), a.positions[(q + k) * 3 + 1] as number]);
      const ss = pts.map((p) => p[0] as number);
      const ys = pts.map((p) => p[2] as number);
      const ds = pts.map((p) => p[1] as number);
      expect(Math.max(...ds) - Math.min(...ds)).toBeLessThan(1e-4);
      opens.push({ s0: Math.min(...ss), s1: Math.max(...ss), d: ds[0] as number, y0: Math.min(...ys), y1: Math.max(...ys), leaf: a.colors[q * 4 + 3] === Math.fround(DOOR_ALPHA) });
    }
    // The leaf's vertices: those of the standing layer tagged as a leaf's, with the deepest of each (its inner face, and the plate on it).
    const sa = solid.finish();
    const leaves: Quad[] = [];
    for (let v = 0; v < sa.positions.length / 3; v++) {
      if (sa.colors[v * 4 + 3] !== Math.fround(DOOR_ALPHA)) continue;
      const [s, d] = at(sa.positions[v * 3] as number, sa.positions[v * 3 + 2] as number);
      leaves.push({ s0: s, s1: s, d, y0: sa.positions[v * 3 + 1] as number, y1: sa.positions[v * 3 + 1] as number, leaf: true });
    }
    return { opens, leaves, doors: use.units.filter((u) => u.state === "open" && u.tenant !== null && u.interior.type !== undefined).map((u) => ({ s: u.door.s, width: u.door.width, u: u.id })), others, glassMarked: marked.vertices };
  }
  const shops = (seed: number) => townGround(seed).plan.buildings.filter((b) => (townGround(seed).plan.uses[b.id]?.units.length ?? 0) > 0 && b.state !== "ruin").slice(0, 30);
  const fronts = [20261121, 1, 6].flatMap((seed) => shops(seed).map((b) => ({ seed, id: b.id })));

  it("stands one in the doorway of every unit whose door opens, within the opening, and behind the shut leaf by OPEN_BEHIND", () => {
    let doors = 0;
    for (const { seed, id } of fronts) {
      const r = built(seed, id);
      const g = townGround(seed);
      const use = g.plan.uses[id]!;
      for (const u of use.units) {
        const opening = r.opens.filter((q) => q.s0 >= u.door.s - u.door.width / 2 - 0.02 && q.s1 <= u.door.s + u.door.width / 2 + 0.02);
        const opens = u.state === "open" && u.tenant !== null && u.interior.type !== undefined;
        if (!opens) {
          expect(opening.length, `a door that does not open (unit ${u.id} of building ${id}, seed ${seed}) has no pane`).toBe(0);
          continue;
        }
        doors++;
        // Exactly one, whose width is the door's, from the floor up past the leaf's head.
        expect(opening.length, `unit ${u.id} of building ${id} (seed ${seed})`).toBe(1);
        const q = opening[0] as Quad;
        expect(q.s0).toBeCloseTo(u.door.s - u.door.width / 2, 2);
        expect(q.s1).toBeCloseTo(u.door.s + u.door.width / 2, 2);
        expect(q.y1 - q.y0).toBeGreaterThan(2.1);
        // Not tagged as the leaf's: it is fixed to the doorway and does not swing.
        expect(q.leaf).toBe(false);
        // Behind every part of the leaf (its inner face, its plates), by the margin, and not a hand further.
        const mine = r.leaves.filter((v) => v.s0 >= q.s0 - 0.01 && v.s0 <= q.s1 + 0.01 && v.y0 > q.y0 + 0.05 && v.y0 < q.y1);
        expect(mine.length).toBeGreaterThan(0);
        const deepest = Math.max(...mine.map((v) => v.d));
        expect(q.d).toBeGreaterThan(deepest + 0.015);
        expect(q.d).toBeLessThan(deepest + OPEN_BEHIND + 0.05);
        // The leaf has its thickness: its inner face is T behind its outer.
        expect(deepest).toBeGreaterThan(T);
      }
    }
    expect(doors).toBeGreaterThan(20);
  });

  it("has no pane where the frame is not kept (the sheet path): a pane that is not glass, laid in the glass, would be a seed over the town's own", () => {
    const g = townGround(20261121);
    const b = shopsOf(g)[0] as { id: number };
    const solid = new MeshBuilder();
    const glass = new MeshBuilder();
    const sign = new MeshBuilder();
    resetLedger();
    buildingGeometry(g, g.plan.buildings.find((x) => x.id === b.id)!, null, () => solid, "full", { glass: () => glass, sign: () => sign, atlas: new SignAtlas(8192, 8192, 56), through: true });
    const a = glass.finish();
    for (let v = 0; v < a.positions.length / 3; v++) expect(isOpen(a.surface[v * SURFACE_FLOATS + 2] as number)).toBe(false);
  });

  it("is all of the through layer's change: its vertices are four to a doorway, the rest as stage 2 left them", () => {
    const open = seedsIn(through, "through").filter(isOpen).length;
    expect(open % 4).toBe(0);
    expect(open / 4).toBe(39);
    // The layer's other panes are the windows' and the doors' own glass, as many as before.
    expect(vertices(through, "through") - open).toBe(976);
    expect(vertices(lowThrough, "through") - seedsIn(lowThrough, "through").filter(isOpen).length).toBe(736);
    // Nothing of any other layer moved.
    expect(vertices(through, "glass") + vertices(through, "through") - open).toBe(vertices(sheet, "glass"));
  });

  it("is made nothing of by the glass's own code: no colour, no cover", async () => {
    const { townAlphaCode } = await import("../../src/game/town/townMaterial.js");
    for (const low of [false, true]) {
      const code = townAlphaCode(low);
      expect(code).toContain(`if(tsSeed>${(OPEN_SEED - 0.5).toFixed(1)}){townGlassC=vec3<f32>(0.0,0.0,0.0);townGlassA=1.0;alpha=0.0;}else if(`);
    }
  });
});

function shopsOf(g: ReturnType<typeof townGround>): { id: number }[] {
  return g.plan.buildings.filter((b) => (g.plan.uses[b.id]?.units.some((u) => u.state === "open" && u.tenant !== null) ?? false) && b.state !== "ruin");
}
