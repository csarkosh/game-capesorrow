/**
 * What a district's lots look like in the large port: how they are cut. The widths are real ones
 * from the research (commercial lots 7.5 to 15 m, house lots 15 m wide), the rest authored.
 */
import type { LotRule } from "../lots.js";
import type { District } from "../types.js";

/** Commercial lot widths: 25, 30, 40 and 50 ft, the last held to 15 m. */
const SHOP = [7.62, 9.14, 9.14, 12.19, 15] as const;

export const LOT_RULES: Record<District, LotRule> = {
  core: { rows: 2, widths: SHOP, alley: true },
  dock: { rows: 2, widths: [7.62, 9.14, 12.19], alley: true },
  waterfront: { rows: 1, widths: [18, 24, 30, 45], alley: false, face: "hi" },
  mill: { rows: 2, widths: [45, 60, 75], alley: false },
  "mill housing": { rows: 2, widths: [12.19, 15, 15], alley: true },
  residential: { rows: 2, widths: [15, 15, 15, 18], alley: true },
  "highway strip": { rows: 2, widths: [30, 40, 60], alley: false },
  civic: { rows: 0, widths: [60], alley: false },
  industrial: { rows: 2, widths: [30, 45, 60], alley: false },
};
