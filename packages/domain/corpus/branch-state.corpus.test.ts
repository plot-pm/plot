import { beforeAll, describe, expect, it } from 'vitest';

import { FleetReadingSchema, type FleetReading } from '../src/entities/fleet.js';
import {
  branchState,
  type BranchReadings,
  type HostReach,
  type PrReading,
} from '../src/rules/branch-state.js';
import { describeDisagreement, type Disagreement } from './compare.js';
import {
  readCommitsBeyond,
  readFleetScan,
  readMainBranch,
  readMergeSubjects,
  readPrList,
  readRemoteRefs,
  type Estate,
  type PrRow,
} from './production.js';

/**
 * THE CORPUS TIER FOR BRANCH STATE: does the domain rule reproduce what the
 * shell answers for every branch on the estate?
 *
 * **Round 3 of the plan's interrogation set this bar and it is the gate.**
 * `branch_state()` is 183 lines with ten call sites in a 4,194-line script, the
 * board groups every section by its output, and every dispatch and reap
 * consults it. So the move is VERIFIED rather than reviewed: a disagreement
 * here is either a bug in the new rule or a defect in the old one, and this is
 * what makes that visible instead of arguable.
 *
 * ## What is compared against what
 *
 * | | reads | answers with |
 * |---|---|---|
 * | **production** | `plot-fleet-scan.sh --json` | the `state` on every branch of every plan |
 * | **the rule** | git refs, the merge walk, one `pr-list`, the plan's own annotations | `branchState(readings)` |
 *
 * The readings are taken HERE, from the same sources the scan reads, and never
 * from the scan's own output — a comparison fed by the answer it is checking
 * agrees by construction. The one thing taken from the pulse is what only the
 * plan can say: `deferred` and `waits_on`, which are the plan's statements
 * rather than measurements, and which `plot-plan-meta.sh` is the contract for.
 *
 * ## The asymmetry the corpus must respect
 *
 * `deferred` is applied at the CALL SITE (`plot-fleet-scan.sh:3454`), outside
 * `branch_state()`. So this records what the CALLER answers, not what the
 * function returns — otherwise it certifies a derivation that is correct and
 * still wrong in place. The same holds for the prerequisite override at `:3466`.
 *
 * ## What it deliberately does not assert
 *
 * **Not that the scan's `--json` is byte-identical.** The plan dropped that:
 * `pr-list` and `pr-state` make the scan host-dependent, so two runs of the
 * same code differ when the host throttles between them, and the failure looks
 * exactly like a regression. This compares one derivation against another over
 * ONE set of readings, and reports the host's reach as a fact rather than
 * assuming it.
 *
 * ## On a disagreement: stop, do not adjust
 *
 * Which side is wrong is judgement. Every failure prints the branch, the field
 * and both readings.
 */

const ROOT = new URL('../../..', import.meta.url).pathname.replace(/\/$/, '');
const estate: Estate = { root: ROOT };

/**
 * The default branch, resolved the way the scan resolves it.
 *
 * The scan does not report it in `--json`, so it is re-derived rather than
 * read back — and re-derived through the same three steps rather than assumed
 * to be `main`, which would make every comparison below vacuous in a repository
 * that calls it something else.
 */
let mainBranch: string;

let pulse: FleetReading;
let refs: Map<string, string>;
let mergeSubjects: string[];
let prList: { arrived: boolean; complete: boolean; rows: PrRow[] };

/**
 * The one PR state per branch, ranked the way `prefill_pr_states` ranks it.
 *
 * A branch may carry several pull requests — the fleet opens duplicates, and
 * `changeset-release/main` is merged repeatedly and reused. The scan sorts
 * `OPEN` first, `MERGED` second, everything else third, and keeps the first row
 * per branch. Reproduced rather than simplified: taking the newest row instead
 * reports three branches unlanded whose work is on main, each masked by a
 * duplicate the fleet opened itself.
 */
const RANK: Readonly<Record<string, number>> = { OPEN: 1, MERGED: 2 };

const rankOf = (state: string): number => RANK[state] ?? 3;

