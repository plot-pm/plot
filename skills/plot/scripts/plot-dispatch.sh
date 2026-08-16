#!/usr/bin/env bash
# Plot helper: fan out one worktree + one worker per eligible branch.
# Usage: plot-dispatch.sh [--dry-run] [--no-start] [--offline] [--max N] <slug>
#   --status    list fleet worktrees with worker pid, liveness, and last log
#               line; then exit. Works regardless of plan phase.
#   --stop <br> stop the worker on <br> (branch required — never "all").
#   --dry-run   print what would happen; create nothing, push nothing
#   --no-start  create worktrees and claim refs, but start no workers
#   --offline   skip `git fetch`
#   --max N     dispatch at most N branches this run (default: all eligible)
#   <slug>      the plan to fan out
# Output: one line per branch, each optionally followed by an indented
#         `in flight:` line naming a branch that already holds files, then a
#         machine-countable summary:
#             summary: dispatched=2 reused=0 skipped=1 started=2
#
# THIS IS THE ONE SCRIPT IN THE FLEET THAT WRITES. Everything else
# (plot-fleet-scan.sh, plot-reconcile-scan.sh) is read-only. Consequently every
# write here is either idempotent or refused:
#
#   - Claim by ref push, where the claim carries an empty COMMIT. Two
#     independent claims diverge, so the loser's push is rejected as
#     non-fast-forward — that rejection is the concurrency control. Pushing a
#     branch that merely points at origin/<main> would NOT work: the remote
#     already has that commit, so both pushes succeed and both dispatchers
#     think they won. Git is the lock only when the refs actually diverge.
#   - Worktrees are adopted, never duplicated. A dispatcher that dies halfway
#     through a fan-out is safe to re-run.
#   - Nothing is ever deleted. Cleanup belongs to /plot-reconcile, which can
#     tell a deliberately abandoned claim from a dead worker.
#   - The `Started:` record is booked on the DEFAULT BRANCH, after the claims,
#     and only for branches this run newly claimed. A re-run books nothing it
#     merely re-adopted. If the booking cannot be pushed, the fan-out stands
#     and the script says the record is missing — see book_started.
#
# Eligibility is NOT decided here: this script asks plot-fleet-scan.sh, which
# owns the wave arithmetic. Dispatch only acts on the answer. Keeping the rule
# in one place is why a blocked wave can never be fanned out by accident.
#
# Workers are started DETACHED, one per worktree, so the fleet outlives the
# dispatching session — close the laptop and they keep going. That is also why
# the reaper (/plot-reconcile) is load-bearing rather than a nicety: a detached
# worker dies without telling anyone.
set -uo pipefail

script_dir=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)

