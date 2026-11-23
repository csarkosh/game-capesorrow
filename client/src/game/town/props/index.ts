/**
 * The props, drawn: everything `plan.props` holds, as geometry in the town's cells. Each builder takes the ground and the sinks it draws into (the
 * standing layer and, for glass, the blended one) and the tier. A generator, so the engine's scheduler can slice it between props.
 */
import type { Detail, TownGround } from "../townTypes.js";
import type { MeshBuilder } from "../meshBuilder.js";
import { fenceGeometry } from "./fenceGeometry.js";
import { dropGeometry, poleGeometry, wireGeometry } from "./poleGeometry.js";
import { trailerGeometry } from "./trailerGeometry.js";
import { vehicleGeometry } from "./vehicleGeometry.js";
import { binGeometry, gearGeometry, mailboxGeometry } from "./yardPropGeometry.js";

type Sink = (x: number, z: number) => MeshBuilder;
export type PropSinks = { readonly solid: Sink; readonly glass: Sink; readonly flat: Sink };

export function* propsGeometry(g: TownGround, sinks: PropSinks, detail: Detail, slice: () => boolean): Generator<void, void, void> {
  const p = g.plan.props;
  // The builders name a place in the plan's frame (a prop's own); the cells are the world's.
  const ax = g.anchor.x;
  const az = g.anchor.z;
  const world: PropSinks = { solid: (x, z) => sinks.solid(x + ax, z + az), glass: (x, z) => sinks.glass(x + ax, z + az), flat: (x, z) => sinks.flat(x + ax, z + az) };
  for (const v of p.vehicles) {
    vehicleGeometry(g, world, v, detail);
    if (slice()) yield;
  }
  for (const t of p.trailers) {
    trailerGeometry(g, world, t, detail);
    if (slice()) yield;
  }
  for (const pole of p.poles) {
    const next = pole.next >= 0 ? (p.poles[pole.next] ?? null) : null;
    poleGeometry(g, world.solid, pole, next, detail);
    if (next !== null) wireGeometry(g, world.solid, pole, next, detail);
    if (slice()) yield;
  }
  for (const d of p.drops) dropGeometry(g, world.solid, d, p.poles[d.pole]!, detail);
  yield;
  for (const f of p.fences) {
    fenceGeometry(g, sinks, f, detail);
    if (slice()) yield;
  }
  for (const b of p.bins) binGeometry(g, world.solid, b, detail);
  for (const mb of p.mailboxes) mailboxGeometry(g, world.solid, mb, detail);
  for (const o of p.gear) gearGeometry(g, world.solid, o, detail);
}
