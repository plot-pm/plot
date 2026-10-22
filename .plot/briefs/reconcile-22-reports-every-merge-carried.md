## Implementation brief — reconcile-22-reports-every-merge-carried

- **Plan (canonical):** `docs/plans/2026-10-22-reconcile-22-reports-every-merge-carried.md` on main
- **Approved:** 2026-10-22, Jan Wloka, plan-PR #2348 merged
- **Branch:** `bug/reconcile-22-reports-every-merge-carried` (base: `main`)
- **Ends as:** one PR to main
- **Review of the code:** repo convention (CI green + review)

The plan's only slice. Nothing waits on it and it waits on nothing.

### What to build

`plot-reconcile-scan.sh` §22 (`skills/plot/scripts/plot-reconcile-scan.sh:2841-2944`)
prints "(none — every merge that shipped code in this window carried a
changeset)" over 40 merges on ewz-kus-portal, a repository with no
`.changeset/` directory at all. The statement is false — no merge there
*could* carry a changeset — and silence reads as "nothing drifted", which is
the one direction this report must never be lenient in.

Two independent defects, both in that block:

1. **`:2914`'s shipped-code pattern is Plot's own layout**, hardcoded:
   `^(packages/[^/]+/src/|skills/)`. ewz keeps code under
   `backend/…/src/main/java` and `frontend/`, so `code` is always 0, every
   merge is skipped by the `[ "${code:-0}" -gt 0 ]` guard at `:2916`, and the
   empty result prints as "every merge … carried a changeset" instead of
   "no merge touched code I can recognize".
2. **The merge-subject parser at `:2881-2893` reads only two host forms** —
   `Merge pull request #N from <owner>/<branch>` and git's own
   `Merge branch '…'` / `Merge remote-tracking branch '…'`. It has no case for
   Bitbucket's `Merged in <branch> (pull request #N)`, so on a Bitbucket repo
   `nc_branch` stays empty, the `idea/*`/`changeset-release/*` exclusion at
   `:2898-2900` never fires (an idea-branch merge gets reported as a finding),
   and `nc_pr` (`:2921-2926`, matched only against `"Merge pull request #"*`)
   stays empty too, so the finding names only a bare SHA.

### The decisions the plan settles — do not re-derive them

**Add a third top-level guard, before the walk, not a fourth exclusion inside
it.** Section 18 already has the pattern this plan extends — "silence about a
check that could not run reads as *nothing drifted*" — at `:2850-2854`, which
prints `(not evaluated — neither origin/$MAIN nor $MAIN is readable)` and
skips the whole loop when the ref can't be resolved. §22 needs the same shape:
when the repository keeps no changesets at all, print
`(not evaluated — this repository keeps no changesets)` and skip the walk
entirely — never enter the per-merge loop, never increment `nc_seen`. Do not
try to make the per-merge loop "skip gracefully" merge-by-merge; that produces
the exact silent-empty-reads-as-clean failure this plan reports.

**"Keeps no changesets" is absence of `.changeset/` on `nc_ref`, not absence
of a changeset added in the window.** The plan's own Open Questions section
flagged both readings and recommends the first: cheap (one `git ls-tree` or
`git cat-file -e` against `nc_ref`, no walk needed) and exact for the
motivating case. The second reading (a repo that *used* changesets and
stopped) is a different, unreported failure mode — don't conflate them. Check
`nc_ref` (the resolved ref from `:2848-2849`), not the working tree: the
existing guard at `:2850` already establishes that pattern — Plot's own
`.changeset/` could be present locally and absent from history, or vice versa
under a sparse checkout, and the report is about what the *history* carried.

**Shipped-code paths come from a new `## Plot Config` key, defaulting to
Plot's current literal.** The plan's Open Questions weighed deriving the
pattern from the repo's own changesets (fails for a repo whose first
changeset doesn't exist yet — exactly the ewz case) against an explicit key,
and recommends the key. Add something like a `Shipped code paths:` (or
similarly named) config entry read via
`skills/plot/scripts/plot-config.sh get <key>`, with the literal
`^(packages/[^/]+/src/|skills/)` as the default so **this repository's own
output does not change** — that's the regression bar, not just "tests still
pass". Grep `:2914` is the only call site to change.

**Read the Bitbucket subject form by extending the shell `case`, with a
corpus test pinning it against `rules/merge-subject.ts`'s pattern — do not
import the TypeScript rule into this bash script.** `docs/shell-and-domain.md`
and `CLAUDE.md`'s *A Shell Script Asks The Domain* place this exactly on the
"runs once per operator command → fine to duplicate, as long as it's
declared" side, not the "runs once per agent per pass" side that would demand
calling the bundle. `rules/merge-subject.ts` already parses
`Merged in <branch> (pull request #N)` for the wave gate (see its `forms`
contract and `BRANCH`/`NUMBER` placeholders) — read that file for the exact
literal shape, add a matching `case` arm here for `nc_branch` AND wire
`nc_pr` extraction for it (today `nc_pr` only matches
`"Merge pull request #"*`, so even fixing `nc_branch` alone still drops the
PR number on Bitbucket). Add the pair to `packages/domain/corpus/` per the
corpus-tier contract in `CLAUDE.md` — on disagreement the branch stops; do
not adjust either side to make the comparison pass.

