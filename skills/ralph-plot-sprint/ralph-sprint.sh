#!/bin/bash
set -e

# ralph-sprint: Automated sprint loop using /ralph-plot-sprint skill.
# Each iteration invokes claude -p with the skill, reads COMPLETE/BLOCKED signals,
# and notifies via ntfy when human action is needed.
#
# Output streaming: Uses --output-format stream-json so iteration logs are
# written incrementally. Monitor with: tail -f .ralph-state/iter-N.jsonl

# --- Configuration ---

RALPH_SPRINT_CLAUDE="${RALPH_SPRINT_CLAUDE:-claude --dangerously-skip-permissions}"
RALPH_SPRINT_SKILL="${RALPH_SPRINT_SKILL:-ralph-plot-sprint}"
RALPH_SPRINT_AUTOMERGE="${RALPH_SPRINT_AUTOMERGE:-false}"
RALPH_SPRINT_TIMEOUT="${RALPH_SPRINT_TIMEOUT:-1800}"

# Budget knobs. Precedence: environment variable > `## Plot Config` > default.
# The env var wins because this script is invoked by humans and CI who need a
# per-run override without editing a committed file; Plot Config wins over the
# default so adopting projects set their own conventions (Manifesto Principle 5).
PLOT_CONFIG="$(dirname "${BASH_SOURCE[0]}")/../plot/scripts/plot-config.sh"

plot_config_get() {
  # $1 = key, $2 = default. Falls back to the default if the helper is missing
  # (older plot install) — never fails the run over a config read.
  if [ -x "$PLOT_CONFIG" ]; then
    "$PLOT_CONFIG" get "$1" "$2" 2>/dev/null || printf '%s\n' "$2"
  else
    printf '%s\n' "$2"
  fi
}

# Accepts `30m`, `8h`, `90s`, or bare seconds. `0` disables the bound.
# Anything else → 0 (disabled). Failing toward "no bound" is the safe direction:
# a typo that disables a budget is visible in the startup line, whereas a typo
# that yields a zero or negative budget would abort every run at iteration 1.
#
# The numeric part is validated BEFORE any arithmetic. Suffix-stripping first and
# computing second would let `1.5h` reach `$(( 1.5 * 3600 ))`, which is a fatal
# syntax error under `set -e` — it would kill the sprint at startup rather than
# fall through to the catch-all.
parse_duration() {
  local raw="$1" num unit
  case "$raw" in
    *[hms]) num="${raw%[hms]}"; unit="${raw##*[!hms]}" ;;
    *)      num="$raw";         unit="" ;;
  esac
  # Digits only — rejects 1.5, -2, 8H, empty, and anything non-numeric.
  case "$num" in
    ''|*[!0-9]*) printf '0\n'; return ;;
  esac
  case "$unit" in
    h) printf '%s\n' "$(( num * 3600 ))" ;;
    m) printf '%s\n' "$(( num * 60 ))" ;;
    s) printf '%s\n' "$num" ;;
    *) printf '%s\n' "$num" ;;
  esac
}

RALPH_SPRINT_MAX_ITERATIONS="${RALPH_SPRINT_MAX_ITERATIONS:-$(plot_config_get "Sprint max iterations" "20")}"
RALPH_SPRINT_DEADLINE="${RALPH_SPRINT_DEADLINE:-$(plot_config_get "Sprint deadline" "8h")}"
RALPH_SPRINT_HEARTBEAT_INTERVAL="${RALPH_SPRINT_HEARTBEAT_INTERVAL:-$(plot_config_get "Sprint heartbeat interval" "5m")}"
RALPH_SPRINT_STALL_LIMIT="${RALPH_SPRINT_STALL_LIMIT:-$(plot_config_get "Sprint stall limit" "3")}"
RALPH_SPRINT_ON_BUDGET_EXHAUSTED="${RALPH_SPRINT_ON_BUDGET_EXHAUSTED:-$(plot_config_get "Sprint on budget exhausted" "ship_partial")}"

