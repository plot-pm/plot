// Contract test for skills/plot/scripts/plot-plan-meta.sh — the shared plan
// parser. This IS the plan-format specification, by example: each fixture in
// fixtures/plans/ is one supported shape, and the expectation table below
// states exactly what the parser must extract from it. Changing the plan
// format means changing a fixture + expectation here, in the same commit as
// the parser change.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';

const here = path.dirname(fileURLToPath(import.meta.url));
const parser = path.join(here, '..', '..', 'skills', 'plot', 'scripts', 'plot-plan-meta.sh');
const fixture = (name) => path.join(here, 'fixtures', 'plans', name);

function parse(name, args = []) {
  const out = execFileSync('bash', [parser, fixture(name), ...args], { encoding: 'utf8' });
  return JSON.parse(out);
}

// One entry per supported plan shape. `expected` is a subset-match.
const SPEC = [
  ['canonical-draft.md', {
    format: 'canonical', phase_raw: 'Draft', phase: 'draft',
    phase_alt_raw: '', phase_alt: 'NONE', type: 'feature', branches: [], prs: [],
  }],
  ['canonical-approved-branches.md', {
    format: 'canonical', phase: 'approved', type: 'bug',
    branches: ['bug/fix-crash', 'docs/fix-crash-notes'], prs: [12, 13],
  }],
  ['canonical-delivered-decorated.md', {
    // Decorated real-world value: first known token wins.
    format: 'canonical', phase: 'delivered', type: 'infra',
  }],
  ['canonical-plain-fields.md', {
    // No bullet, no bold; Rejected (written by /plot-reject) is a known phase.
    format: 'canonical', phase: 'rejected', type: 'docs',
  }],
  ['frontmatter-approved.md', {
    format: 'frontmatter', phase_raw: 'Approved', phase: 'approved',
    type: 'feature', branches: ['feature/api-layer'], prs: [7],
  }],
  ['frontmatter-disagreement.md', {
    // status: is primary, phase: is the alternate; disagreement is the
    // caller's finding, the parser just reports both.
    format: 'frontmatter', phase_raw: 'Delivered', phase: 'delivered',
    phase_alt_raw: 'Triage', phase_alt: 'UNKNOWN', type: 'bug',
  }],
  ['legacy-no-phase.md', {
    format: 'none', phase_raw: '', phase: 'NONE',
  }],
  // Board-facing fields (title/sprint/story/assignee) — @plot-pm/board's contract.
  ['canonical-story-fields.md', {
    format: 'canonical', phase: 'approved', type: 'feature',
    title: 'Canonical plan with sprint, story, and assignee',
    sprint: 'alpha-week', story: 'kanban-board', assignee: 'octocat',
  }],
  ['frontmatter-title-story.md', {
    // Front matter title: wins over the H1; sprint/story/assignee from front matter.
    format: 'frontmatter', phase: 'draft', type: 'docs',
    title: 'Front matter title wins over the H1',
    sprint: 'beta-week', story: 'docs-overhaul', assignee: 'hubot',
  }],
  ['canonical-placeholder-fields.md', {
    // Unfilled "<!-- ... -->" placeholders count as absent, not literal strings.
    format: 'canonical', phase: 'draft', sprint: '', story: '',
  }],
  ['canonical-draft.md', {
    // H1 is the title fallback when there is no front matter title.
    title: 'Canonical draft plan', sprint: '', story: '', assignee: '',
  }],
  // Ceremony fields (plot 2): Review/Impl answers + transition records.
  ['canonical-ceremony.md', {
    format: 'canonical', phase: 'approved', type: 'feature',
    review_raw: 'in-session (walkthrough 2026-07-30)', review: 'in-session',
    impl_raw: 'here, same branch', impl: 'same-branch',
    approved_raw: '2026-07-30, alice, in-session',
    started_raw: [
      '2026-07-31, alice, `feature/ceremony`',
      '2026-07-31, bob, `docs/ceremony-notes`',
    ],
    branches: ['feature/ceremony'], prs: [21],
  }],
  ['frontmatter-ceremony.md', {
    // Front matter answers; empty-quoted records count as absent.
    format: 'frontmatter', phase: 'draft', type: 'infra',
    review_raw: 'pr', review: 'pr', impl_raw: 'other-repo', impl: 'other-repo',
    approved_raw: '', started_raw: [],
  }],
  ['legacy-no-phase.md', {
    // Pre-ceremony plans: all four fields absent, normalized to NONE/empty.
    review: 'NONE', impl: 'NONE', approved_raw: '', started_raw: [],
  }],
  ['canonical-comment-block.md', {
    // Placeholder values and multi-line comment interiors are non-content —
    // an unfilled template parses as all-absent.
    format: 'canonical', phase: 'draft', type: 'docs',
    review: 'NONE', impl: 'NONE', approved_raw: '', started_raw: [],
  }],
];

