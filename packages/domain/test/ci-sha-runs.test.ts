import { describe, expect, it } from 'vitest';

import { ciRunsOf, type CiRunsInput } from '../src/rules/ci-sha-runs.js';

const A = 'a'.repeat(40);
const B = 'b'.repeat(40);

const build = (number: number, result: unknown, sha: string | null, branches: string[] = ['origin/main'], extra: object = {}) => ({
  number,
  result,
  building: false,
  timestamp: 1_700_000_000_000 + number * 1000 + 999,
  url: `https://ci.example.org/${String(number)}/`,
  actions: [{}, { lastBuiltRevision: { SHA1: sha, branch: branches.map((name) => ({ name })) } }],
  ...extra,
});

const input = (over: Partial<CiRunsInput> = {}): CiRunsInput => ({ sha: A, job: 'team/portal', branch: 'main', plain: false, limit: 20, ...over });

describe('ciRunsOf', () => {
  it('maps a build onto a run, with the start in whole seconds', () => {
    expect(ciRunsOf([build(5, 'SUCCESS', A)], input())).toEqual([
      { status: 'completed', conclusion: 'SUCCESS', url: 'https://ci.example.org/5/', startedAt: '2023-11-14T22:13:25Z', workflow: 'team/portal', sha: A },
    ]);
  });

  it('keeps a start that falls on a whole second without a fraction', () => {
    expect(ciRunsOf([build(5, 'SUCCESS', A, ['origin/main'], { timestamp: 1_700_000_000_000 })], input())[0]?.startedAt).toBe('2023-11-14T22:13:20Z');
  });

  it('reads a running build as in progress with no conclusion', () => {
    const [run] = ciRunsOf([build(6, null, A, ['origin/main'], { building: true })], input());
    expect([run?.status, run?.conclusion]).toEqual(['in_progress', null]);
  });

  it('reads an absent result as no conclusion, and an absent url and timestamp as empty', () => {
    const [run] = ciRunsOf([{ building: false, actions: [{ lastBuiltRevision: { SHA1: A, branch: [] } }] }], input());
    expect([run?.conclusion, run?.url, run?.startedAt]).toEqual([null, '', '']);
  });

  it('reads a timestamp that is no number as an empty start', () => {
    expect(ciRunsOf([build(1, 'SUCCESS', A, ['origin/main'], { timestamp: 'soon' })], input())[0]?.startedAt).toBe('');
  });

  it('drops NOT_BUILT always and ABORTED only where no commit is asked', () => {
    const builds = [build(3, 'ABORTED', A), build(2, 'NOT_BUILT', A), build(1, 'SUCCESS', A)];
    expect(ciRunsOf(builds, input()).map((run) => run.conclusion)).toEqual(['ABORTED', 'SUCCESS']);
    expect(ciRunsOf(builds, input({ sha: '' })).map((run) => run.conclusion)).toEqual(['SUCCESS']);
  });

  it('matches a commit whole, or by prefix of seven lower-case hex digits', () => {
    const builds = [build(2, 'SUCCESS', A), build(1, 'SUCCESS', B)];
    expect(ciRunsOf(builds, input({ sha: A.slice(0, 7) })).map((run) => run.sha)).toEqual([A]);
    expect(ciRunsOf(builds, input({ sha: A.slice(0, 6) }))).toEqual([]);
    expect(ciRunsOf(builds, input({ sha: 'A'.repeat(7) }))).toEqual([]);
  });

  it('belongs a build to the commit its record for the branch names', () => {
    const named = { ...build(9, 'SUCCESS', A), actions: [{ lastBuiltRevision: { SHA1: B, branch: [{ name: 'refs/remotes/origin/other' }] } }, { lastBuiltRevision: { SHA1: A, branch: [{ name: 'refs/heads/main' }] } }] };
    expect(ciRunsOf([named], input()).map((run) => run.sha)).toEqual([A]);
    expect(ciRunsOf([named], input({ sha: B }))).toEqual([]);
  });

  it('takes the last record where none names a branch, and none where several name others', () => {
    const unnamed = { ...build(8, 'SUCCESS', A), actions: [{ lastBuiltRevision: { SHA1: B, branch: [] } }, { lastBuiltRevision: { SHA1: A } }] };
    expect(ciRunsOf([unnamed], input()).map((run) => run.sha)).toEqual([A]);
    expect(ciRunsOf([build(7, 'SUCCESS', B, ['origin/other'])], input({ sha: B }))).toEqual([]);
  });

  it('reads a build with no usable record as belonging to no commit', () => {
    const none = [{ result: 'SUCCESS' }, { result: 'SUCCESS', actions: [null, { lastBuiltRevision: null }, { lastBuiltRevision: 'x' }] }, { result: 'SUCCESS', actions: [{ lastBuiltRevision: { branch: [] } }] }];
    expect(ciRunsOf(none, input())).toEqual([]);
    expect(ciRunsOf(none, input({ sha: '' })).map((run) => run.sha)).toEqual(['', '', '']);
  });

  it('skips a branch entry that names nothing', () => {
    const odd = { ...build(4, 'SUCCESS', A), actions: [{ lastBuiltRevision: { SHA1: A, branch: [null, { name: 4 }, { name: 'origin/main' }] } }] };
    expect(ciRunsOf([odd], input()).map((run) => run.sha)).toEqual([A]);
  });

  it('keeps, with no commit, every build of a branch path and only the branch`s own builds of a plain job', () => {
    const builds = [build(3, 'SUCCESS', A, ['origin/main']), build(2, 'SUCCESS', B, ['origin/other'])];
    expect(ciRunsOf(builds, input({ sha: '' }))).toHaveLength(2);
    expect(ciRunsOf(builds, input({ sha: '', plain: true })).map((run) => run.sha)).toEqual([A]);
  });

  it('cuts to the limit after every filter', () => {
    const builds = [...Array.from({ length: 6 }, (_, i) => build(20 - i, 'ABORTED', A)), ...Array.from({ length: 4 }, (_, i) => build(10 - i, 'SUCCESS', A))];
    expect(ciRunsOf(builds, input({ sha: '', limit: 3 })).map((run) => run.url)).toEqual(['https://ci.example.org/10/', 'https://ci.example.org/9/', 'https://ci.example.org/8/']);
  });

  it('reads a build with no revision list as having no record', () => {
    expect(ciRunsOf([{ result: 'SUCCESS', actions: 'x' }], input({ sha: '' }))[0]?.sha).toBe('');
  });
});
