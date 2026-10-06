/**
 * Runs an agent turn through `@anthropic-ai/claude-agent-sdk`, in-process.
 *
 * THE ONLY FILE IN THIS PACKAGE THAT IMPORTS THE SDK. It is not exported from
 * `adapters/index.ts`, the barrel 19 board files import, so a caller imports
 * it by its own path and only the bundles that start an agent carry the SDK.
 *
 * A connector: it has an account, a rate limit, and a transport the SDK
 * chooses. Every run carries the three parts of the no-background gate:
 *
 *   1. `CLAUDE_CODE_DISABLE_BACKGROUND_TASKS=1` in the child's `env`.
 *   2. `disallowedTools` names `Monitor`, `ScheduleWakeup`, `CronCreate`,
 *      `TaskStop` and `ListAgents`.
 *   3. A `PreToolUse` hook that asks `pollRefusal` and denies what it refuses.
 *
 * A foreground `Bash` call stays allowed.
 */
import { spawn } from 'node:child_process';
import { constants as fsConstants } from 'node:fs';
import { access, appendFile, readFile } from 'node:fs/promises';
import { constants } from 'node:os';
import { delimiter, join } from 'node:path';

import {
  query,
  type HookCallbackMatcher,
  type ModelUsage,
  type Options,
  type SDKMessage,
  type SpawnedProcess,
  type SpawnOptions,
} from '@anthropic-ai/claude-agent-sdk';

import { answered, type PortResult } from '../../port-result.js';
import type {
  AgentRun,
  AgentRunLimitReading,
  AgentRunRequest,
  AgentRunResult,
  AgentRunUsage,
} from '../../ports/agent-run.js';
import type { Processes } from '../../ports/processes.js';
import { agentSettingsRefusal } from '../../rules/agent-settings.js';
import { agentRunEnv, backgroundSwitchRefusal, type SettingsEnvReading } from '../../rules/agent-run-env.js';
import { pollRefusal } from '../../rules/poll-refusal.js';
import { sdkRunExit, type SdkRunReading } from '../../rules/sdk-run-exit.js';
import { killTree, killTreeSync } from '../bounded-run/bounded-run-process.js';

/** The tools a fleet run disallows outright: each exists only to wait on or manage background work. */
export const BACKGROUND_DISALLOWED_TOOLS: readonly string[] = [
  'Monitor',
  'ScheduleWakeup',
  'CronCreate',
  'TaskStop',
  'ListAgents',
];

/** The tools a `read-only` capability disallows where the prompt file names no list; `PLOT_READ_ONLY_DENY`'s default. */
export const DEFAULT_READ_ONLY_DENY: readonly string[] = ['Write', 'Edit', 'NotebookEdit', 'Bash', 'Agent', 'Task'];

/**
 * The `next` protocol, appended to every prompt this adapter sends. It is
 * Plot's contract with the loop, so a project's prompt file cannot drop it.
 */
export const HAND_BACK_PROTOCOL = [
  'End every turn with the structured hand-back `{ next, summary }`.',
  '`next: checks` means you committed work and want the local checks: the loop runs the commands `plot-local-checks.mjs` prints and resumes this session with the result, so do not run them yourself and do not wait for them.',
  '`next: pushed` means you pushed and the pull request is open: the loop waits for CI and resumes this session with a correction if CI fails.',
  '`next: blocked` means you wrote PLOT-BLOCKED.md with your question.',
  '`next: done` means nothing more is left to do on this slice.',
  'Never wait or poll: background tasks are disabled, and the loop does every wait.',
].join(' ');

/** The JSON schema the `next`/`summary` hand-back is validated against. */
const HAND_BACK_SCHEMA = {
  type: 'object',
  properties: {
    next: { type: 'string', enum: ['checks', 'pushed', 'blocked', 'done'] },
    summary: { type: 'string' },
  },
  required: ['next', 'summary'],
} as const;

