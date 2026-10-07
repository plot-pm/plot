// The worker loop's self-restart: `pinMainCheckout`, `mainCheckoutReading`,
// `checkRestart`, `restartDeps`, `selfCheck`, the two call sites in
// `runWorkerLoop`, and `main`'s composition. The main checkout is a real
// repository read through `treesGit` and `refsGit`, with the real
// `build.mjs`, so the desk-dirt filter applies as it does on `main`;
// `boundedRun` and `reexec` are scripted. The restart of a real process is
// `test/worker-loop-restart.test.mjs`.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { rmTree } from '../helpers.mjs';
import {
  agentsFixture,
  buildFixture,
  deskFixture,
  hostFixture,
  refsFixture,
  transcriptFixture,
  treesFixture,
  treesGit,
  refusedSlicesFixture,
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
  selfCheck,
  shippedConfig,
  type LoopDeps,
  type PinnedCheckout,
  type RestartDeps,
  type RestartPlatform,
  type StopTarget,
  type WorkerLoopPorts,
} from '../../src/server/entry/worker-loop.js';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');
const SCRIPTS = path.join(REPO, 'skills', 'plot', 'scripts');

const temps: string[] = [];
afterEach(() => {
  for (const d of temps.splice(0)) rmTree(d);
});

const tempDir = (prefix: string): string => {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
  temps.push(dir);
  return dir;
};

const git = (cwd: string, ...args: string[]): string => execFileSync('git', args, { cwd }).toString().trim();

/** A main checkout on `main` with a committed bundle, a helper script and `build.mjs`, and an `origin` whose `HEAD` names `main`. */
const mainCheckout = () => {
  const dir = tempDir('plot-restart-main-');
  git(dir, 'init', '--quiet', '-b', 'main');
  git(dir, 'config', 'user.email', 't@t.example');
  git(dir, 'config', 'user.name', 't');
  const bundlePath = path.join(dir, BUNDLE_RELATIVE_PATH);
  fs.mkdirSync(path.dirname(bundlePath), { recursive: true });
  fs.mkdirSync(path.join(dir, 'packages', 'board'), { recursive: true });
  fs.copyFileSync(path.join(REPO, 'packages', 'board', 'build.mjs'), path.join(dir, 'packages', 'board', 'build.mjs'));
  fs.writeFileSync(path.join(dir, 'skills', 'plot', 'scripts', 'plot-helper.sh'), 'echo one\n');
  const commit = (content: string): string => {
    fs.writeFileSync(bundlePath, content);
    git(dir, 'add', '-A');
    git(dir, 'commit', '--quiet', '-m', content.trim());
    return git(dir, 'rev-parse', 'HEAD');
  };
  const first = commit('console.log(1);\n');
  const remote = tempDir('plot-restart-origin-');
  git(remote, 'init', '--quiet', '--bare', '-b', 'main');
  git(dir, 'remote', 'add', 'origin', remote);
  git(dir, 'push', '--quiet', 'origin', 'main');
  git(dir, 'remote', 'set-head', 'origin', 'main');
  const hash = (): string => git(dir, 'hash-object', BUNDLE_RELATIVE_PATH);
  const trees = (): Trees => treesGit({ repoRoot: dir, scriptDir: SCRIPTS });
  return { dir, bundlePath, commit, first, hash, trees };
};
type Main = ReturnType<typeof mainCheckout>;

const pin = async (m: Main): Promise<PinnedCheckout> => {
  const pinned = await pinMainCheckout(m.trees(), SCRIPTS);
  if (pinned === null) throw new Error('no main checkout pinned');
  return pinned;
};

interface SelfChecks {
  boundedRun: BoundedRun;
  runs: { command: string; args: readonly string[] }[];
}

const PASSED: PortResult<BoundedRunResult> = { ok: true, value: { status: 0, timedOut: false, ranSeconds: 1 } };
const EXIT_1: PortResult<BoundedRunResult> = { ok: true, value: { status: 1, timedOut: false, ranSeconds: 1 } };

