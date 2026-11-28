import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { LANDING_STYLE, TITLE_CREAM, TITLE_RED } from "../../src/game/landing.js";
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
  it("is set as the poster's headline: the heaviest wide sans, italic, capitals, tight, in red", () => {
    expect(TITLE_RED).toBe("#bc0708");
    const h1 = rule(LANDING_STYLE, ".landing h1");
    expect(h1).toContain(`color: ${TITLE_RED}`);
    expect(h1).toContain('font-family: "Arial Black"');
    expect(h1).toContain("font-weight: 900");
    expect(h1).toContain("font-style: italic");
    expect(h1).toContain("line-height: 0.88");
    expect(h1).toContain("text-transform: uppercase");
    expect(h1).toContain("flex-direction: column");
    // No font is fetched for it: nothing is loaded before Play but the title's still and film.
    expect(LANDING_STYLE).not.toMatch(/@font-face|@import|fonts\.googleapis/);
  });

  it("puts the lead small on one line above a very large name, both letter-spaced tight", () => {
    const lead = rule(LANDING_STYLE, ".landing h1 .title-lead");
    expect(lead).toContain("white-space: nowrap");
    expect(lead).toContain("letter-spacing: -0.03em");
    const name = rule(LANDING_STYLE, ".landing h1 .title-name");
    expect(name).toContain("font-size: clamp(2.6rem, 9vw, 6rem)");
    expect(name).toContain("letter-spacing: -0.05em");
    expect(name).toContain("overflow-wrap: anywhere");
    expect(name).toContain("transform: scaleY(2)");
    // The transform leaves the layout box as it is: the margins are (2 - 1) / 2 of the 0.88em line above and below.
    expect(name).toContain("margin: 0.44em 0");
  });

  it("is smaller on a phone", () => {
    const phone = LANDING_STYLE.slice(LANDING_STYLE.indexOf("max-width: 480px"));
    expect(rule(phone, "    .landing h1 .title-name")).toContain("font-size: clamp(1.8rem, 10vw, 3rem)");
    expect(rule(phone, "    .landing h1 .title-lead")).toContain("font-size");
  });
});

describe("the title page's controls", () => {
  it("are Play a slab of solid cream with a dark label, and the others dark slabs with cream labels", () => {
    expect(TITLE_CREAM).toBe("#ede4cc");
    expect(LANDING_STYLE).toContain("--btn-solid: rgb(237, 228, 204)");
    expect(LANDING_STYLE).toContain("--btn-dark: rgb(12, 15, 17)");
    expect(LANDING_STYLE).not.toMatch(/198, 222, 222|214, 234, 234|#eaf1f1/);
    const button = rule(LANDING_STYLE, ".landing button");
    expect(button).toContain("background-color: var(--btn-solid)");
    expect(button).toContain("color: #0c0f11");
    const secondary = rule(LANDING_STYLE, ".landing button.secondary");
    expect(secondary).toContain("background-color: var(--btn-dark)");
    expect(secondary).toContain(`color: ${TITLE_CREAM}`);
  });
});

describe("the title page's in-development line", () => {
  it("stands small under Play, and Settings stands apart below it", () => {
    // In the page's order: Play (or the wait), then the line, then Settings and Credits.
    const play = SOURCE.indexOf('button.id = "create"');
    const line = SOURCE.indexOf('developing.className = "developing"');
    const settings = SOURCE.indexOf('settingsButton.className = "secondary settings"');
    expect(play).toBeGreaterThan(0);
    expect(line).toBeGreaterThan(play);
    expect(settings).toBeGreaterThan(line);
    expect(rule(LANDING_STYLE, ".landing .developing")).toContain("font-size: 0.75rem");
    expect(rule(LANDING_STYLE, ".landing .developing + button.secondary")).toContain("margin-top: 1.5rem");
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
