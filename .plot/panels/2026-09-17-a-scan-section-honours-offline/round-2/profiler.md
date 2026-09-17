# profiler — round 2

Position: amend
profiler: amend

**The lens's question is answered and the answer is not section 6.** An offline
scan spends **91.2% of its wall clock before section 1 begins**, in a symlink
lookup that forks up to 207,000 processes. Section 6 costs **0.06 s** of a
373.58 s run. The plan's residual is no longer unexplained.

---

## 1. Did the amendment fix what round 1 found, or restate it?

**Fixed, and one of the three amendments goes further than round 1 asked.**

Round 1 reconciled to three factual amendments. All three are present:

| round 1 asked for | in the plan now | verdict |
|---|---|---|
| replace the estate measurement with `reaching_pr_state=0` and say why | `:49-61` — *"On this estate the defect is unreachable"*, with the SKIP replay and *"Zero host calls, not two"* | **fixed** |
| state the loop's test needs a synthesized fixture | `:63-67` and in `Done when` — *"synthesized because `reaching_pr_state=0` on this estate"* | **fixed** |
| scope the cure against the 464 s reading, not the 90 s budget | `:111-150` — the two-run table, then *"the honest framing is a CONTRACT fix, not a performance fix"* | **fixed, and exceeded** |

I re-derived the first independently:

```
$ for f in docs/plans/*.md; do st=$(grep -m1 '^- \*\*State:\*\*' "$f" | ...); ...
SKIP (docs): 2026-09-15-the-skills-say-slices.md
SKIP (infra): 2026-09-15-the-supervisor-log-has-a-ceiling.md
delivered=2 reaching=0
```

Confirmed. I also confirmed the defect's premise — no `PR_SOURCE` test exists
between the `while` at `:1137` and the `pr-state` call at `:1156`.

**The amendment did more than restate.** Between round 1 and now the plan
withdrew its own arithmetic (`:123-134`) and reframed itself from a performance
fix to a contract fix (`:146-150`). Round 1 asked it to scope the cure
honestly; it went on to concede the cure delivers *no* speed here, because the
calls number zero. That is the right move and it is the plan arguing against
its own title.

## 2. Did the amendment introduce a NEW false claim? Check the numbers.

**No new false claim. It removed one, and the removal is correct — I verified
the replacement independently before reading it.**

The plan now says (`:132`) *"470 ms for all 292 plans"*, replacing the ~34 s
prediction. Measured before I saw that amendment:

```
$ /usr/bin/time -p bash skills/plot/scripts/plot-plan-meta.sh docs/plans/[0-9]*.md
real 0.52 / real 0.29 / real 0.84      # three runs, ALL 292 files, one invocation
$ ... plot-plan-meta.sh <one file>
real 0.19 / real 0.07 / real 0.07      # per-INVOCATION floor
```

The old 0.117 s figure was a per-invocation floor multiplied as if it were a
per-plan cost. The scan makes **one** invocation (`:561`). The correction is
sound and my numbers bracket the plan's 470 ms.

**One claim is now stale rather than false.** `:133-134` says the unexplained
share *"is essentially the whole run"*. True when written; as of this verdict
it is explained — see answer 4. That is the amendment I am voting for.

**Two surviving numbers I could not verify and neither can the plan.** The 8.2 s
per-call and the 82-delivered backlog are the reporter's, from a repository not
present here. The plan attributes them correctly. They are unfalsifiable from
this estate and I do not dispute them.

## 3. Does the `Done when` pin the corrected behaviour?

**Yes, and it is the strongest part of the plan.** Six clauses, each falsifiable:

- zero `pr-state` calls offline, **counted against a stub rather than timed** —
  this is the right instrument, and it is the one my own measurement vindicates:
  timing would have proved nothing, because section 6 is 0.06 s either way
- the note asserted **by text**, so an empty section cannot pass
- `unreleased_delivered` distinguishable from a measured zero
- online section 6 **byte-identical** over a fixture
- a **synthesized** 3-plan fixture pinning 3 calls online / 0 offline

The anti-timing and anti-silence clauses both close gates that the estate's own
numbers would otherwise leave wide open. `gates` established the machinery
exists at `scan.test.mjs:411`. I have no amendment to offer here.

