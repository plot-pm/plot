import { describe, expect, it } from 'vitest';
import type { PrReviewReading, ReviewStatus } from '../src/ports/host.js';
import { githubReview, judgedReviewState, reviewPasses } from '../src/rules/github-review.js';

const APP = 'plot-review[bot]';
const HEAD = 'a'.repeat(40);

const status = (writer: string, state: string, time = 't'): ReviewStatus => ({ state, description: '', time, writer });

/** A reading whose newest status is the first of `statuses`, as the host orders them. */
const reading = (...statuses: ReviewStatus[]): PrReviewReading => ({
  sha: HEAD,
  state: statuses[0]?.state ?? 'absent',
  description: '',
  time: statuses[0]?.time ?? '',
  bypass: false,
  statuses,
});

describe('githubReview', () => {
  it('reads the trusted writer\'s newest status and reports no foreign one', () => {
    const judged = githubReview(reading(status(APP, 'success')), APP);
    expect(judged).toMatchObject({ writer: 'checked', state: 'success', foreign: null });
  });

  it('reports a foreign status newer than the trusted one', () => {
    const judged = githubReview(reading(status('jwloka', 'success', 't2'), status(APP, 'failure', 't1')), APP);
    expect(judged).toMatchObject({ writer: 'checked', state: 'failure', foreign: { login: 'jwloka', state: 'success', time: 't2' } });
  });

  it('ignores a foreign status older than the trusted one', () => {
    expect(githubReview(reading(status(APP, 'success'), status('jwloka', 'failure')), APP).foreign).toBeNull();
  });

  it('reads absent where only a foreign writer wrote a status', () => {
    const judged = githubReview(reading(status('jwloka', 'success')), APP);
    expect(judged).toMatchObject({ state: 'absent', foreign: { login: 'jwloka' } });
  });

  it('reads the newest status of any writer where no writer is declared', () => {
    const judged = githubReview(reading(status('jwloka', 'success')), '');
    expect(judged).toMatchObject({ writer: 'unchecked', state: 'success', foreign: null });
  });

  it('reads absent and unread where the login could not be resolved', () => {
    expect(githubReview(reading(status(APP, 'success')), null)).toMatchObject({ writer: 'unread', state: 'absent' });
  });

  it('reads a reading with no statuses as holding none from the trusted writer', () => {
    const { statuses: _s, ...bare } = reading();
    expect(githubReview(bare, APP)).toMatchObject({ state: 'absent', foreign: null });
  });
});

describe('reviewPasses', () => {
  const options = { plain: 'review-not-passed' } as const;
  const pass = (judged: Parameters<typeof reviewPasses>[0], head = HEAD) => reviewPasses(judged, head, options);

  it('passes a trusted success on the head', () => {
    expect(pass(githubReview(reading(status(APP, 'success')), APP))).toEqual({ pass: true });
  });

  it('refuses a read that failed with the plain reason', () => {
    expect(pass('unaskable')).toMatchObject({ pass: false, reason: 'review-not-passed' });
  });

  it('refuses an unresolved login as review-writer-unread', () => {
    expect(pass(githubReview(reading(status(APP, 'success')), null))).toMatchObject({ pass: false, reason: 'review-writer-unread' });
  });

  it('refuses a newer foreign status as review-foreign-writer, naming its writer', () => {
    const out = pass(githubReview(reading(status('jwloka', 'success'), status(APP, 'success')), APP));
    expect(out).toMatchObject({ pass: false, reason: 'review-foreign-writer' });
    expect(out.pass === false && out.seen).toContain('jwloka');
  });

  it('refuses a review of another head with the plain reason', () => {
    expect(pass(githubReview(reading(status(APP, 'success')), APP), 'b'.repeat(40))).toMatchObject({ pass: false, reason: 'review-not-passed' });
  });

  it('refuses a state other than success with the plain reason', () => {
    expect(pass(githubReview(reading(status(APP, 'pending')), APP))).toMatchObject({ pass: false, reason: 'review-not-passed' });
  });

  it('names the caller\'s plain reason and compares heads with its own rule', () => {
    const judged = githubReview({ ...reading(status(APP, 'success')), sha: HEAD.slice(0, 12) }, APP);
    const sameHead = (a: string, b: string) => b.startsWith(a);
    expect(reviewPasses(judged, HEAD, { plain: 'review-missing', sameHead })).toEqual({ pass: true });
  });
});

describe('judgedReviewState', () => {
  it.each([
    ['trusted success', [status(APP, 'success')], 'success'],
    ['trusted failure', [status(APP, 'failure')], 'failure'],
    ['trusted pending', [status(APP, 'pending')], 'pending'],
    ['only a foreign success', [status('jwloka', 'success')], 'absent'],
    ['a foreign success over a trusted success', [status('jwloka', 'success'), status(APP, 'success')], 'absent'],
    ['a foreign success over a trusted pending', [status('jwloka', 'success'), status(APP, 'pending')], 'absent'],
    ['a foreign success over a trusted failure', [status('jwloka', 'success'), status(APP, 'failure')], 'failure'],
    ['a foreign failure over a trusted success', [status('jwloka', 'failure'), status(APP, 'success')], 'absent'],
    ['no status', [], 'absent'],
  ] as const)('%s judges %s', (_name, statuses, expected) => {
    expect(judgedReviewState(githubReview(reading(...statuses), APP))).toBe(expected);
  });

  it('judges nothing where the login could not be resolved', () => {
    expect(judgedReviewState(githubReview(reading(status(APP, 'success')), null))).toBeNull();
  });

  it('passes the rollup state through where no writer is declared', () => {
    expect(judgedReviewState(githubReview(reading(status('jwloka', 'success')), ''))).toBe('success');
  });
});
