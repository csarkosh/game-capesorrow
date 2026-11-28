/**
 * Whether the room the local player is in is drawn: the one thing the renderer's part (`town/insideParts.ts`) tells the session's side (`car/side.ts`, by
 * `doors.ts`'s `darkFor`). A room whose design has its own textures is built only once they have loaded (`insideParts.ts`), on a connection that may be
 * slow, and the screen must stay dark until then: the player's phase says only that they are inside. `insideParts` writes it each frame; the side reads it.
 *
 * It starts true, which is what a game with no renderer's part (a test, a server) means: nothing there is waiting to be drawn. A part sets it false
 * while it has a room to build and true when the room is built or has been let go, and true again when the part goes.
 */
let drawn = true;

/** Whether the room the local player is in is drawn (true too when they are in no room, or when nothing draws rooms). */
export function roomDrawn(): boolean {
  return drawn;
}

/** The renderer's part says whether the room is drawn. */
export function setRoomDrawn(value: boolean): void {
  drawn = value;
}
