import { describe, expect, it } from "vitest";
import { timeLimit } from "@csarkosh/engine/testing/timeLimit";
import { touches, touching } from "../../src/sim/car/knock.js";
import { junctionSigns, signedJunctions } from "../../src/sim/town/junctionSigns.js";
import { KNOCK_BOX, KNOCK_LOSS, KNOCK_RADIUS, KNOCK_REACH, isBoxKind, isKnockableBox, knockGrid, knockablesFor, knockablesOf, type KnockKind, type Knockable } from "../../src/sim/town/knockables.js";
import { carPropSolids, constrainProps, propSolids } from "../../src/sim/town/propSolid.js";
import { constrainCircle } from "../../src/sim/town/solid.js";
import { worldJunctions } from "../../src/game/town/junctionWorld.js";
import { turnedBox } from "../../src/game/town/knocked.js";
import { SHOVE_MARGIN, struckSolids } from "../../src/game/town/struck.js";
import { MeshBuilder } from "../../src/game/town/meshBuilder.js";
import { KNOCK_ALPHA, KNOCK_OVER, KNOCK_UNDER, DOOR_ALPHA, PAINT_RANKS, paintAlpha } from "../../src/game/town/paint.js";
import { propsGeometry } from "../../src/game/town/props/index.js";
import { signGeometry } from "../../src/game/town/signGeometry.js";
import { townGround } from "../../src/game/town/townGeometry.js";
import { CAR_LENGTH, CAR_WIDTH } from "../../src/sim/car/tuning.js";
import { WORLD_SEEDS, planFor, siteFor } from "./world.js";

const seed = WORLD_SEEDS[0] as number;
const plan = planFor(seed);
const { anchor } = siteFor(seed);
const grid = knockablesFor(seed);
const list = grid.list;
const count = (kind: KnockKind): number => list.filter((k) => k.kind === kind).length;

