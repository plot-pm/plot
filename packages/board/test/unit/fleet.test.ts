import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';
import {
  classify, compareWithinGroup, draftNote, humanAge, prState, prStates, rowPhase, rowsFromPulse,
  rateLimitBackoffMs,
  graphqlResetMs,
  prGateOpen,
  prNextDueAt,
  prRefreshMsFor,
  prRequestsPerRefresh,
  prAsksNobody,
  prOutranks,
  waitingOnFor,
  withEstate,
  estateReport,
} from '../../src/server/fleet.js';
import {
  AgentRowSchema, DRAFT_PLAN_NOTE, ELIGIBLE_NOTE, PR_UNKNOWN_NOTE, toBoardPhase, unknownPhaseNote,
  type AgentRow, type FleetReading,
} from '../../src/contract/schema.js';
import { showsWorkerLog } from '../../src/app/components/AgentList.js';
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

  it('puts an OPEN branch with a dirty worktree into not-started, not working', () => {
    // WORKING IS ABOUT AGENTS. A dirty worktree without a known worker is
    // evidence of local activity — a person editing in this checkout — but it
    // is not evidence of an agent. The section means *who is working*, and
    // `worker: 'none'` does not answer that. See `every-section-has-one-subject`.
    const r = classify('open', 'eligible', null, 60, null, true, 0, 'approved', 'none', null, 0, false);
    expect(r.group).toBe('not-started');
    expect(r.note).toContain('uncommitted');
  });

  it('puts an OPEN branch with a LOCKED worktree into not-started', () => {
    // WORKING IS ABOUT AGENTS. A lock without a known worker is evidence of
    // local activity, not of an agent. See `every-section-has-one-subject`.
    const r = classify('open', 'eligible', null, 60, null, false, 0, 'approved', 'none', null, 0, true);
    expect(r.group).toBe('not-started');
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

  it('sends a ready green PR to waiting-on-you while its worker runs', () => {
    // THE #389/#390/#391 FIX. A ready (non-draft) green PR says "I am finished
    // and need review" — it IS somebody's errand, whatever the worker is doing.
    // The row goes to waiting-on-you so a reviewer can see it.
    const r = classify('wip', 'eligible', 5, 60, greenPr, false, 0, 'approved', 'running', null, 7);
    expect(r.group).toBe('waiting-on-you');
    expect(r.note).toContain('green');
  });

  it('keeps a green DRAFT PR in working while its worker runs', () => {
    // THE 2026-08-17 FIX, still correct. A draft says "I am not finished" — it
    // is the author's, and here the author is the agent. A green draft with a
    // live worker is the clearest possible WORKING row.
    const draftGreenPr = { ...greenPr, draft: true };
    const r = classify('wip', 'eligible', 5, 60, draftGreenPr, false, 0, 'approved', 'running', null, 7);
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

describe('prAsksNobody — drafts and pending ask nobody, green asks for review', () => {
  const mk = (over: Record<string, unknown>) => ({
    number: 1, url: '', draft: false, state: 'OPEN', checks: 'green',
    mergeable: 'mergeable', failing_checks: [], ...over,
  } as never);

  it('says yes for drafts — a draft is still the author\'s', () => {
    expect(prAsksNobody(mk({ draft: true }))).toBe(true);
    expect(prAsksNobody(mk({ draft: true, checks: 'pending' }))).toBe(true);
    expect(prAsksNobody(mk({ draft: true, checks: 'failing' }))).toBe(true);
    expect(prAsksNobody(mk({ draft: true, checks: 'none' }))).toBe(true);
    expect(prAsksNobody(mk({ draft: true, mergeable: 'conflicting' }))).toBe(true);
  });

  it('says yes for pending — CI is running, no person can review yet', () => {
    expect(prAsksNobody(mk({ checks: 'pending' }))).toBe(true);
  });

  it('says NO for a green non-draft — it needs review', () => {
    // The #389/#390/#391 fix: three ready green PRs sat reviewable and
    // invisible because they were treated as "asking nobody".
    expect(prAsksNobody(mk({}))).toBe(false);
  });

  it('says no for every errand-state — a blocklist would fail silently', () => {
    // `conflicts` wants a rebase, `failing` a look, `none` a click, `unknown`
    // asking again. These reach the PR arm regardless of prAsksNobody, but
    // the predicate should be explicit about them.
    expect(prAsksNobody(mk({ mergeable: 'conflicting' }))).toBe(false);
    expect(prAsksNobody(mk({ checks: 'failing' }))).toBe(false);
    expect(prAsksNobody(mk({ checks: 'none' }))).toBe(false);
    expect(prAsksNobody(mk({ mergeable: 'unknown' }))).toBe(false);
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

  it('answers nothing for a Draft plan, which no longer reaches this section', () => {
    // The arm that used to answer `you` here is GONE, and its absence is the
    // fix rather than a regression. A Draft plan's open branches now leave
    // NOT STARTED entirely — `classify` sends the plan to WAITING ON YOU — so
    // the group guard answers first and this function is never consulted.
    //
    // The old concern was that a four-wave Draft plan would put four loud rows
    // on the board for ONE pending approval. The move answers it better: it
    // puts none.
    //
    // Asserted through the GROUP the row actually carries, because that is what
    // the caller passes. A Draft row arriving here as `not-started` would be
    // the two functions disagreeing, which is the drift this pairing prevents.
    expect(waitingOnFor('waiting-on-you', 'open', 'eligible', 'draft')).toBe(null);
    expect(waitingOnFor('waiting-on-you', 'open', 'blocked', 'draft')).toBe(null);
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
  //
  // WORKING IS ABOUT AGENTS. A claim with no known worker is NOT STARTED —
  // an agent may take this, the claim ref exists but nobody has proven a
  // worker is running. See `every-section-has-one-subject`.
  it('puts a fresh claim without a known worker into not-started', () => {
    const r = classify('claimed', 'eligible', 3, QUIET);
    expect(r.group).toBe('not-started');
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

  // WORKING IS ABOUT AGENTS. A recent commit without a known worker is NOT
  // STARTED — an agent may take this. See `every-section-has-one-subject`.
  it('puts a recent commit without a known worker into not-started, stale to quiet', () => {
    expect(classify('wip', 'eligible', 5, QUIET).group).toBe('not-started');
    expect(classify('wip', 'eligible', 200, QUIET).group).toBe('quiet');
  });

  it('respects the configured quiet window for the not-started/quiet boundary', () => {
    // The default is a guess; a repo whose agents think for an hour raises it.
    // WORKING IS ABOUT AGENTS, so the boundary is now not-started vs quiet.
    expect(classify('wip', 'eligible', 45, 30).group).toBe('quiet');
    expect(classify('wip', 'eligible', 45, 60).group).toBe('not-started');
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

  // WORKING IS ABOUT AGENTS. Local activity without a known worker goes to
  // NOT STARTED, not WORKING. The note names the evidence as LOCAL, because
  // that is what a reader needs to judge it. See `every-section-has-one-subject`.
  it('puts a stale CLAIM with a dirty worktree into not-started', () => {
    const r = classify('claimed', 'eligible', QUIET + 1, QUIET, null, true);
    expect(r.group).toBe('not-started');
    expect(r.note).toMatch(/local/);
    expect(r.note).toMatch(/uncommitted/);
  });

  it('puts a stale WIP branch with a dirty worktree into not-started', () => {
    // All six quiet rows on the board the day this was found were `wip` with
    // 22-day-old commits, not `claimed`. A dirty worktree means the same thing
    // whatever put the branch there.
    const r = classify('wip', 'eligible', 30_300, QUIET, null, true);
    expect(r.group).toBe('not-started');
    expect(r.note).toMatch(/local/);
  });

  it('puts a claim with unknown age but a dirty worktree into not-started', () => {
    // Without an age the claim arm falls to quiet because there is nothing to
    // judge. A dirty worktree is something to judge — but still NOT STARTED
    // because WORKING IS ABOUT AGENTS.
    expect(classify('claimed', 'eligible', null, QUIET, null, true).group).toBe('not-started');
    expect(classify('wip', 'eligible', null, QUIET, null, true).group).toBe('not-started');
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
    // WORKING IS ABOUT AGENTS. An `open` branch with a dirty worktree but no
    // known worker goes to NOT STARTED — it is local activity, not proof an
    // agent is running. See `every-section-has-one-subject`.
    expect(classify('open', 'eligible', null, QUIET, null, true).group).toBe('not-started');
    // A branch with a recent commit but no known worker also goes to NOT STARTED.
    const fresh = classify('wip', 'eligible', 5, QUIET, null, true);
    expect(fresh.group).toBe('not-started');
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

  // WORKING IS ABOUT AGENTS. Unpushed commits without a known worker go to
  // NOT STARTED — local activity, not proof an agent is running.
  // See `every-section-has-one-subject`.
  it('puts a CLAIM with unpushed commits into not-started', () => {
    const r = classify('claimed', 'eligible', QUIET + 1, QUIET, null, false, 3);
    expect(r.group).toBe('not-started');
    // The note says how many, and names the evidence as local — work nobody else
    // can see, claimed on grounds the next person cannot verify.
    expect(r.note).toMatch(/3 commits not pushed/);
    expect(r.note).toMatch(/local/);
    // And it is a COUNT, never an age: "2 commits not pushed" names an action,
    // which no timestamp can.
    expect(r.note).not.toMatch(/ago/);
  });

  it('puts a stale WIP branch with unpushed commits into not-started', () => {
    const r = classify('wip', 'eligible', 30_300, QUIET, null, false, 1);
    expect(r.group).toBe('not-started');
    // Singular, because a note that reads "1 commits" is the kind of thing a
    // reader stops trusting.
    expect(r.note).toMatch(/1 commit not pushed/);
  });

  it('puts a claim with unknown age but unpushed commits into not-started', () => {
    expect(classify('claimed', 'eligible', null, QUIET, null, false, 2).group).toBe('not-started');
    expect(classify('wip', 'eligible', null, QUIET, null, false, 2).group).toBe('not-started');
  });

  it('says BOTH facts when a branch is dirty AND ahead, unpushed first', () => {
    // They are different facts and the pair changes the advice: *push this*
    // versus *push this, and someone is still working*. Suppressing a true fact
    // because a second outranks it is the displacement `deferred` used to cause
    // to the note text.
    const r = classify('wip', 'eligible', 30_300, QUIET, null, true, 2);
    expect(r.group).toBe('not-started');
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

  // --- A WORKTREE HOLDING A BRANCH IS SOMEBODY WORKING ---------------------
  //
  // THE MEASUREMENT, 2026-08-20. Three worktrees each held one commit with a
  // clean tree. The board printed `WORKING: none — nothing to do, just look`
  // and offered all three branches as *eligible — nobody has taken it*, which
  // invites a second agent onto finished work. `plot-dispatch.sh --dry-run`
  // did exactly that.
  //
  // WHY THE WORKTREE AND NOT `local_ahead`. For a branch with no upstream,
  // `local_ahead` is 0 — and correctly so: `local_ahead_of` compares against
  // `origin/<branch>`, which does not exist, and a test named *a MISSING
  // upstream is detected, not read as zero* pins that 0 as "could not compare"
  // rather than "no commits". So the commit count cannot see these branches at
  // all. `local_worktree` can, and it is the better signal anyway: a worktree
  // exists on purpose, while a commit count cannot separate an agent at work
  // from a leftover local ref.
  //
  // The LIFT NOW READS `held`, the scan's derived boolean, rather than the raw
  // worktree path #258 first passed. `held` is the path AND an unmerged tip, so
  // it does not fire on a leftover worktree left on a merged branch — see the
  // block below for the case that separates the two.
  //
  // ONE-DIRECTIONAL, like every other local signal — it may only LIFT.

  // WORKING IS ABOUT AGENTS. A worktree holding a branch without a known
  // worker goes to NOT STARTED — local activity, not proof an agent is running.
  // See `every-section-has-one-subject`.
  it('puts an OPEN branch held by a worktree into not-started', () => {
    const r = classify('open', 'eligible', null, QUIET, null, false, 0,
      undefined, undefined, undefined, undefined, undefined, undefined,
      undefined, true);
    expect(r.group).toBe('not-started');
    expect(r.note).toMatch(/held in a local worktree/);
  });

  it('leaves an OPEN branch with NO worktree alone', () => {
    // Genuinely not started. This is also the row that keeps `local_ahead`
    // honest: commits without a worktree are a leftover local ref, and the
    // test below this block pins that they do not lift.
    const r = classify('open', 'eligible', null, QUIET, null, false, 0);
    expect(r.group).toBe('not-started');
  });

  it('prefers the dirty note over the held note when both are true', () => {
    // Dirtiness is the more specific fact — somebody is editing right now —
    // so it must not be replaced by the weaker "held".
    const r = classify('open', 'eligible', null, QUIET, null, true, 0,
      undefined, undefined, undefined, undefined, undefined, undefined,
      undefined, true);
    expect(r.group).toBe('not-started');
    expect(r.note).toMatch(/uncommitted/);
  });

  it('never downgrades a MERGED branch held by a worktree', () => {
    // The one-directional rule on the state most able to expose a violation:
    // the work is done, and a leftover worktree is not a reason to unsay it.
    // `held` is false for a merged branch anyway, but a stray true must not
    // unsay `done` either — so it is passed true here on purpose.
    const r = classify('merged', 'complete', 1, QUIET, null, false, 0,
      undefined, undefined, undefined, undefined, undefined, undefined,
      undefined, true);
    expect(r.group).toBe('done');
  });

  it('never DOWNGRADES a group on unpushed commits either', () => {
    // The one-directional rule for the new signal. Unpushed commits on a merged
    // branch are a follow-up somebody has not pushed — true, and not a reason to
    // unsay `done`.
    expect(classify('merged', 'complete', 1, QUIET, null, false, 4).group).toBe('done');
    expect(classify('open', 'eligible', null, QUIET, null, false, 4).group).toBe('not-started');
    expect(classify('deferred', 'eligible', null, QUIET, null, false, 4).group)
      .toBe('not-started');
    // WORKING IS ABOUT AGENTS. A branch with a recent commit but no known worker
    // goes to NOT STARTED. See `every-section-has-one-subject`.
    const fresh = classify('wip', 'eligible', 5, QUIET, null, false, 4);
    expect(fresh.group).toBe('not-started');
    expect(fresh.note).toMatch(/last commit/);
  });

  // --- HELD IS THE AUTHORITATIVE SIGNAL, NOT THE RAW WORKTREE PATH -----------
  //
  // #258 lifted a held branch out of NOT STARTED by reading `local_worktree !==
  // ''`. #266 then added `held` — `local_worktree` AND the tip is not merged —
  // precisely because the path alone also fires on a leftover worktree left on
  // a branch whose work has already landed. This branch feeds the consumer the
  // derived boolean rather than re-deriving `!merged` from the path here.
  //
  // The difference is measurable on ONE branch: a squash-merged-and-deleted
  // branch reads `open` (its ref is gone, so the merge is invisible to a plain
  // ancestry walk), yet a clean worktree left on it is debris, not somebody
  // working. `local_worktree` says lift it; `held` — which the scan set false
  // after excluding `merged` — says leave it. The consumer must obey `held`.
  //
  // `held` is arg 16, the newest, appended after `localWorktree` (arg 15) by the
  // same rule every local signal here follows: last, because inserting it
  // mid-list shifts every spread caller past the compiler.

  // WORKING IS ABOUT AGENTS. A held branch without a known worker goes to
  // NOT STARTED — local activity, not proof an agent is running.
  it('puts a COMMITTED, CLEAN held branch into not-started', () => {
    const r = classify('open', 'eligible', null, QUIET, null, false, 0,
      undefined, undefined, undefined, undefined, undefined, undefined,
      undefined, true);
    expect(r.group).toBe('not-started');
    expect(r.note).toMatch(/held in a local worktree/);
  });

  it('never offers a held branch with the eligible note', () => {
    // A held branch is not *nobody has taken it* — it has local activity.
    const r = classify('open', 'eligible', null, QUIET, null, false, 0,
      undefined, undefined, undefined, undefined, undefined, undefined,
      undefined, true);
    expect(r.note).not.toBe(ELIGIBLE_NOTE);
  });

  it('does NOT lift a clean leftover worktree on a merged-but-open branch', () => {
    // The squash-merged-and-deleted case. A worktree is present but the scan set
    // `held: false` after excluding the merged tip, so this is debris. The old
    // path-only lift fired here — the merged-leftover misread the plan forbids —
    // and `held: false` is what draws the line, keeping it in NOT STARTED.
    const r = classify('open', 'eligible', null, QUIET, null, false, 0,
      undefined, undefined, undefined, undefined, undefined, undefined,
      undefined, false);
    expect(r.group).toBe('not-started');
    expect(r.note).toBe(ELIGIBLE_NOTE);
  });

  it('keeps the dirty note above held even when held is true', () => {
    // Dirtiness is the more specific fact and still wins — held may only lift a
    // quiet branch, never replace a louder signal.
    const r = classify('open', 'eligible', null, QUIET, null, true, 0,
      undefined, undefined, undefined, undefined, undefined, undefined,
      undefined, true);
    expect(r.group).toBe('not-started');
    expect(r.note).toMatch(/uncommitted/);
  });

  it('never downgrades a MERGED branch on held', () => {
    // One-directional, on the state most able to expose a violation. `held` is
    // false here anyway (the scan excludes merged), but a stray true must still
    // not unsay `done`.
    const r = classify('merged', 'complete', 1, QUIET, null, false, 0,
      undefined, undefined, undefined, undefined, undefined, undefined,
      undefined, true);
    expect(r.group).toBe('done');
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

  // WORKING IS ABOUT AGENTS. A lock without a known worker goes to NOT STARTED
  // — local activity, not proof an agent is running. See `every-section-has-one-subject`.
  it('puts a quiet CLAIM with a lock into not-started', () => {
    const r = classify('claimed', 'eligible', QUIET + 1, QUIET, ...LOCKED);
    expect(r.group).toBe('not-started');
    expect(r.note).toMatch(/write is in progress/);
    // Named as LOCAL, like every other signal only this machine can see.
    expect(r.note).toMatch(/local/);
  });

  it('puts a stale WIP branch with a lock into not-started', () => {
    const r = classify('wip', 'eligible', 30_300, QUIET, ...LOCKED);
    expect(r.group).toBe('not-started');
    expect(r.note).toMatch(/write is in progress/);
  });

  it('puts a branch with unknown age but a lock into not-started', () => {
    expect(classify('claimed', 'eligible', null, QUIET, ...LOCKED).group).toBe('not-started');
    expect(classify('wip', 'eligible', null, QUIET, ...LOCKED).group).toBe('not-started');
  });

  it('says the LOCK alone, not the other two facts beside it', () => {
    // A lock outranks both and does not append them. Under a lock the worktree
    // is mid-write, and the reader is being told to WAIT — where "2 commits not
    // pushed" tells them to act. Saying both would give one row two opposite
    // instructions.
    const r = classify('wip', 'eligible', 30_300, QUIET, null, true, 2,
      '', 'elsewhere', '', '', true);
    expect(r.group).toBe('not-started');
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
    // WORKING IS ABOUT AGENTS. A lock on an `open` branch without a known worker
    // goes to NOT STARTED — local activity, not proof an agent is running.
    expect(classify('open', 'eligible', null, QUIET, ...LOCKED).group).toBe('not-started');
    // A branch with a recent commit but no known worker goes to NOT STARTED.
    const fresh = classify('wip', 'eligible', 5, QUIET, ...LOCKED);
    expect(fresh.group).toBe('not-started');
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

  it('MOVES a drafted branch out of not-started, to WAITING ON YOU', () => {
    // REVERSED DELIBERATELY, and this test records the reversal rather than
    // being quietly deleted.
    //
    // It used to assert the group stayed `not-started`, reasoning that nobody
    // had taken the branch so the section was still right, and that moving the
    // row would hide work that was genuinely coming. The first half is true and
    // the second is answered by WHERE it moves: WAITING ON YOU is not a hiding
    // place, it is the section for work that needs a person — and a plan
    // awaiting approval needs exactly that.
    //
    // What the old reasoning missed is the section's own question. NOT STARTED
    // means *an agent may take this*, and `/plot-dispatch` refuses every branch
    // of a Draft plan. A row nobody may claim, filed under the one word that
    // says it can be, is the defect however accurate its note.
    expect(classify('open', 'eligible', null, QUIET, null, false, 0, 'draft').group)
      .toBe('waiting-on-you');
  });

  it('says the plan waits on approval, wherever its waves stand', () => {
    // The wave used to keep the first word on a Draft plan, as the more
    // specific of two true things. Once the plan leaves the section that
    // ordering is no longer a choice between notes: the row's section is
    // decided by the phase, and the note must say what THAT section is about.
    //
    // It is also the more useful sentence now. A reader in WAITING ON YOU is
    // looking for what they must do, and *an earlier wave* is not something
    // they can act on — the approval is.
    const r = classify('open', 'blocked', null, QUIET, null, false, 0, 'draft');
    expect(r.group).toBe('waiting-on-you');
    expect(r.note).toBe(DRAFT_PLAN_NOTE);
  });

  it('leaves the eligible sentence to APPROVED plans and unknown-phase pulses', () => {
    // Narrowed from "every phase but draft". `delivered` and `released` no
    // longer read as eligible — they are finished, and that is this branch's
    // whole subject — so the list that keeps the old sentence is now the two
    // cases that mean *an agent may take this*: an approved plan, and a pulse
    // that reported no phase at all.
    for (const phase of ['approved', '']) {
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

  it('changes no state but `open` and `deferred` on a draft plan', () => {
    // A drafted plan whose branches already carry work is drift worth SEEING,
    // not smoothing over — the same rule `rowPhase` follows where a plan's
    // bookkeeping lags its git state. The phase may only answer for a branch
    // that does not exist yet.
    //
    // `deferred` USED TO BE in this list — a draft plan's shelf classified
    // identically to an approved plan's, both in NOT STARTED. It no longer does:
    // a draft plan's shelved branch now leaves for WAITING ON YOU (the act it
    // waits on is the approval, which lives on the plan head), while an approved
    // plan's stays. So `deferred` joins `open` as an arm where the two phases
    // diverge, and it is asserted on its own above rather than smoothed over
    // here. What remains are the states where a draft plan carrying real work
    // must still read as work, not as a pending review.
    for (const args of [
      ['claimed', 'eligible', QUIET + 1],
      ['wip', 'eligible', 5],
      ['wip', 'eligible', 200],
      ['merged', 'complete', 1],
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

  // AN UNKNOWN PR WITHHOLDS THE VERDICT — Done-when 3 from
  // `an-unreachable-host-is-not-an-answer`.
  //
  // `unknown` is a GAP, not a state. The wave verdict from the scan says
  // `eligible`, but the host could not answer — a spent quota, an unreachable
  // server, a backend the board cannot ask. The row may not claim readiness
  // from a gap: `eligible` is an answer about the host, and the host did not
  // answer.
  it('withholds the verdict when the PR is unknown, even though the wave is eligible (Done-when 3)', () => {
    // The 17th parameter is `prUnknown` — see `classifyGroup`. When true and
    // the wave verdict would be `eligible`, the verdict is withheld.
    const r = classify(
      'open',    // state: no ref yet
      'eligible', // verdict from scan
      null,      // age
      QUIET,
      null,      // pr (not in open-only map)
      false, 0,  // localDirty, localAhead
      'approved', // planPhase
      'none',    // worker
      '',        // workerExit
      '',        // workerPid
      false,     // localLocked
      [],        // workerDirtyPaths
      '',        // workerQuestion
      false,     // held
      '',        // localWorktree
      true);     // prUnknown — the host could not be asked
    expect(r.group).toBe('waiting-on-you');
    expect(r.note).toBe(PR_UNKNOWN_NOTE);
    // The verdict is WITHHELD, not negated: it is null, not `blocked`.
    expect(r.verdict).toBeNull();
  });

  it('still says eligible when the PR is readable, even with prUnknown=false explicitly', () => {
    // The complement of the test above: when the host DID answer, the verdict
    // passes through. This pins that the parameter defaults to false and that
    // the check is only for `prUnknown && verdict === 'eligible'`.
    const r = classify(
      'open', 'eligible', null, QUIET,
      null, false, 0, 'approved', 'none', '', '', false, [], '', false, '', false);
    expect(r.group).toBe('not-started');
    expect(r.note).toBe(ELIGIBLE_NOTE);
    // The verdict IS passed through when the host answered.
    expect(r.verdict).toBe('eligible');
  });

  // Done-when 4 from `an-unreachable-host-is-not-an-answer`:
  // That row STILL reads `merged` where git says merged, and still names its
  // wave, plan and branch. Nothing git answers is withheld.
  it('still reads merged for a merged branch even when prUnknown is true (Done-when 4)', () => {
    // The branch merged — git answered. Only the PR is unknown, and the PR
    // does not decide a merged branch's group. This assertion is what stops
    // an over-fix: a naive implementation that blanks the row throws away
    // facts git answered.
    const r = classify(
      'merged', 'complete', 5, QUIET,
      null, false, 0, 'approved', 'none', '', '', false, [], '', false, '', true);
    expect(r.group).toBe('done');
    expect(r.note).toBe('merged');
  });

  it('does not withhold the verdict for a blocked wave even when prUnknown is true', () => {
    // `blocked` is the scan's answer about wave ordering, not about the host.
    // A blocked branch stays blocked whether or not the PR is readable.
    const r = classify(
      'open', 'blocked', null, QUIET,
      null, false, 0, 'approved', 'none', '', '', false, [], '', false, '', true);
    expect(r.group).toBe('not-started');
    expect(r.note).toMatch(/earlier wave/);
  });
});

describe('NOT STARTED shows Approved plans, and nothing else', () => {
  // THE SECTION'S OWN QUESTION, asked of the plan before it is asked of git.
  //
  // The board grouped by BRANCH STATE and never consulted the plan's phase, and
  // a branch with no ref reads as "never started" — which is true of a branch
  // nobody created and equally true of one deleted at merge four months ago.
  //
  // Measured on this board 2026-08-18, NOT STARTED held ten plans:
  //
  //     approved   3   <- the only ones /plot-dispatch will start
  //     draft      7   <- refused with "plan not approved yet"
  //     released   1   <- plot-sprint-support, shipped in v1.0.0-beta.3
  //
  // and after a hygiene sweep set 39 delivered plans to `Released`, twenty rows
  // with ten of them Released — each offering a merged branch as available
  // work. The sweep multiplied the defect rather than causing it.
  //
  // `Approved` is precisely the phase meaning *decided, not yet done*, and the
  // only one in which `/plot-dispatch` hands a branch to an agent. Every other
  // phase fails the section's question, so the fix is an INCLUSION rather than
  // three exclusions.
  //
  // Within `Approved`, branch state is still what refines the answer — that is
  // unchanged here, and deliberately: this is the first question, not a
  // replacement for the second.

  it('keeps an Approved plan\'s eligible branch exactly where it was', () => {
    // The row the section exists for, and the one thing that must not move.
    const r = classify('open', 'eligible', null, QUIET, null, false, 0, 'approved');
    expect(r.group).toBe('not-started');
    expect(r.note).toBe(ELIGIBLE_NOTE);
  });

  it('moves a DRAFT plan to WAITING ON YOU and names the approval', () => {
    // A draft waits on a PERSON — that is what the section means — and the note
    // says which action, because *blocked by what* is answered here by a review
    // rather than by another branch.
    const r = classify('open', 'eligible', null, QUIET, null, false, 0, 'draft');
    expect(r.group).toBe('waiting-on-you');
    expect(r.note).toBe(DRAFT_PLAN_NOTE);
    expect(r.note).toMatch(/approved|review/);
  });

  it('keeps a RELEASED plan out of not-started — the measured case', () => {
    // `plot-sprint-support`: Phase Released since v1.0.0-beta.3, one branch
    // with no ref because the work landed directly on main and no branch was
    // ever created. The board offered it as unstarted work for four months.
    const r = classify('open', 'eligible', null, QUIET, null, false, 0, 'released');
    expect(r.group).not.toBe('not-started');
    expect(r.group).toBe('done');
  });

  it('keeps a DELIVERED plan out of not-started too', () => {
    // The same statement one phase earlier: the work is done, so none of its
    // branches can be waiting for an agent whatever the refs say.
    const r = classify('open', 'eligible', null, QUIET, null, false, 0, 'delivered');
    expect(r.group).toBe('done');
  });

  it('places all four phases from ONE fixture, each in its documented section', () => {
    // The table from the plan, asserted as a table. Identical git state on all
    // four rows — `open`, no ref, an eligible wave — so the phase is provably
    // the only thing deciding the section.
    const sectionFor = (phase: string) =>
      classify('open', 'eligible', null, QUIET, null, false, 0, phase).group;
    expect(sectionFor('draft')).toBe('waiting-on-you');
    expect(sectionFor('approved')).toBe('not-started');
    expect(sectionFor('delivered')).toBe('done');
    expect(sectionFor('released')).toBe('done');
  });

  it('reads the phase from the PLAN and never infers it from the branches', () => {
    // Inferring is the defect. A Released plan whose branch has no ref looks
    // exactly like an Approved plan nobody started — that is the whole trap —
    // so an implementation guessing from `state` gets this pair identical.
    const released = classify('open', 'eligible', null, QUIET, null, false, 0, 'released');
    const approved = classify('open', 'eligible', null, QUIET, null, false, 0, 'approved');
    expect(released.group).not.toBe(approved.group);
  });

  it('is an ALLOWLIST — an unknown phase never becomes claimable', () => {
    // The shape `prAsksNobody` argues for in this file: a blocklist would
    // silently start claiming "an agent may take this" the first time a phase is
    // added. A phase nobody has taught the board about is not startable.
    expect(classify('open', 'eligible', null, QUIET, null, false, 0, 'abandoned').group)
      .not.toBe('not-started');
  });

  it('leaves a pulse that reports NO phase exactly as it was', () => {
    // The compatibility rule every parameter here follows: absent is not a
    // guess. A caller that could not look must answer as before rather than
    // have its rows swept out of the section — which would empty NOT STARTED
    // wholesale against an older scan.
    for (const phase of ['', undefined] as const) {
      const r = phase === undefined
        ? classify('open', 'eligible', null, QUIET)
        : classify('open', 'eligible', null, QUIET, null, false, 0, phase);
      expect(r.group).toBe('not-started');
      expect(r.note).toBe(ELIGIBLE_NOTE);
    }
  });

  it('answers on the PHASE before it asks about the wave', () => {
    // A blocked wave of a finished plan is not "blocked" — it is finished. The
    // wave verdict refines the answer WITHIN `approved`, and only there.
    expect(classify('open', 'blocked', null, QUIET, null, false, 0, 'released').group)
      .toBe('done');
    // ...while inside `approved` the wave still keeps the first word, unchanged.
    expect(classify('open', 'blocked', null, QUIET, null, false, 0, 'approved'))
      .toEqual(classify('open', 'blocked', null, QUIET, null, false, 0));
  });

  it('changes no state that carries real work — a commit, a claim, a merge', () => {
    // The phase may only answer for a branch that does not exist yet. A
    // finished plan whose branch carries commits, a claim or a PR is drift
    // worth SEEING rather than smoothing over — the same rule `rowPhase`
    // follows where a plan's bookkeeping lags its git state.
    //
    // `deferred` LEFT THIS LIST in the wave after #231, and it left for the
    // reason the list exists: it never carried real work. A deferred branch is
    // a DECISION — the plan set it aside — so there is no git fact here for a
    // phase check to smooth over. See *a deferred row answers to the phase
    // too* below for what it does instead.
    for (const args of [
      ['claimed', 'eligible', QUIET + 1],
      ['wip', 'eligible', 5],
      ['merged', 'complete', 1],
    ] as const) {
      const [state, verdict, age] = args;
      for (const phase of ['draft', 'delivered', 'released']) {
        expect(classify(state, verdict, age, QUIET, null, false, 0, phase))
          .toEqual(classify(state, verdict, age, QUIET, null, false, 0, 'approved'));
      }
    }
  });

  it('keeps a FINISHED plan out of WORKING, whatever its worktree holds', () => {
    // THE MIRRORED CASE, measured 2026-08-18 minutes after the NOT STARTED one:
    //
    //     WORKING (2)
    //       Released  not-yet-asked-is-not-not…  uncommitted work in a local worktree
    //       Released  one-place-for-what-a-ro…   uncommitted work in a local worktree
    //
    // Both PRs (#220, #224) merged and shipped in v2.5.2, and both workers were
    // dead. What the board read as *someone is working here* was leftover
    // scratch files — `agentlist_temp.tsx`, `.fleet_part1.js` — that the
    // workers wrote after pushing and never cleaned up.
    //
    // So the phase answers FIRST in every section, not only in this one. For a
    // Released plan the question *what would move this forward* has one answer,
    // *nothing — it is finished*, and *local debris is not work*.
    for (const phase of ['delivered', 'released']) {
      expect(classify('open', 'eligible', null, QUIET, null, true, 0, phase).group)
        .toBe('done');
      expect(classify('open', 'eligible', null, QUIET, null, false, 0, phase, 'elsewhere', '', '', true).group)
        .toBe('done');
    }
  });

  // WORKING IS ABOUT AGENTS. Local activity without a known worker goes to
  // NOT STARTED, not WORKING, regardless of wave state.
  it('puts a live worktree on a blocked wave into not-started', () => {
    expect(classify('open', 'blocked', null, QUIET, null, true, 0, 'approved').group)
      .toBe('not-started');
  });

  // WORKING IS ABOUT AGENTS. A draft plan's local activity without a known
  // worker goes to NOT STARTED.
  it('puts a DRAFT plan\'s live worktree into not-started', () => {
    expect(classify('open', 'eligible', null, QUIET, null, true, 0, 'draft').group)
      .toBe('not-started');
  });
});

describe('a deferred row answers to the phase too', () => {
  // WAVE 2 OF THE SAME RULE, and it exists because the rule had two doors and
  // #231 put a guard on one of them.
  //
  // Measured on the live board 2026-08-18, immediately after #231 merged:
  //
  //     NOT STARTED: 20 rows - 17 open, 3 deferred
  //       feature/the-pulse-repairs-the-artifact   plan phase: NONE
  //       feature/a-repaired-row-says-so           plan phase: approved
  //       feature/plot-sprint-support              plan phase: RELEASED
  //
  // The `open` rows moved as designed - three Released plans left the section.
  // The `deferred` rows did not, because `classify` answers them in an arm ABOVE
  // the one the phase check sits in: two routes into `not-started`, one guard.
  //
  // THE NARROWING IS EXACTLY THE TERMINAL PHASES, and no wider. A deferred
  // branch of an Approved plan genuinely waits on a person: somebody shelved it,
  // somebody may un-shelve it. A deferred branch of a RELEASED plan waits on
  // nobody - the plan shipped and the shelf is part of the history.

  it('keeps a deferred branch of a RELEASED plan out of not-started', () => {
    // THE MEASURED CASE. `feature/plot-sprint-support` was annotated `deferred`
    // because the branch was never created - February's work landed directly on
    // main - and its plan has read `Released` since v1.0.0-beta.3 in April.
    const r = classify('deferred', 'eligible', null, QUIET, null, false, 0, 'released');
    expect(r.group).not.toBe('not-started');
    expect(r.group).toBe('done');
  });

  it('keeps a deferred branch of a DELIVERED plan out of not-started too', () => {
    // The same statement one phase earlier, for the same reason: the work is
    // done, so nothing on the shelf is waiting for anyone to take it down.
    expect(classify('deferred', 'eligible', null, QUIET, null, false, 0, 'delivered').group)
      .toBe('done');
  });

  it('leaves a deferred branch of an APPROVED plan exactly where #231 left it', () => {
    // The previous wave's behaviour, unchanged and deliberately so. This is the
    // row the `deferred` arm was written for: a live plan, a branch handed back
    // to a person, and a person is what it still waits on.
    const r = classify('deferred', 'eligible', null, QUIET, null, false, 0, 'approved');
    expect(r.group).toBe('not-started');
    expect(waitingOnFor(r.group, 'deferred', 'eligible', 'approved')).toBe('you');
  });

  it('sends a deferred branch of a DRAFT plan to WAITING ON YOU, both verdicts', () => {
    // SUPERSEDED ARGUMENT, recorded rather than erased. This test used to pin a
    // deferred DRAFT branch in NOT STARTED, `waiting-on-you`, reasoning that a
    // shelved branch of a plan under review "waits on a person twice over -
    // approve the plan, un-shelve the branch". That is sound about the WAIT and
    // wrong about the SECTION. Both waits are on the SAME person for the SAME
    // next act - the approval - and NOT STARTED promises work an agent can TAKE
    // now, which a Draft branch cannot: no phase gate lets `/plot-dispatch`
    // start an unapproved plan. So the section's own hint ("approved - nobody
    // has taken it") does not hold for it, and the `open` arm already draws
    // exactly this line, sending a draft branch to WAITING ON YOU. The two arms
    // now agree: a Draft plan's branch is a person's to approve, wherever it
    // sits, and it belongs in the section that says so.
    for (const verdict of ['eligible', 'blocked'] as const) {
      const r = classify('deferred', verdict, null, QUIET, null, false, 0, 'draft');
      expect(r.group).toBe('waiting-on-you');
      expect(r.note).toBe(DRAFT_PLAN_NOTE);
      // The row leaves NOT STARTED, so `waitingOnFor`'s group guard answers null
      // for it - the plan-level act now lives on the plan head, gated on the
      // card's own `isDraft`, not on this field.
      expect(waitingOnFor(r.group, 'deferred', verdict, 'draft')).toBeNull();
    }
  });

  it('leaves a deferred row of a pulse reporting NO phase exactly as it was', () => {
    // Absent is not a guess - the compatibility rule every phase-reading line in
    // this file follows. A scan predating the field must answer as before rather
    // than have its shelved rows swept into DONE.
    //
    // **AND `''` IS NOT A TERMINAL PHASE.** `feature/the-pulse-repairs-the-artifact`
    // rendered `plan phase: NONE` in the measurement above - its plan could not
    // be resolved from the branch name at all. An unknown phase is not evidence
    // that a plan is finished, and filing it under DONE would be the same guess
    // in the opposite direction.
    for (const phase of ['', undefined] as const) {
      const r = phase === undefined
        ? classify('deferred', 'eligible', null, QUIET)
        : classify('deferred', 'eligible', null, QUIET, null, false, 0, phase);
      expect(r.group).toBe('not-started');
      expect(r.note).toBe('no commits');
    }
  });

  it('does not treat an UNRECOGNISED phase as finished', () => {
    // The allowlist, applied here as it is in the `open` arm: a phase the board
    // has not been taught is placed with its name said aloud, never silently
    // filed as shipped. `done` with the phase NAMED is the honest rendering -
    // the row sends a reader to the plan rather than answering for it.
    const r = classify('deferred', 'eligible', null, QUIET, null, false, 0, 'abandoned');
    expect(r.group).not.toBe('not-started');
    expect(r.note).toBe(unknownPhaseNote('abandoned'));
  });

  it('reads the phase from the PLAN, never from the deferred branch', () => {
    // Inferring is the defect this whole plan exists to remove. A deferred
    // branch of a Released plan and one of an Approved plan are bit-identical in
    // git - both have no ref and no commits - so an implementation guessing from
    // `state` returns the same answer for both.
    const released = classify('deferred', 'eligible', null, QUIET, null, false, 0, 'released');
    const approved = classify('deferred', 'eligible', null, QUIET, null, false, 0, 'approved');
    expect(released.group).not.toBe(approved.group);
  });

  it('answers on the phase whatever ELSE the deferred row carries', () => {
    // The deferred arm has three exits - a PR, a commit age, no commits - and the
    // phase must answer above all three rather than beside one. A shelved branch
    // of a shipped plan is finished whether it was shelved before any work, after
    // a commit, or with a PR still open.
    const pr = {
      number: 41, draft: false, state: 'OPEN', checks: 'green', mergeable: 'mergeable',
    } as PrRecord;
    for (const phase of ['delivered', 'released']) {
      expect(classify('deferred', 'eligible', null, QUIET, null, false, 0, phase).group).toBe('done');
      expect(classify('deferred', 'eligible', 4_320, QUIET, null, false, 0, phase).group).toBe('done');
      expect(classify('deferred', 'eligible', 12, QUIET, pr, false, 0, phase).group).toBe('done');
    }
  });

  it('is not outranked by local debris, exactly as the open arm is not', () => {
    // The mirrored measurement #231 recorded in WORKING: leftover scratch files
    // from a dead worker are not somebody working. A shelved branch of a shipped
    // plan with a dirty worktree is the same statement - local debris is not work.
    for (const phase of ['delivered', 'released']) {
      expect(classify('deferred', 'eligible', null, QUIET, null, true, 0, phase).group).toBe('done');
      expect(classify('deferred', 'eligible', null, QUIET, null, false, 0, phase, 'elsewhere', '', '', true).group)
        .toBe('done');
    }
  });

  it('keeps the open-row answers of #231 bit-identical', () => {
    // The previous wave's table, re-asserted here rather than trusted. This
    // wave touches a DIFFERENT arm, and the cheapest proof of that is the four
    // open-row placements answering exactly as they did.
    const sectionFor = (phase: string) =>
      classify('open', 'eligible', null, QUIET, null, false, 0, phase).group;
    expect(sectionFor('draft')).toBe('waiting-on-you');
    expect(sectionFor('approved')).toBe('not-started');
    expect(sectionFor('delivered')).toBe('done');
    expect(sectionFor('released')).toBe('done');
  });

  it('carries the section through rowsFromPulse for a deferred branch', () => {
    // The wiring `classify` alone cannot reach: the phase must travel from the
    // PLAN onto a deferred row, and the row's group must follow it. Same fixture
    // shape as the open-row wiring test, differing only in the branch state.
    const pulseWith = (phase: string): FleetReading => ({
      main: 'main',
      head: 'abc1234',
      plans: [{
        file: '2026-02-10-plot-sprint-support.md',
        phase,
        slices: [{
          name: 'Implementation', verdict: 'eligible',
          branches: [{ branch: 'feature/plot-sprint-support', state: 'deferred', deferred: true, claimed: '' }],
        }],
      }],
      summary: { plans: 1, waves: 1, branches: 1, claimed: 0, eligible: 0, blocked: 0, deferred: 1 },
    } as FleetReading);
    const rowsFor = (phase: string) =>
      rowsFromPulse(pulseWith(phase), new Map(), 'plot', QUIET);
    const rowFor = (phase: string) =>
      rowsFor(phase).find((r) => r.branch === 'feature/plot-sprint-support')!;

    // A RELEASED plan has drained: `plot-sprint-support` shipped in
    // v1.0.0-beta.3, and a shipped plan is out of the board's scope, so its
    // deferred branch yields NO row at all — not a DONE row. This is the
    // release-scope drain, one level down from the merged case: the phase
    // decides membership before the shelf refines a section it never reaches.
    expect(rowsFor('released')).toEqual([]);
    // A DELIVERED plan is unreleased — the core of the scope — and stays in
    // DONE. The `deferred` FACT survives the move, so the badge still has
    // something to render from; the phase decides the section, it does not
    // erase what the plan said about the branch.
    expect(rowFor('delivered').group).toBe('done');
    expect(rowFor('delivered').state).toBe('deferred');
    expect(rowFor('approved').group).toBe('not-started');
    expect(rowFor('approved').waitingOn).toBe('you');
  });
});

describe('the section follows the plan through rowsFromPulse', () => {
  // The wiring `classify` alone cannot reach: the phase must travel from the
  // PLAN onto each of its rows, and the row's own group must follow it.
  const pulseWith = (phase: string): FleetReading => ({
    main: 'main',
    head: 'abc1234',
    plans: [{
      file: '2026-08-15-example-plan.md',
      phase,
      slices: [{
        name: 'Implementation', verdict: 'eligible',
        branches: [{ branch: 'feature/c', state: 'open', deferred: false, claimed: '' }],
      }],
    }],
    summary: { plans: 1, waves: 1, branches: 1, claimed: 0, eligible: 1, blocked: 0, deferred: 0 },
  } as FleetReading);

  const rowsFor = (phase: string) =>
    rowsFromPulse(pulseWith(phase), new Map(), 'plot', QUIET);
  const rowFor = (phase: string) =>
    rowsFor(phase).find((r) => r.branch === 'feature/c')!;

  it('places each phase in its documented section, end to end', () => {
    expect(rowFor('draft').group).toBe('waiting-on-you');
    expect(rowFor('approved').group).toBe('not-started');
    expect(rowFor('delivered').group).toBe('done');
    // A RELEASED plan has drained — DONE is the release scope, and a shipped
    // plan is out of it — so it contributes NO row rather than a DONE one.
    expect(rowsFor('released')).toEqual([]);
  });

  it('changes section on the next pulse when a plan is approved — nothing to clear', () => {
    // DERIVED, NEVER STORED. Two scans of the SAME fixture differing only in
    // the phase, which is exactly what approving a plan changes. A stored flag
    // passes the test above and fails this one; a restart must not be required.
    expect(rowFor('draft').group).toBe('waiting-on-you');
    expect(rowFor('approved').group).toBe('not-started');
    expect(rowFor('approved').note).toBe(ELIGIBLE_NOTE);
  });

  it('reports nothing to wait for once a row has left the section', () => {
    // `waitingOn` is null outside `not-started` by construction — derived from
    // the group rather than re-decided — so a Draft row moving to WAITING ON
    // YOU cannot keep a colour that says it is claimable.
    //
    // `delivered`, not `released`: a released plan yields no row to ask (the
    // release-scope drain), so a DELIVERED row — landed in DONE, still on the
    // board — is the example of a row that left NOT STARTED and dropped its
    // wait.
    expect(rowFor('draft').waitingOn).toBe(null);
    expect(rowFor('delivered').waitingOn).toBe(null);
    expect(rowFor('approved').waitingOn).toBe('click');
  });
});

describe('rowPhase — derived from the PAIR, never from the plan file alone', () => {
  // The whole reason this function exists rather than a field carried straight
  // through: reading the plan file alone produces rows that contradict
  // themselves, and the repo had the example sitting in it.

  it('walks a same-branch plan Discovery → Development as its plan moves', () => {
    // `board-ui-polish` is the case that made this concrete: its plan was
    // written, interrogated and approved ON the branch an agent then built on,
    // so one row passed through Discovery and then Development. Design is no
    // longer a stop on this path — it is its own phase, entered deliberately
    // for a spike, not a state an approved-unstarted row falls into.
    expect(rowPhase('draft', 'wip')).toBe('Discovery');
    expect(rowPhase('approved', 'claimed')).toBe('Development');
    expect(rowPhase('approved', 'wip')).toBe('Development');
  });

  it('reads a Design plan as Design on its rows', () => {
    // Design is a real phase now. A row for a plan in Design says Design
    // whatever its branch state — the work is human-led and git does not
    // promote it out.
    expect(rowPhase('design', 'open')).toBe('Design');
    expect(rowPhase('design', 'wip')).toBe('Design');
    expect(rowPhase('design', 'merged')).toBe('Design');
    expect(rowPhase('design', 'deferred')).toBe('Design');
  });

  it('reads an approved plan as Development on every branch state', () => {
    // The opus5 shape that motivated this derivation — Phase: Approved, zero
    // Started: records, real commits on six branches — no longer diverges: an
    // approved plan is Development whether the branch has work, an empty claim,
    // or nothing. The board card and the row agree by construction, which is
    // what the Design-is-a-phase change bought.
    expect(rowPhase('approved', 'wip')).toBe('Development');
    expect(rowPhase('approved', 'merged')).toBe('Development');
    expect(rowPhase('approved', 'claimed')).toBe('Development');
    expect(rowPhase('approved', 'open')).toBe('Development');
  });

  it('keeps a delivered plan at Testing when a late commit lands', () => {
    // "git wins" is about an ABSENT record, not about overruling a recorded
    // decision. A missing `Started:` line is nobody having written something
    // down; a commit after delivery contradicts something a human wrote, and a
    // follow-up fix does not repeal it.
    //
    // Load-bearing: the SYMMETRIC implementation — git evidence overriding the
    // plan in both directions — passes every other test in this file and fails
    // only here. Without it, a plan goes visibly backwards for a typo fix.
    expect(rowPhase('delivered', 'wip')).toBe('Testing');
    expect(rowPhase('delivered', 'merged')).toBe('Testing');
    expect(rowPhase('released', 'wip')).toBe('Released');
  });

  it('reads a deferred branch from the plan phase, git ignored', () => {
    // `deferred` is not "paused, resuming later": the vocabulary says the
    // branch isn't needed and was given up deliberately, and /plot-deliver
    // skips deferred branches in its completeness gate. So the row is read from
    // the plan's own phase, not from whatever commits the branch carries.
    //
    // With the Design fork gone, an approved plan is Development whether or not
    // its branch was handed back — the divergence this case once produced
    // (Development for real commits vs Design for a deferred one) is gone. The
    // `deferred` FACT is not lost: it rides the `state` badge, not the phase.
    expect(rowPhase('approved', 'deferred')).toBe('Development');
    expect(rowPhase('draft', 'deferred')).toBe('Discovery');
  });

  it('leaves a deferred branch alone once the plan is past deciding', () => {
    expect(rowPhase('delivered', 'deferred')).toBe('Testing');
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
    for (const p of ['draft', 'design', 'approved', 'delivered', 'released', 'rejected', '']) {
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
    // THE WORDING MOVED, THE CLAIM DID NOT. `failed` read *worker failed* until
    // 2026-08-20 and now reads *worker crashed*, because the note states what
    // was observed rather than what to do — see `broken-agent.test.ts`. What
    // this test has always asserted is that the two states are not one label,
    // and that is checked above, on the notes themselves.
    expect(failed.note).toMatch(/crashed/);
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
    // *not recorded* rather than *unknown* since 2026-08-20 — the same claim in
    // the words of the thing observed: what is missing is the RECORD. The
    // assertion that matters is that it never reads as success, below.
    expect(r.note).toMatch(/not recorded/);
    expect(r.note).not.toMatch(/finished|success/);
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
    // WORKING IS ABOUT AGENTS — a claim with no known worker goes to NOT STARTED.
    const r = classify('claimed', 'eligible', 3, QUIET, null, false, 0, '', 'none', '', '0');
    expect(r.group).toBe('not-started'); // no known worker, so NOT STARTED
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
    // WORKING IS ABOUT AGENTS. A claim with no known worker goes to NOT STARTED
    // — we do NOT say "dead" or "nobody", but we also do not say WORKING.
    const r = classify('claimed', 'eligible', 3, QUIET, null, false, 0, '', 'none');
    expect(r.group).toBe('not-started');
    expect(r.note).not.toMatch(/dead|nobody/i);
  });

  it('leaves a caller that passes no worker at all answering as before', () => {
    // Every caller predating the field. WORKING IS ABOUT AGENTS — no known
    // worker means NOT STARTED for a fresh claim or recent commit.
    expect(classify('claimed', 'eligible', 3, QUIET).group).toBe('not-started');
    expect(classify('claimed', 'eligible', QUIET + 1, QUIET).group).toBe('quiet');
    expect(classify('wip', 'eligible', 5, QUIET).group).toBe('not-started');
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
  const pulse: FleetReading = {
    main: 'main',
    head: 'abc1234',
    plans: [{
      file: '2026-08-15-example-plan.md',
      slices: [
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
    const drafted: FleetReading = {
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

  describe('a branch row carries its PR link', () => {
    // The reported defect: on the board the plan name is a link and the branch
    // name beside it is inert text. Measured on one pulse — zero of seven branch
    // rows held a `pr` field, so it was not a styling omission the UI could
    // correct.
    //
    // The cause is one filter. `prs` is OPEN-only, deliberately, so that a
    // merged PR never reaches `classify` and reopens a question the merge
    // closed. But the same map decided the row's LINK, and there the filter
    // drops exactly the PRs a reader still wants to open.

    const merged = pr({
      number: 252, head: 'feature/a', state: 'MERGED',
      // What GitHub actually reports for a merged PR: mergeability stops being
      // computed once the branch lands. Verified against the live host.
      mergeable: 'unknown', url: 'https://host/pr/252',
    });

    it('carries the number and the URL of a MERGED PR whose ref is gone', () => {
      // The case the brief names and the whole reason for the second map:
      // #252/#253/#254 are merged with their refs deleted, and the PR page is
      // still there. The PR outlives the branch, so the link must too.
      const rows = rowsFromPulse(
        pulse, ages, 'plot', QUIET, new Map(), '', null, Date.now(), null, null, null, null,
        new Map([['feature/a', merged]]));
      const row = rows.find((r) => r.branch === 'feature/a')!;
      expect(row.pr).not.toBeNull();
      expect(row.pr!.number).toBe(252);
      expect(row.pr!.url).toBe('https://host/pr/252');
      // The row still reads `merged` — the link is ADDED to what git said, not
      // a substitute for it. Feeding the merged PR to `classify` would have been
      // the other way to get the number here, and it would reopen the question.
      expect(row.state).toBe('merged');
    });

    it('carries no PR at all where the head has none, and never a dead link', () => {
      // The mirror, and the half that keeps the assertion above about the LINK
      // rather than about a default. `feature/c` is `open` with no PR anywhere.
      const rows = rowsFromPulse(
        pulse, ages, 'plot', QUIET, new Map(), '', null, Date.now(), null, null, null, null,
        new Map([['feature/a', merged]]));
      expect(rows.find((r) => r.branch === 'feature/c')!.pr).toBeNull();
    });

    it('keeps the OPEN map as the only thing classify is told about', () => {
      // The separation stated as a test. The link map holds a merged PR for
      // `feature/b`, whose git state is `wip`; if that record reached `classify`
      // the row would be grouped by a merge that has not happened to this
      // branch. The number must arrive without the verdict coming with it.
      const rows = rowsFromPulse(
        pulse, ages, 'plot', QUIET, new Map(), '', null, Date.now(), null, null, null, null,
        new Map([['feature/b', pr({ number: 300, head: 'feature/b', state: 'MERGED' })]]));
      const row = rows.find((r) => r.branch === 'feature/b')!;
      expect(row.pr!.number).toBe(300);
      // Grouped from git and the wave, exactly as it was before the link map:
      // a `wip` branch in an eligible wave is somebody's work in progress.
      expect(row.state).toBe('wip');
      expect(row.group).not.toBe('done');
    });

    it('leaves every existing caller unchanged when no link map is passed', () => {
      // The parameter is last and optional, so the open map answers both
      // questions exactly as it did. A caller that did not look gets no number
      // — which is honest — rather than a guess.
      const rows = rowsFromPulse(pulse, ages, 'plot', QUIET, new Map());
      expect(rows.find((r) => r.branch === 'feature/a')!.pr).toBeNull();
    });

    it('prefers an OPEN PR over a closed one on the same head', () => {
      // A head can carry several PRs over its life — a closed attempt and its
      // successor. The live one is what a reader can act on; linking the closed
      // one sends them to a dead page while the review sits one number away.
      //
      // Asserted through `prOutranks` because that is where the rule lives, and
      // in BOTH argument orders: an implementation that merely took the last
      // record seen would pass a single-order test against a fixed listing.
      const open = pr({ number: 10, head: 'feature/a', state: 'OPEN' });
      const closed = pr({ number: 11, head: 'feature/a', state: 'CLOSED' });
      expect(prOutranks(open, closed)).toBe(true);
      expect(prOutranks(closed, open)).toBe(false);
    });

    it('ranks a lone closed PR the winner — which is why the row must not link it', () => {
      // THE GAP THE RANK CANNOT CLOSE. `prOutranks` decides which of the PRs a
      // head carries is best; it never asks whether the best is worth showing.
      // Where the only PR is closed, the winner is a withdrawn attempt.
      //
      // Measured 2026-08-24: ten branches were in exactly that state. One
      // rendered `worker finished — review it` over a PR closed as superseded an
      // hour earlier, so the board asked a reader to review something withdrawn.
      //
      // The rank is RIGHT and unchanged — this asserts it, so the fix is not
      // mistaken for a ranking bug. Hiding the artifact is `rowsFromPulse`'s
      // decision, because it is about what a row DISPLAYS, not about which
      // record is best.
      const lone = pr({ number: 12, head: 'feature/b', state: 'CLOSED' });
      expect(prOutranks(lone, lone)).toBe(false);
      // A closed PR still outranks nothing at all — there is no rule that drops
      // it here, and adding one would lose the link on a branch whose successor
      // has not been opened yet.
      const older = pr({ number: 11, head: 'feature/b', state: 'CLOSED' });
      expect(prOutranks(lone, older)).toBe(true);
    });

    it('costs no host call — the link comes off the fetch that already ran', () => {
      // THE CONSTRAINT THE BRIEF NAMES, and the reason this feature is cheap:
      // the number already exists server-side. `refreshPrs` asks `pr-list
      // --state all` once on the slow PR timer and the merged PRs are already
      // in that answer — the pipeline computed them, used them for one decision,
      // and dropped them before shaping the row.
      //
      // READ OUT OF THE SOURCE, following `a row's actions all live in its menu`
      // in agent-list.test.ts and for its stated reason: a behavioural assertion
      // catches only what a fixture happens to reach, while a second `pr-list`
      // added on the row path would sit behind the poll timer and a cache, where
      // no unit fixture goes. This sees it whether or not any test data does.
      //
      // The board polls every 5 s against GitHub's metered API, so a per-row or
      // per-pulse lookup here is not a small regression — it is the cost model
      // `plot-fleet-scan.sh` already went to some trouble to avoid.
      const source = readFileSync(
        new URL('../../src/server/fleet.ts', import.meta.url), 'utf8');
      const calls = source.split('\n')
        .filter((l) => l.includes("'pr-list'"));
      expect(calls, `expected exactly one pr-list call site, saw:\n${calls.join('\n')}`)
        .toHaveLength(1);
      // And all three indexes are built from THAT one answer's loop, so a fourth
      // consumer costs nothing either. `prsByHead` is assigned beside its two
      // siblings — moving it out of this function is what a second fetch would
      // look like.
      expect(source).toMatch(/entry\.prsByHead = byHead;/);
    });

    it('breaks a tie between two finished PRs by the higher number', () => {
      // Neither a merged nor a closed PR is more current than the other, so the
      // number decides — and it decides the same way whichever order the host
      // lists them in, which is the property no adapter promises.
      const older = pr({ number: 10, head: 'feature/a', state: 'MERGED' });
      const newer = pr({ number: 11, head: 'feature/a', state: 'CLOSED' });
      expect(prOutranks(newer, older)).toBe(true);
      expect(prOutranks(older, newer)).toBe(false);
    });
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
    // WORKING IS ABOUT AGENTS. Without agent state in the fixture, `working`
    // is empty. not-started is actionable (an opportunity to take), then quiet
    // (an errand to run). Workable top to bottom.
    expect(groups[0]).toBe('not-started');
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
    const odd: FleetReading = {
      ...pulse,
      plans: [{
        file: '2026-08-15-example-plan.md',
        slices: [{
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
    const withPhase = (phase: string): FleetReading => ({
      ...pulse,
      plans: [{ ...pulse.plans[0], phase }],
    });

    it('gives the branches of ONE plan different phases', () => {
      // The point of deriving per row rather than per plan. This fixture's plan
      // holds a merged branch, a branch being built and one nobody has taken,
      // and each is at a different point — which a plan-level phase cannot say.
      const rows = rowsFromPulse(withPhase('approved'), ages, 'plot', QUIET);
      // Every branch of an approved plan is Development now — the branch state
      // no longer forks it. `feature/c` is `open`, waiting for an agent, and
      // that IS Development: it belongs beside the Start button, not in Design.
      expect(rows.find((r) => r.branch === 'feature/c')!.phase).toBe('Development');
      // `feature/b` is `wip` — an agent is building.
      expect(rows.find((r) => r.branch === 'feature/b')!.phase).toBe('Development');
      // `feature/a` merged: the work landed, which is a start and then some.
      expect(rows.find((r) => r.branch === 'feature/a')!.phase).toBe('Development');
    });

    it('reads Development for an approved plan whatever the branch state', () => {
      // The opus5 shape at the row level no longer diverges: the pulse carries
      // `approved`, and every branch — building or untouched — is Development.
      const rows = rowsFromPulse(withPhase('approved'), ages, 'plot', QUIET);
      expect(rows.find((r) => r.branch === 'feature/b')!.phase).toBe('Development');
      expect(rows.find((r) => r.branch === 'feature/d')!.phase).toBe('Development');
    });

    it('keeps a delivered plan\'s rows at Testing despite fresh commits', () => {
      // `feature/b` is four minutes old in this fixture — a commit under a plan
      // already marked delivered, which must not reverse the phase.
      const rows = rowsFromPulse(withPhase('delivered'), ages, 'plot', QUIET);
      expect(rows.every((r) => r.phase === 'Testing')).toBe(true);
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
      // Both halves on the row: the phase is read from the plan (Development for
      // an approved plan, git ignored), and `state` still says `deferred` so the
      // badge has something to render from. The phase alone cannot say a branch
      // was shelved — `state` carries that, and the row renders a badge from it.
      const shelved: FleetReading = {
        ...pulse,
        plans: [{
          file: '2026-08-15-example-plan.md', phase: 'approved',
          slices: [{
            name: 'Implementation', verdict: 'eligible',
            branches: [{
              branch: 'feature/shelved', state: 'deferred', deferred: true, claimed: '',
            }],
          }],
        }],
      };
      const row = rowsFromPulse(shelved, new Map([['feature/shelved', 5]]), 'plot', QUIET)
        .find((r) => r.branch === 'feature/shelved')!;
      expect(row.phase).toBe('Development');
      expect(row.state).toBe('deferred');
      // And the note is the branch's own, not the word `deferred`.
      expect(row.note).not.toBe('deferred');
      expect(row.group).toBe('not-started');
    });
  });

  describe('DONE is the release scope — a released plan has drained', () => {
    // DONE holds work that has landed and whose version has NOT shipped: the
    // scope of the next release, waiting on its endgame test. `Released` is the
    // leave-condition — /plot-release resolving the version is exactly *the
    // release shipped* — so a released plan is out of the board's scope and its
    // rows do not appear here. Measured 2026-08-23: 41 of 61 DONE rows were
    // Released work the board had no further say over.
    //
    // A released plan is all-merged, all-complete by construction (the domain
    // model measures 41/41), so this fixture is the estate's own shape.
    const released: FleetReading = {
      ...pulse,
      plans: [{
        file: '2026-08-01-shipped-plan.md', phase: 'released',
        slices: [{
          name: 'Tracer', verdict: 'complete',
          branches: [
            { branch: 'feature/shipped-a', state: 'merged', deferred: false, claimed: '' },
            { branch: 'feature/shipped-b', state: 'merged', deferred: false, claimed: '' },
          ],
        }],
      }],
      summary: { plans: 1, waves: 1, branches: 2, claimed: 0, eligible: 0, blocked: 0, deferred: 0 },
    };

    it('drops a released plan\'s rows — the release drained DONE', () => {
      const rows = rowsFromPulse(released, new Map(), 'plot', QUIET);
      expect(rows).toEqual([]);
    });

    it('drains only the release — a delivered plan stays in DONE', () => {
      // The one direction that is NOT symmetric: every wave complete is a
      // measurement, releasing is a decision. A delivered plan is complete and
      // unreleased — the core of the release scope — and it stays. Only the
      // version shipping removes it, which is what makes DONE a queue that
      // drains rather than an archive that decays.
      const delivered: FleetReading = {
        ...released,
        plans: [{ ...released.plans[0], phase: 'delivered' }],
      };
      const rows = rowsFromPulse(delivered, new Map(), 'plot', QUIET);
      expect(rows).toHaveLength(2);
      expect(rows.every((r) => r.group === 'done')).toBe(true);
      expect(rows.every((r) => r.phase === 'Testing')).toBe(true);
    });

    it('leaves a released row on a planless branch alone — it is not a plan', () => {
      // The drain reads a PLAN's phase. A branch no plan names — a release
      // branch, a loose PR — carries no phase to drain on, and reaches the board
      // through its own path. Dropping it here would lose a row the release did
      // not scope.
      const loose = new Map([[
        'changeset-release/main',
        { number: 5, head: 'changeset-release/main', state: 'OPEN', draft: false,
          checks: 'green', mergeable: 'mergeable', review: '', url: '' } as never,
      ]]);
      const rows = rowsFromPulse(released, new Map(), 'plot', QUIET, loose);
      expect(rows.find((r) => r.branch === 'changeset-release/main')).toBeDefined();
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
      const threeUnstarted: FleetReading = {
        ...pulse,
        plans: [
          {
            file: '2026-08-15-example-plan.md',
            slices: [{
              name: 'Implementation', verdict: 'eligible',
              branches: [
                { branch: 'feature/ancient', state: 'open', deferred: false, claimed: '' },
                { branch: 'feature/recent', state: 'open', deferred: false, claimed: '' },
              ],
            }],
          },
          {
            file: '2026-08-15-undated-plan.md',
            slices: [{
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
    const dirty = (branch: string): FleetReading => ({
      ...pulse,
      plans: [{
        file: '2026-08-15-example-plan.md',
        slices: [{
          name: 'Implementation', verdict: 'eligible',
          branches: [{
            branch, state: 'wip', deferred: false, claimed: '',
            local_dirty: true, local_worktree: '/Users/x/wt-example',
          }],
        }],
      }],
    });

    it('puts a long-quiet branch with local activity into not-started, not working', () => {
      // `feature/d` is 240 minutes old against a 30-minute window, so the refs
      // put it firmly in quiet and only the worktree says otherwise. WORKING IS
      // ABOUT AGENTS: local activity without an agent is not-started.
      const rows = rowsFromPulse(dirty('feature/d'), ages, 'plot', QUIET);
      const row = rows.find((r) => r.branch === 'feature/d');
      expect(row!.group).toBe('not-started');
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
    const ahead = (branch: string, n: number, dirty = false): FleetReading => ({
      ...pulse,
      plans: [{
        file: '2026-08-15-example-plan.md',
        slices: [{
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

    it('puts a long-quiet branch with unpushed commits into not-started, not working', () => {
      // `feature/d` is 240 minutes old against a 30-minute window, so the refs
      // put it firmly in quiet and only the unpushed commits say otherwise.
      // WORKING IS ABOUT AGENTS: local activity without an agent is not-started.
      const rows = rowsFromPulse(ahead('feature/d', 3), ages, 'plot', QUIET);
      const row = rows.find((r) => r.branch === 'feature/d');
      expect(row!.group).toBe('not-started');
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
      worker: 'running' | 'finished' | 'waiting' | 'stalled'
        | 'failed' | 'ended' | 'none' | 'elsewhere',
      exit = '', pid = '',
      dirtyPaths: string[] = [],
    ): FleetReading => ({
      ...pulse,
      plans: [{
        file: '2026-08-15-example-plan.md',
        slices: [{
          name: 'Implementation', verdict: 'eligible',
          branches: [{
            branch: 'feature/d', state: 'claimed', deferred: false, claimed: '',
            worker, worker_exit: exit, worker_pid: pid,
            worker_dirty_paths: dirtyPaths,
          }],
        }],
      }],
    });

    it('carries a failed worker all the way to waiting-on-you, exit code included', () => {
      const rows = rowsFromPulse(withWorker('failed', '2', '900'), ages, 'plot', QUIET);
      const row = rows.find((r) => r.branch === 'feature/d')!;
      expect(row.group).toBe('waiting-on-you');
      // The exit code still travels; the sentence around it reads *crashed —
      // exited 2* rather than *failed (exit 2)* since 2026-08-20. What this test
      // is about is that the CODE arrives, which is asserted on the number.
      expect(row.note).toMatch(/exited 2/);
    });

    it('carries a running worker\'s pid, so the reader can go look at the process', () => {
      const rows = rowsFromPulse(withWorker('running', '', '900'), ages, 'plot', QUIET);
      expect(rows.find((r) => r.branch === 'feature/d')!.note).toMatch(/900/);
    });

    // The questions map, in the shape `rowsFromPulse` takes it: branch → the
    // marker line the scan's `waiting` verdict was made from.
    const asking = (question: string) => new Map([['feature/d', question]]);

    it('keeps a waiting worker in WORKING — it is an agent, not a result', () => {
      // THE SECTION BOUNDARY, and it is the whole of this branch. WAITING ON
      // YOU lists RESULTS to inspect on the git host; WORKING lists AGENTS. An
      // agent that stopped to ask still holds its worktree and its context, and
      // what unblocks it is an answer rather than a review — so an operator
      // counting agents in WORKING must find it there. It sat in
      // `waiting-on-you` until this change and undercounted every one.
      const rows = rowsFromPulse(
        withWorker('waiting', '0', '900'), ages, 'plot', QUIET,
        null, '', null, Date.now(), null, null, null, asking('PLOT-BLOCKED: which adapter?'));
      expect(rows.find((r) => r.branch === 'feature/d')!.group).toBe('working');
    });

    it('says what a waiting worker waits ON, not merely that it waits', () => {
      // *worker is waiting on an answer* names a state and withholds the only
      // part a reader can act on. Carrying the question lets them answer it —
      // or see that it is not theirs — without opening the worktree first.
      const rows = rowsFromPulse(
        withWorker('waiting', '0', '900'), ages, 'plot', QUIET,
        null, '', null, Date.now(), null, null, null,
        asking('PLOT-BLOCKED: which adapter should the fallback use?'));
      expect(rows.find((r) => r.branch === 'feature/d')!.note)
        .toMatch(/which adapter should the fallback use\?/);
    });

    it('degrades an unreadable marker to a STATED unknown, never a guess', () => {
      // The scan already found a marker — that is what made this `waiting` — so
      // no question here means THIS read did not find what that one did. The
      // row must say so and stay in WORKING. A fabricated question would send a
      // reader to answer the wrong one with nothing to signal the substitution,
      // which is strictly worse than a blank.
      const rows = rowsFromPulse(withWorker('waiting', '0', '900'), ages, 'plot', QUIET);
      const row = rows.find((r) => r.branch === 'feature/d')!;
      expect(row.group).toBe('working');
      expect(row.note).toMatch(/unavailable/i);
      expect(row.note).toMatch(/worktree/i);
    });

    it('still sends a finished worker to WAITING ON YOU — that one IS a result', () => {
      // The counterweight to the change above. `finished` and `waiting` both
      // mean the process exited; only one of them means the work is done, and
      // moving `waiting` must not drag `finished` along with it.
      const rows = rowsFromPulse(withWorker('finished', '0', '900'), ages, 'plot', QUIET);
      const row = rows.find((r) => r.branch === 'feature/d')!;
      expect(row.group).toBe('waiting-on-you');
      expect(row.note).toMatch(/review it/i);
    });

    it('names what a stalled worker left on the floor', () => {
      // A COUNT WOULD NOT SUPPORT THE DECISION the row exists for. "3
      // uncommitted files" reads identically for three scratch notes and three
      // half-finished modules; the names are what tell a reader whether this
      // branch is worth resuming.
      const rows = rowsFromPulse(
        withWorker('stalled', '0', '900', ['src/retry.ts', 'test/retry.test.ts']),
        ages, 'plot', QUIET);
      const row = rows.find((r) => r.branch === 'feature/d')!;
      expect(row.group).toBe('waiting-on-you');
      expect(row.note).toMatch(/src\/retry\.ts/);
      // The sentence around the names stopped prescribing *resume it* on
      // 2026-08-20 and now states what was observed — *stopped without finishing
      // and without asking*. The names, which are what this test is about, are
      // asserted above and unchanged.
      expect(row.note).toMatch(/without finishing/);
    });

    it('counts the remainder rather than dropping it silently', () => {
      // A cap keeps one branch mid-refactor from pushing every other row off
      // the screen, but a SILENT truncation reads as "that is all of it" — the
      // same mis-answer an uncapped list would avoid and a bare count would
      // make. So the overflow is stated.
      const many = ['a.ts', 'b.ts', 'c.ts', 'd.ts', 'e.ts'];
      const note = rowsFromPulse(withWorker('stalled', '0', '900', many), ages, 'plot', QUIET)
        .find((r) => r.branch === 'feature/d')!.note;
      expect(note).toMatch(/\+2 more/);
    });

    it('keeps waiting and stalled apart — the moves are opposite', () => {
      // *Answer it* sends a PERSON to a question; *resume it* sends a WORKER
      // back to work. One label over both is the `finished`-means-everything
      // blur these two were split out of, one level down.
      const say = (w: 'waiting' | 'stalled' | 'finished') =>
        rowsFromPulse(withWorker(w, '0', '900', ['x.ts']), ages, 'plot', QUIET)
          .find((r) => r.branch === 'feature/d')!.note;
      expect(new Set([say('waiting'), say('stalled'), say('finished')]).size).toBe(3);
    });

    it('gives a waiting row the log offer, by landing it in WORKING', () => {
      // TWO WAVES COMPOSING, asserted so neither can be undone without noticing.
      // `showsWorkerLog` gates on WORKING membership alone — it knows nothing
      // about worker states — so moving `waiting` into that section hands it the
      // log the sibling wave shipped. The reader sees the question on the row
      // and can open the reasoning behind it without a second tool. In
      // `waiting-on-you` the row had neither.
      const rows = rowsFromPulse(
        withWorker('waiting', '0', '900'), ages, 'plot', QUIET,
        null, '', null, Date.now(), null, null, null, asking('PLOT-BLOCKED: which one?'));
      expect(showsWorkerLog(rows.find((r) => r.branch === 'feature/d')!)).toBe(true);
    });

    it('ranks waiting above stalled even with work on the floor', () => {
      // THE ORDERING GUARANTEE, and moving `waiting` up beside `running` must
      // not cost it. A worker that asked a question has almost always left the
      // work it was doing uncommitted BESIDE the question, so a row reading
      // `waiting` with dirty files is the normal case rather than a corner one.
      // Ranking dirtiness first files it under *resume it* and invites a
      // restart into the same wait — measured happening twice to one branch,
      // the second restart re-running work the first had finished.
      const rows = rowsFromPulse(
        withWorker('waiting', '0', '900', ['src/half-done.ts']), ages, 'plot', QUIET,
        null, '', null, Date.now(), null, null, null, asking('PLOT-BLOCKED: which one?'));
      const row = rows.find((r) => r.branch === 'feature/d')!;
      expect(row.group).toBe('working');
      // REBOUND TO THE STALLED SENTENCE THAT EXISTS. This read `not
      // toMatch(/resume it/)` until 2026-08-20, when the stalled note stopped
      // prescribing a move — and a negative assertion against a string nothing
      // composes any more passes whatever the ordering does, which is the one
      // way this guarantee could have been lost silently. It now names the
      // wording the stalled arm actually produces.
      expect(row.note).not.toMatch(/without finishing/);
      // AND POSITIVELY: the question is what the row must carry. If dirtiness
      // won, this row would describe the floor instead of the ask.
      expect(row.note).toMatch(/which one\?/);
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

  describe('the row carries its sprint', () => {
    // `sprintOf` is the 15th argument — after `repoRoot`. The placeholders reach
    // it; the map keys on the plan SLUG, which is `example-plan` here.
    const withSprint = (sprintOf: Map<string, string> | null) =>
      rowsFromPulse(
        pulse, ages, 'plot', QUIET, new Map(), '', null, Date.now(),
        null, null, null, null, null, '', sprintOf);

    it('sets the active sprint that lists the plan onto every one of its rows', () => {
      // The join the whole branch exists for: a plan the active sprint names
      // carries that sprint's slug on each of its branch rows. Asserted on more
      // than one row so it is the JOIN under test, not a single lucky match.
      const rows = withSprint(new Map([['example-plan', 'the-active-sprint']]));
      const planRows = rows.filter((r) => r.planFile === '2026-08-15-example-plan.md');
      expect(planRows.length).toBeGreaterThan(1);
      expect(planRows.every((r) => r.sprint === 'the-active-sprint')).toBe(true);
    });

    it('leaves a plan no sprint lists empty — membership is the file, not the field', () => {
      // The defect this plan is the first consumer of `plan.status` to avoid:
      // a plan the sprint file omits carries "" even though the join map exists
      // for OTHER plans. Joining on a plan's own `Sprint:` field showed 5 of 19;
      // this is the assertion that a missing membership reads as absence, never
      // as a guess.
      const rows = withSprint(new Map([['some-other-plan', 'the-active-sprint']]));
      const planRows = rows.filter((r) => r.planFile === '2026-08-15-example-plan.md');
      expect(planRows.every((r) => r.sprint === '')).toBe(true);
    });

    it('leaves a plan-less row empty under the same map — the row a naive filter deletes', () => {
      // The release row and the unplanned PR belong to no sprint by their nature,
      // and the filter that consumes this field must keep them visible. Here the
      // planless PR reaches the row through the PR loop, whose slug the map cannot
      // name, so the lookup at that push site is "" — never a crash on a plan it
      // has no file for.
      const prs = new Map([['changeset-release/main', pr({ head: 'changeset-release/main' })]]);
      const rows = rowsFromPulse(
        pulse, ages, 'plot', QUIET, prs, '', null, Date.now(),
        null, null, null, null, null, '',
        new Map([['example-plan', 'the-active-sprint']]));
      const loose = rows.find((r) => r.branch === 'changeset-release/main')!;
      expect(loose.planFile).toBe('');
      expect(loose.sprint).toBe('');
    });

    it('leaves every existing caller unchanged — no map means empty, not a default fired', () => {
      // The parameter is last and optional. A caller that says nothing about
      // sprints gets "" on every row, which is exactly the board before the field
      // — and it must be "" from the ABSENT map here, not a Zod default that a
      // client-side cast would never apply.
      const rows = rowsFromPulse(pulse, ages, 'plot', QUIET);
      expect(rows.every((r) => r.sprint === '')).toBe(true);
    });
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

describe('the wait comes from the host, not from a constant', () => {
  // Why this exists: the bare exhaustion message carries no reset, so the
  // function fell back to a 120 s guess. But `gh api rate_limit` states the
  // real reset and is itself free — the rate-limit endpoint is not rate-limited.
  // When the message names its own wait we must NOT ask (the answer is already
  // in hand); only the bare message reaches for the host, and only once.

  const BARE = 'GraphQL: API rate limit already exceeded for user ID 870334';

  it('uses the fetched reset when the message is bare', async () => {
    // The host says GraphQL resets in 8 minutes; honour that over the ceiling.
    const target = () => Promise.resolve(480_000);
    const ms = await rateLimitBackoffMs(BARE, Date.now(), target);
    expect(ms).toBe(480_000);
  });

  it('falls back to the ceiling when the reset cannot be read', async () => {
    // `gh api rate_limit` failed (offline, unauthenticated, itself refused);
    // the constant is the last resort, never a hang on an unknown wait.
    const target = () => Promise.resolve(null);
    const ms = await rateLimitBackoffMs(BARE, Date.now(), target);
    expect(ms).toBe(120_000);
  });

  it('never asks the host when the message names its own wait', async () => {
    // A named wait is already the answer. Spending a call to re-derive it is
    // the exact waste the throttle exists to avoid.
    let calls = 0;
    const target = () => { calls++; return Promise.resolve(999_000); };
    const ms = await rateLimitBackoffMs(
      'You have exceeded a secondary rate limit. Please wait 90 seconds before trying again.',
      Date.now(), target,
    );
    expect(ms).toBe(90_000);
    expect(calls).toBe(0);
  });

  it('never asks the host when the message carries a reset stamp', async () => {
    let calls = 0;
    const target = () => { calls++; return Promise.resolve(999_000); };
    const ms = await rateLimitBackoffMs(
      'API rate limit exceeded; reset at 1700000180', 1_700_000_000_000, target,
    );
    expect(ms).toBe(180_000);
    expect(calls).toBe(0);
  });

  it('never asks the host for an ordinary, non-rate-limit failure', async () => {
    // The load-bearing negative kept: a VPN blip returns null and must not
    // spend a free-but-still-real call on the way there.
    let calls = 0;
    const target = () => { calls++; return Promise.resolve(999_000); };
    const ms = await rateLimitBackoffMs(
      'dial tcp: lookup api.github.com: no such host', Date.now(), target,
    );
    expect(ms).toBeNull();
    expect(calls).toBe(0);
  });

  it('reads the reset once per backoff, never per call', async () => {
    // "Once per backoff" is structural: the function is called once per failed
    // refresh, so one read here is one read per backoff window — provided the
    // bare branch consults the fetcher exactly once.
    let calls = 0;
    const target = () => { calls++; return Promise.resolve(300_000); };
    await rateLimitBackoffMs(BARE, Date.now(), target);
    expect(calls).toBe(1);
  });

  it('is unchanged when no fetcher is supplied — the ceiling still answers', async () => {
    // The pure call path the other callers use until they pass a fetcher.
    const ms = await rateLimitBackoffMs(BARE);
    expect(ms).toBe(120_000);
  });
});

describe('graphqlResetMs — the reset the free endpoint states', () => {
  // `gh api rate_limit` returns epoch-seconds resets per resource; GraphQL is
  // the budget the PR fetch spends, so its reset is the one to wait for. Pure so
  // the branching (missing field, expired stamp, malformed JSON) is covered
  // without the network; the one untestable line is the `run()` that feeds it.

  // Trimmed shape of a real `gh api rate_limit` response.
  const payload = (graphqlReset: number) => JSON.stringify({
    resources: {
      core: { limit: 5000, remaining: 5000, reset: graphqlReset + 999 },
      graphql: { limit: 5000, used: 5000, remaining: 0, reset: graphqlReset },
    },
    rate: { limit: 5000, remaining: 5000, reset: graphqlReset + 999 },
  });

  it('returns ms from now until the GraphQL reset', () => {
    const now = 1_700_000_000_000; // ms
    const ms = graphqlResetMs(payload(1_700_000_480), now); // resets in 480 s
    expect(ms).toBe(480_000);
  });

  it('returns null when the reset is already past', () => {
    // A stale reset must not become a negative or instant wait; the caller
    // falls back to the ceiling instead.
    const now = 1_700_000_000_000;
    const ms = graphqlResetMs(payload(1_699_999_940), now); // 60 s ago
    expect(ms).toBeNull();
  });

  it('returns null when the payload has no GraphQL resource', () => {
    const now = 1_700_000_000_000;
    const ms = graphqlResetMs(JSON.stringify({ resources: { core: { reset: 1_700_000_480 } } }), now);
    expect(ms).toBeNull();
  });

  it('returns null on malformed JSON rather than throwing', () => {
    // `gh` handed back something that is not the shape — an auth error page,
    // an empty string. Null, never a crash inside the backoff decision.
    expect(graphqlResetMs('not json at all', Date.now())).toBeNull();
    expect(graphqlResetMs('', Date.now())).toBeNull();
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

  it('leaves a green DRAFT PR to its author, classified by git age not PR state', () => {
    // A draft PR breaks out of the PR handling (pr.draft → break) and falls
    // through to the git-state classification. WORKING IS ABOUT AGENTS: with
    // no agent state, a recent commit goes to not-started.
    const r = classify('wip', 'eligible', 3, QUIET, pr({ draft: true }));
    expect(r.group).toBe('not-started');
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
    // The git-only behaviour survives for branches without a PR — including for
    // claims, which now answer by age like everything else. WORKING IS ABOUT
    // AGENTS: without agent state, recent commits go to not-started.
    expect(classify('wip', 'eligible', 3, QUIET, null).group).toBe('not-started');
    expect(classify('claimed', 'eligible', 3, QUIET, null).group).toBe('not-started');
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

describe('prStates', () => {
  const pr = (over: Partial<PrRecord> = {}): PrRecord => ({
    number: 42, head: 'feature/x', state: 'OPEN', draft: false, checks: 'green',
    mergeable: 'mergeable', review: '', url: 'https://example.test/pr/42', ...over,
  });

  it('keeps BOTH facts for a PR that conflicts and whose build failed', () => {
    // THE MEASURED LOSS, and the whole reason this function exists. A single
    // value reported `conflicts` and the failed build was gone before the row
    // was built — one observable with two causes, and the code kept one.
    //
    // Not hypothetical: a run can complete, and fail, before main moves
    // underneath the branch and makes it unmergeable.
    expect(prStates(pr({ checks: 'failing', mergeable: 'conflicting' })))
      .toEqual(['conflicts', 'failing']);
  });

  it('leads with the conflict, because it blocks the merge outright', () => {
    // The ORDER is the precedence, and it is unchanged from `prState`: a red
    // build on an unmergeable PR is moot until the rebase happens, and fixing it
    // first can be wasted work if the rebase changes what fails.
    expect(prStates(pr({ checks: 'failing', mergeable: 'conflicting' }))[0])
      .toBe('conflicts');
  });

  it('does not print the empty rollup a conflict CAUSED', () => {
    // GitHub starts no workflow for a branch that does not merge, so `none`
    // beside a conflict is that conflict's own consequence. Appending it would
    // stand the symptom next to its cause as though they were two problems —
    // and `no checks` is the sentence this estate already removed once for
    // naming the symptom while withholding the reason.
    expect(prStates(pr({ checks: 'none', mergeable: 'conflicting' }))).toEqual(['conflicts']);
  });

  it('appends nothing that is not an errand of its own', () => {
    // `pending` and `unknown` say nothing a reader can act on beneath a
    // conflict, and `green` is the absence of an errand rather than a peer of
    // one. Only a failed build composes.
    expect(prStates(pr({ checks: 'pending', mergeable: 'conflicting' }))).toEqual(['conflicts']);
    expect(prStates(pr({ checks: 'green', mergeable: 'conflicting' }))).toEqual(['conflicts']);
    expect(prStates(pr({ checks: 'unknown', mergeable: 'conflicting' }))).toEqual(['conflicts']);
  });

  it('answers unknown ALONE, claiming nothing beside it', () => {
    // `green-never-outranks-unknown`, carried into the set: unknown
    // mergeability poisons the checks answer as well, so a second entry here
    // would claim a knowledge the row does not have. The live shape from PR #57
    // is the first of these.
    expect(prStates(pr({ checks: 'green', mergeable: 'unknown' }))).toEqual(['unknown']);
    expect(prStates(pr({ checks: 'failing', mergeable: 'unknown' }))).toEqual(['unknown']);
    expect(prStates(pr({ checks: 'green', mergeable: undefined }))).toEqual(['unknown']);
  });

  it('answers green ALONE', () => {
    // Green is the absence of every errand, so nothing composes with it —
    // including in the other direction, where a set implementation that always
    // appended the checks would report `['green', 'green']`.
    expect(prStates(pr({ checks: 'green', mergeable: 'mergeable' }))).toEqual(['green']);
  });

  it('answers a single errand as a set of one', () => {
    // The common case. A set does not mean every row carries two things.
    expect(prStates(pr({ checks: 'failing' }))).toEqual(['failing']);
    expect(prStates(pr({ checks: 'pending' }))).toEqual(['pending']);
    expect(prStates(pr({ checks: 'none' }))).toEqual(['none']);
  });

  it('never answers empty, so its head is always a real word', () => {
    // What licenses `prState` to be `prStates(pr)[0]` without a fallback. An
    // implementation that returned `[]` for any input would make the derived
    // word `undefined` and every consumer of it lie.
    for (const mergeable of ['mergeable', 'conflicting', 'unknown', '', undefined]) {
      for (const checks of ['green', 'pending', 'failing', 'none', 'unknown', 'new-word']) {
        expect(prStates(pr({ checks, mergeable })).length).toBeGreaterThan(0);
      }
    }
  });

  it('agrees with prState on EVERY input, because one derives from the other', () => {
    // THE INVARIANT THE CONTRACT ASSERTS: `states[0] === state`. Two fields
    // deriving one answer separately is how a row's word and its sentence come
    // to disagree — the failure `classify` mirrors `prState` to avoid, recorded
    // in both their comments. Here it cannot happen by construction, and this
    // is the test that says so rather than trusting the arrangement.
    for (const mergeable of ['mergeable', 'conflicting', 'unknown', '', undefined]) {
      for (const checks of ['green', 'pending', 'failing', 'none', 'unknown', 'new-word']) {
        const record = pr({ checks, mergeable });
        expect(prStates(record)[0]).toBe(prState(record));
      }
    }
  });

  it('does not fold draft into the set', () => {
    // The same independence `prState` keeps: a draft has CI like anything else,
    // and a set is exactly where a careless implementation would smuggle a
    // seventh value in beside the real ones.
    expect(prStates(pr({ draft: true, checks: 'failing' }))).toEqual(['failing']);
    expect(prStates(pr({ draft: true, checks: 'failing', mergeable: 'conflicting' })))
      .toEqual(['conflicts', 'failing']);
  });

  it('remains a pure function over the two facts it already receives', () => {
    // No new field and no host call: the same record in, the same set out. The
    // plan's constraint is explicit — the kind is derived from data already on
    // the row.
    const record = pr({ checks: 'failing', mergeable: 'conflicting' });
    const before = JSON.stringify(record);
    expect(prStates(record)).toEqual(prStates(record));
    expect(JSON.stringify(record)).toBe(before);
    expect(prStates.length).toBe(1);
  });
});

describe('the row carries the PR condition as fields', () => {
  const pulse: FleetReading = {
    generatedAt: '2026-08-17T00:00:00Z',
    plans: [{
      file: '2026-08-17-p.md', slug: 'p', title: 'P', phase: 'approved', story: '',
      slices: [{
        name: 'One', verdict: 'eligible',
        branches: [{
          branch: 'feature/a', state: 'wip', claimed: '', local_dirty: false,
          local_ahead: 0, worker: 'elsewhere', worker_exit: '', worker_pid: '',
          worker_dirty_paths: [],
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
      // The SET travels too, and `state` is its head — the invariant the row
      // depends on to name a subject without recomputing the precedence.
      states: ['green'],
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
          slices: [{
            ...pulse.plans[0].slices[0],
            verdict: 'blocked',
            // `open` — the branch does not exist yet, which is the only state
            // in which "an earlier wave has not landed" is the row's answer.
            branches: [{ ...pulse.plans[0].slices[0].branches[0], state: 'open' }],
          }],
        }],
      } as never,
      new Map(), 'plot', QUIET);
    // NAMES THE WAVE AND COUNTS IT. This asserted `/earlier wave/` until the
    // wave's name reached the note, then the bare `blocked by <name>` until the
    // count did — *blocked by which one, and how many left?* is the reader's
    // unavoidable next question, and the server is the only place that can
    // answer it. Asserted against the fixture's own wave name rather than the
    // literal, so renaming the fixture cannot leave a passing test measuring
    // nothing. The forced-blocked wave holds this fixture's one open branch, so
    // one is outstanding.
    expect(blocked[0].note).toBe(`blocked by ${pulse.plans[0].slices[0].name} — 1 outstanding`);
    // And the field says it too, so nothing downstream has to read the prose.
    expect(blocked[0].waitingOn).toBe('time');
    expect(blocked[0].blockedBy).toBe(pulse.plans[0].slices[0].name);

    const claimed = rowsFromPulse(
      {
        ...pulse,
        plans: [{
          ...pulse.plans[0],
          slices: [{
            ...pulse.plans[0].slices[0],
            branches: [{
              ...pulse.plans[0].slices[0].branches[0],
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
    worker: 'elsewhere', worker_pid: '', worker_exit: '', worker_dirty_paths: [],
    conflicts: [], conflicts_known: true, changed_paths: [],
    ...over,
  }) as never;

  const pulseWith = (over: Record<string, unknown> = {}): FleetReading => ({
    main: 'main',
    head: 'abc1234',
    plans: [{
      file: '2026-08-17-p.md', phase: 'approved',
      slices: [{ name: 'One', verdict: 'eligible', branches: [branch(over)] }],
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

describe('the cadence knows what a refresh costs', () => {
  // Issue #226, measured against `bitbucket.org/quatico/ekzweb`. The board's
  // refresh assumed ONE request per refresh. On Bitbucket it is four — three for
  // `pr-list --state all` (open/merged/declined, because `bb` has no `all`
  // state) plus one for `issue-list`, which now reaches the tracker instead of
  // exiting 4 — so an un-stretched 60 s cadence would spend 240 requests an hour
  // there against 60 on GitHub, and a board left open a working day reached
  // `HTTP 429` account wide, taking the operator's own shell down with it.
  //
  // These assert the COUNT, in requests per hour, because the count is what the
  // host meters. Asserting only the interval would pass for a change that
  // lengthened the period and left the multiplier wrong.
  //
  // Pure arithmetic against a fake clock, deliberately: a wall-clock test of a
  // 60 s cadence cannot run in a suite, and a test that RACES what it asserts
  // passes on one machine and fails on the next.

  const HOUR_MS = 3_600_000;
  const PERIOD = 60_000;

  /**
   * Requests spent in an hour on `backend`, driving the REAL scheduling pair —
   * `prNextDueAt` decides when the next refresh is due, `prGateOpen` decides
   * whether the rigid 60 s tick may pass.
   *
   * The timer is NOT stretched; only the gate is. That is the shipped shape:
   * `setInterval` keeps firing every `PR_REFRESH_MS` and the gate refuses the
   * ticks a costlier host cannot afford. Modelling it any other way would test
   * a design that is not the one in `fleet.ts`.
   */
  function requestsPerHour(
    backend: string,
    { duration = 1_400, jitter = 0 }: { duration?: number; jitter?: number } = {},
  ): { requests: number; refreshes: number; worstAge: number } {
    const cost = prRequestsPerRefresh(backend);
    // The start-up fetch at t=0 — it happens on every host and is counted.
    let refreshes = 1;
    let prAt = duration;
    let due = prNextDueAt(0, null, duration, backend);
    let worstAge = 0;
    // HALF-OPEN: [0, 3600000). Both hosts refresh at t=0 and would again at
    // exactly t=3600000, and counting both endpoints charges every host one
    // extra refresh — worth 1 request on GitHub and 3 on Bitbucket, which
    // reads as the two hosts disagreeing when they do not. A rate is counted
    // over a half-open window for exactly this reason.
    for (let now = PERIOD + jitter; now < HOUR_MS; now += PERIOD) {
      worstAge = Math.max(worstAge, now - prAt);
      if (!prGateOpen(due.at, due.hard, now)) continue;
      refreshes++;
      prAt = now + duration;
      due = prNextDueAt(now, null, prAt, backend);
    }
    return { requests: refreshes * cost, refreshes, worstAge };
  }

  /** The naive cadence this branch replaced: one period, whatever a call costs. */
  const naive = (startedAt: number, backoff: number | null, now: number) =>
    backoff !== null
      ? { at: now + backoff, hard: true }
      : { at: startedAt + PERIOD, hard: false };

  it('spends measurably fewer requests per hour on Bitbucket than the naive cadence', () => {
    // THE assertion, in the unit the host meters. The naive cadence refreshed
    // every period regardless, so Bitbucket paid 4 requests 60 times over.
    const naiveRefreshes = 60;                        // one per minute, [0, 1h)
    const naiveRequests = naiveRefreshes * 4;         // 240 — the measured shape
    const { requests } = requestsPerHour('bitbucket');
    expect(requests).toBeLessThan(naiveRequests);
    // Not merely fewer — a quarter, which is the whole cost being accounted for.
    expect(requests).toBeLessThanOrEqual(Math.ceil(naiveRequests / 4) + 4);
  });

  it('spends the SAME requests per hour on both hosts — the invariant', () => {
    // What "the cadence knows what a refresh costs" means, stated as one
    // equality: the budget is in requests, so every host gets the same budget
    // however many requests its refresh takes.
    const gh = requestsPerHour('github');
    const bb = requestsPerHour('bitbucket');
    expect(bb.requests).toBe(gh.requests);
    // And it got there by refreshing a quarter as often, not by luck.
    expect(bb.refreshes * 4).toBe(gh.refreshes * 1);
  });

  it('leaves a GitHub-configured board unchanged', () => {
    // The brief's second requirement, asserted rather than assumed: this branch
    // must not slow the common case down to fix the uncommon one.
    expect(prRefreshMsFor('github')).toBe(PERIOD);
    expect(prRequestsPerRefresh('github')).toBe(1);
    // The arithmetic downstream is bit-identical to the default-argument form
    // every pre-existing caller and test uses.
    for (const started of [0, 1_000, 999_999]) {
      expect(prNextDueAt(started, null, started + 1_400, 'github'))
        .toEqual(prNextDueAt(started, null, started + 1_400));
    }
    // And end to end: 60 refreshes an hour, exactly as it shipped.
    const { requests, refreshes, worstAge } = requestsPerHour('github');
    expect(refreshes).toBe(60);
    expect(requests).toBe(60);
    expect(worstAge).toBeLessThan(PERIOD);
  });

  it('stretches the Bitbucket period by the cost and nothing else', () => {
    // Four now, not three: `issue-list` reaches the tracker instead of exiting
    // 4, so a refresh costs pr-list's three plus one issue call. The period is
    // the cost times the base tick — 4 × 60 s.
    expect(prRefreshMsFor('bitbucket')).toBe(240_000);
    expect(prRequestsPerRefresh('bitbucket')).toBe(4);
  });

  it('keeps a Bitbucket board FRESHER than the cost multiple would allow at worst', () => {
    // The trade, bounded rather than open-ended. Four minutes is the price of
    // the same budget; a reader is entitled to know it is four and not ten.
    const { worstAge } = requestsPerHour('bitbucket');
    expect(worstAge).toBeLessThan(4 * PERIOD + 2_000);
  });

  it('lands the stretched gate ON a rigid tick, so no period is ever skipped', () => {
    // Why the multiplier must be a whole number of periods. The timer still
    // fires every 60 s; if the gate landed at 150 s it would be refused at 120 s
    // AND at 180 s be a period late, costing freshness for no saving. An integer
    // multiple puts gate and tick on the same instant, which is what the slack
    // was built for.
    for (const backend of ['github', 'bitbucket']) {
      expect(prRefreshMsFor(backend) % PERIOD).toBe(0);
    }
    // Asserted through the real gate too: the tick that lands ON the stretched
    // period is honoured, and so is one arriving a hair early — which is the
    // slack's whole job, unchanged by the multiplier.
    //
    // SPACING, not a count over a fixed hour. Negative jitter shifts every tick
    // earlier, so a refresh sitting exactly on the window's far edge slides
    // inside it and the count reads one higher for a reason that is about the
    // window rather than about the cadence. The property meant here is that no
    // tick is refused for being early, and this asserts that directly.
    const bbDue = prNextDueAt(0, null, 1_400, 'bitbucket').at;
    expect(bbDue).toBe(240_000);
    for (const jitter of [0, -1, -50, -1_000]) {
      expect(prGateOpen(bbDue, false, 240_000 + jitter)).toBe(true);
    }
    // And the three ticks the stretched period is meant to refuse still are.
    expect(prGateOpen(bbDue, false, 60_000)).toBe(false);
    expect(prGateOpen(bbDue, false, 120_000)).toBe(false);
    expect(prGateOpen(bbDue, false, 180_000)).toBe(false);
  });

  it('costs 1 for an unrecognised backend — the naive assumption, kept as the default', () => {
    // A host nobody has measured behaves exactly as every host did before this
    // branch. Being slowed down is a claim about a cost, and there is none here.
    for (const unknown of ['gitlab', '', 'GITHUB', 'bogus']) {
      expect(prRequestsPerRefresh(unknown)).toBe(1);
      expect(prRefreshMsFor(unknown)).toBe(PERIOD);
    }
  });

  it('never returns a zero period, which would turn the gate into a tight loop', () => {
    // The one arithmetic here that fails dangerously rather than merely wrongly:
    // a 0 ms period opens the gate on every tick forever.
    for (const backend of ['github', 'bitbucket', 'gitlab', '']) {
      expect(prRefreshMsFor(backend)).toBeGreaterThanOrEqual(PERIOD);
    }
  });

  it('reproduces the measured 240-per-hour cost with the naive cadence', () => {
    // The control. A test that passes both ways is not testing this defect, so
    // the replaced policy is asserted to FAIL the bar the shipped one clears.
    // The naive per-refresh cost is now four (pr-list's three plus issue-list).
    let refreshes = 1;
    let due = naive(0, null, 1_400);
    for (let now = PERIOD; now < HOUR_MS; now += PERIOD) {
      if (!prGateOpen(due.at, due.hard, now)) continue;
      refreshes++;
      due = naive(now, null, now + 1_400);
    }
    expect(refreshes * 4).toBeGreaterThanOrEqual(240); // the reported 240/hour
    expect(refreshes * 4).toBeGreaterThan(requestsPerHour('bitbucket').requests);
  });

  it('holds a rate-limit backoff for its FULL delay, cost or no cost', () => {
    // The brief's third requirement and the load-bearing negative. A cost-aware
    // cadence may only ever be MORE conservative than a backoff, never less —
    // so the multiplier must not reach the backoff arm at all.
    for (const backend of ['github', 'bitbucket']) {
      const due = prNextDueAt(1_000, 90_000, 2_400, backend);
      // Identical on both hosts: the host named this floor, and the cost model
      // has no business editing a promise made to it.
      expect(due).toEqual({ at: 92_400, hard: true });
      expect(prGateOpen(due.at, due.hard, 92_399)).toBe(false);
      expect(prGateOpen(due.at, due.hard, 92_400)).toBe(true);
    }
  });

  it('never SHORTENS a backoff below the cost-aware cadence either', () => {
    // The direction that would be a real defect: a 120 s ceiling backoff on
    // Bitbucket, where the ordinary cadence is already 240 s. The backoff is
    // shorter, and it is still honoured exactly — a backoff is a floor on when
    // the host may be called, not a ceiling on how long the board may wait, and
    // the gate that follows it is the ordinary one again.
    const backoff = rateLimitBackoffMs('GraphQL: API rate limit already exceeded');
    expect(backoff).toBe(120_000);
    const due = prNextDueAt(0, backoff, 0, 'bitbucket');
    expect(due).toEqual({ at: 120_000, hard: true });
    // Held to the millisecond, with no slack, exactly as on GitHub.
    expect(prGateOpen(due.at, due.hard, 119_999)).toBe(false);
    expect(prGateOpen(due.at, due.hard, 120_000)).toBe(true);
  });

  it('returns an ordinary Bitbucket failure to the COST-AWARE cadence, not the naive one', () => {
    // A VPN blip is not a quota, so it rejoins the ordinary rhythm — and on
    // Bitbucket the ordinary rhythm is the stretched one (240 s now the issue
    // call is counted). Rejoining at 60 s would let every failure quietly
    // reopen the defect.
    const due = prNextDueAt(1_000, null, 5_000, 'bitbucket');
    expect(due).toEqual({ at: 241_000, hard: false });
  });

  it('derives the cost from the backend and never from counting responses', () => {
    // The brief's fourth requirement, as a property rather than a call trace:
    // the answer depends on the backend NAME alone, so it is the same before
    // any request has been made as after any number of them.
    for (const backend of ['github', 'bitbucket']) {
      const first = prRefreshMsFor(backend);
      for (let i = 0; i < 5; i++) expect(prRefreshMsFor(backend)).toBe(first);
    }
  });
});


describe('the row carries its verdict', () => {
  // The field the contract proposed at `ELIGIBLE_NOTE` and declined to build:
  // the wave's verdict as DATA on the row, so nothing downstream has to read it
  // out of a sentence. Three verdicts left the scan and two sentences arrived,
  // and one of the two was wrong on the finished case.

  // The fixture the wiring tests read: two waves, and the second is blocked by
  // the first. Named waves, because the blocker's NAME is half of what travels.
  const pulse: FleetReading = {
    main: 'main',
    head: 'abc1234',
    plans: [{
      file: '2026-08-20-verdict-fixture.md',
      phase: 'approved',
      slices: [
        {
          name: 'Truth', verdict: 'eligible',
          branches: [
            { branch: 'feature/first', state: 'open', deferred: false, claimed: '' },
          ],
        },
        {
          name: 'Colour', verdict: 'blocked',
          branches: [
            { branch: 'feature/second', state: 'open', deferred: false, claimed: '' },
          ],
        },
      ],
    }],
    summary: { plans: 1, waves: 2, branches: 2, claimed: 0, eligible: 1, blocked: 1, deferred: 0 },
  } as never;
  const rowFor = (branch: string, p: FleetReading = pulse) =>
    rowsFromPulse(p, new Map(), 'plot', QUIET).find((r) => r.branch === branch)!;

  it('puts the wave verdict on the row, for each of the three values', () => {
    // THE field. Asserted for all three rather than for the interesting one:
    // a field written on only two of its three inputs is the defect this
    // replaces, one level along.
    for (const v of ['complete', 'eligible', 'blocked'] as const) {
      expect(classify('open', v, null, QUIET).verdict).toBe(v);
    }
  });

  it('reuses the WAVE verdict rather than inventing a fourth row state', () => {
    // The decision, as an assertion. `WaveVerdictSchema` is the row's vocabulary
    // too, so a value the wave can hold is a value the row accepts and nothing
    // else is. A second three-value enum meaning almost the same thing is what
    // this pins shut.
    for (const v of ['complete', 'eligible', 'blocked'] as const) {
      expect(AgentRowSchema.shape.verdict.safeParse(v).success).toBe(true);
    }
    for (const v of ['done', 'startable', 'waiting', 'open', 'wip']) {
      expect(AgentRowSchema.shape.verdict.safeParse(v).success).toBe(false);
    }
  });

  it('says NULL where the scan reported no verdict this board knows', () => {
    // Absent is not a guess — the rule `planPhase` follows in the same
    // function. "" and an unrecognised word are not the three values, and a row
    // must not claim a wave state nobody reported.
    for (const v of ['', 'partial', 'COMPLETE', 'in-progress']) {
      expect(classify('open', v, null, QUIET).verdict).toBeNull();
    }
  });

  it('validates a payload from a server that predates the field', () => {
    // ADDITIVE AND DEFAULTED, which is the rule `issueAnswer` follows and the
    // reason a client may be newer than the server it talks to. A row with no
    // `verdict` at all must parse, and must parse to null rather than to a
    // value nobody sent.
    const older = {
      repo: 'plot', branch: 'feature/x', plan: 'p', wave: 'Truth', state: 'open',
      group: 'not-started', ageMinutes: null, note: ELIGIBLE_NOTE, branchUrl: '',
      pr: null, waitingDays: 3,
    };
    const parsed = AgentRowSchema.safeParse(older);
    expect(parsed.success).toBe(true);
    expect(parsed.data!.verdict).toBeNull();
  });

  it('agrees with the sentence the row already carried, on every input', () => {
    // THE PAIR, and the reason both exist. Disagreement between a field and its
    // prose is precisely what this field was built to end, so the two are
    // asserted against each other rather than each against a literal.
    //
    // `open` is the state where the note speaks about the WAVE at all — a
    // merged or claimed branch has its own sentence — so it is the state where
    // the pair is checkable.
    const eligible = classify('open', 'eligible', null, QUIET, null, false, 0, 'approved');
    expect(eligible.verdict).toBe('eligible');
    expect(eligible.note).toBe(ELIGIBLE_NOTE);

    const blocked = classify('open', 'blocked', null, QUIET, null, false, 0, 'approved');
    expect(blocked.verdict).toBe('blocked');
    expect(blocked.note).toMatch(/earlier wave/);

    // And they never cross: the eligible sentence appears on no row whose
    // verdict is not `eligible`, which is the half a naive implementation gets
    // wrong by writing the field from a second reading.
    for (const v of ['complete', 'blocked', '']) {
      expect(classify('open', v, null, QUIET, null, false, 0, 'approved').note)
        .not.toBe(ELIGIBLE_NOTE);
    }
  });

  it('changes no group and no note it did not already produce', () => {
    // The field is ADDED, never a replacement — so every answer this function
    // gave before must be the answer it gives now. Asserted across the states
    // and verdicts the suite already covers, so a regression here fails as a
    // pair mismatch rather than as a silent re-classification.
    for (const state of ['open', 'wip', 'claimed', 'merged', 'deferred'] as const) {
      for (const v of ['complete', 'eligible', 'blocked', ''] as const) {
        const r = classify(state, v, 5, QUIET, null, false, 0, 'approved');
        expect(typeof r.group).toBe('string');
        expect(typeof r.note).toBe('string');
        expect(r.verdict).toBe(v === '' ? null : v);
      }
    }
  });

  it('carries the verdict onto every row, not only the blocked ones', () => {
    // The wiring: `classify` answering correctly is worth nothing if
    // `rowsFromPulse` drops the field — which is exactly what happened to
    // `wave` itself, declared on the contract and read by nobody.
    expect(rowFor('feature/first').verdict).toBe('eligible');
    expect(rowFor('feature/second').verdict).toBe('blocked');
  });

  it('says null on a row no plan names', () => {
    // The planless row reaches `classify` with `'eligible'` as a ROUTING value
    // — it steers the function into its PR arm — and putting that on the row
    // would claim the ordering of a plan that does not exist is satisfied.
    const prs = new Map([['bug/loose', {
      number: 7, head: 'bug/loose', state: 'OPEN', draft: false, checks: 'green',
      mergeable: 'mergeable', review: '', url: '', failing_checks: [],
    } as never]]);
    const rows = rowsFromPulse(pulse, new Map(), 'plot', QUIET, prs);
    const loose = rows.find((r) => r.branch === 'bug/loose')!;
    expect(loose).toBeDefined();
    expect(loose.verdict).toBeNull();
  });
});

describe('an eligible wave is not a blocker', () => {
  // The collapse: `plan.slices.find((w) => w.verdict !== 'complete')` treated
  // `eligible` and `blocked` as one answer, so the wave a reader can START
  // could be reported as the thing holding everything up — or worse, a BLOCKED
  // wave could be named as a blocker, answering *blocked by which one* with
  // another blocked thing.

  const plan = (waves: { name: string; verdict: string; branches: string[] }[]) => ({
    main: 'main',
    head: 'abc1234',
    plans: [{
      file: '2026-08-20-blocker-fixture.md',
      phase: 'approved',
      slices: waves.map((w) => ({
        name: w.name,
        verdict: w.verdict,
        branches: w.branches.map((b) => ({
          branch: b, state: 'open', deferred: false, claimed: '',
        })),
      })),
    }],
    summary: { plans: 1, waves: waves.length, branches: 0, claimed: 0, eligible: 0, blocked: 0, deferred: 0 },
  }) as never as FleetReading;

  const rowsOf = (p: FleetReading) => rowsFromPulse(p, new Map(), 'plot', QUIET);

  it('names the ELIGIBLE wave as the blocker, not merely the first unfinished one', () => {
    // Both predicates pick this wave, and that agreement is the danger rather
    // than the reassurance: they agree by an invariant of the SCAN — one
    // eligible wave per plan, and it is the first non-complete one — which this
    // file neither states nor owns.
    const rows = rowsOf(plan([
      { name: 'Truth', verdict: 'complete', branches: ['feature/a'] },
      { name: 'Fold', verdict: 'eligible', branches: ['feature/b'] },
      { name: 'Colour', verdict: 'blocked', branches: ['feature/c'] },
    ]));
    const c = rows.find((r) => r.branch === 'feature/c')!;
    expect(c.blockedBy).toBe('Fold');
    // Fold holds one non-deferred, unmerged branch — the count the sentence owes.
    expect(c.note).toBe('blocked by Fold — 1 outstanding');
  });

  it('never names a BLOCKED wave as what a row waits for', () => {
    // The case the old predicate got wrong, and it got it wrong SILENTLY: with
    // the eligible wave behind a blocked one, `!== 'complete'` returns the
    // blocked wave — pointing the reader at something they can do nothing
    // about, which the comment at the search explicitly forbids.
    const rows = rowsOf(plan([
      { name: 'Stalled', verdict: 'blocked', branches: ['feature/a'] },
      { name: 'Ready', verdict: 'eligible', branches: ['feature/b'] },
      { name: 'Later', verdict: 'blocked', branches: ['feature/c'] },
    ]));
    for (const branch of ['feature/a', 'feature/c']) {
      const r = rows.find((x) => x.branch === branch)!;
      expect(r.blockedBy).not.toBe('Stalled');
      expect(r.blockedBy).not.toBe('Later');
      expect(r.blockedBy).toBe('Ready');
    }
  });

  it('keeps the FIRST eligible wave, never the nearest', () => {
    // The property the comment at the search defends and this branch must not
    // lose: a row three waves down is released by its predecessors in order, so
    // the one a reader can act on is at the FRONT of the queue. A nearest-match
    // implementation passes the test above and fails this one.
    const rows = rowsOf(plan([
      { name: 'One', verdict: 'complete', branches: ['feature/a'] },
      { name: 'Two', verdict: 'eligible', branches: ['feature/b'] },
      { name: 'Three', verdict: 'eligible', branches: ['feature/c'] },
      { name: 'Four', verdict: 'blocked', branches: ['feature/d'] },
    ]));
    expect(rows.find((r) => r.branch === 'feature/d')!.blockedBy).toBe('Two');
  });

  it('falls back to the first unfinished wave where none is eligible', () => {
    // The case the split opens: every wave blocked, nothing startable. The
    // front of the queue is still the most useful thing to point at, and the
    // fallback keeps first-not-nearest there too.
    const rows = rowsOf(plan([
      { name: 'Head', verdict: 'blocked', branches: ['feature/a'] },
      { name: 'Tail', verdict: 'blocked', branches: ['feature/b'] },
    ]));
    expect(rows.find((r) => r.branch === 'feature/b')!.blockedBy).toBe('Head');
  });

  it('a COMPLETE wave does not claim to block', () => {
    // The plan's headline defect, at the other half of the collapse:
    // `verdict !== 'eligible'` in `classify` sent `complete` to *blocked by an
    // earlier wave*, a sentence that is false about a finished wave. The arm is
    // now named, so the row says which case arrived.
    const complete = classify('open', 'complete', null, QUIET, null, false, 0, 'approved');
    expect(complete.verdict).toBe('complete');
    // No wave that is complete is ever reported as the blocker of a row.
    const rows = rowsOf(plan([
      { name: 'Done', verdict: 'complete', branches: ['feature/a'] },
      { name: 'Now', verdict: 'eligible', branches: ['feature/b'] },
      { name: 'Next', verdict: 'blocked', branches: ['feature/c'] },
    ]));
    for (const r of rows) expect(r.blockedBy).not.toBe('Done');
  });

  it('leaves an unnamed wave nameless rather than printing an empty blame', () => {
    // Empty name → null, never "": the property the search already had, kept
    // across the split. The note then reads the bare sentence, which is still
    // true.
    const rows = rowsOf(plan([
      { name: '', verdict: 'eligible', branches: ['feature/a'] },
      { name: 'Second', verdict: 'blocked', branches: ['feature/b'] },
    ]));
    const b = rows.find((r) => r.branch === 'feature/b')!;
    expect(b.blockedBy).toBeNull();
    // No name, so no count either: the count answers "how many left in THAT
    // wave", and an unnamed wave gives the reader nothing to attach it to. The
    // bare sentence is the whole of what can honestly be said.
    expect(b.note).toBe('blocked by an earlier wave');
  });
});

// A TIMED-OUT SCAN REPORTS WHAT IT MEASURED AND STOPS. A bare `timed out after
// 90000ms` names the symptom and hides the estate, so the counts stay: worktrees
// and branches are cheap, real counts of real things. What does NOT stay is the
// mechanism the report used to assert on top of them. It named an actor, a cause
// and a remedy — "pruning stale worktrees cuts both the count and the per-spawn
// cost" — and acting on it falsified both halves: 26 of 37 worktrees were pruned,
// the wall-clock did not move (97 s), and the per-spawn figure the report promised
// would fall ROSE 33 % (80 → 106 ms). The probe behind it, a single
// `git rev-parse --git-dir`, reads neither the ref database nor the worktree list,
// so it was timing process launch on a loaded machine, not this repo's estate.
// A wrong explanation costs more than no explanation, because it is actionable.
describe('a timed-out scan reports the estate it measured and infers nothing', () => {
  it('names the measured counts on the message a timeout produced', () => {
    const message = withEstate('timed out after 90000ms', {
      worktrees: 44,
      branches: 54,
    });
    // Both counts are present and come straight from the measurement object —
    // the formatter multiplies nothing it was not given.
    expect(message).toContain('timed out after 90000ms');
    expect(message).toMatch(/44\b.*worktree/i);
    expect(message).toMatch(/54\b.*branch/i);
  });

  it('prints no per-spawn figure, because no honest one exists', () => {
    // `perSpawnMs` is gone rather than repaired. Measuring the estate's effect on
    // spawn cost needs a SECOND estate to compare against, and the board has only
    // the one it runs in — so there is no better probe to swap in, only a number
    // to stop printing. No milliseconds, and no per-spawn phrasing to reintroduce
    // one under another name.
    const message = withEstate('timed out after 90000ms', {
      worktrees: 44,
      branches: 54,
    });
    expect(message).not.toMatch(/\bms\b/i);
    expect(message).not.toMatch(/per[\s-]*spawn/i);
    expect(message).not.toMatch(/\bspawn/i);
  });

  it('proposes no remedy it cannot support', () => {
    // The falsified sentence named a cause and an action. Neither survives: the
    // reader learns the estate is large and the scan did not finish, which is all
    // a timeout report can honestly owe. Pruning was still worth doing for other
    // reasons — what must not survive is the claim that it makes the scan faster.
    const message = withEstate('timed out after 90000ms', {
      worktrees: 37,
      branches: 22,
    });
    expect(message).not.toMatch(/prun/i);
    expect(message).not.toMatch(/\bcuts\b/i);
    expect(message).not.toMatch(/at startup/i);
    expect(message).not.toMatch(/stale/i);
  });

  it('says nothing extra when the scan did not time out', () => {
    // A non-timeout failure — a spawn error, a helper that exited non-zero — is
    // not explained by the estate, so the estate is not appended. "A scan under
    // budget says nothing extra" applies to every non-timeout outcome too: the
    // report is a timeout's, not a catch-all.
    const message = withEstate('bash exited 2', {
      worktrees: 44,
      branches: 54,
    });
    expect(message).toBe('bash exited 2');
  });

  it('leaves a timeout unadorned when the estate could not be measured', () => {
    // Measurement is itself a git call and can fail — a repo mid-rebase, a
    // vanished worktree. When it does, the bare timeout stands rather than a
    // half-filled sentence: an absent number is reported as absent, never as
    // zero, the same rule the scan's own signals obey. This is the
    // `an-outage-is-not-an-answer` rule the fix leans on, unchanged.
    const message = withEstate('timed out after 90000ms', null);
    expect(message).toBe('timed out after 90000ms');
  });

  it('multiplies nothing: spawn volume is named as branches, not estimated', () => {
    // The board cannot count the spawns of a process it just SIGKILLed, so it
    // names the branch count it CAN measure and never prints a fabricated
    // `8 × 54`. That restraint was always right — the deleted per-spawn cost was
    // the same fabrication one value over, which is the whole finding here.
    const message = withEstate('timed out after 90000ms', {
      worktrees: 10,
      branches: 7,
    });
    expect(message).not.toMatch(/\b(?:estimat|about|roughly|~)/i);
    expect(message).toMatch(/7\b.*branch/i);
  });

  it('renders the counts as the whole of the report', () => {
    // Pinned exactly, because the defect was prose the numbers did not support:
    // an assertion on substrings would have passed on the falsified sentence too.
    expect(estateReport({ worktrees: 37, branches: 22 })).toBe('37 worktrees, 22 branches');
    // Singulars, since a one-worktree repo is the common case off this machine.
    expect(estateReport({ worktrees: 1, branches: 1 })).toBe('1 worktree, 1 branch');
  });
});

describe('a blocked wave names how many branches are outstanding', () => {
  // The Count wave: `blocked by Fold` already names WHICH wave; this adds HOW
  // MANY branches are left in it. The number matches the scan's own arithmetic
  // (`plot-fleet-scan.sh`): a branch is outstanding when it is neither deferred
  // nor merged. The board re-derives it from the blocker wave's branch list
  // rather than reading a field, because the scan ships the list and Principle 3
  // puts the counting on this side of the line.

  const plan = (waves: {
    name: string;
    verdict: string;
    branches: { branch: string; state?: string; deferred?: boolean }[];
  }[]) => ({
    main: 'main',
    head: 'abc1234',
    plans: [{
      file: '2026-08-20-count-fixture.md',
      phase: 'approved',
      slices: waves.map((w) => ({
        name: w.name,
        verdict: w.verdict,
        branches: w.branches.map((b) => ({
          branch: b.branch, state: b.state ?? 'open', deferred: b.deferred ?? false, claimed: '',
        })),
      })),
    }],
    summary: { plans: 1, waves: waves.length, branches: 0, claimed: 0, eligible: 0, blocked: 0, deferred: 0 },
  }) as never as FleetReading;

  const rowsOf = (p: FleetReading) => rowsFromPulse(p, new Map(), 'plot', QUIET);

  it('names the eligible blocker AND its outstanding count', () => {
    // The sentence the board owes: which wave, and how many branches remain in
    // it. Fold holds three branches, none deferred, none merged — three left.
    const rows = rowsOf(plan([
      { name: 'Truth', verdict: 'complete', branches: [{ branch: 'feature/a', state: 'merged' }] },
      {
        name: 'Fold', verdict: 'eligible', branches: [
          { branch: 'feature/b' }, { branch: 'feature/c' }, { branch: 'feature/d' },
        ],
      },
      { name: 'Colour', verdict: 'blocked', branches: [{ branch: 'feature/e' }] },
    ]));
    const e = rows.find((r) => r.branch === 'feature/e')!;
    expect(e.blockedBy).toBe('Fold');
    expect(e.note).toBe('blocked by Fold — 3 outstanding');
  });

  it('excludes deferred and merged branches from the count, as the scan does', () => {
    // The scan never counts a deferred branch, and a merged one is settled. So a
    // blocker of five branches — two merged, one deferred, two open — is TWO
    // outstanding, matching `plot-fleet-scan.sh`'s Pass 2 exactly.
    const rows = rowsOf(plan([
      {
        name: 'Fold', verdict: 'eligible', branches: [
          { branch: 'feature/a', state: 'merged' },
          { branch: 'feature/b', state: 'merged' },
          { branch: 'feature/c', deferred: true },
          { branch: 'feature/d' },
          { branch: 'feature/e' },
        ],
      },
      { name: 'Colour', verdict: 'blocked', branches: [{ branch: 'feature/z' }] },
    ]));
    const z = rows.find((r) => r.branch === 'feature/z')!;
    expect(z.note).toBe('blocked by Fold — 2 outstanding');
  });

  it('counts the branches of the BLOCKER wave, not the blocked row own wave', () => {
    // The count belongs to the wave being waited ON. The blocked wave here holds
    // four branches; the eligible blocker holds one. The sentence must report
    // the blocker's one, never the reader's four.
    const rows = rowsOf(plan([
      { name: 'Fold', verdict: 'eligible', branches: [{ branch: 'feature/a' }] },
      {
        name: 'Colour', verdict: 'blocked', branches: [
          { branch: 'feature/b' }, { branch: 'feature/c' },
          { branch: 'feature/d' }, { branch: 'feature/e' },
        ],
      },
    ]));
    for (const branch of ['feature/b', 'feature/c', 'feature/d', 'feature/e']) {
      expect(rows.find((r) => r.branch === branch)!.note).toBe('blocked by Fold — 1 outstanding');
    }
  });

  it('says singular for one outstanding and plural for more', () => {
    // "1 outstanding" not "1 outstandings" — the count is a count of branches,
    // and the sentence reads as English at both ends of it.
    const one = rowsOf(plan([
      { name: 'Fold', verdict: 'eligible', branches: [{ branch: 'feature/a' }] },
      { name: 'Colour', verdict: 'blocked', branches: [{ branch: 'feature/b' }] },
    ]));
    expect(one.find((r) => r.branch === 'feature/b')!.note).toBe('blocked by Fold — 1 outstanding');

    const many = rowsOf(plan([
      { name: 'Fold', verdict: 'eligible', branches: [{ branch: 'feature/a' }, { branch: 'feature/x' }] },
      { name: 'Colour', verdict: 'blocked', branches: [{ branch: 'feature/b' }] },
    ]));
    expect(many.find((r) => r.branch === 'feature/b')!.note).toBe('blocked by Fold — 2 outstanding');
  });

  it('adds nothing to a single-wave plan whose wave cannot be blocked', () => {
    // A plan with one wave has nothing to wait for — it cannot be blocked, so no
    // count is owed. The eligible row keeps its own sentence, untouched.
    const rows = rowsOf(plan([
      { name: 'Only', verdict: 'eligible', branches: [{ branch: 'feature/a' }] },
    ]));
    const a = rows.find((r) => r.branch === 'feature/a')!;
    expect(a.note).toBe(ELIGIBLE_NOTE);
    expect(a.note).not.toMatch(/outstanding/);
  });
});

describe('the deferral reason travels from the plan to the row', () => {
  // THE FIELD THE PIPELINE USED TO DROP.
  //
  // `plot-plan-meta.sh` tested whether the annotation was present and emitted
  // `"true"`; the sentence after the colon never reached a row. So the board put
  // `deferred` beside `no commits` as two unrelated facts, when the first is the
  // reason for the second — and the explanation stayed in a file the reader of
  // the board may not have.
  const pulseWith = (reason: string): FleetReading => ({
    main: 'main',
    head: 'abc1234',
    plans: [{
      file: '2026-08-18-the-repair-exists-but-nothing-calls-it.md',
      phase: 'approved',
      slices: [{
        name: 'Implementation', verdict: 'eligible',
        branches: [{
          branch: 'feature/the-pulse-repairs-the-artifact',
          state: 'deferred', deferred: true, deferred_reason: reason, claimed: '',
        }],
      }],
    }],
    summary: { plans: 1, waves: 1, branches: 1, claimed: 0, eligible: 0, blocked: 0, deferred: 1 },
  } as unknown as FleetReading);

  const rowFor = (reason: string) =>
    rowsFromPulse(pulseWith(reason), new Map(), 'plot', QUIET)
      .find((r) => r.branch === 'feature/the-pulse-repairs-the-artifact')!;

  it('carries the sentence the plan recorded', () => {
    const reason = 'verified already implemented 2026-08-17 — startRepair() at fleet.ts:806';
    expect(rowFor(reason).deferredReason).toBe(reason);
    // And it is carried BESIDE the note rather than folded into it: the note is
    // prose this file composes, and a reason the plan wrote is a fact the row
    // renders. Mixing them would make the sentence unfindable by a consumer.
    expect(rowFor(reason).note).not.toContain('startRepair');
  });

  it('is empty where the plan recorded none, with the state still saying deferred', () => {
    // The bare `<!-- deferred -->`. Two answers must stay distinguishable —
    // *deferred, reason unrecorded* and *not deferred at all* — and `state` is
    // what separates them, so the reason may be empty without lying.
    const row = rowFor('');
    expect(row.deferredReason).toBe('');
    expect(row.state).toBe('deferred');
  });
});

describe('the all-unknown PR trigger raises the outage banner', () => {
  // `refreshPrs` makes a real `bash plot-host.sh pr-list` subprocess call and is
  // not exported, so the trigger's shape is pinned by reading the source — the
  // same idiom `costs no host call` uses above, and for the same reason: the two
  // traps this branch exists to avoid live in a code path no unit fixture drives.
  const source = readFileSync(
    new URL('../../src/server/fleet.ts', import.meta.url), 'utf8');

  it('fires only when EVERY PR is unknown, never on a single gap (Done-when 2)', () => {
    // One gap is a gap. A trigger on "any unknown" would fire constantly — the
    // distinction is the whole point of the plan. `.every` is the guard, and
    // `.length > 0` keeps an EMPTY map (no PRs exist) from reading as an outage.
    expect(source).toMatch(/allPrs\.length > 0 && allPrs\.every\(\(pr\) => pr\.state === 'unknown'\)/);
  });

  it('sets prError and raises the banner on the all-unknown path (Done-when 1)', () => {
    // The success path nulled prError one line before this; the content trigger
    // is what sets it when the host answered with a map that is entirely dark.
    const trigger = source.slice(source.indexOf('const allUnknown'));
    expect(trigger).toMatch(/if \(allUnknown\) \{[\s\S]*?entry\.prError = message;/);
  });

  it('JOINS the catch rather than replacing it — a thrown failure still sets prError (Done-when 9)', () => {
    // Most failures DO throw. A content check that replaced the catch would lose
    // all of them, so the catch must still set prError. This asserts the catch
    // block survives beside the new trigger.
    expect(source).toMatch(/\} catch \(err\) \{[\s\S]*?entry\.prError = message;/);
  });

  it('does not update prAt on the outage path, so the age stays honest (Done-when 10)', () => {
    // The retained map is kept but NOT re-dated: `prAgeSeconds` must report the
    // last successful fetch, not the failed one, or the banner would name a
    // freshness the data does not have. `prAt = Date.now()` belongs to the happy
    // path only — it appears once, inside the `else`.
    const prAtWrites = source.split('\n').filter((l) => /entry\.prAt = Date\.now\(\)/.test(l));
    expect(prAtWrites, `expected exactly one prAt write (the happy path), saw:\n${prAtWrites.join('\n')}`)
      .toHaveLength(1);
  });
});

describe('an unknown PR withholds the verdict in classifyGroup', () => {
  // Wave `Withheld` of `an-unreachable-host-is-not-an-answer`. The row-level
  // half of the outage fix: a row whose PR is `unknown` does not read
  // `eligible`, while keeping every fact git still answers.
  const source = readFileSync(
    new URL('../../src/server/fleet.ts', import.meta.url), 'utf8');

  it('checks prUnknown && verdict === eligible before returning ELIGIBLE_NOTE (Done-when 3)', () => {
    // The fix is a guard ABOVE the eligible arm. This pins that the check
    // exists and uses the shape `prUnknown && verdict === 'eligible'`.
    expect(source).toMatch(/if \(prUnknown && verdict === 'eligible'\)/);
  });

  it('sends an unknown-PR row to waiting-on-you, not to not-started', () => {
    // `waiting-on-you` rather than `not-started`, because the errand is
    // explicitly about the reader: check your connection, wait for the quota
    // to reset, look at the banner that names the outage.
    expect(source).toMatch(/if \(prUnknown && verdict === 'eligible'\) \{[\s\S]*?group: 'waiting-on-you'/);
  });

  it('uses PR_UNKNOWN_NOTE for the row note, host-agnostic (Done-when 7)', () => {
    // The note is a constant — `PR_UNKNOWN_NOTE` — not a string literal here.
    // That makes the wording host-agnostic: the constant's docblock states
    // the rule for *an origin*, not for GitHub, so any backend added later
    // inherits it instead of re-deciding.
    expect(source).toMatch(/if \(prUnknown && verdict === 'eligible'\) \{[\s\S]*?note: PR_UNKNOWN_NOTE/);
  });

  it('passes held?.state === "unknown" from rowsFromPulse to classify', () => {
    // The detection: `held` is from `prsByHeadMap`, the any-state map. When
    // `held.state === 'unknown'`, the host answered but could not report the
    // PR's state. That propagates to classify as `prUnknown`.
    expect(source).toMatch(/held\?\.state === 'unknown'\)/);
  });
});