for (const [name, expected] of SPEC) {
  test(`plan-meta: ${name}`, () => {
    const actual = parse(name);
    for (const [key, want] of Object.entries(expected)) {
      assert.deepEqual(actual[key], want, `${name} field '${key}'`);
    }
  });
}

test('plan-meta: only the first ## Branches heading contributes branches', () => {
  // A plan documenting the plan format quotes a `## Branches` section in prose.
  // Later same-named headings are illustration, not contract.
  const actual = parse('canonical-branches-in-prose.md');
  assert.deepEqual(actual.branches, ['feature/real-one', 'feature/real-two']);
});

test('plan-meta: waves group branches by ### subheading, deferred flagged', () => {
  const actual = parse('canonical-waves.md');
  assert.deepEqual(actual.waves, [
    { name: 'Tracer', branches: [{ branch: 'feature/thin-slice', deferred: false, claimed: '' }] },
    {
      name: 'Implementation',
      branches: [
        { branch: 'feature/api', deferred: false, claimed: '' },
        { branch: 'feature/ui', deferred: false, claimed: '2026-08-14T10:22Z, session-3' },
        { branch: 'feature/dropped', deferred: true, claimed: '' },
      ],
    },
    {
      name: 'Wave 3',
      branches: [
        { branch: 'feature/migration', deferred: false, claimed: '' },
        // Annotations bind to the line carrying the backticked branch name.
        // A `deferred:` comment on a wrapped continuation line does NOT apply —
        // it would silently read as "still outstanding", and /plot-deliver's
        // branch gate would block delivery on a branch nobody intends to build.
        { branch: 'feature/wrapped', deferred: false, claimed: '' },
      ],
    },
  ]);
  // Flat branches[] stays the whole set, in sorted order — existing consumers unaffected.
  assert.deepEqual(actual.branches, [
    'feature/api', 'feature/dropped', 'feature/migration', 'feature/thin-slice',
    'feature/ui', 'feature/wrapped',
  ]);
});

test('plan-meta: a plan without ### subheadings is a single unnamed wave', () => {
  // Backwards compatibility: every pre-wave plan behaves as one wave, all
  // branches eligible at once — exactly today's semantics.
  const actual = parse('canonical-approved-branches.md');
  assert.deepEqual(actual.waves, [{
    name: '',
    branches: [
      { branch: 'bug/fix-crash', deferred: false, claimed: '' },
      { branch: 'docs/fix-crash-notes', deferred: false, claimed: '' },
    ],
  }]);
});

test('plan-meta: claim parsing terminates (no RSTART/RLENGTH clobber)', () => {
  // Regression: computing the claim note with match() inside the branch loop
  // clobbered RSTART/RLENGTH, which that loop needs to advance — the parser
  // hung forever. Guard with a timeout so a hang fails instead of blocking CI.
  const out = execFileSync('bash', [parser, fixture('canonical-waves.md')],
    { encoding: 'utf8', timeout: 10_000 });
  const actual = JSON.parse(out);
  assert.equal(actual.waves.length, 3);
});

test('plan-meta: first-## Branches-wins state resets between files', () => {
  // Regression: the "already saw a Branches heading" flag is per-file. Without
  // a reset it leaks across multi-file mode and silently empties later plans.
  const out = execFileSync('bash',
    [parser, fixture('canonical-branches-in-prose.md'), fixture('canonical-approved-branches.md')],
    { encoding: 'utf8' });
  const lines = out.trim().split('\n').map((l) => JSON.parse(l));
  assert.deepEqual(lines[0].branches, ['feature/real-one', 'feature/real-two']);
  assert.deepEqual(lines[1].branches, ['bug/fix-crash', 'docs/fix-crash-notes']);
});

test('plan-meta: --prefixes restricts branch extraction', () => {
  const actual = parse('canonical-approved-branches.md', ['--prefixes', 'docs']);
  assert.deepEqual(actual.branches, ['docs/fix-crash-notes']);
});

test('plan-meta: missing file reports error JSON, exit 0', () => {
  const out = execFileSync('bash', [parser, fixture('does-not-exist.md')], { encoding: 'utf8' });
  const actual = JSON.parse(out);
  assert.equal(actual.error, 'file not found');
  assert.equal(actual.phase, 'NONE');
});