/** What this adapter needs beyond the request itself. */
export interface AgentRunSdkDeps {
  /** The parent process's own environment, merged under `agentRunEnv`. */
  readonly inheritedEnv: Readonly<Record<string, string>>;
  /**
   * Reads the `env` key of `~/.claude/settings.json`, `.claude/settings.json`
   * and `.claude/settings.local.json`, fresh, before each run.
   */
  readonly readSettingsFiles: (worktree: string) => Promise<readonly SettingsEnvReading[]>;
  /** The project's `Agent settings` file, parsed; `undefined` where the project names none. */
  readonly agentSettings: unknown;
  /** That file's path, for a refusal's sentence; `''` where the project names none. */
  readonly agentSettingsPath: string;
  /** The `claude` executable resolved from `PATH`; `''` where `PATH` holds none. */
  readonly pathToClaudeCodeExecutable: string;
  /** Spawns the child without `detached`, so a group stop still reaches it. */
  readonly spawnClaudeCodeProcess: (options: SpawnOptions) => SpawnedProcess;
  /** Reads the child's descendants before a stop signals them. */
  readonly processes: Processes;
  /** Epoch seconds. */
  readonly now: () => number;
  /** Whether this run starts after a usage-limit wait. */
  readonly afterWait: boolean;
  /** Commits the desk gained since that wait began, read when the run ends. */
  readonly commitsSinceWait: () => number;
  /** The tools a `read-only` capability disallows. */
  readonly readOnlyDeny: readonly string[];
}

/**
 * Spawns `claude` in the caller's process group: no `detached` key, so the
 * group stop of `plot-dispatch.sh --stop` reaches it (#1084).
 *
 * @param options - what the SDK asks to spawn.
 * @returns the child, with piped stdin and stdout and the caller's stderr.
 */
export const spawnAttached = (options: SpawnOptions): SpawnedProcess =>
  spawn(options.command, options.args, {
    cwd: options.cwd,
    env: options.env,
    stdio: ['pipe', 'pipe', 'inherit'],
    signal: options.signal,
  }) as unknown as SpawnedProcess;

/**
 * Resolves `claude` from a `PATH` value, as a shell would.
 *
 * @param path - the `PATH` value.
 * @returns the first executable `claude` on it; `''` where none is.
 */
export const claudeOnPath = async (path: string): Promise<string> => {
  for (const dir of path.split(delimiter).filter((d) => d !== '')) {
    const candidate = join(dir, 'claude');
    try {
      await access(candidate, fsConstants.X_OK);
      return candidate;
    } catch {
      /* not here */
    }
  }
  return '';
};

/**
 * Reads the `env` key of the three settings files the CLI applies.
 *
 * @param home - the user's home directory.
 * @returns a reader for one worktree; a file that is absent or does not parse
 *   reads as `{}`.
 */
export const settingsFilesOf =
  (home: string) =>
  async (worktree: string): Promise<readonly SettingsEnvReading[]> => {
    const paths = [
      join(home, '.claude', 'settings.json'),
      join(worktree, '.claude', 'settings.json'),
      join(worktree, '.claude', 'settings.local.json'),
    ];
    return Promise.all(
      paths.map(async (path): Promise<SettingsEnvReading> => {
        try {
          const parsed: unknown = JSON.parse(await readFile(path, 'utf8'));
          const env = (parsed as { env?: unknown } | null)?.env;
          return { path, env: typeof env === 'object' && env !== null ? (env as Record<string, string>) : {} };
        } catch {
          return { path, env: {} };
        }
      }),
    );
  };

/** The `PreToolUse` matcher that asks {@link pollRefusal} before every tool call. */
const pollRefusalHook = (): HookCallbackMatcher => ({
  hooks: [
    async (input) => {
      if (input.hook_event_name !== 'PreToolUse') return {};
      const toolInput = (input.tool_input ?? {}) as Record<string, unknown>;
      const path = [toolInput.file_path, toolInput.path].find((p): p is string => typeof p === 'string');
      const reason = pollRefusal(input.tool_name, {
        runInBackground: toolInput.run_in_background === true,
        command: typeof toolInput.command === 'string' ? toolInput.command : '',
        path,
      });
      if (reason === null) return {};
      return {
        hookSpecificOutput: {
          hookEventName: 'PreToolUse',
          permissionDecision: 'deny',
          permissionDecisionReason: reason,
        },
      };
    },
  ],
});

/** Translates the SDK's per-model usage into the port's four counters. */
const usageOf = (usage: ModelUsage): AgentRunUsage => ({
  inputTokens: usage.inputTokens,
  outputTokens: usage.outputTokens,
  cacheCreationTokens: usage.cacheCreationInputTokens,
  cacheReadTokens: usage.cacheReadInputTokens,
});

/** Reads one `rate_limit_event`, unconverted. */
const limitReadingOf = (message: Extract<SDKMessage, { type: 'rate_limit_event' }>): AgentRunLimitReading => ({
  status: message.rate_limit_info.status,
  resetsAt: message.rate_limit_info.resetsAt ?? null,
  rateLimitType: message.rate_limit_info.rateLimitType ?? '',
  utilization: message.rate_limit_info.utilization ?? 0,
});

