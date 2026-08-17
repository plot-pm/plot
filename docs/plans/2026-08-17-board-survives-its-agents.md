# The board survives the agents it is watching

## Status

- **Phase:** Approved
- **Type:** bug
- **Sprint:**
- **Story:** plot-board
- **Review:** pr
- **Impl:** own branches
- **Assignee:** jwloka
- **Approved:** 2026-08-17, jwloka, plan-PR #157 merged (two interrogation rounds)
- **Started:** 2026-08-17, Jan Wloka, `bug/test-boards-die-with-their-run`
- **Delivered:**

## Problem

The fleet view exists to make parallel work visible. Measured on 2026-08-17
with five agents in flight, it did the opposite: the Agents tab reported
*"Last scan failed"* and rendered **`0 branches across 0 plans`** — not a stale
view, an empty one. **The more parallel work runs, the less reliable the view of
it becomes.**

Three causes, each measured, and they are unrelated to each other except in
where they land.

### Test servers outlive their run

Measured at 02:00 on 2026-08-17 — four `board-server.mjs` processes:

| pid | listening on | parent | started |
|---|---|---|---|
| 29222 | `localhost:56939` | **1** (`launchd`) | 01:54:31 |
| 35889 | `localhost:56967` | **1** (`launchd`) | 01:54:49 |
| 78577 | *no listener* | a shell | — |
| 96085 | `localhost:7777` | 78577 (`node --watch`) | — |

The two on random high ports are **orphans**. `packages/board/test/helpers.mjs`
starts every integration server with `PORT: '0'`, so those ports identify them.
Their parent is PID 1, meaning the test run that spawned them is long gone —
eighteen seconds apart, which looks like two test files whose shared runner was
interrupted. Both still answered `/api/fleet` with **200**, so both were still
polling. A third appeared within seconds of killing the first two, from the same
worktree, because that agent was running its suite.

**This is not a discipline problem.** Measured: 26 `startServer(` calls, 24
`.kill()` calls, in `after()` hooks. The tests clean up correctly. But
`startServer` *returns* a `kill` function for the caller to invoke, which makes
cleanup a **rule** in this repo's own vocabulary — you can answer "did I clean
up?" without having done it, because `after()` never runs when the runner is
killed rather than finishing. Ctrl-C, a dying agent, a `SIGKILL`: no hook fires,
and the child is inherited by `launchd`.

**The `EADDRINUSE` adoption cannot reach these**, and that bounds the earlier
fix rather than contradicting it. That check answers *"is this port taken?"*; a
process that asks for `PORT=0` has opted out of the question by construction. It
was never meant to adopt and never will.

Measured, the server has **no signal handling at all** — no `SIGTERM`, no
`SIGINT`, and nothing watching its parent.

### `--watch` serves an empty board while it restarts

The operator's board runs under `node --watch`, and three of the five agents
were editing files under `packages/board/`. Every save restarts the server.

**A freshly restarted process has no cached pulse to fall back on**, so the
*degrade, do not hide* behaviour from #141 has nothing to degrade *to*. The
banner worked perfectly and named the exact failing command; there was simply no
last-good payload behind it. The table above catches this mid-restart: pid 78577
is the supervisor with **no listener** — exactly the window that serves
`0 branches across 0 plans`.

**The cache exists; it is merely in the wrong place.** `fleet.ts:180` already
holds `const caches = new Map<string, CacheEntry>()`, keyed per repo, with PR
data cached beside the pulse under its own timestamp. Every request reads it and
the scan refreshes it asynchronously — that design is right and is why the tab
polls at 4 s without running a scan per request. It is process memory, so a
restart takes it with the process. Nothing is missing from the mechanism except
that it does not outlive the thing it is protecting against.

### The scan sees a locked worktree and says nothing

Since #137 `plot-fleet-scan.sh` runs `git status` inside every worktree on the
machine. While an agent is mid-`commit` or mid-`rebase`, git holds
`.git/index.lock` and that call fails. **The function that makes agents visible
is the one that trips over them.**

Not hypothetical: this session hit `index.lock` four times in the main repo
alone, most recently while recording an approval, which took six retries.

