import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Port Ashton's own rules of layout, for what it simulates. Everything under `client/src/sim/` is what
 * every machine computes to build the same world, so it uses only arithmetic that gives the same bits on
 * every machine, and reaches only the engine's simulation and itself. The engine's and Day Hike's
 * `test/architecture.test.ts` hold the same rules for their own folders. The folder is read as it is
 * when this runs: a file added to it is held to them with no change here.
 */

// Resolve against this file, never process.cwd(): a relative path silently points at nothing and every
// check below passes vacuously.
const SRC = fileURLToPath(new URL("../src", import.meta.url));
const SIM = join(SRC, "sim");

function filesUnder(dir: string): string[] {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...filesUnder(full));
    else if (entry.name.endsWith(".ts")) out.push(full);
  }
  return out;
}

/** Source with its comments blanked, so a rule reads code and never the prose beside it. */
function code(file: string): string {
  const src = readFileSync(file, "utf8");
  const noBlock = src.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "));
  return noBlock.replace(/\/\/[^\n]*/g, "");
}

/** Every module a file names: a bare import, an import or export from, and a dynamic import. */
function specifiersOf(file: string): string[] {
  const text = code(file);
  return [
    ...[...text.matchAll(/^\s*import\s+["']([^"']+)["']/gm)].map((m) => m[1] as string),
    ...[...text.matchAll(/\bfrom\s+["']([^"']+)["']/g)].map((m) => m[1] as string),
    ...[...text.matchAll(/\bimport\s*\(\s*["']([^"']+)["']/g)].map((m) => m[1] as string),
  ];
}

const FILES = filesUnder(SIM);
const name = (file: string): string => relative(SIM, file);

describe("the simulation's folder", () => {
  it("can be seen, so no rule below passes by reading nothing", () => {
    expect(existsSync(SIM)).toBe(true);
    expect(FILES.length).toBeGreaterThan(0);
  });

  it("calls none of the functions a machine is free to compute its own way, and no Date or random", () => {
    const BANNED = /\bMath\.(?:sin|cos|tan|asin|acos|atan|atan2|pow|exp|log|hypot|cbrt|random)\s*\(/g;
    const found: string[] = [];
    for (const file of FILES) {
      const text = code(file);
      for (const match of text.matchAll(BANNED)) found.push(`${name(file)}: ${match[0]}`);
      for (const match of text.matchAll(/\bDate\b/g)) found.push(`${name(file)}: ${match[0]}`);
      // Math.sinh, log1p and the rest of the family are as free, so any Math call outside the allowed few is named.
      for (const match of text.matchAll(/\bMath\.([A-Za-z0-9_]+)/g)) {
        if (!["floor", "round", "abs", "min", "max", "sqrt", "imul", "PI"].includes(match[1] as string)) found.push(`${name(file)}: Math.${match[1]}`);
      }
    }
    expect([...new Set(found)]).toEqual([]);
  });

  it("uses no exponentiation operator", () => {
    const found: string[] = [];
    for (const file of FILES) {
      for (const line of code(file).split("\n")) {
        if (/[^*]\*\*[^*]/.test(line)) found.push(`${name(file)}: ${line.trim()}`);
      }
    }
    expect(found).toEqual([]);
  });

  it("imports only the engine's simulation and itself: nothing of game/, townMap/, Babylon or the engine's game/", () => {
    const found: string[] = [];
    let seen = 0;
    for (const file of FILES) {
      for (const spec of specifiersOf(file)) {
        seen++;
        if (spec.startsWith("@csarkosh/engine/sim/")) continue;
        if (spec.startsWith(".")) {
          // A file of this folder, whichever way it is reached: it must resolve to inside `sim/`.
          const target = resolve(join(file, ".."), spec);
          if (target === SIM || target.startsWith(SIM + "/")) continue;
        }
        found.push(`${name(file)}: ${spec}`);
      }
    }
    expect(seen).toBeGreaterThan(5);
    expect(found).toEqual([]);
  });

  it("keeps the plan's own stages from importing anything that reads the finished plan (an import cycle that the test runner's load order hides)", () => {
    // What plan.ts reaches, through every import it makes, may not reach the ground, the clearing, the place or the cached plan: those import the plan, so a module of the
    // plan that named one would be in a cycle, and a constant it read at load could still be unset (the game's `QUAY_BANK` before initialization).
    const READERS = ["town/ground.ts", "town/planFor.ts", "town/place.ts", "town/clearing.ts", "town/cover.ts", "town/start.ts"];
    const resolveTs = (from: string, spec: string): string | null => {
      if (!spec.startsWith(".")) return null;
      const target = resolve(join(from, ".."), spec.replace(/\.js$/, ".ts"));
      return existsSync(target) ? target : null;
    };
    const seen: string[] = [];
    const queue = [join(SIM, "town/plan.ts"), join(SIM, "town/recipes.ts")];
    while (queue.length > 0) {
      const f = queue.pop() as string;
      if (seen.includes(f)) continue;
      seen.push(f);
      for (const spec of specifiersOf(f)) {
        const t = resolveTs(f, spec);
        if (t !== null) queue.push(t);
      }
    }
    expect(seen.length, "the walk reads the plan's files").toBeGreaterThan(20);
    const bad = seen.map(name).filter((n) => READERS.includes(n));
    expect(bad, "plan stages that reach a reader of the finished plan").toEqual([]);
  });
});
