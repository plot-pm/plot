import { describe, it, expect, afterEach } from 'vitest';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { rmTree } from '../helpers.mjs';
import {
  buildFleet, mergePlan, partialSummary, pulseShrink, runStreaming, stopFleetRefresh,
} from '../../src/server/fleet.js';
import { summariseFromPulse } from '../../src/server/board.js';
import { FleetSchema, PlanMetaSchema, type FleetReading } from '../../src/contract/schema.js';

// The measurement this file exists for, taken on this repo 2026-08-19: the
// board refreshes every 5 s and a full scan takes 18.3 s, of which git alone is
// 12.7 s. The wait is therefore STRUCTURAL — no host fix closes it — and the
// only thing that removes it is not waiting for the whole document.
//
// Every assertion below is about WHEN a row appears, never about what it says.
// The last one in the file is the one that keeps that promise honest: a
// completed scan renders identically to a batch one.

/** One wave's worth of scan output, in the shape `plot-fleet-scan.sh --json` emits. */
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

/**
 * A fake scan script that writes the lines it is given, with an optional pause
 * between them, then exits with the code it is given.
 *
 * A SCRIPT rather than a stubbed function, because the seam being tested is the
 * real one: `refresh()` locates the scan by path and reads its stdout through a
 * pipe. A stub returning an array would test a `for` loop and would not notice
 * a chunk boundary falling inside a JSON object, which is the failure this
 * whole mechanism has to survive.
 */
function fakeScan(lines: string[], { exitCode = 0, delayMs = 0 } = {}): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'plot-stream-'));
  const body = lines
    .map((l) => `printf '%s\\n' ${JSON.stringify(l)}\n${delayMs ? `sleep ${delayMs / 1000}\n` : ''}`)
    .join('');
  fs.writeFileSync(path.join(dir, 'plot-fleet-scan.sh'), `#!/usr/bin/env bash\n${body}exit ${exitCode}\n`);
  // The other helpers `refresh()` calls after the scan lands. Each prints
  // nothing and exits 0, so those steps neither fail nor contribute — this file
  // is about the scan, and a missing helper would abort the refresh before the
  // assertions could see it.
  for (const helper of ['plot-plan-meta.sh', 'plot-config.sh']) {
    fs.writeFileSync(path.join(dir, helper), '#!/usr/bin/env bash\nexit 0\n');
  }
  fs.chmodSync(path.join(dir, 'plot-fleet-scan.sh'), 0o755);
  // A REAL REPOSITORY, because `refresh()` asks git as well as the scan.
  //
  // `repoRoot` is this directory, and the refs adapter runs `git for-each-ref`
  // in it. A bare temp directory is not a repository, so that call FAILS and
  // its stderr becomes `fleet.error` — which is what the three assertions on
  // `error` being null are reading. Measured 2026-09-01: `drops a line it
  // cannot parse` failed on CI with `Command failed: git for-each-ref` while
  // passing 18 of 18 locally, so the assertion's outcome depended on whether
  // git lost the race rather than on anything the test is about.
  //
  // `init` alone is enough. The adapter needs a repository to answer in, not
  // any particular ref: an empty `refs/heads` is a valid answer and the scan
  // output is what supplies the plans.
  execFileSync('git', ['init', '--quiet'], { cwd: dir });
  temps.push(dir);
  return dir;
}

const temps: string[] = [];
afterEach(() => {
  stopFleetRefresh();
  for (const d of temps.splice(0)) rmTree(d);
});

const planLine = (p: unknown) => JSON.stringify({ kind: 'plan', plan: p });
const pulseLine = (p: unknown) => JSON.stringify({ kind: 'reading', reading: p });

const HEAD = { main: 'main', head: 'abc1234', read_ref: 'abc1234', local_head: 'abc1234' };

/**
 * Poll `buildFleet` until `want` holds, or give up.
 *
 * The scan runs on a timer and the assertions are about a MOMENT during it, so
 * the test has to look repeatedly rather than await a promise it was never
 * given. Failing by timeout rather than by a fixed sleep keeps it honest on a
 * slow machine — a sleep tuned on this laptop is a flake on CI.
 */
