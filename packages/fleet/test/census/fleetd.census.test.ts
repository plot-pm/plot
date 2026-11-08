import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { between, treeOf } from './census-session.js';
import { CENSUS_ROWS, recordCount, rowTitle } from './census-rows.js';
import type { CensusFixture } from './census-report.js';
import { buildFleetdEntry, type FleetdEntry } from './fleetd-entry-build.js';
import { startFleetd } from './fleetd-driver.js';
import { buildSandbox, githubPr, type Sandbox } from './sandbox.js';
import { censusGate, findStrace } from './strace-run.js';
import type { ExecRecord, StraceCensus } from './strace-execs.js';

// fleetd per completed pass (S4, S5, S6, P2, P3, P4), counted under `strace -f`
// over the census entry, which runs fleetd's `run` in its loop mode on a clock
// it drives. Pass 1 warms every loop and is never counted; passes 2 and 3 are
// idle; on the GitHub fixture with desks, pass 4 follows one desk commit (S5)
// and pass 5 follows one PR's CI turning green (S6).

const gate = censusGate({ stracePath: findStrace(process.env['PATH'] ?? ''), platform: process.platform });

const IDLE_PASSES = ['pass-2', 'pass-3'] as const;

/** The idle fixtures of S4: GitHub with no desk and with three, Bitbucket with three. */
const FIXTURES: CensusFixture[] = [
  { host: 'github', desks: 0, openPrs: 5 },
  { host: 'github', desks: 3, openPrs: 5 },
  { host: 'bitbucket', desks: 3, openPrs: 5 },
];

const basename = (path: string): string => path.split('/').pop() ?? path;

const isFixedAnswer = (e: ExecRecord): boolean =>
  basename(e.path) === 'git' &&
  e.argv.includes('rev-parse') &&
  (e.argv.includes('--show-toplevel') || e.argv.includes('--git-common-dir'));

const isBackendAsk = (e: ExecRecord): boolean =>
  basename(e.path) === 'bash' && e.argv.some((a) => a.endsWith('/plot-host.sh')) && e.argv.includes('backend');

const isKillZero = (e: ExecRecord): boolean =>
  basename(e.path) === 'bash' && e.argv[1] === '-c' && /^kill -0 \d+/.test(e.argv[2] ?? '');

let entry: FleetdEntry | undefined;

beforeAll(async () => {
  if (gate.kind === 'run') entry = await buildFleetdEntry();
}, 120_000);

afterAll(() => {
  entry?.remove();
});

describe.skipIf(gate.kind !== 'run').each(FIXTURES)('fleetd on $host, $desks desks, $openPrs open PRs', (fixture) => {
  let box: Sandbox;
  let census: StraceCensus;
  let root = 0;
  const withChanges = fixture.host === 'github' && fixture.desks > 0;
  /** The images each idle pass started, by its closing mark. */
  const idle = new Map<string, ExecRecord[]>();

  beforeAll(async () => {
    box = await buildSandbox(fixture);
    const fleetd = startFleetd(entry as FleetdEntry, box, { trace: true });
    try {
      for (let n = 0; n < 3; n += 1) await fleetd.pass();
      if (withChanges) {
        const desk = box.desks[0];
        if (desk === undefined) throw new Error('process census: the fixture holds no desk');
        writeFileSync(join(desk.worktree, 'census.txt'), 'one desk commit\n');
        box.git(desk.worktree, 'add', 'census.txt');
        box.git(desk.worktree, 'commit', '--quiet', '-m', 'census: one desk commit');
        await fleetd.pass();
        const sha = box.git(box.repo, 'rev-parse', 'HEAD');
        const green = Array.from({ length: fixture.openPrs }, (_, i) =>
          githubPr(i + 1, `feature/census-slice-${i + 1}`, sha, i === 0 ? 'SUCCESS' : 'PENDING', i === 0 ? '2026-01-02T00:00:00Z' : undefined),
        );
        box.answer('gh', 'pr-list-open', green);
        box.answer('gh', 'pr-list-all', green);
        box.answer('gh', 'pr-list-open-head-feature_census-slice-1', [green[0]]);
        box.answer('gh', 'pr-list-all-head-feature_census-slice-1', [green[0]]);
        await fleetd.pass();
      }
    } finally {
      const end = await fleetd.stop();
      if (end.census === null) throw new Error('process census: the fleetd run was not traced');
      census = end.census;
    }
    const launcher = census.execs.find((e) => e.ppid === null && e.argv.some((a) => a.endsWith('launch.mjs')));
    if (launcher === undefined) throw new Error('process census: no fleetd node process in the trace');
    root = launcher.pid;
    for (const label of IDLE_PASSES) {
      const from = label === 'pass-2' ? 'pass-1' : 'pass-2';
      idle.set(label, treeOf(census, between(census.execs, from, label), root));
    }
  }, 900_000);

  afterAll(async () => {
    await box?.remove();
  });

  const perPass = (pick: (e: ExecRecord) => boolean): { mean: number; each: number[]; execs: ExecRecord[] } => {
    const each = IDLE_PASSES.map((l) => (idle.get(l) ?? []).filter(pick).length);
    const execs = IDLE_PASSES.flatMap((l) => (idle.get(l) ?? []).filter(pick));
    return { mean: each.reduce((a, b) => a + b, 0) / each.length, each, execs };
  };

  it('traces fleetd through its warm pass and two idle passes', () => {
    expect(root).toBeGreaterThan(0);
    expect(treeOf(census, between(census.execs, null, 'pass-1'), root).length).toBeGreaterThan(0);
  });

  it.fails(rowTitle(CENSUS_ROWS.S4, fixture), () => {
    const { mean, each, execs } = perPass(() => true);
    recordCount(CENSUS_ROWS.S4, fixture, mean, execs);
    expect(each).toEqual([0, 0]);
  });

  if (fixture.desks > 0) {
    it.fails(rowTitle(CENSUS_ROWS.P2, fixture), () => {
      const { mean, each, execs } = perPass(isKillZero);
      recordCount(CENSUS_ROWS.P2, fixture, mean, execs);
      expect(each).toEqual([0, 0]);
    });
  }

  it.fails(rowTitle(CENSUS_ROWS.P3, fixture), () => {
    const { mean, each, execs } = perPass((e) => e.ppid === root && (isFixedAnswer(e) || isBackendAsk(e)));
    recordCount(CENSUS_ROWS.P3, fixture, mean, execs);
    expect(each).toEqual([0, 0]);
  });

  it.fails(rowTitle(CENSUS_ROWS.P4, fixture), () => {
    const { mean, each, execs } = perPass(isFixedAnswer);
    recordCount(CENSUS_ROWS.P4, fixture, mean, execs);
    expect(each).toEqual([0, 0]);
  });

  if (withChanges) {
    it(rowTitle(CENSUS_ROWS.S5, fixture), () => {
      const execs = treeOf(census, between(census.execs, 'pass-3', 'pass-4'), root);
      recordCount(CENSUS_ROWS.S5, fixture, execs.length, execs);
      expect(execs.length).toBeGreaterThan(0);
    });

    it(rowTitle(CENSUS_ROWS.S6, fixture), () => {
      const execs = treeOf(census, between(census.execs, 'pass-4', 'pass-5'), root);
      recordCount(CENSUS_ROWS.S6, fixture, execs.length, execs);
      expect(execs.length).toBeGreaterThan(0);
    });
  }
});
