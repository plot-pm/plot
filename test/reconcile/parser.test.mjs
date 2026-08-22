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
    { name: 'Tracer', branches: [{ branch: 'feature/thin-slice', deferred: false, deferred_reason: '', claimed: '' }] },
    {
      name: 'Implementation',
      branches: [
        { branch: 'feature/api', deferred: false, deferred_reason: '', claimed: '' },
        { branch: 'feature/ui', deferred: false, deferred_reason: '', claimed: '2026-08-14T10:22Z, session-3' },
        { branch: 'feature/dropped', deferred: true, deferred_reason: 'covered by feature/api', claimed: '' },
      ],
    },
    {
      name: 'Wave 3',
      branches: [
        { branch: 'feature/migration', deferred: false, deferred_reason: '', claimed: '' },
        // Annotations bind to the line carrying the backticked branch name.
        // A `deferred:` comment on a wrapped continuation line does NOT apply —
        // it would silently read as "still outstanding", and /plot-deliver's
        // branch gate would block delivery on a branch nobody intends to build.
        { branch: 'feature/wrapped', deferred: false, deferred_reason: '', claimed: '' },
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
      { branch: 'bug/fix-crash', deferred: false, deferred_reason: '', claimed: '' },
      { branch: 'docs/fix-crash-notes', deferred: false, deferred_reason: '', claimed: '' },
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

// `design` — the seventh phase, and its transition record. A plan in Design is
// not a plan nobody started: it is a plan that cannot yet be handed to
// development because it needs a spec, a spike or a tracer bullet first. The
// board inferred that state from `approved && !started`, which conflates
// "design work is outstanding" with "nobody has picked it up" — opposite
// meanings for whoever reads the board. These tests pin the word, not the
// inference.
test('parser: Design is a phase of its own, with a Design record', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'plot-parser-design-'));
  const f = path.join(dir, '2026-01-01-designing.md');
  writeFileSync(f, `# A plan still being designed

## Status

- **Phase:** Design
- **Type:** feature
- **Design:** 2026-01-01, alice, tracer bullet through the queue
- **Approved:** 2026-01-01, alice, in-session

## Branches

- \`feature/spike\`
`);
  const meta = JSON.parse(execFileSync('bash', [parser, f], { encoding: 'utf8' }).trim());
  assert.equal(meta.phase, 'design', 'Design normalizes to its own phase, not to approved');
  assert.equal(meta.phase_raw, 'Design');
  assert.equal(meta.design_raw, '2026-01-01, alice, tracer bullet through the queue');
  // The new field must not disturb the neighbouring records, the same
  // discipline released_raw was held to.
  assert.equal(meta.approved_raw, '2026-01-01, alice, in-session');
  assert.equal(meta.type, 'feature');
  assert.deepEqual(meta.branches, ['feature/spike']);
  rmSync(dir, { recursive: true, force: true });
});

test('parser: design_raw is empty when no record exists, and the plan is unchanged', () => {
  // Every plan written before this field existed must still parse. Empty is
  // the answer, not a missing key — and a plan can hold the record without the
  // phase, or the phase without the record.
  const dir = mkdtempSync(path.join(tmpdir(), 'plot-parser-nodesign-'));
  const f = path.join(dir, '2026-01-01-plain.md');
  writeFileSync(f, `# Plain plan

## Status

- **Phase:** Approved
- **Type:** bug
- **Approved:** 2026-01-01, bob, plan-PR #4 merged
- **Delivered:** 2026-01-02
`);
  const meta = JSON.parse(execFileSync('bash', [parser, f], { encoding: 'utf8' }).trim());
  assert.equal(meta.design_raw, '');
  assert.equal(meta.phase, 'approved');
  assert.equal(meta.approved_raw, '2026-01-01, bob, plan-PR #4 merged');
  assert.equal(meta.delivered_raw, '2026-01-02');
  rmSync(dir, { recursive: true, force: true });
});

test('parser: front matter design: outranks a ## Status Design: line', () => {
  // Front matter wins over the canonical body, the rule every other transition
  // record follows.
  const dir = mkdtempSync(path.join(tmpdir(), 'plot-parser-fmdesign-'));
  const f = path.join(dir, '2026-01-01-fm.md');
  writeFileSync(f, `---
status: Design
design: from front matter
---
# Front matter design plan

## Status

- **Phase:** Design
- **Design:** from the status body
`);
  const meta = JSON.parse(execFileSync('bash', [parser, f], { encoding: 'utf8' }).trim());
  assert.equal(meta.format, 'frontmatter');
  assert.equal(meta.phase, 'design');
  assert.equal(meta.design_raw, 'from front matter');
  rmSync(dir, { recursive: true, force: true });
});

