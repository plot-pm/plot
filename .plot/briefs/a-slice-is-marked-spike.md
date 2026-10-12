## Implementation brief — design-work-proves-the-path (wave: The markers)

- **Plan (canonical):** [docs/plans/2026-10-12-design-work-proves-the-path.md](../../docs/plans/2026-10-12-design-work-proves-the-path.md) on `main`
- **Approved:** 2026-10-12, Jan Wloka, plan-PR #1608 merged
- **Branch:** `feature/a-slice-is-marked-spike` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** per repo convention (PR review)

This slice waits on nothing — it reads no phase, only parses and carries
data. Four other slices in this plan wait on it: *Approving the spike*,
*Dispatching the spike* and *Confirming the slices* all read the fields this
slice adds (`spike_approved_raw`, the `Tracer: yes` line, `spikeOf`,
`plangate`). Land this one first.

### What to build

A Design-phase plan can name one slice as its **spike** — the slice a person
approves and dispatches alone, before the rest of the plan's slices are
confirmed. Today nothing in the TypeScript layer can read that annotation:
`plot-plan-meta.sh` has exactly one comment mentioning "spike" (line 94) and
zero parsing of it. `PlanMetaSchema` (`packages/board/src/contract/schema.ts:63`)
has no fields for it. This slice is the data-plumbing layer every later slice
in this plan depends on — it adds no new *behaviour*, only new *readings*.

Five things to build, each named in the plan's slice text
(`docs/plans/2026-10-12-design-work-proves-the-path.md:169`):

1. **`plot-plan-meta.sh` reads the spike annotation in both slice dialects** —
   a `<!-- spike -->` comment on a branch line (see the plan's own
   `### The spike: the person arm` heading, which uses exactly this
   annotation on `feature/the-design-approvals-are-gated`), and a
   `Tracer: yes` line in a plan's `## Status` block. Emit `spike_approved_raw`
   and a tracer reading in the script's JSON output.
2. **`PlanMetaSchema` gains three fields** reflecting those readings.
3. **`spikeOf(slices)` in the domain**, with unit tests — a pure function
   over already-parsed slice data, per the domain's port-free, synchronous
   style (`CLAUDE.md` § "A note on shape").
4. **The scan's P-row and verdict columns.** Today the P row is three fields:
   `print("\t".join(["P", clean(f), clean(d.get("phase", "")), clean(d.get("type", ""))]))`
   (`skills/plot/scripts/plot-fleet-scan.sh:3110`) — that's four tokens
   including the literal `"P"`, not five. The plan's slice text calls for
   "three `P` readings, five-field `P` parse and two verdict columns" — so
   this slice widens that row to carry the two new readings and widens
   `sliceVerdicts`' input line from `outstanding<TAB>phase<TAB>states`
   (`packages/board/src/server/entry/verdicts.ts:92` via `slicesFrom`,
   `:63-92`) by two columns. **The rule (`spikeOf`, `sliceVerdicts`) does
   not consume these new columns yet** — that is explicitly deferred to
   *Dispatching the spike*. This slice only gets the data to where a rule
   could read it.
5. **`tracer` on the pulse `PlanSchema`** (`packages/domain/src/entities/fleet.ts:695`),
   defaulted so an older scan's output still validates — same pattern as
   `phase: z.string().default('')` right above it.
6. **`plangate` exported with every next-command hint**, in its own commit:
   a pure domain function answering whether a plan may be dispatched, taking
   over the checks that today live in two places that must be kept in sync by
   hand — `plot-dispatch.sh`'s shell copy (plan Motivation, line 31: refuses
   `design` in its `*)` arm) and the TypeScript `plangate` in
   `workflows/dispatch.ts:527-546` (refuses with `state-wrong`). Export it
   with `plot-ask.mjs plangate`, exiting 0 or 1, and change `plot-dispatch.sh`
   to ask it instead of running its own phase/`Impl:` cases — exiting 1 when
   the bundle is missing or fails (fail closed, per the dispatch suite's own
   stated philosophy at `test/reconcile/dispatch.test.mjs:987-990`: a
   user-invoked command fails closed on an unreadable signal, unlike a
   PreToolUse hook, which must fail open).

### Decisions the plan settles — do not re-derive them

