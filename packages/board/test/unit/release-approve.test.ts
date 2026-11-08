import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AgentRow } from '../../src/contract/schema.js';

vi.mock('../../src/app/lib/passkey.js', async (original) => ({
  ...(await original<typeof import('../../src/app/lib/passkey.js')>()),
  assertWith: async () => ({ signature: 'sig' }),
}));

const { approveRelease, releaseReadingOf } = await import('../../src/app/lib/release-approve.js');

const calls: { url: string; body: Record<string, unknown> }[] = [];

const answer = (url: string): { status: number; body: unknown } =>
  url === '/api/passkey/challenge'
    ? { status: 200, body: { challenge: 'c' } }
    : { status: 200, body: { approved: true, credentialId: 'cred' } };

vi.stubGlobal('fetch', async (url: string, init: { body: string }) => {
  calls.push({ url, body: JSON.parse(init.body) });
  const { status, body } = answer(url);
  return { status, json: async () => body };
});

afterEach(() => {
  calls.length = 0;
});

describe('approving a release from its row', () => {
  it("asks the challenge and posts the clicked row's own PR number and head", async () => {
    const pr = { number: 412, headSha: 'f'.repeat(40) };
    const done = await approveRelease(pr.number, pr.headSha);
    expect(calls.map((c) => c.url)).toEqual(['/api/passkey/challenge', '/api/release-approve']);
    expect(calls[0].body).toEqual({ action: 'release-approve', pr: 412, sha: pr.headSha });
    expect(calls[1].body).toMatchObject({ pr: 412, sha: pr.headSha });
    expect(done).toContain('#412');
  });

  it('reads the row without inventing a review the payload did not carry', () => {
    const pr = { number: 7, url: '', draft: false, state: 'green', states: ['green'], author: '' } as AgentRow['pr'];
    const reading = releaseReadingOf(pr);
    expect(reading).toMatchObject({ open: false, plotReview: undefined, plotReviewSha: undefined });
    expect(releaseReadingOf(null)).toBeNull();
  });
});
