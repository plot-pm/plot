# Juror verdict: plan-lifecycle owner (are plan-text slices legitimate, or should the parent be amended directly?)

Position: reject

Evidence: Read the subject plan, issue #2813, the parent plan `docs/plans/2026-10-28-empty-jira-inbox-read-as-a.md`, PR #2814's diff (`gh pr view/diff 2814`), `skills/plot/MANIFESTO.md:120,151`, `skills/plot-implement/SKILL.md:97-101`, `skills/plot-reslice/SKILL.md`, `skills/plot-release/SKILL.md:284`, `packages/domain/src/rules/phase-gate.ts:181-197`, `rules/eligible.ts:112-163`, `workflows/deliver.ts:84-114`, `skills/plot/scripts/plot-state-gate.sh:2-3`, `adapters/tracker/tracker-jira.ts:173-183`, `adapters/tracker/tracker-listers.ts:20`, `packages/fleet/src/shared/issue-refresh.ts:241-262`, and the git history of approved-plan amendments on `origin/main`. Ran: `plot-plan-meta.sh` on the subject plan; `sliceVerdicts` (bundled from `rules/eligible.ts` with esbuild, run under Node 24) over the parent's and the subject's slice shapes; `gh api repos/plot-pm/plot/commits/<sha>/pulls` for two precedent commits; `gh issue view 1986`.

## (a) Problem statement

Findings 1, 2, 3, 5, 6 and 7 hold as stated. Finding 4 is half right.

- **Finding 1 is now live in code, not only in plan text.** PR #2814 (draft, open, head `bug/an-absent-inbox-guesses-no-spelling`) adds `if (inbox === undefined) return render([], 'The inbox was not read — …')` at the top of the tracker-account arm of `waitingTickets`. Every Jira tracker uses that arm (`tracker-listers.ts:20`, `match: 'tracker-account'`). With no `Ticket prefixes`, `issueListInbox` answers `unaskable` (`tracker-jira.ts:179-181`), and fleetd turns `unaskable` into `inboxSkipped()`, which is `inbox: undefined` (`issue-refresh.ts:258`). So #2814 as written shows 0 tickets on *Waiting on you* for every Jira repository with no `Ticket prefixes`, with or without a fleet. This answers the plan's third open question: yes, #2814 takes a position, and it is the two-state position the finding warns against.
- **Finding 4's risk claim is false for the fleet; only the Notes sentence is wrong.** The issue and the plan say that with `Impl: own branches` "the two dispatch in parallel and conflict". A `###` slice is `eligible` only when every earlier slice is `complete` (`eligible.ts:135`, fold at `:157-163`). Ran `sliceVerdicts` over the parent's three one-branch slices: today `[eligible, blocked, blocked]`; with Inbox merged `[complete, eligible, blocked]`. Duplicates cannot dispatch before Inbox merges. The fix for finding 4 is one sentence in the parent's `## Notes`, not a `waits:` annotation.

## (b) Approach — is a plan the right vehicle?

No. Every rule this lens owns points at a direct amendment of the parent plan:

1. **The repo amends Approved plans in place, and has done so for a plot-review finding on a plan PR.** `37cf9d803` "plot: amend a-planned-issue-shows-its-plan after review #1986" changes an Approved plan (`State: Approved` in its parent commit) in one commit on main. Issue #1986 is "plot-review: MEDIUM 2, LOW 3 on PR #1985", the same shape as #2813. `3ba68712b` corrects another Approved plan the same way. `gh api …/commits/<sha>/pulls` returns `[]` for both: no PR, pushed directly, both after `Review required since: 2026-10-15`. No plan in `docs/plans/` exists whose only job is to amend another plan.
2. **`plot-implement/SKILL.md:97-101` names the channel**: on drift, "a plan amendment … The user decides; record material amendments in the plan before starting." `MANIFESTO.md:120` ("frozen on approval") does not forbid this; `plot-implement` is the sanctioned exception, and the precedent commits use it.
3. **No gate requires the ceremony.** `plot-state-gate.sh:2-3` refuses only a changed `State:` (and `Spike approved:`) line; the amendments touch neither. `phaseGateRefusal` passes any commit whose paths are all under the plan directory, whatever the phase (`phase-gate.ts:189`). So the subject's two slices would pass every gate even with the subject plan still Draft — the plan's approval protects nothing.
4. **The sequencing defeats the fixes.** The subject needs a plan PR, plot-review, approval, a dispatched `docs/` slice, its merge, then a `bug/` slice behind it. Meanwhile:
   - Finding 1 must change #2814 *before #2814 merges*; the plan puts it in the second, waited slice — the last thing to land.
   - Findings 3 and 5 must land before the parent's Duplicates slice is briefed, and it becomes `eligible` the moment #2814 merges (probe above). Under "merge green PRs" that can be hours.
   - Finding 2 must land before Draft rows is briefed.
   A direct amendment lands in one commit now; the plan lands last.
