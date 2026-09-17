# Measurement juror — the-index-is-read-once

Position: amend

Lens: every number is a claim that can be re-taken. I re-took them. **The plan's
arithmetic survives; its corpus survey does not.** The defect is real, the fix
shape is right, and the plan is missing one property of its own data that
silently changes the output it promises to keep byte-identical.

---

## 1. The fork count reproduces. Re-derived independently.

I did not trust the plan's 130,128. I emulated the walk in pure bash — an
associative map of link→target, then replaying `symlinked_from`'s glob order and
early `return 0` per plan, counting two forks per examined link:

```
plans=297 active_links=85 delivered_links=281
active_hits=85 delivered_hits=278
forks_with_early_return=132474 ceiling=217404
plus basename forks=297  total_incl_basename=132771
```

Average probe depth, the load-independent shape behind it:

```
plans=297 avg_active_probe=72.97 avg_delivered_probe=150.04
per-plan forks = 2*(21675+44562)/297 = 446.0
```

446 forks per plan × 297 = 132,462. The plan states 130,128 at **295 plans, 83
active, 280 delivered**; I measure at **297 / 85 / 281** — the estate grew by two
plans and two links since it was written (`git log --since=2026-09-16
--diff-filter=A` counts 24 plan files added on the 17th, so the corpus is moving
under the plan). Scaled to the plan's own corpus my method lands within ~1% of
its figure. **The count is honest and the method is sound.** Same for the ceiling:
I get 217,404 against the plan's 214,170, the same 1% offset from the same
corpus drift.

Conclusion: the headline claim — a per-plan question answered by a per-plan
directory walk, costing six figures of forks — is **confirmed, not taken on
trust.**

## 2. The 37.8 ms/fork figure reproduces. It is load-dependent, and the plan says so.

Load at measurement time: `load averages: 10.07 10.48 10.37` (the plan measured
at 14.9).

```
=== 366 readlink forks ===
elapsed 16.748 s -> 45.76 ms/fork

=== 366 readlink|sed pairs = 732 forks (what the code actually does) ===
elapsed 22.851 s -> 62.43 ms per pair, 31.22 ms/fork
```

The plan's 37.8 ms sits **between my two readings** (31.2 and 45.8). It is
reproducible in the only sense that matters: the order of magnitude is stable
and the ratio argument survives. The plan's own Note — *"The 38 ms per fork is
this machine under this load, not a constant"* — is the correct framing and I
could not refute it.

**One correction to my own first reading, which I am recording because it nearly
became a false objection.** My first fork-free loop measured 2.92 ms/iter against
the plan's 0.045 ms — a 65x discrepancy that looked like a fabricated number. It
was not. It was my harness:

```
empty bash -c: 0.47509 s
empty bash -c: 0.82307 s
```

`bash -c 'true'` costs 0.48–0.82 s on this machine under load. The entire 0.868 s
I attributed to 297 loop iterations was interpreter startup. The plan's 0.045
ms/iter is credible and my apparent refutation was a measurement artefact. I
report this because a juror's wrong number is as damaging as a plan's.

## 3. `ls -l` on two directories works — and prints structure the plan never mentions.

```
docs/plans/active:
total 0
lrwxr-xr-x@ 1 jwloka  staff  49 Aug 28 22:08 a-board-names-the-repo-it-serves.md -> ../2026-08-28-a-board-names-the-repo-it-serves.md
...
docs/plans/delivered:
total 0
lrwxr-xr-x@ 1 jwloka  staff  52 Sep  2 16:05 2026-09-01-a-refused-dispatch-asks-for-a-brief.md -> ../2026-09-01-a-refused-dispatch-asks-for-a-brief.md
```

Timing, one fork, three runs: **0.2996 s / 0.1357 s / 0.5287 s** (plan claims
0.081 s — again load-dependent, again the right order). 371 output lines for 366
links: 2 dir headers, 2 `total 0` lines, 1 blank separator.

**The headers and blank line are real and the plan does not name them.** A
`while read` that keys on `*" -> "*` skips them naturally — I verified that
below — so this is a note for the implementer, not a defect in the argument.
But the plan presents a single-link sample line as if that were the whole
output shape, and it is not. **Amend to show the real two-directory output**,
including where one directory's listing ends and the next begins, so the
implementer is not surprised by it.

## 4. The parsing hazards you flagged are NOT real in this corpus. I checked all four.

```
=== A: any link NAME or TARGET containing " -> " ? ===  scanned, done   (zero)
=== B: any name with a space at all? ===               names_with_space=0
=== C: newline in a name? ===  366 glob entries vs 366 ls -1 entries (+3 headers) — none
=== D: non-symlink entries in the index dirs? ===      docs/plans/active: (none)
                                                       docs/plans/delivered: (none)
=== links pointing outside ../ ? ===                   ok (all ../*)
=== dangling links? ===                                dangling_active=0 dangling_delivered=0
```

So the `" -> "` ambiguity, the space-in-filename fixed-field problem, and the
newline case are **theoretical here and I will not manufacture an objection from
them.** Naming-wise the corpus is a dated-slug estate and cannot easily acquire
one. Worth a defensive parse, not worth blocking on.

Note the dangling-link Done-when clause is currently **unfalsifiable on this
estate**: there are zero dangling links, so "a dangling link is still reported"
cannot be proven by the before/after diff the plan proposes. That needs a
constructed fixture, which the plan does not ask for.

## 5. THE FINDING. Three plans have TWO links each, and a target-keyed map inverts the answer.

This is what the plan missed, and it bears directly on its own byte-identical
promise.

