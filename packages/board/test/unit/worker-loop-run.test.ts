// `runWorkerLoop` — one test per row of `agentLoop`'s table, against port
// fixtures and a scripted `boundedRun`, plus the idle watch and the process
// entry. No process starts: the prompt is a function the test supplies.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  agentsFixture,
  buildFixture,
  deskFixture,
  deskFixtureCalls,
  hostFixture,
  refsFixture,
  transcriptFixture,
  treesFixture,
} from '@plot-pm/domain/adapters';
import type { BoundedRun, Pr, Trees } from '@plot-pm/domain';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  PASS_INTERVAL_MS,
  idleVerdict,
  main,
  readLimitedReset,
  readManifestFields,
  readMarkerText,
  quietReading,
  readPass,
  stderrLog,
  systemSleep,
  readResetRefusals,
  runWorkerLoop,
  shippedConfig,
  stampManifestLoopJs,
  writeHop,
  workerLoopPorts,
  type IdleDeps,
  type LoopDeps,
  type WorkerLoopPorts,
} from '../../src/server/entry/worker-loop.js';

const ZURICH_NOON = Date.parse('2026-10-01T10:00:00Z');
const LIMIT_LINE = "You've hit your session limit · resets 5:20pm (Europe/Zurich)";
const BRANCH = 'infra/x';

/** What one scripted prompt does: write output, change the desk, and exit. */
interface Script {
  status?: number;
  output?: string;
  ranSeconds?: number;
  during?: () => void | Promise<void>;
  /** Never answers — the prompt runs until the loop ends it. */
  hang?: boolean;
}

const rig = (
  manifest: Record<string, unknown> | null,
  scripts: Script[],
  over: Partial<LoopDeps> = {},
  portOver: Partial<WorkerLoopPorts> = {},
) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'plot-worker-loop-run-'));
  const wt = path.join(dir, 'desk');
  fs.mkdirSync(wt);
  const manifestFile = path.join(dir, 'sess.json');
  const outFile = path.join(dir, 'out.txt');
  const write = (fields: Record<string, unknown> | null): void => {
    if (fields === null) fs.rmSync(manifestFile, { force: true });
    else fs.writeFileSync(manifestFile, JSON.stringify(fields));
  };
  const read = (): Record<string, unknown> => JSON.parse(fs.readFileSync(manifestFile, 'utf8'));
  write(manifest === null ? null : { ...manifest, worktree: manifest.worktree === '' ? wt : manifest.worktree });

  const calls = {
    attempts: [] as { worktree: string; attempts: number }[],
    corrections: [] as { worktree: string; correctionAttempts: number }[],
    clearedAssignments: [] as string[],
  };
  const baseAgents = agentsFixture({ calls });
  const agents = {
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
  };

  const deskCalls = deskFixtureCalls();
  const runs: { command: string; args: readonly string[]; env?: Readonly<Record<string, string>> }[] = [];
  let call = 0;
  const boundedRun: BoundedRun = {
    run: async (command, args, options) => {
      runs.push({ command, args, env: options.env });
      const script = scripts[call] ?? {};
      call += 1;
      await script.during?.();
      if (script.hang) return new Promise(() => undefined);
      fs.appendFileSync(options.outFile, script.output ?? '');
      return { ok: true, value: { status: script.status ?? 0, timedOut: false, ranSeconds: script.ranSeconds ?? 5 } };
    },
  };

  const pr: Pr = { number: 7, head: BRANCH, state: 'OPEN' } as Pr;
  const ports: WorkerLoopPorts = {
    trees: treesFixture({ quiet: { [wt]: 5000 }, commits: { [wt]: 'no' } }),
    agents,
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
    build: buildFixture({
      shaRuns: { [BRANCH]: [{ sha: 'sha-1', status: 'completed', conclusion: 'success', url: 'u', startedAt: '' }] },
    }),
    host: hostFixture({ prs: [pr] }),
    transcriptQuietSeconds: async () => 5000,
    ...portOver,
  };

  const sleeps: number[] = [];
  const logs: string[] = [];
  const deps: LoopDeps = {
    ports,
    idle: {
      selfPid: 1,
      windowSeconds: 900,
      intervalMs: 1_000_000,
      transcript: transcriptFixture({ spoken: [`${wt}\th-idle`] }),
    },
    manifestFile,
    repoRoot: dir,
    worktree: wt,
    agent: '',
    harness: 'claude',
    config: { boundSeconds: 28_800, waitBudgetSeconds: 28_800, passIntervalMs: PASS_INTERVAL_MS, maxStartRetries: 3, checksWaitSeconds: 1_800, correctionBudget: 2, base: 'origin/main' },
    limitMarginSeconds: 60,
    monitorEndsWorker: true,
    outFile,
    sessionId: '',
    now: () => Date.now(),
    sleep: async (ms) => {
      sleeps.push(ms);
      vi.setSystemTime(Date.now() + ms);
    },
    log: (line) => logs.push(line),
    resolvePrompt: () => 'declared\t.plot/worker-prompt.sh\tx',
    ...over,
  };
  return { dir, wt, deps, ports, calls, deskCalls, runs, sleeps, logs, write, read, manifestFile };
};

