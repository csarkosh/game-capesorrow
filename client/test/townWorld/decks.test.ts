import { describe, expect, it } from "vitest";
import { PLAYER_HALF } from "@csarkosh/engine/sim/constants";
import type { InputCommand } from "@csarkosh/engine/sim/core";
import { createForest } from "@csarkosh/engine/sim/forest";
import { addPlayer, tickPlayers } from "@csarkosh/engine/sim/tick";
import { createWalkWorld, WALK_RULES, type WalkWorld, type Walker } from "../../src/sim.js";
import { buildDecks, baseGround, constrainRails, deckTopAt, townDecks, withDecks } from "../../src/sim/town/decks.js";
import { DECK_TOP, FLOAT_TOP } from "../../src/sim/town/levels.js";
import { HULL_RADIUS, penetration, townConstrain } from "../../src/sim/town/solid.js";
import { deckGeometry } from "../../src/game/town/pileGeometry.js";
import { MeshBuilder } from "../../src/game/town/meshBuilder.js";
import { DECK } from "../../src/game/town/palette.js";
import { townGround } from "../../src/game/town/townGeometry.js";
import { trestleTopAt } from "../../src/sim/town/railDeck.js";
import { WORLD_SEEDS, groundOf, planFor, siteFor, worldFor } from "./world.js";

const cmd = (seq: number, moveX: number, moveZ: number, yaw: number, buttons = 0): InputCommand => ({ seq, moveX, moveZ, yaw, pitch: 0, buttons });

const anchor = (seed: number): { x: number; z: number } => siteFor(seed).anchor;

