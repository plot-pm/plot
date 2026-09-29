# A slice starts its own conversation

> A desk handed a second slice resumes the first one's session. The 3.7 MB transcript stays silent for 2 770 s while it reloads, the idle rule reads that silence beside the previous slice's commits, and the monitor kills a worker that never got to start.

## Status

- **State:** Approved
- **Approved:** 2026-09-29, jwloka, in-session
- **Started:** 2026-09-29, jwloka, `bug/a-slice-starts-its-own-conversation`
- **Type:** bug
- **Review:** in-session
- **Impl:** own branches
- **Issue:** #1067
- **Sprint:** plot-observes-and-recovers-its-own-fleet
- **Rounds:** 1

## Changelog

- A slice handed to a reused desk starts its own conversation instead of resuming the previous slice's.

Board impact: the board follows an agent's transcript by session id, and this changes how many a desk has. See *What the board loses*.

## Motivation

Measured by an operator on 2026-09-29 (`ewz-leg`, desk `.worktrees/free-6bf72564`), with a second independent reproduction on `free-1ca12583`:

- transcript `faea98ad-….jsonl` opens 11:32:46Z for `bug/EWZLEG-861-leg-admin-validto`, reaching **3.7 MB** by 12:48Z
- the next slice, `feature/EWZLEG-872-…`, **resumed that session**; the transcript is silent 12:48:24Z → 13:34:34Z — **2 770 s** — and the 872 prompt appears only at the end
- at 13:04:19Z the WorkerMonitor reported `idle`: *"silent for over 900s … and the branch already carries commits"*

**The operator's explanation of those commits is unverified and probably wrong.** They read as 861's, still on the reused desk — but `reset_desk` detaches to `origin/<main>` before cutting the new branch (`plot-worker-loop.sh:928`), and `monitor_has_commits` counts against `origin/HEAD` excluding the empty claim commit (`plot-worker-monitor.sh:419-433`). On a properly reset desk the commit condition should have **refused** the finding. Either the reset fell through to the create path, or the branch already carried pushed work. **The slice establishes which rather than repeating the account.**
- the loop ended the worker, `exit 124`, `.plot-worker.ending.json` recording `reason: quiet, actor: monitor`

`--restart` minted a fresh id and that worker ran normally.

### The mechanism, confirmed in source

`session_handle()` (`plot-worker-loop.sh:716-724`) returns the manifest's `resumeId` unconditionally. `session_flag()` (`:744-750`) picks `--resume` whenever a transcript for that handle exists. **Neither asks which branch**, and `resumeId` is the agent's launch id, unchanged for every slice on the desk.

### This overturns a decision, and that is the plan's real subject

`plot-worker-loop.sh:271-284` is not an oversight. It settled the question on 2026-09-05, deliberately:

> **IT DOES, AND THE VALUE IS THE ONE THE NEXT PROMPT CONTINUES.** An agent keeps a single conversation for its whole life, because `transcript.ts:100` opens `${sessionId}.jsonl` literally and a forked chain is a linked list the board cannot follow.

The constraint is real — `packages/board/src/server/transcript.ts:100` does exactly that. **So this plan must pay the cost that decision was avoiding**, not pretend it does not exist.

## Design

### The rule

**A hand-over to a DIFFERENT branch mints a new handle. A hand-over to the same branch resumes.**

`--resume` continues *this slice*; it never crosses into another. The condition is a comparison the hop already has in hand: `update_manifest_on_hop` receives `$2=new_branch` and the manifest holds the old one.

### Where the change goes

`update_manifest_on_hop` (`:301`) is the one writer of `resumeId` and the only site holding both branches, with the hop as its only caller. **The decision belongs there**, confirmed — `session_handle` (`:716`) and `session_flag` (`:744`) are read once per prompt at `:1657-1659` and have no branch to compare.

