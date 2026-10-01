# plot-tmp.sh — every temp path a Plot script creates, and the process's only
# EXIT/INT/TERM/PIPE traps. SOURCED, not run.
#
#   . "$SCRIPT_DIR/plot-tmp.sh"
#   plot_tmpdir  work  fleet-ref     # $work  = $TMPDIR/plot-fleet-ref.XXXXXX (a directory)
#   plot_tmpfile err   host-err      # $err   = $TMPDIR/plot-host-err.XXXXXX  (a file)
#   plot_on_exit budget_memo_clear   # a command the exit handler runs
#
# THE TEMPLATE IS THE REASON THIS FILE EXISTS. On macOS, `mktemp` with no
# template and `mktemp -t` both write to `_CS_DARWIN_USER_TEMP_DIR` and ignore
# `TMPDIR` (`man mktemp`). Only an explicit `"${TMPDIR:-/tmp}/plot-<prefix>.XXXXXX"`
# lands under `TMPDIR`, and BSD `mktemp` requires the X's to trail. Every path
# carries the `plot-` prefix, which is the name `plot-reap.sh --sweep-temp`
# removes after a SIGKILL skipped the traps.
#
# ASSIGNMENT BY NAME, NEVER `d=$(plot_tmpdir x)`. The functions assign through
# `printf -v` and print nothing. `scripts/check-temp-paths.sh` refuses the
# substitution form.
#
# THE REGISTRY IS A FILE KEYED BY `$$`, NOT A SHELL ARRAY. `$$` is the owning
# script's pid in every subshell, so a registration made inside `$(…)` or
# `( … ) &` reaches the owner's trap; an array would be a subshell's copy and
# the path would leak. Measured 2026-09-30: `plot-host.sh` creates two spool
# files inside a command substitution.
#
# THE TRAPS ARE INSTALLED HERE, ONCE, AT SOURCE TIME. A trap installed on the
# first call would be installed inside that call's substitution and remove the
# path when the substitution closed. `PLOT_TMP_LOADED` makes a second source in
# the same process a no-op, because a re-run setup would truncate the live
# registry. INT, TERM and PIPE run the cleanup, clear their own trap and
# re-raise, so the script stops with 130, 143 or 141 rather than running on to
# exit 0. PIPE is among them because a board server stopped with SIGTERM leaves
# its running scripts writing to closed pipes, and SIGPIPE's default action
# skips the EXIT trap.
#
# A script that sources this must not install its own EXIT, INT or TERM trap:
# the last `trap` wins, and that replacement is the defect this file fixes
# (`plot-fleet-scan.sh` left one ~955-file cache per run). Use `plot_on_exit`.

if [ "${PLOT_TMP_LOADED:-}" = "$$" ]; then
  return 0 2>/dev/null || exit 0
fi
PLOT_TMP_LOADED=$$

# Fixed at first source: a later `TMPDIR` change in the script does not move it.
# A file already at this path belongs to a dead process that had the same pid,
# and its `c:` commands are not this process's, so it is replaced, never read.
# The file itself is created at the end of this file, after the traps.
PLOT_TMP_REGISTRY="${TMPDIR:-/tmp}/plot-reg.$$"

# One line per entry, in registration order: `p:<path>` or `c:<command>`.
_plot_tmp_register() {
  printf '%s:%s\n' "$1" "$2" >> "$PLOT_TMP_REGISTRY" 2>/dev/null || true
}

# A SIGNAL INSIDE A CREATION WAITS FOR THE REGISTRATION. bash runs a pending
# trap as soon as `$(mktemp …)` returns, before the next line registers the
# path, so a cleanup run there would remove the registry and leave the new path
# unlisted. While `__plot_tmp_busy` is set, the signal handler records the
# signal in `__plot_tmp_pending` and returns; `_plot_tmp_create` handles it once
# the path is registered.
__plot_tmp_busy=''
__plot_tmp_pending=''

