import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, describe, expect, it } from 'vitest';

import { answered, type DefaultBranchReading, type DefaultBranchStore } from '@plot-pm/domain';

import { buildBoard } from '../../src/server/board.js';
import { prsByNumber, stopFleetRefresh } from '../../src/server/fleet.js';
import { type Card } from '../../src/contract/schema.js';
import { rmTree } from '../helpers.mjs';

/**
 * `buildBoard` WIRES THE DEFAULT-BRANCH READING AND A CARD PR'S `checksSha`
 * INTO ITS OUTPUT (#1476 M1).
 *
 * Both fields were plumbed and no test read them back, so deleting either line
 * in `board.ts` left every test green. These assertions are on the RETURNED
 * board, not on "does not throw".
 */

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REAL_SCRIPTS = path.resolve(HERE, '../../../../skills/plot/scripts');

const READING: DefaultBranchReading = {
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

const CHECKS_SHA = 'a048b6f1234567890abcdef1234567890abcdef1';
// Different from CHECKS_SHA, so each assertion pins its own field.
const HEAD_SHA = 'b159c7a2345678901bcdef02345678901bcdef02';

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
  for (const dir of made.splice(0)) rmTree(dir);
});

const tmp = (prefix: string): string => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  made.push(dir);
  return dir;
};

/**
 * The real scripts directory with `plot-host.sh` replaced by one that answers
 * `pr-list` with a single open PR carrying `headSha` and `checksSha`. Everything else is a
 * symlink, so the board's plan reader still runs.
 */
const scriptsWithHost = (): string => {
  const dir = tmp('plot-board-wires-scripts-');
  for (const name of fs.readdirSync(REAL_SCRIPTS)) {
    if (name === 'plot-host.sh') continue;
    fs.symlinkSync(path.join(REAL_SCRIPTS, name), path.join(dir, name));
  }
  const row = JSON.stringify({
    number: 42, title: 'a pull request', state: 'OPEN', head: 'feature/one', draft: false,
    checks: 'failing', mergeable: 'mergeable', review: '', url: 'https://example.invalid/42',
    updatedAt: '2026-10-10T12:00:00Z', failing_checks: ['CI'], headSha: HEAD_SHA, checksSha: CHECKS_SHA,
  });
  fs.writeFileSync(
    path.join(dir, 'plot-host.sh'),
    `#!/usr/bin/env bash\nif [ "$1" = pr-list ]; then\n  printf '%s\\n' ${JSON.stringify(row)}\n  exit 0\nfi\nexit 0\n`,
  );
  fs.chmodSync(path.join(dir, 'plot-host.sh'), 0o755);
  return dir;
};

const repoWithPlan = (): string => {
  const repoRoot = tmp('plot-board-wires-repo-');
  fs.mkdirSync(path.join(repoRoot, 'docs/plans'), { recursive: true });
  fs.writeFileSync(
    path.join(repoRoot, 'docs/plans/2026-10-10-wired.md'),
    '# Wired\n\n## Status\n\n- **Phase:** Approved\n- **Type:** feature\n- **Review:** in-session\n\n'
    + '## Slices\n\n### One (Branch: feature/one, PR: #42)\n- do the thing\n',
    'utf8',
  );
  return repoRoot;
};

const until = async <T>(read: () => T | null | undefined): Promise<T> => {
  const deadline = Date.now() + 10_000;
  for (;;) {
    const value = read();
    if (value !== null && value !== undefined) return value;
    if (Date.now() > deadline) throw new Error('the PR map never landed');
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
};

describe('buildBoard wires the fixture default-branch store and the PR record into its output', () => {
  it('returns the store\'s reading as `defaultBranch` and a card PR\'s `headSha` and `checksSha`', async () => {
    const home = tmp('plot-board-wires-home-');
    process.env.PLOT_PR_INDEX_HOME = home;
    process.env.PLOT_BUDGET_HOME = home;
    const repoRoot = repoWithPlan();
    process.env.PLOT_REPO_ROOT = repoRoot;
    const opts = {
      repoRoot,
      scriptsDir: scriptsWithHost(),
      defaultBranchStore: {
        read: async () => answered(READING),
        write: async () => answered(undefined),
      } satisfies DefaultBranchStore,
    };

    // The first build starts the PR refresh and returns before it lands.
    await buildBoard(opts);
    await until(() => prsByNumber(opts)?.get(42));
    const board = await buildBoard(opts);

    expect(board.defaultBranch).toEqual(READING);
    const card = board.columns.flatMap((c) => c.cards).find((c: Card) => c.slug === 'wired');
    const pr = card?.prs.find((p) => p.number === 42);
    expect(pr?.headSha).toBe(HEAD_SHA);
    expect(pr?.checksSha).toBe(CHECKS_SHA);
  });

  it('returns no `defaultBranch` where the given store reads null (the null-store case)', async () => {
    const home = tmp('plot-board-wires-home-');
    process.env.PLOT_PR_INDEX_HOME = home;
    process.env.PLOT_BUDGET_HOME = home;
    const repoRoot = repoWithPlan();
    process.env.PLOT_REPO_ROOT = repoRoot;
    const board = await buildBoard({
      repoRoot,
      scriptsDir: scriptsWithHost(),
      defaultBranchStore: {
        read: async () => answered(null),
        write: async () => answered(undefined),
      },
    });
    expect(board.defaultBranch).toBeUndefined();
  });
});