async function until<T>(
  read: () => T | Promise<T>,
  want: (v: T) => boolean,
  ms = 5_000,
): Promise<T> {
  const stop = Date.now() + ms;
  for (;;) {
    // AWAITED, because the reader became async when the read path moved onto
    // the `Refs` port. A predicate handed a Promise reads `undefined` off it
    // and answers false forever, so the poll would time out and return the
    // Promise itself — which is how this surfaced: `f.rows` was undefined
    // rather than empty.
    const v = await read();
    if (want(v)) return v;
    if (Date.now() > stop) return v;
    await new Promise((r) => setTimeout(r, 10));
  }
}

describe('a row renders from plan facts before any git fact exists', () => {
  // THE assertion the branch is named for. `summariseFromPulse` is what a card
  // is built from, and its plan-derived half must stand alone: a pulse that has
  // not reached this plan yet is the same input as no pulse at all.
  const meta = PlanMetaSchema.parse({
    file: '/repo/docs/plans/2026-08-19-streams.md',
    format: 'canonical',
    phase: 'approved',
    waves: [{ name: 'One', branches: [{ branch: 'feature/a' }, { branch: 'feature/b' }] }],
  });

  it('counts waves and branches with no pulse at all', () => {
    const s = summariseFromPulse(meta, null);
    expect(s.slices).toBe(1);
    expect(s.branches).toBe(2);
    // ABSENT, not zero. A count of 0 rendered before anything was counted is a
    // measurement never taken displayed as one that was.
    expect(s.claimed).toBeUndefined();
    expect(s.eligible).toBeUndefined();
  });

  it('counts them the same from a PARTIAL pulse that has not reached this plan', () => {
    // The streaming case, and the reason the rule above had to generalise: this
    // pulse is real, it simply does not mention this plan yet. Rendering that
    // as "0 claimed" would be a fresh, confident, wrong answer — where the
    // cold-cache case at least looked empty.
    const partial: FleetReading = {
      ...HEAD,
      plans: [plan('2026-08-19-something-else.md', [slice('One', 'eligible', [['feature/z', 'open']])])],
      summary: { plans: 1, waves: 1, branches: 1, claimed: 0, eligible: 1, blocked: 0, deferred: 0 },
    };
    const s = summariseFromPulse(meta, partial);
    expect(s.slices).toBe(1);
    expect(s.branches).toBe(2);
    expect(s.claimed).toBeUndefined();
    expect(s.eligible).toBeUndefined();
  });

  it('gains the git counts once the pulse names this plan', () => {
    // The other half of the same rule: once the source HAS arrived, the badge
    // is present — including at zero, which is now a real measurement.
    const arrived: FleetReading = {
      ...HEAD,
      plans: [plan('2026-08-19-streams.md',
        [slice('One', 'eligible', [['feature/a', 'claimed'], ['feature/b', 'open']])])],
      summary: { plans: 1, waves: 1, branches: 2, claimed: 1, eligible: 1, blocked: 0, deferred: 0 },
    };
    const s = summariseFromPulse(meta, arrived);
    expect(s.claimed).toBe(1);
    expect(s.eligible).toBe(1);
  });
});

