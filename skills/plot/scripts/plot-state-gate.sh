#!/usr/bin/env bash
# Plot gate: block a commit that CHANGES a `State:` line in a plan or sprint
# file, unless the script that owns that write made it.
#
# Wired as a Claude Code PreToolUse hook on the Bash tool (see hooks/hooks.json),
# beside plot-phase-gate.sh. Reads the hook JSON on stdin; acts only on commands
# containing "git commit". Exit 2 blocks with the command that owns the write on
# stderr; anything else allows.
#
# WHY THIS IS A GATE AND NOT A RULE. Measured 2026-09-08: a master agent set a
# plan's phase with `python re.sub`, a sprint's with `sed`, and made the active
# symlink with `ln -s`. Every other refusal in this estate fires when something
# is INVOKED — a script, an endpoint, a rule. A `sed` over a markdown line
# invokes none of them, so no amount of routing reaches it. *Can you answer "did
# I use the transition?" without doing the work?* Yes — and the answer was wrong
# three times in one afternoon, by the agent that wrote the rules.
#
# THE READING IS THE DIFF. For each staged file under the plan or sprint
# directory, the `State:` value in HEAD is compared with the staged one. A
# CHANGED value is a lifecycle transition and needs an owner. Everything else
# passes:
#
#   - a file with no HEAD version is a CREATION, not an edit. `/plot-idea` and
#     `/plot-sprint` write a plan or sprint from a template carrying its opening
#     state, and refusing that would refuse the first commit of every plan.
#   - a `State:` line whose value is unchanged. A plan gains a `Started:` record,
#     an annotation, a Notes paragraph on nearly every commit; the state line
#     travels along in the diff hunk and is not what changed.
#   - a file whose `State:` line is deleted or absent on either side. Deleting a
#     plan is not a transition, and this gate must not become the reason a file
#     cannot be removed.
#
# THE OWNERS ARE THREE AND THEY ANNOUNCE THEMSELVES. `plot-approve.sh`,
# `plot-deliver.sh` and `plot-sprint-state.sh` each record a receipt naming the
# file and the value they wrote (plot-state-receipt.sh). The gate clears on a
# match and spends the receipt. The receipt is what makes this a gate: a commit
# message, a branch name and an author are all things an agent types, and a
# receipt is only produced by running the script.
#
# IT NAMES THE ROUTE, WHICH IS plot-phase-gate.sh's PRECEDENT. That gate blocks
# a commit and names the approval that would let it through. This blocks the
# edit and names the command that owns that write — per file, from the value it
# found, so an operator reads the exact line to run rather than a list.
#
# FAIL-OPEN ON ITS OWN MACHINERY, and the split is deliberate. An unreadable
# HEAD, a missing `git`, unparseable hook JSON: the gate cannot see a diff, so
# it allows and says nothing was checked — the phase gate's reasoning, and the
# same blast radius. But a transition it CAN see and finds no receipt for is a
# refusal, because that is the case it exists for.

set -uo pipefail

# --- fail-open guard: any error below → allow ---
trap 'exit 0' ERR

INPUT="$(cat)"
CMD="$(printf '%s' "$INPUT" | jq -r '.tool_input.command // empty' 2>/dev/null)" || exit 0
case "$CMD" in
  *"git commit"*) ;;
  *) exit 0 ;;
esac

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
git rev-parse --show-toplevel >/dev/null 2>&1 || exit 0

# shellcheck source=plot-state-receipt.sh
. "$HERE/plot-state-receipt.sh" 2>/dev/null || exit 0

PLAN_DIR="$(bash "$HERE/plot-config.sh" get "Plan directory" "docs/plans/")"
PLAN_DIR="${PLAN_DIR%/}"
SPRINT_DIR="$(bash "$HERE/plot-config.sh" get "Sprint directory" "docs/sprints/")"
SPRINT_DIR="${SPRINT_DIR%/}"

# The effective commit paths, plot-phase-gate.sh's reading and for its reason: a
# single `git add -A && git commit -m x` stages AFTER this hook ran, so the index
# alone is not what the commit will contain. Conservative in the same direction —
# a pathspec that is a glob or a directory counts everything it could cover.
effective_paths() {
  git diff --cached --name-only 2>/dev/null
  case "$CMD" in
    *" -a "*|*" -a"|*" --all"*|*" -am "*|*" -am"*)
      git diff --name-only 2>/dev/null ;;
  esac
  if [[ "$CMD" == *"git add"* ]]; then
    printf '%s\n' "$CMD" | sed -E 's/&&|;|\|/\n/g' | grep 'git add' | sed 's/.*git add//' \
    | while IFS= read -r segment; do
        for tok in $segment; do
          case "$tok" in
            -A|--all|-a|.|-u|--update)
              git status --porcelain 2>/dev/null | sed 's/^...//' ;;
            -*) ;;
            *) printf '%s\n' "$tok" ;;
          esac
        done
      done
  fi
}

