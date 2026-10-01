import { describe, expect, it } from 'vitest';
import { mergeSubjectForms } from '../src/adapters/host/merge-subjects.js';
import { mergedBySubject } from '../src/rules/merge-subject.js';

/**
 * The host adapter's forms, pinned against real subjects.
 *
 * The rule's own tests name no host; these are where the two vendor strings
 * are checked, and they are checked by MATCHING A REAL SUBJECT rather than by
 * string equality. A template compared with itself proves only that a constant
 * was not retyped; one matched against a subject the host actually wrote
 * proves the placeholders sit where the host puts them.
 */
describe('mergeSubjectForms', () => {
  it('matches a subject the first host writes', () => {
    expect(
      mergedBySubject({
        subjects: [{
          sha: 'aaa',
          subject: 'Merge pull request #1139 from plot-pm/bug/the-merge-subject-is-one-rule',
        }],
        branches: ['bug/the-merge-subject-is-one-rule'],
        forms: mergeSubjectForms('github'),
        owner: 'plot-pm',
      }),
    ).toEqual([{ sha: 'aaa', branch: 'bug/the-merge-subject-is-one-rule' }]);
  });

  it('matches a subject the second host writes', () => {
    expect(
      mergedBySubject({
        subjects: [{
          sha: 'bbb',
          subject: 'Merged in EWZKUS-3697-uc1-auszug (pull request #1723)',
        }],
        branches: ['EWZKUS-3697-uc1-auszug'],
        forms: mergeSubjectForms('bitbucket'),
        owner: null,
      }),
    ).toEqual([{ sha: 'bbb', branch: 'EWZKUS-3697-uc1-auszug' }]);
  });

  it('answers no form for a backend Plot does not drive', () => {
    expect(mergeSubjectForms('gitlab')).toEqual([]);
  });

  it('answers no form for an empty backend word', () => {
    // `plot-host.sh backend` answers nothing where no host is configured, and
    // a branch then falls through to the host's own answer as it does today.
    expect(mergeSubjectForms('')).toEqual([]);
  });

  it('proves nothing on a backend with no form', () => {
    expect(
      mergedBySubject({
        subjects: [{ sha: 'ccc', subject: 'Merged in bug/flaky (pull request #4)' }],
        branches: ['bug/flaky'],
        forms: mergeSubjectForms('gitlab'),
        owner: null,
      }),
    ).toEqual([]);
  });

  it('does not match the other host form', () => {
    // The two forms are distinct sentences, and a repository on one host must
    // not read the other's subject — which is what makes the backend word the
    // reading rather than a hint.
    expect(
      mergedBySubject({
        subjects: [{ sha: 'ddd', subject: 'Merged in bug/flaky (pull request #4)' }],
        branches: ['bug/flaky'],
        forms: mergeSubjectForms('github'),
        owner: null,
      }),
    ).toEqual([]);
  });

  it('refuses a fork owner on the host whose form names one', () => {
    expect(
      mergedBySubject({
        subjects: [{ sha: 'eee', subject: 'Merge pull request #16 from eins78/bug/flaky' }],
        branches: ['bug/flaky'],
        forms: mergeSubjectForms('github'),
        owner: 'plot-pm',
      }),
    ).toEqual([]);
  });
});
