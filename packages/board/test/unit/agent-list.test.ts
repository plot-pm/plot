import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  groupByPlan,
  countdown,
  waitingLabel,
  showPlanHeading,
  isStartable,
  isLive,
  isCollapsible,
  noActionReason,
  splitBranch,
  prStateWord,
  noteWithoutPr,
  readCollapsed,
  writeCollapsed,
  COLLAPSED_BY_DEFAULT,
  CARD_BELOW_PX,
  GROUPS,
  ROW_TRACKS,
  CHANGE_MARK_MS,
  ChangeMarks,
  changedRows,
  rowKey,
  watchedState,
  type WatchedState,
  type PlanGroup,
} from '../../src/app/components/AgentList.js';
import { GROUP_ORDER } from '../../src/server/fleet.js';
import {
  AgentRowSchema, DRAFT_PLAN_NOTE, ELIGIBLE_NOTE, type AgentRow,
} from '../../src/contract/schema.js';

const row = (over: Partial<AgentRow> = {}): AgentRow => ({
  repo: 'plot', branch: 'feature/x', plan: 'a-plan', planFile: '2026-08-16-a-plan.md',
  wave: 'w', state: 'wip', phase: null, group: 'quiet', ageMinutes: 10, note: '', pr: null,
  branchUrl: '', waitingDays: null, ...over,
});

describe('groupByPlan', () => {
  it('groups rows by plan and orders plans by their most urgent row', () => {
    // Otherwise a plan holding one stale branch would outrank a plan whose
    // branch just moved — the opposite of what an age-sorted list is for.
    const rows = [
      row({ branch: 'a', plan: 'fresh', ageMinutes: 5 }),
      row({ branch: 'b', plan: 'stale', ageMinutes: 900 }),
      row({ branch: 'c', plan: 'fresh', ageMinutes: 3 }),
    ];
    expect(groupByPlan(rows).map((g) => g.plan)).toEqual(['stale', 'fresh']);
  });

  it('keeps each plan\'s rows in the age order they arrived in', () => {
    // `sortRows` already ordered by age descending; grouping must not disturb
    // that INSIDE a plan, only gather it.
    const rows = [
      row({ branch: 'old', plan: 'p', ageMinutes: 300 }),
      row({ branch: 'mid', plan: 'p', ageMinutes: 60 }),
      row({ branch: 'new', plan: 'p', ageMinutes: 2 }),
    ];
    expect(groupByPlan(rows)[0].rows.map((r) => r.branch)).toEqual(['old', 'mid', 'new']);
  });

  it('treats an unknown age as least urgent rather than most', () => {
    // null must not sort to the front: "we do not know" is not "ancient".
    const rows = [
      row({ branch: 'unknown', plan: 'nulls', ageMinutes: null }),
      row({ branch: 'known', plan: 'ages', ageMinutes: 1 }),
    ];
    expect(groupByPlan(rows).map((g) => g.plan)).toEqual(['ages', 'nulls']);
  });

  it('returns one group for rows that all share a plan', () => {
    // The caller uses the COUNT to decide whether a sub-heading earns its place.
    const groups = groupByPlan([row({ branch: 'a' }), row({ branch: 'b' })]);
    expect(groups).toHaveLength(1);
    expect(groups[0].rows).toHaveLength(2);
  });

  it('returns nothing for no rows', () => {
    expect(groupByPlan([])).toEqual([]);
  });
});

describe('group order — actionable before diagnostic', () => {
  it('puts NOT STARTED above QUIET', () => {
    // Work a person can pick up right now outranks work they must go
    // investigate: not-started offers an opportunity, quiet assigns an errand.
    const keys = GROUPS.map((g) => g.key);
    expect(keys.indexOf('not-started')).toBeLessThan(keys.indexOf('quiet'));
  });

  it('renders groups in exactly the order the server sorts rows into', () => {
    // Two arrays that must agree is precisely the duplication that drifts in a
    // later refactor — and a disagreement would sort rows into one sequence and
    // render the sections in another, which reads as rows landing in the wrong
    // group rather than as two lists disagreeing.
    expect(GROUPS.map((g) => g.key)).toEqual(GROUP_ORDER);
  });
});

describe('waitingLabel', () => {
  it('scales the unit so a wait never reads "180d"', () => {
    // The same defect humanAge fixed for commit ages: past a couple of months,
    // days are arithmetic the reader has to do.
    expect(waitingLabel(3)).toBe('3d');
    expect(waitingLabel(45)).toBe('45d');
    expect(waitingLabel(60)).toBe('2mo');
    expect(waitingLabel(180)).toBe('6mo');
  });

  it('says "today" rather than "0d"', () => {
    // A plan approved this morning has not been waiting a measurable stretch,
    // and "0d" reads like a stopped clock.
    expect(waitingLabel(0)).toBe('today');
  });
});