/** A result for a run that never started. */
const unstarted = (request: AgentRunRequest, detail: string): PortResult<AgentRunResult> =>
  answered({
    sessionId: request.resumeId,
    end: { answer: 'unstarted', detail },
    usageByModel: {},
    costUsd: null,
    turns: 0,
    limitReadings: [],
  });

/** The signals that end the caller; each ends the run's tree, then the caller exits `128 + n`. */
const ENDING_SIGNALS = ['SIGTERM', 'SIGINT', 'SIGHUP'] as const;

/** Exits the caller with the code for `signal`; the `exit` listener then ends the tree. */
const exitOnSignal = (signal: (typeof ENDING_SIGNALS)[number]): void => {
  process.exit(128 + constants.signals[signal]);
};

/** The child's pid, where the spawner returned a `ChildProcess`. */
const pidOf = (child: SpawnedProcess | null): number | undefined => {
  const pid = (child as { pid?: unknown } | null)?.pid;
  return typeof pid === 'number' ? pid : undefined;
};

/** What the stream reported, before `sdkRunExit` classifies it. */
type StreamReading = {
  -readonly [K in
    | 'noResult'
    | 'startupFailureReason'
    | 'subtype'
    | 'numTurns'
    | 'isError'
    | 'terminalReason'
    | 'rateLimitEvent'
    | 'abortedOnBound'
    | 'structuredOutput']: SdkRunReading[K];
};

/**
 * An `AgentRun` that runs the request through the Claude Agent SDK.
 *
 * Before the run it refuses, as `unstarted` with the file named, a settings
 * file whose `env` names the background switch and an `Agent settings` file
 * `agentSettingsRefusal` refuses. On `request.boundSeconds`, on `SIGTERM`,
 * `SIGINT` or `SIGHUP`, and on the caller's exit, it aborts the query and
 * signals the child and its descendants, descendants read first.
 *
 * @param deps - the environment, the settings readings, the spawn and the clock.
 * @returns an `AgentRun` backed by `query()`.
 */
