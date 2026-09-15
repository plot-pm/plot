# HEAD attribution — the simplicity lens

Subject: which slice a `gitBranch: "HEAD"` segment's spend belongs to.
Lens: simplicity. Reading position: this feature has no consumer today. Every rule it carries must be written, tested, fixtured, explained and maintained before anything reads it. The question is the cheapest option that is not a lie.

## 1. When a HEAD segment occurs, and whether the two events are one

Two code paths can leave `gitBranch: "HEAD"` in a worker transcript, and they are NOT the same event.

**The between-slice detach.** `plot-worker-loop.sh:962` — `reset_desk` STEP 1 is `git checkout --detach "origin/$main_branch"`, and the comment at `:958-960` gives the reason: the desk may not hold `$main_branch`, and nothing wants the base as a branch. `:968-969` immediately attaches the slice's branch. So the desk passes through detached for **the duration of two git commands**, with no agent turn in between.

The ordering is stated at `:2088-2092`: `seal_declaration` runs *before* `--next` is asked and before any hop moves `$PLOT_BRANCH`. Between the seal and `reset_desk` the loop blocks in `wait_for_work` (`:2196-2202`) — an idle poll, not a prompt. **No turn is produced in the detached window**, and my measurement confirms it exactly (section 2: `betweenSlice = 0` of 55 segments).

**The mid-slice detach.** An agent, while holding its slice, checks out main to take a baseline — this repo's own recommended practice, and my own memory index carries it twice (`a-b-a-branch-against-a-pristine-main-worktree`, `verify-an-artifact-against-a-pristine-build`). Every turn it takes while detached reads `HEAD`. This is real work, done **for** the slice, by the agent the slice was handed to.

**Answer to the rubric: they are not the same event, and only one of them produces spend.** The between-slice detach is a two-command window that generates no turns at all. Every HEAD segment carrying tokens is the mid-slice case. This matters enormously to the cost side of the decision, and the panel's framing — *"a HEAD segment is not a branch that ran"* (panel-r2) — is true of the event that produces no data and false of the event that produces all of it.

## 2. The distribution, measured over the population

Script: `/tmp/head-measure.mjs`, `/tmp/head-detail.mjs`, `/tmp/head-nearest.mjs`. Corpus: `~/.claude/projects/*plot-wt-*` and `*worktrees*`, 290 directories, **2,696 session files**, every assistant turn carrying a `usage` block, collapsed into consecutive-`gitBranch` runs.

```
files                                    2,696
  containing a HEAD segment                 53
  carrying NO real branch at all            14
HEAD segments                                55
tokens in HEAD segments             74,451,153
tokens in all segments          10,545,804,264
HEAD share of four-counter total         0.706%
turns in HEAD segments                     463  of 90,086 (0.51%)
```

**The shape histogram is the finding** (B = real branch, H = HEAD, ∅ = no branch field):

```
  31  BHB      mid-slice detach, returning to the SAME branch
  14  H        whole file is HEAD — no real branch anywhere
   4  HB       leading HEAD, then a branch
   2  BHBHB    two mid-slice detaches, same branch each time
   1  BBHBBB   mid-slice, same branch either side
   1  BHBB     mid-slice, same branch either side
```

Classified by the `nearest` rule's own predicate — does the branch before equal the branch after:

```
neighbours AGREE     37 segments   61,690,216 tokens   (82.9% of HEAD spend)
neighbours DISAGREE   0 segments            0 tokens
at a file boundary   18 segments   12,760,937 tokens   (17.1% of HEAD spend)
```

**Zero. Not one HEAD segment in 2,696 files sits between two different branches.** The case `nearest` was designed to orphan does not occur on this estate. And the `H`-only files — 14 of them, 12.8M tokens — are not a hop artefact either: they are runs that never attached a branch at all (free agents cut detached by `plot-dispatch.sh --start`, prompts that ended before a checkout).

**Concentration:** one file holds 12.5% of all HEAD spend; the top three hold 31.2%. 52 files carry any at all, out of 2,696. So the stake is **0.7% of estate spend, concentrated in ~2% of files** — and the single largest instance the panel names (17 turns, 4.79M cache reads) is a `BHB` in a 6-segment file whose neighbours agree.

