import { execFileSync } from 'node:child_process';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { refsGit } from '../src/adapters/refs/refs-git.js';
import { shellContext } from '../src/adapters/scripts.js';
import type { FleetPulse } from '../src/entities/fleet.js';
import { isAnswered } from '../src/port-result.js';
import { compareField, describeDisagreement, type Disagreement } from './compare.js';
import { readFleetScan, type Estate } from './production.js';

/**
 * THE CORPUS TIER FOR `Refs`: does the adapter's `Pulse` carry the same
 * readings `plot-fleet-scan.sh` reports, over this repository's real branches?
 *
 * "IDENTICAL" MEANS IDENTICAL READINGS, NOT AN IDENTICAL DOCUMENT, and the
 * difference is by design rather than a weakening. `FleetPulseSchema` is a
 * narrowing, renaming view of the wire: it rewrites `waves` to `slices`,
 * defaults absent fields, and carries a subset of the 21 keys the scan reports
 * per branch. Asserting the parsed pulse deep-equals the raw JSON would fail on
 * the transform the design mandates; asserting only the fields the schema keeps
 * would let a dropped field pass. So this compares field by field under the
 * declared renaming, and separately requires every wire key to be either
 * mapped or written down as uncarried.
 *
 * ON A DISAGREEMENT THE BRANCH STOPS, for the same reason as the plan corpus:
 * the adapter may be wrong, or production may be, and adjusting the adapter to
 * match is the one move forbidden here.
 */

const ROOT = new URL('../../..', import.meta.url).pathname.replace(/\/$/, '');
const estate: Estate = { root: ROOT };

/**
 * TWO FIELDS ARE LIVE SAMPLES, AND A LIVE SAMPLE CANNOT BE COMPARED FOR
 * EQUALITY ACROSS TWO INVOCATIONS.
 *
 * This tier runs the scan twice — once as production, once through the adapter
 * — and every other field agreed byte for byte across those two runs. These two
 * did not, and neither is an adapter/production disagreement: both are readings
 * of a moving world, so the two invocations are asking about two moments.
 *
 * `changed_ago_seconds` is `now` minus a commit time. Measured 2026-08-30: two
 * scans 30 s apart agreed on every verdict, state, claim and branch, and
 * differed on this field by exactly the elapsed time, on all nine branches
 * carrying one. It is compared with a tolerance rather than skipped — an
 * exemption written for a 30-second difference would also hide the field
 * reading zero, or negative, or drifting by an hour.
 *
 * `worker_activity` is a 0.4-second CPU delta over a live process tree
 * (`plot-worker-state.sh:494`, `PLOT_ACTIVITY_INTERVAL`), and it is the harder
 * case: it varies WITHIN a moment rather than with it. Measured 2026-08-30 on
 * this branch — five consecutive scans of the same pid all read `working`,
 * while the two scans inside this suite read `working` then `idle`.
 *
 * THE COMPARISON CAUSES THAT DIFFERENCE, which is what rules it out as a
 * finding. The observed pid was this suite's own worker loop — the process
 * running these tests is a descendant of the process the field describes. Its
 * subtree burns CPU while production's scan runs, because that scan IS its
 * child, and then sits blocked in `execFileSync` while the adapter's scan runs.
 * No adapter change could stabilise it and no production change should: the
 * field correctly reports a quantity that is genuinely varying.
 *
 * So both are compared for what does not move — the field's presence and its
 * declared domain — and never for equality between two invocations. The state
 * they qualify (`worker`) is NOT exempt and is compared exactly, along with
 * every other branch field.
 */

/**
 * How far the two scans' elapsed readings may differ.
 *
 * Generous against a saturated CI runner and still far below any wrong answer:
 * the two scans run back to back, and what this catches is a field that stopped
 * tracking the clock at all.
 */
const ELAPSED_TOLERANCE_SECONDS = 900;

/** The field whose value is a clock reading; compared with a tolerance. */
const ELAPSED_FIELD = 'changed_ago_seconds';

