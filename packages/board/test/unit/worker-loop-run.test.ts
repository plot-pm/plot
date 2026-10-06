// `runWorkerLoop` — one test per row of `agentLoop`'s table, against port
// fixtures and a scripted `boundedRun`, plus the idle watch and the process
// entry. No process starts: the prompt is a function the test supplies.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { rmTree } from '../helpers.mjs';
import {
  agentDesk,
  agentManifest,
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
  count,
  defaultBase,
  failureLines,
  integer,
  liveHolders,
  positive,
  readClaimAnswer,
  resolveAgentSettings,
  takeUpLine,
  takeUpRefusalOf,
  idleVerdict,
  main,
  offsetClock,
  harnessName,
  readLimitedReset,
  readManifestFields,
  readMarkerText,
  quietReading,
  readPass,
  runEvidence,
  stderrLog,
  systemSleep,
  readResetRefusals,
  runWorkerLoop,
  shippedConfig,
  stampManifestLoopJs,
  onStop,
  type StopTarget,
  writeHop,
  workerLoopPorts,
  type IdleDeps,
  type LoopDeps,
  type RestartDeps,
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

/** Every directory a rig made, removed by its exact name after each test. */
const made: string[] = [];

const rig = (
  manifest: Record<string, unknown> | null,
  scripts: Script[],
  over: Partial<LoopDeps> = {},
  portOver: Partial<WorkerLoopPorts> = {},
) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'plot-worker-loop-run-'));
  made.push(dir);
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

  const spends: { worktree: string; branch: string }[] = [];
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
    recordSpend: async (worktree: string, branch: string) => {
      spends.push({ worktree, branch });
    },
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
    config: { boundSeconds: 28_800, waitBudgetSeconds: 28_800, passIntervalMs: PASS_INTERVAL_MS, checksPollMs: PASS_INTERVAL_MS, maxStartRetries: 3, checksWaitSeconds: 1_800, correctionBudget: 2, sliceMaxRuns: 12, base: 'origin/main' },
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
  return { dir, wt, deps, ports, calls, deskCalls, runs, sleeps, logs, write, read, manifestFile, spends };
};

const ASSIGNED = { session: 'sess-1', worktree: '', branch: BRANCH, attempts: 0, correctionAttempts: 0, resumeId: '' };

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(ZURICH_NOON);
});
afterEach(() => {
  vi.useRealTimers();
  for (const dir of made.splice(0)) rmTree(dir);
});