dry_run=0
no_start=0
mode=dispatch
stop_branch=""
offline=""
max=0
slug=""
while [ $# -gt 0 ]; do
  case "$1" in
    --dry-run)  dry_run=1 ;;
    --status)   mode=status ;;
    # Only a value containing "/" is taken as the branch: otherwise a bare
    # `--stop <slug>` would silently treat the plan slug as a branch name and
    # stop the wrong thing (or nothing) without saying so.
    --stop)     mode=stop; case "${2:-}" in */*) stop_branch="$2"; shift ;; esac ;;
    --no-start) no_start=1 ;;
    --offline|--no-fetch) offline="--offline" ;;
    --max)      max="${2:?--max needs a value}"
                case "$max" in
                  ''|*[!0-9]*) echo "plot-dispatch: --max needs a number, got '$max'" >&2; exit 1 ;;
                esac
                shift ;;
    -h|--help)  sed -n '2,13p' "$0"; exit 0 ;;
    *)          slug="$1" ;;
  esac
  shift
done

git rev-parse --git-dir >/dev/null 2>&1 || { echo "not a git repository" >&2; exit 1; }
[ -n "$slug" ] || [ "$mode" != dispatch ] || { echo "plot-dispatch: need a plan slug" >&2; exit 1; }

# ---------------------------------------------------------------------------
# Inspection and shutdown
# ---------------------------------------------------------------------------
#
# Deliberately BEFORE the phase gate: work that is already running must stay
# inspectable and stoppable even if the plan was since delivered or rejected.
# Refusing to show a running worker because of a phase change would strand it.
repo_root_early=$(git rev-parse --show-toplevel)
wt_root_early=$(cd "$repo_root_early/.." && pwd)

# States: "running <pid>" | "finished <pid>" | "failed <pid> (exit N)"
#       | "ended <pid> (status unknown)" | "no worker"
#
# `kill -0` only separates running from not-running. Whether a stopped worker
# finished its job or crashed is gone unless the exit code was recorded — and
# reporting a completed worker as "dead" reads as a crash, which is how a
# healthy fleet looks broken. The wrapper in start_worker writes the code.
worker_state() { # $1=worktree
  local wt="$1" pid code
  [ -f "$wt/.plot-worker.pid" ] || { echo "no worker"; return; }
  pid=$(cat "$wt/.plot-worker.pid" 2>/dev/null | tr -d ' \n')
  [ -n "$pid" ] || { echo "no worker"; return; }
  # `kill -0 0` signals the whole process GROUP and succeeds, so pid 0 would
  # read as running forever. It is never a real worker pid.
  case "$pid" in 0|*[!0-9]*) echo "no worker"; return ;; esac
  if kill -0 "$pid" 2>/dev/null; then echo "running $pid"; return; fi
  if [ -f "$wt/.plot-worker.exit" ]; then
    code=$(cat "$wt/.plot-worker.exit" 2>/dev/null | tr -d ' \n')
    case "$code" in
      0)  echo "finished $pid" ;;
      "") echo "ended $pid (status unknown)" ;;
      *)  echo "failed $pid (exit $code)" ;;
    esac
    return
  fi
  # No exit file: a worker started before this was recorded, or one killed
  # outright. Unknown is its own answer — guessing "finished" would be the
  # same mistake in the other direction.
  echo "ended $pid (status unknown)"
}

if [ "$mode" = "status" ]; then
  n_live=0 n_done=0 n_failed=0 n_ended=0 n_none=0
  for wt in "$wt_root_early"/plot-wt-*; do
    [ -d "$wt" ] || continue
    br=$(git -C "$wt" branch --show-current 2>/dev/null || echo "?")
    st=$(worker_state "$wt")
    case "$st" in
      running*)  n_live=$((n_live + 1)) ;;
      finished*) n_done=$((n_done + 1)) ;;
      failed*)   n_failed=$((n_failed + 1)) ;;
      ended*)    n_ended=$((n_ended + 1)) ;;
      *)         n_none=$((n_none + 1)) ;;
    esac
    echo "  $br — $st"
    echo "      worktree: $wt"
    if [ -f "$wt/.plot-worker.log" ]; then
      echo "      log: $wt/.plot-worker.log"
      echo "      last: $(tail -1 "$wt/.plot-worker.log" 2>/dev/null)"
    fi
  done
  [ $((n_live + n_done + n_failed + n_ended + n_none)) -gt 0 ] \
    || echo "  (no fleet worktrees under $wt_root_early)"
  echo "summary: running=$n_live finished=$n_done failed=$n_failed ended=$n_ended no_worker=$n_none"
  exit 0
fi

if [ "$mode" = "stop" ]; then
  # An explicit branch is REQUIRED. A --stop that could mean "all" is one
  # fat-finger away from killing a whole fleet.
  if [ -z "$stop_branch" ]; then
    echo "plot-dispatch: --stop needs a branch name, e.g. --stop feature/x" >&2
    echo "  Refusing to guess — stopping the wrong worker discards its work." >&2
    exit 1
  fi
  wt="$wt_root_early/plot-wt-$(printf '%s' "$stop_branch" | tr '/' '-')"
  [ -d "$wt" ] || { echo "plot-dispatch: no worktree for '$stop_branch' at $wt" >&2; exit 1; }
  st=$(worker_state "$wt")
  case "$st" in
    running*)
      pid=${st#running }
      kill "$pid" 2>/dev/null && echo "stopped $stop_branch (pid $pid)" \
        || { echo "plot-dispatch: could not stop pid $pid" >&2; exit 1; }
      # The worktree and its claim are left in place: the branch is still taken,
      # and deleting either would be the kind of write this design avoids.
      echo "  worktree kept at $wt — the claim stands until you release it"
      ;;
    finished*|failed*|ended*) echo "$stop_branch is not running ($st)" ;;
    *)      echo "$stop_branch has no worker" ;;
  esac
  exit 0
fi

# ---------------------------------------------------------------------------
# Phase and ceremony gate
# ---------------------------------------------------------------------------
#
# A GATE, not a rule (CLAUDE.md, "Gates Over Rules"): the check lives here, in
# the script, because prose in a SKILL.md is something an agent can rationalise
# around and a human calling this script directly bypasses entirely. Fanning
# out is the one place a user can do real damage — branches and worker
# processes for a plan nobody approved.
#
# FAIL CLOSED, unlike plot-phase-gate.sh. That one is a PreToolUse hook, so a
# broken gate would lock every commit in the repo and it must fail open. This
# is a command the user invoked: if the plan's phase cannot be read, refusing
# costs one confused re-run, while proceeding costs several agents doing
# unapproved work. The damage is asymmetric, so the default is too.
PLAN_DIR_CFG=$("$script_dir/plot-config.sh" get "Plan directory" "docs/plans/")
ACTIVE_DIR_CFG=$("$script_dir/plot-config.sh" get "Active index" "docs/plans/active/")
plan_file=""
for cand in "$ACTIVE_DIR_CFG$slug.md" "$PLAN_DIR_CFG"*"$slug".md; do
  [ -e "$cand" ] && { plan_file="$cand"; break; }
done

if [ -z "$plan_file" ]; then
  echo "plot-dispatch: no plan found for '$slug' — looked in $ACTIVE_DIR_CFG and $PLAN_DIR_CFG" >&2
  exit 1
fi

gate_meta=$("$script_dir/plot-plan-meta.sh" "$plan_file" 2>/dev/null) || gate_meta=""
gate_phase=$(printf '%s' "$gate_meta" | sed -n 's/.*"phase":"\([^"]*\)".*/\1/p')
gate_impl=$(printf '%s' "$gate_meta" | sed -n 's/.*"impl":"\([^"]*\)".*/\1/p')

