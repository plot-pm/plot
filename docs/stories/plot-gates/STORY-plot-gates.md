---
title: Rules that do not enforce themselves
author: jwloka
status: active
created: 2026-08-16
updated: 2026-08-16
---

# Rules that do not enforce themselves

## Objective

Find the places where Plot **says** something is required and nothing checks
it, and convert those into gates — after confirming the requirement is real.
The test CLAUDE.md states is the frame:

> Can you answer "Did I complete this?" without actually doing the work? If
> yes, it's a rule. If no, it's a gate.

Plot is a system of instructions that agents follow. Its failure mode is
therefore not a crash but a **quiet non-event**: an instruction that reads as
satisfied while nothing happened. Those are invisible by construction — the
outcome looks the same either way — so they surface one at a time, by accident,
usually long after they stopped working.

## Why Now

Two of them surfaced within one session, and both had been silently broken for
a long time.

`/plot-approve` documents a branch-protection fallback keyed on *"if that push
is rejected"*. It had never fired: this repo has `enforce_admins: false`, so an
admin's push is **waved through** rather than refused. Eight `plot: approve`
commits sit on `main`, each past a rule requiring a pull request, each without
the `validate` check that rule demands. The condition was never met because
rejection was never the outcome.

A second candidate looked identical and turned out not to be. `plot-story-lint.sh`
reports `story-lint: 0 finding(s)` on a repo where two active plans name no
story — because its four checks all ask *"does this story have what a story
needs?"* and none asks *"does this plan have a story?"*. Two rounds went into
adding that check and wiring the linter into CI before the premise collapsed:
**a plan is not required to have a story.** There was nothing to enforce, so
the finding was dropped in favour of a `no story` badge on the board card.

That is the more useful lesson for this story, and it needs stating alongside
the objective: **not every missing check is a missing gate.** A gate is only
right where something is genuinely required. Where the field is optional, the
same impulse produces a rule nobody agreed to — enforced by CI, discovered by a
red build. The test is therefore two-sided: *is this actually required?* comes
before *is this actually enforced?*

Where something **is** required, the shape to hunt is: **a check whose green
means "I did not examine this", indistinguishable from "this is fine".** That
is strictly worse than no check, because it converts an open question into a
settled one.

## Decisions Taken in Scoping

**Why a story rather than one plan each?** Because the individual findings are
small and the pattern is not. Fixing the push fallback takes a helper and four
call sites; fixing the lint takes one more check. Neither justifies its own
frame. What justifies a frame is that both were found by *executing* something
and reading its real output — and that there are certainly more, because
nothing about either was visible from reading the instructions that contained
them.

**Why not fold this into `plot-board`?** That story is *Making parallel work
visible* — visibility of work in flight. This one is about instructions that
do not enforce themselves. They share a repository and nothing else; merging
them would leave a story whose objective is "Plot", which is not an objective.

**Scope boundary.** This story covers Plot's own rules-without-gates. It does
not cover repository configuration: `enforce_admins: false` is a deliberate
choice and stays. Plot must work correctly in a repo it does not control, which
means *noticing* a bypass rather than legislating it away.

## Plans

| Plan | Status | What it closes |
|------|--------|----------------|
| [push-main-bypass](../../plans/2026-08-16-push-main-bypass.md) | Draft | The fallback that waits for a rejection that never comes |
| [opus5-longhorizon-hardening](../../plans/active/opus5-longhorizon-hardening.md) | Approved, PR #57 open | Delivery gates made mechanically verifiable; bounded sprint runner and interrogation loops |

## Session Narrative

**2026-08-16 — the bypass, found by reading a push.** Approving
`board-acts-through-plot` printed `remote: Bypassed rule violations` in
passing. Measuring the exit codes (a rejected push in a scratch repo exits 1;
this one exited 0) moved the detection point from the exit code to stderr and
explained why prose keyed on "if that push is rejected" could never have
worked. `git log --grep "^plot: approve"` supplied the count: eight.

Asked to put every plan under a story, `plot-story-lint.sh` was run to see what
it already enforced. It reported zero findings on a repo with two story-less
plans, which looked like a second instance of the same pattern — found the same
way, ninety seconds later.

It was not. Two interrogation rounds built the missing check and the CI step to
give it teeth before the premise was challenged directly: plans without stories
are fine, and small work does not need one. The gate came out; a `no story`
badge on the board card went in. The scar is worth keeping — the pull toward
"there is no check here, therefore add one" was strong enough to survive two
rounds of scrutiny that were otherwise finding real defects.
