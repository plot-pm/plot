import type { BranchState, SliceVerdict } from '../entities/fleet.js';
import { failed, isAnswered, answered, type PortResult } from '../port-result.js';
import { branchState, withPlanLandings } from '../rules/branch-state.js';
import { isClaimable, sliceVerdicts, type SliceReadings } from '../rules/eligible.js';
import { spikeSliceOf } from '../rules/spike.js';
import { nextWork, type SliceOutlookReading } from '../rules/waiting.js';
import type { PlanRecord } from '../ports/plan-store.js';
import type { BranchReading, BranchStageReadings, PrDetail } from './plan-walk-branches.js';
import type { DeskReading, DeskStageReadings } from './plan-walk-desks.js';
import type { Estate } from './plan-walk-estate.js';

/** The wire key the shell scan still emits for the per-plan slice list; the name belongs to that foreign process. */
const WAVES_KEY = 'waves';

/** The phases the scan lists only for a full pulse, never for an offer. */
const TERMINAL_PHASES: ReadonlySet<string> = new Set(['delivered', 'released', 'rejected', 'superseded']);

/** The phases whose plans leave the pulse entirely. */
const LEFT_PHASES: ReadonlySet<string> = new Set(['released', 'rejected', 'superseded']);

/** The answer of a stage that may have failed; the three stages the walk assembles. */
export interface WalkStages {
  /** The estate stage's answer. */
  estate: PortResult<Estate>;
  /** The branch stage's answer. */
  branches: PortResult<BranchStageReadings>;
  /** The desk stage's answer. */
  desks: PortResult<DeskStageReadings>;
}

/** What the caller asks of the walk; the same words as the scan's flags. */
export interface AssemblyInput {
  /** A plan slug to scan that plan alone, or `''` for the whole estate. */
  slug: string;
  /**
   * Whether the walk answers an offer (`--next`, `--list-eligible`,
   * `--why-nothing`): a plan in a terminal phase is then left out unless a slug
   * names it.
   */
  offer: boolean;
  /**
   * The `--loose` input. Where present, a branch in state `wip` whose PR is
   * open, not a draft and green counts as settled for its slice, and a branch
   * whose readiness could not be read is listed in its slice's
   * `looseDegraded`. `verifiable` is false where no host could be asked, and
   * every `wip` branch then counts as outstanding without a degraded note.
   */
  loose?: { verifiable: boolean };
}

/** One branch of one slice, with the state the rules decided for it. */
export interface AssembledBranch {
  /** The branch as the plan names it. */
  branch: string;
  /** The state after the plan's own landings and prerequisites. */
  state: BranchState;
  /** The state before any prerequisite is applied. */
  ownState: BranchState;
  /** Whether the plan defers the branch. */
  deferred: boolean;
  /** The deferral reason; `''` where none. */
  deferredReason: string;
  /** The branches the slice line waits on. */
  waitsOn: readonly string[];
  /** The claim note on the slice line; `''` where none. */
  claimed: string;
  /** Whether {@link isClaimable} admits the branch under its slice's verdict. */
  claimable: boolean;
  /** Whether the host's PR list, rather than the merge subject alone, confirms a merge. */
  hostConfirmed: boolean;
  /** Whether a merge subject proved the merge. */
  bySubject: boolean;
  /** The desk reading for the branch; `null` where no worktree here holds it. */
  desk: DeskReading | null;
  /** Whether the remote holds a ref for the branch. */
  refHeld: boolean;
  /** Paths the branch changed against the default branch. */
  changedPaths: readonly string[];
}

/** One slice with its verdict. */
export interface AssembledSlice {
  /** The slice's heading; `''` where unnamed. */
  name: string;
  /** The verdict the rules decided. */
  verdict: SliceVerdict;
  /** The slice's branches in plan order. */
  branches: readonly AssembledBranch[];
  /** The branches of this slice that a person or worker already holds. */
  taken: number;
  /** The branches of this slice a worker may take now. */
  free: number;
  /** Under `--loose`, `branch(reason)` for each `wip` branch whose readiness could not be read. */
  looseDegraded: readonly string[];
}