**Why this slice first, and why it changes `plot-dispatch.sh` at all.**
The obvious alternative — land the rule and the gate-swap together with
*Dispatching the spike* — was rejected because `plangate`'s hint contract
(nine arms, each with its own next-command) needs a contract test independent
of spike eligibility, and bundling it with the eligibility change would make
a `plangate` regression indistinguishable from a spike-dispatch regression.
Splitting them means `plangate`'s own correctness — nine hints, nine exit
codes — is provable before spike eligibility is layered on top of it.

**The three existing dispatch.test.mjs assertions this slice must not
touch.** The plan names `dispatch.test.mjs:975`, `:1004` and `:1030` as
"unchanged" (plan slice text, line 169). Verified in
`test/reconcile/dispatch.test.mjs`: these are *"dispatch: fans out an
Approved plan"* (~line 981), *"dispatch: fails closed when the phase cannot
be read"* (~line 989), and *"dispatch: refuses a plan whose work is not on
its own branches"* (~line 1026) — none of them touch spike state, so
`plangate` taking over the phase/`Impl:` checks must preserve their exact
behaviour (an Approved plan still dispatches; an unreadable phase still
fails closed with a message matching `/phase/i`; `same branch`/`other
repo`/`none` still refuse with their respective messages). A contract test
of `plangate`'s hint and exit code on all nine arms is additional coverage,
not a replacement for these three.

