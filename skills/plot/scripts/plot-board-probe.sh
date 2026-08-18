#!/usr/bin/env bash
# Plot helper: board adoption probe — can the board run here, and what is
# already configured?
# Usage: plot-board-probe.sh
# Output: one JSON object, for /plot-board-setup to PROPOSE from rather than
#         interviewing the user about facts already visible.
#
# STRICTLY READ-ONLY. This runs in a stranger's repo before anything has been
# agreed to, so it must not create, modify, or delete anything — not even a
# directory, and never a server it forgets to stop. Starting the board is the
# SKILL's job (step 4), where the user has consented.
#
# It DECIDES NOTHING. Every field is a fact; which artifact to recommend,
# whether Jenkins keys are warranted, and what an empty board means are all
# judgments left to the skill (Manifesto Principle 3).
#
# Fields:
#   node            `node --version` output, or "" when node is absent
#   node_ok         true when node's major version is >= 20 (the artifact's
#                   esbuild target, and what its shipped README requires)
#   bash            always true if this ran, but reported for completeness
#   git_root        `git rev-parse --show-toplevel`
#   cwd_is_root     true when CWD *is* the repo root. The board requires
#                   equality, not containment: board.ts compares realpaths and
#                   silently drops branch-staged plans when they differ.
#   artifact        absolute path to a runnable board-server.mjs, or ""
#   artifact_source plugin | npm | checkout | none  (resolved in that order)
#   has_plot_config true when a hub doc carries a `## Plot Config`
#   plan_dir        the configured plan directory (default docs/plans/)
#   plan_files      count of *.md under plan_dir (0 when it does not exist)
#   git_host        the configured `Git host` key, or ""
#   gh|bb|jen       {"installed":bool,"auth":"ok|failed|unknown"}
#                   jen additionally carries "instance"
#   ci_signals      {"jenkinsfile":bool,"gh_workflows":bool}
#
# `auth` IS A THREE-STATE ENUM, NEVER A BOOLEAN. "unknown" is what an
# unrecognised output produces, and it must read as *cannot verify*, never as
# *authenticated*. This is the failure direction plot-host.sh adopted after the
# 2026-08-17 GitHub 503 afternoon, when every branch read as having no PR:
# being wrong in the reassuring direction is the worst way to be wrong,
# because nobody investigates a green light.
set -uo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

j() { printf '%s' "$1" | sed 's/\\/\\\\/g; s/"/\\"/g'; }

git rev-parse --git-dir >/dev/null 2>&1 || {
  echo '{"error":"not a git repository"}'; exit 1;
}

# --- runtime ------------------------------------------------------------
node_ver=""
node_ok=false
if command -v node >/dev/null 2>&1; then
  node_ver=$(node --version 2>/dev/null || true)
  major=${node_ver#v}
  major=${major%%.*}
  case "$major" in
    ''|*[!0-9]*) node_ok=false ;;
    *) [ "$major" -ge 20 ] && node_ok=true ;;
  esac
fi

# --- repo shape ---------------------------------------------------------
git_root=$(git rev-parse --show-toplevel 2>/dev/null || echo "")
cwd_is_root=false
if [ -n "$git_root" ]; then
  # realpath both sides: the board compares resolved paths, so a symlinked
  # checkout must not read as a mismatch here when the board accepts it.
  a=$(cd "$git_root" 2>/dev/null && pwd -P)
  b=$(pwd -P)
  [ "$a" = "$b" ] && cwd_is_root=true
fi

# --- plot config --------------------------------------------------------
has_config=false
for f in "$git_root/CLAUDE.md" "$git_root/AGENTS.md"; do
  [ -f "$f" ] && grep -qi "^##[[:space:]]*plot config" "$f" 2>/dev/null && {
    has_config=true; break;
  }
done

plan_dir=$(bash "$here/plot-config.sh" get "Plan directory" "docs/plans/" 2>/dev/null || echo "docs/plans/")
git_host=$(bash "$here/plot-config.sh" get "Git host" "" 2>/dev/null || echo "")

plan_files=0
if [ -n "$git_root" ] && [ -d "$git_root/$plan_dir" ]; then
  plan_files=$(find "$git_root/$plan_dir" -maxdepth 1 -name '*.md' -type f 2>/dev/null | wc -l | tr -d ' ')
