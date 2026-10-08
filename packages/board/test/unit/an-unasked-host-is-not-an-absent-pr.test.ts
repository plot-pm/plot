import { describe, it, expect } from 'vitest';
import { rowsFromPulse } from '../../src/server/fleet.js';
import type { FleetReading } from '../../src/contract/schema.js';

/**
 * A FETCH THAT NEVER LANDED IS NOT A BRANCH NOBODY OPENED A PR FOR.
 *
 * `CacheEntry.prs` is `null` until a PR fetch succeeds — the cache's own word
 * for *no successful fetch since this process started*. The quiet readings
 * derived `prState` from `pr ? 'open' : 'none'`, so that null produced `'none'`
 * for every branch of the pulse, and `quietKind` read `'none'` as an assertion:
 * the host was asked and reported no pull request. From there it answered
 * `abandoned` — the most consequential word on a row, the one that tells a
 * person the branch can be deleted.
 *
 * Measured 2026-09-20 on `quatico/quaweb-website`: `prAgeSeconds: null`, seven
 * branches rendered *"commits, no PR ever opened — abandoned"*, and THREE of
 * them carried pull requests — #358 OPEN, #405 and #445 DRAFT. The raw host
 * call answers correctly in 0.4 s; the board never saw it before its own
 * timeout.
 *
 * THE FACT IS PER ENTRY, NOT PER BRANCH. An outage belongs to the fetch, so one
 * boolean answers for every row, and both readings that depend on it —
 * `prState: 'unknown'` and `prUnknown` — are supplied from it rather than from
 * two spellings that can disagree.
 *
 * These drive `rowsFromPulse` directly, the way `a-landed-branch-leaves-waiting`
 * does and for the same reason: the classification is a decision the server
 * makes, and a view state that needs a browser to assert is one not yet
 * extracted.
 */
const QUIET = 12 * 60;

const pulse = { plans: [], summary: {} } as unknown as FleetReading;

/**
 * A loose branch, built with or without a PR map.
 *
 * `prs: null` IS THE OUTAGE and `prs: new Map()` is the successful fetch that
 * found nothing. They are the two inputs this whole fix exists to tell apart,
 * and before it they produced identical rows.
 *
 * THE LOOSE PATH IS THE SUBJECT, deliberately. A fix applied to the plan-branch
 * call site alone leaves every branch reaching the board through the refs still
 * lying, and `fleet.ts:6585` records that asymmetry as already measured once.
 */
const looseRow = (branch: string, prs: Map<string, unknown> | null) => {
  const row = rowsFromPulse(
    pulse, new Map([[branch, 3 * 24 * 60]]), 'plot', QUIET, prs as never, '', null, Date.now(),
    null, null, null, null, null, '', null, new Set([branch]),
  ).find((r) => r.branch === branch);
  if (!row) throw new Error(`no row built for ${branch}`);
  return row;
};

/**
 * A loose branch whose PR is known only to the ALL-STATES map, with the
 * open-only fetch absent.
 *
 * The production shape of a finished PR during an outage: `CacheEntry.prs` is
 * filtered to OPEN by construction, so a merged or closed PR never appears
 * there even on a good day — and on a bad one the map is null outright.
 */
const headRow = (branch: string, prState: string) => {
  const byHead = new Map([
    [branch, { number: 1, head: branch, state: prState, draft: false, checks: 'none' }],
  ]);
  const row = rowsFromPulse(
    pulse, new Map([[branch, 3 * 24 * 60]]), 'plot', QUIET, null as never, '', null, Date.now(),
    null, null, null, null, byHead as never, '', null, new Set([branch]),
  ).find((r) => r.branch === branch);
  if (!row) throw new Error(`no row built for ${branch}`);
  return row;
};

/**
 * A loose branch with a known fetch time and tip time, no PR either map
 * knows about — the fixture for #1240, a fetch that landed before the
 * branch's own tip commit.
 *
 * `tipAt` AND `prAt` ARE THE LAST TWO PARAMETERS, appended after
 * `supervision` for the reason every parameter here is: a caller that passes
 * neither gets today's behaviour unchanged.
 */
