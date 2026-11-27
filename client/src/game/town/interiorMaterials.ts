/**
 * What the designed rooms (`sim/inside/design.ts`) are made of, by the interior material names the designs use: one table that maps each name to the town's
 * material (`materials.ts`, which is a texture layer and how it lies) and to the albedo (linear) it is tinted to. Until the interior's own textures arrive each name maps to the
 * nearest of the town's 22 layers; when they do, only this table changes.
 *
 * The albedos are in the town's own scale (the paints of the street's rooms, `roomShell.ts`: a bar's floor is `[0.28, 0.17, 0.09]`), not a measured reflectance. The albedo is the colour the thing is lit to: the baked light (`designLight.ts`) times the albedo is the vertex's colour, which tints the texture as the town's
 * surfaces are tinted, so a floor is the texture's grain and stains in the colour of its wood and not one flat colour. A caller varies it a few percent by a hash (`varied`),
 * so that no two stools or cushions are alike.
 */
import type { MatRef } from "./materials.js";
import { hash01, type Rgb } from "./meshBuilder.js";

export type InteriorMaterial = { readonly mat: MatRef; readonly albedo: Rgb };

/** The interior material names and what each is, for now. */
export const INTERIOR_MATERIALS: Readonly<Record<string, InteriorMaterial>> = {
  plaster: { mat: "plaster", albedo: [0.62, 0.56, 0.45] },
  plaster_dark: { mat: "plaster", albedo: [0.2, 0.23, 0.21] },
  brick: { mat: "brick", albedo: [0.5, 0.29, 0.2] },
  concrete: { mat: "concrete", albedo: [0.5, 0.5, 0.47] },
  painted: { mat: "painted", albedo: [0.6, 0.6, 0.6] },
  ceiling_dark: { mat: "painted", albedo: [0.13, 0.11, 0.09] },
  dark_wood: { mat: "wood", albedo: [0.22, 0.13, 0.07] },
  oak: { mat: "wood", albedo: [0.5, 0.32, 0.17] },
  steel: { mat: "steel", albedo: [0.5, 0.5, 0.52] },
  brass: { mat: "steel", albedo: [0.8, 0.58, 0.22] },
  leather: { mat: "cloth", albedo: [0.3, 0.14, 0.1] },
  cloth: { mat: "cloth", albedo: [0.5, 0.2, 0.16] },
  glass: { mat: "painted", albedo: [0.5, 0.6, 0.55] },
  paper: { mat: "painted", albedo: [0.85, 0.8, 0.66] },
  marble_tile: { mat: "stone", albedo: [0.75, 0.72, 0.68] },
  carpet: { mat: "cloth", albedo: [0.3, 0.26, 0.22] },
  glazed_tile: { mat: "painted", albedo: [0.7, 0.76, 0.82] },
  cane: { mat: "rope", albedo: [0.6, 0.45, 0.22] },
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
