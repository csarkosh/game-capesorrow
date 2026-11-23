// Git LFS leaves a small text file, a pointer, where a binary belongs until the object is fetched.
// A build made from pointers ships them as if they were the textures, and nothing fails: the game
// just draws without them. So the deploy looks for pointers under the shipped assets first.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const HEAD = 'version https://git-lfs.github.com/spec/v1';

/** Whether a file's bytes are a Git LFS pointer and not the file itself. */
export function isLfsPointer(bytes) {
  return bytes.length < 1024 && bytes.subarray(0, HEAD.length).toString('utf8') === HEAD;
}

/** The size, in bytes, a pointer says its object has; null when it says none. */
export function lfsPointerSize(bytes) {
  const found = /^size (\d+)$/m.exec(bytes.toString('utf8'));
  return found === null ? null : Number(found[1]);
}

/** Every file under `dir`, at any depth, that is still a pointer: paths from `dir`, sorted. */
export function lfsPointersUnder(dir) {
  const out = [];
  const walk = (at, shown) => {
    for (const name of readdirSync(at).sort()) {
      const path = join(at, name);
      const label = shown === '' ? name : `${shown}/${name}`;
      if (statSync(path).isDirectory()) walk(path, label);
      else if (statSync(path).size < 1024 && isLfsPointer(readFileSync(path))) out.push(label);
    }
  };
  walk(dir, '');
  return out;
}
