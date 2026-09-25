import { describe, it, expect } from 'vitest';
import { sectionUnderFailure } from '../../src/server/fleet.js';
import { sectionKey } from '../../src/contract/schema.js';
import { branchState } from '@plot-pm/domain';
import { rowsBySection } from '../../src/app/lib/agent-rows/sections.js';
import type { WaitingGroup } from '../../src/contract/schema.js';

/**
 * A FAILED SCAN KEEPS THE SECTIONS THE LAST GOOD ONE GAVE (#995).
 *
 * The board re-derived section membership on every render from the cached
 * pulse, including when the scan that would have refreshed it had failed. The
 * banner said *"showing the last successful pulse below"* while the sections
 * were being recomputed from refs it had just called stale — and the
 * classification rules are not safe on input already labelled stale.
 *
 * WHAT IT PRODUCED, measured 2026-09-25: five approved, unstarted plans
 * rendering `delivered · merged` under DONE, with no PR and none of their code
 * on the default branch. An operator asked *"we just approved 4 plans, now 3
 * are done already?"*
 *
 * THE ARM, and finding it was this slice's first deliverable. A panel refuted
 * the plan's original explanation — `branch-state.ts:215` returns `claimed`,
 * not `merged`, for a claim-only branch — and the refutation was right about
 * `:215` and wrong about the defect. That line sits inside the
 * `commitsAhead > 0` block. A pulse taken BEFORE the claim commit was pushed
 * reports `commitsAhead === 0`, so the branch never enters that block: it falls
 * through to `:264` and returns `merged`. `classify` then sends `merged`
 * straight to `{ group: 'done' }`.
 *
 * The first test below drives the real rule to pin that, so the fix is anchored
 * to the mechanism rather than to a story about it.
 */
describe('a failed scan keeps the last sections', () => {
  const row = { repo: 'plot', branch: 'bug/a-slice', plan: 'a-plan' };
  // Only the fields `rowsBySection` reads; the rest is cast, as the client casts.
  const BARE = { wave: '', state: 'open', verdict: null } as Record<string, unknown>;
  const remembered = new Map<string, WaitingGroup>([
    [sectionKey(row), 'not-started'],
  ]);

  it('THE ARM: a claim-only branch reads `claimed` fresh and `merged` stale', () => {
    // The #995 mechanism, driven through the real domain rule rather than
    // described. A claim-only branch — a ref, one empty claim commit, no PR —
    // is `claimed` while the pulse can see that commit.
    const fresh = branchState({
      refTip: 'aaa111', mainTip: 'main999', pr: 'none', waits: null,
      mergeSubjectFound: false, hostReach: 'ok',
      commitsAhead: 1, realCommitsAhead: 0,
    } as never);
    expect(fresh).toBe('claimed');

    // The SAME branch, read from a pulse taken before the claim was pushed:
    // `commitsAhead` is 0, so `:215` is never reached and `:264` answers.
    const stale = branchState({
      refTip: 'aaa111', mainTip: 'main999', pr: 'none', waits: null,
      mergeSubjectFound: false, hostReach: 'ok',
      commitsAhead: 0, realCommitsAhead: 0,
    } as never);
    expect(stale).toBe('merged');

    // Which is why re-deriving under failure is what puts live work in DONE:
    // the two answers differ for one unchanged branch, and only the first is
    // true. If this ever stops differing, the fix below is guarding nothing.
    expect(fresh).not.toBe(stale);
  });

  it('a failed scan keeps the section the last good scan gave', () => {
    // The fresh answer is `done` — what the stale pulse re-derives — and it is
    // ignored. The remembered `not-started` is what the row keeps.
    expect(sectionUnderFailure(true, remembered, row, 'done')).toBe('not-started');
  });

  it('a row the last good scan never saw is UNPLACED, not sorted', () => {
    // No remembered answer, and nothing may be derived from a stale pulse. The
    // caller shows the row without a section — never DONE, which is the exact
    // #995 failure.
    const unseen = { repo: 'plot', branch: 'bug/dispatched-after', plan: 'later' };
    expect(sectionUnderFailure(true, remembered, unseen, 'done')).toBeNull();
  });

  it('the #995 reproduction: a claim-only branch does not reach DONE', () => {
    // End to end through both rules. The stale pulse says `merged`, which
    // classify sends to `done`; the row was `not-started` when last seen, and
    // that is what it keeps.
    const stale = branchState({
      refTip: 'aaa111', mainTip: 'main999', pr: 'none', waits: null,
      mergeSubjectFound: false, hostReach: 'ok',
      commitsAhead: 0, realCommitsAhead: 0,
    } as never);
    const derived: WaitingGroup = stale === 'merged' ? 'done' : 'not-started';
    expect(derived).toBe('done');
    expect(sectionUnderFailure(true, remembered, row, derived)).not.toBe('done');
  });

  it('a SUCCESSFUL scan re-derives everything, unchanged', () => {
    // The detour must be invisible on every pass but the failing one. The
    // remembered map is deliberately wrong here: a successful scan must ignore
    // it entirely rather than prefer it.
    expect(sectionUnderFailure(false, remembered, row, 'done')).toBe('done');
    expect(sectionUnderFailure(false, remembered, row, 'working')).toBe('working');
    expect(sectionUnderFailure(false, new Map(), row, 'quiet')).toBe('quiet');
  });

  it('a failed scan with NOTHING remembered places nothing', () => {
    // A restart remembers no section, so every row is unplaced until one scan
    // completes. That is the honest answer rather than a section invented from
    // a pulse this process never saw.
    expect(sectionUnderFailure(true, new Map(), row, 'done')).toBeNull();
  });

  it('a slice may not place an unplaced row from its siblings', () => {
    // `rowsBySection` rewrites a row's group to its SLICE's section, so an
    // unplaced row sharing a wave with remembered ones would silently inherit
    // their section — a derivation from the pulse the banner called stale,
    // which is the one thing the rule forbids. A slice-mate that WAS seen says
    // nothing about a row that was not.
    const seen = {
      ...BARE, repo: 'plot', branch: 'bug/seen', plan: 'p', wave: 'One',
      group: 'not-started' as WaitingGroup | null,
    };
    const unseen = {
      ...BARE, repo: 'plot', branch: 'bug/unseen', plan: 'p', wave: 'One',
      group: null as WaitingGroup | null,
    };
    const out = rowsBySection([seen, unseen] as never);
    expect(out.find((r) => r.branch === 'bug/unseen')?.group).toBeNull();
  });

  it('the identity carries the PLAN, so two rows for one branch cannot swap', () => {
    // `repo/branch` was the key until a board FLASHED: two rows for one
    // double-claimed branch shared it, so each pulse one overwrote the other's
    // remembered value. A carried-forward section keyed that way would inherit
    // the bug whole, handing one row the other's section.
    const other = { repo: 'plot', branch: 'bug/a-slice', plan: 'a-different-plan' };
    expect(sectionKey(other)).not.toBe(sectionKey(row));
    expect(sectionUnderFailure(true, remembered, other, 'done')).toBeNull();
  });
});
