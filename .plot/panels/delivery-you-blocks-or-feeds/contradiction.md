# Contradiction juror: delivery-you-blocks-or-feeds

Position: amend

## 1. False or unverified claims

- **Story link is dead.** `docs/plans/active/delivery-you-blocks-or-feeds.md:11,27` link `docs/stories/delivery-tab-reads-at-a-glance/STORY-…md`; the directory does not exist in this worktree (`ls` fails). Plan 1 flags the same (`delivery-tab-header-and-my-sprint.md:66`); this plan does not.
- **The PR rule needs a reading the board does not take.** Plan :19,:39 places a PR under Blocks delivery on "an unanswered comment from a person". The rule `rules/human-comment-open.ts` exists, but only `workflows/merge.ts` and `fleet/src/shared/auto-merge.ts` call it; fleetd keeps `conversationHolds` in memory "for the daemon's life" (`auto-merge.ts:57`), and nothing under `packages/board/src` reads a PR conversation. A per-PR conversation read on the board contradicts the design's Non-goal "No new reads from a host or tracker" (spec :221). The plan names no source for the reading and no gap.
- **"Review a result folds into Blocks delivery" carries the release row with it.** Today `review-a-result` holds `release-approval` and `test-delivered-plan` (`delivery-placement.ts:206-207`). The design says the release "has no row elsewhere on the tab, so the card is its one place" (spec :68, :172), and plan 1 removes only a release row "under Work items › At a gate" (`delivery-tab-header-and-my-sprint.md:46`). Neither plan removes `release-approval` from You; folded as written, it lands in Blocks delivery and the release shows twice (anti-goal spec :226).
- **"Unblock holds loose ends only"** (plan :38) moves `agent-died` and `fleet-stuck` out by name, but `blocked-marker` and `merge-conflict` (`delivery-placement.ts:209,215`) are not named. The design lists both under Blocks delivery (spec :92); the plan leaves them implicit.

## 2. Slices and Changelog

- Both slices ship board behaviour. They overlap: slice 1 owns "the placement rule's three You groups" and slice 2 owns "Unblock rows with Release and Delete" and "one row per plan" (plan :73, :77). The closed-PR Unblock case and the draft-plan slice suppression are placement decisions in `delivery-placement.ts`, yet slice 2 waits only on `feature/delivery-section-header`, not on `feature/delivery-you-groups`. Two parallel desks edit one rule file.
- Changelog :21 says the ticket count "links to the Tickets section"; Open Question :62 admits the target may not exist until plan 6. The Changelog states as shipped what the plan does not settle.
- "You ignores the Mine filter's three modes" (plan :45) appears in no slice. Today You applies `mineAllows(input.mine, …)` (`delivery-placement.ts:337`); removing it is a placement change with no owner.
- Board impact :23 says "Rebuild the board artifact with each slice". CLAUDE.md and `docs/definition-of-done.md:42-43` say a PR's diff carries no bundle (`check-no-bundle-diff.sh`). Plan 1 flags this as cosmetic (:76); the same defect stands here.

## 3. Most serious gap

**Closed PRs under Unblock contradict the `loose-delete` controller and a sibling plan.** Plan :20, :43 put "a closed PR whose branch still exists" under Unblock with Delete. `loose-delete` refuses `named` where a plan's slice names the branch (`rules/loose-delete.ts:103`), and CLAUDE.md defines a loose branch as "one that no plan names". `a-deferred-slice-keeps-its-branch.md:33` relies on that refusal to keep deferred slices' refs. A closed PR on a named slice branch would show a Delete that always refuses, and today's `looseOf` returns `not-loose` for it (`delivery-placement.ts:186`), so the builder must either add a new placement reason or contradict the controller. The design text (spec :94, :116) and plan 3 (`delivery-work-items-show-gates.md:42`) carry the same ambiguity: "a closed PR or branch no plan names".

## 4. Changes

1. Restrict the Unblock closed-PR case to a branch no plan names, as `LooseReading.named` and `loose-delete` already decide; state that a named slice's closed PR goes to Blocks delivery (or Work items) without Delete.
2. Name the source of the "unanswered person comment" fact: either persist fleetd's `conversationHolds` into an index the board reads, or drop the condition and record the gap, per spec :221.
3. State that `release-approval` leaves You (the status card owns it) and that `blocked-marker` and `merge-conflict` move to Blocks delivery.
4. Add `<!-- waits: feature/delivery-you-groups -->` to `feature/delivery-you-plan-rows`, or move every placement change into slice 1, and put "You ignores Mine" in slice 1's description.
5. Answer plan 1's open question (:71) from this side: this plan's slice 1 owns the marker per row, and plan 1 reads it.
6. Add an Unblock ("to clean up") count to the You header: spec :46 says a group's 0 count says it is empty, and the header at :37 has no Unblock count. The "tickets to triage" count links to no group in You's body (spec :44), and the phase strip's Discovery already counts tickets (`2026-11-08-delivery-tab-design.md:67`). Say which one carries tickets.
7. Fix the Board-impact line to "rebuild locally to test; commit no bundle", and fix or drop the dead story link.