**One path does not reach it, and the plan names it rather than discovering it.** A resumed loop on a **pre-`resumeId` manifest** falls through `session_handle` to `$PLOT_SESSION_ID` (`:722-723`) — the launch id — and never reaches the comparison. Narrow, but real.

**A fresh dispatch and `--restart` are both fine**, and `--restart` explains the operator's recovery: it routes through `start_worker`, which calls `plot_session_id()` and writes a **brand-new manifest** at `$manifest_dir/$session.json`. That is a *new agent*, not a re-handled one — which is why their restart worked and why it is not the fix.

### THE COST IS THE OPPOSITE OF WHAT AN EARLIER DRAFT CLAIMED

An earlier draft said the board *"will follow the newest slice and lose the previous one's history"*. **Measured: the board follows neither.** It joins on `session`, not `resumeId` —

```
registry.ts:787-788
  const tdir = transcriptDir(entry.worktree, home);
  const file = transcriptFile(tdir, entry.session);
```

— and `session` is exactly the field a hop does **not** write. `update_manifest_on_hop` (`:311-317`) sets `branch`, `worktree`, `resumeId`, `wavesCount`. The registry's own docstring (`registry.ts:234-238`) states the separation:

> **A SECOND FIELD, NOT AN ALIAS FOR `session`** … `session` is the transcript join key and stays fixed across a branch hop by design … **Nothing may assume the two agree.**

An earlier draft assumed exactly that.

**So the real consequence: the board keeps showing slice 1 forever and never shows slice 2.** Every transcript-derived field it renders — `model`, `contextTokens`, `lastActivity` (`registry.ts:789`) — is read from a conversation that ended before the current slice began. **Not a loss of history: an agent row asserting live facts about a dead session**, and it goes stale the moment any desk takes a second slice.

That is quieter than the cost first described, so nothing will surface it.

### `session` vs `resumeId` is the decision this plan must make

The obvious repair — make `session` follow the hop — has a blast radius the plan must name, because **`session` is the agent's identity across the estate**:

| site | what it uses `session` for |
|---|---|
| `plot-dispatch.sh:1449` | **the manifest's filename** — `$manifest_dir/$session.json` |
| `registry.ts:788` | the transcript join |
| `DropAgentButton.tsx:114,139,160,166,174` | Drop posts `{session}` and refuses without one |
| `AgentList.tsx:1364,2251` | the React key for every agent row |
| `tuple-row.ts:860`, `rows.tsx:2363` | the rendered agent name (`shortSessionId`) |
| `registryd-main.ts:723`, `assign.ts:126`, `supervision.ts:264` | `performer.assignSlice(item.session, …)` |

**So `session` cannot simply be rewritten** — it names the file the manifest lives in. The slice decides between moving the join to `resumeId` and making `session` follow, and states which; an earlier draft's *"What this does NOT do"* did not mention the field at all, which would have let an implementer ship the stale join.

### The idle rule is the second half, and it is separate

The monitor's evidence includes *"the branch already carries commits"* (`plot-worker-monitor.sh:551`). On a reused desk those commits may predate the hand-over, so the condition reads as *this worker has done work and stopped* when the truth is *another slice did work here*.

**And the rule does NOT stop firing.** An earlier draft claimed a fresh conversation starts fast, so the silence goes away *by accident*. It does not: `plot-transcript-quiet.sh:27-32` reads the newest mtime across every non-`agent-` transcript in the desk directory and **deliberately does not take a session id** —

> `.plot/worker-prompt.sh:29` DOES pass `--session-id` now … and this deliberately does not take it.

A fresh handle writes a new file in the **same directory**, so the reading is unchanged in kind, and while the new conversation loads its brief and repo nothing writes at all. The 900 s window is crossed by any start slower than fifteen minutes, and the CPU check only rescues a worker with a child **on a core** — a model round-trip is not.

**So the idle rule is not downstream of this fix. It is an independent live defect**, and a slice filing it on the grounds that *"it got rarer"* would be filing on a false premise.

