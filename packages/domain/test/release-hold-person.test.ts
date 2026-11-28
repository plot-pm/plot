import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { releaseHoldPersonAt } from '../src/adapters/release-hold-person/release-hold-person-file.js';
import type { DefaultBranchReading } from '../src/entities/default-branch.js';
import type { Pr } from '../src/entities/pr.js';
import type { PrIndexRow } from '../src/entities/pr-index.js';
import type { ReleaseHoldPersonRecord } from '../src/entities/release-hold-person.js';
import { answered, failed } from '../src/port-result.js';
import type { ReleaseHoldPersonStore } from '../src/ports/release-hold-person.js';
import {
  passkeyOriginReason,
  releaseHoldButton,
  releaseHoldRowLine,
  releaseHoldWaitingLine,
  releaseLiftButton,
  releasePersonHold,
  releaseRowOf,
  RELEASE_HOLD_ENDING_STAGES,
} from '../src/rules/release-hold-person.js';
import { releaseHoldable, releaseStage, type ReleaseStage } from '../src/rules/release-prepare.js';
import type { RepairMergeReading } from '../src/rules/repair-pr.js';
import { mergeArm, type SlicePrNextReadings } from '../src/rules/slice-pr-next.js';
import { merge, mergeAt, type MergePorts, type MergeReadings } from '../src/workflows/merge.js';
import { releaseHoldAt, releaseHoldLiftAt, type ReleaseHoldPorts } from '../src/workflows/release-hold.js';

const WAIT = 3_600_000;
const RELEASE_HEAD = 'e150fd7c1'.padEnd(40, '0');
const NEXT_HEAD = 'a232b0959'.padEnd(40, '0');
const SLICE_HEAD = 'a'.repeat(40);
const MAIN_TIP = 'c'.repeat(40);
const HOLD_AT = '2026-11-26T20:31:00.000Z';
const T = Date.parse(HOLD_AT);

const releaseRow = (over: Partial<PrIndexRow> = {}): PrIndexRow => ({
  number: 3719,
  head: 'changeset-release/main',
  base: 'main',
  state: 'OPEN',
  draft: false,
  checks: 'green',
  review: '',
  url: 'u',
  headSha: RELEASE_HEAD,
  checksSha: RELEASE_HEAD,
  ciChecks: 'green',
  ...over,
});

const hold = (over: Partial<ReleaseHoldPersonRecord> = {}): ReleaseHoldPersonRecord => ({
  v: 1,
  pr: 3719,
  act: 'hold',
  head: RELEASE_HEAD,
  at: HOLD_AT,
  by: 'jwloka',
  ...over,
});

