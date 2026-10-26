import { describe, expect, it } from 'vitest';

import type { FleetReading } from '@plot-pm/domain/entities/fleet';
import type { Refs } from '@plot-pm/domain/ports/refs';
import type { Scripts } from '@plot-pm/domain/ports/scripts';

import {
  freshScanState,
  listedRowCount,
  scanListingCost,
  scanOnce,
  type ScanOptions,
  type ScanWorld,
} from '../../src/shared/fleet-scan.js';

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
