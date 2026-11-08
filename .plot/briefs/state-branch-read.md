## Implementation brief — state-branch (wave 2: Read)

- **Plan (canonical):** `docs/plans/2026-11-07-state-branch.md` on `main`
- **Approved:** 2026-11-08, jwloka, in-session
- **Branch:** `feature/state-branch-read` (base: `main`)
- **Ends as:** one PR to `main`, opened with `skills/plot/scripts/plot-open-pr.sh`
- **Review of the code:** per repo convention — the PR is reviewed as code; CI is the authority for e2e

The Write slice merged as #3234: the `State branch` key, the write target (`packages/domain/src/rules/write-target.ts`) and `plot-state-cut.mjs` exist on `main`. This branch builds on them. `feature/state-branch-sync` waits for this branch to merge.

### What to build

Where `## Plot Config` declares `State branch`, lifecycle records live on that ref, and every reader that resolves `origin/<default>` for plans misses them. Measured 2026-11-07: dispatch refuses a plan with no Approved record at `gate_ref` (`plot-dispatch.sh:2688`, `gate_ref="origin/$MAIN"`), the reconcile scan reads a plan's phase at `origin/<default>` (`plot-reconcile-scan.sh:1223`, `phase_at_main_ref`), and the board lists plans from `origin/<default>` (`fleet.ts:1598-1599`, `:1817`). A record that landed on the state ref stalls all three.

The Read slice delivers:

1. **`recordRef`** (D17), a domain rule in `packages/domain/src/rules/`: it answers which ref holds a plan's records. The state ref where the key is declared and the ref exists on the origin, else the default branch. Take the key resolution from `write-target.ts`; do not re-parse the key.
2. **The union listing (D2).** The plan paths at the state ref and at the default branch; where both hold a path, the state ref's blob wins; a path only the default branch holds is read from there. A reader never merges and never pushes.
3. **Every plan reader goes through it:** the board's plan list, `phase_at_main_ref` and the working-tree reads of the reconcile scan, `gate_ref` and the brief read of dispatch, and `/plot-pulse`.
4. **The board's lag line (D5).** One phase per plan, read through the rule. One line on the plan page and the Delivery tab says how many commits the records are ahead of the default branch and names the open sync PR where one exists. The Sync slice opens that PR, so the line must read "none" without failing.
5. **The reconcile section for a removed key (D9).** A branch at the default name `plot/state` that is ahead of the default branch while no key is declared, with the fix in order: merge the sync PR, then remove the key. The board shows the same finding as a row.

The plan is canonical; this is orientation.

### Decisions the plan settles — do not re-derive them

**The state ref wins per path (D2), and no reader merges.** Every write merged the default branch in first, so the state blob equals the default blob plus records until the default branch moves again. A "newest commit wins" or three-way read re-derives a merge the writers already did, and a reader that merges is a second writer.

**The name is `recordRef` (D17).** `PlanRef` (`plan-reference.ts:139`) means a reference from text to a plan, and the board already logs `planSource` for the ref it reads plans from. Reuse neither.

**Absent is not false.** A missing key, a state ref that does not exist on the origin, and a failed `ls-remote` all read as "the default branch holds the records". None reads as "no plans". Read the exit code, not the emptiness (measured 2026-08-27: an empty result read as no PRs and refused four merged plans).

**No key, no change.** A repository that declares no key must read byte-identically to today. Prove it with a test that runs each converted reader with no key.

**Records, not verdicts, move.** Do not persist a "which ref" answer in `.plot/state/`; derive it per read from the refs. A cached answer goes stale the moment either ref moves.

**The domain decides, the view shows (CLAUDE.md, "Every rendered state is a domain property").** The lag line's wording and the removed-key finding are domain properties, unit-tested without a browser; one browser test proves the line shows.

**Shell asks the domain (`docs/shell-and-domain.md`).** The scan and dispatch run per agent per pass. Ask `recordRef` through a bundle, as `plot-pr-index-lookup.mjs` does; a duplicated rule in shell joins the corpus tier (`packages/domain/corpus/`) and pays in `check-shell-lines.sh`.

### Done when

The plan has no `## Done when` section; the slice line is the specification. Treat each clause as a requirement. Then lift the assertions a naive implementation passes without:

- A plan whose Approved record sits only on the state ref dispatches, lists on the board with phase Approved, and reads Approved in the scan. This catches a reader converted in two of three places.
- The same plan with the state ref absent from the origin reads from the default branch, and the three readers answer as before. This catches "absent means empty".
- A path present at both refs takes the state ref's blob. This catches a union that prefers the default branch.
- A repository with no key reads identically to today.
- The lag line reads "0 ahead" when the refs are equal and "none" for the sync PR while Sync is unbuilt.

Plus the repo gates. Run `node skills/plot/scripts/board/plot-local-checks.mjs` before each push and run what it prints; the suites in the `CI suites` key run in CI. Run no full suite and no `test:e2e`. The board bundle is generated: commit no `board-server.mjs` diff (`check-no-bundle-diff.sh`). `scripts/check-shell-lines.sh` refuses a PR whose shell under `skills/` is longer than at its merge base: where this slice touches a `.sh` file, remove shell elsewhere or write the rule in the domain and ask it through a bundle. The gate counts commands, not lines, and has no override. Add a changeset with the description first and the `bumps:` block last.

### Bookkeeping

Open the PR with `plot-open-pr.sh` (never `gh pr create`), then append `→ #<number>` to this branch's line under `### Read` in the plan's `## Slices`. Push the first real commit as soon as it exists.

### Scope guard

This branch owns the readers named above and the new domain rule, its tests and the reconcile section. It does not own the writers (`plot-push-main.sh`, `plot-state-cut.mjs`, `write-target.ts`: Write, merged), the forward sync, the sync PR, the path gate or the squash (Sync), or the `plot-init` and `plot-board-setup` proposals (Setup). `feature/state-branch-sync` and `feature/state-branch-setup` are not started. If a reader needs the sync PR's number, read it as absent and leave the field for Sync.

If you find something the plan did not anticipate, report it rather than improvising outside scope.
