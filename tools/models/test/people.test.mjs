// The people's models (`client/assets/models/people.json`, written by hand): the manifest lists the six bodies' files and the heads they
// carry, every file is what the manifest says (size and SHA-256; skipped where the files are Git LFS pointers, as in `manifest.test.mjs`), at
// most 6.3 MB a body with its heads and 36 MB in all, and no source is named in what ships.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const OUT = fileURLToPath(new URL('../../../client/assets/models', import.meta.url));
const manifest = JSON.parse(readFileSync(`${OUT}/people.json`, 'utf8'));
const NAMES = ['f-rainjacket', 'f-parka', 'f-fleece', 'm-puffer', 'm-hoodie', 'm-workjacket'];
const fetched = readFileSync(`${OUT}/person.f-rainjacket.glb`).toString('latin1', 0, 4) === 'glTF';

describe('client/assets/models/people.json', () => {
  it('lists the six files, three women\'s bodies and three men\'s, each with a height and a size within the budget: 6.3 MB a body with the heads it carries, 36 MB in all', () => {
    expect(manifest.people.map((p) => p.id)).toEqual(NAMES.map((n) => `person.${n}`));
    for (const p of manifest.people) {
      expect(p.file).toBe(`${p.id}.glb`);
      expect(p.sex, p.id).toBe(p.id.startsWith('person.f-') ? 'f' : 'm');
      // The women stand about 1.63 to 1.70 m and the men 1.73 to 1.80 m, as people do.
      expect(p.height, p.id).toBeGreaterThan(p.sex === 'f' ? 1.6 : 1.7);
      expect(p.height, p.id).toBeLessThan(p.sex === 'f' ? 1.72 : 1.82);
      expect(p.bytes, p.id).toBeLessThanOrEqual(6_300_000);
    }
    expect(manifest.total_bytes).toBe(manifest.people.reduce((n, p) => n + p.bytes, 0));
    expect(manifest.total_bytes).toBeLessThanOrEqual(36_000_000);
  });

  it('says who each head is (sex, background, age) and which bodies carry it: a body carries heads of its own sex only, at least five of them, and every head is carried', () => {
    const heads = new Map(manifest.heads.map((h) => [h.id, h]));
    expect(heads.size).toBe(manifest.heads.length);
    for (const h of manifest.heads) {
      expect(h.id, h.id).toMatch(/^[fm]-[a-z]+-\d+$/);
      expect(['f', 'm'], h.id).toContain(h.sex);
      expect(['white', 'hispanic', 'native', 'asian', 'black'], h.id).toContain(h.group);
      expect(h.age, h.id).toBeGreaterThanOrEqual(18);
      expect(h.age, h.id).toBeLessThan(95);
      expect(Object.keys(h.look.regions).sort(), h.id).toEqual(['hair', 'skin']);
    }
    const carried = new Set();
    for (const p of manifest.people) {
      expect(p.heads.length, p.id).toBeGreaterThanOrEqual(5);
      expect(new Set(p.heads).size, p.id).toBe(p.heads.length);
      for (const id of p.heads) {
        expect(heads.get(id)?.sex, `${p.id} ${id}`).toBe(p.sex);
        carried.add(id);
      }
    }
    expect(carried.size).toBe(heads.size);
    // The town's mix needs a head of each background the coast's ports have, people of every age band among the largest, and both sexes.
    for (const group of ['white', 'hispanic', 'native', 'asian', 'black']) expect(manifest.heads.some((h) => h.group === group), group).toBe(true);
    for (const sex of ['f', 'm']) {
      const white = manifest.heads.filter((h) => h.group === 'white' && h.sex === sex).map((h) => h.age);
      expect(white.some((a) => a < 45), sex).toBe(true);
      expect(white.some((a) => a >= 45 && a < 65), sex).toBe(true);
      expect(white.some((a) => a >= 65), sex).toBe(true);
    }
  });

  it('lists the clips every file carries, which the game plays by name', () => {
    expect(manifest.clips).toEqual([
      'idle', 'browse', 'till', 'phone', 'talk', 'drink', 'wipe', 'fold', 'sit_table', 'sit_eat', 'sit_type', 'sit_stool',
      'wait', 'arms', 'listen', 'look', 'call', 'cup', 'lean', 'sit_rest', 'sit_phone', 'walk', 'dive',
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
      // bakes them into, sixty rows to a second of a file's clip, stays small: 3,300 rows with the walk, and 3,400 with the dive, which
      // like the walk is held at its own speed (two seconds, 121 rows). A row is now half the size it was when 3,300 was set.
      const seconds = json.animations.map((a) => Math.max(...a.samplers.map((sampler) => json.accessors[sampler.input].max[0])));
      expect(seconds.reduce((rows, s) => rows + Math.round(s * 60) + 1, 0), p.file).toBeLessThanOrEqual(3400);
      // The primitives: the body, each head it carries, and the cup and the phone skinned to the right hand.
      expect(json.meshes[0].primitives.length, p.file).toBe(3 + p.heads.length);
      const materials = json.materials.map((m) => m.name);
      expect(materials.filter((n) => n.startsWith('prop.')).sort(), p.file).toEqual(['prop.cup', 'prop.phone']);
      expect(materials.filter((n) => n.startsWith('head.')).sort(), p.file).toEqual(p.heads.map((id) => `head.${id}`).sort());
      expect(materials.filter((n) => n.startsWith('person.')), p.file).toEqual([p.id]);
      // The fingers have no joints (the hands are still), which keeps the table of the clips small: 22 joints.
      expect(json.skins[0].joints.length, p.file).toBe(22);
    }
  });

  it('says how far a diving body goes at each thirtieth of a second of the dive, the same for all six: out and never back, still at the start and for the stand at the end', () => {
    const first = manifest.people[0].dive;
    for (const p of manifest.people) {
      expect(p.dive, p.id).toEqual(first);
    }
    expect(first.stored).toBe(1);
    expect(first.seconds).toBeGreaterThan(1.5);
    expect(first.seconds).toBeLessThan(2.5);
    const travel = first.travel_m;
    // One distance for each thirtieth of a second, the clip's first moment and its last included.
    expect(travel.length).toBe(Math.round(first.seconds * 30) + 1);
    expect(travel[0]).toBe(0);
    let fastest = 0;
    for (let i = 1; i < travel.length; i++) {
      expect(travel[i], `at ${i}`).toBeGreaterThanOrEqual(travel[i - 1]);
      fastest = Math.max(fastest, (travel[i] - travel[i - 1]) * 30);
    }
    const total = travel[travel.length - 1];
    // A dive and a roll: two to three metres, at a sprint's speed at most; hardly moving in the first tenth, and still for the last half second.
    expect(total).toBeGreaterThan(2);
    expect(total).toBeLessThan(3.2);
    expect(fastest).toBeLessThan(5);
    expect(travel[3]).toBeLessThan(0.05);
    expect(travel[travel.length - 16]).toBe(total);
  });

  it('says what each picture holds: a body\'s of shoes, legs, body and skin (its hands), a head\'s of skin and hair; a mean colour and a share of the picture for each, the shares no more than the whole', () => {
    for (const p of [...manifest.people, ...manifest.heads]) {
      const regions = p.look.regions;
      expect(Object.keys(regions).sort(), p.id).toEqual(p.id.startsWith('person.') ? ['bottoms', 'shoes', 'skin', 'top'] : ['hair', 'skin']);
      let whole = 0;
      for (const [name, r] of Object.entries(regions)) {
        expect(r.mean.length, `${p.id} ${name}`).toBe(3);
        for (const v of r.mean) {
          expect(v, `${p.id} ${name}`).toBeGreaterThanOrEqual(0);
          expect(v, `${p.id} ${name}`).toBeLessThanOrEqual(1);
        }
        // (A body's skin is its two hands, under a fiftieth of its picture.)
        expect(r.share, `${p.id} ${name}`).toBeGreaterThan(0.015);
        whole += r.share;
      }
      expect(whole, p.id).toBeGreaterThan(0.9);
      expect(whole, p.id).toBeLessThanOrEqual(1.0001);
    }
  });

  it('says it is written by hand, and names no source in its text', () => {
    expect(manifest.about).toMatch(/by hand/);
    const banned = new RegExp(['sketch' + 'fab', 'poly ?' + 'haven', 'turbo' + 'squid', 'cg' + 'trader', 'free' + '3d', 'ambient' + 'cg', 'render' + 'people'].join('|'), 'i');
    expect(readFileSync(`${OUT}/people.json`, 'utf8')).not.toMatch(banned);
  });
});
