/**
 * The car's voice, synthesised: an engine note, tyre noise that changes with the ground, a thud and a door. It is the game's own part of
 * the engine's audio bus (`SoundGame`): made when the browser unlocks audio, joined to the world's bus, so the page's mute, hush and
 * muffle reach it as they reach the rain.
 *
 * The graph (every level is a peak; the oscillators and the noise are at most 1 before their gains):
 *   saw (the note) ---- 0.6 --\
 *   saw (a fifth over, +7 cents) -- 0.3 --+-- low-pass 700 Hz -- engine gain (<= 0.15) --\
 *   looped noise -- band-pass (by surface) -- tyre gain (<= 0.12) ------------------------+-- the world's bus
 *   a thud or a door: noise -- low-pass -- envelope gain (<= 0.3 and 0.16) ---------------/
 * The two saws and the noise start once and run at zero gain until the car is heard. The engine and the tyres together peak at 0.27 of
 * full scale; with a thud and a door on top, 0.73.
 */
import type { SoundGame, SoundHost } from "@csarkosh/engine/game/ambientAudio";
import { TICK_DT } from "@csarkosh/engine/sim/constants";
import { PAVED, type Surface } from "../../sim/car/types.js";

export type CarSoundApi = {
  /** The nearest car as it sounds now (every frame), or null when there is none within earshot. */
  car(s: { speed: number; throttle: number; surface: Surface; distance: number; driven: boolean; /** Sideways, m/s: a slide is heard. */ slip?: number } | null): void;
  /** A hard stop, 0 to 1. */
  thud(strength: number): void;
  /** A door. */
  door(): void;
  /** The voice the last `car(...)` worked out: one record, written in place, for a measuring tool to read. */
  voice(): VoiceRecord;
};

/** The note's pitch (Hz) and the levels of the engine and the tyres, 0 to 1. */
export type VoiceRecord = { hz: number; engine: number; tyres: number };

/** How far a car is heard, metres. */
export const HEARD_WITHIN = 80;
/** The speeds (m/s) at which the gears change: three gears over 0 to 30. */
export const GEAR_SPEEDS: readonly number[] = [10, 20];
export const IDLE_HZ = 40, TOP_HZ = 110, TOP_SPEED = 30;
/** How far into its range the note starts in the second and third gears, 0 to 1. */
const GEAR_START = 0.35;
/** How much a surface lets the tyres be heard, by `Surface`. */
const TYRE_SURFACE: readonly number[] = [0.5, 1, 0.85, 0.9];
/** The tyres' band-pass centre, Hz, by `Surface`: duller on pavement, brighter on gravel. */
const TYRE_HZ: readonly number[] = [700, 1600, 1200, 1000];
/** The speed at which the tyres are as loud as the surface lets them be, m/s. */
const TYRE_FULL = 20;
/** A slide: the sideways speed (m/s) at which the tyres are at their loudest whatever the surface, and the band-pass centre they rise to on each (Hz): a howl on pavement, a hiss of stones on the rest. */
export const SLIDE_FULL = 5;
const SLIDE_HZ: readonly number[] = [1500, 2000, 1500, 1300];

/** How much of a slide the sideways speed is, 0 to 1. */
export function slideShare(slip: number): number {
  const v = Math.abs(slip);
  return Number.isFinite(v) ? Math.min(v / SLIDE_FULL, 1) : 0;
}

/** The tyres' band-pass centre (Hz) on a surface for a share of slide. */
export function tyreHz(surface: Surface, slide: number): number {
  const base = TYRE_HZ[surface] as number;
  return base + ((SLIDE_HZ[surface] as number) - base) * slide;
}

/** The greatest gain of each stage. */
export const ENGINE_PEAK = 0.15, TYRE_PEAK = 0.12, THUD_PEAK = 0.3, DOOR_PEAK = 0.16;
const SAW_LOW = 0.6, SAW_HIGH = 0.3;
/** Every change of a parameter eases over this time constant, seconds. */
const SMOOTH = 0.06;
/** A voice not fed for this long, seconds, is let go to silence (a page that stopped drawing). */
const STALE = 0.4;
const THUD_SECONDS = 0.35, DOOR_SECONDS = 0.14, ATTACK = 0.006;

