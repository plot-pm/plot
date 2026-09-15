# Persistence lens — a-slice-says-what-it-spent

Read as: *who writes this fact, where does it live, who reads it back, what
happens when the writing machine is not the reading machine, and what happens on
a second write.*

## 1. Are the plan's factual claims true on main right now?

Verified against `a868ec7e8`. **Every claim I could check is true**, and two are
true but narrower than the plan implies.

| Claim | Verdict | Evidence |
|---|---|---|
| `readTranscriptFacts` returns `model`, `contextTokens`, `contextSpend`, `lastActivity` | TRUE | `packages/board/src/server/transcript.ts:23-55` |
| `contextTokens` is `cache_read_input_tokens` alone, *"Tokens the last turn read back as context"* | TRUE, quoted verbatim | `transcript.ts:27`, read at `:212-216` |
| `contextSpend` is *"Every input token the last turn carried"*, *"the number a context ceiling is a fraction of"* | TRUE, quoted verbatim | `transcript.ts:35-42` |
| `contextSpend` has **no render site**; zero refs in `packages/board/src/app` | TRUE | `grep -rn contextSpend packages/board/src/app` → 0. Only render site for the pair is `AgentPanelFacts.tsx:411`, which renders `contextTokens` |
| `rules/spend.ts:79` defines `CONTEXT_USAGE_FIELDS` as the three input fields | TRUE, exact line | `packages/domain/src/rules/spend.ts:79-83` |
| The `output_tokens` comment, quoted at length | TRUE, verbatim | `spend.ts:75-77` |
| `transcriptDir(worktree)` resolves `~/.claude/projects/<slug>` | TRUE | `transcript.ts:79-81` |
| `registry.ts:137` documents `session` as *"the transcript join key"* | TRUE | `packages/board/src/server/registry.ts:137` — note this is `packages/board/src/server/registry.ts`, not the domain's |
| The transcript outlives the desk (written under `~/.claude/`, not the worktree) | TRUE | `transcript.ts:79-81`; confirmed by inspection — 183 session files survive for desks long reaped |
| `.plot/state/` is git-ignored | TRUE | `.gitignore:30` and `:35`; `git check-ignore -v .plot/state/` → match |
| `plot-worker-loop.sh:1591` installs `trap _cleanup_on_exit EXIT` | TRUE, exact line | `plot-worker-loop.sh:1591` |
| `Worker bound` is 28800 | TRUE | `plot-worker-loop.sh:128`, `CLAUDE.md` config |
| 256 KiB tail bound, with the quoted *"grows without bound"* rationale | TRUE, verbatim | `transcript.ts:126-138` |
| It walks backwards at `transcript.ts:184` | TRUE, exact line | `transcript.ts:184` |
| Story narrowed 2026-08-29 by measurement; transcript carries four counters and no monetary field | TRUE | `STORY-plot-plan-economics.md:19-31`. I re-measured: over 4000 lines, **zero** keys matching `/cost\|price\|usd\|dollar\|cent/i` |

### The headline measurement reproduces

I re-ran the four-counter sum on the largest transcript on this machine,
independently of the plan:

```
turns 43,578   input 87,102   output 22,155,664
cache_creation 117,527,893    cache_read 21,532,550,349
total 21,672,321,008          cache_read = 99.36% of the sum
real 1.14s / 1.12s / 1.09s    (394,456,146 bytes)
```

**99.36% matches the plan exactly.** The absolute counts differ slightly from
the plan's table because the file is live and still growing — which is itself a
persistence fact worth noting (see §3). The timing is 1.09–1.14 s against the
plan's stated 885–1087 ms; the plan's range is honest and my reading sits just
above it, under a machine running three agents. The plan was right to state a
range.

### Two claims that are true but read wider than they are

- **"`registry.ts:137` documents `session` as the transcript join key."** True —
  but the sentence continues, and the continuation matters: *"`session` is the
  transcript join key and **stays fixed across a branch hop by design** —
  `plot-worker-loop.sh` rewrites `branch` and `worktree` on a hop and leaves
  `session` alone."* The plan cites the half that supports it and does not
  engage the half that breaks it. See §3, finding A — this is my central
  objection.

