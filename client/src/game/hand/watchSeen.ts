/**
 * The watch on the player's left wrist, as one record the screen shares: the renderer writes where the watch's screen is each frame (`hand/`), and the map draws
 * itself onto that place (`map/`). Like the torch's switch (`handSwitch.ts`) it is the screen's own and not on the wire: another player's screen never draws it.
 *
 * `on` is the switch (G, or the page's map button). `shown` and `raised` say how much of the arm is up this frame. `quad` is where the watch's lit screen is in
 * the view: its four corners, x across the view from the left (0 to 1) and y down it from the top (0 to 1), in the order top left, top right, bottom right,
 * bottom left as the wearer reads the face. It is only meaningful while `shown`.
 */
export type WatchSeen = {
  on: boolean;
  shown: boolean;
  raised: number;
  quad: Float32Array;
};

export const WATCH_SEEN: WatchSeen = { on: false, shown: false, raised: 0, quad: new Float32Array(8) };

/** Flips the watch's switch (the page's map button calls this too). */
export function toggleWatch(): void {
  WATCH_SEEN.on = !WATCH_SEEN.on;
}

/** Puts the watch back down, for when a session ends. */
export function resetWatch(): void {
  WATCH_SEEN.on = false;
  WATCH_SEEN.shown = false;
  WATCH_SEEN.raised = 0;
}
