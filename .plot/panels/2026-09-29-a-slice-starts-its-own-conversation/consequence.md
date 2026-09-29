Position: amend
Evidence: executed

# Consequence — a slice starts its own conversation

The defect is real and the rule is right. **Three of the plan's load-bearing claims are false**, and the most important one is the cost it tells the implementer to pay. The plan names a cost that does not exist, and misses the one that does.

## 1. The stated cost is wrong, and the real consequence is the opposite

The plan says:

> `transcript.ts:100` opens `${sessionId}.jsonl` literally, so **the board will follow the newest slice and lose the previous one's history for that agent.**

**The board follows neither.** It joins on `entry.session`, not `entry.resumeId`:

```
packages/board/src/server/registry.ts:787-788
        const tdir = transcriptDir(entry.worktree, home);
        const file = transcriptFile(tdir, entry.session);
```

And `session` is exactly the field a hop does not touch. `update_manifest_on_hop` writes three fields and `session` is not among them:

```
skills/plot/scripts/plot-worker-loop.sh:311-317
    manifest.branch = process.argv[2];
    manifest.worktree = process.argv[3];
    if (process.argv[5] !== "") manifest.resumeId = process.argv[5];
    manifest.wavesCount = (manifest.wavesCount || 1) + 1;
```

The registry's own docstring for `resumeId` states the separation the plan then ignores:

```
packages/board/src/server/registry.ts:234-238
   * **A SECOND FIELD, NOT AN ALIAS FOR {@link session}** … `session` is the
   * transcript join key and stays fixed across a branch hop by design …
   * Nothing may assume the two agree.
```

Executed reproduction of the two-slice case against the verbatim `transcript.ts:88-115` logic (one desk, since a hop reuses it — see §3):

```
--- TODAY (one conversation per agent) ---
board join on manifest.session = …/faea98ad-….jsonl

--- AFTER THE PLAN ---
board join on manifest.session    = …/faea98ad-0000-…-0001.jsonl   <- registry.ts:788
resume probe on manifest.resumeId = …/bbbbbbbb-0000-…-0002.jsonl   <- resume.ts:49
no-id fallback (newest)           = …/bbbbbbbb-0000-…-0002.jsonl
```

**The board does not lose the previous slice. It keeps showing it, forever, and never shows the new one.** Every transcript-derived field the board renders — `model`, `contextTokens`, `lastActivity` (`registry.ts:789`) — would be read from a conversation that ended before the current slice began, and would go permanently stale the moment a desk takes its second slice. It is not a loss of history; it is an agent row asserting live facts about a dead session.

That is worse than what the plan describes, and it is a different repair. The plan's *"state what the board shows for earlier slices"* Done-when asks the implementer to document a consequence that will not occur, and does not ask them to fix the one that will. **An amended plan must name `registry.ts:788` and say whether `session` follows the hop, or whether the join moves to `resumeId`.** Neither is free: `session` is the manifest FILE NAME (`plot-dispatch.sh:1449`, `PLOT_MANIFEST_FILE="$manifest_dir/$session.json"`), so it cannot simply be rewritten.

## 2. The blast radius is bigger than the board, because `session` is the agent's identity

If the amendment reaches for "make `session` follow the hop" — the obvious repair once §1 is seen — it touches far more than a transcript join. `session` is the agent's identity across the estate:

- `DropAgentButton.tsx:114,139,160,166,174` — Drop posts `{session}` and refuses without one
- `AgentList.tsx:1364,2251` — the React key for every agent row
- `tuple-row.ts:860`, `rows.tsx:2363` — the rendered agent name (`shortSessionId`)
- `registryd-main.ts:723` — `performer.assignSlice(item.session, …)`; `assign.ts:126`; `supervision.ts:264`
- `plot-dispatch.sh:1449` — the manifest filename itself

**The plan's "What this does NOT do" list does not mention `session` at all**, so an implementer following it will read the field as out of scope and ship §1's stale join. This is the single most important thing the plan must add.

## 3. The plan's third motivation bullet mis-reads the operator, and Q3's answer is *the monitor still fires*

The plan repeats the operator's causal story verbatim:

> at 13:04:19Z the WorkerMonitor reported `idle` … Those commits were **861's**, still on the reused desk.

They were not on the branch. `reset_desk` detaches to `origin/main` before cutting the new branch:

```
skills/plot/scripts/plot-worker-loop.sh  (reset_desk)
  git -C "$wt" checkout --detach "origin/$main_branch" || return 1
  git -C "$wt" checkout -b "$branch" && return 0
```