function stream(seed: number): () => number {
  let s = seed | 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A walker put on the ground at (x, z). */
function place(world: WalkWorld, x: number, z: number): Walker {
  const p = addPlayer(world, WALK_RULES) as Walker;
  p.pos = { x, y: groundOf(world).heightAt(x, z) + PLAYER_HALF.y + 0.01, z };
  p.vel = { x: 0, y: 0, z: 0 };
  p.grounded = false;
  return p;
}

describe("the harbour's decks in the plan", () => {
  it("lists aprons, piers, sheds and the wharf, each a rectangle at the deck's height", () => {
    for (const seed of WORLD_SEEDS) {
      const plan = planFor(seed);
      const kinds = new Set(plan.decks.map((d) => d.kind));
      expect(kinds.has("apron")).toBe(true);
      expect(kinds.has("pier")).toBe(true);
      plan.decks.forEach((d, i) => {
        expect(d.id).toBe(i);
        expect(d.halfAlong).toBeGreaterThan(0);
        expect(d.halfAcross).toBeGreaterThan(0);
        expect(Math.hypot(d.axis.x, d.axis.z)).toBeCloseTo(1, 12);
        if (d.kind === "float") expect(d.top).toBe(FLOAT_TOP);
        else if (d.kind !== "gangway") expect(d.top).toBe(DECK_TOP);
        if (d.kind === "gangway") expect(d.top).toBeGreaterThan(d.topEnd);
        else expect(d.topEnd).toBe(d.top);
      });
      // Every pier and shed of the plan has its deck, and the wharf street has one.
      const piers = plan.buildings.filter((b) => b.lot === -1);
      expect(plan.decks.filter((d) => d.building !== null).length).toBe(piers.length);
      expect(plan.decks.filter((d) => d.kind === "wharf").length).toBe(plan.streets.filter((s) => s.kind === "wharf").length);
    }
  });
});

describe("decks as ground", () => {
  it("answers deckTopAt over every deck and nothing over open water, and the wrapped field stands at the deck's top", () => {
    for (const seed of WORLD_SEEDS) {
      const plan = planFor(seed);
      const { anchor } = siteFor(seed);
      const field = groundOf(worldFor(seed));
      const base = baseGround(seed);
      for (const d of plan.decks) {
        for (const [a, b] of [[0, 0], [0.9, 0.9], [-0.9, 0.9], [0.9, -0.9], [-0.9, -0.9]] as const) {
          const x = anchor.x + d.centre.x + d.axis.x * d.halfAlong * a + d.axis.z * d.halfAcross * b;
          const z = anchor.z + d.centre.z + d.axis.z * d.halfAlong * a - d.axis.x * d.halfAcross * b;
          const top = deckTopAt(seed, x, z);
          expect(top).not.toBeNull();
          const t = (a + 1) / 2;
          const want = Math.max(top as number, base.heightAt(x, z));
          expect(top as number).toBeGreaterThanOrEqual(d.top + (d.topEnd - d.top) * t - 1e-9 - Math.abs(d.topEnd - d.top));
          expect(field.heightAt(x, z)).toBe(want);
          const n = { x: 0, y: 0, z: 0 };
          field.normalAt(x, z, n);
          if ((top as number) > base.heightAt(x, z)) {
            expect(n.y).toBeGreaterThan(0.9);
            expect(Math.hypot(n.x, n.y, n.z)).toBeCloseTo(1, 12);
          }
        }
      }
    }
  });

  it("is the engine's field, to the bit, everywhere no deck stands over the point", () => {
    const rand = stream(5);
    for (const seed of WORLD_SEEDS) {
      const { anchor } = siteFor(seed);
      const field = groundOf(worldFor(seed));
      const base = baseGround(seed);
      let off = 0;
      for (let k = 0; k < 3000; k++) {
        const x = anchor.x - 250 + rand() * 500;
        const z = anchor.z - 400 + rand() * 800;
        // Nor a trestle's: the main line's, or the town's own spur's, whose decks are ground too.
        if (deckTopAt(seed, x, z) !== null || trestleTopAt(seed, x, z) !== null) continue;
        off++;
        expect(field.heightAt(x, z)).toBe(base.heightAt(x, z));
        const a = { x: 0, y: 0, z: 0 };
        const b = { x: 0, y: 0, z: 0 };
        field.normalAt(x, z, a);
        base.normalAt(x, z, b);
        expect(a).toEqual(b);
        expect(field.standNormalY?.(x, z)).toBe(base.standNormalY?.(x, z));
        const y = base.heightAt(x, z) + (rand() - 0.5) * 2;
        expect(field.above?.(x, y, z)).toBe(base.above?.(x, y, z));
      }
      expect(off).toBeGreaterThan(2000);
    }
  });

  it("answers `above` over a deck as the point being over both the deck and the ground, exactly", () => {
    const rand = stream(8);
    for (const seed of WORLD_SEEDS) {
      const plan = planFor(seed);
      const { anchor } = siteFor(seed);
      const field = groundOf(worldFor(seed));
      for (const d of plan.decks) {
        for (let k = 0; k < 20; k++) {
          const x = anchor.x + d.centre.x + d.axis.x * d.halfAlong * (rand() * 2 - 1) * 0.9 + d.axis.z * d.halfAcross * (rand() * 2 - 1) * 0.9;
          const z = anchor.z + d.centre.z + d.axis.z * d.halfAlong * (rand() * 2 - 1) * 0.9 - d.axis.x * d.halfAcross * (rand() * 2 - 1) * 0.9;
          const h = field.heightAt(x, z);
          for (const y of [h - 0.5, h - 1e-9, h, h + 1e-9, h + 0.5, h + 3]) expect(field.above?.(x, y, z), `${seed} deck ${d.id}`).toBe(y - h > 0);
        }
      }
    }
  });

  it("is the same field in a host's world and a client's predicted world, and the same twice", () => {
    for (const seed of WORLD_SEEDS) {
      const forest = createForest(seed);
      const host = createWalkWorld(forest, true);
      const client = createWalkWorld(forest, false);
      const plan = planFor(seed);
      const { anchor } = siteFor(seed);
      for (const d of plan.decks) {
        const x = anchor.x + d.centre.x;
        const z = anchor.z + d.centre.z;
        expect(groundOf(host).heightAt(x, z)).toBe(groundOf(client).heightAt(x, z));
      }
      expect(buildDecks(seed)).toEqual(townDecks(seed));
      expect(withDecks(baseGround(seed), seed).heightAt(anchor.x, anchor.z)).toBe(groundOf(host).heightAt(anchor.x, anchor.z));
    }
  });

  it("agrees, to the millimetre, between the plan's list, the walking and the drawn deck tops", () => {
    for (const seed of WORLD_SEEDS) {
      const g = townGround(seed);
      const field = groundOf(worldFor(seed));
      let checked = 0;
      for (const d of g.plan.decks) {
        if (d.kind === "wharf" || d.kind === "apron") continue;
        const builder = new MeshBuilder();
        deckGeometry(g, () => builder, d);
        const a = builder.finish();
        for (let v = 0; v < a.positions.length / 3; v++) {
          if (Math.abs((a.colors[v * 4] as number) - DECK[0]) > 1e-6 || Math.abs((a.colors[v * 4 + 2] as number) - DECK[2]) > 1e-6) continue;
          const x = a.positions[v * 3] as number;
          const y = a.positions[v * 3 + 1] as number;
          const z = a.positions[v * 3 + 2] as number;
          // A corner stands on the deck's very edge, which a float32 position cannot say: look a millimetre in.
          const inX = x + (d.centre.x + anchor(seed).x - x) * 0.0002;
          const inZ = z + (d.centre.z + anchor(seed).z - z) * 0.0002;
          const top = deckTopAt(seed, inX, inZ);
          expect(top, `${seed} deck ${d.id}`).not.toBeNull();
          // The walking stands at the highest deck there: a flat deck's drawn top is exactly it, a float's or gangway's may lie under the deck it overlaps.
          expect(top as number).toBeGreaterThanOrEqual(y - 1e-3);
          if (d.kind === "pier" || d.kind === "shed") expect(Math.abs((top as number) - y)).toBeLessThan(1e-3);
          expect(field.heightAt(inX, inZ)).toBeGreaterThanOrEqual(y - 1e-3);
          checked++;
        }
      }
      expect(checked).toBeGreaterThanOrEqual(20);
    }
  });
});

describe("walking the harbour", () => {
  it("walks from the quay street out along each pier to its end and back, the feet at the deck's height the whole way", () => {
    let walked = 0;
    for (const seed of WORLD_SEEDS) {
      const world = worldFor(seed);
      const plan = planFor(seed);
      const { anchor } = siteFor(seed);
      const seaward = plan.quay.seaward;
      for (const d of plan.decks.filter((q) => q.kind === "pier" && q.building !== null && plan.buildings[q.building]?.state !== "ruin")) {
        // The pier runs along its longer axis, which the quay's seaward direction or a compass line, out from its landward end.
        const alongLong = d.halfAlong >= d.halfAcross;
        const ax = alongLong ? d.axis.x : d.axis.z;
        const az = alongLong ? d.axis.z : -d.axis.x;
        const half = alongLong ? d.halfAlong : d.halfAcross;
        // Out to the sea: the direction with a negative x.
        const sx = ax < 0 ? ax : -ax;
        const sz = ax < 0 ? az : -az;
        void seaward;
        const cx = anchor.x + d.centre.x;
        const cz = anchor.z + d.centre.z;
        const land = { x: cx - sx * (half + 10), z: cz - sz * (half + 10) };
        const player = place(world, land.x, land.z);
        // Is the start on open ground (no building, the street)? A start in a wall is a different test.
        if (penetration(seed, 0, land.x, land.z) > 0) {
          world.state.players.delete(player.id);
          continue;
        }
        const yaw = Math.atan2(sx, sz);
        let t = 0;
        let reachedEnd = false;
        let onDeckTicks = 0;
        const along = (): number => (player.pos.x - cx) * sx + (player.pos.z - cz) * sz;
        for (; t < 3000; t++) {
          const heading = reachedEnd ? yaw + Math.PI : yaw;
          tickPlayers(world, new Map([[player.id, cmd(t + 1, 0, 1, heading)]]), WALK_RULES);
          const top = deckTopAt(seed, player.pos.x, player.pos.z);
          const ground = baseGround(seed).heightAt(player.pos.x, player.pos.z);
          if (top !== null && top > ground + 1 && Math.abs(along()) < half - 1) {
            onDeckTicks++;
            expect(player.pos.y - PLAYER_HALF.y, `${seed} pier ${d.id} tick ${t}`).toBeCloseTo(top, 6);
          }
          if (!reachedEnd && along() >= half - 0.6) reachedEnd = true;
          if (reachedEnd && along() <= -half - 6) break;
        }
        expect(reachedEnd, `${seed} pier ${d.id}: reached its end`).toBe(true);
        expect(along(), `${seed} pier ${d.id}: back on the land`).toBeLessThan(-half - 5);
        expect(onDeckTicks).toBeGreaterThan(60);
        world.state.players.delete(player.id);
        walked++;
      }
    }
    expect(walked).toBeGreaterThanOrEqual(4);
  });

  it("holds a walker at every railed edge, from many angles and speeds, never past it and never below the deck", () => {
    let ticks = 0;
    let contacts = 0;
    for (const seed of WORLD_SEEDS) {
      const world = worldFor(seed);
      const town = townDecks(seed);
      const base = baseGround(seed);
      const rand = stream(seed);
      // Rails of the apron, the piers and the sheds' platforms, a spread of them.
      const pick = town.rails.filter((r) => Math.hypot(r.bx - r.ax, r.bz - r.az) > 3);
      expect(pick.length).toBeGreaterThan(10);
      const stride = Math.max(1, Math.floor(pick.length / 14));
      for (let i = 0; i < pick.length; i += stride) {
        const r = pick[i]!;
        const len = Math.hypot(r.bx - r.ax, r.bz - r.az);
        for (let k = 0; k < 24; k++) {
          const s = 0.15 + rand() * 0.7;
          const ex = r.ax + (r.bx - r.ax) * s;
          const ez = r.az + (r.bz - r.az) * s;
          const back = 2 + rand() * 3;
          const x = ex + r.nx * back;
          const z = ez + r.nz * back;
          const top = deckTopAt(seed, x, z);
          if (top === null || !(top > base.heightAt(x, z) + 0.5)) continue;
          // Not beside a building's wall or another rail's end: the deck's own middle of that edge.
          const player = place(world, x, z);
          if (townDecks(seed).rails.some((o) => o !== r && Math.hypot((o.ax + o.bx) / 2 - ex, (o.az + o.bz) / 2 - ez) < 1.5 && o.deck !== r.deck)) {
            world.state.players.delete(player.id);
            continue;
          }
          // Settle on the deck, then walk toward the edge at an angle off its normal, at a walk, a run or a sprint, with a wander.
          const speed = [0.4, 1, 1, 1][k % 4] as number;
          const sprint = k % 3 === 0 ? 8 : 0;
          const angle = (rand() - 0.5) * 2.6;
          const toward = Math.atan2(-r.nx, -r.nz) + angle;
          for (let t = 0; t < 200; t++) {
            const wander = t % 40 === 20 ? (rand() - 0.5) * 0.8 : 0;
            tickPlayers(world, new Map([[player.id, cmd(t + 1, 0, speed, toward + wander, sprint)]]), WALK_RULES);
            ticks++;
            const px = player.pos.x;
            const pz = player.pos.z;
            const here = deckTopAt(seed, px, pz);
            if (here === null) {
              // Out by an open edge, on to land: never into the sea.
              expect(base.heightAt(px, pz), `${seed} rail ${i} walker ${k} tick ${t}: left the deck over the water`).toBeGreaterThan(DECK_TOP - 1.2);
              break;
            }
            expect(player.pos.y - PLAYER_HALF.y, `${seed} rail ${i} walker ${k} tick ${t}`).toBeGreaterThanOrEqual((here as number) - 1e-6);
            // Inboard of this rail, within its length: the hull's centre is a hull's radius from it.
            const along = ((px - r.ax) * (r.bx - r.ax) + (pz - r.az) * (r.bz - r.az)) / (len * len);
            const side = (px - ex) * r.nx + (pz - ez) * r.nz;
            if (along > 0 && along < 1) {
              expect(side, `${seed} rail ${i} walker ${k} tick ${t}: past the rail`).toBeGreaterThanOrEqual(-1e-9 + (side < 0 ? 0 : 0));
              if (side < HULL_RADIUS + 0.01) contacts++;
            }
          }
          world.state.players.delete(player.id);
        }
      }
    }
    expect(ticks).toBeGreaterThan(3000);
    expect(contacts).toBeGreaterThan(300);
  });

  it("walks from the quay down a gangway to the floats and out along them, the feet at the deck's height the whole way", () => {
    let walked = 0;
    for (const seed of WORLD_SEEDS) {
      const world = worldFor(seed);
      const plan = planFor(seed);
      const { anchor } = siteFor(seed);
      for (const id of plan.harbour.gangways) {
        const g = plan.decks[id]!;
        // From the apron's middle, 3 m in from the gangway's top, along its run to its foot, and on 6 m along the float.
        const dir = g.axis;
        const start = { x: anchor.x + g.centre.x - dir.x * (g.halfAlong + 3), z: anchor.z + g.centre.z - dir.z * (g.halfAlong + 3) };
        const player = place(world, start.x, start.z);
        const yaw = Math.atan2(dir.x, dir.z);
        let onRamp = 0;
        for (let t = 0; t < 420; t++) {
          tickPlayers(world, new Map([[player.id, cmd(t + 1, 0, 1, yaw)]]), WALK_RULES);
          const top = deckTopAt(seed, player.pos.x, player.pos.z);
          const along = (player.pos.x - anchor.x - g.centre.x) * dir.x + (player.pos.z - anchor.z - g.centre.z) * dir.z;
          if (top !== null && Math.abs(along) < g.halfAlong - 0.5) {
            onRamp++;
            expect(player.pos.y - PLAYER_HALF.y, `${seed} gangway ${id} tick ${t}`).toBeCloseTo(top, 6);
          }
        }
        // It ended on a float, at the float's height, held by the float's far rail.
        const end = deckTopAt(seed, player.pos.x, player.pos.z);
        expect(end, `${seed} gangway ${id}: ended on a deck`).not.toBeNull();
        expect(Math.abs((end as number) - 0.4)).toBeLessThan(1e-9);
        expect(player.pos.y - PLAYER_HALF.y).toBeCloseTo(0.4, 6);
        expect(onRamp).toBeGreaterThan(40);
        world.state.players.delete(player.id);
        walked++;
      }
    }
    expect(walked).toBeGreaterThanOrEqual(3);
  });

  it("lets a walker cross freely from the quay on to a deck and back (the apron is no wall)", () => {
    for (const seed of WORLD_SEEDS) {
      const plan = planFor(seed);
      const town = townDecks(seed);
      const { anchor } = siteFor(seed);
      // The apron's inner edge is open: no rail of an apron lies along it.
      for (const d of plan.decks.filter((q) => q.kind === "apron")) {
        const inner = { x: anchor.x + d.centre.x - plan.quay.seaward.x * d.halfAcross, z: anchor.z + d.centre.z - plan.quay.seaward.z * d.halfAcross };
        for (const r of town.rails.filter((q) => q.deck === d.id)) {
          const mx = (r.ax + r.bx) / 2;
          const mz = (r.az + r.bz) / 2;
          // A rail of the apron is on its seaward edge or an end, never on its landward edge.
          const off = (mx - inner.x) * plan.quay.seaward.x + (mz - inner.z) * plan.quay.seaward.z;
          const along = Math.abs((r.bx - r.ax) * -plan.quay.seaward.z + (r.bz - r.az) * plan.quay.seaward.x);
          if (along > 1) expect(off).toBeGreaterThan(d.halfAcross * 2 - 0.6);
        }
      }
    }
  });

  it("stops a walker at a shed standing on a deck, as at any building's wall", () => {
    let stopped = 0;
    for (const seed of WORLD_SEEDS) {
      const world = worldFor(seed);
      const plan = planFor(seed);
      const { anchor } = siteFor(seed);
      for (const shed of plan.buildings.filter((b) => b.lot === -1 && b.kind !== "pier")) {
        const pierDeck = plan.decks.find((d) => d.kind === "pier" && d.building !== null && Math.hypot((plan.buildings[d.building as number] as { centre: { x: number } }).centre.x - shed.centre.x, (plan.buildings[d.building as number] as { centre: { z: number } }).centre.z - shed.centre.z) < 40);
        if (!pierDeck) continue;
        const pier = plan.buildings[pierDeck.building as number]!;
        // Along the pier's line from the pier's far end back toward land: the shed sits at the seaward end.
        const toShedX = shed.centre.x - pier.centre.x;
        const toShedZ = shed.centre.z - pier.centre.z;
        const len = Math.hypot(toShedX, toShedZ);
        const dx = toShedX / len;
        const dz = toShedZ / len;
        const start = { x: anchor.x + pier.centre.x - dx * 6, z: anchor.z + pier.centre.z - dz * 6 };
        const player = place(world, start.x, start.z);
        for (let t = 0; t < 400; t++) {
          tickPlayers(world, new Map([[player.id, cmd(t + 1, 0, 1, Math.atan2(dx, dz))]]), WALK_RULES);
          expect(penetration(seed, shed.id, player.pos.x, player.pos.z), `${seed} shed ${shed.id}`).toBe(0);
        }
        // It ended against the shed, a hull's radius off its wall, and still on the deck.
        const left = penetration(seed, shed.id, player.pos.x + dx * 0.05, player.pos.z + dz * 0.05);
        expect(left + 1e-3).toBeGreaterThan(0);
        expect(deckTopAt(seed, player.pos.x, player.pos.z)).not.toBeNull();
        world.state.players.delete(player.id);
        stopped++;
      }
    }
    expect(stopped).toBeGreaterThanOrEqual(1);
  });

  it("returns constrain's inputs untouched for a walker in a street, and for one on a deck clear of every rail", () => {
    for (const seed of WORLD_SEEDS) {
      const plan = planFor(seed);
      const { anchor } = siteFor(seed);
      for (const s of plan.streets.filter((q) => q.kind === "main" || q.kind === "street").slice(0, 12)) {
        const x = anchor.x + (s.a.x + s.b.x) / 2;
        const z = anchor.z + (s.a.z + s.b.z) / 2;
        const pos = Object.freeze({ x, y: 5, z });
        const vel = Object.freeze({ x: 1, y: 0, z: 2 });
        expect(constrainRails(seed, pos, vel)).toBe(false);
        const p2 = Object.freeze({ x, y: 5, z });
        townConstrain({ forest: { seed } }, p2, vel);
        expect([p2.x, p2.z]).toEqual([x, z]);
      }
      // Mid-deck of the widest pier.
      const wide = plan.decks.filter((d) => d.kind === "pier").sort((a, b) => b.halfAlong * b.halfAcross - a.halfAlong * a.halfAcross)[0]!;
      const pos = Object.freeze({ x: anchor.x + wide.centre.x, y: wide.top + PLAYER_HALF.y, z: anchor.z + wide.centre.z });
      expect(constrainRails(seed, pos, Object.freeze({ x: 3, y: 0, z: 1 }))).toBe(false);
    }
  });
});
