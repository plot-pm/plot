import { describe, expect, it } from 'vitest';

import type { DefaultBranchReading } from '../src/entities/default-branch.js';
import { findingKey, type Finding } from '../src/entities/finding.js';
import type { PrIndex, PrIndexRow } from '../src/entities/pr-index.js';
import {
  MERGED_WINDOW_MS,
  diffFindings,
  indexFindings,
  type IndexReadings,
} from '../src/rules/index-findings.js';

const NOW = '2026-10-10T12:00:00Z';
const hoursAgo = (h: number): string => new Date(Date.parse(NOW) - h * 3_600_000).toISOString();

const row = (over: Partial<PrIndexRow> = {}): PrIndexRow => ({
  number: 1,
  head: 'feature/one',
  state: 'OPEN',
  draft: false,
  checks: 'green',
  review: 'none',
  url: 'https://example.test/pull/1',
  headSha: 'aaa',
  headSince: '2026-10-10T09:00:00Z',
  checksSha: 'aaa',
  ...over,
});

const indexOf = (rows: PrIndexRow[], over: Partial<PrIndex> = {}): PrIndex =>
  ({
    v: 4,
    connector: 'github',
    watermark: null,
    complete: true,
    at: '2026-10-10T11:00:00Z',
    wholeAt: '2026-10-10T11:00:00Z',
    rows,
    ...over,
  }) as PrIndex;

const red = (over: Partial<DefaultBranchReading> = {}): DefaultBranchReading => ({
  v: 1,
  branch: 'main',
  headSha: 'm1',
  head: 'pending',
  settled: { sha: 'm1', state: 'red' },
  failingRuns: [{ workflow: 'CI', conclusion: 'failure', url: 'https://example.test/run/1' }],
  headSince: '2026-10-10T08:00:00Z',
  askedAt: NOW,
  at: NOW,
  ...over,
});

const readings = (over: Partial<IndexReadings> = {}): IndexReadings => ({
  index: indexOf([row()]),
  defaultBranch: null,
  now: NOW,
  sliceBranches: new Set(['feature/one', 'feature/two', 'feature/three']),
  ...over,
});

const names = (r: IndexReadings): string[] =>
  indexFindings(r).findings.map((f) => `${f.branch}:${f.finding}`);

