import { describe, it, expect, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  refreshRuns, branchIsWatched, freshCacheEntry,
  type PrRecord, type CacheEntry,
} from '../../src/server/fleet.js';
import type { FleetReading } from '../../src/contract/schema.js';

// The measurement this file exists for, taken on this repo 2026-08-27 after the
// scan batching (#486) landed: the scan reads 24.2 % CPU — 6.61 s of work inside
// ~24 s of wall clock. It is no longer computing; it is WAITING ON GITHUB. So
// the lever left is not to compute faster, and not to refresh less often — it is
// to ask FEWER QUESTIONS PER PASS.
//
// The question that need not be asked: a branch whose PR is merged, or whose
// plan is delivered, cannot change in a way anyone is waiting for. A branch in
// WORKING or WAITING ON YOU can. The first is skipped; the second is not.
//
// BOTH DIRECTIONS ARE ASSERTED HERE, and that pairing is the point. A change
// that skips EVERY branch satisfies "a merged PR is not re-asked" perfectly and
// makes the board useless — so "a WORKING branch IS asked every pass" is the
// assertion a naive implementation fails. Both items or neither.
//
// The count is asserted, never a duration: a timing assertion is flaky, and the
// invocation count is the fact that produces the timing. This is the technique
// #228 used — a stubbed CLI on the path the code actually shells out to.

/**
 * A fake `plot-host.sh` that APPENDS ONE LINE PER `runs` INVOCATION to a
 * counter file, so a test can read exactly which branches were asked about and
 * how many times across several passes.
 *
 * A script rather than a stubbed function, because the seam under test is the
 * real one: `refreshRuns` locates `plot-host.sh` by path and shells out to it.
 * A stub returning a value would prove a function was called; it would not
 * prove a HOST ROUND TRIP was or was not spent, which is the whole subject.
 */
function countingHost(): { scriptsDir: string; asked: () => string[] } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'plot-watched-'));
  const log = path.join(dir, 'asked.log');
  fs.writeFileSync(
    path.join(dir, 'plot-host.sh'),
    '#!/usr/bin/env bash\n'
    // `$2` is the branch on a `runs` call. Recorded before anything is emitted,
    // so a crash later still leaves evidence the call happened.
    + `if [ "$1" = runs ]; then\n  printf '%s\\n' "$2" >> ${JSON.stringify(log)}\n`
    + "  printf '%s\\n' '{\"workflow\":\"validate\",\"conclusion\":\"failure\","
    + '"startedAt":"2026-08-27T10:00:00Z","url":"https://example.invalid/1"}\'\n'
    + '  exit 0\nfi\nexit 0\n',
  );
  fs.chmodSync(path.join(dir, 'plot-host.sh'), 0o755);
  return {
    scriptsDir: dir,
    asked: () => {
      try {
        return fs.readFileSync(log, 'utf8').split('\n').filter((l) => l.trim());
      } catch {
        return []; // never written means never asked, which is a real answer
      }
    },
  };
}

