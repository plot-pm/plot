import { describe, it, expect } from 'vitest';
import {
  classify, compareWithinGroup, draftNote, humanAge, prState, rowPhase, rowsFromPulse,
  rateLimitBackoffMs,
  prGateOpen,
  prNextDueAt,
  prAsksNobody,
  waitingOnFor,
} from '../../src/server/fleet.js';
import {
  AgentRowSchema, DRAFT_PLAN_NOTE, ELIGIBLE_NOTE, toBoardPhase,
  type AgentRow, type FleetPulse,
} from '../../src/contract/schema.js';
import type { PrRecord } from '../../src/server/fleet.js';

// The classifier is where the tab's judgments live: which group a branch lands
// in IS the answer to "what should I do next". Tested as pure functions rather
// than through HTTP — a wrong group is a wrong answer no plumbing can fix.

const QUIET = 30;

describe('a live worker keeps its row in WORKING', () => {
  // The reported defect, measured 2026-08-17: two agents ran for a quarter of
  // an hour with WORKING empty while WAITING ON YOU showed their branches.
  // Both sections were lying, in opposite directions.
  const greenPr = { number: 9, url: '', draft: false, state: 'OPEN', checks: 'green',
    mergeable: 'mergeable', failing_checks: [] } as never;
  const conflictPr = { number: 9, url: '', draft: false, state: 'OPEN', checks: 'none',
    mergeable: 'conflicting', failing_checks: [] } as never;

  it('keeps a WIP branch in working while its worker runs', () => {
    // THE assertion. A worker's first real commit takes the branch out of
    // `claimed` and into `wip` — so the old rule, which only asked about a
    // worker inside the `claimed` arm, dropped the row at the exact moment it
    // proved it was working.
    const r = classify('wip', 'eligible', 500, 60, null, false, 0, 'approved', 'running', null, 7);
    expect(r.group).toBe('working');
    expect(r.note).toContain('pid 7');
  });

  it('lifts an OPEN branch into working when its worktree is dirty', () => {
    // The second kind of active work, and the one a dispatch worker never
    // explains: a person editing in this checkout. `open` means git has no ref
    // — which is what a branch nobody created looks like AND what a branch
    // created only locally looks like. The scan can tell them apart, and the
    // row must not say *nobody has taken it* while carrying the activity mark
    // that means *someone is writing here*.
    const r = classify('open', 'eligible', null, 60, null, true, 0, 'approved', 'none', null, 0, false);
    expect(r.group).toBe('working');
    expect(r.note).toContain('uncommitted');
  });

  it('lifts an OPEN branch into working when its worktree is LOCKED', () => {
    const r = classify('open', 'eligible', null, 60, null, false, 0, 'approved', 'none', null, 0, true);
    expect(r.group).toBe('working');
  });

  it('does NOT lift an open branch that is merely AHEAD', () => {
    // THE pairing. Unpushed commits are finished work sitting still — they earn
    // the unpushed mark, not a claim that someone is at the keyboard. An
    // implementation OR-ing all three local signals passes both assertions
    // above and puts an untouched branch in WORKING.
    const r = classify('open', 'eligible', null, 60, null, false, 3, 'approved', 'none', null, 0, false);
    expect(r.group).toBe('not-started');
  });

  it('leaves a clean open branch exactly where it was', () => {
    const r = classify('open', 'eligible', null, 60, null, false, 0, 'approved', 'none', null, 0, false);
    expect(r.group).toBe('not-started');
  });

  it('keeps a claimed branch in working while its worker runs', () => {
    // Unchanged from before — the rule moved, it did not narrow.
    const r = classify('claimed', 'eligible', 5, 60, null, false, 0, 'approved', 'running', null, 7);
    expect(r.group).toBe('working');
  });

  it('does NOT rescue a merged branch', () => {
    // A branch that landed is done whatever its worktree still holds. The arm's
    // own condition excludes it, and that is asserted rather than assumed.
    const r = classify('merged', 'complete', 5, 60, null, false, 0, 'approved', 'running', null, 7);
    expect(r.group).not.toBe('working');
  });

  it('lets a green PR pass to working while a worker runs', () => {
    // The agent opened its PR and kept working. A green PR asks nothing of
    // anybody, so the row belongs where the work is.
    const r = classify('wip', 'eligible', 5, 60, greenPr, false, 0, 'approved', 'running', null, 7);
    expect(r.group).toBe('working');
  });

  it('still hands a CONFLICTING PR to you, worker or no worker', () => {
    // THE pairing that matters. A fix that simply put the worker check first
    // passes every assertion above and takes a row that genuinely needs a
    // rebase out of the section that would have shown it.
    const r = classify('wip', 'eligible', 5, 60, conflictPr, false, 0, 'approved', 'running', null, 7);
    expect(r.group).toBe('waiting-on-you');
    expect(r.note).toContain('conflicts');
  });

  it('still hands a stopped worker to you, whatever its PR says', () => {
    for (const w of ['failed', 'finished', 'ended'] as const) {
      const r = classify('wip', 'eligible', 5, 60, greenPr, false, 0, 'approved', w, null, 7);
      expect(r.group).toBe('waiting-on-you');
    }
  });
});

describe('prAsksNobody — an allowlist, never a blocklist', () => {
  const mk = (over: Record<string, unknown>) => ({
    number: 1, url: '', draft: false, state: 'OPEN', checks: 'green',
    mergeable: 'mergeable', failing_checks: [], ...over,
  } as never);

  it('says yes only for green and pending', () => {
    expect(prAsksNobody(mk({}))).toBe(true);
    expect(prAsksNobody(mk({ checks: 'pending' }))).toBe(true);
  });

  it('says no for every state that is somebody errand', () => {
    // `conflicts` wants a rebase, `failing` a look, `none` a click, `unknown`
    // asking again. A blocklist would silently start claiming "nobody is
    // blocked" the first time a state is added — quiet, not loud.
    expect(prAsksNobody(mk({ mergeable: 'conflicting' }))).toBe(false);
    expect(prAsksNobody(mk({ checks: 'failing' }))).toBe(false);
    expect(prAsksNobody(mk({ checks: 'none' }))).toBe(false);
    expect(prAsksNobody(mk({ mergeable: 'unknown' }))).toBe(false);
  });

  it('treats a draft as asking nobody — it is still the agent own', () => {
    expect(prAsksNobody(mk({ draft: true, checks: 'none' }))).toBe(true);
  });
});

describe('waitingOnFor — what a NOT STARTED row is waiting for', () => {
  it('answers null for every row outside not-started', () => {
    // The question does not arise there. A row being worked on, or waiting on
    // CI, is not waiting for one of these three things — and null is what stops
    // the colour rendering anywhere but the one section it belongs to.
    for (const g of ['working', 'waiting-on-you', 'waiting-on-machine', 'quiet', 'done'] as const) {
      expect(waitingOnFor(g, 'open', 'eligible', 'approved')).toBe(null);
    }
  });

  it('reads an eligible branch of an approved plan as a click', () => {
    expect(waitingOnFor('not-started', 'open', 'eligible', 'approved')).toBe('click');
  });

  it('reads a Draft plan FIRST wave as waiting on you', () => {
    expect(waitingOnFor('not-started', 'open', 'eligible', 'draft')).toBe('you');
  });

  it('reads a Draft plan LATER wave as waiting on time, not on you', () => {
    // THE assertion the plan singles out. A Draft plan holds every one of its
    // branches, and this repo's plans routinely have four waves — colouring
    // each would put four loud rows on the board for ONE pending approval, and
    // the later three would still be blocked the instant after it was granted.
    //
    // It comes out right because the wave verdict is tested BEFORE the phase.
    // An implementation checking the phase first passes every other assertion
    // here and gets exactly this one wrong.
    expect(waitingOnFor('not-started', 'open', 'blocked', 'draft')).toBe('time');
  });

  it('reads a blocked wave of an approved plan as waiting on time', () => {
    expect(waitingOnFor('not-started', 'open', 'blocked', 'approved')).toBe('time');
  });

  it('reads a deferred branch as waiting on you, whatever the verdict', () => {
    // Deferred joins Draft: both wait on a PERSON with no clock running. They
    // differ in which action — approve versus un-shelve — and the note beside
    // the colour already says which.
    expect(waitingOnFor('not-started', 'deferred', 'eligible', 'approved')).toBe('you');
    expect(waitingOnFor('not-started', 'deferred', 'blocked', 'draft')).toBe('you');
  });

  it('answers null for a state that is neither open nor deferred', () => {
    // `wip`, `claimed`, `merged` do not reach not-started through the open arm,
    // and a value here would colour a row whose sentence says something else.
    for (const s of ['wip', 'claimed', 'merged'] as const) {
      expect(waitingOnFor('not-started', s, 'eligible', 'approved')).toBe(null);
    }
  });
});

