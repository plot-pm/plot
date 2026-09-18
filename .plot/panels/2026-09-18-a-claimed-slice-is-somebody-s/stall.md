# Juror: the stall reading

Lens: slice 2 proposes that `stalled` stop firing for a desk whose PR merged, by
asking the host instead of git. What does that break?

Position: reject

Slice 2 is refused on its own evidence. Its stated cause is falsified by
measurement, the remedy it proposes already exists and already fires, and the
one caller that produced the bad word refuses that remedy by name for a reason
slice 2 does not answer. Slice 1 is untouched by this and I say nothing about it.

---

## 1. The premise sentence is wrong about the code, measured

The plan's own table (`docs/plans/2026-09-18-a-claimed-slice-is-somebody-s.md:77`)
says:

> | `plot-worker-state.sh` | **`stalled`** | commits in the tree not in `origin/main` |

`plot-worker-state.sh` does not read `origin/main` anywhere. The unpushed reading
is `@{upstream}` and nothing else, at `plot-worker-state.sh:724`:

```
  ahead=$(git -C "$wt" rev-list --count '@{upstream}..HEAD' 2>/dev/null) || ahead=""
```

and the same at `:1045`. The file spends 20 lines (`:689`–`:706`) recording that
an `origin/main` fallback was TRIED and measured wrong:

> *"a fallback that counted against `origin/main` reported EVERY clean branch
> `stalled` in a repo with no remote … The fallback was also wrong where it
> worked. A branch legitimately ahead of `origin/main` is the NORMAL state of
> every branch under review"*

So the plan's diagnosis describes a reading that was removed before this file
reached its current shape.

## 2. The measured desk does not read `stalled` for the reason the plan gives

Measured 2026-09-18 on the live estate, the desk the plan names — the one still
checked out on `bug/the-index-is-read-once` (`.worktrees/free-37073204`):

```
$ git -C .worktrees/free-37073204 rev-list --count '@{upstream}..HEAD'
0
$ git -C .worktrees/free-37073204 rev-list --count origin/main..HEAD
6
$ git -C .worktrees/free-37073204 status --porcelain
?? do_transform.py
?? footer.txt
?? run_transform.sh
?? section6.txt
?? transform_final.py
```

`unpushed` is **0**, not 6 — `@{upstream}` is `origin/bug/the-index-is-read-once`,
which the branch was pushed to. Only `origin/main` shows 6, and nothing reads it.

Running the real function under bash:

```
state(nopr): stalled|20771|
state(pr):   finished|20771|
readings:    1|1|orphaned|-|0|1|0
             │ │ │        │ │ │ └─ unpushed = 0
             │ │ │        │ │ └─── dirty    = 1   ← THIS is why it says stalled
             │ │ │        │ └───── blocked  = 0
```

`taskState` (`packages/domain/src/rules/task.ts:88-92`) fires at the DIRTY arm:

```ts
  if (readings.hasPr) return 'finished';
  if (readings.blocked) return 'waiting';
  if (readings.dirty) return 'stalled';        // ← this line fired
  if (readings.unpushed === true) return 'stalled';
```

The squash-merge argument the plan builds its whole case on (`:86`–`:90`) is about
a reading that returned **0** here. The five untracked scratch files — which the
plan's own Notes section (`:154`) dismisses as *"never the reason"* — are the
entire reason.

## 3. The remedy slice 2 proposes ALREADY EXISTS and already fires

`taskState`'s rank-1 arm is `hasPr`, and the `pr` fact already means
**open or merged**. Both shell callers already ask the host:

`plot-fleet-scan.sh:1137`:
```
# Has this branch's work REACHED REVIEW — an open or merged PR?
# … OPEN and MERGED both count
reached_review() { # $1=branch → 0 when an open or merged PR exists
  case "$(host_pr_state "$1")" in OPEN|MERGED) return 0 ;; *) return 1 ;; esac
}
```
`plot-fleet-scan.sh:1739-1741`:
```
  local pr_fact=""
  reached_review "$br" && pr_fact="pr"
  plot_worker_state "$wt" "$pr_fact"
```
`plot-dispatch.sh:1596-1612` does the identical thing.

And the host agrees, measured today:
```
$ gh pr view 948 --json number,state,mergedAt,headRefName
{"headRefName":"bug/the-index-is-read-once","mergedAt":"2026-09-18T07:12:47Z",
 "number":948,"state":"MERGED"}
```

So `reached_review` returns 0 → `pr_fact="pr"` → `hasPr` → `finished`, which is
exactly what I measured as `state(pr): finished`. **The fleet scan and
`plot-dispatch --status` never reported this desk as `stalled`.**

Slice 2's Done-when asks for a merged-PR question via `plot-pr-merged.sh`. That
question is already asked, by a cached route, one arm higher in the same rule.
Building it a second time is a second implementation of `did this land` in the
same decision — the exact duplication `plot-pr-merged.sh`'s own header
(`:14-21`) and CLAUDE.md's *One Answer To "Did This Land"* exist to prevent.

## 4. The actual defect is a caller that passes NO PR fact — and refuses to

Two callers hardcode the fact away:

**`packages/board/src/server/registry.ts:870`** — the board's agent rows:
```js
  const program =
    `. "$1"; shift; for wt in "$@"; do ` +
    `printf '%s\\0' "$(plot_worker_state "$wt" '' | cut -f1)"; done`;
```
Note the literal `''`. Its docstring at `:839-842` states the policy:

> *"the registry cannot afford the host call that would fill it — **the registry
> must not be behind anything that can fail** — so it reads liveness from local
> signals only and lets `finished`-vs-`stalled` be the honest local answer."*

**`packages/board/src/server/entry/agent-state.ts:130`**:
```ts
      // THE PR FACT IS NEVER IN THE READINGS. It comes from the caller …
      // This entry point's callers are the registry and the corpus test, and
      // neither asks a host.
      hasPr: false,
```

**`plot-fleetctl.sh`** — four sites (`:342`, `:551`, `:587`, `:599`) call
`plot_worker_state "$wt"` with no second argument at all, which is why the plan's
own `--status` observation found `none`/`stalled`.

So the finding is real and the plan mislocated it. The board renders `stalled`
because the registry deliberately withholds the PR fact, not because
`plot-worker-state.sh` asks git the wrong question. Slice 2 aims its fix at a
file that is already correct.

## 5. Slice 2's remedy is refused by that caller's stated contract

Slice 2 says the merged question is *"asked through `plot-pr-merged.sh`"*. Put
that call inside `plot_worker_task_state` and every caller inherits it —
including `registry.ts`, whose contract is *must not be behind anything that can
fail*. The registry's batch throws on any refusal (`registry.ts:876`:
`if (!answer.ok) throw new Error(...)`), and `refreshStates` reads that as **every
entry `unknown`**. A `gh` timeout would therefore blank the whole agent list
rather than mis-word one row. Slice 2 does not name this caller and does not
answer its contract.

**Cost, per CLAUDE.md's *A Shell Script Asks The Domain*.** The rule is that a
script running once per agent per pass must not pay a host call.
`plot_worker_task_state` is reached once per desk per evaluation, and:

- `plot-fleet-scan.sh:1741` runs it per branch, and the board polls the scan on a
  5 s cadence;
- `registry.ts:866` runs it per worktree per registry tick — measured in its own
  docstring at **20 worktrees**;
- `plot-fleetctl.sh:599` runs it in a `sleep 0.5` **polling loop** during `--stop`.

`plot-worker-state.sh:743-747` states this prohibition in the file itself:

> *"A host call in here would either break that promise or fork a `gh` per branch
> on every 5-second board poll."*

And `plot-pr-merged.sh`'s own measured cost is 4.75 s for ten sequential calls
(~475 ms each). At 20 desks that is ~9.5 s added to a registry tick that answers
in 210 ms today — a 45× regression — and it lands inside a 0.5 s poll loop.

## 6. What `stalled` protects, and what slice 2 would hide

`stalled` is not cosmetic. It gates:

- `packages/domain/src/entities/agent.ts:195` —
  `leftWorkBehind = agent.state === 'stalled' && agent.dirtyPaths.length > 0`
- `packages/board/src/server/attention.ts:223` — verdict `unfinished`, action
  `resume it`, list `needsAgent`
- `packages/board/src/contract/schema.ts:3303` — `isBrokenState`, which files the
  row in WAITING ON YOU
- `packages/board/src/server/fleet.ts:4432` — the row that NAMES the dirty files

**The population slice 2 would hide.** A desk with BOTH merged work and new
unlanded work. Concretely: an agent merges PR #948, is handed a second slice on
the same desk, edits files, and its wrapper is orphaned before it commits.
Today `dirty=1` → `stalled` → the board names the files and routes to
`needsAgent`. Under slice 2, `pr_merged` on the branch answers *merged* — because
#948 merged — and the desk reads `finished`, meaning *review it; stop looking*.

This is precisely the population the repo's own memory records:
*"a stalled worker exits 0 with uncommitted work"* and *"rescue a hung worker by
committing its tree — 324 finished lines sat uncommitted"*. Slice 2's Done-when
promises *"a desk with genuinely unlanded work still reads `stalled`, pinned"* —
but its own mechanism cannot honour that, because `pr_merged` is keyed on the
BRANCH and the unlanded work is in the TREE. The branch merged; the tree did not.

The existing rule already gets this right by ranking `hasPr` first *as a
deliberate scope decision* (`task.ts:70-72`): *"a scratch file beside a merged PR
is not unfinished work."* That is a judgement about a desk being RELEASED, and the
plan's own section at `:92` identifies the real fix — `--start` cuts free desks
detached, this one was not reset. **Resetting the desk clears `dirty` and the word
follows.** That is slice 2's own second question, and it is the whole answer.

## 7. What would be accepted instead

1. **Fix the caller, not the rule.** Give `registry.ts` the PR fact it already
   has elsewhere, or state that the board's word is local-only and render it as
   such. The rule is correct; one caller withholds an input.
2. **Reset a released desk** (`:92`-`:96`). It clears `dirty` at the source, costs
   no host call, and fixes `--status`, the registry and the scan at once.
3. If the merged question must reach the registry, it comes from the board's
   ALREADY-CACHED PR state, never from a `gh` fork inside a per-desk loop.

## What I could not falsify

Slice 1 is out of my lens and I make no claim about it. The plan's observation
that a finished, idle, merged agent renders red on the board is REAL — I
reproduced the `stalled` word at `registry.ts:870`'s call. It is the diagnosis
and the remedy I reject, not the symptom.
