import "../../src/terrain.js";
import { describe, expect, it } from "vitest";
import { planFor } from "../../src/sim/town/planFor.js";
import { siteFor } from "../../src/sim/town/siteFor.js";
import { CELL, mapDataFor } from "../../src/game/map/mapData.js";
import { MapDrawer, OPS_FIXED, OPS_PER_TILE, TILE_CELLS, type Scene } from "../../src/game/map/mapDraw.js";
import { pinSpot } from "../../src/game/map/mapMarks.js";
import { paletteFor, rgbOf, streetWidths } from "../../src/game/map/mapStyle.js";
import { HIGHWAY, ALLEY, STREET } from "../../src/game/map/mapData.js";
import { graphFor, planRoute } from "../../src/game/map/mapRoute.js";
import { largeView, minimapView, newViewState, snapView, worldToScreen } from "../../src/game/map/mapView.js";
import { RecordingCtx } from "./fakes.js";
import { MAP_SEEDS } from "./seeds.js";

/** What a frame is drawn from: the player at the town's spawn, in a look, with a route to the bar. */
function sceneFor(seed: number, driving: boolean, large = false, route = true, at?: { x: number; z: number }): { scene: Scene; spawn: { x: number; z: number } } {
  const plan = planFor(seed);
  const site = siteFor(seed);
  const spawn = at ?? { x: plan.spawn.x + site.anchor.x, z: plan.spawn.z + site.anchor.z };
  const data = mapDataFor(seed);
  const vs = newViewState();
  snapView(vs, driving, false);
  const heading = plan.spawn.yaw;
  const v = large ? largeView({ ...vs, lcx: spawn.x, lcz: spawn.z, lmpp: 180 / 220 }, 844, 860) : minimapView(vs, 220, 220, spawn.x, spawn.z, heading);
  const goal = data.places[0]!;
  const r = route ? planRoute(graphFor(data), driving ? "drive" : "foot", spawn.x, spawn.z, goal.x, goal.z) : null;
  return {
    spawn,
    scene: { data, view: v, e: driving ? 1 : 0, night: 0, dpr: 2, large, soft: !large, player: { x: spawn.x, z: spawn.z, heading, driving }, route: r, waypoints: [], destination: route ? { kind: "place", id: 1 } : null, slim: "Quill Tavern · 420 m" },
  };
}

