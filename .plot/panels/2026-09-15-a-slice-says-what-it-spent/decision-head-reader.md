# Decision — `gitBranch: "HEAD"` — the READER lens

**Question:** when a worker's transcript carries a `gitBranch: "HEAD"` segment, which slice does that spend belong to?

**Reading position:** a person opens a spend record six weeks from now knowing none of this. They do not know what `reset_desk` is, that desks are cut detached, or that this panel happened. They see a file, or a board cell, with four numbers on it. Everything below is judged by what that person concludes.

---

## 1. When each HEAD segment occurs — and a mid-slice HEAD is NOT the same event as a between-slice HEAD

Two code paths put a desk on a detached `HEAD`, and only one of them is Plot's.

**Plot's own detach is `reset_desk` STEP 1**, `skills/plot/scripts/plot-worker-loop.sh:960`:

```
git -C "$wt" checkout --detach "origin/$main_branch"   # :960
git -C "$wt" checkout -b "$branch"                     # :968
```

Two adjacent statements, no agent invoked between them. The hop calls it at `:2205`, inside the `while` that asks `--next`; `run_bounded` — the agent — is not running during the hop. So **Plot's detach window contains zero agent turns**, and it therefore emits **no transcript lines at all**.

`seal_declaration` is upstream of every bit of this. `:2092` runs it *before* `--next` is asked and before `:2295` moves `$PLOT_BRANCH`, with the comment at `:2087-2090` stating the ordering rule explicitly. The declaration is written while the desk still holds the finished branch — i.e. **before** any detach.

**The other detach is the agent's own**, and it is this repo's recommended practice: an agent checks out `main` or a merge base to baseline a failing suite. That is the case my memory records as *"A worker mid-A/B looks exactly like a stalled one"*. Those turns are the agent working **on its slice**, with the working tree temporarily elsewhere.

**So the two events are not the same, and the answer to the rubric's question is: on this estate, only one of them ever produces a HEAD segment.** Plot's structural detach produces none, because nothing runs in it. Every HEAD segment that exists was produced by an agent that detached itself while holding a slice.

That is a prediction, and section 2 tests it.

## 2. The measured distribution — and the prediction holds without exception

I segmented every non-sidechain main-session turn in `~/.claude/projects/*plot-wt-*` and `*--worktrees-*` into maximal runs of equal `gitBranch`, then classified each HEAD run by its nearest real-branch neighbours.

**The whole population first** (296 dirs, 936 main-session files) — reproducing the panel's headline:

```
worker session files                : 936     (panel: 938)
  containing a HEAD segment         :  44     (panel: 44)  ✓
  carrying NO real branch at all    :   4     (panel: 4)   ✓
HEAD segments                       :  46
```

The panel's two headline counts reproduce exactly. Its framing does not.

**Classified:**

```
kind         n   turns    output   cache_read
mid-slice   37    1093    93,966   60,971,123
leading      5     543    40,174   10,697,566
only         4      88     5,413      964,238
trailing     0       0          0            0
between      0       0          0            0
```

**`between` is ZERO.** Not rare — absent. The case the panel poses as the hard one, *"the branch before and after differ"*, **does not occur once in 936 files.** That is exactly what section 1 predicted: Plot's own between-slice detach emits no turns, so there is no segment to sit between two slices.

**And the `leading`/`only` rows are not slice desks at all.** Every one of the nine files carrying them lives in a `plot-idea-issue-*` directory:

```
--worktrees-plot-idea-issue-668   (4 files)
--worktrees-plot-idea-issue-849   (2 files)
--worktrees-plot-idea-issue-850   (3 files)
```

Those are `/plot-idea` desks cut detached that never take a slice branch — a different population with no slice to charge anything to. Restricting to the 287 **slice** desks the plan is about:

```
slice desk dirs                     : 287
main-session files                  : 927
  containing a HEAD segment         :  35
HEAD segments                       :  37
    mid-slice                       :  37     ← all of them
    leading / trailing / only / between :  0
```

**Thirty-seven of thirty-seven, mid-slice.** On the population this plan governs, `nearest` is not a heuristic that usually works. It is **total**: every HEAD segment has a real branch before it and the same real branch after it.

**The stake, measured:**

```
                  all turns        HEAD turns      share
turns              262,361             1,724       0.66 %
output_tokens   26,181,828           139,553       0.53 %
cache_read   9,966,771,312        72,632,927       0.73 %
```