describe('the board renders plans as they arrive', () => {
  it('serves rows from the plans that have landed while the scan is still running', async () => {
    // The defect in one sentence: the board asked every 5 s for something that
    // took 18 s, so it rendered nothing for the whole scan. Here the scan
    // pauses between plans, and the board is asked mid-flight.
    const scripts = fakeScan([
      planLine(plan('a.md', [slice('One', 'eligible', [['feature/a', 'open']])])),
      planLine(plan('b.md', [slice('One', 'eligible', [['feature/b', 'claimed']])])),
      pulseLine({
        ...HEAD,
        plans: [
          plan('a.md', [slice('One', 'eligible', [['feature/a', 'open']])]),
          plan('b.md', [slice('One', 'eligible', [['feature/b', 'claimed']])]),
        ],
        summary: { plans: 2, waves: 2, branches: 2, claimed: 1, eligible: 1, blocked: 0, deferred: 0 },
      }),
    ], { delayMs: 300 });
    const opts = { repoRoot: scripts, scriptsDir: scripts };

    // The FIRST plan, seen before the second has been written.
    const mid = await until(() => buildFleet(opts), (f) => f.rows.length > 0);
    expect(mid.rows.length).toBeGreaterThan(0);
    // ...and the answer says it is not the whole answer.
    expect(mid.complete).toBe(false);

    const done = await until(() => buildFleet(opts), (f) => f.complete);
    expect(done.complete).toBe(true);
    expect(done.summary.plans).toBe(2);
  });

  it('marks the totals not-yet-arrived while partial, and stops marking them when done', async () => {
    // `complete` is a THIRD state `ready` cannot express: rows exist AND more
    // are coming. The UI hangs "so far" on it, so it has to be false for
    // exactly as long as that is true.
    const scripts = fakeScan([
      planLine(plan('a.md', [slice('One', 'eligible', [['feature/a', 'open']])])),
      pulseLine({
        ...HEAD,
        plans: [plan('a.md', [slice('One', 'eligible', [['feature/a', 'open']])])],
        summary: { plans: 1, waves: 1, branches: 1, claimed: 0, eligible: 1, blocked: 0, deferred: 0 },
      }),
    ], { delayMs: 300 });
    const opts = { repoRoot: scripts, scriptsDir: scripts };

    const mid = await until(() => buildFleet(opts), (f) => f.rows.length > 0);
    expect(mid.complete).toBe(false);
    // The summary a partial answer states is RECOUNTED from what arrived, never
    // carried over: 1 plan, because one plan has arrived.
    expect(mid.summary.plans).toBe(1);

    const done = await until(() => buildFleet(opts), (f) => f.complete);
    expect(done.complete).toBe(true);
  });
});

describe('a scan that fails midway keeps what arrived', () => {
  it('keeps the plans it emitted and says the rest is unknown', async () => {
    // Discarding a partial result throws away facts that were correctly
    // measured. The scan below emits two good plans and then dies.
    const scripts = fakeScan([
      planLine(plan('a.md', [slice('One', 'eligible', [['feature/a', 'open']])])),
      planLine(plan('b.md', [slice('One', 'eligible', [['feature/b', 'claimed']])])),
    ], { exitCode: 1 });
    const opts = { repoRoot: scripts, scriptsDir: scripts };

    const f = await until(() => buildFleet(opts), (x) => x.error !== null);
    // The failure is REPORTED...
    expect(f.error).not.toBeNull();
    // ...the two plans that arrived are KEPT...
    expect(f.summary.plans).toBe(2);
    expect(f.rows.length).toBeGreaterThan(0);
    // ...and the answer does not claim to be whole. A failed scan that had
    // written nothing would report `complete: true` over an empty fleet, which
    // is the shape "keeps what arrived" exists to prevent.
    expect(f.complete).toBe(false);
  });

  it('treats a clean exit with no terminal line as a failure, not an empty fleet', async () => {
    // A scan that exits 0 without its `pulse` line described nothing it can be
    // held to. Reading that as "the fleet is empty" is how a monitoring view
    // becomes untrustworthy — and a closed pipe cannot mean completion,
    // because a killed scan closes it too.
    const scripts = fakeScan([
      planLine(plan('a.md', [slice('One', 'eligible', [['feature/a', 'open']])])),
    ], { exitCode: 0 });
    const opts = { repoRoot: scripts, scriptsDir: scripts };

    const f = await until(() => buildFleet(opts), (x) => x.error !== null);
    expect(f.error).toMatch(/terminal pulse line/);
    expect(f.summary.plans).toBe(1);
    expect(f.complete).toBe(false);
  });

  it('drops a line it cannot parse without losing the plans around it', async () => {
    // One bad line costs one line. Throwing would cost the whole partial
    // answer, including the plans that were correct.
    const scripts = fakeScan([
      planLine(plan('a.md', [slice('One', 'eligible', [['feature/a', 'open']])])),
      'this is not json',
      JSON.stringify({ kind: 'nonsense' }),
      pulseLine({
        ...HEAD,
        plans: [plan('a.md', [slice('One', 'eligible', [['feature/a', 'open']])])],
        summary: { plans: 1, waves: 1, branches: 1, claimed: 0, eligible: 1, blocked: 0, deferred: 0 },
      }),
    ]);
    const opts = { repoRoot: scripts, scriptsDir: scripts };

    const f = await until(() => buildFleet(opts), (x) => x.complete && x.rows.length > 0);
    expect(f.complete).toBe(true);
    expect(f.error).toBeNull();
    expect(f.summary.plans).toBe(1);
  });
});

