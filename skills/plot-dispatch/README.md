# plot-dispatch — developer notes

Worktree fan-out for wave-structured plans. `SKILL.md` is the agent-facing
instruction; this file is why it looks the way it does.

Design plan: `docs/plans/2026-08-14-parallel-agent-fleet.md` (Stage 3).

## The only script in the fleet that writes

`plot-fleet-scan.sh` and `plot-reconcile-scan.sh` are strictly read-only.
`plot-dispatch.sh` creates worktrees, pushes claim refs, and starts processes.
Everything it writes is therefore either **idempotent or refused**:

| Write | Safety |
|-------|--------|
| Claim ref push | Rejected if the branch exists — that rejection *is* the lock |
| Worktree creation | Existing worktrees are adopted, never duplicated |
| Worker start | Only with an explicit `Worker command` in Plot Config |
| Deletion | Never. Cleanup belongs to `/plot-reconcile` |

A dispatcher that dies halfway through a fan-out is safe to re-run. The
idempotence test holds that line.

## The brief is written by the SKILL, never by the script

A prepared worktree is not work handed over. The hand-off brief — which
alternatives the plan already rejected, and what killed them — is produced by
`/plot-implement`, and dispatch skipped that step entirely: `plot-dispatch.sh`
contained zero occurrences of "brief". Every fan-out was completed by a human
writing one afterwards, and on 2026-08-17 three rows sat in WORKING with a
pulsing dot while nobody worked on any of them.

**The caller is `SKILL.md`, one layer up from the script**, and the plan's own
first draft got this backwards. Two independent reasons:

- **No script in this repo invokes a skill**, and that is the Manifesto's
  direction rather than an omission — *skills interpret and adapt; scripts
  collect and report*. A brief is interpretation.
- **Bash cannot reach a skill at all.** Skills exist inside an agent session;
  there is no command to call. The idea is not merely wrong-layered but
  impossible.

So the skill invokes `/plot-implement` per dispatched branch, and there is
exactly **one** definition of what an implementer needs to know. A template
string in the dispatcher would be a second one, drifting from the first the way
every duplicated rule here has — the eligible-note string became a shared
constant for exactly this reason.

`test/reconcile/dispatch.test.mjs` pins it: the script must contain no skill
invocation. The assertion looks for a skill name in **command position** rather
than anywhere in the file, because the script legitimately *tells a human* to
run one (`"Review it, then: /plot-approve <slug>"`) — a mention is not a call,
and a naive grep would flag the advice as the violation.

### `brief=missing` in the summary is a constant

A direct script call cannot write a brief, so the summary says so rather than
refusing:

```
summary: dispatched=3 reused=0 skipped=1 started=3 brief=missing worker=configured
```

It reports the script's own reach, not the outcome of the dispatch — if the
skill's step ran, a brief exists despite this field. **Refusing would be a gate
in the wrong place:** `--dry-run` and `--status` are the normal way to look
before leaping (this repo used the bare script five times in one evening), and a
gate that blocks looking-before-leaping blocks the wrong thing. `--no-start`
suppresses workers, not briefs.

## The summary says WHY nothing started

`started=0` was always in the footer. The reason — *no `Worker command`
configured* — was printed by `start_worker`, **per branch**, after the fan-out
had already happened. On 2026-08-17 it was printed and missed five times:
worktrees sat claimed with nobody working on them, and the last line a caller
read said `started=0` with nothing beside it.

So the fact travels **twice**, and both live in the summary block:

```
2 worktrees prepared, 0 workers started, no `Worker command` configured
summary: dispatched=2 reused=0 skipped=0 started=0 brief=missing worker=unconfigured
```

**The footer stays pure `key=value`**, terminating the output, as every footer
in this repo does — consumers read that one line and never the prose. The prose
sits *above* it, the way the failed-booking note already does. Putting the
sentence into the footer would have made the reason readable and the footer
unparseable; putting it only in the footer would have made it parseable and
unreadable.

`worker=` has four values, and collapsing any two would re-create this branch's
own defect — one label over states whose actions differ:

