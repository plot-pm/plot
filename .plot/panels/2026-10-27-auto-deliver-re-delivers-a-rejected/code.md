# Juror verdict — code lens

Plan: `docs/plans/2026-10-27-auto-deliver-re-delivers-a-rejected.md` (PR #2760, issue #2713). Code read in `pmain` at `origin/main`.

Position: amend

The problem is real, and both defects the plan names exist. The plan describes the wrong predicate for slice 2, names a refusal that does not exist, and leaves out the input that slice 1 needs. It also does not name the existing mechanism that already answers "this merged PR carried no implementation".

## 1. The problem

- **Re-delivery is reproduced from the code (read).** `planAutoDeliver` (`packages/domain/src/rules/auto-deliver.ts:285-296`) and `isDeliverable` (`:340-395`) check five things: phase `approved`, no in-flight mark, `allSlicesConfirmed === 'merged'`, `landedBranches > 0`, and `retryVerdict === 'ready'`. None of them reads a `Rejected:` record. `/plot-reject` sets `State: Approved` and turns the `Delivered:` line into `Rejected:` (`skills/plot-reject/SKILL.md:99-112`). The plan then reads approved with every slice merged, so the next pass delivers it.
- **The incident matches (ran `git show`/`git log`).** `6666041ff` "reject … PR #2422 carried only its claim" is followed by `c67b5cd1f` "deliver" at 15:38:47 +0100. That commit changes the plan, the index symlink and the sprint file. The plan text at `c67b5cd1f` holds `Rejected: 2026-10-26 (…)` and then `Delivered: 2026-10-26`.
- **PR #2422 changed no file at all (ran `gh pr view 2422 --json files,commits,mergedAt`).** `files: []`. It holds two commits, the empty `plot: claim …` commit `d92e323f` and `f576060de`, and `git show --stat f576060de` lists no paths. It merged at `2026-10-26T14:19:47Z`, merge commit `eede90c7`.
- **The claim vocabulary in the plan is wrong (read).** No `.plot/claims/` directory exists (ran `ls .plot`). A claim is an EMPTY commit titled `plot: claim <branch>` (`packages/domain/src/rules/empty-claim.ts`, used by `claim.ts:3,47-48`; written at `workflows/agent-loop.ts:723` with `paths: []`). So a test of "the diff holds nothing beyond `.plot/claims/`" would be written against a path that never appears. The right predicate is the one the delivery code already uses: no changed path outside a root `PLOT-BLOCKED*` marker. The claim adds no path.
- **No "merge watcher" refusal exists (ran greps over `packages/*/src` and `skills/plot/scripts`).** "changes no file beyond its claim" and "merge watcher" match no code. The closest is the slice-PR **notice** `This branch carries no implementation` (`packages/domain/src/rules/slice-pr.ts:185`, `skills/plot/scripts/plot-open-pr.sh:227`). That notice is a body text and refuses nothing. The plan's "reuses the merge watcher's definition" points at a definition that does not exist.
- **Scope (read).** Auto-deliver is the only unattended deliverer. The board's Deliver control and `/plot-deliver` go through `deliverability.ts`. They already print `emptySlices` and deliver anyway (`packages/board/src/server/entry/deliver.ts:427-429`). This is deliberate, see section 2. Slice 2 alone would also have stopped the FIRST delivery (`b2df79eaf`). Slice 1 only stops the re-delivery.

## 2. The approach against the code

**An existing mechanism answers slice 2. The plan should name it and reuse it.**

- `carriedWorkOf` (`packages/board/src/server/controllers/deliverability.ts:211-226`) asks `host.prMergeCommit(branch)`, then `refs.commitFiles(sha)` (`-m --first-parent`, `refs-git.ts:495`). It answers `files.some(p => !isMarker(p))`, where `isMarker` is `startsWith('PLOT-BLOCKED')` (`:238`). A failed read answers `unknown` and never `false`. For #2422 this gives `carriedWork: false`.
- The domain already holds the field and the rule: `DeliverBranchReading.carriedWork: boolean | 'unknown'` and `emptySlices` (`packages/domain/src/workflows/deliver.ts:34, 85-114`). `slice-pr.ts:164-167, 293` reuses the same field.
- **The domain made a recorded decision NOT to refuse on it**, and the plan does not engage with it. `deliver.ts:96-110` states: of 60 merged PRs measured on 2026-09-08, 7 carried no work, and 3 of those were claim PRs whose slice finished under a different PR. A refusal "would have blocked a delivery whose work was complete". Slice 2 must say why the unattended path may hold where the manual path only reports. The argument exists and matches `isDeliverable`'s own `landedBranches` asymmetry (`auto-deliver.ts:370-389`): auto-deliver chains to a reap and to `plot-release-refs.sh --yes`, a ref deletion that cannot be undone. The plan has to make this argument. "Reuse the merge watcher" is not enough.
- **Layer.** `@plot-pm/fleet` depends on `@plot-pm/domain` only (`packages/fleet/package.json:29`), so it cannot import the board controller. Reuse therefore means moving `carriedWorkOf`'s classification (`isMarker` plus "any path outside it") into a domain rule. Board and fleet both call that rule, and the readings come through the existing `Host.prMergeCommit` and `Refs.commitFiles` ports. Bitbucket implements `pr-merge-commit` (`plot-host.sh:4256`; `host-shell.ts:394`), so neither host needs new host work.
- **Cost (read).** `planAutoDeliver` runs every pass on the pulse and stays pure. The pulse holds no file list, so the carried-work reading has to be taken in the adapter (`packages/fleet/src/shared/auto-deliver.ts`, `runAutoDeliverPass` at `:487`). It must be taken only for plans that pass every other gate, which is rare. Asking it for every merged branch on every pass would spend two calls per branch per tick. The plan must state that the reading is asked only for the candidates. It also needs a cache rule: a merged PR's merge commit is terminal, so one answer per branch can be kept.
- **Slice 1 needs an input the pulse does not carry (read).** `PlanSchema` (`packages/domain/src/entities/fleet.ts:695-721`) holds `file`, `phase`, `tracer` and `slices`, and no record. `planAutoDeliver` documents that it reads the pulse and never plan files (`auto-deliver.ts:30-42, 281-283`). So slice 1 must either (a) add a field to the pulse, which means `plot-plan-meta.sh` and `plot-fleet-scan.sh` must emit it (shell lines, ratcheted by `scripts/check-shell-lines.sh`, and a board-visible schema change that contradicts "Board impact: none"), or (b) read the record in the fleet adapter for candidates only, through `PlanStore.readPlan`. The plan names neither. Option (b) costs no shell lines and keeps the rule pure.
- **"After a rejection" can use a timestamp the code already has (read).** `Refs.recordCommit(file, field)` (`refs-git.ts:511`, already used for `'Delivered'` in `board.ts:2165` and `verify.ts:397`) names the commit that wrote a record, and that commit has a time. The PR index rows carry the host's `mergedAt` (`entities/pr-index.ts:81`), and a MERGED row is terminal, so CLAUDE.md "A Decision Reads The Index" allows reading it. This answers Open Question 1 at commit precision. In the incident, the merge at 14:19:47Z precedes the rejection at 14:38:04Z. The simplest form is: hold while the latest record is `Rejected:`, and release only on a merge whose `mergedAt` is later than the rejection commit. Anything unknown holds. The fallback is to hold until a person delivers.

## 3. Safety

- Both changes only remove deliveries. Neither can deliver, merge or release more than today. Good.
- **Required direction:** every `unknown` (unreadable record, no merge commit, a failed `commitFiles`, a missing index row) must HOLD the auto path and must never count as "carried work" or "merged after". This mirrors `carriedWorkOf`'s `unknown` (`deliverability.ts:220-224`). The plan must state it, because "does not count as delivered work" is ambiguous about `unknown`.
- **A held plan must not feed the failure counter or the in-flight set.** A skip has to happen in `isDeliverable`, before a mark is written (`runAutoDeliverPass` marks at `:523`). If the hold is built as a refusal inside the spawned delivery instead, every pass spawns, refuses, records a failure, and stops after `AUTO_DELIVER_MAX_FAILURES` with a misleading "needs a person" line. The plan should exclude that implementation.
- The "merged after the rejection" test must read the host's `mergedAt` and never ancestry (CLAUDE.md "One Answer To Did This Land"). The plan's open question leans that way, but the design does not require it.
- Open Question 2 has a safe answer: a claim-only slice holds the plan in the auto path only. It does not reopen the slice. Reopening would change `allSlicesMerged` for the board and `/plot-deliver`, and would contradict the `emptySlices` decision.

## 4. Slices against Changelog and acceptance

- Slice 1's test ("reject a delivered plan with all slices merged, run the pass, assert no delivery") fails on today's code, but the plan does not say which reading carries the rejection. Name the input (`rejectedAt` or a record reading) and add the release case: a branch merged after the rejection delivers.
- Slice 2 names no test. Required tests: a merged branch whose merge commit changes `[]` or only `PLOT-BLOCKED.md` holds the plan; a commit that changes one real file delivers; `unknown` holds; and the board's `deliverability` still reports and delivers (no regression of `emptySlices`).
- The order is acceptable either way. Slice 2 alone prevents both deliveries in the incident, so it carries more weight and could go first.
- Slice 3 ("corpus pair") is conditional and has no branch. No shell implementation of carried-work exists (`plot-open-pr.sh:227` reads the domain's notice), so no pair arises. Drop it, or keep it as a note.
- The Changelog line is accurate. Change "holds only its claim" to "changes no file outside a `PLOT-BLOCKED` marker".

## 5. New defects

- The `.plot/claims/` predicate would give a test that passes for the wrong reason (no PR ever touches that path), so it never fires on the real case.
- Option (a) for slice 1 costs shell lines under `check-shell-lines.sh`, and the plan does not account for them. Option (b) does not.
- Moving `isMarker` into the domain must keep the board's behaviour byte-identical. One rule with two callers is what the plan's "no second definition" asks for.
- Plot is project-agnostic. `PLOT-BLOCKED*` is Plot's own marker, so the change brings in no project vocabulary. Both hosts answer `pr-merge-commit`.
- New code in `packages/domain/**` and new fleet helpers must be arrow functions.

## Amendments

1. Replace ".plot/claims/" with the real predicate: the merge commit (`Host.prMergeCommit`, then `Refs.commitFiles`) changes no path outside a root `PLOT-BLOCKED*` marker. The claim commit is empty and adds no path.
2. Remove "the merge watcher's definition", which does not exist. Name `carriedWorkOf`/`isMarker` (`packages/board/src/server/controllers/deliverability.ts:211-238`) and `DeliverBranchReading.carriedWork` (`packages/domain/src/workflows/deliver.ts:34`) as the definition. Move the classification into a domain rule that board and fleet both call.
3. Address the `emptySlices` decision (`deliver.ts:96-110`) directly. State that the hold applies to the unattended path only, because that path reaps and deletes refs, and that the board and `/plot-deliver` keep reporting and delivering.
4. Name the slice-1 input and its route. Prefer reading the record in the fleet adapter for candidate plans only, through `PlanStore`, over adding a pulse field through two shell scripts. If a pulse field is chosen, account for the `check-shell-lines.sh` cost and fix "Board impact: none".
5. Resolve Open Question 1: compare the host's `mergedAt` (a MERGED PR-index row) with the time of the commit that wrote `Rejected:` (`Refs.recordCommit(file, 'Rejected')`). Never use ancestry. Anything unreadable holds.
6. State that every `unknown` holds the auto path, and that a hold is a skip in `isDeliverable`. It writes no in-flight mark and no failure record.
7. Limit the carried-work reading to plans that pass every other gate, and say whether the answer is cached per branch.
8. Give slice 2 named tests (empty diff, marker-only diff, real file, unknown) and add the release case to slice 1. Drop slice 3, or turn it into a note.
