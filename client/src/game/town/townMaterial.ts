/**
 * The town's material plugin on Babylon Lite's PBR material: scanned PBR textures on the town's polygons, and the wear that
 * breaks them up. The geometry's side of it is `MeshBuilder.poly`'s `surface` (`townSurface.ts`, `townLayers.ts`); the images
 * are loaded by `townTextures.ts`.
 *
 * **A vertex carries**, beside Lite's own position, normal, colour (the flat colour) and UV, two more attributes in the mesh's
 * plugin vertex data (`Mesh.pluginVertexData`: twelve numbers a vertex, packed as 16-bit floats, 24 bytes, one interleaved buffer; `surfacePack.ts`):
 *
 * - `townSurface` (floats 0 to 3): x, the texture layer's index (`townLayers.ts`), or -1 (`NO_LAYER`) for a vertex that is
 *   flat colour, drawn as every town vertex was before this material (read rounded, since the interpolation across a polygon
 *   may leave it a hair off); y, the wear's amount, 0 to 1, a share of the surface; z, the wear's kind: 0 moss and grime (the
 *   `moss` layer lies over it), 1 rust (the `rust` layer); w, unused, zero.
 * - `townTint` (floats 4 to 7): the colour the texture is multiplied by once the textures have landed (rgb; a paintable
 *   layer's paint, white for the others, a shade near it for variation). Until they land, and for a vertex with no layer,
 *   the vertex colour is the flat colour, as it always was.
 *
 * The UV is in texture tiles: metres over the layer's tile size, which the builder has made from the surface's frame.
 *
 * **Where the WGSL goes into the PBR shader** (the engine's terrain and wet plugins are the worked examples):
 *
 * - `CUSTOM_VERTEX_MAIN_END` hands `townSurface` on as the varying `vTownSurface`.
 * - `CUSTOM_FRAGMENT_DEFINITIONS` holds the layer table, the noise and the helpers.
 * - `CUSTOM_FRAGMENT_UPDATE_DIFFUSE`, priority 200 (after `baseColourPlugin`, 100; before the wet look's, 240): the whole
 *   surface. It runs where Lite has the base colour (the flat vertex colour), `N`, `roughness` and `occlusion` and has not yet
 *   made `V`, so setting `N` here is what every later term (the wet look, the lights, the specular) sees. It samples the
 *   layer's colour and data arrays by the UV, multiplies the colour by the tint (`townTint`; a paintable layer's neutral
 *   detail is first scaled back up by the paint gain), takes roughness from the data and sets the normal, and lays the wear's
 *   overlay layer over the result; the base colour becomes the textured colour times the occlusion. The wet look's weather
 *   share then reads the roughness this left, and `baseColourPlugin`'s `surfaceAlbedo=baseColor` the colour.
 *   Metallic stays 0: rust and metal sheet are drawn as dielectrics.
 * - `CUSTOM_FRAGMENT_LIGHT` and `CUSTOM_FRAGMENT_BEFORE_FINALCOLORCOMPOSITION`: the sky a pixel sees (`skyShade.ts`). A textured corner says
 *   how far it stands over the ground and under its roof (`townWear`.z and w), the surface code turns the two into `townSky`, and the sky's
 *   light is scaled by it where each part of it is summed: the fill light in the light loop, the environment's diffuse and reflection at the
 *   composition. The sun's light and the surface's colour are untouched.
 *
 * **The normal.** There is no tangent attribute. The tangent frame is made in the fragment stage from screen-space
 * derivatives of the world position and the UV (the cotangent frame: no attribute, right for any UV, mirrored ones too), the
 * map's x and y are in the OpenGL convention (green up; the loader turns the images over, so v = 0 is the image's bottom row),
 * and z is rebuilt from them. The derivatives are taken before the branch on the layer, so the whole quad has them.
 *
 * **The wear.** `townWear` is value noise in world space, three octaves (cells of about 1.1 m, 0.43 m and 0.16 m; two on the
 * low tier), stretched so that the amount is about the share of the surface it covers, and compared with the amount: the
 * surface is worn where the noise is under it, with a soft edge of `WEAR_EDGE` of the noise's range. Patches, never a gradient. The
 * overlay is sampled with the base's UV scaled by the ratio of the two layers' tile sizes, so it is at its own true scale.
 *
 * **Until the images land** `townReady` (a uniform) is 0 and the plugin does nothing: the town draws as flat vertex colour
 * with no flash of black, and the arrays are bound from the start as empty textures that are filled in place.
 *
 * **Wear, second edition.** A vertex carries two wears (`townSurface`.y and z, and `townWear`.x and y, laid one over the other), each an
 * amount and a kind: moss (the moss layer, lifted and turned green), rust, peel (the peeling-boards layer: bare wood and flaking paint),
 * algae (the moss layer as a thin, pale green-grey film, half strength) and grime (the mud layer, dark brown, for splash at a wall's
 * foot and the dirt that runs under a sill). A kind's fraction (half) says the wear runs in streaks: the noise is stretched down the
 * surface (about four times finer across than along), which is how water drips down a wall. Where a surface is worn is the builder's
 * (`buildingWear.ts`); the shader only breaks the amount into patches.
 *
 * **Glow and clear (the lit and the see-through).** `townSurface`.w is the glow g: the surface's own colour times g is added to the
 * light before the fog, and the lit colour is scaled by one minus g (at most 1), so 0 is a surface the scene lights, 1 is one that lights
 * itself (a room's walls, a sign's lettering), and more than 1 brightens (a tube, a lit cooler's front). `townTint`.w is how clear the
 * surface is, 0 opaque to 1 invisible, for the blended glass layer: it scales the alpha, and adds the glass's own reflection of the
 * overcast sky (Schlick's fresnel from the eye, so a window seen along its length is a mirror and one seen square-on shows the room).
 * Both work whether or not the textures have landed.
 *
 * **Hours, night codes and lamps.** A layered vertex's float 10 (`townWear`.z) carries the hours of its unit (`HOURS_CODE`, `hours.ts`) or, in a second band of codes, a night code
 * (a lamp's lens, a lit window, a porch light): the glow is kept by how lit the code is at the hour. The sign layer's flat vertices carry a shop's hours the same way. The
 * nearest lamps' light (`lampLight.ts`) is added to a layered surface's glow by `LAMP_CODE`, from a list of uniforms written once a frame by `townParts.ts`.
 *
 * **Tiers.** The low tier's arrays are 256 x 256 (a quarter of the memory and of the upload), its overlay takes only the
 * overlay's colour and roughness (no second normal), and its wear noise has two octaves.
 */
import {
  ALWAYS_CODE, CODE_BASE, CODE_STRIDE, DAWN_HOUR, DUSK_HOUR, FADE_HOURS, HOURS_PER_DAY, NIGHT_BASE, NIGHT_FADE_HOURS, NIGHT_LEAD_HOURS, OFF_FIRST_HOUR, OFF_STEPS, OFF_STEP_HOURS, ON_STEP_HOURS, UNTIL_DAWN,
} from "./hours.js";
import { MAX_LAMPS, type LampList } from "./lampLight.js";
import { SURFACE_PACKED_BYTES } from "./surfacePack.js";
import { KNOCK_OVER, KNOCK_UNDER, PAINT_RANKS } from "./paint.js";
import type { MaterialPlugin, Texture2DArray } from "@babylonjs/lite";
import { uniformFields, writeUniforms, type UniformField } from "@csarkosh/engine/game/lite/pluginUniforms";
import { FRAME_BLOCK } from "@csarkosh/engine/game/lite/frameBlock";
import { NIGHT_BIAS } from "./meshBuilder.js";
import { INTERIOR_LAYERS } from "./interiorLayers.js";
import { PAINT_GAIN, TOWN_LAYERS, WEAR_OVERLAY, layerIndex } from "./townLayers.js";
import { EAVE_CODE, EAVE_REACH, EAVE_SHADE, FOOT_CODE, FOOT_REACH, FOOT_SHADE, FOOT_UNIT } from "./skyShade.js";

