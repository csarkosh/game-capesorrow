/**
 * A commercial building's street wall, drawn from its units (`plan.uses[b].units`): each unit's openings where the plan puts them (sill,
 * head, widened, bricked, papered, boarded), its door where the plan puts it (recessed where the plan says so), a bulkhead under the
 * glass, piers and pilasters between, the stair door to the floors above, the upper storeys' windows from the plan's records, a cornice,
 * and awnings and canopies. The wall is cut around the openings (`cutWall`), so each is a hole with a reveal and, behind the glass, the
 * unit's room (`roomGeometry.ts`).
 *
 * What the plan causes: every opening, door, recess, the fascia's height, the state (a boarded or papered opening, a bricked one, a vacant
 * unit's bare glass), the remodel (a widened opening, a dropped fascia, a new door: each shows in its frame colour and style, the new one
 * in aluminium of its decade). What is authored: the frame colours by age, the bulkhead's height and paint, the cornice's few shapes (by
 * building), the awnings (one in four units of before 1990, in a few canvas colours, one in three of them faded and one in six torn,
 * some just the ribs), the canopies of the strip malls (a unit in five of a front of 1960 or later). Every choice is a roll from the
 * unit's or the building's id and says what it stands for in a comment.
 */
import { withMat } from "./materials.js";
import { accentOf, QUIET_FADE } from "./accents.js";
import { greyed, hash01, scaled, type MeshBuilder, type Rgb } from "./meshBuilder.js";
import { doorIn, glazed, TRIM_WHITE, frameBars, pane, pickOf, reveal, wat, wbox, wquad, type Hole, type WallRef } from "./buildingKit.js";
import { unitHours } from "./hours.js";
import { roomGeometry, xp, type Xf } from "./roomGeometry.js";
import { drawWindow, frameColour, type WinCtx } from "./windowGeometry.js";
import { slatBlinds, slatColour, verticalBlinds } from "./windowDressing.js";
import type { Building, BuildingUse, Unit } from "../../sim/town/types.js";
import type { Detail, FillReport } from "./townTypes.js";
import type { Surface } from "./townSurface.js";
import { bulkheadWear } from "./buildingWear.js";
import { NEVER_CODE, isHome, windowCodes } from "./windowNight.js";

export type FrontIn = {
  readonly report?: FillReport;
  readonly out: MeshBuilder;
  readonly glass: MeshBuilder;
  /** Where the haze of each unit's room goes (`roomHaze.ts`), where there is a layer for it. */
  readonly haze?: MeshBuilder;
  /** The rooms are seen through their glass out of focus (`BuildingExtras.through`): each is drawn whole, and its panes are marked. */
  readonly through?: boolean;
  readonly w: WallRef;
  readonly xf: Xf;
  readonly b: Building;
  /** The block the building stands on, which the accent colours are keyed by (`accents.ts`); the building's own id where it is not given. */
  readonly block?: number;
  readonly use: BuildingUse;
  readonly floorY: number;
  readonly wallTop: number;
  readonly detail: Detail;
  readonly wall: Rgb;
  /** The wall's surface in this wall's own frame, for what is laid in the wall's material. */
  readonly surface: (w: WallRef) => Surface;
  /** The ground's height at a station of the wall. */
  readonly groundAt: (s: number) => number;
};

export type FrontPlan = { readonly holes: Hole[]; draw(): void; /** The lowest the upper storeys' windows may start, metres over the floor. */ readonly groundStoreyTop: number };

const CANVAS: readonly Rgb[] = [[0.5, 0.1, 0.1], [0.12, 0.3, 0.2], [0.14, 0.22, 0.4], [0.62, 0.55, 0.35], [0.3, 0.3, 0.3], [0.65, 0.35, 0.1]];
const BULKHEAD: readonly Rgb[] = [[0.1, 0.2, 0.14], [0.15, 0.1, 0.08], [0.32, 0.12, 0.1], [0.12, 0.12, 0.13], [0.3, 0.3, 0.28], [0.45, 0.4, 0.3]];

