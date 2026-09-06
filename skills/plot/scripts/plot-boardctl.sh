#!/usr/bin/env bash
# Plot helper: board control — the door to the local Kanban board.
# Usage: plot-boardctl.sh --status
#        plot-boardctl.sh --start [--port N] [--dry-run]
#        plot-boardctl.sh --stop [--port N] [--wait SECONDS]
#   --status  does a board answer, on which port, since when, and for which
#             repository. Starts nothing, stops nothing. Exit 0 when a board
#             answers on the port, 1 when none does, so a caller can gate on it
#             without parsing prose.
#   --start   resolve the artifact through `plot-board-probe.sh`, start the
#             board in the background, record the tree's root pid, and leave it
#             running. Refuses when `artifact_source` is `none`.
#   --stop    stop the board's process TREE, and only when the pidfile and the
#             port agree about which tree that is.
#   --port N  which port to ask about (default 7777, the port the board binds).
#   --wait S  seconds to wait for the tree to exit before escalating to KILL
#             (default 10).
#   --dry-run with --start: report the artifact, the port and the command; start
#             nothing and write nothing.
# Output: prose for a person, one line per fact. Exit 0 on success.
#
# THE STARTING LOGIC MOVED HERE FROM `/plot-board-setup --start`, whole. It
# resolves the artifact through the probe, refuses on `artifact_source: none`,
# and warns when `cwd_is_root` is false because the board compares realpaths and
# silently shows nothing from a subdirectory. What changed is which command owns
# it, not what it does.
#
# --stop FINDS THE BOARD BY TWO FACTS THAT MUST AGREE: the pid `--start`
# recorded, and whoever is listening on the port. It stops only when the two
# describe the same process tree, and where they disagree it refuses and says
# which.
#
# NEITHER FACT IS SUFFICIENT ALONE. A pidfile outlives its process — which is
# why `plot-worker-state.sh` never reads one without `ps` beside it, and why a
# recycled pid is the worse half of that failure. And the port alone finds
# whichever board answers, which on a machine running several is not necessarily
# this repository's.
#
# THE BOARD IS A TREE, NOT A PID. Measured 2026-09-05 on the live board:
#
#     9518  9490  node --watch skills/plot/scripts/board/board-server.mjs
#    27674  9518  node skills/plot/scripts/board/board-server.mjs
#
# `node --watch` (9518) supervises the child that binds the port (27674), so the
# port answers with the CHILD. The pidfile holds the ROOT; the port's listener
# must be that pid or a descendant of it, and that relation IS the agreement —
# equality alone would refuse every healthy two-process board.
#
# KILLING ONLY THE CHILD LEAVES THE TREE HALF-ALIVE. Measured 2026-09-06 on a
# board started as `node --watch`: a SIGTERM to the port-holder killed it and
# the watcher went on running, reparented to init, with NOTHING serving the
# port. `--watch` respawns on a file change rather than on its child's death, so
# the survivor is a process holding no port and doing no work — which reads to
# `ps` exactly like a running board.
#
# AND NEVER BY PATTERN MATCH. On 2026-09-04 a `pkill -f 'board-server.mjs'`
# killed an operator's board along with the stale jobs it was aimed at. A
# pattern over process names matches every board on the machine, including the
# ones belonging to other checkouts; the two-fact rule refuses exactly that
# guess.
#
# IT TOUCHES THE SUPERVISOR NOWHERE. `DESIGN-process.md` §1: fleet control and
# the board are independent systems that share a machine, and the two process
# trees share no edge. This script never reads `plot-registryd`, never asks
# launchd anything, and never calls `plot-fleetctl.sh`.
#
# AND IT ANSWERS NO ESTATE QUESTION. Which waves are eligible and which branches
# are claimed is `/plot-pulse`'s question. Everything here is about processes on
# this machine.
set -uo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# THE PORT THE BOARD BINDS, and the default rather than a choice. Several
# worktrees run boards side by side and the server reports `already running`
# rather than taking a held port, so a start that picked its own port would
# scatter boards an operator then cannot find.
DEFAULT_PORT=7777

git rev-parse --git-dir >/dev/null 2>&1 || { echo "plot-boardctl: not a git repository" >&2; exit 1; }
repo_root=$(git rev-parse --show-toplevel)

# `.plot/state/` is machine-local and gitignored, which is what a pidfile has to
# be: it names a process on one laptop, and a checked-in one would tell another
# clone that its board is running.
state_dir="$repo_root/.plot/state"
pidfile="$state_dir/board.pid"
logfile="$repo_root/.plot/logs/board.log"