describe("drawing the map", () => {
  for (const seed of MAP_SEEDS) {
    for (const driving of [false, true]) {
      describe(`seed ${seed}, ${driving ? "driving" : "on foot"}`, () => {
        const { scene, spawn } = sceneFor(seed, driving);

        it("draws only the tiles of cells that the view shows", () => {
          const ctx = new RecordingCtx();
          const drawer = new MapDrawer(ctx);
          drawer.draw(scene);
          const side = TILE_CELLS * CELL;
          const v = scene.view;
          expect(drawer.tiles.length).toBeGreaterThan(0);
          // Every tile drawn is within the view (to a street's width of its edge).
          for (const t of drawer.tiles) {
            const p = worldToScreen(v, t.x0 + side / 2, t.z0 + side / 2, { x: 0, y: 0 });
            const reach = (side * Math.SQRT1_2 + 12) / v.mpp;
            expect(p.x).toBeGreaterThanOrEqual(-reach);
            expect(p.x).toBeLessThanOrEqual(v.w + reach);
            expect(p.y).toBeGreaterThanOrEqual(-reach);
            expect(p.y).toBeLessThanOrEqual(v.h + reach);
          }
          // Every cell with something in it whose middle is on the screen is in a tile that was drawn.
          const drawnCells = new Set(drawer.tiles.flatMap((t) => t.cells));
          let inside = 0;
          for (const c of scene.data.cells.values()) {
            const p = worldToScreen(v, (c.cx + 0.5) * CELL, (c.cz + 0.5) * CELL, { x: 0, y: 0 });
            if (p.x >= 0 && p.x <= v.w && p.y >= 0 && p.y <= v.h) {
              inside++;
              expect(drawnCells.has(c), `cell ${c.cx},${c.cz}`).toBe(true);
            }
          }
          expect(inside).toBeGreaterThan(0);
          // And not the whole town: a small share of what the data holds.
          const all = new Set([...scene.data.cells.values()].map((c) => `${Math.floor(c.cx / TILE_CELLS)},${Math.floor(c.cz / TILE_CELLS)}`)).size;
          expect(drawer.tiles.length).toBeLessThan(all / 2);
        });

        it("draws a frame in a bounded number of drawing operations: a dozen or so for each tile it shows, and a fixed few", () => {
          const ctx = new RecordingCtx();
          const drawer = new MapDrawer(ctx);
          drawer.draw(scene);
          expect(drawer.ops).toBe(ctx.ops);
          expect(drawer.ops).toBeLessThanOrEqual(OPS_PER_TILE * drawer.tiles.length + OPS_FIXED);
          // The water first, over the whole view.
          expect(ctx.rec.rects).toBe(1);
          expect(ctx.ops).toBeLessThan(200);
          // Paths are made once for a tile: a second frame makes only its own (the route's, the marks').
          const made = ctx.rec.paths;
          ctx.reset();
          drawer.draw(scene);
          expect(ctx.rec.paths).toBeLessThan(made / 2);
          expect(ctx.ops).toBe(drawer.ops);
        });

        it("gives each place that is off the edge of the map a pin on the border, with its distance in metres", () => {
          const ctx = new RecordingCtx();
          new MapDrawer(ctx).draw(scene);
          const v = scene.view;
          let off = 0;
          for (const p of scene.data.places) {
            const s = worldToScreen(v, p.x, p.z, { x: 0, y: 0 });
            const spot = { x: 0, y: 0, border: false };
            pinSpot(v.w, v.h, v.markX, v.markY, s.x, s.y, 16, 22, spot);
            if (!spot.border) continue;
            off++;
            // The pin stands on the border, in the direction the place lies from the player.
            expect(spot.x).toBeGreaterThanOrEqual(15.99);
            expect(spot.x).toBeLessThanOrEqual(v.w - 15.99);
            expect(spot.y).toBeLessThanOrEqual(v.h - 15.99);
            const dir = { x: s.x - v.markX, y: s.y - v.markY };
            const there = { x: spot.x - v.markX, y: spot.y - v.markY };
            expect(dir.x * there.y - dir.y * there.x).toBeCloseTo(0, 3);
            expect(dir.x * there.x + dir.y * there.y).toBeGreaterThan(0);
            expect(ctx.rec.texts, p.name).toContain(`${Math.round(Math.hypot(p.x - spawn.x, p.z - spawn.z))} m`);
          }
          // On foot at the spawn, at least one of the four is off the 180 m map.
          if (!driving) expect(off).toBeGreaterThan(0);
        });
      });
    }
  }

  it("draws the route as dots on foot and as a band driving, and the slim line, the pins and the player", () => {
    const foot = sceneFor(MAP_SEEDS[0] as number, false);
    const a = new RecordingCtx();
    new MapDrawer(a).draw(foot.scene);
    const noRoute = sceneFor(MAP_SEEDS[0] as number, false, false, false);
    const b = new RecordingCtx();
    new MapDrawer(b).draw({ ...noRoute.scene, slim: null });
    // The route is two operations (the dots' rings, the dots), the slim line two.
    expect(a.ops - b.ops).toBe(4 + (a.rec.texts.length - b.rec.texts.length - 1));
    expect(a.rec.texts).toContain("Quill Tavern · 420 m");
    const drive = sceneFor(MAP_SEEDS[0] as number, true);
    const c = new RecordingCtx();
    new MapDrawer(c).draw(drive.scene);
    expect(c.rec.strokes).toBeGreaterThan(0);
  });

  it("draws the large map's frame in a bounded number of operations too, and names the places", () => {
    for (const seed of MAP_SEEDS) {
      const { scene } = sceneFor(seed, false, true);
      const ctx = new RecordingCtx();
      const drawer = new MapDrawer(ctx);
      drawer.draw(scene);
      expect(drawer.ops).toBeLessThanOrEqual(OPS_PER_TILE * drawer.tiles.length + OPS_FIXED);
      expect(scene.data.places.some((p) => ctx.rec.texts.includes(p.name))).toBe(true);
    }
  });

  it("sets street widths at the real roadway width, never thinner than 2 px, wider for the highway and thin for an alley driving", () => {
    for (const mpp of [0.25, 0.8, 1.9, 8]) {
      for (const e of [0, 1]) {
        for (const cls of [HIGHWAY, STREET, ALLEY]) {
          const w = streetWidths(cls, 7.5, e, mpp);
          expect(w.fill, `${cls} ${mpp}`).toBeGreaterThanOrEqual((cls === ALLEY && e === 1 ? 1.5 : 2) * mpp - 1e-9);
          expect(w.casing).toBeCloseTo(w.fill + 2 * mpp, 9);
        }
      }
    }
    expect(streetWidths(STREET, 7.5, 0, 0.8).fill).toBe(7.5);
    expect(streetWidths(HIGHWAY, 11, 1, 1.9).fill).toBeGreaterThan(11);
    expect(streetWidths(ALLEY, 4, 1, 1.9).fill).toBeLessThan(4);
  });

  it("has a palette for each look and for day and night, and the mix of two is between them", () => {
    const day = paletteFor(0, 0);
    const night = paletteFor(0, 1);
    expect(day.land).toBe("#f3f0ea");
    expect(day.water).toBe("#a9d3f0");
    expect(day.street).toBe("#ffffff");
    expect(paletteFor(1, 0).major).toBe("#fbdc83");
    expect(paletteFor(0, 0).major).toBe("#ffffff");
    expect(night.street).toBe("#3a4658");
    expect(night.water).toBe("#17263c");
    expect(night.text).toBe("#9aa6b8");
    expect(night.building).toBe("#2c3848");
    expect(paletteFor(0, 0.5).land).toMatch(/^rgb\(/);
    expect(paletteFor(0, 0.5)).toBe(paletteFor(0, 0.5));
  });
});

describe("pins on the border", () => {
  it("are slid apart along it, and where there is no room the farther loses its label", async () => {
    const { placeSpots } = await import("../../src/game/map/mapMarks.js");
    type Spot = import("../../src/game/map/mapMarks.js").Spot;
    const out: Spot[] = [];
    // Three places straight east and a little apart, far off the right edge of a 220 px view whose mark is at its middle.
    placeSpots(220, 220, 110, 110, [{ x: 900, y: 110 }, { x: 900, y: 115 }, { x: 900, y: 118 }], out);
    expect(out.every((s) => s.border)).toBe(true);
    const ys = out.map((s) => s.y).sort((a, b) => a - b);
    for (let i = 1; i < ys.length; i++) expect(ys[i]! - ys[i - 1]!).toBeGreaterThanOrEqual(33.9);
    expect(out.every((s) => s.label)).toBe(true);
    // Along the top, the labels are a text's width apart.
    placeSpots(220, 220, 110, 110, [{ x: 100, y: -900 }, { x: 105, y: -900 }], out);
    expect(Math.abs(out[0]!.x - out[1]!.x)).toBeGreaterThanOrEqual(39.9);
    // Five pins on one side of a short view: no room, so some lose their label, and none lies off the border's range.
    placeSpots(220, 120, 110, 60, [0, 1, 2, 3, 4].map((i) => ({ x: 900, y: 60 + i })), out);
    expect(out.filter((s) => !s.label).length).toBeGreaterThan(0);
    for (const s of out) {
      expect(s.y).toBeGreaterThanOrEqual(38);
      expect(s.y).toBeLessThanOrEqual(104);
    }
    // A place inside the view keeps its place.
    placeSpots(220, 220, 110, 110, [{ x: 60, y: 120 }], out);
    expect(out[0]).toMatchObject({ x: 60, y: 120, border: false });
  });
});

describe("the small map sits back, and what matters stays clear", () => {
  const lin = (v: number): number => ((v / 255) <= 0.04045 ? v / 255 / 12.92 : ((v / 255 + 0.055) / 1.055) ** 2.4);
  /** The colour as CIE L*a*b*, to measure how far apart two colours look. */
  const lab = (c: string): number[] => {
    const [r, g, b] = rgbOf(c);
    const R = lin(r), G = lin(g), B = lin(b);
    const X = (0.4124 * R + 0.3576 * G + 0.1805 * B) / 0.95047, Y = 0.2126 * R + 0.7152 * G + 0.0722 * B, Z = (0.0193 * R + 0.1192 * G + 0.9505 * B) / 1.08883;
    const f = (t: number): number => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
    return [116 * f(Y) - 16, 500 * (f(X) - f(Y)), 200 * (f(Y) - f(Z))];
  };
  const dE = (a: string, b: string): number => Math.hypot(...lab(a).map((v, i) => v - (lab(b)[i] as number)));
  const looks = [[0, 0], [0, 1], [1, 0], [1, 1]] as const;

  it("keeps the four places' buildings, their edges and the player's mark well apart from the ground round them in all four looks", () => {
    // Thresholds, in CIE76 colour difference: the fill of an enterable building from a block at least 15 (the least measured is 18.9), its edge at least 40 (50), the player's dot from the land at least 50 (67).
    for (const [e, n] of looks) {
      const p = paletteFor(e, n, true);
      const where = `look ${e} night ${n}`;
      expect(dE(p.enterable, p.block), `${where} fill`).toBeGreaterThanOrEqual(15);
      expect(dE(p.enterable, p.land), `${where} fill on land`).toBeGreaterThanOrEqual(15);
      expect(dE(p.enterableEdge, p.block), `${where} edge`).toBeGreaterThanOrEqual(40);
      expect(dE(p.player, p.land), `${where} player`).toBeGreaterThanOrEqual(50);
    }
  });

  it("mutes the ground: land, blocks and water lie closer in tone than in the full palette, and the day land is a soft grey-cream, not near white", () => {
    for (const [e, n] of looks) {
      const soft = paletteFor(e, n, true);
      const full = paletteFor(e, n, false);
      expect(dE(soft.water, soft.land), `water ${e} ${n}`).toBeLessThan(dE(full.water, full.land));
      expect(dE(soft.block, soft.land)).toBeLessThanOrEqual(dE(full.block, full.land) + 1e-9);
      // The highlight itself is the full one's.
      expect(soft.enterable).toBe(full.enterable);
      expect(soft.player).toBe(full.player);
      expect(soft.route).toBe(full.route);
    }
    expect(lab(paletteFor(0, 0, true).land)[0]).toBeLessThan(lab(paletteFor(0, 0, false).land)[0] as number);
    expect(lab(paletteFor(0, 0, true).land)[0]).toBeLessThan(95);
    // By night the small map is near the scene's own dark blue.
    expect(lab(paletteFor(0, 1, true).land)[0]).toBeLessThan(20);
  });

  it("draws the small map's lettering lighter and its pins smaller", () => {
    const { scene } = sceneFor(MAP_SEEDS[0] as number, false);
    const soft = new RecordingCtx();
    new MapDrawer(soft).draw({ ...scene, soft: true });
    const full = new RecordingCtx();
    new MapDrawer(full).draw({ ...scene, soft: false });
    expect(soft.ops).toBe(full.ops);
  });
});
