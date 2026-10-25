// Contract test for scripts/check-bash32-syntax.sh — the gate that keeps
// shipped shell runnable on bash 3.2, the version macOS ships.
//
// PR #2659 added `${1^^}` to `bb_query_state` in `plot-host.sh`. Every CI job
// here runs `ubuntu-latest` with bash 5, and `bash -n` passes on the broken
// head because a bad substitution is a run-time error, not a parse error —
// CI stayed green while all three Bitbucket PR queries were broken. A
// reviewer found it by reading (#2660). These tests pin: each of the eight
// bash-4+ constructs is caught alone, their bash-3.2 equivalents are not
// flagged, a comment naming a construct is not a hit, the one known false
// positive (`plot-fleetctl.sh:1144`) stays clean, the real defect commit
// fails and its fix passes, the gate passes on this repo's own tree, and an
// absent tree is a gate failure rather than a silent pass.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(here, '..', '..');
const gate = path.join(repoRoot, 'scripts', 'check-bash32-syntax.sh');

const run = (root) => spawnSync('bash', [gate, root], { encoding: 'utf8' });

/**
 * A throwaway tree holding one shell file at a chosen path under `scripts/`
 * — a root the gate actually walks. Returns the directory `mkdtempSync`
 * returned, so the caller can remove exactly that and nothing else.
 */
function treeWith(body, rel = 'scripts/demo.sh') {
  const dir = mkdtempSync(path.join(tmpdir(), 'plot-bash32-'));
  const full = path.join(dir, rel);
  mkdirSync(path.dirname(full), { recursive: true });
  writeFileSync(full, body);
  return dir;
}

// ---------------------------------------------------------------------------
// Each construct, alone, fails — and names the line and the construct.
// ---------------------------------------------------------------------------

test('bash32 gate: ${x^^} alone fails, naming the line', () => {
  const dir = treeWith([
    '#!/usr/bin/env bash',
    'x="a"',
    'echo "${x^^}"',
    '',
  ].join('\n'));

  const got = run(dir);
  assert.equal(got.status, 1, `must fail:\n${got.stdout}`);
  assert.match(got.stdout, /demo\.sh:3/, got.stdout);
  assert.match(got.stdout, /\$\{x\^\^\}/, got.stdout);

  rmSync(dir, { recursive: true, force: true });
});

test('bash32 gate: ${x,,} alone fails', () => {
  const dir = treeWith([
    '#!/usr/bin/env bash',
    'x="A"',
    'echo "${x,,}"',
    '',
  ].join('\n'));

  const got = run(dir);
  assert.equal(got.status, 1, `must fail:\n${got.stdout}`);
  assert.match(got.stdout, /demo\.sh:3/, got.stdout);

  rmSync(dir, { recursive: true, force: true });
});

test('bash32 gate: declare -A alone fails', () => {
  const dir = treeWith([
    '#!/usr/bin/env bash',
    'declare -A m=()',
    '',
  ].join('\n'));

  const got = run(dir);
  assert.equal(got.status, 1, `must fail:\n${got.stdout}`);
  assert.match(got.stdout, /demo\.sh:2/, got.stdout);

  rmSync(dir, { recursive: true, force: true });
});

test('bash32 gate: mapfile alone fails', () => {
  const dir = treeWith([
    '#!/usr/bin/env bash',
    'mapfile -t arr < file',
    '',
  ].join('\n'));

  const got = run(dir);
  assert.equal(got.status, 1, `must fail:\n${got.stdout}`);
  assert.match(got.stdout, /demo\.sh:2/, got.stdout);

  rmSync(dir, { recursive: true, force: true });
});

test('bash32 gate: readarray alone fails', () => {
  const dir = treeWith([
    '#!/usr/bin/env bash',
    'readarray -t arr < file',
    '',
  ].join('\n'));

  const got = run(dir);
  assert.equal(got.status, 1, `must fail:\n${got.stdout}`);
  assert.match(got.stdout, /demo\.sh:2/, got.stdout);

  rmSync(dir, { recursive: true, force: true });
});

test('bash32 gate: |& alone fails', () => {
  const dir = treeWith([
    '#!/usr/bin/env bash',
    'cmd1 |& cmd2',
    '',
  ].join('\n'));

  const got = run(dir);
  assert.equal(got.status, 1, `must fail:\n${got.stdout}`);
  assert.match(got.stdout, /demo\.sh:2/, got.stdout);

  rmSync(dir, { recursive: true, force: true });
});