describe('countdown', () => {
  it('counts down from the age toward the interval', () => {
    // The git counter is derived: the client owns FLEET_POLL_MS, so "next in"
    // is the interval minus however much of it has elapsed.
    expect(countdown(1, 4)).toBe(3);
    expect(countdown(3, 4)).toBe(1);
  });

  it('never goes below zero when the age has overrun the interval', () => {
    // A poll can be late — a hidden tab, a slow response. "next in -2s" is not
    // a thing a reader can act on.
    expect(countdown(9, 4)).toBe(0);
    expect(countdown(4, 4)).toBe(0);
  });

  it('is null when the age is unknown', () => {
    expect(countdown(null, 4)).toBeNull();
  });
});

describe('groupByPlan with unplanned rows', () => {
  const row = (branch: string, plan: string) =>
    ({ repo: 'plot', branch, plan, planFile: '', wave: '', state: 'wip',
       group: 'waiting-on-you', ageMinutes: 1, note: '', branchUrl: '',
       pr: null, waitingDays: null }) as never;

  it('keeps unplanned rows together under one nameless group', () => {
    // They share `plan: ''` by construction, so they collapse into one group
    // whose name is empty. That is fine — but the RENDERER must not head it,
    // or it prints a bare "(3)" that labels nothing. Pinned here because the
    // grouping is what makes such a group possible at all.
    const groups = groupByPlan([row('a', ''), row('b', ''), row('c', 'real-plan')]);
    const nameless = groups.find((g) => g.plan === '');
    expect(nameless?.rows).toHaveLength(2);
    expect(groups.filter((g) => g.plan === '')).toHaveLength(1);
  });
});

describe('showPlanHeading — decided per group, not per section', () => {
  const group = (plan: string, count: number): PlanGroup => ({
    plan,
    planFile: plan ? `docs/plans/${plan}.md` : '',
    rows: Array.from({ length: count }, (_, i) => row({ branch: `b${i}`, plan })),
  });

  it('labels a plan holding several rows, instead of printing its name on each', () => {
    // The case that motivated grouping: six QUIET rows of one plan, whose name
    // otherwise printed six times down the column.
    expect(showPlanHeading(group('alpha', 6))).toBe(true);
  });

  it('stays quiet for a single row, where the heading labels the one line below it', () => {
    // The whole change: a heading above a single row says the plan name once —
    // exactly as the row itself would — and charges a line of height for it.
    expect(showPlanHeading(group('alpha', 1))).toBe(false);
  });

  it('stays quiet for two plans of one row each', () => {
    // The reversal. The section-wide rule said `true` here to keep two names
    // from running together unlabelled; that worry is real and now answered by
    // the ROWS, which print their own plan name when their group has no
    // heading. Pinned below in the mixed-section case.
    expect(showPlanHeading(group('alpha', 1))).toBe(false);
    expect(showPlanHeading(group('beta', 1))).toBe(false);
  });

  it('never labels a nameless group, however many rows it holds', () => {
    // Rows no plan claims: there is nothing to head them WITH, and the
    // section-wide version printed a bare "(3)".
    expect(showPlanHeading(group('', 4))).toBe(false);
  });

  it('stays quiet for an empty group', () => {
    expect(showPlanHeading(group('alpha', 0))).toBe(false);
  });

  it('answers each group of a MIXED section on its own', () => {
    // What a section-wide answer cannot express, and the reason this moved: one
    // plan with several rows beside a plan with one. A single flag is wrong for
    // one of them either way — heading the single row, or stripping the
    // heading off the six.
    expect(showPlanHeading(group('many', 3))).toBe(true);
    expect(showPlanHeading(group('lonely', 1))).toBe(false);
  });
});

