import "../../src/terrain.js";
import { beforeEach, describe, expect, it } from "vitest";
import { timeLimit } from "@csarkosh/engine/testing/timeLimit";
import { planFor } from "../../src/sim/town/planFor.js";
import { siteFor } from "../../src/sim/town/siteFor.js";
import { STAIR, mapDataFor, type MapData } from "../../src/game/map/mapData.js";
import { ARRIVED, MAX_WAYPOINTS, OFF_ROUTE, chooseDestination, clearDestination, formatDistance, goalOf, nav, newTracker, placeWaypoint, removeWaypoint, resetNav, updateTracker } from "../../src/game/map/mapNav.js";
import { SNAP_START, advanceRoute, allowed, graphFor, nearRoute, planRoute, routeLengths, snapTo, streetNear, type Profile } from "../../src/game/map/mapRoute.js";
import { MAP_SEEDS } from "./seeds.js";

/** The distance from a point to the nearest centre line of any street, road out or stair of the data. */
function offStreets(data: MapData, x: number, z: number): number {
  let best = Infinity;
  for (const s of data.segments) {
    const dx = s.x1 - s.x0;
    const dz = s.z1 - s.z0;
    const t = Math.max(0, Math.min(1, ((x - s.x0) * dx + (z - s.z0) * dz) / (dx * dx + dz * dz)));
    best = Math.min(best, Math.hypot(s.x0 + dx * t - x, s.z0 + dz * t - z));
  }
  return best;
}

describe("routes over the streets", () => {
  for (const seed of MAP_SEEDS) {
    describe(`seed ${seed}`, () => {
      const plan = planFor(seed);
      const site = siteFor(seed);
      const data = mapDataFor(seed);
      const g = graphFor(data);
      const spawn = { x: plan.spawn.x + site.anchor.x, z: plan.spawn.z + site.anchor.z };
      const points = [spawn, ...data.places];

      it("has a graph of a few hundred nodes, made in a few milliseconds", () => {
        expect(g.nodeX.length).toBeGreaterThan(100);
        expect(g.nodeX.length).toBeLessThan(1000);
        expect(g.buildMs).toBeLessThan(timeLimit(100));
      });

      for (const profile of ["foot", "drive"] as Profile[]) {
        it(`finds a ${profile} route from the spawn to each place and between every pair, along the streets, no shorter than the straight line and no more than three times it`, () => {
          let routes = 0;
          for (const a of points) {
            for (const b of points) {
              if (a === b) continue;
              const r = planRoute(g, profile, a.x, a.z, b.x, b.z);
              routes++;
              expect(r.straight, "a route exists").toBe(false);
              const n = r.pts.length / 2;
              // Every point but the first (the player's) and the last two (the street's end and the door) lies on a street's or a road out's centre line, within 1.5 m.
              for (let i = 1; i < n - 1; i++) expect(offStreets(data, r.pts[i * 2] as number, r.pts[i * 2 + 1] as number), `point ${i}`).toBeLessThan(1.5);
              const straight = Math.hypot(a.x - b.x, a.z - b.z);
              expect(r.length).toBeGreaterThanOrEqual(straight - 1e-6);
              // The stretch along the streets, between where the two ends meet them, is at most three times the straight distance between those two points.
              const sx = r.pts[2] as number, sz = r.pts[3] as number, ex = r.pts[(n - 2) * 2] as number, ez = r.pts[(n - 2) * 2 + 1] as number;
              const between = Math.hypot(sx - ex, sz - ez);
              let along = 0;
              for (let i = 2; i < n - 1; i++) along += Math.hypot((r.pts[i * 2] as number) - (r.pts[i * 2 - 2] as number), (r.pts[i * 2 + 1] as number) - (r.pts[i * 2 - 1] as number));
              expect(along, `${a.x.toFixed(0)},${a.z.toFixed(0)} to ${b.x.toFixed(0)},${b.z.toFixed(0)}`).toBeLessThanOrEqual(3 * between + 1);
              expect(r.names).toHaveLength(n - 1);
              let sum = 0;
              for (let i = 1; i < n; i++) sum += Math.hypot((r.pts[i * 2] as number) - (r.pts[i * 2 - 2] as number), (r.pts[i * 2 + 1] as number) - (r.pts[i * 2 - 1] as number));
              expect(r.length).toBeCloseTo(sum, 6);
            }
          }
          expect(routes).toBe(points.length * (points.length - 1));
        }, timeLimit(60_000));
      }

      it("uses no stair driving", () => {
        expect(allowed("drive", STAIR)).toBe(false);
        expect(allowed("foot", STAIR)).toBe(true);
        const stairs = new Set(data.segments.filter((s) => s.cls === STAIR).map((s) => s.name));
        for (const a of points) {
          for (const b of points) {
            if (a === b) continue;
            const r = planRoute(g, "drive", a.x, a.z, b.x, b.z);
            for (const name of r.names) expect(stairs.has(name) && name !== "", `${name} is a stair`).toBe(false);
          }
        }
      });

      it("snaps a point to the nearest point of a street, and a start far from every street goes straight to the nearest", () => {
        const s = snapTo(g, "foot", spawn.x, spawn.z)!;
        expect(s.dist).toBeLessThan(SNAP_START);
        expect(offStreets(data, s.x, s.z)).toBeLessThan(1.5);
        // Out at sea, west of everything: far from every street, so the route starts with a straight run.
        const far = { x: spawn.x - 1500, z: spawn.z };
        const r = planRoute(g, "foot", far.x, far.z, data.places[0]!.x, data.places[0]!.z);
        expect(r.offStreet).toBe(true);
        expect(r.straight).toBe(false);
        expect(r.pts[0]).toBe(far.x);
        expect(planRoute(g, "foot", spawn.x, spawn.z, data.places[0]!.x, data.places[0]!.z).offStreet).toBe(false);
        // The nearest street's name is known at the spawn, and not out at sea.
        expect(streetNear(g, "foot", far.x, far.z)).toBe("");
      });

      it("gives each place's route length from a start as the route itself has it", () => {
        const lens = routeLengths(g, "foot", spawn.x, spawn.z, data.places);
        data.places.forEach((p, i) => expect(lens[i]).toBeCloseTo(planRoute(g, "foot", spawn.x, spawn.z, p.x, p.z).length, 1));
      });
    });
  }
});

