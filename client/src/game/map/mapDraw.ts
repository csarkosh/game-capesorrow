/**
 * Draws the map through a `MapCtx`: from the data through a view, back to front, only the parts of the grid the view shows. The grid's
 * 64 m cells are what the data is indexed by; the paths are made for a tile of 4 by 4 cells (256 m), once, in world metres, one path for
 * each class of feature, and drawn under the view's transform. A frame is then a few dozen path fills and strokes (a dozen for each tile
 * it shows, and a minimap shows a few tiles) and not a call for each feature, nor for each of the cells (which, driving, would be
 * several hundred operations a frame).
 *
 * Drawing operations are counted (`ops`), so that what a frame costs can be read.
 */
import type { MapCtx, PathLike } from "./mapCtx.js";
import { CELL, cellKey, type MapCell, type MapData, type MapPlace, type Poly, type Seg } from "./mapData.js";
import { drawDriver, drawFlag, drawPin, drawWalker, placeSpots, type Spot } from "./mapMarks.js";
import { namedAt, paletteFor, streetColours, streetWidths, type Palette } from "./mapStyle.js";
import { directionOnScreen, worldToScreen, type MapView } from "./mapView.js";

export type Waypoint = { readonly id: number; readonly x: number; readonly z: number };

/** What a frame is drawn from, besides the data and the view. */
export type Scene = {
  readonly data: MapData;
  readonly view: MapView;
  /** The eased look (0 on foot, 1 driving) and night (0 day, 1 night). */
  readonly e: number;
  readonly night: number;
  /** Device pixels to a pixel of the view. */
  readonly dpr: number;
  /** The large map shows more names. */
  readonly large: boolean;
  /** The small map sits back: muted colours, lighter lettering, smaller pins. The large map is not soft. */
  readonly soft: boolean;
  /** The player: where they are, the angle of the vector (sin, cos) they face, and whether they are in a car. */
  readonly player: { readonly x: number; readonly z: number; readonly heading: number; readonly driving: boolean };
  readonly route: { readonly pts: readonly number[] } | null;
  readonly waypoints: readonly Waypoint[];
  /** The chosen destination: a place (by id) or a waypoint (by id). */
  readonly destination: { readonly kind: "place" | "waypoint"; readonly id: number } | null;
  /** The slim line's words, or none. */
  readonly slim: string | null;
};

type StreetGroup = { readonly cls: number; readonly w: number; readonly path: PathLike };
type TilePaths = {
  green: PathLike | null; block: PathLike | null; made: PathLike | null; deck: PathLike | null; pavement: PathLike | null;
  building: PathLike | null; landmark: PathLike | null; enterable: PathLike | null;
  streets: StreetGroup[]; stairs: PathLike | null; rails: PathLike | null;
};

/** The side of a tile of the paths, in cells. */
export const TILE_CELLS = 4;

/** What a tile's paths cost at the most: a fill for each of its eight classes of ground and building, a stroke for the edges of three, two for the rails and one for the stairs, and a casing and a fill for each group of streets (eleven at the most, from the classes and widths there are): the bound a frame is held to is this for each tile it shows. */
export const OPS_PER_TILE = 40;

/** How many drawing operations a frame has besides its tiles': the water, the land, the quay, the route's two, the slim line, and the marks: three for a pin (four at the border) of each of four places, two for each of five flags, three for the player. The street names are one each besides, and a tile has at most as many as it has labels. */
export const OPS_FIXED = 60;

/** A tile: its place in the grid of tiles, its cells that hold something, and the world's rectangle it covers. */
export type Tile = { readonly tx: number; readonly tz: number; readonly cells: MapCell[]; readonly x0: number; readonly z0: number };

function polyPath(ctx: MapCtx, polys: readonly Poly[]): PathLike | null {
  if (polys.length === 0) return null;
  const path = ctx.newPath();
  for (const p of polys) {
    path.moveTo(p[0] as number, p[1] as number);
    for (let i = 2; i < p.length; i += 2) path.lineTo(p[i] as number, p[i + 1] as number);
    path.closePath();
  }
  return path;
}

function segPath(ctx: MapCtx, segs: readonly Seg[]): PathLike | null {
  if (segs.length === 0) return null;
  const path = ctx.newPath();
  for (const s of segs) {
    path.moveTo(s.x0, s.z0);
    path.lineTo(s.x1, s.z1);
  }
  return path;
}

