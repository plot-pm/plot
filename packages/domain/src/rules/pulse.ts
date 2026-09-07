import type { FleetReading } from '../entities/fleet.js';
import { planIdOf } from '../entities/plan.js';

/**
 * A plan's slug, from the dated filename the estate stores it under.
 *
 * THE PLAN ENTITY OWNS THIS NOW — see {@link planIdOf}. Kept as a name because
 * this module's four call sites and the board's importers read it, and moved to
 * a delegation because it was one of FOUR derivations of one identity that
 * disagreed.
 *
 * IT WAS THE WRONG ONE. This function stripped only a leading date, and
 * `plot-plan-meta.sh` reports `file` as a repository-relative PATH — so
 * `docs/plans/2026-09-04-x.md` answered `docs/plans/2026-09-04-x` here while the
 * board's three copies answered `x`. The slug reaches a rendered row
 * (`deriveSlices`) and a collision report that names plans
 * ({@link doubleClaimedBranches}), so the two spellings were user-visible.
 *
 * Every test of it passed a bare filename, which is why nothing caught it.
 *
 * @param file - the plan's path or filename, dated or not.
 * @returns the slug, with any directory, date prefix and `.md` suffix removed.
 */
export const planSlugOf = (file: string): string => planIdOf(file);

/** One slice of one plan, as the reading describes it and a reader acts on it. */
export interface SliceReading {
  /** The plan's slug. */
  plan: string;
  /** The slice's name, or `(unnamed)` where the plan gave none. */
  name: string;
  /** The branches the slice names, in the order it names them. */
  branches: readonly string[];
  /** The slice's verdict as the scan reported it, unparsed. */
  verdict: string;
  /** Whether every branch has landed or was given up. */
  complete: boolean;
  /** How many slices the plan holds, so a sole slice can be told from one of many. */
  planSliceCount: number;
}

/**
 * Every slice in a reading, flattened, with the one judgement each carries.
 *
 * **`complete` is the rule and the rest is transcription.** A slice is complete
 * when every branch is merged or deferred — deferred counts because a branch
 * given up is not outstanding work, and a slice waiting on one nobody will
 * build would never finish.
 *
 * Returns readings rather than the board's `Wave`: that type carries a section
 * name the view groups by, and a rule that named sections would be deciding
 * where a row is drawn.
 *
 * @param reading - the fleet's reading.
 * @returns one entry per slice, in the reading's own order.
 */
export const sliceReadings = (reading: FleetReading): SliceReading[] => {
  const readings: SliceReading[] = [];
  for (const plan of reading.plans) {
    const slug = planSlugOf(plan.file);
    for (const slice of plan.slices) {
      readings.push({
        plan: slug,
        name: slice.name || '(unnamed)',
        branches: slice.branches.map((b) => b.branch),
        verdict: slice.verdict,
        complete: slice.branches.every((b) => b.deferred || b.state === 'merged'),
        planSliceCount: plan.slices.length,
      });
    }
  }
  return readings;
};

/**
 * The branches more than one plan names, and which plans name them.
 *
 * A branch belongs to one plan: two claiming it means one of the two plan files
 * is wrong, and resolving it means editing one of them. So the answer NAMES the
 * plans rather than counting them — a reader who is told *2* has to open a
 * terminal to find out which two.
 *
 * @param reading - the fleet's reading.
 * @returns branch to the plans naming it, sorted, for branches named more than once.
 */
export const doubleClaimedBranches = (reading: FleetReading): Map<string, string[]> => {
  const byBranch = new Map<string, Set<string>>();
  for (const plan of reading.plans) {
    const slug = planSlugOf(plan.file);
    for (const slice of plan.slices) {
      for (const branch of slice.branches) {
        const seen = byBranch.get(branch.branch) ?? new Set<string>();
        seen.add(slug);
        byBranch.set(branch.branch, seen);
      }
    }
  }
  const collisions = new Map<string, string[]>();
  for (const [branch, plans] of byBranch) {
    if (plans.size > 1) collisions.set(branch, [...plans].sort());
  }
  return collisions;
};

