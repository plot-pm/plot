## Implementation brief — a-merged-pr-is-not-asked-for-its-checks (wave 1: The rollup is asked of open PRs only)

- **Plan (canonical):** `docs/plans/2026-09-25-a-merged-pr-is-not-asked-for-its-checks.md` on `main`
- **Approved:** 2026-09-25, Jan Wloka, in-session after two panel rounds
- **Branch:** `bug/the-rollup-is-asked-of-open-prs-only` (base: `main`) — claimed 2026-09-25 by ref push at `6753b2403`
- **Ends as:** one PR to `main`, opened with `skills/plot/scripts/plot-open-pr.sh`
- **Review of the code:** PR review per repo convention; CI is the authority

This is the plan's only slice. Nothing waits on it, and it waits on nothing.

### What to build

`prefill_pr_states` in `skills/plot/scripts/plot-fleet-scan.sh` makes one host call at `:747`: `plot-host.sh pr-list --state all --limit "$PR_LIST_LIMIT" --rich --branch …`. `--rich` adds `statusCheckRollup` for all 957 PRs on this estate. 954 of them are MERGED or CLOSED, and their checks cannot change. Measured on 2026-09-25 through `plot-host.sh`, the way the scan calls it, this one call takes **~37 s of a ~55 s scan**. Two boards wedged that day because the server's scan refreshes overlapped.

Replace the call with two `plot-host.sh pr-list` invocations that use existing flags only:

1. `--state open --rich` (with `--limit`) — the ~3 PRs whose rollup is still live.
2. `--state all --limit "$PR_LIST_LIMIT"` with the `--branch` arguments and **without** `--rich` — every PR's `number`, `head`, `state` and `mergedAt`.

Concatenate the results into `host_list_out` so that the existing parser reads one payload. The plan is canonical. This brief is orientation only.

### Decisions the plan settles — do not re-derive them

**Remove OPEN rows from the plain payload before you concatenate. Changing the concatenation order does not fix this.** The dedup at `:877-917` ranks rows OPEN=1, MERGED=2, other=3, then runs `sort -k5,5 -k1,1`. An OPEN-rich row and an OPEN-plain row for the same branch have the same rank. `sort` then falls back to a whole-line compare, and the plain row's `-` sentinel sorts before any lowercase check word (`-` is 0x2D). The plain row wins in **both** concatenation orders, the cache stores an empty `checks`, and `--loose` degrades to strict for 100% of open PRs. The design juror measured this. When the plain call carries no OPEN rows, each branch contributes one row and the dedup has nothing to decide. Filter by the `"state":"OPEN"` field of each JSON line: `plot-host.sh` emits one object per line, and the parser at `:895-896` already anchors on that adjacency.

**`HOST_VERDICT` is the worse of the two results, not the last one.** Today one `rc` drives the `case` that follows `:748` (exit 5 = rate limit, 3 = other, 7 = partial). With two calls, a failed `open` call followed by a successful `all` call must not report `ok`. A failed `all` call must not be hidden by a successful `open` call, because it carries `mergedAt`, which is what delivery reads. Write one test per arm.

**Guard the ordinary non-zero exit, not exit 7.** `pr_list_states` is reached only from the Bitbucket arm (`plot-host.sh:3766`), and `:611` says that GitHub *"can never reach this shape"*. The failure that must compose across two calls is a plain non-zero exit on GitHub. Keep the exit-7 partial path working as it does today, but do not treat it as the safeguard.

**Keep `--limit` on the `all` call.** `:615` gives the reason: without it the host returns 30 PRs, and a truncated list reads as *branch has no PR*. Put `--limit` on the `open` call too.

**Keep the empty-`TRACKED_BRANCHES` rule.** `:743`: an empty set passes no `--branch` argument. The `--branch` arguments belong on the `all` call. The `open` call does not need them on GitHub, and passing them does no harm on Bitbucket. Choose one approach and state it in the comment.

