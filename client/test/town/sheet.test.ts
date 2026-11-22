import { mkdirSync, writeFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { planSvg, sheetSvg } from "../../src/townMap/svg.js";
import { townFor } from "./sites.js";

/**
 * `TOWN_SHEET_DIR=<dir> npx vitest run test/town/sheet.test.ts` writes `<dir>/sheet.svg` (twelve towns
 * from consecutive seeds side by side) and `<dir>/town-<seed>.svg` for each. Without the variable the
 * test only checks that the functions run.
 */
describe("the contact sheet", () => {
  const FROM = Number(process.env.TOWN_SHEET_FROM ?? "1");
  const entries = Array.from({ length: 12 }, (_, i) => townFor(FROM + i));

  it("is made from twelve towns", () => {
    const sheet = sheetSvg(entries, 4);
    expect(sheet.length).toBeGreaterThan(10_000);
    const dir = process.env.TOWN_SHEET_DIR;
    if (!dir) return;
    mkdirSync(dir, { recursive: true });
    writeFileSync(`${dir}/sheet.svg`, sheet);
    for (let k = 0; k < entries.length; k++) writeFileSync(`${dir}/town-${FROM + k}.svg`, planSvg(entries[k]!.plan, entries[k]!.site, { width: 1000, lots: true }));
    // And single maps of other world seeds, named by TOWN_SHEET_ALSO ("20261121,1,7").
    for (const s of (process.env.TOWN_SHEET_ALSO ?? "").split(",").filter((x) => x !== "")) {
      const t = townFor(Number(s));
      writeFileSync(`${dir}/town-${s}.svg`, planSvg(t.plan, t.site, { width: 1000, lots: true }));
    }
  });
});
