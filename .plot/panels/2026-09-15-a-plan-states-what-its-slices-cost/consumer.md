# Consumer lens — a-plan-states-what-its-slices-cost

Read at `e98cba7cd` (origin/main, 2026-09-15). Reading position: **a reading nobody reads is dead code with tests.**

---

## 1. Factual claims — verified

Every claim I checked reads TRUE on main.

| Claim | Verdict | Evidence |
|---|---|---|
| `workflows/slice-spend.ts` exports `recordSliceSpend` and `readSliceSpend` | TRUE | `packages/domain/src/workflows/slice-spend.ts:75`, `:107` |
| `SpendReadState` is three-valued `'measured' \| 'absent' \| 'unreadable'` | TRUE, verbatim | `packages/domain/src/rules/slice-spend-record.ts:19` |
| The plan cites it at `rules/slice-spend-record.ts:19` | TRUE — exact line | verified |
| No `planSpend`, no `spendForPlan`, no per-plan sum in `packages/domain/src` or `packages/board/src` | TRUE | `git grep -iE 'planSpend\|spendForPlan\|planCost'` over both trees → 0 code hits (only CHANGELOG prose about GitHub *check* rollups) |
| `readSliceSpend` opens no transcript | TRUE | `slice-spend.ts:107-114` calls only `record.lines()`; the port's `lines()` reads the `.jsonl`. The docstring's claim at `:99-101` matches the body |
| `plot-slice-spend.mjs` bundle and the `plot-worker-loop.sh` write site shipped | TRUE | bundle present (337 KB, 17:59); `plot-worker-loop.sh:1079` `record_slice_spend`, called at `:2148` |
| Four counters kept apart; no summed fifth | TRUE | `spendSummary` (`slice-spend-record.ts`) renders four labelled numbers and no total |
| `plot-plan-meta.sh` reports the plan's branches | TRUE, **with one precision defect** — see §4 |
| The W41 Should was ticked in error and unticked | TRUE | `fdcfa1fb8 plot: untick the W41 rollup Should -- it was never built` |

**One I could not verify, because it is not a claim about main:** the plan's Design says *"Measured on main 2026-09-15"* for the no-sum claim. I reproduced the measurement independently and it holds; I am recording that it holds, not that the plan's measurement was taken the way it says.

---

## 2. What the spend slice actually shipped

Four things, all real:

1. `rules/slice-spend-record.ts` — `readSpend`, `spendSummary`, the three-way `SpendReadState`.
2. `workflows/slice-spend.ts` — `recordSliceSpend` (four named refusals) and `readSliceSpend`.
3. `adapters/slice-spend/slice-spend-file.ts` — the record at the **common git dir**'s `.plot/state/slice-spend.jsonl`, deliberately not the desk, so `plot-reap.sh --force` cannot destroy it.
4. `packages/board/src/server/entry/slice-spend.ts` → `plot-slice-spend.mjs`, with two verbs, `record` and `read`, and the write site at `plot-worker-loop.sh:2148`.

It is a well-built mechanism. That is not in dispute here.

---

## 3. THE KEY QUESTION — who would read this rollup, and can they?

### 3a. The `read` verb it would generalise has **zero callers on main**

`plot-slice-spend.mjs read <branch>` is invoked by nothing. Searched every non-generated tree:

```
git grep -ln 'plot-slice-spend' -- skills scripts packages
  packages/board/build.mjs                       ← builds it
  packages/board/src/contract/bundles.generated.ts  ← lists it
  packages/board/src/server/entry/slice-spend.ts    ← is it
  packages/domain/test/slice-spend-file.test.ts     ← tests it
  skills/plot/scripts/board/board-server.mjs        ← the bundle MANIFEST string, inside minified output
  skills/plot/scripts/board/plot-ask.mjs            ← same manifest string
  skills/plot/scripts/plot-worker-loop.sh           ← calls `record`, never `read`
```

The two `board/*.mjs` hits are the `Dp = [...]` bundle-path array in generated output, not calls. **So the per-slice read — the exact shape this plan proposes to generalise to a plan — already ships with no consumer.** This plan proposes to build a second one.

### 3b. The record file **does not exist on this machine**, twelve hours after the write site merged

```
$ git rev-parse --git-common-dir → .git
$ ls .git/.plot/state/slice-spend.jsonl
ls: No such file or directory

$ node skills/plot/scripts/board/plot-slice-spend.mjs read feature/a-slice-says-what-it-spent
{"outcome":"absent","branch":"...","summary":"not measured here","runs":0}   exit=1
```

Not one record. And the reason is structural rather than bad luck: **of the six free desks on this machine, exactly one carries the write site.**

```
free-2a5e7c4a: 0   free-54251650: 0   free-5eef1bd2: 0
free-85089b5b: 2   free-b2023483: 0   free-ecbaa662: 0
```

