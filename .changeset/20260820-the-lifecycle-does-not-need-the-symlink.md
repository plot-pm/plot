---
"plot": minor
---

plot-idea, plot-deliver: the lifecycle does not need the symlink

The readers stopped depending on `docs/plans/active/` in #254 and #256. The
**writers** still did, and one of them was strictly worse off for it: a plan
carrying no symlink was undeliverable, and `/plot-deliver` said it did not
exist.

`/plot-deliver` step 2 asked `ls docs/plans/active/<slug>.md` and treated a
miss as *no plan found*. Step 1 listed candidates the same way. So a plan
written directly rather than through `/plot-idea` — valid, approved, pushed,
already dispatched — could not be delivered, and the message named the wrong
cause. Three plans in this repo were in exactly that state on 2026-08-20.
Existence is now a fact about the resolved file's `Phase:` field, and the slug
resolves through the same precedence `plot-fleet-scan.sh`, `plot-approve.sh`
and `plot-dispatch.sh` already use — dated file, then `active/`, then
`delivered/` — so one slug means one plan whoever asks.

**`/plot-idea`'s duplicate check was a gate a missing symlink could bypass.**
It read `ls docs/plans/active/`, and its own text calls the slug-collision
check a hard gate. A plan not in the index was invisible to it, so the gate
passed for precisely the slugs most likely to collide — the ones written
directly. It now reads the plan directory, which holds every plan by
construction. *Gates Over Rules* (`CLAUDE.md`) is the reason this is a fix and
not a tidy-up: a gate that can be satisfied without doing the work is a rule.

**The index writes become best-effort, and the ordering changed.** Both skills
staged the plan file and the symlink together, and `/plot-deliver` ran a bare
`git rm docs/plans/active/<slug>.md`. `git rm` on an absent path exits
non-zero, so the ordinary shape for a directly-written plan *aborted the
delivery of finished work* — a transition blocked by the state of a browsing
aid. The plan file is now staged first, every index operation is
`|| true`-guarded, and `ln -sfn` replaces `ln -s` so re-running a delivery
repairs the link instead of failing on it.

**Symlinks are still created.** The plan's first Open Point — whether stable
slug-named paths are worth generating once nothing reads them — stays open, and
this change is deliberately correct either way. What ends is anything
*depending* on them.

**Measured, not assumed: the `Delivered:` record is load-bearing.** Writing the
e2e flow, a plan flipped to `Phase: Delivered` with no `Delivered:` record was
reported by the derived scan as **zero plans**. `plot-fleet-scan.sh` shows
delivered plans for a rolling window and reads that window from
`delivered_raw`, so a phase flip alone trades a missing symlink for a missing
field — the same invisibility one level in. The skill now states both edits as
the transition rather than mentioning the record in a comment, and says why.

The e2e harness could not have caught any of this: `instantiatePlan()` created
the symlink unconditionally, so the fixture guaranteed the precondition under
test. It takes `link: false`, and flow e asserts the plan's own three claims for
an unlinked plan — discoverable, deliverable, reportable. Dispatchability and
board visibility already held (wave 1, plus the `$PLAN_DIR` fallback
`plot-dispatch.sh` and `plot-approve.sh` carried); they are asserted anyway,
because *still true after this change* is the property that matters and nothing
held it.

<!--
bumps:
  skills:
    plot-idea: minor
    plot-deliver: minor
-->