/** The attribute and varying names. */
export const TOWN_ATTRIBUTE = "townSurface";
export const TOWN_VARYING = "vTownSurface";
export const TOWN_TINT_ATTRIBUTE = "townTint";
export const TOWN_TINT_VARYING = "vTownTint";
/** Floats a vertex's plugin data holds (`SURFACE_FLOATS` in `meshBuilder.ts`). */
export const TOWN_VERTEX_FLOATS = 12;
export const TOWN_WEAR_ATTRIBUTE = "townWear";
export const TOWN_WEAR_VARYING = "vTownWear";

/** How much of the occlusion map darkens the colour: all of it would shade the sun's light by a crevice that a map made for ambient light. */
const AO_STRENGTH = 0.85;
/** The normal map's strength: 1 is the map as scanned. */
const NORMAL_STRENGTH = 1.0;
/**
 * The overlays' colours as they are laid over a surface, the layer's own times these. The moss layer is a dark yellowish
 * olive (a mean linear albedo of 0.07) which the overcast light and the fog turn near black beside a painted wall, and
 * mustard where the sun is on it: lifted and turned toward green. The rust layer is mostly peeling white paint over bluish
 * grey with a little rust: turned toward rust, so a worn metal wall is not patched in lilac.
 */
const MOSS_COLOUR: readonly [number, number, number] = [1.1, 2.3, 0.75];
const RUST_COLOUR: readonly [number, number, number] = [1.35, 0.8, 0.5];
/** The low tier's light is brighter and bluer than the other tiers' (it has no post chain to grade the frame), and the lifted moss is lime in it: a third less. */
const LOW_MOSS = 0.65;
/** The soft edge of a worn patch, as a share of the noise's range. */
const WEAR_EDGE = 0.1;
/** How metallic bare metal sheet is, 0 to 1: a painted or weathered sheet is not a mirror. */
const METAL_AMOUNT = 0.5;

const f = (n: number): string => (Number.isInteger(n) ? n.toFixed(1) : String(n));

/**
 * The layers a plugin's arrays hold, as the shader needs them: each one's tile size and whether it is paint, where the wear's overlay layers are, and which
 * layers are bare metal. The town's (`TOWN_SET`, which is what the plugin always was); the rooms' set has no overlay and no bare metal (`INTERIOR_SET`: a
 * surface in a room is not worn, `insideLayers.ts`, so the overlays' indices are never read and name its first layer so that they are valid).
 */
export type LayerSet = {
  readonly layers: readonly { readonly tile: readonly [number, number]; readonly paintable: boolean }[];
  readonly overlay: { readonly moss: number; readonly rust: number; readonly peel: number; readonly mud: number };
  readonly metal: readonly number[];
};

export const TOWN_SET: LayerSet = {
  layers: TOWN_LAYERS,
  overlay: { moss: layerIndex(WEAR_OVERLAY.moss), rust: layerIndex(WEAR_OVERLAY.rust), peel: layerIndex(WEAR_OVERLAY.peel), mud: layerIndex(WEAR_OVERLAY.mud) },
  metal: [layerIndex("metal_aged"), layerIndex("metal_painted"), layerIndex("roof_metal")],
};

export const INTERIOR_SET: LayerSet = { layers: INTERIOR_LAYERS, overlay: { moss: 0, rust: 0, peel: 0, mud: 0 }, metal: [] };

/** The WGSL the plugin adds at `CUSTOM_FRAGMENT_DEFINITIONS`: the layer table (tile size across and up, and the colour's gain), the overlays' indices, and the noise. */
export function townDefinitions(low: boolean, set: LayerSet = TOWN_SET): string {
  const table = set.layers.map((layer) => `vec4<f32>(${f(layer.tile[0])},${f(layer.tile[1])},${f(layer.paintable ? PAINT_GAIN : 1)},0.0)`).join(",");
  const { moss, rust, peel, mud } = set.overlay;
  const octave3 = low ? "" : "+townValue(p*6.1+vec3<f32>(5.0,29.0,2.0))*0.15";
  const weights = low ? "townValue(p*0.9)*0.65+townValue(p*2.3+vec3<f32>(17.0,3.0,11.0))*0.35" : "townValue(p*0.9)*0.55+townValue(p*2.3+vec3<f32>(17.0,3.0,11.0))*0.3";
  return [
    `const TOWN_MOSS:i32=${moss};`,
    `const TOWN_RUST:i32=${rust};`,
    // The overlay layer and the grade of each wear kind: moss, rust, peel, algae, grime (xyz the colour's multiplier, w how much of it is laid).
    `var<private> townOver:array<i32,9>=array<i32,9>(${moss},${rust},${peel},${moss},${mud},${mud},${moss},${moss},${mud});`,
    `var<private> townGrade:array<vec4<f32>,9>=array<vec4<f32>,9>(vec4<f32>(${MOSS_COLOUR.map((c) => f(low ? Math.round(c * LOW_MOSS * 10) / 10 : c)).join(",")},1.0),vec4<f32>(${RUST_COLOUR.map(f).join(",")},1.0),vec4<f32>(1.7,1.55,1.4,1.0),vec4<f32>(0.9,1.55,0.8,0.8),vec4<f32>(0.5,0.46,0.4,0.9),vec4<f32>(0.03,0.03,0.04,1.0),vec4<f32>(1.1,2.4,0.55,1.0),vec4<f32>(1.5,1.0,0.35,1.0),vec4<f32>(0.78,0.8,0.82,0.9));`,
    // The colour of moss and growth at a place: olive, grey-green or brown by a slow noise, and now and then near black (a damp patch).
    "fn townMossGrade(p:vec3<f32>,k:i32)->vec3<f32>{",
    "let v=townValue(p*0.23+vec3<f32>(3.0,9.0,5.0));",
    "var c=mix(vec3<f32>(1.15,1.0,0.72),vec3<f32>(0.95,1.18,0.68),smoothstep(0.25,0.55,v));",
    "c=mix(c,vec3<f32>(0.9,1.04,0.92),smoothstep(0.55,0.8,v));",
    "let d=townValue(p*0.11+vec3<f32>(21.0,2.0,14.0));",
    "c=c*mix(1.0,0.5,smoothstep(0.7,0.9,d));",
    "if(k==6){c=c*vec3<f32>(1.0,1.08,0.9);}",
    "return c;}",
    "var<private> townGlowC:vec3<f32>=vec3<f32>(0.0,0.0,0.0);",
    "var<private> townGlassA:f32=0.0;",
    // How much of the sky's light the pixel takes (`SKY_CODE`), and the lights' sum before the light at hand (`TOWN_LIGHT_CODE`).
    "var<private> townSky:f32=1.0;",
    "var<private> townDd:vec3<f32>=vec3<f32>(0.0,0.0,0.0);",
    "var<private> townGlassC:vec3<f32>=vec3<f32>(0.0,0.0,0.0);",
    "var<private> townSignA:f32=1.0;",
    `var<private> townInfo:array<vec4<f32>,${set.layers.length}>=array<vec4<f32>,${set.layers.length}>(${table});`,
    "fn townHash(c:vec3<i32>)->f32{",
    "var h=bitcast<u32>(c.x)*374761393u+bitcast<u32>(c.y)*668265263u+bitcast<u32>(c.z)*2147483647u;",
    "h=(h^(h>>13u))*1274126177u;h=h^(h>>16u);",
    "return f32(h&16777215u)/16777216.0;}",
    "fn townValue(p:vec3<f32>)->f32{",
    "let i=floor(p);let q=fract(p);let s=q*q*(3.0-2.0*q);let c=vec3<i32>(i);",
    "let a=mix(mix(townHash(c),townHash(c+vec3<i32>(1,0,0)),s.x),mix(townHash(c+vec3<i32>(0,1,0)),townHash(c+vec3<i32>(1,1,0)),s.x),s.y);",
    "let b=mix(mix(townHash(c+vec3<i32>(0,0,1)),townHash(c+vec3<i32>(1,0,1)),s.x),mix(townHash(c+vec3<i32>(0,1,1)),townHash(c+vec3<i32>(1,1,1)),s.x),s.y);",
    "return mix(a,b,s.z);}",
    "fn townWear(p:vec3<f32>,amount:f32)->f32{",
    `var n=${weights}${octave3};`,
    "n=clamp((n-0.5)*2.4+0.5,0.0,1.0);",
    `let e=${f(WEAR_EDGE)};let t=amount*(1.0+2.0*e)-e;`,
    "return 1.0-smoothstep(t-e,t+e,n);}",
  ].join("");
}

