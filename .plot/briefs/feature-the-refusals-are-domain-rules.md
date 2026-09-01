## Implementation brief — production-calls-the-domain-one-rule-at-a-time (slice: Refusing)

- **Plan (canonical):** `docs/plans/2026-08-28-production-calls-the-domain-one-rule-at-a-time.md` on `main`
- **Approved:** 2026-09-01, Jan Wloka, in-session
- **Branch:** `feature/the-refusals-are-domain-rules` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** per repo convention — CI green, then squash-merge

This slice follows *Eligible* (`feature/one-eligibility-rule-decides`, PR #590). It precedes
*Spawning the scripts* and *Spawning the tools*, both of which move call sites rather than
judgements — so the refusals must be rules before those branches start, or they get carried
into the adapter layer as shell.

### What to build

`plot-dispatch.sh`'s refusals become domain predicates returning a named `Refusal`, the way
`plot-reap.sh`'s already do. **The script keeps its exit codes and its messages** — a refusal
that reports differently breaks whoever reads it, and several of these are read by
`/plot-fleet`, the board, and the operator's terminal.

### HALF THIS SLICE IS ALREADY BUILT — do not re-derive it

**`plot-reap.sh` is done.** Its five refusals live in `packages/domain/src/rules/reapable.ts`
(6 exports), and the shell only renders the verdict. Read `plot-reap.sh:400-422` before
touching anything: it pipes readings into the rule, takes back `refusal` and `detail`, and its
own comment states the split — *"RENDERING, not deciding. The rule named the measurement; this
names what it means to someone reading the report, which is the caller's half because only the
caller knows it is printing a table."*

That is the target shape for dispatch. Copy it; do not invent a second one.

**It also means the dangerous half is finished.** Reap deletes worktrees — a wrong refusal
there removes a desk somebody is working at. That migration has already landed and been
exercised. What remains is dispatch, which starts work rather than destroying it.

### The refusals to move

`plot-dispatch.sh`, measured 2026-09-01:

| line | refuses when |
|---|---|
| 468 | the agent manifest could not be written — *"an unregistered worker cannot be seen, stopped or reaped"* |
| 859 | `--restart` on a branch that already has a PR |
| 875 | `--restart` on a branch with a live worker pid |
| 887 | `--restart` on a branch holding a `PLOT-BLOCKED` marker |
| 1202 | the phase gate ref cannot be resolved — **fails closed**; `--allow-local` (1195) is the named escape |

**1195 and 1202 are one decision with two outcomes, not two refusals.** The gate reads the plan
from `origin/<main>` and refuses when that ref is unreadable, *unless* `--allow-local` was
passed. Model it as one rule taking `allowLocal` as a reading, or the escape hatch becomes a
branch in the shell again.

### The decisions the plan settles — do not re-derive them

**The scripts keep their exit codes and their messages.** Not a style preference: the messages
at 859/875/887 name a pid, a PR number and a marker respectively, and an operator reads them to
decide what to do next. A rule that returns `false` without the detail forces the shell to
re-measure what the rule already knew — which is the duplication this whole plan removes.

**Readings as values, not ports.** `reap(readings, input)`, never `reap(ports)`. The domain
stays synchronous and testable without mocks; the caller decides what to read. See
`rules/reapable.ts` and CLAUDE.md § *A note on shape*.

**Arrow functions.** `export const f = (…) => …` in `packages/domain/`. The CI check greps only
`packages/domain/src/`, so this is a rule reviewers enforce, not a gate.

**A refusal that cannot be asked is not a pass.** `plot-reap.sh:420` renders an unrecognised
verdict as *"rule could not be asked — keeping"* and keeps the tree. Dispatch's gate fails
closed for the same reason. Absent is not false; an unanswered question is not permission.

### Done when

The plan's `## Done when` list is the specification:

- each refusal individually triggerable in the e2e suite
- no refusal logic left in either script
- **both scripts' `--dry-run` output byte-identical before and after, on the same estate**

**The baseline is yours to take, and it must not be hollow.** Attempted 2026-09-01 and
discarded: a bare `plot-reap.sh --dry-run` reported `reapable=0` because the estate had just
been reaped, and `plot-dispatch.sh --dry-run` with no slug printed `need a plan slug` and
exercised no refusal at all. Both would have compared byte-identical afterwards **while testing
nothing** — the vacuous shape this repo keeps catching.

So: take it against the estate as it stands when you start, with a slug that reaches the
refusals, and **confirm the capture is non-empty before trusting any later match.** A baseline
taken on a different day is not transferable — the 22 worktrees the plan cites are the argument
for the comparison and the reason it cannot be reused.

**Make the comparison discriminating before believing it.** Break the rule deliberately and
confirm the dry-run output changes. A byte-identical result only means something if the two
sides could have differed — measured twice on the Eligible slice, once by gutting the domain
entry (scan exited 2) and once by hash-verifying the swap actually landed, because `cp` is
aliased to `cp -i` here and silently refused.

Plus the repo gates: `pnpm run typecheck`, `pnpm run test:reconcile`, `pnpm build:board`,
a changeset. **Run the whole `test:reconcile` glob, not the files you suspect** — it holds 44
files, and on the Eligible slice `fleet` and `dispatch` passed while three tests in three other
files failed on CI.

**Do NOT run `pnpm run test:e2e` locally.** It dispatches real workers into sandbox repos; CI
is its gate and has its own machine.

### Bookkeeping

- Push the first real commit as soon as it exists — the claim is the ref push, and it is the
  whole locking mechanism.
- When the PR exists, append `→ #<number>` to this slice's heading in the plan's `## Slices`
  section. **This plan uses the heading form**: `### Refusing (Branch: …, PR: #N)`, not a
  trailing arrow on a bullet — a trailing `→ #N` parses as `prs=[]` on this shape.
- **Never begin a line with a backticked branch name inside `## Branches`/`## Slices`.** The
  loose matcher reads it as a claim and the anchored one does not, and
  `parser.test.mjs`'s estate-wide differential fails. It cost a red main on 2026-09-01.

### Scope guard

**This branch owns:** `skills/plot/scripts/plot-dispatch.sh`, a new rule module under
`packages/domain/src/rules/`, and its tests. `plot-reap.sh` and `rules/reapable.ts` are
**reference, not scope** — they are already migrated.

**In flight elsewhere, verified 2026-09-01:** `feature/one-eligibility-rule-decides` (#590)
holds `plot-fleet-scan.sh`, `packages/domain/src/rules/eligible.ts` and
`packages/board/src/server/entry/verdicts.ts`. `packages/domain/src/index.ts` is a shared
export list and conflicts additively — resolve as the **union**, never by taking a side.

If you find something the plan did not anticipate, report it rather than improvising outside
scope.