const bestPrPerBranch = (rows: readonly PrRow[]): Map<string, string> => {
  const best = new Map<string, string>();
  for (const row of rows) {
    const held = best.get(row.head);
    if (held === undefined || rankOf(row.state) < rankOf(held)) best.set(row.head, row.state);
  }
  return best;
};

let prByBranch: Map<string, string>;

/**
 * How far the host got, as `HOST_VERDICT` records it.
 *
 * Three of the five values are unreachable from here without breaking the host
 * on purpose: this run either got the list or did not. `unasked` is the honest
 * word for a list that never arrived in a checkout with credentials — the
 * failures are named separately in the shell from stderr text this oracle does
 * not read — so a failed list makes the whole comparison refuse rather than
 * quietly compare against a guess. See the vacuity guard below.
 */
const hostReach = (): HostReach => (prList.arrived ? 'ok' : 'failed');

/**
 * What the host said about ONE branch's pull request.
 *
 * The scan's `host_pr_state` join, with its two absences kept apart:
 *
 * - a branch the COMPLETE list omits has no pull request — `none`, real
 *   evidence, and the reason the scan stopped spending a round trip per branch
 *   to re-learn it;
 * - a branch omitted from a list that did not arrive, or arrived truncated, was
 *   never answered for — `unreadable`.
 *
 * @param branch - the branch to look up.
 * @returns the reading, in the rule's own vocabulary.
 */
const prFor = (branch: string): PrReading => {
  const held = prByBranch.get(branch);
  if (held === 'OPEN' || held === 'MERGED' || held === 'CLOSED') return held;
  if (held !== undefined) return 'unreadable';
  return prList.complete ? 'none' : 'unreadable';
};

/**
 * Whether the default branch carries a conforming merge commit naming a branch.
 *
 * `merged_by_subject()`, with the same escaping problem answered the same way:
 * a branch name may hold `+`, `.` or `(`, and an unescaped pattern makes
 * `feature/v.1` match `feature/vX1` while `bug/a+b` fails to match its own
 * subject. Compared as a STRING here rather than as a pattern, which cannot
 * have that fault at all.
 *
 * @param branch - the branch to look for.
 * @returns true when a conforming subject names it.
 */
const mergeSubjectNames = (branch: string): boolean =>
  mergeSubjects.some((subject) => {
    const match = /^Merge pull request #\d+ from ([^/]+)\/(.+)$/.exec(subject);
    return match !== null && match[2] === branch;
  });

/**
 * Everything read of one branch, assembled from the sources the scan reads.
 *
 * @param branch - the branch as the plan names it.
 * @param deferredByPlan - the plan's `deferred:` annotation.
 * @param waitsOn - the plan's `waits:` annotation, or `''`.
 * @returns the readings the rule takes.
 */
const readingsFor = (
  branch: string,
  deferredByPlan: boolean,
  waitsOn: string,
): BranchReadings => {
  const refTip = refs.get(branch) ?? null;
  const mainTip = refs.get(mainBranch) ?? null;
  const counts =
    refTip !== null && mainTip !== null
      ? readCommitsBeyond(estate, mainTip, refTip)
      : { total: 0, real: 0 };
  return {
    deferredByPlan,
    refTip,
    mainTip,
    mergeSubjectFound: refTip === null && mergeSubjectNames(branch),
    hostReach: hostReach(),
    pr: prFor(branch),
    commitsAhead: counts.total,
    realCommitsAhead: counts.real,
    waits: waitsOn === '' ? null : { branch: waitsOn, pr: prFor(waitsOn) },
  };
};

beforeAll(() => {
  pulse = FleetReadingSchema.parse(readFleetScan(estate));
  mainBranch = readMainBranch(estate);
  refs = readRemoteRefs(estate);
  mergeSubjects = readMergeSubjects(estate, mainBranch);
  prList = readPrList(estate);
  prByBranch = bestPrPerBranch(prList.rows);
});