/**
 * The field sampled from a live process tree; compared for domain, not value.
 *
 * `WorkerActivitySchema`'s three members. A reading outside them is a real
 * failure — this exemption is about which of the three, never about whether the
 * field means anything.
 */
const ACTIVITY_FIELD = 'worker_activity';
const ACTIVITY_VALUES = ['working', 'idle', ''];

/**
 * The wire keys the schema deliberately does not carry, top level and per
 * branch.
 *
 * Named rather than ignored, for the reason the plan corpus names its own: a
 * port narrower than the wire on purpose and an adapter that forgot a field are
 * indistinguishable from inside the adapter.
 *
 * `host` joins `merge_detect` for the same reason `fetch_failed` and
 * `fetch_error` sit here: it describes **how reliable this reading is**, not
 * what was counted. Every field the port does carry is a count or a state the
 * estate has; these say whether the estate could be asked at all. No consumer
 * reads it today, and carrying a field nothing reads would be speculative — the
 * gate exists so that adding one later is a decision somebody makes.
 */
const UNCARRIED_TOP = ['fetch_failed', 'fetch_error', 'plan_source'];
const UNCARRIED_SUMMARY = ['merge_detect', 'host'];

/** The branch fields `SourceBranchSchema` declares, beside their wire spelling. */
const BRANCH_FIELDS = [
  'branch',
  'state',
  'deferred',
  'deferred_reason',
  'claimed',
  'local_dirty',
  'local_worktree',
  'local_ahead',
  'local_locked',
  'held',
  'ref_held',
  'conflicts',
  'conflicts_known',
  'changed_at',
  'changed_paths',
  'worker',
  'worker_pid',
  'worker_exit',
  'worker_dirty_paths',
] as const;

/** The counters `summary` carries. */
const SUMMARY_FIELDS = [
  'plans',
  'waves',
  'branches',
  'claimed',
  'eligible',
  'blocked',
  'deferred',
] as const;

const asRecord = (value: unknown): Record<string, unknown> =>
  typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};

const asArray = (value: unknown): Record<string, unknown>[] =>
  Array.isArray(value) ? (value as Record<string, unknown>[]) : [];

/** Reads the wire's slice list under either spelling; the scan still emits `waves`. */
const wireSlices = (plan: Record<string, unknown>): Record<string, unknown>[] =>
  Array.isArray(plan.slices) ? asArray(plan.slices) : asArray(plan.waves);

let pulse: FleetPulse;
let raw: Record<string, unknown>;

/**
 * A frozen ref both readings resolve, so they are asked about ONE estate.
 *
 * THE TWO SCANS EACH FETCH, so `origin/main` can move between them — and this
 * suite runs them back to back. Measured twice: 2026-08-31 the `conflicts`
 * field disagreed because a six-commit burst touching the `-merge` board
 * artifacts landed mid-suite, and 2026-09-01 `read_ref` itself reported
 * `adapter="cf937747" production="f55402a3"` — two consecutive main commits,
 * pushed minutes apart. Neither reading was wrong; they were asked about two
 * moments.
 *
 * `--no-fetch` on the second reading is NOT the fix and was tried: it does not
 * pin the two to one world, it gives them DIFFERENT worlds — production then
 * reads stale local refs and reports `open` where the adapter reads `merged`.
 * One failure became three (2026-08-31, reverted).
 *
 * So both still fetch, and both are pointed at a ref a fetch cannot move. The
 * pin is a real remote-tracking ref at a SHA resolved once here; nothing
 * upstream is named `plot-corpus-pin`, so `git fetch` leaves it alone. The
 * scan takes its branch from `origin/HEAD` when no `Main branch` key is set
 * (`plot-fleet-scan.sh` line 202), and the adapter's `pulse()` shells out to
 * that same script — so repointing that ONE symbolic ref serves both readings.
 *
 * `origin/HEAD` rather than the config key, deliberately: the key lives in the
 * repo-root `CLAUDE.md`, and editing a TRACKED file for the duration of a test
 * run would leave the repository misconfigured if the run died. `origin/HEAD`
 * is per-checkout, untracked, and restored in `afterAll` — and a fetch does not
 * move either it or the pin.
 */
