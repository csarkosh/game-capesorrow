/**
 * The sidewalk's furniture and litter, drawn from `plan.props.furniture` and `plan.props.litter` (decided by `sim/town/port/props/street.ts`). All of it is
 * small and solid and cheap: a trash can is an eight-sided drum (a heap of bags on top when it overflows, on its side when knocked over), a newspaper box a
 * box with a window (the door of an empty one swung open), a bench slats on iron ends, a hydrant a drum with a cap and two nozzles, a planter a box of
 * weathered boards with a dead brown tangle or a green weed, a bike rack three loops of pipe, a sign post a leaning pipe with its plate, a pedestal a green box.
 * Litter is 5 to 30 cm: a can on its side, a cup, a flattened box, a bottle, paper, a plastic bag lifted by the wind, a few cigarette ends.
 * The low tier has the furniture and no litter.
 */
import type { MeshBuilder, Rgb, Vec3 } from "../meshBuilder.js";
import type { Detail, TownGround } from "../townTypes.js";
import type { Furniture, Litter } from "../../../sim/town/types.js";
import { P, lbox, lcylY, lcylZ, mixC, placeOn, rnd, tube, type Place } from "./kit.js";

type Sink = (x: number, z: number) => MeshBuilder;

const CAN: readonly Rgb[] = [[0.03, 0.1, 0.05], [0.09, 0.09, 0.1], [0.03, 0.05, 0.1], [0.2, 0.2, 0.2], [0.012, 0.012, 0.015], [0.1, 0.07, 0.04]];
const NEWS: readonly Rgb[] = [[0.03, 0.08, 0.3], [0.3, 0.03, 0.03], [0.4, 0.4, 0.38], [0.03, 0.2, 0.08], [0.45, 0.35, 0.03], [0.1, 0.1, 0.12]];
const HYDRANT: readonly Rgb[] = [[0.4, 0.04, 0.03], [0.5, 0.4, 0.03], [0.4, 0.04, 0.03], [0.45, 0.35, 0.05], [0.08, 0.12, 0.3], [0.3, 0.03, 0.03]];
const WOOD: readonly Rgb[] = [[0.2, 0.14, 0.09], [0.16, 0.12, 0.09], [0.24, 0.2, 0.15], [0.12, 0.1, 0.08], [0.22, 0.12, 0.08], [0.18, 0.16, 0.13]];
const IRON: Rgb = [0.05, 0.05, 0.055];
const POLE: Rgb = [0.32, 0.33, 0.34];

