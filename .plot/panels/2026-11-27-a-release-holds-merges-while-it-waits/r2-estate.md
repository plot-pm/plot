# Round 2 — estate juror

Subject: `docs/plans/2026-11-27-a-release-holds-merges-while-it-waits.md` on `origin/main` (Approved, `Rounds: 1`, amended by #3751). Read against `origin/main` after #3754, and against PR #3746 at `36d32b8bb` (draft, 4 commits).

Position: amend

## 1. Round 1's changes for the author

- Item 1 (start at green CI, replay 20:30:57–20:34:34Z): applied in the text (Approach bullet 2, slice 1 tests), but voided by item 2 for the measured case; see finding 2.
- Item 2 (readiness from `releaseStage`, record rule in the domain): applied. `advanceReleaseHold` is named as the one rule that advances the record. The `releaseStage` half is the defect this round finds.
- Item 3 (cap across heads, person hold, one writer): applied. `spentMs` per release PR, a person hold and lift in slice 2, and two files with one writer each.
- Item 4 (direct pushes and the review that did not start): applied. The Motivation counts 5 merge-driven and 9 direct-push heads and routes the review gap to `a-stale-pending-review-is-asked-again`.
- Item 5 (`plot-ask.mjs merge`): applied. Slice 2 adds `mergeAt`'s `release-waiting` refusal.
- Item 6 (board display in slice 1, passkey limit, issue): partly applied. *Waiting on you*, the release row and the Status word are in slice 1, and issue #3750 is open. No slice names the `localhost` limit at the approve button.

## 2. The measured case and `[question-stage-on-2026-11-26]`

- `releaseStage` answers `waiting-scope` at `release-prepare.ts:229` whenever a scope slug is not `delivered`. It reads no checks and no review before that line. With five undelivered Musts on 2026-11-26, every pass read `waiting-scope` on `e150fd7c1` and on `8e1373e0f`.
- The plan's Approach bullet 1 holds nothing for `waiting-scope`. So the amended design holds no merge on 2026-11-26, and the replay test it names cannot pass. The answer to `[question-stage-on-2026-11-26]` is yes, the readings are `waiting-scope`, and the plan's own condition for a second round applies.
- #3754 changed `releasePrepareNext` only (`release-prepare.ts:317-327`): in `waiting-scope` it now returns a `review` step for a green head. `releaseStage` is unchanged, so the hold rule gets nothing from #3754.
- Approval does not read the scope. `releaseApprovable` (`release-approvable.ts:65`) enables the button on an open PR, `ciChecks` counted on `checksSha === headSha`, a trusted `success` review on the head, and a registered passkey. `workflows/release-approve.ts` refuses on head, review and release-head provenance, never on scope. #3719 was approved in `waiting-scope` and merged at 07:52Z on 2026-11-27.
- The readiness the hold must read is therefore `releaseApprovable`'s head criteria, not `releaseStage`: an OPEN `changeset-release/` row into the default branch, a `headSha`, `ciChecks` counted on `checksSha === headSha`, and a trusted `plot/review` on the head that is absent, `pending` or `success`. Only `merged`, a closed PR, a `failed` review on the head and (where read) `release-head-foreign` stop it. The scope does not.

## 3. New failures

- No stranded main: the hold sits after `default-branch-red`, `-stale`, `-unsettled` and `merge-in-flight` (`slice-pr-next.ts:503-530`), and #3746 skips it where `repairAdmitted` is true. A red main still admits its repair and revert PR.
- No overnight starvation: `spentMs` caps the automatic hold at one `Checks wait` per release PR. With the scope removed from readiness, the hold fires on every green release head during the sprint, so the budget is usually spent in daytime. That costs value, not safety; the plan must state it.
- The readings do not reach the merge arm. `releaseTick` builds its readings locally (`release-tick.ts:129-144`) in `registryd-main.ts:4066`, and records no readiness. The merge pass runs separately (`auto-writes.ts:127`). "Reads the release readings that fleetd's release tick already passes to `releaseStage`" describes wiring that does not exist. #3746 reads the index row instead, which is the right source, but the plan must say so.
- That index read is a non-terminal answer that decides a hold. "A Decision Reads The Index" requires a paragraph per such consumer. #3746 adds one to `CLAUDE.md`; the plan must name it as a slice 1 deliverable with its bound (reversible, capped by `spentMs`, absent row holds nothing).
- Index lag: CI on `e150fd7c1` went green 2 min 40 s before #3738 merged. The hold fires only if the row's `ciChecks` reads green in that window. The replay must use the row as the index held it, not the host's run list.
- Second writer: none in slice 1. In slice 2 the board and `plot-ask.mjs` both write `release-hold-person.json`; each act must be one whole-file write that names its head, so a lost race loses one press and no lift of the other head.

## 4. Done-when and PR #3746

The slice 1 tests are checkable, except the replay, which fails by construction under bullet 1. PR #3746 must change as follows:

- `releaseHold` requires a review `pending` or `success` on the head (`rules/release-hold.ts`, `review-not-on-head`). Accept an absent review, else the 20:30:57–20:34:34Z window holds nothing.
- The bound is per head (`now - since >= boundMs`). Replace it with `spentMs` summed per release PR, and add `pr` to the record.
- `releaseHoldReading` in `auto-merge.ts` decides the write. Move that decision into `advanceReleaseHold` with its six cases.
- The record carries `liftedBy`. Remove it; the lift belongs to `release-hold-person.json` in slice 2.
- Add the replay test, the stage-independence test (a `waiting-scope` release with a green head holds), and the board texts, which the diff does not touch.
- Update its `CLAUDE.md` paragraph to the per-PR budget and the absent review.

## 5. Readiness

Not ready. Slice 1 cannot meet its own replay test while Approach bullet 1 reads `releaseStage`. One amendment fixes it, and slice 2 waits for it as the plan already says.

## Required changes

1. Replace Approach bullet 1: readiness reads the index row with `releaseApprovable`'s CI criterion and a review absent, `pending` or `success` on the head; the scope stage does not stop the hold. Close `[question-stage-on-2026-11-26]` with the reading `waiting-scope` at `release-prepare.ts:229`.
2. Name the index row as the reading source, and add the "A Decision Reads The Index" paragraph for this non-terminal hold to slice 1's deliverables.
3. Add a slice 1 test: a `waiting-scope` release with a green, unreviewed head holds a PR into main; make the replay read the index row as it stood at 20:33:37Z.
4. State that the per-PR budget is often spent in daytime during a sprint, and that the person hold covers the approval window.
5. Bring PR #3746 to the plan: absent review accepted, `spentMs` per PR, `advanceReleaseHold` in the domain, no `liftedBy`, board texts and the replay test.
6. Name the passkey `localhost` limit (#3750) at the approve button in a slice, or drop that item explicitly.
