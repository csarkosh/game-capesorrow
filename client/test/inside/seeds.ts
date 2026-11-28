/**
 * The seeds the rooms' tests walk. A seed costs its town's plan (about a second), so the sweeps are sorted by what they check.
 *
 * - `GAME_SEEDS`: the one the tests share, two more whose towns differ, and the world the game opens on.
 * - `ALL_SEEDS`: those and 1 to 24. Only the cheap structural checks (`rooms.test.ts`: measures, the arrival and the door's zone free, every kind has a builder) run on all of them.
 * - `HEAVY_SEEDS`: the four game seeds and four that hold the extremes found over the 28: seed 20 (the narrowest tavern, 4.6 x 4.9 m), seed 7 (the shallowest cafe, 6.8 x 2.8 m), seed 8 (the one-storey motel,
 *   and the shallow hall, 9.7 m deep), seed 11 (the narrowest hotel, 9.6 x 5.1 m); seed 1 is also the shallow wide hotel (22.8 x 6.1 m). The long walks, the flood fills, and the mesh and bake checks run on these.
 */
export const GAME_SEEDS: readonly number[] = [20261121, 1, 6, 1175766972];
export const ALL_SEEDS: readonly number[] = [...GAME_SEEDS, ...Array.from({ length: 24 }, (_, i) => i + 1).filter((s) => !GAME_SEEDS.includes(s))];
export const HEAVY_SEEDS: readonly number[] = [...GAME_SEEDS, 20, 7, 8, 11];
