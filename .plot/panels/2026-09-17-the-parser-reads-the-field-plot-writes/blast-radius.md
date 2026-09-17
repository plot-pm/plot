# Blast radius — the parser reads the field Plot writes

Position: amend

Lens: blast radius. `plot-plan-meta.sh` is the plan-format contract; 98 files
reach it. I enumerated every consumer of `fmt` and `phase_alt`, ran the parser
over all 295 plans before and after a simulated inversion, and ran the parser
suite against the inversion.

**The change is far safer than its reach suggests, and the `Done when` measures
the wrong population.** The estate cannot exercise the change at all — 295 of
295 plans are `canonical` and zero carry front matter — so "all 292 plans parse
byte-identically" is satisfied by a no-op and by a wrong implementation alike.
Three concrete gaps below, each with a command.

---

## 1. Is the problem real, and stated correctly?

**Real, and stated correctly.** Every load-bearing claim verified.

The precedence is where the plan says:

```
$ sed -n '443,448p' skills/plot/scripts/plot-plan-meta.sh
  if (fm_status != "" || fm_phase != "") {
    fmt = "frontmatter"
    praw = (fm_status != "") ? fm_status : fm_phase
    palt_raw = (fm_status != "" && fm_phase != "") ? fm_phase : ""
    traw = fm_type
  } else if (canon_state != "" || canon_phase != "") {
```

The writers touch only `State:`:

```
$ grep -c 'front.matter\|frontmatter' skills/plot/scripts/plot-approve.sh
1                       # a comment, not a write

$ grep -n 'front.matter\|frontmatter' skills/plot/scripts/plot-deliver.sh
425,428,433,472,475     # all five inside phase_would_read's REFUSAL — confirmed
```

`plot-approve.sh:358` flips `**State:**` inside the `## Status` block only. So on
a both-shapes plan the writer writes bytes the reader ignores. The defect is
exactly as described.

I reproduced the reported symptom directly:

```
$ cat /tmp/both.md      # status: Draft in front matter, State: Approved in the block
$ bash skills/plot/scripts/plot-plan-meta.sh /tmp/both.md | jq -c '{format,phase,phase_alt}'
{"format":"frontmatter","phase":"draft","phase_alt":"NONE"}
```

An approved plan reads `draft`, and `phase_alt` is `NONE` — the drift is not even
reported. That is the bug, and the plan's framing of it is accurate.

**And the plan is honest about its own prior art.** `a-plan-has-one-phase` did
ship (`docs/plans/2026-09-16-a-plan-has-one-phase.md:7` → `State: Released`), it
added the refusal, and the refusal is generic — `phase_would_read` compares
`.phase` to the wanted value and names no format — so it self-heals under this
change rather than needing relaxation. The plan says exactly this and it is true.

---

## 2. Right fix, or symptom fix?

**Right fix, and it is the root.** The surface patch refuses; this makes the
refusal's condition unreachable. Confirmed by construction rather than argument:

```
$ bash /tmp/plotsim/inverted.sh /tmp/both.md | jq -c '{format,phase,phase_alt}'
{"format":"canonical","phase":"approved","phase_alt":"draft"}
```

`phase_would_read` compares `.phase` ("approved") to the written value
("approved") and passes. The gate stops firing because the condition is gone.

**But the fix is wider than the plan describes, and that is my first finding.**
The `fmt`/`praw`/`palt_raw`/`traw` assignments are one `if` arm. Inverting the
arm inverts `type` too — silently:

```
$ bash skills/plot/scripts/plot-plan-meta.sh /tmp/both.md | jq -c '{type}'   # fm type: docs
{"type":"docs"}
$ bash /tmp/plotsim/inverted.sh /tmp/both.md | jq -c '{type}'                # block Type: bug
{"type":"bug"}
```

