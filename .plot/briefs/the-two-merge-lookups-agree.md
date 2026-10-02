## Implementation brief — an-empty-branch-never-reads-as-merged (slice 2: the two merge lookups agree)

- **Plan (canonical):** `docs/plans/2026-10-01-an-empty-branch-never-reads-as-merged.md` on main
- **Approved:** 2026-10-02, jwloka, in-session
- **Branch:** `bug/the-two-merge-lookups-agree` (base: `main`)
- **Ends as:** one PR to main, opened with `skills/plot/scripts/plot-open-pr.sh`
- **Review of the code:** the repo's PR review; the plan's `Review:` is `in-session`

Slice 1, `bug/an-empty-branch-is-not-asked`, merged as #1182 (`cedad874`). This slice has no wait left, and the guard it tests is on main.

### What to build

Two lookups answer *did the host merge a PR for this branch*, and no test holds them together. The shell lookup is `_plot_merged_lookup` behind `pr_merged` (`skills/plot/scripts/plot-pr-merged.sh`), which asks `gh` directly. The TypeScript lookup is `hostShell(context).prMerged` (`packages/domain/src/adapters/host/host-shell.ts:309`), which runs `plot-host.sh pr-merged <branch>` (`plot-host.sh:3545`). The empty-branch defect (`pr_merged ""` exited 0 while the adapter refused) was a disagreement between these two, and it stayed latent because nothing compared them.

Build `packages/domain/corpus/pr-merged.corpus.test.ts`: a BUILT corpus run against one stub `gh` on `PATH`, one verdict per side, compared case by case. Then amend `docs/shell-and-domain.md`: line 9 names `rules/reapable.ts` and `rules/queue.ts` as `plot-pr-merged.sh`'s duplicate, which is out of date, so it names the lookup pair and the corpus file; add a short section for this comparison in the style of "The first comparison".

The model is `packages/domain/corpus/listing-page.corpus.test.ts`: stub CLIs written into a `mkdtempSync` sandbox, `PATH` prefixed, `PLOT_HOST=github` and `PLOT_BUDGET_OFF=1` in the env, `describingAs({ left: 'adapter', right: 'shell' })`, `compareField` into a `Disagreement[]`, one `expect(found.map(report)).toEqual([])`. The plan is canonical; this brief is orientation.

### Settled decisions — do not re-derive them

**The verdict is one boolean: may a caller treat this branch as merged.** The shell's verdict is `pr_merged`'s exit code 0, run by sourcing `plot-pr-merged.sh` in `bash -c`, as `sourcedPrMerged` does in `test/reconcile/host.test.mjs:5945-6030`. The adapter's verdict is an `ok` result whose value is `merged`. A failed result, `not-merged` and `unknown` all refuse, the way `registryd-main.ts:414-425` maps them. Do not compare the three-valued answer: the shell has no `not-merged`/`unknown` distinction at exit-code level, and a comparison of unequal vocabularies can only pass by translation.

**Not a rule comparison.** The decision already moved into `rules/landed.ts`, and the shell reaches it through `board/plot-landed.mjs`, so the rule cannot disagree with itself. The duplicate is the LOOKUP. The issue's comment and the #1073 plan (`2026-09-29-a-question-nobody-asked-has-its-own-word.md:130`) call a corpus the wrong tier because the rule is shared; that holds for the rule only. Do not turn this into a `landed` comparison.

**The stub `gh` answers `--head ""` with every row it holds, as the real `gh` does.** A stub that returns nothing for an empty head reproduces a stub's idea of the defect and would pass with the guard removed. Measured 2026-10-01: `gh pr list --head ""` applies no filter, and `pr_merged_heads ""` printed 98 lines.

**Cases, at least seven:** an empty branch; one merged PR; a newer unmerged PR in front of a merged one (the `--limit 1` case, `plot-pr-merged.sh:78-92`); no PR; only an open PR; `gh` absent from `PATH`; `gh` exiting non-zero with an authentication error. Absent `gh` needs a `PATH` holding `bash`, `jq` and `node` but no `gh`: build it from a sandbox directory, never by deleting anything from the real one.

