/**
 * What the designed rooms (`sim/inside/design.ts`) are made of, by the interior material names the designs use: one table that maps each name to a
 * material (`materials.ts`, which is a texture layer and how it lies) and to the albedo (linear) it is tinted to. The layers are the rooms' set's
 * (`interiorLayers.ts`), which is loaded when a player first walks into a building (`insideParts.ts`).
 *
 * The albedos are in the town's own scale (the paints of the street's rooms, `roomShell.ts`: a bar's floor is `[0.28, 0.17, 0.09]`), not a measured reflectance. The albedo is the colour the thing is lit to: the baked light (`designLight.ts`) times the albedo is the vertex's colour, which tints the texture as the town's
 * surfaces are tinted, so a floor is the texture's grain and stains in the colour of its wood and not one flat colour. A caller varies it a few percent by a hash (`varied`),
 * so that no two stools or cushions are alike.
 */
import type { MatRef } from "./materials.js";
import { hash01, type Rgb } from "./meshBuilder.js";

export type InteriorMaterial = { readonly mat: MatRef; readonly albedo: Rgb };

/**
 * The interior material names and what each is. Each is one of the rooms' own layers (`interior.layers.json`: marble, carpet, oak, dark wood, cloth, glazed
 * tile, cane), or one of the outdoor layers the rooms' set holds as well (brick, sidewalk concrete, stucco, painted steel); a test holds every name to a layer
 * of that set. The albedo is the colour the surface averages once the texture is multiplied by its tint (the tint is the albedo over the layer's mean colour), so
 * the grain, the joints and the veins are the photograph's and the colour is the design's: `dark_wood` is the bar's floor and counter (the boards' own colour,
 * brightened to the town's scale), `oak` the pale veneer as it is, `cloth` and `carpet` photographs of grey that a tint colours, `glazed_tile` near white.
 */
export const INTERIOR_MATERIALS: Readonly<Record<string, InteriorMaterial>> = {
  plaster: { mat: "plaster", albedo: [0.62, 0.56, 0.45] },
  plaster_dark: { mat: "plaster", albedo: [0.2, 0.23, 0.21] },
  brick: { mat: "brick", albedo: [0.5, 0.29, 0.2] },
  concrete: { mat: "concrete", albedo: [0.5, 0.5, 0.47] },
  painted: { mat: "painted", albedo: [0.6, 0.6, 0.6] },
  ceiling_dark: { mat: "painted", albedo: [0.13, 0.11, 0.09] },
  dark_wood: { mat: "i_darkwood", albedo: [0.2, 0.115, 0.065] },
  oak: { mat: "i_oak", albedo: [0.62, 0.44, 0.26] },
  steel: { mat: "steel", albedo: [0.5, 0.5, 0.52] },
  brass: { mat: "steel", albedo: [0.8, 0.58, 0.22] },
  leather: { mat: "i_cloth", albedo: [0.3, 0.14, 0.1] },
  cloth: { mat: "i_cloth", albedo: [0.5, 0.2, 0.16] },
  glass: { mat: "painted", albedo: [0.5, 0.6, 0.55] },
  paper: { mat: "painted", albedo: [0.85, 0.8, 0.66] },
  marble_tile: { mat: "i_marble", albedo: [0.78, 0.76, 0.72] },
  carpet: { mat: "i_carpet", albedo: [0.3, 0.26, 0.22] },
  glazed_tile: { mat: "i_glazed", albedo: [0.7, 0.76, 0.82] },
  cane: { mat: "i_cane", albedo: [0.5, 0.37, 0.2] },
};

/** The names the table holds, for a test to hold the designs to. */
export const MATERIAL_NAMES: readonly string[] = Object.keys(INTERIOR_MATERIALS);

/** The material of a name; a name that is not in the table is a mistake in a design. */
export function materialOf(name: string): InteriorMaterial {
  const m = INTERIOR_MATERIALS[name];
  if (m === undefined) throw new Error(`no interior material called ${name}`);
  return m;
}

/** A colour a few percent off by a hash: each channel by up to `amount` either way, the three together a little more than apart. */
export function varied(c: Rgb, id: number, salt: number, amount = 0.08): Rgb {
  const all = 1 + (hash01(id, salt) - 0.5) * 2 * amount;
  return [c[0] * all * (1 + (hash01(id, salt + 1) - 0.5) * amount), c[1] * all, c[2] * all * (1 + (hash01(id, salt + 2) - 0.5) * amount)];
}
