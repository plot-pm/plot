## Implementation brief — pr-state-and-pr-merged-miss (wave 1: Branch query)

- **Plan (canonical):** `docs/plans/2026-10-20-pr-state-and-pr-merged-miss.md` on `main`
- **Approved:** 2026-10-20, Jan Wloka, plan-PR #2193 merged
- **Branch:** `bug/pr-state-and-pr-merged-miss` (base: `main`)
- **Ends as:** one PR to `main`, opened with `skills/plot/scripts/plot-open-pr.sh`
- **Review of the code:** per repo convention — the PR is reviewed as code; CI is the authority for e2e

One wave, one branch. Nothing waits on it except release 2.28.0 (publishes only once Plot works on Bitbucket + Jenkins + Jira). The approved plan for #2186 (`plot-pr-merged-sh-asks-gh`) routes `plot-pr-merged.sh` through `plot-host.sh pr-merged`, so `pr_merged` inherits whatever this slice makes `pr-merged` answer.

### What to build

On Bitbucket, a PR merged before the newest 50 merged PRs reads as unmerged. Measured 2026-10-20 on ewz-kus-portal, read-only: the 50-row merged page reached back to 2026-09-30; `feature/ewzkus-3845-contractaccount-bykey-tracer` merged as #3644 on 2026-09-26, and `pr-state` / `pr-merged` read it as `NONE` / `not-merged` while `plot-host.sh pr-list --state merged --branch <that branch>` returned #3644. Delivery, reaping and the merged-branch guards read that false negative.

Four Bitbucket arms in `skills/plot/scripts/plot-host.sh` read a whole-repository page and filter `source.branch.name` locally. At main `617a8da5e`:

- `pr-state` for a branch name (about `:3733-3756`): loops `bb pr list --state <s> --json` over `bb_states_for all` (open, merged, declined) and stops at the first state whose page contains the branch.
- `pr-merged` (about `:3801`): `bb pr list --state merged --json`, `any(.source.branch.name==$b)`.
- `pr-merge-commit` (about `:3873`): same listing, `merge_commit.hash`.
- `pr-merged-heads` (about `:3914`): same listing, `source.commit.hash`.

Replace each listing with the per-branch query that `pr-list --branch` already uses: `bb_branch_query "$ref" <state> <global bb args>` (`:973`), which puts `source.branch.name` inside `q=` so the host filters. It prints the endpoint's `values` array in the same shape as `bb pr list --json`, so the existing jq programs and `bb_state_row` consume it unchanged. Plan is canonical; this is orientation. The numbers above are line hints from today's main, so grep for `pr list --state` before trusting them.

### Decisions the plan settles — do not re-derive them

**Ask the host for the branch; do not page further.** Walking more pages of the repository listing costs up to 18 requests on a repo with 886 merged PRs and still ends at a ceiling (`bb:203` caps at 10 pages, and `pagelen=100` is refused with HTTP 400; see the comment at `:883-897`). The branch query costs one request per asked branch and state, and its page holds only that branch's PRs.

**A page that cannot prove absence answers `unknown`, never `NONE` / `not-merged`.** If the branch query fails for any reason that is not a recognised lookup miss, `pr-merged` answers `unknown` (as its error arm does today) and `pr-state` / `pr-merge-commit` / `pr-merged-heads` exit 3. If the page is full (50 rows) without containing a MERGED row for the branch, the answer is also `unknown`/exit 3: the branch query itself can truncate when one branch carries more than 50 PRs in a state. `not-merged` reads as `none` in `rules/landed.ts`, so `mayRemove` may permit a removal on it; `plot-release-refs.sh` deletes remote refs on that answer.

**Error classification travels untouched.** `bb_branch_query` prints no classification on purpose (header at `:940-972`): the raw stderr and exit code leave the function, and the caller classifies once. Do not wrap it in `pr_list_call` from inside these arms; route the failure through the existing `host_miss_or_fail` / `miss_or_exit3` / `is_lookup_miss` handling each arm already uses. `is_lookup_miss` excludes `command not found` (`:1885`), so an absent `bb` stays `unknown`/exit 3.

**`mergedAt` is the reading on GitHub; Bitbucket's positive word is `state == MERGED`.** The query already carries `state="MERGED"`; keep it. Do not read `DECLINED` as merged.

**The open questions in the plan are yours to answer by measurement, and the PR states the answers:**

1. Does `bb_branch_query` serve `pr-state`? `bb pr list` has no `all` state (comment at `:804`), so `pr-state` needs up to three queries (open, merged, declined). Keep the current stop-at-first-hit order unless a measurement shows the order changes an answer; a branch with an open PR and a merged predecessor must still resolve as the callers expect (`fleet.ts` `prOutranks` ranks them; `bb_state_row` receives one row).
2. Does `pr-state` keep `NONE` for a branch the branch query proves has no PR in any state? Yes if all three queries answered and were not full. A failed query is not `NONE`.
3. Every caller of `pr-merged` and `pr-state`: `plot-dispatch.sh:1021,1758,2044,2055,3027`, `plot-fleet-scan.sh:1364`, `plot-agent-monitor.sh:264`, `plot-pr-state.sh:33`, `plot-reconcile-scan.sh:3361`, `plot-impl-status.sh:320-334`, plus `plot-pr-merged.sh` after #2186. Some wrap `pr-state` as `|| echo '{"state":"NONE"}'` or `|| true` (`plot-impl-status.sh:320`, `plot-dispatch.sh:1021`). A caller that turns exit 3 into `NONE` re-creates the false negative one layer up. List each caller's handling in the PR body; report one that fails safe the wrong way instead of editing it here.

