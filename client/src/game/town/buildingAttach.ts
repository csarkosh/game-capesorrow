/**
 * What is fixed to a commercial building's walls and stands at their foot, by the building's own record. Nothing here is scatter: each thing has its
 * reason and its place, and the building's age, state and trades decide how many and how bad.
 *
 * - **Downspouts** at the ends of a wall that a roof drains to (leaning, a little off plumb; one in four has lost its bottom length and ends in a stub
 *   at hand height; a rust run under the bracket of an old one). Walls that stand against a neighbour have none.
 * - **Service**: an electric meter (off centre, with a conduit up to the eave and a cable stapled along the wall), a gas meter and its pipe on the
 *   trades that cook or heat (a kitchen, a bakery, a laundry, a hotel, a clinic), a hose bib, a vent louvre, a wall air conditioner (a building remodelled
 *   after 1970), a security light over a back door, an alarm box, an old sign bracket with no sign on it (an old building, more of them when vacant).
 * - **At the foot** of a back or side wall: a pallet stack, milk crates, a mop bucket, a propane cage, a grease bin and a bin of cigarette ends, by trade;
 *   a vacant unit's lot gets a broken chair and a flattened box. Small, never solid, never in front of the front.
 *
 * Every face of a thing that hangs on a wall is put through the face ledger (`faceLedger.ts`) so it stands clear of the wall's other faces. Full tier
 * only; the low tier has none of it (its walls get the material's wear alone).
 */
import { withMat } from "./materials.js";
import { hash01, scaled, type Rgb } from "./meshBuilder.js";
import { wat, wbox, type WallRef } from "./buildingKit.js";
import { agingOf } from "./buildingWear.js";
import { isClear, noteFace, noteStanding, standClear } from "./faceLedger.js";
import { insideOther } from "./openingsGeometry.js";
import type { PartsIn } from "./buildingParts.js";

const GREY: Rgb = [0.5, 0.5, 0.48];
const BROWN: Rgb = [0.22, 0.14, 0.09];
const WHITE: Rgb = [0.66, 0.65, 0.6];
const RUST: Rgb = [0.34, 0.17, 0.09];
const CONDUIT: Rgb = [0.45, 0.45, 0.47];
const PALLET: Rgb = [0.4, 0.3, 0.2];

const COOKS = ["restaurant", "diner", "cafe", "bakery", "tavern", "hotel", "laundromat", "medical clinic", "rooming house", "inn", "convenience store"];
const SMOKES = ["tavern", "convenience store", "bait and tackle", "diner"];

/** Whether a fence of the plan runs within `reach` metres of a point of the world. */
export function nearFence(i: PartsIn, x: number, z: number, reach: number): boolean {
  const px = x - i.g.anchor.x;
  const pz = z - i.g.anchor.z;
  for (const f of i.g.plan.props.fences) {
    const ex = f.bx - f.ax;
    const ez = f.bz - f.az;
    const l2 = ex * ex + ez * ez;
    const t = l2 < 1e-9 ? 0 : Math.max(0, Math.min(1, ((px - f.ax) * ex + (pz - f.az) * ez) / l2));
    const dx = px - (f.ax + ex * t);
    const dz = pz - (f.az + ez * t);
    if (dx * dx + dz * dz < reach * reach) return true;
  }
  return false;
}

/** True where a clutter piece at (x, z) of `r` metres is on the building's own lot and not over the front's sidewalk side: the caller checks the wall; this checks the ground. */
function placeOk(i: PartsIn, x: number, z: number, r: number): boolean {
  const h = i.g.heightAt(x, z);
  if (!(Math.abs(h - i.baseY) < 0.6 && r > 0)) return false;
  // Outside the building's own rooms (the front frame's box), with a margin: clutter is in the yard, never in a shell.
  const xf = i.xf;
  if (xf === null) return true;
  const s = (x - xf.ox) * xf.tx + (z - xf.oz) * xf.tz;
  const d = -((x - xf.ox) * xf.nx + (z - xf.oz) * xf.nz);
  const rooms = (i.use?.units ?? []).reduce((m, u) => Math.max(m, u.interior.depth), xf.depth);
  if (!(s < -0.1 - r || s > xf.width + 0.1 + r || d < -r - 0.2 || d > rooms + 0.1 + r)) return false;
  // Not over another building's footprint (nor within 0.8 m of one), and not within reach of a fence.
  const px = x - i.g.anchor.x;
  const pz = z - i.g.anchor.z;
  for (const [ox, oz] of [[0, 0], [0.8, 0], [-0.8, 0], [0, 0.8], [0, -0.8]] as const) if (insideOther(i.g.plan, i.b.id, px + ox, pz + oz)) return false;
  if (nearFence(i, x, z, 1.2)) return false;
  return true;
}