describe("keeping a route as the player moves", () => {
  const seed = MAP_SEEDS[0] as number;
  const data = mapDataFor(seed);
  const g = graphFor(data);
  const hall = data.places[3]!;
  const bar = data.places[0]!;
  const grab = (): Parameters<typeof updateTracker>[1] => () => g;
  beforeEach(() => resetNav(seed));

  it("drops the part already travelled as the player moves along, and the length is what is left", () => {
    const r = planRoute(g, "foot", hall.x, hall.z, bar.x, bar.z);
    const total = r.length;
    // Walk 60 m along the route's own line.
    let at = 60;
    let x = r.pts[0] as number, z = r.pts[1] as number;
    for (let i = 2; i < r.pts.length && at > 0; i += 2) {
      const d = Math.hypot((r.pts[i] as number) - x, (r.pts[i + 1] as number) - z);
      const k = Math.min(1, at / d);
      x += ((r.pts[i] as number) - x) * k;
      z += ((r.pts[i + 1] as number) - z) * k;
      at -= d;
    }
    advanceRoute(r, x, z);
    expect(r.length).toBeCloseTo(total - 60, 0);
    expect(r.pts[0]).toBeCloseTo(x, 6);
    expect(r.pts[1]).toBeCloseTo(z, 6);
    expect(nearRoute(r, x, z).d).toBeLessThan(1e-6);
    expect(r.names).toHaveLength(r.pts.length / 2 - 1);
  });

  it("makes a route again when the goal or the profile changes, at once", () => {
    const t = newTracker();
    const a = updateTracker(t, grab(), 10, hall.x, hall.z, "foot", bar);
    expect(updateTracker(t, grab(), 10.1, hall.x, hall.z, "foot", bar)).toBe(a);
    const b = updateTracker(t, grab(), 10.2, hall.x, hall.z, "foot", data.places[1]!);
    expect(b).not.toBe(a);
    const c = updateTracker(t, grab(), 10.3, hall.x, hall.z, "drive", data.places[1]!);
    expect(c).not.toBe(b);
    expect(c!.profile).toBe("drive");
    expect(updateTracker(t, grab(), 10.4, hall.x, hall.z, "drive", null)).toBeNull();
  });

  it("makes a route again when the player is more than 15 m off it, but not more than once a second", () => {
    const t = newTracker();
    const a = updateTracker(t, grab(), 100, hall.x, hall.z, "foot", bar)!;
    // 12 m off: not far enough. 40 m off: far enough, but too soon after the first.
    const near = updateTracker(t, grab(), 100.2, hall.x + 8, hall.z + 9, "foot", bar);
    expect(near).toBe(a);
    expect(OFF_ROUTE).toBe(15);
    const soon = updateTracker(t, grab(), 100.4, hall.x + 400, hall.z + 400, "foot", bar);
    expect(soon).toBe(a);
    const later = updateTracker(t, grab(), 101.2, hall.x + 400, hall.z + 400, "foot", bar)!;
    expect(later).not.toBe(a);
    expect(later.pts[0]).toBeCloseTo(hall.x + 400, 6);
  });
});

describe("the destination and the waypoints", () => {
  const seed = MAP_SEEDS[0] as number;
  const data = mapDataFor(seed);
  beforeEach(() => resetNav(seed));

  it("keeps five flags, the newest replacing the oldest, with the newest the destination", () => {
    for (let i = 0; i < 7; i++) placeWaypoint(i * 10, i * 10);
    expect(nav.waypoints).toHaveLength(MAX_WAYPOINTS);
    expect(nav.waypoints.map((w) => w.id)).toEqual([3, 4, 5, 6, 7]);
    expect(nav.dest).toEqual({ kind: "waypoint", id: 7 });
    removeWaypoint(7);
    expect(nav.dest).toBeNull();
    expect(goalOf(data)).toBeNull();
  });

  it("answers a place or a flag as a goal with a name, and clears", () => {
    chooseDestination("place", 3);
    expect(goalOf(data)).toEqual({ x: data.places[2]!.x, z: data.places[2]!.z, name: data.places[2]!.name });
    placeWaypoint(5, 6);
    expect(goalOf(data)).toEqual({ x: 5, z: 6, name: "Waypoint" });
    clearDestination();
    expect(goalOf(data)).toBeNull();
    expect(nav.waypoints).toHaveLength(1);
    expect(ARRIVED).toBe(8);
  });

  it("says a distance to 5 m under 100, to 10 m under a kilometre, in kilometres after", () => {
    expect([0, 12, 98, 240, 244, 996, 1040, 2500].map(formatDistance)).toEqual(["0 m", "10 m", "100 m", "240 m", "240 m", "1000 m", "1.0 km", "2.5 km"]);
  });
});
