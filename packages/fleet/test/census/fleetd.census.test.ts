import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { between, treeOf } from './census-session.js';
import { CENSUS_ROWS, recordCount, rowTitle } from './census-rows.js';
import type { CensusFixture } from './census-report.js';
import { buildFleetdEntry, type FleetdEntry } from './fleetd-entry-build.js';
import { startFleetd } from './fleetd-driver.js';
import { buildSandbox, githubPr, type Sandbox } from './sandbox.js';
import { BITBUCKET_ROUTE } from './stub-host.js';
import { censusGate, findStrace } from './strace-run.js';
import type { ExecRecord, StraceCensus } from './strace-execs.js';

// fleetd per completed pass (S4, S5, S6, S8, P2, P3, P4, P5, P7, P8, P9, P10), counted under `strace -f`
// over the census entry, which runs fleetd's `run` in its loop mode on a clock
// it drives. Pass 1 warms every loop and is never counted; passes 2 and 3 are
// idle; on the GitHub fixture with desks, pass 4 follows one desk commit (S5)
// and pass 5 follows one PR's CI turning green (S6). The last pass on every
// fixture is a safety-net pass (S8): it moves the clock by the safety-net
// interval, so the full read it holds is a safety-net read.

const gate = censusGate({ stracePath: findStrace(process.env['PATH'] ?? ''), platform: process.platform });

const IDLE_PASSES = ['pass-2', 'pass-3'] as const;

/** The idle fixtures of S4: GitHub with no desk and with three, Bitbucket with three. */
const FIXTURES: CensusFixture[] = [
  { host: 'github', desks: 0, openPrs: 5 },
  { host: 'github', desks: 3, openPrs: 5 },
  { host: 'bitbucket', desks: 3, openPrs: 5 },
];

const basename = (path: string): string => path.split('/').pop() ?? path;

/** The safety net's stamp in the sandbox's `fleetd.json`; `undefined` where the file holds none. */
const lastSafetyNetAtOf = (box: Sandbox): number | null | undefined => {
  const path = join(box.repo, '.plot', 'state', 'fleetd.json');
  if (!existsSync(path)) return undefined;
  return (JSON.parse(readFileSync(path, 'utf8')) as { lastSafetyNetAt?: number | null }).lastSafetyNetAt;
};

const isFixedAnswer = (e: ExecRecord): boolean =>
  basename(e.path) === 'git' &&
  e.argv.includes('rev-parse') &&
  (e.argv.includes('--show-toplevel') || e.argv.includes('--git-common-dir'));

const isGitDirProbe = (e: ExecRecord): boolean =>
  basename(e.path) === 'git' && e.argv.includes('rev-parse') && e.argv.includes('--git-dir');

const isGitFetch = (e: ExecRecord): boolean => basename(e.path) === 'git' && e.argv.includes('fetch');

const isBackendAsk = (e: ExecRecord): boolean =>
  basename(e.path) === 'bash' && e.argv.some((a) => a.endsWith('/plot-host.sh')) && e.argv.includes('backend');

/** A beat reader P9 counts: `plot-host.sh spend-rate`, `plot-state-sync.mjs` or `plot-merger-token.mjs`. */
const isBeatReader = (e: ExecRecord): boolean => {
  const words = [e.path, ...e.argv];
  return (
    (words.some((a) => a.endsWith('/plot-host.sh')) && e.argv.includes('spend-rate')) ||
    words.some((a) => a.endsWith('/plot-state-sync.mjs') || a.endsWith('/plot-merger-token.mjs'))
  );
};

const isKillZero = (e: ExecRecord): boolean =>
  basename(e.path) === 'bash' && e.argv[1] === '-c' && /^kill -0 \d+/.test(e.argv[2] ?? '');

/**
 * A host read P5 counts: the stub `gh` listing PRs, issues or runs, or
 * `plot-host.sh` asked for one. A `gh pr list --head` is a per-branch merge
 * question (`pr-merged`, `pr-merged-heads`), which this plan leaves on the shell.
 */
