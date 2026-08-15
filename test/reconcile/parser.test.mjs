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
