#!/usr/bin/env bash
# Plot helper: register Plot's gates as PreToolUse hooks in the repository's own
# `.claude/settings.json`, or report what is there.
# Usage: plot-install-hooks.sh [--check]
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
[ "${1:-}" = "--check" ] && check_only=1

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