## 4. WHERE DOES THE TIME ACTUALLY GO? *(the lens's main question)*

I copied the scan to `skills/plot/scripts/zz-profile-scan.sh` — **in the scripts
directory**, because `script_dir` at `:238` resolves siblings via `BASH_SOURCE`
and a copy in `/tmp` produces an all-zero run. I inserted a timestamp emitter
before each of the 23 section headings and at exit. `skills/plot/scripts/plot-reconcile-scan.sh`
was not modified (`git diff --quiet` → clean). The copy is deleted.

### Per-section cost, `--offline`, 292 plans, load average 11.17

```
section                                          delta(s)   cumulative(s)
BEFORE 1. Phase<->symlink drift                    340.79      340.79
BEFORE 2. Merged-but-not-delivered                   0.01      340.80
BEFORE 3. Stale branches                             0.02      340.82
BEFORE 4. Concurrent-delivery check                  0.01      340.83
BEFORE 5. Needs attention                            3.26      344.10
BEFORE 6. Delivered but already released             0.06      344.15
BEFORE blocking sections end                         0.03      344.18
BEFORE 7. Uncut slices                               0.01      344.19
BEFORE 8. Prose slice names                          0.14      344.33
BEFORE 9. Unplanned sprint members                   4.49      348.82
BEFORE 10-17 (eight sections)                        0.37      349.17
BEFORE 18. Stated waits with no annotation          23.78      372.95
BEFORE 19. Unclaimed work                            0.09      373.05
BEFORE 20. Merged refs                               0.18      373.22
BEFORE 21. Desks                                     0.06      373.29
BEFORE 22. Merged without a changeset                0.29      373.58
```

Read the deltas as *the cost of everything up to that heading*. So the 340.79 s
on the first line is **the preamble plus section 1's own loop** — everything
before section 2 prints.

### The top three, and section 6 is nowhere near it

| rank | cost | share | what |
|---|---|---|---|
| **1** | **340.79 s** | **91.2%** | preamble + section 1 — the symlink lookup |
| 2 | 23.78 s | 6.4% | section 18 — one `awk` fork per live plan |
| 3 | 4.49 s | 1.2% | section 9 — sprint membership |
| — | 3.26 s | 0.9% | section 5 |
| **…** | **0.06 s** | **0.016%** | **section 6 — the plan's subject** |

**Section 6 is 19th of 23.** It is 5,680× cheaper than the top cost. Everything
from section 2 to section 22 — twenty-one sections — costs 32.8 s together,
less than a tenth of the first line.

### The operation, named

`symlinked_from` (`:675-683`), called twice per plan at `:706-707`:

```bash
symlinked_from() {                       # $1=index_dir  $2=dated_basename
  local l t
  for l in "$1"/*.md; do
    [ -L "$l" ] || continue
    t=$(readlink "$l" 2>/dev/null | sed 's|.*/||')    # <-- TWO forks, per link
    [ "$t" = "$2" ] && { echo "$l"; return 0; }
  done
  return 1
}
```

**It is quadratic, and the constant is a process fork.** 292 plans × (80 active
+ 275 delivered) links = **103,660 subshells**, each forking `readlink` *and*
`sed` — up to **207,320 processes**. An early `return 0` on a hit trims it; the
misses are the bulk and they scan the full directory.

I isolated the fork as the cause by removing only the subshell:

```
$ # same nested loop, t=${l##*/} instead of $(readlink|sed)
real 1.11
$ # same nested loop, t=$(readlink "$l" | sed "s|.*/||")   <-- the real code
real 558.10
```

**503× — the algorithm is not the problem, the fork is.** And the fix is not
even a rewrite of the traversal; one pass building a map before the loop:

```
$ declare -A MAP; for d in active delivered; do for l in "$d"/*.md; do
    [ -L "$l" ] || continue; t=$(readlink "$l"); MAP["$d|${t##*/}"]="$l"; done; done
  # then look up per plan
map entries: 352
real 0.49
```

**340.79 s → 0.49 s.** 352 forks instead of 207,320. A ~700× reduction, and the
scan still answers the same question from the same source.

