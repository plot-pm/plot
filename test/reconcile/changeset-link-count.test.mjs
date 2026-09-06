// Contract test for scripts/check-changeset-packages.sh — the count of
// changesets naming a plan, and the refusal it deliberately is not.
//
// COUNT FIRST, GATE LATER. Measured 2026-09-06, before the convention landed:
// 0 of 14 changesets named a plan. A gate demanding one would have refused
// every changeset in flight, so this check REPORTS the number and exits 0
// whatever it is. The assertion that matters most is therefore the negative
// one: an unlinked changeset is named in the output and still exits 0.
//
// THE COUNT AND THE EXIT CODE ARE PROVED SEPARATELY, because they are separate
// claims. A check that counted correctly and failed would be useless in exactly
// the same way as one that passed and counted nothing.
//
// The fixtures are handed to the script through its root argument, so what is
// asserted is a known population rather than whatever this estate carries on
// the day the suite runs — 1 of 28 today, a different pair tomorrow.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(here, '..', '..');
const check = path.join(repoRoot, 'scripts', 'check-changeset-packages.sh');

const rmTree = (dir) => rmSync(dir, { recursive: true, force: true });

const run = (root) => spawnSync('bash', [check, root], { encoding: 'utf8' });

/** A description comfortably above the rule's 20-character floor. */
const PROSE = 'A description long enough to clear the floor.';

/**
 * A changeset body, optionally linking a plan.
 *
 * The prose comes FIRST and the comment LAST, which is the order rule this
 * repo measured at 19 of 169 published entries: Changesets publishes the first
 * non-empty line after the frontmatter, so a comment written first becomes the
 * release note.
 *
 * @param plan - the plan path to link, or null for an unlinked changeset.
 * @returns the file's full contents.
 */
const changeset = (plan) =>
  [
    '---',
    "'fixture-root': patch",
    '---',
    '',
    PROSE,
    ...(plan ? ['', '<!--', `plan: ${plan}`, '-->'] : []),
    '',
  ].join('\n');

/**
 * A throwaway repository holding a package manifest and some changesets.
 *
 * NO `packages/` DIRECTORY, deliberately — that is the shape which broke the
 * script's own glob under `set -e`, and every fixture here keeps reproducing
 * the condition rather than working around it.
 *
 * @param files - changeset basename to contents.
 * @returns the fixture root.
 */
function treeWith(files) {
  const dir = mkdtempSync(path.join(tmpdir(), 'plot-changeset-count-'));
  writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: 'fixture-root' }));
  mkdirSync(path.join(dir, '.changeset'));
  for (const [name, text] of Object.entries(files)) {
    writeFileSync(path.join(dir, '.changeset', name), text);
  }
  return dir;
}

test('count: reports how many changesets name a plan', () => {
  const dir = treeWith({
    'linked.md': changeset('docs/plans/2026-09-06-a-changeset-names-its-plan.md'),
    'unlinked.md': changeset(null),
  });
  try {
    const got = run(dir);
    assert.match(got.stdout, /changesets naming a plan: 1 of 2/,
      `the count must name both halves:\n${got.stdout}${got.stderr}`);
  } finally {
    rmTree(dir);
  }
});

test('count: names the changesets that link no plan', () => {
  // A BARE NUMBER IS NOT ACTIONABLE, and a finding must be actionable the day
  // it fires. The names are what a person opens, and the ratchet's input once
  // adoption is non-zero.
  const dir = treeWith({
    'linked.md': changeset('docs/plans/x.md'),
    'alpha.md': changeset(null),
    'beta.md': changeset(null),
  });
  try {
    const got = run(dir);
    assert.match(got.stdout, /2 changeset\(s\) name no plan/,
      `the notice must count the unlinked:\n${got.stdout}`);
    assert.match(got.stdout, /\.changeset\/alpha\.md/, 'alpha must be named');
    assert.match(got.stdout, /\.changeset\/beta\.md/, 'beta must be named');
    assert.doesNotMatch(got.stdout, /\.changeset\/linked\.md/,
      'a linked changeset must not be listed as missing one');
  } finally {
    rmTree(dir);
  }
});

test('count: an unlinked changeset exits 0 — it is counted, never refused', () => {
  // THE LOAD-BEARING ASSERTION. Enforcing a convention at 0 of 14 adoption
  // would refuse every changeset in flight, so the missing link is reported
  // and the exit code is unaffected.
  const dir = treeWith({ 'unlinked.md': changeset(null) });
  try {
    const got = run(dir);
    assert.equal(got.status, 0,
      `an unlinked changeset must not fail the check:\n${got.stdout}${got.stderr}`);
    assert.match(got.stdout, /changesets naming a plan: 0 of 1/);
  } finally {
    rmTree(dir);
  }
});

