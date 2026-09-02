import { execFileSync } from 'node:child_process';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { refsGit } from '../src/adapters/refs/refs-git.js';
import { shellContext } from '../src/adapters/scripts.js';
import type { FleetReading } from '../src/entities/fleet.js';
import { isAnswered } from '../src/port-result.js';
import { compareField, describeDisagreement, type Disagreement } from './compare.js';
import { readFleetScan, type Estate } from './production.js';

/**
 * THE CORPUS TIER FOR `Refs`: does the adapter's `Pulse` carry the same
 * readings `plot-fleet-scan.sh` reports, over this repository's real branches?
 *
 * "IDENTICAL" MEANS IDENTICAL READINGS, NOT AN IDENTICAL DOCUMENT, and the
 * difference is by design rather than a weakening. `FleetReadingSchema` is a
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
  // What this branch waits on, read from the plan's `waits:` annotation. Empty
  // for a branch that names no prerequisite, which is most of them.
  'waits_on',
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
  // The two BRANCH counters beside the wave ones. `waiting` counts a branch
  // whose prerequisite has not merged; `prereq_missing` one whose prerequisite
  // the host has never seen a PR for. Separate because the first resolves by
  // waiting and the second by editing the plan.
  'waiting',
  'prereq_missing',
] as const;

const asRecord = (value: unknown): Record<string, unknown> =>
  typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};

const asArray = (value: unknown): Record<string, unknown>[] =>
  Array.isArray(value) ? (value as Record<string, unknown>[]) : [];

/** Reads the wire's slice list under either spelling; the scan still emits `waves`. */
const wireSlices = (plan: Record<string, unknown>): Record<string, unknown>[] =>
  Array.isArray(plan.slices) ? asArray(plan.slices) : asArray(plan.waves);

let pulse: FleetReading;
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
 * The branch `origin/HEAD` is restored to, or `''` where there is no such ref.
 *
 * `origin/HEAD` IS A CLONE'S CONVENIENCE, NOT A GUARANTEE. `actions/checkout`
 * fetches one ref and never creates it, so on a runner this command fails with
 * *"not a symbolic ref"* — and at module level that failed the whole SUITE
 * rather than one test. Measured on CI 2026-09-01, after the pin passed locally
 * every time: a clone has the ref, a checkout does not.
 *
 * `plot-fleet-scan.sh:204` already treats it that way, discarding the error and
 * falling back to `main`. This copies the command's tolerance, not just the
 * command.
 */
