#!/usr/bin/env bash
# Plot helper: fleet control — the door to the supervisor and the agents.
# Usage: plot-fleetctl.sh --status
#        plot-fleetctl.sh --once
#        plot-fleetctl.sh --start [N] [--dry-run]
#        plot-fleetctl.sh --stop [--wait SECONDS]
#   --status    is the supervisor alive, how many agents are running, how long
#               each has been idle — with pids. Starts nothing. Exit 0 when the
#               supervisor is loaded, 1 when it is not, so a caller can gate on
#               it without parsing prose. Where it is NOT loaded it names which
#               of two failures this is — a machine with no unit, or a unit
#               launchd was never told about — and prints that state's own
#               repair. The two read identically and cost differently.
#   --once      one supervisor tick against the live estate, then exit. THE
#               GATE: the tick decides and performs nothing, so this is free and
#               proves the daemon works before any unit is installed.
#   --start [N] probe, fill the unit, load it, then bring up N free agents
#               through `plot-dispatch.sh --start`. N is optional and passed
#               through: the count and its default live there. It RECORDS THAT
#               IT FINISHED, in `.plot/state/fleet-start.done` — a completion
#               marker and not a lock, so absence is the signal and no timer
#               tells a kill from a crash.
#   --stop      stop every dispatched agent through `plot-dispatch.sh --stop`,
#               reporting each branch as it goes, then unload the supervisor.
#               The supervisor goes LAST — it is what would notice a desk
#               falling idle, so a stop that fails partway leaves a watcher over
#               what remains.
#   --wait S    seconds to wait for one worker to exit (default 30). Past the
#               bound the branch is reported still running and the run carries
#               on; nothing is waited on forever.
#   --dry-run   with --start: report what would be filled, loaded and started;
#               write nothing, load nothing, start nothing.
# Output: prose for a person, one line per thing acted on. Exit 0 on success.
#
# IT PROBES BEFORE IT ACTS AND REFUSES RATHER THAN REPAIRING — the discipline
# /plot-board-setup already applies. Four refusals, each a measurement:
#
#   no plot-fleetd.mjs         nothing to start; a broken Plot installation
#   node is not Plot's pinned major, or Plot's pin is unreadable
#                              THE UNIT BAKES $NODE IN PERMANENTLY. Measured
#                              2026-09-05: `command -v node` on the operator's
#                              machine answered 26.7.0 against a repo pinned to
#                              24, and the filled unit would have carried that
#                              path until someone re-filled it by hand.
#   platform is neither launchd nor systemd
#                              there is no unit to fill
#   a unit with that label is already loaded
#                              launchd keys by LABEL; a second repository needs
#                              a distinct one, and loading over the first would
#                              silently supervise the wrong estate.
#
# --stop IS AN ORCHESTRATION, NOT A SECOND STOP RULE. There is exactly one rule
# for stopping an agent and it lives in `plot-dispatch.sh --stop`. That command
# refuses a bare invocation — "Refusing to guess — stopping the wrong worker
# discards its work" — and a fleet-level stop that signalled everything itself
# would be a second, laxer rule for the same act. Naming each branch in turn is
# not guessing: the fleet knows which agents it has.
#
# EACH AGENT KEEPS ITS DESK AND ITS CLAIM, because `plot-dispatch --stop` keeps
# them. This ends processes and decides nothing about disk; what may be removed
# is `plot-reap.sh`'s question, on its own five measurements.
set -uo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# shellcheck source=plot-worker-state.sh
. "$script_dir/plot-worker-state.sh"

# THE LABEL IS OVERRIDABLE, AND THE DEFAULT IS UNCHANGED. `supervisor_loaded`
# asks launchd about the label, which is MACHINE-GLOBAL: no `HOME` override
# reaches it, so a sandbox on a machine whose fleet is loaded reads that fleet
# as its own. Measured here — a test asserting an unloaded supervisor got
# `supervisor: running` from the operator's live fleetd, and the four-state
# reading this file exists to add could not be tested at all.
#
# The brief settles the shape: test "under a different label, never by
# unloading the running one" — `--stop` ends work in flight and is a person's
# call. That instruction is unfollowable while the label is a constant.
#
# AN OPERATOR SEES NO CHANGE. Unset is the default and the only value any skill
# passes; the override exists so a test can name a label launchd does not hold.
# `skills/plot/units/README.md` already documents a second checkout relabelling
# its own unit, so the variable is that documented case made reachable.
#
# THE DEFAULT RENAMED FROM `com.plot-pm.registryd` TO `com.plot-pm.fleetd`, and
# `--start` migrates an old default-label unit that belongs to this checkout
# rather than leaving it orphaned — see the migration block below. A CUSTOM
# label an operator chose under the old prefix is never touched: it is the
# operator's name, and `unit_name` below keeps mapping it forever.
LABEL="${PLOT_FLEET_LABEL:-com.plot-pm.fleetd}"
UNIT_DIR="$script_dir/../units"

# THE SYSTEMD UNIT'S NAME, DERIVED FROM THE LABEL. launchd keys a job by the
# label inside the plist; systemd keys a unit by its FILENAME, so a second
# checkout needs a second filename. Every `systemctl` call and the install
# target take this answer — a hardcoded name wrote two checkouts into one file
# and made refusal 4 ask about a unit it did not name (#1053).
#
# THE DEFAULT LABEL MAPS TO `plot-fleetd`, the current name. THE OLD PREFIX
# `com.plot-pm.registryd` KEEPS ITS OWN MAPPING FOREVER: a custom label an
# operator installed under it is their name, not this repo's to rename, and
# `--stop`/`--status` must still find it by the same filename `--start` gave
# it. A custom label under either prefix loses that leading prefix, has each
# byte systemd refuses in a unit name replaced by `-`, and gains the matching
# `plot-registryd-`/`plot-fleetd-` filename prefix — the shape
# `units/README.md` documents for a second repository.
unit_name() {
  case "$LABEL" in
    com.plot-pm.fleetd) printf '%s' plot-fleetd; return ;;
    com.plot-pm.registryd) printf '%s' plot-registryd; return ;;
    com.plot-pm.fleetd.*) prefix=plot-fleetd rest=${LABEL#com.plot-pm.fleetd.} ;;
    *) prefix=plot-registryd rest=${LABEL#com.plot-pm.registryd.} ;;
  esac
  printf '%s-%s' "$prefix" "$(printf '%s' "$rest" | LC_ALL=C tr -c 'A-Za-z0-9:_.-' '-')"
}
UNIT_NAME=$(unit_name)

git rev-parse --git-dir >/dev/null 2>&1 || { echo "plot-fleetctl: not a git repository" >&2; exit 1; }
repo_root=$(git rev-parse --show-toplevel)

# THE SUPERVISOR SHIPS BESIDE THIS SCRIPT, NOT IN THE REPOSITORY IT SUPERVISES.
# `$repo_root` is the consumer's checkout, and a repository that consumes Plot
# as a plugin has no `skills/plot/` of its own. Built from `$repo_root`, this
# path refused `--once` in such a repository while the bundle sat, tracked,
# beside this file in the plugin (#969). Every other bundle caller in
# `skills/plot/scripts/` resolves from its own directory; this was the one that
# did not, and `scripts/check-bundle-resolution.sh` now holds that at zero.
fleetd="$script_dir/board/plot-fleetd.mjs"

# PLOT'S OWN ROOT, which is where Plot's `.nvmrc` lives. In this repository it
# is `$repo_root` too, which is why the two could be confused here.
plot_root="$(cd "$script_dir/../../.." && pwd)"
plot_nvmrc="$plot_root/.nvmrc"

# ---------------------------------------------------------------------------
# Probes
# ---------------------------------------------------------------------------

# Which init system supervises a user process here. `none` is a refusal rather
# than a fallback: there is no unit to fill, and inventing a `nohup` path would
# be Plot supervising a supervisor — the regress the OS terminates.
platform() {
  case "$(uname -s)" in
    Darwin) command -v launchctl >/dev/null 2>&1 && { echo launchd; return; } ;;
    Linux)  command -v systemctl >/dev/null 2>&1 && { echo systemd; return; } ;;
  esac
  echo none
}

# The major PLOT pins. `.nvmrc` is the one place that says it; the two
# `engines` blocks say `>=24`, which is a floor rather than the pin.
#
# PLOT'S PIN, NOT THE CONSUMER'S. The unit runs Plot's bundle, so Plot's pin is
# the one that decides whether the interpreter fits. Read from `$repo_root`,
# a consumer with no `.nvmrc` got an empty pin and refusal 2 was skipped
# without a word — the one refusal that keeps a wrong node out of a unit.
pinned_major() {
  local v
  v=$(tr -d ' \tv\n' < "$plot_nvmrc" 2>/dev/null)
  printf '%s' "${v%%.*}"
}

