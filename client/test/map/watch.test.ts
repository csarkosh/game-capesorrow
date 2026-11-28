import "../../src/terrain.js";
import { describe, expect, it } from "vitest";
import { mapDataFor } from "../../src/game/map/mapData.js";
import { MapDrawer, type Scene } from "../../src/game/map/mapDraw.js";
import { CLOCK_ARC, ringSpots, type Spot } from "../../src/game/map/mapMarks.js";
import { screenToWorld, watchView, worldToScreen } from "../../src/game/map/mapView.js";
import { WATCH_KEEP_OUT, WATCH_BACKING_MAX, WATCH_H, WATCH_RING, WATCH_W, applyMatrix, createPlacement, drawWatchRim, drawWatchStatus, fadeFor, formatClock, matrixCss, quadMatrix, watchBacking } from "../../src/game/map/watchScreen.js";
import { paletteFor, rgbOf } from "../../src/game/map/mapStyle.js";
import { formatDistance } from "../../src/game/map/mapNav.js";
import { RecordingCtx } from "./fakes.js";

describe("laying the watch's screen on its face", () => {
  const square = [0, 0, WATCH_W, 0, WATCH_W, WATCH_H, 0, WATCH_H];

  it("is the identity for an upright face of the screen's own size and place", () => {
    const m = quadMatrix(square, WATCH_W, WATCH_H);
    const id = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
    m.forEach((v, i) => expect(v, `${i}`).toBeCloseTo(id[i] as number, 9));
  });

  it("carries the screen's four corners onto a tilted, rotated, foreshortened face to within half a pixel, and the middle inside it", () => {
    // A face as the view may show it: turned about 12 degrees, one side nearer than the other.
    const faces = [
      [400, 520, 585, 560, 570, 745, 380, 700],
      [610, 300, 790, 330, 760, 520, 600, 470],
      [100, 100, 300, 120, 320, 330, 120, 300],
    ];
    for (const quad of faces) {
      const m = quadMatrix(quad, WATCH_W, WATCH_H);
      const corners = [[0, 0], [WATCH_W, 0], [WATCH_W, WATCH_H], [0, WATCH_H]] as const;
      corners.forEach(([x, y], i) => {
        const p = applyMatrix(m, x, y);
        expect(Math.abs(p.x - (quad[i * 2] as number)), `corner ${i} x`).toBeLessThan(0.5);
        expect(Math.abs(p.y - (quad[i * 2 + 1] as number)), `corner ${i} y`).toBeLessThan(0.5);
      });
      const mid = applyMatrix(m, WATCH_W / 2, WATCH_H / 2);
      expect(mid.x).toBeGreaterThan(Math.min(quad[0] as number, quad[6] as number));
      expect(mid.x).toBeLessThan(Math.max(quad[2] as number, quad[4] as number));
    }
    expect(matrixCss(quadMatrix(faces[0] as number[], WATCH_W, WATCH_H))).toMatch(/^matrix3d\((-?[\d.e-]+,){15}-?[\d.e-]+\)$/);
  });

  it("writes the style only when a corner has moved by more than a fraction of a pixel", () => {
    const el = { style: { transform: "" } };
    const place = createPlacement(el);
    const quad = [0.3, 0.5, 0.45, 0.52, 0.44, 0.74, 0.29, 0.72];
    expect(place.place(quad, 1000, 800)).toBe(true);
    const first = el.style.transform;
    expect(first).toMatch(/^matrix3d/);
    // A still arm: no write. Under 0.2 px of drift: none. A bob of a pixel: one.
    expect(place.place(quad, 1000, 800)).toBe(false);
    expect(place.place(quad.map((v) => v + 0.1 / 1000), 1000, 800)).toBe(false);
    expect(el.style.transform).toBe(first);
    expect(place.place(quad.map((v, i) => v + (i % 2 === 0 ? 1 / 1000 : 0)), 1000, 800)).toBe(true);
    expect(el.style.transform).not.toBe(first);
    place.forget();
    expect(place.place(quad, 1000, 800)).toBe(true);
  });

  it("comes on as the wrist comes up: dark below 0.6, whole at 1", () => {
    expect([0, 0.3, 0.6, 0.8, 1, 1.4].map(fadeFor)).toEqual([0, 0, 0, expect.closeTo(0.5, 9), 1, 1]);
  });

  it("makes the backing the face's size times the device's ratio, at most 512, and only when it changes by more than 10 percent", () => {
    expect(watchBacking(200, 2, 0)).toBe(400);
    expect(watchBacking(400, 2, 0)).toBe(WATCH_BACKING_MAX);
    expect(watchBacking(10, 1, 0)).toBe(64);
    // A bobbing face: 200 to 215 px at ratio 2 is 400 to 430, within 10 percent of the 400 held.
    expect(watchBacking(215, 2, 400)).toBe(400);
    expect(watchBacking(180, 2, 400)).toBe(400);
    expect(watchBacking(230, 2, 400)).toBe(460);
    expect(watchBacking(150, 2, 400)).toBe(300);
    expect(watchBacking(600, 2, 460)).toBe(512);
  });

  it("reads the game's hour as a clock", () => {
    expect([0, 9.5, 12, 13.25, 23.99, 24, 6.02].map(formatClock)).toEqual(["00:00", "09:30", "12:00", "13:15", "23:59", "00:00", "06:01"]);
  });
});