describe('indexFindings — what the index says holds now', () => {
  it('reads green checks on an open slice PR as `checks green`, with the commit the checks name', () => {
    const [f] = indexFindings(readings()).findings;
    expect(f).toMatchObject({
      monitor: 'IndexMonitor',
      branch: 'feature/one',
      finding: 'checks green',
      since: '2026-10-10T09:00:00Z',
    });
    expect(f!.evidence).toBe('pull request #1, on aaa');
  });

  it('reads failing checks as `checks failing` and names the failing checks', () => {
    const [f] = indexFindings(readings({ index: indexOf([row({ checks: 'failing', failing_checks: ['lint', 'unit'] })]) })).findings;
    expect(f!.finding).toBe('checks failing');
    expect(f!.evidence).toBe('pull request #1, on aaa; failing: lint, unit');
  });

  it.each(['pending', 'none', 'unknown'])('holds no finding for %s checks', (checks) => {
    expect(names(readings({ index: indexOf([row({ checks })]) }))).toEqual([]);
  });

  it('says so when the checks are not bound to the head commit', () => {
    const [f] = indexFindings(readings({ index: indexOf([row({ checksSha: 'old', headSha: 'new' })]) })).findings;
    expect(f!.evidence).toBe('pull request #1, for old, head new');
    const [g] = indexFindings(readings({ index: indexOf([row({ checksSha: undefined })]) })).findings;
    expect(g!.evidence).toBe('pull request #1, the checks are not bound to a commit; head aaa');
  });

  it('ignores a PR whose branch no plan names', () => {
    expect(names(readings({ sliceBranches: new Set(['feature/other']) }))).toEqual([]);
  });

  it('ignores a row whose head the host omitted', () => {
    expect(names(readings({ index: indexOf([row({ head: '' })]), sliceBranches: new Set(['']) }))).toEqual([]);
  });

  it('publishes `pr merged` for a merge inside the window', () => {
    const f = indexFindings(readings({ index: indexOf([row({ state: 'MERGED', mergedAt: hoursAgo(2) })]) })).findings;
    expect(f).toHaveLength(1);
    expect(f[0]).toMatchObject({ finding: 'pr merged', since: hoursAgo(2), evidence: 'pull request #1 merged' });
  });

  it('holds no `pr merged` for a merge 25 h ago, and keeps the window at 24 h', () => {
    expect(MERGED_WINDOW_MS).toBe(24 * 3_600_000);
    expect(names(readings({ index: indexOf([row({ state: 'MERGED', mergedAt: hoursAgo(25) })]) }))).toEqual([]);
    expect(names(readings({ index: indexOf([row({ state: 'MERGED', mergedAt: hoursAgo(23.9) })]) }))).toEqual([
      'feature/one:pr merged',
    ]);
  });

  it('reads a merged row with no mergedAt as no finding', () => {
    expect(names(readings({ index: indexOf([row({ state: 'MERGED' })]) }))).toEqual([]);
  });

  it('lets `pr merged` outrank an open PR on the same branch, in one slot', () => {
    const rows = [row({ number: 1, checks: 'failing' }), row({ number: 2, state: 'MERGED', mergedAt: hoursAgo(1) })];
    expect(names(readings({ index: indexOf(rows) }))).toEqual(['feature/one:pr merged']);
  });

  it('publishes one finding per branch, so a failing branch leaves a green one alone', () => {
    const rows = [row(), row({ number: 2, head: 'feature/two', checks: 'failing' })];
    expect(names(readings({ index: indexOf(rows) }))).toEqual([
      'feature/one:checks green',
      'feature/two:checks failing',
    ]);
  });

  it('publishes `default branch red` from a settled red reading and not otherwise', () => {
    const f = indexFindings(readings({ index: null, defaultBranch: red() })).findings;
    expect(f).toHaveLength(1);
    expect(f[0]).toMatchObject({ branch: 'main', finding: 'default branch red', since: '2026-10-10T08:00:00Z' });
    expect(f[0]!.evidence).toBe('main is red on m1; failing: CI');
    const green = red({ settled: { sha: 'm1', state: 'green' }, failingRuns: [] });
    expect(indexFindings(readings({ index: null, defaultBranch: green })).findings).toEqual([]);
  });

  it('dates a red verdict from the reading when the settled commit is not the head', () => {
    const [f] = indexFindings(readings({ index: null, defaultBranch: red({ headSha: 'm2' }) })).findings;
    expect(f!.since).toBe(NOW);
  });

  it('reports a cold start: 200 rows, 3 open slice PRs and 1 merged 2 h ago give 4 findings plus the default branch', () => {
    const noise = Array.from({ length: 196 }, (_, i) => row({ number: 100 + i, head: `other/${i}`, state: 'CLOSED' }));
    const rows = [
      ...noise,
      row({ number: 1, head: 'feature/one' }),
      row({ number: 2, head: 'feature/two', checks: 'failing' }),
      row({ number: 3, head: 'feature/three', checks: 'green' }),
      row({ number: 4, head: 'feature/four', state: 'MERGED', mergedAt: hoursAgo(2) }),
    ];
    const sliceBranches = new Set(['feature/one', 'feature/two', 'feature/three', 'feature/four']);
    const { findings } = indexFindings(readings({ index: indexOf(rows), sliceBranches, defaultBranch: red() }));
    expect(rows).toHaveLength(200);
    expect(findings.map((f) => f.finding).sort()).toEqual([
      'checks failing',
      'checks green',
      'checks green',
      'default branch red',
      'pr merged',
    ]);
  });

  it('retracts nothing when the index is unreadable', () => {
    const wanted = indexFindings(readings({ index: null }));
    expect(wanted.findings).toEqual([]);
    expect(wanted.retractable).toEqual({ allPrs: false, prBranches: new Set(), defaultBranch: false });
  });

  it('retracts only the slots whose row exists when the store is incomplete', () => {
    const wanted = indexFindings(readings({ index: indexOf([row({ checks: 'pending' })], { complete: false }) }));
    expect(wanted.retractable.allPrs).toBe(false);
    expect([...wanted.retractable.prBranches]).toEqual(['feature/one']);
  });
});

