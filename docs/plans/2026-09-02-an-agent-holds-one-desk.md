# An agent holds one desk

> A desk is created per branch and freed by nobody, so 2 agents hold 11 worktrees. The agent takes both ends of its desk's life: it decides create-or-reset when it takes a brief, and the registry — not dispatch — matches work to whoever is free.

## Status

- **Phase:** Approved
- **Type:** bug
- **Story:** the-master-agent-holds-the-fleet
- **Review:** in-session
- **Impl:** own branches
- **Rounds:** 2
- **Approved:** 2026-09-02, Jan Wloka, in-session
- **Started:** 2026-09-02, Jan Wloka, `feature/an-agent-says-when-it-is-free`
- **Started:** 2026-09-03, Jan Wloka, `feature/an-agent-decides-create-or-reset`
- **Started:** 2026-09-03, Jan Wloka, `feature/the-sweep-names-every-leftover`
- **Started:** 2026-09-03, Jan Wloka, `docs/the-desk-belongs-to-the-agent`
- **Started:** 2026-09-03, Jan Wloka, `feature/the-reaper-sweeps-every-kind`

## Changelog

- An agent keeps one desk for its whole life instead of creating one per branch: it resets the tree it holds when the tree allows, and `plot-reap.sh` drops from the routine cleanup path to the repair for agents that died holding one.

Board impact: yes. The registry rows the board renders come from manifests, and today 25 of 26 are synthesized because desks outnumber identities. Fewer desks and one manifest per agent changes what the Working section counts.

## Motivation

**Measured 2026-09-02, this estate: 2 manifests, 11 worktrees, 8 loop processes, 5 desks whose branch already merged.** An identity issued once per agent is being issued once per slice, and the desks pile up beside it.

The two design specs contradict each other on the one question that decides this:

| Spec | Who creates the desk |
|---|---|
| `DESIGN-worktree.md:60` | *"The dispatcher creates it, the agent owns it."* |
| `DESIGN-agent.md:172` | *"a dispatch goes to a free agent"* — so it creates nothing |

`DESIGN-agent.md:65` states the model the code does not implement: *"agent ──owns──► a worktree (its desk, while it lives)"*. **While it lives** — one desk per agent. `plot-worker-loop.sh:723` creates one per branch, and the only `worktree remove` in that block is the race-loss path at `:730`.

So the loop hops to a new desk and abandons the old one in place. `DESIGN-agent.md` already names the consequence — *"That is where the 13 dead trees come from … nothing outside the loop owns their removal"* — and the invariant that fails: **every agent has a worktree, and no worktree is left behind.**

### What it cost, on the day this was written

- **19 desks** reaped by hand, every one held back by a single untracked file the ignore list had missed
- **the vendor-list agent** reported `"finding": "clear"` — *this desk owes nothing measurable* — while its PR sat CONFLICTING for an hour. It knew its job was done and had no authority to free its desk.
- **25 of 26 registry rows synthesized**, because a desk created by the loop's hop carries no manifest and is indistinguishable afterwards from one that does

`plot-reap.sh` is the only actor that ever removes a desk, which is why it needs five refusals to be safe. That is a backstop doing a lifecycle's job.

## Design

### Approach

Four owners, each with exactly one job.

```
dispatch  ──(slice + brief)──►  registry     and returns
registry  ──waits──►  an agent goes FREE
registry  ──hands over──►  that agent
agent     ──decides──►  create a desk, or reset the one it holds
agent     ──works the brief──►  opens its PR  ──►  goes FREE
reaper    ──repairs──►  desks whose agent died
```

**An agent is started with a manifest.** The registry spawns it, N at a time, on the operator's ask. Spawning an agent *is* starting its process — `DESIGN-agent.md:157`, *"nothing starts a worker"*. The manifest is its identity card and lasts its whole life.

