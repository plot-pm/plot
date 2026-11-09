// The worker wrapper: `plot-worker-wrapper.mjs`, one process per agent launch.
//
// It starts the `Worker command` as `sh -c`, outlives it, and leaves the records
// `start_worker`'s inline `sh -c` wrapper leaves: `.plot-worker.wrapper.pid`,
// `.plot-worker.pid`, `.plot-worker.pid.startedAt`, the manifest stamp, one
// WorkerMonitor line, and `.plot-worker.exit`. It reads the environment that
// `start_worker` exports and takes the command as its one argument.
import { realpathSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { endEntry } from '@plot-pm/domain/adapters/entry-exit';
import { agentStartShell, workerRecordsFile } from '@plot-pm/domain/adapters/worker-records/worker-records-file';
import { deskMonitorsShell } from '@plot-pm/domain/adapters/desk-monitors/desk-monitors-shell';
import type { AgentStart, WorkerRecords } from '@plot-pm/domain/ports/worker-records';
import { watchedDesk } from '@plot-pm/domain/rules/desk-manifest';
import { agentExitCode, monitorTime, workerEnding, workerEndingLine } from '@plot-pm/domain/rules/worker-ending';

import { writeManifestStamp, type Stamp } from '../../shared/manifest-stamp.js';

/** What the wrapper reads from `start_worker`'s environment. */
export interface WrapperInput {
  /** The `Worker command` text. */
  command: string;
  /** `PLOT_BRANCH`. */
  branch: string;
  /** `PLOT_WORKTREE`: the desk the agent starts on. */
  worktree: string;
  /** `PLOT_MANIFEST_FILE`; `''` when unset. */
  manifestFile: string;
  /** `PLOT_STAMP_STARTED`: the launch time the manifest stamp records. */
  stampStarted: string;
  /** `PLOT_AGENT_MONITOR`: the AgentMonitor script; `''` for none. */
  agentMonitor: string;
  /** `PLOT_SCRIPT_DIR`: put first on the agent's `PATH`. */
  scriptDir: string;
  /** `PLOT_PID_FILE`: the agent pid file the AgentMonitor watches. */
  pidFile: string;
  /** The environment the agent inherits, before `PATH` is prefixed. */
  env: Readonly<Record<string, string | undefined>>;
}

/** What the wrapper reaches. Each is a port or a function over one. */
export interface WrapperDeps {
  records: WorkerRecords;
  agents: AgentStart;
  /** Starts the AgentMonitor and returns its pid, `''` for none. */
  startMonitor: (input: WrapperInput) => string;
  /** Stamps the manifest; a no-op when the file is absent. */
  stamp: (manifestFile: string, stamp: Stamp) => boolean;
  /** Makes `SIGTERM` to the wrapper do nothing. */
  ignoreTerm: () => void;
  /** The wrapper's own pid. */
  pid: number;
  /** Milliseconds since the epoch. */
  now: () => number;
}

/** The variables `start_worker` exports that the wrapper cannot run without. */
const REQUIRED = ['PLOT_EXIT_FILE', 'PLOT_PID_FILE', 'PLOT_PID_STARTED_FILE', 'PLOT_WRAPPER_PID_FILE'] as const;

/**
 * Reads the wrapper's input from its argv and environment.
 *
 * @param argv - the arguments after the script; the first is the command.
 * @param env - the process environment.
 * @returns the input, or the reason it cannot run.
 */
export const wrapperInput = (
  argv: readonly string[],
  env: Readonly<Record<string, string | undefined>>,
): { ok: true; input: WrapperInput } | { ok: false; why: string } => {
  const command = argv[0] ?? '';
  if (argv.length !== 1 || command === '') return { ok: false, why: 'usage: plot-worker-wrapper.mjs <worker command>' };
  const missing = REQUIRED.filter((key) => (env[key] ?? '') === '');
  if (missing.length > 0) return { ok: false, why: `plot-worker-wrapper: ${missing.join(', ')} unset` };
  return {
    ok: true,
    input: {
      command,
      branch: env.PLOT_BRANCH ?? '',
      worktree: env.PLOT_WORKTREE ?? '',
      manifestFile: env.PLOT_MANIFEST_FILE ?? '',
      stampStarted: env.PLOT_STAMP_STARTED ?? '',
      agentMonitor: env.PLOT_AGENT_MONITOR ?? '',
      scriptDir: env.PLOT_SCRIPT_DIR ?? '',
      pidFile: env.PLOT_PID_FILE ?? '',
      env,
    },
  };
};

/**
 * Runs one agent launch to its end, in the order the `sh` wrapper uses: the
 * wrapper pid and its start, the AgentMonitor, the agent, `SIGTERM` ignored,
 * the agent pid and its start, the manifest stamp; then, once the agent ends,
 * one WorkerMonitor line into the watched desk and the exit code.
 *
 * @param input - the command and the environment `start_worker` set.
 * @param deps - the ports.
 * @returns 0 once the exit code is written; 1 when no agent started.
 */
export const runWorkerWrapper = async (input: WrapperInput, deps: WrapperDeps): Promise<number> => {
  const { records } = deps;
  records.writeWrapperPid(deps.pid);
  const wrapperStarted = records.startedText(deps.pid);
  const agentMonitorPid = input.agentMonitor === '' ? '' : deps.startMonitor(input);

  const pathPrefix = input.scriptDir === '' ? '' : `${input.scriptDir}:`;
  const agent = deps.agents.start(input.command, { ...input.env, PATH: `${pathPrefix}${input.env.PATH ?? ''}` });
  deps.ignoreTerm();
  if (agent === null) {
    records.writeExit(127);
    return 1;
  }

  records.writeAgentPid(agent.pid);
  const agentStarted = records.startedText(agent.pid);
  records.writeAgentStarted(agentStarted);
  deps.stamp(input.manifestFile, {
    pid: String(agent.pid),
    pidStartedAt: agentStarted,
    startedAt: input.stampStarted,
    wrapperPid: String(deps.pid),
    wrapperPidStartedAt: wrapperStarted,
    workerMonitorPid: '',
    agentMonitorPid,
  });

  const code = agentExitCode(await agent.ended);
  const desk = watchedDesk({ launched: input.worktree, manifestWorktree: records.manifestWorktree(input.manifestFile) });
  if (desk !== '') {
    records.appendFinding(
      desk,
      workerEndingLine({ branch: input.branch, desk, ending: workerEnding(code, agent.pid), at: monitorTime(deps.now()) }),
    );
  }
  records.writeExit(code);
  return 0;
};

/**
 * The production ports: the desk files `start_worker` names, an `sh -c` agent
 * start, the AgentMonitor through `deskMonitorsShell`, and the manifest stamp.
 *
 * @param env - the process environment.
 * @returns the deps.
 */
export const productionDeps = (env: Readonly<Record<string, string | undefined>>): WrapperDeps => ({
  records: workerRecordsFile({
    exitFile: env.PLOT_EXIT_FILE ?? '',
    pidFile: env.PLOT_PID_FILE ?? '',
    pidStartedFile: env.PLOT_PID_STARTED_FILE ?? '',
    wrapperPidFile: env.PLOT_WRAPPER_PID_FILE ?? '',
  }),
  agents: agentStartShell(),
  startMonitor: (input) => {
    const monitors = deskMonitorsShell({ repoRoot: input.worktree, scriptDir: path.dirname(input.agentMonitor) });
    const started = monitors.start({
      branch: input.branch,
      worktree: input.worktree,
      manifestFile: input.manifestFile,
      pidFile: input.pidFile,
      log: '/dev/stdout',
    });
    return started.ok ? started.value.agentMonitorPid : '';
  },
  stamp: writeManifestStamp,
  ignoreTerm: () => {
    process.on('SIGTERM', () => undefined);
  },
  pid: process.pid,
  now: Date.now,
});

// Only when RUN, never when imported. `pathToFileURL` over `realpathSync`
// because `import.meta.url` is realpath-resolved and `process.argv[1]` is not.
if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  const read = wrapperInput(process.argv.slice(2), process.env);
  if (!read.ok) {
    process.stderr.write(`${read.why}\n`);
    void endEntry(2);
  } else {
    void runWorkerWrapper(read.input, productionDeps(process.env)).then(endEntry);
  }
}