Two workers are live right now (pids 3416, 4680, in `free-d10aa93e` and `free-06fff086` — desks since reset). A desk keeps whatever loop it was cut with until it is reaped and re-cut. So the corpus this rollup sums is **empty today and will fill only as desks recycle**, at a rate nobody has measured.

This matters to a consumer specifically: the first implementation of this plan will sum over zero measured slices for every plan in the estate, and the answer will be *no total, N absent* — which is the plan's own correct behaviour, and also indistinguishable from the feature being broken. **There is no fixture-independent way for the implementer, or the operator, to see it working.**

### 3c. Could a per-plan cost reach a board row? Trace of the path

**There is no field, no schema entry, and no render site.** Traced:

- `CardSchema` (`packages/board/src/contract/schema.ts:482`) carries the plan-level facts — `status: PlanStatusSchema.optional()`, `phaseDate`, `deliverable`. No cost, no spend, no tokens.
- `buildBoard` (`packages/board/src/server/board.ts:1680`, `:1931`) is where plan-level facts are derived. It reads no record file.
- `grep -i spend packages/board/src/app` returns **prose comments only** — no reading, no render.

So the work to make a per-plan cost visible is the six-touchpoint board-capability shape this estate already knows: schema field, server derivation in `buildBoard`, the payload, the client cast, the component, and a browser test. **That is a board change with its own plan**, and this plan correctly does not pretend otherwise.

### 3d. The nearest precedent is negative, and the plan does not cite it

`contextSpend` is a reading shipped into the board's schema that renders nowhere:

```
schema.ts:3381      contextSpend: z.number().optional()
registry.ts:222     contextSpend?: number
transcript.ts:52    contextSpend?: number
transcript.ts:221   if (spend !== null) facts.contextSpend = spend
grep -rn contextSpend packages/board/src/app  → 0 hits
```

Produced, typed, carried across the wire, **and read by no component.** The `locality` juror on the sibling panel found the same thing and recorded it (`r2-locality.md`, row 4 of its table). This plan builds one layer above a reading that is *itself* unrendered, and it cites the precedent nowhere.

The rejected sibling's precedent was the `build` RowKind — *"tried, never rendered, and deleted"* (`the-deploy-job-shows-on-main/panel.md:54-56`). `contextSpend` is the same class of evidence for this plan, and it is *milder*: it was never deleted, it just sits there. That is a weaker negative than the sibling's, but it is the right comparison and it is absent.

### 3e. Is there any OTHER caller — skill, script, controller?

**No, and I checked all three.**

- **Skills:** `grep -i 'cost\|spend' skills/plot-deliver/SKILL.md skills/plot-release/SKILL.md` returns only unrelated prose ("spend a correction", "cost the field its adoption"). No skill reads a spend.
- **Scripts:** no `plot-*.sh` calls the `read` verb (§3a).
- **Controller endpoints:** nine exist (`dispatch, approve, deliver, idea, implement, drop, reslice, commission, continue`). None takes or returns a cost. The plan itself states *"It does not gate anything. No delivery, release or dispatch consults a cost"* — which is honest and is also the finding.
- **The sprint queues no consumer.** W41's remaining items are `a-connector-declares-its-ceiling` (rejected) and `a-jenkins-job-is-read-by-its-shape` (done). **This is the last cost item in the window**, and nothing after it reads what it produces.

### 3f. Judging the explicit refusal to require a render site

The plan says *"the board may render it, and this plan does not require that it does."*

**I judge the refusal itself correct, and the silence around it wrong.**

Correct, because: bundling a board render into this plan would mean one plan touching the domain rule, the schema, the server, the client and a browser test — the shape this estate splits into slices on principle. And the sibling was not rejected *for* refusing a render site; it was rejected because its gates could pass while the destination **did not exist and two producers deleted it by name**. That is a different failure. Here the destination exists and is merely unbuilt: `CardSchema` takes optional fields routinely, and adding one is understood work, not an invention.

Wrong, because the plan turns the refusal into a full stop. It does not say **who** would render it, **when**, or **what the next plan is**. Compare what it does do for its own scope — it names the `absent`/`unreadable` split, it names the low bias, it names the four-counter rule. The consumer is the one gap it names and then declines to size. A single sentence — *"the render is `a-plan-shows-what-it-cost`, next sprint, needing one `CardSchema` field and one component"* — would convert this from *a reading with no consumer* into *the first half of a two-slice sequence*, at the cost of one line.

### 3g. Is shipping before a consumer a reasonable order, or the sibling's mistake?

**Reasonable order, on a narrow and checkable argument — and the plan does not make that argument.**

The distinction that saves it: the rejected sibling's gates could all pass while **nothing changed anywhere a reader could look**. This plan's gates are pinned on a domain function's return value, which a unit test asserts directly. The thing built is *complete and correct on its own terms* the day it lands; only its visibility waits. That is the ordinary shape of a domain-first estate, and CLAUDE.md's layering rule positively encourages it — `setSprintState` shipped with nine refusals and zero callers, and the repo treats that as a **defect to report**, not as a reason never to have written it.