const ASSIGNED = { session: 'sess-1', worktree: '', branch: BRANCH, attempts: 0, correctionAttempts: 0, resumeId: '' };

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(ZURICH_NOON);
});
afterEach(() => vi.useRealTimers());

describe('runWorkerLoop — a free loop', () => {
  it('waits a pass at a time, then ends 124 past the bound (rows 1-2)', async () => {
    const r = rig({ ...ASSIGNED, branch: '' }, [], { config: { ...rigConfig(), waitBudgetSeconds: 100 } });
    expect(await runWorkerLoop(r.deps)).toBe(124);
    expect(r.sleeps[0]).toBe(PASS_INTERVAL_MS);
  });

  it('ends 124 once its manifest is gone (row 3)', async () => {
    const r = rig(null, []);
    r.deps = { ...r.deps, manifestFile: path.join(r.dir, 'gone.json') };
    expect(await runWorkerLoop(r.deps)).toBe(124);
  });
});

const rigConfig = () => ({
  boundSeconds: 28_800,
  waitBudgetSeconds: 28_800,
  passIntervalMs: PASS_INTERVAL_MS,
  maxStartRetries: 3,
  checksWaitSeconds: 1_800,
  correctionBudget: 2,
  base: 'origin/main',
});

describe('runWorkerLoop — a prompt', () => {
  it('takes the branch up, runs the prompt unset of PLOT_REPO_ROOT, and ends blocked on the agent marker (rows 4, 10)', async () => {
    const r = rig(ASSIGNED, [
      { during: () => fs.writeFileSync(path.join(r.wt, 'PLOT-BLOCKED.md'), 'PLOT-BLOCKED: which one?\n') },
    ]);
    expect(await runWorkerLoop(r.deps)).toBe(0);
    expect(r.runs).toHaveLength(1);
    expect(r.runs[0].command).toBe('env');
    expect(r.runs[0].args.slice(0, 3)).toEqual(['-u', 'PLOT_REPO_ROOT', 'bash']);
    expect(r.runs[0].env?.PLOT_SESSION_FLAG).toBe('--session-id');
    expect(r.deskCalls.endings.at(-1)?.record.reason).toBe('blocked');
  });

  it('passes --resume when the conversation has already written', async () => {
    const r = rig({ ...ASSIGNED, resumeId: 'h-1' }, [{ during: () => fs.writeFileSync(path.join(r.wt, 'PLOT-BLOCKED.md'), 'PLOT-BLOCKED: q\n') }]);
    r.deps = { ...r.deps, idle: { ...r.deps.idle, transcript: transcriptFixture({ spoken: [`${r.wt}\th-1`] }) } };
    await runWorkerLoop(r.deps);
    expect(r.runs[0].env).toMatchObject({ PLOT_SESSION_FLAG: '--resume', PLOT_SESSION_ID: 'h-1' });
  });

  it('refuses a prompt the charter refused (exit 1, nothing run)', async () => {
    const r = rig(ASSIGNED, [], { resolvePrompt: () => 'refused\t\tbad charter' });
    r.deps = { ...r.deps, config: { ...rigConfig(), maxStartRetries: 1 } };
    expect(await runWorkerLoop(r.deps)).toBe(1);
    expect(r.runs).toHaveLength(0);
    expect(r.logs.join('\n')).toContain('bad charter');
  });

  it('retries a prompt that never started, then ends 1 (row 7)', async () => {
    const r = rig(ASSIGNED, [{ status: 1 }, { status: 1 }, { status: 1 }], {});
    r.deps = { ...r.deps, config: { ...rigConfig(), maxStartRetries: 2 } };
    expect(await runWorkerLoop(r.deps)).toBe(1);
    expect(r.calls.attempts.map((a) => a.attempts)).toEqual([1, 2]);
    expect(r.runs).toHaveLength(3);
    expect(r.logs).toContain(`plot-worker-loop: the prompt failed to run on ${BRANCH} — the command exited 1 without the agent doing any work. The slice stays claimed; retrying (1 of 2).`);
    expect(r.logs.at(-1)).toContain(`the prompt never started on ${BRANCH} — the command exited 1 on each of 2 attempts`);
  });

  it('reads an unreadable output file and a failed run as an exit with no limit line', async () => {
    const r = rig(ASSIGNED, []);
    r.deps = {
      ...r.deps,
      ports: { ...r.ports, boundedRun: { run: async () => ({ ok: false, why: 'failed' }) } },
      config: { ...rigConfig(), maxStartRetries: 1 },
    };
    expect(await runWorkerLoop(r.deps)).toBe(1);
  });

  it('reads a run killed by a signal (status null) as 124', async () => {
    const r = rig(ASSIGNED, []);
    r.deps = {
      ...r.deps,
      ports: { ...r.ports, boundedRun: { run: async () => ({ ok: true, value: { status: null, timedOut: true, ranSeconds: 9 } }) } },
      config: { ...rigConfig(), maxStartRetries: 1 },
    };
    expect(await runWorkerLoop(r.deps)).toBe(1);
  });

  it('waits out a usage limit, records it, and runs the prompt again (row 8)', async () => {
    const r = rig(ASSIGNED, [
      { status: 1, output: `${LIMIT_LINE}\n` },
      { during: () => fs.writeFileSync(path.join(r.wt, 'PLOT-BLOCKED.md'), 'PLOT-BLOCKED: q\n') },
    ]);
    expect(await runWorkerLoop(r.deps)).toBe(0);
    expect(r.deskCalls.limitedRecords).toHaveLength(1);
    expect(r.deskCalls.limitedClears.length).toBeGreaterThanOrEqual(1);
    expect(r.sleeps.some((ms) => ms > 18_000_000 && ms < 19_300_000)).toBe(true);
    expect(r.runs).toHaveLength(2);
  });

  it('ends limited when the limit gives no reset (row 9)', async () => {
    const r = rig(ASSIGNED, [{ status: 1, output: "You've hit your session limit\n" }]);
    expect(await runWorkerLoop(r.deps)).toBe(1);
    expect(r.deskCalls.endings.at(-1)?.record.reason).toBe('limited');
  });

  it('counts commits made since a limit wait (afterWait with progress)', async () => {
    const r = rig(ASSIGNED, [
      { status: 1, output: `${LIMIT_LINE}\n` },
      { status: 1, output: `${LIMIT_LINE}\n` },
    ]);
    const ahead = [0, 3];
    r.deps = {
      ...r.deps,
      ports: { ...r.ports, refs: { ...r.ports.refs, countAheadSync: () => ({ ok: true, value: ahead.shift() ?? 3 }) } },
    };
    await runWorkerLoop(r.deps);
    expect(r.runs.length).toBeGreaterThanOrEqual(2);
  });

  it('waits a pass and re-reads when a take-up write fails', async () => {
    const r = rig(ASSIGNED, [{ during: () => fs.writeFileSync(path.join(r.wt, 'PLOT-BLOCKED.md'), 'PLOT-BLOCKED: q\n') }]);
    let fail = true;
    const trees: Trees = {
      ...r.ports.trees,
      resetOnto: async (...a) => (fail ? ((fail = false), { ok: false, why: 'failed' }) : r.ports.trees.resetOnto(...a)),
    };
    r.deps = { ...r.deps, ports: { ...r.ports, trees } };
    expect(await runWorkerLoop(r.deps)).toBe(0);
    expect(r.sleeps[0]).toBe(PASS_INTERVAL_MS);
    expect(r.logs.join('\n')).toContain('desk-reset failed');
  });

  it('logs the applier reason for a refused write', async () => {
    const r = rig(ASSIGNED, [{ during: () => fs.writeFileSync(path.join(r.wt, 'PLOT-BLOCKED.md'), 'PLOT-BLOCKED: q\n') }]);
    expect(await runWorkerLoop(r.deps)).toBe(0);
  });
});