test('plan-meta: multi-file mode emits one JSON line per file, in input order', () => {
  const out = execFileSync('bash',
    [parser, fixture('canonical-draft.md'), fixture('frontmatter-approved.md'), fixture('legacy-no-phase.md')],
    { encoding: 'utf8' });
  const lines = out.trim().split('\n').map((l) => JSON.parse(l));
  assert.equal(lines.length, 3);
  assert.equal(lines[0].phase, 'draft');
  assert.equal(lines[1].format, 'frontmatter');
  assert.deepEqual(lines[1].branches, ['feature/api-layer']);
  assert.equal(lines[2].format, 'none');
});

test('parser: released_raw carries the release transition record', () => {
  // The release record is what makes "which version shipped this plan?"
  // readable rather than re-derivable. Without the field the version would be
  // written into the file and invisible to every consumer.
  const dir = mkdtempSync(path.join(tmpdir(), 'plot-parser-rel-'));
  const f = path.join(dir, '2026-01-01-shipped.md');
  writeFileSync(f, `# Shipped plan

## Status

- **Phase:** Released
- **Type:** feature
- **Approved:** 2026-01-01, alice, plan-PR #1 merged
- **Delivered:** 2026-01-02
- **Released:** 2026-01-03, v1.2.0
`);
  const meta = JSON.parse(execFileSync('bash', [parser, f], { encoding: 'utf8' }).trim());
  assert.equal(meta.phase, 'released');
  assert.equal(meta.released_raw, '2026-01-03, v1.2.0');
  assert.equal(meta.approved_raw, '2026-01-01, alice, plan-PR #1 merged',
    'the new field must not disturb the neighbouring records');
  rmSync(dir, { recursive: true, force: true });
});

test('parser: released_raw is empty when no record exists', () => {
  // Every plan written before this field existed must still parse. Empty is
  // the answer, not a missing key.
  const dir = mkdtempSync(path.join(tmpdir(), 'plot-parser-norel-'));
  const f = path.join(dir, '2026-01-01-plain.md');
  writeFileSync(f, `# Plain plan

## Status

- **Phase:** Delivered
- **Type:** feature
`);
  const meta = JSON.parse(execFileSync('bash', [parser, f], { encoding: 'utf8' }).trim());
  assert.equal(meta.released_raw, '');
  rmSync(dir, { recursive: true, force: true });
});

// --- rounds: the interrogation count -----------------------------------------
//
// Asserted against REAL plan files in docs/plans, not against fixtures, and
// that is the whole point of these three tests. `/plot:challenge-the-plan`
// writes its state as a multi-line HTML comment, and the parser's standing rule
// is that multi-line comment interiors are non-content (see
// canonical-comment-block.md, which must keep passing). So a hand-written
// fixture that "looks like" the block proves nothing about the format the skill
// actually emits: measured on 2026-08-17, the parser returned 22 keys for
// docs/plans/2026-08-17-acting-buttons-show-they-act.md and `round` was not
// among them, while a fixture-shaped test would have passed.

const repoRoot = path.join(here, '..', '..');
const realPlan = (name) => path.join(repoRoot, 'docs', 'plans', name);
const parseFile = (abs) =>
  JSON.parse(execFileSync('bash', [parser, abs], { encoding: 'utf8' }).trim());

test('plan-meta: rounds is read from a REAL challenge-the-plan block', () => {
  // This file carries `"round": 2` inside the metadata comment. If the skill
  // ever changes the block's shape, this test fails here rather than the board
  // quietly losing the badge.
  const meta = parseFile(realPlan('2026-08-17-acting-buttons-show-they-act.md'));
  assert.equal(meta.rounds, 2);
  // The block must not cost the file any of its other fields — this is the
  // plan-format contract, and every other command reads it. Asserted as
  // "still answered" rather than as a literal phase: this plan is a live file
  // that will move to delivered and released, and a test pinned to today's
  // phase would fail on a change that has nothing to do with the parser.
  assert.equal(meta.type, 'bug');
  assert.ok(meta.title.length > 0, 'title survives the metadata block');
  assert.notEqual(meta.phase, 'NONE', 'phase survives the metadata block');
  assert.ok(meta.branches.length > 0, 'branches survive the metadata block');
});

test('plan-meta: a real plan with NO block omits rounds entirely', () => {
  // ABSENT, not 0. `0 rounds` reads as "interrogated and found nothing"; the
  // truth here is "never interrogated", and the two want opposite reactions.
  // The key is missing so no consumer can read a zero out of it by accident.
  const meta = parseFile(realPlan('2026-02-11-plot-sprint-support.md'));
  assert.equal('rounds' in meta, false, 'the key must be absent, not 0');
  assert.equal(meta.rounds, undefined);
  // …and the plan still parses in full.
  assert.notEqual(meta.phase, 'NONE');
});

