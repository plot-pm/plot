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

const LIMIT_NOTICE =
  'plot-host: bitbucket ignores --limit 1000; the listing returns one page of 50 per state';

/** `pr_list_failed`'s throttle line, as `plot-host.sh` prints it. */
const THROTTLED_FAILURE = 'plot-host: pr-list: host throttled — bb: HTTP 429 Too Many Requests';

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

  it('keeps a plot-host failure line in the remainder, never as a notice', () => {
    const { notices, remainder } = extractHostNotices(THROTTLED_FAILURE);
    expect(notices).toEqual([]);
    expect(remainder).toBe(THROTTLED_FAILURE);
  });

  it('splits a notice from a plot-host failure on the next line', () => {
    const { notices, remainder } = extractHostNotices(`${LIMIT_NOTICE}\n${THROTTLED_FAILURE}`);
    expect(notices).toEqual([
      { text: 'bitbucket ignores --limit 1000; the listing returns one page of 50 per state' },
    ]);
    expect(remainder).toBe(THROTTLED_FAILURE);
  });

  it('keeps an unprefixed failure line that follows a notice', () => {
    const { notices, remainder } = extractHostNotices(`${LIMIT_NOTICE}\nbb: HTTP 429`);
    expect(notices).toHaveLength(1);
    expect(remainder).toBe('bb: HTTP 429');
  });

  it('keeps unprefixed failure text that follows a notice on the same line', () => {
    const { notices, remainder } = extractHostNotices(`${BITBUCKET_NOTICES_ONLY} bb: HTTP 429`);
    expect(notices).toHaveLength(2);
    expect(remainder).toBe('bb: HTTP 429');
  });

  it('reads a Bitbucket window-complete notice, the sibling of page complete and sweep complete', () => {
    const windowNotice = 'plot-host: bitbucket pr-list state=merged window complete '
      + '(3 matches, every page read) — this window holds every pull request the host has in this state since the stamp';
    const { notices, remainder } = extractHostNotices(windowNotice);
    expect(notices).toEqual([{
      text: 'bitbucket pr-list state=merged window complete (3 matches, every page read) '
        + '— this window holds every pull request the host has in this state since the stamp',
    }]);
    expect(remainder).toBeNull();
  });

  it('keeps every plot-host failure shape out of the notices', () => {
    for (const failure of [
      'plot-host: pr-list: host refused a burst — HTTP 429',
      'plot-host: pr-list: answered 1 of 2 states; missing: merged',
      'plot-host: bitbucket pr-list state=merged possibly truncated (50 rows, requested limit 1000 unprovable) — a join against this page may read older branches as \'no PR\' (#333)',
      'plot-host: no temp file could be made under /tmp',
    ]) {
      expect(extractHostNotices(failure)).toEqual({ notices: [], remainder: failure });
    }
  });

  it('answers no notices and no remainder where nothing failed', () => {
    expect(extractHostNotices(null)).toEqual({ notices: [], remainder: null });
  });

  /**
   * The regression this covers: `read from \S+` stopped after "the" and left
   * "environment" behind in the remainder as a false outage cause.
   */
  it('matches the credential-source notice to the end of its sentence, not just the first word', () => {
    const { notices, remainder } = extractHostNotices(
      'plot-host: JENKINS_USER and JENKINS_API_TOKEN read from the environment',
    );
    expect(notices).toEqual([
      { text: 'JENKINS_USER and JENKINS_API_TOKEN read from the environment' },
    ]);
    expect(remainder).toBeNull();
  });

  it('keeps a real failure on the next line after a credential-source notice', () => {
    const { notices, remainder } = extractHostNotices(
      'plot-host: JENKINS_USER and JENKINS_API_TOKEN read from the environment\nplot-host: pr-list: host throttled — bb: HTTP 429 Too Many Requests',
    );
    expect(notices).toEqual([
      { text: 'JENKINS_USER and JENKINS_API_TOKEN read from the environment' },
    ]);
    expect(remainder).toBe(THROTTLED_FAILURE);
  });

  it('extracts the BITBUCKET_REVIEW_USER credential-source notice in full', () => {
    const { notices, remainder } = extractHostNotices(
      "plot-host: BITBUCKET_REVIEW_USER and BITBUCKET_REVIEW_APP_PASSWORD read from the main checkout's .env",
    );
    expect(notices).toEqual([
      {
        text: "BITBUCKET_REVIEW_USER and BITBUCKET_REVIEW_APP_PASSWORD read from the main checkout's .env",
      },
    ]);
    expect(remainder).toBeNull();
  });
});

