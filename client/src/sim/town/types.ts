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

export type StreetKind = "highway" | "avenue" | "main" | "street" | "alley" | "wharf" | "rail";

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
  | "industrial";

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
  | "federal building"
  | "courthouse"
  | "tsunami refuge"
  | "tavern"
  | "boarding house"
  | "depot"
  | "customs house"
  | "silo"
  | "garage"
  | "restaurant"
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
  | "fbi"
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

export type Light = { readonly kind: "harbour light" | "day beacon" | "pier light"; readonly x: number; readonly z: number; readonly height: number };

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

export type Spawn = { readonly x: number; readonly z: number; readonly yaw: number };

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
  readonly landmarks: readonly Landmark[];
  readonly spawn: Spawn;
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
    readonly blocks: number;
    readonly lots: number;
    readonly buildings: number;
    readonly open: number;
    readonly vacant: number;
    readonly ruin: number;
  };
};
