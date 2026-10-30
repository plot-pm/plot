import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { answered } from '@plot-pm/domain';
import { repairRecordFile } from '@plot-pm/domain/adapters';
import { REPAIR_RECORD_VERSION, type RepairRecord } from '@plot-pm/domain/entities/repair-record';

import type { MergePorts, NameRepairPrPorts } from '../../src/server/entry/merge.js';
import { removeTree } from '../rm-tree.mjs';

/**
 * `plot-ask.mjs repair-pr <pr>` and the repair ports `plot-ask.mjs merge`
 * hands `mergeAt`. Both workflows are replaced, so nothing reaches a host:
 * the test captures the ports the entry builds.
 */

const named: NameRepairPrPorts[] = [];
const merged: MergePorts[] = [];
vi.mock('../../src/server/entry/merge.js', () => ({
  nameRepairPrAt: vi.fn(async (ports: NameRepairPrPorts, pr: number) => {
    named.push(ports);
    return pr === 2942 ? { named: true, pr, branch: 'bug/main-repair-aaaaaaaaaaaa' } : { named: false, reason: 'pr-not-open', detail: 'stubbed' };
  }),
  mergeAt: vi.fn(async (ports: MergePorts) => {
    merged.push(ports);
    return { merged: false, reason: 'host-refused', detail: 'stubbed' };
  }),
}));

const { run } = await import('../../src/server/entry/main.js');

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REAL_SCRIPTS = path.resolve(HERE, '../../../../skills/plot/scripts');

const RECORD: RepairRecord = {
  v: REPAIR_RECORD_VERSION,
  branch: 'main',
  state: 'idle',
  lastGreenSha: 'a'.repeat(40),
  firstRedSha: 'b'.repeat(40),
  redSince: '2026-10-30T07:00:00Z',
  candidates: [],
  rerun: 'none',
  preRevertRerun: 'none',
  at: '2026-10-30T07:00:00Z',
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
  vi.restoreAllMocks();
  restore('PLOT_REPO_ROOT', savedEnv.root);
  restore('PLOT_SCRIPTS_DIR', savedEnv.scripts);
  restore('PLOT_UNATTENDED', savedEnv.unattended);
  for (const dir of made.splice(0)) removeTree(dir);
});

const repoWithRecord = async (): Promise<string> => {
  const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'plot-ask-repair-pr-'));
  made.push(repoRoot);
  expect((await repairRecordFile(repoRoot).write(RECORD)).ok).toBe(true);
  process.env.PLOT_REPO_ROOT = repoRoot;
  process.env.PLOT_SCRIPTS_DIR = REAL_SCRIPTS;
  delete process.env.PLOT_UNATTENDED;
  return repoRoot;
};

describe('plot-ask repair-pr argv', () => {
  it.each([
    ['no pr', ['repair-pr']],
    ['a non-numeric pr', ['repair-pr', 'abc']],
    ['a pr with trailing text', ['repair-pr', '7x']],
    ['an extra argument', ['repair-pr', '7', 'more']],
  ])('exits 2 with the usage line for %s', async (_name, argv) => {
    const err = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    const out = vi.fn();
    expect(await run(argv, '/nonexistent', out)).toBe(2);
    expect(err).toHaveBeenCalledWith('usage: plot-ask.mjs repair-pr <pr>\n');
    expect(out).not.toHaveBeenCalled();
    expect(named).toEqual([]);
  });
});

describe('plot-ask repair-pr', () => {
  it('prints the JSON line and exits 0 when the record names the PR', async () => {
    await repoWithRecord();
    const out = vi.fn();
    expect(await run(['repair-pr', '2942'], HERE, out)).toBe(0);
    expect(out).toHaveBeenCalledWith('{"named":true,"pr":2942,"branch":"bug/main-repair-aaaaaaaaaaaa"}\n');
  });

  it('exits 1 on a refusal', async () => {
    await repoWithRecord();
    expect(await run(['repair-pr', '7'], HERE, vi.fn())).toBe(1);
  });

  it('hands the workflow the record file of the repository and a person caller', async () => {
    await repoWithRecord();
    await run(['repair-pr', '2942'], HERE, vi.fn());
    expect(named).toHaveLength(1);
    expect(named[0]!.caller).toBe('person');
    expect(await named[0]!.repair.read()).toEqual(answered(RECORD));
  });

  it('hands the workflow the unattended caller under PLOT_UNATTENDED=1', async () => {
    await repoWithRecord();
    process.env.PLOT_UNATTENDED = '1';
    await run(['repair-pr', '2942'], HERE, vi.fn());
    expect(named[0]!.caller).toBe('unattended');
  });
});

describe('plot-ask merge hands mergeAt the repair ports', () => {
  it('passes the repository\'s record file, a CI connector and the declared checks', async () => {
    await repoWithRecord();
    expect(await run(['merge', '7', 'a'.repeat(40)], HERE, vi.fn())).toBe(1);
    expect(merged).toHaveLength(1);
    const ports = merged[0]!;
    expect(await ports.repair!.read()).toEqual(answered(RECORD));
    expect(typeof ports.build!.runsForSha).toBe('function');
    expect(Array.isArray(ports.checks)).toBe(true);
  });
});
