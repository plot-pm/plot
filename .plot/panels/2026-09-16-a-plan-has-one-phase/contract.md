# Contract lens — a plan has one phase (#924)

Read on `origin/main` @ `1a8943119`. Every claim below re-measured today.

## 1. Are the factual claims true on main?

**Every one I checked is true.** This plan is not a false-premise plan.

- **Front-matter precedence** — `skills/plot/scripts/plot-plan-meta.sh:442-446`. `if (fm_status != "" || fm_phase != "")` sets `fmt = "frontmatter"`, and the `## Status` block is read only in the `else if` at `:448`. Verified verbatim.
- **`palt_raw` is within-format only** — `:446` sets it from `fm_phase` only when `fm_status` is also set; `:452` from `canon_phase` only when `canon_state` is also set. A cross-format pair produces `palt_raw = ""`. Verified.
- **The three writers guard on `section == "status"`** — `plot-deliver.sh:275`, `plot-approve.sh:376`, `plot-undeliver.sh:123,131,155`. All five occurrences are `## Status`-scoped; none touches front matter. The plan says "three occurrences" for `plot-undeliver.sh` — correct.
- **`phase_alt_raw`/`phase_alt` exist and are emitted** — declared in the contract header at `:98-101`, emitted at `:550`, and present in the file-not-found record at `:288`.
- **The defect reproduces.** A file with front-matter `status: Approved` and a `## Status` `State: Delivered`:

  ```
  {"format":"frontmatter","phase_raw":"Approved","phase":"approved",
   "phase_alt_raw":"","phase_alt":"NONE"}
  ```

  The `Delivered` the writer would have set is dropped and nothing records that a second value existed.
- **The estate measurement** — 289 plan files, **0** with front matter, **287** with a `## Status` block. The plan says 285; the count has moved by two files since it was written and the shape of the claim holds.
- **The idempotency inversion** is real: `plot-deliver.sh`'s flip reads the Status block it wrote, finds `Delivered`, and reports `phase=already`.

**Nothing unverified.** The only claim I cannot check is the project repo's 74/1 split, which is external by construction and does not carry the argument.

## 2. Does the description of `phase_alt` match what it does?

**Yes, and precisely.** The plan quotes `:448-451`'s own comment and the quote is exact. It correctly identifies `phase_alt` as a *within-format* disagreement report and correctly states that the cross-format pair is the same shape one level up, unreported. `test/reconcile/parser.test.mjs:48-52` pins the existing behaviour with `frontmatter-disagreement.md` → `phase_alt_raw: 'Triage'`. The plan's reading of the mechanism is accurate.

## 3. THE KEY QUESTION — enumerate the consumers of `phase_alt`

I traced every executable caller of `plot-plan-meta.sh` (54 non-markdown files) and every reference to the field name.

| consumer | reaches the field? | what it does with it |
|---|---|---|
| `plot-reconcile-scan.sh:563` | **extracts both into columns 4 and 5** of its `plan_rows` | **nothing.** `grep -n '\$4\|\$5\|palt\|phase_alt'` over the whole script returns exactly three hits: the header comment `:542`, a parenthetical `:545`, and the `jq` at `:563`. No section reads column 4 or 5. Sections 1, 2, 4, 5 and 9 read `$1`, `$2`, `$6`, `$7`, `$8`, `$9`. |
| `plot-deliver.sh` | reads `.phase`, `.review`, `.approved_raw`, `.delivered_raw`, `.released_raw` (`:105`, `:388-392`) | never asks for `phase_alt` |
| `plot-approve.sh` | reads `.phase` | never asks |
| `plot-fleet-scan.sh`, `plot-dispatch.sh`, `plot-phase-gate.sh`, `plot-state-gate.sh`, `plot-context.sh`, `plot-impl-status.sh`, `plot-merge-queue.sh`, `plot-open-pr.sh`, `plot-release-refs.sh`, `plot-sprint-candidates.sh`, `plot-sprint-release.sh`, `plot-story-lint.sh` | — | zero references |
| **the domain** (`packages/domain`) | `PlanRecord` | **`phase_alt` and `phase_alt_raw` are on `KNOWN_UNCARRIED`** — `packages/domain/corpus/plan-store.corpus.test.ts:67-68`. The port deliberately does not carry them. The comment above that list says the omission is "a decision somebody wrote down". |
| **the board** (`packages/board`) | — | zero references to `phase_alt` anywhere in `packages/` outside that corpus list |
| `board/plot-ask.mjs`, `board-server.mjs`, `plot-registryd.mjs` | via the domain port | cannot see it — the port drops it |

**The answer is unambiguous: NOBODY READS `phase_alt`.** One consumer *extracts* it into a column and then ignores that column; the domain names it as deliberately-not-carried. `docs/plans/2026-08-23-the-plan-the-board-holds.md:171` says so in its own words: *"`phase_alt` | 0 here | guards a front-matter disagreement"*, and `DESIGN-plan.md:261` calls it *"a conflict nobody has hit"*.

**So the change is inert, not additive and not breaking.** It writes a value into two fields that no consumer on this estate reads, through a port that names them as dropped. The `Done when` explicitly requires all 289 plans to parse **byte-identically** — which is another way of saying *this slice, by its own acceptance test, changes no observable output on this repository.*

**This is the `a-complete-page-is-not-truncated` shape and it is worse, not milder.** That plan narrowed a warning nothing consumed; three jurors rejected it. Here the field is not merely unconsumed by accident — the domain's corpus test lists it under a heading whose comment explains that listing it is how *"a new field arrives as a question rather than as silence."* The question was asked and the recorded answer was *do not carry it*. This plan widens the population of that field without revisiting that decision or naming a reader.

