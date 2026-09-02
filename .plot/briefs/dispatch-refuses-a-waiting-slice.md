# Implementation brief — a-slice-can-wait-on-another-plan (Refusing)

- **Plan (canonical):** `docs/plans/2026-09-01-a-slice-can-wait-on-another-plan.md` on main
- **Approved:** 2026-09-01, Jan Wloka, in-session
- **Branch:** `feature/dispatch-refuses-a-waiting-slice` (base: `main`)
- **Ends as:** one PR to main
- **Runs third and last.** Declaring merged as **#623** (`a-branch-names-what-it-waits-on`, 2026-09-01 21:17Z), Holding as **#637** (`the-scan-holds-a-waiting-slice`, 2026-09-02 06:26Z). Both are on main.

### What to build

`plot-dispatch.sh` must refuse to start a branch whose `waits:` prerequisite has not merged, name the prerequisite in the refusal, and honour `--allow-waiting`.

**This is not hypothetical, and it has now cost two workers.** Measured 2026-09-02:

- `feature/the-domain-forgets-the-vendor-list` was un-dispatched deliberately, then **re-dispatched at 04:50**, hit its own prerequisite gate, and wrote a `PLOT-BLOCKED` marker. Its report names the cause exactly: *"the dispatch fired anyway… `plot-dispatch.sh` gates on the plan's phase, and this plan is Approved, so the slice read as eligible."*
- The branch is still claimed and still holds nothing but its claim commit.

The plan says the same thing in one line: **"The refusal is the point: until this lands, the constraint is prose in a brief."** That prose has now been ignored twice by a dispatcher that cannot see it.

### The decisions the plan settles — do not re-derive them

**The parser and the scan already do their half.** `plot-plan-meta.sh` parses `<!-- waits: <branch> -->` beside `deferred:` and emits `waves[].branches[].waits_on`. `plot-fleet-scan.sh:1049` has `waits_state()`, which returns `waiting` / `blocked` / `''`. **Five call sites in the scan read `waits:`; `plot-dispatch.sh` has zero.** That asymmetry is the whole bug.

**Ask the host for a merged PR — NEVER the refs.** `waits_state()` already does this, and the reason is a deadlock this plan was corrected to avoid during interrogation: `plot-release-refs.sh` deletes the remote refs of a delivered plan's merged branches, so a prerequisite that succeeded and was then reaped would read as *never existing* and block its dependent permanently. `plot-pr-merged.sh` reads `mergedAt`, and a merged PR reports `state: CLOSED` — so state and ancestry are both wrong answers here.

**An unreachable host HOLDS the slice; it does not block it.** Silence is never permission to start, and never a permanent refusal.

**`--allow-waiting` is the named escape**, in the tradition of `--allow-local` and `--ignore-sprint`. A gate with no exit is one people route around by never annotating at all.

**Where the decision belongs.** `--next` already selects the branch (`plot-dispatch.sh:2043` shells to `plot-fleet-scan.sh --next`), and claimability comes from the domain: `packages/domain/src/rules/eligible.ts:107`

```ts
export const isClaimable = (verdict: SliceVerdict, state: BranchState): boolean =>
  verdict === 'eligible' && state === 'open';
```

**It takes `(verdict, state)` and cannot see `waits_on`** — the field exists on `FleetReading` (`entities/fleet.ts:149`) and reaches no rule. Its own docstring says *"the conjunction is the gate rather than a filter applied afterwards"*, so a second shell-side test in `plot-dispatch.sh` would be exactly the duplication that comment forbids. Extend the domain rule; let both callers read one answer.

**But dispatch still needs its own refusal**, because a branch can be named explicitly rather than chosen by `--next`. Two clauses, two mechanisms: `--next` stops OFFERING it, and an explicit `plot-dispatch.sh <branch>` REFUSES it by name.

### Done when

The plan's `## Done when` is the specification — every clause, including the three that a naive implementation passes without:

- **A prerequisite that merged and was then REAPED still clears.** Assert it directly. This is the case where correct work otherwise produces a permanent block.
- **An unreachable host holds, and does not block.**
- **`deferred:` is untouched**, with a test that the two annotations do not interfere on one branch.

Plus: carry the annotation onto the two live cases so they stop needing prose — `a-third-connector-costs-one-adapter` and `the-pulse-is-an-entity`.

Repo gates: `pnpm run test:reconcile`, `pnpm run test:board`, `pnpm run typecheck`, `pnpm build:board`, a changeset. **Do NOT run `pnpm run test:e2e` locally** — CI owns it.

### Bookkeeping

When the PR exists, append `→ #<number>` to this branch's bullet under `### Refusing` — this plan uses `## Branches`-style bullets, so the **trailing arrow** is correct here, not the `(Branch: x, PR: #N)` heading form. Push the first real commit as soon as it exists.

### Scope guard

This branch owns the dispatcher's refusal and the domain rule that decides it. It does **not** own the parser or the scan — both are merged and correct. If the domain rule needs a field the port does not carry, say so in the PR rather than widening the schema silently.

**Two branches are currently blocked on exactly this defect** — `feature/the-domain-forgets-the-vendor-list` and `feature/the-pr-monitor-asks-through-a-port` (the latter died on `Not logged in`, an unrelated environment failure). Do not reap or re-dispatch either as part of this work.
