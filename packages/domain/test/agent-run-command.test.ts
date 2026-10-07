import { appendFile, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { agentRunCommand } from '../src/adapters/agent-run/agent-run-command.js';
import { HARNESS_LIMIT_LINES } from '../src/adapters/harness/limit-lines.js';
import { backgroundGateEnv } from '../src/rules/agent-run-env.js';
import { answered, failed } from '../src/port-result.js';
import type { BoundedRun, BoundedRunResult } from '../src/ports/bounded-run.js';
import type { AgentRunRequest } from '../src/ports/agent-run.js';

const request = (overrides: Partial<AgentRunRequest> = {}, worktree: string, logFile: string): AgentRunRequest => ({
  worktree,
  prompt: 'echo hello',
  resumeId: 'session-1',
  role: 'worker',
  harness: 'claude',
  model: '',
  effort: '',
  maxTurns: 0,
  maxSpendUsd: 0,
  boundSeconds: 0,
  contextWindow: 0,
  capabilities: [],
  env: { PATH: '/usr/bin' },
  logFile,
  ...overrides,
});

describe('agentRunCommand', () => {
  let dir: string;
  let logFile: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'agent-run-command-test-'));
    logFile = join(dir, 'out.log');
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('runs deps.fragment as the bash script, passing request.prompt as its own argument', async () => {
    let args: readonly string[] = [];
    const boundedRun: BoundedRun = {
      run: async (_command, given) => {
        args = given;
        return answered<BoundedRunResult>({ status: 0, timedOut: false, ranSeconds: 1 });
      },
    };
    const adapter = agentRunCommand({ boundedRun, fragment: 'claude -p', limitPatterns: undefined, now: () => 0 });

    const promptText = 'Read /repo/docs/plans/x.md and follow it.';
    const result = await adapter.run(request({ prompt: promptText }, dir, logFile));

    expect(result.ok).toBe(true);
    expect(args).toEqual(['-u', 'PLOT_REPO_ROOT', 'bash', '-c', 'claude -p "$@"', '_', promptText]);
  });

  it('never interpolates request.prompt into the script, even when the prompt contains shell metacharacters', async () => {
    let args: readonly string[] = [];
    const boundedRun: BoundedRun = {
      run: async (_command, given) => {
        args = given;
        return answered<BoundedRunResult>({ status: 0, timedOut: false, ranSeconds: 1 });
      },
    };
    const adapter = agentRunCommand({ boundedRun, fragment: 'claude -p', limitPatterns: undefined, now: () => 0 });

    const dangerousPrompt = `Read "$(rm -rf /)" and follow it; echo pwned`;
    await adapter.run(request({ prompt: dangerousPrompt }, dir, logFile));

    expect(args[4]).not.toContain('rm -rf');
    expect(args[args.length - 1]).toBe(dangerousPrompt);
  });

  it('answers ran with a null hand-back on a zero exit status', async () => {
    const boundedRun: BoundedRun = {
      run: async () => answered<BoundedRunResult>({ status: 0, timedOut: false, ranSeconds: 5 }),
    };
    const adapter = agentRunCommand({ boundedRun, fragment: 'claude -p', limitPatterns: undefined, now: () => 0 });

    const result = await adapter.run(request({}, dir, logFile));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.end).toEqual({ answer: 'ran', handBack: null });
  });

  it('runs the command with the background gate, and answers dropped for a run that printed the termination line', async () => {
    const line = 'Background tasks still running after 600s; terminating.';
    let env: Readonly<Record<string, string>> | undefined;
    const boundedRun: BoundedRun = {
      run: async (_command, _args, options) => {
        env = options.env;
        await writeFile(options.outFile, `${line}\n`, 'utf8');
        return answered<BoundedRunResult>({ status: 0, timedOut: false, ranSeconds: 600 });
      },
    };
    const adapter = agentRunCommand({ boundedRun, fragment: 'claude -p', limitPatterns: HARNESS_LIMIT_LINES.claude, now: () => 0 });

    const result = await adapter.run(request({}, dir, logFile));
    expect(env).toMatchObject(backgroundGateEnv());
    expect(result.ok && result.value.end).toEqual({ answer: 'dropped', line });
  });

  it('classifies only what this run appended, never a line an earlier run left in the log', async () => {
    const line = 'Background tasks still running after 600s; terminating.';
    await writeFile(logFile, `an earlier run\n${line}\n`, 'utf8');
    const boundedRun: BoundedRun = {
      run: async (_command, _args, options) => {
        await appendFile(options.outFile, 'this run finished cleanly\n', 'utf8');
        return answered<BoundedRunResult>({ status: 0, timedOut: false, ranSeconds: 5 });
      },
    };
    const adapter = agentRunCommand({ boundedRun, fragment: 'claude -p', limitPatterns: HARNESS_LIMIT_LINES.claude, now: () => 0 });

    const result = await adapter.run(request({}, dir, logFile));
    expect(result.ok && result.value.end).toEqual({ answer: 'ran', handBack: null });
  });

  it('answers unstarted on a non-zero exit with no limit line', async () => {
    const boundedRun: BoundedRun = {
      run: async () => answered<BoundedRunResult>({ status: 1, timedOut: false, ranSeconds: 1 }),
    };
    const adapter = agentRunCommand({ boundedRun, fragment: 'claude -p', limitPatterns: undefined, now: () => 0 });

    const result = await adapter.run(request({}, dir, logFile));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.end.answer).toBe('unstarted');
  });

  it('answers bound when the run was ended on its bound, and names the status of an unstarted run', async () => {
    const timedOut: BoundedRun = {
      run: async () => answered<BoundedRunResult>({ status: null, timedOut: true, ranSeconds: 5 }),
    };
    const bound = await agentRunCommand({ boundedRun: timedOut, fragment: 'claude -p', limitPatterns: undefined, now: () => 0 }).run(
      request({}, dir, logFile),
    );
    expect(bound.ok && bound.value.end).toEqual({ answer: 'bound' });

    const exited: BoundedRun = {
      run: async () => answered<BoundedRunResult>({ status: 3, timedOut: false, ranSeconds: 1 }),
    };
    const three = await agentRunCommand({ boundedRun: exited, fragment: 'claude -p', limitPatterns: undefined, now: () => 0 }).run(
      request({}, dir, logFile),
    );
    expect(three.ok && three.value.end).toEqual({ answer: 'unstarted', detail: 'the command exited with status 3' });

    const signalled: BoundedRun = {
      run: async () => answered<BoundedRunResult>({ status: null, timedOut: false, ranSeconds: 1 }),
    };
    const killed = await agentRunCommand({ boundedRun: signalled, fragment: 'claude -p', limitPatterns: undefined, now: () => 0 }).run(
      request({}, dir, logFile),
    );
    expect(killed.ok && killed.value.end).toEqual({ answer: 'unstarted', detail: 'the command exited on a signal' });
  });

  it('fails when boundedRun itself fails to start', async () => {
    const boundedRun: BoundedRun = {
      run: async () => failed<BoundedRunResult>(),
    };
    const adapter = agentRunCommand({ boundedRun, fragment: 'claude -p', limitPatterns: undefined, now: () => 0 });

    const result = await adapter.run(request({}, dir, logFile));
    expect(result.ok).toBe(false);
  });

  // UNASKABLE, NOT EMPTY-AS-ZERO: this adapter never parses usage or cost from
  // free-form shell output, so `usageByModel` is always `{}` and `costUsd` is
  // always `null` — a naive implementation reading `0` here would claim a
  // reading this adapter never took.
  it('reports no usage and no cost, regardless of exit status', async () => {
    const boundedRun: BoundedRun = {
      run: async () => answered<BoundedRunResult>({ status: 0, timedOut: false, ranSeconds: 1 }),
    };
    const adapter = agentRunCommand({ boundedRun, fragment: 'claude -p', limitPatterns: undefined, now: () => 0 });

    const result = await adapter.run(request({}, dir, logFile));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.usageByModel).toEqual({});
    expect(result.value.costUsd).toBeNull();
    expect(result.value.limitReadings).toEqual([]);
  });

  it('carries the request.resumeId through as the result sessionId', async () => {
    const boundedRun: BoundedRun = {
      run: async () => answered<BoundedRunResult>({ status: 0, timedOut: false, ranSeconds: 1 }),
    };
    const adapter = agentRunCommand({ boundedRun, fragment: 'claude -p', limitPatterns: undefined, now: () => 0 });

    const result = await adapter.run(request({ resumeId: 'resumed-session-42' }, dir, logFile));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.sessionId).toBe('resumed-session-42');
  });
});
