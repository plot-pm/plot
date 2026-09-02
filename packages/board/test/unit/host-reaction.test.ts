import { describe, expect, it } from 'vitest';

import {
  applyReaction,
  freshCacheEntry,
  hostReaction,
  prNextDueAt,
  prRefreshMsFor,
  waitOf,
} from '../../src/server/fleet.js';

/**
 * THE DEFECT THIS FILE EXISTS FOR: nothing reacted to a refusal. `plot-host.sh`
 * held no sleep, no retry and no backoff; `fleet.ts` never read `throttled`.
 * The board learnt nothing from a refusal beyond a message to render.
 *
 * What the board DID have was a message parser that recognised a quota and
 * missed a secondary limit naming no wait, and a fallback that asked `gh api
 * rate_limit` — measured 2026-09-01 reporting `graphql 5000/5000, used 0` at
 * the same moment a real call's headers read `Remaining: 4854, Used: 146`.
 */

/** A moment to measure resets from. */
const NOW = 1_756_512_000_000;

/** What GitHub says when the window's requests are gone. */
const QUOTA = 'GraphQL: API rate limit already exceeded for user ID 870334';
/** What GitHub says when too many arrived at once, naming its own wait. */
const SECONDARY_NAMED =
  'You have exceeded a secondary rate limit. Please wait 90 seconds before trying again.';
/** A secondary refusal that names NO wait — the case that returned null before. */
const SECONDARY_BARE = 'HTTP 403: You have triggered an abuse detection mechanism';
/** A failure that is not a limit at all. */
const ORDINARY = 'dial tcp: lookup api.github.com: no such host';

describe('hostReaction — a spent quota waits for the reset the header carried', () => {
  /**
   * THE DONE-WHEN LINE. The reset comes from the budget record, where
   * `plot_harvest_headers` put `X-RateLimit-Reset` after a real response — not
   * from the endpoint that reports a bucket it cannot see.
   */
  it('waits until the record says the bucket refills', () => {
    const reaction = hostReaction(QUOTA, NOW + 12 * 60_000, NOW);
    expect(reaction?.waitMs).toBe(12 * 60_000);
    expect(reaction?.stated).toBe(true);
    expect(reaction?.concurrencyFactor).toBe(1);
  });

  /**
   * THE PLAN'S OPEN QUESTION, ANSWERED. A connector reporting no reset is the
   * `unknown` basis, and the answer is neither to invent a number nor to read
   * absence as permission: wait the ceiling, and say it was not stated.
   */
  it('waits a bounded ceiling and reports it unstated where the record has none', () => {
    const reaction = hostReaction(QUOTA, null, NOW);
    expect(reaction?.waitMs).toBe(300_000);
    expect(reaction?.stated).toBe(false);
  });

  /**
   * A STAMP THE HOST PRINTED BEATS THE CEILING. The record may hold no reading
   * — a fresh checkout, a proxy stripping headers — while the message itself
   * carries the number, and a stated number is never worse than an inferred
   * one.
   */
  it('prefers a reset the message stamped over the unstated ceiling', () => {
    const reaction = hostReaction(
      'API rate limit exceeded; reset at 1756512180', null, NOW,
    );
    expect(reaction?.waitMs).toBe(180_000);
    expect(reaction?.stated).toBe(true);
  });

  /** The record's reading outranks the message where both are present. */
  it('reads the record over the message where the record has a reset', () => {
    const reaction = hostReaction(
      'API rate limit exceeded; reset at 1756512180', NOW + 600_000, NOW,
    );
    expect(reaction?.waitMs).toBe(600_000);
  });

  /**
   * A RESET THAT HAS PASSED IS A REFILLED BUCKET. It must not fall through to
   * the ceiling, which would hold the board for five minutes on a full pool.
   */
  it('waits nothing where the record says the bucket already refilled', () => {
    expect(waitOf(hostReaction(QUOTA, NOW - 1_000, NOW))).toBeNull();
  });
});

describe('hostReaction — a secondary limit retries in seconds', () => {
  /** The wait the host named, honoured exactly — the behaviour that already held. */
  it('honours the seconds the host named', () => {
    expect(hostReaction(SECONDARY_NAMED, null, NOW)?.waitMs).toBe(90_000);
  });

  /**
   * **THE GAP THIS SLICE CLOSES.** A 403 naming abuse detection carries no
   * wait, no stamp and no *"rate limit"* wording, so the old parser answered
   * null and the board reacted to it not at all — re-firing on the ordinary
   * cadence into the very burst that refused it. It is the 2026-08-27 shape.
   */
  it('reacts to a bare abuse-detection refusal, which returned nothing before', () => {
    const reaction = hostReaction(SECONDARY_BARE, null, NOW);
    expect(reaction).not.toBeNull();
    expect(reaction?.waitMs).toBe(60_000);
    expect(reaction?.concurrencyFactor).toBe(0.5);
  });

  /** Retried in SECONDS, and this is what that means against the quota's minutes. */
  it('waits under two minutes even where a reset is known', () => {
    expect(hostReaction(SECONDARY_BARE, NOW + 45 * 60_000, NOW)?.waitMs).toBeLessThan(120_000);
  });

  /**
   * THE PRIMARY RESET DESCRIBES A DIFFERENT CEILING. A secondary limit clears
   * in seconds, so waiting the quota's reset would sit out a limit that has
   * already gone.
   */
  it('ignores the record\'s reset on a secondary limit', () => {
    expect(hostReaction(SECONDARY_BARE, NOW + 60 * 60_000, NOW)?.waitMs).toBe(60_000);
  });
});

