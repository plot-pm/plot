import { describe, expect, it } from 'vitest';
import type { FixerAttemptsRecord } from '../src/entities/fixer-attempts.js';
import { roleChip, roleRuns, type RoleReadings } from '../src/rules/agent-roles.js';
import type { AgentRole } from '../src/rules/delivery-placement.js';
import { REVIEW_START_GRACE_MS } from '../src/rules/review-run.js';

const NOW = 1_000_000_000;

const record = (inFlight?: { pid: number; startedAt: string }): FixerAttemptsRecord =>
  ({ v: 1, attempts: [{ headSha: 'abc', finding: { kind: 'ci', runId: 'r0' }, ...(inFlight === undefined ? {} : { inFlight }) }] }) as unknown as FixerAttemptsRecord;

const live = (over: Partial<RoleReadings> = {}): RoleReadings => ({
  reviews: [{ entry: { pr: 7, head: 'abcdef123', pid: 5, startedAt: NOW - 1000, mode: 'review' }, pidAlive: true }],
  fixers: [{ pr: 8, record: record({ pid: 6, startedAt: '2026-11-17T10:00:00Z' }) }],
  design: { running: ['plan-d'] },
  verify: { running: ['plan-v'] },
  now: NOW,
  ...over,
});

describe('roleRuns', () => {
  it('yields one agent per source with its role and no others', () => {
    const runs = roleRuns(live());
    expect(runs.map((r) => [r.role, r.pr ?? r.plan])).toEqual([
      ['reviewer', 7], ['fixer', 8], ['design', 'plan-d'], ['verify', 'plan-v'],
    ]);
  });

  it('takes the reviewer start from the entry and the fixer start from the mark', () => {
    const [reviewer, fixer] = roleRuns(live());
    expect(reviewer!.startedAt).toBe(NOW - 1000);
    expect(fixer!.startedAt).toBe(Date.parse('2026-11-17T10:00:00Z'));
  });

  it('shows a stopped design or verify run once, with what the pass recorded', () => {
    const stopped = { reason: 'failed 3 times', restart: '/plot-deliver --verify plan-s', log: '/r/log' };
    const runs = roleRuns({
      ...live(),
      design: { running: ['plan-d'], stopped: [{ plan: 'plan-d', ...stopped }, { plan: 'plan-x', ...stopped }] },
      verify: { running: [], stopped: [{ plan: 'plan-s', ...stopped }] },
    });
    expect(runs.filter((r) => r.role === 'design').map((r) => [r.id, r.stopped])).toEqual([
      ['agent:design:plan-d', undefined],
      ['agent:design:plan-x', stopped],
    ]);
    expect(runs.filter((r) => r.role === 'verify').map((r) => [r.id, r.stopped])).toEqual([['agent:verify:plan-s', stopped]]);
  });

  it('gives design and verify a null start', () => {
    const [, , design, verify] = roleRuns(live());
    expect(design!.startedAt).toBeNull();
    expect(verify!.startedAt).toBeNull();
  });

  it('shows no reviewer for a dead pid past the start grace', () => {
    const dead = { entry: { pr: 7, head: 'abcdef123', pid: 5, startedAt: NOW - REVIEW_START_GRACE_MS - 1, mode: 'review' as const }, pidAlive: false };
    expect(roleRuns(live({ reviews: [dead] })).filter((r) => r.role === 'reviewer')).toEqual([]);
  });

  it('shows a reviewer whose pid is dead inside the start grace', () => {
    const young = { entry: { pr: 7, head: 'abcdef123', pid: 5, startedAt: NOW - 1, mode: 'review' as const }, pidAlive: false };
    expect(roleRuns(live({ reviews: [young] })).filter((r) => r.role === 'reviewer')).toHaveLength(1);
  });

  it('keeps a fixer whose mark start does not parse, with no start time', () => {
    const fixers = [{ pr: 8, record: record({ pid: 6, startedAt: 'not a time' }) }];
    expect(roleRuns(live({ fixers })).find((r) => r.role === 'fixer')!.startedAt).toBeNull();
  });

  it('shows no fixer for an attempt record with no inFlight mark', () => {
    expect(roleRuns(live({ fixers: [{ pr: 8, record: record() }] })).filter((r) => r.role === 'fixer')).toEqual([]);
  });

  it('shows no fixer for a missing or unreadable record', () => {
    const fixers = [{ pr: 8, record: 'none' as const }, { pr: 9, record: 'unreadable' as const }];
    expect(roleRuns(live({ fixers })).filter((r) => r.role === 'fixer')).toEqual([]);
  });

  it.each(['reviews', 'fixers', 'design', 'verify'] as const)('an unread %s source drops only its own role', (source) => {
    const roles = roleRuns(live({ [source]: null })).map((r) => r.role);
    const want = { reviews: 'reviewer', fixers: 'fixer', design: 'design', verify: 'verify' }[source];
    expect(roles).not.toContain(want);
    expect(roles).toHaveLength(3);
  });

  it('gives each run a distinct id', () => {
    const ids = roleRuns(live()).map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('roleChip', () => {
  const roles: AgentRole[] = ['loop', 'fixer', 'reviewer', 'approver', 'idea', 'brief', 'design', 'verify'];

  it.each(roles)('names the %s chip', (role) => {
    const chip = roleChip(role);
    expect(chip.label).toBe(role);
    expect(chip.name).toBe(`Agent role: ${role}`);
    expect(chip.colour).toBeTruthy();
  });

  it('gives the eight roles eight distinct colour keys', () => {
    expect(new Set(roles.map((r) => roleChip(r).colour)).size).toBe(8);
  });
});

describe('roleRuns: a fixer run\'s attempt', () => {
  const att = (kind: 'ci' | 'high', extra: Record<string, unknown> = {}) => ({
    headSha: 'abc',
    finding: kind === 'ci' ? { kind, runId: 'r1' } : { kind, hash: 'h1' },
    ...extra,
  });
  const flying = { inFlight: { pid: 6, startedAt: '2026-11-17T10:00:00Z' } };
  const fixerOf = (attempts: unknown[]) =>
    roleRuns(live({ fixers: [{ pr: 8, record: { v: 1, pr: 8, attempts } as unknown as FixerAttemptsRecord }] })).find((r) => r.role === 'fixer');

  it('counts the in-flight attempt itself, so a first start reads 1', () => {
    expect(fixerOf([att('ci', flying)])?.attempt).toBe(1);
  });

  it('counts on the kind in flight, not over every attempt', () => {
    expect(fixerOf([att('ci'), att('high', flying)])?.attempt).toBe(1);
    expect(fixerOf([att('ci'), att('ci', flying)])?.attempt).toBe(2);
  });

  it('spends nothing on an attempt whose start failed', () => {
    expect(fixerOf([att('high', { start: 'failed' }), att('high', flying)])?.attempt).toBe(1);
  });

  it('leaves the attempt absent where nothing counts, never 0', () => {
    const run = fixerOf([att('ci', { ...flying, start: 'failed' })]);
    expect(run).toBeDefined();
    expect(run).not.toHaveProperty('attempt');
  });

  it('puts the attempt on the fixer run and on no other run', () => {
    const runs = roleRuns(live({ fixers: [{ pr: 8, record: { v: 1, pr: 8, attempts: [att('ci', flying)] } as unknown as FixerAttemptsRecord }] }));
    expect(runs.map((r) => [r.role, r.attempt])).toEqual([
      ['reviewer', undefined], ['fixer', 1], ['design', undefined], ['verify', undefined],
    ]);
  });
});

describe('roleRuns: a fixer run\'s finding', () => {
  const flying = { inFlight: { pid: 6, startedAt: '2026-11-17T10:00:00Z' } };
  const findings = {
    high: { kind: 'high', hash: 'h1' },
    ci: { kind: 'ci', runId: 'r1' },
    conflict: { kind: 'conflict', head: 'abc', baseTip: 'def' },
  } as const;
  const runsOf = (kind: keyof typeof findings) =>
    roleRuns(live({ fixers: [{ pr: 8, record: { v: 1, pr: 8, attempts: [{ headSha: 'abc', finding: findings[kind], ...flying }] } as unknown as FixerAttemptsRecord }] }));

  it.each(['high', 'ci', 'conflict'] as const)('carries the in-flight attempt\'s kind %s', (kind) => {
    expect(runsOf(kind).find((r) => r.role === 'fixer')?.finding).toBe(kind);
  });

  it('reads the kind of the attempt in flight, not of an earlier one', () => {
    const runs = roleRuns(live({ fixers: [{ pr: 8, record: { v: 1, pr: 8, attempts: [
      { headSha: 'abc', finding: findings.ci },
      { headSha: 'abc', finding: findings.conflict, ...flying },
    ] } as unknown as FixerAttemptsRecord }] }));
    expect(runs.find((r) => r.role === 'fixer')?.finding).toBe('conflict');
  });

  it('leaves the finding absent on every other run', () => {
    for (const run of runsOf('conflict').filter((r) => r.role !== 'fixer')) expect(run).not.toHaveProperty('finding');
  });
});
