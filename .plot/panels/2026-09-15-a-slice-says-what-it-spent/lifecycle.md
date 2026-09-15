# Panel verdict — the WORKER LIFECYCLE lens

Subject: `docs/plans/2026-09-15-a-slice-says-what-it-spent.md`
Read against `a868ec7e8` (main).

---

## 1. Are the plan's factual claims true on main?

Every claim I could reach, checked by reading the code. Most hold. **Two do not, and one of them is the plan's headline measurement.**

### TRUE, verified

| Claim | Verification |
|---|---|
| `CONTEXT_USAGE_FIELDS` is three input fields, `output_tokens` deliberately absent, with that reasoning | `packages/domain/src/rules/spend.ts:79` — the array is exactly `input_tokens`, `cache_read_input_tokens`, `cache_creation_input_tokens`, and the TSDoc above carries the quoted sentence verbatim. The plan's quote is accurate. |
| `contextSpend` has **no render site** in `packages/board/src/app` | `grep -rn contextSpend packages/board/src/app/ \| wc -l` → **0**. Computed at `transcript.ts:221`, rendered nowhere. |
| `contextTokens` / `contextSpend` are kept apart on purpose | `transcript.ts:29-52`. The docstring at :37 says *"NOT `contextTokens`, and the two are kept apart deliberately."* |
| The 256 KiB tail bound, and the backwards walk | `TRANSCRIPT_TAIL_BYTES = 256 * 1024` at `transcript.ts:138`; backward walk `for (let i = lines.length - 1; ...)` at `transcript.ts:184`. Both exactly as cited — the line number is right. |
| `trap _cleanup_on_exit EXIT` at `plot-worker-loop.sh:1591` | Exact. Line 1591, character for character. |
| `Worker bound` is 28800 | `plot-config.sh get "Worker bound"` → `28800`. |
| `registry.ts:137` documents `session` as the transcript join key | Exact, and it says more than the plan uses — see §3 below. |
| `.plot/state/` is git-ignored | `git check-ignore -v` → `.gitignore:35:**/.plot/state/`. |
| The transcript outlives the desk (written under `~/.claude/`) | `transcriptDir` at `transcript.ts:79` resolves against `os.homedir()`. Correct, and load-bearing — see §3. |

### FALSE — the cost measurement is taken from the wrong population

> *"the largest transcript here is 387 MiB (394,418,228 bytes) ... a full four-counter sum over its 43,488 turns took 885–1087 ms"*

The byte count is approximately real but **the file is not a worker's transcript. It is the master agent's — this very session.** The path is

```
~/.claude/projects/-Users-jwloka-Quatico-Agentic-Tools-plot/1520fd86-….jsonl
```

and `1520fd86-1f27-4630-a596-1cdb41c71fbf` is the session id in the panel orchestrator's own scratchpad path. The plan measured the operator's console and budgeted a *worker's* exit path against it.

**The real population, measured now.** `~/.claude/projects/` keys directories by *worktree path*, so every dispatched worker's transcript sits under a `*plot-wt-*` directory. Over all 1,966 of them:

```
count                1,966
largest          8,111,230 bytes   (7.7 MiB)
median               7,084 bytes   (6.9 KiB)
```

The largest real worker transcript is **48× smaller** than the file the plan timed. Timing a full four-counter sum over that largest one, three consecutive runs:

```
/Users/jwloka/.claude/projects/
  -Users-jwloka-Quatico-Agentic-Tools-plot-wt-infra-the-components-leave-the-shell/
  261cf9ee-….jsonl                        7,857,564 bytes

turns 508  in 29,267  out 2,706  cc 2,965,106  cr 50,010,546   cr% 94.35
real 0.25 / 0.14 / 0.09 s
```

**90–250 ms at the worst case in the whole estate, against the plan's stated 885–1087 ms.** The median worker transcript is 7 KB and will sum in single-digit milliseconds.

This does not sink the plan — it *helps* it. But it inverts the plan's own central design argument. The plan writes:

> *"A cost is the traversal that bound exists to prevent ... unacceptable on a board refresh polled every few seconds."*

At a 7 KB median that claim is no longer established. The 256 KiB bound exists because *master-agent* transcripts grow unbounded; worker transcripts are bounded in practice by the slice. The plan's architecture — write-once-at-exit, never re-derive — may still be right, but **the measurement it rests on is not evidence for it**, and the plan presents that measurement as the reason. A plan whose load-bearing number is drawn from the wrong population should not be approved with the number left standing.

