import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { hostShell, prIndexFile, scriptsShell } from '@plot-pm/domain/adapters';
import { reactionTo, refusalKind } from '@plot-pm/domain';
import type { FleetReading } from '@plot-pm/domain/entities/fleet';
import type { Host, PrListing, PrListingQuery } from '@plot-pm/domain/ports/host';
import type { Refs } from '@plot-pm/domain/ports/refs';
import type { Scripts } from '@plot-pm/domain/ports/scripts';

import { freshPrState, hostReaction, refreshPrs, type PrState } from '../../src/shared/pr-refresh.js';
import { freshScanState, scanOnce, type ScanState, type ScanWorld } from '../../src/shared/fleet-scan.js';
import { emptyWalk, withWalkRefs } from './walk-fake.js';
import { removeTree } from '../rm-tree.mjs';

/**
 * THE SEAM'S PROPERTY: a caller reacts to a typed `PrListing` refusal exactly
 * as it reacted to the shell's exit code and words, so the in-process
 * transport that answers `prListing` later reaches the same backoff.
 */

const SECONDARY = 'You have exceeded a secondary rate limit. Please wait 90 seconds before retrying.';
const AUTH = 'GitHub refused the token from gh auth token (401 Bad credentials); run gh auth login';
const NOW = Date.parse('2026-11-09T12:00:00Z');

const dirs: string[] = [];

/** A scripts directory whose `plot-host.sh` refuses `pr-list` with `code` and `said`, and answers nothing else. */
const refusingShell = (code: number, said: string): string => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'plot-pr-listing-seam-'));
  dirs.push(dir);
  fs.writeFileSync(
    path.join(dir, 'plot-host.sh'),
    '#!/usr/bin/env bash\n'
    + `if [ "$1" = pr-list ]; then printf '%s\\n' ${JSON.stringify(said)} >&2; exit ${code}; fi\nexit 4\n`,
  );
  fs.chmodSync(path.join(dir, 'plot-host.sh'), 0o755);
  return dir;
};

/** A host whose `prListing` answers one typed refusal, as an in-process client would. */
const typedRefusal = (refusal: PrListing['refusal'], base: Host): Host => ({
  ...base,
  prListing: async (query: PrListingQuery): Promise<PrListing> => ({
    answer: 'failed',
    rows: [],
    complete: { [query.state]: 'possibly-truncated' },
    refusal,
  }),
});

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'], now: NOW });
});

afterEach(() => {
  vi.useRealTimers();
  for (const dir of dirs.splice(0)) removeTree(dir);
  delete process.env.PLOT_PR_INDEX_HOME;
  delete process.env.PLOT_BUDGET_HOME;
});

/** One PR pass over the given host, with the shell's scripts and a store the test owns. */
const passOver = async (dir: string, host: Host): Promise<PrState> => {
  process.env.PLOT_PR_INDEX_HOME = dir;
  process.env.PLOT_BUDGET_HOME = dir;
  const context = { repoRoot: dir, scriptDir: dir };
  const entry = freshPrState();
  entry.backend = 'github';
  await refreshPrs({ scripts: scriptsShell(context), host, store: prIndexFile({ cwd: dir }) }, entry);
  return entry;
};

