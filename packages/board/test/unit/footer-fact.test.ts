import { describe, expect, it } from 'vitest';

import type { UnplacedView } from '../../src/app/lib/agent-rows/delivery-view.js';
import { durationText, footerFact, freshnessState, type FooterInput } from '../../src/app/lib/agent-rows/footer-fact.js';

const base: FooterInput = {
  boardAgeSeconds: 3, pollSeconds: 4, boardNextSeconds: 2,
  prAgeSeconds: 480, prIntervalMs: 240_000, prNextSeconds: 120, prError: false,
  frozen: false, complete: true, branches: 8, plans: 3, notPlaced: [],
};
const desk = (id: string): UnplacedView => ({
  id, subject: 'agent', reason: 'unread', label: `/Users/x/.worktrees/${id}`, note: 'no reading', rows: [],
});
const pr = (over: Partial<FooterInput>) => footerFact({ ...base, ...over }).freshness.find((e) => e.key === 'pr')!;

describe('the footer fact', () => {
  it('colours the same age by the reading\'s own interval', () => {
    expect(pr({ prAgeSeconds: 100, prIntervalMs: 120_000 }).state).toBe('fresh');
    expect(pr({ prAgeSeconds: 100, prIntervalMs: 60_000 }).state).toBe('aging');
    expect(pr({ prAgeSeconds: 200, prIntervalMs: 60_000 }).state).toBe('stale');
  });

  it('reads a null interval as age unknown, never fresh', () => {
    const e = pr({ prIntervalMs: null });
    expect(e.state).toBe('unknown');
    expect(e.word).toBe('age unknown');
    expect(freshnessState(1, null)).toBe('unknown');
  });

  it('shows the age alone where no next read exists', () => {
    const e = pr({ prNextSeconds: null });
    expect(e.text).toBe('PR data 8 min old');
    expect(e.next).toBeNull();
  });

  it('renders minutes from 60 s and seconds below', () => {
    expect(durationText(59)).toBe('59 s');
    expect(durationText(485)).toBe('8 min');
    expect(pr({}).next).toBe('next read in 2 min');
  });

  it('says no PR data yet for an absent age, never 0 s', () => {
    expect(pr({ prAgeSeconds: null }).text).toBe('no PR data yet');
    expect(footerFact({ ...base, prAgeSeconds: null, prError: true }).freshness.some((e) => e.key === 'pr')).toBe(false);
  });

  it('keeps (frozen) on a stale tab and so far on an incomplete scan', () => {
    const f = footerFact({ ...base, frozen: true, complete: false });
    expect(f.line).toContain('(frozen)');
    expect(f.counts).toBe('8 branches across 3 plans so far');
  });

  it('matches the example line', () => {
    const f = footerFact({ ...base, notPlaced: ['a', 'b', 'c', 'd', 'e'].map(desk) });
    expect(f.line).toBe(
      '● fresh · board read 3 s old · next in 2 s · ● aging · PR data 8 min old · next read in 2 min · 8 branches across 3 plans · 5 desks not placed · details',
    );
  });

  it('holds no desk path in the line while details holds all of them, and counts agree', () => {
    const f = footerFact({ ...base, notPlaced: ['a', 'b', 'c'].map(desk) });
    expect(f.line).not.toContain('/Users');
    expect(f.line).not.toMatch(/\//);
    expect(f.notPlaced?.details.every((d) => d.text.startsWith('/'))).toBe(true);
    expect(f.notPlaced?.count).toBe(f.notPlaced?.details.length);
  });

  it('omits the not-placed part when nothing is unplaced', () => {
    expect(footerFact(base).notPlaced).toBeNull();
    expect(footerFact(base).line).not.toContain('details');
  });
});