running_major() {
  local v
  v=$(node --version 2>/dev/null) || return 1
  v=${v#v}
  printf '%s' "${v%%.*}"
}

# Is the label loaded? Answered by the init system, never by a pidfile: a
# pidfile outlives its process, and this question has an authoritative answer.
#
# IT RETURNS 0 OR 1 AND NEVER THE INIT SYSTEM'S OWN CODE. `launchctl print`
# answers 113 for a label it does not hold, and this function's status was the
# `case`'s last command — so `--status`, whose last two lines are
# `supervisor_loaded; exit $?`, exited 113 where the board reads 1. Measured
# here against a spare label: `rules/supervisor-reading.ts` gates on 0 loaded
# and 1 not, and anything else renders as a run it could not interpret.
#
# The default label masked it. `launchctl print` answers 1 for some absences
# and 113 for others, so the bug was reachable only from a label this machine
# had never held — which is exactly the shape a test must use, and why it
# survived until the label became overridable.
supervisor_loaded() {
  case "$(platform)" in
    launchd) launchctl print "gui/$(id -u)/$LABEL" >/dev/null 2>&1 && return 0 ;;
    systemd) systemctl --user is-active --quiet "$UNIT_NAME" && return 0 ;;
  esac
  return 1
}

# The supervisor's pid, or empty. Asked separately from liveness because a
# loaded-but-not-running job is a real state and the two answers differ.
supervisor_pid() {
  case "$(platform)" in
    launchd) launchctl print "gui/$(id -u)/$LABEL" 2>/dev/null \
               | sed -n 's/^[[:space:]]*pid = \([0-9]*\).*/\1/p' | head -1 ;;
    systemd) systemctl --user show "$UNIT_NAME" -p MainPID --value 2>/dev/null \
               | grep -v '^0$' ;;
  esac
}

# The working directory of the LOADED job, or empty.
#
# THE LOADED JOB, NOT THE PLIST. A plist on disk may not be the job launchd
# holds, and a file read cannot see a job installed by hand elsewhere. launchd
# prints the key as `working directory`, lowercase with a space; `grep
# WorkingDirectory` over the same output finds nothing.
#
# `gui/`, like `supervisor_loaded`: the unit is a LaunchAgent, and `system/`
# answers *Could not find service* for it.
#
# The systemd arm is read, not run: no Linux machine was available to verify
# it, and one hardcoded unit name means it can never name another checkout.
#
# Exit status is always 0. The pipeline ends in `head`, and the trailing
# `return 0` keeps launchctl's 113 from reaching a caller.
supervisor_workdir() {
  case "$(platform)" in
    launchd) launchctl print "gui/$(id -u)/$LABEL" 2>/dev/null \
               | sed -n 's/^[[:space:]]*working directory = \(.*\)$/\1/p' | head -1 ;;
    systemd) systemctl --user show "$UNIT_NAME" -p WorkingDirectory --value 2>/dev/null \
               | head -1 ;;
  esac
  return 0
}

# The bundle path a LOADED job's own argv names, or empty. Read from the job
# launchd/systemd actually holds, never from a unit file on disk — the same
# reason `supervisor_workdir` reads the loaded job: a plist may not be what is
# bootstrapped, and this answers what IS running, which is what a migration or
# a missing-bundle report must act on.
supervisor_bundle_path() {
  case "$(platform)" in
    launchd) launchctl print "gui/$(id -u)/$LABEL" 2>/dev/null \
               | awk '/^\targuments = \{/{f=1; next} f && /\.mjs$/{print $1; exit} /^\t\}/{f=0}' ;;
    systemd) systemctl --user show "$UNIT_NAME" -p ExecStart --value 2>/dev/null \
               | grep -o '[^ ]*\.mjs' | head -1 ;;
  esac
  return 0
}

# Which checkout the loaded supervisor serves: one line, `this <path>`,
# `another <path>`, or `unknown`.
#
# PHYSICAL PATHS ARE COMPARED, as `plot-boardctl.sh --status` does, so a
# checkout reached through a symlink is still this one.
#
# EMPTY IS `unknown`, NEVER `this`. An empty reading comes from a label launchd
# does not hold, a job in another user's domain, or a hand-written unit without
# the key. Reading any of them as *this repository* would invite an overwrite of
# a supervisor that is not this checkout's.
supervisor_checkout() {
  local served here there
  served=$(supervisor_workdir)
  if [ -z "$served" ]; then
    echo unknown
    return 0
  fi
  here=$(cd "$repo_root" && pwd -P)
  there=$(cd "$served" 2>/dev/null && pwd -P) || there="$served"
  if [ "$here" = "$there" ]; then
    printf 'this %s\n' "$served"
  else
    printf 'another %s\n' "$served"
  fi
}

# The `--status` line for `supervisor_checkout`'s answer.
serves_line() { # $1=the answer
  case "$1" in
    this\ *)    echo "  serves:  THIS repository (${1#this })" ;;
    another\ *) echo "  serves:  ANOTHER checkout (${1#another }) — this repository is $repo_root" ;;
    *)          echo "  serves:  cannot determine — $(platform) names no working directory for $LABEL" ;;
  esac
}

# ---------------------------------------------------------------------------
# Every Plot process on this machine
# ---------------------------------------------------------------------------
#
# `--status` above answers about ONE label. Measured 2026-09-29: it printed one
# healthy supervisor while 17 `plot-fleet-scan.sh` processes from five
# installations loaded the machine, spawned by BOARDS, and no reading showed
# them. This block finds supervisors, boards and top-level scans by PROCESS,
# never by label — `LABEL` accepts any string, so a label search misses
# `com.quatico.ewz.registryd` and still claims it looked.
#
# NOTHING READ FROM ANOTHER PROCESS REACHES A SHELL EVALUATOR. The snapshot
# holds every user's command lines. awk emits candidate paths as data; bash
# tests each as a variable. No awk `system()`, no `eval`, no `sh -c`: measured
# 2026-09-30, `system("test -x \"" $0 "\"")` ran `$(touch …)`, backticks and
# `$(( $( ) ))` out of a stranger's argv. The `lsof` cwd and the cgroup line are
# handled the same way.

# Classifies `ps axww -o pid=,ppid=,uid=,args=` rows read on stdin. Prints one
# `C<TAB>pid<TAB>ppid<TAB>uid<TAB>kind<TAB>argv0<TAB>path` line per candidate,
# where argv0 is `-` unless it holds a space (then the caller must find an
# executable regular file there), and one `S<TAB>pid` line per `systemd --user`
# process, which is the Linux subreaper an orphan reparents to.
plot_process_candidates() {
  awk '
    # End index in s of the first `name` followed by a space or the end of s,
    # or 0. With `bare`, name must also start s or follow a `/`.
    function art_end(s, name, bare,   off, i, j, c) {
      off = 0
      while ((i = index(substr(s, off + 1), name)) > 0) {
        j = off + i + length(name) - 1
        c = substr(s, j + 1, 1)
        if (c == "" || c == " ") {
          if (!bare || off + i == 1 || substr(s, off + i - 1, 1) == "/") return j
        }
        off += i
      }
      return 0
    }
    {
      if (!match($0, /^ *[0-9]+ +[0-9]+ +[0-9]+ /)) next
      split(substr($0, 1, RLENGTH), h, " ")
      args = substr($0, RLENGTH + 1)
      s = "/" args
      if (s ~ /\/systemd --user$/) { print "S\t" h[1]; next }
      # Step 1: argv[0] runs to the first (^|/)(node|bash|sh) and a space.
      if (!match(s, /\/(node|bash|sh) /)) next
      interp = substr(s, RSTART + 1, RLENGTH - 2)
      argv0 = substr(args, 1, RSTART + RLENGTH - 3)
      rest = substr(args, RSTART + RLENGTH - 1)
      # Steps 2 and 3: the leading options, then the first token holding a `/`.
      pos = 1; n = length(rest); start = 0; bad = 0
      while (pos <= n) {
        while (pos <= n && substr(rest, pos, 1) == " ") pos++
        if (pos > n) break
        k = index(substr(rest, pos), " ")
        tok = k ? substr(rest, pos, k - 1) : substr(rest, pos)
        if (tok ~ /^-[^-]/) {
          if (interp == "node") { if (substr(tok, 2) ~ /[ep]/) bad = 1 }
          else if (substr(tok, 2) ~ /c/) bad = 1
        } else if (interp == "node" && tok ~ /^--(eval|print)(=|$)/) bad = 1
        if (bad) break
        if (index(tok, "/") || tok == "plot-fleet-scan.sh") { start = pos; break }
        if (!k) break
        pos += k
      }
      if (bad || !start) next
      p = substr(rest, start)
      # Step 4: the path names the kind.
      kind = ""; e = 0
      if (interp == "node") {
        b = art_end(p, "/board/board-server.mjs", 0)
        r = art_end(p, "/board/plot-fleetd.mjs", 0)
        r2 = art_end(p, "/board/plot-registryd.mjs", 0)
        if (!r || (r2 && r2 < r)) r = r2
        if (b && (!r || b < r)) { kind = "board"; e = b }
        else if (r) { kind = "supervisor"; e = r }
      } else if ((e = art_end(p, "plot-fleet-scan.sh", 1))) kind = "scan"
      if (kind == "") next
      print "C\t" h[1] "\t" h[2] "\t" h[3] "\t" kind "\t" (index(argv0, " ") ? argv0 : "-") "\t" substr(p, 1, e)
    }'
}

