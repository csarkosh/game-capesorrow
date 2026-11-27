// The street lights of the plan: one at every junction of the highway, an avenue or a main street, about half of the other street junctions', and along an
// avenue or main street no gap of much over 70 m; none on an alley's, a stair's or the rail's.
import "../../src/terrain.js";
import { describe, expect, it } from "vitest";
import { planFor } from "../../src/sim/town/planFor.js";

const SEEDS = [20261121, 1, 7];
const MAJOR = ["highway", "avenue", "main"];

describe("the street lights", () => {
  for (const seed of SEEDS) {
    it(`lights every major junction and half of the others, and leaves no long dark stretch of a main street, in world ${seed}`, () => {
      const plan = planFor(seed);
      const lamps = plan.props.poles.filter((p) => p.light !== null);
      const byKind: Record<string, [number, number]> = {};
      for (const p of plan.props.poles) {
        const k = (plan.streets[p.street] as { kind: string }).kind;
        const e = (byKind[k] ??= [0, 0]);
        e[0]++;
        if (p.light !== null) e[1]++;
      }
      let major = 0;
      let majorLit = 0;
      // A junction of the highway whose street runs through the railroad's clearance has no place for a pole within reach of its middle (nothing stands on the railroad): it is left dark, and only where a rail crossing lies within a lamp's reach of it.
      let darkByRail = 0;
      let minor = 0;
      let minorLit = 0;
      for (const j of plan.junctions) {
        if (j.legs.length < 3 || ["alley", "rail", "stair", "road end"].includes(j.kind)) continue;
        const isMajor = j.kind === "highway" || j.streets.some((sid) => MAJOR.includes((plan.streets[sid] as { kind: string }).kind));
        const lit = lamps.some((p) => Math.hypot(p.x - j.x, p.z - j.z) < 42);
        if (isMajor) {
          major++;
          if (lit) majorLit++;
          else if (j.kind === "highway" && plan.junctions.some((k) => k.kind === "rail" && Math.hypot(k.x - j.x, k.z - j.z) < 42)) darkByRail++;
        } else {
          minor++;
          if (lit) minorLit++;
        }
      }
      process.stderr.write(`world ${seed}: ${plan.props.poles.length} poles, ${lamps.length} with a light; by street kind (poles, lit) ${JSON.stringify(byKind)}; major junctions lit ${majorLit}/${major}, others ${minorLit}/${minor}\n`);
      expect(majorLit + darkByRail).toBe(major);
      expect(darkByRail).toBeLessThanOrEqual(1);
      expect(minorLit / minor).toBeGreaterThan(0.3);
      expect(minorLit / minor).toBeLessThan(0.8);
      // Along an avenue or a main street: the lights that serve it (within a verge of its line), its ends counted, are never far apart.
      for (const st of plan.streets) {
        if (st.kind !== "main" && st.kind !== "avenue") continue;
        const tx = st.b.x - st.a.x;
        const tz = st.b.z - st.a.z;
        const len = Math.hypot(tx, tz);
        const marks = [0, len];
        for (const p of lamps) {
          const s = ((p.x - st.a.x) * tx + (p.z - st.a.z) * tz) / len;
          const lat = Math.abs(((p.x - st.a.x) * -tz + (p.z - st.a.z) * tx) / len);
          if (lat < 14 && s > -14 && s < len + 14) marks.push(s);
        }
        marks.sort((a, b) => a - b);
        let gap = 0;
        for (let i = 1; i < marks.length; i++) gap = Math.max(gap, (marks[i] as number) - (marks[i - 1] as number));
        expect(gap, `${st.kind} ${st.name}`).toBeLessThan(85);
      }
      // No pole of an alley, a stair or the rail has a light.
      for (const p of plan.props.poles) if (p.light !== null) expect(["alley", "stair", "rail"]).not.toContain((plan.streets[p.street] as { kind: string }).kind);
    });
  }
});
