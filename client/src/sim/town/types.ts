/**
 * The town plan's types. A plan is plain data (numbers, strings, arrays, no classes) so that it can be
 * hashed, compared, sent from a worker and read by the map page. Units are metres, in the site's frame:
 * origin at the anchor on the highway, +x inland (east), +z north, the sea at negative x.
 */
import type { Bearing } from "./bearings.js";
import type { Vec, Poly } from "./geom.js";

export type { Bearing, Vec, Poly };

/**
 * The kinds of town. Only the large port is made so far; each further kind (oyster town, fishing
 * harbour, resort, company mill town, river landing, county seat, failed terminus town) is a branch:
 * a name here and a recipe in `recipes.ts`, with no `if` on the kind anywhere in the shared code.
 */
export type TownKind = "port";

export type FoundingPurpose = "sawmill" | "cannery" | "customs" | "railhead";
/** What the first plat was laid to: the wagon road that became the highway, the line of the first wharf, or a railroad's survey. */
export type FirstPlatBasis = "road" | "wharf" | "survey";
export type PortCargo = "logs" | "grain" | "seafood" | "autos" | "general cargo";
export type EventKind =
  | "founding"
  | "first plat"
  | "second plat"
  | "railroad"
  | "fire"
  | "boom"
  | "bust"
  | "county seat"
  | "port"
  | "mill"
  | "road"
  | "harbour"
  | "present";

export type HistoryEvent = {
  readonly year: number;
  readonly kind: EventKind;
  /** One plain sentence a person can read; later, case material. */
  readonly text: string;
};

export type History = {
  readonly kind: TownKind;
  readonly founding: { readonly purpose: FoundingPurpose; readonly year: number; readonly founder: string };
  readonly firstPlat: {
    readonly year: number;
    readonly by: string;
    /** What the first plat was laid to. */
    readonly basis: FirstPlatBasis;
    readonly bearing: Bearing;
  };
  readonly secondPlat: { readonly year: number; readonly by: "land company" | "railroad"; readonly company: string };
  /** Which of the flats beside the cove the mill took; the public port's terminal took the other. */
  readonly millSide: "north" | "south";
  /** The railroad, if it came: it runs along the shore, between the water and the downtown. */
  readonly railroad: { readonly year: number } | null;
  readonly fire: { readonly year: number; readonly burned: "core" | "both" } | null;
  readonly boom: { readonly peakYear: number; readonly bust1893: boolean };
  readonly countySeat: { readonly isSeat: boolean; readonly seatTown: string; readonly county: string; readonly year: number };
  readonly port: { readonly year: number; readonly handles: PortCargo };
  readonly mill: {
    readonly company: string;
    readonly startYear: number;
    readonly fate: "closed" | "working";
    readonly closedYear: number | null;
    /** A closed mill's site is in cleanup (true) or lies fenced and untouched (false). */
    readonly cleanup: boolean;
  };
  readonly present: {
    /** The share of the core's storefronts that are vacant. */
    readonly vacantShare: number;
    readonly tsunamiRefuge: boolean;
    readonly highwayStrip: boolean;
  };
  /** Dated events, in order, each with its sentence. */
  readonly events: readonly HistoryEvent[];
};

export type Plat = {
  readonly id: string;
  readonly name: string;
  readonly origin: Vec;
  readonly bearing: Bearing;
  /** Block size, centre line to centre line: `along` the bearing's u axis, `across` it (v). */
  readonly block: { readonly along: number; readonly across: number };
  readonly streetWidth: number;
  /** The alley's width, or null for a plat with none. */
  readonly alley: number | null;
  /** Blocks along u, and along v. */
  readonly columns: number;
  readonly rows: number;
  /** The ground the plat covers. */
  readonly polygon: Poly;
  readonly by: string;
  readonly year: number;
  /** The plat's one wide avenue (a land-company plat), as the index of its line along v. */
  readonly avenue: { readonly line: number; readonly width: number } | null;
};

export type StreetKind = "highway" | "avenue" | "main" | "street" | "alley" | "wharf" | "rail" | "stair";

export type Street = {
  readonly id: number;
  readonly a: Vec;
  readonly b: Vec;
  /** The right of way, edge to edge. */
  readonly width: number;
  /** The roadway between the curbs, and the sidewalk down each side of it (0 for none): the rest of the right of way is verge (`port/ways.ts`). */
  readonly roadway: number;
  readonly walk: number;
  readonly kind: StreetKind;
  readonly plat: string | null;
  readonly name: string;
  /** True for the street that runs along the seam between two plats. */
  readonly seam?: boolean;
};

/**
 * A stretch of a street side's sidewalk, poured in one go: from `s0` to `s1` metres along the street (from `a`). A sidewalk is
 * never one pour: a block, or half of one, was poured when the owners or the town could pay for it, so each run has a decade of
 * its own (its tone, its joint spacing and how broken it is follow from it).
 */
export type WalkRun = {
  readonly s0: number;
  readonly s1: number;
  /** The decade it was poured (1950 means the 1950s). */
  readonly decade: number;
  /** How broken it is, 0 (sound) to 1 (heaved, cracked, patched): from its age, the district and the lots it fronts. */
  readonly wear: number;
};

/** One side of a street (left of its direction from `a` to `b` is side 0, right is side 1): what stands beside its roadway. */
export type SideEdge = {
  /** The sidewalk's width where there is one (the street's `walk`), 0 where this side has none along its whole length. */
  readonly walk: number;
  /** A curb and gutter stands along this side. */
  readonly curb: boolean;
  /** Where the sidewalk is, in order and apart. Empty when there is none. */
  readonly runs: readonly WalkRun[];
  /** The width between the curb's back (or the pavement's edge, where there is no curb) and the sidewalk, or to the right of way's edge where there is none: grass verge, or gravel shoulder where no curb. */
  readonly verge: number;
  /** A shallow ditch runs along this side beyond the shoulder (a street with no curb). */
  readonly ditch: boolean;
};

/** A stretch of a roadway laid at one time: from `s0` to `s1` along its street. Each overlay buried more of the curb's face. */
export type Paving = {
  readonly s0: number;
  readonly s1: number;
  /** The decade it was last paved. */
  readonly decade: number;
  /** How much of the curb's face shows over the gutter here, metres (0.15 where the street was rebuilt, 0.05 where layers of paving buried the old curb); the same on a side that has a curb, and the pavement stands at the ground where it has none. */
  readonly curb: number;
  /** How worn the surface is, 0 (new) to 1. */
  readonly wear: number;
};