/** One plan with its slices. */
export interface AssembledPlan {
  /** The plan's file name. */
  file: string;
  /** The plan's phase. */
  phase: string;
  /** Whether the plan is a tracer plan (it names a spike). */
  tracer: boolean;
  /** The slices in plan order. */
  slices: readonly AssembledSlice[];
  /** Branch-section items that name a branch no claim grammar reads, verbatim from the plan record. */
  unreadBranchItems: PlanRecord['unreadBranchItems'];
}

/** Everything the walk decided. */
export interface Assembly {
  /** The default branch's commit the walk read at. */
  mainSha: string;
  /** The plans in scan order. */
  plans: readonly AssembledPlan[];
  /** Every claimable branch, in the order the scan offers them. */
  claimable: readonly string[];
  /** How many branches of eligible slices are taken. */
  takenInEligible: number;
  /** The names a `waits:` annotation may wait on, once each, in plan order. */
  sliceNames: readonly string[];
  /** The scan's summary counters. */
  summary: AssemblySummary;
}

/** The counters the pulse's `summary` object carries. */
export interface AssemblySummary {
  /** Plans listed. */
  plans: number;
  /** Slices listed. */
  sliceCount: number;
  /** Branches listed. */
  branches: number;
  /** Branches in state `claimed`. */
  claimed: number;
  /** Branches a worker may take now. */
  eligible: number;
  /** Slices an earlier slice holds. */
  blocked: number;
  /** Branches in state `deferred`. */
  deferred: number;
  /** Branches in state `waiting`. */
  waiting: number;
  /** Branches in state `blocked`. */
  prereqMissing: number;
}

/**
 * Whether a parsed file is a plan: its phase parsed to something. A note in the
 * plan directory carries no `Phase:` field and parses to an empty phase; `unknown`
 * (a phase word the parser did not recognise) still counts as a plan.
 */
const isPlan = (record: { phase: string }): boolean =>
  record.phase !== '' && record.phase.toLowerCase() !== 'none';

/**
 * The names a `waits:` annotation may wait on: every non-deferred branch of a
 * plan whose phase is not terminal, once each, in plan order.
 *
 * @param estate - the estate stage's answer.
 * @returns the names.
 */
export const sliceNamesOf = (estate: Estate): string[] => {
  const seen = new Set<string>();
  const names: string[] = [];
  for (const { record } of estate.plans) {
    if (!isPlan(record) || TERMINAL_PHASES.has(record.phase)) continue;
    for (const slice of record.slices) {
      for (const line of slice.branches) {
        if (line.deferred || seen.has(line.branch)) continue;
        seen.add(line.branch);
        names.push(line.branch);
      }
    }
  }
  return names;
};

/**
 * Chooses the plans a walk lists: a slug names one plan, and otherwise every
 * live plan, with the terminal ones left out of an offer and appended after
 * the active ones otherwise, the order `plot-fleet-scan.sh` lists them in.
 */
export const chosenPlans = (estate: Estate, input: AssemblyInput) => {
  if (input.slug !== '') {
    const hit = estate.plans.find(({ record }) => isPlan(record) && record.file.endsWith(`${input.slug}.md`));
    return hit === undefined ? [] : [hit];
  }
  const live = estate.plans.filter(({ record }) => isPlan(record));
  const active = live.filter(({ record }) => !TERMINAL_PHASES.has(record.phase));
  if (input.offer) return active;
  return [...active, ...live.filter(({ record }) => TERMINAL_PHASES.has(record.phase))];
};