# The working directory of a pid, or empty for *cannot determine*. `$1` is the
# kernel (`uname -s`). An empty `lsof` answer is cannot-determine whatever its
# exit code: for another user's process it prints nothing and exits 1.
process_cwd() { # $1=kernel $2=pid
  local cwd=""
  case "$1" in
    Darwin) cwd=$(lsof -a -p "$2" -d cwd -Fn 2>/dev/null | sed -n 's/^n//p' | head -1) ;;
    Linux)  cwd=$(readlink "${PLOT_PROC_ROOT:-/proc}/$2/cwd" 2>/dev/null) ;;
  esac
  cwd=${cwd//$'\t'/?}
  printf '%s' "${cwd//$'\n'/?}"
}

# A path for printing: under `$HOME` it starts with `~`.
home_short() {
  case "$1" in
    "${HOME:-/nonexistent}"/*) printf '~%s' "${1#"$HOME"}" ;;
    *) printf '%s' "$1" ;;
  esac
}

# The second `--status` block: every Plot supervisor, board and top-level scan
# on this machine except the supervisor the first block names (`$1`, its pid,
# or empty). Prints NOTHING when every one serves this checkout and no scan is
# orphaned — a foreign installation serving this checkout is the normal shape
# of an adopting repository, so it is silent. Never prints a line starting
# with `summary:`, which is the board's contract.
plot_processes_block() { # $1=pid to skip
  local skip="${1:-}" kernel here tag pid ppid uid kind a0 path verified="" top rows=""
  local orph cwd serves inst full suffix label owner lc="" lc_read=0 line seg noisy=0
  kernel=$(uname -s 2>/dev/null)
  here=$(cd "$repo_root" && pwd -P)
  while IFS=$'\t' read -r tag pid ppid uid kind a0 path; do
    case "$tag" in
      S) verified+="S"$'\t'"$pid"$'\n' ;;
      C) if [ "$a0" != "-" ] && ! [[ -f "$a0" && -x "$a0" ]]; then continue; fi
         verified+="C"$'\t'"$pid"$'\t'"$ppid"$'\t'"$uid"$'\t'"$kind"$'\t'"$path"$'\n' ;;
    esac
  done < <(ps axww -o pid=,ppid=,uid=,args= 2>/dev/null | plot_process_candidates)
  [ -n "$verified" ] || return 0
  # A process is reported only where its parent is not of the same kind: that
  # folds a `node --watch` board's child and a scan's subshells. Orphaned is a
  # parent that exited — ppid 1, or the `systemd --user` subreaper.
  top=$(printf '%s' "$verified" | awk -F'\t' '
    $1 == "S" { sd[$2] = 1; next }
    { n++; P[n] = $2; PP[n] = $3; U[n] = $4; K[n] = $5; A[n] = $6; kind[$2] = $5 }
    END {
      for (i = 1; i <= n; i++) {
        if (kind[PP[i]] == K[i]) continue
        print K[i] "\t" P[i] "\t" ((PP[i] == 1 || (PP[i] in sd)) ? 1 : 0) "\t" U[i] "\t" A[i]
      }
    }')
  while IFS=$'\t' read -r kind pid orph uid path; do
    [ -n "$pid" ] || continue
    [ "$pid" = "$skip" ] && continue
    cwd=$(process_cwd "$kernel" "$pid")
    if [ -z "$cwd" ]; then
      owner=$(id -un "$uid" 2>/dev/null) || owner=$uid
      [ -n "$owner" ] || owner=$uid
      serves="cannot determine (owner $owner)"
    elif [ "$cwd" = "$repo_root" ] || [ "$cwd" = "$here" ]; then
      serves="THIS repository"
    else
      serves=$cwd
    fi
    case "$path" in
      /*) full=$path ;;
      *)  full=""; [ -n "$cwd" ] && full="$cwd/$path" ;;
    esac
    case "$kind" in
      board)      suffix=/skills/plot/scripts/board/board-server.mjs ;;
      supervisor) suffix=/skills/plot/scripts/board/plot-fleetd.mjs ;;
      *)          suffix=/skills/plot/scripts/plot-fleet-scan.sh ;;
    esac
    inst="cannot determine"
    old_suffix=/skills/plot/scripts/board/plot-registryd.mjs
    matched=""
    case "$full" in
      ?*"$suffix") matched=$suffix ;;
      # THE OLD SUFFIX IS KEPT INDEFINITELY: another, unrelated installation
      # may still run the old-named bundle forever (it has its own lifecycle,
      # not this checkout's to force), and `--status` must still name whose
      # checkout it is rather than reporting it as undetermined.
      ?*"$old_suffix") [ "$kind" = supervisor ] && matched=$old_suffix ;;
    esac
    if [ -n "$matched" ]; then
      full=${full%"$matched"}
      if [ "$full" = "$repo_root" ] || [ "$full" = "$here" ]; then
        inst="THIS repository"
      else
        inst=$(home_short "$full")
      fi
    fi
    label=""
    if [ "$kind" = supervisor ]; then
      case "$kernel" in
        Darwin)
          [ "$lc_read" = 1 ] || { lc=$(launchctl list 2>/dev/null); lc_read=1; }
          label=$(printf '%s\n' "$lc" | awk -F'\t' -v p="$pid" '$1 == p { print $3; exit }') ;;
        Linux)
          line=$(grep '^0::' "${PLOT_PROC_ROOT:-/proc}/$pid/cgroup" 2>/dev/null | head -1)
          seg=${line##*/}
          case "$seg" in *?.service) label="unit ${seg%.service}" ;; esac ;;
      esac
      label=${label//$'\t'/?}
    fi
    [ "$serves" = "THIS repository" ] || noisy=1
    [ "$kind" = scan ] && [ "$orph" = 1 ] && noisy=1
    rows+="$kind"$'\t'"$pid"$'\t'"$orph"$'\t'"$serves"$'\t'"$inst"$'\t'"$label"$'\n'
  done <<< "$top"
  [ "$noisy" = 1 ] || return 0
  echo ""
  echo "plot processes on this machine:"
  printf '%s' "$rows" | awk -F'\t' '
    function where(r) { return "    serves:     " S[r] "\n    installed:  " I[r] }
    { n++; K[n] = $1; P[n] = $2; O[n] = $3; S[n] = $4; I[n] = $5; L[n] = $6 }
    END {
      for (i = 1; i <= n; i++) if (K[i] == "supervisor")
        print "  supervisor  pid " P[i] (L[i] != "" ? "  " L[i] : "") "\n" where(i)
      for (i = 1; i <= n; i++) if (K[i] == "board")
        print "  board       pid " P[i] "\n" where(i)
      for (i = 1; i <= n; i++) if (K[i] == "scan") {
        g = S[i] "\t" I[i]
        if (!(g in first)) { first[g] = i; order[++m] = g }
        if (O[i]) orphaned[g]++; else live[g]++
      }
      for (j = 1; j <= m; j++) {
        g = order[j]
        print "  scans       " (live[g] + 0) " in flight, " (orphaned[g] + 0) " orphaned\n" where(first[g])
      }
    }'
}

# Seconds since the supervisor last wrote its log, or empty when there is no
# log or its mtime cannot be read. Empty is not zero: no reading is not a fresh
# tick. Evidence only — the staleness judgement is `rules/supervisor-reading.ts`.
tick_age_seconds() {
  local log touched
  log="$repo_root/.plot/logs/registryd.log"
  [ -f "$log" ] || return 0
  # GNU FIRST, AND THE ORDER IS THE WHOLE FIX. `-f` means `--format` on BSD and
  # `--file-system` on GNU, and BOTH EXIT 0 — measured 2026-09-25 on Alpine,
  # where `stat -f %m <file>` prints a filesystem report and succeeds, so a
  # `||` fallback never fires and `touched` becomes that report with the real
  # mtime appended. The arithmetic below then fails on a non-numeric operand
  # and the field vanishes. An exit code cannot separate these two `stat`s;
  # only asking GNU first can, because `-c` is unambiguous — BSD rejects it.
  touched=$(stat -c %Y "$log" 2>/dev/null || stat -f %m "$log" 2>/dev/null) || return 0
  [ -n "$touched" ] || return 0
  echo $(( $(date +%s) - touched ))
}

