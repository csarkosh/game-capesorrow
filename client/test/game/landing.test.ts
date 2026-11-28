import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { LANDING_STYLE, TITLE_CREAM } from "../../src/game/landing.js";
import { TITLE, TITLE_LEAD, TITLE_NAME } from "../../src/game/words.js";

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
  it("is cream, the lead small on one line above the name", () => {
    expect(TITLE_CREAM).toBe("#ede4cc");
    const h1 = rule(LANDING_STYLE, ".landing h1");
    expect(h1).toContain(`color: ${TITLE_CREAM}`);
    expect(h1).toContain("flex-direction: column");
    expect(h1).toContain("text-transform: uppercase");
    const lead = rule(LANDING_STYLE, ".landing h1 .title-lead");
    expect(lead).toContain("white-space: nowrap");
    expect(lead).toContain("letter-spacing: 0.06em");
  });

  it("draws the name very large and tall, set tight, with room for its stretch", () => {
    const name = rule(LANDING_STYLE, ".landing h1 .title-name");
    expect(name).toContain("font-size: clamp(2.6rem, 9vw, 6rem)");
    expect(name).toContain("transform: scaleY(1.6)");
    // The transform leaves the layout box as it is: the margins are (1.6 - 1) / 2 of the line above and below.
    expect(name).toContain("margin: 0.3em 0");
    expect(name).toContain("letter-spacing: 0.02em");
    expect(name).toContain("overflow-wrap: anywhere");
  });

  it("is smaller on a phone", () => {
    const phone = LANDING_STYLE.slice(LANDING_STYLE.indexOf("max-width: 480px"));
    expect(rule(phone, "    .landing h1 .title-name")).toContain("font-size: clamp(2rem, 11vw, 3rem)");
    expect(rule(phone, "    .landing h1 .title-lead")).toContain("font-size");
  });
});

describe("the title page's controls", () => {
  it("are slabs of solid cream with dark labels, Play and the secondary buttons alike", () => {
    expect(TITLE_CREAM).toBe("#ede4cc");
    expect(LANDING_STYLE).toContain("--btn-solid: rgb(237, 228, 204)");
    expect(LANDING_STYLE).not.toMatch(/198, 222, 222|214, 234, 234|#eaf1f1/);
    const button = rule(LANDING_STYLE, ".landing button");
    expect(button).toContain("background-color: var(--btn-solid)");
    expect(button).toContain("color: #0c0f11");
    // The secondary buttons are only smaller: no fill, edge or colour of their own.
    expect(rule(LANDING_STYLE, ".landing button.secondary")).not.toMatch(/background|border|color/);
  });
});

describe("the title page's content", () => {
  it("sets the h1 to the title's two parts, with a space between, and carries no blurb", () => {
    expect(SOURCE).toContain("lead.textContent = TITLE_LEAD");
    expect(SOURCE).toContain("name.textContent = TITLE_NAME");
    expect(SOURCE).toContain('title.append(lead, " ", name)');
    expect(SOURCE).not.toMatch(/BLURB|dread/);
    expect(LANDING_STYLE).not.toContain("dread");
    expect(`${TITLE_LEAD} ${TITLE_NAME}`).toBe(TITLE);
    expect(TITLE).toBe("Something’s Haunting Port Ashton");
  });
});
