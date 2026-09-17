# Premise lens — the-parser-reads-the-field-plot-writes

Position: amend

Lens: verify every citation; re-derive every measurement; test the claimed
relationship to `a-plan-has-one-phase`; and measure the both-shapes population
on THIS estate, which the plan never does.

---

## 1. Is the problem real, and stated correctly?

**The defect is real. The citations are accurate. The population claim is not
made, and that is the plan's central omission.**

### 1a. `plot-plan-meta.sh:443` is the precedence branch, as quoted — VERIFIED

```
$ grep -n 'if (fm_status != "" || fm_phase != "")' skills/plot/scripts/plot-plan-meta.sh
443:  if (fm_status != "" || fm_phase != "") {
```

The four quoted lines are byte-exact against `sed -n '443,448p'`:

```awk
  if (fm_status != "" || fm_phase != "") {
    fmt = "frontmatter"
    praw = (fm_status != "") ? fm_status : fm_phase
    palt_raw = (fm_status != "" && fm_phase != "") ? fm_phase : ""
    traw = fm_type
  } else if (canon_state != "" || canon_phase != "") {
```

The plan's excerpt elides `palt_raw` and `traw` but quotes nothing falsely, and
the `else if` guard it describes is where it says it is. **One line number
worth noting**: the sibling plan `a-plan-has-one-phase` cites `:443-446` and the
issue #933 cites `:434`. This plan's `:443` is the correct one today.

### 1b. `plot-approve.sh` contains zero front-matter references — VERIFIED

```
$ grep -n -i 'front.?matter\|frontmatter\|fm_status\|fm_phase' skills/plot/scripts/plot-approve.sh
(no output, exit 1)
```

Zero. Confirmed.

### 1c. `plot-deliver.sh` has five, and all five refuse rather than write — VERIFIED