/** The street's history, the way it was built and kept: what its two sides have beside the roadway, and how the roadway was laid. */
export type StreetEdge = {
  readonly street: number;
  /** Left and right of the street's direction. */
  readonly sides: readonly [SideEdge, SideEdge];
  /** The roadway's stretches, in order, from `a` to `b`. */
  readonly paving: readonly Paving[];
  /** How much traffic it has, 0 (a dead end of a few houses) to 1 (the main street): paint, wear and potholes follow. */
  readonly use: number;
  /** Where the street stands in the town's history: the core and the civic blocks, the old plat's house streets, the later additions, the edges. */
  readonly era: "core" | "old" | "later" | "edge";
};

/** How a house lot's ground is kept. `paved` is no yard (a lot of a paved district). */
export type YardKind = "paved" | "mown" | "shaggy" | "tall" | "bare" | "mossy" | "brush";

/** A lot's ground, from the lot's own story (the building's state and era, the district and a roll of its own). */
export type Yard = {
  readonly lot: number;
  readonly kind: YardKind;
  /** How kept it is, 0 (abandoned) to 1 (mown). */
  readonly kept: number;
  /** A drive from the street to the building and what it is made of, or null; `at` is where along the lot's frontage (0 to 1) it meets the street. */
  readonly drive: { readonly kind: "gravel" | "dirt" | "concrete"; readonly at: number; readonly width: number } | null;
  /** A front walk from the street to the door, and how broken it is (0 sound, 1 half gone to weeds), or null. */
  readonly walk: { readonly wear: number } | null;
};

/** What a street's end made by the plan is: a turnaround (a gravel bulb to turn in), a barricade, or a landing at the water. */
export type EndKind = "turnaround" | "barricade" | "landing";

/** A street's end that is no junction: where it is, which way it points (out of the street) and what is made there. */
export type StreetEnd = {
  readonly street: number;
  readonly at: "a" | "b";
  readonly x: number;
  readonly z: number;
  readonly dx: number;
  readonly dz: number;
  readonly kind: EndKind;
};

/** How a road out of town is surfaced along its length: it narrows from paved to gravel to two wheel tracks. */
export type RoadSurface = "paved" | "gravel" | "tracks";

/** A point of a road's line, and how wide the road is and how it is surfaced there. */
export type RoadPoint = { readonly x: number; readonly z: number; readonly width: number; readonly surface: RoadSurface };

/** What a road ends at. */
export type DestinationKind = "cemetery" | "landing" | "gravel pit" | "water tank" | "gate";

export type Destination = {
  readonly kind: DestinationKind;
  readonly name: string;
  readonly x: number;
  readonly z: number;
  /** The cleared place about it, metres. */
  readonly radius: number;
};

/** A road out of town: a county road, an old logging road, or a road along the shore's flats. It continues from a grid street, follows the land, and ends at something. */
export type Road = {
  readonly id: number;
  readonly name: string;
  readonly kind: "county" | "logging" | "shore";
  /** The street end it continues. */
  readonly from: { readonly street: number; readonly at: "a" | "b" };
  readonly points: readonly RoadPoint[];
  readonly destination: Destination;
  /** Its length along its line, metres. */
  readonly length: number;
};

export type District =
  | "core"
  | "dock"
  | "waterfront"
  | "mill"
  | "mill housing"
  | "residential"
  | "highway strip"
  | "civic"
  | "industrial"
  | "outskirts";

export type Block = {
  readonly id: number;
  readonly plat: string;
  readonly polygon: Poly;
  readonly district: District;
  /** The block's place in its plat's grid, or null for the working waterfront and the mill's site. */
  readonly cell: { readonly col: number; readonly row: number } | null;
};

export type Lot = {
  readonly id: number;
  readonly block: number;
  readonly polygon: Poly;
  readonly district: District;
  /** The unit vector from the lot toward the street it fronts. */
  readonly front: Vec;
  /** Set when a landmark was reserved on this lot. */
  readonly role: string | null;
};

export type BuildingKind =
  | "storefront"
  | "hotel"
  | "bank"
  | "lodge hall"
  | "church"
  | "house"
  | "apartment"
  | "warehouse"
  | "mill shed"
  | "cannery"
  | "port terminal shed"
  | "gas station"
  | "motel"
  | "big-box store"
  | "school"
  | "hospital"
  | "office"
  | "municipal building"
  | "courthouse"
  | "tsunami refuge"
  | "tavern"
  | "boarding house"
  | "depot"
  | "customs house"
  | "silo"
  | "garage"
  | "restaurant"
  | "fire hall"
  | "shake mill"
  | "junkyard"
  | "pier";

export type Roof = "flat" | "gable" | "hip" | "shed";
export type Material = "wood" | "brick" | "concrete" | "metal" | "stucco" | "stone";
export type BuildingState = "open" | "vacant" | "ruin";

export type Building = {
  readonly id: number;
  /** The lot it stands on; -1 for a pier or a structure on piles, which belongs to no lot. */
  readonly lot: number;
  readonly centre: Vec;
  /** Half extents along the plat's u axis and across it (v). */
  readonly halfAlong: number;
  readonly halfAcross: number;
  /** The plat's bearing: the building's own axes. */
  readonly bearing: Bearing;
  readonly storeys: number;
  readonly height: number;
  readonly roof: Roof;
  readonly kind: BuildingKind;
  /** The decade it was built (1890 means the 1890s). */
  readonly era: number;
  readonly material: Material;
  readonly state: BuildingState;
  /** The street-side unit vector (the front), or null for a pier. */
  readonly front: Vec | null;
};

export type LandmarkRole =
  | "municipal building"
  | "mill"
  | "port terminal"
  | "hotel"
  | "church"
  | "lodge"
  | "high school"
  | "hospital"
  | "courthouse"
  | "tsunami refuge"
  | "depot"
  | "customs house"
  | "cannery"
  | "bank"
  | "cemetery"
  | "landing"
  | "gravel pit"
  | "water tank"
  | "gate";