describe('releaseHoldable', () => {
  it('answers holdable for a green, unreviewed head in waiting-scope', () => {
    const row = releaseRow();
    const stage = releaseStage({
      finish: 'none',
      pr: row,
      scope: { read: 'none', why: 'no-active-sprint' },
      phases: new Map(),
      checks: 'unaskable',
      headChanges: null,
      config: { requiredWorkflow: 'validate' },
    } as never);
    expect(stage).toBe('waiting-scope');
    expect(releaseHoldable(row, null, 'main')).toBe('holdable');
  });

  it('answers holdable for a pending and a passed review on the head, and for a review on another head', () => {
    expect(releaseHoldable(releaseRow({ plotReview: 'pending', plotReviewSha: RELEASE_HEAD }), null, 'main')).toBe('holdable');
    const passed = releaseRow({
      plotReview: 'success', plotReviewSha: RELEASE_HEAD,
      plotReviewJudged: 'success', plotReviewCheckedSha: RELEASE_HEAD,
    });
    expect(releaseHoldable(passed, null, 'main')).toBe('holdable');
    expect(releaseHoldable(releaseRow({ plotReview: 'failure', plotReviewSha: NEXT_HEAD }), null, 'main')).toBe('holdable');
  });

  it('names the first unmet criterion', () => {
    expect(releaseHoldable(releaseRow({ state: 'MERGED' }), null, 'main')).toBe('not-open');
    expect(releaseHoldable(releaseRow({ head: 'feature/x' }), null, 'main')).toBe('not-release-branch');
    expect(releaseHoldable(releaseRow({ base: 'sprint/x' }), null, 'main')).toBe('not-into-default-branch');
    expect(releaseHoldable(releaseRow(), null, 'unaskable')).toBe('not-into-default-branch');
    expect(releaseHoldable(releaseRow({ headSha: undefined }), null, 'main')).toBe('no-head');
    expect(releaseHoldable(releaseRow({ ciChecks: 'pending' }), null, 'main')).toBe('checks-not-counted');
    expect(releaseHoldable(releaseRow({ ciChecks: undefined }), null, 'main')).toBe('checks-not-counted');
    expect(releaseHoldable(releaseRow({ checksSha: NEXT_HEAD }), null, 'main')).toBe('checks-not-counted');
    const failedReview = releaseRow({
      plotReview: 'failure', plotReviewSha: RELEASE_HEAD,
      plotReviewJudged: 'failure', plotReviewCheckedSha: RELEASE_HEAD,
    });
    expect(releaseHoldable(failedReview, null, 'main')).toBe('review-failed');
    expect(releaseHoldable(releaseRow({ plotReview: 'success', plotReviewSha: RELEASE_HEAD }), null, 'main')).toBe('review-writer-unchecked');
    const foreign = [{ path: 'src/x.ts', added: ['x'], removed: [] }] as never;
    expect(releaseHoldable(releaseRow(), foreign, 'main')).toBe('release-head-foreign');
  });

  it('counts a failed or empty head read as unread', () => {
    expect(releaseHoldable(releaseRow(), 'unaskable', 'main')).toBe('holdable');
    expect(releaseHoldable(releaseRow(), [], 'main')).toBe('holdable');
  });
});

describe('releasePersonHold', () => {
  const rows = [releaseRow()];

  it('holds at T + boundMs − 1 and not at T + boundMs', () => {
    expect(releasePersonHold(rows, hold(), 'main', T + WAIT - 1, WAIT)).toEqual({
      holds: true, pr: 3719, head: RELEASE_HEAD, since: T, end: T + WAIT,
    });
    expect(releasePersonHold(rows, hold(), 'main', T + WAIT, WAIT)).toEqual({ holds: false, reason: 'bound-passed' });
  });

  it('does not extend the hold for a new head at T + 10 min', () => {
    const moved = [releaseRow({ headSha: NEXT_HEAD, checksSha: NEXT_HEAD, updatedAt: '2026-11-26T20:41:00Z' })];
    expect(releasePersonHold(moved, hold(), 'main', T + 600_000, WAIT)).toMatchObject({ holds: true, end: T + WAIT });
    expect(releasePersonHold(moved, hold(), 'main', T + WAIT, WAIT)).toMatchObject({ holds: false });
  });

  it.each(RELEASE_HOLD_ENDING_STAGES.map((s) => [s]))('ends at stage %s', (stage) => {
    expect(releasePersonHold(rows, hold(), 'main', T + 1, WAIT, stage as ReleaseStage)).toEqual({ holds: false, reason: 'stage-ended' });
  });

  it('keeps holding at the stages before a merge', () => {
    for (const stage of ['waiting-scope', 'preparing', 'ready'] as const) {
      expect(releasePersonHold(rows, hold(), 'main', T + 1, WAIT, stage).holds).toBe(true);
    }
  });

  it('holds nothing for a lift, no record, an absent or non-OPEN row, another base and an unparseable at', () => {
    expect(releasePersonHold(rows, null, 'main', T + 1, WAIT)).toEqual({ holds: false, reason: 'no-record' });
    expect(releasePersonHold(rows, hold({ act: 'lift' }), 'main', T + 1, WAIT)).toEqual({ holds: false, reason: 'lifted' });
    expect(releasePersonHold([], hold(), 'main', T + 1, WAIT)).toEqual({ holds: false, reason: 'no-release-row' });
    expect(releasePersonHold([releaseRow({ state: 'MERGED' })], hold(), 'main', T + 1, WAIT)).toEqual({ holds: false, reason: 'not-open' });
    expect(releasePersonHold([releaseRow({ state: 'CLOSED' })], hold(), 'main', T + 1, WAIT)).toEqual({ holds: false, reason: 'not-open' });
    expect(releasePersonHold(rows, hold(), undefined, T + 1, WAIT)).toEqual({ holds: false, reason: 'not-into-default-branch' });
    expect(releasePersonHold(rows, hold({ at: 'never' }), 'main', T + 1, WAIT)).toEqual({ holds: false, reason: 'unparseable-at' });
  });

  it('reads the row the record names where two release rows exist', () => {
    const two = [releaseRow({ number: 3800, base: 'sprint/x', head: 'changeset-release/sprint/x' }), releaseRow()];
    expect(releaseRowOf(two, 'main')?.number).toBe(3719);
    expect(releasePersonHold(two, hold(), 'main', T + 1, WAIT)).toMatchObject({ holds: true, pr: 3719 });
  });
});

