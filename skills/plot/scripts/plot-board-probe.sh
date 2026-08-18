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

cat <<JSON
{
  "node": "$(j "$node_ver")",
  "node_ok": $node_ok,
  "bash": true,
  "git_root": "$(j "$git_root")",
  "cwd_is_root": $cwd_is_root,
  "artifact": "",
  "artifact_source": "none",
  "has_plot_config": $has_config,
  "plan_dir": "$(j "$plan_dir")",
  "plan_files": $plan_files,
  "git_host": "$(j "$git_host")",
  "gh":  {"installed": false, "auth": "unknown"},
  "bb":  {"installed": false, "auth": "unknown"},
  "jen": {"installed": false, "auth": "unknown", "instance": ""},
  "ci_signals": {"jenkinsfile": $jenkinsfile, "gh_workflows": $gh_workflows}
}
JSON
