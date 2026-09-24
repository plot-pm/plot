# Design lens — a-plan-less-row-is-not-a-nameless-plan

Position: amend

The defect is real and the two component-side fixes are right. The **open question is answerable today, from three independent pieces of evidence already on the estate**, and the plan should carry the answer rather than defer it. The **layering claim is wrong on a point of fact**: section placement is decided in neither the domain nor the component, and the plan's own citation of the "domain property" rule mislocates the work.

## 1. The open question is answerable: WAITING ON YOU, as `abandoned`

Three readings converge, and none of the three is in the plan.

**(a) The route already exists and the row nearly reaches it.** `packages/board/src/server/fleet.ts:5039-5082` is the `state === 'wip'` fallthrough, and its comment states the exact population the plan calls open:

> *"real commits, no local activity, and … NO OPEN PR. That is `quietKind`'s `abandoned` exactly … WAITING ON YOU, because it is the one kind that genuinely needs a person: revive it, or drop it."*

It routes through the domain — `quietNote(readings)` / `quietNeedsPerson(readings)` (`fleet.ts:5064`, `:5080`), i.e. `packages/domain/src/rules/quiet.ts:144`, `:203`. The measured rows do not reach it because of ONE line above it: `fleet.ts:5033`, `if (ageMinutes !== null && ageMinutes <= quietMinutes) return { group: 'not-started', … }`. The plan's measured rows say `note: "in progress"`-shaped and `state: wip` with a recent tip, so they are caught by the age gate and never meet the rule that was written for them. **So the destination is not an open design question — it is the answer the code already argues for, reached by a branch older than `quietMinutes` and missed by a branch younger than it.**

**(b) The estate's other reader gives the same answer and names the actions.** `skills/plot/scripts/plot-reconcile-scan.sh:2243` — section 19, `unclaimed_work=`:

> `== 19. Unclaimed work (a branch with changes no plan names — a person decides) ==`
> `decide: open a PR for it, write the plan that claims it, or delete the ref` (`:2280`)

Same predicate as the plan's population — *no plan names it, no open PR carries it, not merged* — and it already concludes **a person decides**, with three concrete actions. Two readers of one fact must not give two answers; this one is older, measured (8 findings, 2026-09-07, `:2303`) and has a stated verb.

**(c) #967's own taxonomy places it.** The issue's three-way table assigns `abandoned` to **my problems** — *what is broken and needs me?* — and the estate's largest measured instance is precisely this population: *"13 bare branches with no plan and no worker"* of 18 WAITING ON YOU rows. So the answer is not merely compatible with #967; it is the row type #967 counts most of.

**This answers the plan's table directly.** *A labelled group inside NOT STARTED* is refuted by its own hint and by (a). *Its own section* is refuted by (a) and (b): the estate already has a word (`abandoned`) and a section that carries it, so a new section would be a third name for one thing. **WAITING ON YOU is the answer, carrying the existing `abandoned` kind**, and the plan's "against" for it — *#967 reports the section answers too many questions* — is an argument for #967's split, not against a correctly-placed row. A correct row in a crowded section is a crowding problem; a wrong row in a promise-breaking section is this bug.

## 2. Which section's promise it satisfies

Read against `packages/board/src/app/lib/agent-rows/sections.ts:25-49`:

| section | hint | does a plan-less branch satisfy it? |
|---|---|---|
| `waiting-on-you` (`:26`) | *review, merge, decide* | **yes** — §19's verb is literally `decide:` |
| `working` (`:27`) | *nothing to do — just look* | no — no agent |
| `waiting-on-machine` (`:38`) | *nothing — a machine is working* | no |
| `not-started` (`:43`) | *approved — nobody has taken it* | **no** — the plan is right, `phase: null` is not approved |
| `quiet` (`:44`) | *still thinking, or dead?* | no — `quietNeedsPerson` (`quiet.ts:203`) releases only `closed-pr`/`merged` |
| `done` (`:48`) | *delivered* | no |

Exactly one hint fits, and it fits by the word the estate already uses.

## 3. The layering claim is factually wrong, and it matters

