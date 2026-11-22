import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { creditsModel, requiresAttribution, type CreditEntry } from "@csarkosh/engine/game/credits";
import { ENGINE_CREDITS } from "@csarkosh/engine/game/engineCredits";
import { creditsEntries, mergeCredits } from "../../src/game/credits.js";

const OWN_FILE = readFileSync(fileURLToPath(new URL("../../../CREDITS.md", import.meta.url)), "utf8");

const section = (id: string, licence: string): string => `
## ${id}

- **Source:** Work ${id}
- **Author:** Someone
- **Licence:** ${licence}
- **URL:** https://example.invalid/${id}
`;

/** What a row is, apart from its id: the same key `creditsRows` drops a repeated row by. */
const keyOf = (e: CreditEntry): string => JSON.stringify([e.source, e.author, e.url, e.license, e.modified]);

describe("the game's own CREDITS.md", () => {
  it("is a credits file with prose and no entry, so it parses to an empty list", () => {
    expect(OWN_FILE.startsWith("# Credits\n")).toBe(true);
    expect(OWN_FILE).toMatch(/engine/);
    expect(OWN_FILE).toMatch(/Credits screen/);
    expect(OWN_FILE).not.toMatch(/^## /m);
    expect(creditsModel(OWN_FILE)).toEqual([]);
  });

  it("gives an empty list for any file with no entry: prose, a heading with no fields, or nothing at all", () => {
    expect(creditsModel("# Credits\n\nSome prose, and a line of `code`.\n")).toEqual([]);
    expect(creditsModel("")).toEqual([]);
    expect(creditsModel("# Credits\n\n- **Source:** Orphan\n- **Licence:** CC0-1.0\n")).toEqual([]);
    expect(creditsModel("# Credits\n\n## only.a.heading\n")).toEqual([]);
  });
});

describe("the credits the screen shows", () => {
  const engineEntries = creditsModel(ENGINE_CREDITS);

  it("are the engine's alone while the game has none of its own", () => {
    const shown = creditsEntries();
    expect(shown.length).toBeGreaterThan(20);
    expect(shown.map(keyOf).sort()).toEqual([...new Set(engineEntries.map(keyOf))].sort());
  });

  it("hold every work the engine credits", () => {
    const shown = new Set(creditsEntries().map(keyOf));
    for (const entry of engineEntries) expect(shown.has(keyOf(entry)), entry.id).toBe(true);
    // The engine's code of others is among them, with the licence notices those ask for.
    expect(creditsEntries().some((e) => e.id.startsWith("render.") && requiresAttribution(e.license))).toBe(true);
  });

  it("merge the game's entries with the engine's, in the order of the ids, the works whose licence requires a credit first", () => {
    const own = "# Credits\n" + section("zz.own_late", "CC-BY-4.0") + section("aa.own_early", "CC0-1.0") + section("mm.own_middle", "MIT");
    const engine = "# Credits\n" + section("bb.engine_a", "CC0-1.0") + section("yy.engine_b", "Apache-2.0");
    const merged = mergeCredits(own, engine);
    expect(merged.map((e) => e.id)).toEqual(["mm.own_middle", "yy.engine_b", "zz.own_late", "aa.own_early", "bb.engine_a"]);
    // Within each of the two groups the order is that of the ids.
    for (const group of [merged.filter((e) => requiresAttribution(e.license)), merged.filter((e) => !requiresAttribution(e.license))]) {
      const ids = group.map((e) => e.id);
      expect(ids).toEqual([...ids].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)));
    }
    // The real merge keeps the same rule.
    const real = creditsEntries();
    const firstFree = real.findIndex((e) => !requiresAttribution(e.license));
    expect(real.slice(firstFree).every((e) => !requiresAttribution(e.license))).toBe(true);
  });

  it("are the engine's list alone when the game's file has no entry, and the game's alone when the engine's has none", () => {
    expect(mergeCredits(OWN_FILE, ENGINE_CREDITS)).toEqual(creditsEntries());
    expect(mergeCredits("", "")).toEqual([]);
    expect(mergeCredits(section("only.mine", "MIT"), "").map((e) => e.id)).toEqual(["only.mine"]);
  });
});