export const agentRunSdk = (deps: AgentRunSdkDeps): AgentRun => ({
  run: async (request: AgentRunRequest): Promise<PortResult<AgentRunResult>> => {
    const switchRefusal = backgroundSwitchRefusal(await deps.readSettingsFiles(request.worktree));
    if (switchRefusal !== null) return unstarted(request, switchRefusal);

    const settingsRefusal = agentSettingsRefusal(deps.agentSettings);
    if (settingsRefusal !== undefined) {
      return unstarted(request, `'${deps.agentSettingsPath}' sets ${settingsRefusal.key}: ${settingsRefusal.why}`);
    }
    if (deps.pathToClaudeCodeExecutable === '') return unstarted(request, 'no `claude` executable is on PATH');

    const log = (line: string): Promise<void> =>
      appendFile(request.logFile, `${line}\n`, 'utf8').catch(() => undefined);
    const disallowed = [...BACKGROUND_DISALLOWED_TOOLS];
    for (const capability of request.capabilities) {
      if (capability === 'read-only') disallowed.push(...deps.readOnlyDeny);
      else await log(`plot-agent-run: charter capability '${capability}' has no mapping; the agent runs unbounded for it`);
    }

    const agentSettings =
      typeof deps.agentSettings === 'object' && deps.agentSettings !== null
        ? (deps.agentSettings as Record<string, unknown>)
        : {};
    const settings =
      request.contextWindow > 0 ? { ...agentSettings, autoCompactWindow: request.contextWindow } : agentSettings;

    let child: SpawnedProcess | null = null;
    const abortController = new AbortController();
    const options: Options = {
      cwd: request.worktree,
      env: agentRunEnv(deps.inheritedEnv, request.env),
      disallowedTools: disallowed,
      hooks: { PreToolUse: [pollRefusalHook()] },
      pathToClaudeCodeExecutable: deps.pathToClaudeCodeExecutable,
      spawnClaudeCodeProcess: (spawnOptions) => {
        child = deps.spawnClaudeCodeProcess(spawnOptions);
        return child;
      },
      abortController,
      resume: request.resumeId !== '' ? request.resumeId : undefined,
      sessionId: request.resumeId === '' && request.sessionId ? request.sessionId : undefined,
      model: request.model !== '' ? request.model : undefined,
      effort: (request.effort !== '' ? request.effort : undefined) as Options['effort'],
      maxTurns: request.maxTurns > 0 ? request.maxTurns : undefined,
      maxBudgetUsd: request.maxSpendUsd > 0 ? request.maxSpendUsd : undefined,
      // `autoCompactWindow` is a `Settings` key, so it travels in the inline
      // settings object beside the project's `Agent settings`, never as `env`.
      settings: Object.keys(settings).length > 0 ? (settings as Options['settings']) : undefined,
      settingSources: ['user', 'project', 'local'],
      outputFormat: { type: 'json_schema', schema: HAND_BACK_SCHEMA },
      permissionMode: 'bypassPermissions',
      allowDangerouslySkipPermissions: true,
    };

    const reading: StreamReading = {
      noResult: true,
      startupFailureReason: null,
      subtype: null,
      numTurns: 0,
      isError: false,
      terminalReason: null,
      rateLimitEvent: null,
      abortedOnBound: false,
      structuredOutput: undefined,
    };
    const seen = { sessionId: request.resumeId, costUsd: null as number | null, turns: 0 };
    let usageByModel: Record<string, AgentRunUsage> = {};
    const limitReadings: AgentRunLimitReading[] = [];

    // THE CHILD'S TREE ENDS WITH THE CALLER: an `exit` listener cannot await,
    // so it walks the tree synchronously, and a signal exits through it.
    const onCallerExit = (): void => {
      const pid = pidOf(child);
      if (pid !== undefined) killTreeSync(pid);
    };
    process.once('exit', onCallerExit);
    for (const signal of ENDING_SIGNALS) process.on(signal, exitOnSignal);

    const startedAt = deps.now();
    let aborted = false;
    const timer =
      request.boundSeconds > 0
        ? setTimeout(() => {
            aborted = true;
            const pid = pidOf(child);
            abortController.abort();
            if (pid !== undefined) void killTree(deps.processes, pid);
          }, request.boundSeconds * 1000)
        : undefined;

    const stream = query({ prompt: `${request.prompt}\n\n${HAND_BACK_PROTOCOL}`, options });
    try {
      for await (const message of stream) {
        await log(JSON.stringify(message));
        if (message.type === 'rate_limit_event') {
          const limit = limitReadingOf(message);
          limitReadings.push(limit);
          reading.rateLimitEvent = { status: limit.status, resetsAt: limit.resetsAt };
          seen.sessionId = message.session_id || seen.sessionId;
        } else if (message.type === 'assistant') {
          seen.turns += 1;
        } else if (message.type === 'result') {
          reading.noResult = false;
          seen.sessionId = message.session_id || seen.sessionId;
          reading.isError = message.is_error;
          reading.numTurns = message.num_turns;
          reading.terminalReason = message.terminal_reason ?? null;
          reading.subtype = message.subtype;
          seen.costUsd = message.total_cost_usd;
          usageByModel = Object.fromEntries(
            Object.entries(message.modelUsage ?? {}).map(([model, usage]) => [model, usageOf(usage)]),
          );
          if (message.subtype === 'success') reading.structuredOutput = message.structured_output;
          else reading.startupFailureReason = message.startup_failure_reason ?? null;
        }
      }
    } catch (error) {
      // A SPAWN THAT FAILED, OR AN ABORT: the reading keeps what arrived, and
      // `sdkRunExit` answers `bound` or `unstarted` from it.
      await log(`plot-agent-run: the query ended with ${(error as Error).message}`);
    } finally {
      if (timer !== undefined) clearTimeout(timer);
      process.removeListener('exit', onCallerExit);
      for (const signal of ENDING_SIGNALS) process.removeListener(signal, exitOnSignal);
      (stream as { close?: () => void }).close?.();
    }

    const exit = sdkRunExit({
      ...reading,
      abortedOnBound: aborted,
      boundSeconds: request.boundSeconds,
      ranSeconds: Math.max(0, deps.now() - startedAt),
      afterWait: deps.afterWait,
      commitsSinceWait: deps.commitsSinceWait(),
      now: deps.now(),
    });
    if (exit.answer === 'unstarted' || (exit.answer === 'ran' && exit.detail !== '')) {
      await log(`plot-agent-run: ${exit.answer}: ${exit.detail}`);
    }
    const end: AgentRunResult['end'] = exit.answer === 'ran' ? { answer: 'ran', handBack: exit.handBack } : exit;

    return answered({
      sessionId: seen.sessionId,
      end,
      usageByModel,
      costUsd: seen.costUsd,
      turns: seen.turns,
      limitReadings,
    });
  },
});
