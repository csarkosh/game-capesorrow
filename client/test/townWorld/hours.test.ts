// Opening hours: every trade has them, the owner's examples hold at night, a code survives a 16-bit float, the lights fade at the edge, and the
// town's geometry carries each room's hours in the one float a layered vertex has to spare, and nothing else does.
import "../../src/terrain.js";
import { describe, expect, it } from "vitest";
import { finish } from "@csarkosh/engine/game/syncJobs";
import { sunAltitudeDeg } from "@csarkosh/engine/game/skyWait";
import {
  ALWAYS_CODE, DAWN_HOUR, DUSK_HOUR, FADE_HOURS, NIGHT_BASE, NIGHT_FADE_HOURS, ON_STEPS, OFF_STEPS, TRADES_WITH_HOURS, UNTIL_DAWN, hoursCode, hoursOf, hoursOfCode, isNightCode, isOpen, nightCode, nightShare, nightTimes, openShare, unitHours, type Hours,
} from "../../src/game/town/hours.js";
import { SURFACE_FLOATS } from "../../src/game/town/meshBuilder.js";
import { leftOn } from "../../src/game/town/shopSigns.js";
import { fromHalf, toHalf } from "../../src/game/town/surfacePack.js";
import { NO_LAYER } from "../../src/game/town/townLayers.js";
import { SignAtlas } from "../../src/game/town/signAtlas.js";
import { townGeometry, townGround } from "../../src/game/town/townGeometry.js";
import { HOURS_CODE, townSurfaceCode } from "../../src/game/town/townMaterial.js";
import type { Trade } from "../../src/sim/town/types.js";

const at = (trade: Trade, hour: number, seed = 1): boolean => isOpen(hoursOf(trade, "storefront", seed) as Hours, hour);

describe("night codes", () => {
  it("keep dusk and dawn where the engine's own sun goes under and over 2 degrees", () => {
    expect(Math.abs(sunAltitudeDeg(DUSK_HOUR) + 2)).toBeLessThan(0.1);
    expect(Math.abs(sunAltitudeDeg(DAWN_HOUR) + 2)).toBeLessThan(0.1);
    expect(sunAltitudeDeg(DUSK_HOUR - 0.05)).toBeGreaterThan(sunAltitudeDeg(DUSK_HOUR + 0.05));
    expect(sunAltitudeDeg(DAWN_HOUR + 0.05)).toBeGreaterThan(sunAltitudeDeg(DAWN_HOUR - 0.05));
  });

  it("are whole, under 2048, above the shops' band and exact in a 16-bit float, and round-trip", () => {
    const seen = new Set<number>();
    for (let on = 0; on < ON_STEPS; on++) {
      for (let off = 0; off < OFF_STEPS; off++) {
        const code = nightCode(on, off);
        expect(Number.isInteger(code)).toBe(true);
        expect(code).toBeLessThan(2048);
        expect(code).toBeGreaterThan(ALWAYS_CODE);
        expect(fromHalf(toHalf(code))).toBe(code);
        expect(isNightCode(code)).toBe(true);
        expect(hoursOfCode(code)).toBeNull();
        seen.add(code);
        const t = nightTimes(code);
        expect(t.on).toBeCloseTo(DUSK_HOUR - 0.5 + on / 15, 9);
        expect(t.off).toBeCloseTo(off === UNTIL_DAWN ? DAWN_HOUR + 24 : 20 + off * 0.25, 9);
      }
    }
    expect(seen.size).toBe(ON_STEPS * OFF_STEPS);
    expect(Math.min(...seen)).toBe(NIGHT_BASE);
    for (let open = 0; open < 24; open++) for (let close = 0; close < 24; close++) expect(isNightCode(hoursCode({ open, close }))).toBe(false);
    expect(isNightCode(ALWAYS_CODE)).toBe(false);
    expect(isNightCode(0)).toBe(false);
  });

  it("are dark at noon, lit all night for an until-dawn code, and wrap midnight", () => {
    const dawn = nightCode(10, UNTIL_DAWN);
    expect(nightShare(dawn, 12)).toBe(0);
    expect(nightShare(dawn, 0)).toBe(1);
    expect(nightShare(dawn, 3)).toBe(1);
    expect(nightShare(dawn, 5)).toBe(1);
    expect(nightShare(dawn, 7)).toBe(0);
    expect(nightShare(dawn, 16)).toBe(0);
    const t = nightTimes(dawn);
    expect(nightShare(dawn, t.on)).toBeCloseTo(0.5, 6);
    expect(nightShare(dawn, t.on - NIGHT_FADE_HOURS)).toBeCloseTo(0, 6);
    expect(nightShare(dawn, t.on + NIGHT_FADE_HOURS)).toBeCloseTo(1, 6);
    expect(nightShare(dawn, DAWN_HOUR)).toBeCloseTo(0.5, 6);
    // Off at 23:00 (step 12): lit at 22:30, dark at 23:30 and at 01:00; off at 01:00 (step 20): lit at 00:30, dark at 01:30.
    const eleven = nightCode(5, 12);
    expect(nightShare(eleven, 22.5)).toBe(1);
    expect(nightShare(eleven, 23.5)).toBe(0);
    expect(nightShare(eleven, 1)).toBe(0);
    const one = nightCode(5, 20);
    expect(nightShare(one, 23.99)).toBe(1);
    expect(nightShare(one, 0.5)).toBe(1);
    expect(nightShare(one, 1.5)).toBe(0);
    expect(nightShare(one, 24.5)).toBe(nightShare(one, 0.5));
    // A pair whose off is before its on is never lit.
    const never = nightCode(ON_STEPS - 1, 0);
    for (let h = 0; h < 24; h += 0.25) expect(nightShare(never, h)).toBe(0);
  });

  it("are decoded in the shader from the same constants", () => {
    expect(HOURS_CODE).toContain(`${NIGHT_BASE - 0.5}`);
    expect(HOURS_CODE).toContain(`${2 * NIGHT_FADE_HOURS}`);
    expect(HOURS_CODE).toContain(`${DUSK_HOUR - 0.5}`);
    expect(HOURS_CODE).toContain(`${DAWN_HOUR + 24}`);
    expect(HOURS_CODE).not.toContain("${");
  });
});

