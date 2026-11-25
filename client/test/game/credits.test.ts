import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { creditsModel, creditsRows, requiresAttribution, type CreditEntry } from "@csarkosh/engine/game/credits";
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
  const own = creditsModel(OWN_FILE);

  it("is a credits file with prose, and a section for each third-party work the game carries: the town's texture sets (CC0) and the vehicle models and the people", () => {
    expect(OWN_FILE.startsWith("# Credits\n")).toBe(true);
    expect(OWN_FILE).toMatch(/engine/);
    expect(OWN_FILE).toMatch(/Credits screen/);
    // 38 works: the 22 layers of the town's textures, less the shingles the build script makes (21), the 12 vehicle models and the 5 people.
    expect(own.length).toBe(38);
    const textures = own.filter((e) => e.id.startsWith("town."));
    expect(textures.length).toBe(21);
    for (const e of textures) {
      expect(e.license, e.id).toBe("CC0-1.0");
      expect(e.author.length, e.id).toBeGreaterThan(0);
      expect(e.url, e.id).toMatch(/^https:\/\/[a-z.]+\/a\/[A-Za-z0-9_]+$/);
      expect(e.source, e.id).toMatch(/^[^:]+: .+/);
    }
    // The models: eleven under Creative Commons Attribution, each saying what was changed, and the dust-sheet car CC0.
    const models = own.filter((e) => e.id.startsWith("vehicle."));
    expect(models.length).toBe(12);
    for (const e of models) {
      expect(e.license, e.id).toBe(e.id === "vehicle.covered" ? "CC0-1.0" : "CC-BY-4.0");
      expect(e.author.length, e.id).toBeGreaterThan(0);
      expect(e.url, e.id).toMatch(/^https:\/\//);
      expect(e.modified, e.id).toBe(true);
    }
    const people = own.filter((e) => e.id.startsWith("person."));
    expect(people.length).toBe(5);
    for (const e of people) {
      expect(e.license, e.id).toBe("CC-BY-4.0");
      expect(e.author, e.id).toBe("Renderpeople");
      expect(e.modified, e.id).toBe(true);
    }
    expect(own.length).toBe(textures.length + models.length + people.length);
    expect(new Set(own.map((e) => e.id)).size).toBe(own.length);
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

  it("are the engine's and the game's own, as one list", () => {
    const shown = creditsEntries();
    expect(shown.length).toBeGreaterThan(20);
    expect(shown.map(keyOf).sort()).toEqual([...new Set([...engineEntries, ...creditsModel(OWN_FILE)].map(keyOf))].sort());
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
    expect(mergeCredits("# Credits\n", ENGINE_CREDITS).length).toBe(creditsRows(engineEntries).length);
    expect(mergeCredits("", "")).toEqual([]);
    expect(mergeCredits(section("only.mine", "MIT"), "").map((e) => e.id)).toEqual(["only.mine"]);
  });
});
