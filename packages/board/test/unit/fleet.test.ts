import { describe, it, expect } from 'vitest';
import {
  classify, compareWithinGroup, draftNote, humanAge, rowPhase, rowsFromPulse,
  rateLimitBackoffMs,
} from '../../src/server/fleet.js';
import {
  DRAFT_PLAN_NOTE, ELIGIBLE_NOTE, toBoardPhase, type AgentRow, type FleetPulse,
} from '../../src/contract/schema.js';
import type { PrRecord } from '../../src/server/fleet.js';

// The classifier is where the tab's judgments live: which group a branch lands
// in IS the answer to "what should I do next". Tested as pure functions rather
// than through HTTP — a wrong group is a wrong answer no plumbing can fix.

const QUIET = 30;

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
    expect(classify('open', 'eligible', null, QUIET, null, true).group).toBe('not-started');
    expect(classify('deferred', 'eligible', null, QUIET, null, true).group).toBe('not-started');
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
      checks: 'pending', review: '', url: '',
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
      checks: 'pending', review: '', url: '',
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
      checks: 'pending', review: '', url: '',
    };
    const r = classify('wip', 'eligible', 3, QUIET, pr, false, 0, '', 'failed', '1');
    expect(r.group).toBe('waiting-on-machine');
  });
});

describe('draftNote — a draft PR that is red must say so', () => {
  const pr = (over: Partial<PrRecord> = {}): PrRecord => ({
    number: 131, head: 'idea/x', state: 'OPEN', draft: true, checks: 'green',
    review: '', url: '', ...over,
  });

  it('carries the check state inside the draft framing', () => {
    // Found on this plan's own PR: #131 reported `checks: failing` and the row
    // rendered `PR #131, draft`. The shortcut answered for EVERY draft, so a
    // green draft and a red one produced the identical note.
    expect(draftNote(pr({ checks: 'failing' }))).toContain('draft');
    expect(draftNote(pr({ checks: 'failing' }))).toMatch(/checks failing/);
    expect(draftNote(pr({ checks: 'pending' }))).toMatch(/CI running/);
    expect(draftNote(pr({ checks: 'none' }))).toMatch(/no checks/);
    expect(draftNote(pr({ checks: 'unknown' }))).toMatch(/unavailable/);
  });

  it('says nothing extra for a green draft', () => {
    // "PR #131, draft" already means *not ready for you*; appending "checks
    // green" would put the reassuring word on the row whose point is that it is
    // unfinished. Every other value is a reason to look, so every other value
    // is said.
    expect(draftNote(pr({ checks: 'green' }))).toBe('PR #131, draft');
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
    checks: 'green', review: '', url: 'https://host/pr/99', ...over,
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
    expect(rows.find((r) => r.branch === 'feature/b')?.pr)
      .toEqual({ number: 7, url: 'https://example.test/pr/7' });
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
    expect(rows.find((r) => r.branch === 'feature/b')?.pr).toEqual({ number: 7, url: '' });
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
  const pr = (over: Partial<PrRecord> = {}): PrRecord => ({
    number: 42, head: 'feature/x', state: 'OPEN', draft: false, checks: 'green', review: '',
    url: 'https://example.test/pr/42', ...over,
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

  it('treats unknown check state as unavailable, never as green', () => {
    // Bitbucket carries no rollup. An honest gap beats an invented verdict.
    const r = classify('wip', 'eligible', 3, QUIET, pr({ checks: 'unknown' }));
    expect(r.group).toBe('waiting-on-you');
    expect(r.note).toMatch(/unavailable/);
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
