## Implementation brief — auto-deliver-re-delivers-a-rejected (wave 2: Claim-only slice)

- **Plan (canonical):** docs/plans/2026-10-27-auto-deliver-re-delivers-a-rejected.md on main
- **Approved:** 2026-10-27, Jan Wloka, plan-PR #2760 merged
- **Branch:** `bug/auto-deliver-ignores-a-claim-only-slice` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** per repo convention (PR review; `plot-review` app required on main)

Wave 1 (`bug/auto-deliver-holds-a-rejected-plan`, the rejection hold) is already merged as PR #2775. This branch is independent of it — it adds the second, unrelated hold the plan describes — and does not need to wait on anything.

### What to build

Fleetd's `runAutoDeliverPass` currently auto-delivers a plan the instant every non-deferred slice branch has a merged PR, without asking what that merge actually changed. On 2026-10-26, PR #2422 for `plot-host-bitbucket-pr-list-reads` (#2400) merged two empty commits — a `plot: claim …` commit and a second commit whose tree equals its parent's — and fleetd delivered the plan twice from that merge alone (`b2df79eaf` and `c67b5cd1f`, 43 seconds after a human rejection). `gh pr view 2422 --json files` returns zero files; `git show -m --first-parent --name-only eede90c78` lists no file. The board already has a name for this: a **claim-only slice** carries no implementation, only the branch claim and (optionally) a `PLOT-BLOCKED*` marker.

The fix is a domain-level classification — "did this merged branch's merge commit change anything other than a `PLOT-BLOCKED*` marker" — shared by two callers that today disagree about where this logic lives: the board's delivery controller (which already has it, informally, as a non-blocking finding) and fleetd's auto-deliver pass (which has no such check at all, and for which the finding must block).

### The decisions the plan settles — do not re-derive them

**Move `carriedWorkOf`, don't duplicate it.** `packages/board/src/server/controllers/deliverability.ts:211-224` already implements exactly this read: `Host.prMergeCommit(branch)` → `Refs.commitFiles(sha)` → `files.some(path => !isMarker(path))`, with `isMarker = path => path.startsWith('PLOT-BLOCKED')` (`deliverability.ts:229`). Move this pair into a domain rule under `packages/domain/src/rules/` (new file — there is no existing `claim-only.ts` or similar; name it to match the plan's vocabulary, e.g. `claim-only-slice.ts`), and have both the board controller and the new fleet code call the domain version with byte-identical behaviour. Do not write a second implementation in fleet — the whole point of this move is one rule, two callers.

**The three-value return is load-bearing: `boolean | 'unknown'`, never collapsed to boolean.** `unknown` fires on: a host that cannot name the merge commit (`sha.ok === false`), a host that names an empty SHA (`sha.value === ''` — the merge-state and merge-commit answers disagree, which must not be silently treated as "no work"), and a `commitFiles` read that fails. The caller treats `unknown` as a hold, exactly like `false` — see plan test "Unknown: … each hold." Do not let a defensive `?? false` or similar collapse this on the way into fleet code.

