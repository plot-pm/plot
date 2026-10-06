// The worker loop's self-restart: `pinMainCheckout`, `mainCheckoutReading`,
// `checkRestart`, `restartDeps`, the two call sites in `runWorkerLoop`, and
// `main`'s composition. The main checkout is a real repository, so `refsGit`
// answers the hashes and the ancestry; `boundedRun` and `reexec` are scripted.
// The restart of a real process is `test/worker-loop-restart.test.mjs`.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { rmTree } from '../helpers.mjs';
import {
  agentsFixture,
  buildFixture,
  deskFixture,
  hostFixture,
  refsFixture,
  transcriptFixture,
  treesFixture,
} from '@plot-pm/domain/adapters';
import type { BoundedRun, BoundedRunResult, PortResult, Pr, Refs, Trees } from '@plot-pm/domain';
import type { Reexec } from '@plot-pm/domain/ports/reexec';
import { MEMORY_CEILING_BYTES } from '@plot-pm/domain/rules/loop-restart';
import {
  BUNDLE_RELATIVE_PATH,
  checkRestart,
  main,
  mainCheckoutReading,
  pinMainCheckout,
  restartDeps,
  runWorkerLoop,
  shippedConfig,
  type LoopDeps,
  type PinnedCheckout,
  type RestartDeps,
  type RestartPlatform,
  type StopTarget,
  type WorkerLoopPorts,
} from '../../src/server/entry/worker-loop.js';

const temps: string[] = [];
afterEach(() => {
  for (const d of temps.splice(0)) rmTree(d);
});

const tempDir = (prefix: string): string => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  temps.push(dir);
  return dir;
};

const git = (cwd: string, ...args: string[]): string => execFileSync('git', args, { cwd }).toString().trim();

/** A main checkout on `main` with a committed bundle, and an `origin` whose `HEAD` names `main`. */
const mainCheckout = (bundle = 'console.log(1);\n') => {
  const dir = tempDir('plot-restart-main-');
  git(dir, 'init', '--quiet', '-b', 'main');
  git(dir, 'config', 'user.email', 't@t.example');
  git(dir, 'config', 'user.name', 't');
  const commit = (content: string): string => {
    const file = path.join(dir, BUNDLE_RELATIVE_PATH);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, content);
    git(dir, 'add', '-A');
    git(dir, 'commit', '--quiet', '-m', content.trim());
    return git(dir, 'rev-parse', 'HEAD');
  };
  commit(bundle);
  const remote = tempDir('plot-restart-origin-');
  git(remote, 'init', '--quiet', '--bare', '-b', 'main');
  git(dir, 'remote', 'add', 'origin', remote);
  git(dir, 'push', '--quiet', 'origin', 'main');
  git(dir, 'remote', 'set-head', 'origin', 'main');
  const bundlePath = path.join(dir, BUNDLE_RELATIVE_PATH);
  const hash = (): string => git(dir, 'hash-object', BUNDLE_RELATIVE_PATH);
  return { dir, bundlePath, commit, hash };
};

const treesOn = (dir: string, over: { branch?: string; dirty?: readonly string[] } = {}): Trees =>
  treesFixture({
    worktrees: [{ path: dir, branch: over.branch ?? 'main', isMain: true }],
    dirty: { [dir]: over.dirty ?? [] },
  }) as Trees;

const pin = async (dir: string): Promise<PinnedCheckout> => {
  const pinned = await pinMainCheckout(treesOn(dir), '/unused');
  if (pinned === null) throw new Error('no main checkout pinned');
  return pinned;
};

interface SelfChecks {
  boundedRun: BoundedRun;
  runs: { command: string; args: readonly string[] }[];
}

const selfChecks = (answer: PortResult<BoundedRunResult> = { ok: true, value: { status: 0, timedOut: false, ranSeconds: 1 } }): SelfChecks => {
  const runs: SelfChecks['runs'] = [];
  return {
    runs,
    boundedRun: {
      run: async (command, args, options) => {
        runs.push({ command, args });
        fs.writeFileSync(options.outFile, '');
        return answer;
      },
    },
  };
};

interface Replaces {
  reexec: Reexec;
  calls: { command: string; args: readonly string[]; env: NodeJS.ProcessEnv }[];
}

