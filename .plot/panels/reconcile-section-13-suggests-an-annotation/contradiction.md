# Juror: contradiction

Reading position: does the plan disagree with a sibling plan, with the code it cites, or with a decision this repo already made?

## 1. Contradictions

- **The recommended option disagrees with three existing writers and readers of the same checkbox.** The plan treats an unchecked item over a Delivered plan as "open on purpose". The repo decided the opposite:
  - `packages/domain/src/workflows/deliver.ts:243-251` ticks the item at delivery (`tick: true`, comment: "Delivery ticks the box").
  - `skills/plot-sprint/SKILL.md:543-563` (close step 2a) ticks every unchecked item whose plan is delivered or released, and under `PLOT_UNATTENDED=1` "the answer is always yes" (`:585-590`). A `kept open` annotation does not stop this, so close erases the state option 1 creates.
  - `skills/plot/scripts/plot-sprint-release.sh:72-79` scores unchecked + delivered as `done` ("bookkeeping lag, not a claim in dispute"), so `/plot-release` already counts the item as finished. An item kept open for the release is open to section 13 only.
  The plan names none of these. Option 1 adds a fourth reader with a meaning no other reader shares.
- **"Any HTML comment" silences the section on this estate.** `/plot-approve` writes `<!-- pr: #N, branch: x -->` on every member line (`packages/domain/src/rules/sprint-annotation.ts:44-48`, `approve.ts:446`). All 7 member lines of the active sprint `docs/sprints/2026-W47-delivery-ui-polish.md` carry one, and 24 sprint files carry a comment on a member line. With "any HTML comment", every approved item is exempt and `stale_tally=` reads 0 by construction.
- **A fixed `<!-- open: … -->` is rewritten by the annotation writer.** `annotateSprintItem` keeps one comment per line and inserts into the first `<!--` (`sprint-annotation.ts:51-67`). An `open:` comment written before approval becomes `<!-- pr: #N, open: <reason>, branch: x -->`. So section 13 must parse `open:` as one key in a comma list, and a reason that contains a comma has no defined end. The estate already has the key-in-comment form: `<!-- reconciled: <phase> -->` (close step 2a, 22 lines) and `review_sha:` (`plot-review-status.sh:21`). The plan does not mention either.
- **`plot-sprint-release.sh` does not answer whether the release shipped.** It reports the `Release:` field and item states (`plot-sprint-release.sh:1-9`). The tag lookup is in the scan itself (`plot-reconcile-scan.sh`, section 17 loop, `git rev-parse refs/tags/v$sver`). Section 17 also skips Closed sprints and reports a sprint, not an item. So the constraint "section 17 reports that case" (Approach, last bullet) is false for a Closed sprint, which is the population section 13 exists for (`plot-reconcile-scan.sh:1811-1815`).
- Minor: the section's header comment numbers it 11 (`:1809`) and section 17's comment numbers it 15 (`:2159`), while the echo lines say 13 and 17. The slice "updates the section's header comment" and should fix the number too.

## 2. Open Questions the evidence settles

- **Option 1 or 2:** option 2. Delivery ticks the box, close ticks it, and the release scorer reads it as done. A kept-open item is a state that no other command keeps. If the consumer needs the release commitment, the existing record is the sprint's `Release:` field, which `/plot-release` already gates on.
- **Syntax:** "any HTML comment" is refuted by the `pr:`/`branch:` comment on every approved item. If option 1 survives, it must be a key in the existing comment (`open: <reason>`), and the reason must end at the comment close, not at a comma.
- **Unshipped release suppresses by itself:** no. It contradicts `plot-sprint-release.sh`'s `done` scoring and close step 2a.
- **Own footer counter:** with option 2, no. Note that `test/reconcile/scan.test.mjs:298` pins the full footer string, so a new counter costs an edit there and in every consumer that pins the footer.

## 3. Slice and Changelog

The slice branch `feature/reconcile-13-reads-open-annotation` and its `builds:` comment name option 1 only. The Changelog line names both options ("…, or its fix hint stops naming an annotation"). A Changelog line must state what ships. After the choice, both must name one outcome. For option 2, the slice is a one-line hint change plus a test that asserts the hint text. The branch name must change too.

## 4. Cost and honesty

Option 2 costs one line in `plot-reconcile-scan.sh:1866` and one assertion near `test/reconcile/scan.test.mjs:1712-1866`. Option 1 costs a comment parser in bash, a tag lookup per sprint that repeats section 17's logic, and a new state that close step 2a overwrites. The plan calls option 1 cheap ("costs the author one comment") and does not count the conflict with deliver, close and the release scorer.

Position: amend
