/**
 * The shipped files the game is drawn and heard with: the engine's own (the trees, the cliffs, the clutter, the animals,
 * the bark, moss and ground textures, the forest's and the shore's sound) and the game's own, merged (`mergeAssets`) and
 * registered with the engine by name (`assetUrls.ts`). Importing this registers them; the entry does.
 *
 * The game's own are the town's texture layers, `client/assets/textures/town.<layer>.{color,data}.webp`, which
 * `tools/textures/build.py` writes and `game/town/townLayers.ts` lists. Like the engine's, each glob's files are imported
 * with `?url`, so the build fingerprints them, and each is asked for by the name the manifest gives it
 * ("textures/town.brick.color.webp"). Nothing of Day Hike's own is asked for here: no ranger, no car, no sign, no voice, no
 * film.
 */
import { mergeAssets, registerAssets, type AssetAddresses } from "@csarkosh/engine/game/assetUrls";
import { ENGINE_ASSETS } from "@csarkosh/engine/game/engineAssets";

const TEXTURES = import.meta.glob("../assets/textures/*.webp", { query: "?url", import: "default", eager: true }) as Record<string, string>;

/** The folder the glob's keys start with, which is not part of a file's name. */
const ASSETS = "../assets/";

/** The game's own shipped files, by the name the engine's lookups ask for ("textures/<file>"), on a null prototype so no inherited name answers. */
export const CAPE_ASSETS: AssetAddresses = (() => {
  const textures: Record<string, string> = Object.create(null) as Record<string, string>;
  for (const [key, url] of Object.entries(TEXTURES)) {
    if (!key.startsWith(ASSETS)) throw new Error(`import.meta.glob returned an unexpected key "${key}"; expected it to start with "${ASSETS}".`);
    textures[key.slice(ASSETS.length)] = url;
  }
  return { models: Object.create(null) as Record<string, string>, textures, audio: Object.create(null) as Record<string, string>, catalog: {} };
})();

registerAssets(mergeAssets(ENGINE_ASSETS, CAPE_ASSETS));
