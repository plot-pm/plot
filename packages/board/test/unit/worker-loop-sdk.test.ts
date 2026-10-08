// `runWorkerLoop` on `Agent runner: sdk` — the hand-back rows driven through
// the agent-run fixture, and `runnerDeps` choosing the runner. No process
// starts: the connector is the fixture and `boundedRun` is scripted.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { rmTree } from '../helpers.mjs';
import {
  agentRunFixture,
  boundedRunProcess,
  processesShell,
  agentsFixture,
  buildFixture,
  deskFixture,
  deskFixtureCalls,
  hostFixture,
  refsFixture,
  transcriptFixture,
  treesFixture,
  refusedSlicesFixture,
} from '@plot-pm/domain/adapters';
import type { AgentRunResult, AgentRunRequest } from '@plot-pm/domain/ports/agent-run';
import type { BoundedRun, Pr } from '@plot-pm/domain';
import type { LocalChecksReading } from '@plot-pm/domain/workflows/agent-loop';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parsePromptFile } from '@plot-pm/domain/rules/worker-prompt-text';
import {
  PASS_INTERVAL_MS,
  localChecksRunner,
  raiseSliceRuns,
  runWorkerLoop,
  runnerDeps,
  sdkOutcome,
  type LoopDeps,
  type SdkRunDeps,
  type WorkerLoopPorts,
} from '../../src/server/entry/worker-loop.js';

const BRANCH = 'infra/x';
const ASSIGNED = { session: 'sess-1', worktree: '', branch: BRANCH, attempts: 0, correctionAttempts: 0, resumeId: 'h-1' };

const made: string[] = [];
const tempDir = (prefix: string): string => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  made.push(dir);
  return dir;
};

const ran = (next: 'checks' | 'pushed' | 'blocked' | 'done' | null, summary = 's') => (request: AgentRunRequest): AgentRunResult => ({
  sessionId: request.resumeId || request.sessionId || 'fresh',
  end: { answer: 'ran', handBack: next === null ? null : { next, summary } },
  usageByModel: {},
  costUsd: null,
  costUsdByModel: {},
  turns: 1,
  limitReadings: [],
  account: null,
});

interface Rig {
  deps: LoopDeps;
  wt: string;
  events: string[];
  requests: AgentRunRequest[];
  deskCalls: ReturnType<typeof deskFixtureCalls>;
  read: () => Record<string, unknown>;
}

