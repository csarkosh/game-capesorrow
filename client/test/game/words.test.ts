import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { CAPE_IDENTITY } from "../../src/identity.js";
import * as words from "../../src/game/words.js";

const SRC = fileURLToPath(new URL("../../src/", import.meta.url));
const INDEX = readFileSync(fileURLToPath(new URL("../../index.html", import.meta.url)), "utf8");
/** A module's code, its comments taken out. */
const code = (name: string): string => readFileSync(SRC + name, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

describe("the title page's words", () => {
  it("are the game's name, one sentence that turns at its end, and the lines that stand in Play's place", () => {
    expect(words.TITLE).toBe("Cape Sorrow");
    expect(words.BLURB_LEAD + words.BLURB_TURN).toBe(
      "A grey stretch of coast; a folder of reports nobody believed; and the slow suspicion that some of them were true.",
    );
    // The lead runs on into the turn with a space between, and the turn ends the sentence.
    expect(words.BLURB_LEAD.endsWith("that ")).toBe(true);
    expect(words.BLURB_TURN).toBe("some of them were true.");
    expect(words.IN_DEVELOPMENT).toBe("In development.");
    expect([words.PLAY, words.LOADING, words.WAITING_FOR_HOST]).toEqual(["Play", "Loading…", "Waiting for the host…"]);
  });

  it("agree with the identity and the page's own head", () => {
    expect(words.TITLE).toBe(CAPE_IDENTITY.title);
    expect(INDEX).toContain(`<title>${words.TITLE}</title>`);
    expect(INDEX).toContain('<meta name="description" content="A detective, a stretch of the Washington coast, and reports nobody believed." />');
  });

  it("are spelled in the words module alone: no other module of the title page carries one as a literal", () => {
    const spoken = [words.BLURB_LEAD, words.BLURB_TURN, words.IN_DEVELOPMENT, words.PLAY, words.LOADING, words.WAITING_FOR_HOST, words.SETTINGS, words.CREDITS];
    for (const name of ["game/landing.ts", "game/landingModel.ts", "page.ts"]) {
      const text = code(name);
      for (const word of spoken) expect(text, `${name}: ${word}`).not.toContain(`"${word}"`);
      expect(text, name).not.toContain("Cape Sorrow");
    }
  });
});