/** How much of a sound is left at `distance` from the listener, 0 to 1: all of it beside the car, none at `HEARD_WITHIN`. */
export function earshot(distance: number): number {
  return distance >= HEARD_WITHIN ? 0 : (1 - Math.max(distance, 0) / HEARD_WITHIN) ** 2;
}

/**
 * The engine note's pitch (Hz) and the levels of the engine and the tyres, 0 to 1, for a moment of driving. A car with nobody at the wheel
 * (`driven` false) has no engine running; its tyres sound while it rolls. Written into `out` when given (so a frame allocates nothing).
 */
export function carVoice(speed: number, throttle: number, surface: Surface, distance: number, driven = true, out: VoiceRecord = { hz: 0, engine: 0, tyres: 0 }, slip = 0): VoiceRecord {
  const v = Math.abs(speed);
  const gear = v >= (GEAR_SPEEDS[1] as number) ? 2 : v >= (GEAR_SPEEDS[0] as number) ? 1 : 0;
  const lo = gear === 0 ? 0 : (GEAR_SPEEDS[gear - 1] as number);
  const hi = gear === 2 ? TOP_SPEED : (GEAR_SPEEDS[gear] as number);
  const r = Math.min((v - lo) / (hi - lo), 1);
  const f = gear === 0 ? r : GEAR_START + (1 - GEAR_START) * r;
  const hz = IDLE_HZ + (TOP_HZ - IDLE_HZ) * f;
  const near = earshot(distance);
  const load = Math.min(Math.abs(throttle), 1);
  const engine = driven ? (0.3 + 0.7 * load) * (0.6 + 0.4 * f) * near : 0;
  // The tyres roll, and slide: a slide is as loud as the tyres get, on any surface.
  const tyres = Math.min(Math.max(Math.min(v / TYRE_FULL, 1) * (TYRE_SURFACE[surface] as number), slideShare(slip)), 1) * near;
  out.hz = hz;
  out.engine = engine;
  out.tyres = tyres;
  return out;
}

/** What a car was at the last frame that saw it: the tick, its place and its speed. */
export type CarMark = { tick: number; x: number; z: number; speed: number };

/** A fall in speed of more than this in one tick is a hard stop, m/s. */
export const THUD_DROP = 3;
/** Frames further apart than this many ticks are not compared (a tab come back). */
const THUD_GAP = 30;

/**
 * How hard a car hit, 0 to 1, from where it was at the last frame and where it is now; 0 when it did not. The fall in speed must exceed
 * `THUD_DROP` for every tick the frames span. A car that has moved further than its speed could take it was put somewhere (brought back,
 * or corrected by a snapshot), not stopped.
 */
export function thudStrength(prev: CarMark, cur: CarMark): number {
  const ticks = cur.tick - prev.tick;
  if (ticks < 1 || ticks > THUD_GAP) return 0;
  const drop = Math.abs(prev.speed) - Math.abs(cur.speed);
  const over = drop - THUD_DROP * ticks;
  if (over <= 0) return 0;
  const moved = Math.hypot(cur.x - prev.x, cur.z - prev.z);
  if (moved > Math.abs(prev.speed) * ticks * TICK_DT * 1.5 + 2) return 0;
  return Math.min(0.35 + over / 12, 1);
}

type Graph = {
  host: SoundHost;
  nodes: AudioNode[];
  sources: (AudioScheduledSourceNode)[];
  saw: OscillatorNode;
  fifth: OscillatorNode;
  engine: GainNode;
  tyres: GainNode;
  tyreFilter: BiquadFilterNode;
  shots: Set<AudioBufferSourceNode>;
};

/** Eases a parameter to `value`, and on to `rest` if nothing feeds it again within `STALE`. */
function follow(p: AudioParam, now: number, value: number, rest: number | null): void {
  p.cancelScheduledValues(now);
  p.setTargetAtTime(value, now, SMOOTH);
  if (rest !== null) p.setTargetAtTime(rest, now + STALE, SMOOTH);
}

