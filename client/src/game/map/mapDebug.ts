/**
 * What a measuring tool may read of the map (`globalThis.__capeMap`, set while the minimap lives, as `__capeCar` is for the car): what drawing
 * costs, the canvas's size and what the data holds. Every answer is a copy.
 */
import type { MapCounts } from "./mapData.js";

export type MapDebug = {
  /**
   * What drawing costs, milliseconds: the last draw, and the mean and the worst of the last 120 draws that made no paths (a draw that
   * first shows a tile builds its paths, and is counted apart: `pathBuildMs` is what the last such build took, `pathBuilds` how many tiles have been built); the draws in the last second; the operations and tiles of the last draw.
   */
  draw(): { lastMs: number; meanMs: number; worstMs: number; counted: number; pathBuildMs: number; pathBuilds: number; perSecond: number; ops: number; cells: number; draws: number };
  /** The canvas's size in pixels and what it holds in bytes, and whether the large map is up. */
  canvas(): { width: number; height: number; bytes: number; large: boolean };
  /** What the data holds, and how long it took to make, and the street graph's size. */
  data(): { counts: MapCounts; buildMs: number; nodes: number; edges: number; graphMs: number } | null;
  /** The destination and the flags, and the route's length, or null with no route. */
  nav(): { destination: { kind: string; id: number } | null; waypoints: { id: number; x: number; z: number }[]; routeMetres: number | null };
};

export type MapDebugSource = {
  stats(): ReturnType<MapDebug["draw"]>;
  canvas(): { width: number; height: number; large: boolean };
  data(): ReturnType<MapDebug["data"]>;
  nav(): ReturnType<MapDebug["nav"]>;
};

export function mapDebug(source: MapDebugSource): MapDebug {
  return {
    draw: () => ({ ...source.stats() }),
    canvas() {
      const c = source.canvas();
      return { width: c.width, height: c.height, bytes: c.width * c.height * 4, large: c.large };
    },
    data() {
      const d = source.data();
      return d === null ? null : { ...d, counts: { ...d.counts } };
    },
    nav() {
      const n = source.nav();
      return { destination: n.destination === null ? null : { ...n.destination }, waypoints: n.waypoints.map((w) => ({ ...w })), routeMetres: n.routeMetres };
    },
  };
}

/** Puts the handle where a tool looks for it, and returns the way to take it away. */
export function installMapDebug(handle: MapDebug): () => void {
  const g = globalThis as { __capeMap?: MapDebug };
  g.__capeMap = handle;
  return () => {
    if (g.__capeMap === handle) delete g.__capeMap;
  };
}