export function attachmentsGeometry(i: PartsIn): void {
  const { b, refs, out, floorY } = i;
  if (i.detail !== "full") return;
  const { age, neglect } = agingOf(b);
  const trades = (i.use?.units ?? []).map((u) => u.tenant?.trade ?? "").filter((t) => t !== "");
  const cooks = trades.some((t) => COOKS.includes(t));
  const smokes = trades.some((t) => SMOKES.includes(t));
  // This building's own keeping: how many of the small things it has, 0 to 1 (a vacant or old one more).
  const heap = Math.min(1, 0.25 + 0.5 * age + 0.4 * neglect + 0.3 * hash01(b.id, 600));
  const front = refs[i.frontAt] as WallRef;
  let primary = -1;
  refs.forEach((w, k) => {
    if (k === i.frontAt || i.blocked[k] || w.length < 3) return;
    if (primary < 0 || w.length > (refs[primary] as WallRef).length) primary = k;
  });
  refs.forEach((w, k) => {
    const isFront = k === i.frontAt;
    if (i.blocked[k] || w.length < 2.4) return;
    const rnd = (salt: number): number => hash01(b.id * 17 + k * 5, 601 + salt);
    // ---- downspouts: at a corner end of a wall (the front's too, at the party-line end only where the wall is free)
    const pitched = i.roofKind !== "flat";
    const spouts = pitched ? 0 : isFront ? (rnd(0) < 0.5 ? 1 : 0) : rnd(0) < 0.85 ? 1 + (w.length > 14 && rnd(1) < 0.5 ? 1 : 0) : 0;
    for (let n = 0; n < spouts; n++) {
      const end = n === 0 ? (rnd(2) < 0.5 ? 0 : 1) : 1 - (rnd(2) < 0.5 ? 0 : 1);
      const s = end === 0 ? 0.16 + rnd(3) * 0.1 : w.length - 0.16 - rnd(3) * 0.1;
      const lean = (rnd(4) - 0.5) * 0.09;
      const lost = rnd(5) < 0.22 + 0.2 * neglect;
      const col = rnd(6) < 0.4 ? WHITE : rnd(6) < 0.7 ? GREY : BROWN;
      const top = i.wallTop - 0.15;
      const base = Math.max(i.baseY, i.g.heightAt(wat(w, s, 0, 0.1)[0], wat(w, s, 0, 0.1)[2])) + 0.08;
      const y1 = lost ? base + 1.5 + rnd(7) * 0.6 : base + 0.12;
      const a = wat(w, s, top, 0.095);
      const c = wat(w, s + lean, y1, 0.095);
      if (!ok(w, Math.min(s, s + lean) - 0.04, Math.max(s, s + lean) + 0.04, y1, top, 0.095)) continue;
      const cb = wat(w, s + lean, y1 + 0.18, 0.095);
      withMat("steel", () => out.prism(a, lost ? c : cb, 0.032, 4, col, null));
      // The bottom shoe, kicked out; a bracket band halfway.
      if (!lost) withMat("steel", () => out.prism(cb, wat(w, s + lean + (end === 0 ? 0.08 : -0.08), y1 - 0.03, 0.16), 0.032, 4, col, null));
      const mid = wat(w, s + lean * 0.5, (top + y1) / 2, 0.095);
      void scaled;
      // The wall under a bracket of an old one is run with rust.
      if (age > 0.4 && col === GREY && full(i)) withMat("rusty", () => out.prism(wat(w, s + lean * 0.5 + (end === 0 ? 0.11 : -0.11), mid[1] - 0.05, 0.05), wat(w, s + lean * 0.8 + (end === 0 ? 0.12 : -0.12), mid[1] - 0.9 * (0.4 + rnd(8)), 0.05), 0.012, 4, RUST, null));
    }
    if (isFront) return;
    // ---- service: a meter off centre, its conduit and a stapled cable to the corner
    if (k === primary && rnd(10) < 0.9) {
      const s = w.length * (0.15 + 0.7 * rnd(11));
      const y0 = floorY + 1.15 + rnd(12) * 0.35;
      const clear = ok(w, s - 0.14, s + 0.14, y0, y0 + 0.5, 0.14);
      if (clear) {
        wbox(out, w, s - 0.14, s + 0.14, y0, y0 + 0.46, 0, 0.14, [0.62, 0.62, 0.6], [0.62, 0.62, 0.6], undefined, "painted");
        withMat("steel", () => {
          out.prism(wat(w, s, y0 + 0.46, 0.07), wat(w, s + (rnd(13) - 0.5) * 0.06, i.wallTop - 0.25, 0.07), 0.02, 4, CONDUIT, null);
          out.prism(wat(w, s, y0, 0.07), wat(w, s, i.baseY + 0.08, 0.07), 0.02, 4, CONDUIT, null);
        });
        // A cable stapled along the siding, a little sagged, to the end the service comes from.
        // Nor along a neighbour's wall built to this one (the cable would lie in its face).
        const eEnd = rnd(15) < 0.5 ? 0.3 : w.length - 0.3;
        const buried = [0, 0.25, 0.5, 0.75, 1].some((q) => {
          const x = wat(w, s + (eEnd - s) * q, 0, 0.12);
          return insideOther(i.g.plan, i.b.id, x[0] - i.g.anchor.x, x[2] - i.g.anchor.z);
        });
        if (!buried && rnd(14) < 0.5 + 0.3 * age) {
          const e = eEnd;
          const yc = i.wallTop - 0.55 - rnd(16) * 0.3;
          withMat("rubber", () => {
            out.prism(wat(w, s + 0.05, yc + 0.02, 0.06), wat(w, (s + e) / 2, yc - 0.06, 0.06), 0.01, 3, [0.08, 0.08, 0.09], null);
            out.prism(wat(w, (s + e) / 2, yc - 0.06, 0.06), wat(w, e, yc + 0.03, 0.06), 0.01, 3, [0.08, 0.08, 0.09], null);
          });
        }
      }
    }
    // ---- a gas meter and its pipe, on the trades that burn it
    if (k === primary && cooks && rnd(20) < 0.8) {
      const s = w.length * (0.1 + 0.8 * rnd(21));
      const y0 = i.baseY + 0.5;
      if (ok(w, s - 0.2, s + 0.2, y0, y0 + 0.4, 0.2)) {
        wbox(out, w, s - 0.2, s + 0.2, y0, y0 + 0.4, 0, 0.2, [0.55, 0.5, 0.2], [0.58, 0.54, 0.24], undefined, "painted");
        withMat("steel", () => {
          out.prism(wat(w, s, y0 + 0.4, 0.08), wat(w, s, y0 + 1.9, 0.08), 0.025, 4, [0.55, 0.47, 0.15], null);
          out.prism(wat(w, s, y0, 0.08), wat(w, s, i.baseY + 0.05, 0.08), 0.025, 4, [0.55, 0.47, 0.15], null);
        });
      }
    }
    // ---- a hose bib, a vent louvre, a security light
    const place = (salt: number): number => 0.5 + (w.length - 1) * rnd(salt);
    if (rnd(30) < 0.55) {
      const s = place(31);
      const p = wat(w, s, i.baseY + 0.45, 0.06);
      withMat("steel", () => out.prism(p, wat(w, s, i.baseY + 0.45, 0.2), 0.02, 4, [0.55, 0.5, 0.3], null));
    }
    if (rnd(32) < 0.5 && cooks) {
      const s = place(33);
      const y0 = floorY + 2.1 + rnd(34) * 0.5;
      if (ok(w, s - 0.25, s + 0.25, y0, y0 + 0.3, 0.12)) wbox(out, w, s - 0.25, s + 0.25, y0, y0 + 0.3, 0, 0.12, [0.32, 0.32, 0.34], [0.36, 0.36, 0.38], true, "sheet");
    }
    if (rnd(35) < 0.6 && b.era >= 1970) {
      const s = place(36);
      const y0 = floorY + 2.45;
      if (ok(w, s - 0.25, s + 0.25, y0, y0 + 0.5, 0.2)) wbox(out, w, s - 0.25, s + 0.25, y0, y0 + 0.2 + 0.3, 0, 0.2, [0.7, 0.7, 0.66], [0.72, 0.72, 0.68], undefined, "steel");
    }
    if (rnd(37) < 0.5 && !i.vacant) {
      const s = place(38);
      const y0 = floorY + 2.4;
      if (ok(w, s - 0.08, s + 0.08, y0, y0 + 0.14, 0.09)) {
        wbox(out, w, s - 0.08, s + 0.08, y0, y0 + 0.14, 0, 0.09, [0.3, 0.3, 0.3], [0.3, 0.3, 0.3], undefined, "painted");
        withMat("painted", () => out.prism(wat(w, s, y0 + 0.07, 0.09), wat(w, s, y0 - 0.03, 0.28), 0.03, 4, [0.85, 0.82, 0.6], null));
      }
    }
    // ---- an old bracket where a sign hung, with no sign
    if (rnd(40) < 0.15 + 0.5 * age * (i.vacant ? 1.5 : 1)) {
      const s = place(41);
      const y = floorY + 3.3 + rnd(42) * 0.5;
      if (ok(w, s - 0.05, s + 0.05, y - 0.04, y + 0.04, 0.05)) {
        withMat("rusty", () => {
          out.prism(wat(w, s, y, 0.06), wat(w, s + 0.0, y, 0.8), 0.02, 4, RUST, null);
          out.prism(wat(w, s, y + 0.35, 0.06), wat(w, s, y, 0.6), 0.012, 4, RUST, null);
        });
      }
    }
    // ---- clutter at the foot of the long back or side wall
    if (k === primary || rnd(50) < 0.3) {
      const n = Math.min(Math.floor((w.length - 1) / 1.6), Math.round(heap * (1 + 3 * rnd(51))));
      const lane = 0.5 + 0.3 * rnd(52);
      const slot0 = 0.5 + 0.5 * rnd(53);
      for (let c = 0; c < n; c++) {
        const s = slot0 + 0.8 + c * 1.6;
        const kind = hash01(b.id * 31 + k * 11 + c, 611);
        // Clear of a back door's step (0.5 m out) by the piece's own half depth.
        const hv = kind < 0.25 ? 0.4 : kind < 0.45 ? 0.17 : kind < 0.6 ? 0.2 : kind < 0.75 && cooks ? 0.35 : kind < 0.88 && smokes ? 0.07 : i.vacant ? 0.3 : 0.2;
        const d = 0.7 + hv + (lane - 0.5) * 0.4;
        const p = wat(w, s, 0, d);
        if (!placeOk(i, p[0], p[2], 0.5)) continue;
        // On the highest ground under the piece's footprint, so that a paved patch laid in plain triangles over the lumps of the ground is not over it; a sheet of plywood is two sheets thick, its top clear of the patch's plane by more than the rule.
        const y = Math.max(...[[0, 0], [hv, hv], [hv, -hv], [-hv, hv], [-hv, -hv]].map(([dx, dz]) => i.g.heightAt(p[0] + (dx as number), p[2] + (dz as number)))) + 0.04;
        const ux = w.tx;
        const uz = w.tz;
        if (kind < 0.25) {
          // A stack of pallets, a few high, not squared.
          const hh = 0.14 * (2 + Math.floor(hash01(b.id + c, 613) * 4));
          if (boxFree(p[0], p[2], ux, uz, 0.5, 0.4, y, y + hh)) withMat("wood", () => out.box(p[0], p[2], y, ux, uz, 0.5, 0.4, hh, PALLET, scaled(PALLET, 1.1)));
        } else if (kind < 0.45) {
          // Milk crates, three in a stack.
          withMat("plastic", () => out.box(p[0], p[2], y, ux, uz, 0.17, 0.17, 0.45, [0.15, 0.3, 0.55], [0.18, 0.34, 0.6]));
        } else if (kind < 0.6) {
          withMat("steel", () => out.cylinder(p[0], p[2], y, 0.2, 0.36, 7, [0.55, 0.52, 0.2], [0.35, 0.35, 0.3]));
        } else if (kind < 0.75 && cooks) {
          // A grease bin: a lidded steel box.
          if (boxFree(p[0], p[2], ux, uz, 0.45, 0.35, y, y + 0.95)) withMat("steel", () => out.box(p[0], p[2], y, ux, uz, 0.45, 0.35, 0.95, [0.22, 0.25, 0.22], [0.18, 0.2, 0.18]));
        } else if (kind < 0.88 && smokes) {
          // A bin of cigarette ends on the wall.
          withMat("steel", () => out.cylinder(p[0], p[2], y, 0.07, 0.55, 6, [0.25, 0.25, 0.27], [0.1, 0.1, 0.1]));
        } else if (i.vacant) {
          if (boxFree(p[0], p[2], ux, uz, 0.45, 0.3, y, y + 0.08)) withMat("ply", () => out.box(p[0], p[2], y, ux, uz, 0.45, 0.3, 0.08, [0.4, 0.34, 0.24], [0.42, 0.36, 0.26]));
        } else {
          withMat("steel", () => out.cylinder(p[0], p[2], y, 0.2, 0.55, 6, [0.5, 0.5, 0.52], [0.2, 0.2, 0.2], 0.17));
        }
      }
    }
  });
  void front;
}

