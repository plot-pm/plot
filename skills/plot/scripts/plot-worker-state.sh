#!/usr/bin/env bash
# Plot helper: the ONE answer to "is a worker running in this worktree?"
#
# SOURCED, NOT RUN. `. "$script_dir/plot-worker-state.sh"` defines
# `plot_worker_state`; the file does nothing else on load, which is what makes
# sourcing it safe and is why this logic could not simply live in
# plot-dispatch.sh. That file PARSES `$@` and `exit 1`s on a missing slug at
# load time, so sourcing it from the scan would run the dispatcher's argument
# parser against the scan's arguments.
#
# WHY A THIRD FILE AND NOT A SUBPROCESS. Every other cross-script call in the
# fleet shells out (`"$script_dir/plot-config.sh" get …`), and that idiom is
# deliberate elsewhere. It is wrong here: the scan asks this question once per
# branch inside a loop, and the answer is three fields that the caller then
# formats two different ways. Shelling out would fork per branch to serialize
# three values across a pipe so the caller could immediately parse them back —
# and re-parsing a packed string is the shape this merge exists to remove.
#
# THE CALLERS WANT DIFFERENT RENDERINGS OF ONE COMPUTATION.
# `plot-dispatch.sh --status` prints prose for a person (`failed 1234 (exit 3)`)
# and `plot-fleet-scan.sh --json` emits tab-separated fields for a machine
# (`failed\t1234\t3`). Both are real interfaces with tests pinning their bytes,
# so this function returns the FACTS — state, pid, exit code — and renders
# nothing. Each caller formats what it owns.
#
# Six PROCESS states: running, finished, failed, ended, none, elsewhere.
# `elsewhere` is answered by the caller BEFORE this function is reached: it
# means "this machine has no worktree to look in", which is a question about the
# worktree list rather than about anything inside a worktree. plot-dispatch
# iterates worktrees it found on disk and so can never produce it.
#
# TWO TASK STATES, added 2026-08-18: `waiting` and `stalled`. They answer a
# different question from the six above, and that is the whole defect they fix.
#
# THE EXIT CODE CANNOT ANSWER "IS THE TASK DONE?". Measured across seven
# worktrees during a four-agent fleet run: EVERY worker exited 0 — the one that
# opened its PR and reported cleanly, the one that stopped because it would not
# claim a test run it had not seen, and the one that stopped to ask which retry
# semantics were wanted. All three landed on `finished`, whose documented
# meaning is *review it*. Two of the three needed an answer, not a review.
#
# So `finished` is refined by the TREE, which is where the difference lives:
#
#   process alive                    running   leave it alone
#   an open or merged PR             finished  the work reached review
#   a blocked marker in the tree     waiting   a person owes it an answer
#   uncommitted or unpushed work     stalled   work on the floor, no PR
#   otherwise                        finished  nothing left behind
#
# `failed`, `ended`, and `none` are NOT refined. A recorded non-zero exit, an
# unreadable record, and an absent record are each already a specific answer
# about the process, and none of them is the `finished`-means-everything blur
# this refinement exists to split.

# THE BLOCKED MARKER IS A FILE, not a string any file may contain.
#
# Plot instructs a blocked worker to WRITE a file — the `Worker command` in the
# adopting repo's CLAUDE.md says *"write PLOT-BLOCKED: followed by the question
# into a file"*. So `plot_worker_blocked` looks for the file, by name.
#
# A CONTENTS GREP WAS THE ORIGINAL, and it never worked: it matched the marker
# token `PLOT-BLOCKED:` (and `TODO(you|human)`) over file CONTENTS, and 28
# tracked files on `main` contain that token — CLAUDE.md and every brief that
# documents the feature among them — because a marker that must be documented
# appears in its own documentation. A token cannot be both the thing you search
# for and the thing you write about when the search is over everything, so every
# pristine worktree read `waiting` before any worker ran. A filename cannot be
# mentioned into existence by prose: a doc may describe the marker file all it
# likes without becoming one.
#
# `TODO(you|human)` IS DROPPED rather than ported. It was kept as an emergent
# spelling because trees held it, but it is a code-comment convention and
# matching it over contents is the same defect with a smaller blast radius. A
# worker signalling from inside a file writes the marker file too.

