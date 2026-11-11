import { describe, expect, it } from 'vitest';
import {
  APPROVE_PENDING,
  APPROVE_REGISTER_FIRST,
  releaseApprovable,
  type ReleasePrReading,
} from '../src/rules/release-approvable.js';

const HEAD = 'a'.repeat(40);
const OTHER = 'b'.repeat(40);

const reviews: Record<string, Partial<ReleasePrReading>> = {
  'success on the head': { plotReview: 'success', plotReviewSha: HEAD, plotReviewJudged: 'success', plotReviewCheckedSha: HEAD },
  'success on another sha': { plotReview: 'success', plotReviewSha: OTHER, plotReviewJudged: 'success', plotReviewCheckedSha: HEAD },
  'success no judgment covers': { plotReview: 'success', plotReviewSha: HEAD },
  pending: { plotReview: 'pending', plotReviewSha: HEAD },
  failure: { plotReview: 'failure', plotReviewSha: HEAD, plotReviewJudged: 'failure', plotReviewCheckedSha: HEAD },
  absent: {},
};
const checks: Record<string, Partial<ReleasePrReading>> = {
  'green on the head': { ciChecks: 'green', checksSha: HEAD },
  'green on another sha': { ciChecks: 'green', checksSha: OTHER },
  'green with no sha': { ciChecks: 'green' },
  pending: { ciChecks: 'pending', checksSha: HEAD },
  failing: { ciChecks: 'failing', checksSha: HEAD },
  unknown: { ciChecks: 'unknown', checksSha: HEAD },
  absent: {},
};
const registrations = {
  registered: { registered: true, credentialId: 'abc' },
  unregistered: { registered: false },
  unread: null,
} as const;

const reading = (review: string, ci: string, open = true): ReleasePrReading => ({
  open,
  headSha: HEAD,
  ...reviews[review],
  ...checks[ci],
});

const short = HEAD.slice(0, 9);

const reviewReasons: Record<string, string | null> = {
  'success on the head': null,
  'success on another sha': `The review names an older head; no review on ${short} yet`,
  'success no judgment covers': `The review on ${short} is not yet judged`,
  pending: `The review is still running on ${short}`,
  failure: `The review failed on ${short}`,
  absent: `No review on ${short} yet`,
};
const ciReasons: Record<string, string | null> = {
  'green on the head': null,
  'green on another sha': `CI has not reported on ${short}`,
  'green with no sha': `CI has not reported on ${short}`,
  pending: `CI is still running on ${short}`,
  failing: `CI is failing on ${short}`,
  unknown: `CI reports no counted check on ${short}`,
  absent: `CI has not reported on ${short}`,
};

describe('releaseApprovable', () => {
  for (const review of Object.keys(reviews)) {
    for (const ci of Object.keys(checks)) {
      for (const open of [true, false]) {
        for (const [name, held] of Object.entries(registrations)) {
          const unmet = !open ? 'The release PR is not open' : (ciReasons[ci] ?? reviewReasons[review]);
          const expected = unmet !== null
            ? { state: 'disabled', reason: unmet }
            : name === 'registered'
              ? { state: 'enabled', reason: '' }
              : name === 'unregistered'
                ? { state: 'disabled', reason: APPROVE_REGISTER_FIRST }
                : { state: 'disabled', reason: APPROVE_PENDING };
          it(`review ${review}, CI ${ci}, ${open ? 'open' : 'not open'}, ${name}`, () => {
            expect(releaseApprovable(reading(review, ci, open), held)).toEqual(expected);
          });
        }
      }
    }
  }

  it('never answers hidden', () => {
    for (const review of Object.keys(reviews)) {
      for (const ci of Object.keys(checks)) {
        for (const held of Object.values(registrations)) {
          expect(releaseApprovable(reading(review, ci), held).state).not.toBe('hidden');
        }
      }
    }
  });

  it('names an older review head where the PR moved past a review success', () => {
    const moved = { ...reading('success on the head', 'green on the head'), headSha: OTHER, checksSha: OTHER };
    expect(releaseApprovable(moved, registrations.registered)).toEqual({
      state: 'disabled',
      reason: `The review names an older head; no review on ${OTHER.slice(0, 9)} yet`,
    });
  });

  it('answers no review where a success names no sha', () => {
    const { plotReviewSha: _sha, ...unbound } = reading('success on the head', 'green on the head');
    expect(releaseApprovable(unbound, registrations.registered)).toEqual({ state: 'disabled', reason: `No review on ${short} yet` });
  });

  it('answers the pending wording for an unread registration, with no Settings pointer', () => {
    const answer = releaseApprovable(reading('success on the head', 'green on the head'), null);
    expect(answer).toEqual({ state: 'disabled', reason: APPROVE_PENDING });
    expect(answer.reason).not.toMatch(/Settings/);
  });

  it('disables the button where the row carries no reading or no head', () => {
    expect(releaseApprovable(null, registrations.registered)).toEqual({
      state: 'disabled',
      reason: 'The board has not read the release PR yet',
    });
    const { headSha: _head, ...headless } = reading('success on the head', 'green on the head');
    expect(releaseApprovable(headless, registrations.registered)).toEqual({
      state: 'disabled',
      reason: "The board has not read the release PR's head yet",
    });
  });
});
