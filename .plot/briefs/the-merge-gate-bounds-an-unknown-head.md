## Implementation brief — open-plot-review-findings-from-the (wave 7: Merge gate)

- **Plan (canonical):** `docs/plans/2026-11-03-open-plot-review-findings-from-the.md` on main
- **Approved:** 2026-11-03, Jan Wloka, plan-PR #3075 merged
- **Branch:** `bug/the-merge-gate-bounds-an-unknown-head` (base: `main`)
- **Ends as:** one PR to main
- **Review of the code:** repo convention (CI green + plot-review)

This wave waited on `feature/pr-review-accepts-a-plot-review`, which merged as #3187 on 2026-11-06. Nothing waits on this wave. Six sibling slices of the same plan run in parallel; none edits `workflows/merge.ts`.

### What to build

Two changes to the merge gate in `packages/domain/src/workflows/merge.ts`, finding #2922.

**1. A person's merge passes an `unknown` default-branch head past `Checks wait`.** Today a head whose runs read `unknown` never settles. `advanceSettled` (`rules/default-branch.ts`) moves `settled` only for `red` or `green` and keeps the old reading otherwise. In `merge()` the tip check then reads `defaultBranch.settled.sha !== tip`, which is true for ever, and every person's merge refuses `default-branch-unsettled` until another push lands. **Fix, in `merge()` only:** where `readings.caller === 'person'`, `defaultBranch.head === 'unknown'`, `tip === defaultBranch.headSha`, and the time since `defaultBranch.headSince` exceeds `input.checksWaitMs`, the tip check passes. The bound writes no `settled`, lifts no `default-branch-red`, and never applies to `fleetd`.

**2. `mergeAt` reads the tip before any PR call.** After fleetd's own merge, each scan until the next PR beat answers `merge` again, and each answer costs two host calls: `prState --with-checks` and `prReview`. **Fix, one layer:** `mergeAt` reads the default-branch reading and `refs.remoteSha` first. When the tip differs from the reading's settled SHA, it returns `default-branch-unsettled` with no `prState` and no `prReview` call. The tip read stays inside `merge()` as well, because `merge()` is the pure rule and is tested alone.

### The decisions the plan settles — do not re-derive them

**No memory keyed by (PR, head).** The plan rejected it: fleet's no-retry memory (`packages/fleet/src/shared/auto-fixer.ts`-side `auto-merge.ts:116`) records only `host-refused`, and a memory keyed by (PR, head) strands a PR on a transient refusal. The `slicePrNext` merge arm and the fleet no-retry memory do not change.

**`review-not-passed` keeps refusing every caller, a person included.** Decided 2026-11-03 (jwloka). `Review required since` already decides adoption; fleetd never honours a `review-bypass:` comment. Add no opt-in key and do not touch `reviewPasses`.

**The bound covers `unknown`, not `pending`.** The existing test `refuses default-branch-unsettled on a pending head past a green settled commit` (`workflows-merge.test.ts:244-248`) stays unchanged on purpose. A `pending` head is a run still going; an `unknown` one has no run to wait for.

**`advanceSettled` does not change.** `packages/domain/test/default-branch.test.ts` stays unchanged on purpose. Writing `settled` from a bound would persist a verdict, which *Answers, never verdicts* in `CLAUDE.md` refuses.

**Absent is not false; a failed read is not an absent one.** Keep every `unaskable` arm as it is. A tip that fails to read refuses `unaskable`, never `default-branch-unsettled` and never a pass.

**A red settled reading still holds.** The bound sits on the tip check, which runs after the `settled.state === 'red'` branch. Do not move it above that branch.

**Accepted side effect of change 2.** A PR that would have refused `pr-not-open` or `checks-not-green` now refuses `default-branch-unsettled` first when the tip moved. Both refuse and nothing merges; only the named reason differs. Do not reorder the pure rule to hide it.

### Done when

The plan's `## Tests` section, *Merge gate tests*, is the specification. All of these in `packages/domain/test/workflows-merge.test.ts`:

- `passes a person's merge past a head that reads unknown longer than Checks wait` — fails on `origin/main` with `default-branch-unsettled`.
- `keeps default-branch-unsettled for fleetd on the same reading` — catches a bound applied to every caller.
- `keeps default-branch-red on a red settled reading whatever the head reads` — catches a bound placed above the red branch.
- `mergeAt` block, `asks the host nothing when the tip differs from the settled SHA` — a counting host fake asserts zero `prState` and `prReview` calls. Without the counter, the test passes on the old code because the refusal reason is the same.
- Add one case at exactly `checksWaitMs` of unknown age: the bound is "longer than", so the equal case still refuses. It catches an off-by-one.

Plus:

- Docs, in the same change: `CLAUDE.md` paragraph *One hold reads a non-terminal answer* (`default-branch-unsettled` for a person), the TSDoc of `merge` and `mergeAt`, then `./scripts/check-agents-md.sh --write`.
- A changeset with the description first and the `bumps:` block last. `./scripts/check-changeset-packages.sh` checks it.
- Tests: run `node skills/plot/scripts/board/plot-local-checks.mjs` before each push and run what it prints. The suites in the `CI suites` key run in CI, and a failure there comes back as a correction. List no full suite. Do not run `test:e2e` locally.
- Shell: this slice should touch no `.sh` file. If it does, `scripts/check-shell-lines.sh` refuses a PR whose shell under `skills/` is longer than at its merge base, so pay for growth in the same change. The gate counts commands, not lines, and has no override.
- New functions are arrows (`export const f = (…) => …`). TSDoc states behaviour and failure, not history.

### Bookkeeping

Open the PR with `skills/plot/scripts/plot-open-pr.sh` (`--draft` while the work moves), never `gh pr create`. When it exists, append `→ #<number>` to this branch's line in the plan's `## Slices` section. Push the first real commit as soon as it exists. Before a hand fix of a pull request, read `inFlight` in `.plot/state/fixer-attempts/<pr>.json`.

### Scope guard

This branch owns `packages/domain/src/workflows/merge.ts`, `packages/domain/test/workflows-merge.test.ts`, the `CLAUDE.md` paragraph named above and its `AGENTS.md` mirror, and one changeset. Open PRs touching `workflows/merge.ts`, `rules/default-branch.ts`, `entities/default-branch.ts` or `workflows-merge.test.ts` at dispatch: none. Sibling slices in the plan: `bug/a-red-main-stays-acted-on` (#3177) edits the same `CLAUDE.md` paragraph for the `bug/revert-<pr>` rule — whichever merges second rebases on the first, and neither changes what `redMainStep` reads. `bug/a-high-gets-its-own-fixer-attempts` edits `slice-pr-next.ts`, not this file.

If you find something the plan did not anticipate, report it rather than improvising outside scope.