**A slice is handed over with a brief.** The brief is already the unit of hand-over: `plot-dispatch.sh:343` calls it *"its specification"*, and the gate at `:2555` refuses a slice that has none. What is missing is somebody to hand it to.

**Dispatch hands slice + brief to the registry and returns.** It does not create a desk, does not wait, and does not refuse on `0 free` — an earlier draft of this plan proposed that refusal and it is wrong: it would make dispatch synchronous with fleet capacity, the same coupling `DESIGN-machine.md` §10 spent two revisions rejecting. The queue absorbs the timing.

**The registry holds the queue and matches on the free event.** `free` becomes something an agent announces when it finishes a slice, not a state anything polls. That is why the loop's `--offline --next` disappears rather than being fixed: the agent stops shopping for its own branch, and so stops taking a branch without a work order.

**The registry is the assignment lock, and there is only one.** It hands a slice to one agent and never hands the same slice out twice. `--offline --next` goes with it: no agent selects its own work, so two agents racing for one branch stops being reachable rather than being caught.

**Git's refusal is not a second lock — it is a property that cannot be removed.** `DESIGN-branch.md:64` settles why: *"A Branch is the only entity here whose source is git itself... a Branch **is** `refs/remotes/origin/<name>`."* An agent that works on a branch pushes it, and git rejects a push to a ref that already exists and diverged. That refusal happens whether or not anything intends it as a lock.

**So it is demoted, not deleted.** Today `DESIGN-branch.md:52` calls the push *"the whole locking mechanism"*, and today that is accurate: nothing assigns, every agent shops through `--next`, and git's refusal is genuinely all that prevents a collision. Once the registry assigns, the same refusal becomes a backstop that costs nothing and should never fire — the relationship the reaper now has to desks.

**A rejected claim push therefore stops being routine and becomes an alarm.** `plot-worker-loop.sh:729` treats one as ordinary — *"another worker won the race"* — and under this model it is a registry bug reporting itself. It must be logged loudly rather than swallowed, because the estate is protected at the moment the invariant is already broken.

**The registry that does this is `plot-registryd`, and it is no longer deferred.** `readAgentRegistry` is a read over manifest files — it cannot wait for anything, so this plan needs the daemon `the-registry-supervises-its-agents` describes. That wave was gated on *"stranded, reported, and still not picked up by a person"* measuring non-zero, and **2026-09-02 supplied it**: 19 desks with merged PRs reaped by hand, 2 sitting as `unknown` agents until the operator pointed at them, 1 holding a `PLOT-BLOCKED` marker for 13 hours after a merge had answered its question. Reporting made every one visible and cleared none. **The gate was lifted the same day** — so this plan depends on a wave that is now startable, not on one that is parked.

**The agent decides create-or-reset**, because it is the only party that can see its own tree. The registry sees identities; the machine sees processes; only the agent at the desk sees uncommitted changes, a `PLOT-BLOCKED` marker, or a checkout still on a merged branch.

- clean tree, branch merged → **reset**: check out `origin/<main>` first, then the slice's branch
- anything unlanded → **create** a new desk and leave this one for repair

**The reset checks out the base before the branch, and that order is the point.** `.gitignore` is per-checkout: a worktree sees an ignore entry only once its base branch carries it, which is what stranded 19 desks on 2026-09-02 — every one held by an artifact the ignore list had gained after those desks were cut. A desk switching straight to a branch that already exists from an earlier attempt inherits *that* branch's rules. Landing on the base first makes the desk's state independent of whatever it held before, for one extra checkout.

**It does not `reset --hard` or `clean -fdx`.** Those destroy whatever the create-or-reset guard failed to notice — and the guard being wrong is exactly the case where destruction cannot be undone. A guard that misjudges should leave a desk the sweep reports, not deleted work. The asymmetry is the whole argument: a leftover desk costs a sweep, lost work costs the work.

