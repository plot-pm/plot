## Implementation brief — main-merges-more-than-one-pr-per-ci-run (wave 1: The settle ignores Plot commits)

- **Plan (canonical):** docs/plans/2026-11-17-main-merges-more-than-one-pr-per-ci-run.md on main
- **Approved:** 2026-11-17, Jan Wloka, plan-PR #3503 merged
- **Branch:** `feature/the-settle-ignores-plot-commits` (base: `main`)
- **Ends as:** one PR to main
- **Review of the code:** `Review: pr` — the slice PR carries `plot/review`; a push that moves the head voids it, so batch fixes into one push

This is wave 1 of 4 and waits on nothing. Wave 2 (`the-reading-settles-on-completion`) and wave 3 (`a-red-main-names-its-pr`) wait on nothing either, and wave 4 (`merges-stack-two-deep`) is deferred and waits on wave 3. Wave 3 consumes the `subject` field this wave adds to `Refs.firstParentCommits`, so land that field in a shape wave 3 can read without changing it.

### What to build

Main takes about 1.5 merges per hour because a merge waits for CI to settle on the exact tip, and the tip moves without a merge. Measured 2026-11-17, 08:56–14:10 UTC: about 15 bookkeeping and bundle commits against 8 merges (`build-bundles.yml` pushes `plot: build the board artifact` about 40 s after each merge; `plot: record PR #N` and `plot: book the brief …` are direct pushes). `40881e43`, pushed at 13:27, held the next merge until 14:09. Your fix is the fix when a tip whose only unsettled commits touch Plot's own paths no longer refuses with `default-branch-unsettled` or holds `merge-in-flight`.

Build three things on what exists:

1. `FirstParentCommit` (`packages/domain/src/ports/refs.ts:185`) gains `subject: string`, filled by `firstParentCommitsOf` and the `git log` format in `packages/domain/src/adapters/refs/refs-git.ts:315` and `:1123`, and by `refs-fixture.ts`. Put `%s` LAST in the format and rejoin the remaining `|`-split fields: a subject can contain `|`, and today's `split('|')` would cut it.
2. A pure rule, `settledPast(settled, unsettled, pathSet)`, in `packages/domain/src/rules/`. `unsettled` is the first-parent commits in `settled.sha..headSha`, each with its sha and changed paths. It answers `settled` when every one of them changes only paths in `pathSet`, and "not settled" otherwise. Reuse `syncPathVerdict` (`rules/state-sync.ts:84`) for the per-commit judgement instead of writing a second path matcher: it already refuses `..` segments and an unread diff, and it already reads paths and nothing else.
3. The three call sites read it. `mergeArm` (`rules/slice-pr-next.ts:408`) replaces `settled.sha !== defaultBranch.headSha` with the rule's answer; `merge()` (`workflows/merge.ts:373`) and `mergeAt` (`:554`) replace `settled.sha !== tip` with it. The `tip === headSha` check and the `newestMerged.mergedAt <= askedAt` check stay as they are: they prove the reading names the current tip and includes the newest merge.

The unsettled commits are read once per tick, not per PR, because they depend only on the reading. The tick's reading is assembled at `packages/fleet/src/shared/auto-merge.ts:341-382`; `mergeArm` stays pure over readings, so the commits arrive as a field on its readings. `auto-review.ts:224` and `auto-fixer.ts:681` also build these readings and must keep typechecking: give them the "unread" value, which fails closed to today's behaviour. The cost is 1 + N local git calls, N at most `ANCESTOR_ASKS_MAX` = 5, and no host call.

The plan is canonical; this is orientation.

### The decisions the plan settles — do not re-derive them

**The path set is the union of `syncPathSet` and the generated bundle set, taken from code and never from a commit's subject or author.** A subject check ("starts with `plot:`") is the alternative; it fails because anyone can write that subject on a code commit, and the rule's whole point is that it reads what the commit changed. `syncPathSet` (`state-sync.ts:59`) holds every path the bookkeeping commits write: `plot: record PR #N` changes one plan file, `plot: book the brief …` changes `.plot/briefs/<slug>.md` and one plan file. The bundle set is `build.mjs`'s `shipped*` declarations (`packages/board/build.mjs:99-121`), the list `scripts/main-bundles.sh:65` reads through `read_shipped_bundles`; `.gitattributes` marks the same files `-merge`. I found no TypeScript reader for that list (`grep shipped packages/*/src` returns nothing), so how the set reaches the rule is yours to decide. It must derive from those declarations; a hand-copied list in TypeScript is a second implementation that drifts the day a bundle is added. The rule takes `pathSet` as a value, so the domain stays free of file reads. If no adapter can read the declarations cheaply, report it.

**Plan files stay in the set, though a plan file can turn main red.** `check-plan-headings.sh` runs on push to main (`ci.yml:2013`). Without plan paths the rule removes no `plot: record PR #N` commit and the slice does nothing. The commit's own run still feeds the reading, so a red on it becomes `settled` and `default-branch-red` holds as today. The gap is a merge admitted while such a commit is still pending; wave 3 bounds it.

**A PR merge whose paths all lie in the set (a plan PR) is settled the same way.** The rule reads paths, not the commit's kind.

**Fail closed on every unread input.** A path with `..` segments, an unread diff, a failed `firstParentCommits` or `commitFiles` call, and an absent reading all answer "not settled", and the call site then gives today's reason (`default-branch-unsettled` or `merge-in-flight`). Measured 2026-08-27, an empty result read as "no PRs" and refused four fully merged plans; the same rule runs the other way here: an empty or failed read must never read as "nothing changed outside the set".

