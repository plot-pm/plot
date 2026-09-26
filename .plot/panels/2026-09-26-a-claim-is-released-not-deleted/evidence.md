# Evidence lens — a claim is released, not deleted

Position: amend
Evidence: executed

## 1. Is the defect real? — YES, but not the one the plan describes

**The statelessness claim is verified.** Two `plot-fleetctl.sh --once` runs, 293 lines each, byte-identical except the cost field:

```
tick 1: agents=4 left=4 reap=0 ... handed=0 held=287 not-claimable=287 unclaimed=2 cost=12034ms
tick 2: agents=4 left=4 reap=0 ... handed=0 held=287 not-claimable=287 unclaimed=2 cost=15524ms
```

`diff` reports one changed line. `grep writeFile|unlink|mkdir` over `entry/registryd.ts` returns nothing; `registryd.ts:169` states *"no journal, no lock file and no resume path"*. The daemon holds nothing between ticks. That half of the motivation stands.

**But the premise built on it is false.** The plan says: *"Pass A assigns the branch to agent 1. The assignment's only durable record is the claim ref."*

It is not. The durable record is the **manifest `branch` field**, and the estate says so in its own words:

- `plot-worker-loop.sh:634` — *"THE MANIFEST IS THE CHANNEL, AND IT IS NOT A NEW ONE. `branch` is already the agent's own field: written at spawn, rewritten on a hop, and cleared at the finish so `free = alive AND no branch` is observable. The registry writing it is what turns the empty value from a report into an instruction, and it needs no second file, no socket and no lock — **which is what keeps the daemon stateless across restarts**."*
- `rules/free.ts:64` — `isAgentFree` reads `reading.state` and `reading.branch`, where `branch` is documented at `free.ts:19` as *"The branch it holds, or `''` while it holds none"* and at `free.ts:5` as *"the manifest field the worker loop writes."*
- `adapters/performer/performer-shell.ts:50-72` — `assignSlice` writes `manifest.branch = branch` to `.plot/agents/<session>.json`. That is the assignment, performed.

Measured on the live estate: 4 manifests, one carrying `"branch": "bug/adoption-proposes-the-main-branch-key"`, three carrying `"branch": ""`. The assignment record is on disk, per-agent, and survives every tick.

**So deleting a claim ref does not erase the registry's record of the assignment.** It erases the *scan's* reading of the branch's state. Two different facts, and the plan conflates them — which is exactly what the plan's own Motivation heading claims is impossible (*"There is no way to clear one without the other"*). There is: `--release` as specified would clear the ref; the manifest field is cleared by a different writer entirely (`clear_manifest_branch`, `plot-worker-loop.sh:350`).

## 2. Does `--release` fix it, or move the problem? — IT MOVES IT, and I reproduced why

**The plan's step 5 does not happen.** Sandbox, real git, bare remote:

```
A1 claimed feature/y            # claim push OK
operator deleted feature/y      # the documented repair
A2 claim SUCCEEDED              # <-- plan says "rejected". IT IS NOT.
```

A deleted ref plus a fresh claim push **fast-forwards from nothing**. There is no rejection, because there is no ref to diverge from. Run twice, once with `feature/x` and once with `feature/y`, both times the second claim succeeded.

Worse, the two claim commits hash **identically** — `git commit --allow-empty -m "plot: claim <branch>"` over the same tree with the same message produces the same sha when author/committer match, so even a re-push by the original agent reported `Everything up-to-date`.

**The rejection fires later, and on the wrong agent.** Continuing the same sandbox:

```
A2 pushed real work             # remote now holds A2's commit
A1 (still alive) pushes work    # rejected-lines=2
```

The `REGISTRY LOCK VIOLATION` at `plot-worker-loop.sh:2328` is reached by whichever agent pushes **second onto diverged history** — which in the delete-then-reassign sequence is the agent that was there **first**. The plan's narrative has agent 2 rejected and abandoning its desk; the mechanism rejects agent 1. That inverts who loses work, and `--release`'s refusal set is built for the plan's version: it refuses on a live worker to protect the *holder*, but the holder is the one whose push dies.

**And `--release` cannot prevent the collision it targets.** Two independent reasons:

- The hand-over reads `slice.claimable` (`rules/queue.ts:40`) and `isAgentFree` (`rules/free.ts:64`). Neither consults a claim ref directly; `claimable` comes from the scan's branch-state word (`plot-fleet-scan.sh:77` — `open`/`wip`/`merged`/`claimed`/`deferred`/`unknown`). Clearing the ref *is* what makes the slice claimable again. `--release` clearing the ref **is the erasure**, performed by a blessed command instead of by hand. The slice returns to the queue either way — the plan says so itself in Design: *"the slice should return to the queue."*
- `assignSlice` **already refuses** the double assignment the plan is worried about: `performer-shell.ts:68` — `if (typeof manifest.branch === 'string' && manifest.branch !== '') return answered(false);` with the docstring at `ports/performer.ts:50`: *"IT REFUSES AN AGENT THAT ALREADY HOLDS A BRANCH... The refusal is a reading, not a judgement: `branch !== ''` on the manifest as it stands now."*

So the guard against handing one slice to two agents exists, is per-write rather than per-pass, and is not mentioned anywhere in the plan. What the guard does **not** cover is handing the *same branch* to a *different, genuinely free* agent — because it keys on the agent, not the branch. **That is the real gap**, and it is a missing check in `matchQueue`/`assignSlice`, not a missing operator verb.