describe("the round screen's layout", () => {
  it("puts the player's mark a little below the middle, heading up", () => {
    const v = watchView(WATCH_W, WATCH_H, 100, 200, 0.8);
    expect([v.markX, v.markY]).toEqual([WATCH_W / 2, WATCH_H * 0.55]);
    const ahead = worldToScreen(v, 100 + Math.sin(0.8) * 40, 200 + Math.cos(0.8) * 40, { x: 0, y: 0 });
    expect(ahead.x).toBeCloseTo(WATCH_W / 2, 6);
    expect(ahead.y).toBeLessThan(v.markY);
    const back = screenToWorld(v, ahead.x, ahead.y, { x: 0, z: 0 });
    expect(back.x).toBeCloseTo(100 + Math.sin(0.8) * 40, 6);
    // 180 m across the 180 px screen.
    expect(v.mpp).toBeCloseTo(1, 9);
  });

  it("puts pins for places off the map on a ring just inside the circle, apart, with the distances inside the ring", () => {
    const c = WATCH_W / 2;
    const out: Spot[] = [];
    // Three places far to the east and north-east, one inside the ring.
    ringSpots(c, c, WATCH_RING, c, c * 1.1, [{ x: 900, y: 100 }, { x: 900, y: 104 }, { x: 880, y: 20 }, { x: 80, y: 120 }], out);
    expect(out[3]).toMatchObject({ x: 80, y: 120, border: false });
    const ringed = out.slice(0, 3);
    for (const s of ringed) {
      expect(s.border).toBe(true);
      expect(Math.hypot(s.x - c, s.y - c)).toBeCloseTo(WATCH_RING, 6);
      // The label is nearer the middle than the pin is.
      expect(Math.hypot(s.lx - c, s.ly - c)).toBeLessThan(WATCH_RING);
    }
    for (let i = 0; i < 3; i++) for (let j = i + 1; j < 3; j++) expect(Math.hypot((ringed[i] as Spot).x - (ringed[j] as Spot).x, (ringed[i] as Spot).y - (ringed[j] as Spot).y)).toBeGreaterThanOrEqual(29);
    // Where there is no room round the ring, the farther of two loses its label.
    ringSpots(c, c, WATCH_RING, c, c, Array.from({ length: 20 }, (_, i) => ({ x: c + 900 * Math.cos(i * 0.01), y: c + 900 * Math.sin(i * 0.01) })), out);
    expect(out.some((s) => !s.label)).toBe(true);
  });

  it("draws the round screen with a clock, a short line that ends in an ellipsis rather than run to the edge, and a vignette at the rim", () => {
    const seed = 20261121;
    const data = mapDataFor(seed);
    const hall = data.places[3]!;
    const ctx = new RecordingCtx();
    const drawer = new MapDrawer(ctx);
    const long = "A very long destination name that would run to the edge of a round screen 1200 m";
    const scene: Scene = {
      data, view: watchView(WATCH_W, WATCH_H, hall.x, hall.z, 0), e: 0, night: 0, dpr: 2, large: false, soft: false, watch: true,
      player: { x: hall.x, z: hall.z, heading: 0, driving: false }, route: null, waypoints: [], destination: null, slim: long,
    };
    drawer.draw(scene);
    drawWatchStatus(ctx, WATCH_W, paletteFor(0, 0, false), 13.5);
    expect(ctx.rec.texts).toContain("13:30");
    const slim = ctx.rec.texts.find((t) => t.endsWith("…"))!;
    expect(slim).toBeDefined();
    // Inside the circle: no wider than the chord of 124 px less the line's padding at 10.5 px type.
    expect(ctx.measure(slim, 10.5)).toBeLessThanOrEqual(124 - 14 + 1);
    // The rim: two rings at the end.
    const before = ctx.ops;
    drawWatchRim(ctx, WATCH_W, WATCH_H);
    expect(ctx.ops - before).toBe(2);
  });
});

