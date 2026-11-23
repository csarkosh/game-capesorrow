/**
 * The buildings' fronts, rooms, signs and windows, held to the plan: what the builders draw for a unit is what the plan says of it
 * (its openings, its room, its signs' words), no window is a dark rectangle, a room's furnishings stand inside the building, a sign's
 * face lies on its wall, two shops of different trades are not drawn alike, and the arrays are consistent and the same every time.
 */
import { resetLedger } from "../../src/game/town/faceLedger.js";
import "../../src/terrain.js";
import { describe, expect, it } from "vitest";
import { buildingGeometry } from "../../src/game/town/buildingGeometry.js";
import { MeshBuilder } from "../../src/game/town/meshBuilder.js";
import { SignAtlas } from "../../src/game/town/signAtlas.js";
import { lookOf } from "../../src/game/town/signStyle.js";
import { townGeometry, townGround } from "../../src/game/town/townGeometry.js";
import type { FillReport } from "../../src/game/town/townTypes.js";
import type { Building } from "../../src/sim/town/types.js";
import { bearingU, bearingV } from "../../src/sim/town/bearings.js";

/** Twelve seeds of the town's own numbering (the world's seed, as a hash would give). */
const SEEDS = [20261121, 1, 6, 2, 3, 4, 5, 7, 8, 9, 10, 11];

type Built = { solid: MeshBuilder; glass: MeshBuilder; sign: MeshBuilder; report: FillReport; atlas: SignAtlas };
function build(seed: number, b: Building): Built {
  const g = townGround(seed);
  const solid = new MeshBuilder();
  const glass = new MeshBuilder();
  const sign = new MeshBuilder();
  const atlas = new SignAtlas(8192, 8192, 56);
  const report: FillReport = { openings: [], windows: [], rooms: [] };
  const roles = g.plan.landmarks.find((l) => l.building === b.id)?.role ?? null;
  resetLedger();
  buildingGeometry(g, b, roles, () => solid, "full", { glass: () => glass, sign: () => sign, atlas, report });
  return { solid, glass, sign, report, atlas };
}

const shopsOf = (seed: number): Building[] => {
  const plan = townGround(seed).plan;
  return plan.buildings.filter((b) => (plan.uses[b.id]?.units.length ?? 0) > 0 && b.state !== "ruin");
};

describe("a commercial front is drawn from its units", () => {
  it("gives every open unit its openings, glass, room and a sign saying the plan's words (12 seeds)", () => {
    for (const seed of SEEDS) {
      const plan = townGround(seed).plan;
      for (const b of shopsOf(seed).slice(0, 25)) {
        const use = plan.uses[b.id]!;
        const built = build(seed, b);
        for (const u of use.units) {
          // The openings drawn are the plan's, station for station.
          const drawn = built.report.openings.filter((o) => o.unit === u.id);
          expect(drawn.map((o) => [o.s0, o.s1, o.sill, o.head])).toEqual(u.openings.map((o) => [o.s0, o.s1, o.sill, o.head]));
          if (u.state !== "open") continue;
          const room = built.report.rooms.find((r) => r.unit === u.id);
          expect(room, `unit ${u.id} of building ${b.id} (seed ${seed}) has a room`).toBeDefined();
          expect(room!.furnishings).toBe(u.interior.furnishings.length);
          // There is glass for it: a pane for each opening that is not covered, and the door's.
          expect(built.glass.vertices).toBeGreaterThan(0);
          // And the sign: the words of each of its signs are painted (a request names them).
          expect(u.signs.length).toBeGreaterThan(0);
          for (const s of u.signs) {
            const asked = built.atlas.requests.some((r) => r.spec.kind === s.kind && r.spec.lines.length === s.lines.length && r.spec.lines.every((l, k) => l === s.lines[k]));
            expect(asked, `a request says "${s.lines.join(" / ")}"`).toBe(true);
          }
        }
      }
    }
  }, 240_000);

  it("never draws a window as a plain dark rectangle: each has a pane over something, or a cover", () => {
    for (const seed of SEEDS.slice(0, 6)) {
      const plan = townGround(seed).plan;
      for (const b of plan.buildings.slice(0, 120)) {
        if (b.state === "ruin" || b.kind === "pier") continue;
        const built = build(seed, b);
        for (const w of built.report.windows) {
          expect(w.pane || w.behind === "cover").toBe(true);
          expect(["room", "box", "cover"]).toContain(w.behind);
        }
        // Where there is a pane there is glass in the see-through layer.
        if (built.report.windows.some((w) => w.pane)) expect(built.glass.vertices).toBeGreaterThan(0);
      }
    }
  }, 240_000);

  it("keeps each room's furnishings inside its building", () => {
    for (const seed of SEEDS.slice(0, 6)) {
      const plan = townGround(seed).plan;
      for (const b of shopsOf(seed).slice(0, 30)) {
        const use = plan.uses[b.id]!;
        const f = use.frame!;
        const built = build(seed, b);
        for (const r of built.report.rooms) {
          // A hand of tolerance: a counter top overhangs its body by 5 cm, a box turned on a skew has corners past its centre line.
          expect(r.extent.s0).toBeGreaterThan(-0.1);
          expect(r.extent.s1).toBeLessThan(f.width + 0.1);
          expect(r.extent.d0).toBeGreaterThan(-0.1);
          expect(r.extent.d1).toBeLessThan(f.depth + 0.05);
          expect(r.extent.y1 - r.extent.y0).toBeLessThan(6);
        }
      }
    }
  }, 240_000);

  it("lays a sign's face on its building's wall", () => {
    let faces = 0;
    for (const seed of SEEDS.slice(0, 4)) {
      const g = townGround(seed);
      for (const b of shopsOf(seed).slice(0, 40)) {
        const use = g.plan.uses[b.id]!;
        const signs = [...use.units.flatMap((u) => u.signs), ...use.signs];
        // Free-standing signs (a pole, a sandwich board, a board at the lot's edge) are not on a wall.
        if (signs.some((s) => s.place.wall === "sidewalk" || s.place.wall === "lot edge")) continue;
        const built = build(seed, b);
        const u = bearingU(b.bearing);
        const v = bearingV(b.bearing);
        built.sign.forEachPosition(0, (x, y, z) => {
          const dx = x - (g.anchor.x + b.centre.x);
          const dz = z - (g.anchor.z + b.centre.z);
          const a = Math.abs(dx * u.x + dz * u.z) - b.halfAlong;
          const c = Math.abs(dx * v.x + dz * v.z) - b.halfAcross;
          // Within a metre (a blade's bracket) of the footprint's outline, and no deeper in than a recessed door (up to 1.4 m: the hours on its glass).
          expect(Math.max(a, c)).toBeLessThan(1.1);
          expect(Math.max(a, c)).toBeGreaterThan(-1.55);
          expect(Number.isFinite(y)).toBe(true);
          faces++;
        });
      }
    }
    expect(faces).toBeGreaterThan(100);
  }, 240_000);

  it("does not draw two shops of different trades alike", () => {
    let pairs = 0;
    for (const seed of SEEDS.slice(0, 6)) {
      const g = townGround(seed);
      for (const b of shopsOf(seed).slice(0, 60)) {
        const use = g.plan.uses[b.id]!;
        const open = use.units.filter((u) => u.state === "open" && u.tenant !== null);
        if (open.length < 2) continue;
        const built = build(seed, b);
        for (let i = 0; i + 1 < open.length; i++) {
          const a = open[i]!;
          const c = open[i + 1]!;
          if (a.tenant!.trade === c.tenant!.trade) continue;
          const ra = built.report.rooms.find((r) => r.unit === a.id);
          const rc = built.report.rooms.find((r) => r.unit === c.id);
          expect(ra?.hash).not.toBe(rc?.hash);
          pairs++;
        }
      }
    }
    expect(pairs).toBeGreaterThan(5);
  }, 240_000);
});

