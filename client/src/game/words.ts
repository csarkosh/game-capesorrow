/**
 * Every word the title page says that is Cape Sorrow's own, in one place, so a line is changed
 * here and nowhere else. (The engine's screens, Settings and Credits, say their own.)
 */

/** The game's name, as the page's heading and the browser's tab carry it. */
export const TITLE = "Cape Sorrow";

/** The sentence under the title: its innocent opening, and the turn that ends it (styled to surface from the fog). */
export const BLURB_LEAD = "A grey stretch of coast; a folder of reports nobody believed; and the slow suspicion that ";
export const BLURB_TURN = "some of them were true.";

/** Above Play while the game is in development: a quiet line, on every build. */
export const IN_DEVELOPMENT = "In development.";

export const PLAY = "Play";
/** Play's label while the world is being built: the button is disabled and says so. */
export const LOADING = "Loading…";
/** A follower, in a lobby someone else hosts, in Play's place. */
export const WAITING_FOR_HOST = "Waiting for the host…";

export const SETTINGS = "Settings";
export const CREDITS = "Credits";

/** The line at a car's door: to take a seat, to leave it, and when leaving changes nothing. */
export const GET_IN = "Click to get in";
export const GET_OUT = "Click to get out";
export const NO_ROOM_TO_GET_OUT = "No room to get out here";

/** What `carhome` says when the car is back, and what a follower is told in its place. */
export const CAR_RETURNED = "The car is back at the office.";
export const HOST_RETURNS_CAR = "Only the host can bring the car back.";

/** The line at the door of a bar, a cafe or a lodging: to go in from the street, and to go out from the room. */
export const GO_IN = "Click to go in";
export const GO_OUT = "Click to go out";

/** What `goin` says when it is not the host's to do, and when the room is not one of the town's. */
export const HOST_PUTS_IN = "Only the host can put you in a room.";
