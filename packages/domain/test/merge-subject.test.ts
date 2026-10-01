import { describe, expect, it } from 'vitest';
import { mergedBySubject } from '../src/rules/merge-subject.js';

/**
 * The two forms the host adapter holds, written out here rather than imported.
 *
 * The rule takes forms as data and names no host, so its tests name none
 * either. `merge-subjects.test.ts` is where the adapter's own strings are
 * pinned; a form repeated here would make this file fail when that one is
 * corrected, which is the opposite of what a rule test should do.
 */
const PR_FROM = 'Merge pull request #<number> from <owner>/<branch>';
const MERGED_IN = 'Merged in <branch> (pull request #<number>)';

describe('mergedBySubject', () => {
  it('matches a subject whose branch, owner and number all fit the form', () => {
    expect(
      mergedBySubject({
        subjects: [{ sha: 'aaa', subject: 'Merge pull request #12 from acme/bug/flaky' }],
        branches: ['bug/flaky'],
        forms: [PR_FROM],
        owner: 'acme',
      }),
    ).toEqual([{ sha: 'aaa', branch: 'bug/flaky' }]);
  });

  it('matches the form that carries the number last', () => {
    expect(
      mergedBySubject({
        subjects: [{ sha: 'bbb', subject: 'Merged in bug/flaky (pull request #12)' }],
        branches: ['bug/flaky'],
        forms: [MERGED_IN],
        owner: null,
      }),
    ).toEqual([{ sha: 'bbb', branch: 'bug/flaky' }]);
  });

  it('answers nothing for a subject that is not one of the forms', () => {
    expect(
      mergedBySubject({
        subjects: [{ sha: 'ccc', subject: "Merge remote-tracking branch 'origin/main'" }],
        branches: ['bug/flaky'],
        forms: [PR_FROM, MERGED_IN],
        owner: 'acme',
      }),
    ).toEqual([]);
  });

  it('answers nothing when the form list is empty', () => {
    expect(
      mergedBySubject({
        subjects: [{ sha: 'ddd', subject: 'Merge pull request #12 from acme/bug/flaky' }],
        branches: ['bug/flaky'],
        forms: [],
        owner: 'acme',
      }),
    ).toEqual([]);
  });

  it('answers nothing when no branch was asked about', () => {
    expect(
      mergedBySubject({
        subjects: [{ sha: 'eee', subject: 'Merge pull request #12 from acme/bug/flaky' }],
        branches: [],
        forms: [PR_FROM],
        owner: 'acme',
      }),
    ).toEqual([]);
  });

  describe('the owner', () => {
    it('refuses a subject naming another owner', () => {
      expect(
        mergedBySubject({
          subjects: [{ sha: 'fff', subject: 'Merge pull request #12 from forker/bug/flaky' }],
          branches: ['bug/flaky'],
          forms: [PR_FROM],
          owner: 'acme',
        }),
      ).toEqual([]);
    });

    it('accepts the owner in another case', () => {
      expect(
        mergedBySubject({
          subjects: [{ sha: 'ggg', subject: 'Merge pull request #12 from ACME/bug/flaky' }],
          branches: ['bug/flaky'],
          forms: [PR_FROM],
          owner: 'acme',
        }),
      ).toEqual([{ sha: 'ggg', branch: 'bug/flaky' }]);
    });

    it('accepts any owner when none was read', () => {
      expect(
        mergedBySubject({
          subjects: [{ sha: 'hhh', subject: 'Merge pull request #12 from anyone/bug/flaky' }],
          branches: ['bug/flaky'],
          forms: [PR_FROM],
          owner: null,
        }),
      ).toEqual([{ sha: 'hhh', branch: 'bug/flaky' }]);
    });

    it('refuses an owner carrying a slash, which would swallow the branch', () => {
      // `acme/extra` as an owner would make the whole-line match succeed with
      // the branch read as `flaky` — the segment the form gives the owner may
      // not reach across the separator.
      expect(
        mergedBySubject({
          subjects: [
            { sha: 'iii', subject: 'Merge pull request #12 from acme/extra/bug/flaky' },
          ],
          branches: ['bug/flaky'],
          forms: [PR_FROM],
          owner: 'acme',
        }),
      ).toEqual([]);
    });
  });

  describe('the branch', () => {
    it('refuses a branch name that only shares a prefix', () => {
      expect(
        mergedBySubject({
          subjects: [{ sha: 'jjj', subject: 'Merge pull request #12 from acme/bug/flaky-two' }],
          branches: ['bug/flaky'],
          forms: [PR_FROM],
          owner: 'acme',
        }),
      ).toEqual([]);
    });

    it('matches a branch name holding regex metacharacters as literal text', () => {
      // `feature/v.1` as a pattern matches `feature/vX1`; `bug/a+b` as a
      // pattern fails to match its own subject. Both directions are wrong.
      expect(
        mergedBySubject({
          subjects: [
            { sha: 'kkk', subject: 'Merge pull request #1 from acme/feature/vX1' },
            { sha: 'lll', subject: 'Merge pull request #2 from acme/bug/a+b' },
          ],
          branches: ['feature/v.1', 'bug/a+b'],
          forms: [PR_FROM],
          owner: 'acme',
        }),
      ).toEqual([{ sha: 'lll', branch: 'bug/a+b' }]);
    });

    it('refuses a subject carrying trailing text after the branch', () => {
      expect(
        mergedBySubject({
          subjects: [
            { sha: 'mmm', subject: 'Merge pull request #12 from acme/bug/flaky into main' },
          ],
          branches: ['bug/flaky'],
          forms: [PR_FROM],
          owner: 'acme',
        }),
      ).toEqual([]);
    });

    it('refuses a subject carrying leading text before the form', () => {
      expect(
        mergedBySubject({
          subjects: [
            { sha: 'nnn', subject: 'Revert "Merge pull request #12 from acme/bug/flaky"' },
          ],
          branches: ['bug/flaky'],
          forms: [PR_FROM],
          owner: 'acme',
        }),
      ).toEqual([]);
    });
  });

  describe('the number', () => {
    it('refuses a subject whose number is not digits', () => {
      expect(
        mergedBySubject({
          subjects: [{ sha: 'ooo', subject: 'Merge pull request #xy from acme/bug/flaky' }],
          branches: ['bug/flaky'],
          forms: [PR_FROM],
          owner: 'acme',
        }),
      ).toEqual([]);
    });

    it('accepts a number of several digits', () => {
      expect(
        mergedBySubject({
          subjects: [{ sha: 'ppp', subject: 'Merged in bug/flaky (pull request #1723)' }],
          branches: ['bug/flaky'],
          forms: [MERGED_IN],
          owner: null,
        }),
      ).toEqual([{ sha: 'ppp', branch: 'bug/flaky' }]);
    });
  });

  it('answers every matched pair, one per subject', () => {
    expect(
      mergedBySubject({
        subjects: [
          { sha: 'q1', subject: 'Merge pull request #1 from acme/bug/one' },
          { sha: 'q2', subject: 'Merged in bug/two (pull request #2)' },
          { sha: 'q3', subject: 'Merge pull request #3 from acme/bug/unasked' },
        ],
        branches: ['bug/one', 'bug/two'],
        forms: [PR_FROM, MERGED_IN],
        owner: 'acme',
      }),
    ).toEqual([
      { sha: 'q1', branch: 'bug/one' },
      { sha: 'q2', branch: 'bug/two' },
    ]);
  });

  it('answers one pair per merge when a name was merged twice', () => {
    // The age rule needs every candidate merge, not the newest: which of them
    // predates the plan is decided by an ancestry test the caller runs per pair.
    expect(
      mergedBySubject({
        subjects: [
          { sha: 'r1', subject: 'Merge pull request #1 from acme/bug/flaky' },
          { sha: 'r2', subject: 'Merge pull request #9 from acme/bug/flaky' },
        ],
        branches: ['bug/flaky'],
        forms: [PR_FROM],
        owner: 'acme',
      }),
    ).toEqual([
      { sha: 'r1', branch: 'bug/flaky' },
      { sha: 'r2', branch: 'bug/flaky' },
    ]);
  });

  it('answers the first form that matches, so one subject yields one pair', () => {
    expect(
      mergedBySubject({
        subjects: [{ sha: 's1', subject: 'Merged in bug/flaky (pull request #4)' }],
        branches: ['bug/flaky'],
        forms: [MERGED_IN, MERGED_IN],
        owner: null,
      }),
    ).toEqual([{ sha: 's1', branch: 'bug/flaky' }]);
  });

  it('matches a form carrying regex metacharacters outside its placeholders', () => {
    // The Bitbucket form's own parentheses are literal text, so a form is
    // escaped before its placeholders become patterns.
    expect(
      mergedBySubject({
        subjects: [{ sha: 't1', subject: 'Merged in bug/flaky pull request #4' }],
        branches: ['bug/flaky'],
        forms: [MERGED_IN],
        owner: null,
      }),
    ).toEqual([]);
  });

  it('answers nothing for a form naming no branch', () => {
    // Bitbucket Data Center's `Pull request #N: <title>` names no branch. A
    // form with no `<branch>` placeholder can prove nothing, whatever it
    // matches, and is refused rather than matched against every asked branch.
    expect(
      mergedBySubject({
        subjects: [{ sha: 'u1', subject: 'Pull request #4: fix the flake' }],
        branches: ['bug/flaky'],
        forms: ['Pull request #<number>: <title>'],
        owner: null,
      }),
    ).toEqual([]);
  });

  it('matches a form that names a branch and no owner', () => {
    // `owner` is irrelevant to a form with no `<owner>` placeholder: the
    // Bitbucket form is this shape, and an owner must not silently refuse it.
    expect(
      mergedBySubject({
        subjects: [{ sha: 'v1', subject: 'Merged in bug/flaky (pull request #4)' }],
        branches: ['bug/flaky'],
        forms: [MERGED_IN],
        owner: 'acme',
      }),
    ).toEqual([{ sha: 'v1', branch: 'bug/flaky' }]);
  });
});
