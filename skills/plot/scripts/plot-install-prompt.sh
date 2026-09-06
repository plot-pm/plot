#!/usr/bin/env bash
# Plot helper: install `.plot/worker-prompt.sh` from the shipped template, or
# report that an existing one is out of date.
# Usage: plot-install-prompt.sh [--check]
# Output: one line naming what happened; the outcome word is the exit status.
#
#   written    the file was absent and the template was copied      (exit 0)
#   current    a file exists and already interpolates the flag      (exit 0)
#   stale      a file exists and hardcodes the session flag         (exit 3)
#   present    a file exists and passes no session arguments at all (exit 3)
#
# `--check` writes nothing and reports the same words, so /plot-init can ask
# before it acts and a hook can gate on the answer.
#
# NOTHING IS EVER OVERWRITTEN. The wording of a prompt file is the adopting
# project's — plot-worker-loop.sh:19 settles that — and this script has no way
# to tell a project's own instructions from a template nobody edited. So a
# stale file is REPORTED and the caller offers the update; /plot-init's own
# guiding rule is "propose, don't interrogate", and every field its probe
# reports is a proposal a human confirms.
#
# `stale` IS THE ONE THING WORTH DETECTING, and it is detected by what the file
# PASSES rather than by comparing it to the template. A project that rewrote
# every word is not out of date; a project whose invocation reads
# `--session-id "$PLOT_SESSION_ID"` is, because that hardcodes a decision the
# loop makes. Measured 2026-09-05: that exact line failed three agents' second
# slices at once, and this repo's own copy — written by hand, edited twice
# since — is the file no release note would have reached.
#
# `present` IS NOT A FAULT. A prompt file that passes no session arguments runs
# exactly as it always has: the transcript is unattributable, resume reports
# itself unavailable, and a fresh worker is started. Plot requires neither flag
# and says so in the loop's header. It is reported so an operator can see the
# capability is off, and it shares `stale`'s exit status because both are
# answers a person may want to act on.

set -uo pipefail

check_only=0
[ "${1:-}" = "--check" ] && check_only=1

script_dir=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
template="$script_dir/../templates/worker-prompt.sh"

root=$(git rev-parse --show-toplevel 2>/dev/null) || root="$PWD"

# The template is overridable by the same key shape the plan template uses, so
# a project that wants different starting wording ships its own.
configured=$("$script_dir/plot-config.sh" get "Worker prompt template" "")
if [ -n "$configured" ]; then
  case "$configured" in
    /*) template="$configured" ;;
    *)  template="$root/$configured" ;;
  esac
fi

target="$root/.plot/worker-prompt.sh"

if [ ! -f "$template" ]; then
  echo "plot-install-prompt: no template at $template" >&2
  exit 1
fi

if [ ! -f "$target" ]; then
  if [ "$check_only" = 1 ]; then
    echo "absent — $target would be written from $template"
    exit 3
  fi
  mkdir -p "$root/.plot" || exit 1
  cp "$template" "$target" || exit 1
  chmod +x "$target" 2>/dev/null
  echo "written — $target from $template"
  exit 0
fi

# An existing file: read what it passes, and never touch it.
if grep -q 'PLOT_SESSION_FLAG' "$target"; then
  echo "current — $target interpolates PLOT_SESSION_FLAG"
  exit 0
fi

if grep -qE -- '--session-id|--resume' "$target"; then
  echo "stale — $target hardcodes a session flag; the loop decides it. Offer the template at $template, and keep the project's wording." >&2
  exit 3
fi

echo "present — $target passes no session arguments; resume stays unavailable and a fresh worker is started each time. The template at $template shows the pair." >&2
exit 3
