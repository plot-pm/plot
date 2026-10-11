import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const packages = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

const sources = (dir: string): string[] =>
  fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) return e.name === 'node_modules' ? [] : sources(full);
    return /\.(ts|tsx|mjs)$/.test(e.name) ? [full] : [];
  });

/** The factories that build a store over the real index file. */
const REAL_STORE = /\b(?:prIndexFile|prStoreFor)\s*\(/;

/**
 * The text between the parenthesis at `open` and the one that closes it.
 *
 * @param text - the source.
 * @param open - the index of an opening parenthesis.
 * @returns the argument text, or the rest of the source where nothing closes it.
 */
const argumentsAt = (text: string, open: number): string => {
  let depth = 0;
  for (let i = open; i < text.length; i += 1) {
    if (text[i] === '(') depth += 1;
    else if (text[i] === ')') {
      depth -= 1;
      if (depth === 0) return text.slice(open + 1, i);
    }
  }
  return text.slice(open + 1);
};

/**
 * Every way one source file writes the real PR index, as one line per finding.
 *
 * Three shapes count: a `.write(` on a `prIndexFile(...)` or `prStoreFor(...)`
 * value, directly or through a name bound to one; a `refreshPrs` call (or an
 * alias of it) whose arguments build or name such a value; and a `store:` field
 * set to one, which is how a PR world hands it to the fleet's `refreshPrs`.
 *
 * @param text - the file's source.
 * @returns the findings; empty where the file writes no index.
 */
const realIndexWrites = (text: string): string[] => {
  const found: string[] = [];
  // A name bound to the store itself, not to something read from it.
  const bound = [...text.matchAll(/\b(?:const|let|var)\s+(\w+)\b[^=;]*=\s*(?:await\s+)?(?:prIndexFile|prStoreFor)\s*\(/g)]
    .filter((m) => {
      const open = (m.index ?? 0) + m[0].length - 1;
      return !/^\s*\./.test(text.slice(open + argumentsAt(text, open).length + 2));
    })
    .map((m) => m[1]);
  for (const m of text.matchAll(/\b(?:prIndexFile|prStoreFor)\s*\(/g)) {
    const open = (m.index ?? 0) + m[0].length - 1;
    const after = text.slice(open + argumentsAt(text, open).length + 2);
    if (/^\s*\.write\s*\(/.test(after)) found.push(`${m[0]}...).write(`);
  }
  for (const name of bound) {
    if (new RegExp(`\\b${name}\\s*\\.write\\s*\\(`).test(text)) found.push(`${name}.write(`);
  }
  const refreshNames = ['refreshPrs', ...[...text.matchAll(/\brefreshPrs\s+as\s+(\w+)/g)].map((m) => m[1])];
  for (const name of refreshNames) {
    for (const m of text.matchAll(new RegExp(`\\b${name}\\s*\\(`, 'g'))) {
      const args = argumentsAt(text, (m.index ?? 0) + m[0].length - 1);
      const named = bound.some((b) => new RegExp(`\\b${b}\\b`).test(args));
      if (REAL_STORE.test(args) || named) found.push(`${name}(...real store...)`);
    }
  }
  for (const m of text.matchAll(/\bstore\s*:\s*(?:await\s+)?(?:prIndexFile|prStoreFor)\s*\(/g)) found.push(m[0]);
  return found;
};

describe('the PR index has one writer', () => {
  it('names foldPrIndex only in the domain and the fleet package', () => {
    const importers = fs.readdirSync(packages)
      .filter((name) => fs.existsSync(path.join(packages, name, 'src')))
      .flatMap((name) => sources(path.join(packages, name, 'src')))
      .filter((file) => fs.readFileSync(file, 'utf8').includes('foldPrIndex'))
      .map((file) => path.relative(packages, file).split(path.sep)[0]);
    expect(new Set(importers)).toEqual(new Set(['domain', 'fleet']));
  });

  it('has no board source that writes through prIndexFile or prStoreFor, or hands one to refreshPrs', () => {
    const writes = sources(path.join(packages, 'board', 'src'))
      .flatMap((file) => realIndexWrites(fs.readFileSync(file, 'utf8'))
        .map((finding) => `${path.relative(packages, file)}: ${finding}`));
    expect(writes).toEqual([]);
  });
});

describe('what counts as a write of the real index', () => {
  it.each([
    ['a direct write', "await prIndexFile({ cwd }).write('github', index);"],
    ['a write through a bound name', "const real = prStoreFor(opts.repoRoot);\nawait real.write('github', index);"],
    ['the real store handed to refreshPrs', 'await refreshPrs(opts, entry, prStoreFor(opts.repoRoot));'],
    ['a bound real store handed to refreshPrs', 'const s = prIndexFile();\nawait refreshPrs(opts, entry, s);'],
    ['the real store handed to an alias', "import { refreshPrs as refreshPrsWith } from 'x';\nawait refreshPrsWith({ ...w, store: overlay }, prIndexFile());"],
    ['the real store in a PR world', 'const world = { scripts, host, store: prIndexFile({ cwd }) };'],
  ])('finds %s', (_name, text) => {
    expect(realIndexWrites(text)).not.toEqual([]);
  });

  it.each([
    ['a read', "const held = await prStoreFor(opts.repoRoot).read(backend);\nawait refreshPrs(opts, held);"],
    ['an overlay over the real store', 'const created = memoryOverlay(prStoreFor(opts.repoRoot));'],
    ['the overlay handed to refreshPrs', 'await refreshPrs(opts, entry, overlayFor(opts, entry));'],
    ['a store handed to a reader', 'const ctx = { prIndex: prIndexFile({ cwd: repoRoot }) };'],
  ])('passes %s', (_name, text) => {
    expect(realIndexWrites(text)).toEqual([]);
  });
});
