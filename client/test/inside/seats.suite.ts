import { describe, expect, it } from "vitest";
import { timeLimit } from "@csarkosh/engine/testing/timeLimit";
import { SEAT_BEHIND, SEAT_FRONT, blocksOverlap, type Block, type Item } from "../../src/sim/inside/design.js";
import { underside } from "../../src/game/town/designGeometry.js";
import { ITEM_FOOT } from "../../src/sim/inside/kinds.js";
import { insideRooms } from "../../src/sim/inside/rooms.js";
import { standsAt } from "./designHelpers.js";
import { HEAVY_SEEDS } from "./seeds.js";

/** The height of the top of each seat as its builder draws it (`furniture/`): what a sitting clip's hips are raised to (`CHAIR_CLIP_SEAT` 0.46, `STOOL_CLIP_SEAT` 0.75). */
const SEAT_TOP: Readonly<Record<string, number>> = { chair: 0.46, round_chair: 0.46, shell_chair: 0.47, armchair: 0.45, sofa: 0.45, window_bench: 0.48, stool: 0.76, bistro_stool: 0.76 };

describe("the people of the rooms sit and stand where they can", () => {
  it("sit with their hips at the top of the seat they are on, and on a deep seat with the lower legs in open air", () => {
    let seated = 0;
    let deep = 0;
    for (const seed of HEAVY_SEEDS) {
      for (const room of insideRooms(seed)) {
        const d = room.design;
        for (const p of d.people) {
          if (p.sits === null) continue;
          // The seat: the nearest seat item whose footprint has the person on it.
          let seat: { it: Item; f: number; r: number; hb: number } | null = null;
          let bestScore = Infinity;
          for (const it of d.items) {
            if (SEAT_TOP[it.kind] === undefined || (it.y ?? 0) !== (p.y ?? 0)) continue;
            const dx = p.s - it.s;
            const dd = p.d - it.d;
            const f = dx * it.face.s + dd * it.face.d;
            const r = -dx * it.face.d + dd * it.face.s;
            const ext = it.kind === "sofa" || it.kind === "window_bench" ? (it.p[0] ?? 2) / 2 : 0.4;
            if (Math.abs(f) > 0.5 || Math.abs(r) > ext + 0.1) continue;
            if (Math.abs(f) + Math.abs(r) < bestScore) {
              bestScore = Math.abs(f) + Math.abs(r);
              seat = { it, f, r, hb: ext };
            }
          }
          if (seat === null) continue;
          seated++;
          const label = `seed ${seed} ${room.name}: a ${p.family} sitter at ${p.s}, ${p.d} on a ${seat.it.kind}`;
          expect(Math.abs(p.sits - (SEAT_TOP[seat.it.kind] as number)), `${label}: hips ${p.sits} over a seat top of ${SEAT_TOP[seat.it.kind]}`).toBeLessThanOrEqual(0.03);
          const front = SEAT_FRONT[seat.it.kind];
          if (front === undefined) continue;
          deep++;
          // The hips are 0.1 m behind the seat's front edge, facing out of it.
          expect(Math.abs(seat.f - (front - SEAT_BEHIND)), `${label}: hips at ${seat.f.toFixed(2)} from the middle, the front edge at ${front}`).toBeLessThanOrEqual(0.02);
          expect(p.face, label).toEqual(seat.it.face);
          // The lower legs and feet: from the seat's front edge forward 0.45 m, 0.4 m wide, from the floor to the seat's top: nothing solid there but the floor.
          const it = seat.it;
          const at = front + 0.225;
          const box: Block = { s: it.s + it.face.s * at - it.face.d * seat.r, d: it.d + it.face.d * at + it.face.s * seat.r, ax: it.face.s, ad: it.face.d, ha: 0.225, hb: 0.2, y0: (it.y ?? 0) + 0.02, y1: (it.y ?? 0) + (SEAT_TOP[it.kind] as number) };
          for (const b of d.blocks) if (b.y1 > box.y0 && b.y0 < box.y1) expect(blocksOverlap(b, box, 0), `${label}: a block at ${b.s}, ${b.d} (${b.y0} to ${b.y1}) is in the leg room`).toBe(false);
        }
      }
    }
    console.log(`[seats] ${seated} sitters on a known seat, ${deep} on a deep one`);
    expect(seated).toBeGreaterThan(10);
    expect(deep).toBeGreaterThan(3);
  }, timeLimit(300_000));

  it("stand with their feet on a floor a hull stands on, inside no furniture", () => {
    for (const seed of HEAVY_SEEDS) {
      for (const room of insideRooms(seed)) {
        for (const p of room.design.people) {
          if (p.sits !== null) continue;
          expect(standsAt(room.design, p.s, p.d, p.y ?? 0, 0.2), `seed ${seed} ${room.name}: a person at ${p.s}, ${p.d}, ${p.y ?? 0}`).not.toBeNull();
        }
      }
    }
  }, timeLimit(300_000));

  it("face their table: for every sitter with a table within 0.9 m, the way they face points within 60 degrees of the nearest of it, and no seat's back is to its table", () => {
    const TABLES = ["high_table", "low_table", "square_table", "oval_table", "long_table", "desk", "bar_counter", "cafe_counter", "pastry_case", "sideboard"];
    let checked = 0;
    for (const seed of HEAVY_SEEDS) {
      for (const room of insideRooms(seed)) {
        const d = room.design;
        for (const p of d.people) {
          if (p.sits === null) continue;
          // The nearest point of each table's footprint (an oriented rectangle) to the person.
          let best: { q: [number, number]; dist: number; kind: string } | null = null;
          for (const it of d.items) {
            if (!TABLES.includes(it.kind) || (it.y ?? 0) !== (p.y ?? 0)) continue;
            const foot = ITEM_FOOT[it.kind]?.(it.p);
            if (foot === null || foot === undefined) continue;
            const dx = p.s - it.s;
            const dd = p.d - it.d;
            const f = dx * it.face.s + dd * it.face.d;
            const r = -dx * it.face.d + dd * it.face.s;
            const cf = Math.max(-foot.ha, Math.min(foot.ha, f));
            const cr = Math.max(-foot.hb, Math.min(foot.hb, r));
            const dist = Math.hypot(f - cf, r - cr);
            if (dist > 0.9 || (best !== null && dist >= best.dist)) continue;
            best = { q: [it.s + it.face.s * cf - it.face.d * cr, it.d + it.face.d * cf + it.face.s * cr], dist, kind: it.kind };
          }
          if (best === null || best.dist < 0.02) continue;
          const vs = best.q[0] - p.s;
          const vd = best.q[1] - p.d;
          const len = Math.hypot(vs, vd);
          if (len < 0.05) continue;
          const cos = (vs * p.face.s + vd * p.face.d) / (len * Math.hypot(p.face.s, p.face.d));
          expect(cos, `seed ${seed} ${room.name}: a sitter at ${p.s}, ${p.d} facing ${p.face.s}, ${p.face.d} has a ${best.kind} at ${best.q[0].toFixed(2)}, ${best.q[1].toFixed(2)} (${best.dist.toFixed(2)} m)`).toBeGreaterThanOrEqual(0.5);
          checked++;
        }
      }
    }
    console.log(`[seats] ${checked} sitters with a table, each facing it`);
    expect(checked).toBeGreaterThan(20);
  }, timeLimit(300_000));

  it("have a stair that goes on up: along every flight, walked or shut, there is 1.6 m of headroom (a hull is 1.7 m and steps up its flight) under whatever is over it, so no flight ends against a lid", () => {
    let flights = 0;
    for (const seed of HEAVY_SEEDS) {
      for (const room of insideRooms(seed)) {
        const d = room.design;
        for (const st of d.stairs) {
          const along = st.along === "s";
          const run = along ? st.s1 - st.s0 : st.d1 - st.d0;
          // Heights over the floor of the flight's low end, to where it meets a floor at its head.
          for (let k = 0; k <= 20; k++) {
            const u = k / 20;
            const y = st.y0 + (st.y1 - st.y0) * u;
            const s = along ? st.s0 + run * u : (st.s0 + st.s1) / 2;
            const dd = along ? (st.d0 + st.d1) / 2 : st.d0 + run * u;
            const over = underside(d, s, dd, y) - y;
            // The very head, within a tread of the level it arrives at, may meet that level's own ceiling; before it there is headroom.
            if (u > 0.93) continue;
            expect(over, `seed ${seed} ${room.name}: a flight from ${st.y0} to ${st.y1} at ${(u * 100).toFixed(0)} percent has ${over.toFixed(2)} m over it`).toBeGreaterThanOrEqual(1.6);
          }
          flights++;
        }
      }
    }
    console.log(`[stairs] ${flights} flights with headroom`);
    expect(flights).toBeGreaterThan(8);
  }, timeLimit(300_000));
});
