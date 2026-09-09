#!/usr/bin/env bash
# Plot gate: refuse a controller-owned lifecycle script invoked without a
# controller receipt.
#
# Wired as a Claude Code PreToolUse hook on the Bash tool (see hooks/hooks.json),
# beside plot-phase-gate.sh and plot-state-gate.sh. Reads the hook JSON on
# stdin; acts only on commands naming one of three scripts. Exit 2 blocks with
# the endpoint to call instead on stderr; anything else allows.
#
# WHY THIS IS A GATE AND NOT A RULE. Measured 2026-09-09: five dispatches in one
# session went to `plot-dispatch.sh` directly, across four plans, by the agent
# that had read the rule — with the board running and answering on `:7777`. It
# surfaced only when the operator asked *"Don't we have a controller command
# dispatch?"*. `CLAUDE.md`'s own test: *can you answer "did I use the
# controller?" without doing the work?* Yes, and the answer was wrong five times.
#
# THE RECEIPT IS THE INSTRUMENT, and it is not invented here. `/api/dispatch`
# spawns `plot-dispatch.sh` and a hand-typed call spawns the same script; the
# two are BYTE-IDENTICAL at the command line and no grep separates them. What
# separates them is that only the controller runs BEFORE the script does, so
# only the controller can have left a receipt. `plot-state-receipt.sh` holds
# both kinds, for the reason that file already gives: the gate and the owners
# must agree on where a receipt lives.
#
# THE DESK IS THE EXEMPTION, READ FROM WHERE THE CALL RUNS. A dispatched worker
# is a `claude -p` process inheriting these same plugin hooks, so its calls
# reach this gate exactly as the master agent's do. A call whose working
# directory is inside a dispatch worktree is a worker's; one from the repository
# root is the master agent's. That is the distinction every other component
# already makes — `plot-dispatch.sh` finds a desk by asking git which worktree
# holds a branch, and `plot-reap.sh` recognises one by its `.plot-worker.pid`.
#
# NOT AN ENVIRONMENT VARIABLE, and the reason is the whole design. `PLOT_WORKER=1`
# would be simpler and it is refused on the same argument the receipt rests on:
# an env var is something an agent SETS, and this gate exists because a master
# agent's own assertions cannot be trusted. A working directory is a measurement.
#
# WHAT IS GATED IS THREE SCRIPTS, and each has a live endpoint so every refusal
# names a real route. `gh` and `git` were BOTH used to bypass a controller in the
# same session and are deliberately not gated: `gh pr merge` on a plan PR *is*
# the approval under `Review: pr`, and neither has an endpoint to point at.
# A refusal whose only possible response is the escape hatch is the shape people
# turn off.
#
# THE ROUTE NAMED IS THE HTTP ONE, because it is the one that exists. CLAUDE.md
# says the nine actions are "reachable without HTTP through plot-ask.mjs", and
# measured 2026-09-09 that artifact answers `board|fleet|deliverable` and
# nothing else — the action verbs are not on it. A refusal naming a route that
# refuses back is the defect this slice removes from `plot-worker-loop.sh`, so
# this gate does not commit it: it names the endpoint and the escape, and the
# escape is what serves a machine running no board.
#
# NOR IS ANYTHING READ-ONLY. `plot-fleet-scan.sh`, `plot-reconcile-scan.sh` and
# the rest change nothing, and gating a read would make the estate unaskable
# without a running board. The split runs INSIDE `plot-dispatch.sh` too: its
# `--status` and `--dry-run` report and write nothing, and its `--stop`,
# `--restart`, `--start` and `--migrate` modes have no endpoint at all — so the
# gate covers the fan-out `/api/dispatch` owns, and nothing else. Refusing a
# mode with no route would be the `gh` mistake one file further in.
#
# FAIL-OPEN ON ITS OWN MACHINERY, CLOSED ON THE CASE IT EXISTS FOR. The two
# directions are `plot-state-gate.sh`'s and they are not symmetric by accident:
# no `.plot/state/`, no git, unparseable hook JSON → allow, and SAY the routing
# went unverified, which is `plot-phase-gate.sh`'s precedent — failing open, not
# failing silently. A gated script invoked with no receipt → refuse, naming the
# endpoint. That is the one direction that must never be lenient.

set -uo pipefail

# --- fail-open guard: any error below → allow ---
trap 'exit 0' ERR

INPUT="$(cat)"
CMD="$(printf '%s' "$INPUT" | jq -r '.tool_input.command // empty' 2>/dev/null)" || exit 0
[ -n "$CMD" ] || exit 0

# The three, and the endpoint each one's action belongs to. A refusal names a
# route or it is not issued: that is why the list is these three and not the
# fleet's writing scripts generally.
gated_action() { # $1=script basename → the action word, or nothing
  case "$1" in
    plot-dispatch.sh) printf 'dispatch\n' ;;
    plot-approve.sh)  printf 'approve\n' ;;
    plot-deliver.sh)  printf 'deliver\n' ;;
  esac
}

