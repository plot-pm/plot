import { existsSync, readFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { buildFleetdEntry, type FleetdEntry } from './fleetd-entry-build.js';
import { spawnLogOf, startFleetd } from './fleetd-driver.js';
import { buildSandbox, type Sandbox } from './sandbox.js';

// The census entry, run without `strace`: it must drive fleetd's `run` through
// completed passes on the manual clock, reach the calls the census rows count,
// and stop cleanly. The strace rows in `fleetd.census.test.ts` count the same
// passes on Linux, on GitHub and Bitbucket. This file runs the GitHub fixture
// only: on the Bitbucket fixture a pass takes about 2 minutes, because a rich
// `pr-list` sweep that fleetd starts runs into `runProcess`'s 120 s bound.
// `sandbox.unit.test.ts` covers the Bitbucket stubs.

type Spawn = { file: string; args: string[] };

const spawnsOf = (box: Sandbox): Spawn[] =>
  existsSync(spawnLogOf(box))
    ? readFileSync(spawnLogOf(box), 'utf8')
        .split('\n')
        .filter((l) => l !== '')
        .map((l) => JSON.parse(l) as Spawn)
    : [];

let entry: FleetdEntry;

beforeAll(async () => {
  entry = await buildFleetdEntry();
}, 120_000);

afterAll(() => {
  entry?.remove();
});

describe.each(['github'] as const)('the fleetd census entry on a %s fixture', (host) => {
  let box: Sandbox;
  let spawns: Spawn[] = [];
  let stdout = '';

  beforeAll(async () => {
    box = await buildSandbox({ host, desks: 3, openPrs: 5 });
    const fleetd = startFleetd(entry, box, { trace: false, spawnLog: spawnLogOf(box) });
    try {
      expect(await fleetd.pass()).toBe(1);
      expect(await fleetd.pass()).toBe(2);
    } finally {
      stdout = (await fleetd.stop()).stdout;
      spawns = spawnsOf(box);
    }
  }, 300_000);

  afterAll(async () => {
    await box?.remove();
  });

  it('completes passes and stops with exit 0', () => {
    expect(stdout).toMatch(/^census: pass 2 done$/m);
    expect(stdout).toMatch(/^census: stopped 0$/m);
    expect(stdout).toMatch(/^plot-fleetd: supervising /m);
  });

  it('reaches processes.isAlive for each desk with a live worker pid (P2 counts these)', () => {
    const alive = spawns.filter((s) => s.file === 'bash' && s.args[0] === '-c' && /^kill -0 \d+/.test(s.args[1] ?? ''));
    const asked = new Set(alive.map((s) => Number(/kill -0 (\d+)/.exec(s.args[1] ?? '')?.[1])));

    for (const desk of box.desks) expect(asked).toContain(desk.worker.pid);
  });

  it('asks the stub host CLI, never the network', () => {
    const log = readFileSync(box.stubLog, 'utf8');

    expect(log).toMatch(/^gh pr list/m);
  });

  it('leaves every stub worker alive: fleetd does not end a live desk', () => {
    for (const desk of box.desks) expect(() => process.kill(desk.worker.pid, 0)).not.toThrow();
  });
});
