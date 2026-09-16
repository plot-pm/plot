# Juror — honesty

Subject: `docs/plans/2026-09-15-a-plan-shows-what-it-cost.md` (Draft)
Lens: **honesty** — does this card tell the truth to someone who spends two seconds on it?

## 1. The factual claims, checked on `origin/main`

| claim | verdict |
|---|---|
| `CardSchema` at `contract/schema.ts:357` | **TRUE as to line, path incomplete.** It is `packages/board/src/contract/schema.ts:357`. There is no `packages/domain/src/contract/schema.ts`; an implementer following the citation literally finds nothing. |
| "already carries **four optional fields** — `sprint`, `story`, `assignee`, `started`" | **FALSE, in the plan's own favour.** `CardSchema` carries **eleven** `.optional()` fields: those four plus `rounds`, `sliceSummary`, `worktrees`, `hasDispatchLog`, `deliverable`, `status`, `notPushed`. The argument ("an optional fifth is understood work") holds a fortiori — it would be a *twelfth* — but this is an unverified count in a plan whose entire subject is number honesty, and it is the second citation defect in three. |
| `PlanCard.tsx` "already renders card-level facts; the component exists and is reached" | **TRUE**, at `packages/board/src/app/components/PlanCard.tsx`. |
| `planStatus` at `board.ts:973` is the precedent, with that docstring | **TRUE.** `packages/board/src/server/board.ts:961-972` carries the quoted text verbatim ("THE READINGS ARE TAKEN HERE, THE DECISION IS NOT… nothing left to get wrong except which pulse it read"). The precedent is real and the quote reproduces. |
| `readSliceSpend`'s no-transcript gate "built 2026-09-15 after its docstring promised a test that did not exist" | **TRUE and now real.** `packages/domain/test/plan-spend-no-transcript.test.ts` is on main, and its own header narrates the phantom the prior panel filed (`:18-31`). The plan is right that it inherits a gate rather than a promise. |
| "cache reads are 99.36% of a naive four-counter total" | **DIRECTIONALLY TRUE, number unreproduced.** On the estate's only live record the share is **98.46%**, not 99.36%. Same conclusion, different number, and the plan quotes it as a measurement. |
| "64 of 68 desks are reaped and hold 92% of all tokens spent" | Reproduced by the prior panel; **not re-measurable now** — `.worktrees/` holds **103** desks today, so the 68 is a snapshot the plan presents without a date qualifier in `## Design`. |

## 2. What a renderer is actually GIVEN

`packages/domain/src/rules/plan-spend.ts` (on main) hands a renderer `PlanSpend`:

- `tokens: TokenCountsRecord | null` — **four keys, no fifth**, null where `measured === 0`
- `measured`, `absent`, `unreadable` — three counts, never two
- `slices: readonly PlanSpendSlice[]` — one entry per branch with its own `state`

**A bare total is unavailable and that is enforced by construction**, not by convention: `tokens` is a four-key object with no sum field, and `planSpend` returns `tokens: null` rather than a zeroed record (`plan-spend.ts:118-120`, *"`reduce(…, 0)` over nothing is correct arithmetic and a lie"*). A renderer wanting one number must compute it, which is the act `plan-spend.ts:34-38` names as producing "a cache-read count wearing a cost's name".

**There is also already a rendering rule the plan never mentions.** `planSpendSummary` (`plan-spend.ts:124-160`) exists on main and composes exactly the sentence this plan describes — counters, `N of M slices measured`, and an em-dashed unmeasured tail; with nothing measured it returns **`not measured here (2 not measured here)`**, never a zero. The plan proposes to render "the counters it is given" and does not say whether it uses this function or re-derives the wording in TSX. Given this repo's own rule that *every rendered state is a domain property*, re-deriving it in `PlanCard.tsx` would put the wording where only a browser can test it, and `Done when` does not pin which side composes the string.

## 3. THE KEY QUESTION — what a two-second reader concludes

I walked the four cases against the actual card. `PlanCard.tsx` already renders up to **eight badges** in one `flex-wrap` row (type, Ready, sprint, story / no story, slice summary, rounds, not pushed) plus a path line and a links row.

**Case A — all slices measured.** The card gains `in 502, out 107182, cache-write 528331, cache-read 40690450`. Four numbers spanning **five orders of magnitude**, the largest 81,000× the smallest. A two-second reader does not read four numbers; they read **the big one**. The rollup refuses a bare total precisely so nobody reads one number — and then hands the viewer a row whose visual mass *is* one number, the cache-read count, the very figure `plan-spend.ts:36` calls "a cache-read count wearing a cost's name". **The refusal is inherited in the data and lost in the render.** The plan's own `Done when` pins that no fifth figure is computed — by a key-set assertion on the Card — which gates the arithmetic and gates nothing about what the eye does with four adjacent integers. This is the honesty failure at the centre of my lens: the plan treats *not summing* as equivalent to *not being read as a sum*, and on a glance-read card they are not the same thing.

**Case B — 3 of 5 measured.** The viewer sees a sum and "2 not measured here". The prior panel established the reader's reasonable inference is wrong: absences correlate with **success**. The plan carries the cold-start correction in `## Design` prose — *"complete going forward, empty backward"* is **not** in the plan; what is there is the 92% figure and the refusal language. Checked: `grep` for `bound|biased|cold start|going forward` over the plan returns the 92% sentence and nothing pinning the bias. **The prior panel's request #2 — that a reader must be told the sum is biased low — is not carried into this plan's `Done when` either.** An implementation rendering `in … out … — 2 not measured here` passes every gate this plan names, and tells a glancing reader that the plan cost the sum shown. On this estate that is the failure mode the whole panel chain exists to prevent.