const replaces = (answer: PortResult<never> = { ok: false, why: 'failed' }): Replaces => {
  const calls: Replaces['calls'] = [];
  return {
    calls,
    reexec: {
      replace: async (command, args, env) => {
        calls.push({ command, args, env });
        return answer;
      },
    },
  };
};

const RUNNING = '/desk/skills/plot/scripts/board/plot-worker-loop.mjs';

const restartOf = (pinned: PinnedCheckout, over: Partial<RestartDeps> = {}): RestartDeps & { lines: string[] } => {
  const lines: string[] = [];
  return {
    pinned,
    runningBundle: RUNNING,
    loadedHash: 'desk-hash',
    residentBytes: () => 60 * 1024 * 1024,
    execveAvailable: true,
    exec: { path: '/bin/node', options: ['--no-warnings'], args: ['--flag'] },
    rejected: new Set<string>(),
    logOnce: (line) => lines.push(`once: ${line}`),
    log: (line) => lines.push(line),
    env: { KEEP: '1' },
    ...over,
    lines,
  };
};

const failing = <T>(): Promise<PortResult<T>> => Promise.resolve({ ok: false, why: 'failed' });

describe('pinMainCheckout', () => {
  it('pins the entry the listing marks as main, its bundle path, and its HEAD', async () => {
    const m = mainCheckout();
    const pinned = await pin(m.dir);
    expect(pinned.checkout).toBe(m.dir);
    expect(pinned.bundlePath).toBe(m.bundlePath);
    expect(pinned.loadedCommit).toBe(git(m.dir, 'rev-parse', 'HEAD'));
  });

  it('records no loaded commit where HEAD cannot be resolved', async () => {
    const dir = tempDir('plot-restart-norepo-');
    const pinned = await pinMainCheckout(treesOn(dir), '/unused');
    expect(pinned?.loadedCommit).toBe('');
  });

  it('pins nothing where the listing fails or names no main checkout', async () => {
    expect(await pinMainCheckout({ ...treesFixture(), list: failing } as Trees, '/unused')).toBeNull();
    const elsewhere = treesFixture({ worktrees: [{ path: '/desk', branch: 'x', isMain: false }] }) as Trees;
    expect(await pinMainCheckout(elsewhere, '/unused')).toBeNull();
  });
});

describe('mainCheckoutReading', () => {
  it('reads a clean default-branch checkout, its bundle hash, and HEAD containing the loaded commit', async () => {
    const m = mainCheckout();
    const pinned = await pin(m.dir);
    m.commit('console.log(2);\n');
    expect(await mainCheckoutReading(treesOn(m.dir), pinned, 'later')).toEqual({
      onDefaultBranch: true,
      bundlePathsClean: true,
      headContainsLoaded: 'yes',
      pinnedHash: m.hash(),
    });
  });

  it('reads a dirty path under the bundle directory as unclean, and one elsewhere as clean', async () => {
    const m = mainCheckout();
    const pinned = await pin(m.dir);
    const dirty = await mainCheckoutReading(treesOn(m.dir, { dirty: ['skills/plot/scripts/board/board-server.mjs'] }), pinned, 'first');
    expect(dirty.bundlePathsClean).toBe(false);
    const elsewhere = await mainCheckoutReading(treesOn(m.dir, { dirty: ['docs/notes.md', 'fix_files.py'] }), pinned, 'first');
    expect(elsewhere.bundlePathsClean).toBe(true);
  });

  it('reads a checkout on another branch as off the default branch', async () => {
    const m = mainCheckout();
    const pinned = await pin(m.dir);
    expect((await mainCheckoutReading(treesOn(m.dir, { branch: 'feature/x' }), pinned, 'first')).onDefaultBranch).toBe(false);
  });

  it('reads a checkout that moved backwards as not containing the loaded commit', async () => {
    const m = mainCheckout();
    m.commit('console.log(2);\n');
    const pinned = await pin(m.dir);
    git(m.dir, 'reset', '--quiet', '--hard', 'HEAD~1');
    expect((await mainCheckoutReading(treesOn(m.dir), pinned, 'later')).headContainsLoaded).toBe('no');
  });

  it('asks no ancestry on the first check', async () => {
    const m = mainCheckout();
    const pinned = await pin(m.dir);
    expect((await mainCheckoutReading(treesOn(m.dir), pinned, 'first')).headContainsLoaded).toBe('unknown');
  });

  it('reads every unanswerable port as the side that blocks a restart', async () => {
    const refs = { ...refsFixture(), defaultBranch: failing, resolve: failing, hashFilesSync: () => ({ ok: false, why: 'failed' }) } as unknown as Refs;
    const trees = { ...treesFixture(), list: failing, dirtyPaths: failing } as Trees;
    const pinned: PinnedCheckout = { checkout: '/main', bundlePath: '/main/b.mjs', loadedCommit: 'abc', refs };
    expect(await mainCheckoutReading(trees, pinned, 'later')).toEqual({
      onDefaultBranch: false,
      bundlePathsClean: false,
      headContainsLoaded: 'unknown',
      pinnedHash: '',
    });
  });

  it('reads an empty default branch, an unpinned commit and a failed ancestry as blocking', async () => {
    const answered = <T>(value: T) => async (): Promise<PortResult<T>> => ({ ok: true, value });
    const refs = { ...refsFixture(), defaultBranch: answered(''), resolve: answered('head'), contains: failing } as unknown as Refs;
    const pinned: PinnedCheckout = { checkout: '/main', bundlePath: '/main/b.mjs', loadedCommit: 'abc', refs };
    const trees = treesFixture({ worktrees: [{ path: '/other', branch: '', isMain: true }] }) as Trees;
    const reading = await mainCheckoutReading(trees, pinned, 'later');
    expect(reading.onDefaultBranch).toBe(false);
    expect(reading.headContainsLoaded).toBe('unknown');
    expect((await mainCheckoutReading(trees, { ...pinned, loadedCommit: '' }, 'later')).headContainsLoaded).toBe('unknown');
  });
});

