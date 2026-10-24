## Implementation brief — a-mixed-reset-leaves-the-main (wave Brief step)

- **Plan (canonical):** `docs/plans/2026-10-24-a-mixed-reset-leaves-the-main.md` on `main`
- **Approved:** 2026-10-24, Jan Wloka, plan-PR #2631 merged
- **Branch:** `bug/a-mixed-reset-leaves-the-main-brief` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** per repo convention — `scripts/check-*.sh` gates plus the usual PR review

This branch waits on `bug/a-mixed-reset-leaves-the-main-gate`, which is merged
(PR #2640, `2601e95cf`). Nothing else blocks it.

### What to build

The gate slice closed defect 3 (`gatesStrandingReset` in
`packages/domain/src/rules/main-checkout-write.ts` now refuses a mixed
`git reset` in the main checkout even for a marked writer). This slice closes
defects 1 and 2 from the plan's Motivation — the ones the gate cannot reach
because they are about what a brief/implement run does *before* it would ever
need to reset:

1. The brief step commits on a stale `HEAD` without first fetching
   `origin/main`.
2. The brief step writes a second brief when `origin/main` already holds one.

The incident: at 22:09:28 `origin/main` already held a brief commit for a
slug (`3badb5a70`). At 22:15:09 a second brief commit for the **same slug**
(`91b537837`) was made on a `HEAD` 8 commits behind `origin/main` — the run
never fetched first, so it could not have known the brief already existed.
The push of `91b537837` was rejected (it is on no remote branch), and 30
seconds later something reset `HEAD` to `origin/main` without `--hard`,
stranding the working tree. The gate slice stops the *reset* from landing a
reversal; this slice stops the run from getting into that state at all.

### The decisions the plan settles — do not re-derive them

**Fix the write path, not just the gate.** The gate refusing a mixed reset is
a backstop for whatever still goes wrong; it does not make the run correct.
An agent that still commits on a stale `HEAD` and gets its push rejected will
hit the gate's refusal on every recovery attempt and have no path forward
except the one this slice builds (re-cut in a disposable worktree). Leaving
only the gate in place turns every rejected push into a dead end instead of a
self-recovering run.

**Fetch before commit, not before brief-authoring.** The staleness has to be
checked immediately before the commit, not once at the top of the run —
`/plot-implement` step 2's staleness preflight is about the *plan's*
assumptions drifting, a different kind of staleness than the checkout's
`HEAD` drifting during the run's own execution. Both can be true at once; this
slice's fetch belongs at the commit step (`SKILL.md` step 4's "Record
Started" / brief-write mechanics), not folded into step 2.

**Skip-the-commit is the dedup, not a merge or a diff.** Once `origin/main` is
fetched, check whether it already holds a brief at the target path
(`briefPath(branch)`, per `brief-path.js`) before writing a new commit. This
mirrors how `plot-dispatch.sh`'s `brief_asked` already treats "asked" as
"command started," never "brief written" (`brief-ask.ts`'s own docstring:
*"ASK, DO NOT AWAIT"*) — the fix here is symmetric on the writing side: if the
brief is already there, this run is not the one that gets to add a second
commit for the same slug.

**Recovery from a rejected push is a re-cut, never a reset.** The plan's
Design section is explicit: an agent that recovers from a rejected push
"re-cuts in a disposable worktree, or resets with `--hard` only on files it
owns. It never runs a mixed reset that strands the old tree." The gate slice's
own refusal text (`mainCheckoutWriteRefusal`) names the same two options. Use
the worktree form here — it is what this very brief was written through (see
Bookkeeping), so it is proven as the pattern the implementing agent should
also follow when a push lands behind it mid-run.

**Where the fetch/skip/re-cut logic lives.** The plan's Design section names
two targets: the brief/implement **prompts** (what the spawned agent is told
to do) and `skills/plot-implement/SKILL.md` step 4's prose (what `/plot-implement`
itself does when run, whether spawned or interactive). `composeImplementPrompt`
in `packages/fleet/src/shared/implement-run.ts:114` and `briefAskPrompt` in
`packages/fleet/src/shared/brief-ask.ts:73` are the two prompt-composing
functions a fix here is likely to touch — both currently just point at
`/plot-implement`'s skill text rather than describing the brief in their own
words (`brief-ask.ts`'s docstring: *"a prompt describing the brief here would
be a second author"*), so the fetch/skip/re-cut mechanics belong in the skill
text those prompts defer to, not duplicated into the prompts themselves.

### Done when

The plan's `## Done when` is implicit in its Changelog line: "An unattended
agent that recovers from a rejected push no longer leaves the main checkout's
working tree behind its `HEAD`." Concretely:

- `/plot-implement`'s brief-commit step (step 4, and step 5's `Started:`
  commit) fetches `origin/<default branch>` immediately before committing,
  not only at step 2's staleness preflight.