**Case C — nothing measured.** The plan is **right and this is its best case**: no cost rather than a zero, pinned explicitly. `planSpend` returns `tokens: null` and the card shows nothing. Honest.

But the Open Question ("nothing, or a muted *not measured here*?") is marked **"Does not block"** and it is the single most consequential decision in the plan, because of the measurement below.

**Case D — the bound-killed expensive slice.** Renders identically to a cheap slice that simply ran elsewhere. `absent` covers both. The plan names this in `## Design` and pins nothing. A viewer cannot distinguish *this ran on another machine* from *this was the most expensive run we had and it died before recording*.

### The measurement that decides my verdict

The estate today holds **289 plans** and **one** spend record (`.git/.plot/state/slice-spend.jsonl`, one line, `infra/the-supervisor-log-has-a-ceiling`). So on the board this plan ships to:

- **1 plan renders a cost. 288 render nothing.**

Under the plan's preferred answer to the Open Question (show nothing), the feature is invisible on 99.7% of cards and the one card that shows anything shows a 40-million cache-read figure next to a 502. Under the other answer (a muted note), **288 of 289 cards gain a badge saying "not measured here"** — on a card that already carries eight — and the note is not even true in the sense a reader takes it: it reads as *we looked and found nothing here*, when the actual fact for almost every plan is *this predates the record*.

**And the gap does not close the way the plan implies.** The record is written only by `seal_declaration` in `plot-worker-loop.sh:1010` — a dispatched worker. A branch a person implements by hand, or one merged before the record existed, records nothing **permanently**. That is a second permanent absence beside the bound-kill, and the plan names neither in `Done when`. "Complete going forward" is true only of dispatched work.

**Verdict on honesty:** Case C is honest. Case A is technically accurate and misleads on a glance. Cases B and D are accurate and invite a specific wrong conclusion that this estate has already measured as wrong, with nothing pinning the correction.

## 4. What `Done when` fails to pin

1. **That the reader is told the sum is biased low.** The prior panel asked for this in the dependency's `Done when` and it did not travel here. An implementation showing `measured: 3, absent: 2` with no bias statement passes every listed gate.
2. **Which side composes the wording.** `planSpendSummary` exists and is unmentioned. Pin "the card renders `planSpendSummary`'s sentence" or pin that it does not and why.
3. **Visual weight.** "Shows its four counters, pinned by a browser test" is satisfied by four raw integers. Nothing pins that the cache-read figure is not the most prominent thing on the card — which is exactly the misreading the four-counter rule exists to prevent. A key-set assertion on the Card gates the data and cannot gate the eye.
4. **The Open Question.** Marked non-blocking; it decides the appearance of **288 of 289 cards**. The two answers are not "one line apart" in consequence.
5. **Number formatting.** `40690450` unseparated is unreadable at a glance; nothing pins grouping or unit.
6. **Card density.** Eight badges exist; nothing pins that the cost does not push the row to a third wrap line, or that it is suppressed where uninformative the way `sliceBadgeText` already suppresses "1 slices · 1 branches".
7. **Which plans it renders for.** Nothing scopes it by phase. `roundsBadgeText` is Draft-only by an explicit argument (*"past Discovery the count is history"*); a cost is the mirror case — meaningful on a **finished** plan, noise on a Draft with no branch yet started. Unscoped, a Draft card gets a "not measured here" for work nobody has begun.

## 5. Strongest argument AGAINST doing this at all

**A card that shows nothing on 288 of 289 plans is not a feature; it is a cold-start artefact with a browser test.** The honest thing the board could say about plan cost today is *"we have one measurement"*, and no per-card render says that — each card says only what it individually lacks, so the reader learns the estate's coverage one absence at a time and never learns it at all.

The stronger form: **the sequence's stated purpose is to close a consumer gap, and that purpose is served by a render existing, not by this render being read.** The `consumer` lens asked for the rollup to have a consumer so it stops being dead code. That is a *code-health* motive. It has been carried into a *user-facing* plan without re-asking the question the prior panel flagged and left open: **"none asked whether four counters with no price table answer a question anybody has."** Nobody has re-opened it here either. Rendering four raw token counters on a triage card answers no question a person browsing the board is asking; it costs the densest card in the product a ninth element; and it converts a defensible internal number into a glanceable one whose glance-reading is wrong.

**Waiting is nearly free and materially improves the decision.** With records accumulating, the same plan in two weeks can be written against a measured coverage rate instead of a sample of one, can answer the Open Question with data on how often "nothing measured" actually fires, and can size the badge against real magnitudes. Nothing decays: the rollup is on main, gated, and tested.

## 6. What would make me say proceed

Not a rewrite — the destination is real, the precedent is real, the inherited gate is real, and Case C is right. Four amendments:

1. **Fix the two citations**: the package path, and "four optional fields" → eleven (or drop the count).
2. **Answer the Open Question in the plan**, with the 1-of-289 coverage measured, and scope the render by phase so a Draft card gains nothing.
3. **Carry the bias sentence into `Done when`** — the prior panel's request #2, plus the two permanent absences (bound-kill, hand-implemented branch), pinned as rendered text and not only as design prose.
4. **Pin the glance**: the largest counter must not be the visually dominant element, and the rendered string should be `planSpendSummary`'s or explicitly not, with a reason.

With those, the card tells the truth in two seconds. Without #3 and #4 it tells a reader that a plan cost 40 million of something, and that reader will be wrong about both the number and its completeness.

Verdict: amend
