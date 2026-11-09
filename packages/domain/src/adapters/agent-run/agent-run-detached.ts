/**
 * Starts an agent's configured shell command through `plot-detached-run.mjs`,
 * which re-parents the run to `init` and records its end in the run's state
 * files. The command runs as `agent-run-command` runs it:
 * `bash -c '<fragment> "$@"' _ <prompt>`, with the prompt as its own argument.
 */
import { execFile } from 'node:child_process';
import path from 'node:path';

import { answered, failed, type PortResult } from '../../port-result.js';
import type { DetachedRun, DetachedRunRequest } from '../../ports/agent-run.js';
import { backgroundGateEnv } from '../../rules/agent-run-env.js';
import { spawnContractEnv } from '../../rules/spawn-contract.js';

/** What this adapter needs. */
export interface AgentRunDetachedDeps {
  /** The directory that holds `plot-detached-run.mjs`. */
  readonly scriptDir: string;
  /** The harness whose limit lines classify the run's exit, such as `claude`. */
  readonly harness: string;
}

/**
 * Builds a {@link DetachedRun} over `plot-detached-run.mjs`.
 *
 * @param deps - where the launcher lives.
 * @returns a `DetachedRun` backed by the launcher.
 */
export const agentRunDetached = (deps: AgentRunDetachedDeps): DetachedRun => ({
  start: (request: DetachedRunRequest): Promise<PortResult<number>> =>
    new Promise((resolve) => {
      const args = [
        path.join(deps.scriptDir, 'plot-detached-run.mjs'),
        request.role,
        deps.harness,
        request.logFile,
        String(request.boundSeconds),
        ...request.stateFiles,
        '--',
        'env',
        '-u',
        'PLOT_REPO_ROOT',
        'bash',
        '-c',
        `${request.fragment} "$@"`,
        '_',
        request.prompt,
      ];
      execFile(
        process.execPath,
        args,
        { cwd: request.cwd, env: { ...process.env, ...request.env, ...backgroundGateEnv(), ...spawnContractEnv() } },
        (err, stdout) => {
          const pid = Number(stdout.trim());
          resolve(err || !Number.isInteger(pid) || pid <= 0 ? failed<number>() : answered(pid));
        },
      );
    }),
});