# Plot's OWN records inside a worktree — `.plot-worker.pid`,
# `.plot-worker.wrapper.pid`, `.plot-worker.exit`, `.plot-worker.log`, and
# anything else the fleet drops under that prefix (a rotated `.plot-worker.log.1`,
# say). `.plot-worker.pid` names the AGENT; `.plot-worker.wrapper.pid` names the
# shell that records its exit — two pids with two names, because one pid with the
# wrong meaning is the panel bug this prefix now covers a second file to fix.
#
# ONE PATTERN, USED BY BOTH EXCLUSIONS BELOW, because they had already drifted
# apart inside this one file: the marker search excluded the whole prefix while
# the dirty filter named exactly three files, so a rotated log was skipped by
# one and counted as work by the other. Two answers about one file, which is the
# shape this entire plan exists to remove — reproduced here at small scale
# within an hour of removing it at large scale.
PLOT_WORKER_RECORD='\.plot-worker\.'

# ---------------------------------------------------------------------------
# THE REGISTRY HOLDS THE PID — the anchor moved from worktree to manifest
# ---------------------------------------------------------------------------
#
# As of 2026-08-24, the pid is read from the session's manifest in
# `.plot/agents/<session>.json` rather than from `$wt/.plot-worker.pid`. The
# manifest holds the same fact, better: it carries `session`, `branch`,
# `worktree` and `pid` in ONE record, and it includes `startedAt` — the launch
# time that lets us tell a reused pid from the real worker.
#
# WHY THIS MATTERS. A pid can be reused by the operating system. In the worktree
# design the window is small: the file dies with the worktree. In the registry
# design a manifest can sit for weeks. `startedAt` closes it: a pid whose
# process began before the manifest's `startedAt` is not that worker, whatever
# its number. Without it, dead pids are one `fork()` away from reading `running`.
#
# THE WORKTREE→MANIFEST LOOKUP. The manifest directory lives at
# `$PLOT_MANIFEST_DIR` when the caller sets it, or it is derived from the
# worktree's repo root. Each manifest names a `worktree` field; the lookup
# finds the manifest whose worktree matches.

# The manifest directory, set by callers who know their repo root. When unset,
# `plot_manifest_for_worktree` derives it from the worktree's own repo.
: "${PLOT_MANIFEST_DIR:=}"

# Find the manifest for a worktree → the full path, or "" (non-zero).
#
# Iterates `.plot/agents/*.json` and matches on the `worktree` field. The
# dispatcher records the RESOLVED worktree path (`realpath`), so the match is
# tried against both the path as given and its realpath.
plot_manifest_for_worktree() { # $1=worktree → manifest path, or "" (non-zero)
  local wt="$1" dir real f wt_field
  [ -n "$wt" ] || return 1

  # Determine the manifest directory.
  if [ -n "$PLOT_MANIFEST_DIR" ]; then
    dir="$PLOT_MANIFEST_DIR"
  else
    # Derive from the worktree's repo. A worktree IS a git working tree, so
    # `git rev-parse --show-toplevel` from inside it returns the MAIN repo —
    # which is where `.plot/agents/` lives.
    dir=$(git -C "$wt" rev-parse --show-toplevel 2>/dev/null)/.plot/agents
  fi
  [ -d "$dir" ] || return 1

  # Resolve the worktree's realpath for matching.
  real=$(cd "$wt" 2>/dev/null && pwd -P) || real=""

  # Iterate manifests and match on the worktree field.
  for f in "$dir"/*.json; do
    [ -f "$f" ] || continue
    # Extract the `worktree` field. The manifest is pretty-printed, one field
    # per line, so a grep-and-sed approach avoids parsing JSON in bash.
    wt_field=$(grep -m1 '"worktree":' "$f" 2>/dev/null | sed 's/.*"worktree": *"\([^"]*\)".*/\1/')
    [ -n "$wt_field" ] || continue
    if [ "$wt_field" = "$wt" ] || [ "$wt_field" = "$real" ]; then
      printf '%s' "$f"
      return 0
    fi
  done
  return 1
}