/** The WGSL of one wear slot: `amountExpr` and `kindExpr` are the vertex's; it changes tsRgb, tsN, tsRough and tsAo. */
function wearSlot(amountExpr: string, kindExpr: string, low: boolean, n: string): string {
  const overData = low
    ? `tsRough=mix(tsRough,tsOd${n}.z,tsW${n});`
    : `tsN=mix(tsN,vec2<f32>(tsOd${n}.x*2.0-1.0,tsOd${n}.y*2.0-1.0),tsW${n});tsRough=mix(tsRough,tsOd${n}.z,tsW${n});tsAo=mix(tsAo,clamp(tsOd${n}.w*2.0-1.0,0.0,1.0),tsW${n});`;
  // A mark of its own kind (oil, growth, leaf: laid on the ground as a polygon over the ground's own material) is cut out by the noise where it is not worn, so its edge is ragged and no polygon shows (first wear only).
  const cut = n === "1" ? `if(${kindExpr}>=4.99&&tsA1<0.004){discard;}` : "";
  const cut2 = n === "1" ? `if(tsK1>=5&&tsW1<0.03){discard;}` : "";
  return [
    `let tsA${n}=${amountExpr};`,
    cut,
    `if(tsA${n}>0.001){`,
    `let tsKf${n}=${kindExpr}+0.01;let tsK${n}=clamp(i32(floor(tsKf${n})),0,8);`,
    `var tsWp${n}=input.worldPos;`,
    `if(fract(tsKf${n})>0.25){tsWp${n}=vec3<f32>(tsWp${n}.x*6.5,tsWp${n}.y*0.45,tsWp${n}.z*6.5);}`,
    `let tsW${n}=townWear(tsWp${n},tsA${n})*townGrade[tsK${n}].w;`,
    `tsWm=max(tsWm,tsW${n});`,
    cut2,
    `if(tsW${n}>0.004){`,
    `let tsOver${n}=townOver[tsK${n}];`,
    `let tsScale${n}=tsInfo.xy/townInfo[tsOver${n}].xy;`,
    `let tsUvO${n}=input.uv*tsScale${n};let tsDxO${n}=tsDx*tsScale${n};let tsDyO${n}=tsDy*tsScale${n};`,
    `let tsOc${n}=textureSampleGrad(townColor,townSmp,tsUvO${n},tsOver${n},tsDxO${n},tsDyO${n}).rgb;`,
    `let tsOd${n}=textureSampleGrad(townData,townSmp,tsUvO${n},tsOver${n},tsDxO${n},tsDyO${n});`,
    // Moss and growth are not paint: their colour is olive, grey-green or brown (by a slow noise) and never brighter than the surface they lie on (its own luminance, times 0.8, caps it),
    // and where they are thin (the wear's soft edge) they tint and darken the surface, which keeps a share of itself everywhere (at most 0.85 laid), so its grain reads through.
    `if(tsK${n}==0||tsK${n}==6){let tsMc${n}=tsOc${n}*townMossGrade(input.worldPos,tsK${n});let tsLb${n}=dot(tsRgb,vec3<f32>(0.2126,0.7152,0.0722));let tsLm${n}=max(dot(tsMc${n},vec3<f32>(0.2126,0.7152,0.0722)),0.0001);tsRgb=mix(tsRgb,tsMc${n}*min(1.0,tsLb${n}*0.8/tsLm${n}),tsW${n}*(0.4+0.45*tsW${n}));}else{tsRgb=mix(tsRgb,tsOc${n}*townGrade[tsK${n}].xyz,tsW${n});}`,
    overData,
    "}",
    "}",
  ].join("");
}

/**
 * Slat blinds, as one face (`windowDressing.ts`): a flat-coloured vertex whose spare float 10 carries the slats' pitch in millimetres is striped by the height in the
 * world, slat 62 parts in 100 and gap the rest. The gaps are cut out while a slat is wider than a pixel can lose (the stripe's period under about 0.7 pixel's
 * footprint); farther, the pixel is shaded by the stripe's average over its own footprint (the box-filtered duty, `fwidth` of the height), gaps a darker room's shade, so
 * a blind too fine to see is one evenly shaded panel and does not flicker as the player walks.
 */
const BLIND_CODE = [
  "if(tsLayer<0&&tsWearV.z>0.5){",
  "let bpp=tsWearV.z*0.001;let by=input.worldPos.y/bpp;let bw=max(fwidth(by),0.0001);",
  "let ba=by-bw*0.5;let bb=by+bw*0.5;",
  "let bf=floor(bb)*0.62+min(fract(bb),0.62)-floor(ba)*0.62-min(fract(ba),0.62);",
  "let bc=clamp(bf/bw,0.0,1.0);",
  "if(bw<0.7&&fract(by)>=0.62){discard;}",
  "baseColor=baseColor*mix(1.0,mix(0.5,1.0,bc),smoothstep(0.5,1.0,bw));",
  "}",
].join("");

/**
 * Wires: a vertex whose spare float 10 is negative is a wire's, the radius in millimetres. A wire thinner than a pixel flickers as the player moves, so the vertex
 * stage pushes each vertex of it out along its (radial) normal until its radius is at least 0.94 mm a metre of distance (1.2 pixels across at 1080p, a pixel being
 * 1.56 mm a metre) and the fragment stage blends its colour toward the sky's by the share of the width that is not the wire's own, so the wider line is no heavier than the real one.
 */
const WIRE_PX = 0.00094 * 1.4;
export const WIRE_VERTEX = `if(townWear.z<-0.5){let wp0=(finalWorld*vec4<f32>(position,1.0)).xyz;let wd=length(wp0-scene.vEyePosition.xyz);let wr=-townWear.z*0.001;let wx=max(0.0,${WIRE_PX.toExponential(4)}*wd-wr);finalWorld[3]=vec4<f32>(finalWorld[3].xyz+normalize(normal)*wx,finalWorld[3].w);}`;
const WIRE_CODE = `if(tsLayer<0&&tsWearV.z<-0.5){let wr=-tsWearV.z*0.001;let wd=length(scene.vEyePosition.xyz-input.worldPos);let wk=wr/max(wr,${WIRE_PX.toExponential(4)}*wd);baseColor=mix(vec3<f32>(0.2,0.22,0.25),baseColor,wk);}`;

/**
 * What a shut room is lit by: not its own lamps but the day, or the night, outside. A room's baked colour is its own light (a glow), which
 * the hour of the sky does not touch, so a shut room dimmed to a share of its glow would stand as bright at midnight as at noon, and brighter
 * to the eye, which the frame's exposure follows into the dark. So a shut room's colour is handed back to the scene's light, this share of it
 * (a little blue: what comes in at the glass): dim by day, and at night as dark as the street's own shadows.
 */
export const SHUT_LIGHT: readonly [number, number, number] = [0.42, 0.45, 0.52];

/**
 * A room's hours (`hours.ts`): a layered vertex whose spare float 10 is over a half carries its unit's hours code. The glow is kept by how
 * open the unit is at the hour, and the rest of it is lit by the scene (`SHUT_LIGHT`) (`material.townHour`): the arithmetic of `openShare`, written from `hours.ts`'s own constants (the distance to the
 * nearer edge of the hours, which side of it the hour is on, a ramp over `FADE_HOURS` either side). Code `ALWAYS_CODE` is never shut.
 */
