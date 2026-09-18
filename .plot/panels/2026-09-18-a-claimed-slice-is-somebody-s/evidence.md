# Juror: the evidence

Lens: every measurement was taken by one agent in one hour on a loaded machine. Re-taken independently 2026-09-18 ~13:30 CEST, on the live estate, read-only.

Position: amend

## Summary

Every reproducible measurement in this plan **survives re-taking**, and two of them reproduce more strongly now than the plan claims. I set out to refute and could not refute the findings. I did refute **one factual sentence**: the two line numbers the plan offers for where the stranded desk and claim are created are both wrong, and one of them names code whose own comment says it no longer does that. That sentence is load-bearing for slice 1 (it is the plan's answer to *"where that happens is the first thing to establish"*), so this is `amend` rather than `proceed`.

---

## 1. The claim ref, the desk, the brief — CONFIRMED, with the situation moved

The claim commit exists and is exactly what the plan says:

```
$ git show --stat --no-patch d95614695
commit d9561469551ebf4b01a3cd348c0bcd2703be1c23
Date:   Fri Sep 18 12:30:33 2026 +0200

    plot: claim bug/the-reading-carries-which-stopped
```

It is an **empty** commit (no stat output), which is what makes it a claim marker under `plot-fleet-scan.sh:212` — *"BOTH titled `plot: claim ...` AND empty"*. The plan's `d95614695` is accurate to the character.

The brief is on `origin/main`:

```
$ git cat-file -e origin/main:.plot/briefs/the-reading-carries-which-stopped.md
BRIEF EXISTS on origin/main
```

The desk exists, and the branch exists locally and remotely.

**What I cannot verify retrospectively, and say so:** the situation has moved exactly as the task warned. A worker (pid 26405) is now running on that branch and has pushed four real commits on top of the claim:

```
$ git log --oneline origin/main..origin/bug/the-reading-carries-which-stopped
cf0aaab5f plot: changeset for the reading carries which stopped
dba44410e plot-fleet: the exit-code lock drives the real status arm
f1e08ebcc plot: the supervisor reading carries which stop it is
59c2e09e0 plot-fleet: --status names which kind of stopped on the summary line
d95614695 plot: claim bug/the-reading-carries-which-stopped
```

So the *stranded* window (claim at 12:30:33, worker arriving later) is over. The desk `plot-wt-bug-the-reading-carries-which-stopped` has mtime `Sep 18 13:17:53` — **47 minutes after the claim**. That gap is itself corroboration of the plan's account: the claim preceded the desk-with-a-worker by three quarters of an hour, and during that window nothing reported it. I cannot re-measure the window; I can confirm its endpoints.

## 2. `handed=0` and "in no hold list at all" — CONFIRMED, and it is not truncation

I ran the tick. It is safe as documented (decides and performs nothing).

```
$ skills/plot/scripts/plot-fleetctl.sh --once
plot-registryd tick agents=5 left=5 reap=0 correct=0 person=0 defer=0 handed=0 \
  held=250 idle=4 already-merged=0 merge-unknown=0 no-brief=1 not-claimable=249 \
  no-free-agent=0 unclaimed=5 cost=38768ms
```

`handed=0` reproduces on a fresh tick today, with `idle=4` — four agents sitting free while 250 branches are held.

**Does `--once` name every held branch, or truncate?** I checked the arithmetic rather than trusting the prose, because "the list is complete" is precisely the assumption the plan's inference rests on:

```
$ awk '/held on not-claimable/{f=1;next} f&&/^    [a-z]/{n++} END{print n}'
249
$ awk '/held on no-brief/{f=1;next} /held on not-claimable/{f=0} f&&/^    [a-z]/{n++} END{print n+0}'
1
```

249 printed against `not-claimable=249`; 1 printed against `no-brief=1`. **Nothing is truncated.** The plan's *"`--once` names every hold every time, so a missing branch is not a missing key"* is verified by counting, not by assertion.

And the subject branch:

```
$ grep -c 'the-reading-carries' tick1.txt
0
```

**Named nowhere in 260 lines of tick output.** The plan's central inference — the slice was outside the queue's population entirely, not in a hold list under a key nobody read — is correct. This is the finding, and it is real.

I note the tick carries `unclaimed=5`, a key the plan does not mention; those are the five undispatched worktrees the tick names at the top. It is not the same population and does not weaken the finding.

## 3. The three-way disagreement on `free-37073204` — ALL THREE CONFIRMED, live

I re-took all three independently.

**The manifest.** Still present, still `branch: ""`:

```json
{ "session": "89bfb811-...", "branch": "", "pid": "20771",
  "startedAt": "2026-09-18T04:20:56Z", "slug": "a-stopped-fleet-names-its-repair" }
```

**Pid 20771 — alive**, now for over seven hours:

```
$ ps -p 20771 -o pid,ppid,etime,stat,command
  PID  PPID  ELAPSED STAT COMMAND
20771 20719 07:10:58 SN   bash skills/plot/scripts/plot-worker-loop.sh
```

**`plot-worker-state.sh` — still `stalled`:**

```
$ source skills/plot/scripts/plot-worker-state.sh
$ plot_worker_state "$PWD/.worktrees/free-37073204"
stalled	20771
```

The desk is still checked out on the merged branch, and the five scratch files are still there:

```
$ git -C .worktrees/free-37073204 branch --show-current
bug/the-index-is-read-once
$ git -C .worktrees/free-37073204 status --porcelain
?? do_transform.py
?? footer.txt
?? run_transform.sh
?? section6.txt
?? transform_final.py
```

**One correction to the plan's framing, in the plan's favour.** The manifest's `worktree` field now reads `plot-wt-bug-the-reading-carries-which-stopped`, not `free-37073204` — agent `89bfb811` has hopped on. But `free-37073204/.plot-worker.pid` still contains `20771`, so the desk still points at the same live pid. The disagreement has not been repaired; it has been *compounded* — one pid is now claimed by two desks.

**The strongest independent confirmation is `--status`, which I ran and the plan does not quote:**

```
$ skills/plot/scripts/plot-fleetctl.sh --status
  bug/the-index-is-read-once  stalled (pid 20771)
  ...
  bug/the-reading-carries-which-stopped  running (pid 26405) — quiet 219s
summary: agents_running=1 agents_other=10 supervisor=up
```

A finished, merged, idle agent is reported to the operator as **`stalled`** right now, seven hours in. `agents_running=1 agents_other=10` is the operator-visible cost. The plan understates this: it presents `stalled` as a board rendering problem, but `--status`, the fleet's own CLI, says it too.

The plan's log quote is verbatim:

```
plot-worker-loop: free on ? — nothing handed over yet. Waiting to be handed work
```

And the worker monitor independently agrees the agent is idle, not working:
`"finding":"idle" ... "the agent pid 20771 is alive but its transcript has been silent for over 900s"`.

## 4. The squash-merge claim — CONFIRMED

```
$ git cat-file -p f1829422... | grep -c '^parent'
1
$ git log --oneline -1 f1829422022da2a74d7adcf16b0ae1ac96ef2089
f18294220 The index is read once (#948)
```

**One parent = squash.** PR #948 is `MERGED` per `plot-host.sh pr-state`. The branch carries **6 commits** beyond `origin/main` and `git merge-base --is-ancestor` says `NOT ANCESTOR` — permanently ahead, exactly as the plan and CLAUDE.md describe.

I checked the work genuinely landed rather than assuming it: the squash commit `f18294220` touches the same files the branch added (`plot-reconcile-scan.sh`, `test/reconcile/index-read-once.test.mjs`) and its message describes the same change. So `stalled` is being derived from commits whose content **is** in main. The plan's diagnosis — *right about the tree, wrong about the question* — holds.

## 5. The reaper's refusal order — CONFIRMED

The plan says the untracked scratch files "were never the reason". The ordering is not in the shell; it is `reapProblems` in `packages/domain/src/rules/reapable.ts:87`:

```ts
export const reapProblems = (readings: TreeReadings): ReapProblem[] => {
  const problems: ReapProblem[] = [];
  if (readings.workerPid !== null && readings.workerPid !== '') {
    problems.push({ refusal: 'live-worker', detail: readings.workerPid });
  }
  if (readings.blockedMarker) { ... }
  if (readings.dirtyPath !== '') {
    problems.push({ refusal: 'uncommitted-changes', ... });
  }
```

`live-worker` is **first**; `uncommitted-changes` is **third**; the docstring says *"most urgent first"* and `plot-reap.sh:595` renders `live-worker` as `worker alive (pid $detail)`. With pid 20771 alive, the reaper stops at the first refusal and never reaches the scratch files. **Verified.**

## 6. THE REFUTATION — the two line numbers are wrong

This is what I actually found by looking, and it is the reason for `amend`.

The plan writes:

> **Where that happens is the first thing to establish**, and this plan does not guess at it: the claim commit is `d95614695`, and the paths that create desks are `plot-dispatch.sh:2057` (`--start`) and `:2925`.

Both references fail.

**`:2925` is not a desk.** It is the `Started:`-record booking worktree:

```
$ sed -n '2925p' skills/plot/scripts/plot-dispatch.sh
  if ! git worktree add -q -B "$bookbr" "$tmpwt" "origin/$MAIN" 2>/dev/null; then
```

Its own comment two lines above: *"a leftover branch from an earlier failed booking ... It is disposable by construction — created here, pushed, deleted."* The error message below it says *"The branches were dispatched; only the plan's Started record is missing."* This is a temporary tree on `origin/$MAIN` for booking a record. It is not a slice desk and cannot strand one.

**`:2057` is the free-agent desk, and it is detached — so it cannot be the stranded claimed desk either:**

```
$ sed -n '2057p' skills/plot/scripts/plot-dispatch.sh
    if ! git worktree add -q --detach "$start_wt" "origin/$start_main" 2>/dev/null;
```

`--detach` at `origin/main`. It holds no branch, so it cannot produce a desk-plus-claim on `bug/the-reading-carries-which-stopped`. (This same line does confirm a *different* plan claim — that `--start` cuts detached — which is why the plan's §"A free agent's desk reads as stalled work" is right while this sentence is wrong.)

**`plot-dispatch.sh` no longer creates slice desks or pushes claims at all.** Line 3626 says so explicitly:

```
  # `git worktree add` USED TO BE HERE, with a claim push behind it and a worker
  # start behind that. All three are gone, and each for its own reason:
  #   THE DESK. ... One desk per agent, not one per slice.
  #   THE CLAIM. ... Claiming here would take the slice straight back out of
  #   the queue it was being put into.
  #   THE WORKER. ... nothing starts a worker
```

That last comment is the plan's own thesis, already written in the code — and it means the plan is pointing at the wrong component.

**The actual claim-pusher is the worker loop:**

```
$ grep -rn "plot: claim" skills/
skills/plot/scripts/plot-worker-loop.sh:2307:  git -C "$hop_wt" commit --allow-empty -m "plot: claim $next_branch"
```

This is inside the **branch-hop** path: an agent that finishes a slice asks `--next`, takes a branch, and claims it itself in its own desk (`$hop_wt`). The timeline fits precisely — agent `89bfb811` (`startedAt 04:20:56Z`) finished `the-index-is-read-once` (#948 merged), went free (`branch: ""`, `free on ?`), and the claim for `the-reading-carries-which-stopped` appears at 12:30:33 with the worker desk following at 13:17.

**Why this matters rather than being a nitpick.** The plan's §"The rule records this failure as fixed, and a desk was stranded anyway" argues the brief gate moved but *"a desk and a claim were still created ahead of the hand-over"*, and offers these two lines as where. If an implementer follows them, they will audit `plot-dispatch.sh` — a file whose relevant code was deliberately deleted and whose comment says so — and find nothing. The real site is `plot-worker-loop.sh:2307`, a different component with a different lifecycle (an agent hopping between slices, not a dispatcher fanning out). The plan's stated virtue here is *"this plan does not guess at it"*; on this one sentence it did guess, and guessed wrong.

## 7. Claims asserted with no evidence

Fair game per my brief, listed by how much weight they carry.

- **`"Four consecutive supervisor ticks reported handed=0"`** — I reproduced `handed=0` on a fresh tick, so the substance is sound, but *four consecutive* is a count from a session log nobody can re-read. A single tick is what is actually evidenced. Not a defect in the finding; it is precision the plan claims and cannot support.
- **`"plot-fleetctl.sh --status showed the desk in state none"`** — I cannot reproduce this, and today `--status` shows `running (pid 26405)` for that branch and `stalled` for the other desk. `none` is plausible for the stranded window but is unverifiable now. The plan should not lean on it.
- **Slice 1's `elsewhere` requirement** — *"a claim held by an agent on another machine is not reported as unworked"* is asserted with no measurement of whether any such claim exists on this estate. It is a correct safety property and I would keep it, but the plan states the population is to be *"measured on this estate and the number stated"* only for the main finding, not for this exclusion. Worth requiring the `elsewhere` population be counted too, or the test will be written against a case that never occurs here.
- **`"The board renders the first"`** — no file, line, or screenshot. It is probably true (and `--status` renders `stalled` too, which I did verify), but as written it is the one claim about the board in a plan whose Board-impact note promises a row's state word changes.
- **`"the second by an operator reading the board and asking what a stalled row meant"`** — anecdote, self-described as such in Notes. Harmless.

## What I could not refute

I want to be explicit that the two headline findings survived a genuine attempt to break them:

1. A claimed slice with no agent is reported by **nothing** — proven by counting the tick's own lists to completeness, not by reading its prose.
2. A free, finished, merged agent reads `stalled` — proven live, in `--status`, at seven hours, with the squash confirmed at one parent and the content confirmed in main.

Both are real defects and both deserve fixing. The remedies (report + `--restart`; ask `plot-pr-merged.sh`) follow from the evidence and add no state.

## What `amend` asks for

1. **Replace the sentence naming `plot-dispatch.sh:2057` and `:2925`** with `plot-worker-loop.sh:2307`, and reframe that paragraph: the desk and claim are created by an **agent hopping to its next slice**, not by dispatch ahead of a hand-over. This changes where slice 1 looks.
2. **Drop or hedge `--status showed the desk in state none`** and `four consecutive ticks` — say what a single tick shows, which reproduces.
3. **Require the `elsewhere` population be counted**, not just excluded by assertion.
4. Optionally, cite `--status` as a second reader of `stalled`. It strengthens the case and is currently missing.

None of these touch the two findings or the two remedies. The plan is right about the estate and wrong about one file.