- **"the four a transcript carries."** The four token counters are real, but
  `usage` carries more than four keys. Measured on a real session:
  `input_tokens, cache_creation_input_tokens, cache_read_input_tokens,
  output_tokens, output_tokens_details, server_tool_use, service_tier,
  cache_creation, inference_geo, iterations, speed`. `server_tool_use` is
  billable activity the plan's record would silently omit. Not fatal — the four
  are the right four for a token count — but a record that claims to say *what a
  slice spent* should name what it excludes, as carefully as the plan makes
  `spend.ts` name why `output_tokens` is absent.

**Could not verify:** the "three real transcripts, 98.6% / 99.3% / 99.36%"
triple — I reproduced the 99.36% one exactly and did not identify the other two
files. The claim's shape is consistent with everything I did measure.

## 2. Is the problem real, and is the shape right?

**The problem is real.** Plot sources four counters per turn and states no total
anywhere. The plan's core insight — that a cost is a sum over a whole run while
`contextSpend` is a snapshot for a ceiling, and that widening the latter would
break it — is correct and well argued. Refusing a naive summed fifth field on a
measured 99.36% cache-read share is the strongest thing in this document: it
turns a plausible feature into a demonstrated trap.

**The shape is wrong in one structural respect, and it is in my territory.**

The plan's unit is the **slice**. The record's key is the **session**. Those are
not the same thing, and on this estate they routinely differ (§3 finding A).

There is also a direct conflict with the story this plan serves, which the plan
does not acknowledge:

> `STORY-plot-plan-economics.md:270`
> | 2026-08-27 | **Cost is derived, never stored** | Keeps manifesto Q1 (git is the database) and Q8 (no effort tracking). **A stored cost is a record that can be wrong.** |

The plan's entire mechanism is a **stored** cost. That may well be the right
call — the 1.1 s scan is a real reason derivation-on-demand fails — but a plan
that overturns a dated story decision must say so in the same voice the plan
uses on `spend.ts`'s `output_tokens` rule. It does exactly that for
`output_tokens` ("**says so against that rule** rather than appearing not to
have read it") and does not do it here. The omission is inconsistent with the
plan's own standard.

## 3. What `Done when` fails to pin

The gate list is unusually good — it pins the sum's scope, forbids the fifth
field, pins the scan to worker exit with a test that fails if a refresh path
opens a `.jsonl`, forbids recording zero, protects `contextTokens`/`contextSpend`,
and requires append-not-mutate. An implementation can still satisfy **every**
stated gate and be wrong, in four ways.

### A. One session spans many slices — the record would attribute a whole agent's life to one branch

This is the finding I would block on.

`plot-worker-loop.sh` explicitly keeps **one conversation per agent across every
slice it takes**:

- `plot-worker-loop.sh:267` — *"The manifest already carries `session`, `pid`,
  `startedAt` — these stay fixed."* A hop rewrites `branch`, `worktree`,
  `resumeId`, `wavesCount`.
- `plot-worker-loop.sh:~278` — *"**IT DOES, AND THE VALUE IS THE ONE THE NEXT
  PROMPT CONTINUES. An agent keeps a single conversation for its whole life**,
  because `transcript.ts:100` opens `${sessionId}.jsonl` literally and a forked
  chain is a linked list the board cannot follow."*
- `plot-worker-loop.sh:~693-706` — the loop chooses `--resume` over
  `--session-id` on a hop precisely so the second slice **appends to the same
  transcript**.
- A live manifest on this machine carries `"wavesCount": 2` under one `session`.

So "sum the whole transcript at worker exit" yields **the agent's lifetime
spend, not the slice's**. An agent that takes three slices records, for its
third slice, a number including all of slice one and slice two. Because cache
reads are 99.36% of the sum and cache reads grow with conversation length, the
error is not a small overcount — **the last slice of a long-lived agent absorbs
nearly the entire run**, and the first slices record nothing at all (no worker
exit happened at their boundary).

Every `Done when` gate passes under this implementation. The sum is over every
turn. No fifth field. Scan at exit only. Nothing is zero. A second run appends.
And the numbers are wrong in a way nobody can see, because there is no
independent source to check them against — which is exactly the failure mode
`STORY:270` ("a stored cost is a record that can be wrong") names.

The fix is not large: record a **cursor** — turn count, byte offset, or last
turn `uuid`/`timestamp` at slice start — and sum the delta. But the plan does
not mention it, `Done when` does not require it, and the plan's own title says
*a slice* says what it spent.

### B. 12.2% of spend lives in subagent transcripts the reader will never open

`transcript.ts:112` skips `agent-` prefixed files, and `:197` skips
`isSidechain` lines — both correct for the panel's question (*what is this
worker doing now?*) and both wrong for *what did this cost?*

