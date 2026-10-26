## Implementation brief — implement-leaves-its-brief-and-plan (wave 2: Fleetd Plan Source)

- **Plan (canonical):** `docs/plans/2026-10-26-implement-leaves-its-brief-and-plan.md` on `main`
- **Approved:** 2026-10-26, Jan Wloka, plan-PR #2726 merged
- **Branch:** `bug/fleetd-plan-store-reads-the-ref` (base: `main`)
- **Ends as:** one PR to `main`, opened with `plot-open-pr.sh`
- **Review of the code:** pull request, per the plan's `Review: pr`

Wave 1 (`bug/implement-books-the-brief-in-a-worktree`, PR #2740) has merged, so this branch is eligible. That wave's brief warned this one touches `registryd-main.ts`, which other in-flight desks also edit — see Scope guard.

### What to build

fleetd's queue, supervisor and index monitor currently read plans from the **working tree** of whatever checkout the daemon's process happens to have open, through `planStoreShell(context).listPlans()` (a `find docs/plans` walk) and `.readPlans(files)`. That is the second harm the plan's Motivation section measures: a plan approved on the host at 20:38 on 2026-10-26 stayed invisible to the queue until the operator fast-forwarded the checkout by hand at 20:55:43, 17 minutes later — because nothing else moves that checkout, and the daemon never asked the ref instead.

Make fleetd read plans from `origin/<default>` instead, the way the board already does for its Kanban view (`collectPlanSources` / `readPlansFromRef`, `packages/board/src/server/board.ts:552-770`, landed in `2026-08-27-the-board-reads-the-ref-not-the-checkout`). Build a new `PlanStore` implementation backed by the ref:

- `listPlans()` → `Refs.listBlobs(ref, planDir)`, filtered to `mode === '100644' || mode === '100755'` and `.endsWith('.md')` — regular files only, so the `active/`/`delivered/` symlinks the working-tree walk has to de-duplicate never appear in the first place (a tree listing has no second copy of a symlink target; `workingTreePlans`'s `seen` map in `board.ts:606-645` exists only because a filesystem does).
- `readPlans(files)` → `Refs.readBlobs(shas)` in one batched call (never one call per file — see the port's own docstring on `readBlobs`: ~55 ms process spawn per git call, 136x apart measured on this repo), each blob staged to a scratch file, then one spawn of `plot-plan-meta.sh` over all staged paths, the way `board.ts:2060-2085` stages ref-read plans before the one parser spawn.
- An unresolvable or unreadable ref answers an **empty list**, never a failure that falls through to a different source. That is `claimedBranches`'s own direction two lines above the `plans` field at `registryd-main.ts:766-773`: "reading it as *no branch is claimed* would put every branch on the estate into the queue at once." The same substitution risk applies here — an empty plan list queues nothing, which is safe; a fallback to the working tree would reintroduce exactly the bug this slice fixes, under the one condition (a stale or detached checkout) where it would matter most.
- The default branch comes from `refs.defaultBranch()`, never a literal `'main'` — `findMissingBriefs` (`packages/fleet/src/shared/auto-dispatch.ts:61`) already gets this wrong and is a named, unfiled follow-up in the plan's Notes; do not repeat its mistake here.

Build it as a real `PlanStore`, not a one-off function: a new file under `packages/domain/src/adapters/plan-store/` (sibling to `plan-store-shell.ts` and `plan-store-fixture.ts`) exporting something like `planStoreRef(context, ref)` or `planStoreOverRef(refs, planDir, ref)`, returning the same `PlanStore` shape `plan-store.ts` declares. `board.ts`'s `readPlansFromRef`/`collectPlanSources` are **not** reusable directly — they are private to `board.ts`, merge ref content with local working-tree plans (row 2 of the board's own merge table), and stage into the board's own temp-dir lifecycle. fleetd wants the ref alone, with no working-tree fallback, so this is new code modeled on that logic rather than a call into it.

Then wire it into the three sites in `packages/fleet/src/server/entry/registryd-main.ts` that currently build `planStoreShell(context)`:

- `worldForRepo` (`:485`), which feeds `planLinesFor` (`:1151-1158`, read once per tick and memoized — keep that memoization, it exists because a per-agent plan walk cost 10–11.5x more, measured).
- `queueWorldForRepo` (`:748`), whose `plans: async () => { ... }` closure (`:760-765`) is the queue's own read.
- `indexMonitorOver` (`:2056`), which feeds `sliceBranchesOf` (`packages/fleet/src/shared/index-monitor.ts:29-37`).

All three take `Pick<PlanStore, 'listPlans' | 'readPlans'>`-shaped values (or the full `PlanStore`) and call only `listPlans`/`readPlans` — swapping the adapter is a construction-site change, not a signature change anywhere downstream.

### Decisions the plan settles — do not re-derive them

- **The board's own `planStoreShell` callers do not move.** `approve.ts:823`, `deliver.ts:644`, `needs-design.ts:344`, `record-pr.ts:182`, `gate.ts:324`, `verify.ts:894`, `plan-for-branch.ts:33`, `board.ts:210`, `estate.ts:84` all read the plan they are about to write or judge, in a checkout — an operator action reading its own working tree is correct, and moving these to the ref would make an approval write to a file the ref hasn't seen yet look like it never happened. Leave every one of these alone.
- **Reading briefs from the ref was already fixed, separately.** `briefPresent` (`registryd-main.ts:768-779`) and `brief_present` (`plot-dispatch.sh:548`) already read `origin/<default>`; this slice is about the *plan list*, not briefs, and does not touch those functions.
- **No fallback to the working tree, ever, on an unreadable ref.** Reasoned above; it is the same substitution the `claimedBranches` comment two lines above the queue's `plans` field already refuses for a different reading, and refusing it is what makes this fix actually fix the bug rather than narrow its window.
- **`refs.defaultBranch()`, never `'main'` literally.** Carried from the plan's Design section; `auto-dispatch.ts:61` is the counter-example to not repeat.
- **One batched `readBlobs` call, not one per file.** The port's own docstring states the 136x measurement; a loop defeats the adapter's whole reason for existing.

### Done when

The plan's `Fleetd Plan Source` slice line is the specification: *"fleetd's queue, supervisor and index monitor read plans from `origin/<default>`; a fixture repo test approves a plan on the remote while the local checkout stays behind and asserts the plan's slices are in fleetd's queue; an unreadable ref queues nothing."* Lift these, each of which a naive implementation would pass without:

- A fixture-repo test (model it on `packages/fleet/test/unit/pr-store-repo.test.ts` for the real-git-fixture shape) that: creates a plan on `origin/<default>` naming a branch under `## Slices`, leaves the **local checkout behind** that commit (never fast-forwarded), and asserts the branch reaches the queue's `plans()` reading anyway (catches: the exact bug measured in Motivation — a plan approved on the host, invisible to a stale local checkout).
- A second test where `origin/<default>` cannot be resolved (detached fixture, or the remote deleted) and asserts the queue reading is an **empty list**, not a thrown error and not a fallback to whatever the working tree holds (catches: a silent substitution that would reintroduce the measured bug under exactly the condition — a stale checkout — where this slice is supposed to help).
- A test with more than one plan file staged in one `listPlans`/`readPlans` round-trip, asserting `readBlobs` (or the host shell it drives) is called **once**, not once per plan (catches: a per-file loop that defeats the 136x batching the port's docstring measures).
- Unit coverage for the new adapter in isolation (sibling to `plan-store-fixture.test.ts`'s style, under `packages/domain/test/`) covering: regular `.md` files only (a symlink-mode blob is excluded), an unreadable ref, and a readable ref with zero plan files (empty list, not an error).

Plus: a changeset (package `plot`, description first and `bumps:` block last — no skill version bump is implied here unless you touch a skill file, which this slice should not need to). Run `./scripts/check-changeset-packages.sh`, and the spawn ratchet *One place reaches a process* (the git reads go through the `Refs` adapter, already constructed as `refs = refsGit(context)` at each of the three sites — no new spawn surface). No new shell script is added, so `scripts/check-shell-lines.sh` charges nothing; if a `.sh` file is touched anyway, that gate applies and growth must be paid for in the same change. Run `node skills/plot/scripts/board/plot-local-checks.mjs` before each push and run what it prints; the suites in `CI suites` run in CI — do not run `test:e2e` locally. Do not commit the rebuilt `board-server.mjs` or any generated bundle (`scripts/check-no-bundle-diff.sh`); this slice should not need to touch board code at all, since `board.ts`'s own ref-reading path is untouched (see Decisions above). A new function you write is an arrow (`packages/domain/src/**` is arrow-only; elsewhere, a function you write or rewrite is an arrow — the scope follows the diff, not the file).

### Bookkeeping

Open the PR with `../plot/scripts/plot-open-pr.sh` (never `gh pr create`), then append `→ #<number>` to this branch's line in the plan's `## Slices` section. Push the first real commit as soon as it exists.

### Scope guard

This branch owns: the new ref-based `PlanStore` adapter under `packages/domain/src/adapters/plan-store/`, its unit tests, the three construction sites in `packages/fleet/src/server/entry/registryd-main.ts` (`worldForRepo`, `queueWorldForRepo`, `indexMonitorOver`), and a fleet fixture-repo test.

`registryd-main.ts` is edited concurrently by other desks in flight (verify current state from their diffs before you start, this list is from wave 1's brief and may be stale by the time you pick this up): `nothing-done-asks-pr-state-only-where-it-decides`, `fleetd-holds-the-pr-index-lock` and `a-bitbucket-listing-reads-every-page` all touch that file and `pr-refresh.ts`. Expect a conflict on construction-site lines near `:485`, `:748`, `:2056` specifically — those are exactly the lines this slice changes. Keep this slice's edits to the `planStoreShell(context)` → new-adapter swap at each site and avoid touching unrelated lines in the same functions, so a conflict resolves as "two edits to the same small region" rather than "two edits to the whole function."

Open question 4 of the plan (`briefAskPrompt` in `brief-ask.ts` using wave 1's worktree booking) is unrelated to this slice and still open — do not resolve it here.

If you find something the plan did not anticipate, report it rather than improvising outside scope.
