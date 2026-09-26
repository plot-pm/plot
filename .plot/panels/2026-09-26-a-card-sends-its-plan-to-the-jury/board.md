# board lens — a card sends its plan to the jury

Position: amend
Evidence: executed

## What I ran

Read `plot-config.sh`, `skills/plot-panel/SKILL.md`, `agent-panel.ts`,
`idea.ts`, `commission.ts`, `action-receipt.ts`, `write-gate.ts`; counted the
plan estate; read `/api/board` live (Discovery: 5, every card `rounds: 0`,
including this plan's own).

## The claims that hold

**"No script can invoke a skill", `plot-config.sh:72` — TRUE, verbatim.** The
`Idea command` block says exactly what the plan quotes, including *"every step of
/plot-idea is judgement, and no script here can invoke a skill."*

**`agent-panel.ts` exists and would collide — TRUE.** `packages/board/src/server/
agent-panel.ts`, served at `/api/agent-panel` (`index.ts:542`), consumed by
`WorkerLogModal.tsx:200`. A `/api/panel` in the same directory on the same word is
a real hazard and `Interrogate` is the right avoidance.

**`/plot-panel` is unattended-first — TRUE.** `SKILL.md:54` is the sentence
quoted, word for word, and every step (`:104,:144,:163,:178`) declares its
`PLOT_UNATTENDED=1` behaviour, including step 6 recording the round.

**195 plans shipped with no `Rounds:` — TRUE, and exact.** I counted Delivered or
Released plans: 317 total, 195 with no `Rounds:` field, 122 with one. The
load-bearing number is right and the Approve-stays-enabled argument stands.

**The write-gate registration is real.** `packages/board/test/write-gate.test.mjs`
exists; the last Done-when item is correct.

## The claim that is false

**`action-receipt.ts` does NOT answer *is this action in flight*.**
`action-receipt.ts:39` is the whole type:

```
export type ControllerAction = 'dispatch' | 'approve' | 'deliver';
```

Three actions, none of them a spawn action, and its docstring says what it is for:
the controller's half of `plot-controller-gate.sh` — *"the receipt an endpoint
leaves immediately before it starts a lifecycle script"*. It authorises a script
run for a gate to verify. It is not an in-flight lock and adding a fourth member
would put a non-lifecycle action into a gate's vocabulary.

**The mechanism the plan wants exists and is a different module.** `idea.ts:369`
`ideaStatus` reads a log path and a state file and returns
`'unknown' | 'running' | 'done' | 'failed'` — `running` iff the log exists with no
recorded exit. That is the in-flight answer, and `commission.ts` uses the same
`agentLogPath` shape. Cite that, not `action-receipt.ts`.

## The claim that is wrong in the plan's favour — and it shrinks the plan

**`commission.ts` is this plan's twin and it adds NO config key.** 451 lines,
`POST /api/commission`, single plan by slug, Draft-only, spawns a skill agent —
and it reads `IDEA_COMMAND_KEY` (`:325`) rather than declaring a
`Commission command`. Its refusal is `no-idea-command` with the message *"…
commissioning a plan runs a plot agent, which no script can do; add the key or run
it yourself"* — the plan's own argument, already shipped, already reusing the key.

So the plan's `Interrogate command` key is a fourth spelling of one fact. Three
sibling spawn actions (`idea`, `commission`, and the plan's) all run an agent
because no script can invoke a skill; two of them share one key. A new REQUIRED
key means an adopting repo that configured `Idea command` finds `Interrogate`
refusing for a reason it already answered.

**Reuse `Idea command` and the slice gets smaller, not bigger.** That removes the
config key, one refusal, and the Done-when item about the absent key (it becomes
the existing `no-idea-command` refusal). Three refusals remain — not-a-draft,
plan-unreadable, no-idea-command — plus the in-flight one, which is exactly
`commission.ts`'s set.

If the panel argues the key must be separate (a repo may want plans created but
not interrogated), say so explicitly and argue it against `commission.ts`'s
precedent. Do not leave it unargued: the plan cites `Idea command`'s SHAPE while
not doing what the closest instance of that shape does.

## The measurement with a loose denominator

"195 … against 144 plans with one, out of 346" does not add: 195 + 144 = 339. The
populations differ — 144 is every plan carrying `Rounds:` (Draft ones included),
195 counts only Delivered/Released without. Against Delivered+Released the figures
are 195 and 122 out of 317. The argument is unaffected, but a reader checking the
arithmetic finds it broken and doubts the rest.

## On scope: one slice is right, once the key goes

As drafted (key + endpoint + button + four refusals + write-gate) it is at the
upper edge. With `Idea command` reused it is a smaller `commission.ts` — an
endpoint, a button, three refusals plus in-flight — and one slice is correct.
`commission.ts` is the file to copy, not `idea.ts`: `idea.ts` carries the
issue-body-to-file safety machinery this action does not need, since a plan path
is not attacker-controlled text.

## What to amend

1. Replace the `action-receipt.ts` citation with `idea.ts`'s `ideaStatus` /
   `agentLogPath` as the in-flight mechanism.
2. Reuse `Idea command`, following `commission.ts:325`; or argue explicitly why a
   separate key beats that precedent.
3. Name `commission.ts` as the template and say what is dropped from `idea.ts`.
4. Fix the 195/144/346 arithmetic — state the Delivered+Released denominator.

The design judgements — `Interrogate` over `Panel`, no phase write, no auto-act on
a verdict, Approve never disabled, the board adding no panel logic, distinguishing
missing-rounds from `Rounds: 0` — are all sound and all match the code and the
skill.