case "$gate_phase" in
  approved) ;;
  draft)
    echo "plot-dispatch: plan '$slug' is still Draft — nothing may be dispatched." >&2
    echo "  Review it, then: /plot-approve $slug" >&2
    exit 1 ;;
  delivered|released)
    echo "plot-dispatch: plan '$slug' is already $gate_phase — its work is done." >&2
    exit 1 ;;
  "")
    echo "plot-dispatch: cannot read the phase of '$slug' ($plan_file)." >&2
    echo "  Refusing rather than guessing — dispatching starts real work." >&2
    exit 1 ;;
  *)
    echo "plot-dispatch: plan '$slug' is in phase '$gate_phase', not Approved." >&2
    exit 1 ;;
esac

# Fan-out only makes sense where implementation happens on its own branches
# here. NONE means a pre-Plot-2 plan that never recorded an answer — allowed,
# since those predate the question.
case "$gate_impl" in
  own-branches|NONE|"") ;;
  same-branch)
    echo "plot-dispatch: plan '$slug' records 'Impl: same branch' — plan and code" >&2
    echo "  travel on one branch, so there is nothing to fan out." >&2
    exit 1 ;;
  other-repo)
    echo "plot-dispatch: plan '$slug' records 'Impl: other repo' — implementation" >&2
    echo "  happens elsewhere. Dispatch from the implementation repo instead." >&2
    exit 1 ;;
  none)
    echo "plot-dispatch: plan '$slug' records 'Impl: none' — knowledge-only work," >&2
    echo "  nothing to implement." >&2
    exit 1 ;;
  *)
    echo "plot-dispatch: plan '$slug' records an unrecognised 'Impl:' answer" >&2
    echo "  ('$gate_impl'). Refusing rather than guessing." >&2
    exit 1 ;;
esac

MAIN=$(git symbolic-ref --short refs/remotes/origin/HEAD 2>/dev/null | sed 's#^origin/##')
[ -n "$MAIN" ] || MAIN="main"
[ -n "$offline" ] || git fetch -q origin "$MAIN" 2>/dev/null

# Worktrees live beside the repo, not inside it: a worktree nested in the repo
# would show up in its own status and in every glob.
repo_root=$(git rev-parse --show-toplevel)
wt_root=$(cd "$repo_root/.." && pwd)

n_dispatched=0 n_reused=0 n_skipped=0 n_started=0