describe("a shop's lit sign", () => {
  it("stays on a while after closing for about half the shops when that is in the evening, and never into the small hours", () => {
    let left = 0;
    for (let seed = 0; seed < 400; seed++) {
      const l = leftOn({ open: 9, close: 17 }, seed) as { open: number; close: number };
      expect(l.open).toBe(9);
      expect([17, 18, 19, 20]).toContain(l.close);
      if (l.close !== 17) left++;
      // A tavern's (11 to 2) and a corner store's (6 to midnight) signs are on while they are open, as they shut late; a trade that never shuts keeps its sign on.
      expect(leftOn({ open: 11, close: 2 }, seed)).toEqual({ open: 11, close: 2 });
      expect(leftOn({ open: 6, close: 0 }, seed)).toEqual({ open: 6, close: 0 });
      expect(leftOn("always", seed)).toBe("always");
    }
    expect(left).toBeGreaterThan(120);
    expect(left).toBeLessThan(280);
  });
});

describe("opening hours", () => {
  it("gives every trade a line, and none to a vacant unit", () => {
    const all: Trade[] = ["diner", "tavern", "bank", "gas station", "dry goods", "hat shop", "self storage", "bail bonds"];
    for (const t of all) expect(hoursOf(t, "storefront", 3)).not.toBeNull();
    expect(hoursOf(null, "storefront", 3)).toBeNull();
    expect(TRADES_WITH_HOURS.length).toBeGreaterThan(70);
    // The count of the plan's trades: every `Trade` the plan can give a unit.
    const plan = townGround(20261121).plan;
    for (const use of plan.uses) for (const u of use.units) if (u.tenant !== null) expect(TRADES_WITH_HOURS).toContain(u.tenant.trade);
    for (const t of TRADES_WITH_HOURS) expect(hoursOf(t, "storefront", 9)).not.toBeNull();
  });

  it("holds the owner's examples at 22:00 and in the evening", () => {
    for (let seed = 0; seed < 60; seed++) {
      for (const t of ["tavern", "convenience store", "motel", "gas station"] as const) expect(at(t, 22, seed), t).toBe(true);
      for (const t of ["insurance office", "law office", "bank", "bakery", "clothing"] as const) expect(at(t, 22, seed), t).toBe(false);
      // A unit's own close moves an hour either way: 21:00 is open for most, 20:30 for all.
      expect(at("restaurant", 20.5, seed)).toBe(true);
      expect(at("restaurant", 23, seed)).toBe(false);
    }
  });

  it("keeps a motel or a gas station open in any building of the kind, and a tavern over midnight", () => {
    expect(hoursOf("cafe", "motel", 5)).toBe("always");
    expect(hoursOf("motel", "storefront", 5)).toBe("always");
    for (let seed = 0; seed < 60; seed++) {
      expect(at("tavern", 0.5, seed)).toBe(true);
      expect(at("tavern", 3.5, seed)).toBe(false);
    }
    expect(isOpen({ open: 11, close: 2 }, 1)).toBe(true);
    expect(isOpen({ open: 11, close: 2 }, 3)).toBe(false);
    expect(isOpen({ open: 6, close: 0 }, 23.5)).toBe(true);
    expect(isOpen({ open: 6, close: 0 }, 0.5)).toBe(false);
  });

  it("moves a unit's opening and closing by an hour at most", () => {
    const seen = new Set<number>();
    for (let seed = 0; seed < 400; seed++) {
      const h = hoursOf("bank", "storefront", seed) as { open: number; close: number };
      expect(Math.abs(h.open - 9)).toBeLessThanOrEqual(1);
      expect(Math.abs(h.close - 17)).toBeLessThanOrEqual(1);
      seen.add(h.open);
    }
    expect(seen.size).toBe(3);
  });

  it("round-trips the code for every pair and for always, exactly in a 16-bit float", () => {
    expect(hoursCode(null)).toBe(0);
    expect(hoursOfCode(0)).toBeNull();
    expect(hoursOfCode(hoursCode("always"))).toBe("always");
    expect(fromHalf(toHalf(ALWAYS_CODE))).toBe(ALWAYS_CODE);
    let max = 0;
    for (let open = 0; open < 24; open++) {
      for (let close = 0; close < 24; close++) {
        const code = hoursCode({ open, close });
        max = Math.max(max, code);
        expect(hoursOfCode(code)).toEqual({ open, close });
        expect(fromHalf(toHalf(code))).toBe(code);
        expect(code).toBeLessThan(ALWAYS_CODE);
      }
    }
    expect(max).toBe(576);
  });

  it("is lit well inside the hours, dark well outside and between at the edge", () => {
    const h: Hours = { open: 9, close: 17 };
    expect(openShare(h, 12)).toBe(1);
    expect(openShare(h, 22)).toBe(0);
    expect(openShare(h, 9)).toBeCloseTo(0.5, 6);
    expect(openShare(h, 9 - FADE_HOURS)).toBeCloseTo(0, 6);
    expect(openShare(h, 9 + FADE_HOURS)).toBeCloseTo(1, 6);
    expect(openShare(h, 17)).toBeCloseTo(0.5, 6);
    const over: Hours = { open: 6, close: 0 };
    expect(openShare(over, 23.9)).toBeGreaterThan(0.5);
    expect(openShare(over, 23.9)).toBeLessThan(1);
    expect(openShare(over, 3)).toBe(0);
    expect(openShare("always", 3)).toBe(1);
  });

  it("writes the shader's decode from the module's own constants", () => {
    const code = townSurfaceCode(false);
    expect(code).toContain(HOURS_CODE);
    expect(HOURS_CODE).toContain(`${ALWAYS_CODE - 0.5}`);
    expect(HOURS_CODE).toContain("material.townHour");
    expect(HOURS_CODE).toContain(`${2 * FADE_HOURS}`);
    expect(HOURS_CODE).toContain("24.0");
    expect(HOURS_CODE).not.toContain("${");
  });

  it("lays each room's hours on its layered vertices and nowhere else", () => {
    const ground = townGround(20261121);
    const town = finish(townGeometry(ground, "full", { x: 0, z: 0 }));
    const valid = new Set<number>([0, ALWAYS_CODE]);
    for (let o = 0; o < 24; o++) for (let c = 0; c < 24; c++) valid.add(hoursCode({ open: o, close: c }));
    for (let o = 0; o < ON_STEPS; o++) for (let c = 0; c < OFF_STEPS; c++) valid.add(nightCode(o, c));
    const codes = new Map<number, number>();
    let layered = 0;
    for (const batch of town) {
      const a = batch.arrays;
      for (let i = 0; i < a.positions.length / 3; i++) {
        const layer = a.surface[i * SURFACE_FLOATS] as number;
        const code = a.surface[i * SURFACE_FLOATS + 10] as number;
        if (layer === NO_LAYER) continue;
        layered++;
        expect(valid.has(code)).toBe(true);
        if (code > 0) {
          // Only the standing layer's rooms carry one.
          expect(batch.layer).toBe("solid");
          codes.set(code, (codes.get(code) ?? 0) + 1);
        }
      }
    }
    expect(layered).toBeGreaterThan(1000);
    // Every open unit with hours has its code on some vertices.
    const want = new Set<number>();
    for (const use of ground.plan.uses) {
      const b = ground.plan.buildings.find((x) => x.id === use.building);
      if (b === undefined) continue;
      for (const u of use.units) {
        const code = hoursCode(unitHours(b, u));
        if (code > 0 && u.interior.type !== undefined) want.add(code);
      }
    }
    expect(want.size).toBeGreaterThan(10);
    for (const c of want) expect(codes.has(c), `code ${c}`).toBe(true);
    // And no code that no unit has.
    // (The night codes of lamps and windows are no unit's.)
    for (const c of codes.keys()) if (!isNightCode(c)) expect(want.has(c), `code ${c}`).toBe(true);
  });

  it("lays a lit shop sign's hours on the flat vertices of the sign layer, and a sign of a unit shut for the day has no glow", () => {
    const ground = townGround(20261121);
    const town = finish(townGeometry(ground, "full", { x: 0, z: 0 }, new SignAtlas(2048, 1024, 36)));
    let coded = 0;
    for (const batch of town) {
      if (batch.layer !== "sign") continue;
      const a = batch.arrays;
      for (let i = 0; i < a.positions.length / 3; i++) {
        const code = a.surface[i * SURFACE_FLOATS + 10] as number;
        const glow = a.surface[i * SURFACE_FLOATS + 3] as number;
        // Only a pair or the always code (a sign has no night code), and only on a face that glows.
        if (code > 0) {
          expect(glow).toBeGreaterThan(0);
          expect(isNightCode(code)).toBe(false);
          expect(code).toBeLessThanOrEqual(ALWAYS_CODE);
          coded++;
        }
      }
    }
    expect(coded).toBeGreaterThan(20);
  });
});
