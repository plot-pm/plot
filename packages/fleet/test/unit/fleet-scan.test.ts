import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { scriptsShell } from '@plot-pm/domain/adapters';

import type { FleetReading } from '@plot-pm/domain/entities/fleet';
import type { Refs } from '@plot-pm/domain/ports/refs';
import type { Scripts } from '@plot-pm/domain/ports/scripts';

import {
  freshScanState,
  LISTING_REFRESH_MS,
  listedRowCount,
  scanListingCost,
  scanOnce,
  type ScanOptions,
  type ScanWorld,
} from '../../src/shared/fleet-scan.js';
import { removeTree } from '../rm-tree.mjs';

const READING: FleetReading = {
  main: 'main',
  head: 'abc1234',
  plans: [],
  summary: {
    plans: 0, waves: 0, branches: 0, claimed: 0, eligible: 0, blocked: 0, deferred: 0,
    waiting: 0, prereq_missing: 0, host: 'unknown' as const,
  },
};

const ok = <T>(value: T) => ({ ok: true as const, value });

const refsFake = {
  branchDates: async () => ok([]),
  branchTips: async () => ok([]),
  listBlobs: async () => ok([]),
  remoteUrl: async () => ok(''),
} as unknown as Refs;

const worldWith = (stream: Scripts['stream']): ScanWorld => ({
  repoRoot: '/repo',
  scripts: {
    stream,
    hostSaid: async () => ({ answer: 'unaskable', stdout: '' }),
    config: async () => ok('docs/plans/'),
    planMeta: async () => ok(''),
  } as unknown as Scripts,
  refs: refsFake,
  backend: async () => 'github',
});

const OPTIONS: ScanOptions = { record: false };

const A = 'feature/a\tMERGED\tplanOid\tmainOid';
const B = 'feature/b\tCLOSED\tplanOid\tmainOid';
const PRIOR_LISTING = '.branches\t1\t-\t-\nfeature_z\tOPEN\tgreen\tfalse\n.list-arrived\t1\t-\t-\n';

const killedAfter = (lines: string[]): Scripts['stream'] => async (_s, _a, _onLine, options) => {
  for (const line of lines) options?.onErrorLine?.(line);
  throw new Error('fleet scan timed out');
};

