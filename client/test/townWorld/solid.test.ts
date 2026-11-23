import { describe, expect, it } from "vitest";
import { TICK_DT } from "@csarkosh/engine/sim/constants";
import type { InputCommand } from "@csarkosh/engine/sim/core";
import { addPlayer, tickPlayers } from "@csarkosh/engine/sim/tick";
import { WALK_RULES, type Walker } from "../../src/sim.js";
import { bearingU, bearingV } from "../../src/sim/town/bearings.js";
import { HULL_RADIUS, SOLID_CELL, penetration, solidsNear, townConstrain, townSolids } from "../../src/sim/town/solid.js";
import { townStart } from "../../src/sim/town/start.js";
import type { Building } from "../../src/sim/town/types.js";
import { WORLD_SEEDS, groundOf, planFor, siteFor, worldFor } from "./world.js";

/** A small seeded stream for the walkers' choices (a test's own: nothing of the game's). */
function stream(seed: number): () => number {
  let s = seed | 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A pier is its deck and no wall; every other building is solid, the sheds on piles among them. */
const solid = (b: Building): boolean => b.kind !== "pier";

/** The world position of a building's centre. */
function centreOf(seed: number, b: Building): { x: number; z: number } {
  const { anchor } = siteFor(seed);
  return { x: anchor.x + b.centre.x, z: anchor.z + b.centre.z };
}

/** How far a point is from a building's rectangle (0 inside), by the plan's own numbers. */
function distanceTo(seed: number, b: Building, x: number, z: number): number {
  const c = centreOf(seed, b);
  const u = bearingU(b.bearing);
  const v = bearingV(b.bearing);
  const lu = (x - c.x) * u.x + (z - c.z) * u.z;
  const lv = (x - c.x) * v.x + (z - c.z) * v.z;
  const eu = Math.max(0, Math.abs(lu) - b.halfAlong);
  const ev = Math.max(0, Math.abs(lv) - b.halfAcross);
  return Math.sqrt(eu * eu + ev * ev);
}

/** The deepest any building's rectangle reaches into the hull at (x, z), by an independent reading of the plan. */
function worstInside(seed: number, near: readonly Building[], x: number, z: number): number {
  let worst = 0;
  for (const b of near) worst = Math.max(worst, HULL_RADIUS - distanceTo(seed, b, x, z));
  return worst;
}

/** Pairs of solid buildings whose walls meet or come within 0.3 m: where two walls make a corner for a hull. */
function meetingPairs(seed: number): { a: Building; b: Building; x: number; z: number }[] {
  const plan = planFor(seed);
  const solids = plan.buildings.filter(solid);
  const out: { a: Building; b: Building; x: number; z: number }[] = [];
  for (const a of solids) {
    const ca = centreOf(seed, a);
    const ua = bearingU(a.bearing);
    const va = bearingV(a.bearing);
    for (const b of solids) {
      if (b.id <= a.id) continue;
      const cb = centreOf(seed, b);
      if (Math.abs(ca.x - cb.x) + Math.abs(ca.z - cb.z) > 60) continue;
      // Walk a's outline, a point every 0.25 m: the nearest to b.
      let best = Infinity;
      let at = { x: 0, z: 0 };
      for (const side of [-1, 1]) {
        for (let t = -a.halfAcross; t <= a.halfAcross; t += 0.25) {
          const x = ca.x + ua.x * side * a.halfAlong + va.x * t;
          const z = ca.z + ua.z * side * a.halfAlong + va.z * t;
          const d = distanceTo(seed, b, x, z);
          if (d < best) {
            best = d;
            at = { x, z };
          }
        }
        for (let t = -a.halfAlong; t <= a.halfAlong; t += 0.25) {
          const x = ca.x + va.x * side * a.halfAcross + ua.x * t;
          const z = ca.z + va.z * side * a.halfAcross + ua.z * t;
          const d = distanceTo(seed, b, x, z);
          if (d < best) {
            best = d;
            at = { x, z };
          }
        }
      }
      if (best < 0.3) out.push({ a, b, ...at });
    }
  }
  return out;
}

const cmd = (seq: number, moveX: number, moveZ: number, yaw: number, buttons = 0): InputCommand => ({ seq, moveX, moveZ, yaw, pitch: 0, buttons });

describe("the town's buildings as walls", () => {
  it("lists the solid buildings in a grid of 16 m cells, a handful to a cell", () => {
    for (const seed of WORLD_SEEDS) {
      const solids = townSolids(seed);
      const plan = planFor(seed);
      expect(solids.ids.length).toBe(plan.buildings.filter(solid).length);
      let most = 0;
      for (let c = 0; c < solids.cols * solids.rows; c++) most = Math.max(most, (solids.start[c + 1] as number) - (solids.start[c] as number));
      expect(most).toBeGreaterThan(0);
      expect(most).toBeLessThanOrEqual(12);
      expect(SOLID_CELL).toBe(16);
    }
  });

  it("skips the piers and no other building (a shed on piles stands on its deck and is solid)", () => {
    for (const seed of WORLD_SEEDS) {
      const plan = planFor(seed);
      const ids = new Set(townSolids(seed).ids);
      for (const b of plan.buildings) expect(ids.has(b.id), `${seed} building ${b.id} ${b.kind}`).toBe(b.kind !== "pier");
      // What stands on piles is only the piers and the terminal's and cannery's sheds.
      for (const b of plan.buildings.filter((q) => q.lot === -1)) expect(["pier", "port terminal shed", "cannery"]).toContain(b.kind);
    }
  });

  it("names the nearest building from every position inside it and beside it", () => {
    for (const seed of WORLD_SEEDS) {
      const plan = planFor(seed);
      for (const b of plan.buildings.filter(solid)) {
        const c = centreOf(seed, b);
        expect(solidsNear(seed, c.x, c.z)).toContain(b.id);
        const u = bearingU(b.bearing);
        const v = bearingV(b.bearing);
        // 0.4 m outside each of its four walls' middles.
        for (const [sx, sz] of [
          [u.x * (b.halfAlong + 0.4), u.z * (b.halfAlong + 0.4)],
          [-u.x * (b.halfAlong + 0.4), -u.z * (b.halfAlong + 0.4)],
          [v.x * (b.halfAcross + 0.4), v.z * (b.halfAcross + 0.4)],
          [-v.x * (b.halfAcross + 0.4), -v.z * (b.halfAcross + 0.4)],
        ] as [number, number][]) expect(solidsNear(seed, c.x + sx, c.z + sz)).toContain(b.id);
      }
    }
  });

  it("holds a walker out of every building over thousands of ticks of the engine's own movement, and records how deep it ever went", () => {
    let ticks = 0;
    let worst = 0;
    let contacts = 0;
    let corners = 0;
    let turned = 0;
    for (const seed of WORLD_SEEDS) {
      const world = worldFor(seed);
      const plan = planFor(seed);
      const solids = plan.buildings.filter(solid);
      const rand = stream(seed);
      // The targets: a spread of buildings (turned ones among them), and every corner where two walls meet, up to a few.
      const targets: { x: number; z: number; reach: number }[] = [];
      const picks = solids.filter((_, i) => i % Math.max(1, Math.floor(solids.length / 7)) === 3);
      for (const b of picks) {
        const c = centreOf(seed, b);
        targets.push({ ...c, reach: Math.max(b.halfAlong, b.halfAcross) });
        if (b.bearing.deg !== 0) turned++;
      }
      for (const p of meetingPairs(seed).slice(0, 4)) {
        targets.push({ x: p.x, z: p.z, reach: 2 });
        corners++;
      }
      expect(turned).toBeGreaterThan(0);
      for (const target of targets) {
        for (let k = 0; k < 20; k++) {
          const player = addPlayer(world, WALK_RULES) as Walker;
          const angle = (k / 20) * Math.PI * 2 + rand() * 0.2;
          const radius = target.reach + 3 + rand() * 6;
          player.pos = { x: target.x + Math.sin(angle) * radius, y: 0, z: target.z + Math.cos(angle) * radius };
          player.pos.y = groundOf(world).heightAt(player.pos.x, player.pos.z) + 0.9 + 0.01;
          player.vel = { x: 0, y: 0, z: 0 };
          // Walkers do not start inside a wall (a start inside is a different test).
          const near0 = solidsNear(seed, player.pos.x, player.pos.z).map((id) => plan.buildings[id] as Building);
          if (worstInside(seed, near0, player.pos.x, player.pos.z) > 0) {
            world.state.players.delete(player.id);
            continue;
          }
          const speed = [0.3, 0.6, 1, 1][k % 4] as number;
          const sprint = k % 3 === 0 ? 8 : 0;
          // Faces the target, then wanders a little: forward, with a sideways share that changes now and then.
          let aim = Math.atan2(target.x - player.pos.x, target.z - player.pos.z);
          let side = 0;
          for (let t = 0; t < 240; t++) {
            if (t % 30 === 0) {
              side = (rand() - 0.5) * 1.6;
              aim += (rand() - 0.5) * 0.5;
            }
            const inputs = new Map<number, InputCommand>([[player.id, cmd(t + 1, side * speed, speed, aim, sprint)]]);
            tickPlayers(world, inputs, WALK_RULES);
            ticks++;
            const around = solidsNear(seed, player.pos.x, player.pos.z).map((id) => plan.buildings[id] as Building);
            const inside = worstInside(seed, around, player.pos.x, player.pos.z);
            worst = Math.max(worst, inside);
            let nearest = Infinity;
            for (const b of around) nearest = Math.min(nearest, distanceTo(seed, b, player.pos.x, player.pos.z));
            if (nearest < HULL_RADIUS + 0.01) contacts++;
          }
          world.state.players.delete(player.id);
        }
      }
    }
    console.log(`walkers: ${ticks} ticks, ${contacts} of them at a wall, ${corners} corners and ${turned} turned buildings among the targets, deepest penetration ${worst}`);
    expect(ticks).toBeGreaterThan(5000);
    expect(contacts).toBeGreaterThan(300);
    // The eight fixed passes of two or three walls meeting leave a few micrometres in a corner (2 um over the forty-world run).
    expect(worst).toBeLessThanOrEqual(1e-5);
  });

  it("leaves a walker in the middle of a street exactly as it was, the objects themselves", () => {
    for (const seed of WORLD_SEEDS) {
      const plan = planFor(seed);
      const { anchor } = siteFor(seed);
      let tried = 0;
      for (const s of plan.streets.filter((q) => q.kind === "street" || q.kind === "main" || q.kind === "avenue")) {
        const x = anchor.x + (s.a.x + s.b.x) / 2;
        const z = anchor.z + (s.a.z + s.b.z) / 2;
        const near = solidsNear(seed, x, z).map((id) => plan.buildings[id] as Building);
        if (near.some((b) => distanceTo(seed, b, x, z) < 2)) continue;
        const pos = Object.freeze({ x, y: 3, z });
        const vel = Object.freeze({ x: 2.5, y: 0, z: -1.25 });
        const before = JSON.stringify([pos, vel]);
        townConstrain({ forest: { seed } }, pos, vel);
        expect(JSON.stringify([pos, vel])).toBe(before);
        tried++;
      }
      expect(tried).toBeGreaterThan(6);
    }
  });

  it("takes only the velocity into a wall, so a walker slides along it at its speed along it", () => {
    for (const seed of WORLD_SEEDS) {
      const plan = planFor(seed);
      const turnedOnes = plan.buildings.filter((b) => solid(b) && b.bearing.deg !== 0 && b.halfAlong > 3);
      expect(turnedOnes.length).toBeGreaterThan(0);
      for (const b of turnedOnes.slice(0, 5)) {
        const c = centreOf(seed, b);
        const u = bearingU(b.bearing);
        const v = bearingV(b.bearing);
        // 0.1 m into the hull's reach of the far wall (the +v face), off the middle of it, going into it at 3 and along it at 4.
        const along = 0.3;
        const lv = b.halfAcross + 0.3;
        const near = solidsNear(seed, c.x, c.z).filter((id) => id !== b.id);
        const pos = { x: c.x + u.x * along + v.x * lv, y: 3, z: c.z + u.z * along + v.z * lv };
        // Another wall at this spot would add its own push: pick only a spot the building is alone at.
        if (near.some((id) => distanceTo(seed, plan.buildings[id] as Building, pos.x, pos.z) < HULL_RADIUS + 0.5)) continue;
        const vel = { x: -v.x * 3 + u.x * 4, y: 0, z: -v.z * 3 + u.z * 4 };
        townConstrain({ forest: { seed } }, pos, vel);
        expect((vel.x * u.x + vel.z * u.z)).toBeCloseTo(4, 12);
        expect(vel.x * v.x + vel.z * v.z).toBeCloseTo(0, 12);
        const lvAfter = (pos.x - c.x) * v.x + (pos.z - c.z) * v.z;
        expect(lvAfter).toBeGreaterThanOrEqual(b.halfAcross + HULL_RADIUS);
        expect(lvAfter).toBeLessThan(b.halfAcross + HULL_RADIUS + 1e-5);
        // A walker already moving off the wall keeps all its velocity.
        const away = { x: v.x * 2, y: 0, z: v.z * 2 };
        townConstrain({ forest: { seed } }, { x: pos.x - v.x * 0.01, y: 3, z: pos.z - v.z * 0.01 }, away);
        expect([away.x, away.z]).toEqual([v.x * 2, v.z * 2]);
      }
    }
  });

  it("holds a walker that is pushed along a wall at a slant to the wall's speed along it", () => {
    const seed = WORLD_SEEDS[0] as number;
    const world = worldFor(seed);
    const plan = planFor(seed);
    const b = plan.buildings.find((q) => solid(q) && q.bearing.deg !== 0 && q.halfAcross > 10 && q.halfAlong > 3) as Building;
    expect(b).toBeDefined();
    const c = centreOf(seed, b);
    const u = bearingU(b.bearing);
    const v = bearingV(b.bearing);
    const player = addPlayer(world, WALK_RULES) as Walker;
    // Starts 2 m off the long side (the -u face), walks at 45 degrees into it and along it.
    const startAlong = -(b.halfAlong + 2);
    player.pos = { x: c.x + u.x * startAlong - v.x * (b.halfAcross - 4), y: 0, z: c.z + u.z * startAlong - v.z * (b.halfAcross - 4) };
    player.pos.y = groundOf(world).heightAt(player.pos.x, player.pos.z) + 0.91;
    const dirX = u.x + v.x;
    const dirZ = u.z + v.z;
    const aim = Math.atan2(dirX, dirZ);
    let alongSpeed = 0;
    for (let t = 0; t < 150; t++) {
      tickPlayers(world, new Map([[player.id, cmd(t + 1, 0, 1, aim)]]), WALK_RULES);
      alongSpeed = player.vel.x * v.x + player.vel.z * v.z;
      const lu = (player.pos.x - c.x) * u.x + (player.pos.z - c.z) * u.z;
      expect(lu).toBeLessThanOrEqual(-b.halfAlong - HULL_RADIUS + 1e-9);
    }
    // 5.25 m/s on foot, at 45 degrees to the wall: the share along it is 5.25 / sqrt(2) = 3.71, and it never falls below that (the
    // wall takes the velocity into it and nothing else, so the walker keeps what it has along it).
    expect(alongSpeed).toBeGreaterThan(3.7);
    expect(alongSpeed).toBeLessThanOrEqual(5.25 + 1e-9);
    world.state.players.delete(player.id);
  });

  it("pushes a hull that meets a corner along the line from the corner, and a hull inside out by the nearest side", () => {
    const seed = WORLD_SEEDS[0] as number;
    const b = planFor(seed).buildings.find((q) => solid(q) && q.bearing.deg !== 0) as Building;
    const c = centreOf(seed, b);
    const u = bearingU(b.bearing);
    const v = bearingV(b.bearing);
    // 0.15 m off the +u +v corner on both axes: 0.212 from the corner, inside the hull's radius.
    const cornerU = b.halfAlong;
    const cornerV = b.halfAcross;
    const pos = { x: c.x + u.x * (cornerU + 0.15) + v.x * (cornerV + 0.15), y: 1, z: c.z + u.z * (cornerU + 0.15) + v.z * (cornerV + 0.15) };
    const vel = { x: 0, y: 0, z: 0 };
    townConstrain({ forest: { seed } }, pos, vel);
    const du = (pos.x - c.x) * u.x + (pos.z - c.z) * u.z - cornerU;
    const dv = (pos.x - c.x) * v.x + (pos.z - c.z) * v.z - cornerV;
    expect(Math.sqrt(du * du + dv * dv)).toBeCloseTo(HULL_RADIUS, 5);
    expect(du).toBeCloseTo(dv, 9);
    // Inside, nearer the -u face than any other.
    const inside = { x: c.x - u.x * (b.halfAlong - 0.2), y: 1, z: c.z - u.z * (b.halfAlong - 0.2) };
    townConstrain({ forest: { seed } }, inside, { x: 0, y: 0, z: 0 });
    const lu = (inside.x - c.x) * u.x + (inside.z - c.z) * u.z;
    expect(lu).toBeCloseTo(-b.halfAlong - HULL_RADIUS, 5);
  });

  it("settles a hull pressed into the corner of two buildings, from the open side, whichever way it came", () => {
    let settled = 0;
    for (const seed of WORLD_SEEDS) {
      const plan = planFor(seed);
      for (const p of meetingPairs(seed).slice(0, 8)) {
        // A hull gets near a corner by walking: from a place it stood clear at, a step of a tick (at most 0.15 m at a sprint).
        for (let k = 0; k < 36; k++) {
          const angle = (k / 36) * Math.PI * 2;
          for (const reach of [0.5, 0.7, 1, 1.5]) {
            const clear = { x: p.x + Math.sin(angle) * reach, z: p.z + Math.cos(angle) * reach };
            const near = solidsNear(seed, clear.x, clear.z).map((id) => plan.buildings[id] as Building);
            if (worstInside(seed, near, clear.x, clear.z) > 0) continue;
            for (let j = 0; j < 12; j++) {
              const way = (j / 12) * Math.PI * 2;
              const pos = { x: clear.x + Math.sin(way) * 0.15, y: 2, z: clear.z + Math.cos(way) * 0.15 };
              const vel = { x: Math.sin(way) * 7, y: 0, z: Math.cos(way) * 7 };
              townConstrain({ forest: { seed } }, pos, vel);
              expect(worstInside(seed, near, pos.x, pos.z), `${seed} ${p.a.id},${p.b.id}`).toBeLessThanOrEqual(1e-9);
              settled++;
            }
          }
        }
      }
    }
    expect(settled).toBeGreaterThan(80);
  });

  it("starts the player outside every building, and leaves the start alone", () => {
    for (const seed of WORLD_SEEDS) {
      const start = townStart(seed);
      const plan = planFor(seed);
      for (const b of plan.buildings) expect(distanceTo(seed, b, start.x, start.z), `${seed} building ${b.id}`).toBeGreaterThan(HULL_RADIUS);
      expect(penetration(seed, plan.landmarks.find((l) => l.role === "fbi")?.building as number, start.x, start.z)).toBe(0);
      const pos = Object.freeze({ x: start.x, y: 5, z: start.z });
      const vel = Object.freeze({ x: 0, y: 0, z: 0 });
      townConstrain({ forest: { seed } }, pos, vel);
      expect([pos.x, pos.z]).toEqual([start.x, start.z]);
      // And the spawn the rules find, which searches out from it, is clear as well.
      const world = worldFor(seed);
      const player = addPlayer(world, WALK_RULES);
      const near = solidsNear(seed, player.pos.x, player.pos.z).map((id) => plan.buildings[id] as Building);
      expect(worstInside(seed, near, player.pos.x, player.pos.z)).toBe(0);
      world.state.players.delete(player.id);
    }
  });

  it("gives the same outputs for the same inputs, tick for tick", () => {
    const seed = WORLD_SEEDS[0] as number;
    const plan = planFor(seed);
    const b = plan.buildings.find((q) => solid(q) && q.bearing.deg !== 0) as Building;
    const c = centreOf(seed, b);
    const run = (): string => {
      const world = worldFor(seed);
      const player = addPlayer(world, WALK_RULES) as Walker;
      player.pos = { x: c.x + 9, y: 0, z: c.z - 9 };
      player.pos.y = groundOf(world).heightAt(player.pos.x, player.pos.z) + 0.91;
      const trace: number[] = [];
      for (let t = 0; t < 200; t++) {
        tickPlayers(world, new Map([[player.id, cmd(t + 1, Math.sin(t / 7) * 0.5, 1, Math.atan2(-9, 9) + Math.sin(t / 13))]]), WALK_RULES);
        trace.push(player.pos.x, player.pos.z, player.vel.x, player.vel.z);
      }
      world.state.players.delete(player.id);
      return trace.map((n) => n.toString(16)).join(",") + TICK_DT;
    };
    expect(run()).toBe(run());
  });
});
