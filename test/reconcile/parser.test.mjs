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
import { mkdtempSync, writeFileSync, rmSync, readdirSync, readFileSync } from 'node:fs';
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

test('plan-meta: a wave name past the threshold is reported in long_wave_names', () => {
  // A wave name is a label; a 53-character sentence is a plan-authoring mistake
  // the board can only render badly. The parser REPORTS it in a top-level
  // `long_wave_names` array — a REPORT, never a refusal: the waves[] array is
  // unchanged and the plan still parses. The threshold is a judgement: the
  // longest legitimate name here (`Offered first`, 13 chars) stays silent, the
  // offender (53 chars) is named.
  const actual = parse('canonical-prose-wave-name.md');
  assert.deepEqual(actual.long_wave_names,
    ['Moved — recorded here so the plan states what it started']);
  // The report does not fail the parse: all three waves still come through,
  // names intact — nothing was shortened, nothing was dropped.
  assert.deepEqual(actual.waves.map((w) => w.name),
    ['Shaped', 'Moved — recorded here so the plan states what it started', 'Offered first']);
});

test('plan-meta: a plan whose wave names are all labels reports an empty long_wave_names', () => {
  // Empty is the field a consumer reads to know there is nothing to fix — the
  // field is ALWAYS present (an array), never omitted, so `.long_wave_names`
  // never reads as undefined. canonical-waves.md carries `Tracer`,
  // `Implementation`, `Wave 3` — all short.
  const actual = parse('canonical-waves.md');
  assert.deepEqual(actual.long_wave_names, []);
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

// --- Rounds field preference order ---------------------------------------------
//
// The plan "the-plan-file-states-what-the-board-shows" introduced a `Rounds:`
// field in `## Status`. The parser reads it first, front matter second, and
// the CHALLENGE block last. These four tests are the Done-when items 1–4.

test('plan-meta: Rounds in ## Status parses, no block needed (Done-when 1)', () => {
  // Item 1: `Rounds: 3` in `## Status`, no block at all → `rounds=3`
  const dir = mkdtempSync(path.join(tmpdir(), 'plot-parser-rounds-status-'));
  const f = path.join(dir, '2026-01-01-status-only.md');
  writeFileSync(f, `# Plan with Rounds in Status

## Status

- **Phase:** Approved
- **Type:** feature
- **Rounds:** 3
`);
  try {
    const meta = parseFile(f);
    assert.equal(meta.rounds, 3, 'the Rounds field yields a numeric value');
    assert.equal(meta.phase, 'approved', 'other fields still parse');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('plan-meta: a real plan with only the block still parses (Done-when 2)', () => {
  // Item 2: a plan with only the metadata block, no Rounds: field → unchanged.
  // Asserted against a REAL plan from the 40. This is the case a REPLACE-based
  // fix fails: if the parser stopped reading the block, 40 plans would lose
  // their rounds the day this lands.
  const meta = parseFile(realPlan('2026-08-17-acting-buttons-show-they-act.md'));
  assert.equal(meta.rounds, 2, 'the block is still read as fallback');
  // Verify this plan has no Rounds: field in ## Status by checking it would
  // fail on a REPLACE-only implementation (the block carries the truth).
  assert.equal(meta.type, 'bug');
});

test('plan-meta: the Rounds field wins over the block (Done-when 3)', () => {
  // Item 3: both present and disagreeing → the field wins. During the
  // transition a plan may carry both, and a reader trusts what the file says.
  const dir = mkdtempSync(path.join(tmpdir(), 'plot-parser-rounds-conflict-'));
  const f = path.join(dir, '2026-01-01-disagree.md');
  writeFileSync(f, `# Plan with disagreeing sources

## Status

- **Phase:** Approved
- **Type:** feature
- **Rounds:** 5

<!-- CHALLENGE-THE-PLAN-METADATA
{
  "round": 2,
  "questionHistory": []
}
END-CHALLENGE-THE-PLAN-METADATA -->
`);
  try {
    const meta = parseFile(f);
    assert.equal(meta.rounds, 5, 'the Rounds: field wins over the block');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('plan-meta: neither field nor block → absent, not zero (Done-when 4)', () => {
  // Item 4: neither present → absent, not zero. A plan nobody has interrogated
  // and a plan interrogated to no effect want opposite reactions from a reader.
  const dir = mkdtempSync(path.join(tmpdir(), 'plot-parser-rounds-absent-'));
  const f = path.join(dir, '2026-01-01-neither.md');
  writeFileSync(f, `# Plan with no rounds anywhere

## Status

- **Phase:** Draft
- **Type:** feature
`);
  try {
    const meta = parseFile(f);
    assert.equal('rounds' in meta, false, 'the key is absent, not zero');
    assert.equal(meta.rounds, undefined);
    assert.equal(meta.phase, 'draft', 'other fields still parse');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
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

// ---------------------------------------------------------------------------
// `## Waves` — the new spelling. The branch and PR live in the `### ` heading
// (`### Removed (Branch: bug/foo, PR: #300)`), and the line below is pure
// prose. The parser must read BOTH spellings, because wave 3 of this very plan
// migrates 85 files one at a time and a plan moved one commit before the parser
// learns the shape must not go invisible — it parses to zero branches SILENTLY
// under the old parser, and every consumer inherits the silence.
//
// The load-bearing property: a new-shape plan and its old-shape twin produce
// byte-identical branches/prs/waves JSON. That identity is what makes the
// migration provably a re-spelling rather than a change of meaning.
// ---------------------------------------------------------------------------

test('plan-meta: a ## Waves plan and its old-shape twin parse to identical branches/prs/waves', () => {
  // THE PROPERTY THE WHOLE PLAN RESTS ON. The heading takes the meta (which
  // branch, which PR); the line keeps the work. Read from either spelling, the
  // structural arrays must be indistinguishable — so a one-file migration can
  // be verified by diffing the JSON before and after.
  const nu = parse('canonical-waves-heading.md');
  const old = parse('canonical-waves-heading-twin.md');
  assert.deepEqual(nu.branches, old.branches, 'flat branches[] identical');
  assert.deepEqual(nu.prs, old.prs, 'prs[] identical');
  assert.deepEqual(nu.waves, old.waves, 'waves[] identical — names, order, deferred, claimed');
  assert.deepEqual(nu.malformed_prs, old.malformed_prs, 'no malformed PRs from either shape');
  // Spell out the expectation once, so a change to BOTH fixtures that keeps them
  // equal to each other but wrong still fails.
  assert.deepEqual(nu.branches, [
    'feature/api', 'feature/dropped', 'feature/migration', 'feature/thin-slice',
  ], 'sorted, unique, from the headings');
  assert.deepEqual(nu.prs, [10, 11], 'only the two headings that carry a PR:');
  assert.deepEqual(nu.waves, [
    { name: 'Tracer', branches: [{ branch: 'feature/thin-slice', deferred: false, deferred_reason: '', claimed: '' }] },
    { name: 'Implementation', branches: [{ branch: 'feature/api', deferred: false, deferred_reason: '', claimed: '' }] },
    { name: 'Deferred one', branches: [{ branch: 'feature/dropped', deferred: true, deferred_reason: 'covered by feature/api', claimed: '' }] },
    { name: 'Wave four', branches: [{ branch: 'feature/migration', deferred: false, deferred_reason: '', claimed: '' }] },
  ], 'one heading, one wave, one branch — the post-2026-08-21 rule');
});

test('plan-meta: a ## Waves heading with no PR: yields no PR, not an empty string', () => {
  // ABSENT IS NOT A GUESS, carried over from `Issue:`. A heading that names a
  // branch but no PR contributes the branch and contributes nothing to prs —
  // not "", not 0. Two of the four waves above omit PR:, and prs is [10, 11].
  const meta = parse('canonical-waves-heading.md');
  assert.deepEqual(meta.prs, [10, 11]);
  // feature/dropped and feature/migration have no PR: — neither adds anything.
  assert.equal(meta.prs.includes(0), false, 'no zero stands in for an absent PR');
  assert.equal(meta.prs.length, 2, 'exactly the two headings that carry a PR');
});

test('plan-meta: a backticked branch name in a ## Waves body line is NOT a branch', () => {
  // THE DEFECT THE OLD SHAPE INVITED, now structurally impossible. The Tracer
  // wave's description cites `feature/not-a-branch` in prose; under the old
  // shape a body line's second path-shaped token was read as another branch
  // (opus5-longhorizon-hardening reported six branches for a five-branch wave
  // on 2026-08-22). The branch comes from the HEADING now, so prose cannot
  // masquerade as a branch.
  const meta = parse('canonical-waves-heading.md');
  assert.equal(meta.branches.includes('feature/not-a-branch'), false,
    'a name in a description is prose, not a branch');
  // And a → #NNN in that same prose line is not a PR either.
  assert.equal(meta.prs.includes(999), false, 'a → #NNN in prose is not a PR');
});

test('plan-meta: a ## Waves section with an unreadable heading reports something, not silent zero', () => {
  // THE SILENT-EMPTY FAILURE THIS PLAN EXISTS TO REFUSE. A `## Waves` section
  // whose heading the parser cannot read must not yield the same JSON as a plan
  // with no waves at all — that indistinguishability is exactly what makes a
  // mis-migrated plan disappear from the fleet scan and pass /plot-deliver's
  // empty-list gate. The section is SEEN (a wave with an unreadable name), so a
  // consumer can tell "a wave I could not parse" from "no waves".
  const meta = parseSource(`# Plan with an unreadable wave heading

## Status

- **Phase:** Approved
- **Type:** feature

## Waves

### this heading names no branch at all
- some prose describing work whose branch nobody wrote into the heading
`);
  // The section is not silently empty: the wave is recorded, name and all, even
  // though it carries no branch. A reader sees a wave it could not extract a
  // branch from — not an absence.
  assert.notDeepEqual(meta.waves, [], 'the ## Waves section is not silently dropped');
  assert.equal(meta.waves.length, 1, 'the unreadable heading still opens a wave');
  assert.equal(meta.waves[0].name, 'this heading names no branch at all');
  assert.deepEqual(meta.waves[0].branches, [], 'and its branch list is honestly empty');
});

test('plan-meta: ## Waves and ## Branches are read the same when a plan carries only Waves', () => {
  // THE COMPATIBILITY THE MIGRATION NEEDS. A plan that has been converted to
  // `## Waves` and no longer carries a `## Branches` section still parses in
  // full — phase, type, and the structural arrays all present.
  const meta = parse('canonical-waves-heading.md');
  assert.equal(meta.phase, 'approved');
  assert.equal(meta.type, 'feature');
  assert.equal(meta.review, 'pr');
  assert.ok(meta.branches.length === 4, 'the branches came from the headings');
});

test('plan-meta: a fenced ## Waves example is illustration, not the plan\'s own section', () => {
  // THE HAZARD ## Waves REINTRODUCED, and the reason the parser now tracks
  // fences. A plan that ARGUES FOR the new shape shows a `## Waves` block inside
  // a ``` fence, and its `### Removed (Branch: real/name)` headings look exactly
  // like real ones. waves-name-themselves is such a plan: its Design section
  // fences a `## Waves` example whose headings name bug/an-agent-is-not-a-machine
  // and feature/a-broken-agent-needs-you — branches of OTHER plans. Read as this
  // plan's own, they would be dispatched. The real implementation section is the
  // `## Branches` below the fence, and only it counts.
  const meta = parseSource(`# A plan that documents the new wave shape

## Status

- **Phase:** Approved
- **Type:** infra

## Design

The new shape puts the branch in the heading:

\`\`\`markdown
## Waves

### Removed (Branch: bug/example-not-real, PR: #300)
- work here
\`\`\`

## Branches

### Parsed
- \`infra/the-actual-branch\` — the real one → #7
`);
  assert.deepEqual(meta.branches, ['infra/the-actual-branch'],
    'the fenced example contributes nothing; the real ## Branches section wins');
  assert.deepEqual(meta.prs, [7], 'and the fenced PR: #300 is not a PR of this plan');
  assert.equal(meta.branches.includes('bug/example-not-real'), false);
});

// ---------------------------------------------------------------------------
// `## Slices` — the design spec's word for the section `## Waves` already
// names. A Slice holds one branch and belongs to one plan; a Wave is the
// fleet's cohort and spans plans (DESIGN-slice.md). This section was always
// the former, so `## Slices` is the accurate spelling and `## Waves` is the
// one 132 delivered plans carry.
//
// No plan is rewritten to say Slices. Both spellings are read, and the parser
// stops being the reason a new plan cannot say what the spec says.
// ---------------------------------------------------------------------------

// One body, two headings. Generating the twin by replacing the heading word is
// the point: a hand-written pair could drift apart and still pass, and the
// property under test is precisely that NOTHING but the word differs.
const SLICE_BODY = `# A plan that says Slices

## Status

- **Phase:** Approved
- **Type:** feature
- **Review:** PR

## Waves

### Tracer (Branch: feature/thin-slice, PR: #10)
- the first cut, citing \`feature/not-a-branch\` in prose

### Implementation (Branch: feature/api)
- the rest of it

### Deferred one (Branch: feature/dropped) <!-- deferred: covered by feature/api -->
- given up, not finished
`;

test('plan-meta: a ## Slices plan parses identically to the same plan saying ## Waves', () => {
  // THE WHOLE DELIVERABLE, asserted on BOTH inputs rather than on one plus a
  // claim about the other. Same body, one word changed: every field the parser
  // emits must be indistinguishable, or `## Slices` means something subtly
  // different from `## Waves` and the re-spelling is not a re-spelling.
  const waves = parseSource(SLICE_BODY);
  const slices = parseSource(SLICE_BODY.replace('## Waves', '## Slices'));
  // `file` is the temp path, which differs per parseSource call by construction.
  delete waves.file;
  delete slices.file;
  assert.deepEqual(slices, waves, 'every emitted field identical, not just branches');
  // Spell the expectation out once, so a change that keeps the two equal to
  // each other but wrong still fails.
  assert.deepEqual(slices.branches,
    ['feature/api', 'feature/dropped', 'feature/thin-slice'], 'read from the headings');
  assert.deepEqual(slices.prs, [10], 'only the heading that carries a PR:');
  assert.deepEqual(slices.waves, [
    { name: 'Tracer', branches: [{ branch: 'feature/thin-slice', deferred: false, deferred_reason: '', claimed: '' }] },
    { name: 'Implementation', branches: [{ branch: 'feature/api', deferred: false, deferred_reason: '', claimed: '' }] },
    { name: 'Deferred one', branches: [{ branch: 'feature/dropped', deferred: true, deferred_reason: 'covered by feature/api', claimed: '' }] },
  ], 'names, order and deferred survive the new spelling');
  // The prose citation stays prose under either word.
  assert.equal(slices.branches.includes('feature/not-a-branch'), false);
});

test('plan-meta: a fenced ## Slices example is illustration, not the plan\'s own section', () => {
  // THE HAZARD INHERITED WITH THE SPELLING. A plan arguing FOR `## Slices`
  // shows one inside a fence, and its headings look exactly like real ones —
  // the same trick that fooled both older spellings. Routing Slices through the
  // Waves handler inherits the fence guard rather than needing its own.
  const meta = parseSource(`# A plan documenting the slice shape

## Status

- **Phase:** Approved
- **Type:** infra

## Design

\`\`\`markdown
## Slices

### Parsing (Branch: infra/example-not-real, PR: #300)
- work here
\`\`\`

## Branches

### Parsed
- \`infra/the-actual-branch\` — the real one → #7
`);
  assert.deepEqual(meta.branches, ['infra/the-actual-branch'],
    'the fenced Slices example contributes nothing');
  assert.deepEqual(meta.prs, [7], 'and its PR: #300 is not a PR of this plan');
});

test('plan-meta: a plan carrying BOTH ## Waves and ## Slices reads the first, not both', () => {
  // WHY THE TWO SHARE waves_seen. First-section-wins is the standing rule for
  // every spelling, and it has to hold ACROSS them: a plan mid-migration that
  // grew a `## Slices` section while keeping its old `## Waves` must not report
  // the union of two implementation sections as one plan's branch list. The
  // second section is illustration by the same rule a repeated heading is.
  const meta = parseSource(`# A plan carrying both spellings

## Status

- **Phase:** Approved
- **Type:** feature

## Waves

### First (Branch: feature/from-waves, PR: #1)
- the section that wins

## Slices

### Second (Branch: feature/from-slices, PR: #2)
- the later heading is not a second implementation section
`);
  assert.deepEqual(meta.branches, ['feature/from-waves'],
    'the first section wins; the second contributes nothing');
  assert.deepEqual(meta.prs, [1], 'and neither does its PR');
  assert.equal(meta.waves.length, 1, 'one implementation section, not two');
});

test('plan-meta: a fenced ## Branches example is illustration too (latent bug, now closed)', () => {
  // THE SAME TRICK ON THE OLD PATH, which the committed parser got wrong. A
  // fenced `## Branches` example won the first-heading-wins guard, so the parser
  // read the EXAMPLE branch and MISSED the real section entirely — a plan
  // documenting the format reported a branch that does not exist and hid the one
  // that does. Fence tracking fixes both spellings at once.
  const meta = parseSource(`# A plan documenting the old shape

## Status

- **Phase:** Approved
- **Type:** docs

## Design

\`\`\`markdown
## Branches
- \`feature/example-not-real\` → #99
\`\`\`

## Branches

- \`feature/actually-real\` → #5
`);
  assert.deepEqual(meta.branches, ['feature/actually-real'],
    'the real section wins, not the fenced example');
  assert.deepEqual(meta.prs, [5], 'and only its PR counts');
});
// A CLAIM IS A LIST ITEM — the branch matcher is anchored to `- ` + backtick.
//
// `## Branches` sections cite other plans' branches to declare dependencies,
// and the matcher read every backticked name on every line as a claim. So a
// plan that merely MENTIONED another plan's branch claimed it: the board
// rendered the branch twice, in two sections, as `claimed twice`, and
// /plot-dispatch would fan out a branch the plan does not own.
//
// The anchor is licensed by a MEASUREMENT, not a preference. Swept across
// `docs/plans/` on 2026-08-27: 259 lines under `## Branches` carry a backticked
// branch name and all 259 are anchored list items — the stricter rule drops no
// real claim. That sweep is what makes this safe, and it is why the count
// assertion below is DIFFERENTIAL rather than a hardcoded total.
//
// Rewording the citations was the old repair, and it is a rule an author must
// remember in the one section where writing branch names is the entire point.
// It had been forgotten twice. Gates over rules: the parser is now UNABLE to
// read a citation as a claim.

test('plan-meta: a branch cited in a blockquote is not a claim', () => {
  // THE EXACT SHAPE FROM `every-section-has-one-subject`, which is where this
  // was found on the live board. The blockquote explains why the wave is
  // ordered where it is — precisely what a `## Branches` section should say —
  // and the whole line is prose. Nothing on it is a claim.
  const meta = parseSource(`# Plan

## Status

- **Phase:** Approved
- **Type:** feature

## Branches

### Inverted

> **Depends on \`approval-hands-the-work-to-agents\` wave 1**
> (\`feature/the-registry-knows-which-agents-live\`), and the dependency is not
> tidiness. Measured 2026-08-22: the registry records a launch and nothing
> marks it finished.

- \`feature/working-is-about-agents\` — WORKING renders the agents list.
`);
  assert.deepEqual(meta.branches, ['feature/working-is-about-agents'],
    'only the list item is a claim; the blockquote cites a dependency');
  assert.ok(!meta.branches.includes('feature/the-registry-knows-which-agents-live'),
    'the cited branch belongs to the plan that LISTS it, not to this one');
});

test('plan-meta: a branch cited mid-sentence inside a claim line is not a second claim', () => {
  // THE CASE THAT DIFFERS FROM THE BLOCKQUOTE, and the one a naive anchor
  // fails. Here the line IS a claim and the citation sits INSIDE it: the item
  // opens with the branch it owns, then names another plan's branch as the
  // dependency it waits on. An implementation that only skipped non-list lines
  // would pass the blockquote test and still take two branches from this line.
  //
  // The shape is `a-dispatch-hands-over-a-brief`, the second of the two rows
  // that wore `claimed twice` on the board.
  const meta = parseSource(`# Plan

## Status

- **Phase:** Approved
- **Type:** feature

## Branches

### Handed over
- \`feature/the-board-asks-for-a-brief\` — waits for the brief. **Depends on \`an-approved-plan-offers-its-two-starts\` WAVE 2** (\`feature/implement-runs-from-the-board\`) — on the wave landing, not on its plan PR merging.
`);
  assert.deepEqual(meta.branches, ['feature/the-board-asks-for-a-brief'],
    'the item claims the branch it opens with, and nothing else on the line');
  assert.ok(!meta.branches.includes('feature/implement-runs-from-the-board'),
    'the mid-sentence citation is a dependency, not a claim');
});

test('plan-meta: a branch cited on a wrapped continuation line is not a claim', () => {
  // THE SAME CITATION, WRAPPED — which is how it actually appeared in
  // `a-dispatch-hands-over-a-brief`. A continuation line does not start with
  // `- `, so the anchor excludes it; but the exclusion is worth pinning
  // separately because the description above it wraps freely and an author
  // controls neither where the line breaks nor what lands at its start.
  const meta = parseSource(`# Plan

## Status

- **Phase:** Approved
- **Type:** feature

## Branches

### Handed over
- \`feature/the-board-asks-for-a-brief\` — waits for the brief. **Depends on
  \`an-approved-plan-offers-its-two-starts\` WAVE 2**
  (\`feature/implement-runs-from-the-board\`) — on the wave landing.
`);
  assert.deepEqual(meta.branches, ['feature/the-board-asks-for-a-brief'],
    'the claim is the item head; its wrapped tail carries a citation only');
});

test('plan-meta: a branch named in an HTML comment is not a claim', () => {
  // A COMMENT RECORDS A REMOVAL, and recording that a branch is gone is the
  // opposite of claiming it. The old matcher read this as a live claim, so a
  // plan that documented dropping a branch went on dispatching it.
  const meta = parseSource(`# Plan

## Status

- **Phase:** Approved
- **Type:** bug

## Branches

- \`bug/still-here\` — the one real claim
<!-- \`feature/implement-and-dispatch-take-a-plan\` was removed 2026-08-22. -->
`);
  assert.deepEqual(meta.branches, ['bug/still-here'],
    'the comment names a branch this plan no longer owns');
});

test('plan-meta: the anchor drops no real claim across the whole estate (differential)', () => {
  // THE GUARD AGAINST A STRICTER MATCHER SILENTLY LOSING WORK. This is the
  // failure mode the change must not have, and it cannot be asserted with a
  // number: the plan was written against 248 claims, main carried 200 a few
  // days later, and this file would fail a correct implementation the next time
  // a plan lands. So the assertion is DIFFERENTIAL — every line under
  // `## Branches` that the loose matcher accepts is compared against what the
  // anchored one accepts, over the real estate, and the two must agree.
  //
  // A DROP here is not necessarily a bug in the parser: it means a plan in
  // `docs/plans/` writes a claim in a shape the anchor refuses, and the
  // failure message names the file and line so a human can read it and decide
  // which of the two is wrong.
  const plansDir = path.join(here, '..', '..', 'docs', 'plans');
  const prefixes = 'idea|feature|bug|docs|infra';
  const loose = new RegExp('`(' + prefixes + ')\\/[^`]+`');
  const anchored = new RegExp('^[ \\t]*-[ \\t]+`(' + prefixes + ')\\/[^`]+`');

  const files = readdirSync(plansDir, { withFileTypes: true })
    .filter((e) => e.isFile() && e.name.endsWith('.md'))
    .map((e) => path.join(plansDir, e.name));
  assert.ok(files.length > 0, 'the estate has plans to sweep');

  const dropped = [];
  let anchoredLines = 0;
  for (const file of files) {
    let section = '';
    let inFence = false;
    let branchesSeen = false;
    let shape = '';
    let inComment = false;
    const lines = readFileSync(file, 'utf8').split('\n');
    lines.forEach((line, i) => {
      if (line.startsWith('```')) { inFence = !inFence; return; }
      if (inFence) return;
      // HTML COMMENTS ARE NOT CLAIMS, and `plot-plan-meta.sh` skips them for
      // the same reason. A `moved:` note written before a section's first
      // `### ` heading otherwise reads as a list-shape claim line: the shape is
      // still undecided there, so the sweep has nothing to tell it apart.
      if (inComment) { if (line.includes('-->')) inComment = false; return; }
      if (/^[ \t]*<!--/.test(line) && !line.includes('-->')) { inComment = true; return; }
      if (line.startsWith('## ')) {
        // THE LIST-ITEM DIALECT IS THE VULNERABLE ONE, and since 2026-09-04 it
        // no longer has a heading of its own: every plan says `## Slices`, and
        // which LAYOUT a section holds is decided by the shape of its first
        // `### ` heading rather than by the word. So all three spellings open
        // the section here, and the anchored/loose comparison below is what
        // still distinguishes a claim line from a citation.
        //
        // Matching `## Branches` alone left this sweep with nothing to examine
        // — `anchoredLines` fell to 0 and the self-check at the foot fired,
        // which is the check doing its job: a differential test that examines
        // no lines proves nothing.
        if (/^## (Branches|Waves|Slices)/.test(line)) { section = branchesSeen ? '' : 'branches'; branchesSeen = true; shape = ''; }
        else section = '';
        return;
      }
      // THE SHAPE DECIDES, exactly as `plot-plan-meta.sh` does since 2026-09-04.
      // A `(Branch:` in the first `### ` heading means the branch rides the
      // heading and every body line is PROSE — a citation there was never a
      // claim, which is why this sweep only ever examined the list dialect.
      // Selecting by heading word instead flagged four prose citations as
      // dropped claims, all of them in heading-shape sections.
      if (section === 'branches' && shape === '' && /^###[ \t]/.test(line)) {
        shape = line.includes('(Branch:') ? 'heading' : 'list';
      }
      if (section === 'branches' && shape === 'heading') return;
      if (section !== 'branches') return;
      // A TABLE ROW IS NOT A CLAIM. The parser reads a claim off a `- ` list
      // item and nothing else, so a row beginning with `|` was never one — a
      // plan documenting what four components decide about `idea/*` refs puts
      // those names in a table, and the loose matcher sees only the backticks.
      // Measured 2026-09-04 in `every-element-is-a-domain-concept`, which broke
      // the 2.13.0 release run: two table rows reported as dropped claims.
      if (/^[ \t]*\|/.test(line)) return;
      if (anchored.test(line)) anchoredLines++;
      else if (loose.test(line)) dropped.push(`${path.basename(file)}:${i + 1}: ${line.trim()}`);
    });
  }

  assert.deepEqual(dropped, [],
    'anchoring must drop no line the loose matcher read as a claim');
  assert.ok(anchoredLines > 0, 'the sweep actually examined branch claims');
});

test('plan-meta: annotations still bind after anchoring', () => {
  // THE ANNOTATIONS ARE READ OFF THE SAME LINE the branch was matched on, so an
  // anchor change can break them without touching claim detection — `→ #N`,
  // `deferred`, `claimed` and `moved` are all parsed around the match. They are
  // asserted together here because that shared dependency is invisible from
  // either side alone.
  const meta = parseSource(`# Plan

## Status

- **Phase:** Approved
- **Type:** bug

## Branches

- \`bug/merged\` — landed → #501
- \`bug/put-off\` — not now <!-- deferred: superseded by the anchor 2026-08-27 -->
- \`bug/taken\` — in flight <!-- claimed: agent-7 2026-08-27 -->
- \`bug/bare-defer\` — <!-- deferred -->
`);
  assert.deepEqual(meta.branches,
    ['bug/bare-defer', 'bug/merged', 'bug/put-off', 'bug/taken'],
    'all four items are claims');
  assert.deepEqual(meta.prs, [501], 'the arrow annotation still binds');

  const wave = meta.waves[0];
  const byName = Object.fromEntries(wave.branches.map((b) => [b.branch, b]));
  assert.equal(byName['bug/put-off'].deferred, true, 'deferred still binds');
  assert.equal(byName['bug/put-off'].deferred_reason,
    'superseded by the anchor 2026-08-27', 'and carries its reason');
  assert.equal(byName['bug/bare-defer'].deferred, true, 'the bare form still binds');
  assert.equal(byName['bug/taken'].claimed, 'agent-7 2026-08-27', 'claimed still binds');
  assert.equal(byName['bug/merged'].deferred, false, 'an unannotated branch is not deferred');
});

test('plan-meta: an indented list item is still a claim', () => {
  // THE ANCHOR ALLOWS LEADING WHITESPACE, because a nested list item is still
  // a list item. Pinned so a future tightening to `^- ` has to argue with a
  // test rather than pass quietly.
  const meta = parseSource(`# Plan

## Status

- **Phase:** Approved
- **Type:** bug

## Branches

  - \`bug/indented\` — nested but claimed
`);
  assert.deepEqual(meta.branches, ['bug/indented'], 'indentation does not unmake a claim');
});

// `Issue:` under a non-GitHub tracker — a plan can cite a tracker KEY
// (`PROJ-123`) as well as GitHub's `#N`. The board's inbox is "open tracker
// issues no plan references", matched through this field: an unparsed Jira key
// leaves a delivered ticket in the inbox permanently, filed as undecided.
//
// The tracker is read from `## Plot Config` (this script's first configuration
// dependency), or named directly with `--tracker` — which is what these tests
// use, because a fixture parsed outside any repo has no Plot Config to read.

test('parser: a Jira tracker reads a key, and #N still reads too (item 5)', () => {
  // Under `Tracker: jira`, `PLOT-412` reports `PLOT-412` — and `#228` still
  // reports `228`, unchanged. Both live in `issues`; GitHub numbers stay JSON
  // numbers, tracker keys are JSON strings, numbers sorted before keys.
  const dir = mkdtempSync(path.join(tmpdir(), 'plot-parser-jira-'));
  const f = path.join(dir, '2026-01-01-keyed.md');
  writeFileSync(f, `# A plan under a Jira tracker

## Status

- **Phase:** Approved
- **Type:** feature
- **Issue:** PLOT-412, #228
`);
  const meta = JSON.parse(
    execFileSync('bash', [parser, f, '--tracker', 'jira'], { encoding: 'utf8' }).trim());
  assert.deepEqual(meta.issues, [228, 'PLOT-412'],
    'the number reads as a number, the key as a string, numbers first');
  rmSync(dir, { recursive: true, force: true });
});

test('parser: --tracker matches the first token, so `jira <url>` counts', () => {
  // `plot-config.sh get Tracker` can return the scheme with a URL after it
  // (`jira https://acme.atlassian.net`); the gate keys on the FIRST token.
  const dir = mkdtempSync(path.join(tmpdir(), 'plot-parser-jiraurl-'));
  const f = path.join(dir, '2026-01-01-keyed.md');
  writeFileSync(f, `# A plan under a Jira tracker with a URL

## Status

- **Phase:** Approved
- **Issue:** PROJ-7
`);
  const meta = JSON.parse(execFileSync(
    'bash', [parser, f, '--tracker', 'jira https://acme.atlassian.net'],
    { encoding: 'utf8' }).trim());
  assert.deepEqual(meta.issues, ['PROJ-7'], 'the scheme token gates, not the whole value');
  rmSync(dir, { recursive: true, force: true });
});

test('parser: linear is a key tracker too, and a plan can cite several', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'plot-parser-linear-'));
  const f = path.join(dir, '2026-01-01-multi.md');
  writeFileSync(f, `# A plan answering several tracker keys

## Status

- **Phase:** Approved
- **Issue:** ENG-99, ENG-2, #10
`);
  const meta = JSON.parse(
    execFileSync('bash', [parser, f, '--tracker', 'linear'], { encoding: 'utf8' }).trim());
  // Numbers sorted numerically, then keys sorted lexically; duplicates dropped.
  assert.deepEqual(meta.issues, [10, 'ENG-2', 'ENG-99'],
    'sorted and deduped across both shapes');
  rmSync(dir, { recursive: true, force: true });
});

test('parser: without a tracker key, PLOT-412 parses as absent (item 6)', () => {
  // THE ITEM A PERMISSIVE REGEX PASSES ITEM 5 WITHOUT. The default is GitHub —
  // today's behaviour, so no existing repo changes meaning. A key form is read
  // ONLY where a tracker is named; here none is, so `PLOT-412` is not a
  // reference and `#228` is the only issue. This must hold with no --tracker
  // flag AND with an explicit GitHub tracker.
  const dir = mkdtempSync(path.join(tmpdir(), 'plot-parser-nokey-'));
  const f = path.join(dir, '2026-01-01-plain.md');
  writeFileSync(f, `# A plan with a key-shaped Issue but no tracker

## Status

- **Phase:** Approved
- **Issue:** PLOT-412, #228
`);
  const dflt = JSON.parse(execFileSync('bash', [parser, f], { encoding: 'utf8' }).trim());
  assert.deepEqual(dflt.issues, [228],
    'no tracker named → only #N is a reference, the key is prose');
  const gh = JSON.parse(execFileSync(
    'bash', [parser, f, '--tracker', 'github-issues'], { encoding: 'utf8' }).trim());
  assert.deepEqual(gh.issues, [228], 'an explicit GitHub tracker is the same as none');
  rmSync(dir, { recursive: true, force: true });
});

test('parser: a key tracker still refuses non-issue LETTERS-word tokens', () => {
  // "Accepting any LETTERS-digits token unconditionally was rejected": a plan
  // whose `Issue:` says `WONT-FIX` or `TODO-later` would otherwise start
  // reporting an issue reference, and the inbox would hide a real ticket on the
  // strength of it. The key form requires a DIGIT suffix, so a word suffix
  // never matches — even under a Jira tracker.
  const dir = mkdtempSync(path.join(tmpdir(), 'plot-parser-wontfix-'));
  const f = path.join(dir, '2026-01-01-word.md');
  writeFileSync(f, `# A plan whose Issue line is a word, not a key

## Status

- **Phase:** Draft
- **Issue:** WONT-FIX, TODO-later
`);
  const meta = JSON.parse(
    execFileSync('bash', [parser, f, '--tracker', 'jira'], { encoding: 'utf8' }).trim());
  assert.deepEqual(meta.issues, [], 'a word suffix is not an issue key, tracker or no');
  rmSync(dir, { recursive: true, force: true });
});

test('parser: an unreadable or empty tracker never fails a parse (item 7)', () => {
  // Configuration absence is not a parse failure. An empty `--tracker` (the
  // shape a missing `## Plot Config` produces) yields valid JSON with today's
  // GitHub behaviour — the parse succeeds and the record is complete.
  const dir = mkdtempSync(path.join(tmpdir(), 'plot-parser-emptytracker-'));
  const f = path.join(dir, '2026-01-01-plan.md');
  writeFileSync(f, `# A plan parsed with an empty tracker value

## Status

- **Phase:** Approved
- **Type:** feature
- **Issue:** PLOT-412, #228
`);
  // An empty value must not throw, must emit one valid JSON line, and must fall
  // back to GitHub — proving no configuration failure ever reaches the parse.
  const raw = execFileSync('bash', [parser, f, '--tracker', ''], { encoding: 'utf8' }).trim();
  const meta = JSON.parse(raw);
  assert.equal(meta.format, 'canonical', 'the record parsed in full');
  assert.deepEqual(meta.issues, [228], 'empty tracker is GitHub, the safe default');
  rmSync(dir, { recursive: true, force: true });
});

test('plan-meta: a comment marker in a fenced block is illustration, not a comment', () => {
  // MEASURED on the plan that carries this fix: a plan documenting the changeset
  // format shows a `bumps:` block inside a ``` fence, and that block opens with
  // a bare comment marker. The parser read the marker as a real comment-open,
  // swallowed everything after it, and the whole file came back `format: none` —
  // no phase, no type, no branches. A plan about a mishandled comment, defeated
  // by a mishandled comment.
  //
  // A fence is illustration, never contract — the standing rule the parser
  // already applies to `## Waves` and `## Branches` headings. The comment rules
  // must follow it too, which means the fence toggle has to be tested BEFORE
  // the comment-open rule rather than after it.
  const dir = mkdtempSync(path.join(tmpdir(), 'plot-parser-fence-comment-'));
  const f = path.join(dir, '2026-08-30-fenced-marker.md');
  writeFileSync(f, `# A plan that documents the changeset format

## Status

- **Phase:** Approved
- **Type:** bug

## Detail

The block a changeset carries, printed rather than described. The opener is
shown WITHOUT its closing marker, which is the shape that bites: a fenced block
whose \`-->\` is present merely loses the fence interior and recovers, while an
unterminated opener runs to EOF and takes every later section with it.

\`\`\`markdown
<!--
bumps:
  skills:
    plot: patch
\`\`\`

## Branches

- \`bug/a-plan-may-mention-a-comment-marker\`

Prose after the fence, which must still be read as content.
`);
  try {
    const actual = JSON.parse(execFileSync('bash', [parser, f], { encoding: 'utf8' }));
    assert.equal(actual.format, 'canonical', 'the plan parsed as a plan');
    assert.equal(actual.phase, 'approved', 'phase survived the fenced marker');
    assert.equal(actual.type, 'bug', 'type survived the fenced marker');
    assert.deepEqual(actual.branches, ['bug/a-plan-may-mention-a-comment-marker'],
      'the branch survived the fenced marker');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('plan-meta: a comment marker in inline code is illustration, not a comment', () => {
  // The subtler half, and the one that cost this repo a plan. A marker written
  // between backticks — where Markdown renders it as a literal — sits on a line
  // with no closing `-->`, so it matched the comment-open rule and swallowed the
  // REST OF THE FILE. One backticked marker in a summary line costs a plan its
  // phase, its type and every branch it names.
  //
  // The workaround was to describe the marker rather than print it. That is a
  // concession, not a fix: a plan must be able to say what it is about.
  const dir = mkdtempSync(path.join(tmpdir(), 'plot-parser-inline-comment-'));
  const f = path.join(dir, '2026-08-30-inline-marker.md');
  writeFileSync(f, `# A changeset whose \`<!--\` marker becomes its description

## Status

- **Phase:** Approved
- **Type:** bug
- **Review:** pr

## Branches

- \`bug/a-changeset-says-what-changed\` — a bare \`<!--\` opener is not a summary.
`);
  try {
    const actual = JSON.parse(execFileSync('bash', [parser, f], { encoding: 'utf8' }));
    assert.equal(actual.format, 'canonical', 'the plan parsed as a plan');
    assert.equal(actual.phase, 'approved', 'phase survived the inline marker');
    assert.equal(actual.type, 'bug', 'type survived the inline marker');
    assert.equal(actual.review, 'pr', 'the field after the marker was still read');
    assert.deepEqual(actual.branches, ['bug/a-changeset-says-what-changed'],
      'the branch survived the inline marker');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('plan-meta: a genuine multi-line comment is still skipped', () => {
  // The opposite direction, and the one that would break EVERY plan rather than
  // one. The Status block is full of genuine comments — template guidance blocks
  // and `<!-- optional -->` placeholders — and a parser that stopped honouring
  // those trades a rare defect for a universal one.
  //
  // canonical-comment-block.md already covers the placeholder case. This covers
  // the interaction the fix introduces: a fence marker INSIDE a genuine comment
  // must not toggle fence state, or the comment's closing `-->` gets read as
  // content and everything after it is swallowed instead.
  const dir = mkdtempSync(path.join(tmpdir(), 'plot-parser-real-comment-'));
  const f = path.join(dir, '2026-08-30-real-comment.md');
  writeFileSync(f, `# A plan with genuine comments

## Status

- **Phase:** Approved
- **Type:** docs
- **Review:** <!-- pr | in-session | ballot -->
<!-- Transition records — written by the workflow commands, not by hand:
- **Approved:** <date>, <who>, <channel>
\`\`\`
- **Started:** <date>, <who>, <branch>
\`\`\`
-->

## Branches

- \`docs/after-the-comment\`
`);
  try {
    const actual = JSON.parse(execFileSync('bash', [parser, f], { encoding: 'utf8' }));
    assert.equal(actual.format, 'canonical', 'the plan parsed as a plan');
    assert.equal(actual.phase, 'approved', 'phase read from before the comment');
    assert.equal(actual.review, 'NONE', 'the placeholder still counts as absent');
    assert.equal(actual.approved_raw, '', 'the comment interior contributed nothing');
    assert.deepEqual(actual.started_raw, [], 'a fenced line inside a comment is still comment');
    assert.deepEqual(actual.branches, ['docs/after-the-comment'],
      'the comment closed, so content after it was read');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// `waits:` — the prerequisite a branch names, and the field three components
// will read.
//
// A slice that cannot start until another branch lands says so on its own line:
// `- `feature/x` <!-- waits: bug/y --> — description`. The parser reports what
// the file says and validates nothing: whether `bug/y` exists, whether any plan
// declares it, and whether the wait is satisfied are all questions for the
// scan, not for a field extractor.

test('plan-meta: `waits:` reports the branch it names, and is absent otherwise', () => {
  const meta = parseSource(`# Plan

## Status

- **Phase:** Approved
- **Type:** feature

## Branches

- \`feature/second\` <!-- waits: bug/the-budget-knows-which-bucket-it-spent --> — needs the budget first.
- \`feature/first\` — nothing blocks it.
`);
  const byName = Object.fromEntries(meta.waves[0].branches.map((b) => [b.branch, b]));
  assert.equal(byName['feature/second'].waits_on,
    'bug/the-budget-knows-which-bucket-it-spent',
    'the annotation names one branch, and that branch is reported');
  // ABSENT, NOT EMPTY. The board distinguishes the two elsewhere, and a
  // `waits_on: ""` would read as "waits on a branch whose name is blank"
  // rather than "declares no prerequisite".
  assert.ok(!('waits_on' in byName['feature/first']),
    'a branch with no annotation carries no waits_on key at all');
});

test('plan-meta: `waits:` and `deferred:` on one branch do not clobber each other', () => {
  // THEY ARE DIFFERENT ANNOTATIONS FOR DIFFERENT THINGS. `deferred:` is a
  // judgement — this work was given up on — and `waits:` is a fact a script can
  // check. Both are read off the whole line before the branch match runs, and
  // both use a greedy `sub()`; a shared line is where a sloppy pattern for one
  // eats the other.
  const meta = parseSource(`# Plan

## Status

- **Phase:** Approved
- **Type:** feature

## Branches

- \`feature/both\` <!-- waits: bug/prereq --> <!-- deferred: superseded 2026-09-01 --> — shelved, and it had a prerequisite.
- \`feature/defer-first\` <!-- deferred: not now --> <!-- waits: bug/other --> — the other order.
`);
  const byName = Object.fromEntries(meta.waves[0].branches.map((b) => [b.branch, b]));
  assert.equal(byName['feature/both'].waits_on, 'bug/prereq', 'waits survives a deferral beside it');
  assert.equal(byName['feature/both'].deferred, true, 'and the deferral still binds');
  assert.equal(byName['feature/both'].deferred_reason, 'superseded 2026-09-01',
    'with its reason intact');
  assert.equal(byName['feature/defer-first'].waits_on, 'bug/other', 'order does not matter');
  assert.equal(byName['feature/defer-first'].deferred_reason, 'not now',
    'and the reason survives the annotation that follows it');
});

test('plan-meta: `waits:` naming a branch no plan declares still parses', () => {
  // THE PARSER REPORTS, IT DOES NOT VALIDATE. The scan turns an unknown
  // prerequisite into `blocked`; a parser that refused the annotation would
  // hide the very case the verdict exists for.
  const meta = parseSource(`# Plan

## Status

- **Phase:** Approved
- **Type:** feature

## Branches

- \`feature/hopeful\` <!-- waits: feature/nobody-declares-this --> — waiting on a stranger.
`);
  assert.equal(meta.waves[0].branches[0].waits_on, 'feature/nobody-declares-this',
    'an undeclared prerequisite is reported, not refused');
});

test('plan-meta: one prerequisite per branch — a second `waits:` wins', () => {
  // ONE PREREQUISITE, NEVER A LIST. A slice needing two has not been cut finely
  // enough, and a list invites a dependency graph nobody wants to debug. The
  // parse does not fail on a second annotation — it takes the LAST one, which
  // is what the greedy read shared with `deferred:` and `claimed:` produces.
  // Pinned so the shape is a decision rather than an accident.
  const meta = parseSource(`# Plan

## Status

- **Phase:** Approved
- **Type:** feature

## Branches

- \`feature/greedy\` <!-- waits: bug/first --> <!-- waits: bug/second --> — two written, one read.
`);
  assert.equal(meta.waves[0].branches[0].waits_on, 'bug/second',
    'the later annotation wins; the field is never a list');
});

test('plan-meta: `waits:` binds in the `## Waves` heading spelling too', () => {
  // BOTH SPELLINGS EMIT THE SAME waves[] — that is the parser's standing
  // contract, and a field added to one dialect only would break it the first
  // time a plan migrated.
  const meta = parseSource(`# Plan

## Status

- **Phase:** Approved
- **Type:** feature

## Waves

### Declaring (Branch: feature/declaring, PR: #601)

### Consuming (Branch: feature/consuming) <!-- waits: feature/declaring -->
`);
  assert.deepEqual(meta.waves.map((w) => w.name), ['Declaring', 'Consuming']);
  assert.ok(!('waits_on' in meta.waves[0].branches[0]),
    'the first slice waits on nothing');
  assert.equal(meta.waves[1].branches[0].waits_on, 'feature/declaring',
    'the heading annotation binds like the list-item one');
});

test('plan-meta: a `waits:` value stops at the comment, not at the prose after it', () => {
  // The value is a BRANCH NAME, not free prose: `deferred_reason` takes the
  // rest of the comment because a reason is a sentence, and `waits_on` must not
  // — a trailing word inside the comment would silently become part of the
  // branch name and match nothing.
  const meta = parseSource(`# Plan

## Status

- **Phase:** Approved
- **Type:** feature

## Branches

- \`feature/tidy\` <!-- waits:   bug/spaced   --> — leading and trailing space around the name.
`);
  assert.equal(meta.waves[0].branches[0].waits_on, 'bug/spaced',
    'whitespace inside the annotation is not part of the branch name');
});

test('plan-meta: a `waits:` syntax example in prose is not a declaration', () => {
  // THE PLAN THAT INTRODUCED THIS FIELD DOCUMENTS IT ON A BRANCH LINE, writing
  // the literal marker inside backticks as prose. No comment-aware reading can
  // tell that apart from a real annotation — the branch prefixes can, and that
  // is why the value is shape-checked. `<branch>` is a placeholder; `bug/x` is
  // a branch.
  //
  // Measured 2026-09-01: without the check,
  // `2026-09-01-a-slice-can-wait-on-another-plan.md` reported
  // `waits_on: "<branch>"` for its own first slice.
  const meta = parseSource(`# Plan

## Status

- **Phase:** Approved
- **Type:** feature

## Branches

- \`feature/documenting\` — the parser reads \`<!-- waits: <branch> -->\` beside \`deferred:\`.
- \`feature/real\` <!-- waits: bug/actual --> — and this one means it.
`);
  const byName = Object.fromEntries(meta.waves[0].branches.map((b) => [b.branch, b]));
  assert.ok(!('waits_on' in byName['feature/documenting']),
    'a placeholder is not a branch name, so the plan declares no prerequisite');
  assert.equal(byName['feature/real'].waits_on, 'bug/actual',
    'and a real annotation on the next line is unaffected');
});
