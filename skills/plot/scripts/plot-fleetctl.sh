#!/usr/bin/env bash
# Plot helper: fleet control — the door to the supervisor and the agents.
# Usage: plot-fleetctl.sh --status
#        plot-fleetctl.sh --once
#        plot-fleetctl.sh --start [N] [--dry-run]
#        plot-fleetctl.sh --stop [--wait SECONDS]
#   --status    is the supervisor alive, how many agents are running, how long
#               each has been idle — with pids. Starts nothing. Exit 0 when the
#               supervisor is loaded, 1 when it is not, so a caller can gate on
#               it without parsing prose.
#   --once      one supervisor tick against the live estate, then exit. THE
#               GATE: the tick decides and performs nothing, so this is free and
#               proves the daemon works before any unit is installed.
#   --start [N] probe, fill the unit, load it, then bring up N free agents
#               through `plot-dispatch.sh --start`. N is optional and passed
#               through: the count and its default live there.
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

LABEL="com.plot-pm.registryd"
UNIT_DIR="$script_dir/../units"

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
supervisor_loaded() {
  case "$(platform)" in
    launchd) launchctl print "gui/$(id -u)/$LABEL" >/dev/null 2>&1 ;;
    systemd) systemctl --user is-active --quiet plot-registryd ;;
    *) return 1 ;;
  esac
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
    echo "supervisor: not loaded ($LABEL)"
    echo "  start it: /plot-fleet --start"
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
    echo "would fill and load $LABEL ($plat)"
    echo "  node:      $node_bin (major $have, pinned $want)"
    echo "  registryd: $registryd"
    echo "  repo:      $repo_root"
    echo "would then start agents: plot-dispatch.sh --start ${start_count:-(default)}"
    exit 0
  fi

  mkdir -p "$repo_root/.plot/logs"

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
  left=$(grep -c '__[A-Z_]*__' "$target" 2>/dev/null || echo 0)
  if [ "$left" != "0" ]; then
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
  exit $?
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
