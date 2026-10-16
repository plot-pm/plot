import { describe, expect, it } from 'vitest';

import type { FleetReading } from '@plot-pm/domain/entities/fleet';
import type { Refs } from '@plot-pm/domain/ports/refs';
import type { Scripts } from '@plot-pm/domain/ports/scripts';

import { freshScanState, scanOnce, type ScanOptions, type ScanWorld } from '../../src/shared/fleet-scan.js';

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

describe('scanOnce carries streamed terminal:/listing: lines forward on a kill', () => {
  it('leaves state.terminal and state.listing non-empty after a mid-stream timeout', async () => {
    const state = freshScanState();
    const killedAfterLines: Scripts['stream'] = async (_s, _a, _onLine, options) => {
      options?.onErrorLine?.('terminal: feature/a\tMERGED\tplanOid\tmainOid');
      options?.onErrorLine?.('listing: .branches\t3');
      throw new Error('fleet scan timed out');
    };
    await expect(scanOnce(worldWith(killedAfterLines), state, OPTIONS)).rejects.toThrow();
    expect(state.terminal).toBe('feature/a\tMERGED\tplanOid\tmainOid\n');
    expect(state.listing).toBe('.branches\t3\n');
    expect(state.listingAt).not.toBeNull();
  });

  it('leaves a prior cache untouched when a kill streamed no terminal:/listing: lines at all', async () => {
    const state = freshScanState();
    state.terminal = 'feature/a\tMERGED\tplanOid\tmainOid\n';
    const killedWithNoLines: Scripts['stream'] = async () => {
      throw new Error('fleet scan timed out');
    };
    await expect(scanOnce(worldWith(killedWithNoLines), state, OPTIONS)).rejects.toThrow();
    expect(state.terminal).toBe('feature/a\tMERGED\tplanOid\tmainOid\n');
  });

  it('seeds the next scan env with the warm cache a killed scan left behind', async () => {
    const state = freshScanState();
    const killedAfterLines: Scripts['stream'] = async (_s, _a, _onLine, options) => {
      options?.onErrorLine?.('terminal: feature/a\tMERGED\tplanOid\tmainOid');
      throw new Error('fleet scan timed out');
    };
    await expect(scanOnce(worldWith(killedAfterLines), state, OPTIONS)).rejects.toThrow();
    const seenEnv: Array<Record<string, string> | undefined> = [];
    const second: Scripts['stream'] = async (_s, _a, onLine, options) => {
      seenEnv.push(options?.env);
      onLine(JSON.stringify({ kind: 'reading', reading: READING }));
    };
    await scanOnce(worldWith(second), state, OPTIONS);
    expect(seenEnv[0]?.PLOT_TERMINAL_CACHE).toBe('feature/a\tMERGED\tplanOid\tmainOid\n');
  });

  it('still throws when parsed stays null, and leaves state.pulse-adjacent fields alone', async () => {
    const state = freshScanState();
    const noTerminalLine: Scripts['stream'] = async () => undefined as never;
    await expect(scanOnce(worldWith(noTerminalLine), state, OPTIONS))
      .rejects.toThrow('fleet scan ended without a terminal pulse line');
    expect(state.terminal).toBe('');
    expect(state.listing).toBe('');
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
});
