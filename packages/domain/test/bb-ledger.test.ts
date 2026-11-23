import { describe, expect, it } from 'vitest';

import {
  bbBudgetCount,
  bbCeiling,
  bbGuard,
  bbHourStamps,
  bbHourlyLimit,
  bbKeyInput,
  bbLimitReading,
  bbPauseAfter429,
  bbPauseIsStale,
  bbPauseLeft,
  bbPauseLine,
  bbPauseMerge,
  bbPauseParse,
  bbPauseTail,
  bbPrunes,
  bbRefusalWaitSeconds,
  bbRequestLine,
  bbShownWait,
  bbStatePath,
  bbThrottleCause,
  bbThrottleTime,
  bbUtcHms,
} from '../src/rules/bb-ledger.js';

// 2026-08-29T10:42:03Z, 2523 s into its hour.
const NOW = 1_788_000_123;

describe('hour stamps, times and paths', () => {
  it('stamps the hour of a second and of the hour before, in UTC', () => {
    expect(bbHourStamps(NOW)).toEqual({ stamp: '2026082910', prev: '2026082909' });
    expect(bbHourStamps(1_767_225_600)).toEqual({ stamp: '2026010100', prev: '2025123123' });
  });

  it('prints HH:MM:SSZ and shows a wait of 429 as 430', () => {
    expect(bbUtcHms(NOW)).toBe('10:42:03Z');
    expect(bbShownWait(429)).toBe(430);
    expect(bbShownWait(428)).toBe(428);
  });

  it('lowercases ASCII letters only in the key input', () => {
    expect(bbKeyInput('Me.Name@Example.COM')).toBe('me.name@example.com');
    expect(bbKeyInput('JÖrg.MÜLLER@x.io')).toBe('jÖrg.mÜller@x.io');
  });

  it('takes BB_STATE_DIR, then XDG_STATE_HOME/bb, then HOME/.local/state/bb, an empty one counting as unset', () => {
    expect(bbStatePath({ BB_STATE_DIR: '/s', XDG_STATE_HOME: '/x', HOME: '/h' })).toBe('/s');
    expect(bbStatePath({ BB_STATE_DIR: '', XDG_STATE_HOME: '/x', HOME: '/h' })).toBe('/x/bb');
    expect(bbStatePath({ BB_STATE_DIR: '', XDG_STATE_HOME: '', HOME: '/h' })).toBe('/h/.local/state/bb');
    expect(bbStatePath({})).toBeNull();
  });

  it('prunes request files of any account older than the previous hour, and nothing else', () => {
    expect(bbPrunes('requests-abc123def456-2026082908.log', '2026082909')).toBe(true);
    expect(bbPrunes('requests-other-2026082908.log', '2026082909')).toBe(true);
    expect(bbPrunes('requests-abc123def456-2026082909.log', '2026082909')).toBe(false);
    expect(bbPrunes('requests-abc123def456-2026082910.log', '2026082909')).toBe(false);
    expect(bbPrunes('pause-abc123def456', '2026082909')).toBe(false);
    expect(bbPrunes('requests-abc-20260829.log', '2026082909')).toBe(false);
  });

  it('writes byte-exact lines', () => {
    expect(bbRequestLine(NOW)).toBe('1788000123\n');
    expect(bbPauseLine({ end: NOW + 300, length: 300 })).toBe('1788000423 300\n');
  });
});

describe('the ceiling', () => {
  it('reads BB_HOURLY_LIMIT as bb does', () => {
    expect(bbHourlyLimit(undefined)).toEqual({ ok: true, limit: 800 });
    expect(bbHourlyLimit('')).toEqual({ ok: true, limit: 800 });
    expect(bbHourlyLimit('0')).toEqual({ ok: true, limit: 0 });
    expect(bbHourlyLimit('010')).toEqual({ ok: true, limit: 10 });
    expect(bbHourlyLimit('1234567890')).toEqual({ ok: true, limit: 999_999_999 });
    expect(bbHourlyLimit('abc')).toEqual({ ok: false, said: "error: BB_HOURLY_LIMIT must be a whole number, got 'abc'" });
    expect(bbHourlyLimit('-1')).toMatchObject({ ok: false });
  });

  it('takes the smaller of BB_HOURLY_LIMIT and the declared limit, never the default prediction', () => {
    expect(bbCeiling('2000', null)).toEqual({ ok: true, ceiling: 2000 });
    expect(bbCeiling('2000', 500)).toEqual({ ok: true, ceiling: 500 });
    expect(bbCeiling('2000', 5000)).toEqual({ ok: true, ceiling: 2000 });
    expect(bbCeiling(undefined, null)).toEqual({ ok: true, ceiling: 800 });
    expect(bbCeiling('0', null)).toEqual({ ok: true, ceiling: null });
    expect(bbCeiling('0', 300)).toEqual({ ok: true, ceiling: 300 });
    expect(bbCeiling('x', 300)).toMatchObject({ ok: false });
  });
});

