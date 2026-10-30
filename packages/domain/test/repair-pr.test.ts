import { describe, it, expect } from 'vitest';
import type { DefaultBranchReading } from '../src/entities/default-branch.js';
import type { Pr } from '../src/entities/pr.js';
import { REPAIR_RECORD_VERSION, type RepairRecord } from '../src/entities/repair-record.js';
import {
  isRevertBranch,
  keepsRepairRecord,
  mainRepairBranchOf,
  repairEpisode,
  repairMergeVerdict,
  repairRoleOf,
  type RepairMergeReading,
} from '../src/rules/repair-pr.js';
import { nameRepairPr, nameRepairPrAt, type NameRepairPrPorts, type NameRepairPrReadings } from '../src/workflows/repair-pr.js';

const GREEN = 'a'.repeat(40);
const RED = 'b'.repeat(40);
const BUNDLE = 'c'.repeat(40);
const BRANCH = `bug/main-repair-${GREEN.slice(0, 12)}`;

const record = (over: Partial<RepairRecord> = {}): RepairRecord => ({
  v: REPAIR_RECORD_VERSION,
  branch: 'main',
  state: 'idle',
  lastGreenSha: GREEN,
  firstRedSha: RED,
  redSince: '2026-10-30T07:00:00Z',
  candidates: [],
  rerun: 'none',
  preRevertRerun: 'none',
  at: '2026-10-30T07:00:00Z',
  ...over,
});

const pr = (over: Partial<Pr> = {}): Pr => ({
  number: 2942,
  repo: '',
  head: BRANCH,
  base: 'main',
  state: 'OPEN',
  mergedAt: null,
  mergeCommit: '',
  draft: false,
  mergeable: 'mergeable',
  review: '',
  checks: 'green',
  failingChecks: [],
  url: '',
  author: '',
  headSha: 'd'.repeat(40),
  checksSha: 'd'.repeat(40),
  ...over,
});

const redOn = (sha: string): DefaultBranchReading => ({
  v: 1,
  branch: 'main',
  headSha: sha,
  head: 'red',
  headSince: '2026-10-30T07:00:00Z',
  settled: { sha, state: 'red' },
  failingRuns: [],
  askedAt: '2026-10-30T07:00:00Z',
  at: '2026-10-30T07:00:00Z',
});

describe('mainRepairBranchOf', () => {
  it('names bug/main-repair-<12 hex of the last green SHA>', () => {
    expect(mainRepairBranchOf(GREEN)).toBe(BRANCH);
  });

  it('names no branch without a last green SHA', () => {
    expect(mainRepairBranchOf(undefined)).toBeNull();
    expect(mainRepairBranchOf('')).toBeNull();
  });
});

describe('isRevertBranch', () => {
  it.each([
    ['bug/revert-2937', true],
    ['bug/revert-0', false],
    ['bug/revert-', false],
    ['bug/revert-12x', false],
    ['feature/bug/revert-12', false],
  ])('%s -> %s', (branch, expected) => {
    expect(isRevertBranch(branch)).toBe(expected);
  });
});

describe('repairRoleOf', () => {
  it('reads repairPr, then revertPr, then nothing', () => {
    expect(repairRoleOf(record({ repairPr: 1, revertPr: 2 }), 1)).toBe('repair');
    expect(repairRoleOf(record({ repairPr: 1, revertPr: 2 }), 2)).toBe('revert');
    expect(repairRoleOf(record({ repairPr: 1, revertPr: 2 }), 3)).toBeNull();
  });
});

describe('repairEpisode', () => {
  const settled = { sha: BUNDLE, state: 'red' as const };

  it('is open where the settled red commit descends from the first red SHA', () => {
    expect(repairEpisode(record(), 'main', settled, [BUNDLE, RED, GREEN])).toBe('open');
  });

  it('is closed where the first red SHA is not on the settled commit’s first-parent line', () => {
    expect(repairEpisode(record(), 'main', settled, [BUNDLE, GREEN])).toBe('closed');
  });

  it.each(['done', 'exhausted'] as const)('is closed for a %s record', (state) => {
    expect(repairEpisode(record({ state }), 'main', settled, [BUNDLE, RED])).toBe('closed');
  });

  it('is closed for another branch, a green settled commit, or none', () => {
    expect(repairEpisode(record({ branch: 'trunk' }), 'main', settled, [BUNDLE, RED])).toBe('closed');
    expect(repairEpisode(record(), 'main', { sha: BUNDLE, state: 'green' }, [BUNDLE, RED])).toBe('closed');
    expect(repairEpisode(record(), 'main', undefined, [BUNDLE, RED])).toBe('closed');
  });

  it('is unaskable where only the line could decide and it failed', () => {
    expect(repairEpisode(record(), 'main', settled, 'unaskable')).toBe('unaskable');
  });
});