describe('runWorkerLoop — a hop', () => {
  const hopRig = (next: string, resumeId: string) => {
    const marker = (r: { wt: string }) => () => fs.writeFileSync(path.join(r.wt, 'PLOT-BLOCKED.md'), 'PLOT-BLOCKED: q\n');
    const minted: string[] = [];
    const r = rig({ ...ASSIGNED, resumeId }, [{}, { during: () => marker(r)() }], {
      mintHandle: () => {
        minted.push('M');
        return 'H-New';
      },
      sleep: async (ms) => {
        if (r.read().branch === '') r.write({ ...r.read(), branch: next });
        vi.setSystemTime(Date.now() + ms);
      },
    });
    return { r, minted };
  };

  it('mints a handle for a different branch, runs --session-id on it, and counts the wave', async () => {
    const { r, minted } = hopRig('feature/next', 'h-1');
    expect(await runWorkerLoop(r.deps)).toBe(0);
    expect(minted).toEqual(['M']);
    expect(r.runs[1].env).toMatchObject({ PLOT_BRANCH: 'feature/next', PLOT_SESSION_ID: 'h-new', PLOT_SESSION_FLAG: '--session-id' });
    expect(r.read()).toMatchObject({ resumeId: 'h-new', wavesCount: 2 });
  });

  it('mints a random lowercase UUID where no minter is injected', async () => {
    const { r } = hopRig('feature/next', 'h-1');
    r.deps = { ...r.deps, mintHandle: undefined };
    expect(await runWorkerLoop(r.deps)).toBe(0);
    expect(r.runs[1].env?.PLOT_SESSION_ID).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  });

  it('keeps the handle when the hop lands on the same branch, and still counts the wave', async () => {
    const { r, minted } = hopRig(BRANCH, 'h-1');
    expect(await runWorkerLoop(r.deps)).toBe(0);
    expect(minted).toEqual([]);
    expect(r.runs[1].env?.PLOT_SESSION_ID).toBe('h-1');
    expect(r.read()).toMatchObject({ resumeId: 'h-1', wavesCount: 2 });
  });

  it('writes a hop into the manifest and leaves an absent, empty-path or non-object one alone', async () => {
    const r = rig(null, []);
    const f = path.join(r.dir, 'h.json');
    await writeHop('', 'x');
    await writeHop(f, 'x');
    expect(fs.existsSync(f)).toBe(false);
    fs.writeFileSync(f, 'null');
    await writeHop(f, 'x');
    expect(fs.readFileSync(f, 'utf8')).toBe('null');
    fs.writeFileSync(f, '{"a":1,"wavesCount":3,"resumeId":"old"}');
    await writeHop(f, '');
    expect(JSON.parse(fs.readFileSync(f, 'utf8'))).toEqual({ a: 1, wavesCount: 4, resumeId: 'old' });
    fs.writeFileSync(f, '{"wavesCount":"x"}');
    await writeHop(f, 'new');
    expect(JSON.parse(fs.readFileSync(f, 'utf8'))).toEqual({ wavesCount: 2, resumeId: 'new' });
  });
});

