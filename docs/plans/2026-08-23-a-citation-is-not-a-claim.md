# A citation is not a claim

> `## Branches` sections cite other plans' branches to declare dependencies. The parser reads every backticked branch name there as a claim, so two plans claimed one branch and the board rendered it twice, in two sections, as *claimed twice*.

## Status

- **Phase:** Approved
- **Type:** bug
- **Sprint:** <!-- optional -->
- **Issue:** <!-- optional -->
- **Story:** <!-- optional -->
- **Review:** in-session
- **Impl:** own branches
- **Approved:** 2026-08-27, Jan Wloka, in-session
- **Started:** 2026-08-27, Jan Wloka, `bug/a-claim-is-a-list-item`

## Changelog

- A branch is claimed by the plan that lists it, not by every plan that mentions it — a dependency cited in prose no longer reads as a second claim on the same branch.
- `plot-reconcile-scan.sh` reports a branch claimed by more than one plan, which nothing did before.

<!-- Board impact: no contract change. Touches skills/plot/scripts/plot-plan-meta.sh
     (the branch matcher — the plan-format contract) and plot-reconcile-scan.sh (a new
     section). The board consumes both through the pulse. Rebuild the artifact. -->

## Motivation

Measured on the live board, 2026-08-23. Two rows carried an orange
**`claimed twice — claimed by 2 plans`** mark, and the estate agreed:

```
feature/the-registry-knows-which-agents-live
    approval-hands-the-work-to-agents   (### Alive)     ← lists it
    every-section-has-one-subject       (### Inverted)  ← CITES it

feature/implement-runs-from-the-board
    an-approved-plan-offers-its-two-starts (### Offered) ← lists it
    a-dispatch-hands-over-a-brief          (### Handed)  ← CITES it
```

Both second claims are **dependency citations**, and both read naturally:

> **Depends on `approval-hands-the-work-to-agents` wave 1**
> (`feature/the-registry-knows-which-agents-live`), and the dependency is not
> tidiness.

That is a plan explaining why its wave is ordered where it is. It is exactly
what a `## Branches` section should say. But `plot-plan-meta.sh` extracts
branches with one expression:

```awk
BEGIN { branch_re = "`(" PREFIXES ")/[^`]+`" }
...
while (match(line, branch_re)) { branches[++n_branches] = ... }
```

**Any backticked branch name on any line under `## Branches` is a claim** — in a
blockquote, in prose, in an HTML comment, mid-sentence.

### What it cost

- `/plot-dispatch` would fan out a branch a plan does not own. Recorded in this
  session's notes as the shape *"every backticked name in `## Branches` gets
  dispatched, including prose mentions in tables"* — so this has bitten before,
  and the fix then was to reword the prose.
- The wave's branch count is wrong, so a wave reads incomplete while every
  branch it owns has merged.
- The board renders the branch under both plans, in different sections, which is
  the *one wave, one row, one section* invariant failing from the data side
  rather than the renderer.

**Nothing was lost this time.** Both cited branches were already merged and
their refs deleted, so the doubled rows were display and bookkeeping only. The
two citations have been reworded on `main` as an immediate repair; this plan is
about the parser that made rewording necessary.

### Why rewording is not the fix

A rule that says *do not backtick a branch name you do not own* is a rule an
author must remember, in the one section where writing branch names is the
entire point. It has already been forgotten twice. **Gates over rules** — the
parser should be unable to read a citation as a claim.

## Design

### The rule: a claim is a list item that STARTS with the branch

A branch line has one shape in this repo, and it is unambiguous:

```markdown
- `feature/the-thing` — what it does
```

Measured across `docs/plans/` on 2026-08-23: **248 branch list items, every one
of them starting with `- ` followed immediately by the backticked name.** Not
one real claim uses any other shape.

Every loose occurrence — all of them — is a citation, an HTML comment, or a
continuation line:

```
The blocker named here — `bug/board-claimed-from-git` — merged as #123
<!-- `feature/implement-and-dispatch-take-a-plan` was removed 2026-08-22. -->
      on `bug/a-wave-is-one-row` in a wave Plot enforces.
```

So the matcher moves from *anywhere on the line* to *anchored at the start of a
list item*:

```awk
branch_claim_re = "^[ \t]*-[ \t]+`(" PREFIXES ")/[^`]+`"
```

**This is a measurement, not a preference.** The sweep above is what licenses
the change: a stricter rule that dropped real claims would be a regression, and
248-for-248 says it drops none.

### What must keep working

- **The annotations bind to the same line**: `→ #N`, `<!-- deferred: … -->`,
  `<!-- claimed: … -->`, `<!-- moved: … -->`. They are read from `$0` around the
  match and are unaffected by anchoring it — but the deferral logic reads the
  whole line, so confirm the anchor did not change which line is "the line".
- **One list item may still carry only one branch.** The current loop is a
  `while (match(...))` over the line, which could in principle take two names
  from one item. Anchoring makes that impossible by construction; verify no plan
  relies on it (the sweep says none does).
- **Continuation lines stay excluded**, which they already are in practice: a
  wrapped description does not start with `- `.

### And the check that would have found it

`plot-reconcile-scan.sh` has seven sections and **none reports a branch claimed
by more than one plan**. The board found this defect; the sweep whose whole
purpose is estate faults did not.

Add a section: every branch appearing in more than one plan's parsed branch
list, naming the plans and their waves, with a machine-countable footer entry
like its siblings.

**It must not gate.** `attention=` stays as it is — the same rule the unsliced-wave
section (#341) follows, and for the same reason: a double claim is a shape to
fix, not a branch that cannot move. Section 7's comment argues this split and
should be followed rather than re-derived.

**The section survives the parser fix.** After anchoring, a double claim can only
come from two plans genuinely listing one branch — which is a real conflict
needing a human, and exactly what the section should report. The parser fix
removes the false positives; the section catches the true ones.

### Not chosen: allow a plan to cite branches in a `Depends on:` field

A structured field would let a citation be machine-readable rather than merely
ignored. Rejected as a larger change than the defect warrants: it adds to the
plan-format contract that five scripts read, and the dependency is already
expressed by wave ordering. Revisit if cross-plan dependencies need to be
queryable.

### Open Questions

- [ ] Should the parser report ignored branch-like strings under `## Branches`,
      so an author who writes a claim in the wrong shape learns it was dropped?
      Silence is what made the loose form survive. But a warning on every
      legitimate citation would be noise — perhaps only for a `- ` item whose
      branch name is not the first token.

## Done when

- A branch named in a **blockquote** under `## Branches` is not a claim.
  Asserted with the exact shape from `every-section-has-one-subject`.
- A branch named **mid-sentence** in a branch line's own description is not a
  second claim. This is the `a-dispatch-hands-over-a-brief` case, and it differs
  from the blockquote one: the line IS a claim, and the citation sits inside it.
- A branch in an **HTML comment** is not a claim.
- Every existing branch list item still parses as a claim. Assert
  **differentially**: count with the parser over `docs/plans/` before the
  change, count after, require equality — a stricter matcher that silently
  drops one real claim is the failure mode this change must not have.

  **Do not hardcode a total.** This plan was written against 248 anchored
  claims on 2026-08-23; re-measured on main 2026-08-27 the count is **200**
  anchored against **616** loose occurrences. The estate moves under this
  number, and the ratio is what carries the argument — roughly two in three
  backticked branch names in `docs/plans/` are citations rather than claims,
  a wider false-positive surface than the original count implied. An absolute
  assertion would fail a correct implementation.
- The `→ #N`, `deferred`, `claimed` and `moved` annotations still bind.
- `plot-reconcile-scan.sh` reports a branch listed by two plans, naming both and
  their waves, with a footer count; and reports **nothing** for the estate as it
  stands after the citations were reworded.
- `attention=` is unchanged by the new section. Assert directly against a
  fixture that has a double claim.
- `pnpm test`, `pnpm run test:reconcile`, `pnpm run test:e2e` green.

## Waves


### Anchored (Branch: bug/a-claim-is-a-list-item, PR: #490)
- the branch matcher anchors to the start of a list item, so a citation in a blockquote, a comment or a sentence is no longer a claim; all 248 existing claims still parse


### Counted (Branch: bug/reconcile-reports-a-double-claim)
- a new section reporting any branch claimed by more than one plan, with a machine-countable footer entry; it reports and never gates

## Notes

Found 2026-08-23 from the board: two rows wearing `claimed twice`. The immediate
repair was to reword both citations on `main`, which is what let the estate go
clean the same afternoon — the sweep now reports every branch claimed by exactly
one plan.

This plan exists because that repair is a rule, and the rule had already been
forgotten twice: once before, recorded as *"every backticked name in
`## Branches` gets dispatched, including prose mentions in tables"*, and once
again here. **Gates over rules** — a `## Branches` section is where authors are
supposed to write branch names, so a parser that cannot distinguish citing from
claiming will keep being wrong there.

<!-- CHALLENGE-THE-PLAN-METADATA
{
  "round": 1,
  "questionHistory": [
    {"q": "Is anchoring the matcher safe, or would it drop real claims?", "a": "Safe - measured 248 branch list items across docs/plans, every one starting `- ` + backtick; every loose occurrence is prose, an HTML comment, or a continuation line", "category": "technical"},
    {"q": "Does the reconcile section become redundant once the parser is fixed?", "a": "No - the parser removes false positives, the section catches true ones: two plans genuinely listing one branch is a real conflict needing a human", "category": "architecture"},
    {"q": "Should the new section gate on attention=?", "a": "No - a double claim is a shape to fix, not a branch that cannot move; same rule the unsliced-wave section follows", "category": "tradeOffs"}
  ],
  "deferredItems": [],
  "categoriesCovered": {
    "technical": {"stack": true, "architecture": true, "implementation": true},
    "domain": true,
    "ux": {"happyPath": false, "edgeCases": false, "errors": false, "accessibility": false},
    "nonFunctional": {"security": false, "performance": false, "scalability": false},
    "tradeOffs": true
  }
}
END-CHALLENGE-THE-PLAN-METADATA -->
