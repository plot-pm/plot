// `checkRestart` — the board-entry wiring around `restartAnswer`: it reads the
// main checkout through a REAL repository (the subject shells out to
// `refsGit`, which a fixture cannot stand in for), runs a scripted
// `--self-check` through `boundedRun`, and calls a scripted `reexec` on a
// `restart` verdict. One test per `runWorkerLoop`-visible behaviour named in
// the plan's "Done when" list.
import { afterEach, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { rmTree } from '../helpers.mjs';
import { treesFixture } from '@plot-pm/domain/adapters';
import type { BoundedRun, BoundedRunResult, PortResult, Trees } from '@plot-pm/domain';
import type { Reexec } from '@plot-pm/domain/ports/reexec';
import {
  BUNDLE_RELATIVE_PATH,
  checkRestart,
  mainCheckoutReading,
  type RestartDeps,
  type WorkerLoopPorts,
} from '../../src/server/entry/worker-loop.js';

const temps: string[] = [];
afterEach(() => {
  for (const d of temps.splice(0)) rmTree(d);
});

const git = (cwd: string, ...args: string[]): void => {
  execFileSync('git', args, { cwd });
};

/**
 * A real repository on `main`, with a committed bundle at `BUNDLE_RELATIVE_PATH`
 * and an `origin` remote whose `HEAD` is set to `main`.
 *
 * `refs.defaultBranch()` shells `git symbolic-ref --short refs/remotes/origin/HEAD
 * | sed ... || git rev-parse --abbrev-ref HEAD` with no `pipefail` — on a bare
 * `git init` with no remote, `symbolic-ref` fails but `sed` still exits 0 on
 * its empty stdin, so the `||` fallback never runs and the answer comes back
 * empty. A real plot worktree always clones from a host and so always has an
 * `origin`; this fixture gives one for the same reason, rather than relying on
 * the fallback this branch does not own.
 *
 * The first commit (an empty tree) is what {@link loadedHashOf} returns — a
 * real ancestor of the second commit, where the test needs `HEAD` to contain
 * the loaded commit. `git merge-base --is-ancestor` against a literal
 * placeholder string answers `unknown`, not `yes`, since the string names no
 * object at all.
 */
const mainCheckout = (bundleContent = 'console.log(1);\n'): string => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'plot-restart-main-'));
  temps.push(dir);
  git(dir, 'init', '--quiet', '-b', 'main');
  git(dir, 'config', 'user.email', 't@t.example');
  git(dir, 'config', 'user.name', 't');
  git(dir, 'commit', '--quiet', '--allow-empty', '-m', 'root');
  const bundlePath = path.join(dir, BUNDLE_RELATIVE_PATH);
  fs.mkdirSync(path.dirname(bundlePath), { recursive: true });
  fs.writeFileSync(bundlePath, bundleContent);
  git(dir, 'add', '-A');
  git(dir, 'commit', '--quiet', '-m', 'init');
  const remote = fs.mkdtempSync(path.join(os.tmpdir(), 'plot-restart-origin-'));
  temps.push(remote);
  git(remote, 'init', '--quiet', '--bare', '-b', 'main');
  git(dir, 'remote', 'add', 'origin', remote);
  git(dir, 'push', '--quiet', 'origin', 'main');
  git(dir, 'remote', 'set-head', 'origin', 'main');
  return dir;
};

const hashOf = (dir: string): string =>
  execFileSync('git', ['hash-object', BUNDLE_RELATIVE_PATH], { cwd: dir }).toString().trim();

/** The root commit's SHA — a real ancestor of `HEAD`, standing in for the commit the loop loaded its bundle from. */
const loadedHashOf = (dir: string): string =>
  execFileSync('git', ['rev-list', '--max-parents=0', 'HEAD'], { cwd: dir }).toString().trim();

const boundedRunScript = (result: Partial<BoundedRunResult> = {}, ok = true): BoundedRun => ({
  run: async () => (ok ? { ok: true, value: { status: 0, timedOut: false, ranSeconds: 1, ...result } } : { ok: false, why: 'failed' }),
});

const reexecRecording = (): { reexec: Reexec; calls: { file: string; args: readonly string[]; env: NodeJS.ProcessEnv }[] } => {
  const calls: { file: string; args: readonly string[]; env: NodeJS.ProcessEnv }[] = [];
  return {
    calls,
    reexec: {
      replace: async (file, args, env): Promise<PortResult<never>> => {
        calls.push({ file, args, env });
        return { ok: false, why: 'unaskable' };
      },
    },
  };
};

const ports = (main: string, boundedRun: BoundedRun, reexec: Reexec): Pick<WorkerLoopPorts, 'trees' | 'boundedRun' | 'reexec'> => ({
  trees: treesFixture({ worktrees: [{ path: main, branch: 'main', isMain: true }], clean: [main] }) as Trees,
  boundedRun,
  reexec,
});

const deps = (over: Partial<RestartDeps> = {}): RestartDeps => ({
  scriptDir: '/unused',
  loadedHash: 'stale-hash',
  residentBytes: () => 10 * 1024 * 1024,
  execveAvailable: true,
  logExecveGapOnce: () => undefined,
  log: () => undefined,
  env: {},
  ...over,
});

