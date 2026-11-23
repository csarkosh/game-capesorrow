/**
 * The material plugin that makes each parked vehicle its own: on Babylon Lite's PBR material, over the model's own maps, it wears what
 * the vehicle's plan record says (`vehicleLook.ts`), by instance. The numbers ride in the mesh's plugin instance data, eight floats
 * (`FLEET_DATA_FLOATS`): `vehA` = the paint (rgb, linear) and the road grime; `vehB` = the dust on the glass, the algae and leaf litter, a
 * seed that offsets the noise, and how far the clear coat has gone. The vertex stage hands them on with the vertex's height in the model
 * (`vVehY`, metres over the tyres' lowest point).
 *
 * What a part does with them, by its role (the glTF's material name, which `tools/models/build.py` gives):
 *
 * - `paint` takes its colour from the vehicle (the file's paint has no texture): mottled a little in world-space noise that the seed moves,
 *   paler and rougher on what faces up and where the clear coat has gone, with road grime thick at the rocker and fading by about 0.8 m,
 *   and, for a vehicle that never moves, algae along the low and the up-facing and leaves caught in it.
 * - `body` (the worn models, whose colour is their own texture) takes the grime and the algae over it, a little.
 * - `tyre` and `under` are dusted with the road, `lamp` and `plate` a little.
 * - `glass` is dusted: it goes paler, rougher and less clear in patches, more near the base of the window than the top.
 * - `interior` is as it is.
 */
import type { MaterialPlugin } from "@babylonjs/lite";

/** The numbers an instance carries, and the attribute names. */
export const VEHICLE_ATTRIBUTES = [
  { name: "vehA", type: "vec4<f32>", format: "float32x4" as const, stride: 32, offset: 0 },
  { name: "vehB", type: "vec4<f32>", format: "float32x4" as const, stride: 32, offset: 16 },
];

const DEFINITIONS = [
  "fn vhHash(c:vec3<i32>)->f32{",
  "var h=bitcast<u32>(c.x)*374761393u+bitcast<u32>(c.y)*668265263u+bitcast<u32>(c.z)*2147483647u;",
  "h=(h^(h>>13u))*1274126177u;h=h^(h>>16u);",
  "return f32(h&16777215u)/16777216.0;}",
  "fn vhValue(p:vec3<f32>)->f32{",
  "let i=floor(p);let q=fract(p);let s=q*q*(3.0-2.0*q);let c=vec3<i32>(i);",
  "let a=mix(mix(vhHash(c),vhHash(c+vec3<i32>(1,0,0)),s.x),mix(vhHash(c+vec3<i32>(0,1,0)),vhHash(c+vec3<i32>(1,1,0)),s.x),s.y);",
  "let b=mix(mix(vhHash(c+vec3<i32>(0,0,1)),vhHash(c+vec3<i32>(1,0,1)),s.x),mix(vhHash(c+vec3<i32>(0,1,1)),vhHash(c+vec3<i32>(1,1,1)),s.x),s.y);",
  "return mix(a,b,s.z);}",
].join("");

/** What every role reads: the vehicle's numbers, the noise at three scales, how low the point is, and the road grime there. */
const PRELUDE = [
  "let vhA=input.vVehA;let vhB=input.vVehB;let vhY=input.vVehY;",
  "let vhP=input.worldPos+vec3<f32>(vhB.z*173.0,vhB.z*59.0,vhB.z*311.0);",
  "let vhN1=vhValue(vhP*1.3);let vhN2=vhValue(vhP*5.1+vec3<f32>(7.0,3.0,1.0));let vhN3=vhValue(vhP*19.0);",
  "let vhUp=clamp(N.y,0.0,1.0);",
  "let vhLow=1.0-smoothstep(0.2,1.0,vhY);",
  "let vhGrime=clamp(vhA.w*vhLow*(0.65+1.1*vhN2)+vhA.w*0.12*vhN1,0.0,0.9);",
  "let vhGrimeC=vec3<f32>(0.075,0.065,0.052);",
  // Algae along what is low and what faces up, in patches; leaves caught on what is nearly flat.
  "let vhAlgae=clamp(vhB.y*(vhUp*0.8+vhLow*0.7)*smoothstep(0.38,0.62,vhN1*0.5+vhN2*0.5),0.0,0.85);",
  "let vhLeaf=vhB.y*step(0.78,vhN3)*smoothstep(0.55,0.9,vhUp);",
].join("");