/** A loop on the SDK runner whose `checks` runner is `runChecks`, and whose CI answers `conclusion`. */
const rig = (
  answers: ((request: AgentRunRequest) => AgentRunResult)[],
  runChecks: (worktree: string) => Promise<LocalChecksReading>,
  manifest: Record<string, unknown> = ASSIGNED,
  conclusion: 'success' | 'failure' = 'success',
): Rig => {
  const dir = tempDir('plot-worker-loop-sdk-');
  const wt = path.join(dir, 'desk');
  fs.mkdirSync(wt);
  const manifestFile = path.join(dir, 'sess.json');
  const write = (fields: Record<string, unknown>): void => fs.writeFileSync(manifestFile, JSON.stringify(fields));
  const read = (): Record<string, unknown> => JSON.parse(fs.readFileSync(manifestFile, 'utf8'));
  write({ ...manifest, worktree: wt });

  const events: string[] = [];
  const fixture = agentRunFixture({ answers });
  const baseAgents = agentsFixture({});
  const deskCalls = deskFixtureCalls();
  const boundedRun: BoundedRun = { run: async () => ({ ok: true, value: { status: 0, timedOut: false, ranSeconds: 1 } }) };
  const ports: WorkerLoopPorts = {
    trees: treesFixture({ quiet: { [wt]: 5000 }, commits: { [wt]: 'no' } }),
    agents: {
      ...baseAgents,
      raiseAttempts: async (w: string, attempts: number) => {
        write({ ...read(), attempts });
        return baseAgents.raiseAttempts(w, attempts);
      },
      raiseCorrections: async (w: string, correctionAttempts: number) => {
        write({ ...read(), correctionAttempts });
        return baseAgents.raiseCorrections(w, correctionAttempts);
      },
      clearAssignment: async (session: string) => {
        write({ ...read(), branch: '' });
        return baseAgents.clearAssignment(session);
      },
    },
    desk: deskFixture({ calls: deskCalls }),
    refs: refsFixture({ ahead: { [BRANCH]: 0 }, shas: { HEAD: 'sha-1' }, remoteBranches: [BRANCH], remoteTips: { [BRANCH]: 'sha-1' } }),
    processes: {
      isAlive: async () => ({ ok: true, value: true }),
      workerState: async () => ({ ok: false, why: 'failed' }),
      startedAt: async () => ({ ok: false, why: 'failed' }),
      uptimeSeconds: async () => ({ ok: true, value: null }),
      childrenOf: async () => ({ ok: true, value: [100] }),
      activity: async () => ({ ok: true, value: 'idle' }),
    },
    boundedRun,
    refusedSlices: refusedSlicesFixture(),
    build: buildFixture({ shaRuns: { [BRANCH]: [{ sha: 'sha-1', status: 'completed', conclusion, url: 'u', startedAt: '' }] } }),
    host: hostFixture({ prs: [{ number: 7, head: BRANCH, state: 'OPEN' } as Pr] }),
    transcriptQuietSeconds: async () => 5000,
    recordSpend: async () => undefined,
    recordRun: async () => null,
    recordLimits: async () => 0,
    sliceCostUsd: async () => null,
  };
  const sdk: SdkRunDeps = {
    agentRun: () => ({
      run: async (request) => {
        events.push('model');
        return fixture.run(request);
      },
    }),
    prompt: (branch) => `implement ${branch}`,
    model: 'sonnet',
    effort: '',
    maxTurns: 150,
    maxSpendUsd: 0,
    contextWindow: 200_000,
    capabilities: [],
    runChecks: async (worktree) => {
      events.push('checks');
      return runChecks(worktree);
    },
  };
  const deps: LoopDeps = {
    ports,
    idle: { selfPid: 1, windowSeconds: 900, intervalMs: 1_000_000, transcript: transcriptFixture({ spoken: [] }) },
    manifestFile,
    repoRoot: dir,
    worktree: wt,
    agent: '',
    harness: 'claude',
    config: {
      boundSeconds: 28_800,
      waitBudgetSeconds: 120,
      passIntervalMs: PASS_INTERVAL_MS,
      checksPollMs: PASS_INTERVAL_MS,
      maxStartRetries: 3,
      checksWaitSeconds: 1_800,
      correctionBudget: 2,
      sliceMaxRuns: 12,
      sliceMaxSpendUsd: null,
      base: 'origin/main',
    },
    limitMarginSeconds: 60,
    monitorEndsWorker: true,
    outFile: path.join(dir, 'out.txt'),
    sessionId: '',
    now: () => Date.now(),
    sleep: async (ms) => {
      vi.setSystemTime(Date.now() + ms);
    },
    log: () => undefined,
    resolvePrompt: () => 'fallback\t.plot/worker-prompt.sh\tx',
    runner: 'sdk',
    sdk,
  };
  return { deps, wt, events, requests: fixture.requests, deskCalls, read };
};

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(Date.parse('2026-10-06T10:00:00Z'));
});
afterEach(() => {
  vi.useRealTimers();
  for (const dir of made.splice(0)) rmTree(dir);
});

describe('runWorkerLoop on the SDK runner — the run records', () => {
  it('hands each run’s result to the run line and the budget record, and passes Agent max spend', async () => {
    const r = rig([ran('checks'), ran('pushed')], async () => ({ passed: true }));
    const recorded: string[] = [];
    Object.assign(r.deps.ports, {
      recordRun: async (_w: string, branch: string, role: string, _at: string, result: AgentRunResult) => {
        recorded.push(`run ${branch} ${role} ${result.sessionId}`);
        return null;
      },
      recordLimits: async (result: AgentRunResult) => {
        recorded.push(`limits ${result.sessionId}`);
        return 0;
      },
    });
    Object.assign(r.deps.sdk!, { maxSpendUsd: 7.5 });

    await runWorkerLoop(r.deps);

    expect(recorded).toEqual([`run ${BRANCH} worker h-1`, 'limits h-1', `run ${BRANCH} worker h-1`, 'limits h-1']);
    expect(r.requests.map((request) => request.maxSpendUsd)).toEqual([7.5, 7.5]);
  });

  it('logs a record that throws or refuses, and the run’s hand-back still holds', async () => {
    const r = rig([ran('pushed')], async () => ({ passed: true }));
    const logs: string[] = [];
    Object.assign(r.deps, { log: (line: string) => logs.push(line) });
    Object.assign(r.deps.ports, {
      recordRun: async () => 'write-failed',
      recordLimits: async () => {
        throw new Error('disk full');
      },
    });

    expect(await runWorkerLoop(r.deps)).toBe(124);
    expect(logs).toContain(`plot-worker-loop: no run line for ${BRANCH} (write-failed)`);
    expect(logs).toContain('plot-worker-loop: usage-limit readings not recorded (disk full)');
  });

  it('logs a run line that throws and failed budget entries, and stays silent on a command run’s no-cost', async () => {
    const r = rig([ran('checks'), ran('pushed')], async () => ({ passed: true }));
    const logs: string[] = [];
    let calls = 0;
    Object.assign(r.deps, { log: (line: string) => logs.push(line) });
    Object.assign(r.deps.ports, {
      recordRun: async () => {
        calls += 1;
        if (calls === 1) throw 'record gone';
        return 'no-cost';
      },
      recordLimits: async () => 2,
    });

    await runWorkerLoop(r.deps);

    expect(logs).toContain(`plot-worker-loop: no run line for ${BRANCH} (record gone)`);
    expect(logs.filter((line) => line.includes('no-cost'))).toEqual([]);
    expect(logs).toContain('plot-worker-loop: 2 usage-limit reading(s) not recorded');
  });

  it('starts no run on a slice whose recorded cost reached Slice max spend, and ends spend-limit', async () => {
    const r = rig([ran('pushed')], async () => ({ passed: true }));
    Object.assign(r.deps.config, { sliceMaxSpendUsd: 5 });
    Object.assign(r.deps.ports, { sliceCostUsd: async () => 5 });

    await runWorkerLoop(r.deps);

    expect(r.requests).toHaveLength(0);
    expect(r.deskCalls.endings.at(-1)?.record.reason).toBe('spend-limit');
  });

  it('starts the run where Slice max spend is unset, whatever the record holds', async () => {
    const r = rig([ran('pushed')], async () => ({ passed: true }));
    Object.assign(r.deps.ports, { sliceCostUsd: async () => 1_000 });

    await runWorkerLoop(r.deps);

    expect(r.requests).toHaveLength(1);
  });
});