# ---------------------------------------------------------------------------
# The two facts
# ---------------------------------------------------------------------------

# FACT ONE — the pid `--start` recorded, or empty. The file is read for its
# CONTENT only; whether that pid is alive is a separate question, asked below,
# because a pidfile outlives its process.
recorded_pid() {
  [ -f "$pidfile" ] || return 1
  local p
  p=$(tr -dc '0-9' < "$pidfile" 2>/dev/null)
  [ -n "$p" ] || return 1
  printf '%s' "$p"
}

alive() { [ -n "${1:-}" ] && kill -0 "$1" 2>/dev/null; }

# FACT TWO — who is listening on the port, or empty. `lsof` is the one question
# that has an authoritative answer: the OS knows which process holds the socket.
# Measured 2026-09-05: it answers 27674, the CHILD, where the pidfile holds 9518.
listening_pid() {
  command -v lsof >/dev/null 2>&1 || return 1
  local p
  p=$(lsof -ti "tcp:$port" -sTCP:LISTEN 2>/dev/null | head -1)
  [ -n "$p" ] || return 1
  printf '%s' "$p"
}

# Walk a pid's ancestry, bounded. THE AGREEMENT IS AN ANCESTRY, not an equality:
# the recorded pid is the tree's root and the port's listener is a descendant of
# it, so `pid == root` and `pid's parent chain reaches root` are both agreement.
# Bounded at 12 hops because a cycle in the process table would otherwise be an
# infinite loop, and no board tree is more than two deep.
descends_from() { # descends_from <pid> <ancestor>
  local p="$1" anc="$2" hops=0
  while [ -n "$p" ] && [ "$p" != "0" ] && [ "$p" != "1" ] && [ "$hops" -lt 12 ]; do
    [ "$p" = "$anc" ] && return 0
    p=$(ps -o ppid= -p "$p" 2>/dev/null | tr -d ' ')
    hops=$((hops + 1))
  done
  return 1
}

# Every live descendant of a pid, deepest first, plus the pid itself last. What
# `--stop` signals: the TREE, in an order where a watcher is never left holding
# a child it would restart.
#
# ONE `ps` READING AND ONE `awk` PASS, and the second half is a measurement
# rather than a style. Measured 2026-09-06 on this machine: `ps -eo pid=` lists
# **1109 processes**, and a shell loop forking `awk` once per line to read the
# two columns took **10.6 s per pass** — with a frontier loop around it, a
# `--stop` that should take under a second exceeded 120 s and was killed before
# it printed anything. A fleet host is exactly the machine with a process table
# that size, so the walk happens inside one `awk` process.
#
# THE SNAPSHOT IS ALSO WHY. Asking `ps` per pid would let the table move under
# the walk, and a child spawned between two readings reads as absent.
tree_pids() { # tree_pids <root>
  ps -eo pid=,ppid= 2>/dev/null | awk -v root="$1" '
    { parent[$1] = $2; pids[n++] = $1 }
    END {
      depth[root] = 0
      # Bounded at 12 hops: a cycle in the process table would otherwise loop
      # forever, and no board tree is more than two deep.
      for (pass = 0; pass < 12; pass++) {
        for (i = 0; i < n; i++) {
          p = pids[i]
          if (p in depth) continue
          if (parent[p] in depth) depth[p] = depth[parent[p]] + 1
        }
      }
      # Deepest first, then the root: the watcher goes last, so it is never
      # asked to outlive a child it would replace.
      for (d = 12; d >= 0; d--)
        for (i = 0; i < n; i++)
          if (pids[i] in depth && depth[pids[i]] == d) printf "%s ", pids[i]
    }'
}

# Does a board ANSWER on the port, and for which repository? `/api/board`
# carries `server.repo` — the realpath of the checkout the board serves — so
# this is what distinguishes *your* board from another installation's holding
# the same port. Prints "<repo>" on success; empty when nothing answers.
board_repo() {
  command -v curl >/dev/null 2>&1 || return 1
  local body
  # THIRTY SECONDS, and the margin is measured. A cold first fetch against a
  # 59-plan repo took 8.7–9.5 s on 2026-08-19 while the warm one took ~1.7 s; a
  # 10 s ceiling turns a healthy board into a reported failure on a loaded
  # machine.
  body=$(curl -sf --max-time 30 "http://localhost:$port/api/board" 2>/dev/null) || return 1
  printf '%s' "$body" | node -e '
    let s = "";
    process.stdin.on("data", d => (s += d)).on("end", () => {
      try { process.stdout.write(String(JSON.parse(s)?.server?.repo ?? "")); }
      catch { process.exitCode = 1; }
    });
  ' 2>/dev/null
}

