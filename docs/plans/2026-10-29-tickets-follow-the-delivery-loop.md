# Tickets follow the delivery loop

> The plan issue updates with no hand edit: its Plot comment shows how many slices merged, names each HIGH ticket and each unblocker answer, and keeps them through every later phase write. Approval moves a Jira issue to its approved status.

## Status

- **State:** Draft
- **Type:** feature
- **Sprint:** delivery-loop
- **Issue:** #2905
- **Story:** the-fleet-delivers-a-scope-alone
- **Review:** pr
- **Impl:** own branches
- **Rounds:** 1

## Changelog

- After any slice merge, by the fleet or by a person, the plan issue's Plot comment shows a slice-progress line, for example "2 of 3 slices merged", while the plan is Approved.
- The plan issue's Plot comment names each HIGH ticket the fleet opened and each answer the unblocker gave, and the Delivered and Released writes keep those lines.
- A plan issue keeps one Plot comment, also when two writers reach a new issue at the same time.
- `/plot-approve` moves a Jira issue to the `Tracker approved status` word, so Jira moves at Approved, Delivered and Released.

<!-- Board impact: none for the plan format, template or docs/plans layout. No board view reads the plan-state comment. The renderer moves from packages/domain/src/adapters/tracker/ into packages/domain/src/rules/, and the board's plot-plan-state.mjs and approve entry change; rebuild the board artifact (pnpm build:board) only to test locally. -->

## Motivation

Issue #2905 is the "Tickets" part of [DESIGN-delivery-loop.md](../stories/the-fleet-delivers-a-scope-alone/DESIGN-delivery-loop.md), approved by jwloka on 2026-10-29. Goal 3 of that spec: ticket statuses follow the work without a hand edit.

**The comment holds one line.** The plan's issue changes at four points: Draft, Approved, Delivered and Released. `planStateComment` (`packages/domain/src/adapters/tracker/tracker-plan-state.ts:44-47`) renders the marker `<!-- plot:plan-link -->` (`:35`) and one line, `Plan <phase>: <link>`. `githubPlanStateWrite` (`:65`) sets the `plan:*` label and then edits the marked comment in place (`:74-78`, `skills/plot/scripts/plot-host.sh:5745`). Between Approved and Delivered the issue shows nothing, so a person reads the board or the PR list to learn that 2 of 3 slices merged. The HIGH ticket and every `PLOT-BLOCKED` answer are visible only where they were written.

**Every write replaces the whole comment.** Five callers pass only the phase and the link: `/plot-idea` (`skills/plot-idea/SKILL.md:431`), `approve.ts:1174`, `deliver.ts:546` (Delivered), `deliver.ts:955` (Released) and `/plot-release` (`skills/plot-release/SKILL.md:467`). The panel measured the Delivered body as exactly two lines, the marker and `Plan delivered: <link>`. So any line a sibling adds, the next phase write erases. Four plans want lines in this one comment: this plan (progress), #2903 (HIGH tickets), #2901 (answers) and #2904 (a revert ticket). Each write erases the others unless one renderer reads every record.

**Jira gets two of three points today, and no comment.** `issueStatusWrites` (`packages/domain/src/rules/issue-status.ts:46-57`) owes a write at `approved`, `delivered` and `released`. But `plot-issue-status.sh` has two callers only, `deliver.ts:531` (deliver) and `deliver.ts:944` (release). `approve.ts:1174` runs `plot-plan-state.sh` and nothing else, so the `Tracker approved status` key (`skills/plot/scripts/plot-config.sh:183`) is never written. The Jira connector answers `unaskable` to `issueComment` (`tracker-jira.ts:293`) and `no-target` to every `planStateWrite` (`:297-300`). On a Jira tracker, the progress line, the tickets and the answers reach no Jira issue.

**Two writers can post two comments.** `issue-comment` lists the comments, then edits the marked one or posts a new one (`plot-host.sh:5755-5757`). The panel ran two concurrent writers against a fake `gh` on an issue with no marked comment; both posted. Later writes edit only the first match (`plot-host.sh:691`), so the second comment stays stale.

