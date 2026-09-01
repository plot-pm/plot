import {
  type Finding,
  type FindingName,
  type MonitorName,
  findingKey,
} from '../entities/finding.js';

/**
 * The findings from one monitor's log that still hold.
 *
 * A CHANNEL, NOT A QUEUE — the rule {@link absorb} states for the live socket,
 * applied to the log a monitor leaves on disk. A second reading from one
 * monitor about one branch REPLACES the first, so the answer is bounded by the
 * number of monitor/branch pairs rather than by how long the fleet has run.
 *
 * `clear` RETRACTS RATHER THAN JOINS. A monitor publishes `clear` when a debt
 * it reported stops holding — the line it writes when a PR is opened over an
 * `owes a review` branch — so the entry it retracts must leave the answer
 * entirely. Keeping it as a finding named `clear` would put an entry on the
 * attention surface saying nothing is wrong.
 *
 * @param entries the findings a monitor published, oldest first — as the log
 *   file holds them.
 * @returns the findings that hold now, in first-published order.
 */
export const currentFindings = (entries: readonly Finding[]): readonly Finding[] => {
  const held = new Map<string, Finding>();
  for (const entry of entries) {
    const key = findingKey(entry);
    if (entry.finding === 'clear') held.delete(key);
    else held.set(key, entry);
  }
  return [...held.values()];
};

/**
 * What a reader should do about one finding, and who should do it.
 *
 * @see AttentionVerdictSchema for the verdicts the board already derives from a
 *   row's own fields. These are the monitors' additions to that vocabulary, and
 *   each names a state no row field carries: a row whose branch owes a review
 *   reads `finished` or `none` on `worker` and has no PR — the same shape as a
 *   branch nobody has started.
 */
export interface FindingReading {
  /** Why it needs attention. */
  verdict: FindingVerdict;
  /** The single move that clears it, in words. */
  action: string;
  /** Which list it belongs in — decided WITH the verdict, never after it. */
  list: 'needsAgent' | 'needsHuman' | 'waiting';
}

/**
 * The verdicts a monitor's finding produces.
 *
 * One per finding rather than a mapping onto the existing verdicts, because the
 * two vocabularies answer different questions. `unfinished` says the scan saw a
 * stalled worker; `owes-review` says the AgentMonitor read a clean desk with
 * commits and no PR — a branch can be the second without being the first, which
 * is the whole reason the monitors exist.
 */
export type FindingVerdict =
  | 'idle'
  | 'gone'
  | 'owes-review'
  | 'owes-answer'
  | 'owes-gate'
  | 'unlanded'
  | 'build-failed'
  | 'build-passed'
  | 'build-approval'
  | 'head-moved';

/**
 * Which verdict, move and list each finding names.
 *
 * `clear` is absent because it never reaches here: {@link currentFindings}
 * removes the finding it retracts, so a cleared debt produces no entry at all.
 * That is what the plan means by clearing being a derivation — nothing marks an
 * entry done; it stops being among the findings that hold.
 */
const READINGS: Readonly<Record<Exclude<FindingName, 'clear'>, FindingReading>> = {
  // A process burning no CPU over an unchanged tree. A machine's errand: the
  // move is to put a worker back on it, not to ask a person anything.
  idle: { verdict: 'idle', action: 'look at the worker, it is not moving', list: 'needsAgent' },
  gone: { verdict: 'gone', action: 'restart it', list: 'needsAgent' },
  // THE FINDING THIS PLAN WAS WRITTEN FOR. Finished work nobody can see, and
  // an agent can open the PR — so it is the agent's list, not a person's.
  'owes a review': { verdict: 'owes-review', action: 'open a PR for it', list: 'needsAgent' },
  // A PERSON IS THE BLOCKER, and its own list for the reason `question` has
  // one: restarting a worker that is holding the door open re-runs what it
  // finished before it asked.
  'owes an answer': {
    verdict: 'owes-answer',
    action: 'answer the question in its tree',
    list: 'waiting',
  },
  'owes a gate': { verdict: 'owes-gate', action: 'add the missing changeset', list: 'needsAgent' },
  'holds unlanded work': {
    verdict: 'unlanded',
    action: 'commit and push it',
    list: 'needsAgent',
  },
  'build failed': {
    verdict: 'build-failed',
    action: 'look at the failing run',
    list: 'needsHuman',
  },
  // A PASSING BUILD IS NEWS, NOT AN ERRAND — see {@link isErrand}. It is
  // carried so a caller waiting on a run can read the answer, and it earns no
  // attention entry.
  'build passed': { verdict: 'build-passed', action: 'nothing', list: 'needsHuman' },
  'build needs approval': {
    verdict: 'build-approval',
    action: 'approve the workflow run',
    list: 'needsHuman',
  },
  'head moved': {
    verdict: 'head-moved',
    action: 'the run is about a superseded sha; wait for the new one',
    list: 'needsHuman',
  },
};

/**
 * Read one finding's verdict, or `null` where the finding names no errand.
 *
 * @param finding the finding to read.
 * @returns the reading, or `null` for `clear` and for findings nobody must act
 *   on.
 */
export const findingReading = (finding: FindingName): FindingReading | null => {
  if (finding === 'clear') return null;
  if (!isErrand(finding)) return null;
  return READINGS[finding];
};

/**
 * Does this finding ask anybody to do anything?
 *
 * `build passed` does not, and it is the one finding here that says a thing
 * went RIGHT. An attention list that carried it would report a green build as
 * work — the flags-everything-flags-nothing failure the board's own `stuck`
 * field avoids by staying null. It still travels on the row: a caller waiting
 * on a run needs the answer, and only the errand half is filtered here.
 */
export const isErrand = (finding: FindingName): boolean =>
  finding !== 'clear' && finding !== 'build passed';

/**
 * Which monitor took a reading, for a reader that must choose a response.
 *
 * A WorkerMonitor `idle` and an AgentMonitor finding call for different moves —
 * one is a process to look at, the other a debt to discharge — so an entry that
 * flattened them would make the reader re-derive which monitor spoke. The
 * `monitor` field on the finding already says it; this is the sentence a person
 * reads beside it.
 */
export const monitorSubject = (monitor: MonitorName): string => {
  switch (monitor) {
    case 'WorkerMonitor':
      return 'the process';
    case 'AgentMonitor':
      return 'the desk';
    case 'BuildMonitor':
      return 'the run';
  }
};