# Read pid and startedAt from a manifest → "pid\tstartedAt", or "" (non-zero).
#
# Both fields are extracted; if either is missing the result is empty. A manifest
# with no pid (an older format or a placeholder) returns nothing, which falls
# through to the worktree's `.plot-worker.pid` for backward compatibility.
plot_read_manifest_pid() { # $1=manifest path → "pid\tstartedAt", or "" (non-zero)
  local manifest="$1" pid started
  [ -f "$manifest" ] || return 1

  # Extract fields. The manifest is pretty-printed, one per line.
  pid=$(grep -m1 '"pid":' "$manifest" 2>/dev/null | sed 's/.*"pid": *"\([^"]*\)".*/\1/')
  started=$(grep -m1 '"startedAt":' "$manifest" 2>/dev/null | sed 's/.*"startedAt": *"\([^"]*\)".*/\1/')

  [ -n "$pid" ] && [ -n "$started" ] || return 1
  printf '%s\t%s' "$pid" "$started"
}

# Validate a pid against the manifest's startedAt → 0 if valid, non-zero if stale.
#
# A pid is stale when the process that holds it started BEFORE the manifest's
# `startedAt`. The operating system reuses pids, so a recorded pid that now
# belongs to an older, unrelated process must not read as `running`.
#
# THE CHECK IS ON PROCESS START TIME, not existence. `kill -0` only says the pid
# exists; this says whether it is the SAME process the dispatcher started.
#
# Returns non-zero (stale) on any failure — an unparseable time, a process that
# cannot be inspected, or a platform without `ps -o lstart`. The honest answer
# for an uncheckable pid is "unknown", which the caller turns into `ended`.
plot_pid_is_current() { # $1=pid $2=startedAt (ISO-8601) → 0 if current, 1 if stale
  local pid="$1" started="$2" proc_start manifest_epoch proc_epoch

  # Convert the manifest's startedAt (ISO-8601) to epoch seconds.
  # `date -j -f` is macOS; `date -d` is GNU. Try both.
  if manifest_epoch=$(date -j -f "%Y-%m-%dT%H:%M:%SZ" "$started" +%s 2>/dev/null); then
    :
  elif manifest_epoch=$(date -d "$started" +%s 2>/dev/null); then
    :
  else
    return 1  # Cannot parse; treat as stale to be safe.
  fi

  # Get the process's start time from `ps -o lstart=`. This is portable across
  # macOS and Linux, though the format differs.
  proc_start=$(ps -o lstart= -p "$pid" 2>/dev/null | tr -d '\n')
  [ -n "$proc_start" ] || return 1  # Process does not exist.

  # Convert the process start time to epoch seconds.
  # macOS format: "Mon Aug 24 08:31:25 2026"
  # Linux format: varies; `date -d` handles it.
  if proc_epoch=$(date -j -f "%a %b %d %H:%M:%S %Y" "$proc_start" +%s 2>/dev/null); then
    :
  elif proc_epoch=$(date -j -f "%c" "$proc_start" +%s 2>/dev/null); then
    :
  elif proc_epoch=$(date -d "$proc_start" +%s 2>/dev/null); then
    :
  else
    return 1  # Cannot parse; treat as stale.
  fi

  # A process that started BEFORE the manifest's startedAt is a reused pid.
  # A process that started AT or AFTER is the real worker. We allow 2 seconds
  # of slack for clock skew and rounding — the wrapper writes the pid and then
  # the manifest's awk stamps it; if the second ticks over in between, the
  # process appears to have started 1 second before the manifest says.
  local slack=2
  [ "$proc_epoch" -ge "$((manifest_epoch - slack))" ]
}

