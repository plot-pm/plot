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
# THE COMMAND IS NAMED FIRST. A bundle under skills/plot/scripts/board/ runs
# each gated action with no board, so the refusal points at it and then at the
# HTTP route the board's button uses. The dispatch bundle is
# `plot-dispatch-command.mjs`; `controllerInvocation` does not gate it, because
# it is the caller the receipt admits.
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

# The three scripts a command may run. Named here only for the prefilter and
# the refusal message; which ACTION a call is — including the fourth,
# `release`, and the modes with no endpoint — is `controllerInvocation`'s
# answer, asked through the bundle below. A second decision of that kind here
# would disagree with it.

# --- a single-quoted heredoc body is DATA, and its extent is readable ---------
#
# A commit message explaining which script performed a write was refused as
# though it were that script, and renaming the script to "the approval" in the
# prose let the identical commit through. That is the one thing the gate cost:
# it taught a caller to write a vaguer commit message, trading traceability for
# nothing — while `CLAUDE.md` asks for exactly that reasoning in exactly that
# place, "so `git log -S` finds it".
#
# ONLY THE SINGLE-QUOTED FORM. `<<'EOF'` names its terminator literally and the
# body ends at a line equal to it: that is a SCAN for a known word, not a shell
# grammar. `<<EOF` unquoted interpolates, so its body can contain a substitution
# that is a command — its contents stay tokenised, and a test pins that.
#
# THIS IS NOT COMMAND-POSITION MATCHING, which a panel measured and reversed.
# The gate exists for "five dispatches in one session", and the natural spelling
# of several dispatches is a loop — `for s in a b; do plot-dispatch.sh $s; done`
# refuses today and a loop body is not command position, so that fix would have
# been blind to the defect the gate was built for. Command position is also
# something the CALLER WRITES, and this gate rests on a master agent's own
# assertions being untrustworthy.
#
# STRIPPED ONCE, BEFORE BOTH READERS. The mode check below reads `$CMD` too, so
# a body containing the words `--dry-run` would otherwise exempt a real
# invocation sharing its command line. Measured 2026-09-17, that case ALLOWED
# before this strip and refuses after: the scan tightens the gate here rather
# than loosening it.
strip_quoted_heredocs() { # stdin: the command → stdout: bodies removed
  awk '
    !inbody {
      # `<<` or `<<-`, then a SINGLE-QUOTED word. The unquoted and
      # double-quoted forms are deliberately not matched.
      if (match($0, /<<-?[[:space:]]*'"'"'[^'"'"']+'"'"'/)) {
        tag = substr($0, RSTART, RLENGTH)
        sub(/^<<-?[[:space:]]*'"'"'/, "", tag)
        sub(/'"'"'$/, "", tag)
        inbody = 1
      }
      print
      next
    }
    {
      # The body ends at a line equal to the terminator. `<<-` strips leading
      # tabs from the terminator line, so both spellings are accepted; nothing
      # else about the body is interpreted.
      line = $0
      sub(/^\t+/, "", line)
      if (line == tag) { inbody = 0; print }
      # else: a body line — dropped, because it is data.
    }
  '
}
CMD_SCAN="$(printf '%s' "$CMD" | strip_quoted_heredocs)" || CMD_SCAN="$CMD"

# --- a CI suite at a fleet desk ----------------------------------------------
#
# An unattended agent at a fleet desk does not run the suites the project's
# `CI suites` key leaves to CI; CI runs them on every pull request, and seven
# agents running them on one machine kept the load at 4-9 times the core count
# (measured 2026-10-02). The agent runs `plot-local-checks.mjs` instead.
#
# PLACED BEFORE EVERY EARLY EXIT BELOW. The prefilter exit allows any command
# that names none of the three controller scripts, and the desk exemption
# allows every linked worktree: a fleet agent's command passes both, so an arm
# after either would never fire.
#
# THE DESK DECIDES, and two cheap shell readings stand before any `node` start:
# `PLOT_UNATTENDED=1`, then a linked worktree holding `.plot-worker.pid`, then
# one `CI suites` entry's first two words appearing in the command. A person at
# a terminal is never refused. Whether the command RUNS a suite, rather than
# mentioning one, is `ciSuiteRefusal`'s answer, asked through the bundle.
#
# A check against habit, not a boundary: a suite spelled another way passes.
if [ "${PLOT_UNATTENDED:-}" = "1" ]; then
  ci_top="$(git rev-parse --show-toplevel 2>/dev/null)" || ci_top=""
  ci_git_dir="$(git rev-parse --absolute-git-dir 2>/dev/null)" || ci_git_dir=""
  ci_git_common="$(git rev-parse --path-format=absolute --git-common-dir 2>/dev/null)" || ci_git_common=""
  if [ -n "$ci_top" ] && [ -f "$ci_top/.plot-worker.pid" ] && [ -n "$ci_git_dir" ] && [ "$ci_git_dir" != "$ci_git_common" ]; then
    script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
    ci_suites="$(cd "$ci_top" && "$script_dir/plot-config.sh" get "CI suites" "" 2>/dev/null)" || ci_suites=""
    ci_hit=""
    if [ -n "$ci_suites" ]; then
      ci_old_ifs="$IFS"; IFS=';'
      for ci_entry in $ci_suites; do
        IFS="$ci_old_ifs"
        ci_head="$(printf '%s' "$ci_entry" | awk '{print $1" "$2}')"
        case "$CMD_SCAN" in *"$ci_head"*) ci_hit=1 ;; esac
        IFS=';'
      done
      IFS="$ci_old_ifs"
    fi
    if [ -n "$ci_hit" ] && [ -f "$script_dir/board/plot-local-checks.mjs" ]; then
      # `|| ci_rc=$?` RATHER THAN READING `$?` AFTER: the `ERR` trap above
      # turns any failing command into `exit 0`, and exit 3 is the answer here.
      ci_rc=0
      ci_refusal="$(cd "$ci_top" && printf '%s' "$CMD_SCAN" | node "$script_dir/board/plot-local-checks.mjs" --ci-suite-refusal 2>/dev/null)" || ci_rc=$?
      if [ "$ci_rc" -eq 3 ]; then
        printf '%s\n' "$ci_refusal" >&2
        exit 2
      fi
    fi
  fi
fi

# --- the per-word prefilter: skips work, decides nothing ---------------------
#
# `node` starts only for a word that COULD name a gated script. Pathname
# expansion OFF (`set -f`): a glob is tested as the literal word it is, because
# the rule below reads it as a pattern itself and a shell-expanded `*.sh` would
# have already lost the word `controllerInvocation` needs to see. A command
# passes only if one of its words contains one of the three names, or ends in
# `.sh` and holds a glob character — everything else exits here, before any
# `node` start.
#
# THIS TEST MAY OVER-PASS AND MUST NEVER UNDER-PASS: it only skips work. A
# per-word test measured 8.7% of 32,352 logged Bash calls passing, against 31%
# for a whole-command test of the same kind (`docs/plans/2026-10-03-the-shell-
# shrinks-into-the-domain.md`).
prefiltered=""
(
  set -f
  for tok in $CMD_SCAN; do
    case "$tok" in
      *plot-dispatch*|*plot-approve*|*plot-deliver*) exit 0 ;;
      *.sh)
        case "$tok" in *[*?\[]*) exit 0 ;; esac
        ;;
    esac
  done
  exit 1
) && prefiltered=1
[ -n "$prefiltered" ] || exit 0

