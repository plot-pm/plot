#!/usr/bin/env bash
# Plot helper: the ONE writer that clears an agent manifest's `branch` field.
#
# SOURCED, NOT RUN — the shape `plot-worker-state.sh` and `plot-pr-merged.sh`
# already take. Two scripts clear an assignment and must clear it one way:
#
#   - `plot-worker-loop.sh` clears its own manifest when a slice finishes, so
#     the window before the next hand-over is observable as `branch: ""`;
#   - `plot-dispatch.sh --release <branch>` clears every manifest naming an
#     abandoned slice, beside deleting the claim ref.
#
# The function lived inside `plot-worker-loop.sh` until the second caller
# arrived. The loop is a script, not a library, so sourcing it would run it; the
# body moved here unchanged and the loop sources this file instead.
#
# Defines two functions and does nothing else on load: `clear_manifest_branch`,
# and `plot_session_id`, which `plot-dispatch.sh` calls to launch an agent and
# `plot-worker-loop.sh` calls when a hop moves the agent to a new branch.

# Clear `branch` when a slice finishes, so the window before the next one is
# observable.
#
# WHY THIS EXISTS. `free = process alive AND manifest names no branch`, and the
# second half was unreachable. `seal_declaration` runs the moment a branch is
# done; `update_manifest_on_hop` runs after `--next` answers and a worktree is
# built. Between those two points the agent genuinely holds no slice and the
# manifest still named the last one, so `isFree`'s empty-branch arm — written,
# exported and unit-tested since `a-dispatch-asks-for-a-free-agent` — had no
# production caller that could ever satisfy it. Measured 2026-09-02: 2
# manifests on this estate, neither ever carrying `branch: ""`.
#
# `branch` AND ONLY `branch`. `worktree` still names the desk the agent is
# sitting at — it has not moved, and clearing it would take the transcript join
# and the liveness check with it, since both are keyed on the worktree path.
# `wavesCount` counts hops and no hop has happened yet. The node one-liner
# round-trips the whole object, so every other field survives verbatim, the same
# property `update_manifest_on_hop` records.
#
# ADDED, NOT SUBSTITUTED. The hop still rewrites `branch` and `worktree`
# together; this writes the empty value that sits between two slices. A worker
# that finishes its last branch exits with the manifest cleared and the exit
# trap removes the file, so the empty value is never a leftover.
#
# ABSENT IS NOT A FAILURE. No manifest — a hand-started loop, an older
# dispatcher — means there is nothing to clear and nothing to report, so this
# returns 0 like `update_manifest_on_hop` does.
clear_manifest_branch() { # $1=manifest
  local manifest="$1"
  [ -f "$manifest" ] || return 0

  local tmp="$manifest.plot-free-tmp"
  node -e '
    const fs = require("fs");
    const manifest = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
    manifest.branch = "";
    fs.writeFileSync(process.argv[2], JSON.stringify(manifest, null, 2) + "\n");
  ' "$manifest" "$tmp" 2>/dev/null || { rm -f "$tmp"; return 1; }

  mv -f "$tmp" "$manifest" 2>/dev/null || { rm -f "$tmp"; return 1; }
}

# A session id, in the shape the runtime uses for its transcript filename.
#
# `uuidgen` where it exists (macOS and most Linux), falling back to `/dev/urandom`
# — never to `$RANDOM` or a timestamp. Two workers launched in the same second by
# the same fan-out would collide on either, and a collision here silently merges
# two agents into one manifest.
#
# Lowercased because the runtime writes its transcript filename in lowercase and
# the board joins on exact string equality; `uuidgen` on macOS returns uppercase.
plot_session_id() {
  local id=""
  if command -v uuidgen >/dev/null 2>&1; then
    id=$(uuidgen 2>/dev/null | tr 'A-Z' 'a-z')
  fi
  if [ -z "$id" ]; then
    # 16 random bytes rendered as a v4-shaped id. The shape matters only for
    # recognisability; nothing parses it.
    id=$(od -An -tx1 -N16 /dev/urandom 2>/dev/null | tr -d ' \n' \
         | sed -E 's/(.{8})(.{4})(.{4})(.{4})(.{12})/\1-\2-\3-\4-\5/')
  fi
  printf '%s' "$id"
}
