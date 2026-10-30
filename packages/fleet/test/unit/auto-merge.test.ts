// The merge tick: one passed slice PR merges per pass, and the memory of a host refusal holds.
import { describe, expect, it } from 'vitest';
import type { MergePorts } from '@plot-pm/domain/workflows/merge';
import type { DefaultBranchReading } from '@plot-pm/domain/entities/default-branch';
import type { PrIndexRow } from '@plot-pm/domain/entities/pr-index';
import { mergeTick, type MergeRefusals } from '../../src/shared/auto-merge.js';

const TIP = 'c'.repeat(40);
const NOW = Date.parse('2026-10-30T12:00:00Z');
const WAIT = 3_600_000;

const head = (n: number): string => String(n).repeat(40).slice(0, 40);

const row = (n: number, over: Partial<PrIndexRow> = {}): PrIndexRow => ({
  number: n,
  head: `feature/p${n}`,
  state: 'OPEN',
  draft: false,
  checks: 'green',
  review: '',
  url: 'u',
  headSha: head(n),
  checksSha: head(n),
  ciChecks: 'green',
  plotReview: 'success',
  plotReviewSha: head(n),
  ...over,
});

const reading = (over: Partial<DefaultBranchReading> = {}): DefaultBranchReading => ({
  v: 1,
  branch: 'main',
  headSha: TIP,
  head: 'green',
  settled: { sha: TIP, state: 'green' },
  failingRuns: [],
  headSince: '2026-10-30T11:00:00Z',
  askedAt: '2026-10-30T11:55:00Z',
  at: '2026-10-30T11:55:00Z',
  ...over,
});

const readings = (over: Record<string, unknown> = {}) =>
  ({
    newestMerged: null,
    scope: { read: 'scope', sprint: {}, slugs: ['x'], branches: ['feature/p3', 'feature/p5'] },
    verdict: { read: 'absent' },
    defaultBranch: reading(),
    desk: { dead: false, why: 'live' },
    config: { autoReview: true, reviewBoundMs: 0, startBudget: 3, checksWaitMs: WAIT },
    now: NOW,
    ...over,
  }) as never;

const portsFor = (said: 'answered' | 'failed') => {
  const calls: string[][] = [];
  const ports = {
    host: {
      backend: async () => ({ ok: true, value: 'github' }),
      prState: async (n: number) => ({
        ok: true,
        value: {
          number: n, repo: '', head: `feature/p${n}`, base: 'main', state: 'OPEN', mergedAt: null, mergeCommit: '',
          draft: false, mergeable: 'mergeable', review: '', checks: 'green', failingChecks: [],
          url: '', author: '', headSha: head(n), checksSha: head(n),
        },
      }),
      prReview: async (n: number) => ({
        ok: true,
        value: { sha: head(n), state: 'success', description: '', time: '', bypass: false },
      }),
    },
    scripts: {
      hostSaid: async (args: string[]) => {
        calls.push(args);
        return { answer: said, said: said === 'answered' ? '' : 'refused' };
      },
    },
    defaultBranch: { read: async () => ({ ok: true, value: reading() }) },
    refs: { remoteSha: async () => ({ ok: true, value: { sha: TIP } }) },
    checksWaitMs: WAIT,
    now: () => NOW,
    requireReading: true,
    caller: 'fleetd',
  } as unknown as MergePorts;
  return { ports, calls };
};

const tick = (rows: PrIndexRow[], over: Record<string, unknown>, p: MergePorts, refused: MergeRefusals = new Map()) =>
  mergeTick(rows, readings(over), p, refused, '/nowhere', () => false);

describe('mergeTick', () => {
  it('merges exactly one of two mergeable PRs, the lower number', async () => {
    const { ports, calls } = portsFor('answered');
    const out = await tick([row(5), row(3)], {}, ports);
    expect(calls).toEqual([['pr-merge', '3', '--match-head', head(3)]]);
    expect(out.merged).toMatchObject({ pr: 3, result: { merged: true } });
  });

  it('merges nothing on a pass right after a merge: the tip moved, the reading did not refresh', async () => {
    const { ports, calls } = portsFor('answered');
    const out = await tick([row(5)], { newestMerged: { mergedAt: '2026-10-30T11:58:00Z' } }, ports);
    expect(calls).toEqual([]);
    expect(out.merged).toBeUndefined();
    expect(out.steps).toEqual([{ pr: 5, step: { step: 'hold', reason: 'merge-in-flight' } }]);
  });

  it('does not retry a host-refused merge at the same head, and tries the next PR', async () => {
    const { ports, calls } = portsFor('failed');
    const refused: MergeRefusals = new Map();
    await tick([row(3), row(5)], {}, ports, refused);
    expect(refused.get(3)).toBe(head(3));
    await tick([row(3), row(5)], {}, ports, refused);
    expect(calls.map((c) => c[1])).toEqual(['3', '5']);
  });

  it('retries once the head moves', async () => {
    const { ports, calls } = portsFor('failed');
    const refused: MergeRefusals = new Map([[3, 'f'.repeat(40)]]);
    await tick([row(3)], {}, ports, refused);
    expect(calls.map((c) => c[1])).toEqual(['3']);
  });

  it('merges nothing where Merger app is missing on GitHub', async () => {
    const { ports, calls } = portsFor('answered');
    await tick([row(3)], { mergerAppMissing: true }, ports);
    expect(calls).toEqual([]);
  });
});