Section 18's 23.78 s is the same pattern at smaller scale — one `awk`
per live plan. Same shape, 1/14th the bill.

## 5. Is this plan aimed at the right thing?

**The fix is correct and the plan's own framing is now honest about what it
does not reach. My amendment is to add the measurement it says it does not have,
because I took it.**

Three separate questions, and the plan already separates two of them:

**(a) Does `--offline` keep its promise?** No — and that is a real contract
defect, confirmed at `:1156`. The fix repairs it. **Proceed on this.** The plan's
amended framing (`:146-150`, *"a contract fix, not a performance fix"*) is
exactly right, and it reached that framing by arguing against its own title.

**(b) Would fixing section 6 help the reporter timing out at 90 s?** **On the
reporter's repository, yes — and that is the one place it helps.** They have 82
delivered plans reaching the call at 8.2 s each; removing the calls removes
~11 minutes. The plan's `exit=124` evidence puts their kill *inside* section 6.
So the cure does meet that symptom, where the symptom was reported.

**(c) Is the plan's opening symptom caused by something else HERE?** **Yes, and
now it is measured.** This estate times out offline with **zero** host calls.
The cause is not section 6, not the parser, and not the network. It is
`symlinked_from`'s 207,000 forks, and it accounts for 91.2% of the run. The
plan currently says (`:149-150`) *"a separate defect with a separate cause, and
this plan neither finds nor fixes it."* **The first half is right; the second
half is now out of date** — the cause is found, and the plan should say what it
is rather than leaving a reader to re-derive it.

**So the plan is aimed at a real thing, and it is not aimed at the thing its
title's symptom describes on this estate.** It says so. What it cannot yet say
is *what* the other thing is. It can now.

### The amendment

**One change, factual, and it does not touch the fix or the `Done when`.**

Replace the *"essentially the whole run"* / *"neither finds nor fixes it"*
sentences with the measurement:

> **The residual is measured and it is not section 6.** Instrumented 2026-09-17
> at load 11.17: an offline scan costs 373.58 s, of which **340.79 s (91.2%)**
> is spent before section 1 prints, in `symlinked_from` (`:675`). It is called
> twice per plan over both index directories — 292 × 355 = 103,660 iterations,
> each forking `readlink` and `sed`, up to 207,320 processes. Section 6 costs
> **0.06 s**, 19th of 23 sections. Replacing the per-link subshell with one map
> built in a single pass measured **0.49 s** against 340.79 s.
>
> **That is a separate plan and this one does not take it.** It is named here so
> the next reader does not re-derive it: three readers across two rounds reasoned
> about a section costing 0.016% of the run.

Then the `464 s / 348 s` table stays, and the sentence *"the spread is the
machine"* gains its companion: **the magnitude is the fork count.**

### Why amend rather than proceed

The plan is sound, the fix is right, the gates are strong. But it carries a
sentence saying its own central mystery is unsolved, and that sentence is what
sent this round's lens looking. Leaving it in ships a plan that invites a fourth
reader to repeat the first three's work on a section that costs 60 milliseconds.
**The measurement exists now. Recording it costs one paragraph and saves the
next round.**

### Why not reject

Nothing here undermines the fix. `--offline` promising no host call and making
one is a defect whatever else is slow, and the reporter's timeout *is* section 6
on their estate. The gates pin both directions. This is an amendment about what
the plan records, not about what it builds.

---

## Note for the moderator, outside the rubric

While I worked, another agent's `git add -A` swept my scratch instrumentation
file into commit `cb1cfb95c` on `main`:

```
$ git ls-files skills/plot/scripts/zz-profile-scan.sh
skills/plot/scripts/zz-profile-scan.sh
$ git log --oneline -1 -- skills/plot/scripts/zz-profile-scan.sh
cb1cfb95c plot-931: round 2 — a contract fix, not a performance fix
```

It is a 2,700-line instrumented duplicate of the scan and does not belong in the
repository. I deleted it from the working tree and left the deletion **unstaged**
rather than committing over another agent's commit. `cb1cfb95c` is **not pushed**
(`origin/main` is at `26e58241d`), so it can still be amended. The original
`plot-reconcile-scan.sh` is untouched — `git diff --quiet` is clean.
