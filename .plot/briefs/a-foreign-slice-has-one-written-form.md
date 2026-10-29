## Implementation brief — a-foreign-slice-has-one-written-form (wave 4: Foreign slice form)

- **Plan (canonical):** docs/plans/2026-10-28-deliver-passes-a-plan-whose-slices.md on main
- **Approved:** 2026-10-28, Jan Wloka, plan-PR #2827 merged
- **Branch:** `docs/a-foreign-slice-has-one-written-form` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** per repo convention (CI required on main)

This is the plan's last wave. Wave 1 (`bug/deliver-reads-unread-branch-items`
→ #2858), wave 2 (`bug/deliver-refuses-unread-branch-items` → #2877) and wave 3
(`bug/a-cross-repo-reference-is-read-per-line` → #2883) are all merged, so
`main` already carries the per-(repo, branch) fix this wave documents.

### What to build

Today nothing tells a plan author how to write a slice line for a branch that
lives in **another repository**. Three forms exist in the shipped docs and
none of them is it:

- `→ #N` and `→ owner/repo#N` — a PR reference, documented at
  `skills/plot/SKILL.md:324` ("A PR slice is unchanged").
- `→ commit abc1234` / `→ owner/repo@abc1234` — a direct-push commit
  reference, documented at `skills/plot/SKILL.md:300-324` ("Slices Completed
  by a Direct Push").
- Nothing documents a **branch name** in another repository as a plain slice
  claim, before its PR exists or for a repo that reviews by PR.

That gap is exactly how the plan's live case 1 (ewz-kus-portal plan 3853)
happened: six slice lines used one branch name across six repositories, in
whatever prose shape the author guessed, and the parser read none of them as
branch claims (plan "Motivation", cause 1 and cause 4).

Wave 3 made the fix safe to use more than once per plan:
`crossRepoReferences` (`packages/domain/src/rules/cross-repo-reference.ts`)
now returns every `(repo, number)` reference a branch's claim lines name,
keyed by `(repo, branch)` rather than by branch name alone, and reads both
`→ owner/repo#N` and the heading form `PR: owner/repo#N`. This wave's whole
job is to **document** the one written form that uses that fix correctly, in
the three places an author encounters it:

1. **The plan template** (`skills/plot/templates/plan.md`) — the `## Slices`
   section, beside the existing direct-push block (lines 71-77).
2. **`/plot-idea`** (`skills/plot-idea/SKILL.md`) — wherever it currently
   walks an author through writing a slice line for `Impl: other repo`
   (around the ceremony-questions section, lines 190-231 in the version this
   brief was written against — re-check against `main`, since wave 3's merge
   may have shifted line numbers again).
3. **The plot skill** (`skills/plot/SKILL.md`) — beside "Slices Completed by a
   Direct Push" (lines 300-324), since that is where a reader already looks
   for "how do I name a slice outside this repo."

### Decisions the plan settles — do not re-derive them

**The one written form is `` - `<branch>` — <repo>: … → owner/repo#N ``.**
This is stated directly in the plan's Design (Slice 4) and Slices section —
it is not a choice this wave makes, only one it writes down. The backticked
branch keeps the existing `LIST_CLAIM` claim-line shape
(`cross-repo-reference.ts`'s `LIST_CLAIM = /^-\s+\`([A-Za-z0-9_./-]+)\`/`,
read identically regardless of repo), `<repo>` is free prose naming which
repository the branch lives in (for a human reader — the parser does not
read it), and `→ owner/repo#N` is the reference wave 3 now asks per-(repo,
branch). Include a **Bitbucket example** where `owner` is the workspace —
decided explicitly (plan Design, Slice 4) because Bitbucket has no literal
"owner" concept and a reader could otherwise guess a project key instead of
the workspace slug.

**`owner/repo@branch` is not being added, anywhere.** The plan's decision
(#93, "The `owner/repo@branch` form is dropped") is final: `@` already means
a commit in another repository (`skills/plot/SKILL.md:316,323`, "A commit in
another repository cannot be read"), and a second meaning for `@` would make
that line ambiguous. If you reach for `@branch` while drafting the docs,
that is the form being rejected — use `→ owner/repo#N` instead, or, before a
PR exists, the bare backticked branch with no arrow (see next paragraph).

**Before a foreign PR exists, name the branch with no arrow.** The plan's
first open question — "How does a plan name a foreign branch before its PR
exists?" — is answered in `deliverabilityOf`
(`packages/board/src/server/controllers/deliverability.ts:183`): a backticked
branch with no `→ owner/repo#N` reference asks `prMerged(branch)` **in this
repository**, which is wrong for a foreign branch and the reason this needs
documenting rather than left implied. Say plainly that a slice naming a
foreign branch with no PR reference yet will be checked against the wrong
repository's host, so the reference should be added as soon as the foreign
PR opens — the same "push the first real commit, open the PR, append `→
#N`" discipline every same-repo slice already follows.

**This wave touches documentation only.** It does not touch
`cross-repo-reference.ts`, `deliverability.ts`, `plot-impl-status.sh` or
their tests — those are wave 3's, merged. Nothing here changes parsing
behaviour; it changes what an author is told to type.

### Done when

The plan's Tests section (Slice 4) names one parser test and the standing
skill-parsing suite:

- A parser test (`test/reconcile/parser.test.mjs` is the existing home for
  this kind of fixture-against-parser test; confirm the exact file by
  grepping for where wave 1's `unread_branch_items` fixtures and wave 3's
  reference-parsing fixtures live) that the template's own documented
  example — the Bitbucket `` - `<branch>` — <repo>: … → owner/repo#N `` line
  — gives **0 unread branch items** (it must not trip the wave-1 detector)
  and resolves to **one** `owner/repo#N` reference via
  `crossRepoReferences`.
- `pnpm test` passes — it validates that every skill (including the edited
  template and the two edited `SKILL.md` files) still parses.

Plus the repo's gates: run `node ../plot/scripts/board/plot-local-checks.mjs`
before each push and run what it prints. This wave touches no
`packages/domain/**` or `packages/board/src/**` source, so the local-checks
output is likely limited to the reconcile/parser suite and the
skill-structure checks — follow what it actually prints rather than this
guess. The suites in the `CI suites` config key (`test:e2e`,
`test:contracts`, `test:board`, the domain's coverage run,
`test/reconcile/*.test.mjs`) run in CI on every PR — do not run them locally
as a matter of course; `test:e2e` is CI's gate, not a local one (CLAUDE.md
"Testing").

**`scripts/check-shell-lines.sh` is unlikely to apply** — this wave edits
Markdown, not `.sh` files. If a documentation example ends up duplicated into
a shell comment or fixture, re-check it; otherwise no shell-line budget is
spent here.

### Bookkeeping

Open the PR through the controller once the branch has a commit:

```bash
../plot/scripts/plot-open-pr.sh          # current branch
../plot/scripts/plot-open-pr.sh --draft  # while work is still moving
```

Do not run `gh pr create` — it takes its title from the last commit subject,
not the plan's wave heading. When the PR exists, append `→ #<number>` to this
branch's line in the plan's `## Slices` section (the "Foreign slice form"
heading, currently reading `` - `docs/a-foreign-slice-has-one-written-form`
— the template, `/plot-idea` and the plot skill document `` - `<branch>` —
<repo>: … → owner/repo#N `` with a Bitbucket example; `@` stays the commit
form `` with no `→ #N` yet). Push the first real commit as soon as it
exists.

### Scope guard

This branch owns:

- `skills/plot/templates/plan.md` (the `## Slices` section)
- `skills/plot-idea/SKILL.md` (the ceremony-questions / `Impl: other repo`
  guidance)
- `skills/plot/SKILL.md` (beside "Slices Completed by a Direct Push")
- whatever parser test fixture proves the template's example gives 0 unread
  items and one resolved reference

It does not own `plot-plan-meta.sh`'s detector (wave 1, merged),
`deliver()`'s refusal shape (wave 2, merged), or `cross-repo-reference.ts` /
`deliverability.ts` / `plot-impl-status.sh` (wave 3, merged). No other branch
is currently in flight on this plan — this is the last wave.

If you find something the plan did not anticipate, report it rather than
improvising outside scope.