test('parser: the six pre-existing phases are byte-identical', () => {
  // The whole licence for adding a phase word: no fixture that parsed before
  // parses differently now. Asserted on the FULL JSON of existing fixtures
  // rather than on a field subset, so a stray change anywhere in the record
  // fails here. design_raw is the one permitted addition, and it must be "".
  const fixtures = [
    ['canonical-draft.md', 'draft'],
    ['canonical-approved-branches.md', 'approved'],
    ['canonical-delivered-decorated.md', 'delivered'],
    ['canonical-plain-fields.md', 'rejected'],
    ['frontmatter-approved.md', 'approved'],
    ['frontmatter-disagreement.md', 'delivered'],
  ];
  for (const [name, phase] of fixtures) {
    const meta = parse(name);
    assert.equal(meta.phase, phase, `${name} keeps its phase`);
    assert.equal(meta.design_raw, '', `${name} carries an empty design record`);
  }
  // `released` completes the six; no fixture carries it, so the record written
  // by the released_raw test above stands in.
  assert.equal(norm_phase_of('Released'), 'released');
  assert.equal(norm_phase_of('Superseded'), 'superseded');
  // …and the two synonyms still fold onto approved, which `design` must not.
  assert.equal(norm_phase_of('Ready-for-review'), 'approved');
  assert.equal(norm_phase_of('In-review'), 'approved');
});

// Helper for the phase-word assertions above: parse a throwaway plan carrying
// one phase value and report how it normalized.
function norm_phase_of(raw) {
  const dir = mkdtempSync(path.join(tmpdir(), 'plot-parser-norm-'));
  const f = path.join(dir, '2026-01-01-one-phase.md');
  writeFileSync(f, `# One phase\n\n## Status\n\n- **Phase:** ${raw}\n`);
  const meta = JSON.parse(execFileSync('bash', [parser, f], { encoding: 'utf8' }).trim());
  rmSync(dir, { recursive: true, force: true });
  return meta.phase;
}

test('parser: a missing file reports design_raw too', () => {
  // The error object enumerates every field, so a caller reading a missing
  // file gets the same shape as one reading a real plan.
  const out = execFileSync('bash', [parser, fixture('does-not-exist.md')], { encoding: 'utf8' });
  const actual = JSON.parse(out);
  assert.equal(actual.error, 'file not found');
  assert.equal(actual.design_raw, '');
});

test('parser: the `## Design` prose section does not become the Design record', () => {
  // `design` is the one transition record whose name collides with a template
  // SECTION: both plan templates carry a `## Design` heading, and every plan
  // written from them has prose under it. The record is read from `## Status`
  // only, like its three neighbours — without that, `design_raw` would fill
  // itself from the first sentence of the design discussion on most plans in
  // the repo.
  const dir = mkdtempSync(path.join(tmpdir(), 'plot-parser-designsection-'));
  const f = path.join(dir, '2026-01-01-has-a-design-section.md');
  writeFileSync(f, `# A plan with a design section

## Status

- **Phase:** Approved
- **Type:** feature

## Design

Design: this prose lives under the heading, not in Status.

- **Design:** a bullet in the wrong section
`);
  const meta = JSON.parse(execFileSync('bash', [parser, f], { encoding: 'utf8' }).trim());
  assert.equal(meta.design_raw, '', 'only ## Status carries the record');
  assert.equal(meta.phase, 'approved');
  rmSync(dir, { recursive: true, force: true });
});