describe('checkRestart — a restart onto the main checkout', () => {
  it('runs the new bundle’s --self-check, then replaces the process with the wait start carried (failure 5)', async () => {
    const m = mainCheckout();
    const pinned = await pin(m.dir);
    const deps = restartOf(pinned, { loadedHash: m.hash() });
    m.commit('console.log(2);\n');
    const checks = selfChecks();
    const r = replaces();
    await checkRestart({ trees: treesOn(m.dir), boundedRun: checks.boundedRun, reexec: r.reexec }, deps, 'later', 1_000);
    expect(checks.runs).toEqual([{ command: '/bin/node', args: [m.bundlePath, '--self-check'] }]);
    expect(r.calls).toEqual([
      { command: '/bin/node', args: ['/bin/node', '--no-warnings', m.bundlePath, '--flag'], env: { KEEP: '1', PLOT_WAIT_STARTED: '1000' } },
    ]);
    expect(deps.lines[0]).toContain(`restarting on ${m.bundlePath}`);
  });

  it('moves a loop started from a desk’s bundle to the main checkout’s before the first pass', async () => {
    const m = mainCheckout();
    const deps = restartOf(await pin(m.dir));
    const r = replaces();
    await checkRestart({ trees: treesOn(m.dir), boundedRun: selfChecks().boundedRun, reexec: r.reexec }, deps, 'first', null);
    expect(r.calls[0]?.args[2]).toBe(m.bundlePath);
    expect(r.calls[0]?.env.PLOT_WAIT_STARTED).toBe('');
  });

  it('logs a replace that returned and stays', async () => {
    const m = mainCheckout();
    const deps = restartOf(await pin(m.dir));
    await checkRestart({ trees: treesOn(m.dir), boundedRun: selfChecks().boundedRun, reexec: replaces().reexec }, deps, 'first', null);
    expect(deps.lines).toContain('once: plot-worker-loop: the restart did not happen (failed); staying on the running bundle');
    const quiet = restartOf(deps.pinned);
    const answered = replaces({ ok: true, value: undefined as never });
    await checkRestart({ trees: treesOn(m.dir), boundedRun: selfChecks().boundedRun, reexec: answered.reexec }, quiet, 'first', null);
    expect(quiet.lines.filter((l) => l.startsWith('once:'))).toEqual([]);
  });
});