export function hoursCodeFor(sign: boolean): string {
  return [
  `if(${sign ? "" : "tsLayer>=0&&"}tsWearV.z>0.5){`,
  // A night code (a lamp's lens, a lit window, a porch light): `nightShare` of `hours.ts`. With the share at 0 the surface is what the scene lights, with
  // none of its own glow; a lens (a glow of 1 or more) is then dull grey glass, its colour kept for the night.
  `if(tsWearV.z>${f(NIGHT_BASE - 0.5)}){`,
  `let nk=tsWearV.z-${f(NIGHT_BASE)};let non=floor(nk/${f(OFF_STEPS)});let noff=nk-non*${f(OFF_STEPS)};let nh=material.townHour;`,
  `let nt=select(nh+${f(HOURS_PER_DAY)},nh,nh>=12.0);`,
  `let non_t=${f(DUSK_HOUR - NIGHT_LEAD_HOURS)}+non*${f(ON_STEP_HOURS)};`,
  `let noff_t=select(${f(OFF_FIRST_HOUR)}+noff*${f(OFF_STEP_HOURS)},${f(DAWN_HOUR + HOURS_PER_DAY)},noff>${f(UNTIL_DAWN - 0.5)});`,
  `let nin=(nt>=non_t)&&(nt<noff_t);let nd=min(abs(nt-non_t),abs(nt-noff_t));`,
  `let nsh=clamp(0.5+select(-nd,nd,nin)/${f(2 * NIGHT_FADE_HOURS)},0.0,1.0)*select(0.0,1.0,noff_t>non_t);`,
  "let nown=townGlowC;townGlowC=nown*nsh;",
  "let nbase=nown/max(tsSurf.w,1.0);",
  "let ndull=mix(nbase,vec3<f32>(dot(nbase,vec3<f32>(0.2126,0.7152,0.0722))*0.6),step(1.0,tsSurf.w));",
  "baseColor=baseColor+ndull*(1.0-nsh);",
  "}else{",
  `var hsh=1.0;if(tsWearV.z<${f(ALWAYS_CODE - 0.5)}){`,
  `let hk=tsWearV.z-${f(CODE_BASE)};let ho=floor(hk/${f(CODE_STRIDE)});let hz=hk-ho*${f(CODE_STRIDE)};let hh=material.townHour;`,
  "let hin=select((hh>=ho)||(hh<hz),(hh>=ho)&&(hh<hz),ho<hz);",
  `let h1=abs(hh-ho);let h2=abs(hh-hz);let hd=min(min(h1,${f(HOURS_PER_DAY)}-h1),min(h2,${f(HOURS_PER_DAY)}-h2));`,
  `hsh=clamp(0.5+select(-hd,hd,hin)/${f(2 * FADE_HOURS)},0.0,1.0);}`,
  `let hown=townGlowC;townGlowC=hown*hsh;baseColor=baseColor+hown*vec3<f32>(${SHUT_LIGHT.map(f).join(",")})*(1.0-hsh);}`,
  "}",
].join("");
}

/** The hours decode of the layered surfaces (a lit sign's, on the flat vertices of the sign layer, is `hoursCodeFor(true)`). */
export const HOURS_CODE = hoursCodeFor(false);

/**
 * The light of the nearest lamps (`lampLight.ts`), added to the glow of a layered surface: for each lamp in the list, the surface's own colour times the
 * lamp's colour and strength times a falloff (full out to `LAMP_FULL` of the range, then smooth to nothing at the range) times how much the surface faces
 * the lamp (a soft wrap, so a wall just past square is not black). The lamps are a list of uniforms (`lampP0`..: position and range, `lampC0`..: colour and strength) read into
 * private arrays only when there is a lamp (`townLamps`), so the day pays nothing. The glow is added before the fog, as the other glows are; the exposure
 * follows the sky into the dark, so `LAMP_GAIN` was set by looking at the town at night.
 */
export const LAMP_FULL = 0.25;
export const LAMP_GAIN = 1.2;
export const LAMP_WRAP = 0.3;
export const LAMP_CODE = [
  "if(material.townLamps>0.5&&tsLayer>=0){",
  `var tsLP:array<vec4<f32>,${MAX_LAMPS}>;var tsLC:array<vec4<f32>,${MAX_LAMPS}>;`,
  ...Array.from({ length: MAX_LAMPS }, (_, i) => `tsLP[${i}]=material.lampP${i};tsLC[${i}]=material.lampC${i};`),
  "var tsLamp=vec3<f32>(0.0);",
  "for(var li:i32=0;li<i32(material.townLamps+0.5);li=li+1){",
  "let lp=tsLP[li];let lc=tsLC[li];let ld=lp.xyz-input.worldPos;let lr=length(ld);",
  "if(lr<lp.w){",
  `let lq=clamp((lr-lp.w*${f(LAMP_FULL)})/(lp.w*${f(1 - LAMP_FULL)}),0.0,1.0);let lf=1.0-lq*lq*(3.0-2.0*lq);`,
  `let lw=clamp((dot(N,ld/max(lr,0.001))+${f(LAMP_WRAP)})/${f(1 + LAMP_WRAP)},0.0,1.0);`,
  `tsLamp=tsLamp+lc.rgb*(lc.w*lf*lw*lw);}`,
  "}",
  `townGlowC=townGlowC+tsBase0*tsLamp*${f(LAMP_GAIN)};`,
  "}",
].join("");

/**
 * The sky a textured pixel sees (`skyShade.ts`): its corner's two codes, the height over the ground and the depth under the roof, each eased from
 * its shade to 1 over its reach, and their product kept in `townSky`. A code of 0 is none. The first shares its float with a room's hours
 * (`HOURS_CODE`): it is under a half, and an hours' code is 1 or more. The flat ground's material (`ranked`) carries its depth rank where the
 * second code would be, and reads the first alone.
 */
function skyCode(ranked: boolean): string {
  const ramp = (has: string, code: string, base: number, reach: number, shade: number): string =>
    `if(${has}){let tsT=clamp((${code}-${f(base)})/${f(reach)},0.0,1.0);tsSk=tsSk*mix(${f(shade)},1.0,tsT*tsT*(3.0-2.0*tsT));}`;
  const foot = ramp(`tsWearV.z>${(0.25 * FOOT_UNIT).toExponential(4)}&&tsWearV.z<0.5`, `tsWearV.z*${f(1 / FOOT_UNIT)}`, FOOT_CODE, FOOT_REACH, FOOT_SHADE);
  const eave = ramp("tsWearV.w>0.25", "tsWearV.w", EAVE_CODE, EAVE_REACH, EAVE_SHADE);
  return `if(tsLayer>=0){var tsSk=1.0;${foot}${ranked ? "" : eave}townSky=tsSk;}`;
}

/**
 * The WGSL at `CUSTOM_FRAGMENT_LIGHT`, inside the light loop after a light's diffuse term is added: the sky's fill (every light but the sun, which
 * is the directional one) is scaled by `townSky`. The sun's light is left whole: a wall's foot in the sun is lit by it.
 */
export const TOWN_LIGHT_CODE =
  "{let tsLd=directDiffuse-townDd;if(u32(lights.lights[lightIndex].vLightData.w)!=1u){directDiffuse=townDd+tsLd*townSky;}townDd=directDiffuse;}";

/**
 * A glow with no hours of its own is the day's: paper in a vacant shop's glass, an office's blinds, a sticker on a pane glow a little as daylight
 * comes through or falls on them, and nothing lights them at night. So such a glow is kept by how much day there is (`material.townDay`, 1 by day
 * and 0 at night: `look.ts`, `daylightAt`) and the rest of the surface is handed back to the scene's light, which at night is the dark and the lamps.
 */
export const DAY_GLOW_CODE =
  "if(tsSurf.w>0.001&&tsLayer>=0&&tsWearV.z<=0.5){baseColor=baseColor+tsBase0*clamp(tsSurf.w,0.0,1.0)*(1.0-material.townDay);townGlowC=townGlowC*material.townDay;}";

/**
 * How bright it is outside, 0 to 1, from what the air already knows: the mean of the air's far colour (`atmFarColour`: the dome's horizon, which follows the hour and the weather and is what a pane's
 * reflection reads too, `townAlphaCode`). Measured under the engine's sky: 0.03 at night (clear or not), 0.56 at clear noon, 0.40 under the game's own overcast, 0.28 in heavy rain, 0.43 at clear dusk and
 * 0.23 at its overcast dusk. 0 up to `ROOM_NIGHT_BELOW` and 1 from `ROOM_DAY_FROM`, smooth between; no clock of its own.
 */
