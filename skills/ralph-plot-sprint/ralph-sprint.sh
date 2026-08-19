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
NTFY_URL="${CLAUDE_NTFY_URL:?"Set CLAUDE_NTFY_URL (e.g. https://ntfy.sh)"}"
NTFY_TOKEN="${CLAUDE_NTFY_TOKEN:?"Set CLAUDE_NTFY_TOKEN"}"
NTFY_TOPIC="${CLAUDE_NTFY_TOPIC:-claude-on-$(hostname -s)}"

# Suppress interactive notification hook — ralph handles its own ntfy
export CLAUDE_NTFY_SKIP=1

# Nobody is watching this loop — that is what it is for. Every `claude` below
# runs with `-p`, where the question tool is not registered at all: an agent
# that reaches a question site writes what it would have asked into its prose
# and exits 0, which a caller reading `$?` cannot tell from success. The
# variable makes the skipped question take the shape a skill author chose and
# emit a `PLOT-UNASKED:` line, instead of whatever the model improvises.
# See skills/plot/docs/unattended.md.
#
# Exported once rather than set per invocation because there are three call
# sites (the iteration loop, the wrap-up, and whatever $RALPH_SPRINT_CLAUDE
# expands to), and a fourth added later would silently miss the prefix.
# It never converts a gate into a pass — it answers "may I ask?", never
# "may I proceed?".
export PLOT_UNATTENDED=1

# --- State ---

SESSION_IDS=()
i=0
CHILD_PID=""
EXITING_NORMALLY=false
STATE_DIR=".ralph-state"

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
  echo "  CLAUDE_NTFY_URL          ntfy server URL (required)"
  echo "  CLAUDE_NTFY_TOKEN        ntfy auth token (required)"
  echo "  CLAUDE_NTFY_TOPIC        ntfy topic (default: claude-on-\$(hostname -s))"
  echo ""
  echo "Monitoring:"
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
  echo "=== Iteration $i/$ITERATIONS === (log: $LOGFILE)"

  # --- Instruction injection ---
  INSTRUCTIONS_FILE="$STATE_DIR/instructions.md"
  ITER_PROMPT="$PROMPT"
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
    # No recognized signal — warn but continue for backwards compatibility.
    echo "WARNING: Iteration $i: no signal detected (expected <promise>CONTINUE</promise>). Continuing anyway."
  fi
done

# Exhausted iterations without a promise signal
notify "Sprint Iterations Exhausted" "Sprint '$SLUG' used all $ITERATIONS iterations without completing." "warning"
echo "Exhausted $ITERATIONS iterations without completing."
EXITING_NORMALLY=true
wrapup "Sprint Iterations Exhausted"
exit 1