# ---------------------------------------------------------------------------
# Arguments
# ---------------------------------------------------------------------------
mode=""
port="$DEFAULT_PORT"
dry_run=0
# TEN SECONDS, and a bound rather than a deadline. A board asked to stop closes
# its listener and exits; the bound exists for the one that does not, so a stop
# ends in a fact rather than a stalled terminal.
wait_bound=10

while [ $# -gt 0 ]; do
  case "$1" in
    --status) mode=status ;;
    --start)  mode=start ;;
    --stop)   mode=stop ;;
    --port)   port="${2:?--port needs a value}"
              case "$port" in
                ''|*[!0-9]*) echo "plot-boardctl: --port needs a number, got '$port'" >&2; exit 1 ;;
              esac
              shift ;;
    --wait)   wait_bound="${2:?--wait needs a value}"
              case "$wait_bound" in
                ''|*[!0-9]*) echo "plot-boardctl: --wait needs a number, got '$wait_bound'" >&2; exit 1 ;;
              esac
              shift ;;
    --dry-run) dry_run=1 ;;
    -h|--help) sed -n '2,21p' "$0"; exit 0 ;;
    *) echo "plot-boardctl: unknown argument '$1'" >&2; exit 1 ;;
  esac
  shift
done

[ -n "$mode" ] || { echo "plot-boardctl: one of --status, --start, --stop is required" >&2; exit 1; }

# ---------------------------------------------------------------------------
# --status: processes, not work
# ---------------------------------------------------------------------------
#
# WHETHER THE BOARD ANSWERS, ON WHICH PORT, SINCE WHEN, AND WHOSE IT IS. What
# the estate is doing is /plot-pulse's question. Nothing is started: a status
# that started what it was asked about could never report an absence.
if [ "$mode" = "status" ]; then
  echo "port: $port"

  rec=$(recorded_pid) || rec=""
  if [ -n "$rec" ]; then
    if alive "$rec"; then
      since=""
      started=$(ps -o lstart= -p "$rec" 2>/dev/null | sed 's/^ *//')
      [ -n "$started" ] && since=" — started $started"
      echo "pidfile: $rec (running)$since"
    else
      # A PIDFILE OUTLIVES ITS PROCESS, and this is the state that says so. It
      # is reported rather than repaired: removing it here would delete the
      # evidence `--stop` reads to name the disagreement.
      echo "pidfile: $rec (STALE — no such process)"
    fi
  else
    echo "pidfile: none at $pidfile"
  fi

  lp=$(listening_pid) || lp=""
  if [ -z "$lp" ]; then
    if command -v lsof >/dev/null 2>&1; then
      echo "port $port: nothing listening"
    else
      echo "port $port: cannot tell — lsof is not installed"
    fi
  else
    echo "port $port: pid $lp listening"
  fi

  # THE THIRD FACT, and the only one that says WHOSE board it is. Two boards on
  # one machine are indistinguishable by pid or port alone; `server.repo` names
  # the checkout each serves.
  served=$(board_repo) || served=""
  if [ -n "$served" ]; then
    here=$(cd "$repo_root" && pwd -P)
    there=$(cd "$served" 2>/dev/null && pwd -P) || there="$served"
    if [ "$here" = "$there" ]; then
      echo "answers: yes — serving THIS repository ($served)"
    else
      echo "answers: yes — serving ANOTHER checkout ($served)"
      echo "  This repository is $here. That board is not yours to stop."
    fi
  elif [ -n "$lp" ]; then
    echo "answers: no — something holds the port but /api/board did not respond"
  else
    echo "answers: no"
  fi

  [ -n "$lp" ]
  exit $?
fi