fi

# --- ci signals ---------------------------------------------------------
jenkinsfile=false
[ -n "$git_root" ] && [ -f "$git_root/Jenkinsfile" ] && jenkinsfile=true
gh_workflows=false
[ -n "$git_root" ] && [ -d "$git_root/.github/workflows" ] && gh_workflows=true

# --- board artifact -----------------------------------------------------
# Precedence: plugin, then npm, then this checkout. The plugin wins because it
# tracks the installed plot version; npm 'latest' has lagged behind it.
# PLOT_PLUGIN_ROOT / PLOT_NPM_BIN exist so tests need not depend on $HOME.
#
# The plugin layout is Claude Code's. Cursor has no such directory, so the
# search simply finds nothing there and precedence falls through to npm —
# no host detection needed, and no branch that could rot.
artifact=""
artifact_source="none"

# mtime, portably: BSD/macOS `stat -f %m`, GNU/Linux `stat -c %Y`.
#
# MEASURED 2026-08-18 on alpine (busybox) and confirmed against this repo's
# Linux CI: `stat -f '%m' FILE` there does NOT fail cleanly. GNU/busybox read
# `-f` as `--file-system`, fail on `%m` as a missing path, and then STILL
# print a multi-line filesystem report for FILE before exiting 1. So a
# `bsd || gnu` chain runs both halves and concatenates their stdout — the
# caller gets seven lines of "Block size: 4096 …" with the real mtime tacked
# on the end, and the arithmetic that consumes it dies on a non-integer.
# `2>/dev/null` hides the error message but not the partial output.
#
# So the form is DETECTED ONCE against a known file rather than attempted per
# call: exactly one branch may ever write to stdout. Probing `-c` first is
# deliberate — GNU is the one that mis-parses the other's flag, so asking it
# its own question first means the ambiguous form is never reached on Linux.
_stat_fmt=""
if [ -n "$(stat -c '%Y' "${BASH_SOURCE[0]}" 2>/dev/null)" ]; then
  _stat_fmt="gnu"
elif [ -n "$(stat -f '%m' "${BASH_SOURCE[0]}" 2>/dev/null)" ]; then
  _stat_fmt="bsd"
fi
mtime() {
  case "$_stat_fmt" in
    gnu) stat -c '%Y' "$1" 2>/dev/null ;;
    bsd) stat -f '%m' "$1" 2>/dev/null ;;
    *)   return 1 ;;
  esac
}

plugin_root="${PLOT_PLUGIN_ROOT:-$HOME/.claude/plugins}"

# MEASURED 2026-08-18: this glob matched THREE artifacts on a normal machine —
# the live `marketplaces/` copy and two historical `cache/<version>/` copies,
# one of them a 2.0.0 build two weeks stale. `sort | tail -1` was the first
# attempt and it is wrong twice over: it picks the lexically-last PATH (right
# there only because `marketplaces` > `cache`), and version directories sort
# lexically, so `2.10.0` < `2.5.0`. It returned the correct file for reasons
# unrelated to what it claimed to check.
#
# So: `marketplaces/` explicitly, because that IS the installed copy and
# `cache/<version>/` is history. Newest mtime only as a fallback for layouts
# without it.
cand=$(find "$plugin_root/marketplaces" -type f -name 'board-server.mjs' -path '*/board/*' 2>/dev/null | head -1)
if [ -z "$cand" ]; then
  best=""; best_m=-1
  while IFS= read -r f; do
    m=$(mtime "$f"); [ -n "$m" ] || continue
    if [ "$m" -gt "$best_m" ]; then best_m="$m"; best="$f"; fi
  done < <(find "$plugin_root" -type f -name 'board-server.mjs' -path '*/board/*' 2>/dev/null)
  cand="$best"
fi
if [ -n "$cand" ] && [ -f "$cand" ]; then
  artifact="$cand"; artifact_source="plugin"
fi