A measurement, not a policy — the same shape as every refusal `plot-reap.sh` already makes. `git worktree add` becomes the exception, so a full checkout is paid once per agent rather than once per slice.

**Taking over a brief IS the freeing.** The agent resets the desk it holds and the old checkout ceases to exist, so nothing is abandoned and `finished → reapable → gone` needs no separate step for the normal path.

**The reaper sweeps what was overlooked, whatever overlooked it.** An earlier draft of this plan scoped it to *"desks whose agent died"*, and that is too narrow. A desk is one kind of leftover; the estate accumulates several, and only some are covered today:

| Leftover | Swept by | Measured 2026-09-02 |
|---|---|---|
| worktrees | `plot-reap.sh` | 19 reaped by hand |
| worker files, registry entries | `plot-reap.sh` | with the tree |
| remote refs | `plot-release-refs.sh`, plan-scoped | 9 deleted, scan 218.5 s → 111.5 s |
| **local branches** | **nothing** | **85 of 98 already merged** |
| **orphaned claim refs** | **nothing** | a claim whose agent never existed |
| **dirty trees nobody owns** | refused, never resolved | 2 desks, 52 and 1 files |

The sweep answers one question — *is anything here that nobody is coming back for?* — and it does not care whether the cause was a dead agent, an interrupted dispatch, a `--stop`, or a merge somebody did on the host. Its five guards stay exactly as written: they were written for precisely this population, and a backstop that guesses is worse than none.

**The asymmetry between kinds is deliberate and stays.** A removed checkout comes back with `git worktree add`; a deleted remote ref does not. So worktrees are swept estate-wide and refs stay plan-scoped, which is the licence `plot-release-refs.sh:28` already argues.

**A local branch is not the third case it first looks like.** An earlier draft of this plan called it *"the last copy of a reflog"* and borrowed the remote-ref caution for it. That is wrong: a local branch whose PR merged is re-fetchable from `origin`, so it is a copy, not the copy, and the argument that protects remote refs does not transfer.

**But `git branch -d` is not the gate either.** It refuses an unmerged branch, which sounds like the safety this needs — except **squash-merge leaves a branch permanently ahead of main**, the same trap `plot-pr-merged.sh` exists for. `-d` would refuse all 85 of them, for the wrong reason. So the gate is the reaper's rather than git's:

> **the host says merged, AND no worktree holds it → delete**

Two measurements, the shape every other refusal in this estate is written in. The second half matters on its own: deleting a branch out from under a checkout is exactly what the reaper's guards exist to prevent.

**Report-only was the alternative, and 85 rows is the argument against it.** A sweep that reports and never acts becomes one more thing a person has to clear — the problem this plan exists to remove, reintroduced one level up.

### Open Questions

- [ ] **Where does the queue live — derived or stored?** Plot's discipline is that git is the source of truth and state is derived. Derived: an eligible slice with a brief and no claim *is* queued, so the queue is the fleet scan's existing output and nothing new is stored. Stored: the registry keeps ordering and assignment records, which is the first piece of fleet state git does not hold. This plan argues derived, and the daemon's own design agrees — `the-registry-supervises-its-agents` specifies it *"stateless across restarts by construction"*, which a stored queue would break. Settle it there rather than here.
- [x] **What announces `free`? The manifest, by naming no branch.** A manifest already carries `branch` and `worktree` as live fields — `update_manifest_on_hop` rewrites both when an agent changes slice — and `DESIGN-agent.md:80` already says an agent between units holds none: *"that is why `branch` is optional"*. So `free = process alive AND manifest names no branch`, derived from two facts that exist, storing nothing new.

  **Not the tree.** `plot-worker-state.sh:46` derives `waiting` and `stalled` from the desk, which is right for those — they are claims about work left behind. `free` is not a property of a desk: under this plan the desk persists across slices, so a clean desk says nothing about whether its agent has been handed the next brief.

  **Not an announced marker.** It is stored state with a gap the other two lack — an agent that crashes between finishing and announcing is free and does not say so. `PLOT-BLOCKED` survives that objection only because a blocked agent is by definition still alive to write it.

  **What wave 1 must therefore fix:** `branch` is set at spawn and rewritten on hop, but never *cleared*, so "no branch" is unreachable today. Clearing it on finishing a slice is the deliverable.