describe('isLive — which rows carry the pulsing indicator', () => {
  /**
   * The three entrances to WORKING, verbatim from `classify()` in fleet.ts.
   * They differ in strength — a dirty worktree is the strongest evidence there
   * is, a bare claim the weakest — and that difference is deliberately NOT
   * rendered.
   */
  const WORKING_NOTES = [
    'uncommitted work in a local worktree',
    'last commit 3 min ago',
    'claimed, no commits yet',
  ];

  it('gives all three WORKING notes the SAME answer', () => {
    // The load-bearing assertion, and the one a confidence-graded
    // implementation fails: it would pass a test checking only the dirty
    // worktree. Membership is the statement and it is true for all three — the
    // note already says which reason, so a second vocabulary made of speeds
    // would encode in motion what the text states plainly.
    const answers = WORKING_NOTES.map((note) => isLive(row({ group: 'working', note })));
    expect(answers).toEqual([true, true, true]);
    expect(new Set(answers).size).toBe(1);
  });

  it('leaves every other group still', () => {
    // Asserted as a negative across the whole vocabulary rather than on one
    // group: `working` is the only claim the board can make honestly, and a
    // blanket indicator passes any test that only checks a working row.
    for (const group of GROUPS.map((g) => g.key).filter((k) => k !== 'working')) {
      expect(isLive(row({ group }))).toBe(false);
    }
  });

  it('leaves a QUIET row still even when it carries a fresh claim', () => {
    // The near-miss the plan names. A quiet row can hold a claim and a recent
    // note and still be quiet — the group is what decides, because the group is
    // the only thing the pulse re-derives every scan.
    expect(isLive(row({ group: 'quiet', state: 'wip', note: 'claimed, no commits yet' })))
      .toBe(false);
    expect(isLive(row({ group: 'quiet', ageMinutes: 1, note: 'last commit 1 min ago' })))
      .toBe(false);
  });

  it('follows the GROUP rather than the state or the age', () => {
    // A deferred branch with a two-minute-old commit is `not-started` by group
    // — the one place intent outranks git. The indicator must follow the group,
    // or it would claim an agent is on work somebody handed back.
    expect(isLive(row({ group: 'not-started', state: 'deferred', ageMinutes: 2 }))).toBe(false);
    // And a working row with no age at all still counts: a fresh claim has no
    // commit to date, and that is one of the three entrances.
    expect(isLive(row({ group: 'working', ageMinutes: null }))).toBe(true);
  });
});

describe('isStartable — which NOT STARTED rows offer work', () => {
  const notStarted = (over: Partial<AgentRow> = {}) =>
    row({ group: 'not-started', state: 'open', ageMinutes: null, note: ELIGIBLE_NOTE, ...over });

  it('offers a branch no earlier wave blocks', () => {
    expect(isStartable(notStarted())).toBe(true);
  });

  it('offers NOTHING on a branch blocked by an earlier wave', () => {
    // The load-bearing negative, and the half a naive `group === 'not-started'`
    // implementation gets wrong: the group holds both kinds. A button here
    // would offer to skip the ordering waves exist to express, and
    // plot-dispatch.sh refuses that branch — so the board would be inviting an
    // action the tool declines.
    expect(isStartable(notStarted({ note: 'blocked by an earlier wave' }))).toBe(false);
  });

  it('reads the eligible note from the contract, not from a copy of the sentence', () => {
    // The split survives onto a row only as this note — the row carries no
    // verdict field. A second copy of the sentence would let a reword take the
    // button away with nothing failing, so the test asserts the SHARED
    // constant is what the row is matched against.
    expect(isStartable(notStarted({ note: ELIGIBLE_NOTE }))).toBe(true);
    expect(isStartable(notStarted({ note: `${ELIGIBLE_NOTE} (probably)` }))).toBe(false);
  });

  it('offers nothing on a row that already has a branch and a claim', () => {
    // Working and quiet rows are somebody's already. Offering to start one
    // invites exactly the double-dispatch fleet-sees-merged-branches prevents.
    for (const group of ['working', 'quiet', 'waiting-on-you', 'done'] as const) {
      expect(isStartable(row({ group, state: 'open', note: ELIGIBLE_NOTE }))).toBe(false);
    }
  });

  it('offers NOTHING on a branch whose plan is still a Draft', () => {
    // The other half of the same rule, and the reason the draft note is a
    // sibling of ELIGIBLE_NOTE rather than a suffix on it: `plot-dispatch`
    // refuses a drafted plan's branches exactly as it refuses a wave-blocked
    // one, so the button must not appear on either.
    //
    // It comes out right by CONSTRUCTION — `isStartable` matches the eligible
    // sentence, so any other note loses the button without a second rule to
    // keep in step. Pinned anyway: that is a property worth failing loudly if
    // someone later loosens the match to a substring.
    expect(isStartable(notStarted({ note: DRAFT_PLAN_NOTE }))).toBe(false);
  });

  it('offers nothing on a deferred branch, whatever group it lands in', () => {
    // Deferred rows are `not-started` by group — nobody is working on them —
    // but the work was handed back deliberately, not left untaken. Starting it
    // is a decision about whether the branch is wanted at all, which is not
    // what this button does.
    expect(isStartable(row({ group: 'not-started', state: 'deferred', note: ELIGIBLE_NOTE })))
      .toBe(false);
  });
});