describe('repairMergeVerdict', () => {
  const reading = (over: Partial<RepairMergeReading> = {}): RepairMergeReading => ({
    record: record({ repairPr: 2942 }),
    episode: 'open',
    redRuns: 'red',
    ...over,
  });
  const head = { number: 2942, head: BRANCH };

  it('admits the fix PR the record names on its branch while the red commit still reads red', () => {
    expect(repairMergeVerdict(reading(), head)).toEqual({ verdict: 'admitted', role: 'repair' });
  });

  it('admits the revert PR the record names on a bug/revert-<pr> branch', () => {
    const revert = reading({ record: record({ revertPr: 2950 }) });
    expect(repairMergeVerdict(revert, { number: 2950, head: 'bug/revert-2937' })).toEqual({ verdict: 'admitted', role: 'revert' });
  });

  it('answers not-named for no record, an unreadable record, or a PR the record does not name', () => {
    expect(repairMergeVerdict(reading({ record: null }), head).verdict).toBe('not-named');
    expect(repairMergeVerdict(reading({ record: 'unaskable' }), head).verdict).toBe('not-named');
    expect(repairMergeVerdict(reading(), { number: 7, head: BRANCH }).verdict).toBe('not-named');
  });

  const reasonOf = (r: RepairMergeReading, h = head) => {
    const out = repairMergeVerdict(r, h);
    return out.verdict === 'refused' ? out.reason : out.verdict;
  };

  it('refuses repair-episode-closed for a closed episode', () => {
    expect(reasonOf(reading({ episode: 'closed' }))).toBe('repair-episode-closed');
  });

  it('refuses unaskable where the episode could not be read', () => {
    expect(reasonOf(reading({ episode: 'unaskable' }))).toBe('unaskable');
  });

  it('refuses repair-branch-mismatch for a named fix PR on another branch', () => {
    expect(reasonOf(reading(), { number: 2942, head: 'bug/queue-and-scan-agree-on-a-started-slice' })).toBe('repair-branch-mismatch');
  });

  it('refuses repair-branch-mismatch for a named fix PR where the record has no last green SHA', () => {
    const out = repairMergeVerdict(reading({ record: record({ repairPr: 2942, lastGreenSha: undefined }) }), head);
    expect(out.verdict === 'refused' && out.reason).toBe('repair-branch-mismatch');
    expect(out.verdict === 'refused' && out.detail).toContain('no last green SHA');
  });

  it('refuses repair-branch-mismatch for a named revert PR off a revert branch, and for a fix PR on a revert branch', () => {
    const revert = reading({ record: record({ revertPr: 2950 }) });
    expect(reasonOf(revert, { number: 2950, head: BRANCH })).toBe('repair-branch-mismatch');
    expect(reasonOf(reading(), { number: 2942, head: 'bug/revert-2937' })).toBe('repair-branch-mismatch');
  });

  it.each(['green', 'pending', 'unknown'] as const)('refuses repair-red-unconfirmed where the red commit now reads %s', (redRuns) => {
    expect(reasonOf(reading({ redRuns }))).toBe('repair-red-unconfirmed');
  });

  it('refuses unaskable where the red commit’s runs could not be asked again', () => {
    expect(reasonOf(reading({ redRuns: 'unaskable' }))).toBe('unaskable');
  });
});

describe('keepsRepairRecord', () => {
  it('keeps an open record of the same branch and first red SHA', () => {
    expect(keepsRepairRecord(record({ repairPr: 2942 }), 'main', RED)).toBe(true);
  });

  it('replaces no record, another episode, another branch, or a settled record', () => {
    expect(keepsRepairRecord(null, 'main', RED)).toBe(false);
    expect(keepsRepairRecord(record(), 'main', BUNDLE)).toBe(false);
    expect(keepsRepairRecord(record(), 'trunk', RED)).toBe(false);
    expect(keepsRepairRecord(record({ state: 'done' }), 'main', RED)).toBe(false);
    expect(keepsRepairRecord(record({ state: 'exhausted' }), 'main', RED)).toBe(false);
  });
});

