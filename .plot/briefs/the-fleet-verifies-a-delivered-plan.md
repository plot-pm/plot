## Implementation brief — the-fleet-verifies-what-it-delivered (wave: the run and the tracker write)

- **Plan (canonical):** [docs/plans/2026-10-12-the-fleet-verifies-what-it-delivered.md](../../docs/plans/2026-10-12-the-fleet-verifies-what-it-delivered.md) on `main`
- **Approved:** 2026-10-12, Jan Wloka, plan-PR #1608 merged
- **Branch:** `feature/the-fleet-verifies-a-delivered-plan` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** standard PR review (`Review: pr`)

This branch's `waits:` annotation names `feature/a-slice-is-marked-spike` (plan
`design-work-proves-the-path`). **It has merged** — PR #1621, "The markers".
The plan's own spike, `feature/a-pinned-run-verifies-one-plan`, has also
merged (PR #1618), and so has the whole prior wave, "The record and the
panel's labels": `feature/a-delivered-plan-carries-its-verification` and
`feature/the-jurors-fold-into-one-line-per-claim` both landed in PR #1630.
`plot-fleet-scan.sh --next the-fleet-verifies-what-it-delivered` returns
exactly this branch. The `.plot/hold` entries decision D29 placed on this
branch and its five siblings have already been cleared — none of this plan's
branches appear in the current `.plot/hold` file. Confirm the scan result
yourself before starting; plan state can move between this brief being
written and read.

A sibling branch, `feature/a-tracker-opens-an-issue`, is **not yet landed**
(it waits on `feature/the-tracker-lists-closed-issues` of
`tickets-and-stories-have-lanes`, itself held under a different plan's D29
spike-first gate). This branch does not need it: the Verify-mode slice you are
building writes a `Verified:` record and a `## Verification` section, and
stops there. Opening an issue for a refuted claim is the next wave's job
(`feature/a-refuted-claim-opens-an-issue`), gated behind the tracker port this
branch does not touch.

### What to build

Everything the spike proved — `plot-verify.mjs prepare/claims/fold/record`,
`claimsOf`, `foldVerification`, `recordCommit`, the `plan-section` write kind —
already exists and already produces a correct record when invoked by hand on
a sandbox fixture. What is missing is the **caller**: a person-triggered
command (`/plot-deliver --verify`) and a fleet-triggered one (the
`Auto-verify` daemon path), plus the plumbing both need to run safely inside a
live repository rather than a disposable sandbox. Four pieces:

1. **`/plot-deliver`'s *Verify mode* section**, for `--verify <slug> [--at <sha>]`.
   Read `skills/plot-deliver/SKILL.md` step 2 (`:83-110`, "Verify Plan Exists")
   and step 5 (`:188-386`, the existing delivery-time panel) before touching
   either — Verify mode **inverts** step 2's phase check (it runs on a
   **Delivered** plan, where normal delivery requires Approved) and reuses
   step 5's panel machinery with different inputs:
   - Step 2 inverted: refuse anything but `State: Delivered`; name
     `/plot-deliver <slug>` as the command for an Approved plan and
     `/plot-reject <slug>` first for anything earlier.
   - A tracer refusal: a plan with `Tracer: yes` is never verified (D5, D14 —
     the same `tracer` field `feature/a-slice-is-marked-spike` already shipped
     on `FleetReadingSchema`, `packages/domain/src/entities/fleet.ts:720`, and
     the same rule `verificationOf` already encodes as `unverified`). Verify
     mode refuses before calling `plot-verify.mjs prepare` at all — don't
     let the preparer do this check twice.
   - `prepare` runs for what was step 5.1 in the normal flow (reading the
     plan); **5.2b and 5.3 do not run in Verify mode** — those are the
     delivery-time micro-PR/ref-release steps, and a verify run never
     delivers, releases a ref, or touches `plot-release-refs.sh`.
   - The commitment list changes shape from normal delivery's two labels
     (`Position`, `Evidence`) to a **per-claim list**:
     `Position, Evidence, Claim-1, Claim-2, …, Claim-N` — one `Claim-<n>` label
     per line `plot-verify.mjs claims` printed, each committed in the
     `<supported|refuted>` form. This is exactly the label-list mechanism
     `the-jurors-fold-into-one-line-per-claim` (PR #1625, merged) already
     built into `/plot-panel` — call `/plot-panel` with that list, do not
     reimplement per-claim commitment checking here.
   - `record` runs last, writing the `Verified:` line and `## Verification`
     section and cleaning up the verify trees (already built by the spike).

2. **`gate.ts`'s `underDesk` and the controller gate's CI-suite-refusal arm
   read `.plot-verify.pid`.** Today `ciSuiteRefusal`
   (`packages/domain/src/rules/ci-suite.ts:139`) and the desk/worker-pid
   checks it sits beside know only `.plot-worker.pid` and
   `.plot-worker.wrapper.pid` (`packages/domain/src/adapters/desk/desk-fs.ts:44`).
   A verify run's `pin/` tree carries `.plot-verify.pid` instead (the spike's
   own naming, chosen specifically so the reaper/reconcile/fleet scans — which
   all key off `.plot-worker.pid` or a path under `Worktree root` — do not
   mistake a verify tree for a desk). Extend the CI-suite-refusal arm to also
   recognize a tree marked `.plot-verify.pid` as "under a managed process,"
   so `PLOT_UNATTENDED=1` running inside a verify run's `pin/` tree gets the
   same `CI suites` refusal a worker desk gets — **but name explicitly, in a
   code comment at the change site, that this is a partial fix**: full
   enforcement (the gate actually distinguishing a verify session from an
   ordinary checkout at every call site) ships with the next plugin release,
   per the plan text. Don't try to make this slice close that gap completely;
   say what you closed and what remains.