describe('which groups start collapsed', () => {
  it('folds quiet and done, and leaves every other group open', () => {
    // BOTH halves. A blanket default — everything folded, or nothing — passes
    // an assertion that checks only one group, and the whole point of the
    // default is that it is the existing actionable-before-diagnostic order
    // made effective rather than a blanket preference.
    expect([...COLLAPSED_BY_DEFAULT].sort()).toEqual(['done', 'quiet']);
    const open = GROUPS.map((g) => g.key).filter((k) => !COLLAPSED_BY_DEFAULT.includes(k));
    expect(open).toEqual(['waiting-on-you', 'working', 'waiting-on-machine', 'not-started']);
  });

  it('folds the DIAGNOSTIC end of the order and nothing above it', () => {
    // Stated against the order itself rather than against two names, so a group
    // inserted between `not-started` and `quiet` cannot silently become
    // collapsed-by-default.
    const keys = GROUPS.map((g) => g.key);
    const folded = keys.filter((k) => COLLAPSED_BY_DEFAULT.includes(k));
    expect(folded).toEqual(keys.slice(keys.length - folded.length));
  });
});

describe('isCollapsible — an empty group hides nothing', () => {
  it('offers no control on an empty group', () => {
    // The header renders `rows.length > 0 ? '(N)' : hint`, so folding an empty
    // group would hide the hint — the explanation for the emptiness, and the
    // one thing in there worth reading. A control on a group with nothing to
    // hide is an offer that leads nowhere.
    expect(isCollapsible(0)).toBe(false);
  });

  it('offers one as soon as there is a row to hide', () => {
    expect(isCollapsible(1)).toBe(true);
    expect(isCollapsible(7)).toBe(true);
  });
});

describe('readCollapsed / writeCollapsed — persistence, and its default', () => {
  /** A localStorage stand-in, so the test states the storage rather than the DOM. */
  const store = (initial: Record<string, string> = {}) => {
    const map = new Map(Object.entries(initial));
    return {
      getItem: (k: string) => map.get(k) ?? null,
      setItem: (k: string, v: string) => { map.set(k, v); },
      read: () => [...map.entries()],
    };
  };

  it('applies the default when nothing is stored', () => {
    // The load-bearing half: a first visit has no stored value, and treating
    // that as "nothing collapsed" ships the crowded view to everyone who has
    // not yet clicked a header.
    expect([...readCollapsed(store())].sort()).toEqual(['done', 'quiet']);
  });

  it('survives a reload — what was written comes back', () => {
    const s = store();
    writeCollapsed(new Set(['working'] as const), s);
    expect([...readCollapsed(s)]).toEqual(['working']);
  });

  it('distinguishes "nothing stored" from "everything opened"', () => {
    // Absent and empty are different statements: `[]` is a reader who opened
    // every group and meant it, and re-applying the default over that would
    // undo their choice on every reload.
    const s = store();
    writeCollapsed(new Set(), s);
    expect([...readCollapsed(s)]).toEqual([]);
  });

  it('falls back to the default on stored junk rather than throwing', () => {
    // A view that renders nothing because it could not remember which sections
    // were folded is a worse answer than one that simply forgets.
    for (const raw of ['not json', '{"quiet":true}', '"quiet"', '17']) {
      expect([...readCollapsed(store({ 'plot-board:agents:collapsed': raw })).values()].sort())
        .toEqual(['done', 'quiet']);
    }
  });

  it('drops a stored key no group answers to', () => {
    // Stale state from a renamed group would fold nothing while looking like it
    // had — a set that disagrees with the rendered sections.
    const s = store({ 'plot-board:agents:collapsed': '["quiet","gone-group"]' });
    expect([...readCollapsed(s)]).toEqual(['quiet']);
  });

  it('never touches the query string', () => {
    // Collapse state must not be shareable: a link carrying ?collapsed=quiet,done
    // would rebuild the recipient's view as a side effect of "have a look at
    // this". Asserted on the KEY the state is written under — a storage key is
    // not a query parameter, and the browser-level assertion that the URL is
    // unchanged by toggling lives in the integration test.
    const s = store();
    writeCollapsed(new Set(['quiet'] as const), s);
    expect(s.read().map(([k]) => k)).toEqual(['plot-board:agents:collapsed']);
  });
});

describe('noActionReason — the disabled menu says why', () => {
  it('names the ROW\'s own reason, not a generic "no actions"', () => {
    // A disabled control without a reason is the kind that makes people guess,
    // and the row already knows: its note is the whole explanation.
    expect(noActionReason(row({ note: 'blocked by an earlier wave' })))
      .toMatch(/blocked by an earlier wave/);
    expect(noActionReason(row({ note: 'no commit for 22 days' })))
      .toMatch(/no commit for 22 days/);
  });

  it('still says something on a row carrying no note', () => {
    expect(noActionReason(row({ note: '' }))).toBeTruthy();
  });
});

