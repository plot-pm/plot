# Panel: reconcile-section-13-suggests-an-annotation (round 2)

Reconciliation: unanimous `amend` (estate, contradiction, deliverable, cost). Siblings read: the active sprint `delivery-ui-polish` and the estate code. Every juror read the plan, round 1's Open Points and the cited code at HEAD. None ran the scan to completion: deliverable and cost started `test/reconcile/scan.test.mjs` and stopped at a 120 s limit with no result. Cost ran `scripts/check-shell-lines.sh pr` (15449 lines now and at the merge base).

## Round 1 findings, checked

All round 1 findings were confirmed against HEAD: the hint at `plot-reconcile-scan.sh:1866`, the `<!-- pr: #N, branch: x -->` collision, the false "board reads neither" (`workflows/reconcile.ts:130,328`, `entry/reconcile.ts:170`), the zero shell-line headroom, the literal footer assertion at `scan.test.mjs:298`, section 17 skipping Closed sprints, and the `#3489` mismatch. No juror refuted one.

## New findings

- **The "any comment" collision is wider.** `/plot-sprint close` step 2a writes `<!-- reconciled: <phase> -->` on every ticked item (`skills/plot-sprint/SKILL.md:553-554`). An author who unticks a reconciled item would get a silent kept-open. (contradiction)
- **Section 13 has two header comments with disagreeing numbers.** `:113` and the echo at `:1835` say "13. Stale sprint tally"; the section body comment at `:1809` is headed "11."; `:1986` is a different "13. Stale interrogation rounds". The slice must name `:113` and `:1809` and leave `:1986` alone. (contradiction, deliverable)
- **The plan's reproduction contradicts the estate.** An item that stays open "until the release is cut" is `done` to `scoreItem` and is ticked by `deliver.ts:248` and step 2a. Section 17 already says a tag proves no completion. (contradiction)
- **`annotateSprintItem`'s `branchPattern` stops only at a comma.** An `open:` field placed after `branch:` without a comma is swallowed or rewritten by a later approve. Order and delimiter must be fixed. (deliverable)
- **The test list is incomplete.** Missing: a kept-open item on a Closed sprint, an approved item holding only `pr:`/`branch:` (must stay a finding), an annotated item whose release shipped (must stay a finding), a plan in two waves (one line), an empty reason, a reason containing `-->`, and an approve re-run over an annotated line. (deliverable)
- **No changeset is named**, though the slice changes a shipped script. (deliverable)
- **Option 2 is the only zero-cost shape:** one string edit at `:1866`, no added lines, no corpus pair, no domain change. Option 1 pays in shell lines, a corpus pair for `staleTally`, a writer-preservation test and a second pass for the unshipped-release read. (cost, estate, contradiction)
- **The shared section 13 fixture is slow.** A filtered run exceeded 2 minutes, so new cases should say whether they join it or get a file. (deliverable, cost)

## Disagreement

No juror disagrees on position. On weight, estate, contradiction and cost recommend option 2; deliverable accepts option 1 with a fixed `open: <reason>` field and a named shell-line offset. Neither group would approve while Open Question 1 stands.

## Shared blind spot

No juror measured a scan run, so the two section 13 tests, the `open:` survival across an approve re-run and the cost of the unshipped-release read remain reasoning. All four also took step 2a's behaviour from round 1 or one reading of `SKILL.md`, not from a run of `/plot-sprint close`.
