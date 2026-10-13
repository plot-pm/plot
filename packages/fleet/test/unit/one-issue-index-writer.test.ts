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

/**
 * Every call to `encodeIssueIndex` across the workspace, as one line per site.
 *
 * @returns `"<package>/<relative path>"` for each call site found.
 */
const encodeCallSites = (): string[] =>
  fs.readdirSync(packages)
    .filter((name) => fs.existsSync(path.join(packages, name, 'src')))
    .flatMap((name) => sources(path.join(packages, name, 'src')))
    .flatMap((file) => {
      const text = fs.readFileSync(file, 'utf8');
      const hits = text.match(/\bencodeIssueIndex\s*\(/g) ?? [];
      return hits.map(() => path.relative(packages, file));
    });

describe('the issue index has one writer', () => {
  it('calls encodeIssueIndex from exactly one site, inside the file adapter', () => {
    expect(encodeCallSites()).toEqual(['domain/src/adapters/issue-index/issue-index-file.ts']);
  });

  it('has no board source that writes the issue store', () => {
    const writes = sources(path.join(packages, 'board', 'src'))
      .flatMap((file) => {
        const text = fs.readFileSync(file, 'utf8');
        const hits = text.match(/\bissueStoreFor\s*\([^)]*\)\s*\.write\s*\(|\bissueIndexFile\s*\([^)]*\)\s*\.write\s*\(/g) ?? [];
        return hits.map((hit) => `${path.relative(packages, file)}: ${hit}`);
      });
    expect(writes).toEqual([]);
  });
});
