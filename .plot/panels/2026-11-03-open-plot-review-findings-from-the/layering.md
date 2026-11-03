# Juror: layering

Position: amend

## Summary

The nine areas are real, and each finding cites code that exists on `origin/main` (`a518552f1`; no change under `packages/` since `321966041`). Read through the layering lens, six slices put their fix in one clear layer. Three slices leave the layer open with an "or", and one slice holds two fixes that pull against each other. The plan says the slices have no dependency among them (Notes, line 136). That is false for four pairs: the pairs edit the same domain rule or the same board entry, and two of them change one another's behaviour. An unattended Sonnet agent per slice, started in parallel with no `waits:` marker, gets conflicts and changed semantics that its own slice text does not mention.

## Findings by slice

### Slice 1, Merge gate (`bug/the-merge-gate-reads-adoption`)

- **The adoption key already exists, and the plan does not name it.** `Review required since` is a Plot Config key (repo `CLAUDE.md`), and `packages/board/src/server/entry/review-bypass.ts:84` with `packages/domain/src/rules/review-bypass.ts` (`reviewBypasses`) already read "review is required since this date" and treat a `review-bypass:` comment as a reportable bypass. The only `Auto-review` reader is fleet-side (`packages/fleet/src/shared/auto-review.ts:33,56`), and `Auto-review` means "fleetd starts reviews", not "this estate has the review App". Open Question 1 lists "a review opt-in config key" without saying which key. A Sonnet agent can invent a third key.
- **Layer of the opt-in.** `merge` (`packages/domain/src/workflows/merge.ts:209-213`) is a pure decision over readings. The config read belongs in the three controllers that build `MergePorts`: `packages/board/src/server/entry/main.ts:156,208` (`plot-ask merge`), `packages/fleet/src/shared/auto-merge.ts:162-174` (fleetd), and `packages/domain/src/workflows/release-approve.ts:143` through its caller (`main.ts:260`). The plan does not say that all three must pass the new value. If one controller is missed, the gate differs by entrance.
- **"tip read runs before the host calls, OR the no-retry memory covers `default-branch-unsettled`".** These are two different layers. The first is a reorder inside the domain workflow `mergeAt` (`merge.ts:360-367`), and it changes every caller, `release-approve` included. The second is fleet-controller memory (`auto-merge.ts:109-116`), and it changes fleetd only. A third place is cleaner than both: the cause is that `slicePrNext`'s merge arm answers `merge` while the stored reading's `headSha` differs from its `settled.sha`. That is a domain rule (`rules/slice-pr-next.ts`, `mergeArm`), and it reads values it already has. The plan must choose one layer.
- **"an `unknown` settled reading has a bound for a person's merge".** This is a reader-side relaxation in `merge` keyed on `caller === 'person'`. The writer side is `advanceSettled` (`rules/default-branch.ts:110-115`), which `repair.ts` and the hold also read. The plan must say which side changes. A change to `advanceSettled` changes Slice 3's inputs (see below).

### Slice 2, Fixer attempts (`bug/a-high-gets-its-own-fixer-attempts`)

- The split of counts is a domain change that is in the right layer: `FixerAttemptSchema` already carries `finding` (`entities/fixer-attempts.ts:61`), so `fixerAttemptsSpent` can count per finding with no schema change. But `FixerReading` (`slice-pr-next.ts:20`) holds one `exhausted` boolean. The split changes that shape, and three fleet callers build it: `auto-fixer.ts:377`, `auto-ticket.ts:178` (`reviewStatus`), and `auto-fixer.ts:683` / `auto-review.ts:228` (filler configs). The slice text names `fixerAttemptsExhausted` and `reviewStatus` and does not name the fleet callers.
- **"give a red head that a fixer pushed to the fixer arm" has no reading to decide it from.** The attempts record stores the head the fixer **started for** (`headSha`, `entities/fixer-attempts.ts:58-59`), not the head it pushed. `deskDeadFromWorkerState` (`auto-fixer.ts:163-174`) is a fleet translation. The agent must choose between a new domain reading ("this head is not the desk's head", for example `row.headSha` not equal to any attempt's start head and an attempt exists after the desk's last push) and a change to the fleet desk translation. That is a design decision, and the plan leaves it to the agent.
- Moving the re-status arm (`slice-pr-next.ts:385`) is a domain-only reorder. That is fine.

### Slice 3, Red main (`bug/a-red-main-stays-acted-on`)

