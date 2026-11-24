// The model build script's files are what its manifest lists, and what the manifest says is within the budget: at most 2 MB a
// vehicle and 20 MB in all, every file named by a neutral id, and no source named in what ships. Needs Python 3 with Pillow and numpy
// for the script's own check; where they are not installed that check is skipped (the script itself is run by hand, never by the
// build or CI). The check here reads no sources: `--sources` is pointed at nothing, so it compares the files on disk with the
// manifest (their sizes and SHA-256); run `python3 -I tools/models/build.py --check` by hand, with the sources mounted, to compare
// the manifest with what the sources give.
import { spawnSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const SCRIPT = `${ROOT}tools/models/build.py`;
const OUT = `${ROOT}client/assets/models`;
const have = spawnSync('python3', ['-I', '-c', 'import PIL, numpy'], { encoding: 'utf8' }).status === 0;
const manifest = JSON.parse(readFileSync(`${OUT}/vehicles.json`, 'utf8'));

describe('tools/models/build.py', () => {
  it.skipIf(!have)('says the shipped files are the manifest\'s', () => {
    const run = spawnSync('python3', ['-I', SCRIPT, '--check', '--sources', '/nonexistent'], { encoding: 'utf8', cwd: ROOT });
    expect(run.stdout.trim()).toBe('models are current');
    expect(run.status).toBe(0);
  });

  it('documents how it is run in its header, and the manifest says it is not to be edited', () => {
    expect(readFileSync(SCRIPT, 'utf8')).toMatch(/python3 -I tools\/models\/build\.py/);
    expect(manifest.about).toMatch(/do not edit/);
    expect(manifest.vehicles.length).toBe(12);
  });

  it('keeps to the size budget: 2 MB a vehicle, 20 MB in all', () => {
    for (const v of manifest.vehicles) expect(v.bytes, v.id).toBeLessThanOrEqual(2_000_000);
    expect(manifest.total_bytes).toBeLessThanOrEqual(20_000_000);
    expect(manifest.total_bytes).toBe(manifest.vehicles.reduce((n, v) => n + v.bytes, 0));
  });

  // Where the models are Git LFS pointers (a checkout that has not fetched them, as the cloud's tools job has not), there is nothing to read.
  const fetched = readFileSync(`${OUT}/${manifest.vehicles[0].file}`).toString('latin1', 0, 4) === 'glTF';
  it.skipIf(!fetched)('ships every texture as KTX2, read through KHR_texture_basisu', () => {
    // A WebP image decodes in the browser to four bytes a texel on the GPU; a KTX2 image is transcoded to the GPU's own block format at one.
    // The twelve vehicles' 72 maps were 130 MB of the game's GPU memory as WebP. The script writes WebP; the shipped files' images are
    // re-encoded after it, and this holds them to it.
    let images = 0;
    for (const v of manifest.vehicles) {
      const bytes = readFileSync(`${OUT}/${v.file}`);
      expect(bytes.toString('latin1', 0, 4), `${v.file} is a binary glTF`).toBe('glTF');
      const json = JSON.parse(bytes.toString('utf8', 20, 20 + bytes.readUInt32LE(12)));
      for (const image of json.images ?? []) {
        expect(image.mimeType, v.file).toBe('image/ktx2');
        images++;
      }
      for (const texture of json.textures ?? []) expect(typeof texture.extensions?.KHR_texture_basisu?.source, v.file).toBe('number');
      expect(json.extensionsRequired, v.file).toContain('KHR_texture_basisu');
    }
    expect(images).toBeGreaterThan(60);
  });

  it('lists a file a vehicle, every one on disk and none besides', () => {
    const files = readdirSync(OUT).filter((f) => f.endsWith('.glb')).sort();
    expect(files).toEqual(manifest.vehicles.map((v) => v.file).sort());
    for (const v of manifest.vehicles) expect(v.file).toBe(`${v.id}.glb`);
  });

  it('stands every vehicle on its wheels, four to a vehicle, within a few centimetres of y = 0', () => {
    for (const v of manifest.vehicles) {
      expect(v.wheels.length, v.id).toBe(4);
      for (const w of v.wheels) expect(Math.abs(w.y), v.id).toBeLessThan(0.03);
      expect(v.footprint.length).toBeGreaterThan(3);
    }
  });

  it('names no source in the script, its manifest or its files\' own text', () => {
    // The names are broken up here so that this file does not hold them either: only CREDITS.md may.
    const banned = new RegExp(['sketch' + 'fab', 'poly ?' + 'haven', 'turbo' + 'squid', 'cg' + 'trader', 'free' + '3d', 'ambient' + 'cg'].join('|'), 'i');
    expect(readFileSync(SCRIPT, 'utf8')).not.toMatch(banned);
    expect(readFileSync(`${OUT}/vehicles.json`, 'utf8')).not.toMatch(banned);
    for (const v of manifest.vehicles) expect(readFileSync(`${OUT}/${v.file}`).toString('latin1'), v.id).not.toMatch(banned);
  });
});