describe('the hold texts and buttons', () => {
  const held = releasePersonHold([releaseRow()], hold(), 'main', T + 1, WAIT);
  const none = releasePersonHold([releaseRow()], null, 'main', T + 1, WAIT);
  const LOCAL = 'http://localhost:4173';
  const buttons = (over: Partial<Parameters<typeof releaseHoldButton>[0]> = {}) =>
    releaseHoldButton({ origin: LOCAL, row: releaseRow(), headChanges: null, defaultBranchName: 'main', hold: none, ...over });

  it('shows the Waiting on you line and the release row line', () => {
    expect(releaseHoldWaitingLine(held)).toBe('release #3719 holds merges until 21:31 UTC');
    expect(releaseHoldRowLine(held)).toBe('holds merges since 20:31 UTC · ends 21:31 UTC');
    expect(releaseHoldWaitingLine(none)).toBeNull();
    expect(releaseHoldRowLine(none)).toBeNull();
  });

  it('enables the hold on localhost for a holdable head', () => {
    expect(buttons()).toEqual({ state: 'enabled', reason: 'holds every merge into the default branch while you approve' });
  });

  it('disables the hold off localhost and names the local board', () => {
    const reason = 'the passkey works only on http://localhost:4173: open the local board at http://localhost:4173';
    expect(passkeyOriginReason('http://zio.tailnet.ts.net:4173')).toBe(reason);
    expect(passkeyOriginReason('http://127.0.0.1:4173')).toBe(reason);
    expect(passkeyOriginReason(LOCAL)).toBeNull();
    expect(buttons({ origin: 'http://zio.tailnet.ts.net:4173' })).toEqual({ state: 'disabled', reason });
    expect(passkeyOriginReason('https://board.example')).toContain('http://localhost:<port>');
  });

  it('disables the hold with its reason', () => {
    expect(buttons({ row: null })).toEqual({ state: 'disabled', reason: 'no open release PR into the default branch' });
    expect(buttons({ hold: held })).toEqual({ state: 'disabled', reason: 'merges are held until 21:31 UTC' });
    expect(buttons({ row: releaseRow({ ciChecks: 'pending' }) })).toEqual({ state: 'disabled', reason: 'CI has not passed on the release head' });
  });

  it('enables the lift only while a hold holds', () => {
    expect(releaseLiftButton(held)).toEqual({ state: 'enabled', reason: 'ends the hold of release #3719 now' });
    expect(releaseLiftButton(none)).toEqual({ state: 'disabled', reason: 'no hold holds merges' });
  });
});

