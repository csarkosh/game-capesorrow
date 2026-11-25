import { describe, expect, it } from "vitest";
import { RANK } from "../../src/game/town/groundSurfaces.js";
import { RANK_CODE, RANK_UNITS } from "../../src/game/town/townMaterial.js";
import { FLAT_AHEAD_SLOPE, FLAT_AHEAD_UNITS } from "../../src/game/town/townParts.js";

/**
 * Which way the flat ground is moved in depth. The renderer's depth buffer runs from 1 at the near plane to 0 far away (reverse-Z), so a
 * surface is brought toward the eye by ADDING to its clip depth. The flat layer must come toward the eye over the terrain it lies on, and a
 * mark of a higher rank toward the eye over the surface it is laid on.
 *
 * Both once had the other sign. Close by nothing showed it, since every surface is also lifted a few millimetres; but the offset grows
 * with distance and the lift does not, so from a few metres away the terrain was drawn over every surface with no cut under it (a yard's
 * drive and walk, the patches of a yard) and a base surface over the marks laid on it (cracks, patches, lids, paint): they were seen
 * only from right beside them.
 */
describe("the flat ground's depth lead", () => {
  it("brings the flat layer toward the eye: both of its offsets are positive", () => {
    expect(FLAT_AHEAD_UNITS).toBeGreaterThan(0);
    expect(FLAT_AHEAD_SLOPE).toBeGreaterThan(0);
  });

  it("brings a higher rank toward the eye: the rank's line adds a positive share of the rank to the clip depth", () => {
    const m = /^out\.clipPos\.z\+=([-+0-9.e]+)\*\w+\.w\*out\.clipPos\.w;$/.exec(RANK_CODE);
    expect(m, RANK_CODE).not.toBeNull();
    const perRank = Number((m as RegExpExecArray)[1]);
    expect(perRank).toBeCloseTo(RANK_UNITS / 2 ** 24, 12);
    expect(perRank).toBeGreaterThan(0);
    // So the paint is nearer than a crack, a crack than a slab, and the gravel tucked under a slab is further.
    expect(RANK.paint * perRank).toBeGreaterThan(RANK.crack * perRank);
    expect(RANK.mark * perRank).toBeGreaterThan(RANK.base * perRank);
    expect(RANK.under * perRank).toBeLessThan(RANK.base * perRank);
  });
});
