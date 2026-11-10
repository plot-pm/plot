import { describe, expect, it } from 'vitest';
import { releaseTargets, releaseTicketCounts, releaseTicketWording, type ReleaseTicketReading } from '../src/rules/release-tickets.js';

const reading = (over: Partial<ReleaseTicketReading> = {}): ReleaseTicketReading => ({
  open: [{ releases: ['2.32.0'] }, { releases: [] }, {}],
  closed: [{ releases: ['2.32.0'] }, { releases: ['2.31.0'] }],
  closedComplete: true,
  closedSince: '2026-10-27T00:00:00Z',
  ...over,
});

describe('releaseTicketCounts', () => {
  it('counts three row states apart: planned, untriaged, and absent as neither', () => {
    expect(releaseTicketCounts(reading(), '2.32.0')).toEqual({ planned: 1, untriaged: 1, closed: 1, closedPartial: false });
  });

  it('matches the release by exact name', () => {
    const r = reading({ open: [{ releases: ['2.32'] }, { releases: [] }], closed: [{ releases: ['2.32'] }] });
    expect(releaseTicketCounts(r, '2.32.0')).toMatchObject({ planned: 0, closed: 0 });
  });

  it('does not count a closed row of another release', () => {
    expect(releaseTicketCounts(reading({ closed: [{ releases: ['2.31.0'] }] }), '2.32.0')?.closed).toBe(0);
  });

  it('marks the closed count partial where the closed read is incomplete', () => {
    expect(releaseTicketCounts(reading({ closedComplete: false }), '2.32.0')?.closedPartial).toBe(true);
  });

  it('marks the closed count partial where the sprint began before the window', () => {
    expect(releaseTicketCounts(reading(), '2.32.0', '2026-10-01')?.closedPartial).toBe(true);
    expect(releaseTicketCounts(reading(), '2.32.0', '2026-11-01')?.closedPartial).toBe(false);
  });

  it('answers null closed where no closed read answered', () => {
    expect(releaseTicketCounts(reading({ closed: null }), '2.32.0')?.closed).toBeNull();
  });

  it('answers null with no index and where no open row states a release', () => {
    expect(releaseTicketCounts(reading({ open: null }), '2.32.0')).toBeNull();
    expect(releaseTicketCounts(reading({ open: [{}, {}] }), '2.32.0')).toBeNull();
  });
});

describe('releaseTicketWording', () => {
  it('words the three counts', () => {
    expect(releaseTicketWording(reading(), '2.32.0')).toBe('2.32.0 tickets: closed 1 · planned 1 · untriaged 1');
  });

  it('prints a plus on a partial closed count', () => {
    expect(releaseTicketWording(reading({ closedComplete: false }), '2.32.0')).toContain('closed 1+');
  });

  it('omits closed, never prints closed 0, where the closed set is absent', () => {
    const w = releaseTicketWording(reading({ closed: null }), '2.32.0');
    expect(w).toBe('2.32.0 tickets: planned 1 · untriaged 1');
  });

  it('prints nothing where the counts are unread', () => {
    expect(releaseTicketWording(reading({ open: null }), '2.32.0')).toBeNull();
    expect(releaseTicketWording(reading({ open: [{}] }), '2.32.0')).toBeNull();
  });
});

describe('releaseTargets', () => {
  it('gives one entry per distinct release, the earlier start for a shared one', () => {
    expect(releaseTargets([
      { release: '2.32.0', started: '2026-11-03' },
      { release: '2.33.0', started: '2026-11-10' },
      { release: '2.32.0', started: '2026-10-27' },
    ])).toEqual([
      { release: '2.32.0', started: '2026-10-27' },
      { release: '2.33.0', started: '2026-11-10' },
    ]);
  });

  it('adds none for a sprint naming no release', () => {
    expect(releaseTargets([{ release: '', started: '2026-11-03' }])).toEqual([]);
  });
});