**The corpus is built, not read.** No branch on the estate is empty, so a live corpus cannot exercise the case.

**What the comparison leaves out, and the test says so in one line each.** `pr_open` has no TypeScript counterpart (`plot-pr-merged.sh:59-62`); the slice-1 contract test in `test/reconcile/host.test.mjs` holds `pr_open ""`. `_plot_merged_lookup` asks `gh` on every backend while `plot-host.sh pr-merged` also serves Bitbucket, so the corpus covers `github` only. A Bitbucket divergence is not this plan's to fix; if you see it, report it.

**Carried over unchanged from the estate:** absent is not false (an unaskable lookup is a refusal, never a permit); read the exit code and not the emptiness; `mergedAt` is read, never `state`.

**On a disagreement the branch stops.** If a case disagrees, report which side is wrong. Adjusting either side to make the comparison pass is the one move `docs/shell-and-domain.md` forbids. Expect the stub's auth-error case to be the likeliest disagreement: `plot-host.sh` answers `unknown` for an error text that is not a lookup miss, and `is_lookup_miss` decides, so choose the stub's error text deliberately and name it in the case.

### Done when

The plan's `## Done when` list for this slice is the specification:

- `pnpm --filter @plot-pm/domain run test:corpus` runs the new file, and every case agrees.
- The empty-branch case is in the corpus. The plan says it fails on `origin/main` before slice 1 with `subject="" adapter=refuse shell=merged`. Slice 1 has merged, so prove the case still bites a different way: remove the guard from `_plot_merged_lookup` in a scratch copy, run the file, and see that disagreement named. Restore with `git checkout -- <file>` only after committing your work, and keep the removal out of the commit.
- The corpus asserts a floor of seven cases and that it exercises both verdicts, so it is not vacuous.
- `docs/shell-and-domain.md:9` no longer names `rules/reapable.ts` and `rules/queue.ts` as the duplicate.

Assertions that exist because a naive implementation would pass without them:

- **The stub-`gh` call log.** The empty-branch case asserts the shell side recorded no `gh` call. A guard moved after `command -v gh` would still pass the verdict comparison and fail this.
- **The `--limit 1` case.** A stub that returns only the newest PR passes the verdict comparison on a lookup that regressed to `--limit 1`; the stub must return both rows for the branch.

Plus the repo gates: run `node skills/plot/scripts/board/plot-local-checks.mjs` before each push and run what it prints. The suites in the `CI suites` key run in CI, and a failure there comes back as a correction. Under Node 24 (`nvm use`; pnpm crashes on 26). Do not run `pnpm run test:e2e`.

### Bookkeeping

- Changeset: a test and a docs change only. Check whether `.changeset/` needs one with `./scripts/check-changeset-packages.sh`; if you add one, `'plot': patch`, description first, `plan:` and `bumps:` last. `.changeset/` holds siblings' files; touch none.
- Push the first real commit as soon as it exists.
- Open the PR with `../plot/scripts/plot-open-pr.sh` (add `--draft` while work moves). Do not run `gh pr create`.
- When the PR exists, append `→ #<number>` to this branch's heading in the plan's `## Slices` section, in the form `(Branch: bug/the-two-merge-lookups-agree, PR: #N)`.

### Scope guard

This branch owns `packages/domain/corpus/pr-merged.corpus.test.ts`, the amendment to `docs/shell-and-domain.md`, and at most one changeset. It does not change `plot-pr-merged.sh`, `plot-host.sh` or `host-shell.ts`: a disagreement is reported, not repaired here. `packages/domain/corpus/README.md` may gain one line if it lists the files.

In flight on 2026-10-02: `bug/a-worker-less-checkout-yields-its-branch` edits `plot-worker-loop.sh` and `CLAUDE.md`; neither is on this branch's list. If you find something the plan did not anticipate, report it rather than improvising outside scope.