const agedRow = (branch: string, tipAtMs: number, prAtMs: number, renderNow = Date.now()) => {
  const row = rowsFromPulse(
    pulse, new Map([[branch, 3 * 24 * 60]]), 'plot', QUIET, new Map(), '', null, renderNow,
    null, null, null, null, null, '', null, new Set([branch]), undefined,
    new Map([[branch, tipAtMs]]), prAtMs,
  ).find((r) => r.branch === branch);
  if (!row) throw new Error(`no row built for ${branch}`);
  return row;
};

/**
 * A loose branch whose PR is known only to the ALL-STATES map, with a tip
 * and fetch time to exercise the new rule against the merge/close arms.
 */
const headRowAged = (branch: string, prState: string, tipAtMs: number, prAtMs: number) => {
  const byHead = new Map([
    [branch, { number: 1, head: branch, state: prState, draft: false, checks: 'none' }],
  ]);
  const row = rowsFromPulse(
    pulse, new Map([[branch, 3 * 24 * 60]]), 'plot', QUIET, null as never, '', null, Date.now(),
    null, null, null, null, byHead as never, '', null, new Set([branch]), undefined,
    new Map([[branch, tipAtMs]]), prAtMs,
  ).find((r) => r.branch === branch);
  if (!row) throw new Error(`no row built for ${branch}`);
  return row;
};

describe('a branch whose last commit is newer than the PR fetch', () => {
  const T = 1_000_000;

  it('reads unknown, not abandoned, when the tip landed after the fetch', () => {
    // #1240: pushed at T, fetched at T-5min — the fetch cannot speak for it.
    const row = agedRow('infra/pushed-after-fetch', T, T - 5 * 60_000);
    expect(row.quietKind).not.toBe('abandoned');
    expect(row.note).not.toContain('no PR ever opened');
  });

  it('reads abandoned once a later fetch finds no PR, same ages and prs map', () => {
    // THE OTHER HALF, same fixture but for `prAt`. Only this input differs.
    const row = agedRow('infra/pushed-after-fetch', T, T + 5 * 60_000);
    expect(row.quietKind).toBe('abandoned');
    expect(row.note).toContain('no PR ever opened');
  });

  it('reads abandoned on the exact boundary — equal is not newer', () => {
    const row = agedRow('infra/pushed-at-fetch', T, T);
    expect(row.quietKind).toBe('abandoned');
  });

  it('is not fooled by reconstructing the tip from a stale age map', () => {
    // THE RENDER CLOCK CASE. Ages read at T, rendered at T+10min, fetch at
    // T+5min, tip at T-1min: the tip is OLDER than the fetch, so the row
    // reads abandoned. `now - ageMinutes * 60_000` at render time would
    // compute the tip as freshly as `now`, call it newer, and fail this.
    const renderNow = T + 10 * 60_000;
    const row = agedRow('infra/old-tip-stale-age-map', T - 60_000, T + 5 * 60_000, renderNow);
    expect(row.quietKind).toBe('abandoned');
  });

  it('agrees on sentence and kind for a claimed branch landing at unknown', () => {
    const claimedPulse = {
      plans: [{
        file: '2026-01-01-p.md',
        phase: 'approved',
        slices: [{
          name: 'Carry',
          verdict: 'eligible',
          branches: [
            { branch: 'feature/claimed-fresh', state: 'claimed', deferred: false, claimed: '', worker: 'none' },
          ],
        }],
      }],
      summary: { plans: 1, waves: 1, branches: 1, claimed: 1, eligible: 0, blocked: 0, deferred: 0 },
    } as unknown as FleetReading;
    const row = rowsFromPulse(
      claimedPulse, new Map([['feature/claimed-fresh', 3 * 24 * 60]]), 'plot', QUIET,
      new Map(), '', null, Date.now(), null, null, null, null, null, '', null, null,
      undefined, new Map([['feature/claimed-fresh', T]]), T - 5 * 60_000,
    ).find((r) => r.branch === 'feature/claimed-fresh');
    if (!row) throw new Error('no row built');
    expect(row.quietKind).not.toBe('abandoned');
    expect(row.note).not.toContain('no PR ever opened');
  });

  it('leaves an OPEN PR branch unchanged whatever the tip and fetch say', () => {
    const byHead = new Map([
      ['feature/open-while-aged', { number: 1, head: 'feature/open-while-aged', state: 'OPEN', draft: false, checks: 'none' }],
    ]);
    const row = rowsFromPulse(
      pulse, new Map([['feature/open-while-aged', 3 * 24 * 60]]), 'plot', QUIET, byHead as never,
      '', null, Date.now(), null, null, null, null, byHead as never, '', null,
      new Set(['feature/open-while-aged']), undefined,
      new Map([['feature/open-while-aged', T]]), T - 5 * 60_000,
    ).find((r) => r.branch === 'feature/open-while-aged');
    if (!row) throw new Error('no row built');
    expect(row.quietKind).not.toBe('abandoned');
  });

  it('leaves a MERGED PR branch unchanged whatever the tip and fetch say', () => {
    const row = headRowAged('feature/merged-while-aged', 'MERGED', T, T - 5 * 60_000);
    expect(row.group).toBe('done');
  });
});

