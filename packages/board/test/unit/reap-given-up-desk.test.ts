import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { answered, failed } from '@plot-pm/domain';
import type { Processes, Trees, Worktree } from '@plot-pm/domain';
import { runWorktreeKind, type Context } from '../../src/server/entry/reap.js';

/**
 * A desk on a branch a plan gave up. The reaper removes the checkout once the
 * branch's head is on the remote, and keeps it in every other case.
 */

const BRANCH = 'bug/given-up';

let root: string;
let desk: string;
let planDir: string;
let activeDir: string;
let calls: string[];
let deskGit: (cwd: string, ...a: string[]) => void;

beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), 'reap-given-up-'));
  desk = path.join(root, 'desk');
  planDir = path.join(root, 'plans');
  activeDir = path.join(planDir, 'active');
  mkdirSync(activeDir, { recursive: true });
  // A real clone: the marker reading counts commits with git in the desk.
  const git = (cwd: string, ...a: string[]): void => {
    execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...a], { cwd, stdio: 'ignore' });
  };
  const origin = path.join(root, 'origin.git');
  git(root, 'init', '-q', '--bare', '-b', 'main', origin);
  git(root, 'clone', '-q', origin, desk);
  writeFileSync(path.join(desk, 'a.txt'), 'a\n');
  git(desk, 'add', 'a.txt');
  git(desk, 'commit', '-q', '-m', 'seed');
  git(desk, 'push', '-q', 'origin', 'main');
  git(desk, 'checkout', '-q', '-b', BRANCH);
  writeFileSync(path.join(desk, 'b.txt'), 'b\n');
  git(desk, 'add', 'b.txt');
  git(desk, 'commit', '-q', '-m', 'work');
  git(desk, 'push', '-q', 'origin', BRANCH);
  deskGit = git;
  writeFileSync(path.join(desk, '.plot-worker.pid'), '999999999\n');
  writeFileSync(path.join(desk, 'PLOT-BLOCKED.md'), 'PLOT-BLOCKED: parked\n');
  writeFileSync(path.join(planDir, 'p.md'), `branch ${BRANCH}\n`);
  calls = [];
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

interface Opts {
  activeScheduled?: boolean;
  pr?: 'none' | 'OPEN' | 'CLOSED' | 'unaskable';
  workerPid?: string;
  dirty?: readonly string[];
  unpushed?: readonly string[];
  fetchOk?: boolean;
  /** Commits `origin/<branch>..HEAD` holds that change files. */
  extraCommits?: number;
}

const ctxFor = (o: Opts = {}): Context => {
  for (let i = 0; i < (o.extraCommits ?? 0); i += 1) {
    writeFileSync(path.join(desk, `extra${i}.txt`), 'x\n');
    deskGit(desk, 'add', `extra${i}.txt`);
    deskGit(desk, 'commit', '-q', '-m', `extra ${i}`);
  }
  const tree: Worktree = {
    path: desk,
    branch: BRANCH,
    detached: false,
    isMain: false,
    clean: false,
    agentSession: null,
    prunable: false,
  };
  if (o.activeScheduled) {
    writeFileSync(path.join(planDir, 'q.md'), `branch ${BRANCH}\n`);
    writeFileSync(path.join(activeDir, 'q.md'), `branch ${BRANCH}\n`);
  }
  return {
    repoRoot: root,
    invokedFrom: root,
    scriptDir: '/nowhere',
    refs: {
      contains: async () => answered('no'),
      commitSubjects: async () => answered([]),
    },
    host: {
      prMerged: async () => answered('not-merged'),
      prMergedHeads: async () => answered([]),
      prState: async () => {
        if (o.pr === 'unaskable') return failed();
        if (o.pr === 'OPEN' || o.pr === 'CLOSED') return answered({ state: o.pr });
        return answered(null);
      },
    },
    plans: {
      readPlans: async (files: readonly string[]) =>
        answered(
          files.map((file) => ({
            file,
            slices: [{ branches: [{ branch: BRANCH, deferred: path.basename(file) !== 'q.md' }] }],
          })),
        ),
    },
    scripts: {},
    trees: {
      list: async () => answered([tree]),
      markers: async () => answered(['PLOT-BLOCKED.md']),
      dirtyPathsWithStatus: async () => answered(['?? PLOT-BLOCKED.md', ...(o.dirty ?? [])]),
      unpushedCommits: async () => answered(o.unpushed ?? []),
      unpushedPatches: async () => answered([]),
      fetch: async () => {
        calls.push('fetch');
        return o.fetchOk === false ? failed() : answered(undefined);
      },
      removeOnly: async () => {
        calls.push('removeOnly');
        return answered(undefined);
      },
      deleteBranch: async (b: string) => {
        calls.push(`deleteBranch ${b}`);
        return answered(undefined);
      },
      prune: async () => answered(undefined),
    } as unknown as Trees,
    processes: {
      workerState: async () => answered({ state: o.workerPid ? 'running' : 'none', pid: o.workerPid ?? '' }),
      isAlive: async () => answered(false),
    } as unknown as Processes,
    fetch: async () => undefined,
  } as unknown as Context;
};

