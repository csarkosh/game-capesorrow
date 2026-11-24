/**
 * What a polygon can be given beside its colour: a surface, which is a texture layer (`townLayers.ts`), a frame that says
 * where on the polygon's plane the texture lies and at what scale, and how worn it is. Pure data and functions, no
 * renderer: `MeshBuilder.poly` turns a surface into the per-vertex UV and surface data the renderer's plugin reads
 * (`townMaterial.ts` says how that data is packed).
 *
 * - **The frame is in metres.** An origin and two axes on the polygon's plane; a vertex's UV is its offset from the origin
 *   along each axis divided by the layer's tile size across and up (the manifest's `tile`), so a texture is at true scale
 *   whatever the polygon. Axes are directions (they are made unit length here), and need not be at right angles to each
 *   other, nor to the plane's own axes: swapping them turns a texture on its side (vertical boards), negating one
 *   mirrors it. The picture's "up" is +v.
 * - **The polygon's colour stays what it is: the flat colour it is drawn in** where there is no texture, and until the
 *   textures land. Once they have, the texture is multiplied by the surface's `tint`: by default the polygon's colour for a
 *   paintable layer (`TownLayer.paintable`: the paint is the colour the building has always had), and white for any other
 *   (a brick wall is its own colour); a builder gives a shade near white for variation.
 * - **Wear** is how much of the surface the weathering overlay takes, 0 to 1 (a number, or a function of a vertex's
 *   position, so a wall can wear more at its foot than at its eave), and what kind: moss and grime, or rust. The shader
 *   breaks the amount into patches with world-space noise; it is a share of the surface, never a gradient.
 */
import { TOWN_LAYERS, layerIndex, type LayerName } from "./townLayers.js";
import type { Rgb, Vec3 } from "./meshBuilder.js";

/**
 * What a worn patch is: moss and grime, rust, peeling paint over bare boards, a green algae film, or dirt (splash at a wall's foot,
 * streaks under a sill). The kind picks the overlay layer and its colour grade in the material (`townMaterial.ts`).
 */
export type WearKind = "moss" | "rust" | "peel" | "algae" | "grime" | "oil" | "growth" | "leaf" | "damp";
/** The kinds' numbers in a vertex (a streak adds one half). */
export const WEAR_KIND_NUMBER: Readonly<Record<WearKind, number>> = { moss: 0, rust: 1, peel: 2, algae: 3, grime: 4, oil: 5, growth: 6, leaf: 7, damp: 8 };

/**
 * Beside a polygon's colour: how much of it the renderer lights from itself (a lit sign, a room's light), and how see-through it is.
 * A pane of glass (`clear` over 0) also carries what its own look needs, which the blended glass layer reads from the vertex: `tilt`
 * (the small fixed turn of its reflecting normal, along the pane and up it, radians), `dirt` (how much grime it has, 0 to 1), `seed` (a
 * number 0 to 1 of its own, for the noise in its dirt), `size` (the pane's height and width in metres) and `uvs` (a corner's place in the
 * pane, 0 to 1, in the corners' order).
 */
export type Fx = {
  /** 0 is lit by the scene, 1 and more is lit by itself (its colour times this is added; 1 replaces the scene's light). */ readonly glow?: number;
  /** 0 opaque, 1 invisible; for the blended layers. */ readonly clear?: number;
  readonly tilt?: readonly [number, number];
  readonly dirt?: number;
  readonly seed?: number;
  readonly size?: readonly [number, number];
  readonly uvs?: readonly (readonly [number, number])[];
  /** For the flat ground: the depth rank, 0 for a base surface and more for what lies on one (`townMaterial.ts`, `RANK_UNITS`). Rides in the float a tilt's second number uses, which flat ground has no use for. */ readonly rank?: number;
  /** The normal the renderer lights the polygon by (a unit vector), where it is not the polygon's own: a blade of grass is a thin upright triangle lit as if it faced up and out, so the sky lights it. */
  readonly normal?: readonly [number, number, number];
  /**
   * Also lay the polygon's back: the same corners wound the other way, facing the other way (the town's materials cull back faces, so
   * a single sheet is not there from behind). `true` gives a plain back (the colour darker and greyer, no texture, no glow); an object
   * gives it a look of its own (a sign's back is bare board, an awning's underside dirty cloth). Lettering never shows on a back.
   */
  readonly back?: true | { readonly colour?: readonly [number, number, number]; readonly surface?: Surface };
};

/** Where a texture lies on a polygon: a point of its plane, and the directions of the texture's across (u) and up (v). */
export type UvFrame = { readonly origin: Vec3; readonly u: Vec3; readonly v: Vec3 };