### What this does NOT do

- **It does not fork a session.** `--fork-session` is the concept `:283` predicted; this plan mints a fresh id and does not build a chain.
- **It does not change `attempts`.** A hop is the same agent continuing and the retry budget is unchanged — the node one-liner round-trips every field it does not name.
- **It does not touch `--restart`**, which already mints a new id and is the documented recovery.
- **It does not change the monitor's thresholds.**

## Done when

- **A hop to a different branch produces a handle the previous slice does not own**, asserted by reading the manifest across two hops.
- **A hop to the SAME branch still resumes**, asserted — the property that makes `--resume` worth keeping.
- **A new slice's first prompt reaches the runtime within the monitor's quiet window**, asserted against the measured failure: 2 770 s of reload against a 900 s threshold.
- **The board shows the CURRENT slice's conversation**, asserted. Today it joins on `session` (`registry.ts:788`), which a hop does not write, so after this change it would render `model`, `contextTokens` and `lastActivity` from a dead session. **The PR states whether the join moved to `resumeId` or `session` follows the hop** — and if the latter, what happens to the manifest filename (`plot-dispatch.sh:1449`) and the other eight consumers.
- **The idle rule is fixed or filed on the right grounds.** It is an independent defect: `plot-transcript-quiet.sh` reads the desk rather than the session, so a slow fresh start still crosses the 900 s window. Filing it as *"rarer now"* is filing on a false premise.
- **Whether the reported commits were the previous slice's is established or the claim is dropped.** `reset_desk` detaches at `:928`, so on a properly reset desk they should not have been there.
- `attempts` and every unnamed manifest field survive a hop, asserted.

## Slices

### A slice starts its own conversation (Branch: bug/a-slice-starts-its-own-conversation, PR: #1077)

Mint a fresh handle in `update_manifest_on_hop` when the branch changes, keep resume for the same branch, and state what the board shows for earlier slices.

## Notes

**The operator reported a second defect in the same message and it is not planned here:** a supervisor-started worker could not find `claude` — launchd's PATH lacks `~/.local/bin`, `exit 127` three times — and they worked around it in their own `.plot/worker-prompt.sh`. Plot's shipped template could carry the same fallback. **Filed as #1068 rather than folded in**, because it is an installer question and this is a session-handle question.

**The decision this overturns was argued and dated**, which is why the plan quotes it. `plot-worker-loop.sh:271-284` chose one conversation per agent to keep the board's transcript reader working, and named `--fork-session` as the shape a change would take. The measurement that overturns it is the 2 770 s reload — a cost that did not exist when a desk's second slice was rare.


### Round 1, 2026-09-29

One juror, **amend**, **executed** — it replayed the two-slice case against `transcript.ts`'s verbatim logic and traced every caller of the session functions. One host call.

**Three load-bearing claims were false, and the first is the cost this plan told an implementer to pay:**

1. **The board does not lose the old transcript — it keeps showing it forever and never shows the new one.** It joins on `session` (`registry.ts:788`), which a hop does not write, so every transcript-derived field would go permanently stale on a desk's second slice. `registry.ts:234-238` says outright *"Nothing may assume the two agree"*; this plan assumed it.
2. **The idle rule does not stop firing.** `plot-transcript-quiet.sh` reads the desk directory, not the session, and declines a session id by design — so a slow fresh start still trips the 900 s window. The rule is an independent defect, not this fix's second half.
3. **The commits the monitor saw were probably not the previous slice's.** `reset_desk` detaches to `origin/<main>` first, so the condition should have refused.

The juror's reason for not saying `proceed`: **this plan wrote *"It may not discover this in review"* about precisely the board question, then stated the answer backwards** — pre-committing an implementer to the wrong repair, for a consequence quieter than the one described.

**What it upheld:** the rule, and the location. `update_manifest_on_hop` is the only writer of `resumeId` and the only site with both branches.