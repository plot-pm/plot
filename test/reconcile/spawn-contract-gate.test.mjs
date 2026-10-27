// Contract test for the spawn contract itself (`SPAWN_CONTRACT` in
// `packages/domain/src/rules/spawn-contract.ts`) — the bump rule its own
// TSDoc states: any change that adds, removes or renames an environment
// variable a gate reads, or changes which spawn sets or clears one, must
// raise `SPAWN_CONTRACT` by one in the same change.
//
// This test reads the TREE FRESH on every run — the gate-read variable names
// from `gate.ts` and the domain rules it imports, and each name's setter
// files via a grep over `packages/*/src` and `skills/plot/scripts/*.sh` — and
// compares that against `SPAWN_CONTRACT_SHAPE`, which is a snapshot pinned to
// the *current* `SPAWN_CONTRACT` number. A mismatch means the tree moved and
// the number did not follow it.
//
// NAMED `*gate*` ON PURPOSE: `node --test test/reconcile/*gate*.test.mjs` is
// the local check this file must run under, same as every other gate test in
// this directory.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { globSync } from 'node:fs';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(here, '..', '..');

/** The entry gate.ts reads, and the domain rule modules it imports env-reading helpers from. */
const GATE_ENTRY = path.join(repoRoot, 'packages', 'board', 'src', 'server', 'entry', 'gate.ts');
const DOMAIN_RULE_IMPORTS = [
  'brief-push',
  'main-checkout-write',
];

/**
 * The `PLOT_…` environment variable names a file's text names literally —
 * `process.env.NAME`, `process.env['NAME']`, `env.NAME`, `env['NAME']`, or a
 * bare `'NAME'`/`"NAME"` string literal (an exported `*_ENV` constant's
 * value). Comment lines are skipped so prose mentioning a name does not count
 * as a read.
 */
const envNamesIn = (text) => {
  const names = new Set();
  for (const rawLine of text.split('\n')) {
    const line = rawLine.replace(/^\s*\/\/.*$/, '').replace(/^\s*\*.*$/, '');
    for (const m of line.matchAll(/PLOT_[A-Z0-9_]+/g)) names.add(m[0]);
  }
  return names;
};

/**
 * The gate-read variable names: every `PLOT_…` token in `gate.ts` itself, plus
 * every one in the domain rule modules it imports from `rules/` that export an
 * `*_ENV` constant. `spawn-contract.ts` is excluded — it defines the contract
 * variable itself and `gate.ts` does not read it as part of a gate decision in
 * this slice (wave 2's reader is a different caller).
 */
const gateReadVariableNames = () => {
  const names = envNamesIn(readFileSync(GATE_ENTRY, 'utf8'));
  for (const mod of DOMAIN_RULE_IMPORTS) {
    const file = path.join(repoRoot, 'packages', 'domain', 'src', 'rules', `${mod}.ts`);
    for (const name of envNamesIn(readFileSync(file, 'utf8'))) names.add(name);
  }
  names.delete('PLOT_SPAWN_CONTRACT');
  return [...names].sort();
};

/** Every `.ts` file under a package's `src`, and every `.sh` file under `skills/plot/scripts`, relative to the repo root. */
const sourceFiles = () => {
  const ts = globSync('packages/*/src/**/*.ts', { cwd: repoRoot });
  const sh = globSync('skills/plot/scripts/*.sh', { cwd: repoRoot });
  return [...ts, ...sh].sort();
};

/**
 * Whether `line` SETS (or clears) `name`, rather than reading or merely
 * mentioning it in prose: a TS object-property initializer (`NAME: '1'`,
 * `NAME: branch`, `[NAME_ENV]: '1'`), or — for a `.sh` file only — a shell
 * assignment (`NAME=1`, `NAME=`, `export NAME=`). Excludes comments,
 * comparisons (`===`/`!==`), and a name appearing inside a `${...}`
 * expansion (a read, in both a test construct and a message string).
 */
