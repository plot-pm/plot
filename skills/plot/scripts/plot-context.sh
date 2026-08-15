#!/usr/bin/env bash
# Plot helper: what Plot contributes to a session log someone else writes.
# Usage: plot-context.sh
# Output: one JSON object — which plan governs the current branch, its phase,
#         its wave position, and the PRs it carries.
#
# PLOT DOES NOT WRITE SESSION LOGS. Tools like the `bye` skill do that far
# better: they reconstruct compacted session history, classify session types,
# and guard against parallel sessions — none of which a plan-shaped tool can
# know. This script is the SUPPLIER for those tools, not a competing author.
#
# Read-only, and deliberately silent rather than speculative: if the current
# branch belongs to no plan, every plan field is empty. A durable decision
# record attributed to the wrong plan is worse than one with no attribution,
# because the mistake outlives the session that made it.
set -uo pipefail

script_dir=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
cfg() { "$script_dir/plot-config.sh" get "$1" "${2:-}"; }

j() { printf '%s' "$1" | sed 's/\\/\\\\/g; s/"/\\"/g'; }

git rev-parse --git-dir >/dev/null 2>&1 || { echo '{"error":"not a git repository"}'; exit 1; }

branch=$(git branch --show-current 2>/dev/null || true)
ACTIVE_DIR=$(cfg "Active index" "docs/plans/active/")
PREFIX_RE=$(cfg "Branch prefixes" "idea/, feature/, bug/, docs/, infra/" \
  | tr -d ' ' | tr ',' '\n' | sed 's#/$##' | grep -v '^$' | paste -sd'|' -)
[ -n "$PREFIX_RE" ] || PREFIX_RE="idea|feature|bug|docs|infra"

slug=""; phase=""; ptype=""; wave=""; waves_total=0; prs="[]"; plan_file=""
matches=""; match_files=""; ambiguous=false

# Which active plan lists the current branch? An idea/<slug> branch names its
# plan directly; an implementation branch is matched against the Branches
# section of each active plan.
if [ -n "$branch" ]; then
  case "$branch" in
    idea/*) cand="${branch#idea/}"
            [ -e "$ACTIVE_DIR$cand.md" ] && { slug="$cand"; plan_file="$ACTIVE_DIR$cand.md"; } ;;
  esac
  # Collect EVERY plan that lists this branch, rather than taking the first.
  # Breaking on the first glob hit made the answer depend on which symlink
  # sorted alphabetically first — renaming a file changed the "governing plan"
  # while nothing about the work changed. Ambiguity is reported, never resolved
  # by guessing: a durable record attributed to the wrong plan is worse than
  # one with no attribution, which is exactly what a silent pick produces.
  if [ -z "$slug" ]; then
    for l in "$ACTIVE_DIR"*.md; do
      [ -e "$l" ] || continue
      meta=$("$script_dir/plot-plan-meta.sh" "$l" --prefixes "$PREFIX_RE" 2>/dev/null) || continue
      printf '%s' "$meta" | grep -q "\"$branch\"" && {
        matches="${matches:+$matches }$(basename "$l" .md)"
        match_files="${match_files:+$match_files }$l"
      }
    done
    n_matches=$(printf '%s' "$matches" | wc -w | tr -d ' ')
    if [ "${n_matches:-0}" = "1" ]; then
      slug="$matches"; plan_file="$match_files"
    elif [ "${n_matches:-0}" -gt 1 ]; then
      ambiguous=true   # slug stays empty on purpose
    fi
  fi
fi

if [ -n "$plan_file" ]; then
  meta=$("$script_dir/plot-plan-meta.sh" "$plan_file" --prefixes "$PREFIX_RE" 2>/dev/null || true)
  if [ -n "$meta" ] && command -v python3 >/dev/null 2>&1; then
    read -r phase ptype waves_total wave prs <<EOF2
$(printf '%s' "$meta" | BR="$branch" python3 -c '
import json, os, sys
d = json.load(sys.stdin)
br = os.environ.get("BR", "")
waves = d.get("waves", [])
name = ""
for w in waves:
    if any(b["branch"] == br for b in w["branches"]):
        name = w["name"] or "(unnamed)"
        break
print(d.get("phase", ""), d.get("type", "") or "-", len(waves),
      name or "-", json.dumps(d.get("prs", [])))
' 2>/dev/null)
EOF2
    [ "$wave" = "-" ] && wave=""
    [ "$ptype" = "-" ] && ptype=""
  fi
fi

cat <<JSON
{
  "branch": "$(j "$branch")",
  "plan_slug": "$(j "$slug")",
  "plan_file": "$(j "$plan_file")",
  "phase": "$(j "$phase")",
  "type": "$(j "$ptype")",
  "wave": "$(j "$wave")",
  "waves_total": ${waves_total:-0},
  "prs": ${prs:-[]},
  "ambiguous": ${ambiguous},
  "candidates": [$(printf '%s' "$matches" | tr ' ' '\n' | grep -v '^$' | sed 's/.*/"&"/' | paste -sd, -)]
}
JSON
