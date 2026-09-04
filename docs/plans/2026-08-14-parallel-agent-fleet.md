# Parallel agent fleet: watcher, wave-based dispatch, claim-by-ref

> Cash in Manifesto Principle 4 ("one plan, many branches") by adding a stateless fleet watcher, a human-paced dispatcher, and atomic branch claiming — so multiple agents can implement one plan concurrently without a second source of truth.

## Status

- **Phase:** Released
- **Type:** feature
- **Sprint:** <!-- optional, filled when plan is added to a sprint -->
- **Story:** plot-board
- **Review:** pr
- **Impl:** own branches
- **Approved:** 2026-08-14, jwloka, plan-PR #70 merged
- **Started:** 2026-08-14, jwloka, `feature/parallel-fleet-tracer`
- **Delivered:** 2026-08-14
- **Released:** 2026-08-15, v2.1.0

## Approval

- **Assignee:** jwloka

## Changelog

- New `/plot-fleet` command: a stateless watcher pulse that re-derives fleet state from git each tick, renders which branches are claimed/eligible/stale, and appends a pulse-log line so a dead fleet is distinguishable from an idle one.
- New `/plot-dispatch` command: human-paced fan-out that creates one git worktree per eligible branch and starts a detached worker in each, so the fleet outlives the dispatching session.
- Wave eligibility is `strict` by default (prior wave merged); a per-plan `loose` override (prior wave green and ready) requires a stated reason.
- Workers check their own branch against the Definition of Done before marking a PR ready; a branch that cannot yet comply stays draft with the blocking reason recorded.
- Plan format gains **waves** (`### Tracer` / `### Implementation` / `### Wave N` subheadings under `## Branches`) expressing which branches may run concurrently.
- Plan format gains **claim reflections** (`<!-- claimed: <ts>, <session> -->`) and two new drift annotations (`<!-- split-from: ... -->`, `<!-- moved: wave N, ... -->`).
- `/plot-implement` claims a branch atomically by pushing its ref before starting work, so concurrent sessions cannot collide.
- `plot-plan-meta.sh` emits `waves[]` plus per-branch `claimed`/`deferred` state.
- `plot-reconcile-scan.sh` classifies abandoned claims (claimed branch, zero commits, no PR, past threshold) as reapable.
- The board gains wave and claim columns.

<!-- Board impact: YES — this plan changes the plan-format contract.
     plot-plan-meta.sh gains waves[] and per-branch claimed/deferred fields;
     .plot/templates/plan.md and skills/plot/templates/plan.md gain wave
     subheadings under ## Branches. packages/board consumes that JSON, so the
     board needs wave/claim columns and a rebuild (pnpm build:board).
     Board work rides Stages 1–2 rather than being deferred — board impact is
     DoD-gated (docs/definition-of-done.md). test:reconcile covers the meta
     contract and must be extended alongside. -->

## Motivation

Plot promises parallelism and does not deliver it. Manifesto Principle 4 states
"one plan, many branches — different people, different agents, different
worktrees, all working on the same plan in parallel." But `plot-implement`
today says: *"Multiple branches: create the first, list the rest — parallel
sessions."* It hands you a list and stops. Nothing spawns, claims, tracks, or
reconciles those sessions.

Meanwhile `ralph-plot-sprint` is deliberately anti-parallel: "Do exactly ONE
step per iteration" and "Finish before starting" — no new branch while any PR
for that plan is open. Its parallelism is read-only (subagents gather PR and CI
status); there is no write-parallelism anywhere in Plot.

The result: a team wanting to run four agents on one approved plan must
coordinate by hand, and two sessions can silently grab the same branch.

Two external designs informed this plan, and each supplies a piece Plot lacks:

- **The "Lloyd" loop orchestrator** (r/ClaudeAI, Aug 2026) — a persistent agent
  on a heartbeat with a SQLite ticket table. Its transferable lesson is not the
  database but the *statelessness per pulse*: the orchestrator re-derives
  everything each tick rather than holding a queue in context, and it **logs
  clean pulses explicitly** so a working heartbeat is distinguishable from a
  dead one.
- **Scape** (scape.work) — a macOS fleet manager running many agents in
  **isolated worktrees**, with a dashboard showing per-agent status
  (generating / idle / needs attention) and an orchestration layer ("Argus")
  that sets objectives and escalates only critical decisions.

Plot is closer than both on the *state* layer (git + plan files + `plot-plan-meta.sh`
is already a machine-readable work table) and further behind on the *dispatch*
layer. This plan builds only the missing dispatch layer and explicitly declines
to add a datastore.

