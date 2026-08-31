# Sprint: The domain is one implementation

> Plot's entities, states and rules exist — but each in several places, none of
> them named as the domain. This sprint moves the domain that already exists
> into a package the rest can depend on, and gives it the rules that currently
> live apart from it.

## Status

- **Phase:** Active
- **Start:** 2026-08-29
- **End:** 2026-09-12
- **Release:** 2.13.0 — **held until the domain has replaced the production functions**, see *No release until the domain is real* below

## Sprint Goal

**Every existing function replaced by a domain concept, with full unit and mock
coverage, and production calling it.**

**Three conditions, and all three must hold.** Any one of them alone is the
state the plans call the worst of the three: a domain nobody calls, or one that
is called but unproven, or a set of functions moved without becoming anything.

| condition | what it rules out |
|---|---|
| **replaced** | production still holds its own copy — the duplication this sprint exists to end |
| **fully covered, unit AND mock** | a rule that is called but was never exercised in the paths that matter |
| **expressed as domain concepts** | functions relocated into a package without becoming the vocabulary the spec defines |

**The third is the one that is easy to fake.** Moving `allWavesMerged` into
`packages/domain/` and importing it back is relocation; making it
`allSlicesMerged`, a rule about a **Slice**, is the domain concept. The first
looks finished in a diff and leaves the vocabulary defect behind — which is
exactly the alias sitting in `board.ts` today, marked `TEMPORARY ALIAS`.

**Mock coverage is what makes the second condition reachable at all.** The
domain package holds 100% thresholds today, but `src/adapters/**` is excluded,
on the argument that its uncovered branches need a host to fail or a disk to be
full. **A mocked host can fail on demand**, so that exclusion shrinks to
whatever genuinely cannot be simulated — and what remains excluded has to be
named rather than assumed.

> **Widened 2026-08-30, and the release moves with it.** The goal read only
> *"one implementation … in a package that reaches nothing"*, and that was
> satisfied the moment the domain existed. It said nothing about production
> CALLING it — so an extraction with no caller counted as the goal met, and
> 2.12.0 shipped on that reading: four changelog entries, not one of them a
> change a user notices.
>
> **A second implementation nobody calls is not one implementation.** It is
> three copies where there were two, which the plans themselves say is the
> worst of the available states. The goal now ends where the duplication does.
>
> **Release: 2.13.0, held until that is true** — see *No release until the
> domain is real*.

Measured on `main` 2026-08-28:

| | |
|---|---|
| `contract/schema.ts` | **4,052 lines**, 353 zod schemas |
| its imports | **one** — `zod` |
| its world access | **none** |
| importers | **53** — 37 in the app, 16 in the server |
| `FleetPulse` validated at | **one place** — `pulse-bridge.ts:201` |

**That module is already a pure domain layer sitting inside the board.** It
does not reach a disk, a process or a network; both halves of the application
import it; everything downstream already depends on its shapes.

**So the work is not to build a domain. It is to move the one that exists**
somewhere it can be depended on — and to bring the rules that currently sit
outside it back in.

## MoSCoW

Stories: [[the-master-agent-holds-the-fleet]] (the domain half) — and it is the
prerequisite two other stories are waiting on; see *What this sprint unblocks*.

### Must Have

- [x] [the-domain-moves-out-of-the-board] A `@plot-pm/domain` package carries Plot's entities, states, rules and transitions; the board imports them rather than defining them — measured: `contract/schema.ts` is 4,052 lines with one import and no world access, i.e. a pure domain layer that no other component can depend on because it lives inside the board
- [ ] [the-domain-runs-the-workflows-in-a-sandbox] The domain's ports get adapters and the workflows decide without acting, proven against the real estate — **Approved 2026-08-30, 5 slices**
- [x] [the-controller-answers-every-asker] A controller layer between the callers and the domain — the board's routes and the master agent ask it, and mock adapters on the driven side let a mock board serve every controller — measured 2026-08-30: the seven ports are all driven (world → domain), nothing answers *who asks*, and 10 skills each pay the scan's 18.3 s for facts the board already holds; 6 slices, **Draft** <!-- status: delivered -->
- [ ] [production-calls-the-domain-one-rule-at-a-time] Production code calls the domain instead of duplicating its rules, one rule at a time — **Approved 2026-09-01, 6 slices, one branch per slice.** Its two predecessors are Delivered, so the Draft gate it set itself has cleared. Challenged before approval: the nine-file count re-measures 9 of 9, and its `Spawning the tools` slice was amended — the 16 read-path sites belong to `the-read-path-stops-spawning` (Approved 08-31), leaving this slice the 24 write-route and 12 timer-driven sites