describe('runWorkerLoop on the SDK runner — the hand-back rows', () => {
  it('checks, then a pass, then pushed: two model runs, the checks between them, no model turn to ask', async () => {
    const r = rig([ran('checks', 'tests added'), ran('pushed')], async () => ({ passed: true }));
    expect(await runWorkerLoop(r.deps)).toBe(124);
    expect(r.events).toEqual(['model', 'checks', 'model']);
    expect(r.requests).toHaveLength(2);
    expect(r.requests[0]).toMatchObject({ prompt: `implement ${BRANCH}`, resumeId: '', sessionId: 'h-1', model: 'sonnet', maxTurns: 150, contextWindow: 200_000, role: 'worker' });
    expect(r.requests[0]!.env.PLOT_BRANCH).toBe(BRANCH);
    expect(r.requests[1]).toMatchObject({ prompt: 'local checks passed: tests added', resumeId: 'h-1' });
    // A `checks` resume is not a CI correction: nothing is written to the desk.
    expect(r.deskCalls.corrections).toEqual([]);
    expect(r.deskCalls.endings.at(-1)?.record.reason).not.toBe('blocked');
  });

  it('checks that fail resume with the failing command and the last 80 lines of its output', async () => {
    const lines = Array.from({ length: 100 }, (_, i) => `line ${i + 1}`).join('\n');
    let call = 0;
    const scripted: BoundedRun = {
      run: async (_command, _args, options) => {
        call += 1;
        fs.writeFileSync(options.outFile, call === 1 ? 'pnpm test\n# CI suites: x\nsummary: commands=1\n' : `${lines}\n`);
        return { ok: true, value: { status: call === 1 ? 0 : 1, timedOut: false, ranSeconds: 1 } };
      },
    };
    const outDir = tempDir('plot-worker-checks-');
    const runChecks = localChecksRunner(scripted, '/scripts', 600, path.join(outDir, 'checks.out'));
    const r = rig([ran('checks'), ran('blocked', 'cannot fix')], runChecks);
    expect(await runWorkerLoop(r.deps)).toBe(0);
    expect(r.events).toEqual(['model', 'checks', 'model']);
    const resume = r.requests[1]!.prompt;
    expect(resume).toContain('local checks failed: `pnpm test`');
    expect(resume).toContain('line 21\n');
    expect(resume).toContain('line 100');
    expect(resume).not.toContain('line 20\n');
    expect(r.deskCalls.endings.at(-1)?.record.reason).toBe('blocked');
  });

  it('a CI failure resumes the session with the correction, written to the desk', async () => {
    const r = rig([ran('pushed'), ran('blocked')], async () => ({ passed: true }), ASSIGNED, 'failure');
    expect(await runWorkerLoop(r.deps)).toBe(0);
    expect(r.requests[1]).toMatchObject({ resumeId: 'h-1' });
    expect(r.requests[1]!.prompt).toContain('concluded failure');
    expect(r.deskCalls.corrections).toHaveLength(1);
  });

  it('starts no run at Slice max runs, and ends run-limit', async () => {
    const r = rig([ran('done')], async () => ({ passed: true }), { ...ASSIGNED, sliceRuns: { branch: BRANCH, runs: 12 } });
    expect(await runWorkerLoop(r.deps)).toBe(0);
    expect(r.requests).toEqual([]);
    expect(r.deskCalls.endings.at(-1)?.record.reason).toBe('run-limit');
  });

  it('counts each run against the branch in the manifest', async () => {
    const r = rig([ran('checks'), ran('pushed')], async () => ({ passed: true }));
    await runWorkerLoop(r.deps);
    expect(r.read().sliceRuns).toEqual({ branch: BRANCH, runs: 2 });
  });
});