const isGithubRead = (e: ExecRecord): boolean =>
  (basename(e.path) === 'gh' && /^(pr|issue|run)$/.test(e.argv[1] ?? '') && e.argv[2] === 'list' && !e.argv.includes('--head')) ||
  (basename(e.path) === 'bash' &&
    e.argv.some((a) => a.endsWith('/plot-host.sh')) &&
    e.argv.some((a) => a === 'pr-list' || a === 'issue-list' || a === 'runs-for-sha'));

/** The stub `gh` listing calls in the stub log so far: `gh pr list`, `gh issue list`, `gh run list`, with no `--head`. */
const ghReadsLogged = (box: Sandbox): number =>
  existsSync(box.stubLog)
    ? readFileSync(box.stubLog, 'utf8').split('\n').filter((l) => /^gh (pr|issue|run) list\b/.test(l) && !/ --head /.test(l)).length
    : 0;

/**
 * The in-process requests the stub API answered so far. On GitHub two
 * once-per-process requests are left out: `GET /user`, which names the token's
 * login, and the search-type introspection, which `gh` keeps in its on-disk
 * cache and so sends at most once a day. On Bitbucket only the requests under
 * the Bitbucket route count: the Jira reads share the server.
 */
const apiReads = (box: Sandbox): number =>
  (box.api?.requests() ?? []).filter((r) =>
    box.size.host === 'bitbucket'
      ? r.path.startsWith(`${BITBUCKET_ROUTE}/`)
      : r.path !== '/user' && !r.body.includes('SearchType_enumValues'),
  ).length;

/** The stub `bb api` calls in the stub log so far. */
const bbApiLogged = (box: Sandbox): number =>
  existsSync(box.stubLog) ? readFileSync(box.stubLog, 'utf8').split('\n').filter((l) => /^bb api\b/.test(l)).length : 0;

/**
 * A Bitbucket read P10 counts: a stub `bb api` listing, or `plot-host.sh` asked
 * for `pr-list`. A per-branch merge question (`pr-merged`: a `bb api` whose
 * query names `source.branch.name`) and the capability probes the shell runs
 * before any `bb` call (`bb --version`, `bb pr list --help`) stay on the shell,
 * as P5 leaves `gh pr list --head` there.
 */
const isBitbucketRead = (e: ExecRecord): boolean =>
  (basename(e.path) === 'bb' && e.argv[1] === 'api' && !e.argv.some((a) => a.includes('source.branch.name'))) ||
  (basename(e.path) === 'bash' && e.argv.some((a) => a.endsWith('/plot-host.sh')) && e.argv.includes('pr-list'));

