#!/usr/bin/env bash
# The receipt a lifecycle write leaves behind, and the ONE place it is written
# and read — sourced, not run, by the scripts that own a `State:` line and by
# `plot-state-gate.sh`, which refuses every other writer.
#
#   record_state_receipt <path> <value>   # the owning script, after its write
#   receipt_clears <path> <value>         # the gate, before it refuses
#
# IT IS ALSO RUNNABLE, and that is the named escape:
#
#   plot-state-receipt.sh --unowned <path> <value> <reason>
#
# for the three writes that have NO owning script today. `/plot-approve` step 3b
# writes the phase by hand under `Review: in-session` and `Review: ballot` —
# `plot-approve.sh:190` refuses both by name, because a script cannot stand in
# for a human reviewer or read a ballot. `/plot-release` writes `State:
# Released`, and `/plot-reject` writes Delivered -> Approved; `setPlanPhase`
# does not exist, so neither has a script to route to.
#
# A GATE WITH NO EXIT IS ONE PEOPLE ROUTE AROUND — `plot-dispatch.sh`'s
# `--allow-local` in the same tradition, and the reason this slice waited at all:
# a gate refusing the only available method stops work rather than routing it.
#
# THE ESCAPE IS COUNTABLE, WHICH IS THE POINT. The reason is required and it is
# recorded, so each use is a line naming a routing gap the later slices of
# `the-master-agent-uses-the-controllers` close: `/plot-reject` becomes a
# controller command, `/plot-release` asks a controller for its verdict. When
# those land, their scripts record their own receipts and the escape stops being
# reached for. Until then it is the difference between a gap that is visible and
# a gate that is turned off.
#
# WHY A RECEIPT RATHER THAN A COMMIT MESSAGE. `plot-state-gate.sh` sees a
# `git commit`, and every fact reachable from there — the message, the branch,
# the author — is one an agent types. A receipt is not: it names the file and
# the value the owning script decided, and the only way to produce a matching
# one is to have run that script. That is the difference between a gate and a
# rule, and this whole plan exists because a rule was walked past three times in
# one afternoon.
#
# WHAT IT DOES NOT PROVE. The receipt says *this value was written here by an
# owner*; it does not say the working tree still holds only that write. An agent
# that runs `/plot-approve` and then edits the same line again inside the same
# commit is not caught, and no receipt could catch it — the gate reads the
# staged value, so a second edit changes the value and the receipt stops
# matching. Only a re-write to the SAME value would pass, and that write is a
# no-op.
#
# MACHINE-LOCAL AND UNTRACKED. `.plot/state/` is gitignored for the reason
# `plot-boardctl.sh:83` gives: a receipt is true on the machine that made it,
# and a receipt travelling in a commit would clear the gate on every other
# checkout that pulled it.
#
# A RECEIPT IS SPENT WHEN IT CLEARS. `receipt_clears` deletes the one it
# matched, so a single `/plot-approve` licenses a single commit. Leaving it
# would let one approval clear a `sed` over the same line a week later.
#
# IT FAILS TOWARD REFUSING, and that is the opposite of `plot-phase-gate.sh`'s
# choice, deliberately: an unwritable state directory means no receipt exists,
# so `receipt_clears` answers false and the gate refuses with the command to
# run. The blast radius is one commit an operator repeats through the owning
# script, against a phase gate whose refusal would cost every commit in the
# repository.

# Where receipts live. One file per receipt, named by a hash of the path, so two
# lifecycle writes in one session never overwrite each other.
_receipt_dir() {
  local root
  root="$(git rev-parse --show-toplevel 2>/dev/null)" || return 1
  printf '%s\n' "$root/.plot/state/state-receipts"
}

