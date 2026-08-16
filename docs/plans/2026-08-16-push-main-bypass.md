# The fallback that waits for a rejection that never comes

> Three commands push straight at the default branch. Where protection is
> configured but not enforced, the push is waved through — and Plot cannot
> tell that from a clean one.

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
- The plan template gains an optional `Story:` field, so the question is
  visible when a plan is created. Naming a story stays optional — a plan may
  belong to none.
- Board cards show a `no story` badge where a plan names none, so an
  unassigned plan reads as unassigned rather than as a card with nothing to
  say.

Board impact: **one badge, no contract change.** `Story:` is already parsed and
already rendered; the card gains a `no story` badge for the empty case, which
is a render-only change to `PlanCard`. No plan-format change, no new schema
field, no change to what the board reads — but the artifact is rebuilt, so the
Definition of Done's no-diff gate applies.

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

And it is not one command's problem. **Three** commands push at the default
branch — `plot-approve`, `plot-deliver`, and the `plot` hub's phase-fix
sequence — while the fallback prose exists in exactly one of them. (A fourth
mention, the hub's "how do I update main" table, describes the options rather
than running a push; it needs new wording, not the helper.) One instruction,
three places that need it, two that never got it: the shape CLAUDE.md describes
as a rule rather than a gate.

`plot-dispatch.sh` also pushes, and is deliberately left alone: it pushes a
claim to a *feature* branch, where rejection is the concurrency control working
as designed. Routing it through a helper built to treat rejection as an anomaly
would break a mechanism that is correct.

**A second finding, and a smaller one.** Looking at the story estate in the
same session turned up a gap of a different kind: the plan template ships with
`Sprint:` — optional — and **no `Story:` field at all**, though
`plot-plan-meta.sh` parses one and the board renders it as a swimlane. The
question is simply absent from the artifact `/plot-idea` fills in.

That is not the same defect as the push fallback, and this plan is careful not
to inflate it into one. A missing optional field is a visibility gap, not a
broken check. It travels with this plan only because both were found in one
pass over the same machinery, and because the fix is one line.

## Design

### Approach

**One helper, three one-line call sites.** `plot-push-main.sh` takes the branch
to push and the default branch, performs the push, and reports what actually
happened. The three commands stop describing the mechanics and call it. Skills
interpret; scripts collect and report (Principle 3) — and a rule that lives in
a script is a rule every caller gets, including a human running it by hand.

**Detection reads stderr, not the exit code.** This is the whole finding. A
bypass and a clean push are both exit 0 and differ only in what the remote
says; a rejection is exit 1. So there are three outcomes, not two:

    exit != 0                          → rejected  → micro-PR fallback
    exit 0, stderr has "Bypassed rule" → bypassed  → push landed, say so
    exit 0, no "remote:" lines at all  → clean     → nothing to report
    exit 0, remote said something else → unknown   → say that, don't call it clean

The fourth outcome is the one that keeps this plan from repeating its own
mistake. `Bypassed rule violations` is GitHub's current wording and not a
documented API; if it changes, a helper with three outcomes would silently
classify every future bypass as **clean** — a check that goes quiet exactly
when it stops working, which is the defect this plan exists to remove. So
unrecognised remote output is its own answer, reported as such.

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

The test therefore feeds the **real observed stderr**, recorded verbatim with
its date and origin (this repo, 2026-08-16), rather than a paraphrase written
from memory of what it looked like. A fixture that merely resembles the real
output tests the matcher against itself. If GitHub rewords the message the test
stays green — that is accepted and stated, because the failure it produces is
`unknown`, which is visible, and not `clean`, which is not.

Verifying via the protection API after each push was considered as a
text-independent cross-check. Rejected: one API call per approval and delivery,
GitHub-only, and it answers a slightly different question — whether the commit
carries the required checks, not whether *this push* bypassed a rule.

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

**The template never asks.** It carries `Sprint:` — optional — and **no
`Story:` field at all**, though `plot-plan-meta.sh` parses one and the board
renders it as a swimlane. So `/plot-idea` fills in a form where the question
does not appear, and a plan ends up story-less by default rather than by
decision. The field goes into the template, above `Sprint:`, because that is
the order of the two ideas:

    - **Story:**   <!-- optional, story slug (docs/stories/<slug>/) -->
    - **Sprint:**  <!-- optional, time-boxed selection -->

A **story is the durable intent** a plan serves; a **sprint is a time-boxed
selection** of already-planned work. They are independent fields at the same
level — neither knows about the other — and conflating them is what made an
earlier draft of this plan ask which story `plot-sprint-support` deserved, when
the real question was which intent it serves. It serves how Plot *structures*
work, which is why it now belongs to `plot-planning-model` rather than to a
story of its own.