describe('mainCheckoutReading', () => {
  it('reads the main checkout’s branch, cleanliness and bundle hash', async () => {
    const main = mainCheckout();
    const reading = await mainCheckoutReading(ports(main, boundedRunScript(), reexecRecording().reexec), '/unused');
    expect(reading).not.toBeNull();
    expect(reading?.branch).toBe('main');
    expect(reading?.clean).toBe(true);
    expect(reading?.hash).toBe(hashOf(main));
  });

  it('answers null when trees.list names no main checkout', async () => {
    const trees = treesFixture({ worktrees: [{ path: '/elsewhere', branch: 'main', isMain: false }] }) as Trees;
    const reading = await mainCheckoutReading({ trees, boundedRun: boundedRunScript(), reexec: reexecRecording().reexec }, '/unused');
    expect(reading).toBeNull();
  });
});

describe('checkRestart — restarts on a newer, clean, default-branch bundle', () => {
  it('runs --self-check then calls reexec, during a free wait', async () => {
    const main = mainCheckout();
    const { reexec, calls } = reexecRecording();
    const selfChecks: { command: string; args: readonly string[] }[] = [];
    const boundedRun: BoundedRun = {
      run: async (command, args, options) => {
        selfChecks.push({ command, args });
        fs.appendFileSync(options.outFile, '');
        return { ok: true, value: { status: 0, timedOut: false, ranSeconds: 1 } };
      },
    };
    const replaced = await checkRestart(ports(main, boundedRun, reexec), deps({ loadedHash: loadedHashOf(main) }), 'later', 1_000);
    expect(replaced).toBe(true);
    expect(selfChecks).toEqual([{ command: 'node', args: [path.join(main, BUNDLE_RELATIVE_PATH), '--self-check'] }]);
    expect(calls).toHaveLength(1);
    // `argv[0]` repeats the exec path, by POSIX `execve` convention — Node
    // reads its own argv starting at index 1, so an array missing this leading
    // entry makes the restarted process treat its own script path as an
    // option flag.
    expect(calls[0]?.args[0]).toBe(process.execPath);
    expect(calls[0]?.args[1]).toBe(process.argv[1]);
    expect(calls[0]?.env.PLOT_WAIT_STARTED).toBe('1000');
  });

  it('restarts on the first check, before any wait has started — PLOT_WAIT_STARTED is empty', async () => {
    const main = mainCheckout();
    const { reexec, calls } = reexecRecording();
    const replaced = await checkRestart(ports(main, boundedRunScript(), reexec), deps(), 'first', null);
    expect(replaced).toBe(true);
    expect(calls[0]?.env.PLOT_WAIT_STARTED).toBe('');
  });
});

describe('checkRestart — a failing --self-check stops no loop', () => {
  it('does not call reexec when the candidate bundle fails --self-check', async () => {
    const main = mainCheckout();
    const { reexec, calls } = reexecRecording();
    const boundedRun = boundedRunScript({ status: 1 });
    const logs: string[] = [];
    const replaced = await checkRestart(
      ports(main, boundedRun, reexec),
      deps({ loadedHash: loadedHashOf(main), log: (l) => logs.push(l) }),
      'later',
      1_000,
    );
    expect(replaced).toBe(false);
    expect(calls).toHaveLength(0);
    expect(logs.join('\n')).toContain('failed --self-check');
  });

  it('does not call reexec when --self-check cannot even start', async () => {
    const main = mainCheckout();
    const { reexec, calls } = reexecRecording();
    const replaced = await checkRestart(
      ports(main, boundedRunScript({}, false), reexec),
      deps({ loadedHash: loadedHashOf(main) }),
      'later',
      1_000,
    );
    expect(replaced).toBe(false);
    expect(calls).toHaveLength(0);
  });
});

describe('checkRestart — nothing to compare against', () => {
  it('stays, and never calls boundedRun, when the loaded hash already matches', async () => {
    const main = mainCheckout();
    const { reexec, calls } = reexecRecording();
    let ran = false;
    const boundedRun: BoundedRun = { run: async () => { ran = true; return { ok: true, value: { status: 0, timedOut: false, ranSeconds: 1 } }; } };
    const replaced = await checkRestart(ports(main, boundedRun, reexec), deps({ loadedHash: hashOf(main) }), 'later', 1_000);
    expect(replaced).toBe(false);
    expect(ran).toBe(false);
    expect(calls).toHaveLength(0);
  });

  it('stays outside a free wait, for the later phase, regardless of the bundle', async () => {
    const main = mainCheckout();
    const { reexec, calls } = reexecRecording();
    const replaced = await checkRestart(ports(main, boundedRunScript(), reexec), deps(), 'later', null);
    expect(replaced).toBe(false);
    expect(calls).toHaveLength(0);
  });
});

describe('checkRestart — the memory ceiling', () => {
  it('restarts in a free wait once resident memory passes the ceiling, with no bundle change', async () => {
    const main = mainCheckout();
    const { reexec, calls } = reexecRecording();
    const over = deps({ loadedHash: hashOf(main), residentBytes: () => 301 * 1024 * 1024 });
    const replaced = await checkRestart(ports(main, boundedRunScript(), reexec), over, 'later', 1_000);
    expect(replaced).toBe(true);
    expect(calls).toHaveLength(1);
  });
});

describe('checkRestart — no process.execve', () => {
  it('logs the gap once and never calls reexec', async () => {
    const main = mainCheckout();
    const { reexec, calls } = reexecRecording();
    const logs: string[] = [];
    let logCalls = 0;
    const replaced = await checkRestart(
      ports(main, boundedRunScript(), reexec),
      deps({ loadedHash: loadedHashOf(main), execveAvailable: false, logExecveGapOnce: (reason) => { logCalls += 1; logs.push(reason); } }),
      'later',
      1_000,
    );
    expect(replaced).toBe(false);
    expect(calls).toHaveLength(0);
    expect(logCalls).toBe(1);
    expect(logs[0]).toContain('process.execve is not available');
  });
});
