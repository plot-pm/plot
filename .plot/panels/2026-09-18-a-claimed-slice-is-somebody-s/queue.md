# Juror: the queue

Position: amend

Lens: this plan claims a slice was invisible to the supervisor because it held a
claim. I verified the causal chain in code and against the live estate.

## The mechanism is RIGHT, and it is righter than the plan's own citation

The plan quotes `rules/queue.ts:7` — a docstring — for its central claim. A
docstring is not the code, so I found the predicate. **`claimable` is NOT the
claim test.** `queue-reading.ts:128` sets it from the slice ordering verdict:

```
const claimable = verdicts[index] === 'eligible';   // queue-reading.ts:128
```

and that comes from `sliceVerdicts` (`rules/eligible.ts`), which folds plan
phase and prior-slice completion. `isHandOverReady` (`queue.ts:181`) reads
`slice.claimable && slice.briefPresent` and never sees a claim at all.

**The claim is tested one line earlier, and it is a `continue`, not a hold:**

```
// queue-reading.ts:112
const settled = (line: { branch: string }): boolean =>
  claimed.has(line.branch) || merged.has(line.branch);
...
// queue-reading.ts:139
if (settled(line)) continue;
queued.push({ branch: line.branch, slug, claimable });
```

`claimedBranches()` is documented at `queue-reading.ts:24` as *"The remote
branches that exist — a ref IS a claim."* So a claimed branch never becomes a
`QueuedSlice`. It cannot reach `whyNotReady`, cannot acquire a `QueueHold`,
and cannot appear in `matchQueue`'s `held[]`.

**So the plan's decisive assertion is confirmed by construction, not by the
absence of a branch from a printout.** A claimed-but-unworked slice is genuinely
OUTSIDE the queue population. The plan reached the right answer by the weaker
route (eliminating hold lists by hand); the `continue` at :139 is the proof it
should have cited, and an amendment should cite it.

## The plan's evidence for that conclusion is unsound, and would not have held

The plan argues: *"`--once` names every hold every time, so a missing branch is
not a missing key."* **That premise is false as a general statement**, and only
accidentally true for `--once`.

`registryd-main.ts:955-959`:

```
if (looping && HOLD_SCOPE[hold] === 'estate') continue;
const named = looping ? branches.slice(0, KEPT_HOLD_NAMES) : branches;
for (const slice of named) write(`    ${slice.branch}\n`);
const rest = branches.length - named.length;
if (rest > 0) write(`    … and ${rest} more\n`);
```

- `KEPT_HOLD_NAMES = 12` (`:876`) — a looping tick names only the first 12 per hold.
- `HOLD_SCOPE['not-claimable'] = 'estate'` (`:861`) — the looping daemon names
  **none** of them.
- The plan says it observed *"four consecutive supervisor ticks"*. Those are
  looping ticks, so `not-claimable` printed zero branch names by design. Its
  conclusion held anyway (because of :139), but the stated reasoning is invalid
  on the very output it reports reading. Amend the Design to argue from :139.

## STRONGEST FINDING — the plan misattributes the desk, and the incident is not what it says

The plan states:

> *"the claim commit is `d95614695`, and the paths that create desks are
> `plot-dispatch.sh:2057` (`--start`) and `:2925`."*

**Both attributions are wrong, and the second is not a desk path at all.**