The plan's title, its Changelog and its slice line all say *phase*. `type` is not
mentioned anywhere in the plan. It is arguably the *right* answer — the same
reasoning applies — but an implementer reading the plan will not know whether
inverting `type` is intended or a bug, and the `Done when` does not pin it. The
neighbouring fields (`review`, `impl`, `design`, `sprint`, `story`, `title`,
`approved`, `delivered`) sit on their own `strip_placeholder` lines and stay
front-matter-wins, so the format now speaks with two voices: phase and type from
the block, ceremony and records from front matter. That is a format decision, and
the plan makes it by accident.

**Verified the split survives:**

```
$ bash /tmp/plotsim/inverted.sh /tmp/both.md | jq -c '{phase,type,review}'
{"phase":"approved","type":"bug","review":"in-session"}   # review still from fm
```

---

## 3. Does `Done when` contain a gate that cannot be satisfied by plumbing a value through?

**Yes — one, and it is the good one.** But it sits beside a clause that is
vacuous on this estate, and a third that is unreachable.

**The real gate** is the end-to-end clause: *"approve a both-shapes plan, then
`plot-fleet-scan.sh` answers `eligible=1`, pinned by a test that performs the
approval rather than by editing a fixture."* That cannot be satisfied by plumbing
— it runs the writer, then the reader, and asserts they agree. The explicit
refusal of a hand-edited fixture is the sentence that makes it a gate. This is
the strongest thing in the plan and it should be kept verbatim.

**The vacuous clause** is *"all 292 plans on this estate parse byte-identically
except those carrying both shapes."* Measured:

```
$ ls docs/plans/*.md | wc -l
295
$ bash skills/plot/scripts/plot-plan-meta.sh docs/plans/*.md | jq -r '.format' | sort | uniq -c
 295 canonical
$ bash skills/plot/scripts/plot-plan-meta.sh docs/plans/*.md | jq -r 'select(.phase_alt != "NONE")' | wc -l
0
```

**295 canonical, 0 front matter, 0 phase_alt.** The exception clause names an
empty set. I ran the full before/after diff:

```
$ bash skills/plot/scripts/plot-plan-meta.sh docs/plans/*.md > /tmp/before.jsonl
$ bash /tmp/plotsim/inverted.sh          docs/plans/*.md > /tmp/after.jsonl
$ diff /tmp/before.jsonl /tmp/after.jsonl | wc -l
0
```

**Zero lines differ across 295 plans.** So does the fixture corpus:

```
$ diff <(bash skills/plot/scripts/plot-plan-meta.sh test/reconcile/fixtures/plans/*.md) \
       <(bash /tmp/plotsim/inverted.sh            test/reconcile/fixtures/plans/*.md)
                                                                    # no output
```

A clause satisfied by `diff` returning nothing is satisfied equally by the
correct change, by a no-op, and by a change that inverts the wrong fields. It
proves *no regression*; it proves nothing about the fix. The plan presents it as
the headline check ("all 292 plans") when it is the weakest item on the list.
The count is also wrong — 292 against a measured 295.

**The unreachable clause** is *"a plan with only front matter reports exactly as
today, pinned across all seven phase values."* Four front-matter fixtures exist
and none carries a `## Status` block, so they are already covered by the zero-diff
above. Pinning seven phase values on a population that cannot change is ceremony.
The population that *can* change — both shapes — has exactly one representative
anywhere in the repo, and it is an inline fixture in a test (see §5).

---

## 4. What could I not verify, or found false?

**Found false: the plan count.** *"all 292 plans on this estate"* — there are
295 (`ls docs/plans/*.md | wc -l` → 295). Minor, but this repo's own rules say a
number carries the claim.

**Found overstated: "`phase_alt` already carries the loser."** True within a
format, false across formats, and the plan's own fixture case exposes it. On a
three-way file the front matter's values are dropped entirely:

```
$ cat /tmp/three.md      # fm: status: Draft + phase: Triage ; block: State: Approved + Phase: Delivered
$ bash skills/plot/scripts/plot-plan-meta.sh /tmp/three.md | jq -c '{phase,phase_alt_raw}'
{"phase":"draft","phase_alt_raw":"Triage"}
$ bash /tmp/plotsim/inverted.sh            /tmp/three.md | jq -c '{phase,phase_alt_raw}'
{"phase":"approved","phase_alt_raw":"Delivered"}
```

