/**
 * What a thing is made of, by name: the way a builder gives a polygon a photographed surface without laying out a frame for it. Nothing in
 * the town is drawn as a flat colour: a polygon with no `Surface` of its own takes a material, named on the polygon itself (`"wood"` in the
 * place of a surface), or the one its builder is working in (`withMat`), or, when neither names one, `FALLBACK`, which a test holds to never
 * happening (`unnamed`).
 *
 * A material is a texture layer (`townLayers.ts`) and how it lies on a polygon:
 *
 * - **The frame is found from the polygon.** A level face lies on the world's x and z; a standing one along the world's axis it lies nearest and
 *   up. Both from the world's origin, so two faces in one plane carry on from each other and show the same texel at the same place. `grain: "long"` runs the picture's across along the polygon's longest
 *   edge (a board's grain runs along the board, whichever way it is put); `"up"` stands the picture on its side (boards that stand).
 * - **The colour stays the builder's.** A paintable layer is neutral detail and takes the polygon's colour as its paint. Any other layer has a
 *   colour of its own, so its tint is the polygon's colour over the layer's mean (`MEAN`): the thing is still the colour its builder gave it,
 *   with the photograph's grain, stains and relief in it.
 * - **`scale`** is how many times finer than true size the picture is laid (a small thing shows more of it); **`wear`** is the weathering
 *   every such thing has (`townSurface.ts`).
 *
 * Authored: the table. The layers are what the game has; a material with no layer of its own kind (plastic, rubber, rope, cloth, glass) uses the
 * nearest (`stand-in` below).
 */
import type { LayerName } from "./townLayers.js";
import { TOWN_LAYERS, layerIndex } from "./townLayers.js";
import type { Surface, WearKind } from "./townSurface.js";

type V3 = readonly [number, number, number];

export type MatName =
  | "wood" | "bark" | "boards" | "ply" | "painted" | "plastic" | "cloth" | "rope"
  | "steel" | "rusty" | "ribbed" | "sheet"
  | "concrete" | "formed" | "brick" | "stone" | "plaster"
  | "rubber" | "tar" | "shingle" | "soil" | "gravel" | "plant";

/** A material with its own wear, scale or tint in the place of the table's. */
export type MatSpec = { readonly mat: MatName; readonly wear?: number; readonly wearKind?: WearKind; readonly scale?: number; readonly streaks?: boolean };
export type MatRef = MatName | MatSpec;

type Mat = {
  readonly layer: LayerName; readonly grain?: "long" | "up"; readonly scale?: number; readonly wear?: number; readonly wearKind?: WearKind; readonly streaks?: boolean;
  /** A film of dust and scuffs: how far the thing's colour is lifted toward grey, 0 to 1 (a black cart is never black out of doors, and with none its grain would not show). */
  readonly dust?: number;
};

const MATS: Readonly<Record<MatName, Mat>> = {
  // Bare weathered timber: posts, rails, planks, piles, pallets, crates, steps.
  wood: { layer: "planks_weathered", grain: "long" },
  // A log in its bark, or weathered grey without it: the same timber laid on the world's axes and not along the log, so two logs that lie
  // against each other (a pond's, a pile's) show the same furrow at the same place.
  bark: { layer: "planks_weathered", scale: 2 },
  // Painted boards whose paint is going: old doors, skirts, sheds, painted furniture.
  boards: { layer: "planks_peeling", grain: "long" },
  ply: { layer: "plywood", grain: "long" },
  // Smooth paint over anything: trim, a steel door, a cabinet, a sign's back. The fine even grain of trowelled concrete, laid small and tinted
  // the thing's colour: a matt coat with the dirt of years in it and no pattern of its own.
  painted: { layer: "sidewalk", scale: 3, wear: 0.1, wearKind: "grime" },
  // Stand-ins: moulded plastic (a wheeled cart, a tote, a buoy) on the stained plaster's blotches, dusty and green with algae; cloth (a tarp, an
  // awning, a curtain) on the fine grain; rope and net on the timber's.
  plastic: { layer: "stucco", scale: 2.5, dust: 0.09, wear: 0.2, wearKind: "algae" },
  cloth: { layer: "sidewalk", scale: 6 },
  rope: { layer: "planks_weathered", grain: "long", scale: 5 },
  // Painted steel that lives outdoors: a trash can, a hydrant, a pole, a rail, a bracket. Paint with rust coming through.
  steel: { layer: "rust", scale: 3, dust: 0.03 },
  // Steel whose paint has mostly gone: a drum, an old tank, a chain, a burner.
  rusty: { layer: "rust", wear: 0.6, wearKind: "rust" },
  // Corrugated sheet, ribs standing; and the same lying (a roof's, a canopy's top).
  ribbed: { layer: "metal_aged", wear: 0.2, wearKind: "rust", streaks: true },
  sheet: { layer: "metal_aged", scale: 2, wear: 0.15, wearKind: "rust" },
  concrete: { layer: "sidewalk", wear: 0.15, wearKind: "grime" },
  formed: { layer: "concrete_board", wear: 0.2, wearKind: "algae" },
  brick: { layer: "brick" },
  stone: { layer: "stone" },
  plaster: { layer: "stucco" },
  // Stand-in for rubber (a tyre, a fender, a hose): the dark asphalt's fine black grain.
  rubber: { layer: "asphalt_dark", scale: 3 },
  tar: { layer: "roof_bitumen", scale: 8 },
  shingle: { layer: "roof_shingle" },
  soil: { layer: "mud" },
  gravel: { layer: "gravel" },
  // Stand-in for leaves and stems where the engine's own plants are not used: the moss layer's green mat.
  plant: { layer: "moss", scale: 2 },
};