export const carSound: SoundGame<CarSoundApi> = () => {
  let g: Graph | null = null;

  /** One burst of the bus's noise through a low-pass, with a short attack and a fall to nothing. */
  function shot(peak: number, seconds: number, cutoff: number): void {
    if (g === null) return;
    const { host, nodes, shots } = g;
    const ctx = host.ctx;
    const now = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = host.noise;
    const filter = ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = cutoff;
    const env = ctx.createGain();
    env.gain.setValueAtTime(0, now);
    env.gain.linearRampToValueAtTime(peak, now + ATTACK);
    env.gain.linearRampToValueAtTime(0, now + seconds);
    src.connect(filter);
    filter.connect(env);
    env.connect(host.world);
    const mine = [filter, env];
    nodes.push(...mine);
    shots.add(src);
    src.onended = () => {
      shots.delete(src);
      src.disconnect();
      for (const n of mine) {
        n.disconnect();
        const at = nodes.indexOf(n);
        if (at >= 0) nodes.splice(at, 1);
      }
    };
    src.start(now, host.random() * Math.max(host.noise.duration - seconds - 0.1, 0));
    src.stop(now + seconds + 0.02);
  }

  const side = {
    unlocked(host: SoundHost): void {
      const ctx = host.ctx;
      const nodes: AudioNode[] = [];
      const make = <T extends AudioNode>(n: T): T => {
        nodes.push(n);
        return n;
      };
      const saw = make(ctx.createOscillator());
      saw.type = "sawtooth";
      saw.frequency.value = IDLE_HZ;
      const fifth = make(ctx.createOscillator());
      fifth.type = "sawtooth";
      fifth.frequency.value = IDLE_HZ * 1.5;
      fifth.detune.value = 7;
      const mixLow = make(ctx.createGain());
      mixLow.gain.value = SAW_LOW;
      const mixHigh = make(ctx.createGain());
      mixHigh.gain.value = SAW_HIGH;
      const body = make(ctx.createBiquadFilter());
      body.type = "lowpass";
      body.frequency.value = 700;
      body.Q.value = 0.5;
      const engine = make(ctx.createGain());
      engine.gain.value = 0;
      saw.connect(mixLow);
      fifth.connect(mixHigh);
      mixLow.connect(body);
      mixHigh.connect(body);
      body.connect(engine);
      engine.connect(host.world);

      const noise = ctx.createBufferSource();
      noise.buffer = host.noise;
      noise.loop = true;
      make(noise);
      const tyreFilter = make(ctx.createBiquadFilter());
      tyreFilter.type = "bandpass";
      tyreFilter.frequency.value = TYRE_HZ[PAVED] as number;
      tyreFilter.Q.value = 0.7;
      const tyres = make(ctx.createGain());
      tyres.gain.value = 0;
      noise.connect(tyreFilter);
      tyreFilter.connect(tyres);
      tyres.connect(host.world);

      saw.start();
      fifth.start();
      noise.start();
      g = { host, nodes, sources: [saw, fifth, noise], saw, fifth, engine, tyres, tyreFilter, shots: new Set() };
    },
    disposed(): void {
      if (g === null) return;
      const gone = g;
      g = null;
      for (const s of gone.sources) s.stop();
      for (const s of gone.shots) {
        s.onended = null;
        s.stop();
        s.disconnect();
      }
      gone.shots.clear();
      for (const n of gone.nodes) n.disconnect();
    },
  };

  const heard: VoiceRecord = { hz: IDLE_HZ, engine: 0, tyres: 0 };
  const api: CarSoundApi = {
    voice: () => heard,
    car(s) {
      if (s === null) {
        heard.engine = 0;
        heard.tyres = 0;
      } else {
        carVoice(s.speed, s.throttle, s.surface, s.distance, s.driven, heard, s.slip ?? 0);
      }
      if (g === null) return;
      const now = g.host.ctx.currentTime;
      if (s === null) {
        follow(g.engine.gain, now, 0, null);
        follow(g.tyres.gain, now, 0, null);
        return;
      }
      const v = heard;
      follow(g.saw.frequency, now, v.hz, null);
      follow(g.fifth.frequency, now, v.hz * 1.5, null);
      follow(g.engine.gain, now, v.engine * ENGINE_PEAK, 0);
      follow(g.tyres.gain, now, v.tyres * TYRE_PEAK, 0);
      follow(g.tyreFilter.frequency, now, tyreHz(s.surface, slideShare(s.slip ?? 0)), null);
    },
    thud(strength) {
      shot(THUD_PEAK * Math.min(Math.max(strength, 0), 1), THUD_SECONDS, 180);
    },
    door() {
      shot(DOOR_PEAK, DOOR_SECONDS, 400);
    },
  };
  return { side, api };
};
