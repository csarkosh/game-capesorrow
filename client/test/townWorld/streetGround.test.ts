import { describe, expect, it } from "vitest";
import { PLAYER_HALF } from "@csarkosh/engine/sim/constants";
import { SURFACE_FLOATS, type MeshArrays } from "../../src/game/town/meshBuilder.js";
import { SPACINGS, WALK_TOP, HEAVE_MAX, stations } from "../../src/game/town/walkGeometry.js";
import { townGeometry, townGround } from "../../src/game/town/townGeometry.js";
import { rampsOf } from "../../src/sim/town/junctionShape.js";
import { CROSSWALK_WIDTH, UNMARKED_CROSSWALK, hasPavement } from "../../src/sim/town/junctions.js";
import { walkAt } from "../../src/sim/town/port/edges.js";
import { CURB_OUT, WALK_FADE, streetLiftD, streetLowerD } from "../../src/sim/town/streetField.js";
import { pavedGround } from "../../src/sim/town/pavedGround.js";
import { WORLD_SEEDS, groundOf, planFor, siteFor, worldFor } from "./world.js";
import { contains, segDist } from "../../src/sim/town/geom.js";
import type { StreetEdge } from "../../src/sim/town/types.js";

const SEEDS = [...WORLD_SEEDS, 7, 12];

function batchesOf(seed: number): { arrays: MeshArrays; layer: string }[] {
  const it = townGeometry(townGround(seed), "full", { x: 0, z: 0 });
  let r = it.next();
  while (!r.done) r = it.next();
  return r.value;
}

/** The highest drawn flat surface over (x, z): a triangle of the flat layer that faces up and holds the point. */
function drawnTop(batches: readonly { arrays: MeshArrays; layer: string }[], x: number, z: number, cap = Infinity): number | null {
  let best: number | null = null;
  for (const b of batches) {
    if (b.layer !== "flat") continue;
    const a = b.arrays;
    for (let t = 0; t < a.indices.length; t += 3) {
      const i = [a.indices[t] as number, a.indices[t + 1] as number, a.indices[t + 2] as number];
      if ((a.normals[i[0]! * 3 + 1] as number) < 0.7) continue;
      const p = i.map((k) => [a.positions[k * 3] as number, a.positions[k * 3 + 1] as number, a.positions[k * 3 + 2] as number]);
      const d = (p[1]![2]! - p[2]![2]!) * (p[0]![0]! - p[2]![0]!) + (p[2]![0]! - p[1]![0]!) * (p[0]![2]! - p[2]![2]!);
      if (Math.abs(d) < 1e-12) continue;
      const l0 = ((p[1]![2]! - p[2]![2]!) * (x - p[2]![0]!) + (p[2]![0]! - p[1]![0]!) * (z - p[2]![2]!)) / d;
      const l1 = ((p[2]![2]! - p[0]![2]!) * (x - p[2]![0]!) + (p[0]![0]! - p[2]![0]!) * (z - p[2]![2]!)) / d;
      const l2 = 1 - l0 - l1;
      if (l0 < 0 || l1 < 0 || l2 < 0) continue;
      const y = l0 * p[0]![1]! + l1 * p[1]![1]! + l2 * p[2]![1]!;
      if (y <= cap && (best === null || y > best)) best = y;
    }
  }
  return best;
}

/** Whether a junction (or an alley's mouth) is within `r` metres of a point of the plan's frame: its pavement, aprons and ramps are not the street's plain section. */
const nearJunction = (plan: ReturnType<typeof planFor>, x: number, z: number, r: number): boolean => plan.junctions.some((j) => Math.hypot(j.x - x, j.z - z) < r);

