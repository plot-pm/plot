// Contract test for scripts/check-ancestry-decisions.sh — the gate that bans
// the merge DECISION rather than the ancestry call.
//
// The gate exists because "did this branch's work land?" has one right answer
// here and it is the host's. Measured 2026-09-04: ten merged branches still
// carried a remote ref and `git merge-base --is-ancestor` disagreed with the
// host on ten of ten. But two ancestry callers in this repo are CORRECT — they
// ask *can I skip this cheaply*, where a wrong answer costs work rather than
// hiding it — so the gate cannot simply ban the call.
//
// It therefore asks each site to declare which kind it is. These tests pin the
// three properties that makes it a gate rather than a rule: it REFUSES an
// undeclared site, it ACCEPTS a declared one, and it does not fire on the
// repo's own tree.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(here, '..', '..');
const gate = path.join(repoRoot, 'scripts', 'check-ancestry-decisions.sh');

const run = (root) => spawnSync('bash', [gate, root], { encoding: 'utf8' });

/**
 * A throwaway tree holding one shell file with one ancestry call.
 *
 * The gate walks `skills/`, `packages/domain/src` and `packages/board/src`, so
 * the fixture puts its file where production code lives — checking a fixture in
 * a directory the gate ignores would prove nothing about the gate.
 */
function treeWith(body) {
  const dir = mkdtempSync(path.join(tmpdir(), 'plot-ancestry-'));
  mkdirSync(path.join(dir, 'skills', 'plot', 'scripts'), { recursive: true });
  writeFileSync(path.join(dir, 'skills', 'plot', 'scripts', 'demo.sh'), body);
  return dir;
}

test('ancestry gate: refuses an undeclared ancestry call', () => {
  const dir = treeWith([
    '#!/usr/bin/env bash',
    'landed() {',
    '  git merge-base --is-ancestor "$1" origin/main && return 0',
    '}',
    '',
  ].join('\n'));

  const got = run(dir);
  assert.equal(got.status, 1, `an undeclared site must fail the build:\n${got.stdout}`);
  assert.match(got.stdout, /demo\.sh:3/,
    `and the failure must name the line:\n${got.stdout}`);
  assert.match(got.stdout, /plot-pr-merged\.sh/,
    `and say where the right answer lives:\n${got.stdout}`);

  rmSync(dir, { recursive: true, force: true });
});

test('ancestry gate: accepts a call declared prefilter', () => {
  const dir = treeWith([
    '#!/usr/bin/env bash',
    'skip_landed() {',
    '  # plot-ancestry: prefilter — skips one merge-tree; a miss costs a wasted',
    '  # prediction and hides nothing.',
    '  git merge-base --is-ancestor "$1" origin/main && continue',
    '}',
    '',
  ].join('\n'));

  const got = run(dir);
  assert.equal(got.status, 0, `a declared site must pass:\n${got.stdout}`);
  assert.match(got.stdout, /declared: 1/, `and be counted:\n${got.stdout}`);

  rmSync(dir, { recursive: true, force: true });
});

test('ancestry gate: accepts a call declared evidence', () => {
  const dir = treeWith([
    '#!/usr/bin/env bash',
    'ancestors() {',
    '  # plot-ancestry: evidence — handed to the caller, which asks the host',
    '  # first and may answer unknown.',
    '  git branch -r --merged origin/main',
    '}',
    '',
  ].join('\n'));

  const got = run(dir);
  assert.equal(got.status, 0, `a declared site must pass:\n${got.stdout}`);

  rmSync(dir, { recursive: true, force: true });
});

test('ancestry gate: a declaration must sit BESIDE the call', () => {
  // A marker at the top of a file is a claim about a FILE. The rule is a claim
  // about a line, so the window is five lines and this fixture puts the marker
  // outside it.
  const dir = treeWith([
    '#!/usr/bin/env bash',
    '# plot-ancestry: prefilter — a claim made far from anything it describes.',
    '',
    '',
    '',
    '',
    '',
    'landed() {',
    '  git merge-base --is-ancestor "$1" origin/main',
    '}',
    '',
  ].join('\n'));

  const got = run(dir);
  assert.equal(got.status, 1, `a distant marker licenses nothing:\n${got.stdout}`);

  rmSync(dir, { recursive: true, force: true });
});

test('ancestry gate: a comment ABOUT ancestry is not a call', () => {
  // The gate must not fire on the prose that explains why ancestry is wrong —
  // this repo carries a great deal of it, and a gate that forced it out would
  // remove the reasoning and leave the calls.
  const dir = treeWith([
    '#!/usr/bin/env bash',
    '# This used to run `git merge-base --is-ancestor` and was wrong 10 times in',
    '# 10. It reads `git branch -r --merged` nowhere any more.',
    'landed() { pr_merged "$1"; }',
    '',
  ].join('\n'));

  const got = run(dir);
  assert.equal(got.status, 0, `prose must not fail the build:\n${got.stdout}`);
  assert.match(got.stdout, /declared: 0/, `and nothing was declared:\n${got.stdout}`);

  rmSync(dir, { recursive: true, force: true });
});

test('ancestry gate: this repo passes it', () => {
  // The gate runs in CI against this tree. A test that only exercised fixtures
  // would let the repo drift while every fixture still passed.
  const got = run(repoRoot);
  assert.equal(got.status, 0, `plot's own tree must be clean:\n${got.stdout}`);
});