- Given `origin/<default branch>` already holds a brief at the target slug's
  brief path, the step commits nothing new for that slug — add or extend a
  test proving this: a second run against a slug whose brief already landed
  on the remote produces no second brief commit.
- A rejected push during this step is recovered by re-cutting in a disposable
  worktree (the `.worktrees/` pattern this brief itself used), never by a
  mixed `git reset`. If the implementation also exercises the gate slice's
  refusal as a test fixture, confirm the test asserts the *recovery* succeeds
  afterward, not only that the mixed reset is refused once.
- The existing gate behaviour (`gatesStrandingReset`, merged in PR #2640) is
  unchanged by this slice — this slice's job is to make the gate's refusal
  something the run never triggers in the first place, not to loosen or
  duplicate the gate.

Plus: this repo's gates. `scripts/check-shell-lines.sh` refuses a PR whose
shell under `skills/` grows past its merge base — if this fix touches a `.sh`
file (unlikely; the plan's Design section points at prompts and skill prose,
both outside `skills/plot/scripts/`), pay for the growth in the same change.
Run `node skills/plot/scripts/board/plot-local-checks.mjs` before each push
and run what it prints; the suites in this repo's `CI suites` config key run
in CI, not locally — don't add them to a local loop.

### Bookkeeping

Open the PR through the controller, not `gh pr create`:

```bash
skills/plot/scripts/plot-open-pr.sh
```

It reads which plan names this branch and titles the PR from the plan's wave
heading ("Brief step"). Once it exists, append `→ #<number>` to this branch's
line under the `### Brief step` heading in
`docs/plans/2026-10-24-a-mixed-reset-leaves-the-main.md`. Push the first real
commit as soon as it exists.

### Scope guard

This branch owns the brief/implement commit mechanics: the fetch-before-commit
and skip-when-already-present logic (wherever it lands — prompt text in
`brief-ask.ts`/`implement-run.ts`, or `skills/plot-implement/SKILL.md` step 4/5
prose, per "The decisions the plan settles" above), and the rejected-push
recovery path. It does not own:

- `packages/domain/src/rules/main-checkout-write.ts`'s `strandsTree` /
  `gatesStrandingReset` or their gate wiring in
  `packages/board/src/server/entry/gate.ts` — that's the Gate slice, merged
  (PR #2640). Read-only reference for this slice.
- The staleness preflight in `/plot-implement` step 2 (plan-assumption drift)
  — a different concern from this slice's run-time `HEAD` drift, per "The
  decisions the plan settles" above.

The plan's first Open Question — which spawn made the 22:15 commit — is still
unresolved: the Gate slice's commit message calls `PLOT_MAIN_CHECKOUT_WRITER=1`
"the likely actor," not a confirmed one. If the investigation while building
this slice finds the commit was not made by the `Brief command`/`Implement
command` path at all, report which spawn actually made it rather than guessing
a second fix target.