# _plot_tmp_create VAR prefix [-d] — create, register, assign to VAR.
_plot_tmp_create() {
  local __plot_tmp_new __plot_tmp_rc
  __plot_tmp_busy=1
  if [ "${3:-}" = -d ]; then
    __plot_tmp_new=$(mktemp -d "${TMPDIR:-/tmp}/plot-$2.XXXXXX")
  else
    __plot_tmp_new=$(mktemp "${TMPDIR:-/tmp}/plot-$2.XXXXXX")
  fi
  __plot_tmp_rc=$?
  [ "$__plot_tmp_rc" -eq 0 ] && _plot_tmp_register p "$__plot_tmp_new"
  __plot_tmp_busy=''
  if [ -n "$__plot_tmp_pending" ]; then
    # shellcheck disable=SC2086 # "<name> <number>", split on purpose
    _plot_tmp_on_signal $__plot_tmp_pending
  fi
  [ "$__plot_tmp_rc" -eq 0 ] || return 1
  printf -v "$1" '%s' "$__plot_tmp_new"
}

# plot_tmpdir VAR prefix — create a directory, register it, assign it to VAR.
plot_tmpdir() {
  _plot_tmp_create "$1" "$2" -d
}

# plot_tmpfile VAR prefix — create a file, register it, assign it to VAR.
plot_tmpfile() {
  _plot_tmp_create "$1" "$2"
}

# plot_on_exit command — run `command` (one line) when the process ends.
plot_on_exit() {
  _plot_tmp_register c "$*"
}

# Runs every registered command and removes every registered path, in
# registration order, then removes the registry. Runs once: the registry is
# gone afterwards, so a second call finds nothing.
#
# PIPE is ignored for the cleanup: the process is ending, and a registered
# command that writes to a closed stdout or stderr must not stop the removals.
_plot_tmp_cleanup() {
  local __plot_tmp_line
  [ -n "${__plot_tmp_owned:-}" ] && [ -f "$PLOT_TMP_REGISTRY" ] || return 0
  trap '' PIPE
  while IFS= read -r __plot_tmp_line; do
    case $__plot_tmp_line in
      c:*) eval "${__plot_tmp_line#c:}" ;;
      p:*) rm -rf -- "${__plot_tmp_line#p:}" 2>/dev/null ;;
    esac
  done < "$PLOT_TMP_REGISTRY"
  rm -f -- "$PLOT_TMP_REGISTRY" 2>/dev/null
  return 0
}

_plot_tmp_on_exit() {
  local __plot_tmp_rc=$?
  _plot_tmp_cleanup
  exit "$__plot_tmp_rc"
}

# $1 is the signal name, $2 its number. `kill` re-raises it with the default
# disposition; the `exit` is reached only if the shell defers the delivery.
_plot_tmp_on_signal() {
  if [ -n "$__plot_tmp_busy" ]; then
    __plot_tmp_pending="$1 $2"
    return 0
  fi
  trap - EXIT "$1"
  _plot_tmp_cleanup
  kill -"$1" "$$"
  exit $((128 + $2))
}

trap _plot_tmp_on_exit EXIT
trap '_plot_tmp_on_signal INT 2' INT
trap '_plot_tmp_on_signal TERM 15' TERM
trap '_plot_tmp_on_signal PIPE 13' PIPE

# THE REGISTRY IS CREATED AFTER THE TRAPS, so no signal lands between the file
# and the handler that removes it. It is replaced under the creation deferral:
# until `__plot_tmp_owned` is set, a file at this path is a dead process's and
# the cleanup leaves it unread.
__plot_tmp_busy=1
rm -f -- "$PLOT_TMP_REGISTRY" 2>/dev/null
: > "$PLOT_TMP_REGISTRY" 2>/dev/null || true
__plot_tmp_owned=1
__plot_tmp_busy=''
if [ -n "$__plot_tmp_pending" ]; then
  # shellcheck disable=SC2086 # "<name> <number>", split on purpose
  _plot_tmp_on_signal $__plot_tmp_pending
fi
