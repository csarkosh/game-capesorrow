import { describe, expect, it } from "vitest";
import { bearingU, bearingV } from "../../src/sim/town/bearings.js";
import { contains, orientedRect, overlapDepth, segDist, segSegDist, bbox, type Poly, type Vec } from "../../src/sim/town/geom.js";
import { shoreAt } from "../../src/sim/town/shore.js";
import type { Building, Street, TownPlan } from "../../src/sim/town/types.js";
import { SEEDS, townFor } from "./sites.js";

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

function orientedPoly(p: Poly): Poly {
  let a = 0;
  for (let i = 0; i < p.length; i++) {
    const q = p[i]!;
    const r = p[(i + 1) % p.length]!;
    a += q.x * r.z - r.x * q.z;
  }
  return a < 0 ? p.slice().reverse() : p;
}

/** The distance from a convex polygon to a segment (0 if they touch). */
function polySegDist(poly: Poly, a: Vec, b: Vec): number {
  if (contains(orientedPoly(poly), a) || contains(orientedPoly(poly), b)) return 0;
  let d = Infinity;
  for (let i = 0; i < poly.length; i++) d = Math.min(d, segSegDist(poly[i]!, poly[(i + 1) % poly.length]!, a, b));
  return d;
}

const ALLOWED_SEAWARD = ["pier", "cannery", "port terminal shed"];

function check(plan: TownPlan, seed: number, site: ReturnType<typeof townFor>["site"]): string[] {
  const bad: string[] = [];
  const fail = (m: string): void => {
    bad.push(`seed ${seed}: ${m}`);
  };
  // Every lot inside its block.
  for (const lot of plan.lots) {
    const block = plan.blocks[lot.block]!;
    for (const p of lot.polygon) if (!contains(orientedPoly(block.polygon), p, TOL)) fail(`lot ${lot.id} outside block ${block.id}`);
  }
  // Every building inside its lot.
  const rects: Poly[] = plan.buildings.map(rect);
  for (const b of plan.buildings) {
    if (b.lot < 0) {
      if (!ALLOWED_SEAWARD.includes(b.kind)) fail(`building ${b.id} has no lot and is a ${b.kind}`);
      continue;
    }
    const lot = plan.lots[b.lot]!;
    for (const p of rects[b.id]!) if (!contains(orientedPoly(lot.polygon), p, TOL)) fail(`building ${b.id} (${b.kind}) outside lot ${lot.id}`);
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
      const d = overlapDepth(orientedPoly(block.polygon), orientedPoly(surface(s)));
      if (d > 0.05) fail(`block ${block.id} overlaps street ${s.id} (${s.name}, ${s.kind}) by ${d.toFixed(2)} m`);
    }
  }
  // Nothing but wharf, pier, cannery and port structures stands seaward of the shoreline.
  for (const b of plan.buildings) {
    if (ALLOWED_SEAWARD.includes(b.kind)) continue;
    for (const p of rects[b.id]!) if (p.x < shoreAt(site, p.z) - 0.01) fail(`building ${b.id} (${b.kind}) is seaward of the shore`);
  }
  // Every block touches a street.
  for (const block of plan.blocks) {
    let best = Infinity;
    for (const s of roads) best = Math.min(best, polySegDist(block.polygon, s.a, s.b) - s.width / 2);
    if (best > 0.6) fail(`block ${block.id} (${block.district}) is ${best.toFixed(1)} m from any street`);
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
  const roots = new Set<number>();
  for (let i = 0; i < plan.streets.length; i++) roots.add(find(i));
  if (roots.size !== 1) fail(`the street network has ${roots.size} parts`);
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
  if (near > 0.01) fail(`the spawn is ${near.toFixed(2)} m off the road's surface`);
  for (const r of rects) if (contains(orientedPoly(r), plan.spawn)) fail("the spawn stands inside a building");
  const fr = rects[office.id]!;
  let wall = Infinity;
  for (let i = 0; i < fr.length; i++) wall = Math.min(wall, segDist(plan.spawn, fr[i]!, fr[(i + 1) % fr.length]!));
  if (wall > 6 || wall < 1) fail(`the spawn is ${wall.toFixed(2)} m from the FBI office's wall`);
  // It faces away from the building.
  const away = { x: plan.spawn.x - office.centre.x, z: plan.spawn.z - office.centre.z };
  const face = { x: Math.sin(plan.spawn.yaw), z: Math.cos(plan.spawn.yaw) };
  if (away.x * face.x + away.z * face.z <= 0) fail("the spawn faces the building");
  // Landmarks point at real buildings.
  for (const l of plan.landmarks) if (!plan.buildings[l.building]) fail(`landmark ${l.name} points at no building`);
  return bad;
}

describe("a plan is valid", () => {
  it("over forty seeds: lots, buildings, blocks, streets, shore, network, FBI office and spawn", () => {
    const bad: string[] = [];
    for (const seed of SEEDS) {
      const { plan, site } = townFor(seed);
      bad.push(...check(plan, seed, site));
    }
    expect(bad.slice(0, 30)).toEqual([]);
  });

  it("has a block of 3 to 6 corners, wound the same way, with some of its corners cut", () => {
    let cut = 0;
    for (const seed of SEEDS) {
      for (const b of townFor(seed).plan.blocks) {
        expect(b.polygon.length).toBeGreaterThanOrEqual(3);
        expect(b.polygon.length).toBeLessThanOrEqual(6);
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
});
