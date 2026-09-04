#!/usr/bin/env bash
# The ONE answer to "how long has this worktree's agent been quiet?" — sourced,
# not run, by `plot-worker-monitor.sh`.
#
# It reads the AGENT rather than the machine. A `claude -p` session appends a
# timestamped line to its transcript for every model turn, tool call and tool
# result; the seconds since the newest of those lines is how long the agent has
# produced nothing. A CPU sample answers *is this process on a core right now?*,
# which is a different question and is zero for most of a working agent's life.
#
# ═══════════════════════════════════════════════════════════════════════════
# THREE ANSWERS, AND THE THIRD IS NOT A FAILURE
# ═══════════════════════════════════════════════════════════════════════════
#
#   <seconds>     the newest transcript line is that many seconds old
#   unavailable   no transcript can be read for this worktree, INCLUDING the
#                 case where the arguments name no worktree at all
#
# `unavailable` is a first-class answer, settled by
# `the-registry-supervises-its-agents`: a capability the adopting project does
# not provide is UNAVAILABLE, never failed and never zero. A caller that read
# it as "quiet for 0 seconds" would report every unreadable agent healthy; one
# that read it as an error would refuse to run where Plot's own contract says
# it should degrade. So it is a word, and callers match on it.
#
# ═══════════════════════════════════════════════════════════════════════════
# THE TRANSCRIPT IS FOUND BY PATH, NOT BY SESSION ID — AND THAT IS A CHOICE
# ═══════════════════════════════════════════════════════════════════════════
#
# `.plot/worker-prompt.sh:29` DOES pass `--session-id` now (2026-09-04), so an
# exact join is available here and this deliberately does not take it. The
# reason is the question, not the capability: this asks *is anything happening
# at this desk*, and an operator's own session at the same worktree is a true
# answer to it. Joining on the worker's id alone would report a desk quiet
# while somebody is visibly working at it.
#
# THE OPPOSITE JOIN IS RIGHT FOR THE OPPOSITE QUESTION. *What has THIS agent
# spent* is per session and never per worktree — one project directory measured
# 2026-09-03 held 45 session files, 30 of them subagents, and a sum across them
# belongs to no one. `rules/spend.ts` states that side; the two read the same
# files and must not be made to share a join.
#
# So the join here is the one `plot-quiet-stretch.mjs` already made and proved
# on 23 real sessions: the runtime stores a session under
# `$HOME/.claude/projects/<slug>` where the slug is the WORKTREE PATH with `/`
# and `.` replaced by `-`. A dispatched worker has its own worktree, so the
# path identifies the DESK without any id being passed anywhere.
#
# `agent-` PREFIXED FILES ARE SKIPPED, for wave 1's reason: a subagent's
# transcript is a true statement about the wrong process. A worker whose
# subagent is chatting while the worker itself has stopped must read as quiet.
#
# ═══════════════════════════════════════════════════════════════════════════
# THE NEWEST LINE ACROSS ALL OF A WORKTREE'S SESSIONS
# ═══════════════════════════════════════════════════════════════════════════
#
# A worktree can hold several sessions: a worker that hopped waves, or an
# operator who opened a session at the same desk. Any of them producing output
# means SOMEBODY is working there, and the monitor's question is about the desk.
# Taking the maximum timestamp is the answer that never ends a live session
# because a stale sibling exists beside it.

# The runtime's project-slug derivation. Duplicated from `plot-quiet-stretch.mjs`
# — which duplicates it from the board's `projectSlug` — because a monitor on a
# 30s loop must not depend on a build step. One line, pinned by a test on each
# side.
plot_transcript_slug() { # $1=worktree path → slug
  printf '%s' "$1" | tr '/.' '--'
}

# Where the runtime keeps this worktree's transcripts, or "" if nowhere.
plot_transcript_dir() { # $1=worktree → directory path (may not exist)
  local wt="$1" home="${PLOT_TRANSCRIPT_HOME:-${HOME:-}}"
  [ -n "$wt" ] && [ -n "$home" ] || return 0
  printf '%s/.claude/projects/%s' "$home" "$(plot_transcript_slug "$wt")"
}

# Seconds since this worktree's agent last wrote anything.
#
# THE MTIME IS THE READING, not the file's contents. The runtime appends as it
# works, so the file's modification time IS the timestamp of its newest line —
# and reading it costs one `stat` rather than parsing a transcript that reaches
# tens of megabytes on a long session. Wave 1 parsed timestamps because it was
# measuring a DISTRIBUTION of past gaps; this needs only the newest, on a 30s
# loop, for as many workers as the machine holds.
#
# A CLOCK IS THE RIGHT INSTRUMENT HERE, and that is worth stating because Plot
# usually refuses one. `plot-estate-changed.sh` hashes content rather than
# reading mtime, because its question is *did this change?* and a checkout moves
# mtime without changing anything. This question is *how long since output?* —
# which is a question about elapsed time, and mtime is the measurement of it.
plot_transcript_quiet_seconds() { # $1=worktree → seconds | unavailable
  local wt="$1" dir newest now mtime
  dir=$(plot_transcript_dir "$wt")
  [ -n "$dir" ] && [ -d "$dir" ] || { printf 'unavailable'; return 0; }

  # The newest mtime across every non-`agent-` session file in the directory.
  # `find -print0` and a while-read keep paths with spaces intact; `stat` is
  # asked once per file, and a worktree holds one to eight.
  newest=''
  while IFS= read -r -d '' f; do
    case "$(basename "$f")" in agent-*) continue ;; esac
    mtime=$(plot_transcript_mtime "$f") || continue
    [ -n "$mtime" ] || continue
    if [ -z "$newest" ] || [ "$mtime" -gt "$newest" ] 2>/dev/null; then newest="$mtime"; fi
  done < <(find "$dir" -maxdepth 1 -type f -name '*.jsonl' -print0 2>/dev/null)

  # A directory that exists but holds no session file is still UNAVAILABLE. The
  # runtime creates the directory when the project is first opened, so an empty
  # one means no session has written here — which is exactly "no transcript can
  # be read", not "quiet for a very long time".
  [ -n "$newest" ] || { printf 'unavailable'; return 0; }

  now=$(date +%s)
  local quiet=$(( now - newest ))
  # A transcript written in the future — a clock skew across a mounted volume —
  # reads as zero rather than negative. An end condition comparing a negative
  # against a threshold would behave correctly by accident here and not
  # elsewhere; clamping says what is meant.
  [ "$quiet" -lt 0 ] && quiet=0
  printf '%s' "$quiet"
}

# A file's modification time as a unix epoch. BSD and GNU `stat` disagree on the
# flag, and a monitor that works on the author's laptop and not in CI is a
# monitor nobody trusts.
#
# THE `||` IS NOT ENOUGH, AND CI MEASURED WHY. On Linux `stat -f` is not an
# unknown flag — it means FILESYSTEM info, and it SUCCEEDS. So the BSD form
# never falls through: it printed `Namelen: 255  Type: ext2/ext3` and the
# caller subtracted that from a clock. Two of this branch's own tests failed on
# it, 2026-09-02, having passed on macOS.
#
# So the answer is validated rather than trusted. Each form must yield digits;
# anything else is treated as that form not being available here.
plot_transcript_mtime() { # $1=file → epoch seconds
  local m
  m=$(stat -c '%Y' "$1" 2>/dev/null)
  case "$m" in ''|*[!0-9]*) m=$(stat -f '%m' "$1" 2>/dev/null) ;; esac
  case "$m" in ''|*[!0-9]*) return 1 ;; esac
  printf '%s' "$m"
}