const MAIN = (() => {
  try {
    return execFileSync('git', ['symbolic-ref', '--short', 'refs/remotes/origin/HEAD'],
      { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
      .trim().replace(/^origin\//, '');
  } catch {
    // NO `origin/HEAD` IS THE RUNNER'S NORMAL STATE, NOT AN ODD ONE, so falling
    // back to '' here left the pin inert on EVERY CI run — the one environment
    // where the race actually bites, because a runner clones while the estate
    // is being merged into.
    //
    // Measured 2026-09-01 on PR #610, which already carried the branch-tip fix:
    // six disagreements, all one cause. `read_ref` read `e0705bd9` against
    // `4194d300` — two consecutive main commits — `eligible` differed by one,
    // and four branches reported `conflicts: adapter=[] production=[the two
    // board artifacts]`, which is exactly the window in which #608 merged and
    // made them conflict. A working pin makes that impossible by construction.
    //
    // So ask the same question a second way rather than giving up on it. The
    // scan itself falls back to `main` (`plot-fleet-scan.sh:204`), and the
    // remote-tracking refs a checkout DOES have answer it directly.
    for (const guess of ['main', 'master']) {
      try {
        execFileSync('git', ['rev-parse', '--verify', `refs/remotes/origin/${guess}`],
          { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
        return guess;
      } catch {
        // Not this one; try the next.
      }
    }
    return '';
  }
})();
const PIN = 'plot-corpus-pin';
const PIN_REF = `refs/remotes/origin/${PIN}`;
let pinned = false;

const git = (...args: string[]): string =>
  execFileSync('git', args, { cwd: ROOT, encoding: 'utf8' }).trim();

/**
 * Every remote branch's tip, as one map from branch name to SHA.
 *
 * Taken twice — once before either scan and once after both — so the pair says
 * which branches were the SAME COMMIT throughout, and which were two.
 */
const branchTips = (): Map<string, string> => {
  const out = new Map<string, string>();
  for (const line of git('for-each-ref', '--format=%(objectname) %(refname:short)', 'refs/remotes/origin').split('\n')) {
    const at = line.indexOf(' ');
    if (at < 0) continue;
    out.set(line.slice(at + 1).replace(/^origin\//, ''), line.slice(0, at));
  }
  return out;
};

/**
 * The branches whose tip changed while the two scans ran — asked about two
 * commits, so compared for nothing that depends on which.
 *
 * THE PIN ABOVE FREEZES ONE ENDPOINT AND THIS COVERS THE OTHER. Every
 * per-branch reading is taken from `origin/<main>...origin/<branch>`: the pin
 * holds the left side still across both scans, and nothing can hold the right
 * side, because any of this estate's branches may gain a commit at any moment
 * and the two scans each fetch. Measured on CI 2026-09-01: PR #601 pushed its
 * second commit at 16:21:38Z, the corpus job started at 16:21:39Z, and the two
 * scans 36 s apart read that branch at its claim-only tip and then at its real
 * tip — disagreeing on `changed_paths` by exactly the changeset file that
 * landed between them.
 *
 * A MEASUREMENT, NOT AN EXEMPTION, and that distinction is the whole design.
 * Adding `changed_paths` to the live-sample list would stop comparing the one
 * field that carries file paths, on all 53 branches, to excuse the one that
 * moved. This drops only branches proven to have moved, by SHA, and compares
 * every field on every branch that did not — so an adapter that reported the
 * wrong paths still fails here.
 *
 * It is deliberately BLIND TO THE FIELD: a branch that moved was asked about
 * two commits, and every reading derived from the diff is suspect, not just the
 * one that happened to differ. Naming fields here would be guessing which
 * readings a commit can change.
 */
let moved = new Set<string>();

beforeAll(async () => {
  // Freeze the ref before either scan runs, and tell the scan to use it.
  // NO `origin/HEAD` MEANS NO PIN, AND THAT IS NOT A FAILURE. On a checkout
  // that never created the ref there is nothing to repoint and nothing to
  // restore; the two scans then read the branch directly, exactly as they did
  // before this pin existed. The race is a rare disagreement, and refusing to
  // run at all would trade it for never running.
  if (MAIN) {
    const head = git('rev-parse', `origin/${MAIN}`);
    git('update-ref', PIN_REF, head);
    git('symbolic-ref', 'refs/remotes/origin/HEAD', PIN_REF);
    pinned = true;
  }

  // The right-side endpoint, before either scan reads it.
  const tipsBefore = branchTips();

  // Adapter first, production second. The order matters only for the elapsed
  // field, and taking the adapter's reading first makes production's the LATER
  // one — so the tolerance below is one-sided in the direction time runs.
  const refs = refsGit(shellContext(ROOT));
  const read = await refs.pulse();
  if (!isAnswered(read)) throw new Error(`the adapter could not read the pulse: ${read.why}`);
  pulse = read.value;
  raw = readFleetScan(estate);

  // Anything that is not the same commit it was before both scans was asked
  // about two worlds. An added ref counts too: a branch created mid-suite is
  // absent from one reading and present in the other.
  const tipsAfter = branchTips();
  moved = new Set(
    [...new Set([...tipsBefore.keys(), ...tipsAfter.keys()])].filter(
      (name) => tipsBefore.get(name) !== tipsAfter.get(name),
    ),
  );
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
          // A branch that gained a commit mid-suite was read at two tips; every
          // field below derives from a diff against it. See `moved`.
          if (moved.has(branch.branch)) return;
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

  it('pinned the ref, so the two scans were asked about one estate', () => {
    // THE PIN'S FAILURE MODE IS SILENCE, which is why it needs its own
    // assertion. `MAIN` resolving to '' skips the whole pin block, `pinned`
    // stays false, and every test below still runs — against two moments
    // instead of one. Nothing reports it; the suite simply becomes flaky in
    // proportion to how busy the estate is.
    //
    // It was inert on EVERY CI run until 2026-09-01, because `actions/checkout`
    // never creates `origin/HEAD` and the lookup fell back to ''. PR #610
    // measured the cost: six disagreements in one run, all of them main moving
    // between the two scans.
    //
    // Asserted rather than merely logged, because a warning in a green run is
    // a warning nobody reads.
    expect(MAIN).not.toBe('');
    expect(pinned).toBe(true);
    expect(git('symbolic-ref', 'refs/remotes/origin/HEAD')).toBe(PIN_REF);
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

    // AND THE MID-SUITE SKIP MUST STAY A FEW BRANCHES, NEVER THE ESTATE. The
    // field comparison passes over any branch in `moved`, so a `moved` that
    // swallowed everything — an empty tip map, a drifted name normalisation —
    // would leave the comparison green having compared nothing. This is the
    // same floor the assertions above are: it fails loudly rather than passing
    // vacuously. A handful move on a busy estate; a majority means the
    // measurement itself broke.
    const compared = branches.filter((branch) => !moved.has(branch.branch));
    expect(compared.length).toBeGreaterThan(branches.length / 2);
  });
});