Measured in this project's transcript directory:

```
session files  180   538,055,003 tokens
agent-* files  421    74,688,825 tokens
subagent share of total: 12.2%
```

A subagent is work the slice caused and paid for. A record built on the existing
session-keyed reader omits **all of it**, and 12.2% is far outside any tolerance
a cost figure should carry silently. The plan reuses the session join key
without noticing that the reader it inherits was built to exclude precisely this
population. `Done when` never mentions subagents, so an implementation that
omits them passes.

### C. Nothing pins WHERE — so `Done when` cannot be checked

`Done when` says a finished slice "carries a record" and "the board reads the
record". It names no location, no format, no key. Since Open Question 1 is
explicitly unresolved, this is circular: the gate cannot be evaluated until the
question it defers answers it. That is fine for a Draft, and it is why the
question blocks (§4).

### D. "Records nothing and says so" has no stated reader-side shape

The Notes section is right that a recorded zero is the dangerous answer. But
*"says so"* needs a representation — absent file, present file with a null
field, a `reason` string — and the reader needs a defined behaviour for each. A
per-plan rollup (the sprint's Should, explicitly built on this) will sum these,
and summing "nothing" as 0 is the exact failure the Notes warn about, one layer
up. `Done when` pins the writer's honesty and not the reader's.

## 4. Are the Open Questions blocking, and answerable from the repo?

### OQ1 — where does the record live? **Genuinely blocking. Largely answerable from the repo, and the repo's answer is machine-local.**

The plan frames this as a dilemma between a committed record and an openly
machine-local one, and says a machine-local record "would have moved the problem
rather than solved it". **I disagree with that framing**, and the repo has
already litigated it three times.

`.gitignore:25-29` states the principle:

> *"Machine-local Plot state. The rest of `.plot` is project content (briefs,
> templates, the review hold) and stays committed; this holds caches describing
> THIS machine's refs and worktrees — the board's last-good pulse among them.
> **A checked-in pulse would be one clone telling another what its branches are
> doing.**"*

And `.gitignore:39-48`, on the registry, is the closest precedent — a record
derived from machine-local facts that was *tracked and then untracked*:

> *"Measured 2026-08-24: 54 manifests were on main and 48 of those were dead,
> one per agent ever dispatched here. Nothing reaps a tracked file, so the
> directory had become **a graveyard shared with everyone who clones** rather
> than a register of what is running."*

A committed spend record has exactly that shape: **one immutable file per run,
forever, written by a machine, never reaped.** The plan's own "written once and
never updated, a second run is a second record" guarantees unbounded growth in
git history. This is the manifest graveyard reproduced deliberately.

Against that, the argument for committing is that a colleague reads nothing —
but a colleague reading nothing is **correct** here, not a failure. The
transcript is on one laptop; another clone genuinely has no knowledge of what
that run spent. `spend.ts:23` states this repo's rule for exactly this case:

> *"**`unknown` IS NOT `ample`.** Silence is not headroom."*

An absent record read as `unknown` is honest. A committed record is one clone
telling another what its agents spent — `gitignore:29`'s sentence, verbatim.

**My position: machine-local under `.plot/state/`, openly labelled, with `unknown`
as the cross-machine answer.** The precedent is `.plot/state/commit-records/`,
which is the closest existing analogue in both shape and purpose: an
append-only, machine-written, forensic record of runs, `YYYY-MM-DD.jsonl`, one
file per day, last 30 kept. It solves the second-write question (append), the
unbounded-growth question (prune by day), and the who-reads-it question (this
machine) — all three of which the plan leaves open. A spend record is the same
kind of fact and should reuse that shape rather than invent one.

