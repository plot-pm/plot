import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { clockManual, fleetStateFile } from '@plot-pm/domain/adapters';
import type { FleetReading } from '@plot-pm/domain/entities/fleet';
import type { Refs } from '@plot-pm/domain/ports/refs';
import type { Scripts } from '@plot-pm/domain/ports/scripts';

import { fleetScan, startFleetClock } from '../../src/shared/fleet-clock.js';
import { freshScanState, REFRESH_MS } from '../../src/shared/fleet-scan.js';
import { removeTree as rmTree } from '../rm-tree.mjs';

const READING: FleetReading = {
  main: 'main',
  head: 'abc1234',
  plans: [{ file: '2026-10-09-a-plan.md', phase: 'approved', slices: [] }],
  summary: {
    plans: 1, waves: 0, branches: 0, claimed: 0, eligible: 0, blocked: 0, deferred: 0,
    waiting: 0, prereq_missing: 0, host: 'unknown' as const,
  },
};

const ok = <T>(value: T) => ({ ok: true as const, value });

const refsFake = {
  branchDates: async () => ok([{ branch: 'feature/a', committedAt: Date.now() / 1000 - 600 }]),
  branchTips: async () => ok([{ branch: 'idea/a-plan' }]),
  listBlobs: async () => ok([{ path: 'docs/plans/2026-10-09-a-plan.md' }]),
  remoteUrl: async () => ok('git@github.com:plot-pm/plot.git'),
} as unknown as Refs;

const scriptsFake = (stream: Scripts['stream']): Scripts => ({
  stream,
  hostSaid: async () => ({ answer: 'unaskable', stdout: '' }),
  config: async () => ok('docs/plans/'),
  planMeta: async () => ok(JSON.stringify({ file: '2026-10-09-a-plan.md', approved_raw: '2026-10-08' })),
} as unknown as Scripts);

const emitting: Scripts['stream'] = async (_s, _a, onLine) => {
  onLine(JSON.stringify({ kind: 'reading', reading: READING }));
  return undefined as never;
};

let repo: string;
beforeEach(() => {
  repo = fs.mkdtempSync(path.join(os.tmpdir(), 'plot-fleet-scan-clock-'));
});
afterEach(() => {
  rmTree(repo);
});

const worldOver = (scripts: Scripts) => ({ repoRoot: repo, scripts, refs: refsFake, backend: async () => 'github' });

describe('the fleet writes the whole bridge', () => {
  it('carries all six fields, with ages, approvals and the URL base non-empty', async () => {
    const state = fleetStateFile({ repoRoot: repo });
    await fleetScan(worldOver(scriptsFake(emitting)), state, freshScanState(), () => Date.now(), () => {})();
    const read = await state.read();
    expect(read.ok && read.value).toBeTruthy();
    if (!read.ok || read.value === null) return;
    expect(read.value.pulse.head).toBe('abc1234');
    expect(read.value.ages.get('feature/a')).toBeGreaterThanOrEqual(9);
    expect(read.value.branchUrlBase).toContain('github.com/plot-pm/plot');
    expect(read.value.approvedAt.get('2026-10-09-a-plan.md')).toBe(Date.parse('2026-10-08T00:00:00Z'));
    expect(read.value.ideaPlans.get('idea/a-plan')).toBe('2026-10-09-a-plan.md');
    expect(read.value.at).toBeGreaterThan(0);
  });

  it('leaves the previous bridge byte-identical when a scan ends without a pulse', async () => {
    const state = fleetStateFile({ repoRoot: repo });
    await fleetScan(worldOver(scriptsFake(emitting)), state, freshScanState(), () => Date.now(), () => {})();
    const file = fs.readdirSync(path.join(repo, '.plot', 'state')).map((f) => path.join(repo, '.plot', 'state', f))[0];
    const before = fs.readFileSync(file);
    const warned: string[] = [];
    const silent: Scripts['stream'] = async () => undefined as never;
    await fleetScan(worldOver(scriptsFake(silent)), state, freshScanState(), () => Date.now() + 5, (l) => warned.push(l))();
    const throwing: Scripts['stream'] = async () => { throw new Error('killed at budget'); };
    await fleetScan(worldOver(scriptsFake(throwing)), state, freshScanState(), () => Date.now() + 9, (l) => warned.push(l))();
    expect(fs.readFileSync(file).equals(before)).toBe(true);
    expect(warned).toHaveLength(2);
  });

  it('asks the scan to record nothing of its own', async () => {
    const seen: Array<Record<string, string> | undefined> = [];
    const spy: Scripts['stream'] = async (s, a, onLine, o) => {
      seen.push(o?.env);
      return emitting(s, a, onLine, o);
    };
    await fleetScan(worldOver(scriptsFake(spy)), fleetStateFile({ repoRoot: repo }), freshScanState(), () => Date.now(), () => {})();
    // the fleet is the recording writer: no PLOT_SCAN_RECORD=0 here
    expect(seen[0]?.PLOT_SCAN_RECORD).toBeUndefined();
  });
});

describe('the fleet clock', () => {
  it('does not start a second scan while one runs, and a beat never waits on it', async () => {
    const clock = clockManual(0);
    let started = 0;
    let release: () => void = () => {};
    const gate = new Promise<void>((r) => { release = r; });
    const pulse = startFleetClock(clock, { scan: async () => { started += 1; await gate; } });
    clock.advance(1);
    clock.advance(1);
    clock.advance(1);
    expect(started).toBe(1);
    release();
    await gate;
    await new Promise((r) => setImmediate(r));
    clock.advance(1);
    expect(started).toBe(2);
    pulse.stop();
    expect(clock.scheduled()).toBe(0);
  });

  it('runs the PR reader at every twelfth beat of the base interval', async () => {
    const clock = clockManual(0);
    let prs = 0;
    let scans = 0;
    startFleetClock(clock, {
      scan: async () => { scans += 1; },
      prs: async () => { prs += 1; },
    });
    for (let i = 0; i < 24; i += 1) {
      clock.advance(1);
      await new Promise((r) => setImmediate(r));
    }
    expect(scans).toBe(24);
    expect(prs).toBe(2);
    expect(REFRESH_MS).toBe(5000);
  });
});
