# Remedy lens — 2026-09-16-a-plan-has-one-phase (#924)

The question for this lens: does the proposed change fix the failure the reporter filed, or is it a well-shaped change to an adjacent thing? Judged by what the reporter experiences after it ships.

## 1. Are the factual claims true on main?

Every one I checked is true, and two are more precisely true than the plan states.

**Parser precedence — TRUE.** `plot-plan-meta.sh:443` `if (fm_status != "" || fm_phase != "")` sets `fmt = "frontmatter"`; the `## Status` block is reached only at the `else if` on `:448`. The plan's line numbers (`:443-446`, `:448`) are correct against main; the ticket's (`:432-435`, `:437`) are stale by 11 lines. The plan re-verified rather than copying — good.

**Three writers, all guarded on `section == "status"` — TRUE.** `plot-deliver.sh:275`, `plot-approve.sh:376`, `plot-undeliver.sh:123`, `:131`, `:155`. The plan says "three occurrences" for undeliver; there are three, though one (`:131`) writes `Rejected:` rather than the state. Immaterial.

**`phase_alt` already in the contract and emitted — TRUE.** Contract at `:98-101`, emitted at `:549`. The within-format reporting rule and its comment are at `:448-451`, quoted accurately.

**The estate measurement — TRUE, and the plan's number is off by one in its own favour.** Measured now: 290 files in `docs/plans/`, **0** carrying front matter, **286** carrying a `## Status` `State:` line. The plan says 285 twice (`Done when`, table); the ticket says 286. Four files carry no state field and are not plans, consistent with the scan's own rule. The 285/286 discrepancy is trivial arithmetic, but `Done when` pins a byte-identical diff over "all 285 plans" — a count that will not match the directory. Cosmetic, but it is the gate's own number.

**Unverified:** the project-repo figures (74 both / 19 fm-only / 1 Status-only). Not reachable from here. They are the ticket's, plausibly recorded, and nothing in my verdict depends on them.

## 2. Does the description of the mechanism match reality?

Yes, and the plan's framing — *"three writers, one reader, and the writers agree, so this is a contract question"* — is the correct diagnosis. I confirmed the writers genuinely agree rather than merely appearing to.

One live consumer the plan does not mention, and it matters for §3: **`plot-reconcile-scan.sh:744` already acts on `phase_alt`**:

```
if [ -n "$alt_raw" ] && [ "$alt" != NONE ] && [ "$alt" != "$st" ]; then
  attention_out+="  $base — status: '$raw_phase' disagrees with phase: '$alt_raw' ..."
  n_att=$((n_att + 1))
```

That lands in `attention=`, which is **section 5 — inside the blocking set (1–6)** per CLAUDE.md, and `/plot-deliver` SKILL.md:526 pastes the `attention=` footer as its delivery-landed gate. So `phase_alt` is not an inert field awaiting a consumer: it already feeds a gating counter. The plan understates its own reach, which is an argument *for* it that it does not make.

## 3. THE KEY QUESTION — is reporting a fix for what was filed?

**Partly, and more than the plan claims — but it does not close the filed defect, and the plan's own fixture is wrong about the failing case.**

### 3a. The fixture in `Done when` does not describe the reporter's bug

`Done when` pins *"front matter `status: Approved` and a Status block `State: Delivered`"*. I built exactly that and parsed it on main:

```
--- fm: status: Approved + phase: Approved ; Status block: State: Delivered
{"format":"frontmatter","phase_raw":"Approved","phase":"approved",
 "phase_alt_raw":"Approved","phase_alt":"approved","delivered_raw":"2026-09-16"}
```

`phase_alt_raw` is **already populated — with `"Approved"`**, the front matter's second field. The reporter's plan carried *both* `status:` and `phase:` (ticket, verbatim), so the within-format rule at `:446` has already claimed the `phase_alt` slot. The Status block's `Delivered` is nowhere in the output and the two reported values **agree**, so scan line `:744`'s `[ "$alt" != "$st" ]` is false and it reports nothing.

The plan asserts *"today the second value is dropped"*. For the reporter's actual file, the second value is not dropped — it is **occupied by the wrong pair**. That is a harder problem than the plan describes, and `Done when` as written could be satisfied by a fixture that never reproduces the filed case.

