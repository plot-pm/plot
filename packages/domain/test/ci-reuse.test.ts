import { describe, expect, it } from 'vitest';

import {
  REUSE_KEYS,
  ciReuse,
  parseCiReuseReadings,
  reuseDiff,
  reuseOutput,
  type CiReuseReadings,
  type EarlierRun,
  type JobMap,
  type JobReuse,
  type ReuseKey,
} from '../src/rules/ci-reuse.js';

const BASE = 'a'.repeat(40);
const OTHER_BASE = 'b'.repeat(40);
const HEAD = 'c'.repeat(40);
const H1 = 'd'.repeat(40);
const H0 = 'e'.repeat(40);

const SELECTION = {
  corpus: 'true',
  corpus_tests: 'corpus/refs.corpus.test.ts',
  contracts: 'true',
  contracts_tests: 'test/reconcile/host.test.mjs',
  board: 'true',
  domain: 'true',
  fleet: 'true',
  e2e: 'true',
  macos: 'true',
  census: 'true',
};

const NOTHING: JobMap = { corpus: false, contracts: false, board: false, macos: false, census: false };

const GREEN = {
  corpus: 'success',
  'macos-shell-contract': 'success',
  'helper-contracts': 'success',
  'board-integration': 'success',
  'census-head': 'success',
  'census-base': 'success',
  'census-compare': 'success',
};

const run = (over: Partial<EarlierRun> = {}): EarlierRun => ({
  id: 101,
  pullRequests: [7],
  headSha: H1,
  conclusion: 'success',
  record: { base: BASE, head: H1, selection: SELECTION },
  jobs: GREEN,
  jobMap: NOTHING,
  ...over,
});

const readings = (runs: EarlierRun[], over: Partial<CiReuseReadings> = {}): CiReuseReadings => ({
  event: 'pull_request',
  headRef: 'infra/x',
  runAttempt: 1,
  pullRequest: 7,
  base: BASE,
  head: HEAD,
  selection: SELECTION,
  runs,
  ...over,
});

const of = (answer: readonly JobReuse[], key: ReuseKey): JobReuse => {
  const found = answer.find((a) => a.key === key);
  if (found === undefined) throw new Error(`no answer for ${key}`);
  return found;
};

const reasons = (answer: readonly JobReuse[]): string[] => answer.map((a) => (a.reused ? 'reused' : a.reason));

