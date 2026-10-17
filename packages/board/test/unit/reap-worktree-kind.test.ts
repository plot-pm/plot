import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { answered } from '@plot-pm/domain';
import type { Processes, Trees, Worktree } from '@plot-pm/domain';
import { runWorktreeKind, type Context } from '../../src/server/entry/reap.js';

/**
 * What the worktree kind keeps. Each case is a desk the reaper must not remove
 * because work or a live loop is still there.
 */

let root: string;
let desk: string;

beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), 'reap-wt-'));
  desk = path.join(root, 'desk');
  mkdirSync(desk);
  writeFileSync(path.join(desk, '.plot-worker.pid'), '999999999\n');
});

afterEach(() => {
  rmSync(path.join(root), { recursive: true, force: true });
});

const tree = (): Worktree => ({
  path: desk,
  branch: 'feature/desk-a',
  detached: false,
  isMain: false,
  clean: false,
  agentSession: null,
  prunable: false,
});

const idleProcesses = {
  workerState: async () => answered({ state: 'none', pid: '' }),
} as unknown as Processes;

const ctxFor = (markers: readonly string[], dirty: readonly string[]): Context =>
  ({
    repoRoot: root,
    invokedFrom: root,
    scriptDir: '/nowhere',
    refs: { contains: async () => answered('yes'), commitSubjects: async () => answered([]) },
    host: { prMerged: async () => answered('merged'), prMergedHeads: async () => answered([]) },
    scripts: {},
    trees: {
      list: async () => answered([tree()]),
      markers: async () => answered(markers),
      dirtyPathsWithStatus: async () => answered(dirty),
      unpushedCommits: async () => answered([]),
      unpushedPatches: async () => answered([]),
    } as unknown as Trees,
    processes: idleProcesses,
    fetch: async () => undefined,
  }) as unknown as Context;

const reapArgs = { dryRun: true, yes: false, max: 0, sweepTemp: false };

const reapOutput = async (ctx: Context, manifestDir = path.join(root, 'agents')): Promise<string> => {
  const lines: string[] = [];
  await runWorktreeKind(ctx, reapArgs, 'main', manifestDir, '', (s) => lines.push(s));
  return lines.join('');
};

describe('runWorktreeKind', () => {
  it('reaps a merged, clean desk whose recorded pids are all dead', async () => {
    expect(await reapOutput(ctxFor([], []))).toContain('would');
  });

  it('keeps a desk whose .plot-worker.pid names a live loop while no agent runs', async () => {
    writeFileSync(path.join(desk, '.plot-worker.pid'), `${process.pid}\n`);

    const out = await reapOutput(ctxFor([], []));

    expect(out).toContain('keep');
    expect(out).toContain(`worker alive (pid ${process.pid})`);
  });

  it("keeps a desk whose manifest names a live wrapperPid", async () => {
    const manifestDir = path.join(root, 'agents');
    mkdirSync(manifestDir);
    writeFileSync(
      path.join(manifestDir, 'a.json'),
      JSON.stringify({ worktree: desk, pid: '999999999', wrapperPid: String(process.pid) }),
    );

    const out = await reapOutput(ctxFor([], []), manifestDir);

    expect(out).toContain(`worker alive (pid ${process.pid})`);
  });

  it('keeps a desk with edits to a tracked file whose name contains PLOT-BLOCKED', async () => {
    const out = await reapOutput(ctxFor([], [' M docs/PLOT-BLOCKED-notes.md']));

    expect(out).toContain('uncommitted: ');
    expect(out).toContain('PLOT-BLOCKED-notes.md');
  });

  it('does not read a PLOT-BLOCKED-notes.md at the desk root as the marker', async () => {
    const out = await reapOutput(ctxFor(['PLOT-BLOCKED-notes.md'], []));

    expect(out).not.toContain('PLOT-BLOCKED marker');
    expect(out).toContain('would');
  });

  it('still reads the root PLOT-BLOCKED.md as a marker and keeps the desk', async () => {
    // The desk is no repository, so the marker's commit count cannot be read and
    // the desk is kept; a regression to "no marker" would reap it instead.
    const out = await reapOutput(ctxFor(['PLOT-BLOCKED.md'], ['?? PLOT-BLOCKED.md']));

    expect(out).toContain('keep');
    expect(out).not.toContain('would');
  });
});