describe('prStatusLevel — the plan\'s three-level table', () => {
  it('info: fresh cache, no refusal', () => {
    expect(prStatusLevel(null, 30, INTERVAL_S)).toBe('info');
  });

  it('warning: cache older than 2x the interval, no refusal', () => {
    expect(prStatusLevel(null, 121, INTERVAL_S)).toBe('warning');
  });

  it('warning: a spent quota, but data is still on screen', () => {
    expect(prStatusLevel('quota', 30, INTERVAL_S)).toBe('warning');
  });

  it('warning: a secondary limit, but data is still on screen', () => {
    expect(prStatusLevel('secondary', 30, INTERVAL_S)).toBe('warning');
  });

  it('warning: an outage with data still on screen', () => {
    expect(prStatusLevel('outage', 30, INTERVAL_S)).toBe('warning');
  });

  it('error: no data at all, even with no refusal', () => {
    expect(prStatusLevel(null, null, INTERVAL_S)).toBe('error');
  });

  it('error: no data and a refusal of any kind', () => {
    expect(prStatusLevel('quota', null, INTERVAL_S)).toBe('error');
    expect(prStatusLevel('secondary', null, INTERVAL_S)).toBe('error');
    expect(prStatusLevel('outage', null, INTERVAL_S)).toBe('error');
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
    expect(status.level).toBe('warning');
    expect(status.kind).toBeNull();
    expect(status.cause).toBeNull();
    expect(status.notices).toHaveLength(2);
    expect(status.notices.some((n) => n.text.includes('page complete'))).toBe(true);
    expect(status.notices.some((n) => n.text.includes('ignores --limit'))).toBe(true);
  });

  it('info row: notices alone on a fresh cache do not raise the level', () => {
    const status = prStatus({
      error: BITBUCKET_NOTICES_ONLY,
      ageSeconds: 30,
      nextInSeconds: null,
      spenders: null,
      intervalSeconds: INTERVAL_S,
    });
    expect(status.level).toBe('info');
    expect(status.kind).toBeNull();
    expect(status.cause).toBeNull();
    expect(status.notices).toHaveLength(2);
  });

  it('a notice beside a real throttle names the throttle as the cause', () => {
    const status = prStatus({
      error: `${LIMIT_NOTICE}\n${THROTTLED_FAILURE}`,
      ageSeconds: 840,
      nextInSeconds: null,
      spenders: 44,
      intervalSeconds: INTERVAL_S,
    });
    expect(status.level).toBe('warning');
    expect(status.kind).toBe('secondary');
    expect(status.cause).toBe(THROTTLED_FAILURE);
    expect(status.spenders).toBe(44);
    expect(status.notices).toEqual([
      { text: 'bitbucket ignores --limit 1000; the listing returns one page of 50 per state' },
    ]);
  });

  it('notices followed by an unprefixed failure keep that failure as the cause', () => {
    const status = prStatus({
      error: `${BITBUCKET_NOTICES_ONLY}\nbb: HTTP 429`,
      ageSeconds: 840,
      nextInSeconds: null,
      spenders: null,
      intervalSeconds: INTERVAL_S,
    });
    expect(status.kind).toBe('secondary');
    expect(status.cause).toBe('bb: HTTP 429');
    expect(status.notices).toHaveLength(2);
  });

  it('warning row: an outage with data on screen is a warning, not an error', () => {
    const status = prStatus({
      error: OUTAGE_ERROR,
      ageSeconds: 30,
      nextInSeconds: null,
      spenders: null,
      intervalSeconds: INTERVAL_S,
    });
    expect(status.level).toBe('warning');
    expect(status.kind).toBe('outage');
    expect(status.cause).toBe(OUTAGE_ERROR);
  });

  /** A quota refusal's backoff end survives into the value unchanged. */
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

  /**
   * A secondary limit's own gate ends in seconds, same as a spent quota's —
   * the plan calls for its backoff end too, unlike the PRINTED reset time
   * `resetApplies` still gates (that is a different field, not asserted
   * here).
   */
  it('a secondary refusal reports its own backoff end', () => {
    const status = prStatus({
      error: SECONDARY_ERROR,
      ageSeconds: 10,
      nextInSeconds: 30,
      spenders: 3,
      intervalSeconds: INTERVAL_S,
    });
    expect(status.kind).toBe('secondary');
    expect(status.backoffInSeconds).toBe(30);
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

  /**
   * The plan table calls missing credentials `error` whether or not data is
   * on screen — unlike every other refusal kind, which only reaches `error`
   * with no data landed.
   */
  it('error row: missing credentials reads error even with data on screen', () => {
    const status = prStatus({
      error: 'gh: authentication required',
      ageSeconds: 10,
      nextInSeconds: null,
      spenders: null,
      intervalSeconds: INTERVAL_S,
    });
    expect(status.level).toBe('error');
    expect(status.kind).toBe('outage');
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

/**
 * Issue #2843: fleetd stretches the PR read cadence by the account's spend, so
 * the next read lands minutes after the last one while the ordinary interval
 * stays 60 s. A read on schedule is not stale; a read past its schedule is.
 */
describe('prStatus — a scheduled read decides staleness', () => {
  const at = (ageSeconds: number, overdueSeconds: number | null, error: string | null = null) =>
    prStatus({ error, ageSeconds, nextInSeconds: null, spenders: null, intervalSeconds: INTERVAL_S, overdueSeconds });

  it('info: a stretched read still ahead of its schedule, though the age passes twice the interval', () => {
    const status = at(245, 0);
    expect(status.level).toBe('info');
    expect(status.stale).toBeNull();
  });

  it('info: a read due inside the grace of one interval', () => {
    expect(at(450, INTERVAL_S).level).toBe('info');
  });

  it('warning: a read overdue past the grace of one interval', () => {
    const status = at(500, INTERVAL_S + 1);
    expect(status.level).toBe('warning');
    expect(status.stale).toBe('overdue');
    expect(status.kind).toBeNull();
  });

  it('falls back to twice the interval where no schedule is known', () => {
    const status = at(121, null);
    expect(status.level).toBe('warning');
    expect(status.stale).toBe('aged');
    expect(at(119, null).stale).toBeNull();
  });

  it('a refusal stays a warning whatever the schedule says', () => {
    const status = at(30, 0, QUOTA_ERROR);
    expect(status.level).toBe('warning');
    expect(status.kind).toBe('quota');
    expect(status.stale).toBeNull();
  });

  it('no data stays an error whatever the schedule says', () => {
    const status = prStatus({ error: null, ageSeconds: null, nextInSeconds: null, spenders: null, intervalSeconds: INTERVAL_S, overdueSeconds: 0 });
    expect(status.level).toBe('error');
  });
});
