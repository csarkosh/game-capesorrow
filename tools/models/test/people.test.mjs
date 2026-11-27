// The five people's models (`client/assets/models/people.json`, written by hand): the manifest lists the five files, every file is what
// the manifest says (size and SHA-256; skipped where the files are Git LFS pointers, as in `manifest.test.mjs`), at most 3.7 MB a person and
// 16.5 MB in all, and no source is named in what ships.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const OUT = fileURLToPath(new URL('../../../client/assets/models', import.meta.url));
const manifest = JSON.parse(readFileSync(`${OUT}/people.json`, 'utf8'));
const NAMES = ['nathan', 'eric', 'sophia', 'carla', 'claudia'];
const fetched = readFileSync(`${OUT}/person.nathan.glb`).toString('latin1', 0, 4) === 'glTF';

describe('client/assets/models/people.json', () => {
  it('lists the five files, each with a credit id, a height and a size within the budget: 3.7 MB a person, 16.5 MB in all', () => {
    expect(manifest.people.map((p) => p.id)).toEqual(NAMES.map((n) => `person.${n}`));
    for (const p of manifest.people) {
      expect(p.file).toBe(`${p.id}.glb`);
      expect(p.credit).toBe(p.id);
      expect(p.height, p.id).toBeGreaterThan(1.6);
      expect(p.height, p.id).toBeLessThan(1.9);
      expect(p.bytes, p.id).toBeLessThanOrEqual(3_700_000);
    }
    expect(manifest.total_bytes).toBe(manifest.people.reduce((n, p) => n + p.bytes, 0));
    expect(manifest.total_bytes).toBeLessThanOrEqual(16_500_000);
  });

  it('lists the clips every file carries, which the game plays by name', () => {
    expect(manifest.clips).toEqual([
      'idle', 'browse', 'till', 'phone', 'talk', 'drink', 'wipe', 'fold', 'sit_table', 'sit_eat', 'sit_type', 'sit_stool',
      'wait', 'arms', 'listen', 'look', 'call', 'cup', 'lean', 'sit_rest', 'sit_phone', 'walk',
    ]);
  });

  it.skipIf(!fetched)('has files whose sizes and hashes are the manifest\'s', () => {
    for (const p of manifest.people) {
      const bytes = readFileSync(`${OUT}/${p.file}`);
      expect(bytes.length, p.file).toBe(p.bytes);
      expect(createHash('sha256').update(bytes).digest('hex'), p.file).toBe(p.sha256);
      expect(bytes.toString('latin1', 0, 4), p.file).toBe('glTF');
      const json = JSON.parse(bytes.toString('utf8', 20, 20 + bytes.readUInt32LE(12)));
      const names = json.animations.map((a) => a.name);
      // Every file carries the manifest's clips and no other.
      expect([...names].sort(), p.file).toEqual([...manifest.clips].sort());
      // The clips are stored two and a half times too fast (the game plays them at two fifths of the rate), so that the table the game
      // bakes them into, sixty rows to a second of a file's clip, stays under the 3,300 rows it had with twelve clips.
      const seconds = json.animations.map((a) => Math.max(...a.samplers.map((sampler) => json.accessors[sampler.input].max[0])));
      expect(seconds.reduce((rows, s) => rows + Math.round(s * 60) + 1, 0), p.file).toBeLessThanOrEqual(3300);
      // Three primitives: the body, and the cup and the phone skinned to the right hand.
      expect(json.meshes[0].primitives.length, p.file).toBe(3);
      expect(json.materials.map((m) => m.name).filter((n) => n.startsWith('prop.')).sort(), p.file).toEqual(['prop.cup', 'prop.phone']);
    }
  });

  it('says it is written by hand, and names no source in its text', () => {
    expect(manifest.about).toMatch(/by hand/);
    const banned = new RegExp(['sketch' + 'fab', 'poly ?' + 'haven', 'turbo' + 'squid', 'cg' + 'trader', 'free' + '3d', 'ambient' + 'cg', 'render' + 'people'].join('|'), 'i');
    expect(readFileSync(`${OUT}/people.json`, 'utf8')).not.toMatch(banned);
  });
});