export const ROOM_NIGHT_BELOW = 0.045;
export const ROOM_DAY_FROM = 0.55;
/** The WGSL that mixes a room's night colour with its day colour by that: the ratios are the two floats a textured corner of a room leaves unused (red in the second wear's kind, blue in the rank), as 2 + the ratio; green is read between them. */
export const ROOM_NIGHT_CODE = [
  `if(tsWearV.w>${(NIGHT_BIAS - 0.01).toFixed(2)}){`,
  `var tsOut=clamp((dot(${FRAME_BLOCK}.atmFarColour,vec3<f32>(0.3333))-${ROOM_NIGHT_BELOW.toFixed(3)})/${(ROOM_DAY_FROM - ROOM_NIGHT_BELOW).toFixed(3)},0.0,1.0);`,
  "tsOut=tsOut*tsOut*(3.0-2.0*tsOut);",
  `let tsRr=tsWearV.y-${NIGHT_BIAS.toFixed(1)};let tsRb=tsWearV.w-${NIGHT_BIAS.toFixed(1)};`,
  "baseColor=baseColor*mix(vec3<f32>(tsRr,sqrt(max(tsRr*tsRb,0.0)),tsRb),vec3<f32>(1.0,1.0,1.0),tsOut);",
  "}",
].join("");

/** The WGSL at `CUSTOM_FRAGMENT_UPDATE_DIFFUSE`: the surface, as the header says. */
export function townSurfaceCode(low: boolean, sign = false, ranked = false, set: LayerSet = TOWN_SET, night = set !== TOWN_SET): string {
  return [
    `let tsSurf=input.${TOWN_VARYING};`,
    `let tsWearV=input.${TOWN_WEAR_VARYING};`,
    "let tsLayer=i32(floor(tsSurf.x+0.5));",
    "let tsDx=dpdx(input.uv);let tsDy=dpdy(input.uv);let tsPx=dpdx(input.worldPos);let tsPy=dpdy(input.worldPos);",
    skyCode(ranked),
    "if(material.townReady>0.5&&tsLayer>=0){",
    "let tsInfo=townInfo[tsLayer];",
    "let tsCol=textureSampleGrad(townColor,townSmp,input.uv,tsLayer,tsDx,tsDy).rgb*tsInfo.z;",
    "let tsData=textureSampleGrad(townData,townSmp,input.uv,tsLayer,tsDx,tsDy);",
    "var tsN=vec2<f32>(tsData.x*2.0-1.0,tsData.y*2.0-1.0);",
    "var tsRough=tsData.z;var tsAo=clamp(tsData.w*2.0-1.0,0.0,1.0);",
    `var tsRgb=input.${TOWN_TINT_VARYING}.rgb*tsCol;`,
    "var tsWm=0.0;",
    wearSlot("tsSurf.y", "tsSurf.z", low, "1"),
    wearSlot("tsWearV.x", "tsWearV.y", low, "2"),
    `tsN*=${f(NORMAL_STRENGTH)};`,
    "let tsNz=sqrt(max(1.0-dot(tsN,tsN),0.0));",
    "let tsDp2=cross(tsPy,N);let tsDp1=cross(N,tsPx);",
    "let tsT=tsDp2*tsDx.x+tsDp1*tsDy.x;let tsB=tsDp2*tsDx.y+tsDp1*tsDy.y;",
    "let tsInv=inverseSqrt(max(max(dot(tsT,tsT),dot(tsB,tsB)),1e-20));",
    "N=normalize(tsT*tsInv*tsN.x+tsB*tsInv*tsN.y+N*tsNz);",
    `baseColor=tsRgb*mix(1.0,tsAo,${f(AO_STRENGTH)});`,
    "roughness=clamp(tsRough,0.05,1.0);",
    // Bare metal is metal: sheet that is not rusted or painted over shines as the conductor it is, and the wear takes it away.
    ...(set.metal.length === 0 ? [] : [`if(${set.metal.map((i) => `tsLayer==${i}`).join("||")}){metallic=${f(METAL_AMOUNT)}*(1.0-clamp(tsWm*1.6,0.0,1.0));}`]),
    "}",
    // A designed room's colour at night rides with its colour by day (`NIGHT_RATIOS`): the room is mixed from the one to the other by how bright it is outside.
    ...(night ? [ROOM_NIGHT_CODE] : []),
    // The glow: the colour as it stands (flat or textured) lights itself by `tsSurf.w`, and the scene lights what is left.
    "let tsBase0=baseColor;",
    `if(tsSurf.w>0.001){townGlowC=baseColor*tsSurf.w;baseColor=baseColor*(1.0-clamp(tsSurf.w,0.0,1.0));${sign ? hoursCodeFor(true) : HOURS_CODE}}`,
    DAY_GLOW_CODE,
    sign ? "" : BLIND_CODE,
    WIRE_CODE,
    LAMP_CODE,
  ].join("");
}

/**
 * A sign's face: the lettering atlas read by the UV as given (v from the top), its colour times the tint, its alpha the atlas's (carried to the
 * alpha term in `townSignA`). Added to the surface code of the sign layer's material alone.
 */
const SIGN_CODE = "let tsSg=textureSample(townSign,townSignSmp,input.uv,0);baseColor=tsSg.rgb*input.vTownTint.rgb;townSignA=tsSg.a;";

/**
 * The colour of the film a pane lays over what is behind it, linear: a dark grey-blue, the tone of old glass with the day on it. Dark, so that
 * the dim back of a room goes into it and the lit front of the room still shows through; a pale film (0.1 and over) washed the whole window out to grey.
 */
export const GLASS_FILM: readonly [number, number, number] = [0.032, 0.038, 0.046];

/**
 * Glass, as the blended layer draws it. A pane reflects by direction: the eye's ray is turned off the pane's normal (the wall's, tilted a
 * little by the pane's own fixed turn, `Fx.tilt`, since old glass is never flat and no two panes reflect alike), and where it then points
 * above the horizon the pane shows the overcast sky (paler toward the horizon), where it points level or down it shows the dark, uneven
 * band of the street's far side. How much it reflects is a floor (the sky's a good deal more than the street's) plus Schlick's fresnel
 * from the eye, so a pane seen square-on from the sidewalk shows the lit room behind it, an upper window seen from the street is the sky's
 * pale grey-blue with the room faint behind it, and glass seen along its length is a mirror. Over that lies the grime: a band along the
 * bottom, the lower corners and streaks (`Fx.dirt`, `Fx.size`, the pane's own uv), different for each pane by its `Fx.seed`.
 *
 * A pane is not perfectly clear (`Fx.clear`, `GLASS_CLEAR` in `buildingKit.ts`): the share it keeps back is a film of the overcast day's
 * own grey (`GLASS_FILM`), which is what hides how bare a room is from the street.
 *
 * The result is the glass's colour and its alpha, which the blend lays over the room: `townGlassC` is the colour as it is (not premultiplied),
 * `townGlassA` how much of the picture it covers. The low tier skips the street's variation and the grime's streaks.
 */
/** The mean of the air's far colour at an overcast noon, which the pane's reflected sky was authored at: the reflection is the sky's brightness over this. */
export const NOON_SKY = 0.5;

