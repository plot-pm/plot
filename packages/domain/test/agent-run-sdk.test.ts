import { execFileSync } from 'node:child_process';
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { AgentRunRequest } from '../src/ports/agent-run.js';
import { processesShell } from '../src/adapters/processes/processes-shell.js';

/**
 * THE SDK IS MOCKED AT RESOLUTION. `query()` starts a real `claude` process;
 * a test of the options this adapter builds intercepts the call before any
 * process starts. A test may set `captured.stream` to replace the replayed
 * messages with its own generator.
 */
const captured = vi.hoisted(() => ({
  options: undefined as unknown,
  prompt: undefined as unknown,
  messages: [] as unknown[],
  stream: undefined as undefined | ((options: Record<string, unknown>) => AsyncGenerator<unknown>),
}));

vi.mock('@anthropic-ai/claude-agent-sdk', () => ({
  query: (args: { prompt: unknown; options: Record<string, unknown> }) => {
    captured.options = args.options;
    captured.prompt = args.prompt;
    if (captured.stream) return captured.stream(args.options);
    const messages = captured.messages;
    return (async function* () {
      for (const message of messages) yield message;
    })();
  },
}));

const sdk = await import('../src/adapters/agent-run/agent-run-sdk.js');
const { agentRunSdk, BACKGROUND_DISALLOWED_TOOLS, DEFAULT_READ_ONLY_DENY, HAND_BACK_PROTOCOL } = sdk;

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'agent-run-sdk-test-'));
  captured.messages = [];
  captured.stream = undefined;
  captured.options = undefined;
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

const request = (overrides: Partial<AgentRunRequest> = {}): AgentRunRequest => ({
  worktree: dir,
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
  env: { PLOT_BRANCH: 'infra/x', PLOT_WORKTREE: '/estate/x' },
  logFile: join(dir, 'out.log'),
  ...overrides,
});