describe('scanOnce carries streamed terminal:/listing: lines forward on a kill', () => {
  it('adopts a killed scan\'s listing that ends with .list-arrived', async () => {
    const state = freshScanState();
    const killed = killedAfter([
      `terminal: ${A}`,
      'listing: .branches\t3\t-\t-',
      'listing: feature_a\tOPEN\tgreen\tfalse',
      'listing: .list-complete\t1\t-\t-',
      'listing: .list-arrived\t1\t-\t-',
    ]);
    await expect(scanOnce(worldWith(killed), state, OPTIONS)).rejects.toThrow();
    expect(state.terminal).toBe(`${A}\n`);
    expect(state.listing).toBe('.branches\t3\t-\t-\nfeature_a\tOPEN\tgreen\tfalse\n.list-complete\t1\t-\t-\n.list-arrived\t1\t-\t-\n');
    expect(state.listingAt).not.toBeNull();
    expect(state.listingBranches).toBe(3);
  });

  it('keeps the prior listing when a kill cuts the listing rows short', async () => {
    const state = freshScanState();
    state.listing = PRIOR_LISTING;
    state.listingAt = 1;
    state.listingBranches = 1;
    // The script's listing order: notes, rows, then `.list-arrived` last.
    const killed = killedAfter([
      'listing: .branches\t3\t-\t-',
      'listing: feature_a\tOPEN\tgreen\tfalse',
    ]);
    await expect(scanOnce(worldWith(killed), state, OPTIONS)).rejects.toThrow();
    expect(state.listing).toBe(PRIOR_LISTING);
    expect(state.listingAt).toBe(1);
    expect(state.listingBranches).toBe(1);
  });

  it('refuses a cut listing whose markers arrived before its rows', async () => {
    const state = freshScanState();
    const killed = killedAfter([
      'listing: .list-arrived\t1\t-\t-',
      'listing: .list-complete\t1\t-\t-',
      'listing: .branches\t3\t-\t-',
      'listing: feature_a\tOPEN\tgreen\tfalse',
    ]);
    await expect(scanOnce(worldWith(killed), state, OPTIONS)).rejects.toThrow();
    expect(state.listing).toBe('');
    expect(state.listingAt).toBeNull();
  });

  it('merges a killed scan\'s terminal rows into a warm cache by branch name', async () => {
    const state = freshScanState();
    state.terminal = `feature/a\tCLOSED\toldPlan\toldMain\n${B}\n`;
    const killed = killedAfter([`terminal: ${A}`, 'terminal: feature/c\tMERGED\tplanOid\tmainOid']);
    await expect(scanOnce(worldWith(killed), state, OPTIONS)).rejects.toThrow();
    expect(state.terminal).toBe(`${A}\n${B}\nfeature/c\tMERGED\tplanOid\tmainOid\n`);
  });

  it('leaves a prior cache untouched when a kill streamed no terminal:/listing: lines at all', async () => {
    const state = freshScanState();
    state.terminal = `${A}\n`;
    await expect(scanOnce(worldWith(killedAfter([])), state, OPTIONS)).rejects.toThrow();
    expect(state.terminal).toBe(`${A}\n`);
  });

  it('seeds the next scan env with the warm cache a killed scan left behind', async () => {
    const state = freshScanState();
    await expect(scanOnce(worldWith(killedAfter([`terminal: ${A}`])), state, OPTIONS)).rejects.toThrow();
    const seenEnv: Array<Record<string, string> | undefined> = [];
    const second: Scripts['stream'] = async (_s, _a, onLine, options) => {
      seenEnv.push(options?.env);
      onLine(JSON.stringify({ kind: 'reading', reading: READING }));
    };
    await scanOnce(worldWith(second), state, OPTIONS);
    expect(seenEnv[0]?.PLOT_TERMINAL_CACHE).toBe(`${A}\n`);
  });

  it('throws when the stream ends without a reading, and merges rather than replaces the terminal map', async () => {
    const state = freshScanState();
    state.terminal = `${B}\n`;
    const noReading: Scripts['stream'] = async (_s, _a, _onLine, options) => {
      options?.onErrorLine?.(`terminal: ${A}`);
    };
    await expect(scanOnce(worldWith(noReading), state, OPTIONS))
      .rejects.toThrow('fleet scan ended without a terminal pulse line');
    expect(state.terminal).toBe(`${B}\n${A}\n`);
  });

  it('replaces state.terminal with the full re-reported map on a clean run, even when empty', async () => {
    const state = freshScanState();
    state.terminal = 'stale\tMERGED\toldPlan\toldMain\n';
    const cleanWithNoTerminalBranches: Scripts['stream'] = async (_s, _a, onLine) => {
      onLine(JSON.stringify({ kind: 'reading', reading: READING }));
    };
    await scanOnce(worldWith(cleanWithNoTerminalBranches), state, OPTIONS);
    expect(state.terminal).toBe('');
  });

  it('adopts a clean run\'s listing as reported', async () => {
    const state = freshScanState();
    const clean: Scripts['stream'] = async (_s, _a, onLine, options) => {
      options?.onErrorLine?.('listing: .branches\t2\t-\t-');
      options?.onErrorLine?.('listing: .list-arrived\t1\t-\t-');
      onLine(JSON.stringify({ kind: 'reading', reading: READING }));
    };
    await scanOnce(worldWith(clean), state, OPTIONS);
    expect(state.listing).toBe('.branches\t2\t-\t-\n.list-arrived\t1\t-\t-\n');
    expect(state.listingBranches).toBe(2);
  });
});

