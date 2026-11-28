import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { answered } from '@plot-pm/domain';
import { releaseHoldPersonFile } from '@plot-pm/domain/adapters';
import type { ReleaseHoldPersonRecord } from '@plot-pm/domain/entities/release-hold-person';

import { run } from '../../src/server/entry/main.js';
import { removeTree } from '../rm-tree.mjs';
import { gitStateHome } from '../state-home-root.js';

/** `plot-ask.mjs release-hold <sha>` and `release-hold-lift <sha>` over a real state home. */

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REAL_SCRIPTS = path.resolve(HERE, '../../../../skills/plot/scripts');
const HEAD = 'e150fd7c1'.padEnd(40, '0');
const HOLD: ReleaseHoldPersonRecord = { v: 1, pr: 3719, act: 'hold', head: HEAD, at: '2026-11-26T20:31:00.000Z', by: 'jwloka' };

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
  vi.restoreAllMocks();
  restore('PLOT_REPO_ROOT', savedEnv.root);
  restore('PLOT_SCRIPTS_DIR', savedEnv.scripts);
  restore('PLOT_UNATTENDED', savedEnv.unattended);
  for (const dir of made.splice(0)) removeTree(dir);
});

const repoWithHold = async (record: ReleaseHoldPersonRecord | null) => {
  const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'plot-ask-release-hold-'));
  made.push(repoRoot);
  const home = gitStateHome(repoRoot);
  if (record !== null) expect((await releaseHoldPersonFile(home).write(record)).ok).toBe(true);
  process.env.PLOT_REPO_ROOT = repoRoot;
  process.env.PLOT_SCRIPTS_DIR = REAL_SCRIPTS;
  delete process.env.PLOT_UNATTENDED;
  return releaseHoldPersonFile(home);
};

describe('plot-ask release-hold argv', () => {
  it.each([
    ['no sha', ['release-hold']],
    ['a non-hex sha', ['release-hold', 'main']],
    ['a stray argument', ['release-hold', HEAD, 'more']],
    ['--who with no name', ['release-hold-lift', HEAD, '--who']],
  ])('exits 2 with the usage line for %s', async (_name, argv) => {
    const err = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    const out = vi.fn();
    expect(await run(argv, '/nonexistent', out)).toBe(2);
    expect(err).toHaveBeenCalledWith(`usage: plot-ask.mjs ${argv[0]} <sha> [--who <name>]\n`);
    expect(out).not.toHaveBeenCalled();
  });
});

describe('plot-ask release-hold and release-hold-lift', () => {
  it.each(['release-hold', 'release-hold-lift'])('%s refuses PLOT_UNATTENDED=1, exits 1 and writes nothing', async (act) => {
    const store = await repoWithHold(HOLD);
    process.env.PLOT_UNATTENDED = '1';
    const out = vi.fn();
    expect(await run([act, HEAD], HERE, out)).toBe(1);
    expect(JSON.parse(String(out.mock.calls[0]?.[0]))).toMatchObject({ ok: false, reason: 'unattended' });
    expect(await store.read()).toEqual(answered(HOLD));
  });

  it('lifts the hold on its head in the repository\'s state home and exits 0', async () => {
    const store = await repoWithHold(HOLD);
    const out = vi.fn();
    expect(await run(['release-hold-lift', HEAD.slice(0, 9), '--who', 'eins78'], HERE, out)).toBe(0);
    expect(JSON.parse(String(out.mock.calls[0]?.[0]))).toMatchObject({ ok: true, act: 'lift', pr: 3719, head: HEAD });
    expect(await store.read()).toMatchObject(answered({ act: 'lift', head: HEAD, by: 'eins78' }));
  });

  it('refuses a lift for a head the file does not name and exits 1', async () => {
    const store = await repoWithHold(HOLD);
    expect(await run(['release-hold-lift', 'a'.repeat(40)], HERE, vi.fn())).toBe(1);
    expect(await store.read()).toEqual(answered(HOLD));
  });
});
