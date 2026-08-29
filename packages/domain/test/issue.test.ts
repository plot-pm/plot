import { describe, it, expect } from 'vitest';
import {
  IssueAnswerSchema, sameIssue, bodyWasFetched, isRenderable, isStale,
  type Issue, type IssueFetch,
} from '../src/index.js';

/**
 * A ticket in a tracker Plot reads and never writes.
 *
 * Askability is a property of the ANSWER, not of an Issue — carried once per
 * fetch beside the collection, never on an individual issue, which by existing
 * has already been answered for.
 */

const issue: Issue = {
  id: '226', title: 'the board tells the truth', url: 'https://host/issues/226',
  createdAt: '2026-08-20T09:00:00Z', body: null,
};

describe('an issue id is opaque', () => {
  it('compares two hosts’ identities as strings', () => {
    // GitHub yields `226` and Jira yields `PROJ-123`; only one is a number by
    // accident of the host. Comparing them as numbers is what made the Jira
    // filter silently always-false.
    expect(sameIssue('226', '226')).toBe(true);
    expect(sameIssue('PROJ-123', 'PROJ-123')).toBe(true);
    expect(sameIssue('226', 'PROJ-123')).toBe(false);
  });

  it('does not equate an id with its rendered sigil', () => {
    // `#226` is a view concern, not the id.
    expect(sameIssue('226', '#226')).toBe(false);
  });
});

describe('a body distinguishes not-fetched from empty', () => {
  it('reports an unfetched body', () => {
    // The list op omits bodies entirely and only a click fetches one.
    expect(bodyWasFetched(issue)).toBe(false);
  });

  it('reports a fetched but empty body as fetched', () => {
    // Collapsing these makes an issue with no description indistinguishable
    // from one nobody has opened yet.
    expect(bodyWasFetched({ ...issue, body: '' })).toBe(true);
  });

  it('reports a fetched body', () => {
    expect(bodyWasFetched({ ...issue, body: 'some prose' })).toBe(true);
  });
});

describe('askability belongs to the fetch, not the issue', () => {
  it('names the three answers', () => {
    expect(IssueAnswerSchema.options).toEqual(['answered', 'unsupported', 'failed']);
  });

  it('renders an answered fetch, empty meaning honestly none', () => {
    const empty: IssueFetch = { answer: 'answered', issues: [] };
    expect(isRenderable(empty)).toBe(true);
    expect(isStale(empty)).toBe(false);
  });

  it('renders nothing for a tracker that cannot be asked at all', () => {
    // `unsupported` renders NO SECTION rather than an empty list: an empty
    // inbox would claim an empty tracker.
    expect(isRenderable({ answer: 'unsupported', issues: [] })).toBe(false);
  });

  it('marks a failed fetch stale rather than empty', () => {
    // Asked, did not come back: the last good list, marked stale.
    const failed: IssueFetch = { answer: 'failed', issues: [issue] };
    expect(isRenderable(failed)).toBe(false);
    expect(isStale(failed)).toBe(true);
  });
});