### Should Have

- [x] [the-domain-speaks-slices] The code calls a slice a slice, and `Wave` is freed for the cohort the fleet lands together — measured 2026-08-29: `FleetWaveSchema` holds `branches[]`, belongs to one plan and is persisted in the pulse, which is a **Slice** by every property `DESIGN-slice.md` defines, while the real Wave (cross-plan, formed at dispatch, persisted nowhere) does not exist in code at all

### Could Have

- [x] ~~[the-board-suite-fits-its-budget]~~ **Rejected 2026-08-29 — the diagnosis was wrong.** The cause was three stale selectors after #516 renamed the Board tab (fixed in #519), not a suite outgrowing its budget: 21 tests were dying at exactly 30001ms each, which is 10.5 of the 15 minutes. ~~CI's board-integration step finishes inside its budget, so a red build means a failing test again — measured 2026-08-29: 5 of the last 18 main runs failed, every one of them with "timed out after 15 minutes" and **no failing test**
- [x] [the-artifact-builds-the-same-everywhere] `pnpm build:board` produces the same bytes whatever directory it runs in — measured 2026-08-29: the same commit builds to two different hashes in the main checkout and in a worktree, differing only in esbuild's generated short names, so the freshness gate rejects work that changed no board source. Circular: each PR flips the artifact to its own variant. 22 worktrees here <!-- status: delivered -->
- [x] [a-reset-branch-is-not-a-merged-one] A slice whose branch was reset to the default branch reads `open`, not `complete` — measured 2026-08-29: resetting a branch for a rebuild made its slice read `merged` and opened the next one, because a branch pointing AT main is trivially an ancestor of it <!-- status: delivered -->
- [x] [a-throttled-host-says-so] A scan that could not reach the git host says so, instead of reporting every branch unmerged — measured 2026-08-29: minutes after #513 merged, the scan showed its branch `open` and `merge_detect=pr-merge` while `pr-list` was returning a GraphQL rate-limit error it discarded <!-- status: delivered -->
- [ ] [a-squash-merged-branch-is-not-quiet] A branch is merged when its remote ref is an ancestor of the default branch **or** the host says a PR for it merged — squash-merge leaves a branch permanently ahead, so ancestry alone reads it as still open; 1 slice, **Draft**
- [ ] [a-ui-test-needs-data-not-a-board] A browser test is handed the payload it needs instead of a live board — a UI assertion that boots a server is testing the server; 2 slices, **Draft**
- [x] [a-changeset-says-what-changed] **Approved 2026-08-30.** A changeset is valid when its package exists and its description is one — the rule in the domain, the script an adapter — measured 2026-08-30: **19 of 169** published changelog entries, 11%, because a `bumps:` block placed first becomes the first line and Changesets publishes the first line; 2 slices, **Draft** <!-- status: delivered -->
- [ ] [two-monitors-watch-the-agent] **Approved 2026-08-30.** Three monitors watch the work — process, desk and build — and one report may open a PR — finished work with no PR, a stalled process and a dead agent are reported instead of discovered — measured 2026-08-30: two agents left complete work on branches with no PR, one exited cleanly and one stalled at **50 minutes elapsed against 0.01s CPU**, and both were found only because a person asked; 7 slices
- [x] [a-log-lives-with-its-worktree] **Approved 2026-08-30.** Agent logs move into `.worktrees/` with one resolver instead of 22 hard-coded paths, and the reap rule becomes a domain concept — measured 2026-08-30: **190 log files, 2.6 MB** beside the repo, none belonging to live work, and nothing has ever removed one; 4 slices, **Draft** <!-- status: delivered -->
- [ ] [the-registry-owns-what-it-started] **Approved 2026-08-30.** A dispatch asks whether an agent is free and whether the machine has room, and the manifest records every process the registry spawned instead of one of three — `isFree` and the whole machine measurement exist, are tested, and have zero production callers between them
- [x] [the-exclusion-names-what-it-hides] The adapter coverage exclusion shrinks to what a mock cannot simulate, and what stays excluded is named — the goal calls mock coverage "what makes the second condition reachable at all" and no other plan carried it <!-- status: delivered -->
- [ ] [the-sprint-proves-its-own-goal] A CI gate counts the domain names production still aliases and fails when the number grows — the goal's "replaced" condition was carried by a sentence in one plan's prose, and CLAUDE.md calls that a rule rather than a gate
- [ ] [the-board-decides-nothing] Every verdict, phase and pulse derivation becomes a domain function and the board renders and routes — the condition production-calls and the layering gate both leave behind: a rule that exists ONCE, in the wrong layer
- [ ] [monitoring-is-a-domain-concept] A monitor becomes a pure sample(previous, current) rule with its measuring behind ports — a monitor that owns its own sleep cannot be triggered by a clock, which is the operator's argument for why monitoring is domain
- [ ] [the-pulse-is-an-entity] The pulse gets a DESIGN document and becomes one clock on a machine that every active poller subscribes to by divisor — measured 5/30/60 s with every remainder zero, a ladder nobody wrote down
- [ ] [a-machine-is-an-instance] DESIGN-machine.md stops claiming a Machine has no identity — measured: three Plot projects on one computer, and the spec itself named this as the condition under which it would need a key
- [ ] [a-domain-rule-has-one-owner] Any lifecycle rule found duplicated **while moving** gets its second implementation deleted in the same slice, rather than noted for later — opportunistic, and only where the two provably agree

