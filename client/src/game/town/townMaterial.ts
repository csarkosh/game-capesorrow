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
 * **Tiers.** The low tier's arrays are 256 x 256 (a quarter of the memory and of the upload), its overlay takes only the
 * overlay's colour and roughness (no second normal), and its wear noise has two octaves.
 */
import { SURFACE_PACKED_BYTES } from "./surfacePack.js";
import type { MaterialPlugin, Texture2DArray } from "@babylonjs/lite";
import { uniformFields, writeUniforms, type UniformField } from "@csarkosh/engine/game/lite/pluginUniforms";
import { PAINT_GAIN, TOWN_LAYERS, WEAR_OVERLAY, layerIndex } from "./townLayers.js";

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

/** The WGSL the plugin adds at `CUSTOM_FRAGMENT_DEFINITIONS`: the layer table (tile size across and up, and the colour's gain), the overlays' indices, and the noise. */
export function townDefinitions(low: boolean): string {
  const table = TOWN_LAYERS.map((layer) => `vec4<f32>(${f(layer.tile[0])},${f(layer.tile[1])},${f(layer.paintable ? PAINT_GAIN : 1)},0.0)`).join(",");
  const octave3 = low ? "" : "+townValue(p*6.1+vec3<f32>(5.0,29.0,2.0))*0.15";
  const weights = low ? "townValue(p*0.9)*0.65+townValue(p*2.3+vec3<f32>(17.0,3.0,11.0))*0.35" : "townValue(p*0.9)*0.55+townValue(p*2.3+vec3<f32>(17.0,3.0,11.0))*0.3";
  return [
    `const TOWN_MOSS:i32=${layerIndex(WEAR_OVERLAY.moss)};`,
    `const TOWN_RUST:i32=${layerIndex(WEAR_OVERLAY.rust)};`,
    // The overlay layer and the grade of each wear kind: moss, rust, peel, algae, grime (xyz the colour's multiplier, w how much of it is laid).
    `var<private> townOver:array<i32,9>=array<i32,9>(${layerIndex(WEAR_OVERLAY.moss)},${layerIndex(WEAR_OVERLAY.rust)},${layerIndex(WEAR_OVERLAY.peel)},${layerIndex(WEAR_OVERLAY.moss)},${layerIndex(WEAR_OVERLAY.mud)},${layerIndex(WEAR_OVERLAY.mud)},${layerIndex(WEAR_OVERLAY.moss)},${layerIndex(WEAR_OVERLAY.moss)},${layerIndex(WEAR_OVERLAY.mud)});`,
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
    "var<private> townGlassC:vec3<f32>=vec3<f32>(0.0,0.0,0.0);",
    "var<private> townSignA:f32=1.0;",
    `var<private> townInfo:array<vec4<f32>,${TOWN_LAYERS.length}>=array<vec4<f32>,${TOWN_LAYERS.length}>(${table});`,
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

/** The WGSL at `CUSTOM_FRAGMENT_UPDATE_DIFFUSE`: the surface, as the header says. */
export function townSurfaceCode(low: boolean): string {
  return [
    `let tsSurf=input.${TOWN_VARYING};`,
    `let tsWearV=input.${TOWN_WEAR_VARYING};`,
    "let tsLayer=i32(floor(tsSurf.x+0.5));",
    "let tsDx=dpdx(input.uv);let tsDy=dpdy(input.uv);let tsPx=dpdx(input.worldPos);let tsPy=dpdy(input.worldPos);",
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
    `if(tsLayer==${layerIndex("metal_aged")}||tsLayer==${layerIndex("metal_painted")}||tsLayer==${layerIndex("roof_metal")}){metallic=${f(METAL_AMOUNT)}*(1.0-clamp(tsWm*1.6,0.0,1.0));}`,
    "}",
    // The glow: the colour as it stands (flat or textured) lights itself by `tsSurf.w`, and the scene lights what is left.
    "if(tsSurf.w>0.001){townGlowC=baseColor*tsSurf.w;baseColor=baseColor*(1.0-clamp(tsSurf.w,0.0,1.0));}",
    BLIND_CODE,
    WIRE_CODE,
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
    "let tsRc=mix(tsSt,tsSky,tsUp);",
    "let tsRk=clamp(mix(0.04,0.12,tsUp)+(tsFr-0.04),0.0,0.97);",
    grime,
    "let tsDirtC=vec3<f32>(0.2,0.18,0.15);",
    "let tsAb=(1.0-tsClear)*(1.0-tsRk);",
    "let tsAt=clamp(tsAb+tsRk+tsGk*(1.0-tsRk),0.0,0.985);",
    // What the glass keeps back of the room is not black: it is the film on the pane in daylight (`GLASS_FILM`), pale over what stands behind it.
    `townGlassC=(tsRc*tsRk+vec3<f32>(${GLASS_FILM.map((c) => c.toFixed(3)).join(",")})*tsAb+tsDirtC*tsGk*(1.0-tsRk))/max(tsAt,0.001);`,
    "townGlassA=1.0;",
    "alpha=tsAt;",
    "}",
  ].join("");
}

/** The WGSL at `CUSTOM_FRAGMENT_BEFORE_FINALCOLORCOMPOSITION`: a glass's colour as `townAlphaCode` made it, and every surface's glow. */
export const TOWN_COMPOSE_CODE = "if(townGlassA>0.5){color=townGlassC;}color=color+townGlowC;";

/** What the plugin draws with: the two arrays (the colour's read as sRGB, the data as data), filled in place when the images land. */
export type TownTextureSet = { readonly color: Texture2DArray; readonly data: Texture2DArray };

/** The plugin's one uniform, 0 until the arrays are filled, then 1 (`markMaterialUboDirty` after changing it). */
export type TownReady = { townReady: number[] };

export function emptyTownReady(): TownReady {
  return { townReady: [0] };
}

const READY_FIELDS: readonly UniformField[] = uniformFields(emptyTownReady());

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

/** The plugin: see the header. `low`: the low tier's cheaper wear and overlay. `ranked`: the material is the flat ground's, whose vertices carry a depth rank. */
export function townSurfacePlugin(textures: TownTextureSet, ready: TownReady, low: boolean, signAtlas?: Texture2DArray, ranked = false): MaterialPlugin {
  const definitions = townDefinitions(low);
  const surface = (signAtlas === undefined ? "" : SIGN_CODE) + townSurfaceCode(low);
  return {
    name: "TownSurface",
    priority: 200,
    defines: { low, ranked },
    getFragmentDirectives: () => "diagnostic(off,derivative_uniformity);",
    getCustomCode: (stage) =>
      stage === "fragment"
        ? { CUSTOM_FRAGMENT_DEFINITIONS: definitions, CUSTOM_FRAGMENT_UPDATE_DIFFUSE: surface, CUSTOM_FRAGMENT_BEFORE_LIGHTS: townAlphaCode(low) + (signAtlas === undefined ? "" : "alpha=alpha*townSignA;"), CUSTOM_FRAGMENT_BEFORE_FINALCOLORCOMPOSITION: TOWN_COMPOSE_CODE }
        : { CUSTOM_VERTEX_UPDATE_WORLDPOS: WIRE_VERTEX, CUSTOM_VERTEX_MAIN_END: `out.${TOWN_VARYING}=${TOWN_ATTRIBUTE};out.${TOWN_TINT_VARYING}=${TOWN_TINT_ATTRIBUTE};out.${TOWN_WEAR_VARYING}=${TOWN_WEAR_ATTRIBUTE};${ranked ? RANK_CODE : ""}` },
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
