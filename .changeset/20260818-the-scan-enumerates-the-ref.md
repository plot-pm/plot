---
"plot": patch
---

<!--
bumps:
  skills:
    plot: patch
-->

plot-fleet: the scan enumerates the ref it names

`plot-fleet-scan.sh` derived every fact from `origin/$MAIN` and said so in its
banner, but built the plan list from a filesystem glob over the active index.
`git fetch` updates refs; a glob cannot see them. Measured in a two-clone
sandbox, 2026-08-18:

    origin/main active plans (the REF): 3
    working tree active plans:          2
    scan --json reports:                2 plans

The fetch **succeeded**. `origin/main` genuinely carried a third plan pushed by
a second agent minutes earlier, and the scan reported two and exited 0 — so
nothing anywhere could tell that answer from a correct one. The board's plan
list was only ever as current as the operator's last `git pull`.

It is worse during the fleet run the board exists to watch: rebases, checkouts
and worker commits rewrite the working tree continuously, so the glob can
return a different set on each 5 s poll while exiting 0 every time. That is the
flicker `bug/a-smaller-pulse-is-not-silently-better` guards against; this is
the cause underneath it.

Plans are now enumerated with `git ls-tree origin/$MAIN` and read with
`git show`, so the scan describes **one atomic commit**. Two polls of the same
ref return the same plans no matter what is happening on disk.

**Worktree observation stays local.** `local_dirty`, `local_worktree` and the
`.git/index.lock` check describe *this machine* on purpose — they are the one
place the scan knows more than the refs do, and moving them to the ref would
delete the signal rather than fix it. The split is: plan enumeration from the
ref, worktree observation local.

**An uncommitted plan is now invisible, deliberately.** The plan's Open Points
asked for this to be decided rather than left implicit. Three reasons it is
right: the fleet view answers *what may a worker claim*, and workers are
detached agents in other worktrees and on other machines — not one of them can
claim a plan that exists only in the operator's editor buffer; `/plot-idea`
commits and pushes in the same flow, so the window is seconds wide, not a state
anyone opens a board to watch; and a board that mixes shared state with one
machine's scratch is the bug this file keeps fixing — `local_dirty` exists
precisely so local facts travel *labelled* as local. The rule is: committed is
shared, and the fleet view shows what is shared.

**A failed fetch is reported rather than discarded.** The old line was
`git fetch … 2>/dev/null` with its status dropped, so a 503, a held ref lock or
an offline laptop produced a scan indistinguishable from a healthy one. The
scan still runs — `origin/$MAIN` from an hour ago is a real answer about a real
commit, and refusing to report it would trade a slightly stale board for no
board at all, exactly when the operator is most likely watching something go
wrong. What changes is that the staleness is carried: `fetch_failed` and
`fetch_error` in `--json`, a note in the prose. `--offline` is not a failure —
the operator asked for local refs and got them.

When `origin/$MAIN` cannot be resolved at all (a fresh clone, no remote) the
scan falls back to the checkout and **says so** via `plan_source`. Falling back
is honest; falling back silently would recreate this bug in the one case where
nothing can catch it.

Two faults found while building this, both invisible in the output:

- The temp dir holding materialized blobs was created inside
  `$(ref_plan_file …)` — a **subshell** — so the parent's variable stayed empty
  and the `EXIT` trap cleaned nothing: one leaked directory per plan, per 5 s
  poll. Its lifetime is now owned outside the function.
- An **absolute** symlink target (`ln -s "$(pwd)/…"`, which the board's own
  fixtures write) names no path inside a repository, so prefixing it with the
  link's directory resolved to nothing and the plan silently left the pulse.
  Caught by three board suites going from 104 passing to 93. Only the basename
  of an absolute target can be trusted, and only inside `$PLAN_DIR`.