export function townAlphaCode(low = false): string {
  const street = low
    ? "let tsSt=vec3<f32>(0.075,0.078,0.082);"
    : [
        "let tsNs=townValue(vec3<f32>(tsR.x*9.0+tsSeed*37.0,tsR.y*21.0,tsR.z*9.0));",
        "let tsNb=townValue(vec3<f32>(tsR.x*31.0,tsR.y*7.0+tsSeed*11.0,tsR.z*31.0));",
        // Brick and dark siding of the far side, wet asphalt under it, now and then a lit window or a pale wall.
        "var tsSt=mix(vec3<f32>(0.1,0.075,0.062),vec3<f32>(0.05,0.056,0.062),tsNs)*(0.55+0.9*tsNb);",
        "if(tsNb>0.82){tsSt=tsSt+vec3<f32>(0.14,0.12,0.08)*(tsNb-0.82)*4.0;}",
      ].join("");
  const grime = low
    ? "let tsGk=0.0;"
    : [
        "let tsPh=max(input.vTownWear.x,0.05);let tsPw=max(input.vTownWear.y,0.05);let tsPu=input.uv;",
        "let tsFromBottom=tsPu.y*tsPh;let tsFromSide=min(tsPu.x*tsPw,(1.0-tsPu.x)*tsPw);",
        "let tsBand=exp(-tsFromBottom/0.2);let tsCorner=exp(-tsFromSide/0.14)*exp(-tsFromBottom/0.55);",
        "let tsStreak=townValue(vec3<f32>(tsPu.x*tsPw*11.0,tsPu.y*tsPh*0.7,tsSeed*53.0));",
        "let tsGk=clamp((tsBand*0.85+tsCorner*0.8+tsStreak*0.3*exp(-tsFromBottom/0.9))*tsDirt*1.5,0.0,0.85);",
      ].join("");
  return [
    `let tsClear=input.${TOWN_TINT_VARYING}.w;`,
    "if(tsClear>0.001){",
    `let tsSeed=input.${TOWN_VARYING}.z;let tsDirt=input.${TOWN_VARYING}.y;`,
    // A sheet of a room's haze (`roomHaze.ts`, marked by a seed of 2, where a pane's is 0 to 1): one colour, carried in the floats a pane's size and tilt use, and no reflection.
    // The dark at a wall's foot (`footShade.ts`, a seed of 3): one colour as a haze's, covering by the square of how near the wall the pixel is (the sheet's own v), times the building's own depth of it.
    // The opening of a door that swings (`PaneLook.open`, a seed of 6 to 7): no glass at all. It covers nothing and has no colour, so what the blur plugin makes of it is the room as read, with no film, no dirt and no reflection.
    `if(tsSeed>5.5){townGlassC=vec3<f32>(0.0,0.0,0.0);townGlassA=1.0;alpha=0.0;}else if(tsSeed>2.5&&tsSeed<3.5){townGlassC=input.${TOWN_WEAR_VARYING}.xyz;townGlassA=1.0;alpha=input.${TOWN_WEAR_VARYING}.w*input.uv.y*input.uv.y;}else if(tsSeed>1.5&&tsSeed<2.5){townGlassC=input.${TOWN_WEAR_VARYING}.xyz;townGlassA=1.0;alpha=1.0-tsClear;}else{`,
    "let tsVe=normalize(scene.vEyePosition.xyz-input.worldPos);",
    "var tsGn=N;",
    "let tsTg=normalize(vec3<f32>(-tsGn.z,0.0,tsGn.x));",
    `tsGn=normalize(tsGn+tsTg*input.${TOWN_WEAR_VARYING}.z+vec3<f32>(0.0,1.0,0.0)*input.${TOWN_WEAR_VARYING}.w);`,
    "if(dot(tsGn,tsVe)<0.0){tsGn=-tsGn;}",
    "let tsNv=clamp(dot(tsGn,tsVe),0.0,1.0);",
    "let tsFr=0.04+0.96*pow(1.0-tsNv,5.0);",
    "let tsR=reflect(-tsVe,tsGn);",
    "let tsUp=smoothstep(0.0,0.12,tsR.y);",
    "let tsSky=mix(vec3<f32>(0.46,0.5,0.52),vec3<f32>(0.3,0.35,0.41),clamp(tsR.y*1.6,0.0,1.0));",
    street,
    // What a pane reflects and the film on it are lit by the sky, whose colours here are a noon's: they follow the sky's own brightness at the
    // hour (the air's far colour, in the frame's block), or at night every pane would hold a noon sky.
    `let tsDay=dot(${FRAME_BLOCK}.atmFarColour,vec3<f32>(0.3333))/${f(NOON_SKY)};`,
    "let tsRc=mix(tsSt,tsSky,tsUp)*tsDay;",
    "let tsRk=clamp(mix(0.04,0.12,tsUp)+(tsFr-0.04),0.0,0.97);",
    grime,
    "let tsDirtC=vec3<f32>(0.2,0.18,0.15)*tsDay;",
    "let tsAb=(1.0-tsClear)*(1.0-tsRk);",
    "let tsAt=clamp(tsAb+tsRk+tsGk*(1.0-tsRk),0.0,0.985);",
    // What the glass keeps back of the room is not black: it is the film on the pane in daylight (`GLASS_FILM`), pale over what stands behind it.
    `townGlassC=(tsRc*tsRk+vec3<f32>(${GLASS_FILM.map((c) => c.toFixed(3)).join(",")})*tsDay*tsAb+tsDirtC*tsGk*(1.0-tsRk))/max(tsAt,0.001);`,
    "townGlassA=1.0;",
    "alpha=tsAt;",
    "}",
    "}",
  ].join("");
}

/** The WGSL at `CUSTOM_FRAGMENT_BEFORE_FINALCOLORCOMPOSITION`: the sky's own light and its reflection (the environment's two terms) scaled by `townSky`, then a glass's colour as `townAlphaCode` made it, and every surface's glow. */
export const TOWN_COMPOSE_CODE = "color-=(finalIrradiance+finalRadianceScaled)*(1.0-townSky);if(townGlassA>0.5){color=townGlassC;}color=color+townGlowC*material.townGlow;";

/** What the plugin draws with: the two arrays (the colour's read as sRGB, the data as data), filled in place when the images land. */
export type TownTextureSet = { readonly color: Texture2DArray; readonly data: Texture2DArray };

/**
 * The plugin's uniforms: `townReady`, 0 until the arrays are filled, then 1; `townHour`, the hour of day 0 to 24 (12 until a frame says otherwise); `townGlow`, what every glow is multiplied by at that hour so that a lit thing stays as bright to the eye while the night's grade darkens the frame round it (`look.ts`, `litGainAt`; 1 by day); `townDay`, how much day there is, 1 to 0, which a glow with no hours of its own is kept by (`DAY_GLOW_CODE`); `townLamps`, how
 * many of the lamp list's entries are used (0: none, which is the day); and the list itself, `lampP<i>` (a lamp's x, y, z and range) and `lampC<i>` (its colour and
 * strength), one vec4 each, since a uniform array is not a type the material's buffer takes. `markMaterialUboDirty` after changing any.
 */
export type TownReady = { townReady: number[]; townHour: number[]; townGlow: number[]; townDay: number[]; townLamps: number[]; townDoors: number[]; townKnocked: number[] } & Record<string, number[]>;

export function emptyTownReady(): TownReady {
  const r: TownReady = { townReady: [0], townHour: [12], townGlow: [1], townDay: [1], townLamps: [0], townDoors: [0], townKnocked: [0] };
  for (let i = 0; i < MAX_DOORS; i++) {
    r[`doorA${i}`] = [0, 0, 1, 0];
    r[`doorB${i}`] = [0, 1, 1, 0];
  }
  for (let i = 0; i < MAX_KNOCKED; i++) {
    r[`knockA${i}`] = [0, 0, 0, 0];
    r[`knockB${i}`] = [1, 0, 0, 0];
    r[`knockC${i}`] = [1, 0, 0, 0];
    r[`knockD${i}`] = [0, 0, 0, 0];
  }
  for (let i = 0; i < MAX_LAMPS; i++) {
    r[`lampP${i}`] = [0, 0, 0, 0];
    r[`lampC${i}`] = [0, 0, 0, 0];
  }
  return r;
}

/** Copies a lamp list into the uniforms. */
export function writeLamps(ready: TownReady, list: LampList): void {
  ready.townLamps[0] = list.count;
  for (let i = 0; i < list.count; i++) {
    const p = ready[`lampP${i}`] as number[];
    const c = ready[`lampC${i}`] as number[];
    for (let k = 0; k < 4; k++) {
      p[k] = list.pos[i * 4 + k] as number;
      c[k] = list.col[i * 4 + k] as number;
    }
  }
}

/**
 * The doors that are moving now (`openDoors.ts`), up to `MAX_DOORS`, as uniforms the vertex stage reads: `doorA<i>` is the hinge's x and z in the world and the
 * unit direction along the shut leaf from the hinge (x, z); `doorB<i>` is the unit direction into the room (x, z), the leaf's width and the angle it stands open
 * at (radians, 0 shut). `townDoors` is how many are used. The vertex stage turns a vertex that is tagged as a leaf's (`DOOR_ALPHA`) and stands in a moving door's
 * leaf about the hinge's vertical axis by the angle, into the room: what turns is the corner's world matrix, so its normal turns with it, in every material the town draws.
 */
