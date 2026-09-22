# Caller lens — a round is a domain fact

Position: amend

**A rule with no caller is dead code, and this rule would have callers.** The verdict is `amend` rather than `reject` because `recordRound` is genuinely callable and one of its refusals is genuinely uncheckable by prose. It is `amend` rather than `proceed` because the plan's central evidence — *"four panels, four skipped writes"* — is wrong about what those four panels were, and the error runs straight into the design: **three of the four were DELIVERY panels, and the plan's own rule says a delivery round is meaningless.** The transition as specified would count them.

---

## 1. Who would call it, and would they?

Three callers are named. They do not hold equally.

| caller | would it call? | what would make it |
|---|---|---|
| `/challenge-the-plan` | **yes, and it already writes the field** | replacing an existing write with a call is a mechanical substitution; the skill owns phase 5b and nothing competes for it |
| direct `/plot-panel` invocation | **this is the real caller, and it is the weakest** | nothing; a master agent typing `/plot-panel` reads step 5's prose or does not |
| `/plot-deliver` | **must NOT call it** — and the plan agrees | — |

**The first caller is already a caller, and that is not a point in the plan's favour.** `challenge-the-plan/SKILL.md:371-377` specifies the write in more mechanical detail than this plan specifies the transition: replace-or-insert-after-`Impl:`, never a section rewrite, never a line-number insert, with a stated reason (*"a greedy match there destroys history"*). Slice 2 replaces a working, precise instruction. That is a net-zero move on the caller that works, to serve the caller that does not.

**And `challenge-the-plan:333` already names the third caller:**

> *"The round is owed by anyone who interrogates a plan, whether or not this skill did the interrogating — an interrogation conducted directly writes `- **Rounds:** N` to `## Status` by the same rule below."*

So the estate's answer to *"a direct invocation is a caller too"* was written before this plan and is not new here. The plan presents it as *"the third caller neither anticipated"*. One of them anticipated it explicitly. **What is missing is not the statement — it is that `/plot-panel` never points at it.** That is a one-line cross-reference, and the plan does not consider it.

## 2. Is the plan's own evidence honest? — **No. Counted, it inverts.**

Measured on this estate, 2026-09-22:

- **41 panel subject directories** under `.plot/panels/`, not four.
- **35 of 41 subjects carry a `Rounds:` field; 6 do not.** An 85% write rate, against a plan whose premise is that prose does not get followed.
- The `/plot-panel` skill itself measures the *field's* base rate at **27.6% across 268 plans** (`plot-panel/SKILL.md:27`). Panel subjects sit three times higher.

**The "four panels, four skipped writes" is one day, and the four are not what the plan says.** The back-fill commit is `954164cfe`, *"record the panel rounds the three plans had"* — it touched **two files**, not three or four. Classifying each of that day's panels by its commitment vocabulary:

| subject | panel kind | plan's own rule |
|---|---|---|
| `a-free-agent-is-not-a-finished-one` | **delivery** (`supported/refuted`) | a round here is meaningless |
| `a-loaded-label-is-not-a-running-daemon` | **delivery** | meaningless |
| `a-waiting-loop-has-not-finished` | **delivery** | meaningless |
| `a-failed-tick-must-not-end-the-daemon` | **delivery** | meaningless |

**All four were delivery panels.** `a-failed-tick`'s moderation opens *"Delivery panel moderation"* and gates on `Position: supported|refuted`. The back-fill commit's own message says that plan *"correctly keeps no field: it had no panel, it was built directly"* — and `.plot/panels/2026-09-22-a-failed-tick-must-not-end-the-daemon/panel.md` exists, committed as `f390a0b2b`. **The operator hand-writing the evidence for this plan mis-classified one of the four while writing it.**

So the honest reading of that day is not *"prose failed four times"*. It is: **four delivery panels ran, three got a `Rounds:` increment they should not have had, and one correctly got none — by accident, on a stated reason that was false.**

That inverts the plan's premise. The failure mode the estate actually demonstrated on 2026-09-22 is **over-counting delivery rounds**, not under-counting draft ones.

## 3. The load-bearing refusal — **respected in prose, broken by the specification**

The plan is right that `/plot-panel`'s refusal must hold, and right that routing the write through the moderation step rather than the mechanism preserves the separation *in principle*. A controller call from the caller's step is not the mechanism touching the plan.

**But the transition as specified cannot tell the two panels apart.** `recordRound(plan, input)` takes the plan document and the moderation path; its five refusals are `zero-rounds`, `not-a-plan`, `phase-terminal`, `no-moderation`, `count-unparseable`. **None of them asks what kind of panel wrote that moderation.** Both kinds write `.plot/panels/<subject>/panel.md`. `no-moderation` — the refusal the plan calls *"the one that earns the controller"* — is satisfied identically by a delivery moderation and a draft one.

`phase-terminal` does not close this. It refuses a **Released** plan. Delivery panels here run on Draft, Approved and Delivered subjects: of the six panel subjects carrying no field, two are Delivered, one Approved, three Draft. `a-failed-tick` is Approved with a delivery panel — `phase-terminal` passes it, `no-moderation` passes it, and the controller increments a round the plan's own §"Who calls it" says is meaningless.

**The separation the plan calls load-bearing is stated in the prose and absent from the mechanism.** The rule it builds would automate the exact error the estate made by hand three times that day, and do it faster.