/** What the fleet stopped seeing between two readings — plans and branches. */
export interface ReadingLoss {
  /** The plan files the previous reading held and this one does not, sorted. */
  plans: string[];
  /** The branches the previous reading held and this one does not, sorted. */
  branches: string[];
  /** When the previous reading was read. */
  previousAt: number;
}

const branchNamesOf = (reading: FleetReading): Set<string> =>
  new Set(reading.plans.flatMap((p) => p.slices.flatMap((s) => s.branches.map((b) => b.branch))));

/**
 * What the fleet stopped seeing between two consecutive readings.
 *
 * **A SHRINK IS A STATEMENT ABOUT THE ESTATE, NOT A TRANSPORT DECISION**, and
 * the name invites the opposite reading. Nothing is dropped here: this compares
 * two readings and reports what the second no longer holds — *the scan used to
 * see these and does not now*. A plan that vanished is either delivered or
 * unreadable, and which of those it is matters enough to say out loud.
 *
 * NAMED rather than counted, for the reason the row's note gives: *"3 plans
 * became 2 makes the reader open a terminal to find out which"*. Composing that
 * sentence is the view's job; deciding what was lost is this one's.
 *
 * @param previous - the reading taken before, or `null` on the first one.
 * @param incoming - the reading just taken.
 * @param previousAt - when the previous reading was taken, or `null` with none.
 * @returns what was lost, or `null` when nothing was — including the first read.
 */
export const readingLoss = (
  previous: FleetReading | null,
  incoming: FleetReading,
  previousAt: number | null,
): ReadingLoss | null => {
  // A FIRST READING LOSES NOTHING. With no previous reading every plan would
  // look new, and reporting that as a shrink announces a loss on every start.
  if (previous === null || previousAt === null) return null;

  const wasPlans = new Set(previous.plans.map((p) => p.file));
  const nowPlans = new Set(incoming.plans.map((p) => p.file));
  const lostPlans = [...wasPlans].filter((f) => !nowPlans.has(f));

  const wasBranches = branchNamesOf(previous);
  const nowBranches = branchNamesOf(incoming);
  const lostBranches = [...wasBranches].filter((b) => !nowBranches.has(b));

  if (lostPlans.length === 0 && lostBranches.length === 0) return null;
  return { plans: lostPlans.sort(), branches: lostBranches.sort(), previousAt };
};

/**
 * Which of the four things a delta can say.
 *
 * `unchanged` and `unusable` are the pair that must never collapse: a quiet
 * estate and a history nobody can read look identical to a reader and mean
 * opposite things. `first` is neither — nobody has pulsed here yet, which is
 * where every new adopter starts and is not a failure.
 *
 * A union rather than a `z.enum`: nothing parses this off a wire. It is this
 * rule's return value, produced and consumed in the same process, so a schema
 * would validate what TypeScript already guarantees.
 */
export type DeltaOutcome = 'changed' | 'unchanged' | 'first' | 'unusable';

/** A branch whose PR landed between two readings. */
export interface MergedBranch {
  /** The branch's name. */
  branch: string;
  /** The slug of the plan that names it. */
  plan: string;
}

/** A branch whose worker was alive in the previous reading and is not now. */
export interface DeadWorker {
  /** The branch the worker was running on. */
  branch: string;
  /** The slug of the plan that names it. */
  plan: string;
  /** The state the worker reached — `finished`, `failed`, `ended` or `none`. */
  state: string;
}

/**
 * What moved between two readings, named rather than counted.
 *
 * The three the story asks for and nothing else. A fourth belongs here when
 * somebody names the one they wanted and could not see — the bridge carries
 * every slice verdict and every branch state, and diffing all of it prints
 * three lines nobody reads when three branches each advance one step.
 */
export interface PulseDelta {
  /** Which of the four things this delta says. */
  outcome: DeltaOutcome;
  /** Branches whose state became `merged`, sorted by branch. */
  merged: MergedBranch[];
  /** Branches whose worker stopped running, sorted by branch. */
  workersDied: DeadWorker[];
  /** Plan slugs whose every non-deferred slice completed, sorted. */
  deliverable: string[];
  /** What the previous reading held and this one does not, or `null`. */
  loss: ReadingLoss | null;
  /** When the previous reading was taken, or `null` where there was none to use. */
  previousAt: number | null;
}

