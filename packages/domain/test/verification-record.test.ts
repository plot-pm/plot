import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { refutedBadge, refutedClaims, verificationOf } from '../src/rules/verification-record.js';

const THIS_PLAN = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../docs/plans/2026-10-12-the-fleet-verifies-what-it-delivered.md',
);

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

/**
 * The plan as `verificationOf` reads it. `verifiedRaw` defaults to the record
 * written into the text, which is what `plot-plan-meta.sh` reports for a filled
 * `## Status` line outside fences.
 */
const plan = (
  opts: { verified?: string; claims?: string[] },
  extra: { tracer?: boolean; deliveredRaw?: string; verifiedRaw?: string; text?: string } = {},
) => ({
  text: extra.text ?? planText(opts),
  tracer: extra.tracer ?? false,
  deliveredRaw: extra.deliveredRaw ?? '2026-10-19',
  verifiedRaw: extra.verifiedRaw ?? opts.verified ?? '',
});

describe('verificationOf', () => {
  it('answers unverified for a plan with no Verified line', () => {
    expect(verificationOf(plan({}), SHA)).toBe('unverified');
  });

  it('answers unverified for a placeholder Verified line, which the parser reports as empty', () => {
    expect(verificationOf(plan({ verified: '<!-- date -->', claims: [OK] }, { verifiedRaw: '' }), SHA)).toBe('unverified');
  });

  it('answers unverified for a Verified example inside a fenced block', () => {
    const text = [
      '# P', '', '## Status', '', '- **State:** Delivered', '- **Delivered:** 2026-10-19', '',
      '## Design', '', '```markdown', `- **Verified:** ${RECORD}`, '', '## Verification', '', OK, '```', '',
    ].join('\n');
    expect(verificationOf(plan({}, { text, verifiedRaw: '' }), SHA)).toBe('unverified');
    expect(verificationOf(plan({}, { text, verifiedRaw: '' }), null)).toBe('unverified');
  });

  it('answers unverified for this plan\'s own file, Delivered with no record', () => {
    const text = fs.readFileSync(THIS_PLAN, 'utf8');
    expect(text).toContain('- **Verified:** 2026-10-20, delivery 2026-10-19 at 1a2b3c4');
    expect(verificationOf(plan({}, { text, verifiedRaw: '' }), SHA)).toBe('unverified');
  });

  it('answers stale for a record whose Verification section holds no claim line', () => {
    expect(verificationOf(plan({ verified: RECORD }), SHA)).toBe('stale');
    expect(verificationOf(plan({ verified: RECORD, claims: ['- not a claim'] }), SHA)).toBe('stale');
  });

  it('answers stale for a record whose claim lines are all fenced', () => {
    expect(verificationOf(plan({ verified: RECORD, claims: ['```', OK, '```'] }), SHA)).toBe('stale');
  });

  it('reads the claim lines of a CRLF file', () => {
    const text = planText({ verified: RECORD, claims: [OK, BAD] }).replace(/\n/g, '\r\n');
    expect(verificationOf(plan({ verified: RECORD }, { text }), SHA)).toBe('refuted');
    expect(refutedClaims(text)).toEqual([{ n: 2, claim: 'Does another', issue: '1712', noIssue: null }]);
  });

  it('answers supported when every claim line is supported', () => {
    expect(verificationOf(plan({ verified: RECORD, claims: [OK] }), SHA)).toBe('supported');
  });

  it('answers refuted when any claim line is refuted', () => {
    expect(verificationOf(plan({ verified: RECORD, claims: [OK, BAD] }), SHA)).toBe('refuted');
  });

  it('answers stale for a changed Delivered date', () => {
    const p = plan({ verified: RECORD, claims: [OK, BAD] }, { deliveredRaw: '2026-10-21' });
    expect(verificationOf(p, SHA)).toBe('stale');
  });

  it('answers stale for an absent Delivered line', () => {
    const p = plan({ verified: RECORD, claims: [OK, BAD] }, { deliveredRaw: '' });
    expect(verificationOf(p, SHA)).toBe('stale');
  });

  it('answers stale for a different delivery commit with the same date', () => {
    const p = plan({ verified: RECORD, claims: [OK, BAD] });
    expect(verificationOf(p, 'ffffffffffffffffffffffffffffffffffffffff')).toBe('stale');
  });

  it('matches an abbreviated record commit against a full delivery commit', () => {
    expect(verificationOf(plan({ verified: RECORD, claims: [OK] }), SHA)).toBe('supported');
  });

  it('reads no commit as no disagreement', () => {
    expect(verificationOf(plan({ verified: RECORD, claims: [OK] }), null)).toBe('supported');
  });

  it('answers unverified for a tracer plan that carries a record', () => {
    const p = plan({ verified: RECORD, claims: [OK, BAD] }, { tracer: true });
    expect(verificationOf(p, SHA)).toBe('unverified');
  });

  it('answers stale for a record that names no delivery', () => {
    expect(verificationOf(plan({ verified: '2026-10-20', claims: [OK] }), SHA)).toBe('stale');
  });
});

describe('refutedClaims', () => {
  it('reads the number, text and issue of a refuted line', () => {
    expect(refutedClaims(planText({ claims: [OK, BAD] }))).toEqual([
      { n: 2, claim: 'Does another', issue: '1712', noIssue: null },
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

  it('omits a refuted line that has no lens column', () => {
    expect(refutedClaims(planText({ claims: ['- Claim-3 refuted — Thing'] }))).toEqual([]);
  });

  it('ignores a claim line inside a fenced block', () => {
    expect(refutedClaims(planText({ claims: ['```', BAD, '```'] }))).toEqual([]);
  });

  it('answers empty where the section is absent', () => {
    expect(refutedClaims(planText())).toEqual([]);
  });
});

describe('refutedBadge', () => {
  it('draws the count for a refuted state', () => {
    expect(refutedBadge('refuted', 2)).toBe('2 refuted');
  });

  it('draws nothing for a refuted state with no counted claim', () => {
    expect(refutedBadge('refuted', 0)).toBe('');
  });

  it('draws nothing for unverified, supported and stale', () => {
    expect(refutedBadge('unverified', 0)).toBe('');
    expect(refutedBadge('supported', 0)).toBe('');
    expect(refutedBadge('stale', 1)).toBe('');
  });
});
