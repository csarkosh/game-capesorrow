// The first person arms' build script writes the two files its manifest lists, and what the manifest says of them is true: their sizes and hashes, the names the game tells
// their parts apart by, the texture sizes within what the script promises, a credit entry for each work, and no source named in what ships. Needs Python 3 with Pillow
// and numpy for the script's own check; where they are not installed that check is skipped (the script is run by hand, never by the build or CI). The check here reads
// no sources: `--sources` is pointed at nothing, so it compares the files on disk with the manifest (their sizes and SHA-256); run
// `python3 -I tools/models/buildHands.py --check` by hand, with the sources mounted, to compare the manifest with what the sources give.
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const SCRIPT = `${ROOT}tools/models/buildHands.py`;
const OUT = `${ROOT}client/assets/models`;
const have = spawnSync('python3', ['-I', '-c', 'import PIL, numpy'], { encoding: 'utf8' }).status === 0;
const manifest = JSON.parse(readFileSync(`${OUT}/hands.json`, 'utf8'));

// Where the models are Git LFS pointers (a checkout that has not fetched them, as the cloud's tools job has not), there is nothing to read.
const fetched = readFileSync(`${OUT}/hand.right.glb`).toString('latin1', 0, 4) === 'glTF';

/** The JSON chunk of a binary glTF. */
function gltfJson(file) {
  const raw = readFileSync(`${OUT}/${file}`);
  const size = raw.readUInt32LE(12);
  return JSON.parse(raw.toString('utf8', 20, 20 + size));
}