describe("the whole town's arrays", () => {
  it("are consistent: every attribute has its vertices, every index is in range", () => {
    for (const seed of [20261121, 1]) {
      const g = townGround(seed);
      const gen = townGeometry(g, "full", { x: 0, z: 0 });
      let r = gen.next();
      while (r.done !== true) r = gen.next();
      const layers = new Set<string>();
      for (const batch of r.value) {
        const a = batch.arrays;
        const n = a.positions.length / 3;
        layers.add(batch.layer);
        expect(a.normals.length).toBe(n * 3);
        expect(a.colors.length).toBe(n * 4);
        expect(a.uvs.length).toBe(n * 2);
        expect(a.surface.length).toBe(n * 12);
        expect(a.indices.length % 3).toBe(0);
        let max = 0;
        for (const i of a.indices) max = Math.max(max, i);
        expect(max).toBeLessThan(n);
        for (const arr of [a.positions, a.normals, a.uvs, a.surface]) for (let i = 0; i < arr.length; i += 97) expect(Number.isFinite(arr[i] as number)).toBe(true);
      }
      expect([...layers].sort()).toEqual(["flat", "glass", "sign", "solid"]);
    }
  }, 240_000);

  it("are the same every time", () => {
    const seed = 6;
    const digest = (): number => {
      const gen = townGeometry(townGround(seed), "full", { x: 0, z: 0 });
      let r = gen.next();
      while (r.done !== true) r = gen.next();
      let h = 0x811c9dc5;
      for (const batch of r.value) {
        for (let i = 0; i < batch.arrays.positions.length; i += 13) h = Math.imul(h ^ Math.round((batch.arrays.positions[i] as number) * 100), 0x01000193);
        h = Math.imul(h ^ batch.arrays.indices.length, 0x01000193);
      }
      return h >>> 0;
    };
    expect(digest()).toBe(digest());
  }, 240_000);
});

describe("how a sign is set", () => {
  it("varies the face, weight and case with the sign's own number, and by style", () => {
    const faces = new Set<string>();
    for (let seed = 0; seed < 60; seed++) {
      const l = lookOf({ style: "hand-painted", kind: "fascia", seed, decade: 1930 });
      faces.add(`${l.face}${l.weight}${l.caps ? "C" : "c"}`);
    }
    expect(faces.size).toBeGreaterThan(4);
    const neon = new Set<string>();
    for (let seed = 0; seed < 60; seed++) neon.add(lookOf({ style: "neon and porcelain", kind: "fascia", seed, decade: 1955 }).face);
    expect(neon.has("script")).toBe(true);
  });
});
