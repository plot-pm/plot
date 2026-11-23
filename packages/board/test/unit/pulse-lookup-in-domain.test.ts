import { describe, it } from 'vitest';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

// The walk "plan → slice → branch" over a fleet reading lives once, in
// `@plot-pm/domain`'s `rules/pulse-branch.ts`, and `ContinueRefusal` lives in
// its entities. A second copy, or a board import of the lookup through the
// fleet module, shows here.

const PACKAGES = path.resolve(__dirname, '../../..');

/** Every `.ts`/`.tsx` file under `dir`, recursively. */
const sources = (dir: string): string[] =>
  fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return sources(full);
    return /\.tsx?$/.test(entry.name) ? [full] : [];
  });

/** A file's source with block and line comments removed, so prose naming a symbol is not a use of it. */
const read = (file: string): string =>
  fs
    .readFileSync(file, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');

/** The names a file imports from `specifier`. */
const namesImportedFrom = (source: string, specifier: string): string[] =>
  [...source.matchAll(/^import\s+(?:type\s+)?\{([^}]*)\}\s*from\s+'([^']+)'/gms)]
    .filter((m) => m[2] === specifier)
    .flatMap((m) => m[1].split(',').map((name) => name.trim().replace(/^type\s+/, '')))
    .filter(Boolean);

const rel = (file: string): string => path.relative(PACKAGES, file);

describe('the pulse lookup lives in the domain', () => {
  it('no board source takes lookupBranch, branchFromPulse or their types from the fleet module', () => {
    const offenders = sources(path.join(PACKAGES, 'board/src')).flatMap((file) =>
      namesImportedFrom(read(file), '@plot-pm/fleet/shared/continue-command')
        .filter((name) => /^(lookupBranch|branchFromPulse|PulseBranch|BranchLookup)\b/.test(name))
        .map((name) => `${rel(file)}: ${name}`),
    );
    assert.deepEqual(offenders, []);
  });

  it('no board source takes ContinueRefusal from the fleet module', () => {
    const offenders = sources(path.join(PACKAGES, 'board/src')).filter((file) =>
      namesImportedFrom(read(file), '@plot-pm/fleet/shared/continuation').some((name) => /^ContinueRefusal\b/.test(name)),
    );
    assert.deepEqual(offenders.map(rel), []);
  });

  it('no fleet source declares or re-exports lookupBranch or ContinueRefusal', () => {
    const declares = /\b(const|function|type|interface)\s+(lookupBranch|branchFromPulse|ContinueRefusal|PulseBranch|BranchLookup)\b|^export\s+(type\s+)?\{[^}]*\b(lookupBranch|branchFromPulse|ContinueRefusal|PulseBranch|BranchLookup)\b/m;
    const withoutImports = (source: string): string => source.replace(/^import\s[^;]*;/gms, '');
    const offenders = sources(path.join(PACKAGES, 'fleet/src')).filter((file) => declares.test(withoutImports(read(file))));
    assert.deepEqual(offenders.map(rel), []);
  });

  it('the domain declares both', () => {
    assert.match(read(path.join(PACKAGES, 'domain/src/rules/pulse-branch.ts')), /export const lookupBranch\b/);
    assert.match(read(path.join(PACKAGES, 'domain/src/entities/continue-refusal.ts')), /export type ContinueRefusal\b/);
  });
});