**A plan without a story stays valid, and nothing checks for one.** An earlier
draft of this plan added an `S5` lint finding and wired `plot-story-lint.sh`
into CI so that every plan had to name a story. That was wrong, and the reason
is worth keeping: **stories are not a required layer above plans.** A plan runs
the same lifecycle either way, and small work — a fix, a doc change, a helper —
does not become clearer by having a story invented above it. A story earns its
place when several plans turn out to serve one intent; requiring it up front
inverts that, and would make `/plot-idea` demand an answer nobody has yet.

So there is no S5, no `lint:stories` CI step, and no obligation.

**But optional is not the same as invisible, and today it is invisible.** The
card renders its story badge on `showStory && card.story` — so a plan with no
story shows *nothing at all*, and "belongs to no story" is indistinguishable
from "the badge is switched off". That is the same ambiguity this plan is about,
in a much smaller place: an absence that reads as a non-answer.

The card therefore gains a muted **`no story`** badge where the field is empty,
in the slot the story badge would occupy:

    {showStory && (card.story
      ? <Badge variant="story">{card.story}</Badge>
      : <Badge variant="neutral">no story</Badge>)}

`neutral` is the existing variant the `Ready` badge already uses — there is no
`muted` in the component (checked). Neutral rather than a warning colour is the
point regardless: this is a legitimate state, not a defect, and colouring it
like one would re-create the obligation the gate was dropped to avoid.

It follows `showStory`, so filtering by a story still suppresses it —
the badge answers "which story?", and when a filter has already answered that,
repeating it is noise either way.

This is what replaces the discarded gate, and it is the better instrument: the
lint would have told CI that a plan lacked a story, which is not CI's business
when the field is optional. The badge tells the *person looking at the board*,
who is the one able to decide whether this plan wants a story — and it says so
without blocking anything. The swimlane layout already groups such plans into a
`(no story)` lane; this makes the same fact legible on the card itself, in the
column layout where no lane exists.

The template still gains `Story:` — as an optional field, beside the equally
optional `Sprint:` — because the current template omits it entirely while
`plot-plan-meta.sh` reads it and the board renders it. Making the field visible
in the artifact people fill in is a different act from requiring it, and only
the first one is wanted here.

### Open Questions

- [ ] Does Bitbucket print anything recognisable on a bypassed push? Until
      someone runs one, `bb` pushes report `unknown` rather than a guess.
- [ ] Should a bypass be recorded in the plan file (an audit trail) rather than
      only printed? Argues against itself: the plan would carry a fact about
      *how it was written* rather than about the work, and git already has it.

## Branches

- `feature/push-main-bypass` — the push helper, its three call sites, the optional `Story:` template field, the `no story` card badge, and tests

<!-- One branch: the helper and its callers are one change. Splitting them
     would land a helper nothing calls, or callers of a helper that does not
     exist yet. The template line rides along because it is one line found in
     the same pass, not because it belongs to the same defect. -->

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
— by a person noticing, which is how a wrong-but-present story will always be
caught. No check catches that one: a badge can say *no story*, but nothing
mechanical can say *wrong story*.

Interrogation found the plan claiming four push call sites. There are three,
plus a table row that describes options rather than running anything. The
number had been written without counting — in a plan about instructions nobody
verified.

**The story half was built and then removed, which is the more useful record.**
Two rounds went into an `S5` lint finding for plans naming no story, a
`lint:stories` CI step to give it teeth, and story assignments for every
existing plan so the new gate would not immediately go red. All of it rested on
an assumption nobody had stated: that every plan must belong to a story.

That assumption is wrong. **Stories are not a required layer above plans.** A
plan runs the same lifecycle either way, and small work does not get clearer
for having a story invented above it. A story earns its place when several
plans turn out to serve one intent — requiring it up front inverts that and
makes `/plot-idea` demand an answer nobody has yet.

Worth noting what the discarded work was reacting to, because that part was
real: `plot-story-lint.sh` is called by no npm script and no workflow, so its
`exit 1` footer is gate-*shaped* but wired to nothing. That remains true and is
now simply not this plan's problem — with no S5 there is nothing new to enforce,
and whether the existing S1–S4 deserve a CI step is its own question.

The story assignments made along the way were kept, since they were correct on
their own terms: `opus5-longhorizon-hardening` genuinely shares this plan's
subject, and `plot-sprint-support` genuinely belongs with how Plot structures
work. They were originally motivated as gate preconditions and survive the gate
being dropped.

What survived instead of the gate is the `no story` badge, and the swap is the
whole lesson of those two rounds. The lint would have told **CI** that a plan
lacked a story — which is not CI's business once the field is optional, and
which stops a merge over a bookkeeping preference. The badge tells the **person
reading the board**, who is the only one positioned to judge whether this
particular plan wants a story, and it costs nothing when the answer is no.
Same fact, surfaced to the party who can act on it, with no obligation attached.

Also settled in passing, and the reason the template line stays: sprints and
stories are not alternatives. A story is the durable intent; a sprint is a
time-boxed selection of already-planned work — which the February sprint plan
already said (*"Plans track what to build; sprints track when to ship it"*) and
the template never learned.

Definition of Done: `docs/definition-of-done.md`.
