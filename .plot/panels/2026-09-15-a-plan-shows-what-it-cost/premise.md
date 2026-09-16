# Premise lens — a plan shows what it cost

Read on `origin/main` at `dfd585455`. Every line below is a reading; where I did
not verify something I say so.

## 1. The factual claims, one at a time

**`CardSchema` carries optional fields — TRUE, and the number in the plan is WRONG.**
`packages/board/src/contract/schema.ts:357` is `export const CardSchema = z.object({`,
so the cited line is exact. The plan says it "already carries **four optional
fields** — `sprint`, `story`, `assignee`, `started`". Measured over the schema
body: **eleven** optional fields — the four named plus `rounds`, `sliceSummary`,
`worktrees`, `hasDispatchLog`, `deliverable`, `status`, `notPushed`
(`schema.ts:361-364`, and the rest through the object).

This error runs in the plan's own favour and **strengthens** its argument rather
than weakening it: the claim being supported is "an optional fifth is understood
work", and the truth is that an optional *twelfth* is understood work. It is a
stale count, not a false mechanism. It still needs correcting, because this
estate has just rejected two plans for reading a stale statement as a current
fact, and a reviewer checking the number finds it wrong.

**`PlanCard.tsx` exists and renders card-level facts — TRUE.**
`packages/board/src/app/components/PlanCard.tsx`, 19,825 bytes. It renders
optional card facts exactly as the plan implies: `card.sprint` (`:281`),
`card.story` (`:282-311`), `card.sliceSummary` (`:321`), `card.assignee`
(`:421`), `card.rounds` via `roundsBadgeText` (`:144-145`). Each guards on
presence before rendering, which is the pattern a cost field would join.

**And it is REACHED** — this is the check the rejected `the-deploy-job-shows-on-main`
failed, so I ran it rather than assuming. Imported and instantiated at
`Board.tsx:6,253` and `Swimlanes.tsx:6,225`. Not an orphan component.

**`planStatus` at `board.ts:973` is the precedent, and the quote is verbatim — TRUE.**
`packages/board/src/server/board.ts:973` is `export function planStatus(`. Its
docstring reads, exactly as the plan quotes it: *"THE READINGS ARE TAKEN HERE,
THE DECISION IS NOT. `planStatus` in `packages/domain/src/rules/phase.ts` takes
values and returns a status; this runs the two pulse queries it needs and hands
them over. That split is why the rule is testable without a `FleetReading` and
why this function has nothing left to get wrong except which pulse it read."*
The quotation is accurate word for word, and the precedent is real: the function
takes readings and delegates the decision to `decidePlanStatus`.

**`readSliceSpend`'s gate exists — TRUE.**
`packages/domain/test/plan-spend-no-transcript.test.ts:186` — *"opens NO .jsonl
on the filesystem, by any route"* — watches actual `open` calls, and its comment
names itself *"THE HALF THE DELIVERED SLICE WAS MISSING"*. The plan's claim that
this gate was built 2026-09-15 after a docstring promised a test that did not
exist is consistent with what the file says about itself.

**Unverified:** I did not re-run the board suite or `test:contracts`. I checked
existence and content of code, not that the tree is green.

## 2. THE KEY QUESTION — does the plan's description match what shipped?

**It matches. This is the rubric's central question and the answer is yes on every
element.** I read `packages/domain/src/rules/plan-spend.ts` in full.

The plan says the rollup "answers a **measured sum plus two counts** — `absent`
and `unreadable` — and refuses a bare total".

- **The sum plus two counts:** `PlanSpend` (`plan-spend.ts:30-47`) carries
  `tokens`, `measured`, `absent`, `unreadable`, `slices`. The plan's description
  is exact.
- **It refuses a bare total — enforced in code, not documented:**
  `plan-spend.ts:113` returns `tokens: measured === 0 ? null : total`, under the
  comment *"NO TOTAL RATHER THAN A ZERO. `reduce(…, 0)` over nothing is correct
  arithmetic and a lie: it reports a plan nobody measured as a free one."* The
  plan's sentence *"A plan with nothing measured shows no cost at all, never a
  zero"* is this exact rule, inherited correctly.