export class MapDrawer {
  /** The drawing operations of the last frame, and the cells it showed. */
  ops = 0;
  /** The paths made while the last frame was drawn: how many tiles, and the milliseconds they took (a frame that made some is not a fair measure of drawing). */
  built = 0;
  buildMs = 0;
  tiles: Tile[] = [];
  private readonly paths = new Map<Tile, TilePaths>();
  private readonly tileIndex = new Map<MapData, Map<number, Tile>>();
  private land: PathLike | null = null;
  private landFor: MapData | null = null;
  private quay: PathLike | null = null;
  private readonly widths = new Map<string, number>();
  private readonly spots: Spot[] = [];
  private readonly at: { x: number; y: number }[] = [];
  private readonly dir = { x: 0, y: 0 };

  constructor(private readonly ctx: MapCtx, private readonly clock: () => number = () => performance.now()) {}

  /** The tiles of a map's data, made on its first asking. */
  private tilesOf(data: MapData): Map<number, Tile> {
    let tiles = this.tileIndex.get(data);
    if (tiles === undefined) {
      tiles = new Map();
      for (const cell of data.cells.values()) {
        const tx = Math.floor(cell.cx / TILE_CELLS);
        const tz = Math.floor(cell.cz / TILE_CELLS);
        const key = cellKey(tx, tz);
        let tile = tiles.get(key);
        if (tile === undefined) {
          tile = { tx, tz, cells: [], x0: tx * TILE_CELLS * CELL, z0: tz * TILE_CELLS * CELL };
          tiles.set(key, tile);
        }
        tile.cells.push(cell);
      }
      this.tileIndex.set(data, tiles);
    }
    return tiles;
  }

  /** The paths of a tile, made on its first showing: what its cells hold, each feature once. */
  private pathsOf(tile: Tile): TilePaths {
    let p = this.paths.get(tile);
    if (p === undefined) {
      const t0 = this.clock();
      const ctx = this.ctx;
      const once = <T>(pick: (c: MapCell) => readonly T[]): T[] => {
        const seen = new Set<T>();
        for (const c of tile.cells) for (const v of pick(c)) seen.add(v);
        return [...seen];
      };
      const groups = new Map<string, { cls: number; w: number; segs: Seg[] }>();
      for (const s of once((c) => c.streets)) {
        const w = Math.round(s.w * 2) / 2;
        const key = `${s.cls}:${w}`;
        const g = groups.get(key);
        if (g === undefined) groups.set(key, { cls: s.cls, w, segs: [s] });
        else g.segs.push(s);
      }
      const streets: StreetGroup[] = [];
      for (const g of groups.values()) streets.push({ cls: g.cls, w: g.w, path: segPath(ctx, g.segs) as PathLike });
      p = {
        green: polyPath(ctx, once((c) => c.green)), block: polyPath(ctx, once((c) => c.block)), made: polyPath(ctx, once((c) => c.made)), deck: polyPath(ctx, once((c) => c.deck)), pavement: polyPath(ctx, once((c) => c.pavement)),
        building: polyPath(ctx, once((c) => c.building)), landmark: polyPath(ctx, once((c) => c.landmark)), enterable: polyPath(ctx, once((c) => c.enterable)),
        streets, stairs: segPath(ctx, once((c) => c.stairs)), rails: segPath(ctx, once((c) => c.rails)),
      };
      this.paths.set(tile, p);
      this.built++;
      this.buildMs += this.clock() - t0;
    }
    return p;
  }

  private landPath(data: MapData): PathLike {
    if (this.land === null || this.landFor !== data) {
      const path = this.ctx.newPath();
      const s = data.shore;
      path.moveTo(s[0] as number, s[1] as number);
      for (let i = 2; i < s.length; i += 2) path.lineTo(s[i] as number, s[i + 1] as number);
      path.lineTo(data.east, data.z1);
      path.lineTo(data.east, data.z0);
      path.closePath();
      this.land = path;
      const q = this.ctx.newPath();
      q.moveTo(data.quay.x0, data.quay.z0);
      q.lineTo(data.quay.x1, data.quay.z1);
      this.quay = q;
      this.landFor = data;
    }
    return this.land;
  }