describe("the ground under the streets (the roadway lies a curb's height under the lots)", () => {
  it("cuts the roadway down by the street's own curb height and leaves the sidewalk and the lots at the lots' level, across a street", () => {
    let checked = 0;
    for (const seed of SEEDS) {
      const plan = planFor(seed);
      const { anchor } = siteFor(seed);
      for (const st of plan.streets) {
        const e = plan.edges[st.id] as StreetEdge;
        if ((st.kind !== "street" && st.kind !== "main" && st.kind !== "avenue") || !e.sides.every((s) => s.curb)) continue;
        const len = Math.hypot(st.b.x - st.a.x, st.b.z - st.a.z);
        if (len < 40) continue;
        const tx = (st.b.x - st.a.x) / len;
        const tz = (st.b.z - st.a.z) / len;
        const s = len * 0.5;
        if (nearJunction(plan, st.a.x + tx * s, st.a.z + tz * s, 30)) continue;
        const cw = st.roadway / 2;
        const at = (t: number): [number, number] => [anchor.x + st.a.x + tx * s - tz * t, anchor.z + st.a.z + tz * s + tx * t];
        const curb = e.paving.find((p) => s < p.s1)!.curb;
        const [rx, rz] = at(0);
        const [bx, bz] = at(cw + 0.8);
        // Mid-street: lowered by the curb height (the roadway's own cross-fall is the ground's). Past the curb, not at all.
        const lo = streetLowerD(seed, rx, rz).v;
        expect(Math.abs(lo - curb), `seed ${seed} street ${st.id}`).toBeLessThan(0.02);
        // (Unless another street's roadway is near enough to reach it.)
        const others = plan.streets.some((o) => o.id !== st.id && o.kind !== "highway" && o.kind !== "wharf" && o.kind !== "rail" && o.kind !== "stair" && segDist({ x: bx - anchor.x, z: bz }, o.a, o.b) < o.width / 2 + 4);
        if (!others) expect(streetLowerD(seed, bx, bz).v, `seed ${seed} street ${st.id} s ${s.toFixed(1)} of ${len.toFixed(0)} cw ${cw}`).toBe(0);
        // The trough under the roadway is as deep as it is cut, and is gone beyond the right of way (the sidewalk's own trough fades out within 0.6 m past it).
        expect(streetLiftD(seed, rx, rz).v).toBeGreaterThan(0.19);
        // (Beside a paved district's block or a lone business's apron the terrain is cut out of sight too, by `HIDDEN_PAVED`: `pavedGround.ts`.)
        const [lx, lz] = at(st.width / 2 + 0.8);
        const beside = pavedGround(plan).some((q) => contains(q.polygon, { x: lx - anchor.x, z: lz - anchor.z }, WALK_FADE + 0.1));
        if (!beside) expect(streetLiftD(seed, lx, lz).v, `seed ${seed} street ${st.id}`).toBe(0);
        checked++;
        if (checked > 400) return;
      }
    }
    expect(checked).toBeGreaterThan(5);
  });

  it("stands the walker on the surface that is drawn: the roadway, the sidewalk beyond the curb and the lot behind it, to a couple of centimetres, and a step down at the curb", () => {
    const rows: string[] = [];
    for (const seed of WORLD_SEEDS) {
      const plan = planFor(seed);
      const { anchor } = siteFor(seed);
      const field = groundOf(worldFor(seed));
      const batches = batchesOf(seed);
      let roadway = 0;
      let walk = 0;
      let worstRoad = 0;
      let worstWalk = 0;
      let steps = 0;
      for (const st of plan.streets) {
        const e = plan.edges[st.id] as StreetEdge;
        if (st.kind !== "street" && st.kind !== "main" && st.kind !== "avenue") continue;
        const len = Math.hypot(st.b.x - st.a.x, st.b.z - st.a.z);
        const tx = (st.b.x - st.a.x) / len;
        const tz = (st.b.z - st.a.z) / len;
        const cw = st.roadway / 2;
        for (const f of [0.3, 0.55, 0.8]) {
          const s = len * f;
          // Where nothing else is cut in: a junction's pavement, a ramp or an alley's apron changes the street's plain section.
          if (nearJunction(plan, st.a.x + tx * s, st.a.z + tz * s, 24)) continue;
          const at = (t: number): [number, number] => [anchor.x + st.a.x + tx * s - tz * t, anchor.z + st.a.z + tz * s + tx * t];
          // The roadway, in the middle and near its edge.
          for (const t of [0, cw - 0.4, -(cw - 0.4)]) {
            const [x, z] = at(t);
            const top = drawnTop(batches, x, z);
            if (top === null) continue;
            roadway++;
            worstRoad = Math.max(worstRoad, Math.abs(top - field.heightAt(x, z)));
          }
          // The sidewalk, where there is one: its middle.
          for (const k of [0, 1] as const) {
            const side = e.sides[k];
            const run = walkAt(side, s);
            if (run === null || side.walk === 0) continue;
            const sg = k === 0 ? 1 : -1;
            const [x, z] = at(sg * (st.width / 2 - st.walk / 2));
            // A slab is a plane between its four corners: across 3 m of ground that falls more than 6 percent it stands off the ground's curve in the middle (the slab's corners are on it).
            const across = Math.abs(field.heightAt(...at(sg * (st.width / 2 - st.walk))) - field.heightAt(...at(sg * (st.width / 2)))) / st.walk;
            if (across > 0.06) continue;
            // (Not what a yard lays across it: a drive's gravel or a front walk lies 4 cm over the lot's ground, from the lot line in.)
            const top = drawnTop(batches, x, z, field.heightAt(x, z) + 0.036);
            if (top === null) continue;
            walk++;
            // The top is the ground plus WALK_TOP and up to a joint's heave (2.8 cm in all), and a weed or a crack a few millimetres more.
            const diff = top - field.heightAt(x, z);
            worstWalk = Math.max(worstWalk, Math.abs(diff));
            // (A slab is a plane between its four corners: the ground's own curvature is a few millimetres of it.)
            expect(diff, `seed ${seed} street ${st.id} (${st.kind} walk ${st.walk}) side ${k} s ${s.toFixed(1)} of ${len.toFixed(0)} run ${run.s0.toFixed(1)}-${run.s1.toFixed(1)}`).toBeGreaterThan(-0.006);
            expect(diff, `seed ${seed} street ${st.id} s ${s.toFixed(1)}`).toBeLessThan(WALK_TOP + HEAVE_MAX + 0.008);
            // The lot behind it: its own ground (the terrain, which no trough touches out here) at the sidewalk's back edge, and a hand's breadth behind it.
            const [ex, ez] = at(sg * (st.width / 2 - 0.1));
            const [bx, bz] = at(sg * (st.width / 2 + 0.1));
            const edgeTop = drawnTop(batches, ex, ez, field.heightAt(ex, ez) + 0.036);
            if (edgeTop !== null) {
              expect(Math.abs(edgeTop - field.heightAt(ex, ez)), `seed ${seed} street ${st.id}: the sidewalk's back edge against the lot's ground`).toBeLessThan(0.036);
              expect(Math.abs(field.heightAt(bx, bz) - field.heightAt(ex, ez)), "the lot's ground is the sidewalk's, level over the edge").toBeLessThan(0.1);
            }
            // And the curb is a step: the roadway beside it lies lower than this sidewalk by the street's curb (or the verge's own fall).
            if (side.curb) {
              // Across the curb itself, half a metre: the step is the curb's height once the ground's own fall over that half metre (read on each side of it) is taken out.
              const h = (t: number): number => field.heightAt(...at(sg * t));
              const fall = (h(cw - 0.15) - h(cw - 0.7) + h(cw + 0.95) - h(cw + 0.4)) / 2 / 0.55;
              const drop = h(cw + 0.4) - h(cw - 0.15) - fall * 0.55;
              const curb = e.paving.find((p) => s < p.s1)!.curb;
              // (Where the ground's own fall is steep or uneven across the curb, 7 percent or more, the step is not read.)
              if (Math.abs(h(cw + 0.95) - h(cw + 0.4)) > 0.04 || Math.abs(h(cw - 0.15) - h(cw - 0.7)) > 0.04) continue;
              expect(Math.abs(drop - curb), `seed ${seed} street ${st.id}`).toBeLessThan(0.04);
              steps++;
            }
          }
        }
      }
      rows.push(`seed ${seed}: ${roadway} roadway points (worst ${worstRoad.toFixed(3)} m), ${walk} sidewalk points (worst ${worstWalk.toFixed(3)} m), ${steps} curbs stepped`);
      expect(roadway).toBeGreaterThan(30);
      expect(walk).toBeGreaterThan(10);
      expect(steps).toBeGreaterThan(5);
      // (A roadway's own lift is 1.2 cm; paint lies 1.2 cm over that and a seam or a cut a few millimetres more, and the ground's own roll over a tile.)
      expect(worstRoad).toBeLessThan(0.04);
      // (The slab's top is at most 2.8 cm over the ground; a weed or a crack lies on it a few millimetres higher.)
      expect(worstWalk).toBeLessThan(0.036);
    }
    console.log(rows.join("\n"));
  });

  it("is walked: a hull stepped from the sidewalk across the curb to the roadway goes down by the curb's height and stays on the ground it stands on", () => {
    const seed = WORLD_SEEDS[0] as number;
    const plan = planFor(seed);
    const { anchor } = siteFor(seed);
    const field = groundOf(worldFor(seed));
    let crossed = 0;
    for (const st of plan.streets) {
      const e = plan.edges[st.id] as StreetEdge;
      if (st.kind !== "street" || !e.sides[0].curb) continue;
      const len = Math.hypot(st.b.x - st.a.x, st.b.z - st.a.z);
      if (len < 60) continue;
      const tx = (st.b.x - st.a.x) / len;
      const tz = (st.b.z - st.a.z) / len;
      const s = len / 2;
      if (nearJunction(plan, st.a.x + tx * s, st.a.z + tz * s, 30)) continue;
      const cw = st.roadway / 2;
      const h: number[] = [];
      for (let t = cw + 0.6; t >= cw - 0.6; t -= 0.05) h.push(field.heightAt(anchor.x + st.a.x + tx * s - tz * t, anchor.z + st.a.z + tz * s + tx * t));
      // Down across the curb by about the street's own curb (the ground's own fall over a metre and a bit aside), and no slope a foot cannot stand on (0.7 of a normal, 1.02 of a grade) bar the ground's own.
      const curb = e.paving.find((p) => s < p.s1)!.curb;
      // (0.13: the town made to fit its houses has this street on a steeper hillside; it was 0.1.)
      expect(Math.abs(h[0]! - h[h.length - 1]! - curb)).toBeLessThan(0.13);
      for (let i = 1; i < h.length; i++) expect(Math.abs(h[i]! - h[i - 1]!) / 0.05).toBeLessThan(1.02 + 0.2);
      void PLAYER_HALF;
      crossed++;
      if (crossed > 20) break;
    }
    expect(crossed).toBeGreaterThan(5);
    expect(CURB_OUT).toBeGreaterThan(0.2);
  });
});