**Delete the sentence at `:716-721` that says the rollup is free** (*"the cost is zero on GitHub (same GraphQL call)"*). Three measurements refute it, and this sentence is what let the cost ship. Replace it with the current behaviour and the measured figures: ~37 s before against the after figure you measure.

**Do not touch `packages/board/src/server/fleet.ts:2830`.** The board makes its own `pr-list --rich --state all` call on purpose. Its PR index stores `checks` for every state (`:2534`, `:2886`). The call looks the same, but narrowing it breaks the store.

**Do not optimise git.** ~63 git invocations cost ~1.7 s, 3% of the scan. Plan parsing is already batched (#486) and costs ~0.5 s. The unattributed ~13 s is an open question in the plan, not in the scope of this slice.

### Done when

The plan's `## Done when` list is the specification. These are the assertions that a naive implementation passes without:

- **A STATE-AWARE stub.** The shims in `test/reconcile/fleet.test.mjs` (`:4350`, `:4620` and similar) ignore `--state` and return rich rows for every call. With those shims, a build that lost every rollup still passes. The new stub returns rich rows only for `--state open` and plain rows only for `--state all`, including OPEN rows in the plain answer, the way GitHub answers. Without the OPEN rows in the plain answer, the dedup defect cannot appear in a test.
- **An open PR still carries its rollup after the merge.** Assert this on the parsed cache line (`STATE<TAB>checks<TAB>draft`), not on the call shape. A call-shape test passes against the sentinel-wins defect.
- **A contract test on the call shape.** The `all` call does not carry `--rich`, and the `open` call does. Record the calls through the shim's `PLOT_TEST_CALLS` log, as the existing tests do.
- **`HOST_VERDICT` per arm:** open fails and all succeeds, open succeeds and all fails, both fail. Each case degrades the verdict, and a success does not hide a failure.
- **A merged PR keeps `mergedAt`, `state` and `head`** in the cache after the change.
- **Measure before and after** on this estate, through `plot-host.sh` with the scan's arguments, and put the figures in the PR body. The expected result is that the `pr-list` component falls from ~20–37 s to a few seconds.
- **The scan's reported output does not change:** the same branches, verdicts and footer counts. Compare a `--json` scan on this estate before and after.

Repo gates: `nvm use` (Node 24), `pnpm test`, `pnpm run test:contracts`, and the fleet suite `test/reconcile/fleet.test.mjs`, which needs a ten-minute timeout. Do not run `test:e2e` locally. Add a changeset for `'plot': patch` with the description first, the `plan:` line in the trailing comment, and a `bumps:` entry `plot: patch`. The plan's `## Changelog` line is the description.

### Bookkeeping

- Push the first real commit as soon as it exists.
- Open the PR with `skills/plot/scripts/plot-open-pr.sh` (use `--draft` while the work is still moving). **Do not run `gh pr create`.**
- When the PR exists, append `, PR: #<number>` inside the wave heading in the plan's `## Slices` section on `main`: `(Branch: bug/the-rollup-is-asked-of-open-prs-only, PR: #N)`. This plan uses the heading form, and a trailing `→ #N` parses as `prs=[]`.

### Scope guard

This branch owns `skills/plot/scripts/plot-fleet-scan.sh` (`prefill_pr_states` and its comments), `test/reconcile/fleet.test.mjs` (the new state-aware tests), and one `.changeset/*.md`.

Other work in flight at the time of dispatch (2026-09-25):

- **#993 `feature/a-row-says-whose-it-is`** edits `skills/plot/scripts/plot-host.sh` at `:3624-3798` (the pr-list/Bitbucket region). This slice needs no change in `plot-host.sh`. If you think it does, stop and report.
- **#991 `bug/the-readers-agree-about-an-item`** does not touch any of the files above.

If you find something the plan did not expect, report it. Do not improvise outside this scope.
