# Rule lens — a round is a domain fact

Position: amend

The gap is real and the transition is worth having. Two of the five refusals do not survive contact with the estate, the "increment, never set" rule installs the second writer this repo names as its recurring defect, and the shape does not match the model the plan cites. Each is fixable inside the plan's own frame, which is why this is `amend` and not `reject`.

## 1. Is the gap real? — YES, all three claims verified

| claim | verdict | evidence |
|---|---|---|
| `grep rounds packages/domain/src` outside tests returns nothing | **TRUE** | 3 hits, all unrelated: `host-shell.ts:360` ("on the grounds"), `rules/sample.ts:7` ("backgrounds"), `entities/pulse.ts:101` ("Rounds to the nearest beat"). Zero mention the field. |
| `plot-plan-meta.sh` parses it | **TRUE** | `:242-250` documents it; `:657-665` resolves it; three sources with a stated precedence. |
| `PlanCard.tsx` renders it | **TRUE** | `roundsBadgeText` at `:226-229`, rendered `:412`; reused by `agent-rows/rows.tsx:565,745`; `schema.ts:172,414` carries it on both `PlanMeta` and `Card`. |

**The domain genuinely has no idea what a round is.** The premise holds.

## 2. The five refusals

### `zero-rounds` — REAL, and the estate confirms the reason

Measured: **2 plans carry `Rounds: 0`** against 109 carrying ≥1. The template's rule (absent ≠ zero) is honoured by `plot-plan-meta.sh:249` — *"OMITTED ENTIRELY when no source carries a readable round"*. A refusal that keeps `0` unwritable is checkable from the input alone and worth having.

One correction to the plan's framing: `recordRound` **increments**, so it can only ever produce ≥1. `zero-rounds` therefore cannot fire on the transition's own output — it can only fire on a caller that passes an explicit count, which the plan's signature does not admit. As specified, this refusal is **unreachable**. Either the input takes an explicit count (and the refusal is real) or it does not (and the refusal is dead code). The plan must pick one.

### `not-a-plan` — CHECKABLE, but near-empty

Measured: of every file in `docs/plans/`, exactly **1** carries no `State:` (`2026-09-09-the-ci-key-carries-its-instance.md`). The refusal is checkable from the text with no filesystem, and it matches a rule the estate states twice (`plot-reconcile-scan.sh`, `plot-fleet-scan.sh`). Cheap and consistent. Keep it — but it is not load-bearing evidence for a controller.

### `phase-terminal` — **CHECKABLE AND WRONG AS STATED**

This is the finding that most needs an amendment. Measured over every plan carrying a `Rounds:` field:

```
  96 Released
   8 Rejected
   4 Delivered
   2 Superseded
   1 Approved
```

**96 of 112 — 86% — are Released.** The plan says *"a Released plan cannot gain a round — the interrogation is history"*. But the estate's rounds are overwhelmingly recorded on plans that went on to ship, which is expected: a plan is interrogated as a Draft and released later. So the refusal is harmless in the normal direction (nobody re-panels a shipped plan) and it is **not** what the plan's own evidence needs.

Worse, the plan contradicts itself two sections down: *"No phase moves. Recording a round is not approval. **A rejected plan keeps its round beside its rejection.**"* 8 plans carry a round and state `Rejected`, and `Rejected` is terminal in this lifecycle just as `Released` is. If `phase-terminal` keys on terminality it refuses those 8; if it hardcodes only `Released` it is not the rule its name claims. **Name the exact set of refused phases, and reconcile it with the Rejected carve-out.**

### `no-moderation` — **THE PLAN'S CENTRAL CLAIM, AND IT IS ARCHITECTURALLY BROKEN AS WRITTEN**

The plan says this is *"the one that earns the controller"* and that *"it is checkable — the moderation file exists or it does not"*. Both halves of the rubric's question bite here.

**A filesystem-free transition cannot check it.** The plan states at `:42` that `recordRound` *"reaches no filesystem"* — correctly, since that is the domain's rule and every sibling obeys it. But at `:80` the slice says the transition takes *"the plan text and the subject's moderation PATH"*. A path is not an existence check. A rule handed `.plot/panels/x/panel.md` as a string cannot tell whether that file is there.

**The estate already has the right mechanism and the plan does not use it.** `transitions/plan.ts:76-84` defines `Precondition` for exactly this — *"A fact a transition needs but cannot measure — supplied by an adapter. The PR check is the motivating case: it needs a host, so the domain takes it as a reading rather than performing it."* The refusal it produces is `precondition-unmet` (`:173-183`). `recordRound` must take a **reading** (`moderationPresent: boolean`), not a path, and the shell must do the `test -f`.

