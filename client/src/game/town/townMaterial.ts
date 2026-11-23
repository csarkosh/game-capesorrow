/**
 * The town's material plugin on Babylon Lite's PBR material: scanned PBR textures on the town's polygons, and the wear that
 * breaks them up. The geometry's side of it is `MeshBuilder.poly`'s `surface` (`townSurface.ts`, `townLayers.ts`); the images
 * are loaded by `townTextures.ts`.
 *
 * **A vertex carries**, beside Lite's own position, normal, colour (the flat colour) and UV, two more attributes in the mesh's
 * plugin vertex data (`Mesh.pluginVertexData`, eight floats, 32 bytes a vertex, one interleaved buffer):
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
const MOSS_COLOUR: readonly [number, number, number] = [1.4, 1.9, 1.0];
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
    `var<private> townOver:array<i32,5>=array<i32,5>(${layerIndex(WEAR_OVERLAY.moss)},${layerIndex(WEAR_OVERLAY.rust)},${layerIndex(WEAR_OVERLAY.peel)},${layerIndex(WEAR_OVERLAY.moss)},${layerIndex(WEAR_OVERLAY.mud)});`,
    `var<private> townGrade:array<vec4<f32>,5>=array<vec4<f32>,5>(vec4<f32>(${MOSS_COLOUR.map((c) => f(low ? c * LOW_MOSS : c)).join(",")},1.0),vec4<f32>(${RUST_COLOUR.map(f).join(",")},1.0),vec4<f32>(1.7,1.55,1.4,1.0),vec4<f32>(1.05,1.3,0.9,0.4),vec4<f32>(0.8,0.74,0.66,0.7));`,
    "var<private> townGlowC:vec3<f32>=vec3<f32>(0.0,0.0,0.0);",
    "var<private> townGlassA:f32=0.0;",
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
  return [
    `let tsA${n}=${amountExpr};`,
    `if(tsA${n}>0.001){`,
    `let tsKf${n}=${kindExpr}+0.01;let tsK${n}=clamp(i32(floor(tsKf${n})),0,4);`,
    `var tsWp${n}=input.worldPos;`,
    `if(fract(tsKf${n})>0.25){tsWp${n}=vec3<f32>(tsWp${n}.x*2.6,tsWp${n}.y*0.32,tsWp${n}.z*2.6);}`,
    `let tsW${n}=townWear(tsWp${n},tsA${n})*townGrade[tsK${n}].w;`,
    `tsWm=max(tsWm,tsW${n});`,
    `if(tsW${n}>0.004){`,
    `let tsOver${n}=townOver[tsK${n}];`,
    `let tsScale${n}=tsInfo.xy/townInfo[tsOver${n}].xy;`,
    `let tsUvO${n}=input.uv*tsScale${n};let tsDxO${n}=tsDx*tsScale${n};let tsDyO${n}=tsDy*tsScale${n};`,
    `let tsOc${n}=textureSampleGrad(townColor,townSmp,tsUvO${n},tsOver${n},tsDxO${n},tsDyO${n}).rgb;`,
    `let tsOd${n}=textureSampleGrad(townData,townSmp,tsUvO${n},tsOver${n},tsDxO${n},tsDyO${n});`,
    `tsRgb=mix(tsRgb,tsOc${n}*townGrade[tsK${n}].xyz,tsW${n});`,
    overData,
    "}",
    "}",
  ].join("");
}

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
  ].join("");
}

/**
 * A sign's face: the lettering atlas read by the UV as given (v from the top), its colour times the tint, its alpha the atlas's (carried to the
 * alpha term in `townSignA`). Added to the surface code of the sign layer's material alone.
 */
const SIGN_CODE = "let tsSg=textureSample(townSign,townSignSmp,input.uv,0);baseColor=tsSg.rgb*input.vTownTint.rgb;townSignA=tsSg.a;";

/** The WGSL at `CUSTOM_FRAGMENT_BEFORE_LIGHTS`: a see-through surface's alpha, with the reflection of the sky added to it. */
export function townAlphaCode(): string {
  return [
    `let tsClear=input.${TOWN_TINT_VARYING}.w;`,
    "if(tsClear>0.001){",
    "let tsVe=normalize(scene.vEyePosition.xyz-input.worldPos);",
    "let tsFr=0.04+0.96*pow(1.0-clamp(abs(dot(N,tsVe)),0.0,1.0),5.0);",
    "townGlassA=tsFr;",
    "alpha=clamp(alpha*(1.0-tsClear)+tsFr*0.9,0.0,1.0);",
    "}",
  ].join("");
}

/** The WGSL at `CUSTOM_FRAGMENT_BEFORE_FINALCOLORCOMPOSITION`: the glow, and a glass's sky. */
export const TOWN_COMPOSE_CODE = "color=color+townGlowC+vec3<f32>(0.5,0.56,0.62)*(townGlassA*1.3);";

/** What the plugin draws with: the two arrays (the colour's read as sRGB, the data as data), filled in place when the images land. */
export type TownTextureSet = { readonly color: Texture2DArray; readonly data: Texture2DArray };

/** The plugin's one uniform, 0 until the arrays are filled, then 1 (`markMaterialUboDirty` after changing it). */
export type TownReady = { townReady: number[] };

export function emptyTownReady(): TownReady {
  return { townReady: [0] };
}

const READY_FIELDS: readonly UniformField[] = uniformFields(emptyTownReady());

/** The plugin: see the header. `low`: the low tier's cheaper wear and overlay. */
export function townSurfacePlugin(textures: TownTextureSet, ready: TownReady, low: boolean, signAtlas?: Texture2DArray): MaterialPlugin {
  const definitions = townDefinitions(low);
  const surface = (signAtlas === undefined ? "" : SIGN_CODE) + townSurfaceCode(low);
  return {
    name: "TownSurface",
    priority: 200,
    defines: { low },
    getFragmentDirectives: () => "diagnostic(off,derivative_uniformity);",
    getCustomCode: (stage) =>
      stage === "fragment"
        ? { CUSTOM_FRAGMENT_DEFINITIONS: definitions, CUSTOM_FRAGMENT_UPDATE_DIFFUSE: surface, CUSTOM_FRAGMENT_BEFORE_LIGHTS: townAlphaCode() + (signAtlas === undefined ? "" : "alpha=alpha*townSignA;"), CUSTOM_FRAGMENT_BEFORE_FINALCOLORCOMPOSITION: TOWN_COMPOSE_CODE }
        : { CUSTOM_VERTEX_MAIN_END: `out.${TOWN_VARYING}=${TOWN_ATTRIBUTE};out.${TOWN_TINT_VARYING}=${TOWN_TINT_ATTRIBUTE};out.${TOWN_WEAR_VARYING}=${TOWN_WEAR_ATTRIBUTE};` },
    getVertexAttributes: () => [
      { name: TOWN_ATTRIBUTE, type: "vec4<f32>", format: "float32x4", stride: TOWN_VERTEX_FLOATS * 4, offset: 0 },
      { name: TOWN_TINT_ATTRIBUTE, type: "vec4<f32>", format: "float32x4", stride: TOWN_VERTEX_FLOATS * 4, offset: 16 },
      { name: TOWN_WEAR_ATTRIBUTE, type: "vec4<f32>", format: "float32x4", stride: TOWN_VERTEX_FLOATS * 4, offset: 32 },
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