describe('checkRestart — no restart', () => {
  const noRestart = async (trees: Trees, deps: RestartDeps, wait: number | null = 1_000) => {
    const checks = selfChecks();
    const r = replaces();
    await checkRestart({ trees, boundedRun: checks.boundedRun, reexec: r.reexec }, deps, 'later', wait);
    expect(checks.runs).toEqual([]);
    expect(r.calls).toEqual([]);
  };

  it('stays when the main checkout moved backwards', async () => {
    const m = mainCheckout();
    m.commit('console.log(2);\n');
    const pinned = await pin(m.dir);
    const deps = restartOf(pinned, { loadedHash: m.hash() });
    git(m.dir, 'reset', '--quiet', '--hard', 'HEAD~1');
    await noRestart(treesOn(m.dir), deps);
  });

  it('stays when a bundle path is modified', async () => {
    const m = mainCheckout();
    const pinned = await pin(m.dir);
    const deps = restartOf(pinned, { loadedHash: m.hash() });
    m.commit('console.log(2);\n');
    await noRestart(treesOn(m.dir, { dirty: [BUNDLE_RELATIVE_PATH] }), deps);
  });

  it('stays when the main checkout is on another branch', async () => {
    const m = mainCheckout();
    const pinned = await pin(m.dir);
    const deps = restartOf(pinned, { loadedHash: m.hash() });
    m.commit('console.log(2);\n');
    await noRestart(treesOn(m.dir, { branch: 'feature/x' }), deps);
  });

  it('stays on an identical rebuild with a newer mtime', async () => {
    const m = mainCheckout();
    const pinned = await pin(m.dir);
    const deps = restartOf(pinned, { loadedHash: m.hash() });
    const bytes = fs.readFileSync(m.bundlePath);
    fs.writeFileSync(m.bundlePath, bytes);
    const later = new Date(Date.now() + 60_000);
    fs.utimesSync(m.bundlePath, later, later);
    await noRestart(treesOn(m.dir), deps);
  });

  it('stays outside a free wait at 301 MB with a newer bundle', async () => {
    const m = mainCheckout();
    const pinned = await pin(m.dir);
    const deps = restartOf(pinned, { residentBytes: () => 301 * 1024 * 1024 });
    m.commit('console.log(2);\n');
    await noRestart(treesOn(m.dir), deps, null);
  });

  it('logs the missing process.execve through logOnce and stays', async () => {
    const m = mainCheckout();
    const deps = restartOf(await pin(m.dir), { execveAvailable: false });
    m.commit('console.log(2);\n');
    await noRestart(treesOn(m.dir), deps);
    expect(deps.lines).toEqual(['once: plot-worker-loop: process.execve is not available on this Node, so the loop cannot restart itself']);
  });
});

describe('checkRestart — a candidate that fails its --self-check', () => {
  const cases: [string, PortResult<BoundedRunResult>, string][] = [
    ['exits 1', { ok: true, value: { status: 1, timedOut: false, ranSeconds: 1 } }, 'exited 1'],
    ['runs past the bound', { ok: true, value: { status: 124, timedOut: true, ranSeconds: 10 } }, 'ran past 10s'],
    ['cannot run', { ok: false, why: 'unaskable' }, 'could not run (unaskable)'],
  ];
  for (const [name, answer, reason] of cases) {
    it(`stays, logs once and checks the candidate once when it ${name}`, async () => {
      const m = mainCheckout();
      const deps = restartOf(await pin(m.dir));
      const checks = selfChecks(answer);
      const r = replaces();
      const ports = { trees: treesOn(m.dir), boundedRun: checks.boundedRun, reexec: r.reexec };
      await checkRestart(ports, deps, 'first', null);
      await checkRestart(ports, deps, 'later', 1_000);
      await checkRestart(ports, deps, 'later', 1_000);
      expect(r.calls).toEqual([]);
      expect(checks.runs).toHaveLength(1);
      expect(deps.lines).toEqual([`plot-worker-loop: ${m.bundlePath} failed its --self-check (${reason}); staying on the running bundle`]);
    });
  }
});

describe('checkRestart — the memory ceiling', () => {
  it('restarts on the running bundle in a free wait past the ceiling, with no newer bundle', async () => {
    const m = mainCheckout();
    const pinned = await pin(m.dir);
    const deps = restartOf(pinned, { loadedHash: m.hash(), residentBytes: () => MEMORY_CEILING_BYTES + 1 });
    const checks = selfChecks();
    const r = replaces();
    await checkRestart({ trees: treesOn(m.dir), boundedRun: checks.boundedRun, reexec: r.reexec }, deps, 'later', 5_000);
    expect(checks.runs[0]?.args[0]).toBe(RUNNING);
    expect(r.calls[0]?.args[2]).toBe(RUNNING);
    expect(r.calls[0]?.env.PLOT_WAIT_STARTED).toBe('5000');
  });
});

