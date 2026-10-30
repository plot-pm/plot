import { describe, expect, it } from 'vitest';

import type { UnblockerDueReading } from '../src/rules/unblocker-due.js';
import { unblockerDue } from '../src/rules/unblocker-due.js';

const reading = (over: Partial<UnblockerDueReading> = {}): UnblockerDueReading => ({
  marker: { askedAt: '2026-10-30T12:00:00.000Z' },
  deskDead: { dead: false, why: 'waiting' },
  liveFixer: false,
  recordedOutcomes: [],
  ...over,
});

describe('unblockerDue', () => {
  it('starts on an untagged marker, a waiting desk, no live fixer and no recorded outcome', () => {
    expect(unblockerDue(reading())).toEqual({ start: true });
  });

  it('refuses no-marker when the desk holds none', () => {
    expect(unblockerDue(reading({ marker: null }))).toEqual({ start: false, why: 'no-marker' });
  });

  it('refuses not-waiting on a dead desk even with a marker', () => {
    expect(unblockerDue(reading({ deskDead: { dead: true } }))).toEqual({ start: false, why: 'not-waiting' });
  });

  it.each(['live', 'elsewhere', 'unread'] as const)('refuses not-waiting on a %s desk', (why) => {
    expect(unblockerDue(reading({ deskDead: { dead: false, why } }))).toEqual({
      start: false,
      why: 'not-waiting',
    });
  });

  it.each(['fleetd', 'loop'] as const)('refuses tagged-marker when the marker is authored %s', (author) => {
    expect(
      unblockerDue(reading({ marker: { askedAt: '2026-10-30T12:00:00.000Z', author } })),
    ).toEqual({ start: false, why: 'tagged-marker' });
  });

  it('refuses live-fixer when an unblocker already runs on this desk', () => {
    expect(unblockerDue(reading({ liveFixer: true }))).toEqual({ start: false, why: 'live-fixer' });
  });

  it.each(['started', 'answered', 'refused no-marker', 'failed'])(
    'refuses already-recorded on a %s outcome',
    (outcome) => {
      expect(unblockerDue(reading({ recordedOutcomes: [outcome] }))).toEqual({
        start: false,
        why: 'already-recorded',
      });
    },
  );

  it('checks deskDead before the marker tag', () => {
    expect(
      unblockerDue(
        reading({ marker: { askedAt: '2026-10-30T12:00:00.000Z', author: 'loop' }, deskDead: { dead: true } }),
      ),
    ).toEqual({ start: false, why: 'not-waiting' });
  });
});