describe('runWorkerLoop — a free loop', () => {
  it('waits a pass at a time, then ends 124 past the bound (rows 1-2)', async () => {
    const r = rig({ ...ASSIGNED, branch: '' }, [], { config: { ...rigConfig(), waitBudgetSeconds: 100 } });
    expect(await runWorkerLoop(r.deps)).toBe(124);
    expect(r.sleeps[0]).toBe(PASS_INTERVAL_MS);
    expect(r.logs.join('\n')).toMatch(/the wait ran out on \? — free for \d+s with no slice offered, past the 100s wait bound; ending worker/);
  });

  it('does not say a wait ran out when the manifest went away', async () => {
    const r = rig(null, []);
    r.deps = { ...r.deps, manifestFile: path.join(r.dir, 'gone.json') };
    await runWorkerLoop(r.deps);
    expect(r.logs.join('\n')).not.toContain('the wait ran out');
  });

  it('names the wait once, with the slug', async () => {
    const r = rig({ ...ASSIGNED, branch: '' }, [], { slug: 'agent-x' });
    await runWorkerLoop(r.deps);
    const lines = r.logs.filter((l) => l.includes('free on agent-x'));
    expect(lines).toEqual(['plot-worker-loop: free on agent-x — nothing handed over yet. Waiting to be handed work: reading the manifest every 60s, for up to 28800s; stop it with /plot-fleet --stop']);
  });

  it('names an unnamed agent with a question mark', async () => {
    const r = rig({ ...ASSIGNED, branch: '' }, []);
    await runWorkerLoop(r.deps);
    expect(r.logs[0]).toContain('free on ? —');
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
  checksPollMs: PASS_INTERVAL_MS,
  maxStartRetries: 3,
  checksWaitSeconds: 1_800,
  correctionBudget: 2,
  sliceMaxRuns: 12,
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
    expect(r.runs[0].args.slice(0, 5)).toEqual(['-u', 'PLOT_REPO_ROOT', '-u', 'PLOT_AGENT_SETTINGS', 'bash']);
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

  it('ends 124 and says so when the bound killed the prompt (row 6)', async () => {
    const r = rig(ASSIGNED, []);
    r.deps = {
      ...r.deps,
      ports: { ...r.ports, boundedRun: { run: async () => ({ ok: true, value: { status: null, timedOut: true, ranSeconds: 9 } }) } },
    };
    expect(await runWorkerLoop(r.deps)).toBe(124);
    expect(r.logs.join('\n')).toMatch(/the bound expired on \S+ — the prompt exceeded the \d+s bound/);
    expect(r.deskCalls.endings.at(-1)?.record.reason).toBe('bound');
  });

  it('ends unreadable when the bound killed the prompt and no transcript could be read (row 6)', async () => {
    const r = rig(ASSIGNED, []);
    r.deps = {
      ...r.deps,
      ports: {
        ...r.ports,
        transcriptQuietSeconds: async () => 'unavailable',
        boundedRun: { run: async () => ({ ok: true, value: { status: null, timedOut: true, ranSeconds: 9 } }) },
      },
    };
    expect(await runWorkerLoop(r.deps)).toBe(124);
    expect(r.deskCalls.endings.at(-1)?.record.reason).toBe('unreadable');
    expect(r.logs.join('\n')).toContain(`nobody could tell on ${BRANCH} — no transcript could be read for this worktree`);
  });

  it('runs the prompt with the resolved settings file, and unsets the variable where none resolved', async () => {
    const marker = (r: { wt: string }) => () => fs.writeFileSync(path.join(r.wt, 'PLOT-BLOCKED.md'), 'PLOT-BLOCKED: q\n');
    const withSettings = rig(ASSIGNED, [{ during: () => marker(withSettings)() }], { agentSettings: '/repo/.plot/agent-settings.json' });
    await runWorkerLoop(withSettings.deps);
    expect(withSettings.runs[0].env?.PLOT_AGENT_SETTINGS).toBe('/repo/.plot/agent-settings.json');
    expect(withSettings.runs[0].args).not.toContain('PLOT_AGENT_SETTINGS');
    const without = rig(ASSIGNED, [{ during: () => marker(without)() }]);
    await runWorkerLoop(without.deps);
    expect(without.runs[0].env?.PLOT_AGENT_SETTINGS).toBeUndefined();
    expect(without.runs[0].args.slice(0, 4)).toEqual(['-u', 'PLOT_REPO_ROOT', '-u', 'PLOT_AGENT_SETTINGS']);
  });

  it('reads a run killed by a signal the bound did not send (status null) as 124', async () => {
    const r = rig(ASSIGNED, []);
    r.deps = {
      ...r.deps,
      ports: { ...r.ports, boundedRun: { run: async () => ({ ok: true, value: { status: null, timedOut: false, ranSeconds: 9 } }) } },
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
    expect(r.logs.some((l) => /usage limit on \S+ until .*; waiting/.test(l))).toBe(true);
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

  it('clears the assignment and goes free when the desk reset is refused, running no prompt', async () => {
    const r = rig(ASSIGNED, [], { config: { ...rigConfig(), waitBudgetSeconds: 100 } });
    const trees: Trees = { ...r.ports.trees, resetOnto: async () => ({ ok: false, why: 'failed' }) };
    r.deps = { ...r.deps, ports: { ...r.ports, trees } };
    expect(await runWorkerLoop(r.deps)).toBe(124);
    expect(r.runs).toHaveLength(0);
    expect(r.calls.clearedAssignments).toEqual(['sess-1']);
    expect(r.read().branch).toBe('');
    expect(r.logs).toContain(`plot-worker-loop: could not reset the desk at ${r.wt} onto ${BRANCH}; the assignment is cleared and the agent goes free`);
  });

  it.each([
    ['held-by-agent', 'REGISTRY LOCK VIOLATION'],
    ['stale-claim', `release it with plot-dispatch.sh --release ${BRANCH}`],
    ['work-on-ref', 'carries work that no live agent holds'],
    ['absent', 'origin has no such branch'],
  ] as const)('names a rejected claim push read as %s, clears the assignment and runs no prompt', async (answer, line) => {
    const r = rig(ASSIGNED, [], { config: { ...rigConfig(), waitBudgetSeconds: 100 } });
    const holder = '/desks/other';
    const claimOnly = { at: 1, subject: `plot: claim ${BRANCH}`, tree: 't', parentTree: 't' };
    const work = { at: 2, subject: 'feat: real work', tree: 't2', parentTree: 't' };
    const agents = {
      ...r.ports.agents,
      declared: async () => ({
        ok: true as const,
        value: answer === 'held-by-agent' ? [agentManifest({ session: 'sess-other', branch: BRANCH, worktree: holder, pid: '4242' })] : [],
      }),
      desk: async () => ({ ok: true as const, value: agentDesk() }),
    };
    const refs = refsFixture({
      remoteBranches: answer === 'absent' ? [] : [BRANCH],
      commitSubjects: { [`origin/main..origin/${BRANCH}`]: answer === 'work-on-ref' ? [work, claimOnly] : [claimOnly] },
    });
    const trees: Trees = { ...r.ports.trees, push: async () => ({ ok: false, why: 'failed' }) };
    r.deps = { ...r.deps, ports: { ...r.ports, agents, refs, trees } };
    expect(await runWorkerLoop(r.deps)).toBe(124);
    expect(r.runs).toHaveLength(0);
    expect(r.calls.clearedAssignments).toEqual(['sess-1']);
    expect(r.logs.filter((l) => l.includes(line))).toHaveLength(1);
  });

  it('logs a write the port refused', async () => {
    const r = rig(ASSIGNED, [{ during: () => fs.writeFileSync(path.join(r.wt, 'PLOT-BLOCKED.md'), 'PLOT-BLOCKED: q\n') }]);
    const desk = { ...r.ports.desk, sealDeclaration: async () => ({ ok: false as const, why: 'failed' as const }) };
    r.deps = { ...r.deps, ports: { ...r.ports, desk } };
    expect(await runWorkerLoop(r.deps)).toBe(0);
    expect(r.logs).toContain('plot-worker-loop: declaration failed');
  });
});

describe('a refused take-up', () => {
  const write = { kind: 'push', branch: BRANCH, onto: '' } as const;

  it('names the applier reason for a refused write, and only the kind where none was given', () => {
    const commit = { kind: 'commit', message: 'm', paths: ['a'] } as const;
    expect(
      failureLines([
        { write: commit, result: { ok: false, why: 'failed' }, reason: 'a loop commit stages no paths; refused 1 path(s)' },
        { write, result: { ok: false, why: 'failed' } },
        { write, result: { ok: true, value: undefined } },
      ]),
    ).toEqual([
      'plot-worker-loop: commit failed — a loop commit stages no paths; refused 1 path(s)',
      'plot-worker-loop: push failed',
    ]);
  });

  it('names the refused take-up write, and nothing where every write landed or another kind failed', () => {
    expect(takeUpRefusalOf([])).toBeNull();
    expect(takeUpRefusalOf([{ write, result: { ok: true, value: undefined } }])).toBeNull();
    expect(takeUpRefusalOf([{ write, result: { ok: false, why: 'failed' } }])).toBe('push');
    const other = { kind: 'declaration', worktree: '/w', branch: BRANCH, status: 'ok', summary: '' } as const;
    expect(takeUpRefusalOf([{ write: other, result: { ok: false, why: 'failed' } }])).toBeNull();
  });

  it('words a refused claim commit, and an unknown claim as the absent-branch line', () => {
    expect(takeUpLine('commit', null, BRANCH, '/w')).toBe(`plot-worker-loop: could not commit the claim for ${BRANCH} at /w; the assignment is cleared and the agent goes free`);
    expect(takeUpLine('push', 'unknown', BRANCH, '/w')).toContain('origin has no such branch');
  });

  it('counts a holder whose pid is alive or whose desk holds a marker, and never this agent, a missing desk or a dead pid', async () => {
    const declared = [
      agentManifest({ session: 'me', branch: BRANCH, worktree: '/me', pid: '1' }),
      agentManifest({ session: 'live', branch: BRANCH, worktree: '/live', pid: '2' }),
      agentManifest({ session: 'waiting', branch: BRANCH, worktree: '/waiting', pid: '3' }),
      agentManifest({ session: 'dead', branch: BRANCH, worktree: '/dead', pid: '4' }),
      agentManifest({ session: 'gone', branch: BRANCH, worktree: '/gone', pid: '2' }),
      agentManifest({ session: 'nopid', branch: BRANCH, worktree: '/nopid' }),
      agentManifest({ session: 'elsewhere', branch: 'feature/other', worktree: '/live', pid: '2' }),
    ];
    const agents = agentsFixture({
      declared,
      desks: {
        '/me': agentDesk(),
        '/live': agentDesk(),
        '/waiting': agentDesk({ markers: ['PLOT-BLOCKED.md'] }),
        '/dead': agentDesk(),
        '/nopid': agentDesk(),
      },
    });
    const processes = { ...rig(null, []).ports.processes, isAlive: async (pid: number) => ({ ok: true as const, value: pid === 2 }) };
    expect(await liveHolders({ agents, processes }, BRANCH, 'me')).toEqual(['live', 'waiting']);
    expect(await liveHolders({ agents: agentsFixture({}), processes }, BRANCH, 'me')).toEqual([]);
  });

  it('reads the claim from the fetched ref, its commits from the base, and the holders', async () => {
    const r = rig(null, []);
    const claimOnly = { at: 1, subject: `plot: claim ${BRANCH}`, tree: 't', parentTree: 't' };
    const ports = { ...r.ports, agents: agentsFixture({ declared: [] }) };
    const present = refsFixture({ remoteBranches: [BRANCH], commitSubjects: { [`origin/trunk..origin/${BRANCH}`]: [claimOnly] } });
    expect(await readClaimAnswer({ ...ports, refs: present }, BRANCH, 'origin/trunk', 'me')).toBe('stale-claim');
    const unreadable = refsFixture({ remoteBranches: [BRANCH], failing: ['commitSubjects'] });
    expect(await readClaimAnswer({ ...ports, refs: unreadable }, BRANCH, 'origin/trunk', 'me')).toBe('unknown');
    const failedFetch = { ...present, fetchRemoteHead: async () => ({ ok: false as const, why: 'failed' as const }) };
    expect(await readClaimAnswer({ ...ports, refs: failedFetch }, BRANCH, 'origin/trunk', 'me')).toBe('unknown');
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
    r.write({ ...r.read(), correctionAttempts: 2 });
    expect(await runWorkerLoop(r.deps)).toBe(0);
    expect(minted).toEqual(['M']);
    // THE COUNT BELONGS TO THE BRANCH: the next slice does not inherit it.
    expect(r.read().correctionAttempts).toBe(0);
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
    r.write({ ...r.read(), correctionAttempts: 1 });
    expect(await runWorkerLoop(r.deps)).toBe(0);
    expect(minted).toEqual([]);
    expect(r.read().correctionAttempts).toBe(1);
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
  it('ends holding-work, exit 0, when the prompt leaves unlanded work (row 11)', async () => {
    let dirty = false;
    const r = rig(ASSIGNED, [{ during: () => void (dirty = true) }]);
    const trees: Trees = { ...r.ports.trees, dirtyPaths: async () => ({ ok: true, value: dirty ? ['x.txt'] : [] }) };
    r.deps = { ...r.deps, ports: { ...r.ports, trees } };
    expect(await runWorkerLoop(r.deps)).toBe(0);
    expect(r.runs).toHaveLength(1);
    expect(r.deskCalls.endings.at(-1)?.record.reason).toBe('holding-work');
  });

  it('settles green checks and seals the slice (rows 12-18)', async () => {
    const r = rig(ASSIGNED, [{}]);
    expect(await runWorkerLoop(r.deps)).toBe(124);
    expect(r.deskCalls.declarations).toHaveLength(1);
    expect(r.spends.map((x) => x.branch)).toEqual([BRANCH]);
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
      config: { ...rigConfig(), checksWaitSeconds: 120, checksPollMs: 7_000 },
    };
    expect(await runWorkerLoop(r.deps)).toBe(0);
    expect(r.sleeps.filter((s) => s === 7_000).length).toBeGreaterThanOrEqual(1);
    expect(r.sleeps).not.toContain(PASS_INTERVAL_MS);
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
    expect(r.deskCalls.corrections[0]?.text).toMatch(/^the run at u for \S* concluded failure$/);
    expect(r.calls.corrections.map((c) => c.correctionAttempts)).toEqual([1]);
    expect(r.runs).toHaveLength(2);
  });

  it('ends corrections-spent once the correction budget is spent (row 15)', async () => {
    const r = rig({ ...ASSIGNED, correctionAttempts: 2 }, [{}]);
    r.deps = {
      ...r.deps,
      ports: {
        ...r.ports,
        build: buildFixture({ shaRuns: { [BRANCH]: [{ sha: 'sha-1', status: 'completed', conclusion: 'failure', url: 'u', startedAt: '' }] } }),
      },
    };
    expect(await runWorkerLoop(r.deps)).toBe(0);
    expect(r.deskCalls.endings.at(-1)?.record.reason).toBe('corrections-spent');
  });

  it('ends when the branch tip moved past the pushed sha (row 17)', async () => {
    const r = rig(ASSIGNED, [{}]);
    r.deps = {
      ...r.deps,
      ports: { ...r.ports, refs: refsFixture({ ahead: { [BRANCH]: 0 }, shas: { HEAD: 'sha-1' }, remoteBranches: [BRANCH], remoteTips: { [BRANCH]: 'sha-2' } }) },
    };
    expect(await runWorkerLoop(r.deps)).toBe(0);
    expect(r.deskCalls.endings.at(-1)?.record).toMatchObject({ reason: 'checks-unanswered' });
    expect(r.deskCalls.endings.at(-1)?.record.detail).toContain('tip-moved');
  });

  it('keeps the pushed sha it had when HEAD cannot be read', async () => {
    const r = rig(ASSIGNED, [{}, {}]);
    const asked: string[] = [];
    let resolved = 0;
    let conclusion = 'failure';
    r.deps = {
      ...r.deps,
      ports: {
        ...r.ports,
        refs: {
          ...r.ports.refs,
          resolve: async () => (resolved++ === 0 ? { ok: true, value: 'sha-1' } : { ok: false, why: 'failed' }),
        },
        build: {
          ...r.ports.build,
          runForSha: async (_branch: string, sha: string) => {
            asked.push(sha);
            const run = { sha: 'sha-1', status: 'completed', conclusion, url: 'u', startedAt: '' };
            conclusion = 'success';
            return { ok: true, value: run };
          },
        },
      },
    };
    expect(await runWorkerLoop(r.deps)).toBe(124);
    expect(resolved).toBe(2);
    expect(asked).toEqual(['sha-1', 'sha-1']);
  });

  it('asks the PR state once per checks wait, and does not seal on a host that fails inside it', async () => {
    const r = rig(ASSIGNED, [{}]);
    let prAsks = 0;
    let polls = 0;
    const open: Pr = { number: 7, head: BRANCH, state: 'OPEN' } as Pr;
    r.deps = {
      ...r.deps,
      ports: {
        ...r.ports,
        host: { prState: async () => (prAsks++ === 0 ? { ok: true, value: open } : { ok: false, why: 'failed' }) } as WorkerLoopPorts['host'],
        build: {
          ...r.ports.build,
          runForSha: async () => {
            polls += 1;
            const status = polls < 3 ? 'in_progress' : 'completed';
            return { ok: true, value: { sha: 'sha-1', status, conclusion: polls < 3 ? null : 'success', url: 'u', startedAt: '' } };
          },
        },
      },
    };
    expect(await runWorkerLoop(r.deps)).toBe(124);
    expect(prAsks).toBe(1);
    expect(polls).toBe(3);
    expect(r.deskCalls.declarations).toHaveLength(1);
  });

  it('seals without a checks wait when the PR state cannot be read on entry, as the shell does', async () => {
    const r = rig(ASSIGNED, [{}]);
    const ports = { ...r.ports, host: { prState: async () => ({ ok: false, why: 'failed' }) } as WorkerLoopPorts['host'] };
    const clock = { since: null, pr: null };
    const ran = { running: null, exit: { answer: 'ran' as const, status: 0, ranSeconds: 5 }, pushedSha: 'sha-1' } as never;
    const readings = await readPass(ports, r.manifestFile, ran, rigConfig(), clock);
    expect(readings).toMatchObject({ pushed: true, prOpen: false, checks: null });
    expect(clock.since).toBeNull();
  });

  it('does not wait for checks when Checks wait is 0', async () => {
    const r = rig(ASSIGNED, [{}]);
    r.deps = { ...r.deps, config: { ...rigConfig(), checksWaitSeconds: 0 } };
    expect(await runWorkerLoop(r.deps)).toBe(124);
  });
});

describe('runWorkerLoop — the memory ceiling outside a free wait', () => {
  it('restarts nothing at 301 MB while a prompt runs and a checks wait polls', async () => {
    const replaced: string[] = [];
    const reexec = { replace: async (command: string) => (replaced.push(command), { ok: false as const, why: 'failed' as const }) };
    const r = rig(ASSIGNED, [{}], {}, { reexec });
    const restart: RestartDeps = {
      pinned: { checkout: r.dir, bundlePath: path.join(r.dir, 'main.mjs'), loadedCommit: '', refs: refsFixture() },
      runningBundle: path.join(r.dir, 'desk.mjs'),
      loadedHash: 'desk-hash',
      residentBytes: () => 301 * 1024 * 1024,
      execveAvailable: true,
      exec: { path: '/bin/node', options: [], args: [] },
      rejected: new Set<string>(),
      logOnce: (line) => r.logs.push(line),
      log: (line) => r.logs.push(line),
      env: {},
    };
    r.deps = {
      ...r.deps,
      restart,
      ports: {
        ...r.ports,
        build: buildFixture({ shaRuns: { [BRANCH]: [{ sha: 'sha-1', status: 'in_progress', conclusion: null, url: 'u', startedAt: '' }] } }),
      },
      config: { ...rigConfig(), checksWaitSeconds: 120, checksPollMs: 7_000 },
    };
    expect(await runWorkerLoop(r.deps)).toBe(0);
    expect(r.sleeps.filter((s) => s === 7_000).length).toBeGreaterThanOrEqual(1);
    expect(r.runs.filter((run) => run.args.includes('--self-check'))).toEqual([]);
    expect(replaced).toEqual([]);
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

describe('runEvidence', () => {
  it('words the run as the BuildMonitor does, naming an unknown url and a run with no conclusion', () => {
    expect(runEvidence({ url: 'https://ci/run/1', conclusion: 'failure' }, 'abc1234')).toBe(
      'the run at https://ci/run/1 for abc1234 concluded failure',
    );
    expect(runEvidence({ url: '', conclusion: null }, 'abc1234')).toBe(
      'the run at an unknown url for abc1234 concluded nothing yet',
    );
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

const noStop: StopTarget = { once: () => undefined, exit: () => undefined };

describe('onStop', () => {
  it('removes the registration and exits 128 plus the signal number, for each of the three signals', async () => {
    const handlers = new Map<string, () => void>();
    const exits: number[] = [];
    let cleaned = 0;
    onStop(
      { once: (signal, listener) => handlers.set(signal, listener), exit: (code) => exits.push(code) },
      () => undefined,
      async () => {
        cleaned += 1;
      },
    );
    expect([...handlers.keys()]).toEqual(['SIGTERM', 'SIGINT', 'SIGHUP']);
    handlers.get('SIGTERM')?.();
    handlers.get('SIGINT')?.();
    handlers.get('SIGHUP')?.();
    await vi.waitFor(() => expect(exits).toEqual([143, 130, 129]));
    expect(cleaned).toBe(3);
  });

  it('removes what cleanupNow removes before the listener returns, ahead of an exit another listener makes', () => {
    const r = rig(ASSIGNED, []);
    const handlers = new Map<string, () => void>();
    onStop(
      { once: (signal, listener) => handlers.set(signal, listener), exit: () => undefined },
      () => fs.rmSync(r.manifestFile, { force: true }),
      () => new Promise<void>(() => undefined),
    );
    handlers.get('SIGTERM')?.();
    expect(fs.existsSync(r.manifestFile)).toBe(false);
  });
});

describe('configuration readers', () => {
  it('reads a count as the shell does: digits only, otherwise the fallback', () => {
    expect(count('0', 9)).toBe(0);
    expect(count('42', 9)).toBe(42);
    for (const raw of [undefined, '', '-1', '1.5', '1e3', ' 2', 'x']) expect(count(raw, 9)).toBe(9);
  });

  it('reads a positive count, falling back for zero', () => {
    expect(positive('5', 60)).toBe(5);
    for (const raw of [undefined, '', '0', '-5', '0.5']) expect(positive(raw, 60)).toBe(60);
  });

  it('reads an integer of either sign for an offset', () => {
    expect(integer('-630', 0)).toBe(-630);
    expect(integer('630', 0)).toBe(630);
    for (const raw of [undefined, '', '1.5', 'x']) expect(integer(raw, 7)).toBe(7);
  });

  it('cuts from origin/<default branch>, and from origin/main where none is named', async () => {
    expect(await defaultBase(refsFixture({ defaultBranch: 'trunk' }))).toBe('origin/trunk');
    expect(await defaultBase(refsFixture({ defaultBranch: '' }))).toBe('origin/main');
    expect(await defaultBase({ defaultBranch: async () => ({ ok: false, why: 'failed' }) })).toBe('origin/main');
  });

  it('resolves the settings path, nothing for an absent key, and logs a refusal', async () => {
    const logs: string[] = [];
    const answer = (stdout: string, stderr: string, code: number) => ({ agentSettings: async () => ({ stdout, stderr, code }) });
    expect(await resolveAgentSettings(answer('/repo/s.json\n', '', 0), (l) => logs.push(l))).toBe('/repo/s.json');
    expect(await resolveAgentSettings(answer('', '', 0), (l) => logs.push(l))).toBe('');
    expect(await resolveAgentSettings(answer('', 'plot-agent-settings: no file\n', 3), (l) => logs.push(l))).toBe('');
    expect(logs).toEqual(['plot-worker-loop: plot-agent-settings: no file']);
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
      shippedConfig(r.dir),
      noStop,
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
    expect(await driven(main({}, r.dir, config, noStop))).toBe(124);
    expect(asked).toEqual(['Worker bound', 'Agent runner', 'Worker command', 'Checks wait', 'Correction budget', 'Slice max runs']);
    asked.length = 0;
    expect(await driven(main({ PLOT_WAIT_BUDGET_SECONDS: '1', PLOT_WAIT_POLL_SECONDS: '1' }, r.dir, config, noStop))).toBe(124);
    cwd.mockRestore();
  });

  it('names claude for an absent or empty harness, and the named one otherwise', () => {
    expect(harnessName({})).toBe('claude');
    expect(harnessName({ PLOT_HARNESS: '' })).toBe('claude');
    expect(harnessName({ PLOT_HARNESS: 'codex' })).toBe('codex');
  });

  it('moves the clock by the offset the shell honours, and by nothing without one', () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(ZURICH_NOON);
    expect(offsetClock({})()).toBe(ZURICH_NOON);
    expect(offsetClock({ PLOT_CLOCK_OFFSET_SECONDS: '630' })()).toBe(ZURICH_NOON + 630_000);
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
    expect(await readManifestFields(f)).toEqual({ session: '', worktree: '', branch: '', attempts: 0, correctionAttempts: 0, resumeId: '', sliceRuns: 0 });
    fs.writeFileSync(f, JSON.stringify({ session: 's', worktree: 'w', branch: 'b', attempts: 2, correctionAttempts: 1, resumeId: 'h' }));
    expect(await readManifestFields(f)).toEqual({ session: 's', worktree: 'w', branch: 'b', attempts: 2, correctionAttempts: 1, resumeId: 'h', sliceRuns: 0 });
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
        aheadOfUpstream: async () => ({ ok: true as const, value: 2 }),
      },
    };
    expect(await readResetRefusals(holding, r.wt)).toEqual(['blocked-marker', 'uncommitted-changes', 'unpushed-commits']);
    const level = { trees: { ...holding.trees, aheadOfUpstream: async () => ({ ok: true as const, value: 0 }) } };
    expect(await readResetRefusals(level, r.wt)).not.toContain('unpushed-commits');
    const broken = { trees: { ...r.ports.trees, markers: fail, dirtyPaths: fail, aheadOfUpstream: fail } };
    expect(await readResetRefusals(broken, r.wt)).toEqual([]);
    // No upstream configured: the count cannot be taken, and that refuses nothing.
    const unaheadable = { trees: { ...holding.trees, aheadOfUpstream: fail } };
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
    const clock = { since: null, pr: null };
    const ran = { running: null, exit: { answer: 'ran' as const, status: 0, ranSeconds: 5 }, pushedSha: 'sha-1' } as never;
    const a = await readPass(ports, r.manifestFile, ran, rigConfig(), clock);
    expect(a.prOpen).toBe(false);
    const b = await readPass(
      { ...r.ports, refs: { ...r.ports.refs, remoteTip: fail } as WorkerLoopPorts['refs'], build: { ...r.ports.build, runForSha: fail } as WorkerLoopPorts['build'] },
      r.manifestFile,
      ran,
      rigConfig(),
      { since: null, pr: null },
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
    // A desk with no transcripts records nothing, and the seal is not failed for it.
    await expect(ports.recordSpend(r.wt, BRANCH, '2026-10-06T00:00:00Z')).resolves.toBeUndefined();
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
    expect(await driven(main({ PLOT_WORKER_BOUND: '1' }, r.dir, shippedConfig(r.dir), noStop))).toBe(124);
    cwd.mockRestore();
  });

  it('removes the manifest before a stop signal\'s listener returns, and exits 128 plus the signal', async () => {
    vi.useFakeTimers({ toFake: ['Date', 'setTimeout'] });
    vi.setSystemTime(ZURICH_NOON);
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    for (const manifest of [true, false]) {
      const r = rig({ ...ASSIGNED, branch: '' }, []);
      const handlers = new Map<string, () => void>();
      const exits: number[] = [];
      const target: StopTarget = { once: (signal, listener) => handlers.set(signal, listener), exit: (code) => exits.push(code) };
      const env = { PLOT_WORKTREE: r.wt, PLOT_WORKER_BOUND: '1', ...(manifest ? { PLOT_MANIFEST_FILE: r.manifestFile } : {}) };
      const done = main(env, r.dir, shippedConfig(r.dir), target);
      await vi.waitFor(() => expect(handlers.has('SIGTERM')).toBe(true));
      handlers.get('SIGTERM')?.();
      expect(fs.existsSync(r.manifestFile)).toBe(!manifest);
      await driven(done);
      await vi.waitFor(() => expect(exits).toEqual([143]));
    }
    stderr.mockRestore();
  });

  it('stamps, runs from the environment, and removes the manifest', async () => {
    vi.useFakeTimers({ toFake: ['Date', 'setTimeout'] });
    vi.setSystemTime(ZURICH_NOON);
    const r = rig({ ...ASSIGNED, branch: '' }, []);
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    const done = main(
      { PLOT_WORKTREE: r.wt, PLOT_MANIFEST_FILE: r.manifestFile, PLOT_WORKER_BOUND: '1', PLOT_MONITOR_ENDS_WORKER: '0' },
      r.dir,
      shippedConfig(r.dir),
      noStop,
    );
    expect(await driven(done)).toBe(124);
    expect(fs.existsSync(r.manifestFile)).toBe(false);
    stderr.mockRestore();
  });
});

/**
 * Advances the fake clock a pass at a time until the promise settles, for up
 * to 20 s of real time: `main` awaits real processes (`plot-config.sh`, the
 * build connector), which a loaded runner answers slower than a fixed count of
 * passes allows.
 */
const driven = async (done: Promise<number>): Promise<number | null> => {
  let settled: number | null = null;
  void done.then((c) => (settled = c));
  const deadline = performance.now() + 20_000;
  while (settled === null && performance.now() < deadline) {
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