/**
 * Assembles the walk's readings into verdicts: the fourth and last stage.
 *
 * THE FIRST STAGE THAT DECIDES, and it adds no arithmetic. Every state comes
 * from {@link branchState} with the plan's own landings applied through
 * {@link withPlanLandings}; every slice verdict from {@link sliceVerdicts};
 * every claim from {@link isClaimable}. This function orders those calls the
 * way `plot-fleet-scan.sh` does and keeps the results together.
 *
 * A FAILED STAGE FAILS THE WALK. A snapshot that could not be read for any of
 * the three earlier stages answers `failed`, because a missing desk or branch
 * reading would otherwise read as "nobody holds it".
 *
 * A PLAN THE PULSE DOES NOT LIST. A plan in a phase `released`, `rejected` or
 * `superseded`, and a delivered `docs` or `infra` plan, produces no entry.
 *
 * `conflicts` has no port operation, so no branch carries a conflict reading.
 * A prerequisite's PR state comes from the branch stage's one PR list.
 *
 * @param stages - the three earlier stages' answers.
 * @param input - the slug and offer flag.
 * @returns the assembly, or a failure when any earlier stage failed.
 */
export const assemblePlanWalk = (stages: WalkStages, input: AssemblyInput): PortResult<Assembly> => {
  if (!isAnswered(stages.estate) || !isAnswered(stages.branches) || !isAnswered(stages.desks)) {
    return failed<Assembly>();
  }
  const estate = stages.estate.value;
  const branchStage = stages.branches.value;
  const assembler = planWalkAssembler(estate, input);
  const deskOf = new Map(stages.desks.value.desks.map((d) => [d.branch, d] as const));
  const readingOf = new Map(branchStage.branches.map((b) => [`${b.plan}\t${b.branch}`, b] as const));
  for (const { record } of chosenPlans(estate, input)) {
    const added = assembler.add(record, readingOf, deskOf);
    if (!added.ok) return failed<Assembly>();
  }
  return answered(assembler.finish(branchStage.mainSha));
};

/** What a `wip` branch's PR row says about `--loose` readiness: ready, or not and why. */
const looseReadiness = (detail: PrDetail | undefined): { ready: boolean; degraded: string } => {
  if (detail === undefined || detail === 'no-host') return { ready: false, degraded: 'no-host' };
  if (detail === 'no-cache') return { ready: false, degraded: 'no-cache' };
  if (detail === 'none') return { ready: false, degraded: '' };
  if (detail.state !== 'OPEN') return { ready: false, degraded: '' };
  if (detail.checks !== 'green') {
    const unreadable = detail.checks === 'unknown' || detail.checks === 'none' || detail.checks === '';
    return { ready: false, degraded: unreadable ? detail.checks || 'no-cache' : '' };
  }
  return { ready: !detail.draft, degraded: '' };
};

/** The assembler {@link planWalkAssembler} returns: one plan at a time, then the whole. */
export interface PlanWalkAssembler {
  /**
   * Assembles one plan from the branch and desk readings that name it.
   *
   * @param record - the plan.
   * @param readingOf - the branch readings, keyed `<plan file>\t<branch>`.
   * @param deskOf - the desk readings, keyed by branch.
   * @returns the plan, `null` where the pulse lists none, or a failure where a branch of the plan has no reading.
   */
  add: (
    record: PlanRecord,
    readingOf: ReadonlyMap<string, BranchReading>,
    deskOf: ReadonlyMap<string, DeskReading>,
  ) => PortResult<AssembledPlan | null>;
  /**
   * The assembly of every plan added so far.
   *
   * @param mainSha - the default branch's commit the walk read at.
   * @returns the assembly, with the plans in the order they were added.
   */
  finish: (mainSha: string) => Assembly;
}

/**
 * Starts an assembly that takes one plan at a time, so a caller can hand a
 * plan out as soon as its readings are in. {@link assemblePlanWalk} is this
 * assembler run over every chosen plan.
 *
 * @param estate - the estate stage's answer.
 * @param input - the slug, offer flag and `--loose` input.
 * @returns the assembler.
 */
