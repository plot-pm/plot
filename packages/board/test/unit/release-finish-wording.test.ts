import { describe, expect, it } from 'vitest';
import { releaseFinishWording } from '../../src/app/lib/release-finish.js';

describe('releaseFinishWording', () => {
  it('names the booked plans', () => {
    expect(releaseFinishWording(200, { version: 'v2.36.0', outcome: 'booked', booked: ['alpha', 'beta'] })).toBe('v2.36.0 booked: alpha, beta.');
  });

  it('reports already-released as done', () => {
    expect(releaseFinishWording(200, { version: 'v2.36.0', outcome: 'already-released' })).toBe('v2.36.0 is already released.');
  });

  it('shows the refusal\'s reason and detail', () => {
    expect(releaseFinishWording(409, { version: '2.36.0', reason: 'tag-absent', error: 'no tag v2.36.0' })).toBe('tag-absent: no tag v2.36.0');
    expect(releaseFinishWording(403, { error: 'cross-origin request refused' })).toBe('cross-origin request refused');
    expect(releaseFinishWording(502, {})).toBe('refused (HTTP 502)');
  });
});