# What an editor drops beside real work — `.tmp1`, `.swp`, `.orig`, `.rej`,
# `.bak`. Measured 2026-08-18: an orphaned `plot-dispatch.sh.tmp1` belonging to
# no commit and no task read as uncommitted work and got a healthy branch
# restarted.
#
# A NAMED CONSTANT FOR THE SAME REASON `PLOT_WORKER_RECORD` IS ONE. This list
# was inline in `plot_worker_dirty` while it had one caller. It has two as of
# the change that measures when a branch last CHANGED — which must not let a
# `.tmp1` reset its clock, the same file for the same reason — and two inline
# copies of one list is precisely the drift the constant above was extracted to
# stop, recorded four lines from here.
PLOT_EDITOR_LEFTOVER='\.(tmp[0-9]*|swp|orig|rej|bak)$'

# WHAT A TOOL LEAVES BEHIND, which is not work either — and the second list for
# the same reason the first exists.
#
# `PLOT_EDITOR_LEFTOVER` names files an editor drops beside real work.  These
# are whole DIRECTORIES a tool creates and nobody commits: a browser driver's
# scratch, an agent runner's state. Measured on the project directory —
# the one checkout worked in continuously, and therefore the one that
# accumulates them — `.playwright-mcp/` and `.plot/agents/` were its only
# untracked entries, and they made the row read `local_dirty` for hours with
# nothing being written.
#
# Excluded HERE rather than by dropping untracked files wholesale, which is
# what the first cut did: `test/reconcile/fleet.test.mjs` refuses that in as
# many words — *an untracked source file IS work and must reset the clock* — and
# it is right. A new `new-module.ts` is the most interesting thing a worktree
# can hold; what it is not is a directory nobody will ever commit.
PLOT_TOOL_SCRATCH='(^|/)\.(playwright-mcp|plot/agents|omc/state)(/|$)'

# Where the worker's log lives in this worktree, when one is there at all.
#
# THIS FILE OWNS THE RECORD'S FILENAMES, and that ownership is enforced rather
# than merely intended: `workerstate.test.mjs` asserts that plot-fleet-scan.sh
# never names `.plot-worker.` itself, because a read-only scan that touches the
# worker record has started classifying workers again — the duplication removed
# on 2026-08-18, after the two copies had already drifted.
#
# So the caller that needs the log's mtime asks for the PATH and reads the time
# itself. The split is the same one this whole file draws: what Plot's records
# are called is knowledge that lives here; what a timestamp MEANS is the
# caller's question. `changed_ago_of` in plot-fleet-scan.sh is the one consumer
# — the log is the only source that keeps moving while a build runs, so a
# measurement of "when did anything last change" that could not see it would
# report every worker mid-suite as maximally quiet.
#
# ABSENT IS ABSENT: no worktree, or no log in it, prints nothing and returns
# non-zero. plot-dispatch writes the log only where it started the worker
# itself, so a hand-started worker legitimately has none.
plot_worker_log() { # $1=worktree → path to the worker log, or "" (non-zero)
  local wt="$1"
  [ -n "$wt" ] || return 1
  [ -e "$wt/.plot-worker.log" ] || return 1
  printf '%s' "$wt/.plot-worker.log"
}