describe('a completed scan renders identically to a batch one', () => {
  // THE assertion that proves this change is about WHEN rows appear and not
  // about what they say. Both halves come from ONE document, so any drift is a
  // drift in the streaming path rather than in the fixture.
  const plans = [
    plan('a.md', [slice('One', 'complete', [['feature/a', 'merged']]),
      slice('Two', 'eligible', [['feature/b', 'open'], ['feature/c', 'claimed']])]),
    plan('b.md', [slice('One', 'blocked', [['bug/x', 'wip'], ['bug/y', 'deferred']])]),
  ];
  const whole: FleetReading = {
    ...HEAD,
    plans,
    // `host` joined the summary with the throttled-host reading; a fixture
    // written before it compares one key short of what partialSummary states.
    summary: {
      plans: 2, waves: 3, branches: 5, claimed: 1, eligible: 1, blocked: 1, deferred: 1,
      // The two BRANCH counters beside the wave ones. No branch in this fixture
      // carries a `waits:` annotation, so both are 0 — which is also the answer
      // a scan predating the fields gave, and what their schema default states.
      waiting: 0, prereq_missing: 0,
      host: 'unknown',
    },
  };

  it('produces the same rows and the same summary as the whole document', async () => {
    const scripts = fakeScan([...plans.map(planLine), pulseLine(whole)]);
    const opts = { repoRoot: scripts, scriptsDir: scripts };
    const streamed = await until(() => buildFleet(opts), (f) => f.complete && f.rows.length > 0);

    expect(streamed.complete).toBe(true);
    // The summary is the scan's OWN, verbatim — not the recount a partial
    // answer states. A completed scan reports what the scan reported.
    expect(streamed.summary).toEqual(whole.summary);
    // Every branch the document names has a row, and no others.
    expect(streamed.rows.map((r) => r.branch).sort()).toEqual(
      ['bug/x', 'bug/y', 'feature/a', 'feature/b', 'feature/c'],
    );
    // The payload validates as a Fleet — the contract is unchanged by streaming.
    expect(() => FleetSchema.parse(streamed)).not.toThrow();
  });

  it('recounts a partial summary to describe what arrived, not what the scan will find', () => {
    // The partial summary is derived from the plans in hand, so it cannot
    // disagree with them. Asserted directly because it is the one number a
    // streaming board states that a batch board never did.
    expect(partialSummary(plans)).toEqual(whole.summary);
    expect(partialSummary(plans.slice(0, 1))).toEqual({
      plans: 1, waves: 2, branches: 3, claimed: 1, eligible: 1, blocked: 0, deferred: 0,
      waiting: 0, prereq_missing: 0,
      // A partial answer has not asked the host, and `unknown` says exactly that.
      host: 'unknown',
    });
    expect(partialSummary([])).toEqual({
      plans: 0, waves: 0, branches: 0, claimed: 0, eligible: 0, blocked: 0, deferred: 0,
      waiting: 0, prereq_missing: 0,
      host: 'unknown',
    });
  });
});

describe('mergePlan keeps a re-emitted plan idempotent', () => {
  // A scan that names one plan twice must not double a card's wave count. The
  // key is `file`, the same join key every consumer already uses.
  const a = plan('a.md', [slice('One', 'eligible', [['feature/a', 'open']])]);
  const b = plan('b.md', [slice('One', 'eligible', [['feature/b', 'open']])]);

  it('appends a plan it has not seen', () => {
    expect(mergePlan([a], b).map((p) => p.file)).toEqual(['a.md', 'b.md']);
  });

  it('replaces a plan it has seen, in place', () => {
    const a2 = plan('a.md', [slice('One', 'complete', [['feature/a', 'merged']])]);
    const merged = mergePlan([a, b], a2);
    expect(merged.map((p) => p.file)).toEqual(['a.md', 'b.md']);
    expect(merged[0].slices[0].verdict).toBe('complete');
  });
});

