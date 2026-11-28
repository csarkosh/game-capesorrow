import type { GameIdentity } from "@csarkosh/engine/identity";

/**
 * Port Ashton's identity: its name, its word for a session, what a nameless player is called, the
 * prefix of its keys in the browser and its desktop app's token (the game has no desktop app yet).
 *
 * `storage` keeps the game's former name (`capesorrow`) on purpose: players' saved settings in the browser are stored under it.
 * `desktop` is only a token matched in the user agent of a desktop shell, so it carries the new name.
 */
export const PORTASHTON_IDENTITY: GameIdentity = { title: "Something Haunts Port Ashton", session: "case", player: "Detective", storage: "capesorrow", desktop: "PortAshton" };