describe('the estate is really being read', () => {
  it('parses a pulse with branches in it', () => {
    // THE VACUITY GUARD, first, because every assertion below is over these
    // collections. A scan that failed to read the estate reports zero plans and
    // every comparison then passes having compared nothing.
    //
    // `> 0` AND NOT A FLOOR. `eligible.corpus.test.ts` has paid twice for a
    // higher number: a wave count is the backlog, it falls when work ships, and
    // a floor above zero fails every open pull request the day five plans
    // deliver. Whether a case was exercised is a property of the estate, not of
    // the code.
    expect(pulse.summary.branches).toBeGreaterThan(0);
  });

  it('resolved the default branch', () => {
    expect(mainBranch).not.toBe('');
    expect(refs.has(mainBranch)).toBe(true);
  });

  it('got an answer from the host', () => {
    // NOT AN ASSERTION ABOUT THE HOST'S MOOD — it is what makes the comparison
    // below mean anything. With no list, every branch reads `unreadable` on BOTH
    // sides and the states agree by shared ignorance: the run would pass having
    // proven that two things which cannot see agree about what they cannot see.
    //
    // The scan's own reading is compared against this oracle's, so a host that
    // failed for one and answered for the other is caught here rather than
    // reported as ~48 disagreements about branches.
    expect(prList.arrived).toBe(true);
    expect(pulse.summary.host).toBe('ok');
  });
});

describe('the rule reproduces the shell for every branch on the estate', () => {
  it('derives the same state the scan reports', () => {
    const found: Disagreement[] = [];
    let compared = 0;

    for (const plan of pulse.plans) {
      for (const slice of plan.slices) {
        for (const branch of slice.branches) {
          compared += 1;
          const derived = branchState(
            readingsFor(branch.branch, branch.deferred, branch.waits_on),
          );
          if (derived !== branch.state) {
            found.push({
              subject: `${plan.file} :: ${branch.branch}`,
              field: 'state',
              adapter: derived,
              production: branch.state,
            });
          }
        }
      }
    }

    // COUNTED, NOT ASSUMED. The two numbers come from different places — one
    // from walking the plans, one from the scan's own footer — so a walk that
    // silently visited fewer branches than the scan reported fails here rather
    // than passing over a shorter list.
    expect(compared).toBe(pulse.summary.branches);
    expect(compared).toBeGreaterThan(0);
    expect(found.map(describeDisagreement)).toEqual([]);
  });

  it('names which states the estate actually exercised', () => {
    // A REPORT, NOT A THRESHOLD, AND THE HONEST SCOPE OF A GREEN RUN.
    //
    // MEASURED BY MUTATION, 2026-09-06, because a passing comparison says
    // nothing about which arms it reached. Four single-line breaks were applied
    // to the rule and this file re-run:
    //
    //   | break | corpus |
    //   |---|---|
    //   | the resurrected-ref host override removed | FAILS, names the branch |
    //   | the `deferred:` precedence removed | FAILS, names the branch |
    //   | the merge-subject lookup inverted | PASSES — never reached |
    //   | the claim-marker count inverted | PASSES — never reached |
    //
    // So the estate reaches the ref arm, the work/merged split and the plan's
    // statement, and reaches neither the no-ref merge-subject lookup nor the
    // claim count: every merged branch here still carries a ref, and no branch
    // is claimed at the moment the scan runs. THE UNIT TESTS ARE WHAT COVER
    // THOSE, from readings they supply, and this report is what stops a green
    // corpus being read as more than it is.
    //
    // The distribution is printed rather than asserted for the reason
    // `eligible.corpus.test.ts` states twice over: whether a case was exercised
    // is a property of the estate, not of the code, and a threshold on it fails
    // every open pull request the day the estate changes shape.
    const seen = new Map<string, number>();
    for (const plan of pulse.plans) {
      for (const slice of plan.slices) {
        for (const branch of slice.branches) {
          seen.set(branch.state, (seen.get(branch.state) ?? 0) + 1);
        }
      }
    }
    const report = [...seen.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([state, count]) => `${state}=${count}`)
      .join(' ');
    // eslint-disable-next-line no-console
    console.log(`branch states exercised against production: ${report}`);
    expect(seen.size).toBeGreaterThan(0);
  });
});
