# Decision — HEAD attribution (ATTRIBUTION lens)

Subject: when a worker's transcript carries a `gitBranch: "HEAD"` segment, which slice does that spend belong to?
Lens: attribution. Reading position: every recorded number is eventually summed by something. The question is what each option does to that sum.

## 1. When does a HEAD segment occur, and are the two events the same?

**They are not the same event, and one of the two does not exist.**

Two code paths can leave the desk detached:

- **Between slices.** `reset_desk` (`skills/plot/scripts/plot-worker-loop.sh:937`) runs `git checkout --detach "origin/$main_branch"` at `:962` — STEP 1, the base — and then attaches the next slice's branch at `:967-968`. The comment at `:955-961` states why: the desk may not hold `$main_branch`, and nothing wants the base as a branch, it is *"a floor to stand on for one command."*
- **Mid-slice.** The agent itself detaches to baseline against main, which is this repo's own recommended practice.

The panel's round-2 text (`panel-r2.md`) treats these as two instances of one phenomenon. **They are not, and the reason is timing rather than intent.**

`reset_desk`'s detach and re-attach are two consecutive `git` calls inside one shell function. **No agent turn is emitted between them.** A transcript line carries `gitBranch` as read at the moment the turn is written, and the loop writes no turns — it is between prompts. So the between-slice detach is invisible to the transcript by construction.

**Measured, and this is the finding that decides the question.** Over 931 main-session worker transcripts under `~/.claude/projects/*plot-wt-*` and `*worktrees*`:

```
HEAD segments total                      : 45
  MID-slice (prev === next, a real branch): 37
  BETWEEN two DIFFERENT real branches     :  0
  at an EDGE (file start or end)          :  8
```

**Zero.** Not few — none. And the sequences confirm the mechanism directly; here are the real multi-branch sessions, 7 of 931:

```
feature/a-charter-bounds-… → feature/an-absent-agent-is-noticed → HEAD → feature/an-absent-agent-is-noticed
  → feature/a-delivery-verdict-names-what-it-ran → feature/auto-dispatch-asks-for-the-brief
bug/a-harness-this-machine-cannot-run-refuses → bug/a-claimed-slice-does-not-say-nobody-took-it
feature/a-slice-names-the-agent-it-needs → bug/a-jenkins-job-is-read-by-its-shape
bug/the-board-answers-on-both-loopback-families → bug/one-plan-is-one-card → feature/an-agent-declares-what-it-runs → …
```

Every hop is **branch → branch, directly**. The one HEAD in the first sequence is `an-absent-agent-is-noticed → HEAD → an-absent-agent-is-noticed` — a mid-slice baseline, returning to the same branch, not a hop.

The 8 edge cases are all `prev = START`: a session whose first turn is already detached. Every one is a `plot-idea-issue-*` desk, not a dispatch slice:

```
EDGE: prev=START | HEAD turns=28 naive=2,522,684 | next=bug/bb-capability-probe-false-negative-help
EDGE: prev=START | HEAD turns=39 naive=4,350,554 | next=idea/every-issue-renders-as-open-issue
EDGE: prev=START | HEAD turns=42 naive=1,034,804 | next=END
```

**So the answer to rubric question 1 is: a mid-slice HEAD is the only kind that exists in practice, and it is not the between-slice event at all.** The between-slice event is real in the code and leaves no record. The panel's sentence *"`reset_desk` passes through detached between slices"* is true about the code and false about the transcript, and that distinction is what the whole decision turns on.

This matters to my lens specifically: **the population that a `none` rule would exclude is not the population that motivated the rule.** `none` was proposed to avoid charging a between-slice gap to a neighbour. There is no between-slice gap. What `none` would actually exclude is 37 mid-slice baselines that unambiguously belong to the slice around them.

## 2. The distribution — how much is at stake, and is it concentrated?

Whole worker population, 931 main-session files (`agent-*` excluded per `rules/spend.ts:42-50`), 77,541 turns:

```
                              TOTAL           HEAD          share       MID-slice       share
input_tokens             10,580,220         61,955       0.5856%          61,284      0.5792%
output_tokens            26,181,828        139,553       0.5330%          93,966      0.3589%
cache_creation_input     211,933,221      1,425,365      0.6726%         563,843      0.2660%
cache_read_input       9,966,771,312     72,632,927      0.7288%      60,971,123      0.6117%

turns                        77,541            444       0.5726%             267      0.3443%
```

**Estate-wide the stake is under 0.75% on every counter.** But an estate-wide share is the wrong statistic for an attribution question, and reporting it alone is how this decision gets made badly. **The error does not land estate-wide. It lands on individual slice records**, and there it is an order of magnitude larger:

```
MID-slice HEAD as a share of the slice it interrupts:
  13.05%  head=7,106,277   slice= 47,366,306  bug/a-degraded-view-says-so-at-the-top
  10.22%  head=3,627,883   slice= 31,876,266  bug/a-monitor-ends-with-its-agent
   9.39%  head=3,728,256   slice= 35,996,560  feature/a-jenkins-build-has-a-status
   7.99%  head=3,125,692   slice= 35,996,560  feature/a-jenkins-build-has-a-status   (same slice, second gap)
   6.90%  head=1,382,164   slice= 18,650,986  bug/plans-of-equal-age-order-by-name
   …
  n=37   median=2.83%   max=13.05%   min=0.18%
```

**So it is concentrated, not spread.** 43 of 931 files (4.6%) carry any HEAD at all; within those, one slice's record would be understated by up to 13%. `feature/a-jenkins-build-has-a-status` is interrupted **twice** and would lose 17.4% of its own spend across the two gaps.

The largest single mid-slice segment is 29 turns and 7,106,277 naive tokens — larger than the *entire* recorded spend of most slices in the estate (median worker transcript is ~7 KB).

**The attribution reading of this distribution:** a 0.7% estate error is invisible and harmless in a rollup. A 13% error on one slice is exactly the size that changes which slice looks expensive — and comparing slices is the only thing a per-slice spend record is for. The sprint's Should is a per-plan rollup, so these records will be summed and they will be ranked. An option is not cheap because its aggregate error is small; it is cheap when the error cannot reorder the comparison that the record exists to support.

## 3. What each option tells a reader that is false

I take the rubric's question literally: not *which is imperfect*, but *what false sentence does a reader end up holding*.

### `none` — "a HEAD segment belongs to no slice"

**The false thing: it tells the reader that work the agent did FOR a slice was not done for it.**

37 of 37 mid-slice HEAD segments return to the branch they left. There is no ambiguity in the data about who that work served: an agent on `bug/a-degraded-view-says-so-at-the-top` checked out main to baseline a test, spent 7.1M tokens finding out whether a failure was its own, and came back. That is the slice's work. This repo tells agents to do it — the memory `a-b-a-branch-against-a-pristine-main-worktree` is standing advice, and `an-a-b-over-code-proves-nothing-when-a-fixture-varies` makes it near-mandatory before blaming your own branch.

**`none` therefore systematically under-reports the slices that followed the repo's own debugging discipline**, and by the largest margins precisely where the debugging was hardest. That is a perverse incentive encoded in a measurement: the record makes careful work look cheap.

The plan's stated defence — *"records deliberately do not sum to the run, and the plan says so plainly"* — is a defence of the **arithmetic**, and it is honest arithmetic. It is not a defence of the **attribution**, and the attribution is what is wrong. A reader who knows the records do not sum still reads `bug/a-degraded-view-says-so-at-the-top: 47.4M` and believes that is what the slice cost. It cost 54.5M.

**And the disclaimer does not travel.** This is the decisive point for my lens. The sentence *"records deliberately do not sum"* lives in the plan. The number lives in `.plot/state/`. The rollup that the sprint's Should will build reads the number. Prose in a Draft plan is not a property of a record, and no downstream consumer can consult it.

### `nearest` — "charge it to the slice it interrupts"