```
$ grep -n -i 'front.matter\|frontmatter\|fm_status\|fm_phase' skills/plot/scripts/plot-deliver.sh
425:# carrying BOTH front matter and a `## Status` block was delivered in a project
428:# `approved` — because it prefers front matter wherever it exists and reads the
433:# IS the defect: on a front-matter plan it edits the block and leaves the front
472:  echo "  landed in the '## Status' block while front matter takes precedence," >&2
475:  echo "  records (front matter, or the '## Status' block) and re-run." >&2
```

Exactly five. Three (425, 428, 433) are **comment** lines explaining the gate;
two (472, 475) are **stderr** lines inside the refusal. **None is a write.**
Both halves of the plan's claim hold. The plan's own Notes paragraph narrowing
this from the report is honest and correct.

### 1d. `plot-deliver.sh:472` is the refusal the plan says it is — VERIFIED

`:472` sits inside `phase_would_read()`, which parses the **scratch copy before
the `mv`** and compares `.phase` to the expected value:

```
got=$(printf '%s' "$m" | jq -r '.phase // ""')
[ "$got" = "$want" ] && return 0
...
echo "plot-deliver: $rel — wrote phase '$want', but the parser still reads '$got'." >&2
echo "  The plan states its phase in TWO places and they disagree: the write" >&2
echo "  landed in the '## Status' block while front matter takes precedence," >&2   # :472
```

It returns 1 and nothing is written. This is a refusal, not a repair, exactly as
the plan describes.

### 1e. The reporter's measurement — NOT RE-DERIVABLE HERE, and the plan should say so

The plan states: *"`/plot-approve` reported all seven steps clean, and
`plot-fleet-scan.sh` answered `Wave 1 — unapproved, eligible=0`."* That is a
measurement from **another repository** (issue #933: plot 2.17.0, Bitbucket,
`Integration branch: develop`). It cannot be re-derived on this estate, and
section 4 below explains why that matters more than it looks.

---

## 2. THE CENTRAL FINDING: the both-shapes population on THIS estate is ZERO

The rubric asked me to count. I did, three ways.

```
$ ls docs/plans/*.md | wc -l
     295

$ for f in docs/plans/*.md; do [ "$(head -1 "$f")" = "---" ] && echo "$f"; done | wc -l
       0

$ bash skills/plot/scripts/plot-plan-meta.sh docs/plans/*.md | jq -r '.format' | sort | uniq -c
 295 canonical

$ bash skills/plot/scripts/plot-plan-meta.sh docs/plans/*.md \
    | jq -r 'select(.phase_alt != "NONE") | .file'
(no output)
```

**295 of 295 plans parse `canonical`. Zero carry front matter at all. Zero carry
both. Zero report a `phase_alt`.**

The fixtures are the same story:

```
$ for f in test/reconcile/fixtures/plans/*.md; do
    [ "$(head -1 "$f")" = "---" ] && grep -q '^## Status' "$f" && echo "BOTH: $f"; done
(no output)
```

Four `frontmatter-*` fixtures exist; **none carries a `## Status` block.**
`frontmatter-disagreement.md` is a *within-format* disagreement (`status:
Delivered` vs `phase: Triage`) — the case `:446` already handles. **No fixture
anywhere in this repository exercises the case this plan exists to fix.**

### What that means for the byte-identical gate

The plan's `Done when` says:

> **all 292 plans on this estate parse byte-identically** except those carrying
> both shapes

**With zero both-shapes plans, the exception clause is empty and the gate is
vacuous in exactly the dangerous direction.** A byte-identical diff over 295
canonical plans passes trivially — it passes if you change nothing, and it
passes for a broken inversion too, because the inverted branch is never reached
by any file in the corpus. The gate proves the change did not break this
estate. It cannot prove the change *works*, because the estate contains no
instance of the thing being fixed.

This is the same shape as `a-withdrawn-item-is-not-open`'s finding, which the
plan itself cites approvingly: *a reader that never reads the field and a writer
that never writes the value.* Here it is a **gate that never reaches the branch
it gates.**

The `Done when` does contain a fixture clause — *"pinned by a fixture holding
both"* — so the plan is aware one must be created. But the two clauses are not
wired together: the byte-identical clause is stated as though a both-shapes
population exists to be excepted, and it does not. **State the number.** Say
*"zero plans here carry both, so the regression gate is a no-change proof and
the new fixture is the only evidence the inversion works."* That is the honest
form and it changes what a reviewer looks at.

### And the count is wrong

The plan says **292**; the estate holds **295** (`ls docs/plans/*.md | wc -l`),
and 16 plans were added since 2026-09-16. A drifting count in a `Done when` is
a gate that fails for the wrong reason or gets silently edited to match. Say
*"every plan"*, not a number.

---

## 3. Is this the right fix, or a symptom fix?

**It is a real root-cause fix for the right defect — but it is not the root
cause of the defect it claims kinship with, and it inherits a risk the plan
does not name.**

### 3a. The claimed relationship to `a-plan-has-one-phase` is OVERSTATED

The plan says:

> [`a-plan-has-one-phase`] shipped in v2.18.0 and made `plot-deliver.sh`
> **refuse** a delivery whose write the parser would not read. **But a refusal
> is not a fix.**

I read `2026-09-16-a-plan-has-one-phase.md` in full. **This is a different
defect, not its surface patch.** That plan's headline is:

> A delivery writes the phase, reports `phase=flipped`, and **never reads the
> file back**

Its subject is *delivery does not verify its own write*. That is a general
property: `phase_would_read()` fires on **any** disagreement between writer and
parser — a malformed file, an unparseable scratch copy (it has its own arm for
that), a future format, not only front matter. Its own Changelog says *"A
delivery on a plan carrying two formats reported `phase=flipped`"* — two formats
is the **example** that found it, not the rule.

So the precedence inversion does **not** subsume that gate, and the plan is
right that the gate "stays". But the framing — *"the root of a defect already
patched at the surface"* — is wrong. `a-plan-has-one-phase` is a verify-your-own-
write gate that would still be correct and still needed if front matter did not
exist. Amend the sentence to *"a sibling defect, found by the same report"*.

The plan's own final line is nearly right and should be promoted: *"it stops
firing because the condition is gone, not because it was softened."* That is
accurate for the front-matter case and says nothing about the gate's other arms.

### 3b. The inversion is defensible — the plan's reasoning survives

The argument that the field with precedence must be the field with a writer is
sound. `grep -ln 'section == "status"' skills/plot/scripts/*.sh` returns
`plot-approve.sh`, `plot-deliver.sh`, `plot-undeliver.sh` (plus the parser, the
gate, and the sprint script). **Three lifecycle writers, all canonical-only,
zero front-matter writers.** The plan's refusal to add a second writer is
correct and matches `a-withdrawn-item-is-not-open`'s reasoning, which I verified
at `:72` — *"A cache nobody refreshes and nobody reads is a second answer waiting
to contradict the first."* Cited accurately.

### 3c. But it can HARM the reporter's own population, and the plan does not see it

**This is the finding I would most want the author to answer.**

The plan asserts, in its diagram and in prose:

```
status: Draft          <- untouched by every transition
phase:  Draft          <- untouched
```

**Issue #933's own Environment section contradicts this:**

> The front-matter convention predates Plot adoption in this repo — **260+ plans
> carry it, and the delivered ones have `phase: Delivered` maintained by hand.**

So in the reporting repository front matter is **not** untouched — it is
*hand-maintained*, and for **delivered** plans it is the record a human curates.
The `State:` block is the newcomer there, written only by scripts, only since
Plot adoption.

Invert precedence and the consequence on that estate is:

- A plan **approved under Plot** (script wrote `State: Approved`, human left
  `phase: Draft`) — inversion **fixes** it. This is the reported case.
- A plan **delivered before Plot adoption** (human wrote `phase: Delivered`,
  `State:` never written by any script, or holding a stale template value) —
  inversion makes `State:` win. If `State:` is absent, `canon_state == ""` and
  the `else if` falls through to front matter, so it is safe. **But if `State:`
  exists holding a stale or template value, a hand-curated `Delivered` plan
  flips to that value.**

**The plan performs no measurement of that second population**, on this estate
(where it is unmeasurable — zero front-matter plans) or on the reporter's (where
it is 260+ plans and the person who filed the issue could be asked). The
`Done when` clause *"a plan with **only** front matter reports exactly as
today"* covers the safe fall-through but **not** the both-shapes-where-front-
matter-is-the-curated-truth case, which is precisely the population the fix
targets.

`a-plan-has-one-phase`'s own comment at `plot-deliver.sh:474` takes the opposite
and more cautious line: *"which format ought to win is a decision this gate
deliberately leaves to a person."* This plan overrides that deliberate deferral
without quoting it or arguing against it. **It should.**

The honest form is either (a) ask the reporter how many of their 260+ plans
carry a `State:` line that disagrees with hand-curated front matter, or (b)
state explicitly that the inversion is right for script-written transitions and
that a plan whose front matter is hand-curated is out of scope — and say what
such a repository should do instead.

---

## 4. Does `Done when` contain a gate that cannot be satisfied by plumbing a
value through without using it?

**Yes — one clause is genuinely strong, and it is the clause that saves this
plan.** The rest are weaker than they look.

**The strong one:**

> the reporter's sequence works end to end — approve a both-shapes plan, then
> `plot-fleet-scan.sh` answers `eligible=1`, **pinned by a test that performs
> the approval rather than by editing a fixture**

This is a real gate. It cannot be satisfied by plumbing: it runs the actual
writer (`plot-approve.sh`), then an independent reader (`plot-fleet-scan.sh`),
and asserts an integer that is `0` today. The parenthetical — *rather than by
editing a fixture* — is the part that closes the loophole, and the author
clearly saw the failure mode. **Keep this clause exactly as written; it is the
only one that proves the defect is fixed rather than merely that the parser
changed.**

**The weak ones:**

- *"all 292 plans parse byte-identically except those carrying both shapes"* —
  vacuous as shown in §2. Zero exceptions exist, so it is a no-change proof over
  a corpus that never reaches the new branch. Also the count is wrong (295).
- *"a plan with only front matter reports exactly as today, pinned across all
  seven phase values"* — good regression coverage, satisfiable without the
  inversion working.
- *"`fmt` still reports which shape was read"* — **the field is not called
  `fmt`.** The parser's JSON key is `format`:

```
$ bash skills/plot/scripts/plot-plan-meta.sh docs/plans/2026-09-16-a-plan-has-one-phase.md | jq -r 'keys | join(",")'
approved_raw,assignee,branches,changelog,delivered_raw,design_raw,file,format,impl,impl_raw,issues,long_wave_names,malformed_prs,phase,phase_alt,phase_alt_raw,phase_raw,prs,released_raw,review,review_raw,sprint,started_raw,story,title,type,waves
```

  `fmt` is the **awk-internal** variable name at `:444`. The `Done when` is
  stated in the implementation's private vocabulary, not the contract's. A gate
  a consumer cannot check against the actual output is a gate in name only.
  Write `format`.

  Worse, this clause is the classic plumb-through: `format` will keep reporting
  *something* whatever the inversion does. The clause that would bite is *"a
  both-shapes plan reports `format: canonical` and `phase_alt` carrying the
  front-matter value"* — an assertion on both fields together, on the file that
  exercises the new branch.

**Missing gate:** nothing asserts on `phase_alt` for the both-shapes case,
despite the Design section resting an entire argument on it (*"`phase_alt`
already carries the loser... That is what keeps this from hiding the drift it
stops causing"*). Today `phase_alt` is populated **only within a format** (from
`fm_status`/`fm_phase` at `:446`, or `canon_state`/`canon_phase` at `:454`) —
never **across** formats. Measured: every one of 295 plans reports
`phase_alt: NONE`, and the only fixture with a non-NONE value,
`frontmatter-disagreement.md`, gets it from two front-matter keys. **So the
Design's claim that `phase_alt` "already carries the loser" is false for the
cross-format case this plan creates.** Carrying the front-matter value into
`phase_alt` when canonical wins is **new work the plan describes as existing**.
That must become both an implementation step and a `Done when` assertion, or
the drift-visibility argument is unbacked.

---

## 5. What the plan claims that I could not verify, or found false

| claim | verdict |
|---|---|
| `plot-plan-meta.sh:443` is the precedence branch, as quoted | **TRUE** — byte-exact |
| `plot-approve.sh` contains zero front-matter references | **TRUE** — grep returns nothing |
| `plot-deliver.sh` holds five, all refusals not writes | **TRUE** — 3 comments, 2 stderr, 0 writes |
| `plot-deliver.sh:472` is the refusal described | **TRUE** — inside `phase_would_read()`, returns 1 |
| `a-plan-has-one-phase` shipped in v2.18.0 | **TRUE** — `Released: 2026-09-16, 2.18.0` |
| the report's table lists a `plot-release.sh` that does not exist | **TRUE** — only `plot-release-gate.sh`, `-refs`, `plot-sprint-release.sh` |
| `a-withdrawn-item-is-not-open` records the same reasoning | **TRUE** — `:72`, quoted accurately |
| "292 plans on this estate" | **FALSE** — 295 |
| "`fmt` still reports which shape was read" | **FALSE** — the field is `format`; `fmt` is awk-internal |
| "`phase_alt` **already** carries the loser" | **FALSE for the cross-format case** — 295/295 report `NONE`; `phase_alt` is populated only within a format. This is new work described as existing. |
| front matter is "untouched by every transition" | **MISLEADING** — true of Plot's scripts, false of the reporter's repo, where #933 says 260+ plans hand-maintain it and delivered ones carry `phase: Delivered` by hand |
| this is "the root of a defect already patched at the surface" (`a-plan-has-one-phase`) | **OVERSTATED** — that plan's defect is *delivery never reads its own write back*, a general verify-your-write gate that fires on any writer/parser disagreement. Sibling, not surface. |
| the reporter's `eligible=0` → `eligible=1` measurement | **UNVERIFIABLE HERE** — another repo (plot 2.17.0, Bitbucket, `develop`). Plausible and internally consistent with #933. Not re-derived. |

**Never measured, and the rubric's question:** the both-shapes population on this
estate. **Zero.** The plan implies it is non-empty (the `Done when`'s "except
those carrying both shapes" presupposes a set to except) and never states the
number.

---

## 6. What a premise reader notices that the plan missed

**(a) A third writer goes unmentioned.** The plan names `plot-approve.sh` and
`plot-deliver.sh`. `grep -ln 'section == "status"'` returns a third lifecycle
writer:

```
skills/plot/scripts/plot-undeliver.sh
```

`grep -n -i 'front.matter\|frontmatter\|fm_status' skills/plot/scripts/plot-undeliver.sh`
returns **nothing** — so it strengthens the plan's case (three canonical-only
writers, not two) and it belongs in the argument. `a-plan-has-one-phase` names
all three, including *"three occurrences"*. This plan names two. The stronger
premise was available and was not taken.

**(b) `plot-state-gate.sh` also reads the Status block**, and the plan's
"two gates leave a plan that cannot move" paragraph asserts a hand edit would be
refused by it without citing a line. I did not verify the gate's behaviour on a
front-matter plan, and the plan should either cite it or drop the assertion — it
is load-bearing for the *"nothing in the lifecycle writes the field the parser
prefers"* conclusion.

**(c) The sprint/story annotations are the same shape and are not considered.**
`plot-approve.sh` also updates the sprint annotation. Front matter carries
`sprint:`, `story:`, `title:`, `review:`, `impl:` — and for **those** fields
`:459-470` gives front matter precedence too, unconditionally and by design
(*"Board-facing fields: front matter wins over the canonical body"*). This plan
inverts precedence for **phase only**. That is probably correct, but it leaves
the parser with two opposite precedence rules in adjacent code blocks, and the
plan does not say why phase is different. The reason is good — *phase has script
writers and title does not* — and stating it would inoculate the next reader
against "fixing" the inconsistency.

**(d) No fixture exists for the case, anywhere.** Stated in §2; repeating it
here because it is the single most actionable gap. The `Done when` asks for one;
the Slices section describes the change as *"keeping `phase_alt` as the loser and
every single-shape plan byte-identical"* and does not list creating the fixture
as work. **Fixture creation is the implementation's first step, not a test
detail** — without it there is no executable instance of the defect in this
repository, and `test/reconcile/` enforces the format contract by fixture.

---

## Position
**Verdict: amend.**


**Why not proceed:** three factual errors sit in the plan's own `Done when` and
Design (`fmt` for `format`; `292` for `295`; `phase_alt` "already carries the
loser" when it demonstrably does not across formats), and the headline
regression gate is vacuous on a corpus where the both-shapes population is
**zero** — a number the plan never states and that changes what the gate proves.

**Why not reject:** every code citation checks out byte-exact, the defect is
real, the writers/reader asymmetry is verified three ways, the refusal-to-add-a-
second-writer reasoning is sound and correctly cited, and the end-to-end
`eligible=1` clause is a genuine gate that cannot be plumbed through.

**Amendments, in priority order:**

1. **State the measurement: zero plans here carry both shapes.** Say plainly
   that the byte-identical clause is a no-change proof and that the new fixture
   plus the end-to-end approval test are the only evidence the inversion works.
2. **Fix `fmt` → `format`** in `Done when`, and strengthen that clause to assert
   `format: canonical` **and** `phase_alt` carrying the front-matter value on the
   both-shapes fixture.
3. **Correct `292` → every plan** (no number).
4. **Correct the `phase_alt` claim.** Cross-format `phase_alt` is new work, not
   existing behaviour. Add it to the slice and to `Done when`.
5. **Answer the hand-curated-front-matter population.** #933 says the reporter's
   260+ plans hand-maintain `phase: Delivered`. Either measure how many carry a
   disagreeing `State:`, or scope them out explicitly and say what they should
   do. Quote and argue against `plot-deliver.sh:474`'s deliberate deferral —
   *"which format ought to win is a decision this gate deliberately leaves to a
   person"* — rather than silently overriding it.
6. **Downgrade the `a-plan-has-one-phase` framing** from *"the root of a defect
   already patched at the surface"* to *sibling found by the same report*. That
   gate is a verify-your-own-write gate with arms this change does not touch.
7. **Name `plot-undeliver.sh`** as the third canonical-only writer. It makes the
   premise stronger and it is free.
8. **Make fixture creation an explicit implementation step**, not a test detail.
