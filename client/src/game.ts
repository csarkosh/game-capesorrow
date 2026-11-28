/**
 * The empty game as the page that runs a session is handed it
 * (`sessionGame.ts`): one definition of a game of nothing. Its world is the
 * engine's coast with the town's ground, its rules are walking and the town's
 * buildings are walls, its renderer is the engine's with the town drawn into it
 * (`game/town/townParts.ts`), its sound's bus is the engine's with no voices of
 * a game's, and its own half of a session does nothing at every point the page
 * calls it but one: before each frame's sync it moves the hour of day (`game/dayClock.ts`). A new game starts from a copy of this and fills in
 * what is its own.
 */
import { createAmbientAudio, type AmbientAudio } from "@csarkosh/engine/game/ambientAudio";
import { carSound, type CarSoundApi } from "./game/car/carSound.js";
import type { NoPartsApi } from "@csarkosh/engine/game/lite/noParts";
import { createLiteRenderer } from "@csarkosh/engine/game/lite/renderer";
import { registerCommands } from "@csarkosh/engine/game/commands";
import type { ModeList } from "@csarkosh/engine/game/modeList";
import type { WorldRenderer } from "@csarkosh/engine/game/rendererTypes";
import type { SessionGame, SessionHost, SessionSide } from "@csarkosh/engine/game/sessionGame";
import { createClientSession, type ClientSession } from "@csarkosh/engine/net/client";
import { createHostSession, type HostSession } from "@csarkosh/engine/net/host";
import yard from "../levels/yard.json" with { type: "json" };
import { CAR_COMMANDS, createCapeSide } from "./game/car/side.js";
import { INSIDE_COMMANDS } from "./game/doors.js";
import { startClock, stepClock } from "./game/dayClock.js";
import { createIndoorWeather } from "./game/insideWeather.js";
import { townParts } from "./game/town/townParts.js";
import { createWalkHud, type WalkHud } from "./hud.js";
import { HAND_COMMANDS } from "./game/hand/handSwitch.js";
import { WATCH_COMMANDS } from "./game/hand/watchCommand.js";
import { MAP_COMMANDS } from "./game/map/mapCommand.js";
import { CAPE_LOOK } from "./look.js";
import { WALK, type WalkSnapshot } from "./net.js";
import { INTERACT_BIT, LAMP_BIT } from "./sim/car/tuning.js";
import { townStart } from "./sim/town/start.js";
import { createWalkWorld, type WalkState, type WalkWorld, type Walker } from "./sim.js";

// The console's own commands, `carhome`, `goin` and `hand`, are the game's: known to the bar and to an address before any world stands.
registerCommands([...CAR_COMMANDS, ...INSIDE_COMMANDS, ...HAND_COMMANDS, ...WATCH_COMMANDS, ...MAP_COMMANDS]);

export type WalkRenderer = WorldRenderer<WalkState> & NoPartsApi;
export type WalkHost = HostSession<WalkWorld, never>;
export type WalkClient = ClientSession<WalkWorld, Walker, WalkState, never>;

/** The one mode the empty game is played in. */
export const WALK_MODES: ModeList = {
  modes: [{ id: "walk", label: "Walk", line: "The world, and whoever is in it with you." }],
  initial: "walk",
  key: "capesorrow.mode",
  restarts: "Picking another mode starts the world again.",
};

/** The session's own half as the page hands it the host (`SessionHost`): the day's clock needs the hour the console set and the one last pushed. */
export type WalkSessionHost = SessionHost<WalkWorld, WalkRenderer, AmbientAudio & CarSoundApi, WalkHud>;

/** The game's own half of a session before it has a clock: nothing, at every point the page calls. */
export const WALK_SIDE: SessionSide<WalkWorld, WalkState, Walker, WalkRenderer, WalkHost, WalkClient> = {
  atRest: () => undefined,
  hostStarted: () => undefined,
  worldIn: () => undefined,
  hears: () => undefined,
  matchStarted: () => undefined,
  dispose: () => undefined,
  beforeTicks: () => undefined,
  command: (sample) => sample,
  beforeSync: () => undefined,
  sound: () => undefined,
  lampOn: () => false,
  afterSync: () => undefined,
  report: () => undefined,
  decided: () => false,
  over: () => false,
  holdsFrame: () => false,
  progress: () => 0,
  matchEnd: () => ({}),
  entities: (state) => state.players.size,
  applyOwnView: () => false,
  buildExtras: () => undefined,
  disposeExtras: () => undefined,
  extrasStand: () => false,
};

/**
 * The game's half of a session: `WALK_SIDE`'s nothing at every point but one. Before each frame's sync it works out the hour of
 * day (`dayClock.ts`: the console's hour plus the world's ticks since it was set) and, when it has moved past the gate from the hour
 * last pushed, pushes it to the renderer (which recomputes the sky). A new world starts the clock again from the console's hour.
 */
export function walkSide(host: WalkSessionHost): SessionSide<WalkWorld, WalkState, Walker, WalkRenderer, WalkHost, WalkClient> {
  let clock = startClock(host.base.hour);
  // The local player in a room has the weather with no rain (`insideWeather.ts`).
  const rain = createIndoorWeather(host);
  const restart = (): void => {
    clock = startClock(host.base.hour);
  };
  return {
    ...WALK_SIDE,
    atRest: restart,
    worldIn: restart,
    beforeSync: (_world, state, localId) => {
      rain.step(state.players.get(localId)?.inside);
      const step = stepClock(clock, host.base.hour, state.tick, host.appliedHour);
      clock = step.clock;
      if (step.push === null) return;
      host.appliedHour = step.push;
      host.renderer.setView(step.push, rain.weather());
    },
  };
}

export const EMPTY_GAME: SessionGame<WalkWorld, WalkState, Walker, WalkRenderer, AmbientAudio & CarSoundApi, WalkHud, WalkHost, WalkClient> = {
  /** A forest world carries a level of its own with no brushes; this is the least the parser takes. */
  level: yard as unknown,
  modes: WALK_MODES,
  actions: { interact: INTERACT_BIT, lamp: LAMP_BIT },
  /** The town's start, on the made ground at the cove (the rules' spawn searches out from the same place). */
  startOf: townStart,
  weatherIsOwn: () => false,
  /** The game's look in the place of the engine's: no strokes, its own palette, weather and exposure (`look.ts`). */
  look: CAPE_LOOK,
  renderer: (canvas, level, forest, options) => createLiteRenderer<WalkState, Walker, NoPartsApi>(canvas, level, forest, options, townParts),
  audio: () => createAmbientAudio(carSound),
  hud: createWalkHud,
  side: (host) => createCapeSide(host, walkSide(host)),
  host: (_level, _seed, clock, o) => createHostSession(WALK, createWalkWorld(o.forest, true), clock, { levelId: o.forest.levelId, hostPeerId: o.hostPeerId }),
  join: (_level, _seed, transport, clock, o) => createClientSession(WALK, createWalkWorld(o.forest, false), transport, clock, { expectedLevelId: o.expectedLevelId }),
};

export type { WalkSnapshot };
