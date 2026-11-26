import { describe, expect, it } from "vitest";
import "../../src/terrain.js";
import { contains, orient, orientedRect, type Poly } from "../../src/sim/town/geom.js";
import { bearingU, bearingV } from "../../src/sim/town/bearings.js";
import { shoreAt } from "../../src/sim/town/shore.js";
import type { Deck, Light } from "../../src/sim/town/types.js";
import { townFor } from "./sites.js";

const KINDS: readonly Light["kind"][] = ["pier light", "pier lamp", "quay lamp", "float light", "flood mast", "yard light"];
const THREE = [20261121, 1, 7];
const rect = (c: { x: number; z: number }, ax: { x: number; z: number }, hA: number, hB: number): Poly => orient(orientedRect(c, hA, hB, ax, { x: ax.z, z: -ax.x }));
const inDeck = (l: Light, d: Deck, grow: number): boolean => contains(rect(d.centre, d.axis, d.halfAlong + grow, d.halfAcross + grow), l, 0);

describe("the harbour's working lights, on three seeds", () => {
  it("lights every pier over 12 m, keeps lamps 6 m apart, out of the water and out of buildings, and prints the counts", () => {
    for (const seed of THREE) {
      const { plan, site } = townFor(seed);
      const lights = plan.harbour.lights;
      const counts = KINDS.map((k) => `${lights.filter((l) => l.kind === k).length} ${k}`).join(", ");
      console.log(`harbour lights ${seed}: ${counts}`);
      // Every pier (a building that is a pier) longer than 12 m has a lamp on it (or its own pier light).
      for (const b of plan.buildings) {
        if (b.lot !== -1 || b.kind !== "pier") continue;
        const deck = plan.decks.find((d) => d.building === b.id) as Deck;
        if (Math.max(deck.halfAlong, deck.halfAcross) * 2 <= 12) continue;
        const has = lights.some((l) => (l.kind === "pier lamp" || l.kind === "pier light") && inDeck(l, deck, 0.1));
        expect(has, `${seed}: pier ${b.id} has a lamp`).toBe(true);
      }
      for (let i = 0; i < lights.length; i++) {
        const a = lights[i] as Light;
        for (let j = i + 1; j < lights.length; j++) {
          const b = lights[j] as Light;
          expect(Math.hypot(a.x - b.x, a.z - b.z), `${seed}: ${a.kind} and ${b.kind}`).toBeGreaterThanOrEqual(6);
        }
      }
      for (const l of lights) {
        if (l.kind === "harbour light" || l.kind === "day beacon") continue;
        const onDeck = plan.decks.some((d) => inDeck(l, d, 0.05));
        // The plan's own measure: land is where the shore is no more than the flat's 9 m seaward of the point (`SHORE_FLAT`).
        const onLand = shoreAt(site, l.z) - l.x <= 9;
        expect(onDeck || onLand, `${seed}: ${l.kind} at ${l.x.toFixed(1)}, ${l.z.toFixed(1)} is in the water`).toBe(true);
        for (const b of plan.buildings) {
          if (b.lot === -1 && b.kind === "pier") continue;
          const fp = orient(orientedRect(b.centre, b.halfAlong, b.halfAcross, bearingU(b.bearing), bearingV(b.bearing)));
          expect(contains(fp, l, 0), `${seed}: ${l.kind} inside building ${b.id}`).toBe(false);
        }
        if (l.kind === "pier lamp") expect(onDeck, `${seed}: a pier lamp is on a deck`).toBe(true);
        if (l.kind === "float light") expect(plan.decks.some((d) => d.kind === "float" && inDeck(l, d, 0)), `${seed}: a float light is on a float`).toBe(true);
      }
    }
  });
});