The fix is available and the plan has the ingredient: the moderation names its commitment vocabulary, which CLAUDE.md already establishes is the **caller's** (`proceed/amend/reject` for a Draft juror, `supported/refuted` for a delivery one). A sixth refusal — `not-a-draft-round`, keyed on the vocabulary the moderation gates on — is checkable from the file `no-moderation` already reads. **That is the refusal that earns the controller, and it is the one missing.**

## 4. Gate or rule? — **A rule, and the plan's own framing is what exposes it**

The plan opens by citing CLAUDE.md's test and applying it to the superseded plan. Applied to this one:

> *Can you answer "did I complete this?" without actually doing the work?*

A skill step reading *"call `plot-panel-round.mjs`"* is answerable without doing it, exactly as *"write the field"* is. **The agent that skips the instruction skips it identically.** The controller refuses bad input; it cannot refuse never being invoked. Swapping the verb in a prose instruction does not change the instruction's enforceability — it changes what happens *conditional on* the instruction being followed.

The plan's Notes say *"the refusals are the gate here."* Refusals are input validation. `plot-state-gate.sh` is a gate because it intercepts a `Bash`/commit invocation the agent cannot avoid making; `plot-phase-gate.sh` likewise. `setSprintState`'s nine refusals — the estate's own canonical dead-rule — were refusals too, and they sat unreached for weeks. **The plan cites that precedent as motivation and then reproduces its shape.**

**What would actually enforce it**, in descending order of what this estate already has working:

1. **A `plot-reconcile-scan.sh` section** — a subject directory under `.plot/panels/` whose **draft** moderation exists while its plan carries no `Rounds:`. Read-only, reports and never gates, exactly the shape of sections 14–22. It costs one `for` loop over a directory the estate already writes, needs no domain rule at all, and catches the miss whoever the caller was — including the caller nobody anticipated. **It also catches the inverse defect measured above**, which nothing in this plan does.
2. **The unattended-shape sweep**, which already walks every skill and which the superseded plan named as the thing that would pin its instruction.
3. A `PostToolUse` hook on a write to `.plot/panels/*/panel.md` — genuine interception, and the only true gate on offer.

None of the three requires `recordRound`. Option 1 is a finding the estate reads the same day.

## 5. The simpler answer — derivation, and **why the measurement kills it**

The rubric asks whether the field could be **counted from the panel directories** with no transition at all. I looked, and the answer is instructive in the opposite direction from what I expected.

**Derivation is not viable, and the reason is not the one usually given.** Counting `.plot/panels/<subject>/` moderations would count **delivery** moderations — the same conflation as §3, now built into the reader instead of the writer. It would also count zero rounds for every plan interrogated by `/challenge-the-plan`, which writes no panel directory: of 35 panel subjects carrying the field, several were sequential rounds. A derived count would report `a-dispatch-action-asks-for-its-brief`'s **9 rounds** as 0.

**So the field must be written.** That is a point for the plan, and the strongest one available to it.

But the simpler answer sits one step to the side of derivation, and the plan does not consider it:

> **`/plot-panel` step 5's moderation instruction gains one sentence pointing at `challenge-the-plan:333`, which already states the rule and already specifies the write** — and `plot-reconcile-scan.sh` gains the section in §4.1 that reports a draft panel whose subject carries no field.

That is the write specified once (where it already is, precisely), the pointer added where it is missing, and a **reporting** mechanism catching the miss — which is this estate's demonstrated pattern for exactly this class of problem, per the scan's own twenty-two sections. It costs no bundle, no transition, no second writer, and it leaves `/challenge-the-plan`'s working write untouched.

**The plan asserts *"two writers of one field is the drift this estate names repeatedly"* as the reason to replace that write.** Today there is **one** writer. The plan creates the second writer and then consolidates — a real cost paid to remove a risk the plan itself introduces.

---

## What would move me to `proceed`

1. **Correct the evidence.** Four delivery panels, not four skipped draft rounds. Report the 35/41 write rate against the skill's own 27.6% baseline, and state what that means for the premise.
2. **Add the sixth refusal.** `not-a-draft-round`, keyed on the moderation's commitment vocabulary. Without it the transition automates the estate's measured error rather than preventing it. This is the refusal that makes the controller worth building, and it is the one that makes §"Who calls it" true in the mechanism rather than only in prose.
3. **Say the caller is a rule and name what gates it.** Drop *"the refusals are the gate here"* — they are input validation. Name the scan section, and prefer building it first: it is cheap, it catches every caller, and it catches the over-count too.
4. **Justify replacing `challenge-the-plan`'s write.** It is more precisely specified than the replacement. If it must be replaced, carry its replace-or-insert-after-`Impl:` rule and its reason into `recordRound`, or that reason is lost.

The unit-of-round definition (§"What a round is"), the increment-not-set rule, and `count-unparseable` refusing rather than overwriting are all sound, and I would keep them unchanged.

**Evidence: read + measured.** I read the plan, the superseded plan, `plot-panel/SKILL.md`, `challenge-the-plan/SKILL.md`, and the back-fill commit; I enumerated all 41 panel directories, cross-referenced each against its plan's `Rounds:` field, classified each moderation by commitment vocabulary, and traced the writes through `git log -S`. I did not run `recordRound` — it does not exist.