const dirs: string[] = [];
function host() {
  const h = countingHost();
  dirs.push(h.scriptsDir);
  return h;
}
afterEach(() => {
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

/**
 * A PR the board would otherwise fetch run history for — `checks: 'failing'` is
 * what puts a branch in `refreshRuns`' loop at all, so every fixture here has
 * it. Without it the branch is skipped for a reason that has nothing to do with
 * this change, and the test would pass while proving nothing.
 */
function failingPr(head: string, over: Partial<PrRecord> = {}): PrRecord {
  return {
    number: 1, head, state: 'OPEN', draft: false, checks: 'failing',
    mergeable: 'mergeable', review: '', failing_checks: ['validate'], url: '',
    ...over,
  };
}

/** A pulse placing `branch` in a plan at `phase`, the way the scan reports it. */
function pulseWith(branch: string, phase: string): FleetReading {
  return {
    main: 'main', head: 'abc', plans: [{
      file: `docs/plans/2026-08-27-${phase}.md`,
      phase,
      slices: [{
        name: 'Watched', verdict: 'eligible', branches: [{
          branch, state: 'open', deferred: false, deferred_reason: '',
          claimed: '', local_dirty: false, local_locked: false,
        } as FleetReading['plans'][number]['waves'][number]['branches'][number]],
      }],
    }],
    summary: { plans: 1, waves: 1, branches: 1 },
  } as FleetReading;
}

/** Run `refreshRuns` the way `refreshPrs` does, over one PR map. */
async function pass(scriptsDir: string, entry: CacheEntry, prs: Map<string, PrRecord>) {
  await refreshRuns({ repoRoot: scriptsDir, scriptsDir }, entry, prs);
}

describe('the board refreshes what is watched', () => {
  it('does not re-ask about a merged PR across two passes', async () => {
    // The headline item, counted rather than timed. A merged PR's run history
    // cannot change in a way a reader is waiting for: the branch landed, and
    // no future CI run will alter what happened to it.
    const h = host();
    const entry = freshCacheEntry();
    const prs = new Map([['feature/landed', failingPr('feature/landed', { state: 'MERGED' })]]);

    await pass(h.scriptsDir, entry, prs);
    await pass(h.scriptsDir, entry, prs);

    expect(h.asked()).toEqual([]);
  });

  it('asks about a WORKING branch on every pass', async () => {
    // THE ASSERTION A NAIVE IMPLEMENTATION FAILS. Skipping everything satisfies
    // the test above and empties the board; this is what says the skip is
    // discriminating rather than total. Two passes, two questions — the cadence
    // is untouched for a branch whose answer can still move.
    const h = host();
    const entry = freshCacheEntry();
    const prs = new Map([['feature/working', failingPr('feature/working')]]);

    await pass(h.scriptsDir, entry, prs);
    await pass(h.scriptsDir, entry, prs);

    expect(h.asked()).toEqual(['feature/working', 'feature/working']);
  });

  it('skips a branch whose plan is delivered, and keeps asking its neighbour', async () => {
    // The second half of the rule — the plan's phase, not the PR's state. Both
    // branches carry an OPEN, failing PR, so the PR side cannot be what
    // separates them; only the plan phase can. Asserted in ONE pass over BOTH
    // branches so the discrimination is visible in a single result.
    const h = host();
    const entry = freshCacheEntry();
    entry.pulse = {
      ...pulseWith('feature/done', 'delivered'),
      plans: [
        ...pulseWith('feature/done', 'delivered').plans,
        ...pulseWith('feature/live', 'approved').plans,
      ],
    };
    const prs = new Map([
      ['feature/done', failingPr('feature/done', { number: 1 })],
      ['feature/live', failingPr('feature/live', { number: 2 })],
    ]);

    await pass(h.scriptsDir, entry, prs);

    expect(h.asked()).toEqual(['feature/live']);
  });

  it('re-derives the skip every pass and persists no verdict', async () => {
    // A DERIVATION, NOT A RECORD — the difference this whole change turns on.
    // The same branch is merged on the first pass and open on the second, with
    // NOTHING reset in between: the entry carried forward untouched. If the
    // first pass had written a verdict down, the second would still be skipping
    // a branch git now says is live.
    //
    // This is also why no new cache was added: `PLOT_TERMINAL_CACHE` already
    // holds terminal answers and git already invalidates it. A verdict
    // persisted here would be a second source of truth that git cannot reach.
    const h = host();
    const entry = freshCacheEntry();

    await pass(h.scriptsDir, entry,
      new Map([['feature/moves', failingPr('feature/moves', { state: 'MERGED' })]]));
    expect(h.asked()).toEqual([]);

    // Same entry, no reset. Only the input changed.
    await pass(h.scriptsDir, entry,
      new Map([['feature/moves', failingPr('feature/moves', { state: 'OPEN' })]]));

    expect(h.asked()).toEqual(['feature/moves']);

    // And nothing on the entry names a skipped branch: the verdict exists for
    // the length of one call and is not written anywhere at all.
    expect(JSON.stringify(Object.keys(entry))).not.toMatch(/watch|skip/i);
  });

  it('reads merge state from MERGED, never from CLOSED', async () => {
    // A merged PR reports `state: CLOSED` through some host projections, and
    // squash-merge leaves a branch permanently "ahead of main" so ancestry
    // cannot decide it either. So CLOSED alone is NOT merged: a PR closed
    // without merging is a branch someone may well still be waiting on, and
    // treating it as terminal would silently stop reporting its CI.
    const h = host();
    const entry = freshCacheEntry();
    const prs = new Map([['feature/abandoned',
      failingPr('feature/abandoned', { state: 'CLOSED' })]]);

    await pass(h.scriptsDir, entry, prs);

    expect(h.asked()).toEqual(['feature/abandoned']);
  });

  it('keeps a merged branch\'s last good history rather than blanking it', async () => {
    // Skipping the QUESTION must not drop the ANSWER. A row that loses a line
    // it had a minute ago looks like the branch changing rather than like a
    // fetch being skipped — the same rule the PR map and the pulse follow.
    const h = host();
    const entry = freshCacheEntry();
    const history = [{
      workflow: 'validate', conclusion: 'failure',
      startedAt: '2026-08-27T09:00:00Z', url: 'https://example.invalid/0',
    }];
    entry.runs = new Map([['feature/landed', history]]);

    await pass(h.scriptsDir, entry,
      new Map([['feature/landed', failingPr('feature/landed', { state: 'MERGED' })]]));

    expect(h.asked()).toEqual([]);
    expect(entry.runs.get('feature/landed')).toEqual(history);
  });
});

describe('branchIsWatched', () => {
  // The predicate alone, so the rule is readable as arithmetic rather than only
  // observable through a spawned process.

  it('watches a branch with an open PR and no plan opinion', () => {
    expect(branchIsWatched('feature/x', null, failingPr('feature/x'))).toBe(true);
  });

  it('does not watch a merged PR', () => {
    expect(branchIsWatched('feature/x', null,
      failingPr('feature/x', { state: 'MERGED' }))).toBe(false);
  });

  it('does not watch a branch whose plan is delivered or released', () => {
    for (const phase of ['delivered', 'released']) {
      expect(branchIsWatched('feature/x', pulseWith('feature/x', phase),
        failingPr('feature/x'))).toBe(false);
    }
  });

  it('watches a branch whose plan is draft or approved', () => {
    for (const phase of ['draft', 'approved', '']) {
      expect(branchIsWatched('feature/x', pulseWith('feature/x', phase),
        failingPr('feature/x'))).toBe(true);
    }
  });

  it('watches a branch no plan mentions', () => {
    // An unknown branch is not a finished one. Absent is not terminal — the
    // same rule every other absent signal on this board follows.
    expect(branchIsWatched('feature/stranger', pulseWith('feature/other', 'delivered'),
      failingPr('feature/stranger'))).toBe(true);
  });
});
