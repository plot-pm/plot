---
"plot": patch
"@plot-pm/board": patch
---

<!--
bumps:
  skills:
    plot: minor
    plot-dispatch: minor
    plot-fleet: minor
-->

plot: `finished` is not a verdict

Every worker exits 0 — the one that opened its PR and reported cleanly, the one
that stopped rather than claim a test run it had not seen, and the one that
stopped to ask which retry semantics were wanted. Measured across seven
worktrees during a four-agent fleet run. All three read `finished`, whose
documented move is *review it*, and two of the three needed an answer instead.

The process reports how it TERMINATED, never whether the task is DONE. So a
clean exit is now refined by the tree, which is where the difference lives:

| Condition | State |
|---|---|
| process alive | `running` |
| an open or merged PR | `finished` — the work reached review |
| a blocked marker in the tree | `waiting` — a person owes it an answer |
| uncommitted or unpushed work | `stalled` — work on the floor, no PR |
| otherwise | `finished` |

Added **once**, to `plot-worker-state.sh`, which is the whole reason wave 1
merged the duplicate first. `failed`, `ended` and `none` are untouched: each
already says something specific about the process, and none of them is the
`finished`-means-everything blur this splits.

`waiting` and `stalled` are as opposite as `failed` and `finished` — *answer it*
sends a person to a question, *resume it* sends a worker back to work. A marker
therefore outranks work on the floor: a worker that stops to ask has almost
always left its work uncommitted beside the question, and reporting that as
stalled invites a restart into the same wait. Measured happening twice to one
branch, the second restart re-running what the first had finished.

**Plot now names the marker: `PLOT-BLOCKED:`.** `TODO(you)` emerged from workers
and was documented nowhere, so it could drift into `TODO(human)` — which it
already had, in the same session — or into `ASK:` or prose, and a marker the
classifier cannot find is a `waiting` reported as `stalled`. Both emergent
spellings stay recognised beside the defined one: they exist in trees right now,
and dropping them would silently regress every worker already running. The
defined marker is what Plot **asks** for; the emergent ones are what it still
**accepts**.

The marker is read from the TREE, never the log. The log records that a question
*was asked*; only the tree records that it is still *unanswered*, and only the
tree clears when someone writes the answer.

**`stalled` carries what is on the floor** — the count and the file names, not
just a number. The names make the row actionable without a second command,
which is the point of reporting it at all.

**The PR fact travels as an argument**, supplied by each caller. The scan caches
one host reply per branch per run behind its `--offline` gate; `plot-dispatch
--status` asks per branch when a person types it. A lookup inside the classifier
would fork a `gh` per branch on a scan the board polls every 5 s, or break
`--offline`'s promise of no network. Unanswerable is never a yes — offline, no
backend, or a host returning 503 falls through to the local signals and reads
`stalled`: *go and look*, rather than *stop looking*.

**Editor leftovers are not work** (`.tmp*`, `.swp`, `.orig`, `.rej`, `.bak`) —
a guard restarted a branch over an orphaned `plot-dispatch.sh.tmp1` while its
worker was making progress. Nor is Plot's own bookkeeping: `.plot-worker.pid`,
`.plot-worker.exit` and `.plot-worker.log` are untracked files the fleet writes
into the worktree, and counting them made every tidily-finished worker read
`stalled`. The exclusion stays narrow otherwise — an uncommitted source file is
exactly the case this detection exists for.

Two silent failures were caught while building this, both in the reassuring
direction and both invisible behind `2>/dev/null`. `git grep --no-index
--untracked` is a fatal error (the flags are mutually exclusive), and `git grep
-qIE <pattern> --untracked` parses `--untracked` as a revision — each exits 128
having matched nothing, so every waiting worker would have read `stalled`. And
an unpushed-count fallback against `origin/main` reported every clean branch
`stalled` in a repo with no remote, because `rev-list --count "..HEAD"` with an
empty left side counts the whole history from the root. Only the branch's own
`@{upstream}` answers that question; with no upstream it is unanswerable, and an
unanswerable question licenses no verdict.

The board reports both states in `waiting-on-you` with distinct notes — *waiting
on an answer from you* versus *stopped with work unfinished — resume it*.

**Nothing is restarted.** The scan is read-only (Manifesto Principle 1); a
`stalled` row names the branch and what is on the floor, and the decision to
relaunch stays in `/plot-dispatch`. The reaper is untouched: it classifies
*empty* claims and answers a different question, and a stalled worker has work
worth keeping.

The prototype `.dev/scripts/fleet-pulse.sh` — corrected three times by watching
it act — is deleted. Two things computing verdicts from one dataset is how they
drift, which is the defect wave 1 removed.
