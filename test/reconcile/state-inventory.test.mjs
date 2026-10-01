// Contract test for scripts/check-state-inventory.mjs — the gate that fails a
// run when it writes a state file `scripts/state-inventory.json` does not
// declare.
//
// Each case builds a fixture run root with the three bases `owned-run.sh`
// creates, and removes it by the exact name mkdtempSync returned.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(here, '..', '..');
const check = path.join(repoRoot, 'scripts', 'check-state-inventory.mjs');
const manifest = path.join(repoRoot, 'scripts', 'state-inventory.json');

const BOUNDS = [
  'overwritten',
  'spent',
  'window',
  'rotated',
  'removed on exit',
  'removed with its desk',
  'kept on purpose',
  'tracked in git',
];

const fixtureRoot = (t) => {
  const root = mkdtempSync(path.join(tmpdir(), 'plot-inventory-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  for (const base of ['home', 'budget', 'pr-index']) mkdirSync(path.join(root, base));
  return root;
};

const put = (root, rel, body = 'x\n') => {
  mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
  writeFileSync(path.join(root, rel), body);
};

const runCheck = (...args) => spawnSync(process.execPath, [check, ...args], { encoding: 'utf8' });

test('every manifest entry carries exactly one bound from the vocabulary', () => {
  const { entries, coverage } = JSON.parse(readFileSync(manifest, 'utf8'));
  assert.equal(typeof coverage, 'string', 'the manifest states its coverage limit');
  assert.ok(entries.length > 0);
  for (const entry of entries) {
    assert.ok(BOUNDS.includes(entry.bound), `${entry.base}/${entry.glob}: bound ${JSON.stringify(entry.bound)}`);
    assert.ok(entry.writer, `${entry.base}/${entry.glob} names its writer`);
  }
});

test('a root holding only declared files passes', (t) => {
  const root = fixtureRoot(t);
  put(root, 'budget/budget.tsv');
  put(root, 'budget/slots/jwloka/0');
  const res = runCheck(root);
  assert.equal(res.status, 0, res.stderr);
});

test('an empty root passes, and a missing base holds no files', (t) => {
  const root = fixtureRoot(t);
  rmSync(path.join(root, 'pr-index'), { recursive: true, force: true });
  const res = runCheck(root);
  assert.equal(res.status, 0, res.stderr);
});

test('an undeclared file under HOME/.plot fails the check and is named with its base', (t) => {
  const root = fixtureRoot(t);
  put(root, 'budget/budget.tsv');
  put(root, 'home/.plot/state/nobody-declared-this.json');
  const res = runCheck(root);
  assert.equal(res.status, 1, res.stderr);
  assert.match(res.stderr, /home\/\.plot\tstate\/nobody-declared-this\.json/);
  assert.doesNotMatch(res.stderr, /budget\.tsv/, 'a declared file is not reported');
});

test('a glob matches only within its own base', (t) => {
  const root = fixtureRoot(t);
  put(root, 'pr-index/budget.tsv');
  const res = runCheck(root);
  assert.equal(res.status, 1, res.stderr);
  assert.match(res.stderr, /pr-index\tbudget\.tsv/);
});

test('a manifest entry with a bound outside the vocabulary exits 2', (t) => {
  const root = fixtureRoot(t);
  const bad = path.join(root, 'manifest.json');
  writeFileSync(bad, JSON.stringify({
    coverage: 'fixture',
    entries: [{ base: 'budget', glob: '*.tsv', bound: 'forever', writer: 'fixture' }],
  }));
  const res = runCheck(root, bad);
  assert.equal(res.status, 2, res.stderr);
  assert.match(res.stderr, /"forever"/);
});

test('a manifest entry with two bounds exits 2', (t) => {
  const root = fixtureRoot(t);
  const bad = path.join(root, 'manifest.json');
  writeFileSync(bad, JSON.stringify({
    coverage: 'fixture',
    entries: [{ base: 'budget', glob: '*.tsv', bound: ['rotated', 'window'], writer: 'fixture' }],
  }));
  assert.equal(runCheck(root, bad).status, 2);
});

test('an unreadable root or manifest exits 2', (t) => {
  const root = fixtureRoot(t);
  assert.equal(runCheck(path.join(root, 'absent')).status, 2);
  const bad = path.join(root, 'manifest.json');
  writeFileSync(bad, '{ not json');
  assert.equal(runCheck(root, bad).status, 2);
});

test('the glob matcher reads *, ? and ** by path segment', async () => {
  const { globToRegex } = await import(check);
  assert.ok(globToRegex('state/*.json').test('state/a.json'));
  assert.ok(!globToRegex('state/*.json').test('state/x/a.json'), '* stays inside a segment');
  assert.ok(globToRegex('state/**').test('state/x/y/a.json'));
  assert.ok(globToRegex('**/a.json').test('a.json'), '**/ matches zero segments');
  assert.ok(globToRegex('**/a.json').test('x/y/a.json'));
  assert.ok(globToRegex('memo/?/x').test('memo/7/x'));
  assert.ok(!globToRegex('memo/?/x').test('memo/77/x'));
  assert.ok(!globToRegex('budget.tsv').test('budgetXtsv'), 'a dot is literal');
});

// THROUGH THE WRAPPER: the Done-when item "a fixture that writes an undeclared
// path under the sandbox HOME/.plot/ fails it and names the path".
const wrapper = path.join(repoRoot, 'scripts', 'owned-run.sh');

const runWrapped = (t, command) => {
  const tmp = mkdtempSync(path.join(tmpdir(), 'plot-inventory-run-'));
  t.after(() => rmSync(tmp, { recursive: true, force: true }));
  return spawnSync('bash', [wrapper, 'sh', '-c', command], {
    encoding: 'utf8',
    cwd: repoRoot,
    env: { ...process.env, TMPDIR: tmp },
  });
};

test('a run that writes an undeclared path under HOME/.plot fails and names it', (t) => {
  const res = runWrapped(t, 'mkdir -p "$HOME/.plot/state" && echo x > "$HOME/.plot/state/undeclared.txt"');
  assert.equal(res.status, 1, res.stderr);
  assert.match(res.stderr, /home\/\.plot\tstate\/undeclared\.txt/);
});

test('a run that writes only declared paths passes the inventory', (t) => {
  const res = runWrapped(t, 'echo x > "$PLOT_BUDGET_HOME/budget.tsv"');
  assert.equal(res.status, 0, res.stderr);
});

test('a run killed at its bound skips the inventory and keeps exit 124', (t) => {
  const res = runWrapped(t, 'mkdir -p "$HOME/.plot" && echo x > "$HOME/.plot/undeclared"; exit 124');
  assert.equal(res.status, 124, res.stderr);
  assert.doesNotMatch(res.stderr, /check-state-inventory/);
});
