## Implementation brief — a-decision-reads-the-index (wave 1: The index has its first consumer)

- **Plan (canonical):** `docs/plans/2026-09-26-a-decision-reads-the-index.md` on `main`
- **Approved:** 2026-09-26, Jan Wloka, in-session after panel (round 1)
- **Branch:** `infra/the-index-has-its-first-consumer` (base: `main`)
- **Ends as:** one PR to `main`, opened with `skills/plot/scripts/plot-open-pr.sh`
- **Review of the code:** per repo convention — the PR is reviewed as code
- **Issue:** #1008

Wave 1 of 3. `infra/a-decision-reads-rather-than-asks` (wave 2) waits on this branch merging, and its slice picks the second consumer from what this one learns. `docs/the-rule-is-written-down` (wave 3) waits on both. Record what you learn about the store in the PR body, because wave 2 reads it there.

### What to build

`skills/plot/scripts/plot-impl-status.sh` answers *did this plan's PRs merge?* by asking the host: one `plot-host.sh pr-list --state merged --limit 500` (`:170`), then one `pr-state` per branch (`:196`, `:198`, `:210`). Move it to read `PrIndexStore` first. It asks the host only for what the store cannot answer.

The plan is canonical. This brief gives orientation only.

### Facts the plan got wrong or did not measure — verified at dispatch

**The store HAS a reader and a writer. It is the board.** The plan says "five references, zero consumers". Its grep covered `packages/domain` only. `packages/board/src/server/fleet.ts:2537` constructs `prIndexFile()`. `refreshPrs` reads the store to pick its delta window (`prWindowFor`, `:2842`) and writes a `foldPrIndex` result after each call (`:2734`). This shipped in `83c4abdc1` on 2026-09-22, before approval. So this slice is the first **shell** consumer and the first consumer outside the process that writes the store. The slice still stands, but do not repeat "zero consumers" in the PR or changeset.

**The only writer is a running board.** A checkout with no board has no store (`read` → `answered(null)`) or an old one. `plot-impl-status.sh` runs in `/plot-deliver` on machines where no board runs. **The host fallback must stay**, and it must be the path taken whenever the store cannot answer. "Absent" means "ask", never "not merged".

**The live store is not whole.** On this machine, 2026-09-26: `v: 2`, 968 rows, `complete: false`, `at: 2026-09-26T15:13:00Z`. `complete: false` means a missing row is NOT proof that no PR exists (see `rules/pr-index.ts`, the `complete` latch). A branch with no row falls back to the host.

**Rows carry no `mergeCommit` and no `mergedAt`.** The row keys are `number, head, state, draft, checks, review, url, mergeable, failing_checks, author, updatedAt`. Today's output of `plot-impl-status.sh` passes the `pr-state` JSON through, which includes `mergeCommit`. Before you drop the per-branch `pr-state` call, find every reader of `plot-impl-status.sh`'s output and check whether it reads `mergeCommit`. `/plot-release` reads `mergeCommit` from `pr-state` directly (`skills/plot-release/SKILL.md:381`), not from this script. If a reader needs it, keep the `pr-state` call for that field or add the field to the row. Do not emit an empty `mergeCommit` as if the host said so.

**Rows carry no read-against SHA.** The plan's Done-when says "a stale entry is discarded on read, proved by moving the ref it was read against". A row records nothing to compare against. Do not add a schema field to fake it in this slice. See the next section for the reading that makes staleness harmless here.

### Decisions to take as settled

**Trust only terminal answers from the store.** This is the `PLOT_TERMINAL_CACHE` precedent (`plot-fleet-scan.sh:1234`), which the plan adopts whole. A `MERGED` row cannot revert on the host, so it stays true however old it is. An `OPEN`, `CLOSED` or draft row can be stale in either direction, so for those the script asks the host as it does today. The effect is that the delivery gate never rests on a stale non-terminal answer, and the common case (every slice merged, which is the case in which `/plot-deliver` runs) makes zero host calls. Name this in the PR as the answer to the plan's revalidation requirement for this consumer. Wave 2's consumer may need the SHA the row does not carry.

**Read through the domain, not with `jq` over the file.** `docs/shell-and-domain.md`: a script that runs once per operator command calls the domain (measured: a bundle answers in 39 ms). `plot-impl-status.sh` runs once per `/plot-deliver`. The domain owns `decodePrIndex`: version check, and "unparseable or unrecognised is `null`, not failure". A `jq` read re-implements that decoder and drifts from it the first time `PR_INDEX_VERSION` moves. Existing precedent for a small bundle: `board/plot-landed.mjs`, `board/plot-branch-state.mjs`. Build through `pnpm build:board` and commit the artifact.