5. **Editing a booked brief does not reach a running desk.** Slice 2 says it amends "the draft PR #2814's brief". The brief was booked on main at `a146246a3` (`.plot/briefs/an-absent-inbox-guesses-no-spelling.md`) and the desk has already read it. A live desk takes a change through `PLOT-CORRECTION.md` (`ports/desk.ts:111-137`, appended by the correction path) or a review on #2814, not through a later edit of the booked file.
6. **The plan's type and prefixes are wrong for what it ships.** `Type: bug` puts the plan into the release checklist: `plot-release/SKILL.md:284` collects every delivered feature or bug plan's `## Changelog`. The Changelog line here describes plan text, not behaviour, and would appear as a release item with nothing shipped. `MANIFESTO.md:151` says docs work ends at delivery. A `bug/` branch that edits only a plan file has no behaviour to fix.

Nothing here breaks a code contract, and the layering and index rules are not touched, because no slice changes code.

## (c) Slices

- **The plan's own `waits:` is unreadable.** `plot-plan-meta.sh` reports `"unread_waits":[{"branch":"bug/plan-2809-design-gaps","value":"Plan text"}]`. `waits:` takes a branch name (`plot-plan-meta.sh:134-145`, `branch-state.ts:48-60`), not a heading. It is also redundant: two headings are already ordered (`sliceVerdicts` gives `[eligible, blocked]` for the subject).
- **The order is inverted by urgency.** Finding 1 is the only finding that already has code built on it, and it is placed last.
- **The `docs/`/`bug/` split is by decided versus undecided, not by branch content.** Both slices edit the same file, the parent plan. That makes two PRs that conflict with each other unless they are strictly serial, for one file.
- **Should anything ship separately first?** Yes: finding 1 goes to #2814 now, as a review or correction before it leaves draft. That is a defect in an open PR, not a plan.

## (d) Open questions

- *Finding 1, rows scope or four-valued outcome?* Not this lens's call. Lifecycle evidence: the producer already has the four values. `inboxOutcomeOf` separates answered (`:251`), unaskable (`:258`) and failed (`:259-262`). "Not read" is the no-fleet board before its first read. A person decides this in the parent's `### Decisions` block, dated, as the parent already records its round-1 decisions.
- *Finding 2, `author` or `assignee`?* Not this lens's call. It is likewise a dated entry in the parent's `### Decisions`.
- *Does #2814 take a position on finding 1?* Yes. See (a): it returns 0 tickets on every `inbox === undefined`, which includes the person-scoped Jira case.
- **New:** Does #2814 merge before the amendment lands? If it does, the parent needs a fourth slice to undo the two-state rule. Hold #2814 in draft until finding 1 is decided.
- **New:** Should `plot-implement`'s "record material amendments in the plan" name the commit form (`plot: amend <slug> after review #N`, direct to main, no `State:` change) so the next plot-review on a plan PR does not produce a plan-for-a-plan?

## (e) Tests

- The parent amendment: run `plot-plan-meta.sh` on the amended parent. It must report no `unread_waits`, the same three branches byte-identical, and `phase: approved`. `plot-state-gate.sh` must pass the commit with no receipt, because no `State:` line changes.
- Finding 1, in #2814: domain unit tests in `packages/domain/test/waiting-tickets.test.ts`, one per inbox outcome. The decisive case is a Jira source with `inbox` marked unaskable/person-scoped, where `rows` hold the reader's tickets and the expected answer is those rows, not 0. A board unit test in `packages/board/test/unit/unplanned-issues.test.ts` covers the no-fleet path that supplies the signal.
- Finding 2: a domain test that a Draft plan row with no PR takes its owner from `PlanOwnerFields`. It belongs to the parent's Draft rows slice, not here.
- Finding 3: the existing `fold-issue-rows.test.ts:23,41` stay green in the parent's Duplicates slice.

## Amendments

1. Withdraw this plan. Close #2813 by a direct amendment commit to `docs/plans/2026-10-28-empty-jira-inbox-read-as-a.md` on main (`plot: amend empty-jira-inbox-read-as-a after review #2813`), as `37cf9d803` did for #1986.
2. In that commit, fix findings 3, 5, 6 and 7 as the subject's slice 1 lists them. Fix finding 4 by rewriting the Notes sentence only ("slices 1 and 2 share `waiting-tickets.ts`; the slice order already serialises them"); add no `waits:`.
3. Record findings 1 and 2 as dated entries in the parent's `### Decisions` once a person decides them, then rewrite slice 1 and slice 3 text to match. That commit lands before #2814 leaves draft, and before Draft rows is briefed.
4. Send finding 1 to #2814 now, as a review comment or a desk correction, naming `tracker-jira.ts:179-181` and `issue-refresh.ts:258`. Do not edit the booked brief.
5. If the plan is kept anyway: change `Type:` to `docs`, put both changes on one `docs/` branch (or `Impl:` same branch as the plan PR), drop the unreadable `<!-- waits: Plan text -->`, and correct the "dispatch in parallel" risk in Motivation finding 4.