describe('classify', () => {
  it('puts an unclaimed branch of an eligible wave in not-started', () => {
    const r = classify('open', 'eligible', null, QUIET);
    expect(r.group).toBe('not-started');
    expect(r.note).toMatch(/nobody has taken it/);
  });

  it('distinguishes blocked-and-unstarted from eligible-and-unstarted', () => {
    // Both are "not started", but only one is actionable now. Showing them
    // identically would invite dispatching work whose seam has not landed.
    const eligible = classify('open', 'eligible', null, QUIET);
    const blocked = classify('open', 'blocked', null, QUIET);
    expect(eligible.group).toBe(blocked.group);
    expect(eligible.note).not.toBe(blocked.note);
    expect(blocked.note).toMatch(/earlier wave/);
  });

  // A claim with no progress is either a worker still thinking or a dead one,
  // and this used to send BOTH to `quiet` on the grounds that only a human can
  // tell them apart. Watching a real dispatch disproved the premise: for the
  // first minutes every healthy agent looks exactly like this — it is reading
  // the plan — so `quiet`, which means "go check whether it died", was being
  // said about the normal opening of every dispatch. Age separates them, and
  // the age is known because a claim IS a commit.
  //
  // The NOTE these two once asserted — "no commits yet" — is gone, and its
  // removal is the point of `fleet-sees-unstarted-claims`: it said one thing
  // about two states, an idle branch and a claim nobody ever started a worker
  // on. What they assert now is the GROUP, which is what they were always
  // about; the sentence beside it is pinned by the worker tests below.
  it('calls a fresh claim working — it is the normal start of a dispatch', () => {
    const r = classify('claimed', 'eligible', 3, QUIET);
    expect(r.group).toBe('working');
    expect(r.note).toMatch(/claimed/);
  });

  it('calls a claim that stayed silent past the quiet window quiet', () => {
    const r = classify('claimed', 'eligible', QUIET + 1, QUIET);
    expect(r.group).toBe('quiet');
    expect(r.note).toMatch(/claimed 31 min ago/);
  });

  // Without an age there is nothing to judge, and guessing `working` would
  // assert liveness the data does not support.
  it('falls back to quiet when a claim has no age', () => {
    expect(classify('claimed', 'eligible', null, QUIET).group).toBe('quiet');
  });

  it('calls a recent commit working and a stale one quiet', () => {
    expect(classify('wip', 'eligible', 5, QUIET).group).toBe('working');
    expect(classify('wip', 'eligible', 200, QUIET).group).toBe('quiet');
  });

  it('respects the configured quiet window rather than a hard-coded 30', () => {
    // The default is a guess; a repo whose agents think for an hour raises it.
    expect(classify('wip', 'eligible', 45, 30).group).toBe('quiet');
    expect(classify('wip', 'eligible', 45, 60).group).toBe('working');
  });

  it('does not claim a branch is working when its age is unknown', () => {
    // Unknown must not read as fresh — that shows a dead worker as busy.
    const r = classify('wip', 'eligible', null, QUIET);
    expect(r.group).toBe('quiet');
    expect(r.note).toMatch(/unknown/);
  });

  it('keeps a deferred branch out of the working group', () => {
    // `not-started` is about the CLAIM the row makes — nobody is working on
    // this — rather than about the age of its last commit. Work somebody gave
    // up is not work in progress.
    const r = classify('deferred', 'eligible', null, QUIET);
    expect(r.group).toBe('not-started');
  });

  it('does not let the word `deferred` displace the note', () => {
    // The old answer was `{ group: 'not-started', note: 'deferred' }`,
    // unconditionally — so a branch that was started and then shelved read as
    // never begun, with its age erased. The fact is carried by `state` beside
    // the note; the note keeps its own.
    const shelved = classify('deferred', 'eligible', 4_320, QUIET);
    expect(shelved.note).not.toBe('deferred');
    expect(shelved.note).toMatch(/3 days/);
    // And a branch with genuinely nothing on it still says so.
    expect(classify('deferred', 'eligible', null, QUIET).note).toMatch(/no commits/);
  });

  it('never reads WORKING for a deferred branch, however fresh the commit', () => {
    // The one place intent outranks git. WORKING means an agent is working on
    // this RIGHT NOW, which is false for work someone gave up even if the last
    // commit is minutes old.
    expect(classify('deferred', 'eligible', 1, QUIET).group).toBe('not-started');
    // Not even with a dirty local worktree, which lifts every other state.
    expect(classify('deferred', 'eligible', 1, QUIET, null, true).group).toBe('not-started');
  });

  it('puts merged work in done, not in quiet', () => {
    // Found by looking at the rendered tab: "go check whether it died" is the
    // wrong prompt for a branch that landed. Quiet asks a question; done does
    // not. A real mis-answer, not a cosmetic one.
    expect(classify('merged', 'complete', 1, QUIET).group).toBe('done');
    expect(classify('merged', 'eligible', 1, QUIET).group).toBe('done');
    expect(classify('merged', 'complete', 1, QUIET).note).toBe('merged');
    expect(classify('merged', 'eligible', 1, QUIET).note).toMatch(/wave still open/);
  });

  // --- a worktree with uncommitted work is not quiet ------------------------
  //
  // The classifier's only new input, and it may do exactly one thing: LIFT a
  // branch out of quiet. Everything about these tests is about keeping it that
  // narrow — a signal true only on the machine doing the looking may add an
  // answer where this machine knows more, never downgrade one.

  it('lifts a stale CLAIM out of quiet when its local worktree is dirty', () => {
    // The motivating case. A branch claimed a day earlier and resumed today has
    // a 21-hour-old claim commit and minutes-old work, so the refs say quiet and
    // the worktree says otherwise. QUIET carries an instruction — go check
    // whether it died — and following it found a live agent with three modified
    // files.
    const r = classify('claimed', 'eligible', QUIET + 1, QUIET, null, true);
    expect(r.group).toBe('working');
    // The note names the evidence as LOCAL, because that is what a reader needs
    // to judge it: work nobody else can see, claimed on grounds the next person
    // cannot verify. Saying `local` keeps the claim honest.
    expect(r.note).toMatch(/local/);
    expect(r.note).toMatch(/uncommitted/);
  });

  it('lifts a stale WIP branch too, not only a claim', () => {
    // All six quiet rows on the board the day this was found were `wip` with
    // 22-day-old commits, not `claimed`. A dirty worktree means the same thing
    // whatever put the branch there, and a test for only the motivating state
    // leaves the common one to chance.
    const r = classify('wip', 'eligible', 30_300, QUIET, null, true);
    expect(r.group).toBe('working');
    expect(r.note).toMatch(/local/);
  });

  it('lifts a claim whose age is unknown — no age, but there IS evidence', () => {
    // Without an age the claim arm falls to quiet because there is nothing to
    // judge. A dirty worktree is something to judge.
    expect(classify('claimed', 'eligible', null, QUIET, null, true).group).toBe('working');
    expect(classify('wip', 'eligible', null, QUIET, null, true).group).toBe('working');
  });

  it('changes nothing for a CLEAN worktree', () => {
    // A clean tree is equally consistent with an agent that finished and one
    // that never started, so it is not evidence of work and must lift nothing.
    // `false` is also what every branch on another machine reports, which makes
    // this the assertion that keeps the change additive.
    expect(classify('claimed', 'eligible', QUIET + 1, QUIET, null, false).group).toBe('quiet');
    expect(classify('wip', 'eligible', 200, QUIET, null, false).group).toBe('quiet');
    expect(classify('wip', 'eligible', null, QUIET, null, false).group).toBe('quiet');
  });

  it('answers identically whether the field is false or simply not passed', () => {
    // The absent case, pinned against the false one. Every caller predating the
    // field passes nothing, and "this machine has no worktree" must not become a
    // different answer from "this machine did not say".
    for (const args of [
      ['claimed', 'eligible', QUIET + 1],
      ['wip', 'eligible', 200],
      ['wip', 'eligible', 5],
      ['open', 'eligible', null],
      ['merged', 'complete', 1],
      ['deferred', 'eligible', null],
    ] as const) {
      const [state, verdict, age] = args;
      expect(classify(state, verdict, age, QUIET, null, false))
        .toEqual(classify(state, verdict, age, QUIET));
    }
  });

  it('never DOWNGRADES a group, only lifts one out of quiet', () => {
    // The one-directional rule, asserted on the groups that are not quiet. A
    // dirty worktree on a merged branch is somebody editing after the merge —
    // true, and not a reason to unsay `done`. Same for not-started and for the
    // groups a PR decides.
    expect(classify('merged', 'complete', 1, QUIET, null, true).group).toBe('done');
    expect(classify('deferred', 'eligible', null, QUIET, null, true).group).toBe('not-started');
    // `open` is NOT in this list, and its absence is the rule being stated
    // precisely rather than loosely. `not-started` → `working` is not a
    // DOWNGRADE — it is the lift this test's own name allows. An `open` branch
    // with a dirty worktree was created locally and is being edited: git has no
    // ref for it, which looks identical to a branch nobody ever made. The row
    // used to say *nobody has taken it* while carrying the activity mark that
    // means *someone is writing here* — one row, two contradictory statements.
    //
    // `merged` and `deferred` stay: unsaying `done` after a merge would be a
    // real downgrade, and a shelved branch is a decision rather than a state.
    expect(classify('open', 'eligible', null, QUIET, null, true).group).toBe('working');
    // A branch already reading `working` keeps the note it had: a recent commit
    // is the stronger statement, and replacing it with "uncommitted work" would
    // hide the age the reader came for.
    const fresh = classify('wip', 'eligible', 5, QUIET, null, true);
    expect(fresh.group).toBe('working');
    expect(fresh.note).toMatch(/last commit/);
  });

  // --- unpushed commits are not "no commits yet" -----------------------------
  //
  // The half `local_dirty` cannot answer, by construction: dirtiness reports
  // *someone is editing*, and committing clears it. The moment a worker finishes
  // tidily the signal covering for it disappears — and that is exactly when the
  // work is most complete, least backed up, and least visible.
  //
  // Same one-directional rule, and these tests are what hold it.

  it('lifts a CLAIM holding unpushed commits, with a CLEAN worktree', () => {
    // The exact case that produced this plan, and `localDirty` is asserted FALSE
    // on purpose: with it true the shipped signal does the lifting and the test
    // proves nothing about the new one.
    const r = classify('claimed', 'eligible', QUIET + 1, QUIET, null, false, 3);
    expect(r.group).toBe('working');
    // The note says how many, and names the evidence as local — work nobody else
    // can see, claimed on grounds the next person cannot verify.
    expect(r.note).toMatch(/3 commits not pushed/);
    expect(r.note).toMatch(/local/);
    // And it is a COUNT, never an age: "2 commits not pushed" names an action,
    // which no timestamp can.
    expect(r.note).not.toMatch(/ago/);
  });

  it('lifts a stale WIP branch on unpushed commits too', () => {
    const r = classify('wip', 'eligible', 30_300, QUIET, null, false, 1);
    expect(r.group).toBe('working');
    // Singular, because a note that reads "1 commits" is the kind of thing a
    // reader stops trusting.
    expect(r.note).toMatch(/1 commit not pushed/);
  });

  it('lifts a claim whose age is unknown — no age, but there IS evidence', () => {
    expect(classify('claimed', 'eligible', null, QUIET, null, false, 2).group).toBe('working');
    expect(classify('wip', 'eligible', null, QUIET, null, false, 2).group).toBe('working');
  });

  it('says BOTH facts when a branch is dirty AND ahead, unpushed first', () => {
    // They are different facts and the pair changes the advice: *push this*
    // versus *push this, and someone is still working*. Suppressing a true fact
    // because a second outranks it is the displacement `deferred` used to cause
    // to the note text.
    const r = classify('wip', 'eligible', 30_300, QUIET, null, true, 2);
    expect(r.group).toBe('working');
    expect(r.note).toMatch(/2 commits not pushed/);
    expect(r.note).toMatch(/uncommitted/);
    // Unpushed first: finished work nobody can see is the more urgent half.
    expect(r.note.indexOf('not pushed')).toBeLessThan(r.note.indexOf('uncommitted'));
  });

  it('leaves the DIRTY-ONLY note exactly as it shipped', () => {
    // A branch whose only local evidence is uncommitted edits must read today
    // what it read yesterday. Rewording it to match the new pair would have
    // changed every existing dirty row for a branch about the other case.
    const r = classify('wip', 'eligible', 30_300, QUIET, null, true, 0);
    expect(r.note).toBe('uncommitted work in a local worktree');
  });

  it('changes nothing at zero ahead', () => {
    // Zero is what every branch on a machine with no local ref reports — every
    // detached worker, every teammate's laptop, every CI run — so it is the
    // assertion that keeps the change additive.
    expect(classify('claimed', 'eligible', QUIET + 1, QUIET, null, false, 0).group).toBe('quiet');
    expect(classify('wip', 'eligible', 200, QUIET, null, false, 0).group).toBe('quiet');
    expect(classify('wip', 'eligible', null, QUIET, null, false, 0).group).toBe('quiet');
  });

  it('answers identically whether local_ahead is 0 or simply not passed', () => {
    // The absent case pinned against the zero one, exactly as `local_dirty` is.
    for (const args of [
      ['claimed', 'eligible', QUIET + 1],
      ['wip', 'eligible', 200],
      ['wip', 'eligible', 5],
      ['open', 'eligible', null],
      ['merged', 'complete', 1],
      ['deferred', 'eligible', null],
    ] as const) {
      const [state, verdict, age] = args;
      expect(classify(state, verdict, age, QUIET, null, false, 0))
        .toEqual(classify(state, verdict, age, QUIET, null, false));
    }
  });

  it('never DOWNGRADES a group on unpushed commits either', () => {
    // The one-directional rule for the new signal. Unpushed commits on a merged
    // branch are a follow-up somebody has not pushed — true, and not a reason to
    // unsay `done`.
    expect(classify('merged', 'complete', 1, QUIET, null, false, 4).group).toBe('done');
    expect(classify('open', 'eligible', null, QUIET, null, false, 4).group).toBe('not-started');
    expect(classify('deferred', 'eligible', null, QUIET, null, false, 4).group)
      .toBe('not-started');
    // A branch already reading `working` on a fresh commit keeps the age note:
    // the age is what the reader came for.
    const fresh = classify('wip', 'eligible', 5, QUIET, null, false, 4);
    expect(fresh.group).toBe('working');
    expect(fresh.note).toMatch(/last commit/);
  });

  // --- a locked worktree is a write happening RIGHT NOW ----------------------
  //
  // The THIRD local signal, and it answers a third question. `local_dirty` says
  // *someone is editing*; `local_ahead` says *finished work nobody else can
  // see*; `local_locked` says *a write is in progress at this instant*.
  // Collapsing any pair of them repeats the one-label-two-states defect this
  // story keeps finding.
  //
  // It is the most informative state a worktree can be in and was the one the
  // board could not see: the scan skipped a locked worktree in silence, so the
  // branch answered from refs and the row read *claimed, no commits yet* while
  // an agent was committing to it.
  //
  // Same one-directional rule as its two neighbours, and these tests hold it.

  const LOCKED = [null, false, 0, '', 'elsewhere', '', '', true] as const;

  it('lifts a quiet CLAIM on a lock alone', () => {
    // The motivating row. Everything else is asserted absent — a clean worktree,
    // nothing unpushed, a claim older than the quiet window — so the lock is
    // doing the lifting and nothing is covering for it.
    const r = classify('claimed', 'eligible', QUIET + 1, QUIET, ...LOCKED);
    expect(r.group).toBe('working');
    expect(r.note).toMatch(/write is in progress/);
    // Named as LOCAL, like every other signal only this machine can see.
    expect(r.note).toMatch(/local/);
  });

  it('lifts a stale WIP branch on a lock too', () => {
    const r = classify('wip', 'eligible', 30_300, QUIET, ...LOCKED);
    expect(r.group).toBe('working');
    expect(r.note).toMatch(/write is in progress/);
  });

  it('lifts a branch whose age is unknown', () => {
    expect(classify('claimed', 'eligible', null, QUIET, ...LOCKED).group).toBe('working');
    expect(classify('wip', 'eligible', null, QUIET, ...LOCKED).group).toBe('working');
  });

  it('says the LOCK alone, not the other two facts beside it', () => {
    // A lock outranks both and does not append them. Under a lock the worktree
    // is mid-write, and the reader is being told to WAIT — where "2 commits not
    // pushed" tells them to act. Saying both would give one row two opposite
    // instructions.
    const r = classify('wip', 'eligible', 30_300, QUIET, null, true, 2,
      '', 'elsewhere', '', '', true);
    expect(r.group).toBe('working');
    expect(r.note).toMatch(/write is in progress/);
    expect(r.note).not.toMatch(/not pushed/);
    expect(r.note).not.toMatch(/uncommitted/);
  });

  it('never DOWNGRADES a group on a lock', () => {
    // The one-directional rule, and the assertion the plan names explicitly. A
    // lock is observable only on the machine doing the looking, so it may add an
    // answer and never take one away.
    expect(classify('merged', 'complete', 1, QUIET, ...LOCKED).group).toBe('done');
    expect(classify('deferred', 'eligible', null, QUIET, ...LOCKED).group).toBe('not-started');
    // Same correction as the dirty case above: a lock on an `open` branch is
    // somebody writing to it right now, and lifting is not downgrading.
    expect(classify('open', 'eligible', null, QUIET, ...LOCKED).group).toBe('working');
    // A branch already reading `working` on a fresh commit keeps the age note:
    // the age is what the reader came for.
    const fresh = classify('wip', 'eligible', 5, QUIET, ...LOCKED);
    expect(fresh.group).toBe('working');
    expect(fresh.note).toMatch(/last commit/);
  });

  it('never downgrades a branch whose PR already answers', () => {
    // The plan's own wording — *assert against a branch whose PR already
    // answers*. A PR outranks every local signal: once work is up for review,
    // what it waits for is decided there, and a lock in some worktree must not
    // overwrite that sentence.
    const pr = {
      number: 42, head: 'feature/x', state: 'OPEN', draft: false,
      checks: 'pending' as const, mergeable: 'mergeable', review: '', url: '',
    };
    const r = classify('wip', 'eligible', 30_300, QUIET, pr, false, 0,
      '', 'elsewhere', '', '', true);
    expect(r.group).toBe('waiting-on-machine');
    expect(r.note).toMatch(/PR #42/);
    expect(r.note).not.toMatch(/write is in progress/);
  });

  it('changes nothing when false', () => {
    // False is what every branch on a machine with no worktree reports — every
    // detached worker, every teammate's laptop, every CI run — so this is the
    // assertion that keeps the change additive.
    expect(classify('claimed', 'eligible', QUIET + 1, QUIET, null, false, 0,
      '', 'elsewhere', '', '', false).group).toBe('quiet');
    expect(classify('wip', 'eligible', 200, QUIET, null, false, 0,
      '', 'elsewhere', '', '', false).group).toBe('quiet');
  });

  it('answers identically whether local_locked is false or simply not passed', () => {
    // The absent case pinned against the false one, exactly as `local_dirty` and
    // `local_ahead` are. Without it, a caller predating the field could drift.
    for (const args of [
      ['claimed', 'eligible', QUIET + 1],
      ['wip', 'eligible', 200],
      ['wip', 'eligible', 5],
      ['open', 'eligible', null],
      ['merged', 'complete', 1],
      ['deferred', 'eligible', null],
    ] as const) {
      const [state, verdict, age] = args;
      expect(classify(state, verdict, age, QUIET, null, false, 0, '', 'elsewhere', '', '', false))
        .toEqual(classify(state, verdict, age, QUIET, null, false));
    }
  });

  // --- a DRAFT plan's branches are not eligible -----------------------------
  //
  // The second half of the vocabulary gap. `blocked by an earlier wave` covers
  // the WITHIN-plan case; a plan that has not been approved at all had no
  // counterpart, so an accurate scan produced an inaccurate row.
  //
  // Seen live twice on 2026-08-16: a plan drafted minutes earlier, its plan PR
  // still in CI, its branches immediately under NOT STARTED reading `eligible —
  // nobody has taken it`. `plot-dispatch` would refuse every one of them.
  //
  // This is the half an implementation reading only GIT state misses entirely:
  // a drafted plan's branches are `open` with no ref, bit-identical to a branch
  // of an approved plan nobody has started. Only the plan's phase separates
  // them, which is why these tests pass a phase and the ones above do not.

  it('does not call a DRAFT plan\'s branch eligible', () => {
    // The motivating case. Same git state as a genuinely free branch — `open`,
    // no ref, an eligible wave — and the plan's phase is the only thing that
    // differs.
    const r = classify('open', 'eligible', null, QUIET, null, false, 0, 'draft');
    expect(r.note).not.toBe(ELIGIBLE_NOTE);
    expect(r.note).not.toMatch(/nobody has taken it/);
  });

  it('gives a drafted branch a DIFFERENT note from a genuinely free one', () => {
    // The assertion the live board failed: the two rendered identically while
    // one waited on a review and the other on a person. Identical git state,
    // and the notes must still differ — a test that only checks the drafted row
    // in isolation passes against an implementation that changed both.
    const drafted = classify('open', 'eligible', null, QUIET, null, false, 0, 'draft');
    const free = classify('open', 'eligible', null, QUIET, null, false, 0, 'approved');
    expect(free.note).toBe(ELIGIBLE_NOTE);
    expect(drafted.note).not.toBe(free.note);
  });

  it('names the review rather than merely saying blocked', () => {
    // *Blocked* alone invites the next question, and the answer here is not
    // another branch — it is a review that has not finished. Naming it also says
    // what would unblock the row.
    const r = classify('open', 'eligible', null, QUIET, null, false, 0, 'draft');
    expect(r.note).toBe(DRAFT_PLAN_NOTE);
    expect(r.note).toMatch(/approved|review/);
  });

  it('keeps a drafted branch in not-started rather than moving it', () => {
    // The group is still exactly right — nobody has taken it, and nobody
    // should. Moving the row elsewhere would hide work that is genuinely
    // coming, which is the opposite of what the tab is for. So the phase
    // narrows the NOTE and nothing else.
    expect(classify('open', 'eligible', null, QUIET, null, false, 0, 'draft').group)
      .toBe('not-started');
  });

  it('lets an earlier wave keep the first word on a drafted plan', () => {
    // Both statements are true of a Draft plan's later waves, and the wave one
    // is more specific: it names a branch that must land, where the draft note
    // names a review. Saying the weaker of two true things is how a note stops
    // being worth reading.
    const r = classify('open', 'blocked', null, QUIET, null, false, 0, 'draft');
    expect(r.note).toMatch(/earlier wave/);
  });

  it('narrows nothing for any phase but draft', () => {
    // Only the literal `draft` may change an answer. Every other phase — and
    // the empty string an older pulse sends — must read exactly as before,
    // which is what keeps this additive.
    for (const phase of ['approved', 'delivered', 'released', 'rejected', 'weird', '']) {
      expect(classify('open', 'eligible', null, QUIET, null, false, 0, phase).note)
        .toBe(ELIGIBLE_NOTE);
    }
  });

  it('answers identically whether the phase is "" or simply not passed', () => {
    // The absent case pinned against the empty one, exactly as `local_dirty`
    // and `local_ahead` are. Every caller predating the field passes nothing,
    // and "no phase reported" must not become a different answer from "the
    // caller did not say".
    for (const args of [
      ['open', 'eligible', null],
      ['open', 'blocked', null],
      ['claimed', 'eligible', QUIET + 1],
      ['wip', 'eligible', 200],
      ['merged', 'complete', 1],
      ['deferred', 'eligible', null],
    ] as const) {
      const [state, verdict, age] = args;
      expect(classify(state, verdict, age, QUIET, null, false, 0, ''))
        .toEqual(classify(state, verdict, age, QUIET, null, false, 0));
    }
  });

  it('changes no state but `open` on a draft plan', () => {
    // A drafted plan whose branches already carry work is drift worth SEEING,
    // not smoothing over — the same rule `rowPhase` follows where a plan's
    // bookkeeping lags its git state. The phase may only answer for a branch
    // that does not exist yet.
    for (const args of [
      ['claimed', 'eligible', QUIET + 1],
      ['wip', 'eligible', 5],
      ['wip', 'eligible', 200],
      ['merged', 'complete', 1],
      ['deferred', 'eligible', null],
    ] as const) {
      const [state, verdict, age] = args;
      expect(classify(state, verdict, age, QUIET, null, false, 0, 'draft'))
        .toEqual(classify(state, verdict, age, QUIET, null, false, 0, 'approved'));
    }
  });

  it('leaves a PR to answer even when commits are unpushed', () => {
    // A branch with an open PR still answers about its PR — the group a PR
    // decides is not quiet, and there is nothing to lift.
    const pr = {
      number: 42, head: 'feature/x', state: 'OPEN', draft: false,
      checks: 'pending', mergeable: 'mergeable', review: '', url: '',
    };
    expect(classify('wip', 'eligible', 200, QUIET, pr, false, 4).group)
      .toBe('waiting-on-machine');
  });

  it('leaves a PR to answer even when the worktree is dirty', () => {
    // Once work is up for review, what it waits for is decided there. A dirty
    // worktree on a branch whose CI is running does not move it out of
    // waiting-on-machine — that group is not quiet, and there is nothing to
    // lift.
    const pr = {
      number: 42, head: 'feature/x', state: 'OPEN', draft: false,
      checks: 'pending', mergeable: 'mergeable', review: '', url: '',
    };
    expect(classify('wip', 'eligible', 200, QUIET, pr, true).group)
      .toBe('waiting-on-machine');
  });

  it('scales the age unit so a note never reads "30300 min"', () => {
    // Also found on screen. Minutes are right for the first hour and become
    // arithmetic the reader has to do after that.
    expect(humanAge(45)).toBe('45 min');
    expect(humanAge(60)).toBe('1 hour');
    expect(humanAge(150)).toBe('2 hours');
    expect(humanAge(1440)).toBe('1 day');
    expect(humanAge(30300)).toBe('21 days');
    expect(classify('wip', 'eligible', 30300, QUIET).note).toMatch(/21 days/);
  });
});

describe('rowPhase — derived from the PAIR, never from the plan file alone', () => {
  // The whole reason this function exists rather than a field carried straight
  // through: reading the plan file alone produces rows that contradict
  // themselves, and the repo had the example sitting in it.

  it('walks a same-branch plan Discovery → Design → Development as its plan moves', () => {
    // `board-ui-polish` is the case that made this concrete: its plan was
    // written, interrogated and approved ON the branch an agent then built on,
    // so one row passed through all three phases in sequence and the tab showed
    // the same thing for every one of them.
    expect(rowPhase('draft', 'wip')).toBe('Discovery');
    expect(rowPhase('approved', 'claimed')).toBe('Design');
    expect(rowPhase('approved', 'wip')).toBe('Development');
  });

  it('lets git win over a stale plan file — the opus5 shape, asserted directly', () => {
    // `opus5-longhorizon-hardening`: Phase: Approved, ZERO Started: records,
    // real commits on six of its branches. The board card says Design and the
    // pulse says `in progress`; a row cannot say both. This is the assertion
    // that fails if someone later simplifies the derivation to read the plan
    // file alone — that version returns Design here.
    expect(rowPhase('approved', 'wip')).toBe('Development');
    // Merged counts too: work that LANDED is a stronger statement than a commit.
    expect(rowPhase('approved', 'merged')).toBe('Development');
  });

  it('does not call an empty claim a start', () => {
    // A claim marker is a dispatcher taking the branch, not an agent having
    // built anything. The plan is still at the end of Design — which is exactly
    // what makes Design mean something rather than "we have not looked".
    expect(rowPhase('approved', 'claimed')).toBe('Design');
    expect(rowPhase('approved', 'open')).toBe('Design');
  });

  it('keeps a delivered plan at Endgame when a late commit lands', () => {
    // "git wins" is about an ABSENT record, not about overruling a recorded
    // decision. A missing `Started:` line is nobody having written something
    // down; a commit after delivery contradicts something a human wrote, and a
    // follow-up fix does not repeal it.
    //
    // Load-bearing: the SYMMETRIC implementation — git evidence overriding the
    // plan in both directions — passes every other test in this file and fails
    // only here. Without it, a plan goes visibly backwards for a typo fix.
    expect(rowPhase('delivered', 'wip')).toBe('Endgame');
    expect(rowPhase('delivered', 'merged')).toBe('Endgame');
    expect(rowPhase('released', 'wip')).toBe('Released');
  });

  it('sends a deferred branch BACK a phase, not forward and not nowhere', () => {
    // `deferred` is not "paused, resuming later": the vocabulary says the
    // branch isn't needed and was given up deliberately, and /plot-deliver
    // skips deferred branches in its completeness gate. So the row returns to
    // where it is decided whether the branch is wanted at all.
    //
    // A branch with real commits under an approved plan therefore reads Design,
    // NOT Development — nobody is working on it. Bare Design would be
    // indistinguishable from never-started, which is what the `deferred` badge
    // (rendered from `state`) exists to say; both halves are needed and each
    // alone is the wrong answer.
    expect(rowPhase('approved', 'deferred')).toBe('Design');
    expect(rowPhase('draft', 'deferred')).toBe('Discovery');
  });

  it('leaves a deferred branch alone once the plan is past deciding', () => {
    expect(rowPhase('delivered', 'deferred')).toBe('Endgame');
    expect(rowPhase('released', 'deferred')).toBe('Released');
  });

  it('names no phase where none is honest', () => {
    // rejected / superseded / a pulse from a scan too old to report one. An
    // empty cell beats a guessed column.
    expect(rowPhase('rejected', 'wip')).toBeNull();
    expect(rowPhase('', 'wip')).toBeNull();
  });

  it('calls toBoardPhase rather than restating the mapping', () => {
    // A second copy is how the two views drift apart, and the board's column
    // and the row's word are the same claim about the same plan. Asserted as an
    // agreement rather than by inspection: every phase word rowPhase can
    // produce must be one toBoardPhase produced for the same inputs.
    for (const p of ['draft', 'approved', 'delivered', 'released', 'rejected', '']) {
      // The un-started half: no branch, an empty claim, or work handed back.
      for (const state of ['open', 'claimed', 'deferred'] as const) {
        expect(rowPhase(p, state)).toBe(toBoardPhase(p, false));
      }
      // And the started half, which git alone decides.
      for (const state of ['wip', 'merged'] as const) {
        expect(rowPhase(p, state)).toBe(toBoardPhase(p, true));
      }
    }
  });
});

// --- a claim is not a worker -------------------------------------------------
//
// On 2026-08-17 three rows sat in WORKING with a pulsing green dot while nobody
// was working on any of them. The claim was real — a dispatcher pushed it — and
// the worker was never started. `worker_state()` in plot-dispatch.sh had
// distinguished five outcomes since the day it was written, and `grep -rn
// "plot-worker.pid" packages/board/src` returned NOTHING: the information was
// already richer than the row assumed and reached no screen.
//
// Read docs/plans/2026-08-17-dispatch-hands-over-work.md before changing any of
// these. Each one exists because a weaker implementation passes without it.
describe('classify — whether a worker is actually running', () => {
  it('keeps failed and finished apart: their actions are opposite', () => {
    // THE assertion of this change. One label over both — "ended", "stopped",
    // anything — sends the reader to a log to find out which, and the two moves
    // are restart versus review. That is the same one-label-two-states shape as
    // `no commits yet` covering both an idle branch and a finished one.
    const failed = classify('claimed', 'eligible', 3, QUIET, null, false, 0, '', 'failed', '1');
    const finished = classify('claimed', 'eligible', 3, QUIET, null, false, 0, '', 'finished', '0');
    expect(failed.note).not.toBe(finished.note);
    expect(failed.note).toMatch(/failed/);
    expect(finished.note).toMatch(/finished/);
  });

  it('sends a failed worker to waiting-on-you, not working', () => {
    // A crashed worker with a pulsing dot is the exact misreport this exists to
    // remove. Its age says `working` — three minutes into a 30-minute window —
    // and only the exit code says otherwise, which is why the age is set to the
    // value that would otherwise win.
    const r = classify('claimed', 'eligible', 3, QUIET, null, false, 0, '', 'failed', '1');
    expect(r.group).toBe('waiting-on-you');
  });

  it('names the exit code, so the row says HOW it died', () => {
    const r = classify('wip', 'eligible', 3, QUIET, null, false, 0, '', 'failed', '137');
    expect(r.note).toMatch(/137/);
  });

  it('sends a finished worker to waiting-on-you — it needs reviewing', () => {
    const r = classify('claimed', 'eligible', 3, QUIET, null, false, 0, '', 'finished', '0');
    expect(r.group).toBe('waiting-on-you');
  });

  it('says `ended` means the status was NOT recorded, never that it succeeded', () => {
    // Guessing `finished` from an absent exit file is the same mistake in the
    // other direction, and `finished` is the one answer that tells a reader to
    // stop looking.
    const r = classify('claimed', 'eligible', 3, QUIET, null, false, 0, '', 'ended', '');
    expect(r.group).toBe('waiting-on-you');
    expect(r.note).toMatch(/unknown/);
    expect(r.note).not.toMatch(/finished/);
  });

  it('still reads a claim WITH a running worker as working', () => {
    // The regression that matters most: a check that reads every claim as
    // unstarted is indistinguishable from a broken fleet. Asserted past the
    // quiet window, where the age alone would say `quiet` — so this pins the
    // worker LIFTING the row rather than merely failing to sink it.
    const r = classify('claimed', 'eligible', QUIET + 500, QUIET, null, false, 0, '', 'running', '', '4242');
    expect(r.group).toBe('working');
    expect(r.note).toMatch(/4242/);
  });

  it('never reads a pid of 0 as running — the value survives, it is not re-derived', () => {
    // `kill -0 0` signals the whole process GROUP and succeeds, so a naive
    // liveness check reports pid 0 alive forever. The scan rejects it and
    // reports `none`, so `running` can never arrive here carrying a 0 — and
    // this side must not re-derive liveness from the pid it is handed.
    //
    // Asserted from the direction that can actually fail: a `none` verdict
    // carrying the rejected pid must NOT be talked back into running.
    const r = classify('claimed', 'eligible', 3, QUIET, null, false, 0, '', 'none', '', '0');
    expect(r.group).toBe('working'); // the fresh-claim group, unchanged
    expect(r.note).not.toMatch(/running/);
    expect(r.note).toMatch(/no known worker/);
  });

  it('says `claimed elsewhere` when there is nowhere on this machine to look', () => {
    // A THIRD state, not a flavour of the second. The pid lives in the worktree,
    // so a branch claimed and started on another machine has no path to check —
    // and the two errands differ: look in this checkout versus ask the machine
    // that took it.
    const here = classify('claimed', 'eligible', 3, QUIET, null, false, 0, '', 'none');
    const away = classify('claimed', 'eligible', 3, QUIET, null, false, 0, '', 'elsewhere');
    expect(away.note).not.toBe(here.note);
    expect(away.note).toMatch(/elsewhere/);
    expect(here.note).toMatch(/no known worker/);
  });

  it('reads a missing pid as UNKNOWN, not as nobody — a hand-started worker is not dead', () => {
    // `plot-dispatch` writes the pid only where it started the worker itself, so
    // a hand-started agent leaves none — and hand-starting is the normal case
    // for as long as `Worker command` is unset. Five agents were started that
    // way in one session; reading a missing pid as "nobody is working" would
    // have reported every one of them dead.
    //
    // So the GROUP does not move. Only the sentence stops promising commits.
    const r = classify('claimed', 'eligible', 3, QUIET, null, false, 0, '', 'none');
    expect(r.group).toBe('working');
    expect(r.note).not.toMatch(/dead|nobody|not started/i);
  });

  it('leaves a caller that passes no worker at all answering as before', () => {
    // Every caller predating the field. The group is what those callers were
    // about, and it must not move for a field they do not set.
    expect(classify('claimed', 'eligible', 3, QUIET).group).toBe('working');
    expect(classify('claimed', 'eligible', QUIET + 1, QUIET).group).toBe('quiet');
    expect(classify('wip', 'eligible', 5, QUIET).group).toBe('working');
  });

  it('does not let a stale worktree speak for a merged branch', () => {
    // Merged work is done regardless of what a leftover worktree holds. A
    // `failed` pid file from an earlier attempt must not drag a landed branch
    // into waiting-on-you.
    const r = classify('merged', 'complete', 90, QUIET, null, false, 0, '', 'failed', '1');
    expect(r.group).toBe('done');
  });

  it('lets a PR outrank the worker: a review is a stronger statement', () => {
    // A branch up for review waits on the review, whether or not a process is
    // still sitting in its worktree. The worker arm is placed after the PR arm
    // for exactly this, and the ordering is what this pins.
    const pr: PrRecord = {
      number: 7, head: 'feature/x', state: 'OPEN', draft: false,
      checks: 'pending', mergeable: 'mergeable', review: '', url: '',
    };
    const r = classify('wip', 'eligible', 3, QUIET, pr, false, 0, '', 'failed', '1');
    expect(r.group).toBe('waiting-on-machine');
  });
});

describe('draftNote — a draft PR that is red must say so', () => {
  // `mergeable: 'mergeable'` stated rather than omitted — unreadable
  // mergeability outranks every checks verdict below, so an omitted field would
  // send every case here down the *cannot say whether it merges* arm.
  const pr = (over: Partial<PrRecord> = {}): PrRecord => ({
    number: 131, head: 'idea/x', state: 'OPEN', draft: true, checks: 'green',
    mergeable: 'mergeable', review: '', url: '', ...over,
  });

  it('carries the check state inside the draft framing', () => {
    // Found on this plan's own PR: #131 reported `checks: failing` and the row
    // rendered `PR #131, draft`. The shortcut answered for EVERY draft, so a
    // green draft and a red one produced the identical note.
    expect(draftNote(pr({ checks: 'failing' }))).toContain('draft');
    expect(draftNote(pr({ checks: 'failing' }))).toMatch(/checks failing/);
    expect(draftNote(pr({ checks: 'pending' }))).toMatch(/CI running/);
    expect(draftNote(pr({ checks: 'none' }))).toMatch(/no checks/);
    expect(draftNote(pr({ checks: 'unknown' }))).toMatch(/cannot read the checks/);
  });

  it('says nothing extra for a green draft', () => {
    // "PR #131, draft" already means *not ready for you*; appending "checks
    // green" would put the reassuring word on the row whose point is that it is
    // unfinished. Every other value is a reason to look, so every other value
    // is said.
    expect(draftNote(pr({ checks: 'green' }))).toBe('PR #131, draft');
  });

  it('says so when a green draft is one nobody can confirm merges', () => {
    // The same silence, one input away from being wrong: without this the note
    // for an unreadable draft is identical to a clean green one — and here the
    // silence means *not ready for you, but otherwise fine* on a row where the
    // host declined to say whether it merges at all.
    expect(draftNote(pr({ checks: 'green', mergeable: 'unknown' })))
      .toBe('PR #131, draft, cannot say whether it merges');
  });

  it('keeps conflicts above cannot-say in the draft note too', () => {
    // The three folds — prState, classify and this one — must agree on every
    // input, and this is the pair that separates a host that found out from one
    // that could not.
    expect(draftNote(pr({ checks: 'green', mergeable: 'conflicting' }))).toMatch(/draft, conflicts/);
  });

  it('still annotates the review state, as every other note does', () => {
    expect(draftNote(pr({ checks: 'failing', review: 'CHANGES_REQUESTED' })))
      .toMatch(/changes requested/);
  });
});

describe('rowsFromPulse', () => {
  const pulse: FleetPulse = {
    main: 'main',
    head: 'abc1234',
    plans: [{
      file: '2026-08-15-example-plan.md',
      waves: [
        {
          name: 'Tracer', verdict: 'complete',
          branches: [{ branch: 'feature/a', state: 'merged', deferred: false, claimed: '' }],
        },
        {
          name: 'Implementation', verdict: 'eligible',
          branches: [
            { branch: 'feature/b', state: 'wip', deferred: false, claimed: '' },
            { branch: 'feature/c', state: 'open', deferred: false, claimed: '' },
            { branch: 'feature/d', state: 'claimed', deferred: false, claimed: '2026-08-15, s-1' },
          ],
        },
      ],
    }],
    summary: { plans: 1, waves: 2, branches: 4, claimed: 1, eligible: 1, blocked: 0, deferred: 0 },
  };
  const ages = new Map<string, number | null>([
    ['feature/b', 4], ['feature/a', 90], ['feature/d', 240],
  ]);

  const pr = (over: Record<string, unknown> = {}) => ({
    number: 99, head: 'bug/loose-fix', state: 'OPEN', draft: false,
    checks: 'green', mergeable: 'mergeable', review: '', url: 'https://host/pr/99', ...over,
  }) as never;

  // The wiring, which the classify tests above cannot reach: the phase has to
  // travel from the PLAN onto each of its rows. `classify` answering correctly
  // is worth nothing if `rowsFromPulse` never hands it the phase.
  it('carries the PLAN phase onto its own rows', () => {
    const drafted: FleetPulse = {
      ...pulse,
      plans: [{ ...pulse.plans[0], phase: 'draft' }],
    };
    const rows = rowsFromPulse(drafted, ages, 'plot', QUIET);
    const open = rows.find((r) => r.branch === 'feature/c')!;
    expect(open.note).toBe(DRAFT_PLAN_NOTE);
    // And the approved pulse still reads eligible, so the assertion above is
    // about the phase rather than about this fixture.
    const approved = rowsFromPulse(
      { ...pulse, plans: [{ ...pulse.plans[0], phase: 'approved' }] }, ages, 'plot', QUIET);
    expect(approved.find((r) => r.branch === 'feature/c')!.note).toBe(ELIGIBLE_NOTE);
  });

  it('stops saying it the moment the plan is approved — nothing to clear', () => {
    // DERIVED, NEVER STORED. The pulse is stateless by design, and this is the
    // assertion that holds it: a stored flag passes the test above and fails
    // this one.
    //
    // Two scans of the SAME fixture, differing only in the plan's phase — which
    // is what approving a plan changes. The row must follow on the next scan,
    // with nothing cleared by hand.
    const scan = (phase: string) => rowsFromPulse(
      { ...pulse, plans: [{ ...pulse.plans[0], phase }] }, ages, 'plot', QUIET)
      .find((r) => r.branch === 'feature/c')!;
    expect(scan('draft').note).toBe(DRAFT_PLAN_NOTE);
    expect(scan('approved').note).toBe(ELIGIBLE_NOTE);
    // And back again: re-deriving means the answer follows the input in BOTH
    // directions, which a flag that is only ever set would fail.
    expect(scan('draft').note).toBe(DRAFT_PLAN_NOTE);
  });

  it('shows an open PR whose branch no plan names', () => {
    // Two PRs once sat waiting to be merged while WAITING ON YOU read "none":
    // the pulse walks branches a plan lists, and a fix branch opened outside a
    // plan is not one. An open PR is waiting on somebody regardless.
    const prs = new Map([['bug/loose-fix', pr()]]);
    const rows = rowsFromPulse(pulse, ages, 'plot', QUIET, prs);
    const loose = rows.find((r) => r.branch === 'bug/loose-fix');
    expect(loose).toBeDefined();
    expect(loose!.group).toBe('waiting-on-you');
    // No plan names it, and inventing one would be worse than the gap.
    expect(loose!.plan).toBe('');
    expect(loose!.planFile).toBe('');
  });

  it('populates WAITING ON A MACHINE — a group that had never once filled', () => {
    // Its only entry point is an open PR whose checks are running, and the
    // branches carrying PR state were exactly the ones missing from the rows.
    // Both halves of the emptiness, in one assertion.
    const prs = new Map([['bug/loose-fix', pr({ checks: 'pending' })]]);
    const rows = rowsFromPulse(pulse, ages, 'plot', QUIET, prs);
    expect(rows.find((r) => r.branch === 'bug/loose-fix')!.group).toBe('waiting-on-machine');
  });

  it('puts a draft PR in waiting-on-you, not in quiet', () => {
    // QUIET means "go check whether this died". A draft PR is the opposite: it
    // is waiting for its author to finish it. classify() declines to claim a
    // green draft — right for its question, wrong here, where the author is the
    // reader.
    const prs = new Map([['idea/some-slug', pr({ head: 'idea/some-slug', draft: true })]]);
    const rows = rowsFromPulse(pulse, ages, 'plot', QUIET, prs);
    const row = rows.find((r) => r.branch === 'idea/some-slug');
    expect(row!.group).toBe('waiting-on-you');
    // Distinguishable from "green, ready to merge" — the note says which.
    expect(row!.note).toContain('draft');
  });

  it('says a draft PR is failing, and leaves it waiting on its author', () => {
    // Both halves, because each alone passes against the bug. Asserting only
    // the GROUP passes against today's code — the group was already right; it
    // was the note that lost the only fact that changes what to do next. And
    // asserting only the note would let a fix move the row into a review queue
    // nobody asked for: a failing draft is still its author's.
    const prs = new Map([[
      'idea/some-slug', pr({ head: 'idea/some-slug', draft: true, checks: 'failing' }),
    ]]);
    const rows = rowsFromPulse(pulse, ages, 'plot', QUIET, prs);
    const row = rows.find((r) => r.branch === 'idea/some-slug');
    expect(row!.group).toBe('waiting-on-you');
    expect(row!.note).toMatch(/draft/);
    expect(row!.note).toMatch(/failing/);
  });

  it('renders a green draft and a red one as DIFFERENT rows', () => {
    // The defect stated as the reader saw it: two PRs in different states, one
    // row. A test that only checks the failing case passes against an
    // implementation that says "checks failing" on everything.
    const red = rowsFromPulse(pulse, ages, 'plot', QUIET, new Map([[
      'idea/some-slug', pr({ head: 'idea/some-slug', draft: true, checks: 'failing' }),
    ]])).find((r) => r.branch === 'idea/some-slug');
    const green = rowsFromPulse(pulse, ages, 'plot', QUIET, new Map([[
      'idea/some-slug', pr({ head: 'idea/some-slug', draft: true, checks: 'green' }),
    ]])).find((r) => r.branch === 'idea/some-slug');
    expect(red!.note).not.toBe(green!.note);
  });

  it('files an idea branch under the plan it carries, not under nothing', () => {
    // /plot-idea names the branch after the plan's own slug, so the name is a
    // convention Plot writes rather than a guess about it. Without this, two
    // unrelated idea PRs shared one nameless group and the plan they each
    // introduce went unnamed.
    const prs = new Map([['idea/some-slug', pr({ head: 'idea/some-slug' })]]);
    const rows = rowsFromPulse(pulse, ages, 'plot', QUIET, prs);
    const row = rows.find((r) => r.branch === 'idea/some-slug');
    expect(row!.plan).toBe('some-slug');
    // planFile stays empty: the plan lives on that branch, not in this pulse,
    // so the heading renders as text rather than linking somewhere unresolvable.
    expect(row!.planFile).toBe('');
  });

  it('leaves a non-idea branch with no plan genuinely unnamed', () => {
    // The mirror: a release branch or a collecting branch has no plan to claim,
    // and inventing one would be worse than the gap.
    const prs = new Map([['changeset-release/main', pr({ head: 'changeset-release/main' })]]);
    const rows = rowsFromPulse(pulse, ages, 'plot', QUIET, prs);
    expect(rows.find((r) => r.branch === 'changeset-release/main')!.plan).toBe('');
  });

  it('leaves a merged PR with no plan out — finished work is not waiting', () => {
    // The narrowing that keeps `done` from filling with housekeeping.
    const prs = new Map([['bug/loose-fix', pr({ state: 'MERGED' })]]);
    const rows = rowsFromPulse(pulse, ages, 'plot', QUIET, prs);
    expect(rows.some((r) => r.branch === 'bug/loose-fix')).toBe(false);
  });

  it('does not duplicate a branch a plan already names', () => {
    const prs = new Map([['feature/b', pr({ head: 'feature/b' })]]);
    const rows = rowsFromPulse(pulse, ages, 'plot', QUIET, prs);
    expect(rows.filter((r) => r.branch === 'feature/b')).toHaveLength(1);
  });

  it('encodes an unplanned branch URL per segment, not whole', () => {
    // `encodeURIComponent(branch)` yields `bug%2Floose-fix` — a link that 404s.
    const prs = new Map([['bug/loose-fix', pr()]]);
    const rows = rowsFromPulse(pulse, ages, 'plot', QUIET, prs, 'https://host/tree/');
    const loose = rows.find((r) => r.branch === 'bug/loose-fix');
    expect(loose!.branchUrl).toBe('https://host/tree/bug/loose-fix');
  });

  it('orders groups by what they ask of you, not by plan', () => {
    const rows = rowsFromPulse(pulse, ages, 'plot', QUIET);
    const groups = rows.map((r) => r.group);
    // working first (nothing to do but look), then not-started (an opportunity
    // to take), then quiet (an errand to run). Workable top to bottom.
    expect(groups[0]).toBe('working');
    // done sits last: it asks nothing of you at all.
    expect(groups.at(-1)).toBe('done');
  });

  it('sorts an unstarted branch ABOVE a quiet one — actionable before diagnostic', () => {
    // not-started is work a person can pick up right now; quiet asks them to go
    // investigate something that may be dead. The previous order put the errand
    // first. Asserted on the sort itself, not merely on the constant, because
    // the constant is what a refactor moves and the order is what a reader sees.
    const rows = rowsFromPulse(pulse, ages, 'plot', QUIET);
    const groups = rows.map((r) => r.group);
    expect(groups.indexOf('not-started')).toBeLessThan(groups.indexOf('quiet'));
  });

  it('strips the date prefix so the plan column stays readable', () => {
    const rows = rowsFromPulse(pulse, ages, 'plot', QUIET);
    expect(rows[0].plan).toBe('example-plan');
  });

  it('carries the claim note onto the row', () => {
    const rows = rowsFromPulse(pulse, ages, 'plot', QUIET);
    const claimed = rows.find((r) => r.branch === 'feature/d');
    expect(claimed?.note).toMatch(/s-1/);
  });

  it('keeps the repo column populated even with one repo', () => {
    // Constant today, present so the second repo is an addition not a rebuild.
    const rows = rowsFromPulse(pulse, ages, 'plot', QUIET);
    expect(rows.every((r) => r.repo === 'plot')).toBe(true);
  });

  it('sorts the oldest first inside a group — stale work surfaces', () => {
    const rows = rowsFromPulse(pulse, ages, 'plot', QUIET);
    const quiet = rows.filter((r) => r.group === 'quiet');
    for (let i = 1; i < quiet.length; i++) {
      expect(quiet[i - 1].ageMinutes ?? -1).toBeGreaterThanOrEqual(quiet[i].ageMinutes ?? -1);
    }
  });

  it('carries the plan FILENAME beside the display name, so a row can link', () => {
    // `plan` is lossy on purpose (the date prefix is noise in a column), which
    // is exactly why the filename travels separately rather than being
    // reconstructed by whatever needs to build a /plan/ href.
    const rows = rowsFromPulse(pulse, ages, 'plot', QUIET);
    expect(rows[0].plan).toBe('example-plan');
    expect(rows[0].planFile).toBe('2026-08-15-example-plan.md');
  });

  it('carries the host URL verbatim, and null where there is no PR', () => {
    const prs = new Map<string, PrRecord>([
      ['feature/b', {
        number: 7, head: 'feature/b', state: 'OPEN', draft: false, checks: 'green',
        review: '', url: 'https://example.test/pr/7',
      }],
    ]);
    const rows = rowsFromPulse(pulse, ages, 'plot', QUIET, prs);
    // The number and the address, which is what this test is about. The row's
    // `pr` also carries the PR's CONDITION now (`draft`, `state`) — asserted
    // where those fields are the subject, so that adding one there does not
    // fail an assertion about URLs here.
    expect(rows.find((r) => r.branch === 'feature/b')?.pr)
      .toMatchObject({ number: 7, url: 'https://example.test/pr/7' });
    // No PR is the common case, not a degraded one — and it must be null rather
    // than a fabricated address.
    expect(rows.find((r) => r.branch === 'feature/c')?.pr).toBeNull();
  });

  const BASE = 'https://github.com/plot-pm/plot/tree/';

  it('links a branch WITHOUT a PR — the rows the PR-URL derivation would have missed', () => {
    // `feature/c` is `open` / not-started: no PR, and exactly the class where
    // "go look at the branch" is most useful. Deriving the address from a PR URL
    // would have left precisely these rows unlinked.
    const rows = rowsFromPulse(pulse, ages, 'plot', QUIET, null, BASE);
    const notStarted = rows.find((r) => r.branch === 'feature/c');
    expect(notStarted?.group).toBe('not-started');
    expect(notStarted?.pr).toBeNull();
    expect(notStarted?.branchUrl).toBe('https://github.com/plot-pm/plot/tree/feature/c');
  });

  it('gives a merged branch no branch link — its remote page is gone', () => {
    const rows = rowsFromPulse(pulse, ages, 'plot', QUIET, null, BASE);
    const merged = rows.find((r) => r.branch === 'feature/a');
    expect(merged?.state).toBe('merged');
    expect(merged?.branchUrl).toBe('');
  });

  it('points the branch link and the PR link at DIFFERENT targets', () => {
    // The defect this replaces: one link, on the wrong word — the branch name
    // opened the PR. A test asserting merely "a link exists" passes on that bug,
    // so the assertion has to be that the two addresses differ and that each
    // goes where its own text says.
    const prs = new Map<string, PrRecord>([
      ['feature/b', {
        number: 7, head: 'feature/b', state: 'OPEN', draft: false, checks: 'green',
        review: '', url: 'https://example.test/pr/7',
      }],
    ]);
    const row = rowsFromPulse(pulse, ages, 'plot', QUIET, prs, BASE)
      .find((r) => r.branch === 'feature/b');
    expect(row?.branchUrl).toBe('https://github.com/plot-pm/plot/tree/feature/b');
    expect(row?.pr?.url).toBe('https://example.test/pr/7');
    expect(row?.branchUrl).not.toBe(row?.pr?.url);
  });

  it('renders every branch as plain text when the origin is unrecognised', () => {
    // No base, no guess. An empty base is what an unknown host produces, and it
    // must not become a URL shape borrowed from a host this repo is not on.
    const rows = rowsFromPulse(pulse, ages, 'plot', QUIET, null, '');
    expect(rows.every((r) => r.branchUrl === '')).toBe(true);
  });

  it('escapes a branch name into the URL without mangling its slashes', () => {
    // `feature/a b` is legal in git and illegal in a raw URL. The slash is a
    // path separator on both hosts and must survive; everything else is encoded.
    const odd: FleetPulse = {
      ...pulse,
      plans: [{
        file: '2026-08-15-example-plan.md',
        waves: [{
          name: 'w', verdict: 'eligible',
          branches: [{ branch: 'feature/a b', state: 'open', deferred: false, claimed: '' }],
        }],
      }],
    };
    const rows = rowsFromPulse(odd, new Map(), 'plot', QUIET, null, BASE);
    expect(rows[0].branchUrl).toBe('https://github.com/plot-pm/plot/tree/feature/a%20b');
  });

  describe('the phase reaches the row', () => {
    // The plumbing, asserted separately from the derivation: a phase computed
    // and not carried is a phase nobody reads.
    const withPhase = (phase: string): FleetPulse => ({
      ...pulse,
      plans: [{ ...pulse.plans[0], phase }],
    });

    it('gives the branches of ONE plan different phases', () => {
      // The point of deriving per row rather than per plan. This fixture's plan
      // holds a merged branch, a branch being built and one nobody has taken,
      // and each is at a different point — which a plan-level phase cannot say.
      const rows = rowsFromPulse(withPhase('approved'), ages, 'plot', QUIET);
      // `feature/c` is `open` — designed, waiting to be picked up. Development
      // here would sit beside a note reading *eligible — nobody has taken it*.
      expect(rows.find((r) => r.branch === 'feature/c')!.phase).toBe('Design');
      // `feature/b` is `wip` — an agent is building.
      expect(rows.find((r) => r.branch === 'feature/b')!.phase).toBe('Development');
      // `feature/a` merged: the work landed, which is a start and then some.
      expect(rows.find((r) => r.branch === 'feature/a')!.phase).toBe('Development');
    });

    it('reads Development from git where the plan file records no start', () => {
      // The opus5 shape at the row level: the pulse carries `approved` and
      // nothing else, and the branch's own commits are what name the phase.
      const rows = rowsFromPulse(withPhase('approved'), ages, 'plot', QUIET);
      expect(rows.find((r) => r.branch === 'feature/b')!.phase).toBe('Development');
      expect(rows.find((r) => r.branch === 'feature/d')!.phase).toBe('Design');
    });

    it('keeps a delivered plan\'s rows at Endgame despite fresh commits', () => {
      // `feature/b` is four minutes old in this fixture — a commit under a plan
      // already marked delivered, which must not reverse the phase.
      const rows = rowsFromPulse(withPhase('delivered'), ages, 'plot', QUIET);
      expect(rows.every((r) => r.phase === 'Endgame')).toBe(true);
    });

    it('leaves it null on a pulse from a scan that reports no phase', () => {
      // The base fixture carries neither field, which is what an older scan
      // sends. Null renders as an empty cell — not as a guessed column.
      const rows = rowsFromPulse(pulse, ages, 'plot', QUIET);
      expect(rows.every((r) => r.phase === null)).toBe(true);
    });

    it('calls an idea branch Discovery, and every other planless branch nothing', () => {
      // An idea branch CARRIES a plan under review, and a plan under review is
      // Discovery by definition. A release branch carries no plan at all, and
      // `Discovery` on it would be a confident wrong answer.
      const prs = new Map([
        ['idea/some-slug', pr({ head: 'idea/some-slug' })],
        ['changeset-release/main', pr({ head: 'changeset-release/main' })],
      ]);
      const rows = rowsFromPulse(pulse, ages, 'plot', QUIET, prs);
      expect(rows.find((r) => r.branch === 'idea/some-slug')!.phase).toBe('Discovery');
      expect(rows.find((r) => r.branch === 'changeset-release/main')!.phase).toBeNull();
    });

    it('gives a deferred branch the phase AND the fact, not one or the other', () => {
      // Both halves on the row: the phase falls back to Design, and `state`
      // still says `deferred` so the badge has something to render from. Bare
      // Design would be indistinguishable from never-started; Development with
      // a badge would claim somebody is working on it.
      const shelved: FleetPulse = {
        ...pulse,
        plans: [{
          file: '2026-08-15-example-plan.md', phase: 'approved',
          waves: [{
            name: 'Implementation', verdict: 'eligible',
            branches: [{
              branch: 'feature/shelved', state: 'deferred', deferred: true, claimed: '',
            }],
          }],
        }],
      };
      const row = rowsFromPulse(shelved, new Map([['feature/shelved', 5]]), 'plot', QUIET)
        .find((r) => r.branch === 'feature/shelved')!;
      expect(row.phase).toBe('Design');
      expect(row.state).toBe('deferred');
      // And the note is the branch's own, not the word `deferred`.
      expect(row.note).not.toBe('deferred');
      expect(row.group).toBe('not-started');
    });
  });

  describe('waitingDays — a different clock, in its own field', () => {
    const DAY = 86_400_000;
    const NOW = Date.parse('2026-08-16T12:00:00Z');
    const approved = new Map([['2026-08-15-example-plan.md', NOW - 22 * DAY]]);

    it('dates an unstarted branch from the plan\'s approval', () => {
      // The point of the field: "approved in February and never begun" is
      // invisible while the row shows only a branch tip that does not exist.
      const rows = rowsFromPulse(pulse, ages, 'plot', QUIET, null, '', approved, NOW);
      const notStarted = rows.find((r) => r.branch === 'feature/c');
      expect(notStarted?.group).toBe('not-started');
      expect(notStarted?.ageMinutes).toBeNull();
      expect(notStarted?.waitingDays).toBe(22);
    });

    it('leaves it null for a branch that HAS a tip to date', () => {
      // `ageMinutes` is the better answer wherever it exists; a second age
      // beside it would only compete. Load-bearing: this is what keeps the two
      // clocks from ever appearing on the same row.
      const rows = rowsFromPulse(pulse, ages, 'plot', QUIET, null, '', approved, NOW);
      for (const r of rows.filter((x) => x.state !== 'open')) {
        expect(r.waitingDays).toBeNull();
      }
    });

    it('is null when the plan records no approval date', () => {
      // Every plan predating the `Approved:` record — including, on this repo,
      // the one not-started plan that motivated the field. Absent must not
      // become zero: "approved at an unknown time" and "approved today" are
      // different statements.
      const rows = rowsFromPulse(pulse, ages, 'plot', QUIET, null, '', new Map(), NOW);
      expect(rows.find((r) => r.branch === 'feature/c')?.waitingDays).toBeNull();
      // And with no map at all — an older cache, or a scan that could not parse.
      const none = rowsFromPulse(pulse, ages, 'plot', QUIET, null, '', null, NOW);
      expect(none.find((r) => r.branch === 'feature/c')?.waitingDays).toBeNull();
    });

    it('never reports a negative wait for a date in the future', () => {
      // A mistyped `Approved:` must not render "waiting -3d", which would look
      // like a bug in the board rather than in the plan.
      const future = new Map([['2026-08-15-example-plan.md', NOW + 3 * DAY]]);
      const rows = rowsFromPulse(pulse, ages, 'plot', QUIET, null, '', future, NOW);
      expect(rows.find((r) => r.branch === 'feature/c')?.waitingDays).toBe(0);
    });
  });

  describe('NOT STARTED sorts by the clock that dates it', () => {
    // The group's rows have no commit, so the general rule tied every one of
    // them at -1 and any order passed a test that only checked they were all
    // present. The fixture therefore holds all three cases at once.
    const sortable = (over: Partial<AgentRow>): AgentRow => ({
      repo: 'plot', branch: 'feature/x', plan: 'p', planFile: 'p.md', wave: 'w',
      state: 'open', phase: null, group: 'not-started', ageMinutes: null, note: '',
      pr: null, branchUrl: '', waitingDays: null, ...over,
    });

    it('puts the freshest first, and an undated row ahead of both', () => {
      // Undated leads because it has just arrived and has not yet been ignored
      // by anyone; six months of availability is evidence that nobody wants it,
      // not that it is urgent.
      const rows = [
        sortable({ branch: 'six-months', waitingDays: 180 }),
        sortable({ branch: 'undated', waitingDays: null }),
        sortable({ branch: 'today', waitingDays: 0 }),
      ];
      expect([...rows].sort(compareWithinGroup).map((r) => r.branch))
        .toEqual(['undated', 'today', 'six-months']);
    });

    it('reads waitingDays, never the commit age that is not there', () => {
      // The defect exactly: consulting `ageMinutes` leaves every row at -1, so
      // the input order survives untouched and looks like a sort.
      const rows = [
        sortable({ branch: 'old-wait', waitingDays: 90, ageMinutes: null }),
        sortable({ branch: 'new-wait', waitingDays: 1, ageMinutes: null }),
      ];
      expect([...rows].sort(compareWithinGroup).map((r) => r.branch))
        .toEqual(['new-wait', 'old-wait']);
    });

    it('leaves every OTHER group oldest-first, and the inversion confined', () => {
      // A global change would silently reverse `quiet` — the group that most
      // needs oldest-first, since its whole question is "has this died?".
      for (const group of ['quiet', 'working', 'done', 'waiting-on-you',
        'waiting-on-machine'] as const) {
        const rows = [
          sortable({ branch: 'fresh', group, ageMinutes: 5 }),
          sortable({ branch: 'stale', group, ageMinutes: 900 }),
        ];
        expect([...rows].sort(compareWithinGroup).map((r) => r.branch))
          .toEqual(['stale', 'fresh']);
      }
    });

    it('sorts the group that way through rowsFromPulse, not only in isolation', () => {
      // The comparator is only right if the row builder actually uses it.
      const DAY = 86_400_000;
      const NOW = Date.parse('2026-08-16T12:00:00Z');
      const threeUnstarted: FleetPulse = {
        ...pulse,
        plans: [
          {
            file: '2026-08-15-example-plan.md',
            waves: [{
              name: 'Implementation', verdict: 'eligible',
              branches: [
                { branch: 'feature/ancient', state: 'open', deferred: false, claimed: '' },
                { branch: 'feature/recent', state: 'open', deferred: false, claimed: '' },
              ],
            }],
          },
          {
            file: '2026-08-15-undated-plan.md',
            waves: [{
              name: 'Implementation', verdict: 'eligible',
              branches: [
                { branch: 'feature/nodate', state: 'open', deferred: false, claimed: '' },
              ],
            }],
          },
        ],
      };
      // One plan approved long ago, one approved today, one with no record.
      const approvedMix = new Map([['2026-08-15-example-plan.md', NOW - 180 * DAY]]);
      const rows = rowsFromPulse(
        threeUnstarted,
        new Map([
          ['feature/ancient', null], ['feature/recent', null], ['feature/nodate', null],
        ]),
        'plot', QUIET, null, '', approvedMix, NOW,
      ).filter((r) => r.group === 'not-started');
      // Both branches of the dated plan share its approval date, so the
      // assertion that carries weight is the undated row leading them.
      expect(rows[0].branch).toBe('feature/nodate');
      expect(rows.map((r) => r.waitingDays)).toEqual([null, 180, 180]);
    });
  });

  describe('a dirty local worktree reaches the row', () => {
    // The plumbing, asserted separately from the classifier: a field the scan
    // reports and nothing carries is a field nobody reads.
    const dirty = (branch: string): FleetPulse => ({
      ...pulse,
      plans: [{
        file: '2026-08-15-example-plan.md',
        waves: [{
          name: 'Implementation', verdict: 'eligible',
          branches: [{
            branch, state: 'wip', deferred: false, claimed: '',
            local_dirty: true, local_worktree: '/Users/x/wt-example',
          }],
        }],
      }],
    });

    it('moves a long-quiet branch into working, saying the evidence is local', () => {
      // `feature/d` is 240 minutes old against a 30-minute window, so the refs
      // put it firmly in quiet and only the worktree says otherwise.
      const rows = rowsFromPulse(dirty('feature/d'), ages, 'plot', QUIET);
      const row = rows.find((r) => r.branch === 'feature/d');
      expect(row!.group).toBe('working');
      expect(row!.note).toMatch(/local/);
    });

    it('leaves a pulse without the fields answering exactly as before', () => {
      // Every branch on a machine with no worktree for it, which is nearly all
      // of them. The base fixture carries neither field.
      const rows = rowsFromPulse(pulse, ages, 'plot', QUIET);
      expect(rows.find((r) => r.branch === 'feature/d')!.group).toBe('quiet');
    });
  });

  describe('unpushed commits reach the row', () => {
    // The same plumbing assertion for the second signal: a field the scan
    // reports and nothing carries is a field nobody reads.
    const ahead = (branch: string, n: number, dirty = false): FleetPulse => ({
      ...pulse,
      plans: [{
        file: '2026-08-15-example-plan.md',
        waves: [{
          name: 'Implementation', verdict: 'eligible',
          branches: [{
            branch, state: 'wip', deferred: false, claimed: '',
            // CLEAN on purpose: with a dirty worktree the shipped signal does
            // the lifting and this proves nothing about the new one.
            local_dirty: dirty, local_worktree: '', local_ahead: n,
          }],
        }],
      }],
    });

    it('moves a long-quiet branch into working, and says how many', () => {
      // `feature/d` is 240 minutes old against a 30-minute window, so the refs
      // put it firmly in quiet and only the unpushed commits say otherwise.
      const rows = rowsFromPulse(ahead('feature/d', 3), ages, 'plot', QUIET);
      const row = rows.find((r) => r.branch === 'feature/d');
      expect(row!.group).toBe('working');
      expect(row!.note).toMatch(/3 commits not pushed/);
    });

    it('carries both facts through when the branch is dirty AND ahead', () => {
      const rows = rowsFromPulse(ahead('feature/d', 2, true), ages, 'plot', QUIET);
      const note = rows.find((r) => r.branch === 'feature/d')!.note;
      expect(note).toMatch(/2 commits not pushed/);
      expect(note).toMatch(/uncommitted/);
    });

    it('leaves a pulse reporting zero answering exactly as before', () => {
      const rows = rowsFromPulse(ahead('feature/d', 0), ages, 'plot', QUIET);
      expect(rows.find((r) => r.branch === 'feature/d')!.group).toBe('quiet');
    });
  });

  describe('the worker state reaches the row', () => {
    // The plumbing, asserted separately from the classifier: a field the scan
    // reports and nothing carries is a field nobody reads — which is precisely
    // what `worker_state()` was for the whole time it existed.
    const withWorker = (
      worker: 'running' | 'finished' | 'failed' | 'ended' | 'none' | 'elsewhere',
      exit = '', pid = '',
    ): FleetPulse => ({
      ...pulse,
      plans: [{
        file: '2026-08-15-example-plan.md',
        waves: [{
          name: 'Implementation', verdict: 'eligible',
          branches: [{
            branch: 'feature/d', state: 'claimed', deferred: false, claimed: '',
            worker, worker_exit: exit, worker_pid: pid,
          }],
        }],
      }],
    });

    it('carries a failed worker all the way to waiting-on-you, exit code included', () => {
      const rows = rowsFromPulse(withWorker('failed', '2', '900'), ages, 'plot', QUIET);
      const row = rows.find((r) => r.branch === 'feature/d')!;
      expect(row.group).toBe('waiting-on-you');
      expect(row.note).toMatch(/exit 2/);
    });

    it('carries a running worker\'s pid, so the reader can go look at the process', () => {
      const rows = rowsFromPulse(withWorker('running', '', '900'), ages, 'plot', QUIET);
      expect(rows.find((r) => r.branch === 'feature/d')!.note).toMatch(/900/);
    });

    it('renders the three claim cases as three different sentences', () => {
      // The brief's table, end to end. All three must differ — collapsing any
      // pair puts one errand's words on another errand's row.
      const say = (w: 'running' | 'none' | 'elsewhere') =>
        rowsFromPulse(withWorker(w, '', '900'), ages, 'plot', QUIET)
          .find((r) => r.branch === 'feature/d')!.note;
      expect(new Set([say('running'), say('none'), say('elsewhere')]).size).toBe(3);
    });

    it('leaves a pulse without the field answering exactly as before', () => {
      // Every branch from a scan that predates the field. The base fixture
      // carries none of the three, and the answer must not move.
      const rows = rowsFromPulse(pulse, ages, 'plot', QUIET);
      expect(rows.find((r) => r.branch === 'feature/d')!.group).toBe('quiet');
    });
  });

  it('keeps the PR number but no url when the host reported none', () => {
    // An older `gh`/`bb` omits the field. The number is still worth showing;
    // the link is not worth guessing.
    const prs = new Map<string, PrRecord>([
      ['feature/b', {
        number: 7, head: 'feature/b', state: 'OPEN', draft: false, checks: 'green',
        review: '', url: '',
      }],
    ]);
    const rows = rowsFromPulse(pulse, ages, 'plot', QUIET, prs);
    expect(rows.find((r) => r.branch === 'feature/b')?.pr)
      .toMatchObject({ number: 7, url: '' });
  });
});

describe('rateLimitBackoffMs — slow down for a quota, not for a blip', () => {
  // Why this exists: git and the host used to share a 5 s timer, so the board
  // spent 720 GraphQL calls an hour and exhausted a 5000/hour budget in under a
  // working day. It did exactly that on this repo on 2026-08-16, mid-plan.
  // Separating the cadences fixes the spend; this function decides what to do
  // once the host has already said no.

  it('backs off on the bare GraphQL exhaustion message', () => {
    // Verbatim from the failure that prompted the change.
    const ms = rateLimitBackoffMs('GraphQL: API rate limit already exceeded for user ID 870334');
    expect(ms).toBe(120_000);
  });

  it('honours a wait the host names itself', () => {
    const ms = rateLimitBackoffMs(
      'You have exceeded a secondary rate limit. Please wait 90 seconds before trying again.',
    );
    expect(ms).toBe(90_000);
  });

  it('never waits LESS than the ordinary cadence', () => {
    // A 5-second retry would just spend another call to be told the same thing.
    const ms = rateLimitBackoffMs('rate limited, please retry in 5 seconds');
    expect(ms).toBe(60_000);
  });

  it('waits until an absolute reset stamp when one is given', () => {
    const now = 1_700_000_000_000;
    const ms = rateLimitBackoffMs(
      `API rate limit exceeded; reset at 1700000180`, now,
    );
    expect(ms).toBe(180_000);
  });

  it('returns null for an ordinary failure, so the normal timer continues', () => {
    // The load-bearing negative. A VPN blip or a missing `gh` must NOT buy two
    // minutes of silence — the board would look stalled for a reason nothing
    // could explain, which is the same class of unexplained emptiness this plan
    // exists to remove.
    expect(rateLimitBackoffMs('bash: plot-host.sh: No such file or directory')).toBeNull();
    expect(rateLimitBackoffMs('dial tcp: lookup api.github.com: no such host')).toBeNull();
    expect(rateLimitBackoffMs('')).toBeNull();
  });

  it('ignores a reset stamp already in the past', () => {
    // A stale stamp must not produce a negative wait; fall through to the
    // ceiling instead of retrying instantly against a live limit.
    const ms = rateLimitBackoffMs('API rate limit exceeded; reset at 1600000000', 1_700_000_000_000);
    expect(ms).toBe(120_000);
  });
});

describe('classify with PR data', () => {
  // `mergeable: 'mergeable'` is stated rather than omitted, and that is
  // load-bearing: unreadable mergeability now outranks every `checks` verdict
  // below, so a factory that left the field out would send every test in this
  // block down the `cannot say whether it merges` arm and assert nothing about
  // the checks each one is named for.
  const pr = (over: Partial<PrRecord> = {}): PrRecord => ({
    number: 42, head: 'feature/x', state: 'OPEN', draft: false, checks: 'green', review: '',
    mergeable: 'mergeable', url: 'https://example.test/pr/42', ...over,
  });

  it('sends a green PR to waiting-on-you', () => {
    const r = classify('wip', 'eligible', 3, QUIET, pr());
    expect(r.group).toBe('waiting-on-you');
    expect(r.note).toMatch(/#42 green/);
  });

  it('sends a pending PR to waiting-on-a-machine', () => {
    const r = classify('wip', 'eligible', 3, QUIET, pr({ checks: 'pending' }));
    expect(r.group).toBe('waiting-on-machine');
    expect(r.note).toMatch(/CI running/);
  });

  it('treats a PR with NO checks as waiting on you, saying so', () => {
    // GitHub starts no workflow for a bot PR until a person approves the run.
    // "no checks" says why it is not green; calling it pending would show CI
    // running while nothing runs, and nobody would look.
    const r = classify('wip', 'eligible', 3, QUIET, pr({ checks: 'none' }));
    expect(r.group).toBe('waiting-on-you');
    expect(r.note).toMatch(/no checks/);
  });

  it('says WHICH fact is missing: the checks', () => {
    // Bitbucket carries no rollup. An honest gap beats an invented verdict —
    // and the sentence names the checks specifically, because this is the LESS
    // actionable of the two absences: nothing to do yet, look again later.
    const r = classify('wip', 'eligible', 3, QUIET, pr({ checks: 'unknown' }));
    expect(r.group).toBe('waiting-on-you');
    expect(r.note).toMatch(/cannot read the checks/);
    expect(r.note).not.toMatch(/whether it merges/);
  });

  it('says WHICH fact is missing: the mergeability', () => {
    // The live shape from PR #57: the checks were fine and the mergeability was
    // what could not be read. One label for both is the pattern this repo has
    // spent the day removing — a missing `mergeable` sends a reader to check
    // for a rebase, and reporting the checks as unavailable here would be a
    // second false statement layered on the first.
    const r = classify('wip', 'eligible', 3, QUIET, pr({ checks: 'green', mergeable: 'unknown' }));
    expect(r.group).toBe('waiting-on-you');
    expect(r.note).toMatch(/cannot say whether it merges/);
    expect(r.note).not.toMatch(/cannot read the checks/);
    // And above all it must not carry the reassuring word.
    expect(r.note).not.toMatch(/green/);
  });

  it('still says conflicts when the host knows, rather than cannot say', () => {
    // `conflicting` outranks `unknown` — the host that DID find out is heard.
    const r = classify('wip', 'eligible', 3, QUIET, pr({ checks: 'green', mergeable: 'conflicting' }));
    expect(r.note).toMatch(/conflicts/);
    expect(r.note).not.toMatch(/cannot say/);
  });

  it('sends a DRAFT with unreadable mergeability to you, not to its author', () => {
    // The `green` arm defers a draft to its author. This arm does not, for the
    // reason the `conflicting` arm above does not: a draft nobody can confirm
    // merges is the author's errand, and it is stated rather than implied by
    // the silence a green draft gets.
    const r = classify('wip', 'eligible', 3, QUIET, pr({ draft: true, checks: 'green', mergeable: 'unknown' }));
    expect(r.group).toBe('waiting-on-you');
    expect(r.note).toMatch(/cannot say whether it merges/);
  });

  it('sends failing checks to waiting-on-you, not to a machine', () => {
    const r = classify('wip', 'eligible', 3, QUIET, pr({ checks: 'failing' }));
    expect(r.group).toBe('waiting-on-you');
    expect(r.note).toMatch(/failing/);
  });

  it('leaves a green DRAFT PR to its author rather than to you', () => {
    const r = classify('wip', 'eligible', 3, QUIET, pr({ draft: true }));
    expect(r.group).toBe('working');
  });

  it('shows review state as a note without ever gating on it', () => {
    // Approved is approved with or without a review: membership comes from
    // checks, and the review only annotates. Both of these are waiting-on-you.
    const awaiting = classify('wip', 'eligible', 3, QUIET, pr({ review: 'REVIEW_REQUIRED' }));
    const approved = classify('wip', 'eligible', 3, QUIET, pr({ review: 'APPROVED' }));
    expect(awaiting.group).toBe('waiting-on-you');
    expect(approved.group).toBe('waiting-on-you');
    expect(awaiting.note).toMatch(/awaiting review/);
    expect(approved.note).toMatch(/approved/);
  });

  it('emits no review note when the host has nothing to say', () => {
    // "" must not render as "nobody reviewed it" — the honest reading is that
    // this host does not carry review state at all.
    const r = classify('wip', 'eligible', 3, QUIET, pr({ review: '' }));
    expect(r.note).not.toMatch(/review/);
  });

  it('lets git answer for merged and unpushed branches even with a PR present', () => {
    // A merged branch is done; an unpushed one has not started. Neither
    // question is answered by whatever its PR says.
    expect(classify('merged', 'complete', 1, QUIET, pr()).group).toBe('done');
    expect(classify('open', 'eligible', null, QUIET, pr()).group).toBe('not-started');
  });

  it('falls back to git state when no PR exists', () => {
    // The git-only behaviour must survive untouched for branches without a PR —
    // including for claims, which now answer by age like everything else.
    expect(classify('wip', 'eligible', 3, QUIET, null).group).toBe('working');
    expect(classify('claimed', 'eligible', 3, QUIET, null).group).toBe('working');
    expect(classify('claimed', 'eligible', QUIET + 1, QUIET, null).group).toBe('quiet');
  });
});

// The PR's condition as a FIELD rather than as prose.
//
// Before this, `AgentRow.pr` carried `{ number, url }` and nothing else: green,
// draft and `no checks` existed only inside `note`, assembled by different
// branches of `classify`. That is why one row read `PR #57 green` and the next
// `PR #116, no checks` — nothing downstream could make them agree, and nothing
// could render a badge from a sentence without parsing it back apart.
describe('prState', () => {
  const pr = (over: Partial<PrRecord> = {}): PrRecord => ({
    number: 42, head: 'feature/x', state: 'OPEN', draft: false, checks: 'green',
    mergeable: 'mergeable', review: '', url: 'https://example.test/pr/42', ...over,
  });

  it('states each check verdict as its own value', () => {
    expect(prState(pr({ checks: 'green' }))).toBe('green');
    expect(prState(pr({ checks: 'pending' }))).toBe('pending');
    expect(prState(pr({ checks: 'failing' }))).toBe('failing');
    expect(prState(pr({ checks: 'none' }))).toBe('none');
  });

  it('says conflicts, not no checks, for a conflicting PR', () => {
    // The live shape from PR #149 and PR #160: mergeable=CONFLICTING and a
    // genuinely EMPTY rollup, because GitHub starts no CI for a conflicting PR.
    // Reading `checks` first renders every conflict in the repo as `none` —
    // true about the symptom, silent about the cause.
    const conflicting = pr({ checks: 'none', mergeable: 'conflicting' });
    expect(prState(conflicting)).toBe('conflicts');
  });

  it('still says no checks for a workflow awaiting a human click', () => {
    // The pairing that matters: one label for both situations is the defect,
    // and a fix that renames all of them to `conflicts` is the same defect
    // mirrored — this PR wants a click, not a rebase.
    expect(prState(pr({ checks: 'none', mergeable: 'mergeable' }))).toBe('none');
  });

  it('says unknown — not green — for the live shape from PR #57', () => {
    // THE MEASURED DEFECT, exactly as reported. On 2026-08-17 PR #57 read
    // `green` in the agents row while the host said the branch could not merge:
    //
    //   plot-host:  checks="green"   mergeable="conflicting"
    //   gh:         mergeable=CONFLICTING   mergeStateStatus=DIRTY
    //
    // Under load GitHub returns UNKNOWN for the lazily-computed mergeability
    // while `statusCheckRollup` — a plain stored field — still answers, so this
    // is the pair `prState` actually received. It fell through to `checks` and
    // put the one word a reader acts on without checking onto a branch that had
    // been unmergeable for 22 days.
    expect(prState(pr({ checks: 'green', mergeable: 'unknown' }))).toBe('unknown');
  });

  it('says unknown for EVERY checks value when mergeability is unknown', () => {
    // The pairing that matters: an implementation special-casing only `green`
    // passes the assertion above and leaves `pending`, `failing`, `none` and the
    // rest claiming more than the host said. `checks` is not consulted at all
    // here — the two fields answer DIFFERENT questions, and a green check says
    // nothing about whether a branch merges.
    for (const checks of ['green', 'pending', 'failing', 'none', 'unknown', 'something-new']) {
      expect(prState(pr({ checks, mergeable: 'unknown' }))).toBe('unknown');
    }
  });

  it('says unknown for a record written before the field existed', () => {
    // An absent field is exactly the position a host that cannot say is in. The
    // ingest normalizes it, but `prState` is exported and called directly, so
    // the pure function must not answer `green` on a record handed to it raw.
    expect(prState(pr({ checks: 'green', mergeable: undefined }))).toBe('unknown');
    expect(prState(pr({ checks: 'green', mergeable: '' }))).toBe('unknown');
  });

  it('still says conflicts when the host knows the branch conflicts', () => {
    // The cheap fix is to reorder the two lines and lose the cause. `conflicts`
    // names WHY; `unknown` says only that nobody could find out, and a host that
    // did find out must still be heard.
    expect(prState(pr({ checks: 'green', mergeable: 'conflicting' }))).toBe('conflicts');
    expect(prState(pr({ checks: 'none', mergeable: 'conflicting' }))).toBe('conflicts');
  });

  it('still says green for a mergeable branch whose checks passed', () => {
    // The common case, and the one a careless fix destroys: reporting `unknown`
    // whenever `mergeable` is not `conflicting` passes every assertion above and
    // makes the board useless — every row on every host would say *cannot say*.
    expect(prState(pr({ checks: 'green', mergeable: 'mergeable' }))).toBe('green');
    expect(prState(pr({ checks: 'pending', mergeable: 'mergeable' }))).toBe('pending');
    expect(prState(pr({ checks: 'failing', mergeable: 'mergeable' }))).toBe('failing');
  });

  it('reads a Bitbucket row as unknown, permanently', () => {
    // The adapter's LITERAL, verbatim from plot-host.sh: `bb` has no run listing
    // and cannot answer either question, so it emits both as unknown on every
    // row. That is the CLI's limit rather than deferred work, so `unknown` is
    // the permanently correct answer there — and the defect stayed invisible on
    // that host only because the wrong answer and the right one coincided.
    expect(prState(pr({ checks: 'unknown', mergeable: 'unknown' }))).toBe('unknown');
    // And it stays unknown if the adapter ever learns to report checks: the
    // mergeability it still cannot answer is what decides.
    expect(prState(pr({ checks: 'green', mergeable: 'unknown' }))).toBe('unknown');
  });

  it('remains a pure function over the two facts it already receives', () => {
    // No contract change and no new field: the same record in, the same word
    // out, with nothing read from anywhere else.
    const record = pr({ checks: 'green', mergeable: 'unknown' });
    const before = JSON.stringify(record);
    expect(prState(record)).toBe(prState(record));
    expect(JSON.stringify(record)).toBe(before);
    expect(prState.length).toBe(1);
  });

  it('reports a check verdict it does not recognise as unknown', () => {
    // A word from a future host must read as "cannot say", never as the
    // reassuring end of the range.
    expect(prState(pr({ checks: 'unknown' }))).toBe('unknown');
    expect(prState(pr({ checks: 'something-new' }))).toBe('unknown');
  });

  it('does not fold draft into the state', () => {
    // A draft has CI like anything else, and the two are independent questions.
    // Folding them would rebuild the short-circuit that kept WAITING ON A
    // MACHINE empty — moving it out of the classifier and into the contract,
    // where it is harder to see and shared by every consumer.
    expect(prState(pr({ draft: true, checks: 'pending' }))).toBe('pending');
    expect(prState(pr({ draft: true, checks: 'green' }))).toBe('green');
    expect(prState(pr({ draft: true, checks: 'failing' }))).toBe('failing');
  });
});

describe('the row carries the PR condition as fields', () => {
  const pulse: FleetPulse = {
    generatedAt: '2026-08-17T00:00:00Z',
    plans: [{
      file: '2026-08-17-p.md', slug: 'p', title: 'P', phase: 'approved', story: '',
      waves: [{
        name: 'One', verdict: 'eligible',
        branches: [{
          branch: 'feature/a', state: 'wip', claimed: '', local_dirty: false,
          local_ahead: 0, worker: 'elsewhere', worker_exit: '', worker_pid: '',
        }],
      }],
    }],
    summary: { plans: 1, waves: 1, branches: 1, claimed: 0, eligible: 1, blocked: 0, deferred: 0 },
  } as never;
  const ages = new Map<string, number | null>([['feature/a', 5]]);
  const pr = (over: Partial<PrRecord> = {}): PrRecord => ({
    number: 42, head: 'feature/a', state: 'OPEN', draft: false, checks: 'green',
    mergeable: 'mergeable', review: '', url: 'https://host/pr/42', ...over,
  });

  const rowFor = (over: Partial<PrRecord> = {}) =>
    rowsFromPulse(pulse, ages, 'plot', QUIET, new Map([['feature/a', pr(over)]]))
      .find((r) => r.branch === 'feature/a')!;

  it('puts state and draft on the row beside the number and url', () => {
    // The wiring the pure-function tests cannot reach: `prState` answering
    // correctly is worth nothing if `rowsFromPulse` never puts it on the row.
    const row = rowFor();
    expect(row.pr).toEqual({
      number: 42, url: 'https://host/pr/42', draft: false, state: 'green',
    });
  });

  it('keeps draft a SEPARATE field from the state', () => {
    // Two facts, two fields — so a cell can render `⑂42 [draft] [CI running]`
    // rather than having to pick one of them to show.
    const row = rowFor({ draft: true, checks: 'pending' });
    expect(row.pr!.draft).toBe(true);
    expect(row.pr!.state).toBe('pending');
  });

  it('says conflicts on the row where GitHub reported a conflict', () => {
    expect(rowFor({ checks: 'none', mergeable: 'conflicting' }).pr!.state).toBe('conflicts');
  });

  it('carries the state onto a planless PR row too', () => {
    // The second place a row's `pr` is built. Two constructions of one field is
    // how the two halves of a tab stop agreeing.
    const prs = new Map([['bug/loose', pr({ head: 'bug/loose', checks: 'failing' })]]);
    const rows = rowsFromPulse(pulse, ages, 'plot', QUIET, prs);
    const loose = rows.find((r) => r.branch === 'bug/loose')!;
    expect(loose.pr!.state).toBe('failing');
    expect(loose.pr!.draft).toBe(false);
  });

  it('leaves the note carrying what a PR state cannot say', () => {
    // The note is not being replaced, only relieved of one duty. These three
    // facts have no PR-state equivalent and must survive.
    const blocked = rowsFromPulse(
      {
        ...pulse,
        plans: [{
          ...pulse.plans[0],
          waves: [{
            ...pulse.plans[0].waves[0],
            verdict: 'blocked',
            // `open` — the branch does not exist yet, which is the only state
            // in which "an earlier wave has not landed" is the row's answer.
            branches: [{ ...pulse.plans[0].waves[0].branches[0], state: 'open' }],
          }],
        }],
      } as never,
      new Map(), 'plot', QUIET);
    // NAMES THE WAVE. This asserted `/earlier wave/` until the wave's name
    // reached the note — *blocked by which one?* is the reader's unavoidable
    // next question, and the server is the only place that can answer it.
    // Asserted against the fixture's own wave name rather than the literal, so
    // renaming the fixture cannot leave a passing test measuring nothing.
    expect(blocked[0].note).toBe(`blocked by ${pulse.plans[0].waves[0].name}`);
    // And the field says it too, so nothing downstream has to read the prose.
    expect(blocked[0].waitingOn).toBe('time');
    expect(blocked[0].blockedBy).toBe(pulse.plans[0].waves[0].name);

    const claimed = rowsFromPulse(
      {
        ...pulse,
        plans: [{
          ...pulse.plans[0],
          waves: [{
            ...pulse.plans[0].waves[0],
            branches: [{
              ...pulse.plans[0].waves[0].branches[0],
              claimed: 'claimed by someone',
            }],
          }],
        }],
      } as never,
      ages, 'plot', QUIET);
    expect(claimed[0].note).toMatch(/claimed by someone/);

    // The third: local work no PR state could ever describe. Past the quiet
    // window, which is where `localDirty` speaks — it LIFTS a branch out of
    // quiet and never downgrades a livelier answer.
    expect(classify('wip', 'eligible', QUIET + 1, QUIET, null, true, 0).note)
      .toMatch(/uncommitted work/);
  });
});

describe('the note says conflicts too', () => {
  const pr = (over: Partial<PrRecord> = {}): PrRecord => ({
    number: 42, head: 'feature/x', state: 'OPEN', draft: false, checks: 'none',
    mergeable: 'conflicting', review: '', url: '', ...over,
  });

  it('replaces "no checks" with "conflicts" where the branch does not merge', () => {
    // The field alone is not enough: leaving the note saying `no checks` would
    // keep the sentence lying while only the badge told the truth, and the row
    // shows both.
    const r = classify('wip', 'eligible', 3, QUIET, pr());
    expect(r.note).toMatch(/conflicts/);
    expect(r.note).not.toMatch(/no checks/);
    // A conflict is a person's errand — the group was already right.
    expect(r.group).toBe('waiting-on-you');
  });

  it('says it inside the draft framing too', () => {
    // A draft is not exempt from needing a rebase, and reading `checks` first
    // would say `no checks` on every conflicting draft.
    expect(draftNote(pr({ draft: true }))).toMatch(/draft, conflicts/);
  });

  it('moves no row — a conflicting PR was already waiting on you', () => {
    // The safety assertion. A conflicting PR reports an EMPTY rollup, so every
    // row this arm answers was already reaching `waiting-on-you` through the
    // `none` case: the group is unchanged and only the SENTENCE is new.
    //
    // Drafts included. The `green` arm defers a draft to its author, but `none`
    // never did — a draft with no checks has always been the author's errand —
    // and a conflict is the strongest version of that errand.
    for (const draft of [false, true]) {
      const before = classify('wip', 'eligible', 3, QUIET,
        pr({ draft, mergeable: 'mergeable' }));
      const after = classify('wip', 'eligible', 3, QUIET, pr({ draft }));
      expect(after.group).toBe(before.group);
      expect(after.note).not.toBe(before.note);
    }
  });

  it('leaves every KNOWN-mergeable note exactly as it was', () => {
    // The pairing: a change that says `conflicts` everywhere passes the two
    // assertions above.
    expect(classify('wip', 'eligible', 3, QUIET, pr({ mergeable: 'mergeable' })).note)
      .toMatch(/no checks/);
    expect(classify('wip', 'eligible', 3, QUIET,
      pr({ mergeable: 'mergeable', checks: 'green' })).note).toMatch(/#42 green/);
  });

  it('does not say "no checks" for a branch nobody could confirm merges', () => {
    // This assertion USED to read `.toMatch(/no checks/)` — it encoded the
    // defect being fixed. `mergeable: 'unknown'` fell through to `checks`, so a
    // row whose mergeability the host could not compute reported whatever the
    // rollup happened to hold, up to and including `green`.
    const r = classify('wip', 'eligible', 3, QUIET, pr({ mergeable: 'unknown' }));
    expect(r.note).toMatch(/cannot say whether it merges/);
    expect(r.note).not.toMatch(/no checks/);
  });
});

// The WIRING for stuck detection, which the pure-function tests in
// `stuck.test.ts` cannot reach: the scan's conflict set, the PR's condition and
// the branch's local commits all have to travel onto the row, and the row's
// existing answers have to survive it untouched.
describe('rowsFromPulse carries stuck detection onto the row', () => {
  const ARTIFACT = 'skills/plot/scripts/board/board-server.mjs';

  const branch = (over: Record<string, unknown> = {}) => ({
    branch: 'feature/x', state: 'wip', deferred: false, claimed: '',
    local_dirty: false, local_locked: false, local_worktree: '', local_ahead: 0,
    worker: 'elsewhere', worker_pid: '', worker_exit: '',
    conflicts: [], conflicts_known: true, changed_paths: [],
    ...over,
  }) as never;

  const pulseWith = (over: Record<string, unknown> = {}): FleetPulse => ({
    main: 'main',
    head: 'abc1234',
    plans: [{
      file: '2026-08-17-p.md', phase: 'approved',
      waves: [{ name: 'One', verdict: 'eligible', branches: [branch(over)] }],
    }],
    summary: { plans: 1, waves: 1, branches: 1, claimed: 0, eligible: 0, blocked: 0, deferred: 0 },
  });

  const ages = new Map<string, number | null>([['feature/x', 3]]);
  const rowFor = (
    over: Record<string, unknown> = {},
    prs?: Map<string, PrRecord> | null,
  ) => rowsFromPulse(pulseWith(over), ages, 'plot', QUIET, prs)[0];

  const failingPr = (over: Record<string, unknown> = {}) => new Map<string, PrRecord>([
    ['feature/x', {
      number: 7, head: 'feature/x', state: 'OPEN', draft: false,
      checks: 'failing', mergeable: 'mergeable', review: '', url: 'u',
      failing_checks: ['Install Playwright browser'], ...over,
    } as PrRecord],
  ]);

  it('reports an artifact-only conflict and a mixed one differently', () => {
    expect(rowFor({ conflicts: [ARTIFACT] }).stuck?.state).toBe('artifact-conflict');
    expect(rowFor({ conflicts: [ARTIFACT, 'src/app.ts'] }).stuck?.state).toBe('conflict');
  });

  it('reports unpushed work with its count', () => {
    const stuck = rowFor({ local_ahead: 2 }).stuck;
    expect(stuck?.state).toBe('unpushed');
    expect(stuck?.localAhead).toBe(2);
  });

  it('reports a failing check with its evidence, not a verdict', () => {
    const stuck = rowFor({ changed_paths: ['docs/a.md'] }, failingPr()).stuck;
    expect(stuck?.state).toBe('ci-failing');
    expect(stuck?.failingChecks).toEqual(['Install Playwright browser']);
    expect(stuck?.changedPaths).toEqual(['docs/a.md']);
  });

  it('leaves a healthy row with no stuck fact at all', () => {
    // A watcher that flags everything flags nothing.
    expect(rowFor().stuck).toBeNull();
  });

  it('sees a host-reported conflict whose checks read green', () => {
    // `prState` is what the detector is handed, so the fold decides what the
    // watcher can see at all. This is the live shape from PR #57 as the host
    // finally reported it — `mergeable: conflicting` with a rollup that still
    // said `green` — and `merge-tree` predicted nothing, so `conflicts` is
    // empty: the host says *this does not merge* without saying where.
    //
    // Reported as a plain `conflict` and never `artifact-conflict`: that
    // distinction rests on the SET being exactly one known file, and here there
    // is no set at all.
    const stuck = rowFor({}, failingPr({ checks: 'green', mergeable: 'conflicting' })).stuck;
    expect(stuck?.state).toBe('conflict');
    expect(stuck?.conflicts).toEqual([]);
  });

  it('does NOT claim a branch is stuck when the host could not say', () => {
    // THE HONEST COST OF THIS FIX, asserted rather than left to be discovered.
    //
    // `mergeable: unknown` now yields `unknown`, so `prState === 'failing'` no
    // longer fires for a row whose mergeability could not be read — a branch
    // that today reports `ci-failing` reports nothing while GitHub is down.
    //
    // That is the correct trade and not a regression to route around: a stuck
    // verdict derived from a pulse the host could not answer is a guess, and
    // `stuck` is the one field a later wave is licensed to act on. The row
    // still SAYS *cannot say whether it merges*, so nothing is hidden from the
    // reader — only the machine-actionable claim is withheld. The state is
    // re-read every 60 s, so the next readable pulse restores the verdict.
    const stuck = rowFor({}, failingPr({ checks: 'failing', mergeable: 'unknown' })).stuck;
    expect(stuck).toBeNull();
    expect(rowFor({}, failingPr({ checks: 'failing', mergeable: 'unknown' })).note)
      .toMatch(/cannot say whether it merges/);
  });

  it('still reports local evidence while the host is unreadable', () => {
    // The pairing: suppressing the host-derived verdict must not suppress the
    // ones this machine observed itself. An unreadable `mergeable` says nothing
    // about a conflict `merge-tree` predicted or a commit that was never pushed.
    const unreadable = { checks: 'failing', mergeable: 'unknown' };
    expect(rowFor({ conflicts: ['src/app.ts'] }, failingPr(unreadable)).stuck?.state)
      .toBe('conflict');
    expect(rowFor({ local_ahead: 2 }, failingPr(unreadable)).stuck?.state).toBe('unpushed');
  });

  it('does not change the group, the state or the note of a stuck row', () => {
    // A stuck branch KEEPS the group it belongs to; this adds a fact about it.
    // Folding stuckness into the group would put a conflicting PR and an
    // unpushed rebase under one heading, which is the shape this row keeps
    // splitting apart.
    const healthy = rowFor();
    const conflicted = rowFor({ conflicts: ['src/app.ts'] });
    expect(conflicted.group).toBe(healthy.group);
    expect(conflicted.state).toBe(healthy.state);
    expect(conflicted.note).toBe(healthy.note);
    expect(conflicted.phase).toBe(healthy.phase);
    expect(conflicted.stuck?.state).toBe('conflict');
  });

  it('does not read an unobserved conflict set as clean', () => {
    // Absent is not clean — the flag is what separates "merges cleanly" from
    // "nobody could ask", and both arrive as an empty list.
    expect(rowFor({ conflicts: ['src/app.ts'], conflicts_known: false }).stuck).toBeNull();
  });

  it('reports a merged branch as not stuck whatever else is true', () => {
    expect(rowFor({ state: 'merged', conflicts: ['src/app.ts'], local_ahead: 4 }).stuck)
      .toBeNull();
  });

  it('validates against the row contract', () => {
    // The row travels over HTTP, so the schema is what the client will parse.
    for (const over of [
      {}, { conflicts: [ARTIFACT] }, { conflicts: [ARTIFACT, 'x'] }, { local_ahead: 1 },
    ]) {
      expect(() => AgentRowSchema.parse(rowFor(over))).not.toThrow();
    }
    expect(() => AgentRowSchema.parse(rowFor({}, failingPr()))).not.toThrow();
  });
});

describe('the PR cadence does not lose a period to its own gate', () => {
  // The measured defect, 2026-08-18:
  //
  //     74 branches across 37 plans · scanned 19s ago · PR data 111s ago
  //
  // against a PR_REFRESH_MS of 60_000, with a host call measured at 1.4 s and
  // 4986/5000 quota remaining — so nothing was slow and nothing was throttled.
  //
  // The cause was two clocks set to the same period that could not both be met:
  // `setInterval` fires at rigid multiples of 60 s, while `prNextAt` was stamped
  // from the fetch's FINISH and so landed at 60 s + the call's duration. Every
  // tick arrived just before its own gate, was refused, and the next came a full
  // period later. Any non-zero fetch duration bought a 120 s cadence.
  //
  // These drive the REAL scheduling pair — `prNextDueAt` decides when the next
  // fetch is due, `prGateOpen` decides whether a tick may pass — against a fake
  // clock. A wall-clock test of a 60 s cadence cannot run in a suite, but the
  // defect is arithmetic between two schedules, and this is that arithmetic
  // with nothing modelled: revert the anchor in `prNextDueAt` and these fail.

  const PERIOD = 60_000;

  /**
   * Run rigid interval ticks against the real gate and report the worst age the
   * board would have displayed, plus how many ticks actually fetched.
   *
   * `nextDue` is the scheduling policy under test. The default is the shipped
   * `prNextDueAt`; the defect is reproduced by passing the anchor it replaced.
   */
  function runCadence(
    { duration, ticks = 8, jitter = 0, nextDue = prNextDueAt }:
    {
      duration: number; ticks?: number; jitter?: number;
      nextDue?: (startedAt: number, backoff: number | null, now: number) =>
        { at: number; hard: boolean };
    },
  ): { worstAge: number; fetches: number } {
    // The start-up fetch, issued at t=0 and landing `duration` later.
    let prAt = duration;
    let due = nextDue(0, null, duration);
    let fetches = 0;
    let worstAge = 0;
    for (let k = 1; k <= ticks; k++) {
      const now = k * PERIOD + jitter;
      // The age a reader would see at this instant, refresh or no refresh.
      worstAge = Math.max(worstAge, now - prAt);
      if (!prGateOpen(due.at, due.hard, now)) continue;
      fetches++;
      prAt = now + duration;
      due = nextDue(now, null, prAt);
    }
    return { worstAge, fetches };
  }

  /**
   * The anchor this branch replaced: next-due measured from the fetch's FINISH.
   * Kept here, in the test, so the bug it caused stays reproducible after the
   * source that caused it is gone — the control the Definition of Done asks for.
   */
  const anchoredToFinish = (_startedAt: number, backoff: number | null, now: number) =>
    backoff !== null
      ? { at: now + backoff, hard: true }
      : { at: now + PERIOD, hard: false };

  it('keeps the observed age under PR_REFRESH_MS across several cycles', () => {
    // THE assertion. Every tick lands, so the age never reaches a second period.
    const { worstAge, fetches } = runCadence({ duration: 1_400 });
    expect(worstAge).toBeLessThan(PERIOD);
    expect(fetches).toBe(8);
  });

  it('reproduces the measured 111 s failure with the old anchor', () => {
    // The control. A test that passes both ways is not testing this bug: the
    // replaced anchor is asserted to FAIL the bar the shipped one clears.
    const { worstAge, fetches } = runCadence({
      duration: 1_400, nextDue: anchoredToFinish,
    });
    expect(worstAge).toBeGreaterThan(PERIOD);
    expect(worstAge).toBeGreaterThan(110_000);   // the reported 111 s
    expect(fetches).toBe(4);                     // half the ticks refused
  });

  it('holds for any fetch slower than the timer slack, not just 1.4 s', () => {
    // The defect was never about 1.4 s specifically. Anything the slack cannot
    // absorb pushed the gate past the tick, and the cost was a whole period.
    for (const duration of [1_300, 1_400, 5_000, 20_000]) {
      expect(runCadence({ duration }).worstAge).toBeLessThan(PERIOD);
      expect(runCadence({ duration, nextDue: anchoredToFinish }).worstAge)
        .toBeGreaterThan(PERIOD);
    }
  });

  it('survives a tick that arrives fractionally EARLY', () => {
    // Anchoring to the start puts the gate and the tick on the same instant,
    // which is correct and knife-edge: `setInterval` does not promise to fire
    // late, and one millisecond early reopened the whole defect — one refusal
    // still costs a full period. The slack absorbs exactly that.
    for (const jitter of [-1, -2, -50, -1_000]) {
      const { worstAge, fetches } = runCadence({ duration: 1_400, jitter });
      expect(worstAge).toBeLessThan(PERIOD);
      expect(fetches).toBe(8);
    }
  });
});

describe('prNextDueAt — one anchor for the cadence, another for a backoff', () => {
  it('measures the ordinary cadence from the fetch START', () => {
    // The fix, stated directly. A fetch that began at 1000 and ended at 2400 is
    // next due at 61_000 — NOT 62_400, which is past the tick meant to serve it.
    const due = prNextDueAt(1_000, null, 2_400);
    expect(due).toEqual({ at: 61_000, hard: false });
  });

  it('does not let a slow call push the next one out by its own duration', () => {
    // The property that matters, independent of any single number: the next due
    // time depends on when we asked, never on how long the answer took.
    for (const duration of [0, 1_400, 20_000]) {
      expect(prNextDueAt(1_000, null, 1_000 + duration).at).toBe(61_000);
    }
  });

  it('measures a rate-limit backoff from NOW, and marks it hard', () => {
    // The host's "wait 90 seconds" starts when it said so, not when we asked —
    // so this one anchor legitimately uses the finish, and says it is a floor.
    const due = prNextDueAt(1_000, 90_000, 2_400);
    expect(due).toEqual({ at: 92_400, hard: true });
  });

  it('returns an ordinary failure to the ordinary cadence', () => {
    // A VPN blip is not a quota. It rejoins the normal rhythm on the normal
    // anchor and is NOT hard — a blip must not buy a stricter gate.
    const due = prNextDueAt(1_000, null, 5_000);
    expect(due).toEqual({ at: 61_000, hard: false });
  });
});

describe('prGateOpen — a cadence target bends, a host backoff does not', () => {
  it('honours a cadence tick arriving fractionally early', () => {
    // The soft case: this tick is the one the period is entitled to.
    expect(prGateOpen(60_000, false, 59_999)).toBe(true);
    expect(prGateOpen(60_000, false, 59_000)).toBe(true);
  });

  it('refuses a cadence tick that is early by more than the slack', () => {
    // A tolerance on a clock, not a licence to fetch sooner. Two percent of the
    // period; a tick half a period early is a bug, not jitter.
    expect(prGateOpen(60_000, false, 30_000)).toBe(false);
    expect(prGateOpen(60_000, false, 0)).toBe(false);
  });

  it('holds a rate-limit backoff for its FULL delay, with no slack at all', () => {
    // THE load-bearing negative, and the reason `hard` exists. The gate is what
    // turns a rate limit into a wait rather than a tighter loop; calling one
    // millisecond before the host's reset spends quota to be refused again.
    // A single tolerance wide enough for timer jitter would shave exactly this.
    expect(prGateOpen(60_000, true, 59_999)).toBe(false);
    expect(prGateOpen(60_000, true, 59_000)).toBe(false);
    expect(prGateOpen(60_000, true, 60_000)).toBe(true);
  });

  it('holds a backoff that expires just after an ordinary tick', () => {
    // The concrete way a blanket slack would break it: a 61 s reset with ticks
    // at 60 s and 120 s. Soft would fire at 60 s — a second early, into a closed
    // door. Hard waits for the next tick, which is what the backoff asked for.
    expect(prGateOpen(61_000, true, 60_000)).toBe(false);
    expect(prGateOpen(61_000, false, 60_000)).toBe(true);
  });

  it('holds the full 120 s ceiling backoff across two ordinary ticks', () => {
    // End to end with the real backoff calculator: the bare GraphQL exhaustion
    // message buys 120 s, and neither the 60 s tick nor the slack may cut it.
    const backoff = rateLimitBackoffMs('GraphQL: API rate limit already exceeded');
    const due = prNextDueAt(0, backoff, 0);
    expect(due.hard).toBe(true);
    expect(prGateOpen(due.at, due.hard, 60_000)).toBe(false);
    expect(prGateOpen(due.at, due.hard, 119_999)).toBe(false);
    expect(prGateOpen(due.at, due.hard, 120_000)).toBe(true);
  });
});