- `redMainStep` line 255 is a pure rule, and a settled-SHA comparison (`reading.settled.sha` against `record.firstRedSha`) fixes it inside the domain. The alternative, "or the refresh opens a new episode", is the fleet writer plus `keepsRepairRecord` (`rules/repair-pr.ts:202-207`). Again the plan gives two layers.
- **"the revert branch check compares the PR number" needs an entity change the plan does not name.** `isRevertBranch`'s own doc says "The record holds no number for the reverted PR" (`rules/repair-pr.ts:33-34`). The fix needs a new field on `RepairRecord`, written by `revert-start.ts`, decoded at `.plot/state/repair-record.json` (version bump or optional field), and read by `repairBranchMatches` (`:66-67`), which `merge.ts:230` reaches through `repairMergeVerdict`. The repo `CLAUDE.md` paragraph on `plot-ask.mjs merge` names `bug/revert-<pr>` and changes too. An old record with no number must have a named answer (refuse `repair-branch-mismatch`, or admit by shape).

### Slice 4, Desk endings (`bug/holding-work-reads-unpushed-commits`)

- The plan points at `skills/plot/scripts/plot-worker-state.sh:527-531`. The reading that reaches `endingAction` does not come from there in TypeScript: `dirtyTree` is `dirtyTreeReading(heldFiles)` (`packages/fleet/src/server/entry/registryd.ts:1062,1267`), and `heldFiles` is `treesGit(context).dirtyPaths` (`registryd-main.ts:1940-1943`). The `Trees` port already has `unpushedCommits` (`packages/domain/src/adapters/trees/trees-git.ts:559`, fixture `trees-fixture.ts:298`). So the fix is: a new `EndingActionReadings` field in the domain rule, read in the fleet controller through the existing port. No shell change is needed. A Sonnet agent that follows the shell citation can add shell lines and hit `scripts/check-shell-lines.sh`. The second `endingAction` call site sets `dirtyTree: 'no'` as filler (`registryd.ts:1816`), and the new field needs the same filler there.

### Slice 5, Release approval (`bug/the-release-books-what-it-ships`)

- **Two fixes in this slice pull in opposite directions.** Fix (b) refuses a master agent at `release-approve`. Fix (c) makes board routes pass "the clicking person" whatever `PLOT_UNATTENDED` the board carries. `Caller` is `'person' | 'unattended' | 'fleetd'` (`workflows/decision.ts:23`), and the board derives it from the process env at every entrance (`entry/main.ts:156,260`, `entry/deliver.ts:791`, `restart.ts:70`). An HTTP request carries no identity. The repo `CLAUDE.md` tells a master agent to use these same routes (`POST /api/release`, `POST /api/restart`). If (c) maps every HTTP request to `person`, an unattended process that POSTs passes as a person, and (b) loses its effect through the board. To tell a master agent apart from a person needs a new caller value and a source for it at the controller. That is a person's decision (Open Question 2) and belongs in a Design phase or its own slice, not in a bug slice next to the booking fix.
- **`releaseFinish` books only scope plans because it reads only scope plans.** `releaseFinish` (`workflows/release-finish.ts:126-175`) is pure over `readings.scope`, built by `packages/board/src/server/entry/release-finish.ts:223`. Booking "every Delivered plan in the tagged head" needs a new reading: which changesets ship under the tag, mapped to plans. The `plan:` line in a changeset is optional (repo `CLAUDE.md`, Versioning), so the map is incomplete by design. The plan must say whether the finish books such a plan, names it as a refusal, or names it in the detail only, and which controller reads the changesets.
- Citation: `release.ts:211` starts the script and holds no `PLOT_UNATTENDED`. The caller derivation for release is at `entry/deliver.ts:791`.

### Slice 6, Reviewer role (`feature/the-reviewer-is-a-role-agent`)

- **There is no single "role builder" to move onto.** The domain rule `roleCommand`/`roleAgentsJson` (`rules/role-command.ts`) is shared. The role-file load is duplicated and differs: the fixer reads `.claude/agents/fixer.md` from the main checkout (`auto-fixer.ts:454-460`, `world.readRoleFile(main, 'fixer')`), and main-repair reads it from `origin/<default>` through `Refs.showFile` (`repair-role.ts:109-120`). Only main-repair loads from the default branch. The plan says "loads `reviewer.md` from the default branch", which the fixer does not do either. A third copy in `packages/board/src/server/entry/review.ts:345` is the likely result. The slice should extract one loader (domain rule over the `Refs` port, called from each controller) and move the fixer onto it, or the plan should say the fixer stays as is.
- The board may import `@plot-pm/fleet` (`packages/board/package.json:57`), so either placement compiles. The security claim (definition from the default branch, not the desk) is a person's call, as Open Question 3 says.

### Slice 7, Idle slice (`bug/an-idle-episode-survives-a-restart`)

