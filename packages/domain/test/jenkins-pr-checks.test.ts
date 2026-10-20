import { describe, expect, it } from 'vitest';

import { SHA_LOOKUPS_PER_PASS, bindChecks, rowsToBind } from '../src/rules/jenkins-pr-checks.js';

const run = (conclusion: string | null, startedAt = '2026-10-17T10:00:00Z', status = 'completed') => ({
  status,
  conclusion,
  startedAt,
});

describe('bindChecks', () => {
  it('reads the newest build of the head commit, bound to that commit', () => {
    expect(bindChecks([run('FAILURE', '2026-10-17T09:00:00Z'), run('SUCCESS')], 'j/b', 's1')).toEqual({
      checks: 'green',
      job: 'j/b',
      checksSha: 's1',
    });
  });

  it('reads an older build when it is the only one', () => {
    expect(bindChecks([run('FAILURE', '2026-10-16T09:00:00Z')], 'j/b', 's1')?.checks).toBe('failing');
  });

  it('reads an answer with no build of the commit as unknown and unbound, never pending', () => {
    expect(bindChecks([], 'j/b', 's1')).toEqual({ checks: 'unknown', job: 'j/b', checksSha: '' });
  });

  it('answers nothing where the lookup could not ask, so the branch colour stands', () => {
    expect(bindChecks(null, 'j/b', 's1')).toBeNull();
  });

  it('reads a build in flight as pending', () => {
    expect(bindChecks([run(null, '2026-10-17T10:00:00Z', 'in_progress')], 'j/b', 's1')?.checks).toBe('pending');
  });

  it.each([
    ['UNSTABLE', 'failing'],
    ['ABORTED', 'unknown'],
    ['NOT_BUILT', 'unknown'],
  ])('reads %s as %s', (word, expected) => {
    expect(bindChecks([run(word)], 'j/b', 's1')?.checks).toBe(expected);
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

  it('asks at most the limit, the most recently updated rows first', () => {
    const rows = [
      { headRefName: 'a', headRefOid: 'sa', updatedAt: '2026-10-17T08:00:00Z' },
      { headRefName: 'b', headRefOid: 'sb', updatedAt: '2026-10-17T10:00:00Z' },
      { headRefName: 'c', headRefOid: 'sc', updatedAt: null },
    ];
    const green = { a: { checks: 'green' }, b: { checks: 'green' }, c: { checks: 'green' } };
    expect(rowsToBind(rows, green, 2).map((r) => r.branch)).toEqual(['b', 'a']);
  });

  it('asks at most SHA_LOOKUPS_PER_PASS rows by default', () => {
    const many = Array.from({ length: SHA_LOOKUPS_PER_PASS + 3 }, (_, i) => ({ headRefName: `r${i}`, headRefOid: `s${i}` }));
    const green = Object.fromEntries(many.map((r) => [r.headRefName, { checks: 'green' }]));
    expect(rowsToBind(many, green)).toHaveLength(SHA_LOOKUPS_PER_PASS);
  });

  it('leaves the rows past the limit out of the answer, naming only the ones it asks about', () => {
    const many = Array.from({ length: SHA_LOOKUPS_PER_PASS + 3 }, (_, i) => ({
      headRefName: `r${i}`,
      headRefOid: `s${i}`,
      updatedAt: `2026-10-17T${String(10 + i).padStart(2, '0')}:00:00Z`,
    }));
    const green = Object.fromEntries(many.map((r) => [r.headRefName, { checks: 'green', job: `j/${r.headRefName}` }]));
    const bound = rowsToBind(many, green);
    expect(bound).toHaveLength(SHA_LOOKUPS_PER_PASS);
    const boundBranches = new Set(bound.map((r) => r.branch));
    const droppedBranches = many.map((r) => r.headRefName).filter((b) => !boundBranches.has(b));
    expect(droppedBranches).toHaveLength(3);
    expect(droppedBranches.every((b) => !boundBranches.has(b))).toBe(true);
  });

  describe('rotation', () => {
    // SEVEN ROWS, NEWEST FIRST, CAP 5: with no memory the same two rows
    // (r5, r6, the oldest two) never bind on any pass. `bound` is what the
    // caller's PR index already holds from the previous pass.
    const many = Array.from({ length: 7 }, (_, i) => ({
      headRefName: `r${i}`,
      headRefOid: `s${i}`,
      updatedAt: `2026-10-17T${String(10 + i).padStart(2, '0')}:00:00Z`,
    }));
    const green = Object.fromEntries(many.map((r) => [r.headRefName, { checks: 'green', job: `j/${r.headRefName}` }]));

    it('a row left out of pass 1 is picked up in pass 2, rather than the same newest rows winning again', () => {
      const pass1 = rowsToBind(many, green, 5);
      const pass1Branches = new Set(pass1.map((r) => r.branch));
      expect(pass1Branches.has('r0')).toBe(false);
      expect(pass1Branches.has('r1')).toBe(false);

      // Pass 1's answers are now the caller's stored `checksSha` — bound to
      // their current head.
      const bound = Object.fromEntries(pass1.map((r) => [r.branch, r.sha]));
      const pass2 = rowsToBind(many, green, 5, bound);
      const pass2Branches = new Set(pass2.map((r) => r.branch));
      // r0 and r1 were never bound, so they win a slot on pass 2 over rows
      // the caller's index already confirms are bound to their current head.
      expect(pass2Branches.has('r0')).toBe(true);
      expect(pass2Branches.has('r1')).toBe(true);
    });

    it('a row already bound to its current head is not asked again while an unbound row is waiting', () => {
      const bound = { r5: 's5', r6: 's6' };
      const picked = rowsToBind(many, green, 2, bound);
      // Both slots go to never-bound rows, newest first among them, even
      // though r5/r6 are the most recently updated of all seven.
      expect(picked.map((r) => r.branch)).toEqual(['r4', 'r3']);
    });

    it('a row whose head moved past the bound sha is treated as unbound', () => {
      const bound = { r6: 'stale-sha' };
      const picked = rowsToBind(many, green, 1, bound);
      expect(picked[0]?.branch).toBe('r6');
    });

    it('with no bound map, every row sorts exactly as it did before rotation existed', () => {
      expect(rowsToBind(many, green, 3)).toEqual(rowsToBind(many, green, 3, {}));
    });
  });
});