const MOSS = "baseColor=mix(baseColor,vec3<f32>(0.04,0.065,0.022),vhAlgae*0.85);baseColor=mix(baseColor,vec3<f32>(0.11,0.065,0.028),vhLeaf*0.8);roughness=mix(roughness,0.95,max(vhAlgae,vhLeaf));";

const PAINT = [
  "var vhC=vhA.rgb*(0.9+0.2*vhN1)*(0.94+0.12*vhN3);",
  // The sun takes the paint of what faces up first.
  "vhC=mix(vhC,vhC*1.35+vec3<f32>(0.02),vhUp*vhB.w*0.55);",
  // Rain runs: a faint darker streak down the sides.
  "let vhStreak=vhValue(vec3<f32>((vhP.x+vhP.z)*8.0,vhP.y*0.5,1.0));",
  "vhC=mix(vhC,vhC*0.78,0.3*vhStreak*(1.0-vhUp));",
  "baseColor=mix(vhC,vhGrimeC,vhGrime);",
  "roughness=clamp(mix(0.38+vhB.w*0.4,0.92,vhGrime),0.05,1.0);",
  "metallic=0.0;",
  MOSS,
].join("");

const BODY = `baseColor=mix(baseColor,baseColor*vec3<f32>(0.72,0.7,0.64),vhGrime*0.7);${MOSS}`;
const TYRE = "baseColor=mix(baseColor,vec3<f32>(0.1,0.085,0.065),vhGrime*0.55);";
const UNDER = "baseColor=mix(baseColor,vec3<f32>(0.1,0.085,0.065),vhGrime*0.8);";
const LAMP = "baseColor=mix(baseColor,vec3<f32>(0.12,0.1,0.08),vhGrime*0.5);";
const GLASS = [
  "let vhDust=clamp(vhB.x*(0.3+0.7*vhN1)*(0.55+0.45*(1.0-smoothstep(0.5,1.5,vhY))),0.0,1.0);",
  "baseColor=mix(baseColor,vec3<f32>(0.2,0.19,0.17),vhDust*0.75);",
  "roughness=mix(roughness,0.8,vhDust);",
  `baseColor=mix(baseColor,vec3<f32>(0.04,0.065,0.022),vhAlgae*0.4);`,
].join("");

const ROLES = ["paint", "body", "tyre", "under", "lamp", "plate", "glass"];

/** The fragment code for a role at the surface's point, or null for a role that wears nothing. */
export function vehicleSurfaceCode(role: string): string | null {
  const r = role.replace(/\d+$/, "");
  const body = { paint: PAINT, body: BODY, tyre: TYRE, under: UNDER, lamp: LAMP, plate: LAMP, glass: GLASS }[r as "paint"];
  return body === undefined ? null : PRELUDE + body;
}

/** The plugin for a part of a role, or null where the role wears nothing (the interior). */
export function vehiclePlugin(role: string): MaterialPlugin | null {
  const surface = vehicleSurfaceCode(role);
  if (surface === null) return null;
  const glass = role === "glass";
  return {
    name: "Vehicle",
    priority: 200,
    defines: { role: ROLES.indexOf(role.replace(/\d+$/, "")) },
    getCustomCode: (stage) =>
      stage === "fragment"
        // The glass's alpha is the dust's too: the clear glass the file gave it, less clear where it is dusty.
        ? { CUSTOM_FRAGMENT_DEFINITIONS: DEFINITIONS, CUSTOM_FRAGMENT_UPDATE_DIFFUSE: surface, ...(glass ? { CUSTOM_FRAGMENT_BEFORE_LIGHTS: "alpha=clamp(alpha+vhDust*0.45,0.0,0.96);" } : {}) }
        : { CUSTOM_VERTEX_MAIN_END: "out.vVehA=vehA;out.vVehB=vehB;out.vVehY=position.y;" },
    getInstanceAttributes: () => VEHICLE_ATTRIBUTES,
    getVaryings: () => [{ name: "vVehA", type: "vec4<f32>" }, { name: "vVehB", type: "vec4<f32>" }, { name: "vVehY", type: "f32" }],
  };
}
