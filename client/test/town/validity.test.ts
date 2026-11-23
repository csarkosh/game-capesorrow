import { describe, expect, it } from "vitest";
import { bearingU, bearingV } from "../../src/sim/town/bearings.js";
import { area, bbox, contains, orientedRect, overlapDepth, segDist, segSegDist, type Poly, type Vec } from "../../src/sim/town/geom.js";
import { shoreAt } from "../../src/sim/town/shore.js";
import type { TownSite } from "../../src/sim/town/site.js";
import type { Building, Street, TownPlan } from "../../src/sim/town/types.js";
import { SEEDS, syntheticSite, townFor } from "./sites.js";
import { planTown } from "../../src/sim/town/plan.js";
import { planFor } from "../../src/sim/town/planFor.js";
import { siteFor } from "../../src/sim/town/siteFor.js";

const TOL = 0.01;

function rect(b: Building): Poly {
  return orientedRect(b.centre, b.halfAlong, b.halfAcross, bearingU(b.bearing), bearingV(b.bearing));
}

/** A street's surface: the rectangle along its centre line, as wide as it is. */
function surface(s: Street): Poly {
  const dx = s.b.x - s.a.x;
  const dz = s.b.z - s.a.z;
  const len = Math.sqrt(dx * dx + dz * dz);
  const nx = (-dz / len) * (s.width / 2);
  const nz = (dx / len) * (s.width / 2);
  return [
    { x: s.a.x + nx, z: s.a.z + nz },
    { x: s.b.x + nx, z: s.b.z + nz },
    { x: s.b.x - nx, z: s.b.z - nz },
    { x: s.a.x - nx, z: s.a.z - nz },
  ];
}

function ccw(p: Poly): Poly {
  return area(p) < 0 ? p.slice().reverse() : p;
}

/** The distance from a convex polygon to a segment (0 if they touch). */
function polySegDist(poly: Poly, a: Vec, b: Vec): number {
  if (contains(ccw(poly), a) || contains(ccw(poly), b)) return 0;
  let d = Infinity;
  for (let i = 0; i < poly.length; i++) d = Math.min(d, segSegDist(poly[i]!, poly[(i + 1) % poly.length]!, a, b));
  return d;
}

/** Points along a polygon's edges and its middle: what "stands on" is judged by. */
function samples(p: Poly): Vec[] {
  const out: Vec[] = [];
  for (let i = 0; i < p.length; i++) {
    const a = p[i]!;
    const b = p[(i + 1) % p.length]!;
    const n = Math.max(1, Math.floor(Math.sqrt((b.x - a.x) ** 2 + (b.z - a.z) ** 2) / 4));
    for (let k = 0; k < n; k++) out.push({ x: a.x + ((b.x - a.x) * k) / n, z: a.z + ((b.z - a.z) * k) / n });
  }
  return out;
}

const ALLOWED_SEAWARD = ["pier", "cannery", "port terminal shed"];

function onFill(plan: TownPlan, p: Vec): boolean {
  return plan.fill.some((f) => contains(f.polygon, p, 0.05));
}

