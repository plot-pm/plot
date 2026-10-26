## Implementation brief — bitbucket-and-github-listings-read-one (wave: GitHub open lookup)

- **Plan (canonical):** docs/plans/2026-10-24-bitbucket-and-github-listings-read-one.md on main
- **Approved:** 2026-10-24, Jan Wloka, plan-PR #2522 merged
- **Branch:** `bug/github-open-lookup-asks-per-branch` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** per repo convention (plot-review gate on main)

This branch is the plan's second wave. The first wave, "Bitbucket paging", already merged as PR #2573 (`bug/bitbucket-listings-follow-next`) — this branch does not depend on its code, only shares the same plan file. A third wave, "Stubs and plan" (`bug/bitbucket-stubs-and-listing-plan`), still waits and is not blocked by this one.

### What to build

`_plot_open_lookup` in `skills/plot/scripts/plot-pr-merged.sh:140` asks `plot-host.sh pr-list --state open --branch "$br" --limit 100` and then greps the JSON for `"head":"$br"` among up to 100 rows. On Bitbucket this is a real per-branch sweep — `plot-host.sh`'s Bitbucket arm hits the REST endpoint once per named branch (`skills/plot/scripts/plot-host.sh:4684`). On GitHub it is not: `--branch` is parsed into the `branches` variable (`plot-host.sh:4339`) and threaded through to recursive `pr-list` calls only inside the `--rich-open` combined-read branch (`:4432`, `:4439`) — the plain `gh pr list --state open --limit 100` call that `_plot_open_lookup` actually triggers (`plot-host.sh:4537` is the Jenkins arm; the plain non-Jenkins GitHub arm is the sibling block right below it) never filters on `headRefName` or passes `--search head:<branch>`. It lists the repository's open PRs, capped at 100, full stop.

So on GitHub, a repository with more than 100 open PRs can have an open PR for branch X sit on page 2, and `_plot_open_lookup` reads `possibly truncated` → `unaskable` for every branch whenever the repo-wide open count exceeds 100 — not just for X. Below 100 it works by accident (every open PR fits in the one page), which is why this has not been seen failing yet on this repository. The worse failure is silent: a truncation that lands exactly so that the single page omits branch X's own open PR reads `none` instead of `found`, and `plot-release-refs.sh` deletes a ref with a live PR on it.

Make `_plot_open_lookup` ask per branch on GitHub the way the Bitbucket arm already does — one `pr-list --state open --branch <br>` call whose answer is genuinely about that branch, not a slice of a repo-wide page. The plan's approach (step 3) leaves the choice of mechanism open: either make the plain (non-`--rich-open`) GitHub `pr-list` arm honor `--branch` by appending `--search head:<branch>` the way `--since` already appends `updated:>$since` (`plot-host.sh:4368`), or call the per-branch path some other way. Measure the GitHub REST/GraphQL rate-limit cost of asking per-branch before committing to it — the plan's own open question says so (see below) — because `plot-release-refs.sh` may call this once per candidate-for-deletion branch, and turning one list call into N search calls changes `host`'s connector budget for every caller of `pr-list --state open`, not just this one.

### Decisions already settled — do not re-derive them

**The defect is real and already measured in the plan**, not a hypothesis to re-verify from scratch: `_plot_open_lookup`'s `--branch` flag is accepted syntactically and silently dropped for GitHub's plain arm. Grep `plot-host.sh` for `branches` (not `--branch`) to see every place it is actually consumed — only the two `--rich-open` recursive calls at `:4432` and `:4439` pass it onward, and `_plot_open_lookup` never asks `--rich-open`.

**Stderr goes to a `mktemp` path, not a predictable `/tmp` one.** `_plot_open_lookup`'s current `err="${TMPDIR:-/tmp}/plot-pr-open-err.$$.$RANDOM"` (`plot-pr-merged.sh:141`) is a predictable, PID-guessable path in a shared temp directory — exactly the shape this estate's own conventions avoid elsewhere (see `plot_tmpfile` usage throughout `plot-host.sh`, e.g. `:4559`). Replace it with `mktemp` output. This is a one-line, low-risk fix independent of the per-branch mechanism change — do it regardless of which mechanism you pick for the main fix.

**The file header lies about what it calls, and the lie is specific.** `plot-pr-merged.sh:49-56`'s header comment already documents the *intended* per-branch narrowing on Bitbucket and separately notes the GitHub arm "does not filter rows by head itself" — meaning the header already half-admits the gap this brief closes. Once the fix lands, update the comment block (`:45-68`) to state plainly that GitHub now asks per-branch too, rather than leaving the asymmetry described as a Bitbucket-only property with GitHub quietly falling back to the row-match workaround.

**The `pr-state` usage header promise (plan Motivation, 4th bullet) is a different file.** `plot-host.sh:53`'s exit-3-on-full-page-without-a-match promise belongs to the `pr-state` op, not `_plot_open_lookup` — don't conflate the two while reading the plan's motivation section; this slice's job is `_plot_open_lookup` and the header/stderr-path cleanup on it, not `pr-state`'s own guard (that was wave 1's scope, folded into `pr-merged-heads`/`pr-review`, already merged).