const run = async (o: Opts, yes: boolean): Promise<string> => {
  const lines: string[] = [];
  const args = { dryRun: !yes, yes, max: 0, sweepTemp: false };
  await runWorktreeKind(ctxFor(o), args, 'main', path.join(root, 'agents'), '', (s) => lines.push(s), planDir, activeDir);
  return lines.join('');
};

describe('a desk on a given-up branch with its head on the remote', () => {
  it('is removed on --yes with the marker saved and the local branch deleted after a fetch', async () => {
    const out = await run({}, true);

    expect(out).toContain('reaped');
    expect(out).toContain('local branch deleted');
    expect(calls).toEqual(expect.arrayContaining(['fetch', 'removeOnly', `deleteBranch ${BRANCH}`]));
    expect(calls.indexOf('fetch')).toBeLessThan(calls.indexOf('removeOnly'));
    expect(readFileSync(path.join(root, '.plot/state/refusals.tsv'), 'utf8')).toContain('PLOT-BLOCKED: parked');
  });

  it('never touches the remote ref', async () => {
    await run({}, true);

    expect(calls.filter((c) => /remote|push/i.test(c))).toEqual([]);
  });

  it('keeps the local branch when the fetch fails, and still removes the checkout', async () => {
    const out = await run({ fetchOk: false }, true);

    expect(out).toContain('reaped');
    expect(out).toContain('local branch kept');
    expect(calls).toContain('removeOnly');
    expect(calls.some((c) => c.startsWith('deleteBranch'))).toBe(false);
  });
});

describe('a given-up desk is kept when one reading differs', () => {
  const keeps = async (o: Opts, why: string): Promise<void> => {
    const out = await run(o, true);
    expect(out).toContain('keep');
    expect(out).toContain(why);
    expect(calls).not.toContain('removeOnly');
    expect(existsSync(desk)).toBe(true);
  };

  it('an open PR', () => keeps({ pr: 'OPEN' }, 'open PR'));
  it('an unanswered host', () => keeps({ pr: 'unaskable' }, 'could not be asked'));
  it('a live worker', () => keeps({ workerPid: '4242' }, 'worker alive (pid 4242)'));
  it('a dirty path besides the marker', () => keeps({ dirty: [' M src/a.ts'] }, 'PLOT-BLOCKED marker'));
  it('one unpushed commit, named by its sha', () => keeps({ unpushed: ['abc1234'] }, 'unpushed commits: abc1234'));
  it('a branch an Active-index plan still schedules', () => keeps({ activeScheduled: true }, 'PLOT-BLOCKED marker'));
  it('a file-changing commit beyond the pushed head', () => keeps({ extraCommits: 1 }, 'PLOT-BLOCKED marker'));
});