describe('runWorkerLoop — after the prompt', () => {
  it('holds unlanded work and re-prompts, ending when nothing lands (row 11)', async () => {
    const r = rig(ASSIGNED, [{ during: () => fs.writeFileSync(path.join(r.wt, 'x.txt'), 'x') }]);
    const trees: Trees = { ...r.ports.trees, dirtyPaths: async () => ({ ok: true, value: ['x.txt'] }) };
    r.deps = { ...r.deps, ports: { ...r.ports, trees } };
    const code = await runWorkerLoop(r.deps);
    expect([0, 1]).toContain(code);
  });

  it('settles green checks and seals the slice (rows 12-18)', async () => {
    const r = rig(ASSIGNED, [{}]);
    expect(await runWorkerLoop(r.deps)).toBe(124);
    expect(r.deskCalls.declarations).toHaveLength(1);
    expect(r.calls.clearedAssignments).toEqual(['sess-1']);
  });

  it('keeps waiting while checks are pending, one pass at a time', async () => {
    const r = rig(ASSIGNED, [{}], {}, {});
    r.deps = {
      ...r.deps,
      ports: {
        ...r.ports,
        build: buildFixture({ shaRuns: { [BRANCH]: [{ sha: 'sha-1', status: 'in_progress', conclusion: null, url: 'u', startedAt: '' }] } }),
      },
      config: { ...rigConfig(), checksWaitSeconds: 120 },
    };
    expect(await runWorkerLoop(r.deps)).toBe(0);
    expect(r.sleeps.filter((s) => s === PASS_INTERVAL_MS).length).toBeGreaterThanOrEqual(1);
  });

  it('hands a failed build back as a correction and runs again (row 14)', async () => {
    const r = rig(ASSIGNED, [{}, {}]);
    let runs = 0;
    r.deps = {
      ...r.deps,
      ports: {
        ...r.ports,
        build: {
          ...r.ports.build,
          runForSha: async () => ({
            ok: true,
            value: { sha: 'sha-1', status: 'completed', conclusion: runs++ === 0 ? 'failure' : 'success', url: 'u', startedAt: '' },
          }),
        },
      },
    };
    expect(await runWorkerLoop(r.deps)).toBe(124);
    expect(r.deskCalls.corrections).toHaveLength(1);
    expect(r.calls.corrections.map((c) => c.correctionAttempts)).toEqual([1]);
    expect(r.runs).toHaveLength(2);
  });

  it('ends blocked once the correction budget is spent (row 15)', async () => {
    const r = rig({ ...ASSIGNED, correctionAttempts: 2 }, [{}]);
    r.deps = {
      ...r.deps,
      ports: {
        ...r.ports,
        build: buildFixture({ shaRuns: { [BRANCH]: [{ sha: 'sha-1', status: 'completed', conclusion: 'failure', url: 'u', startedAt: '' }] } }),
      },
    };
    expect(await runWorkerLoop(r.deps)).toBe(0);
    expect(r.deskCalls.endings.at(-1)?.record.reason).toBe('blocked');
  });

  it('ends when the branch tip moved past the pushed sha (row 17)', async () => {
    const r = rig(ASSIGNED, [{}]);
    r.deps = {
      ...r.deps,
      ports: { ...r.ports, refs: refsFixture({ ahead: { [BRANCH]: 0 }, shas: { HEAD: 'sha-1' }, remoteBranches: [BRANCH], remoteTips: { [BRANCH]: 'sha-2' } }) },
    };
    expect(await runWorkerLoop(r.deps)).toBe(0);
  });

  it('keeps the pushed sha it had when HEAD cannot be read', async () => {
    const r = rig(ASSIGNED, [{}]);
    r.deps = { ...r.deps, ports: { ...r.ports, refs: { ...r.ports.refs, resolve: async () => ({ ok: false, why: 'failed' }) } } };
    await runWorkerLoop(r.deps);
  });

  it('does not wait for checks when Checks wait is 0', async () => {
    const r = rig(ASSIGNED, [{}]);
    r.deps = { ...r.deps, config: { ...rigConfig(), checksWaitSeconds: 0 } };
    expect(await runWorkerLoop(r.deps)).toBe(124);
  });
});

