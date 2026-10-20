## Implementation brief — plot-pr-merged-sh-asks-gh (wave 1: Route the lookups)

- **Plan (canonical):** `docs/plans/2026-10-20-plot-pr-merged-sh-asks-gh.md` on `main`
- **Approved:** 2026-10-20, Jan Wloka, plan-PR #2189 merged
- **Branch:** `bug/plot-pr-merged-sh-asks-gh` (base: `main`)
- **Ends as:** one PR to `main`, opened with `skills/plot/scripts/plot-open-pr.sh`
- **Review of the code:** per repo convention — the PR is reviewed as code; CI is the authority for e2e

One wave, one branch. Nothing waits on it except release 2.28.0, which publishes only once Plot works on Bitbucket + Jenkins + Jira.

### What to build

On a Bitbucket remote `pr_merged` returns 1 for every branch. Measured 2026-10-20 on ewz-kus-portal (base `develop`): `pr_merged infra/EWZKUS-3885-hotfix-tagging` returned rc 1 and `_plot_merged_lookup` printed `unaskable`, while `plot-host.sh pr-merged` on the same branch answered `merged` (#3705). The cause is `gh pr list` in `_plot_merged_lookup` and `_plot_open_lookup` (`skills/plot/scripts/plot-pr-merged.sh`): `gh` fails on Bitbucket, so `plot-landed.mjs` reads `unaskable` and answers `unknown`. Four callers see it: `plot-release-refs.sh:213/216`, `plot-dispatch.sh:3834`, `plot-quiet-stretch.sh:151`, `plot-reap.sh`.

Both lookups keep their three-word output (`found` / `none` / `unaskable`) and ask through `plot-host.sh` instead. Delete the `plot-pr-merged.sh` exemption and its comment block from `scripts/check-host-cli-callers.sh`, and rewrite the long "WHY THIS STILL ASKS `gh`" header in `plot-pr-merged.sh` to state the current behaviour. The plan is canonical; this is orientation.

### Decisions the plan settles — do not re-derive them

**The merged lookup maps the adapter's three words, and the mapping is not symmetric.** `merged` → `found`, `not-merged` → `none`, `unknown` or any non-zero exit → `unaskable`. The 2026-09-06 blocker is already fixed: `is_lookup_miss` (`plot-host.sh:1885`) excludes `command not found`, so an absent CLI answers `unknown`, pinned by `host: an absent CLI answers unknown, never not-merged` (`host.test.mjs`, around `:6170`). `not-merged` reads as `none` in `rules/landed.ts`, and `mayRemove` may then permit a removal. Because `plot-release-refs.sh` deletes remote refs on that answer, never map an empty or unparsed output to `none`.

**The open lookup cannot use `pr-state`.** `pr-state` answers about the newest PR only and reports a failed lookup as the same `state:"NONE"` as a real absence. It expresses neither "any open PR" nor "unaskable". Route the open lookup through `pr-list --state open`.

**The two lookups move together.** `pr_open` can only keep a ref, and that is safe only because `pr_merged` refuses on the same silence (`mayRemove`, nine combinations, one of which permits removal). Routing one lookup and leaving the other on `gh` separates two answers whose safety is a property of the pair.

**What I read in `plot-host.sh` (main at `81c303e35`) that bears on the plan's open questions — verify each before building on it:**

- `pr-list --branch <b>` does not filter rows on GitHub. The flag collects `$branches`, the GitHub arm forwards it to its own recursive call and never filters on it, and the Bitbucket arm uses it to sweep the REST endpoint once per branch per state (`bb_branch_sweep`, `:1035`). So a caller must filter rows by `.head == $branch` itself, and on GitHub `pr-list --state open` lists the repository, capped at 30 by `gh` unless `--limit` is given. A truncated list that omits the branch's PR would read as `none`, which releases `pr_open`'s veto. Either ask with an explicit `--limit` and treat a truncation report on stderr (`pr_list_report_truncation`) as `unaskable`, or add a branch-keyed op beside `pr-merged` (a capability, not routing; its header, `host.test.mjs` and the README row move with it). Decide by measurement and state which in the PR.
- `pr-merged` on Bitbucket lists `bb pr list --state merged` and matches `source.branch.name` locally. Its `--state merged` listing has the same page-size question; check whether it truncates silently.
- The plan asks whether Bitbucket `pr-list` separates a failed call from an empty result. The sweep and `pr_list_call` report failures on stderr and exit non-zero; confirm with a stub `bb` that fails, and assert the lookup answers `unaskable`.
- `plot-host.sh` costs about +450 ms per call over a direct `gh` call (measured 2026-09-06, 4.75 s against 9.25 s for ten calls). Across the 48 branches the fleet scan walks, that is about 21 s. The plan accepts it; do not cache to avoid it inside this slice.

**Rules carried over unchanged.** An empty branch is refused BEFORE any host call and answers `unaskable`, not `none` (`host.test.mjs` `plot-pr-merged: an empty branch refuses, and gh is never asked`). `mergedAt` is read, never `state`. The question is "any PR", never "the newest". `plot-host.sh` is the one place that talks to the host CLI; no new `gh` or `bb` call appears in `plot-pr-merged.sh`.

### Done when

The plan has no `## Done when` list; the slice line is the specification: both lookups route through `plot-host.sh`, the gate exemption is deleted, and a Bitbucket test with a stub `bb` and no `gh` on `PATH` proves a merged branch reads as merged. The assertions a naive implementation would pass without:

- **Bitbucket arm, no `gh` on `PATH`:** `pr_merged <branch>` returns 0 for a branch whose merged PR the stub `bb` lists. This is the measured failure shape. Build `PATH` so `gh` is absent, not stubbed to fail, otherwise the test passes on the old code through a different path.
- **Polarity:** a branch with no merged PR returns 1 and `_plot_merged_lookup` prints `none`. A routing that maps everything to `found` passes the first assertion alone.
- **Silence is not `none`:** a failing `bb` (non-miss stderr) and an absent `bb` each print `unaskable` from both lookups and make `pr_open` return 1 with `pr_merged` also 1.
- **Open lookup:** an open PR on the branch prints `found`; an open PR on another branch only prints `none`; a list that omits the PR because of truncation prints `unaskable`. The second case is what a missing head filter fails.
- **The existing GitHub tests stay green unchanged** (`makePrMergedStub` at `host.test.mjs:7896`). They stub `gh` with `gh pr list` rows; once the lookups route through `plot-host.sh` the stub must also answer whatever `plot-host.sh` calls, so expect to adapt the stub, not the assertions.
- **Gate:** `scripts/check-host-cli-callers.sh` passes with the exemption deleted. The two tests pinning the exemption (around `host.test.mjs:6128`) change with it; keep `an absent CLI answers unknown, never not-merged` and `pr-merged reports an unrecognised failure as unknown` as the pair's safety proof.

Plus: one `.changeset/*.md` (description first, `bumps:` block last; package `plot`, skill `plot` patch). No board artifact changes. Run `node skills/plot/scripts/board/plot-local-checks.mjs` before each push and run what it prints; the suites in the `CI suites` config key run in CI, and a failure there comes back as a correction. Run the whole `test/reconcile/*.test.mjs` glob rather than the files you suspect, with `unset PLOT_REPO_ROOT PLOT_UNATTENDED` first.

`scripts/check-shell-lines.sh` refuses a pull request whose shell under `skills/` is longer than at its merge base. This slice deletes the two `gh` calls and a roughly 100-line header block, so it shrinks; keep the new header short so it stays shorter than the old one. The gate stores no number and has no override.

### Bookkeeping

- Push the first real commit as soon as it exists. An empty claim ref is a row with nothing on it.
- Open the PR with `skills/plot/scripts/plot-open-pr.sh` (`--draft` while it moves). Never `gh pr create`.
- When the PR exists, write its number into this slice's heading in the plan's `## Slices` section on `main`: `### Route the lookups (Branch: bug/plot-pr-merged-sh-asks-gh, PR: #N)`. The trailing `→ #N` form parses as no PR for a waves plan.
- Read-only verification against the real Bitbucket project (ewz-kus-portal) is welcome; any write there needs Jan's go.

### Scope guard

This branch owns:

- `skills/plot/scripts/plot-pr-merged.sh`
- `scripts/check-host-cli-callers.sh`
- `test/reconcile/host.test.mjs` — the exemption tests and new `plot-pr-merged` cases only
- `skills/plot/scripts/plot-host.sh`, only if the open-lookup measurement above forces a new op, with its header entry and `skills/plot/scripts/README.md` row
- one `.changeset/*.md`

Not this branch: the four callers (`plot-reap.sh`, `plot-release-refs.sh`, `plot-dispatch.sh`, `plot-quiet-stretch.sh`), `rules/landed.ts` and `board/plot-landed.mjs`, and the other host-routing plans (`2026-10-18-bitbucket-jenkins-pr-list-binds-a`, `2026-10-16-bitbucket-parity-and-app-identities`) which share the subject but not the script.

Other branches in flight, verified 2026-10-20 at brief time: `git ls-remote --heads origin` shows no remote branch matching `pr-merged` or `host`. `plot-host.sh` is a large shared file and `pr-state-and-pr-list-still` (approved 2026-10-20, Bitbucket `mergeable` from a local merge-tree) will edit its `pr-list` arm; if it lands first, rebase before touching `pr-list`.

If you find something the plan did not anticipate, report it rather than improvising outside scope.