## 3. What does the plan claim that code or measurement contradicts?

| Plan's claim | What I measured |
|---|---|
| *"the assignment's only durable record is the claim ref"* (Motivation, step 1) | The manifest `branch` field is the record — `plot-worker-loop.sh:634`, `free.ts:5`, `performer-shell.ts:69`. 4 live manifests carry it. |
| *"There is no way to clear one without the other"* | `clear_manifest_branch` (`plot-worker-loop.sh:350`) clears the assignment and touches no ref. The two are already separable, by design and with a stated rationale. |
| *"Agent 2's claim push is rejected"* (step 5) | Reproduced: it **succeeds**. A deleted ref leaves nothing to diverge from. |
| *"`matchQueue` states the backstop 'should never fire'; it fired"* | The docstring's wording is *"the push is demoted to a backstop that costs nothing and should never fire"* — scoped to agents that **select their own work** (`queue.ts` head: *"Every agent used to shop for its own branch"*). It never claimed immunity to an operator deleting refs. |
| *"nothing finds it"* (Why not detect instead) | `assignSlice` finds and refuses one shape of it, silently returning `false`; `registryd-main.ts:725` prints *"not handed — had already taken work"*. Reported, not absent. |
| `--release` is *"the second half nobody wrote"* of `--stop` | `workflows/dispatch-verbs.ts` holds `stopWorker` and `restartWorker` as domain rules with refusal enums. A third verb belongs there. The plan puts it in the shell script and names no domain rule — which the repo's own *"The Master Agent Uses The Controllers"* section forbids. |

Verified true: `--stop` keeps the claim (`plot-dispatch.sh:1702`, *"the claim stands until you release it"*; `dispatch-verbs.ts:90`, *"The worktree and its claim are left in place either way"*). And `plot-dispatch.sh:1174` does say *"a claim nobody can release."* The gap the plan points at is real; the mechanism it blames is not.

## 4. What must the plan say before someone builds it?

1. **Correct the premise.** Name the manifest `branch` field as the assignment record, and re-derive the defect from that. As written, the Motivation is disproved by `plot-worker-loop.sh:634`, and the "Why not make the daemon remember" section argues against a journal the estate already effectively has in per-agent form.
2. **Fix the sequence.** Step 5 is not reachable as written — I ran it. State which agent's push is rejected (the first one's, onto history the second recreated) and what that means for whose work is lost.
3. **Say what `--release` clears, field by field.** *"Removes the registry's record of the hand-over"* names no file. It must say: the remote ref, **and** `manifest.branch` of the agent that held it — and then confront that clearing `manifest.branch` on a **live** agent is exactly the strand `performer-shell.ts:66` refuses to create.
4. **Account for `assignSlice`'s existing refusal**, and state whether `--release` is meant to complement it or whether the real fix is a branch-keyed check in `matchQueue` — no free agent may be handed a branch another agent's manifest already names. That check is ~3 lines, is per-pass-safe, and closes the case an operator verb cannot.
5. **Route the verb through the domain.** `stopWorker`/`restartWorker` live in `workflows/dispatch-verbs.ts` with `DispatchRefusal` members. `releaseClaim` must join them, or CLAUDE.md's controller rule is broken by the plan that cites the estate's own discipline.
6. **Add a refusal the plan is missing**: a branch whose ref carries commits the remote does not have elsewhere. The plan's *"refuses a branch carrying real work"* is in Done-when but appears in no Design section, and it is the one refusal standing between this verb and destroyed work.
7. **State the ordering hazard.** Between `--release` clearing a ref and the next tick's hand-over, the branch is `open`. Any agent still alive on it pushes into a recreated ref. The plan's live-worker refusal covers the moment `--release` runs, not the window after it.

## 5. Through this lens: what did executing reveal that reading would not?

**Reading the plan, the sequence is persuasive — and step 5 is simply false.** Every juror who only read would have accepted *"Agent 2's claim push is rejected"* because it is stated as a measurement, quotes a real log line, and names a real branch. The log line is real. The causal story attached to it is not. It took a bare remote, two clones and four pushes to find that a deleted ref makes the next claim **succeed**, and that the rejection lands on the agent that was there first.

Two more things only execution surfaced:

- **The identical-hash effect.** `git commit --allow-empty -m "plot: claim <branch>"` reproduces the same sha across clones when author and committer match, so the claim push is idempotent in a way no reader would predict — `Everything up-to-date` rather than either success or rejection. Any test written for this plan that asserts "second claim rejected" will pass or fail on whether the fixture varies the author, not on the rule.
- **`feature/the-board-filters-to-my-work` still exists on the remote right now** (`git ls-remote origin` returns it), and `docs/plans/2026-09-26-the-board-updates-an-index.md:61` records it against desk `free-83d3325b` with `pid 34787 live`. That desk's manifest today names `bug/adoption-proposes-the-main-branch-key` and pid 34787 is alive on that branch. The agent hopped on normally. The incident's own artefacts are not in the state the plan implies, so the measurement needs re-taking before it is built on.

**Amend.** The gap is real and worth closing — `plot-dispatch.sh:1174` names it and no command answers it. But the plan's mechanism is disproved by reproduction, its central premise is contradicted by the estate's own comments, the guard it says is missing partly exists, and the fix it proposes performs the erasure it sets out to prevent. Built as written it ships a verb that returns a slice to the queue through a blessed path and leaves the live-agent collision exactly where it is.
