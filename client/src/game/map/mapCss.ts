/**
 * The map's stylesheet. The buttons carry the same cold cast the engine's roster and pause menu and the title page draw theirs in; those
 * tokens are repeated in each place on purpose (each owns its one style text), so they are repeated here.
 *
 * The last rules lean on the engine's pause menu: while the phone (the large map) is up the container is marked `capemap-open`, and the menu
 * (`.pausemenu`, a flex box that centres its `.panel`) is given room (on the left of a phone at the side, above one at the bottom), so that its panel is beside the phone and not under it.
 * `client/test/map/screen.test.ts` reads the engine's source and fails if those two class names are gone.
 */
import { PARTY_CSS } from "./partyLook.js";
import { PHONE_CSS } from "./phoneScreen.js";

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
.capemap-open .pausemenu.open { box-sizing: border-box; padding-right: calc(100% - var(--cape-phone-left, 40%)); }
@media (max-width: 719px) {
  .capemap-open .pausemenu.open { padding-right: 0; padding-bottom: var(--cape-phone-h, 70vh); }
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
${PHONE_CSS}${PARTY_CSS}`;

