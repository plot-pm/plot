import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, describe, expect, it, vi } from 'vitest';

import type { DefaultBranchReading, DefaultBranchStore } from '@plot-pm/domain';
import { answered } from '@plot-pm/domain';
import { defaultBranchFile } from '@plot-pm/domain/adapters';

import type { MergePorts } from '../../src/server/entry/merge.js';
import { removeTree } from '../rm-tree.mjs';

/**
 * `plot-ask.mjs merge` READS THE DEFAULT-BRANCH STORE OF THE REAL ESTATE
 * (#1476 L1).
 *
 * `mergeAt` is replaced, so no merge runs: the test captures the ports the
 * entry hands it. The merge always reads the real estate, also under
 * `PLOT_BOARD_MOCK`, because it reaches the real host.
 */

const captured: MergePorts[] = [];
vi.mock('../../src/server/entry/merge.js', () => ({
  mergeAt: vi.fn(async (ports: MergePorts) => {
    captured.push(ports);
    return { merged: false, reason: 'host-refused', detail: 'stubbed' };
  }),
}));

const SENTINEL: DefaultBranchStore = {
  read: async () => answered(null),
  write: async () => answered(undefined),
};
let replaceStore = false;
vi.mock('../../src/server/estate.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/server/estate.js')>();
  return {
    ...actual,
    realEstate: (opts: Parameters<typeof actual.realEstate>[0]) => {
      const estate = actual.realEstate(opts);
      return replaceStore ? { ...estate, defaultBranch: SENTINEL } : estate;
    },
  };
});

const { run } = await import('../../src/server/entry/main.js');

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REAL_SCRIPTS = path.resolve(HERE, '../../../../skills/plot/scripts');
const SHA = 'a'.repeat(40);

const RED: DefaultBranchReading = {
  v: 1,
  branch: 'main',
  headSha: 'c'.repeat(40),
  head: 'red',
  settled: { sha: 'abc1234567890', state: 'red' },
  failingRuns: [],
  headSince: '2026-10-10T14:00:00.000Z',
  askedAt: '2026-10-10T14:02:00.000Z',
  at: '2026-10-10T14:02:00.000Z',
};

const made: string[] = [];
const savedEnv = {
  root: process.env.PLOT_REPO_ROOT,
  scripts: process.env.PLOT_SCRIPTS_DIR,
  mock: process.env.PLOT_BOARD_MOCK,
};
const restore = (name: string, value: string | undefined): void => {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
};

afterEach(() => {
  captured.splice(0);
  replaceStore = false;
  restore('PLOT_REPO_ROOT', savedEnv.root);
  restore('PLOT_SCRIPTS_DIR', savedEnv.scripts);
  restore('PLOT_BOARD_MOCK', savedEnv.mock);
  for (const dir of made.splice(0)) removeTree(dir);
});

const repoWithRedReading = async (): Promise<string> => {
  const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'plot-merge-estate-repo-'));
  made.push(repoRoot);
  expect((await defaultBranchFile(repoRoot).write(RED)).ok).toBe(true);
  process.env.PLOT_REPO_ROOT = repoRoot;
  process.env.PLOT_SCRIPTS_DIR = REAL_SCRIPTS;
  return repoRoot;
};

const mergeOnce = async (): Promise<MergePorts> => {
  const out = vi.fn();
  expect(await run(['merge', '7', SHA], HERE, out)).toBe(1);
  expect(captured).toHaveLength(1);
  return captured[0]!;
};

describe('plot-ask merge reads the real estate\'s default-branch store', () => {
  it('hands mergeAt the store the real estate holds', async () => {
    await repoWithRedReading();
    replaceStore = true;
    const ports = await mergeOnce();
    expect(ports.defaultBranch).toBe(SENTINEL);
  });

  it('the real estate\'s store reads the red reading on file', async () => {
    await repoWithRedReading();
    const ports = await mergeOnce();
    expect(await ports.defaultBranch.read()).toEqual(answered(RED));
  });

  it('reads the red reading on file under PLOT_BOARD_MOCK too', async () => {
    await repoWithRedReading();
    process.env.PLOT_BOARD_MOCK = '1';
    const ports = await mergeOnce();
    expect(await ports.defaultBranch.read()).toEqual(answered(RED));
  });
});
