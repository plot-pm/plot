import { describe, expect, it } from 'vitest';

import { applyReaction, freshCacheEntry, hostReaction, prConcurrencyBound } from '../../src/server/fleet.js';

/**
 * THE DEFECT THIS FILE EXISTS FOR: nothing bounded how many host calls were open
 * at once. `prConcurrency` held a compiled-in 4 that no call site read, and
 * `grep -niE 'semaphore|in-?flight|concurren' plot-host.sh` matched two comments
 * and no code.
 *
 * **SEVEN IS NOT SHIPPED AND MUST NOT BE.** The estate's one measurement is
 * 2026-08-27, where eight workers produced a 403 naming abuse detection; seven
 * is the inference from that eight and has no independent source. So the cap is
 * derived from the connector's own reading and corrected by the refusals it
 * causes, and a test asserting a constant would be asserting the guess.
 */

/** A moment to measure resets from. */
const NOW = 1_756_512_000_000;

/** What GitHub says when too many arrived at once. */
const SECONDARY = 'HTTP 403: You have triggered an abuse detection mechanism';
/** What GitHub says when the window's requests are gone. */
const QUOTA = 'GraphQL: API rate limit already exceeded for user ID 870334';

describe('prConcurrencyBound — discovered, never compiled in', () => {
  it('is unbounded before any limit has been read', () => {
    // The board runs as it did before this slice: no reading, no refusal, no
    // evidence for any number.
    expect(prConcurrencyBound(freshCacheEntry())).toBeNull();
  });

  it("derives a cap from GitHub's own 5000 an hour", () => {
    const entry = freshCacheEntry();
    entry.prLimit = 5000;
    entry.prLimitBasis = 'actual';
    // Below the eight that was refused, which is the region the starting point
    // has to be in for the correction to have anywhere to go.
    expect(prConcurrencyBound(entry)).toBe(5);
  });

  it('derives a different cap from a different ceiling', () => {
    // THE PROPERTY A CONSTANT CANNOT HAVE. A vendor that changes its limit
    // changes this; a seven shipped in Plot would not move.
    const entry = freshCacheEntry();
    entry.prLimitBasis = 'actual';
    entry.prLimit = 5000;
    const github = prConcurrencyBound(entry);
    entry.prLimit = 1000;
    expect(prConcurrencyBound(entry)).not.toBe(github);
  });

  it('derives one from a prediction as readily as from a measurement', () => {
    const entry = freshCacheEntry();
    entry.prLimit = 1000;
    entry.prLimitBasis = 'predicted';
    expect(prConcurrencyBound(entry)).toBe(1);
  });

  it('stays unbounded where the connector reports nothing', () => {
    // `unknown` IS NOT A NUMBER. Inventing a bound here would be the
    // compiled-in seven under another name.
    const entry = freshCacheEntry();
    entry.prLimit = 5000;
    entry.prLimitBasis = 'unknown';
    expect(prConcurrencyBound(entry)).toBeNull();
  });

  it('lets a refusal outrank the connector proposal', () => {
    const entry = freshCacheEntry();
    entry.prLimit = 5000;
    entry.prLimitBasis = 'actual';
    entry.prConcurrency = 2;
    expect(prConcurrencyBound(entry)).toBe(2);
  });

  it('never lets a reading raise what a refusal established', () => {
    const entry = freshCacheEntry();
    entry.prLimit = 5000;
    entry.prLimitBasis = 'actual';
    entry.prConcurrency = 1;
    // A quiet minute is not evidence that more would have been allowed.
    expect(prConcurrencyBound(entry)).toBe(1);
  });
});

describe('applyReaction — a first refusal establishes a bound where none existed', () => {
  it("halves the connector's proposal on the first secondary refusal", () => {
    const entry = freshCacheEntry();
    entry.prLimit = 5000;
    entry.prLimitBasis = 'actual';
    expect(entry.prConcurrency).toBeNull();
    applyReaction(entry, hostReaction(SECONDARY, null, NOW));
    // 5 proposed, halved by the refusal that disproved it.
    expect(entry.prConcurrency).toBe(2);
    expect(prConcurrencyBound(entry)).toBe(2);
  });

  it('converges toward one under repeated refusals', () => {
    const entry = freshCacheEntry();
    entry.prLimit = 5000;
    entry.prLimitBasis = 'actual';
    for (let i = 0; i < 5; i += 1) applyReaction(entry, hostReaction(SECONDARY, null, NOW));
    expect(prConcurrencyBound(entry)).toBe(1);
  });

  it('invents no bound for a connector that proposes none', () => {
    // A refusal against an `unknown` ceiling gives nothing to halve, and a
    // number picked here would be the guess this slice refuses to ship. The
    // refusal's own wait is the whole reaction.
    const entry = freshCacheEntry();
    applyReaction(entry, hostReaction(SECONDARY, null, NOW));
    expect(entry.prConcurrency).toBeNull();
    expect(prConcurrencyBound(entry)).toBeNull();
  });

  it('leaves the bound alone on a spent quota', () => {
    // A quota is an hourly ceiling one caller reaches alone, so lowering how
    // many run at once corrects a number the refusal is not evidence about.
    const entry = freshCacheEntry();
    entry.prLimit = 5000;
    entry.prLimitBasis = 'actual';
    applyReaction(entry, hostReaction(QUOTA, NOW + 60_000, NOW));
    expect(entry.prConcurrency).toBeNull();
    expect(prConcurrencyBound(entry)).toBe(5);
  });

  it('never touches the cadence', () => {
    // THE CONSTRAINT SLICE 4 AND SLICE 8 BOTH STATE. This slice lowers
    // concurrency; frequency is left alone, or the two divisions compound and
    // drift downward with nothing to restore them.
    const entry = freshCacheEntry();
    entry.prLimit = 5000;
    entry.prLimitBasis = 'actual';
    const interval = entry.prIntervalMs;
    applyReaction(entry, hostReaction(SECONDARY, null, NOW));
    expect(entry.prIntervalMs).toBe(interval);
    expect(hostReaction(SECONDARY, null, NOW)?.touchesCadence).toBe(false);
  });
});

describe('the 2026-08-27 shape', () => {
  it('bounds eight simultaneous spenders below the eight that was refused', () => {
    // Eight workers, each shelling `plot-host.sh` once, against GitHub's 5000
    // an hour. The cap is 5, so three wait — the cadence degrades, and no 403
    // is produced.
    const entry = freshCacheEntry();
    entry.prLimit = 5000;
    entry.prLimitBasis = 'actual';
    const cap = prConcurrencyBound(entry);
    expect(cap).not.toBeNull();
    expect(cap as number).toBeLessThan(8);
    expect(cap as number).toBeGreaterThan(0);
  });

  it('carries no seven anywhere in the derivation', () => {
    // The number is a quotient of a reading, so no ceiling in this estate
    // produces it by accident of a constant.
    const entry = freshCacheEntry();
    entry.prLimitBasis = 'actual';
    for (const limit of [1000, 5000, 15_000]) {
      entry.prLimit = limit;
      expect(prConcurrencyBound(entry)).toBe(Math.max(1, Math.floor(limit / 900)));
    }
  });
});