- [ ] **What happens to a queued slice when every agent dies?** The queue outlives its agents by design. Whether it survives a machine restart depends on the answer above.
- [ ] **What is the scope of the queue and the free-agent pool — one machine, or the estate?** `elsewhere` means *no worktree on this machine*, so the model already anticipates several, and `DESIGN-machine.md:147` measured six live boards across three projects. A daemon and its queue live on one machine. Either each machine runs its own daemon over the same repo, or the queue derives from git and every machine sees the same work while handing only to its own agents. The second reintroduces the double-assignment the registry lock is meant to end, one level up.
- [ ] **What happens to the desks that exist at cutover?** This estate carried 11 worktrees, 8 loop processes and 1 manifest while the plan was written — desks made under the old model, most with no identity. The sweep wave probably *is* the migration, since an old desk is exactly the leftover it already handles, but the plan should say so rather than leave it inferred.
- [ ] **What sets N, the number of agents?** The plan says the registry spawns *"N at a time, on the operator's ask"* and never says where N comes from, or what happens when the queue is longer than N. `DESIGN-agent.md:174` answers the first half — the machine measures pressure and reports it, the operator reads it when choosing N, and nothing refuses or defers. The board already carries a `parallel agents (cap)` control. The second half is unanswered: a queue longer than the pool is the normal case, not an error.
- [ ] **Does an agent ever hold a desk on a branch it is not working?** Between units it is `running`, has no branch, and holds a desk sitting on something. What that tree points at while idle is unspecified.

## Branches

### Naming what is free