/** A `boundedRun` that answers each self-check in turn, the last answer repeating. */
const selfChecks = (...answers: PortResult<BoundedRunResult>[]): SelfChecks => {
  const runs: SelfChecks['runs'] = [];
  const queue = answers.length === 0 ? [PASSED] : answers;
  return {
    runs,
    boundedRun: {
      run: async (command, args, options) => {
        runs.push({ command, args });
        fs.writeFileSync(options.outFile, '');
        return queue[Math.min(runs.length, queue.length) - 1]!;
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

/** A running bundle in a desk: its own file, at the content and commit given. */
const desk = (content: string): string => {
  const file = path.join(tempDir('plot-restart-desk-'), 'plot-worker-loop.mjs');
  fs.writeFileSync(file, content);
  return file;
};

const restartOf = (m: Main, pinned: PinnedCheckout, over: Partial<RestartDeps> = {}): RestartDeps & { lines: string[] } => {
  const lines: string[] = [];
  const runningBundle = over.runningBundle ?? desk('console.log("desk");\n');
  return {
    pinned,
    runningBundle,
    loadedHash: git(m.dir, 'hash-object', runningBundle),
    runningCommit: m.first,
    residentBytes: () => 60 * 1024 * 1024,
    execveAvailable: true,
    exec: { path: '/bin/node', options: ['--no-warnings'], args: ['--flag'] },
    selfCheckFailures: new Map<string, number>(),
    logOnce: (line) => {
      if (!lines.includes(`once: ${line}`)) lines.push(`once: ${line}`);
    },
    log: (line) => lines.push(line),
    env: { KEEP: '1' },
    ...over,
    lines,
  };
};

const NO_CARRY = { waitStartedAt: null, hopFrom: '' };
const IN_WAIT = { waitStartedAt: 1_000, hopFrom: '' };

const failing = <T>(): Promise<PortResult<T>> => Promise.resolve({ ok: false, why: 'failed' });

describe('pinMainCheckout', () => {
  it('pins the entry the listing marks as main and its bundle path', async () => {
    const m = mainCheckout();
    const pinned = await pin(m);
    expect(pinned.checkout).toBe(m.dir);
    expect(pinned.bundlePath).toBe(m.bundlePath);
  });

  it('pins nothing where the listing fails or names no main checkout', async () => {
    expect(await pinMainCheckout({ ...treesFixture(), list: failing } as Trees, '/unused')).toBeNull();
    const elsewhere = treesFixture({ worktrees: [{ path: '/desk', branch: 'x', isMain: false }] }) as Trees;
    expect(await pinMainCheckout(elsewhere, '/unused')).toBeNull();
  });
});

describe('mainCheckoutReading — a real repository', () => {
  it('reads a clean default-branch checkout, its hashes, and HEAD containing the running bundle’s commit', async () => {
    const m = mainCheckout();
    const deps = restartOf(m, await pin(m));
    m.commit('console.log(2);\n');
    expect(await mainCheckoutReading(m.trees(), deps)).toEqual({
      onDefaultBranch: true,
      scriptPathsClean: true,
      headContainsRunning: 'yes',
      pinnedHash: m.hash(),
      runningHashNow: deps.loadedHash,
    });
  });

  it('reads a rebuilt, uncommitted bundle as unclean, which the desk-dirt filter hides (#1324 H2)', async () => {
    const m = mainCheckout();
    const deps = restartOf(m, await pin(m));
    fs.writeFileSync(m.bundlePath, 'console.log("local rebuild");\n');
    const dirty = await m.trees().dirtyPaths(m.dir);
    expect(dirty.ok && dirty.value.includes(BUNDLE_RELATIVE_PATH)).toBe(false);
    expect((await mainCheckoutReading(m.trees(), deps)).scriptPathsClean).toBe(false);
  });

  it('reads a modified or untracked helper script as unclean, and a change elsewhere as clean', async () => {
    const m = mainCheckout();
    const deps = restartOf(m, await pin(m));
    fs.writeFileSync(path.join(m.dir, 'skills/plot/scripts/plot-helper.sh'), 'echo edited\n');
    expect((await mainCheckoutReading(m.trees(), deps)).scriptPathsClean).toBe(false);
    git(m.dir, 'checkout', '--', 'skills/plot/scripts/plot-helper.sh');
    fs.writeFileSync(path.join(m.dir, 'skills/plot/scripts/plot-new.sh'), 'echo new\n');
    expect((await mainCheckoutReading(m.trees(), deps)).scriptPathsClean).toBe(false);
    fs.rmSync(path.join(m.dir, 'skills/plot/scripts/plot-new.sh'));
    fs.writeFileSync(path.join(m.dir, 'notes.md'), 'x\n');
    expect((await mainCheckoutReading(m.trees(), deps)).scriptPathsClean).toBe(true);
  });

  it('reads a checkout on another branch as off the default branch', async () => {
    const m = mainCheckout();
    const deps = restartOf(m, await pin(m));
    git(m.dir, 'checkout', '--quiet', '-b', 'feature/x');
    expect((await mainCheckoutReading(m.trees(), deps)).onDefaultBranch).toBe(false);
  });

  it('reads a checkout behind the running bundle’s commit as not containing it', async () => {
    const m = mainCheckout();
    const ahead = m.commit('console.log(2);\n');
    const deps = restartOf(m, await pin(m), { runningCommit: ahead });
    git(m.dir, 'reset', '--quiet', '--hard', 'HEAD~1');
    expect((await mainCheckoutReading(m.trees(), deps)).headContainsRunning).toBe('no');
  });

  it('reads the running bundle’s file as it is now', async () => {
    const m = mainCheckout();
    const deps = restartOf(m, await pin(m));
    fs.writeFileSync(deps.runningBundle, 'rebuilt on disk\n');
    expect((await mainCheckoutReading(m.trees(), deps)).runningHashNow).toBe(git(m.dir, 'hash-object', deps.runningBundle));
  });

  it('reads every unanswerable port as the side that blocks a restart', async () => {
    const refs = { ...refsFixture(), defaultBranch: failing, resolve: failing, hashFilesSync: () => ({ ok: false, why: 'failed' }) } as unknown as Refs;
    const trees = { ...treesFixture(), list: failing, changedUnder: failing } as Trees;
    const pinned: PinnedCheckout = { checkout: '/main', bundlePath: '/main/b.mjs', refs };
    expect(await mainCheckoutReading(trees, { pinned, runningBundle: '/desk/b.mjs', runningCommit: 'abc' })).toEqual({
      onDefaultBranch: false,
      scriptPathsClean: false,
      headContainsRunning: 'unknown',
      pinnedHash: '',
      runningHashNow: '',
    });
  });

  it('reads an empty default branch, an unknown running commit and a failed ancestry as blocking', async () => {
    const answered = <T>(value: T) => async (): Promise<PortResult<T>> => ({ ok: true, value });
    const refs = { ...refsFixture(), defaultBranch: answered(''), resolve: answered('head'), contains: failing } as unknown as Refs;
    const pinned: PinnedCheckout = { checkout: '/main', bundlePath: '/main/b.mjs', refs };
    const trees = treesFixture({ worktrees: [{ path: '/other', branch: '', isMain: true }] }) as Trees;
    const reading = await mainCheckoutReading(trees, { pinned, runningBundle: '/desk/b.mjs', runningCommit: 'abc' });
    expect(reading.onDefaultBranch).toBe(false);
    expect(reading.headContainsRunning).toBe('unknown');
    expect((await mainCheckoutReading(trees, { pinned, runningBundle: '/desk/b.mjs', runningCommit: '' })).headContainsRunning).toBe('unknown');
  });
});

describe('checkRestart — a restart onto the main checkout', () => {
  it('runs the new bundle’s --self-check, then replaces the process with the wait and the hop carried (failure 5)', async () => {
    const m = mainCheckout();
    const running = desk('console.log(1);\n');
    const deps = restartOf(m, await pin(m), { runningBundle: running });
    m.commit('console.log(2);\n');
    const checks = selfChecks();
    const r = replaces();
    await checkRestart({ trees: m.trees(), boundedRun: checks.boundedRun, reexec: r.reexec }, deps, 'later', { waitStartedAt: 1_000, hopFrom: 'infra/a' });
    expect(checks.runs).toEqual([{ command: '/bin/node', args: [m.bundlePath, '--self-check'] }]);
    expect(r.calls).toEqual([
      {
        command: '/bin/node',
        args: ['/bin/node', '--no-warnings', m.bundlePath, '--flag'],
        env: { KEEP: '1', PLOT_WAIT_STARTED: '1000', PLOT_HOP_FROM: 'infra/a' },
      },
    ]);
    expect(deps.lines[0]).toContain(`restarting on ${m.bundlePath}`);
  });

  it('moves a loop started from a desk’s older bundle to the main checkout’s before the first pass', async () => {
    const m = mainCheckout();
    const deps = restartOf(m, await pin(m));
    const r = replaces({ ok: true, value: undefined as never });
    await checkRestart({ trees: m.trees(), boundedRun: selfChecks().boundedRun, reexec: r.reexec }, deps, 'first', NO_CARRY);
    expect(r.calls[0]?.args[2]).toBe(m.bundlePath);
    expect(r.calls[0]?.env).toMatchObject({ PLOT_WAIT_STARTED: '', PLOT_HOP_FROM: '' });
    expect(deps.lines.filter((l) => l.startsWith('once:'))).toEqual([]);
  });

  it('logs a replace that failed and does not try that content again (#1324 L2)', async () => {
    const m = mainCheckout();
    const deps = restartOf(m, await pin(m));
    const checks = selfChecks();
    const r = replaces();
    const ports = { trees: m.trees(), boundedRun: checks.boundedRun, reexec: r.reexec };
    await checkRestart(ports, deps, 'first', NO_CARRY);
    await checkRestart(ports, deps, 'later', IN_WAIT);
    expect(r.calls).toHaveLength(1);
    expect(checks.runs).toHaveLength(1);
    expect(deps.lines).toContain('once: plot-worker-loop: the restart did not happen (failed); staying on the running bundle');
  });
});

describe('checkRestart — no restart, with the reason logged once (#1324 M1, M2)', () => {
  const noRestart = async (trees: Trees, deps: RestartDeps & { lines: string[] }, phase: 'first' | 'later' = 'later', carry = IN_WAIT) => {
    const checks = selfChecks();
    const r = replaces();
    await checkRestart({ trees, boundedRun: checks.boundedRun, reexec: r.reexec }, deps, phase, carry);
    await checkRestart({ trees, boundedRun: checks.boundedRun, reexec: r.reexec }, deps, phase, carry);
    expect(checks.runs).toEqual([]);
    expect(r.calls).toEqual([]);
    return deps.lines;
  };

  it('stays on a desk bundle newer than a lagging main checkout, on the first check (#1324 M1)', async () => {
    const m = mainCheckout();
    const newer = m.commit('console.log(2);\n');
    git(m.dir, 'reset', '--quiet', '--hard', 'HEAD~1');
    const deps = restartOf(m, await pin(m), { runningBundle: desk('console.log(2);\n'), runningCommit: newer });
    const lines = await noRestart(m.trees(), deps, 'first', NO_CARRY);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('is behind it or moved backwards');
  });

  it('stays when the main checkout moved backwards', async () => {
    const m = mainCheckout();
    const second = m.commit('console.log(2);\n');
    const deps = restartOf(m, await pin(m), { runningBundle: desk('console.log(2);\n'), runningCommit: second });
    git(m.dir, 'reset', '--quiet', '--hard', 'HEAD~1');
    expect((await noRestart(m.trees(), deps))[0]).toContain('moved backwards');
  });

  it('stays when the main checkout’s bundle is rebuilt and uncommitted (#1324 H2)', async () => {
    const m = mainCheckout();
    const deps = restartOf(m, await pin(m), { runningBundle: desk('console.log(1);\n') });
    fs.writeFileSync(m.bundlePath, 'console.log("local rebuild");\n');
    expect(await noRestart(m.trees(), deps)).toEqual([
      "once: plot-worker-loop: staying on the running bundle — the main checkout's bundle differs, but the main checkout's script paths hold uncommitted changes",
    ]);
  });

  it('stays when a helper script is edited (#1324 M5)', async () => {
    const m = mainCheckout();
    const deps = restartOf(m, await pin(m), { runningBundle: desk('console.log(1);\n') });
    m.commit('console.log(2);\n');
    fs.writeFileSync(path.join(m.dir, 'skills/plot/scripts/plot-helper.sh'), 'echo edited\n');
    expect((await noRestart(m.trees(), deps))[0]).toContain('script paths hold uncommitted changes');
  });

  it('stays when the main checkout is on another branch', async () => {
    const m = mainCheckout();
    const deps = restartOf(m, await pin(m), { runningBundle: desk('console.log(1);\n') });
    git(m.dir, 'checkout', '--quiet', '-b', 'feature/x');
    m.commit('console.log(2);\n');
    expect((await noRestart(m.trees(), deps))[0]).toContain('not on the default branch');
  });

  it('stays, logging nothing, on an identical rebuild with a newer mtime', async () => {
    const m = mainCheckout();
    const deps = restartOf(m, await pin(m), { runningBundle: desk('console.log(1);\n') });
    fs.writeFileSync(m.bundlePath, fs.readFileSync(m.bundlePath));
    const later = new Date(Date.now() + 60_000);
    fs.utimesSync(m.bundlePath, later, later);
    expect(await noRestart(m.trees(), deps)).toEqual([]);
  });

  it('stays outside a free wait at 301 MB with a newer bundle', async () => {
    const m = mainCheckout();
    const deps = restartOf(m, await pin(m), { residentBytes: () => 301 * 1024 * 1024 });
    m.commit('console.log(2);\n');
    expect(await noRestart(m.trees(), deps, 'later', NO_CARRY)).toEqual([]);
  });

  it('logs the missing process.execve once', async () => {
    const m = mainCheckout();
    const deps = restartOf(m, await pin(m), { execveAvailable: false });
    const lines = await noRestart(m.trees(), deps);
    expect(new Set(lines)).toEqual(new Set(['once: plot-worker-loop: staying on the running bundle — process.execve is not available on this Node, so the loop cannot restart itself']));
  });
});

describe('checkRestart — a candidate that fails its --self-check (#1324 L3)', () => {
  const cases: [string, PortResult<BoundedRunResult>, string][] = [
    ['exits 1', EXIT_1, 'exited 1'],
    ['runs past the bound', { ok: true, value: { status: 124, timedOut: true, ranSeconds: 10 } }, 'ran past 10s'],
    ['cannot run', { ok: false, why: 'unaskable' }, 'could not run (unaskable)'],
  ];
  for (const [name, answer, reason] of cases) {
    it(`tries it on two passes, then stays and logs once, when it ${name}`, async () => {
      const m = mainCheckout();
      const deps = restartOf(m, await pin(m));
      const checks = selfChecks(answer);
      const r = replaces();
      const ports = { trees: m.trees(), boundedRun: checks.boundedRun, reexec: r.reexec };
      await checkRestart(ports, deps, 'first', NO_CARRY);
      expect(deps.lines).toEqual([]);
      await checkRestart(ports, deps, 'later', IN_WAIT);
      await checkRestart(ports, deps, 'later', IN_WAIT);
      expect(r.calls).toEqual([]);
      expect(checks.runs).toHaveLength(2);
      expect(deps.lines).toEqual([`plot-worker-loop: ${m.bundlePath} failed its --self-check on 2 passes (last: ${reason}); staying on the running bundle`]);
    });
  }

  it('restarts when a failed --self-check passes on the next pass', async () => {
    const m = mainCheckout();
    const deps = restartOf(m, await pin(m));
    const r = replaces();
    const ports = { trees: m.trees(), boundedRun: selfChecks(EXIT_1, PASSED).boundedRun, reexec: r.reexec };
    await checkRestart(ports, deps, 'first', NO_CARRY);
    await checkRestart(ports, deps, 'later', IN_WAIT);
    expect(r.calls).toHaveLength(1);
  });
});

describe('checkRestart — the memory ceiling (#1324 M3)', () => {
  it('restarts on the running bundle in a free wait past the ceiling, with no newer bundle', async () => {
    const m = mainCheckout();
    const running = desk('console.log(1);\n');
    const deps = restartOf(m, await pin(m), { runningBundle: running, residentBytes: () => MEMORY_CEILING_BYTES + 1 });
    const checks = selfChecks();
    const r = replaces();
    await checkRestart({ trees: m.trees(), boundedRun: checks.boundedRun, reexec: r.reexec }, deps, 'later', { waitStartedAt: 5_000, hopFrom: '' });
    expect(checks.runs[0]?.args[0]).toBe(running);
    expect(r.calls[0]?.args[2]).toBe(running);
    expect(r.calls[0]?.env.PLOT_WAIT_STARTED).toBe('5000');
  });

  it('stays and logs when the running bundle changed on disk since it was loaded', async () => {
    const m = mainCheckout();
    const running = desk('console.log(1);\n');
    const deps = restartOf(m, await pin(m), { runningBundle: running, residentBytes: () => MEMORY_CEILING_BYTES + 1 });
    fs.writeFileSync(running, 'console.log("rebuilt");\n');
    const checks = selfChecks();
    const r = replaces();
    await checkRestart({ trees: m.trees(), boundedRun: checks.boundedRun, reexec: r.reexec }, deps, 'later', IN_WAIT);
    expect(checks.runs).toEqual([]);
    expect(r.calls).toEqual([]);
    expect(deps.lines[0]).toContain('the running bundle changed on disk');
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
  const scriptsOf = (m: Main): string => path.join(m.dir, 'skills', 'plot', 'scripts');

  it('pins the main checkout, hashes the running bundle under scriptDir, and reads the commit that built it', async () => {
    const m = mainCheckout();
    const lines: string[] = [];
    const deps = await restartDeps(m.trees(), scriptsOf(m), { A: '1' }, (l) => lines.push(l), platform({ execve: () => undefined }));
    expect(deps?.pinned.checkout).toBe(m.dir);
    expect(deps?.runningBundle).toBe(m.bundlePath);
    expect(deps?.loadedHash).toBe(m.hash());
    expect(deps?.runningCommit).toBe(m.first);
    expect(deps?.residentBytes()).toBe(42);
    expect(deps?.execveAvailable).toBe(true);
    expect(deps?.exec).toEqual({ path: '/bin/node', options: ['--no-warnings'], args: ['--flag'] });
    expect(deps?.env).toEqual({ A: '1' });
    deps?.logOnce('gap');
    deps?.logOnce('gap');
    deps?.log('line');
    expect(lines).toEqual(['gap', 'line']);
  });

  it('reads a Node without process.execve, and a running bundle outside any repository', async () => {
    const m = mainCheckout();
    const outside = tempDir('plot-restart-plugin-');
    fs.mkdirSync(path.join(outside, 'scripts', 'board'), { recursive: true });
    fs.writeFileSync(path.join(outside, 'scripts', 'board', 'plot-worker-loop.mjs'), 'x\n');
    const deps = await restartDeps(m.trees(), path.join(outside, 'scripts'), {}, () => undefined, platform());
    expect(deps?.execveAvailable).toBe(false);
    expect(deps?.runningCommit).toBe('');
  });

  it('answers undefined, saying why, where no main checkout is pinned or the running bundle is absent (#1324 M2)', async () => {
    const m = mainCheckout();
    const lines: string[] = [];
    expect(await restartDeps({ ...treesFixture(), list: failing } as Trees, '/unused', {}, (l) => lines.push(l), platform())).toBeUndefined();
    expect(await restartDeps(m.trees(), path.join(m.dir, 'nowhere'), {}, (l) => lines.push(l), platform())).toBeUndefined();
    expect(lines[0]).toContain('no main checkout is listed');
    expect(lines[1]).toContain('cannot be hashed');
  });

  it('reads the running process by default', async () => {
    const m = mainCheckout();
    const deps = await restartDeps(m.trees(), scriptsOf(m), {}, () => undefined);
    expect(deps?.exec.path).toBe(process.execPath);
  });
});

describe('selfCheck (#1324 M4)', () => {
  it('answers 0 where the ports build and the configuration reads', async () => {
    const m = mainCheckout();
    expect(await selfCheck({ PLOT_WORKTREE: m.dir }, SCRIPTS, () => '')).toBe(0);
    expect(await selfCheck({}, SCRIPTS)).toBe(0);
  });

  it('answers 1 where reading the configuration throws', async () => {
    const m = mainCheckout();
    const broken = (): string => {
      throw new Error('broken config reader');
    };
    expect(await selfCheck({ PLOT_WORKTREE: m.dir }, SCRIPTS, broken)).toBe(1);
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
  refusedSlices: refusedSlicesFixture(),
  build: buildFixture(),
  host: hostFixture({ prs: [] as Pr[] }),
  transcriptQuietSeconds: async () => 5000,
  recordSpend: async () => undefined,
  recordRun: async () => null,
  recordLimits: async () => 0,
  sliceCostUsd: async () => null,
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
  config: { boundSeconds: 28_800, waitBudgetSeconds: 60, passIntervalMs: 10_000, checksPollMs: 10_000, maxStartRetries: 3, checksWaitSeconds: 1_800, correctionBudget: 2, sliceMaxRuns: 12, sliceMaxSpendUsd: null, base: 'origin/main' },
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

  it('checks before the first pass with no wait, and between free passes with the wait’s start and the carried hop', async () => {
    const m = mainCheckout();
    const r = replaces();
    const restart = restartOf(m, await pin(m), { selfCheckFailures: { get: () => 0, set: () => undefined } as unknown as Map<string, number> });
    const code = await runWorkerLoop(freeLoop(m.dir, loopPorts(m.trees(), selfChecks().boundedRun, r.reexec), { restart, hopFrom: 'infra/a' }));
    expect(code).toBe(124);
    expect(r.calls[0]?.env).toMatchObject({ PLOT_WAIT_STARTED: '', PLOT_HOP_FROM: 'infra/a' });
    expect(r.calls.slice(1).map((c) => c.env.PLOT_WAIT_STARTED)).toEqual(r.calls.slice(1).map(() => String(T0)));
    expect(r.calls.length).toBeGreaterThan(2);
  });

  it('ends a restarted free wait at its original start plus the bound', async () => {
    const m = mainCheckout();
    const r = replaces();
    const restart = restartOf(m, await pin(m), { runningBundle: desk('console.log(1);\n') });
    const started = T0 - 50_000;
    const code = await runWorkerLoop(freeLoop(m.dir, loopPorts(m.trees(), selfChecks().boundedRun, r.reexec), { restart, waitStartedAt: started }));
    expect(code).toBe(124);
    expect(Date.now() - started).toBeGreaterThanOrEqual(60_000);
    expect(Date.now() - started).toBeLessThan(70_000);
    expect(r.calls).toEqual([]);
  });
});

describe('main — the restart composition', () => {
  const noStop: StopTarget = { once: () => undefined, exit: () => undefined };

  const run = async (dir: string, carried: NodeJS.ProcessEnv): Promise<{ lines: string; env: NodeJS.ProcessEnv }> => {
    const lines: string[] = [];
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation((chunk: unknown) => {
      lines.push(String(chunk));
      return true;
    });
    const env: NodeJS.ProcessEnv = {
      PLOT_WORKTREE: dir,
      PLOT_MANIFEST_FILE: path.join(dir, 'gone.json'),
      PLOT_WORKER_BOUND: '1',
      PLOT_WAIT_BUDGET_SECONDS: '1',
      PLOT_WAIT_POLL_SECONDS: '1',
      PLOT_AGENT: '',
      ...carried,
    };
    try {
      const code = await main(env, path.join(dir, 'skills', 'plot', 'scripts'), shippedConfig(dir), noStop);
      expect(code).toBe(124);
    } finally {
      stderr.mockRestore();
    }
    return { lines: lines.join(''), env };
  };

  it('says nothing about a restart on a first start', async () => {
    const m = mainCheckout();
    expect((await run(m.dir, {})).lines).not.toContain('restarted as pid');
  });

  it('names its pid, the carried wait and hop, and keeps both from the prompts’ environment (#1324 L1)', async () => {
    const m = mainCheckout();
    const carried = await run(m.dir, { PLOT_WAIT_STARTED: String(Date.parse('2026-10-06T09:00:00Z')), PLOT_HOP_FROM: 'infra/a' });
    expect(carried.lines).toContain(
      `restarted as pid ${process.pid} on ${m.bundlePath}, keeping the free wait from 2026-10-06T09:00:00.000Z and the hop from infra/a`,
    );
    expect(carried.env).not.toHaveProperty('PLOT_WAIT_STARTED');
    expect(carried.env).not.toHaveProperty('PLOT_HOP_FROM');
    expect((await run(m.dir, { PLOT_WAIT_STARTED: '' })).lines).toContain(`restarted as pid ${process.pid} on ${m.bundlePath}, keeping no free wait`);
  });
});
