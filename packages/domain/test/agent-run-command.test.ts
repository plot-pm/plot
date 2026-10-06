import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
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

  it('writes the request.prompt TEXT to a scratch file and sources that file, never the prompt string itself as a path', async () => {
    let sourcedFile = '';
    let writtenAtRunTime = '';
    const boundedRun: BoundedRun = {
      run: async (_command, args) => {
        // args: ['-u', 'PLOT_REPO_ROOT', 'bash', '-c', '. "$1"', '_', <promptFile>]
        sourcedFile = args[args.length - 1] ?? '';
        // Read it NOW — the adapter removes its scratch directory once this
        // call returns, so a read after `adapter.run` resolves finds nothing.
        writtenAtRunTime = await readFile(sourcedFile, 'utf8');
        return answered<BoundedRunResult>({ status: 0, timedOut: false, ranSeconds: 1 });
      },
    };
    const adapter = agentRunCommand({ boundedRun, limitPatterns: undefined, now: () => 0 });

    const promptText = 'echo "the actual prompt text, not a path"';
    const result = await adapter.run(request({ prompt: promptText }, dir, logFile));

    expect(result.ok).toBe(true);
    expect(sourcedFile).not.toBe(promptText);
    expect(writtenAtRunTime).toBe(promptText);
  });

  it('answers ran with a null hand-back on a zero exit status', async () => {
    const boundedRun: BoundedRun = {
      run: async () => answered<BoundedRunResult>({ status: 0, timedOut: false, ranSeconds: 5 }),
    };
    const adapter = agentRunCommand({ boundedRun, limitPatterns: undefined, now: () => 0 });

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
    const adapter = agentRunCommand({ boundedRun, limitPatterns: HARNESS_LIMIT_LINES.claude, now: () => 0 });

    const result = await adapter.run(request({}, dir, logFile));
    expect(env).toMatchObject(backgroundGateEnv());
    expect(result.ok && result.value.end).toEqual({ answer: 'dropped', line });
  });

  it('answers unstarted on a non-zero exit with no limit line', async () => {
    const boundedRun: BoundedRun = {
      run: async () => answered<BoundedRunResult>({ status: 1, timedOut: false, ranSeconds: 1 }),
    };
    const adapter = agentRunCommand({ boundedRun, limitPatterns: undefined, now: () => 0 });

    const result = await adapter.run(request({}, dir, logFile));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.end.answer).toBe('unstarted');
  });

  it('fails when boundedRun itself fails to start', async () => {
    const boundedRun: BoundedRun = {
      run: async () => failed<BoundedRunResult>(),
    };
    const adapter = agentRunCommand({ boundedRun, limitPatterns: undefined, now: () => 0 });

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
    const adapter = agentRunCommand({ boundedRun, limitPatterns: undefined, now: () => 0 });

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
    const adapter = agentRunCommand({ boundedRun, limitPatterns: undefined, now: () => 0 });

    const result = await adapter.run(request({ resumeId: 'resumed-session-42' }, dir, logFile));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.sessionId).toBe('resumed-session-42');
  });
});