/** Per-pass deltas of a running count, sampled after passes 1..n. */
const deltas = (samples: readonly number[]): number[] => samples.slice(1).map((n, i) => n - (samples[i] ?? 0));

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
  /** In-process requests per idle pass (passes 2 and 3), and the shell's `gh` listing calls per idle pass on the same fixture. */
  let requests: number[] = [];
  let baseline: number[] = [];
  /** The safety-net pass's number, and the stamps before it and after fleetd stopped. */
  let netPass = 0;
  let beforeNet: number | null | undefined;
  let afterNet: number | null | undefined;

  beforeAll(async () => {
    box = await buildSandbox(fixture);
    const fleetd = startFleetd(entry as FleetdEntry, box, { trace: true });
    const sampled: number[] = [];
    try {
      for (let n = 0; n < 3; n += 1) {
        await fleetd.pass();
        sampled.push(apiReads(box));
      }
      requests = deltas(sampled);
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
      beforeNet = lastSafetyNetAtOf(box);
      netPass = await fleetd.safetyNet();
    } finally {
      const end = await fleetd.stop();
      afterNet = lastSafetyNetAtOf(box);
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
    // THE BASELINE: the same fixture read through the shell, untraced, so P5
    // can hold the in-process requests to the `gh` or `bb api` calls they replace.
    {
      const shellBox = await buildSandbox(fixture);
      try {
        shellBox.env['PLOT_HOST_TRANSPORT'] = 'shell';
        const shellFleetd = startFleetd(entry as FleetdEntry, shellBox, { trace: false });
        const logged: number[] = [];
        try {
          for (let n = 0; n < 3; n += 1) {
            await shellFleetd.pass();
            logged.push(fixture.host === 'github' ? ghReadsLogged(shellBox) : bbApiLogged(shellBox));
          }
        } finally {
          await shellFleetd.stop();
        }
        baseline = deltas(logged);
      } finally {
        await shellBox.remove();
      }
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

  it(rowTitle(CENSUS_ROWS.S8, fixture), () => {
    const execs = treeOf(census, between(census.execs, `pass-${netPass - 1}`, `pass-${netPass}`), root);
    recordCount(CENSUS_ROWS.S8, fixture, execs.length, execs);
    expect(execs.length).toBeGreaterThan(0);
    expect(beforeNet).toEqual(expect.any(Number));
    expect(afterNet).toBeGreaterThan(beforeNet ?? Number.POSITIVE_INFINITY);
  });

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
    it(rowTitle(CENSUS_ROWS.P2, fixture), () => {
      const { mean, each, execs } = perPass(isKillZero);
      recordCount(CENSUS_ROWS.P2, fixture, mean, execs);
      expect(each).toEqual([0, 0]);
    });
  }

  it(rowTitle(CENSUS_ROWS.P3, fixture), () => {
    const { mean, each, execs } = perPass((e) => e.ppid === root && (isFixedAnswer(e) || isBackendAsk(e)));
    recordCount(CENSUS_ROWS.P3, fixture, mean, execs);
    expect(each).toEqual([0, 0]);
  });

  it(rowTitle(CENSUS_ROWS.P4, fixture), () => {
    const { mean, each, execs } = perPass(isFixedAnswer);
    recordCount(CENSUS_ROWS.P4, fixture, mean, execs);
    expect(each).toEqual([0, 0]);
  });

  it(rowTitle(CENSUS_ROWS.P7, fixture), () => {
    const { mean, each, execs } = perPass(isGitDirProbe);
    recordCount(CENSUS_ROWS.P7, fixture, mean, execs);
    expect(each).toEqual([0, 0]);
  });

  it(rowTitle(CENSUS_ROWS.P8, fixture), () => {
    const { mean, each, execs } = perPass(isGitFetch);
    recordCount(CENSUS_ROWS.P8, fixture, mean, execs);
    const parentOf = (e: ExecRecord): string => census.execs.find((p) => p.pid === e.ppid)?.argv.join(' ') ?? 'unknown';
    const started = execs.map((e) => `${e.argv.join(' ')} <- ${parentOf(e)}`).join('\n');
    expect(each, started).toEqual([0, 0]);
  });

  if (fixture.host === 'github') {
    it(rowTitle(CENSUS_ROWS.P9, fixture), () => {
      const { mean, each, execs } = perPass(isBeatReader);
      recordCount(CENSUS_ROWS.P9, fixture, mean, execs);
      expect(each).toEqual([0, 0]);
    });

    it(rowTitle(CENSUS_ROWS.P5, fixture), () => {
      const { mean, each, execs } = perPass(isGithubRead);
      recordCount(CENSUS_ROWS.P5, fixture, mean, execs);
      console.log(`process census P5 ${fixture.desks} desks: in-process requests per idle pass ${requests.join(', ')}; shell gh listing calls ${baseline.join(', ')}`);
      expect(each).toEqual([0, 0]);
      expect(requests).toHaveLength(2);
      expect(baseline).toHaveLength(2);
      // OVER BOTH IDLE PASSES, NOT PASS BY PASS: a periodic read falls in either
      // pass, and the in-process and shell runs need not phase alike.
      const sum = (ns: readonly number[]): number => ns.reduce((a, b) => a + b, 0);
      expect(sum(requests)).toBeLessThanOrEqual(sum(baseline));
    });
  }

  if (fixture.host === 'bitbucket') {
    it(rowTitle(CENSUS_ROWS.P10, fixture), () => {
      const { mean, each, execs } = perPass(isBitbucketRead);
      recordCount(CENSUS_ROWS.P10, fixture, mean, execs);
      console.log(`process census P10 ${fixture.desks} desks: in-process requests per idle pass ${requests.join(', ')}; shell bb api calls ${baseline.join(', ')}`);
      expect(each).toEqual([0, 0]);
      expect(requests).toHaveLength(2);
      expect(baseline).toHaveLength(2);
      const sum = (ns: readonly number[]): number => ns.reduce((a, b) => a + b, 0);
      expect(sum(requests)).toBeLessThanOrEqual(sum(baseline));
    });
  }

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