describe('scanOnce reads the GitHub listing through plot-host.sh and records it', () => {
  // THE REAL `plot-host.sh` ANSWERS, over a stub `gh` on PATH, so the rows carry
  // `head` and the completeness claim arrives on stderr exactly as in production.
  const ROOT = fileURLToPath(new URL('../../../..', import.meta.url)).replace(/\/$/, '');
  let sandbox = '';
  let repo = '';
  let ghDir = '';

  /** One PR as `gh pr list --json` answers it. */
  const ghRow = (number: number, state: string, head: string, updatedAt: string): Record<string, unknown> => ({
    number, title: `PR ${number}`, state, headRefName: head, isDraft: false, statusCheckRollup: [],
    mergeable: 'MERGEABLE', mergeStateStatus: 'CLEAN', reviewDecision: '', url: `https://example.invalid/${number}`,
    updatedAt, author: { login: 'a' }, headRefOid: 'deadbeef', mergedAt: state === 'MERGED' ? updatedAt : null,
  });

  /** Sets what the stub `gh` answers: the open page, the whole `all` page, and the `--search updated:>` page. */
  const ghAnswers = (open: unknown[], all: unknown[], delta: unknown[]): void => {
    fs.writeFileSync(path.join(ghDir, 'open.json'), JSON.stringify(open));
    fs.writeFileSync(path.join(ghDir, 'all.json'), JSON.stringify(all));
    fs.writeFileSync(path.join(ghDir, 'delta.json'), JSON.stringify(delta));
    fs.writeFileSync(path.join(ghDir, 'calls.log'), '');
  };

  /** The `gh` calls `plot-host.sh` made since the last {@link ghAnswers}. */
  const ghCalls = (): string[] =>
    fs.readFileSync(path.join(ghDir, 'calls.log'), 'utf8').split('\n').filter((line) => line !== '');

  beforeAll(() => {
    sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'plot-fleet-scan-listing-'));
    repo = path.join(sandbox, 'repo');
    ghDir = path.join(sandbox, 'gh');
    fs.mkdirSync(repo);
    fs.mkdirSync(ghDir);
    execFileSync('git', ['init', '-q', '-b', 'main', repo]);
    fs.writeFileSync(path.join(ghDir, 'gh'), [
      '#!/usr/bin/env bash',
      'printf \'%s\\n\' "$*" >> "$GH_DIR/calls.log"',
      'case "$*" in',
      '  *"pr list --state open"*) cat "$GH_DIR/open.json"; exit 0 ;;',
      '  *"pr list --state all"*"updated:>"*) cat "$GH_DIR/delta.json"; exit 0 ;;',
      '  *"pr list --state all"*) cat "$GH_DIR/all.json"; exit 0 ;;',
      'esac',
      'echo "unexpected gh call: $*" >&2',
      'exit 1',
    ].join('\n'));
    fs.chmodSync(path.join(ghDir, 'gh'), 0o755);
  });

  afterAll(() => {
    if (sandbox !== '') removeTree(sandbox);
  });

  /** A world whose `hostSaid` runs the shipped `plot-host.sh` in the sandbox. */
  const worldOnRealHost = (stream: Scripts['stream']): ScanWorld => {
    const real = scriptsShell({ repoRoot: repo, scriptDir: path.join(ROOT, 'skills/plot/scripts') });
    const env = {
      PATH: `${ghDir}:${process.env.PATH ?? ''}`, GH_DIR: ghDir, PLOT_HOST: 'github', PLOT_BUDGET_OFF: '1',
    };
    const hostSaid: Scripts['hostSaid'] = async (args, options) =>
      args[0] === 'spend-rate'
        ? { answer: 'unaskable', said: 'no rate in this sandbox' }
        : real.hostSaid(args, { ...options, env: { ...options?.env, ...env } });
    return { ...worldWith(stream), scripts: { ...worldWith(stream).scripts, hostSaid } as unknown as Scripts };
  };

  /** A scan that records the env it was handed and streams no `listing:` lines, as a carried listing makes it. */
  const recording = (seen: Array<Record<string, string> | undefined>): Scripts['stream'] =>
    async (_s, _a, onLine, options) => {
      seen.push(options?.env);
      onLine(JSON.stringify({ kind: 'reading', reading: READING }));
    };

  it('asks with --limit, records a whole full read, then folds a --since delta over it', async () => {
    const state = freshScanState();
    const seen: Array<Record<string, string> | undefined> = [];

    ghAnswers(
      [ghRow(1, 'OPEN', 'feature/a', '2026-10-26T10:00:00Z')],
      [ghRow(1, 'OPEN', 'feature/a', '2026-10-26T10:00:00Z'), ghRow(2, 'MERGED', 'feature/b_x', '2026-10-25T09:00:00Z')],
      [],
    );
    await scanOnce(worldOnRealHost(recording(seen)), state, OPTIONS);

    const first = ghCalls();
    expect(first).toHaveLength(2);
    for (const call of first) expect(call).toContain('--limit 3000');
    expect(first.join('\n')).not.toContain('updated:>');
    const full = seen[0]?.PLOT_PR_LISTING ?? '';
    expect(full.split('\n').filter((line) => line !== '').sort()).toEqual([
      '.branches\t2\t-\t-',
      '.list-arrived\t1\t-\t-',
      '.list-complete\t1\t-\t-',
      'feature_a\tOPEN\tnone\tfalse',
      'feature_b__x\tMERGED\t-\t-',
    ]);
    expect(full.endsWith('.list-arrived\t1\t-\t-\n')).toBe(true);
    expect(state.listing).toBe(full);
    expect(state.listingAt).not.toBeNull();
    const fullReadAt = state.listingHeld?.fullReadAt ?? null;
    expect(fullReadAt).not.toBeNull();

    // The second pass is due; feature/a stays open and feature/c merged since.
    state.listingAt = 0;
    ghAnswers(
      [ghRow(1, 'OPEN', 'feature/a', '2026-10-26T10:00:00Z')],
      [],
      [ghRow(3, 'MERGED', 'feature/c', '2026-10-26T11:00:00Z')],
    );
    await scanOnce(worldOnRealHost(recording(seen)), state, OPTIONS);

    const second = ghCalls();
    expect(second).toHaveLength(2);
    expect(second[0]).toContain('pr list --state open');
    expect(second[0]).not.toContain('updated:>');
    expect(second[1]).toContain('pr list --state all');
    expect(second[1]).toContain('--limit 3000');
    expect(second[1]).toContain('updated:>2026-10-26T09:59:00Z');
    const delta = seen[1]?.PLOT_PR_LISTING ?? '';
    expect(delta.split('\n').filter((line) => line !== '').sort()).toEqual([
      '.branches\t3\t-\t-',
      '.list-arrived\t1\t-\t-',
      '.list-complete\t1\t-\t-',
      'feature_a\tOPEN\tnone\tfalse',
      'feature_b__x\tMERGED\t-\t-',
      'feature_c\tMERGED\t-\t-',
    ]);
    expect(state.listing).toBe(delta);
    expect(state.listingHeld?.fullReadAt).toBe(fullReadAt);
  });

  it('hands the shell no listing, and does not throw, where a row carries no head', async () => {
    const state = freshScanState();
    const seen: Array<Record<string, string> | undefined> = [];
    const noHead = { ...ghRow(1, 'OPEN', 'feature/a', '2026-10-26T10:00:00Z'), headRefName: null };
    ghAnswers([noHead], [noHead], []);
    await scanOnce(worldOnRealHost(recording(seen)), state, OPTIONS);
    expect(seen[0]?.PLOT_PR_LISTING).toBe('');
    expect(state.listingHeld).toBeNull();
  });

  it('falls back to handing the shell an empty PLOT_PR_LISTING, as today, when the full read also fails', async () => {
    const state = freshScanState();
    const seen: Array<Record<string, string> | undefined> = [];
    await scanOnce(worldWith(recording(seen)), state, OPTIONS);
    expect(seen[0]?.PLOT_PR_LISTING).toBe('');
  });
});

