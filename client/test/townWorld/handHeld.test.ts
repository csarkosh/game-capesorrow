// What a body holds in its right hand: a cup for a cup (and for a drink only where a paper cup is served), a phone for a phone, a call and a
// phone on a bench, and nothing for every other clip.
import { describe, expect, it } from "vitest";
import { PAPER_CUP_TRADES, heldBy } from "../../src/game/town/handHeld.js";
import { ACTIVITIES } from "../../src/game/town/people.js";

describe("what a body holds", () => {
  it("holds a cup for the cup clip, wherever", () => {
    expect(heldBy("cup", null)).toBe("cup");
    expect(heldBy("cup", "tavern")).toBe("cup");
  });

  it("holds a cup for a drink only in a room that serves paper cups; a tavern, a bar or a restaurant's drink is no paper cup", () => {
    for (const t of ["cafe", "bakery", "diner", "espresso stand", "convenience store"] as const) expect(heldBy("drink", t), t).toBe("cup");
    expect(PAPER_CUP_TRADES).toHaveLength(5);
    for (const t of ["tavern", "restaurant", "pizza and burgers", "grocery", "hotel"] as const) expect(heldBy("drink", t), t).toBe(null);
    expect(heldBy("drink", null)).toBe(null);
  });

  it("holds a phone for phone, call and sit_phone, anywhere", () => {
    for (const a of ["phone", "call", "sit_phone"] as const) {
      expect(heldBy(a, null), a).toBe("phone");
      expect(heldBy(a, "tavern"), a).toBe("phone");
      expect(heldBy(a, "cafe"), a).toBe("phone");
    }
  });

  it("holds nothing in every other clip", () => {
    const held = ["cup", "drink", "phone", "call", "sit_phone"];
    for (const a of ACTIVITIES) if (!held.includes(a)) expect(heldBy(a, "cafe"), a).toBe(null);
  });
});
