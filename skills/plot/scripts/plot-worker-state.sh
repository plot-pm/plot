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

# THE BLOCKED MARKER, and why Plot names one rather than only borrowing.
#
# `TODO(you)` is what workers actually wrote this session. It was never
# documented anywhere, so it is a convention that EMERGED — and an emergent
# convention drifts: the same session already produced `TODO(human)`, and
# nothing stops the next one producing `ASK:` or a paragraph of prose. A marker
# the classifier cannot find is a `waiting` reported as `stalled`, which is the
# restart-into-the-same-wait this state exists to prevent.
#
# So Plot DEFINES `PLOT-BLOCKED:` — a token no other tool emits, greppable
# without false positives, and documented in the skills that tell workers to
# write it. The two observed spellings stay recognised beside it, because they
# exist in trees right now and dropping them would silently regress every
# worker already running. Naming one and keeping the others is not indecision:
# the defined marker is what Plot ASKS for, the emergent ones are what Plot
# still ACCEPTS, and the set only ever grows by measurement.
PLOT_BLOCKED_MARKER='PLOT-BLOCKED:|TODO\((you|human)\)'

# Is a person being waited on inside this worktree?
#
# READ FROM THE TREE, NOT THE LOG. The log records that a question WAS asked;
# only the tree records that it is still UNANSWERED, and only the tree clears
# when someone writes the answer. Measured: a restarted worker found its own
# question already answered in the commit above it and carried on without
# asking again — the log still held the question, and always will.
#
# `git grep` over the TRACKED TREE PLUS UNTRACKED FILES, never `grep -r` over
# the directory. A worktree holds `node_modules`, build output, and
# `.plot-worker.log` itself — and the log is the one file GUARANTEED to contain
# the marker whenever the worker mentioned writing one, so a recursive grep
# would answer `waiting` from exactly the source the paragraph above rules out.
# `--untracked` is included because a marker a worker just wrote and has not
# committed is the live case; `--exclude-standard` keeps ignored build output
# out of it, and that pairing is what excludes the log without naming it.
#
# NOT `--no-index`, WHICH IS NOT A SPELLING OF THIS. Measured: `git grep
# --no-index --untracked` is a fatal error — the two are mutually exclusive —
# and it exits 128 having matched NOTHING. Silently, in the reassuring
# direction: every waiting worker would have read `stalled` and been restarted
# into the wait this state exists to prevent. `--no-index` also means "search
# the directory, ignore git", which would have re-admitted the log.
#
# `-I` skips binary files: a marker-shaped byte sequence inside a `.png` is a
# coincidence, not a question.
plot_worker_blocked() { # $1=worktree → 0 when a person owes this branch an answer
  local wt="$1"
  [ -n "$wt" ] && [ -d "$wt" ] || return 1
  # EVERY OPTION BEFORE THE PATTERN. `git grep -qIE <pat> --untracked` parses
  # `--untracked` as a REVISION and dies "unable to resolve revision" — exit
  # 128, no match, and `2>/dev/null` swallows the message. Measured here: the
  # same silent failure in the same reassuring direction as `--no-index`, from a
  # different cause. Two ways to write this wrongly is why the test asserts a
  # marker is FOUND rather than only that a clean tree is not `waiting`.
  git -C "$wt" grep -qIE --untracked --exclude-standard "$PLOT_BLOCKED_MARKER" -- . 2>/dev/null
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
  # `--porcelain` is the STABLE format; `git status` prose is localised and
  # reflows. Cut at column 4: the first three bytes are the XY status pair and a
  # space, and a filename can contain spaces of its own.
  git -C "$wt" status --porcelain 2>/dev/null \
    | cut -c4- \
    | grep -vE '(^|/)\.plot-worker\.(pid|exit|log)$' \
    | grep -vE '\.(tmp[0-9]*|swp|orig|rej|bak)$' || true
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
# Prints "state\tpid\tcode" — pid and code empty where they do not apply.
# Never fails; an unreadable worktree is `none`, which is the honest answer.
plot_worker_state() { # $1=worktree $2=pr-fact → "state\tpid\tcode"
  local wt="$1" has_pr="${2:-}" pid code
  [ -n "$wt" ] && [ -f "$wt/.plot-worker.pid" ] || { printf 'none\t\t'; return; }
  pid=$(cat "$wt/.plot-worker.pid" 2>/dev/null | tr -d ' \n')
  [ -n "$pid" ] || { printf 'none\t\t'; return; }
  # `kill -0 0` signals the whole process GROUP and succeeds, so pid 0 would
  # read as running forever. It is never a real worker pid. Non-numeric junk is
  # rejected with it: `kill -0` would error on it anyway, and "running" is the
  # one reading a garbled pid must never produce.
  case "$pid" in 0|*[!0-9]*) printf 'none\t\t'; return ;; esac
  if kill -0 "$pid" 2>/dev/null; then printf 'running\t%s\t' "$pid"; return; fi

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
      *)           printf 'failed\t%s\t%s' "$pid" "$code"; return ;;
    esac
  fi
  # No exit file: a worker started before the code was recorded, or one killed
  # outright. Unknown is its own answer — guessing "finished" would be the same
  # mistake in the other direction.
  printf 'ended\t%s\t' "$pid"
}
