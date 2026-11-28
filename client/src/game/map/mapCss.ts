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
  /* At rest, quiet and see-through; with a destination or a waypoint it comes up (the class active); the large map is whole. */
  opacity: 0.5;
  pointer-events: none; font-family: ui-monospace, monospace; color: #eaf1f1;
  transition: left 250ms ease, top 250ms ease, width 250ms ease, height 250ms ease, border-radius 250ms ease, opacity 400ms ease;
}
.capemap canvas { display: block; width: 100%; height: 100%; touch-action: none; user-select: none; -webkit-user-select: none; }
.capemap.active { opacity: 0.9; }
.capemap.tappable { pointer-events: auto; cursor: pointer; }
.capemap.paused { z-index: 19; pointer-events: auto; border-radius: 10px; cursor: grab; opacity: 1; border-color: rgba(60, 64, 67, 0.35); box-shadow: 0 2px 12px rgba(0, 0, 0, 0.35); }
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
${PARTY_CSS}`;
