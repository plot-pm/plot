// Contract test for scripts/check-entry-exit.sh — the gate that keeps a bare
// `process.exit` out of an entry bundle.
//
// `process.exit(code)` abandons a queued stdout/stderr write before Node
// flushes it, truncating output past about 64 KB. `endEntry` fixes the one
// call site that matters; this gate is what stops a 67th bare `process.exit`
// from reintroducing the defect under a different file name. Unlike the host
// CLI gate, there is no exemption list here — every site must route through
// `endEntry`, so these tests do not need to pin one.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(here, '..', '..');
const gate = path.join(repoRoot, 'scripts', 'check-entry-exit.sh');

const run = (root) => spawnSync('bash', [gate, root], { encoding: 'utf8' });

/**
 * A throwaway tree holding one entry file at a chosen path.
 *
 * The gate walks `packages/*\/src/server/entry/*.ts`, so the fixture puts its
 * file there — a file outside that tree would prove nothing about the gate.
 */
function treeWith(body, rel = 'packages/board/src/server/entry/demo.ts') {
  const dir = mkdtempSync(path.join(tmpdir(), 'plot-entryexit-'));
  const full = path.join(dir, rel);
  mkdirSync(path.dirname(full), { recursive: true });
  writeFileSync(full, body);
  return dir;
}

test('entry exit gate: refuses a bare process.exit', () => {
  // THE CASE THE GATE EXISTS FOR — a 67th site, arriving unnoticed.
  const dir = treeWith([
    "import { endEntry } from '@plot-pm/domain/adapters/entry-exit';",
    'const run = () => 0;',
    'process.exit(run());',
    '',
  ].join('\n'));

  const got = run(dir);
  assert.equal(got.status, 1, `a bare process.exit must fail the build:\n${got.stdout}`);
  assert.match(got.stdout, /demo\.ts:3/, `and the failure must name the line:\n${got.stdout}`);
  assert.match(got.stdout, /endEntry/, `and say what to use instead:\n${got.stdout}`);

  rmSync(dir, { recursive: true, force: true });
});

test('entry exit gate: there is no allow-list — every file under the tree is checked', () => {
  // The brief is explicit: zero allowed sites, no allow-list, no ratchet.
  // A violation anywhere under packages/*/src/server/entry/ fails, with no
  // path this gate accepts the way the host CLI gate accepts a named file.
  const dir = treeWith([
    'process.exit(1);',
    '',
  ].join('\n'), 'packages/fleet/src/server/entry/another.ts');

  const got = run(dir);
  assert.equal(got.status, 1, `a violation in any package must fail:\n${got.stdout}`);
  assert.doesNotMatch(got.stdout, /exempt/i, `the gate must not offer an exemption path:\n${got.stdout}`);

  rmSync(dir, { recursive: true, force: true });
});

test('entry exit gate: a line comment mentioning process.exit is not a call', () => {
  const dir = treeWith([
    '// used to call process.exit(code) here before endEntry existed',
    "const run = () => 0;",
    'export { run };',
    '',
  ].join('\n'));

  const got = run(dir);
  assert.equal(got.status, 0, `a line comment must not fail the build:\n${got.stdout}`);

  rmSync(dir, { recursive: true, force: true });
});

test('entry exit gate: a block-comment continuation mentioning process.exit is not a call', () => {
  const dir = treeWith([
    '/**',
    ' * Does not call process.exit(code) directly — see endEntry.',
    ' */',
    'const run = () => 0;',
    'export { run };',
    '',
  ].join('\n'));

  const got = run(dir);
  assert.equal(got.status, 0, `a block comment must not fail the build:\n${got.stdout}`);

  rmSync(dir, { recursive: true, force: true });
});

test('entry exit gate: endEntry itself is not flagged', () => {
  const dir = treeWith([
    "import { endEntry } from '@plot-pm/domain/adapters/entry-exit';",
    'const run = () => 0;',
    'void endEntry(run());',
    '',
  ].join('\n'));

  const got = run(dir);
  assert.equal(got.status, 0, `a call routed through endEntry must pass:\n${got.stdout}`);

  rmSync(dir, { recursive: true, force: true });
});

test('entry exit gate: a tree with no matching files refuses to pass silently', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'plot-entryexit-empty-'));

  const got = run(dir);
  assert.equal(got.status, 2, `an empty tree must not read as clean:\n${got.stdout}`);

  rmSync(dir, { recursive: true, force: true });
});

test('entry exit gate: the repo\'s own tree is clean', () => {
  // The gate must pass on this repo as it stands, or it lands red and gets
  // disabled rather than obeyed.
  const got = run(repoRoot);
  assert.equal(got.status, 0, `this repo must pass its own gate:\n${got.stdout}`);
  assert.match(got.stdout, /Entry exit: clean/, got.stdout);
});
