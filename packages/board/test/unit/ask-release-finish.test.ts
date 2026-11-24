import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, describe, expect, it, vi } from 'vitest';

import type { FinishContext, FinishOutcome } from '../../src/server/entry/release-finish.js';
import { removeTree } from '../rm-tree.mjs';

/**
 * `plot-ask.mjs release-finish <version>`. The version entry is replaced, so
 * nothing reaches git or a host: the test records what the command hands it.
 */

const calls: { ctx: FinishContext; version: string }[] = [];
let answer: FinishOutcome = { outcome: 'booked', version: 'v2.36.0', booked: ['alpha'], notes: [] };
vi.mock('../../src/server/entry/release-finish.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/server/entry/release-finish.js')>()),
  finishReleaseVersion: vi.fn(async (ctx: FinishContext, version: string) => {
    calls.push({ ctx, version });
    return answer;
  }),
}));

const { run } = await import('../../src/server/entry/main.js');

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REAL_SCRIPTS = path.resolve(HERE, '../../../../skills/plot/scripts');

const made: string[] = [];
const savedEnv = { root: process.env.PLOT_REPO_ROOT, scripts: process.env.PLOT_SCRIPTS_DIR, unattended: process.env.PLOT_UNATTENDED };
const restore = (name: string, value: string | undefined): void => {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
};

afterEach(() => {
  calls.splice(0);
  vi.restoreAllMocks();
  restore('PLOT_REPO_ROOT', savedEnv.root);
  restore('PLOT_SCRIPTS_DIR', savedEnv.scripts);
  restore('PLOT_UNATTENDED', savedEnv.unattended);
  for (const dir of made.splice(0)) removeTree(dir);
});

const aRepo = (): void => {
  const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'plot-ask-release-finish-'));
  made.push(repoRoot);
  process.env.PLOT_REPO_ROOT = repoRoot;
  process.env.PLOT_SCRIPTS_DIR = REAL_SCRIPTS;
  delete process.env.PLOT_UNATTENDED;
};

describe('plot-ask release-finish', () => {
  it('refuses PLOT_UNATTENDED=1 with exit 1 before it reads anything, even with a malformed version', async () => {
    aRepo();
    process.env.PLOT_UNATTENDED = '1';
    const err = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    for (const argv of [['release-finish', '2.36.0'], ['release-finish', 'nope']]) {
      expect(await run(argv, HERE, vi.fn())).toBe(1);
    }
    expect(err).toHaveBeenCalledWith(expect.stringContaining('plot-ask: release-finish: unattended:'));
    expect(calls).toEqual([]);
  });

  it.each([
    ['no version', ['release-finish']],
    ['a two-part version', ['release-finish', '2.36']],
    ['a word', ['release-finish', 'latest']],
    ['an extra argument', ['release-finish', '2.36.0', 'more']],
  ])('exits 2 with the usage line for %s', async (_name, argv) => {
    aRepo();
    const err = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    expect(await run(argv, HERE, vi.fn())).toBe(2);
    expect(err).toHaveBeenCalledWith('usage: plot-ask.mjs release-finish <version>\n');
    expect(calls).toEqual([]);
  });

  it.each([
    [{ outcome: 'booked', version: 'v2.36.0', booked: ['alpha'], notes: [] }, 0],
    [{ outcome: 'already-released', version: 'v2.36.0', detail: 'nothing left' }, 0],
    [{ outcome: 'refused', reason: 'tag-absent', detail: 'no tag' }, 1],
  ] as [FinishOutcome, number][])('exits per the outcome %o', async (outcome, code) => {
    aRepo();
    answer = outcome;
    expect(await run(['release-finish', '2.36.0'], HERE, vi.fn())).toBe(code);
    expect(calls.map((c) => c.version)).toEqual(['2.36.0']);
  });

  it('hands the version entry a person caller, no passkey, and a zero tag wait', async () => {
    aRepo();
    await run(['release-finish', 'v2.36.0'], HERE, vi.fn());
    expect(calls).toHaveLength(1);
    expect(calls[0]!.ctx.caller).toBe('person');
    expect(calls[0]!.ctx.tagWaitMs).toBe(0);
  });
});
