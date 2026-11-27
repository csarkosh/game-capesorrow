import { readdirSync, readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/** Every .ts file under a folder, in a fixed order. */
function files(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir).sort()) {
    const path = dir + name;
    if (statSync(path).isDirectory()) out.push(...files(path + "/"));
    else if (name.endsWith(".ts")) out.push(path);
  }
  return out;
}

/** The whole simulation folder: the town and the car, and anything added beside them. */
const DIR = fileURLToPath(new URL("../../src/sim/", import.meta.url));
const TOWN = DIR + "town/";

/** Code with its comments taken out (and its strings left: a banned call is not one there). */
const code = (path: string): string => readFileSync(path, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

const ALLOWED_MATH = ["floor", "round", "abs", "min", "max", "sqrt", "imul", "PI"];

describe("the simulation's determinism rules", () => {
  const all = files(DIR);

  it("reads some files, the town's and the car's among them", () => {
    expect(all.length).toBeGreaterThan(10);
    expect(all.some((p) => p.startsWith(TOWN))).toBe(true);
    expect(all.some((p) => p.startsWith(DIR + "car/"))).toBe(true);
  });

  it("has no banned call, no `**`, no Date, no Set, no Map but a cache, no key-order iteration", () => {
    for (const path of all) {
      const text = code(path);
      const where = path.slice(DIR.length);
      expect(text, `${where}: Math.random`).not.toMatch(/Math\.random/);
      expect(text, `${where}: trigonometry, pow, exp, log, hypot, cbrt`).not.toMatch(/Math\.(sin|cos|tan|asin|acos|atan|atan2|sinh|cosh|tanh|pow|exp|expm1|log|log1p|log2|log10|hypot|cbrt)\b/);
      expect(text, `${where}: the ** operator`).not.toMatch(/\*\*/);
      expect(text, `${where}: Date`).not.toMatch(/\bDate\b/);
      // A set's or a map's order must never reach a result. The one use allowed is a module's own cache of what a
      // pure function already answered, looked up by key and never walked: `const NAME = new Map<…>()` at the top level.
      expect(text, `${where}: a Set`).not.toMatch(/\bnew\s+(Set|WeakSet)\b/);
      for (const m of text.matchAll(/^.*\bnew\s+(?:Map|WeakMap)\b.*$/gm)) {
        expect(m[0], `${where}: a Map that is not a module's cache`).toMatch(/^const [A-Z][A-Z_]* = new (?:Map|WeakMap)<[^>]+>\(\);$/);
      }
      expect(text, `${where}: walking a map`).not.toMatch(/\.(values|keys|entries|forEach)\(/);
      expect(text, `${where}: object key order`).not.toMatch(/Object\.(keys|values|entries)\b|\bfor\s*\([^)]*\sin\s/);
      expect(text, `${where}: sort without a comparator`).not.toMatch(/\.sort\(\s*\)/);
    }
  });

  it("uses only the Math functions that are exactly specified", () => {
    for (const path of all) {
      for (const m of code(path).matchAll(/Math\.(\w+)/g)) {
        expect(ALLOWED_MATH, `${path.slice(DIR.length)}: Math.${m[1]}`).toContain(m[1]);
      }
    }
  });

  it("imports nothing from outside the folder but the engine's sim modules and the site", () => {
    for (const path of all) {
      for (const m of code(path).matchAll(/from\s+"([^"]+)"/g)) {
        const spec = m[1]!;
        const ok = spec.startsWith("./") || spec.startsWith("../") || spec.startsWith("@csarkosh/engine/sim/");
        expect(ok, `${path.slice(DIR.length)} imports ${spec}`).toBe(true);
        if (spec.startsWith("../")) {
          // A relative import must stay inside the simulation folder (the car reaches the town's; the town does not reach the car's).
          const target = resolve(path, "..", spec) + "/";
          expect(target.startsWith(DIR), `${path.slice(DIR.length)} imports ${spec}`).toBe(true);
          if (path.startsWith(TOWN)) expect(target.startsWith(TOWN), `${path.slice(DIR.length)} imports ${spec}`).toBe(true);
        }
      }
    }
  });
});
