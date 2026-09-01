import type { Finding, FindingName } from '../entities/finding.js';

/**
 * The one act a report may take by itself, and the branches it is safe on.
 *
 * ONE ACTION, AND THE REASON IS REVERSIBILITY. Opening a PR is undoable by the
 * person who disagrees with it — close it, and the branch, the worktree and the
 * work are untouched. Restarting an agent risks the running one's uncommitted
 * work; reaping removes a checkout; killing a worker loses whatever it was
 * mid-way through. Those three stay with `plot-reap.sh` and `plot-dispatch.sh`,
 * behind the refusals they already own.
 */

/** What a report may ask for: a PR, or nothing. */
export type ActName = 'open a pr';

/**
 * Which findings license an act, and which act.
 *
 * A closed map rather than a predicate, so a fourth finding arriving in
 * `FindingNameSchema` licenses nothing until someone adds it here on purpose.
 * Every finding absent from this map is a report and nothing else.
 */
export const ACTS: Readonly<Partial<Record<FindingName, ActName>>> = {
  'owes a review': 'open a pr',
};

/**
 * What the actor knows about a branch beside the finding.
 *
 * Every field is a MEASUREMENT the actor already holds — the same discipline
 * `ReapEvidence` applies. None is a judgement about whether a PR is wanted;
 * that is what the finding said.
 */
export interface BranchReading {
  /**
   * Whether the host already holds a PR for this branch.
   *
   * THE IDEMPOTENCE CLAUSE, and it is the one that bites. The finding holds
   * until the PR appears and the channel republishes on every interval, so an
   * actor firing per message rather than per state opens a PR a minute until
   * somebody notices. This field is the state.
   *
   * An unreachable host answers `true` at the call site rather than here:
   * silence is never permission to open a second PR.
   */
  hasPr: boolean;
  /**
   * Whether this run has already opened a PR for this branch.
   *
   * The host is asked on a slower cadence than findings arrive, so a PR opened
   * one second ago is not yet visible in `hasPr` when the next message lands.
   * Without this, two messages inside one host round trip open two PRs — which
   * is the same defect as acting per message, arriving through the gap rather
   * than through the loop.
   */
  actedThisRun: boolean;
  /**
   * The gate this branch does not satisfy, or `''` when it satisfies them all.
   *
   * NAMED, NOT WITHHELD. A branch that also owes a gate still gets its PR and
   * the body says which gate is missing: withholding it would leave finished
   * work invisible until someone happens to write the changeset, which is the
   * failure this plan exists to end one step later in the process.
   */
  openGate: string;
}

/** The act to take, with everything the caller needs to take it. */
export interface Act {
  /** What to do. */
  act: ActName;
  /** The branch it is about. */
  branch: string;
  /** The PR's title. */
  title: string;
  /** The PR's body — the finding, its evidence, and any open gate. */
  body: string;
}

/** Why no act was taken, in a sentence a log can print. */
export interface NoAct {
  act: 'nothing';
  /** The branch asked about. */
  branch: string;
  /** Which rule declined, ready to print. */
  reason: string;
}

export type ActDecision = Act | NoAct;

/** Narrows a decision to the act it asks for. */
export const isAct = (decision: ActDecision): decision is Act => decision.act !== 'nothing';

/**
 * What, if anything, this finding and this branch state license.
 *
 * ACT ON THE STATE, NOT THE MESSAGE. The same finding arriving ten times
 * produces one PR, because the second call reads a branch that now has one. The
 * decision is a function of the reading rather than of how many times it was
 * asked, which is what makes it safe on a channel that republishes.
 *
 * @param finding the finding as a monitor published it
 * @param reading what the actor measured about the branch
 * @returns the act to take, or the reason none was
 */
export const actOn = (finding: Finding, reading: BranchReading): ActDecision => {
  const branch = finding.branch;
  const act = ACTS[finding.finding];
  if (act === undefined) {
    return {
      act: 'nothing',
      branch,
      reason: `'${finding.finding}' is a report; only 'owes a review' licenses an act`,
    };
  }
  if (branch === '') {
    return { act: 'nothing', branch, reason: 'the finding names no branch' };
  }
  if (reading.actedThisRun) {
    return { act: 'nothing', branch, reason: `a PR was already opened for ${branch} in this run` };
  }
  if (reading.hasPr) {
    return { act: 'nothing', branch, reason: `${branch} already has a PR` };
  }
  return {
    act,
    branch,
    title: prTitle(branch),
    body: prBody(finding, reading.openGate),
  };
};

/**
 * The PR's title: the branch, without its prefix.
 *
 * Derived rather than invented. The branch name is the one piece of prose about
 * this work that a person wrote — `feature/a-report-can-open-the-pr` becomes
 * *"A report can open the PR"* — and anything else would be an agent's guess at
 * what the commits mean, which is the judgement this slice refuses to make.
 *
 * @param branch the branch the PR is for
 * @returns the title
 */
export const prTitle = (branch: string): string => {
  const slug = branch.includes('/') ? branch.slice(branch.indexOf('/') + 1) : branch;
  const words = slug.split('-').filter((w) => w !== '');
  if (words.length === 0) return branch;
  const sentence = words.join(' ');
  return sentence.charAt(0).toUpperCase() + sentence.slice(1);
};

/**
 * The PR's body: the finding, its evidence, any open gate, and who opened it.
 *
 * IT NAMES ITS OWN PROVENANCE. A PR a person did not open must say so in its
 * first line, or the reviewer's first question is who asked for this — and the
 * evidence is what lets them answer *was it right to*.
 *
 * IT DOES NOT WRITE THE MISSING CHANGESET. A changeset says what changed and
 * why it matters; that is a judgement about the work, and an agent guessing at
 * it produces the `<!--` class of entry this repo is already fixing. The body
 * names the gate and leaves the writing to whoever reads it.
 *
 * @param finding the finding that licensed the PR
 * @param openGate the gate the branch does not satisfy, or `''`
 * @returns the body, in markdown
 */
export const prBody = (finding: Finding, openGate: string): string => {
  const lines = [
    `Opened by the master agent on a monitor finding. Nobody asked for it; close it if it is wrong.`,
    '',
    `**Finding:** \`${finding.finding}\` — ${finding.monitor}, ${finding.measuredAt}`,
    `**Evidence:** ${finding.evidence}`,
    `**Since:** ${finding.since}`,
  ];
  if (openGate !== '') {
    lines.push(
      '',
      `**Open gate:** ${openGate}`,
      '',
      `The PR is opened anyway, so the work is visible and CI reports the same failure the finding predicts. The gate is left for a person: writing it is a judgement about what changed, not a mechanical step.`,
    );
  }
  return lines.join('\n');
};
