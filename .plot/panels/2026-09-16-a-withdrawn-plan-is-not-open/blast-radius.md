# Blast radius — a-withdrawn-plan-is-not-open

Position: amend

## 1. Is the problem real, and is it stated correctly?

**Real. The headline number is correct; the prose around it is not.**

Phases on the estate:

```
$ grep -rhoiE '^\s*-?\s*\*\*State:\*\*\s*\w+' docs/plans/*.md | sed -E 's/.*\*\*\s*//' | tr 'A-Z' 'a-z' | sort | uniq -c
 264 released
  11 delivered
   8 rejected
   3 superseded
   1 draft
```

8 rejected + 3 superseded = **11 withdrawn**, exactly as the plan says. `fe39198ef` exists and did move the three non-plans to `docs/notes/`.

Live estate counter, re-derived rather than taken from the plan:

```
$ node skills/plot/scripts/board/plot-ask.mjs fleet | jq .estateTotals
{"total":288,"open":12,"wip":0,"done":276}
```

**12, not 11 and not 14.** The twelfth is this plan itself (`State: Draft`, the only Draft on the estate). So the plan's *"the estate count falls from 11 open to 0"* is wrong in its own `Done when`: after this change the correct count is **1** — this plan, which is genuinely open. A gate asserting 0 will fail, or will be "made to pass" by counting this plan wrongly.

**The stated mechanism is half wrong.** The plan says the eleven read as `open`. Only ONE does:

```
$ for f in $(grep -rliE 'State:\*\*\s*(rejected|superseded)' docs/plans/*.md); do echo "$(basename $f) :: $(grep -m1 -iE 'Review:\*\*' $f | sed -E 's/.*Review:\*\*\s*//')"; done
2026-08-31-the-board-answers-while-it-scans.md :: review=pr     ← 'open'
…the other ten ::                                 review=in-session ← 'draft'
```

`planStatus`'s `default:` arm is `readings.review === 'pr' ? 'open' : 'draft'`. Ten withdrawn plans report **`draft`**, one reports `open`. Both land in the `open` BUCKET, which is why the counter says 12 — but the plan's title, changelog and Design section all describe a `status: open` that ten of eleven plans do not have. The bug is in the *bucket*, reached through two different wrong statuses.

## 2. Right fix, or a symptom fix?

**Right fix, and the layering is right** — the rule is in `packages/domain/src/rules/phase.ts:140`, one function, and both counters read it through `planStatusBySlug`. Adding the case where `phaseOfPlanState` already refuses to guess is consistent with the file's own stated rule.

But it is **incompletely scoped**, see Q5.

## 3. Does `Done when` contain a gate immune to plumb-through?

**Yes — one, and the plan names it as such.** *"the estate count on this repository falls from 11 open to 0, asserted as a number"* cannot be satisfied by adding an enum member and never reading it: `estateTotals`'s `default: continue` would leave the count at 12. The plan explicitly says why it chose a number.

**But that gate is mis-stated and will fail as written** (Q1): the true post-change number is 1, not 0. And `total` must also fall from 288 to 277 unless a fifth bucket is added — the plan's second gate (*"`total` still equals the sum of its buckets with the new one included"*) presumes a new bucket that no schema field exists for. See Q5.

## 4. Claims I could not verify, or found false

| plan's claim | finding |
|---|---|
| *"the board reports `14 open` and the correct answer is 0"* | **False as stated.** Measured now: **12**. Correct answer after the fix: **1** (this plan is a real Draft). |
| *"the eleven … report as `open`"* | **False.** One reports `open`; ten report `draft`. |
| *"Four files name `PlanStatus`"* | **Undercounts.** `grep -rn PlanStatus packages/` → `rules/phase.ts`, `contract/schema.ts`, `server/board.ts`, `server/fleet.ts` **plus `packages/board/test/unit/plan-status.test.ts`**. There are **TWO enum declarations** (`phase.ts:25` and `schema.ts:352`), deliberately duplicated — `schema.ts` says so — so both must be edited, and the plan's slice line names only "PlanStatusSchema", singular. |
| *"no `Record<PlanStatus, …>` anywhere, so no exhaustive map turns a new member into a compile error"* | **Verified true**, and this is a liability the plan reports as a comfort: **nothing fails to compile**, so every miss is silent. |
| *"Exactly one consumer compares a status value: `board.ts:1978`, `status === 'deliverable'`"* | **False.** There are **two `switch` statements over `PlanStatus`**, not one comparison: `fleet.ts:6808` (`activeSprints`) and `fleet.ts:6877` (`estateTotals`). Both end in `default: continue`, which drops the member from `total` as well as from every bucket. The plan names `estateTotals` and never names `activeSprints`. |
| *"every plan card whose plan is withdrawn gains a status nothing rendered before"* (Board impact comment) | **False.** `board.ts:1956-1957`: `const mapped = toBoardPhase(meta.phase, started); if (!mapped) continue;` — `toBoardPhase` returns `null` for `rejected`/`superseded` (`phase.ts:53`), so a withdrawn plan **never becomes a Card**. No card gains anything. The status map (`planStatusBySlug`, `board.ts:2270`) has no such filter, which is exactly why the COUNTER sees these plans and the BOARD does not. |
| *"The board's COLUMNS are `Phase`, not `PlanStatus`. This plan does not move a card between columns"* | **True**, and stronger than stated — there is no card at all. |
| *"It does not change the sprint scorer"* | **True of `scoreItem`; false of the sprint COUNTER.** See Q5. |
| `a-withdrawn-item-is-not-open` shipped v2.15.0 with `done·open·disputed·withdrawn` | **Verified**: `entities/sprint.ts:43` `ItemStatusSchema = z.enum(['done','open','disputed','withdrawn'])`; `:126` `if (delivered === 'withdrawn') return 'withdrawn'`. |