**An earlier draft of this plan had the defect wrong, and the measurement
corrected it.** It claimed the scan reads a failed `git status` as a clean one.
It does not: `plot-fleet-scan.sh:266` already reads the exit code, and the file
argues the rule at length — *"a failure to observe is not evidence of
cleanliness"*. That half is shipped and correct.

What it does instead is `continue`:

```sh
else
  # A failure to observe. The worktree is not reported at all — neither its
  # dirtiness (unknown) nor its path (it may not be there).
  continue
fi
```

So one locked worktree does not corrupt the sweep and does not fail it — the
sweep survives, and the branch answers from refs exactly as if this machine had
no worktree for it. The row then reads *"claimed, no commits yet"*: absent, not
false, which is the right instinct applied to the wrong question.

**Because a lock is not an absence — it is the most informative state a
worktree can be in.** `.git/index.lock` means *an agent is writing here, right
now*, which is precisely what the fleet view exists to show. Today that fact is
computed, discarded, and replaced by silence. The branch that looks least
active is the one being committed to.

So a lock becomes its own signal beside `local_dirty` and `local_ahead`, under
the same five rules those obey. Three neighbouring facts, three questions:
*someone is editing*, *finished work nobody else can see*, *a write is in
progress this instant*. Collapsing any pair of them would repeat the
one-label-two-states defect this story keeps finding.

## Design

### A test server dies with the process that started it

`process.ppid` becomes `1` the moment a parent dies, **however it dies**.
Measured with a probe: parent killed by `SIGKILL` (exit 137, so no handler of
its own could run), and the child observed `ppid changed 20996 -> 1` within
200 ms.

That is a **gate** rather than a rule: the server cannot claim to still have its
launcher, it measures it. No cooperation from the caller, no cleanup code, and
it survives the exact case that produces orphans — the one where no cleanup code
runs at all.

**Two neighbouring answers were checked and rejected.** Measured:
`helpers.mjs:33` spawns **without `detached: true`**, so these are ordinary
children — they were not deliberately cut loose, they were *orphaned*, and POSIX
handed them to PID 1. And there is **no global teardown** in the board's test
config at all; cleanup lives entirely in per-suite `after()` hooks.

So a global teardown would be the obvious fix and is the wrong one: it runs when
the suite ends **in order**, which is exactly the case `after()` already covers.
The two orphans measured at 01:54 came from a run that did *not* end in
order — a teardown would have missed both. The mechanism has to work when
nothing gets to run, which is what leaves only the process asking about itself.

Measured also: the server registers **no signal handler of any kind** — not even
`SIGTERM`. So the polite path is not merely unreliable, it is absent.

**It must apply to test servers only, and the distinction cannot be the ppid
change.** Measured: the operator's own board is a child of the `--watch`
supervisor, which *replaces its child on every restart* — so a naive "my parent
changed, therefore exit" would be true for both, and the operator's board would
be the one that dies. Worse, a board started in a terminal that the operator
then closes is deliberately allowed to keep running.

The signal is instead **a variable the harness sets on purpose**:
`PLOT_EXIT_WITH_PARENT`. `helpers.mjs` already passes `PLOT_REPO_ROOT` and
`PORT=0` to every server it starts, and the operator's board has neither — so
either could serve as a tell. Neither should. `PLOT_REPO_ROOT` answers *where
the repo is*, and deriving *die with your launcher* from it would surprise
anyone who sets it for its actual meaning; `PORT=0` answers *pick a port for
me*. **One variable, one question.** The new one says exactly what it does:
*exit when the process that started you is gone.*

**One variable covers the agent case too, with no second mechanism.** Measured
while writing this plan: eight board servers across three concurrent test runs,
two of them started by agents checking their own work. Those agents run
`pnpm test`, which goes through the same `helpers.mjs` — so their servers
inherit the variable exactly as a human's do. The case that produces the most
orphans needs no special handling, because it is the same case.

**The already-running orphans are not this branch's problem**, and a reaper
would be a second mechanism for a population that stops growing the moment the
first one lands. They are killed by hand once; every future one dies on its own.

