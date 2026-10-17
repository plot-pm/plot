import { describe, expect, it } from 'vitest';

import { bindChecks, rowsToBind } from '../src/rules/jenkins-pr-checks.js';

const run = (conclusion: string | null, startedAt = '2026-10-17T10:00:00Z', status = 'completed') => ({
  status,
  conclusion,
  startedAt,
});

describe('bindChecks', () => {
  it('reads the newest build of the head commit', () => {
    expect(bindChecks([run('FAILURE', '2026-10-17T09:00:00Z'), run('SUCCESS')], 'j/b')).toEqual({
      checks: 'green',
      job: 'j/b',
    });
  });

  it('reads an older build when it is the only one', () => {
    expect(bindChecks([run('FAILURE', '2026-10-16T09:00:00Z')], 'j/b')?.checks).toBe('failing');
  });

  it('reports no check where no build ran the commit', () => {
    expect(bindChecks([], 'j/b')).toBeNull();
  });

  it('reads a build in flight as pending', () => {
    expect(bindChecks([run(null, '2026-10-17T10:00:00Z', 'in_progress')], 'j/b')?.checks).toBe('pending');
  });

  it.each([
    ['UNSTABLE', 'failing'],
    ['ABORTED', 'unknown'],
    ['NOT_BUILT', 'unknown'],
  ])('reads %s as %s', (word, expected) => {
    expect(bindChecks([run(word)], 'j/b')?.checks).toBe(expected);
  });
});

describe('rowsToBind', () => {
  const colours = {
    a: { checks: 'green', job: 'j/a' },
    b: { checks: 'failing', job: 'j/b' },
    c: { checks: 'pending', job: 'j/c' },
    d: { checks: 'none', job: 'j/d' },
  };

  it('asks only rows whose colour is green or failing and whose head is known', () => {
    const rows = [
      { headRefName: 'a', headRefOid: 'sa' },
      { headRefName: 'b', headRefOid: 'sb' },
      { headRefName: 'c', headRefOid: 'sc' },
      { headRefName: 'd', headRefOid: 'sd' },
      { headRefName: 'e', headRefOid: 'se' },
    ];
    expect(rowsToBind(rows, colours)).toEqual([
      { branch: 'a', sha: 'sa', job: 'j/a' },
      { branch: 'b', sha: 'sb', job: 'j/b' },
    ]);
  });

  it('skips a row with no head sha', () => {
    expect(rowsToBind([{ headRefName: 'a', headRefOid: '' }, { headRefName: 'b' }], colours)).toEqual([]);
  });

  it('falls back to the branch name when the colour entry carries no job', () => {
    const noJob = { a: { checks: 'green' } };
    expect(rowsToBind([{ headRefName: 'a', headRefOid: 'sa' }], noJob)).toEqual([
      { branch: 'a', sha: 'sa', job: 'a' },
    ]);
  });
});