describe('the count', () => {
  it('counts digit lines of at most 12 characters within the last hour and not in the future', () => {
    const prev = `${NOW - 3600}\n${NOW - 3599}\n`;
    const cur = `${NOW}\n${NOW + 1}\n12a\n 1788000100\n0001788000100\n${NOW - 10}\n`;
    expect(bbBudgetCount(NOW, null, [prev, cur])).toEqual({ requests: 3, freeAt: null });
  });

  it('names the next free second at the ceiling, from the (n - c + 1)-th oldest line', () => {
    const cur = `${NOW - 30}\n${NOW - 20}\n${NOW - 10}\n`;
    expect(bbBudgetCount(NOW, 3, ['', cur])).toEqual({ requests: 3, freeAt: NOW - 30 + 3600 });
    expect(bbBudgetCount(NOW, 2, ['', cur])).toEqual({ requests: 3, freeAt: NOW - 20 + 3600 });
    expect(bbBudgetCount(NOW, 4, ['', cur])).toEqual({ requests: 3, freeAt: null });
  });
});

describe('the pause', () => {
  it('reads a pause line as bb_pause_read does', () => {
    expect(bbPauseParse(`${NOW} 300\n`)).toEqual({ end: NOW, length: 300 });
    expect(bbPauseParse(`${NOW} 300 extra\n`)).toBeNull();
    expect(bbPauseParse(`${NOW} 0\n`)).toBeNull();
    expect(bbPauseParse(`${NOW}\n`)).toBeNull();
    expect(bbPauseParse('0001788000123 0300\n')).toEqual({ end: NOW, length: 300 });
    expect(bbPauseParse('1234567890123 300\n')).toBeNull();
    expect(bbPauseParse(null)).toBeNull();
  });

  it('counts a pause with more than its length plus 5 s left as stale', () => {
    expect(bbPauseIsStale({ end: NOW + 305, length: 300 }, NOW)).toBe(false);
    expect(bbPauseIsStale({ end: NOW + 306, length: 300 }, NOW)).toBe(true);
    expect(bbPauseLeft({ end: NOW + 306, length: 300 }, NOW)).toBeNull();
    expect(bbPauseLeft({ end: NOW + 100, length: 300 }, NOW)).toBe(100);
    expect(bbPauseLeft({ end: NOW, length: 300 }, NOW)).toBeNull();
  });

  it('starts at 300 s, doubles within the hour after a pause, and holds at least Retry-After', () => {
    expect(bbPauseAfter429(null, null, NOW)).toEqual({ end: NOW + 300, length: 300 });
    expect(bbPauseAfter429(null, '30', NOW)).toEqual({ end: NOW + 300, length: 300 });
    expect(bbPauseAfter429(null, '900', NOW)).toEqual({ end: NOW + 900, length: 900 });
    expect(bbPauseAfter429({ end: NOW - 10, length: 300 }, null, NOW)).toEqual({ end: NOW + 600, length: 600 });
    expect(bbPauseAfter429({ end: NOW - 10, length: 2400 }, null, NOW)).toEqual({ end: NOW + 3600, length: 3600 });
    expect(bbPauseAfter429({ end: NOW - 3600, length: 2400 }, null, NOW)).toEqual({ end: NOW + 300, length: 300 });
  });

  it('extends an active pause to the later end and the larger length', () => {
    expect(bbPauseAfter429({ end: NOW + 100, length: 300 }, '30', NOW)).toEqual({ end: NOW + 100, length: 300 });
    expect(bbPauseAfter429({ end: NOW + 100, length: 300 }, null, NOW)).toEqual({ end: NOW + 300, length: 300 });
    expect(bbPauseAfter429({ end: NOW + 100, length: 120 }, '500', NOW)).toEqual({ end: NOW + 500, length: 500 });
  });

  it('keeps a later, non-stale stored pause on the merge, and never shortens one', () => {
    const next = { end: NOW + 300, length: 300 };
    expect(bbPauseMerge(next, { end: NOW + 600, length: 600 }, NOW)).toEqual({ end: NOW + 600, length: 600 });
    expect(bbPauseMerge(next, { end: NOW + 200, length: 600 }, NOW)).toEqual(next);
    expect(bbPauseMerge(next, { end: NOW + 9000, length: 600 }, NOW)).toEqual(next);
    expect(bbPauseMerge(next, null, NOW)).toEqual(next);
  });

  it("prints bb's tail after a 429", () => {
    expect(bbPauseTail({ end: NOW + 300, length: 300 }, '30', NOW, 'Bitbucket')).toBe('Bitbucket asked to wait 30 s; bb paused until 10:47:03Z (in 300 s)');
    expect(bbPauseTail({ end: NOW + 429, length: 429 }, 'soon', NOW, 'Bitbucket')).toBe('bb paused until 10:49:13Z (in 430 s)');
  });
});

