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
#   no plot-registryd.mjs      nothing to start; point at `pnpm build:board`
#   node is not the pinned major
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
# `supervisor: running` from the operator's live registryd, and the four-state
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
LABEL="${PLOT_FLEET_LABEL:-com.plot-pm.registryd}"
UNIT_DIR="$script_dir/../units"

git rev-parse --git-dir >/dev/null 2>&1 || { echo "plot-fleetctl: not a git repository" >&2; exit 1; }
repo_root=$(git rev-parse --show-toplevel)
registryd="$repo_root/skills/plot/scripts/board/plot-registryd.mjs"

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

# The major the repository pins. `.nvmrc` is the one place that says it; the two
# `engines` blocks say `>=24`, which is a floor rather than the pin.
pinned_major() {
  local v
  v=$(tr -d ' \tv\n' < "$repo_root/.nvmrc" 2>/dev/null)
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
    systemd) systemctl --user is-active --quiet plot-registryd && return 0 ;;
  esac
  return 1
}

# The supervisor's pid, or empty. Asked separately from liveness because a
# loaded-but-not-running job is a real state and the two answers differ.
supervisor_pid() {
  case "$(platform)" in
    launchd) launchctl print "gui/$(id -u)/$LABEL" 2>/dev/null \
               | sed -n 's/^[[:space:]]*pid = \([0-9]*\).*/\1/p' | head -1 ;;
    systemd) systemctl --user show plot-registryd -p MainPID --value 2>/dev/null \
               | grep -v '^0$' ;;
  esac
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
    systemd) printf '%s' "$HOME/.config/systemd/user/plot-registryd.service" ;;
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
fleet_install_state() {
  supervisor_loaded && { echo running; return; }
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
# THE SAME COMPOSITION `plot-dispatch.sh` USES, because the two must enumerate
# the same population: a stop that missed a desk would report a fleet stopped
# while a worker kept writing to it.
resolve_wt_root() { # sets wt_root, wt_prefix
  local configured
  configured=$("$script_dir/plot-config.sh" get "Worktree root" "")
  if [ -z "$configured" ]; then
    wt_root=$(cd "$repo_root/.." && pwd)
    wt_prefix="plot-wt-"
    return
  fi
  case "$configured" in
    /*) wt_root="$configured" ;;
    *)  wt_root="$repo_root/$configured" ;;
  esac
  wt_root="${wt_root%/}"
  wt_prefix=""
}
resolve_wt_root

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
  if [ "$plat" = "none" ]; then
    echo "supervisor: no init system here — neither launchd nor systemd"
  elif supervisor_loaded; then
    pid=$(supervisor_pid)
    echo "supervisor: running${pid:+ (pid $pid)} — $LABEL"
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
    case "$(fleet_install_state)" in
      interrupted)
        unit=$(unit_target)
        echo "supervisor: NOT LOADED ($LABEL) — the unit is installed and launchd does not know it"
        echo "  A --start filled this unit and did not finish. Tell launchd about it:"
        case "$plat" in
          launchd) echo "    launchctl bootstrap gui/\$(id -u) $unit" ;;
          systemd) echo "    systemctl --user enable --now plot-registryd" ;;
        esac
        echo "  Nothing needs re-cutting: /plot-fleet --start also does this, and starts agents too."
        ;;
      *)
        echo "supervisor: not installed ($LABEL) — no unit on this machine"
        echo "  start it: /plot-fleet --start"
        ;;
    esac
  fi

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
        touched=$(stat -f %m "$wt/.plot-worker.log" 2>/dev/null || stat -c %Y "$wt/.plot-worker.log" 2>/dev/null || echo "$now")
        quiet=" — quiet $((now - touched))s"
      fi
      echo "  $br  running (pid $pid)$quiet"
    else
      n_other=$((n_other + 1))
      echo "  $br  $st${pid:+ (pid $pid)}"
    fi
  done
  [ $((n_run + n_other)) -gt 0 ] || echo "  (no fleet worktrees under $wt_root)"
  echo "summary: agents_running=$n_run agents_other=$n_other supervisor=$(supervisor_loaded && echo up || echo down)"
  supervisor_loaded
  exit $?
fi

# ---------------------------------------------------------------------------
# --once: the gate
# ---------------------------------------------------------------------------
if [ "$mode" = "once" ]; then
  [ -f "$registryd" ] || {
    echo "plot-fleetctl: no supervisor artifact at $registryd" >&2
    echo "  Build it: pnpm build:board" >&2
    exit 1
  }
  exec node "$registryd" --once
fi

# ---------------------------------------------------------------------------
# --start: probe, fill, load, then the agents
# ---------------------------------------------------------------------------
if [ "$mode" = "start" ]; then
  # REFUSAL 1 — nothing to start.
  [ -f "$registryd" ] || {
    echo "plot-fleetctl: no supervisor artifact at $registryd" >&2
    echo "  The unit would name a file that does not exist. Build it: pnpm build:board" >&2
    exit 1
  }

  # REFUSAL 2 — the wrong node. The unit bakes this path in permanently.
  node_bin=$(command -v node) || {
    echo "plot-fleetctl: no node on PATH — the unit needs an absolute path to it" >&2
    exit 1
  }
  want=$(pinned_major)
  have=$(running_major) || have=""
  if [ -n "$want" ] && [ "$have" != "$want" ]; then
    echo "plot-fleetctl: node on PATH is ${have:-unreadable}, this repository pins $want" >&2
    echo "  The unit bakes '$node_bin' in permanently, so a wrong one here is a" >&2
    echo "  daemon that keeps failing after you have moved on." >&2
    echo "  Fix it: nvm use, then run this again." >&2
    exit 1
  fi

  # REFUSAL 3 — no init system to hand the daemon to.
  plat=$(platform)
  if [ "$plat" = "none" ]; then
    echo "plot-fleetctl: neither launchd nor systemd here — there is no unit to fill" >&2
    echo "  Run the supervisor by hand instead: node $registryd" >&2
    exit 1
  fi

  # REFUSAL 4 — the label is taken. launchd keys a job by LABEL, so loading a
  # second repository's unit over the first supervises the wrong estate without
  # saying anything.
  if supervisor_loaded; then
    echo "plot-fleetctl: '$LABEL' is already loaded" >&2
    echo "  One supervisor per repository, and the label carries no repository name." >&2
    echo "  Stop this one: /plot-fleet --stop" >&2
    echo "  Or, for a second checkout, give it its own label — skills/plot/units/README.md" >&2
    exit 1
  fi

  if [ "$dry_run" = 1 ]; then
    echo "state: $(fleet_install_state)"
    echo "would fill and load $LABEL ($plat)"
    echo "  node:      $node_bin (major $have, pinned $want)"
    echo "  registryd: $registryd"
    echo "  repo:      $repo_root"
    echo "would then start agents: plot-dispatch.sh --start ${start_count:-(default)}"
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
      template="$UNIT_DIR/com.plot-pm.registryd.plist"
      target="$HOME/Library/LaunchAgents/$LABEL.plist"
      mkdir -p "$HOME/Library/LaunchAgents"
      ;;
    systemd)
      template="$UNIT_DIR/plot-registryd.service"
      target="$HOME/.config/systemd/user/plot-registryd.service"
      mkdir -p "$HOME/.config/systemd/user"
      ;;
  esac
  [ -f "$template" ] || { echo "plot-fleetctl: no unit template at $template" >&2; exit 1; }

  sed -e "s|__REPO_ROOT__|$repo_root|g" \
      -e "s|__NODE__|$node_bin|g" \
      -e "s|__REGISTRYD__|$registryd|g" \
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
      systemctl --user enable --now plot-registryd || {
        echo "plot-fleetctl: systemctl --user enable --now plot-registryd failed" >&2
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
    echo "  agents did not start cleanly — no completion marker written" >&2
    echo "  /plot-fleet --status will report this run as interrupted." >&2
  fi
  exit "$start_rc"
fi

# ---------------------------------------------------------------------------
# --stop: every agent through dispatch's rule, then the supervisor
# ---------------------------------------------------------------------------
if [ "$mode" = "stop" ]; then
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
      dirty=$(git -C "$wt" status --porcelain 2>/dev/null | grep -c . || true)
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
      systemd) systemctl --user disable --now plot-registryd >/dev/null 2>&1 ;;
    esac
    if supervisor_loaded; then
      echo "  supervisor did NOT unload — $LABEL is still loaded"
    else
      echo "  supervisor unloaded"
      # THE MARKER GOES WITH THE SUPERVISOR, and only once it is actually gone.
      # It records that a `--start` finished; a deliberate stop ends the run it
      # described, so leaving it would report `installed` over a fleet somebody
      # chose to end. A unit that did NOT unload keeps its marker, because the
      # run it recorded is still the live one.
      rm -f "$(start_marker)"
    fi
  else
    echo "  supervisor was not loaded"
  fi

  if [ "$n_still" -gt 0 ]; then
    echo "$n_still agent(s) did not exit within ${wait_bound}s:"
    printf '%s' "$still"
    echo "Each desk and claim stands. Look in the worktree, or raise the bound: --wait N"
    exit 1
  fi
  exit 0
fi
