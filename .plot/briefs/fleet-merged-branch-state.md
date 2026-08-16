## Implementation brief — fleet-sees-merged-branches, single branch

- **Plan (canonical):** `docs/plans/2026-08-16-fleet-sees-merged-branches.md` on `main`
- **Approved:** 2026-08-16, jwloka, plan-PR #126 merged (four rounds of interrogation)
- **Branch:** `bug/fleet-merged-branch-state` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** PR review per repo convention; CI `validate` must pass
- **Concurrency:** runs beside `feature/update-board-test`
  (`plot-reconcile-scan.sh` + `scan.test.mjs`) and `bug/board-shows-discovery`
  (`packages/board/**`). Stay inside `skills/plot/scripts/plot-fleet-scan.sh`
  and `test/reconcile/fleet.test.mjs`. Do **not** touch the board package or
  rebuild its artifact.

### What to build

`branch_state()` opens with one question:

```sh
if ! git show-ref -q --verify "refs/remotes/origin/$br"; then
  echo "open"; return
fi
```

Absence carries two meanings and the script silently picks one: a branch that
never existed and a branch merged-then-deleted are the same missing ref, and
both report `open`, which the wave arithmetic reads as *outstanding*.

Read the plan in full — it is long because four rounds of measurement are in
it, and two of those rounds **removed** mechanisms that looked right. Do not
reintroduce them.

Add one question before the `open` answer: *did this branch land on the default
branch?* A hit returns `merged`, which is already the state that settles a
wave — the arithmetic does not change and no new state is introduced.

### The mechanism, and the two that were tested away

Candidates are what is **reachable** from the default branch, matched by an
anchored subject:

```sh
subjects=$(git log "origin/$MAIN" --merges --max-count="$MERGE_SCAN_LIMIT" --pretty=%s)
# per branch:
printf '%s\n' "$subjects" | grep -qE "^Merge pull request #[0-9]+ from [^/]+/$br$"
```

**Do not add a first-parent filter.** Round 1 adopted one on the strength of
"119 merges → 109 on the chain, all 11 backward merges gone"; round 2 measured
it against the right baseline and found `reachable+anchored 108` =
`first-parent+anchored 108` — it catches *nothing* extra, because backward
merges open `Merge remote-tracking branch` and cannot match the anchored
pattern anyway. And it breaks GitFlow: a feature merged into `develop`, where
`develop` later merges to `main`, is not on `main`'s first-parent chain and
would read `open` while its work is an ancestor of main.

**Do not add a second-parent counter-check.** Tested: PR merges and backward
merges both have a distinct second-parent tip, so it discriminates nothing and
would pass on all eleven traps.

### Cost — read the history once per run

`branch_state()` is called per branch and the board polls every 5 s. A `git
log` inside that loop re-walks the whole history per branch: O(history ×
branches) where O(history + branches) is available. Measured on a 2000-merge
fixture with 14 branches: **197 ms per-branch vs 79 ms bundled**.

`MERGE_SCAN_LIMIT=2000`, and **saturation must be reported** — a blind cap was
tested and at `--max-count=300` against 2000 merges an early merge is not found
and reads `open`, recreating this plan's own bug. The footer gains
`merge_detect=pr-merge|truncated|none`; `truncated` is a distinct value because
a capped walk detected, but not exhaustively.

### Ordering — the ref check stays in front

A branch name can be reused: merge `bug/flaky`, delete it, recreate it for a
second attempt, and the first attempt's merge subject is still on main —
stale evidence. Today this is correct **by placement**: the lookup belongs in
the no-ref arm, and a recreated branch has a ref, so it never reaches the
lookup. Hoisting the merge check to the top of `branch_state()` — a natural
tidying move — would report in-flight work as `merged`. Pin the ordering with a
test.

### Done when

- A merged-and-deleted branch reports `merged` and its wave reports `complete`.
  Demonstrate against this repo's real state, not by reading the code.
- **`plot-dispatch.sh --dry-run board-reads-git` reports `dispatched=0`** where
  it reports `dispatched=2` today. The end-to-end proof, in the consumer's
  terms.
- A backward merge (`Merge remote-tracking branch 'origin/main' into X`) is not
  accepted as evidence that X merged. Build the real shape; this fails
  silently and is the most important assertion here.
- A GitFlow feature (merged into `develop`, `develop` later merged into the
  default branch) reads `merged`. Without this test the first-parent filter
  comes back — the "119 → 109" number is persuasive and wrong.
- A PR merged into a branch that was then abandoned does **not** read as
  merged — the mirror case, and what makes reachability safe.
- The default branch is honoured: run against a fixture whose default branch is
  `develop`, with no `main` present.
- A reused branch name does not inherit the old merge's verdict (reads `wip`).
- The history is read **once per run** regardless of branch count — count the
  `git log` invocations; timing cannot catch this in a small fixture.
- A saturated walk is reported, never silent.
- `pnpm run test:reconcile` and `pnpm run validate` pass.
- A changeset is present.
- macOS ships bash 3.2: no `declare -A`, no bash-4-only constructs.
- **Assert per line, not with whole-output regexes** — this suite has been
  fooled three times by patterns matching across report lines or the footer.

### Bookkeeping

When the PR is created, append `→ #<number>` to this branch's line in the
plan's `## Branches` section on `main`.

### Scope guard

One function, one file, plus its tests. If you find something the plan did not
anticipate, report it rather than improvising outside scope.
