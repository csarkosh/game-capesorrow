import type { GameIdentity } from "@csarkosh/engine/identity";

/**
 * Cape Sorrow's identity: its name, its word for a session, what a nameless player is called, the
 * prefix of its keys in the browser and its desktop app's token (the game has no desktop app yet).
 */
export const CAPE_IDENTITY: GameIdentity = { title: "Cape Sorrow", session: "case", player: "Detective", storage: "capesorrow", desktop: "CapeSorrow" };