**Preserve the existing exclusions untouched.** `idea/*` and
`changeset-release/*` (`:2898-2900`), the squash-merge handle (`:2869`), and
the "merge INTO a branch is not a delivery" spine check (`:2871-2874`) are
orthogonal to both defects here and must keep firing exactly as before —
verify this by running the existing reconcile tests, not by re-reading the
code.

### Done when

The plan's `## Done when` is implicit in its Motivation and Notes — treat
these as the specification:

- A sandbox repo with **no `.changeset/` directory** and merge commits
  touching non-Plot code paths (e.g. `backend/` or `frontend/`) makes §22
  print `(not evaluated — this repository keeps no changesets)` — not
  `(none — …)` and not a per-merge false-negative silence.
- The same repo, if it names its own shipped-code paths via the new config
  key, correctly finds merges that lack a changeset (round-trip: prove the
  guard doesn't just suppress everything).
- A sandbox repo with a `Merged in idea/x (pull request #7)` merge subject
  excludes that merge (the `idea/*` guard fires on Bitbucket, same as it does
  on `Merge pull request #7 from owner/idea/x`).
- A sandbox repo with `Merged in bug/y (pull request #9)` on a merge that
  ships code and no changeset reports `PR #9 (merge <sha>) — bug/y merged N
  shipped-code file(s), added no changeset` — i.e. both branch name and PR
  number are recovered, not just one.
- This repository's own `plot reconcile` output for §22 is unchanged (the
  config key defaults to the current literal, and plot itself does carry
  changesets, so it never hits the new "not evaluated" branch).
- The corpus test comparing the shell's new Bitbucket-subject parsing against
  `rules/merge-subject.ts` passes, and would fail if either side changed its
  literal independently.

Plus the repo's gates: no generated bundle in the diff
(`scripts/check-no-bundle-diff.sh`), a changeset for this `plot` change, and
whatever `scripts/check-*.sh` the local-checks runner lists. Run
`node ../plot/scripts/board/plot-local-checks.mjs` (resolved from
`skills/plot-implement/` — i.e. `skills/plot/scripts/board/plot-local-checks.mjs`
from the repo root) before each push and run what it prints; the suites in
the `CI suites` config key run in CI, and a failure there comes back as a
correction. List no full suite.

**`scripts/check-shell-lines.sh` is a gate, not a courtesy.** It refuses a PR
whose shell under `skills/` is longer at the merge base than at HEAD. This
slice adds lines to `plot-reconcile-scan.sh` (a new guard branch, a new case
arm, a new config read) — if that growth isn't absorbed by moving the
duplicated subject-matching logic into the domain-rule corpus pairing
described above (which is the intended design, not optional polish), it must
be paid for by removing an equal number of shell lines elsewhere in the same
change. The gate stores no number and grants no exemption.

### Bookkeeping

Open the PR through the controller once the branch has a real commit:

```bash
../plot/scripts/plot-open-pr.sh          # current branch
../plot/scripts/plot-open-pr.sh --draft  # while still moving
```

Never `gh pr create` directly. Push the first real commit as soon as it
exists — do not hold a working tree of uncommitted changes.

When the PR is created, append `→ #<number>` to this branch's line in the
plan's `## Slices` section (`bug/reconcile-22-reports-every-merge-carried —
…`).

### Scope guard

This branch owns:

- `skills/plot/scripts/plot-reconcile-scan.sh` (the §22 block, `:2841-2944`,
  plus whatever `## Plot Config` doc line records the new key)
- `test/reconcile/` — a new contract test per the plan's Notes section
  (sandbox repo, no `.changeset/`, merges touching non-Plot code paths; a
  second case for the Bitbucket subject form)
- `packages/domain/corpus/` — the new corpus pairing for the Bitbucket
  subject pattern against `rules/merge-subject.ts`, if duplicated in shell
  per the decision above
- A changeset for `plot` (patch — bug fix, no new section)

This is the plan's only branch and only slice — no sibling branches to
collide with. If the fix turns out to need a change to
`rules/merge-subject.ts` itself (rather than reading it as reference and
duplicating its pattern), that is outside what this plan approved — report it
rather than expanding scope silently.

If you find something the plan did not anticipate, report it rather than
improvising outside scope.
