## Implementation brief — the-merge-controller-cannot-merge-a (wave: Host)

- **Plan (canonical):** [docs/plans/2026-10-19-the-merge-controller-cannot-merge-a.md](../../docs/plans/2026-10-19-the-merge-controller-cannot-merge-a.md) on `main`
- **Approved:** 2026-10-19, Jan Wloka, plan-PR #2101 merged
- **Branch:** `bug/the-merge-controller-cannot-merge-a-host` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** per repo convention (plan PR review)

This is the plan's second and final wave. It waits on
`bug/the-merge-controller-cannot-merge-a-rule`, which merged as PR #2112
("Rule and entry", `a1a554974`) on 2026-10-19 — nothing blocks this branch.

### What to build

The plan's Motivation lists four observed defects from a real field test
against `ewz-kus-portal`. **Three of the four are already fixed on `main`**,
by work that predates this plan:

- Item 1 (short-vs-full sha compared by equality) — fixed in the domain by
  PR #2112 (`sameCommit`, `packages/domain/src/rules/same-commit.ts`), and
  fixed in `plot-host.sh` itself by the earlier PR #2067 ("Bitbucket merge
  pin", commit `e63977418`). `plot-host.sh`'s `pr-merge --match-head` arm for
  Bitbucket (`skills/plot/scripts/plot-host.sh:3963`) already re-reads the
  head via `bb pr view` and matches it against the pin by prefix (7+ hex,
  case-insensitive) — the same rule `sameCommit` encodes. Five tests already
  cover it (`test/reconcile/host.test.mjs:596-648`): matching head merges,
  moved head refuses, a 12-character Bitbucket head matches a 40-character
  pin and vice versa, a non-extending pin refuses, and a sub-7-character pin
  refuses. **Nothing to do here except pair it with the domain rule (below).**
- Item 2 (`checks-unbound` on Bitbucket) — explicitly out of scope; it is
  #2075's plan (`2026-10-19-jenkins-checks-never-bind-to-the.md`).
- Item 4 (short `mergeCommit`) — the plan's own default is to leave it short;
  nothing to do.
- **Item 3 is the real gap, and it is not merely unfixed — it is asserted as
  correct by a passing test.** `skills/plot/scripts/plot-host.sh`'s `pr-merge`
  case has three arms: GitHub (refuses with no `--match-head`, line 3947),
  Bitbucket pinned (prefix-matches, line 3963), and the final `else` —
  Bitbucket with **no** `--match-head` at all (lines 3959-3962) — which
  still runs `bb pr merge` unconditionally. `test/reconcile/host.test.mjs:874`,
  `'host: pr-merge bitbucket merges with no pin'`, locks in exactly this: it
  calls `pr-merge 5 --squash --delete-branch` with no `--match-head` and
  asserts the merge call ran. That test needs to flip from proving the bug to
  proving the fix.

  The fix: give the unpinned Bitbucket arm the GitHub arm's refusal, with the
  GitHub arm's wording pattern (`plot-host: pr-merge: <backend> needs
  --match-head <sha>; nothing was merged`, exit 1, zero `bb` calls). Bitbucket
  has no `--match-head-commit`-equivalent precondition on its merge endpoint
  (that's why the pinned arm re-reads the head itself, per the Notes two
  paragraphs below `CLAUDE.md`'s *One Answer To "Did This Land"* section) —
  so the refusal here is the adapter's own job, not something delegated to
  the host API.

### The decisions this plan settles — do not re-derive them

**The prefix-match rule for the pinned path is not new work for this
slice — it shipped in PR #2067, well before this plan existed.** Do not
re-implement `sameCommit`-equivalent logic in the shell; it is already at
`plot-host.sh:3963` and already tested. The only shell change this slice
makes is adding the refusal to the *unpinned* arm.

**The shell duplicates the domain's rule, and that duplication must be
declared, per `CLAUDE.md`'s *A Shell Script Asks The Domain*.** The prefix
match at `plot-host.sh:3963` already carries a comment naming the domain
rule it mirrors (`"matches by prefix, 7+ hex (domain's sameCommit)"`), but no
corpus test yet proves the two agree. The plan says this pairing "joins the
corpus tier at `packages/domain/corpus/`" — add a corpus test (follow the
shape of the existing ones, e.g. `pr-merged.corpus.test.ts`) that runs
`sameCommit` against representative sha pairs and compares the verdict to
the shell's own prefix logic. On a disagreement, the branch stops — do not
adjust either side to force agreement.

**The GitHub arm's refusal text is the template for the Bitbucket one.**
`plot-host.sh:3947`: `"plot-host: pr-merge: github needs --match-head <sha>;
nothing was merged"`, exit 1. Match that shape with `bitbucket` substituted,
so a caller parsing the message for the backend name finds it in the same
place.

