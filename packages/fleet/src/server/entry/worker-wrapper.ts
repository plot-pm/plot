// The worker wrapper: `plot-worker-wrapper.mjs`, one process per agent launch.
//
// It starts the `Worker command` as `bash -c`, outlives it, and leaves the records
// `start_worker`'s inline `sh -c` wrapper left: `.plot-worker.wrapper.pid`,
// `.plot-worker.pid`, `.plot-worker.pid.startedAt`, the manifest stamp, one
// WorkerMonitor line, and `.plot-worker.exit`. Before the agent starts it makes
// the desk's liveness token, `.plot-worker.token.fifo`, and hands it to the
// agent as fd 3. It reads the environment that `start_worker` exports and takes
// the command as its one argument.
import { realpathSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { endEntry } from '@plot-pm/domain/adapters/entry-exit';
import { agentStartShell, workerRecordsFile } from '@plot-pm/domain/adapters/worker-records/worker-records-file';
import { deskMonitorsShell } from '@plot-pm/domain/adapters/desk-monitors/desk-monitors-shell';
import { livenessTokenFifo } from '@plot-pm/domain/adapters/liveness-token/liveness-token-fifo';
import type { LivenessToken } from '@plot-pm/domain/ports/liveness-token';
import type { AgentStart, LaunchRecords } from '@plot-pm/domain/ports/worker-records';
import { TOKEN_FD, TOKEN_FD_ENV } from '@plot-pm/domain/rules/worker-liveness';
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
  records: LaunchRecords;
  agents: AgentStart;
  /** Makes the desk's liveness token. */
  token: LivenessToken;
  /** Writes one line to the desk log, the wrapper's stdout. */
  log: (line: string) => void;
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
 * Runs one agent launch to its end: the wrapper pid and its start, the
 * AgentMonitor, the liveness token, the earlier exit record removed, the agent
 * with the token on fd 3, `SIGTERM` ignored, the agent pid and its start, the
 * manifest stamp; then, once the agent ends, one WorkerMonitor line into the
 * watched desk, the exit code, and the wrapper's own token copy closed.
 *
 * The wrapper closes its own copy of the token after it writes the exit
 * record, so the token never reads released while the record is missing and
 * the wrapper lives. A token that cannot be made leaves no
 * file at the token path; the desk log names the reason, the manifest records
 * `token: none (<reason>)`, and the agent starts with no token.
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

  const made = input.worktree === '' ? { ok: false as const, reason: 'no desk named' } : deps.token.make(input.worktree);
  if (!made.ok) deps.log(`plot-worker-wrapper: no liveness token: ${made.reason}`);
  records.removeExit();

  const pathPrefix = input.scriptDir === '' ? '' : `${input.scriptDir}:`;
  const { [TOKEN_FD_ENV]: _inherited, ...env } = input.env;
  const agentEnv = { ...env, PATH: `${pathPrefix}${input.env.PATH ?? ''}`, ...(made.ok ? { [TOKEN_FD_ENV]: String(TOKEN_FD) } : {}) };
  const agent = deps.agents.start(input.command, agentEnv, made.ok ? made.token.fd : null);
  // THE WRAPPER HOLDS ITS COPY UNTIL THE EXIT RECORD IS WRITTEN: a token that
  // released before `.plot-worker.exit` existed would read as a worker that
  // ended with no record.
  const release = (): void => {
    if (made.ok) deps.token.close(made.token);
  };
  deps.ignoreTerm();
  if (agent === null) {
    records.writeExit(127);
    release();
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
    token: made.ok ? made.token.path : `none (${made.reason})`,
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
  release();
  return 0;
};

/**
 * The production ports: the desk files `start_worker` names, a `bash -c` agent
 * start, the FIFO token, the AgentMonitor through `deskMonitorsShell`, and the
 * manifest stamp.
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
  token: livenessTokenFifo(),
  log: (line) => {
    process.stdout.write(`${line}\n`);
  },
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