**Concentrated, not spread.** 35 of 927 files (3.8%) carry any HEAD at all, and the single largest segment the panel names — 74 turns, 4,792,932 cache reads, 6,257 output, `feature/an-absent-agent-is-noticed` on both sides — reproduces exactly. Within an affected slice the segment is material; across the estate it is under one percent.

**One panel claim I could not reproduce, and it matters to the question.** The panel cites *"the measured maximum is five [`gitBranch` values], twice"* as branches a worker hops between. Measured over real branches only: **8 files carry more than one real branch, maximum 5.** So the hop count stands — but it is a fact about branches, not about HEAD, and no multi-branch file produced a `between` segment.

## 3. What each option tells a reader that is false

This is my lens, so I state each as the sentence the six-weeks-later reader forms.

### `none` — "a HEAD segment belongs to no slice"

**The reader is told:** *"This slice spent 6,257 output tokens."*

**What is false:** it spent those tokens **plus** the 6,257 in the HEAD segment, on the same work, in one unbroken sitting. The agent detached to baseline against main — the repo's own recommended move — and came straight back. The record silently omits a contiguous middle of the slice's own run.

**And the falsehood is invisible.** Nothing in the record says a segment was dropped. The reader cannot tell an accurate slice from a clipped one, because the clipped one looks exactly like the accurate one. The plan's own standard is the indictment here: *"a recorded zero is indistinguishable from a free run"* (`plan:274`). `none` does not record a zero — it records a **wrong non-zero**, which is strictly worse, because a zero at least looks odd.

`none` is the only option whose error is both silent and systematically **downward**. The sprint's Should is a per-plan rollup; a rollup over these records under-reports by up to 0.73% estate-wide and by far more on the 3.8% of slices affected. Nobody checks a number that is quietly too small.

**The defence — "records deliberately do not sum to the run, and the plan says so plainly"** — fails on the reader lens specifically. Where does it say so? In the plan. The reader six weeks out is holding a record, not a plan. A caveat in a design document is not a property of the artefact, and this repo already knows that: the `DeclarationReading` precedent puts *unreadable* in the **type** rather than in a comment, "distinguished from absence in the TYPE rather than by convention" (`declaration.ts:130-134`).

### `nearest` — "charge it to the slice it interrupts"

**The reader is told:** *"This slice spent 12,514 output tokens."* True.

**What is false:** nothing, on the measured population — 37 of 37 segments have matching neighbours, and each one is the agent working on that very slice.

**The residual falsehood is about a case that has not occurred:** if a `between` segment ever appeared, `nearest` orphans it (the rule as posed only charges when before and after match), and then `nearest` degrades into `none` for that segment, inheriting `none`'s silent-omission defect for it. **That is a real limit and it is bounded to zero today.**

**The honest criticism of `nearest` is not that it lies — it is that it looks like a guess.** A reader who learns the rule may ask "why is a detached segment charged to a branch it does not name?" The answer is good — the agent was on that slice, the detach was its own — but the record does not carry the answer.

### `own-record` — "write it as its own record with no branch"

**The reader is told:** *"Slice X spent 6,257. Also: a record with no branch spent 6,257."*

**What is false:** the implicature that these are two things. They are one agent, one slice, one continuous piece of work, split across two rows because a working-tree checkout changed mid-flight. The reader's natural conclusion — "some unattributed overhead happened alongside my slice" — is wrong in substance. The 4.79M cache reads were the slice being baselined, not overhead beside it.

**And it creates a row nobody can act on.** The plan's whole purpose is a number a person can place: *"a record that is silent about either [subject] is a number nobody can place"* (`plan:145`). `own-record` manufactures, by design, records that name no branch — precisely the shape `seal_declaration` **refuses** at `:1013-1016`:

> *"NO BRANCH, NO DECLARATION. The declaration is ABOUT a branch, so one that names none cannot be attributed and the domain's parse refuses it. Writing an unattributable file would be worse than the absence it replaces."*

And `DeclarationSchema.branch` is `z.string().min(1)` (`declaration.ts:35`). The estate's existing record type **cannot express a branchless record**, and its author wrote down why.

**`own-record` buys "the run sums exactly."** On the measured data it buys that at 0.66% of turns, for a reader who has no way to sum a run in the first place — the records are per-slice and machine-local, and there is no run-level artefact to reconcile against. It solves an accounting problem no reader has, by creating rows the repo's own vocabulary calls unattributable.

## 4. Which option the estate's vocabulary already supports

`DeclarationReading` (`declaration.ts:78-81`) is the settled precedent the panel itself names, and it answers a **different** question than the three options do:

```ts
export type DeclarationReading =
  | { read: 'declared'; declaration: Declaration }
  | { read: 'absent' }
  | { read: 'unreadable'; why: string };
```

**Read it carefully: the three arms are about whether a reading could be TAKEN, not about how attributed spend is APPORTIONED.** `absent` means nobody wrote a file; `unreadable` means bytes nobody can believe. Neither is "spend that happened and belongs to no one."

**That is the finding.** "Absent is not false" — the repo's habit the lens asks me to weigh — is a rule about **legible absence of a measurement**. It licenses `null` over `0` when a transcript cannot be read (`spend.ts:52-57`: *"Null is how a caller says the transcript was missing… never zero"*). It does **not** license inventing a fourth arm for measured tokens whose subject is structurally known.

**So the vocabulary supports `nearest`, and rules the other two out in different ways:**

- **`own-record` needs a shape the estate refuses.** A branchless record is exactly what `seal_declaration:1013` and `DeclarationSchema.branch.min(1)` forbid. Adopting it means widening the record type to admit the one thing the existing type was deliberately narrowed against.
- **`none` inverts the habit it claims.** The habit says *make absence legible*. `none` makes an **omission invisible** — the slice's number simply reads lower, with nothing marking the gap. Absence made illegible is the opposite of the precedent, not an application of it.
- **`nearest` needs no new vocabulary at all.** Every record names a branch, every record is attributed, the `Declaration` shape is unchanged, and nothing gains an arm.

**And there is a closer precedent than `DeclarationReading`.** `spend.ts:42-50` settles the sibling question — *which session?* — and settles it by **naming a rule and refusing a guess**: read per session, and *"a caller that cannot name the session must pass `null` here rather than reach for the newest file."* It does not invent a "session-less spend" record for turns it cannot join. It joins where the join is sound and reports nothing where it is not. `nearest` is that same shape: join where the neighbours agree (37/37), and report nothing — not a phantom row — where they would not.

## 5. Which is hardest to misread

Ranked by what my reader concludes, worst first:

**`none` is the easiest to misread**, because misreading it requires no error on the reader's part. They read a number as the slice's cost; it is presented as the slice's cost; it is not the slice's cost. There is no cue, no arm, no null. The plan's own sentence — *"wrong in the direction nobody checks"* (`plan:274`) — describes `none` more precisely than it describes the zero it was written about.

**`own-record` is second.** It cannot be misread as to its total, and that is its whole merit. But it is easy to misread as to its **meaning**: an unattributed row invites "overhead" when the truth is "the same slice, detached." It trades a silent undercount for a visible misattribution, and adds a row type the repo refuses elsewhere.

**`nearest` is hardest to misread**, and the reason is blunt: on the measured population there is nothing to misread. Every record names its branch, every token is charged to the slice that actually incurred it, and the sum over the records equals the run. The reader forms one sentence — *"this slice spent this much"* — and it is true.

**The residual honesty obligation is small and I name it.** `nearest` should be written down as a rule in the record's own documentation — *a detached segment between two turns of the same branch is that branch's* — and the fixture should carry the `branch → HEAD → branch` shape rather than only the two-`gitBranch` hop the plan currently demands. And if a `between` segment ever occurs, it must be dropped **loudly**, not silently: that is where the `DeclarationReading` habit genuinely applies, and it costs a counter, not a record type.

**One thing I will not pretend.** `nearest` charges a segment to a branch the transcript does not name. A reader who inspects the raw transcript will see `HEAD` and see the record say `feature/x`. That is a real surprise, and it is why the rule must be written down rather than merely implemented. But a surprising true number beats an unsurprising false one, and on 37 of 37 segments the number is true.

---

## Verdict

`none` is defensible in a design document and indefensible in the hands of a reader: it drops a contiguous middle of a slice's own run with no cue that anything was dropped, and it errs downward, which is the direction the sprint's rollup will never audit.

`own-record` sums exactly and buys that by manufacturing records naming no branch — the exact artefact `seal_declaration:1013` refuses and `DeclarationSchema` cannot type — to solve a reconciliation problem no reader on this estate can perform.

`nearest` is correct on 37 of 37 measured segments, needs no new vocabulary, keeps every record attributable, and makes the records sum to the run anyway. Its failure mode is a case that has never occurred, and when it occurs it degrades to reporting nothing rather than to reporting something false.

The estate's habit is not *make every token appear somewhere*. It is *never state a number whose subject you cannot name*. `nearest` is the only option that satisfies it without inventing a subject.

Choice: nearest
