#!/usr/bin/env bash
# Plot helper: register Plot's gates as PreToolUse hooks in the repository's own
# `.claude/settings.json`, or report what is there.
# Usage: plot-install-hooks.sh [--check|--verify]
# Output: one line naming what happened; the outcome word is the exit status.
#
#   written    no Plot gate was registered and ours were installed   (exit 0)
#   current    Plot's gates are already registered                   (exit 0)
#   present    a PreToolUse hook exists and is somebody else's       (exit 3)
#
# `--check` WRITES NOTHING and reports the same words, so /plot-init can ask
# before it acts. The vocabulary is plot-install-commit-record.sh's, borrowed
# verbatim: a second set of words for the same three answers is the drift this
# estate has already paid for.
#
# `--verify` WRITES NOTHING EITHER, and reports whether the gates WORK rather
# than whether they are written. The two compose: `--check` reports what IS,
# `--verify` reports what FIRES.
#
#   verified     every gate that can be proved refused when it should  (exit 0)
#   unverified   at least one gate was not proved to fire              (exit 3)
#
# THE WRITTEN FILE IS NOT THE EVIDENCE — THE BLOCK IS. plot-state-gate.sh
# shipped 2026-09-09 registered in `hooks/hooks.json`, and no plugin release
# ever carried it: 2.15.0, 2.14.0 and 2.10.0 each register plot-phase-gate.sh
# alone. The gate CLAUDE.md documents as closing four measured hand edits had
# therefore never enforced anything on any machine, including the one that
# wrote it. Nobody noticed, because a missing gate does not error — it permits.
#
# WHY GREPPING THE SETTINGS FILE WOULD NOT DO. That is the claim, not the
# proof; it is what the install half already knows. An installer that writes a
# file and reports success reproduces the measured state exactly — a repository
# believing it is gated, finding out when a guarded write lands unguarded.
#
# EXIT 0 IS AMBIGUOUS, WHICH KILLS THE OBVIOUS DESIGN. Measured 2026-09-09 by
# running plot-state-gate.sh directly, three outcomes collapse into two codes:
#
#   the gate was never invoked                        exit 0, empty stderr
#   invoked, fail-open (no git/jq, unreadable HEAD)   exit 0, empty stderr
#   invoked, saw a transition, refused                exit 2, the refusal
#
# The first two are byte-identical, and plot-state-gate.sh:56 is `trap 'exit 0'
# ERR` on purpose. So a verification asking "did my commit succeed?" cannot
# tell an installed gate from an absent one — it would report green on the
# precise repository this exists to fix. Only the refusal is positive evidence,
# and it is read from exit 2, not inferred from an absence.
#
# EXIT 2 IS THE CONTRACT AND THE STRING IS CORROBORATION. The wording is the
# gate's to reword; a test pinning prose a gate legitimately rewrites fails for
# the wrong reason.
#
# WHY THIS EXISTS. `hooks/hooks.json` ships with the plugin and every path in it
# is `${CLAUDE_PLUGIN_ROOT}`-relative, which resolves to nothing outside a
# plugin install. A repository that vendors the skills, or clones this repo,
# gets NO GATES AT ALL and nothing says so. A missing gate does not error — it
# permits, and the first evidence is a plan whose phase disagrees with its
# record.
#
# THE ROUTE IS MEASURED, NOT ASSUMED. Measured 2026-09-10 in this repository:
# a `PreToolUse` hook registered from `.claude/settings.json` FIRES; a
# repo-relative command resolves, with the hook's `pwd` at the repository root;
# and two hooks on one matcher BOTH run rather than one shadowing the other.
# That last one is why the duplicate rule below is a correctness constraint and
# not a tidiness preference.
#
# THE GATE SET IS READ, NEVER HARDCODED. `hooks/hooks.json` is the source of
# which gates exist — it carried two when this was planned and three when it was
# built (`plot-controller-gate.sh` landed in between). An installer naming its
# gates in its own body ships a repository missing whichever one came last.
#
# A PLUGIN-REGISTERED GATE REPORTS `current` AND ADDS NOTHING, and this is the
# one property that is correctness rather than style. plot-state-receipt.sh's
# `receipt_clears` compares the recorded value and then REMOVES the receipt, so
# one approval licenses exactly one commit. Two registrations of the state gate
# means the first reader spends the receipt and the second finds it spent — and
# refuses a write that was properly owned. The phase gate is idempotent and
# would survive a duplicate; the state gate would not. Which registration fires
# first is not this script's to control, so the duplicate is prevented by never
# creating it. Matching is on the SCRIPT BASENAME, because the plugin's
# `${CLAUDE_PLUGIN_ROOT}/...` entry and a repo-relative one are textually
# different and are the same gate.
#
# NOTHING IS EVER OVERWRITTEN. A repository may run its own `PreToolUse` hooks
# for its own reasons, and this cannot tell an important one from an abandoned
# one. `present` reports, names the entries to add, keeps the rest, exits 3 —
# plot-install-commit-record.sh's rule and plot-install-prompt.sh's alike.