# Which of the three this command names, if any. Read as a BASENAME, because
# `bash skills/plot/scripts/plot-dispatch.sh x`, `./plot-dispatch.sh x` and a
# call through an absolute path are one invocation spelled three ways, and an
# operator's shell history holds all three.
#
# A word is a match only where the basename stands alone as a token — so a
# command MENTIONING the script inside a longer word does not fire. Bounded by
# what a hook can know: this reads the command line, and a script reached
# through a variable or a wrapper is not visible here. That is the same bound
# `plot-state-gate.sh` accepts on `git add` pathspecs, and the answer is the
# same one — the gate catches the shape that was measured, not every shape.
named_script=""
for tok in $CMD; do
  base="${tok##*/}"
  base="${base%%;*}"
  [ -n "$(gated_action "$base")" ] || continue
  named_script="$base"
  break
done
[ -n "$named_script" ] || exit 0

# --- the read/write split INSIDE the named script ----------------------------
#
# Only the action a controller owns is gated. `--status` and `--dry-run` report;
# `--stop`, `--restart`, `--start` and `--migrate` write, and have NO endpoint —
# refusing them would name no route, which is the exact reason `gh` is left out.
# `plot-fleetctl.sh --stop` calls `plot-dispatch.sh --stop` per agent, so a gate
# over that mode would break the fleet's own orchestration.
case " $CMD " in
  *" --status "*|*" --status"|*" --dry-run "*|*" --dry-run"*|\
  *" --stop "*|*" --stop"|*" --restart "*|*" --restart"|\
  *" --start "*|*" --start"|*" --migrate "*|*" --migrate"|\
  *" --help "*|*" --help"|*" -h "*|*" -h")
    exit 0 ;;
esac

# --- the desk exemption: read from where the call RUNS -----------------------
#
# Asked BEFORE the receipt, because a worker has no receipt and must not need
# one. `git rev-parse --git-common-dir` differs from `--git-dir` inside a
# worktree, which is git's own answer to *am I a linked worktree?* — read from
# git rather than from a path pattern, so a desk under a configured
# `Worktree root:` is recognised wherever the operator put it.
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
git rev-parse --show-toplevel >/dev/null 2>&1 || {
  # No git: the gate cannot measure anything. Allow, and SAY SO.
  echo "plot-controller-gate: no git here — controller routing went UNVERIFIED for $named_script." >&2
  exit 0
}

git_dir="$(git rev-parse --absolute-git-dir 2>/dev/null)" || git_dir=""
git_common="$(git rev-parse --path-format=absolute --git-common-dir 2>/dev/null)" || git_common=""
if [ -n "$git_dir" ] && [ -n "$git_common" ] && [ "$git_dir" != "$git_common" ]; then
  # A linked worktree — a desk. A dispatched worker's own call.
  exit 0
fi

# --- the receipt -------------------------------------------------------------
# shellcheck source=plot-state-receipt.sh
. "$HERE/plot-state-receipt.sh" 2>/dev/null || {
  echo "plot-controller-gate: receipt reader unavailable — routing went UNVERIFIED for $named_script." >&2
  exit 0
}

state_root="$(git rev-parse --show-toplevel 2>/dev/null)/.plot/state"
if [ ! -d "$state_root" ]; then
  # No `.plot/state/` at all. A gate that broke an unconfigured repository would
  # be removed by the first person it blocked — so allow, and say what was not
  # checked. Failing open, not failing silently.
  echo "plot-controller-gate: no .plot/state/ — controller routing went UNVERIFIED for $named_script." >&2
  exit 0
fi

action_receipt_clears "$named_script" && exit 0

# --- the refusal, which names the repair -------------------------------------
#
# A refusal an operator cannot act on becomes a flag somebody turns off, which
# is plot-state-gate.sh's argument for naming the command per file.
action="$(gated_action "$named_script")"
{
  echo "plot-controller-gate: $named_script is a controller-owned action."
  echo ""
  echo "  Call the controller instead:"
  echo "      POST /api/$action {\"slug\":\"<slug>\"}"
  echo "    which is what the board's own button does, and /plot-$action is the skill that asks it."
  echo ""
  echo "  Or, where the board is not running and you accept the bypass:"
  echo "      bash skills/plot/scripts/plot-state-receipt.sh --unowned-action $action <slug> \"<reason>\""
  echo ""
  echo "  The reason is required and it is counted to .plot/state/unowned-action-writes.tsv,"
  echo "  because a gate with no exit is one people route around and an uncounted exit is an"
  echo "  off switch. Measured 2026-09-09: five dispatches in one session went to this script"
  echo "  directly, by the agent that had read the rule, with the board answering on :7777."
} >&2
exit 2