export type Landmark = {
  readonly id: number;
  readonly role: LandmarkRole;
  readonly name: string;
  /** The building it points at; -1 for a place that is no building (a road's destination), which has `at`. */
  readonly building: number;
  /** Where it is, for a place that is no building. */
  readonly at?: Vec;
  /** One sentence for the map's list: what it is, and what the history did to it. */
  readonly text: string;
};

export type Seam = {
  readonly plats: readonly [string, string];
  readonly a: Vec;
  readonly b: Vec;
  /** The angle between the two grids, degrees. */
  readonly angle: number;
  /** The street that runs along it. */
  readonly street: number;
};

/** The quay: the straight line along the old plat, and the stretches of it that have water seaward. */
export type Quay = {
  readonly a: Vec;
  readonly b: Vec;
  /** The stretches (pieces of the line a to b) where the harbour lies seaward: a wall stands along each, and the made ground is a polygon of its own. */
  readonly wet: readonly { readonly a: Vec; readonly b: Vec }[];
  /** The unit vector from the quay out over the water. */
  readonly seaward: Vec;
  /**
   * What the wall is built of: timber cribwork under a timber cap (the quay the port built in its first years, and kept), or steel
   * sheet piling under a concrete cap (where a fire after 1921 took the waterfront and it was rebuilt in concrete).
   */
  readonly wall: "timber" | "sheet";
};

export type DeckKind = "apron" | "pier" | "wharf" | "shed" | "float" | "gangway";

/**
 * A deck a person can walk on, standing over the water: an oriented rectangle in the town's frame, and the height of its
 * top. A flat deck has `top` and `topEnd` equal; a gangway's top is `top` at the end at `-halfAlong` along `axis` and
 * `topEnd` at the other, and rises or falls evenly between. Heights are the world's (the sea is 0). It is the one list the
 * walking (`sim/town/decks.ts`) and the drawing (`game/town/pileGeometry.ts`) both read.
 */
export type Deck = {
  readonly id: number;
  readonly kind: DeckKind;
  readonly centre: Vec;
  /** The unit vector along the deck's length. */
  readonly axis: Vec;
  readonly halfAlong: number;
  readonly halfAcross: number;
  readonly top: number;
  readonly topEnd: number;
  /** The building (a pier, a shed) it is the platform of, or null. */
  readonly building: number | null;
};

export type BoatKind = "troller" | "gillnetter" | "crabber" | "tug" | "skiff" | "sailboat" | "pleasure";
/** Working boats are kept and used; a derelict lists, is faded and has lost its gear; a sunk one lies at its mooring with its wheelhouse above water. */
export type BoatState = "working" | "derelict" | "sunk";

/**
 * A boat on the water, in the town's frame. Its waterline is the sea's level; `heading` is the unit vector from stern to bow
 * (made from a grid's bearing, so exact). Boats do not move. `colour` and `name` are indices into the drawing's colour table
 * and `BOAT_NAMES` (`port/harbour.ts`).
 */
export type Boat = {
  readonly id: number;
  readonly kind: BoatKind;
  readonly x: number;
  readonly z: number;
  readonly heading: Vec;
  readonly length: number;
  readonly beam: number;
  /** How deep the keel lies under the waterline. */
  readonly draft: number;
  readonly state: BoatState;
  readonly colour: number;
  readonly name: number;
  readonly mooring: "slip" | "pier" | "anchor" | "terminal";
};

/** A berth between two finger floats. */
export type Slip = { readonly x: number; readonly z: number; readonly heading: Vec; readonly width: number; readonly length: number; readonly boat: number | null };

/** A pile: a post standing in the water from the sea floor to `top` (a height above the sea), leaning by `lean` (metres of top's offset in x, z per metre of height). */
export type Piling = {
  readonly x: number;
  readonly z: number;
  readonly top: number;
  readonly lean: Vec;
  readonly radius: number;
  readonly kind: "dead" | "dolphin" | "boom";
};

export type PilingField = { readonly origin: "cannery" | "mill" | "dock"; readonly year: number; readonly piles: readonly Piling[] };

export type FloatingLog = { readonly x: number; readonly z: number; readonly heading: Vec; readonly length: number; readonly radius: number };

/** The mill's water: a pond held by a boom of sticks chained between piles; a working mill floats logs in it, a closed one's lies empty. */
export type LogPond = {
  readonly centre: Vec;
  readonly halfX: number;
  readonly halfZ: number;
  readonly working: boolean;
  /** The boom's sticks: each from one pile to the next (indices into `piles`). */
  readonly piles: readonly Piling[];
  readonly logs: readonly FloatingLog[];
  /** The jack ladder, a ramp from the water up to the mill, ending in a house; null if no place for one was found. */
  readonly jackLadder: { readonly a: Vec; readonly b: Vec; readonly bottom: number; readonly top: number; readonly width: number } | null;
};

/** The rusting cone of a wigwam burner on a closed mill's site. */
export type Burner = { readonly x: number; readonly z: number; readonly radius: number; readonly height: number };

export type CargoKind = "logs" | "grain" | "seafood" | "autos" | "general cargo";

/** Something on the terminal's yard: a deck of logs, a chip pile, a silo, a row of cargo or of parked cars, on compass axes. */
export type YardItem = {
  readonly kind: "log stack" | "chip pile" | "silo" | "bulk shed" | "containers" | "cars";
  readonly x: number;
  readonly z: number;
  /** Half extents along x and along z (a cone or a silo's radius is in both). */
  readonly halfX: number;
  readonly halfZ: number;
  readonly height: number;
  /** A count the drawing uses: logs in the stack's bottom row, containers in a row, cars. */
  readonly n: number;
};

export type Barge = { readonly x: number; readonly z: number; readonly heading: Vec; readonly length: number; readonly beam: number; readonly cargo: "logs" | "chips" | "containers" | "vehicles" | "grain" };

export type Terminal = {
  readonly cargo: CargoKind;
  /** The history says it stands idle: an empty yard and no barge. */
  readonly idle: boolean;
  readonly yard: readonly YardItem[];
  readonly barge: Barge | null;
  /** A loading spout at the wharf (grain and chips), at this place. */
  readonly spout: Vec | null;
};

