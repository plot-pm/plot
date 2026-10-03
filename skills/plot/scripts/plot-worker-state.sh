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
# `$PLOT_MANIFEST_DIR` when the caller sets it, and is otherwise resolved from
# the MAIN CHECKOUT and the `Agent registry` key. Each manifest names a
# `worktree` field; the lookup finds the manifest whose worktree matches.
#
# THE RULE IS `deskManifest` / `manifestDirectory` IN THE DOMAIN
# (`packages/domain/src/rules/desk-manifest.ts`), and this is a DECLARED
# DUPLICATE of it rather than a call to it. `docs/shell-and-domain.md` puts the
# choice on the cost: `plot_manifest_for_worktree` runs once per worktree per
# fleet-scan pass, and a bundle answers in about 39 ms, so a hop here is paid by
# every desk on every pass forever. `packages/domain/corpus/desk-manifest.corpus.test.ts`
# holds the pair. NEITHER SIDE IS AUTHORITATIVE: on a disagreement the branch
# stops, and adjusting either side to make the comparison pass is forbidden.

# The manifest directory, set by callers who know their repo root. When unset it
# is resolved once at source time, below.
: "${PLOT_MANIFEST_DIR:=}"

# The MAIN checkout for a directory, or "" — the reading `plot_repo_root`
# (`plot-desk-root.sh:38-46`) makes, asked of a path rather than of the cwd.
#
# `--show-toplevel` ANSWERS THE DESK inside a linked worktree, which is the whole
# of #1086: this function derived `<desk>/.plot/agents` and found no manifest, so
# every worker-state reading taken from inside a dispatched desk read its agent
# as unregistered. Every linked worktree shares ONE common git dir, so the
# parent of `--git-common-dir` is the main checkout from anywhere.
#
# THE COMMON DIR MAY BE RELATIVE. In a linked worktree git prints an absolute
# path; in the main checkout it prints `.git`, relative to the tree. So it is
# resolved by `cd`-ing to the tree FIRST and then to the common dir, which makes
# both forms absolute, and `pwd -P` keeps it physical for the same reason
# `plot-desk-root.sh` does: `git worktree list` prints resolved paths, and a
# directory composed from a logical one (`/tmp` against `/private/tmp` on macOS)
# is a prefix no worktree path starts with.
plot_main_checkout_of() { # $1=directory → the main checkout, or "" (non-zero)
  local at="$1" common root=''
  [ -n "$at" ] && [ -d "$at" ] || return 1
  common=$(git -C "$at" rev-parse --git-common-dir 2>/dev/null) && [ -n "$common" ] && {
    common=$(cd -- "$at" 2>/dev/null && cd -- "$common" 2>/dev/null && pwd -P) || common=''
    [ -n "$common" ] && root=$(dirname -- "$common")
  }
  [ -n "$root" ] || root=$(git -C "$at" rev-parse --show-toplevel 2>/dev/null) || return 1
  [ -n "$root" ] || return 1
  printf '%s' "$root"
}

# The `Agent registry` directory for a main checkout — `manifestDirectory`'s rule.
#
# An absolute value is taken as given, so a project may name a registry outside
# its own tree; a relative one joins to the MAIN CHECKOUT, never to a desk,
# because a desk must resolve the same directory the checkout does (`CLAUDE.md`
# gives that reason for `Board artifact` and `Agent settings`). An absent or
# empty key means `.plot/agents`. The trailing slash is trimmed, the way
# `plot-dispatch.sh:agent_registry_dir` trims one and `path.join` normalises
# one — two answers to *where is the registry* is what this removes.
# `PLOT_REPO_ROOT` IS PASSED AND NEVER INHERITED, which is this function's one
# trap. `plot-config.sh:222` takes an exported `PLOT_REPO_ROOT` in preference to
# asking git, and the fleet wrapper exports the DISPATCHING repository's root
# into every agent — so a lookup about a desk in another checkout read this
# repository's `CLAUDE.md`. Measured 2026-10-02 while building this slice: a
# fixture repo with its own `Agent registry` key answered the surrounding repo's
# `.plot/agents`. Its own fallback is `--show-toplevel`, which answers the DESK,
# so leaving the variable unset would reintroduce #1086 one layer down.
plot_manifest_dir_for() { # $1=main checkout → prints the directory
  local root="$1" dir=''
  if [ -x "$_plot_wstate_config" ] || [ -r "$_plot_wstate_config" ]; then
    dir=$(PLOT_REPO_ROOT="$root" bash "$_plot_wstate_config" get "Agent registry" "" 2>/dev/null) || dir=''
  fi
  # Whitespace alone is a key nobody filled in.
  dir=$(printf '%s' "$dir" | tr -d '[:space:]')
  [ -n "$dir" ] || dir=".plot/agents"
  case "$dir" in
    /*) ;;
    *)  dir="${root%/}/$dir" ;;
  esac
  printf '%s' "${dir%/}"
}

# `plot-config.sh`, resolved ONCE at source time the way `plot-desk-root.sh:48`
# resolves its own bundle: reading `BASH_SOURCE[0]` inside a function reads the
# CALLER's file once the function has been exported.
_plot_wstate_config="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)/plot-config.sh"

# THE DIRECTORY IS RESOLVED AT SOURCE TIME, AND THAT IS NOT A STYLE CHOICE.
# Both callers invoke the lookup as `manifest=$(plot_manifest_for_worktree …)`,
# so an assignment made inside it dies with the command substitution's subshell
# and a cache set there never reaches a second call. Resolving here spends one
# `plot-config.sh` fork per PROCESS instead of one per desk per pass.
#
# A CALLER-SET VALUE WINS and is never overwritten: the dispatcher and the tests
# set it, and they know their repo root without being asked.
if [ -z "$PLOT_MANIFEST_DIR" ]; then
  _plot_wstate_root=$(plot_main_checkout_of "$PWD" 2>/dev/null) || _plot_wstate_root=''
  if [ -n "$_plot_wstate_root" ]; then
    PLOT_MANIFEST_DIR=$(plot_manifest_dir_for "$_plot_wstate_root")
  fi
  unset _plot_wstate_root
fi

# Find the manifest for a worktree → the full path, or "" (non-zero).
#
# Iterates the registry's `*.json` and matches on the `worktree` field. BOTH
# SIDES CARRY BOTH PATH FORMS: the dispatcher records the RESOLVED worktree path
# (`realpath`) and git may report either, and a desk registered by its symlinked
# path must still be found by its real one. So the manifest's field is resolved
# too, and either form matches either.
#
# SEVERAL MANIFESTS IS NOT THE FIRST MATCH. Two agents on one desk is an estate
# defect, and returning the first hides it, so this returns non-zero — the same
# answer `deskManifest` gives as `several`, which every caller reads as *no
# manifest*.
#
# ABSENT IS NOT FALSE: a missing directory, an unreadable manifest and a desk
# that is gone all answer "no manifest" rather than failing loudly.
plot_manifest_for_worktree() { # $1=worktree → manifest path, or "" (non-zero)
  local wt="$1" dir real f wt_field wt_real found='' count=0
  [ -n "$wt" ] || return 1

  # The directory: the caller's value, then the one resolved at source time, then
  # a resolution from the WORKTREE's own main checkout — which covers a caller
  # whose cwd is outside any repository.
  dir="$PLOT_MANIFEST_DIR"
  if [ -z "$dir" ]; then
    local root
    root=$(plot_main_checkout_of "$wt" 2>/dev/null) || root=''
    [ -n "$root" ] || return 1
    dir=$(plot_manifest_dir_for "$root")
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
    # The manifest's own realpath, for the symlinked-registration case. A field
    # naming a desk that is gone resolves to nothing and matches on its text.
    wt_real=$(cd "$wt_field" 2>/dev/null && pwd -P) || wt_real=""
    if [ "$wt_field" = "$wt" ] || [ "$wt_field" = "$real" ] ||
       { [ -n "$wt_real" ] && { [ "$wt_real" = "$wt" ] || [ "$wt_real" = "$real" ]; }; }; then
      found="$f"
      count=$((count + 1))
    fi
  done

  # Exactly one, or nothing. `several` is named by the count, not by a pick.
  [ "$count" = 1 ] || return 1
  printf '%s' "$found"
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
PLOT_TOOL_SCRATCH='(^|/)\.(playwright-mcp|plot/agents|plot/state|omc/state)(/|$)'

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
# Why did the worker in this worktree end?
#
# A SEPARATE READING FROM `plot_worker_state`, and deliberately so. That function
# answers what the PROCESS did and what the desk holds; this answers why the
# worker stopped, which is a fact only the worker itself could record. The two
# come apart in the case that matters: a worker ended by the floor and one ended
# by a monitor finding both leave `.plot-worker.exit` holding `124`, so the exit
# code cannot tell them apart and the state word does not try to.
#
# IT IS NOT FOLDED INTO THE STATE ROW. `plot_worker_state` prints three
# tab-separated fields that three callers and one domain port parse positionally;
# a fourth field would change a contract this reading does not need to change.
# `plot_worker_log` is the precedent — a standalone reader beside the state
# function, asked by whoever wants it.
#
# ABSENT IS ABSENT, and it is load-bearing. No worktree, or no ending file in
# one, prints nothing and returns non-zero — which is what a SIGKILLed worker
# leaves behind, and what every worker that ran before this record existed
# leaves too. The domain's `readEnding` keeps that apart from a file that exists
# and does not parse; this prints the bytes and decides neither.
plot_worker_ending() { # $1=worktree → the ending record's JSON, or "" (non-zero)
  local wt="$1"
  [ -n "$wt" ] || return 1
  [ -f "$wt/.plot-worker.ending.json" ] || return 1
  cat "$wt/.plot-worker.ending.json" 2>/dev/null
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

# WHICH file carries the question — the basename, for a caller that must name it.
#
# HERE, BESIDE THE GLOB, and not in the caller. A refusal that says only "this
# branch is blocked" sends its reader hunting, so `--restart` names the file;
# but re-globbing `PLOT-BLOCKED*` there would put the marker's spelling in two
# places, which is the drift the structural test in `workerstate.test.mjs`
# pins against. The classification and the name of the thing classified stay
# together: one glob, asked two ways.
#
# Prints nothing and returns 1 when no marker exists, so a caller can use the
# output directly or fall back.
plot_worker_blocked_file() { # $1=worktree → prints the marker's basename
  local wt="$1" f
  [ -n "$wt" ] && [ -d "$wt" ] || return 1
  for f in "$wt"/PLOT-BLOCKED*; do
    [ -e "$f" ] && { printf '%s' "${f##*/}"; return 0; }
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

