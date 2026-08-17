# The board survives the agents it is watching

## Status

- **Phase:** Draft
- **Type:** bug
- **Sprint:**
- **Story:** plot-board
- **Review:** pr
- **Impl:** own branches
- **Assignee:** jwloka
- **Approved:**
- **Started:**
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

### The scan trips over the agents it is reporting

Since #137 `plot-fleet-scan.sh` runs `git status` inside every worktree on the
machine. While an agent is mid-`commit` or mid-`rebase`, git holds
`.git/index.lock` and that call fails. **The function that makes agents visible
is the one that trips over them.**

Not hypothetical: this session hit `index.lock` four times in the main repo
alone, most recently while recording an approval, which took six retries.

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

**It must apply to test servers only, and the distinction cannot be the ppid
change.** Measured: the operator's own board is a child of the `--watch`
supervisor, which *replaces its child on every restart* — so a naive "my parent
changed, therefore exit" would be true for both, and the operator's board would
be the one that dies. Worse, a board started in a terminal that the operator
then closes is deliberately allowed to keep running.

The signal is instead **the environment the harness already sets**:
`helpers.mjs` passes `PLOT_REPO_ROOT` and `PORT=0` to every server it starts,
and the operator's board has neither. An explicit variable is better than
inferring from those two — inference would silently capture anyone who happens
to run the board with `PORT=0` — so the harness sets one that says exactly this:
*exit when the process that started you is gone.*

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

So the last successful pulse survives the process: written where a restart can
find it, served with its age, and replaced the moment a real scan completes.
**Stale is a state the page already renders** — the banner, the `(frozen)`
footer and the stopped clocks exist — so this feeds a mechanism rather than
inventing one.

**A cache that outlives its usefulness is worse than none.** It is a restart
bridge, not a store: too old and the honest answer is *"no data"*, which is what
the board says today and is correct once the numbers are meaningless.

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

### Survival

- `bug/test-boards-die-with-their-run` — the server exits when the process that
  started it is gone, gated on an explicit env var the test harness sets; no
  change for a board started by a person
- `feature/board-bridges-its-restart` — the last good pulse survives a `--watch`
  restart and is served with its age, feeding #141's existing stale rendering
- `bug/scan-survives-a-locked-worktree` — one locked worktree degrades to one
  reported row instead of failing the sweep

**One wave holding three branches, deliberately.** They touch different files —
the server's own lifecycle, the pulse cache, and the scan — and none reads the
others' work, so nothing orders them.

Writing them as three sub-headings would have said the opposite. Measured on
this very plan: `plot-plan-meta.sh` read an earlier draft's three headings as
three sequential waves, and `plot-fleet-scan.sh` would then have reported two of
them `blocked` while the first was open — the same defect this session found and
fixed in `dispatch-hands-over-work` hours earlier. **The wave boundary is the
only ordering the fleet enforces**; a paragraph saying "these can run together"
is an intention, not a decision.

The artifact will collide between them, as it does for every board pair;
`.gitattributes` covers it.

## Done when

- **A test server exits when its launcher is killed.** Assert against
  `SIGKILL`, not `SIGTERM`: a handler-based cleanup passes the polite case and
  leaves exactly the orphans this plan exists to remove.
- **A board started by a person does NOT exit when its shell closes.** The
  regression that matters most — the naive form of this fix kills the
  operator's own board, because `--watch` replaces its child on every restart
  and the ppid changes there too.
- **The gate is an explicit env var, not inferred from `PORT=0`.** Assert a
  server started with `PORT=0` and without the variable keeps running:
  inference would capture anyone who happens to pick a free port that way.
- **No orphan survives a killed test run.** The end-to-end form: start the
  suite, kill the runner, assert no `board-server.mjs` remains. This is the
  actual defect; every other assertion here is a component of it.
- **A restart serves the previous pulse, labelled with its age**, rather than
  `0 branches across 0 plans`.
- **A stale-enough cache is not served.** Assert the board says *no data*
  past the threshold: a bridge that never expires is a store, and a store of
  git-derived state is a second source of truth.
- **A fresh scan replaces the cache immediately.** Assert the bridge never wins
  over a real answer.
- **One locked worktree does not fail the sweep.** Assert the other worktrees
  still report — the case that produced `0 branches across 0 plans` with five
  agents running.
- **A locked worktree is reported as locked, not as clean.** Assert the exit
  code is read: `git status` failing and `git status` finding nothing both
  produce empty output.
- **The scan does not retry or wait on a lock.** Assert the sweep's duration is
  unchanged with a lock held — a scan that blocks makes the pulse late for
  everyone.
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