describe('restartDeps', () => {
  const platform = (over: Partial<RestartPlatform> = {}): RestartPlatform => ({
    execPath: '/bin/node',
    execArgv: ['--no-warnings'],
    argv: ['/bin/node', '/desk/b.mjs', '--flag'],
    memoryUsage: () => ({ rss: 42 }),
    ...over,
  });

  it('pins the main checkout and hashes the running bundle under scriptDir', async () => {
    const m = mainCheckout();
    const lines: string[] = [];
    const deps = await restartDeps(treesOn(m.dir), path.join(m.dir, 'skills', 'plot', 'scripts'), { A: '1' }, (l) => lines.push(l), platform({ execve: () => undefined }));
    expect(deps?.pinned.checkout).toBe(m.dir);
    expect(deps?.runningBundle).toBe(m.bundlePath);
    expect(deps?.loadedHash).toBe(m.hash());
    expect(deps?.residentBytes()).toBe(42);
    expect(deps?.execveAvailable).toBe(true);
    expect(deps?.exec).toEqual({ path: '/bin/node', options: ['--no-warnings'], args: ['--flag'] });
    expect(deps?.env).toEqual({ A: '1' });
    deps?.logOnce('gap');
    deps?.logOnce('gap');
    deps?.log('line');
    expect(lines).toEqual(['gap', 'line']);
  });

  it('reads a Node without process.execve', async () => {
    const m = mainCheckout();
    const deps = await restartDeps(treesOn(m.dir), path.join(m.dir, 'skills', 'plot', 'scripts'), {}, () => undefined, platform());
    expect(deps?.execveAvailable).toBe(false);
  });

  it('answers undefined where no main checkout is pinned or the running bundle is absent', async () => {
    const m = mainCheckout();
    expect(await restartDeps({ ...treesFixture(), list: failing } as Trees, '/unused', {}, () => undefined, platform())).toBeUndefined();
    expect(await restartDeps(treesOn(m.dir), path.join(m.dir, 'nowhere'), {}, () => undefined, platform())).toBeUndefined();
  });

  it('reads the running process by default', async () => {
    const m = mainCheckout();
    const deps = await restartDeps(treesOn(m.dir), path.join(m.dir, 'skills', 'plot', 'scripts'), {}, () => undefined);
    expect(deps?.exec.path).toBe(process.execPath);
  });
});

const loopPorts = (trees: Trees, boundedRun: BoundedRun, reexec: Reexec): WorkerLoopPorts => ({
  trees,
  agents: agentsFixture(),
  desk: deskFixture(),
  refs: refsFixture(),
  processes: {
    isAlive: async () => ({ ok: true, value: true }),
    workerState: async () => ({ ok: false, why: 'failed' }),
    startedAt: async () => ({ ok: false, why: 'failed' }),
    uptimeSeconds: async () => ({ ok: true, value: null }),
    childrenOf: async () => ({ ok: true, value: [] }),
    activity: async () => ({ ok: true, value: 'idle' }),
  },
  boundedRun,
  build: buildFixture(),
  host: hostFixture({ prs: [] as Pr[] }),
  transcriptQuietSeconds: async () => 5000,
  recordSpend: async () => undefined,
  reexec,
});

/** A hand-started free loop: no manifest, a 60 s wait bound, a 10 s pass interval. */
const freeLoop = (dir: string, ports: WorkerLoopPorts, over: Partial<LoopDeps> = {}): LoopDeps => ({
  ports,
  idle: { selfPid: 1, windowSeconds: 900, intervalMs: 1_000_000, transcript: transcriptFixture() },
  manifestFile: '',
  repoRoot: dir,
  worktree: dir,
  agent: '',
  harness: 'claude',
  config: { boundSeconds: 28_800, waitBudgetSeconds: 60, passIntervalMs: 10_000, checksPollMs: 10_000, maxStartRetries: 3, checksWaitSeconds: 1_800, correctionBudget: 2, sliceMaxRuns: 12, base: 'origin/main' },
  limitMarginSeconds: 60,
  monitorEndsWorker: true,
  outFile: path.join(dir, 'out.txt'),
  sessionId: '',
  now: () => Date.now(),
  sleep: async (ms) => {
    vi.setSystemTime(Date.now() + ms);
  },
  log: () => undefined,
  ...over,
});

