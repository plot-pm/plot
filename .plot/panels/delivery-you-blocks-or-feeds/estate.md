# Estate juror: delivery-you-blocks-or-feeds

Position: amend

Lens: does what the plan says to build already exist, or exist under another name. Several parts exist, and the plan names only `delivery-placement.ts` and `LooseDeleteButton.tsx`. Its Notes line ("found no artifact of that name in the estate") searched for the new group names, not for the mechanisms.

## 1. False or unverified claims

- **Release and Delete on a loose branch already ship.** `packages/board/src/app/components/AgentList.tsx:1165-1172` renders `ReleaseClaimButton` and `LooseDeleteButton` for a You row with reason `loose` and no PR. Changelog bullet 4 describes this as new. Only the closed-PR half is new: today a loose PR shows neither button (CLAUDE.md, loose-delete paragraph), and `looseOf` (`delivery-placement.ts:182-190`) does not separate an open PR from a closed one.
- **The "unanswered comment from a person" rule exists**, as `humanCommentOpen` in `packages/domain/src/rules/human-comment-open.ts`. Its only caller is `workflows/merge.ts:22,337`. `PrReading` (`delivery-placement.ts:38-41`) has no conversation field, and `delivery-readings.ts` does not read one. The plan does not name this rule or the reading that condition 1 needs.
- **Conditions 2 and 3 of the PR rule exist under other reasons.** `fleet-stuck` (`delivery-placement.ts:212-214`) places `ci failed OR review high` with corrections >= budget. `review-pr` (`:216-217`) places `!autoReview` only when `ci === 'passed'` and review is pending or none. The plan states condition 3 unconditionally ("when the repository does not declare `Auto-review: true`"). Read literally, it moves a PR whose CI is still running under Blocks delivery. The plan does not say whether the current CI guard stays.
- **One row per plan has a mechanism already.** `nestItems` and `PlanBlockView` (`packages/board/src/app/lib/agent-rows/delivery-view.ts:113-132, 240-262`) nest a plan's slices under one plan head. `item.draft !== null` at `:248` deliberately keeps Draft items out of the nesting, and that exception causes the measured repetition under every draft slice. `planSliceCount` (`packages/board/src/contract/schema.ts:2294-2310`) already carries the declared slice count. The `plan-input` row shape exists in `delivery-row-form.ts:161-163`. Slice 2's marker "a one-row plan form for You" names something that partly exists.
- **Group headers are keyed on the old group names.** `holdersOf` (`delivery-row-form.ts:381-395`) ties `autoReview` and `autoVerify` to `review-a-result`, and `autoDesign` to `input-to-the-fleet`. Folding Review a result into Blocks delivery means `holdersOf` must change too. The plan does not mention it.
- **The Do cell for a loose row currently reads `plan ›`** (`REASON_DO.loose`, `delivery-row-form.ts:134`). The plan's "Release · Delete" replaces it, and Plan it moves to the Tickets plan (plan 6). The plan does not state this replacement.
- **Columns:** `ROW_COLUMNS` (`delivery-row-form.ts:13`) is one list shared by every section, and it holds `where` and `by`. Dropping them only for You needs a per-section column set. The Work items plan keeps `By` and `Where` (`delivery-work-items-show-gates.md:38`).
- **Mine:** today You respects Mine (`mineAllows` at `delivery-placement.ts:337`). With mode `off`, `theirs` items pass, so "ignores Mine" and "always the reader" give different answers. The plan has to pick `ownership === 'mine'` and has to say so.
- **Unverified as new, and genuinely absent:** the phase strip ("Handed to fleet" has zero hits in `packages/`), and an open-question count. The `questions` key in `snapshot-stale.ts:63` holds desk `PLOT-BLOCKED` questions, not a plan's `### Open Questions`. No parser reads a plan's `- [ ]` items.

## 2. Slices and Changelog

Both slices name a deliverable. The Changelog overstates bullet 4, because loose-branch Release and Delete exist. It leaves out three changes the slices must make: the phase strip, the move of approvals into Blocks delivery, and the removal of `plan ›` from loose rows. Spec line 92 puts plan and spike approvals, `PLOT-BLOCKED` and an unowned conflict under Blocks delivery. Today `plan-approval` and `spike-approval` sit under Input (`delivery-placement.ts:204-205`), and `blocked-marker` and `merge-conflict` sit under Unblock (`:209,215`). The plan gives no mapping from reason to group for the 12 `YouReason` values (`:125-137`).

## 3. Most serious gap

Condition 1 of the PR rule needs a per-PR conversation reading. The delivery readings do not carry one, and the PR index does not either (`rules/pr-index.ts` has no comment field). `humanCommentOpen` is reached only after a fresh host call in `merge.ts`. A builder hits this at once. The builder must choose between a new host read per open PR per refresh, which works against *A Decision Reads The Index*, and a new indexed field with its own writer. The plan names neither option.

## 4. Changes

- Name the existing mechanisms the slices extend: `humanCommentOpen`, `fleet-stuck`, `review-pr`, `holdersOf`, `REASON_DO`, `ROW_COLUMNS`, `nestItems` with its draft exception, `planSliceCount`, and the buttons at `AgentList.tsx:1165-1172`.
- Add a table to Design that maps each of the 12 `YouReason` values to its new group and marker.
- Add an open question on the conversation reading's source: a host read, or a PR-index field.
- Rewrite Changelog bullet 4 to cover only the new part, closed PRs with a live branch. Add the phase strip and the approval move.
- Settle "You ignores Mine" as `ownership === 'mine'` in every mode.
- Name the source of the open-question count: a new plan-parser fact, for example on the plan payload next to `planSliceCount`.
- Settle the order between the to-do markers and plan 1. Plan 1 records this as its own open question (`delivery-tab-header-and-my-sprint.md:71`), and this plan does not answer it.
