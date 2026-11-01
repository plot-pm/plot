import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { scriptsShell } from '@plot-pm/domain/adapters';

import type { FleetReading } from '@plot-pm/domain/entities/fleet';
import type { Refs } from '@plot-pm/domain/ports/refs';
import type { Scripts } from '@plot-pm/domain/ports/scripts';

import {
  FLEET_SCAN,
  FLEET_SCAN_BUDGET_MS,
  freshScanState,
  LISTING_REFRESH_MS,
  listedRowCount,
  scanListingCost,
  scanOnce,
  type ScanOptions,
  type ScanWorld,
  withinBudget,
} from '../../src/shared/fleet-scan.js';
import { emptyWalk, withWalkRefs } from './walk-fake.js';
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
  listBranches: async () => ok([]),
  remoteUrl: async () => ok(''),
} as unknown as Refs;
const refsFakeW = withWalkRefs(refsFake as unknown as Partial<Refs>);

const worldWith = (stream: Scripts['stream']): ScanWorld => ({
  repoRoot: '/repo',
  scripts: {
    stream,
    hostSaid: async () => ({ answer: 'unaskable', stdout: '' }),
    config: async (key: string) => ok(key === 'Main branch' ? '' : 'docs/plans/'),
    planMeta: async () => ok(''),
  } as unknown as Scripts,
  refs: refsFakeW,
  backend: async () => 'github',
  walk: emptyWalk(),
});

const OPTIONS: ScanOptions = { record: false };

const noShell: Scripts['stream'] = async (script) => {
  throw new Error(`the scan spawned ${script}`);
};

/** Scripts whose every method fails when its script argument or argument list names the fleet scan. */
const scriptsRefusingTheScan = (scripts: Scripts): Scripts =>
  new Proxy(scripts, {
    get: (target, name, receiver) => {
      const member = Reflect.get(target, name, receiver) as unknown;
      if (typeof member !== 'function') return member;
      return (...args: unknown[]) => {
        if (args.some((arg) => arg === FLEET_SCAN || (Array.isArray(arg) && arg.includes(FLEET_SCAN)))) {
          throw new Error(`the scan called ${FLEET_SCAN} through ${String(name)}`);
        }
        return (member as (...a: unknown[]) => unknown).apply(target, args);
      };
    },
  });

describe('scanOnce walks the plan in process', () => {
  it('never touches plot-fleet-scan.sh, and returns the walk\'s pulse', async () => {
    const state = freshScanState();
    const world = { ...worldWith(noShell), scripts: scriptsRefusingTheScan(worldWith(noShell).scripts) };
    const result = await scanOnce(world, state, OPTIONS);
    expect(result.reading.main).toBe('main');
    expect(result.reading.plans).toEqual([]);
  });

  it('throws when a stage fails, so the bridge is never written for the beat', async () => {
    const world = { ...worldWith(noShell), refs: withWalkRefs({ resolve: async () => ({ ok: false as const, why: 'failed' as const }) } as unknown as Partial<Refs>) };
    await expect(scanOnce(world, freshScanState(), OPTIONS)).rejects.toThrow('the estate stage failed');
  });

  it('settles the listing back-off even when the walk throws', async () => {
    const world = {
      ...worldWith(noShell),
      backend: async () => 'bitbucket',
      refs: withWalkRefs({ listBranches: async () => ok([]), resolve: async () => ({ ok: false as const, why: 'failed' as const }) } as unknown as Partial<Refs>),
    };
    const state = freshScanState();
    await expect(scanOnce(world, state, OPTIONS)).rejects.toThrow();
    expect(state.backoffUntil).not.toBeNull();
  });
});