/**
 * Each layer's mean colour, linear, as its file has it (measured from `client/assets/textures/town.<name>.color.webp`; a paintable layer's
 * is neutral and not used). A test holds the list to the layers.
 */
export const MEAN: Readonly<Record<LayerName, V3>> = {
  siding_painted: [0.5, 0.5, 0.5], planks_peeling: [0.116, 0.161, 0.128], shingle_siding: [0.091, 0.077, 0.054], planks_weathered: [0.134, 0.124, 0.098],
  brick: [0.254, 0.168, 0.105], metal_aged: [0.5, 0.5, 0.5], metal_painted: [0.018, 0.093, 0.019], concrete_board: [0.173, 0.15, 0.107],
  stucco: [0.5, 0.5, 0.5], stone: [0.087, 0.067, 0.037], plywood: [0.21, 0.122, 0.053], shutter: [0.217, 0.232, 0.241],
  roof_metal: [0.151, 0.183, 0.181], roof_bitumen: [0.044, 0.038, 0.035], roof_shingle: [0.5, 0.5, 0.5],
  sidewalk: [0.284, 0.247, 0.174], asphalt: [0.108, 0.107, 0.094], asphalt_dark: [0.053, 0.053, 0.049], gravel: [0.142, 0.118, 0.091],
  mud: [0.126, 0.088, 0.046], moss: [0.098, 0.097, 0.013], rust: [0.424, 0.39, 0.374],
};

/** The most a tint lifts a layer by: a pale thing in a dark layer keeps the layer's detail, and no channel runs away. */
const GAIN_MAX = 10;

/** What a polygon with no surface and no material named for it is drawn in. */
export const FALLBACK: MatName = "painted";

/** How many polygons took `FALLBACK` because nothing named their material: a test holds it at zero for a whole town. */
export const unnamed = { polygons: 0 };

let current: MatRef | null = null;

/** The material the builders are working in, or null. */
export function currentMat(): MatRef | null {
  return current;
}

/** Runs `fn` with `mat` as the material of every polygon it lays that names none of its own, and puts back the one before. */
export function withMat<T>(mat: MatRef, fn: () => T): T {
  const before = current;
  current = mat;
  try {
    return fn();
  } finally {
    current = before;
  }
}

/** Whether what was given in a surface's place is a material's name or spec. */
export function isMat(s: Surface | MatRef | undefined): s is MatRef {
  return typeof s === "string" || (s !== undefined && (s as MatSpec).mat !== undefined);
}

/** Where a texture lies on a polygon that has no frame of its own: by its longest edge (`"long"`), or on the world's x and z where it is level, or along itself and up where it stands (`"up"` stands the picture on its side). */
function autoFrame(points: readonly V3[], n: V3, grain: "long" | "up" | undefined): { u: V3; v: V3 } {
  if (grain === "long") {
    // Along the longest edge, whichever way round its corners were listed: the edge's direction is turned to one sense, and of two edges of
    // one length the more upright wins, so the same polygon laid twice (two timbers that share a face) is laid the same.
    let best = -1;
    let u: V3 = [1, 0, 0];
    for (let i = 0; i < points.length; i++) {
      const a = points[i] as V3;
      const b = points[(i + 1) % points.length] as V3;
      let e: V3 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
      const l = e[0] * e[0] + e[1] * e[1] + e[2] * e[2];
      const big = Math.abs(e[1]) >= Math.abs(e[0]) && Math.abs(e[1]) >= Math.abs(e[2]) ? e[1] : Math.abs(e[0]) >= Math.abs(e[2]) ? e[0] : e[2];
      if (big < 0) e = [-e[0], -e[1], -e[2]];
      const tie = Math.abs(l - best) <= 1e-6 * Math.max(l, best);
      if ((!tie && l > best) || (tie && e[1] * e[1] * best > u[1] * u[1] * l + 1e-9)) {
        best = l;
        u = e;
      }
    }
    if (n[1] > 0.75 || n[1] < -0.75) {
      // A level face (a deck, a rail's top, a table): the grain runs the way of the edge, turned by quarter turns to the one of its four
      // ways nearest the world's x. Two decks of one grid that lie over each other at a corner, and two rails that cross there, are then laid
      // alike and show the same board at the same place, as boards cut to one plan do; a timber that runs the other way shows them across it.
      const turned: V3 = Math.abs(u[0]) >= Math.abs(u[2]) ? u : [u[2], u[1], -u[0]];
      const w: V3 = turned[0] < 0 ? [-turned[0], -turned[1], -turned[2]] : turned;
      return { u: [w[0], 0, w[2]], v: [-w[2], 0, w[0]] };
    }
    return { u, v: [n[1] * u[2] - n[2] * u[1], n[2] * u[0] - n[0] * u[2], n[0] * u[1] - n[1] * u[0]] };
  }
  if (n[1] > 0.75 || n[1] < -0.75) return { u: [1, 0, 0], v: [0, 0, 1] };
  // A standing face: along the world's axis it lies nearest, and up. Not the face's own tangent: two faces that stand in nearly one plane
  // (a drum's facet against the rim's, a link against the next) then show the same texel at the same place, and cannot flicker against each
  // other. A face askew of the axes is laid up to 1.4 times long along itself, which the materials' fine grain does not show.
  const t: V3 = Math.abs(n[0]) >= Math.abs(n[2]) ? [0, 0, 1] : [1, 0, 0];
  const up: V3 = [0, 1, 0];
  return grain === "up" ? { u: up, v: t } : { u: t, v: up };
}