# Is a person being waited on inside this worktree?
#
# A MARKER FILE IN THE TREE, NOT A STRING IN A FILE. A blocked worker writes a
# `PLOT-BLOCKED*` file; a doc that mentions the marker does not become one. This
# is the whole fix: the contents grep this replaced matched 28 documenting files
# on `main`, so every pristine worktree read `waiting` before any worker ran.
#
# READ FROM THE TREE, NOT THE LOG, and the file is still the right place to look
# for the same reason the grep was. The log records that a question WAS asked;
# only the tree records that it is still UNANSWERED, and only the tree clears
# when the answering worker deletes the file. Measured: a restarted worker found
# its own question already answered in the commit above it and carried on
# without asking again — the log still held the question, and always will. The
# marker file being its OWN name rather than a line inside `.plot-worker.log`
# keeps that distinction automatically: the log is never a `PLOT-BLOCKED*` file.
#
# AT THE WORKTREE ROOT, not at any depth. Every observed marker sits at the
# root, and root is the stricter answer — a worker that means to signal writes
# where it is told to. The glob is anchored to `"$wt"/` and matches no deeper.
#
# A `for`/`-e` LOOP, NOT `ls "$wt"/PLOT-BLOCKED* >/dev/null`. An unmatched glob
# is shell-dependent, and this file is SOURCED. Under bash — the shell both
# callers (`plot-dispatch.sh`, `plot-fleet-scan.sh`) declare — an unmatched glob
# expands to the literal pattern, which the `-e` test then finds absent, so the
# empty case returns 1 cleanly. That is the case this loop is written for and it
# is verified on the real call path (a bash script sourcing this file).
#
# UNDER zsh THE ANSWER IS STILL CORRECT BUT REACHED THE UGLY WAY: zsh's default
# `nomatch` makes an unmatched glob a fatal error, so a zsh user who sources
# this directly gets the right verdict (non-zero) with a `no matches found` line
# on stderr, from the error rather than from `return 1`. Neither caller is zsh,
# so this does not bite in production; it is recorded here rather than papered
# over, because the honest state is "correct under the callers' shell, noisy
# under a shell no caller uses" — not "identical under both".
plot_worker_blocked() { # $1=worktree → 0 when a person owes this branch an answer
  local wt="$1" f
  [ -n "$wt" ] && [ -d "$wt" ] || return 1
  for f in "$wt"/PLOT-BLOCKED*; do
    [ -e "$f" ] && return 0
  done
  return 1
}

# How much uncommitted work is on the floor, and in which files.
#
# EDITOR LEFTOVERS ARE NOT WORK. Measured 2026-08-18: a guard restarted a branch
# because an orphaned `plot-dispatch.sh.tmp1` — 10 KB belonging to no commit and
# no task — read as uncommitted work. The worker was making progress and had
# just committed.
#
# NOR IS PLOT'S OWN BOOKKEEPING. `.plot-worker.pid`, `.plot-worker.exit` and
# `.plot-worker.log` are files THIS FLEET writes into the worktree, and they are
# untracked, so every stopped worker's own record counted as work left on the
# floor. Measured here while testing: a worktree with nothing in it but a clean
# exit record read `stalled` — which is EVERY worker that finished tidily, the
# exact population this state must not name. Excluding them is not widening the
# rule; it is the `.tmp1` case again, for files Plot itself dropped there.
#
# THE EXCLUSION STAYS NARROW OTHERWISE, by suffix and by Plot's own filenames.
# An uncommitted source file is precisely the case this detection exists for, so
# anything broader — "untracked files do not count", "only tracked changes
# count" — would delete the signal to remove the noise. Tracked or not, a `.ts`
# on the floor is work.
plot_worker_dirty() { # $1=worktree → the dirty files, one per line, leftovers dropped
  local wt="$1"
  [ -n "$wt" ] && [ -d "$wt" ] || return 0
  plot_worker_dirty_filter "$(git -C "$wt" status --porcelain 2>/dev/null)"
}

# The same filter, over status output the CALLER already has.
#
# SPLIT OUT BECAUSE THE STATUS CALL IS THE EXPENSIVE HALF and one caller had
# already paid it. `plot-fleet-scan.sh` runs `git -C <wt> status --porcelain`
# once per worktree when it builds its worktree table; asking `plot_worker_dirty`
# for the file list then ran a SECOND status on the same worktree. Caught by
# `fleet.test.mjs` — "a locked worktree must be asked ONCE" counts the calls,
# because a scan the board polls every 5 s cannot afford to ask git the same
# question twice, and a timing assertion could not tell the difference.
#
# The FILTER is the part worth sharing; the fetching is not. One definition of
# what counts as work on the floor, two ways of getting the input to it — which
# is the same one-computation-two-renderings split this file already draws for
# `plot_worker_state`.
plot_worker_dirty_filter() { # $1=`git status --porcelain` output → the real work
  # `--porcelain` is the STABLE format; `git status` prose is localised and
  # reflows. Cut at column 4: the first three bytes are the XY status pair and a
  # space, and a filename can contain spaces of its own.
  printf '%s' "$1" \
    | cut -c4- \
    | grep -vE "(^|/)$PLOT_WORKER_RECORD" \
    | grep -vE "$PLOT_EDITOR_LEFTOVER" \
    | grep -vE "$PLOT_TOOL_SCRATCH" || true
}

