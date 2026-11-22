# Panel: reconcile-section-13-suggests-an-annotation

Reconciliation: unanimous `amend` (estate, contradiction, deliverable, cost). Siblings read: the active sprint `delivery-ui-polish` and the estate code. Each juror read the plan and the cited code, tests and sibling plans. None ran the scan.

## Shared findings

- **Any HTML comment cannot be the annotation.** `/plot-approve` writes `<!-- pr: #N, branch: x -->` on every approved member line (`packages/domain/src/rules/sprint-annotation.ts:44-48`). Under "any comment", section 13 reads every approved item as kept open. All four jurors found this.
- **An unchecked box over a Delivered plan means `done` elsewhere.** `deliver.ts:248` ticks the box, `/plot-sprint close` step 2a ticks it, and `plot-sprint-release.sh:72-79` scores it `done`. Option 1 adds a state no other command keeps. Three of four jurors name it; the plan names none.
- **An unshipped `Release:` must not suppress the finding by itself.** It would silence the bookkeeping-lag population that section 13 exists for. Four of four.
- **Section 17 does not answer "did the release ship" through `plot-sprint-release.sh`.** The tag lookup is the scan's own loop (`plot-reconcile-scan.sh:2240`), and section 17 skips Closed sprints, which section 13 covers.
- **No consumer reads `stale_tally=`.** A new counter costs edits at `scan.test.mjs:298` and in the docs for no reader.
- **The Changelog and the slice name different deliverables.** The Changelog covers both options, the slice and its branch name build option 1.

## Disagreement

No juror disagrees on position. The jurors differ on weight: estate and contradiction recommend option 2 (drop the hint); deliverable and cost accept option 1 if it is a named `open:` field inside the existing comment. Both groups agree the plan is not approvable until Open Question 1 is answered.

## Shared blind spot

No juror ran the scan against a fixture, so none measured whether an `open:` field survives an approve re-run (`annotateSprintItem` inserts `pr:` into the first comment). Estate, contradiction and cost reasoned it from the code. The cost juror also found the shell-line ratchet (`check-shell-lines.sh`) has zero headroom, so option 1 must remove as many shell lines as it adds.