/**
 * The branch `origin/HEAD` is restored to. Read before the pin replaces it.
 *
 * NOT `symbolic-ref`, WHICH THROWS ON A CHECKOUT THAT DOES NOT OWN ONE.
 * `origin/HEAD` is symbolic in a `git clone` and DIRECT in a checkout that
 * built its remote refs another way — `actions/checkout` among them, measured
 * 2026-09-01: `fatal: ref refs/remotes/origin/HEAD is not a symbolic ref`,
 * thrown at MODULE SCOPE, so the whole file reported `0 test` and the corpus
 * job failed with nothing to point at.
 *
 * It passed locally for the same reason it failed in CI: this working copy is a
 * clone and has a symbolic `origin/HEAD`. A reading whose answer depends on how
 * the checkout was created has to tolerate both shapes.
 *
 * So the value is READ WITHOUT ASSUMING the shape, and its absence is not
 * fatal: `main` is the fallback, and `afterAll` restores whatever was found.
 * The restoration is best-effort by design — a test that cannot repair a ref it
 * never successfully read should still run.
 */
const readOriginHead = (): string => {
  try {
    return execFileSync('git', ['symbolic-ref', '--short', 'refs/remotes/origin/HEAD'], {
      cwd: ROOT,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    })
      .trim()
      .replace(/^origin\//, '');
  } catch {
    return '';
  }
};
const MAIN = readOriginHead() || 'main';
const PIN = 'plot-corpus-pin';
const PIN_REF = `refs/remotes/origin/${PIN}`;
let pinned = false;

const git = (...args: string[]): string =>
  execFileSync('git', args, { cwd: ROOT, encoding: 'utf8' }).trim();

beforeAll(async () => {
  // Freeze the ref before either scan runs, and tell the scan to use it.
  const head = git('rev-parse', 'origin/HEAD');
  git('update-ref', PIN_REF, head);
  git('symbolic-ref', 'refs/remotes/origin/HEAD', PIN_REF);
  pinned = true;

  // Adapter first, production second. The order matters only for the elapsed
  // field, and taking the adapter's reading first makes production's the LATER
  // one — so the tolerance below is one-sided in the direction time runs.
  const refs = refsGit(shellContext(ROOT));
  const read = await refs.pulse();
  if (!isAnswered(read)) throw new Error(`the adapter could not read the pulse: ${read.why}`);
  pulse = read.value;
  raw = readFleetScan(estate);
});

afterAll(() => {
  // The pin is this suite's, and it must not outlive it: a stray
  // `origin/plot-corpus-pin` would show up in every later `for-each-ref`.
  if (pinned) {
    try {
      git('symbolic-ref', 'refs/remotes/origin/HEAD', `refs/remotes/origin/${MAIN}`);
      git('update-ref', '-d', PIN_REF);
    } catch {
      // Already gone. Nothing downstream reads it, so there is nothing to repair.
    }
  }
});

describe('the Refs adapter agrees with plot-fleet-scan.sh', () => {
  it('reads a pulse worth comparing', () => {
    // The floor again: every comparison below is universally quantified.
    expect(pulse.plans.length).toBeGreaterThan(0);
    expect(pulse.plans.length).toBe(asArray(raw.plans).length);
    expect(pulse.plans.some((plan) => plan.slices.length > 0)).toBe(true);
    expect(pulse.plans.some((plan) => plan.slices.some((slice) => slice.branches.length > 0))).toBe(true);
  });

  it('reports the same head, ref and default branch', () => {
    const found: Disagreement[] = [];
    compareField(found, 'pulse', 'main', pulse.main, raw.main);
    compareField(found, 'pulse', 'head', pulse.head, raw.head);
    compareField(found, 'pulse', 'read_ref', pulse.read_ref, raw.read_ref);
    compareField(found, 'pulse', 'local_head', pulse.local_head, raw.local_head);
    expect(found.map(describeDisagreement)).toEqual([]);
  });

  it('reports the same summary counters', () => {
    const found: Disagreement[] = [];
    const theirs = asRecord(raw.summary);
    for (const field of SUMMARY_FIELDS) {
      compareField(found, 'pulse.summary', field, pulse.summary[field], theirs[field]);
    }
    expect(found.map(describeDisagreement)).toEqual([]);
  });

  it('reports the same plans, slices and branches, field for field', () => {
    const found: Disagreement[] = [];
    const theirPlans = asArray(raw.plans);
    pulse.plans.forEach((plan, index) => {
      const wire = theirPlans[index] ?? {};
      compareField(found, plan.file, 'file', plan.file, wire.file);
      compareField(found, plan.file, 'phase', plan.phase, wire.phase);

      const wireSliceList = wireSlices(wire);
      compareField(found, plan.file, 'slices.length', plan.slices.length, wireSliceList.length);

      plan.slices.forEach((slice, at) => {
        const theirSlice = wireSliceList[at] ?? {};
        const where = `${plan.file} slice[${at}]`;
        compareField(found, where, 'name', slice.name, theirSlice.name);
        compareField(found, where, 'verdict', slice.verdict, theirSlice.verdict);

        const theirBranches = asArray(theirSlice.branches);
        compareField(found, where, 'branches.length', slice.branches.length, theirBranches.length);

        slice.branches.forEach((branch, position) => {
          const theirBranch = theirBranches[position] ?? {};
          const subject = `${where}.branch[${position}] ${branch.branch}`;
          for (const field of BRANCH_FIELDS) {
            compareField(
              found,
              subject,
              field,
              (branch as unknown as Record<string, unknown>)[field],
              theirBranch[field],
            );
          }
        });
      });
    });
    expect(found.map(describeDisagreement)).toEqual([]);
  });

  it('tracks the clock, and stays inside the enum, on the two live samples', () => {
    // Neither is compared for equality — see the live-sample note above. What
    // this catches is a field that stopped meaning anything: an elapsed count
    // that no longer tracks the clock, or an activity cue outside its enum.
    const theirPlans = asArray(raw.plans);
    const offenders: string[] = [];
    let compared = 0;

    pulse.plans.forEach((plan, index) => {
      const wireSliceList = wireSlices(theirPlans[index] ?? {});
      plan.slices.forEach((slice, at) => {
        const theirBranches = asArray(asRecord(wireSliceList[at]).branches);
        slice.branches.forEach((branch, position) => {
          const mine = branch as unknown as Record<string, unknown>;
          const wire = theirBranches[position] ?? {};

          // The activity cue: both sides must be inside the enum, on every
          // branch that carries one. Which of the three is not comparable.
          for (const [side, value] of [['adapter', mine[ACTIVITY_FIELD]], ['production', wire[ACTIVITY_FIELD]]] as const) {
            if (value !== undefined && !ACTIVITY_VALUES.includes(value as string)) {
              offenders.push(
                `${plan.file} ${branch.branch}: ${side} activity outside the enum — ${JSON.stringify(value)}`,
              );
            }
          }

          const theirs = wire[ELAPSED_FIELD];
          const ours = mine[ELAPSED_FIELD];
          if (typeof theirs !== 'number' || typeof ours !== 'number') return;
          compared += 1;
          const drift = Math.abs(ours - theirs);
          if (drift > ELAPSED_TOLERANCE_SECONDS) {
            offenders.push(
              `${plan.file} ${branch.branch}: adapter=${ours} production=${theirs} drift=${drift}s`,
            );
          }
          // THE LATER READING MUST BE THE LARGER ONE, and which reading is later
          // is now a property of this file rather than an assumption: the pin in
          // `beforeAll` runs the adapter FIRST so the frozen ref is in place
          // before either scan, which makes PRODUCTION the later of the two.
          //
          // Asserted against the order rather than hardcoding a side. This used
          // to read `ours < theirs - 1` beside a comment saying "the adapter's
          // scan runs SECOND"; when the pin swapped that order the assertion
          // reported every branch as running backwards while the field was
          // correct — measured 2026-09-01, adapter=1830 production=1862 on
          // three branches at once.
          if (theirs < ours - 1) {
            offenders.push(
              `${plan.file} ${branch.branch}: elapsed ran backwards — the later reading is smaller: adapter=${ours} production=${theirs}`,
            );
          }
        });
      });
    });

    expect(offenders).toEqual([]);

    // WHETHER THIS WAS EXERCISED IS A PROPERTY OF THE ESTATE, NOT OF THE CODE.
    // `changed_ago_seconds` is only carried by a branch the scan could inspect a
    // worktree for. Measured 2026-08-30: 9 of 42 branches here, and ZERO on a CI
    // runner, which clones one ref and has no worktrees at all — so an
    // unconditional `toBeGreaterThan(0)` failed there while passing locally.
    //
    // The assertion is still worth making, because a comparison that silently
    // compares nothing is the vacuous pass this corpus tier exists to prevent.
    // So it is made where it can hold: if the estate carries the field at all,
    // at least one pair must have been compared. If the estate carries none,
    // there was nothing to compare and saying so is the honest answer.
    const carriesTheField = pulse.plans.some((plan) =>
      plan.slices.some((slice) =>
        slice.branches.some(
          (branch) =>
            typeof (branch as unknown as Record<string, unknown>)[ELAPSED_FIELD] === 'number',
        ),
      ),
    );
    if (carriesTheField) expect(compared).toBeGreaterThan(0);
  });

  it('names every wire field, so a new one arrives as a question', () => {
    // The direction the adapter cannot fail by itself: a field production
    // reports that the schema never carried is invisible to every comparison
    // above. Every key is mapped or written down; a key on neither list fails,
    // and the fix is a decision rather than a rename.
    const unexpected = new Set<string>();

    const topMapped = new Set(['main', 'head', 'read_ref', 'local_head', 'plans', 'summary']);
    for (const key of Object.keys(raw)) {
      if (!topMapped.has(key) && !UNCARRIED_TOP.includes(key)) unexpected.add(`pulse.${key}`);
    }

    const summaryMapped = new Set<string>(SUMMARY_FIELDS);
    for (const key of Object.keys(asRecord(raw.summary))) {
      if (!summaryMapped.has(key) && !UNCARRIED_SUMMARY.includes(key)) {
        unexpected.add(`summary.${key}`);
      }
    }

    const planMapped = new Set(['file', 'phase', 'slices', 'waves']);
    const sliceMapped = new Set(['name', 'verdict', 'branches']);
    const branchMapped = new Set<string>([...BRANCH_FIELDS, ELAPSED_FIELD, ACTIVITY_FIELD]);

    for (const plan of asArray(raw.plans)) {
      for (const key of Object.keys(plan)) {
        if (!planMapped.has(key)) unexpected.add(`plan.${key}`);
      }
      for (const slice of wireSlices(plan)) {
        for (const key of Object.keys(slice)) {
          if (!sliceMapped.has(key)) unexpected.add(`slice.${key}`);
        }
        for (const branch of asArray(slice.branches)) {
          for (const key of Object.keys(branch)) {
            if (!branchMapped.has(key)) unexpected.add(`branch.${key}`);
          }
        }
      }
    }

    expect([...unexpected].sort()).toEqual([]);
  });

  it('carries the readings the estate actually populates, so this is not vacuous', () => {
    // Every comparison above passes if both sides read the same emptiness.
    const branches = pulse.plans.flatMap((plan) => plan.slices.flatMap((slice) => slice.branches));
    expect(branches.length).toBeGreaterThan(0);
    expect(new Set(branches.map((branch) => branch.state)).size).toBeGreaterThan(1);
    expect(new Set(pulse.plans.flatMap((plan) => plan.slices.map((slice) => slice.verdict))).size)
      .toBeGreaterThan(1);
    expect(pulse.summary.branches).toBeGreaterThan(0);
    // The legacy spelling is what the scan emits, so the schema's rename is
    // load-bearing rather than defensive.
    expect(asArray(raw.plans).some((plan) => Array.isArray(plan.waves))).toBe(true);
  });
});