describe('runWorkerLoop on the SDK runner — a continuation resumes the blocked session', () => {
  /** A desk on `BRANCH` holding a marker and `.plot-worker.continue.md`, whose transcripts are `spoken`. */
  const continued = (r: Rig, spoken: readonly string[]): string => {
    Object.assign(r.deps.ports, {
      trees: treesFixture({ quiet: { [r.wt]: 5000 }, commits: { [r.wt]: 'no' }, branches: { [r.wt]: BRANCH } }),
    });
    r.deps = { ...r.deps, idle: { ...r.deps.idle, transcript: transcriptFixture({ spoken: spoken.map((h) => `${r.wt}\t${h}`) }) } };
    fs.writeFileSync(path.join(r.wt, 'PLOT-BLOCKED.md'), 'PLOT-BLOCKED: which adapter?\n');
    const file = path.join(r.wt, '.plot-worker.continue.md');
    fs.writeFileSync(file, 'use fetch');
    return file;
  };

  /** Wraps the rig's run so `seen` records the desk at the moment the turn starts. */
  const watchStart = (r: Rig, file: string): { endings: number; file: boolean }[] => {
    const seen: { endings: number; file: boolean }[] = [];
    const inner = r.deps.sdk!.agentRun;
    r.deps = {
      ...r.deps,
      sdk: {
        ...r.deps.sdk!,
        agentRun: (o) => ({
          run: async (request) => {
            seen.push({ endings: r.deskCalls.endings.length, file: fs.existsSync(file) });
            return inner(o).run(request);
          },
        }),
      },
    };
    return seen;
  };

  it('resumes the manifest session with the file’s text where its transcript exists, and removes the file after the turn', async () => {
    const r = rig([ran('pushed')], async () => ({ passed: true }));
    const file = continued(r, ['h-1']);
    const seen = watchStart(r, file);

    await runWorkerLoop(r.deps);

    expect(r.requests[0]).toMatchObject({ prompt: 'use fetch', resumeId: 'h-1' });
    expect(seen[0]).toEqual({ endings: 0, file: true });
    expect(fs.existsSync(file)).toBe(false);
    expect(r.deskCalls.corrections).toEqual([]);
  });

  it('starts a new session with the file’s text where the manifest resumeId has no transcript', async () => {
    const r = rig([ran('pushed')], async () => ({ passed: true }), { ...ASSIGNED, resumeId: 'fresh-1' });
    const file = continued(r, []);

    await runWorkerLoop(r.deps);

    expect(r.requests[0]).toMatchObject({ prompt: 'use fetch', resumeId: '', sessionId: 'fresh-1' });
    expect(fs.existsSync(file)).toBe(false);
  });

  it('leaves the continuation file on the desk when the run never starts', async () => {
    const r = rig([], async () => ({ passed: true }));
    const file = continued(r, ['h-1']);
    r.deps = { ...r.deps, sdk: { ...r.deps.sdk!, agentRun: () => ({ run: async () => ({ ok: false, why: 'failed' }) as never }) } };

    await runWorkerLoop(r.deps);

    expect(fs.existsSync(file)).toBe(true);
  });
});

