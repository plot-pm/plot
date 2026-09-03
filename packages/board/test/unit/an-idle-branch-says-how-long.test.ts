import { describe, it, expect } from 'vitest';
import { rowsFromPulse } from '../../src/server/fleet.js';
import { tupleAgeText, tupleFromRow } from '../../src/app/lib/tuple-row.js';
import { ageLabel } from '../../src/app/lib/agent-rows/row-identity.js';
import type { FleetReading } from '../../src/contract/schema.js';

// AN IDLE BRANCH SAYS HOW LONG — wave 2 of `a-branch-with-work-is-visible`.
//
// Wave 1 (#492) gave a branch with commits and no PR a row. The row carries
// `ageMinutes` and the age slot already rendered it, so this wave is NOT a new
// derivation — the plan says so, and it was measured on main 2026-08-28 before
// anything here was written: the row already read `14h`, `119d`, `120d`.
//
// What did not hold is the plan's actual requirement. The estate spans
// **14 hours to 165 days** (measured 2026-08-28 across 27 remote branches: 9
// under a day, 8 at 30-89d, 3 past 90d), and the plan asks for a format that
// renders both extremes legibly *and makes the difference obvious at a glance*.
// A column of `119d 120d 92d 165d` is four three-digit numbers a reader must
// decode one at a time. At ~31 rows that is the plan's own "noise at 80".
//
// The fix is not a new rule — it is the estate's EXISTING rule, applied to the
// one clock that never got it. Three formatters age things here:
//
//   - `humanAge`     server notes, prose, caps at days
//   - `waitingLabel` the waiting clock — scales to `mo` at 60 days
//   - `tupleAgeText` the row's age cell — capped at days, the straggler
//
// `waitingLabel`'s docstring names the defect verbatim — *"waiting 180d is
// arithmetic the reader has to do"* — and `agent-list.test.ts` locks it in a
// test titled *"scales the unit so a wait never reads 180d"*. The rule was
// stated, ratified and applied to the sibling clock; this clock was left
// behind. Finishing it is the whole change.
//
// SIXTY DAYS, matching `waitingLabel` exactly, and the threshold is the
// judgement call this file records. A different number would put a THIRD scale
// in a column whose argument is one vocabulary — see `statusTone`, which keys
// on the word for that reason. The boundaries are asserted below because a unit
// change is where a format reads wrong.

describe('the age scales, so an idle branch is legible at a glance', () => {
  it('keeps minutes, hours and days for everything inside two months', () => {
    // UNCHANGED BEHAVIOUR, asserted so the scaling below cannot be mistaken for
    // a rewrite. These are the values `tuple-row.test.ts` already locks.
    expect(tupleAgeText(45)).toBe('45m');
    expect(tupleAgeText(180)).toBe('3h');
    expect(tupleAgeText(2880)).toBe('2d');
    // A day short of the boundary is still a day count.
    expect(tupleAgeText(59 * 24 * 60)).toBe('59d');
  });

  it('scales to months at sixty days, exactly where the waiting clock does', () => {
    // THE BOUNDARY. `waitingLabel(60)` is `2mo` and this must agree: two clocks
    // rendering the same duration two ways is the defect `ageLabel` was split
    // out to prevent, one column over.
    expect(tupleAgeText(60 * 24 * 60)).toBe('2mo');
    // The estate's real tail, measured 2026-08-28. `165d` and `119d` differ by
    // one digit in the middle; `5mo` and `3mo` differ in the unit a reader
    // sees first.
    expect(tupleAgeText(119 * 24 * 60)).toBe('3mo');
    expect(tupleAgeText(165 * 24 * 60)).toBe('5mo');
  });

  it('stays inside the four-character budget the row geometry states', () => {
    // `TupleRow`'s layout doc budgets slot 6 as *"an age is four characters"*,
    // and the cell is `shrink-0` — so an age that outgrew the budget pushes the
    // grid rather than truncating. Days ALREADY broke that budget: `3650d` is
    // five characters, and every branch past 999 days rendered one column wide.
    // Scaling fixes a latent overflow as well as a legibility one.
    //
    // The ceiling is honest rather than absolute: `100mo` is five characters
    // again at 3000 days. That is 8.2 years, in a repository whose first commit
    // is 2026-02-07 — unreachable, and `waitingLabel` carries the identical
    // unbounded tail. A fourth unit to answer it would put back the extra
    // vocabulary this change exists to avoid, so the range asserted is the
    // range a branch can actually occupy.
    for (const days of [0, 1, 59, 60, 119, 165, 400, 1000, 2999]) {
      expect(tupleAgeText(days * 24 * 60).length).toBeLessThanOrEqual(4);
    }
  });

  it('renders the scaled age on the branch row itself', () => {
    // The assertion the brief names: the age is rendered ON A BRANCH ROW. Not
    // the formatter in isolation — the value that reaches the age slot of the
    // row wave 1 built, through the projection the renderer actually calls.
    const row = branchRow('docs/long-abandoned', 119 * 24 * 60);
    expect(tupleFromRow(row).age).toEqual({ text: '3mo', label: '' });
    // UNLABELLED, because since-last-change is the rule and this row obeys it.
    // The label marks the exception — a not-started row's approval clock — and
    // a branch with commits is aged from its last commit, which is the rule.
    expect(tupleFromRow(row).age.label).toBe('');
  });

  it('tells the two extremes apart by their unit, not by their digits', () => {
    // THE FEATURE, stated as the property rather than as two values: *in flight*
    // and *abandoned* must differ in the character a reader lands on first. The
    // brief's own pair — 14 hours and 119 days.
    const inFlight = tupleFromRow(branchRow('bug/in-flight', 14 * 60)).age.text;
    const abandoned = tupleFromRow(branchRow('docs/abandoned', 119 * 24 * 60)).age.text;
    expect(inFlight).toBe('14h');
    expect(abandoned).toBe('3mo');
    // The units differ, which is what a glance reads. Before this change both
    // ended in a unit one character wide and differed only in their digits.
    const unit = (s: string) => s.replace(/^\d+/, '');
    expect(unit(inFlight)).not.toBe(unit(abandoned));
  });

  it('keeps ONE formatter, so an issue row and a branch row cannot disagree', () => {
    // `ageLabel`'s own docstring says it was split out so two row kinds cannot
    // render one duration two ways, and warns the alternative was *"a second
    // copy of four lines that would drift the first time either changed"*.
    //
    // This IS the first time either changed. Two byte-identical copies existed
    // when this wave started; fixing one would have produced exactly the drift
    // that docstring was written to prevent. They are now one function, and this
    // asserts it at the boundary where a divergence would show.
    for (const minutes of [45, 180, 2880, 59 * 24 * 60, 60 * 24 * 60, 165 * 24 * 60]) {
      expect(ageLabel(minutes)).toBe(tupleAgeText(minutes));
    }
  });
});