```
=== do any TWO links in one dir point at the SAME target? ===
docs/plans/delivered:
2026-09-01-a-refused-dispatch-asks-for-a-brief.md
2026-09-01-an-idle-agent-is-not-a-stalled-one.md
2026-09-03-the-board-says-slice.md
```

```
--- target 2026-09-01-a-refused-dispatch-asks-for-a-brief.md ---
   docs/plans/delivered/2026-09-01-a-refused-dispatch-asks-for-a-brief.md
   docs/plans/delivered/a-refused-dispatch-asks-for-a-brief.md
```

**281 delivered links resolve to 278 distinct targets.** That is precisely why my
`delivered_hits=278` and the plan's own reported **277** differ from the 280/281
link count — the plan *recorded the symptom in its own table* (`280 delivered
links, of which 277 resolve`) and read it as three dangling or foreign links
rather than as three duplicate pairs. There are zero dangling links. The gap is
duplication.

Why it matters, and it is not cosmetic. `symlinked_from` returns the **link
path**, and the consumers use it as a *slug source* for a remediation command:

```
797:        slug=$(basename "$in_active")
799:        drift_out+="    fix: git rm $in_active && ln -s ../$base $DELIVERED_DIR/$slug && git add -A\n"
816:        slug=$(basename "$in_delivered")
818:        drift_out+="    fix: git rm $in_delivered && ln -s ../$base $ACTIVE_DIR/$slug && git add -A\n"
```

The current code has an accidental but **defined** tie-break: glob order, first
match wins, because of the early `return 0`. A naive `map[target]=name` built
from `ls -l` is **last-write-wins** and returns the other link:

```
=== naive target-keyed map from ls -l ===
map[2026-09-01-a-refused-dispatch-asks-for-a-brief.md] = a-refused-dispatch-asks-for-a-brief.md
map[2026-09-03-the-board-says-slice.md]                = the-board-says-slice.md

=== current code (glob first-wins) ===
current[2026-09-01-a-refused-dispatch-asks-for-a-brief.md] = 2026-09-01-a-refused-dispatch-asks-for-a-brief.md
current[2026-09-03-the-board-says-slice.md]                = 2026-09-03-the-board-says-slice.md
```

**Opposite answer on all three.** Section 1's `fix:` command would name a
different link file and emit a different slug — and the plan's Done-when
explicitly requires section 1 to be **byte-identical**. The plan would fail its
own gate, on this estate, today, and the failure would look like a mystery diff
rather than an obvious bug.

`grep -in 'duplicate\|tie\|two links\|same target\|first'` over the plan:
**NO MENTION.** The plan asserts *"An index keyed only by target basename would
answer is it linked? and lose which link"* — it identified the right risk and
then stopped one step short of discovering that *which link* is genuinely
ambiguous in its own corpus.

These are not junk. `git log` shows `a-refused-dispatch-asks-for-a-brief` was
delivered, reversed, and restored — the duplicate is a scar from that
bookkeeping, which is exactly the kind of drift the reconcile scan exists to
report.

**Required amendment:** the plan must state the tie-break rule explicitly —
first in glob/sort order, matching current behaviour — and the Done-when must
name these three targets as the pin, so the implementer is forced to preserve
the ordering rather than discover it through a failing diff.

## 6. The retraction holds. I tried to break it and could not.

```
grep -c 'symlinked_from' skills/plot/scripts/plot-fleet-scan.sh  ->  0
grep -rn 'symlinked_from' (whole repo)  ->  only :681 def, :712, :713 callers
```

Three occurrences total, all inside `plot-reconcile-scan.sh`. No board caller of
`plot-reconcile-scan.sh` exists in `packages/` — every hit is a source comment,
not an invocation. **The plan's withdrawal of the board-latency claim is correct
and I confirm it.**

One thing I found that could be mistaken for a contradiction, and is not:
`plot-fleet-scan.sh:2234` has its **own** index walk in `delivered_candidates()`.
It is a different question — an mtime pre-filter over `$DELIVERED_DIR` links,
one `stat` per link, **281 stats once per run**, not per plan. It is not
`symlinked_from`, it is not quadratic, and it does not revive the board claim. I
record it because a future reader grepping for index walks will hit it and needs
to know it was examined and cleared.

## Summary of the position

Proceed on the analysis; amend before implementing.

**Confirmed by independent re-measurement:** the fork count (132,474 at today's
corpus, ~1% from the plan's figure at its own corpus), the per-fork cost (31–46
ms at load 10 against the plan's 37.8 at load 14.9), the one-fork `ls -l`
replacement, the fork-free loop, and the board retraction. The plan's habit of
stating load conditions alongside timings is what let me check it, and it is the
reason the timings survive.

**Must be amended:**

1. **The duplicate-target tie-break (blocking).** Three delivered targets carry
   two links each. A target-keyed map inverts the answer on all three and breaks
   the plan's own byte-identical gate. State the rule; pin the three names.
2. **The 281-vs-278 gap is duplication, not dangling links.** The plan's
   `280 / 277` line implies three unresolvable links. There are zero dangling
   links. Correct the interpretation — it is the same defect as (1) seen from
   the other side, and reading it wrong is how the plan missed it.
3. **Show the real `ls -l` two-directory output** — headers, `total 0`, blank
   separator — rather than one sample line.
4. **The dangling-link Done-when needs a fixture.** Zero exist on this estate,
   so the before/after diff cannot prove that clause.

Corpus counts to refresh if the plan is re-pinned: **297 plans, 85 active links,
281 delivered links, 85 and 278 resolving.**