/**
 * A light of the harbour. The first three are the headlands' and the longest pier's; the rest are a working port's lamps: a lamp on a post at
 * a pier's edge, a taller post on the quay's apron, a low dock light on a float, a flood mast at the terminal's yard and a yard light at the
 * running mill. `dx`, `dz` (a unit vector) is the way an arm reaches or a flood looks; `seed` (a drawn integer) is what the drawing reads
 * for which are dead, which are white and when each comes on.
 */
export type Light = {
  readonly kind: "harbour light" | "day beacon" | "pier light" | "pier lamp" | "quay lamp" | "float light" | "flood mast" | "yard light";
  readonly x: number;
  readonly z: number;
  readonly height: number;
  readonly dx?: number;
  readonly dz?: number;
  readonly seed?: number;
};

/** What a working harbour has, as plan data in the town's frame. The floats and gangways are decks (`plan.decks`). */
export type Harbour = {
  readonly boats: readonly Boat[];
  readonly slips: readonly Slip[];
  /** The ids of the decks that are main floats, finger floats and gangways. */
  readonly floats: readonly number[];
  readonly gangways: readonly number[];
  readonly pilings: readonly PilingField[];
  readonly dolphins: readonly Piling[];
  readonly logPond: LogPond | null;
  readonly burner: Burner | null;
  readonly terminal: Terminal | null;
  readonly lights: readonly Light[];
  /** The sentences that say what is there, with their years: they join the history's list. */
  readonly events: readonly HistoryEvent[];
};

/** The town's own track: a polyline from the main line to where it ends, its bends no tighter than `radius` metres, and what it serves. */
export type Spur = {
  readonly id: number;
  readonly name: string;
  /** From the main line (the first point lies on it) to the end of the track. */
  readonly points: readonly Vec[];
  /** The least radius of curvature along it, metres. */
  readonly radius: number;
  /** Where along it it serves: the mill, the quay (and its depot), the public port's terminal, in the order it reaches them. */
  readonly serves: readonly ("mill" | "quay" | "terminal")[];
  /** The stretches of it that cross open water (indices of the first and last point, inclusive): they are carried on a trestle. */
  readonly wet: readonly { readonly from: number; readonly to: number }[];
};

/**
 * A way crossing the railroad's main line at grade, in the town's frame: where (on the line's centre), which street (`road` false: an
 * index into `plan.streets`) or road out (`road` true: its id), the way's unit direction there (running seaward, so `dx` is not
 * positive), its roadway and whole right of way, and whether it is paved. The drawing (`railCrossings.ts`) reads these.
 */
export type RailCrossing = {
  readonly x: number;
  readonly z: number;
  readonly way: number;
  readonly road: boolean;
  readonly dx: number;
  readonly dz: number;
  readonly roadway: number;
  readonly width: number;
  readonly paved: boolean;
};

/** What the plan says of the railroad (the main line itself, `rail.ts`, is the world's): the streets that cross it and the town's own spur. */
export type TownRail = {
  readonly crossings: readonly RailCrossing[];
  readonly spurs: readonly Spur[];
  /** The main line's centre in the town's frame, from the south of the site to the north (the highway's line shifted `RAIL_OFFSET` seaward): what the props keep clear of. */
  readonly main: readonly Vec[];
};

/** A block's place the town did not take, left as woods: because the land would not bear it (too steep, too wet, a hump or a gully) or because the history's budget of blocks was spent. */
export type Woods = { readonly polygon: Poly; readonly why: "land" | "budget" };

/** Why a lot of the town's blocks has no building: a house taken down and the ground left to brush, a lot at a block's corner or end too small or too awkward to build on, or one at the water's edge. */
export type Gap = { readonly lot: number; readonly why: "demolished" | "poor corner" | "shore" | "rail" };

/** A building of the town's thinning edge, past the last full blocks, and why it stands where it does. */
export type Outskirt = {
  readonly building: number;
  /** One plain sentence: what it is there for. */
  readonly reason: string;
  /** Where it lies: beside the highway north or south of the town, or on a road out of it. */
  readonly where: "north" | "south" | "road";
};

/**
 * A place in a building: the building, and the unit (`Unit.id`) where the place is one of its bays (null where it is the whole building), and, for a place with no unit, its door:
 * `s` metres along the front frame (`BuildingUse.frame`, from the left as the street sees it, as a unit's door is) and its width. A place that is a unit has its door in `Unit.door` (null here).
 */
export type Place = { readonly building: number; readonly unit: number | null; readonly door: { readonly s: number; readonly width: number } | null };

/** The four places every town always has (`TownPlan.places`). */
export type Places = {
  /** The player's office: the municipal building (the whole building). */
  readonly office: Place;
  /** Where the player stays: an open hotel, motel or boarding house's unit. */
  readonly lodging: Place;
  /** An open tavern. */
  readonly bar: Place;
  /** An open cafe. */
  readonly cafe: Place;
};

export type Spawn = { readonly x: number; readonly z: number; readonly yaw: number };

/**
 * The kinds of junction. A **four-way** (or a compound of more legs, where streets cross within a corner of each other), a
 * **tee** (one street ends on another's side), a **skew** (a four-way whose streets cross more than 15 degrees off square), a
 * **highway** (a street ends on the state highway, whose pavement is the engine's), and the four that share no pavement: an
 * **alley**'s mouth (a driveway apron, no intersection), a **road end** (a street's end where a road out of town goes on),
 * a **stair** (a street or a flight of steps meeting a flight) and a **rail** crossing.
 */
export type JunctionKind = "four-way" | "bend" | "tee" | "skew" | "highway" | "alley" | "road end" | "stair" | "rail";

/** Who stops: nobody, the minor street's legs, every leg, or (at the railroad) crossbucks only; no signals in this pass. */
export type JunctionControl = "none" | "stop" | "all-way" | "crossbuck";

/**
 * One leg of a junction: a street (or the highway's edge, or a road out) leaving it. The leg's centre line passes through
 * (`x`, `z`) with the unit direction (`dx`, `dz`) pointing away from the junction; its curbs lie `half` either side of it
 * and its lot lines `outer`. The street's own segment covers `from` to `to` along the leg from that point. `mouth` is where
 * the leg's roadway strip begins (the junction's pavement fills the rest), `bandLeft` and `bandRight` where its verge,
 * sidewalk and curb begin on each side (left of the direction, then right), all measured from (`x`, `z`) along the leg.
 */