**`PLOT_BB_SKIP_CAP_CHECK=1` is already set by the existing Bitbucket
`pr-merge` tests** (e.g. `test/reconcile/host.test.mjs:601`) — carry it into
whatever test replaces or extends line 874-876, or the new refusal test will
fail on an unrelated capability-check path rather than exercising the one
under test.

### Done when

The plan's `## Done when` section is empty in the plan file itself (none is
written under that heading), so the specification is the Motivation's item
3 plus the Design section:

- `plot-host.sh pr-merge` on Bitbucket with no `--match-head` refuses, exit
  1, and makes **zero** `bb` calls beyond what capability-checking already
  requires — assert this the same way the existing head-moved test does
  (`assert.notDeepEqual(argvOf(stubs.bbArgv), ['pr', 'merge', '5'], ...)`),
  not just on the exit code, because an assertion on exit code alone would
  pass even if the merge ran and then something else failed.
- `test/reconcile/host.test.mjs:874`'s `'host: pr-merge bitbucket merges with
  no pin'` no longer exists in a form that asserts the old behavior — either
  rewritten to assert the refusal, or replaced by a differently-named test
  that does. Leaving both the old assertion and a new one would leave the
  suite self-contradictory.
- The pinned Bitbucket path (lines 596-648) is untouched and still green —
  this slice must not regress the already-shipped prefix match while fixing
  the unpinned arm.
- A corpus test in `packages/domain/corpus/` pairs `sameCommit` against the
  shell's prefix check and passes.
- The GitHub arm (`plot-host.sh:3947-3957`) is untouched — this slice is
  Bitbucket-only.

Plus the repo's standing gates: `node skills/plot/scripts/board/plot-local-checks.mjs`,
run before each push, and run what it prints (the suites in the `CI suites`
config key run in CI, not locally — do not run them as a matter of course).
A changeset is needed per `CLAUDE.md`'s Versioning section (patch-level bug
fix to `plot`), with the description first and any `bumps:`/`plan:` block
last — the `plan:` line, if included, may name
`docs/plans/2026-10-19-the-merge-controller-cannot-merge-a.md`.

**Shell gate:** `scripts/check-shell-lines.sh` refuses a PR whose shell under
`skills/` is longer than at its merge base. The fix adds one refusal line to
`plot-host.sh`'s `else` arm — a handful of lines. If that pushes the count
over budget, remove shell elsewhere in the same change, or move the check
into the domain and reach it through a bundle; the gate has no override.

### Bookkeeping

Open the PR through the controller once the first real commit exists:

```bash
skills/plot/scripts/plot-open-pr.sh          # on the current branch
```

Never `gh pr create` directly. When the PR is created, append `→ #<number>`
to this branch's line in the plan's `## Slices` → `### Host` section.

### Scope guard

This branch owns: `skills/plot/scripts/plot-host.sh` (the `pr-merge` case's
`else` arm only), `test/reconcile/host.test.mjs` (the `pr-merge bitbucket`
tests), and a new file under `packages/domain/corpus/` for the corpus test.
It does not touch `packages/domain/src/rules/same-commit.ts`,
`packages/domain/src/workflows/merge.ts`, or `packages/board/src/server/entry/main.ts`
— those are the Rule slice's and are already merged.

No other open branch or PR touches `plot-host.sh`'s `pr-merge` case or these
lines of `host.test.mjs` as of 2026-10-19 — checked via `gh pr list --state
open` and the remote branch list. If you find something the plan did not
anticipate, report it rather than improvising outside scope.
