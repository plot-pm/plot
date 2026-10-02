// A delivery is judged against the last scan that FINISHED, not against the one
// in progress.
//
// Measured 2026-09-30 (#1113): #1109 merged at 18:12Z, `/api/fleet` reported its
// branch `state: merged`, `verdict: complete`, `complete: true`, and `POST
// /api/deliver` answered 409 `scan-incomplete` on 20 of 20 calls, one a minute.
// A scan takes 18 to 37 s on a 5 s cadence, so the live pulse is a fragment for
// most of every minute and a request at a random moment is refused with that
// probability.
//
// **THE SCAN IS PAUSED MID-STREAM, NEVER SIMULATED BY SETTING A FLAG.** A test
// that assigns `entry.pulseComplete = false` skips `publishPartial` — the
// function that overwrites `entry.pulse` with a composed fragment — and so
// cannot catch a `lastComplete` written in the wrong place. Here a fake scan
// emits one plan line, sleeps, and only then emits its terminal line; the
// assertions are taken during that sleep, through the real `refresh`.
//
// **THE CARD IS ASSERTED AS WELL AS THE ROUTE.** The same defect shows on the
// plan card as a Deliver control that flickers, and a fix applied only to
// `deliverability` leaves it. `status === 'deliverable'` is the one word the
// card's affordance, its column bump and its reported status all derive from.
import { afterEach, describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { rmTree } from '../helpers.mjs';
import { buildBoard } from '../../src/server/board.js';
import { deliverability } from '../../src/server/deliver.js';
import {
  buildFleet, lastCompletePulseFor, pulseFor, pulseCompleteFor, stopFleetRefresh,
} from '../../src/server/fleet.js';

/** The real helpers, for the parse `deliverability` makes of a plan FILE. */
const REAL_SCRIPTS = path.resolve(__dirname, '../../../../skills/plot/scripts');

const temps: string[] = [];
afterEach(() => {
  stopFleetRefresh();
  for (const d of temps.splice(0)) rmTree(d);
});

/** One slice's worth of scan output, in the shape `plot-fleet-scan.sh` emits. */
const slice = (
  name: string,
  verdict: 'complete' | 'eligible' | 'blocked',
  branches: Array<[string, 'open' | 'wip' | 'merged' | 'claimed' | 'deferred']>,
) => ({
  name,
  verdict,
  branches: branches.map(([branch, state]) => ({
    branch, state, deferred: state === 'deferred', claimed: '',
    local_dirty: false, local_worktree: '',
  })),
});

const plan = (file: string, slices: ReturnType<typeof slice>[]) =>
  ({ file, phase: 'approved', slices });

const HEAD = { main: 'main', head: 'abc1234', read_ref: 'abc1234', local_head: 'abc1234' };
const planLine = (p: unknown) => JSON.stringify({ kind: 'plan', plan: p });
const pulseLine = (p: unknown) => JSON.stringify({ kind: 'reading', reading: p });

const MERGED_SLUG = 'a-merged-plan';
const MERGED_FILE = `2026-10-01-${MERGED_SLUG}.md`;
const GAINED_SLUG = 'a-plan-that-gained-a-slice';
const GAINED_FILE = `2026-10-01-${GAINED_SLUG}.md`;

/** A plan file the real parser reads: Approved, with the branches named. */
const planFile = (title: string, branches: string[]) => [
  `# ${title}`, '', '## Status', '',
  '- **State:** Approved',
  '- **Type:** bug',
  '', '## Slices', '',
  '### One', '',
  ...branches.map((b) => `- \`${b}\` — a branch`),
  '', '## Changelog', '', '- a plan', '',
].join('\n');

/** The pulse a finished scan reports: both plans, `feature/one` merged. */
const FINISHED = {
  ...HEAD,
  plans: [
    plan(MERGED_FILE, [slice('One', 'complete', [['feature/one', 'merged']])]),
    // `feature/three` is ABSENT, which is what makes the second plan's case.
    plan(GAINED_FILE, [slice('One', 'complete', [['feature/two', 'merged']])]),
  ],
  summary: { plans: 2, waves: 2, branches: 2, claimed: 0, eligible: 0, blocked: 0, deferred: 0 },
};

/**
 * A repository whose scan is fake and whose other helpers are real.
 *
 * The hybrid is the point. `deliverability` parses the plan FILE through
 * `plot-plan-meta.sh` and resolves directories through `plot-config.sh`, so
 * those must be the shipped scripts or the route answers `not-found` for a
 * reason that has nothing to do with the pulse. Only the scan is replaced, and
 * only so that it can be caught mid-stream.
 *
 * **THE SCAN COUNTS ITS OWN RUNS**, because `refresh` re-runs it from the top
 * on every pulse: one script that emitted a finished scan and then a paused one
 * would emit both on every run. The counter file is what makes run 1 the
 * finished scan whose pulse fills `lastComplete`, and run 2 onwards the scan
 * that publishes a fragment and then stops — which is the state every assertion
 * here is taken in.
 *
 * @param secondRun what the scan does from its second run on: `pause` emits one
 *   plan line and sleeps past the assertions, `fail` emits one and exits 1.
 */
function fixture(secondRun: 'pause' | 'fail') {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'plot-lastcomplete-'));
  temps.push(parent);
  const repoRoot = path.join(parent, 'repo');
  const scripts = path.join(parent, 'scripts');
  fs.mkdirSync(path.join(repoRoot, 'docs/plans'), { recursive: true });
  fs.mkdirSync(scripts, { recursive: true });

  fs.writeFileSync(path.join(repoRoot, 'docs/plans', MERGED_FILE),
    planFile('A merged plan', ['feature/one']), 'utf8');
  fs.writeFileSync(path.join(repoRoot, 'docs/plans', GAINED_FILE),
    // TWO branches, and the finished pulse below reports only the first — this
    // plan is the one that gained a slice after the last finished scan.
    planFile('A plan that gained a slice', ['feature/two', 'feature/three']), 'utf8');

  const first = [...FINISHED.plans.map(planLine), pulseLine(FINISHED)]
    .map((l) => `printf '%s\\n' ${JSON.stringify(l)}`).join('\n');
  // One plan line, then either a sleep that outlasts the assertions or a
  // failure. Neither reaches a terminal line, so `pulseComplete` stays false.
  const rest = `printf '%s\\n' ${JSON.stringify(planLine(FINISHED.plans[0]))}\n`
    + (secondRun === 'pause' ? 'sleep 30\n' : 'exit 1\n');

  const scan = path.join(scripts, 'plot-fleet-scan.sh');
  fs.writeFileSync(scan, [
    '#!/usr/bin/env bash',
    `n=$(cat "${path.join(scripts, 'runs')}" 2>/dev/null || echo 0)`,
    `echo $((n + 1)) > "${path.join(scripts, 'runs')}"`,
    'if [ "$n" = "0" ]; then',
    first,
    '  exit 0',
    'fi',
    rest,
  ].join('\n') + '\n');
  fs.chmodSync(scan, 0o755);

  // The real helpers, linked rather than copied so they resolve their own
  // siblings exactly as they do in the checkout.
  for (const helper of fs.readdirSync(REAL_SCRIPTS)) {
    if (helper === 'plot-fleet-scan.sh') continue;
    fs.symlinkSync(path.join(REAL_SCRIPTS, helper), path.join(scripts, helper));
  }

  // A REAL repository: `refresh` asks git as well as the scan, and a bare temp
  // directory makes that call fail into `fleet.error`.
  execFileSync('git', ['init', '--quiet'], { cwd: repoRoot });
  return { repoRoot, scriptsDir: scripts };
}

