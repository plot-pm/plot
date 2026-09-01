import { checkChangeset } from './changeset.js';
import type { MergeReading } from './reapable.js';

/**
 * What was measured of ONE desk after its agent stopped.
 *
 * Every field is a reading taken from what the agent LEFT BEHIND — a ref on the
 * host, a file on disk, a line in the plan. Nothing here is the agent's own
 * account of its work: a gate that read the declaration would be trusting the
 * thing it exists to check.
 *
 * Named for the desk rather than for the gate because one desk answers all five
 * gates, and a per-gate readings type would be five names for one measurement
 * pass.
 */
export interface DeskReadings {
  /** The branch this desk worked, as the plan names it. */
  branch: string;
  /** What the host said about any PR for this branch. */
  merge: MergeReading;
  /**
   * The changeset files the desk added, as `path` and full `text`.
   *
   * The text and not a verdict: {@link checkChangeset} is the rule that judges
   * a changeset, and a gate that took a boolean would be quoting a decision
   * somebody else made rather than naming what to fix.
   */
  changesets: readonly ChangesetFile[];
  /** The package names the workspace has, for {@link checkChangeset}. */
  workspacePackages: readonly string[];
  /**
   * The first uncommitted path, or `''` when the tree is clean.
   *
   * The reading is the path and not a flag — the same vocabulary
   * `TreeReadings.dirtyPath` uses, and for the same reason: the failure quotes
   * it, and a boolean cannot be quoted.
   */
  dirtyPath: string;
  /**
   * The `PLOT-BLOCKED*` marker's filename, or `''` when the desk carries none.
   *
   * The NAME rather than a flag, because `plot_worker_blocked_file` already
   * answers which file carries the question and a failure that says only *this
   * branch is blocked* sends its reader hunting.
   */
  blockedMarker: string;
  /** The plan's own line for this branch, or null when the plan names none. */
  planLine: PlanBranchLine | null;
}

/** One changeset file the desk added. */
export interface ChangesetFile {
  /** The path it was read from, relative to the repository root. */
  path: string;
  /** Its full contents. */
  text: string;
}

/**
 * The plan's line for one branch, reduced to what the annotation gate reads.
 *
 * A narrowing of `PlanRecordBranch`: the gate asks whether the line records an
 * outcome, so it needs the PR numbers the line annotates and whether the plan
 * gave the branch up. Taking the port's own type here would put a port import
 * in a rule.
 */
export interface PlanBranchLine {
  /** The PR numbers this line annotates; empty when it annotates none. */
  prs: readonly number[];
  /** Whether the plan gave the branch up rather than finishing it. */
  deferred: boolean;
  /** Why it was deferred; `''` when it was not. */
  deferredReason: string;
}

/**
 * One post-execution check over a finished desk.
 *
 * A gate returns `null` when it passed, or a failure written to be pasted
 * verbatim into the next attempt's correction prompt. The return is a string
 * rather than an enum for exactly that reason: the next attempt is told what is
 * missing rather than asked to re-derive it from a code.
 *
 * Pure and synchronous. A gate takes readings as values, awaits nothing and
 * imports no port, so the caller decides what was read and when.
 */
export type Gate = (readings: DeskReadings) => string | null;

/**
 * Whether the host merged a PR for this branch — and if not, why it could say so.
 *
 * Reads the merge answer and never the PR's state: a merged PR reports
 * `CLOSED`, and squash-merge leaves a branch permanently ahead of the default
 * branch, so neither state nor ancestry answers this.
 *
 * A host that could not be asked FAILS, and says which of the two it was.
 * `unreachable` and `not-merged` reach the same verdict by different readings,
 * and a correction prompt that confuses them tells an agent to open a PR it may
 * already have opened. Silence is never permission.
 *
 * @param readings What was measured of the desk.
 * @returns null when a PR merged; otherwise what to do about it.
 */
export const prGate: Gate = (readings) => {
  if (readings.merge === 'merged') return null;
  if (readings.merge === 'unreachable') {
    return `The git host could not be asked whether a PR for \`${readings.branch}\` merged. This is not a report that no PR exists — the question failed. Check the host is reachable and you are authenticated, then confirm the branch has a merged PR.`;
  }
  return `No merged PR for \`${readings.branch}\`. The host holds no PR for this branch that has merged. Push the branch and open a PR to the default branch; if a PR is already open, get it merged.`;
};

/**
 * Whether the desk added a changeset the release can publish.
 *
 * Delegates every judgement to {@link checkChangeset} rather than restating it:
 * which line Changesets publishes is the whole of the defect that rule exists
 * for, and a second reading of it would drift.
 *
 * Reports EVERY problem the rule returns, not the first, so one correction names
 * everything the next attempt must fix.
 *
 * @param readings What was measured of the desk.
 * @returns null when at least one changeset is valid; otherwise what to fix.
 */