export type JunctionLeg = {
  readonly street: number;
  /** The road out's id when the leg is one, else -1. */
  readonly road: number;
  readonly kind: StreetKind | "road";
  readonly name: string;
  readonly x: number;
  readonly z: number;
  readonly dx: number;
  readonly dz: number;
  readonly from: number;
  readonly to: number;
  readonly roadway: number;
  readonly walk: number;
  readonly width: number;
  readonly half: number;
  readonly outer: number;
  /** The highway: its pavement is the engine's, and the leg stands on the edge of its bed (`half` 0). */
  readonly engine: boolean;
  readonly mouth: number;
  readonly bandLeft: number;
  readonly bandRight: number;
  /** The leg has a marked crosswalk (ladder bars) just outside the junction's pavement. */
  readonly marked: boolean;
  /** The leg stops (a STOP sign and a stop line). */
  readonly stops: boolean;
  /** Where the stop line's near edge lies from the reference point, or null. */
  readonly stopLine: number | null;
  /** The distance from the mouth within which no parking stall stands. */
  readonly holdBack: number;
  /** Where the centre line's dashes (and an avenue's median) end, from the reference point. */
  readonly centreEnd: number;
  /** The street ends in a made dead end beyond this junction, with no other junction between: the leg carries a DEAD END sign. */
  readonly deadEnd: boolean;
  /** A leg closed with a planter (a legacy of the seam's sharp crossings): its strip ends on the other street's curb line. */
  readonly closed: boolean;
  /** Which sides of the leg, at the junction, have a curb and a sidewalk (left of the leg's direction, then right): a corner has a curb return and a sidewalk only where both legs it joins have them. */
  readonly curbLeft: boolean;
  readonly curbRight: boolean;
  readonly walkLeft: boolean;
  readonly walkRight: boolean;
};

/**
 * The corner between a leg and the next one counter-clockwise: the curb return of `radius` (tangent to the first leg's left
 * curb at `ta` and the second's right curb at `tb`, its centre `c`), or the straight curb of a through street's far side, or a
 * sharp corner. `v` is where the two curb lines meet and `lot` where the two lot lines meet (the sidewalk's outer corner).
 */
export type JunctionCorner = {
  readonly from: number;
  readonly to: number;
  readonly shape: "arc" | "straight" | "sharp";
  readonly radius: number;
  /** The radius the streets that meet would give a square corner. */
  readonly nominal: number;
  /** The tangent length from `v` along each curb. */
  readonly reach: number;
  readonly v: Vec | null;
  readonly ta: Vec;
  readonly tb: Vec;
  readonly c: Vec | null;
  readonly lot: Vec | null;
  /** The corner has a curb return (both legs have a curb on the sides that meet here), else the pavement turns in a plain radius into gravel. */
  readonly curb: boolean;
  /** The corner has its sidewalk (both legs have one on the sides that meet here). */
  readonly walk: boolean;
};

/** An alley's mouth: where an alley meets a street, drawn as a driveway apron with the sidewalk carried across. */
export type AlleyMouth = {
  /** The alley's centre line at the street's lot line, and its direction out of the street. */
  readonly x: number;
  readonly z: number;
  readonly dx: number;
  readonly dz: number;
  readonly width: number;
  /** The street it opens on, and its roadway half width. */
  readonly street: number;
};

export type Junction = {
  readonly id: number;
  readonly kind: JunctionKind;
  readonly x: number;
  readonly z: number;
  /** The legs, counter-clockwise by direction; `corners[i]` lies between `legs[i]` and `legs[i + 1]`. A junction with no shared pavement has none of the corners. */
  readonly legs: readonly JunctionLeg[];
  readonly corners: readonly JunctionCorner[];
  /** The legs closed with a planter (a sharp crossing's legacy): each ends where its curbs leave the pavement (`mouth`, with `bandLeft` and `bandRight` the two curbs' own). */
  readonly closed: readonly JunctionLeg[];
  /** A tee's stem (an index into `legs`), or -1. */
  readonly stem: number;
  /** The streets that meet here (indices into `plan.streets`), ascending. */
  readonly streets: readonly number[];
  /** The sine of the angle the two main streets cross off square (0 for square), for a junction of streets. */
  readonly skew: number;
  /** A crossing sharper than WSDOT's 60 degrees: its second street's nearer leg is closed with a planter and a sign. */
  readonly legacy: "planter" | null;
  /** Two junctions lay so close that their curb returns would meet: every corner here has the 10 ft radius of two neighbourhood streets. */
  readonly tight: boolean;
  readonly control: JunctionControl;
  /** The corners were rebuilt with curb ramps and dome panels; an older residential corner has none and a full-height curb all round. */
  readonly ramps: boolean;
  /** A school's or the hospital's corner. */
  readonly civic: boolean;
  /** In the core of the town. */
  readonly core: boolean;
  /** The centre line of a main street or avenue is carried through as a dotted line. */
  readonly dotted: boolean;
  /** The corner that carries the street-name blades (an index into `corners`) and the two legs they name, or null for a junction with no pavement of its own. */
  readonly blades: { readonly corner: number; readonly legs: readonly [number, number] } | null;
  /** An alley's mouth. */
  readonly alley: AlleyMouth | null;
  /** Where a road out of town stops being paved and a PAVEMENT ENDS sign stands, with the road's direction there. */
  readonly pavementEnds: { readonly x: number; readonly z: number; readonly dx: number; readonly dz: number } | null;
  /** A rail crossing's crossbucks and stop line: the distances from the line's centre, metres. */
  readonly rail: { readonly crossbuck: number; readonly stopLine: number } | null;
};

/**
 * What is in the buildings, as data for the drawing. It is drawn by `game/town/` (fronts, rooms, signs, windows). Every trade, name, sign, room and window state
 * is authored or drawn by `port/business/`, from the building's own random stream, so that a seed gives the same shops on every
 * machine. Units are metres, in a building's own frame (`FrontFrame`): `s` runs along the front wall from its left end as a
 * person on the street sees it, `d` runs from the front wall into the building, and heights are above the ground.
 */

