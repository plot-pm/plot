# An empty branch never reads as merged

> `pr_merged ""` refuses, and a corpus test holds the shell lookup and the TypeScript lookup to one answer.

## Status

- **State:** Approved
- **Approved:** 2026-10-02, jwloka, in-session
- **Type:** bug
- **Sprint:** the-fleet-runs-through-its-limits
- **Issue:** #1082
- **Review:** in-session
- **Impl:** own branches
- **Started:** 2026-10-02, Jan Wloka, `bug/an-empty-branch-is-not-asked`

## Changelog

- `pr_merged`, `pr_open` and `pr_merged_heads` in `plot-pr-merged.sh` no longer ask the host about an empty branch. An empty branch answers *not merged*, *no open PR* and *unknown heads*, so no caller can remove a desk or delete a ref on it.
- A corpus test compares `pr_merged` against the TypeScript host adapter's `prMerged` over a built set of cases, so the two lookups cannot drift apart in silence.

<!-- Board impact: none. The plan format, the template and the docs/plans layout do not change. `plot-pr-merged.sh` is a helper script, and no board bundle reads it; `board/plot-landed.mjs` does not change. -->

## Motivation

`pr_merged ""` exits 0, which means *merged*. Measured on 2026-10-01 on `origin/main` (`56a978ea`):

```
$ bash -c 'source skills/plot/scripts/plot-pr-merged.sh; _plot_merged_lookup ""; pr_merged ""; echo $?'
found
0
$ bash -c 'source skills/plot/scripts/plot-pr-merged.sh; pr_merged_heads "" | wc -l'
98
$ bash skills/plot/scripts/plot-host.sh pr-merged ""; echo $?
plot-host.sh: line 3463: 1: pr-merged needs a branch
1
```

The cause is the lookup, not the rule. `_plot_merged_lookup` (`plot-pr-merged.sh:123-129`), `_plot_open_lookup` (`:132-138`) and `pr_merged_heads` (`:196-207`) pass the branch to `gh pr list --head "$br"`. `gh` applies no filter for `--head ""`, so every PR in the repository matches. The merged lookup answers `found`, and `board/plot-landed.mjs` correctly answers `landed` for that reading. `pr_merged_heads ""` prints the head of every merged PR in the repository (98 lines). `pr_open ""` answered *no open PR* on 2026-10-01 only because the repository held no open PR; with one open PR it answers *open*.

The TypeScript side refuses for the same branch. `host-shell.ts:309-325` runs `plot-host.sh pr-merged ""`, which stops at `${1:?…}` (`plot-host.sh:3463`) with exit 1. `record` turns that into a failed result, and `registryd-main.ts:419` maps a failed result to `unreachable`. Since #1073 the supervisor does not ask at all: `registryd-main.ts:417` returns `not-asked` for an empty branch. `reapable.ts:113`, `:235` and `:454` refuse every reading other than `merged`.

So for one branch the shell says *permit* and the domain says *refuse*. `plot-pr-merged.sh:16-21` states why this is the dangerous direction: `plot-release-refs.sh` deletes remote refs on this answer, and a deleted ref is not re-creatable.

The defect is latent. Every caller guards the empty branch today: `plot-reap.sh:329` (`[ -n "$br" ]` before `pr_merged_heads`), `:678` (`[ -n "$short" ]`), `:965` (`[ -n "$br" ] || continue`), `plot-release-refs.sh:202`, `plot-quiet-stretch.sh:150`, and `plot-dispatch.sh:3690` takes its branch from a plan slice. Each guard is a rule at the call site. A fifth caller that omits it gets *merged*.

No test holds the two lookups together. `grep -rn 'pr_merged\|prMerged' packages/domain/corpus/` returns nothing.

## Design

### Approach

**Two lookups answer one question, and they are the duplicate.** `docs/shell-and-domain.md:9` names the pair as `plot-pr-merged.sh` against `rules/reapable.ts` and `rules/queue.ts`. That sentence is out of date: the decision moved into `rules/landed.ts`, and the shell reaches it through `board/plot-landed.mjs` (`plot-pr-merged.sh:23-28`, `:105-115`). One implementation of the rule cannot disagree with itself. What is still implemented twice is the LOOKUP: `_plot_merged_lookup` (`plot-pr-merged.sh:123`) asks `gh` directly, and the TypeScript host adapter asks `plot-host.sh pr-merged` (`plot-host.sh:3462`, called from `host-shell.ts:310`). `plot-pr-merged.sh:37-71` and `scripts/check-host-cli-callers.sh:70-85` record why the shell keeps its own lookup. The issue's comment and the #1073 plan (`2026-09-29-a-question-nobody-asked-has-its-own-word.md:130`) call a corpus test the wrong tier because the rule is shared. That holds for the rule and not for the lookup, and the empty branch is a lookup disagreement. So this plan does both: a guard in the lookups, and a corpus comparison of the two lookups' verdicts.

**An empty branch is `unaskable`, not `none`.** `rules/landed.ts:9-11` defines `unaskable` as *the lookup did not run, or did not answer*. A lookup that refuses an empty branch did not run, so it answers `unaskable`, and `landed` answers `unknown`. `pr_merged` already reads `unknown` as a refusal (`plot-pr-merged.sh:151-155`). `none` would be wrong: it claims that the host spoke. `pr_open ""` then returns 1 (no veto); that is safe because `pr_merged ""` refuses on the same branch, which `mayRemove` (`landed.ts:108-109`) asserts. `pr_merged_heads ""` returns 1, which `plot-reap.sh` reads as `unknown` and keeps the desk (`plot-pr-merged.sh:192-195`).