and `monitor_has_commits` counts against `origin/HEAD` with a pathspec that excludes the empty claim commit (`plot-worker-monitor.sh:419-433`). So on a properly reset desk the commit condition should have REFUSED the finding. That it fired means either the reset fell through to the create path, or the branch already carried pushed work — **the plan has not established which, and the operator's explanation is the one thing here that is checkable and wrong.**

This matters for the plan's ordering claim:

> a fresh conversation is fast to start, so the 900 s silence goes away and the rule stops firing — by accident.

**It does not go away.** The monitor does not read the worker's session at all — it reads the newest mtime across *every* non-`agent-` transcript in the desk directory:

```
skills/plot/scripts/plot-transcript-quiet.sh:27-32
# THE TRANSCRIPT IS FOUND BY PATH, NOT BY SESSION ID — AND THAT IS A CHOICE
# … `.plot/worker-prompt.sh:29` DOES pass `--session-id` now … and this
# deliberately does not take it.
```

A fresh handle writes a NEW file in the SAME directory, so the quiet reading is unchanged in kind — and while the new conversation is loading its brief and repo, nothing writes at all. The 900 s window (`plot-worker-monitor.sh:285`) is crossed by any start slower than fifteen minutes, and the CPU check only rescues a worker with a child *on a core* (`:508-512`) — a model round-trip is not. **So the session fix does not make the idle rule quiet, and the plan's "second half, separate" framing is wrong about the dependency direction.** The idle rule is not downstream of the session fix; it is an independent live defect that the session fix does not touch.

The plan's Done-when *"The idle rule's commit condition is fixed or filed, named either way"* survives this, but its reasoning does not, and a slice that files it on the plan's stated grounds ("it got rarer") would be filing on a false premise.

## 4. Q2 — the location is right, and there is one gap the plan should name

`update_manifest_on_hop` is the only writer of `resumeId` and the only site holding both branches; the plan is correct. Its two callers are the hop (`:2310`) and nothing else. `session_handle` (`:716`) and `session_flag` (`:744`) are read once per prompt at `:1657-1659`, and `session_handle`'s only other caller is `:516`.

**The gap:** a fresh dispatch is fine (dispatch mints a new id, `plot-dispatch.sh:405-415`), and `--restart` is fine (Q4 — it routes through `start_worker`, which calls `plot_session_id()` and writes a brand-new manifest at `$manifest_dir/$session.json`; that is exactly why the operator's restart worked, and it is a *new agent*, not a re-handle). But a **resumed loop on a pre-`resumeId` manifest** falls through `session_handle` to `$PLOT_SESSION_ID` (`:722-723`), which is the launch id. That path never reaches `update_manifest_on_hop`'s comparison. It is narrow, but the plan claims the decision belongs in one place and should say this path exists.

## 5. What would make this proceed

- Replace *"the board will follow the newest slice and lose the previous one's"* with the measured fact: the board joins on `session` (`registry.ts:788`), keeps showing slice 1, and renders stale `model`/`contextTokens`/`lastActivity` for slice 2.
- Add the `session`-vs-`resumeId` decision to the Design, and list `session`'s nine consumers as the blast radius if it is made to follow the hop. Today "What this does NOT do" is silent on the field.
- Drop the claim that the commits were 861's, or establish it — `reset_desk` says otherwise.
- Drop *"the rule stops firing by accident"*. `plot-transcript-quiet.sh` reads the desk, not the session; a slow fresh start still trips a 900 s window.

## Against my own position

**The strongest case for `proceed`:** the rule — *a hand-over to a different branch mints a new handle* — is correct, the site is correct, and every finding above is about the plan's prose rather than its change. A competent implementer might read `registry.ts` while touching the manifest and discover §1 unaided.

I reject that for the plan's own reason. It wrote *"It may not discover this in review"* about precisely this question, then stated the answer wrongly. A plan that names a cost, gets it backwards, and forbids discovery has pre-committed the implementer to the wrong repair — and §1's real consequence (a permanently stale agent row) is quieter than the one described, so nothing will surface it.

**The strongest case for `reject`:** §2 could mean the fix belongs one layer up — the board's join is the actual defect, and the loop is behaving as designed. I do not go there: the operator measured a real worker killed by a real resume, and `--resume` crossing into another slice's brief is wrong on its own terms regardless of what the board reads. The change is right; its stated consequences are not.

**Where I am least certain:** §3's claim that the reset should have refused the finding. I read `reset_desk` and `monitor_has_commits` but could not inspect the `ewz-leg` desk. If that desk took the create path, the operator's account holds and only my explanation is wrong — the plan would still be repeating an unverified cause as a measurement.

**Host calls made: 1** (`gh issue view 1067`).