describe('runStreaming delivers whole lines', () => {
  it('reassembles a line split across chunk boundaries', async () => {
    // The failure a stubbed reader cannot produce: a chunk boundary falling
    // inside a JSON object. Written in pieces with no newline until the end,
    // so the reader must buffer rather than parse what it was handed.
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'plot-chunk-'));
    temps.push(dir);
    const script = path.join(dir, 'chunky.sh');
    fs.writeFileSync(script,
      '#!/usr/bin/env bash\nprintf \'{"kind":"pl\'\nsleep 0.1\nprintf \'an"}\\n\'\n');
    fs.chmodSync(script, 0o755);

    const lines: string[] = [];
    await runStreaming('bash', [script], dir, (l) => lines.push(l));
    expect(lines).toEqual(['{"kind":"plan"}']);
  });

  it('delivers a trailing fragment written without a final newline', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'plot-tail-'));
    temps.push(dir);
    const script = path.join(dir, 'tail.sh');
    fs.writeFileSync(script, '#!/usr/bin/env bash\nprintf \'{"a":1}\\n{"b":2}\'\n');
    fs.chmodSync(script, 0o755);

    const lines: string[] = [];
    await runStreaming('bash', [script], dir, (l) => lines.push(l));
    expect(lines).toEqual(['{"a":1}', '{"b":2}']);
  });

  it('rejects on a non-zero exit but keeps the lines already delivered', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'plot-fail-'));
    temps.push(dir);
    const script = path.join(dir, 'fail.sh');
    fs.writeFileSync(script, '#!/usr/bin/env bash\nprintf \'{"a":1}\\n\'\nexit 3\n');
    fs.chmodSync(script, 0o755);

    const lines: string[] = [];
    await expect(runStreaming('bash', [script], dir, (l) => lines.push(l))).rejects.toThrow();
    // A rejection means "no more is coming", never "discard what came".
    expect(lines).toEqual(['{"a":1}']);
  });
});

describe('the shrink baseline is the last COMPLETE answer', () => {
  // The property the streaming rewrite could plausibly have broken, and the
  // one that is cheap to get wrong invisibly.
  //
  // `entry.pulse` is now overwritten many times DURING a scan, so comparing a
  // finished scan against it compares the document to a partial view of
  // itself — which has no plan the finished one lacks, so every shrink reports
  // as zero and the tab silently stops flagging losses. `refresh()` therefore
  // holds the last complete answer aside and compares against that.
  //
  // Asserted on `pulseShrink` directly rather than through a second scan: the
  // function is pure, and the bug is entirely in WHICH document is handed to
  // it.
  const two = [
    plan('a.md', [slice('One', 'eligible', [['feature/a', 'open']])]),
    plan('b.md', [slice('One', 'eligible', [['feature/b', 'open']])]),
  ];
  const one = [two[0]];
  const pulseOf = (plans: ReturnType<typeof plan>[]): FleetReading => ({
    ...HEAD, plans, summary: partialSummary(plans),
  });

  it('reports the loss when the complete predecessor is the baseline', () => {
    const shrink = pulseShrink(pulseOf(two), pulseOf(one), 1_000);
    expect(shrink).not.toBeNull();
    expect(shrink?.plans).toEqual(['b.md']);
    expect(shrink?.branches).toEqual(['feature/b']);
  });

  it('reports NOTHING when handed the scan\'s own partial view — the bug', () => {
    // What comparing against `entry.pulse` mid-scan would do: the partial view
    // holds only what has arrived, so the finished document never looks
    // smaller and a real loss goes unflagged.
    expect(pulseShrink(pulseOf(one), pulseOf(one), 1_000)).toBeNull();
  });

  it('is null on a cold start rather than flagging every first scan', () => {
    // Unchanged, and asserted because the streaming path introduced a second
    // way to have no predecessor: a cache whose only pulse so far is partial.
    expect(pulseShrink(null, pulseOf(two), 1_000)).toBeNull();
  });
});
