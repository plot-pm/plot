// Contract test for scripts/check-host-cli-callers.sh — the gate that keeps
// `plot-host.sh` the one script talking to a git host CLI.
//
// The rule *"the ONE place that talks to the host CLI"* sat in CLAUDE.md while
// four scripts violated it, which is a rule failing exactly as CLAUDE.md says a
// rule will. These tests pin the four properties that make the replacement a
// gate rather than a second rule: it REFUSES a new direct call, it does not
// fire on a comment or on advice text, it honours the exemption list, and it
// passes on the repo's own tree.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(here, '..', '..');
const gate = path.join(repoRoot, 'scripts', 'check-host-cli-callers.sh');

const run = (root) => spawnSync('bash', [gate, root], { encoding: 'utf8' });

/**
 * A throwaway tree holding one shell file at a chosen path.
 *
 * The gate walks `skills/`, `scripts/` and `hooks/`, so the fixture puts its
 * file where production shell lives — a file in a directory the gate ignores
 * would prove nothing about the gate.
 */
function treeWith(body, rel = 'skills/plot/scripts/demo.sh') {
  const dir = mkdtempSync(path.join(tmpdir(), 'plot-hostcli-'));
  const full = path.join(dir, rel);
  mkdirSync(path.dirname(full), { recursive: true });
  writeFileSync(full, body);
  return dir;
}

test('host CLI gate: refuses a new direct gh call', () => {
  // THE CASE THE GATE EXISTS FOR — the fifth script, arriving unnoticed.
  const dir = treeWith([
    '#!/usr/bin/env bash',
    'landed() {',
    '  out=$(gh pr list --head "$1" --state all --json mergedAt)',
    '}',
    '',
  ].join('\n'));

  const got = run(dir);
  assert.equal(got.status, 1, `a direct gh call must fail the build:\n${got.stdout}`);
  assert.match(got.stdout, /demo\.sh:3/, `and the failure must name the line:\n${got.stdout}`);
  assert.match(got.stdout, /plot-host\.sh pr-state/,
    `and say which op to use instead:\n${got.stdout}`);

  rmSync(dir, { recursive: true, force: true });
});

test('host CLI gate: refuses a direct bb call too', () => {
  // Both CLIs, or the gate protects GitHub checkouts only — which is the very
  // asymmetry the routing removed.
  const dir = treeWith([
    '#!/usr/bin/env bash',
    'open_prs() { bb pr list --state open --json; }',
    '',
  ].join('\n'));

  const got = run(dir);
  assert.equal(got.status, 1, `a direct bb call must fail the build:\n${got.stdout}`);
  assert.match(got.stdout, /demo\.sh:2/, `and name the line:\n${got.stdout}`);

  rmSync(dir, { recursive: true, force: true });
});

test('host CLI gate: a comment mentioning gh is not a call', () => {
  // `plot-budget.sh` and `plot-worker-monitor.sh` mention `gh` in prose only.
  // A gate flagging them would be reverted on its first run, and a reverted
  // gate protects nothing.
  const dir = treeWith([
    '#!/usr/bin/env bash',
    '# This used to call `gh pr list --state all` before the adapter existed.',
    '#   gh pr view 12 --json state',
    'noop() { :; }',
    '',
  ].join('\n'));

  const got = run(dir);
  assert.equal(got.status, 0, `a comment must not fail the build:\n${got.stdout}`);

  rmSync(dir, { recursive: true, force: true });
});

test('host CLI gate: advice printed to a person is not a call', () => {
  // `plot-reconcile-scan.sh` prints `inspect: gh pr view …` INSIDE a report
  // string — a suggestion to an operator, not a call this process makes.
  const dir = treeWith([
    '#!/usr/bin/env bash',
    'report() {',
    '  out+="    inspect: gh pr view $last_pr --json state,mergeCommit\\n"',
    '  echo "run: bb pr list --state open to see the rest"',
    '}',
    '',
  ].join('\n'));

  const got = run(dir);
  assert.equal(got.status, 0, `advice text must not fail the build:\n${got.stdout}`);

  rmSync(dir, { recursive: true, force: true });
});

test('host CLI gate: an exempted script may call the CLI', () => {
  // `plot-update-board.sh` asks the GitHub PROJECTS API, which the adapter does
  // not answer at all. The exemption is by exact path, so a same-named file
  // elsewhere gains nothing from it.
  const dir = treeWith([
    '#!/usr/bin/env bash',
    'PROJECT_ID=$(gh project view "$N" --owner "$O" --format json)',
    '',
  ].join('\n'), 'skills/plot/scripts/plot-update-board.sh');

  const got = run(dir);
  assert.equal(got.status, 0, `an exempted script must pass:\n${got.stdout}`);
  assert.match(got.stdout, /exempted scripts: 1/, `and be counted:\n${got.stdout}`);

  rmSync(dir, { recursive: true, force: true });
});

test('host CLI gate: the exemption is by path, not by basename', () => {
  // A file named like an exempted one, somewhere else, is still a violation —
  // otherwise the list is a naming convention rather than a list.
  const dir = treeWith([
    '#!/usr/bin/env bash',
    'gh pr list --state open',
    '',
  ].join('\n'), 'skills/other/plot-update-board.sh');

  const got = run(dir);
  assert.equal(got.status, 1, `an exemption must not travel by name:\n${got.stdout}`);

  rmSync(dir, { recursive: true, force: true });
});

test('host CLI gate: the repo\'s own tree is clean', () => {
  // The gate must pass on this repo as it stands, or it lands red and gets
  // disabled rather than obeyed.
  const got = run(repoRoot);
  assert.equal(got.status, 0, `this repo must pass its own gate:\n${got.stdout}`);
  assert.match(got.stdout, /Host CLI callers: clean/, got.stdout);
});