describe('splitBranch — the elision is in the MIDDLE', () => {
  it('protects the TAIL, which is where these names differ', () => {
    // The whole decision, and the one an ordinary `truncate` gets backwards.
    // Six branches share `feature/opus5-hardening-` and differ only after it,
    // so end-truncation renders all six identically — which reads as six
    // duplicate rows rather than as truncation.
    const a = splitBranch('feature/opus5-hardening-challenge-budget');
    const b = splitBranch('feature/opus5-hardening-longhorizon');
    // The heads may be clipped to nothing by a narrow column; the tails are
    // pinned, and they are what tells the two apart.
    expect(a.tail).not.toBe(b.tail);
    // Each half joins back to the whole name — nothing is lost, only folded.
    expect(a.head + a.tail).toBe('feature/opus5-hardening-challenge-budget');
    expect(b.head + b.tail).toBe('feature/opus5-hardening-longhorizon');
  });

  it('leaves a short name entirely in the head, with nothing pinned', () => {
    // With no tail to hold the right edge, `truncate` has nothing to clip
    // against and a fitting name renders whole — so a short branch never gains
    // an ellipsis it did not need.
    expect(splitBranch('main')).toEqual({ head: 'main', tail: '' });
    expect(splitBranch('feature/xy', 12)).toEqual({ head: 'feature/xy', tail: '' });
  });

  it('keeps the tail budget off the head when the name is exactly the budget', () => {
    // The boundary: equal to the budget is still "fits", not "fold it all".
    expect(splitBranch('abcdefghijkl', 12)).toEqual({ head: 'abcdefghijkl', tail: '' });
    expect(splitBranch('abcdefghijklm', 12))
      .toEqual({ head: 'a', tail: 'bcdefghijklm' });
  });
});

describe('prStateWord — the state travels as a WORD', () => {
  it('spells out each condition, because a symbol may never be the sole carrier', () => {
    expect(prStateWord('green')).toBe('green');
    expect(prStateWord('pending')).toBe('CI running');
    expect(prStateWord('failing')).toBe('checks failing');
    expect(prStateWord('conflicts')).toBe('conflicts');
  });

  it('distinguishes `no checks` from `conflicts` — the defect being fixed', () => {
    // One label for both is the defect, and renaming all of them to
    // `conflicts` is the same defect mirrored: a workflow genuinely awaiting a
    // human click wants a click, and a conflicting branch wants a rebase.
    expect(prStateWord('none')).toBe('no checks');
    expect(prStateWord('none')).not.toBe(prStateWord('conflicts'));
  });

  it('says NOTHING where the host cannot report a state', () => {
    // Bitbucket carries no rollup. A word meaning only *this board could not
    // find out*, stamped on every row of an entire host, is noise — and absent
    // is the honest rendering, which is the rule the contract states for the
    // field itself.
    expect(prStateWord('unknown')).toBe('');
  });
});

describe('noteWithoutPr — the note is relieved of one duty, not replaced', () => {
  const pr = (number: number) =>
    ({ number, url: '', draft: false, state: 'green' as const });

  it('keeps everything a PR state cannot say', () => {
    // The three the plan names, each carried after the server's separator.
    expect(noteWithoutPr('PR #158, conflicts · awaiting review', pr(158)))
      .toBe('awaiting review');
    expect(noteWithoutPr('uncommitted work in a local worktree', null))
      .toBe('uncommitted work in a local worktree');
    expect(noteWithoutPr('blocked by an earlier wave', null))
      .toBe('blocked by an earlier wave');
  });

  it('drops a PR clause that says only what the cell already says', () => {
    // `PR #130 green` and `PR #131, draft, CI running` are entirely the PR's
    // own condition, which the cell now renders from the fields. Printing them
    // beside it would say the same thing twice on every row with a PR.
    expect(noteWithoutPr('PR #130 green', pr(130))).toBe('');
    expect(noteWithoutPr('PR #131, draft, CI running', pr(131))).toBe('');
  });

  it('is anchored, and matches only the row\'s OWN number', () => {
    // This is deliberately NOT the `indexOf` search it replaces. That one
    // hunted a marker ANYWHERE in a sentence in order to link it, and dropped
    // the link the moment the wording drifted. This one fails the other way: a
    // note it does not recognise is printed IN FULL, which costs a duplicated
    // word rather than a lost link — and the cell renders from the fields
    // either way.
    expect(noteWithoutPr('see PR #130 green', pr(130))).toBe('see PR #130 green');
    expect(noteWithoutPr('PR #999 green', pr(130))).toBe('PR #999 green');
    expect(noteWithoutPr('PR #130 green', null)).toBe('PR #130 green');
  });
});

