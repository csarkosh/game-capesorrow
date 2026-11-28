// The texture build script's manifests are what the script would write today: the layers listed in client/assets/textures/town.layers.json
// and interior.layers.json (the rooms' set, loaded on first entry) are the script's LAYERS and interior layers, so a layer added to one and not
// the other fails here. Needs Python 3 with Pillow and numpy; where they are
// not installed the check is skipped (the script itself is run by hand, never by the build or CI).
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const SCRIPT = `${ROOT}tools/textures/build.py`;
const have = spawnSync('python3', ['-I', '-c', 'import PIL, numpy'], { encoding: 'utf8' }).status === 0;

describe('tools/textures/build.py', () => {
  it.skipIf(!have)('writes the manifest that is committed', () => {
    const run = spawnSync('python3', ['-I', SCRIPT, '--check'], { encoding: 'utf8', cwd: ROOT });
    expect(run.stdout.trim()).toBe('manifest is current');
    expect(run.status).toBe(0);
  });

  it('documents how it is run in its header, and the manifest it writes says it is not to be edited', () => {
    const script = readFileSync(SCRIPT, 'utf8');
    expect(script).toMatch(/python3 -I tools\/textures\/build\.py/);
    const manifest = JSON.parse(readFileSync(`${ROOT}client/assets/textures/town.layers.json`, 'utf8'));
    expect(manifest.about).toMatch(/do not edit/);
    expect(manifest.size).toBe(512);
    expect(manifest.layers.length).toBeGreaterThan(20);
  });

  it('writes the rooms\' set beside the town\'s: eight layers of its own (seven scanned, one generated) and four of the town\'s, colour at 512 and data at 256, under 22 MB of the GPU\'s memory', () => {
    const town = JSON.parse(readFileSync(`${ROOT}client/assets/textures/town.layers.json`, 'utf8'));
    const manifest = JSON.parse(readFileSync(`${ROOT}client/assets/textures/interior.layers.json`, 'utf8'));
    expect(manifest.about).toMatch(/do not edit/);
    expect(manifest.size).toBe(512);
    expect(manifest.dataSize).toBe(256);
    expect(manifest.layers.map((l) => l.name)).toEqual(['marble_tile', 'carpet', 'oak', 'dark_wood', 'cloth', 'glazed_tile', 'cane', 'paint', 'brick', 'sidewalk', 'stucco', 'rust']);
    for (const l of manifest.layers) {
      expect(l.color).toBe(`interior.${l.name}.color.webp`);
      expect(l.data).toBe(`interior.${l.name}.data.webp`);
      expect(existsSync(`${ROOT}client/assets/textures/${l.color}`), l.color).toBe(true);
      expect(existsSync(`${ROOT}client/assets/textures/${l.data}`), l.data).toBe(true);
      expect(l.mean).toHaveLength(3);
    }
    // The four it shares with the town are the same works at the same size.
    for (const l of manifest.layers.slice(8)) {
      const t = town.layers.find((x) => x.name === l.name);
      expect([l.id, l.tile, l.paintable]).toEqual([t.id, t.tile, t.paintable]);
      expect(l.credit).toBe(t.credit);
    }
    // (512 x 512 + 256 x 256) texels x 4 bytes x 12 layers x 4/3 for the mip chain.
    const gpu = (manifest.size ** 2 + manifest.dataSize ** 2) * 4 * manifest.layers.length * (4 / 3);
    expect(gpu).toBeLessThan(22 * 1024 * 1024);
  });
});
