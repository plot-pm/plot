import { execFileSync } from 'node:child_process';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { fleetStateIn } from '@plot-pm/domain/adapters';
import { stateHomeAtSync } from '@plot-pm/domain/adapters/main-checkout';
import type { FleetState } from '@plot-pm/domain/ports/fleet-state';
import type { Refs } from '@plot-pm/domain/ports/refs';
import type { Scripts } from '@plot-pm/domain/ports/scripts';

import { fleetScan } from '../../src/shared/fleet-clock.js';
import { freshScanState, type ScanWorld } from '../../src/shared/fleet-scan.js';
import { emptyWalk, withWalkRefs } from './walk-fake.js';
import { saidListingWorld } from './listing-over-said.js';
import { removeTree as rmTree } from '../rm-tree.mjs';

// A characterisation of the bridge: fleetd writes `last-pulse.json` whole only
// through `writeScan`, after `scanOnce` returns, and `recordAttempt` rewrites
// only `attempt`. So a bridge file on disk always carries a finished scan's
// pulse, which is why the bridge carries no `complete` field.

const ok = <T>(value: T) => ({ ok: true as const, value });

const refsFake = withWalkRefs({
  branchDates: async () => ok([{ branch: 'feature/a', committedAt: Date.now() / 1000 - 600 }]),
  remoteUrl: async () => ok('git@github.com:plot-pm/plot.git'),
} as unknown as Partial<Refs>);

/** Refs whose branch tips cannot be read, so the scan throws. */
const brokenRefs = withWalkRefs({ branchTips: async () => ({ ok: false as const }) } as unknown as Partial<Refs>);

const scriptsFake = (): Scripts => ({
  stream: async () => { throw new Error('plot-fleet-scan.sh must not run'); },
  hostSaid: async () => ({ answer: 'unaskable', stdout: '' }),
  config: async () => ok('docs/plans/'),
  planMeta: async () => ok(JSON.stringify({ file: '2026-10-09-a-plan.md', approved_raw: '2026-10-08' })),
} as unknown as Scripts);

let repo: string;
beforeEach(() => {
  repo = fs.mkdtempSync(path.join(os.tmpdir(), 'plot-fleet-clock-bridge-'));
  execFileSync('git', ['init', '-q', '-b', 'main', repo], { stdio: 'ignore' });
});
afterEach(() => {
  rmTree(repo);
});

const worldOver = (refs: Refs): ScanWorld => saidListingWorld({
  repoRoot: repo,
  scripts: scriptsFake(),
  refs,
  backend: async () => 'github',
  walk: emptyWalk(),
} as ScanWorld);

const scan = (state: FleetState, refs: Refs, now: () => number) =>
  fleetScan(worldOver(refs), state, freshScanState(), now, () => {}, () => null);

/** Every field of the bridge except `attempt`. */
const withoutAttempt = async (state: FleetState) => {
  const read = await state.read();
  if (!read.ok || read.value === null) throw new Error('the bridge did not read');
  const { attempt: _attempt, ...rest } = read.value;
  return rest;
};

describe('a bridge on disk is a finished scan\'s', () => {
  it('leaves every field except attempt unchanged when the scan throws', async () => {
    const state = fleetStateIn(stateHomeAtSync(repo));
    await scan(state, refsFake, () => Date.now())();
    const before = await withoutAttempt(state);
    await scan(state, brokenRefs, () => Date.now() + 60_000)();
    expect(await withoutAttempt(state)).toEqual(before);
    const read = await state.read();
    expect(read.ok && read.value?.attempt.outcome).toBe('failed');
  });

  it('leaves every field except attempt unchanged when the bridge write is refused', async () => {
    const real = fleetStateIn(stateHomeAtSync(repo));
    await scan(real, refsFake, () => Date.now())();
    const before = await withoutAttempt(real);
    // Refuses the whole-bridge write `writeScan` makes; passes `recordAttempt`'s.
    const refusing: FleetState = {
      read: () => real.read(),
      readSync: () => real.readSync(),
      write: async (pulse) => (pulse.attempt.outcome === 'ok' ? { ok: false } : real.write(pulse)),
    } as FleetState;
    await scan(refusing, refsFake, () => Date.now() + 60_000)();
    expect(await withoutAttempt(real)).toEqual(before);
    const read = await real.read();
    expect(read.ok && read.value?.attempt.outcome).toBe('running');
  });
});