describe('changedRows — which rows mark themselves, and which stay silent', () => {
  /** A row carrying one PR state, or none. */
  const withState = (branch: string, state: WatchedState) =>
    row({ branch, pr: state === null ? null
      : { number: 1, url: '', draft: false, state } });

  /** The memory as it stands after observing `rows` once. */
  const observed = (...rows: AgentRow[]) => changedRows(new Map(), rows).next;

  it('marks NOTHING on the first pulse, however much state the rows carry', () => {
    // The case that fires on every page load, every board restart and every
    // reconnect — and the one a naive implementation gets wrong in the loudest
    // possible way, by flashing all 43 rows at once. `unknown → conflicts` is a
    // first sighting, not a transition.
    const rows = [withState('a', 'conflicts'), withState('b', 'green'), withState('c', null)];
    const { changed, next } = changedRows(new Map(), rows);
    expect(changed.size).toBe(0);
    // It still RECORDED all three, or the second pulse would be a first one.
    expect(next.size).toBe(3);
  });

  it('marks a row whose state changed', () => {
    const prior = observed(withState('a', 'pending'));
    expect([...changedRows(prior, [withState('a', 'failing')]).changed])
      .toEqual(['plot/a']);
  });

  it('does NOT mark a row whose watched value held, however much else moved', () => {
    // The marker is about the watched value ALONE. A new commit, a rewritten
    // note and a changed age are not what it claims.
    const prior = observed(withState('a', 'green'));
    const moved = row({
      branch: 'a', pr: { number: 1, url: '', draft: false, state: 'green' },
      note: 'last commit 1 min ago', ageMinutes: 1, group: 'working',
    });
    expect(changedRows(prior, [moved]).changed.size).toBe(0);
  });

  it('marks a PR APPEARING — null is a value, not a gap', () => {
    // `null → pending`: an agent has just delivered, and this is often the most
    // interesting transition a branch ever has.
    const prior = observed(withState('a', null));
    expect([...changedRows(prior, [withState('a', 'pending')]).changed]).toEqual(['plot/a']);
  });

  it('marks a PR GOING AWAY, the same as one arriving', () => {
    // `pending → null`, a PR merged or closed out from under the row. An
    // asymmetry here would need a reason and there is none that survives *the
    // row's own state changed*.
    const prior = observed(withState('a', 'pending'));
    expect([...changedRows(prior, [withState('a', null)]).changed]).toEqual(['plot/a']);
  });

  it('tells NEVER-SEEN apart from SEEN-WITH-NO-PR', () => {
    // THE pairing of this whole rule. An implementation storing both as
    // "nothing" passes the first-pulse assertion above and then silences every
    // branch's first PR forever — so both halves are asserted against the same
    // row and the same state.
    const fresh = changedRows(new Map(), [withState('a', null)]);
    expect(fresh.changed.size).toBe(0);              // first sighting: silent
    expect(fresh.next.has('plot/a')).toBe(true);     // but REMEMBERED,
    expect(fresh.next.get('plot/a')).toBe(null);     // as a known `null`
    // …so the PR that opens next is a change, not another first sighting.
    expect([...changedRows(fresh.next, [withState('a', 'pending')]).changed])
      .toEqual(['plot/a']);
  });

  it('marks every changed row — no threshold, no suppression', () => {
    // A move on the default branch flips many PRs to `conflicts` together. Ten
    // changes are ten marks: a rule that went quiet exactly when the most
    // changed would make the board least informative at its most eventful
    // moment.
    const before = Array.from({ length: 10 }, (_, i) => withState(`b${i}`, 'green'));
    const after = Array.from({ length: 10 }, (_, i) => withState(`b${i}`, 'conflicts'));
    expect(changedRows(observed(...before), after).changed.size).toBe(10);
  });

  it('keeps a row\'s memory when the row changes SECTION', () => {
    // The pairing the plan names: `pr.state` helps decide the group, so the
    // changes worth marking are frequently the ones that MOVE the row. A memory
    // keyed on position rather than identity loses the prior value in exactly
    // that case; keyed on `${repo}/${branch}` it survives.
    const before = row({
      branch: 'a', group: 'waiting-on-machine',
      pr: { number: 1, url: '', draft: false, state: 'pending' },
    });
    const after = row({
      branch: 'a', group: 'waiting-on-you',
      pr: { number: 1, url: '', draft: false, state: 'conflicts' },
    });
    expect([...changedRows(observed(before), [after]).changed]).toEqual(['plot/a']);
  });

  it('starts a returning row SILENT — absence erases the memory', () => {
    // A branch deleted and recreated, or a row simply missing from one pulse.
    // It has no prior value at its return, so it records rather than marks.
    const first = observed(withState('a', 'green'));
    const withoutIt = changedRows(first, [withState('other', 'green')]);
    expect(withoutIt.next.has('plot/a')).toBe(false);
    // Back, with a DIFFERENT state than it left with — still silent.
    expect(changedRows(withoutIt.next, [withState('a', 'conflicts')]).changed.size).toBe(0);
  });

  it('does not crash on the rows that carry no PR at all', () => {
    // Most rows: `not-started`, `quiet`, every fresh claim. An implementation
    // reading `row.pr.state` unguarded throws on precisely these.
    expect(() => changedRows(new Map(), [row({ pr: null })])).not.toThrow();
    expect(watchedState(row({ pr: null }))).toBe(null);
  });

  it('keys a row by repo AND branch', () => {
    // Two repos can carry the same branch name, and one board can show both.
    expect(rowKey({ repo: 'plot', branch: 'feature/x' })).toBe('plot/feature/x');
    expect(rowKey({ repo: 'other', branch: 'feature/x' }))
      .not.toBe(rowKey({ repo: 'plot', branch: 'feature/x' }));
  });
});

