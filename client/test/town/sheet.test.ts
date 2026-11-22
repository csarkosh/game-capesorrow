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
    for (const e of entries) writeFileSync(`${dir}/town-${e.plan.seed === 0 ? 0 : FROM + entries.indexOf(e)}.svg`, planSvg(e.plan, e.site, { width: 1600, lots: true }));
  });
});