describe('nameRepairPr — a person records the repair PR', () => {
  const readings = (over: Partial<NameRepairPrReadings> = {}): NameRepairPrReadings => ({
    caller: 'person',
    record: record(),
    episode: 'open',
    pr: pr(),
    ...over,
  });
  const reasonOf = (r: NameRepairPrReadings, n = 2942) => {
    const out = nameRepairPr(r, n);
    return out.outcome === 'refused' ? out.reason : out.outcome;
  };

  it('records the PR on the open episode’s repair branch', () => {
    expect(nameRepairPr(readings(), 2942)).toEqual({ outcome: 'decided', record: record({ repairPr: 2942 }), branch: BRANCH });
  });

  it('records the same PR again with no change', () => {
    expect(nameRepairPr(readings({ record: record({ repairPr: 2942 }) }), 2942)).toMatchObject({ outcome: 'decided', record: record({ repairPr: 2942 }) });
  });

  it('refuses an unattended caller before any other reading', () => {
    expect(reasonOf(readings({ caller: 'unattended', record: 'unaskable' }))).toBe('unattended');
  });

  it('accepts a fleetd caller', () => {
    expect(reasonOf(readings({ caller: 'fleetd' }))).toBe('decided');
  });

  it('refuses unaskable where the record could not be read', () => {
    expect(reasonOf(readings({ record: 'unaskable' }))).toBe('unaskable');
  });

  it('refuses no-open-episode with no record, and with a closed episode', () => {
    expect(reasonOf(readings({ record: null }))).toBe('no-open-episode');
    const out = nameRepairPr(readings({ episode: 'closed' }), 2942);
    expect(out.outcome === 'refused' && out.reason).toBe('no-open-episode');
    expect(out.outcome === 'refused' && out.detail).toContain("state 'idle'");
  });

  it('refuses unaskable where the episode could not be read', () => {
    expect(reasonOf(readings({ episode: 'unaskable' }))).toBe('unaskable');
  });

  it('refuses no-last-green where the record has no last green SHA', () => {
    expect(reasonOf(readings({ record: record({ lastGreenSha: undefined }) }))).toBe('no-last-green');
  });

  it('refuses unaskable where the host did not answer for the PR', () => {
    expect(reasonOf(readings({ pr: 'unaskable' }))).toBe('unaskable');
  });

  it('refuses pr-not-open for an unknown, merged or closed PR', () => {
    expect(reasonOf(readings({ pr: null }))).toBe('pr-not-open');
    expect(reasonOf(readings({ pr: pr({ state: 'MERGED' }) }))).toBe('pr-not-open');
    expect(reasonOf(readings({ pr: pr({ state: 'CLOSED' }) }))).toBe('pr-not-open');
  });

  it('refuses repair-branch-mismatch for a PR off the repair branch, such as #2942’s own branch', () => {
    expect(reasonOf(readings({ pr: pr({ head: 'bug/queue-and-scan-agree-on-a-started-slice' }) }))).toBe('repair-branch-mismatch');
  });

  it('refuses repair-pr-already-named where the record names another repair PR', () => {
    expect(reasonOf(readings({ record: record({ repairPr: 2900 }) }))).toBe('repair-pr-already-named');
  });
});

