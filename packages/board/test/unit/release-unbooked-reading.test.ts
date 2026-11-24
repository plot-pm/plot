import { afterEach, describe, expect, it } from 'vitest';
import type { Finding } from '@plot-pm/domain';
import type { FleetdHeartbeat } from '@plot-pm/domain/entities/fleetd-heartbeat';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { failed } from '@plot-pm/domain';
import { releaseFinishRecordFile, releaseFinishRecordPath } from '@plot-pm/domain/adapters';
import type { StateHome } from '@plot-pm/domain/entities/state-home';
import { RELEASE_FINISH_RECORD_VERSION } from '@plot-pm/domain/entities/release-finish-record';
import type { ReleaseFinishRecordStore } from '@plot-pm/domain/ports/release-finish-record';
import type { BuildBoardOptions } from '../../src/server/board.js';
import {
  RELEASE_UNBOOKED_READ_MS,
  forgetReleaseUnbooked,
  releaseUnbookedFor,
} from '../../src/server/release-unbooked-reading.js';

const NOW = Date.parse('2026-11-24T12:00:00Z');
const live = { beatAt: NOW - 1_000 } as unknown as FleetdHeartbeat;
const stale = { beatAt: NOW - 3_600_000 } as unknown as FleetdHeartbeat;
const owed = { version: 'v2.36.0', plans: ['alpha'], sprintOpen: null };
const held: Finding = {
  monitor: 'ReleaseMonitor', branch: 'release', worktree: '', finding: 'release unbooked',
  since: '2026-11-24T10:00:00Z', evidence: 'v2.36.0: 1 plan(s) unbooked (alpha)', measuredAt: '2026-11-24T10:00:00Z',
};
const opts = (findings?: readonly Finding[] | null): BuildBoardOptions =>
  ({ repoRoot: '/repo', scriptsDir: '/s', ...(findings === undefined ? {} : { channelFindings: () => findings }) }) as unknown as BuildBoardOptions;

afterEach(() => forgetReleaseUnbooked());

describe('releaseUnbookedFor', () => {
  it('takes fleetd\'s finding while its heartbeat is live and the hub holds the findings', async () => {
    let asked = 0;
    const shown = await releaseUnbookedFor(opts([held]), live, NOW, async () => { asked += 1; return 'none'; });
    expect(shown).toEqual({ answer: owed, source: 'fleetd', lastFinish: null });
    expect(asked).toBe(0);
  });

  it('asks the rule itself where fleetd\'s heartbeat is stale, absent, or the hub link is down', async () => {
    const own = async () => owed;
    expect(await releaseUnbookedFor(opts([held]), stale, NOW, own)).toEqual({ answer: owed, source: 'board', lastFinish: null });
    forgetReleaseUnbooked();
    expect(await releaseUnbookedFor(opts([held]), null, NOW, own)).toEqual({ answer: owed, source: 'board', lastFinish: null });
    forgetReleaseUnbooked();
    expect(await releaseUnbookedFor(opts(null), live, NOW, own)).toEqual({ answer: owed, source: 'board', lastFinish: null });
  });

  it('reuses its own reading for the read interval, and asks again after it or after a forget', async () => {
    let asked = 0;
    const own = async () => { asked += 1; return owed; };
    await releaseUnbookedFor(opts(), null, NOW, own);
    await releaseUnbookedFor(opts(), null, NOW + RELEASE_UNBOOKED_READ_MS - 1, own);
    expect(asked).toBe(1);
    await releaseUnbookedFor(opts(), null, NOW + RELEASE_UNBOOKED_READ_MS, own);
    expect(asked).toBe(2);
    forgetReleaseUnbooked('/repo');
    await releaseUnbookedFor(opts(), null, NOW + RELEASE_UNBOOKED_READ_MS, own);
    expect(asked).toBe(3);
  });

  it('answers unaskable where its own reading throws, never none', async () => {
    const shown = await releaseUnbookedFor(opts(), null, NOW, async () => { throw new Error('git failed'); });
    expect(shown).toEqual({ answer: 'unaskable', source: 'board', lastFinish: null });
  });

  describe('the last finish', () => {
    const homes: string[] = [];
    afterEach(() => {
      for (const home of homes.splice(0)) rmSync(home, { recursive: true, force: true });
    });
    const recorded = async (): Promise<{ home: StateHome; records: ReleaseFinishRecordStore }> => {
      const home = mkdtempSync(path.join(tmpdir(), 'plot-unbooked-finish-')) as StateHome;
      homes.push(home);
      const records = releaseFinishRecordFile(home);
      await records.write({
        v: RELEASE_FINISH_RECORD_VERSION, version: 'v2.36.0', at: '2026-11-24T11:00:00.000Z', caller: 'person',
        outcome: 'refused', reason: 'tag-absent', booked: [], notes: [], sprintClosed: null,
      });
      return { home, records };
    };

    it('carries the owed release\'s last finish read from its file', async () => {
      const { records } = await recorded();
      const shown = await releaseUnbookedFor(opts(), null, NOW, async () => owed, records);
      expect(shown).toEqual({
        answer: owed,
        source: 'board',
        lastFinish: { at: '2026-11-24T11:00:00.000Z', outcome: 'refused', reason: 'tag-absent' },
      });
    });

    it('gives null where the record read fails', async () => {
      const broken: ReleaseFinishRecordStore = { read: async () => failed(), write: async () => failed<void>() };
      expect((await releaseUnbookedFor(opts(), null, NOW, async () => owed, broken)).lastFinish).toBeNull();
    });

    it('changes no answer when the file is deleted, only the missing last finish', async () => {
      const { home, records } = await recorded();
      const own = async () => owed;
      const withFile = await releaseUnbookedFor(opts(), null, NOW, own, records);
      rmSync(releaseFinishRecordPath(home, 'v2.36.0'));
      forgetReleaseUnbooked();
      const without = await releaseUnbookedFor(opts(), null, NOW, own, records);
      expect(without.answer).toEqual(withFile.answer);
      expect(without.source).toBe(withFile.source);
      expect(withFile.lastFinish).not.toBeNull();
      expect(without.lastFinish).toBeNull();
    });

    it('reads no record where no release is owed', async () => {
      const { records } = await recorded();
      expect((await releaseUnbookedFor(opts(), null, NOW, async () => 'none', records)).lastFinish).toBeNull();
    });
  });
});
