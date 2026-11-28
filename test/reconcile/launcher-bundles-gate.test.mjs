// Contract test for scripts/check-launcher-bundles.sh — the gate that refuses a
// shipped launcher which execs a literal `board/*.mjs` path, because the
// local-check selection maps a launcher to its bundle only through its
// `bundle=` line.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(here, '..', '..');
const gate = path.join(repoRoot, 'scripts', 'check-launcher-bundles.sh');

const run = (root) => spawnSync('bash', root === undefined ? [gate] : [gate, root], { encoding: 'utf8' });

const treeWith = (body, rel = 'skills/plot/scripts/demo.sh') => {
  const dir = mkdtempSync(path.join(tmpdir(), 'plot-launcher-gate-'));
  const full = path.join(dir, rel);
  mkdirSync(path.dirname(full), { recursive: true });
  writeFileSync(full, body);
  return dir;
};

test('launcher gate: refuses a launcher that execs a literal bundle path, naming the file and line', () => {
  const dir = treeWith(['#!/usr/bin/env bash', 'x=$(dirname "$0")', 'exec node "$x/board/y.mjs" "$@"', ''].join('\n'));
  try {
    const got = run(dir);
    assert.equal(got.status, 1, got.stdout);
    assert.match(got.stdout, /skills\/plot\/scripts\/demo\.sh:3:/, got.stdout);
    assert.match(got.stdout, /bundle="\$script_dir\/board\/<name>\.mjs"/, got.stdout);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('launcher gate: passes the bundle= form, a comment and a mid-script mention', () => {
  const dir = treeWith(
    [
      '#!/usr/bin/env bash',
      'script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"',
      '# exec node "$script_dir/board/z.mjs"',
      'node "$script_dir/board/w.mjs" --once',
      'bundle="$script_dir/board/y.mjs"',
      'exec node "$bundle" "$@"',
      '',
    ].join('\n'),
  );
  try {
    const got = run(dir);
    assert.equal(got.status, 0, got.stdout);
    assert.match(got.stdout, /launchers that exec "\$bundle": 1/, got.stdout);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('launcher gate: passes on this repository', () => {
  const got = run();
  assert.equal(got.status, 0, got.stdout);
  assert.match(got.stdout, /Launcher bundles: clean\./, got.stdout);
});
