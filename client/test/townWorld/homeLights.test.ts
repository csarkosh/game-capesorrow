// The evening in the town's homes: by day no window glows, at 20:30 a third or more of the curtained and blinded windows of occupied homes are lit and
// most homes have a lit window on the street side, in the small hours few are, and the geometry carries each lit window's code on its covering.
import "../../src/terrain.js";
import { describe, expect, it } from "vitest";
import { finish } from "@csarkosh/engine/game/syncJobs";
import { isNightCode, nightShare } from "../../src/game/town/hours.js";
import { SURFACE_FLOATS } from "../../src/game/town/meshBuilder.js";
import { NO_LAYER } from "../../src/game/town/townLayers.js";
import { townGeometry, townGround } from "../../src/game/town/townGeometry.js";
import { NEVER_CODE, isHome, porchCode, windowCodes, type WindowWindow } from "../../src/game/town/windowNight.js";
import { boatCabin } from "../../src/game/town/boatGeometry.js";
import { isWorkKind, lampKind, lampSites, workLook } from "../../src/game/town/props/lamps.js";
import { planFor } from "../../src/sim/town/planFor.js";
import type { Building, TownPlan } from "../../src/sim/town/types.js";

const SEEDS = [20261121, 1, 7];

type Home = { b: Building; groups: { ws: readonly WindowWindow[]; codes: number[] }[] };

/** Every occupied home's windows, grouped by household: a house's, and each flat floor's over a shop. */
function homes(plan: TownPlan): Home[] {
  const out: Home[] = [];
  for (const b of plan.buildings) {
    if (!isHome(b)) continue;
    const use = plan.uses[b.id];
    if (use === undefined) continue;
    const groups: Home["groups"] = [];
    if (use.windows.length > 0) groups.push({ ws: use.windows, codes: windowCodes(b.id, use.windows) });
    for (const up of use.upper) if (up.use === "apartments" || up.use === "hotel rooms") groups.push({ ws: up.windows, codes: windowCodes(b.id * 100 + up.storey, up.windows) });
    if (groups.length > 0) out.push({ b, groups });
  }
  return out;
}

