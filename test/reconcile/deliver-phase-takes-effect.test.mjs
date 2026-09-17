// Contract test for a delivery reporting a phase the parser will actually read.
//
// #924, filed from a real delivery in a project repository: the plan carried
// BOTH front matter and a `## Status` block, `plot-deliver.sh` wrote `Delivered`
// into the block, and `plot-plan-meta.sh` went on answering `approved` — it
// prefers front matter wherever it exists and reads the block only in the
// `else if` below. The write succeeded, the outcome did not, and the summary
// line said `phase=flipped`.
//
// THE FAILURE HAD NO SYMPTOM, which is why the fix needs a test. Every signal a
// person sees reported success: awk changed a line, the `mv` landed, the push
// went through, the summary said so. Only a reader asking the parser — which is
// every later consumer, the board and the scan included — saw `approved`.
//
// `flip_phase`'s awk matches only inside `section == "status"`. That one guard
// is the defect in ten lines: on a front-matter plan it edits the block and
// leaves the front matter untouched, then returns 0 for having changed
// something.
//
// AMENDED 2026-09-17 BY #933, WHICH FIXED THE ROOT THIS GATE CAUGHT AT THE
// SURFACE. `plot-plan-meta.sh` now reads the phase from the field Plot writes,
// so on a two-record plan the writer and the parser agree and the delivery
// lands. The first four tests below inverted with it: they pinned the refusal,
// and they now pin the delivery plus the round trip that proves it real. The
// gate itself is unchanged and still refuses a file the parser cannot read.
//
// THE ASSERTION IS THE ROUND TRIP, and nothing here re-implements either side.
// The test drives the real script and then asks `plot-plan-meta.sh` what the
// plan says, exactly as `deliver-record-outside-comments.test.mjs` does and for
// its stated reason: a test that copies the gate's logic passes while the
// script stays broken.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const deliver = path.resolve(here, '../../skills/plot/scripts/plot-deliver.sh');
const meta = path.resolve(here, '../../skills/plot/scripts/plot-plan-meta.sh');

/**
 * A whole repo with one plan, delivered for real.
 *
 * NOT `--dry-run`: the dry run prints what it WOULD write and never reaches
 * `write_transition`, so it cannot see this defect at all.
 *
 * AND IT NEEDS A REMOTE, for the reason `deliver-record-outside-comments`
 * records: the writes happen in a booking worktree cut from `origin/<default>`,
 * and the script refuses outright when it cannot make one. A bare repo beside
 * the working copy is the cheapest honest remote — no network, no host CLI.
 *
 * @param planBody the whole plan file, so a test states its own shape.
 * @returns what the run printed, what it exited with, and the plan as it stands
 *   in the working copy and on `origin/main` afterwards.
 */