3. **The daemon path: `Verify command`, `Auto-verify`, `autoVerify`,
   `verifyStart`.**
   - `Verify command` is a new `## Plot Config` key (same shape as `Idea
     command` / `Brief command`) naming the shell invocation that starts a
     verify run with a prompt pointing at **the tools tree's** copy of
     `skills/plot-deliver/SKILL.md` § *Verify mode* and
     `skills/plot-panel/SKILL.md` (by absolute path into `tools/`, never the
     installed skill — this mirrors the spike's own rule that every command of
     a run is the tools tree's copy). Declare it in this repo's own
     `CLAUDE.md` `## Plot Config` once built, then run
     `./scripts/check-agents-md.sh --write` to regenerate `AGENTS.md` — the
     gate `check-agents-md.sh` (no `--write`) fails CI if the two drift.
   - `Auto-verify` is the on/off switch (`autoVerify`, a domain predicate
     reading the config the same way `autoDispatch`/`autoDeliver` already do
     — follow their existing shape, don't invent a new config-reading
     pattern).
   - `verifyStart` decides whether a run may start, and **must answer with a
     named reason it can be read from the fleet's status**, mirroring
     `scaleUp`'s `requested`/`running` shape (`packages/domain/src/workflows/assign.ts:215-231`).
     Five refusals, each independently testable:
     - `starved` — the machine has no spare capacity and no `Machine
       override` (same `starved` vocabulary `assign.ts` already uses).
     - a slice held `no-free-agent` (an existing fleet-status reason;
       reuse it, don't coin a new word for the same fact).
     - a run already going for this plan (one verify run per plan at a time
       — this is what makes a going run count toward `scaleUp`'s `running`
       at `assign.ts:227`, so capacity math stays correct; it is **not** a
       global one-verify-at-a-time lock across all plans).
     - a tracer plan (same D5/D14 check as the command path, re-derived here
       because the daemon never goes through `/plot-deliver`'s step 2).
     - three or more failure records newer than `lastSuccessAt` — see next
       point.
   - **Failure tracking reuses `auto-deliver.ts`'s existing shape, it does
     not invent a new one.** `recordDeliveryFailure`
     (`packages/domain/src/rules/auto-deliver.ts:125`) and `retryVerdict`
     (`:104`) already implement "N failures since the last success stops
     retrying until a person acts" for automatic delivery, keyed by plan slug
     with the caller (today, `fleet.ts`) owning where the failure map is
     persisted as JSON. Verification needs the identical shape with its own
     file and its own threshold (3, matching the plan's named number) — write
     a `verify`-specific record function with the same signature pattern
     rather than threading a `kind` parameter through the existing
     delivery one. Keep the two failure stores and their JSON files
     separate: `auto-verify-in-flight.json` is new, next to whatever file
     already backs `auto-deliver`'s failures in `fleet.ts` — don't merge them
     into one file or one schema.
   - `startBoardRun` gains the log kind `'verify'` (alongside its existing
     kinds) so a verify run's start, install seconds, end, and outcome are
     logged the same way other board-started runs already are — read
     `startBoardRun`'s current call sites before adding a fourth kind, so the
     new branch matches their shape rather than improvising one.
   - **Two independent stop conditions, not one.** A *plan* stops after 3
     consecutive failed runs under one delivery commit (`retryVerdict` reads
     `stopped`, scoped to that plan+commit — a new delivery commit, i.e. a
     re-delivery after `/plot-reject`, resets the count). The *fleet*
     separately starts no new run of any kind after 3 consecutive failed
     verify runs **across plans**, until a person restarts one by hand. These
     are different counters answering different questions — don't collapse
     them into one threshold check.
   - Leftover verify trees from a run whose `.plot-verify.pid` names a dead
     process are removed at the start of each fleet pass (the spike's
     `removeOnly` already does per-slug cleanup on `prepare`; this adds the
     dead-process sweep the spike's Acceptance didn't need because it only
     ever ran one verify to completion).

4. **`verificationRow` in *Waiting on you***, with the restart command
   (`/plot-deliver --verify <slug>`) and a note when the fleet itself is
   halted (the 3-across-plans stop, distinct from the per-plan `stopped`
   verdict — the row should be able to say "the fleet is halted on
   verification failures" even for a plan that itself has fewer than 3
   failures). This is presentation over state the daemon path above already
   produces; it reads failure records, it does not re-derive them.

Each piece above gets a `bumps:` entry: `plot-deliver: minor` for pieces 1 and
4 (and its Model Guidance table — add a row for the Verify mode step at the
same tier as step 5's existing panel step, Frontier, since judging per-claim
support is the same kind of judgment).

### Decisions already made — do not re-derive them

**Why Verify mode is a flag on `/plot-deliver`, not a new skill.** The plan's
Design section is explicit that the mechanism is `/plot-deliver --verify
<slug> [--at <sha>]`, reusing step 5's panel call with different labels and
inverting step 2's phase check — not a parallel `/plot-verify` skill. The
panel machinery (`/plot-panel`, now label-list capable) and the plan-parsing
step are both already correct for a Delivered plan; only the phase gate and
the commitment label list differ. Building a separate skill would duplicate
both rather than branching one.

**Why the per-claim commitment list goes through `/plot-panel`'s new
label-list mechanism, not a bespoke verify-only checker.**
`the-jurors-fold-into-one-line-per-claim` (merged, PR #1625) built exactly
this: `/plot-panel` takes `Commitment` as a list of labels, gates each with
one `check` call per label per juror, and sends a juror back once naming
every label it refused. That mechanism was built *for* this slice — using it
is not a convenience, it is the reason that slice shipped first in this wave.
A verify-specific re-implementation would be the second implementation of a
rule this estate's own layering section calls out by name as the failure mode
to avoid (`A Decision Reads The Index` / `A Shell Script Asks The Domain` —
declared duplication needs a corpus test; undeclared duplication is the
thing those sections exist to prevent).

**Why `.plot-verify.pid` is a distinct marker from `.plot-worker.pid`, and why
this slice only partially closes the gate on it.** The spike chose
`.plot-verify.pid` specifically so the reaper, the reconcile scan, and the
fleet scan — all of which key off `.plot-worker.pid` or a path under
`Worktree root` — never mistake a verify tree for an abandoned desk and try to
reap or reassign it. Making the **controller gate** also recognize it (this
slice's job) is a different concern: it stops an unattended agent from
running a banned `CI suites` command *while sitting inside* a verify run's
pinned tree. The plan's own text says this guard "reaches a session with the
next plugin release" — meaning full enforcement is intentionally out of this
slice's scope. Extend the existing arm; don't chase full coverage here, and
say in the PR description exactly which call sites you covered and which you
didn't, so the next release's plan can pick up precisely where this leaves
off.

**Why a going verify run counts in `scaleUp`'s `running`, and why that is a
capacity question, not a locking question.** `assign.ts:227`'s
`running = readings.agents.length` is what the daemon uses to decide whether
to grow the fleet. A verify run consumes a real process slot on the same
machine workers run on, so if it is invisible to that count the daemon can
over-provision and start more workers than the machine can hold. This is
separate from, and composes with, the "one verify run per plan at a time"
rule in `verifyStart` — the first is about the machine's capacity, the second
is about not double-judging one plan concurrently with two divergent runs.

**Why failure tracking is a new function with the same shape as
`recordDeliveryFailure`/`retryVerdict`, not a `kind` parameter threaded
through the existing one.** The two failure domains (delivery, verification)
have independent thresholds, independent "newer than last success" clocks,
and independently-owned JSON files. Auto-deliver's functions are not
parameterized today, and retrofitting a `kind` branch into code that currently
has none is a wider, riskier diff than writing a second function with the
same signature shape next to the first. Keep them as siblings.

**Rules carried over unchanged, worth not re-breaking:**
- Absent is not false — every one of `verifyStart`'s five refusals, and
  `retryVerdict`'s `stopped` verdict, must be a **named reason** read from the
  fleet's status, never a silent skip. The *Waiting on you* row (piece 4)
  exists specifically so a stopped verification is visible, not just logged.
- The tools-tree rule from the spike applies here too: the `Verify command`'s
  prompt names skill text by absolute path into the **tools** tree
  (`origin/<main>`, fetched fresh), never the operator's installed skill
  version and never the pinned tree's own copy. Don't let the daemon path
  quietly diverge from the command path on this.
- `.plot/state/` stays outside `Worktree root` and ungated by the reaper/
  reconcile/fleet scans — nothing in this slice should need those scans to
  learn a new path.

### Done when

The plan's `## Done when` — i.e. its `## Acceptance` section's third block,
*"The run and the tracker write"* — is the specification for this slice (the
fourth block, *"The issues and the checklist"*, belongs to the next two
branches and is out of scope here):

- With `Auto-verify` on and `Verify command` declared, `verifyStart` starts no
  run on a `starved` machine without `Machine override`, none while a slice is
  held `no-free-agent`, none while a run is already going for that plan, none
  for a tracer plan, and none when three failure records are newer than
  `lastSuccessAt` — **each answer names its reason** in the fleet's status.
  Catches a refusal that silently no-ops instead of explaining itself, which
  is exactly the failure mode the plan's "Gates Over Rules" conventions exist
  to prevent.
- A going run counts in `scaleUp`'s `running`. Catches the daemon
  over-provisioning workers because it didn't see the verify run's process.
- A failed run puts a row with its log, its reason, and
  `/plot-deliver --verify <slug>` in *Waiting on you*; a plan with three
  failures under one delivery commit reads `stopped` through `retryVerdict`,
  and a new delivery commit starts its count again. Catches a plan silently
  retried forever on an unfixable failure, and catches a fixed-then-redelivered
  plan being wrongly blocked by a stale failure count.
- Under `PLOT_UNATTENDED=1` in a tree that holds `.plot-verify.pid`, the
  controller gate refuses a `CI suites` command. Catches an unattended verify
  run executing a banned suite the same way a worker desk is already stopped
  from doing.

Plus, from the plan's Design section rather than its Acceptance list (both are
load-bearing, the Acceptance block is just the part CI can check
mechanically):

- `/plot-deliver --verify <slug> [--at <sha>]` runs end to end on a real
  (non-sandbox) Delivered plan in this repository and produces a correct
  `Verified:`/`## Verification` write, exercising the exact code path the
  daemon will also use.
- `--at <sha>` names a different judged commit than the default pin, and the
  record's "judged at" field reflects it.

For local checks: run
`node skills/plot/scripts/board/plot-local-checks.mjs` (resolve the path from
this repo's root) before each push, and run what it prints — the related
tests and typecheck for whatever package you touched (`@plot-pm/domain` for
the rules, `@plot-pm/board` for `fleet.ts`/`local-checks.ts`/`gate.ts`
changes), plus the gate scripts. The suites under the `CI suites` config key
(`pnpm run test:e2e`, `test:contracts`, `test:board`, the domain's coverage
run, `test/reconcile/*.test.mjs`) run in CI on every PR — do not run them
locally as a matter of course; a failure there comes back as a correction,
and running `test:e2e` locally risks starving the shared machine (measured
2026-08-31: one such run produced 53 concurrent `node --test` processes).

**Shell-line gate:** `scripts/check-shell-lines.sh` refuses a PR whose shell
under `skills/` grows past its merge base. This slice's shell surface is the
`Verify command`'s invocation line in `CLAUDE.md`/`AGENTS.md` and whatever,
if any, `.sh` glue the daemon path needs — keep new shell to the minimum
`check-agents-md.sh --write` regeneration requires, and if a `.sh` line must
grow, remove an equal number elsewhere in the same change or write the new
rule in the domain and reach it through a bundle instead.

### Bookkeeping

Open the PR through the controller as soon as real work exists:

```bash
skills/plot/scripts/plot-open-pr.sh          # on the current branch
skills/plot/scripts/plot-open-pr.sh --draft  # while still moving
```

It reads which plan names this branch and opens the PR titled from this
wave's heading ("The run and the tracker write"), with the plan and this
brief linked in the body. **Do not run `gh pr create`** — that path has
produced mistitled PRs before (measured 2026-09-08) because nothing names the
wave for it. Once the PR exists, append `→ #<number>` to this branch's line in
the plan's `## Slices` section, in the same commit or the next one.

### Scope guard

This branch owns: `skills/plot-deliver/SKILL.md` (the new *Verify mode*
section only — leave steps 1–9's existing text alone except where Verify mode
explicitly inverts step 2), the `Auto-verify`/`Verify command`/`verifyStart`/
`autoVerify` additions to `packages/domain/src/workflows/` and
`packages/board/src/server/fleet.ts`, the `.plot-verify.pid` recognition in
`packages/domain/src/rules/ci-suite.ts` and wherever `underDesk` lives, the
new `verify`-kind failure tracking and its JSON file, the `startBoardRun`
`'verify'` log kind, and the `verificationRow` in *Waiting on you*.

It does **not** own: the pinned-run mechanism itself (`plot-verify.mjs`,
`claimsOf`, `foldVerification`, `recordCommit`, the `plan-section` write kind
— all shipped by the spike, PR #1618), `verificationOf`/`refutedClaims`/the
board's refuted badge (shipped by PR #1630), or `/plot-panel`'s label-list
commitment mechanism (shipped by PR #1625). If any of those need a change to
make this slice work, that is a sign the earlier slice's Acceptance missed
something — report it rather than patching it inline here.

Two branches remain unmerged elsewhere in this plan and may be worked
concurrently by other agents: `feature/a-tracker-opens-an-issue` (waits on a
different plan's held spike — likely not eligible yet) and the two branches
after it in this plan's own slice order, `feature/a-refuted-claim-opens-an-issue`
and `feature/the-fleet-keeps-the-release-checklist` (both wait on this branch
by slice order, not by an explicit `waits:` annotation — check
`plot-fleet-scan.sh --next` rather than assuming). None of the three touch the
files this branch owns.

If you find something the plan did not anticipate, report it rather than
improvising outside scope.
