import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { LANDING_STYLE, TITLE_CREAM } from "../../src/game/landing.js";
import { TITLE } from "../../src/game/words.js";

const SOURCE = readFileSync(fileURLToPath(new URL("../../src/game/landing.ts", import.meta.url)), "utf8")
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .replace(/^\s*\/\/.*$/gm, "");

/** The declarations of the first rule whose selector is exactly `selector`, within `css`. */
const rule = (css: string, selector: string): string => {
  const at = css.indexOf(`${selector} {`);
  if (at < 0) return "";
  return css.slice(at, css.indexOf("}", at));
};

describe("the title page's title", () => {
  it("is very large and cream, and breaks anywhere rather than overflow", () => {
    expect(TITLE_CREAM).toBe("#ede4cc");
    const h1 = rule(LANDING_STYLE, ".landing h1");
    expect(h1).toContain("font-size: clamp(2.6rem, 9vw, 6rem)");
    expect(h1).toContain(`color: ${TITLE_CREAM}`);
    expect(h1).toContain("overflow-wrap: anywhere");
    expect(h1).toContain("line-height: 1.05");
    expect(h1).toContain("text-transform: uppercase");
    expect(h1).toContain("letter-spacing");
  });

  it("is smaller on a phone", () => {
    const phone = LANDING_STYLE.slice(LANDING_STYLE.indexOf("max-width: 480px"));
    expect(rule(phone, "    .landing h1")).toContain("font-size: clamp(2rem, 11vw, 3rem)");
  });
});

describe("the title page's content", () => {
  it("sets the h1 to the title, and carries no blurb", () => {
    expect(SOURCE).toContain("title.textContent = TITLE");
    expect(SOURCE).not.toMatch(/BLURB|dread/);
    expect(LANDING_STYLE).not.toContain("dread");
    expect(TITLE).toBe("Something’s Haunting Port Ashton");
  });
});
