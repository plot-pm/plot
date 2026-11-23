## Implementation brief — fleet-state-is-read-whole-and-from-one-home (wave 4: Unfound state home)

- **Plan (canonical):** docs/plans/2026-11-21-fleet-state-is-read-whole-and-from-one-home.md on main
- **Approved:** 2026-11-21, Jan Wloka, plan-PR #3609 merged
- **Branch:** `bug/merge-refuses-an-unfound-state-home` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** per repo convention (`Review: pr`, auto-review on)

Waves 1 to 3 have merged (#3624 `StateHome`, #3659 `repairStartAction`, #3666 the re-run bound). This branch builds on wave 1. Wave 5 (`every-state-reader-asks-one-state-home`) waits on this one.

### What to build

A merge or a `repair-pr` run where git cannot name the main checkout reads an empty directory and merges as if no reading existed. Slice 1 made `stateHomeOf` answer `{ unread: true }` there and left a stopgap: `packages/board/src/server/state-home.ts` hands the merge path stores whose reads fail, so `mergeAt` refuses `unaskable`. That word says "a read failed", not "the home was not found", and a person cannot tell the two apart. This branch replaces the stopgap with the named refusal `state-home-unread`.

Build, in this order:

1. `MergeReadings` (`packages/domain/src/workflows/merge.ts`) gains `stateHome: 'read' | 'unaskable'`. `MergeRefusal` gains `'state-home-unread'`. Where it is `'unaskable'`, `merge()` refuses `state-home-unread` for a PR into the default branch and for a PR into a `sprint/*` base, before it reads the default-branch reading. `holdsApply` does not change. The base readings are read by the command too (`baseBranch` and `baseRepair` in `main.ts`), so the refusal guards reads that the command makes.
2. `MergePorts` gains the same answer as a port field. `mergeAt` passes it to `merge()` as `readings.stateHome`. Decide where `mergeAt` checks it: the refusal must come before any store read it would otherwise make, so an unread home costs no host call it does not need. Name the field so slice 5 can reuse it.
3. `nameRepairPrAt` (`packages/domain/src/workflows/repair-pr.ts`) takes the same answer in `NameRepairPrPorts` and refuses `state-home-unread` before it reads the record. Add the word to `NameRepairPrRefusal`.
4. The entries in `packages/board/src/server/entry/main.ts` (`merge`, `release-approve` if it builds the same ports, and `repair-pr`) and `merge-ports.ts` pass `stateHome: 'unaskable'` where `stateHomeFor(opts)` answers `unread`, and `'read'` otherwise.
5. Delete the `// TODO` and the failing stores (`unreadDefaultBranch`, `unreadRepairRecord`) in `packages/board/src/server/state-home.ts` if nothing else needs them. If a caller still needs a store over an unread home, keep it and say which caller in the commit message.

The plan is canonical; this is orientation.

### Settled decisions — do not re-derive

- **A refusal by name, not `unaskable`.** Measured 2026-11-06: an empty `.plot/state` answered `"defaultBranchRead":false` on every worktree merge, and a person read that as "no reading yet". `unaskable` is already the word for a failed host or file read; reusing it for an unfound home hides which fix applies. Rejected: keeping the failing stores and relying on `unaskable`.
- **Refuse into the default branch and into `sprint/*`, and only there.** The merge path reads base readings through the same home. A PR into another base still hits the other refusals as today. `holdsApply` stays as it is; do not widen or narrow it.
- **`stateHome: 'read'` with a `null` reading answers as today.** A missing file in a found home is "no reading", which holds nothing. Only an unfound home refuses. Do not turn a `null` reading into a refusal.
- **The fallback to the input path is the defect.** Do not resolve an unread home by falling back to `repoRoot`. Slice 1 settled this; carry it.
- **Out of scope:** the bridge, heartbeat, `processes-files.ts`, `approve.ts`, `design.ts`, `verify.ts`, `review.ts` and `mainRootOf` (slice 5); fleetd's logging for an unread home (slice 1 did it); any change to `holdsApply`.
- **Carried rules:** absent is not false; a failed read is not an absent reading; read the exit code, not the emptiness.
- **Style:** arrow functions for every function you write. TSDoc states what an export does, its parameters, its return and how it fails, with no history. Reasoning goes in the commit message.

### Done when

The plan's `## Slices` entry and `### Approach › Slice 4` are the specification. The assertions that exist because a naive implementation would pass without them:

- `packages/domain/test/workflows-merge.test.ts`: `stateHome: 'unaskable'` refuses `state-home-unread` into the default branch and into `sprint/x`; `stateHome: 'read'` with a `null` reading answers as today. This catches a refusal that fires for a missing file, or one that skips the `sprint/*` base.
- A `mergeAt` cell proving the refusal comes before the default-branch store read, so a store that throws is never called.
- The entry seam is `PLOT_REPO_ROOT` pointing at a `mkdtempSync` directory outside any repository: `stateHomeAtSync` answers `unread` there with no fixture. `packages/board/test/unit/ask-repair-pr.test.ts` and `ask-merge-from-a-worktree.test.ts` gain one cell each on it, using their captured-ports pattern. Both cells fail today: the entry reads an empty directory and refuses nothing by that name. Confirm each fails before the fix. The cells catch an entry that wires the domain change and forgets the `main.ts` argument.
- `repair-pr` over an unread home answers `{"named":false,"reason":"state-home-unread",...}` and writes nothing.

Plus: add a changeset (description first, `bumps:` block last; package `@plot-pm/board`; add `plot` only if a skill changes). The description names `state-home-unread`. Run `pnpm build:board` only to test locally and commit no bundle (`scripts/check-no-bundle-diff.sh`). Before each push, commit, then run `node skills/plot/scripts/board/plot-local-checks.mjs` and run what it prints. The suites in the `CI suites` config key run in CI; a failure there comes back as a correction. Do not run `test:e2e` locally. This slice touches no `.sh` file, so `scripts/check-shell-lines.sh` needs no payment.

### Bookkeeping

Push the first real commit as soon as it exists. Open the PR with `skills/plot/scripts/plot-open-pr.sh` (`--draft` while the work moves), never `gh pr create`. When the PR exists, append `→ #<number>` to this branch's line in the plan's `## Slices` section.

### Scope guard

This branch owns `packages/domain/src/workflows/merge.ts` and `repair-pr.ts`, `packages/board/src/server/entry/main.ts` and `merge-ports.ts`, `packages/board/src/server/state-home.ts`, and the tests above. Wave 5 changes `main-checkout.ts`, `fleet-state-file.ts`, `fleetd-heartbeat-file.ts`, `approve.ts`, `design.ts`, `verify.ts` and `review.ts`; this branch touches none of them. Open PRs and later waves were not re-checked beyond that: if `git diff origin/main` shows a collision on these files at push time, report it.

If you find something the plan did not anticipate, report it rather than improvising outside scope.