**What this costs a reader.** Of 53 files with a HEAD segment, 39 have a single real branch. For those files the whole question is decorative: the run has one slice, and whether the HEAD tokens join it or sit outside changes one number by at most a few percent, on a record nothing reads yet.

## 3. What each option tells a reader that is false

**`none`.** Tells the reader: *these four counters are what the turns naming this branch carried.* That is true. The falsehood is one of **omission and only if the reader assumes closure** — a person summing every record for a run and expecting the transcript total gets 99.3% of it. The plan says so plainly, which converts the omission into a stated limit. Residual falsehood: **none that the record asserts.** A slice that detached to baseline for 17 turns under-reports what the agent did for it, and a reader told "records deliberately do not sum" cannot tell whether the gap was that slice's work or another's.

**`nearest`.** Tells the reader: *this slice's record includes turns whose `gitBranch` did not name it, on the inference that an agent returning to the same branch never left its slice.* Measured, the inference holds 37 times and fails 0. The falsehood is **conditional and undetectable**: if an agent ever does hop A → detach → B (not observed here, and `reset_desk` makes it structurally unlikely since it attaches immediately), the rule silently charges A. Residual falsehood: **a claim the record cannot support on its own bytes**, correct today by measurement rather than by construction.

**`own-record`.** Tells the reader: *a slice with no branch spent this.* That is the false one, and it is false **by construction rather than by circumstance**. A record whose subject field is empty is not a slice record — the estate's own `DeclarationSchema` refuses exactly this shape (`packages/domain/src/entities/declaration.ts:35`, `branch: z.string().min(1)`), and `seal_declaration` refuses to write one (`plot-worker-loop.sh:1014-1015`: *"NO BRANCH, NO DECLARATION … Writing an unattributable file would be worse than the absence it replaces"*). Worse: it manufactures an appearance of closure. The run sums exactly, so a reader reasonably concludes the accounting is complete — while 17 turns of real work done *for* a slice sit in a bucket labelled *belongs to nobody*. **Summing exactly is precisely what makes it a lie**: it buys arithmetic closure at the price of semantic truth, and the arithmetic is what a reader checks.

## 4. Which vocabulary the estate already carries

`DeclarationReading` (`declaration.ts:78-81`):

```ts
export type DeclarationReading =
  | { read: 'declared'; declaration: Declaration }
  | { read: 'absent' }
  | { read: 'unreadable'; why: string };
```

Its docstring (`:65-76`) states the rule this estate applies everywhere: *"`absent` is a desk with no declaration — the load-bearing case … Reporting that as `absent` would claim a measurement nobody made"*, and *"cannot answer is not no. This repo has twice shipped a collapse of those two."* The same shape recurs at `ports/tracker.ts:125` (*"A REPOSITORY WITH NO TRACKER ANSWERS `unaskable`, NEVER `written`"*), `ports/build.ts:66`, `entities/pr.ts:15`, `worktree.ts:82`.

**The estate's move, every time, is to make the absence a named value and refuse to invent a subject for it.** Read against the three options:

- `none` IS that move. A HEAD segment is spend whose subject cannot be answered; the record does not answer it, and the plan says so. The unaccounted portion is legible as *unattributed*, which is `absent` applied to an attribution.
- `own-record` is the collapse the docstring names. It takes *cannot answer* and writes a record — a positive artefact asserting a subject — which is the `absent`-reported-as-declared error in the one direction this codebase has twice been burnt by. It also needs a record type whose `branch` is nullable, which is a schema the estate has explicitly refused.
- `nearest` is not in this vocabulary at all. `DeclarationReading` has no *inferred* arm, and none of the ports carry one. The estate's aversion is documented and repeated: `plot-deliverable-search.sh` refuses a term "by measurement and never by a proxy for one"; `plot-boardctl.sh:501` names a stop that would be "a guess"; `plot-fleetctl.sh:578` — *"`plot-dispatch --stop` takes a branch and refuses to guess"*; `plot-host.sh:1966` — *"a guess as a measurement. `unknown` is the honest word."* `plot-open-pr.sh`'s whole design is a refusal to take a title from a heuristic.

