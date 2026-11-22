/**
 * Cape Sorrow's entry: the engine's shipped files and its terrain
 * register, then the engine's shell of the page starts with Cape Sorrow
 * as one definition (`page.ts`).
 */
import "./assets.js";
import "./terrain.js";
import { startShell } from "@csarkosh/engine/shell";
import { CAPE_PAGE } from "./page.js";

startShell(CAPE_PAGE);