- Domain rule (`rules/slice-idle.ts:90,121-127`) plus a fleet reading. Coherent. The slice text does not say that `createdAt: ''` (`registryd-main.ts:1128-1139`) is fixed at the fleet reading. With the key free of fleetd's start and `createdAt` still empty, a slice with no `moved` line gets one key for its whole life. That is acceptable, but the plan should say it is the intended answer.

### Slice 8, Plan comment (`bug/the-plan-comment-parses-what-it-wrote`)

- Adapter (`adapters/tracker/tracker-plan-state.ts`) plus one rule (`rules/plan-issue-comment.ts`). Coherent and in the right layers. `CHANGELOG.md:463` is generated by the release; the correction goes in this slice's changeset, or the behaviour changes. The slice text does not say which.

### Slice 9, Review comment tests (`bug/the-review-comment-tests-can-fail`)

- `ReviewIssueDecision` is the one-value type `'none'` and `reviewIssue` always answers `'none'` (`rules/review-issue.ts:8,20`). The guard at `review.ts:481` is a tautology over a dead domain rule. The coherent fix removes `reviewIssue` and its type from the domain, not only the board guard. Board, domain and docs in one slice is acceptable because all three describe one removed behaviour.

## Hidden dependencies between slices

| Pair | Shared code | Effect |
|---|---|---|
| 1 and 5 | `mergeAt` (`merge.ts:354`), called by `release-approve.ts:143` | Slice 1's review opt-in and any reorder of `mergeAt` change `release-approve`'s answers. |
| 1 and 2 | `rules/slice-pr-next.ts` and its tests | Slice 2 reorders `arms` (`:385`); Slice 1's cleanest fix is in `mergeArm` in the same file. |
| 1 and 3 | settled reading (`advanceSettled`, `rules/default-branch.ts:110-115`); `repairMergeVerdict` reached from `merge.ts:230` | An `unknown` bound on the writer side changes what `redMainStep` reads; Slice 3's branch check changes a refusal the merge gate returns. |
| 6 and 9 | `packages/board/src/server/entry/review.ts` and `packages/board/test/unit/review.test.ts` | Parallel desks conflict on the same file and test. |

## Required amendments

1. Slice 1: name `Review required since` (or state why not) as the adoption key; state that the domain `merge` takes it as an input value and that all three `MergePorts` builders (`entry/main.ts` for merge and release-approve, `fleet/shared/auto-merge.ts`) pass it. Pick one layer for the repeat-merge fix; prefer the `mergeArm` check in `slicePrNext` over fleet memory. Say whether the `unknown` bound is in `merge` (reader) or `advanceSettled` (writer).
2. Slice 2: name the fleet callers that build `FixerReading` and the reading that decides "a fixer pushed this head".
3. Slice 3: pick one layer for the `close-prs` fix. Name the new `RepairRecord` field, its writer, its decode for an old record, and the `CLAUDE.md` paragraph it changes.
4. Slice 4: replace the shell citation with `Trees.unpushedCommits` read in `registryd-main.ts`, and state that no shell line changes. Name both `endingAction` call sites.
5. Slice 5: split it. Keep the booking fix (with its reading source and the answer for a plan whose changeset names no plan) as a bug slice. Move "who may approve" and "board caller identity" to a Design phase or a separate slice after a person answers Open Question 2, because the two halves contradict each other as written.
6. Slice 6: say whether the slice extracts one role-file loader from the default branch and moves the fixer onto it, or adds the reviewer only. Keep Open Question 3 open until a person answers it.
7. Add `waits:` markers, or one sentence per pair, for 1→5, 1↔2, 1↔3 and 6↔9, and correct Notes line 136.

## Decisions that need a person

- Open Question 2 (enforce who may approve a release) and how a board route learns the caller. This is a trust boundary.
- Open Question 3 (reviewer definition from the default branch) and whether the fixer moves to the same source.
- Whether a person's merge may proceed past a default-branch head whose CI never ran (`unknown`), and after how long.

## What I ran and what I only read

- Ran: `git fetch origin main`; `git show origin/main:<file>` with line ranges for every file cited above; `git grep` over `origin/main` for `autoReview`, `Review required since`, `bypass`, `mergeAt(`, `dirtyTree`, `unpushed`, `PLOT_UNATTENDED`, `status-only`, `fixerAttemptsExhausted`, `reviewStatus`, role loaders and package dependencies.
- Only read: the plan, the juror brief, the repo `CLAUDE.md`. I did not read issue #3069 or the closed issues #2918–#2935, and I ran no test, no host call, and no fleet or board command.
