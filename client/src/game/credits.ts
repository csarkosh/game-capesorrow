/**
 * The credits the Credits screen and the page for those turned away show: the game's own, the
 * repository's CREDITS.md imported at build time (none yet: the game has no third-party work of
 * its own), and the engine's (`ENGINE_CREDITS`, the `CREDITS.md` of the package), the works the
 * engine ships. The two lists are merged in the order of their ids, a stable sort by plain
 * comparison of the ids; then the display pass (`creditsRows`) runs over the whole.
 */
import credits from "../../../CREDITS.md?raw";
import { creditsModel, creditsRows, type CreditEntry } from "@csarkosh/engine/game/credits";
import { ENGINE_CREDITS } from "@csarkosh/engine/game/engineCredits";

/** Two credits files' text as the one list the screen shows. */
export function mergeCredits(own: string, engine: string): CreditEntry[] {
  const merged = [...creditsModel(own), ...creditsModel(engine)];
  return creditsRows(merged.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)));
}

export function creditsEntries(): CreditEntry[] {
  return mergeCredits(credits, ENGINE_CREDITS);
}