describe('runWorkerLoop on the SDK runner — how a run ends', () => {
  const withRun = (r: Rig, run: (request: AgentRunRequest) => Promise<unknown>): Rig => {
    r.deps = { ...r.deps, sdk: { ...r.deps.sdk!, agentRun: () => ({ run: run as never }) } };
    return r;
  };

  it('ends 124 when the idle watch says idle while the run is still going', async () => {
    const r = withRun(rig([], async () => ({ passed: true })), () => new Promise(() => undefined));
    r.deps = {
      ...r.deps,
      idle: { ...r.deps.idle, transcript: transcriptFixture({ spoken: [`${r.wt}\th-1`] }) },
      ports: { ...r.deps.ports, trees: treesFixture({ quiet: { [r.wt]: 5000 }, commits: { [r.wt]: 'yes' } }) },
    };
    expect(await runWorkerLoop(r.deps)).toBe(124);
    expect(r.deskCalls.endings.at(-1)?.record.reason).toBe('quiet');
  });

  it('ends 124 on the bound', async () => {
    const bound = withRun(rig([], async () => ({ passed: true })), async (request) => ({
      ok: true,
      value: { sessionId: request.sessionId, end: { answer: 'bound' }, usageByModel: {}, costUsd: null, costUsdByModel: {}, turns: 0, limitReadings: [], account: null },
    }));
    expect(await runWorkerLoop(bound.deps)).toBe(124);
  });

  it('retries a run the connector could not start', async () => {
    const logs: string[] = [];
    const failing = withRun(rig([], async () => ({ passed: true })), async () => ({ ok: false, why: 'failed' }));
    failing.deps = { ...failing.deps, log: (line) => logs.push(line) };
    expect(await runWorkerLoop(failing.deps)).toBe(1);
    expect(logs.join('\n')).toContain('the prompt never started');
  });

  it('logs why an SDK run did not start, and keeps the handle where the run names no session', async () => {
    const logs: string[] = [];
    const r = rig(
      [
        (request) => ({ ...ran(null)(request), end: { answer: 'unstarted', detail: "'~/.claude/settings.json' sets it" } }),
        (request) => ({ ...ran('blocked')(request), sessionId: '' }),
      ],
      async () => ({ passed: true }),
    );
    r.deps = { ...r.deps, log: (line) => logs.push(line) };
    expect(await runWorkerLoop(r.deps)).toBe(0);
    expect(logs.join('\n')).toContain("the SDK run did not start on infra/x — '~/.claude/settings.json' sets it");
  });

  it('refuses a run whose charter the prompt resolution refused, and runs without the .sh the command runner needs', async () => {
    const logs: string[] = [];
    const refused = rig([ran('done')], async () => ({ passed: true }));
    refused.deps = { ...refused.deps, resolvePrompt: () => 'refused\t\tcharter x unreadable', log: (line) => logs.push(line) };
    expect(await runWorkerLoop(refused.deps)).toBe(1);
    expect(refused.requests).toEqual([]);
    expect(logs.join('\n')).toContain('refusing to launch — charter x unreadable');

    const noFile = rig([ran('blocked')], async () => ({ passed: true }));
    noFile.deps = { ...noFile.deps, resolvePrompt: () => 'fallback\t\tx' };
    expect(await runWorkerLoop(noFile.deps)).toBe(0);
    expect(noFile.requests).toHaveLength(1);
  });

  it('a correction on a desk with no session handle starts a fresh session', async () => {
    const r = rig([ran('pushed'), ran('blocked')], async () => ({ passed: true }), { ...ASSIGNED, resumeId: '' }, 'failure');
    await runWorkerLoop(r.deps);
    expect(r.requests[1]).toMatchObject({ resumeId: '' });
  });
});

describe('localChecksRunner', () => {
  const scripted = (answers: { output: string; status: number; remove?: boolean }[]): BoundedRun => {
    let call = 0;
    return {
      run: async (_command, _args, options) => {
        const answer = answers[call++]!;
        if (answer.remove) fs.rmSync(options.outFile);
        else fs.writeFileSync(options.outFile, answer.output);
        return { ok: true, value: { status: answer.status, timedOut: false, ranSeconds: 1 } };
      },
    };
  };
  const outFile = () => path.join(tempDir('plot-checks-'), 'checks.out');

  it('passes when every printed command passes, and unsets the worker variables for each', async () => {
    const calls: (readonly string[])[] = [];
    const base = scripted([{ output: 'a\nb\n', status: 0 }, { output: '', status: 0 }, { output: '', status: 0 }]);
    const runner: BoundedRun = { run: async (c, args, o) => (calls.push(args), base.run(c, args, o)) };
    expect(await localChecksRunner(runner, '/s', 60, outFile())('/w')).toEqual({ passed: true });
    expect(calls[0]!.slice(8, 12)).toEqual(['bash', '-c', 'exec node "$1" 2>"$2"', '_']);
    expect(calls[0]![12]).toBe('/s/board/plot-local-checks.mjs');
    expect(calls.slice(1).map((a) => a.slice(-3))).toEqual([
      ['bash', '-c', 'a'],
      ['bash', '-c', 'b'],
    ]);
    for (const args of calls) expect(args.slice(0, 8)).toEqual(['-u', 'PLOT_REPO_ROOT', '-u', 'PLOT_UNATTENDED', '-u', 'PLOT_MANIFEST_FILE', '-u', 'PLOT_WRAPPER_PID_FILE']);
  });

  it('fails on the lister itself, and reads an output file the command removed as empty', async () => {
    expect(await localChecksRunner(scripted([{ output: 'boom', status: 2 }]), '/s', 60, outFile())('/w')).toEqual({
      passed: false,
      command: 'node /s/board/plot-local-checks.mjs',
      tail: 'boom',
    });
    expect(await localChecksRunner(scripted([{ output: 'a\n', status: 0 }, { output: '', status: 1, remove: true }]), '/s', 60, outFile())('/w')).toEqual({
      passed: false,
      command: 'a',
      tail: '',
    });
  });
});