/** The trades. The shops and offices are those the OSM extracts of real coastal towns hold (see `port/business/trades.ts`); a few follow only from the town's history. */
export type Trade =
  | "diner" | "restaurant" | "cafe" | "espresso stand" | "pizza and burgers" | "tavern"
  | "grocery" | "convenience store" | "bakery" | "gift shop" | "gallery" | "kite shop" | "candy shop"
  | "bank" | "credit union" | "hair salon" | "barber" | "tattoo parlor"
  | "real estate office" | "insurance office" | "law office" | "tax office" | "title company" | "bail bonds"
  | "medical clinic" | "dentist" | "veterinarian" | "pharmacy"
  | "auto repair" | "auto parts" | "tire shop" | "saw and chain shop"
  | "hardware" | "garden and feed" | "clothing" | "variety store" | "jeweler" | "bookstore" | "game shop"
  | "post office" | "phone shop" | "liquor store" | "smoke shop" | "food bank"
  | "bait and tackle" | "marine supply" | "fish market" | "boat yard"
  | "antiques" | "thrift store" | "pawn shop" | "sporting goods" | "laundromat" | "furniture store" | "funeral home"
  | "newspaper office" | "print shop" | "movie theater" | "union hall" | "self storage"
  | "gas station" | "motel" | "hotel" | "rooming house" | "inn" | "lodge"
  // Trades of the past only (a ghost sign, an earlier tenant): none of these is open now.
  | "dry goods" | "five and dime" | "shoe repair" | "cigar store" | "photo studio" | "video store" | "feed store" | "hat shop";

/** A unit is open now; shut for the day (a Sunday, a lunch hour: lights off, kept up); vacant with a notice in the glass; or vacant and boarded. A ruin has no units. */
export type UnitState = "open" | "closed for the day" | "vacant for lease" | "vacant boarded";
export type InteriorType = "retail aisles" | "counter service" | "dining room" | "bar" | "office" | "laundromat" | "workshop" | "lobby" | "empty";
export type FurnishingKind =
  | "shelf run" | "counter" | "table" | "booth" | "stool row" | "display case" | "cooler" | "washer row" | "desk"
  | "rack" | "stacked crates" | "ladder" | "paint cans" | "bench" | "pool table" | "lift"
  | "windowbar" | "hightable" | "stand" | "stack" | "roll" | "leaner" | "partition" | "endcap" | "checkout" | "bin" | "cart" | "couch" | "machine" | "cabinet" | "water cooler" | "plant" | "sheet";
export type SignKind = "fascia" | "blade" | "glass" | "wall" | "pole" | "sandwich" | "banner" | "open" | "lease" | "ghost" | "board";
/** Hand-painted wood or paint (before 1950), neon and porcelain enamel (1950s and 60s), backlit plastic boxes (1970 to 1999), vinyl (2000 on). */
export type SignStyle = "hand-painted" | "neon and porcelain" | "backlit box" | "vinyl";
export type WindowCover = "none" | "display" | "blinds" | "papered" | "boarded" | "bricked";
export type WindowTreatment = "curtained" | "blinds" | "lit" | "dark" | "boarded" | "broken";

/** A building's front wall as a frame: `origin` is the ground at the wall's left end (seen from the street), `n` points out of the front, `t` along the wall to the right. */
export type FrontFrame = { readonly origin: Vec; readonly n: Vec; readonly t: Vec; readonly width: number; readonly depth: number };

/** Where a sign goes. `wall` "front", "left", "right" or "back" is a wall of the building (left and right as seen from the street): `s` is metres along the front or back wall from its left end, or along a side wall from the front corner. "sidewalk" and "lot edge" stand free: `s` along the front line, `out` metres out from the front wall. `door` is which side of the unit's door a front sign is on, or "over" it. */
export type SignPlace = {
  readonly wall: "front" | "left" | "right" | "back" | "sidewalk" | "lot edge";
  readonly s: number;
  readonly h: number;
  readonly out: number;
  readonly door: "over" | "left" | "right" | "none";
};

export type Sign = {
  readonly kind: SignKind;
  /** The words, a line each. */
  readonly lines: readonly string[];
  readonly style: SignStyle;
  /** The decade the sign was made in. */
  readonly decade: number;
  /** 0 is gone to ghost, 1 as new. */
  readonly condition: number;
  /** Lit now (neon, a backlit box, an OPEN sign); never true for a sign that is out of repair or of a shut unit. */
  readonly lit: boolean;
  /** What it advertises: the unit's own trade, or an earlier tenant's when the sign no longer matches. */
  readonly trade: Trade | null;
  readonly mismatch: boolean;
  readonly place: SignPlace;
};

export type Opening = {
  readonly s0: number;
  readonly s1: number;
  readonly sill: number;
  readonly head: number;
  readonly cover: WindowCover;
  /** A later tenant cut this opening wider than the first builder's. */
  readonly widened: boolean;
};

export type Furnishing = {
  readonly kind: FurnishingKind;
  /** Its centre in the building's frame. */
  readonly s: number;
  readonly d: number;
  /** Its length along `dir`, its width across it, and its height. */
  readonly sx: number;
  readonly sd: number;
  readonly h: number;
  /** The unit vector of its length in the (s, d) plane: an axis, or a skew one from a Pythagorean triple. */
  readonly dir: Vec;
};

export type RoomLight = { readonly s: number; readonly d: number; readonly h: number; readonly on: boolean; readonly kind: "tube" | "pendant" | "neon" | "lamp" };

/** The room behind a unit's front: it runs from `d` 0 to `depth` and across the unit's own `s0` to `s1`. */
export type Interior = {
  readonly type: InteriorType;
  readonly depth: number;
  readonly ceiling: number;
  readonly furnishings: readonly Furnishing[];
  readonly lights: readonly RoomLight[];
  /** True for a room deliberately left thin at the front (an old or failing shop): the plan puts little in the band behind its glass. */
  readonly thin: boolean;
};

export type Tenant = { readonly trade: Trade; readonly name: string; /** The decade it opened (never before the building's era). */ readonly opened: number };
export type PastTenant = { readonly trade: Trade; readonly name: string; readonly from: number; /** The year it left. */ readonly to: number };

