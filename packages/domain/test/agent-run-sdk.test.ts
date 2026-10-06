import { describe, expect, it, vi } from 'vitest';
import type { AgentRunRequest } from '../src/ports/agent-run.js';

/**
 * THE SDK IS MOCKED AT RESOLUTION, NEVER SPIED.
 *
 * `@anthropic-ai/claude-agent-sdk` spawns a real `claude` process when called
 * for real; a test asserting the exact `Options` this adapter builds needs to
 * intercept the call before any process starts. `vi.hoisted` because the
 * mock factory is hoisted above these imports and cannot close over an
 * ordinary `const`.
 */
const captured = vi.hoisted(() => ({
  options: undefined as unknown,
  prompt: undefined as unknown,
  messages: [] as unknown[],
}));

vi.mock('@anthropic-ai/claude-agent-sdk', () => ({
  query: (args: { prompt: unknown; options: unknown }) => {
    captured.options = args.options;
    captured.prompt = args.prompt;
    const messages = captured.messages;
    return {
      [Symbol.asyncIterator]: () => {
        let i = 0;
        return {
          next: async () => {
            if (i < messages.length) {
              return { done: false, value: messages[i++] };
            }
            return { done: true, value: undefined };
          },
        };
      },
      return: async () => ({ done: true, value: undefined }),
    };
  },
}));

const { agentRunSdk, BACKGROUND_DISALLOWED_TOOLS } = await import('../src/adapters/agent-run/agent-run-sdk.js');

const request = (overrides: Partial<AgentRunRequest> = {}): AgentRunRequest => ({
  worktree: '/estate/.worktrees/x',
  prompt: 'do the work',
  resumeId: '',
  role: 'worker',
  harness: 'claude',
  model: '',
  effort: '',
  maxTurns: 0,
  maxSpendUsd: 0,
  boundSeconds: 0,
  contextWindow: 0,
  capabilities: [],
  env: { PLOT_BRANCH: 'infra/x' },
  logFile: '/estate/.worktrees/x/out.log',
  ...overrides,
});

const baseDeps = (overrides: Partial<Parameters<typeof agentRunSdk>[0]> = {}) => ({
  inheritedEnv: { PATH: '/usr/bin:/bin', HOME: '/home/op' },
  readSettingsFiles: async () => [],
  pathToClaudeCodeExecutable: 'claude',
  spawnClaudeCodeProcess: vi.fn(),
  processes: { descendantsOf: async () => [] } as never,
  now: () => 1_700_000_000,
  afterWait: false,
  commitsSinceWait: 0,
  ...overrides,
});

const resultMessage = (over: Record<string, unknown> = {}) => ({
  type: 'result',
  subtype: 'success',
  session_id: 'session-abc',
  is_error: false,
  num_turns: 3,
  total_cost_usd: 0.42,
  modelUsage: {},
  structured_output: { next: 'pushed', summary: 'done' },
  ...over,
});

