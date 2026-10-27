## Implementation brief — the-fleet-scan-re-reads-all (wave 3: Bitbucket Settled Sweep)

- **Plan (canonical):** `docs/plans/2026-10-26-the-fleet-scan-re-reads-all.md` on `main`
- **Approved:** 2026-10-26, Jan Wloka, plan-PR #2721 merged
- **Branch:** `bug/the-bitbucket-sweep-asks-open-once` (base: `main`)
- **Ends as:** one PR to `main`, opened with `skills/plot/scripts/plot-open-pr.sh`
- **Review of the code:** per repo convention — the PR is reviewed as code; CI is the authority for e2e

This branch waits on `bug/the-scan-listing-is-priced-in-pages`, which has already landed (PR #2734, merged 2026-10-26) — nothing blocks starting. Wave 2 (`feature/the-scan-listing-is-a-host-delta`) is GitHub-only and does not touch this branch's files.

### What to build

`plot-fleet-scan.sh` makes two `pr-list` calls per listing (`:1047` and `:1063`): `--state open --rich`, then `--state all`. The scan drops the `all` payload's OPEN rows itself (`:1089`) — it only wants the merged/closed answer from the second call. On Bitbucket, `--state all` expands through `bb_states_for all` (`plot-host.sh:2603-2610`) to `open merged declined`, so with `B` tracked branches the second call still sweeps `open` once per branch (`plot-host.sh:4779`) for rows the scan throws away. Today's spend is `4B`: `B` for the first call's open sweep, `3B` for the second call's `all` sweep.

This slice adds a `settled` state word to `pr-list`: on Bitbucket it expands to `merged declined` only (no `open`); on GitHub it stays `--state all`, because GitHub answers `all` in one listing already and the scan drops its OPEN rows regardless. The scan's second call (`plot-fleet-scan.sh:1063`) asks `--state settled` instead of `--state all`. `scanListingCost`'s Bitbucket arm (`fleet-scan.ts:119-122`, landed by wave 1) then matches the real spend: `B` for the open sweep plus `2B` for the settled sweep, `3B` total instead of `4B`. The plan is canonical; this is orientation.

### Decisions the plan settles — do not re-derive them

**`settled` is a new state word, not a rename of `all`.** GitHub's arm must still accept `--state all` elsewhere (it is the normal full listing everywhere else in the codebase); only the scan's second call switches to `settled`. Add `settled` beside `all` in the `--state` vocabulary doc comment at `plot-host.sh:130` and in `bb_states_for`'s case list (`plot-host.sh:2603-2610`) and its `die` message (`:2608`) that enumerates valid words — both must be updated together or an unrecognised `--state settled` falls through to the `die` branch on Bitbucket with a message that no longer lists every accepted word.

**GitHub's `settled` arm is `--state all`, not a new filter.** Do not try to build a true "merged or closed, not open" GitHub query — `gh pr list --state all` already returns everything and the scan already strips OPEN rows at `:1089`. Introducing a GitHub-side filter would duplicate that stripping in two places. Where the GitHub dispatch chooses its `gh pr list --state` argument, map `settled → all` and leave every other state word unchanged.

**Why not one `pr-list --state all --rich` call instead of two?** The plan's Notes considered and rejected this for slice 3: the GitHub arm already splits a rich-all request into the same two requests internally (`plot-host.sh:4538-4556`), so merging the scan's two calls into one saves nothing on GitHub, and the Bitbucket rich arm's cost on terminal (non-open) rows was not measured. Don't revisit this; it was closed in the plan, not left open.

**The slice must remove as many shell lines as it adds** (`### Bookkeeping` below) — `scripts/check-shell-lines.sh` ratchets the shipped shell's line count against its merge base, with no stored baseline and no override. A `settled` case arm plus an updated doc comment and `die` message is a net few lines; trim elsewhere in the same diff (e.g. tighten the `bb_states_for` comment, or fold the doc-comment update into the existing line rather than adding a new one) if the count comes out positive. Run `./scripts/check-shell-lines.sh pr` before pushing to see the number, not just at CI time.

Carried-over rules: absent is not false. Domain-style code (`packages/domain/src/**`) is arrows with factual TSDoc; this slice is shell plus the TypeScript `fleet-scan.ts` cost arm already landed by wave 1, so no new domain code is expected here.

### Done when

The plan's Slice 3 test list is the specification:

- `bb_states_for settled` answers `merged declined`. Catches a case arm that still includes `open` or falls through to `all`'s three states.
- The GitHub arm asks `--state all` for `settled`. Catches a GitHub-side filter that tries to re-derive "settled" instead of reusing the existing `all` + strip-OPEN behavior.
- A settled sweep with every state answered prints the sweep claim (`N of N states answered`). Catches a claim that only counts the Bitbucket states and ignores GitHub's single-call case.
- A settled sweep with one failed state prints no claim, and the scan writes no `.list-complete`. Catches `.list-complete` surviving a partial Bitbucket sweep — the dangerous failure mode the plan names at Motivation: a merged branch misread as `open` gets redispatched.
- An empty tracked branch set prints no sweep claim. Catches a vacuous "N of N" claim where N is 0.
- The open sweep's claim (first call) and the settled sweep's claim (second call) together license `.list-complete`, as the old `all` sweep's single claim did. Catches `.list-complete` keyed off only one of the two calls after the split.

Acceptance (state it in the PR): on a Bitbucket repository with `B` tracked refs, a `ps` sample during a scan shows the second call as `--state settled` (not `--state all`), and its stderr reads `2 of 2 states answered`. The requests per listing fall from `4B` to `3B` — state the before/after `ps` counts, not just the code change.

Plus: a changeset for package `plot` with the plan's Changelog line 3 ("On Bitbucket, the scan's second listing sweeps the `merged` and `declined` states only...") as the description (description first, `bumps:` block last if any; `./scripts/check-changeset-packages.sh`). Run `node skills/plot/scripts/board/plot-local-checks.mjs` before each push and run what it prints; the suites in the `CI suites` key run in CI, and a failure there comes back as a correction. Run no full suite locally, and not `test:e2e`.

### Bookkeeping

Open the PR with `../plot/scripts/plot-open-pr.sh` (`--draft` while the work moves); never `gh pr create`. Append `→ #<number>` to this branch's line under `### Bitbucket Settled Sweep` in the plan's `## Slices`. Push the first real commit as soon as it exists.

### Scope guard

This branch owns: `bb_states_for` and the `--state` vocabulary doc comment in `skills/plot/scripts/plot-host.sh`, the GitHub dispatch's state-word mapping, the scan's second call in `skills/plot/scripts/plot-fleet-scan.sh:1063`, and the sweep-claim tests for a partial failure and an empty branch set.

Not this branch: `scanListingCost`'s pricing formula and the row-count function (wave 1, already merged), the delta-read rule and the carried-listing fold (wave 2, GitHub-only, separate files). In flight elsewhere: #2716 (`an-idle-board-and-fleetd-spend`) touches `registryd-main.ts` and `rules/known-pr.ts` — separate code, shares only the watermark function with wave 2.

If you find something the plan did not anticipate, report it rather than improvising outside scope.
