## Implementation brief — board-reads-git, branch 2 of 2

- **Plan (canonical):** `docs/plans/2026-08-16-board-reads-git.md` on `main`
- **Approved:** 2026-08-16, jwloka, plan-PR #120 merged
- **Branch:** `bug/dispatch-records-started` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** PR review per repo convention; CI `validate` must pass
- **Wave:** Fixes — runs **concurrently** with `bug/board-claimed-from-git`.
  Stay inside `skills/plot/scripts/plot-dispatch.sh` and
  `test/reconcile/dispatch.test.mjs`. Do **not** touch `packages/board/**` and
  do **not** rebuild the board artifact — that is the other branch, and the
  built bundle is where parallel branches collide.

### What to build

`/plot-dispatch` starts real work and records nothing. The string `Started:`
appears **zero times** in `plot-dispatch.sh`. `/plot-implement` writes that
record in its step 5; dispatch never got the equivalent. So a fanned-out plan
sits in Design badged *Ready* while an agent edits its branch — the board's two
tabs disagreeing by construction, because `toBoardPhase(phase, started)` reads
the plan while the fleet reads refs.

**Write one line per dispatched branch, in `/plot-implement`'s exact shape** so
nothing downstream learns a second format:

    - **Started:** <YYYY-MM-DD>, <who>, `<branch>`

**After the claim push succeeds, never before.** A `Started:` record for a
branch another dispatcher won would be a lie in the file, and the claim is the
only thing that decides who holds a branch.

**Where it is written is the whole difficulty.** `plot-dispatch.sh` finds the
plan in its *local working tree* — `docs/plans/active/<slug>.md` relative to
wherever the dispatcher is checked out — while the board reads the plan from
the **default branch**. Editing the local file in place commits the record to
whatever branch the dispatcher was standing on, and the board never sees it.
That is not hypothetical: it had to be back-filled by hand twice on this repo
on 2026-08-16.

So book through a disposable branch, the way every other Plot command does:

    git checkout -b plot/start-<slug> origin/<default>
      → append the Started line(s)
      → plot-push-main.sh plot/start-<slug> <default>

Use `plot-push-main.sh`, not a bare `git push`: on a repo whose protection is
configured but not enforced, a bare push is waved through silently. That helper
exists for exactly this and reports `clean` / `bypassed` / `unknown` / exit 1 on
`rejected`.

**A failed booking never unwinds a fan-out.** Offline, refused, or beaten to
the ref: by then the worktree exists and the claim is pushed, and those are the
real state. The record is a report *about* that state. Say what failed and
carry on — rolling back real work because a note could not be saved is the
larger damage, and aborting mid-fan-out leaves exactly the inconsistency it
claims to prevent.

### Done when

- A dispatch produces a `Started:` line on the default branch, and the board
  reads the plan as started. Demonstrate it; do not assert it.
- **A failed push leaves the fan-out standing** — worktree present, claim
  pushed, summary still reporting what it dispatched. This is the assertion
  that matters most; every other one can pass while the damage happens.
- **`--dry-run` writes nothing**: no branch, no commit, no push. This is the
  first write `--dry-run` has had to suppress that leaves the repository, so
  pin it with a test rather than a comment.
- `pnpm run test:reconcile` and `pnpm run validate` pass.
- A changeset is present.
- macOS ships bash 3.2: **no `declare -A`**, no bash-4-only constructs. A test
  enforces this.

### Testing note

`test/reconcile/dispatch.test.mjs` already drives the script against scratch
repos. Test the booking against a **local bare remote**, where a push genuinely
succeeds and genuinely fails — never against a real host from CI.

### Bookkeeping

When the PR is created, append `→ #<number>` to this branch's line in the
plan's `## Branches` section on `main`.

### Scope guard

Implement what the plan says. Do not touch the board package. If you find
something the plan did not anticipate, report it rather than improvising
outside scope.
