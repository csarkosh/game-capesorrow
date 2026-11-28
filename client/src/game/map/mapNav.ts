/**
 * Where the player means to go: the destination (one of the four places, or a waypoint the player placed on the map), the waypoints
 * (at most five are kept as flags), and the route kept up to date to the destination. The destination and the waypoints last for the
 * session; they are kept here, in the module, and no storage holds them. Pure: no canvas and no DOM.
 */
import type { MapData } from "./mapData.js";
import { MAP_WAYPOINT } from "../words.js";
import { advanceRoute, nearRoute, planRoute, type Graph, type Profile, type Route } from "./mapRoute.js";
import type { Waypoint } from "./mapDraw.js";

/** How many waypoints are kept as flags: the newest replaces the oldest. */
export const MAX_WAYPOINTS = 5;
/** How far the player may be from a route before it is made again, metres; and the least time between two makings, seconds. */
export const OFF_ROUTE = 15, REMAKE_EVERY = 1;
/** Within this of the destination the player has arrived, metres. */
export const ARRIVED = 8;

export type Destination = { readonly kind: "place" | "waypoint"; readonly id: number };

export type Nav = {
  /** The world seed the waypoints belong to. */
  seed: number;
  waypoints: Waypoint[];
  dest: Destination | null;
  next: number;
};

export const nav: Nav = { seed: -1, waypoints: [], dest: null, next: 1 };

/** Forgets everything, for a world of this seed (a different world's flags are no use). */
export function resetNav(seed = -1): void {
  nav.seed = seed;
  nav.waypoints = [];
  nav.dest = null;
  nav.next = 1;
}

/** Makes the nav the world `seed`'s own, clearing it if it was another's. */
export function navFor(seed: number): Nav {
  if (nav.seed !== seed) resetNav(seed);
  return nav;
}

export function chooseDestination(kind: "place" | "waypoint", id: number): void {
  nav.dest = { kind, id };
}

export function clearDestination(): void {
  nav.dest = null;
}

/** Puts a flag at a point and makes it the destination; with five already the oldest goes. */
export function placeWaypoint(x: number, z: number): Waypoint {
  const w: Waypoint = { id: nav.next++, x, z };
  nav.waypoints = [...nav.waypoints, w];
  while (nav.waypoints.length > MAX_WAYPOINTS) nav.waypoints = nav.waypoints.slice(1);
  nav.dest = { kind: "waypoint", id: w.id };
  return w;
}

/** Takes a flag away; if it was the destination there is none. */
export function removeWaypoint(id: number): void {
  nav.waypoints = nav.waypoints.filter((w) => w.id !== id);
  if (nav.dest !== null && nav.dest.kind === "waypoint" && nav.dest.id === id) nav.dest = null;
}

/** A copy of what the nav holds, to put back (a double click undoes the flag its first click placed). */
export function saveNav(): Pick<Nav, "waypoints" | "dest"> {
  return { waypoints: nav.waypoints, dest: nav.dest };
}

export function restoreNav(saved: Pick<Nav, "waypoints" | "dest">): void {
  nav.waypoints = saved.waypoints;
  nav.dest = saved.dest;
}

/** The destination as a point and a name, or null for none. */
export function goalOf(data: MapData): { x: number; z: number; name: string } | null {
  const d = nav.dest;
  if (d === null) return null;
  if (d.kind === "place") {
    const p = data.places.find((q) => q.id === d.id);
    return p === undefined ? null : { x: p.x, z: p.z, name: p.name };
  }
  const w = nav.waypoints.find((q) => q.id === d.id);
  return w === undefined ? null : { x: w.x, z: w.z, name: MAP_WAYPOINT };
}

/** A distance as the slim line says it: to 5 m under 100, to 10 m under a kilometre, then in tenths of a kilometre. */
export function formatDistance(m: number): string {
  if (m < 100) return `${Math.max(0, Math.round(m / 5) * 5)} m`;
  if (m < 1000) return `${Math.round(m / 10) * 10} m`;
  return `${(Math.round(m / 100) / 10).toFixed(1)} km`;
}

/** The route to the destination, kept as the player moves. */
export type Tracker = { route: Route | null; key: string; at: number };

export function newTracker(): Tracker {
  return { route: null, key: "", at: -Infinity };
}

/**
 * Brings the route up to date for a player at (`x`, `z`) (the start of a route: a player in a room starts at their building's street door).
 * It is made again at once when the goal or the profile has changed, and when the player is more than `OFF_ROUTE` metres off it (at most once
 * in `REMAKE_EVERY` seconds); otherwise the part already travelled is dropped. `now` is in seconds. Answers the route, or null with no goal.
 */
export function updateTracker(t: Tracker, g: () => Graph, now: number, x: number, z: number, profile: Profile, goal: { x: number; z: number } | null): Route | null {
  if (goal === null) {
    t.route = null;
    t.key = "";
    return null;
  }
  const key = `${goal.x.toFixed(2)},${goal.z.toFixed(2)}|${profile}`;
  const remake = (): void => {
    t.route = planRoute(g(), profile, x, z, goal.x, goal.z);
    t.key = key;
    t.at = now;
  };
  if (t.route === null || t.key !== key) remake();
  else if (nearRoute(t.route, x, z).d > OFF_ROUTE && now - t.at >= REMAKE_EVERY) remake();
  else advanceRoute(t.route, x, z);
  return t.route;
}