describe('localChecksRunner against a real process', () => {
  it("reads only the lister's standard output as commands; a warning on standard error is not one", async () => {
    const scripts = tempDir('plot-checks-scripts-');
    fs.mkdirSync(path.join(scripts, 'board'));
    fs.writeFileSync(
      path.join(scripts, 'board', 'plot-local-checks.mjs'),
      "process.stderr.write('could not read the branch against the default branch\\n');\nprocess.stdout.write('true\\nsummary: commands=1\\n');\n",
    );
    const out = path.join(tempDir('plot-checks-out-'), 'checks.out');
    const runner = localChecksRunner(boundedRunProcess(processesShell({ repoRoot: scripts, scriptDir: scripts })), scripts, 60, out);
    expect(await runner(scripts)).toEqual({ passed: true });
    expect(fs.existsSync(`${out}.err`)).toBe(false);

    fs.writeFileSync(path.join(scripts, 'board', 'plot-local-checks.mjs'), "process.stderr.write('lister broke\\n');\nprocess.exit(2);\n");
    expect(await runner(scripts)).toMatchObject({ passed: false, tail: 'lister broke' });
  });
});

describe('sdkOutcome', () => {
  it("reads each end as the loop's exit", () => {
    expect(sdkOutcome({ answer: 'bound' })).toBe('bound');
    expect(sdkOutcome({ answer: 'ran', handBack: null })).toEqual({ exit: { answer: 'ran' }, handBack: null });
    expect(sdkOutcome({ answer: 'wait', resetEpoch: 1_800_000_000 })).toEqual({
      exit: { answer: 'wait', reset: { epoch: 1_800_000_000, iso: '2027-01-15T08:00:00.000Z' }, line: 'rate_limit_event: rejected' },
      handBack: null,
    });
    expect(sdkOutcome({ answer: 'end-limited', cause: 'no-reset' })).toMatchObject({ exit: { answer: 'end-limited', cause: 'no-reset' } });
    expect(sdkOutcome({ answer: 'unstarted', detail: 'x' })).toEqual({ exit: { answer: 'unstarted' }, handBack: null });
    expect(sdkOutcome({ answer: 'turn-limit' })).toEqual({ exit: { answer: 'turn-limit' }, handBack: null });
  });
});

describe('raiseSliceRuns', () => {
  it('starts the count again for a branch the record does not name, and writes nothing without a manifest', async () => {
    const dir = tempDir('plot-slice-runs-');
    const file = path.join(dir, 'm.json');
    fs.writeFileSync(file, JSON.stringify({ branch: 'infra/y', sliceRuns: { branch: 'infra/x', runs: 5 } }));
    expect(await raiseSliceRuns(file)).toBe(1);
    expect(JSON.parse(fs.readFileSync(file, 'utf8')).sliceRuns).toEqual({ branch: 'infra/y', runs: 1 });
    expect(await raiseSliceRuns('')).toBe(0);
    expect(await raiseSliceRuns(path.join(dir, 'gone.json'))).toBeNull();
    fs.writeFileSync(file, 'null');
    expect(await raiseSliceRuns(file)).toBeNull();
    fs.writeFileSync(file, JSON.stringify({ branch: 7 }));
    expect(await raiseSliceRuns(file)).toBe(1);
    expect(JSON.parse(fs.readFileSync(file, 'utf8')).sliceRuns).toEqual({ branch: '', runs: 1 });
  });
});

describe('the manifest across a hop, and a run it cannot count', () => {
  it('writeHop resets the correction count on a hop from another branch, and keeps it on the same branch', async () => {
    const r = rig([], async () => ({ passed: true }), { ...ASSIGNED, correctionAttempts: 2 });
    const { writeHop } = await import('../../src/server/entry/worker-loop.js');
    await writeHop(r.deps.manifestFile, 'h-2', 'infra/old');
    expect(r.read()).toMatchObject({ correctionAttempts: 0, resumeId: 'h-2' });
    fs.writeFileSync(r.deps.manifestFile, JSON.stringify({ ...r.read(), correctionAttempts: 1 }));
    await writeHop(r.deps.manifestFile, '', BRANCH);
    expect(r.read()).toMatchObject({ correctionAttempts: 1 });
  });

  it('starts no run, and ends unstarted, where the manifest cannot count it', async () => {
    const logs: string[] = [];
    const r = rig([ran('done')], async () => ({ passed: true }));
    r.deps = { ...r.deps, log: (line) => logs.push(line) };
    const real = r.deps.manifestFile;
    // A DIRECTORY WHERE THE TEMP FILE GOES: the manifest reads, the count cannot be written.
    fs.mkdirSync(`${real}.plot-runs-tmp`);
    expect(await runWorkerLoop(r.deps)).toBe(1);
    expect(r.requests).toEqual([]);
    expect(logs.join('\n')).toContain('could not count this run');
  });
});

