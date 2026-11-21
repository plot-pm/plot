import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { answered, type DefaultBranchReading } from '@plot-pm/domain';
import { defaultBranchFile, repairRecordFile } from '@plot-pm/domain/adapters';
import { REPAIR_RECORD_VERSION, type RepairRecord } from '@plot-pm/domain/entities/repair-record';

import type { MergePorts, NameRepairPrPorts } from '../../src/server/entry/merge.js';
import { removeTree } from '../rm-tree.mjs';
import { gitStateHome } from '../state-home-root.js';

/**
 * `plot-ask.mjs merge` and `plot-ask.mjs repair-pr` RUN FROM A LINKED WORKTREE
 * read the state files under the main checkout, where fleetd writes them. Both
 * workflows are replaced, so nothing reaches a host: the test captures the
 * ports the entry builds and reads through them.
 */

const named: NameRepairPrPorts[] = [];
const merged: MergePorts[] = [];
vi.mock('../../src/server/entry/merge.js', () => ({
  nameRepairPrAt: vi.fn(async (ports: NameRepairPrPorts) => {
    named.push(ports);
    return { named: false, reason: 'pr-not-open', detail: 'stubbed' };
  }),
  mergeAt: vi.fn(async (ports: MergePorts) => {
    merged.push(ports);
    return { merged: false, reason: 'host-refused', detail: 'stubbed' };
  }),
}));

const { run } = await import('../../src/server/entry/main.js');

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REAL_SCRIPTS = path.resolve(HERE, '../../../../skills/plot/scripts');
const SHA = 'a'.repeat(40);

const RED: DefaultBranchReading = {
  v: 1,
  branch: 'main',
  headSha: 'c'.repeat(40),
  head: 'red',
  settled: { sha: 'c'.repeat(40), state: 'red' },
  failingRuns: [],
  headSince: '2026-11-21T07:00:00.000Z',
  askedAt: '2026-11-21T07:02:00.000Z',
  at: '2026-11-21T07:02:00.000Z',
};

const RECORD: RepairRecord = {
  v: REPAIR_RECORD_VERSION,
  branch: 'main',
  state: 'idle',
  lastGreenSha: 'a'.repeat(40),
  firstRedSha: 'c'.repeat(40),
  redSince: '2026-11-21T07:00:00Z',
  candidates: [],
  rerun: 'none',
  preRevertRerun: 'none',
  at: '2026-11-21T07:00:00Z',
};

const made: string[] = [];
const savedEnv = {
  root: process.env.PLOT_REPO_ROOT,
  scripts: process.env.PLOT_SCRIPTS_DIR,
  unattended: process.env.PLOT_UNATTENDED,
};
const restore = (name: string, value: string | undefined): void => {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
};

afterEach(() => {
  named.splice(0);
  merged.splice(0);
  restore('PLOT_REPO_ROOT', savedEnv.root);
  restore('PLOT_SCRIPTS_DIR', savedEnv.scripts);
  restore('PLOT_UNATTENDED', savedEnv.unattended);
  for (const dir of made.splice(0)) removeTree(dir);
});

/** A main checkout holding a red reading and a repair record, and a linked worktree with no state of its own. */
const deskOverRedMain = async (): Promise<string> => {
  const base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'plot-ask-desk-')));
  made.push(base);
  const main = path.join(base, 'main');
  fs.mkdirSync(main);
  const home = gitStateHome(main);
  execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'commit.gpgsign=false', 'commit', '-q', '--allow-empty', '-m', 'one'], { cwd: main, stdio: 'ignore' });
  const desk = path.join(main, '.worktrees', 'desk');
  execFileSync('git', ['worktree', 'add', '-q', '-b', 'slice', desk], { cwd: main, stdio: 'ignore' });
  expect((await defaultBranchFile(home).write(RED)).ok).toBe(true);
  expect((await repairRecordFile(home).write(RECORD)).ok).toBe(true);
  expect(fs.existsSync(path.join(desk, '.plot', 'state'))).toBe(false);
  process.env.PLOT_REPO_ROOT = desk;
  process.env.PLOT_SCRIPTS_DIR = REAL_SCRIPTS;
  delete process.env.PLOT_UNATTENDED;
  return desk;
};

describe('plot-ask run from a linked worktree', () => {
  it('merge reads the main checkout\'s default-branch reading and repair record', async () => {
    await deskOverRedMain();
    expect(await run(['merge', '7', SHA], HERE, vi.fn())).toBe(1);
    expect(merged).toHaveLength(1);
    expect(await merged[0]!.defaultBranch.read()).toEqual(answered(RED));
    expect(await merged[0]!.repair!.read()).toEqual(answered(RECORD));
  });

  it('repair-pr reads the main checkout\'s repair record', async () => {
    await deskOverRedMain();
    await run(['repair-pr', '2942'], HERE, vi.fn());
    expect(named).toHaveLength(1);
    expect(await named[0]!.repair.read()).toEqual(answered(RECORD));
  });
});