const baseDeps = (overrides: Partial<Parameters<typeof agentRunSdk>[0]> = {}): Parameters<typeof agentRunSdk>[0] => ({
  inheritedEnv: { PATH: '/usr/bin:/bin', HOME: '/home/op' },
  readSettingsFiles: async () => [],
  agentSettings: undefined,
  agentSettingsPath: '',
  pathToClaudeCodeExecutable: '/usr/local/bin/claude',
  spawnClaudeCodeProcess: vi.fn(),
  processes: { childrenOf: async () => ({ ok: true, value: [] }) } as never,
  now: () => 1_700_000_000,
  afterWait: false,
  commitsSinceWait: () => 0,
  readOnlyDeny: DEFAULT_READ_ONLY_DENY,
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

const ended = async (overrides: Partial<AgentRunRequest> = {}, deps = baseDeps()) => {
  const result = await agentRunSdk(deps).run(request(overrides));
  if (!result.ok) throw new Error('the adapter failed');
  return result.value;
};

const hook = () => {
  const options = captured.options as { hooks: { PreToolUse: Array<{ hooks: Array<(i: unknown) => Promise<unknown>> }> } };
  return options.hooks.PreToolUse[0]!.hooks[0]!;
};

const toolCall = (tool_name: string, tool_input: Record<string, unknown>) => ({
  hook_event_name: 'PreToolUse',
  tool_name,
  tool_input,
  session_id: 's',
  transcript_path: '/t',
  cwd: '/c',
  tool_use_id: 'tu',
});

describe('agentRunSdk: the options it passes', () => {
  it('merges the env, names five disallowed tools, a PreToolUse hook and all three setting sources', async () => {
    captured.messages = [resultMessage()];
    await ended();
    const options = captured.options as Record<string, unknown>;
    const env = options.env as Record<string, string>;
    // PATH AND HOME REACH THE CHILD: the SDK's `env` replaces the child's
    // environment, so asserting only the new variable would pass a child
    // with no PATH.
    expect(env.PATH).toBe('/usr/bin:/bin');
    expect(env.HOME).toBe('/home/op');
    expect(env.PLOT_BRANCH).toBe('infra/x');
    expect(env.PLOT_WORKTREE).toBe('/estate/x');
    expect(env.CLAUDE_CODE_DISABLE_BACKGROUND_TASKS).toBe('1');
    expect(options.disallowedTools).toEqual([...BACKGROUND_DISALLOWED_TOOLS]);
    expect(BACKGROUND_DISALLOWED_TOOLS).toEqual(['Monitor', 'ScheduleWakeup', 'CronCreate', 'TaskStop', 'ListAgents']);
    expect((options.hooks as { PreToolUse: unknown[] }).PreToolUse).toHaveLength(1);
    expect(options.settingSources).toEqual(['user', 'project', 'local']);
    expect(options.pathToClaudeCodeExecutable).toBe('/usr/local/bin/claude');
    expect(options.permissionMode).toBe('bypassPermissions');
    expect('detached' in options).toBe(false);
  });

  it('spawns through the injected spawner', async () => {
    captured.messages = [resultMessage()];
    const spawner = vi.fn(() => ({ pid: 7 }) as never);
    await ended({}, baseDeps({ spawnClaudeCodeProcess: spawner }));
    const options = captured.options as { spawnClaudeCodeProcess: (o: unknown) => unknown };
    options.spawnClaudeCodeProcess({ command: 'claude', args: [], env: {} });
    expect(spawner).toHaveBeenCalledWith({ command: 'claude', args: [], env: {} });
  });

  it("caps autoCompactWindow at the request's window, beside the project's Agent settings", async () => {
    captured.messages = [resultMessage()];
    await ended({ contextWindow: 100_000 }, baseDeps({ agentSettings: { enabledPlugins: { 'x@y': false } } }));
    expect((captured.options as { settings: unknown }).settings).toEqual({
      enabledPlugins: { 'x@y': false },
      autoCompactWindow: 100_000,
    });
  });

  it('leaves settings unset when neither a window nor an Agent settings file is named', async () => {
    captured.messages = [resultMessage()];
    await ended();
    expect((captured.options as Record<string, unknown>).settings).toBeUndefined();
  });

  it("passes the charter's model and effort, the turn and spend limits", async () => {
    captured.messages = [resultMessage()];
    await ended({ model: 'sonnet', effort: 'high', maxTurns: 150, maxSpendUsd: 5 });
    const options = captured.options as Record<string, unknown>;
    expect(options.model).toBe('sonnet');
    expect(options.effort).toBe('high');
    expect(options.maxTurns).toBe(150);
    expect(options.maxBudgetUsd).toBe(5);
  });

  it('names a fresh session by the request, and resumes a session it names', async () => {
    captured.messages = [resultMessage()];
    await ended({ sessionId: 'handle-1' });
    expect((captured.options as Record<string, unknown>).sessionId).toBe('handle-1');
    expect((captured.options as Record<string, unknown>).resume).toBeUndefined();
    await ended({ resumeId: 'handle-1', sessionId: 'handle-1' });
    expect((captured.options as Record<string, unknown>).resume).toBe('handle-1');
    expect((captured.options as Record<string, unknown>).sessionId).toBeUndefined();
  });

  it('appends the hand-back protocol to the prompt', async () => {
    captured.messages = [resultMessage()];
    await ended();
    expect(captured.prompt).toBe(`do the work\n\n${HAND_BACK_PROTOCOL}`);
    expect(HAND_BACK_PROTOCOL).toContain('next: checks');
  });

  it('maps a read-only capability to the deny list and logs one it cannot map', async () => {
    captured.messages = [resultMessage()];
    await ended({ capabilities: ['read-only', 'network'] });
    expect(captured.options).toMatchObject({ disallowedTools: [...BACKGROUND_DISALLOWED_TOOLS, ...DEFAULT_READ_ONLY_DENY] });
    expect(await readFile(join(dir, 'out.log'), 'utf8')).toContain("capability 'network' has no mapping");
  });
});

describe('agentRunSdk: the PreToolUse hook', () => {
  it('denies a backgrounded Bash call with the poll refusal', async () => {
    captured.messages = [resultMessage()];
    await ended();
    const verdict = (await hook()(toolCall('Bash', { command: 'pnpm test', run_in_background: true }))) as {
      hookSpecificOutput?: { permissionDecision?: string; permissionDecisionReason?: string };
    };
    expect(verdict.hookSpecificOutput?.permissionDecision).toBe('deny');
    expect(verdict.hookSpecificOutput?.permissionDecisionReason).toMatch(/^plot: poll refused/);
  });

  it("denies a Read of a background task's output file", async () => {
    captured.messages = [resultMessage()];
    await ended();
    const verdict = (await hook()(toolCall('Read', { file_path: '/tmp/claude/tasks/abc.output' }))) as {
      hookSpecificOutput?: { permissionDecision?: string };
    };
    expect(verdict.hookSpecificOutput?.permissionDecision).toBe('deny');
  });

  it('allows a foreground Bash call, and answers nothing for another event', async () => {
    captured.messages = [resultMessage()];
    await ended();
    expect(await hook()(toolCall('Bash', { command: 'pnpm test' }))).toEqual({});
    expect(await hook()({ hook_event_name: 'PostToolUse' })).toEqual({});
  });
});

describe('agentRunSdk: refusals before the run', () => {
  it('ends unstarted, naming the file, when a USER settings file sets the background switch', async () => {
    const home = join(dir, 'home');
    await mkdir(join(home, '.claude'), { recursive: true });
    await writeFile(join(home, '.claude', 'settings.json'), JSON.stringify({ env: { CLAUDE_CODE_DISABLE_BACKGROUND_TASKS: '0' } }));
    const run = await ended({}, baseDeps({ readSettingsFiles: sdk.settingsFilesOf(home) }));
    expect(run.end).toEqual({ answer: 'unstarted', detail: expect.stringContaining(join(home, '.claude', 'settings.json')) });
    expect(captured.options).toBeUndefined();
  });

  it("ends unstarted, naming the file, when the project's .claude/settings.json sets it", async () => {
    await mkdir(join(dir, '.claude'), { recursive: true });
    await writeFile(join(dir, '.claude', 'settings.json'), JSON.stringify({ env: { CLAUDE_CODE_DISABLE_BACKGROUND_TASKS: '1' } }));
    const run = await ended({}, baseDeps({ readSettingsFiles: sdk.settingsFilesOf(join(dir, 'no-home')) }));
    expect(run.end).toEqual({ answer: 'unstarted', detail: expect.stringContaining(join(dir, '.claude', 'settings.json')) });
    expect(captured.options).toBeUndefined();
  });

  it('reads an unparseable or env-less settings file as no env', async () => {
    await mkdir(join(dir, '.claude'), { recursive: true });
    await writeFile(join(dir, '.claude', 'settings.json'), '{not json');
    await writeFile(join(dir, '.claude', 'settings.local.json'), '{"model":"x"}');
    const read = await sdk.settingsFilesOf(join(dir, 'no-home'))(dir);
    expect(read.map((r) => r.env)).toEqual([{}, {}, {}]);
  });

  it('ends unstarted when the Agent settings file is refused', async () => {
    const run = await ended({}, baseDeps({ agentSettings: { env: { PATH: '/x' } }, agentSettingsPath: '.plot/agent-settings.json' }));
    expect(run.end).toEqual({ answer: 'unstarted', detail: expect.stringContaining('.plot/agent-settings.json') });
    expect(captured.options).toBeUndefined();
  });

  it('ends unstarted when no claude is on PATH', async () => {
    const run = await ended({}, baseDeps({ pathToClaudeCodeExecutable: '' }));
    expect(run.end).toEqual({ answer: 'unstarted', detail: 'no `claude` executable is on PATH' });
  });
});

describe('agentRunSdk: how a run ends', () => {
  it('hands back the structured output, the session, the cost, the usage and its own turns', async () => {
    captured.messages = [
      { type: 'assistant', session_id: 'session-abc' },
      { type: 'assistant', session_id: 'session-abc' },
      resultMessage({
        num_turns: 40,
        modelUsage: { sonnet: { inputTokens: 1, outputTokens: 2, cacheReadInputTokens: 3, cacheCreationInputTokens: 4 } },
      }),
    ];
    const run = await ended();
    expect(run).toEqual({
      sessionId: 'session-abc',
      end: { answer: 'ran', handBack: { next: 'pushed', summary: 'done' } },
      usageByModel: { sonnet: { inputTokens: 1, outputTokens: 2, cacheReadTokens: 3, cacheCreationTokens: 4 } },
      costUsd: 0.42,
      turns: 2,
      limitReadings: [],
    });
    expect(await readFile(join(dir, 'out.log'), 'utf8')).toContain('"type":"result"');
  });

  it('answers the limit when a rejected rate_limit_event arrives on a run that also handed back done', async () => {
    captured.messages = [
      { type: 'rate_limit_event', rate_limit_info: { status: 'rejected', resetsAt: 1_700_003_600, rateLimitType: 'five_hour', utilization: 1 }, session_id: 's' },
      resultMessage({ structured_output: { next: 'done', summary: 'finished' } }),
    ];
    const run = await ended({ boundSeconds: 28_800 });
    expect(run.end).toEqual({ answer: 'wait', resetEpoch: 1_700_003_600 });
    expect(run.limitReadings).toEqual([{ status: 'rejected', resetsAt: 1_700_003_600, rateLimitType: 'five_hour', utilization: 1 }]);
  });

  it('ends unstarted on a zeroed result, and on a stream with no result at all', async () => {
    captured.messages = [
      resultMessage({ subtype: 'error_during_execution', is_error: true, num_turns: 0, total_cost_usd: 0, startup_failure_reason: undefined }),
    ];
    expect((await ended()).end.answer).toBe('unstarted');
    captured.messages = [];
    expect((await ended()).end).toEqual({ answer: 'unstarted', detail: 'no result message arrived' });
  });

  it('ends unstarted, logging the reason, when the query throws before a result', async () => {
    captured.stream = () =>
      (async function* () {
        throw new Error('spawn claude ENOENT');
      })();
    const run = await ended();
    expect(run.end.answer).toBe('unstarted');
    expect(await readFile(join(dir, 'out.log'), 'utf8')).toContain('spawn claude ENOENT');
  });

  it('carries a result with no structured output as ran with no hand-back', async () => {
    captured.messages = [resultMessage({ structured_output: undefined })];
    expect((await ended()).end).toEqual({ answer: 'ran', handBack: null });
  });
});

describe('agentRunSdk: the process rules', () => {
  const pgidOf = (pid: number): string => execFileSync('ps', ['-o', 'pgid=', '-p', String(pid)], { encoding: 'utf8' }).trim();
  const alive = (pid: number): boolean => {
    try {
      process.kill(pid, 0);
      return true;
    } catch {
      return false;
    }
  };

  it("spawnAttached keeps the child in the caller's process group", async () => {
    const child = sdk.spawnAttached({ command: 'sleep', args: ['5'], env: { PATH: process.env.PATH }, cwd: dir, signal: new AbortController().signal }) as unknown as {
      pid: number;
      kill: (s: string) => void;
    };
    try {
      expect(pgidOf(child.pid)).toBe(pgidOf(process.pid));
    } finally {
      child.kill('SIGKILL');
    }
  });

  it('on its bound, aborts the query and ends the child and its descendants', async () => {
    const pids: number[] = [];
    captured.stream = (options) =>
      (async function* () {
        const spawnFn = options.spawnClaudeCodeProcess as (o: unknown) => { pid: number };
        const child = spawnFn({ command: 'sh', args: ['-c', 'sleep 30 & sleep 30'], env: { PATH: process.env.PATH }, cwd: dir });
        pids.push(child.pid);
        await new Promise((resolve) => setTimeout(resolve, 300));
        const kids = execFileSync('pgrep', ['-P', String(child.pid)], { encoding: 'utf8' }).trim().split('\n').map(Number);
        pids.push(...kids);
        const signal = (options.abortController as AbortController).signal;
        await new Promise((_, reject) => signal.addEventListener('abort', () => reject(new Error('aborted'))));
        yield {};
      })();
    const run = await ended(
      { boundSeconds: 1 },
      baseDeps({ spawnClaudeCodeProcess: sdk.spawnAttached, processes: processesShell({ repoRoot: dir, scriptDir: dir }) }),
    );
    expect(run.end).toEqual({ answer: 'bound' });
    expect(pids.length).toBeGreaterThanOrEqual(3);
    await vi.waitFor(() => expect(pids.filter(alive)).toEqual([]), { timeout: 5_000 });
  });

  it('claudeOnPath finds an executable claude on PATH, and answers empty where none is', async () => {
    const bin = join(dir, 'bin');
    await mkdir(bin);
    await writeFile(join(bin, 'claude'), '#!/bin/sh\n');
    await chmod(join(bin, 'claude'), 0o755);
    expect(await sdk.claudeOnPath(`${join(dir, 'none')}:${bin}`)).toBe(join(bin, 'claude'));
    expect(await sdk.claudeOnPath(join(dir, 'none'))).toBe('');
  });
});