function check(plan: TownPlan, seed: number | string, site: TownSite): string[] {
  const bad: string[] = [];
  const fail = (m: string): void => {
    bad.push(`seed ${seed}: ${m}`);
  };
  // Every lot inside its block.
  for (const lot of plan.lots) {
    const block = plan.blocks[lot.block]!;
    for (const p of lot.polygon) if (!contains(ccw(block.polygon), p, TOL)) fail(`lot ${lot.id} outside block ${block.id}`);
  }
  // Every building inside its lot.
  const rects: Poly[] = plan.buildings.map(rect);
  for (const b of plan.buildings) {
    if (b.lot < 0) {
      if (!ALLOWED_SEAWARD.includes(b.kind)) fail(`building ${b.id} has no lot and is a ${b.kind}`);
      continue;
    }
    const lot = plan.lots[b.lot]!;
    for (const p of rects[b.id]!) if (!contains(ccw(lot.polygon), p, TOL)) fail(`building ${b.id} (${b.kind}) outside lot ${lot.id}`);
  }
  // No two buildings overlap (separating axes on oriented rectangles).
  const boxes = rects.map((r) => bbox(r));
  for (let i = 0; i < rects.length; i++) {
    for (let j = i + 1; j < rects.length; j++) {
      const p = boxes[i]!;
      const q = boxes[j]!;
      if (p.x1 < q.x0 || q.x1 < p.x0 || p.z1 < q.z0 || q.z1 < p.z0) continue;
      if (overlapDepth(rects[i]!, rects[j]!) > 0.001) fail(`buildings ${i} and ${j} overlap`);
    }
  }
  // No block overlaps a street's surface (alleys lie between the lots of a block, inside it).
  const roads = plan.streets.filter((s) => s.kind !== "alley");
  for (const block of plan.blocks) {
    const bb = bbox(block.polygon);
    for (const s of roads) {
      const sb = bbox([s.a, s.b]);
      const hw = s.width / 2;
      if (sb.x1 + hw < bb.x0 || sb.x0 - hw > bb.x1 || sb.z1 + hw < bb.z0 || sb.z0 - hw > bb.z1) continue;
      const d = overlapDepth(ccw(block.polygon), ccw(surface(s)));
      if (d > 0.05) fail(`block ${block.id} overlaps street ${s.id} (${s.name}, ${s.kind}) by ${d.toFixed(2)} m`);
    }
  }
  // Nothing but piers (and the sheds on piles at their ends) stands seaward of the natural shore or the quay: every other building is on natural land or on the fill.
  for (const b of plan.buildings) {
    if (ALLOWED_SEAWARD.includes(b.kind) && b.lot < 0) continue;
    for (const p of samples(rects[b.id]!)) {
      if (p.x < shoreAt(site, p.z) && !onFill(plan, p)) {
        fail(`building ${b.id} (${b.kind}) stands in the sea`);
        break;
      }
    }
  }
  // No block lies seaward of the natural shore but old-plat blocks on the fill.
  for (const block of plan.blocks) {
    for (const p of samples(block.polygon)) {
      if (p.x < shoreAt(site, p.z) && !(block.plat === "old" && onFill(plan, p))) {
        fail(`block ${block.id} (${block.plat}, ${block.district}) lies seaward of the natural shore`);
        break;
      }
    }
  }
  // Every block with a building on it touches a street (an outlying lot stands by the highway or a road out, and touches none of the town's grid).
  for (const block of plan.blocks) {
    if (block.district === "outskirts") {
      let off = Infinity;
      for (const s of roads) off = Math.min(off, polySegDist(block.polygon, s.a, s.b) - s.width / 2);
      for (const r of plan.roads) for (let i = 1; i < r.points.length; i++) off = Math.min(off, polySegDist(block.polygon, r.points[i - 1]!, r.points[i]!));
      if (off > 40) fail(`outlying lot ${block.id} is ${off.toFixed(1)} m from the highway and every road`);
      continue;
    }
    let best = Infinity;
    for (const s of roads) best = Math.min(best, polySegDist(block.polygon, s.a, s.b) - s.width / 2);
    // A block with no building on it may stand past the last street: it is the plat the town never built on (`port/trim.ts`).
    if (best > 0.6 && plan.buildings.some((b) => b.lot >= 0 && plan.lots[b.lot]!.block === block.id)) fail(`block ${block.id} (${block.district}) is ${best.toFixed(1)} m from any street`);
  }
  // The street network is one connected graph.
  const parent = plan.streets.map((_, i) => i);
  const find = (i: number): number => {
    let r = i;
    while (parent[r] !== r) r = parent[r]!;
    return r;
  };
  for (let i = 0; i < plan.streets.length; i++) {
    for (let j = i + 1; j < plan.streets.length; j++) {
      const a = plan.streets[i]!;
      const b = plan.streets[j]!;
      if (segSegDist(a.a, a.b, b.a, b.b) <= (a.width + b.width) / 2 + 0.5) parent[find(i)] = find(j);
    }
  }
  const roots: number[] = [];
  for (let i = 0; i < plan.streets.length; i++) if (!roots.includes(find(i))) roots.push(find(i));
  if (roots.length !== 1) fail(`the street network has ${roots.length} parts`);

  // Wharves and piers start at the quay or the shoreline and run over water, never over dry land.
  const overWater = (p: Vec): boolean => p.x < shoreAt(site, p.z) - 0.2;
  const nearEdge = (p: Vec): boolean => {
    if (Math.abs(p.x - shoreAt(site, p.z)) <= 12) return true;
    return segDist(p, plan.quay.a, plan.quay.b) <= 12;
  };
  for (const s of plan.streets) {
    if (s.kind !== "wharf") continue;
    const len = Math.sqrt((s.b.x - s.a.x) ** 2 + (s.b.z - s.a.z) ** 2);
    if (!nearEdge(s.a)) fail(`wharf ${s.id} starts ${Math.round(segDist(s.a, plan.quay.a, plan.quay.b))} m from the quay`);
    if (len < 30 || len > 90.5) fail(`wharf ${s.id} is ${len.toFixed(0)} m long`);
    for (let t = 12 / len; t <= 1; t += 3 / len) {
      const p = { x: s.a.x + (s.b.x - s.a.x) * t, z: s.a.z + (s.b.z - s.a.z) * t };
      if (!overWater(p)) {
        fail(`wharf ${s.id} crosses dry land`);
        break;
      }
    }
  }
  for (const b of plan.buildings) {
    if (b.kind !== "pier") continue;
    // The pier's long axis is its across axis: its two short ends' middles are the landward and seaward ends.
    const U = bearingU(b.bearing);
    const V = bearingV(b.bearing);
    const e1 = { x: b.centre.x + V.x * b.halfAcross, z: b.centre.z + V.z * b.halfAcross };
    const e2 = { x: b.centre.x - V.x * b.halfAcross, z: b.centre.z - V.z * b.halfAcross };
    const [land, sea] = e1.x > e2.x ? [e1, e2] : [e2, e1];
    const len = b.halfAcross * 2;
    if (!nearEdge(land)) fail(`pier ${b.id} starts away from the quay and the shore`);
    if (len < 30 - 0.01 || len > 93) fail(`pier ${b.id} is ${len.toFixed(0)} m long`);
    for (let t = 12 / len; t <= 1; t += 3 / len) {
      for (const k of [-1, 0, 1]) {
        const p = { x: land.x + (sea.x - land.x) * t + U.x * k * b.halfAlong, z: land.z + (sea.z - land.z) * t + U.z * k * b.halfAlong };
        if (!overWater(p)) {
          fail(`pier ${b.id} crosses dry land`);
          t = 2;
          break;
        }
      }
    }
  }

  // The FBI office exists, fronts a street, and the spawn is at its door.
  const fbi = plan.landmarks.find((l) => l.role === "fbi");
  if (!fbi) {
    fail("no FBI office");
    return bad;
  }
  const office = plan.buildings[fbi.building]!;
  if (!["federal building", "office"].includes(office.kind)) fail(`the FBI office is a ${office.kind}`);
  let near = Infinity;
  for (const s of roads) near = Math.min(near, segDist(plan.spawn, s.a, s.b) - s.width / 2);
  if (near > 8) fail(`the spawn is ${near.toFixed(2)} m off the road's surface`);
  for (const r of rects) if (contains(ccw(r), plan.spawn)) fail("the spawn stands inside a building");
  const fr = rects[office.id]!;
  let wall = Infinity;
  for (let i = 0; i < fr.length; i++) wall = Math.min(wall, segDist(plan.spawn, fr[i]!, fr[(i + 1) % fr.length]!));
  if (wall > 6 || wall < 1) fail(`the spawn is ${wall.toFixed(2)} m from the FBI office's wall`);
  const away = { x: plan.spawn.x - office.centre.x, z: plan.spawn.z - office.centre.z };
  const face = { x: Math.sin(plan.spawn.yaw), z: Math.cos(plan.spawn.yaw) };
  if (away.x * face.x + away.z * face.z <= 0) fail("the spawn faces the building");
  for (const l of plan.landmarks) if (l.at === undefined && !plan.buildings[l.building]) fail(`landmark ${l.name} points at no building`);
  return bad;
}