# ---------------------------------------------------------------------------
# The completion marker — did the LAST `--start` finish?
# ---------------------------------------------------------------------------
#
# A COMPLETION MARKER, NOT A LOCK FILE. A lock says *a run is in progress* and
# answers wrongly for a run that died: nothing removes it, so every later reader
# sees a run that is still going. The question here is *did the last run
# finish*, and for that ABSENCE IS THE SIGNAL — no timer, no heuristic, and
# nothing that has to tell a kill from a crash.
#
# `plot-estate-changed.sh` draws the same distinction: "a clock would answer
# 'was it recent?' when the question is 'did it change?'".
#
# The measured failure, 2026-09-09: `--start` fills the unit, verifies it,
# bootstraps, then cuts agent desks — and cutting desks is the slow part, one
# `git worktree add` each. A run interrupted there leaves unit present, launchd
# unaware, agents partly started. That state had no name, so `--status` printed
# `not loaded` and an operator read it as *never installed*.
#
# MACHINE-LOCAL, under `.plot/state/`, for `plot-boardctl.sh:83`'s reason: it
# records what one laptop did, and a checked-in copy would tell another clone
# that its fleet was started.
start_marker() { printf '%s' "$repo_root/.plot/state/fleet-start.done"; }

# Where the unit for this label WOULD live, per platform. Read rather than
# written: `--status` asks whether a file is there and must install nothing.
unit_target() {
  case "$(platform)" in
    launchd) printf '%s' "$HOME/Library/LaunchAgents/$LABEL.plist" ;;
    systemd) printf '%s' "$HOME/.config/systemd/user/$UNIT_NAME.service" ;;
  esac
}

# THE TWO READINGS, RESOLVED TOGETHER — which is what settles the fresh-clone
# case. `.plot/state/` is machine-local and gitignored, so a machine that never
# ran `--start` has no marker either; the marker ALONE cannot tell that machine
# from an interrupted one. The unit file separates them:
#
#   unit file   marker    state
#   absent      absent    not-installed   → /plot-fleet --start
#   present     absent    interrupted     → one launchctl bootstrap
#   present     present   installed
#   loaded      —         running
#
# LOADED IS TESTED FIRST and the marker is not consulted for it. A fleet that is
# running is running whatever the last run recorded — this machine's own
# supervisor was loaded on 2026-09-09 with no marker beside it, and a reading
# that took the marker as authoritative would have called a healthy fleet
# interrupted.
# THE LABEL AND THE PROCESS ARE TWO READINGS, and `fleet_install_state` takes
# both rather than asking for them, because the `--status` arm has already paid
# for them. Measured 2026-09-22 on this estate, twice in ninety minutes: the
# label was loaded, `launchctl list` printed `-` in its FIRST column — which is
# launchd saying *no pid* — and no `registryd.mjs` process existed. `--status`
# answered `running` on both occasions while dispatched slices sat unserved.
#
# A LOADED LABEL WITH NO PID IS ITS OWN STATE, not a variant of `running`.
# Accepting `running` beside `exit 1` would move the same contradiction one
# field deeper: a caller reading `install=running` while the command exits 1
# must decide which to believe, and that decision is the defect being removed.
#
# `KeepAlive: true` DOES restart the daemon — measured, `runs` counted
# 38 → 39 → 40 in about forty seconds. So this state is most often a throttled
# crash loop, and a crash-looping label reports `running` at every moment
# BETWEEN restarts, which is most of them. Waiting for a restart is not the
# repair; reporting the reading is.
#
# BOTH READINGS ARE OPTIONAL AND THIS PROBES WHEN IT IS NOT TOLD. `--status`
# has already paid for them and passes them in, honouring the budget its own
# comment states; `--stop`'s `state:` line and the test seam call it bare, and
# both must keep answering exactly what they answered before. A required
# parameter would have changed those two answers silently.
#
# @param $1 - `loaded`/`unloaded` where the caller already asked; omitted to probe
# @param $2 - the supervisor's pid where the caller already asked, or empty for none
fleet_install_state() {
  local loaded="${1-}" pid="${2-}"
  if [ -z "$loaded" ]; then
    if supervisor_loaded; then loaded=loaded; pid=$(supervisor_pid); else loaded=unloaded; fi
  fi
  if [ "$loaded" = "loaded" ]; then
    [ -n "$pid" ] && { echo running; return; }
    echo "loaded-not-running"
    return
  fi
  local unit
  unit=$(unit_target)
  if [ -n "$unit" ] && [ -f "$unit" ]; then
    [ -f "$(start_marker)" ] && { echo installed; return; }
    echo interrupted
    return
  fi
  echo not-installed
}

# ---------------------------------------------------------------------------
# The fleet's worktrees — where --stop and --status learn which agents exist
# ---------------------------------------------------------------------------
#
# THE SAME RULE `plot-dispatch.sh` ASKS, because the two must enumerate the
# same population: a stop that missed a desk would report a fleet stopped while
# a worker kept writing to it. Both ask `deskRoot` through `plot-desk-root.sh`,
# for the MAIN checkout, and neither keeps a fallback default. The prefix is
# empty. A `plot-wt-*` desk an older dispatch made beside the repo is not under
# the desk root, so `--status` and `--stop` do not enumerate it; stop such a
# worker with `plot-dispatch --stop <branch>`, which asks `git worktree list`.
# shellcheck source=plot-desk-root.sh
. "$script_dir/plot-desk-root.sh"
# Asked only by the two verbs that enumerate desks, so the probes and their
# refusals answer first and a sourced test reaches them without a desk root.
resolve_wt_root() { # sets wt_root, wt_prefix; exits 3 when unaskable
  wt_root=$(plot_desk_root "$(plot_repo_root)") || {
    echo "plot-fleetctl: cannot resolve where the fleet's worktrees are — nothing was done." >&2
    exit 3
  }
  wt_prefix=""
}

# SOURCEABLE, so a test can take the probes and the fill without an init system.
# The same guard `plot-worker-loop.sh` uses, and for the same reason: the
# refusals are the thing worth asserting, and three of the four are decided
# before anything is written. Sourcing stops here; nothing below runs.
#
# CI IS `ubuntu-latest` ONLY, so the launchd arm can never be exercised there —
# and that is the arm a macOS operator uses. The fill and the parse ARE
# assertable on Linux, which is what this guard makes reachable.
if [ -n "${PLOT_FLEETCTL_SOURCED:-}" ]; then
  return 0 2>/dev/null || true
fi

mode=""
start_count=""
dry_run=0
# THIRTY SECONDS, and it is a bound rather than a deadline. A worker signalled
# mid-prompt finishes the syscall it is in and exits; the two measured here took
# 2.1 s and 0.4 s. The bound exists for the one that does not, so a fleet stop
# ends in a fact rather than a stalled terminal.
wait_bound=30

while [ $# -gt 0 ]; do
  case "$1" in
    --status) mode=status ;;
    --once)   mode=once ;;
    # Only a bare number is consumed, the same rule `plot-dispatch.sh --start`
    # applies, so `--start --dry-run` means what it reads as.
    --start)  mode=start
              case "${2:-}" in
                ''|*[!0-9]*) ;;
                *) start_count="$2"; shift ;;
              esac ;;
    --stop)   mode=stop ;;
    --wait)   wait_bound="${2:?--wait needs a value}"
              case "$wait_bound" in
                ''|*[!0-9]*) echo "plot-fleetctl: --wait needs a number, got '$wait_bound'" >&2; exit 1 ;;
              esac
              shift ;;
    --dry-run) dry_run=1 ;;
    -h|--help) sed -n '2,27p' "$0"; exit 0 ;;
    *) echo "plot-fleetctl: unknown argument '$1'" >&2; exit 1 ;;
  esac
  shift
done

[ -n "$mode" ] || { echo "plot-fleetctl: one of --status, --once, --start, --stop is required" >&2; exit 1; }