describe("the junctions follow the sidewalks and the curbs", () => {
  it("cuts no ramp where the side has no sidewalk or no curb, and gives a corner a curb return and a sidewalk only where both its legs have them", () => {
    let corners = 0;
    let plain = 0;
    let rampsChecked = 0;
    for (const seed of [...WORLD_SEEDS, 7, 12, 33]) {
      const plan = planFor(seed);
      for (const j of plan.junctions) {
        if (!hasPavement(j)) continue;
        for (const k of j.corners) {
          const a = j.legs[k.from]!;
          const b = j.legs[k.to]!;
          corners++;
          expect(k.walk).toBe(a.walkLeft && b.walkRight);
          if (k.shape !== "straight") expect(k.curb).toBe(a.curbLeft && b.curbRight);
          if (!k.curb) plain++;
          // A sidewalk with no curb return is a corner with a curb broken: it never has one without the other's legs.
          if (k.walk) expect(a.walkLeft && b.walkRight).toBe(true);
        }
        for (const r of rampsOf(j.legs, j.ramps, { marked: CROSSWALK_WIDTH, unmarked: UNMARKED_CROSSWALK })) {
          const l = j.legs[r.leg]!;
          expect(r.side === 1 ? l.walkLeft && l.curbLeft : l.walkRight && l.curbRight, `seed ${seed} junction ${j.id}: a ramp where the side has no sidewalk or curb`).toBe(true);
          rampsChecked++;
        }
      }
    }
    console.log(`${corners} corners, ${plain} without a curb return, ${rampsChecked} ramps`);
    expect(corners).toBeGreaterThan(200);
    expect(plain).toBeGreaterThan(20);
    expect(rampsChecked).toBeGreaterThan(100);
  });

  it("draws no sidewalk and no curb return at a plain corner: the polygons laid there are gravel and asphalt", () => {
    const seed = WORLD_SEEDS[0] as number;
    const plan = planFor(seed);
    const { anchor } = siteFor(seed);
    const batches = batchesOf(seed);
    let checked = 0;
    for (const j of plan.junctions) {
      if (!hasPavement(j)) continue;
      for (const k of j.corners) {
        if (k.shape !== "arc" || k.curb || k.c === null || k.lot === null) continue;
        // A point just outside the arc, toward the corner's centre: not a sidewalk or a curb (the layer's 15), but ground (gravel or the bare terrain).
        const dx = k.c.x - (k.ta.x + k.tb.x) / 2;
        const dz = k.c.z - (k.ta.z + k.tb.z) / 2;
        const l = Math.hypot(dx, dz) || 1;
        const px = anchor.x + (k.ta.x + k.tb.x) / 2 + (dx / l) * 0.6;
        const pz = anchor.z + (k.ta.z + k.tb.z) / 2 + (dz / l) * 0.6;
        let sidewalk = 0;
        for (const b of batches) {
          if (b.layer !== "flat") continue;
          const a = b.arrays;
          for (let v = 0; v < a.positions.length / 3; v++) {
            if (Math.abs((a.positions[v * 3] as number) - px) < 0.2 && Math.abs((a.positions[v * 3 + 2] as number) - pz) < 0.2 && (a.surface[v * SURFACE_FLOATS] as number) === 15) sidewalk++;
          }
        }
        expect(sidewalk, `junction ${j.id}: sidewalk vertices at a plain corner`).toBe(0);
        checked++;
        if (checked >= 10) return;
      }
    }
    expect(checked).toBeGreaterThan(0);
  });
});

