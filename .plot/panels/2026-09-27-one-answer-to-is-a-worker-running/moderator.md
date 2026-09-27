# Moderation — one answer to "is a worker running"

Jurors: 1 spawned, 0 verdicts written. The juror reported idle having written
nothing, so this panel carries NO gated verdict and is recorded as unquestioned
rather than clean.

The moderator therefore measured the plan directly. **Position: amend.** The
defect is real and the plan's measurement reproduces, but the mechanism it names
is wrong, and a builder following it would change the wrong line.

## What the plan says the mechanism is

> `reapable.ts:441` tests whether a **pid file is non-empty** … A file that names
> a dead pid reads `true`.

## What it actually is

`workerPid` is a READING, and all three producers resolve liveness with `ps`
before the rule sees it:

| producer | the check |
|---|---|
| `plot-reap.sh:506-509` (reap loop) | `[ -n "$p" ] && ps -p "$p"` — `pid` stays `""` when gone |
| `plot-reap.sh:1040-1042` (dirty sweep) | the same three lines, independently |
| `entities/worktree.ts:132` | `evidence.workerAlive ? 'alive' : null` |

`plot-reap.sh:503-504` states the contract: *"an empty pid file is not a live
process, and which of those two it is is the rule's to say."* So a stale pid file
never reaches the rule as a live worker, and the string test at `:441` is a
string test BECAUSE the adapter already did the reading — the layering rule
working, not a defect.

**Therefore `ps -p 99861` SUCCEEDED** when the reaper printed
`worker alive (pid 99861)`. The plan's own headline measurement is not a stale
file being trusted.

## The real divergence: an exit record outranks the process table

`plot-worker-state.sh:888` reads `.plot-worker.exit` **before** it reports on the
process, and `:895` refines exit 0 through `plot_worker_task_state` — a TREE
reading. Its header says so at `:42`: *"`finished` is refined by the TREE."*

So the two components ask genuinely different questions:

- **`plot-worker-state.sh`** — *did this worker record an exit?* A recorded exit
  means the worker is done, whatever `ps` says about that number now.
- **`reapable.ts` via the reap adapter** — *is a process with this pid alive?*

Both were right about their own question. One process number, two meanings —
and the pid in `finished 99861` is the DEAD worker's recorded pid, read from the
manifest (`plot-worker-state.sh:755`: *"THE PID IS READ FROM THE MANIFEST"*).

**The defect is that the reaper has no reading of the exit record at all.** A
desk whose worker wrote `.plot-worker.exit` is finished, and the reaper cannot
see that fact; it asks `ps` about a number that may since have been recycled onto
anything. The plan named recycling as a hypothetical — *"a recycled pid is the
sharper risk here"* — and its opening measurement is that case, not the stale-file
case it argues.

## What the plan must say before someone builds it

1. **Correct the mechanism.** Delete *"a string test on a pid file"* and *"a file
   that names a dead pid reads `true`"*: both are refuted by the three producers
   above. State instead that the reap adapter takes a `ps` reading and takes no
   exit-record reading, so a finished worker whose pid was recycled reads alive.
2. **Name `.plot-worker.exit` as the missing reading.** The fix is a reading the
   adapter does not take, not a rule that tests the wrong thing — so the diff is
   in `plot-reap.sh` (both sites) and the `ReapReadings` shape, not in
   `reapable.ts:441`'s expression.
3. **Do not route `reapable.ts` through `plot-worker-state.sh`.** That script
   answers eight states, two of them tree readings about what an agent OWES, and
   a pure domain rule must not gain a shell dependency to learn one boolean. The
   CLAUDE.md quote the plan leans on is about the eight-state classifier having
   ONE implementation, and the reaper is not asking that question.
4. **Both sites or neither.** `plot-reap.sh:506` and `:1040` carry the liveness
   snippet independently; an exit-record reading added to one leaves the dirty
   sweep still refusing.
5. **Re-derive the three-desk cost.** #1004, #1007 and #1014 are cited as the
   same state. Each should be checked against the corrected mechanism — a desk
   with no exit record is a different case from one whose pid was recycled, and
   only the second is what this plan now describes.

## Verdict

**amend.** The symptom is real, reproduced, and worth fixing; the title still
holds. What changes is where the fix goes: the reaper needs a reading it never
takes, and `reapable.ts:441` is correct as written.

Recorded: no juror verdict. This is the moderator's own measurement and carries
no independent lens.
