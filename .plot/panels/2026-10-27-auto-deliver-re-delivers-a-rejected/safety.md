# Juror verdict — safety lens

Plan: `docs/plans/2026-10-27-auto-deliver-re-delivers-a-rejected.md` (PR #2760, issue #2713). Code cited from `pmain` (current `origin/main`).

Position: amend

The problem is real and the two rules point the right way. As written, each rule fails in both directions on the two real precedents this repo already holds. Each failure is named below with the evidence and with whether I read it or ran something.

## The two precedents

There are exactly two Approved-then-redelivered plans with a `Rejected:` record. I ran a grep over `docs/plans/*.md` for a `Rejected:` line on a plan whose State is not Rejected.

| Plan | Hollow PR | Rejection written | Fix PR | Outcome |
|---|---|---|---|---|
| `a-lifecycle-micro-pr-merged-past` | #1816, merged 2026-10-16T00:40:21Z, 0 files | `e32076f61`, 2026-10-16 03:23:38 +0200 (01:23Z) | #1823 under a NEW slice heading `### Identities (build)`, merged 2026-10-16T05:57:25Z, 16 files | delivered again `6bb657b37`, correctly |
| `plot-host-bitbucket-pr-list-reads` | #2422, merged 2026-10-26T14:19:47Z, 0 files | `6666041ff`, 2026-10-26 15:38:04 +0100 | none; the work moved to plan #2419 | delivered again `c67b5cd1f`, wrongly (the #2713 incident) |

Ran: `gh pr view <n> --json mergedAt,files` for #1816, #1823 and #2422, plus `git log` on both plan files. Both precedents are same-day: the hollow merge, the rejection and (in the first) the fix all fall on one calendar date. Any rule must resolve both rows correctly. The first row is the "legitimately re-approved plan" this lens asks about, and it exists.

## Wrongly held (the new rule stops a delivery it should allow)

1. **A same-day fix after a same-day rejection.** The `Rejected:` record carries a date and no time (read: `plot-reject/SKILL.md:111`, `transitions/plan.ts:819` writes `${input.on}, ${why}`). Under a strict "merged after that date" reading, #1823 (2026-10-16) is not after 2026-10-16, so row 1 is held. The open question in the plan names this. It must be resolved before approval, because the other reading fails worse (see "Wrongly delivered" 1).
2. **A plan repaired by the house convention, a sibling slice.** Row 1 repaired the hollow `### Identities` slice by adding `### Identities (build)` and left the hollow branch non-deferred (read: the plan file, lines 78–84). Under rule 2, the hollow branch never counts as delivered work, so that plan never auto-delivers again. If rule 2 also reaches `allSlicesMerged` (the board's Deliver control and `/plot-deliver`, open question 3), a person cannot deliver it by hand either until someone defers the hollow branch. The plan names neither the repair (defer the hollow branch with a reason that names the sibling slice) nor the scope.
3. **Every truly merged branch, if "reuse" picks `Refs.changedFiles`.** `changedFiles` runs `git diff --name-only origin/<main>...<branch>` (read: `refs-git.ts:403-411`). This repo merges with true merge commits (`eede90c78 Merge pull request #2422 …`). After a true merge the merge base IS the branch tip, so the three-dot diff is empty for every merged branch. A claim-only test built on it reads every merged slice as hollow and stops auto-delivery for every plan.
4. **A rejected plan whose refs are already swept.** The first delivery ran `plot-release-refs.sh`. The ref `bug/plot-host-bitbucket-pr-list-reads` is gone from origin (ran: `git ls-remote`, no output). Any branch-ref reading (`changedFiles`, `Trees.commitBeyondClaim`) answers `unanswerable` for exactly the plans this rule targets. If `unanswerable` holds, the effect is safe but silent. The board must say why the plan waits.
5. **A cross-repo slice or a commit-named slice (`→ owner/repo@sha`).** No local PR or merge commit exists to count files on. The reading answers unknown, and the plan stays held with no stated reason.

Items 1–5 do no damage, since a held plan only waits for a person. They still matter: auto-deliver exists because plans sat undelivered (`auto-deliver.ts:31-40`), and a hold with no reason on the board brings that back.

## Wrongly delivered (the new rule still lets through what it should stop)

1. **The incident itself, under a `>=` date comparison.** #2422 merged 2026-10-26, and the rejection is dated 2026-10-26. If "after that date" means the same day or later, #2422 lifts the hold and `c67b5cd1f` repeats. The same holds for #1816 on row 1. A date-only record cannot separate the hollow merge from the fix on either precedent. The comparison needs an instant: the host's `mergedAt` against the commit time of the write that set `State: Approved` (git, free), or a timestamp in the record.
2. **"Latest Status record is `Rejected:`" has no stable meaning.** There are two writers with two layouts. The `/plot-reject` skill replaces the `Delivered:` line in place (read: `SKILL.md:111`, and diff `6666041ff`). `plot-undeliver.sh` keeps the `Delivered:` line and inserts `Rejected:` directly after `State:` (read: `plot-undeliver.sh:118-156`). Under the controller's layout the last record by line order is `Delivered:`, so the hold never fires. The plan needs no ordering at all: phase `approved` plus any `Rejected:` record already proves a reversal, because a plan that delivered again reads `delivered`.
3. **A second rejection keeps the first date.** `undeliver` returns `record: written === '' ? … : written` (read: `transitions/plan.ts:819`), and `plot-undeliver.sh` replaces the line with that same text. A fix that merged between the first and the second rejection is "after" the recorded date, so it lifts the second hold. This is a second reason to take the instant from git rather than from the record text.
4. **The claim-only reading misses the incident if "reuse" picks `isEmptyClaim`/`realCommits`.** #2422's second commit `f576060de` changes no file. Its tree `58a3094…` equals its parent's tree (ran: `git log -1 --format=%T`). Its subject is not `plot: claim …`, so `isEmptyClaim` answers false (read: `empty-claim.ts:35-36`) and `realCommits` counts it as work. `Trees.commitBeyondClaim` uses the same predicate (read: `ports/trees.ts:164-178`). A test written to the plan's wording, "nothing beyond `.plot/claims/`", also passes and still misses #2422: no `.plot/claims/` path exists anywhere in the tree (ran: grep, zero hits), claims are empty commits, and the PR changed zero files. The reading that answers both precedents correctly is the PR's file count: #2422 = 0, #1816 = 0, #1823 = 16 (ran: `gh pr view --json files`). The first-parent diff of the merge commit gives the same answer (ran: `git show -m --first-parent --name-only eede90c78`, 0 files).
5. **The "merge watcher's definition" does not exist on main.** I grepped `packages/*/src`, `skills/` and `docs/` for "changes no file beyond its claim" and close variants, and found nothing. The nearest definitions are items 3 and 4 above, and each fails one direction. The plan asks the builder to reuse something that is not there. The builder will then pick one of the two wrong readers.
6. **A hollow PR that changes some file.** A PR that carries only a changeset, a plan edit or a note is not claim-only. It still delivers on the first pass, as `b2df79eaf` did. The rejection hold then becomes the only backstop. This is acceptable scope, but the Changelog line ("no longer reads a merged slice PR that holds only its claim as delivered work") must not suggest more.

## Layer and path

- The pulse does not carry what the rules need. `PlanSchema` holds `file`, `phase`, `tracer` and `slices` (read: `entities/fleet.ts:695-723`), and a branch holds `state` with no `mergedAt` and no file count. Rule 1 needs a rejected flag and an instant. Rule 2 needs a file count per merged branch. Either the scan emits new fields (`plot-fleet-scan.sh`, which costs shell lines under `check-shell-lines.sh` and changes the pulse schema) or `auto-deliver.ts` reads them through a port. The plan's line "adds no plan field and no helper script" holds, but "Board impact: none expected" does not hold if the pulse gains fields.
- A file-count read is a host call (GitHub `files`, Bitbucket diffstat), and `plot-host.sh` has no such op today (read: grep for `diffstat`/`files` in `plot-host.sh`, no hits). The git alternative needs the merge commit SHA. Either way, ask only for a plan that has already passed every other `isDeliverable` gate, not for every branch on every tick.
- Keep both rules auto-only, beside `landedBranches` (`auto-deliver.ts:370-389`). That gate is the existing precedent for "narrower than the shared rule, because this path chains to `plot-release-refs.sh --yes`". If either rule enters `allSlicesMerged`/`allSlicesConfirmed`, the board's Deliver control and `/plot-deliver` change too. Wrongly-held items 2–5 then lose their human escape.
- Do not change the scan's slice `verdict` for a claim-only branch. That changes the wave gate and opens or blocks dependent slices, which is a different decision with its own blast radius.

## Slices and acceptance

- The slice order is acceptable. Rule 2 alone would have stopped both precedents' first wrong deliveries (`d2f1c64d3`, `b2df79eaf`). Rule 1 is the backstop for rejections with other causes.
- Slice 1's test ("reject a delivered plan with all slices merged, assert no delivery") fails on today's code (read: `isDeliverable` has no such gate, `auto-deliver.ts:340-395`). It is not enough. It needs the positive case, a same-day fix merged after the rejection, and the second-rejection case.
- Slice 2's acceptance needs fixtures shaped like the evidence: an empty non-claim commit (`f576060de`), a truly merged branch whose tip equals its merge base and which carries real files (must still count), and a swept ref (must read unknown, never `merged`).

## Amendments

1. **Resolve open question 1 with an instant, not a date.** Compare the host's `mergedAt` with the time of the commit that last set `State: Approved` (or record a timestamp). Show that row 1 delivers and row 2 holds. If no instant is available, take the conservative rule instead: auto-deliver never delivers an Approved plan that carries a `Rejected:` record, and a person delivers it.
2. **Define "rejected" as phase `approved` plus a `Rejected:` record.** Drop "latest Status record", which differs between the skill's layout and `plot-undeliver.sh`'s layout.
3. **Name the claim-only reading exactly.** The reading is a merged PR whose host file list is empty, or whose merge commit's first-parent diff is empty. Forbid `Refs.changedFiles` (three-dot, empty for every true merge) and `isEmptyClaim`/`realCommits`/`commitBeyondClaim` (they count `f576060de` as work). Delete the `.plot/claims/` wording and the claim that a merge-watcher definition exists to reuse.
4. **Answer open questions 2 and 3: both rules are auto-only.** They join `isDeliverable` beside `landedBranches`. `allSlicesMerged`, the board's Deliver control, `/plot-deliver` and the scan's slice verdict stay unchanged. State the repair for a hollow branch whose work landed in a sibling slice: defer it with a reason that names the sibling.
5. **An unanswerable reading holds and says why.** A swept ref, a cross-repo slice or a commit-named slice holds the plan. The board names the hold instead of showing a plain `deliverable`.
6. **State where the readings come from and what they cost.** Name the pulse fields or the port, and correct "Board impact: none". Give the `check-shell-lines.sh` cost if the scan changes, and the Bitbucket route for a PR's file count (no `plot-host.sh` op exists).
7. **Add the fixtures above to each slice's acceptance**, built from the two precedents: #1816/#1823 must deliver once the fix lands, and #2422 must hold.
8. **Narrow the Changelog line** to a merged PR that changes no file. A hollow PR that changes some file still delivers.
