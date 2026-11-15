// The AgentMonitor's findings, written by fleetd on every scan and by the
// worker wrapper when no fleetd runs.
import { agentsFs, deskFs, hostShell, refsGit, treesGit } from '@plot-pm/domain/adapters';
import { fleetdHeartbeatFile } from '@plot-pm/domain/adapters/fleetd-heartbeat/fleetd-heartbeat-file';
import type { ShellContext } from '@plot-pm/domain/adapters/scripts';
import type { WorkerState } from '@plot-pm/domain/entities/fleet';
import type { Finding } from '@plot-pm/domain/entities/finding';
import { fleetdLiveness } from '@plot-pm/domain/rules/fleetd-live';
import { monitorTime } from '@plot-pm/domain/rules/worker-ending';
import {
  finalAgentFinding,
  writeAgentFindings,
  type AgentFindingPorts,
  type FinalPassPorts,
} from '@plot-pm/domain/workflows/agent-findings';
import type { BranchStageReadings } from '@plot-pm/domain/workflows/plan-walk-branches';
import type { DeskStageReadings } from '@plot-pm/domain/workflows/plan-walk-desks';

/**
 * fleetd's findings writer for the fleet walk: one worker-state memory per
 * process, so a desk's final pass runs once per agent end and once at start.
 *
 * @param context - the repository and its scripts.
 * @param warn - receives one line when a pass throws; the scan goes on.
 * @param now - the clock; `Date.now` by default.
 * @param ports - the desk files and the host; the repository's own by default.
 * @returns the walk's `findings` hook.
 */
export const agentFindingsOver = (
  context: ShellContext,
  warn: (line: string) => void,
  now: () => number = Date.now,
  ports: AgentFindingPorts = { desk: deskFs(treesGit(context)), host: hostShell(context) },
): ((branches: BranchStageReadings, desks: DeskStageReadings) => Promise<void>) => {
  const states = new Map<string, WorkerState>();
  return async (branches, desks) => {
    try {
      await writeAgentFindings(ports, states, branches, desks, monitorTime(now()));
    } catch (err) {
      warn(`plot-fleetd: the AgentMonitor findings were not written: ${(err as Error).message}\n`);
    }
  };
};

/** What the wrapper's final pass reaches. */
export interface WrapperFinalPassDeps {
  /** Whether fleetd's heartbeat reads live. */
  readonly fleetdLive: () => Promise<boolean>;
  /** The ports the final pass reads through. */
  readonly ports: FinalPassPorts;
  /** Milliseconds since the epoch. */
  readonly now: () => number;
}

/**
 * The worker wrapper's final pass: with no live fleetd heartbeat, one
 * AgentMonitor pass over the desk and one host `pr-state`; with a live one,
 * nothing, because fleetd runs it.
 *
 * @param deps - the heartbeat reading, the ports and the clock.
 * @param input - the branch and the desk the agent ended on.
 * @returns the line written, or `null`.
 */
export const wrapperFinalPass = async (
  deps: WrapperFinalPassDeps,
  input: { readonly branch: string; readonly worktree: string },
): Promise<Finding | null> => {
  if (input.branch === '' || input.worktree === '' || (await deps.fleetdLive())) return null;
  return finalAgentFinding(deps.ports, { ...input, at: monitorTime(deps.now()), who: 'plot-worker-wrapper' });
};

/**
 * The production deps of {@link wrapperFinalPass} for one desk.
 *
 * @param context - the desk as the repository, and the scripts directory.
 * @returns the deps.
 */
export const wrapperFinalPassDeps = (context: ShellContext): WrapperFinalPassDeps => {
  const trees = treesGit(context);
  return {
    fleetdLive: async () => {
      const heartbeat = await fleetdHeartbeatFile({ repoRoot: context.repoRoot }).read();
      return heartbeat.ok && fleetdLiveness(heartbeat.value, Date.now()) === 'live';
    },
    ports: {
      desk: deskFs(trees),
      host: hostShell(context),
      agents: agentsFs(context),
      trees,
      refs: refsGit(context),
    },
    now: Date.now,
  };
};