**A progress write as an Approved write moves a delivered issue back.** The panel ran `issue-label` on an issue that carries `plan:delivered`: it issued `--add-label plan:approved --remove-label plan:delivered`. Auto-deliver runs detached, so a late progress write for the last slice can land after Delivered.

This plan depends on #2903 (the HIGH ticket record), #2901 (the answer record) and #2904 (the revert ticket). It does not depend on #2902: a person's merge and a fleet merge both produce the index's `pr merged` finding.

## Design

### Approach

**One renderer owns the comment.** `planStateComment` and `PLAN_STATE_MARKER` move from `adapters/tracker/tracker-plan-state.ts` into one domain rule, `packages/domain/src/rules/plan-issue-comment.ts`. It takes readings as values: phase, link, version, slice progress, HIGH tickets and answers. The adapter keeps the host steps and renders nothing. #2903, #2901 and #2904 write records only and call no comment write. With no progress, tickets or answers, the body is byte-identical to today's, so existing comments do not churn.

**Every phase write renders the records.** `run` in `packages/board/src/server/entry/plan-state.ts:162` reads the progress, ticket and answer records itself, as it reads the plan through `planMeta` today (`:173`). The approve, deliver, release and idea callers therefore keep their arguments and still produce the whole body.

**The port widens, and says so.** `PlanStateWrite` (`packages/domain/src/ports/tracker.ts:95`) gains the progress, tickets and answers. The port's "four facts" text (`ports/tracker.ts:219-227`) changes with it: each new item is a fact Plot produced. Its "no rule reads the plan comment back" sentence gains one exception for D6 below.

**The records live on the fleet's machine (D6).** The ticket record and the answer record live in `.plot/state/` under the common git dir of the fleet's machine. A plan-state write on a machine without those records keeps the comment's existing record lines and changes only the phase line, so no write erases them. That needs one read of the marked comment's body, which the port names as its single read-back.

**The progress count is a domain rule.** `sliceProgress` sits beside `allSlicesMerged` in `packages/domain/src/rules/deliverable.ts:62` and uses the same reading as `landed` (`:124`): the pulse, not a per-branch `plot-pr-merged.sh` call. M counts the plan's non-deferred slices; a slice holds one branch. A slice counts as merged when the pulse reads it `complete`, merge-subject evidence included, because the line is a reversible reflection. A partial pulse gives no line. A unit test pins `merged === total` exactly when `allSlicesMerged` answers `merged` on the same fixture.

**The index's `pr merged` finding triggers the write.** `rules/index-findings.ts:105` emits `pr merged` for every merge, so a person's merge and a fleet merge both write. The progress write is comment-only: it sets no label, and it writes nothing unless the plan reads `approved` on the default branch at write time.

**Every write is level-triggered.** The writer computes the owed body and compares its hash with the last body it wrote for that issue, recorded in `.plot/state/`. It writes only on a difference. A repeated tick writes nothing, and a crash between a merge and its write only delays the line. One writer per issue on a machine holds a per-issue lock around lookup and post, so two writers cannot post two comments.

**The size cut is the renderer's.** The body keeps every HIGH ticket and the newest 20 answers, followed by a line that counts the answers left out. The body stays under GitHub's 65,536-character limit, and a unit test with 200 answers proves it.

**Jira moves at Approved.** `approve.ts` calls `plot-issue-status.sh` after its plan-state write at `:1174`, reports the outcome on its summary, and lets a failed write leave the approval standing. Before that, the three status-word reads at `plot-issue-status.sh:44-46` move into the `plot-issue-status.mjs` bundle through the `Scripts` port's `config`, so the shell line count goes down. Jira gets no per-merge transition: the design names three points, and a late transition can move a ticket backwards.

**No unattended lift.** `plot-plan-state.sh`, `plot-plan-state.mjs` and `plot-issue-status.sh` read no `PLOT_UNATTENDED`, and a tracker write is not a lifecycle action. The progress write needs no caller identity from #2898.

