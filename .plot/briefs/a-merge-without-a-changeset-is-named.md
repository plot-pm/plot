## Implementation brief — a-merge-without-a-changeset-is-named (wave 1: The scan reports a merged branch that carried no changeset)

- **Plan (canonical):** `docs/plans/2026-09-11-a-merge-without-a-changeset-is-named.md` on `main`
- **Approved:** 2026-09-11, Jan Wloka, plan-PR #887 merged
- **Branch:** `feature/a-merge-without-a-changeset-is-named` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** PR review per repo convention

This is the plan's only branch. Nothing waits on it and it waits on nothing — the plan's second `### ` heading ("Three exclusions, each measured rather than assumed") names no branch; it is the specification for this slice, not a second wave. Read it as part of the spec.

### What to build

Add **section 20** to `skills/plot/scripts/plot-reconcile-scan.sh`: a merged branch that shipped code and added no `.changeset/*.md` is named, with its PR number. It goes **below** the `== blocking sections end ==` marker (line 1187) and carries its own footer counter.

The failure it catches is measured: **two merges in one session nearly shipped with no release note.** `scripts/check-changeset-packages.sh` cannot catch this — it validates changesets that *exist*, so a branch carrying none passes it trivially. The missing note is invisible until someone reads the published changelog and finds a feature absent, by which time the tag is cut and cannot be moved.

The plan is canonical; this brief orients and records what is already settled.

### The decisions the plan settles — do not re-derive them

**Read the MERGE COMMIT, never the branch ref.** The first draft used `<base>...<head>`, which needs the branch to still exist. Measured 2026-09-11: **3 remote branches survive on this repository** against hundreds of merges, because `plot-release-refs.sh` deletes merged refs by design. A branch-keyed check answers *no changeset* for almost everything, for the wrong reason.

**This needs NO host call.** The merge commit's two parents hold the whole answer, so `MERGED_PR_LIMIT` does not bound this section and `pr_reliable` does not gate it. Section 18 guards on `pr_reliable` because it asks the host what merged; this one does not, and copying that guard would make the section silent during an outage for no reason. The PR *number* is a nicety lifted from the merge subject (`Merge pull request #N from …`) — when it is absent, name the merge SHA and report anyway.

**Diff from the MERGE BASE, not from `^1`.** The plan writes `git diff --name-only --diff-filter=A <merge>^1 <merge>^2`. That form is correct for the changeset question but **wrong for the shipped-code question**, and re-measuring it on 2026-09-11 is what exposed this:

```
base=$(git merge-base "$m^1" "$m^2")
changesets=$(git diff --name-only --diff-filter=A "$base" "$m^2" | grep -c '^\.changeset/.*\.md$')
code=$(git diff --name-only "$base" "$m^2" | grep -cE '^(packages/[^/]+/src/|skills/)')
```

`<merge>^1 <merge>^2` diffs the two **tips**, so it reports everything the branches diverged by *in both directions*. A branch that sat unmerged while `main` advanced shows main's own commits as if the branch added them. Measured: the `^1 ^2` form reports #854 as touching `packages/domain/src/entities/budget.ts` — it did not, `main` did. Five `idea/*` merges are false findings under `^1 ^2` and **zero** under the merge base.

**Keep all four exclusions anyway, and know that two are no longer load-bearing.** Measured over the last 40 merges:

| form | findings |
|---|---|
| `^1 ^2`, code-touch filter only | 9 |
| merge base, code-touch filter only | 2 (both `changeset-release/*`) |
| merge base + all four exclusions | **0** |

The merge base alone drops every `idea/*` residual, so that exclusion and the first-parent one stop firing. Keep them: they cost one `case` each, they document intent, and an adopting repository with different merge habits may still need them. But correctness rests on the merge base — do not drop it in favour of the name lists.

**It reports and never refuses.** A merge with no changeset is legitimate and common: a docs fix, a test-only change, a revert, a build-artifact rebuild. A gate refusing them fires constantly on honest work, which is the shape people turn off. Same call `a-merged-pr-carried-work` made, for the same reason — what is missing is the *decision*, not the outcome.