# --- the desk exemption: read from where the call RUNS, after the prefilter --
#
# Moved ahead of the rule: its three `git rev-parse` calls cost 15-16 ms and
# only a command that already passed the prefilter should pay them.
#
# Asked BEFORE the receipt, because a worker has no receipt and must not need
# one. `git rev-parse --git-common-dir` differs from `--git-dir` inside a
# worktree, which is git's own answer to *am I a linked worktree?* — read from
# git rather than from a path pattern, so a desk under a configured
# `Worktree root:` is recognised wherever the operator put it.
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
git rev-parse --show-toplevel >/dev/null 2>&1 || {
  # No git: the gate cannot measure anything. Allow, and SAY SO.
  echo "plot-controller-gate: no git here — controller routing went UNVERIFIED." >&2
  exit 0
}

git_dir="$(git rev-parse --absolute-git-dir 2>/dev/null)" || git_dir=""
git_common="$(git rev-parse --path-format=absolute --git-common-dir 2>/dev/null)" || git_common=""
if [ -n "$git_dir" ] && [ -n "$git_common" ] && [ "$git_dir" != "$git_common" ]; then
  # A linked worktree — a desk. A dispatched worker's own call.
  exit 0
fi

# --- the rule: which controller-owned action, if any, this command RUNS -----
#
# `controllerInvocation` (packages/domain/src/rules/ci-suite.ts) decides this
# now, not a shell token loop: it tells a script that is RUN from one that is
# READ or mentioned, which the loop this replaces could not (#1245 — `ls
# skills/plot/scripts/*.sh` and two read-only `git grep` commands were refused
# as though they ran a gated script). Asked through its own bundle, never
# `plot-local-checks.mjs` — that bundle is built for a different question and
# costs more to start.
#
# A COMMAND THAT PASSED THE PREFILTER AND CANNOT BE CHECKED IS REFUSED, never
# allowed: fail-open on this gate's own machinery, closed on the case it exists
# for (`:61-67`), and a command naming a gated script IS that case. `|| rc=$?`
# rather than reading `$?` after, because the `ERR` trap above turns any
# failing command into `exit 0` and losing the distinction here would silently
# allow exactly the command this gate exists to catch.
rc=0
action="$(printf '%s' "$CMD_SCAN" | node "$HERE/board/plot-controller-invocation.mjs" 2>/dev/null)" || rc=$?
if [ "$rc" -ne 0 ]; then
  {
    echo "plot-controller-gate: could not ask whether this command runs a controller-owned script."
    echo ""
    echo "  skills/plot/scripts/board/plot-controller-invocation.mjs is missing or failed."
    echo "  Update the plot plugin in this repository, or — in the plot repository itself —"
    echo "  run: pnpm build:board"
  } >&2
  exit 2