## 5. What the blast-radius lens sees that the plan missed

**(a) The second switch. `activeSprints` shares the bucket rule and the plan never names it.**

`fleet.ts:6808` and `fleet.ts:6877` are two hand-copied `switch (status)` blocks with the same arms and the same `default: continue`. The plan's slice says *"count it outside `open`/`wip`/`done` in `estateTotals`"* — singular. Editing one leaves the two disagreeing about what a bucket means, which is the exact property `SprintFilter.tsx:34` documents as invariant: *"Estate totals and sprint numbers use the SAME bucket derivation, so they cannot disagree about what a bucket means."*

This is not hypothetical. **Five withdrawn plans name the currently-Active sprint:**

```
a-complete-page-is-not-truncated      :: sprint=a-declared-agent-costs-what-it-costs
a-connector-declares-its-ceiling      :: …
the-tight-band-remembers-what-it-started :: …
the-board-asks-the-build-resolver     :: …
the-deploy-job-shows-on-main          :: …
```

They do not currently reach the counter only because the sprint file wraps their links in `~~strikethrough~~`, so `parseSprintMembers` does not extract the slug:

```
$ node skills/plot/scripts/board/plot-ask.mjs fleet | jq '.sprints[0].counts'
{"total":11,"open":0,"wip":0,"done":11}    # 11 members, none of the five
```

That is an accident of markdown, not a guard. Any sprint that lists a rejected member without strikethrough routes `withdrawn` straight into `activeSprints`'s `default: continue`, and the sprint's `total` silently shrinks.

**(b) `total = open + wip + done` is a documented invariant with no fourth bucket to hold `withdrawn`.**

`SprintCountsSchema` (`schema.ts:3575`) is exactly `{total, open, wip, done}`, and its docstring says *"Every member lands in exactly one bucket, so `total = open + wip + done`"* and *"the arithmetic fails visibly when a member falls through."* The plan's `Done when` promises *"`total` still equals the sum of its buckets with the new one included"* — but adding a bucket means:

- a new field on `SprintCountsSchema` (a Zod schema the client **casts** rather than parses, so an older bundle reading a new field is fine, but a new bundle reading an older payload gets `undefined`, not the `.default(0)`),
- a new term in `SprintFilter.tsx:65` `formatCounts`, which hardcodes `` `${total} plans · ${open} open · ${wip} WIP · ${done} done` ``,
- and a decision the plan explicitly declines to make (*"It does not decide what a withdrawn card looks like"*) — but this one is not a card question, it is an arithmetic question the schema's own invariant forces.

The alternative — drop withdrawn from `total` entirely — is simpler and probably right (288 → 277), but it is a **different** answer from what `Done when` promises, and the plan does not choose between them.

**(c) What a pre-change client does with the new value — the good news.**

- **The client casts, it does not parse.** `App.tsx:241` `(await res.json()) as Board`, `:281` `as Fleet`. No Zod runs client-side, so `withdrawn` arriving at an old bundle is never *rejected*; it is simply carried.
- **No version skew is possible in practice.** Client and server are one artifact (`skills/plot/scripts/board/board-server.mjs`, 1.1 MB, built together by `pnpm build:board`). There is no separately-deployed client that could be older than the server.
- **`FleetSchema.parse` runs in exactly one place** — `mock-fleet.ts:424` — and only for mock data. No production path parses the payload, so the new member cannot cause a runtime parse failure.
- **No persisted or cached payload carries a status.** The fleet cache is in-memory (`ensureCache`, `fleet.ts`); nothing writes a board or fleet payload to disk. A status is *"DERIVED EVERY SCAN and STORED NOWHERE"* (`schema.ts:320`), and I found no writer contradicting that.

**So the client-side blast radius is genuinely small** — smaller than a reader might fear. The damage is all server-side arithmetic.

**(d) An existing test asserts the enum is exactly seven, by name.**

```
packages/board/test/unit/plan-status.test.ts:226
describe('PlanStatusSchema — the enum is exactly the seven', () => {
  it('parses each of the seven and rejects an eighth', () => { … })
```

This test must be rewritten, and the plan's `Done when` does not mention it. It is the closest thing to a gate the estate has here — and rewriting it is the one move that makes the *shape* of this change visible in the diff. The `Done when` should name it rather than let it surface as a red test somebody edits reflexively.

**(e) `statusTone` is keyed on the word and will silently return `''`.**

`tuple-row.ts:344` matches `/^(conflicts|checks failing|failed|stalled)/` and `/^(green|delivered|finished|start work|eligible)/`. `withdrawn` matches neither, so it renders in the ordinary tone. That is arguably correct, and no change is needed — but it is a consumer the plan does not enumerate, and its correctness here is luck rather than design.

**(f) The `deliverable` controller is untouched — verified.**

`entry/ask.ts:46` `Question = 'board'|'fleet'|'deliverable'` is a question NAME, not a status: `deliverabilityOf` is a separate rule reading ports. `board.ts:1978`'s `status === 'deliverable'` is unaffected by adding a member. The plan's claim here holds.

## Amendments required

1. Fix the measurement: the counter reads **12**, ten of the eleven report `draft` not `open`, and the post-change answer is **1**, not 0.
2. Name `activeSprints` (`fleet.ts:6808`) alongside `estateTotals` — two switches, not one.
3. Decide the arithmetic: a fourth `SprintCounts` field (with `formatCounts` and the schema invariant following it), or excluding `withdrawn` from `total`. `Done when` currently promises the first and describes the second.
4. Name `plan-status.test.ts:226` — *"the enum is exactly the seven"* — as a test this change rewrites.
5. Name **both** enum declarations (`phase.ts:25` and `schema.ts:352`).