describe('tools/models/buildHands.py', () => {
  it.skipIf(!have || !fetched)("says the shipped files are the manifest's", () => {
    const run = spawnSync('python3', ['-I', SCRIPT, '--check', '--sources', '/nonexistent'], { encoding: 'utf8', cwd: ROOT });
    expect(run.stdout.trim()).toBe('models are current');
    expect(run.status).toBe(0);
  });

  it('documents how it is run in its header, and the manifest says it is not to be edited', () => {
    expect(readFileSync(SCRIPT, 'utf8')).toMatch(/python3 -I tools\/models\/buildHands\.py/);
    expect(manifest.about).toMatch(/do not edit/);
    expect(Object.keys(manifest.files).sort()).toEqual(['hand.left.glb', 'hand.right.glb']);
  });

  it('names no source in the script, the previewer, the manifest or the files\' own text', () => {
    // The names are broken up here so that this file does not hold them either: only CREDITS.md may.
    const banned = new RegExp(['sketch' + 'fab', 'poly ?' + 'haven', 'turbo' + 'squid', 'cg' + 'trader', 'free' + '3d', 'ambient' + 'cg'].join('|'), 'i');
    expect(readFileSync(SCRIPT, 'utf8')).not.toMatch(banned);
    expect(readFileSync(`${ROOT}tools/models/previewHands.py`, 'utf8')).not.toMatch(banned);
    expect(readFileSync(`${OUT}/hands.json`, 'utf8')).not.toMatch(banned);
    if (fetched) for (const name of Object.keys(manifest.files)) expect(readFileSync(`${OUT}/${name}`).toString('latin1'), name).not.toMatch(banned);
  });

  it('credits each work the files are made from, in CREDITS.md', () => {
    const credits = readFileSync(`${ROOT}CREDITS.md`, 'utf8');
    const ids = new Set(Object.values(manifest.files).flatMap((f) => f.credits));
    expect([...ids].sort()).toEqual(['hand.arms', 'hand.torch', 'hand.watch']);
    for (const id of ids) {
      const section = credits.split(`\n## ${id}\n`)[1]?.split('\n## ')[0] ?? '';
      expect(section, id).toMatch(/\*\*Author:\*\*/);
      expect(section, id).toMatch(/\*\*Licence:\*\*/);
      expect(section, id).toMatch(/\*\*URL:\*\*/);
      expect(section, id).toMatch(/\*\*Modified:\*\*/);
    }
  });

  it('keeps the sizes the manifest reports: a colour map at most 1024 and a data map at most 512, a byte a texel on the GPU', () => {
    expect(manifest.total_bytes).toBe(Object.values(manifest.files).reduce((n, f) => n + f.bytes, 0));
    for (const [name, f] of Object.entries(manifest.files)) {
      expect(f.bytes, name).toBeLessThanOrEqual(3_000_000);
      expect(f.triangles, name).toBe(Object.values(f.parts).reduce((n, p) => n + p.triangles, 0));
      for (const t of f.textures) expect(Math.max(...t.size), `${name} ${t.name}`).toBeLessThanOrEqual(t.map === 'colour' ? 1024 : 512);
      expect(f.gpu_bytes, name).toBe(f.textures.reduce((n, t) => n + t.size[0] * t.size[1], 0));
    }
    // With both files loaded the engine shares the arms' maps: every distinct image is counted once.
    expect(manifest.total_gpu_bytes_shared).toBeLessThan(manifest.total_gpu_bytes * 2);
    expect(manifest.total_gpu_bytes_shared).toBeLessThanOrEqual(5_000_000);
  });

  it("carries the arms' three maps as the same bytes in both files, so that the engine's shareTextures makes them one GPU texture each", () => {
    const arms = (file) => manifest.files[file].textures.filter((t) => t.name.startsWith('hand.arms.') && !t.name.includes('leather'));
    const right = arms('hand.right.glb');
    const left = arms('hand.left.glb');
    expect(right.map((t) => t.name)).toEqual(['hand.arms.colour', 'hand.arms.orm', 'hand.arms.normal']);
    expect(left.map((t) => `${t.name} ${t.sha256} ${t.bytes}`)).toEqual(right.map((t) => `${t.name} ${t.sha256} ${t.bytes}`));
  });

  it.skipIf(!fetched)('names the parts and the materials the game tells them apart by, and ships no second texture coordinates', () => {
    const right = gltfJson('hand.right.glb');
    const left = gltfJson('hand.left.glb');
    expect(right.nodes.map((n) => n.name).sort()).toEqual(['arm', 'hand.right', 'torch', 'torch_glass']);
    expect(right.materials.map((m) => m.name).sort()).toEqual(['arm', 'torch', 'torch_glass']);
    expect(left.nodes.map((n) => n.name).sort()).toEqual(['arm', 'hand.left', 'strap', 'watch_back', 'watch_case', 'watch_glass', 'watch_screen']);
    expect(left.materials.map((m) => m.name).sort()).toEqual(['arm', 'strap', 'watch_back', 'watch_case', 'watch_glass', 'watch_screen']);
    for (const doc of [right, left]) {
      expect(doc.extensionsRequired).toEqual(['KHR_texture_basisu']);
      for (const image of doc.images) expect(image.mimeType).toBe('image/ktx2');
      for (const mesh of doc.meshes) for (const prim of mesh.primitives) expect(Object.keys(prim.attributes), mesh.name).not.toContain('TEXCOORD_1');
      expect(doc.skins ?? []).toEqual([]);
      expect(doc.animations ?? []).toEqual([]);
    }
  });

  it('gives the game its numbers: the lens and the barrel, the screen\'s corners, and the cut ends', () => {
    const right = manifest.files['hand.right.glb'];
    expect(right.lens).toEqual([0, 0, 0]);
    expect(right.axis).toEqual([0, 0, 1]);
    expect(right.torch_length).toBeCloseTo(0.24, 3);
    expect(right.forearm_cut.centre).toHaveLength(3);
    const watch = manifest.files['hand.left.glb'].watch;
    expect(watch.screen_corners).toHaveLength(4);
    const [tl, tr, br, bl] = watch.screen_corners;
    expect(tl[0]).toBeLessThan(tr[0]);
    expect(tl[1]).toBeGreaterThan(bl[1]);
    expect(br).toEqual([tr[0], bl[1], 0]);
    expect(tr[0] - tl[0]).toBeCloseTo(watch.screen_diameter, 4);
  });
});