**Rejected implementations, already disproved by the #2422 fixture — do not reach for these:**
- `isEmptyClaim` (`packages/domain/src/rules/empty-claim.ts`) — matches by commit *subject* (`plot: claim …`). #2422's second commit has an empty tree-diff but a non-claim subject (`"No code change follows"`), so `isEmptyClaim` answers false on it and undercounts.
- `realCommits` / `Trees.commitBeyondClaim` — same failure mode: they count #2422's second commit as "real" work because they reason commit-by-commit rather than from the merge's net file diff.
- `Refs.changedFiles` (three-dot diff) — empty for *every* branch after a true merge (the branch is fully contained in main by then), so it would make every merged branch read as claim-only. The plan explicitly calls this out as a trap `carriedWorkOf` avoids by using `commitFiles` on the merge commit itself (effectively `-m --first-parent` semantics — see the repo's `## One Answer To "Did This Land"` CLAUDE.md section on why `-m`/`--first-parent` must travel together).

**Docs-only is work, not claim-only.** A merge commit whose first-parent diff lists only `docs/notes.md` (or any non-marker path) must deliver — `isMarker` only excludes `PLOT-BLOCKED*` at the repo root, nothing else. Don't add a broader "non-code" exclusion.

**Cache per merged branch, for the life of the process.** A merge commit is terminal (it cannot change), so once `runAutoDeliverPass` reads a branch's carried-work answer, it must not re-ask `Host.prMergeCommit`/`Refs.commitFiles` for that branch on a later pass. The plan's test list requires this exactly: "a second pass over the same merged branch asks `prMergeCommit` and `commitFiles` zero more times." Follow the same per-candidate batching shape slice 1 used for `readHolds` (`packages/fleet/src/shared/auto-deliver.ts:599-620`) — read once per pass for the current candidates, keyed by branch name, and keep the cache alive across passes the same way `heldLogged` is threaded through `runAutoDeliverPass`'s calls today.

**This is an auto-only hold, exactly parallel to `holdFromRejection`.** Follow its precedent at `packages/domain/src/rules/auto-deliver.ts` (the `AutoDeliverHold` type, now `'rejected' | 'unknown'`) — extend it with a third member that names the offending branch (the plan's log-line wording is `claim-only <branch>`), or add a sibling hold function the fleet pass folds in alongside `holdFromRejection`. A held plan gets **no in-flight mark and no failure record** — it is a structural skip, not a failed delivery, so it must never reach `AUTO_DELIVER_MAX_FAILURES` or the "failed N consecutive deliveries" report (see `runAutoDeliverPass`'s existing `holds` plumbing at `auto-deliver.ts:523-539`, which already does this correctly for the rejection hold — reuse the same shape, don't invent a second one).

**Do not touch `/plot-deliver`, the board's Deliver control, `allSlicesMerged`, or `allSlicesConfirmed`.** All of these keep the 2026-09-08 `emptySlices` decision: a human delivering by hand sees the claim-only branch named as a finding and proceeds anyway. Only fleetd's unattended `runAutoDeliverPass` gains the new hold.

**No corpus pair, by the same reasoning slice 1 used for `holdFromRejection`.** `packages/domain/corpus/deliverable.corpus.test.ts:33-35` already excludes `planAutoDeliver` and its surrounding fleet-pass logic from the four-reader equality, because this hold reads evidence (`Host`/`Refs`) none of the four corpus readers touch. Add one line to that same exclusion comment naming this hold, the way the plan's own Corpus section says ("Each slice adds one line to that exclusion comment that names its hold.") — do not create a new corpus test file.

### Done when

The plan's `## Done when` is its Tests section under "Slice 2" — lift these as the assertions a naive implementation would otherwise skip:

- **Fails today, and is the regression fixture:** a plan with #2422's exact shape — an empty `plot: claim` commit plus a second empty-tree, non-claim-subject commit, merge commit's first-parent diff lists no file. The plan must hold. This is the fixture that specifically rules out `isEmptyClaim`/`realCommits` reuse — if you reach for either, this test catches it.
- A merge commit whose first-parent diff lists only `PLOT-BLOCKED.md` → holds.
- One real source file in the diff → delivers.
- Only `docs/notes.md` in the diff → delivers (docs-only is work).
- A true merge whose branch tip equals its merge base, with real files in the first-parent diff → delivers. This specifically catches an accidental `Refs.changedFiles` (three-dot) substitution, which would read this case as empty.
- A merged branch whose remote ref is already swept (gone) is still read through its merge commit and answered from that commit's files — never `unknown` for the missing ref alone.
- A failed `prMergeCommit`, an empty-string merge-commit answer, and a failed `commitFiles` read each → `unknown`, which holds exactly like `false`.
- Second pass over the same merged branch: zero additional `prMergeCommit`/`commitFiles` calls (cache assertion).
- The board's existing `deliverability` tests are unchanged — `emptySlices` still names the branch as a finding and still lets a human-initiated delivery proceed.

Plus: add the changeset this PR needs (package `plot` or `@plot-pm/board` per `./scripts/check-changeset-packages.sh`, description first, `bumps:` block last — see CLAUDE.md `## Versioning`), and the one exclusion-comment line in `deliverable.corpus.test.ts` named above.

For tests, run `node skills/plot/scripts/board/plot-local-checks.mjs` before each push and run what it prints — this touches `packages/domain/src/**` and `packages/fleet/**`, both of which have dedicated `vitest related`/`tsc --noEmit` entries in the `Local checks` config key. The suites in `CI suites` (`pnpm run test:e2e`, `test:contracts`, `test:board`, the domain coverage run, `node --test test/reconcile/*.test.mjs`) run in CI on every PR — do not run them locally as a matter of course, and do not list them as a repo gate in follow-up work.

Name the shell gate too: `scripts/check-shell-lines.sh` refuses a PR whose shell under `skills/` grew past its merge base. This slice is pure TypeScript (domain rule + fleet pass + board controller delegation), so it should add zero shell lines — if a `.sh` file ends up touched, that growth must be paid for in the same change.

### Bookkeeping

Open the PR through the controller once the branch has a real commit:

```bash
skills/plot/scripts/plot-open-pr.sh          # current branch, once pushed
skills/plot/scripts/plot-open-pr.sh --draft  # while still moving
```

Never `gh pr create` — see CLAUDE.md's "The Master Agent Uses The Controllers." Push the first real commit as soon as it exists. When the PR is created, append `→ #<number>` to this branch's line under the plan's `## Slices` → `### Claim-only slice` heading, in the same commit or a follow-up to the plan file.

### Scope guard

This branch owns:
- `packages/domain/src/rules/` — the new claim-only classification rule (new file)
- `packages/domain/test/` — its unit test
- `packages/board/src/server/controllers/deliverability.ts` — delete `carriedWorkOf`/`isMarker`, delegate to the new domain rule
- `packages/fleet/src/shared/auto-deliver.ts` — the new hold, folded into `runAutoDeliverPass` alongside `holdFromRejection`
- `packages/fleet/test/unit/auto-deliver.test.ts` — its pass-level tests
- `packages/domain/corpus/deliverable.corpus.test.ts` — one exclusion-comment line only
- a new `.changeset/*.md`

Wave 1's branch (`bug/auto-deliver-holds-a-rejected-plan`) already merged as #2775 — its changes to `packages/domain/src/rules/auto-deliver.ts` (the `holdFromRejection`/`AutoDeliverHold` shapes) and `packages/fleet/src/shared/auto-deliver.ts` (`readHolds`, the `holds` plumbing in `runAutoDeliverPass`) are already on `main`; this branch builds on top of them rather than colliding with them. No other branch from this plan is in flight.

If you find something the plan did not anticipate, report it rather than improvising outside scope.