/** The surface `like` (its layer, tint, wear and scale) on another polygon, which it has no frame for: a box's top and ends beside its face. */
export function surfaceOn(like: Surface, points: readonly V3[], n: V3): Surface {
  return { ...like, frame: { origin: [0, 0, 0], ...autoFrame(points, n, undefined) } };
}

/**
 * The surface of a polygon of the material `ref`: `points` its corners, `n` its unit normal, `colour` its one colour (null for a polygon
 * coloured by the corner: the tint is then the gain alone, and each corner's colour multiplies it).
 */
export function matSurface(ref: MatRef, points: readonly V3[], n: V3, colour: V3 | null): Surface {
  const spec: MatSpec = typeof ref === "string" ? { mat: ref } : ref;
  const m = MATS[spec.mat];
  const layer = TOWN_LAYERS[layerIndex(m.layer)];
  const { u, v } = autoFrame(points, n, m.grain);
  const paintable = layer?.paintable === true;
  const mean = MEAN[m.layer];
  const dust = colour === null ? 0 : (m.dust ?? 0);
  const c: V3 = colour === null ? [1, 1, 1] : [colour[0] + (0.5 - colour[0]) * dust, colour[1] + (0.5 - colour[1]) * dust, colour[2] + (0.5 - colour[2]) * dust];
  const gain = (k: 0 | 1 | 2): number => Math.min(GAIN_MAX, c[k] / Math.max(0.01, mean[k]));
  const wear = spec.wear ?? m.wear;
  const wearKind = spec.wearKind ?? m.wearKind;
  const streaks = spec.streaks ?? m.streaks;
  const scale = spec.scale ?? m.scale;
  return {
    layer: m.layer,
    frame: { origin: [0, 0, 0], u, v },
    ...(paintable ? (dust > 0 ? { tint: c } : {}) : { tint: [gain(0), gain(1), gain(2)] as V3 }),
    ...(scale === undefined ? {} : { scale }),
    ...(wear === undefined ? {} : { wear }),
    ...(wearKind === undefined ? {} : { wearKind }),
    ...(streaks === undefined ? {} : { streaks }),
  };
}

/** A material as a smooth grid takes it (`MeshBuilder.grid`): its layer, the tint of a corner of colour `c`, the metres a tile spans at its scale, and its wear. */
export function matLook(ref: MatRef): { readonly layer: LayerName; readonly tint: (c: V3) => V3; readonly tile: readonly [number, number]; readonly wear: number; readonly wearKind: WearKind } {
  const spec: MatSpec = typeof ref === "string" ? { mat: ref } : ref;
  const m = MATS[spec.mat];
  const layer = TOWN_LAYERS[layerIndex(m.layer)];
  const paintable = layer?.paintable === true;
  const mean = MEAN[m.layer];
  const scale = spec.scale ?? m.scale ?? 1;
  const tile = layer?.tile ?? [1, 1];
  return {
    layer: m.layer,
    tint: (c) => (paintable ? c : [Math.min(GAIN_MAX, c[0] / Math.max(0.01, mean[0])), Math.min(GAIN_MAX, c[1] / Math.max(0.01, mean[1])), Math.min(GAIN_MAX, c[2] / Math.max(0.01, mean[2]))]),
    tile: [tile[0] / scale, tile[1] / scale],
    wear: spec.wear ?? m.wear ?? 0,
    wearKind: spec.wearKind ?? m.wearKind ?? "moss",
  };
}