# Refine a clean exit into finished / waiting / stalled.
#
# THE ORDER IS LOAD-BEARING, and each step earns its place from a measured
# mistake rather than from tidiness:
#
# AN OPEN OR MERGED PR OUTRANKS EVERYTHING BELOW IT. Work that reached review
# has left the worker's hands, so leftover local edits mean nothing there — a
# scratch file beside a merged PR is not unfinished work.
#
# `waiting` OUTRANKS `stalled`, because a marker is the worker saying *your
# turn*, and a worker asking a question has almost always left the work it was
# doing uncommitted beside the question. Checking dirtiness first would report
# every such branch `stalled`. Measured: a guard restarted one branch TWICE
# while its worker waited on an answer, and the second restart re-ran work the
# first had finished. That is a loop, not a rescue.
#
# UNCOMMITTED **OR** UNPUSHED. Committing clears dirtiness, so a worker that
# tidied up and stopped before pushing would otherwise read `finished` with
# nobody able to see its commits. Both are "work only this machine holds".
plot_worker_task_state() { # $1=worktree $2=pr-fact → finished|waiting|stalled
  local wt="$1" has_pr="$2"
  [ "$has_pr" = "pr" ] && { printf 'finished'; return; }
  plot_worker_blocked "$wt" && { printf 'waiting'; return; }
  [ -n "$(plot_worker_dirty "$wt")" ] && { printf 'stalled'; return; }
  # UNPUSHED IS A REF QUESTION, asked THROUGH the worktree because that is the
  # checkout whose HEAD is the branch.
  #
  # ONLY `@{upstream}` ANSWERS IT, and when there is no upstream the question is
  # UNANSWERABLE rather than answered zero — or answered anything else. This
  # went in the wrong direction first and was measured doing it: a fallback that
  # counted against `origin/main` reported EVERY clean branch `stalled` in a
  # repo with no remote, because `rev-list --count "..HEAD"` with an empty left
  # side counts the whole history from the root commit. Nine commits of ordinary
  # history read as nine commits of unpushed work.
  #
  # The fallback was also wrong where it worked. A branch legitimately ahead of
  # `origin/main` is the NORMAL state of every branch under review — it is what
  # having commits means — so counting against the trunk marks finished work
  # `stalled` for as long as it exists. Only the branch's OWN upstream separates
  # "pushed" from "not pushed"; the trunk answers a different question entirely.
  #
  # So an absent upstream yields no verdict here and falls through to
  # `finished`, which is the answer the branch gave before this state existed.
  # A failure to observe is not evidence of something to see — the same
  # principle `local_ahead_of` states in plot-fleet-scan.sh, reached the hard
  # way.
  local ahead
  if ahead=$(git -C "$wt" rev-list --count '@{upstream}..HEAD' 2>/dev/null); then
    case "$ahead" in
      ''|0|*[!0-9]*) ;;
      *) printf 'stalled'; return ;;
    esac
  fi
  printf 'finished'
}