**Mutation risk:** `pr_open`'s whole safety argument (`plot-pr-merged.sh:176-185`) rests on failing toward `unaskable` → refuse-to-delete on any doubt. Whatever mechanism you choose, preserve that: a per-branch GitHub ask that errors, times out, or can't prove its page complete must still answer `unaskable`, never `none`. The `mayRemove` rule (bundled via `board/plot-landed.mjs`) already asserts this pairing across all nine reading combinations — do not weaken it, and do not bypass `_plot_landed`.

### Done when

The plan's `## Done when` is not written as a numbered list in this plan file — follow the Design section's step 3 and the Slices entry verbatim: *"`_plot_open_lookup` asks per branch on GitHub, as the Bitbucket arm does, so a repository with more than 100 open PRs cannot make the answer `unaskable` for a branch that has one. It writes stderr to a `mktemp` file, and the header describes the calls the file makes."*

Concretely, that means:
- A test (in `test/reconcile/host.test.mjs` or wherever `_plot_open_lookup`/`plot-pr-merged.sh` is already covered) proving a GitHub repo with >100 total open PRs still answers `found` for a branch whose own open PR would have fallen off a single repo-wide page under the old behavior.
- `_plot_open_lookup`'s stderr path no longer predictable/PID-based.
- The header comment (`plot-pr-merged.sh:45-68`) states accurately, for both backends, what is asked and how.
- `pr_merged`/`pr_open`'s existing callers (`plot-reap.sh`, `plot-release-refs.sh`, `plot-dispatch.sh`, `plot-quiet-stretch.sh`) are untouched — this is adapter-internal.

Plus: run `node skills/plot/scripts/board/plot-local-checks.mjs` before each push and run what it prints — it resolves which tests, typechecks, and `scripts/check-*.sh` gates apply to the files you touched. The `CI suites` config key (`pnpm run test:e2e`, `test:contracts`, `test:board`, domain vitest+coverage, `test/reconcile/*.test.mjs`) runs in CI on the PR; do not run the full suites locally, especially not `test:e2e` (see CLAUDE.md Testing section — it dispatches real workers and is CI's job, not a local one).

Name `scripts/check-shell-lines.sh` explicitly: it refuses a PR whose shell under `skills/` grows past its merge base. This slice touches `.sh` files (`plot-pr-merged.sh`, possibly `plot-host.sh`). If the fix adds lines net, remove an equal number elsewhere in the same change, or push the logic into the domain behind a bundle instead. The gate stores no number and grants no exemption.

### Bookkeeping

Open the PR through the controller, not `gh pr create`:

```bash
skills/plot/scripts/plot-open-pr.sh          # current branch
skills/plot/scripts/plot-open-pr.sh --draft  # while work is still moving
```

It reads the plan, titles the PR from this wave's heading, and refuses a branch no plan names or one a PR already carries. Push the first real commit as soon as it exists — don't wait for the whole fix before the branch shows activity.

When the PR exists, append `→ #<number>` to this branch's line in the plan's `## Slices` section, under the "GitHub open lookup" heading:

```
- `bug/github-open-lookup-asks-per-branch` — `_plot_open_lookup` asks per branch, writes stderr to `mktemp`, and the file header describes its calls. <!-- builds: _plot_open_lookup per-branch ask --> → #<number>
```

### Scope guard

This slice owns: `skills/plot/scripts/plot-pr-merged.sh` (the `_plot_open_lookup` function and its header comment), and whatever narrow addition to `skills/plot/scripts/plot-host.sh`'s `pr-list` op the chosen mechanism needs (e.g., honoring `--branch` in the plain GitHub arm via `--search head:<branch>`). It does not own `pr-state`'s exit-3 guard, the Bitbucket paging logic (wave 1, already merged), or the test-stub/plan-amendment work (wave 3, `bug/bitbucket-stubs-and-listing-plan`).

Other branches in this plan: `bug/bitbucket-listings-follow-next` is merged (PR #2573) — no live conflict risk. `bug/bitbucket-stubs-and-listing-plan` has not started as of this writing; it touches `test/reconcile/host.test.mjs`'s Bitbucket stubs and the separate plan file `docs/plans/2026-10-23-plot-host-bitbucket-pr-list-reads.md`, not `plot-pr-merged.sh` or `plot-host.sh`'s `pr-list` GitHub arm — low collision risk, but re-check `/plot-pulse` before merging if it has started by then.

If you find something the plan did not anticipate — e.g. the per-branch ask proves too costly against GitHub's rate limit, or `--search head:<branch>` behaves unexpectedly for branches with special characters — report it rather than improvising outside scope. The plan's own Open Questions section already flags the rate-limit measurement as unresolved; settle it with a real measurement (count of `pr-list` calls `plot-release-refs.sh` makes per run, before and after) rather than a guess.
