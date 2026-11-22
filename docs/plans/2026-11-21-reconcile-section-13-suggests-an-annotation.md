# Reconcile section 13 suggests an annotation for a stale sprint tally, but the scan never reads one

> Section 13 of `plot-reconcile-scan.sh` prints "or add an annotation explaining why it stays unchecked", and the loop reads no annotation, so the finding cannot be cleared that way.

## Status

- **State:** Approved
- **Type:** feature
- **Sprint:**
- **Issue:** #3586
- **Story:**
- **Review:** pr
- **Impl:** own branches
- **Rounds:** 2
- **Approved:** 2026-11-22, Jan Wloka, plan-PR #3606 merged
- **Started:** 2026-11-22, Jan Wloka, `feature/reconcile-13-hint-names-only-the-tick`

## Changelog

- The fix hint of reconcile section 13 (stale sprint tally) names only the action the scan honours: tick the sprint item. It no longer suggests an annotation that the scan does not read.

<!-- Board impact: none. The slice changes one hint string and two comments in `plot-reconcile-scan.sh`. `staleTally` in `packages/domain/src/workflows/reconcile.ts` and the board's decoder (`entry/reconcile.ts:170`) read the section's findings and its count, which do not change. -->

## Motivation

Issue #3586 (Plot 2.35.1, Bitbucket consumer, 2026-11-20). Section 13 ("Stale sprint tally") reports an unchecked sprint item whose plan is Delivered or Released and prints `fix: tick the item, or add an annotation explaining why it stays unchecked` (`skills/plot/scripts/plot-reconcile-scan.sh:1866`). The loop matches `^- \[ \] \[slug\]`, looks up the plan phase and counts every `delivered` or `released` plan. It reads nothing after the slug, so an annotation cannot clear the finding and `stale_tally=` stays above 0.

Reproduction: an active sprint lists `- [ ] [remove-selectors] … released`. The author keeps the item unchecked until the release is cut while the plan is already Delivered. An HTML comment on the item and a Scope Changes line leave section 13 reporting `stale_tally=1`.

The estate already decides that such an item is finished. `scoreItem` and `plot-sprint-release.sh:72-79` score an unchecked item over a Delivered plan as `done`, `deliver.ts:248` ticks the item when the plan is delivered, and `/plot-sprint close` step 2a ticks it at close. Section 17 already reports a sprint whose release is tagged, and it states that a tag proves no completion. So the item is stale, and the finding is correct. Only the hint is wrong.

## Design

### Approach

The fix hint names only the action that clears the finding. Line 1866 reads `fix: tick the item`. An item that stays unchecked on purpose remains a finding, because every other command treats it as done.

The slice also corrects the section's comments. The header list at `plot-reconcile-scan.sh:113` keeps "13. Stale sprint tally". The body comment at `:1809` reads "11. Stale sprint tally" and changes to "13.". The comment at `:1986` ("13. Stale interrogation rounds") belongs to another section, and the slice leaves it.

What does not change:

- No annotation is read, so the member regex shared with `board.ts` and sections 9 to 11 stays the same.
- `stale_tally=` keeps its meaning and its footer position, so the literal summary assertion at `test/reconcile/scan.test.mjs:298` holds.
- `staleTally` in `workflows/reconcile.ts:125-130` and the `sprint-tally-stale` finding keep their meaning. No corpus pair is needed, because the rule's input and output do not change.
- `check-shell-lines.sh pr` has no headroom. The slice edits lines in place and adds none.

No test asserts the hint text today (`git grep 'add an annotation explaining'` finds only line 1866). The slice adds one assertion in `test/reconcile/scan.test.mjs`, next to the existing section 13 case, that the hint reads `fix: tick the item` and names no annotation. It reuses the existing section 13 fixture and adds no new fixture.

### Open Points

- [x] [Domain] Option 1 or option 2? Option 2: the hint names only "tick the item". An unchecked item over a Delivered plan is `done` to `scoreItem`, `deliver.ts:248` and close step 2a, so a kept-open state would exist in this one section only. — *panel: amend, round 1 and 2; decided at approval*
- [x] [Domain] Annotation syntax. No annotation is read, so the collisions with `<!-- pr: #N, branch: x -->` (`sprint-annotation.ts:44-48`) and `<!-- reconciled: <phase> -->` (close step 2a) do not arise. — *panel: amend, round 1 and 2; closed by option 2*
- [x] [Domain] An unshipped `Release:` suppresses nothing. Section 17 owns the release reading, and a tag proves no completion. — *panel: amend, round 1; closed by option 2*
- [x] [Technical] No new footer counter. `stale_tally=` stays as it is, and `scan.test.mjs:298` holds. — *panel: amend, round 1; closed by option 2*
- [x] [Technical] Cost: the slice adds no shell lines, so `check-shell-lines.sh pr` passes with no offset. — *panel: amend, round 1; closed by option 2*
- [x] [Technical] Duplicated rule: `staleTally` and `sprint-tally-stale` keep their meaning, and the Board impact note names them. — *panel: amend, round 1; closed by option 2*
- [x] [Deliverable] The Changelog and the slice name one outcome, and both section 13 comments are named. The consumer's "#3489" reference is removed. — *panel: amend, round 1; done*
- [x] [Technical] `annotateSprintItem`'s `branchPattern` is not touched, because no `open:` field is written. — *panel: amend, round 2; closed by option 2*
- [x] [Deliverable] The test list is one assertion on the hint text in the existing section 13 case of `scan.test.mjs`. The annotation cases do not apply. The changeset is a `plot` patch. — *panel: amend, round 2; done*
- [x] [Deliverable] The slice changes `:1809` from "11." to "13.", keeps `:113`, and leaves `:1986`. — *panel: amend, round 2; done*
- [x] [Cost] Option 2 costs one string edit and one comment edit: no added shell lines, no corpus pair, no domain change. — *panel: amend, round 2; taken*

## Slices

### Scan

- `feature/reconcile-13-hint-names-only-the-tick` — section 13's fix hint at `plot-reconcile-scan.sh:1866` reads `fix: tick the item`, and the body comment at `:1809` reads "13." in place of "11."; a `plot` patch changeset <!-- builds: section 13 fix hint text --> <!-- tests: test/reconcile/scan.test.mjs — the section 13 finding's hint reads "fix: tick the item" and names no annotation -->

## Notes

Created unattended from issue #3586. Type, Review and Impl answered from the prompt and `Plan PRs: required`; State stays Draft. Amended after round 2 to option 2, which three of the four round-2 jurors recommended and the fourth accepted.

<!-- CHALLENGE-THE-PLAN-METADATA
{
  "round": 2,
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
