## Implementation brief — a-release-between-two-sprints-books-its-plans (wave 2: Tag Range)

- **Plan (canonical):** `docs/plans/2026-11-27-a-release-between-two-sprints-books-its-plans.md` on `main`
- **Approved:** 2026-11-27, jwloka, plan-PR #3740 merged
- **Branch:** `bug/the-release-scope-reads-the-tag-range` (base: `main`)
- **Ends as:** one PR to `main`, opened with `skills/plot/scripts/plot-open-pr.sh`
- **Review of the code:** per repo convention — the PR is reviewed as code; CI is the authority for e2e

This wave waited on `bug/a-release-no-sprint-names-books-its-changesets`, which merged as #3741 (`6247fd7f6`). `releaseFinish` no longer refuses `release-scope-mismatch`, books the changeset-named plans where no sprint names the version, and refuses `shipped-unread` rather than `already-released` where the changesets are unread and no sprint is in scope. Nothing waits on this branch.

### What to build

Issue #3736, second half. Measured 2026-11-27: release 2.37.0 (`a55df0f41`, tag `v2.37.0`) left 11 plans Delivered, and a person booked them in 11 commits (`63a5b69a9..8843327f2`). The 15 removed changesets name 10 distinct plans (12 carry a `plan:` line, 3 carry none). The 11th plan, `a-held-board-shows-the-indexed-tickets`, shipped through PR #3709 (`9cb3fa3fa`, merged 2026-11-24, inside `v2.36.1..v2.37.0`) with no changeset, so wave 1 still leaves it unbooked. This wave books it.

The change:

1. **Tag arm in `releaseScope`** (`packages/domain/src/rules/release-scope.ts`). `ReleaseScope` gains a third list beside `sprintSlugs` and `named`: the Delivered plans whose every non-deferred slice PR first shipped in this version's tag. The arm decides through `releasePr` and `releaseTag` (`rules/release-tag.ts`) over a new reading field, and returns for each candidate not booked a reason: `not-delivered`, `slice-after-tag`, `no-merge-subject`, `already-released`. `releaseOwes`/`releaseOwed` take the tag plans as a third source; a plan found by the tag arm is owed only where it reads Delivered with no `Released:` record.
2. **A new field on `ReleaseFinishReadings` and `ReleaseUnbookedReadings`** carrying the tag reading: per plan slug, the rows `releaseTag` needs (`number`, `mergeCommit`, `mergedAt`, `containingTags`, `carrier?`), plus `'unaskable'` for a read that failed. Name it for what it is (the tag reading), not for the callers.
3. **Slice PRs come from slice lines only.** Read each slice's `→ #N` or `→ commit <sha>` through `BranchClaim` (`rules/cross-repo-reference.ts`), joined with the branch's deferral into `ReleasePrRow`s, exactly as `plot-deliver.mjs --release` builds them (`packages/board/src/server/entry/deliver.ts:925-957`).
4. **The local merge-commit reading, shared by all four callers.** One function in the board package reads each PR's merge commit and time from the host-written merge subject on the default branch or a `sprint/*` branch (`rules/merge-subject.ts`: `mergedBySubject`, `carriesMergeOf`), asks `Refs.tagsContaining`, and for a slice merged into `sprint/*` resolves the carrying merge through `carriedRelease` (`packages/board/src/server/entry/release-chain-walk.ts:132`). A `→ commit <sha>` slice uses that commit. It makes **no host call**.
5. **Four callers pass the same reading:** `packages/board/src/server/entry/release-finish.ts:387`, `packages/board/src/server/entry/release-unbooked.ts:131`, `packages/board/src/server/release-unbooked-reading.ts:63`, `packages/fleet/src/shared/release-tick.ts:119`. Check each line against `main` before editing; they moved with #3741.
6. **A failed tag read** books the sprint and changeset arms and adds the note `range-unread: the tag's slice merges could not be read, so only the sprint and changeset scope is booked`; `releaseUnbooked` does not turn `unaskable` because of it.
7. **The finish reports its scope.** `notes` name each booked plan with its source (`sprint`, `changeset`, `tag`), each candidate not booked with its reason, and each Delivered plan outside every source (the existing `Delivered outside the sprint…` line).
8. **`skills/plot-release/SKILL.md` step 5b** (and the Model Guidance row at line 52) names which plans the finish can still leave: a plan with a slice after the tag, a plan whose slice was squash- or rebase-merged with no merge subject, a plan with a slice in another repository. Bump nothing by hand; declare it in the changeset.

### Decisions the plan settles — do not re-derive them

**A booking is final, so the arm books only on full evidence.** `plot-reject` moves Delivered to Approved, no command reverses `Released`, and `plot-state-gate.sh` refuses a hand revert. The alternative — book a plan once any slice is in the tag — books a plan whose second slice merges after the tag, and nothing can undo it. `releaseTag` already refuses `tag-misses-pr` for that shape; a plan with one slice before the tag and one after is not in this scope and is in the next release's.

**`releaseTag` decides; no previous tag is read.** The alternative was a `<previous-tag>..<tag>` range. Measured: it needs a tag-ordering read and a second tag's containment, and `releaseTag` already resolves "the first `vX.Y.Z` tag containing the last-merged slice PR, sorted by version" and `plot-deliver.mjs --release` asks the same rule. A plan whose slices all lie before the previous tag resolves to the previous tag and so is not in scope; a test holds it.

**The arm makes no host call.** The PR index carries no merge commit and `plot-deliver.mjs --release` pays one `prState` per PR. The arm reads the merge subject on the default branch instead, as the wave gate does for a branch with no ref. Test it with a host that throws on any call.