# ---------------------------------------------------------------------------
# --start: the artifact, the background process, the recorded root
# ---------------------------------------------------------------------------
if [ "$mode" = "start" ]; then
  probe=$("$script_dir/plot-board-probe.sh" 2>/dev/null) || {
    echo "plot-boardctl: the board probe failed — cannot resolve an artifact" >&2
    exit 1
  }
  read_field() {
    printf '%s' "$probe" | node -e '
      let s = "";
      const key = process.argv[1];
      process.stdin.on("data", d => (s += d)).on("end", () => {
        try { process.stdout.write(String(JSON.parse(s)?.[key] ?? "")); }
        catch { process.exitCode = 1; }
      });
    ' "$1" 2>/dev/null
  }
  artifact=$(read_field artifact)
  artifact_source=$(read_field artifact_source)
  cwd_is_root=$(read_field cwd_is_root)

  # REFUSAL — there is nothing to start. Reported, never repaired: a repo that
  # needs setup should be told to run setup.
  if [ "$artifact_source" = "none" ] || [ -z "$artifact" ]; then
    echo "plot-boardctl: no board artifact — nothing to start" >&2
    echo "  Install one: the Plot plugin, or npx @plot-pm/board" >&2
    echo "  Then adopt the board here: /plot-board-setup" >&2
    exit 1
  fi

  # A WARNING, NOT A REFUSAL. The board compares realpaths, so one started from
  # a subdirectory serves nothing and says nothing about why.
  if [ "$cwd_is_root" != "true" ]; then
    echo "warning: this is not the repository root — the board compares realpaths," >&2
    echo "         and one started elsewhere shows an empty estate. Starting from $repo_root." >&2
  fi

  # THE INVOCATION FOLLOWS `artifact_source`, which the probe already reported.
  # The npm path came from `command -v plot-board`, so it is an executable shim
  # that may be a wrapper script rather than the module — `node <wrapper>` fails
  # on that one.
  case "$artifact_source" in
    npm) cmd_desc="$artifact" ;;
    *)   cmd_desc="node $artifact" ;;
  esac

  if [ "$dry_run" = 1 ]; then
    echo "would start the board"
    echo "  artifact: $artifact ($artifact_source)"
    echo "  command:  $cmd_desc"
    echo "  cwd:      $repo_root"
    echo "  port:     $port"
    echo "  pidfile:  $pidfile"
    exit 0
  fi

  # A BOARD ALREADY ON THE PORT IS NOT STARTED OVER. The server itself reports
  # `already running` and exits 0 rather than taking a held port, and a start
  # that shot the holder down would be the failure the port policy exists to
  # avoid. Report whose it is and stop.
  existing=$(listening_pid) || existing=""
  if [ -n "$existing" ]; then
    served=$(board_repo) || served=""
    echo "a board already holds port $port (pid $existing)"
    if [ -n "$served" ]; then
      here=$(cd "$repo_root" && pwd -P)
      there=$(cd "$served" 2>/dev/null && pwd -P) || there="$served"
      if [ "$here" = "$there" ]; then
        echo "  it serves THIS repository — nothing to do: http://localhost:$port"
        exit 0
      fi
      echo "  it serves ANOTHER checkout ($served), not $here"
      echo "  Never stop a board you did not start without asking. Use --port N for a second board."
      exit 1
    fi
    echo "  it did not answer /api/board, so whose it is cannot be told"
    echo "  Ask it directly, or start this one on another port: --port N"
    exit 1
  fi

  mkdir -p "$state_dir" "$(dirname "$logfile")"

  # STARTED FROM THE REPO ROOT, because the board reads the CWD and compares
  # realpaths. `setsid`/`nohup` is deliberately NOT used: the tree must stay
  # reachable by ancestry from the pid recorded below, and detaching would not
  # change that but would hide the tree behind an init reparent the moment the
  # starting shell exits.
  (
    cd "$repo_root" || exit 1
    if [ "$artifact_source" = "npm" ]; then
      PORT="$port" exec "$artifact" >>"$logfile" 2>&1
    else
      PORT="$port" exec node "$artifact" >>"$logfile" 2>&1
    fi
  ) &
  root_pid=$!

  # THE RECORDED PID IS THE TREE'S ROOT, and that is the whole point of writing
  # it. The port will answer with a descendant — `node --watch` supervises the
  # child that binds — so a pidfile holding the listener would name a process
  # whose death is repaired by its own parent.
  printf '%s\n' "$root_pid" > "$pidfile"

  # WAIT FOR THE PORT, not for the process. Exit 0 is not evidence: the server
  # treats `EADDRINUSE` as a report and exits 0, so a start proved by its exit
  # code proves nothing. The board answering is the evidence.
  waited=0
  while [ "$waited" -lt 40 ]; do
    lp=$(listening_pid) && [ -n "$lp" ] && break
    alive "$root_pid" || break
    sleep 0.5
    waited=$((waited + 1))
  done

  if ! alive "$root_pid"; then
    echo "plot-boardctl: the board exited during start — it did not come up" >&2
    echo "  log: $logfile" >&2
    tail -20 "$logfile" 2>/dev/null >&2
    rm -f "$pidfile"
    exit 1
  fi

  served=$(board_repo) || served=""
  if [ -z "$served" ]; then
    echo "plot-boardctl: started (pid $root_pid) but /api/board did not answer" >&2
    echo "  A board that did not come up must say so. log: $logfile" >&2
    exit 1
  fi

  here=$(cd "$repo_root" && pwd -P)
  there=$(cd "$served" 2>/dev/null && pwd -P) || there="$served"
  echo "Plot board: http://localhost:$port"
  echo "  started by this run (tree root pid $root_pid)"
  echo "  serving: $served"
  [ "$here" = "$there" ] || echo "  WARNING: that is not this repository ($here)"
  echo "  pidfile: $pidfile"
  echo "  log:     $logfile"
  exit 0