The cache-read percentages (98.6 / 99.3 / 99.36%) are consistent with what I measured (94.35% on the largest worker transcript — same order, same conclusion). **That argument survives**: a naive four-counter total is a cache-read count wearing a cost's name. The plan is right to forbid a summed fifth field.

### Could not verify

- *"three real transcripts on this machine"* — the plan names none of them, so I cannot re-measure the specific three. The percentages are plausible and my independent measurement agrees directionally.
- *"43,488 turns"* — not re-counted; the file is the wrong subject anyway.

---

## 2. Is the problem real, and is the shape right?

**The problem is real.** Plot sources four token counters per turn and states none of them as a cost. `contextSpend` is computed and rendered nowhere — dead code that already proves somebody reached for this and stopped. The story is correct that Plot could already source the number.

**The shape is half right.** Four counters kept apart, no summed fifth field, the model recorded beside them, `contextTokens`/`contextSpend` untouched — all correct and well argued.

**But the shape's core mechanism — "when the worker finishes" — does not survive contact with how a worker actually lives.** That is §3, and it is my lens's finding.

---

## 3. What `Done when` fails to pin — the lifecycle findings

### 3a. THE DECISIVE ONE: "when the worker finishes" names an event that does not exist per slice

**A worker is a hopping loop, not a one-slice process.** `plot-worker-loop.sh:2088-2297` is the finish path, and it does not exit. It:

1. `seal_declaration` (2093) — writes the per-**branch** record
2. `clear_manifest_branch` (2107)
3. blocks in `wait_for_work` (2186) until the registry hands it another slice
4. `reset_desk` / `git worktree add` (2196-2215)
5. claim-pushes, `export PLOT_BRANCH="$next_branch"` (2294), **loops**

The loop's own comment at `:1044` states the rule the plan needs and misses:

> *"THE ENDING FILE, per WORKER. This is the opposite of the declaration above and for the reason that separates them: **a declaration is about a BRANCH, and a worker hops, so one worker writes several. An ending happens once, to the worker**, and the branch it held at the time is a field rather than the subject."*

The plan is titled *"A slice says what it spent"* and proposes writing the record **when the worker finishes**. Those are different granularities, and the codebase has already drawn the distinction in prose. **The plan proposes a per-worker event to produce a per-slice fact.**

### 3b. And one session's transcript spans every slice the worker hopped through

`session_flag()` (`:778-785`) answers `--session-id` on the first prompt and `--resume` on every one after. `registry.ts:137` spells out the consequence:

> *"`session` is the transcript join key and **stays fixed across a branch hop by design** — `plot-worker-loop.sh` rewrites `branch` and `worktree` on a hop and leaves `session` alone."*

So a full sum over the transcript at worker exit is **the sum for every slice the worker ever worked**, attributed to whichever branch it happened to hold last.

**Measured, not argued.** Sampling the 12 largest worker transcripts for distinct `gitBranch` values:

```
branches=2  …bug-a-smaller-pulse-is-not-silently-better/bb3bacfb
branches=2  …bug-a-degraded-view-says-so-at-the-top/758d71ee
branches=2  …bug-the-agents-tab-filters-on-membership/12357403
(9 others: branches=1)
```

**3 of 12 already span two branches.** And desks accumulate sessions — one worktree project dir holds **49** `.jsonl` files (`…feature-the-entities-carry-their-states`), another 25, another 25.

**This is the way an implementation satisfies every stated gate and is still wrong.** Read the `Done when` list: a finished slice carries a record naming all four counters and the model ✓; the sum is over every turn of the run rather than the last ✓; no summed fifth field ✓; the full scan runs only at worker exit ✓; the board reads the record ✓; no `.jsonl` opened on a refresh ✓; a run with no readable transcript records nothing ✓; `contextTokens`/`contextSpend` unchanged ✓; a second run writes a second record ✓; `test:contracts` passes ✓.

**Every gate green, and on a two-slice worker the first slice's spend is charged to the second.** The word "run" in *"every turn of the run"* is doing all the work and is never defined. Nothing in `Done when` pins the **subject** of the record — whether a slice or a worker — and the plan's title and its mechanism disagree about it.

The fix is available and cheap: the transcript carries `gitBranch` per line (that is how I measured this), and `seal_declaration` already runs **per branch at exactly the right moment** — `:2088-2093` is explicit that it is written *before* the hop moves `$PLOT_BRANCH`, precisely so it names the branch that finished. A spend record belongs there, partitioned by `gitBranch` or by turn range since the last seal. **The plan should say so, and currently says the opposite.**

### 3c. `write_ending` already exists, is unmentioned, and fires only on failures