**Would adding a cross-format value change any consumer's behaviour?** No, on this estate, because no plan carries both formats and no consumer reads the field. In a repository with the split, the answer is still no — every listed consumer reads `.phase`, which the plan explicitly leaves unchanged, and `phase_alt` reaches no decision anywhere. **A delivery in the project repo where #924 was filed would still silently fail after this slice ships.** The reported summary would still say `phase=flipped`. The plan says as much at *"Not in this slice."*

## 4. Is the deferral of `/plot-deliver`'s behaviour defensible?

**No — it is the whole defect, deferred.**

The plan's argument is that the report is the prerequisite for either refusing or warning, and that a refusal *"riding on a contract change"* would be two changes in one branch. That argument would carry weight if the contract change had **any** other consumer, or if the Open Question named a slice that resolves it. It does neither: the plan is one slice, the Open Question has no owner, and the deferred half is the only thing that turns the reported value into an observable fix.

What ships is: a parser field that grows a new population, consumed by nothing, in a repository where the population is empty by construction. What #924 reports — *a delivery says `phase=flipped` and the plan still reads `approved`* — is unchanged in every repository after this branch merges.

**The split would be defensible in one form:** if the first slice's reader were named and the second slice existed in the same plan. Two slices, second one gated on the first, both in `## Slices` — the estate does that routinely (`the-build-pipeline-is-its-own-connector`'s second slice removes the adapter's closed list). The plan chose an Open Question instead, and an Open Question is not a slice.

**A second, sharper objection to the split.** `plot-deliver.sh` does not read `phase_alt` and would have to start. So would `plot-approve.sh`, and so would the domain's `PlanRecord` if the refusal belongs in `workflows/deliver.ts` — where the estate's own layering rule and the *"the master agent uses the controllers"* section say a delivery refusal belongs. **The deferred work is a domain change, a port change, and an entry in `KNOWN_UNCARRIED` moving to `FIELDS`.** That is not a line of text in a shell script; it is most of the work, and it is the half that is deferred.

## 5. What the `Done when` fails to pin

It is unusually thorough — five fixtures, a full-estate byte-identity diff, and a regression pin on the within-format rule. What it does not pin:

1. **Which value wins the `phase_alt` slot when a file carries THREE.** Front-matter `status:` + front-matter `phase:` + a `## Status` `State:`. `palt_raw` is one field and there are two losers. The plan says the rule is "extended", but the extension has an arity problem the existing rule does not. The parser's own header at `:98-101` says *"secondary value when the file carries two"* — three is unspecified after this change, and the project repo that filed #924 has 74 plans carrying front matter with an unknown number also carrying `phase:`.
2. **Which format's value lands in `phase_alt` and which in `phase_alt_raw`'s normalisation** when the front-matter pair *and* the Status block disagree — i.e. whether the cross-format report replaces or is replaced by the within-format one. The plan says the within-format rule "still reports exactly as it does now, pinned" — which forbids replacement, which means on a three-way file the Status block's value is dropped exactly as it is today. **The `Done when` pins the fix out of existence for that case and does not say so.**
3. **The `format` field.** `fmt` stays `"frontmatter"` on a file carrying both. A consumer that learns to read `phase_alt` also needs to know the losing value came from the other format — `phase_alt_raw` is a bare string with no provenance. Nothing pins a way to tell a within-format alternate from a cross-format one, and **a caller that wants to "refuse on ambiguity" — the plan's stated purpose — cannot distinguish them.** That is a contract gap in the field the plan is extending.
4. **The domain's `KNOWN_UNCARRIED` entry.** `plan-store.corpus.test.ts:67-68` continues to pass unchanged, and the plan does not say whether that list entry should be revisited. The test's own comment frames that list as a decision to be re-asked; this change re-opens the question and the `Done when` does not name it.
5. **`plot-reconcile-scan.sh`'s dead columns.** The scan will now populate columns 4 and 5 on a cross-format plan and still ignore them. Nothing pins whether that is intended or whether the scan should gain a section — which would be the one honest reader this change could ship with.

## 6. Strongest argument against doing this at all

**The parser is not where the defect is, and fixing it there produces a value nobody reads while leaving the failure in place.**

Three scripts write the `## Status` block. One reader prefers front matter. The plan itself says *"the writers agree"* and concludes that makes it a contract question. The opposite conclusion is at least as strong: **four components, three of which agree, and the fourth disagrees with all three.** The minority reader is the parser's precedence rule, and the plan explicitly declines to touch it — *"Front matter winning may well be right."*

If front-matter precedence is right, then the writers are wrong and the fix is in the writers, or in an explicit refusal: **a plan carrying both formats is malformed, and the parser should say so as an `error`, the way `:288` already models an unreadable file.** An `error` field has a reader — `KNOWN_UNCARRIED` lists it too, but `plot-deliver.sh:98-100` already dies on an unparseable plan and would need no new field. That alternative is not considered in the plan.

If the writers are right, the fix is one line of precedence in the parser, guarded by the same byte-identity diff the plan already proposes — 0 plans here carry front matter, so flipping precedence for cross-format files is provably inert here and *actually fixes* the project repo.

**The plan chose the one option that changes nothing anywhere.** It is well-argued, honest about its own limits, and correct in every fact — and the thing it ships is a field with no reader, which is the finding that rejected `a-complete-page-is-not-truncated` this week.

**What would change my position:** name a reader in this slice. Either `plot-reconcile-scan.sh` gains a section reporting the disagreement (its rows already carry the columns — this is small), or the domain carries the field and `workflows/deliver.ts` refuses. Either makes the contract change observable and turns the Open Question into a follow-up rather than the load-bearing half.

Verdict: amend