describe('the listing base is LISTING_REFRESH_MS', () => {
  it('starts a fresh scan state at the 60 s listing base', () => {
    expect(LISTING_REFRESH_MS).toBe(60_000);
    expect(freshScanState().listingIntervalMs).toBe(LISTING_REFRESH_MS);
  });

  it('decides a due listing against the 60 s base, not the 5 s beat', async () => {
    const state = freshScanState();
    const clean: Scripts['stream'] = async (_s, _a, onLine) => {
      onLine(JSON.stringify({ kind: 'reading', reading: READING }));
    };
    await scanOnce(worldWith(clean), state, OPTIONS);
    // The stub's spend-rate is unaskable, so the interval is the unstretched base.
    expect(state.listingIntervalMs).toBe(LISTING_REFRESH_MS * scanListingCost('github', 0, null));
  });
});

describe('scanListingCost on GitHub', () => {
  // gh pr list pages at 100 rows: one --state open call plus the --state all
  // pages. 100 rows is 1 page, 101 is 2 — the off-by-one at the boundary.
  it.each([
    [0, 2],
    [1, 2],
    [100, 2],
    [101, 3],
    [1_767, 19],
  ])('prices %i rows at %i requests', (rows, cost) => {
    expect(scanListingCost('github', 0, rows)).toBe(cost);
  });

  it('prices an unknown row count at 2, same as the first-page floor', () => {
    expect(scanListingCost('github', 0, null)).toBe(2);
  });
});

describe('listedRowCount', () => {
  it('counts branch lines and skips dotted notes', () => {
    const listed = '.branches\t3\t-\t-\nfeature_a\tOPEN\tgreen\tfalse\n.list-complete\t1\t-\t-\n' +
      'feature_b\tMERGED\tgreen\tfalse\n.list-arrived\t1\t-\t-\n';
    expect(listedRowCount(listed)).toBe(2);
  });

  it('counts 0 for an empty listing', () => {
    expect(listedRowCount('')).toBe(0);
  });
});