/** One bay of a building's street front: a shop, an office, a lobby. The units of a building tile its front wall exactly (`s0` of the first is 0, `s1` of the last is the frame's width). */
export type Unit = {
  readonly id: number;
  readonly s0: number;
  readonly s1: number;
  readonly door: { readonly s: number; readonly width: number; /** How far the door is set back from the wall's face. */ readonly recess: number };
  /** The windows of its front, left to right. */
  readonly openings: readonly Opening[];
  /** The height of the board over the windows, which differs from a neighbour's with the age and the storey height of each. */
  readonly fascia: number;
  readonly state: UnitState;
  /** Null when vacant. */
  readonly tenant: Tenant | null;
  readonly lit: boolean;
  /** The year the last tenant left, for a vacant unit. */
  readonly vacantSince: number | null;
  /** Earlier tenants, oldest first. */
  readonly past: readonly PastTenant[];
  /** A change made to the front since it was built, which is why it differs from the first plan. */
  readonly remodel: { readonly decade: number; readonly what: "widened window" | "bricked window" | "dropped fascia" | "new door" } | null;
  readonly interior: Interior;
  readonly signs: readonly Sign[];
};

export type UpperUse = {
  readonly storey: number;
  readonly use: "apartments" | "offices" | "lodge hall" | "storage" | "hotel rooms" | "empty";
  /** The windows of that storey's front. */
  readonly windows: readonly WindowState[];
};

/** A window of a house, an apartment or an upper floor, as a drawing can use it. */
export type WindowState = {
  readonly wall: "front" | "left" | "right";
  readonly storey: number;
  readonly s: number;
  readonly state: WindowTreatment;
  readonly sill: "none" | "plant" | "lamp";
};

export type BuildingUse = {
  readonly building: number;
  /** The street it fronts, or "". */
  readonly street: string;
  /** Null for a pier. */
  readonly frame: FrontFrame | null;
  readonly units: readonly Unit[];
  /** The street door to the stairs of the upper floors, which lies inside one unit's frontage. */
  readonly stair: { readonly s: number; readonly width: number } | null;
  readonly upper: readonly UpperUse[];
  /** The signs of the building as a whole: a church's board, the school's name, the fire hall's district. */
  readonly signs: readonly Sign[];
  /** Every window of a dwelling (a house, an apartment house, a rooming house), and its front door. */
  readonly windows: readonly WindowState[];
  readonly door: { readonly s: number; readonly width: number } | null;
};

/** An oriented rectangle of the plan's frame: its centre, the unit vector `u` along it, and half extents along `u` and across it. */
export type Box = { readonly cx: number; readonly cz: number; readonly ux: number; readonly uz: number; readonly hu: number; readonly hv: number };

export type VehicleKind = "pickup" | "sedan" | "suv" | "van" | "work truck" | "camper";
/** Why a vehicle is where it is: a daily driver, a work vehicle with its gear, a project car on blocks, a derelict left to rot. */
export type VehicleState = "daily" | "work" | "project" | "derelict";
export type VehicleSpot = "curb" | "drive" | "yard" | "lot" | "pull-off" | "harbour";
export type VehicleLoad = "none" | "gear" | "rack" | "flatbed" | "tarp" | "firewood" | "ladder";

/** A parked vehicle: a generic shape of its type. `hx, hz` is the way it faces (a unit vector); `colour` indexes the drawing's paint table. */
export type Vehicle = {
  readonly id: number;
  readonly kind: VehicleKind;
  readonly x: number;
  readonly z: number;
  readonly hx: number;
  readonly hz: number;
  readonly colour: number;
  /** 0 (new) to 1 (ancient): rust, faded clear coat, dented. */
  readonly age: number;
  readonly state: VehicleState;
  readonly load: VehicleLoad;
  readonly spot: VehicleSpot;
  readonly lot: number;
  /** How long it has sat, 0 to 1: grime and the algae along the window seals. */
  readonly idle: number;
  /** A number of its own the drawing varies it from. */
  readonly seed: number;
  /** The footprint: a real model's where it has one (`port/props/vehicleModels.ts`), else the kind's own size. */
  readonly length: number;
  readonly width: number;
  /** The id of the model it is drawn as ("vehicle.sedan_a"), or "" where it is built in code (a camper). */
  readonly model: string;
};

/** A boat trailer, empty or carrying a skiff or a small fibreglass boat, with a tarp over the boat or not and weeds grown through. */
export type BoatTrailer = {
  readonly id: number;
  readonly x: number;
  readonly z: number;
  /** The way the tongue points (a unit vector). */
  readonly hx: number;
  readonly hz: number;
  readonly boat: "skiff" | "runabout" | "none";
  readonly colour: number;
  readonly tarp: boolean;
  readonly weeds: number;
  readonly lot: number;
  readonly seed: number;
  readonly length: number;
  readonly width: number;
};

/** A wooden utility pole. `lx, lz` is how far its top stands off its foot (metres), for the ones that lean. */
export type Pole = {
  readonly id: number;
  readonly street: number;
  readonly x: number;
  readonly z: number;
  readonly height: number;
  readonly lx: number;
  readonly lz: number;
  /** 0 none, 1 a crossarm with insulators (the older streets), 2 a bracket of pins (newer). */
  readonly arm: 0 | 1 | 2;
  readonly transformer: boolean;
  /** A streetlight arm, reaching out over the roadway toward (`ox`, `oz`), or null. */
  readonly light: { readonly ox: number; readonly oz: number } | null;
  /** A cut-off stub of the old pole beside it. */
  readonly stub: boolean;
  /** The next pole along the same line (the wires run to it), or -1. */
  readonly next: number;
  readonly seed: number;
};

/** A service drop: the wire from a pole to the building it feeds, to a point on the building's wall. */
export type Drop = { readonly pole: number; readonly building: number; readonly x: number; readonly z: number; readonly y: number };

export type FenceKind = "picket" | "board" | "wire" | "chain";
/** A run of fence along a lot line, from (ax, az) to (bx, bz), with a gap at a gate. */
export type Fence = {
  readonly id: number;
  readonly lot: number;
  readonly kind: FenceKind;
  readonly ax: number;
  readonly az: number;
  readonly bx: number;
  readonly bz: number;
  /** 0 sound, 1 falling down. */
  readonly wear: number;
  readonly paint: number;
  readonly seed: number;
  /** A gate: its centre's distance from `a` along the run, its width, and how open it hangs (0 shut, 1 swung wide). */
  readonly gate: { readonly at: number; readonly width: number; readonly open: number } | null;
};

