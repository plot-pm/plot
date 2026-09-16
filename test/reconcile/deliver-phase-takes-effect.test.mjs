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

test('a plan holding two phase records is REFUSED rather than falsely delivered', () => {
  const r = deliverPlan(TWO_RECORDS);

  // The run fails, where before it reported success.
  assert.notEqual(r.code, 0, `the delivery should refuse; it exited 0:\n${r.out}`);

  // NOTHING WAS WRITTEN. The check is a dry run before the irreversible step,
  // so a refused run leaves the plan byte-identical — this is what separates
  // the gate from one that refuses after landing the `mv`.
  assert.equal(r.after, r.before,
    'the plan changed on a refused run — the gate fired after the write, not before it');

  // And the parser still reads the phase it read before, because nothing moved
  // — asserted on what `origin/main` holds, which is where a delivery lands.
  assert.equal(r.parsed.phase, 'approved');
});

test('the refusal names BOTH values and the file', () => {
  // A refusal saying only "delivery failed" throws away the half a person acts
  // on: which phase was written, and which one the parser still reads.
  const r = deliverPlan(TWO_RECORDS);

  assert.match(r.out, /delivered/i, 'the refusal does not name the phase that was written');
  assert.match(r.out, /approved/i, 'the refusal does not name the phase the parser reads');
  assert.match(r.out, /2026-01-01-phased\.md/,
    'the refusal does not name the file a person has to fix');
});

test('a second run on an unrepaired file refuses the same way', () => {
  // `decide_transition` answers `write` rather than `already` on this file, so
  // the second run reaches the gate again. It must not slip past — and it must
  // not write, either.
  const r = deliverPlan(TWO_RECORDS);

  assert.notEqual(r.secondCode, 0, `the second run should refuse too:\n${r.second}`);
  assert.equal(r.afterSecond, r.before, 'the second run wrote to the plan');
  assert.match(r.second, /approved/i);
});

test('nothing reaches the remote when the gate fires', () => {
  // The refusal is before the push as well as before the `mv`: a delivery that
  // pushed and then refused would leave the plan delivered on main with a
  // non-zero exit `runAutoDeliver` logs to nobody.
  const r = deliverPlan(TWO_RECORDS);

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
