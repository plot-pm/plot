import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { bridgePath, BRIDGE_MAX_AGE_MS, fleetStateFile } from '../src/adapters/fleet-state/fleet-state-file.js';
import { isAnswered } from '../src/port-result.js';
import type { FleetReading } from '../src/entities/fleet.js';
import type { BridgedPulse } from '../src/ports/fleet-state.js';

// The rules the port lives by, mirrored from `packages/board/test/unit/pulse-bridge.test.ts`
// — the board-side module this adapter replaces. Same fixture shape, same
// boundaries (expiry, a clock that moved, a shape from another build, a file
// somebody truncated), read through the port's `answered`/`failed` vocabulary
// instead of `null`/thrown.

const SLICES: FleetReading['plans'][number]['slices'] = [{
  name: 'One',
  verdict: 'eligible',
  branches: [{
    branch: 'feature/a', state: 'claimed', deferred: false, deferred_reason: '',
    claimed: 'claimed: someone',
    local_dirty: false, local_worktree: '', local_ahead: 0, local_locked: false,
    changed_ago_seconds: null,
    changed_at: null,
    worker: 'elsewhere', worker_pid: '', worker_exit: '', worker_activity: '',
    conflicts: [], conflicts_known: false, changed_paths: [], held: false,
    ref_held: false,
    waits_on: [],
    worker_dirty_paths: [],
  }],
}];

const PULSE: FleetReading = {
  main: 'main',
  head: 'abc1234',
  plans: [{
    file: '2026-08-17-a-plan.md',
    phase: 'approved',
    slices: SLICES,
  }],
  summary: {
    plans: 1, waves: 1, branches: 1, claimed: 1, eligible: 0, blocked: 0, deferred: 0,
    waiting: 0, prereq_missing: 0,
    host: 'unknown' as const,
  },
};

const bridged = (at: number): BridgedPulse => ({
  at,
  pulse: PULSE,
  ages: new Map<string, number | null>([['feature/a', 7], ['feature/unknown', null]]),
  branchUrlBase: 'https://github.com/plot-pm/plot/tree/',
  approvedAt: new Map<string, number>([['2026-08-17-a-plan.md', 1_700_000_000_000]]),
  ideaPlans: new Map<string, string>([['idea/a-plan', '2026-08-17-a-plan.md']]),
});

let repo: string;

beforeEach(() => {
  repo = fs.mkdtempSync(path.join(os.tmpdir(), 'plot-fleet-state-unit-'));
});

afterEach(() => {
  fs.rmSync(repo, { recursive: true, force: true });
});

describe('the fleet state port round-trips what a restart needs', () => {
  it('restores the pulse and every map beside it', async () => {
    const state = fleetStateFile({ repoRoot: repo });
    const now = Date.now();
    await state.write(bridged(now));
    const result = await state.read();
    expect(isAnswered(result)).toBe(true);
    const value = result.ok ? result.value : null;
    expect(value).not.toBeNull();
    expect(value!.pulse).toEqual(PULSE);
    expect(value!.ages.get('feature/a')).toBe(7);
    expect(value!.ages.get('feature/unknown')).toBeNull();
    expect(value!.branchUrlBase).toBe('https://github.com/plot-pm/plot/tree/');
    expect(value!.approvedAt.get('2026-08-17-a-plan.md')).toBe(1_700_000_000_000);
    expect(value!.ideaPlans.get('idea/a-plan')).toBe('2026-08-17-a-plan.md');
  });

  it('answers readSync with what read answers, and null past the expiry', async () => {
    const state = fleetStateFile({ repoRoot: repo });
    const now = Date.now();
    await state.write(bridged(now));
    const sync = state.readSync();
    expect(sync.ok && sync.value?.pulse).toEqual(PULSE);
    expect(sync.ok && sync.value?.ages.get('feature/a')).toBe(7);
    const aged = fleetStateFile({ repoRoot: repo, now: () => now + BRIDGE_MAX_AGE_MS + 1 });
    const expired = aged.readSync();
    expect(expired.ok && expired.value).toBeNull();
  });

  it('keeps the SCAN time rather than the write time', async () => {
    const scannedAt = Date.now() - 90_000;
    const state = fleetStateFile({ repoRoot: repo });
    await state.write(bridged(scannedAt));
    const result = await state.read();
    expect(result.ok && result.value?.at).toBe(scannedAt);
  });

  it('writes under .plot/state, machine-local by construction', async () => {
    const state = fleetStateFile({ repoRoot: repo });
    await state.write(bridged(Date.now()));
    expect(fs.existsSync(bridgePath(repo))).toBe(true);
    expect(bridgePath(repo)).toBe(path.join(repo, '.plot', 'state', 'last-pulse.json'));
  });

  it('leaves no temp file behind', async () => {
    const state = fleetStateFile({ repoRoot: repo });
    await state.write(bridged(Date.now()));
    const dir = path.dirname(bridgePath(repo));
    expect(fs.readdirSync(dir)).toEqual(['last-pulse.json']);
  });
});

