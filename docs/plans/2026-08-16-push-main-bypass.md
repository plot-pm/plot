# Two checks that were green because they never looked

> A branch-protection fallback waiting for a rejection that never comes, and a
> story lint that reports zero findings on plans with no story. Both made to
> look.

## Status

- **Phase:** Draft
- **Type:** feature
- **Sprint:**
- **Story:** plot-gates
- **Review:** in-session
- **Impl:** same branch

## Changelog

- Plot reports when a push to the default branch bypassed branch protection —
  naming the rules it stepped over and the checks that never ran. The push
  still lands; the workflow no longer stays quiet about how.
- `plot-story-lint.sh` reports a plan that names no story (`S5`), so the
  convention that every plan belongs to a story is checkable rather than
  merely stated.

Board impact: **none.** No plan-format change, no new field, no change to what
the board reads — `Story:` is already parsed and already rendered as a
swimlane; this only makes its absence visible.

## Motivation

`/plot-approve` records an approval by pushing a disposable branch straight at
the default branch, and documents a fallback for repos that forbid that:

> **Branch protection fallback:** if that push is rejected, open a micro-PR
> instead […] never leave the merged plan stranded at `Phase: Draft`.

The condition is *rejected*, and that word is doing more work than it can bear.
Pushing the approval for `board-acts-through-plot` produced this:

    remote: Bypassed rule violations for refs/heads/main:
    remote: - Changes must be made through a pull request.
    remote: - Required status check "validate" is expected.

The push **succeeded**. `git push` exited 0 (measured: a genuine rejection
exits 1, this exits 0). GitHub reports `enforce_admins: false`, so a user with
admin rights is waved through rather than refused. The fallback waits for a
rejection that never comes, and has therefore never once fired: **eight
`plot: approve` commits sit on `main`**, every one of them past a protection
rule that says changes must go through a pull request, and every one of them
without the `validate` check the same rule requires.

Nothing was harmed — the plans landed correctly, and this repo's owner is
entitled to bypass its own protection. That is exactly why it went unnoticed
for eight approvals: the outcome looks identical either way. The gap is not
that Plot bypasses protection. **It is that Plot cannot tell whether it did.**

And it is not one command's problem. Four sites push at the default branch —
`plot-approve`, `plot-deliver`, and twice in the `plot` hub — while the
fallback prose exists in exactly one of them. One instruction, four places that
need it, three that never got it: the shape CLAUDE.md describes as a rule
rather than a gate.

**The same defect, found ninety seconds later.** Asked to keep every plan under
a story, the obvious move was to check what already enforced that. It reported:

    $ ./skills/plot/scripts/plot-story-lint.sh
    story-lint: 0 finding(s)      (exit 0)

on a repo where **two active plans name no story at all**. The linter's four
checks — S1 through S4 — all ask *"does this story have what a story needs?"*
Not one asks *"does this plan have a story?"*. It was green because it was not
looking.

Both findings are the same failure: **a check whose green means "I did not
examine this", indistinguishable from "this is fine".** That is worse than no
check, because it turns an open question into a settled one. They belong in one
plan because fixing them separately would leave the pattern un-named — which is
what the `plot-gates` story exists to hold.

## Design

### Approach

**One helper, four one-line call sites.** `plot-push-main.sh` takes the branch
to push and the default branch, performs the push, and reports what actually
happened. The four commands stop describing the mechanics and call it. Skills
interpret; scripts collect and report (Principle 3) — and a rule that lives in
a script is a rule every caller gets, including a human running it by hand.

**Detection reads stderr, not the exit code.** This is the whole finding. A
bypass and a clean push are both exit 0 and differ only in what the remote
says; a rejection is exit 1. So there are three outcomes, not two:

    exit != 0                          → rejected  → micro-PR fallback
    exit 0, stderr has "Bypassed rule" → bypassed  → push landed, say so
    exit 0, no such line               → clean     → nothing to report

Capturing stderr is therefore load-bearing rather than incidental, and the
helper must not swallow it — several call sites currently end in `2>/dev/null`,
which would hide the one line that carries the answer.