export type Surface = {
  readonly layer: LayerName;
  readonly frame: UvFrame;
  /** What the texture is multiplied by: the polygon's colour (paintable layers) or white (the rest) when absent. */
  readonly tint?: Rgb;
  /** How much of the surface is worn, 0 to 1; or the same at a vertex's position. None when absent. */
  readonly wear?: number | ((p: Vec3) => number);
  /** Moss and grime (the default), or rust. */
  readonly wearKind?: WearKind;
  /** The wear is drawn in streaks that run down the surface rather than in patches. */
  readonly streaks?: boolean;
  /** A second wear on the same surface, laid over the first (algae low and rust under a bracket, say). */
  readonly wear2?: number | ((p: Vec3) => number);
  readonly wearKind2?: WearKind;
  readonly streaks2?: boolean;
};

/** A direction made unit length (a direction of no length is left as it is). */
function unit(a: Vec3): Vec3 {
  const l = Math.sqrt(a[0] * a[0] + a[1] * a[1] + a[2] * a[2]);
  return l > 1e-12 ? [a[0] / l, a[1] / l, a[2] / l] : a;
}

/** A surface's frame ready to be applied: unit axes, and the metres a texture spans, so a UV is a dot product and a divide. */
/** The tint a surface multiplies its texture by, given the polygon's own colour. */
export function tintOf(surface: Surface, colour: Rgb): Rgb {
  if (surface.tint !== undefined) return surface.tint;
  return TOWN_LAYERS[layerIndex(surface.layer)]?.paintable === true ? colour : [1, 1, 1];
}

export type FrameBasis = { readonly origin: Vec3; readonly u: Vec3; readonly v: Vec3; readonly su: number; readonly sv: number };

export function basisOf(surface: Surface): FrameBasis {
  const layer = TOWN_LAYERS[layerIndex(surface.layer)];
  if (layer === undefined) throw new Error(`no texture layer "${surface.layer}"`);
  return { origin: surface.frame.origin, u: unit(surface.frame.u), v: unit(surface.frame.v), su: 1 / layer.tile[0], sv: 1 / layer.tile[1] };
}

/** The UV of the point `p` of a polygon under `basis`. */
export function uvAt(basis: FrameBasis, p: Vec3): [number, number] {
  const dx = p[0] - basis.origin[0];
  const dy = p[1] - basis.origin[1];
  const dz = p[2] - basis.origin[2];
  return [(dx * basis.u[0] + dy * basis.u[1] + dz * basis.u[2]) * basis.su, (dx * basis.v[0] + dy * basis.v[1] + dz * basis.v[2]) * basis.sv];
}

/**
 * The frame of a vertical wall: its texture runs along the wall from `a` (world x and z) in the direction (tx, tz), a unit
 * horizontal vector, with `along` metres of wall already behind `a` (so courses meet at a corner a wall's neighbour left
 * off), and up from `baseY`. `turned` lays the texture on its side: its u runs up and its v along, for boards that stand.
 */
export function wallFrame(ax: number, az: number, tx: number, tz: number, baseY: number, along = 0, turned = false): UvFrame {
  const origin: Vec3 = [ax - tx * along, baseY, az - tz * along];
  const across: Vec3 = [tx, 0, tz];
  const up: Vec3 = [0, 1, 0];
  return turned ? { origin, u: up, v: across } : { origin, u: across, v: up };
}

/**
 * The frame of a sloping or any flat piece that has an edge it runs along: u along the edge from `a` to `b`, v the
 * direction up the plane from the edge toward `toward` (a point of the plane off the edge). A roof's courses and ribs run
 * along its eave and down its slope: its eave is the edge and its ridge `toward`.
 */
export function edgeFrame(a: Vec3, b: Vec3, toward: Vec3): UvFrame {
  const u = unit([b[0] - a[0], b[1] - a[1], b[2] - a[2]]);
  const rx = toward[0] - a[0];
  const ry = toward[1] - a[1];
  const rz = toward[2] - a[2];
  const d = rx * u[0] + ry * u[1] + rz * u[2];
  return { origin: a, u, v: unit([rx - u[0] * d, ry - u[1] * d, rz - u[2] * d]) };
}

/**
 * The frame of ground: u along the world's x, v along its z, from `anchor` (the town's: any fixed point would do, and a
 * near one keeps the numbers small). Every piece of ground in a layer takes the same frame, so neighbours meet with no seam.
 */
export function groundFrame(anchor: { readonly x: number; readonly z: number }): UvFrame {
  return { origin: [anchor.x, 0, anchor.z], u: [1, 0, 0], v: [0, 0, 1] };
}

/** A ground surface: the layer on the world's x and z, worn by `wear` of `wearKind` where it is. */
export function groundSurface(layer: LayerName, anchor: { readonly x: number; readonly z: number }, wear?: number, wearKind?: WearKind): Surface {
  return { layer, frame: groundFrame(anchor), ...(wear === undefined ? {} : { wear }), ...(wearKind === undefined ? {} : { wearKind }) };
}