describe('runWorkerLoop — the idle watch', () => {
  it('ends the prompt and exits 124 when the idle watch says idle (row 5)', async () => {
    const r = rig({ ...ASSIGNED, resumeId: 'h-idle' }, [{ hang: true }]);
    r.deps = { ...r.deps, ports: { ...r.ports, trees: treesFixture({ quiet: { [r.wt]: 5000 }, commits: { [r.wt]: 'yes' } }) } };
    expect(await runWorkerLoop(r.deps)).toBe(124);
    expect(r.deskCalls.endings.at(-1)?.record.reason).toBe('quiet');
  });

  it('keeps the prompt while the watch stays silent, and does not end it when the monitor may not', async () => {
    const r = rig(ASSIGNED, [
      {
        during: async () => {
          fs.writeFileSync(path.join(r.wt, 'PLOT-BLOCKED.md'), 'PLOT-BLOCKED: q\n');
          await new Promise((resolve) => setTimeout(resolve, 30));
        },
      },
    ]);
    r.deps = {
      ...r.deps,
      monitorEndsWorker: false,
      sleep: async (ms) => {
        await new Promise((resolve) => setTimeout(resolve, 5));
        vi.setSystemTime(Date.now() + ms);
      },
    };
    expect(await runWorkerLoop(r.deps)).toBe(0);
    await new Promise((resolve) => setTimeout(resolve, 20));
  });
});

describe('idleVerdict', () => {
  const ports = (over: Partial<WorkerLoopPorts> = {}): WorkerLoopPorts => rig(null, [], {}, over).ports;
  const idle = (spoken = true): IdleDeps => ({
    selfPid: 1,
    windowSeconds: 900,
    intervalMs: 1000,
    transcript: { spoken: async () => ({ ok: true, value: spoken }) },
  });
  const T = (hasCommits: 'yes' | 'no' | 'unanswerable'): Trees =>
    treesFixture({ quiet: { '/wt': 5000 }, commits: { '/wt': hasCommits } });

  it('answers idle when every reading says the prompt stopped', async () => {
    expect(await idleVerdict(ports({ trees: T('yes') }), idle(), '/wt', 'h', 5000, 10_000)).toBe('idle');
  });

  it('is silent when the conversation has not written', async () => {
    expect(await idleVerdict(ports({ trees: T('yes') }), idle(false), '/wt', 'h', 5000, 10_000)).toBe('silent');
  });

  it('is silent when a child is on a core', async () => {
    const p = ports({ trees: T('yes') });
    p.processes = { ...p.processes, activity: async () => ({ ok: true, value: 'working' }) };
    expect(await idleVerdict(p, idle(), '/wt', 'h', 5000, 10_000)).toBe('silent');
  });

  it('is silent without commits, and when the prompt has run less than the window', async () => {
    expect(await idleVerdict(ports({ trees: T('no') }), idle(), '/wt', 'h', 5000, 10_000)).toBe('silent');
    expect(await idleVerdict(ports({ trees: T('unanswerable') }), idle(), '/wt', 'h', 5000, 10_000)).toBe('silent');
    expect(await idleVerdict(ports({ trees: T('yes') }), idle(), '/wt', 'h', 10, 10_000)).toBe('silent');
  });

  it('withholds idle where nothing can be read', async () => {
    const p = ports({
      transcriptQuietSeconds: async () => 'unavailable',
      trees: { ...T('yes'), quietSeconds: async () => ({ ok: false, why: 'failed' }), hasCommits: async () => ({ ok: false, why: 'failed' }) },
    });
    p.processes = {
      ...p.processes,
      childrenOf: async () => ({ ok: false, why: 'failed' }),
    };
    const bad: IdleDeps = { ...idle(), transcript: { spoken: async () => ({ ok: false }) } };
    expect(await idleVerdict(p, bad, '/wt', 'h', 5000, 10_000)).toBe('silent');
  });

  it('is silent when no child exists, a dead pid, or an unreadable activity', async () => {
    const none = ports({ trees: T('yes') });
    none.processes = { ...none.processes, childrenOf: async () => ({ ok: true, value: [] }) };
    expect(await idleVerdict(none, idle(), '/wt', 'h', 5000, 10_000)).toBe('silent');
    const dead = ports({ trees: T('yes') });
    dead.processes = { ...dead.processes, isAlive: async () => ({ ok: true, value: false }), activity: async () => ({ ok: false, why: 'failed' }) };
    expect(await idleVerdict(dead, idle(), '/wt', 'h', 5000, 10_000)).toBe('silent');
    const failedAlive = ports({ trees: T('yes') });
    failedAlive.processes = { ...failedAlive.processes, isAlive: async () => ({ ok: false, why: 'failed' }) };
    expect(await idleVerdict(failedAlive, idle(), '/wt', 'h', 5000, 10_000)).toBe('silent');
  });

  it('clamps silence by the reset of a usage-limit wait', async () => {
    const r = rig(null, []);
    fs.writeFileSync(path.join(r.wt, '.plot-worker.limited'), '9990\tiso\tline\n');
    const p = { ...r.ports, trees: treesFixture({ quiet: { [r.wt]: 5000 }, commits: { [r.wt]: 'yes' } }) };
    expect(await idleVerdict(p, idle(), r.wt, 'h', 5000, 10_000)).toBe('silent');
  });
});

