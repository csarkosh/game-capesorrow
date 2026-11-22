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
  readonly width: number;
  readonly kind: StreetKind;
  readonly plat: string | null;
  readonly name: string;
  /** True for the street that runs along the seam between two plats. */
  readonly seam?: boolean;
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
  | "bank";

export type Landmark = {
  readonly id: number;
  readonly role: LandmarkRole;
  readonly name: string;
  /** The building it points at. */
  readonly building: number;
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
  readonly blocks: readonly Block[];
  readonly lots: readonly Lot[];
  readonly buildings: readonly Building[];
  readonly landmarks: readonly Landmark[];
  readonly spawn: Spawn;
  /** The made ground the old plat stands on: convex counter-clockwise polygons between the quay and the natural shore. */
  readonly fill: readonly { readonly polygon: Poly }[];
  /** The quay: the straight edge of the made ground along the old plat, seaward of it the harbour. */
  readonly quay: { readonly a: Vec; readonly b: Vec };
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
