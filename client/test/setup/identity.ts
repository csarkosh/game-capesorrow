// Port Ashton's tests run as its page does, with its identity set before anything reads a key or
// a line (the engine's Settings model says "session" in its own words, from the identity).
import { setGameIdentity } from "@csarkosh/engine/identity";
import { PORTASHTON_IDENTITY } from "../../src/identity.js";

setGameIdentity(PORTASHTON_IDENTITY);