export const MAX_DOORS = 10;
export type DoorMove = { readonly hx: number; readonly hz: number; readonly ux: number; readonly uz: number; readonly nx: number; readonly nz: number; readonly width: number; readonly angle: number };

/** Copies the doors that move now into the uniforms. */
export function writeDoors(ready: TownReady, moves: readonly DoorMove[]): void {
  const n = Math.min(moves.length, MAX_DOORS);
  ready.townDoors[0] = n;
  for (let i = 0; i < n; i++) {
    const m = moves[i] as DoorMove;
    const a = ready[`doorA${i}`] as number[];
    const b = ready[`doorB${i}`] as number[];
    a[0] = m.hx; a[1] = m.hz; a[2] = m.ux; a[3] = m.uz;
    b[0] = m.nx; b[1] = m.nz; b[2] = m.width; b[3] = m.angle;
  }
}

/**
 * The vertex stage's turn of a leaf, at the world matrix (`CUSTOM_VERTEX_UPDATE_WORLDPOS`: before the corner is placed): a vertex tagged by its colour's alpha
 * finds the moving door whose shut leaf it stands in (along the leaf from the hinge, and a hand either side of its plane) and takes the turn about the hinge.
 * L = cos I + sin (n u^T - u n^T) in the plane takes u toward n; the matrix is that about the hinge. With no door moving (`townDoors` 0) nothing is read.
 */
export const DOOR_VERTEX = [
  "if(material.townDoors>0.5&&color.a<0.04){",
  `var dA:array<vec4<f32>,${MAX_DOORS}>;var dB:array<vec4<f32>,${MAX_DOORS}>;`,
  ...Array.from({ length: MAX_DOORS }, (_, i) => `dA[${i}]=material.doorA${i};dB[${i}]=material.doorB${i};`),
  "for(var di:i32=0;di<i32(material.townDoors+0.5);di=di+1){",
  "let da=dA[di];let db=dB[di];let drx=position.x-da.x;let drz=position.z-da.y;",
  "let dal=drx*da.z+drz*da.w;let dbe=drx*db.x+drz*db.y;",
  "if(dal>-0.25&&dal<db.z+0.25&&dbe>-0.35&&dbe<0.4){",
  "let dc=cos(db.w);let ds=sin(db.w);",
  "let dl10=ds*(da.z*db.y-db.x*da.w);let dl01=ds*(da.w*db.x-db.y*da.z);",
  "let dtx=da.x-(dc*da.x+dl01*da.y);let dtz=da.y-(dl10*da.x+dc*da.y);",
  "finalWorld=mat4x4<f32>(vec4<f32>(dc,0.0,dl10,0.0),vec4<f32>(0.0,1.0,0.0,0.0),vec4<f32>(dl01,0.0,dc,0.0),vec4<f32>(dtx,0.0,dtz,1.0))*finalWorld;",
  "break;}}}",
].join("");

/**
 * The things a car has moved that are not as they were built: knocked down (`knocked.ts`) or shoved (`struck.ts`), up to `MAX_KNOCKED`, as uniforms the
 * vertex stage reads. `knockA<i>` is the thing's centre in the world (x, z) and the height of the ground it stands on; `knockB<i>` is the unit direction it
 * leans in (x, z), the angle it leans by (radians, 0 upright), and how far from its centre toward that direction the edge it turns about is; `knockC<i>` is
 * the box its vertices stand in, a unit vector along it (x, z) and its half extents along and across; `knockD<i>` is how far it has been slid over the
 * ground (x, z). `townKnocked` is how many are used.
 */
export const MAX_KNOCKED = 12;
export type KnockMove = {
  readonly x: number; readonly z: number; readonly y: number;
  readonly dx: number; readonly dz: number; readonly angle: number; readonly edge: number;
  readonly ux: number; readonly uz: number; readonly hu: number; readonly hv: number;
  readonly sx: number; readonly sz: number;
};

/** Copies the things that are moved now into the uniforms. */
export function writeKnocked(ready: TownReady, moves: readonly KnockMove[]): void {
  const n = Math.min(moves.length, MAX_KNOCKED);
  ready.townKnocked[0] = n;
  for (let i = 0; i < n; i++) {
    const m = moves[i] as KnockMove;
    const a = ready[`knockA${i}`] as number[];
    const b = ready[`knockB${i}`] as number[];
    const c = ready[`knockC${i}`] as number[];
    const d = ready[`knockD${i}`] as number[];
    a[0] = m.x; a[1] = m.z; a[2] = m.y; a[3] = 0;
    b[0] = m.dx; b[1] = m.dz; b[2] = m.angle; b[3] = m.edge;
    c[0] = m.ux; c[1] = m.uz; c[2] = m.hu; c[3] = m.hv;
    d[0] = m.sx; d[1] = m.sz; d[2] = 0; d[3] = 0;
  }
}

/**
 * What the vertex stage does to a corner of a moved thing, as sixteen floats column by column: the turn by `angle` about the horizontal line through
 * the edge it turns about, at the ground (with d the direction of the lean and u up, R = I + (cos - 1)(d d^T + u u^T) + sin (d u^T - u d^T) takes u toward
 * d), and then the slide. The stage's own arithmetic, for what is not drawn by it but must move the same: a parked vehicle's model, a mark on a thing.
 */
export function knockMatrix(m: KnockMove, out: Float32Array): Float32Array {
  const c = Math.cos(m.angle);
  const s = Math.sin(m.angle);
  const k1 = c - 1;
  const px = m.x + m.dx * m.edge;
  const py = m.y;
  const pz = m.z + m.dz * m.edge;
  out[0] = 1 + k1 * m.dx * m.dx; out[1] = -s * m.dx; out[2] = k1 * m.dx * m.dz; out[3] = 0;
  out[4] = s * m.dx; out[5] = c; out[6] = s * m.dz; out[7] = 0;
  out[8] = k1 * m.dx * m.dz; out[9] = -s * m.dz; out[10] = 1 + k1 * m.dz * m.dz; out[11] = 0;
  out[12] = px - ((out[0] as number) * px + (out[4] as number) * py + (out[8] as number) * pz) + m.sx;
  out[13] = py - ((out[1] as number) * px + (out[5] as number) * py + (out[9] as number) * pz);
  out[14] = pz - ((out[2] as number) * px + (out[6] as number) * py + (out[10] as number) * pz) + m.sz;
  out[15] = 1;
  return out;
}

/**
 * The vertex stage's move of a thing, at the world matrix as a door's turn is: a vertex tagged by its colour's alpha as a thing that moves
 * (`KNOCK_ALPHA`) finds the moved thing whose box it stands in and is turned and slid with it (`knockMatrix` is the same arithmetic). What moves is the
 * corner's world matrix, so its normal turns with it. With nothing moved (`townKnocked` 0) nothing is read.
 */
export const KNOCK_VERTEX = [
  `if(material.townKnocked>0.5&&color.a>${KNOCK_OVER}&&color.a<${KNOCK_UNDER}){`,
  `var kA:array<vec4<f32>,${MAX_KNOCKED}>;var kB:array<vec4<f32>,${MAX_KNOCKED}>;var kC:array<vec4<f32>,${MAX_KNOCKED}>;var kD:array<vec4<f32>,${MAX_KNOCKED}>;`,
  ...Array.from({ length: MAX_KNOCKED }, (_, i) => `kA[${i}]=material.knockA${i};kB[${i}]=material.knockB${i};kC[${i}]=material.knockC${i};kD[${i}]=material.knockD${i};`),
  "for(var ki:i32=0;ki<i32(material.townKnocked+0.5);ki=ki+1){",
  "let ka=kA[ki];let kb=kB[ki];let kq=kC[ki];let kx=position.x-ka.x;let kz=position.z-ka.y;",
  "if(abs(kx*kq.x+kz*kq.y)<kq.z&&abs(kx*kq.y-kz*kq.x)<kq.w){",
  "let kc=cos(kb.z);let ks=sin(kb.z);let k1=kc-1.0;",
  "let kp=vec3<f32>(ka.x+kb.x*kb.w,ka.z,ka.y+kb.y*kb.w);",
  "let kr0=vec3<f32>(1.0+k1*kb.x*kb.x,-ks*kb.x,k1*kb.x*kb.y);",
  "let kr1=vec3<f32>(ks*kb.x,kc,ks*kb.y);",
  "let kr2=vec3<f32>(k1*kb.x*kb.y,-ks*kb.y,1.0+k1*kb.y*kb.y);",
  "let kt=kp-(kr0*kp.x+kr1*kp.y+kr2*kp.z)+vec3<f32>(kD[ki].x,0.0,kD[ki].y);",
  "finalWorld=mat4x4<f32>(vec4<f32>(kr0,0.0),vec4<f32>(kr1,0.0),vec4<f32>(kr2,0.0),vec4<f32>(kt,1.0))*finalWorld;",
  "break;}}}",
].join("");

