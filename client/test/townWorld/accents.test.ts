import { describe, expect, it } from "vitest";
import { ACCENT_FAMILIES, ACCENT_MAX_SATURATION, ACCENT_SHARE, accentFamily, accentOf, blockFamily, displaySaturation, signColours } from "../../src/game/town/accents.js";

const IDS = Array.from({ length: 600 }, (_, k) => k * 7919 + 13);

describe("accent colours", () => {
  it("are deterministic from a block and an id", () => {
    for (const id of IDS.slice(0, 100)) expect(accentOf(4, id, 481)).toEqual(accentOf(4, id, 481));
  });

  it("go to a rationed share of things, near ACCENT_SHARE", () => {
    const n = IDS.filter((id) => accentOf(3, id, 481) !== null).length / IDS.length;
    expect(n).toBeGreaterThan(0.2);
    expect(n).toBeLessThan(0.36);
    expect(Math.abs(n - ACCENT_SHARE)).toBeLessThan(0.08);
  });

  it("are all faded: displayed saturation within the bound", () => {
    for (const salt of [430, 440, 481]) {
      for (const id of IDS) {
        const c = accentOf(id % 9, id, salt);
        if (c !== null) expect(displaySaturation(c)).toBeLessThanOrEqual(ACCENT_MAX_SATURATION);
      }
    }
    for (const f of ACCENT_FAMILIES) expect(displaySaturation(f)).toBeLessThanOrEqual(ACCENT_MAX_SATURATION);
  });

  it("let one family lead a block, and differ between blocks", () => {
    const leaders = new Set<number>();
    for (let block = 0; block < 12; block++) {
      const counts = [0, 0, 0];
      for (const id of IDS) {
        const f = accentFamily(block, id, 481);
        if (f >= 0) counts[f]!++;
      }
      const total = counts[0]! + counts[1]! + counts[2]!;
      const lead = counts.indexOf(Math.max(...counts));
      expect(counts[lead]! / total).toBeGreaterThan(0.65);
      expect(lead).toBe(blockFamily(block));
      leaders.add(lead);
    }
    expect(leaders.size).toBe(3);
  });

  it("vary from one instance to the next", () => {
    const seen = new Set(IDS.map((id) => accentOf(2, id, 481)).filter((c) => c !== null).map((c) => Array.from(c as readonly number[]).map((v) => v.toFixed(3)).join()));
    expect(seen.size).toBeGreaterThan(40);
  });
});

describe("sign colours", () => {
  const base = { bg: [200, 30, 30], fg: [250, 245, 235], accent: [30, 60, 140] } as const;
  it("leave an OPEN sign alone, fade the rest, and accent a share of grounded ones", () => {
    expect(signColours(base, "open", 1, 5)).toEqual(base);
    let accented = 0;
    for (const id of IDS) {
      const s = signColours(base, "fascia", 3, id);
      if (s.bg[0] !== Math.round(base.bg[0] + (0.2126 * 200 + 0.7152 * 30 + 0.0722 * 30 - base.bg[0]) * 0.45)) accented++;
    }
    expect(accented / IDS.length).toBeGreaterThan(0.2);
    expect(accented / IDS.length).toBeLessThan(0.36);
    expect(signColours(base, "glass", 3, 9).bg).toEqual(signColours(base, "glass", 3, 9).bg);
  });
});