But the same CLAUDE.md sentence cuts the other way and the plan should have to answer it: *"Where a rule exists and nothing calls it, that is a defect to report."* This plan proposes to create exactly that condition **deliberately**, and W41's own sprint note quotes the sentence about a different mechanism whose *"adoption is nil"*. Creating a fourth unread reading (`read` verb, `contextSpend`, and now a rollup) in a sprint whose own framing complains about zero adoption deserves a paragraph, and gets none.

---

## 4. What `Done when` fails to pin

The gate list is unusually good — six named properties, each with a fixture, including the key-set assertion against a fifth total. Three gaps:

**4a. "The branches summed are the ones the plan names in `## Slices`" names no reader, and the obvious reading is wrong.** `plot-plan-meta.sh` reports `waves[].branches[]` as **objects**, not strings:

```json
"waves":[{"name":"...","branches":[{"branch":"feature/...","deferred":false,"deferred_reason":"","claimed":""}]}]
```

There is also a flat top-level `"branches":["feature/..."]`. The plan says `waves[].branches[]` and the design paragraph reads as though those are branch names. An implementer taking them as strings gets `[object Object]` and every slice `absent` — **which is a legal answer under every other gate in the list**, since a plan with zero measured slices correctly reports no total. The wrong-key bug and the honest empty-corpus case are the same output.

**4b. Nothing pins what happens to a `deferred:` branch.** `deferred` is right there in the meta output, and a deferred slice was never dispatched, so it was never measured, so it will read `absent` — inflating the absent count with branches nobody ever intended to run. Is a deferred branch summed, skipped, or counted absent? The plan does not say, and all three satisfy every stated gate.

**4c. The bound-path bias is inherited but never surfaced.** `slice-spend.ts:49-56` states it plainly: a worker killed by `Worker bound` never reaches `seal_declaration`, so **the most expensive runs are exactly the ones missing**, and the sum is biased low in a direction the records cannot reveal. The plan repeats this in prose under "Design" and pins **nothing** about it. A rollup reporting `3 measured, 2 absent` where both absences are bound-kills reads as *mostly measured* when it is *missing the whole cost*. At minimum the reading should not be presentable without that caveat travelling with it — and no gate makes it travel.

**The implementation that satisfies every gate and is still wrong:** take `waves[].branches[]` as strings, sum nothing, return `{measured: 0, absent: N}` for every plan. Fixtures pass (they supply their own shapes), the no-fifth-total key assertion passes, the zero-measured gate passes *by construction*, no transcript is opened, `test:contracts` passes. And with the record file empty across the estate (§3b), **the live estate returns the same answer as the bug**, so nothing outside the fixtures would catch it.

---

## 5. The single strongest argument AGAINST doing this at all

**The estate now has three unread spend readings, and this makes a fourth — in the sprint that exists because a previous mechanism's adoption was nil.**

`plot-slice-spend.mjs read` has no caller. `contextSpend` crosses the wire into a schema no component reads. `output_tokens` and `cache_creation_input_tokens` were read nowhere before this week. The rollup would join them: no board field, no skill, no script, no controller, no gate, and no queued consumer in W41 or after it.

W41's own note names this defect class about a different mechanism — *"the mechanism is complete and its adoption is nil… The story's remaining work is not to build the noun again; it is to use it."* **The sprint diagnosed the disease and the last item in it reproduces the disease.** The stronger move for the same effort is to render what already exists — one `CardSchema` field over `readSliceSpend`, per slice, on the branch row where a reader already looks — and let the per-plan sum follow from a surface somebody is reading.

**Why this does not reach reject.** The work is small, the design is sound, the absences are named honestly, and it is a domain function whose correctness a unit test settles — it cannot rot the way an unrendered *render* path can, and a consumer added later needs no change to it. The order is defensible. It is the plan's refusal to *argue* the order, name the consumer, or size the render that makes it amendable rather than approvable as written.

---

## What would change my verdict to proceed

Three edits, none of them design changes:

1. **Name the consumer and the order.** One sentence naming the plan that renders it, what it costs (one `CardSchema` field, one component, one browser test), and when. The plan may still decline to build it; it must stop declining to name it.
2. **Pin the branch-name reading.** Say which field of `plot-plan-meta.sh` is read — `waves[].branches[].branch`, or the flat `branches[]` — and say what a `deferred:` branch does. §4a and §4b are the same class of gap and one line fixes both.
3. **Make the bound-path bias travel with the number.** Add a gate that the reading cannot be rendered or returned without the caveat the sibling's own workflow docstring states. The plan already inherits the `absent`/`unreadable` split as a gate because collapsing it is dishonest; the low bias is dishonest in the same way and is pinned by nothing.

Optional but recommended: cite `contextSpend` as the precedent and say why this is not it. The plan is arguing against a charge that its sibling was rejected under, and it argues the case nowhere.

---

Verdict: amend