describe('nameRepairPrAt — the workflow wired to its ports', () => {
  type Stored = RepairRecord | null;

  /** Ports over an in-memory record; `between` runs after the first read and before the re-read. */
  const ports = (initial: Stored, over: Partial<NameRepairPrPorts> = {}, between?: (set: (r: Stored) => void) => void) => {
    let stored = initial;
    let reads = 0;
    const writes: RepairRecord[] = [];
    const p: NameRepairPrPorts = {
      caller: 'person',
      host: { prState: async () => ({ ok: true, value: pr() }) } as never,
      refs: { firstParentLine: async () => ({ ok: true, value: [BUNDLE, RED, GREEN] }) } as never,
      defaultBranch: { read: async () => ({ ok: true, value: redOn(BUNDLE) }), write: async () => ({ ok: true, value: undefined }) } as never,
      repair: {
        read: async () => {
          reads += 1;
          if (reads === 2 && between) between((r) => { stored = r; });
          return { ok: true, value: stored };
        },
        write: async (record) => {
          writes.push(record);
          stored = record;
          return { ok: true, value: undefined };
        },
      },
      ...over,
    };
    return { p, writes, stored: () => stored };
  };

  it('writes repairPr onto the open record', async () => {
    const { p, writes, stored } = ports(record());
    expect(await nameRepairPrAt(p, 2942)).toEqual({ named: true, pr: 2942, branch: BRANCH });
    expect(writes).toEqual([record({ repairPr: 2942 })]);
    expect(stored()).toEqual(record({ repairPr: 2942 }));
  });

  it('refuses an unattended caller and reads nothing', async () => {
    let asked = 0;
    const { p, writes } = ports(record(), { caller: 'unattended', host: { prState: async () => { asked += 1; return { ok: true, value: pr() }; } } as never });
    expect(await nameRepairPrAt(p, 2942)).toMatchObject({ named: false, reason: 'unattended' });
    expect(asked).toBe(0);
    expect(writes).toEqual([]);
  });

  it('refuses no-open-episode with no record, without reading the default branch', async () => {
    const { p } = ports(null, { defaultBranch: { read: async () => { throw new Error('read'); } } as never });
    expect(await nameRepairPrAt(p, 2942)).toMatchObject({ named: false, reason: 'no-open-episode' });
  });

  it('refuses unaskable where the record read fails', async () => {
    const { p } = ports(record());
    p.repair.read = async () => ({ ok: false, why: 'failed' }) as never;
    expect(await nameRepairPrAt(p, 2942)).toMatchObject({ named: false, reason: 'unaskable' });
  });

  it('refuses unaskable where the default-branch read fails', async () => {
    const { p } = ports(record(), { defaultBranch: { read: async () => ({ ok: false, why: 'failed' }) } as never });
    expect(await nameRepairPrAt(p, 2942)).toMatchObject({ named: false, reason: 'unaskable' });
  });

  it('refuses no-open-episode where the default branch has no reading, or settled green', async () => {
    const none = ports(record(), { defaultBranch: { read: async () => ({ ok: true, value: null }) } as never });
    expect(await nameRepairPrAt(none.p, 2942)).toMatchObject({ named: false, reason: 'no-open-episode' });
    const greenNow = { ...redOn(BUNDLE), settled: { sha: BUNDLE, state: 'green' as const } };
    const green = ports(record(), { defaultBranch: { read: async () => ({ ok: true, value: greenNow }) } as never });
    expect(await nameRepairPrAt(green.p, 2942)).toMatchObject({ named: false, reason: 'no-open-episode' });
  });

  it('refuses unaskable where the first-parent walk fails', async () => {
    const { p } = ports(record(), { refs: { firstParentLine: async () => ({ ok: false, why: 'failed' }) } as never });
    expect(await nameRepairPrAt(p, 2942)).toMatchObject({ named: false, reason: 'unaskable' });
  });

  it('refuses unaskable where the host lookup fails', async () => {
    const { p, writes } = ports(record(), { host: { prState: async () => ({ ok: false, why: 'unaskable' }) } as never });
    expect(await nameRepairPrAt(p, 2942)).toMatchObject({ named: false, reason: 'unaskable' });
    expect(writes).toEqual([]);
  });

  it('refuses repair-branch-mismatch and writes nothing', async () => {
    const { p, writes } = ports(record(), { host: { prState: async () => ({ ok: true, value: pr({ head: 'bug/other' }) }) } as never });
    expect(await nameRepairPrAt(p, 2942)).toMatchObject({ named: false, reason: 'repair-branch-mismatch' });
    expect(writes).toEqual([]);
  });

  it('refuses record-moved where fleetd replaced the record between the read and the write', async () => {
    const { p, writes, stored } = ports(record(), {}, (set) => set(record({ firstRedSha: BUNDLE, at: '2026-10-30T08:00:00Z' })));
    expect(await nameRepairPrAt(p, 2942)).toMatchObject({ named: false, reason: 'record-moved' });
    expect(writes).toEqual([]);
    expect(stored()?.repairPr).toBeUndefined();
  });

  it('refuses record-moved where the record vanished before the write', async () => {
    const { p, writes } = ports(record(), {}, (set) => set(null));
    expect(await nameRepairPrAt(p, 2942)).toMatchObject({ named: false, reason: 'record-moved' });
    expect(writes).toEqual([]);
  });

  it('refuses unaskable where the re-read fails', async () => {
    const { p } = ports(record());
    let reads = 0;
    p.repair.read = async () => (++reads === 1 ? { ok: true, value: record() } : ({ ok: false, why: 'failed' }) as never);
    expect(await nameRepairPrAt(p, 2942)).toMatchObject({ named: false, reason: 'unaskable' });
  });

  it('refuses unaskable where the write fails', async () => {
    const { p } = ports(record());
    p.repair.write = async () => ({ ok: false, why: 'failed' }) as never;
    expect(await nameRepairPrAt(p, 2942)).toMatchObject({ named: false, reason: 'unaskable' });
  });
});