describe('ciReuse', () => {
  it('answers every reusable job, in a fixed order', () => {
    expect(ciReuse(readings([])).map((a) => a.key)).toEqual([...REUSE_KEYS]);
    expect(reasons(ciReuse(readings([])))).toEqual(REUSE_KEYS.map(() => 'no record'));
  });

  it('reuses every job of an earlier green run on the same base whose diff selects nothing', () => {
    const answer = ciReuse(readings([run()]));
    for (const a of answer) {
      expect(a).toMatchObject({ reused: true, value: `reused:${H1}`, runId: 101, headSha: H1, base: BASE, conclusion: 'success' });
    }
    expect(of(answer, 'census').job).toBe('census-compare');
  });

  it('a moved base reuses nothing and stops at that run', () => {
    const answer = ciReuse(readings([run({ record: { base: OTHER_BASE, head: H1, selection: SELECTION } }), run({ id: 99 })]));
    expect(reasons(answer)).toEqual(REUSE_KEYS.map(() => 'base moved'));
  });

  it('a cancelled run is a source for its green jobs, and a cancelled job is no source', () => {
    const answer = ciReuse(
      readings([run({ conclusion: 'cancelled', jobs: { ...GREEN, 'board-integration': 'cancelled' } })]),
    );
    expect(of(answer, 'contracts')).toMatchObject({ reused: true, conclusion: 'cancelled' });
    expect(of(answer, 'board')).toMatchObject({ reused: false, reason: 'not green' });
  });

  it('a failed run is a source for its green jobs and names its conclusion', () => {
    const answer = ciReuse(readings([run({ conclusion: 'failure', jobs: { ...GREEN, 'census-compare': 'failure' } })]));
    expect(of(answer, 'board')).toMatchObject({ reused: true, conclusion: 'failure', runId: 101 });
    expect(of(answer, 'census')).toMatchObject({ reused: false, reason: 'not green' });
  });

  it('reuse never chains: a job the newest run skipped takes the older run that ran it, or none', () => {
    const skipped = run({ id: 102, headSha: HEAD, record: { base: BASE, head: HEAD, selection: SELECTION }, jobs: { ...GREEN, 'board-integration': 'skipped' } });
    const older = run({ id: 100, headSha: H0, record: { base: BASE, head: H0, selection: SELECTION } });
    expect(of(ciReuse(readings([skipped, older])), 'board')).toMatchObject({ reused: true, runId: 100, headSha: H0 });
    expect(of(ciReuse(readings([skipped, older])), 'contracts')).toMatchObject({ reused: true, runId: 102 });
    expect(of(ciReuse(readings([skipped])), 'board')).toMatchObject({ reused: false, reason: 'not green' });
  });

  it('a head change whose job map names board true leaves board to run', () => {
    const answer = ciReuse(readings([run({ jobMap: { ...NOTHING, board: true } })]));
    expect(of(answer, 'board')).toMatchObject({ reused: false, reason: 'input changed' });
    expect(of(answer, 'contracts')).toMatchObject({ reused: true });
  });

  it('a merge of the base into the branch is seen: a path only P1 holds is in the reuse diff', () => {
    // H1 and H2 agree on f, so diff(H1, H2) omits it; f is in P1 and not in P2.
    const diff = reuseDiff([], ['f', 'g'], ['g']);
    expect(diff).toEqual(['f']);
    const mapOf = (paths: readonly string[]): JobMap => ({ ...NOTHING, board: paths.includes('f') });
    const answer = ciReuse(readings([run({ jobMap: mapOf(diff) })]));
    expect(of(answer, 'board')).toMatchObject({ reused: false, reason: 'input changed' });
  });

  it('a changed test selection re-runs the job', () => {
    for (const [field, key] of [
      ['contracts_tests', 'contracts'],
      ['corpus_tests', 'corpus'],
    ] as const) {
      const answer = ciReuse(readings([run({ record: { base: BASE, head: H1, selection: { ...SELECTION, [field]: 'other' } } })]));
      expect(of(answer, key)).toMatchObject({ reused: false, reason: 'selection changed' });
      expect(of(answer, 'board')).toMatchObject({ reused: true });
    }
    const flag = ciReuse(readings([run({ record: { base: BASE, head: H1, selection: { ...SELECTION, board: 'false' } } })]));
    expect(of(flag, 'board')).toMatchObject({ reused: false, reason: 'selection changed' });
  });

  it('a re-run, the release pull request and a run that is no pull request reuse nothing', () => {
    expect(reasons(ciReuse(readings([run()], { runAttempt: 2 })))).toEqual(REUSE_KEYS.map(() => 're-run'));
    expect(reasons(ciReuse(readings([run()], { headRef: 'changeset-release/main' })))).toEqual(
      REUSE_KEYS.map(() => 'release pull request'),
    );
    for (const event of ['push', 'workflow_dispatch']) {
      expect(reasons(ciReuse(readings([run()], { event })))).toEqual(REUSE_KEYS.map(() => 'not a pull request'));
    }
  });

  it('another pull request on the same branch name is no source', () => {
    expect(reasons(ciReuse(readings([run({ pullRequests: [8] })])))).toEqual(REUSE_KEYS.map(() => 'other pull request'));
    expect(reasons(ciReuse(readings([run({ headSha: H0 })])))).toEqual(REUSE_KEYS.map(() => 'other pull request'));
  });

  it('a run with no record, or whose jobs or diff could not be read, is no source', () => {
    expect(reasons(ciReuse(readings([run({ record: null })])))).toEqual(REUSE_KEYS.map(() => 'no record'));
    expect(reasons(ciReuse(readings([run({ jobs: null })])))).toEqual(REUSE_KEYS.map(() => 'read failed'));
    expect(reasons(ciReuse(readings([run({ jobMap: null })])))).toEqual(REUSE_KEYS.map(() => 'read failed'));
    const noRecordThenGreen = ciReuse(readings([run({ id: 102, record: null }), run()]));
    expect(of(noRecordThenGreen, 'board')).toMatchObject({ reused: true, runId: 101 });
  });

  it('a job this run does not select is not reused', () => {
    const answer = ciReuse(readings([run()], { selection: { ...SELECTION, macos: 'false' } }));
    expect(of(answer, 'macos')).toMatchObject({ reused: false, reason: 'not selected' });
  });

  it('a job the earlier run did not list is no source', () => {
    const { corpus: _dropped, ...jobs } = GREEN;
    expect(of(ciReuse(readings([run({ jobs })])), 'corpus')).toMatchObject({ reused: false, reason: 'not green' });
  });

  it('a value that is no 40-hex SHA reuses nothing', () => {
    const answer = ciReuse(readings([run({ headSha: 'abc', record: { base: BASE, head: 'abc', selection: SELECTION } })]));
    expect(reasons(answer)).toEqual(REUSE_KEYS.map(() => 'read failed'));
  });
});

describe('reuseOutput', () => {
  it('passes only reused:<40 hex>, and empties anything else', () => {
    expect(reuseOutput(`reused:${H1}`)).toBe(`reused:${H1}`);
    for (const bad of ['', 'reused:', 'reused:abc', `reused:${H1}x`, `reused:${'A'.repeat(40)}`, `x reused:${H1}`, `reused:${H1}\nreuse_board=x`]) {
      expect(reuseOutput(bad)).toBe('');
    }
  });
});

describe('reuseDiff', () => {
  it('is the head diff joined with the symmetric difference of the two changed lists, sorted and unique', () => {
    expect(reuseDiff(['z', 'a', ''], ['a', 'm', 'p'], ['p', 'q'])).toEqual(['a', 'm', 'q', 'z']);
    expect(reuseDiff([], ['x'], ['x'])).toEqual([]);
  });
});

describe('parseCiReuseReadings', () => {
  it('reads the readings file the read step writes', () => {
    const value = readings([run()]);
    expect(parseCiReuseReadings(JSON.stringify(value))).toEqual(value);
  });

  it('refuses a file that is no readings', () => {
    expect(() => parseCiReuseReadings('not json')).toThrow();
    expect(() => parseCiReuseReadings(JSON.stringify({ event: 'pull_request' }))).toThrow();
  });
});