describe("what a car knocks down", () => {
  it("is the junctions' signs, the sidewalk's cans, boxes, sign posts and benches, the carts, drums and pallets, and the mailboxes, each once and in a fixed order", () => {
    const signs = junctionSigns(signedJunctions(plan, anchor.x, anchor.z), anchor.x, anchor.z);
    expect(count("stop")).toBe(signs.filter((s) => s.kind === "stop").length);
    expect(count("stop")).toBeGreaterThan(10);
    expect(count("blades")).toBe(signs.filter((s) => s.kind === "blades").length);
    expect(count("dead end")).toBe(signs.filter((s) => s.kind === "dead end").length);
    expect(count("pavement ends")).toBe(signs.filter((s) => s.kind === "pavement ends").length);
    // The sign that stands on a planter is no post in the ground.
    expect(list.length).toBe(signs.filter((s) => s.kind !== "planter").length + count("trash can") + count("newspaper box") + count("sign post") + count("bench") + count("cart") + count("drum") + count("pallets") + count("mailbox") + count("mailbox cluster"));
    expect(count("bench")).toBe(plan.props.furniture.filter((f) => f.kind === "bench").length);
    expect(count("pallets")).toBe(plan.props.bins.filter((b) => b.kind === "pallets").length);
    expect(count("mailbox cluster")).toBe(plan.props.mailboxes.filter((m) => m.kind === "cluster").length);
    expect(count("bench") + count("pallets") + count("mailbox cluster")).toBeGreaterThan(5);
    expect(count("trash can")).toBe(plan.props.furniture.filter((f) => f.kind === "trash can" && f.state !== 2).length);
    expect(count("newspaper box")).toBe(plan.props.furniture.filter((f) => f.kind === "newspaper box").length);
    expect(count("sign post")).toBe(plan.props.furniture.filter((f) => f.kind === "sign post").length);
    expect(count("cart")).toBe(plan.props.bins.filter((b) => b.kind === "cart").length);
    expect(count("drum")).toBe(plan.props.bins.filter((b) => b.kind === "drum").length);
    expect(count("mailbox")).toBe(plan.props.mailboxes.filter((m) => m.kind === "post").length);
    expect(count("trash can") + count("cart")).toBeGreaterThan(10);
    list.forEach((k, i) => {
      expect(k.id).toBe(i);
      expect(k.box).toBe(isBoxKind(k.kind));
      if (!isBoxKind(k.kind)) {
        expect(k.r).toBe(KNOCK_RADIUS[k.kind]);
        expect([k.hu, k.hv]).toEqual([k.r, k.r]);
      } else {
        // A long one is the box the props' solids hold of it, where they hold one, and a unit vector along it.
        expect(k.r).toBeCloseTo(Math.hypot(k.hu, k.hv), 12);
        expect(Math.hypot(k.ux, k.uz)).toBeCloseTo(1, 9);
        const solid = plan.props.solids.find((b) => b.cx === k.px && b.cz === k.pz);
        if (solid !== undefined) expect([k.ux, k.uz, k.hu, k.hv]).toEqual([solid.ux, solid.uz, solid.hu, solid.hv]);
        else expect([k.hu, k.hv]).toEqual([KNOCK_BOX[k.kind][0] / 2, KNOCK_BOX[k.kind][1] / 2]);
        expect(Math.max(k.hu, k.hv)).toBeLessThan(1.2);
      }
      expect(k.x).toBeCloseTo(anchor.x + k.px, 9);
      expect(k.z).toBeCloseTo(anchor.z + k.pz, 9);
    });
    expect(knockablesOf(plan, anchor)).toEqual(list);
    expect(knockablesFor(seed)).toBe(grid);
  }, timeLimit(120_000));

  it("takes a share of the car's speed under a fifth and under a metre a second more, a post more than a can", () => {
    for (const kind of Object.keys(KNOCK_LOSS) as KnockKind[]) {
      const [share, flat] = KNOCK_LOSS[kind];
      expect(share).toBeGreaterThan(0);
      expect(share).toBeLessThan(0.2);
      expect(flat).toBeGreaterThan(0);
      expect(flat).toBeLessThan(1);
    }
    expect(KNOCK_LOSS.stop[0]).toBeGreaterThan(KNOCK_LOSS["trash can"][0]);
    expect(KNOCK_LOSS.mailbox[0]).toBeGreaterThan(KNOCK_LOSS.cart[0]);
  });

  it("finds by its grid every one a car's body touches, wherever the car stands and however it is turned", () => {
    // The body's furthest corner from its centre, and the widest radius, are inside the grid's reach.
    expect(Math.hypot(CAR_LENGTH / 2, CAR_WIDTH / 2) + Math.max(...list.map((k) => k.r))).toBeLessThan(KNOCK_REACH);
    let state = 12345;
    const next = (): number => {
      state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
      return state / 2 ** 32;
    };
    let found = 0;
    for (let n = 0; n < 4000; n++) {
      // Near a knockable, so the bodies do touch some.
      const near = list[Math.floor(next() * list.length)] as Knockable;
      const x = near.x + (next() - 0.5) * 8;
      const z = near.z + (next() - 0.5) * 8;
      const a = next() * Math.PI * 2;
      const hx = Math.sin(a);
      const hz = Math.cos(a);
      const brute = list.filter((k) => touches(k, x, z, hx, hz)).map((k) => k.id).sort((p, q) => p - q);
      const byGrid: number[] = [];
      touching(grid, x, z, hx, hz, (k) => byGrid.push(k.id));
      expect(byGrid.sort((p, q) => p - q)).toEqual(brute);
      found += brute.length;
    }
    expect(found).toBeGreaterThan(500);
    // Off the grid, nothing.
    touching(grid, grid.x0 - 500, grid.z0 - 500, 0, 1, () => expect.unreachable());
    expect(knockGrid([]).cols).toBe(0);
  }, timeLimit(120_000));

  it("leaves the boxes of the carts, drums, pallets, benches and mailboxes out of the car's solids and in the walker's", () => {
    const all = propSolids(seed);
    const cars = carPropSolids(seed);
    const boxed = plan.props.solids.filter((b) => isKnockableBox(b, list)).length;
    expect(boxed).toBeGreaterThan(5);
    expect(all.rects.length / 6 - cars.rects.length / 6).toBe(boxed);
    // No box of a dumpster or a parked vehicle is one of them; a bench's, a stack of pallets' and a cluster of mailboxes' are.
    for (const b of plan.props.bins) expect(isKnockableBox({ cx: b.x, cz: b.z, ux: 1, uz: 0, hu: 1, hv: 1 }, list)).toBe(b.kind === "cart" || b.kind === "drum" || b.kind === "pallets");
    for (const v of plan.props.vehicles) expect(isKnockableBox({ cx: v.x, cz: v.z, ux: v.hx, uz: v.hz, hu: v.length / 2, hv: v.width / 2 }, list)).toBe(false);
    for (const m of plan.props.mailboxes) expect(isKnockableBox({ cx: m.x, cz: m.z, ux: 1, uz: 0, hu: 1, hv: 1 }, list)).toBe(true);
    for (const f of plan.props.furniture) if (f.kind === "bench") expect(isKnockableBox({ cx: f.x, cz: f.z, ux: 1, uz: 0, hu: 1, hv: 1 }, list)).toBe(true);
    // A walker is still held out of a cart that stands.
    const cart = list.find((k) => k.kind === "cart" && plan.props.solids.some((b) => b.cx === k.px && b.cz === k.pz)) as Knockable;
    const pos = { x: cart.x + 0.05, y: 0, z: cart.z };
    expect(constrainProps(seed, pos, { x: 0, y: 0, z: 0 })).toBe(true);
    expect(Math.hypot(pos.x - cart.x, pos.z - cart.z)).toBeGreaterThan(0.3);
    // A circle the size of a car's is pushed out of it as a walker's is, and is not when it is a car's.
    const asWalker = { x: cart.x + 0.05, y: 0, z: cart.z };
    const asCar = { x: cart.x + 0.05, y: 0, z: cart.z };
    constrainCircle(seed, asWalker, { x: 0, y: 0, z: 0 }, 0.92);
    constrainCircle(seed, asCar, { x: 0, y: 0, z: 0 }, 0.92, true);
    expect(Math.hypot(asWalker.x - cart.x, asWalker.z - cart.z)).toBeGreaterThan(0.9);
    expect(Math.hypot(asCar.x - cart.x, asCar.z - cart.z)).toBeLessThan(Math.hypot(asWalker.x - cart.x, asWalker.z - cart.z) - 0.5);
  }, timeLimit(120_000));
});