**Interval, not signal.** There is no portable notification for "your parent
died"; polling `process.ppid` is the mechanism, and at a low frequency it costs
nothing. It also fails safe: if the check never runs, behaviour is exactly what
it is today.

### The board keeps its last good payload across a restart

`--watch` restarting is correct and wanted — a rebuilt artifact must take effect
in the running board, and CLAUDE.md says so explicitly. What is wrong is that
the restart erases the answer.

The pulse is derived from git and PR state; it is not authoritative, and #141
already established the rule that governs this: **degrade, do not hide.** A
payload from ninety seconds ago, clearly labelled, is worth more than an empty
board — that argument was already made and shipped for the *unreachable* case,
and a restart is the same case seen from the server's side rather than the
page's.

So the in-memory cache gains a copy on disk — `.plot/state/last-pulse.json`,
beside the other `.plot/state` the fleet already keeps — written on each
successful scan, read once at startup, and replaced the moment a real scan
completes. **Stale is a state the page already renders** — the banner, the
`(frozen)` footer and the stopped clocks exist — so this feeds a mechanism
rather than inventing one.

**Rescanning immediately instead was the obvious alternative and is not
enough.** A scan costs 500–1050 ms, and a cold boot was measured at 21.2 s
during the dimming work; scanning at startup narrows the empty window without
closing it, and a `--watch` restart storm — three agents editing
`packages/board/` — reopens it on every save. The two compose rather than
compete, so the file is read at startup *and* a scan is kicked off at once: the
file covers the gap, the scan ends it.

**It is a bridge, not a store, and that distinction is load-bearing.** Plot
derives state from git (Principle 1), and a JSON file that outlives its
usefulness is a second source of truth that can disagree with the repository.
Past a threshold the honest answer is *"no data"* — which is what the board says
today and is correct once the numbers are meaningless. The file is a cache with
an expiry, never a record.

**It is not the authority even while it is being served.** A scan that succeeds
wins immediately, and a scan that fails does not overwrite it — the same
one-directional rule the local signals obey.

### The scan reports a locked worktree as locked

`index.lock` means *this worktree is mid-write* — which is precisely a worktree
with an agent working in it. Reading that as *no answer* is the same absence
ambiguity this story keeps finding: a failed `git status` and a clean one both
produce empty output, and only the exit code separates them.

**One locked worktree must not fail the scan.** Today a single failure can take
the whole sweep with it, which is why five busy agents produce zero rows. The
scan's own documented rule already covers the shape — *read the exit code, not
the emptiness* — and the row for a locked worktree says so rather than claiming
the branch is idle.

**Do not retry inside the scan.** A lock held during a rebase can last seconds,
and a scan that waits on it makes the pulse late for everyone else; the next
poll is four seconds away and will find it unlocked. Reporting beats blocking.

## Branches

### Lifetime

- `bug/test-boards-die-with-their-run` — the server exits when the process that
  started it is gone, gated on an explicit env var the test harness sets; no
  change for a board started by a person

### Continuity

- `feature/board-bridges-its-restart` — the last good pulse is written to
  `.plot/state/last-pulse.json`, read at startup beside an immediate rescan, and
  served with its age through #141's existing stale rendering
- `bug/scan-reports-a-locked-worktree` — a worktree holding `index.lock` becomes
  its own signal rather than being skipped in silence

**Two waves, and the ordering was earned rather than assumed.** An earlier draft
put all three in one wave: they touch different files — the server's lifecycle,
the pulse cache, the scan — and none reads the others' work, so nothing *code*
orders them.

What orders them is the test environment. Measured while interrogating this
plan: a full board run reported **two failures that vanished when the same file
was run alone**, because eight board servers and three concurrent suites were
competing for ports and CPU. Browser tests with timeouts lose that race and
report it as an assertion failure.

So the orphan fix goes first, alone, because **the other two waves cannot be
trusted to fail honestly until it lands**. A red test in a polluted environment
is indistinguishable from a red test in a broken one, and this session has
already spent time on exactly that confusion. It costs one round of waiting and
buys the ability to believe the next round.