describe('agentRunSdk', () => {
  it('passes the merged env (parent PATH/HOME plus PLOT_* plus the background switch), five disallowed tools, a PreToolUse hook, settingSources, spawn without detached', async () => {
    captured.messages = [resultMessage()];
    const spawnFn = vi.fn();
    const adapter = agentRunSdk(baseDeps({ spawnClaudeCodeProcess: spawnFn }));

    await adapter.run(request());

    const options = captured.options as Record<string, unknown>;
    const env = options.env as Record<string, string>;
    // ENV IS MERGED, NOT REPLACED: the SDK's own `env` option replaces the
    // child's environment wholesale, so PATH/HOME must appear here explicitly
    // — a test asserting only the new var would pass even if PATH vanished.
    expect(env.PATH).toBe('/usr/bin:/bin');
    expect(env.HOME).toBe('/home/op');
    expect(env.PLOT_BRANCH).toBe('infra/x');
    expect(env.CLAUDE_CODE_DISABLE_BACKGROUND_TASKS).toBe('1');

    expect(options.disallowedTools).toEqual(expect.arrayContaining([...BACKGROUND_DISALLOWED_TOOLS]));
    expect((options.disallowedTools as string[]).length).toBe(5);

    expect(options.hooks).toBeDefined();
    const hooks = options.hooks as Record<string, unknown[]>;
    expect(hooks.PreToolUse).toBeDefined();
    expect(hooks.PreToolUse.length).toBeGreaterThan(0);

    // SPAWN OPTIONS CARRY NO `detached` KEY AT ALL — the SDK's own
    // `SpawnOptions` type has none, and the group-stop contract (#1084) needs
    // this adapter to never introduce one via a custom spawner either.
    expect(options.spawnClaudeCodeProcess).toBe(spawnFn);
    expect('detached' in options).toBe(false);

    // ALL THREE TIERS NAMED EXPLICITLY — a USER-level settings file (not just
    // a project one) must be read for the background-switch refusal below to
    // hold, so the SDK's own "all sources by default" behaviour is pinned
    // here rather than relied on silently.
    expect(options.settingSources).toEqual(['user', 'project', 'local']);
  });

  it('denies a backgrounded Bash call through the PreToolUse hook', async () => {
    captured.messages = [resultMessage()];
    const adapter = agentRunSdk(baseDeps());
    await adapter.run(request());

    const options = captured.options as { hooks: { PreToolUse: Array<{ hooks: Array<(i: unknown) => Promise<unknown>> }> } };
    const hookFn = options.hooks.PreToolUse[0].hooks[0];

    const verdict = (await hookFn({
      hook_event_name: 'PreToolUse',
      tool_name: 'Bash',
      tool_input: { command: 'sleep 5', run_in_background: true },
      session_id: 's',
      transcript_path: '/t',
      cwd: '/c',
      tool_use_id: 'tu1',
    })) as { hookSpecificOutput?: { permissionDecision?: string } };

    expect(verdict.hookSpecificOutput?.permissionDecision).toBe('deny');
  });

  it('allows a foreground Bash call through the PreToolUse hook', async () => {
    captured.messages = [resultMessage()];
    const adapter = agentRunSdk(baseDeps());
    await adapter.run(request());

    const options = captured.options as { hooks: { PreToolUse: Array<{ hooks: Array<(i: unknown) => Promise<unknown>> }> } };
    const hookFn = options.hooks.PreToolUse[0].hooks[0];

    const verdict = (await hookFn({
      hook_event_name: 'PreToolUse',
      tool_name: 'Bash',
      tool_input: { command: 'pnpm test', run_in_background: false },
      session_id: 's',
      transcript_path: '/t',
      cwd: '/c',
      tool_use_id: 'tu2',
    })) as { hookSpecificOutput?: { permissionDecision?: string } };

    expect(verdict.hookSpecificOutput).toBeUndefined();
  });

  it('ends the run unstarted, naming the file, when a USER-level settings file sets the background switch', async () => {
    captured.messages = [resultMessage()];
    const adapter = agentRunSdk(
      baseDeps({
        readSettingsFiles: async () => [
          {
            path: '~/.claude/settings.json',
            env: { CLAUDE_CODE_DISABLE_BACKGROUND_TASKS: '0' },
            settings: { env: { CLAUDE_CODE_DISABLE_BACKGROUND_TASKS: '0' } },
          },
          { path: '.claude/settings.json', env: {} as Record<string, string>, settings: {} },
          { path: '.claude/settings.local.json', env: {} as Record<string, string>, settings: {} },
        ],
      }),
    );

    const result = await adapter.run(request());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.end.answer).toBe('unstarted');
    if (result.value.end.answer === 'unstarted') {
      expect(result.value.end.detail).toContain('~/.claude/settings.json');
    }
  });

  it('caps autoCompactWindow at the charter-resolved Agent context window value, via the inline settings flag layer', async () => {
    captured.messages = [resultMessage()];
    const adapter = agentRunSdk(baseDeps());
    await adapter.run(request({ contextWindow: 200_000 }));

    const options = captured.options as { settings?: { autoCompactWindow?: number } };
    // `Options` carries no top-level `autoCompactWindow` — the field lives on
    // `Settings`, passed inline through `options.settings` (the SDK's
    // highest-priority "flag settings" tier), never through `env`.
    expect(options.settings?.autoCompactWindow).toBe(200_000);
  });

  it('leaves settings unset when the request names no context window', async () => {
    captured.messages = [resultMessage()];
    const adapter = agentRunSdk(baseDeps());
    await adapter.run(request({ contextWindow: 0 }));

    const options = captured.options as Record<string, unknown>;
    expect(options.settings).toBeUndefined();
  });

  it('ends the run limited when a rejected rate_limit_event arrives even if the run also handed back done', async () => {
    captured.messages = [
      {
        type: 'rate_limit_event',
        rate_limit_info: { status: 'rejected', resetsAt: 1_700_003_600 },
        session_id: 'session-abc',
      },
      resultMessage({ structured_output: { next: 'done', summary: 'finished' }, terminal_reason: null }),
    ];
    const adapter = agentRunSdk(baseDeps());
    const result = await adapter.run(request());

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.end.answer).not.toBe('ran');
  });

  it('ends the run unstarted when no result message arrives at all (a zeroed result)', async () => {
    captured.messages = [];
    const adapter = agentRunSdk(baseDeps());
    const result = await adapter.run(request());

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.end.answer).toBe('unstarted');
  });

  it('runs on the charter-resolved model and effort passed through the request', async () => {
    captured.messages = [resultMessage()];
    const adapter = agentRunSdk(baseDeps());
    await adapter.run(request({ model: 'claude-opus-4-7', effort: 'high' }));

    const options = captured.options as Record<string, unknown>;
    expect(options.model).toBe('claude-opus-4-7');
    expect(options.effort).toBe('high');
  });
});
