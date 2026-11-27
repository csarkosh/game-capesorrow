/**
 * Paint on a standing face: a band of grime, a streak under a sill, a patch of repaint, a painted sign, a mark on a foundation, a stain on a roof. It is
 * not a board and it has no thickness, so it lies flush on what it is painted on (a few millimetres a rank, no more than the depth buffer can hold
 * apart at close range) and does not stand off it, where the line the depth steps draw would outline it as if it were a board fixed to the wall.
 *
 * What holds paint apart from the face it lies on, and from the paint under it, is a depth rank, as it is for marks on the flat ground
 * (`RANK_UNITS` in `townMaterial.ts`): a painted vertex carries its rank in the alpha of its colour (the town never reads a vertex's alpha, as
 * it opts in to none), 1 for everything that is not paint and `1 - rank / PAINT_RANKS` for paint, and the vertex stage draws it that many steps
 * ahead (`PAINT_UNITS`). No two sheets of one rank overlap (the builders cut or order them), and no face of the ledger (`faceLedger.ts`) counts a sheet.
 */

/** The ranks of paint on one face, counting rank 0, which is everything that is not paint: a rank is 1 to `PAINT_RANKS - 1`. */
export const PAINT_RANKS = 16;
/** How far out a sheet of paint lies for each rank, metres: two millimetres, so a sheet is also in front of what it lies on in space, and no line can be drawn for it beyond half a metre. */
export const PAINT_STEP = 0.002;

/** The alpha a vertex of paint rank `rank` carries: 1 for rank 0 (no paint), and less for each rank above it. */
export function paintAlpha(rank: number): number {
  return 1 - Math.min(PAINT_RANKS - 1, Math.max(0, Math.round(rank))) / PAINT_RANKS;
}

/** The paint rank an alpha stands for (0 when it is 1). */
export function paintRank(alpha: number): number {
  return Math.round((1 - alpha) * PAINT_RANKS);
}

/** How far out a sheet of paint of `rank` lies from the face it is painted on, metres. */
export const paintOff = (rank: number): number => PAINT_STEP * rank;

/**
 * The alpha a vertex of a door's leaf carries (`MeshBuilder.withLeaf`): under every paint rank's (the least is 1/16), so the vertex stage (`townMaterial.ts`) knows it
 * turns with the door that stands where it does. The paint's depth step it would get is taken back there.
 */
export const DOOR_ALPHA = 0.02;