**Rules carried over unchanged.** Absent is not false: a missing answer never prints `NONE` / `not-merged`. Read the exit code, not the emptiness. The numeric `pr-state <number>` arm (`bb pr view`) is unchanged. GitHub arms are unchanged. No `gh` or `bb` call appears outside `plot-host.sh`.

**Cost.** One request per asked branch and state, against one request today. Record the request count per `pr-state` call in the budget log (the connector's rate-limit contract, `CLAUDE.md` *The Layering Rule*) and state the measured count in the PR. A branch with no PR costs three queries; do not cache in this slice.

### Done when

The plan has no `## Done when` list; the slice line is the specification: the four Bitbucket arms ask for the branch itself or answer `unknown`, and tests cover a fixture whose branch merged past the first page. Assertions a naive implementation would pass without:

- **Past-the-first-page fixture:** a stub `bb` (or `bb api`) whose unfiltered `pr list --state merged` page holds 50 other branches' rows and whose `q=`-filtered request returns the target's merged PR. `pr-merged` answers `merged`, `pr-state` answers `MERGED` with that PR's number, `pr-merge-commit` and `pr-merged-heads` print its hashes. Make the stub answer from the request path, not from call order, so the old code (which never sends `source.branch.name` in `q=`) fails the test; otherwise it passes on the old listing.
- **Polarity:** a branch with no PR in any state answers `NONE` / `not-merged` / empty with exit 0, and the stub proves all asked states answered. A routing that maps every answer to `merged` passes the first assertion alone.
- **Silence is not absence:** a failing `bb` (non-miss stderr) answers `unknown` from `pr-merged` and exits 3 from the other three; `bb` absent from `PATH` does the same. A full page with no MERGED row for the branch answers `unknown`/exit 3.
- **Request shape:** the stub records the request path; assert it contains `source.branch.name` and `state` inside one `q=` (the `bb_branch_query` shape), URL-encoded, and exactly one `q=` parameter.
- **Ordering:** a branch with an open PR and an older merged PR still resolves `pr-state` as before the change (open first); a `pr-merged` for it answers `merged`.
- **Existing Bitbucket and GitHub host tests stay green unchanged.** Expect to adapt stubs that answered `bb pr list --state merged --json` for these arms, not the assertions.

Plus: one `.changeset/*.md` (description first, `bumps:` block last; package `plot`, skill `plot` patch). No board artifact changes. Run `node skills/plot/scripts/board/plot-local-checks.mjs` before each push and run what it prints; the suites in the `CI suites` config key run in CI, and a failure there comes back as a correction. Run the whole `test/reconcile/*.test.mjs` glob rather than the files you suspect, with `unset PLOT_REPO_ROOT PLOT_UNATTENDED` first (`host.test.mjs` can stall under load; run the test names you touched alongside it).

`scripts/check-shell-lines.sh` refuses a pull request whose shell under `skills/` is longer than at its merge base. This slice edits `plot-host.sh`: if the four arms share a new helper, delete the four listing blocks it replaces and keep comments short, so the file ends no longer than it began. The gate stores no number and has no override. A header entry for any changed behaviour belongs in the `plot-host.sh` usage block (`:44-76`) and the README row if one changes.

### Bookkeeping

- Push the first real commit as soon as it exists. An empty claim ref is a row with nothing on it.
- Open the PR with `skills/plot/scripts/plot-open-pr.sh` (`--draft` while it moves). Never `gh pr create`.
- When the PR exists, write its number into this slice's heading in the plan's `## Slices` section on `main`: `### Branch query (Branch: bug/pr-state-and-pr-merged-miss, PR: #N)`. The trailing `→ #N` form parses as no PR for a waves plan.
- Read-only verification against the real Bitbucket project (ewz-kus-portal) is welcome — `feature/ewzkus-3845-contractaccount-bykey-tracer` (#3644) is the known past-page branch. Any write there needs Jan's go.

### Scope guard

This branch owns:

- `skills/plot/scripts/plot-host.sh`: the Bitbucket arms of `pr-state`, `pr-merged`, `pr-merge-commit`, `pr-merged-heads`, and a shared helper beside `bb_branch_query` if one is warranted
- `test/reconcile/host.test.mjs` (or a new `test/reconcile/host-bitbucket-branch-query.test.mjs`) — new cases and stubs for these arms only
- one `.changeset/*.md`

Not this branch: `plot-pr-merged.sh` and `scripts/check-host-cli-callers.sh` (`plot-pr-merged-sh-asks-gh`), the `pr-list` arm and `bb_state_listing` (`pr-state-and-pr-list-still` edits the `pr-list` arm for Bitbucket `mergeable`; `pr-state-and-pr-list-never` is a sibling plan), and the callers listed above.

Other branches in flight, verified 2026-10-20 at brief time: `git ls-remote --heads origin` shows no remote branch matching `pr-state-and-pr-merged-miss`. `plot-host.sh` is a large shared file and the two sibling plans above edit it; if one lands first, rebase before touching the shared region.

If you find something the plan did not anticipate, report it rather than improvising outside scope.