describe('a branch whose PR could not be fetched', () => {
  it('is not called abandoned when the fetch never landed', () => {
    // THE DEFECT, on the path most exposed to it. #358 was open the whole time.
    const row = looseRow('feature/host-was-never-asked', null);
    expect(row.quietKind).not.toBe('abandoned');
    expect(row.quietKind).toBe('quiet');
  });

  it('does not caption the row "commits, no PR ever opened"', () => {
    // The note and the kind are two renderings of one reading. A fix that
    // reaches the kind and not the sentence leaves the row still saying the
    // false thing, in the words a person actually reads.
    expect(looseRow('feature/host-was-never-asked', null).note)
      .not.toContain('no PR ever opened');
  });

  it('still calls a branch abandoned when the fetch SUCCEEDED and found no PR', () => {
    // THE OTHER DIRECTION, and this assertion exists because the naive fix
    // passes without it. An empty map is an answer: the host was asked and
    // reported nothing. Narrowing `abandoned` out of existence would be right
    // about the outage and wrong about every genuinely abandoned branch.
    const row = looseRow('feature/really-abandoned', new Map());
    expect(row.quietKind).toBe('abandoned');
    expect(row.note).toContain('no PR ever opened');
  });

  it('sends a merged branch to DONE, though the open-only fetch never landed', () => {
    // THE ORDERING, pinned at the top end. `quietKind` tests `hasMergedPr`
    // above the unasked arm, so a branch the host merged is `merged` whether or
    // not the open-only fetch landed — an arm inserted ABOVE `hasMergedPr`
    // instead would turn shipped work into an unanswered question and hold it
    // in the section that asks a person for something.
    //
    // THE GROUP IS THE OBSERVABLE HERE, not the kind: `rowQuietKind` answers
    // null outside `waiting-on-you` by design, and a merged row is placed in
    // DONE. The kind-level ordering is pinned in `packages/domain/test/
    // quiet.test.ts`, where the rule can be asked directly.
    //
    // The all-states map is where a merged PR lives, and the open-only map is
    // null beside it — the outage and the merge reported together, which is
    // exactly the pair this arm has to get right.
    expect(headRow('feature/merged-while-blind', 'MERGED').group).toBe('done');
  });

  it('sends a closed PR to DONE, though the open-only fetch never landed', () => {
    // A decision the host reported is a decision, whatever else failed to
    // arrive. The unasked arm sits below `prState === 'closed'` too, so an
    // outage never reopens a question somebody already answered.
    expect(headRow('feature/closed-while-blind', 'CLOSED').group).toBe('done');
  });
});