All new domain rules carry full coverage: `packages/domain` fails below 100 %.

### Decisions

Decided 2026-10-29 by Jan Wloka after panel round 1 (`.plot/panels/2026-10-29-tickets-follow-the-delivery-loop/panel.md`):

- [x] D1: fleetd writes the progress comment with no unattended lift, because the plan-state and issue-status writes refuse no caller. The `released` write runs only in the person's release finish, never from fleetd.
- [x] D2: every HIGH goes to a fixer, two attempts per PR, then a ticket. #2903 writes that ticket record; this plan renders it as a line in the comment and opens no ticket itself.
- [x] D6: the ticket record and the answer record live in `.plot/state/` under the common git dir on the fleet's machine. A plan-state write from a machine without the records keeps the comment's existing record lines and changes only the phase line.
- [x] D7: the person's release approval writes Released for every scope plan in one push; its plan-state write uses this plan's renderer, so the Released comment keeps the progress, ticket and answer lines.
- [x] One renderer: this plan owns `rules/plan-issue-comment.ts` and the size cut; #2903, #2901 and #2904 write records only.
- [x] The count: `sliceProgress` over the pulse beside `allSlicesMerged`, non-deferred slices, subject evidence counted, no line on a partial pulse.
- [x] The trigger: the index's `pr merged` finding; the progress write is comment-only and only while the plan reads `approved`.
- [x] Jira: wire the missing approve caller of `plot-issue-status.sh`; no per-merge transition. The status-word reads move into the bundle first.
- [x] The sprint item: this plan adds nothing. The sprint tick at delivery exists, and the sprint close after the release belongs to #2907.

### Open Questions

- [ ] **Does anyone read the comment as status?** The board already shows a plan's slices and PRs. If no person reads the comment, the answers list is a log, and the size cut decides what a reader loses. Decide whether 20 answers is the right cut, or whether the comment carries tickets only.
- [ ] **The revert ticket record.** The design gives a Delivered plan's revert a HIGH-style ticket (#2904), but the slice map gives #2904 no record slice. The renderer reads a revert ticket only once #2904 names its record.
- [ ] **A plan with no `Issue:`.** `planStateWrites` returns nothing, so its tickets and answers have no comment. Name where they appear, or state that they appear nowhere.

## Slices

### Comment renderer

- `feature/the-plan-comment-renders-records` — one domain renderer in `rules/plan-issue-comment.ts` (progress, HIGH tickets, answers, size cut) that every phase write uses through `plot-plan-state.mjs`; D6 keeps the existing record lines on a machine without records; a level-triggered write with a body hash and a per-issue lock <!-- builds: rules/plan-issue-comment.ts, the widened PlanStateWrite, the record reads in plan-state.ts -->

### Merged slice count

- `feature/merged-slices-update-the-comment` — the `sliceProgress` rule beside `allSlicesMerged`, triggered by the index's `pr merged` finding; a comment-only write while the plan reads `approved` <!-- builds: sliceProgress in rules/deliverable.ts, the pr-merged write point -->

### Jira at approve

- `feature/jira-moves-at-approve` — `approve.ts` calls `plot-issue-status.sh` after its plan-state write; the status-word reads move from the shell into the bundle <!-- builds: the approve caller of plot-issue-status.sh -->

## Notes

- 2026-10-29: created from issue #2905 by `/plot-idea`, unattended. Stops at Draft; nothing was written to the tracker.
- 2026-10-29: amended after panel round 1 (unanimous amend: layering, safety, testability, seams).
- The HIGH ticket record belongs to #2903 (`feature/an-unfixed-high-is-ticketed`); this plan renders it and builds no record.
- The answer record belongs to #2901 (`feature/the-answer-record`); this plan renders it and builds no record. #2901's `unblocker.md` belongs to #2898.
- The revert ticket belongs to #2904; see Open Questions.