# Keep a file the estate writes into every desk out of `git status`.
#
# THROUGH THE CLONE'S `info/exclude`, never `.gitignore`: a `.gitignore` rule
# lives in the branch's own content, so a desk cut from an older branch would
# not see it, and `info/exclude` is per-repository and shared by every worktree.
# The directory and the file are CREATED when absent. Measured 2026-10-01
# (#1130): a clone with no `.git/info/exclude` kept `?? .metadata_never_index`
# in every free desk, and the AgentMonitor reported each waiting agent as
# `holds unlanded work`, because the writer skipped a file that did not exist.
#
# Best-effort: a desk that cannot take the line still works. Always returns 0.
plot_desk_exclude() { # $1=worktree $2=the exact line to exclude
  local common excl
  common=$(git -C "$1" rev-parse --git-common-dir 2>/dev/null) || return 0
  [ -n "$common" ] || return 0
  case "$common" in /*) ;; *) common="$1/$common" ;; esac
  excl="$common/info/exclude"
  mkdir -p "$common/info" 2>/dev/null || return 0
  grep -qxF "$2" "$excl" 2>/dev/null || printf '%s\n' "$2" >> "$excl" 2>/dev/null || true
  return 0
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

# ---------------------------------------------------------------------------
# THE ONE-SAMPLE `idle` RULE — the shell's half of a declared duplicate
# ---------------------------------------------------------------------------
#
# A DECLARED DUPLICATE OF `idleNow`, and the pair is held by
# `packages/domain/corpus/sample.corpus.test.ts`. `docs/shell-and-domain.md` §1
# settles which side of the cost rule this falls on: the rule is asked once per
# agent per pass, so a 39 ms `node` hop is paid by every agent on this machine
# forever. Neither side is authoritative — on a disagreement the branch stops,
# and adjusting either side to make the comparison pass is the one move
# forbidden.
#
# WHY IT LIVES HERE RATHER THAN IN THE MONITOR. Two callers read it: the
# WorkerMonitor sources this file today, and the loop's own watcher sources it
# too. One function, two readers, one answer — the same split this file was
# extracted to hold.

# Seconds since the newest thing in a desk's tree changed.
#
# THIS IS WHAT REPLACED A COMPARISON BETWEEN TWO PASSES. The two-sample rule
# asked *did the fingerprint change between pass N-1 and pass N*, which needs a
# process to hold pass N-1. This asks *how long since anything moved*, which the
# filesystem has been recording all along — and `at least the window` is a
# stronger statement than `unchanged across two passes 30 s apart`.
#
# THREE SOURCES, AND THE NEWEST OF THEM WINS:
#
#   HEAD's committer time        an agent that commits has plainly done something
#   each dirty path's mtime      an agent editing a file
#   each dirty path's PARENT     an add, a removal or a rename, which does not
#                                move any surviving file's own mtime
#
# THE DESK ROOT'S OWN MTIME IS NEVER READ, and that is the reading's one
# deliberate blind spot. The loop writes `.plot-worker.*` records into the desk
# root and replaces them (`plot-dispatch.sh`'s manifest `mv`), which moves the
# root directory's mtime. `plot_worker_dirty_filter` drops those records from
# the list, but a dirty path AT the root would still contribute its parent — the
# root — and the loop's own bookkeeping would then read as tree activity, so
# `idle` could never fire. A parent counts only BELOW the root; a root-level
# dirty path contributes its own mtime instead. The stated cost: a removal or a
# rename at the desk root alone does not move this number.
#
# `unreadable` WHERE THERE IS NO TREE TO READ, and that word travels to the
# verdict rather than being collapsed into a number. A failure to observe is not
# evidence of something to see; zero would read as *everything just moved* and
# a huge number as *nothing has moved in years*, and both are inventions.
plot_worker_tree_quiet_seconds() { # $1=worktree → seconds | unreadable
  local wt="$1" status paths head_ct now newest
  [ -n "$wt" ] && [ -d "$wt" ] || { printf 'unreadable'; return 0; }

  # HEAD's committer time, which is the whole reading on a clean tree. A repo
  # with no commit yet answers nothing and leaves the dirty paths to speak.
  head_ct=$(git -C "$wt" log -1 --format=%ct 2>/dev/null)
  case "$head_ct" in ''|*[!0-9]*) head_ct='' ;; esac

  # `-uall` IS FOR THIS READING ONLY, AND IT IS A MEASUREMENT RATHER THAN A
  # TIDINESS. Default porcelain collapses a wholly new untracked directory to
  # one line, `?? brandnew/`, because once git knows the whole directory is
  # untracked it stops descending — fine for a display, fatal for an mtime. A
  # directory's mtime moves when an ENTRY is added or removed and not when a
  # file inside it is written, so a file an agent is editing right now inside a
  # directory it created earlier reads as untouched. Measured 2026-10-02: a
  # directory aged 2 000 s holding a file 1 s old read `tree quiet: 2001`, which
  # is a false `idle` on an agent mid-edit. `-uall` lists `brandnew/f.txt`, so
  # the file's own mtime is read and its parent is read beside it.
  #
  # THE FINGERPRINT KEEPS THE DEFAULT, and the asymmetry is correct: it asked
  # *did these path NAMES change*, and a collapsed directory's name changes when
  # the directory appears. This asks *when did anything move*, which the name
  # cannot answer. Recorded in the plan's Open Points rather than widened
  # silently.
  status=$(git -C "$wt" status --porcelain -uall 2>/dev/null)

  # THE SAME FILTER THE FINGERPRINT USED, for the same reason: this script's own
  # records and the monitor's findings file are not work an agent left, and a
  # raw status would make the monitor watch itself.
  paths=''
  if command -v plot_worker_dirty_filter >/dev/null 2>&1; then
    paths=$(plot_worker_dirty_filter "$status")
  else
    paths=$(printf '%s' "$status" | cut -c4-)
  fi

  # Every path to stat, one per line, absolute. Built in awk rather than a bash
  # loop so a desk holding hundreds of dirty paths costs one fork.
  #
  # A RENAME ARRIVES AS `old -> new` and the NEW name is the one that exists.
  # A path with unusual bytes arrives quoted by git; the quotes are stripped so
  # `stat` sees the name, which is lossy for a true embedded quote and the
  # alternative is parsing C escapes in awk.
  #
  # A DELETED PATH DOES NOT EXIST, so its own mtime is unreadable. It is still
  # listed — `stat` simply says nothing for it — and its parent below the root
  # carries the change, which is exactly what a removal moves.
  local list
  list=$(printf '%s\n' "$paths" | awk -v wt="$wt" '
    { line = $0 }
    line == "" { next }
    # A rename: take the destination, which is the name on disk now.
    {
      i = index(line, " -> ")
      if (i > 0) line = substr(line, i + 4)
      # Git quotes a path holding unusual bytes. Drop the quotes; the escapes
      # inside are left as they are, and such a path simply reads unreadable.
      if (substr(line, 1, 1) == "\"" && substr(line, length(line), 1) == "\"")
        line = substr(line, 2, length(line) - 2)
      if (line == "") next
      print wt "/" line
      # THE PARENT, BUT ONLY BELOW THE ROOT. A path with no `/` in it sits at
      # the desk root, and the root is the directory the loop keeps touching.
      if (index(line, "/") > 0) {
        n = line
        sub(/\/[^\/]*$/, "", n)
        if (n != "" && n != ".") print wt "/" n
      }
    }
  ')

  # ONE `stat` CALL OVER EVERY PATH, and the flavour is probed once against a
  # directory that certainly exists.
  #
  # THE ORDER IS LOAD-BEARING AND CI MEASURED WHY. On Linux `stat -f` is not an
  # unknown flag — it means FILESYSTEM info and it SUCCEEDS, printing
  # `Namelen: 255  Type: ext2/ext3`, which a caller then subtracts from a clock
  # (`plot-fleetctl.sh`, and two tests that passed on macOS). So GNU's own form
  # is asked first, because GNU is the implementation that mis-parses the other's
  # flag, and each answer is validated as digits rather than trusted.
  newest="$head_ct"
  if [ -n "$list" ]; then
    local fmt='' mtimes
    if [ -n "$(stat -c %Y "$wt" 2>/dev/null)" ]; then fmt='gnu'
    elif [ -n "$(stat -f %m "$wt" 2>/dev/null)" ]; then fmt='bsd'
    fi
    if [ -n "$fmt" ]; then
      # A missing path makes `stat` exit non-zero while still printing the
      # others, so the exit code is deliberately not read.
      if [ "$fmt" = 'gnu' ]; then
        mtimes=$(printf '%s\n' "$list" | tr '\n' '\0' | xargs -0 stat -c %Y 2>/dev/null)
      else
        mtimes=$(printf '%s\n' "$list" | tr '\n' '\0' | xargs -0 stat -f %m 2>/dev/null)
      fi
      # The maximum, taken in awk: only lines that are entirely digits count, so
      # a filesystem report or an error line cannot become a timestamp.
      local max
      max=$(printf '%s\n' "$mtimes" | awk '/^[0-9]+$/ { if ($0 > m) m = $0 } END { if (m != "") print m }')
      if [ -n "$max" ]; then
        if [ -z "$newest" ] || [ "$max" -gt "$newest" ] 2>/dev/null; then newest="$max"; fi
      fi
    fi
  fi

  # NO COMMIT AND NO READABLE PATH is no reading at all — a desk whose git
  # directory cannot be read, or a worktree with no history yet and nothing on
  # the floor. It is not a very long silence.
  [ -n "$newest" ] || { printf 'unreadable'; return 0; }

  now=$(date +%s)
  local quiet=$(( now - newest ))
  # A time in the future — clock skew across a mounted volume — reads as zero
  # rather than negative. A comparison against a window would behave correctly
  # by accident here and not elsewhere; clamping says what is meant.
  [ "$quiet" -lt 0 ] && quiet=0
  printf '%s' "$quiet"
}

# Is this desk idle, from ONE reading of it?
#
# THE SHELL'S COPY OF `idleNow`, argument for argument. Six readings in, one
# word out:
#
#   $1 pid        alive | dead | unrecorded
#   $2 spoken     1 spoken | 0 not  (a reading, never an absence)
#   $3 silence    seconds since the newest transcript line, or any non-number
#   $4 activity   the sampler's word: `working` vetoes, `idle` and `` do not
#   $5 treeQuiet  seconds since the newest tree change, or any non-number
#   $6 commits    yes | no | unanswerable
#   $7 window     seconds a duration must reach
#
# ONE WORD ON STDOUT AND EXIT 0, ALWAYS. A caller that tests only for empty
# output cannot tell `silent` from *the function was missing*, so read the exit
# code: this prints `idle` or `silent` and returns 0, and a shell that never
# sourced this file returns 127 having printed nothing.
#
# `≥ window`, NOT `>`. The window is where the question becomes worth asking, so
# a desk exactly at it is eligible — the same boundary `quiet -lt window → busy`
# draws from the other side.
#
# THE CPU IS A VETO AND NOT THE VERDICT. Only `working` refuses, because only
# `working` says something is running. `idle` (a frozen subtree clock) and ``
# (no child holding a clock at all) agree here: past the window, each is an
# agent that has stopped. That is the opposite of how the old CPU-snapshot rule
# read the empty answer, and deliberately so — this line is reached only after
# the window has already elapsed.
#
# NO `gone` ARM. A dead pid answers `silent`: the wrapper that starts the agent
# knows the instant it ends and publishes `gone` itself.
#
# AN UNREADABLE VALUE ANSWERS `silent`, every one of them. An `unrecorded` pid,
# an `unavailable` transcript, an `unreadable` tree and an `unanswerable` commit
# question each withhold the finding, because a failure to observe is not
# evidence of something to see.
plot_worker_idle_now() { # $1..$7 as above → idle | silent
  local pid="$1" spoken="$2" silence="$3" activity="$4" tree="$5" commits="$6" window="$7"

  [ "$pid" = 'alive' ]  || { printf 'silent'; return 0; }
  [ "$spoken" = '1' ]   || { printf 'silent'; return 0; }

  # A non-numeric duration is a reading that was not taken. `unavailable`,
  # `unreadable` and an empty string all land here, and so would a filesystem
  # report that slipped past the validation above.
  case "$window"  in ''|*[!0-9]*) printf 'silent'; return 0 ;; esac
  case "$silence" in ''|*[!0-9]*) printf 'silent'; return 0 ;; esac
  [ "$silence" -ge "$window" ] || { printf 'silent'; return 0; }

  [ "$activity" = 'working' ] && { printf 'silent'; return 0; }

  case "$tree" in ''|*[!0-9]*) printf 'silent'; return 0 ;; esac
  [ "$tree" -ge "$window" ] || { printf 'silent'; return 0; }

  [ "$commits" = 'yes' ] || { printf 'silent'; return 0; }
  printf 'idle'
  return 0
}

# ---------------------------------------------------------------------------
# THE WATCHER'S OWN PASS — the readings `plot_worker_idle_now` is asked about
# ---------------------------------------------------------------------------
#
# MOVED FROM `plot-worker-monitor.sh` RATHER THAN REWRITTEN. The WorkerMonitor
# process is gone (`bug/the-loop-reports-idle`): the loop's own watcher
# subshell calls these instead, so the readings move to the file the loop
# already sources rather than living in a script that no longer runs.
#
# `monitor_has_commits` IS MOVED, NOT CHANGED. The scope guard that made it
# untouchable in wave 1 still holds — the `-- .` pathspec and the
# `origin/<default>` resolution are copied verbatim, including the comment
# that explains why a dispatched branch's own claim commit must not count.

# The reset epoch a desk is waiting out, or nothing.
#
# THE LOOP WRITES THE FILE AND THIS ONLY READS IT. `.plot-worker.limited`
# carries the reset epoch, the same instant as ISO text, and the limit line;
# only the first field is read here, because the caller compares integers and
# never parses a date.
#
# NOTHING IS ANSWERED FOR AN ABSENT, EMPTY OR UNPARSEABLE FILE, and the caller
# reads that as *this desk is not waiting*. A record whose first field is not a
# number is the same answer as no record: a reading that cannot be made must
# not widen into a reason to hold a verdict back.
plot_worker_limited_reset() { # $1=worktree → epoch seconds | ""
  local file="$1/.plot-worker.limited" reset
  [ -n "$1" ] && [ -r "$file" ] || return 0
  reset=$(cut -f1 < "$file" 2>/dev/null | head -n1)
  case "$reset" in (''|*[!0-9]*) return 0 ;; esac
  printf '%s' "$reset"
}

# Has THIS worker's conversation written yet? → 0 spoken | 1 unspoken | 2 no handle
#
# THE DESK-WIDE NUMBER CANNOT SAY. After a hop to a new branch the loop mints a
# fresh handle, and the new conversation has no transcript file until its first
# line. Until then the desk's newest file is the PREVIOUS slice's, and its
# silence is not this worker's. So the watcher asks the loop's own probe with
# the loop's own handle: one probe, two readers, one answer.
#
# THREE ANSWERS, AND THE THIRD IS NOT THE SECOND. `0` the handle's file exists,
# `1` it does not, `2` there is no handle to ask about. `plot_transcript_exists`
# reads *no handle* as *no file*, which suits `session_flag`; here it would
# make a hand-started watcher read every quiet worker as unspoken and disable
# `idle` silently (#1074). So the handle is checked here, before the probe.
plot_worker_conversation_spoken() { # $1=worktree → 0 spoken | 1 unspoken | 2 no handle
  command -v session_handle >/dev/null 2>&1 || return 2
  command -v plot_transcript_exists >/dev/null 2>&1 || return 2
  local handle
  handle=$(session_handle) || return 2
  [ -n "$handle" ] || return 2
  plot_transcript_exists "$1" "$handle" && return 0
  return 1
}

# Are there commits on this branch yet? → 0 yes | 1 no | 2 unanswerable
#
# THE THIRD CONDITION ON `idle`, and the one that separates a stall from an
# agent still thinking about a hard first slice.
#
# COUNTED AGAINST THE LOCAL `origin/<default>` REF — never a fetch, because
# this reading makes no network call. And when there is no such ref the
# question is UNANSWERABLE, so this returns 2 and `idle` does not fire:
# counting against nothing would count the whole history from the root commit
# and read every branch in a remote-less repo as having committed.
plot_worker_has_commits() { # $1=worktree → 0 yes | 1 no | 2 unanswerable
  [ -n "$1" ] && [ -d "$1" ] || return 2
  local wt="$1" base n
  base=$(git -C "$wt" symbolic-ref --quiet --short refs/remotes/origin/HEAD 2>/dev/null)
  [ -n "$base" ] || { git -C "$wt" rev-parse --verify --quiet origin/main >/dev/null 2>&1 && base='origin/main'; }
  [ -n "$base" ] || return 2
  # COUNT THE AGENT'S WORK, NOT THE BRANCH'S COMMITS. `plot-dispatch.sh` writes
  # `commit --allow-empty -m "plot: claim <branch>"` BEFORE the agent starts, so
  # `$base..HEAD` is never zero on a dispatched branch and this condition could
  # never refuse an `idle`. Measured 2026-08-30 (#538 red in CI): a worker
  # burning CPU in `yes > /dev/null` was reported idle, because the one
  # condition that could have saved it was satisfied by bookkeeping the agent
  # did not do.
  #
  # The `-- .` pathspec is what does it: `rev-list` with a pathspec keeps only
  # commits that TOUCHED A FILE, and the claim is empty by construction
  # (`--allow-empty`). That is a property rather than a message match — a claim
  # whose wording changes still reads as empty, and an agent committing an
  # empty marker of its own is correctly not counted as work either.
  n=$(git -C "$wt" rev-list --count "$base..HEAD" -- . 2>/dev/null) || return 2
  case "$n" in ''|*[!0-9]*) return 2 ;; esac
  [ "$n" -gt 0 ] && return 0
  return 1
}

json_escape() { # $1 = raw → prints a JSON-safe string body
  printf '%s' "$1" | python3 -c 'import json,sys; sys.stdout.write(json.dumps(sys.stdin.read())[1:-1])' 2>/dev/null \
    || printf '%s' "$1" | sed 's/\\/\\\\/g; s/"/\\"/g'
}

# Append one finding line to a desk's findings file, in the WorkerMonitor's own
# shape — the board's reader keys on this exact field set and this exact
# monitor name, and changing either would make an unbroken channel look broken.
#
# `since` AND `measuredAt` ARE DIFFERENT TIMES. `measuredAt` is when this
# reading was taken; `since` is when the finding first held. A finding that has
# held for twenty minutes and one taken twenty minutes ago are not the same
# fact, and an operator triaging a board needs the first.
plot_worker_publish_finding() { # $1=file $2=branch $3=worktree $4=finding $5=evidence $6=since
  local file="$1" branch="$2" worktree="$3" finding="$4" evidence="$5" since="$6" now line
  now=$(date -u +%Y-%m-%dT%H:%M:%SZ)
  line=$(printf '{"monitor":"%s","branch":"%s","worktree":"%s","finding":"%s","since":"%s","evidence":"%s","measuredAt":"%s"}' \
    'WorkerMonitor' \
    "$(json_escape "$branch")" \
    "$(json_escape "$worktree")" \
    "$(json_escape "$finding")" \
    "${since:-$now}" \
    "$(json_escape "$evidence")" \
    "$now")
  [ -n "$file" ] && printf '%s\n' "$line" >> "$file" 2>/dev/null
  printf 'plot-watch %s\n' "$line"
}

# ONE PASS OF THE LOOP'S OWN WATCHER: take the six readings, ask
# `plot_worker_idle_now`, publish only on a change.
#
# THE PID IS ALWAYS `alive`. The caller is the loop's watcher subshell, started
# with the loop's own pid (`$_watch_loop_pid`); that pid is alive by
# construction for as long as the watcher runs, so there is no `monitor_pid_alive`
# reading here the way the old monitor needed one for a SEPARATE process it was
# watching.
#
# `$5` IS THE RACE THE PLAN DID NOT ANTICIPATE. A prompt started into a
# conversation whose transcript is already older than the window could read
# `idle` on its FIRST pass and be ended before the model ever answers — the
# clamp mirrors the usage-limit clamp's own shape: `silenceSeconds` is capped at
# the seconds the prompt has actually been running, so a desk cannot be judged
# quiet for longer than this prompt has existed.
#
# THE CHILD IS SAMPLED ON THE PID GIVEN, NEVER ON `$_watch_loop_pid` ITSELF.
# `plot_worker_activity` sums the pid's whole descendant subtree; the loop's own
# pid is the root the agent CLI hangs off, so the caller passes it explicitly
# rather than this function assuming which pid names the subject.
#
# PUBLISH AND SIGNAL ARE SEPARATE. This function only ever publishes; it is the
# caller's job to decide whether the PUBLISHED finding may end the worker — the
# flag gates that decision, not this one.
plot_worker_idle_watch_pass() { # $1=worktree $2=branch $3=findings-file $4=window $5=prompt_started_at $6=pid → exit 0 idle | 1 silent (also publishes)
  local wt="$1" branch="$2" file="$3" window="$4" started_at="$5" pid="$6"
  local silence spoken_rc spoken tree commits_rc commits activity finding evidence verdict

  silence=$(plot_transcript_quiet_seconds "$wt" 2>/dev/null)
  case "$silence" in
    ''|unavailable|*[!0-9]*) silence='' ;;
  esac

  # THE USAGE-LIMIT CLAMP, AHEAD OF THE WINDOW CHECK. Silence is measured from
  # the later of the newest transcript line and the reset this desk waits for;
  # while the reset is ahead of now the difference is negative, which clamps to
  # 0 and reads as busy — the agent is doing exactly what it should.
  local limited_until
  limited_until=$(plot_worker_limited_reset "$wt")
  if [ -n "$limited_until" ] && [ -n "$silence" ]; then
    local since_reset
    since_reset=$(( $(date +%s) - limited_until ))
    [ "$since_reset" -lt 0 ] && since_reset=0
    [ "$since_reset" -lt "$silence" ] && silence=$since_reset
  fi

  # THE RACE CLAMP. A prompt's transcript may be older than the window on the
  # very first pass, because it is the PREVIOUS slice's silence, not this
  # prompt's. Silence can never exceed how long this prompt has actually run.
  case "$started_at" in
    ''|*[!0-9]*) ;;
    *)
      local ran
      ran=$(( $(date +%s) - started_at ))
      [ "$ran" -lt 0 ] && ran=0
      if [ -n "$silence" ] && [ "$ran" -lt "$silence" ]; then silence=$ran; fi
      ;;
  esac

  plot_worker_conversation_spoken "$wt"; spoken_rc=$?
  case "$spoken_rc" in
    0) spoken=1 ;;
    *) spoken=0 ;;
  esac

  activity=$(plot_worker_activity "$pid" 2>/dev/null)

  tree=$(plot_worker_tree_quiet_seconds "$wt" 2>/dev/null)

  plot_worker_has_commits "$wt"; commits_rc=$?
  case "$commits_rc" in
    0) commits='yes' ;;
    1) commits='no' ;;
    *) commits='unanswerable' ;;
  esac

  verdict=$(plot_worker_idle_now 'alive' "$spoken" "${silence:-unavailable}" "$activity" "$tree" "$commits" "$window")

  finding=''
  evidence=''
  if [ "$verdict" = 'idle' ]; then
    finding='idle'
    evidence="the agent's transcript has been silent for over ${window}s with no child process burning CPU behind it, nothing in its tree has moved for ${tree}s, and the branch already carries commits"
  fi

  # PUBLISH ONLY ON A CHANGE, held in a variable of the CALLER's subshell —
  # named `PLOT_WATCH_PUBLISHED`/`PLOT_WATCH_SINCE` rather than local, because
  # this function is called repeatedly from the watcher's own `while` loop and
  # the state must survive between calls the way `monitor_pass`'s did.
  if [ "$finding" != "${PLOT_WATCH_PUBLISHED:-}" ]; then
    local now_iso
    now_iso=$(date -u +%Y-%m-%dT%H:%M:%SZ)
    if [ -n "$finding" ]; then
      PLOT_WATCH_SINCE="$now_iso"
      plot_worker_publish_finding "$file" "$branch" "$wt" "$finding" "$evidence" "$PLOT_WATCH_SINCE"
    elif [ -n "${PLOT_WATCH_PUBLISHED:-}" ]; then
      PLOT_WATCH_SINCE="$now_iso"
      plot_worker_publish_finding "$file" "$branch" "$wt" 'clear' \
        "the ${PLOT_WATCH_PUBLISHED} finding no longer holds; the worker is measuring healthy again" "$PLOT_WATCH_SINCE"
    fi
    PLOT_WATCH_PUBLISHED="$finding"
  fi

  # THE VERDICT IS THE EXIT CODE, NOT STDOUT. Stdout is reserved for the
  # publish line alone (`plot_worker_publish_finding`'s own `plot-watch …`
  # line), the same convention the old monitor's process stdout carried into
  # `.plot-worker.log` beside the agent's own output. A caller that needs the
  # word reads the exit code: 0 for `idle`, 1 for anything else.
  [ "$finding" = 'idle' ]
}

# The total CPU time, in centiseconds, of a pid and every process descended from
# it. Prints the number; prints `0` and returns non-zero when the pid names no
# live process at all.
#
# THE CHILD IS WHERE THE WORK IS, NOT THE SHELL. The pid this fleet records is
# the loop shell — `plot-worker-loop.sh` — and a shell that `wait`s on its child
# burns almost no CPU of its own. Measured across the fleet 2026-08-25: 9 of 11
# loop shells sat at 0.01s CPU over hours while their `claude` child held 1.5+
# minutes. So the shell's own CPU distinguishes nothing; the DESCENDANT tree is
# the only place a working worker differs from a dead one. This sums the whole
# subtree — the loop may fork `claude`, which forks its own tools — so a worker
# building in a grandchild reads as busy, not idle.
#
# ONE `ps` SNAPSHOT, WALKED IN awk. `ps -o pid=,ppid=,time= -ax` is the one
# portable call that carries the parent link and the CPU clock together (macOS
# and Linux both). We read it ONCE and walk the ppid graph in memory rather than
# recursing with a `ps` per node: the alternative forks a process per descendant
# on a scan the board polls every 5s.
#
# `time=` IS `[[HH:]MM:]SS.ss`. Parsed field by field from the right so a worker
# past an hour of CPU still totals correctly — an absolute-seconds assumption
# would wrap at 60 and read a busy worker as newly idle.
plot_worker_cpu_centis() { # $1=pid → total CPU centiseconds of pid+descendants
  local root="$1"
  [ -n "$root" ] || { printf '0'; return 1; }
  case "$root" in *[!0-9]*) printf '0'; return 1 ;; esac

  # Snapshot the whole process table once. Each line: "<pid> <ppid> <time>".
  # `time` may itself contain a space in no format we read, so pid and ppid are
  # fields 1 and 2 and everything after is the clock.
  ps -o pid=,ppid=,time= -ax 2>/dev/null | awk -v root="$root" '
    # Convert a "[[HH:]MM:]SS.ss" clock to integer centiseconds.
    function to_centis(t,   n, parts, i, mult, total, sec, frac) {
      n = split(t, parts, ":")
      # The last field is SS.ss; earlier fields are whole minutes/hours.
      total = 0; mult = 1
      for (i = n; i >= 1; i--) {
        if (i == n) {
          # seconds, possibly fractional
          if (split(parts[i], sf, ".") == 2) { sec = sf[1]; frac = sf[2] }
          else { sec = parts[i]; frac = 0 }
          # Normalise fraction to hundredths (ps prints two digits).
          frac = (frac "00"); frac = substr(frac, 1, 2)
          total += (sec * 100) + (frac + 0)
        } else {
          total += parts[i] * 60 * 100 * mult
        }
        if (i < n) mult *= 60
      }
      return total
    }
    { pid[$1] = $1; ppid[$1] = $2; clk[$1] = $3 }
    END {
      if (!(root in pid)) { print 0; exit 1 }
      # Collect the subtree rooted at `root` by repeated relaxation over the
      # ppid map — a table this size settles in a couple of passes, and there is
      # no deep recursion in a worker tree to make that costly.
      inset[root] = 1
      changed = 1
      while (changed) {
        changed = 0
        for (p in ppid) {
          if (!(p in inset) && (ppid[p] in inset)) { inset[p] = 1; changed = 1 }
        }
      }
      total = 0; any = 0
      for (p in inset) { if (p in clk) { total += to_centis(clk[p]); any = 1 } }
      print total
      exit (any ? 0 : 1)
    }'
}

# The name a live agent's process carries, as a substring of its command.
#
# CONFIGURABLE BECAUSE THE AGENT IS THE PROJECT'S, NOT PLOT'S. Principle 5 —
# Plot hardcodes no tooling — and the `Worker command` key already says every
# project names its own. This is the default because it is what this estate
# runs; a project whose agent is a different binary sets `PLOT_AGENT_PROCESS`
# and nothing else changes.
: "${PLOT_AGENT_PROCESS:=claude}"

# Whether an AGENT — not merely the wrapper — is alive under this pid.
#
# THE DEFECT THIS ANSWERS. The pid this fleet records is the loop shell, and
# `kill -0` on it succeeds for the whole `Worker bound` (28800 s) whether or not
# an agent still runs inside it. Measured 2026-09-11, in one session: FOUR
# agents ended mid-slice, none failed a build, none wrote a marker, and every
# one reported `running` with a plausible quiet time. Three left 8 commits and 9
# uncommitted files on their desks — one step from done, and all three would
# have been reaped as abandoned.
#
# EXISTENCE, NOT MOTION, AND THAT IS THE WHOLE DISTINCTION FROM THE CUE BELOW.
# `plot_worker_activity` samples CPU twice and asks whether the subtree is
# MOVING; an agent blocked on a network read is `idle` and perfectly alive. This
# asks whether there is an agent in the subtree AT ALL, which is a set
# membership test over one snapshot rather than a delta over two. The cue may
# never decide liveness, and this may never be read as a cue.
#
# ACCUMULATED CPU CANNOT DECIDE IT EITHER. Measured 2026-09-12 on this machine,
# a dead agent's tree held three `bash` children at 0:41.50, 0:41.22 and
# 0:40.31 — forty seconds of CPU each, burnt before the agent died. Only the
# PRESENCE of the agent process separates that tree from a live one.
#
# THE SAME ONE-SNAPSHOT WALK `plot_worker_cpu_centis` USES, and for its reason:
# a `pgrep -P` recursion forks a process per descendant on a scan the board
# polls every 5 s. It is also the only shape that reaches the real depth —
# measured on a healthy agent the same day, `claude` sat THREE levels below the
# recorded pid (`sh` → `bash` → `bash` → `claude`), so a depth-limited probe
# reports every live agent absent.
#
# ABSENT IS NOT FALSE, the rule this file keeps re-learning. A pid naming no
# process at all returns 2 — *could not look* — rather than 1, because a failure
# to observe is not evidence of something to see. The caller has already
# established the pid answers `kill -0` before it asks this.
# How long a wrapper must have been alive before its empty subtree means
# anything.
#
# THE STARTUP WINDOW IS REAL AND IT IS THIS READING'S OWN. `kill -0` succeeds
# the instant the wrapper exists, and the agent is forked some time after that —
# measured 2026-09-12, 37 to 237 ms for a `sh` forking a trivial child, and a
# real agent boots in seconds. A reading taken inside that window sees a worker
# that is STARTING and would call it stopped.
#
# The file already documents the same hazard one level down: *"There is a
# sub-millisecond window after the wrapper starts and before `.plot-worker.pid`
# is written, and a scan landing in it reads `none` — honest."* That window is
# tolerable because `none` tells a reader to look again; this one is not, because
# the whole point of the reading is to let something ACT on a stopped agent, and
# acting on a starting one hands its desk away as it boots.
#
# THIRTY SECONDS, AND IT IS A GUESS SAID OUT LOUD. Nothing has measured how long
# an agent takes to appear under its wrapper on a loaded machine; this is an
# order of magnitude above the worst observed fork and an order below the
# shortest slice. It is overridable so the tests need not wait, and a project on
# slower hardware can raise it.
: "${PLOT_AGENT_GRACE_SECONDS:=30}"

# The whole seconds a pid has been alive, or empty when it cannot be read.
#
# `etime` RATHER THAN `lstart`, because this needs a DURATION and `lstart` is a
# date a caller would have to parse and subtract. `[[DD-]HH:]MM:SS` is parsed
# from the right, the way `plot_worker_cpu_centis` parses its clock and for the
# same reason: an absolute-seconds assumption wraps at 60.
plot_pid_elapsed_seconds() { # $1=pid → whole seconds, or empty
  local pid="$1" raw
  [ -n "$pid" ] || return 1
  raw=$(ps -o etime= -p "$pid" 2>/dev/null | tr -d ' ') || return 1
  [ -n "$raw" ] || return 1
  printf '%s' "$raw" | awk '
    {
      n = split($0, dh, "-")
      days = (n == 2) ? dh[1] : 0
      t = (n == 2) ? dh[2] : dh[1]
      m = split(t, p, ":")
      total = 0; mult = 1
      for (i = m; i >= 1; i--) { total += p[i] * mult; mult *= 60 }
      print total + (days * 86400)
    }'
}

plot_worker_agent_alive() { # $1=pid → 0 agent present, 1 absent, 2 unaskable
  local root="$1" age
  [ -n "$root" ] || return 2
  case "$root" in *[!0-9]*) return 2 ;; esac

  # A WRAPPER YOUNGER THAN THE GRACE IS UNASKABLE, NEVER ABSENT. It may be
  # starting its agent right now, and `2` is the answer that says *could not
  # look* — which the callers already resolve to today's behaviour. Absent is
  # not false, and a failure to observe is not evidence of something to see.
  age=$(plot_pid_elapsed_seconds "$root") || age=""
  if [ -n "$age" ] && [ "$age" -lt "$PLOT_AGENT_GRACE_SECONDS" ] 2>/dev/null; then
    return 2
  fi

  # `comm=` IS THE EXECUTABLE, `command=` IS THE WHOLE INVOCATION, and this
  # needs the second. A wrapper whose argv merely NAMES the agent would match on
  # `command=`, so the match is anchored to the executable's own basename —
  # taken from `comm=`, which macOS truncates but never rewrites.
  ps -o pid=,ppid=,comm= -ax 2>/dev/null | awk -v root="$root" -v want="$PLOT_AGENT_PROCESS" '
    { pid[$1] = $1; ppid[$1] = $2
      # Everything after pid and ppid is the command; keep its basename.
      c = $0; sub(/^[ \t]*[0-9]+[ \t]+[0-9]+[ \t]+/, "", c)
      sub(/.*\//, "", c)
      comm[$1] = c }
    END {
      if (!(root in pid)) { exit 2 }
      # The same relaxation the CPU walker uses: sweep the ppid map until the
      # subtree stops growing. Depth is unbounded, which is the point.
      inset[root] = 1
      changed = 1
      while (changed) {
        changed = 0
        for (p in ppid) {
          if (!(p in inset) && (ppid[p] in inset)) { inset[p] = 1; changed = 1 }
        }
      }
      # THE ROOT ITSELF IS EXCLUDED. The recorded pid is the loop shell by
      # construction, and a shell that matched would make every desk read alive.
      for (p in inset) {
        if (p == root) continue
        if (index(comm[p], want) > 0) { exit 0 }
      }
      exit 1
    }'
}

# Whether a RUNNING worker's child is doing work — `working`, `idle`, or "".
#
# A CUE, NOT A STATE. The row already reads `running`; this is the secondary
# word beside it that says WHICH kind of running. `running` is honest and
# coarse — measured across the fleet 2026-08-25 it covered a worker mid-thought,
# a worker between waves, and a worker whose child had crashed hours earlier,
# and 11 of 13 workers were in the worst of those. This tells the first from the
# last WITHOUT adding a sixth state: `AgentStateSchema` stays five, and an idle
# worker with a live child still IS running.
#
# THE SIGNAL IS CPU GROWTH OVER AN INTERVAL, never an absolute. A worker deep in
# a long build and a worker whose child died both show a large accumulated CPU
# number; only the DELTA separates them — the live one's clock keeps advancing,
# the dead one's is frozen. So this samples the subtree's total CPU twice across
# a short sleep and compares.
#
# "" WHEN THERE IS NOTHING TO MEASURE. A pid with no descendants that hold a CPU
# clock (a bare shell, or a worker whose whole tree has already gone) yields no
# cue rather than a false `idle`: the absence of a child is not the presence of
# an idle one, and this cue is only ever read beside a `running` verdict, where
# a live pid is already established. Item 7 of the plan: a worker with no live
# child is `stalled`/`unknown` by the existing rules, untouched here.
#
# THE SAMPLE INTERVAL is short by default so the scan is not held up, and
# overridable via `PLOT_ACTIVITY_INTERVAL` so a test can prove both arms without
# waiting. A child doing real work moves its CPU clock within a fraction of a
# second; the default is generous enough to clear scheduler jitter.
: "${PLOT_ACTIVITY_INTERVAL:=0.4}"
plot_worker_activity() { # $1=pid → working | idle | "" (empty = nothing to measure)
  local pid="$1" first second
  [ -n "$pid" ] || return 0
  case "$pid" in *[!0-9]*) return 0 ;; esac

  # First sample of the whole subtree. If the pid names no process with a CPU
  # clock, there is nothing to say — emit "".
  first=$(plot_worker_cpu_centis "$pid") || return 0
  sleep "$PLOT_ACTIVITY_INTERVAL"
  second=$(plot_worker_cpu_centis "$pid") || return 0

  # A subtree that burned any CPU across the interval is working; one whose clock
  # did not move is idle. `>` on integer centiseconds — equal means frozen.
  if [ "$second" -gt "$first" ] 2>/dev/null; then
    printf 'working'
  else
    printf 'idle'
  fi
}

# Refine a clean exit into finished / waiting / stalled.
#
# THE DECISION IS NOT MADE HERE. `taskState` lives in `@plot-pm/domain` and this
# function asks it. The four readings and the order they are decided in — a PR
# outranking everything, `waiting` outranking `stalled`, an unanswerable
# `unpushed` refusing to become `stalled` — are one implementation now, testable
# over all 24 combinations of the four readings instead of over the worktrees an
# estate happens to produce. That is what this script carried in duplicate until
# 2026-08-18, five of six states in two places, and the copies had drifted.
#
# WHAT STAYS HERE IS THE READING. The four world questions below are shell's,
# and each is asked exactly as it was: the marker is a FILE `plot_worker_blocked`
# globs for, dirtiness is `plot_worker_dirty`'s filtered answer, and `unpushed`
# is `@{upstream}` and nothing else.
#
# ONLY `@{upstream}` ANSWERS "PUSHED?", and when there is no upstream the
# question is UNANSWERABLE rather than answered zero — or answered anything
# else. This went in the wrong direction first and was measured doing it: a
# fallback that counted against `origin/main` reported EVERY clean branch
# `stalled` in a repo with no remote, because `rev-list --count "..HEAD"` with
# an empty left side counts the whole history from the root commit. Nine commits
# of ordinary history read as nine commits of unpushed work.
#
# The fallback was also wrong where it worked. A branch legitimately ahead of
# `origin/main` is the NORMAL state of every branch under review — it is what
# having commits means — so counting against the trunk marks finished work
# `stalled` for as long as it exists. Only the branch's OWN upstream separates
# "pushed" from "not pushed"; the trunk answers a different question entirely.
#
# So an absent upstream travels to the rule as an EMPTY field, which the rule
# reads as unanswerable and does not turn into `stalled`. A failure to observe
# is not evidence of something to see — the same principle `local_ahead_of`
# states in plot-fleet-scan.sh, reached the hard way.
#
# A RULE THAT CANNOT BE ASKED REFUSES, and it says so with the rebuild in the
# message — the shape `plot-fleet-scan.sh` uses at its own bundle call. There is
# no shell fallback: a second implementation kept "just in case" is the
# duplication this move removes, and it would be the copy nobody tests. An
# EMPTY answer is checked separately from a non-zero exit, because a bundle that
# writes nothing exits 0 and `||` alone cannot see it.
plot_worker_task_state() { # $1=worktree $2=pr-fact → finished|waiting|stalled
  local wt="$1" has_pr="$2" here ahead has_pr_flag blocked_flag dirty_flag answer
  here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

  [ "$has_pr" = "pr" ] && has_pr_flag=1 || has_pr_flag=0
  plot_worker_blocked "$wt" && blocked_flag=1 || blocked_flag=0
  [ -n "$(plot_worker_dirty "$wt")" ] && dirty_flag=1 || dirty_flag=0

  # UNPUSHED IS A REF QUESTION, asked THROUGH the worktree because that is the
  # checkout whose HEAD is the branch. An unreadable count stays EMPTY.
  ahead=$(git -C "$wt" rev-list --count '@{upstream}..HEAD' 2>/dev/null) || ahead=""

  answer=$(printf '%s\t%s\t%s\t%s' \
    "$has_pr_flag" "$blocked_flag" "$dirty_flag" "$ahead" \
    | node "$here/board/plot-task.mjs" 2>/dev/null) \
    || { echo "error: cannot read the task state — run 'pnpm build:board'." >&2; exit 2; }
  [ -n "$answer" ] \
    || { echo "error: the task state rule answered nothing — run 'pnpm build:board'." >&2; exit 2; }
  printf '%s' "$answer"
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
    # THE WRAPPER LIVES. DOES AN AGENT? `kill -0` answered about the loop shell,
    # and that shell outlives its agent for the whole `Worker bound` — measured
    # 2026-09-11, four agents ended mid-slice and every one reported `running`.
    # So the pid answering is a precondition for this question, never the answer
    # to it.
    #
    # ONLY A DEFINITE ABSENCE MOVES THE READING. Return 2 is *could not look* —
    # a pid that vanished between `kill -0` and here — and it falls through to
    # `running`, which is what this reported before the reading existed. Absent
    # is not false.
    #
    # AND THE QUESTION IS ONLY ASKED OF A DESK PLOT LAUNCHED A WORKER INTO,
    # which `.plot-worker.wrapper.pid` is the proof of. A recorded pid with no
    # wrapper file beside it was never started by `start_worker` — a hand-made
    # desk, or a fixture writing a pid by hand — so Plot has no grounds to
    # expect an agent beneath it, and asking would reinterpret every such pid as
    # an orphan.
    #
    # Measured 2026-09-12 in CI: `--status` reported `finished` for a desk whose
    # recorded pid was the TEST RUNNER — alive 1436 s, with no agent beneath it.
    # The grace window cannot catch that, because the process is old.
    #
    # THE WRAPPER FILE RATHER THAN THE MANIFEST, and that is a measurement too:
    # the one genuinely orphaned desk on this machine carries NO manifest — the
    # registry it was written to has moved — and gating on one defeated the
    # detection for exactly the population this exists to serve. The wrapper
    # file is also the better evidence: the manifest is written by the
    # dispatcher BEFORE the launch, while this file is written by the wrapper
    # process itself, so its presence proves a worker really ran here. It is the
    # file's own rule one line over — *"the process that knows a pid is the one
    # that writes it"*.
    if [ ! -f "$wt/.plot-worker.wrapper.pid" ]; then
      printf 'running\t%s\t' "$pid"
      return
    fi
    if plot_worker_agent_alive "$pid"; then
      printf 'running\t%s\t' "$pid"
      return
    elif [ "$?" -eq 1 ]; then
      # The wrapper is alive and the agent is gone. The DESK decides what that
      # means — `stalled` for work only this machine holds, `waiting` for a
      # marker, `finished` for a desk that is clear — because the process has
      # nothing left to say. No exit file exists: the wrapper has not exited.
      printf '%s\t%s\t' "$(plot_worker_task_state "$wt" "$has_pr")" "$pid"
      return
    fi
    # Unaskable: the process table could not be read for this pid. Report what
    # `kill -0` established and nothing more.
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

# ---------------------------------------------------------------------------
# THE SAME READINGS, HANDED OUT RATHER THAN DECIDED
# ---------------------------------------------------------------------------
#
# `plot_worker_state` above gathers six facts and turns them into a word. So
# does `rules/agent-state.ts`, and `docs/shell-and-domain.md` says why both
# exist: this function is sourced inside per-branch loops and by the agent's own
# loop, where a `node` hop is 39 ms every caller pays on every pass, while the
# board and the supervisor are already in node and pay nothing.
#
# WHAT THE PAIR NEEDS IS THE READINGS, NOT THE WORD. A caller handed `finished`
# can only compare two strings; a caller handed the six facts can ask the domain
# rule and compare its answer to this file's. That is what the corpus test does,
# and it is why this function exists at all.
#
# ONE GATHERING, TWO CONSUMERS. Every fact below is read the way
# `plot_worker_state` reads it — the manifest first and the worktree file as the
# fallback, `plot_pid_is_current` for staleness, the same `PLOT-BLOCKED*` glob
# and the same dirty filter. A second gathering that drifted would make the
# corpus test compare this file against itself and pass while production broke.
#
# Prints one TAB-separated line, six fields:
#
#   worktree_here  pid_recorded  liveness  exit  blocked  dirty  unpushed
#
# `liveness` is `live`, `stale`, `orphaned` or `dead` — `orphaned` being a pid
# that answers with no agent process under it, which is a live wrapper whose
# agent has gone; `exit` is the code as read, empty for
# an unreadable record and the literal `-` for an absent one, because an empty
# field cannot say which of the two it is and the rule answers them alike only
# because it was told they differ. The PR fact is NOT here: it comes from the
# caller, exactly as it does for `plot_worker_state`.
plot_worker_readings() { # $1=worktree → "here\tpid\tliveness\texit\tblocked\tdirty\tunpushed"
  local wt="$1" pid="" started_at="" manifest_data="" manifest=""
  local here=1 pid_recorded=0 liveness=dead exit_field='-' blocked=0 dirty=0 ahead=""

  # NO WORKTREE IS ANSWERED FIRST, and it is a question about the worktree LIST
  # rather than about anything inside one — the same split `worker_of` makes in
  # `plot-fleet-scan.sh`, where `elsewhere` is decided before this file is
  # reached. A caller iterating worktrees it found never sees this arm.
  if [ -z "$wt" ] || [ ! -d "$wt" ]; then
    printf '0\t0\tdead\t-\t0\t0\t'
    return
  fi

  # THE MANIFEST IS PRIMARY, as above: it carries `pid` and `startedAt`
  # together, and `startedAt` is what tells a reused pid from the real worker.
  if manifest=$(plot_manifest_for_worktree "$wt" 2>/dev/null) && [ -n "$manifest" ]; then
    if manifest_data=$(plot_read_manifest_pid "$manifest") && [ -n "$manifest_data" ]; then
      pid=$(printf '%s' "$manifest_data" | cut -f1)
      started_at=$(printf '%s' "$manifest_data" | cut -f2)
    fi
  fi
  if [ -z "$pid" ] && [ -f "$wt/.plot-worker.pid" ]; then
    pid=$(cat "$wt/.plot-worker.pid" 2>/dev/null | tr -d ' \n')
  fi

  # A pid of 0 and any non-numeric junk are NOT pids. `kill -0 0` signals the
  # whole process group and succeeds, so a zero read as live reports `running`
  # forever — rejected here exactly as `plot_worker_state` rejects it.
  case "$pid" in
    ''|0|*[!0-9]*) pid_recorded=0 ;;
    *)             pid_recorded=1 ;;
  esac

  if [ "$pid_recorded" = 1 ]; then
    if kill -0 "$pid" 2>/dev/null; then
      # A recorded start time closes the pid-reuse window. Without one the old
      # behaviour applies and `kill -0` alone decides, which keeps an
      # uncheckable pid honest rather than pessimistic.
      if [ -n "$started_at" ] && ! plot_pid_is_current "$pid" "$started_at"; then
        liveness=stale
      elif [ ! -f "$wt/.plot-worker.wrapper.pid" ]; then
        # NO WRAPPER FILE, NO AGENT QUESTION — the gate `plot_worker_state`
        # applies, repeated here because these two must not drift: a desk Plot
        # never launched a worker into has no agent Plot can expect.
        liveness=live
      elif plot_worker_agent_alive "$pid"; then
        liveness=live
      elif [ "$?" -eq 1 ]; then
        # THE FOURTH WORD, and it belongs in this field rather than in a private
        # branch inside `plot_worker_state`. `stale` set the precedent: it means
        # *the pid exists and is not our worker*, and this means *the pid exists
        # and our worker is no longer inside it*. Both are facts about what the
        # recorded pid names, which is what this field is.
        liveness=orphaned
      else
        # Unaskable — `kill -0` answered, the process table did not. Report what
        # was established.
        liveness=live
      fi
    fi
  fi

  # THE EXIT RECORD, distinguishing absent from unreadable. `plot_worker_state`
  # reaches `ended` for both, but by different routes, and a reading that
  # collapsed them would hide which one a desk is in from anybody comparing.
  if [ -f "$wt/.plot-worker.exit" ]; then
    exit_field=$(cat "$wt/.plot-worker.exit" 2>/dev/null | tr -d ' \n')
  fi

  plot_worker_blocked "$wt" && blocked=1 || blocked=0
  [ -n "$(plot_worker_dirty "$wt")" ] && dirty=1 || dirty=0
  # UNPUSHED IS A REF QUESTION asked THROUGH the worktree, and an unreadable
  # count stays EMPTY — `null` is not `false`, and a branch with no upstream
  # cannot be asked at all.
  ahead=$(git -C "$wt" rev-list --count '@{upstream}..HEAD' 2>/dev/null) || ahead=""

  printf '%s\t%s\t%s\t%s\t%s\t%s\t%s' \
    "$here" "$pid_recorded" "$liveness" "$exit_field" "$blocked" "$dirty" "$ahead"
}