`write_ending()` at `:1069-1090` writes `.plot-worker.ending.json` — `{reason, actor, branch, detail}`, atomically via temp-file-and-rename, using node for exactly the reason a spend record would. It is a per-worker exit record that **already exists** and the plan never mentions it.

Its five call sites are **all failure endings**:

```
1934  quiet      monitor    (monitor said idle)
1947  unreadable bound      (bound expired, no transcript)
1951  bound      bound      (bound expired)
2000  unstarted  agent      (prompt never ran, budget spent)
2081  unstarted  agent      (build kept failing, budget spent)
```

**There is no `write_ending` on the success path.** The successful finish (`:2093`) writes a *declaration*, then hops. So "when the worker finishes" as an implementable hook resolves either to the EXIT trap — which does no work at all, see 3d — or to a set of five sites that are exactly the runs a spend record is least interesting for.

### 3d. The EXIT trap is a reaper and cannot host this

The plan cites `trap _cleanup_on_exit EXIT` at `:1591` as though it were a place to hang work. Read it (`:1571-1590`):

```bash
_cleanup_on_exit() {
  [ -n "${PLOT_MANIFEST_FILE:-}" ] && [ -f "$PLOT_MANIFEST_FILE" ] && rm -f "$PLOT_MANIFEST_FILE"
  [ -n "$_watchdog_pid" ]         && _kill_tree "$_watchdog_pid"
  [ -n "$_monitor_watcher_pid" ]  && _kill_tree "$_monitor_watcher_pid"
  [ -n "$_prompt_child" ]         && _kill_tree "$_prompt_child"
  [ -n "$_wait_sleep_pid" ]       && _kill_tree "$_wait_sleep_pid"
  …
}
```

It removes the manifest and kills children. **It writes no record, performs no derivation, and its first act destroys the manifest** — which is where `session` (the transcript join key) lives. A spend scan added here must read the manifest *before* the `rm -f`, i.e. it must be first, ahead of the cleanup the trap exists for. The loop's comment at `:1568` states the trap's contract: *"a cheaper, immediate cleanup"*. A second's file-walk is not that. This is a real design constraint the plan does not acknowledge.

### 3e. Exit paths, and which reach the trap — the plan's second Open Question

I enumerated every path. The trap is an `EXIT` trap, so it runs on **every** normal termination and on any trapped signal, and never on SIGKILL.

| Path | Site | Trap runs? | Spend recordable? |
|---|---|---|---|
| Successful slice finish | `:2093` | **never exits** — hops | **This is the case the plan is about, and it has no exit at all** |
| Bound expired (ALRM → 124) | `:1956` | yes | yes — and see below |
| Monitor said idle (USR1 → 124) | `:1934`/`:1956` | yes | yes |
| Prompt never started, budget spent | `:2004` | yes | yes (but there is nothing to sum) |
| Build failed, budget spent | `:2085` | yes | yes |
| Idle wait bound expired | `:2189` `exit 124` | yes | yes |
| No prompt file | `:1331` | yes | nothing to sum |
| `--stop <branch>` | `plot-dispatch.sh` uses bare `kill` = **SIGTERM** | **yes** | yes |
| `kill -9` / crash / machine death | — | **no** | **no record, ever** |

**My view on the Open Question, since the lens asks for one rather than a restatement:**

**The ALRM/bound concern is unfounded, and the question as posed is the wrong question.** Two reasons:

1. **Cost.** Measured above: 90–250 ms worst case on the real worker population, single-digit ms at the median. The plan feared ~1 s because it timed a master agent's file. There is no exit path on which that is unaffordable — including ALRM. The bound has already expired by definition; 0.25 s more is noise against 28800 s.

2. **The bound path is the one that most needs the record.** A worker that burned the full 28800 s bound is precisely the expensive run an operator wants accounted for. Excluding it would make the feature blind to its worst cases — and *"zero is the dangerous answer here"* is the plan's own Notes talking about exactly this.

So: **run it on every trapped path, including ALRM.** The honest residue is SIGKILL, which no trap can reach (`:1566` already says so) — that run records nothing, which the plan's Notes already have the right rule for.

**What the plan should have asked instead** is 3a: *is the subject a slice or a worker?* That is the question its own title makes urgent, and it is not in the Open Questions at all.

### 3f. The reaper destroys the desk — so a desk-local record has a deadline

`plot-reap.sh:624` runs `git worktree remove --force "$wt"`. Anything written into the worktree — `.plot-worker.ending.json`, the declaration, and any spend record following that pattern — **dies with the desk.** The board must therefore read the record *before* the reap, or the record must live outside the desk.

