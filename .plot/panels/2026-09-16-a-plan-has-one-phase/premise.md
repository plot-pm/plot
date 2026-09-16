# Premise lens — a-plan-has-one-phase (#924)

Read at `origin/main` = `1a8943119`. Every claim below was checked by reading the
named line or by running the parser on a fixture I built. What I ran is named.

## 1. Every factual claim is TRUE on main

**The precedence block is where the plan says it is.** `plot-plan-meta.sh:443-446`
is the front-matter branch and `:448` opens the `else if`:

```
444:    fmt = "frontmatter"
448:  } else if (canon_state != "" || canon_phase != "") {
449:    # `State:` is primary and `Phase:` the alternate, ...
452:    fmt = "canonical"
457:    fmt = "none"; praw = ""; palt_raw = ""; traw = ""
```

The quoted awk is byte-accurate, and the comment the plan quotes at `:449-451`
is verbatim. **The Status block is read only when no front matter exists** — the
`else if` is the only path to `canon_state`.

**`phase_alt_raw`/`phase_alt` exist in the contract and are emitted.** Contract
at `plot-plan-meta.sh:98-101`; emitted at `:550`:

```
550:  out = out ",\"phase_alt_raw\":\"" jesc(palt_raw) "\",\"phase_alt\":\"" norm_phase(palt_raw) "\""
```

Also present in the not-found record at `:288`, so the field is unconditional.

**All three writers guard on `section == "status"`** — verified by grep:

| script | line(s) |
|---|---|
| `plot-deliver.sh` | `:275` |
| `plot-approve.sh` | `:376` |
| `plot-undeliver.sh` | `:123`, `:131`, `:155` (three, as the plan says) |

Each is `section == "status" && !done && tolower($0) ~ /…(state|phase)[:*]/`.
**They agree with each other, and none of them can see front matter.**

**Nothing I could not verify.** One count is off — see §4.

## 2. THE KEY QUESTION: the symmetry claim is accurate

This is the claim the plan rests on, and I tested it rather than reasoning about
it. Three fixtures, same parser, same run:

| fixture | `format` | `phase` | `phase_alt` |
|---|---|---|---|
| front matter `status:`+`phase:` | `frontmatter` | `approved` | **`delivered`** ✅ reported |
| Status block `State:`+`Phase:` | `canonical` | `approved` | **`delivered`** ✅ reported |
| front matter `status:` + Status block `State:` | `frontmatter` | `approved` | **`NONE`** ❌ dropped |

**The plan's description of the existing mechanism is exactly right, and the
symmetry it claims is real.** `palt_raw` is assigned inside each branch from
that branch's own two fields (`:446`, `:455`). It is structurally incapable of
carrying a value from the other format, because the branches are mutually
exclusive. The parser reports a within-format disagreement on **both** formats
and reports the cross-format one on neither. The plan is not claiming a symmetry
that is not there — it is naming a real gap in a real rule, one level up.

## 3. The defect reproduces

Fixture: front matter `status: Approved`, Status block `- **State:** Delivered`.
Run: `skills/plot/scripts/plot-plan-meta.sh both.md`.

```json
{"format":"frontmatter","phase_raw":"Approved","phase":"approved",
 "phase_alt_raw":"","phase_alt":"NONE", ...}
```

**Confirmed: it reports `approved`, and the `Delivered` nobody read leaves no
trace.** The plan's headline is reproduced verbatim.

**And the failure loop closes end-to-end, which the plan under-states.**
`plot-deliver.sh:385` feeds `decide_transition` the parser's `.phase`, which
here is the front-matter value. `deliver.ts:156` switches on it and `:192` sets
`phaseWritten = (phase === 'delivered')`. So:

- **First run:** domain sees `approved` → passes the gate, emits a `plan-phase`
  write. `flip_phase` (`:271-285`) flips the *Status block*, `changed=1`,
  `phase_report=flipped` (`:446`). Reported success; the parser still says
  `approved`.
- **Second run:** I ran `flip_phase` on the post-delivery fixture. The Status
  block already reads `Delivered`, so the `tolower($0) ~ /approved/` test fails,
  `changed=0`, **`phase_report=already`**. The domain meanwhile *still* says
  `phaseWritten=false` and asks for the write again. Exit 0, nothing written.

**The plan's "the repair path is the failure path" is correct and I reproduced
each half.** Worth noting the two sides disagree with each other — the domain
asks for a write the shell reports as already done — and neither reports it.

**One fact the plan does not mention:** `type` is lost the same way. My fixture's
Status block `Type: bug` parsed as `"type":""`, because `traw` is assigned per
branch identically (`:447`, `:456`). Not an argument against the plan — its
slice is scoped to the phase — but the class is wider than the plan says, and a
reviewer should know the chosen fix does not address it.

## 4. The counting claim is directionally right, numerically stale

Measured on `origin/main` (290 `.md` under `docs/plans/`):