# Branches CLAIMED by this run, for the `Started:` record. Only newly claimed
# ones: a reused worktree was dispatched by an earlier run, which booked it.
declare -a claimed_now=()

# Branches this run cannot dispatch. --next re-asks each iteration (pull
# semantics), and a branch that is never CLAIMED keeps coming back — without
# this the loop spins forever on the first undispatchable branch.
declare -a exhausted=()
is_exhausted() {
  local x
  for x in ${exhausted[@]+"${exhausted[@]}"}; do [ "$x" = "$1" ] && return 0; done
  return 1
}

# Record what was started, ON THE DEFAULT BRANCH.
#
# WHERE THIS IS WRITTEN IS THE WHOLE DIFFICULTY. The plan file found above
# lives in this dispatcher's LOCAL WORKING TREE — `docs/plans/active/<slug>.md`
# relative to whatever branch happens to be checked out here. The board reads
# the plan from the DEFAULT BRANCH. Appending the record to the local file and
# committing it would book the start on the dispatcher's branch, where the
# board never looks: the plan would keep reading as Ready while agents edit its
# branches. That is not hypothetical — it had to be back-filled by hand twice
# on this repo on 2026-08-16, which is why the naive version is called out here
# rather than merely avoided.
#
# So dispatch books the way every other Plot command books: through a
# disposable branch off origin/<default>, pushed with plot-push-main.sh.
#
# A SEPARATE WORKTREE, not `git checkout -b` in this one. The plan's sketch
# said checkout, but the dispatcher's working tree belongs to the user and may
# carry uncommitted work; switching it out from under them to save a note is
# exactly the kind of write this script otherwise refuses. A throwaway worktree
# reaches the same commit without touching anyone's checkout, and is removed
# whether the push succeeded or not.
#
# plot-push-main.sh rather than a bare `git push`, so a repo whose protection
# is configured but not enforced hears about the bypass instead of it passing
# silently — the reason that helper exists at all.
book_started() { # $@ = branches dispatched this run
  [ $# -gt 0 ] || return 0

  if write_started_record "$@"; then
    return 0
  fi

  # A FAILED BOOKING NEVER UNWINDS A FAN-OUT. By the time we are here the
  # worktrees exist and the claims are pushed, and those are the real state;
  # the record is a report ABOUT that state. Rolling back real work because a
  # note could not be saved is the larger damage, and aborting mid-fan-out
  # would leave exactly the inconsistency the record exists to prevent.
  #
  # Said ONCE, here, and on STDOUT beside the summary it qualifies. Why the
  # write failed belongs on stderr and was printed there; that the record is
  # missing while the work is running is part of this command's report, and a
  # caller reading only stdout would otherwise see a clean fan-out with no hint
  # that the plan still reads as Ready.
  echo "  note: Started: could not be recorded on $MAIN — the fan-out stands."
  echo "        Record it by hand, or re-run this dispatch once the push works."
  return 1
}

# The write itself. Every failure path returns non-zero after saying WHY on
# stderr; the caller owns the one user-facing consequence line.
write_started_record() { # $@ = branches
  local who date rel tmpwt bookbr rc=0
  who="${PLOT_CLAIM_WHO:-$(git config user.name 2>/dev/null || echo plot)}"
  date=$(date +%Y-%m-%d)

  # The CANONICAL plan file, not the index symlink: the record belongs in the
  # dated file both indexes point at, or a later `active/` → `delivered/` move
  # would carry the symlink and leave the record behind.
  rel=$(cd "$repo_root" && real_plan_path "$plan_file") || rel=""
  if [ -z "$rel" ]; then
    echo "plot-dispatch: $plan_file is outside the repository root" >&2
    return 1
  fi

  bookbr="plot/start-$slug"
  tmpwt="$wt_root/.plot-start-$slug.$$"

  # Fetch even under --offline: booking is a push, so the network is already
  # required. Without a fresh origin/<default> the branch would fork from a
  # stale tip and the push would be a guaranteed non-fast-forward.
  git fetch -q origin "$MAIN" 2>/dev/null

  # -B: a leftover branch from an earlier failed booking must not block this
  # one. It is disposable by construction — created here, pushed, deleted.
  if ! git worktree add -q -B "$bookbr" "$tmpwt" "origin/$MAIN" 2>/dev/null; then
    echo "plot-dispatch: could not prepare a booking worktree at $tmpwt" >&2
    return 1
  fi

  if [ -f "$tmpwt/$rel" ]; then
    local br
    for br in "$@"; do
      append_started_line "$tmpwt/$rel" "$date" "$who" "$br" || {
        echo "plot-dispatch: $rel has no '## Status' section — nowhere to record" >&2
        rc=1
        break
      }
    done
    if [ "$rc" = 0 ]; then
      git -C "$tmpwt" add -- "$rel" 2>/dev/null
      git -C "$tmpwt" -c "user.name=$who" commit -q \
        -m "plot: record start of $slug" 2>/dev/null || rc=1
    fi
  else
    echo "plot-dispatch: $rel is not on origin/$MAIN" >&2
    rc=1
  fi

  # The helper's own words, indented: which rules were stepped over and which
  # checks did not run is information only the remote has. Its stderr is folded
  # in so a `rejected` report is visible rather than swallowed by 2>/dev/null
  # somewhere upstream.
  if [ "$rc" = 0 ]; then
    "$script_dir/plot-push-main.sh" "$bookbr" "$MAIN" 2>&1 | sed 's/^/  /'
    # The pipeline's status is sed's, so ask the helper's directly.
    rc=${PIPESTATUS[0]}
  fi

  git worktree remove --force "$tmpwt" 2>/dev/null || true
  git branch -D "$bookbr" >/dev/null 2>&1 || true
  return "$rc"
}

# The plan path relative to the repo root, with the index symlink resolved.
# Called from within $repo_root.
real_plan_path() { # $1=plan file as found (possibly a symlink, possibly relative)
  local p="$1" d b t
  d=$(cd "$(dirname "$p")" 2>/dev/null && pwd) || return 1
  b=$(basename "$p")
  t=$(readlink "$d/$b" 2>/dev/null || true)
  if [ -n "$t" ]; then
    case "$t" in
      /*) d=$(cd "$(dirname "$t")" 2>/dev/null && pwd) || return 1 ;;
      *)  d=$(cd "$d/$(dirname "$t")" 2>/dev/null && pwd) || return 1 ;;
    esac
    b=$(basename "$t")
  fi
  case "$d" in
    "$repo_root")   printf '%s' "$b" ;;
    "$repo_root"/*) printf '%s/%s' "${d#$repo_root/}" "$b" ;;
    *) return 1 ;;
  esac
}

# Insert one `- **Started:** ...` line into the plan's `## Status` section, in
# /plot-implement's exact shape so nothing downstream learns a second format.
#
# Placed after the LAST list item of `## Status`, never appended to the end of
# the file: plot-plan-meta.sh reads these records out of that section, so a
# line below it would parse as nothing at all — a record that exists on disk
# and not in the data is worse than no record, because it looks written.
#
# A plan with no `## Status` heading is therefore a REFUSAL, not a best-effort
# append. Exit 1 and let the caller report the record as unwritten; the plan is
# malformed and guessing where the field belongs would hide that.
append_started_line() { # $1=file $2=date $3=who $4=branch
  local f="$1" line
  line="- **Started:** $2, $3, \`$4\`"
  awk -v line="$line" '
    { lines[++n] = $0 }
    END {
      # The first `## Status` heading, then where the record belongs under it.
      for (i = 1; i <= n; i++) {
        if (lines[i] ~ /^##[ \t]*[Ss]tatus[ \t]*$/) { start = i; break }
      }
      if (!start) exit 1

      # The template ships an EMPTY `- **Started:**` placeholder, and the record
      # belongs there. Appending after the last list item instead put it below
      # `- **Delivered:**` — the parser still read it, so nothing failed loudly,
      # but the block listed a start after a delivery and both plans dispatched
      # on 2026-08-16 had to be tidied by hand.
      #
      # Filling the placeholder is preferred; appending after the last list item
      # remains the fallback for plans that never had one (pre-Plot-2 files).
      insert = start
      for (i = start + 1; i <= n; i++) {
        if (lines[i] ~ /^##[ \t]/) break
        if (lines[i] ~ /^[ \t]*[-*][ \t]*\*\*Started:\*\*[ \t]*$/) { slot = i; break }
        if (lines[i] ~ /^[ \t]*[-*][ \t]/) insert = i
      }

      for (i = 1; i <= n; i++) {
        if (i == slot) { print line; continue }   # replaces the empty placeholder
        print lines[i]
        if (!slot && i == insert) print line
      }
    }
  ' "$f" > "$f.plot-tmp" || { rm -f "$f.plot-tmp"; return 1; }
  mv "$f.plot-tmp" "$f"
}

# Start one DETACHED worker per worktree. Detached is the whole point: the
# fleet must outlive the dispatching session. Logs go beside the worktree so a
# human can read them without knowing anything about how the worker was started.
#
# The worker command is configurable because "how do I run an agent headless"
# is a per-project, per-tool answer that Plot must not hardcode (Principle 5).
start_worker() {
  local branch="$1" wt="$2"
  local cmd
  cmd=$("$script_dir/plot-config.sh" get "Worker command" "")
  if [ -z "$cmd" ]; then
    # Not an error: Plot deliberately hardcodes no agent tooling (Principle 5).
    # Word it as the next step rather than a failure, or a first run reads as
    # "it did nothing".
    echo "    worktree ready — no 'Worker command' configured, so start it yourself:"
    echo "      cd $wt   # branch $branch is claimed and waiting"
    echo "    To start workers automatically, add to your CLAUDE.md Plot Config:"
    echo "      - **Worker command:** <how to run your agent headless>"
    return 1
  fi
  local log="$wt/.plot-worker.log"
  rm -f "$wt/.plot-worker.exit"
  ( cd "$wt" && PLOT_BRANCH="$branch" PLOT_WORKTREE="$wt" PLOT_EXIT_FILE="$wt/.plot-worker.exit" \
      nohup sh -c '( '"$cmd"' ); rc=$?; printf "%s" "$rc" > "$PLOT_EXIT_FILE"' \
      >"$log" 2>&1 </dev/null & echo $! >"$wt/.plot-worker.pid" )
  echo "    started worker (pid $(cat "$wt/.plot-worker.pid" 2>/dev/null || echo '?')), log: $log"
  return 0
}

# ---------------------------------------------------------------------------
# What is already in flight
# ---------------------------------------------------------------------------
#
# Before fanning out, say which branches already hold which files. Waves are a
# WITHIN-PLAN ordering; a correctly eligible branch can still name a file an
# agent has open on a different plan's branch, and nothing in the wave model
# represents that. Assembling the answer by hand took five commands and had to
# be done twice on 2026-08-16 — this turns it into a line of output.
#
# IT REPORTS AND REFUSES NOTHING. Every branch is dispatched exactly as before;
# the operator reads the report and decides. Two designs that would have judged
# instead were tried on paper and killed by measurement:
#
#   - `git merge-tree` compares two EXISTING commits, and dispatch CREATES the
#     candidate branch. At check time it is identical to the default branch, so
#     the comparison reports clean for every candidate, forever. A check that
#     always passes is worse than none: it turns a known gap into a false
#     assurance. (merge-tree still earns its place where both commits exist —
#     re-dispatch and plot-merge-queue.)
#   - A `Touches:` field per branch, intersected with the measured side. The
#     scope guards in real briefs are `packages/board/**`,
#     `packages/board/src/app/**` and `plot-fleet-scan.sh` — the first CONTAINS
#     the second, so two branches that ran in parallel without touching each
#     other would read as colliding. Three of four briefs use `**` globs, so the
#     false positive is the normal case. It would also rest on an unverified
#     self-declaration, and a comparison is only as good as its weaker half.
#
# So only the MEASURED side is read, and nothing on the candidate side is
# consulted at all — not the plan text, not a declaration, nothing.
#
# LOCAL REFS AND WORKTREES, NOT THE REMOTE. This is where refs-are-truth bends,
# for a measured reason: the collision that blocked a dispatch on 2026-08-16
# lived in an UNPUSHED commit — committed, clean worktree, remote ref holding
# only the claim, invisible to any remote-based check. Uncommitted work is
# invisible to refs entirely. Both are readable here and only here, and that is
# sound rather than a violation because dispatch is inherently machine-specific:
# it creates worktrees on THIS machine. A check that ignored what this machine
# knows would be blind precisely where it acts.

# Files a branch holds in commits of its own, against ITS OWN MERGE-BASE.
#
# Not against origin/<main>. A branch rebased onto a newer main is not "behind"
# it, and diffing against the tip would attribute every commit the branch picked
# up from main to the branch itself — on a busy day that is the whole repo, and
# the report becomes noise on its first use.
committed_files() { # $1=branch → paths, one per line
  local br="$1" base
  base=$(git merge-base "$br" "origin/$MAIN" </dev/null 2>/dev/null) || return 0
  [ -n "$base" ] || return 0
  git diff --name-only "$base" "$br" </dev/null 2>/dev/null
}

# Files a branch holds only in its worktree — no ref carries these, so they are
# invisible to every ref-based check including this script's own.
uncommitted_files() { # $1=worktree → paths, one per line
  local wt="$1"
  [ -d "$wt" ] || return 0
  git -C "$wt" status --porcelain </dev/null 2>/dev/null | awk '
    {
      # Porcelain v1: XY then a space then the path. A rename prints
      # "old -> new"; the new path is the one on disk.
      line = substr($0, 4)
      i = index(line, " -> ")
      if (i > 0) line = substr(line, i + 4)
      gsub(/^"|"$/, "", line)
      if (line != "") print line
    }'
}

# The generated board bundle is excluded from every report. Every board branch
# rebuilds it, so including it would make every board pair look like a
# collision — which is precisely the noise `.gitattributes -merge` exists to
# remove. Its conflicts are settled by rebuilding, never by reading.
ARTIFACT_PATH="skills/plot/scripts/board/board-server.mjs"

# The worktree for a branch, by the same name-flattening rule dispatch uses.
worktree_for() { # $1=branch
  printf '%s/plot-wt-%s' "$wt_root" "$(printf '%s' "$1" | tr '/' '-')"
}

# Every local branch that holds files, with what it holds.
#
# LOCAL branches, because worktrees share one ref database: `git rev-parse`
# answers from the main repo for a branch checked out elsewhere, so a sibling
# agent's unpushed commits are readable from here without visiting its worktree.
#
# Emits "branch<TAB>file,file,…" per branch that holds at least one file.
# A branch holding nothing emits nothing — a bare claim marker is an empty
# commit, and reporting "holds " with no files would be worse than silence.
work_in_flight() { # $1=branch to exclude (the candidate)
  local exclude="${1:-}" br files
  # bash 3.2 on macOS: no `declare -A`, so this accumulates into a plain string
  # rather than a map. Sorted output keeps the report stable between runs.
  git for-each-ref --format='%(refname:short)' refs/heads/ </dev/null 2>/dev/null \
  | while read -r br; do
      [ -n "$br" ] || continue
      [ "$br" = "$exclude" ] && continue
      [ "$br" = "$MAIN" ] && continue
      files=$( { committed_files "$br"; uncommitted_files "$(worktree_for "$br")"; } \
        | grep -v -x -F "$ARTIFACT_PATH" \
        | sort -u \
        | tr '\n' ',' | sed 's/,$//' )
      [ -n "$files" ] || continue
      printf '%s\t%s\n' "$br" "$files"
    done
}

# Print the in-flight report for one candidate, indented under its line.
#
# Silent when nothing is held. A report that always prints something teaches
# the reader to skip it, and then it is worth nothing on the day it matters.
report_in_flight() { # $1=candidate branch
  local line br files
  work_in_flight "$1" | while IFS=$'\t' read -r br files; do
    # Commas to ", " for reading; the machine-countable summary is the footer,
    # so this line is allowed to be prose.
    echo "  in flight: $br holds $(printf '%s' "$files" | sed 's/,/, /g')"
  done
}

# A dry run changes nothing, so nothing can go stale — read the whole eligible
# set once. (`--next` would loop forever here: without a claim it keeps
# returning the same branch.)
if [ "$dry_run" = 1 ]; then
  while read -r br; do
    [ -n "$br" ] || continue
    echo "would dispatch $br → $wt_root/plot-wt-$(printf '%s' "$br" | tr '/' '-')"
    report_in_flight "$br"
    n_dispatched=$((n_dispatched + 1))
  done < <("$script_dir/plot-fleet-scan.sh" $offline --list-eligible "$slug" 2>/dev/null)
  echo "summary: dispatched=$n_dispatched reused=0 skipped=0 started=0"
  exit 0
fi

# Ask the fleet scan for eligible-and-unclaimed branches, one at a time.
# Re-asking after each claim is deliberate (pull, not push): the answer changes
# as we claim, and a list computed up front would go stale mid-fan-out.
while :; do
  [ "$max" -gt 0 ] && [ "$n_dispatched" -ge "$max" ] && break

  branch=$("$script_dir/plot-fleet-scan.sh" $offline --next "$slug" 2>/dev/null) || break
  [ -n "$branch" ] || break
  # --next has no memory; if it offers something we already failed on, the
  # eligible set is exhausted for this run.
  is_exhausted "$branch" && break

  # Flatten the whole branch name, not just its last segment: feature/api and
  # bug/api are different work and must not share a worktree (a shared path
  # also makes --stop act on whichever claimed it first).
  suffix=$(printf '%s' "$branch" | tr '/' '-')
  wt="$wt_root/plot-wt-$suffix"

  if [ "$dry_run" = 1 ]; then
    echo "would dispatch $branch → $wt"
    report_in_flight "$branch"
    n_dispatched=$((n_dispatched + 1))
    continue
  fi

  # BEFORE the worktree exists. Once dispatch has created this candidate's
  # worktree and claim, the candidate is itself work in flight, and a report
  # taken afterwards would describe the fan-out rather than what preceded it.
  in_flight=$(report_in_flight "$branch")

  # Adopt an existing worktree rather than duplicating it.
  if git worktree list --porcelain | grep -qx "worktree $wt"; then
    echo "reusing existing worktree for $branch → $wt"
    [ -n "$in_flight" ] && printf '%s\n' "$in_flight"
    n_reused=$((n_reused + 1))
  else
    git worktree add -q -b "$branch" "$wt" "origin/$MAIN" 2>/dev/null || {
      # Branch exists locally already: attach the worktree to it instead.
      git worktree add -q "$wt" "$branch" 2>/dev/null || {
        echo "skipped $branch (cannot create worktree)"
        n_skipped=$((n_skipped + 1))
        exhausted+=("$branch")
        continue
      }
    }
    # THE CLAIM. Rejection means another session won the race; leave its
    # worktree alone and move on to the next branch.
    #
    # The claim carries an EMPTY COMMIT, and that is load-bearing. Pushing a
    # branch that merely points at origin/<main> is a no-op: the remote already
    # has that commit, so the push succeeds with "Everything up-to-date" and
    # BOTH dispatchers believe they own the branch. Mutual exclusion requires
    # the refs to diverge — two independent claim commits are not fast-forwards
    # of each other, so the second push is rejected as non-fast-forward.
    #
    # Never add --force or --force-with-lease here: forcing is precisely what
    # would let a second dispatcher take a branch someone is working on.
    git -C "$wt" -c "user.name=${PLOT_CLAIM_WHO:-$(git config user.name || echo plot)}" \
        commit -q --allow-empty -m "plot: claim $branch" 2>/dev/null
    if git -C "$wt" push -q -u origin "$branch" 2>/dev/null; then
      echo "dispatched $branch → $wt"
      # Reported AFTER the claim, never before: a branch another dispatcher won
      # is not this run's to describe. The facts themselves were read before the
      # worktree existed, so the claim cannot have polluted them.
      [ -n "$in_flight" ] && printf '%s\n' "$in_flight"
      n_dispatched=$((n_dispatched + 1))
      # AFTER the claim push, never before. A Started: record for a branch
      # another dispatcher won would be a lie in the file, and the claim is the
      # only thing that decides who holds a branch.
      claimed_now+=("$branch")
    else
      echo "skipped $branch (claimed by another session)"
      git worktree remove --force "$wt" 2>/dev/null || true
      n_skipped=$((n_skipped + 1))
      exhausted+=("$branch")
      continue
    fi
  fi

  if [ "$no_start" = 0 ]; then
    start_worker "$branch" "$wt" && n_started=$((n_started + 1))
  fi
done

# Book AFTER the fan-out, in one commit, so a booking that fails cannot leave
# the plan claiming starts the run did not achieve. Its failure is reported and
# then ignored: the summary below reports what was dispatched either way.
book_started ${claimed_now[@]+"${claimed_now[@]}"} || true

echo "summary: dispatched=$n_dispatched reused=$n_reused skipped=$n_skipped started=$n_started"
