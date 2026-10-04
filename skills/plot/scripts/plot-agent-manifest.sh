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
# Defines four functions and does nothing else on load: `clear_manifest_branch`;
# `plot_session_id`, which `plot-dispatch.sh` calls to launch an agent and
# `plot-worker-loop.sh` calls when a hop moves the agent to a new branch; and
# `manifest_resume_id` with `session_handle`, the conversation handle that the
# loop passes to the prompt and the loop's own watcher probes for a transcript.

# ONE READER FOR EVERY STRING FIELD a manifest carries, and one for every
# counter. Six callers read one field each — `branch`, `session`, `worktree`,
# `resumeId`, `attempts`, `correctionAttempts` — and each carried its own
# fourteen-line copy of the same read-parse-default dance. The copies answered
# identically and drifted only in the field name, so the name is the argument.
#
# ABSENT, UNREADABLE AND WRONG-TYPED ARE ONE ANSWER, which is the contract
# every caller already documents: nothing for a string (status 1), `0` for a
# counter. A manifest that cannot be read is not permission to do anything, and
# a counter that cannot be read also cannot be raised.
manifest_string() { # $1=manifest $2=field → prints the value, or nothing
  local manifest="$1" value
  [ -n "$manifest" ] && [ -f "$manifest" ] || return 1
  value=$(node -e '
    const fs = require("fs");
    try {
      const manifest = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
      const v = manifest[process.argv[2]];
      process.stdout.write(typeof v === "string" ? v : "");
    } catch { process.stdout.write(""); }
  ' "$manifest" "$2" 2>/dev/null) || return 1
  [ -n "$value" ] || return 1
  printf '%s' "$value"
}

# A non-negative integer field, or `0`.
manifest_count() { # $1=manifest $2=field → prints a count
  local manifest="$1" n
  [ -n "$manifest" ] && [ -f "$manifest" ] || { printf '0'; return 0; }
  n=$(node -e '
    const fs = require("fs");
    try {
      const manifest = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
      const n = manifest[process.argv[2]];
      process.stdout.write(Number.isInteger(n) && n >= 0 ? String(n) : "0");
    } catch { process.stdout.write("0"); }
  ' "$manifest" "$2" 2>/dev/null) || n=0
  case "$n" in (*[!0-9]*|'') n=0 ;; esac
  printf '%s' "$n"
}

# Raise a non-negative integer field by one, leaving every other field verbatim.
#
# THROUGH A TEMP FILE AND A RENAME, the shape every writer here takes: a reader
# never sees a partial manifest. A write that fails leaves the file alone and
# reports it; an absent manifest is not a failure.
raise_manifest_count() { # $1=manifest $2=field
  local manifest="$1"
  [ -n "$manifest" ] && [ -f "$manifest" ] || return 0
  local tmp="$manifest.plot-count-tmp"
  node -e '
    const fs = require("fs");
    const [file, field, tmp] = process.argv.slice(1);
    const manifest = JSON.parse(fs.readFileSync(file, "utf8"));
    const n = manifest[field];
    manifest[field] = (Number.isInteger(n) && n >= 0 ? n : 0) + 1;
    fs.writeFileSync(tmp, JSON.stringify(manifest, null, 2) + "\n");
  ' "$manifest" "$2" "$tmp" 2>/dev/null || { rm -f "$tmp"; return 1; }
  mv -f "$tmp" "$manifest" 2>/dev/null || { rm -f "$tmp"; return 1; }
}

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

# The resume handle the manifest carries, or nothing while it carries none.
#
# A SECOND FIELD, NOT AN ALIAS FOR `session`. A dispatch writes the same value
# into both, and they part at the first hop to a new branch: `session` names the
# agent and its manifest file for the agent's whole life, while `resumeId` names
# the current slice's conversation and is what the board joins the transcript
# on. Reading this field rather than `$PLOT_SESSION_ID` is what makes the
# hop's write (`update_manifest_on_hop` in `plot-worker-loop.sh`) mean anything:
# a reader asks for the handle, and gets the one the hop last wrote.
#
# A PARSE FAILURE AND AN ABSENT MANIFEST ARE ONE ANSWER, the shape
# `assigned_branch` in `plot-worker-loop.sh` already takes: no handle. A hand-started loop has no
# manifest, and a manifest nobody can read is not a handle.
manifest_resume_id() { # $1=manifest → prints the handle, or nothing
  manifest_string "$1" resumeId
}

# THE HANDLE THE PROMPT CARRIES — the manifest's `resumeId`, or the launch id.
#
# `resumeId` IS ASKED FIRST BECAUSE IT IS THE FIELD THE HOP WRITES. A dispatch
# writes the launch id into both `session` and `resumeId`, so on a first slice
# the two answers are the same string and this reads as a no-op. It stops being
# one the moment the handle diverges from the join key — which is what the two
# fields exist to allow, and what a later `--fork-session` would do. The loop
# calls this for the prompt and its own watcher calls it for the idle verdict,
# so both ask about one conversation.
#
# `$PLOT_SESSION_ID` IS THE FALLBACK, NOT THE SOURCE. A hand-started loop has no
# manifest and a pre-`resumeId` manifest carries no handle; both are the launch
# id, which is what the prompt passed before this function existed. An absent
# manifest is not an absent session.
session_handle() { # → the handle, or nothing
  local id
  if id=$(manifest_resume_id "${PLOT_MANIFEST_FILE:-}"); then
    printf '%s' "$id"
    return 0
  fi
  [ -n "${PLOT_SESSION_ID:-}" ] || return 1
  printf '%s' "$PLOT_SESSION_ID"
}

# The live agents whose manifests name a branch, for `claimAnswer`'s
# `holders` — one session id per line, in the directory's own order.
#
# ASKS EACH MANIFEST'S OWN DESK, never the branch's checkout: an agent just
# handed the branch has not checked it out, so a check against the branch's
# worktree would answer nothing even while that agent's own desk is alive and
# genuinely holds the slice. `queue-reading.ts:302` takes the same `running` or
# `waiting` bar; a dead agent's manifest is not a holder (#1039's negative
# control).
#
# `$2` AND `$3` EXCLUDE DIFFERENT THINGS, and a caller supplies at most one.
# `plot-dispatch.sh --release` has no asker and excludes `release_wt` instead —
# the desk its OWN live-worker refusal already checks, so this must not
# duplicate that refusal's case with a different message for the same desk.
# `plot-worker-loop.sh`'s rejection excludes its OWN manifest file instead —
# the supervisor wrote the rejected branch into it before the push, so
# counting it would answer `held-by-agent` on every rejection.
live_holders_of_branch() { # $1=registry_dir $2=branch $3=exclude_manifest $4=exclude_worktree → "session\tworktree" lines
  local dir="$1" branch="$2" exclude_manifest="${3:-}" exclude_worktree="${4:-}" m m_branch m_session m_wt
  [ -d "$dir" ] || return 0
  for m in "$dir"/*.json; do
    [ -f "$m" ] || continue
    [ -n "$exclude_manifest" ] && [ "$m" = "$exclude_manifest" ] && continue
    read -r m_branch m_session m_wt <<<"$(node -e '
      try {
        const m = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"));
        process.stdout.write([m.branch, m.session, m.worktree].map((v) => typeof v === "string" && v !== "" ? v : "-").join(" "));
      } catch { process.stdout.write("- - -"); }
    ' "$m" 2>/dev/null)"
    [ "$m_branch" = "$branch" ] || continue
    [ "$m_wt" != "-" ] && [ -d "$m_wt" ] || continue
    [ -n "$exclude_worktree" ] && [ "$m_wt" = "$exclude_worktree" ] && continue
    case "$(plot_worker_state "$m_wt" "" | cut -f1)" in
      running|waiting) printf '%s\t%s\n' "$m_session" "$m_wt" ;;
    esac
  done
}

# WHAT A CLAIM MEANS, ASKED OF THE DOMAIN. One of `claimAnswer`'s five words,
# or nothing when the bundle is absent — a checkout that vendored the skills
# without building the board answers no question rather than a wrong one.
#
# ONE ASKER FOR BOTH CALLERS. `plot-dispatch.sh --release` asks with `ref:
# unknown` and no log, because `held-by-agent` follows from `holders` alone;
# `plot-worker-loop.sh`'s rejection path supplies all three. The JSON shape is
# the bundle's contract, and two hand-built copies of it would drift.
claim_answer() { # $1=bundle $2=ref $3=log $4=holders, newline-separated → the word, or nothing
  [ -f "$1" ] || return 1
  printf '%s\n' "$4" | node -e '
    const holders = require("fs").readFileSync(0, "utf8").split("\n").filter(Boolean);
    const [ref, log] = process.argv.slice(1);
    process.stdout.write(JSON.stringify({ ref, log: ref === "present" ? log : null, holders }));
  ' "$2" "$3" | node "$1" 2>/dev/null | cut -f1
}