describe('the merge arm and the person hold', () => {
  const reading = (over: Partial<DefaultBranchReading> = {}): DefaultBranchReading => ({
    v: 1,
    branch: 'main',
    headSha: MAIN_TIP,
    head: 'green',
    settled: { sha: MAIN_TIP, state: 'green' },
    failingRuns: [],
    headSince: '2026-11-26T20:00:00Z',
    askedAt: '2026-11-26T20:33:00Z',
    at: '2026-11-26T20:33:00Z',
    ...over,
  });
  const slice = (over: Partial<PrIndexRow> = {}): PrIndexRow => ({
    number: 3738,
    head: 'feature/x',
    base: 'main',
    state: 'OPEN',
    draft: false,
    checks: 'green',
    review: '',
    url: 'u',
    headSha: SLICE_HEAD,
    checksSha: SLICE_HEAD,
    ciChecks: 'green',
    plotReview: 'success',
    plotReviewSha: SLICE_HEAD,
    plotReviewJudged: 'success',
    plotReviewCheckedSha: SLICE_HEAD,
    ...over,
  });
  const NOW = Date.parse('2026-11-26T20:33:37Z');
  const arm = (over: Partial<SlicePrNextReadings> = {}) =>
    mergeArm({
      row: slice(),
      newestMerged: null,
      scope: { read: 'none', why: 'no-active-sprint' },
      reviewRun: null,
      reviewStarts: null,
      verdict: { read: 'absent' },
      defaultBranch: reading(),
      defaultBranchName: 'main',
      desk: { dead: false, why: 'live' },
      backend: 'github',
      mergerApp: { read: 'usable' },
      config: { autoReview: true, reviewBoundMs: WAIT, startBudget: 3, checksWaitMs: WAIT },
      now: NOW,
      release: { rows: [releaseRow()], record: hold() },
      ...over,
    });

  it('replays 2026-11-26: #3738 reads release-waiting at 20:33:37 under a hold taken at 20:31', () => {
    expect(arm()).toEqual({ step: 'hold', reason: 'release-waiting' });
    expect(arm({ release: undefined })).toEqual({ step: 'merge', head: SLICE_HEAD });
  });

  it('holds nothing for a missing record, a lift, an absent or non-OPEN row', () => {
    expect(arm({ release: { rows: [releaseRow()], record: null } })).toMatchObject({ step: 'merge' });
    expect(arm({ release: { rows: [releaseRow()], record: hold({ act: 'lift' }) } })).toMatchObject({ step: 'merge' });
    expect(arm({ release: { rows: [], record: hold() } })).toMatchObject({ step: 'merge' });
    expect(arm({ release: { rows: [releaseRow({ state: 'MERGED' })], record: hold() } })).toMatchObject({ step: 'merge' });
  });

  it('does not hold a sprint PR or the release PR itself', () => {
    expect(arm({ row: slice({ base: 'sprint/x' }) })).toEqual({ step: 'merge', head: SLICE_HEAD });
    expect(arm({ row: slice({ number: 3719, head: 'changeset-release/main' }) })).toMatchObject({ step: 'merge' });
  });

  it('lets the repair PR and the revert PR merge on a red main while the hold holds', () => {
    const LAST_GREEN = 'e'.repeat(40);
    const red = reading({ settled: { sha: MAIN_TIP, state: 'red' }, head: 'red' });
    const record = {
      v: 1, branch: 'main', state: 'repairing', lastGreenSha: LAST_GREEN, firstRedSha: 'f'.repeat(40),
      redSince: '2026-11-26T20:00:00Z', candidates: [], rerun: 'asked', preRevertRerun: 'none',
      repairPr: 3738, revertPr: 3739, revertedPr: 3700, at: '2026-11-26T20:00:00Z',
    } as RepairMergeReading['record'];
    const repairMerge: RepairMergeReading = { record, episode: 'open', redRuns: 'red' };
    const repair = slice({ head: `bug/main-repair-${LAST_GREEN.slice(0, 12)}` });
    expect(arm({ defaultBranch: red, repairMerge, row: repair })).toEqual({ step: 'merge', head: SLICE_HEAD });
    const revert = slice({ number: 3739, head: 'bug/revert-3700' });
    expect(arm({ defaultBranch: red, repairMerge, row: revert })).toEqual({ step: 'merge', head: SLICE_HEAD });
    expect(arm({ defaultBranch: red, repairMerge, row: slice({ number: 3740 }) })).toEqual({ step: 'hold', reason: 'default-branch-red' });
  });

  it('answers each default-branch hold and merge-in-flight before release-waiting', () => {
    expect(arm({ defaultBranch: null })).toEqual({ step: 'hold', reason: 'default-branch-unread' });
    expect(arm({ defaultBranch: reading({ settled: { sha: MAIN_TIP, state: 'red' }, head: 'red' }) })).toEqual({ step: 'hold', reason: 'default-branch-red' });
    expect(arm({ defaultBranch: reading({ askedAt: '2026-11-26T18:00:00Z' }) })).toEqual({ step: 'hold', reason: 'default-branch-stale' });
    expect(arm({ defaultBranch: reading({ settled: { sha: MAIN_TIP, state: 'pending' } }) })).toEqual({ step: 'hold', reason: 'default-branch-unsettled' });
    expect(arm({ defaultBranch: reading({ headSha: 'd'.repeat(40) }) })).toEqual({ step: 'hold', reason: 'merge-in-flight' });
  });

  it('answers release-waiting before conflicting and the merger-app holds', () => {
    expect(arm({ row: slice({ mergeable: 'conflicting' }) })).toEqual({ step: 'hold', reason: 'release-waiting' });
    expect(arm({ row: slice({ mergeable: 'conflicting' }), release: undefined })).toEqual({ step: 'hold', reason: 'conflicting' });
    expect(arm({ mergerApp: { read: 'missing' } as never })).toEqual({ step: 'hold', reason: 'release-waiting' });
  });

  it('ends at the bound', () => {
    expect(arm({ now: T + WAIT - 1, defaultBranch: reading({ askedAt: '2026-11-26T21:30:00Z' }) })).toEqual({ step: 'hold', reason: 'release-waiting' });
    expect(arm({ now: T + WAIT, defaultBranch: reading({ askedAt: '2026-11-26T21:30:00Z' }) })).toMatchObject({ step: 'merge' });
  });
});