**Two dialects, not one.** The plan deliberately supports both a
`<!-- spike -->` comment annotation (matching the existing `deferred:` /
`waits:` annotation style already parsed by `plot-plan-meta.sh`, per
`PlanMetaSchema`'s `slices[].branches[].deferred` field) and a `Tracer: yes`
`## Status` line (matching the existing `### Tracer` wave-heading dialect at
`plot-plan-meta.sh:1054`, used by `tracer-bullets`). Collapsing to one
dialect was rejected because the two express different things: `<!--
spike -->` marks one branch within an otherwise-ordinary plan; `Tracer: yes`
marks the *whole plan* as a tracer-bullet plan serving other plans (this
plan's own Changelog line 21 — "stays in the Design column... delivered and
released with the first plan that waits on it"). Both need to coexist
because `the-design-approvals-are-gated` already names its own spike this
same way (see the plan's own slice annotation), so the shell's spike-marker
format is already fixed by precedent — not invented fresh by this slice.

**Defaults, not new required fields.** Every new field (`spike_approved_raw`,
the tracer reading, `PlanSchema.tracer`) must default to empty/false so a
pulse or scan from an older binary — or a plan with neither annotation —
still validates. This is the existing pattern for every optional plan-meta
field (`sprint`, `story`, `assignee` all `.default('')"` in
`PlanMetaSchema`); do not make any of these three required.

**Absent is not false.** Per the repo-wide invariant (carried over from
prior slices, `CLAUDE.md` § "One Answer To Did This Land" and repeated
across this codebase): a plan with no `<!-- spike -->` annotation and no
`Tracer: yes` line is not equivalent to "spike: false, read and confirmed" —
it is equivalent to "no spike reading exists." Keep that distinction in
`spikeOf`'s return shape (e.g. `undefined`/absent rather than a coerced
`false`) so a later slice can tell "this plan declared no spike" from "this
plan's spike state could not be read."

### Done when

The plan's `## Done when` is folded into *Acceptance* (this plan uses that
heading instead); the slice-specific part of it:

- `plot-plan-meta.sh` emits `spike_approved_raw` and a tracer reading for a
  plan using either dialect, and empty/absent for a plan using neither —
  write a test fixture per dialect plus a plain plan, so a naive
  implementation that only handles the comment-annotation dialect (or only
  `Tracer: yes`) is caught.
- `PlanMetaSchema` parses the three new fields with their defaults; a test
  feeding it an old scan's pre-slice JSON (no spike/tracer keys at all)
  still validates — this is what catches a naive implementation that makes
  a field required instead of defaulted.
- `spikeOf(slices)` unit tests cover: a plan with one spike-annotated
  branch, a plan with none, and — because `spikeOf` must answer from
  already-parsed slice data, not re-read branch annotations — a slice
  structure that already carries the reading.
- The scan's P row carries the widened field set and `slicesFrom` accepts
  the two new verdict columns without the existing three
  `dispatch.test.mjs` assertions (:975, :1004, :1030 per the plan's line
  numbers) changing behaviour — run that file and confirm it still passes
  unmodified.
- `plangate` has a contract test asserting its hint and exit code on all
  nine arms (the plan's own acceptance line), and `plot-dispatch.sh`'s shell
  phase/`Impl:` cases are replaced by a call to `plot-ask.mjs plangate`,
  exiting 1 when the bundle is missing or fails.
- The spike-annotation comment line is added to both plan templates
  (`skills/plot/templates/plan.md` and `.plot/templates/plan.md`) — one
  comment line each, matching the existing `<!-- deferred: ... -->` /
  `<!-- waits: ... -->` style already documented there.
- The PR body states the slice's width (plan estimates ~15 files, since
  `plangate` changes the dispatch gate every plan goes through) and the
  measured `check-shell-lines.sh pr` delta (plan estimates about −20, net
  negative because shell logic moves into the bundle).

Plus the repo's standing gates: changeset `bumps:` `plot: minor` (per the
plan's slice line), with the description first and the `bumps:` block last
(`CLAUDE.md` § Versioning — a block written first becomes the published
changelog entry instead of the description). Run
`node skills/plot/scripts/board/plot-local-checks.mjs` before each push and
run what it prints — the tests and typecheck that name your changed files,
plus the gate scripts. Do not run `test:e2e` or the full `CI suites` list
locally; those are CI's job.

**The shell gate applies directly here.** `scripts/check-shell-lines.sh`
refuses a PR that grows the shipped shell under `skills/` against its merge
base, with no stored allowance. This slice touches `plot-plan-meta.sh`,
`plot-fleet-scan.sh` and `plot-dispatch.sh` — all `.sh` files. The plan
expects this slice to be net-negative (~−20 lines) because the
phase/`Impl:` logic moves out of `plot-dispatch.sh`'s shell into the ported
`plangate` bundle call — but the *parsing additions* to
`plot-plan-meta.sh`/`plot-fleet-scan.sh` add shell lines first. If the net
count still grows, pay for it in the same change: trim elsewhere, or push
more of the new parsing into the domain/bundle layer rather than bash.

### Bookkeeping

Open the PR through the controller once there is a first real commit:

```bash
../plot/scripts/plot-open-pr.sh          # on this branch, once claimed
```

It reads this plan and this branch's heading to title and fill the PR —
never `gh pr create` by hand. When the PR is created, append `→ #<number>`
to this branch's line in the plan's `## Slices` section
(`### The markers` heading, `feature/a-slice-is-marked-spike` line).

Push the first real commit as soon as it exists — don't hold a local
branch of unpushed work.

### Scope guard

**This branch owns:** `skills/plot/scripts/plot-plan-meta.sh`,
`skills/plot/scripts/plot-fleet-scan.sh` (the P-row and verdict-column
widening only — not the rule consuming them), `skills/plot/scripts/plot-dispatch.sh`
(the phase/`Impl:` case replacement with a `plangate` ask),
`packages/board/src/contract/schema.ts` (`PlanMetaSchema`'s three new
fields), `packages/domain/src/entities/fleet.ts` (`PlanSchema.tracer`), a
new `spikeOf` export and a new `plangate` export in the domain (exact
module path is this slice's call — follow the port/adapter layering: a pure
function, no port), `packages/board/src/server/entry/verdicts.ts`
(`slicesFrom`/`SliceLine` widened to accept, not yet consume, the new
columns), `skills/plot/templates/plan.md` and `.plot/templates/plan.md`
(one comment line each), and a changeset.

**It does not own:** anything behind the `approvalArm`/person-reading split
(`workflows/approve.ts`, `transitions/plan.ts`, `entry/approve.ts`) — that
is *The spike: the person arm* slice, `feature/the-design-approvals-are-gated`.
It does not own `spikeApprovalOf`, the `approveSpike` transition, or the
`Spike approved:` record — that is *Approving the spike*,
`feature/the-spike-is-approved-alone`. It does not own `sliceVerdicts`
actually *admitting* a spike as eligible, or `phaseGateRefusal` — that is
*Dispatching the spike*, `feature/the-spike-can-be-dispatched`, which is the
first slice to consume the columns this slice adds. It does not own the
board's spike badge/card states, `draftPlacement`, or `/plot-approve` prose
— those are *Confirming the slices*.

**Other branches in this wave:** none are claimed yet (verified via
`git ls-remote --heads origin` on all six sibling branch names — all empty
at brief-writing time). This slice has no prerequisite slice in this plan
and is the first the plan's dependency ordering allows
(plan Notes, "the markers slice waits on nothing, because it reads no
phase").

If you find something the plan did not anticipate — e.g. the P-row's actual
field count differs from what the plan's prose implies, or `slicesFrom`'s
column contract needs a different shape than "two appended columns" — report
it rather than improvising scope from the other five slices.