With only `status:` in front matter it is genuinely empty:

```
--- fm: status: Approved only ; Status block: State: Delivered
{"phase_raw":"Approved","phase_alt_raw":"","phase_alt":"NONE"}
```

So there are **two shapes**, not one: the slot free, and the slot taken. The reporter is in the second. A one-slot `phase_alt` cannot carry both a within-format and a cross-format disagreement, and the plan never confronts that — it assumes the slot is available because that is true of the 19 fm-only plans and false of the 74 that are the actual bug. **This is a premise defect inside the deliverable, not merely a scoping choice**, and it is the strongest single reason this plan cannot ship as written.

### 3b. What changes for the reporter, assuming 3a is fixed

Their delivery **still silently fails.** Trace it on main:

- `plot-deliver.sh:105` `phase=$(jfield '.phase')` → `approved` → refusal 1 passes.
- `decide_transition` (`:380-408`) re-parses the file and hands the domain `.phase` → again `approved`, so the domain answers `write`, never `already`.
- `write_transition` → `flip_phase` edits the Status block, finds nothing matching `approved` (already `Delivered`), `changed` unset → `flipped=0` → **`phase_report="already"`**.

So the second run reports `phase=already` exactly as the ticket says, and — the part the ticket did not spell out — for a reason the plan's change does not touch: the gate reads the parser while the write reads the file, and the parser's answer can never move because nothing writes front matter. **Emitting `phase_alt` changes none of these three lines.** The delivery prints a success summary, the parser still answers `approved`, and the plan is still half-landed.

What genuinely improves: the **next** `/plot-reconcile` reports the plan under `attention=` via `:744` and increments `n_att`, and since `attention=` is in the blocking set, `/plot-deliver`'s own step-7b gate would refuse to certify a clean landing. That is real — detection where there was none, through a consumer that already exists. It is the difference between a failure nobody can see and one the sweep names.

**But it is detection, not repair.** The reporter's two complaints were (a) the delivery silently fails and (b) *a re-run cannot repair it*. This plan addresses neither directly: (a) becomes "fails, and a later separate sweep may notice", and (b) is untouched — the repair path is still the failure path, and they still reach for `plot-state-receipt.sh --unowned`, the escape hatch whose routine use the ticket explicitly calls out as wrong.

### 3c. Is "the prerequisite for either" sufficient?

**As a deliverable, no.** The Open Question defers the decision and argues the report is the prerequisite — correct as far as it goes. But nothing in this plan, this sprint, or the estate commits anyone to the second half. Shipped alone it satisfies its gates while the filed defect persists unchanged, and the ticket is closeable against it by anyone reading only the `Done when`. This is the exact shape my lens exists to catch.

The narrow scope is defensible *engineering* — a contract change and a behaviour change in one branch is the thing this repo rightly refuses. The failure is **not filing the second half**. A slice-2 stub, or a `waits:` annotation, or even a named follow-up ticket would convert this from "adjacent change" to "first half of a fix". As written, the plan's own closing sentence — *"the fix is in the parser"* — is the overclaim: the parser change is a prerequisite to a fix, and the plan elsewhere admits as much.

## 4. The alternatives

**Make the writers write both.** *Better on remedy, worse on the estate's own rule.* It fixes the reporter completely and immediately: front matter moves, the parser's answer moves, the delivery lands, idempotence is restored. The plan rejects it as "two records of one fact" that the reconcile scan counts as drift — a principled objection I accept in general. But the two records **already exist** in that repo and are not going away; refusing to write the second does not remove it, it only guarantees the two stay divergent. The estate rule argues against *creating* duplication, not against maintaining a duplicate the user's format already mandates. This is the strongest rejected alternative and the plan's dismissal of it is the weakest paragraph in the document.

**Make the parser prefer the Status block.** *Best remedy, highest blast radius.* It makes all four components agree at a stroke and needs no new field. It would silently reinterpret the 19 fm-only plans in that repo and any other adopter's, with no migration and no warning — a correctness change riding in a patch. The plan is right to refuse it, and right that precedence is not the question.