describe("what a car knocks down, drawn", () => {
  const g = townGround(seed);
  /** Every vertex of a mesh that is tagged as a thing that falls: its place in plan. */
  const taggedOf = (mesh: MeshBuilder): { x: number; z: number }[] => {
    const a = mesh.finish();
    const out: { x: number; z: number }[] = [];
    for (let v = 0; v < a.positions.length / 3; v++) {
      const alpha = a.colors[v * 4 + 3] as number;
      if (alpha > KNOCK_OVER && alpha < KNOCK_UNDER) out.push({ x: a.positions[v * 3] as number, z: a.positions[v * 3 + 2] as number });
    }
    return out;
  };
  const signs = new MeshBuilder();
  signGeometry(g, undefined as never, () => signs, worldJunctions(g), "full");
  const props = new MeshBuilder();
  const run = propsGeometry(g, { solid: () => props, glass: () => new MeshBuilder(), flat: () => new MeshBuilder() }, "full", () => false);
  while (!run.next().done) {
    /* to the end */
  }
  const tagged = [...taggedOf(signs), ...taggedOf(props)];

  it("tags a thing that falls with an alpha of its own: over a door's leaf's, under every rank of paint's, and whole in a 32-bit float", () => {
    expect(KNOCK_ALPHA).toBeGreaterThan(KNOCK_OVER);
    expect(KNOCK_ALPHA).toBeLessThan(KNOCK_UNDER);
    expect(Math.fround(KNOCK_ALPHA)).toBeGreaterThan(KNOCK_OVER);
    expect(Math.fround(KNOCK_ALPHA)).toBeLessThan(KNOCK_UNDER);
    expect(DOOR_ALPHA).toBeLessThan(KNOCK_OVER);
    expect(paintAlpha(PAINT_RANKS - 1)).toBeGreaterThan(KNOCK_UNDER);
    // As eight bits too, should a colour ever be packed so.
    expect(Math.round(KNOCK_ALPHA * 255) / 255).toBeGreaterThan(KNOCK_OVER);
    expect(Math.round(KNOCK_ALPHA * 255) / 255).toBeLessThan(KNOCK_UNDER);
    expect(Math.round(DOOR_ALPHA * 255) / 255).toBeLessThan(KNOCK_OVER);
  });

  /** The boxes the vertex stage moves vertices by: each knockable's, and each dumpster's and parked vehicle's (which a car shoves), as centre, axis and half extents. */
  type MovedBox = { x: number; z: number; ux: number; uz: number; hu: number; hv: number; knockable: Knockable | null };
  const boxes: MovedBox[] = [
    ...list.map((k): MovedBox => ({ x: k.x, z: k.z, ...turnedBox(k), knockable: k })),
    ...struckSolids(seed).filter((q) => q.kind !== "building").map((q): MovedBox => ({ x: q.x, z: q.z, ux: q.ux, uz: q.uz, hu: q.hu + SHOVE_MARGIN, hv: q.hv + SHOVE_MARGIN, knockable: null })),
  ];
  const inBox = (b: MovedBox, x: number, z: number): boolean => Math.abs((x - b.x) * b.ux + (z - b.z) * b.uz) < b.hu && Math.abs((x - b.x) * b.uz - (z - b.z) * b.ux) < b.hv;
  const near = (b: MovedBox, x: number, z: number): boolean => Math.abs(b.x - x) < 6 && Math.abs(b.z - z) < 6;

  it("lays every tagged vertex inside the box of a thing the vertex stage moves, and seldom inside two", () => {
    expect(tagged.length).toBeGreaterThan(2000);
    let stray = 0;
    let shared = 0;
    for (const v of tagged) {
      let n = 0;
      for (const b of boxes) if (near(b, v.x, v.z) && inBox(b, v.x, v.z)) n++;
      if (n === 0) stray++;
      if (n > 1) shared++;
    }
    expect(stray).toBe(0);
    // A vertex in two boxes moves with whichever is moved first: a cart that stands against a parked car, a can beside a bench.
    expect(shared / tagged.length).toBeLessThan(0.04);
  }, timeLimit(120_000));

  it("draws every knockable: each has tagged vertices of its own within its box", () => {
    let bare = 0;
    for (const b of boxes) {
      if (b.knockable === null) continue;
      if (!tagged.some((v) => near(b, v.x, v.z) && inBox(b, v.x, v.z))) bare++;
    }
    expect(bare).toBe(0);
  }, timeLimit(120_000));

  it("draws every dumpster tagged, so that a car that strikes it can shove it", () => {
    const dumpsters = struckSolids(seed).filter((q) => q.kind === "dumpster");
    expect(dumpsters.length).toBeGreaterThan(0);
    for (const q of dumpsters) expect(tagged.some((v) => Math.abs((v.x - q.x) * q.ux + (v.z - q.z) * q.uz) < q.hu && Math.abs((v.x - q.x) * q.uz - (v.z - q.z) * q.ux) < q.hv)).toBe(true);
  }, timeLimit(120_000));
});