- **`absent` and `unreadable` stay apart:** `plan-spend.ts:32-36` states
  *"**`absent` AND `unreadable` ARE TWO COUNTS AND NEVER ONE** … collapsing them
  is the failure this repo has shipped twice."* Counted separately at `:99` and
  `:104`.
- **Four counters and no fifth:** `plan-spend.ts:37-41` — *"FOUR KEYS AND NO
  FIFTH … cache reads are 99.36% of a naive four-counter total, so a summed
  fifth field would be a cache-read count wearing a cost's name."* The plan's
  99.36% figure and its no-fifth-figure rule reproduce the shipped docstring.

**The plan describes the shipped shape rather than the anticipated one.** This is
the failure mode the panel was told to hunt for, and it is not present. The
input contract the plan names is the contract that exists.

**One shipped export the plan never mentions: `planSpendSummary`**
(`plan-spend.ts:127`), which already renders the rollup as a sentence for a
person — *"in 2, out 169, cache-write …, cache-read … over 1 of 2 slices
measured — 1 not measured here"*. The plan proposes a render and does not say
whether the card uses this existing string or composes its own. That is a real
gap in the slice description, not a false premise. It is a one-line answer at
implementation time, and I flag it as an amendment rather than a blocker.

## 3. Is the problem real?

**Yes, and it is the cleanest finding here.** Measured on main, every reference
to `planSpend` / `readPlanSpend` / `PlanSpend` outside generated bundles:

- `packages/domain/src/rules/plan-spend.ts` — the definition
- `packages/domain/src/workflows/slice-spend.ts:3,103,116-132` — `readPlanSpend`,
  the workflow wrapper
- `packages/domain/test/plan-spend.test.ts` and
  `packages/domain/test/plan-spend-no-transcript.test.ts` — tests
- `packages/board/src/server/entry/slice-spend.ts` — imports `readSliceSpend`
  (the **per-slice** read), **not** `readPlanSpend`

**Zero production consumers of the rollup. The board never calls `readPlanSpend`.**
The plan's premise sentence — *"the only reader is a test"* — is literally true
for `planSpend`, and the plan's own dependency states the same thing about itself
at `2026-09-15-a-plan-states-what-its-slices-cost.md:136-137`: *"It does not
render. Nothing reads a per-plan cost today, and the per-slice read already ships
with no consumer. The render is a follow-up plan."*

**The dependency is Delivered** (`State: Delivered`, `Delivered: 2026-09-15`), so
the sequencing note in `## Notes` is satisfied and the branch is dispatchable.

The destination is also reachable: `buildBoard` is `async`
(`board.ts:1727`), and cards are assembled at `board.ts:1935-2036` where
`board.ts:1973` already does `if (meta.rounds !== undefined) card.rounds = meta.rounds`
— the exact optional-field pattern a cost field would copy. **Unlike the rejected
`the-deploy-job-shows-on-main`, the verb this plan needs can reach its
destination.**

## 4. What `Done when` fails to pin — the strongest finding

**An implementation can satisfy every stated gate and read the record 289 times
per board build.**

The plan's gate is: *"the cost is read once per board build and no render path
opens a record file, pinned the way `readSliceSpend`'s own gate is — a counting
stub asserting zero calls."*

The gate it names as its model pins something narrower than the sentence:

```
packages/domain/test/plan-spend-no-transcript.test.ts:165
  it('reads the record ONCE, not once per slice', …)
  await readPlanSpend(counting, ['feature/a','feature/b','feature/c']);
  expect(reads).toBe(1);
```

That asserts one read **per `readPlanSpend` call**. It says nothing about calls
per board build. And `readPlanSpend` (`slice-spend.ts:127-132`) opens with
`await record.lines()`, which in `slice-spend-file.ts:201-206` is an unconditional
`await readFile(path, 'utf8')` — **no caching, no memoisation**.