# ---------------------------------------------------------------------------
# --status: processes, not work
# ---------------------------------------------------------------------------
#
# WHAT IS RUNNING HERE, not what the estate holds — that is /plot-pulse's
# question, and the split is the one that separated the two commands. Nothing is
# started: a status that started what it was asked about could never report an
# absence.
if [ "$mode" = "status" ]; then
  plat=$(platform)
  echo "platform: $plat"
  # THE STATE IS CAPTURED ONCE PER ARM, NOT ASKED AGAIN ON THE SUMMARY LINE.
  # `fleet_install_state` opens with `supervisor_loaded`, so calling it a second
  # time to compose the summary would ask launchd twice per status — and the
  # board's whole reading is bounded at 5,000 ms against a measured 4726–9770 ms
  # with three agents. Each arm below already knows its own answer.
  #
  # `none` IS SET HERE AND NOWHERE ELSE, because the `none` arm returns before
  # `fleet_install_state`'s case ever runs: the state machine cannot name a
  # machine with no init system, and that is the state whose printed repair the
  # board gets wrong. `--start` refuses it by design at REFUSAL 3.
  install_state=none
  # BOTH READINGS, TAKEN ONCE. The label and the process are different facts and
  # the arm needs both in three places — the prose, the `install=` field and the
  # exit code — so each is asked for exactly once here. `supervisor_loaded` was
  # called four times in this arm, twice AFTER the message was printed, and the
  # last of those composed the exit code: a change to the prose alone printed
  # the right sentence and still exited 0.
  sup_loaded=1
  sup_pid=""
  if [ "$plat" != "none" ]; then
    supervisor_loaded && sup_loaded=0
    [ "$sup_loaded" = 0 ] && sup_pid=$(supervisor_pid)
  fi
  if [ "$plat" = "none" ]; then
    echo "supervisor: no init system here — neither launchd nor systemd"
  elif [ "$sup_loaded" = 0 ] && [ -n "$sup_pid" ]; then
    install_state=running
    echo "supervisor: running (pid $sup_pid) — $LABEL"
    serves_line "$(supervisor_checkout)"
    # A pid is not a tick: measured 2026-09-23, this arm printed `running`
    # over a 25-hour-old log. The age is evidence and the state word stays.
    tick_age=$(tick_age_seconds)
    if [ -n "$tick_age" ]; then
      echo "  last tick: ${tick_age}s ago (evidence, not the verdict — a busy tick writes at most every 60s)"
    fi
    # THE RUNNING PROCESS ALREADY HOLDS THE OLD FILE OPEN, so a bundle removed
    # out from under it is invisible to the pid check above — the process does
    # not notice until it next restarts and the file is gone. Named here rather
    # than repaired: the fix is a rebuild or reinstall, a person's call.
    bundle=$(supervisor_bundle_path)
    [ -n "$bundle" ] && [ ! -f "$bundle" ] && printf '  BUNDLE MISSING: %s no longer exists — the loaded unit still names it\n    Rebuild it, or reinstall: /plot-fleet --stop, then /plot-fleet --start\n' "$bundle"
  elif [ "$sup_loaded" = 0 ]; then
    # THE LABEL IS HELD AND NOTHING IS BEHIND IT. Measured twice in ninety
    # minutes on 2026-09-22: `--status` said `running`, no `registryd.mjs`
    # process existed, and `launchctl list` showed the label with `-` in its
    # first column — launchd's own way of saying *no pid*. An operator was told
    # the fleet was healthy while dispatched slices sat unserved.
    #
    # THE TWO READINGS PRINT ON SEPARATE LINES rather than folding into one
    # verdict. That is what `plot-boardctl.sh --status` does and it is the only
    # part of that precedent which applies: its two-facts-must-agree rule
    # belongs to `--stop`, where a wrong guess kills a process.
    install_state="loaded-not-running"
    printf 'supervisor: LOADED, NOT RUNNING (%s) — %s holds the label and no process is behind it\n  label:   loaded\n  process: absent\n' "$LABEL" "$(platform)"
    serves_line "$(supervisor_checkout)"
    # THE TICK AGE IS EVIDENCE AND NEVER THE VERDICT. A log's mtime says when
    # the daemon last wrote, and a healthy supervisor between ticks has not
    # written for up to 60 s — so a reader gets the number and this derives
    # nothing from it.
    tick_log="$repo_root/.plot/logs/registryd.log"
    tick_age=$(tick_age_seconds)
    if [ -n "$tick_age" ]; then
      echo "  last tick: ${tick_age}s ago (evidence, not the verdict — a busy tick writes at most every 60s)"
    fi
    printf '  Most often a crash loop: KeepAlive restarts it and it exits again, so the label stays held.\n  Read why before restarting: %s\n  then repair it: /plot-fleet --stop, then /plot-fleet --start\n' "$tick_log"
  else
    # THREE STATES WHERE THERE WERE TWO, AND THE REPAIR IS PRINTED. The two
    # failures read identically to a person and cost differently: an operator
    # who reads *not loaded* and runs `--start` on a machine whose unit is
    # already filled pays for the wrong repair, and on one already running
    # agents may add more. Measured 2026-09-09 — the fleet was stopped for
    # hours, `launchctl list` showed no job, the plist sat on disk correct at
    # 5344 bytes, and one `launchctl bootstrap` restored it.
    #
    # THE EXIT CODE AND THE `summary:` LINE ARE UNCHANGED. Both are the board's
    # contract (`rules/supervisor-reading.ts`: 0 loaded, 1 not, the summary line
    # proving the code was the script's), so this widens the PROSE and nothing a
    # machine reads. What renders the third state on the board belongs to
    # `bug/the-board-says-the-fleet-is-stopped`.
    install_state=$(fleet_install_state unloaded)
    case "$install_state" in
      interrupted)
        unit=$(unit_target)
        echo "supervisor: NOT LOADED ($LABEL) — the unit is installed and launchd does not know it"
        echo "  A --start filled this unit and did not finish. Tell launchd about it:"
        case "$plat" in
          launchd) echo "    launchctl bootstrap gui/\$(id -u) $unit" ;;
          systemd) echo "    systemctl --user enable --now $UNIT_NAME" ;;
        esac
        echo "  Nothing needs re-cutting: /plot-fleet --start also does this, and starts agents too."
        ;;
      # THE ONE THAT LIED, and it lied about the machine rather than the fleet.
      # `installed` means the unit is on disk AND the last `--start` recorded
      # that it finished — `--stop` removes that marker only after a successful
      # unload (see the `--stop` arm below). So this state is reached exactly
      # when a completed start was followed by the supervisor dying or being
      # booted out ON ITS OWN: a crash, a logout, an OS update.
      #
      # It read *not installed — no unit on this machine*, which is false about
      # the machine and hides an unexplained death. An operator told the unit is
      # absent does not open the supervisor's log, and a supervisor that crashed
      # once will crash again after `--start`. The log is named here for that
      # reason: the repair is the same command, the DIAGNOSIS is what differs.
      installed)
        printf 'supervisor: STOPPED (%s) — a --start finished here and the supervisor is gone since\n  Nothing unloaded it: --stop clears this marker only after a clean unload.\n  So it died on its own — a crash, a logout, or an OS update.\n  Read why before restarting: .plot/logs/registryd.log\n  then start it: /plot-fleet --start\n' "$LABEL"
        ;;
      *)
        printf 'supervisor: not installed (%s) — no unit on this machine\n  start it: /plot-fleet --start\n' "$LABEL"
        ;;
    esac
  fi

  resolve_wt_root
  n_run=0 n_other=0
  for wt in "$wt_root"/"$wt_prefix"*; do
    [ -d "$wt" ] || continue
    # A DETACHED DESK IS NAMED RATHER THAN BLANK. `--start` cuts a free agent's
    # desk detached at origin/<main>, so an empty branch here is the normal
    # state of an agent holding no slice — not a broken reading.
    br=$(git -C "$wt" branch --show-current 2>/dev/null)
    [ -n "$br" ] || br="(detached) $(basename "$wt")"
    row=$(plot_worker_state "$wt")
    st=$(printf '%s' "$row" | cut -f1)
    pid=$(printf '%s' "$row" | cut -f2)
    if [ "$st" = "running" ]; then
      n_run=$((n_run + 1))
      # HOW LONG IDLE reads the log's mtime, not the process's start time. A
      # worker alive for six hours mid-prompt is not idle; one whose log has
      # not moved in six hours is exactly what a person wants named.
      quiet=""
      if [ -f "$wt/.plot-worker.log" ]; then
        now=$(date +%s)
        # GNU FIRST, as at the log reading above: GNU `stat -f` is a
        # filesystem report that succeeds, so asking BSD's form first hands
        # its text to the arithmetic below.
        touched=$(stat -c %Y "$wt/.plot-worker.log" 2>/dev/null || stat -f %m "$wt/.plot-worker.log" 2>/dev/null || echo "$now")
        case "$touched" in (''|*[!0-9]*) touched=$now ;; esac
        quiet=" — quiet $((now - touched))s"
      fi
      # A WAITING AGENT IS NAMED AS WAITING, because `quiet 2400s` on a worker
      # that is doing exactly what it should reads as a worker that stopped.
      # The loop writes `.plot-worker.limited` while it waits out a usage
      # limit; the reset is the first field and the same instant as ISO text is
      # the second, so this compares integers and prints the text.
      #
      # ONLY WHILE THE RESET IS AHEAD OF NOW. A record outliving its reset —
      # a worker SIGKILLed mid-wait, which leaves no trap to remove it — would
      # otherwise report a wait nothing is serving, for as long as the desk
      # stands. A past reset falls through to the quiet reading, which is the
      # honest one for a process that should have resumed and did not.
      if [ -r "$wt/.plot-worker.limited" ]; then
        lim_reset=$(cut -f1 < "$wt/.plot-worker.limited" 2>/dev/null | head -n1)
        lim_iso=$(cut -f2 < "$wt/.plot-worker.limited" 2>/dev/null | head -n1)
        case "$lim_reset" in
          ''|*[!0-9]*) ;;
          *) [ "$lim_reset" -gt "$(date +%s)" ] && quiet=" — waiting on a usage limit until $lim_iso" ;;
        esac
      fi
      echo "  $br  running (pid $pid)$quiet"
    else
      n_other=$((n_other + 1))
      echo "  $br  $st${pid:+ (pid $pid)}"
    fi
  done
  [ $((n_run + n_other)) -gt 0 ] || echo "  (no fleet worktrees under $wt_root)"
  # ON THIS LINE AND NOT BESIDE IT. The board tests for this line's PRESENCE to
  # decide `summarised` (`server/supervisor-reading.ts`, a substring test on
  # `summary:`), and that is what separates a script that finished from one
  # killed at a bounded wait. A field on its own line would be absent from
  # exactly the runs that most need explaining, and would weaken the
  # `unknown`/`down` split the whole rule exists for. An appended `key=value`
  # cannot break a substring test.
  #
  # THE EXIT CODE IS UNCHANGED — 0 loaded, 1 not. `supervisorState` gates on
  # exactly those two and answers `unknown` for everything else, so encoding the
  # state in the code would render `unknown` from every machine in the new
  # state. The state travels as a field precisely so the code does not have to.
  # BOTH FIELDS READ THE CAPTURE, and `supervisor=` follows the PROCESS rather
  # than the label. A loaded label with nothing behind it is not `up`: the
  # question a caller asks is *can I rely on it*, and there the answer is no.
  sup_word=down
  [ "$install_state" = running ] && sup_word=up
  # `tick_age=` ONLY IN THE RUNNING ARM, and only where a log exists. The board
  # reads an absent field as no reading, so a missing log never becomes 0.
  tick_field=""
  if [ "$install_state" = running ]; then
    tick_age=$(tick_age_seconds)
    [ -n "$tick_age" ] && tick_field=" tick_age=$tick_age"
  fi
  echo "summary: agents_running=$n_run agents_other=$n_other supervisor=$sup_word install=$install_state$tick_field"
  # EVERY PLOT PROCESS ON THE MACHINE, AFTER THE SUMMARY AND NEVER BEFORE IT.
  # The board reads the first `summary:` line; this block changes neither that
  # line nor the exit code below. It prints under every platform arm, `none`
  # included, because a board runs on a host with no init system.
  skip_pid=""
  [ "$install_state" = running ] && skip_pid=$sup_pid
  plot_processes_block "$skip_pid" || true
  # THE EXIT CODE COMES FROM THE CAPTURE, NEVER FROM A FRESH PROBE. This line
  # read `supervisor_loaded; exit $?` — a fourth call to the init system that
  # recomputed the verdict from the label alone, so a loaded-but-dead
  # supervisor printed the truth and still exited 0. The code a board branches
  # on was decided after the message and disagreed with it.
  #
  # THE CODE STAYS 0/1 AND DOES NOT CARRY THE NEW STATE. `supervisorState`
  # gates on exactly those two and answers `unknown` for everything else, so a
  # third code would render *could not ask* from precisely the machines that
  # most need an alarm. The state travels in `install=`.
  [ "$install_state" = running ] && exit 0
  exit 1