/** Every branch of a reading, by name, with the plan that names it. */
const branchesByName = (
  reading: FleetReading,
): Map<string, { plan: string; state: string; worker: string }> => {
  const found = new Map<string, { plan: string; state: string; worker: string }>();
  for (const plan of reading.plans) {
    const slug = planSlugOf(plan.file);
    for (const slice of plan.slices) {
      for (const branch of slice.branches) {
        found.set(branch.branch, { plan: slug, state: branch.state, worker: branch.worker });
      }
    }
  }
  return found;
};

/**
 * The plan slugs whose every non-deferred slice is complete.
 *
 * Asks each plan the question `allSlicesMerged` answers, over the reading it is
 * given. A plan naming no non-deferred branch is not deliverable — a plan
 * nobody built has not become anything.
 */
const deliverablePlans = (reading: FleetReading): Set<string> => {
  const done = new Set<string>();
  for (const plan of reading.plans) {
    let merged = 0;
    let outstanding = false;
    for (const slice of plan.slices) {
      const branches = slice.branches.filter((b) => !b.deferred);
      if (branches.length === 0) continue;
      if (slice.verdict !== 'complete') { outstanding = true; break; }
      merged += branches.length;
    }
    if (!outstanding && merged > 0) done.add(planSlugOf(plan.file));
  }
  return done;
};

/**
 * Whether a worker state means a process is alive.
 *
 * `elsewhere` is deliberately not alive and not dead: it means no worktree on
 * this machine, so the question could not be asked. A reading that stops being
 * able to see a worker has not watched one die.
 */
const isAlive = (worker: string): boolean => worker === 'running';

/**
 * What moved between the previous pulse and this one.
 *
 * @param previous - the reading taken before, or `null` when none was readable.
 * @param incoming - the reading just taken.
 * @param previousAt - when the previous reading was taken, or `null` with none.
 * @param historyExists - whether a previous pulse was found but could not be
 *   used, which separates `unusable` from `first`. Ignored when `previous` is
 *   given.
 * @returns the delta, whose `outcome` says which of the four it is.
 */
export const pulseDelta = (
  previous: FleetReading | null,
  incoming: FleetReading,
  previousAt: number | null,
  historyExists = false,
): PulseDelta => {
  const empty = { merged: [], workersDied: [], deliverable: [], loss: null };

  // NO USABLE PREVIOUS READING SPLITS TWO WAYS, and the split is the point.
  // Nobody has pulsed here yet is a normal state; a pulse that was found and
  // could not be read is a different fact, and reporting either as `unchanged`
  // tells a reader the estate is quiet when nothing was compared at all.
  if (previous === null || previousAt === null) {
    return { ...empty, outcome: historyExists ? 'unusable' : 'first', previousAt: null };
  }

  const was = branchesByName(previous);
  const now = branchesByName(incoming);

  const merged: MergedBranch[] = [];
  const workersDied: DeadWorker[] = [];
  for (const [name, after] of now) {
    const before = was.get(name);
    // A branch this reading names for the first time transitioned from nothing.
    // It is new, not moved, and the three answers are all about movement.
    if (!before) continue;
    if (before.state !== 'merged' && after.state === 'merged') {
      merged.push({ branch: name, plan: after.plan });
    }
    if (isAlive(before.worker) && !isAlive(after.worker) && after.worker !== 'elsewhere') {
      workersDied.push({ branch: name, plan: after.plan, state: after.worker });
    }
  }

  const wasDeliverable = deliverablePlans(previous);
  const deliverable = [...deliverablePlans(incoming)].filter((p) => !wasDeliverable.has(p));

  const loss = readingLoss(previous, incoming, previousAt);

  const changed = merged.length > 0 || workersDied.length > 0
    || deliverable.length > 0 || loss !== null;

  return {
    outcome: changed ? 'changed' : 'unchanged',
    merged: merged.sort((a, b) => a.branch.localeCompare(b.branch)),
    workersDied: workersDied.sort((a, b) => a.branch.localeCompare(b.branch)),
    deliverable: deliverable.sort(),
    loss,
    previousAt,
  };
};