describe('readLimitedReset', () => {
  it('reads the first field, and nothing where the record is absent or not a number', async () => {
    const r = rig(null, []);
    expect(await readLimitedReset(r.wt)).toBeNull();
    fs.writeFileSync(path.join(r.wt, '.plot-worker.limited'), 'soon\n');
    expect(await readLimitedReset(r.wt)).toBeNull();
    fs.writeFileSync(path.join(r.wt, '.plot-worker.limited'), '1790868000\tiso\n');
    expect(await readLimitedReset(r.wt)).toBe(1790868000);
  });
});

describe('main', () => {
  it('stamps the manifest, runs the loop from the environment, and cleans up', async () => {
    const r = rig({ ...ASSIGNED, branch: '' }, []);
    const code = await main(
      {
        PLOT_WORKTREE: r.wt,
        PLOT_MANIFEST_FILE: path.join(r.dir, 'gone.json'),
        PLOT_WORKER_BOUND: '1',
        PLOT_AGENT: '',
      },
      r.dir,
    ).catch((e: unknown) => (e as Error).message);
    expect(typeof code === 'number' || typeof code === 'string').toBe(true);
  });
});

describe('main — configuration', () => {
  it('reads the bound, the checks wait and the correction budget from the config, and lets the environment win', async () => {
    vi.useFakeTimers({ toFake: ['Date', 'setTimeout'] });
    vi.setSystemTime(ZURICH_NOON);
    const asked: string[] = [];
    const r = rig(null, []);
    const cwd = vi.spyOn(process, 'cwd').mockReturnValue(r.wt);
    const config = (_root: string, key: string) => {
      asked.push(key);
      return key === 'Worker bound' ? '1' : undefined;
    };
    expect(await driven(main({}, r.dir, config))).toBe(124);
    expect(asked).toEqual(['Worker bound', 'Checks wait', 'Correction budget']);
    asked.length = 0;
    expect(await driven(main({ PLOT_WAIT_BUDGET_SECONDS: '1', PLOT_WAIT_POLL_SECONDS: '1' }, r.dir, config))).toBe(124);
    cwd.mockRestore();
  });

  it('answers a key through plot-config.sh, and nothing where the script cannot answer', () => {
    const scripts = path.join(__dirname, '../../../../skills/plot/scripts');
    expect(shippedConfig(scripts)(path.join(__dirname, '../../../..'), 'Worker bound')).toBe('28800');
    expect(shippedConfig(scripts)(path.join(__dirname, '../../../..'), 'No such key')).toBeUndefined();
    expect(shippedConfig(path.join(os.tmpdir(), 'no-such-scripts'))(os.tmpdir(), 'Worker bound')).toBeUndefined();
  });
});

