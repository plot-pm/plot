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

describe('releaseApprovable', () => {
  for (const review of Object.keys(reviews)) {
    for (const ci of Object.keys(checks)) {
      for (const open of [true, false]) {
        for (const [name, held] of Object.entries(registrations)) {
          const ready = review === 'success on the head' && ci === 'green on the head' && open;
          const expected = !ready
            ? { state: 'hidden', reason: '' }
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

  it('hides the button for a review success on a stale head', () => {
    const stale = { ...reading('success on the head', 'green on the head'), headSha: OTHER };
    expect(releaseApprovable(stale, registrations.registered).state).toBe('hidden');
  });

  it('answers the pending wording for an unread registration, with no Settings pointer', () => {
    const answer = releaseApprovable(reading('success on the head', 'green on the head'), null);
    expect(answer).toEqual({ state: 'disabled', reason: APPROVE_PENDING });
    expect(answer.reason).not.toMatch(/Settings/);
  });

  it('hides the button where the row carries no reading or no head', () => {
    expect(releaseApprovable(null, registrations.registered).state).toBe('hidden');
    const { headSha: _head, ...headless } = reading('success on the head', 'green on the head');
    expect(releaseApprovable(headless, registrations.registered).state).toBe('hidden');
  });
});
