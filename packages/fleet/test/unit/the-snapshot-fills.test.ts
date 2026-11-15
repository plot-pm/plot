import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { READING_KEYS, type ReadingKey } from '@plot-pm/domain/entities/snapshot';
import { clockManual } from '@plot-pm/domain/adapters/clock/clock-system';

import { run } from '../../src/server/entry/registryd-main.js';
import { fleetDivisors } from '../../src/shared/fleet-clock.js';
import { createSnapshotHolder, failUnread, readOf, registryEntryOf } from '../../src/shared/snapshot-fill.js';
import { parseManifest } from '../../src/shared/registry.js';
import { buildSandbox, type Sandbox } from '../census/sandbox.js';

// The census fixture for GitHub: three desks, five open PRs. fleetd runs its
// own `run` against it, in-process, with the sandbox's environment.

const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b));
const beatsPerPass = fleetDivisors().reduce((acc, { everyNthBeat }) => (acc * everyNthBeat) / gcd(acc, everyNthBeat), 1);

const states = (holder: ReturnType<typeof createSnapshotHolder>): Record<ReadingKey, string> =>
  Object.fromEntries(READING_KEYS.map((key) => [key, holder.current().readings[key].state])) as Record<ReadingKey, string>;

describe('fleetd fills the snapshot from the readings its loops already take', () => {
  let box: Sandbox;
  const savedEnv = { ...process.env };

  beforeAll(async () => {
    box = await buildSandbox({ host: 'github', desks: 3, openPrs: 5 });
    Object.assign(process.env, box.env);
  }, 120_000);

  afterAll(async () => {
    for (const key of Object.keys(process.env)) if (!(key in savedEnv)) delete process.env[key];
    Object.assign(process.env, savedEnv);
    await box.remove();
  }, 60_000);

  it('a --once pass leaves every key read or failed, none unread', async () => {
    const snapshot = createSnapshotHolder();
    const warned: string[] = [];
    const code = await run(
      ['--once'],
      join(box.scriptsDir, 'board'),
      () => undefined,
      undefined,
      () => false,
      (line) => warned.push(line),
      box.repo,
      { snapshot, probeAppKeys: () => undefined },
    );
    expect(code).toBe(0);
    const held = snapshot.current();
    for (const key of READING_KEYS) expect(['read', 'failed'], `${key} ${held.readings[key].state}`).toContain(held.readings[key].state);
    const registry = held.readings.registry;
    expect(registry.state).toBe('read');
    if (registry.state === 'read') {
      expect(registry.value.map((entry) => entry.branch).sort()).toEqual(['feature/census-slice-1', 'feature/census-slice-2', 'feature/census-slice-3']);
    }
    const prs = held.readings.prs;
    expect(prs.state === 'failed' && prs.reason).toBe('not read: --once runs the tick alone');
  }, 120_000);

  it('a looping pass reads every key the loops take', async () => {
    const snapshot = createSnapshotHolder();
    const clock = clockManual(Date.now());
    let stopped = false;
    let release: () => void = () => undefined;
    const requested = new Promise<void>((resolve) => (release = resolve));
    // AN ARMED WATCH NEVER SLEEPS: the loop has started once it logs `supervising`.
    let supervising = false;
    const daemon = run(
      ['--interval', '60'],
      join(box.scriptsDir, 'board'),
      (s: string) => {
        if (s.includes('plot-fleetd: supervising')) supervising = true;
      },
      undefined,
      Object.assign(() => stopped, { requested }),
      () => undefined,
      box.repo,
      { snapshot, clock, probeAppKeys: () => undefined },
    );
    const until = async (done: () => boolean, ms: number): Promise<void> => {
      const end = Date.now() + ms;
      while (!done() && Date.now() < end) await new Promise((r) => setTimeout(r, 100));
    };
    await until(() => supervising, 60_000);
    clock.advance(beatsPerPass);
    await until(() => READING_KEYS.every((key) => snapshot.current().readings[key].state !== 'unread'), 90_000);
    const seen = states(snapshot);
    stopped = true;
    release();
    await daemon;
    for (const key of READING_KEYS) expect(['read', 'failed'], `${key} ${seen[key]}`).toContain(seen[key]);
    const held = snapshot.current().readings;
    expect(held.desks.state).toBe('read');
    expect(held.plans.state).toBe('read');
    expect(held.refs.state).toBe('read');
    expect(held.config.state).toBe('read');
    expect(held.prs.state).toBe('read');
    if (held.prs.state === 'read') expect(held.prs.value).toHaveLength(5);
    if (held.desks.state === 'read') expect(held.desks.value.filter((desk) => !desk.isMain)).toHaveLength(3);
    for (const key of ['walk', 'branchDates', 'ideaPlans', 'releaseVersions', 'unmerged', 'questions', 'branchPlans', 'sprints', 'stories'] as const) {
      expect(held[key].state, key).toBe('read');
    }
    if (held.plans.state === 'read') {
      expect(held.plans.value.resolved).toMatch(/^[0-9a-f]{40}$/);
      expect(held.plans.value.authors.state).toBe('read');
      expect(held.plans.value.delivered.state).toBe('read');
      expect(held.plans.value.records.every((r) => Array.isArray(r.issues))).toBe(true);
    }
    if (held.walk.state === 'read') expect(held.walk.value.desks.desks).toHaveLength(3);
  }, 240_000);
});

describe('the snapshot helpers', () => {
  it('registryEntryOf reads the slug the entry does not carry', () => {
    const text = JSON.stringify({ session: 's', branch: 'b', slug: 'plan-x', worktree: '/w', pid: '12' });
    const entry = parseManifest(text);
    expect(entry).not.toBeNull();
    expect(registryEntryOf(entry!, text).slug).toBe('plan-x');
    expect(registryEntryOf(entry!, '{not json').slug).toBe('');
    expect(registryEntryOf(entry!, '[]').slug).toBe('');
  });

  it('failUnread closes only the keys no read produced', () => {
    const holder = createSnapshotHolder();
    holder.record('registry', readOf([]));
    failUnread(holder, 'not read: test');
    expect(holder.current().readings.registry.state).toBe('read');
    expect(holder.current().readings.prs).toMatchObject({ state: 'failed', reason: 'not read: test' });
  });

  it('an equal reading keeps the generation', () => {
    const holder = createSnapshotHolder();
    holder.record('registry', readOf([], 1));
    const generation = holder.current().generation;
    holder.record('registry', readOf([], 2));
    expect(holder.current().generation).toBe(generation);
  });
});