describe('withinBudget', () => {
  it('rejects once the budget runs out, leaving the hung work abandoned', async () => {
    const never = new Promise<string>(() => {});
    await expect(withinBudget(never, 20)).rejects.toThrow('timed out after 20 ms');
  });

  it('returns the value of work that finishes inside the budget', async () => {
    await expect(withinBudget(Promise.resolve('done'), 1_000)).resolves.toBe('done');
  });

  it('a hung walk ends scanOnce with a failure and leaves the next beat free to run', async () => {
    vi.useFakeTimers();
    try {
      const hung = { ...worldWith(noShell), refs: withWalkRefs({ resolve: () => new Promise(() => {}) } as unknown as Partial<Refs>) };
      const state = freshScanState();
      const outcome = scanOnce(hung, state, OPTIONS).then(() => 'resolved', (e: Error) => e.message);
      await vi.advanceTimersByTimeAsync(FLEET_SCAN_BUDGET_MS + 1);
      expect(await outcome).toContain('timed out');
      // The failed beat did not touch the carried state, and a later beat runs.
      expect(state.terminal).toBe('');
      const next = await scanOnce(worldWith(noShell), freshScanState(), OPTIONS);
      expect(next.reading.main).toBe('main');
    } finally {
      vi.useRealTimers();
    }
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

    ghAnswers(
      [ghRow(1, 'OPEN', 'feature/a', '2026-10-26T10:00:00Z')],
      [ghRow(1, 'OPEN', 'feature/a', '2026-10-26T10:00:00Z'), ghRow(2, 'MERGED', 'feature/b_x', '2026-10-25T09:00:00Z')],
      [],
    );
    await scanOnce(worldOnRealHost(noShell), state, OPTIONS);

    const first = ghCalls();
    expect(first).toHaveLength(2);
    for (const call of first) expect(call).toContain('--limit 3000');
    expect(first.join('\n')).not.toContain('updated:>');
    const full = state.listing;
    expect(full.split('\n').filter((line) => line !== '').sort()).toEqual([
      '.branches\t2\t-\t-',
      '.list-arrived\t1\t-\t-',
      '.list-complete\t1\t-\t-',
      'feature_a\tOPEN\tnone\tfalse',
      'feature_b__x\tMERGED\t-\t-',
    ]);
    expect(full.endsWith('.list-arrived\t1\t-\t-\n')).toBe(true);
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
    await scanOnce(worldOnRealHost(noShell), state, OPTIONS);

    const second = ghCalls();
    expect(second).toHaveLength(2);
    expect(second[0]).toContain('pr list --state open');
    expect(second[0]).not.toContain('updated:>');
    expect(second[1]).toContain('pr list --state all');
    expect(second[1]).toContain('--limit 3000');
    expect(second[1]).toContain('updated:>2026-10-26T09:59:00Z');
    const delta = state.listing;
    expect(delta.split('\n').filter((line) => line !== '').sort()).toEqual([
      '.branches\t3\t-\t-',
      '.list-arrived\t1\t-\t-',
      '.list-complete\t1\t-\t-',
      'feature_a\tOPEN\tnone\tfalse',
      'feature_b__x\tMERGED\t-\t-',
      'feature_c\tMERGED\t-\t-',
    ]);
    expect(state.listingHeld?.fullReadAt).toBe(fullReadAt);
  });

  it('adopts no listing, and does not throw, where a row carries no head', async () => {
    const state = freshScanState();
    const noHead = { ...ghRow(1, 'OPEN', 'feature/a', '2026-10-26T10:00:00Z'), headRefName: null };
    ghAnswers([noHead], [noHead], []);
    await scanOnce(worldOnRealHost(noShell), state, OPTIONS);
    expect(state.listing).toBe('');
    expect(state.listingHeld).toBeNull();
  });

  it('keeps an empty listing when the host cannot be asked', async () => {
    const state = freshScanState();
    await scanOnce(worldWith(noShell), state, OPTIONS);
    expect(state.listing).toBe('');
  });
});

describe('the listing base is LISTING_REFRESH_MS', () => {
  it('starts a fresh scan state at the 60 s listing base', () => {
    expect(LISTING_REFRESH_MS).toBe(60_000);
    expect(freshScanState().listingIntervalMs).toBe(LISTING_REFRESH_MS);
  });

  it('decides a due listing against the 60 s base, not the 5 s beat', async () => {
    const state = freshScanState();
    await scanOnce(worldWith(noShell), state, OPTIONS);
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
