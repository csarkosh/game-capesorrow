/**
 * The map's stylesheet. The buttons carry the same cold cast the engine's roster and pause menu and the title page draw theirs in; those
 * tokens are repeated in each place on purpose (each owns its one style text), so they are repeated here.
 *
 * The last rules lean on the engine's pause menu: while the large map is up the container is marked `capemap-open`, and the menu
 * (`.pausemenu`, a flex box that centres its `.panel`) is given room on the left, so that its panel is beside the map and not under it.
 * `client/test/map/screen.test.ts` reads the engine's source and fails if those two class names are gone.
 */
import { PARTY_CSS } from "./partyLook.js";

export const CSS = `
.capemap {
  --btn-sheen: linear-gradient(rgba(226, 236, 236, 0.16), rgba(198, 222, 222, 0));
  --btn-fill: rgba(198, 222, 222, 0.10);
  --btn-fill-lit: rgba(214, 234, 234, 0.20);
  --btn-fill-hit: rgba(230, 244, 244, 0.32);
  --btn-edge: rgba(198, 222, 222, 0.30);
  --btn-edge-lit: rgba(214, 234, 234, 0.58);
  --btn-rim: inset 0 1px 0 rgba(226, 236, 236, 0.30);
  position: absolute; z-index: 16; box-sizing: border-box; overflow: hidden;
  border-radius: 14px; border: 1px solid rgba(255, 255, 255, 0.06);
  box-shadow: 0 2px 10px rgba(0, 0, 0, 0.22);
  pointer-events: none; font-family: ui-monospace, monospace; color: #eaf1f1;
  transition: left 250ms ease, top 250ms ease, width 250ms ease, height 250ms ease, border-radius 250ms ease;
}
.capemap canvas { display: block; width: 100%; height: 100%; touch-action: none; user-select: none; -webkit-user-select: none; opacity: 1; transition: opacity 400ms ease; }
/* The corner screen in a car: at rest, quiet and see-through; with a destination or a waypoint it comes up (the class active on the canvas). The bezel and the mount are not dimmed. */
.capemap.corner canvas { opacity: 0.5; }
.capemap.corner canvas.active { opacity: 0.9; }
/* The watch's screen: a round lit face, laid on the 3D watch by a matrix each frame; no border or shadow of its own (the watch is its frame), no easing. */
.capemap.watch, .capemap.watch.active { border: none; box-shadow: none; border-radius: 0; transition: none; transform-origin: 0 0; clip-path: circle(50%); will-change: transform; }
.capemap.tappable { pointer-events: auto; cursor: pointer; }
.capemap.paused { z-index: 19; pointer-events: auto; border-radius: 10px; cursor: grab; border-color: rgba(60, 64, 67, 0.35); box-shadow: 0 2px 12px rgba(0, 0, 0, 0.35); }
.capemap.paused.dragging { cursor: grabbing; }
.capemap .ui { display: none; position: absolute; inset: 0; pointer-events: none; }
.capemap.paused .ui { display: block; }
.capemap .places {
  position: absolute; left: 10px; top: 38px; max-width: min(15rem, 60%); max-height: calc(100% - 60px); overflow-y: auto;
  display: flex; flex-direction: column; gap: 0.3rem; padding: 0.5rem; pointer-events: auto;
  background: rgba(12, 14, 18, 0.95); border: 1px solid var(--btn-edge); border-radius: 8px; box-sizing: border-box;
}
.capemap .places h2 { margin: 0 0 0.15rem; font-size: 0.7rem; font-weight: 600; letter-spacing: 0.12em; text-transform: uppercase; color: rgba(234, 241, 241, 0.7); }
.capemap .tools { position: absolute; right: 10px; bottom: 10px; display: flex; gap: 0.35rem; pointer-events: none; flex-wrap: wrap; justify-content: flex-end; max-width: calc(100% - 20px); }
.capemap button {
  font: inherit; font-size: 0.78rem; cursor: pointer; pointer-events: auto; padding: 0.4rem 0.7rem; color: #eaf1f1;
  letter-spacing: 0.08em; text-transform: uppercase; text-align: left;
  background-image: var(--btn-sheen); background-color: rgba(12, 14, 18, 0.84); border: 1px solid var(--btn-edge); border-radius: 4px;
  box-shadow: var(--btn-rim); transition: background-color 160ms ease-out, border-color 160ms ease-out;
}
.capemap button:hover { background-color: rgba(40, 48, 56, 0.92); border-color: var(--btn-edge-lit); }
.capemap button:active { background-color: rgba(60, 72, 82, 0.95); }
.capemap button:focus-visible { outline: 2px solid var(--btn-edge-lit); outline-offset: 2px; }
.capemap .tools button { min-width: 2.2rem; text-align: center; }
.capemap .places button { display: grid; grid-template-columns: 1fr auto; column-gap: 0.6rem; width: 100%; letter-spacing: 0.04em; text-transform: none; }
.capemap .places button.chosen { border-color: var(--btn-edge-lit); background-color: rgba(60, 72, 82, 0.9); }
.capemap .places .name { font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.capemap .places .dist { opacity: 0.8; }
.capemap .places .kind { grid-column: 1 / span 2; font-size: 0.66rem; opacity: 0.6; letter-spacing: 0.1em; text-transform: uppercase; }
.capemap-open .pausemenu.open { box-sizing: border-box; padding-right: 60%; }
@media (max-width: 719px) {
  .capemap-open .pausemenu.open { padding-right: 0; padding-top: 56vh; }
  .capemap .places { max-width: 11rem; padding: 0.35rem; }
}
@media (prefers-reduced-motion: reduce) { .capemap { transition: none; } }
/* The corner screen in a car is a navigation unit stuck to the dash: a dark moulded bezel (thicker at the bottom) round the screen, a power light and flush buttons on it, and a mount behind. No lettering. */
.capemap.corner { border: none; border-radius: 6px; box-shadow: none; animation: cape-swing-in 250ms ease-out; }
.capemap.corner::after { content: ""; position: absolute; inset: 0; border-radius: inherit; pointer-events: none; box-shadow: inset 0 0 0 1px rgba(0, 0, 0, 0.9), inset 0 2px 8px rgba(0, 0, 0, 0.45); }
.capemap.corner.leaving, .capedash.leaving { animation: cape-swing-out 250ms ease-in forwards; }
.capedash { position: absolute; z-index: 15; pointer-events: none; box-sizing: border-box; animation: cape-swing-in 250ms ease-out; }
.capedash .bezel {
  position: absolute; left: 0; top: 0; right: 0; height: calc(var(--s) + 22px); border-radius: 14px 14px 12px 12px;
  background: linear-gradient(#2d2f33, #1b1c1f 40%, #141517);
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.16), inset 0 -1px 0 rgba(0, 0, 0, 0.6), 0 3px 10px rgba(0, 0, 0, 0.45);
}
.capedash .stalk { position: absolute; left: calc(50% - 8px); top: calc(var(--s) + 18px); width: 16px; height: 16px; border-radius: 4px; background: linear-gradient(90deg, #17181a, #2a2c30 50%, #17181a); }
.capedash .foot { position: absolute; left: calc(50% - 20px); top: calc(var(--s) + 30px); width: 40px; height: 6px; border-radius: 3px; background: linear-gradient(#2b2d31, #151618); box-shadow: 0 2px 4px rgba(0, 0, 0, 0.5); }
.capedash .light { position: absolute; left: 16px; top: calc(var(--s) + 13px); width: 3px; height: 3px; border-radius: 50%; background: #3fbf5f; opacity: 0.55; box-shadow: 0 0 3px rgba(63, 191, 95, 0.5); }
.capedash .btns { position: absolute; right: 14px; top: calc(var(--s) + 13px); display: flex; gap: 5px; }
.capedash .btns i { display: block; width: 9px; height: 4px; border-radius: 2px; background: linear-gradient(#3b3d42, #26282c); box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.12); }
/* At night the bezel is nearly black, and only the power light and the screen show. */
.capedash.night .bezel { background: linear-gradient(#0d0e10, #060607); box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.05), 0 3px 10px rgba(0, 0, 0, 0.5); }
.capedash.night .stalk, .capedash.night .foot { background: #08090a; }
.capedash.night .btns i { background: #0d0e10; box-shadow: none; }
.capedash.night .light { opacity: 0.4; }
@keyframes cape-swing-in { from { transform: translateY(90px); } to { transform: none; } }
@keyframes cape-swing-out { from { transform: none; } to { transform: translateY(90px); } }
@media (prefers-reduced-motion: reduce) { .capemap.corner, .capedash, .capemap.corner.leaving, .capedash.leaving { animation: none; } }
${PARTY_CSS}`;