export function furnitureGeometry(g: TownGround, sink: Sink, f: Furniture, detail: Detail): void {
  const low = detail === "low";
  // The low tier keeps what is big and plain: the cans, the benches, the hydrants.
  if (low && f.kind !== "trash can" && f.kind !== "bench" && f.kind !== "hydrant") return;
  const m = sink(f.x, f.z);
  if (low) {
    // One plain solid each: a drum, a seat on a back, a post.
    const pl = placeOn(g, f.x, f.z, f.hx, f.hz, 0.6, 0.6);
    if (f.kind === "bench") lbox(m, pl, -0.3, 0.24, 0.0, 0.9, -0.85, 0.85, WOOD[f.colour % WOOD.length] as Rgb);
    else lcylY(m, pl, 0, 0, 0.0, f.kind === "hydrant" ? 0.7 : 0.85, f.kind === "hydrant" ? 0.12 : 0.25, f.kind === "hydrant" ? 0.12 : 0.25, 5, (f.kind === "hydrant" ? HYDRANT : CAN)[f.colour % 6] as Rgb, null);
    return;
  }
  const r = (n: number): number => rnd(f.seed, n);
  const col = f.colour;
  switch (f.kind) {
    case "trash can": {
      const pl = placeOn(g, f.x, f.z, f.hx, f.hz, 0.6, 0.6);
      const c = CAN[col % CAN.length] as Rgb;
      if (f.state === 2) {
        // Knocked over: the drum on its side, its lid a little way off, what it held in a tongue on the ground.
        lcylZ(m, pl, 0, 0.26, -0.45, 0.4, 0.24, 8, c, mixC(c, [0, 0, 0], 0.3), null);
        lcylY(m, pl, 0.1 + 0.5 * r(1), 0.6, 0.0, 0.03, 0.26, 0.24, 8, mixC(c, [0, 0, 0], 0.3), mixC(c, [0, 0, 0], 0.3));
        lbox(m, pl, 0.4, 0.9, 0.0, 0.08, -0.12, 0.12, [0.02, 0.02, 0.025]);
        return;
      }
      lcylY(m, pl, 0, 0, 0.0, 0.85, 0.25, 0.28, low ? 6 : 8, c, null);
      if (f.state === 1) {
        // Overflowing: a heap of black bags over the rim and a cup or two jammed in it.
        lbox(m, pl, -0.2, 0.2, 0.84, 1.1, -0.18, 0.2, [0.015, 0.015, 0.02]);
        lbox(m, pl, 0.05, 0.3, 0.9, 1.0, -0.1, 0.18, [0.025, 0.025, 0.03]);
        if (!low) lcylY(m, pl, -0.12, 0.2, 0.84, 0.97, 0.035, 0.045, 6, [0.7, 0.7, 0.65], [0.7, 0.7, 0.65]);
      } else lcylY(m, pl, 0, 0, 0.85, 0.89, 0.3, 0.3, low ? 6 : 8, mixC(c, [1, 1, 1], 0.1), mixC(c, [1, 1, 1], 0.12));
      return;
    }
    case "newspaper box": {
      const pl = placeOn(g, f.x, f.z, f.hx, f.hz, 0.45, 0.4);
      const c = NEWS[col % NEWS.length] as Rgb;
      lbox(m, pl, -0.22, 0.22, 0.0, 0.18, -0.19, 0.19, mixC(c, [0.05, 0.05, 0.05], 0.5));
      lbox(m, pl, -0.2, 0.2, 0.18, 1.0, -0.18, 0.18, c);
      // The window and the coin slot: a dark glass, the door's frame.
      if (f.state === 1) {
        // Empty with its door hanging open: the dark inside, the door out on its hinge.
        lbox(m, pl, 0.24, 0.28, 0.5, 0.88, -0.14, 0.14, [0.01, 0.01, 0.012]);
        lbox(m, pl, 0.28, 0.5, 0.5, 0.88, 0.14, 0.18, c);
      } else lbox(m, pl, 0.24, 0.27, 0.5, 0.88, -0.14, 0.14, [0.03, 0.035, 0.04]);
      return;
    }
    case "bench": {
      const pl = placeOn(g, f.x, f.z, f.hx, f.hz, 1.7, 0.6);
      const w = WOOD[col % WOOD.length] as Rgb;
      for (const z of [-0.72, 0.72]) lbox(m, pl, -0.2, 0.2, 0.0, 0.4, z - 0.035, z + 0.035, IRON);
      // The seat and the back: a plank each, the back set behind the seat's edge, with two iron uprights between.
      lbox(m, pl, -0.24, 0.24, 0.4, 0.45, -0.85, 0.85, w);
      lbox(m, pl, -0.34, -0.3, 0.55, 0.85, -0.85, 0.85, mixC(w, [0, 0, 0], 0.15));
      for (const z of [-0.72, 0.72]) lbox(m, pl, -0.34, -0.3, 0.45, 0.55, z - 0.035, z + 0.035, IRON);
      return;
    }
    case "hydrant": {
      const pl = placeOn(g, f.x, f.z, f.hx, f.hz, 0.45, 0.45);
      const c = HYDRANT[col % HYDRANT.length] as Rgb;
      lcylY(m, pl, 0, 0, 0.0, 0.1, 0.16, 0.16, 8, mixC(c, [0, 0, 0], 0.5), null);
      lcylY(m, pl, 0, 0, 0.1, 0.62, 0.12, 0.1, 8, c, null);
      lcylY(m, pl, 0, 0, 0.62, 0.72, 0.14, 0.04, 8, c, c);
      lcylZ(m, pl, 0, 0.4, -0.24, 0.24, 0.06, 6, c, mixC(c, [0, 0, 0], 0.3), mixC(c, [0, 0, 0], 0.3));
      return;
    }
    case "planter": {
      const pl = placeOn(g, f.x, f.z, f.hx, f.hz, 0.8, 0.5);
      const w = mixC(WOOD[col % WOOD.length] as Rgb, [0.3, 0.3, 0.28], r(2) * 0.6);
      lbox(m, pl, -0.4, 0.4, 0.0, 0.5, -0.25, 0.25, w, [0.05, 0.035, 0.025]);
      if (low) return;
      if (f.state === 1) {
        // Dead: a brown tangle of stalks over the soil.
        for (let k = 0; k < 6; k++) {
          const a = -0.32 + 0.128 * k;
          const z = -0.12 + 0.24 * r(10 + k);
          lbox(m, pl, a - 0.008, a + 0.008, 0.5, 0.62 + 0.3 * r(20 + k), z - 0.008, z + 0.008, [0.2, 0.13, 0.06]);
        }
      } else {
        // Gone to weed: a green mass, a thistle's spike.
        lbox(m, pl, -0.28, 0.28, 0.5, 0.64, -0.17, 0.17, [0.06, 0.14, 0.03]);
        lbox(m, pl, 0.09, 0.11, 0.64, 0.9, -0.01, 0.01, [0.08, 0.2, 0.05]);
      }
      return;
    }
    case "bike rack": {
      const pl = placeOn(g, f.x, f.z, f.hx, f.hz, 1.3, 0.4);
      for (const a of [-0.45, 0, 0.45]) {
        lbox(m, pl, a - 0.015, a + 0.015, 0.0, 0.8, -0.165, -0.135, [0.3, 0.3, 0.32]);
        lbox(m, pl, a - 0.015, a + 0.015, 0.0, 0.8, 0.135, 0.165, [0.3, 0.3, 0.32]);
        lbox(m, pl, a - 0.015, a + 0.015, 0.77, 0.8, -0.135, 0.135, [0.3, 0.3, 0.32]);
      }
      return;
    }
    case "sign post": {
      const pl = placeOn(g, f.x, f.z, f.hx, f.hz, 0.25, 0.25);
      const lean = f.lean * 2.4;
      tube(m, [P(pl, 0, 0, 0), P(pl, 0, 1.2, lean * 0.5), P(pl, 0, 2.4, lean)], 0.03, POLE, 4);
      const plate: Rgb = f.state === 1 ? [0.5, 0.5, 0.48] : f.state === 2 ? [0.5, 0.5, 0.48] : [0.04, 0.2, 0.08];
      lbox(m, pl, 0.04, 0.07, 1.75, 2.35, lean * 0.8 - 0.22 + 0.0, lean * 0.8 + 0.22, plate);
      if (!low) lbox(m, pl, 0.1, 0.105, 2.2, 2.28, lean * 0.8 - 0.14, lean * 0.8 + 0.14, f.state === 2 ? [0.5, 0.03, 0.03] : [0.5, 0.5, 0.48]);
      return;
    }
    case "pedestal": {
      const pl = placeOn(g, f.x, f.z, f.hx, f.hz, 0.55, 0.45);
      lbox(m, pl, -0.25, 0.25, 0.0, 0.95, -0.2, 0.2, [0.04, 0.15, 0.07], [0.05, 0.17, 0.08]);
      lbox(m, pl, 0.25, 0.27, 0.35, 0.7, -0.12, 0.12, [0.02, 0.03, 0.025]);
      return;
    }
  }
}