describe('the fleet state port expires — it is a bridge, not a store', () => {
  it('serves a pulse just inside the window', async () => {
    const now = Date.now();
    const state = fleetStateFile({ repoRoot: repo, now: () => now });
    await state.write(bridged(now - (BRIDGE_MAX_AGE_MS - 1_000)));
    const result = await state.read();
    expect(result.ok && result.value).not.toBeNull();
  });

  it('refuses one just outside it', async () => {
    const now = Date.now();
    const state = fleetStateFile({ repoRoot: repo, now: () => now });
    await state.write(bridged(now - (BRIDGE_MAX_AGE_MS + 1_000)));
    const result = await state.read();
    expect(result.ok && result.value).toBeNull();
  });

  it('refuses one stamped in the FUTURE', async () => {
    const now = Date.now();
    const state = fleetStateFile({ repoRoot: repo, now: () => now });
    await state.write(bridged(now + 60_000));
    const result = await state.read();
    expect(result.ok && result.value).toBeNull();
  });
});

describe('the fleet state port refuses anything it cannot trust, but never as a failure', () => {
  it('answers null when there is no file at all', async () => {
    const state = fleetStateFile({ repoRoot: repo });
    const result = await state.read();
    expect(result).toEqual({ ok: true, value: null });
  });

  it('answers null for a truncated file rather than failing', async () => {
    fs.mkdirSync(path.dirname(bridgePath(repo)), { recursive: true });
    fs.writeFileSync(bridgePath(repo), '{"version":1,"at":', 'utf8');
    const state = fleetStateFile({ repoRoot: repo });
    const result = await state.read();
    expect(result).toEqual({ ok: true, value: null });
  });

  it('answers null for a payload from another version', async () => {
    fs.mkdirSync(path.dirname(bridgePath(repo)), { recursive: true });
    fs.writeFileSync(bridgePath(repo), JSON.stringify({ version: 99, at: Date.now() }), 'utf8');
    const state = fleetStateFile({ repoRoot: repo });
    const result = await state.read();
    expect(result).toEqual({ ok: true, value: null });
  });

  it('answers null for a pulse that no longer validates', async () => {
    fs.mkdirSync(path.dirname(bridgePath(repo)), { recursive: true });
    fs.writeFileSync(bridgePath(repo), JSON.stringify({
      version: 1, at: Date.now(), pulse: { plans: 'not an array' },
    }), 'utf8');
    const state = fleetStateFile({ repoRoot: repo });
    const result = await state.read();
    expect(result).toEqual({ ok: true, value: null });
  });

  it('drops malformed map entries instead of guessing at them', async () => {
    const now = Date.now();
    fs.mkdirSync(path.dirname(bridgePath(repo)), { recursive: true });
    fs.writeFileSync(bridgePath(repo), JSON.stringify({
      version: 1,
      at: now,
      pulse: PULSE,
      ages: [['feature/a', 7], ['feature/b', 'soon'], [42, 1], 'nonsense'],
      branchUrlBase: 12,
      approvedAt: null,
      ideaPlans: [['idea/x', 'x.md']],
    }), 'utf8');
    const state = fleetStateFile({ repoRoot: repo, now: () => now });
    const result = await state.read();
    expect(result.ok).toBe(true);
    const value = result.ok ? result.value : null;
    expect(value!.ages.size).toBe(1);
    expect(value!.ages.get('feature/a')).toBe(7);
    expect(value!.branchUrlBase).toBe('');
    expect(value!.approvedAt.size).toBe(0);
    expect(value!.ideaPlans.get('idea/x')).toBe('x.md');
  });

  it('fails the write rather than throwing when the repo cannot be written to', async () => {
    const blocked = path.join(repo, 'not-a-directory');
    fs.writeFileSync(blocked, 'this is a file', 'utf8');
    const state = fleetStateFile({ repoRoot: blocked });
    const writeResult = await state.write(bridged(Date.now()));
    expect(writeResult.ok).toBe(false);
    const readResult = await state.read();
    expect(readResult).toEqual({ ok: true, value: null });
  });
});
