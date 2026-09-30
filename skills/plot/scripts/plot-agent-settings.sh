#!/usr/bin/env bash
# Plot helper: the ONE resolver for the settings file every fleet agent starts with.
# Usage: plot-agent-settings.sh
# Output: the absolute path on stdout, exit 0. Or nothing on stdout, the reason
#         on stderr, exit 3.
#
# Every dispatched agent is a `claude -p` session and inherits every
# `SessionStart` hook the operator's plugins declare. Measured 2026-09-30, one
# such hook — `episodic-memory`'s lockless sync — ran three times at once at
# ~300% CPU each, the 1-minute load reached 195, and the supervisor did not tick
# for 12 minutes. The missing lock is the plugin's defect; the multiplier is
# Plot's, because the fleet starts a session on every worker start, restart,
# retry and hop plus every agent-runner command the board runs.
#
# The `Agent settings` key names a JSON file. This script resolves it, judges it,
# and prints one answer. Every caller acts on that answer and none re-derives it.
#
# THREE ANSWERS, AND THE EXIT CODE IS THE ANSWER:
#
#   exit 0, a path      the file exists, parses, and does not switch the gates
#                       off. The caller passes it to its harness.
#   exit 0, nothing     the key is absent or empty. An adopting project that
#                       sets nothing behaves exactly as today — this is the
#                       default and it is not a refusal.
#   exit 3, nothing     the file is missing, unparseable, or names a setting that
#                       would switch Plot's own gates off. The reason is on
#                       stderr.
#
# READ THE EXIT CODE, NOT STDOUT'S EMPTINESS. Exit 0 with no output and exit 3
# with no output are different answers — *nothing was configured* against
# *something was configured and refused* — and a caller testing only for an
# empty string cannot tell them apart. The distinction is what puts a refusal in
# the log where somebody reads it.
#
# A REFUSAL NEVER STOPS THE FLEET. The caller starts its agent WITHOUT the flag
# and records the reason. A typo in a config key must not be able to stop every
# worker on the machine, and Plot never hands `claude` a path that does not
# exist.
#
# WHAT THE REFUSAL REFUSES is `agentSettingsRefusal`'s to answer, not this
# script's: `enabledPlugins` setting any `plot@…` to `false`, `disableAllHooks:
# true`, or any `env` key. The rule lives in `packages/domain/src/rules/` and is
# asked through `board/plot-agent-settings.mjs`, per *A Shell Script Asks The
# Domain* — this runs once per AGENT START, not once per agent per pass, which is
# the cost rule's permitted case.
#
# IT IS A CHECK AGAINST AN ACCIDENTAL SWITCH-OFF, NOT A BOUNDARY. The file is
# project-owned and reviewed like `CLAUDE.md`, and a project that wants its gates
# off can edit `CLAUDE.md` as easily.

set -uo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

declared="$(bash "$here/plot-config.sh" get "Agent settings" "" 2>/dev/null || echo "")"

# ABSENT OR EMPTY IS NOT A REFUSAL. It is the default, and it is exit 0 with no
# output: a project that configures nothing starts its agents exactly as before.
if [ -z "$declared" ]; then
  exit 0
fi

# A RELATIVE VALUE RESOLVES AGAINST THE MAIN CHECKOUT, the parent of
# `--git-common-dir`, the rule `Board artifact` already follows
# (plot-board-probe.sh:262). `--show-toplevel` names the DESK, and a desk cut
# from an older main may not hold the file — so resolving there would give every
# desk its own answer, or no answer at all. An absolute value is taken as given,
# the way `Worktree root` and `Agent registry` treat theirs.
#
# The KEY itself is still read from the asking tree's CLAUDE.md, so an old desk
# whose CLAUDE.md carries no key starts as today.
case "$declared" in
  /*) path="$declared" ;;
  *)
    common="$(git rev-parse --path-format=absolute --git-common-dir 2>/dev/null || echo "")"
    if [ -n "$common" ]; then
      main_root="$(cd "$common/.." 2>/dev/null && pwd -P)"
    else
      main_root="$(git rev-parse --show-toplevel 2>/dev/null || pwd -P)"
    fi
    path="$main_root/$declared"
    ;;
esac

# A MISSING FILE NAMES THE PATH IT LOOKED FOR. The operator declared a value and
# the answer is where that value pointed — a reason reading "no such file" with
# no path is a reason nobody can act on.
if [ ! -f "$path" ]; then
  printf 'plot-agent-settings: declared "%s" but no file at %s\n' "$declared" "$path" >&2
  exit 3
fi

# THE RULE IS ASKED THROUGH THE BUNDLE, never re-implemented here. A `grep` for
# `plot@` would be a second implementation free to drift the moment the rule
# gains a refusal — and this script and the rule must never disagree about
# whether an agent's gates survive.
bundle="$here/board/plot-agent-settings.mjs"
if [ ! -f "$bundle" ]; then
  printf 'plot-agent-settings: the rule cannot be asked — no %s\n' "$bundle" >&2
  exit 3
fi

refusal="$(node "$bundle" < "$path" 2>&1)"
status=$?

case "$status" in
  0)
    printf '%s\n' "$path"
    exit 0
    ;;
  3)
    # The bundle prints `<key>\t<why>`; both halves go to stderr, because the
    # caller's log is where a person reads which line to edit.
    printf 'plot-agent-settings: %s refuses: %s\n' "$path" "$refusal" >&2
    exit 3
    ;;
  *)
    # Anything else is an unreadable file or a node that would not run. Both are
    # "cannot tell", and cannot-tell is a refusal here rather than a pass: a file
    # nobody could parse may be the one that switches the gates off.
    printf 'plot-agent-settings: %s could not be read: %s\n' "$path" "$refusal" >&2
    exit 3
    ;;
esac