# Classify the worker in a worktree.
#
# $1 = worktree path
# $2 = the branch's PR fact, from the CALLER: `pr` when an open or merged PR
#      exists, anything else (including empty) when it does not.
#
# WHY THE PR FACT IS A PARAMETER AND NOT A LOOKUP HERE. This function is called
# once per branch inside the scan's loop, and `plot-fleet-scan.sh --offline`
# PROMISES no network. A host call in here would either break that promise or
# fork a `gh` per branch on every 5-second board poll. The callers already know
# the answer by their own routes and on their own terms — the scan caches one
# host reply per branch per run behind its `--offline` gate; plot-dispatch
# `--status` reads worktrees off disk and never touches the host at all.
#
# So the fact TRAVELS AS A VALUE, exactly as `elsewhere` does: a question about
# something outside the worktree, answered before this function is reached.
# Omitting it is safe and honest — a caller that cannot know says nothing, and a
# branch with work on the floor then reads `stalled`, which is the answer for a
# reader who must go look. It is never upgraded to `finished` by a guess.
#
# THE PID IS READ FROM THE MANIFEST, not from `$wt/.plot-worker.pid`. The
# manifest carries `pid` and `startedAt` together, and `startedAt` is what lets
# us tell a reused pid from the real worker. A pid whose process started before
# the manifest's `startedAt` is stale — the operating system has reused it —
# and is NOT reported as running even if `kill -0` succeeds.
#
# The worktree pid file is kept as a FALLBACK for two cases:
#   1. A hand-started worker with no manifest (the `Worker command` was never
#      run through dispatch, so no manifest exists).
#   2. An older manifest with no `startedAt` — before this change, the manifest
#      carried no launch time. The worktree file is the only record, and the
#      staleness check cannot run, so the old behaviour applies.
#
# Prints "state\tpid\tcode" — pid and code empty where they do not apply.
# Never fails; an unreadable worktree is `none`, which is the honest answer.
plot_worker_state() { # $1=worktree $2=pr-fact → "state\tpid\tcode"
  local wt="$1" has_pr="${2:-}" pid="" code="" started_at="" manifest_data="" manifest=""

  # -------------------------------------------------------------------------
  # Read the pid — first from the manifest, then from the worktree file.
  # -------------------------------------------------------------------------
  #
  # THE MANIFEST IS PRIMARY. It carries both `pid` and `startedAt`, so a pid
  # read here can be validated against the process's actual start time.
  if manifest=$(plot_manifest_for_worktree "$wt" 2>/dev/null) && [ -n "$manifest" ]; then
    if manifest_data=$(plot_read_manifest_pid "$manifest") && [ -n "$manifest_data" ]; then
      pid=$(printf '%s' "$manifest_data" | cut -f1)
      started_at=$(printf '%s' "$manifest_data" | cut -f2)
    fi
  fi

  # FALLBACK to the worktree pid file when the manifest has no usable pid.
  # `started_at` stays empty; the staleness check is skipped, and the old
  # behaviour applies — `kill -0` is trusted.
  if [ -z "$pid" ]; then
    [ -n "$wt" ] && [ -f "$wt/.plot-worker.pid" ] || { printf 'none\t\t'; return; }
    pid=$(cat "$wt/.plot-worker.pid" 2>/dev/null | tr -d ' \n')
    [ -n "$pid" ] || { printf 'none\t\t'; return; }
  fi

  # -------------------------------------------------------------------------
  # Validate the pid.
  # -------------------------------------------------------------------------
  #
  # `kill -0 0` signals the whole process GROUP and succeeds, so pid 0 would
  # read as running forever. It is never a real worker pid. Non-numeric junk is
  # rejected with it: `kill -0` would error on it anyway, and "running" is the
  # one reading a garbled pid must never produce.
  case "$pid" in 0|*[!0-9]*) printf 'none\t\t'; return ;; esac

  # -------------------------------------------------------------------------
  # Liveness check, WITH STALENESS DETECTION.
  # -------------------------------------------------------------------------
  #
  # `kill -0` says the pid exists. But pids are reused: the kernel assigns them
  # from a circular pool, and a manifest that sat for days may name a pid now
  # held by an unrelated process. `startedAt` closes the window: a pid is real
  # only if the process holding it started at or after the time the manifest
  # was stamped.
  #
  # Without `startedAt`, the old behaviour applies: `kill -0` alone decides.
  # This keeps the fallback honest — an uncheckable pid is reported as running
  # when it answers `kill -0`, exactly as before.
  if kill -0 "$pid" 2>/dev/null; then
    if [ -n "$started_at" ]; then
      # STALENESS CHECK: is the process the one we started?
      if ! plot_pid_is_current "$pid" "$started_at"; then
        # The pid exists but belongs to an older process — a REUSE. The worker
        # is dead; treat this as `ended` (no exit file can be trusted either).
        printf 'ended\t%s\t' "$pid"
        return
      fi
    fi
    # The process is running AND current (or uncheckable, with no startedAt).
    printf 'running\t%s\t' "$pid"
    return
  fi

  # -------------------------------------------------------------------------
  # The process is gone. What exit code did it leave?
  # -------------------------------------------------------------------------
  #
  # `kill -0` only separates running from not-running. Whether a stopped worker
  # finished its job or crashed is gone unless the exit code was recorded — and
  # reporting a completed worker as "dead" reads as a crash, which is how a
  # healthy fleet looks broken. The wrapper in start_worker writes the code.
  if [ -f "$wt/.plot-worker.exit" ]; then
    code=$(cat "$wt/.plot-worker.exit" 2>/dev/null | tr -d ' \n')
    case "$code" in
      # EXIT 0 IS THE BLURRED ONE, so it is the only arm refined. The other
      # codes each already say something specific about the process; this one
      # says only "the process ended tidily", which every worker did.
      0)           printf '%s\t%s\t0' "$(plot_worker_task_state "$wt" "$has_pr")" "$pid"; return ;;
      # READ THE EXIT CODE, NOT THE EMPTINESS. An exit file that exists but says
      # nothing usable is `ended`, never `finished`: guessing success from an
      # unreadable record is the same mistake in the other direction, and
      # `finished` is the one answer that tells a reader to stop looking.
      #
      # A NON-NUMERIC CODE IS `ended` HERE, AND THAT RESOLVES A REAL
      # DISAGREEMENT. Before this merge the two copies split on it: the scan
      # answered `ended`, plot-dispatch answered `failed (exit abc)`. Both
      # cannot be kept, so the scan's wins on its own stated principle — an
      # unreadable record licenses no verdict, and "failed with code abc" is as
      # much an invention as "finished" would be. The scan's suite already
      # pinned `ended`; plot-dispatch's pinned only 0, 3, and an absent file, so
      # nothing that was asserted before is asserted differently now.
      ''|*[!0-9]*) printf 'ended\t%s\t' "$pid"; return ;;
      # A PR OUTRANKS A NON-ZERO EXIT — about the TASK, never about the process.
      #
      # The exit code answers "how did the process end?"; the row renders
      # "someone is on it", which is a claim about the WORK. Those come apart
      # exactly when a worker is killed AFTER delivering, and then the failure
      # arm is frozen on a claim that was already false: nothing about the
      # branch can change a recorded exit code, so the row never recovers.
      #
      # Measured 2026-08-24 on `bug/the-agents-tab-filters-on-membership`: a
      # worker SIGTERMed (143) with its work pushed and PR #393 open rendered
      # `worker crashed - someone is on it` indefinitely.
      #
      # THE CODE IS STILL REPORTED. Only the state word changes; a reader can
      # still see the worker was killed. And with no PR fact this stays
      # `failed` — the guess in the other direction, calling a genuine crash
      # finished, is the one this must never make. A PR is the fact that
      # licenses it, because a PR means the work reached a reviewer.
      *)           if [ "$has_pr" = pr ]; then
                     printf '%s\t%s\t%s' "$(plot_worker_task_state "$wt" "$has_pr")" "$pid" "$code"
                   else
                     printf 'failed\t%s\t%s' "$pid" "$code"
                   fi; return ;;
    esac
  fi
  # No exit file: a worker started before the code was recorded, or one killed
  # outright. Unknown is its own answer — guessing "finished" would be the same
  # mistake in the other direction.
  printf 'ended\t%s\t' "$pid"
}