describe('ChangeMarks — how long each mark stays lit', () => {
  /**
   * A clock the test advances by hand.
   *
   * Driven directly rather than through the board's polls, because the restart
   * rule is invisible at the board's own rates: `FLEET_POLL_MS` is 4s and a mark
   * lives 3s, so two changes on consecutive polls never overlap and a
   * browser-level "restart" assertion passes with the restart removed.
   */
  function fakeClock() {
    let now = 0;
    const due = new Map<number, { at: number; fn: () => void }>();
    let nextId = 1;
    return {
      schedule(fn: () => void, ms: number) {
        const id = nextId++;
        due.set(id, { at: now + ms, fn });
        return () => due.delete(id);
      },
      advance(ms: number) {
        now += ms;
        for (const [id, t] of [...due].sort((a, b) => a[1].at - b[1].at)) {
          if (t.at <= now) { due.delete(id); t.fn(); }
        }
      },
    };
  }

  /** A ChangeMarks whose lit set the test can read after each step. */
  function marksOnFakeClock() {
    const clock = fakeClock();
    let lit: ReadonlySet<string> = new Set();
    const marks = new ChangeMarks((next) => { lit = next; }, clock.schedule);
    return { marks, clock, lit: () => [...lit].sort() };
  }

  it('lights a changed row, and clears it after CHANGE_MARK_MS', () => {
    const { marks, clock, lit } = marksOnFakeClock();
    marks.mark(['plot/a']);
    expect(lit()).toEqual(['plot/a']);
    // Still lit a moment before its time.
    clock.advance(CHANGE_MARK_MS - 1);
    expect(lit()).toEqual(['plot/a']);
    // And out on its OWN timer — no further pulse was needed to clear it, which
    // is what keeps a board that lost its server from sitting lit forever.
    clock.advance(1);
    expect(lit()).toEqual([]);
  });

  it('RESTARTS a lit mark on a second change rather than letting it expire', () => {
    // THE assertion this class was extracted to make. A second change arrives
    // when the first mark is two-thirds spent; if the first timer were left to
    // run, the mark would go out on the FIRST change's schedule and imply
    // nothing further had happened — the exact false statement it exists to
    // prevent.
    const { marks, clock, lit } = marksOnFakeClock();
    marks.mark(['plot/a']);
    clock.advance(2_000);
    marks.mark(['plot/a']);           // the second change, while still lit
    // Past the FIRST change's expiry, and still lit: only a restart does this.
    clock.advance(1_500);
    expect(lit()).toEqual(['plot/a']);
    // It does still go out — on the second change's schedule, not never.
    clock.advance(CHANGE_MARK_MS);
    expect(lit()).toEqual([]);
  });

  it('gives each row its own timer', () => {
    // Ten rows changing means ten marks, and one row's expiry must not take
    // another's with it.
    const { marks, clock, lit } = marksOnFakeClock();
    marks.mark(['plot/a']);
    clock.advance(2_000);
    marks.mark(['plot/b']);
    expect(lit()).toEqual(['plot/a', 'plot/b']);
    // `a` goes out on its own schedule; `b` is still only 1s old.
    clock.advance(1_000);
    expect(lit()).toEqual(['plot/b']);
    clock.advance(CHANGE_MARK_MS);
    expect(lit()).toEqual([]);
  });

  it('lights ten rows at once', () => {
    const { marks, lit } = marksOnFakeClock();
    marks.mark(Array.from({ length: 10 }, (_, i) => `plot/b${i}`));
    expect(lit()).toHaveLength(10);
  });

  it('drops every pending timer on dispose', () => {
    // Unmounting with marks lit would otherwise leave timeouts firing against a
    // gone component.
    const { marks, clock, lit } = marksOnFakeClock();
    marks.mark(['plot/a']);
    marks.dispose();
    clock.advance(CHANGE_MARK_MS * 2);
    expect(lit()).toEqual(['plot/a']);   // the last state published, never updated after dispose
  });
});

