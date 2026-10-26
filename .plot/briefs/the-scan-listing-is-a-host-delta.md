## Implementation brief — the-fleet-scan-re-reads-all (wave 2: Listing Delta)

- **Plan (canonical):** `docs/plans/2026-10-26-the-fleet-scan-re-reads-all.md` on `main`
- **Approved:** 2026-10-26, Jan Wloka, plan-PR #2721 merged
- **Branch:** `feature/the-scan-listing-is-a-host-delta` (base: `main`)
- **Ends as:** one PR to `main`, opened with `skills/plot/scripts/plot-open-pr.sh`
- **Review of the code:** per repo convention — the PR is reviewed as code; CI is the authority for e2e

This branch waited on `bug/the-scan-listing-is-priced-in-pages` (wave 1) and `feature/the-tick-reads-merged-prs-as-an-index-delta` (#2716's second branch). **Both are merged** — `scanListingCost`/`listedBranchCount` are live on `main` (`packages/fleet/src/shared/fleet-scan.ts:119,134`), and `packages/domain/src/rules/known-pr.ts` already carries the watermark pattern this slice must reuse (`MERGED_DELTA_OVERLAP_MS`, `mergedSetWindowFor`). Nothing blocks starting. Wave 3 (`bug/the-bitbucket-sweep-asks-open-once`) waits on wave 1 only, not on this branch, and can run concurrently.

### What to build

Today, `scanOnce` (`fleet-scan.ts:372-460`) never fetches the listing itself: it decides *whether* a listing is due (`listingSpend`), then either hands the shell script (`plot-fleet-scan.sh --stream`) an empty `PLOT_PR_LISTING` — so the shell makes its own `pr-list --state open --rich` + `pr-list --state all --limit 3000` calls — or, when not due, hands it the carried listing so the shell spends nothing. On GitHub, replace the shell's own fetch: `scanOnce` reads the listing itself through the host port (`world`'s `Host`), as a full read (`pr-list --state open --rich` + `pr-list --state all`) or a delta (`pr-list --state open --rich` + `pr-list --state all --since <watermark − 60s>` folded over the carried listing), and always hands the shell the result as `PLOT_PR_LISTING` — never empty, on GitHub. Bitbucket is unchanged: the shell keeps making its own sweep, because the sweep needs `TRACKED_BRANCHES`, which only the shell computes per pass.

The shell's existing `carried_listing()` (`plot-fleet-scan.sh:892-930`) already parses `PLOT_PR_LISTING` into the `HOST_STATE_CACHE` and sets `.list-arrived`/`.list-complete` from its rows — that reader does not change. What changes is who fills the value and how often it is a true fetch versus a delta fold.

### Decisions the plan settles — do not re-derive them

**The decision is a pure domain rule, not inline logic in `fleet-scan.ts`.** Add `packages/domain/src/rules/scan-listing.ts` with two functions: one takes the last whole listing (or none), its watermark, when its full read last happened, and now, and answers `full` or `delta` with a `since` stamp; a second folds a full-read or delta-read pair of host responses over the carried listing, or refuses (meaning: make a full read instead). `fleet-scan.ts` calls both and decides nothing itself — no `if` branching on listing age belongs in the fleet package.

**Reuse the watermark arithmetic, do not reimplement it.** `since` is the watermark minus 60 s, in the host's own stamp spelling. `known-pr.ts`'s `mergedSetWindowFor` (lines 109-117) already computes exactly this — same 60 s constant (`MERGED_DELTA_OVERLAP_MS`, line 78), same `Date.parse` + format-back-to-ISO-with-`Z` shape. If that logic is not already its own exported function independent of `MergedSetWindow`'s shape, extract one function both `mergedSetWindowFor` and this plan's rule call — do not write a second copy of the `watermarkMs - MERGED_DELTA_OVERLAP_MS` computation. This is the one piece of arithmetic the plan explicitly says must not duplicate (Design → Rules → "One watermark rule").

**The watermark itself is the listing's own newest `updatedAt`, not a stored field.** Unlike `known-pr.ts`'s PR-index watermark (persisted per row), this slice's watermark is derived fresh each time from the carried listing's rows — the plain GitHub row payload carries `updatedAt` (`plot-host.sh:4734-4738`). No new persisted field; compute it from what's already carried.

**The fold's OPEN/non-OPEN rule mirrors the shell's existing rank, deliberately duplicated.** `prefill_pr_states` (`plot-fleet-scan.sh:1140-1146`) ranks a branch's rows OPEN first, then MERGED, then everything else, keyed by branch. The fold must answer the same question for the same reason the shell does: a reused branch name can carry an older MERGED row and a newer OPEN row, and OPEN must win. Concretely: every carried OPEN row is dropped before folding (the new open call is authoritative for OPEN, exactly as a full read drops the `all` payload's OPEN rows at `plot-fleet-scan.sh:1089`); non-OPEN rows are carried rows plus delta rows, ranked per branch OPEN > MERGED > rest. **This is a declared duplicate and needs a corpus test** (`packages/domain/corpus/`): one full-read payload run through both the new fold and `prefill_pr_states` must produce the same listing lines, same key encoding (`_` → `__`, `/` → `_`). On a disagreement, the branch stops — do not adjust either side to make the comparison pass (CLAUDE.md, *A Shell Script Asks The Domain*).

