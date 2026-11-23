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
export const TOWN_VERTEX_FLOATS = 8;

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

const f = (n: number): string => (Number.isInteger(n) ? n.toFixed(1) : String(n));

/** The WGSL the plugin adds at `CUSTOM_FRAGMENT_DEFINITIONS`: the layer table (tile size across and up, and the colour's gain), the overlays' indices, and the noise. */
export function townDefinitions(low: boolean): string {
  const table = TOWN_LAYERS.map((layer) => `vec4<f32>(${f(layer.tile[0])},${f(layer.tile[1])},${f(layer.paintable ? PAINT_GAIN : 1)},0.0)`).join(",");
  const octave3 = low ? "" : "+townValue(p*6.1+vec3<f32>(5.0,29.0,2.0))*0.15";
  const weights = low ? "townValue(p*0.9)*0.65+townValue(p*2.3+vec3<f32>(17.0,3.0,11.0))*0.35" : "townValue(p*0.9)*0.55+townValue(p*2.3+vec3<f32>(17.0,3.0,11.0))*0.3";
  return [
    `const TOWN_MOSS:i32=${layerIndex(WEAR_OVERLAY.moss)};`,
    `const TOWN_RUST:i32=${layerIndex(WEAR_OVERLAY.rust)};`,
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

/** The WGSL at `CUSTOM_FRAGMENT_UPDATE_DIFFUSE`: the surface, as the header says. */
export function townSurfaceCode(low: boolean): string {
  const overData = low
    ? "tsRough=mix(tsRough,tsOd.z,tsWear);"
    : "tsN=mix(tsN,vec2<f32>(tsOd.x*2.0-1.0,tsOd.y*2.0-1.0),tsWear);tsRough=mix(tsRough,tsOd.z,tsWear);tsAo=mix(tsAo,clamp(tsOd.w*2.0-1.0,0.0,1.0),tsWear);";
  return [
    `let tsSurf=input.${TOWN_VARYING};`,
    "let tsLayer=i32(floor(tsSurf.x+0.5));",
    "let tsDx=dpdx(input.uv);let tsDy=dpdy(input.uv);let tsPx=dpdx(input.worldPos);let tsPy=dpdy(input.worldPos);",
    "if(material.townReady>0.5&&tsLayer>=0){",
    "let tsInfo=townInfo[tsLayer];",
    "let tsCol=textureSampleGrad(townColor,townSmp,input.uv,tsLayer,tsDx,tsDy).rgb*tsInfo.z;",
    "let tsData=textureSampleGrad(townData,townSmp,input.uv,tsLayer,tsDx,tsDy);",
    "var tsN=vec2<f32>(tsData.x*2.0-1.0,tsData.y*2.0-1.0);",
    "var tsRough=tsData.z;var tsAo=clamp(tsData.w*2.0-1.0,0.0,1.0);",
    `var tsRgb=input.${TOWN_TINT_VARYING}.rgb*tsCol;`,
    "var tsWear=0.0;",
    "if(tsSurf.y>0.001){tsWear=townWear(input.worldPos,tsSurf.y);}",
    "if(tsWear>0.004){",
    "let tsOver=select(TOWN_MOSS,TOWN_RUST,tsSurf.z>0.5);",
    "let tsScale=tsInfo.xy/townInfo[tsOver].xy;",
    "let tsUvO=input.uv*tsScale;let tsDxO=tsDx*tsScale;let tsDyO=tsDy*tsScale;",
    "let tsOc=textureSampleGrad(townColor,townSmp,tsUvO,tsOver,tsDxO,tsDyO).rgb;",
    "let tsOd=textureSampleGrad(townData,townSmp,tsUvO,tsOver,tsDxO,tsDyO);",
    `tsRgb=mix(tsRgb,tsOc*select(vec3<f32>(${MOSS_COLOUR.map((c) => f(low ? c * LOW_MOSS : c)).join(",")}),vec3<f32>(${RUST_COLOUR.map(f).join(",")}),tsSurf.z>0.5),tsWear);`,
    overData,
    "}",
    `tsN*=${f(NORMAL_STRENGTH)};`,
    "let tsNz=sqrt(max(1.0-dot(tsN,tsN),0.0));",
    "let tsDp2=cross(tsPy,N);let tsDp1=cross(N,tsPx);",
    "let tsT=tsDp2*tsDx.x+tsDp1*tsDy.x;let tsB=tsDp2*tsDx.y+tsDp1*tsDy.y;",
    "let tsInv=inverseSqrt(max(max(dot(tsT,tsT),dot(tsB,tsB)),1e-20));",
    "N=normalize(tsT*tsInv*tsN.x+tsB*tsInv*tsN.y+N*tsNz);",
    `baseColor=tsRgb*mix(1.0,tsAo,${f(AO_STRENGTH)});`,
    "roughness=clamp(tsRough,0.05,1.0);",
    "}",
  ].join("");
}

/** What the plugin draws with: the two arrays (the colour's read as sRGB, the data as data), filled in place when the images land. */
export type TownTextureSet = { readonly color: Texture2DArray; readonly data: Texture2DArray };

/** The plugin's one uniform, 0 until the arrays are filled, then 1 (`markMaterialUboDirty` after changing it). */
export type TownReady = { townReady: number[] };

export function emptyTownReady(): TownReady {
  return { townReady: [0] };
}

const READY_FIELDS: readonly UniformField[] = uniformFields(emptyTownReady());

/** The plugin: see the header. `low`: the low tier's cheaper wear and overlay. */
export function townSurfacePlugin(textures: TownTextureSet, ready: TownReady, low: boolean): MaterialPlugin {
  const definitions = townDefinitions(low);
  const surface = townSurfaceCode(low);
  return {
    name: "TownSurface",
    priority: 200,
    defines: { low },
    getFragmentDirectives: () => "diagnostic(off,derivative_uniformity);",
    getCustomCode: (stage) =>
      stage === "fragment"
        ? { CUSTOM_FRAGMENT_DEFINITIONS: definitions, CUSTOM_FRAGMENT_UPDATE_DIFFUSE: surface }
        : { CUSTOM_VERTEX_MAIN_END: `out.${TOWN_VARYING}=${TOWN_ATTRIBUTE};out.${TOWN_TINT_VARYING}=${TOWN_TINT_ATTRIBUTE};` },
    getVertexAttributes: () => [
      { name: TOWN_ATTRIBUTE, type: "vec4<f32>", format: "float32x4", stride: TOWN_VERTEX_FLOATS * 4, offset: 0 },
      { name: TOWN_TINT_ATTRIBUTE, type: "vec4<f32>", format: "float32x4", stride: TOWN_VERTEX_FLOATS * 4, offset: 16 },
    ],
    getVaryings: () => [{ name: TOWN_VARYING, type: "vec4<f32>" }, { name: TOWN_TINT_VARYING, type: "vec4<f32>" }],
    getUniforms: () => ({ ubo: [...READY_FIELDS] }),
    getSamplers: () => [
      { texture: "townColor", sampler: "townSmp", textureType: "texture_2d_array<f32>" },
      { texture: "townData", textureType: "texture_2d_array<f32>" },
    ],
    writeUbo(data, offsets) {
      writeUniforms(data, offsets, ready);
    },
    bindTextures(out) {
      out.push({ texture: textures.color }, { texture: textures.data, sampler: false });
    },
    getActiveTextures(out) {
      out.push(textures.color, textures.data);
    },
  };
}