describe('diffFindings — the channel is the memory', () => {
  const held = (r: IndexReadings): Finding[] => [...indexFindings(r).findings];

  it('publishes nothing on a second fold of an identical index', () => {
    const r = readings({ defaultBranch: red() });
    const first = diffFindings([], indexFindings(r), NOW);
    expect(first.publish).toHaveLength(2);
    const later = readings({ defaultBranch: red(), now: '2026-10-10T12:01:00Z' });
    const second = diffFindings(held(r), indexFindings(later), later.now);
    expect(second).toEqual({ publish: [], clear: [] });
  });

  it('publishes again when the head SHA moves under the same check word', () => {
    const before = readings();
    const after = readings({ index: indexOf([row({ headSha: 'bbb', checksSha: 'bbb' })]) });
    const diff = diffFindings(held(before), indexFindings(after), NOW);
    expect(diff.publish.map((f) => f.evidence)).toEqual(['pull request #1, on bbb']);
    expect(diff.clear).toEqual([]);
  });

  it('replaces `checks green` with `pr merged` in the same slot', () => {
    const before = readings();
    const after = readings({ index: indexOf([row({ state: 'MERGED', mergedAt: hoursAgo(1) })]) });
    const diff = diffFindings(held(before), indexFindings(after), NOW);
    expect(diff.publish.map((f) => f.finding)).toEqual(['pr merged']);
    expect(diff.clear).toEqual([]);
    expect(findingKey(diff.publish[0]!)).toBe(findingKey(held(before)[0]!));
  });

  it('leaves the first slot alone when a later `checks failing` arrives on another branch', () => {
    const before = readings();
    const after = readings({ index: indexOf([row(), row({ number: 2, head: 'feature/two', checks: 'failing' })]) });
    const diff = diffFindings(held(before), indexFindings(after), NOW);
    expect(diff.publish.map((f) => f.branch)).toEqual(['feature/two']);
    expect(diff.clear).toEqual([]);
  });

  it('clears a held `checks green` when the PR goes pending', () => {
    const before = readings();
    const after = readings({ index: indexOf([row({ checks: 'pending' })]) });
    const diff = diffFindings(held(before), indexFindings(after), NOW);
    expect(diff.publish).toEqual([]);
    expect(diff.clear).toHaveLength(1);
    expect(diff.clear[0]).toMatchObject({ monitor: 'IndexMonitor', branch: 'feature/one', finding: 'clear' });
  });

  it('clears a held `pr merged` once the merge is past 24 h', () => {
    const merged = readings({ index: indexOf([row({ state: 'MERGED', mergedAt: hoursAgo(23) })]) });
    const aged = readings({ index: indexOf([row({ state: 'MERGED', mergedAt: hoursAgo(25) })]) });
    expect(diffFindings(held(merged), indexFindings(merged), NOW)).toEqual({ publish: [], clear: [] });
    expect(diffFindings(held(merged), indexFindings(aged), NOW).clear.map((f) => f.branch)).toEqual(['feature/one']);
  });

  it('clears `default branch red` when the reading turns green', () => {
    const before = readings({ index: null, defaultBranch: red() });
    const after = readings({ index: null, defaultBranch: red({ settled: { sha: 'm2', state: 'green' }, failingRuns: [] }) });
    expect(diffFindings(held(before), indexFindings(after), NOW).clear.map((f) => f.branch)).toEqual(['main']);
  });

  it('publishes and clears nothing for an unreadable index', () => {
    const before = readings({ defaultBranch: red() });
    const after = readings({ index: null, defaultBranch: red() });
    expect(diffFindings(held(before), indexFindings(after), NOW)).toEqual({ publish: [], clear: [] });
  });

  it('does not retract a PR the incomplete store does not mention', () => {
    const before = readings();
    const after = readings({ index: indexOf([], { complete: false }) });
    expect(diffFindings(held(before), indexFindings(after), NOW).clear).toEqual([]);
    const whole = readings({ index: indexOf([], { complete: true }) });
    expect(diffFindings(held(before), indexFindings(whole), NOW).clear).toHaveLength(1);
  });

  it('leaves other monitors\' findings alone, and treats a held `clear` as no finding', () => {
    const other: Finding = {
      monitor: 'AgentMonitor',
      branch: 'feature/one',
      worktree: '/w',
      finding: 'owes a review',
      since: NOW,
      evidence: 'x',
      measuredAt: NOW,
    };
    const cleared: Finding = { ...held(readings())[0]!, finding: 'clear' };
    const diff = diffFindings([other, cleared], indexFindings(readings({ index: null })), NOW);
    expect(diff).toEqual({ publish: [], clear: [] });
    expect(diffFindings([cleared], indexFindings(readings()), NOW).publish).toHaveLength(1);
  });
});