DEADLINE_SECONDS=$(parse_duration "$RALPH_SPRINT_DEADLINE")
HEARTBEAT_SECONDS=$(parse_duration "$RALPH_SPRINT_HEARTBEAT_INTERVAL")
case "$RALPH_SPRINT_STALL_LIMIT" in ''|*[!0-9]*) RALPH_SPRINT_STALL_LIMIT=3 ;; esac
case "$RALPH_SPRINT_MAX_ITERATIONS" in ''|*[!0-9]*) RALPH_SPRINT_MAX_ITERATIONS=20 ;; esac

# The enum IS the contract. Validate it here so the run cannot proceed on a
# typo silently; fail toward shipping, which is the safe direction.
case "$RALPH_SPRINT_ON_BUDGET_EXHAUSTED" in
  ship_partial|fail) ;;
  *) echo "warning: Sprint on budget exhausted='$RALPH_SPRINT_ON_BUDGET_EXHAUSTED' is not ship_partial|fail; using ship_partial" >&2
     RALPH_SPRINT_ON_BUDGET_EXHAUSTED=ship_partial ;;
esac
NTFY_URL="${CLAUDE_NTFY_URL:?"Set CLAUDE_NTFY_URL (e.g. https://ntfy.sh)"}"
NTFY_TOKEN="${CLAUDE_NTFY_TOKEN:?"Set CLAUDE_NTFY_TOKEN"}"
NTFY_TOPIC="${CLAUDE_NTFY_TOPIC:-claude-on-$(hostname -s)}"

# Suppress interactive notification hook — ralph handles its own ntfy
export CLAUDE_NTFY_SKIP=1

# --- State ---

SESSION_IDS=()
i=0
CHILD_PID=""
EXITING_NORMALLY=false
STATE_DIR=".ralph-state"
RUN_START=$(date +%s)
STALL_COUNT=0
MAIN_BRANCH=""   # resolved in pre-flight; used for the deliverable check

# --- Signal handling ---

handle_sigint() {
  echo ""
  echo "SIGINT received — forwarding to claude (PID $CHILD_PID)..."
  if [ -n "$CHILD_PID" ] && kill -0 "$CHILD_PID" 2>/dev/null; then
    kill -INT "$CHILD_PID" 2>/dev/null
    wait "$CHILD_PID" 2>/dev/null || true
  fi
  exit 130
}
trap handle_sigint INT

# shellcheck disable=SC2329
cleanup() {
  local exit_code=$?
  trap - EXIT INT

  # Skip cleanup on normal exit (already handled by the main flow)
  if [ "$EXITING_NORMALLY" = true ]; then
    exit "$exit_code"
  fi

  echo ""
  if [ "$exit_code" -eq 130 ]; then
    echo "Interrupted."
    notify "Sprint Interrupted" "Sprint '$SLUG' interrupted after $i iterations." "skull"
  else
    echo "Error (exit $exit_code) after $i iterations."
    notify "Sprint Error" "Sprint '$SLUG' errored (exit $exit_code) after $i iterations." "x"
  fi
  wrapup "Sprint Interrupted"
  exit "$exit_code"
}
trap cleanup EXIT

# --- Argument validation ---

if [ -z "$1" ] || [ -z "$2" ]; then
  EXITING_NORMALLY=true
  echo "Usage: $0 <iterations> <slug>"
  echo ""
  echo "Environment variables:"
  echo "  RALPH_SPRINT_CLAUDE      Claude command (default: claude --dangerously-skip-permissions)"
  echo "  RALPH_SPRINT_SKILL       Iteration skill name (default: ralph-plot-sprint)"
  echo "  RALPH_SPRINT_AUTOMERGE   Auto-merge reviewed PRs: true|false (default: false)"
  echo "  RALPH_SPRINT_TIMEOUT     Per-iteration timeout in seconds (default: 1800)"
  echo "  RALPH_SPRINT_MAX_ITERATIONS      Iteration ceiling (default: Plot Config 'Sprint max iterations', else 20; 0=off)"
  echo "  RALPH_SPRINT_DEADLINE            Whole-run budget, e.g. 30m/8h/3600 (default: 'Sprint deadline', else 8h; 0=off)"
  echo "  RALPH_SPRINT_HEARTBEAT_INTERVAL  Heartbeat staleness threshold (default: 'Sprint heartbeat interval', else 5m; 0=off)"
  echo "  RALPH_SPRINT_STALL_LIMIT         Consecutive no-deliverable iterations before stopping (default: 3; 0=off)"
  echo "  RALPH_SPRINT_ON_BUDGET_EXHAUSTED ship_partial|fail (default: 'Sprint on budget exhausted', else ship_partial)"
  echo "  CLAUDE_NTFY_URL          ntfy server URL (required)"
  echo "  CLAUDE_NTFY_TOKEN        ntfy auth token (required)"
  echo "  CLAUDE_NTFY_TOPIC        ntfy topic (default: claude-on-\$(hostname -s))"
  echo ""
  echo "Monitoring:"
  echo "  cat .ralph-state/heartbeat               # last iteration, deliverable, stall count"
  echo "  # stale-run watchdog (older than 1h):"
  echo "  test \$((\$(date +%s) - \$(cat .ralph-state/heartbeat.ts))) -gt 3600 && echo STALE"
  echo "  tail -f .ralph-state/iter-N.jsonl        # live stream of current iteration"
  echo "  jq 'select(.type==\"assistant\")' ...    # filter for agent responses"
  echo ""
  echo "Mid-run steering:"
  echo "  echo 'Focus on demos' > .ralph-state/instructions.md"
  echo "  (Injected into the next iteration's prompt, then deleted)"
  exit 1
fi

if ! [[ "$1" =~ ^[0-9]+$ ]] || [ "$1" -lt 1 ]; then
  EXITING_NORMALLY=true
  echo "Error: iterations must be a positive integer"
  exit 1
fi

if [[ "$2" =~ [[:space:]] ]]; then
  EXITING_NORMALLY=true
  echo "Error: slug must not contain whitespace"
  exit 1
fi

ITERATIONS=$1
SLUG=$2

# The configured ceiling caps the positional argument — a budget in config
# should not be silently exceeded by a command-line number.
if [ "$RALPH_SPRINT_MAX_ITERATIONS" -gt 0 ] && [ "$ITERATIONS" -gt "$RALPH_SPRINT_MAX_ITERATIONS" ]; then
  echo "Capping iterations $ITERATIONS -> $RALPH_SPRINT_MAX_ITERATIONS (Sprint max iterations)"
  ITERATIONS=$RALPH_SPRINT_MAX_ITERATIONS
fi

# --- Pre-flight checks ---

# Verify GitHub CLI is authenticated (saves burning an iteration on auth failure)
if ! gh auth status &>/dev/null; then
  EXITING_NORMALLY=true
  echo "Error: GitHub CLI not authenticated. Run: gh auth login -h github.com"
  exit 1
fi

# Verify sprint file exists
if ! ls docs/sprints/*-"$SLUG".md &>/dev/null 2>&1; then
  EXITING_NORMALLY=true
  echo "Error: No sprint file found for slug '$SLUG' in docs/sprints/"
  echo "Available sprints:"
  ls docs/sprints/*.md 2>/dev/null | xargs -I{} basename {} .md | sed 's/^[0-9-]*W[0-9]*-//' | sort -u || echo "  (none)"
  exit 1
fi

# Ensure state directory exists
mkdir -p "$STATE_DIR"

# Resolve the main branch for the deliverable check. Mirrors plot-reconcile-scan:
# origin/HEAD first, then the `Main branch` config key, then "main".
MAIN_BRANCH=$(git symbolic-ref --short refs/remotes/origin/HEAD 2>/dev/null | sed 's|^origin/||')
[ -z "$MAIN_BRANCH" ] && MAIN_BRANCH=$(plot_config_get "Main branch" "main")
git fetch -q origin "$MAIN_BRANCH" 2>/dev/null || true

echo "Budget: max_iterations=${RALPH_SPRINT_MAX_ITERATIONS} deadline=${RALPH_SPRINT_DEADLINE}(${DEADLINE_SECONDS}s) heartbeat=${RALPH_SPRINT_HEARTBEAT_INTERVAL}(${HEARTBEAT_SECONDS}s) stall_limit=${RALPH_SPRINT_STALL_LIMIT} on_budget_exhausted=${RALPH_SPRINT_ON_BUDGET_EXHAUSTED} main=${MAIN_BRANCH} (0=off)"

# --- Worktree refresh ---
# Remove stale worktree so claude --worktree creates a fresh one from current HEAD.
# Without this, the agent works against an old checkout and can't see new sprint items.
WORKTREE_NAME="sprint-$SLUG"
WORKTREE_PATH=".claude/worktrees/$WORKTREE_NAME"
if [ -d "$WORKTREE_PATH" ]; then
  echo "Removing stale worktree: $WORKTREE_NAME"
  git worktree remove "$WORKTREE_PATH" --force 2>/dev/null || true
fi

# --- Agent prompt ---

PROMPT="/$RALPH_SPRINT_SKILL $SLUG

AUTOMERGE=$RALPH_SPRINT_AUTOMERGE"

# --- ntfy ---

notify() {
  local title="$1" message="$2" tags="$3"
  curl -s -o /dev/null \
    -H "Authorization: Bearer $NTFY_TOKEN" \
    -H "Title: $title" \
    -H "Tags: $tags" \
    -H "Priority: high" \
    -d "$message" \
    "$NTFY_URL/$NTFY_TOPIC" 2>/dev/null || true
}

# --- Iteration log helpers ---

iter_logfile() {
  echo "$STATE_DIR/iter-${1}.jsonl"
}

parse_result() {
  local logfile="$1"
  jq -r 'select(.type=="result") | .result // empty' "$logfile" 2>/dev/null || true
}

parse_session_id() {
  local logfile="$1"
  jq -r 'select(.type=="result") | .session_id // empty' "$logfile" 2>/dev/null || true
}

# --- Deliverable / stall detection ---
#
# The deliverable signal is the main branch SHA and nothing else: it is local,
# already fetched, cannot flake on a network read, and has exactly two outcomes.
# A forge query would detect more kinds of progress (review comments, thread
# resolution, draft->ready flips) but introduces a third state — a failed call is
# neither "changed" nor "unchanged" — and a detector that misfires gets switched
# off, at which point its coverage is zero. Reliability beats coverage here.
#
# Known blind spot: a Step 4 iteration (post review comments) produces no commit
# and counts as a stall. That is safe at the default stall limit of 3, because
# the normal cycle is Step 4 (comments) then Step 1 (fixes, which commit) — the
# counter resets on the second iteration. Three consecutive review-only rounds
# would false-positive; that is rare and arguably worth interrupting for.

main_sha() {
  git rev-parse "origin/$MAIN_BRANCH" 2>/dev/null || echo "unknown"
}

# Rubric criterion 2: did any remote branch appear or advance? A Step 3 iteration
# that builds and pushes a feature branch is the most common productive shape and
# does NOT move main — without this it would count as a stall, and three in a row
# would kill a healthy run. One local-ish call against origin, same cost class as
# the fetch the loop already does.
branch_refs() {
  git ls-remote --heads origin 2>/dev/null | sort || echo "unknown"
}

write_heartbeat() {
  # $1 = iteration, $2 = deliverable (moved|none), $3 = stall count
  local now; now=$(date +%s)
  printf '%s\n' "$now" > "$STATE_DIR/heartbeat.ts"
  cat > "$STATE_DIR/heartbeat" <<EOF
{"ts":$now,"iso":"$(date -u +%Y-%m-%dT%H:%M:%SZ)","iteration":$1,"deliverable":"$2","stall_count":$3,"stall_limit":$RALPH_SPRINT_STALL_LIMIT,"heartbeat_interval_s":$HEARTBEAT_SECONDS,"on_budget_exhausted":"$RALPH_SPRINT_ON_BUDGET_EXHAUSTED","elapsed_s":$((now - RUN_START))}
EOF
}

# --- Wrap-up session ---

wrapup() {
  local title="$1"
  if [ ${#SESSION_IDS[@]} -eq 0 ]; then
    return
  fi

  # Build batched session list (5 per batch) for subagent parallelism
  local batch_num=0
  local batch_text=""
  local count=0
  for idx in "${!SESSION_IDS[@]}"; do
    if (( count % 5 == 0 )); then
      batch_num=$(( batch_num + 1 ))
      local batch_start=$(( count + 1 ))
      local batch_end=$(( count + 5 ))
      if (( batch_end > ${#SESSION_IDS[@]} )); then
        batch_end=${#SESSION_IDS[@]}
      fi
      batch_text+="
Batch $batch_num (sessions $batch_start-$batch_end):"
    fi
    batch_text+="
- ${SESSION_IDS[$idx]}"
    count=$(( count + 1 ))
  done

  echo ""
  echo "=== Wrap-up ==="
  # Unset CLAUDECODE to allow nested claude invocation
  # shellcheck disable=SC2086,SC1007
  CLAUDECODE= $RALPH_SPRINT_CLAUDE -p "/bye
You are wrapping up an automated sprint run for sprint '$SLUG'.
The run completed $i iterations with outcome: $title.

## Strategy

Do NOT try to resume or read all session transcripts yourself — they may overflow
your context. Instead:

1. Launch subagents (Agent tool) to summarize sessions in BATCHES of ~5.
   Each subagent should read the JSONL transcript files directly:
   jq 'select(.type == \"assistant\") | .message.content' < file.jsonl
   For each session: extract the key action (what step, what was built/fixed/reviewed),
   the outcome, and notable decisions. Return 2-3 line bullet summary per session.

2. After all subagent summaries return, combine into a single sessionlog.

3. Write the sessionlog and commit with message:
   'sessionlog: $SLUG sprint wrap-up ($i iterations)'

## Session IDs

All stored in the project's .claude/projects/ session directory.
$batch_text" || true
}

# --- Main loop ---

for ((i=1; i<=ITERATIONS; i++)); do
  LOGFILE=$(iter_logfile "$i")
  ELAPSED=$(( $(date +%s) - RUN_START ))
  echo "=== Iteration $i/$ITERATIONS === (log: $LOGFILE, elapsed ${ELAPSED}s, stall ${STALL_COUNT}/${RALPH_SPRINT_STALL_LIMIT})"

  # --- Budget state ---
  # `final` fires while there is still room to run a full iteration, so the agent
  # can land in-flight work rather than being cut off mid-step. Reserving one
  # RALPH_SPRINT_TIMEOUT is what makes ship-partial fire BEFORE the budget
  # expires instead of after it.
  BUDGET_STATE="ok"
  if [ "$DEADLINE_SECONDS" -gt 0 ] && [ $(( ELAPSED + RALPH_SPRINT_TIMEOUT )) -ge "$DEADLINE_SECONDS" ]; then
    BUDGET_STATE="final"
  elif [ "$RALPH_SPRINT_STALL_LIMIT" -gt 0 ] && [ "$STALL_COUNT" -ge "$RALPH_SPRINT_STALL_LIMIT" ]; then
    BUDGET_STATE="stalled"
  elif [ "$i" -eq "$ITERATIONS" ]; then
    BUDGET_STATE="final"   # last iteration of the iteration budget
  fi
  [ "$BUDGET_STATE" != "ok" ] && echo "BUDGET: $BUDGET_STATE — instructing agent to land work and hand over."

  # --- Deliverable checkpoint (before) ---
  SHA_BEFORE=$(main_sha)
  REFS_BEFORE=$(branch_refs)

  # --- Instruction injection ---
  INSTRUCTIONS_FILE="$STATE_DIR/instructions.md"
  ITER_PROMPT="$PROMPT

BUDGET: $BUDGET_STATE"
  if [ -f "$INSTRUCTIONS_FILE" ]; then
    EXTRA_INSTRUCTIONS=$(cat "$INSTRUCTIONS_FILE")
    rm "$INSTRUCTIONS_FILE"
    echo "Injected instructions from $INSTRUCTIONS_FILE"
    ITER_PROMPT="HUMAN OVERRIDE (this iteration only):
$EXTRA_INSTRUCTIONS
---

$ITER_PROMPT"
  fi

  # Run claude with stream-json for incremental log output.
  # The log file can be tailed live: tail -f .ralph-state/iter-N.jsonl
  # shellcheck disable=SC2086
  timeout "$RALPH_SPRINT_TIMEOUT" $RALPH_SPRINT_CLAUDE \
    --worktree "sprint-$SLUG" \
    -p "$ITER_PROMPT" \
    --output-format stream-json --verbose \
    --effort high \
    </dev/null > "$LOGFILE" 2>"$STATE_DIR/iter-${i}.stderr" &
  CHILD_PID=$!

  # Wait for the child — captures exit code without set -e killing us
  wait "$CHILD_PID" || true
  CHILD_PID=""

  result=$(parse_result "$LOGFILE")
  session_id=$(parse_session_id "$LOGFILE")

  if [ -n "$session_id" ]; then
    SESSION_IDS+=("$session_id")
  fi

  echo "$result"

  # --- Deliverable checkpoint (after) ---
  # Objective condition: did origin/<main> move? The agent's own account of what
  # it did is not consulted here — that is the point.
  SHA_AFTER=$(git fetch -q origin "$MAIN_BRANCH" 2>/dev/null; main_sha)
  REFS_AFTER=$(branch_refs)
  # Rubric criteria 1 and 2. A failed ls-remote returns "unknown" on both sides,
  # which compares equal — an unreadable remote must not read as a deliverable.
  #
  # Known imprecision: any remote change counts, including a push by someone else
  # during our iteration. That resets the stall counter on work we did not do —
  # a false NEGATIVE for stall detection, which only ever delays a stop. Filtering
  # to refs this agent touched would need per-iteration ref bookkeeping, i.e. the
  # general state-diffing this design explicitly avoids. Deliberate trade.
  if [ "$SHA_BEFORE" != "$SHA_AFTER" ] && [ "$SHA_AFTER" != "unknown" ]; then
    DELIVERABLE="main-advanced"
    STALL_COUNT=0
  elif [ "$REFS_BEFORE" != "$REFS_AFTER" ] && [ "$REFS_AFTER" != "unknown" ]; then
    DELIVERABLE="branch-pushed"
    STALL_COUNT=0
  else
    DELIVERABLE="none"
    STALL_COUNT=$(( STALL_COUNT + 1 ))
  fi
  write_heartbeat "$i" "$DELIVERABLE" "$STALL_COUNT"
  echo "deliverable: $DELIVERABLE (${SHA_BEFORE:0:7} -> ${SHA_AFTER:0:7}), stall ${STALL_COUNT}/${RALPH_SPRINT_STALL_LIMIT}"

  # Extract summary: last ~10 lines before the promise tag
  summary=$(echo "$result" | grep -B 50 '<promise>' | grep -v '<promise>' | tail -10) || true

  if [[ "$result" == *"<promise>COMPLETE</promise>"* ]]; then
    notify "Sprint Complete" "Sprint '$SLUG' complete after $i iterations.

$summary" "white_check_mark"
    echo "Sprint complete after $i iterations."
    EXITING_NORMALLY=true
    wrapup "Sprint Complete"
    exit 0

  elif [[ "$result" == *"<promise>BLOCKED</promise>"* ]]; then
    notify "Sprint Blocked" "Sprint '$SLUG' is blocked after $i iterations.

$summary" "octagonal_sign"
    echo "Sprint blocked after $i iterations."
    EXITING_NORMALLY=true
    wrapup "Sprint Blocked"
    exit 1

  elif [[ "$result" == *"<promise>CONTINUE</promise>"* ]]; then
    echo "Iteration $i: CONTINUE — proceeding to next iteration."

  else
    # No recognized signal. Silence is a failure signal, never a completion
    # signal (Manifesto Principle 10): an iteration that emitted nothing counts
    # against the stall limit regardless of what else it may have done. It is
    # NOT fatal on its own — a single missing signal alongside a real commit is
    # tolerated, because SHA movement already reset the counter above.
    echo "WARNING: Iteration $i: no signal detected (expected <promise>CONTINUE</promise>)."
    if [ "$DELIVERABLE" = "none" ]; then
      echo "  No signal AND no deliverable — counting as a stall."
    fi
  fi

  # Deadline hard stop. BUDGET: final is a *request* to the agent; an agent that
  # keeps emitting CONTINUE would otherwise run past the deadline indefinitely,
  # which is the failure mode this budget exists to prevent. The signal gives it
  # one iteration to land work and hand over; this enforces the boundary
  # regardless of what it emits. Rule -> gate.
  if [ "$DEADLINE_SECONDS" -gt 0 ] && [ $(( $(date +%s) - RUN_START )) -ge "$DEADLINE_SECONDS" ]; then
    HANDOVER=""
    [ -f "$STATE_DIR/handover.md" ] && HANDOVER=$(head -20 "$STATE_DIR/handover.md")
    notify "Sprint Deadline Reached" "Sprint '$SLUG' hit its ${RALPH_SPRINT_DEADLINE} deadline after $i iterations.

$HANDOVER" "hourglass"
    echo "Deadline ${RALPH_SPRINT_DEADLINE} (${DEADLINE_SECONDS}s) reached after $i iterations."
    [ -n "$HANDOVER" ] && { echo "--- handover ---"; echo "$HANDOVER"; }
    EXITING_NORMALLY=true
    wrapup "Sprint Deadline Reached"
    [ "$RALPH_SPRINT_ON_BUDGET_EXHAUSTED" = "ship_partial" ] && exit 0
    exit 1
  fi

  # A stalled run stops here rather than burning the remaining iterations. The
  # NEXT iteration was already told BUDGET: stalled and given a chance to hand
  # over; reaching this point means it did not produce anything either.
  if [ "$RALPH_SPRINT_STALL_LIMIT" -gt 0 ] && [ "$STALL_COUNT" -gt "$RALPH_SPRINT_STALL_LIMIT" ]; then
    HANDOVER=""
    [ -f "$STATE_DIR/handover.md" ] && HANDOVER=$(head -20 "$STATE_DIR/handover.md")
    notify "Sprint Stalled" "Sprint '$SLUG' stalled: ${STALL_COUNT} iterations with no commit to $MAIN_BRANCH.

$HANDOVER" "octagonal_sign"
    echo "Sprint stalled after $i iterations (${STALL_COUNT} with no deliverable)."
    EXITING_NORMALLY=true
    wrapup "Sprint Stalled"
    # Exit code comes from the enum: a partial ship is a successful outcome.
    [ "$RALPH_SPRINT_ON_BUDGET_EXHAUSTED" = "ship_partial" ] && exit 0
    exit 1
  fi
done

# Exhausted iterations without a promise signal. The final iteration was told
# BUDGET: final, so a handover should exist — surface it rather than just the count.
HANDOVER=""
[ -f "$STATE_DIR/handover.md" ] && HANDOVER=$(head -20 "$STATE_DIR/handover.md")
notify "Sprint Iterations Exhausted" "Sprint '$SLUG' used all $ITERATIONS iterations without completing.

$HANDOVER" "warning"
echo "Exhausted $ITERATIONS iterations without completing."
[ -n "$HANDOVER" ] && { echo "--- handover ---"; echo "$HANDOVER"; }
EXITING_NORMALLY=true
wrapup "Sprint Iterations Exhausted"
[ "$RALPH_SPRINT_ON_BUDGET_EXHAUSTED" = "ship_partial" ] && exit 0
exit 1