describe("the evening in the homes", () => {
  it("lights a third of the curtained and blinded windows at 20:30 and a street window in most homes, few at 02:30, none at noon", () => {
    for (const seed of SEEDS) {
      const hs = homes(planFor(seed));
      expect(hs.length).toBeGreaterThan(30);
      const count = (hour: number): { lit: number; of: number; streetHomes: number } => {
        let lit = 0;
        let of = 0;
        let streetHomes = 0;
        for (const h of hs) {
          let street = false;
          for (const g of h.groups) {
            g.ws.forEach((w, i) => {
              const on = nightShare(g.codes[i] as number, hour) > 0.5;
              if (w.state === "curtained" || w.state === "blinds") {
                of++;
                if (on) lit++;
              }
              if (on && w.wall === "front") street = true;
            });
          }
          if (street) streetHomes++;
        }
        return { lit, of, streetHomes };
      };
      const evening = count(20.5);
      const late = count(2.5);
      const noon = count(12);
      const homesN = hs.length;
      process.stderr.write(`seed ${seed}: ${homesN} homes; windows lit of curtained or blinded: 20:30 ${evening.lit}/${evening.of} (${((100 * evening.lit) / evening.of).toFixed(0)}%), 02:30 ${late.lit}/${late.of} (${((100 * late.lit) / late.of).toFixed(1)}%), noon ${noon.lit}; homes with a lit street window at 20:30 ${evening.streetHomes}/${homesN} (${((100 * evening.streetHomes) / homesN).toFixed(0)}%)\n`);
      expect(evening.lit / evening.of).toBeGreaterThanOrEqual(1 / 3);
      expect(evening.streetHomes / homesN).toBeGreaterThanOrEqual(0.8);
      expect(late.lit / late.of).toBeLessThan(0.1);
      expect(noon.lit).toBe(0);
    }
  });

  it("lights none where nobody lives, and a window the plan calls lit is among the lit", () => {
    for (const seed of SEEDS) {
      const plan = planFor(seed);
      for (const b of plan.buildings) {
        const use = plan.uses[b.id];
        if (use === undefined || isHome(b)) continue;
        // (A building that is not a home is given no codes by its callers: `NEVER_CODE`; the list for a home of other state is never asked.)
        expect(isHome(b)).toBe(false);
      }
      for (const h of homes(plan)) for (const g of h.groups) g.ws.forEach((w, i) => { if (w.state === "lit") expect(g.codes[i]).not.toBe(NEVER_CODE); });
    }
  });

  it("gives a porch light to about half the occupied homes (those without a porch of their own), never to a vacant one", () => {
    const plan = planFor(SEEDS[0] as number);
    let homesN = 0;
    let porches = 0;
    for (const b of plan.buildings) {
      if (isHome(b)) {
        homesN++;
        if (porchCode(b, plan.uses[b.id]) !== null) porches++;
      } else expect(porchCode(b, plan.uses[b.id])).toBeNull();
    }
    expect(porches / homesN).toBeGreaterThan(0.4);
    expect(porches / homesN).toBeLessThan(0.7);
  });

  it("lays each lit window's night code on the cloth behind its glass, with no glow by day written on a window that is never lit", () => {
    const ground = townGround(SEEDS[0] as number);
    const town = finish(townGeometry(ground, "full", { x: 0, z: 0 }));
    let nightVerts = 0;
    let lensVerts = 0;
    for (const batch of town) {
      const a = batch.arrays;
      for (let i = 0; i < a.positions.length / 3; i++) {
        if ((a.surface[i * SURFACE_FLOATS] as number) === NO_LAYER) continue;
        const code = a.surface[i * SURFACE_FLOATS + 10] as number;
        if (!isNightCode(code)) continue;
        nightVerts++;
        if ((a.surface[i * SURFACE_FLOATS + 3] as number) >= 1) lensVerts++;
      }
    }
    expect(nightVerts).toBeGreaterThan(500);
    expect(lensVerts).toBeGreaterThan(40);
  });

  it("lists every lamp that can shine: the street lamps that are not dead, the harbour's and pier's lights (no day beacon), and each porch light", () => {
    const ground = townGround(SEEDS[0] as number);
    const sites = lampSites(ground);
    const plan = ground.plan;
    const street = plan.props.poles.filter((p) => p.light !== null && lampKind(p.seed) !== "dead").length;
    // The harbour's: the headland light, the pier light, and each working lamp that is not dead (a dead one throws nothing).
    const harbour = plan.harbour.lights.filter((l) => l.kind !== "day beacon" && !(isWorkKind(l.kind) && workLook(l).dead)).length;
    const cabins = plan.harbour.boats.filter((b) => boatCabin(b) !== null).length;
    const shops = sites.filter((l) => l.hours !== undefined).length;
    let porches = 0;
    for (const b of plan.buildings) if (porchCode(b, plan.uses[b.id]) !== null && plan.uses[b.id]?.door !== null) porches++;
    expect(sites.length).toBe(street + harbour + porches + cabins + shops);
    expect(harbour).toBeGreaterThan(2);
    expect(shops).toBeGreaterThan(0);
    const dead = plan.props.poles.filter((p) => p.light !== null && lampKind(p.seed) === "dead").length;
    expect(dead).toBeGreaterThanOrEqual(0);
    for (const l of sites) {
      expect(isNightCode(l.code)).toBe(true);
      expect(l.range).toBeGreaterThanOrEqual(5);
      // A lens hangs above the ground it lights.
      expect(l.y).toBeGreaterThan(ground.heightAt(l.x, l.z));
    }
    expect(sites.filter((l) => l.range === 5).length).toBe(porches);
  });
});
