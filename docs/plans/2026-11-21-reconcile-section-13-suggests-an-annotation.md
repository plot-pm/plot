# Reconcile section 13 suggests an annotation for a stale sprint tally, but the scan never reads one

> Section 13 of `plot-reconcile-scan.sh` prints "or add an annotation explaining why it stays unchecked", and the loop reads no annotation, so the finding cannot be cleared that way.

## Status

- **State:** Draft
- **Type:** feature
- **Sprint:**
- **Issue:** #3586
- **Story:**
- **Review:** pr
- **Impl:** own branches
- **Rounds:** 1

## Changelog

- Reconcile section 13 reads a defined annotation on an unchecked sprint item and reports it as kept open, or its fix hint stops naming an annotation.

<!-- Board impact: none. The change touches one scan section and its footer counter; the board reads neither. -->

## Motivation

Issue #3586 (Plot 2.35.1, Bitbucket consumer, 2026-11-20). Section 13 ("Stale sprint tally") reports an unchecked sprint item whose plan is Delivered or Released and prints `fix: tick the item, or add an annotation explaining why it stays unchecked` (`skills/plot/scripts/plot-reconcile-scan.sh:1866`). The loop matches `^- \[ \] \[slug\]`, looks up the plan phase and counts every `delivered` or `released` plan. It reads nothing after the slug, so an annotation cannot clear the finding and `stale_tally=` stays above 0.

Reproduction: an active sprint lists `- [ ] [remove-selectors] … released`. The item commits to the release, so it stays unchecked until the release is cut while the plan is already Delivered. An HTML comment on the item and a Scope Changes line leave section 13 reporting `stale_tally=1`.

A second question from the issue: an item can commit to more than the plan's delivery ("…, released"). For a Delivered plan in an Active sprint whose `Release:` has not shipped, the item may be correctly open. Section 17 already knows whether the sprint's release shipped. Related: #3489.

## Design

### Approach

The fix hint names an action the scan does not honour. Two ways to close the gap, and the plan chooses one at approval:

1. **Read an annotation.** Section 13 reads an HTML comment after the item's description, `<!-- open: <reason> -->` or any HTML comment, and prints `kept open: <reason>` without incrementing `n_stale_tally`. The fix hint keeps naming the annotation and gives its syntax.
2. **Drop the half-promise.** The fix hint names only "tick the item". An item that stays unchecked on purpose remains a finding.

Recommendation: option 1, scoped to the release case. An item whose sprint names a `Release:` that has not shipped is open on purpose, and section 17 (`plot-sprint-release.sh`) already answers whether the release shipped. The scan can suppress the finding for such an item without any annotation, and read an explicit annotation for every other case. The annotation costs the author one comment and removes a finding that otherwise recurs on every reconcile pass.

Constraints from the existing section:

- The section stays advisory and stays out of `attention=`.
- `stale_tally=` keeps its meaning: items nobody has explained. A kept-open item gets its own line and no count, or a new footer counter if the board or a consumer needs the number.
- The sprint member regex is shared with `board.ts` and sections 9 to 11. The annotation read must not change which lines count as members.
- A Delivered plan whose sprint release has shipped and whose item is still unchecked stays a finding, annotation or not, because section 17 reports that case.

Board impact: none expected. Verify that `packages/board` does not parse the comment text on a member line.

### Open Questions

- [ ] Option 1 or option 2 (see Approach)?
- [ ] Annotation syntax: a fixed `<!-- open: <reason> -->` or any HTML comment after the description?
- [ ] Does an unshipped sprint `Release:` suppress the finding by itself, or only with an annotation?
- [ ] Does a kept-open item need its own footer counter?

## Slices

### Scan

- `feature/reconcile-13-reads-open-annotation` — section 13 reads the annotation (and the unshipped-release case, if chosen), prints `kept open: <reason>`, keeps it out of `stale_tally=`, and updates the fix hint and the section's header comment; contract test in `test/reconcile/` covering annotated, unannotated and shipped-release items <!-- builds: kept-open reading in reconcile scan section 13 -->

## Notes

Created unattended from issue #3586. Type, Review and Impl answered from the prompt and `Plan PRs: required`; State stays Draft.

## Open Points

- [ ] [Domain] Option 1 or option 2? An unchecked box over a Delivered plan is `done` to `plot-sprint-release.sh:72-79`, is ticked by `deliver.ts:248` and is ticked by `/plot-sprint close` step 2a, so option 1 keeps a state that no other command keeps. Estate and contradiction jurors favour option 2. — *panel: amend, round 1*
- [ ] [Domain] Annotation syntax: "any HTML comment" is refuted, because `/plot-approve` writes `<!-- pr: #N, branch: x -->` on every approved item (`sprint-annotation.ts:44-48`). If option 1 stays, the syntax is an `open: <reason>` field inside the item's existing comment, and the reason needs a defined end because `annotateSprintItem` splices into the first `<!--`. — *panel: amend, round 1*
- [ ] [Domain] An unshipped `Release:` suppresses the finding by itself: four jurors say no, because it contradicts `scoreItem`'s `done` and close step 2a. The plan's claim that `plot-sprint-release.sh` knows whether the release shipped is false; the tag lookup is the scan's own section 17 loop and section 17 skips Closed sprints. — *panel: amend, round 1*
- [ ] [Technical] A kept-open item needs no footer counter: nothing under `packages/` reads `stale_tally=`, and a new counter breaks the literal summary assertion at `scan.test.mjs:298`. — *panel: amend, round 1*
- [ ] [Technical] Cost: `check-shell-lines.sh pr` has zero headroom, so option 1 must remove as many shell lines as it adds. The plan states no offset. — *panel: amend, round 1*
- [ ] [Technical] Duplicated rule: `packages/domain/src/workflows/reconcile.ts:125-130` holds `staleTally` and `sprint-tally-stale`, and the board decodes it (`entry/reconcile.ts:170`). The plan says the board reads neither. Name the domain rule and update it, or state that it is dead. — *panel: amend, round 1*
- [ ] [Deliverable] Rewrite the Changelog and the slice to one outcome, drop "if chosen", and name both header comments of section 13. "Related: #3489" is the consumer's number; in this repo #3489 is `approve-and-deliver-run-without-a-board`. — *panel: amend, round 1*

<!-- CHALLENGE-THE-PLAN-METADATA
{
  "round": 1,
  "questionHistory": [],
  "deferredItems": [],
  "categoriesCovered": {
    "technical": {"stack": false, "architecture": true, "implementation": true},
    "domain": true,
    "ux": {"happyPath": false, "edgeCases": false, "errors": false, "accessibility": false},
    "nonFunctional": {"security": false, "performance": true, "scalability": false},
    "tradeOffs": true
  }
}
END-CHALLENGE-THE-PLAN-METADATA -->