if [ -z "$artifact" ]; then
  npm_bin="${PLOT_NPM_BIN:-}"
  if [ -z "$npm_bin" ] && command -v plot-board >/dev/null 2>&1; then
    npm_bin=$(command -v plot-board)
  fi
  if [ -n "$npm_bin" ] && [ -x "$npm_bin" ]; then
    artifact="$npm_bin"; artifact_source="npm"
  fi
fi

if [ -z "$artifact" ] && [ -n "$git_root" ] &&
   [ -f "$git_root/skills/plot/scripts/board/board-server.mjs" ]; then
  artifact="$git_root/skills/plot/scripts/board/board-server.mjs"
  artifact_source="checkout"
fi

# --- CLI auth -----------------------------------------------------------
# THREE STATES, NOT TWO. An unrecognised output is "unknown" — *cannot
# verify* — and never "ok". A blocklist of known-bad phrasings would go stale
# into silence; an allowlist of known-good ones goes stale into noise, and
# noise is the direction that gets investigated.
#
# The regexes below match UNDOCUMENTED CLI output, MEASURED 2026-08-18 against
# gh 2.x, bb, and jen. Upstream may reword any of them without notice; when
# that happens the state degrades to "unknown" (cannot verify) rather than to
# "ok", so drift surfaces as a visible question rather than a false green.
# Re-measure and update the date if you touch these.
#
# The exit code alone decides nothing for jen: measured 2026-08-18,
# `jen -I <slug> auth status` exits 0 and prints "Keycloak: signed in" for a
# slug that does not exist, because the slug expands into a URL pattern
# without being reached. Only the `Jenkins auth:` line carries the answer.

cli_installed() { command -v "$1" >/dev/null 2>&1 && echo true || echo false; }

# $1 = command output, $2 = exit status, $3 = success regex
classify() {
  local out="$1" status="$2" ok_re="$3"
  if printf '%s' "$out" | grep -qiE "$ok_re"; then echo ok
  elif [ "$status" -ne 0 ]; then echo failed
  else echo unknown
  fi
}

gh_installed=$(cli_installed gh); gh_auth="unknown"
if [ "$gh_installed" = true ]; then
  out=$(gh auth status 2>&1); st=$?
  gh_auth=$(classify "$out" "$st" 'logged in to')
fi

bb_installed=$(cli_installed bb); bb_auth="unknown"
if [ "$bb_installed" = true ]; then
  out=$(bb auth status 2>&1); st=$?
  bb_auth=$(classify "$out" "$st" 'logged in as')
fi

jen_installed=$(cli_installed jen); jen_auth="unknown"
jen_instance=$(bash "$here/plot-config.sh" get "Jenkins instance" "" 2>/dev/null || echo "")
[ -n "$jen_instance" ] || jen_instance="${JENKINS_INSTANCE:-}"
if [ "$jen_installed" = true ]; then
  if [ -n "$jen_instance" ]; then
    out=$(jen -I "$jen_instance" auth status 2>&1); st=$?
    # `NOT reachable` must be tested BEFORE `reachable`, since it contains it.
    if printf '%s' "$out" | grep -qiE 'jenkins auth:[[:space:]]*not reachable'; then
      jen_auth="failed"
    else
      jen_auth=$(classify "$out" "$st" 'jenkins auth:[[:space:]]*reachable')
    fi
  else
    # No instance means the only runnable form is the one that verifies
    # nothing. Report that we cannot tell, never that it is fine.
    jen_auth="unknown"
  fi
fi

cat <<JSON
{
  "node": "$(j "$node_ver")",
  "node_ok": $node_ok,
  "bash": true,
  "git_root": "$(j "$git_root")",
  "cwd_is_root": $cwd_is_root,
  "artifact": "$(j "$artifact")",
  "artifact_source": "$artifact_source",
  "has_plot_config": $has_config,
  "plan_dir": "$(j "$plan_dir")",
  "plan_files": $plan_files,
  "git_host": "$(j "$git_host")",
  "gh":  {"installed": $gh_installed, "auth": "$gh_auth"},
  "bb":  {"installed": $bb_installed, "auth": "$bb_auth"},
  "jen": {"installed": $jen_installed, "auth": "$jen_auth", "instance": "$(j "$jen_instance")"},
  "ci_signals": {"jenkinsfile": $jenkinsfile, "gh_workflows": $gh_workflows}
}
JSON
