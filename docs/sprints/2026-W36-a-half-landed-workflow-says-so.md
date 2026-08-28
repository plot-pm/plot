# Sprint: A half-landed workflow says so

> Every Plot workflow writes several records. When one lands and another does
> not, nothing today says so — the estate simply drifts, quietly, until someone
> reads a number that is wrong. This sprint makes an incomplete workflow
> report itself.

## Status

- **Phase:** Active
- **Start:** 2026-08-28
- **End:** 2026-09-11
- **Release:** 2.12.0

## Sprint Goal

**A workflow that half-lands is visible the moment it happens, not two days
later.**

Measured on `main` 2026-08-28, in one working session:

```
                                          found   cost when missed
delivery without its delivered/ symlink      1     sprint read 24/25 for 2 days
merge without its changeset                  2     would have shipped NO release note
worktree held by one uncommitted file        3     rescued by hand, one at a time
plan Sprint: disagrees with sprint file     27     nothing reads the counter
delivered plan with no PR annotation         6     version unresolvable at release
```

**None of these is a logic bug.** Every one is a record a workflow was supposed
to write and did not, and in every case **nothing failed loudly**. The code did
what it was told; the bookkeeping diverged from reality in silence.

**Two of them cost real work in the session that found them.** Two changesets
were written by workers, never committed, and survived only because
`plot-reap.sh` refused to remove the worktrees holding them — a refusal made
for a different reason. Nobody would have noticed the missing release notes.

**The detection mostly exists already.** `plot-reconcile-scan.sh` counts
`sprint_drift=27` and has for a while; `plot-reap.sh` refuses correctly every
time. **The gap is that detection reports into a void** — a footer nobody
consumes. So this sprint is not about finding more; it is about making what is
already found *act*.

## MoSCoW

### Must Have

Stories: [[the-master-agent-holds-the-fleet]] (the harness half)

- [ ] [a-delivery-that-half-lands-refuses] A delivery writes its phase, its record **and** its index entry, or reports which one it could not write — measured: a phase flip without the symlink made a finished plan read as unfinished for two days
- [ ] [a-merge-without-a-changeset-is-named] A merged branch whose changeset was never committed is reported before the release consumes the estate — measured: 2 in one session, both nearly shipping no release note
- [ ] [a-held-worktree-names-what-holds-it] `plot-reap.sh` says *which file* holds a tree it refuses, so an operator can judge it — measured: 3 trees held by one uncommitted file each, all resolved by hand
- [ ] [one-cap-holds-across-boards] Two boards on one repo cannot exceed `parallelAgents` between them — measured: the budget is `parallelAgents − liveAgentCount`, and each board computes it on its own pulse, so two boards seconds apart both read *0 live, budget 3* and each start 3
- [ ] [a-board-says-which-repo-it-serves] The header names the repository the board is serving — measured: `serverInfo()` carries `port` and `branch` but **not the repo path**, and a stray board serving a one-plan fixture on the usual port cost two hours before anyone could tell it apart from the real one

### Should Have

- [ ] [a-cold-board-says-it-is-warming] The fleet view says it is waiting for its first pulse rather than rendering as empty — measured: 0 rows at t+10s and t+20s, 60 rows at t+30s, with nothing on screen distinguishing *cold* from *nothing to show*
- [ ] [the-scan-drift-counter-is-acted-on] `sprint_drift=27` reaches a reader instead of a footer — the count has been non-zero for weeks and nothing consumes it

### Could Have

- [ ] [the-mock-board-has-a-sprint] The mock fleet carries a sprint and a populated inbox, so the two features this release shipped can be seen without a real estate — measured: `sprints: 0`, `issues: 1`
- [ ] [a-delivered-plan-resolves-its-version] The 6 delivered plans with no PR annotation get one, so `/plot-release` step 5b can mark them Released
- [ ] [the-backend-does-not-default-silently] `plot-host.sh backend` reports that it cannot tell, rather than answering `github`, in a repo with no remote

## Notes

### Why "completion", not "bugfixing"

**Calling this a bugfix sprint would send someone hunting for broken logic that
is not there.** Every finding is a *missing record*, and the fix in each case is
to make the absence visible — a different kind of change, with a different kind
of test.

### The three Musts share one shape

Each is a workflow that succeeds partially and reports total success. **The test
for all three is the same**: interrupt the workflow between its writes and
assert that what comes out says which write is missing.

### Detection already exists; consumption does not

`plot-reconcile-scan.sh` found the sprint drift. `plot-reap.sh` refused the
three held worktrees — and **that refusal is what saved the two changesets.**
Neither needs replacing. The Musts add a *consumer* for signals that are already
computed, which is why this sprint is small.

**The pattern to copy is `/plot-deliver` step 7b**: it runs the scan as a gate
and refuses to declare success on a self-asserted claim. That is the shape the
other workflows lack.

### Two boards is not two of the same problem

**The cap and the identity are different failures, and both were met today.**

**The cap is a check-then-act race.** `liveAgentCount` reads the shared agent
registry, so its *input* is machine-wide and correct. What is not atomic is
read → decide → spawn: nothing holds a slot between deciding there is one and
filling it. **The fix is the pattern Plot already trusts** — a branch claim is
`git push` of a ref, and *"rejection means another session won the race"*
(`plot-dispatch.sh:1961`). A slot claimed the same way cannot be double-taken,
with no lock manager and none wanted.

**The identity is a rendering gap, and cheaper than it looks.** `serverInfo()`
already runs on every `/api/board` response and already carries `port` and
`branch`. It does not carry the repository. **Adding one field is the whole
change** — and it is the difference between *"the board is broken"* and *"that
board is serving somewhere else."*

**Neither is hypothetical.** Both were measured on 2026-08-28, in the session
that wrote this sprint, and the second one is why the first release nearly did
not ship.

### What this sprint does not claim

**It does not make the board cheaper.** The board's pulse cost is real and has
its own Draft plan (`the-board-watches-instead-of-re-asking`). Measured
2026-08-28 on this machine: a board held **2** concurrent git processes with
spawn cost 3.5 ms, better than idle — so it is a throughput question, not a
safety one, and it is not this sprint's subject.

**It does not touch the domain refactor.** `the-domain-moves-out-of-the-board`
is approved and four slices; mixing a refactor into a hygiene sprint makes both
harder to judge.

### Nothing here has a plan yet

All ten items are findings, not plans. Each needs `/plot-idea` before it can
be dispatched, and the three completion Musts should be written first — they share a shape,
and writing them together is what keeps them one mechanism rather than three.
The two board Musts are independent of those and of each other.

### Scope Changes

<!-- logged here as the sprint's contents change -->