  /** The tiles of the data that the view shows, in no order. */
  tilesInView(data: MapData, v: MapView, out: Tile[] = []): Tile[] {
    out.length = 0;
    let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
    const p = { x: 0, z: 0 };
    for (const [sx, sy] of [[0, 0], [v.w, 0], [v.w, v.h], [0, v.h]] as const) {
      screenToWorldInto(v, sx, sy, p);
      x0 = Math.min(x0, p.x);
      x1 = Math.max(x1, p.x);
      z0 = Math.min(z0, p.z);
      z1 = Math.max(z1, p.z);
    }
    const side = TILE_CELLS * CELL;
    // A tile is shown if a circle about it, with a margin for the width of a street at its edge, meets the view.
    const reach = (side * Math.SQRT1_2 + 12) / v.mpp;
    const tiles = this.tilesOf(data);
    const q = { x: 0, y: 0 };
    for (let tx = Math.floor(x0 / side); tx <= Math.floor(x1 / side); tx++) {
      for (let tz = Math.floor(z0 / side); tz <= Math.floor(z1 / side); tz++) {
        const tile = tiles.get(cellKey(tx, tz));
        if (tile === undefined) continue;
        worldToScreen(v, (tx + 0.5) * side, (tz + 0.5) * side, q);
        if (q.x < -reach || q.x > v.w + reach || q.y < -reach || q.y > v.h + reach) continue;
        out.push(tile);
      }
    }
    return out;
  }

  /** Draws a frame. */
  draw(s: Scene): void {
    const ctx = this.ctx;
    const { data, view: v, e } = s;
    const pal = paletteFor(e, s.night, s.soft);
    const k = s.dpr;
    this.ops = 0;
    this.built = 0;
    this.buildMs = 0;
    const tiles = this.tilesInView(data, v, this.tiles);
    const mpp = v.mpp;

    // The sea, then the land over it, under the view's transform.
    ctx.setTransform(k, 0, 0, k, 0, 0);
    ctx.fillRect(0, 0, v.w, v.h, pal.water);
    this.ops++;
    const a = (k * v.cos) / mpp;
    const b = (k * v.sin) / mpp;
    ctx.setTransform(a, b, b, -a, k * v.markX - a * v.cx - b * v.cz, k * v.markY - b * v.cx + a * v.cz);
    ctx.fill(this.landPath(data), pal.land);
    this.ops++;
    const quay = this.quay;
    if (quay !== null) {
      ctx.stroke(quay, pal.streetCasing, 1.5 * mpp);
      this.ops++;
    }
    const list: TilePaths[] = [];
    for (const t of tiles) list.push(this.pathsOf(t));
    const fillAll = (field: "made" | "green" | "block" | "deck" | "pavement" | "building" | "landmark" | "enterable", colour: string): void => {
      for (const c of list) {
        const p = c[field];
        if (p !== null) {
          ctx.fill(p, colour);
          this.ops++;
        }
      }
    };
    const edgeAll = (field: "building" | "landmark" | "enterable", colour: string, width: number): void => {
      for (const c of list) {
        const p = c[field];
        if (p !== null) {
          ctx.stroke(p, colour, width);
          this.ops++;
        }
      }
    };
    fillAll("made", pal.made);
    fillAll("green", pal.green);
    fillAll("block", pal.block);
    fillAll("deck", pal.deck);
    // The railroad: its ties as short bars across a thin grey line.
    for (const c of list) {
      if (c.rails === null) continue;
      ctx.stroke(c.rails, pal.rail, 4 * mpp, { dash: [1.1 * mpp, 3.4 * mpp] });
      ctx.stroke(c.rails, pal.rail, 1.4 * mpp);
      this.ops += 2;
    }
    // The streets, all their casings and then all their fills, so that where they cross they are one.
    for (let pass = 0; pass < 2; pass++) {
      for (const c of list) {
        for (const g of c.streets) {
          const w = streetWidths(g.cls, g.w, e, mpp);
          const col = streetColours(pal, g.cls);
          ctx.stroke(g.path, pass === 0 ? col.casing : col.fill, pass === 0 ? w.casing : w.fill, { cap: "round" });
          this.ops++;
        }
      }
    }
    fillAll("pavement", pal.street);
    for (const c of list) {
      if (c.stairs === null) continue;
      ctx.stroke(c.stairs, pal.stair, Math.max(3, 2 * mpp), { dash: [0.5, 0.75] });
      this.ops++;
    }
    // Buildings, fainter and without edges driving.
    const edges = e < 0.98;
    fillAll("building", pal.building);
    if (edges) edgeAll("building", pal.buildingEdge, mpp);
    fillAll("landmark", pal.landmark);
    if (edges) edgeAll("landmark", pal.landmarkEdge, mpp);
    fillAll("enterable", pal.enterable);
    edgeAll("enterable", pal.enterableEdge, 1.5 * mpp);

    // Everything else is in the view's pixels.
    ctx.setTransform(k, 0, 0, k, 0, 0);
    this.labels(s, pal, tiles);
    if (s.route !== null) this.route(s, pal);
    this.marks(s, pal);
    if (s.slim !== null) this.slim(s, pal, s.slim);
  }