Before, the block's two values vanish. After, front matter's two vanish. One slot,
two losers — the arity problem the previous panel raised against
`a-plan-has-one-phase` (`.plot/panels/2026-09-16-a-plan-has-one-phase/premise.md`,
`remedy.md:47`). The plan asserts the slot carries the loser as settled fact and
does not confront the case where it cannot. The sentence *"That is what keeps this
from hiding the drift it stops causing"* is therefore true for the two-field case
and false for the four-field case.

**Could not verify — and it is the plan's motivating evidence:** the reporter's
repository. The plan cites an adopter with plans carrying both shapes; nothing on
this estate reproduces it. The reporter's `eligible=0 → eligible=1` observation
is credible and mechanically consistent with what I measured, but I have no
access to that repo and the plan supplies no captured parser output from it. The
whole population this change serves is unobservable from here.

---

## 5. What a blast-radius reader notices that the plan missed

### (a) One existing test breaks, and the plan does not name it

`test/reconcile/parser.test.mjs:582` — *"parser: front matter design: outranks a
`## Status` Design: line"* — builds an inline fixture carrying **both** shapes and
asserts `format === 'frontmatter'`. It is the only both-shapes artifact in the
repository, and it exists to pin the precedence this plan inverts.

I ran the suite against the inversion:

```
$ node --test test/reconcile/parser.test.mjs
✖ parser: front matter design: outranks a ## Status Design: line (909.374ms)
ℹ tests 97   ℹ pass 96   ℹ fail 1
```

Baseline on the unmodified parser was 97/97. So the blast radius on this estate
is precisely **one test, and it is a deliberate pin of the old contract.** That
is a small number and it is good news — but the plan claims byte-identical
behaviour and names no test to update. An implementer meeting the letter of the
`Done when` will hit a red suite with no instruction on whether to change the
assertion or the change.

Note also what that test is *about*: `design_raw`, which stays front-matter-wins
either way. Only its `format` assertion moves. Its title becomes misleading
rather than wrong — front matter still outranks the block for `design:`, but the
record now reports `canonical`. That is the two-voices problem from §2 showing up
in a test name.

### (b) `fmt` is carried by four consumers and branched on by none

This was my central question and the answer is clean. Every consumer:

| consumer | what it does with `format` |
|---|---|
| `packages/board/src/contract/schema.ts:63` | `format: z.string()` — parsed, never read by the app. `git grep '\.format\b' packages/board/src` → **no hits** |
| `packages/domain/src/ports/plan-store.ts:14` | `format: string` on `PlanRecord` |
| `packages/domain/src/adapters/plan-store/plan-store-shell.ts:96` | `format: raw.format ?? 'none'` — pass-through |
| `packages/domain/corpus/plan-store.corpus.test.ts:38` | asserts wire→port field mapping, not the value |

```
$ git grep -nE "format *(==|===|!=|!==) *['\"]" -- skills/plot/scripts/*.sh 'packages/*/src' scripts/
                                                                    # no output
```

**Nothing anywhere branches on the value `canonical` / `frontmatter` / `none`.**
No rule, no workflow, no shell script, no board component. The `fmt` field is
diagnostic only. The plan's *"`fmt` still reports which shape was read, so a
consumer can tell"* is true and describes a capability no consumer uses. The
change is safe on this axis and the plan could say so with a measurement instead
of a hope.

Test assertions on `format` literals are confined to `parser.test.mjs` — lines
27–100 (fixture table), 230, 232, 599, 1615, 1663, 1698, 1741. Of these only
**599** sits on a both-shapes file; the rest are single-shape and provably
unaffected by the zero-diff in §3.

### (c) `phase_alt` IS emitted and DOES feed a gating counter — the plan understates its own reach