The plan's first Open Question asks where the record lives and considers only *committed* vs *machine-local*. It misses that "machine-local" has (at least) two very different variants with different lifetimes: **inside the desk** (destroyed by the reaper, possibly within minutes of the worker exiting) versus **under `.plot/state/`** (survives the reap, git-ignored). Those are not interchangeable, and the plan treats machine-local as one option. **The first Open Question is under-specified in a way that matters.**

### 3g. Smaller gaps in `Done when`

- **"a second run of the same slice writes a second record rather than mutating the first"** — nothing says how the two are told apart. No timestamp, session id, or ordering is required. Two records with identical fields and no discriminator satisfy the words.
- **`--restart`** hands an already-claimed branch to a *new* worker with a *new* session, inheriting the tree untouched. That is the "second run" case in the wild and the plan never names it.
- **The transcript is not reliably attributable at all.** `session_transcript_exists` / `transcriptDir` key on the *worktree path*, and `reset_desk` reuses one path across slices while `git worktree add` creates new ones. Sampled dirs hold up to 49 sessions. Picking "the" transcript is a real selection problem the plan waves at with *"slice → session → transcript is a path Plot already walks"*. What Plot already walks is a path to **the newest turn**, which is a much weaker requirement than attributing a whole run.

---

## 4. Are the two Open Questions genuinely blocking, and answerable from the repo?

**Q1 — where does the record live? Genuinely blocking, and correctly marked so.** The plan is right that `.plot/state/` being git-ignored means a colleague reads nothing, which is the problem the plan set out to solve. It is *not* fully answerable from the repo — it is a policy call about putting per-run numbers in git history. But the repo does narrow it: `.plot/state/` is the estate's established home for machine-local records (`plot-state-receipt.sh`, `commit-records/`), with a stated precedent at `plot-boardctl.sh:83` for why such records must not travel in commits. **And the question is missing its third option** (in-desk vs `.plot/state/`, per 3f).

**Q2 — which exits does the scan run on? Not blocking, and answerable from the repo — I answered it in 3e.** The exit paths are enumerable (I enumerated them), the cost is measurable (I measured it: 90–250 ms worst case), and the answer falls out: every trapped path including ALRM, nothing on SIGKILL. This question should be closed by measurement, not left open.

**The blocking question the plan does not ask is 3a** — slice or worker. It is more blocking than Q2 and arguably more than Q1, because the plan's title asserts one answer and its mechanism implements the other.

---

## 5. The single strongest argument against doing this at all

**The record is machine-local, and a fleet is not.**

The transcript lives under `~/.claude/projects/` on the machine that ran the agent. The plan concedes this and calls it *"what makes a reading after the fact possible at all"* — but it cuts the other way too. `DESIGN-agent.md`'s `elsewhere` state exists precisely because an agent's worker may run on a machine this one cannot see; `plot-registryd.mjs` *"supervises only the agents this machine registered"*. So on a multi-machine fleet, a plan's spend is the sum of whichever slices happened to run on the machine you are asking from — silently partial, in the direction nobody checks.

That is the plan's own Notes warning turned against the feature: *"A recorded zero is indistinguishable from a free run, and a per-plan sum over a zero is wrong in the direction nobody checks."* A per-plan rollup — the sprint's Should, the reason this plan exists — inherits exactly that defect and cannot detect it. The plan defers the rollup but the rollup is the payoff, and it is unsound on the estate's own architecture unless the record is committed.

Which loops back to Q1: **the honest options are "commit the record" or "this feature is single-machine only and says so".** The plan says it will not settle that and must not proceed until it does. It is right.

---

## What would change my verdict to `proceed`

1. Decide the **subject**: slice or worker, and make the mechanism match the title. `seal_declaration` at `:2093` is the per-slice hook and it already runs at the right moment; `.plot-worker.ending.json` is the per-worker one. Pick one and name it.
2. Re-measure the cost against **worker** transcripts (median 7 KB, max 7.7 MiB, 90–250 ms) and let the architecture argument stand or fall on the real number.
3. Close Q2 with that measurement: every trapped path including ALRM, nothing on SIGKILL.
4. Widen Q1 to three options (in-desk / `.plot/state/` / committed) and note the reaper deadline at `plot-reap.sh:624`.
5. Add a `Done when` clause pinning attribution: a record names the branch its turns belong to, and a worker that hopped writes one record per slice.

None of this is a reason to abandon the plan. The problem is real, the four-counters-kept-apart design is right, and the forbidden-naive-total argument is the strongest thing in the document. But the plan's central mechanism is specified against a lifecycle it has not read closely, and its headline measurement is from the wrong population. Both are fixable in an amendment; neither should survive into implementation.

Verdict: amend
