# Premise lens — a-scan-section-honours-offline

Position: amend

The defect is real and the code citations are exact. **One estate reading in the
plan is false, and it is false because a fix that landed the day before the plan
was written removed the very calls it counts.** The plan's own Notes section
names that commit and does not notice it invalidates the measurement beside it.

---

## 1. Is the problem real, and stated correctly?

**Real, and the structural claim is exactly right.**

Section 6's loop opens at `:1137` and its `pr-state` call is at `:1156`. No
`PR_SOURCE` or `pr_reliable` test appears between them:

```
$ grep -n 'while IFS=.*read -r f st' skills/plot/scripts/plot-reconcile-scan.sh
1137:while IFS="$US" read -r f st _raw _alt _alt_raw _branches prs ptype _psprint; do

$ grep -n 'pr-state' skills/plot/scripts/plot-reconcile-scan.sh
1156:  sha=$("$script_dir/plot-host.sh" pr-state "$last_pr" </dev/null 2>/dev/null \

$ sed -n '1137,1156p' skills/plot/scripts/plot-reconcile-scan.sh | grep -n 'PR_SOURCE\|pr_reliable'
NONE - confirmed no guard
```

Both line numbers in the Design section are correct to the line.

**`--offline` and `--no-pr` really do set `PR_SOURCE=off`**, via `do_pr`:

```
258:    --no-fetch) do_fetch=0 ;;
259:    --no-pr)    do_pr=0 ;;
260:    --offline)  do_fetch=0; do_pr=0 ;;
...
501: if [ "$do_pr" = 1 ]; then
502:   load_open_pr_branches
503: else
504:   PR_SOURCE="off"   # deliberately skipped (--no-pr/--offline), not a failure
505: fi
```

**Section 2 really does honour it** — `:512` derives `pr_reliable=0` for `off`,
and `:517-520` prints the alternate header. **The header sentence is quoted
verbatim**, character for character:

```
518:  echo "PR state: skipped (--no-pr) — git merge-state only; no git-host network call."
```

Plan text: `PR state: skipped (--no-pr) — git merge-state only; no git-host network call.` — **exact match.**

**Only two host call sites exist in the whole scan** (`grep -n 'plot-host.sh'`
→ 9 hits, 7 of them comments). `:407` is guarded by `load_open_pr_branches`
being called only when `do_pr=1`. `:1156` is the sole unguarded one. So the
plan's claim that section 6 is *the* offending section is correct and complete
— it is not one of several.

**Verdict on Q1: the premise is sound.** The contradiction between a declared
flag and one section's behaviour exists today on main.

## 2. Right fix, or a symptom fix?

**Right fix, and the plan is honest that it is the smaller of two.**

Guarding `:1156` on `PR_SOURCE` makes the flag mean what its own header says.
That is the defect. The N-calls-instead-of-one issue is a separate cost problem
that exists equally when the operator *did* ask to go online, and the plan
explicitly names it, scopes it out, and says why (it needs its own measurement
of the bundled call). That split is correct — fixing the batching would not make
`--offline` honour the flag, and fixing the flag does not pretend to make the
online scan fast.

The "print a note, don't go silent" requirement is the part that makes this more
than a one-line skip, and it is justified by the section's own existing
precedent at `:1147-1149`, which I verified (see Q4).

## 3. Does `Done when` contain a non-plumbing gate?

**Yes — at least three, and they are genuinely independent.**

- *"`--offline` and `--no-pr` each make **zero** `pr-state` calls from section 6,
  asserted by counting the calls against a stub rather than by timing"* — a
  call-count against a stub cannot be satisfied by threading `PR_SOURCE` into
  the loop and ignoring it. The value must change control flow. **This is the
  load-bearing gate.**
- *"a fixture with 3 delivered plans makes 3 calls online and 0 offline, pinning
  both directions in one test"* — the two-directional form is what stops the
  lazy fix of skipping section 6 unconditionally, which would pass a
  zero-offline assertion on its own.
- *"an **online** scan's section 6 output is **byte-identical** to today's"* — a
  regression pin, not plumbing.

The explicit rejection of timing as the assertion mechanism is the right call
and deserves credit: on this estate a timing assertion would pass vacuously (see
Q4), while a call count would not.

## 4. What I could not verify, or found false

### FALSE — "2 delivered plans at 1.76 s each" on this estate

The plan writes:

> **On this estate the defect is invisible** … measured here 2026-09-17,
> **2 delivered plans at 1.76 s each**.

The count of *delivered* plans is right; the count of plans **reaching the
call** is **zero**, because both are exempted by type before `:1156`:

```
$ for f in $(grep -l '^- \*\*State:\*\* Delivered' docs/plans/*.md); do
    echo "$f :: $(grep -m1 '^- \*\*Type:\*\*' "$f")"; done
docs/plans/2026-09-15-the-skills-say-slices.md :: - **Type:** docs
docs/plans/2026-09-15-the-supervisor-log-has-a-ceiling.md :: - **Type:** infra
```

`:1143` is `case "$ptype" in docs|infra) continue ;; esac`. Replaying section 6's
own filters over the estate:

```
delivered=2 reaching_pr_state=0
SKIP (type=docs):  docs/plans/2026-09-15-the-skills-say-slices.md
SKIP (type=infra): docs/plans/2026-09-15-the-supervisor-log-has-a-ceiling.md
```

Confirmed by running the thing:

```
$ /usr/bin/time -p skills/plot/scripts/plot-reconcile-scan.sh --offline
== 6. Delivered but already released (candidate /plot-release) ==
  (none)
unreleased_delivered=0
pr_source=off
real 463.99
```

