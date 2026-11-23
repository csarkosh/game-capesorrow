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
  for (const v of p.vehicles) {
    vehicleGeometry(g, sinks, v, detail);
    if (slice()) yield;
  }
  for (const t of p.trailers) {
    trailerGeometry(g, sinks, t, detail);
    if (slice()) yield;
  }
  for (const pole of p.poles) {
    const next = pole.next >= 0 ? (p.poles[pole.next] ?? null) : null;
    poleGeometry(g, sinks.solid, pole, next, detail);
    if (next !== null) wireGeometry(g, sinks.solid, pole, next, detail);
    if (slice()) yield;
  }
  for (const d of p.drops) dropGeometry(g, sinks.solid, d, p.poles[d.pole]!, detail);
  yield;
  for (const f of p.fences) {
    fenceGeometry(g, sinks, f, detail);
    if (slice()) yield;
  }
  for (const b of p.bins) binGeometry(g, sinks.solid, b, detail);
  for (const mb of p.mailboxes) mailboxGeometry(g, sinks.solid, mb, detail);
  for (const o of p.gear) gearGeometry(g, sinks.solid, o, detail);
}