describe("the slabs of a sidewalk", () => {
  it("never repeat a period: the joints of a pour are not evenly spaced, no two pours have the same spacings, and a pour's spacing is one of the few poured", () => {
    const seen = new Set<string>();
    for (let street = 0; street < 60; street++) {
      for (let run = 0; run < 4; run++) {
        const key = Math.imul(street + 1, 2654435) ^ 0x51;
        const spacing = SPACINGS[(street + run) % SPACINGS.length] as number;
        const st = stations(key, run, 10, 70, spacing);
        const gaps = st.slice(1).map((s, i) => s - (st[i] as number));
        // Within 4 percent of the spacing but never exactly it, and not one length repeated.
        for (let i = 0; i + 1 < gaps.length; i++) expect(Math.abs((gaps[i] as number) / spacing - 1)).toBeLessThan(0.045);
        // No period: for no p up to 8 do the joints repeat after p slabs (to a millimetre).
        for (let p = 1; p <= 8; p++) expect(gaps.slice(0, gaps.length - 1 - p).some((g, i) => Math.abs(g - (gaps[i + p] as number)) > 1e-3), `street ${street} run ${run}: a period of ${p}`).toBe(true);
        seen.add(gaps.map((g) => g.toFixed(4)).join(","));
      }
    }
    expect(seen.size).toBe(240);
  });
});

