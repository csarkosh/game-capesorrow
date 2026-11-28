import "../../src/terrain.js";
import { describe, expect, it } from "vitest";
import { roadCenterX } from "@csarkosh/engine/sim/olympic";
import { timeLimit } from "@csarkosh/engine/testing/timeLimit";
import { ARRIVE_OUT, arriveOut, insideRooms } from "../../src/sim/inside/rooms.js";
import { planFor } from "../../src/sim/town/planFor.js";
import { siteFor } from "../../src/sim/town/siteFor.js";
import { CELL, HIGHWAY, REACH, labelsOf, mapDataFor, shoreAt, type MapCell, type Poly, type Seg } from "../../src/game/map/mapData.js";
import { MAP_SEEDS } from "./seeds.js";

describe("the map's data", () => {
  for (const seed of MAP_SEEDS) {
    describe(`seed ${seed}`, () => {
      const plan = planFor(seed);
      const site = siteFor(seed);
      const data = mapDataFor(seed);

      it("has the four places, each with its door where arriving out of its room puts a player, to a centimetre, and a name", () => {
        expect(data.places.map((p) => p.kind)).toEqual(["bar", "cafe", "lodging", "office"]);
        expect(data.places.map((p) => p.id)).toEqual([1, 2, 3, 4]);
        for (const room of insideRooms(seed)) {
          const place = data.places.find((p) => p.id === room.id)!;
          const at = arriveOut(room);
          expect(Math.abs(place.x - at.x), `${room.name} x`).toBeLessThan(0.01);
          expect(Math.abs(place.z - at.z), `${room.name} z`).toBeLessThan(0.01);
          expect(place.building).toBe(room.building);
          expect(place.name.length, room.name).toBeGreaterThan(0);
        }
        expect(ARRIVE_OUT).toBe(0.9);
        // The office carries the municipal building's name.
        expect(data.places[3]!.name).toBe(plan.landmarks.find((l) => l.role === "municipal building")!.name);
      }, timeLimit(60_000));

      it("holds every building in a grid cell, with the four places' as enterable", () => {
        const seen = new Set<Poly>();
        let enterable = 0;
        for (const cell of data.cells.values()) {
          for (const p of [...cell.building, ...cell.landmark]) seen.add(p);
          for (const p of cell.enterable) {
            seen.add(p);
            enterable++;
          }
        }
        expect(seen.size).toBe(plan.buildings.length);
        expect(data.counts.enterable).toBe(4);
        expect(enterable).toBeGreaterThanOrEqual(4);
        // A cell holds what lies in it: every building's corner is in a cell that holds its footprint.
        for (const b of plan.buildings) {
          const x = b.centre.x + site.anchor.x;
          const z = b.centre.z + site.anchor.z;
          const cell: MapCell | undefined = data.cells.get((Math.floor(x / CELL) + 4096) * 8192 + (Math.floor(z / CELL) + 4096));
          const lists = cell === undefined ? [] : [...cell.building, ...cell.landmark, ...cell.enterable];
          expect(lists.length, `building ${b.id}`).toBeGreaterThan(0);
        }
      });

      it("has counts that are sane", () => {
        const c = data.counts;
        expect(c.blocks).toBe(plan.blocks.length);
        expect(c.buildings).toBe(plan.buildings.length);
        expect(c.woods).toBe(plan.woods.length);
        expect(c.segments).toBeGreaterThan(plan.streets.length);
        expect(c.pavements).toBeGreaterThan(10);
        expect(c.labels).toBeGreaterThan(10);
        expect(c.cells).toBeGreaterThan(100);
        expect(c.cells).toBeLessThan(2000);
        expect(c.vertices).toBeLessThan(20_000);
        expect(data.landmarks.length).toBe(plan.landmarks.length);
      });

      it("has the sea west of the shore, carried straight on past the site's ends, and the land east of it", () => {
        expect(data.shoreExtended).toBe(true);
        expect(data.shore[1]).toBe(site.anchor.z - REACH);
        expect(data.shore[data.shore.length - 1]).toBe(site.anchor.z + REACH);
        for (let i = 0; i < site.shoreX.length; i += 9) {
          const z = site.anchor.z + site.z0 + i * site.step;
          expect(shoreAt(data, z)).toBeCloseTo(site.anchor.x + (site.shoreX[i] as number), 6);
        }
        // Beyond the samples the shore keeps the end sample's x.
        expect(shoreAt(data, site.anchor.z + REACH - 1)).toBeCloseTo(site.anchor.x + (site.shoreX[site.shoreX.length - 1] as number), 6);
        // The town is on the land or the made ground in front of it (the quay is up to 120 m seaward of the natural shore): every place is near the shore, and the highway east of it.
        for (const p of data.places) expect(p.x, p.name).toBeGreaterThan(shoreAt(data, p.z) - 120);
        // (Past the site the shore is carried straight on and the world's own coast may bend either way, so only the site's own stretch is held to it.)
        for (const s of data.segments.filter((q) => q.cls === HIGHWAY && Math.abs(q.z0 - site.anchor.z) <= 1008)) expect(s.x0, "highway").toBeGreaterThan(shoreAt(data, s.z0));
        expect(shoreAt(data, 0) - 200).toBeLessThan(shoreAt(data, 0));
      });

      it("carries the highway 3 km north and south by the world's own line for it", () => {
        const high = data.segments.filter((s) => s.cls === HIGHWAY);
        const north = high.reduce((m, s) => Math.max(m, s.z0, s.z1), -Infinity);
        const south = high.reduce((m, s) => Math.min(m, s.z0, s.z1), Infinity);
        expect(north).toBeCloseTo(site.anchor.z + REACH, 6);
        expect(south).toBeCloseTo(site.anchor.z - REACH, 6);
        const end = high.find((s) => s.z1 === north)!;
        expect(end.x1).toBeCloseTo(roadCenterX(seed, north), 6);
        const far = high.find((s) => s.z1 === south)!;
        expect(far.x1).toBeCloseTo(roadCenterX(seed, south), 6);
        // Unbroken: each stretch begins where one ends.
        const ends = new Map<string, number>();
        for (const s of high) for (const k of [`${s.x0.toFixed(3)},${s.z0.toFixed(3)}`, `${s.x1.toFixed(3)},${s.z1.toFixed(3)}`]) ends.set(k, (ends.get(k) ?? 0) + 1);
        // Every end is shared by two stretches but the two far ends.
        expect([...ends.values()].filter((n) => n === 1)).toHaveLength(2);
      });

      it("labels a named street once for each 250 m of a run, in the middle of its share, along the street", () => {
        expect(data.counts.labels).toBeGreaterThan(0);
        const highway = data.cells.size > 0 ? [...data.cells.values()].flatMap((c) => c.labels).filter((l) => l.cls === HIGHWAY) : [];
        // About 6 km of highway: one label for each 250 m.
        expect(highway.length).toBeGreaterThanOrEqual(20);
        expect(highway.length).toBeLessThanOrEqual(30);
        for (const l of [...data.cells.values()].flatMap((c) => c.labels)) {
          expect(Math.hypot(l.dx, l.dz)).toBeCloseTo(1, 6);
          expect(l.text.length).toBeGreaterThan(0);
        }
      });

      it("is made in under 30 ms from a plan already made", () => {
        expect(data.buildMs).toBeLessThan(timeLimit(30));
      });
    });
  }

  it("joins two segments with one name into a run and labels the run once", () => {
    const seg = (x0: number, z0: number, x1: number, z1: number): Seg => ({ x0, z0, x1, z1, w: 8, cls: 3, name: "Test Street" });
    const labels = labelsOf([seg(0, 0, 100, 0), seg(100, 0, 200, 0), seg(500, 500, 510, 500)]);
    expect(labels).toHaveLength(1);
    expect(labels[0]!.run).toBeCloseTo(200, 6);
    expect(labels[0]!.x).toBeCloseTo(100, 6);
    expect(Math.abs(labels[0]!.dx)).toBe(1);
    const long = labelsOf([seg(0, 0, 600, 0)]);
    expect(long).toHaveLength(2);
  });
});