const deliverPlan = (planBody) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'plot-deliver-phase-'));
  const remote = `${dir}-remote.git`;
  try {
    execFileSync('git', ['init', '-q', '--bare', '-b', 'main', remote]);
    execFileSync('git', ['init', '-q', '-b', 'main', dir]);
    execFileSync('git', ['-C', dir, 'config', 'user.email', 't@example.com']);
    execFileSync('git', ['-C', dir, 'config', 'user.name', 'T']);
    fs.mkdirSync(path.join(dir, 'docs', 'plans'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'CLAUDE.md'),
      '## Plot Config\n\n- **Plan directory:** docs/plans/\n'
      + '- **Branch prefixes:** idea/, feature/, bug/, docs/, infra/\n');
    const rel = path.join('docs', 'plans', '2026-01-01-phased.md');
    // No branches section, so the merge gate finds nothing to refuse and the
    // run reaches the write. The write is what is under test.
    fs.writeFileSync(path.join(dir, rel), planBody);
    execFileSync('git', ['-C', dir, 'add', '-A']);
    execFileSync('git', ['-C', dir, 'commit', '-qm', 'plan']);
    execFileSync('git', ['-C', dir, 'remote', 'add', 'origin', remote]);
    execFileSync('git', ['-C', dir, 'push', '-q', 'origin', 'main']);
    execFileSync('git', ['-C', dir, 'fetch', '-q', 'origin']);

    const before = fs.readFileSync(path.join(dir, rel), 'utf8');
    let out = '';
    let code = 0;
    try {
      out = execFileSync('bash', [deliver, 'phased'],
        { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (e) {
      out = `${e.stdout ?? ''}${e.stderr ?? ''}`;
      code = e.status ?? 1;
    }

    const after = fs.readFileSync(path.join(dir, rel), 'utf8');

    // WHAT LANDED ON `origin/main`, WHICH IS WHERE A DELIVERY LEAVES ITS WORK.
    // The writes happen in a booking worktree and the caller's working copy is
    // deliberately untouched — the script's own comment gives the reason: that
    // tree may carry uncommitted work, and switching it out from under the
    // caller is exactly the write this script otherwise refuses. Measured while
    // writing this file: asserting on the working copy reported `approved`
    // after a perfectly good delivery.
    execFileSync('git', ['-C', dir, 'fetch', '-q', 'origin']);
    let onMain = '';
    try {
      onMain = execFileSync('git', ['-C', dir, 'show', `origin/main:${rel}`],
        { encoding: 'utf8' });
    } catch { onMain = ''; }

    // The parser's reading of the LANDED file — the reading every later
    // consumer takes, and the one #924 is about.
    const landed = path.join(dir, 'read-back.md');
    fs.writeFileSync(landed, onMain);
    const parsed = JSON.parse(
      execFileSync('bash', [meta, landed], { cwd: dir, encoding: 'utf8' }));

    // A second run against the file the first left behind. `decide_transition`
    // answers `write` rather than `already` on an unrepaired file — measured,
    // correcting an earlier draft of the plan — so the second run reaches the
    // gate again and must not slip past it.
    let second = '';
    let secondCode = 0;
    try {
      second = execFileSync('bash', [deliver, 'phased'],
        { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (e) {
      second = `${e.stdout ?? ''}${e.stderr ?? ''}`;
      secondCode = e.status ?? 1;
    }
    const afterSecond = fs.readFileSync(path.join(dir, rel), 'utf8');

    return { out, code, before, after, parsed, onMain, second, secondCode, afterSecond };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
    fs.rmSync(remote, { recursive: true, force: true });
  }
};

/** The reporter's exact shape: front matter AND a Status block. */
const TWO_RECORDS = `---
status: Approved
phase: Approved
---

# A plan

## Status

- **Phase:** Approved
- **Approved:** 2026-01-01, T, in-session

## Changelog

- Did a thing.
`;

/** One record, in the Status block — what nearly every plan here looks like. */
const STATUS_ONLY = `# A plan

## Status

- **Phase:** Approved
- **Approved:** 2026-01-01, T, in-session

## Changelog

- Did a thing.
`;

/** One record, in front matter — the other single-format shape. */
const FRONTMATTER_ONLY = `---
status: Approved
---

# A plan

## Changelog

- Did a thing.
`;

test('a plan holding two phase records DELIVERS, because writer and parser now agree', () => {
  // THIS TEST INVERTED WITH THE PARSER, AND #933 IS WHY. It pinned a refusal
  // that #924 added at the surface: the write landed in the `## Status` block,
  // `plot-plan-meta.sh` preferred front matter, and `phase_would_read` caught
  // the disagreement and stopped the delivery.
  //
  // THE REFUSAL WAS RIGHT AND IT WAS NOT A FIX. It left a plan that could not
  // move at all: a person was told to delete one of two records by hand, and
  // `plot-state-gate.sh` then refuses that hand edit because no script owns the
  // write. Two gates, and between them no way forward without the named escape.
  //
  // The parser now reads the field Plot writes, so the two agree and the gate
  // stops firing — because the condition is gone, not because it was softened.
  // `phase_would_read` is unchanged and still refuses a file it cannot parse,
  // and still asks the parser rather than trusting that awk changed a line.
  const r = deliverPlan(TWO_RECORDS);

  assert.equal(r.code, 0, `the delivery should succeed; it refused:\n${r.out}`);

  // AND IT IS A REAL DELIVERY, not merely an unrefused run. The assertion is
  // still the round trip #924 established: ask the parser what landed on
  // `origin/main`, which is the reading every later consumer takes.
  assert.equal(r.parsed.phase, 'delivered',
    'the run reported success while the parser reads a different phase — that is #924 again');
  assert.notEqual(r.parsed.delivered_raw, '', 'the Delivered record is missing');
  assert.match(r.out, /phase=flipped/);
});

test('the front matter is left behind, and the parser reports it as the alternate', () => {
  // WHAT KEEPS THIS FROM HIDING THE DRIFT IT STOPS CAUSING. No lifecycle script
  // writes front matter, so a delivered two-record plan still carries a stale
  // `status: Approved`. The parser reports it in `phase_alt` rather than
  // dropping it, so a reader — and any later gate — can still see the
  // disagreement that is now resolved rather than merely ignored.
  const r = deliverPlan(TWO_RECORDS);

  assert.match(r.onMain, /^status: Approved$/m,
    'front matter should be untouched — a second writer is the defect, not the fix');
  assert.equal(r.parsed.phase, 'delivered');
  assert.equal(r.parsed.phase_alt, 'approved',
    'the loser was dropped instead of reported');
});

test('a second run on a delivered two-record plan is a no-op, not a second delivery', () => {
  // Idempotence, which the refusal used to stand in for here. `decide_transition`
  // answers `already` once the phase reads `delivered`, so the second run must
  // change nothing rather than flip a phase twice or fail on its own work.
  const r = deliverPlan(TWO_RECORDS);

  assert.equal(r.secondCode, 0, `the second run should succeed:\n${r.second}`);
  assert.equal(r.afterSecond, r.after, 'the second run rewrote a plan already delivered');
});

test('the gate still refuses a plan the parser cannot read at all', () => {
  // THE CASE `phase_would_read` STILL EXISTS FOR, pinned so that retiring the
  // front-matter branch above did not quietly retire the gate. A scratch copy
  // that does not parse is exactly the state this keeps off the plan, and it is
  // unreachable through the two-record shape now that the shape delivers.
  const r = deliverPlan(`# A plan with no Status section

## Changelog

- Did a thing.
`);

  assert.notEqual(r.code, 0, `a plan with no phase should refuse:\n${r.out}`);
  assert.equal(r.after, r.before, 'the plan changed on a refused run');
  assert.equal(r.onMain, r.before, 'the plan on origin/main changed on a refused run');
});

test('a Status-block plan delivers exactly as before', () => {
  // THE NO-REGRESSION GATE, and it covers every plan in this repository: one
  // record, in the block, writer and parser agreeing.
  const r = deliverPlan(STATUS_ONLY);

  assert.equal(r.code, 0, `a normal delivery should succeed:\n${r.out}`);
  assert.equal(r.parsed.phase, 'delivered');
  assert.notEqual(r.parsed.delivered_raw, '', 'the Delivered record is missing');
  assert.match(r.out, /phase=flipped/);
});

test('a front-matter plan delivers exactly as before', () => {
  // The other single-format shape, pinned separately. `flip_phase` cannot edit
  // front matter, so the phase does not flip here and the gate must not read
  // that as the defect — it refuses only where the two disagree.
  const r = deliverPlan(FRONTMATTER_ONLY);

  // Whatever this run does, it must not be the false success #924 describes:
  // either it delivers and the parser agrees, or it refuses and writes nothing.
  if (r.code === 0) {
    assert.equal(r.parsed.phase, 'delivered',
      'the run reported success while the parser still reads a different phase');
  } else {
    assert.equal(r.after, r.before, 'a refused run wrote to the plan');
  }
});