**A squash or rebase merge keeps its plan out of the tag arm.** No merge subject means no merge commit, and a guess here is a final booking on weak evidence. The plan is named in the notes as `no-merge-subject`; the changeset arm still books it where a changeset names it. The wave gate's own rule applies: a subject settles a slice, and here it is the only evidence the arm has.

**Prose `→ #N` books nothing.** This plan's own Motivation and `docs/plans/2026-10-23-plot-plan-meta-a-branch-heading.md:55` carry `→ #N` in running text. The arm reads slice lines through `BranchClaim` and never a whole-file match; a test with a prose `→ #N` inside the range asserts it books nothing.

**Delivered only** (`[question-delivered-only]`). The tag arm adds Delivered plans; a changeset-named plan in another phase keeps its note. **The finish closes a sprint only where its `Release:` names the version, or by the empty-`Release:` fallback** (`[question-sprint-close]`). The tag arm closes no sprint.

**No changeset gate here.** `[question-changeset-gate]` is a separate idea for repositories that declare changesets: in 2.37.0 it would have changed 1 of 11 bookings, and the tag arm must also serve a repository with no changesets and a plan whose changeset names no `plan:` line (3 of 15 in 2.37.0). Do not add one.

**The ancestry read is not gated and still carries a marker.** `scripts/check-ancestry-decisions.sh:65` matches `merge-base --is-ancestor` and `--merged`, not `git tag --contains`. The adapter's read says `# plot-ancestry: evidence` (or the TypeScript equivalent the repo uses) by convention, naming `releaseTag` as what decides. A containment that cannot be read answers `unknown`, which books nothing. Measured 2026-09-04: `merge-base --is-ancestor` disagreed with the host on ten of ten merged branches — so the arm uses the merge subject for the commit and tag containment only for the release question.

Carried over unchanged: absent is not false. An unread tag reading is `'unaskable'`, never an empty list; an empty list means no plan has a slice in the tag. `releaseUnbooked` still answers `'unaskable'` only for the reads it did before.

### Done when

The plan's `## Slices` test line for this wave is the specification: the scope at `a55df0f41` equals the 11 slugs booked in `63a5b69a9..8843327f2`, no more and no less; a plan with one slice before the tag and one after it is not in this scope and is in the next; a prose `→ #N` inside the range books nothing; a slice merged into `sprint/s` and carried into the tag is in scope; a plan whose slices all lie before the previous tag is not in scope; a sprint-named release books its sprint, changeset and tag plans once each; a failed tag read books the changeset arm and notes `range-unread`; real-repo tests with real tags and merge commits through the finish entry and each `releaseUnbooked` reader return the same slugs; the tag arm fails on any host call; the unbooked item names the #3709 plan. Assertions that exist because a naive implementation would pass without them:

- **The four callers return the same slugs from one real repository.** It catches a reading wired into the finish and forgotten in the board reading or the fleet tick; the board's `unbooked` item would then say nothing is owed while the finish books 11.
- **The host throws on any call.** It catches an arm that asks `prState` for a merge commit, which passes every unit test with a stubbed host.
- **A plan with a slice after the tag is not booked, then booked in the next release's finish.** It catches an arm that reads only the last-merged PR and ignores the earlier ones' tags, and one that books a plan whose later slice has not shipped.
- **Slugs appear once across `sprint`, `changeset` and `tag`.** A plan named by a sprint, a changeset and the range books once and carries the first source in the notes.
- **The 2.37.0 fixture has 11 Delivered plans and 15 changesets (10 plans named, 3 changesets with no `plan:`).** Assert 11 booked in the order the decision produces and the #3709 plan present. It catches a scope that equals the changeset arm alone.

Plus: a changeset in `.changeset/` for `plot` and `@plot-pm/board` as the files you touch require, with the description first and the `bumps:` block last, naming `plot-release` and the plan on a `plan:` line; run `./scripts/check-changeset-packages.sh`. Run `node skills/plot/scripts/board/plot-local-checks.mjs` before each push and run what it prints. The suites in the `CI suites` key run in CI, and a failure there comes back as a correction. Run no full suite and no `test:e2e`. The wave edits `skills/plot-release/SKILL.md` but touches no `.sh` file, so `scripts/check-shell-lines.sh` does not bind it; if that changes, growth is paid for in the same change, by removing shell elsewhere or writing the rule in the domain. Do not commit a rebuilt board bundle. Keep the Model Guidance table of `plot-release` in step with the edit to step 5b.

TSDoc states current behaviour only, no history of the refusal or this plan. Arrow functions for anything you write, in the domain and anywhere else.

### Bookkeeping

When the PR is created, append `→ #<number>` to this branch's line in the plan's `## Slices` section. Open the PR with `skills/plot/scripts/plot-open-pr.sh`, never `gh pr create`. Push the first real commit as soon as it exists.

### Scope guard

This branch owns `packages/domain/src/rules/release-scope.ts`, `rules/release-unbooked.ts`, `workflows/release-finish.ts`, their tests in `packages/domain/test/`, the shared local reading and the three board and fleet callers named above with their tests, the real-repo tests, `skills/plot-release/SKILL.md` and `README.md` as step 5b requires, and one changeset. It does not touch `rules/release-tag.ts`'s five refusals, `rules/merge-subject.ts`'s forms, `release-chain-walk.ts`'s walk or `Refs.tagsContaining`'s contract; if one needs to change, report it. Other branches in flight on the release path: `the-release-head-is-reviewed-while-its-scope-waits` (PR #3754) works on the review of the release head, not the scope; verify its diff before editing `release-finish.ts` or `release-unbooked.ts` and rebase onto `main` if it landed.

If you find something the plan did not anticipate, report it rather than improvising outside scope.
