import { describe, expect, it } from "vitest";
import "../../src/terrain.js";
import { elevationSampleAt } from "@csarkosh/engine/sim/terrain";
import { contains, orient, orientedRect, overlapDepth, type Poly } from "../../src/sim/town/geom.js";
import { BOAT_NAMES, harbourSummary } from "../../src/sim/town/port/harbour.js";
import { shoreAt } from "../../src/sim/town/shore.js";
import type { Boat, Deck, TownPlan } from "../../src/sim/town/types.js";
import { SEEDS, townFor } from "./sites.js";

const rect = (c: { x: number; z: number }, ax: { x: number; z: number }, hA: number, hB: number): Poly => orient(orientedRect(c, hA, hB, ax, { x: ax.z, z: -ax.x }));
const boatPoly = (b: Boat): Poly => rect(b, b.heading, b.length / 2, b.beam / 2);
const deckPoly = (d: Deck): Poly => rect(d.centre, d.axis, d.halfAlong, d.halfAcross);

describe("the harbour's plan, over the forty world seeds", () => {
  it("has nothing overlapping: no boat in a pier, a float, another boat or the barge, none on dry land", () => {
    let boats = 0;
    for (const seed of SEEDS) {
      const { plan, site } = townFor(seed);
      const h = plan.harbour;
      const decks = plan.decks.map(deckPoly);
      const polys = h.boats.map(boatPoly);
      const barge = h.terminal?.barge ?? null;
      const bargePoly = barge ? rect(barge, barge.heading, barge.length / 2, barge.beam / 2) : null;
      h.boats.forEach((b, i) => {
        boats++;
        decks.forEach((d, k) => expect(overlapDepth(polys[i] as Poly, d), `${seed}: boat ${b.id} ${b.kind} in deck ${k} ${plan.decks[k]?.kind}`).toBeLessThanOrEqual(1e-6));
        for (let j = i + 1; j < h.boats.length; j++) expect(overlapDepth(polys[i] as Poly, polys[j] as Poly), `${seed}: boats ${i} and ${j}`).toBeLessThanOrEqual(1e-6);
        if (bargePoly) expect(overlapDepth(polys[i] as Poly, bargePoly), `${seed}: boat ${i} and the barge`).toBeLessThanOrEqual(1e-6);
        // Seaward of the shore, with a margin: none on a headland's rocks.
        for (const p of polys[i] as Poly) expect(shoreAt(site, p.z) - p.x, `${seed}: boat ${b.id} ${b.kind} on land`).toBeGreaterThan(8);
        expect(b.length).toBeGreaterThanOrEqual(4.5);
        expect(b.length).toBeLessThanOrEqual(20);
        expect(BOAT_NAMES[b.name]).toBeDefined();
      });
      if (bargePoly) for (const [k, d] of decks.entries()) expect(overlapDepth(bargePoly, d), `${seed}: barge in deck ${k}`).toBeLessThanOrEqual(1e-6);
      // Floats stand clear of piers and the wharf, and meet only a gangway, the apron or another float.
      for (const a of plan.decks) {
        if (a.kind !== "float" && a.kind !== "gangway") continue;
        for (const b of plan.decks) {
          if (a === b || (b.kind !== "pier" && b.kind !== "wharf" && b.kind !== "shed")) continue;
          expect(overlapDepth(deckPoly(a), deckPoly(b)), `${seed}: deck ${a.id} ${a.kind} in ${b.kind}`).toBeLessThanOrEqual(1e-6);
        }
      }
      // Pilings stand outside every deck and boat; the pond's logs lie inside its boom.
      for (const field of h.pilings) {
        for (const p of field.piles) {
          for (const d of decks) expect(contains(d, p, 0.2)).toBe(false);
          for (const q of polys) expect(contains(q, p, 0.2)).toBe(false);
          expect(shoreAt(site, p.z) - p.x, `${seed}: a pile on land`).toBeGreaterThan(5);
        }
      }
      if (h.logPond) {
        const pond = h.logPond;
        for (const l of pond.logs) {
          expect(Math.abs(l.x - pond.centre.x)).toBeLessThan(pond.halfX);
          expect(Math.abs(l.z - pond.centre.z)).toBeLessThan(pond.halfZ);
        }
        for (const d of decks) expect(overlapDepth(rect(pond.centre, { x: 0, z: 1 }, pond.halfZ, pond.halfX), d), `${seed}: pond in a deck`).toBeLessThanOrEqual(1e-6);
      }
    }
    expect(boats).toBeGreaterThan(180);
  });

  it("floats the boats in water at least as deep as they draw, by the coast's real sea floor (the plan knows only the shore: a sea stack it cannot see may stand under a few)", () => {
    let worst = Infinity;
    let checked = 0;
    let short = 0;
    let floatsTotal = 0;
    let floatsOnGround = 0;
    const seeds = new Set<number>();
    for (const seed of SEEDS) {
      const { plan, site } = townFor(seed);
      for (const b of plan.harbour.boats) {
        for (const p of [...boatPoly(b), { x: b.x, z: b.z }]) {
          const floor = elevationSampleAt(seed, site.anchor.x + p.x, site.anchor.z + p.z).h;
          worst = Math.min(worst, -floor - b.draft);
          checked++;
          if (-floor < b.draft - 0.15) {
            short++;
            seeds.add(seed);
          }
        }
      }
      // A float stands over water, not ground, at its middle.
      for (const id of plan.harbour.floats) {
        const d = plan.decks[id] as Deck;
        const floor = elevationSampleAt(seed, site.anchor.x + d.centre.x, site.anchor.z + d.centre.z).h;
        floatsTotal++;
        if (!(floor < -0.3)) floatsOnGround++;
      }
    }
    process.stderr.write(`boat depths against the real floor: ${checked} points, ${short} too shallow (in seeds ${[...seeds].join(", ")}), the least spare water under a keel ${worst.toFixed(2)} m\n`);
    process.stderr.write(`floats over ground: ${floatsOnGround} of ${floatsTotal}\n`);
    expect(floatsOnGround / floatsTotal).toBeLessThan(0.03);
    expect(short / checked).toBeLessThan(0.03);
    expect(seeds.size).toBeLessThanOrEqual(4);
  });

  it("connects every float to the quay by gangways and floats, and every gangway runs from the apron down to a float", () => {
    for (const seed of SEEDS) {
      const { plan } = townFor(seed);
      const decks = plan.decks;
      const polys = decks.map(deckPoly);
      const seen = new Array<boolean>(decks.length).fill(false);
      const queue: number[] = [];
      for (const d of decks) if (d.kind === "apron") {
        seen[d.id] = true;
        queue.push(d.id);
      }
      while (queue.length > 0) {
        const a = queue.pop() as number;
        for (const b of decks) {
          if (seen[b.id]) continue;
          // Walk on only along the harbour's own decks: from the apron by a gangway, from a gangway to a float, float to float.
          const ok = (decks[a]?.kind === "apron" && b.kind === "gangway") || (decks[a]?.kind === "gangway" && b.kind === "float") || (decks[a]?.kind === "float" && (b.kind === "float" || b.kind === "gangway"));
          if (ok && overlapDepth(polys[a] as Poly, polys[b.id] as Poly) > 0.05) {
            seen[b.id] = true;
            queue.push(b.id);
          }
        }
      }
      for (const id of plan.harbour.floats) expect(seen[id], `${seed}: float ${id} is not reached on foot`).toBe(true);
      for (const id of plan.harbour.gangways) {
        const g = decks[id] as Deck;
        expect(g.top).toBeGreaterThan(g.topEnd + 1.5);
        expect(g.top - g.topEnd).toBeLessThan(2.6);
        // At most one rise in seven: a ramp a person can walk.
        expect((g.top - g.topEnd) / (2 * g.halfAlong)).toBeLessThan(1 / 5);
      }
    }
  });

  it("follows the history: fishing towns keep fuller basins (more of their slips hold a boat), a closed mill leaves pilings and no floating logs, an idle terminal has no barge", () => {
    let fishing = 0;
    let fishingBoats = 0;
    let mill = 0;
    let millBoats = 0;
    let closed = 0;
    let closedWithPiles = 0;
    let idle = 0;
    for (const seed of SEEDS) {
      const { plan } = townFor(seed);
      const h = plan.harbour;
      const hist = plan.history;
      const fishes = hist.founding.purpose === "cannery" || hist.port.handles === "seafood";
      if (fishes) {
        fishing++;
        fishingBoats += h.slips.filter((sl) => sl.boat !== null).length / Math.max(1, h.slips.length);
      } else if (hist.founding.purpose === "sawmill") {
        mill++;
        millBoats += h.slips.filter((sl) => sl.boat !== null).length / Math.max(1, h.slips.length);
      }
      if (hist.mill.fate === "closed") {
        closed++;
        if (h.pilings.some((f) => f.origin === "mill")) closedWithPiles++;
        if (h.logPond) {
          expect(h.logPond.working).toBe(false);
          expect(h.logPond.logs.length).toBe(0);
          expect(h.logPond.jackLadder).toBeNull();
        }
      } else if (h.logPond) {
        expect(h.logPond.working).toBe(true);
        expect(h.logPond.logs.length).toBeGreaterThan(10);
        expect(h.burner).toBeNull();
      }
      if (h.burner) expect(hist.mill.fate).toBe("closed");
      if (h.terminal?.idle) {
        idle++;
        expect(h.terminal.barge).toBeNull();
        expect(h.terminal.yard.length).toBe(0);
      }
      if (h.terminal && !h.terminal.idle) expect(h.terminal.cargo).toBe(hist.port.handles);
      if (h.terminal?.barge) expect(h.terminal.idle).toBe(false);
    }
    expect(fishingBoats / fishing).toBeGreaterThan(millBoats / mill);
    expect(closedWithPiles / closed).toBeGreaterThan(0.85);
    expect(idle).toBeGreaterThan(2);
  });

  it("varies as a person would see it: small and full basins, derelicts, sunk boats, each kind of boat and of cargo, burners, ponds", () => {
    const sizes: number[] = [];
    const kinds = new Set<string>();
    const cargo = new Set<string>();
    let derelictSeeds = 0;
    let cleanSeeds = 0;
    let sunk = 0;
    let burners = 0;
    let working = 0;
    let empty = 0;
    let barges = 0;
    const lines: string[] = [];
    for (const seed of SEEDS) {
      const { plan } = townFor(seed);
      const h = plan.harbour;
      sizes.push(h.boats.length);
      for (const b of h.boats) kinds.add(b.kind);
      if (h.boats.some((b) => b.state !== "working")) derelictSeeds++;
      else cleanSeeds++;
      sunk += h.boats.filter((b) => b.state === "sunk").length;
      if (h.burner) burners++;
      if (h.logPond?.working) working++;
      if (h.logPond && !h.logPond.working) empty++;
      if (h.terminal && !h.terminal.idle && h.terminal.yard.length > 0) cargo.add(h.terminal.cargo);
      if (h.terminal?.barge) barges++;
      if (lines.length < 12 && seed < 10) lines.push(`${String(seed).padStart(8)} ${plan.history.founding.purpose.padEnd(8)} mill ${plan.history.mill.fate.padEnd(7)} ${harbourSummary(h)}`);
    }
    process.stderr.write(`per-seed harbour summary lines:\n${lines.join("\n")}\n`);
    expect(Math.min(...sizes)).toBeLessThanOrEqual(6);
    expect(Math.max(...sizes)).toBeGreaterThanOrEqual(15);
    expect([...kinds].sort()).toEqual(["crabber", "gillnetter", "pleasure", "sailboat", "skiff", "troller", "tug"]);
    // Four of the five kinds of cargo show in a yard (the fifth, autos, comes to three towns in forty, and the grown town may leave its yard no room).
    expect([...cargo].filter((c) => ["autos", "general cargo", "grain", "logs", "seafood"].includes(c)).length).toBeGreaterThanOrEqual(4);
    expect(derelictSeeds).toBeGreaterThan(3);
    expect(cleanSeeds).toBeGreaterThan(3);
    expect(sunk).toBeGreaterThan(0);
    expect(burners).toBeGreaterThan(0);
    expect(working).toBeGreaterThan(0);
    expect(empty).toBeGreaterThan(0);
    expect(barges).toBeGreaterThan(5);
  });

  it("says what is there in the history's list, in order, and keeps the harbour's lights", () => {
    for (const seed of SEEDS) {
      const { plan } = townFor(seed);
      const years = plan.history.events.map((e) => e.year);
      expect(years).toEqual([...years].sort((a, b) => a - b));
      const told = plan.history.events.filter((e) => e.kind === "harbour");
      expect(told.length).toBe(plan.harbour.events.length);
      expect(told.some((e) => e.text.includes("boat basin"))).toBe(true);
      for (const f of plan.harbour.pilings) expect(told.some((e) => e.text.includes("pilings still stand") && e.year === f.year)).toBe(true);
      // Lights: at most one of each headland and a light on the longest pier; none stands in the water but the pier's.
      const lights = plan.harbour.lights;
      expect(lights.filter((l) => l.kind === "pier light").length).toBeLessThanOrEqual(1);
      expect(lights.filter((l) => l.kind !== "pier light").length).toBeLessThanOrEqual(2);
    }
    // The headland lights are found for most seeds: the site has two narrow tongues either side of the cove.
    const both = SEEDS.filter((s) => townFor(s).plan.harbour.lights.filter((l) => l.kind !== "pier light").length === 2).length;
    expect(both).toBeGreaterThan(SEEDS.length * 0.7);
  });
});

export type { TownPlan };
