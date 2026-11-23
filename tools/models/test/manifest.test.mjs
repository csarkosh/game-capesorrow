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
