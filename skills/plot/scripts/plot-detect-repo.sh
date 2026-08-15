#!/usr/bin/env bash
# Plot helper: adoption probe — what is this repo like?
# Usage: plot-detect-repo.sh
# Output: one JSON object describing the repo, for /plot-init to PROPOSE
#         settings from rather than interviewing the user about facts that
#         are already visible.
#
# STRICTLY READ-ONLY. This is the first thing a stranger runs in their own
# repo, so it must not create, modify, or delete anything — not even a
# directory. It also must not fail on a bare repo: an empty answer is a
# finding ("no ticket scheme"), never an error.
#
# Detection is DELIBERATELY CONSERVATIVE. Every field is a proposal a human
# confirms, so a wrong guess costs one correction — but a guess dressed up as
# a fact costs trust. Where the signal is ambiguous the field is left empty
# and /plot-init asks.
#
# Fields:
#   git_host          github | bitbucket | "" (from origin's URL)
#   default_branch    from origin/HEAD, else the current branch, else ""
#   dod_candidates    package.json script names that look like quality gates
#   ticket_prefix     e.g. QUACDS, inferred from commit subjects; "" if none
#   commit_style      arlo-colon | arlo-dash | conventional | "" (unknown)
#   existing_systems  planning/doc dirs already present (never judged, only listed)
#   hub_docs          CLAUDE.md and/or AGENTS.md, comma-separated; "" if neither
#   has_plot_config   true when a hub already carries a `## Plot Config`
#   has_settings      true when .claude/settings.json exists
#   language_hint     de | en | "" — a weak signal from existing docs
set -uo pipefail

j() { printf '%s' "$1" | sed 's/\\/\\\\/g; s/"/\\"/g'; }

git rev-parse --git-dir >/dev/null 2>&1 || { echo '{"error":"not a git repository"}'; exit 1; }

# --- git host -----------------------------------------------------------
host=""
url=$(git remote get-url origin 2>/dev/null || true)
# Anchored to the host position: `*bitbucket.*` matched
# git.mybitbucket.internal.example.com, and `*github.com*` matched
# https://evil.com/notgithub.com.evil/x.git. A detector that calls itself
# conservative must not guess from a substring.
case "$url" in
  git@github.com:*|https://github.com/*|ssh://git@github.com/*)       host=github ;;
  git@bitbucket.org:*|https://bitbucket.org/*|ssh://git@bitbucket.org/*) host=bitbucket ;;
esac

# --- default branch -----------------------------------------------------
def_branch=$(git symbolic-ref --short refs/remotes/origin/HEAD 2>/dev/null | sed 's#^origin/##')
[ -n "$def_branch" ] || def_branch=$(git branch --show-current 2>/dev/null || true)

# --- Definition-of-Done candidates --------------------------------------
# Only names that are recognisably quality gates. A repo's own `deploy` or
# `start` script is not a DoD check, and offering it as one teaches the user
# to distrust the whole proposal.
dod="[]"
if [ -f package.json ] && command -v python3 >/dev/null 2>&1; then
  dod=$(python3 - <<'PY' 2>/dev/null || echo '[]'
import json
GATES = ('test', 'lint', 'typecheck', 'check', 'build', 'dist', 'e2e', 'verify', 'validate')
import glob
found = set()
# A workspace root often has no gates of its own — the packages do. Reading
# only the root reports "no quality gates" for a monorepo, which is exactly
# the answer the one question /plot-init insists on must not get wrong.
for f in ['package.json'] + sorted(glob.glob('packages/*/package.json'))[:20]:
    try:
        scripts = json.load(open(f)).get('scripts', {}) or {}
    except Exception:
        continue
    found |= {k for k in scripts if any(k == g or k.startswith(g + ':') for g in GATES)}
print(json.dumps(sorted(found)))
PY
)
fi

# --- ticket scheme ------------------------------------------------------
# A prefix only counts when it recurs: one stray "ABC-1" in a subject line is
# not a scheme.
ticket=$(git log --format=%s -80 2>/dev/null \
  | grep -oE '\b[A-Z][A-Z0-9]{1,9}-[0-9]+' \
  | sed 's/-[0-9]*$//' | sort | uniq -c | sort -rn \
  | awk '$1 >= 2 { print $2; exit }')

# --- commit style -------------------------------------------------------
# Reviewer agents check commit subjects, so an adopted agent aligned to the
# wrong notation flags correct commits as violations.
subjects=$(git log --format=%s -30 2>/dev/null | grep -v '^Merge ' || true)
style=""
n_colon=$(printf '%s\n' "$subjects" | grep -cE '^[A-Zar]{1,2}:[ ]' || true)
n_dash=$(printf '%s\n' "$subjects" | grep -cE '^[A-Zar]{1,2} - ' || true)
n_conv=$(printf '%s\n' "$subjects" | grep -cE '^(feat|fix|chore|docs|refactor|test|style|perf|build|ci)(\([^)]*\))?!?: ' || true)
if [ "${n_conv:-0}" -ge 2 ] && [ "${n_conv:-0}" -ge "${n_colon:-0}" ]; then style=conventional
elif [ "${n_colon:-0}" -ge 2 ]; then style=arlo-colon
elif [ "${n_dash:-0}" -ge 2 ]; then style=arlo-dash
fi

# --- existing planning systems ------------------------------------------
# Listed, never judged. Adoption is additive: what is here already stays, and
# the human decides what it means.
systems=""
for d in docs/plans docs/stories docs/sprints docs/sessionlogs docs/superpowers \
         .agency .agents .omc .claude/plans; do
  [ -d "$d" ] && systems="${systems:+$systems,}$d"
done

# --- hub docs and existing config ---------------------------------------
hubs=""
for f in CLAUDE.md AGENTS.md; do
  [ -f "$f" ] && hubs="${hubs:+$hubs,}$f"
done
has_cfg=false
for f in CLAUDE.md AGENTS.md; do
  [ -f "$f" ] && grep -q '^## Plot Config' "$f" 2>/dev/null && has_cfg=true
done
has_settings=false
[ -f .claude/settings.json ] && has_settings=true

# --- language hint ------------------------------------------------------
# Weak on purpose: it only nudges the template wording, and a wrong guess is
# cheap to correct.
lang=""
if [ -n "$hubs" ]; then
  sample=$(cat CLAUDE.md AGENTS.md 2>/dev/null | head -200)
  # -o so every occurrence counts; grep -c counts matching LINES, which
  # scores a whole German paragraph on one line as 1.
  de=$(printf '%s' "$sample" | grep -oiE '\b(und|nicht|werden|muss|sollte|kann|dieser|diese)\b' | wc -l | tr -d ' ')
  [ "${de:-0}" -ge 3 ] && lang=de || lang=en
fi

cat <<JSON
{
  "git_host": "$(j "$host")",
  "default_branch": "$(j "$def_branch")",
  "dod_candidates": $dod,
  "ticket_prefix": "$(j "$ticket")",
  "commit_style": "$(j "$style")",
  "existing_systems": "$(j "$systems")",
  "hub_docs": "$(j "$hubs")",
  "has_plot_config": $has_cfg,
  "has_settings": $has_settings,
  "language_hint": "$(j "$lang")"
}
JSON