describe("a plan is valid on the world's real sites", () => {
  it("over forty world seeds: lots, buildings, blocks, streets, shore, network, wharves, FBI office and spawn", () => {
    const bad: string[] = [];
    for (const seed of SEEDS) {
      const { plan, site } = townFor(seed);
      bad.push(...check(plan, seed, site));
    }
    expect(bad.slice(0, 30)).toEqual([]);
  });

  it("makes the made ground: convex, counter-clockwise fill between the quay and the natural shore, and an old plat on land or fill", () => {
    for (const seed of SEEDS) {
      const { plan, site } = townFor(seed);
      expect(plan.fill.length, `seed ${seed}`).toBeGreaterThan(0);
      const quayLen = Math.sqrt((plan.quay.b.x - plan.quay.a.x) ** 2 + (plan.quay.b.z - plan.quay.a.z) ** 2);
      expect(quayLen).toBeGreaterThan(300);
      let samplesTotal = 0;
      let samplesWater = 0;
      // The quay's side: a point is landward of it if it is on the old plat's side.
      const old = plan.plats[0]!;
      const qd = { x: (plan.quay.b.x - plan.quay.a.x) / quayLen, z: (plan.quay.b.z - plan.quay.a.z) / quayLen };
      const inland = { x: qd.z, z: -qd.x }; // the plat's v axis: inland
      const sign = inland.x >= 0 ? 1 : -1;
      for (const f of plan.fill) {
        const poly = f.polygon;
        expect(poly.length).toBeGreaterThanOrEqual(3);
        expect(area(poly), `seed ${seed}: counter-clockwise`).toBeGreaterThan(0);
        // Convex: every turn the same way.
        for (let i = 0; i < poly.length; i++) {
          const a = poly[i]!;
          const b = poly[(i + 1) % poly.length]!;
          const c = poly[(i + 2) % poly.length]!;
          expect((b.x - a.x) * (c.z - b.z) - (b.z - a.z) * (c.x - b.x), `seed ${seed}: convex`).toBeGreaterThanOrEqual(-1e-6);
        }
        // Between the quay and the shore: every corner landward of the quay.
        for (const p of poly) expect(sign * ((p.x - plan.quay.a.x) * inland.x + (p.z - plan.quay.a.z) * inland.z), `seed ${seed}: landward of the quay`).toBeGreaterThanOrEqual(-0.01);
        // And over what was water: sample the polygon; a column across a headland's flank is cut at the shore's most landward point and may cover some of its land.
        const bb = bbox(poly);
        for (let x = bb.x0; x <= bb.x1; x += 5) {
          for (let z = bb.z0; z <= bb.z1; z += 5) {
            if (!contains(poly, { x, z })) continue;
            samplesTotal++;
            if (x < shoreAt(site, z)) samplesWater++;
          }
        }
      }
      expect(samplesWater / Math.max(1, samplesTotal), `seed ${seed}: the fill is over water`).toBeGreaterThan(0.5);
      // The harbour stays open: the quay lies at most a block and a half... seaward of the cove's back: the deepest fill is under 135 m.
      let deepest = 0;
      for (const f of plan.fill) for (const p of f.polygon) deepest = Math.max(deepest, shoreAt(site, p.z) - p.x);
      expect(deepest, `seed ${seed}`).toBeLessThan(160);
      expect(old.id).toBe("old");
    }
  });

  it("wraps the company's plat around the old plat: its blocks lie outside the old plat's rectangle, and none is cut along its far-side extension", () => {
    let touching = 0;
    for (const seed of SEEDS) {
      const { plan } = townFor(seed);
      const old = plan.plats[0]!;
      const poly = ccw(old.polygon);
      for (const b of plan.blocks) {
        if (b.plat !== "company") continue;
        expect(overlapDepth(ccw(b.polygon), poly), `seed ${seed} block ${b.id}`).toBeLessThanOrEqual(0.05);
        // An edge of a company block lying along one of the old plat's edge lines must lie within that edge's extent.
        for (let i = 0; i < poly.length; i++) {
          const a = poly[i]!;
          const c = poly[(i + 1) % poly.length]!;
          const len = Math.sqrt((c.x - a.x) ** 2 + (c.z - a.z) ** 2);
          const dir = { x: (c.x - a.x) / len, z: (c.z - a.z) / len };
          for (let k = 0; k < b.polygon.length; k++) {
            const p = b.polygon[k]!;
            const q = b.polygon[(k + 1) % b.polygon.length]!;
            const lp = Math.abs((p.x - a.x) * dir.z - (p.z - a.z) * dir.x);
            const lq = Math.abs((q.x - a.x) * dir.z - (q.z - a.z) * dir.x);
            if (lp > 0.05 || lq > 0.05) continue;
            const tp = (p.x - a.x) * dir.x + (p.z - a.z) * dir.z;
            const tq = (q.x - a.x) * dir.x + (q.z - a.z) * dir.z;
            if (Math.abs(tp - tq) < 1) continue;
            // The edge lies along the old plat's edge line: it may overhang the edge's end by at most a cell's reach (a cell cut at the corner), never run on across the company's plat.
            expect(Math.min(tp, tq), `seed ${seed} block ${b.id} runs along the plat's edge line past its end`).toBeGreaterThanOrEqual(-260);
            expect(Math.max(tp, tq), `seed ${seed} block ${b.id} runs along the plat's edge line past its end`).toBeLessThanOrEqual(len + 260);
            touching++;
          }
        }
      }
    }
    expect(touching).toBeGreaterThan(40);
  });

  it("keeps the headlands open: no block or building but the old plat's stands on the cove's tongues", () => {
    // A tongue is where the natural shore stands 40 m or more seaward of the shore a little north and south of it.
    for (const seed of SEEDS) {
      const { plan, site } = townFor(seed);
      for (const b of plan.buildings) {
        if (b.kind === "pier" || b.lot < 0) continue;
        const c = b.centre;
        const here = shoreAt(site, c.z);
        const around = Math.max(shoreAt(site, c.z - 40), shoreAt(site, c.z + 40));
        const onTongue = here < around - 40 && c.x < here + 25;
        expect(onTongue && plan.blocks[plan.lots[b.lot]!.block]!.plat !== "old", `seed ${seed} building ${b.id}`).toBe(false);
      }
    }
  });

  it("has a block of 3 to 6 corners, wound the same way, with some of its corners cut", () => {
    let cut = 0;
    for (const seed of SEEDS) {
      for (const b of townFor(seed).plan.blocks) {
        expect(b.polygon.length).toBeGreaterThanOrEqual(3);
        expect(b.polygon.length).toBeLessThanOrEqual(6);
        expect(area(b.polygon)).toBeGreaterThan(0);
        if (b.polygon.length !== 4) cut++;
      }
    }
    expect(cut).toBeGreaterThan(0);
  });

  it("numbers its parts by position", () => {
    const { plan } = townFor(3);
    plan.blocks.forEach((b, i) => expect(b.id).toBe(i));
    plan.lots.forEach((l, i) => expect(l.id).toBe(i));
    plan.buildings.forEach((b, i) => expect(b.id).toBe(i));
    plan.streets.forEach((s, i) => expect(s.id).toBe(i));
  });

  it("does not throw on odd ground: a tight shore, a wide one, a swaying highway, a spiky shore, a steep coast", () => {
    for (let k = 0; k < 6; k++) {
      for (const seed of [7919, 15838]) {
        const shoreX: number[] = [];
        const roadX: number[] = [];
        for (let i = 0; i < 65; i++) {
          const z = -512 + i * 16;
          shoreX.push(k === 0 ? -25 : k === 1 ? -700 : k === 3 ? -90 - (Math.abs(z) < 60 ? 0 : (i & 1) * 160) : k === 5 ? -40 - 0.5 * z : -90);
          roadX.push(k === 2 ? 300 * Math.min(1, Math.abs(z) / 300) * (z < 0 ? -1 : 1) : 0);
        }
        const site: TownSite = { seed, anchor: { x: 0, z: 0 }, step: 16, z0: -512, shoreX, roadX, inland: 320 };
        const plan = planTown(site, "port");
        expect(plan.blocks.length, `odd ${k}`).toBeGreaterThan(10);
        expect(plan.landmarks.some((l) => l.role === "fbi")).toBe(true);
      }
    }
  });

  it("planFor is planTown on the site siteFor reads, cached, and valid whatever that site's reach inland", () => {
    const bad: string[] = [];
    for (const seed of SEEDS.slice(0, 12)) {
      const plan = planFor(seed);
      expect(planFor(seed)).toBe(plan);
      expect(plan).toEqual(planTown(siteFor(seed), "port"));
      bad.push(...check(plan, `planFor ${seed}`, siteFor(seed)));
    }
    expect(bad.slice(0, 20)).toEqual([]);
  });

  it("is valid on the synthetic coast too", () => {
    const bad: string[] = [];
    for (const seed of [1, 2, 3, 4, 5]) {
      const site = syntheticSite(seed);
      bad.push(...check(planTown(site, "port"), `synthetic ${seed}`, site));
    }
    expect(bad.slice(0, 20)).toEqual([]);
  });
});