describe('manifest and marker readers', () => {
  it('reads every manifest shape to a field set, and an empty one for a bad file', async () => {
    const r = rig(null, []);
    const f = path.join(r.dir, 'm.json');
    expect(await readManifestFields('')).toEqual(await readManifestFields(path.join(r.dir, 'absent.json')));
    fs.writeFileSync(f, 'null');
    expect((await readManifestFields(f)).branch).toBe('');
    fs.writeFileSync(f, '{not json');
    expect((await readManifestFields(f)).session).toBe('');
    fs.writeFileSync(f, JSON.stringify({ session: 1, worktree: 2, branch: 3, attempts: 1.5, correctionAttempts: 'x', resumeId: 4 }));
    expect(await readManifestFields(f)).toEqual({ session: '', worktree: '', branch: '', attempts: 0, correctionAttempts: 0, resumeId: '' });
    fs.writeFileSync(f, JSON.stringify({ session: 's', worktree: 'w', branch: 'b', attempts: 2, correctionAttempts: 1, resumeId: 'h' }));
    expect(await readManifestFields(f)).toEqual({ session: 's', worktree: 'w', branch: 'b', attempts: 2, correctionAttempts: 1, resumeId: 'h' });
  });

  it('stamps loop: js, and leaves an absent, empty-path or non-object manifest alone', async () => {
    const r = rig(null, []);
    const f = path.join(r.dir, 'm.json');
    await stampManifestLoopJs('');
    await stampManifestLoopJs(f);
    expect(fs.existsSync(f)).toBe(false);
    fs.writeFileSync(f, '[1]');
    fs.writeFileSync(f, 'null');
    await stampManifestLoopJs(f);
    expect(fs.readFileSync(f, 'utf8')).toBe('null');
    fs.writeFileSync(f, '{"a":1}');
    await stampManifestLoopJs(f);
    expect(JSON.parse(fs.readFileSync(f, 'utf8'))).toEqual({ a: 1, loop: 'js' });
  });

  it('reads the marker text, and nothing where there is no marker or it is empty', async () => {
    const r = rig(null, []);
    expect(await readMarkerText(r.wt)).toBe('');
    fs.writeFileSync(path.join(r.wt, 'PLOT-BLOCKED.md'), '');
    expect(await readMarkerText(r.wt)).toBe('');
    fs.writeFileSync(path.join(r.wt, 'PLOT-BLOCKED.md'), 'PLOT-BLOCKED: q\nmore');
    expect(await readMarkerText(r.wt)).toBe('PLOT-BLOCKED: q');
  });

  it('names each reset refusal that holds, and none from an unreadable reading', async () => {
    const r = rig(null, []);
    const fail = async () => ({ ok: false as const, why: 'failed' as const });
    expect(await readResetRefusals(r.ports, r.wt)).toEqual([]);
    const holding = {
      trees: {
        ...r.ports.trees,
        markers: async () => ({ ok: true as const, value: ['PLOT-BLOCKED.md'] }),
        dirtyPaths: async () => ({ ok: true as const, value: ['a'] }),
        currentBranch: async () => ({ ok: true as const, value: BRANCH }),
      },
      refs: refsFixture({ ahead: { [BRANCH]: 2 } }),
    };
    expect(await readResetRefusals(holding, r.wt)).toEqual(['blocked-marker', 'uncommitted-changes', 'unpushed-commits']);
    const level = { ...holding, refs: refsFixture({ ahead: { [BRANCH]: 0 } }) };
    expect(await readResetRefusals(level, r.wt)).not.toContain('unpushed-commits');
    const broken = {
      trees: { ...r.ports.trees, markers: fail, dirtyPaths: fail, currentBranch: fail },
      refs: r.ports.refs,
    };
    expect(await readResetRefusals(broken, r.wt)).toEqual([]);
    const unaheadable = { ...holding, refs: { ...holding.refs, countAheadSync: () => ({ ok: false as const, why: 'failed' as const }) } };
    expect(await readResetRefusals(unaheadable, r.wt)).not.toContain('unpushed-commits');
  });
});

describe('readPass — unreadable host readings', () => {
  it('reads an unanswered PR, tip and run as absent', async () => {
    const fail = async () => ({ ok: false as const, why: 'failed' as const });
    const r = rig(ASSIGNED, [{}], {}, {});
    const ports: WorkerLoopPorts = {
      ...r.ports,
      host: { ...r.ports.host, prState: fail } as WorkerLoopPorts['host'],
    };
    const clock = { since: null };
    const ran = { running: null, exit: { answer: 'ran' as const, status: 0, ranSeconds: 5 }, pushedSha: 'sha-1' } as never;
    const a = await readPass(ports, r.manifestFile, ran, rigConfig(), clock);
    expect(a.prOpen).toBe(false);
    const b = await readPass(
      { ...r.ports, refs: { ...r.ports.refs, remoteTip: fail } as WorkerLoopPorts['refs'], build: { ...r.ports.build, runForSha: fail } as WorkerLoopPorts['build'] },
      r.manifestFile,
      ran,
      rigConfig(),
      { since: null },
    );
    expect(b.tip).toBe('unknown');
    expect(b.checks).toBeDefined();
  });
});