**A rename into the set hides a code file.** `commitFiles` runs `git show --name-only -m --first-parent` (`refs-git.ts:864`) with git's default rename detection, which lists only the destination of a rename. A commit that moves `packages/x/y.ts` to `docs/plans/y.ts` reads as one in-set path. Read the unsettled commits with `--no-renames` so both sides appear. Do not change `commitFiles` for its other callers, which the delivery gate depends on; add a flag or a second reading, and test the rename case.

**More than `ANCESTOR_ASKS_MAX` = 5 unsettled commits answers "not settled".** The reading's walk asks at most 5 commits per refresh (`rules/default-branch.ts:118`); a longer line means part of it was never asked. This is my reading of the plan's step 4 bound applied one wave early, so it fails closed. Say so in the TSDoc if you keep it.

**Repair-admitted merges keep today's `settled.sha === headSha` requirement.** The plan states this for the stack (step 4); step 1 does not ask for more, and holding a repair merge one extra pass costs nothing a red main is not already costing. Keep the `repairAdmitted` path untouched, and keep the `settled.state !== 'green'` hold ahead of the new rule so `settledPast` can never turn a red or pending `settled` into a go.

**Rules from related work, carried over:** absent is not false; read the exit code, not the emptiness; a derived reading is not persisted (`Answers, never verdicts` in CLAUDE.md), so do not write `settledPast`'s answer into `.plot/state/default-branch.json`.

### Done when

The plan's `Done when` entry for this slice is the specification: `Refs.firstParentCommits` carries `subject`; `settledPast` answers `settled` for unsettled commits that touch only the Plot path set, and "not settled" for one path outside it, a `..` path, a rename out of the set and an unread diff, each asserted in a unit test; `mergeArm`, `merge()` and `mergeAt` merge onto a tip whose only unsettled commits are a bundle commit and a bookkeeping commit, and refuse with today's reasons for a tip with one code commit, asserted in unit tests.

Assertions a naive implementation would pass without:

- A commit with one in-set path and one path outside it answers "not settled". It catches an `any` written where `every` belongs.
- A rename from outside the set into it answers "not settled". It catches default rename detection hiding the source.
- A `subject` containing `|` round-trips through `firstParentCommitsOf`. It catches the naive `split('|')`.
- A failed or unread `firstParentCommits` or `commitFiles` call refuses with today's reason and never merges. It catches fail-open on an unread input.
- `mergeAt` refuses on a code commit with no `prReview` call, as it does today (the existing test pins this; keep it passing unchanged).
- A red or pending `settled` with only Plot commits past it still holds. It catches the rule overriding the state check.
- A repair-admitted merge on a red main still requires `settled.sha === headSha`.
- Mutation check: make `settledPast` return `settled` unconditionally and confirm the "one code commit" tests fail. Commit before you mutate.

Plus the repo's gates. Run `node skills/plot/scripts/board/plot-local-checks.mjs` before each push and run what it prints; the suites in the `CI suites` config key run in CI, and a failure there comes back as a correction. Run no full suite, and do not run `test:e2e` locally. The domain package follows its own style: arrow functions (`export const f = (…) => …`), and TSDoc that states what an export does, takes, returns and how it fails, with the reasoning left to the commit message. Use `Slice` and `Agent` vocabulary, never new `Wave` names in code. Do not commit a rebuilt board bundle (`check-no-bundle-diff.sh` refuses it; `main` builds its own). Add a changeset in the package `plot`, description first and the `plan:` line inside the trailing comment block, using the plan's first Changelog line as the description. This slice edits no skill file, so it needs no `skills:` bump; add one only if you touch a `SKILL.md`.

`scripts/check-shell-lines.sh` refuses a pull request whose shell under `skills/` is longer than at its merge base. This slice is TypeScript only and should add no shell. If you touch a `.sh` file, pay for any growth in the same change: remove shell elsewhere, or write the rule in the domain and ask it through a bundle. The gate counts commands, not lines, and has no override.

### Bookkeeping

Open the PR with `skills/plot/scripts/plot-open-pr.sh` (`--draft` while it moves); never `gh pr create`. When the PR exists, append `→ #<number>` to this branch's line in the plan's `## Slices` section. Push the first real commit as soon as it exists.

### Scope guard

This branch owns: `packages/domain/src/ports/refs.ts`, `adapters/refs/refs-git.ts`, `adapters/refs/refs-fixture.ts`, a new rule file under `packages/domain/src/rules/`, the `settled` hold in `rules/slice-pr-next.ts` and `workflows/merge.ts`, the reading assembly in `packages/fleet/src/shared/auto-merge.ts` (and the two `newestMerged: null` sites that must keep typechecking), and their tests.

Other slices in flight, none with a branch or brief yet (checked on `origin/main` at dispatch):

- `feature/the-reading-settles-on-completion` owns `packages/fleet/src/shared/default-branch-refresh.ts` (`REASK_MS`, `declaredRuns` and the job form of `Default branch checks`). Do not edit that file.
- `feature/a-red-main-names-its-pr` owns `rules/repair.ts`, `writeRepairRecord` (`default-branch-refresh.ts:202-218`) and `revert-start.ts`. It reads the `subject` you add. Do not change `candidatesFromLine`.
- `feature/merges-stack-two-deep` is deferred. It later replaces your `settledPast` call with `stackVerdict` and adds `stack-full` and `paths-overlap`, so keep `settledPast`'s signature small and pure; add no refusal names here, and the board needs no change from this slice.

If you find something the plan did not anticipate, report it rather than improvising outside scope.