**GitHub's wording is the signal, and that is a stated limitation.**
`Bypassed rule violations` is what the GitHub remote prints; Bitbucket
phrases its equivalent differently, and neither is a documented API. The
helper matches the string it can verify against and reports `unknown` where it
cannot — the same honesty `plot-host.sh` already applies to Bitbucket's
`checks:"unknown"`, which renders as unavailable rather than green. An
invented answer here would be worse than an absent one: a workflow that
reports "clean" for a bypass it merely failed to recognise is the exact defect
this plan exists to remove.

**Report and continue — never revert.** The push has landed by the time
anything is detectable. Undoing it would strand a merged plan at `Phase: Draft`
— the precise failure the original fallback was written to prevent. So the
helper reports, and the command carries the report into its summary:

    pushed to main — BYPASSED branch protection
      - Changes must be made through a pull request
      - Required status check "validate" did not run
    This repo allows it (enforce_admins is off). Nothing to undo.

Pre-checking the protection API before every push was considered and rejected:
it costs a network round-trip on every approval and delivery to predict an
answer the push itself returns for free, and it would still be a guess — the
API describes the rules, not whether *this* actor bypasses them.

Making it a hard gate was likewise rejected. The push has already succeeded;
stopping afterwards interrupts every booking with a question whose only honest
answer is "yes, that happened, carry on".

**The repo's own configuration stays as it is.** `enforce_admins: false` is a
deliberate choice and this plan does not touch it. Plot must work correctly in
a repo it does not control, which means noticing the bypass rather than
legislating it away.

**S5: a plan that names no story.** `plot-story-lint.sh` gains one check, in
the shape of the four it already has — `S5 <plan-path> — no Story: field` — and
it counts into the existing `story-lint: <n> finding(s)` footer, which already
exits 1 on findings and is therefore already gate-shaped. That is the whole
mechanism: the convention becomes checkable by being counted.

It reports rather than blocks, for the same reason the bypass does. A plan
without a story is a bookkeeping gap, not a dangerous act, and a hard stop on
plan creation would make `/plot-idea` refuse work in any repo that has not yet
written a story. The footer is what CI can gate on when a repo decides it
should — this repo's Definition of Done already has a place for that decision,
and it is a separate one from making the fact visible.

Two things this deliberately does not do. It does not invent a story for a plan
that has none: which story a plan belongs to is a judgment about intent, and
the lint's job is to say *this is unanswered*, not to answer it. And it does
not check that the named story **exists** — that is S1's territory read from
the other side, and conflating "no story named" with "story named but missing"
would produce one finding for two different problems with different fixes.

### Open Questions

- [ ] Does Bitbucket print anything recognisable on a bypassed push? Until
      someone runs one, `bb` pushes report `unknown` rather than a guess.
- [ ] Should a bypass be recorded in the plan file (an audit trail) rather than
      only printed? Argues against itself: the plan would carry a fact about
      *how it was written* rather than about the work, and git already has it.

## Branches

- `feature/push-main-bypass` — the push helper, its four call sites, the `S5` story-lint check, and tests for both

<!-- One branch: the helper and its callers are one change. Splitting them
     would land a helper nothing calls, or callers of a helper that does not
     exist yet. S5 rides along because it is the same defect in a second
     place, and because splitting it would make the pattern look like two
     unrelated chores. -->

## Notes

Found while approving `board-acts-through-plot` on 2026-08-16, when the push
printed its bypass notice in passing. The behaviour had been recorded as an
open question earlier in the same session and was, until this push, only
suspected: the evidence was the remote's own output, and the count of eight
came from `git log --grep "^plot: approve"`.

The `git push` exit codes were measured rather than assumed (a rejected push in
a scratch repo exits 1; the bypassed push exited 0) — which is what moved the
detection point from the exit code to stderr, and explains why prose keyed on
"if that push is rejected" could never have worked.

The story half arrived from the other direction: a request, mid-session, that
every Plot plan be managed under a story. Running `plot-story-lint.sh` to see
what already enforced that produced `story-lint: 0 finding(s)` on a repo with
two story-less plans — the same defect as the push fallback, found the same
way, roughly ninety seconds later. Two instances in one session is what turned
"fix this" into a story (`plot-gates`) rather than a one-off.

The plan's own `Story:` field was `plot-board` when first written, which was
wrong: that story is about making parallel work visible, and this is about
instructions that do not enforce themselves. Corrected before the first commit
— and the S5 check exists so that the next such mistake is a finding rather
than a thing someone happens to notice.

Definition of Done: `docs/definition-of-done.md`.