fi
[ -n "$action" ] || exit 0

# A display name for the refusal below; the decision above is the rule's.
case "$action" in
  dispatch) named_script=plot-dispatch.sh ;;
  approve)  named_script=plot-approve.sh ;;
  deliver|release) named_script=plot-deliver.sh ;;
esac

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

action_receipt_clears "$action" && exit 0

# --- the refusal, which names the repair -------------------------------------
#
# A refusal an operator cannot act on becomes a flag somebody turns off, which
# is plot-state-gate.sh's argument for naming the command per file.
{
  echo "plot-controller-gate: $named_script is a controller-owned action."
  echo ""
  echo "  Call the controller instead:"
  case "$action" in
    dispatch) cmd=plot-dispatch-command.mjs ;;
    release) cmd="plot-deliver.mjs --release <version>" ;;
    *) cmd="${named_script%.sh}.mjs" ;;
  esac
  echo "      node $HERE/board/$cmd <slug>"
  echo "    which runs with no board. With the board up, POST /api/$action {\"slug\":\"<slug>\"} is its button, and /plot-$action asks it."
  echo ""
  echo "  Or, where the board is not running and you accept the bypass:"
  # The receipt script beside THIS gate, absolute: on a plugin install the gate
  # runs from the plugin cache and the repository has no `skills/` to resolve a
  # relative path against. `%q` quotes it so a copied line keeps a path with a
  # space as one word.
  printf '      bash %q --unowned-action %s <slug> "<reason>"\n' "$HERE/plot-state-receipt.sh" "$action"
  echo ""
  echo "  The reason is required and it is counted to .plot/state/unowned-action-writes.tsv,"
  echo "  because a gate with no exit is one people route around and an uncounted exit is an"
  echo "  off switch. Measured 2026-09-09: five dispatches in one session went to this script"
  echo "  directly, by the agent that had read the rule, with the board answering on :7777."
} >&2
exit 2
