## Implementation brief — a-slice-can-wait-on-another-plan (slice: Declaring)

- **Plan (canonical):** `docs/plans/2026-09-01-a-slice-can-wait-on-another-plan.md` on `main`
- **Approved:** 2026-09-01, Jan Wloka, in-session (1 round)
- **Branch:** `feature/a-branch-names-what-it-waits-on` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** CI green, then squash-merge

First of three, and both others read what this defines. **Parser and contract only — nothing
consumes it in this slice**, so the shape settles before three components depend on it.

### What to build

`plot-plan-meta.sh` parses a per-branch annotation naming one branch this branch waits on:

    - `feature/x` <!-- waits: bug/the-budget-knows-which-bucket-it-spent --> — description

exposed as `waves[].branches[].waits_on`, beside the existing `deferred`, `deferred_reason`
and `claimed`.

### The precedent is exact — copy it, do not invent

`deferred_reason` is parsed the same way, and its comment carries the trap:

> Extracted the same way and in the same place as the claim note, for the same reason:
> **`match()` in the branch loop below clobbers `RSTART`/`RLENGTH`**, so anything read from
> the whole line must be read **before** it runs.

**That is the one implementation detail most likely to cost an hour.** Read `waits:` where
`claim_note` and `deferred_reason` are read, not where it feels natural.

**And the awk region is single-quoted in the shell.** Never use an apostrophe anywhere in a
comment you add there — `awk's` closes the quote early and produces syntax errors far from the
edit.

### The decisions the plan settles — do not re-derive them

**One prerequisite per branch, never a list.** A slice needing two has not been cut finely
enough, and a list invites a graph nobody wants to debug. Parse one; if a second appears, the
later one wins or the parse fails — decide and test it, but do not build a list.

**`waits:` and `deferred:` are different annotations for different things.** `deferred:` is a
judgement — *this work was given up on* — and `waits:` is a fact a script can check. **They
must not interfere on one branch**, and a test asserts that.

**`waits_on` is a branch name, not a plan.** The prerequisite is a branch in this repo. Not
cross-repo, not a plan slug — a plan can have many branches and *"wait for the plan"* is not a
checkable claim.

### Done when

- `waves[].branches[].waits_on` carries the branch name, and is **absent** — not empty string —
  where no annotation exists. The board distinguishes absent from empty elsewhere and this must
  match.
- **A branch carrying BOTH `deferred:` and `waits:` parses both**, neither clobbering the
  other.
- **A `waits:` naming a branch no plan declares still parses.** The scan turns that into
  `blocked` in the next slice; the parser's job is to report what the file says, not to
  validate it.
- The whole estate parses unchanged otherwise — `test/reconcile/parser.test.mjs`'s estate-wide
  differential is the gate, and it must stay green across all 188 plans.
- `pnpm run test:reconcile`, `pnpm run typecheck`, `pnpm build:board`, changeset
  (`'plot': patch`, description first).

**Do not run `pnpm run test:e2e` locally** — CI's gate, its own machine.

**Prove the parser test is discriminating.** Add a `waits:` to a fixture, confirm the new
assertion fails without your change, then apply it. A test that passes against unparsed input
is testing nothing — three inert mutations were caught in this repo on 2026-09-01.

### Bookkeeping

- Push the first real commit as soon as it exists — the ref push is the claim.
- When the PR exists, append `→ #<number>` to this branch's line under `## Branches`.
- **Never begin a line with a backticked branch name** in a Branches section: the loose matcher
  reads it as a claim, the anchored one does not, and `parser.test.mjs`'s estate-wide
  differential fails. It cost a red main on 2026-09-01.

### Scope guard

**This branch owns:** `skills/plot/scripts/plot-plan-meta.sh` and its tests.

**It does not own** the scan's `waiting` verdict (`feature/the-scan-holds-a-waiting-slice`) or
the dispatch refusal (`feature/dispatch-refuses-a-waiting-slice`). **Do not annotate the two
live cases yet** — `a-third-connector-costs-one-adapter` and `the-pulse-is-an-entity` get their
`waits:` once something acts on it.

**In flight, 2026-09-01:** `docs/an-interrogation-writes-its-round` (the `challenge-the-plan`
skill), plus several branches under `packages/domain/`. `plot-plan-meta.sh` is also touched by
`feature/the-refusals-are-domain-rules`, so expect a rebase.

If you find something the plan did not anticipate, report it rather than improvising outside
scope.