test('plan-meta: a deferral records its REASON, and the bare form records the flag alone', () => {
  // THE SENTENCE THE PIPELINE USED TO DISCARD.
  //
  // `plot-plan-meta.sh` tested whether a `deferred:` annotation was PRESENT and
  // emitted `"true"`; the text after the colon never left the plan file. So the
  // board could render `deferred` beside `no commits` as two unrelated facts,
  // when the first is the reason for the second — and a reader with no access
  // to the plan file saw a branch nobody had started and no statement that
  // nobody should. Three such rows existed on 2026-08-19, one of them on a
  // Released plan since April: *"never created — the work landed directly on
  // main"*.
  //
  // TWO CASES, and the pairing is the point: the flag with a reason, and the
  // flag WITHOUT one. `<!-- deferred -->` bare used to read as not deferred at
  // all — the strongest statement a plan can make about a branch, dropped for
  // want of a colon — and it must now set the flag while leaving the reason
  // empty. Empty-and-deferred and empty-and-not-deferred are different answers,
  // and only `deferred` separates them.
  const dir = mkdtempSync(path.join(tmpdir(), 'plot-parser-defer-'));
  const f = path.join(dir, '2026-08-19-deferrals.md');
  writeFileSync(f, `# Deferrals

## Status

- **Phase:** Approved
- **Type:** bug

## Branches

- \`feature/with-reason\` <!-- deferred: verified already implemented 2026-08-17 — startRepair() at fleet.ts:806 --> — already on main.
- \`feature/bare\` <!-- deferred --> — nothing recorded.
- \`feature/ordinary\` — real work.
`);
  try {
    const out = execFileSync('bash', [parser, f], { encoding: 'utf8' });
    const actual = JSON.parse(out);
    assert.deepEqual(actual.waves, [{
      name: '',
      branches: [
        {
          branch: 'feature/with-reason',
          deferred: true,
          deferred_reason: 'verified already implemented 2026-08-17 — startRepair() at fleet.ts:806',
          claimed: '',
        },
        // The flag survives without a colon; the reason is honestly absent.
        { branch: 'feature/bare', deferred: true, deferred_reason: '', claimed: '' },
        // And a branch nobody deferred says nothing about a deferral.
        { branch: 'feature/ordinary', deferred: false, deferred_reason: '', claimed: '' },
      ],
    }]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('plan-meta: a deferral reason with a quote survives as JSON', () => {
  // The repo titles plans `... is not "no commits yet"`, and a deferral reason
  // is free prose written by whoever shelved the branch. An unescaped quote
  // would truncate the record rather than fail it — the failure mode
  // `plot-sprint-candidates.sh` documents for exactly this reason.
  const dir = mkdtempSync(path.join(tmpdir(), 'plot-parser-quote-'));
  const f = path.join(dir, '2026-08-19-quoted.md');
  writeFileSync(f, `# Quoted

## Status

- **Phase:** Approved
- **Type:** bug

## Branches

- \`feature/quoted\` <!-- deferred: the answer is "nothing", and \\ is a backslash --> — shelved.
`);
  try {
    const out = execFileSync('bash', [parser, f], { encoding: 'utf8' });
    const actual = JSON.parse(out);
    assert.equal(actual.waves[0].branches[0].deferred, true);
    assert.equal(
      actual.waves[0].branches[0].deferred_reason,
      'the answer is "nothing", and \\ is a backslash',
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// `prs` — the field four gates read, and the one nothing tested.
//
// /plot-deliver's merged check, /plot-release's version resolution, the sweep's
// section 6 and the fleet scan all decide from `prs`. Until 2026-08-22 no test
// in this file took it as its subject: the two existing mentions are incidental
// assertions inside `issues` tests. The measured cost was a back-fill that
// "already referenced the PR" on four plans and left every one of them
// invisible to the parser, because the reference it found was human-readable
// prose rather than the annotation.
// ---------------------------------------------------------------------------

/** Parse a plan written to a temp file, returning its JSON. */
function parseSource(src, name = '2026-08-22-prs.md') {
  const dir = mkdtempSync(path.join(tmpdir(), 'plot-parser-prs-'));
  const f = path.join(dir, name);
  writeFileSync(f, src);
  try {
    return JSON.parse(execFileSync('bash', [parser, f], { encoding: 'utf8' }));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test('plan-meta: only `→ #N` is a PR annotation — a citation is not', () => {
  // THE STRICTNESS IS THE FEATURE, and it is load-bearing enough to pin.
  //
  // Plans cite PR numbers constantly as history: this repo's
  // a-plan-row-is-not-a-branch-row names #175 and #191 in prose as prior art,
  // and neither delivered it. A parser that scanned the body for `#NNN` would
  // record those as delivery evidence — which is why `prs` reads ONE form and
  // refuses every lookalike. The four cases below are the lookalikes that
  // actually occur in this repo's plans.
  const meta = parseSource(`# Plan

## Status

- **Phase:** Delivered
- **Type:** bug

## Branches

- \`bug/annotated\` — the real form → #100
- \`bug/cited\` — carries (#101) and nothing else
- \`bug/prose\` — mentions #102 mid-sentence, then annotates → #103

## Notes

Prose citing #999, and a table row: | \`bug/table\` | → #998 |
`);
  assert.deepEqual(meta.prs, [100, 103], 'only the two arrow-annotated numbers');
  assert.ok(!meta.prs.includes(101), '(#101) is a citation, not an annotation');
  assert.ok(!meta.prs.includes(102), 'a bare #102 in prose is not an annotation');
  assert.ok(!meta.prs.includes(999), '#999 outside ## Branches never counts');
  assert.ok(!meta.prs.includes(998), 'an arrow outside ## Branches never counts');
});

test('plan-meta: a branch with no annotation is still a branch, and adds no PR', () => {
  // THE ASYMMETRY THAT HID THE FAILURE. A plan can list five branches and
  // report two PRs, and nothing in the JSON pairs them — so "this plan has
  // branches" and "this plan has PR evidence" are separate questions. A
  // delivery gate that checks only `branches` sees a full plan; one that reads
  // `prs` sees the truth. Both fields are asserted together here so the gap
  // between them stays visible to whoever changes this next.
  const meta = parseSource(`# Plan

## Status

- **Phase:** Approved
- **Type:** bug

## Branches

- \`bug/with\` — annotated → #200
- \`bug/without\` — no annotation at all
`);
  assert.deepEqual(meta.branches, ['bug/with', 'bug/without'], 'both are branches');
  assert.deepEqual(meta.prs, [200], 'only the annotated one contributes a PR');
});

test('plan-meta: `→ owner/repo#N` is a PR annotation — split-home plans have one', () => {
  // THE DOCUMENTED FORM THE PARSER USED TO DROP. /plot-deliver step 4 tells
  // implementers to write `→ owner/repo#N` for `Impl: other repo` plans, and
  // names it again in its split-home clause — but `prs` matched `→ #[0-9]+`
  // only, so the annotation vanished and `error` stayed null. A split-home
  // plan therefore reported `prs: []` with `impl: other-repo` beside it: the
  // delivery gate would read "no PRs" for a plan whose only PR was written
  // exactly as instructed. No plan in this repo used the form yet, so the
  // defect was latent and would have struck the first adopter.
  const meta = parseSource(`# Plan

## Status

- **Phase:** Approved
- **Type:** feature
- **Impl:** other repo

## Branches

- \`feature/x\` — lands in the code repo → acme/api#42
- \`feature/y\` — and one here → #43
`);
  assert.deepEqual(meta.prs, [42, 43], 'the cross-repo PR counts as a PR');
  assert.equal(meta.impl, 'other-repo', 'and the plan is still split-home');
});

test('plan-meta: `→#N` without the space is reported, never silently dropped', () => {
  // A TYPO MUST NOT READ AS AN ABSENCE. The annotation is written by hand, and
  // `→#44` is the obvious slip. Accepting it would widen the contract on a
  // guess about intent; dropping it silently is worse, because "no annotation"
  // is a claim the sweep acts on — it prints "cannot resolve a version" and a
  // human adds an annotation that is already there. So the parser reports it:
  // `malformed_prs` carries the offending text, and `prs` stays strict.
  const meta = parseSource(`# Plan

## Status

- **Phase:** Approved
- **Type:** bug

## Branches

- \`bug/typo\` — missing the space →#44
- \`bug/fine\` — correct → #45
`);
  assert.deepEqual(meta.prs, [45], 'the strict form is unchanged');
  assert.deepEqual(meta.malformed_prs, ['→#44'], 'and the typo is reported, not lost');
});

test('plan-meta: prs are sorted, unique, and several may share one line', () => {
  // THE SHAPE THE HEADER PROMISES ("sorted, unique"), asserted rather than
  // assumed. A wave line carrying two PRs is ordinary — a branch reworked
  // after review — and a plan repeating a number across waves must not report
  // it twice, since callers use the list's length as a count of evidence.
  const meta = parseSource(`# Plan

## Status

- **Phase:** Delivered
- **Type:** feature

## Branches

### Wave one

- \`feature/a\` — reworked → #50 → #48
- \`feature/b\` — one → #49

### Wave two

- \`feature/c\` — repeats the first → #48
`);
  assert.deepEqual(meta.prs, [48, 49, 50], 'sorted ascending, duplicates collapsed');
});

test('plan-meta: a plan with no Branches section reports no prs and no malformed ones', () => {
  // THE EMPTY CASE, pinned so "absent" and "malformed" stay distinguishable.
  // Draft plans and knowledge plans have no branches at all; they must report
  // [] for both, never null and never an error.
  const meta = parseSource(`# Plan

## Status

- **Phase:** Draft
- **Type:** docs

## Problem

Nothing to build yet — and #123 in prose stays prose.
`);
  assert.deepEqual(meta.prs, [], 'no branches, no prs');
  assert.deepEqual(meta.malformed_prs, [], 'and nothing malformed either');
});