  private labels(s: Scene, pal: Palette, tiles: readonly Tile[]): void {
    const { view: v, e } = s;
    const size = s.soft ? 9.5 : e > 0.5 ? 11 : 10;
    const p = { x: 0, y: 0 };
    for (const tile of tiles) {
      for (const c of tile.cells) for (const l of c.labels) {
        if (!namedAt(l.cls, e)) continue;
        const runPx = l.run / v.mpp;
        if (runPx < 60) continue;
        worldToScreen(v, l.x, l.z, p);
        if (p.x < 14 || p.x > v.w - 14 || p.y < 14 || p.y > v.h - 14) continue;
        const key = `${l.text}|${size}`;
        let tw = this.widths.get(key);
        if (tw === undefined) {
          tw = this.ctx.measure(l.text, size, !s.soft && e > 0.5);
          this.widths.set(key, tw);
        }
        if (runPx < tw + 12) continue;
        directionOnScreen(v, l.dx, l.dz, this.dir);
        let angle = Math.atan2(this.dir.y, this.dir.x);
        // Upright: never turned past a quarter turn either way.
        if (angle > Math.PI / 2) angle -= Math.PI;
        else if (angle < -Math.PI / 2) angle += Math.PI;
        this.ctx.text(l.text, p.x, p.y, { size, colour: pal.text, halo: pal.halo, angle, bold: !s.soft && e > 0.5 });
        this.ops++;
      }
    }
  }

  /** The route: a line of blue dots on foot, a blue band with a darker edge driving. */
  private route(s: Scene, pal: Palette): void {
    const { view: v, e } = s;
    const pts = (s.route as { pts: readonly number[] }).pts;
    const ctx = this.ctx;
    const p = { x: 0, y: 0 };
    if (e >= 0.5) {
      const band = ctx.newPath();
      for (let i = 0; i < pts.length; i += 2) {
        worldToScreen(v, pts[i] as number, pts[i + 1] as number, p);
        if (i === 0) band.moveTo(p.x, p.y);
        else band.lineTo(p.x, p.y);
      }
      ctx.stroke(band, pal.routeEdge, 10, { cap: "round" });
      ctx.stroke(band, pal.route, 6.5, { cap: "round" });
      this.ops += 2;
      return;
    }
    const ring = ctx.newPath();
    const dots = ctx.newPath();
    let px = 0, py = 0, carry = 0, n = 0;
    for (let i = 0; i < pts.length; i += 2) {
      worldToScreen(v, pts[i] as number, pts[i + 1] as number, p);
      if (i > 0) {
        const len = Math.hypot(p.x - px, p.y - py);
        let at = carry;
        while (at < len && n < 400) {
          const t = at / len;
          const x = px + (p.x - px) * t;
          const y = py + (p.y - py) * t;
          if (x > -8 && x < v.w + 8 && y > -8 && y < v.h + 8) {
            ring.moveTo(x + 4.2, y);
            ring.arc(x, y, 4.2, 0, Math.PI * 2);
            dots.moveTo(x + 2.8, y);
            dots.arc(x, y, 2.8, 0, Math.PI * 2);
            n++;
          }
          at += 9;
        }
        carry = at - len;
      }
      px = p.x;
      py = p.y;
    }
    ctx.fill(ring, pal.ring);
    ctx.fill(dots, pal.route);
    this.ops += 2;
  }