function ok(w: WallRef, s0: number, s1: number, y0: number, y1: number, off: number): boolean {
  const a = wat(w, s0, y0, off);
  const c = wat(w, s1, y1, off);
  // Its ends too: a box's end faces are faces of the ledger (`wbox`), and two boxes' ends a few millimetres apart are a pair.
  const e0 = wat(w, s0, y0, 0);
  const e1 = wat(w, s1, y0, 0);
  return isClear(w.nx, w.nz, a[0], a[2], c[0], c[2], y0, y1) && isClear(-w.tx, -w.tz, e0[0], e0[2], a[0], a[2], y0, y1) && isClear(w.tx, w.tz, e1[0], e1[2], c[0], c[2], y0, y1);
}

/** Whether a standing box (centre, along (ux, uz), half extents) stands clear of the pieces and the faces noted; when it does, it is noted, and it is laid. */
function boxFree(cx: number, cz: number, ux: number, uz: number, hu: number, hv: number, y0: number, y1: number): boolean {
  const vx = uz;
  const vz = -ux;
  const c = (su: number, sv: number): [number, number] => [cx + ux * hu * su + vx * hv * sv, cz + uz * hu * su + vz * hv * sv];
  const [p00, p10, p11, p01] = [c(-1, -1), c(1, -1), c(1, 1), c(-1, 1)];
  // Not through another standing piece (a pallet stack where a sheet of plywood lies).
  if (!standClear(cx, cz, Math.hypot(hu, hv))) return false;
  const sides: readonly (readonly [number, number, [number, number], [number, number]])[] = [[-vx, -vz, p00, p10], [ux, uz, p10, p11], [vx, vz, p11, p01], [-ux, -uz, p01, p00]];
  if (!sides.every(([nx, nz, a, b]) => isClear(nx, nz, a[0], a[1], b[0], b[1], y0, y1))) return false;
  for (const [nx, nz, a, b] of sides) noteFace(nx, nz, a[0], a[1], b[0], b[1], y0, y1);
  noteStanding(cx, cz, Math.hypot(hu, hv));
  return true;
}

function full(i: PartsIn): boolean {
  return i.detail === "full";
}
