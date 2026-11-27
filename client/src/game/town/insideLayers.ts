/**
 * A designed room's layers, laid on the arrays it is drawn with. The room is built once (`insideGeometry.ts`) with each surface naming its layer as the
 * town does: a layer of the town's (a street front's doors and trim, the walls' plaster and brick) or one of the rooms' own (`interiorMaterials.ts`: marble,
 * carpet, oak, dark wood, cloth, glazed tile, cane, whose indices start at `INTERIOR_BASE`). Which texture arrays the room is drawn on is not known until it is
 * built: the rooms' set (`interior.layers.json`, loaded on first entry) if it has landed, else the town's, as the rooms were drawn before they had a set. This
 * module turns the vertices' layer indices into the indices of the arrays chosen, and keeps what a surface looks like where it can:
 *
 * - A layer that both sets hold under one name keeps its picture; only its index moves (the rooms' set holds brick, sidewalk concrete, stucco and painted steel).
 * - A layer the chosen set lacks is laid on the nearest one it has (`TO_INTERIOR`, `TO_TOWN`), the UV scaled by the two layers' tile sizes so the picture stays
 *   at its true scale, and the tint remade so the surface averages the colour its builder gave it over the new picture's mean colour.
 * - On the rooms' set the wear is taken off (it has no overlay to wear a surface with: a room is out of the weather).
 *
 * It changes the arrays in place and does nothing to a vertex that has no layer (glass, flat colour).
 */
import { INTERIOR_LAYERS, interiorIndex } from "./interiorLayers.js";
import { meanOf } from "./materials.js";
import { SURFACE_FLOATS, type MeshArrays } from "./meshBuilder.js";
import { INTERIOR_BASE, INTERIOR_ONLY_NAMES, NO_LAYER, TOWN_LAYERS, townLayer, type LayerName, type TownLayerName } from "./townLayers.js";

export type Target = "interior" | "town";

/** The nearest layer of the rooms' set to each town layer it has none of the same name for: timber to the oak or the dark boards, metal to the steel, stone to the marble, ground and roofs to the concrete. */
const TO_INTERIOR: Readonly<Record<string, string>> = {
  siding_painted: "stucco", planks_peeling: "oak", shingle_siding: "oak", planks_weathered: "dark_wood", metal_aged: "rust", metal_painted: "rust",
  concrete_board: "sidewalk", stone: "marble_tile", plywood: "oak", shutter: "rust", roof_metal: "rust", roof_bitumen: "sidewalk", roof_shingle: "sidewalk",
  asphalt: "sidewalk", asphalt_dark: "sidewalk", gravel: "sidewalk", mud: "sidewalk", moss: "sidewalk",
};

/** The nearest layer of the town's to each of the rooms' own, which are what each name stood for before the rooms had a set. */
const TO_TOWN: Readonly<Record<string, TownLayerName>> = {
  marble_tile: "stone", carpet: "sidewalk", oak: "planks_weathered", dark_wood: "planks_weathered", cloth: "sidewalk", glazed_tile: "sidewalk", cane: "planks_weathered",
};

/** What a vertex's layer index names: the layer's name, and whether it is one of the rooms' own. */
function nameOf(index: number): { name: string; own: boolean } | undefined {
  if (index >= INTERIOR_BASE) {
    const name = INTERIOR_ONLY_NAMES[index - INTERIOR_BASE];
    return name === undefined ? undefined : { name, own: true };
  }
  const layer = TOWN_LAYERS[index];
  return layer === undefined ? undefined : { name: layer.name, own: false };
}

/** The most a tint lifts a picture by (`materials.ts`). */
const GAIN_MAX = 10;

/** A layer of either set as this module needs it. */
type Dest = { readonly name: string; readonly index: number; readonly tile: readonly [number, number]; readonly paintable: boolean; readonly mean: readonly number[] };

/** What a layer index becomes: the new index, the UV factors, and the two pictures when the tint has to be remade (null when the layer keeps its picture). */
type Plan = { readonly to: number; readonly su: number; readonly sv: number; readonly remake: { readonly from: Dest; readonly to: Dest } | null };

/** Lays the room's layers on the arrays of `target`; see the header. */
export function retargetLayers(a: MeshArrays, target: Target): void {
  const vertices = a.surface.length / SURFACE_FLOATS;
  const plans = new Map<number, Plan | null>();
  for (let v = 0; v < vertices; v++) {
    const at = v * SURFACE_FLOATS;
    const index = Math.round(a.surface[at] as number);
    if (index < 0) continue;
    let plan = plans.get(index);
    if (plan === undefined) {
      plan = planFor(index, target);
      plans.set(index, plan);
    }
    if (plan === null) {
      // A layer that the chosen set cannot give (a mistake in a builder): flat colour, which is what a vertex with no layer is.
      a.surface[at] = NO_LAYER;
      continue;
    }
    a.surface[at] = plan.to;
    if (target === "interior") {
      a.surface[at + 1] = 0;
      a.surface[at + 8] = 0;
    }
    if (plan.su !== 1 || plan.sv !== 1) {
      a.uvs[v * 2] = (a.uvs[v * 2] as number) * plan.su;
      a.uvs[v * 2 + 1] = (a.uvs[v * 2 + 1] as number) * plan.sv;
    }
    if (plan.remake !== null) {
      const { from, to } = plan.remake;
      for (let k = 0; k < 3; k++) {
        const tint = a.surface[at + 4 + k] as number;
        const colour = from.paintable ? tint : tint * (from.mean[k] as number);
        a.surface[at + 4 + k] = to.paintable ? colour : Math.min(GAIN_MAX, colour / Math.max(0.01, to.mean[k] as number));
      }
    }
  }
}

function planFor(index: number, target: Target): Plan | null {
  const named = nameOf(index);
  if (named === undefined) return null;
  const layer = townLayer(named.name as LayerName);
  const from: Dest = { name: named.name, index, tile: layer.tile, paintable: layer.paintable, mean: meanOf(named.name as LayerName) };
  const to = target === "interior" ? interiorDestination(named.name) : townDestination(named.name);
  if (to === null) return null;
  if (to.name === from.name) return { to: to.index, su: 1, sv: 1, remake: null };
  return { to: to.index, su: from.tile[0] / to.tile[0], sv: from.tile[1] / to.tile[1], remake: { from, to } };
}

/** The layer of the rooms' set a layer is laid on: its own of that name, else the nearest (`TO_INTERIOR`). */
function interiorDestination(name: string): Dest | null {
  const chosen = interiorIndex(name) === undefined ? TO_INTERIOR[name] : name;
  const layer = INTERIOR_LAYERS.find((l) => l.name === chosen);
  return layer === undefined ? null : { name: layer.name, index: layer.index, tile: layer.tile, paintable: layer.paintable, mean: layer.mean };
}

/** The layer of the town's set a layer is laid on: itself if it is the town's, else the nearest (`TO_TOWN`). */
function townDestination(name: string): Dest | null {
  const chosen = (INTERIOR_ONLY_NAMES as readonly string[]).includes(name) ? TO_TOWN[name] : name;
  const layer = TOWN_LAYERS.find((l) => l.name === chosen);
  return layer === undefined ? null : { name: layer.name, index: layer.index, tile: layer.tile, paintable: layer.paintable, mean: meanOf(layer.name) };
}