| | plan says | measured |
|---|---:|---:|
| front matter `status:`/`phase:` | 0 | **0** ✅ |
| `## Status` `State:`/`Phase:` | 285 | **287** |
| carrying **both** | 0 | **0** ✅ |

3 files carry neither (decision logs, not plans — the `plot-reconcile-scan.sh`
rule). **The load-bearing halves are exactly right: 0 front matter, and 0
carrying both**, so no plan in this repository can manifest the defect and the
"any diff is a regression" safety argument holds.

`285` vs `287` is a stale count, not a false premise — the plan's own commit
added two files. **But `Done when` hardcodes "all 285 plans"**, and that number
is already wrong on the branch point; it will be wronger by merge time. It
should read *every plan in `docs/plans/`*, derived at run time.

## 5. What `Done when` fails to pin

The gates are unusually good — both formats pinned separately, precedence
pinned, the within-format rule pinned as unchanged, full-corpus byte-identity.
Three gaps:

**(a) It does not pin WHICH value lands in `phase_alt`.** "reports **both** — the
winning phase and the losing one" does not say the losing one is the *Status
block's*. An implementation that sets `palt_raw = fm_phase` when front matter
carries both, and the Status block's `State:` only otherwise, satisfies the
sentence while silently changing the meaning of `phase_alt` from *this format's
alternate* to *something else*. Name the fixture's expected value: `phase_alt_raw:
'Delivered'`.

**(b) Nothing pins `format`.** On a both-format plan the winner is front matter,
so `format` must stay `frontmatter`. An implementation that flips it to
`canonical` or invents a third value passes every listed gate and breaks every
consumer that branches on it. The corpus diff cannot catch it — no plan here
carries both.

**(c) The within-format gate is under-specified as "still reports exactly as it
does now".** It must be pinned on **both** formats. The canonical within-format
case is the one an implementer is most likely to break, because it shares the
`palt_raw` assignment being changed, and `test/reconcile/parser.test.mjs:46-51`
currently covers only the front-matter one (`frontmatter-disagreement.md`).
There is no `canonical-disagreement.md` fixture today. That is a real hole, and
the `SPEC` table takes new rows cleanly.

**A wrong implementation that passes every gate as written:** set `palt_raw` to
the Status block's value *only when front matter carries a lone `status:`*, and
leave `format` flipping to `canonical`. Both disagreements report, the corpus is
byte-identical (no plan here carries both), precedence is unchanged — and
`format` now lies to every consumer.

## 6. Strongest argument AGAINST doing this at all

**The report has no consumer, and the plan explicitly defers building one.**
`Not in this slice` removes `/plot-deliver`'s reaction, and the Open Question
concedes nobody has decided between refusing and warning. So the delivered
artifact is a field that no caller reads, in a repository where **0 plans can
populate it** — the defect stays exactly as silent for every user of this repo
as it is today. This estate's own rule calls that out: *"where a rule exists and
nothing calls it, that is a defect to report."* This plan deliberately ships
into that state.

The sharper form: the thing actually broken is that **`plot-deliver.sh` reports
success for a delivery that did not happen, and its second run cannot repair
it.** Reporting a disagreement in the parser does not fix that. A one-line
change in `deliver.ts` — refuse when `phase_alt` disagrees — would, and the
parser change is its prerequisite only under the plan's chosen design.

**Why I do not think this sinks it.** The prerequisite framing is honest and
correct: nothing can refuse on ambiguity that is not reported, and the parser is
the only place that sees both formats. Splitting the contract change from the
behaviour change is right — a refusal added in the same branch would ship a
behaviour change riding on a contract change, which is precisely the failure
mode this estate keeps writing rules about. And the defect is real in the field:
filed from an actual delivery, in a repo where 74 plans carry both.

The mitigation is to file the consumer now rather than leave it as an Open
Question, so the field does not join the estate's population of correct rules
nothing calls.

## Summary

The premise holds. I reproduced the defect, confirmed the symmetry claim by
running all three cases, and verified every line reference. The two numbers that
matter — 0 front matter, 0 carrying both — are exact. The one wrong number (285
→ 287) is cosmetic but is written into a gate. The `Done when` needs three
values pinned that it currently leaves free, and the canonical within-format
fixture it assumes exists does not.

Amendments, all small and none touching the design:

1. `Done when`: pin `phase_alt_raw: 'Delivered'` (the Status block's value) and
   `format: 'frontmatter'` on the both-format fixture.
2. `Done when`: pin the within-format rule on **both** formats; add the missing
   `canonical-disagreement.md` fixture alongside the existing
   `frontmatter-disagreement.md`.
3. Replace "all 285 plans" with a count derived at run time.
4. Note that `type` is dropped by the same mechanism (`:447`/`:456`) and say
   whether it is in scope. I recommend explicitly out, in `What this does not do`.
5. File the `/plot-deliver` consumer as a follow-up now rather than leaving it
   an Open Question.

Verdict: amend
