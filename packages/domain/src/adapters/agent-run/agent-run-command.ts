/**
 * Runs an agent's configured shell command through `boundedRun`, the way the
 * loop runs it today.
 *
 * This adapter reaches a local process, same as every other non-connector
 * adapter in this package — no account, no credentials, no rate limit, no
 * transport choice. It answers `unaskable` for usage, cost and hand-back: a
 * shell command's stdout is free-form text, not a structured result, so this
 * adapter has nothing to parse those from. The exit itself is read exactly as
 * `promptExit` reads it today, so a project on `Agent runner: command` sees no
 * change in behaviour from before this port existed.
 *
 * **THE FRAGMENT RUNS WITH `request.prompt` AS ITS OWN ARGUMENT, NEVER
 * INTERPOLATED INTO A SHELL STRING.** `deps.fragment` is a shell FRAGMENT
 * (e.g. `claude -p`), sourced as `. "$1" "$2"` with `$1` the fragment's own
 * scratch file and `$2` the prompt text — the two-argument shape
 * `spawn('sh', ['-c', '<fragment> "$@"', …, request.prompt])` used before this
 * adapter existed, carried over rather than redesigned. Passing the prompt as
 * a real positional argument (not string-concatenated into the sourced file)
 * is what keeps a prompt containing a quote or a `$` from being read as shell
 * syntax.
 */
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { answered, failed, type PortResult } from '../../port-result.js';
import type { AgentRun, AgentRunRequest, AgentRunResult } from '../../ports/agent-run.js';
import type { BoundedRun } from '../../ports/bounded-run.js';
import { backgroundGateEnv } from '../../rules/agent-run-env.js';
import { promptExit, type LimitPatterns } from '../../rules/prompt-exit.js';

/** What this adapter needs beyond the request itself. */
export interface AgentRunCommandDeps {
  readonly boundedRun: BoundedRun;
  /** The shell fragment to run, e.g. `claude -p` — read once, not per request. */
  readonly fragment: string;
  /** The command's own basename, for reading its limit-line patterns. */
  readonly limitPatterns: LimitPatterns | undefined;
  /** Epoch milliseconds, for the exit classification's `now`. */
  readonly now: () => number;
}

/**
 * An `AgentRun` that runs `deps.fragment` through `boundedRun`, with
 * `request.prompt` passed as that fragment's own argument.
 *
 * This adapter does not interpret `request.model` or `request.effort` — a
 * shell fragment either already names a model (e.g. `PLOT_MODEL=sonnet`) or
 * does not, and this adapter has no CLI flag vocabulary to inject one with.
 *
 * @param deps - the bounded-run port, the fragment to run, this harness's
 *   limit patterns, and a clock.
 * @returns an `AgentRun` backed by `boundedRun`.
 */
export const agentRunCommand = (deps: AgentRunCommandDeps): AgentRun => ({
  run: async (request: AgentRunRequest): Promise<PortResult<AgentRunResult>> => {
    await writeFile(request.logFile, '', 'utf8');
    const scratchDir = await mkdtemp(join(tmpdir(), 'plot-agent-run-command-'));
    const fragmentFile = join(scratchDir, 'fragment.sh');
    await writeFile(fragmentFile, `${deps.fragment} "$@"`, 'utf8');

    let result;
    try {
      result = await deps.boundedRun.run(
        'env',
        ['-u', 'PLOT_REPO_ROOT', 'bash', '-c', '. "$1" "$2"', '_', fragmentFile, request.prompt],
        {
          cwd: request.worktree,
          env: { ...request.env, ...backgroundGateEnv() },
          boundSeconds: request.boundSeconds,
          outFile: request.logFile,
        },
      );
    } finally {
      await rm(scratchDir, { recursive: true, force: true });
    }
    if (!result.ok) return failed();

    let output = '';
    try {
      output = (await readFile(request.logFile, 'utf8')).split('\n').slice(-200).join('\n');
    } catch {
      /* an unreadable output is an exit with no limit line */
    }

    const status = result.value.status ?? 124;
    const exit = promptExit(
      {
        status,
        output,
        now: Math.floor(deps.now() / 1000),
        boundSeconds: request.boundSeconds,
        ranSeconds: result.value.ranSeconds,
        afterWait: false,
        commitsSinceWait: 0,
      },
      deps.limitPatterns,
    );

    const end = ((): AgentRunResult['end'] => {
      switch (exit.answer) {
        case 'wait':
          return { answer: 'wait', resetEpoch: exit.reset.epoch };
        case 'end-limited':
          return { answer: 'end-limited', cause: exit.cause };
        case 'unstarted':
          return { answer: 'unstarted', detail: 'the command exited without the agent doing any work' };
        case 'dropped':
          return { answer: 'dropped', line: exit.line };
        case 'ran':
          return { answer: 'ran', handBack: null };
        default:
          return exit satisfies never;
      }
    })();

    return answered({
      sessionId: request.resumeId,
      end,
      // UNASKABLE, NOT EMPTY-AS-ZERO: a shell command's stdout is free-form
      // text this adapter does not parse for usage. `{}` means "none
      // reported" on this port (see AgentRunResult's own doc), which is
      // exactly this adapter's situation — it never asked.
      usageByModel: {},
      costUsd: null,
      costUsdByModel: {},
      turns: 0,
      limitReadings: [],
      // UNASKABLE, AS ABOVE: a `command` run has no connector to ask.
      account: null,
    });
  },
});
