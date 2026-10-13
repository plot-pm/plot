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

/** Every source file of every package, as `<package>/<path>` with forward slashes. */
const allSources = (): { file: string; text: string }[] =>
  fs.readdirSync(packages)
    .filter((name) => fs.existsSync(path.join(packages, name, 'src')))
    .flatMap((name) => sources(path.join(packages, name, 'src')))
    .map((file) => ({
      file: path.relative(packages, file).split(path.sep).join('/'),
      text: fs.readFileSync(file, 'utf8'),
    }));

/** The factories that build a store over the real issue index file. */
const REAL_STORE = /\b(?:issueIndexFile|issueStoreFor)\s*\(/;

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
 * The names a source binds to the real issue store itself, not to something
 * read from it.
 *
 * @param text - the file's source.
 * @returns the bound names.
 */
const boundStores = (text: string): string[] =>
  [...text.matchAll(/\b(?:const|let|var)\s+(\w+)\b[^=;]*=\s*(?:await\s+)?(?:issueIndexFile|issueStoreFor)\s*\(/g)]
    .filter((m) => {
      const open = (m.index ?? 0) + m[0].length - 1;
      return !/^\s*\./.test(text.slice(open + argumentsAt(text, open).length + 2));
    })
    .map((m) => m[1]);

/**
 * Every way one source file writes the real issue index, one line per finding.
 *
 * Three shapes count: a `.write(` on an `issueIndexFile(...)` or
 * `issueStoreFor(...)` value, directly or through a name bound to one; and a
 * `.write(` on an `issueStore` field, which is how an issue world reaches it.
 *
 * @param text - the file's source.
 * @returns the findings; empty where the file writes no issue index.
 */
const issueIndexWrites = (text: string): string[] => {
  const found: string[] = [];
  for (const m of text.matchAll(/\b(?:issueIndexFile|issueStoreFor)\s*\(/g)) {
    const open = (m.index ?? 0) + m[0].length - 1;
    const after = text.slice(open + argumentsAt(text, open).length + 2);
    if (/^\s*\.write\s*\(/.test(after)) found.push(`${m[0]}...).write(`);
  }
  for (const name of boundStores(text)) {
    if (new RegExp(`\\b${name}\\s*\\.write\\s*\\(`).test(text)) found.push(`${name}.write(`);
  }
  for (const m of text.matchAll(/\.issueStore\s*\.write\s*\(/g)) found.push(m[0]);
  return found;
};

/**
 * Every place one source file hands the real issue store to an issue world:
 * an `issueStore` field set to a factory call or to a bound name, shorthand
 * included.
 *
 * @param text - the file's source.
 * @returns the findings; empty where the file hands none.
 */
const issueStoreHandoffs = (text: string): string[] => {
  const found = [...text.matchAll(/\bissueStore\s*:\s*(?:await\s+)?(?:issueIndexFile|issueStoreFor)\s*\(/g)]
    .map((m) => m[0]);
  for (const name of boundStores(text)) {
    for (const m of text.matchAll(new RegExp(`\\bissueStore\\s*:\\s*${name}\\b`, 'g'))) found.push(m[0]);
    if (name === 'issueStore' && /[{,]\s*issueStore\s*[,}]/.test(text)) found.push('issueStore (shorthand)');
  }
  return found;
};

describe('the issue index has one writer', () => {
  it('serialises through encodeIssueIndex only in the file adapter', () => {
    const callers = allSources()
      .flatMap(({ file, text }) => (text.match(/\bencodeIssueIndex\s*\(/g) ?? []).map(() => file));
    expect(callers).toEqual(['domain/src/adapters/issue-index/issue-index-file.ts']);
  });

  it('writes the store only from fleet/src/shared/issue-refresh.ts', () => {
    const writers = allSources()
      .filter(({ file }) => !file.startsWith('domain/'))
      .filter(({ text }) => issueIndexWrites(text).length > 0)
      .map(({ file }) => file);
    expect(writers).toEqual(['fleet/src/shared/issue-refresh.ts']);
  });

  it('hands the real store to an issue world only in fleetd', () => {
    const handing = allSources()
      .filter(({ text }) => issueStoreHandoffs(text).length > 0)
      .map(({ file }) => file);
    expect(handing).toEqual(['fleet/src/server/entry/registryd-main.ts']);
  });

  it('has no board source that writes the issue store or hands it to a world', () => {
    const findings = sources(path.join(packages, 'board', 'src'))
      .flatMap((file) => {
        const text = fs.readFileSync(file, 'utf8');
        return [...issueIndexWrites(text), ...issueStoreHandoffs(text)]
          .map((finding) => `${path.relative(packages, file)}: ${finding}`);
      });
    expect(findings).toEqual([]);
  });

  it('names no REAL_STORE factory in a refreshIssueIndex call outside fleetd', () => {
    const calls = allSources()
      .flatMap(({ file, text }) => [...text.matchAll(/\b(?:refreshIssueIndex|fleetIssues)\s*\(/g)]
        .filter((m) => REAL_STORE.test(argumentsAt(text, (m.index ?? 0) + m[0].length - 1)))
        .map(() => file));
    expect(calls).toEqual([]);
  });
});

describe('what counts as a write of the real issue index', () => {
  it.each([
    ['a direct write', 'await issueIndexFile({ cwd }).write(index);'],
    ['a write through a bound name', 'const real = issueStoreFor(opts.repoRoot);\nawait real.write(index);'],
    ['a write through a bound name with a type', 'const real: IssueIndexStore = issueIndexFile();\nawait real.write(index);'],
    ['a write through a world field', 'await world.issueStore.write(next);'],
  ])('finds %s', (_name, text) => {
    expect(issueIndexWrites(text)).not.toEqual([]);
  });

  it.each([
    ['a read', 'const held = await issueStoreFor(opts.repoRoot).read();'],
    ['a read through a bound name', 'const s = issueIndexFile();\nawait s.read();'],
    ['a location', 'const at = await issueIndexFile({ cwd }).location();'],
  ])('passes %s', (_name, text) => {
    expect(issueIndexWrites(text)).toEqual([]);
  });
});

describe('what counts as handing the real issue store to a world', () => {
  it.each([
    ['a factory call', 'fleetIssues({ issueStore: issueIndexFile({ cwd }) }, state, warn);'],
    ['a bound name', 'const s = issueIndexFile({ cwd });\nfleetIssues({ issueStore: s }, state, warn);'],
    ['a shorthand field', 'const issueStore = issueIndexFile({ cwd });\nfleetIssues({ context, issueStore, prBackoff }, state, warn);'],
  ])('finds %s', (_name, text) => {
    expect(issueStoreHandoffs(text)).not.toEqual([]);
  });

  it.each([
    ['an in-memory store', 'const issueStore = memoryIssueStore();\nfleetIssues({ issueStore }, state, warn);'],
    ['a store handed to a reader', 'const issueGate = issueGateOf(issueIndexFile({ cwd }));'],
  ])('passes %s', (_name, text) => {
    expect(issueStoreHandoffs(text)).toEqual([]);
  });
});
