/**
 * Port Ashton's entry: the engine's shipped files and its terrain
 * register, then the engine's shell of the page starts with Port Ashton
 * as one definition (`page.ts`).
 */
import "./assets.js";
import "./terrain.js";
import { startShell } from "@csarkosh/engine/shell";
import { PORTASHTON_PAGE } from "./page.js";

startShell(PORTASHTON_PAGE);