**The markers are only ever licensed by a whole host listing read in this run — never by the PR index.** `.list-arrived`/`.list-complete` are the dangerous fields: `.list-complete` written from anything short of a true whole-listing answer lets a merged branch with no row read as `open` (motivation section, and the 2026-08-27 incident the shell's own comments cite). Concretely: the folded listing may report `.list-arrived` only when both new host calls (`open` and `all`/delta) answered `ok`; it may report `.list-complete` only when the carried listing already carried it AND both new calls claimed their pages whole (`page complete`, read through `pr-status.ts:57`, sourced from `plot-host.sh:3281`). No slice here reads `.plot/state/index/github.json` or `board/plot-pr-index-lookup.mjs` — this is fleetd's own copy of its own host answers, a different thing from the PR index, and the `v: 4`/`v: 5` store-version questions from #2716/#2717 do not apply to it.

**A refused fold means a full read, and a failed full read means no listing at all — never a fabricated one.** The fold refuses (triggering a full read instead) when: a new call fails or answers `partial`; a call makes no whole-page claim; the watermark is missing, empty, or fails to parse; or a carried OPEN row appears in neither the new open call's rows nor the delta's rows (it may have changed state in a way the delta's `since` window should have caught — treat the gap as doubt, not as "still open"). If the full read also fails, `scanOnce` hands the shell **no** listing (empty `PLOT_PR_LISTING`, as today when nothing was due) and the shell falls back to its own full sweep — the degraded path already exists and this slice does not touch it.

**A full read happens when:** fleetd holds no whole listing yet, the last full read is older than `PR_FULL_READ_MS` (24 h — reuse the existing constant from `pr-refresh.ts:331`, do not invent a second 24-hour constant), or the delta rule refuses for any reason above.

**Carried-over invariants, re-stated because this code re-breaks them easily:** absent is not false (a listing with no rows is a real empty answer only when it carries `.list-arrived`; a value that never arrived must not be read as "no PRs"). Domain-style code in `packages/domain/src/` is arrow functions with factual TSDoc — no decision narrative in the comment, that belongs in the plan and the commit. `scanListingCost` is re-exported by `packages/board/src/server/fleet.ts:123` — if this slice's changes touch its signature or the state shape it reads, re-check that re-export still typechecks.

### Done when

The plan's Slice 2 test list is the specification (plan lines 94-97):

- **Rule:** `full` with no carried listing, a missing/unparseable watermark, or a full read older than 24 h; `delta` with `since` = watermark − 60 s otherwise. Catches the rule defaulting to delta when it has nothing to delta against.
- **Fold:** a reused branch name with an OPEN row from the open call and an older MERGED row keeps OPEN. A carried OPEN row that moved to MERGED appears as MERGED from the delta. A carried OPEN row in neither new answer refuses the fold (forces a full read) — catches silently treating a vanished OPEN row as still-open. A failed or partial delta, or one without a `page complete` claim, refuses the fold. A carried listing without `.list-complete` yields none (a listing that was never whole cannot be made whole by folding).
- **Scan integration:** a listing folded from a delta and handed in as `PLOT_PR_LISTING` gives the same readings as the equivalent fetched listing. A no-ref merged branch that no listing names reads `-` or is asked — never `open` — when the handed listing carries no `.list-complete`. With no listing handed in (full read also failed), the scan makes both calls itself, as today.
- **Corpus:** one full-read payload through the fold and through `prefill_pr_states` gives the same listing lines — the declared-duplicate test described above.

Plus: the CLAUDE.md paragraph (plan lines 112-118, under *A Decision Reads The Index*) — land it next to the paragraph #2716 already added for the merged-set delta; if #2716's and #2386's edits to that section land first, rebase this slice's paragraph onto them rather than reverting their text. Run `./scripts/check-agents-md.sh --write` after editing CLAUDE.md so `AGENTS.md` regenerates, and commit the regenerated file. A changeset for package `plot` with the plan's Changelog line 2 as the description (description first, `bumps:` block last — `./scripts/check-changeset-packages.sh`). Run `node skills/plot/scripts/board/plot-local-checks.mjs` before each push and run what it prints; the suites in the `CI suites` config key run in CI, and a failure there comes back as a correction — do not run a full suite locally, and not `test:e2e`.

**`scripts/check-shell-lines.sh` gates shell growth under `skills/`.** This slice should mostly shrink `plot-fleet-scan.sh`'s own fetch calls on the GitHub arm rather than add to them — if it still grows, pay for it by removing shell elsewhere in the same change, or confirm the net is negative since the shell's own GitHub fetch logic is being replaced by the TypeScript-side read.

### Bookkeeping

Open the PR with `../plot/scripts/plot-open-pr.sh` (`--draft` while the work is still moving); never `gh pr create`. Append `→ #<number>` to this branch's line under `### Listing Delta` in the plan's `## Slices`. Push the first real commit as soon as it exists.

### Scope guard

This branch owns: `packages/domain/src/rules/scan-listing.ts` (new file) and its tests, the corpus test under `packages/domain/corpus/`, the GitHub-arm changes in `scanOnce`/`fleet-scan.ts` that call the new rule and always populate `PLOT_PR_LISTING` on GitHub, the extracted shared watermark function (if not already standalone in `known-pr.ts`), and the CLAUDE.md/AGENTS.md paragraph.

Not this branch: `scanListingCost` and the row-count function (wave 1, merged already), the Bitbucket `settled` state word and sweep trimming (wave 3, `bug/the-bitbucket-sweep-asks-open-once`), and anything in `registryd-main.ts` or the PR-index store (#2716's territory, separate code — already merged, read-only reference here).

If you find something the plan did not anticipate, report it rather than improvising outside scope.