describe('merge and the person hold', () => {
  const NOW = Date.parse('2026-11-26T20:33:37Z');
  const pr = (over: Partial<Pr> = {}): Pr => ({
    number: 3738, repo: '', head: 'feature/x', base: 'main', state: 'OPEN', mergedAt: null, mergeCommit: '',
    draft: false, mergeable: 'mergeable', review: '', checks: 'green', failingChecks: [], url: '', author: '',
    headSha: SLICE_HEAD, checksSha: SLICE_HEAD, ...over,
  });
  const green: DefaultBranchReading = {
    v: 1, branch: 'main', headSha: MAIN_TIP, head: 'green', settled: { sha: MAIN_TIP, state: 'green' }, failingRuns: [],
    headSince: '2026-11-26T20:00:00Z', askedAt: '2026-11-26T20:33:00Z', at: '2026-11-26T20:33:00Z',
  };
  const readings = (over: Partial<MergeReadings> = {}): MergeReadings => ({
    caller: 'person',
    pr: pr(),
    defaultBranch: green,
    defaultBranchTip: MAIN_TIP,
    defaultBranchName: 'main',
    review: { sha: SLICE_HEAD, state: 'success', description: '', time: '', bypass: false },
    conversation: { prAuthor: 'author', rows: [] },
    releaseHold: { rows: [releaseRow()], record: hold() },
    ...over,
  });
  const reason = (r: MergeReadings, n = 3738) => {
    const out = merge(r, { pr: n, sha: SLICE_HEAD, now: NOW, checksWaitMs: WAIT, minHexLen: 7 });
    return out.outcome === 'refused' ? out.reason : out.outcome;
  };

  it('refuses release-waiting for a PR into main while the hold holds', () => {
    expect(reason(readings())).toBe('release-waiting');
    expect(reason(readings({ releaseHold: undefined }))).toBe('decided');
  });

  it('merges a PR into sprint/x while the hold holds', () => {
    expect(reason(readings({ pr: pr({ base: 'sprint/x' }) }))).toBe('decided');
  });

  it('merges the release PR itself through release-approve', () => {
    const release = pr({ number: 3719, head: 'changeset-release/main' });
    const out = merge(readings({ pr: release }), { pr: 3719, sha: SLICE_HEAD, now: NOW, checksWaitMs: WAIT, minHexLen: 7, viaReleaseApprove: true });
    expect(out.outcome).toBe('decided');
  });

  describe('mergeAt', () => {
    const ports = (base: string, record: ReleaseHoldPersonRecord | null) => {
      const calls: string[][] = [];
      const p = {
        host: {
          backend: async () => answered('github'),
          prState: async () => answered(pr({ base })),
          prReview: async () => answered({ sha: SLICE_HEAD, state: 'success', description: '', time: '', bypass: false }),
          reviewWriter: async () => answered(''),
          prConversation: async () => answered({ prAuthor: 'author', rows: [] }),
        },
        scripts: { hostSaid: async (args: string[]) => { calls.push(args); return { answer: 'answered', said: '' }; } },
        defaultBranch: { read: async () => answered(green) },
        refs: {
          remoteSha: async () => answered({ sha: MAIN_TIP }),
          defaultBranch: async () => answered('main'),
        },
        checksWaitMs: WAIT,
        now: () => NOW,
        caller: 'person',
        releaseHold: {
          record: { read: async () => answered(record), write: async () => answered(undefined) },
          rows: async () => answered([releaseRow()]),
        },
      } as unknown as MergePorts;
      return { p, calls };
    };

    it('refuses release-waiting for a PR into main and merges nothing', async () => {
      const { p, calls } = ports('main', hold());
      expect(await mergeAt(p, 3738, SLICE_HEAD)).toMatchObject({ merged: false, reason: 'release-waiting' });
      expect(calls).toEqual([]);
    });

    it('merges a PR into sprint/x', async () => {
      const { p, calls } = ports('sprint/x', hold());
      expect(await mergeAt(p, 3738, SLICE_HEAD)).toMatchObject({ merged: true });
      expect(calls).toHaveLength(1);
    });

    it('merges where the file holds no record', async () => {
      const { p } = ports('main', null);
      expect(await mergeAt(p, 3738, SLICE_HEAD)).toMatchObject({ merged: true });
    });
  });
});