export function litterGeometry(g: TownGround, sink: Sink, l: Litter): void {
  const m = sink(l.x, l.z);
  const pl: Place = placeOn(g, l.x, l.z, l.hx, l.hz, 0.3, 0.3, 0.06);
  const r = (n: number): number => rnd(l.seed, n);
  switch (l.kind) {
    case "can": {
      // A crushed can on its side: six sides, silver, a red or blue wash on some.
      const c: Rgb = r(1) < 0.4 ? [0.5, 0.05, 0.04] : r(1) < 0.7 ? [0.05, 0.1, 0.4] : [0.55, 0.55, 0.57];
      lcylZ(m, pl, 0, 0.035, -0.06, 0.06, 0.035, 6, c, [0.5, 0.5, 0.5], [0.5, 0.5, 0.5]);
      return;
    }
    case "cup": {
      const c: Rgb = r(2) < 0.5 ? [0.6, 0.6, 0.56] : [0.5, 0.04, 0.03];
      if (r(3) < 0.5) lcylY(m, pl, 0, 0, 0.0, 0.11, 0.032, 0.045, 7, c, [0.2, 0.2, 0.2]);
      else lcylZ(m, pl, 0, 0.04, -0.06, 0.06, 0.04, 7, c, [0.2, 0.2, 0.2], null);
      return;
    }
    case "box": {
      // A flattened carton, a corner lifted.
      lbox(m, pl, -0.18, 0.18, 0.0, 0.025, -0.13, 0.13, [0.28, 0.2, 0.1], [0.32, 0.23, 0.12]);
      lbox(m, pl, 0.06, 0.2, 0.025, 0.045, -0.1, 0.0, [0.26, 0.19, 0.09], [0.3, 0.22, 0.11]);
      return;
    }
    case "bottle": {
      const c: Rgb = r(4) < 0.5 ? [0.05, 0.15, 0.05] : [0.18, 0.1, 0.03];
      lcylZ(m, pl, 0, 0.03, -0.1, 0.07, 0.03, 6, c, c, c);
      lcylZ(m, pl, 0, 0.03, 0.07, 0.13, 0.015, 5, c, c, null);
      return;
    }
    case "paper": {
      // A wad: three tilted sheets in a heap.
      lbox(m, pl, -0.08, 0.08, 0.0, 0.07, -0.07, 0.07, [0.6, 0.6, 0.56], [0.65, 0.65, 0.6]);
      lbox(m, pl, 0.02, 0.14, 0.0, 0.04, -0.1, 0.0, [0.55, 0.55, 0.5], [0.6, 0.6, 0.55]);
      return;
    }
    case "bag": {
      // A plastic bag lifted by the wind: a ruffled pale sheet standing up on one edge, and its handles.
      const c: Rgb = r(5) < 0.5 ? [0.6, 0.6, 0.58] : [0.1, 0.1, 0.12];
      const a: Vec3[] = [P(pl, -0.1, 0.0, -0.08), P(pl, 0.1, 0.0, 0.06), P(pl, 0.06, 0.28, 0.0), P(pl, -0.12, 0.2, -0.1)];
      const n: Vec3 = [pl.lx, 0.2, pl.lz];
      m.poly(a, n, c);
      m.poly([a[3] as Vec3, a[2] as Vec3, a[1] as Vec3, a[0] as Vec3], [-n[0], -0.2, -n[2]], mixC(c, [0, 0, 0], 0.2));
      lbox(m, pl, -0.05, 0.12, 0.0, 0.05, 0.02, 0.18, c);
      return;
    }
    case "butt": {
      for (let k = 0; k < 3; k++) lcylZ(m, pl, -0.06 + 0.06 * k, 0.008, -0.025 - 0.01 * r(10 + k), 0.025, 0.008, 4, [0.7, 0.66, 0.55], [0.8, 0.78, 0.7], null);
      return;
    }
  }
}