/** A unit's frame, from its age: the first builder's in the building's era, or the remodel's decade where the remodel changed it. */
function unitFrame(b: Building, u: Unit, widened: boolean): Rgb {
  const rem = u.remodel;
  const era = rem !== null && (rem.what === "widened window" || rem.what === "new door") && widened ? rem.decade : b.era;
  return frameColour(b.id * 13 + u.id, era, false);
}

export function planFront(i: FrontIn): FrontPlan {
  const { out, glass, w, xf, b, use, floorY, wallTop, detail } = i;
  // What stands at the front's foot (a bulkhead, the water table) sees the sky the wall sees there (`skyShade.ts`): darkest at the sidewalk.
  const wallSky = i.surface(w).shade;
  const sky = wallSky === undefined ? {} : { shade: wallSky };
  const full = detail === "full";
  const block = i.block ?? b.id;
  // Frame stations to the wall's own: the wall may run the other way from the frame's `t`.
  const origin = xp(xf, 0, 0, 0);
  const sign = w.tx * xf.tx + w.tz * xf.tz >= 0 ? 1 : -1;
  const s0w = (origin[0] - w.ax) * w.tx + (origin[2] - w.az) * w.tz;
  const W = (s: number): number => s0w + sign * s;
  const ends = (a: number, c: number): [number, number] => (W(a) < W(c) ? [W(a), W(c)] : [W(c), W(a)]);
  const old = b.era < 1950;
  const brick = b.material === "brick";
  const holes: Hole[] = [];
  const drawers: (() => void)[] = [];
  const tallest = use.units.reduce((m, u) => Math.max(m, u.fascia), 3.2);
  const groundStoreyTop = tallest + 0.45;
  const winCtx: WinCtx = { ...(i.report === undefined ? {} : { report: i.report }), out, glass, detail, id: b.id, era: b.era, surface: i.surface, trim: old ? [0.55, 0.52, 0.46] : TRIM_WHITE, wall: i.wall, stoneSill: full && brick };

  // ---- the units
  use.units.forEach((u) => {
    const lit = u.state === "open";
    const boardedUnit = u.state === "vacant boarded";
    const vacantUnit = u.state.startsWith("vacant");
    const bulk = accentOf(block, b.id * 7 + u.id, 430) ?? pickOf(BULKHEAD, b.id * 7 + u.id, 430);
    const widenedAt = u.remodel?.what === "widened window" ? u.openings.findIndex((o) => o.widened) : -1;
    u.openings.forEach((o, k) => {
      i.report?.openings.push({ unit: u.id, s0: o.s0, s1: o.s1, sill: o.sill, head: o.head, cover: o.cover });
      const [sa, sb] = ends(o.s0, o.s1);
      const y0 = floorY + o.sill;
      const y1 = floorY + o.head;
      if (o.cover === "bricked") {
        // The opening is filled with brick of another batch, flush; the lintel over it still shows.
        holes.push({ s0: sa, s1: sb, y0, y1 });
        drawers.push(() => {
          const tint = scaled([1.12, 1.0, 0.9], 0.82 + hash01(b.id * 5 + k, 431) * 0.3);
          wquad(out, w, sa, y0, sb, y1, -0.02, scaled(i.wall, 1.1), { layer: "brick", frame: i.surface(w).frame, tint, wear: 0.1, wearKind: "grime" });
          wquad(out, w, sa - 0.1, y1, sb + 0.1, y1 + 0.12, 0.03, [0.45, 0.43, 0.4], "concrete");
        });
        return;
      }
      holes.push({ s0: sa, s1: sb, y0, y1 });
      drawers.push(() => {
        const frameC = unitFrame(b, u, k === widenedAt);
        const rep = k === widenedAt && (u.remodel?.decade ?? 0) >= 1960;
        const wc: WinCtx = { ...winCtx, trim: scaled(frameC, 1), era: rep ? u.remodel?.decade ?? b.era : b.era };
        if (o.cover === "bricked") return;
        // How grimy the glass is: a vacant unit's most, then a shut one's, and an old front's more than a new one's.
        const dirt = Math.min(0.95, (vacantUnit ? 0.75 : u.state === "open" ? 0.22 : 0.45) + 0.2 * Math.min(1, (2026 - b.era) / 130) + 0.15 * hash01(b.id * 5 + u.id * 3 + k, 436));
        // A pane with a room behind it shows the room out of focus, on the tier that reads the frame behind its glass.
        const look = { lit, dirt, vacant: vacantUnit, ...(i.through === true && !boardedUnit && u.interior.type !== undefined ? { through: true } : {}) };
        if (o.cover === "boarded") {
          drawWindow(wc, w, sa, sb, y0, y1, "boarded", "none", u.id * 5 + k, false, "boarded", false, look);
        } else {
          drawWindow({ ...wc, detail: full ? "full" : "low" }, w, sa, sb, y0, y1, "dark", "none", u.id * 5 + k, false, o.cover === "papered" ? "papered" : "none", true, look);
        }
        if (o.cover === "blinds") {
          // Slats with the room showing between them, part raised; some offices have vertical louvres instead.
          const bseed = b.id * 3 + u.id + k;
          const behind = { out, w, detail: full ? "full" as const : "low" as const, seed: bseed, glass: -0.07, lit };
          if (u.interior.type === "office" && hash01(bseed, 437) < 0.3) verticalBlinds(behind, sa, sb, y1 - 0.02, y0 + 0.05, slatColour(bseed));
          else slatBlinds(behind, sa, sb, y1 - 0.02, (o.head - o.sill) * (0.4 + hash01(bseed, 432) * 0.55), slatColour(bseed));
        }
        // The frame's bars proud of the face and, on the old fronts, the transom bar.
        if (full) {
          frameBars(out, w, sa, sb, y0, y1, 0.06, 0.11, frameC);
          if (b.era < 1930 && y1 - y0 > 1.8) wquad(out, w, sa, y1 - 0.5, sb, y1 - 0.45, -0.045, frameC, "painted");
        }
      });
    });
    // The bulkhead under the glass: a panel of the old fronts, a granite base of the modern.
    if (u.openings.length > 0 && full) {
      const a = Math.min(...u.openings.map((o) => Math.min(o.s0, o.s1)));
      const c = Math.max(...u.openings.map((o) => Math.max(o.s0, o.s1)));
      const sill = Math.min(...u.openings.map((o) => o.sill));
      drawers.push(() => {
        const dw = u.door.width;
        const spans: [number, number][] = [];
        const doorL = u.door.s - dw / 2;
        const doorR = u.door.s + dw / 2;
        if (doorL > a) spans.push([a, Math.min(doorL, c)]);
        if (doorR < c) spans.push([Math.max(doorR, a), c]);
        for (const [x0, x1] of spans) {
          if (x1 - x0 < 0.2) continue;
          const [sa, sb] = ends(x0, x1);
          if (old && sill > 0.35) {
            // Its top is at least 5 cm over the water table's (35 cm), which runs across the front.
            const roll = hash01(b.id * 7 + u.id, 450);
            const fr = i.surface(w).frame;
            wbox(out, w, sa - 0.04, sb + 0.04, floorY, floorY + Math.max(sill, 0.4), 0, 0.05, bulk, scaled(bulk, 1.4), false, { layer: "planks_weathered", frame: fr, tint: scaled(bulk, 2.2), ...sky, ...bulkheadWear(b, vacantUnit, roll, false, false) });
            // The panel's field, a shade off the frame, and a kick plate at its foot that has taken the shoes and the mop.
            wquad(out, w, sa + 0.1, floorY + 0.1, sb - 0.1, floorY + sill - 0.1, 0.17, scaled(bulk, 0.8), { layer: "planks_weathered", frame: fr, tint: scaled(bulk, 1.8), ...sky, ...bulkheadWear(b, vacantUnit, roll, false, false) });
          } else {
            const roll = hash01(b.id * 7 + u.id, 450);
            const fr = i.surface(w).frame;
            const top = floorY + Math.min(0.5, sill);
            wquad(out, w, sa, floorY, sb, top, 0.03, [0.13, 0.13, 0.14], { layer: "metal_painted", frame: fr, tint: [0.5, 0.5, 0.52], ...sky, ...bulkheadWear(b, vacantUnit, roll, true, false) });
          }
        }
      });
    }
    // The door.
    const dw = u.door.width;
    const [da, db] = ends(u.door.s - dw / 2, u.door.s + dw / 2);
    const dHead = floorY + (b.era < 1940 && u.fascia > 3.1 ? 2.65 : 2.2);
    holes.push({ s0: da, s1: db, y0: floorY, y1: dHead });
    const modern = u.remodel?.what === "new door" || b.era >= 1960;
    drawers.push(() => {
      const rec = u.door.recess;
      const depth = rec > 0 ? rec : 0.1;
      const dr = u.remodel?.what === "new door" ? frameColour(b.id * 3 + u.id, u.remodel.decade, false) : unitFrame(b, u, false);
      const timber = modern ? ([0.4, 0.42, 0.44] as Rgb) : accentOf(block, b.id * 3 + u.id, 431) ?? dr;
      const leafTop = floorY + 2.05;
      // An aluminium door of the modern fronts, a painted timber one of the old.
      const leafMat = modern ? "sheet" : "boards";
      if (boardedUnit) {
        reveal(out, w, da, db, floorY, dHead, depth, scaled(i.wall, 0.8), [0.35, 0.34, 0.32]);
        wquad(out, w, da, floorY, db, dHead, 0.03, scaled([0.6, 0.45, 0.28], 0.9), { layer: "plywood", frame: i.surface(w).frame, tint: [2.2, 2.2, 2.2], wear: 0.2, wearKind: "peel" });
        return;
      }
      // The leaf fills its hole from edge to edge and from the floor to the head: a kick panel, the glass in its frame over it, and over that a
      // transom or the head's rail. The return of the recess (or the reveal of a flush door) runs exactly to the leaf, so the room is seen
      // through the glass and through nothing else.
      const o = wquad(out, w, da, floorY, db, floorY + 0.8, -depth, scaled(timber, 0.9), leafMat);
      // The door's glass shows the room as the windows do.
      const doorLook = i.through === true && u.interior.type !== undefined ? { through: true } : {};
      glazed(out, glass, w, da, floorY + 0.8, db, leafTop, o, 0.1, timber, leafMat, doorLook);
      if (dHead > floorY + 2.3) glazed(out, glass, w, da, leafTop, db, dHead, o, 0.06, timber, leafMat, doorLook);
      else wquad(out, w, da, leafTop, db, dHead, o, timber, leafMat);
      reveal(out, w, da, db, floorY, dHead, -o, scaled(i.wall, 0.8), [0.35, 0.34, 0.32], rec > 0 ? i.surface(w) : undefined, "concrete");
      // The pull, a plate of brass.
      wquad(out, w, db - 0.18, floorY + 0.95, db - 0.14, floorY + 1.1, o + 0.03, [0.6, 0.5, 0.2], "steel");
    });
    // The room behind the glass, for a unit the street can look into (a boarded one is shut up, and has none).
    if (!boardedUnit && u.interior.type !== undefined) {
      drawers.push(() => {
        const from = out.vertices;
        roomGeometry(out, { ...(i.haze === undefined ? {} : { haze: i.haze }), ...(i.through === true ? { through: true } : {}), xf, floorY, s0: u.s0 + 0.04, s1: u.s1 - 0.04, interior: u.interior, state: u.state, lit, hours: unitHours(b, u), trade: u.tenant?.trade ?? null, id: b.id * 31 + u.id, era: b.era, opened: u.tenant?.opened ?? 0, detail, openings: u.openings, remodel: u.remodel, past: u.past, vacantSince: u.vacantSince, door: { s: u.door.s, width: u.door.width } });
        if (i.report !== undefined) {
          const ext = { s0: Infinity, s1: -Infinity, d0: Infinity, d1: -Infinity, y0: Infinity, y1: -Infinity };
          out.forEachPosition(from, (x, y, z) => {
            const s = (x - xf.ox) * xf.tx + (z - xf.oz) * xf.tz;
            const d = -((x - xf.ox) * xf.nx + (z - xf.oz) * xf.nz);
            ext.s0 = Math.min(ext.s0, s); ext.s1 = Math.max(ext.s1, s); ext.d0 = Math.min(ext.d0, d); ext.d1 = Math.max(ext.d1, d); ext.y0 = Math.min(ext.y0, y); ext.y1 = Math.max(ext.y1, y);
          });
          i.report.rooms.push({ unit: u.id, trade: u.tenant?.trade ?? "", extent: ext, furnishings: u.interior.furnishings.length, hash: out.hashFrom(from) });
        }
      });
    }
    // A canopy or an awning over the glass, by the tenant's taste.
    const roll = hash01(b.id * 19 + u.id, 433);
    const kind = u.openings.length === 0 || u.state.startsWith("vacant") ? "none" : b.era < 1990 && roll < 0.25 ? "awning" : b.era >= 1960 && roll > 0.8 ? "canopy" : "none";
    if (kind !== "none" && u.openings.length > 0) {
      const a = Math.min(...u.openings.map((o) => Math.min(o.s0, o.s1))) - 0.1;
      const c = Math.max(...u.openings.map((o) => Math.max(o.s0, o.s1))) + 0.1;
      const head = floorY + Math.max(...u.openings.map((o) => o.head));
      drawers.push(() => (kind === "awning" ? awning(out, w, ends(a, c), head, b.id * 23 + u.id, block) : canopy(out, w, ends(a, c), head, b.id * 29 + u.id, block)));
    }
  });

  // ---- the stair door to the floors above
  if (use.stair !== null) {
    const st = use.stair;
    const [sa, sb] = ends(st.s - st.width / 2, st.s + st.width / 2);
    holes.push({ s0: sa, s1: sb, y0: floorY, y1: floorY + 2.3 });
    drawers.push(() => {
      const col = pickOf([[0.12, 0.2, 0.14], [0.3, 0.1, 0.08], [0.14, 0.14, 0.15], [0.35, 0.3, 0.2]] as readonly Rgb[], b.id, 434);
      // The leaf fills its hole and the reveal runs to it. A panel on it, and a narrow light over the door: glass over the dark of the stair.
      const o = doorIn(out, w, { s0: sa, s1: sb, y0: floorY, y1: floorY + 2.3 }, 0.16, col, "boards", scaled(i.wall, 0.8), [0.35, 0.34, 0.32]);
      wquad(out, w, sa + 0.1, floorY + 1.3, sb - 0.1, floorY + 2.0, o + 0.03, scaled(col, 0.8), "boards");
      wquad(out, w, sa + 0.1, floorY + 0.2, sb - 0.1, floorY + 1.1, o + 0.03, scaled(col, 0.8), "boards");
      wquad(out, w, sa + 0.06, floorY + 2.12, sb - 0.06, floorY + 2.26, o + 0.03, [0.05, 0.055, 0.06], "painted");
      pane(glass, w, sa + 0.06, floorY + 2.12, sb - 0.06, floorY + 2.26, o + 0.06);
      wquad(out, w, sb - 0.13, floorY + 0.95, sb - 0.08, floorY + 1.1, o + 0.03, [0.5, 0.45, 0.3], "steel");
      // The number plate.
      wquad(out, w, sb + 0.1, floorY + 1.5, sb + 0.24, floorY + 1.62, 0.03, [0.7, 0.68, 0.6], "painted");
    });
  }

  // ---- the floors above, from the plan's records: a window each, in the manner of the age
  const upperTop = wallTop - 0.9;
  for (const up of use.upper) {
    const storeys = Math.max(2, b.storeys);
    const upperH = (wallTop - floorY - groundStoreyTop) / Math.max(1, storeys - 1);
    if (upperH < 1.5) continue;
    const base = floorY + groundStoreyTop + (up.storey - 1) * upperH;
    const wh = Math.min(1.7, upperH * 0.62);
    // The floor's own household lights its windows in the evening (flats and hotel rooms); an office's or a store room's are dark at night.
    const nights = isHome(b) && (up.use === "apartments" || up.use === "hotel rooms") ? windowCodes(b.id * 100 + up.storey, up.windows) : up.windows.map(() => NEVER_CODE);
    up.windows.forEach((wnd, k) => {
      const y0 = base + (upperH - wh) * 0.42;
      const y1 = y0 + wh;
      if (y1 > upperTop + 0.2) return;
      const ww = old ? 0.85 : 1.0;
      const [sa, sb] = ends(wnd.s - ww / 2, wnd.s + ww / 2);
      // Another tenant of the floor put in new windows: a share of the windows of an old block are the vinyl of the 1990s (cause: one owner's remodel).
      const replaced = hash01(b.id * 41 + up.storey, 435) < (old ? 0.35 : 0.1) && k % 2 === 0;
      holes.push({ s0: sa, s1: sb, y0, y1 });
      drawers.push(() => {
        drawWindow(winCtx, w, sa, sb, y0, y1, wnd.state, wnd.sill, up.storey * 50 + k, replaced, "none", false, { night: nights[k] as number });
        if (full && brick && !replaced) {
          // A stone sill and a lintel course over each opening of an old brick block.
          wbox(out, w, sa - 0.08, sb + 0.08, y0 - 0.1, y0 - 0.02, 0, 0.1, [0.5, 0.48, 0.44], [0.55, 0.53, 0.5], true, "concrete");
          wquad(out, w, sa - 0.1, y1, sb + 0.1, y1 + 0.16, 0.09, [0.45, 0.43, 0.4], "concrete");
        }
      });
    });
  }

  // ---- piers, a cornice and a water table, across the whole front
  drawers.push(() => {
    if (full && (brick || old)) {
      // The water table: a course of cast stone along the wall's foot. It stops at every door, which is entered from the sidewalk.
      const gaps: [number, number][] = use.units.map((u): [number, number] => ends(u.door.s - u.door.width / 2, u.door.s + u.door.width / 2));
      if (use.stair !== null) gaps.push(ends(use.stair.s - use.stair.width / 2, use.stair.s + use.stair.width / 2));
      gaps.sort((p, q) => p[0] - q[0]);
      const tone = scaled([0.4, 0.4, 0.38], 0.9 + hash01(b.id, 436) * 0.2);
      let from = 0;
      for (const [ga, gb] of [...gaps, [w.length, w.length] as [number, number]]) {
        if (ga - from > 0.12) wbox(out, w, from, ga, floorY - 0.05, floorY + 0.35, 0, 0.08, tone, [0.45, 0.45, 0.43], undefined, { mat: "concrete", ...sky });
        from = Math.max(from, gb);
      }
    }
    // Pilasters on the line between two units, on the old brick fronts: the pier the plan leaves is as wide as it says.
    if (brick && b.era < 1940 && full) {
      for (const u of use.units) {
        if (u.s0 < 0.1) continue;
        const [sa, sb] = ends(u.s0 - 0.18, u.s0 + 0.18);
        wbox(out, w, sa, sb, floorY + 0.35, Math.min(wallTop - 0.5, floorY + u.fascia + 0.5), 0, 0.07, scaled(i.wall, 1.12), scaled(i.wall, 1.2), undefined, i.surface(w));
      }
    }
    // The cornice: a corbelled band under the parapet's cap, its shape this building's own (a plain band, two bands, a dentilled course, or none).
    const shape = Math.floor(hash01(b.id, 437) * 4);
    if ((brick || b.era < 1940) && shape < 3) {
      const top = wallTop;
      wbox(out, w, 0, w.length, top - 0.28, top - 0.08, 0, 0.14, scaled(i.wall, 1.1), scaled(i.wall, 1.2), true, i.surface(w));
      if (shape === 1) wbox(out, w, 0, w.length, top - 0.55, top - 0.4, 0, 0.07, scaled(i.wall, 1.1), scaled(i.wall, 1.2), true, i.surface(w));
      if (shape === 2) for (let s = 0.2; s < w.length - 0.2; s += 0.4) wbox(out, w, s, s + 0.2, top - 0.42, top - 0.28, 0, 0.1, scaled(i.wall, 1.15), scaled(i.wall, 1.2), true, i.surface(w));
      wbox(out, w, -0.1, w.length + 0.1, top - 0.08, top + 0.03, 0, 0.2, [0.5, 0.48, 0.44], [0.55, 0.53, 0.5], true, "concrete");
    }
  });

  return { holes, draw: () => drawers.forEach((d) => d()), groundStoreyTop };
}

