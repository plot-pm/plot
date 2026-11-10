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

/** `git cat-file -e` starts per pass on the GitHub fixture with 3 desks: one per `fileExistsSync` call. */
const CAT_FILE_E_PER_PASS = 0;

type Spawn = { file?: string; args?: string[]; signal0?: number; sync?: boolean };

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

  it('asks kill(pid, 0) for each desk with a live worker pid, so P2 reading 0 means the question was asked without bash', () => {
    const asked = new Set(spawns.flatMap((s) => (s.signal0 === undefined ? [] : [s.signal0])));
    const killZero = spawns.filter((s) => s.file === 'bash' && s.args?.[0] === '-c' && /^kill -0 \d+/.test(s.args[1] ?? ''));

    for (const desk of box.desks) expect(asked).toContain(desk.worker.pid);
    expect(killZero).toEqual([]);
  });

  it('reads objects through one cat-file process: no ls-tree, cat-file --batch or --batch-check in either pass', () => {
    const git = spawns.filter((s) => s.file === 'git').map((s) => (s.args ?? []).filter((a) => !a.startsWith('--git-dir')));
    const named = (first: string, second?: string): number =>
      git.filter((args) => args[0] === first && (second === undefined || args[1] === second)).length;
    const perPass = (n: number): number => n / 2;

    expect(named('ls-tree')).toBe(0);
    expect(named('cat-file', '--batch')).toBe(0);
    expect(named('cat-file', '--batch-check')).toBe(0);
    expect(named('cat-file', '--batch-command')).toBe(1);
    // `fileExistsSync` keeps one `cat-file -e` per call: this fixture's count per pass.
    expect(perPass(named('cat-file', '-e'))).toBe(CAT_FILE_E_PER_PASS);
    // The log sees synchronous starts, so the zero above is a count and not a blind spot.
    expect(spawns.filter((s) => s.sync === true).map((s) => s.file)).toContain('git');
  });

  it('asks the stub host CLI, never the network', () => {
    const log = readFileSync(box.stubLog, 'utf8');

    expect(log).toMatch(/^gh pr list/m);
  });

  it('leaves every stub worker alive: fleetd does not end a live desk', () => {
    for (const desk of box.desks) expect(() => process.kill(desk.worker.pid, 0)).not.toThrow();
  });
});