Section 6 printed `(none)` and made **no** host call. The plan's "1.76 s each"
is a per-call cost multiplied by a loop that does not execute here.

**Why this matters more than a stray number:** the plan's own Notes say

> The gate that found it was `/plot-release`'s, one day earlier and on the same
> section: section 6's docs/infra exemption had silently stopped working
> (`f5d052af`).

That commit is `HEAD~1`, merged 2026-09-16:

```
$ git log --oneline -1 f5d052aff
f5d052aff plot-reconcile: a docs plan naming a sprint stays exempt from section 6
    Measured 2026-09-16: two docs/infra plans reported as `unreleased_delivered`
```

**`f5d052af` is exactly what took this estate's reaching count from 2 to 0.**
Before it, the nine-field/eight-variable bug made `ptype` hold
`docs<US>the-sprint-name`, so `case` matched neither arm and both plans fell
through to the call. The plan cites that commit as corroborating context while
its measurement three paragraphs earlier is a pre-`f5d052af` reading presented
as current. The plan measured the estate *through the bug it names in its own
footnotes.*

### UNVERIFIABLE — the 109/82-plan reporting repository

The headline table (8.2 s/call, 82 delivered, ≈11 min, `exit=124` at 100 s) is
from a reporting repository not present here. I cannot re-derive any of it. It
is not contradicted, but per this lens's standing rule it is an uncorroborated
external citation carrying the plan's entire cost argument.

What I **can** say is that the per-call cost is in a plausible range but that
8.2 s is not this machine's figure:

```
$ for i in 1 2 3; do /usr/bin/time -p skills/plot/scripts/plot-host.sh pr-state 931; done
real 2.46
real 1.67
real 1.56
```

~1.9 s median here against the reported 8.2 s — a 4x gap. The plan's own "1.76 s"
matches my machine and not the reporting one, which suggests the two readings
came from different hosts and were tabulated as if commensurable.

### CORRECT — the `:1147` citation

The plan says *"the section's own `no PR annotation` arm says exactly that at
`:1147`."* The literal string `no PR annotation` is at **`:1149`**; `:1147` is
the first line of the two-line comment that *says exactly that*:

```
1146:  if [ -z "$prs" ]; then
1147:    # "Cannot tell" and "nothing wrong" must not look the same — that
1148:    # indistinguishability is the whole finding this section exists for.
1149:    unrel_out+="  $base — delivered, but no PR annotation → cannot resolve a version\n"
```

The plan's sentence is *"says exactly that"* — referring to the
cannot-tell/nothing-wrong principle, which is at `:1147`. **The citation is
right**, and I record it because the rubric asked and a careless reader would
call it off-by-two. Precision credit to the author.

### CORRECT — `n_unrel` initialization

The `Done when` asks that `unreleased_delivered` be distinguishable from a
measured zero. `:685` initializes `n_unrel=0` alongside twelve siblings, and the
three increment sites are `:1151`, `:1165`, `:1176`. So today an offline run and
a genuinely-clean run both emit `unreleased_delivered=0` — the gate is
addressing a real indistinguishability, not an invented one.

## 5. What the plan missed that this lens notices

**a) `--offline` is not slow because of section 6 here, and the plan's framing
invites the wrong conclusion.** My offline run took **464 s** with zero host
calls. The plan's "It does not make `--offline` mean fast" caveat is present and
correct, but it attributes the residual to "0.117 s each" per plan parse. With
292 plan files that predicts ~34 s, not 464 s. Something else dominates an
offline scan on this estate by an order of magnitude, and the plan does not know
what. That is out of scope for the fix, but it means **the pulse timeout this
plan is framed as curing may not be cured by it here** — a reader could
reasonably expect the 90 s budget to be met after this lands, and on this estate
it will not be.

**b) The fix's own test needs a fixture the estate cannot supply.** Since
`reaching_pr_state=0` here, the `3 delivered plans → 3 calls online` gate
requires a synthesized fixture with `Type:` values outside `docs|infra`. The
`Done when` says "a fixture", so the plan is not wrong — but nobody reading it
would learn that **no real plan on this estate would exercise the loop**, which
makes the fixture load-bearing rather than convenient. Worth stating so the
implementer does not try to point the test at `docs/plans/`.

**c) The interaction with `f5d052af` is a regression risk nobody has named.**
Section 6 now has two skip paths that both produce silence: the type exemption
(`:1143`, one day old) and the proposed `PR_SOURCE` guard. The plan's note text
covers only the second. If a scan is offline *and* every delivered plan is
docs/infra — which is this estate, today — the note will print while the loop
would have found nothing anyway, telling the operator something went unresolved
when nothing was pending. The note should distinguish *"I skipped N plans I
would have checked"* from *"there was nothing to check"*, or it recreates in a
new place the exact cannot-tell/nothing-wrong conflation the section exists to
prevent. **The count belongs in the note.**

---

## What would move this to proceed

1. Re-take the estate reading **on current main** and state it as
   `0 delivered plans reach the call (both exempted by type since f5d052af)`,
   replacing "2 delivered plans at 1.76 s each".
2. Either reproduce the 8.2 s / 82-plan table on a machine named in the plan, or
   mark it as a reported reading rather than a measurement.
3. Add to `Done when`: the note names **how many** plans went unresolved, so an
   offline scan over an empty delivered set does not claim a skip it did not
   make.

The defect is real, the fix is right, the gates are strong. The premise section
is one day stale in a way the plan itself has the evidence to catch.