export const planWalkAssembler = (estate: Estate, input: AssemblyInput): PlanWalkAssembler => {
  const sliceNames = sliceNamesOf(estate);
  const plans: AssembledPlan[] = [];
  const claimable: string[] = [];
  let takenInEligible = 0;
  const summary: AssemblySummary = {
    plans: 0, sliceCount: 0, branches: 0, claimed: 0, eligible: 0, blocked: 0, deferred: 0, waiting: 0, prereqMissing: 0,
  };

  const add: PlanWalkAssembler['add'] = (record, readingOf, deskOf) => {
    if (LEFT_PHASES.has(record.phase)) return answered(null);
    if (record.phase === 'delivered' && (record.type === 'docs' || record.type === 'infra')) return answered(null);
    summary.plans += 1;

    const lines = record.slices.flatMap((slice, sliceIndex) => slice.branches.map((line) => ({ slice, sliceIndex, line })));
    const found = lines.map(({ line }) => readingOf.get(`${record.file}\t${line.branch}`));
    if (found.some((f) => f === undefined)) return failed<AssembledPlan | null>();

    const owns = found.map((f) => branchState({ ...f!.readings, waits: [] }));
    const landed = new Set(lines.filter((_, i) => owns[i] === 'merged').map(({ line }) => line.branch));
    const states = found.map((f, i) => {
      const waitsOn = lines[i]!.line.waitsOn;
      const waits = withPlanLandings(waitsOn, f!.readings.waits, landed);
      return branchState({ ...f!.readings, waits });
    });

    const degraded: string[][] = record.slices.map(() => []);
    const sliceReadings: SliceReadings[] = record.slices.map((_slice, s) => {
      const own = lines.flatMap((l, i) => (l.sliceIndex === s ? [i] : []));
      const outstanding = own.filter((i) => {
        if (states[i] === 'deferred' || states[i] === 'merged') return false;
        if (states[i] !== 'wip' || input.loose === undefined || !input.loose.verifiable) return true;
        const readiness = looseReadiness(found[i]!.prDetail);
        if (readiness.ready) return false;
        if (readiness.degraded !== '') degraded[s]!.push(`${lines[i]!.line.branch}(${readiness.degraded})`);
        return true;
      }).length;
      return {
        outstanding,
        phase: record.phase,
        branches: own.length,
        spikeApproved: record.spikeApprovedRaw !== undefined && record.spikeApprovedRaw !== '',
      };
    });
    const spikeCounts = record.slices.map((slice) => slice.branches.filter((b) => b.spike === true).length);
    const planSpikes = spikeCounts.reduce((a, b) => a + b, 0);
    const spikeAt = spikeSliceOf(spikeCounts, planSpikes);
    const verdicts = sliceVerdicts(sliceReadings.map((r, s) => ({ ...r, spike: spikeAt === s })));

    const slices: AssembledSlice[] = record.slices.map((sliceRecord, s) => {
      const verdict = verdicts[s]!;
      let taken = 0;
      let free = 0;
      const branches = lines.flatMap((l, i) => {
        if (l.sliceIndex !== s) return [];
        const state = states[i]!;
        const f = found[i]!;
        const deskReading = deskOf.get(l.line.branch) ?? null;
        const isFree = isClaimable(verdict, state);
        if (isFree) {
          free += 1;
          claimable.push(l.line.branch);
        }
        if (state === 'claimed' || state === 'wip') taken += 1;
        const assembled: AssembledBranch = {
          branch: l.line.branch,
          state,
          ownState: owns[i]!,
          deferred: l.line.deferred,
          deferredReason: l.line.deferredReason,
          waitsOn: l.line.waitsOn,
          claimed: l.line.claimed,
          claimable: isFree,
          hostConfirmed: f.readings.pr === 'MERGED',
          bySubject: f.readings.mergeSubjectFound,
          desk: deskReading,
          refHeld: f.readings.refTip !== null,
          changedPaths: f.changedPaths,
        };
        if (state === 'waiting') summary.waiting += 1;
        if (state === 'blocked') summary.prereqMissing += 1;
        if (state === 'deferred') summary.deferred += 1;
        if (state === 'claimed') summary.claimed += 1;
        return [assembled];
      });
      summary.branches += branches.length;
      summary.sliceCount += 1;
      if (verdict === 'blocked') summary.blocked += 1;
      if (verdict === 'eligible') takenInEligible += taken;
      summary.eligible += free;
      return { name: sliceRecord.name, verdict, branches, taken, free, looseDegraded: degraded[s]! };
    });
    const assembledPlan: AssembledPlan = {
      file: record.file,
      phase: record.phase,
      tracer: planSpikes > 0,
      slices,
      unreadBranchItems: record.unreadBranchItems,
    };
    plans.push(assembledPlan);
    return answered(assembledPlan);
  };

  const finish = (mainSha: string): Assembly => ({ mainSha, plans, claimable, takenInEligible, sliceNames, summary });
  return { add, finish };
};

