import { actOn, isAct, type Act, type ActDecision, type Finding, type Host, type Refs } from '@plot-pm/domain';

/**
 * The one act a monitor finding may take, taken through the controller.
 *
 * NO SECOND ENTRY POINT TO THE DOMAIN. The master agent asks here for the same
 * reason the board's routes do — `the-controller-answers-every-asker` exists to
 * end the estate being reached for separately by everyone — and building an
 * acting path beside it would be the duplication that plan removes.
 *
 * THE CONTROLLER ASKS PORTS AND NEVER SPAWNS. Every reading below is a port
 * call and the write is `Host.prCreate`; the shell that reaches `gh` is behind
 * the adapter, where the layering rule puts it.
 */

/** The readings and the one write this controller needs. */
export interface ActingPorts {
  /** Opens the PR, and says whether one already exists. */
  host: Host;
  /** Reads what the branch changed, for the gate the body names. */
  refs: Refs;
}

/** What one finding produced. */
export interface ActingOutcome {
  /** The branch the finding was about. */
  branch: string;
  /** What was decided, refusal and all. */
  decision: ActDecision;
  /** Whether a PR was actually opened. */
  opened: boolean;
  /** The PR's URL where the host gave one; `''` otherwise. */
  url: string;
  /** What went wrong, ready to print; `''` when nothing did. */
  error: string;
}

/**
 * What this run has already opened, so a republished finding opens nothing.
 *
 * PER RUN, NOT GLOBAL, and the bound is the same one `EstateMemory` argues for:
 * the host is the durable record of whether a PR exists, and this only covers
 * the window in which the host has not been asked again yet. A memory that
 * outlived its run would be a second source of truth about PRs, ageing into a
 * refusal to open one that was closed.
 */
export interface ActedMemory {
  branches: Set<string>;
}

/** A fresh memory, holding nothing. */
export const newActedMemory = (): ActedMemory => ({ branches: new Set() });

/**
 * Which gate this branch does not satisfy, or `''`.
 *
 * ONE GATE, AND IT IS THE CHANGESET. The AgentMonitor's own rule states why:
 * it is the gate a script can answer from the worktree alone, and the one that
 * was missed. Running the rest of CI to predict CI is a second CI.
 *
 * Measured through `Refs.changedFiles` rather than the finding, because the
 * monitor never reports both at once — its ordering puts `owes a gate` BELOW
 * `owes a review`, so a branch with no PR and no changeset is reported as
 * owing a review and the gate is invisible until the PR exists. The body has
 * to name a gate the finding did not.
 *
 * A refs call that fails answers `''` — the PR is opened either way, and a gate
 * this could not measure is one it must not claim.
 *
 * @param refs where to read the branch's diff
 * @param branch the branch to measure
 * @returns the sentence naming the open gate, or `''`
 */
export const openGateOf = async (refs: Refs, branch: string): Promise<string> => {
  const changed = await refs.changedFiles(branch);
  if (!changed.ok) return '';
  const hasChangeset = changed.value.some(
    (file) => file.startsWith('.changeset/') && file.endsWith('.md'),
  );
  return hasChangeset
    ? ''
    : 'the branch adds no `.changeset/*.md`, so it would land red on the changeset gate';
};

/**
 * Act on one finding, or say why nothing was done.
 *
 * ACT ON THE STATE, NOT THE MESSAGE. The host is asked whether a PR exists
 * before the domain is asked whether to open one, so a finding republished on
 * every interval produces one PR and then a printable refusal. A host that
 * cannot be asked reports a PR present — silence is never permission to open a
 * second one, the direction `plot-pr-merged.sh` already fails in.
 *
 * @param ports the readings and the write
 * @param memory what this run has already opened
 * @param finding the finding as the channel delivered it
 * @returns what was decided, and what it did
 */
export const actOnFinding = async (
  ports: ActingPorts,
  memory: ActedMemory,
  finding: Finding,
): Promise<ActingOutcome> => {
  const branch = finding.branch;
  const licensed = actOn(finding, { hasPr: false, actedThisRun: false, openGate: '' });
  // THE CHEAP REFUSAL FIRST. A `build passed` message must not cost a host
  // round trip to be ignored, and the channel carries far more findings than
  // it carries acts.
  if (!isAct(licensed)) return { branch, decision: licensed, opened: false, url: '', error: '' };

  if (memory.branches.has(branch)) {
    return {
      branch,
      decision: actOn(finding, { hasPr: false, actedThisRun: true, openGate: '' }),
      opened: false,
      url: '',
      error: '',
    };
  }

  const existing = await ports.host.prState(branch);
  // A FAILED LOOKUP READS AS A PR PRESENT. The alternative is to open one on
  // every finding while the host is unreachable, which is the runaway this
  // slice's idempotence clause exists to prevent.
  const hasPr = !existing.ok || existing.value !== null;
  const openGate = await openGateOf(ports.refs, branch);
  const decision = actOn(finding, { hasPr, actedThisRun: false, openGate });
  if (!isAct(decision)) return { branch, decision, opened: false, url: '', error: '' };

  // RECORDED BEFORE THE WRITE, not after. A `prCreate` that threw or timed out
  // may still have opened the PR, and a memory written only on success would
  // let the next message ask again for one that exists.
  memory.branches.add(branch);
  const created = await ports.host.prCreate({
    head: decision.branch,
    title: decision.title,
    body: decision.body,
  });
  if (!created.ok) {
    return {
      branch,
      decision,
      opened: false,
      url: '',
      error: `the host refused to open a PR for ${branch} (${created.why})`,
    };
  }
  return { branch, decision, opened: true, url: created.value, error: '' };
};

/** Re-exported so a caller reading an outcome need not reach past the controller. */
export type { Act, ActDecision };