**The guard sits in the lookups, before `command -v gh`.** One guard per lookup function, not one per caller. No `gh` call is made for an empty branch, so a test can assert that the stub `gh` was never invoked.

**The corpus is built, not read.** No branch on the estate is empty, so a live corpus cannot exercise the case. `listing-page.corpus.test.ts` is the precedent: stub CLIs on `PATH`, one case per row, `describingAs({ left: 'rule', right: 'shell' })`. Here the left side is the TypeScript host adapter (`hostShell`'s `prMerged`, `host-shell.ts:178` and `:309`) and the right side is the sourced `pr_merged`. Both sides run against the same stub `gh`. The compared verdict is one boolean: *may a caller treat this branch as merged*. The shell's verdict is `pr_merged`'s exit code 0. The adapter's verdict is an `ok` result whose value is `merged`; a failed result, `not-merged` and `unknown` all refuse, exactly as `registryd-main.ts:414-425` maps them. The test labels both sides `adapter=`/`shell=` through `describingAs`.

**The cases, and the floor.** The stub `gh` answers `--head ""` with every row it holds, as the real `gh` does, so the test reproduces the defect rather than a stub's idea of it. Cases: an empty branch; a branch with one merged PR; a branch with a newer unmerged PR in front of a merged one (the `--limit 1` case, `plot-pr-merged.sh:78-92`); a branch with no PR; a branch with only an open PR; `gh` absent from `PATH`; `gh` exiting non-zero with an authentication error. The test asserts that the corpus exercises both verdicts, per `docs/shell-and-domain.md:62`.

**What the comparison leaves out, by name.** `pr_open` has no TypeScript counterpart: `plot-pr-merged.sh:59-62` states that no `plot-host.sh` op answers *any open PR* with three values. The slice-1 contract test holds `pr_open ""`, and the corpus test says so in one line. `_plot_merged_lookup` asks `gh` on every backend (`plot-pr-merged.sh:125-126`), while `plot-host.sh pr-merged` also serves Bitbucket; the corpus covers `github` only and names that limit.

**No new script.** Both slices change `plot-pr-merged.sh`, add tests, and amend `docs/shell-and-domain.md`.

### Open Questions

- [ ] The issue's comment and the #1073 plan (`:130`) call a corpus test the wrong fix. This plan keeps one, because the duplicate is the lookup and not the rule. The reviewer confirms or drops slice 2.
- [ ] `_plot_merged_lookup` asks `gh` on a Bitbucket checkout (`plot-pr-merged.sh:125-126`). That is a separate divergence from `plot-host.sh pr-merged` and is not this plan's to fix. File it as an issue if the reviewer agrees.

## Slices

### An empty branch is not asked (Branch: bug/an-empty-branch-is-not-asked, PR: #1182)

- `bug/an-empty-branch-is-not-asked` — guard in `_plot_merged_lookup`, `_plot_open_lookup` and `pr_merged_heads` that answers `unaskable` (or returns 1) for an empty branch before any `gh` call; a stubbed-`gh` contract test in `test/reconcile/host.test.mjs`; a changeset (`'plot': patch`, `bumps: skills: plot: patch`) <!-- builds: an empty-branch guard in plot-pr-merged.sh's three lookups -->

Done when:

- `pr_merged ""` returns 1, `pr_open ""` returns 1, and `pr_merged_heads ""` returns 1 and prints nothing, against a stub `gh` that holds one merged PR and one open PR.
- The stub `gh` records no call for any of the three.
- A non-empty branch with a merged PR still makes `pr_merged` return 0 (the guard does not reach it).
- The test fails when the guard is removed from any one of the three functions.
- The header comment of `plot-pr-merged.sh` names the guard and the reason in one paragraph.

### The two merge lookups agree (Branch: bug/the-two-merge-lookups-agree) <!-- waits: bug/an-empty-branch-is-not-asked -->

- `bug/the-two-merge-lookups-agree` — `packages/domain/corpus/pr-merged.corpus.test.ts` comparing `pr_merged` against `host-shell.ts`'s `prMerged` over a built corpus; `docs/shell-and-domain.md` amended at `:9` to name the lookup pair, plus a section for this comparison <!-- builds: pr-merged.corpus.test.ts, a built corpus over the two merge lookups -->

Done when:

- `pnpm --filter @plot-pm/domain run test:corpus` runs the new file, and every case agrees.
- The empty-branch case is in the corpus, and on `origin/main` before slice 1 it fails, naming `subject="" adapter=refuse shell=merged`.
- The corpus asserts that it exercises both verdicts and holds at least the seven cases above.
- `docs/shell-and-domain.md:9` no longer names `rules/reapable.ts` and `rules/queue.ts` as `plot-pr-merged.sh`'s duplicate; it names the lookup pair and the corpus file.

## Notes

- Verified on `origin/main` at `56a978ea`, 2026-10-01. Every `file:line` above was read at that commit.
- Found by the round-1 panel on #1073. The #1073 plan is Released and leaves the shell twin to this issue (`2026-09-29-a-question-nobody-asked-has-its-own-word.md:128-136`).
- Slice 2 waits on slice 1 because its empty-branch case fails until the guard lands.