fi

# ---------------------------------------------------------------------------
# --once: the gate
# ---------------------------------------------------------------------------
if [ "$mode" = "once" ]; then
  [ -f "$fleetd" ] || {
    printf 'plot-fleetctl: no supervisor artifact at %s\n  Every bundle is tracked in git, so this is a broken or partial installation of Plot.\n  Reinstall or update the Plot plugin. In a development checkout of Plot, run '"'"'pnpm build:board'"'"'.\n' "$fleetd" >&2
    exit 1
  }
  exec node "$fleetd" --once
fi

# ---------------------------------------------------------------------------
# --start: probe, fill, load, then the agents
# ---------------------------------------------------------------------------
if [ "$mode" = "start" ]; then
  # REFUSAL 1 — nothing to start.
  [ -f "$fleetd" ] || {
    printf 'plot-fleetctl: no supervisor artifact at %s\n  The unit would name a file that does not exist.\n  Every bundle is tracked in git, so this is a broken or partial installation of Plot.\n  Reinstall or update the Plot plugin. In a development checkout of Plot, run '"'"'pnpm build:board'"'"'.\n' "$fleetd" >&2
    exit 1
  }

  # REFUSAL 2 — the wrong node. The unit bakes this path in permanently.
  node_bin=$(command -v node) || {
    echo "plot-fleetctl: no node on PATH — the unit needs an absolute path to it" >&2
    exit 1
  }
  # AN ABSENT PIN REFUSES. `.nvmrc` is tracked in Plot's repository and ships
  # in the plugin, so its absence is a broken installation — and reading it as
  # "no pin" is exactly how this refusal went silent in every consumer.
  want=$(pinned_major)
  if [ -z "$want" ]; then
    printf 'plot-fleetctl: cannot read Plot'"'"'s node pin at %s\n  The unit bakes '"'"'%s'"'"' in permanently, and without the pin nothing checks it.\n  Plot tracks .nvmrc in git, so this is a broken or partial installation of Plot.\n  Reinstall or update the Plot plugin, then run this again.\n' "$plot_nvmrc" "$node_bin" >&2
    exit 1
  fi
  have=$(running_major) || have=""
  if [ "$have" != "$want" ]; then
    printf 'plot-fleetctl: node on PATH is %s, Plot pins %s (%s)\n  The unit bakes '"'"'%s'"'"' in permanently, so a wrong one here is a\n  daemon that keeps failing after you have moved on.\n  Fix it: put node %s first on PATH (with nvm: nvm install %s && nvm use %s),\n  then run this again.\n' "${have:-unreadable}" "$want" "$plot_nvmrc" "$node_bin" "$want" "$want" "$want" >&2
    exit 1
  fi

  # REFUSAL 2b — no harness. The unit bakes the directory in permanently.
  #
  # THE DIRECTORY TRAVELS ON `PATH`, NOT AS `PLOT_HARNESS`. `plot-dispatch.sh`
  # exports `PLOT_HARNESS="$launch_harness"` on every launch, and that is empty
  # unless a charter names a harness — so a value the unit set there is
  # overwritten before the worker prompt reads it, and the prompt falls back to
  # a bare `command -v claude`. `PATH` reaches the worker unchanged, so putting
  # the resolved directory first makes that lookup answer this binary.
  #
  # THE EXIT CODE DECIDES, NOT THE OUTPUT. `command -v` exits non-zero and
  # prints nothing for a missing name. It prints a bare word for a builtin or a
  # function, which names no directory, so a non-absolute answer refuses too.
  harness_name=${PLOT_HARNESS:-claude}
  harness_bin=$(command -v "$harness_name") || harness_bin=""
  case "$harness_bin" in
    /*) harness_dir=$(dirname "$harness_bin") ;;
    *)
      if [ -n "${PLOT_HARNESS:-}" ]; then
        harness_reason="PLOT_HARNESS is set to '$PLOT_HARNESS', so that is the name looked for."
      else
        harness_reason="PLOT_HARNESS is unset, so the default name 'claude' was looked for."
      fi
      printf 'plot-fleetctl: cannot resolve the agent harness '"'"'%s'"'"' to a file on PATH\n  %s\n  The unit bakes the harness'"'"'s directory into its PATH permanently, and a\n  worker that cannot find its harness exits 127 after you have moved on.\n  Fix it: put the harness on PATH (or set PLOT_HARNESS to its name or\n  absolute path), check with '"'"'command -v %s'"'"', then run this again.\n' "$harness_name" "$harness_reason" "$harness_name" >&2
      exit 1
      ;;
  esac

  # REFUSAL 3 — no init system to hand the daemon to.
  plat=$(platform)
  if [ "$plat" = "none" ]; then
    printf 'plot-fleetctl: neither launchd nor systemd here — there is no unit to fill\n  Run the supervisor by hand instead: node %s\n' "$fleetd" >&2
    exit 1
  fi

  # THE OLD DEFAULT LABEL IS MIGRATED, NOT ORPHANED, and only on the new
  # default's own `--start` — a custom label never reaches this branch. A unit
  # still loaded under `com.plot-pm.registryd` and serving THIS checkout is the
  # same fleet under its old name; booting it out and removing its unit file
  # clears the way for the rename rather than leaving two supervisors' worth of
  # history for an operator to reconcile by hand. A unit under that old label
  # serving ANOTHER checkout is that checkout's lifecycle and is never touched.
  if [ "$LABEL" = com.plot-pm.fleetd ]; then
    new_label=$LABEL new_unit_name=$UNIT_NAME
    LABEL=com.plot-pm.registryd UNIT_NAME=plot-registryd
    if supervisor_loaded; then
      case "$(supervisor_checkout)" in
        this\ *)
          echo "plot-fleetctl: migrating the old label 'com.plot-pm.registryd' — it serves this repository"
          case "$plat" in
            launchd) launchctl bootout "gui/$(id -u)/com.plot-pm.registryd" 2>/dev/null
                      rm -f "$HOME/Library/LaunchAgents/com.plot-pm.registryd.plist" ;;
            systemd) systemctl --user disable --now plot-registryd 2>/dev/null
                      rm -f "$HOME/.config/systemd/user/plot-registryd.service"
                      systemctl --user daemon-reload 2>/dev/null ;;
          esac
          echo "  unloaded and removed — continuing under 'com.plot-pm.fleetd'" ;;
      esac
    fi
    LABEL=$new_label UNIT_NAME=$new_unit_name
  fi

  # REFUSAL 4 — the label is taken. launchd keys a job by LABEL, so loading a
  # second repository's unit over the first supervises the wrong estate without
  # saying anything.
  #
  # THE REFUSAL NAMES WHOSE SUPERVISOR HOLDS THE LABEL, and it refuses on all
  # three answers. Only the text differs; nothing is unloaded or written.
  if supervisor_loaded; then
    served=$(supervisor_checkout)
    case "$served" in
      this\ *)
        printf 'plot-fleetctl: '"'"'%s'"'"' is already loaded, serving THIS repository (%s)\n  The fleet is already supervised here. See it: /plot-fleet --status\n  To restart it: /plot-fleet --stop, then /plot-fleet --start\n' "$LABEL" "${served#this }" >&2
        ;;
      another\ *)
        printf 'plot-fleetctl: '"'"'%s'"'"' is already loaded, serving ANOTHER checkout (%s)\n  This repository is %s. That supervisor is not yours to stop.\n  Give this checkout its own label — skills/plot/units/README.md\n' "$LABEL" "${served#another }" "$repo_root" >&2
        ;;
      *)
        case "$plat" in
          launchd) how="launchctl print gui/\$(id -u)/$LABEL" ;;
          *)       how="systemctl --user show $UNIT_NAME" ;;
        esac
        printf 'plot-fleetctl: '"'"'%s'"'"' is already loaded, and which checkout it serves cannot be determined\n  %s names no working directory for it, so it may be another checkout'"'"'s.\n  Read it before stopping it: %s\n  Or, for a second checkout, give it its own label — skills/plot/units/README.md\n' "$LABEL" "$plat" "$how" >&2
        ;;
    esac
    exit 1
  fi

  if [ "$dry_run" = 1 ]; then
    printf 'state: %s\nwould fill and load %s (%s)\n  node:      %s (major %s, pinned %s)\n  harness:   %s (first on the unit'"'"'s PATH: %s)\n  fleetd:    %s\n  repo:      %s\nwould then start agents: plot-dispatch.sh --start %s\n' "$(fleet_install_state)" "$LABEL" "$plat" "$node_bin" "$have" "$want" "$harness_bin" "$harness_dir" "$fleetd" "$repo_root" "${start_count:-(default)}"
    exit 0
  fi

  mkdir -p "$repo_root/.plot/logs"
  mkdir -p "$repo_root/.plot/state"

  # THE MARKER IS CLEARED BEFORE THE WORK, NOT AFTER IT. It records that a run
  # FINISHED, so one left over from a previous run would survive this run's
  # interruption and report the very state this exists to catch. Between here
  # and the write at the end, every reading is `interrupted` — which is the
  # truth for exactly that window.
  rm -f "$(start_marker)"

  case "$plat" in
    launchd)
      template="$UNIT_DIR/com.plot-pm.fleetd.plist"
      target="$HOME/Library/LaunchAgents/$LABEL.plist"
      mkdir -p "$HOME/Library/LaunchAgents"
      ;;
    systemd)
      template="$UNIT_DIR/plot-fleetd.service"
      target="$HOME/.config/systemd/user/$UNIT_NAME.service"
      mkdir -p "$HOME/.config/systemd/user"
      ;;
  esac
  [ -f "$template" ] || { echo "plot-fleetctl: no unit template at $template" >&2; exit 1; }

  # THE LABEL IS FILLED, not only the filename. launchd keys a job by the
  # `Label` inside the plist, so an override that renamed the file alone loaded
  # under the default label (#1051). The systemd unit carries no label and the
  # expression finds nothing there.
  sed -e "s|__LABEL__|$LABEL|g" \
      -e "s|__REPO_ROOT__|$repo_root|g" \
      -e "s|__NODE__|$node_bin|g" \
      -e "s|__HARNESS_DIR__|$harness_dir|g" \
      -e "s|__FLEETD__|$fleetd|g" \
      "$template" > "$target" || { echo "plot-fleetctl: could not write $target" >&2; exit 1; }

  # THE FILL IS VERIFIED, not assumed. A placeholder that survived would install
  # a unit that fails at load with a path nobody typed — the failure the two
  # hand-run checks on 2026-09-05 were there to catch.
  # `grep -c` PRINTS ITS COUNT AND STILL EXITS 1 ON NO MATCH, so a `|| echo 0`
  # appends a SECOND zero and `left` becomes "0\n0" — never equal to "0", so a
  # correctly filled unit was deleted and refused. Measured 2026-09-07: this
  # refused every `--start` on a template with nothing left to fill.
  left=$(grep -c '__[A-Z_]*__' "$target" 2>/dev/null)
  case "$left" in (''|*[!0-9]*) left=0 ;; esac
  if [ "$left" -ne 0 ]; then
    echo "plot-fleetctl: $left placeholder(s) survived the fill in $target" >&2
    grep -n '__[A-Z_]*__' "$target" >&2
    rm -f "$target"
    exit 1
  fi
  echo "filled $target"

  case "$plat" in
    launchd)
      if command -v plutil >/dev/null 2>&1; then
        plutil -lint "$target" >/dev/null 2>&1 || {
          echo "plot-fleetctl: the filled plist does not parse" >&2
          plutil -lint "$target" >&2
          rm -f "$target"
          exit 1
        }
      fi
      launchctl bootstrap "gui/$(id -u)" "$target" || {
        echo "plot-fleetctl: launchctl bootstrap refused $target" >&2
        exit 1
      }
      ;;
    systemd)
      systemctl --user daemon-reload || {
        echo "plot-fleetctl: systemctl --user daemon-reload failed" >&2
        exit 1
      }
      systemctl --user enable --now "$UNIT_NAME" || {
        echo "plot-fleetctl: systemctl --user enable --now $UNIT_NAME failed" >&2
        exit 1
      }
      ;;
  esac
  pid=$(supervisor_pid)
  echo "supervisor loaded${pid:+ (pid $pid)} — $LABEL"
  echo "  log: $repo_root/.plot/logs/registryd.log"

  # THE AGENTS, because a supervisor with no agents does nothing. The count and
  # its default live in `plot-dispatch.sh --start`, which owns the machine bound
  # and the shortfall report; passing it through keeps one answer to "how many".
  echo "starting agents"
  if [ -n "$start_count" ]; then
    "$script_dir/plot-dispatch.sh" --start "$start_count"
  else
    "$script_dir/plot-dispatch.sh" --start
  fi
  start_rc=$?

  # THE RECORD THAT THE RUN FINISHED — the whole point of this file. Everything
  # above it can be interrupted, and cutting desks is where a run measurably
  # was: each is a `git worktree add`, twice in one session on 2026-09-09. Any
  # exit before this line leaves no marker, so `--status` names `interrupted`
  # and prints the one-line bootstrap instead of collapsing it into *not
  # installed*.
  #
  # WRITTEN ON THE DISPATCH'S OWN EXIT CODE. A dispatch that refused did not
  # finish, and a marker written regardless would say a run completed that did
  # not — the lie is in the direction nobody checks.
  if [ "$start_rc" = 0 ]; then
    date -u +%Y-%m-%dT%H:%M:%SZ > "$(start_marker)" 2>/dev/null || true
  else
    printf '  agents did not start cleanly — no completion marker written\n  /plot-fleet --status will report this run as interrupted.\n' >&2
  fi
  exit "$start_rc"
fi

# ---------------------------------------------------------------------------
# --stop: every agent through dispatch's rule, then the supervisor
# ---------------------------------------------------------------------------
if [ "$mode" = "stop" ]; then
  resolve_wt_root
  branches=""
  detached=""
  n=0
  n_detached=0
  for wt in "$wt_root"/"$wt_prefix"*; do
    [ -d "$wt" ] || continue
    row=$(plot_worker_state "$wt")
    [ "$(printf '%s' "$row" | cut -f1)" = "running" ] || continue
    br=$(git -C "$wt" branch --show-current 2>/dev/null)
    if [ -z "$br" ]; then
      # A FREE AGENT HAS NO BRANCH, and `plot-dispatch --stop` takes one. Its
      # refusal to guess is the rule this command orchestrates rather than
      # replaces, so a detached desk is REPORTED and left running — signalling
      # it here would be the second, laxer stop rule the design refuses.
      # Discovered 2026-09-05: `--start` cuts free desks detached at
      # origin/<main>, so this population exists whenever agents were started
      # and no slice has been handed over yet.
      detached="$detached  $(basename "$wt") (pid $(printf '%s' "$row" | cut -f2))"$'\n'
      n_detached=$((n_detached + 1))
      continue
    fi
    branches="$branches$br"$'\n'
    n=$((n + 1))
  done

  if [ "$n" = 0 ]; then
    echo "no agents on a branch; stopping the supervisor"
  else
    echo "stopping $n agent$([ "$n" = 1 ] || echo s), then the supervisor"
  fi
  if [ "$n_detached" -gt 0 ]; then
    echo "  $n_detached free agent(s) hold no branch and are LEFT RUNNING:"
    printf '%s' "$detached"
    echo "  plot-dispatch --stop takes a branch and refuses to guess. Stop one by pid,"
    echo "  or let the eight-hour Worker bound end it."
  fi

  still=""
  n_still=0
  while IFS= read -r br; do
    [ -n "$br" ] || continue
    wt="$wt_root/$wt_prefix$(printf '%s' "$br" | tr '/' '-')"
    row=$(plot_worker_state "$wt")
    pid=$(printf '%s' "$row" | cut -f2)
    printf '  %s  signalled' "$br"
    # ONE RULE FOR STOPPING AN AGENT, and it is dispatch's. Its output is hidden
    # because this run has its own line per branch; its EXIT CODE is not.
    if ! "$script_dir/plot-dispatch.sh" --stop "$br" >/dev/null 2>&1; then
      printf ' ... refused by plot-dispatch --stop — see: plot-dispatch.sh --stop %s\n' "$br"
      continue
    fi
    started=$(date +%s)
    exited=0
    while [ $(( $(date +%s) - started )) -lt "$wait_bound" ]; do
      row=$(plot_worker_state "$wt")
      [ "$(printf '%s' "$row" | cut -f1)" = "running" ] || { exited=1; break; }
      sleep 0.5
    done
    elapsed=$(( $(date +%s) - started ))
    if [ "$exited" = 1 ]; then
      # A REBUILT BUNDLE ALONE IS NOT "UNCOMMITTED WORK" — `main` rebuilds and
      # pushes every generated board bundle (`bug/main-builds-its-bundles`,
      # #1249), so a desk that locally rebuilt one to test holds nothing an
      # agent left behind. Excused the same way `desk_dirt` excuses it.
      dirty=$(git -C "$wt" status --porcelain 2>/dev/null | exclude_bundle_paths "$wt" | grep -c . || true)
      if [ "${dirty:-0}" -gt 0 ]; then
        printf ' ... exited (%ss), %s uncommitted file(s) kept\n' "$elapsed" "$dirty"
      else
        printf ' ... exited (%ss)\n' "$elapsed"
      fi
    else
      # NAMED, NOT WAITED ON FOREVER. The run carries on to the next branch and
      # the summary says which did not exit, so a person is left with a fact
      # rather than a stalled terminal.
      printf ' ... still running after %ss — kept, see below\n' "$wait_bound"
      still="$still  $br (pid ${pid:-unknown})"$'\n'
      n_still=$((n_still + 1))
    fi
  done <<EOF
$branches
EOF

  # THE SUPERVISOR GOES LAST. It is what would notice a desk falling idle, so
  # unloading it first leaves the agents unwatched for the length of the
  # shutdown, and a stop that fails partway leaves an unsupervised remainder.
  if supervisor_loaded; then
    case "$(platform)" in
      launchd) launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null ;;
      systemd) systemctl --user disable --now "$UNIT_NAME" >/dev/null 2>&1 ;;
    esac
    # THE UNLOAD IS VERIFIED TO A BOUND, NEVER ASKED ONCE. Measured 2026-09-24:
    # a single `supervisor_loaded` after `bootout` answered *loaded*, this
    # printed `supervisor did NOT unload`, and `launchctl print` moments later
    # exited 113 — the job was gone. The check reported a failure the world did
    # not have, and the marker it kept made the next `--status` announce a crash.
    #
    # THE MECHANISM IS UNDETERMINED AND THE POLL DOES NOT DEPEND ON ONE. No
    # reading exists from inside that window, so three candidates still fit:
    # teardown still running, launchd restarting the job under `KeepAlive`, or
    # `bootout` failing silently. A bounded poll is correct under all three —
    # the first finishes inside the bound, the other two are still loaded at it
    # and are honestly reported as unconfirmed.
    #
    # THE BOUND IS `--wait` AND NOT A NEW CONSTANT. `ExitTimeOut` is unset in
    # the plist, so launchd escalates SIGTERM to SIGKILL after 20 s, and
    # `registryd-main.ts` registers no signal handler — so a real teardown has
    # an upper bound and the existing 30 s default covers it with margin.
    #
    # THE SHAPE IS THE AGENT LOOP'S, thirty lines above. Three open-coded
    # copies of it exist here and in `plot-boardctl.sh`; this is the fourth,
    # deliberately, rather than a helper extracted for one caller.
    started=$(date +%s)
    unloaded=0
    while [ $(( $(date +%s) - started )) -lt "$wait_bound" ]; do
      supervisor_loaded || { unloaded=1; break; }
      sleep 0.5
    done
    if [ "$unloaded" = 1 ]; then
      echo "  supervisor unloaded"
      # THE MARKER GOES WITH THE SUPERVISOR, and only once it is actually gone.
      # It records that a `--start` finished; a deliberate stop ends the run it
      # described, so leaving it would report `installed` over a fleet somebody
      # chose to end. A unit that did NOT unload keeps its marker, because the
      # run it recorded is still the live one.
      rm -f "$(start_marker)"
    else
      # REPORTED, NEVER KILLED. `plot-boardctl.sh --stop` escalates to
      # `kill -KILL` at `:528`; this deliberately does not. Ending a wedged
      # supervisor is a person's call, and the refusal names what to look at.
      #
      # THE PID IS THE READING THAT WAS MISSING on 2026-09-24. A pid different
      # from the one this run signalled says launchd restarted the job under
      # `KeepAlive`; the same pid says the teardown is stuck.
      sup_pid_now=$(supervisor_pid)
      printf '  supervisor did NOT unload within %ss — %s is still loaded (pid %s)\n  The start marker is kept: the run it records is still the live one.\n' "$wait_bound" "$LABEL" "${sup_pid_now:-unknown}"
      # SET, NOT EXITED ON. The agent summary below prints after this block, and
      # an early exit here swallows it when agents and supervisor both fail.
      sup_unconfirmed=1
    fi
  else
    echo "  supervisor was not loaded"
  fi

  if [ "$n_still" -gt 0 ]; then
    echo "$n_still agent(s) did not exit within ${wait_bound}s:"
    printf '%s' "$still"
    echo "Each desk and claim stands. Look in the worktree, or raise the bound: --wait N"
  fi
  # ONE EXIT FOR BOTH FAILURES, and both reports print first. Exit 1 says an
  # agent did not exit, or the unload was not confirmed, or both — a stop that
  # printed a failure may never exit 0.
  if [ "$n_still" -gt 0 ] || [ "${sup_unconfirmed:-0}" = 1 ]; then
    exit 1
  fi
  exit 0
fi