export type BinKind = "cart" | "cart tipped" | "dumpster" | "pallets" | "drum";
export type Bin = { readonly id: number; readonly kind: BinKind; readonly x: number; readonly z: number; readonly hx: number; readonly hz: number; readonly colour: number; readonly lot: number; readonly seed: number };

export type MailboxKind = "post" | "cluster";
export type Mailbox = { readonly id: number; readonly kind: MailboxKind; readonly x: number; readonly z: number; readonly hx: number; readonly hz: number; readonly lean: number; readonly colour: number; readonly lot: number; readonly seed: number };

export type GearKind = "pots" | "buoys" | "totes" | "coil" | "net" | "firewood" | "propane" | "pallet stack";
export type Gear = { readonly id: number; readonly kind: GearKind; readonly x: number; readonly z: number; readonly hx: number; readonly hz: number; readonly n: number; readonly colour: number; readonly lot: number; readonly seed: number };

/** What stands on a sidewalk: a trash can (state 0 kept, 1 overflowing, 2 knocked over), a newspaper box (0 shut, 1 empty with its door open), a bench, a hydrant, a planter (0 weedy, 1 dead), a bike rack, a sign post (0 parking, 1 loading, 2 no parking) and a utility pedestal. `lean` is the sine of its tilt; `lot` is the lot it stands in front of. */
export type FurnitureKind = "trash can" | "newspaper box" | "bench" | "hydrant" | "planter" | "bike rack" | "sign post" | "pedestal";
export type Furniture = { readonly id: number; readonly kind: FurnitureKind; readonly x: number; readonly z: number; readonly hx: number; readonly hz: number; readonly state: number; readonly lean: number; readonly colour: number; readonly lot: number; readonly seed: number };

/** A thing dropped or blown and caught: small and solid, never blocking. */
export type LitterKind = "can" | "cup" | "box" | "bottle" | "paper" | "bag" | "butt";
export type Litter = { readonly x: number; readonly z: number; readonly hx: number; readonly hz: number; readonly kind: LitterKind; readonly seed: number };

/** What stands in the streets, yards and docks: decided from the history in `port/props/`, drawn by `game/town/props/`. */
export type PlanProps = {
  readonly vehicles: readonly Vehicle[];
  readonly trailers: readonly BoatTrailer[];
  readonly poles: readonly Pole[];
  readonly drops: readonly Drop[];
  readonly fences: readonly Fence[];
  readonly bins: readonly Bin[];
  readonly mailboxes: readonly Mailbox[];
  readonly gear: readonly Gear[];
  readonly furniture: readonly Furniture[];
  readonly litter: readonly Litter[];
  /** What a walker may not pass through, as boxes of the plan's frame: vehicles, trailers, fence runs, poles, bins, mailboxes, the gear that is heavy. */
  readonly solids: readonly Box[];
};

export type TownPlan = {
  /** TOWN_GEN: the generator's version. */
  readonly version: number;
  readonly kind: TownKind;
  readonly seed: number;
  readonly name: string;
  readonly history: History;
  readonly plats: readonly Plat[];
  readonly seams: readonly Seam[];
  readonly streets: readonly Street[];
  /** The ends of streets that no junction makes, each with what is made there. */
  readonly ends: readonly StreetEnd[];
  /** The roads out of town, and where each goes. */
  readonly roads: readonly Road[];
  readonly blocks: readonly Block[];
  readonly lots: readonly Lot[];
  readonly buildings: readonly Building[];
  /** What is in each building (its trades, names, signs, rooms and windows), one entry a building, by building id. */
  readonly uses: readonly BuildingUse[];
  readonly landmarks: readonly Landmark[];
  /** The downtown: the ids of its blocks, ascending. One connected set of blocks (each shares a street with another of the set) that holds every business of the town (`port/downtown.ts`). */
  readonly downtown: readonly number[];
  /** Four places every town has, open for business, in the downtown: the player's office, lodging, and the town's bar and cafe (`port/places.ts`). */
  readonly places: Places;
  /** The railroad: where streets cross the main line, and the town's own spur. */
  readonly rail: TownRail;
  /** The scattered buildings of the town's thinning edge: each on its own lot (a block of one lot, in `blocks`), with its reason. */
  readonly outskirts: readonly Outskirt[];
  /** The blocks the grid would have had that the land or the budget left as woods, near the town. */
  readonly woods: readonly Woods[];
  readonly spawn: Spawn;
  /** Every place where streets meet (and the alley mouths, road ends, stairs and rail crossings), with its legs, corners and control. */
  readonly junctions: readonly Junction[];
  /** What stands beside each street's roadway and how it was laid, by street id (the sidewalks, curbs and repaving: `port/edges.ts`). */
  readonly edges: readonly StreetEdge[];
  /** How each lot's ground is kept, by lot id (`port/yards.ts`). */
  readonly yards: readonly Yard[];
  /** Why each lot of the town's blocks that has no building has none (`port/buildings.ts`): every empty lot but the harbour's yards and the outskirts' parcels is here. */
  readonly gaps: readonly Gap[];
  /** The vehicles, poles and wires, fences, bins, mailboxes and gear (`port/props/`). */
  readonly props: PlanProps;
  /** The made ground the old plat stands on: convex counter-clockwise polygons between the quay and the natural shore. */
  readonly fill: readonly { readonly polygon: Poly }[];
  /** The quay: the straight edge of the made ground along the old plat, seaward of it the harbour. */
  readonly quay: Quay;
  /** Every deck a person can walk on over the water: aprons, piers, the wharf, sheds' platforms, floats and gangways. */
  readonly decks: readonly Deck[];
  /** The boat basin, boats, pilings, the mill's water, the terminal's yard and barge, and the lights. */
  readonly harbour: Harbour;
  readonly bounds: { readonly x0: number; readonly z0: number; readonly x1: number; readonly z1: number };
  readonly counts: {
    readonly plats: number;
    readonly streets: number;
    /** The town's blocks: the outskirts' lots, each a block of its own, are counted apart. */
    readonly blocks: number;
    readonly outskirts: number;
    readonly lots: number;
    readonly buildings: number;
    readonly open: number;
    readonly vacant: number;
    readonly ruin: number;
  };
};
