Position: amend
Evidence: executed

# CONSEQUENCE lens — #1045

I agree with the evidence juror's `amend` and with its central refutation: shape 2 makes an issue-only Must permanently `disputed`, and shape 1's stated flaw does not exist because `PlanDelivery`'s `'no-plan-named'` already separates *names no plan* from *lookup failed*. I re-ran that and confirm it below in one table, then spend the rest on what it did not trace.

**The new consequence: the plan is scoped to the wrong population. Issue-linked items are extinct on this estate — zero, as the evidence juror found. The SAME two readers disagree about FIVE struck-through items right now, the corpus test fails on them at this moment, and one of the five is the operator's withdrawal in this plan's own sprint file, added today.**

## 1. The plan's framing is stale by one working day

The plan says three readers disagree about an item whose first link is an issue. **Measured against the live estate, 2026-09-28, all 16 sprint files, 248 item lines:**

```
2026-W36-a-half-landed-workflow-says-so.md          :: ts="" shell="the-board-watches-instead-of-re-asking"
2026-W36-the-domain-is-one-implementation.md        :: ts="" shell="the-board-suite-fits-its-budget"
2026-W40-plot-observes-and-recovers-its-own-fleet.md:: ts="" shell="the-persisted-pulse-holds-the-bought-answer"
2026-W41-a-declared-agent-costs-what-it-costs.md    :: ts="" shell="a-connector-declares-its-ceiling"
2026-W41-a-declared-agent-costs-what-it-costs.md    :: ts="" shell="a-complete-page-is-not-truncated"

TOTAL ITEM LINES: 248  DISAGREEMENTS: 5
```

**Issue-linked disagreements: 0. Struck-through disagreements: 5.** Every surviving disagreement between the two parsers is the strike-through, not the issue link. The plan writes 95 lines about a population that `f6c7c9ef` emptied and none about the population that is live.

## 2. The corpus test is failing on this machine, right now, and the plan does not mention it

Ran `corpus/sprint-item.corpus.test.ts` with its own config:

```
❯ corpus/sprint-item.corpus.test.ts (4 tests | 1 failed) 56395ms
   × reads the same slug for every item that is not struck through 3ms

AssertionError: expected 5 to be 4 // Object.is equality
 ❯ corpus/sprint-item.corpus.test.ts:268:27
```

`sprint-item.corpus.test.ts:268` is `expect(struckThrough).toBe(4)`, pinned 2026-09-25 with the four lines named in the file's footnote. **My sweep found five.** The fifth is `2026-W40-...:41`, the operator's `~~[the-persisted-pulse-holds-the-bought-answer]~~ — **WITHDRAWN 2026-09-28**`.

**The precise state, which matters for whether this is urgent:**

```
$ git show origin/main:docs/sprints/2026-W40-...md | grep -c '~~\['
0
$ git show HEAD:docs/sprints/2026-W40-...md | grep -n '~~\['
(exit 1 — no match)
$ grep -n '~~\[' docs/sprints/2026-W40-...md
41:- [ ] ~~[the-persisted-pulse-holds-the-bought-answer](...)~~ — **WITHDRAWN 2026-09-28.** …
```

So the strike is **uncommitted in the working tree**. `origin/main` is green. **The next commit of that file turns `corpus` red on every PR**, exactly as `f6c7c9ef` describes for the issue-link case — `ci.yml:94` runs `pnpm --filter @plot-pm/domain run test:corpus` as a required job, and the moderator's question *"a broken sprint file therefore fails every PR"* is answered: yes, and the trigger is already written, just not yet committed.

The evidence juror flagged the `:268` pin as *"a thing the slice will meet"*. It is not waiting for the slice. It is armed.

## 3. The withdrawn-item case is a STATE disagreement, not only a slug one

This is the part the pinned-count framing hides. The corpus test excludes struck-through items **from the slug comparison only**, and reports them as agreeing on `tier` and `checked`. It never compares the scored state. I did:

```
WITHDRAWN STRUCK ITEM:
  shell (reads slug -> plan is Rejected -> 'withdrawn') = withdrawn
  TS    (reads slug ""  -> 'no-plan-named')             = open
```

Confirmed against the live run of `plot-sprint-release.sh`, which scores that W40 line `"delivered":"withdrawn","state":"withdrawn"`, while `itemsFrom`/`parseSprintMembers` capture slug `""` for it, which `openPromises` (`transitions/sprint.ts:328-334`) maps to `'no-plan-named'` → `open`.

**The consequence, and it is the one the release gate cares about.** `workflows/release.ts:178-180`:

```ts
const unfinished = (tier: MoscowTier) =>
  readings.sprintItems.filter(
    (i) => i.tier === tier && i.status !== 'done' && i.status !== 'withdrawn',
  );
```

`withdrawn` is excluded; `open` is not. So **the two readers give opposite answers to the release gate about the same line.** The shell says *this is withdrawn, the release may proceed*; the TypeScript side says *this is an open promise*. Today that item is a Should, so it reaches `openShoulds` rather than `openMusts` and only warns. **Strike a Must and the two readers disagree about whether the release is refused.** `release.ts` already carries the comment for why this matters — *"gating on it blocks a release forever over work nobody is doing"* — and the TypeScript path is the one that does exactly that.

The plan's `Done when` says *"A malformed item is still distinguishable from a legal issue-linked one"*. It says nothing about a **withdrawn** item being distinguishable, and that is the case where the gate actually diverges.

## 4. Answering the moderator's five, with commands

**1. Can an issue-only Must ever be `done`?** Under shape 1 yes, under shape 2 no. Ran `scoreItem` directly:

```
ISSUE-ONLY MUST:
  checked=false shape1=open      shape2=open
  checked=true  shape1=done      shape2=disputed
```

`scoreItem` (`entities/sprint.ts:125-130`): `if (delivered === 'no-plan-named') return item.checked ? 'done' : 'open';`. Under shape 2 the slug `#1039` is looked up, always misses, and a ticked box yields `disputed`, which `release.ts:179` counts as unfinished. **The sprint becomes uncloseable — the plan's feared outcome is a property of its own recommendation.** Same finding as the evidence juror; I reproduce it to confirm rather than to restate.

**2. How many live items change state?** The answer is not 4-of-134. Ran `plot-sprint-release.sh` live: **W40 today has 0 `disputed`, 1 `withdrawn`, the rest `open`/`done`.** Over all 16 files the shell↔TS state disagreements are the 5 struck-through lines above, of which 4 are in Closed sprints and 1 in the live W40. **No live Must changes state under any of the three shapes**, because zero Musts anywhere are issue-only. The risk is entirely forward-looking, which changes the urgency argument the plan makes.

**3. Does the release gate read what the plan thinks?** `plot-release-gate.sh` → `board/plot-release-gate.mjs` → `workflows/release.ts:192-198`. A `disputed` Must **does** gate: `unfinished` excludes only `done` and `withdrawn`, and the refusal even spells `disputed` out — *"checked in the sprint, but the plan is not delivered"*. So yes, and shape 2 walks into it.

**4. Who writes sprint items?** Fewer writers than the plan implies, and one does not exist:

- **`.plot/templates/sprint.md` does not exist.** `ls .plot/templates/` returns `plan.md` alone. The plan's `What this does NOT do` says nothing about the template, and the sibling juror's *"nothing in the template … says so"* is about a file that is absent. **A refusal (shape 3) has nowhere to be prevented from, and no template to teach the shape.**
- **`plot-sprint-state.sh` reads no item shape.** Grepped it: it resolves a slug to a *file*, reads `## Status`, and passes the whole file to `plot-sprint-transition.mjs`. `setSprintState` touches `sprint.items` once, at `transitions/sprint.ts:260`, via `isPromised`, which reads the **tier**. The evidence juror is right that a tenth refusal is a new kind of reading; I add that **it would be the first code in the write path that parses an item's reference at all.**
- **`skills/plot-sprint/SKILL.md:240` is the only written rule**, and it documents exactly two forms: `- [ ] [slug] description` or `- [ ] description`. **It documents neither `[#N](url)` nor `~~[slug]~~`** — grep for `~~` across the skill and the templates returns nothing. So the estate's *live* convention, the strike-through, is as undocumented as the issue link the plan is about.
- **Would W40 pass the new rule?** Under shape 3, **no.** Three Shoulds lead with bold prose and no link at all (`:34-36`) — those pass as bare items. But line 41's `~~[slug](…)~~` leads with a struck link, and a refusal written as *the first link must be a plan* either refuses it or must carve out the strike explicitly. **The plan's rule as stated does not handle it.**

**5. The withdrawn case.** `scoreItem` **does** have a `withdrawn` concept — `PlanDelivery` carries it (`entities/sprint.ts:104`) and it comes from the *plan's* phase being `Rejected`/`Superseded`, not from the strike. **The strike is how a person marks it in the sprint file, and only the shell reads the strike.** So: the concept exists, the shell reaches it, the TypeScript readers cannot, and the plan is silent on all three facts.

## 5. What the plan must add

1. **Re-scope to the live population.** Say that issue-linked items are extinct (0 of 248) and struck-through disagreements are live (5 of 248). Either widen to *both* undocumented forms — which is the honest reading of the title, *a sprint item names a plan or says it has none* — or narrow the title to the issue link and file the strike separately. As written it fixes the dead case and leaves the live one.
2. **Name the `:268` pin as ALREADY FAILING**, not as a thing the slice will meet. `expected 5 to be 4`, in the working tree today.
3. **Add the withdrawn state disagreement to `Done when`.** `withdrawn` vs `open` is a release-gate divergence, and the current criterion only asks about *malformed vs legal issue-linked*.
4. **Correct the template claim.** There is no `.plot/templates/sprint.md`; shape 3 has no template to teach and no write path that parses references.
5. **Reverse or defend the recommendation**, per the evidence juror. I confirm the measurement and do not restate the argument.

## Against my own position

**The strongest case for `proceed`:** the plan explicitly refuses to pick a shape and hands the slice three named options with an instruction to refute the recommendation. A slice that follows that instruction discovers everything above — the gate's scoring, the extinct population, the pin — because the plan sent it to look. Shipping a plan whose deliverable is *"the PR states which shape was chosen and why"* is a legitimate way to defer a decision that genuinely needs code in hand.

**Why I still say amend.** The panel's own trap list names this: *two plans today deferred their hardest question to "the slice checks", and in both cases the deferred question hid a real defect*. This is the third. The deferred question here hides two: the release gate already decided against the recommendation, and the live population is not the one the plan describes. Neither is a judgement call the slice should re-derive — both are commands, and both were cheap. A plan that sends a slice to measure what the author could have measured spends an agent to learn what one `git grep` and one test run already say.

**Where I am weakest.** My five-disagreement sweep transliterates both regexes rather than importing the readers, so it could in principle mis-model the shell's two-stage strip. I checked it against the shell's own live output — `plot-sprint-release.sh` scores the W40 struck item `withdrawn` with slug `the-persisted-pulse-holds-the-bought-answer`, which is what my transliteration predicts — and against the corpus test's independent count, which agrees at 5. Three sources, one number.

**And one thing I did not settle.** I did not determine whether the four Closed-sprint strikes are load-bearing for any released version's gate. They score `withdrawn` on the shell side and `open` on the TS side, but all four sit in Closed sprints, and I did not trace whether a closed sprint's items ever reach `release()`. If they do, four historical releases passed a gate that two readers disagree about.
