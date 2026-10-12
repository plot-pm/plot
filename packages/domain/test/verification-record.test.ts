import { describe, expect, it } from 'vitest';

import { refutedClaims, verificationOf } from '../src/rules/verification-record.js';

const SHA = '1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b';

const planText = (opts: { verified?: string; claims?: string[] } = {}): string =>
  [
    '# P',
    '',
    '## Status',
    '',
    '- **State:** Delivered',
    '- **Delivered:** 2026-10-19',
    ...(opts.verified === undefined ? [] : [`- **Verified:** ${opts.verified}`]),
    '',
    ...(opts.claims === undefined ? [] : ['## Verification', '', ...opts.claims, '']),
  ].join('\n');

const RECORD = '2026-10-20, delivery 2026-10-19 at 1a2b3c4, judged at 1a2b3c4 with tools at 9f8e7d6, 1 supported, 0 refuted';
const OK = '- Claim-1 supported — Does a thing — 3 of 3 (executed: behaviour)';
const BAD = '- Claim-2 refuted — Does another — behaviour refuted; changelog supported — #1712';

const plan = (text: string, extra: { tracer?: boolean; deliveredRaw?: string } = {}) => ({
  text,
  tracer: extra.tracer ?? false,
  deliveredRaw: extra.deliveredRaw ?? '2026-10-19',
});

describe('verificationOf', () => {
  it('answers unverified for a plan with no Verified line', () => {
    expect(verificationOf(plan(planText()), SHA)).toBe('unverified');
  });

  it('answers unverified for a placeholder Verified line', () => {
    expect(verificationOf(plan(planText({ verified: '<!-- date -->' })), SHA)).toBe('unverified');
  });

  it('answers supported when every claim line is supported', () => {
    expect(verificationOf(plan(planText({ verified: RECORD, claims: [OK] })), SHA)).toBe('supported');
  });

  it('answers refuted when any claim line is refuted', () => {
    expect(verificationOf(plan(planText({ verified: RECORD, claims: [OK, BAD] })), SHA)).toBe('refuted');
  });

  it('answers stale for a changed Delivered date', () => {
    const p = plan(planText({ verified: RECORD, claims: [OK, BAD] }), { deliveredRaw: '2026-10-21' });
    expect(verificationOf(p, SHA)).toBe('stale');
  });

  it('answers stale for an absent Delivered line', () => {
    const p = plan(planText({ verified: RECORD, claims: [OK, BAD] }), { deliveredRaw: '' });
    expect(verificationOf(p, SHA)).toBe('stale');
  });

  it('answers stale for a different delivery commit with the same date', () => {
    const p = plan(planText({ verified: RECORD, claims: [OK, BAD] }));
    expect(verificationOf(p, 'ffffffffffffffffffffffffffffffffffffffff')).toBe('stale');
  });

  it('matches an abbreviated record commit against a full delivery commit', () => {
    expect(verificationOf(plan(planText({ verified: RECORD, claims: [OK] })), SHA)).toBe('supported');
  });

  it('reads no commit as no disagreement', () => {
    expect(verificationOf(plan(planText({ verified: RECORD, claims: [OK] })), null)).toBe('supported');
  });

  it('answers unverified for a tracer plan that carries a record', () => {
    const p = plan(planText({ verified: RECORD, claims: [OK, BAD] }), { tracer: true });
    expect(verificationOf(p, SHA)).toBe('unverified');
  });

  it('answers stale for a record that names no delivery', () => {
    expect(verificationOf(plan(planText({ verified: '2026-10-20', claims: [OK] })), SHA)).toBe('stale');
  });
});

describe('refutedClaims', () => {
  it('reads the number, text and issue of a refuted line', () => {
    expect(refutedClaims(planText({ claims: [OK, BAD] }))).toEqual([
      { n: 2, claim: 'Does another', issue: 1712, noIssue: null },
    ]);
  });

  it('reads the reason after no issue', () => {
    const line = '- Claim-5 refuted — Thing — changelog refuted — no issue: the port said no';
    expect(refutedClaims(planText({ claims: [line] }))).toEqual([
      { n: 5, claim: 'Thing', issue: null, noIssue: 'the port said no' },
    ]);
  });

  it('reads a refuted line with neither issue nor reason', () => {
    const line = '- Claim-3 refuted — Thing — changelog refuted';
    expect(refutedClaims(planText({ claims: [line] }))).toEqual([
      { n: 3, claim: 'Thing', issue: null, noIssue: null },
    ]);
  });

  it('omits a line it cannot parse', () => {
    expect(refutedClaims(planText({ claims: ['- Claim-3 refuted', '- Claim-x refuted — a — b'] }))).toEqual([]);
  });

  it('answers empty where the section is absent', () => {
    expect(refutedClaims(planText())).toEqual([]);
  });
});
