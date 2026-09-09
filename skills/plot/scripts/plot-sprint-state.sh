#!/usr/bin/env bash
# The mechanical half of moving a sprint through its lifecycle: ask the domain
# for the transition, then perform the write it decided.
#
#   plot-sprint-state.sh <slug> <state> [--on YYYY-MM-DD] [--dir <sprint dir>]
#   plot-sprint-state.sh --states
#
# THE DOMAIN DECIDES, THIS PERFORMS. `setSprintState` names nine refusals and
# had no caller outside its own test file until 2026-09-09. Measured 2026-09-08:
# a master agent wrote `State: Planned` into a sprint file with `sed`, made the
# symlink with `ln -s`, and activated a sprint whose nine items nothing could
# parse — while `state-unrecognised`, `commitment-empty` and `state-unreachable`
# sat exported and silent. Every one of the three would have fired here.
#
# A REFUSAL IS PRINTED, NOT SWALLOWED. Each of the nine carries its own sentence
# and this prints it whole: a caller reporting "could not start sprint" throws
# away the half a person acts on.
#
# THE PHASE WORD COMES FROM THE SCHEMA. `--states` asks the bundle for the four,
# so a skill listing them does not hardcode a fifth.
#
# IT WRITES ONLY WHAT THE DOMAIN DECIDED, and never on a refusal: the file is
# replaced by one `mv` from a scratch copy, so a sprint that was refused is the
# sprint that was found. It commits nothing and pushes nothing — the caller owns
# the commit, the way /plot-sprint's steps already do.
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
bundle="$script_dir/board/plot-sprint-transition.mjs"

# The receipt this script leaves for plot-state-gate.sh, which refuses every
# other writer of a `State:` line. Sourced rather than run: the gate and the
# three owning scripts must agree on where a receipt lives, and one file is how.
# shellcheck source=plot-state-receipt.sh
. "$script_dir/plot-state-receipt.sh"

usage() {
  echo "usage: plot-sprint-state.sh <slug> <state> [--on YYYY-MM-DD] [--dir <sprint dir>]" >&2
  echo "       plot-sprint-state.sh --states" >&2
}

# ALL 15 BUNDLES ARE TRACKED IN GIT, so this refusal fires on a broken
# installation and never on a normal run — which is where naming the build
# command is exactly right.
[ -f "$bundle" ] \
  || { echo "plot-sprint-state: cannot find $bundle — run 'pnpm build:board'." >&2; exit 1; }

if [ "${1:-}" = "--states" ]; then
  exec node "$bundle" --states
fi

slug="${1:-}"
state="${2:-}"
[ -n "$slug" ] && [ -n "$state" ] || { usage; exit 2; }
shift 2

on=""
sprint_dir=""
while [ $# -gt 0 ]; do
  case "$1" in
    --on) on="${2:-}"; shift 2 ;;
    --dir) sprint_dir="${2:-}"; shift 2 ;;
    *) usage; exit 2 ;;
  esac
done

repo_root="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
if [ -z "$sprint_dir" ]; then
  sprint_dir="$(bash "$script_dir/plot-config.sh" get "Sprint directory" "docs/sprints")"
