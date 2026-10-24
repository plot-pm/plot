// A slice heading names a branch, or the parser says it could not.
//
// Two halves of plot-plan-meta.sh: the `Branch:` value in a `### ` heading is
// read with or without backticks, and a heading carrying `Branch:` whose wave
// holds no branch is listed in `unread_branch_headings`. The second half is
// what separates a slice the parser lost from a narrative heading, which
// carries no `Branch:` and is not a defect.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(here, '..', '..');
const parser = path.join(repoRoot, 'skills', 'plot', 'scripts', 'plot-plan-meta.sh');

const parseSource = (src) => {
  const dir = mkdtempSync(path.join(tmpdir(), 'plot-branch-heading-'));
  const f = path.join(dir, '2026-09-28-fixture.md');
  writeFileSync(f, src);
  try {
    return JSON.parse(execFileSync('bash', [parser, f], { encoding: 'utf8' }));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
};

const parsePlan = (name) =>
  JSON.parse(execFileSync('bash', [parser, path.join(repoRoot, 'docs', 'plans', name)], { encoding: 'utf8' }));

const plan = (slices) => `# Fixture

## Status

- **State:** Approved
- **Type:** bug

## Slices

${slices}
`;

test('plan-meta: a backticked and a bare Branch: value parse to the same branch', () => {
  const bare = parseSource(plan('### A wave (Branch: bug/x)\n\nWork.\n'));
  const ticked = parseSource(plan('### A wave (Branch: `bug/x`)\n\nWork.\n'));
  assert.deepEqual(bare.branches, ['bug/x']);
  assert.deepEqual(ticked.branches, ['bug/x']);
  assert.deepEqual(ticked.waves, bare.waves, 'waves[] identical for both spellings');
  assert.deepEqual(ticked.unread_branch_headings, []);
});

test('plan-meta: a backticked value followed by PR: keeps both', () => {
  const meta = parseSource(plan('### Removed (Branch: `bug/foo`, PR: #300)\n\nWork.\n'));
  assert.deepEqual(meta.branches, ['bug/foo']);
  assert.deepEqual(meta.prs, [300]);
  assert.equal(meta.waves[0].name, 'Removed');
});

test('plan-meta: a Branch: heading that yields no branch is named in unread_branch_headings', () => {
  // `feat/` is not a configured prefix, so the heading opens a wave and the
  // extraction takes nothing — the shape of any value the parser cannot read.
  const meta = parseSource(plan('### Lost (Branch: feat/nope)\n\nWork.\n\n### Read (Branch: bug/ok)\n\nWork.\n'));
  assert.deepEqual(meta.branches, ['bug/ok']);
  assert.deepEqual(meta.unread_branch_headings, ['Lost (Branch: feat/nope)']);
});

test('plan-meta: the first-heading latch (#1042) loses nothing, in either order', () => {
  // The minimal pair from the plan: identical content, reordered. This test
  // PINNED THE DEFECT when the field shipped — the latch routed a
  // narrative-first section to the list consumer, the branched heading yielded
  // nothing, and this report named it, which is what the field is for.
  //
  // #1042 removed the latch on 2026-09-28, so the pair now agrees and there is
  // nothing left to report. The assertion is inverted rather than deleted: the
  // pair is the right fixture either way, and a reader arriving from the issue
  // finds the case it names. The detector's own behaviour is unchanged and
  // asserted by the three tests below.
  const narrative = '### A narrative heading with no branch\n\nProse.\n';
  const real = '### Real work (Branch: bug/real-work)\n\nWork.\n';
  const latched = parseSource(plan(narrative + '\n' + real));
  assert.deepEqual(latched.branches, ['bug/real-work'],
    'a branched heading below a narrative one is read — #1042 is fixed');
  assert.deepEqual(latched.unread_branch_headings, [],
    'and so there is no unread heading to report');
  const read = parseSource(plan(real + '\n' + narrative));
  assert.deepEqual(read.branches, ['bug/real-work']);
  assert.deepEqual(read.unread_branch_headings, []);
  assert.deepEqual(latched.branches, read.branches,
    'the order of two headings cannot change the answer');
});

test('plan-meta: an empty wave whose heading carries no Branch: is not reported', () => {
  const meta = parseSource(plan('### Real (Branch: bug/real)\n\nWork.\n\n### Why it matters\n\nProse.\n'));
  assert.equal(meta.waves.length, 2);
  assert.deepEqual(meta.waves[1].branches, [], 'the narrative heading is an empty wave');
  assert.deepEqual(meta.unread_branch_headings, []);
});

test('plan-meta: a list-shape wave whose heading says Branch: and whose items name one is not reported', () => {
  const meta = parseSource(plan('### Tracer (Branch: bug/t)\n- `bug/t` — the item\n').replace('## Slices', '## Branches'));
  // First heading carries `(Branch:`, so this is the heading shape; either way
  // the wave holds a branch and nothing is unread.
  assert.deepEqual(meta.branches, ['bug/t']);
  assert.deepEqual(meta.unread_branch_headings, []);
});

test('plan-meta: the two Rejected plans written with backticks now carry their branches', () => {
  assert.deepEqual(parsePlan('2026-09-26-a-parsed-plan-joins-the-index.md').branches, [
    'infra/a-parsed-plan-joins-the-index', 'infra/the-parse-is-a-pure-function', 'infra/the-scan-reads-the-plan-index',
  ]);
  assert.deepEqual(parsePlan('2026-09-26-the-board-updates-an-index.md').branches, [
    'bug/every-tool-call-updates-the-index', 'bug/the-board-updates-an-index', 'bug/the-index-serves-its-consumers',
  ]);
});

test('plan-meta: a missing file carries an empty unread_branch_headings', () => {
  const out = execFileSync('bash', [parser, path.join(tmpdir(), 'no-such-plan-2026.md')], { encoding: 'utf8' });
  assert.deepEqual(JSON.parse(out).unread_branch_headings, []);
});

// bug/plot-plan-meta-a-branch-heading: a heading-shape wave's list item that
// names the SAME branch as its heading is read for its `→ #N` and its
// annotations; one naming a DIFFERENT branch, or a mere prose citation, stays
// unread exactly as the comment above the heading handler always said.

test('plan-meta: a list item naming the same branch as its heading gains the PR and its markers', () => {
  const meta = parseSource(plan('### A (Branch: bug/x)\n\n- `bug/x` — foo → #12\n'));
  assert.deepEqual(meta.branches, ['bug/x']);
  assert.deepEqual(meta.prs, [12]);
  assert.deepEqual(meta.unread_heading_items, []);
});

test('plan-meta: a list item naming another branch stays unread and is reported, never a second claim', () => {
  const meta = parseSource(plan('### A (Branch: bug/x)\n\n- `bug/other` — foo → #12\n'));
  assert.deepEqual(meta.branches, ['bug/x']);
  assert.deepEqual(meta.prs, [], 'the other branch’s PR is not attributed to bug/x');
  assert.deepEqual(meta.unread_heading_items, [{ wave: 'A', branch: 'bug/other' }]);
});

test('plan-meta: a prose line with a backticked branch name stays unread and unreported', () => {
  const meta = parseSource(plan('### A (Branch: bug/x)\n\nSee also `bug/other` for context.\n'));
  assert.deepEqual(meta.branches, ['bug/x']);
  assert.deepEqual(meta.prs, []);
  assert.deepEqual(meta.unread_heading_items, [], 'a citation in prose is not a claim — branch_claim_re is not loosened');
});

test('plan-meta: a matching list item with <!-- deferred: ... --> puts its PR in deferred_prs', () => {
  const meta = parseSource(plan('### A (Branch: bug/x)\n\n- `bug/x` — foo → #12 <!-- deferred: superseded -->\n'));
  assert.deepEqual(meta.deferred_prs, [12]);
  assert.equal(meta.waves[0].branches[0].deferred, true);
  assert.equal(meta.waves[0].branches[0].deferred_reason, 'superseded');
});

test('plan-meta: a heading-only plan with no list items is byte-identical before and after this repair', () => {
  const meta = parseSource(plan('### A (Branch: bug/x, PR: #99)\n\nWork, no list item below.\n'));
  assert.deepEqual(meta.branches, ['bug/x']);
  assert.deepEqual(meta.prs, [99]);
  assert.deepEqual(meta.unread_heading_items, []);
});

test('plan-meta: a heading’s own deferred: annotation survives a matching list item that carries none', () => {
  // The bug this repair must not reintroduce: keep_branch() is called a second
  // time for the matching list item, and it unconditionally overwrites
  // deferred_of/deferred_why/waits_of/etc. A list item with no annotation of
  // its own must not wipe what the heading already established.
  const meta = parseSource(plan(
    '### A (Branch: bug/x) <!-- deferred: a long reason from panel review -->\n\n- `bug/x` — foo → #12\n'
  ));
  assert.equal(meta.waves[0].branches[0].deferred, true);
  assert.equal(meta.waves[0].branches[0].deferred_reason, 'a long reason from panel review');
  assert.deepEqual(meta.prs, [12]);
});

test('plan-meta: a heading’s own waits: annotation survives a matching list item that carries none', () => {
  const meta = parseSource(plan(
    '### A (Branch: bug/x) <!-- waits: bug/other-branch -->\n\n- `bug/x` — foo → #12\n'
  ));
  assert.deepEqual(meta.waves[0].branches[0].waits_on, ['bug/other-branch']);
  assert.deepEqual(meta.prs, [12]);
});

test('plan-meta: a matching list item’s own annotation overrides the heading’s, when both set it', () => {
  const meta = parseSource(plan(
    '### A (Branch: bug/x) <!-- deferred: heading reason -->\n\n- `bug/x` — foo → #12 <!-- deferred: list item reason -->\n'
  ));
  assert.equal(meta.waves[0].branches[0].deferred, true);
  assert.equal(meta.waves[0].branches[0].deferred_reason, 'list item reason');
});

test('plan-meta: a list item’s PR is deferred when only the heading carries the deferral', () => {
  const meta = parseSource(plan(
    '### A (Branch: bug/x) <!-- deferred: heading reason -->\n\n- `bug/x` — foo → #12\n'
  ));
  assert.deepEqual(meta.prs, [12]);
  assert.deepEqual(meta.deferred_prs, [12], 'a deferred branch’s PR never counts as shipped');
});

test('plan-meta: a heading’s PR is deferred when only the list item carries the deferral', () => {
  const meta = parseSource(plan(
    '### A (Branch: bug/x, PR: #13)\n\n- `bug/x` — foo <!-- deferred: list item reason -->\n'
  ));
  assert.deepEqual(meta.prs, [13]);
  assert.deepEqual(meta.deferred_prs, [13]);
  assert.equal(meta.waves[0].branches[0].deferred, true);
});

test('plan-meta: a non-deferred branch’s PRs on both lines stay out of deferred_prs', () => {
  const meta = parseSource(plan('### A (Branch: bug/x, PR: #13)\n\n- `bug/x` — foo → #12\n'));
  assert.deepEqual(meta.deferred_prs, []);
});

test('plan-meta: waits: on the heading and the list item merge, and an unreadable value on either is reported', () => {
  const meta = parseSource(plan(
    '### A (Branch: bug/x) <!-- waits: bug/a, nonsense-one -->\n\n- `bug/x` — foo <!-- waits: bug/b, bug/a, nonsense-two -->\n'
  ));
  assert.deepEqual(meta.waves[0].branches[0].waits_on, ['bug/a', 'bug/b']);
  assert.deepEqual(meta.unread_waits, [
    { branch: 'bug/x', value: 'nonsense-one' },
    { branch: 'bug/x', value: 'nonsense-two' },
  ]);
});

test('plan-meta: a list item’s commit refs merge with the heading’s', () => {
  const meta = parseSource(plan(
    '### A (Branch: bug/x) → commit abc1234\n\n- `bug/x` — foo → commit def5678\n'
  ));
  assert.deepEqual(meta.waves[0].branches[0].commits, ['abc1234', 'def5678']);
});

test('plan-meta: a list item’s commit refs are read when the heading names none', () => {
  const meta = parseSource(plan('### A (Branch: bug/x)\n\n- `bug/x` — foo → commit def5678\n'));
  assert.deepEqual(meta.waves[0].branches[0].commits, ['def5678']);
});
