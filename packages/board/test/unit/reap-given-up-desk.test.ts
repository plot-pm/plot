import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { answered, failed } from '@plot-pm/domain';
import type { Processes, Trees, Worktree } from '@plot-pm/domain';
import { runWorktreeKind, type Context } from '../../src/server/entry/reap.js';
import type { ReapRecordRow } from '@plot-pm/domain';

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
  /** Whether resolving the branch's tip fails, so the pin cannot be written. */
  resolveFails?: boolean;
  /** Whether the pin write (ref + TSV append) fails. */
  pinFails?: boolean;
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
      resolve: async (ref: string) => {
        if (o.resolveFails) return failed();
        return answered(execFileSync('git', ['-C', desk, 'rev-parse', ref], { encoding: 'utf8' }).trim());
      },
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
    pinnedTips: {
      pin: async (branch: string, sha: string) => {
        calls.push(`pin ${branch} ${sha}`);
        return o.pinFails ? failed() : answered(`refs/plot/reaped/${branch}/${sha}`);
      },
      prune: async () => answered([]),
    },
    fetch: async () => undefined,
  } as unknown as Context;
};

const run = async (o: Opts, yes: boolean): Promise<string> => {
  const lines: string[] = [];
  const args = { dryRun: !yes, yes, max: 0, sweepTemp: false };
  const mode = yes ? { kind: 'act-scoped' as const, branches: new Set([BRANCH]) } : { kind: 'dry-run' as const };
  await runWorktreeKind(
    ctxFor(o),
    args,
    mode,
    'main',
    path.join(root, 'agents'),
    '',
    (s) => lines.push(s),
    planDir,
    activeDir,
  );
  return lines.join('');
};

/** Runs `runWorktreeKind` under an arbitrary mode and returns both its rows and its printed lines. */
const runRows = async (
  o: Opts,
  mode: { kind: 'dry-run' } | { kind: 'act-recorded'; index: ReadonlyMap<string, ReapRecordRow> },
): Promise<{ rows: readonly ReapRecordRow[]; out: string }> => {
  const lines: string[] = [];
  const args = { dryRun: mode.kind === 'dry-run', yes: mode.kind === 'act-recorded', max: 0, sweepTemp: false };
  const counters = await runWorktreeKind(
    ctxFor(o),
    args,
    mode,
    'main',
    path.join(root, 'agents'),
    '',
    (s) => lines.push(s),
    planDir,
    activeDir,
  );
  return { rows: counters.rows, out: lines.join('') };
};

describe('a desk on a given-up branch with its head on the remote', () => {
  it('is removed on --yes with the marker saved and the local branch deleted after a fetch', async () => {
    const out = await run({}, true);

    expect(out).toContain('reaped');
    expect(out).toContain('local branch deleted');
    expect(out).toContain(`restore: git branch ${BRANCH} refs/plot/reaped/${BRANCH}/`);
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

describe('the given-up branch is pinned before its local ref is deleted', () => {
  it('pins the pre-delete tip before deleteBranch runs', async () => {
    const tip = execFileSync('git', ['-C', desk, 'rev-parse', BRANCH], { encoding: 'utf8' }).trim();
    await run({}, true);

    expect(calls).toContain(`pin ${BRANCH} ${tip}`);
    expect(calls.indexOf(`pin ${BRANCH} ${tip}`)).toBeLessThan(calls.indexOf(`deleteBranch ${BRANCH}`));
  });

  it('keeps the branch and never deletes it when resolving the tip fails', async () => {
    const out = await run({ resolveFails: true }, true);

    expect(out).toContain('could not pin the tip');
    expect(calls.some((c) => c.startsWith('deleteBranch'))).toBe(false);
  });

  it('keeps the branch and never deletes it when the pin write fails', async () => {
    const out = await run({ pinFails: true }, true);

    expect(out).toContain('could not pin the tip');
    expect(calls.some((c) => c.startsWith('deleteBranch'))).toBe(false);
  });
});

describe('a landed, clean desk on a given-up branch: the dry run names the cascade, and --yes acts on exactly that record', () => {
  it('deletes the recorded worktree row and nothing more', async () => {
    const dry = await runRows({}, { kind: 'dry-run' });

    expect(dry.rows).toHaveLength(1);
    expect(dry.rows[0]).toMatchObject({ kind: 'worktree', identity: desk, reason: `given up, head on origin/${BRANCH}` });

    const index = new Map(dry.rows.map((r) => [`${r.kind}:${r.identity}`, r]));
    const acted = await runRows({}, { kind: 'act-recorded', index });

    expect(acted.out).toContain('reaped');
    expect(acted.out).toContain('local branch deleted');
    expect(calls).toEqual(expect.arrayContaining(['fetch', 'removeOnly', `deleteBranch ${BRANCH}`]));
  });

  it('keeps the desk when the record holds no row for it (never acted on a fresh re-decision)', async () => {
    const acted = await runRows({}, { kind: 'act-recorded', index: new Map() });

    expect(acted.out).toContain('keep');
    expect(acted.out).toContain('not in the recorded dry run');
    expect(calls).not.toContain('removeOnly');
    expect(existsSync(desk)).toBe(true);
  });

  it('keeps the desk when the recorded tip no longer matches the desk\'s current tip', async () => {
    const dry = await runRows({}, { kind: 'dry-run' });
    const stale: ReapRecordRow = { ...dry.rows[0], tipSha: 'deadbeefdeadbeefdeadbeefdeadbeefdeadbeef' };
    const index = new Map([[`${stale.kind}:${stale.identity}`, stale]]);

    const acted = await runRows({}, { kind: 'act-recorded', index });

    expect(acted.out).toContain('keep');
    expect(acted.out).toContain('tip-changed');
    expect(calls).not.toContain('removeOnly');
    expect(existsSync(desk)).toBe(true);
  });
});