The plan treats `phase_alt` as an inert carrier. It is not. `plot-reconcile-scan.sh:744`:

```bash
if [ -n "$alt_raw" ] && [ "$alt" != NONE ] && [ "$alt" != "$st" ]; then
  attention_out+="  $base — status: '$raw_phase' disagrees with phase: '$alt_raw' (phase is machine-read)\n"
  n_att=$((n_att + 1))
fi
```

`attention_out` prints under `== 5. Needs attention ==` (`:1118`), which is
**inside the blocking set 1–6** — `/plot-deliver` pastes `attention=` as its
delivery-landed gate (CLAUDE.md, and `:1220`). So `phase_alt` reaches a gate.

Two consequences the plan does not address:

1. **The change makes this finding fire where it never did.** Today a both-shapes
   plan has `phase_alt: NONE` and the scan is silent. After the change it carries
   the front-matter value and, whenever the two disagree, the count rises and a
   delivery is gated. On this estate the count stays 0 (zero front matter), so the
   *adopter's* repo is where this lands — the same repo the plan cannot observe.
   That is a behaviour change on the motivating population, in the gating path,
   and the plan claims the only change is precedence.

2. **The message becomes false.** It says `status: '...' disagrees with phase:
   '...' (phase is machine-read)`, written for a within-front-matter disagreement.
   After the change the same line prints for a cross-format one, where `$raw_phase`
   is the block's `State:` and `$alt_raw` is front matter — so it names the fields
   backwards and the parenthetical asserts the opposite of the new rule. It has
   **no test**: `git grep -rn "disagrees with phase" -- test/ skills/` returns only
   the source line itself. An untested, now-inverted message on a gating path.

### (d) A note on method, and a real incident

I ran the inversion by copying the parser aside and restoring it; per the brief I
did not intend to modify the tracked file. **A concurrent agent's commit
`4759b2f9b` swept my in-flight copy into `main`** alongside four unrelated files.
I restored the working tree to the last legitimate content (`6fb72c0cd`) and
verified:

```
$ diff <(git show 6fb72c0cd:skills/plot/scripts/plot-plan-meta.sh) skills/plot/scripts/plot-plan-meta.sh
                                                                    # identical
$ sed -n '443,444p' skills/plot/scripts/plot-plan-meta.sh
  if (fm_status != "" || fm_phase != "") {
    fmt = "frontmatter"
```

The working tree is correct. **`HEAD` is not** — `4759b2f9b` carries an inverted
`plot-plan-meta.sh` including ad-hoc `traw`/`palt_raw` fallbacks I wrote for a
simulation, committed under a message about `machine.ts` imports. That needs
reverting independently of this plan, and it is worth noting that it is exactly
the failure mode this repo's `plot-state-gate.sh` exists to catch for `State:`
lines and does not catch for the parser itself.

---

## What would move this to `proceed`

1. **Say that `type` inverts with `phase`**, or scope the arm so it does not.
   Either is defensible; leaving it unstated is not.
2. **Name `parser.test.mjs:582`** as the test whose `format` assertion changes,
   and say why the change is correct rather than a regression.
3. **Replace the 295-plan zero-diff with a discriminating gate.** It is a fine
   regression check and it is not evidence. The end-to-end approve→scan clause
   already carries the weight; make it the headline and add a both-shapes fixture
   asserting `phase`, `phase_alt_raw` **and** `type`.
4. **Pin the four-field case** (fm `status:`+`phase:` plus block `State:`+`Phase:`)
   and say which value wins the one `phase_alt` slot. Today it is unspecified and
   the plan asserts a property that does not hold there.
5. **Fix `plot-reconcile-scan.sh:745`'s wording and give it a test**, since the
   change points it at a case it was not written for and it feeds a blocking
   counter.
6. **Correct 292 → 295.**

None of these is structural. The diagnosis is right, the fix is the root, and the
measured blast radius on this estate is one deliberately-placed test. The plan
needs to name what it actually touches.