test('plan-meta: a malformed block loses only the round', () => {
  // plot-plan-meta.sh is the plan-format contract: a truncated or non-JSON
  // metadata comment must never cost a plan its phase, type or branches.
  const dir = mkdtempSync(path.join(tmpdir(), 'plot-parser-rounds-'));
  const f = path.join(dir, '2026-01-01-malformed.md');
  writeFileSync(f, `# Malformed metadata

## Status

- **Phase:** Draft
- **Type:** feature

<!-- CHALLENGE-THE-PLAN-METADATA
{ this is not valid JSON at all,,, and carries no round
END-CHALLENGE-THE-PLAN-METADATA -->

## Branches

- \`feature/still-parsed\`
`);
  const meta = parseFile(f);
  assert.equal('rounds' in meta, false, 'an unreadable round is absent, never guessed');
  assert.equal(meta.phase, 'draft');
  assert.equal(meta.type, 'feature');
  assert.deepEqual(meta.branches, ['feature/still-parsed']);
  rmSync(dir, { recursive: true, force: true });
});

test('plan-meta: template guidance comments still contribute no round', () => {
  // The carve-out is keyed on the CHALLENGE-THE-PLAN-METADATA sentinel, not on
  // "a comment containing a number" — the general non-content rule for
  // multi-line comments is unchanged.
  const actual = parse('canonical-comment-block.md');
  assert.equal('rounds' in actual, false);
});

// `Issue:` — the plan's link to the tracker signal it answers. The board reads
// this to decide which open issues are still unplanned, so "does a plan
// reference #N" has to be answerable without reading prose.
test('parser: issues reads the Issue field, and a list of them', () => {
  // A LIST because one plan can answer several signals — the plan that
  // introduced this field subsumes three (#226, #227, #228).
  const dir = mkdtempSync(path.join(tmpdir(), 'plot-parser-issue-'));
  const f = path.join(dir, '2026-01-01-signals.md');
  writeFileSync(f, `# A plan answering signals

## Status

- **Phase:** Approved
- **Type:** feature
- **Issue:** #228, #226

## Motivation

Cites #999 and PR #232 as history — neither is a signal this plan answers.

## Branches

- \`feature/foo\` — does a thing. → #232
`);
  const meta = JSON.parse(execFileSync('bash', [parser, f], { encoding: 'utf8' }).trim());
  assert.deepEqual(meta.issues, [226, 228], 'sorted and numeric, like prs');
  // THE POINT OF A DEDICATED FIELD. A body scan would read #999 as a signal and
  // #232 as one too; `prs` keeps #232 because `→ #NNN` says PR, and `issues`
  // keeps only what `Issue:` named.
  assert.deepEqual(meta.prs, [232], 'the PR link is still a PR, not an issue');
});

test('parser: issues is empty when the plan names none', () => {
  // Every plan written before this field existed must still parse, and a bare
  // `#226` in prose is a citation rather than a reference.
  const dir = mkdtempSync(path.join(tmpdir(), 'plot-parser-noissue-'));
  const f = path.join(dir, '2026-01-01-plain.md');
  writeFileSync(f, `# A plan with no issue

## Status

- **Phase:** Draft
- **Type:** bug

## Motivation

Mentions #226 in passing.
`);
  const meta = JSON.parse(execFileSync('bash', [parser, f], { encoding: 'utf8' }).trim());
  assert.deepEqual(meta.issues, [], 'absent is [], and prose is not a reference');
});

test('parser: issues reads front matter, and a placeholder is absent', () => {
  // Front matter wins over the canonical body, the rule every other field
  // follows; a template-fresh `<!-- ... -->` counts as absent rather than as a
  // reference to nothing.
  const dir = mkdtempSync(path.join(tmpdir(), 'plot-parser-fmissue-'));
  const fm = path.join(dir, '2026-01-01-fm.md');
  writeFileSync(fm, `---
status: Approved
issue: "#77"
---
# Front matter plan
`);
  const ph = path.join(dir, '2026-01-02-placeholder.md');
  writeFileSync(ph, `# Template-fresh plan

## Status

- **Phase:** Draft
- **Issue:** <!-- #NNN if this answers a tracker issue -->
`);
  const out = execFileSync('bash', [parser, fm, ph], { encoding: 'utf8' })
    .trim().split('\n').map((l) => JSON.parse(l));
  assert.deepEqual(out[0].issues, [77]);
  assert.deepEqual(out[1].issues, [], 'a placeholder names no issue');
});
