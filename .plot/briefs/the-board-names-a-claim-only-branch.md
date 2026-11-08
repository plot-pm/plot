## Implementation brief — an-ended-main-repair-episode-leaves (wave 2: Board)

- **Plan (canonical):** `docs/plans/2026-11-08-an-ended-main-repair-episode-leaves.md` on `main`
- **Approved:** 2026-11-08, Jan Wloka, plan-PR #3236 merged
- **Branch:** `bug/the-board-names-a-claim-only-branch` (base: `main`)
- **Ends as:** one PR to `main`, opened with `skills/plot/scripts/plot-open-pr.sh`
- **Review of the code:** per repo convention — the PR is reviewed as code; CI is the authority for e2e

This wave follows wave 1, `bug/an-ended-repair-episode-releases-its-claim`, which merged as #3239 on 2026-11-08. Nothing waits on this branch.

### What to build

Issue #3235: three claim-only branches (`bug/main-repair-fcc797085ba9`, `-e54e5381561a`, `-9c77fff4cc8e`) sat on origin after their episodes ended, and the board's Quiet section read each as `commits, no PR ever opened — abandoned`. Each branch's only commit (`81fcd1fac`, `23e155394`, `52189061e`) is an empty `plot: claim …` marker — measured: `git rev-parse <c>^{tree}` equals `<c>^^{tree}` on all three. The branches are deleted now, so reproduce the failure from those commit shapes, not from the live board.

**The plan's premise is partly stale, so reproduce before you change anything.** The plan says the quiet-kind reading "has no arm for a claim-only branch". That is wrong for a branch the pulse reads as `claimed`: `packages/domain/src/rules/quiet.ts` already has `QuietKind` `orphaned-claim` (note `claimed, no work committed`, placed in `quiet` by operator decision B, 2026-11-03), and `fleet.ts` `claimedReadings` feeds it with `isEmptyClaim: true`. `branchState` answers `claimed` when `commitsAhead > 0` and `realCommitsAhead === 0` (`packages/domain/src/rules/branch-state.ts:308-314`). So the defect is on the path that gives these three branches the `abandoned` word instead. Two candidates, neither verified:

1. **A branch no plan names.** `bug/main-repair-<sha>` is written by the repair episode, and no plan lists it. The pulse walks only branches a plan lists, so such a branch reaches the board through some other path. Find that path first (`fleet.ts` near the planless-PR loop at `:6971` takes OPEN PRs only, so it is not that one — find what does list an unplanned claim-only branch). If that path states `isEmptyClaim: false` or reads the branch as `wip`, that is the defect.
2. **A desk or agent row built from the registry.** The episode leaves a desk as well as the ref. A row built from the desk may pick `wip` where the branch reading says `claimed`.

State which of the two (or a third) you found in the PR body, with the reading that proved it. If the board already names a claim-only branch correctly for every path you can reach, say so in the PR and report it rather than adding a second arm.

Then the plan's change: a branch whose commits beyond the default branch are all empty `plot: claim` markers reads as a claim in Quiet, with the release as its action. The decision lives in the domain beside `empty-claim.ts` / `quiet.ts` as a property a unit test asserts; the component only renders it (CLAUDE.md, *Every rendered state is a domain property*).

### Settled decisions — do not re-derive them

**Reuse the `empty-claim.ts` definition.** A claim marker is titled `plot: claim ` AND changes no file (`isEmptyClaim`, `realCommits`). The subject alone is not evidence: a commit titled `plot: claim handling refactor` that changes a file is real work. Do not write a second definition.

**The release goes through a controller.** `release-claim` already exists: `POST /api/release-claim` (`packages/board/src/server/release-claim.ts`), `plot-ask.mjs release-claim <branch>` for no-board callers, one reader behind both (`packages/fleet/src/shared/release-claim-reader.ts`). The first task is to find how the `orphaned-claim` row reaches it today (`packages/board/src/app/lib/agent-rows/menus.tsx` `offersOpen` and the row menu near `:651`) and reuse that. Never call `plot-dispatch.sh --release` from the component or a new route.

**A claim whose desk still runs a live loop is not a claim on the board.** It reads as a claim once the loop ends. `releaseClaim` refuses a live agent and the script refuses a live worker pid in any case (settled by jwloka, 2026-11-08).

**`/plot-reconcile` section 3 is the reference answer for "claim-only".** If the TypeScript and the shell reading differ on any input, join the pair to the corpus tier at `packages/domain/corpus/` (see `branch-claims.corpus.test.ts` for the nearest existing one). On a disagreement the branch stops; never adjust one side to make the comparison pass.

**Absent is not false.** A branch whose PR fetch never landed reads `prState: 'unknown'`, never `'none'`. `claimedReadings` already takes `hostUnasked` and `fetchPredatesTip`; keep any new path on the same inputs, so an outage does not turn a claim into `abandoned`.

**`abandoned` stays the word for real commits with no PR.** Do not widen `orphaned-claim` to cover a branch with a real commit; `quietKind`'s arm order is evidence order (merge, closed PR, empty claim, unknown host, no PR).

### Done when

The plan's slice line is the specification: a claim-only branch reads as a claim in Quiet, with the release as its action. Plus these assertions, each of which a naive implementation passes without:

- A claim-only branch that **no plan names** reads `orphaned-claim`, not `abandoned`. Catches the case where only the planned path was fixed.
- A branch with one empty claim **and** one file-changing commit titled `plot: claim …` still reads `abandoned`. Catches a subject-only check.
- A claim-only branch read while the PR fetch has not landed reads `quiet` / `unknown`, not `abandoned` and not a claim with a release action. Catches the outage turning absence into evidence.
- The release action for the row calls the existing `release-claim` route, asserted at the route boundary.
- At least one browser test shows the kind word and the release action on the row; the decision itself is asserted in a domain unit test, not the browser.

Plus: run `node skills/plot/scripts/board/plot-local-checks.mjs` before each push and run what it prints; the suites in the `CI suites` config key run in CI, and a failure there comes back as a correction. List no full suite, and do not run `test:e2e` locally. Add a changeset (`plot` or `@plot-pm/board`) with the description first and the `bumps:` block last; do not edit versions by hand. If the served payload changes, the board artifact rebuilds on `main` — commit no bundle (`scripts/check-no-bundle-diff.sh`). `scripts/check-shell-lines.sh` refuses a pull request whose shell under `skills/` is longer than at its merge base: if this slice touches a `.sh` file, remove shell elsewhere or write the rule in the domain and ask it through a bundle. The gate counts commands, not lines; it stores no number and has no override.

### Bookkeeping

Open the PR with `../plot/scripts/plot-open-pr.sh` (never `gh pr create`). When it exists, append `→ #<number>` to this branch's line in the plan's `## Slices` section. Push the first real commit as soon as it exists.

### Scope guard

This branch owns the quiet-kind reading and its row: `packages/domain/src/rules/quiet.ts` and `empty-claim.ts`, `packages/board/src/server/fleet.ts` (the readings constructors only), `packages/board/src/app/lib/agent-rows/`, and their tests. Wave 1 (#3239) owns the episode's release in fleetd (`repair-start.ts` and its caller); do not touch it. `packages/fleet/src/shared/release-claim-reader.ts` is reused, not changed. Other branches in flight were not checked at brief time — run `/plot-pulse` for collisions before editing `fleet.ts`, which is large and shared.

If you find something the plan did not anticipate — including that the board already reads these branches correctly — report it rather than improvising outside scope.