/**
 * Poll until `want` holds, and THROW when it never does.
 *
 * Throwing rather than returning the last reading, which is the difference
 * between a test that fails and one that asserts against a state it never
 * reached: the scan runs on a 5 s timer, so a poll that gave up quietly would
 * assert `pulseComplete === false` against the stale `true` of a cold cache and
 * report the wrong defect. The named signal is what the failure says.
 */
async function until<T>(
  read: () => T | Promise<T>,
  want: (v: T) => boolean,
  what: string,
  ms = 30_000,
): Promise<T> {
  const stop = Date.now() + ms;
  for (;;) {
    const v = await read();
    if (want(v)) return v;
    if (Date.now() > stop) throw new Error(`timed out waiting for ${what}; last reading: ${JSON.stringify(v)}`);
    await new Promise((r) => setTimeout(r, 25));
  }
}

describe('a delivery is judged against the last scan that finished', () => {
  it('answers deliverable during a scan that has not finished', async () => {
    // TWO scans from one fake: the first finishes and fills `lastComplete`, the
    // second pauses before its terminal line. The assertions are taken in that
    // pause, where `entry.pulse` is a composed fragment and `pulseComplete` is
    // false — exactly the state that refused 20 of 20 calls.
    const opts = fixture('pause');

    // Wait for the FIRST scan to FINISH, read as `lastComplete` filling.
    // `buildFleet().complete` cannot be the signal: it is true on a cold cache,
    // over a null pulse, so a poll on it returns before the scan has run.
    await until(() => lastCompletePulseFor(opts), Boolean, 'the first scan to finish');
    expect(lastCompletePulseFor(opts)).not.toBeNull();

    // Then wait for the pause: the live pulse is a fragment again.
    await until(() => pulseCompleteFor(opts), (c) => c === false, 'the next scan to publish a fragment');
    expect(pulseCompleteFor(opts)).toBe(false);
    // The live pulse is a REAL composition by `publishPartial`, not a flag a
    // test set: the fragment that arrived is merged onto the previous answer, so
    // `entry.pulse` is a DIFFERENT OBJECT from the finished one and is marked
    // incomplete. That object identity is the whole state this file tests in.
    expect(pulseFor(opts)).not.toBe(lastCompletePulseFor(opts));
    // ...and the last finished answer still names every plan that scan reported.
    expect(lastCompletePulseFor(opts)?.plans.map((p) => p.file).sort())
      .toEqual([MERGED_FILE, GAINED_FILE].sort());

    // THE DEFECT'S FIX. Judged against the last finished scan, the plan whose
    // one branch merged is deliverable.
    expect(deliverability(opts, MERGED_SLUG).verdict).toBe('deliverable');
  }, 60_000);

  it('answers scan-incomplete for a plan that gained a slice since that scan', async () => {
    // The case a naive rule fails. `feature/three` is named by the plan file and
    // by no pulse, so the last finished scan judged it never — and reading its
    // absence as landed is what the branch check refuses.
    const opts = fixture('pause');

    await until(() => lastCompletePulseFor(opts), Boolean, 'the first scan to finish');
    await until(() => pulseCompleteFor(opts), (c) => c === false, 'the next scan to publish a fragment');

    expect(deliverability(opts, GAINED_SLUG).verdict).toBe('scan-incomplete');
    // Asserted TOGETHER with the plan beside it, in the same paused state: a
    // rule that refused both, or permitted both, would pass one test alone.
    expect(deliverability(opts, MERGED_SLUG).verdict).toBe('deliverable');
  }, 60_000);

  it('shows the card as deliverable during the paused scan', async () => {
    // The card's half of the same defect — a Deliver control that reads *not
    // deliverable yet* on every pulse. `status` is the one word the affordance,
    // the column bump and the reported status all derive from.
    const opts = fixture('pause');

    await until(() => lastCompletePulseFor(opts), Boolean, 'the first scan to finish');
    await until(() => pulseCompleteFor(opts), (c) => c === false, 'the next scan to publish a fragment');

    // Cards live in columns; this reads every one the render placed.
    const cards = (await buildBoard(opts)).columns.flatMap((col) => col.cards);
    const card = cards.find((c) => c.slug === MERGED_SLUG);
    expect(card).toBeDefined();
    expect(card?.status).toBe('deliverable');
    // The plan that gained a slice is NOT offered, in the same render.
    expect(cards.find((c) => c.slug === GAINED_SLUG)?.status).not.toBe('deliverable');
  }, 60_000);

  it('leaves the last finished pulse unchanged when a scan fails mid-stream', async () => {
    // The guard on *set only on success*. A scan that dies after publishing a
    // fragment must not replace the answer a finished scan left — and a
    // `lastComplete` written in `publishPartial` would do exactly that, while
    // passing every case above.
    const opts = fixture('fail');

    await until(() => lastCompletePulseFor(opts), Boolean, 'the first scan to finish');
    const landed = lastCompletePulseFor(opts);
    expect(landed?.plans.map((p) => p.file)).toEqual([MERGED_FILE, GAINED_FILE]);

    // Wait for the failure to be reported.
    await until(() => buildFleet(opts), (f) => f.error !== null, 'the failed scan to be reported');
    // The failed scan's fragment is on `pulse`...
    expect(pulseCompleteFor(opts)).toBe(false);
    // ...and the last finished answer is the SAME OBJECT it was. Compared by
    // identity, because an equal-looking replacement written by the wrong
    // writer is the defect this asserts against.
    expect(lastCompletePulseFor(opts)).toBe(landed);
    // So a delivery is still judged, rather than refused because a scan failed.
    expect(deliverability(opts, MERGED_SLUG).verdict).toBe('deliverable');
  }, 60_000);
});
