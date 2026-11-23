// The texture build script's manifest is what the script would write today: the layers listed in client/assets/textures/town.layers.json
// are the script's LAYERS, so a layer added to one and not the other fails here. Needs Python 3 with Pillow and numpy; where they are
// not installed the check is skipped (the script itself is run by hand, never by the build or CI).
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
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
});