**So `none` is the only option this estate's vocabulary already supports.** `own-record` needs a new shape; `nearest` needs a new category of answer the codebase has spent a dozen headers arguing against.

## 5. The simplicity accounting

Cost of each, in the units this lens is asked to count — rules to implement, fixtures to build, gates to maintain, prose to keep true.

**`none`.** One predicate: `turn.gitBranch === <the branch being sealed>`. It is the filter an implementer writes anyway, unthinkingly, before ever hearing the word HEAD. Fixture: a transcript with `BHB` where the record counts B's turns and not H's — one file, and it is a strict subset of the two-`gitBranch` fixture the plan already demands. Prose: one sentence in the plan, already drafted. Gate: the same key-set/value assertion the fixture carries. **Marginal cost over the naive implementation: one fixture and one sentence.**

**`nearest`.** Needs a segmenter (collapse consecutive turns into runs), a lookahead (the segment *after* the HEAD run, which the sealing worker cannot see — it is sealing now and the next branch is not yet chosen), a same-branch comparison, and an orphan path for the disagreeing case. **The lookahead is fatal on its own terms:** `seal_declaration` runs at `:2092`, *before* `--next` is asked at `:2196`. At the moment the record is written **the "branch after" does not exist yet**. Implementing `nearest` at the plan's own chosen write site requires either deferring the record past the hop — which destroys the subject argument the whole plan rests on — or treating "the segment after" as "the rest of the file", which is a different rule wearing the same name. Add: fixtures for agree, disagree and boundary; a test for the orphan path that **cannot be built from real data** because the disagreeing case has never occurred; and a paragraph of prose explaining a heuristic to every future reader. **Cost: a segmenter, an impossible lookahead, three fixtures, one untestable-from-life branch, and a permanent explanation.** For 0.7% of spend, of which the disagreeing case is 0.0%.

**`own-record`.** Needs a nullable-subject record type — against `DeclarationSchema`'s `min(1)` and `seal_declaration`'s explicit refusal — plus a write site that has no natural trigger (nothing "finishes" the unattributed portion; the worker would have to write it at exit, which is the per-worker event the plan spent a whole panel round eliminating). Then a reader-side rule for rendering a record with no subject, a board decision about where such a row goes, and the honesty prose explaining that a record which sums exactly is not a record of slices. **Cost: a new schema shape the estate refuses, a new write site on the exit path the plan deliberately abandoned, and a rendering question for a consumer that does not exist.**

**Is `nearest` a heuristic this estate would accept?** No, and the measurement is what settles it rather than the taste. A heuristic earns its keep when the alternative loses information a reader needs. Here the alternative loses 0.7%, stated; the heuristic's distinguishing case — neighbours disagreeing — occurs **zero times in 2,696 files**, so the machinery that makes `nearest` more than a rename would never execute. A rule whose branch has never been taken is a rule nobody can maintain: the first person to change it has no failing case to reason from.

**Does `own-record` invent a shape nobody asked for?** Yes, twice over. Nothing reads any of these records yet, and `own-record` is the only option that adds a *second kind* of record before the first kind has a consumer. The property it buys — exact summation — is a property no stated requirement asks for, and the `Done when` list does not mention it.

## The one honest reservation

`none` does under-report a slice that baselined against main mid-run, and 82.9% of HEAD spend is that shape. A future consumer comparing two slices, one of which detached to baseline, sees the careful one as cheaper. That is a real cost, and I record it rather than argue it away.

It does not change the choice, for two reasons. First, the direction: `none` under-claims, which is the safe direction for a number whose danger the plan itself names (*"Zero is the dangerous answer here"*) — a slice reporting less than it spent is a smaller error than one reporting another slice's spend as its own. Second, and decisively for this lens: if that under-reporting ever bites a real consumer, `nearest` can be added then, **against a failing case**, by a person who can see what it costs them. Adding it now means building an untestable branch, a lookahead that does not fit the write site, and a permanent heuristic — to fix a complaint nobody has made about a record nobody reads.

Do the least that is honest. The least is the filter every implementer writes anyway, plus a sentence saying what it leaves out.

Choice: none