test('bash32 gate: &>> alone fails', () => {
  const dir = treeWith([
    '#!/usr/bin/env bash',
    'cmd &>> out.log',
    '',
  ].join('\n'));

  const got = run(dir);
  assert.equal(got.status, 1, `must fail:\n${got.stdout}`);
  assert.match(got.stdout, /demo\.sh:2/, got.stdout);

  rmSync(dir, { recursive: true, force: true });
});

test('bash32 gate: ${x@Q} alone fails', () => {
  const dir = treeWith([
    '#!/usr/bin/env bash',
    'x="a b"',
    'printf "%s" "${x@Q}"',
    '',
  ].join('\n'));

  const got = run(dir);
  assert.equal(got.status, 1, `must fail:\n${got.stdout}`);
  assert.match(got.stdout, /demo\.sh:3/, got.stdout);

  rmSync(dir, { recursive: true, force: true });
});

test('bash32 gate: one fixture holding all eight proves only one fired per assertion', () => {
  // A single fixture naming all eight would pass even if only one pattern
  // actually worked. Each construct above is its OWN fixture and its OWN
  // assertion; this test only confirms the combined fixture still fails,
  // not which construct caused it.
  const dir = treeWith([
    '#!/usr/bin/env bash',
    'declare -A m=()',
    'x="a"',
    'echo "${x^^}"',
    'echo "${x,,}"',
    'mapfile -t arr < f',
    'readarray -t arr2 < f',
    'cmd1 |& cmd2',
    'cmd &>> out.log',
    'printf "%s" "${x@Q}"',
    '',
  ].join('\n'));

  const got = run(dir);
  assert.equal(got.status, 1, `must fail:\n${got.stdout}`);

  rmSync(dir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// The bash-3.2 equivalent of each construct passes.
// ---------------------------------------------------------------------------

test('bash32 gate: tr for upper/lower passes', () => {
  const dir = treeWith([
    '#!/usr/bin/env bash',
    'x="abc"',
    'echo "$(printf \'%s\' "$x" | tr \'[:lower:]\' \'[:upper:]\')"',
    '',
  ].join('\n'));

  const got = run(dir);
  assert.equal(got.status, 0, `tr must pass:\n${got.stdout}`);

  rmSync(dir, { recursive: true, force: true });
});

test('bash32 gate: a newline-delimited string passes', () => {
  const dir = treeWith([
    '#!/usr/bin/env bash',
    'items="a',
    'b',
    'c"',
    'while IFS= read -r line; do echo "$line"; done <<< "$items"',
    '',
  ].join('\n'));

  const got = run(dir);
  assert.equal(got.status, 0, `a newline-delimited string must pass:\n${got.stdout}`);

  rmSync(dir, { recursive: true, force: true });
});

test('bash32 gate: a while-read loop passes', () => {
  const dir = treeWith([
    '#!/usr/bin/env bash',
    'while IFS= read -r line; do echo "$line"; done < file',
    '',
  ].join('\n'));

  const got = run(dir);
  assert.equal(got.status, 0, `a while-read loop must pass:\n${got.stdout}`);

  rmSync(dir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// Comments and quoted prose are not constructs — the assertion that stops
// this gate being reverted on its first run, same as check-host-cli-callers.
// ---------------------------------------------------------------------------

test('bash32 gate: a full-line comment naming declare -A passes', () => {
  const dir = treeWith([
    '#!/usr/bin/env bash',
    '# bash 3.2 on macOS: no `declare -A`, so this accumulates into a string',
    'noop() { :; }',
    '',
  ].join('\n'));

  const got = run(dir);
  assert.equal(got.status, 0, `a comment must not fail the build:\n${got.stdout}`);

  rmSync(dir, { recursive: true, force: true });
});

test('bash32 gate: a trailing comment naming declare -A passes', () => {
  const dir = treeWith([
    '#!/usr/bin/env bash',
    'noop() { :; } # not a declare -A, bash 3.2 has none',
    '',
  ].join('\n'));

  const got = run(dir);
  assert.equal(got.status, 0, `a trailing comment must not fail the build:\n${got.stdout}`);

  rmSync(dir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// The one false positive this gate must design around.
// ---------------------------------------------------------------------------

test('bash32 gate: plot-fleetctl.sh:1144\'s sed line passes', () => {
  // `|&` sits inside a bracket expression here, not as a pipe operator.
  const dir = treeWith([
    '#!/usr/bin/env bash',
    '  pct=\'%\'; [ "$plat" = systemd ] && pct=\'%%\'; esc() { printf \'%s\' "$1" | sed -e \'s/[][\\\\|&.*^$]/\\\\&/g\' -e "s/%/$pct/g"; }',
    '',
  ].join('\n'));

  const got = run(dir);
  assert.equal(got.status, 0, `the sed bracket expression must not fail:\n${got.stdout}`);

  rmSync(dir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// The real defect, vendored — see CLAUDE.md's rule on commits absent from
// main: a test that runs `git show` on a squash-merged PR's commit breaks on
// a fresh clone, so the two function bodies are copied here as fixture text.
// ---------------------------------------------------------------------------

test('bash32 gate: bb_query_state as it stood at 5cc5a5743 (the defect) fails', () => {
  const dir = treeWith([
    '#!/usr/bin/env bash',
    "bb_query_state() { # \$1=adapter state word -> Bitbucket's",
    '  case "$1" in',
    '    open|merged|declined|superseded) printf \'%s\' "${1^^}" ;;',
    "    *) die \"bb_query_state: unknown state '\$1'\" ;;",
    '  esac',
    '}',
    '',
  ].join('\n'));

  const got = run(dir);
  assert.equal(got.status, 1, `the defect must fail:\n${got.stdout}`);
  assert.match(got.stdout, /demo\.sh:4/, got.stdout);

  rmSync(dir, { recursive: true, force: true });
});

test('bash32 gate: bb_query_state as it stands at d471a21ac (the fix) passes', () => {
  const dir = treeWith([
    '#!/usr/bin/env bash',
    "bb_query_state() { # \$1=adapter state word -> Bitbucket's",
    '  case "$1" in',
    '    open|merged|declined|superseded) printf \'%s\' "$1" | tr \'[:lower:]\' \'[:upper:]\' ;;',
    "    *) die \"bb_query_state: unknown state '\$1'\" ;;",
    '  esac',
    '}',
    '',
  ].join('\n'));

  const got = run(dir);
  assert.equal(got.status, 0, `the fix must pass:\n${got.stdout}`);

  rmSync(dir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// A deliberate use must declare itself with a guarded marker, or it is a
// violation like any other — a marker alone is not a licence.
// ---------------------------------------------------------------------------

test('bash32 gate: a marker with a BASH_VERSINFO guard above it passes', () => {
  const dir = treeWith([
    '#!/usr/bin/env bash',
    '# plot-bash32: deliberate — guarded by a BASH_VERSINFO[0] check above.',
    'if [ "${BASH_VERSINFO[0]}" -ge 4 ]; then',
    '  declare -A m=()',
    'fi',
    '',
  ].join('\n'));

  const got = run(dir);
  assert.equal(got.status, 0, `a guarded declaration must pass:\n${got.stdout}`);

  rmSync(dir, { recursive: true, force: true });
});

test('bash32 gate: a marker with no guard comment nearby still fails', () => {
  const dir = treeWith([
    '#!/usr/bin/env bash',
    '# plot-bash32: deliberate — trust me on this one',
    'declare -A m=()',
    '',
  ].join('\n'));

  const got = run(dir);
  assert.equal(got.status, 1, `a marker with no guard must not exempt the line:\n${got.stdout}`);

  rmSync(dir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// Carried rules: absent is not false, and the gate passes on its own tree.
// ---------------------------------------------------------------------------

test('bash32 gate: a root with no shell files fails (exit 2), not a clean pass', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'plot-bash32-empty-'));
  mkdirSync(path.join(dir, 'scripts'), { recursive: true });
  mkdirSync(path.join(dir, 'skills'), { recursive: true });

  const got = run(dir);
  assert.equal(got.status, 2, `absent shell must not read as a pass:\n${got.stdout}`);

  rmSync(dir, { recursive: true, force: true });
});

test('bash32 gate: the repo\'s own tree is clean', () => {
  const got = run(repoRoot);
  assert.equal(got.status, 0, `this repo must pass its own gate:\n${got.stdout}`);
  assert.match(got.stdout, /Bash 3\.2 syntax: clean/, got.stdout);
});
