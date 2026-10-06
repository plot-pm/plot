/**
 * Runs an agent turn through `@anthropic-ai/claude-agent-sdk`, in-process.
 *
 * THE ONLY FILE IN THIS PACKAGE THAT IMPORTS THE SDK. It is not exported from
 * `adapters/index.ts` — the barrel 19 board files import — so a caller reaches
 * it by its own path, the way `prompt-exit.ts` is reached by `limit-lines.ts`.
 *
 * A connector, not a shell adapter: it has an account, a rate limit, and a
 * transport choice the SDK makes for it. The three parts of the no-background
 * gate are built here and nowhere else — a fresh request not carrying them is
 * a defect in THIS file, never in the caller:
 *
 *   1. `CLAUDE_CODE_DISABLE_BACKGROUND_TASKS=1` in the child's `env`.
 *   2. `disallowedTools` names `Monitor`, `ScheduleWakeup`, `CronCreate`,
 *      `TaskStop`, `ListAgents` — the tools whose only purpose is to wait on
 *      or manage background work.
 *   3. A `PreToolUse` hook asking `pollRefusal`, which catches the shapes the
 *      disallow list cannot: a backgrounded `Bash`/`Agent` call, a `sleep`/
 *      `wait`/`ps`-shaped command, a read of a background task's output file.
 *
 * Foreground `Bash` stays allowed — it has its own 600,000ms limit and is how
 * the worker does its own work.
 */
import { query, type HookCallbackMatcher, type ModelUsage, type Options, type SDKMessage } from '@anthropic-ai/claude-agent-sdk';