describe('mergeTick on a red default branch', () => {
  const LAST_GREEN = 'e'.repeat(40);
  const FIRST_RED = 'f'.repeat(40);
  const REPAIR_BRANCH = `bug/main-repair-${LAST_GREEN.slice(0, 12)}`;
  const red = reading({ head: 'red', settled: { sha: TIP, state: 'red' } });
  const record = {
    v: 1, branch: 'main', state: 'repairing', lastGreenSha: LAST_GREEN, firstRedSha: FIRST_RED,
    redSince: '2026-10-30T10:00:00Z', candidates: [], rerun: 'asked', preRevertRerun: 'none', repairPr: 5,
    at: '2026-10-30T10:00:00Z',
  };

  const redPorts = (runs: 'failure' | 'success' = 'failure') => {
    const { ports, calls } = portsFor('answered');
    const asked: string[] = [];
    const base = ports as unknown as Record<string, unknown>;
    const host = base.host as Record<string, unknown>;
    const prState = host.prState as (n: number) => Promise<{ ok: true; value: Record<string, unknown> }>;
    const withRepairHead = {
      ...base,
      host: {
        ...host,
        prState: async (n: number) => {
          const out = await prState(n);
          return { ...out, value: { ...out.value, head: n === 5 ? REPAIR_BRANCH : out.value.head } };
        },
      },
      defaultBranch: { read: async () => ({ ok: true, value: red }) },
      refs: {
        remoteSha: async () => ({ ok: true, value: { sha: TIP } }),
        firstParentLine: async () => ({ ok: true, value: [TIP, FIRST_RED, LAST_GREEN] }),
      },
      repair: { read: async () => ({ ok: true, value: record }) },
      build: {
        runsForSha: async (branch: string, sha: string) => {
          asked.push(`${branch} ${sha}`);
          return { ok: true, value: [{ sha, status: 'completed', conclusion: runs, url: '', workflow: 'CI' }] };
        },
      },
      checks: ['CI'],
    } as unknown as MergePorts;
    return { ports: withRepairHead, calls, asked };
  };
  const rows = [row(3), row(5, { head: REPAIR_BRANCH })];
  const scope = { read: 'scope', sprint: {}, slugs: ['x'], branches: ['feature/p3'] };
  const redTick = (p: MergePorts) => tick(rows, { defaultBranch: red, scope }, p);

  it('picks the repair PR while every other open row holds default-branch-red', async () => {
    const { ports, calls } = redPorts();
    const out = await redTick(ports);
    expect(out.steps).toEqual([
      { pr: 3, step: { step: 'hold', reason: 'default-branch-red' } },
      { pr: 5, step: { step: 'merge', head: head(5) } },
    ]);
    expect(calls).toEqual([['pr-merge', '5', '--match-head', head(5)]]);
    expect(out.merged).toMatchObject({ pr: 5, result: { merged: true } });
  });

  it('asks the red commit’s runs once for the tick, not once per row', async () => {
    const { ports, asked } = redPorts();
    await redTick(ports);
    // The tick's one ask, plus mergeAt's own re-ask immediately before the merge.
    expect(asked).toEqual([`main ${TIP}`, `main ${TIP}`]);
  });

  it('merges nothing where the re-asked runs read green', async () => {
    const { ports, calls } = redPorts('success');
    const out = await redTick(ports);
    expect(out.steps[1]).toEqual({ pr: 5, step: { step: 'hold', reason: 'repair-red-unconfirmed' } });
    expect(calls).toEqual([]);
    expect(out.merged).toBeUndefined();
  });

  it('merges nothing where the record names no open row', async () => {
    const { ports, calls, asked } = redPorts();
    const out = await tick([row(3)], { defaultBranch: red, scope }, ports);
    expect(out.steps).toEqual([{ pr: 3, step: { step: 'hold', reason: 'default-branch-red' } }]);
    expect(calls).toEqual([]);
    expect(asked).toEqual([]);
  });
});