**Make the writers refuse a dual-format plan.** *Not considered by the plan, and it is the best fit for this estate's stated philosophy.* It converts a silent half-write into a loud stop naming the ambiguity — "gates over rules", and a refusal is exactly what the writers already do for a non-Approved plan or a bad `Review:`. The reporter loses nothing they have (the delivery does not work today) and gains an unmissable diagnostic at the one moment they are looking. It needs the parser change or an independent read to detect the condition, so it composes with this plan rather than competing. **Its omission is the notable gap in the alternatives section.**

**Make `/plot-deliver` verify its own write by re-reading through the parser.** *The most direct fix for the filed complaint, and cheap.* After the `mv`, re-parse and assert `.phase == delivered`; refuse and report if not. It fixes idempotence — a second run now sees the mismatch instead of reporting `already` — and it is format-agnostic, catching any future writer/reader split rather than this one instance. Per CLAUDE.md it is a *gate* where this plan is a *rule*: the plan makes a value available for someone to check; this makes the script unable to claim success it did not achieve. The plan does not mention it. Given the repo's own "can you answer 'did I complete this' without doing the work?" test, a delivery that reports `phase=flipped` without re-reading fails that test, and this alternative is the one that fixes it.

## 5. What `Done when` fails to pin

- **The reporter's actual case.** Per §3a, its fixture (`status:` + `phase:` + Status block) already emits a populated, self-agreeing `phase_alt`. The fixture as specified can pass without the bug being reproduced.
- **The slot collision.** Nothing says what `phase_alt` holds when both a within-format and a cross-format disagreement exist. One field, two claims, no stated precedence — an implementer will invent one and the review will not know which was intended.
- **`format`.** A dual-format plan reports `format: "frontmatter"`, which is now a half-truth. Whether it stays, changes, or gains a value is unpinned; `plan-store.corpus.test.ts` and `docs/board-entity-properties.md` both read the field.
- **The consumer at `plot-reconcile-scan.sh:744`.** Its message hardcodes *"status: X disagrees with phase: Y"* — wrong wording for a cross-format pair, and it feeds the gating `attention=` counter. Pinning "the parser emits it" while leaving the one live reader unexamined means the user-visible half is untested.
- **The count.** "all 285 plans" against a measured 286.
- **Who acts on the report.** No test, no counter, no gate is required to consume the new value, so the slice can be green with the field emitted and nothing anywhere reading it.

## 6. Strongest argument against doing this at all

**It buys detection the estate cannot exercise, at the cost of closing the ticket.** Zero of 290 plans here carry front matter, so every assertion runs against synthetic fixtures and no regression can ever be caught by the real corpus — the plan says so itself. Meanwhile the delivery that prompted the ticket keeps failing, because the three lines that make it fail (`:105`, `decide_transition`, `flip_phase`'s `flipped=0`) are untouched. A reporter reading the changelog entry — *"A plan carrying both ... no longer reports a phase nobody wrote"* — will reasonably conclude their delivery is fixed. It is not. **The change is a genuine improvement to the parser's contract and a poor answer to #924**, and shipping it under #924's number is how the defect gets marked resolved while persisting.

The counter-argument, which nearly carries: `attention=` is in the blocking set, so the report is not inert, and a contract change and a behaviour change genuinely should not ride one branch. That is sound — it argues for **sequencing**, not for stopping at half. Fixing 3a and committing to the second half converts this into the right first slice.

## Recommendation

Amend, not reject. The diagnosis is correct, the scope discipline is right, and the change is worth making. Three things must change before it ships:

1. **Fix the fixture and the slot question.** The reporter's plan carries `status:` *and* `phase:`, so `phase_alt` is already occupied. Pin both shapes and state what happens when two disagreements compete for one field.
2. **Name the second half in the plan.** A slice 2, a `waits:` line, or a filed ticket for the writer-side gate or the deliver-side self-verification. Without it, #924 closes on a plan that leaves the delivery broken.
3. **Cover the live consumer.** `plot-reconcile-scan.sh:744` already reads `phase_alt` into the gating `attention=` counter with a within-format-only message. Pin its behaviour and fix its wording, or the user-visible half of this change is untested.

Worth adding to the alternatives: a writer-side refusal on a dual-format plan, and a `/plot-deliver` post-write re-read. Both are gates where this plan is a rule, and either would fix what was filed.

Verdict: amend