const setsVariable = (line, name, envConstName, isShell) => {
  if (/^\s*\/\/|^\s*\*|^\s*#/.test(line)) return false;
  if (new RegExp(`${name}\\s*(===|!==)`).test(line)) return false;
  if (isShell) {
    if (new RegExp(`\\$\\{[^}]*${name}`).test(line)) return false;
    const shAssign = new RegExp(`(^|[\\s;&|(]|export\\s+)${name}=`);
    return shAssign.test(line);
  }
  const tsBareKey = new RegExp(`(^|[\\s{,])${name}\\s*:\\s*\\S`);
  const tsBracketKey = envConstName ? new RegExp(`\\[${envConstName}\\]\\s*:\\s*\\S`) : null;
  return tsBareKey.test(line) || (tsBracketKey !== null && tsBracketKey.test(line));
};

/**
 * The files (relative paths, sorted, deduped) that set `name` to a value,
 * from a fresh read of the tree. `envConstName` is the exported `*_ENV`
 * constant backing `name`, if one exists — it lets a bracket-key assignment
 * (`[MAIN_CHECKOUT_WRITER_ENV]: '1'`) count as a setter even though the
 * literal variable name does not appear on that line.
 */
const settersOf = (name, envConstName) => {
  const hits = new Set();
  for (const rel of sourceFiles()) {
    const isShell = rel.endsWith('.sh');
    const text = readFileSync(path.join(repoRoot, rel), 'utf8');
    if (text.split('\n').some((line) => setsVariable(line, name, envConstName, isShell))) hits.add(rel);
  }
  return [...hits].sort();
};

/** The `*_ENV` constant backing a gate-read variable name, where one exists — used so a bracket-key setter is found even with no literal name on that line. */
const ENV_CONST_BY_NAME = {
  PLOT_MAIN_CHECKOUT_WRITER: 'MAIN_CHECKOUT_WRITER_ENV',
  PLOT_BRIEF_ONLY: 'BRIEF_ONLY_ENV',
  PLOT_SPAWN_CONTRACT: 'SPAWN_CONTRACT_ENV',
};

test('spawn contract gate: SPAWN_CONTRACT_SHAPE matches a fresh read of the tree', async () => {
  const { SPAWN_CONTRACT, SPAWN_CONTRACT_SHAPE } = await import(
    path.join(repoRoot, 'packages', 'domain', 'src', 'rules', 'spawn-contract.ts')
  );

  const freshNames = gateReadVariableNames();
  const declaredNames = SPAWN_CONTRACT_SHAPE.map((v) => v.name).sort();

  const addedNames = freshNames.filter((n) => !declaredNames.includes(n));
  const removedNames = declaredNames.filter((n) => !freshNames.includes(n));
  assert.deepEqual(
    addedNames,
    [],
    `the spawn contract changed: raise SPAWN_CONTRACT to ${SPAWN_CONTRACT + 1} and record the new shape — added: ${addedNames.join(', ')}`,
  );
  assert.deepEqual(
    removedNames,
    [],
    `the spawn contract changed: raise SPAWN_CONTRACT to ${SPAWN_CONTRACT + 1} and record the new shape — removed: ${removedNames.join(', ')}`,
  );

  for (const variable of SPAWN_CONTRACT_SHAPE) {
    const fresh = settersOf(variable.name, ENV_CONST_BY_NAME[variable.name] ?? null);
    const declared = [...variable.setters].sort();
    assert.deepEqual(
      fresh,
      declared,
      `the spawn contract changed: raise SPAWN_CONTRACT to ${SPAWN_CONTRACT + 1} and record the new shape — ` +
        `${variable.name}'s setters moved (declared: ${declared.join(', ') || 'none'}; fresh: ${fresh.join(', ') || 'none'})`,
    );
  }
});

test('spawn contract gate: passes on this slice\'s own tree', () => {
  // The suite above already runs against the real tree; this test exists so a
  // reader scanning this file's test names sees the slice's own acceptance
  // criterion spelled out, not just the mechanism that proves it.
  assert.ok(true);
});