/**
 * The plan's slices as the outlook rule reads them.
 *
 * @param assembly - the assembly.
 * @returns one reading per listed slice, in scan order.
 */
export const outlookReadings = (assembly: Assembly): SliceOutlookReading[] =>
  assembly.plans.flatMap((plan) =>
    plan.slices.map((slice) => ({
      verdict: slice.verdict,
      branches: slice.branches.map((b) => ({ name: b.branch, state: b.state })),
    })),
  );

/**
 * The text `--why-nothing` prints: the outlook word and then the blockers, tab-separated.
 *
 * @param assembly - the assembly.
 * @returns the line, newline-terminated.
 */
export const whyNothingText = (assembly: Assembly): string => {
  const work = nextWork(outlookReadings(assembly));
  return `${[work.outlook, ...work.blockers].join('\t')}\n`;
};

/** The answer of an offer: the text to print, the text for stderr, and the exit code. */
export interface OfferAnswer {
  /** What goes to stdout. */
  out: string;
  /** What goes to stderr. */
  err: string;
  /** The exit code. */
  exit: 0 | 1;
}

/**
 * The text `--next` and `--list-eligible` print.
 *
 * @param assembly - the assembly.
 * @param all - whether every claimable branch is named (`--list-eligible`) or the first (`--next`).
 * @returns the output, the stderr note and the exit code.
 */
export const offerAnswer = (assembly: Assembly, all: boolean): OfferAnswer => {
  const names = assembly.claimable;
  if (names.length === 0) {
    const err = !all
      ? ''
      : assembly.takenInEligible > 0
        ? `nothing claimable: ${assembly.takenInEligible} branch(es) in eligible ${WAVES_KEY} are taken.\n`
        : 'nothing claimable: no eligible wave holds a startable branch.\n';
    return { out: '', err, exit: 1 };
  }
  return { out: `${(all ? names : names.slice(0, 1)).join('\n')}\n`, err: '', exit: 0 };
};

/**
 * The text `--slice-names` prints.
 *
 * @param names - the names from {@link sliceNamesOf}.
 * @returns one name per line, or `''` for none.
 */
export const sliceNamesText = (names: readonly string[]): string => (names.length === 0 ? '' : `${names.join('\n')}\n`);

/** What the caller knows about the checkout, for the document's header. */
export interface FleetReadingHeader {
  /** The default branch's name. */
  main: string;
  /** The short commit of `origin/<main>`, or `'unknown'`. */
  readRef: string;
  /** The short commit of the checkout's `HEAD`, or `'unknown'`. */
  localHead: string;
  /** Whether the fetch failed. */
  fetchFailed: boolean;
  /** The fetch's message; `''` where it succeeded. */
  fetchError: string;
  /** The plan directory; a plan's `file` is printed relative to it. */
  planDir: string;
  /** The host word the summary carries. */
  host: string;
  /** The merge-detection word the summary carries. */
  mergeDetect: string;
  /** The wall clock in epoch seconds, for `changed_at`. */
  nowSeconds: number;
  /** Where the estate read its plans; absent means `ref`. */
  planSource?: 'ref' | 'worktree';
}

