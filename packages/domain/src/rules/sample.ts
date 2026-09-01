import type { WorkerActivity } from '../entities/fleet.js';

/**
 * Whether the recorded pid names a live process.
 *
 * Three values, never a boolean. `unrecorded` is the startup window: the
 * wrapper backgrounds the monitor BEFORE it writes the pid file, so an absent
 * or empty file means the birth has not been recorded yet. Collapsing that into
 * `dead` makes `gone` fire on every worker's first pass, which is the one
 * moment it is guaranteed to be wrong.
 */
export type PidStatus = 'alive' | 'dead' | 'unrecorded';

/**
 * Whether the branch already carries the agent's own work.
 *
 * `unanswerable` is distinct from `no` because the readings differ: there is no
 * local ref to count against, so the question was never put. A failure to
 * observe is not evidence of something to see, and counting against nothing
 * would read every branch in a remote-less repository as having committed.
 */
export type CommitReading = 'yes' | 'no' | 'unanswerable';

/**
 * One pass's readings of the process a dispatched agent runs on.
 *
 * Every field is a reading rather than a judgement, and nothing here is fetched
 * — the caller supplies both this and the previous sample, which is what keeps
 * the rule a pure function of two values and testable without a clock.
 *
 * The fingerprint is a cheap stand-in for "the tree as it is right now",
 * compared between passes. It is composed from `Refs.resolve('HEAD')` and
 * `Trees.markers`, so it goes through the same prefix filter the shell applies:
 * a fingerprint over a raw status would see the monitor's own findings file
 * appear, and `idle` could never hold across two passes.
 */
export interface MonitorReading {
  /** Whether the recorded pid names a live process. */
  pid: PidStatus;
  /** Whether the agent's subtree is burning CPU; `''` where nothing answered. */
  activity: WorkerActivity;
  /** An opaque string; unchanged between passes means the tree did not move. */
  fingerprint: string;
  /** Whether the branch already carries commits that touched a file. */
  commits: CommitReading;
}

/**
 * What one pass of the WorkerMonitor found.
 *
 * `silent` is not a finding and is published nowhere. The distinction is the
 * whole point: a monitor that reports every quiet moment teaches an operator to
 * ignore it, and then it is worse than absent.
 */
export type MonitorVerdict = 'gone' | 'idle' | 'silent';

/**
 * What this pass sees, before the two-sample rule is applied.
 *
 * `gone` is asked FIRST because a dead pid makes every other question
 * meaningless — the CPU of a subtree that is not there cannot be measured, and
 * the sampler answers `''` for it anyway, which is indistinguishable from a
 * live pid with no children.
 *
 * `''` is not `idle`. The absence of a child is not the presence of an idle
 * one, so an unmeasurable subtree reads `quiet: false` and no finding follows
 * it. Collapsing the empty answer into `idle` is how a monitor invents a stall.
 *
 * @param reading What one pass measured.
 * @returns Whether the pid is gone, and whether the subtree measured quiet.
 */
const observe = (reading: MonitorReading): { gone: boolean; quiet: boolean } => ({
  gone: reading.pid === 'dead',
  quiet: reading.pid === 'alive' && reading.activity === 'idle',
});

/**
 * The WorkerMonitor's judgement over two consecutive passes.
 *
 * `gone` needs ONE sample and `idle` needs two, and the asymmetry is
 * deliberate. A dead pid is not a transient reading the way a frozen CPU clock
 * is — a process does not come back — so requiring a second pass would delay
 * the one certain finding by a whole interval for no gain in confidence.
 *
 * `idle` carries three conditions and not one. A worker waiting on a long model
 * response has the same zero CPU delta as one whose agent has vanished, so the
 * delta alone is not the finding. All four must hold together: this pass quiet,
 * the previous pass quiet, the fingerprint unchanged between them, and commits
 * already on the branch.
 *
 * The commits condition is where the false positives would have been. An agent
 * given a hard first slice is quiet for a long time with nothing to show, and
 * calling that a stall is the cry-wolf that costs the finding its readers — so
 * a quiet pass with no commits is `silent`, and so is one whose commit question
 * could not be answered at all.
 *
 * It is called `idle` and never `stalled`. The spec owns `stalled` for an AGENT
 * fact — exited 0, unlanded work, no PR. A stalled agent has work to rescue; an
 * idle worker may just be waiting on the network, and this rule watches a
 * PROCESS.
 *
 * @param previous The pass before this one, or `null` on the monitor's first.
 * @param current What this pass measured.
 * @returns The finding, or `silent` where none holds.
 */
export const sample = (
  previous: MonitorReading | null,
  current: MonitorReading,
): MonitorVerdict => {
  const now = observe(current);
  if (now.gone) return 'gone';
  if (!now.quiet || previous === null) return 'silent';
  if (!observe(previous).quiet) return 'silent';
  if (previous.fingerprint !== current.fingerprint) return 'silent';
  return current.commits === 'yes' ? 'idle' : 'silent';
};

/**
 * What the monitor publishes, given the finding it last published.
 *
 * A held finding is published ONCE, at the moment it first holds. A monitor
 * that re-published `idle` every pass would fill the findings file with one
 * fact repeated, and a subscriber could not tell a new stall from an old one.
 *
 * The clearing case is a publish too: a finding that held and then stopped
 * holding is news, and a board that never hears it leaves a stale entry up
 * after the worker recovered.
 *
 * @param published The finding currently standing, or `'silent'` where none is.
 * @param verdict What this pass found.
 * @returns The finding to publish, `'clear'` to retract, or null to say nothing.
 */
export const publication = (
  published: MonitorVerdict,
  verdict: MonitorVerdict,
): 'gone' | 'idle' | 'clear' | null => {
  if (verdict === published) return null;
  return verdict === 'silent' ? 'clear' : verdict;
};
