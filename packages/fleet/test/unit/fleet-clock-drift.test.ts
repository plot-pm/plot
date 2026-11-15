import { describe, expect, it } from 'vitest';

import { clockManual } from '@plot-pm/domain/adapters';

import { fleetDivisors, startFleetClock } from '../../src/shared/fleet-clock.js';
import { REFRESH_MS } from '../../src/shared/fleet-scan.js';
import { tick, tickLine } from '../../src/server/entry/registryd.js';
import type { TickReport } from '../../src/server/entry/registryd.js';
import type { SupervisorWorld } from '../../src/shared/supervisor.js';

const quietWorld: SupervisorWorld = {
  workerAlive: async () => false,
  merge: async () => 'merged',
  dirtyPath: async () => '',
  blockedMarker: async () => '',
  changesets: async () => [],
  workspacePackages: async () => [],
  planLine: async () => ({ prs: [], deferred: false, deferredReason: '' }),
  madeProgress: async () => true,
  headroom: async () => 'clear',
  deskFile: () => null,
  transcriptFound: () => true,
};

const counts = () => {
  const seen = { scan: 0, prs: 0, issues: 0, woke: 0 };
  return {
    seen,
    work: {
      scan: async () => void (seen.scan += 1),
      prs: async () => void (seen.prs += 1),
      issues: async () => void (seen.issues += 1),
      woke: () => void (seen.woke += 1),
    },
  };
};

describe('a wake re-checks every deadline and runs one full read', () => {
  it('runs a full read and reports the wake when the wall clock moves 30 minutes and the monotonic clock stands still', async () => {
    const clock = clockManual(1_000_000);
    const { seen, work } = counts();
    const running = startFleetClock(clock, work);
    clock.advance(1);
    await running.idle();
    expect(seen.woke).toBe(0);
    const scansBefore = seen.scan;
    clock.jump(30 * 60_000);
    clock.advance(1);
    await running.idle();
    expect(seen.woke).toBe(1);
    // The beat's own scan and the wake's: the in-flight guard drops the second while the first runs,
    // and the PR and issue passes run on the wake although neither is due on beat 2.
    expect(seen.scan).toBeGreaterThan(scansBefore);
    expect(seen.prs).toBeGreaterThanOrEqual(1);
    expect(seen.issues).toBeGreaterThanOrEqual(1);
    running.stop();
  });
});

describe('the census clock is not a jump', () => {
  it('reads no jump across a census pass: both readings move together', async () => {
    const clock = clockManual(Date.now());
    const { seen, work } = counts();
    const running = startFleetClock(clock, work);
    const beatsPerPass = fleetDivisors().reduce((acc, { everyNthBeat }) => {
      const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b));
      return (acc * everyNthBeat) / gcd(acc, everyNthBeat);
    }, 1);
    for (let pass = 0; pass < 3; pass += 1) {
      clock.advance(beatsPerPass);
      await running.idle();
    }
    expect(seen.woke).toBe(0);
    expect(clock.monotonic()).toEqual({ ok: true, value: 3 * beatsPerPass * REFRESH_MS });
    running.stop();
  });
});

describe('the tick line names the next deadline', () => {
  const report = async (nextDeadline?: TickReport['nextDeadline']): Promise<TickReport> => ({
    ...(await tick({ registry: async () => [], world: quietWorld, now: () => 0 })),
    ...(nextDeadline === undefined ? {} : { nextDeadline }),
  });

  it('prints the rule and the ISO time, `none` for an estate with no deadline, and nothing where nobody asked', async () => {
    expect(tickLine(await report({ at: Date.UTC(2026, 10, 11, 12, 0, 0), rule: 'pr-read' }))).toContain('next-deadline=pr-read@2026-11-11T12:00:00.000Z');
    expect(tickLine(await report(null))).toContain('next-deadline=none');
    expect(tickLine(await report())).not.toContain('next-deadline');
  });
});