const branchRow = (
  b: AssembledBranch,
  nowSeconds: number,
  conflicts: ReadonlyMap<string, readonly string[]>,
): Record<string, unknown> => {
  const desk = b.desk;
  const dirty = desk === null || desk.dirty === 'unknown' ? [] : desk.dirty;
  const conflicting = conflicts.get(b.branch);
  const quiet = desk?.quietSeconds ?? null;
  const unpushed = desk === null || desk.unpushed === 'unknown' ? 0 : desk.unpushed.length;
  const row: Record<string, unknown> = { branch: b.branch, state: b.state, own_state: b.ownState, deferred: b.deferred };
  if (b.state === 'merged' && b.bySubject && !b.hostConfirmed) row.evidence = 'subject';
  return {
    ...row,
    deferred_reason: b.deferredReason,
    waits_on: b.waitsOn,
    claimed: b.claimed,
    local_dirty: dirty.length > 0,
    local_locked: desk?.locked ?? false,
    local_worktree: desk?.worktree ?? '',
    held: desk !== null && b.state !== 'merged',
    ref_held: b.refHeld,
    local_ahead: unpushed,
    changed_ago_seconds: quiet,
    changed_at: quiet === null ? null : nowSeconds - quiet,
    worker: desk === null ? 'elsewhere' : desk.process.state,
    worker_pid: desk?.process.pid ?? '',
    worker_exit: desk?.process.exitCode ?? '',
    worker_activity: desk !== null && desk.process.state === 'running' ? desk.process.activity : '',
    worker_dirty_paths: desk !== null && desk.process.state === 'stalled' ? dirty : [],
    conflicts_known: conflicting !== undefined,
    conflicts: conflicting ?? [],
    changed_paths: conflicting === undefined ? [] : b.changedPaths,
  };
};

/**
 * The document `plot-fleet-scan.sh --json` prints.
 *
 * `local_dirty` is whether the desk holds dirty paths; `worker_dirty_paths`
 * lists them for a `stalled` worker only, and is `[]` otherwise. A branch in
 * `conflicts` carries `conflicts_known` `true`, its conflicting paths and its
 * changed paths; any other branch carries `false`, `[]` and `[]`. The
 * summary's `host` is the branch stage's reach word, which never reads
 * `partial`.
 *
 * @param assembly - the assembly.
 * @param header - the checkout's facts.
 * @param conflicts - each branch whose conflicts were read, from
 *   `readBranchConflicts`, to its conflicting paths.
 * @returns the document.
 */
export const fleetReading = (
  assembly: Assembly,
  header: FleetReadingHeader,
  conflicts: ReadonlyMap<string, readonly string[]> = new Map(),
): Record<string, unknown> => ({
  main: header.main,
  read_ref: header.readRef,
  local_head: header.localHead,
  head: header.localHead,
  fetch_failed: header.fetchFailed,
  fetch_error: header.fetchError,
  plan_source: header.planSource ?? 'ref',
  plans: assembly.plans.map((plan) => ({
    file: plan.file.startsWith(header.planDir) ? plan.file.slice(header.planDir.length) : plan.file,
    phase: plan.phase,
    ...(plan.tracer ? { tracer: true } : {}),
    unreadBranchItems: plan.unreadBranchItems,
    [WAVES_KEY]: plan.slices.map((slice) => ({
      name: slice.name,
      verdict: slice.verdict,
      branches: slice.branches.map((b) => branchRow(b, header.nowSeconds, conflicts)),
    })),
  })),
  summary: {
    plans: assembly.summary.plans,
    [WAVES_KEY]: assembly.summary.sliceCount,
    branches: assembly.summary.branches,
    claimed: assembly.summary.claimed,
    eligible: assembly.summary.eligible,
    blocked: assembly.summary.blocked,
    deferred: assembly.summary.deferred,
    waiting: assembly.summary.waiting,
    prereq_missing: assembly.summary.prereqMissing,
    merge_detect: header.mergeDetect,
    host: header.host,
  },
});
