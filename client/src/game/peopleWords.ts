/**
 * What the town's people say: the game's own words, as tables to be read and changed. Nobody is voiced; a line is a caption over the head of
 * the one who says it (`hud.ts`), chosen from its table by a hash, so the same person says the same thing at the same moment on every run.
 *
 * - `MEAN`: to a driver who all but ran them down.
 * - `BUMPED`: to a detective who walked into them.
 * - `GREETINGS`: to the detective, in passing, by the time of day; `GREET_ANY` at any hour.
 * - `CHATTER`: between two who stand or walk together, by the kind of place they are at. Overheard, and no part of any case.
 */

/** The kind of place two people are talking at, which says what they talk about. */
export type Venue = "bar" | "cafe" | "restaurant" | "work" | "shop" | "street";

export const MEAN: readonly string[] = [
  "Watch it, you maniac!",
  "Are you blind?!",
  "Learn to drive!",
  "You nearly killed me!",
  "Who gave you a licence?!",
  "Slow down, you idiot!",
  "Get off the sidewalk!",
  "What is wrong with you?!",
  "I've got your plate, pal!",
  "Jerk!",
  "Eyes on the road, moron!",
  "Try that again, I dare you!",
  "You drive like you stole it!",
  "Hey! People walk here!",
  "Unbelievable. Some detective.",
];

export const BUMPED: readonly string[] = [
  "Hey! Watch where you're going.",
  "Excuse you.",
  "Do you mind?",
  "Easy, pal.",
  "Rude.",
  "Whoa. Personal space.",
  "Use your eyes, detective.",
  "Seriously?",
  "The sidewalk's wide enough for two.",
  "Not so close.",
  "Hands to yourself.",
  "Some manners, huh?",
];

export const GREET_MORNING: readonly string[] = ["Morning, detective.", "Good morning, detective.", "Early start, detective?", "Morning."];
export const GREET_DAY: readonly string[] = ["Afternoon, detective.", "Good afternoon, detective.", "Detective.", "Nice day for it, detective."];
export const GREET_EVENING: readonly string[] = ["Evening, detective.", "Good evening, detective.", "Long day, detective?", "Evening."];
export const GREET_NIGHT: readonly string[] = ["Late one, detective.", "Evening, detective.", "Careful out here, detective.", "Can't sleep either, detective?"];
export const GREET_ANY: readonly string[] = ["Hey there, detective.", "Any luck with the case?", "Stay safe out there.", "Detective."];

/** The greetings for an hour of day (0 to 24): the hour's own, and the ones for any hour. */
export function greetingsAt(hour: number): readonly string[] {
  const h = ((hour % 24) + 24) % 24;
  const own = h >= 5 && h < 12 ? GREET_MORNING : h >= 12 && h < 17.5 ? GREET_DAY : h >= 17.5 && h < 22 ? GREET_EVENING : GREET_NIGHT;
  return [...own, ...own, ...GREET_ANY];
}

export const CHATTER: { readonly [V in Venue]: readonly string[] } = {
  bar: [
    "...so I told him, you want it fixed, you pay for the part.",
    "One more and then I'm really going home.",
    "They water it down. I'm telling you.",
    "Did you see who was sitting with her last night?",
    "My brother saw lights out past the point again.",
    "I'm not saying it's haunted. I'm saying I don't go there.",
    "He owes half this town money.",
    "The mill's cutting shifts again. You heard it here.",
    "You're buying. I got the last two.",
    "Nobody's caught a thing off that pier all month.",
    "She left him the truck and the dog. That's it.",
    "Same band as last Friday. Same three songs.",
  ],
  cafe: [
    "They changed the beans. Tell me they changed the beans.",
    "I was up half the night. That foghorn.",
    "Did you try the marionberry one yet?",
    "It's been raining since Tuesday. I counted.",
    "He said he'd call. He did not call.",
    "I could live on these. I basically do.",
    "My mother thinks I should move back to Spokane.",
    "Two more weeks and the tourists are gone.",
    "You hear what happened out on the county road?",
    "I've read the same page four times.",
    "They want how much for a refill now?",
    "No, you hang up first. I'm kidding. Kind of.",
  ],
  restaurant: [
    "We should have booked. I said we should have booked.",
    "Get the chowder. Trust me.",
    "Last time it was forty minutes for a table.",
    "I'm starving. Are you starving?",
    "They took the halibut off the menu. I nearly cried.",
    "Your mother's meeting us there, right?",
    "Split a dessert? Don't look at me like that.",
    "Is it me or did the prices go up again?",
    "I had the crab here once. Never again.",
    "Let's not talk about work tonight.",
    "He proposed at that table by the window.",
    "If they're full we just get pizza. Deal?",
  ],
  work: [
    "If I have to refile that form one more time...",
    "She's out till Thursday, so guess who's covering.",
    "Five more minutes. Then back in.",
    "They're moving the whole office upstairs. Again.",
    "Did you get the email? Don't answer the email.",
    "I've been on hold since nine.",
    "He takes credit for everything. Everything.",
    "Lunch at one? I can't do noon.",
    "The printer's jammed and it's somehow my fault.",
    "Two more years till I can retire. I'm counting.",
    "You hear the county's auditing us?",
    "I said I'd look into it. I am not looking into it.",
  ],
  shop: [
    "It was cheaper last week. I'm sure of it.",
    "Do we need it? No. Do I want it? Yes.",
    "They never have my size.",
    "Hold on, I forgot the list.",
    "The hardware store closes at five. We have to go.",
    "That's the third one I've seen today.",
    "I'll just look. I'm only looking.",
    "Remind me to get stamps.",
    "Is that new? That window's new.",
    "We came for one thing. One.",
    "She'd love that. It's her birthday Friday.",
    "Did you lock the car?",
  ],
  street: [
    "Looks like more rain coming in.",
    "I'll walk you as far as the corner.",
    "You see the detective's back in town?",
    "They still haven't fixed that streetlight.",
    "The ferry was late again this morning.",
    "I heard something out in the woods last night. Not an elk.",
    "Is it Thursday? It feels like a Thursday.",
    "My knees say the weather's turning.",
    "Somebody's dog has been out all week.",
    "Tide's way out today.",
    "You going to the thing on Saturday?",
    "Nothing ever happens here. That's what I like about it.",
  ],
};