### Relationship to `opus5-longhorizon-hardening` (Approved)

That plan gives `ralph-plot-sprint` a heartbeat, a wall-clock budget, and a
stall limit so prolonged silence is detectable — arrived at independently from
the Opus 5 system card. It addresses the same failure class as this plan's
pulse log ("can you tell a working loop from a dead one?") for a *single serial
loop*, where this plan addresses *many concurrent workers*.

The two must share one heartbeat vocabulary rather than inventing two. That
plan is Approved and may land first; whichever lands second adopts the other's
terms. Stage 1 below owns the reconciliation.

## Design

### Approach

Three new pieces, one extended piece, one deliberate non-piece.

```
                    ┌─────────────────────────────────┐
                    │  /plot-fleet  (watcher pulse)   │  ← automate ASAP
                    │  stateless; re-derives per tick │
                    └────────────┬────────────────────┘
                                 │ reads (never writes work)
              ┌──────────────────┼──────────────────┐
              ▼                  ▼                  ▼
      plot-fleet-scan.sh   plot-impl-status.sh  plot-plan-meta.sh
              │                  │                  │
              └──────────────────┴──────────────────┘
                                 │  derived fleet view
                    ┌────────────┴────────────┐
                    ▼                         ▼
            docs/plans/<plan>.md        packages/board
            (pulse log appended)        (wave + claim columns)

                    ┌─────────────────────────────────┐
                    │  /plot-dispatch  (fan-out)      │  ← human-paced
                    │  creates worktrees + branches   │
                    └────────────┬────────────────────┘
                                 │ spawns
                    ┌────────────┼────────────┐
                    ▼            ▼            ▼
                 worker       worker       worker   ← own worktree, own branch,
              (claims by pushing its branch ref)      serial inside
```

**The watcher never spawns; the dispatcher never watches.** They do not talk to
each other: the watcher reports what is eligible, a human decides to dispatch
it. That separation is what makes the system restartable — kill anything, and
the next pulse re-derives truth from git.

#### No new datastore (Principle 1)

Lloyd needed SQLite because tickets had no home. Plot's plans *are* the work
table and `plot-plan-meta.sh` is already the machine contract over it. A second
store would violate "git is the database" and create exactly the drift
`/plot-reconcile` exists to catch. Fleet state is **derived**, never stored.

#### Waves, not a dependency graph

Branch relationships in practice are wave-shaped: a tracer bullet proves the
seam, then the rest fan out. The plan template already encodes this by putting
`### Tracer` before `### Implementation`.

