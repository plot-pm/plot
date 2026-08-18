---
"@plot-pm/board": minor
---

board: a WORKING row serves its worker's log, on demand and bounded

`worker: finished` means one thing only — the process exited 0 — and two
situations produce it that want opposite responses: the work is done (review
the PR), or the agent asked something and stopped (answer it). The difference
is in the log, which the board could not read. The log path is not a missing
fact: it is `<worktree>/.plot-worker.log`, and the pulse already reports every
branch's `local_worktree`. Nothing served it.

`GET /api/worker-log?branch=<branch>` now does, and a WORKING row offers it
through its menu.

**Served on demand, pushed nowhere.** A 4 s pulse carrying every agent's
console output to every open tab is a different product. The row offers; the
panel fetches, and only while it is open — closing it unmounts the poller, so a
board with no panel open fetches no logs at all. Both halves are asserted: the
pulse payload is tested for the absence of log content under any key, and a
browser test opens the board, waits, and fails if a single log was fetched
before anyone asked.

**The request names a BRANCH; the path is derived server-side.** A request
carrying a path would be a file-read primitive pointed at the whole filesystem,
dressed as a board feature. `worktreeForBranch` resolves the branch against the
worktrees the pulse itself reported and joins a constant filename inside the
answer, so no request text ever becomes a path segment. This is the same shape
`/plan/<file>` uses — resolve the name against the board's own collected
documents — and it is chosen over pattern-validating the branch for the reason
that route gives: a validator is a rule every future endpoint must remember,
while an allowlist derived from data the server already holds cannot be
forgotten. Git also permits nearly anything in a branch name, so a regex here
would be both weaker and more likely to reject a legitimate branch. A branch
with no known worktree is a 404, never a read attempt.

**The bound is 64 KiB, and it bounds the READ rather than the reply.** The
question a log answers from the board is *what is this agent doing right now*,
and that answer is always in the last screenful; 64 KiB is roughly 700 lines,
more than the panel shows and enough to read backwards through a stack trace.
Scrollback beyond it is a different errand, served by the path the response
carries — a pager handles a 60 MB log far better than a browser does. The file
is never loaded and then sliced: `readTail` takes the size from the open
descriptor and reads only the last 64 KiB, so a 2 GB log costs what a 2 KB one
does. A bound that still allocates the file it is bounding is not a bound.

A truncated tail drops its first line, because a byte-offset seek lands mid-line
and, with any non-ASCII output, mid-character. `truncated` travels as a field
rather than being inferred: a client comparing `text.length` to `bytes` compares
UTF-16 code units to bytes and would call a whole log truncated the first time
an agent printed an emoji. The panel states the truncation and names the full
size — a tail presented as a whole log is the same defect this board keeps
removing.

**Absence is not emptiness — four outcomes, four answers.**

| Outcome | What is true | The reader's move |
|---|---|---|
| `no-worktree` | this machine holds no checkout | ask the machine that took it |
| `no-log` | the worktree is here; nothing wrote | look in the worktree |
| `unreadable` | the file is there and would not open | fix the permission |
| empty log | a worker started and has said nothing | wait, or check its pid |

The empty case is deliberately **not** one of the failure reasons. It is a
successful read of zero bytes — `ok: true`, `bytes: 0` — and typing it as a miss
would put a real observation in the same shape as the three non-observations.
`no-worktree` is the only 404: a worktree with no log is a successful
observation, and a 404 there would tell the client to stop asking about a row it
should keep offering. Four distinct sentences are asserted as four, since a
panel rendering them alike passes every single-case test.

**The item is in the menu, not on the row**, and the structural gate
(`a row's actions all live in its menu`) is what settled it — the row says what
IS, the menu says what you can DO, and a row names its branch, plan and PR, not
its worker's console. The neighbouring precedent is `Open last run`: a read,
about a process the row reports on rather than one the row is. Like that item it
joins `enabled` without a `WillAct` term, because reads are not refused.

**The item is offered on WORKING membership and answered by the server.** The
row carries no worktree and no worker state — this wave adds no field to the
contract — so nothing on the client can know whether a log exists. It does not
guess. An item conditioned on the log existing would be missing in exactly the
cases the endpoint was built to tell apart, and a reader cannot tell an absent
item from an absent log.

Log content renders as text, never as markup: agent output is arbitrary bytes
and frequently includes markup the agent was asked to write.

Two existing assertions changed, both because their premise moved rather than
their rule. `stuck-rows` asserted a healthy WORKING row renders no menu, on the
grounds that it had nothing to do; it now has one thing to do. `agents-tab`
asserted no menu on claimed rows, guarding against offering to dispatch a branch
somebody already holds — that guarantee is now asserted on every row directly
(`Start work` is absent) rather than via the menu's absence, which keeps the
guard on `feature/beans-a`, the row that most needs it.

<!--
bumps:
  skills:
-->

No skill version bumps: this is a board-side change only. Nothing under
`skills/` reads or documents the Agents tab's menu, and no helper script is
touched — `plot-fleet-scan.sh` and `plot-worker-state.sh` are deliberately
untouched, since the log path was already derivable from what the scan reports.
The `/api/fleet` and `/api/board` payloads are unchanged, which is the point of
the wave and is asserted rather than intended.