export const changesetGate: Gate = (readings) => {
  if (readings.changesets.length === 0) {
    return `No changeset was added for \`${readings.branch}\`. Add one file under \`.changeset/\` naming the packages this branch changes, with the description FIRST and the \`bumps:\` block LAST — Changesets publishes the first line after the frontmatter, so a \`bumps:\` block written first becomes the release note.`;
  }

  const complaints: string[] = [];
  for (const file of readings.changesets) {
    const problems = checkChangeset(file.text, readings.workspacePackages);
    for (const problem of problems) {
      complaints.push(
        problem.refusal === 'unknown-package'
          ? `\`${file.path}\` names the package \`${problem.detail}\`, which this workspace does not have. Correct the name in the frontmatter to one of: ${readings.workspacePackages.join(', ')}.`
          : `\`${file.path}\` would publish no description — the first line after the frontmatter reads \`${problem.detail}\`. Move the prose above the \`bumps:\` block, or write a description of at least 20 characters.`,
      );
    }
  }
  if (complaints.length === 0) return null;
  return `The changeset for \`${readings.branch}\` will not release:\n${complaints.map((c) => `- ${c}`).join('\n')}`;
};

/**
 * Whether the desk left work on the floor.
 *
 * Uncommitted work exists in exactly one place, so a desk that is not clean is
 * holding the only copy of something. The failure quotes the path, which is why
 * the reading is a path rather than a flag.
 *
 * @param readings What was measured of the desk.
 * @returns null when the tree is clean; otherwise what to commit.
 */
export const cleanTreeGate: Gate = (readings) => {
  if (readings.dirtyPath === '') return null;
  return `The worktree for \`${readings.branch}\` still holds uncommitted work, starting at \`${readings.dirtyPath}\`. This is the only copy of it. Commit everything that belongs to this branch and push, or remove what does not.`;
};

/**
 * Whether the desk stopped to ask a person something.
 *
 * A `PLOT-BLOCKED*` file is an agent reporting that it cannot proceed, which is
 * information rather than silence. The failure names the FILE, so its reader
 * goes to the question rather than hunting for it.
 *
 * @param readings What was measured of the desk.
 * @returns null when no marker is present; otherwise where the question is.
 */
export const notBlockedGate: Gate = (readings) => {
  if (readings.blockedMarker === '') return null;
  return `The worktree for \`${readings.branch}\` carries \`${readings.blockedMarker}\`, so the agent stopped to ask a person something. Read that file, answer the question it holds, then delete it before the branch can finish.`;
};

/**
 * Whether the plan records what became of this branch.
 *
 * The plan is Plot's own ledger, so a branch whose work landed and whose plan
 * line says nothing has landed invisibly. Two annotations satisfy this and they
 * are not the same claim: a PR number says the work ended in a PR, and a
 * `deferred:` reason says the plan gave the branch up on purpose. A deferral
 * with no reason is not an annotation — it records that a decision was made and
 * not what it was.
 *
 * A plan naming no line for the branch fails differently from a line with
 * nothing on it: the first is a branch nobody planned, the second a branch
 * nobody wrote down.
 *
 * @param readings What was measured of the desk.
 * @returns null when the line records an outcome; otherwise what to write.
 */
export const planAnnotatedGate: Gate = (readings) => {
  const line = readings.planLine;
  if (line === null) {
    return `No plan names \`${readings.branch}\` in its \`## Branches\` section. The plan is Plot's ledger, so a branch missing from it has landed invisibly. Add the branch to the wave it belongs to, then annotate its line with the PR number.`;
  }
  if (line.deferred) {
    if (line.deferredReason !== '') return null;
    return `The plan line for \`${readings.branch}\` is marked deferred and gives no reason. \`/plot-reconcile\` needs the reason as well as the marker. Write what the branch was given up for, on the same line: \`deferred: <why>\`.`;
  }
  if (line.prs.length > 0) return null;
  return `The plan line for \`${readings.branch}\` is not annotated. Append the PR number to it on \`main\`, in the form \`— <what it did> → #<pr>\`, so the plan records where the work landed.`;
};

/**
 * The five gates, in the order a correction should report them.
 *
 * The order is the argument and not a formality. A blocked marker is first
 * because it is the one failure a person rather than the agent must clear;
 * uncommitted work is second because it is the only failure describing work
 * that exists nowhere else. The remaining three describe work that landed and
 * was not finished off, in the order a branch reaches them.
 */
export const ALL_GATES: readonly Gate[] = [
  notBlockedGate,
  cleanTreeGate,
  prGate,
  changesetGate,
  planAnnotatedGate,
];

/**
 * Runs every gate over one desk.
 *
 * Every failure is reported rather than the first, so one correction names
 * everything the next attempt must fix — the same reason {@link checkChangeset}
 * returns a list.
 *
 * @param readings What was measured of the desk.
 * @param gates Which gates to run; all five by default.
 * @returns One message per failed gate, in {@link ALL_GATES} order; empty when
 *   the desk passed.
 */
export const gateFailures = (
  readings: DeskReadings,
  gates: readonly Gate[] = ALL_GATES,
): string[] => gates.map((gate) => gate(readings)).filter((failure): failure is string => failure !== null);

/**
 * Whether a desk passed every gate.
 *
 * @param readings What was measured of the desk.
 * @param gates Which gates to run; all five by default.
 * @returns True when no gate failed.
 */
export const passesGates = (
  readings: DeskReadings,
  gates: readonly Gate[] = ALL_GATES,
): boolean => gateFailures(readings, gates).length === 0;