Wave 2's two branches run together — `plot-fleet-scan.sh` and the board's cache
do not meet. The artifact will collide between them, as it does for every board
pair; `.gitattributes` covers it.

## Done when

- **A test server exits when its launcher is killed.** Assert against
  `SIGKILL`, not `SIGTERM`: a handler-based cleanup passes the polite case and
  leaves exactly the orphans this plan exists to remove.
- **A board started by a person does NOT exit when its shell closes.** The
  regression that matters most — the naive form of this fix kills the
  operator's own board, because `--watch` replaces its child on every restart
  and the ppid changes there too.
- **The gate is `PLOT_EXIT_WITH_PARENT`, not inferred from anything else.**
  Assert a server started with `PORT=0` **and** `PLOT_REPO_ROOT` but without the
  new variable keeps running: both are already set on every test server, so
  inferring from either would work by accident today and surprise whoever sets
  them for their actual meaning tomorrow.
- **A global teardown is not the mechanism.** Assert the exit happens when the
  launcher is killed outright — a teardown runs only when the suite ends in
  order, which is the case `after()` already covers and the case orphans do not
  come from.
- **No orphan survives a killed test run.** The end-to-end form: start the
  suite, kill the runner, assert no `board-server.mjs` remains. This is the
  actual defect; every other assertion here is a component of it.
- **A restart serves the previous pulse, labelled with its age**, rather than
  `0 branches across 0 plans`. Assert across an actual process restart, not a
  cleared in-memory map: the map is already correct, and its loss on restart is
  the entire defect.
- **A stale-enough cache is not served.** Assert the board says *no data*
  past the threshold: a bridge that never expires is a store, and a store of
  git-derived state is a second source of truth.
- **A fresh scan replaces the file immediately.** Assert the bridge never wins
  over a real answer.
- **A FAILED scan does not overwrite the file.** The one-directional rule: a
  failure must not destroy the last good answer, which is the only thing
  standing between a restart and an empty board.
- **A startup rescan is issued alongside the file read.** Assert both happen —
  the file alone leaves the board stale until the next poll, and the scan alone
  leaves the measured 500–1050 ms (21.2 s cold) window empty.
- **A locked worktree is reported as locked, not skipped.** Assert the row says
  a write is in progress: today the exit code is read correctly and then
  `continue` throws the answer away, so the branch reads *"claimed, no commits
  yet"* while an agent is committing to it.
- **A locked worktree is distinguishable from a MISSING one.** Assert the two
  produce different rows: both fail `git status`, and collapsing them recreates
  the absence ambiguity in a new place.
- **`local_locked` never downgrades a group**, like its two neighbours. Assert
  against a branch whose PR already answers.
- **The scan does not retry or wait on a lock.** Assert the sweep's duration is
  unchanged with a lock held — a lock during a rebase can last seconds, the next
  poll is 4 s away, and a scan that blocks makes the pulse late for everyone.
- `pnpm run test:board`, `pnpm run test:reconcile`, `pnpm run typecheck`,
  `pnpm run validate` all pass.
- `pnpm build:board` run in the implementing worktree and the artifact
  committed — CI gates on no-diff.
- A changeset is present.
- macOS bash 3.2: no `declare -A`.

## Notes

Asked on 2026-08-17 after a screenshot of an empty board during a five-agent
run, and measured rather than reconstructed: the process table, the parentage,
the ports, the ppid probe and the cleanup counts are all in the Problem section
above.