# The receipt's identity is the repo-relative path. Hashed rather than
# flattened: a path is not a filename, and `docs/plans/x.md` and `docs-plans/x.md`
# must not collide.
_receipt_file() { # $1=repo-relative path
  local dir
  dir="$(_receipt_dir)" || return 1
  printf '%s/%s\n' "$dir" "$(printf '%s' "$1" | git hash-object --stdin 2>/dev/null)"
}

# $1 = path (absolute or relative), $2 = the value written.
record_state_receipt() {
  local path="$1" value="$2" root rel file
  root="$(git rev-parse --show-toplevel 2>/dev/null)" || return 0
  rel="$(_repo_relative "$path" "$root")" || return 0
  file="$(_receipt_file "$rel")" || return 0
  mkdir -p "$(dirname "$file")" 2>/dev/null || return 0
  printf '%s\t%s\n' "$rel" "$value" > "$file" 2>/dev/null || return 0
  return 0
}

# $1 = repo-relative path, $2 = the staged value. Prints nothing; exit 0 means
# an owner wrote exactly this, and the receipt is spent.
receipt_clears() {
  local rel="$1" value="$2" file recorded
  file="$(_receipt_file "$rel")" || return 1
  [ -f "$file" ] || return 1
  recorded="$(cut -f2 <"$file" 2>/dev/null)" || return 1
  [ "$recorded" = "$value" ] || return 1
  rm -f "$file" 2>/dev/null
  return 0
}

# A path as git names it. `git rev-parse` is not used: the file may be a scratch
# copy that has already been `mv`ed, and this must work on a path alone.
_repo_relative() { # $1=path $2=root
  local path="$1" root="$2" dir base
  case "$path" in
    /*) ;;
    *) path="$PWD/$path" ;;
  esac
  dir="$(cd "$(dirname "$path")" 2>/dev/null && pwd -P)" || return 1
  base="$(basename "$path")"
  root="$(cd "$root" 2>/dev/null && pwd -P)" || return 1
  case "$dir" in
    "$root") printf '%s\n' "$base" ;;
    "$root"/*) printf '%s/%s\n' "${dir#"$root"/}" "$base" ;;
    *) return 1 ;;
  esac
}

# --- the ACTION receipt: the controller's, one layer earlier ------------------
#
# The same instrument aimed at a different question. A state receipt answers
# *did an owning script write this value?*; an action receipt answers *did a
# controller authorise this script running at all?*
#
#   record_action_receipt <script> <subject>   # the endpoint, before it spawns
#   action_receipt_clears <script>             # the gate, before it refuses
#   spend_action_receipt <script>              # the script, on its own exit 0
#
# ONLY THE CONTROLLER CAN LEAVE ONE, because only the controller runs before the
# script does. That is the whole property: `/api/dispatch` and a hand-typed
# `bash plot-dispatch.sh <slug>` are byte-identical at the command line, and no
# grep separates them. A receipt is not something the caller types.
#
# IT IS SPENT ON THE ACTION COMPLETING, NOT ON THE GATE CLEARING, and that is a
# DELIBERATE DIFFERENCE from `receipt_clears` above. `plot-approve.sh` and
# `plot-deliver.sh` are documented idempotent precisely because their
# irreversible step is a host write: *"re-running is the repair for any
# interruption after it"*. A receipt spent at the gate would refuse that repair,
# turning the documented fix into a second controller call — and the operator
# most likely to need it is the one whose first run died halfway. So the gate
# clearing LEAVES the receipt, the script's own successful exit spends it, and a
# failed run is retried on the same licence.
#
# THE SUBJECT IS RECORDED AND NOT MATCHED ON. It is the slug the controller
# named, kept so an operator reading the file learns which action was licensed.
# The gate matches on the SCRIPT alone: `/api/dispatch` names a plan slug and
# `plot-dispatch.sh` fans out to branches, so a gate comparing the two words
# would refuse the controller's own call. Matching what the caller typed against
# what the endpoint meant is a second rule, and this file holds none.

# Where action receipts live — beside the state receipts, and machine-local for
# the same reason: one travelling in a commit would clear the gate on every
# checkout that pulled it.
_action_receipt_dir() {
  local root
  root="$(git rev-parse --show-toplevel 2>/dev/null)" || return 1
  printf '%s\n' "$root/.plot/state/action-receipts"
}

# NAMED BY THE ACTION, not by the script. The board writes these too, and
# `scripts/check-script-names.sh` refuses a `plot-*.sh` literal outside an
# adapter — a script name in a controller is a boundary crossing no spawn
# counter can see. So the shared filename is the action word, and mapping a
# script back to it happens HERE, on the side that reads command lines.
_action_of() { # $1=script name or action word → the action, or nothing
  case "${1##*/}" in
    plot-dispatch.sh|dispatch) printf 'dispatch\n' ;;
    plot-approve.sh|approve)   printf 'approve\n' ;;
    plot-deliver.sh|deliver)   printf 'deliver\n' ;;
  esac
}