describe('the row still lands where wave 1 put it', () => {
  // WAVE 1's ITEM 5 MUST NOT REGRESS, and it is the assertion the brief calls
  // out by name. Nothing about a display format should move a row between
  // sections — but the section routing reads `ageMinutes`, so a change made
  // near it is exactly when to prove it did not.

  it('keeps a branch someone may still be writing out of WAITING ON YOU', () => {
    // Nothing is asked of the reader by a branch someone may still be writing,
    // and WAITING ON YOU's whole value is that its rows need an answer.
    //
    // ONLY INSIDE THE QUIET WINDOW NOW, and the window is what bounds the
    // change. `quiet-is-not-one-state` moved the two stale branches
    // deliberately: commits under no PR, untouched for fourteen hours or four
    // months, are not someone still writing — that is work needing a revive-or-
    // drop call, and the call is a person's. A branch pushed five minutes ago
    // is the one this still guards, and it is the case the sentence was always
    // about.
    expect(build().find((r) => r.branch === 'bug/fresh')!.group).not.toBe('waiting-on-you');
  });

  it('leaves a recent branch in NOT STARTED and names a stale one ABANDONED', () => {
    // Recent work is something to pick up. A branch nobody has touched in four
    // months used to be *an errand to go check* — QUIET, described by its age —
    // and the age was the whole of what the row said. It now says what the
    // branch IS: real commits, no PR ever opened, nobody on it.
    //
    // THE AGE IS NOT LOST, which is this file's own subject. It follows the
    // state rather than standing in for it, and the format this wave fixed is
    // still what renders it.
    const rows = build();
    expect(rows.find((r) => r.branch === 'bug/fresh')!.group).toBe('not-started');
    const abandoned = rows.find((r) => r.branch === 'docs/abandoned')!;
    expect(abandoned.group).toBe('waiting-on-you');
    expect(abandoned.note).toMatch(/commits, no PR ever opened/);
    expect(abandoned.note).toMatch(/119 days/);
  });
});

const QUIET = 30;

const pulse: FleetReading = {
  main: 'main',
  head: 'abc1234',
  plans: [],
  summary: { plans: 0, waves: 0, branches: 0, claimed: 0, eligible: 0, blocked: 0, deferred: 0 },
};

// The spread the plan names, and the one measured on this estate: a branch
// pushed minutes ago, one at fourteen hours, and one four months idle.
const ages = new Map<string, number | null>([
  ['bug/fresh', 5],
  ['bug/in-flight', 14 * 60],
  ['docs/abandoned', 119 * 24 * 60],
]);

const unmerged = new Set(['bug/fresh', 'bug/in-flight', 'docs/abandoned']);

const build = () => rowsFromPulse(
  pulse, ages, 'plot', QUIET, new Map(), '', null, Date.now(),
  null, null, null, null, null, '', null, unmerged,
);

/** The row wave 1 builds for a branch with commits and no PR, by name. */
function branchRow(branch: string, ageMinutes: number) {
  const row = rowsFromPulse(
    pulse, new Map([[branch, ageMinutes]]), 'plot', QUIET, new Map(), '', null, Date.now(),
    null, null, null, null, null, '', null, new Set([branch]),
  ).find((r) => r.branch === branch);
  if (!row) throw new Error(`no row built for ${branch}`);
  return row;
}
