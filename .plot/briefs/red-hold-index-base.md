## Implementation brief — red-hold-reads-the-pr-base (wave 1: Index base)

- **Plan (canonical):** docs/plans/2026-11-09-red-hold-reads-the-pr-base.md on main
- **Approved:** 2026-11-16, Jan Wloka, plan-PR #3323 merged
- **Branch:** `bug/red-hold-index-base` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** `plot/review` through the PR, as for every slice on this estate

This is the first of four slices and every other one waits on it: `bug/red-hold-reads-the-pr-base` reads `row.base` from the index and merges after this branch.

### What to build

fleetd's merge arm (`mergeArm`, `packages/domain/src/rules/slice-pr-next.ts:354`) cannot tell a pull request into `sprint/x` from one into `main`, so a red `main` holds both. Issue #3322, 2026-11-09: `main` was red on `ca37e53ba` and three reviewed slice PRs into `sprint/desk-probes-and-liveness` (#3313, #3316, #3319) were refused `default-branch-red`; a person merged them on GitHub. `plot-ask.mjs merge` is already fixed (`5b372db9d`). `mergeArm` cannot be fixed yet because the PR index has no base field.

This slice puts the base in the index and nothing else:

- `PrIndexRowSchema` (`packages/domain/src/entities/pr-index.ts`) gains `base: z.string().optional()`. `PR_INDEX_VERSION` goes 6 → 7, because the schema is `.strict()` and a v6 reader would reject a v7 row.
- `storeRow` (`packages/fleet/src/shared/pr-refresh.ts:1087`) copies a non-empty `base` and omits an empty one.
- The three GitHub `pr-list` arms of `plot-host.sh` add `baseRefName` to their `--json` list and emit `base:(.baseRefName // "")`. The Bitbucket arms already emit `base` (`:4970`, `:4976`, `:4981`) and stay as they are.
- The in-process GitHub read gains the same field: the listing fragments in `packages/domain/src/adapters/host/github-pr-listing.ts` and `githubPlainRow`/`githubRichRow` in `packages/domain/src/rules/github-pr-row.ts`.

Nothing reads `base` from the index in this slice. `mergeArm`, `baseBranchRed` and the per-base readings belong to the later slices; do not start them.

### Settled decisions — do not re-derive them

**The version moves, and a v6 store is not migrated.** *A Decision Reads The Index* says a wrong-version store means "ask the host". A v6 store decodes as another version, every consumer asks the host, and the first PR beat after the upgrade does one full read and writes a v7 store. An optional field on a `.strict()` schema without a version bump would let a v6 binary refuse a v7 file as corrupt. Write no migration.

**`base` is optional and an empty base is omitted.** A row with no `base` reads as `''` in `holdsApply`, which keeps the default-branch holds. That is the safe direction: absent is not "default branch" and not "sprint branch", it is "unknown, hold as today". Do not default a missing base to the default branch's name.

**Both GitHub transports change together.** The shell arms and the in-process read are held to each other by `packages/domain/corpus/github-pr-listing.corpus.test.ts` (`a42f4a137`). Adding `base` to one side and not the other fails that corpus; on a disagreement the branch stops and neither side is adjusted to make it pass. `PLOT_HOST_TRANSPORT=shell` is the way back and must still answer the field.

**The per-base readings are not this slice.** The plan rejected deriving the bases from the PR index (needs a read of the index in the beat and a reading per stacked feature base, none of which runs CI on push) in favour of `git ls-remote` over `refs/heads/sprint/*`. This slice only supplies the field `mergeArm` needs.

### Done when

The plan's rows for this slice are the specification:

- `pr-index.test.ts`: a row with `base` round-trips, a v6 store decodes as another version, and `PR_INDEX_VERSION` is 7.
- the `pr-list` contract rows in `test/reconcile/host.test.mjs`: a GitHub `--rich`, `--rich-open` and plain row and a Bitbucket row each carry `base` from the fixture's base branch. A fixture whose base differs from the default branch's name is the one that proves it; a fixture on `main` passes with a hard-coded `main`.
- `github-pr-listing.corpus.test.ts` agrees for the in-process read.
- A `storeRow` row: a PR with no base writes a row with no `base` key, not `base: ''`.

Plus: every test that builds a v6 fixture by literal `v: 6` or relies on the constant is updated (`grep -rn "PR_INDEX_VERSION\|v: 6" packages test`). A version default can hide a stale store fixture, so a fixture that spreads `PR_INDEX_VERSION` proves nothing about the old version; the decode-as-another-version row must use a literal 6.

Plus the repo's gates: a changeset (description first, `bumps:` block last) and `plan: docs/plans/2026-11-09-red-hold-reads-the-pr-base.md` in its comment block. Do not commit the rebuilt board artifact (`check-no-bundle-diff.sh`). Run `node skills/plot/scripts/board/plot-local-checks.mjs` before each push and run what it prints; the suites in the `CI suites` key run in CI and a failure there comes back as a correction. Run no full suite and do not run `test:e2e`.

`scripts/check-shell-lines.sh` refuses a pull request whose shell under `skills/` is longer than at its merge base, and this slice touches `plot-host.sh`. Add `baseRefName` and the `base:` field inside existing lines and pay for any growth in the same change: remove shell elsewhere, or move a rule into the domain and ask it through a bundle. Joining statements with `;` or `&&`, or folding `fi` or `done` onto the previous line, is not a payment. The gate stores no number and has no override.

### Bookkeeping

Open the PR with `skills/plot/scripts/plot-open-pr.sh` (`--draft` while the work moves), never `gh pr create`. When it exists, append `→ #<number>` to this branch's line under `### Index base` in the plan's `## Slices` section. Push the first real commit as soon as it exists.

### Scope guard

This branch owns `packages/domain/src/entities/pr-index.ts`, `packages/fleet/src/shared/pr-refresh.ts` (`storeRow`), the three GitHub `pr-list` arms of `skills/plot/scripts/plot-host.sh`, `packages/domain/src/adapters/host/github-pr-listing.ts`, `packages/domain/src/rules/github-pr-row.ts`, their tests, and the changeset.

In flight on the same plan: `bug/red-hold-reads-the-pr-base`, `bug/red-hold-base-readings` and `bug/red-hold-base-repair`, all later waves. They hold `mergeArm`, `merge.ts`, `rules/default-branch.ts`, `default-branch-refresh.ts` and `registryd-main.ts`; touch none of them. Plans sharing files: `github-reads-in-process` (merged; its corpus is the guard) and `refs-from-files` / `one-cat-file-batch` (local refs readers, no overlap).

If you find something the plan did not anticipate, report it rather than improvising outside scope.