/** A canvas awning over a unit's glass: stripes of two tones sloping from the wall to a valance; faded, torn, or just the frame. */
function awning(out: MeshBuilder, w: WallRef, [sa, sb]: [number, number], head: number, id: number, block: number): void {
  // The block's accent on some; the rest of the canvases are faded toward grey (`QUIET_FADE`), as sun and salt leave them.
  const col = accentOf(block, id, 440) ?? greyed(pickOf(CANVAS, id, 440), QUIET_FADE);
  const state = hash01(id, 441);
  const faded = state < 0.33;
  const torn = state > 0.82;
  const bare = state > 0.7 && state <= 0.82;
  const proj = 1.1 + hash01(id, 442) * 0.4;
  const top = head + 0.12;
  const eave = head - 0.42;
  const face = faded ? scaled([0.55, 0.52, 0.48], 1.1) : col;
  const n = Math.max(3, Math.min(9, Math.round((sb - sa) / 0.32)));
  const ribs: Rgb = hash01(id, 444) < 0.55 ? [0.36, 0.2, 0.12] : [0.3, 0.3, 0.32];
  for (let k = 0; k <= n; k++) {
    const s = sa + ((sb - sa) * k) / n;
    withMat("steel", () => out.prism(wat(w, s, top, 0.02), wat(w, s, eave, proj), 0.012, 4, ribs, null));
  }
  withMat("steel", () => out.prism(wat(w, sa, eave, proj), wat(w, sb, eave, proj), 0.014, 4, ribs, null));
  if (bare) return;
  for (let k = 0; k < n; k++) {
    if (torn && k === Math.floor(n * 0.6)) continue;
    const a = sa + ((sb - sa) * k) / n;
    const c = sa + ((sb - sa) * (k + 1)) / n;
    const tone: Rgb = k % 2 === 0 ? face : scaled(faded ? [0.7, 0.68, 0.62] : [0.85, 0.82, 0.74], faded ? 1 : 0.85);
    out.poly([wat(w, a, top, 0.02), wat(w, c, top, 0.02), wat(w, c, eave, proj), wat(w, a, eave, proj)], [w.nx * 0.4, 1, w.nz * 0.4], tone, "cloth", { back: { colour: scaled(tone, 0.5) } });
    out.poly([wat(w, a, eave, proj), wat(w, c, eave, proj), wat(w, c, eave - 0.22, proj), wat(w, a, eave - 0.22, proj)], [w.nx, 0, w.nz], scaled(tone, 0.9), "cloth", { back: { colour: scaled(tone, 0.5) } });
  }
}

/** A flat canopy of a strip front: a slab over the glass on its own posts' brackets. */
function canopy(out: MeshBuilder, w: WallRef, [sa, sb]: [number, number], head: number, id: number, block: number): void {
  const col: Rgb = accentOf(block, id, 443) ?? pickOf([[0.3, 0.3, 0.3], [0.4, 0.4, 0.38], [0.2, 0.25, 0.3]] as readonly Rgb[], id, 443);
  wbox(out, w, sa, sb, head + 0.1, head + 0.3, 0, 1.4, col, scaled(col, 1.1), true, "painted");
}