describe("what the watch's line and clock keep", () => {
  const seeds = [20261121, 1, 6, 1175766972];
  const slimOn = (words: string) => {
    const data = mapDataFor(20261121);
    const hall = data.places[3]!;
    const ctx = new RecordingCtx();
    new MapDrawer(ctx).draw({
      data, view: watchView(WATCH_W, WATCH_H, hall.x, hall.z, 0), e: 0, night: 0, dpr: 2, large: false, soft: false, watch: true,
      player: { x: hall.x, z: hall.z, heading: 0, driving: false }, route: null, waypoints: [], destination: null, slim: words,
    });
    return ctx;
  };

  it("keeps the whole distance and shortens the name to fit, for every place's name and for three- and four-digit distances", () => {
    for (const seed of seeds) {
      for (const place of mapDataFor(seed).places) {
        for (const metres of [45, 210, 960, 1240, 2600]) {
          const dist = formatDistance(metres);
          const ctx = slimOn(`${place.name} \u00b7 ${dist}`);
          const line = ctx.rec.texts.find((t) => t.endsWith(` \u00b7 ${dist}`));
          expect(line, `${place.name} ${dist}`).toBeDefined();
          // Inside the circle: the line, with its padding, is no more than the chord, 124 px.
          expect(ctx.measure(line as string, 10.5, true) + 14, `${place.name} ${dist}`).toBeLessThanOrEqual(124);
          // A name that did not fit ends in an ellipsis; one that did is whole.
          const name = (line as string).slice(0, (line as string).length - ` \u00b7 ${dist}`.length);
          expect(name === place.name || (name.endsWith("\u2026") && place.name.startsWith(name.slice(0, -1)))).toBe(true);
        }
      }
    }
    // A street's name alone, with no distance, is shortened whole.
    expect(slimOn("A street with a rather long name indeed").rec.texts.some((t) => t.endsWith("\u2026"))).toBe(true);
  });

  it("has no white lozenge: the line is backed faintly by the face's own colour, day and night", () => {
    for (const night of [0, 1]) {
      const data = mapDataFor(20261121);
      const hall = data.places[3]!;
      const ctx = new RecordingCtx();
      new MapDrawer(ctx).draw({
        data, view: watchView(WATCH_W, WATCH_H, hall.x, hall.z, 0), e: 0, night, dpr: 2, large: false, soft: false, watch: true,
        player: { x: hall.x, z: hall.z, heading: 0, driving: false }, route: null, waypoints: [], destination: null, slim: "Olsen Cafe \u00b7 210 m",
      });
      const pal = paletteFor(0, night, false);
      expect(ctx.rec.fillsDrawn.some((f) => f.colour === pal.land && f.alpha > 0 && f.alpha < 0.8)).toBe(true);
      // (The panel's own white lozenge is drawn at 0.92.)
      expect(ctx.rec.fillsDrawn.some((f) => f.colour === pal.panel && f.alpha === 0.92)).toBe(false);
    }
  });

  it("keeps ring pins out of the clock's arc, sliding them to the nearest free place along the ring", () => {
    const c = WATCH_W / 2;
    const out: Spot[] = [];
    // Straight north, and a little either side, and two together there.
    for (const dx of [0, 5, -5, 30, -30]) {
      ringSpots(c, c, WATCH_RING, c, c, [{ x: c + dx, y: -900 }], out);
      const th = Math.atan2((out[0] as Spot).y - c, (out[0] as Spot).x - c);
      expect(Math.abs(th + Math.PI / 2), `dx ${dx}`).toBeGreaterThanOrEqual(CLOCK_ARC - 1e-9);
      expect(Math.hypot((out[0] as Spot).x - c, (out[0] as Spot).y - c)).toBeCloseTo(WATCH_RING, 6);
    }
    ringSpots(c, c, WATCH_RING, c, c, [{ x: c, y: -900 }, { x: c + 3, y: -900 }, { x: c - 3, y: -900 }], out);
    for (const s of out) expect(Math.abs(Math.atan2(s.y - c, s.x - c) + Math.PI / 2)).toBeGreaterThanOrEqual(CLOCK_ARC - 1e-9);
    // A pin well away from the top stays where it lies.
    ringSpots(c, c, WATCH_RING, c, c, [{ x: 900, y: c }], out);
    expect(Math.atan2((out[0] as Spot).y - c, (out[0] as Spot).x - c)).toBeCloseTo(0, 6);
  });

  it("writes a ring pin's distance on the side of the pin away from the route", () => {
    const c = WATCH_W / 2;
    const out: Spot[] = [];
    ringSpots(c, c, WATCH_RING, c, c, [{ x: 900, y: c }], out);
    const inward = { x: out[0]!.lx, y: out[0]!.ly };
    // With the route's dots just where the label would go, it moves to a side of the pin.
    ringSpots(c, c, WATCH_RING, c, c, [{ x: 900, y: c }], out, 30, [{ x: inward.x, y: inward.y - 1 }, { x: inward.x - 4, y: inward.y }]);
    expect(Math.hypot(out[0]!.lx - inward.x, out[0]!.ly - inward.y)).toBeGreaterThan(10);
    // The label is still within the ring.
    expect(Math.hypot(out[0]!.lx - c, out[0]!.ly - c)).toBeLessThan(WATCH_RING + 8);
  });

  it("draws the clock in the face's strongest text colour, day and night (contrast over 7 to 1)", () => {
    const lin = (v: number): number => ((v / 255) <= 0.04045 ? v / 255 / 12.92 : ((v / 255 + 0.055) / 1.055) ** 2.4);
    const lum = (c: string): number => {
      const [r, g, b] = rgbOf(c);
      return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
    };
    for (const night of [0, 1]) {
      const p = paletteFor(0, night, false);
      const [hi, lo] = [Math.max(lum(p.panelText), lum(p.land)), Math.min(lum(p.panelText), lum(p.land))];
      expect((hi + 0.05) / (lo + 0.05), `night ${night}`).toBeGreaterThanOrEqual(7);
    }
  });

  it("never writes a distance under the line's backing or the clock: it moves to another candidate place, or the label is dropped and the pin stays", () => {
    const c = WATCH_W / 2;
    const out: Spot[] = [];
    const under = (s: Spot): boolean => WATCH_KEEP_OUT.some((k) => s.lx + 17 > k.x0 && s.lx - 17 < k.x1 && s.ly + 6 > k.y0 && s.ly - 6 < k.y1);
    // Pins all round the ring, from every direction, with and without a route's dots.
    for (let deg = 0; deg < 360; deg += 7) {
      const a = (deg * Math.PI) / 180;
      ringSpots(c, c, WATCH_RING, c, c * 1.1, [{ x: c + 900 * Math.cos(a), y: c + 900 * Math.sin(a) }], out, 30, [], WATCH_KEEP_OUT);
      const s = out[0] as Spot;
      expect(s.border).toBe(true);
      if (s.label) expect(under(s), `${deg} degrees`).toBe(false);
    }
    // A pin at about one o'clock has its inward label under the line: it moves to a side, or goes.
    ringSpots(c, c, WATCH_RING, c, c, [{ x: c + 900 * Math.cos(-1.1), y: c + 900 * Math.sin(-1.1) }], out, 30, [], []);
    const open = out[0] as Spot;
    ringSpots(c, c, WATCH_RING, c, c, [{ x: c + 900 * Math.cos(-1.1), y: c + 900 * Math.sin(-1.1) }], out, 30, [], WATCH_KEEP_OUT);
    const kept = out[0] as Spot;
    expect(under(open) && kept.label ? kept.lx !== open.lx || kept.ly !== open.ly : true).toBe(true);
    expect(kept.border).toBe(true);
  });
});