**What the measurement changed.** The story recorded this as process
accumulation — *"nobody chooses seven boards; they accumulate, one per `pnpm
board` in a new terminal"*. That reading survived until the ports were checked.
The survivors were not terminals but **test servers**, and the adoption fix that
was supposed to prevent accumulation cannot apply to them by construction. The
quota, which was the original symptom, is now fine (213/5000 GraphQL — #123's
backoff holds). The cost that remains is that nobody can tell which board they
are looking at.

Deliberately out of scope: the IPv4/IPv6 binding defect, where the board reads
as unreachable while running perfectly because it listens on `[::1]` and Chrome
resolves `localhost` to `127.0.0.1`. It is a separate recorded finding, and no
in-page mechanism can report it — the document never loads.

Also out of scope: making `plot-fleet-scan.sh` cheaper. Its cost is measured and
accepted (6.6 ms per worktree); this plan is about what it does when a read
fails, not how often it reads.

<!-- CHALLENGE-THE-PLAN-METADATA
{
  "round": 2,
  "questionHistory": [
    {"q": "The plan says the scan reads a failed git status as clean. Measured: plot-fleet-scan.sh:266 already reads the exit code and argues the rule at length. What it actually does is `continue` — the worktree is skipped silently.", "a": "Report it as its own signal. A lock is not an absence — it means an agent is writing HERE, RIGHT NOW, which is exactly what the fleet view exists to show. `local_locked` joins local_dirty and local_ahead under the same five rules: three neighbouring facts, three questions", "category": "technical-implementation"},
    {"q": "The plan wants the pulse to survive a --watch restart. Measured: fleet.ts:180 already caches per repo with PR data beside it — but in process memory, which dies with the process. Where should it live?", "a": "On disk at .plot/state/last-pulse.json, read at startup BESIDE an immediate rescan. Rescanning alone narrows the window without closing it (500-1050ms, 21.2s cold boot). A bridge with an expiry, never a store — Principle 1 keeps git as the authority", "category": "technical-architecture"},
    {"q": "The exit-with-your-parent gate keys on an env var only the test harness sets. But eight board servers were running from three concurrent test runs, two started by agents. Is one variable enough?", "a": "Yes. Agents run pnpm test, which goes through the same helpers.mjs, so their servers inherit the variable exactly as a human's do. The case producing the most orphans is the same case. Already-running orphans are killed by hand once; a reaper would be a second mechanism for a population that stops growing", "category": "domain-rules"},
    {"q": "The three waves were planned parallel. But a full board run reported two failures that vanished when the same file ran alone — eight servers and three suites competing for ports and CPU.", "a": "Lifetime first, alone. The other two waves cannot be trusted to FAIL HONESTLY until it lands: a red test in a polluted environment is indistinguishable from one in a broken environment. Costs a round of waiting, buys the ability to believe the next round", "category": "tradeOffs"}
    {"q": "The plan relies on process.ppid polling. Measured: helpers.mjs spawns WITHOUT detached:true — these are ordinary children that were orphaned, not cut loose — and there is no global teardown at all; cleanup lives in per-suite after() hooks.", "a": "ppid polling stays. A global teardown runs when the suite ends IN ORDER, which is exactly what after() already covers — the two orphans measured at 01:54 came from a run that did not end in order, and a teardown would have missed both. The mechanism has to work when nothing gets to run", "category": "technical-architecture"},
    {"q": "helpers.mjs already sets PLOT_REPO_ROOT and PORT=0 on every test server, and the operator board sets neither. Is a new variable needed?", "a": "Yes — PLOT_EXIT_WITH_PARENT. One variable, one question: PLOT_REPO_ROOT answers WHERE THE REPO IS, and deriving 'die with your launcher' from it would surprise anyone setting it for its actual meaning. Inferring would work by accident today and break tomorrow", "category": "technical-implementation"},
    {"q": "The plan leaves already-running orphans out of scope, but they regrew several times tonight while agents ran their suites.", "a": "It stands. Once the fix lands no new orphan is created, so the population only shrinks; killing the existing ones is a one-line command already run twice today. A reaper would be a second mechanism aimed at a shrinking set — and one that kills other people's processes", "category": "tradeOffs"}
  ],
  "deferredItems": [],
  "categoriesCovered": {
    "technical": {"stack": false, "architecture": true, "implementation": true},
    "domain": {"rules": true, "workflows": false, "data": true},
    "ux": {"happyPath": false, "edgeCases": true, "errors": true, "accessibility": false},
    "nonFunctional": {"security": false, "performance": true, "scalability": false},
    "tradeOffs": true
  }
}
END-CHALLENGE-THE-PLAN-METADATA -->
