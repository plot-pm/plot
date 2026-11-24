import { afterEach, describe, expect, it } from 'vitest';
import type { Finding } from '@plot-pm/domain';
import type { FleetdHeartbeat } from '@plot-pm/domain/entities/fleetd-heartbeat';
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
    expect(shown).toEqual({ answer: owed, source: 'fleetd' });
    expect(asked).toBe(0);
  });

  it('asks the rule itself where fleetd\'s heartbeat is stale, absent, or the hub link is down', async () => {
    const own = async () => owed;
    expect(await releaseUnbookedFor(opts([held]), stale, NOW, own)).toEqual({ answer: owed, source: 'board' });
    forgetReleaseUnbooked();
    expect(await releaseUnbookedFor(opts([held]), null, NOW, own)).toEqual({ answer: owed, source: 'board' });
    forgetReleaseUnbooked();
    expect(await releaseUnbookedFor(opts(null), live, NOW, own)).toEqual({ answer: owed, source: 'board' });
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
    expect(shown).toEqual({ answer: 'unaskable', source: 'board' });
  });
});
