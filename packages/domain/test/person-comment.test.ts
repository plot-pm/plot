import { describe, expect, it } from 'vitest';
import { personCommentHolds } from '../src/rules/person-comment.js';

const comment = { head: 'sha-1', at: '2026-11-18T10:00:00Z' };

describe('personCommentHolds', () => {
  it('holds where the head is the row’s commit and updatedAt is not later than at', () => {
    expect(personCommentHolds(comment, { headSha: 'sha-1', updatedAt: '2026-11-18T10:00:00Z' })).toBe(true);
    expect(personCommentHolds(comment, { headSha: 'sha-1', updatedAt: '2026-11-18T09:00:00Z' })).toBe(true);
  });

  it('does not hold where updatedAt is later than at', () => {
    expect(personCommentHolds(comment, { headSha: 'sha-1', updatedAt: '2026-11-18T10:00:01Z' })).toBe(false);
  });

  it('does not hold where the head is another commit, or the field names only the branch', () => {
    expect(personCommentHolds(comment, { headSha: 'sha-2', updatedAt: '2026-11-18T09:00:00Z' })).toBe(false);
    expect(personCommentHolds({ ...comment, head: 'feature/x' }, { headSha: 'sha-1', updatedAt: '2026-11-18T09:00:00Z' })).toBe(false);
    expect(personCommentHolds(comment, { updatedAt: '2026-11-18T09:00:00Z' })).toBe(false);
  });

  it('does not hold on an unparseable time or a missing updatedAt or comment', () => {
    expect(personCommentHolds({ ...comment, at: 'soon' }, { headSha: 'sha-1', updatedAt: '2026-11-18T09:00:00Z' })).toBe(false);
    expect(personCommentHolds(comment, { headSha: 'sha-1', updatedAt: 'later' })).toBe(false);
    expect(personCommentHolds(comment, { headSha: 'sha-1' })).toBe(false);
    expect(personCommentHolds(undefined, { headSha: 'sha-1', updatedAt: '2026-11-18T09:00:00Z' })).toBe(false);
  });
});
