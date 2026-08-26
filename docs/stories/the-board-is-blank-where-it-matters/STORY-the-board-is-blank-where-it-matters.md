---
title: The board is blank where it matters
author: jwloka
status: active
created: 2026-08-26
updated: 2026-08-26
---

# The board is blank where it matters

## Objective

A team on Bitbucket, Jenkins and Jira opens the board. Branches are there. Pull
requests are there. **The ticket inbox is empty and build status says nothing** —
not *failing*, not *unavailable*: nothing.

Nothing is a claim. The board is asserting that this team has no tickets and no
builds, when in fact it has both and Plot never asked. This story is about the
gap between *cannot ask* and *nothing to show*, at the one surface where a user
cannot tell them apart.

## Why Now

[[plot-in-a-customer-team]] — *The board sees one repository* — found that a
team's work spanned four repositories the board never queried. This is the same
population and the same surface, one axis over: the origins the board never
asks. That story's own scoping refused to fold into [[plot-board]] because *"the
cross-repo finding contradicts its frame rather than extending it"*; the same
argument makes this a sibling of both rather than a child of either.

Measured on `main` 2026-08-26, per operation in `plot-host.sh`:

```
                 github      bitbucket
pr-state           ✓            ✓
pr-list            ✓            ✓  (capped at 50/state — silently)
issue-list         ✓          exit 4
issue-view         ✓          exit 4
build status       ✓  (gh check rollup)   NOTHING
```

## Decisions Taken in Scoping

**Q: Is this not just "Bitbucket support"?**
No, and measuring first is what showed it. Five of seven PR operations already
work on Bitbucket. The gaps are three unrelated shapes — a backend that exits 4,
a backend that does not exist, and a config key with no consumer — and naming
them as one feature is how each stays two-thirds done.

**Q: `exit 4` is honest. Why is that a problem?**
`plot-host.sh` is right to exit 4 rather than return an empty list: *cannot be
asked* is not *empty*, and the adapter refuses to fabricate. The failure is at
the SURFACE. By the time the answer reaches a person it has become an empty
section, and an empty section reads as a fact about their work. The honesty is
lost in the last step, which is the only step the user sees.

**Q: Is Jenkins/Jira genuinely absent, or just untested?**
Absent, and the shape is worse than absent. `plot-board-probe.sh` detects the
`jen` CLI, a Jenkinsfile and its auth state; `plot-config.sh` documents
`Tracker: jira`, `CI: jenkins` and `Jenkins instance`. But `plot-host.sh`
contains **zero** references to `jen`, and nothing reads a Jenkins status. The
configuration is asked for, recorded, and never consumed — so the board reads as
configured while behaving as unconfigured.

**Q: Does the 50-PR cap belong here?**
Yes. `bb pr list` returns a fixed page of 50 per state; past that the join is
silently partial and a branch reads **no PR** when one exists. That is the same
failure as the empty inbox — a limit reaching the user as a fact about their
work — and it is issue #333, with a plan on PR #408.

**Q: What counts as evidence here?**
The operation that runs, not the key that is documented. `plot-config.sh`
describes `Tracker: jira` in a comment block; grepping for a consumer returns
nothing. This repo's comments read like specification, which is the trap
[[plot-in-a-customer-team]] recorded reversing two of its own verdicts.

## Current Plan

### Phase 1: Name the gaps from the operation, not the feature ✅

- ✅ Per-op measurement of `plot-host.sh` across both backends
- ✅ Confirm Jenkins/Jira are probed and configured but never consumed
- ✅ Sprint `the-board-serves-an-enterprise-stack` opened against these findings

### Phase 2: Plans, one per origin ⏸️

- ⏸️ Tickets from Jira — the origin an enterprise team cannot get any other way
- ⏸️ Tickets from Bitbucket — smaller; the adapter already has the shape
- ⏸️ Build status from Jenkins — the trail ends before `plot-host.sh`
- ⏸️ The 50-PR cap (#333) — plan drafted on PR #408, unapproved, two open questions

## Open Points

- ⏸️ **Does an empty section need to say why it is empty, independent of the
  backends?** A board that renders *tickets: not asked — no tracker configured*
  would be honest today, without any new backend. That may be a separate and
  much cheaper piece of work than any of the four.
- ⏸️ Has anyone on an enterprise stack actually opened this board? The gaps are
  measured from the code; the *inference* a user draws from a blank section is
  reasoned, not observed. [[plot-in-a-customer-team]] hit the same limit and
  recorded it rather than assuming.
