// The five people's models (`client/assets/models/people.json`, written by hand): the manifest lists the five files, every file is what
// the manifest says (size and SHA-256; skipped where the files are Git LFS pointers, as in `manifest.test.mjs`), at most 3 MB a person and
// 14 MB in all, and no source is named in what ships.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const OUT = fileURLToPath(new URL('../../../client/assets/models', import.meta.url));
const manifest = JSON.parse(readFileSync(`${OUT}/people.json`, 'utf8'));
const NAMES = ['nathan', 'eric', 'sophia', 'carla', 'claudia'];
const fetched = readFileSync(`${OUT}/person.nathan.glb`).toString('latin1', 0, 4) === 'glTF';

describe('client/assets/models/people.json', () => {
  it('lists the five files, each with a credit id, a height and a size within the budget: 3.2 MB a person, 15 MB in all', () => {
    expect(manifest.people.map((p) => p.id)).toEqual(NAMES.map((n) => `person.${n}`));
    for (const p of manifest.people) {
      expect(p.file).toBe(`${p.id}.glb`);
      expect(p.credit).toBe(p.id);
      expect(p.height, p.id).toBeGreaterThan(1.6);
      expect(p.height, p.id).toBeLessThan(1.9);
      expect(p.bytes, p.id).toBeLessThanOrEqual(3_200_000);
    }
    expect(manifest.total_bytes).toBe(manifest.people.reduce((n, p) => n + p.bytes, 0));
    expect(manifest.total_bytes).toBeLessThanOrEqual(15_000_000);
  });

  it('lists the twelve clips every file carries', () => {
    expect(manifest.clips).toEqual(['idle', 'browse', 'till', 'phone', 'talk', 'drink', 'wipe', 'fold', 'sit_table', 'sit_eat', 'sit_type', 'sit_stool']);
  });

  it.skipIf(!fetched)('has files whose sizes and hashes are the manifest\'s', () => {
    for (const p of manifest.people) {
      const bytes = readFileSync(`${OUT}/${p.file}`);
      expect(bytes.length, p.file).toBe(p.bytes);
      expect(createHash('sha256').update(bytes).digest('hex'), p.file).toBe(p.sha256);
      expect(bytes.toString('latin1', 0, 4), p.file).toBe('glTF');
      const json = JSON.parse(bytes.toString('utf8', 20, 20 + bytes.readUInt32LE(12)));
      expect(json.animations.map((a) => a.name), p.file).toEqual(manifest.clips);
    }
  });

  it('says it is written by hand, and names no source in its text', () => {
    expect(manifest.about).toMatch(/by hand/);
    const banned = new RegExp(['sketch' + 'fab', 'poly ?' + 'haven', 'turbo' + 'squid', 'cg' + 'trader', 'free' + '3d', 'ambient' + 'cg', 'render' + 'people'].join('|'), 'i');
    expect(readFileSync(`${OUT}/people.json`, 'utf8')).not.toMatch(banned);
  });
});