describe('runWorkerLoop — the restart check', () => {
  const T0 = Date.parse('2026-10-06T10:00:00Z');
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(T0);
  });
  afterEach(() => vi.useRealTimers());

  it('checks before the first pass with no wait, and between free passes with the wait’s start', async () => {
    const m = mainCheckout();
    const r = replaces();
    const restart = restartOf(await pin(m.dir));
    const code = await runWorkerLoop(freeLoop(m.dir, loopPorts(treesOn(m.dir), selfChecks().boundedRun, r.reexec), { restart }));
    expect(code).toBe(124);
    expect(r.calls[0]?.env.PLOT_WAIT_STARTED).toBe('');
    expect(r.calls.slice(1).map((c) => c.env.PLOT_WAIT_STARTED)).toEqual(r.calls.slice(1).map(() => String(T0)));
    expect(r.calls.length).toBeGreaterThan(2);
  });

  it('ends a restarted free wait at its original start plus the bound', async () => {
    const m = mainCheckout();
    const pinned = await pin(m.dir);
    const r = replaces();
    const restart = restartOf(pinned, { loadedHash: m.hash() });
    const started = T0 - 50_000;
    const code = await runWorkerLoop(freeLoop(m.dir, loopPorts(treesOn(m.dir), selfChecks().boundedRun, r.reexec), { restart, waitStartedAt: started }));
    expect(code).toBe(124);
    expect(Date.now() - started).toBeGreaterThanOrEqual(60_000);
    expect(Date.now() - started).toBeLessThan(70_000);
    expect(r.calls).toEqual([]);
  });

  it('carries the restarted wait’s start into the next restart', async () => {
    const m = mainCheckout();
    const r = replaces();
    const restart = restartOf(await pin(m.dir));
    const started = T0 - 50_000;
    await runWorkerLoop(freeLoop(m.dir, loopPorts(treesOn(m.dir), selfChecks().boundedRun, r.reexec), { restart, waitStartedAt: started }));
    expect(new Set(r.calls.map((c) => c.env.PLOT_WAIT_STARTED))).toEqual(new Set([String(started)]));
  });
});

describe('main — the restart composition', () => {
  const noStop: StopTarget = { once: () => undefined, exit: () => undefined };

  const run = async (dir: string, waitStarted: string | undefined): Promise<string[]> => {
    const lines: string[] = [];
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation((chunk: unknown) => {
      lines.push(String(chunk));
      return true;
    });
    try {
      const code = await main(
        {
          PLOT_WORKTREE: dir,
          PLOT_MANIFEST_FILE: path.join(dir, 'gone.json'),
          PLOT_WORKER_BOUND: '1',
          PLOT_WAIT_BUDGET_SECONDS: '1',
          PLOT_WAIT_POLL_SECONDS: '1',
          PLOT_AGENT: '',
          ...(waitStarted === undefined ? {} : { PLOT_WAIT_STARTED: waitStarted }),
        },
        path.join(dir, 'skills', 'plot', 'scripts'),
        shippedConfig(dir),
        noStop,
      );
      expect(code).toBe(124);
    } finally {
      stderr.mockRestore();
    }
    return lines;
  };

  it('says nothing about a restart on a first start', async () => {
    const m = mainCheckout();
    expect((await run(m.dir, undefined)).join('')).not.toContain('restarted as pid');
  });

  it('names its pid and the carried wait after a restart', async () => {
    const m = mainCheckout();
    const carried = (await run(m.dir, String(Date.parse('2026-10-06T09:00:00Z')))).join('');
    expect(carried).toContain(`restarted as pid ${process.pid} on ${m.bundlePath}, keeping the free wait from 2026-10-06T09:00:00.000Z`);
    expect((await run(m.dir, '')).join('')).toContain(`restarted as pid ${process.pid} on ${m.bundlePath}, keeping no free wait`);
  });
});