import { answered, type PortResult } from '../../port-result.js';
import type {
  AgentHandBack,
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

/** The tools a fleet run disallows outright — every one exists only to wait on or manage background work. */
export const BACKGROUND_DISALLOWED_TOOLS: readonly string[] = [
  'Monitor',
  'ScheduleWakeup',
  'CronCreate',
  'TaskStop',
  'ListAgents',
];

/** One settings file this adapter reads before every run, to build a {@link SettingsEnvReading}. */
export interface SettingsFileReading {
  /** The file's path, for the refusal's own sentence. */
  readonly path: string;
  /** The file's `env` object, if it parsed and had one; `{}` otherwise. */
  readonly env: Readonly<Record<string, string>>;
  /** The whole parsed settings object, for {@link agentSettingsRefusal}; `undefined` where it did not parse. */
  readonly settings: unknown;
}

/** What this adapter needs beyond the request itself. */
export interface AgentRunSdkDeps {
  /** The parent process's own environment, merged under `agentRunEnv`. */
  readonly inheritedEnv: Readonly<Record<string, string>>;
  /**
   * Reads the three settings files (`~/.claude/settings.json`,
   * `.claude/settings.json`, `.claude/settings.local.json`) fresh, in that
   * order, before this run starts.
   */
  readonly readSettingsFiles: () => Promise<readonly SettingsFileReading[]>;
  /** Resolves the Claude Code executable from `PATH`; no bundled binary. */
  readonly pathToClaudeCodeExecutable: string;
  /** Spawns the child without `detached`, so a group stop still reaches it. */
  readonly spawnClaudeCodeProcess: NonNullable<Options['spawnClaudeCodeProcess']>;
  /** Reads a process's descendants before a stop signals them. */
  readonly processes: Processes;
  /** Epoch seconds, for the exit classification's `now`. */
  readonly now: () => number;
  /** Whether this run started after a limit wait — carried into `sdkRunExit`. */
  readonly afterWait: boolean;
  /** Commits the desk gained since that wait began — carried into `sdkRunExit`. */
  readonly commitsSinceWait: number;
}

/** The JSON schema the worker protocol's `next`/`summary` hand-back is validated against. */
const HAND_BACK_SCHEMA = {
  type: 'object',
  properties: {
    next: { type: 'string', enum: ['checks', 'pushed', 'blocked', 'done'] },
    summary: { type: 'string' },
  },
  required: ['next', 'summary'],
} as const;

/**
 * Builds the `PreToolUse` hook matcher that asks {@link pollRefusal} before
 * every tool call, denying the ones the disallow list cannot name.
 */
const pollRefusalHook = (): HookCallbackMatcher => ({
  hooks: [
    async (input) => {
      if (input.hook_event_name !== 'PreToolUse') return {};
      const toolInput = (input.tool_input ?? {}) as Record<string, unknown>;
      const reason = pollRefusal(input.tool_name, {
        runInBackground: toolInput.run_in_background === true,
        command: typeof toolInput.command === 'string' ? toolInput.command : '',
        path: typeof toolInput.path === 'string' ? toolInput.path : undefined,
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

/** Translates the SDK's per-model usage shape into this port's four-counter record. */
const usageOf = (usage: ModelUsage): AgentRunUsage => ({
  inputTokens: usage.inputTokens,
  outputTokens: usage.outputTokens,
  cacheCreationTokens: usage.cacheCreationInputTokens,
  cacheReadTokens: usage.cacheReadInputTokens,
});

/** Reads one `rate_limit_event` into the shape `sdkRunExit` reads. */
const limitReadingOf = (message: Extract<SDKMessage, { type: 'rate_limit_event' }>): AgentRunLimitReading => ({
  status: message.rate_limit_info.status,
  resetsAt: message.rate_limit_info.resetsAt ?? null,
  rateLimitType: message.rate_limit_info.rateLimitType ?? '',
  utilization: message.rate_limit_info.utilization ?? 0,
});

/**
 * An `AgentRun` that runs the request through the Claude Agent SDK.
 *
 * @param deps - the environment, settings readings, spawn function and clock
 *   this connector needs.
 * @returns an `AgentRun` backed by `query()`.
 */
export const agentRunSdk = (deps: AgentRunSdkDeps): AgentRun => ({
  run: async (request: AgentRunRequest): Promise<PortResult<AgentRunResult>> => {
    const settingsFiles = await deps.readSettingsFiles();

    const switchRefusal = backgroundSwitchRefusal(
      settingsFiles.map((file): SettingsEnvReading => ({ path: file.path, env: file.env })),
    );
    if (switchRefusal !== null) {
      return answered({
        sessionId: request.resumeId,
        end: { answer: 'unstarted', detail: switchRefusal },
        usageByModel: {},
        costUsd: null,
        turns: 0,
        limitReadings: [],
      });
    }

    for (const file of settingsFiles) {
      const refusal = agentSettingsRefusal(file.settings);
      if (refusal !== undefined) {
        return answered({
          sessionId: request.resumeId,
          end: { answer: 'unstarted', detail: `'${file.path}' ${refusal.why}` },
          usageByModel: {},
          costUsd: null,
          turns: 0,
          limitReadings: [],
        });
      }
    }

    const env = agentRunEnv(deps.inheritedEnv, request.env as Record<string, string>);

    const options: Options = {
      cwd: request.worktree,
      env: env as Record<string, string | undefined>,
      disallowedTools: [...BACKGROUND_DISALLOWED_TOOLS],
      hooks: { PreToolUse: [pollRefusalHook()] },
      pathToClaudeCodeExecutable: deps.pathToClaudeCodeExecutable,
      spawnClaudeCodeProcess: deps.spawnClaudeCodeProcess,
      resume: request.resumeId !== '' ? request.resumeId : undefined,
      model: request.model !== '' ? request.model : undefined,
      effort: (request.effort !== '' ? request.effort : undefined) as Options['effort'],
      maxTurns: request.maxTurns > 0 ? request.maxTurns : undefined,
      maxBudgetUsd: request.maxSpendUsd > 0 ? request.maxSpendUsd : undefined,
      // THE INLINE `settings` FLAG LAYER, NOT A TOP-LEVEL OPTION: `Options`
      // carries no `autoCompactWindow` field of its own — the field lives on
      // `Settings`, the shape a settings FILE takes, and `options.settings`
      // is where an inline one is passed at the SDK's highest-priority
      // "flag settings" tier. It names `autoCompactWindow` only, never `env`
      // — an `env` key here would trip `agentSettingsRefusal`'s own refusal.
      settings:
        request.contextWindow > 0 ? { autoCompactWindow: request.contextWindow } : undefined,
      // ALL THREE TIERS, NAMED RATHER THAN LEFT TO THE SDK'S OWN DEFAULT: the
      // background-switch refusal above only holds if the user-level file is
      // actually read, so this pins the behaviour the refusal depends on
      // rather than trusting an unstated default to keep including it.
      settingSources: ['user', 'project', 'local'],
      outputFormat: { type: 'json_schema', schema: HAND_BACK_SCHEMA },
      permissionMode: 'bypassPermissions',
      allowDangerouslySkipPermissions: true,
    };

    let noResult = true;
    let startupFailureReason: string | null = null;
    let subtype: SdkRunReading['subtype'] = null;
    let numTurns = 0;
    let isError = false;
    let terminalReason: string | null = null;
    let rateLimitEvent: SdkRunReading['rateLimitEvent'] = null;
    let structuredOutput: unknown;
    let sessionId = request.resumeId;
    let usageByModel: Record<string, AgentRunUsage> = {};
    let costUsd: number | null = null;
    const limitReadings: AgentRunLimitReading[] = [];

    const stream = query({ prompt: request.prompt, options });
    try {
      for await (const message of stream) {
        if (message.type === 'rate_limit_event') {
          const reading = limitReadingOf(message);
          limitReadings.push(reading);
          rateLimitEvent = { status: reading.status, resetsAt: reading.resetsAt };
          sessionId = message.session_id || sessionId;
          continue;
        }
        if (message.type === 'assistant') {
          numTurns += 1;
        }
        if (message.type === 'result') {
          noResult = false;
          sessionId = message.session_id || sessionId;
          isError = message.is_error;
          numTurns = message.num_turns;
          terminalReason = message.terminal_reason ?? null;
          costUsd = message.total_cost_usd;
          usageByModel = Object.fromEntries(
            Object.entries(message.modelUsage).map(([model, usage]) => [model, usageOf(usage)]),
          );
          if (message.subtype === 'success') {
            subtype = 'success';
            structuredOutput = message.structured_output;
          } else {
            subtype = message.subtype;
            startupFailureReason = message.startup_failure_reason ?? null;
          }
        }
      }
    } finally {
      stream.return?.(undefined);
    }

    const reading: SdkRunReading = {
      noResult,
      startupFailureReason,
      subtype,
      numTurns,
      isError,
      terminalReason,
      rateLimitEvent,
      abortedOnBound: false,
      structuredOutput,
      boundSeconds: request.boundSeconds,
      ranSeconds: 0,
      afterWait: deps.afterWait,
      commitsSinceWait: deps.commitsSinceWait,
      now: deps.now(),
    };

    const exit = sdkRunExit(reading);
    const end = ((): AgentRunResult['end'] => {
      switch (exit.answer) {
        case 'unstarted':
          return { answer: 'unstarted', detail: exit.detail };
        case 'wait':
          return { answer: 'wait', resetEpoch: exit.resetEpoch };
        case 'end-limited':
          return { answer: 'end-limited', cause: exit.cause };
        case 'bound':
          return { answer: 'bound' };
        case 'turn-limit':
          return { answer: 'turn-limit' };
        case 'spend-limit':
          return { answer: 'spend-limit' };
        case 'ran': {
          const handBack: AgentHandBack | null = exit.handBack;
          return { answer: 'ran', handBack };
        }
        default:
          return exit satisfies never;
      }
    })();

    return answered({
      sessionId,
      end,
      usageByModel,
      costUsd,
      turns: numTurns,
      limitReadings,
    });
  },
});
