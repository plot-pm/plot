# Estate juror: delivery-release-progress-per-plan

Position: amend

What I ran: `grep -rIl -i` for slice strip / person card / progress per person / releaseDelivery across packages, docs/plans, docs/superpowers; grep of `Release delivery|progress|sliceProgress` in packages/board/src and packages/domain/src; read the five sibling delivery plans' progress lines; read the design's Release Delivery section (lines 72-84). I did not read the story, the 2026-11-08 spec, or red-hold-reads-the-pr-base.md, and I did not run any tests.

The Notes claim holds for the exact names "slice strip" and "per-person progress": no artifact carries them (only the design spec and this plan). It is false in substance for the section itself, and two sibling plans already own overlapping parts.

## Findings

1. (misleads) A Release delivery section already exists and the plan describes it as if new. `packages/board/src/app/lib/agent-rows/delivery-view.ts:24,186-192,423-439` builds `releaseLines`, `delivered` and `deliveredBlocks` (the flat list of merged slices the Motivation measures as "about 40 rows"). `AgentList.tsx:1378-1400` renders it with a fold, and `agent-rows/collapse.ts:11` already starts the `release-delivery` key collapsed. `AgentList.tsx:415` (`expandSection`) opens that fold when a blocker mark points at a delivered slice. The plan never says the slice "Plan rows" replaces `deliveredBlocks`, `releaseLines` or `expandSection`, and the Board impact line says only "changes the Release delivery section". The builder must learn from the code that the collapse key and the blocker-mark expand behaviour exist, and that a per-plan fold changes what `expandSection` must open.

2. (misleads) Two plans build the same five-state slice classification. `delivery-tab-header-and-my-sprint.md:43` builds the release card's "progress bar in five segments (delivered, at a gate, being built, blocked, not started) whose segments add up to the total". This plan builds the same five states for the strip (lines 38, 49). `delivery-tab-header-and-my-sprint.md:71` records an unresolved open question: which plan owns the shared slice-state classification. This plan neither claims it nor consumes plan 1's rule, and its slices wait only on `feature/delivery-section-header`. Result: two classifiers that can disagree on "blocked" or "at a gate". Fix: state that this plan reads plan 1's classification, or that it owns it and plan 1 reads it, and add the matching `waits:`.

3. (misleads) The Person cards slice overlaps plan 1's sprint card. `delivery-tab-header-and-my-sprint.md:43-44` already shows the people count for the release and a progress bar per sprint (one bar per Active sprint when the reader owns several). The per-person card is the same figure (owner, sprint, slice progress) per team member. The plan does not name the shared progress-per-sprint reading, so it will be derived twice. Fix: name plan 1's per-sprint progress as the input of the person card.

4. (misleads) The existing count rule is not mentioned. `packages/domain/src/rules/deliverable.ts:145-165,302-312` already defines `sliceProgress` as "<merged> of <total> slices merged", and it excludes slices holding only deferred branches. The strip's "1 / 5 delivered" and the header's "<delivered> of <total>" must use the same denominator, or the board and the tracker comment (`plan-issue-comment.ts:46`) will disagree. The plan's Done When asserts the five states sum to the plan's slice count, but not what a deferred slice counts as (the `a-deferred-slice-keeps-its-branch` plan covers deferral for reconcile, not this view). Fix: say whether deferred slices are in the strip, and reuse `slicesOf`.

5. (misleads) Dependencies are under-declared. "Blocked" means under You › Blocks delivery (line 38), which `delivery-you-blocks-or-feeds.md` builds (`feature/delivery-you-groups`, line 74). "In flight" links to rows in Work items or You, and "at CI" is a gate reading from `delivery-work-items-gates`. Every slice here waits only on the section header, so the strip's blocked and at-a-gate segments and the in-flight links can land before the rows they point to exist. The Settled Questions line calls this "Writer's call", and it is the weakest one. The design's own line 79 lists four strip states, while the plan uses five citing "Calls Made After Review"; the plan's version is the later call, so only the cross-reference needs noting.

6. (cosmetic) Open Question about the Done date for a slice completed by a named commit is real and unanswered. Domain already has this case (`Refs.contains`, CLAUDE.md "A commit NAMED BY HASH"), so the answer is likely "commit date" or "no date"; give a default so the slice is not blocked on it.

## Could not check
- Whether `delivery-view.ts` tests pin the current `deliveredBlocks` shape (would be broken by slice 1).
- The 2026-11-08 spec and the story text.

## Verdict
Buildable after amendment: add a Board impact sentence naming the existing `deliveredBlocks`/`releaseLines`/`expandSection` code the slice replaces, settle ownership of the five-state classification and per-sprint progress with plan 1, state the deferred-slice rule against `sliceProgress`, and add `waits:` on the You and Work items slices (or say the segments are stubbed until they land). Not reject: the target (one collapsed row per plan) is not built anywhere.