set -uo pipefail

check_only=0
verify_only=0
case "${1:-}" in
  --check) check_only=1 ;;
  --verify) verify_only=1 ;;
esac

script_dir=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)

root=$(git rev-parse --show-toplevel 2>/dev/null) || {
  echo "plot-install-hooks: not a git repository" >&2
  exit 1
}

# The gate set comes from the shipped hooks.json. Walking up from the script
# rather than assuming a layout: `skills/plot/scripts` is three below the root
# of a checkout, but a vendored copy may sit anywhere.
hooks_json=""
for candidate in \
  "$script_dir/../../../hooks/hooks.json" \
  "$root/hooks/hooks.json"
do
  [ -f "$candidate" ] && { hooks_json="$candidate"; break; }
done

if [ -z "$hooks_json" ]; then
  echo "plot-install-hooks: no hooks/hooks.json found — nothing to install" >&2
  exit 1
fi

command -v jq >/dev/null 2>&1 || {
  echo "plot-install-hooks: jq is required" >&2
  exit 1
}

# Every gate the shipped file registers on Bash PreToolUse, as basenames.
gates=$(jq -r '
  (.hooks.PreToolUse // [])[]
  | select((.matcher // "") == "Bash")
  | (.hooks // [])[]
  | select((.type // "") == "command")
  | .command
' "$hooks_json" 2>/dev/null | sed 's#.*/##; s/"$//' | sort -u)

if [ -z "$gates" ]; then
  echo "plot-install-hooks: hooks/hooks.json registers no Bash PreToolUse gate" >&2
  exit 1
fi

settings="$root/.claude/settings.json"

# The command a repository registers: repo-relative, because the hook's working
# directory is the project root (measured) and an absolute path breaks the
# moment the clone moves.
gate_command() {
  printf '"$CLAUDE_PROJECT_DIR"/skills/plot/scripts/%s' "$1"
}

# --- read what is already registered -----------------------------------------
existing_bash_hooks=""
if [ -f "$settings" ]; then
  if ! jq -e . "$settings" >/dev/null 2>&1; then
    echo "present — $settings is not valid JSON; Plot did not touch it. Add these to .hooks.PreToolUse, matcher \"Bash\", and keep the rest:" >&2
    while IFS= read -r g; do [ -n "$g" ] && echo "  $(gate_command "$g")" >&2; done <<< "$gates"
    exit 3
  fi
  existing_bash_hooks=$(jq -r '
    (.hooks.PreToolUse // [])[]
    | select((.matcher // "") == "Bash")
    | (.hooks // [])[]
    | .command // empty
  ' "$settings" 2>/dev/null)
fi

# --- verification -------------------------------------------------------------
# Constructs a guarded condition per gate, in a scratch repository, and requires
# the refusal. Nothing here touches the operator's tree.
if [ "$verify_only" = 1 ]; then
  # THE TEARDOWN IS WHY THIS IS A TRAP AND NOT A TRAILING `rm`.
  # plot-board-verify.sh's argument, verbatim in kind: "always clean up" is a
  # rule the writer can believe they followed, and the path that forgets it is
  # the assertion failure — which here is the EXPECTED outcome on an unverified
  # install. `trap ... EXIT` is the gate; the shell runs it on every exit path.
  scratch=""
  cleanup() { [ -n "$scratch" ] && rm -rf "$scratch" 2>/dev/null; return 0; }
  trap cleanup EXIT INT TERM

  scratch="$(mktemp -d 2>/dev/null)" || {
    echo "unverified — no scratch directory could be made; no gate was proved" >&2
    exit 3
  }

  # A gate is only reachable if it is REGISTERED here. An unregistered gate is
  # the measured failure itself, so it is unverified by definition and the
  # prober is never run — running it would prove the script works and say
  # nothing about this repository, which is the confusion this whole mode
  # exists to prevent.
  registered_here() { # $1=basename
    printf '%s\n' "$existing_bash_hooks" | grep -qF "$1"
  }

  # Where the gate scripts actually live. The registered command is
  # repo-relative by construction (gate_command), but a plugin-registered entry
  # is ${CLAUDE_PLUGIN_ROOT}-rooted, so the script beside THIS one is the
  # reading that works for both.
  gate_path() { printf '%s/%s' "$script_dir" "$1"; }

  # A scratch git repo. Fresh per probe, because a spent receipt and a staged
  # index both leak between cases.
  new_scratch_repo() { # prints a path
    local d
    d="$scratch/r$RANDOM$$"
    mkdir -p "$d" || return 1
    git -C "$d" init -q -b main >/dev/null 2>&1 || return 1
    git -C "$d" config user.email plot@verify >/dev/null 2>&1
    git -C "$d" config user.name plot-verify >/dev/null 2>&1
    git -C "$d" config commit.gpgsign false >/dev/null 2>&1
    printf '%s' "$d"
  }

  # Drive a gate the way Claude Code does: hook JSON on stdin, in a cwd.
  drive_gate() { # $1=gate path $2=cwd $3=command → exit code, stderr on fd 2
    printf '{"tool_input":{"command":%s}}' "$(jq -Rn --arg c "$3" '$c')" \
      | (cd "$2" && bash "$1") 2>"$scratch/stderr.$$"
  }

  # --- the probers ---
  # Each builds a condition its gate CANNOT fail open on: a real repo, real git,
  # real jq, a real staged transition. Anything short of that returns 0 and
  # proves nothing.

  probe_state_gate() { # $1=gate path → 0 refused, 1 permitted, 2 unprobeable
    local d
    d="$(new_scratch_repo)" || return 2
    mkdir -p "$d/docs/plans" || return 2
    printf '# P\n\n## Status\n\n- **State:** Draft\n- **Type:** feature\n' \
      > "$d/docs/plans/2026-01-01-verify.md" || return 2
    git -C "$d" add -A >/dev/null 2>&1 || return 2
    git -C "$d" commit -qm init >/dev/null 2>&1 || return 2
    # The transition: a HEAD version exists, the staged value differs, and no
    # receipt was recorded. That is the case the gate exists for.
    printf '# P\n\n## Status\n\n- **State:** Approved\n- **Type:** feature\n' \
      > "$d/docs/plans/2026-01-01-verify.md" || return 2
    git -C "$d" add -A >/dev/null 2>&1 || return 2
    drive_gate "$1" "$d" "git commit -m x"
    [ "$?" = 2 ] && return 0
    return 1
  }

  probe_controller_gate() { # $1=gate path → 0 refused, 1 permitted, 2 unprobeable
    local d
    d="$(new_scratch_repo)" || return 2
    # Measured: without .plot/state/ this gate reports its own UNVERIFIED and
    # exits 0. The directory is part of the condition, not a nicety.
    mkdir -p "$d/.plot/state" || return 2
    drive_gate "$1" "$d" "bash skills/plot/scripts/plot-dispatch.sh a-slug"
    [ "$?" = 2 ] && return 0
    return 1
  }

  # PROBER OR NONE, AND A MISSING ONE IS REPORTED RATHER THAN GUESSED AT.
  # plot-phase-gate.sh reads the plan from origin/<main> — an approval nobody
  # else can see is not one — so proving it needs a remote a scratch repo does
  # not have. That gate reports `unverified` with the reason, which is an
  # honest answer. Inventing a weaker condition to win a green tick would prove
  # the verification, not the gate.
  probe_for() { # $1=basename → prints a function name, or nothing
    case "$1" in
      plot-state-gate.sh) printf 'probe_state_gate\n' ;;
      plot-controller-gate.sh) printf 'probe_controller_gate\n' ;;
    esac
  }

  # Why a gate cannot be proved, in its own words, so the report names the
  # obstacle rather than the absence of a prober.
  unprobeable_reason() { # $1=basename
    case "$1" in
      plot-phase-gate.sh)
        printf 'reads the plan from origin/<main>, which a scratch repository has no remote for\n' ;;
      *)
        printf 'no self-contained guarded condition is known for it here\n' ;;
    esac
  }

  verified_count=0
  unverified_count=0
  unprobeable_count=0
  report=""

  while IFS= read -r g; do
    [ -n "$g" ] || continue
    gp="$(gate_path "$g")"

    if ! registered_here "$g"; then
      unverified_count=$((unverified_count + 1))
      report="${report}  unverified  ${g} — not registered in $settings; nothing would invoke it"$'\n'
      continue
    fi

    if [ ! -f "$gp" ]; then
      unverified_count=$((unverified_count + 1))
      report="${report}  unverified  ${g} — registered, but the script is not at $gp"$'\n'
      continue
    fi

    prober="$(probe_for "$g")"
    if [ -z "$prober" ]; then
      unprobeable_count=$((unprobeable_count + 1))
      report="${report}  unprobed    ${g} — $(unprobeable_reason "$g")"$'\n'
      continue
    fi

    "$prober" "$gp"
    case "$?" in
      0)
        verified_count=$((verified_count + 1))
        report="${report}  verified    ${g} — refused a guarded write (exit 2)"$'\n' ;;
      1)
        unverified_count=$((unverified_count + 1))
        report="${report}  unverified  ${g} — did NOT refuse a guarded write; it permitted"$'\n' ;;
      *)
        unprobeable_count=$((unprobeable_count + 1))
        report="${report}  unprobed    ${g} — the condition could not be built here"$'\n' ;;
    esac
  done <<< "$gates"

  # --- THE VERDICT ---
  # THREE WORDS, NOT TWO, AND THE THIRD IS LOAD-BEARING. plot-board-probe.sh's
  # ok/failed/unknown, for its reason: an unrecognised output reads as CANNOT
  # VERIFY, never as authenticated. A gate nothing here can construct a
  # condition for is unknown, and folding it into `unverified` would report a
  # correctly and completely installed repository as unproved on every run,
  # forever — plot-phase-gate.sh needs a remote and a scratch repo has none. A
  # verdict that is red on a perfect install is one operators learn to ignore,
  # which is how a gate nobody trusts fails.
  #
  # WHAT IS NEVER FOLDED IN. A gate that is registered and PERMITTED, and a
  # gate that is not registered at all, are failures and stay failures — those
  # are the measured bug this mode exists to catch, and calling either one
  # `unknown` would ship it.
  #
  # SO SUCCESS STILL NAMES THE UNKNOWNS. The unprobed gates print on the
  # verified path too; `verified` here means "nothing failed", not "everything
  # was proved", and the report says which is which.
  if [ "$unverified_count" = 0 ] && [ "$verified_count" -gt 0 ]; then
    if [ "$unprobeable_count" -gt 0 ]; then
      echo "verified — ${verified_count} gate(s) refused a guarded write; ${unprobeable_count} could not be proved here:"
    else
      echo "verified — every registered gate refused a guarded write:"
    fi
    printf '%s' "$report"
    exit 0
  fi

  # No gate failed, and none could be proved either. That is not success: it is
  # the fail-open case with nothing behind it, and it must not read as one.
  if [ "$unverified_count" = 0 ] && [ "$verified_count" = 0 ]; then
    echo "unverified — no gate could be proved here; nothing was demonstrated to fire:" >&2
    printf '%s' "$report" >&2
    exit 3
  fi

  # UNVERIFIED IS NEVER INSTALLED. plot-phase-gate.sh's own precedent: it allows
  # a commit it cannot check and SAYS the phase went unverified — failing open,
  # not failing silently. plot-board-probe.sh draws the same line with
  # ok/failed/unknown, where an unrecognised output reads as cannot-verify and
  # never as authenticated.
  echo "unverified — ${verified_count} gate(s) proved, ${unverified_count} FAILED, ${unprobeable_count} unprovable here:" >&2
  printf '%s' "$report" >&2
  exit 3
fi




# Which of our gates are already reachable, matched on basename so a
# plugin-rooted entry and a repo-relative one count as the same gate.
missing=""
while IFS= read -r g; do
  [ -n "$g" ] || continue
  if ! printf '%s\n' "$existing_bash_hooks" | grep -qF "$g"; then
    missing="${missing}${g}"$'\n'
  fi
done <<< "$gates"
missing=$(printf '%s' "$missing" | sed '/^$/d')

if [ -z "$missing" ]; then
  echo "current — $settings registers Plot's gates: $(printf '%s' "$gates" | tr '\n' ' ')"
  exit 0
fi

# A foreign PreToolUse hook is somebody else's file. Report and keep it.
foreign=$(printf '%s\n' "$existing_bash_hooks" | sed '/^$/d' | grep -v 'plot-.*-gate\.sh' || true)
if [ -n "$foreign" ]; then
  echo "present — $settings runs PreToolUse hooks that are not Plot's; add these beside them, and keep the rest:" >&2
  while IFS= read -r g; do [ -n "$g" ] && echo "  $(gate_command "$g")" >&2; done <<< "$missing"
  exit 3
fi

if [ "$check_only" = 1 ]; then
  echo "absent — $settings would register: $(printf '%s' "$missing" | tr '\n' ' ')"
  exit 3
fi

# --- write --------------------------------------------------------------------
mkdir -p "$root/.claude" 2>/dev/null || {
  echo "plot-install-hooks: cannot create $root/.claude — nothing written" >&2
  exit 1
}

# Build the entries to add, then merge. An existing file keeps every key it has:
# the Bash matcher's hook list gains ours and loses nothing.
additions=$(printf '%s\n' "$missing" | sed '/^$/d' | while IFS= read -r g; do
  jq -n --arg cmd "$(gate_command "$g")" '{type:"command", command:$cmd}'
done | jq -s '.')

base='{}'
[ -f "$settings" ] && base=$(cat "$settings")

merged=$(printf '%s' "$base" | jq --argjson add "$additions" '
  .hooks //= {}
  | .hooks.PreToolUse //= []
  | if any(.hooks.PreToolUse[]; (.matcher // "") == "Bash")
    then .hooks.PreToolUse |= map(
           if (.matcher // "") == "Bash"
           then .hooks = ((.hooks // []) + $add)
           else . end)
    else .hooks.PreToolUse += [{matcher: "Bash", hooks: $add}]
    end
') || {
  echo "plot-install-hooks: could not merge into $settings — nothing written" >&2
  exit 1
}

# Written through a scratch file and moved into place, so a failure partway
# leaves the settings file that was found rather than half of one.
tmp="$settings.plot-tmp.$$"
printf '%s\n' "$merged" > "$tmp" 2>/dev/null || {
  echo "plot-install-hooks: cannot write $settings — nothing written" >&2
  rm -f "$tmp" 2>/dev/null
  exit 1
}
mv "$tmp" "$settings" 2>/dev/null || {
  echo "plot-install-hooks: cannot replace $settings — nothing written" >&2
  rm -f "$tmp" 2>/dev/null
  exit 1
}

echo "written — $settings registers: $(printf '%s' "$missing" | tr '\n' ' ')"
exit 0