Illustration (deliberately shown without backticks or a literal section heading
— see the parser note below):

    [## Branches]

    [### Tracer]
    - feature/x-tracer — thin slice through all layers

    [### Implementation]
    - feature/x-api — endpoint + schema
    - feature/x-ui — form and validation

    [### Wave 3]
    - feature/x-migration — backfill, needs api landed

**Parser note (found while dogfooding this plan).** `plot-plan-meta.sh` enters
branch-scraping mode at a `## Branches` heading and scrapes backticked tokens
from every following line until the next `## ` heading — regardless of fenced
code blocks, which it does not track. A plan containing a second literal
`## Branches` heading in prose therefore poisons `branches[]` with example
names. This plan's first draft did exactly that.

The fix is **"first `## Branches` heading wins"** — later same-named headings are
ignored. A one-line change that resolves the observed failure. Full
fence-awareness was rejected as disproportionate: it adds awk state to the
contract script that 83 tests depend on, to guard against example markup that
the narrower rule already handles. Stage 1 owns it.

**Eligibility rule:** a wave is eligible when every non-deferred branch in every
prior wave has a merged PR. `### Tracer` is wave 1 by convention,
`### Implementation` is wave 2, explicit `### Wave N` beyond.

Under the v1 merge posture (human merges), this means a wave boundary is a
**human checkpoint** — which is the intent, not a limitation: the tracer proves
the seam, a human looks, then the rest fans out. It matches the Pacing model,
where a scope commitment is human-paced.

A per-plan override loosens the rule to *green and ready* instead of *merged*:

| Setting | Wave N+1 eligible when | Status |
|---|---|---|
| `strict` | every prior branch has a **merged** PR | **default** |
| `loose` | every prior branch's PR is **green and ready** | requires a stated reason in the plan |

`loose` buys throughput by letting a wave build on unmerged code — which is
exactly the rebase cascade the risk section warns about. It therefore inverts
Principle 10's burden: where ceremony needs justification only when *increased*,
this setting needs justification when *relaxed*. A plan using `loose` records
why, in the same place it records its ceremony answers.

**A plan with no subheadings is a single wave** — every branch eligible
immediately, which is exactly today's behaviour. No existing plan regresses.

A full dependency graph was rejected: it costs a scheduler, a cycle detector,
and per-branch notation nobody maintains correctly, to express a dependency
shape the team does not actually have.

#### The branch plan is rarely right (design constraint)

The decomposition recorded at plan time is a guess. This rules out
push-assignment — a dispatcher that assigns branch 3 to agent C at fan-out time
leaves C holding a stale ticket when reality reshuffles. Two consequences:

1. **Pull, not push.** Workers repeatedly ask "what is the next eligible
   unclaimed branch?" The plan file stays the single mutable truth; nothing
   caches an assignment.
2. **Append and annotate, never delete.** Principle 2 guarantees that anyone can
   compare what was promised to what was delivered. Mid-flight branch-list edits
   must preserve the promise. `ralph-plot-sprint` already established the
   pattern with `<!-- deferred: reason -->`.

| Reality | Annotation | Written by |
|---|---|---|
| Branch isn't needed | `<!-- deferred: reason -->` | worker (exists today) |
| Branch splits in two | new branch line + a `split-from:` comment naming the original | worker |
| Branch belongs later | `<!-- moved: wave 3, reason -->` | worker |

#### Claim-by-ref: git is the lock

A worker taking a branch (shown without backticks, per the parser note above):

    git worktree add ../plot-wt-NAME -b feature/NAME origin/main
    cd ../plot-wt-NAME
    git push --set-upstream origin feature/NAME   # ← THE CLAIM

Pushing a ref that already exists fails (non-fast-forward). The loser removes
its worktree and asks for the next eligible branch. Git's ref update is already
atomic and already the arbiter — no lock manager, no lease, no coordination
file.

**The push happens before any work, on an empty branch.** Claiming late means
two agents duplicate an hour of work before discovering the collision.

The plan-file annotation is a **reflection**, not the claim:

    - feature/NAME — description <!-- claimed: 2026-08-14T10:22Z, session-3 -->

If the annotation is missing, stale, or contradicts git, **git wins** — the same
relationship the manifesto already defines for the project board ("a read-only
reflection of PR state, never the source of truth").

**One deliberate exception: the reaper reads the annotation.** An abandoned
claim and a crashed worker leave the identical artifact — a pushed branch with
zero commits — so the annotation is the only signal that separates them:

| Plan state | Meaning | Reaper action |
|---|---|---|
| `deferred:` / `moved:` present | worker gave the branch up deliberately | ref is reapable, print the deletion command |
| bare `claimed:`, past threshold, no commits | worker died mid-claim | needs judgment — report, never auto-suggest deletion |

This narrows "no gate reads the annotation" rather than preserving it, and the
narrowing is intentional: the alternative (a tombstone commit convention) puts
the signal in git but invents a new commit grammar for a rare event. The
weakened invariant is stated precisely so it is not rediscovered as a surprise:
**no gate that decides work reads the annotation; the reaper, which decides
cleanup, does.** A wrong annotation therefore causes at worst a missed or
deferred cleanup, never lost or duplicated work.

**Accepted cost:** a crashed worker leaves a pushed-but-empty branch that looks
claimed forever. Stage 4 adds the reaper. Note that "empty branches on approve"
appears in the manifesto's Origin section as a *bug* found during lifecycle
testing — the same artifact is correct here because it is explicit and reaped.

#### Worker lifecycle

`/plot-dispatch` starts **one detached `claude -p` process per worktree**. The
fleet therefore outlives the dispatching session: you can run `/plot-dispatch`,
close the laptop lid, and the workers keep going.

This is the keystone decision — it silently settles three others:

1. **The reaper is core machinery, not emergency cleanup.** Detached processes
   die without telling anyone. Stage 4 is load-bearing, not a nicety.
2. **`/plot-dispatch` is a command, not a session.** It starts processes and
   returns. Nothing must stay open.
3. **Process bookkeeping becomes real work.** PIDs, log destinations, and how a
   human inspects or kills a running worker are Stage 3 concerns, not
   afterthoughts.

The rejected alternative — Task subagents of the dispatching session — is
cheaper and reuses existing fan-out machinery, but it makes the dispatching
session a single point of failure for the whole fleet, which defeats the point
of worktree isolation.

**When a worker gives up.** A worker that has claimed a branch and then finds
the work impossible (branch unnecessary, wrongly cut, blocked) annotates the
plan (`deferred:` / `split-from:` / `moved:`) and **leaves the ref in place**.
It never deletes a remote ref — workers write only to their own branch and to
the plan. The abandoned ref is cleaned up by the reaper, which distinguishes
abandonment from a crash via the annotation (see the claim section above).

**When a worker cannot satisfy the DoD.** Each worker classifies its own branch
against `docs/definition-of-done.md` and only marks its PR ready when the
required BDD scenarios, docs, and changeset are present — moving the DoD check
from *after the burst* to *before the PR exists*. This costs nothing, because
each worker is already serial internally.

If a branch genuinely *cannot* satisfy the DoD yet — a BDD scenario needing a
seam that is still unmerged in an earlier wave — the worker **leaves the PR as
draft and annotates the blocking reason**. The work stays pushed and visible,
and `/plot-fleet` reports it as blocked on wave N. Nothing is discarded, and the
stall is visible rather than silent. Workers do not grant themselves DoD
exemptions; an exemption is a human decision.

#### Worktrees

One worktree per branch, siblings of the repo, named `plot-wt-<branch-suffix>`.
The dispatcher creates them; the reaper removes those whose branch merged or was
reaped.

This is the genuinely missing primitive. Everything in Plot today is
worktree-*safe* (`plot/SKILL.md`: "Never check out `main` locally... essential
for worktree-based workflows") but nothing is worktree-*creating*. The safety
discipline was written for a world with parallel worktrees that never arrived.

#### Merge posture, staged toward a queue

Destination is a serialised merge queue. Getting there in three steps:

| Stage | Who merges | Needs |
|---|---|---|
| v1 | Human only. Workers push, open PR, mark ready, stop. | nothing new — today's `AUTOMERGE=false` |
| v2 | Watcher reports an **ordered merge-ready queue** with conflict prediction; human merges from the list. | ordering + `git merge-tree` dry-run per PR |
| v3 | Single merge authority merges one at a time, signals rebases. | v2's queue + rebase signalling |

v2 is the real unlock and is cheap: the watcher already enumerates PRs, it just
sorts them and dry-runs each merge. Most of the queue's value is *knowing the
safe order*, obtainable without granting any agent merge rights.

Concurrent workers finishing in a burst is precisely when the DoD gate is most
likely to be bypassed, and DoD compliance is the one property whose failure is
not visible in git. Fan-out lands where risk is low (building); serial
discipline stays where risk is high (landing).

#### The pulse log

Appended to the plan's `## Notes`, one line per tick, **clean pulses included**:

```
<!-- pulse: 2026-08-14T11:00Z — wave 2: 2 claimed, 1 eligible, 0 stale; PRs #412 green, #413 CI-red -->
```

Lloyd's lesson applied directly. Without logging clean pulses you cannot
distinguish "fleet idle because done" from "fleet died an hour ago."

### What this does to `ralph-plot-sprint`

The "Finish before starting" rule is **relocated, not overturned**. It stays
intact *within* a worker (each finishes its branch's review→fix→merge cycle
before taking another). It no longer applies *across* workers, because each has
its own worktree and branch. The rule was about one agent's attention and was
doing double duty as a concurrency guard.

That skill's rules were tuned against real observed failures. This restatement
gets **its own branch and its own review pass** (Stage 3) rather than riding
along as an inference.

### Open Questions

- [ ] Does `/plot-fleet` pulse on a timer (`/loop`), on demand, or both? Leaning
      both — on-demand for humans, timed for unattended runs.
- [ ] Reaper threshold for an abandoned claim: fixed duration, or derived from
      `Sprint stall limit` in `opus5-longhorizon-hardening`? Prefer reusing that
      key over inventing a second timeout. Now higher-stakes than at first
      draft: detached workers make the reaper core machinery (see Worker
      lifecycle).
- [ ] Does the pulse log belong in the plan's `## Notes` (git-native, but noisy
      in diffs) or in a separate per-slug log file under docs/plans/pulses/?
      Plan file is the Principle 1 answer; diff noise is the cost.
- [ ] Worktree parent directory: sibling of the repo, or a configurable
      `Worktree root` Plot Config key? Sibling by default, key if requested.
- [ ] Where do detached worker logs go, and how does a human inspect or kill a
      running worker? Falls out of the `claude -p` decision; Stage 3 owns it.

**Resolved during plan interrogation** (see the sections above for the woven
rationale): worker start mechanism (detached `claude -p`), abandoned-claim
handling (annotate, leave the ref, reaper reads the annotation), wave
eligibility (`strict` default with a justified `loose` override), DoD under
burst (worker self-checks before marking ready; blocked branches stay draft with
a reason), and the parser fix (first `## Branches` heading wins).

## Slices

### Tracer
- `feature/parallel-fleet-tracer` → #72 — Stage 1: `waves[]` + `claimed`/`deferred` in
  `plot-plan-meta.sh`, read-only `/plot-fleet` rendering the derived view, pulse
  log, board wave column.
  Layers: plan format → `plot-plan-meta.sh` → `test:reconcile` → skill → board
  Proves: the derived-view approach renders usefully, and the plan-format
  extension survives the contract tests, before anything depends on either.
  Also reconciles heartbeat vocabulary with `opus5-longhorizon-hardening`, and
  fixes the parser so the first `## Branches` heading wins.
  Status: Not started

### Implementation
- `feature/parallel-fleet-claim` → #75 — Stage 2: claim-by-ref in `/plot-implement`
  (push empty branch before work), claim reflections, wave eligibility reporting
  in `/plot-fleet` including the `strict`/`loose` setting, board claim column.
  Makes today's hand-run parallel sessions safe.
- `feature/parallel-fleet-dispatch` → #76 — Stage 3: worktree creation and
  `/plot-dispatch` fan-out via detached `claude -p` per worktree, including
  worker log destinations and how a human inspects or kills a worker. Adds the
  worker-side DoD self-check before PR-ready. Includes the `ralph-plot-sprint`
  "Finish before starting" restatement as a reviewed change.
- `feature/parallel-fleet-reaper` → #77 — Stage 4: abandoned-claim classification in
  `plot-reconcile-scan.sh`, distinguishing deliberate abandonment
  (`deferred:`/`moved:` present → reapable) from a dead worker (bare `claimed:`
  past threshold → needs judgment). Read-only; prints the removal command, human
  runs it, consistent with `/plot-reconcile` today.

### Wave 3
- `feature/parallel-fleet-merge-queue` → #78 — Stage 5: ordered merge-ready queue with
  `git merge-tree` conflict prediction. Human still merges.

### Wave 4
- `feature/parallel-fleet-merge-authority` — Stage 6: single serialised merge authority with rebase signalling. <!-- deferred: conditional on Stage 5's ordering proving trustworthy in practice — an experience question, not a code question; building it now skips the evidence it waits for -->

**Stage 6 is deferred, not dropped.** Everything the plan set out to enable —
several agents on one plan, safely, with a known-good merge order — is delivered
by Stages 1–5. Stage 6 removes the human from the merge step itself, which is
the one place this design deliberately kept them.

## Notes

**Sequencing rationale.** The stage order is itself a tracer bullet: Stage 1
cuts a thin slice through every layer (parser, script, skill, board) while
adding no capability, so the riskiest integration question is answered before
anything is built on top.

**Risk gradient.** Stages 1, 4, 5 are read-only or advisory and cannot corrupt
state. Stages 2, 3, 6 mutate (push refs, create worktrees, merge). Every
read-only stage lands before the mutating stage depending on it — observability
always precedes autonomy. The plan therefore tolerates being stopped at any
stage: stop after 2 for safe manual parallelism, after 3 for real fan-out with
human merges.

**Known risk — DoD enforcement under burst (mitigated, not eliminated).** The
DoD gate is applied per-PR by an agent seeing one PR at a time; several
concurrent workers means several concurrent classifications, and the *fixing*
loop (`ralph-plot-sprint` Step 1) assumes serial attention.

The mitigation is to move the check earlier rather than to add a queue: each
worker classifies its own branch and marks its PR ready only when the DoD
artifacts are present (see Worker lifecycle). Gaps then surface as
still-draft PRs at their source instead of accumulating as red PRs downstream.

Residual risk: a worker's self-classification can be wrong. CI remains the
backstop, and `/plot-fleet` reporting draft-with-reason branches makes a growing
stall visible. This is weaker than a queue and deliberately so — Stage 5 is
where it gets properly solved.

**Sources.**
- Lloyd loop orchestrator — https://www.reddit.com/r/ClaudeAI/comments/1vnnpur/example_of_a_real_working_loop_orchestrator/
  (pattern writeup: https://explainx.ai/blog/claude-code-loop-orchestrator-heartbeat-ticket-memory-august-2026)
- Scape — https://www.scape.work/

Definition of Done: docs/definition-of-done.md