fi

# ---------------------------------------------------------------------------
# --stop: two facts that must agree, then the tree
# ---------------------------------------------------------------------------
if [ "$mode" = "stop" ]; then
  rec=$(recorded_pid) || rec=""
  lp=$(listening_pid) || lp=""

  # DISAGREEMENT IS NAMED, NEVER GUESSED THROUGH. Each of the four shapes below
  # is a different question, and answering any of them with a pattern match over
  # process names is the 2026-09-04 failure this command exists to prevent.
  if [ -z "$rec" ] && [ -z "$lp" ]; then
    echo "no board to stop: no pidfile at $pidfile, and nothing listening on port $port"
    exit 0
  fi

  if [ -z "$rec" ]; then
    echo "plot-boardctl: refusing — pid $lp holds port $port, but this repository recorded no board" >&2
    echo "  Something is serving that port and /plot-board did not start it. It may be" >&2
    echo "  another checkout's board, or one started by hand." >&2
    echo "  Ask it whose it is: /plot-board --status" >&2
    exit 1
  fi

  if ! alive "$rec"; then
    echo "plot-boardctl: refusing — the pidfile names $rec, which is not running" >&2
    if [ -n "$lp" ]; then
      echo "  Port $port is held by pid $lp, which this repository did not record." >&2
      echo "  A pidfile outlives its process, and the pid may since have been recycled." >&2
    else
      echo "  Nothing is listening on port $port either: the board is already gone." >&2
      echo "  Clear the record: rm $pidfile" >&2
    fi
    exit 1
  fi

  if [ -z "$lp" ]; then
    echo "plot-boardctl: refusing — pid $rec is running, but nothing is listening on port $port" >&2
    echo "  The recorded process is alive and is not serving this port, so stopping it" >&2
    echo "  would end a process whose identity is unproven." >&2
    echo "  Look at it: ps -p $rec -o command=" >&2
    exit 1
  fi

  # THE AGREEMENT. The listener must BE the recorded pid or descend from it —
  # `node --watch` supervises the child that binds, so equality alone would
  # refuse every healthy board this command starts.
  if ! descends_from "$lp" "$rec"; then
    echo "plot-boardctl: refusing — the pidfile and the port name different trees" >&2
    echo "  pidfile: $rec (running)" >&2
    echo "  port $port: pid $lp, which does not descend from $rec" >&2
    echo "  Two boards are involved, or the pid was recycled. Stopping either on this" >&2
    echo "  evidence would be a guess." >&2
    echo "  Look at both: ps -p $rec,$lp -o pid=,ppid=,command=" >&2
    exit 1
  fi

  # THE TREE, DEEPEST FIRST. Killing only the port-holder leaves the watcher
  # running with nothing serving — measured above — which reads to `ps` like a
  # board that is still up.
  pids=$(tree_pids "$rec")
  echo "stopping the board on port $port"
  echo "  tree: $(printf '%s' "$pids" | tr -s ' ')"
  for p in $pids; do
    kill -TERM "$p" 2>/dev/null
  done

  waited=0
  while [ "$waited" -lt $((wait_bound * 2)) ]; do
    alive "$rec" || break
    sleep 0.5
    waited=$((waited + 1))
  done

  if alive "$rec"; then
    # ESCALATED, NOT WAITED ON FOREVER, and only over the tree already proved to
    # be this board's. The escalation inherits the two-fact evidence; it does
    # not widen the target.
    echo "  did not exit within ${wait_bound}s — sending KILL to the same tree"
    for p in $pids; do
      kill -KILL "$p" 2>/dev/null
    done
    sleep 1
  fi

  if alive "$rec"; then
    echo "plot-boardctl: pid $rec is still running after KILL" >&2
    echo "  The pidfile is left in place: it is the evidence for a second attempt." >&2
    exit 1
  fi

  rm -f "$pidfile"
  still=$(listening_pid) || still=""
  if [ -n "$still" ]; then
    # THE PORT IS RE-ASKED, because the stop's success is a fact about the port
    # rather than about the signal. A survivor here is a DIFFERENT board that
    # took the freed port, and it is reported rather than pursued.
    echo "  stopped. Note: pid $still now holds port $port — another board took it."
  else
    echo "  stopped. Nothing is listening on port $port."
  fi
  exit 0
fi
