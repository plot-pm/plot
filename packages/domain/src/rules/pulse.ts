import type { FleetReading } from '../entities/fleet.js';

/**
 * A plan's slug, from the dated filename the estate stores it under.
 *
 * ONE DEFINITION, because two derivations of one identity drift: `deriveWaves`
 * and `doubleClaimedBranches` each carried this regex, and a plan named
 * differently by the two would have produced a collision report nobody could
 * match to a wave.
 *
 * @param file - the plan's filename, dated or not.
 * @returns the slug, with the date prefix and `.md` suffix removed.
 */
export const planSlugOf = (file: string): string =>
  file.replace(/^\d{4}-\d{2}-\d{2}-/, '').replace(/\.md$/, '');

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
