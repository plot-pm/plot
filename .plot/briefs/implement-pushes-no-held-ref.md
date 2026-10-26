## Implementation brief — implement-leaves-the-main-checkout-on (wave Ref)

- **Plan (canonical):** `docs/plans/2026-10-24-implement-leaves-the-main-checkout-on.md` on `main`
- **Approved:** 2026-10-24, Jan Wloka, plan-PR #2471 merged
- **Branch:** `bug/implement-pushes-no-held-ref` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** per repo convention — `scripts/check-*.sh` gates plus the usual PR review

This branch waits on `bug/implement-restores-the-checkout`, which is merged
(PR #2538, `f2bc395a`). Nothing else blocks it.

### What to build

Fix slice 1's finding at its root: `/api/implement`'s `--brief-only` step
must push no ref the fleet's queue reads as a claim. The bug report
(#2162) observed a real push — `plot-reads-as-an-unknown-tracker` was left
`ref_held: true` for 90 minutes with `worker: ended` and no agent, because
a `--brief-only` run committed and pushed a Started-only commit straight
to the slice branch on origin.

`claimedBranches()` (`packages/fleet/src/shared/queue-reading.ts:71`) is
the read side of the bug: "**a ref IS a claim**" — there is no second
signal (no commit count, no agent liveness) that distinguishes a
Started-only push from a worked one. So the fix is on the write side:
whatever path in `/plot-implement` step 3/5 or `implement-run.ts` still
pushes a ref during a `--brief-only` run has to stop.

`implement-run.ts:107-111`'s own docstring on `composeImplementPrompt`
already asserts the target state — "**It pushes no claim ref** and cuts
no worktree, because under the registry model nobody works a claim this
step pushed" — and `skills/plot-implement/SKILL.md` step 3 already reads
"**`--brief-only` skips this step**: no checkout, no claim push, no
worktree." Both read correctly on current `main` (verified at dispatch:
no drift since plan approval). That means the push the bug report
observed did not come from the documented step-3 path — track down which
code path actually ran and wrote `92111c8f9`-like commits. Candidates: the
brief-write/commit-push sequence a board route runs around step 4
("push the first real commit as soon as it exists" bookkeeping duty),
or a stale skill build that predates the `--brief-only` gating added to
step 3/5.

### The decisions the plan settles — do not re-derive them

**The fix is on the write side, not the read side.** `claimedBranches`
reading every remote ref as a claim is correct and load-bearing — it is
the whole locking mechanism (`SKILL.md`: "the push IS the claim... There
is no lock manager and none is wanted"). Making the read side smarter
(e.g. ignoring Started-only commits) would duplicate the push/no-push
decision in two places and both would need to agree forever. Don't widen
`claimedBranches`; narrow what gets pushed.

**Order matters, and this slice's position in it is deliberate.** The
plan sequences by blast radius: restore-the-checkout (1, merged) before
no-held-ref (2, this slice) before dead-claim-releases (3, not started).
Slice 3 is explicitly a *mitigation* for exactly this failure mode (a
stale claim with no agent releasing itself) — it is not a substitute for
this slice. Building the release rule first without fixing the push would
leave the 90-minute wait in place for every run until the release timer
fires; this slice removes the cause, slice 3 bounds the blast radius of
whatever still slips through.

**Scope is the push mechanism, not retroactive cleanup.** A ref already
held by a dead Started-only commit (like the #2077 and #2154 cases in the
Motivation section) is slice 3's and a human operator's problem, not
this slice's — this slice stops new ones from being created.

### Done when

The plan's `## Done when` is implicit in its Changelog line: "a slice
branch that holds only the Started record no longer blocks dispatch."
Concretely:

- A `--brief-only` `/api/implement` (or `plot-dispatch-command.mjs`-style)
  run against a plan with no existing branch for the target slug produces
  **no push to origin** — the brief and `Started:` record land only on
  the branch the run is already on (typically `main`, per slice 1's fix),
  never on a newly-created slice branch.
  - Add or extend a test proving this: a run that would previously have
    pushed `bug/<slug>` now leaves no such ref on the remote. A naive fix
    that only suppresses the push in one call site and misses a second
    (e.g. a board route's own commit-and-push around brief bookkeeping)
    would pass a narrower test that only checks the obvious path — so the
    test should assert on the actual git remote state after the run, not
    on a mocked call count.
- `claimedBranches()` and the auto-dispatch rule it feeds
  (`packages/domain/src/rules/auto-dispatch.ts`) need no change — if the
  fix requires touching them, that is a sign the write-side root cause
  was not found.
- A full (non-`--brief-only`) `/plot-implement` run — the kind a human
  runs interactively to actually work a slice — is unaffected: it still
  claims by pushing, per step 3's unchanged "claim first, work second"
  mechanics.

Plus: this repo's gates. `scripts/check-shell-lines.sh` refuses a PR whose
shell under `skills/` grows past its merge base — if this fix touches a
`.sh` file, pay for the growth in the same change (remove shell
elsewhere, or move the rule into the domain behind a bundle). Run
`node skills/plot/scripts/board/plot-local-checks.mjs` before each push
and run what it prints; the suites in this repo's `CI suites` config key
run in CI, not locally — don't add them to a local loop.

### Bookkeeping

Open the PR through the controller, not `gh pr create`:

```bash
skills/plot/scripts/plot-open-pr.sh
```

It reads which plan names this branch and titles the PR from the plan's
wave heading ("Ref"). Once it exists, append `→ #<number>` to this
branch's line under the `### Ref` heading in
`docs/plans/2026-10-24-implement-leaves-the-main-checkout-on.md`. Push
the first real commit as soon as it exists.

### Scope guard

This branch owns the push/claim mechanics inside
`packages/fleet/src/shared/implement-run.ts` and whatever board route or
skill step actually issues the stray push (to be located first — see
"What to build"). It does not own:

- `packages/domain/src/rules/auto-dispatch.ts` or `claimedBranches` itself
  — read-only reference for this slice, per "The decisions the plan
  settles" above.
- `packages/board/src/server/release-claim.ts` — that's
  `bug/dead-claim-releases` (wave 3, `<!-- builds: a domain rule naming an
  empty claim ref releasable -->`), not yet started and waiting on
  nothing from this slice.
- `skills/plot-implement/SKILL.md` step 3/5 prose — already correct;
  touch only if the investigation finds the skill text itself is what a
  runner is failing to follow, which would be a different kind of defect
  (prose vs. gate) worth calling out explicitly rather than silently
  rewording.

If the investigation finds the push happening somewhere the plan's three
slices did not anticipate (e.g. a fourth code path entirely outside
`implement-run.ts` and the board/skill chain), report it rather than
expanding this branch's diff to cover it unannounced.