# The `State:` value in a plan or sprint file's `## Status` section.
#
# SCOPED TO THAT SECTION, for the reason plot-approve.sh:358 gives: several
# plans in this repo QUOTE a status block in their prose to document the format,
# and a reader that took the first `State:` anywhere would read the illustration.
# Reads `State:` and `Phase:` alike — `Phase:` is what the field was called
# before 2026-09-07 and plans written then still carry it.
state_value() { # reads a file on stdin, prints the value or nothing
  awk '
    BEGIN { section = "" }
    /^## / { section = ($0 ~ /^## Status/) ? "status" : ""; next }
    section == "status" && tolower($0) ~ /^[ \t]*[-*]?[ \t]*\**(state|phase)[:*]/ {
      line = $0
      sub(/^[^:]*:\**[ \t]*/, "", line)
      sub(/[ \t]*$/, "", line)
      print line
      exit
    }
  '
}

# Is this path a plan or a sprint file? Directory membership only — a plan is
# what lives in the plan directory, which is the same rule plot-plan-meta.sh and
# the reconcile scan apply.
lifecycle_kind() { # $1=path → "plan" | "sprint" | ""
  case "$1" in
    "$PLAN_DIR"/*) printf 'plan\n' ;;
    "$SPRINT_DIR"/*) printf 'sprint\n' ;;
  esac
}

# The command that owns a transition, from the value it lands on. Named per
# file, because "run one of three scripts" is the sentence an operator has to
# translate and this gate exists because a translation went wrong.
owning_command() { # $1=kind $2=slug $3=to-value
  local kind="$1" slug="$2" to="$3"
  local lower
  lower="$(printf '%s' "$to" | tr '[:upper:]' '[:lower:]')"
  if [ "$kind" = "sprint" ]; then
    printf '/plot-sprint %s %s  (or: bash skills/plot/scripts/plot-sprint-state.sh %s %s)\n' \
      "$slug" "$(sprint_verb "$lower")" "$slug" "$to"
    return
  fi
  case "$lower" in
    approved) printf '/plot-approve %s  (or: bash skills/plot/scripts/plot-approve.sh %s)\n' "$slug" "$slug" ;;
    delivered) printf '/plot-deliver %s  (or: bash skills/plot/scripts/plot-deliver.sh %s)\n' "$slug" "$slug" ;;
    *) printf '/plot-approve or /plot-deliver — the plan lifecycle is Draft > Approved > Delivered > Released,\n                    and no command writes '\''%s'\''. If the phase itself is wrong, that is a finding to report.\n' "$to" ;;
  esac
}

# The sprint verb for a state. `/plot-sprint <slug> <verb>` is the skill's own
# spelling; the state word is what plot-sprint-state.sh takes.
sprint_verb() { # $1=lowercase state
  case "$1" in
    committed) printf 'commit\n' ;;
    active) printf 'start\n' ;;
    closed) printf 'close\n' ;;
    *) printf 'commit\n' ;;
  esac
}

# The slug: a plan file is <date>-<slug>.md, a sprint file <week>-<slug>.md.
# Both cut the same way, which is how plot-sprint-state.sh:68 finds a sprint.
slug_of() { # $1=path
  local base="${1##*/}"
  base="${base%.md}"
  printf '%s\n' "${base#*-*-*-}"
}

blocked=0
while IFS= read -r f; do
  [ -n "$f" ] || continue
  kind="$(lifecycle_kind "$f")"
  [ -n "$kind" ] || continue
  [ -f "$f" ] || continue

  # A file with no HEAD version is a CREATION. A plan or sprint written from a
  # template carries its opening state, and that is not a transition.
  before="$(git show "HEAD:$f" 2>/dev/null | state_value)" || before=""
  [ -n "$before" ] || continue

  after="$(state_value <"$f")" || after=""
  [ -n "$after" ] || continue          # a removed State: line is not a transition
  [ "$before" != "$after" ] || continue  # the value did not change

  # An owner announced this exact write.
  receipt_clears "$f" "$after" && continue

  if [ "$blocked" = 0 ]; then
    echo "plot state gate: a lifecycle field has one writer, and this commit is not it." >&2
    blocked=1
  fi
  slug="$(slug_of "$f")"
  echo "" >&2
  echo "  $f" >&2
  echo "    $before -> $after, written by hand." >&2
  echo "    The command that owns this write: $(owning_command "$kind" "$slug" "$after")" >&2
done < <(effective_paths | sort -u)

if [ "$blocked" = 1 ]; then
  echo "" >&2
  echo "Run it, then commit what it wrote. It asks the rule that refuses a transition the" >&2
  echo "lifecycle does not allow — which an editor on a markdown line cannot do, and did not" >&2
  echo "on 2026-09-08, when three states were written wrong in one afternoon." >&2
  echo "" >&2
  echo "If the line is wrong for a reason no command covers, that is a finding to report —" >&2
  echo "a missing transition is the gap this plan says to file rather than work around." >&2
  exit 2
fi

exit 0