describe('the hold and lift controllers', () => {
  const memory = (initial: ReleaseHoldPersonRecord | null = null) => {
    let held = initial;
    const writes: ReleaseHoldPersonRecord[] = [];
    const store: ReleaseHoldPersonStore = {
      read: async () => answered(held),
      write: async (record) => { held = record; writes.push(record); return answered(undefined); },
    };
    return { store, writes, current: () => held };
  };
  const ports = (store: ReleaseHoldPersonStore, over: Partial<ReleaseHoldPorts> = {}): ReleaseHoldPorts => ({
    caller: 'person',
    who: 'jwloka',
    store,
    rows: async () => answered([releaseRow()]),
    defaultBranchName: async () => answered('main'),
    checksWaitMs: WAIT,
    now: () => T,
    ...over,
  });

  it('writes a hold naming the PR, head, time and person', async () => {
    const m = memory();
    expect(await releaseHoldAt(ports(m.store), RELEASE_HEAD.slice(0, 9))).toEqual({
      ok: true, act: 'hold', pr: 3719, head: RELEASE_HEAD, at: HOLD_AT, end: '2026-11-26T21:31:00.000Z',
    });
    expect(m.writes).toEqual([hold()]);
  });

  it('refuses a second hold while one holds, so the bound does not move', async () => {
    const m = memory(hold());
    expect(await releaseHoldAt(ports(m.store, { now: () => T + 600_000 }), RELEASE_HEAD)).toMatchObject({ ok: false, reason: 'already-held' });
    expect(m.writes).toEqual([]);
  });

  it('refuses a head that is not the release head, and an unholdable head', async () => {
    const m = memory();
    expect(await releaseHoldAt(ports(m.store), NEXT_HEAD)).toMatchObject({ ok: false, reason: 'head-moved' });
    const red = ports(m.store, { rows: async () => answered([releaseRow({ ciChecks: 'failing' })]) });
    expect(await releaseHoldAt(red, RELEASE_HEAD)).toMatchObject({ ok: false, reason: 'checks-not-counted' });
    const none = ports(m.store, { rows: async () => answered(null) });
    expect(await releaseHoldAt(none, RELEASE_HEAD)).toMatchObject({ ok: false, reason: 'no-release-pr' });
    expect(m.writes).toEqual([]);
  });

  it('lifts the hold on the head it names', async () => {
    const m = memory(hold());
    expect(await releaseHoldLiftAt(ports(m.store, { now: () => T + 60_000 }), RELEASE_HEAD)).toMatchObject({ ok: true, act: 'lift', head: RELEASE_HEAD });
    expect(m.current()).toMatchObject({ act: 'lift', head: RELEASE_HEAD, pr: 3719 });
    expect(releasePersonHold([releaseRow()], m.current(), 'main', T + 60_001, WAIT).holds).toBe(false);
  });

  it('refuses a lift for another head and the hold still holds', async () => {
    const m = memory(hold());
    expect(await releaseHoldLiftAt(ports(m.store), NEXT_HEAD)).toMatchObject({ ok: false, reason: 'head-not-held' });
    expect(m.writes).toEqual([]);
    expect(releasePersonHold([releaseRow()], m.current(), 'main', T + 1, WAIT).holds).toBe(true);
  });

  it('refuses a lift where the file names no hold', async () => {
    expect(await releaseHoldLiftAt(ports(memory().store), RELEASE_HEAD)).toMatchObject({ ok: false, reason: 'nothing-held' });
    expect(await releaseHoldLiftAt(ports(memory(hold({ act: 'lift' })).store), RELEASE_HEAD)).toMatchObject({ ok: false, reason: 'nothing-held' });
  });

  it('refuses an unattended caller before any read', async () => {
    const throwing: ReleaseHoldPersonStore = {
      read: async () => { throw new Error('read'); },
      write: async () => { throw new Error('write'); },
    };
    const unattended = ports(throwing, { caller: 'unattended', rows: async () => { throw new Error('rows'); } });
    expect(await releaseHoldAt(unattended, RELEASE_HEAD)).toMatchObject({ ok: false, reason: 'unattended' });
    expect(await releaseHoldLiftAt(unattended, RELEASE_HEAD)).toMatchObject({ ok: false, reason: 'unattended' });
  });

  it('refuses unaskable where the file cannot be read', async () => {
    const broken: ReleaseHoldPersonStore = { read: async () => failed(), write: async () => answered(undefined) };
    expect(await releaseHoldAt(ports(broken), RELEASE_HEAD)).toMatchObject({ ok: false, reason: 'unaskable' });
  });
});

describe('the person hold file', () => {
  let dir = '';
  afterEach(() => {
    if (dir !== '') rmSync(dir, { recursive: true, force: true });
    dir = '';
  });

  it('reads null for no file, an unparseable file and another version, and round-trips a record', async () => {
    dir = mkdtempSync(join(tmpdir(), 'release-hold-person-'));
    const path = join(dir, 'state', 'release-hold-person.json');
    const store = releaseHoldPersonAt(path);
    expect(await store.read()).toEqual(answered(null));
    expect(await store.write(hold())).toEqual(answered(undefined));
    expect(await store.read()).toEqual(answered(hold()));
    expect(JSON.parse(readFileSync(path, 'utf8'))).toEqual(hold());
    writeFileSync(path, '{ not json');
    expect(await store.read()).toEqual(answered(null));
    writeFileSync(path, JSON.stringify({ ...hold(), v: 2 }));
    expect(await store.read()).toEqual(answered(null));
  });
});
