/**
 * The windows of dwellings and of the upper floors, one record each, so that no two fronts match.
 *
 * WHAT CAUSES EACH VARIATION. A household has a habit (curtains or blinds), a green thumb (plants on a third of the sills) and a
 * lamp it keeps lit in the window or not; most windows follow the habit, the rest do not (a bedroom with the other kind). A
 * window is lit when someone is home and has a light on. A vacant house is boarded where the owner or the bank came to it, bare
 * and dark elsewhere; a ruin has lost its glass. Where the front door stands is the plan's: windows are spaced evenly and those
 * the door would take are left out, so the door sits off-centre by the house's own plan.
 */
import { chance, next, range, type Rng } from "../../rng.js";
import type { BuildingState, FrontFrame, UpperUse, WindowState, WindowTreatment } from "../../types.js";
import { r2 } from "./ctx.js";

type Habit = { readonly treat: "curtained" | "blinds"; readonly plants: boolean; readonly lamp: boolean };

export function household(rng: Rng): Habit {
  return { treat: chance(rng, 0.6) ? "curtained" : "blinds", plants: chance(rng, 0.35), lamp: chance(rng, 0.25) };
}

function dwellingState(rng: Rng, h: Habit, state: BuildingState): { state: WindowTreatment; sill: WindowState["sill"] } {
  if (state === "ruin") {
    const r = next(rng);
    return { state: r < 0.5 ? "broken" : r < 0.8 ? "boarded" : "dark", sill: "none" };
  }
  if (state === "vacant") return { state: next(rng) < 0.4 ? "boarded" : "dark", sill: "none" };
  const r = next(rng);
  const st: WindowTreatment = r < 0.2 ? "lit" : r < 0.3 ? "dark" : next(rng) < 0.7 ? h.treat : h.treat === "curtained" ? "blinds" : "curtained";
  const sill: WindowState["sill"] = h.plants && chance(rng, 0.4) ? "plant" : h.lamp && st !== "dark" && chance(rng, 0.3) ? "lamp" : "none";
  return { state: st, sill };
}

/** The positions of a front's windows on a storey: evenly spaced, none within 1.3 m of the door (storey 0). */
function frontStops(W: number, door: number | null): number[] {
  const n = Math.max(1, Math.floor((W - 1.6) / 2.8));
  const out: number[] = [];
  for (let k = 0; k < n; k++) {
    const s = 0.8 + ((k + 0.5) * (W - 1.6)) / n;
    if (door !== null && Math.abs(s - door) < 1.3) continue;
    out.push(r2(s));
  }
  if (out.length === 0) out.push(r2(door !== null && door < W / 2 ? W - 1.2 : 1.2));
  return out;
}

/** Every window of a dwelling (a house, an apartment house), and its front door. */
export function dwelling(rng: Rng, frame: FrontFrame, storeys: number, state: BuildingState): { windows: WindowState[]; door: { s: number; width: number } } {
  const W = frame.width;
  const door = { s: r2(range(rng, Math.min(2, W / 3), Math.max(W - 2, W * 0.66))), width: r2(range(rng, 0.9, 1.05)) };
  const h = household(rng);
  const windows: WindowState[] = [];
  for (let st = 0; st < storeys; st++) {
    for (const s of frontStops(W, st === 0 ? door.s : null)) windows.push({ wall: "front", storey: st, s, ...dwellingState(rng, h, state) });
    const nSide = Math.max(1, Math.floor(frame.depth / 4.5));
    for (const wall of ["left", "right"] as const) {
      for (let k = 0; k < nSide; k++) windows.push({ wall, storey: st, s: r2(2.2 + ((k + 0.5) * (frame.depth - 3.2)) / nSide), ...dwellingState(rng, h, state) });
    }
  }
  return { windows, door };
}

/** The windows of one upper storey of a block, by the use that floor has. */
export function upperFloor(rng: Rng, frame: FrontFrame, storey: number, use: UpperUse["use"], state: BuildingState): WindowState[] {
  const W = frame.width;
  const out: WindowState[] = [];
  const n = Math.max(2, Math.floor((W - 1.5) / 2.6));
  const h = household(rng);
  for (let k = 0; k < n; k++) {
    const s = r2(0.75 + ((k + 0.5) * (W - 1.5)) / n);
    let st: WindowTreatment;
    let sill: WindowState["sill"] = "none";
    if (state !== "open" || use === "empty") {
      const r = next(rng);
      st = state === "open" ? (r < 0.4 ? "boarded" : r < 0.8 ? "dark" : "broken") : r < 0.5 ? "boarded" : r < 0.7 ? "broken" : "dark";
    } else if (use === "apartments" || use === "hotel rooms") {
      const d = dwellingState(rng, h, "open");
      st = d.state;
      sill = d.sill;
    } else if (use === "offices") {
      const r = next(rng);
      st = r < 0.5 ? "blinds" : r < 0.8 ? "lit" : "dark";
    } else {
      // Storage and the lodge's hall: dark, or blinds drawn.
      const r = next(rng);
      st = r < 0.6 ? "dark" : r < 0.9 ? "blinds" : "boarded";
    }
    out.push({ wall: "front", storey, s, state: st, sill });
  }
  return out;
}