So the natural implementation — call `readPlanSpend(sliceSpendFile({cwd}), branches)`
once per card, beside `planStatus`, exactly as the plan's slice line instructs —
performs **one full file read per plan**. Measured: `ls docs/plans/*.md | wc -l`
= **289**. That is 289 `readFile` calls per board build, on a 5-second refresh
cadence.

The inherited gate passes on all 289, because each individual call read the file
once. **"Read once per board build" is stated in prose and pinned by nothing.**

This is precisely the rubric's question 4 shape: every stated gate green, the
implementation wrong. The fix is one sentence — read the record **once outside
the card loop** and pass `lines` to the pure `planSpend`, which takes
`lines: readonly string[] | null` as its first argument (`plan-spend.ts:82-85`)
and is built for exactly this. The rollup's own docstring already anticipates
it: *"THE RECORD IS READ ONCE, NOT ONCE PER SLICE. One file holds every branch
the machine has measured."* The same argument scales to plans and the plan does
not make it.

**Two smaller gaps:**

- **The no-fifth-figure gate is pinned on the Card and not the DOM.** The plan
  says *"no fifth summed figure is rendered, pinned by a key-set assertion on the
  Card rather than by reading the DOM"*. A key-set assertion on the payload
  cannot see a component that renders `in + out + cacheWrite + cacheRead` in
  JSX. The payload stays four-keyed and the card shows a fifth number. Given
  that "cache reads are 99.36% of a naive total" is the plan's own headline
  reason for the rule, the gate should read the rendered output, not only the
  schema.
- **`planSpendSummary` already exists and the slice does not say whether to use
  it** (see §2).

## 5. The strongest argument against doing this at all

**The board has nine `<Badge>` render sites on a card already
(`PlanCard.tsx`), and this adds a tenth carrying four numbers plus two counts.**
The card is the densest surface on the board, and this repo's own CLAUDE.md
records `rounds` being kept off agent rows specifically as *"the crowding this
board keeps removing"*. A four-counter cost with two unmeasured counts is the
largest single fact yet proposed for that surface, and the plan's Open Question
about blank-versus-muted-note concedes the layout is unsettled.

**But it does not defeat the plan**, for a reason I can measure. The record on
this machine holds **one** branch:

```
.git/.plot/state/slice-spend.jsonl — 258 bytes, 1 line
infra/the-supervisor-log-has-a-ceiling
```

That branch is named by `docs/plans/2026-09-15-the-supervisor-log-has-a-ceiling.md`.
So of 289 plans, **exactly one** would render a cost today and 288 would render
nothing — the no-zero rule guarantees it. The crowding argument is real in the
limit and near-empty now, which makes this the right time to land the render and
learn the layout from live data rather than argue it in advance.

**The more honest version of the objection** is that a cost nobody can act on is
decoration — the plan itself concedes *"It does not decide anything. No gate, no
delivery check, no dispatch input reads a cost. It is shown."* Against that: the
story's stated objective is *"Plot could already source the number and never
stated it"*, and a number computed for nobody is the defect this sequence exists
to close. Shipping the render is what stops the rollup becoming a third
consumerless layer.

## Verdict rationale

The premise holds. The dependency shipped and shipped in the shape the plan
describes; the destination exists, is reached, and already carries eleven
optional fields and five card-level renders; the precedent quote is verbatim; and
the problem is real and measured — zero production consumers of `planSpend`.
This is **not** the error class that sank the two rejected siblings: no stale
comment read as current fact, no assertion never run, no missing consumer.

Three defects are worth fixing before implementation, and all three are text
changes to the plan rather than reasons to stop:

1. **"four optional fields" is eleven** — correct the count.
2. **"read once per board build" is pinned by nothing**, and the gate the plan
   names as its model pins one read per *call*; the obvious implementation reads
   the file 289 times per build and passes. Pin the per-build count, and name the
   shape — read `lines` once outside the card loop, pass to pure `planSpend`.
3. **Say whether the card uses the shipped `planSpendSummary` or composes its
   own**, and move the no-fifth-figure gate onto the rendered output.

Verdict: amend