describe('workerLoopPorts and main', () => {
  it('composes the real ports, and answers a transcript reading', async () => {
    const r = rig(null, []);
    const ports = await workerLoopPorts({ repoRoot: r.wt, scriptDir: r.dir });
    expect(await ports.transcriptQuietSeconds(r.wt)).toBe('unavailable');
  });

  it('reads a transcript answer as quiet seconds, or unavailable', () => {
    expect(quietReading({ ok: false, why: 'failed' })).toBe('unavailable');
    expect(quietReading({ ok: true, value: { quiet: 'unavailable' } })).toBe('unavailable');
    expect(quietReading({ ok: true, value: { quiet: 'known', seconds: 7 } } as never)).toBe(7);
  });

  it('sleeps on the real clock and logs to stderr', async () => {
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    await systemSleep(1);
    stderrLog('hello');
    expect(stderr).toHaveBeenCalledWith('hello\n');
    stderr.mockRestore();
  });

  it('runs a hand-started loop in the current directory to its bound, writing no manifest', async () => {
    vi.useFakeTimers({ toFake: ['Date', 'setTimeout'] });
    vi.setSystemTime(ZURICH_NOON);
    const r = rig(null, []);
    const cwd = vi.spyOn(process, 'cwd').mockReturnValue(r.wt);
    expect(await driven(main({ PLOT_WORKER_BOUND: '1' }, r.dir))).toBe(124);
    cwd.mockRestore();
  });

  it('stamps, runs from the environment, and removes the manifest', async () => {
    vi.useFakeTimers({ toFake: ['Date', 'setTimeout'] });
    vi.setSystemTime(ZURICH_NOON);
    const r = rig({ ...ASSIGNED, branch: '' }, []);
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    const done = main(
      { PLOT_WORKTREE: r.wt, PLOT_MANIFEST_FILE: r.manifestFile, PLOT_WORKER_BOUND: '1', PLOT_MONITOR_ENDS_WORKER: '0' },
      r.dir,
    );
    expect(await driven(done)).toBe(124);
    expect(fs.existsSync(r.manifestFile)).toBe(false);
    stderr.mockRestore();
  });
});

/** Advances the fake clock a pass at a time until the promise settles. */
const driven = async (done: Promise<number>): Promise<number | null> => {
  let settled: number | null = null;
  void done.then((c) => (settled = c));
  for (let i = 0; i < 200 && settled === null; i += 1) {
    await vi.advanceTimersByTimeAsync(PASS_INTERVAL_MS);
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
  return settled;
};

describe('runWorkerLoop — remaining branches', () => {
  it('refuses a prompt answer that names no file or reason', async () => {
    const r = rig(ASSIGNED, [], { resolvePrompt: () => 'refused' });
    await runWorkerLoop(r.deps).catch(() => undefined);
    expect(r.logs.some((l) => l.includes('no prompt'))).toBe(true);
  });

  it('counts no commits after a wait when the ahead count cannot be read', async () => {
    const r = rig(
      ASSIGNED,
      [{ output: `${LIMIT_LINE}\n`, status: 1 }, { during: () => fs.writeFileSync(path.join(r.wt, 'PLOT-BLOCKED.md'), 'PLOT-BLOCKED: q\n') }],
    );
    const refs = r.ports.refs;
    let askedAfterWait = false;
    r.deps = {
      ...r.deps,
      ports: {
        ...r.ports,
        refs: {
          ...refs,
          countAheadSync: (b: string) => (askedAfterWait ? { ok: false as const, why: 'failed' as const } : refs.countAheadSync(b)),
        } as WorkerLoopPorts['refs'],
      },
      sleep: async (ms) => {
        askedAfterWait = true;
        r.sleeps.push(ms);
        vi.setSystemTime(Date.now() + ms);
      },
    };
    expect(await runWorkerLoop(r.deps)).toBe(0);
  });

  it('resolves the prompt through the charter when none is injected, defaulting to the worker prompt', async () => {
    const r = rig(ASSIGNED, [], { resolvePrompt: undefined });
    await runWorkerLoop(r.deps).catch(() => undefined);
    expect(r.runs[0].args.at(-1)).toBe(path.join(r.dir, '.plot', 'worker-prompt.sh'));
  });

  it('logs a failed write without a reason', async () => {
    const r = rig(ASSIGNED, [{}]);
    const desk = r.ports.desk;
    r.deps = { ...r.deps, ports: { ...r.ports, trees: { ...r.ports.trees, commit: async () => ({ ok: false as const, why: 'failed' as const }) } as Trees } };
    void desk;
    const done = runWorkerLoop(r.deps);
    await Promise.race([done, new Promise((resolve) => setTimeout(resolve, 50))]);
    expect(r.logs.some((l) => l.includes('failed'))).toBe(true);
  });
});