## Notes

### No release until the domain is real — 2026-08-30

**The next release waits until the domain has replaced the production
functions.** Not until a plan is delivered, not until a sprint closes — until
production calls the domain instead of holding its own copy.

**This was decided after looking at what 2.12.0 actually shipped.** Four
entries, and not one of them is a change a user notices:

| | |
|---|---|
| `Plot's domain leaves the board and becomes @plot-pm/domain` | internal restructuring |
| *(no description — the `<!--` defect)* | broken |
| `The domain's entities lose the Fleet prefix` | internal renaming |
| `Restore the native platform bindings to pnpm-lock.yaml` | repairing a break from the same period |

**It shipped as a minor**, because the bump was raised by hand to make the
sprint's declared target and the changesets' arithmetic agree. The changesets
were right: seven patches. The honest question was not *which number* but
*whether a release was due at all*, and it was not asked.

**Measured: seven plugin releases in eight days, four on one of them.** The
release workflow triggers on every push to `main`, so the bot offers a release
PR after every merge — the cadence follows the merge rate rather than any
decision about value.

#### The condition, and how it is checked

**Done when all three of the goal's conditions hold**, not merely when
production calls the domain. `production-calls-the-domain-one-rule-at-a-time`
being delivered is the first of them; the other two are checked alongside it:

| condition | check |
|---|---|
| **replaced** | the plan's own gates, below |
| **covered** | `pnpm --filter @plot-pm/domain test --coverage` at 100%, and what `src/adapters/**` still excludes is NAMED rather than assumed |
| **expressed** | no `TEMPORARY ALIAS` remains — `board.ts` carries one today, `allWavesMerged` → `allSlicesMerged` |

**The third condition has a grep, and that is deliberate.** *"Functions became
domain concepts"* is otherwise a judgement nobody can settle at release time,
and the aliases are the measurable residue of the relocation-instead-of-renaming
shortcut.

The replacement condition's own gates are already written:

```
grep -rnE "(execFileSync|execFile|spawnSync|spawn)\(" packages/board/src/
```

returns nothing — measured 2026-08-30 it returns **51**. Plus: `plot-deliver.sh`
no longer parses a plan, the scan's output is byte-identical against a frozen
clone, and `grep` finds no second implementation of any adopted rule.

**Fifteen slices across three plans stand between here and there**: sandbox (5,
Approved, one merged), controller (4, Draft), production-calls (6, Draft).

#### What happens to the release PR meanwhile

**It stays open and grows.** Changesets accumulate in it and it regenerates on
every merge; nothing is lost by leaving it for days. A release cut when the
condition is met says *the domain replaced production's rules* — a sentence
worth a version number, unlike *the code was rearranged*.

**Merging is not slowed by this.** Slices land as they finish; only the tag
waits.


### One Must, and two tiers below it — the chain decides which

**All three domain plans are in this sprint**, added 2026-08-29 at the
operator's request. What separates them is not importance but **what can
start**, and the tier says so:

*Snapshot as the sprint was planned; the checklist above is the live state. By
2026-09-01 the first three had all delivered and the fourth was approved.*

```
the-domain-speaks-slices                   APPROVED   3 slices   SHOULD  running FIRST
the-domain-moves-out-of-the-board          APPROVED   4 slices   MUST    paused at slice 2
  └─ the-domain-runs-the-workflows-…       DRAFT      4 slices   SHOULD  blocked on ↑
       └─ production-calls-the-domain-…    DRAFT      5 slices   COULD   blocked on ↑
```

**The rename runs ahead of the Must, and that is deliberate.** PR #511 built the
Must's second slice correctly and was **closed green rather than merged**: it
carried `allWavesMerged` — a name that says *Wave* and means *Slice*. Merging it
would have grown the defect while two further slices built on top of it, so the
vocabulary is fixed first and that slice is rebuilt afterwards.

**A Should ahead of a Must is not a reordering of importance.** The tier still
says what the release gate does — the Must refuses, the Should prompts. It says
nothing about sequence, and here the sequence is set by what the Must's
remaining slices would otherwise inherit.

Each states its dependency in its own header. **Nine of the fourteen slices
cannot begin on day one**, and two of the three plans are not approved — so
tiering them by startability is what keeps the sprint honest rather than
optimistic. A Must that cannot start would be a wish; a Should that is blocked
is a stated intention.

**The release gate reads this correctly.** An unfinished Must **refuses** the
release; an unfinished Should **prompts** and a person decides. So if the chain
runs out of time, 2.12.0 ships what landed and asks about the rest — which is
the behaviour a chain of dependent plans needs.

