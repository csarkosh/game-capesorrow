import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { StandInElement, installStandInDom } from "@csarkosh/engine/testing/standInDom";
import { CSS } from "../../src/game/map/mapCss.js";
import { PARTY_CSS, barsFor, createParty } from "../../src/game/map/partyLook.js";

afterEach(() => vi.unstubAllGlobals());

const engine = (name: string): string => readFileSync(new URL(`../../../node_modules/@csarkosh/engine/src/game/${name}`, import.meta.url), "utf8");

describe("the party while playing and while paused", () => {
  it("leans only on class names the engine's roster still has", () => {
    const roster = engine("roster.ts");
    for (const needle of [".roster {", ".roster.subdued {", ".roster.hidden {", ".roster.locked {", ".roster .head {", ".roster .invite {", ".roster .stalled {", ".roster .note {", ".roster .error {", ".roster li .mark {", ".roster li.self {", "z-index: 20"]) expect(roster, needle).toContain(needle);
    for (const cls of ["head", "invite", "stage", "bar", "mark"]) expect(roster, cls).toContain(`className = "${cls}"`);
    expect(roster).toContain('root.classList.toggle("subdued"');
    expect(roster).toContain('item.classList.toggle("self"');
    // Every class the rules name is in the engine's source.
    for (const m of PARTY_CSS.matchAll(/\.roster(?:\.|\s+\.)([a-z]+)/g)) expect(roster, m[1]).toContain(m[1] as string);
  });

  it("restyles the subdued roster to bare rows at the top right corner, at half strength, with no heading, invite, panel or border, and the full one to the left while the map is large", () => {
    expect(CSS).toContain(PARTY_CSS);
    expect(PARTY_CSS).toMatch(/body \.roster\.subdued \{[^}]*top: calc\(12px[^}]*bottom: auto[^}]*background: none; border: none[^}]*box-shadow: none[^}]*opacity: 0\.55/);
    expect(PARTY_CSS).toMatch(/\.roster\.subdued \.head, [^{]*\.invite[^{]*\{ display: none; \}/);
    expect(PARTY_CSS).toMatch(/\.roster\.subdued li \{[^}]*text-shadow/);
    expect(PARTY_CSS).toContain("body.capemap-open .roster:not(.subdued):not(.hidden) { left: 12px; right: auto; bottom: 12px; }");
  });

  it("says how many bars a round trip fills", () => {
    expect([0, 59, 60, 119, 120, 199, 200, 900, null, NaN].map((v) => barsFor(v))).toEqual([4, 4, 3, 3, 2, 2, 1, 1, 0, 0]);
  });

  it("puts a four-bar mark in each row, filled for the local player and unfilled for the rest, and does nothing with no roster", () => {
    const doc = installStandInDom();
    const roster = doc.createElement("aside");
    roster.className = "roster subdued";
    const ul = doc.createElement("ul");
    const rows: StandInElement[] = [];
    for (const [name, self] of [["Ada", true], ["Bo", false]] as const) {
      const li = doc.createElement("li");
      li.className = self ? "self" : "";
      li.append(doc.createElement("span"));
      ul.append(li);
      rows.push(li);
      expect(name.length).toBeGreaterThan(0);
    }
    roster.append(ul);
    const env = { querySelector: (s: string) => (s === ".roster" ? roster : null), createElement: (t: string) => doc.createElement(t), documentElement: { style: { setProperty: () => undefined, removeProperty: () => undefined } } } as unknown as Document;
    const party = createParty(env);
    party.update(80, 10);
    const link = (li: StandInElement): StandInElement => li.querySelector("span.link") as StandInElement;
    expect(link(rows[0]!).getAttribute("data-n")).toBe("3");
    expect(link(rows[1]!).getAttribute("data-n")).toBe("0");
    expect(link(rows[0]!).children.filter((c) => c.tagName === "I")).toHaveLength(4);
    party.update(250, 11);
    expect(link(rows[0]!).getAttribute("data-n")).toBe("1");
    expect(rows[0]!.querySelectorAll("span.link")).toHaveLength(1);
    // A roster that is not there (a build with no server) is nothing to do.
    const none = createParty({ querySelector: () => null, documentElement: undefined } as unknown as Document);
    expect(() => { none.update(10, 1); none.dispose(); }).not.toThrow();
    party.dispose();
  });
});