_action_receipt_file() { # $1=script name or action word
  local dir action
  dir="$(_action_receipt_dir)" || return 1
  action="$(_action_of "$1")" || return 1
  [ -n "$action" ] || return 1
  printf '%s/%s\n' "$dir" "$action"
}

# $1 = the script the controller is about to run, $2 = what it is running it on.
# Called by the controller endpoint immediately before it spawns.
record_action_receipt() {
  local action subject="${2:-}" file
  action="$(_action_of "${1:-}")"
  [ -n "$action" ] || return 0
  file="$(_action_receipt_file "$action")" || return 0
  mkdir -p "$(dirname "$file")" 2>/dev/null || return 0
  printf '%s\t%s\t%s\n' "$action" "$subject" "$(date +%FT%T)" > "$file" 2>/dev/null || return 0
  return 0
}

# $1 = the script named on the command line. Exit 0 means a controller
# authorised it. THE RECEIPT IS LEFT IN PLACE — see the spending rule above.
action_receipt_clears() {
  local file
  file="$(_action_receipt_file "${1##*/}")" || return 1
  [ -f "$file" ] || return 1
  return 0
}

# $1 = the script that just finished. Called by the script itself on exit 0, so
# one authorisation licenses one COMPLETED action.
spend_action_receipt() {
  local file
  file="$(_action_receipt_file "${1##*/}")" || return 0
  rm -f "$file" 2>/dev/null
  return 0
}

# --- the named escape, when this file is RUN rather than sourced -------------
#
# Guarded on BASH_SOURCE so sourcing never executes it: the three owning scripts
# source this file and pass no arguments, and a bare `$1` under `set -u` would
# abort them at load.
if [ "${BASH_SOURCE[0]}" = "${0}" ]; then
  set -uo pipefail

  # THE SECOND ESCAPE, for the layer above: a controller-owned ACTION run
  # without a controller, which `plot-controller-gate.sh` refuses. Same shape
  # and same argument as `--unowned` below — the reason is REQUIRED, and each
  # use appends a line to `.plot/state/unowned-action-writes.tsv`, which is the
  # measurement of how large the routing gap still is. An uncounted escape is an
  # off switch.
  if [ "${1:-}" = "--unowned-action" ]; then
    shift
    action_script="${1:-}"; action_subject="${2:-}"; shift 2 2>/dev/null || true
    action_reason="$*"
    if [ -z "$action_script" ] || [ -z "$action_subject" ] || [ -z "$action_reason" ]; then
      echo "plot-state-receipt: --unowned-action needs an action, a subject and a reason." >&2
      echo "  usage: plot-state-receipt.sh --unowned-action <dispatch|approve|deliver> <slug> <reason>" >&2
      echo "" >&2
      echo "  The reason is required because each use names a routing gap, and a gap" >&2
      echo "  nobody wrote down is one nobody closes. Where the board IS running, the" >&2
      echo "  controller is the route and this is not needed." >&2
      exit 2
    fi
    # The action word, or the script name — an operator reaching for this has
    # just read a refusal naming a script, so both spellings are accepted.
    case "$action_script" in
      dispatch|plot-dispatch.sh) action_script="dispatch" ;;
      approve|plot-approve.sh)   action_script="approve" ;;
      deliver|plot-deliver.sh)   action_script="deliver" ;;
      *)
        echo "plot-state-receipt: '$action_script' is not a controller-owned action." >&2
        echo "  The three are: dispatch, approve, deliver." >&2
        exit 2
        ;;
    esac
    record_action_receipt "$action_script" "$action_subject"
    log_root="$(git rev-parse --show-toplevel 2>/dev/null)" || log_root=""
    if [ -n "$log_root" ]; then
      mkdir -p "$log_root/.plot/state" 2>/dev/null || true
      printf '%s\t%s\t%s\t%s\n' "$(date +%F)" "$action_script" "$action_subject" "$action_reason" \
        >> "$log_root/.plot/state/unowned-action-writes.tsv" 2>/dev/null || true
    fi
    echo "plot-state-receipt: recorded an UNOWNED action — $action_script $action_subject"
    echo "  reason: $action_reason"
    echo "  This clears plot-controller-gate.sh for one run of that script. The controller"
    echo "  is still the route: this exists for a machine running no board."
    exit 0
  fi

  if [ "${1:-}" != "--unowned" ]; then
    echo "usage: plot-state-receipt.sh --unowned <path> <value> <reason>" >&2
    echo "       plot-state-receipt.sh --unowned-action <dispatch|approve|deliver> <slug> <reason>" >&2
    echo "" >&2
    echo "The named escape for a lifecycle write with no owning script:" >&2
    echo "  /plot-approve under 'Review: in-session' or 'Review: ballot'" >&2
    echo "  /plot-release writing 'State: Released'" >&2
    echo "  /plot-reject reverting Delivered -> Approved" >&2
    echo "" >&2
    echo "--unowned-action is the other layer: a controller-owned action run with no" >&2
    echo "controller, for a machine running no board." >&2
    echo "" >&2
    echo "Every other State: write has a command that owns it. Use that command." >&2
    exit 2
  fi
  shift
  unowned_path="${1:-}"; unowned_value="${2:-}"; shift 2 2>/dev/null || true
  unowned_reason="$*"
  if [ -z "$unowned_path" ] || [ -z "$unowned_value" ] || [ -z "$unowned_reason" ]; then
    echo "plot-state-receipt: --unowned needs a path, a value and a reason." >&2
    echo "  The reason is required because each use names a routing gap, and a gap" >&2
    echo "  nobody wrote down is one nobody closes." >&2
    exit 2
  fi
  [ -f "$unowned_path" ] || {
    echo "plot-state-receipt: $unowned_path is not a file — the receipt names a write that happened." >&2
    exit 1
  }
  record_state_receipt "$unowned_path" "$unowned_value"
  # The log is the countable half. One line per escape, appended, never rotated
  # here: it is small by construction and the later slices are what shorten it.
  log_root="$(git rev-parse --show-toplevel 2>/dev/null)" || log_root=""
  if [ -n "$log_root" ]; then
    mkdir -p "$log_root/.plot/state" 2>/dev/null || true
    printf '%s\t%s\t%s\t%s\n' "$(date +%F)" "$unowned_path" "$unowned_value" "$unowned_reason" \
      >> "$log_root/.plot/state/unowned-state-writes.tsv" 2>/dev/null || true
  fi
  echo "plot-state-receipt: recorded an UNOWNED write — $unowned_path -> $unowned_value"
  echo "  reason: $unowned_reason"
  echo "  This clears plot-state-gate.sh for one commit. It is a routing gap, not a workflow:"
  echo "  the later slices of the-master-agent-uses-the-controllers give these writes a command."
fi
