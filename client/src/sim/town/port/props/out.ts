/** What the props stage has made so far, with the ids and the solids, and the one way a prop is put down. */
import { boxAt, boxInside, type Box } from "./boxes.js";
import type { Bin, BoatTrailer, Drop, Fence, Gear, Mailbox, Pole, Vehicle } from "../../types.js";
import type { Context, LotInfo } from "./context.js";

export class Out {
  vehicles: Vehicle[] = [];
  trailers: BoatTrailer[] = [];
  poles: Pole[] = [];
  drops: Drop[] = [];
  fences: Fence[] = [];
  bins: Bin[] = [];
  mailboxes: Mailbox[] = [];
  gear: Gear[] = [];
  solids: Box[] = [];
  private ids = 0;
  id(): number {
    return this.ids++;
  }
}

/**
 * Puts a box down if it is free: inside the lot's polygon (when a lot is given), clear of everything placed by `margin`. Adds it to the
 * grid under `tag` and, when `solid`, to the solids a walker is held out of. Returns whether it was put down.
 */
export function put(ctx: Context, out: Out, box: Box, tag: string, opts: { lot?: LotInfo | null; margin?: number; inset?: number; solid?: boolean } = {}): boolean {
  const lot = opts.lot ?? null;
  if (lot !== null && !boxInside(box, lot.poly, opts.inset ?? 0.35)) return false;
  if (ctx.occ.hits(box, opts.margin ?? 0.5)) return false;
  ctx.occ.add(box, tag);
  if (opts.solid !== false) out.solids.push(box);
  return true;
}

export { boxAt };
