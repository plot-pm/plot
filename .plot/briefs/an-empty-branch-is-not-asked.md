## Implementation brief — an-empty-branch-never-reads-as-merged (slice 1: an empty branch is not asked)

- **Plan (canonical):** `docs/plans/2026-10-01-an-empty-branch-never-reads-as-merged.md` on main
- **Approved:** 2026-10-02, jwloka, in-session
- **Branch:** `bug/an-empty-branch-is-not-asked` (base: `main`)
- **Ends as:** one PR to main, opened with `skills/plot/scripts/plot-open-pr.sh`
- **Review of the code:** the repo's PR review; the plan's `Review:` is `in-session`

Slice 2, `bug/the-two-merge-lookups-agree`, waits on this branch: its empty-branch corpus case fails until this guard lands. Do not build the corpus test here.

### What to build

`pr_merged ""` exits 0, which means *merged*. Measured 2026-10-01 on `origin/main` (`56a978ea`):

```
$ bash -c 'source skills/plot/scripts/plot-pr-merged.sh; _plot_merged_lookup ""; pr_merged ""; echo $?'
found
0
$ bash -c 'source skills/plot/scripts/plot-pr-merged.sh; pr_merged_heads "" | wc -l'
98
```

`gh pr list --head ""` applies no filter, so every PR in the repository matches. The fix is one guard at the top of each of three functions in `skills/plot/scripts/plot-pr-merged.sh`, before `command -v gh`:

- `_plot_merged_lookup` and `_plot_open_lookup` answer `unaskable` for an empty branch.
- `pr_merged_heads` returns 1 and prints nothing for an empty branch.

Nothing else in that file changes except its header comment (see Done when). The latent risk is that every current caller guards the empty branch at its own call site (`plot-reap.sh`, `plot-release-refs.sh`, `plot-quiet-stretch.sh`, `plot-dispatch.sh`). A fifth caller that omits the guard gets *merged*, and `plot-release-refs.sh` deletes remote refs on that answer. The plan is canonical; this brief is orientation.

### Settled decisions — do not re-derive them

**Empty is `unaskable`, not `none`.** `rules/landed.ts` defines `unaskable` as *the lookup did not run, or did not answer*. A lookup that refuses an empty branch did not run. `none` claims the host spoke and found nothing, and `mayRemove` reads `none` as permission. `pr_merged` already reads the resulting `unknown` as a refusal, so no change reaches `board/plot-landed.mjs` or the rule.

**The guard sits in the three lookups, one per function, not one per caller.** Five call-site guards exist today, and they are the reason the defect stayed latent. Do not add or remove any caller guard; they stay.

**`pr_open ""` returns 1 and that is safe.** `pr_open` vetoes, so 1 releases the veto. The safety comes from `pr_merged ""` refusing on the same branch, which `mayRemove` asserts. Do not make `pr_open` return 0 for empty to be "conservative": a veto on an empty branch would block nothing real and would contradict the plan.

**The guard comes before `command -v gh`.** The stub `gh` must see no call at all for an empty branch. A guard placed after the `gh` call fails the test below.

**The stub must reproduce the defect, not a stub's idea of it.** The `makeStubs` helper in `test/reconcile/host.test.mjs` (`:57`) writes a `gh` that ignores its arguments and answers the same JSON to every call, as the real `gh` does for `--head ""`. It writes its argv to `gh.argv` on each call, so a missing file means no call. Give it one merged PR and one open PR in the same listing.

**Carried over unchanged from `plot-pr-merged.sh`:**

- Silence is never permission: an unreachable host, an unauthed `gh` and a missing CLI all answer *not merged* to every caller.
- Read `mergedAt`, never `state` and never ancestry. A merged PR reports `CLOSED`, and squash-merge leaves a branch ahead of main forever.
- Read the exit code, not the emptiness: `pr_merged_heads` exit 1 means *cannot ask* and exit 0 with no output means *asked, nothing merged*. The empty-branch guard returns 1, and `plot-reap.sh` reads that as `unknown` and keeps the desk.

### Done when

The plan's `## Slices` list for this branch is the specification. The assertions that exist because a naive implementation would pass without them:

- **The stub `gh` records no call for any of the three.** A guard placed after `command -v gh`, or one that returns `none` after a `gh` call, passes the return-value checks and fails this.
- **A non-empty branch with a merged PR still makes `pr_merged` return 0.** A guard written as `[ -z "$1" ] || ...` with a wrong polarity, or one that refuses everything, passes the empty-branch checks and fails this.
- **The test fails when the guard is removed from any one of the three functions.** Prove it by deleting each guard in turn and watching the matching assertion fail, then restore with `git checkout` from a committed baseline (commit or stage first: `git checkout -- <file>` discards unstaged work).
- **`pr_merged_heads ""` prints nothing and returns 1.** Check stdout and exit code separately.
- The header comment of `plot-pr-merged.sh` names the guard and the reason in one paragraph, in the file's own style (prose, one paragraph).

Plus the repo gates: add the test to `test/reconcile/host.test.mjs`; run `pnpm test` and `pnpm run test:contracts` under Node 24 (`nvm use`; pnpm crashes on 26); add a changeset (see Bookkeeping). Do not run `pnpm run test:e2e` locally; CI owns it.

### Bookkeeping

- Changeset in `.changeset/an-empty-branch-is-not-asked.md`, description first, `bumps:` block last, with the `plan:` line:

  ```
  ---
  'plot': patch
  ---

  <description with the measurement: 98 lines for `pr_merged_heads ""` on 2026-10-01>

  <!--
  plan: docs/plans/2026-10-01-an-empty-branch-never-reads-as-merged.md
  bumps:
    skills:
      plot: patch
  -->
  ```

  `.changeset/` holds siblings' files; add your own and touch none. Run `./scripts/check-changeset-packages.sh`.
- Push the first real commit as soon as it exists.
- Open the PR with `../plot/scripts/plot-open-pr.sh` (add `--draft` while work moves). Do not run `gh pr create`.
- When the PR exists, append `→ #<number>` to this branch's line in the plan's `## Slices` section.

### Scope guard

This branch owns `skills/plot/scripts/plot-pr-merged.sh`, its test in `test/reconcile/host.test.mjs`, and one changeset.

Not this branch's: the corpus test and the `docs/shell-and-domain.md` amendment (slice 2, `bug/the-two-merge-lookups-agree`, which waits on this one); the Bitbucket divergence, where `_plot_merged_lookup` asks `gh` on every backend (the plan's second open question, a separate issue if the reviewer agrees); any change to `rules/landed.ts`, `board/plot-landed.mjs` or `plot-host.sh`.

In flight, checked against every remote branch on 2026-10-02: no branch changes `plot-pr-merged.sh`. One branch, `bug/a-delta-keeps-the-store-whole`, adds 69 lines to `test/reconcile/host.test.mjs`. Append your tests at the end of the file so the two merges stay a trivial textual conflict, and rebase onto main before you open the PR. If you find something the plan did not anticipate, report it rather than improvising outside scope.