**Resolve the path from `--git-common-dir`, and honour `PLOT_PR_INDEX_HOME`.** `prIndexFile()` already does both. Calling it from the bundle gets both for free. A desk path (`--show-toplevel`) is the defect `pr-index-file.ts` documents: `plot-reap.sh` deletes desks.

**The host stays behind `plot-host.sh`.** `scripts/check-host-cli-callers.sh` gates this. The bundle reads a local file and calls no host.

**No HTTP, no running board.** Plan, "What this does NOT do". This is the question the slice exists to answer: *can a shell script read the store without a board?*

### One question the plan leaves open — decide it in the PR, do not improvise silently

Rule part 1 says "a tool call writes the index". When `plot-impl-status.sh` falls back to the host, should it fold what it learned into the store (`foldPrIndex`, `complete: false`)? The plan's Done-when "two consumers asking the same question in one pass produce one tool call" needs some consumer to write. But a second writer next to the board introduces a lost-update race: two read-fold-write sequences on one file, and the adapter's `rename` makes each write atomic, not the sequence. Recommended for this slice: **read only, and name the write as wave 2's question** in the PR body. If you write, show the race is harmless (a partial fold only adds rows the other writer would also add) with a test.

### Done when

The plan's `## Done when` list is the specification. This slice owns these parts of it:

- `plot-impl-status.sh` answers a fully merged plan from the store with **zero** `plot-host.sh` calls. Assert it with a host stub that counts calls (`test/reconcile/impl-status-dialects.test.mjs` already stubs `gh`, see `stubGh` at `:48`). This catches an implementation that reads the store and then asks the host anyway.
- **An unreachable host with no store answers nothing, never "merged" or "not merged".** Today's behaviour, kept. Proves that absence stays absence. This catches a fallback that turns a failed read into an empty result that the delivery gate reads as "no PRs".
- **A store row that is `OPEN` for a branch the host reports `MERGED` gives the host's answer.** This catches trusting non-terminal rows.
- **A missing, unparseable or wrong-version store gives exactly today's output.** This catches a decoder that throws instead of answering `null`.
- **The store is found from a linked worktree.** Run the script from a `git worktree add` desk and assert it reads the main checkout's store. This catches `--show-toplevel`.
- Tests set `PLOT_PR_INDEX_HOME` and never touch the operator's own store under `.git/.plot/state/index/`.

Plus the repo gates: `nvm use` (Node 24), `pnpm test`, `pnpm run test:contracts`, `pnpm run test:board` (rebuilds the artifact), `pnpm run typecheck`. Do NOT run `pnpm run test:e2e` locally — CI runs it. Add a changeset (description first, `bumps:` block last). The package is `plot`, and add `'@plot-pm/board': patch` if you add a bundle entry under `packages/board`. Update the `plot-impl-status.sh` row in `CLAUDE.md`'s helper table and, if you add a bundle, add its row.

### Bookkeeping

- The branch is not yet on `origin` (checked 2026-09-26). Claim it before any work: `git push -u origin infra/the-index-has-its-first-consumer`. A rejected push means another session holds it.
- Push the first real commit as soon as it exists.
- Open the PR with `skills/plot/scripts/plot-open-pr.sh` (or `--draft`). Do not run `gh pr create`.
- When the PR exists, change this branch's heading in the plan's `## Slices` to `(Branch: infra/the-index-has-its-first-consumer, PR: #N)`. That is the heading form `plot-plan-meta.sh` parses. A trailing `→ #N` parses as `prs=[]` for heading-form plans.

### Scope guard

This branch owns:

- `skills/plot/scripts/plot-impl-status.sh`
- a new bundle entry under `packages/board/src/server/entry/` (if you take the domain route) and its artifact under `skills/plot/scripts/board/`
- `packages/domain/src/**/pr-index*` — read-only use expected; touch it only if a test proves a gap
- `test/reconcile/impl-status-*.test.mjs` and new tests beside them
- the `CLAUDE.md` helper-table rows named above, the changeset

Not this branch: `plot-fleet-scan.sh` and `plot-reconcile-scan.sh` (wave 2), the CI spawn ratchet at `ci.yml:333` (wave 2 onward), `CLAUDE.md`'s rule text (wave 3), `fleet.ts`'s `refreshPrs` (the board's writer path).

Verified at dispatch, 2026-09-26: no remote branch touches `plot-impl-status.sh`, `impl-status` tests, `pr-index`, `deliverability.ts` or `plot-host.sh`.

**Out of scope, seen in passing:** `plot-host.sh:1773-1780` `gh_rest_repo` echoes the literal `TODO` when `--repo` is absent (`2af68be01`, 2026-08-28). The REST fallback for `pr-state` then builds a path from `TODO`. Do not fix it on this branch. It is reported separately.

If you find something the plan did not anticipate, report it rather than improvising outside scope.
