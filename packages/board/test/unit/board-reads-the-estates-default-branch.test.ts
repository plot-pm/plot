import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, describe, expect, it } from 'vitest';

import type { DefaultBranchReading } from '@plot-pm/domain';
import { defaultBranchFile } from '@plot-pm/domain/adapters';

import { boardState } from '../../src/server/controllers/fleet-state.js';
import { askOnce } from '../../src/server/entry/ask.js';
import { boardQueryFor, mockEstate, realEstate } from '../../src/server/estate.js';
import { stopFleetRefresh } from '../../src/server/fleet.js';
import { removeTree } from '../rm-tree.mjs';

/**
 * THE BOARD READS THE DEFAULT-BRANCH READING FROM THE ESTATE THE PROCESS CHOSE
 * (#1476 L1).
 *
 * A repository holds a RED reading in `.plot/state/default-branch.json`. A
 * real estate shows it; the mock estate's null fixture hides it. Both entry
 * points that answer the board are asserted: `boardQueryFor` (which
 * `GET /api/board` calls) and `askOnce` (which `plot-ask.mjs board` calls).
 */

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REAL_SCRIPTS = path.resolve(HERE, '../../../../skills/plot/scripts');

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
  index: process.env.PLOT_PR_INDEX_HOME,
  budget: process.env.PLOT_BUDGET_HOME,
  root: process.env.PLOT_REPO_ROOT,
};
const restore = (name: string, value: string | undefined): void => {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
};

afterEach(() => {
  stopFleetRefresh();
  restore('PLOT_PR_INDEX_HOME', savedEnv.index);
  restore('PLOT_BUDGET_HOME', savedEnv.budget);
  restore('PLOT_REPO_ROOT', savedEnv.root);
  for (const dir of made.splice(0)) removeTree(dir);
});

const tmp = (prefix: string): string => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  made.push(dir);
  return dir;
};

/** The real scripts, with a `plot-host.sh` that answers nothing and reaches no host. */
const scriptsWithSilentHost = (): string => {
  const dir = tmp('plot-board-estate-scripts-');
  for (const name of fs.readdirSync(REAL_SCRIPTS)) {
    if (name === 'plot-host.sh') continue;
    fs.symlinkSync(path.join(REAL_SCRIPTS, name), path.join(dir, name));
  }
  fs.writeFileSync(path.join(dir, 'plot-host.sh'), '#!/usr/bin/env bash\nexit 0\n');
  fs.chmodSync(path.join(dir, 'plot-host.sh'), 0o755);
  return dir;
};

/** A repository with one plan and a RED default-branch reading on disk. */
const repoWithRedReading = async () => {
  const home = tmp('plot-board-estate-home-');
  process.env.PLOT_PR_INDEX_HOME = home;
  process.env.PLOT_BUDGET_HOME = home;
  const repoRoot = tmp('plot-board-estate-repo-');
  process.env.PLOT_REPO_ROOT = repoRoot;
  fs.mkdirSync(path.join(repoRoot, 'docs/plans'), { recursive: true });
  fs.writeFileSync(
    path.join(repoRoot, 'docs/plans/2026-10-10-estate.md'),
    '# Estate\n\n## Status\n\n- **Phase:** Approved\n- **Type:** feature\n',
    'utf8',
  );
  const wrote = await defaultBranchFile(repoRoot).write(RED);
  expect(wrote.ok).toBe(true);
  return { repoRoot, scriptsDir: scriptsWithSilentHost() };
};

describe('the board reads the default-branch reading from its estate', () => {
  it('a real estate shows the red reading on file (boardQueryFor)', async () => {
    const opts = await repoWithRedReading();
    const board = await boardState(boardQueryFor(opts, realEstate(opts)));
    expect(board.defaultBranch).toEqual(RED);
  });

  it('the mock estate\'s null fixture hides the red reading on file (boardQueryFor)', async () => {
    const opts = await repoWithRedReading();
    const board = await boardState(boardQueryFor(opts, mockEstate()));
    expect(board.defaultBranch).toBeUndefined();
  });

  it('a real estate shows the red reading on file (askOnce board)', async () => {
    const opts = await repoWithRedReading();
    const estate = realEstate(opts);
    const answer = await askOnce({ question: 'board', opts, ports: estate, estate: estate.source });
    expect((answer.value as { defaultBranch?: unknown }).defaultBranch).toEqual(RED);
  });

  it('the mock estate\'s null fixture hides the red reading on file (askOnce board)', async () => {
    const opts = await repoWithRedReading();
    const estate = mockEstate();
    const answer = await askOnce({ question: 'board', opts, ports: estate, estate: estate.source });
    expect((answer.value as { defaultBranch?: unknown }).defaultBranch).toBeUndefined();
  });

  it('`GET /api/board` asks through boardQueryFor with the estate the server chose', () => {
    // `index.ts` binds a port on import, so the route is asserted on its
    // source, as `exit-when-idle.test.ts` asserts the idle guard.
    const src = fs.readFileSync(path.join(HERE, '../../src/server/index.ts'), 'utf8');
    expect(src).toMatch(/boardState\(boardQueryFor\(opts, estate\)\)/);
    expect(src).toMatch(/const estate = estateFromEnv\(opts\);/);
  });
});
