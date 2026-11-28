import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { PORTASHTON_IDENTITY } from "../../src/identity.js";
import * as words from "../../src/game/words.js";

const SRC = fileURLToPath(new URL("../../src/", import.meta.url));
const INDEX = readFileSync(fileURLToPath(new URL("../../index.html", import.meta.url)), "utf8");
/** A module's code, its comments taken out. */
const code = (name: string): string => readFileSync(SRC + name, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

describe("the title page's words", () => {
  it("are the game's name, in two parts, and the lines that stand in Play's place", () => {
    expect(words.TITLE).toBe("Something’s Haunting Port Ashton");
    expect([words.TITLE_LEAD, words.TITLE_NAME]).toEqual(["Something’s Haunting", "Port Ashton"]);
    expect(`${words.TITLE_LEAD} ${words.TITLE_NAME}`).toBe(words.TITLE);
    expect(Object.keys(words).filter((name) => name.startsWith("BLURB_"))).toEqual([]);
    expect(words.IN_DEVELOPMENT).toBe("In development.");
    expect([words.PLAY, words.LOADING, words.WAITING_FOR_HOST]).toEqual(["Play", "Loading…", "Waiting for the host…"]);
  });

  it("agree with the identity and the page's own head", () => {
    expect(words.TITLE).toBe(PORTASHTON_IDENTITY.title);
    expect(INDEX).toContain(`<title>${words.TITLE}</title>`);
    expect(INDEX).toContain('<meta name="description" content="A detective, a stretch of the Washington coast, and reports nobody believed." />');
  });

  it("are spelled in the words module alone: no other module of the title page carries one as a literal", () => {
    const spoken = [words.IN_DEVELOPMENT, words.PLAY, words.LOADING, words.WAITING_FOR_HOST, words.SETTINGS, words.CREDITS];
    for (const name of ["game/landing.ts", "game/landingModel.ts", "page.ts"]) {
      const text = code(name);
      for (const word of spoken) expect(text, `${name}: ${word}`).not.toContain(`"${word}"`);
      expect(text, name).not.toContain("Port Ashton");
    }
  });

  it("say the door's lines, and the car's, as the player reads them", () => {
    expect([words.GET_IN, words.GET_OUT, words.NO_ROOM_TO_GET_OUT, words.CAR_RETURNED, words.HOST_RETURNS_CAR]).toEqual([
      "Click to get in",
      "Click to get out",
      "No room to get out here",
      "The car is back at the office.",
      "Only the host can bring the car back.",
    ]);
    for (const name of ["hud.ts", "game/car/side.ts"]) {
      for (const word of [words.GET_IN, words.GET_OUT, words.NO_ROOM_TO_GET_OUT, words.CAR_RETURNED, words.HOST_RETURNS_CAR]) expect(code(name), `${name}: ${word}`).not.toContain(word);
    }
  });
});