describe('the guard', () => {
  it('refuses during a pause first, whatever the count', () => {
    expect(bbGuard({ now: NOW, ceiling: 800, pause: { end: NOW + 60, length: 300 }, texts: null, host: 'Bitbucket' })).toEqual({
      verdict: 'paused',
      waitSeconds: 60,
      said: 'rate limited — bb paused until 10:43:03Z after Bitbucket refused a request (in 60 s)',
    });
  });

  it('refuses at the ceiling with the next free second, and sends below it', () => {
    const texts = ['', `${NOW - 10}\n${NOW - 5}\n`];
    expect(bbGuard({ now: NOW, ceiling: 2, pause: null, texts, host: 'Bitbucket' })).toEqual({
      verdict: 'ceiling',
      waitSeconds: 3590,
      requests: 2,
      said: 'rate limited — 2 requests in the last hour from this machine; next request at 11:41:53Z (in 3590 s)',
    });
    expect(bbGuard({ now: NOW, ceiling: 3, pause: null, texts, host: 'Bitbucket' })).toEqual({ verdict: 'send', requests: 2 });
    expect(bbGuard({ now: NOW, ceiling: null, pause: null, texts, host: 'Bitbucket' })).toEqual({ verdict: 'send', requests: 2 });
  });

  it('sends with an unknown count where a request file cannot be read', () => {
    expect(bbGuard({ now: NOW, ceiling: 1, pause: null, texts: null, host: 'Bitbucket' })).toEqual({ verdict: 'send', requests: null });
  });
});

describe('the limit reading', () => {
  const NOW_MS = NOW * 1000;

  it('reads the ceiling, the declared limit under it, and what remains', () => {
    const fields = { requests: 10, ceiling: 800, pausedUntil: null, waitSeconds: 0 };
    expect(bbLimitReading(fields, null, NOW_MS, 'bitbucket')).toEqual({
      connector: 'bitbucket',
      bucket: 'api',
      limit: 800,
      remaining: 790,
      resetAt: null,
      basis: 'predicted',
    });
    expect(bbLimitReading(fields, 500, NOW_MS, 'bitbucket')).toMatchObject({ limit: 500, remaining: 490 });
  });

  it('carries a non-null reset where remaining is 0 and waitSeconds is 0', () => {
    const spent = { requests: 800, ceiling: 800, pausedUntil: null, waitSeconds: 0 };
    expect(bbLimitReading(spent, null, NOW_MS, 'bitbucket')).toMatchObject({ remaining: 0, resetAt: NOW_MS + 3_600_000 });
    expect(bbLimitReading({ ...spent, nextFreeAt: NOW + 50 }, null, NOW_MS, 'bitbucket')).toMatchObject({ remaining: 0, resetAt: (NOW + 50) * 1000 });
    expect(bbLimitReading({ ...spent, waitSeconds: 20 }, null, NOW_MS, 'bitbucket')).toMatchObject({ remaining: 0, resetAt: NOW_MS + 20_000 });
  });

  it('reads 0 remaining until the pause ends, and no remaining where the count or the ceiling is unknown', () => {
    expect(bbLimitReading({ requests: 3, ceiling: 800, pausedUntil: NOW + 90, waitSeconds: 90 }, null, NOW_MS, 'bitbucket')).toMatchObject({
      remaining: 0,
      resetAt: (NOW + 90) * 1000,
    });
    expect(bbLimitReading({ requests: null, ceiling: 800, pausedUntil: null, waitSeconds: 0 }, null, NOW_MS, 'bitbucket')).toMatchObject({
      limit: 800,
      remaining: null,
      resetAt: null,
    });
    expect(bbLimitReading({ requests: null, ceiling: null, pausedUntil: null, waitSeconds: 0 }, 2000, NOW_MS, 'bitbucket')).toMatchObject({
      limit: 2000,
      remaining: null,
    });
  });
});

describe('the throttle cause', () => {
  it("names ceiling, paused or host from bb's phrases, with or without bb's error: prefix", () => {
    const ceiling = 'rate limited — 800 requests in the last hour from this machine; next request at 11:41:53Z (in 3590 s)';
    const paused = 'rate limited — bb paused until 10:43:03Z after Bitbucket refused a request (in 60 s)';
    expect(bbThrottleCause(ceiling)).toBe('ceiling');
    expect(bbThrottleCause(`error: ${ceiling}`)).toBe('ceiling');
    expect(bbThrottleCause(paused)).toBe('paused');
    expect(bbThrottleCause('Rate limit for this resource has been exceeded')).toBe('host');
    expect(bbThrottleCause('Bitbucket asked to wait 30 s; bb paused until 10:47:03Z (in 300 s)')).toBe('host');
    expect(bbThrottleTime(ceiling)).toBe('11:41:53Z');
    expect(bbThrottleTime(paused)).toBe('10:43:03Z');
    expect(bbThrottleTime('HTTP 429')).toBeNull();
    expect(bbRefusalWaitSeconds(paused)).toBe(60);
    expect(bbRefusalWaitSeconds('nothing')).toBeNull();
  });
});
