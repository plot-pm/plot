import { describe, it, expect } from 'vitest';
import { waveBadgeText } from '../../src/app/components/PlanCard.js';

// What the tile SAYS, as distinct from what the server computed. The server's
// job is to know; this decides what is worth showing, and the interesting cases
// are the ones where the honest answer is "nothing".

describe('waveBadgeText', () => {
  it('shows shape and occupancy together for a multi-wave plan', () => {
    expect(waveBadgeText({ waves: 3, branches: 4, deferred: 0, claimed: 1, eligible: 2 }))
      .toBe('3 slices · 4 branches · 1 claimed · 2 ready');
  });

  it('drops the shape half on a single-wave plan but keeps occupancy', () => {
    // "1 slices · 1 branches" is noise. "1 claimed" is the answer someone
    // actually wants, and withholding it from single-wave plans is what the old
    // `waves.length > 1` guard did to most of this repo.
    expect(waveBadgeText({ waves: 1, branches: 2, deferred: 0, claimed: 1, eligible: 1 }))
      .toBe('1 claimed · 1 ready');
  });

  it('says nothing when a single-wave plan has nothing in flight', () => {
    // An empty badge is a visual artifact — a grey pill with no text. The card
    // must render no badge at all, which is what "" signals to the caller.
    expect(waveBadgeText({ waves: 1, branches: 2, deferred: 0, claimed: 0, eligible: 0 }))
      .toBe('');
  });

  it('says nothing about occupancy when the counts are ABSENT', () => {
    // No pulse: the board has not looked. It must not say "0 claimed", and it
    // must not say "1 claimed" either — it says nothing, and a single-wave plan
    // is then left with nothing at all to show.
    expect(waveBadgeText({ waves: 1, branches: 2, deferred: 0 })).toBe('');
    // A multi-wave plan still shows its shape, which git was never needed for.
    expect(waveBadgeText({ waves: 2, branches: 3, deferred: 0 }))
      .toBe('2 slices · 3 branches');
  });

  it('renders a known zero the same as an unknown one — by omitting both', () => {
    // Deliberate: on the SCREEN there is nothing useful to say either way. The
    // distinction that matters is kept in the data (undefined vs 0), where a
    // consumer that needs it can still see it; the badge simply has no room to
    // express "we checked and nobody is working on this".
    const unknown = waveBadgeText({ waves: 2, branches: 3, deferred: 0 });
    const zero = waveBadgeText({ waves: 2, branches: 3, deferred: 0, claimed: 0, eligible: 0 });
    expect(unknown).toBe(zero);
  });

  it('shows only the half that has something to report', () => {
    expect(waveBadgeText({ waves: 1, branches: 3, deferred: 0, claimed: 2, eligible: 0 }))
      .toBe('2 claimed');
    expect(waveBadgeText({ waves: 1, branches: 3, deferred: 0, claimed: 0, eligible: 3 }))
      .toBe('3 ready');
  });
});
