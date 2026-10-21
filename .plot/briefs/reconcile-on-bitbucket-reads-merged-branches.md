## Implementation brief — reconcile-on-bitbucket-reads-merged-branches (wave 1: Truncation and per-branch ask)

- **Plan (canonical):** `docs/plans/2026-10-21-reconcile-on-bitbucket-reads-merged-branches.md` on main
- **Approved:** 2026-10-21, Jan Wloka, plan-PR #2292 merged
- **Branch:** `bug/reconcile-on-bitbucket-reads-merged-branches` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** PR review through the plot-review app, per repo convention

This is the only branch of the plan. Nothing waits on it.

### What to build

`plot-reconcile-scan.sh` on a Bitbucket repository with more than 50 merged PRs names a merged branch an orphan and prints no truncation note. Observed on ewz-kus-portal (issue #2282): §3 prints `origin/bug/ewzkus-3678-sd-rechnungen-rechnungsliste — ahead of develop, no open PR → orphan`, while `plot-host.sh pr-merged` on that branch answers `merged` (#3623). §20 prints "(none — no remote ref outlives its merged PR)". The newest merged PR is about #3712, so #3623 lies outside Bitbucket's one page of 50.

Two changes, both in the scan, plus whatever signal `plot-host.sh` must add:

1. **A cut-list signal.** `load_merged_pr_heads` (`plot-reconcile-scan.sh` ~699-706) sets `MERGED_PR_TRUNCATED=1` only when the count reaches `MERGED_PR_LIMIT=500`. Bitbucket returns 50, so the flag never sets. The scan also discards `plot-host.sh`'s stderr line "pr-list state=merged possibly truncated" with `2>/dev/null` (~699). The adapter already decides this: `pr_list_report_truncation` (`plot-host.sh` ~2880-3004) applies the shell copy of `rules/listing-page.ts`'s `pagePossiblyTruncated`. Carry that decision to the scan through `plot-host.sh` (a stdout marker or a distinct status). The scan must not call `bb` itself (`scripts/check-host-cli-callers.sh`), and must not re-derive the page length.
2. **A per-branch ask before the orphan verdict.** At the §3 line `ahead of $MAIN, no open PR → orphan` (~1303), when the merged list is cut, call `plot-host.sh pr-merged <branch>` for each branch about to be called an orphan. A `merged` answer reclassifies it as merged. `unknown` or a failed call keeps the orphan line but must not read as proof of absence.

The truncation note in §20 (~2561) and §2 (~1190) then fires on a cut Bitbucket list, because both read `MERGED_PR_TRUNCATED`.

The plan is canonical; this brief is orientation.

### Settled decisions — do not re-derive them

**Ask per branch; do not page the list.** Paging the merged list costs one request per page: 886 merged PRs on ewz-kus-portal is about 18 requests per scan, on the host where the account is the scarce resource (`docs/plans/2026-09-28-a-cold-bitbucket-board-buys-the-whole-list.md`). The per-branch filter (`state="MERGED" AND source.branch.name=…`, `plot-host.sh` `bb_branch_query`) already answers a PR merged before the newest 50 and spends calls only on branches that would be wrongly named. The plan's open questions allow §20 to choose differently, because §20 enumerates merged PRs and cannot ask about refs it never listed; the plan recommends the note for §20, not paging.

**The signal comes from `plot-host.sh`.** The scan has no way to know the page length: `bb_list_page_length` reads it per `bb` version from `BB_LIST_PAGE_VERSIONS`, and a version nobody measured has no length, so every non-empty page stays possibly truncated. Hard-coding 50 in the scan is the second copy of a rule the adapter and `corpus/listing-page.corpus.test.ts` already hold as a pair.

**An absent PR is an exact absence only through the per-branch filter.** `pr-merged` guards "full page, no merged PR" and answers `unknown`. Read the answer word, never the emptiness.

**GitHub is unchanged.** `gh pr list --limit 500` honours the limit, and a page short of its limit proves completeness (measured 2026-10-02, 1064 PRs). The existing `>= MERGED_PR_LIMIT` test stays correct there. A GitHub fixture must show no extra host call and no new note.

**Rules carried over:**
- The index never says no. A missing row in the PR index store proves nothing; the store also lacks the row for #3623.
- `pr-merged` reads the host's `mergedAt`, never ancestry (`## One Answer To "Did This Land"`). Do not add an ancestry shortcut for the orphan decision.
- Truncation is stated, never silent: a check that quietly skipped reads as a check that found nothing.
- A new function you write is an arrow in `.ts`; shell stays shell. `review-bypass.ts` (`--limit`, "merged-PR list hit its limit") and the PR index store on Bitbucket have the same cap — the plan lists this as an open question. Report what you find there; fix it only if the plan's slice needs it.

### Done when

The plan's Slices line is the specification: the scan detects a cut merged list on Bitbucket, prints the truncation note in §20, and asks the host per branch before §3 calls a branch an orphan.

Assertions that exist because a naive implementation would pass without them:
- **The test must fail on `main`.** A stubbed Bitbucket host returns 50 merged rows and, per branch, `merged` for a branch outside them. On `main` §3 prints the orphan line. With the fix §3 prints no orphan line for it and §20 prints the truncation note. A fixture where the branch sits inside the 50 rows passes on both and proves nothing.
- **A 50-row list is cut; a 49-row list is not.** Pin both sides of the page length, so a hard-coded `-ge 50` fails the second.
- **A GitHub fixture makes no per-branch call.** Count the stub's calls.
- **A failed per-branch ask stays an orphan with the note**, not a silent merged.

Plus the repo's gates. Place the contract test in `test/reconcile/`, and name its case in the file the way `scan-index.test.mjs` does. Run `node skills/plot/scripts/board/plot-local-checks.mjs` before each push and run what it prints; the suites in the `CI suites` config key run in CI, and a failure there comes back as a correction. List no full suite. Do not run `pnpm run test:e2e` locally.

`scripts/check-shell-lines.sh` refuses a pull request whose shell under `skills/` is longer than at its merge base. This slice touches `plot-reconcile-scan.sh` and probably `plot-host.sh`, so growth is paid for in the same change: remove shell elsewhere, or write the rule in the domain and ask it through a bundle. The gate stores no number and has no override.

Add a changeset: description first, `bumps:` block last, `plot: patch` and `skills: plot-reconcile: patch` (check the directory name under `skills/` before naming it).

### Bookkeeping

Open the PR with `skills/plot/scripts/plot-open-pr.sh` (`--draft` while the work moves), never `gh pr create`. Append `→ #<number>` to the branch's line in the plan's `## Slices` section when the PR exists. Push the first real commit as soon as it exists.

### Scope guard

This branch owns `skills/plot/scripts/plot-reconcile-scan.sh`, the Bitbucket truncation signal in `skills/plot/scripts/plot-host.sh`, a new contract test in `test/reconcile/`, and the changeset. No other branch of this plan is in flight. Other plans in sprint W42 touch `plot-host.sh` and the reconcile scan (`reconcile-does-not-report-a-plan` edits §1 of the same scan, a different region): rebase, do not merge, and never resolve a `board-server.mjs` conflict by committing a rebuild.

If you find something the plan did not anticipate, report it rather than improvising outside scope.