describe('hostReaction — an ordinary failure keeps the ordinary rhythm', () => {
  /**
   * THE LOAD-BEARING NEGATIVE, KEPT. A VPN blip or a missing `gh` must not buy
   * silence: the board would look stalled for a reason nothing could explain.
   */
  it('asks for no wait at all', () => {
    expect(waitOf(hostReaction(ORDINARY, null, NOW))).toBeNull();
    expect(waitOf(hostReaction('bash: plot-host.sh: No such file or directory', null, NOW)))
      .toBeNull();
  });

  it('has nothing to answer where nothing refused', () => {
    expect(hostReaction('', null, NOW)).toBeNull();
  });

  /** An outage is not a burst, so it lowers nothing either. */
  it('leaves concurrency where it was', () => {
    const entry = freshCacheEntry();
    const before = entry.prConcurrency;
    applyReaction(entry, hostReaction(ORDINARY, null, NOW));
    expect(entry.prConcurrency).toBe(before);
  });
});

describe('applyReaction — concurrency falls, frequency does not', () => {
  /** The Done-when line: a secondary limit lowers concurrency. */
  it('halves the bound on a secondary refusal', () => {
    const entry = freshCacheEntry();
    entry.prConcurrency = 8;
    applyReaction(entry, hostReaction(SECONDARY_BARE, null, NOW));
    expect(entry.prConcurrency).toBe(4);
  });

  /** A quota is an hourly ceiling one caller reaches alone; concurrency is not the lever. */
  it('leaves the bound alone on a spent quota', () => {
    const entry = freshCacheEntry();
    entry.prConcurrency = 8;
    applyReaction(entry, hostReaction(QUOTA, NOW + 60_000, NOW));
    expect(entry.prConcurrency).toBe(8);
  });

  /** Eight refused on 2026-08-27; halving converges without a compiled-in cap. */
  it('converges to one from the estate\'s one measured population', () => {
    const entry = freshCacheEntry();
    entry.prConcurrency = 8;
    for (let i = 0; i < 5; i += 1) {
      applyReaction(entry, hostReaction(SECONDARY_BARE, null, NOW));
    }
    expect(entry.prConcurrency).toBe(1);
  });

  /**
   * **THE CONSTRAINT THAT BINDS BOTH REACTIONS.** The cadence divides on
   * observed spend, and a refusal that also lowered it would compound with that
   * division and drift downward with nothing to restore it. So `prIntervalMs`
   * is untouched by a reaction of either kind.
   */
  it('never touches the refresh interval', () => {
    for (const message of [QUOTA, SECONDARY_NAMED, SECONDARY_BARE, ORDINARY]) {
      const entry = freshCacheEntry();
      const before = entry.prIntervalMs;
      applyReaction(entry, hostReaction(message, NOW + 60_000, NOW));
      expect(entry.prIntervalMs).toBe(before);
    }
  });

  /**
   * THE CADENCE AFTER THE WAIT EQUALS THE CADENCE BEFORE IT. A reaction feeds
   * `prNextDueAt` a one-off floor, and the interval the next ordinary tick uses
   * is the same number it was before the refusal.
   */
  it('resumes at the interval it was refreshing at before the wait', () => {
    const rate = { perHour: 180 };
    const before = prRefreshMsFor('github', rate, 120_000);
    const reaction = hostReaction(QUOTA, NOW + 12 * 60_000, NOW);
    const waited = prNextDueAt(NOW, waitOf(reaction), NOW, 'github', rate, 120_000);
    expect(waited.hard).toBe(true);
    expect(waited.at).toBe(NOW + 12 * 60_000);
    // The wait is over; the next tick is spaced by the ordinary cadence, which
    // the refusal did not move.
    const after = prRefreshMsFor('github', rate, 120_000);
    expect(after).toBe(before);
  });
});

describe('waitOf — a zero wait rejoins the cadence rather than becoming a floor', () => {
  /**
   * A floor is compared with NO slack (`prGateOpen`), so a floor of `now` would
   * refuse the very tick this period is entitled to. Nothing owed must arrive
   * as null, which anchors to the fetch's start as a success does.
   */
  it('answers null where nothing is owed', () => {
    expect(waitOf(null)).toBeNull();
    expect(waitOf({ waitMs: 0, stated: false, concurrencyFactor: 1, touchesCadence: false }))
      .toBeNull();
  });

  it('passes a real wait through untouched', () => {
    expect(waitOf({ waitMs: 90_000, stated: true, concurrencyFactor: 1, touchesCadence: false }))
      .toBe(90_000);
  });
});