- `feature/an-agent-says-when-it-is-free` — derive availability and make it observable. `DESIGN-agent.md:483` states the gap: the eight process states deliberately do not answer *can this agent take work?* — `running` is not busy (an agent between units is running with no branch, and is available), `finished` is not free (its worker exited and nothing marks the transition). Nothing else in this plan is reachable until something can answer it. (#670)

### Holding one desk

- `feature/an-agent-decides-create-or-reset` — the agent takes both ends of its desk's life. `plot-worker-loop.sh:723` stops creating a desk per branch; the agent resets the tree it holds where the tree allows, and creates one only where it does not. The old desk stops being abandoned because it is the same desk. (#671)

### Sweeping what was overlooked

- `feature/the-sweep-names-every-leftover` — extend the estate sweep past worktrees. **Measured 2026-09-02: 85 of 98 local branches already merged, and nothing sweeps them** — the largest leftover population here, and the one no script looks at. Orphaned claim refs and unowned dirty trees are the same shape: something nobody is coming back for, with no actor. Keep the reaper's five refusals and its per-kind licence. A local branch is deleted on two measurements — the host says merged, and no worktree holds it — never on `git branch -d` alone, which refuses a squash-merged branch for the wrong reason. (#672)

### Wiring the sweep

- `feature/the-reaper-sweeps-every-kind` — give `packages/domain/src/rules/sweepable.ts` a caller. **Measured 2026-09-03, after `the-sweep-names-every-leftover` merged as `ec634c2a`: the rule is complete and tested, and nothing outside the domain imports it** — `plot-reap.sh` still sweeps worktrees only, and this estate carries 109 local branches. The rule decides; an adapter has to reach the world, which is the layering rule working as intended and a job only half done. Wire the three kinds it names — `local-branch`, `claim-ref`, `dirty-tree` — keeping the reaper's shape: `--dry-run` by default, `--yes` to act, `--max N` per kind.

### Saying so in the specs

- `docs/the-desk-belongs-to-the-agent` — amend the two sentences this plan contradicts. `DESIGN-worktree.md:60` says the dispatcher creates the desk; the agent does. `DESIGN-branch.md:52` says the push is *the whole* locking mechanism; it stops being that the moment the registry assigns, and becomes a backstop that should never fire. Record the measurement that settled the first and the reasoning that demoted the second — neither sentence was wrong when written. (#673)

### Handing work over

- `feature/the-registry-queues-a-brief` <!-- waits: feature/the-registry-supervises-its-agents --> — dispatch hands slice + brief to the registry and returns; the registry matches on the free event. **Waits on the daemon**, because `readAgentRegistry` is a read and cannot hold work for anyone. `plot-dispatch.sh:2503` stops calling `git worktree add`, and the brief gate at `:2555` moves to the hand-over rather than the launch.

## Notes

**This plan came out of a conversation, not a bug report.** The estate was cleaned by hand first — 19 desks reaped, two stale ones removed — and the questions that produced the model came after, in order: *why do we still see that* → *why don't agents reuse the desks* → *when is an agent created, when is its desk* → *by whom*. The measurements above are from that session and are the argument.

**Two claims in it were wrong and are recorded because they were corrected:**

1. *"The worker loop ends at PR-open."* It does not — `plot-worker-loop.sh:716` asks `--next` and hops. The loop already implements taking a next unit; what it gets wrong is the desk and the missing brief.
2. *"Dispatch should refuse on `0 free`."* Wrong for the reason in Approach: it recreates the capacity coupling the machine spec rejects. The queue is the answer, not a refusal.

**Round 1, 2026-09-02, in-session.** Four challenges, three of which changed the plan and one of which changed another plan:

1. *"The registry cannot wait — it is a read, and the daemon that could is deferred."* Correct. The gate on `the-registry-supervises-its-agents` was checked against its own condition, found satisfied by this day's measurements, and lifted. The dependency is now a `waits:` annotation rather than an assumption.
2. *"What is the source for `free`?"* Settled on the manifest naming no branch — see Open Questions. The finding that mattered: `branch` is never cleared today, so the deliverable is smaller than it looked.
3. *"A local branch is the last copy of a reflog."* Wrong, and corrected above: it is re-fetchable from origin. The real trap is that `git branch -d` refuses a squash-merged branch, so the gate is the reaper's two measurements.
4. *"What does a reset actually do?"* The base-then-branch order, for the `.gitignore` reason that stranded 19 desks the same day.

**Round 2, 2026-09-02, in-session.** One challenge answered, three left open above.

The answered one: *"the registry should be the assignment lock — why two locking mechanisms?"* Because the plan had not said which one wins. It does now: the registry assigns and is the only lock, `--offline --next` goes, and git's refusal is demoted to a backstop that cannot be removed and should never fire. The consequence worth catching is small and specific — a rejected claim push is currently treated as routine at `plot-worker-loop.sh:729`, and under this model it is a registry bug reporting itself.

**The gated wave moved to last, 2026-09-03.** *Handing work over* was written third, and it carries `waits: feature/the-registry-supervises-its-agents` — a branch with no PR yet. Waves are sequential, so an eligible-but-blocked wave 3 held waves 4 and 5 behind it although neither depends on it: the dispatch after wave 2 merged offered the blocked branch, refused it correctly, and started nothing.

**A `waits:` annotation and a wave position are different orderings, and a plan must not use the first where it means the second.** The annotation says *this branch needs another branch*; the position says *this wave needs the wave before it*. Putting a cross-plan dependency in the middle of a sequence makes every later wave inherit it. So the branch that waits goes last, where its own gate is the only thing it blocks.

**What is NOT in scope.** The `Slice`/`Wave` naming defect (`CLAUDE.md` records it as known, with its own plan) is untouched here, though this plan's branches sit next to it. So is the `HostBackend` layering exception — a different plan closed that today.
