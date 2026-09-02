# An agent holds one desk

> A desk is created per branch and freed by nobody, so 2 agents hold 11 worktrees. The agent takes both ends of its desk's life: it decides create-or-reset when it takes a brief, and the registry — not dispatch — matches work to whoever is free.

## Status

- **Phase:** Draft
- **Type:** bug
- **Story:** the-master-agent-holds-the-fleet
- **Review:** in-session
- **Impl:** own branches

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

**The agent decides create-or-reset**, because it is the only party that can see its own tree. The registry sees identities; the machine sees processes; only the agent at the desk sees uncommitted changes, a `PLOT-BLOCKED` marker, or a checkout still on a merged branch.

- clean tree, branch merged → **reset**: check out the new slice's branch in the desk it holds
- anything unlanded → **create** a new desk and leave this one for repair

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

**The asymmetry between kinds is deliberate and stays.** A removed checkout comes back with `git worktree add`; a deleted remote ref does not. So worktrees are swept estate-wide and refs stay plan-scoped, which is the licence `plot-release-refs.sh:28` already argues. A local branch sits between the two: it is the last copy of a reflog, and deleting it is cheap to regret.

### Open Questions

- [ ] **Where does the queue live — derived or stored?** Plot's discipline is that git is the source of truth and state is derived. Derived: an eligible slice with a brief and no claim *is* queued, so the queue is the fleet scan's existing output and nothing new is stored. Stored: the registry keeps ordering and assignment records, which is the first piece of fleet state git does not hold, and needs its own answer to *what happens when the registry dies holding it*. This plan argues derived, on manifesto grounds, and does not settle it.
- [ ] **What announces `free`?** An agent that finishes a slice must reach its registry. A file the registry watches, or the manifest itself gaining a state — the second keeps identity and availability in one place, which is where `DESIGN-agent.md:502` puts it (*"`free` is derived, not stored"*).
- [ ] **What happens to a queued slice when every agent dies?** The queue outlives its agents by design. Whether it survives a machine restart depends on the answer above.
- [ ] **Does an agent ever hold a desk on a branch it is not working?** Between units it is `running`, has no branch, and holds a desk sitting on something. What that tree points at while idle is unspecified.

## Branches

### Naming what is free

- `feature/an-agent-says-when-it-is-free` — derive availability and make it observable. `DESIGN-agent.md:483` states the gap: the eight process states deliberately do not answer *can this agent take work?* — `running` is not busy (an agent between units is running with no branch, and is available), `finished` is not free (its worker exited and nothing marks the transition). Nothing else in this plan is reachable until something can answer it.

### Holding one desk

- `feature/an-agent-decides-create-or-reset` — the agent takes both ends of its desk's life. `plot-worker-loop.sh:723` stops creating a desk per branch; the agent resets the tree it holds where the tree allows, and creates one only where it does not. The old desk stops being abandoned because it is the same desk.

### Handing work over

- `feature/the-registry-queues-a-brief` — dispatch hands slice + brief to the registry and returns; the registry matches on the free event. `plot-dispatch.sh:2503` stops calling `git worktree add`, and the brief gate at `:2555` moves to the hand-over rather than the launch.

### Sweeping what was overlooked

- `feature/the-sweep-names-every-leftover` — extend the estate sweep past worktrees. **Measured 2026-09-02: 85 of 98 local branches already merged, and nothing sweeps them** — the largest leftover population here, and the one no script looks at. Orphaned claim refs and unowned dirty trees are the same shape: something nobody is coming back for, with no actor. Keep the reaper's five refusals and its per-kind licence — a checkout is re-creatable, a ref is not, and a local branch is the last copy of a reflog.

### Saying so in the specs

- `docs/the-desk-belongs-to-the-agent` — amend `DESIGN-worktree.md:60`, which says the dispatcher creates the desk and is the sentence this plan contradicts. Record the measurement that settled it.

## Notes

**This plan came out of a conversation, not a bug report.** The estate was cleaned by hand first — 19 desks reaped, two stale ones removed — and the questions that produced the model came after, in order: *why do we still see that* → *why don't agents reuse the desks* → *when is an agent created, when is its desk* → *by whom*. The measurements above are from that session and are the argument.

**Two claims in it were wrong and are recorded because they were corrected:**

1. *"The worker loop ends at PR-open."* It does not — `plot-worker-loop.sh:716` asks `--next` and hops. The loop already implements taking a next unit; what it gets wrong is the desk and the missing brief.
2. *"Dispatch should refuse on `0 free`."* Wrong for the reason in Approach: it recreates the capacity coupling the machine spec rejects. The queue is the answer, not a refusal.

**What is NOT in scope.** The `Slice`/`Wave` naming defect (`CLAUDE.md` records it as known, with its own plan) is untouched here, though this plan's branches sit next to it. So is the `HostBackend` layering exception — a different plan closed that today.