  /** The places' pins, the waypoints' flags and the player. */
  private marks(s: Scene, pal: Palette): void {
    const { view: v, data } = s;
    const ctx = this.ctx;
    const m = { x: v.markX, y: v.markY };
    const p = { x: 0, y: 0 };
    const small = v.mpp > 1.3 && !s.large;
    // The small map's pins are a little smaller.
    const pin = s.soft ? 0.85 : 1;
    const at = this.at;
    at.length = data.places.length;
    data.places.forEach((place, i) => {
      at[i] = worldToScreen(v, place.x, place.z, at[i] ?? { x: 0, y: 0 });
    });
    placeSpots(v.w, v.h, m.x, m.y, at, this.spots);
    data.places.forEach((place, i) => {
      const spot = this.spots[i] as Spot;
      const chosen = s.destination !== null && s.destination.kind === "place" && s.destination.id === place.id;
      if (spot.border) {
        drawPin(ctx, pal, place.kind, spot.x, spot.y, (chosen ? 0.9 : 0.7) * pin);
        this.ops += 3;
        if (spot.label) {
          const d = Math.round(Math.hypot(place.x - s.player.x, place.z - s.player.z));
          ctx.text(`${d} m`, spot.x, spot.y + 9, { size: 9.5, colour: pal.text, halo: pal.halo, bold: !s.soft });
          this.ops++;
        }
        return;
      }
      const scale = (chosen ? 1.35 : 1) * pin;
      drawPin(ctx, pal, place.kind, spot.x, spot.y, scale);
      this.ops += 3;
      if (!small || chosen) this.placeName(s, pal, place, spot.x, spot.y, scale);
    });
    for (const w of s.waypoints) {
      worldToScreen(v, w.x, w.z, p);
      if (p.x < -20 || p.x > v.w + 20 || p.y < -20 || p.y > v.h + 20) continue;
      const chosen = s.destination !== null && s.destination.kind === "waypoint" && s.destination.id === w.id;
      drawFlag(ctx, pal, p.x, p.y, chosen ? 1.25 : 1);
      this.ops += 2;
    }
    worldToScreen(v, s.player.x, s.player.z, p);
    directionOnScreen(v, Math.sin(s.player.heading), Math.cos(s.player.heading), this.dir);
    if (s.e < 0.5) drawWalker(ctx, pal, p.x, p.y, this.dir.x, this.dir.y);
    else drawDriver(ctx, pal, p.x, p.y, this.dir.x, this.dir.y);
    this.ops += s.e < 0.5 ? 3 : 2;
  }

  /** A place's name beside its pin, when there is room for it in the view. */
  private placeName(s: Scene, pal: Palette, place: MapPlace, x: number, y: number, scale: number): void {
    const size = s.soft ? 10 : 11;
    const tw = this.ctx.measure(place.name, size, !s.soft);
    const left = x + 10 * scale + 2;
    if (left + tw > s.view.w - 4) return;
    this.ctx.text(place.name, left, y - 8 * scale * 1.1, { size, colour: pal.text, halo: pal.halo, align: "left", bold: !s.soft });
    this.ops++;
  }

  /** The slim line under the map's top edge: a destination and the distance left, or the street the player is on. */
  private slim(s: Scene, pal: Palette, words: string): void {
    const ctx = this.ctx;
    const size = 11.5;
    const tw = ctx.measure(words, size, true);
    const w = Math.min(s.view.w - 16, tw + 22);
    const h = 21;
    const x = (s.view.w - w) / 2;
    const y = 7;
    const box = ctx.newPath();
    const r = h / 2;
    box.moveTo(x + r, y);
    box.lineTo(x + w - r, y);
    box.arc(x + w - r, y + r, r, -Math.PI / 2, Math.PI / 2);
    box.lineTo(x + r, y + h);
    box.arc(x + r, y + r, r, Math.PI / 2, Math.PI * 1.5);
    box.closePath();
    ctx.fill(box, pal.panel, 0.92);
    ctx.text(words, s.view.w / 2, y + h / 2 + 0.5, { size, colour: pal.panelText, bold: true });
    this.ops += 2;
  }
}

function screenToWorldInto(v: MapView, sx: number, sy: number, out: { x: number; z: number }): void {
  const u = (sx - v.markX) * v.mpp;
  const t = (sy - v.markY) * v.mpp;
  out.x = v.cx + v.cos * u + v.sin * t;
  out.z = v.cz + v.sin * u - v.cos * t;
}