test('count: a fully linked estate exits 0 and prints no notice', () => {
  const dir = treeWith({ 'linked.md': changeset('docs/plans/x.md') });
  try {
    const got = run(dir);
    assert.equal(got.status, 0, `${got.stdout}${got.stderr}`);
    assert.match(got.stdout, /changesets naming a plan: 1 of 1/);
    assert.doesNotMatch(got.stdout, /name no plan/,
      'nothing to report means nothing printed');
  } finally {
    rmTree(dir);
  }
});

test('count: the notice is a notice, never an error', () => {
  // The other ratchets in ci.yml bound a number that must not GROW and use
  // `::error::` when it does. This one watches a number that SHOULD grow, so
  // there is no count at which it becomes a failure.
  const dir = treeWith({ 'unlinked.md': changeset(null) });
  try {
    const got = run(dir);
    assert.match(got.stdout, /::notice::/, 'the missing links are a notice');
    assert.doesNotMatch(got.stdout, /::error::/,
      `a missing link must never be rendered as an error:\n${got.stdout}`);
  } finally {
    rmTree(dir);
  }
});

// ── The existing refusals are untouched ─────────────────────────────────────

test('count: the published-description rule still refuses a comment-first body', () => {
  // 19 of 169 published entries printed a bare comment marker as their whole
  // description. Reading a `plan:` line must not change which line publishes,
  // so the refusal that catches it is asserted here rather than assumed.
  const dir = treeWith({
    'bad.md': ['---', "'fixture-root': patch", '---', '', '<!--', 'bumps:', '-->', '', PROSE, ''].join('\n'),
  });
  try {
    const got = run(dir);
    assert.equal(got.status, 1, 'a comment-first changeset must still be refused');
    assert.match(got.stdout, /::error file=/, 'and refused by file');
  } finally {
    rmTree(dir);
  }
});

test('count: a plan line written FIRST is still refused', () => {
  // `plan: docs/plans/x.md` is 21 characters — one over the floor — so the
  // length check alone passes it. It would publish as the release note, which
  // is the same failure the comment marker produced.
  const dir = treeWith({
    'planfirst.md': ['---', "'fixture-root': patch", '---', '', 'plan: docs/plans/x.md', '', PROSE, ''].join('\n'),
  });
  try {
    const got = run(dir);
    assert.equal(got.status, 1, 'a plan line first must still be refused');
  } finally {
    rmTree(dir);
  }
});

test('count: an unknown package still aborts, whatever the link count', () => {
  const dir = treeWith({
    'unknown.md': ['---', "'@plot-pm/nope': patch", '---', '', PROSE, '', '<!--', 'plan: docs/plans/x.md', '-->', ''].join('\n'),
  });
  try {
    const got = run(dir);
    assert.equal(got.status, 1, 'an unknown package is still a refusal');
    assert.match(got.stdout, /not a workspace package/);
  } finally {
    rmTree(dir);
  }
});

// ── The script survives the shapes a fixture has and this repo does not ─────

test('count: a repository with no packages/ directory does not abort', () => {
  // The bug the root argument exposed: `[ -f ... ]` is the last command in the
  // glob loop, so under `set -e` an unexpanded `packages/*/` aborted the whole
  // script — exit 1, empty stdout, empty stderr. Invisible in this repo, where
  // `packages/` always exists.
  const dir = treeWith({ 'one.md': changeset(null) });
  try {
    const got = run(dir);
    assert.equal(got.status, 0, `${got.stdout}${got.stderr}`);
    assert.notEqual(got.stdout.trim(), '',
      'a silent exit is the failure this asserts against');
  } finally {
    rmTree(dir);
  }
});

test('count: an empty .changeset directory is not a failure', () => {
  // A branch may legitimately carry none; the separate "Check for changeset"
  // CI step is what requires one.
  const dir = treeWith({});
  try {
    const got = run(dir);
    assert.equal(got.status, 0, `${got.stdout}${got.stderr}`);
    assert.match(got.stdout, /changesets naming a plan: 0 of 0/);
  } finally {
    rmTree(dir);
  }
});

// ── The rule is the one source of the reading ───────────────────────────────

test('count: the script asks the domain rather than re-reading the format', () => {
  // The plan is explicit that this slice must not add a third implementation
  // of "is this changeset valid". The script imports `parseChangeset` and
  // `checkChangeset`; a regex over `plan:` written here would be the third.
  const src = readFileSync(check, 'utf8');
  assert.match(src, /parseChangeset/, 'the link count must come from the rule');
  assert.match(src, /checkChangeset/, 'and so must the refusals');
  assert.doesNotMatch(src, /\/\^\\s\*\(\?:#/,
    'the plan-line pattern belongs to rules/changeset.ts alone');
});
