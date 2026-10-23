import { describe, expect, it } from 'vitest';

import { extractHostNotices, prStatus, prStatusLevel } from '../src/rules/pr-status.js';

/**
 * THE PROPERTY THIS FILE EXISTS FOR: the PR footer's level, cause and backoff
 * end are a domain decision, not a string built in `host-notes.ts`. Every row
 * of the plan's table is asserted against {@link prStatus} with no component
 * rendered.
 */

const INTERVAL_S = 60;

/** The 2026-10-23 Bitbucket measurement: two notices, no real failure text. */
const BITBUCKET_NOTICES_ONLY =
  'plot-host: bitbucket ignores --limit 1000; the listing returns one page of 50 per state plot-host: bitbucket pr-list state=open page complete (8 rows below requested limit 1000) — this page holds every pull request the host has in this state';

const QUOTA_ERROR = 'GraphQL: API rate limit already exceeded for user ID 870334';
const SECONDARY_ERROR = 'You have exceeded a secondary rate limit. Please wait 60 seconds…';
const OUTAGE_ERROR = 'gh: 503';

describe('extractHostNotices — plot-host notices split from the real failure text', () => {
  it('reads both notices out of the measured Bitbucket string, leaving no cause', () => {
    const { notices, remainder } = extractHostNotices(BITBUCKET_NOTICES_ONLY);
    expect(notices).toEqual([
      { text: 'bitbucket ignores --limit 1000; the listing returns one page of 50 per state' },
      {
        text: 'bitbucket pr-list state=open page complete (8 rows below requested limit 1000) — this page holds every pull request the host has in this state',
      },
    ]);
    expect(remainder).toBeNull();
  });

  it('leaves a plain failure untouched, with no notices', () => {
    const { notices, remainder } = extractHostNotices(OUTAGE_ERROR);
    expect(notices).toEqual([]);
    expect(remainder).toBe(OUTAGE_ERROR);
  });

  it('answers no notices and no remainder where nothing failed', () => {
    expect(extractHostNotices(null)).toEqual({ notices: [], remainder: null });
  });
});

describe('prStatusLevel — the plan\'s three-level table', () => {
  it('info: fresh cache, no refusal', () => {
    expect(prStatusLevel(null, true, 30, INTERVAL_S)).toBe('info');
  });

  it('warning: cache older than 2x the interval, no refusal', () => {
    expect(prStatusLevel(null, true, 121, INTERVAL_S)).toBe('warning');
  });

  it('warning: a spent quota, but data is still on screen', () => {
    expect(prStatusLevel('quota', true, 30, INTERVAL_S)).toBe('warning');
  });

  it('warning: a secondary limit, but data is still on screen', () => {
    expect(prStatusLevel('secondary', true, 30, INTERVAL_S)).toBe('warning');
  });

  it('error: no data at all, even with no refusal (never happened yet)', () => {
    expect(prStatusLevel(null, false, null, INTERVAL_S)).toBe('error');
  });

  it('error: an outage with data still showing is still error — no known end', () => {
    expect(prStatusLevel('outage', true, 30, INTERVAL_S)).toBe('error');
  });

  it('error: no data and a refusal of any kind', () => {
    expect(prStatusLevel('quota', false, null, INTERVAL_S)).toBe('error');
    expect(prStatusLevel('secondary', false, null, INTERVAL_S)).toBe('error');
    expect(prStatusLevel('outage', false, null, INTERVAL_S)).toBe('error');
  });
});

describe('prStatus — the composed decision', () => {
  it('info row: fresh cache, nothing to report', () => {
    const status = prStatus({
      error: null,
      ageSeconds: 30,
      nextInSeconds: null,
      spenders: null,
      intervalSeconds: INTERVAL_S,
    });
    expect(status.level).toBe('info');
    expect(status.kind).toBeNull();
    expect(status.cause).toBeNull();
    expect(status.backoffInSeconds).toBeNull();
    expect(status.notices).toEqual([]);
  });

  it('warning row: stale cache past 2x the interval, no refusal', () => {
    const status = prStatus({
      error: null,
      ageSeconds: 200,
      nextInSeconds: null,
      spenders: null,
      intervalSeconds: INTERVAL_S,
    });
    expect(status.level).toBe('warning');
    expect(status.cause).toBeNull();
  });

  /**
   * The defect the plan's Motivation section measures directly: the notices
   * must come back as a separate list, never folded into `cause`.
   */
  it('warning row: Bitbucket notices land as diagnostics, never in the cause', () => {
    const status = prStatus({
      error: BITBUCKET_NOTICES_ONLY,
      ageSeconds: 840,
      nextInSeconds: null,
      spenders: null,
      intervalSeconds: INTERVAL_S,
    });
    expect(status.cause).toBeNull();
    expect(status.notices).toHaveLength(2);
    expect(status.notices.some((n) => n.text.includes('page complete'))).toBe(true);
    expect(status.notices.some((n) => n.text.includes('ignores --limit'))).toBe(true);
  });

  /**
   * A quota refusal's backoff end survives into the value only where
   * `resetApplies` says it applies to this refusal — reused, not re-decided.
   */
  it('a spent quota carries its backoff end through unchanged', () => {
    const status = prStatus({
      error: QUOTA_ERROR,
      ageSeconds: 300,
      nextInSeconds: 840,
      spenders: null,
      intervalSeconds: INTERVAL_S,
    });
    expect(status.level).toBe('warning');
    expect(status.kind).toBe('quota');
    expect(status.backoffInSeconds).toBe(840);
    expect(status.cause).toBe(QUOTA_ERROR);
  });

  it('a secondary limit never shows the primary bucket\'s backoff', () => {
    const status = prStatus({
      error: SECONDARY_ERROR,
      ageSeconds: 10,
      nextInSeconds: 840,
      spenders: 3,
      intervalSeconds: INTERVAL_S,
    });
    expect(status.kind).toBe('secondary');
    expect(status.backoffInSeconds).toBeNull();
    expect(status.spenders).toBe(3);
  });

  /** A null spender count must render as absent, never as zero or invented. */
  it('a null spender count stays null, never zero', () => {
    const status = prStatus({
      error: SECONDARY_ERROR,
      ageSeconds: 10,
      nextInSeconds: null,
      spenders: null,
      intervalSeconds: INTERVAL_S,
    });
    expect(status.spenders).toBeNull();
  });

  it('a spender count is dropped for a kind it does not explain', () => {
    const status = prStatus({
      error: QUOTA_ERROR,
      ageSeconds: 10,
      nextInSeconds: 840,
      spenders: 5,
      intervalSeconds: INTERVAL_S,
    });
    expect(status.spenders).toBeNull();
  });

  it('error row: no data and missing credentials reads outage with no backoff', () => {
    const status = prStatus({
      error: 'gh: authentication required',
      ageSeconds: null,
      nextInSeconds: null,
      spenders: null,
      intervalSeconds: INTERVAL_S,
    });
    expect(status.level).toBe('error');
    expect(status.kind).toBe('outage');
    expect(status.backoffInSeconds).toBeNull();
  });

  it('error row: no data at all, no refusal either', () => {
    const status = prStatus({
      error: null,
      ageSeconds: null,
      nextInSeconds: null,
      spenders: null,
      intervalSeconds: INTERVAL_S,
    });
    expect(status.level).toBe('error');
    expect(status.kind).toBeNull();
    expect(status.cause).toBeNull();
  });
});
