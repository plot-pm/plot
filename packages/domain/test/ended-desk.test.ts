import { describe, expect, it } from 'vitest';
import { endedDeskPlacement, readEnding, type EndedDeskReadings } from '../src/index.js';

const bound = readEnding(JSON.stringify({ reason: 'bound', actor: 'bound', branch: '', detail: '' }));

/** The motivating desk: merged slice, clean tree, nothing unpushed, ended at the bound. */
const clean = (over: Partial<EndedDeskReadings> = {}): EndedDeskReadings => ({
  ending: bound,
  merged: true,
  dirty: false,
  unlanded: false,
  blockedQuestion: false,
  boundSeconds: 28800,
  ...over,
});

describe('endedDeskPlacement', () => {
  it('releases a clean desk that ended at the bound, and words the ending', () => {
    expect(endedDeskPlacement(clean())).toEqual({
      owesPerson: false,
      note: 'ended after 8 h with no slice offered — reaped on the next pass',
    });
  });

  it('words the ending without hours where the bound is unknown', () => {
    expect(endedDeskPlacement(clean({ boundSeconds: null })).note).toBe(
      'ended at the bound with no slice offered — reaped on the next pass',
    );
  });

  it.each([
    ['unlanded commits', { unlanded: true }],
    ['a dirty tree', { dirty: true }],
    ['a PLOT-BLOCKED question', { blockedQuestion: true }],
    ['an unmerged slice', { merged: false }],
  ] as const)('keeps a desk with %s with a person', (_name, over) => {
    expect(endedDeskPlacement(clean(over)).owesPerson).toBe(true);
  });

  it('keeps a desk with no ending record with a person — absent is not clean', () => {
    expect(endedDeskPlacement(clean({ ending: { read: 'absent' } }))).toEqual({ owesPerson: true, note: '' });
  });

  it('keeps an unreadable record, and any other reason, with a person', () => {
    expect(endedDeskPlacement(clean({ ending: { read: 'unreadable', why: 'not JSON' } })).owesPerson).toBe(true);
    const spent = readEnding(JSON.stringify({ reason: 'spent', actor: 'monitor' }));
    expect(endedDeskPlacement(clean({ ending: spent })).owesPerson).toBe(true);
  });

  it('treats an unasked reading as not clean', () => {
    for (const over of [{ merged: null }, { dirty: null }, { unlanded: null }, { blockedQuestion: null }]) {
      expect(endedDeskPlacement(clean(over)).owesPerson).toBe(true);
    }
  });
});