describe('CHANGE_MARK_MS — the marker outlives a glance, not the change', () => {
  it('is about three seconds, tied to neither poll interval', () => {
    // Measured, not chosen: the watched value comes from the 60s PR refresh
    // (120s under backoff), not the 4s fleet pulse, so a transition is a RARE
    // event and a 300ms flash would be missed nearly every time. It is
    // deliberately not equal to either clock — a marker cleared by the next
    // pulse would live 4s or 60s depending on which one cleared it, and would
    // stay lit forever on a board whose server died.
    expect(CHANGE_MARK_MS).toBe(3_000);
    expect(CHANGE_MARK_MS).toBeGreaterThan(1_000);
    expect(CHANGE_MARK_MS).toBeLessThan(4_000);
  });
});

describe('the change marker costs nothing outside the client', () => {
  it('leaves BOTH clocks where they are', () => {
    // Making the marker livelier by polling the host harder would spend the
    // rate limit `PR_BACKOFF_MAX_MS` exists to protect — for a signal nobody
    // asked to be sharper. Read out of the sources rather than asserted in
    // prose, so a later edit to either number fails here.
    const read = (file: string) =>
      readFileSync(new URL(file, import.meta.url), 'utf8');
    expect(read('../../src/app/App.tsx')).toContain('FLEET_POLL_MS = 4_000');
    const fleetSrc = read('../../src/server/fleet.ts');
    expect(fleetSrc).toContain('PR_REFRESH_MS = 60_000');
    expect(fleetSrc).toContain('PR_BACKOFF_MAX_MS = 120_000');
  });

  it('adds no contract field — the memory is the CLIENT\'s', () => {
    // The whole change is that the client remembers one value. Putting it in
    // the server would give it a notion of *event* where it has only ever had
    // *state*, and would grow the payload to carry it.
    const row = AgentRowSchema.parse({
      repo: 'plot', branch: 'feature/x', plan: 'p', planFile: 'f.md', wave: 'w',
      state: 'wip', phase: null, group: 'quiet', ageMinutes: 1, note: '', pr: null,
      branchUrl: '', waitingDays: null,
    });
    for (const key of Object.keys(row)) {
      expect(key).not.toMatch(/prior|previous|changed|mark|flash/i);
    }
  });
});

describe('ROW_TRACKS — where the row\'s width goes', () => {
  /** The six tracks, in order, read out of the one exported constant. */
  const tracks = () => {
    const inner = /grid-cols-\[(.+)\]/.exec(ROW_TRACKS)?.[1];
    expect(inner, `ROW_TRACKS is not a Tailwind track list: ${ROW_TRACKS}`).toBeTruthy();
    return inner!.split('_');
  };

  it('gives the PR column 14rem, taken from the branch and not from the window', () => {
    // The reported defect: at 9rem the PR cell held `⑂116 no checks` and
    // nothing wider, while the window's whole slack collected in the branch's
    // `1fr` as a gap that draws nothing.
    expect(tracks()).toEqual(['6rem', '10rem', '1fr', '14rem', '2.5rem', '1.25rem']);
  });

  it('keeps every track but the branch FIXED', () => {
    // The pairing that matters, and the reason this asserts the shape rather
    // than only the number. `minmax(9rem, auto)` on the PR cell and
    // `max-content` on the branch both make the column WIDER and both let an
    // edge move between rows — passing "the status got more space" while
    // undoing what fixed tracks are for. Exactly one track may be flexible.
    const flexible = tracks().filter((t) => !/^[\d.]+rem$/.test(t));
    expect(flexible).toEqual(['1fr']);
  });

  it('still needs less than the card breakpoint before the branch gets a pixel', () => {
    // The arithmetic `CARD_BELOW_PX` rests on, and the thing this change spent:
    // the fixed tracks went from 460px to 540px, so the grid now needs 624px of
    // the 640px breakpoint. Widening any fixed track again crosses it, and then
    // `CARD_BELOW_PX` has to move too — this fails when that day comes.
    const GAPS_AND_PADDING = 84;
    const fixedPx = tracks()
      .filter((t) => t !== '1fr')
      .reduce((sum, t) => sum + Number.parseFloat(t) * 16, 0);
    expect(fixedPx).toBe(540);
    expect(fixedPx + GAPS_AND_PADDING).toBeLessThan(CARD_BELOW_PX);
  });
});