**Squash merges are out of scope and the section says so.** A squash has one parent, so there is no merged side to diff. This repository uses merge commits (verified 2026-09-11). Print the limitation rather than reporting every squashed merge as missing a changeset.

**Rules carried over from the sections around it** — these are invariants this estate keeps re-learning:

- **A section that cannot evaluate says so; it never prints nothing.** Section 18's `(not evaluated — …)` is the pattern. Silence reads as *nothing drifted*, which is the one direction a drift report must never be lenient in.
- **The section states its window.** What bounds this is how far back the scan walks `git log --merges` — a local choice with no rate limit behind it. Say the number in the heading or the body rather than implying completeness.
- **A footer key is not optional.** A section printing findings with no `key=N` in the `summary:` line is invisible to every machine reader.

### Done when

The plan's `## Done when` list is the specification. Lifting the assertions that exist *because a naive implementation would pass without them*:

- **A merged branch that ADDED a changeset is silent.** Without this, a section that greps for the string `.changeset` anywhere in the diff passes its happy-path test and reports every release PR forever. `--diff-filter=A` is what makes it *added on the merged side* rather than *mentioned*.
- **The four exclusions hold**, including *a merge whose first parent is not on the default branch's history* — this drops `Merge remote-tracking branch 'origin/main' into <branch>`, a rebase-style merge INTO a feature branch. Those are not deliveries. Across a 150-merge window most of the 7 raw findings were exactly this shape.
- **The count is 0 over the last 40 merges on this estate.** Re-run the measurement after implementing; a non-zero count means an exclusion is wrong, not that the estate is unhealthy. This is the assertion that separates a signal from a second `sprint_drift=57`.
- **The section sits below `== blocking sections end ==`** and stays OUT of `attention=`, so `/plot-deliver`'s gate does not read it.
- Add a case to `test/reconcile/scan.test.mjs`, which plants one known finding per section and asserts each section reports exactly its own. Its `splitSections()` helper keys on `== N. …` headings, so a section-scoped assertion is available — use it. Note the sibling `test/reconcile/changeset-link-count.test.mjs` for changeset-adjacent test shape.

Plus the repo gates: `nvm use` first (Node 24 — **pnpm crashes on Node 26**), then `pnpm test`, `pnpm run test:contracts`. **Do not run `pnpm run test:e2e`** — it is CI's gate, it dispatches real workers into sandbox repos, and running it locally starves the machine. Add a changeset (`plot: patch`, with a `bumps:` block naming `plot`) — a slice about missing changesets that ships without one is the joke that writes itself.

### Bookkeeping

Open the PR through the controller:

```bash
skills/plot/scripts/plot-open-pr.sh          # or --draft while work is moving
```

**Do not run `gh pr create`** — it takes the title from the last commit subject, which on this estate is routinely `plot: build the board artifact`. `plot-open-pr.sh` takes the title from the wave heading the plan names this branch under.

When the PR exists, append `→ #<number>` to this branch's line in the plan's `## Branches` section. Push the first real commit as soon as it exists.

### Scope guard

This branch owns **`skills/plot/scripts/plot-reconcile-scan.sh`** (the new section 20 plus its footer key) and **`test/reconcile/scan.test.mjs`** (its test case), plus a changeset file and the `CLAUDE.md` scan-script row if you extend it.

Verified at dispatch, not guessed: **no other branch is in flight on this repository** — `git ls-remote --heads origin` shows the ref does not yet exist, and 3 remote branches survive in total. The scan script is untouched on `origin/main` since the plan was approved. There is no collision to predict.

Do not renumber existing sections and do not move the blocking marker. The scan has been renumbered twice, and each time the agreement with `/plot-deliver`'s gate held because somebody noticed — a new advisory section goes below the line and no consumer reads a number.

If you find something the plan did not anticipate, report it rather than improvising outside scope.