That is a mechanical fix, but it costs the plan its headline argument. **Once the existence check moves to the shell, `no-moderation` is a refusal over a fact the caller supplies.** A caller that skips the write entirely never reaches the rule — and skipping the write is precisely the failure measured. The refusal catches *"called with no moderation"*, never *"never called"*. It does not earn the controller in the way the plan claims.

**And the estate says `no-moderation` would misfire.** Measured across all 41 panel directories: **17 have no `panel.md`**, including 4 of the 9 dated 2026-09-22 and 2 of the 4 the plan's evidence rests on (`a-clear-desk-is-not-a-finished-one` has one; `work-given-up-is-not-work-never-done` and this plan's own directory have none yet). Yet **`2026-09-15-the-skills-say-slices` carries `Rounds: 5` with no `panel.md`**, and `a-slice-says-what-it-spent` carries `Rounds: 5` with a `panel.md` and a `panel-r2.md`. The moderation filename is **not a fixed convention** — the directories hold `panel.md`, `panel-r2.md`, `decision-head.md`, `decision-scope.md`. A refusal keyed on one filename refuses legitimately-moderated rounds. **Name how the moderation is located, or the refusal fires on 41% of the estate's panels.**

### `count-unparseable` — REAL AND CORRECT

The strongest of the five. `plot-plan-meta.sh:664` already drops a non-numeric value silently (`if (_r != "" && _r ~ /^[0-9]+$/)`), so an unparseable field today reads as *absent* — indistinguishable from a plan nobody questioned. Refusing rather than overwriting preserves the evidence, and the rule is checkable from the text alone. Keep it exactly as written.

**Distinctness:** the five are mutually distinct as reasons. Two (`zero-rounds`, `no-moderation`) are not checkable as the signature stands.

## 3. Is the shape right? — NO. It does not match `setSprintState`.

The plan cites `setSprintState` as its model (`:42`, *"the shape `setSprintState` established: it takes the plan document, returns the text to write"*). Read at source, `setSprintState` does neither of those things.

| | `setSprintState` (`transitions/sprint.ts:205`) | `recordRound` as planned |
|---|---|---|
| takes | a parsed **`Sprint` entity** + an input struct | "the plan document" (text) |
| returns | a `TransitionResult` — a **decision naming a field and a value** | "the rewritten `## Status` block" |
| who renders the write | the **shell** (`plot-sprint-state.sh:93`) | the transition |

Every transition in the package returns `Decision { slug, phase, field, record, alreadyRecorded }` (`plan.ts:121-137`) — *a state and the record that dates it*, never rendered markdown. The shell performs the write. The plan inverts this: a domain rule that emits a `## Status` block is a rule that owns text layout, which is the one thing `challenge-the-plan/SKILL.md:371-380` is emphatic must stay a surgical replace-or-insert (*"Never a rewrite of the section, never a reflow… A greedy match there destroys history"*).

**Two further mismatches the plan does not mention:**

- `TransitionPlan` (`plan.ts:42-68`) has **no rounds field**. It carries `slug`, `phase`, `review`, and four record lines. `recordRound` needs the current count, so the entity must gain a field — a real, unbudgeted change the plan is silent on.
- `Decision.phase` and `Decision.field` are **closed unions**: `'approved'|'delivered'|'released'|'rejected'|'superseded'` and `'Approved'|'Delivered'|'Released'|'Rejected'|'Superseded'`. `Rounds` is in neither, and `Decision.phase` is required. A round write **does not typecheck against the existing result type**. Either `Decision` widens — touching every transition and every consumer — or `recordRound` returns a different type, at which point it is not `setSprintState`'s shape at all.

The plan's own note says *"No phase moves"*, which is correct and is exactly why `Decision` does not fit. **This is the largest unpriced item in the plan.** The slice is one branch, "unit tests pin each refusal" — it is materially bigger than that.

## 4. Is "increment, never set" correct? — THE PREMISE IS TRUE, THE RULE IS WRONG

**The premise checks out.** A plan can face a panel twice, and the estate proves it two ways: `a-connector-declares-its-ceiling` and `a-slice-says-what-it-spent` each hold a `panel.md` **and** a `panel-r2.md`, carrying `Rounds: 2` and `Rounds: 5`. A plan rewritten after rejection is also real — `a-waiting-loop-has-not-finished` is `Superseded`, replaced by `a-clear-desk-is-not-a-finished-one`.