/** The fields of the buffer: the doors' and the knocked things' are read by the vertex stage, the rest by the fragment. */
const READY_FIELDS: readonly UniformField[] = [...uniformFields(emptyTownReady())].map((f) => (f.name.startsWith("door") || f.name === "townDoors" || f.name.startsWith("knock") || f.name === "townKnocked" ? { ...f, visibility: "vertex" as const } : f));

/**
 * The depth steps (of a 24-bit buffer) between one rank of the flat ground and the next: the flat layer is drawn a fixed number of steps ahead of
 * the terrain (`ahead`, in `townParts.ts`), and a vertex of rank r is drawn `r * RANK_UNITS` steps further ahead of that. Steps, not metres, so the
 * order of two ranks holds at every distance in view (a step is z * z / (0.05 * 2^24) m at a distance z; the faces are never more than a few
 * millimetres apart, and four steps are far over what a vertex's rounding can move a face), where millimetres of lift hold to about 40 m.
 * A higher rank is nearer the eye, and the renderer's depth runs from 1 at the near plane to 0 far away, so a rank adds to the clip depth.
 */
export const RANK_UNITS = 6;
/** The most ranks the flat ground has (rank 0 is the base surfaces). */
export const RANKS = 6;

/** The vertex stage's line for a ranked material: the rank rides in the float a flat vertex leaves unused (`townWear`.w, float 11), so it adds no attribute and no draw. */
export const RANK_CODE = `out.clipPos.z+=${(RANK_UNITS / 2 ** 24).toExponential(6)}*${TOWN_WEAR_ATTRIBUTE}.w*out.clipPos.w;`;

/**
 * The depth steps between one rank of paint on a standing face and the next (`paint.ts`): paint lies flush on its face, 2 mm a rank off it, and a rank
 * is drawn this many steps further ahead in the vertex stage, so the order holds at every distance, as the flat ground's does. Two steps are 2.4 cm
 * at 100 m (a step is z * z / (0.05 * 2^24) m), which is under the 6 cm a piece of trim stands proud of its wall, so a rank-1 sheet is never drawn
 * through trim that lies over its wall's plane.
 */
export const PAINT_UNITS = 2;

/**
 * The vertex stage's line for a material that is not the flat ground's: a vertex's rank of paint rides in the alpha of its colour as `1 - rank / PAINT_RANKS`
 * (1 for everything that is not paint, which then moves by nothing), so a rank is `(1 - a) * PAINT_RANKS` and the clip depth is moved by
 * `PAINT_UNITS * PAINT_RANKS / 2^24` of the clip w for each unit of `1 - a`: the same form and sign as `RANK_CODE`. Every mesh the plugin is on has a colour a vertex.
 */
export const PAINT_K = (PAINT_UNITS * PAINT_RANKS) / 2 ** 24;
export const PAINT_CODE = `out.clipPos.z+=${PAINT_K.toExponential(6)}*(1.0-color.a)*out.clipPos.w;`;
/** The paint's depth step a leaf's alpha would give it, taken back (`PAINT_CODE` reads every vertex's alpha as a rank of paint): a leaf lies where it stands. */
export const DOOR_UNPAINT = `if(color.a<0.04){out.clipPos.z-=${PAINT_K.toExponential(6)}*(1.0-color.a)*out.clipPos.w;}`;
/** The same for a thing that falls (`KNOCK_ALPHA`): it carries no paint, and lies where it stands. */
export const KNOCK_UNPAINT = `if(color.a>${KNOCK_OVER}&&color.a<${KNOCK_UNDER}){out.clipPos.z-=${PAINT_K.toExponential(6)}*(1.0-color.a)*out.clipPos.w;}`;

/** The plugin: see the header. `low`: the low tier's cheaper wear and overlay. `ranked`: the material is the flat ground's, whose vertices carry a depth rank. */
export function townSurfacePlugin(textures: TownTextureSet, ready: TownReady, low: boolean, signAtlas?: Texture2DArray, ranked = false, set: LayerSet = TOWN_SET, night = set !== TOWN_SET): MaterialPlugin {
  const definitions = townDefinitions(low, set);
  const surface = (signAtlas === undefined ? "" : SIGN_CODE) + townSurfaceCode(low, signAtlas !== undefined, ranked, set, night);
  const rooms = set !== TOWN_SET;
  return {
    name: rooms ? "InteriorSurface" : "TownSurface",
    priority: 200,
    defines: rooms ? { low, ranked, rooms, night } : night ? { low, ranked, night } : { low, ranked },
    getFragmentDirectives: () => "diagnostic(off,derivative_uniformity);",
    getCustomCode: (stage) =>
      stage === "fragment"
        ? { CUSTOM_FRAGMENT_DEFINITIONS: definitions, CUSTOM_FRAGMENT_UPDATE_DIFFUSE: surface, CUSTOM_FRAGMENT_BEFORE_LIGHTS: townAlphaCode(low) + (signAtlas === undefined ? "" : "alpha=alpha*townSignA;"), CUSTOM_FRAGMENT_LIGHT: TOWN_LIGHT_CODE, CUSTOM_FRAGMENT_BEFORE_FINALCOLORCOMPOSITION: TOWN_COMPOSE_CODE }
        : { CUSTOM_VERTEX_UPDATE_WORLDPOS: WIRE_VERTEX + (ranked ? "" : DOOR_VERTEX + KNOCK_VERTEX), CUSTOM_VERTEX_MAIN_END: `out.${TOWN_VARYING}=${TOWN_ATTRIBUTE};out.${TOWN_TINT_VARYING}=${TOWN_TINT_ATTRIBUTE};out.${TOWN_WEAR_VARYING}=${TOWN_WEAR_ATTRIBUTE};${ranked ? RANK_CODE : PAINT_CODE + DOOR_UNPAINT + KNOCK_UNPAINT}` },
    getVertexAttributes: () => [
      // Twelve 16-bit floats a vertex (`surfacePack.ts`): the shader reads them as the 32-bit floats they stand for.
      { name: TOWN_ATTRIBUTE, type: "vec4<f32>", format: "float16x4", stride: SURFACE_PACKED_BYTES, offset: 0 },
      { name: TOWN_TINT_ATTRIBUTE, type: "vec4<f32>", format: "float16x4", stride: SURFACE_PACKED_BYTES, offset: 8 },
      { name: TOWN_WEAR_ATTRIBUTE, type: "vec4<f32>", format: "float16x4", stride: SURFACE_PACKED_BYTES, offset: 16 },
    ],
    getVaryings: () => [{ name: TOWN_VARYING, type: "vec4<f32>" }, { name: TOWN_TINT_VARYING, type: "vec4<f32>" }, { name: TOWN_WEAR_VARYING, type: "vec4<f32>" }],
    getUniforms: () => ({ ubo: [...READY_FIELDS] }),
    getSamplers: () => [
      { texture: "townColor", sampler: "townSmp", textureType: "texture_2d_array<f32>" },
      { texture: "townData", textureType: "texture_2d_array<f32>" },
      ...(signAtlas === undefined ? [] : [{ texture: "townSign", sampler: "townSignSmp", textureType: "texture_2d_array<f32>" as const }]),
    ],
    writeUbo(data, offsets) {
      writeUniforms(data, offsets, ready);
    },
    bindTextures(out) {
      out.push({ texture: textures.color }, { texture: textures.data, sampler: false });
      if (signAtlas !== undefined) out.push({ texture: signAtlas });
    },
    getActiveTextures(out) {
      out.push(textures.color, textures.data);
      if (signAtlas !== undefined) out.push(signAtlas);
    },
  };
}
