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

test('plan-meta: a heading lost to the first-heading latch (#1042) is named', () => {
  // The minimal pair from the plan: identical content, reordered. With the
  // narrative heading first the section routes to the list consumer and the
  // branched heading yields nothing; the report names it. With the branched
  // heading first it is read and nothing is reported.
  const narrative = '### A narrative heading with no branch\n\nProse.\n';
  const real = '### Real work (Branch: bug/real-work)\n\nWork.\n';
  const latched = parseSource(plan(narrative + '\n' + real));
  assert.deepEqual(latched.branches, [], 'the latch still loses it — #1042 is not fixed here');
  assert.deepEqual(latched.unread_branch_headings, ['Real work (Branch: bug/real-work)']);
  const read = parseSource(plan(real + '\n' + narrative));
  assert.deepEqual(read.branches, ['bug/real-work']);
  assert.deepEqual(read.unread_branch_headings, []);
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