**But the plan's own cited example does not support incrementing.** `a-waiting-loop-has-not-finished` carries `Rounds: 1` — not 2 — because the rewrite is a **different plan file** with its own count. The plan claims *"both are rounds"* and that the count should reflect it. On the estate, two panels over two files gave two files one round each. Incrementing would not have changed that, because the second panel ran against a new file starting from no field.

**The real objection: incrementing installs a second writer with a different source of truth.**

`/challenge-the-plan` does **not** derive N from the `Rounds:` field. `SKILL.md:361-372` derives it from the `CHALLENGE-THE-PLAN-METADATA` block and writes both from one value:

> *"In the same step, write `- **Rounds:** N` to `## Status` using the same incremented value… **Both writes, one value — they cannot disagree by construction.**"*

`recordRound` reads the `Rounds:` field and adds one. Wire `/challenge-the-plan` to it, as slice 2 proposes, and the count now comes from a different source than the block it must stay consistent with. Measured: **10 plans carry both a `Rounds:` field and a metadata block**; 102 carry the field alone. The parser's precedence (`plot-plan-meta.sh:244-248`) says the field wins — so a drift between them is silent, and the block that `/challenge-the-plan` reads on its next run is now stale.

This is the exact failure the plan names in its own "What must not break": *"Two writers of one field is the drift this estate names repeatedly."* **The plan creates it while forbidding it.** Amend: either `recordRound` takes the count as an input the caller derives (leaving `/challenge-the-plan`'s block authoritative), or the plan states how the block and the field stay reconciled.

## 5. Is this worth a controller, or is it a rule dressed as a gate? — A CONTROLLER, BUT NOT FOR THE REASON GIVEN

`CLAUDE.md`'s test: *"Can you answer 'did I complete this?' without actually doing the work? If yes, it's a rule."*

**Apply it honestly to `recordRound` and it fails.** An agent that never calls the controller can still believe it recorded the round. Nothing fires. The refusals only exist inside a call that was made — they are checks on a write in progress, not a stop on a write omitted. `plot-state-gate.sh` is this estate's model of a real gate, and the plan's own Notes concede it does not apply here: *"it guards `State:` lines, and `Rounds:` is not a lifecycle phase. **The refusals are the gate here.**" Refusals are not a gate. They are a rule that runs when invoked.

**The four skipped writes are evidence of something else.** Commit `954164cfe` — *"plot: record the panel rounds the three plans had"*, 2026-09-22 12:31 — repaired it **by hand, two files, the same day**, and its message reasons correctly about all four cases:

> *"a-failed-tick-must-not-end-the-daemon correctly keeps no field: it had no panel, it was built directly. And nobody gets `0`, which would say questioned-and-nothing-came-of-it."*

So the measured failure was caught within hours by a person reading the board, and the repair applied the very rules the plan wants encoded. That is evidence the **field is legible and the omission is visible** — not evidence that prose is unenforceable. The plan's claim that *"prose is what failed"* overstates what one day's data shows. And it is one day: 37 of the 41 panelled plans on this estate **do** carry a `Rounds:` field, so the base rate of the failure is 4 in 41, not the universal breakdown the framing implies.

**The controller is still worth building** — but for the reasons the plan states last rather than first. `count-unparseable` is a genuine rule no prose enforces and that silently degrades today. The absent/zero distinction is subtle, stated in three places, and gets it wrong in both directions if a human writes the field. Consolidating one writer for a field with three parse sources is worth doing on its own merits. **What it is not is a gate, and the plan should stop claiming `no-moderation` earns it.**

## What would move this to proceed

1. **Take `moderationPresent` as a `Precondition` reading, not a path.** Use the existing `precondition-unmet` machinery; let the shell do the `test -f`. Say how the moderation file is located, given 17 of 41 panel directories have no `panel.md` and moderations are also named `panel-r2.md`, `decision-head.md`, `decision-scope.md`.
2. **Price the result type.** `Decision.phase`/`field` are closed unions with no `Rounds` member and `phase` required. State whether `Decision` widens or `recordRound` returns its own type — and drop the claim that it returns a rewritten `## Status` block, which no transition in the package does.
3. **Resolve the two-writer problem.** `/challenge-the-plan` derives N from its metadata block, explicitly so the two cannot disagree. Say how the block and the field stay reconciled across the 10 plans carrying both.
4. **Fix `phase-terminal`.** Name the refused phases and reconcile with *"a rejected plan keeps its round"* — `Rejected` is terminal and 8 plans sit in it with a round.
5. **Decide whether `zero-rounds` is reachable.** With increment-only it cannot fire.
6. **Drop the gate claim.** Keep the controller, argue it on single-writer and `count-unparseable`, and say plainly that a caller who never calls is still uncaught.

Position: amend
