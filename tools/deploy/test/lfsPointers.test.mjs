import { describe, it, expect } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { isLfsPointer, lfsPointerSize, lfsPointersUnder } from '../lib/lfsPointers.mjs';

const POINTER = Buffer.from('version https://git-lfs.github.com/spec/v1\noid sha256:4d7a214614ab2935c943f9e0ff69d22eadbb8f32b1258daaa5e2ca24d17e2393\nsize 12345\n');

describe('a Git LFS pointer', () => {
  it('is told from the file it stands for', () => {
    expect(isLfsPointer(POINTER)).toBe(true);
    expect(isLfsPointer(Buffer.from('RIFF\x00\x00\x00\x00WEBPVP8 '))).toBe(false);
    expect(isLfsPointer(Buffer.alloc(0))).toBe(false);
    // A real file that happens to begin with the words is far larger than a pointer.
    expect(isLfsPointer(Buffer.concat([POINTER, Buffer.alloc(2000)]))).toBe(false);
  });

  it('says how large its object is', () => {
    expect(lfsPointerSize(POINTER)).toBe(12345);
    expect(lfsPointerSize(Buffer.from('version https://git-lfs.github.com/spec/v1\n'))).toBeNull();
  });

  it('is found at any depth under a folder, and a real file is not', () => {
    const dir = mkdtempSync(join(tmpdir(), 'lfs-pointers-'));
    mkdirSync(join(dir, 'textures'));
    writeFileSync(join(dir, 'textures', 'b.webp'), POINTER);
    writeFileSync(join(dir, 'textures', 'a.webp'), Buffer.alloc(4096, 7));
    writeFileSync(join(dir, 'top.glb'), POINTER);
    expect(lfsPointersUnder(dir)).toEqual(['textures/b.webp', 'top.glb']);
  });
});
