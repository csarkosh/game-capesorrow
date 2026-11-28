import { describe, expect, it } from "vitest";
import { timeLimit } from "@csarkosh/engine/testing/timeLimit";
import { insideRooms } from "../../src/sim/inside/rooms.js";
import { HEAVY_SEEDS } from "./seeds.js";

/** Words that would name a real brand or the player's employer. */
const BANNED = /\b(hilton|marriott|hyatt|holiday|sheraton|ritz|westin|motel 6|super 8|best western|fbi|agent|bureau|federal)\b/i;

describe("the stairs that are shut", () => {
  it("are closed by real mass at the foot: a solid across the whole width of the flight within 0.5 m of its foot and 1.9 m high, at least eight things round it, the flight drawn on for 2 m beyond it, and no word of a real brand", () => {
    let closures = 0;
    for (const seed of HEAVY_SEEDS) {
      for (const room of insideRooms(seed)) {
        const d = room.design;
        const mark = (d.marks ?? []).find((m) => m.name === "flight" || m.name === "stair3");
        if (mark === undefined) continue;
        // The shut flight: the stair the walking surface does not have (drawn, never walked) that is nearest the mark.
        const flights = d.stairs.filter((st) => !d.surfaces.some((sf) => sf.kind === "ramp" && sf.s0 === st.s0 && sf.s1 === st.s1 && sf.d0 === st.d0 && sf.d1 === st.d1));
        let best: (typeof flights)[number] | null = null;
        let bestDist = Infinity;
        for (const st of flights) {
          const dist = Math.hypot((st.s0 + st.s1) / 2 - mark.s, (st.d0 + st.d1) / 2 - mark.d) + Math.abs(Math.max(st.y0, st.y1) - mark.y - 3.2);
          if (dist < bestDist && Math.max(st.y0, st.y1) > mark.y + 2) {
            best = st;
            bestDist = dist;
          }
        }
        expect(best, `seed ${seed} ${room.name}: a shut flight near ${mark.name}`).not.toBeNull();
        const st = best as NonNullable<typeof best>;
        const along = st.along === "s";
        const low = st.y0 < st.y1 ? st.y0 : st.y1;
        // The foot is the low end.
        const foot = along ? (st.y0 < st.y1 ? st.s0 : st.s1) : st.y0 < st.y1 ? st.d0 : st.d1;
        const width = along ? st.d1 - st.d0 : st.s1 - st.s0;
        const run = along ? st.s1 - st.s0 : st.d1 - st.d0;
        const label = `seed ${seed} ${room.name}`;
        // A solid across the whole width at the foot.
        const solid = d.blocks.find((b) => {
          const lenAlong = Math.abs(b.ax) > 0.5 === along ? b.ha : b.hb;
          const lenAcross = Math.abs(b.ax) > 0.5 === along ? b.hb : b.ha;
          void lenAlong;
          const centre = along ? b.s : b.d;
          const half = along ? Math.abs(b.ax) * b.ha + Math.abs(b.ad) * b.hb : Math.abs(b.ad) * b.ha + Math.abs(b.ax) * b.hb;
          const across = along ? Math.abs(b.ad) * b.ha + Math.abs(b.ax) * b.hb : Math.abs(b.ax) * b.ha + Math.abs(b.ad) * b.hb;
          void lenAcross;
          return Math.abs(centre - foot) <= 0.5 + half && across * 2 >= width - 0.15 && b.y1 - b.y0 >= 1.9 && b.y0 <= low + 0.1 && b.y1 >= low + 1.9 - 0.1;
        });
        expect(solid, `${label}: a block at the foot of the flight`).toBeDefined();
        expect(run, `${label}: the flight goes on for ${run.toFixed(1)} m`).toBeGreaterThanOrEqual(2.5);
        // Round it: items and hangings within 4 m of the foot.
        const near = (s: number, dd: number): boolean => Math.hypot(s - (along ? foot : (st.s0 + st.s1) / 2), dd - (along ? (st.d0 + st.d1) / 2 : foot)) < 4;
        const things = d.items.filter((it) => near(it.s, it.d)).length + d.decor.filter((dc) => near(dc.s, dc.d)).length;
        expect(things, `${label}: things in the closure`).toBeGreaterThanOrEqual(8);
        for (const dc of d.decor) expect(dc.text ?? "", `${label}: ${dc.text}`).not.toMatch(BANNED);
        closures++;
      }
    }
    console.log(`[closure] ${closures} closed stairs checked`);
    expect(closures).toBeGreaterThanOrEqual(4);
  }, timeLimit(300_000));
});
