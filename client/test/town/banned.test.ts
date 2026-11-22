import { readdirSync, readFileSync, statSync } from "node:fs";
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

const DIR = fileURLToPath(new URL("../../src/sim/town/", import.meta.url));

/** Code with its comments taken out (and its strings left: a banned call is not one there). */
const code = (path: string): string => readFileSync(path, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

const ALLOWED_MATH = ["floor", "round", "abs", "min", "max", "sqrt", "imul", "PI"];

describe("the town module's determinism rules", () => {
  const all = files(DIR);

  it("reads some files", () => {
    expect(all.length).toBeGreaterThan(10);
  });

  it("has no banned call, no `**`, no Date, no Map or Set, no key-order iteration", () => {
    for (const path of all) {
      const text = code(path);
      const where = path.slice(DIR.length);
      expect(text, `${where}: Math.random`).not.toMatch(/Math\.random/);
      expect(text, `${where}: trigonometry, pow, exp, log, hypot, cbrt`).not.toMatch(/Math\.(sin|cos|tan|asin|acos|atan|atan2|sinh|cosh|tanh|pow|exp|expm1|log|log1p|log2|log10|hypot|cbrt)\b/);
      expect(text, `${where}: the ** operator`).not.toMatch(/\*\*/);
      expect(text, `${where}: Date`).not.toMatch(/\bDate\b/);
      expect(text, `${where}: Map or Set`).not.toMatch(/\bnew\s+(Map|Set|WeakMap|WeakSet)\b/);
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
          // From port/, ../ is the town folder; from the town folder it would leave it.
          expect(path.slice(DIR.length).includes("/"), `${path.slice(DIR.length)} imports ${spec}`).toBe(true);
        }
      }
    }
  });
});
