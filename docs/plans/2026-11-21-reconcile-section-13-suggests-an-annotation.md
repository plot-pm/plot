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