**And the ordering is real, not advisory** — but only *within* a plan. Measured
after slice 1 merged (#509): `Moving — complete`, `Deliverable — eligible`,
`Entities — blocked`, `Transitions — blocked`. The wave gate serialises even the
slices inside one plan, so a sprint promising fourteen concurrent pieces would
describe a fleet that does not exist.

**Between plans, the gate is the PHASE, not the chain.** Measured 2026-08-29:
all nine slices of the two dependent plans read **`unapproved`**, not `blocked`
— because both are `Phase: Draft`, and `plot-phase-gate.sh` blocks
implementation commits against a Draft plan outright. The cross-plan dependency
is prose; `the-domain-runs-the-workflows-in-a-sandbox` says so about itself:

> **Plot cannot enforce this and will not stop it.** Slice eligibility is
> computed *per plan* … so no component compares two plans.

**That matters for what approving them would mean.** Approving either plan
removes the only *enforced* barrier and leaves an unenforced one — with
auto-dispatch on, its slices become claimable immediately, whether or not the
plan they depend on has landed. So they stay Draft until their predecessor is
delivered, and the tier records the intent in the meantime.

### The four slices, and why they are ordered as they are

| slice | branch | what moves |
|---|---|---|
| Moving | `feature/the-domain-package-exists` | the package, the purity gate, the entity graph out of `contract/schema.ts` |
| Deliverable | `feature/one-deliver-rule-decides-in-the-domain` | `allWavesMerged` + its 25 tests; three board call sites import it |
| Entities | `feature/the-entities-carry-their-states` | the ten entities the pulse does not carry, each with its identity kind |
| Transitions | `feature/a-transition-is-one-value` | `plan.approve()`, `.deliver()`, `.release()` — returning what to write, not writing it |

**Moving is first because everything else imports what it creates.** The other
three are independent of each other once it lands.

### A move, not a parallel build

An earlier draft proposed building fresh entities *beside* the pulse types and
proving agreement with a corpus test. **That would have created a third
implementation of shapes that already exist twice** — the duplication
[stage 2 §5](../stories/the-master-agent-holds-the-fleet/DESIGN-review-workflows.md#5-the-distinction-that-decides-it)
forbids — and required a later plan to remove it.

**A move creates no duplication at all**, so there is nothing to remove and no
window in which two answers exist. This is the sprint's central bet, and the
thing to abandon the design over if it stops being true.

### What the existing tests can and cannot prove

**They prove behaviour is preserved. They cannot prove it is right.** A rule
that was wrong before the move is wrong after it, and unedited tests will
happily confirm the wrong answer in its new location.

So the gate for each slice is not "the tests still pass" — it is the plan's own
`Done when` clauses, plus the reconcile scan on the real estate. **The scan is
what says a moved rule is subtly wrong**, because it derives from git rather
than from the code under change.

### Board impact is YES, on every slice

Types move out of `contract/schema.ts` and the board imports them back. **The
pulse contract does not change** — the same shapes, validated by the same zod,
resolved from a different package. The artifact must be rebuilt on every branch,
and the [Definition of Done](../definition-of-done.md) gates it in CI.

### What this sprint unblocks, and why those are not items here

**Two draft stories are waiting on this one, and neither has a plan.**

| story | needs | which slice supplies it |
|---|---|---|
| [[plot-agent-identity]] — *An agent is someone, not something running* | `Agent` and `Person` as entities with a declared identity kind | **Entities** |
| [[plot-plan-economics]] — *What a plan costs, and what the approval was worth* | a plan transition as a **value** that can be summed over | **Transitions** |

**They are named here and deliberately not counted here** — unlike the two
dependent domain PLANS, which are now sprint items in the Should and Could
tiers. The difference is that a plan can be dispatched once its predecessor
lands, while a story with no plan cannot be dispatched at all: it is a finding,
and `/plot-idea` has to run first. That is the shape the deferred sprint states
about its own contents (*"All eight items are findings, not plans"*).

**The dependency is real rather than thematic.** `plot-agent-identity` asks for
an identity that exists *before* dispatch and *survives* the branch; that is a
sentence about an entity with a state source, which is exactly what the Entities
slice constructs. `plot-plan-economics` asks what a plan cost and what its
approval was worth; a cost summed per approval needs the approval to be a value
somewhere, which is what the Transitions slice returns instead of writing.

**Both become plannable the moment those two slices land** — and neither is
plannable before, which is the argument for doing this sprint first rather than
these stories.

### What this sprint displaces

`a-half-landed-workflow-says-so` (W36 as originally numbered) was the planned
next sprint and is **deferred, not dropped**. Its findings are real and its
detection already exists; nothing in it decays by waiting.

**One caveat worth stating, because it argued the other way.** That sprint makes
half-landed workflows report themselves — and a refactor of the lifecycle rules
is exactly the kind of change that produces half-landed workflows. Doing the
hygiene first would have spread the net before the fall. The trade is accepted
deliberately: the domain move is the larger structural win, and the reconcile
scan already reports the drift today even though nothing consumes it.

**So while this sprint runs, read `plot-reconcile-scan.sh` by hand** rather than
trusting a workflow to report its own incompleteness. That is the protection the
deferred sprint would have automated.

### 2.12.0 shipped the Must and one Should — 2026-08-29

`v2.12.0` is tagged. The release gate was clear: the Must Have was Delivered,
so no `--ignore-sprint` was needed and none was used.

| | |
|---|---|
| `the-domain-moves-out-of-the-board` | **Released** in 2.12.0 (MUST) |
| `the-domain-speaks-slices` | **Released** in 2.12.0 (SHOULD) |
| `the-domain-names-its-entities` | shipped in 2.12.0 (#526) — not a sprint item |

The two boxes above were ticked in this pass rather than at delivery:
`/plot-deliver` moves the plan and nobody re-ticks the box, so the sprint read
its own Must Have as unfinished while the plan estate said Released. The gate
resolves that correctly (`checked:false, delivered:true → done`), but a person
reading the file saw the wrong thing.

**What the release did NOT contain**, and why neither is a gap:

- `the-domain-runs-the-workflows-in-a-sandbox` — Draft, 4 slices, **no branch
  exists**. Its blocker (the Must) is now met, so it is startable; that gate is
  a person's to open.
- `production-calls-the-domain-one-rule-at-a-time` — Draft, 5 slices, no branch
  exists, still blocked on the sandbox plan.

Both are unstarted rather than unlanded: measured 2026-08-29, no branch on the
remote carries a `packages/domain` commit that the default branch lacks.

### The four Could Haves are measurements from this sprint

`a-throttled-host-says-so`, `a-reset-branch-is-not-a-merged-one`,
`the-artifact-builds-the-same-everywhere` and `a-domain-rule-has-one-owner`
were each written from a defect observed while doing the work above. They carry
their measurements and are open for 2.13.0.

`a-domain-rule-has-one-owner` has **no plan file** — it reads as a policy for
work in flight ("delete the duplicate in the same slice") rather than a plan to
schedule. Worth settling which it is before the next sprint closes.
