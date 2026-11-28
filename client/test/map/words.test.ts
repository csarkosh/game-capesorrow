import "../../src/terrain.js";
import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import * as words from "../../src/game/words.js";
import { mapDataFor } from "../../src/game/map/mapData.js";
import { MAP_SEEDS } from "./seeds.js";

const ROOT = new URL("../../src/", import.meta.url).pathname;
const files = (dir: string): string[] => readdirSync(dir).flatMap((n) => (statSync(join(dir, n)).isDirectory() ? files(join(dir, n)) : n.endsWith(".ts") ? [join(dir, n)] : []));

/** What no word of the map may name: the player's employer, and a real street-map app or its maker. Written in pieces so that this file is no instance of it. */
const NOT_NAMED = new RegExp(`\\b(${["fbi", "federal bureau", "bureau", "goo" + "gle", "apple maps", "waze", "mapquest", "bing maps", "here maps", "openstreetmap", "mapbox", "tomtom"].join("|")})\\b`, "i");

describe("what the map says", () => {
  it("names no employer and no real street-map app or brand in any word it shows", () => {
    const shown = Object.entries(words).filter(([k]) => k.startsWith("MAP_")).map(([, v]) => String(v));
    expect(shown.length).toBeGreaterThan(10);
    for (const w of shown) expect(w, w).not.toMatch(NOT_NAMED);
    for (const seed of MAP_SEEDS) {
      const data = mapDataFor(seed);
      for (const p of data.places) expect(p.name, p.name).not.toMatch(NOT_NAMED);
      for (const l of data.landmarks) expect(l.name, l.name).not.toMatch(NOT_NAMED);
      for (const c of data.cells.values()) for (const l of c.labels) expect(l.text, l.text).not.toMatch(NOT_NAMED);
    }
  });

  it("has no such name in its code, its comments or its tests either", () => {
    const here = [...files(join(ROOT, "game/map")), ...files(new URL("./", import.meta.url).pathname.replace(/\/$/, "")).filter((f) => !f.endsWith("words.test.ts"))];
    expect(here.length).toBeGreaterThan(10);
    for (const f of here) {
      const text = readFileSync(f, "utf8").replace(/Bureau|FBI office/g, "");
      expect(text.match(new RegExp(`\\b${"goo" + "gle"}\\b`, "i")), f).toBeNull();
      expect(text.match(/\b(waze|mapquest|openstreetmap|mapbox)\b/i), f).toBeNull();
    }
  });
});

describe("the map and the simulation", () => {
  it("is read by nothing in client/src/sim/, which never imports it", () => {
    for (const f of files(join(ROOT, "sim"))) {
      const text = readFileSync(f, "utf8");
      expect(text, f).not.toMatch(/game\/map|\.\.\/map\/|\/mapData|\/mapRoute|\/minimap/);
    }
  });

  it("reads the simulation and nothing of the engine's renderer or Babylon", () => {
    for (const f of files(join(ROOT, "game/map"))) {
      const text = readFileSync(f, "utf8");
      // (A type of the engine's console, `CommandSpec`, is the one thing it takes from there.)
      expect(text, f).not.toMatch(/^import (?!type ).*(@babylonjs|engine\/game\/)/m);
    }
  });
});