describe('a refusal reaches the same backoff', () => {
  it('a typed secondary refusal sets the same backoff as the shell\'s exit 6 with the same message', async () => {
    const shellDir = refusingShell(6, SECONDARY);
    const shell = await passOver(shellDir, hostShell({ repoRoot: shellDir, scriptDir: shellDir }));
    const typedDir = refusingShell(6, SECONDARY);
    const typed = await passOver(typedDir, typedRefusal({ kind: 'secondary', said: SECONDARY }, hostShell({ repoRoot: typedDir, scriptDir: typedDir })));

    expect(shell.prError).toBe(SECONDARY);
    expect(typed.prError).toBe(SECONDARY);
    expect(typed.prNextIsBackoff).toBe(true);
    expect(typed.prNextAt).toBe(shell.prNextAt);
    expect(typed.prNextIsBackoff).toBe(shell.prNextIsBackoff);
    expect(typed.prConcurrency).toBe(shell.prConcurrency);
    expect(refusalKind(SECONDARY)).toBe('secondary');
  });

  it('a wait the connector names outside its words outranks the words', () => {
    const fromWords = hostReaction(SECONDARY, null, NOW, { kind: 'secondary' });
    const fromHeader = hostReaction(SECONDARY, null, NOW, { kind: 'secondary', waitMs: 5_000 });
    expect(fromWords?.waitMs).toBe(90_000);
    expect(fromHeader?.waitMs).toBe(5_000);
  });

  it('a typed secondary refusal opens the same scan listing backoff as the shell\'s exit 6', async () => {
    const reading: FleetReading = {
      main: 'main', head: 'abc1234', plans: [],
      summary: { plans: 0, waves: 0, branches: 0, claimed: 0, eligible: 0, blocked: 0, deferred: 0, waiting: 0, prereq_missing: 0, host: 'unknown' },
    };
    const worldOver = (host: Host): ScanWorld => ({
      repoRoot: '/repo',
      scripts: {
        stream: async (_s: string, _a: readonly string[], onLine: (line: string) => void) => onLine(JSON.stringify({ kind: 'reading', reading })),
        hostSaid: async () => ({ answer: 'unaskable', said: 'no rate in this world' }),
        config: async () => ({ ok: true, value: 'docs/plans/' }),
        planMeta: async () => ({ ok: true, value: '' }),
      } as unknown as Scripts,
      refs: withWalkRefs({ branchDates: async () => ({ ok: true, value: [] }), listBranches: async () => ({ ok: true, value: [] }) } as unknown as Partial<Refs>),
      backend: async () => 'github',
      walk: emptyWalk({ host }),
    });
    const shellDir = refusingShell(6, SECONDARY);
    const shellState: ScanState = freshScanState();
    await scanOnce(worldOver(hostShell({ repoRoot: shellDir, scriptDir: shellDir })), shellState, { record: false });
    const typedState: ScanState = freshScanState();
    await scanOnce(worldOver(typedRefusal({ kind: 'secondary', said: SECONDARY }, emptyWalk().host)), typedState, { record: false });
    expect(shellState.backoffUntil).not.toBeNull();
    expect(typedState.backoffUntil).toBe(shellState.backoffUntil);
    expect(typedState.backoffMs).toBe(shellState.backoffMs);
  });
});

describe('a refused credential is not retried', () => {
  it('a refusal of kind auth sets no retry time in reactionTo', () => {
    expect(reactionTo('auth', NOW + 600_000, NOW, 30_000)).toEqual({ waitMs: 0, stated: false, concurrencyFactor: 1, touchesCadence: false });
    expect(hostReaction(AUTH, NOW + 600_000, NOW, { kind: 'auth' })?.waitMs).toBe(0);
  });

  it('a pass refused with auth schedules no backoff and keeps the connector\'s fix as its error', async () => {
    const dir = refusingShell(3, AUTH);
    const entry = await passOver(dir, typedRefusal({ kind: 'auth', said: AUTH }, hostShell({ repoRoot: dir, scriptDir: dir })));
    expect(entry.prNextIsBackoff).toBe(false);
    expect(entry.prConcurrency).toBeNull();
    expect(entry.prError).toBe(AUTH);
  });

  it('the shell route answers auth where gh exits on a 401', async () => {
    const said = 'HTTP 401: Bad credentials (https://api.github.com/graphql)';
    const dir = refusingShell(3, said);
    const listing = await hostShell({ repoRoot: dir, scriptDir: dir }).prListing({ state: 'open' });
    expect(listing.refusal).toEqual({ kind: 'auth', said });
    expect(refusalKind(said)).toBe('auth');
  });
});