**The false thing: nothing, on the measured population — and a real one on a population that does not occur.**

The rule as stated ("the branch before and after it, when they match, and only orphan it when they differ") is exactly the predicate my measurement applies, and it resolves 37 of 37 mid-slice cases with the neighbours agreeing. The 0 between-different-branches cases means the orphan arm is never taken today.

The honest statement of its risk: `nearest` would be wrong if a between-slice HEAD segment existed and got charged to a neighbour. **It cannot, because the rule already refuses that case** — differing neighbours orphan. The residual risk is a hop that happens to return to the same branch, which `--restart` could produce; that is a restarted slice, whose spend still belongs to that slice.

The 8 edge cases (`prev = START`) have no left neighbour, so `nearest` orphans them. That is correct: a session that begins detached in a `plot-idea-issue-*` desk is not a dispatch slice, and charging its 4.3M tokens to whatever branch it later attached would be inventing an attribution. **`nearest`'s own rule produces the right answer for the population the other options were designed around.**

Its cost is that it is a rule with two arms and needs a fixture for both, including one arm the estate has never exercised.

### `own-record` — "write it as its own record with no branch, so the run sums exactly"

**The false thing: it tells the reader the spend is unattributable when the data attributes it.**

This is `none` with better arithmetic, and the arithmetic improvement is real: a consumer can add every record and reach the run's true total, with the unattributed portion visible rather than silently missing. As an accounting property that is genuinely stronger than `none`.

But my lens weighs *which sums get taken*, and the sum this option makes exact is **the wrong sum**. Nobody wants "what did this worker process cost" — the plan spends four paragraphs establishing that the worker is not the subject (`plot-worker-loop.sh:1044`: *"a declaration is about a BRANCH, and a worker hops… the branch it held at the time is a field rather than the subject"*). The story's unit is *cost per approved plan* (`STORY-plot-plan-economics.md`, 2026-08-27). Both sums a reader actually takes — per slice, per plan — get a branchless record they must decide what to do with, and there is no rule telling them.

**So `own-record` moves the judgement rather than making it.** Every downstream consumer re-decides whether to include branchless records, and they will not all decide the same way. That is the failure mode this repo has a name for: `plot-sprint-release.sh`'s `item_state` was a second implementation of `scoreItem` and the two had drifted on 4 of 134 items. A record that requires each reader to supply the missing rule is a rule that will be supplied differently by each reader.

It also creates a population that cannot be placed in time or space: a record with no branch, in a per-slice store, whose only honest label is *"some of this run, we will not say which part."*

## 4. Which option does the estate's vocabulary already support?

**The vocabulary supports `nearest`, and it does so by ruling the other two out rather than by naming a HEAD case.**

`DeclarationReading` (`packages/domain/src/entities/declaration.ts:78-81`):

```ts
export type DeclarationReading =
  | { read: 'declared'; declaration: Declaration }
  | { read: 'absent' }
  | { read: 'unreadable'; why: string };
```

Its docstring (`:63-77`) states the principle exactly: *"FOUR OUTCOMES, AND THE LAST TWO ARE NOT ONE… This is `PortResult`'s shape applied to a file rather than to a port: **cannot answer is not no**. This repo has twice shipped a collapse of those two."*

**The principle is about what to do when you cannot answer. It is not a licence to answer `absent` when you can.** Read it the way the codebase does:

- `absent` means *the work did not complete, whatever the exit code says* — a positive, load-bearing fact.
- `unreadable` means *something was written and cannot be believed*.

Neither describes 37 segments whose attribution is legible from the neighbours. A mid-slice HEAD is not *cannot answer*; it is an answer requiring one inference the data fully supports. **Applying the absent/unreadable vocabulary to it is the inverse error the docstring warns about** — not collapsing two answers into one, but promoting a readable fact into an unreadable category.

The same reading appears twice more, and both times against `none`:

- `plot-release-refs.sh`: **"`unknown` permits here"** — 69% of branches have no worktree, so an unaskable condition falls through rather than refusing. The estate does not let an unanswerable edge dictate the common case.
- `refs-git.ts` answers `unknown` and is declared `plot-ancestry: evidence` under `scripts/check-ancestry-decisions.sh` — precisely because *"the answer is handed on and something else decides."* A spend record is handed on to a rollup, and **there is no something-else to decide.** The rollup is arithmetic; it has no lens.

And the story already ruled on the exact trade my lens is asked to weigh, on 2026-08-29:

> **"An absent slice makes a plan's cost *incomplete*, never smaller — a partial sum is worse than none, because it looks like an answer."**
> Inherits `registry.ts:103` — *"Absent when it could not be read — never guessed."*

Read both halves. *Never guessed* forbids inventing an attribution. **Nothing here is a guess** — the neighbours are recorded, they agree in 37 of 37 cases, and the predicate is mechanical. What the decision forbids is the other thing: **a partial sum that looks like an answer.** `none` and `own-record` both produce exactly that — a slice record reading 47.4M that looks like a complete answer and is 87% of one.

`none` and `own-record` make every HEAD-carrying slice *smaller*. The story's own decision says a record may be incomplete but must never be smaller, and neither option marks the slice incomplete — they mark it complete at a reduced figure.

## 5. The commitment

`nearest`, and the measurement rather than the argument is what decides it.

The case for `none` rested on a mid-slice HEAD and a between-slice HEAD being the same event. **They are not, and the between-slice one does not appear in a transcript at all** — `reset_desk` detaches and re-attaches between prompts, and 0 of 45 HEAD segments sit between two different branches. Once that is measured, `none`'s motivating population is empty and its actual population is 37 baselines that belong to the slice around them.

On my lens's own test — complete-but-wrong against incomplete-and-says-so:

**`none` is neither.** It is incomplete and does not say so where it counts. The disclaimer is prose in a Draft plan; the number is a file in `.plot/state/` read by a rollup that cannot see the plan. An incomplete record that says so is a record carrying its own limit — `DeclarationReading`'s `absent`, `PortResult`'s `unaskable`, `plot-board-probe.sh`'s `unknown`. A number with a caveat stored somewhere else is a complete-looking record, and it is wrong by up to 13%.

**`own-record` says so, in the only place that would work — the record itself.** That is a genuine advance over `none` and I weighed it seriously. It fails on a different test: it makes the *run* sum exactly, and no reader sums runs. Both real consumers — per-slice comparison and the story's per-plan rollup — are handed a branchless row and no rule, so each supplies its own. This estate has measured what happens when two readers hold the same rule separately: `plot-sprint-release.sh` versus `scoreItem`, disagreeing on 4 of 134 items.

**`nearest` is the only option that is complete and right on the measured population**, and its orphan arm preserves everything the other two were protecting: differing neighbours orphan, and a session that starts detached orphans. It does not guess — the neighbours are recorded facts and the predicate is mechanical. It attributes.

Three conditions on the choice, and the first is a gate rather than a preference:

1. **The orphan arm ships with the rule, even though the estate has never exercised it.** Differing neighbours, and no left neighbour, both orphan. A one-arm implementation is `nearest` in name and a silent charge-to-the-left in fact, and 8 of 45 segments already take the second case.
2. **The record names how many of its turns were attributed this way** — a count, beside the four counters. That is what makes the inference auditable instead of invisible, and it is the honest-arithmetic property `own-record` was reaching for, obtained without unpinning the subject.
3. **The fixture carries the measured shape**, not the demanded one. `branch → HEAD → same branch` is the case that occurs; the plan's two-`gitBranch` fixture never reaches it, and the panel's measured maximum of five real branches per session should raise the fixture too.

One correction to the brief that the panel should carry forward: the framing that a HEAD segment can sit between slices is true of `plot-worker-loop.sh:962` and false of every transcript on this machine. The plan's `HEAD` paragraph should state the mechanism as measured — the detach leaves no turns — rather than as inferred from the code.

Choice: nearest
