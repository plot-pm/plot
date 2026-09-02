import { describe, expect, it } from 'vitest';

import {
  localSpenders,
  refusalKind,
  refusalReport,
  resetApplies,
} from '../src/rules/refusal.js';

/**
 * THE PROPERTY THIS FILE EXISTS FOR: a secondary limit and a spent quota are
 * two ceilings, and nothing may hand a caller one word for both.
 *
 * The two failures were measured separately. 2026-08-27: eight workers against
 * a cap of seven produced a 403 naming abuse detection. 2026-09-01: `gh pr
 * view` refused with *"API rate limit already exceeded"* while the same
 * account's GraphQL headers read 4854 of 5000 remaining — a bucket with 97 %
 * left does not refuse on quota.
 */

/** The board's unstretched interval — `PR_REFRESH_MS`. */
const INTERVAL = 60_000;
/** GitHub costs one request per refresh; Bitbucket four. */
const GITHUB = 1;
const BITBUCKET = 4;

/** What GitHub says when the window's requests are gone. */
const QUOTA = 'GraphQL: API rate limit already exceeded for user ID 870334';
/** What GitHub says when too many arrived at once. */
const SECONDARY = 'You have exceeded a secondary rate limit. Please wait 60 seconds…';

describe('refusalKind — the two limits are two answers', () => {
  it('reads a spent quota as quota', () => {
    expect(refusalKind(QUOTA)).toBe('quota');
  });

  /**
   * THE ORDER OF THE TWO TESTS IS THE CLASSIFICATION. GitHub's secondary
   * message contains the phrase *"rate limit"* too, so a quota test applied
   * first claims every secondary refusal — which is exactly the collapse this
   * slice removes.
   */
  it('reads a secondary limit as secondary, though it also says "rate limit"', () => {
    expect(SECONDARY).toMatch(/rate limit/i);
    expect(refusalKind(SECONDARY)).toBe('secondary');
  });

  it('reads the 2026-08-27 abuse-detection wording as secondary', () => {
    expect(refusalKind('403: You have triggered an abuse detection mechanism')).toBe('secondary');
  });

  it('reads a 429 as secondary', () => {
    expect(refusalKind('HTTP 429: Too Many Requests')).toBe('secondary');
  });

  /**
   * THE SPLIT FALLS ONE WAY ONLY, the direction `host_failure_kind` refuses to
   * guess in: an unrecognised message never earns the more specific name,
   * because both limit words counsel a wait and a wait does not fix an outage.
   */
  it('reads anything it does not recognise as an outage', () => {
    expect(refusalKind('gh: 503')).toBe('outage');
    expect(refusalKind('Command failed: bash …/plot-host.sh')).toBe('outage');
  });

  it('answers null where nothing failed', () => {
    expect(refusalKind(null)).toBeNull();
    expect(refusalKind('')).toBeNull();
  });
});

describe('resetApplies — only a spent quota has a reset worth printing', () => {
  it('allows a reset for a spent quota', () => {
    expect(resetApplies('quota')).toBe(true);
  });

  /**
   * The measured defect. A secondary limit clears in seconds, and the reset
   * beside it belongs to the primary bucket — a different ceiling. Printing it
   * counsels minutes of waiting for a limit that has already cleared.
   */
  it('refuses a reset for a secondary limit', () => {
    expect(resetApplies('secondary')).toBe(false);
  });

  it('refuses a reset for an outage and for no refusal at all', () => {
    expect(resetApplies('outage')).toBe(false);
    expect(resetApplies(null)).toBe(false);
  });
});

describe('localSpenders — counted from the record, never from a headcount', () => {
  /**
   * One spender's share is 60 requests an hour on every backend, which is what
   * `boardSharePerHour` derives and what the cadence divides by. Two spenders
   * therefore show as 120 an hour.
   */
  it('divides the observed rate by one spender share', () => {
    expect(localSpenders({ perHour: 120 }, INTERVAL, GITHUB)).toBe(2);
    expect(localSpenders({ perHour: 180 }, INTERVAL, GITHUB)).toBe(3);
  });

  /**
   * BITBUCKET SPENDS FOUR PER REFRESH AND STILL SHARES 60 AN HOUR. Reading the
   * share off the interval alone would make four Bitbucket spenders read as
   * one, which is the same error `targetStretch` documents.
   */
  it('reads the same share on a backend that costs four requests a refresh', () => {
    expect(localSpenders({ perHour: 120 }, INTERVAL, BITBUCKET)).toBe(2);
  });

  /**
   * A refusal is itself evidence that something spent, so a rate below one
   * share still means one spender rather than none.
   */
  it('floors at one spender', () => {
    expect(localSpenders({ perHour: 12 }, INTERVAL, GITHUB)).toBe(1);
  });

  /**
   * NULL IS AN ABSENT MEASUREMENT, NEVER AN IDLE ACCOUNT — the direction
   * `spendRateFor` fails in. The banner then names the limit and invents no
   * population.
   */
  it('answers null where the record said nothing', () => {
    expect(localSpenders(null, INTERVAL, GITHUB)).toBeNull();
    expect(localSpenders({ perHour: null }, INTERVAL, GITHUB)).toBeNull();
    expect(localSpenders({ perHour: 0 }, INTERVAL, GITHUB)).toBeNull();
    expect(localSpenders({ perHour: Number.NaN }, INTERVAL, GITHUB)).toBeNull();
  });

  it('answers null where the share cannot be computed', () => {
    expect(localSpenders({ perHour: 120 }, 0, GITHUB)).toBeNull();
  });
});

describe('refusalReport — what the banner is told about one refusal', () => {
  it('gives a spent quota its reset and no population', () => {
    expect(refusalReport(QUOTA, { perHour: 180 }, INTERVAL, GITHUB)).toEqual({
      kind: 'quota',
      showsReset: true,
      spenders: null,
    });
  });

  /**
   * The count belongs to the case it explains. Local contention is fixed by
   * closing a board; an account ceiling one spender can reach alone is not, and
   * naming a population there would point at the wrong lever.
   */
  it('gives a secondary limit its population and no reset', () => {
    expect(refusalReport(SECONDARY, { perHour: 180 }, INTERVAL, GITHUB)).toEqual({
      kind: 'secondary',
      showsReset: false,
      spenders: 3,
    });
  });

  it('omits the population where the record could not be read', () => {
    expect(refusalReport(SECONDARY, null, INTERVAL, GITHUB)).toEqual({
      kind: 'secondary',
      showsReset: false,
      spenders: null,
    });
  });

  it('gives an outage neither', () => {
    expect(refusalReport('gh: 503', { perHour: 180 }, INTERVAL, GITHUB)).toEqual({
      kind: 'outage',
      showsReset: false,
      spenders: null,
    });
  });

  it('answers null where nothing failed', () => {
    expect(refusalReport(null, { perHour: 180 }, INTERVAL, GITHUB)).toBeNull();
  });
});