- `plot-dispatch.sh:2057` is `--start`'s FREE agent desk: `git worktree add -q
  --detach "$start_wt" "origin/$start_main"`, named `${wt_prefix}free-<id>`.
- `plot-dispatch.sh:2925` is inside `write_started_record()` — a **booking
  worktree** `"$wt_root/.plot-start-$slug.$$"` on branch `plot/start-$slug`,
  created to append a `Started:` line and then deleted. It creates no slice desk.

The desk that actually exists is:

```
/Users/jwloka/.../.worktrees/plot-wt-bug-the-reading-carries-which-stopped
```

The `plot-wt-` prefix is written by **`plot-worker-loop.sh:2264` and `:2278`**:

```
hop_wt="$wt_root/plot-wt-$suffix"
git worktree add -b "$next_branch" "$hop_wt" "origin/$main_branch" ...
```

and the claim commit comes from `plot-worker-loop.sh:2311`:

```
# Claim the branch with an empty commit.
git -C "$hop_wt" commit --allow-empty -m "plot: claim $next_branch"
```

`git log -1 d95614695` → subject `plot: claim bug/the-reading-carries-which-stopped`.
**That is the worker loop's own message, byte for byte.** The desk and the claim
were created by the AGENT after it was handed the branch — which is exactly the
design `plot-dispatch.sh:3626-3640` describes (*"`git worktree add` USED TO BE
HERE, with a claim push behind it … All three are gone"*).

**So `queue.ts:169` is not falsified.** The plan's second section says *"The rule
records this failure as fixed, and a desk was stranded anyway"*. The stranded-
desk failure mode that :169 describes is dispatch preparing a desk before the
brief gate. Dispatch prepared nothing here. The desk was made by the agent that
had already taken the slice, post-hand-over, which is the intended order. The
section's headline claim is **unsupported by the code it cites**, and the plan
made it while explicitly promising *"this plan does not guess at it"*.

## And the incident itself is not a stranded slice

Measured on the live estate, read-only:

- `.plot/agents/df01e05e-….json` — `"branch": "bug/the-reading-carries-which-stopped"`,
  `"pid": "26405"`, `"startedAt": "2026-09-18T11:17:51Z"`.
- `ps -p 26405` → **alive**, `bash skills/plot/scripts/plot-worker-loop.sh`.
- Branch commits: `d95614695` 12:30:33 (claim), then `59c2e09e0` 12:34, `f1e08ebc`
  12:37, `dba44410` 13:22, `cf0aaab5f` 13:23:30 — **four real commits after the
  claim.**

A registered, live agent held the branch and worked it. The claim was working as
designed: it removed from the queue a slice somebody was actually on. The plan's
motivating measurement — *"a branch claimed with no agent on it"* — **does not
describe this branch.** The plan says `plot-fleetctl.sh --status` showed state
`none`; on this evidence that reading was taken in a window between the agent's
own hops, or of a different desk.

**This does not sink slice 1.** A claimed slice with no agent is a real hole in
the reporting surface (nothing joins claim refs against registry `branch`
fields). But the plan's one worked example is a counter-example, and a plan whose
only measurement contradicts its premise must be re-measured before it is built.
The Done-when even asks for *"the population … measured on this estate and the
number stated"* — on the evidence here that number may be **0**.

## Slice 2's diagnosis is one layer off

The plan says *"`plot-pr-merged.sh` is the answer … and the stall reading does
not ask it."* **It already asks it.** `rules/task.ts:88`:

```
if (readings.hasPr) return 'finished';
if (readings.blocked) return 'waiting';
if (readings.dirty) return 'stalled';
```

`hasPr` outranks everything, and `plot-worker-state.sh:714` takes it as a
caller-supplied parameter (`$2=pr-fact`). `plot-fleet-scan.sh:1740` supplies it:

```
reached_review "$br" && pr_fact="pr"
plot_worker_state "$wt" "$pr_fact"
```

with `reached_review` (`:1137`) accepting `OPEN|MERGED`. So the merged PR would
already have produced `finished`. The defect is therefore **which branch the
caller asks about**, not the rule's readings: the manifest's `branch` was cleared
to `""` while the desk still held the merged branch, so the caller had no branch
to ask `reached_review` about. Slice 2 as written would add a `plot-pr-merged.sh`
call to a rule that already outranks on the same fact, and leave the real bug.

**Sharper, and the plan half-sees it**: its own third bullet — *"A free agent's
desk should not be left on a finished branch either"* — is the actual fix, and it
is parked as *"the second slice's question"* inside the second slice.

I also measured the desk-sharing this produces: `89bfb811` (pid 20771, alive,
`branch: ""`) and `df01e05e` (pid 26405, alive, holding the branch) name the
**same worktree** in their manifests. Two live agents, one desk. The plan
describes 89bfb811 as free-but-reading-stalled and never notices that its desk
was taken over by another registered agent — which is a more serious finding than
the `stalled` wording and is unaddressed by either slice.

## What to amend

1. Cite `queue-reading.ts:112`/`:139` as the mechanism; drop *"`--once` names
   every hold every time"* (false under `KEPT_HOLD_NAMES=12` and
   `HOLD_SCOPE['not-claimable']='estate'`).
2. Correct the desk attribution to `plot-worker-loop.sh:2264/2278` + `:2311`,
   and withdraw *"The rule records this failure as fixed, and a desk was stranded
   anyway"* — `queue.ts:169` describes dispatch-created desks and dispatch
   created none.
3. Re-measure slice 1's population. The named example is a live, registered,
   productive agent. State the real number; if it is 0, the slice is a guard
   without a defect.
4. Re-aim slice 2 at the manifest/desk pairing (branch cleared while the desk
   holds it; two agents sharing one desk), not at `taskState`, which already
   returns `finished` on `hasPr`.

## What I could not refute

The queue derivation claim, which is the plan's title and its load-bearing
finding. `if (settled(line)) continue;` is unambiguous, and no hold list can
ever mention a claimed branch. Slice 1's Done-when is also well guarded — the
`elsewhere`/other-machine exclusion and the "silent for a live agent" pin are
both right, and the latter is precisely what the measured example would trip.

`--restart` as the named repair survives too, with one caveat worth writing into
the slice: `plot-dispatch.sh:1745` refuses when **no worktree holds the branch**
(*"--restart hands an EXISTING checkout to a new worker; it creates none"*), and
`handover_refusal` (`:955`) refuses first on any open-or-merged PR, then on a
live worker, then on a `PLOT-BLOCKED` marker. A claim ref whose desk was reaped
therefore has no repair at all — the report must not print a command that will
refuse.