| Value | Means | What to do |
|---|---|---|
| `configured` | a `Worker command` exists | nothing; watch the logs |
| `unconfigured` | nobody has been asked | ask (the skill's step 3) |
| `declined` | `Worker command: none` | nothing; this repo starts them by hand |
| `suppressed` | `--no-start` | nothing; exactly what was asked for |

**`declined` is not `unconfigured`.** `plot-config.sh` returns the default for
both a missing key and an empty one, so an empty answer written as a blank value
would be indistinguishable from never having asked — and the skill would ask
again at every fan-out. `none` is the repo's established sentinel for a
deliberate absence (`Implementation home: none`), and it is what makes *"I start
them myself"* a recordable answer rather than a deferral. The script never runs
it: a worker per branch failing with `none: command not found` would turn a
decision into N crashes.

**A dry run explains nothing.** It starts nothing by construction, so *"0 workers
started"* there is true and carries no information — and a line that always
prints is a line nobody reads on the run where it matters. Only `worker=` travels.

**`--no-start` was not touched.** Its zero is reported as a choice, not a gap.
The defect was never that dispatch obeyed the flag; it was that nothing
downstream noticed the result.

## The question belongs to the skill, and to the first dispatch

`Worker command` is deliberately unset by default — Plot hardcodes no agent
tooling (Principle 5). What was missing is that **nothing told the operator they
were one config line away** from an automatic fan-out.

Three placements, and only one survives:

- **Not in `plot-dispatch.sh`.** A bash script cannot put a question to a human
  inside an agent session, and this repo's direction is that scripts collect and
  report while skills interpret. The plan's own first draft had it here; round 1
  corrected it. `test/reconcile/dispatch.test.mjs` pins that the script neither
  invokes a skill nor prompts.
- **Not at `/plot-init`.** Adoption runs long before anyone fans out work, often
  before the repo has a second branch, so the question arrives about a need the
  answerer does not have. It gets a shrug, the key is written empty, and nobody
  revisits it — **an answered-and-wrong config is harder to fix than a missing
  one**, because nothing later notices it was never really decided. A test
  asserts `plot-init/SKILL.md` never mentions the key.
- **At the first dispatch**, where the consequence is concrete: *these branches
  are about to be prepared and nobody will start them.*

**It asks; it never suggests.** No example command in the prompt — an example
becomes a template, and then Plot has effectively hardcoded a tool it is not
supposed to know. The problem was never *which* command. The `Configuration`
section of `SKILL.md` still documents the format, and that is a different
audience: someone reading it came looking, someone being asked did not.

## Eligibility is not decided here

The wave arithmetic lives in `plot-fleet-scan.sh`. Dispatch asks and acts on the
answer. Keeping the rule in exactly one place is why a blocked wave cannot be
fanned out by accident — there is no second implementation to drift.

## Two query modes, and why both exist

- **`--next`** — one branch, for a worker about to claim it. Pull semantics: the
  answer changes as claims land, so a list computed up front would go stale
  mid-fan-out.
- **`--list-eligible`** — every claimable branch. Only for `--dry-run`, which
  changes nothing and therefore *cannot* go stale.

The first draft parsed the human report with awk to get the list. That was
wrong for the same reason the footer contract exists: no consumer should ever
parse the prose. `--list-eligible` was added instead.

Note the dry-run trap this avoids: looping `--next` without claiming returns the
same branch forever, because nothing is ever taken.

## Worktree layout

Worktrees are **siblings** of the repo (`../plot-wt-<suffix>`), never nested. A
worktree inside the repo shows up in its own `git status` and in every glob.

Plot was already written for this world — `plot/SKILL.md` has always said
"never check out `main` locally... essential for worktree-based workflows" —
but nothing created worktrees until now. The safety discipline predated the
feature by a long way.

## Detached workers

Workers are started with `nohup`, detached, one per worktree, logging to
`.plot-worker.log`. The command is backgrounded inside its wrapper so the
wrapper can record the **agent's** pid — the process the command runs — in
`.plot-worker.pid`; the wrapper's own pid lives in `.plot-worker.wrapper.pid`,
where it survives to record the run's exit code in `.plot-worker.exit`. The
split fixes a panel bug: recording the wrapper's pid named the dispatcher's
shell, so every field the panel showed described the wrong process. `--stop`
kills the agent by `.plot-worker.pid`; the wrapper then writes the exit code.

Detached was a deliberate choice over Task-style subagents of the dispatching
session. It settles three things at once:

1. The fleet **outlives the dispatching session** — close the laptop, work
   continues. Subagents would die with their parent.
2. `/plot-dispatch` is a **command, not a session**. It starts processes and
   returns.
3. **The reaper becomes load-bearing.** Detached processes die without telling
   anyone, so `/plot-reconcile` must be able to spot an abandoned claim. That
   is Stage 4, and it is not optional.

The command itself is configuration (`Worker command`), because "how do I run
an agent headless" is a per-project, per-tool answer that Plot must not
hardcode (Principle 5). Without the key, worktrees are prepared and the human
starts them — a useful mode in its own right.

## Why fan-out is human-paced

Monitoring is mechanical; committing to N parallel agents is a decision with
real cost — tokens, and N PRs someone must review. The Pacing model in the
manifesto already sorts steps this way, and fan-out sits with approval and
release, not with the automatable transitions.

Hence: `--dry-run` first, ask for a count, `--max` to honour it. The skill
deliberately does not default to "all eligible".

## What is in flight, and why it is only half a comparison

Before creating a worktree, dispatch prints which other branches already hold
which files:

```
would dispatch feature/agent-view-phase-ui → …
  in flight: bug/board-shows-staleness holds App.tsx, AgentList.tsx
```

Waves are a **within-plan** ordering; collisions are **across plans**, and no
plan can declare them alone. On 2026-08-16 `plot-fleet-scan.sh --next`
correctly offered a branch whose file another plan's agent had open, twice
within an hour, and both times a human supplied the missing check by hand from
five commands.

**Local refs and worktrees, not the remote.** This is the one place the
refs-are-truth principle bends, and the reason is measured: the collision that
blocked a dispatch that evening lived in an **unpushed commit** — committed,
clean worktree, the remote ref holding only the claim. Uncommitted work is
invisible to refs entirely. Worktrees share one ref database, so `git rev-parse`
answers from the main repo for a branch checked out elsewhere; `git worktree
list` plus `git status` supplies the rest. That is sound rather than a violation
because dispatch is inherently machine-specific — it creates the worktrees here,
and a check that ignored what this machine knows would be blind exactly where it
acts.

Each branch is diffed against **its own merge-base**, not `origin/<main>`. A
rebased branch is not behind main, and diffing against the tip would attribute
every commit it picked up from main to the branch itself — on a busy day, the
whole repo.

`skills/plot/scripts/board/board-server.mjs` is excluded. Every board branch
rebuilds it, so including it would make every board pair look like a collision:
precisely the noise `.gitattributes -merge` exists to remove.

**The report is bounded — at most 8 branches, at most 6 files each.** Found by
running this against the real repo rather than a fixture: the first version
printed 13 branches under a single candidate, one of them naming 18 paths. That
is the same "ignored by the third time" failure the design warns about, arriving
as *volume* rather than as false positives. Both caps are plain truncation with
the remainder counted (`(+4 more)`, `…and 5 more branches`) — never a judgment
about which branch or file matters, because nothing here can know that, and
pretending to would be the candidate-side prediction this design refuses. The
overflow line names `plot-fleet` as where the full picture lives.

### Two designs that were tried on paper and killed by measurement

Both look like the obvious answer, so they are recorded here rather than merely
avoided.

**`git merge-tree` cannot answer this question.** It compares two *existing*
commits, and dispatch **creates** the candidate branch — at check time it is
identical to the default branch, so the comparison reports *clean* for every
candidate, forever. A check that always passes is worse than no check: it turns
a known gap into a false assurance. `merge-tree` still earns its place where
both commits exist — a re-dispatch (`reused`) and `plot-merge-queue`, which
keeps that job.

**A `Touches:` field per branch would fire on nearly every pair.** The real
scope guards in existing briefs are `packages/board/**`,
`packages/board/src/app/**` and `plot-fleet-scan.sh` — the first *contains* the
second, so two branches that ran in parallel without touching one another would
read as colliding. Three of four briefs use `**` globs, so the false positive is
the normal case, not the corner. It would also rest on an unverified
self-declaration: estimated while planning, never checked against what the
branch writes, and phrased broadly enough not to be a nuisance — which is what
makes it useless. A comparison is only as good as its weaker half.

So dispatch reports the **measured side only** and, *for shared files*,
**refuses nothing**. An earlier draft skipped colliding candidates; that only
makes sense with a prediction worth trusting, and a skip built on this
measurement alone would have blocked pairs that ran fine.

### Where it does refuse: the held-branch gate

One thing on this measured side *is* a refusal, and the difference is exactly
the one this section is about. A file two branches share is a **prediction**
about work that has not happened. A worktree that exists for the **candidate
itself**, holding commits that have not landed, is a **measurement** of work that
already has — somebody is at that desk, or was.

```
skipped feature/the-row-carries-its-verdict (held — worktree exists with unmerged work)
  worktree: ../plot-wt-feature-the-row-carries-its-verdict
```

Measured on 2026-08-20: `--dry-run` reported `claimed=0` across a fleet with
four live agents and offered `feature/the-row-carries-its-verdict` and
`feature/reconcile-calls-the-index-advisory` — both implemented, tested and
green — as dispatchable. `plot-fleet-scan.sh` derives every state from
`origin/<branch>`, and neither branch had a remote ref: one local commit each,
never pushed. No remote ref, no claim; no claim, `eligible`. The scan is right
about what it reads, and the worktree is on the other side of the machine.

Dispatch is the only component that can catch this, for the reason the section
above gives: it reads local refs and worktrees because it *creates* worktrees on
this machine. The evidence was already being collected — it had simply never
been asked this question.

Why a gate rather than a rule: "always dispatch through `plot-dispatch.sh` so
the claim ref exists" was violated four times in one evening by an operator who
had read it that evening. *Did I claim this?* is answerable without doing it.

Two shapes count as unlanded, and the second was found only by running the gate
against this repo after the first was written and green:

- **Commits not in the default branch** — the measured case above.
- **Uncommitted changes**, with no commit at all. A worktree cut minutes ago
  points at whatever main was then, so `--is-ancestor` calls it *landed*,
  identically to a merged leftover — `ahead=0, behind=N` for both, and no walk
  of the history separates them. `plot-wt-a-branch-row-carries-its-link` held
  six modified files for a live agent in exactly this shape. Only the files
  distinguish it, so the working tree is checked first.

The worktree is located by **asking git which one holds the branch**, never by
rebuilding the path from the branch name. A first version did the latter and
missed that same six-file worktree: every hand-made worktree on the machine
drops the branch *type*, so `bug/a-branch-row-carries-its-link` lived in
`plot-wt-a-branch-row-carries-its-link` where dispatch's flattening says
`plot-wt-bug-a-branch-row-carries-its-link`. The failure landed in the worst
possible population — worktrees dispatch did not create are exactly the ones
with no claim ref, which is the entire reason the gate exists, so a
convention-matching check could only ever have caught the already-claimed.

Three boundaries, each of which a looser gate gets wrong:

- **It claims nothing on the operator's behalf.** A claim ref for a worktree
  this script did not create is a record in git nobody asked for, and
  `/plot-reconcile` cannot tell a stale claim from a live one.
- **A merged tip with a clean tree is not a hold.** Six of the thirty-six
  worktrees on the machine that measured this were leftovers whose work had
  landed. Refusing those fires the gate on precisely the safe branches, which is
  how an operator learns to route around it.
- **`--allow-local` does not reach it.** That flag is about reading a plan's
  *phase* without a resolvable `origin/<main>`; it says nothing about whether a
  human is mid-edit. It is absent from the check by construction, not by a
  conditional.

For everything else, `plot-dispatch` stays a tool that reports rather than a gate
that judges — scripts collect and report, skills interpret.

## Workers never merge

The `Worker command` must tell the agent to open a PR and stop. Concurrent
merges invalidate each other's bases, and the DoD gate — the one property whose
failure is invisible in git — is applied per-PR by an agent seeing one PR at a
time. Merge authority stays with the human until Stage 5 provides an ordered,
conflict-checked merge queue.

## Tests

`test/reconcile/dispatch.test.mjs` — a throwaway repo with a local bare origin
and a three-branch plan (one deferred). Asserts: dry-run creates nothing,
fan-out produces one worktree per eligible branch with each ref pushed,
re-running does not duplicate, and running outside a repo is refused.

The work-in-flight tests each pin something a weaker implementation gets wrong.
Files held in an **unpushed commit** are reported (one reading `origin/*`
reports nothing and passes every looser test); files held **uncommitted** are
reported (no ref carries them, so this fails against any ref-only
implementation, including a correct local-refs one); **nothing** is reported
when nothing is held; dispatch **still starts everything**; and the report is
byte-identical whether or not the plan declares the candidate's files, which is
the assertion both rejected designs fail.

Two of these fixtures are shaped deliberately, because the obvious version
passes for the wrong reason:

- The **silence** test carries a bare claim — a branch that exists and holds
  nothing. Without it no branch reaches the empty-files check at all, and an
  implementation printing `holds (nothing)` for every claimed branch stays
  green. That is exactly the noise being guarded against.
- The **self-exclusion** test prepares the candidate's branch locally and never
  claims it on the remote. A claimed branch is not eligible, so `--next` would
  return nothing, the loop would never run, and the assertion would pass
  without the report being reached. It also gives that branch **no worktree**,
  which the held-branch gate made load-bearing: the gate refuses a candidate
  whose worktree holds unlanded work, so a desk here would make the candidate
  un-offerable and the report unreachable again — by the opposite route. The two
  properties are close enough to collide and separate enough to need their own
  fixtures: self-exclusion is about `committed_files`, which reads refs and wants
  no worktree at all.

The **held-branch** tests plant work the way the failure arrived: a worktree
with a local commit and **no remote ref**. An implementation reading `origin/*` —
the obvious one, and the one the fleet scan uses — sees an unclaimed branch and
passes none of them. Each fixture asserts its own premise first (`ls-remote`
empty, one commit ahead) so it cannot go green by testing the wrong bug.

Three of the eight are guards rather than the fix: a leftover worktree on a
**merged** branch must still dispatch, a branch with **no worktree** must be
untouched, and **`--allow-local`** must not unlock a hold. They pass on `main`
too, and that is the point — they pin the blast radius, not the feature.

The measured `--dry-run`/real-run pair is checked as two assertions rather than
one because they used to diverge: the dry-run footer carried a hardcoded
`skipped=0`, so a refusal it printed was a refusal it did not count.

Both were found by mutating the script and checking the tests went red — a
green test proves nothing until it has been seen to fail.

The **worker-reason** tests all read the *summary block* — the footer plus the
line above it — and never the whole output. That is the assertion that matters:
the per-branch message existed the whole time and was being missed, so a test
grepping the full output would have passed against the defect. Each was seen to
fail: moving the prose out of `print_summary`, collapsing `declined` into
`unconfigured`, and printing the prose on `--dry-run` each turn exactly one test
red. Two more pin the layering — the script must contain no prompt and no skill
invocation, and `plot-init/SKILL.md` must never mention `Worker command`.

The **cap** tests came the other way round: from running the real thing rather
than a fixture. The wide branch there is named `bug/aaa-wide` so it sorts first
and survives the branch cap — named last it lands past the cap, is truncated
away, and the file-cap assertions silently test nothing. That is how the first
version of the test failed, and the test then caught a real off-by-one in the
remainder count (`printf '%s'` writes no trailing newline, so `wc -l` counts
separators and undercounts the last field).

## Known gaps

- No `--attach` / `--kill` for inspecting or stopping a running worker; a human
  reads `.plot-worker.log` and uses the pid file by hand.
- Worker liveness is not checked — a crashed worker looks identical to a
  working one until the reaper (Stage 4) ages its claim.
- Worktree removal after a merged branch is manual (`/plot-reconcile` suggests
  it; nothing runs it).