The plan says (line 58): *"The section placement is a rule … so it is a domain property"*, citing CLAUDE.md's *"a view state that cannot be asserted without a browser is a domain property that has not been extracted yet."*

**Section placement is decided in neither place today.** It is decided in `packages/board/src/server/fleet.ts` — `classifyGroup`, whose `not-started` returns sit at `:4418-4420`, `:4687`, `:4706`, `:4724`, `:4973`, `:5034`, and in `localActivity` at `:5374-5393`. The domain knows nothing of `WaitingGroup`: `grep -rn "WaitingGroup" packages/domain/src` returns **zero** non-test hits. What the domain owns is the *kind* (`quiet.ts`'s `QuietKind`), and `fleet.ts:5078-5082` maps kind → section in the server.

That is not a violation — the server is assertable without a browser, which is what the CLAUDE.md rule actually demands — but it changes the slice's work. **The fix is a server change in `classifyGroup`, guided by an existing domain rule, not a new domain extraction.** A slice briefed to "extract section placement to the domain" would either rewrite `classifyGroup`'s ~700 lines of argued arms or add a second placement authority beside it. Either is far larger than the bug, and the second is the drift shape this repo names repeatedly.

The grouping-key half (line 59) is correct as stated and is genuinely `sections.ts:195-200`'s.

## 4. "It does not hide the rows" is right

The plan asserts this without argument; the argument exists and should be cited. `plot-reconcile-scan.sh:2280` names three actions a person takes with such a branch, and *"the twelve measured here were all landed or superseded"* (`:2281`) — i.e. the rows were actionable, and the action was deletion. That is work, not noise. `packages/domain/src/rules/reapable.ts` and `plot-release-refs.sh` both permit on `unknown` for the mirrored reason: hiding on an absent reading is how a board loses work silently. The sibling plan states the same rule explicitly (`the-board-shows-me-only-my-work.md`, *"It does not guess … A row whose owner cannot be determined is shown, never hidden"*). So: not noise, and the plan's position holds — it just needs the citation.

## 5. Relation to `the-board-shows-me-only-my-work` (#967)

**Complementary, not conflicting, and not duplicating** — but one sentence must be added to keep them so.

- That plan filters WAITING ON YOU **by owner** and explicitly declines the three-way split: *"That is deliberately not in this plan's slices."* It changes *who* is shown.
- This plan changes *which section* a row is in. Different axis.
- The one contact point: #967's filter hides rows with a determinable non-self owner, and a plan-less branch with no PR **has no author to match**. #967 already settles that case — *"A branch with no PR has no author to match. Those should stay visible under any filter"* (issue #967) — so moving these rows INTO WAITING ON YOU does not put them behind that filter. **Say so in the plan**, or a later reader will treat the two as contending for the same section.

Note the estate-shape irony worth recording: #967's complaint is that WAITING ON YOU holds 13 bare plan-less branches, and the correct fix for THIS bug adds more of them to it. That is not a contradiction — it is why #967's split is the right follow-up and this bug's fix is not it.

## What to amend

1. **Close the open question**: destination is WAITING ON YOU, carrying `quietKind`'s existing `abandoned`, with the three citations above as the argument. Delete the three-candidate table or keep it with the two rejections argued.
2. **Correct the layering paragraph**: name `fleet.ts:5033` as the line the fix touches and `quiet.ts:144` as the rule it defers to. Drop the claim that section placement is a domain property today; keep the grouping-key half.
3. **Name the mechanism**: the age gate at `fleet.ts:5033` short-circuits a `wip` branch to `not-started` before the `abandoned` arm at `:5039` can run. A plan-less branch must not take the `not-started` exit, whatever its age — that is a two-condition guard, not a new section.
4. **Add the §19 citation** behind *"It does not hide the rows."*
5. **Add one sentence** on #967's no-author-is-always-shown rule, so the two plans are recorded as non-contending.
6. **Add a Done-when**: the fix must not move a branch whose plan IS approved and whose age is under `quietMinutes` — the regression the age gate exists to prevent (`fleet.ts:5029-5032`, *"an agent may take it"*).