fi
case "$sprint_dir" in /*) ;; *) sprint_dir="$repo_root/$sprint_dir" ;; esac

# The slug is the filename without its week prefix — the identity
# `parseSprintContent` cuts the same way. A slug matching more than one file is
# refused rather than resolved by date: two sprints sharing a slug is a
# collision the estate must fix, and picking one would hide it.
matches=$(find "$sprint_dir" -maxdepth 1 -name "*-${slug}.md" -not -path '*/active/*' 2>/dev/null | sort)
count=$(printf '%s' "$matches" | grep -c . || true)
if [ "$count" -eq 0 ]; then
  echo "plot-sprint-state: no sprint file for '$slug' under $sprint_dir" >&2
  exit 1
fi
if [ "$count" -gt 1 ]; then
  echo "plot-sprint-state: '$slug' names $count files — a slug carries its own week and must be unique:" >&2
  printf '%s\n' "$matches" >&2
  exit 1
fi
file="$matches"

# ASK THE DOMAIN. The header is one line and the file follows it whole, so a
# sprint carrying tabs or its own `## Status` block travels unescaped.
set +e
answer=$(printf '%s\t%s\t%s\n' "$state" "$on" "$slug" | cat - "$file" | node "$bundle" 2>&1)
rc=$?
set -e

# Exit 1 is the domain's refusal: the rule that fired, a tab, and its sentence.
# Exit 2 is this script handing the bundle something unreadable, which no
# operator can act on — so it reports as the bug it is.
if [ "$rc" != 0 ]; then
  if [ "$rc" = 1 ]; then
    echo "plot-sprint-state: $(printf '%s' "$answer" | cut -f2-)" >&2
  else
    echo "plot-sprint-state: $answer" >&2
  fi
  exit 1
fi

decided_state=$(printf '%s' "$answer" | cut -f1)
decided_end=$(printf '%s' "$answer" | cut -f2)

# PERFORM THE WRITE THE DOMAIN DECIDED, against a scratch copy replaced by one
# `mv`. The awk that knows where a `## Status` line lives stays here, because
# that is adaptation — the same split `plot-approve.sh` draws.
tmp="$file.plot-state"
awk -v want="$decided_state" -v ended="$decided_end" '
  BEGIN { section = ""; done = 0; wrote_end = 0 }
  /^## / { section = ($0 ~ /^## Status/) ? "status" : ""; }
  # The state line, in either spelling: `State:` is what a sprint file carries,
  # `Phase:` is what it was called before 2026-09-07, and both are found.
  section == "status" && !done && tolower($0) ~ /^[ \t]*[-*][ \t]*\**(state|phase)[:*]/ {
    sub(/(State|Phase):\*\*[ \t]*.*$/, "State:** " want)
    done = 1
    print
    next
  }
  # The close date, recorded beside the state. An existing line is replaced so
  # re-running writes one record rather than a second.
  section == "status" && ended != "" && tolower($0) ~ /^[ \t]*[-*][ \t]*\**actual end[:*]/ {
    print "- **Actual End:** " ended
    wrote_end = 1
    next
  }
  { print }
  END { exit (done ? (ended != "" && !wrote_end ? 3 : 0) : 1) }
' "$file" > "$tmp" && awk_rc=0 || awk_rc=$?

if [ "${awk_rc:-0}" = 1 ]; then
  rm -f "$tmp"
  echo "plot-sprint-state: $file has no '- **State:**' line in its '## Status' section — nowhere to write the transition." >&2
  exit 1
fi

# A close whose date had no line to land in gets one appended after the state,
# so the phase and its record are still ONE write. The domain's `Decision`
# requires both; a state flipped without its date is the half-state
# `plot-approve.sh` records as having made a plan invisible to the scan.
if [ "${awk_rc:-0}" = 3 ]; then
  awk -v ended="$decided_end" '
    BEGIN { section = ""; placed = 0 }
    /^## / { section = ($0 ~ /^## Status/) ? "status" : "" }
    { print }
    section == "status" && !placed && tolower($0) ~ /^[ \t]*[-*][ \t]*\**state[:*]/ {
      print "- **Actual End:** " ended
      placed = 1
    }
    END { exit (placed ? 0 : 1) }
  ' "$tmp" > "$tmp.end" || {
    rm -f "$tmp" "$tmp.end"
    echo "plot-sprint-state: could not record the close date in $file" >&2
    exit 1
  }
  mv "$tmp.end" "$tmp"
fi

[ -s "$tmp" ] || { rm -f "$tmp"; echo "plot-sprint-state: could not read $file" >&2; exit 1; }
mv "$tmp" "$file"

# The receipt plot-state-gate.sh clears on. Recorded after the `mv`, so it names
# a value the file actually carries — and never on a refusal, where the `mv`
# above is not reached and the sprint that was refused is the sprint that was
# found.
record_state_receipt "$file" "$decided_state"

# The active symlink follows the state rather than being a second decision.
# `ln -s` by hand is one of the three moves measured on 2026-09-08.
active_dir="$sprint_dir/active"
link="$active_dir/$slug.md"
if [ "$decided_state" = "Active" ]; then
  mkdir -p "$active_dir"
  ln -sfn "../$(basename "$file")" "$link"
elif [ "$decided_state" = "Closed" ]; then
  rm -f "$link"
fi

printf '%s\t%s\t%s\n' "$slug" "$decided_state" "$decided_end"