The plan's objection — that this "moves the problem rather than solving it" —
holds only if the goal is *a colleague sees the cost*. The story's goal (`What
did this plan cost?`) is served by the machine that ran the work answering it.
If cross-machine visibility is truly required, the honest mechanism is
publishing an aggregate to the **plan file** at delivery — a human-authored,
already-committed artifact — not a per-run machine record in git. That is a
different slice, and the plan should say so.

**One thing the repo does NOT answer, and the plan should decide:**
`.plot/panels/` is currently **neither tracked nor ignored** (`git check-ignore`
exits 1; `git ls-files` returns nothing). The `.gitignore` itself calls that
state *"the worst of both"* at lines 65-68 and again at 71-74. Whatever this
plan chooses, it must add the path to `.gitignore` in the same slice, or it
reproduces a condition this repo has twice written comments about catching.

### OQ2 — which exits? **Blocking, and the repo answers it — the answer is worse than the plan expects.**

The plan asks whether the ALRM/bound path can afford a second. Reading
`_cleanup_on_exit` (`plot-worker-loop.sh:1571-1591`) surfaces a harder problem
than cost:

```
_cleanup_on_exit() {
  # Remove the manifest first — it is the externally visible registration.
  [ -n "${PLOT_MANIFEST_FILE:-}" ] && [ -f "$PLOT_MANIFEST_FILE" ] && rm -f "$PLOT_MANIFEST_FILE"
  ...
```

**The trap deletes the manifest first**, and the manifest is the only thing
holding `session` — the transcript join key, and on a hopped agent the only
record of which branch the run was on. A spend scan installed later in this trap,
or in a second `trap ... EXIT` registered after it, finds no manifest and cannot
name the session it is meant to sum. The implementation must capture the join
key **before** the manifest is removed, or write the record before that `rm`.
Nothing in `Done when` requires this, and the natural implementation (append a
new trap) fails.

Three further facts the plan should absorb:

- The trap runs on **every** exit — normal return, SIGTERM from
  `plot-dispatch.sh --stop`, and the bound. So "which exits" is already answered:
  all of them except SIGKILL.
- `plot-worker-loop.sh:1565-1570` states the trap *"cannot run on SIGKILL, so the
  reconciliation sweep is still the thing that catches a worker killed
  outright"*. A SIGKILLed worker records nothing — correct under the plan's
  "record nothing rather than zero", but it means the record is **lossy by
  construction**, and any rollup over slices is a sum over an unknown subset.
  That needs stating, because a per-plan total that silently omits killed
  workers is wrong in the direction nobody checks — the Notes' own sentence.
- 1.1 s is affordable on any of these paths. The cost was never the real
  question; **ordering and lossiness are.**

## 5. The single strongest argument against doing this at all

**It stores a number that nothing can check, to answer a question whose unit is
already known to be the wrong one — and the story forbade exactly that.**

`STORY:270` records, dated 2026-08-27: *"Cost is derived, never stored … A
stored cost is a record that can be wrong."* This plan stores a cost. Three
separate findings above show it would be wrong in ways no reader could detect:
a hopped agent's lifetime attributed to its last slice (§3A), 12.2% of spend
silently missing (§3B), and SIGKILLed runs absent from any rollup (§4 OQ2).
Each is invisible precisely because a stored figure has no second source to
disagree with it.

And the plan itself proves the unit does not answer the question it is named
for. Its best measurement — cache reads at 99.36% — establishes that no
unweighted token figure means anything as a *cost*. The plan responds by
refusing to offer a total, which is intellectually honest and leaves a reader
with four numbers they cannot combine, on a record they cannot verify, readable
on one laptop. The sprint's Should (a per-plan rollup) then sums four
uncombinable vectors across a lossy subset of runs.

The counter-argument, which I find nearly as strong: the four counters ARE the
raw material, they are genuinely unrecoverable once a desk is reaped on a
machine that later goes away, and capturing them at exit is cheap. **The
capture is worth doing.** What is not yet earned is calling it *what a slice
spent*.

## Summary of what would change my position to `proceed`

1. Resolve OQ1 explicitly — I recommend machine-local under `.plot/state/`,
   following the `commit-records/` shape (append-only, day-keyed, pruned), and
   add the path to `.gitignore` in the same slice.
2. Say, in the plan's own voice, that this overturns `STORY:270`'s *"cost is
   derived, never stored"*, and why — the plan already does this correctly for
   `spend.ts`'s `output_tokens` rule and should hold itself to that standard
   twice.
3. Address the session-spans-slices problem (§3A): either record a per-slice
   cursor, or rename the unit to the **run/agent** and retitle accordingly.
4. State the subagent decision (§3B) — include `agent-*.jsonl`, or exclude them
   and put the 12.2% measurement in the plan.
5. Add a `Done when` gate requiring the join key to be captured **before**
   `_cleanup_on_exit` removes the manifest, and state that SIGKILL records
   nothing.

Items 1, 3 and 5 are the ones that make a wrong number look like a right one.

Verdict: amend