describe('runnerDeps', () => {
  const setup = (charter?: Record<string, unknown>, projectPrompt?: string) => {
    const root = tempDir('plot-runner-deps-');
    const scriptDir = path.join(root, 'plugin', 'scripts');
    fs.mkdirSync(path.join(root, 'plugin', 'templates'), { recursive: true });
    fs.mkdirSync(scriptDir);
    fs.writeFileSync(path.join(root, 'plugin', 'templates', 'worker-prompt.md'), '---\nread-only-deny: Write\n---\nShipped {branch} {brief} {scripts}\n');
    const bin = path.join(root, 'bin');
    fs.mkdirSync(bin);
    fs.writeFileSync(path.join(bin, 'claude'), '#!/bin/sh\n');
    fs.chmodSync(path.join(bin, 'claude'), 0o755);
    if (charter !== undefined) {
      fs.mkdirSync(path.join(root, '.plot', 'charters'), { recursive: true });
      fs.writeFileSync(path.join(root, '.plot', 'charters', 'a.json'), JSON.stringify(charter));
    }
    if (projectPrompt !== undefined) {
      fs.mkdirSync(path.join(root, '.plot'), { recursive: true });
      fs.writeFileSync(path.join(root, '.plot', 'worker-prompt.md'), projectPrompt);
    }
    return { root, scriptDir, bin };
  };
  const config = (values: Record<string, string>) => (_root: string, key: string) => values[key];
  const deps = (s: ReturnType<typeof setup>, values: Record<string, string>, agent = '', logs: string[] = []) =>
    runnerDeps({
      env: { PATH: s.bin, HOME: s.root, PLOT_REPO_ROOT: '/leak' },
      scriptDir: s.scriptDir,
      repoRoot: s.root,
      worktree: s.root,
      agent,
      configKey: config(values),
      ports: { processes: {} as never, boundedRun: { run: async () => ({ ok: false, why: 'failed' }) } },
      boundSeconds: 60,
      agentSettings: '',
      checksOutFile: path.join(s.root, 'c.out'),
      now: () => Date.now(),
      log: (line) => logs.push(line),
    });

  it('reads command where Agent runner is absent', async () => {
    expect(await deps(setup(), {})).toEqual({ runner: 'command' });
  });

  it('runs a worker whose Worker command names PLOT_MODEL=sonnet on sonnet, with no Agent models entry', async () => {
    const logs: string[] = [];
    const out = await deps(setup(), { 'Agent runner': 'sdk', 'Worker command': 'PLOT_UNATTENDED=1 PLOT_MODEL=sonnet plot-worker-loop.sh' }, '', logs);
    expect(out.runner).toBe('sdk');
    expect(out.sdk).toMatchObject({ model: 'sonnet', maxTurns: 150, contextWindow: 200_000, capabilities: [] });
    expect(logs.join('\n')).toContain("reads Plot's shipped");
    expect(logs.join('\n')).toContain('model sonnet (worker-command)');
  });

  it("fills the shipped template's placeholders, and reads the project's .md over it", async () => {
    const shipped = setup();
    const out = await deps(shipped, { 'Agent runner': 'sdk', 'Worker command': 'x' });
    expect(out.sdk!.prompt('infra/the-x')).toBe(`Shipped infra/the-x .plot/briefs/the-x.md ${shipped.scriptDir}`);
    const project = await deps(setup(undefined, 'Project {branch}'), { 'Agent runner': 'sdk', 'Worker command': 'x' });
    expect(project.sdk!.prompt('infra/y')).toBe('Project infra/y');
  });

  it('runs a charter that names another harness on command, with claude on PATH', async () => {
    const logs: string[] = [];
    const s = setup({ name: 'a', prompt: '.plot/worker-prompt.sh', harness: 'codex' });
    expect(await deps(s, { 'Agent runner': 'sdk', 'Worker command': 'x' }, 'a', logs)).toEqual({ runner: 'command' });
    expect(logs.join('\n')).toContain('codex');
  });

  it("takes the charter's model, effort, capabilities and smaller window over the config", async () => {
    const s = setup({ name: 'a', prompt: '.plot/worker-prompt.sh', model: 'opus', effort: 'high', capabilities: ['read-only'], bounds: { contextWindow: 100_000 } });
    const out = await deps(s, { 'Agent runner': 'sdk', 'Worker command': 'PLOT_MODEL=sonnet x', 'Agent models': 'worker = haiku', 'Agent max turns': '40' }, 'a');
    expect(out.sdk).toMatchObject({ model: 'opus', effort: 'high', capabilities: ['read-only'], contextWindow: 100_000, maxTurns: 40 });
  });

  it('builds a connector that runs one turn through the SDK against a stand-in claude', async () => {
    const s = setup(undefined, 'Project {branch}');
    const settingsFile = path.join(s.root, 'agent-settings.json');
    fs.writeFileSync(settingsFile, JSON.stringify({ enabledPlugins: { 'other@x': false } }));
    const fake = path.join(__dirname, '..', 'fixtures', 'fake-claude');
    const out = await runnerDeps({
      env: { PATH: `${fake}${path.delimiter}${process.env.PATH}`, HOME: s.root, FAKE_CLAUDE_NEXT: 'pushed' },
      scriptDir: s.scriptDir,
      repoRoot: s.root,
      worktree: s.root,
      agent: '',
      configKey: config({ 'Agent runner': 'sdk', 'Worker command': 'x' }),
      ports: { processes: { childrenOf: async () => ({ ok: true, value: [] }) } as never, boundedRun: { run: async () => ({ ok: false, why: 'failed' }) } },
      boundSeconds: 60,
      agentSettings: settingsFile,
      checksOutFile: path.join(s.root, 'c.out'),
      now: () => Date.now(),
      log: () => undefined,
    });
    const run = await out.sdk!.agentRun({ afterWait: false, commitsSinceWait: () => 0 }).run({
      worktree: s.root,
      prompt: out.sdk!.prompt('infra/x'),
      resumeId: '',
      sessionId: '22222222-2222-4222-8222-222222222222',
      role: 'worker',
      harness: 'claude',
      model: '',
      effort: '',
      maxTurns: 5,
      maxSpendUsd: 0,
      boundSeconds: 60,
      contextWindow: 0,
      capabilities: ['read-only'],
      env: {},
      logFile: path.join(s.root, 'run.log'),
    });
    expect(run).toMatchObject({ ok: true, value: { end: { answer: 'ran', handBack: { next: 'pushed', summary: 'fixture run' } } } });
    // NO FRONT MATTER: a `read-only` capability reads PLOT_READ_ONLY_DENY's default list.
    expect(fs.readFileSync(path.join(s.root, 'run.log'), 'utf8')).not.toContain('has no mapping');
  });

  it('reads an unparseable or missing Agent settings file as none, and no PATH as no claude', async () => {
    const s = setup();
    for (const agentSettings of [path.join(s.root, 'missing.json'), path.join(s.root, 'bad.json')]) {
      fs.writeFileSync(path.join(s.root, 'bad.json'), '{nope');
      const out = await runnerDeps({
        env: { HOME: '' },
        scriptDir: s.scriptDir,
        repoRoot: s.root,
        worktree: s.root,
        agent: '',
        configKey: config({ 'Agent runner': 'sdk', 'Worker command': 'x' }),
        ports: { processes: {} as never, boundedRun: { run: async () => ({ ok: false, why: 'failed' }) } },
        boundSeconds: 60,
        agentSettings,
        checksOutFile: path.join(s.root, 'c.out'),
        now: () => Date.now(),
        log: () => undefined,
      });
      const run = await out.sdk!.agentRun({ afterWait: false, commitsSinceWait: () => 0 }).run({
        worktree: s.root, prompt: 'p', resumeId: '', role: 'worker', harness: 'claude', model: '', effort: '', maxTurns: 0,
        maxSpendUsd: 0, boundSeconds: 0, contextWindow: 0, capabilities: [], env: {}, logFile: path.join(s.root, 'run.log'),
      });
      expect(run).toMatchObject({ ok: true, value: { end: { answer: 'unstarted', detail: 'no `claude` executable is on PATH' } } });
    }
  });

  it('runs on command when no prompt file can be read', async () => {
    const s = setup();
    fs.rmSync(path.join(s.root, 'plugin', 'templates', 'worker-prompt.md'));
    expect(await deps(s, { 'Agent runner': 'sdk', 'Worker command': 'x' })).toEqual({ runner: 'command' });
  });
});

describe('the two SDK prompt files', () => {
  const root = path.join(__dirname, '..', '..', '..', '..');
  const files = ['skills/plot/templates/worker-prompt.md', '.plot/worker-prompt.md'];

  it.each(files)('%s fills the placeholders, names the read-only deny list, and drops the FOREGROUND sentence', (file) => {
    const text = fs.readFileSync(path.join(root, file), 'utf8');
    const prompt = parsePromptFile(text);
    expect(prompt.readOnlyDeny).toEqual(['Write', 'Edit', 'NotebookEdit', 'Bash', 'Agent', 'Task']);
    expect(prompt.body).toContain('{branch}');
    expect(prompt.body).toContain('{brief}');
    expect(prompt.body).toContain('{scripts}');
    expect(prompt.body).toContain('next: checks');
    expect(prompt.body).not.toMatch(/FOREGROUND/);
    expect(text.split('---')[1]).toMatch(/DECLARED DUPLICATE/);
  });
});
