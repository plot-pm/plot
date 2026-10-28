## Implementation brief — a-cross-repo-reference-is-read-per-line (wave 3: Per-line references)

- **Plan (canonical):** docs/plans/2026-10-28-deliver-passes-a-plan-whose-slices.md on main
- **Approved:** 2026-10-28, Jan Wloka, plan-PR #2827 merged
- **Branch:** `bug/a-cross-repo-reference-is-read-per-line` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** per repo convention (CI required on main)

Wave 1 (`bug/deliver-reads-unread-branch-items` → #2858) and wave 2
(`bug/deliver-refuses-unread-branch-items` → #2877) are merged, so this branch
starts from a clean base. Wave 4 (`docs/a-foreign-slice-has-one-written-form`)
waits on this one: it documents the `→ owner/repo#N` form this slice makes
safe to use more than once per plan.

### What to build

Today a plan that uses **one branch name across several repositories** gets
only the first repository's PR checked, and the others are silently ignored.
Reproduced in the plan's cause 3: with PR #11 merged in one repo and #22, #33
still open in two others — all claimed under the same branch name —
`deliverabilityOf` asks only #11 and answers `deliverable: true`. This is live
on the ewz-kus-portal 3853 plan, which uses `infra/EWZKUS-3853-monotonie-waechter`
identically in six repositories.

Two independent pieces of code collapse by branch name and both need to stop:

1. **`crossRepoReferences`** (`packages/domain/src/rules/cross-repo-reference.ts:34`)
   returns a `Map<string, CrossRepoReference>` keyed by branch name alone, and
   explicitly keeps only "the first line that names a reference" (see its own
   test, line 23). It must instead return **every** `(repo, number)` reference a
   branch's claim lines name — one branch can legitimately have several, one
   per repository it is claimed in.
2. **`branchesOf`** (`packages/board/src/server/controllers/deliverability.ts:70`)
   folds all of a plan's mentions of one branch into a single `NamedBranch`
   (a `Map<string, NamedBranch>` keyed by `b.branch`, line 74), and that
   `NamedBranch` carries one `prRef?: CrossRepoReference` (line 48,
   `refs.get(b.branch)` at line 85). With several references per branch, one
   `NamedBranch` can no longer hold a single `prRef` — it must keep each
   `(repo, number)` claim as its own entry so `mergedBranches` (line 149) asks
   `ports.host.prState` once per reference, not once per branch name.

Also read the **heading form**: `crossRepoReferences`'s `REFERENCE` regex
(line 23) only matches `→ owner/repo#N`. `plot-impl-status.sh`'s
`annotation_for` already reads a second form, `PR: owner/repo#N` **inside** a
`### Name (Branch: x, PR: owner/repo#N)` heading (`skills/plot/scripts/plot-impl-status.sh:142-152`).
`crossRepoReferences` must read that form too, so both callers agree.

Finally, **`plot-impl-status.sh`** keys its own lookups by branch name:
`BRANCH_LINES` (`:118`) is a `sort -u` over branch names regardless of
repository, and `annotation_for` (`:134`) takes `head -1` — the first
annotation it finds for that name, across every section. Both need to key by
`(repository, branch)` instead, within the same shell budget (no net new
shipped-shell lines beyond what `scripts/check-shell-lines.sh` allows — see
Done when).

### Decisions the plan settles — do not re-derive them

**Per-(repo, branch) keying, not per-branch.** The plan's decision #93 ("Slice
3 also makes `crossRepoReferences` read the heading form") and cause 3 are
explicit: the fix is not "read more references and still pick one" — it is
"ask every reference's PR state and refuse if any is unmerged." A branch named
in three repos with two still-open PRs must refuse delivery, not merge-and-
ignore the stragglers. `branchesOf`'s existing fold-by-branch-name for
`deferred` and `commits` stays (a branch is deferred only if every mention
defers it, per the comment at deliverability.ts:77-79) — only the single
`prRef` field changes shape to carry one entry per repository.

**`→ #N` (no `owner/repo`) is still same-repo and stays out of this.** The
existing `REFERENCE` regex requires `owner/repo` before `#N`; a bare `→ #12`
is explicitly ignored by `crossRepoReferences` today (test: "ignores a
same-repo reference") and that stays — same-repo PRs are asked through
`ports.host.prMerged(branch)`, unchanged (deliverability.ts:183).

**The `owner/repo@branch` form is not being added.** The plan's decisions
(#92) dropped it: `@` already means a commit in another repository
(`skills/plot/SKILL.md:316,323`), and this slice does not touch that.

**A corpus pair is required, not optional.** Per `docs/shell-and-domain.md`
and `CLAUDE.md`'s "A Shell Script Asks The Domain," `crossRepoReferences` and
`plot-impl-status.sh`'s `annotation_for` are a declared duplicate — one rule,
two implementations, and nothing says which is authoritative. The plan's test
list (Slice 3) requires a corpus test under `packages/domain/corpus/` holding
them against each other on both forms (`→ owner/repo#N` and
`PR: owner/repo#N`). **On a disagreement the branch stops** — adjusting either
side to make the comparison pass is the one move this repo forbids (see
`packages/domain/corpus/README.md`).

### Done when

The plan's `## Done when` is implicit in its Tests section (Slice 3):

- `packages/domain/test/cross-repo-reference.test.ts`: three claim lines
  naming one branch across three repositories give three references (today:
  one, the first); a heading `PR: owner/repo#N` gives one reference (today:
  none — only `→` is read).
- `packages/board/test/unit/deliverability.test.ts`: #11 merged, #22 and #33
  open for one branch name across three repositories refuses and names all
  three unmerged ones (today: `deliverable: true`, having asked only #11).
- A corpus pair under `packages/domain/corpus/` holds `crossRepoReferences`
  against `plot-impl-status.sh`'s `annotation_for` on both reference forms —
  this is the assertion that the shell and the domain still agree after both
  change, not a nice-to-have.

Plus the repo's gates: run `node ../plot/scripts/board/plot-local-checks.mjs`
before each push and run what it prints — it resolves the related domain and
board tests plus `tsc --noEmit` for the packages this slice touches
(`packages/domain/**`, `packages/board/src/**`). The suites in the `CI suites`
config key (`test:e2e`, `test:contracts`, `test:board`, the domain's coverage
run, `test/reconcile/*.test.mjs`) run in CI on every PR — do not run them
locally as a matter of course; `test:e2e` especially is CI's gate, not a local
one (CLAUDE.md "Testing").

**`scripts/check-shell-lines.sh` applies to `plot-impl-status.sh`.** It
refuses a PR whose shipped shell under `skills/` is longer than at its merge
base. Re-keying `BRANCH_LINES` and `annotation_for` by `(repo, branch)` will
likely add lines (an extra loop dimension, or a composite key) — if it does,
remove an equal number of shell lines elsewhere in the same change, or fold
the comparison into the bundle the corpus test already reads through rather
than growing the `.sh` file further. The gate counts commands, not source
lines, and stores no number — there is no override.

### Bookkeeping

Open the PR through the controller once the branch has a commit:

```bash
../plot/scripts/plot-open-pr.sh          # current branch
../plot/scripts/plot-open-pr.sh --draft  # while work is still moving
```

Do not run `gh pr create` — it takes its title from the last commit subject,
not the plan's wave heading. When the PR exists, append `→ #<number>` to this
branch's line in the plan's `## Slices` section (the "Per-line references"
heading, currently reading `` - `bug/a-cross-repo-reference-is-read-per-line` — `crossRepoReferences`, `branchesOf` and `plot-impl-status.sh` key references by (repository, branch); `crossRepoReferences` reads `PR: owner/repo#N` on headings `` with no `→ #N` yet). Push the first real commit as soon as it exists.

### Scope guard

This branch owns:

- `packages/domain/src/rules/cross-repo-reference.ts` and its test
- `packages/board/src/server/controllers/deliverability.ts` (the `branchesOf`
  function and its `NamedBranch`/`prRef` shape) and its test
- `skills/plot/scripts/plot-impl-status.sh` (the `BRANCH_LINES` /
  `annotation_for` keying)
- a new corpus test pairing the two

It does not own the parser (`plot-plan-meta.sh`, `unread_branch_items` — wave
1, merged) or the `deliver()` refusal shape (`slices-unread` — wave 2,
merged). It does not touch the plan template or `/plot-idea` documentation
(wave 4, `docs/a-foreign-slice-has-one-written-form`, waits on this one
landing first since it documents the form this slice makes safe to repeat).

No other branch is currently in flight on this plan (waves 1 and 2 merged,
wave 4 not yet started and blocked on this one).

If you find something the plan did not anticipate, report it rather than
improvising outside scope.
