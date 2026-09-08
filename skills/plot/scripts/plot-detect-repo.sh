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
#   ticket_prefix     the most frequent prefix in the sample, e.g. QUACDS; ""
#                     if none was seen at all
#   ticket_prefix_count how many subjects carried it
#   subjects_read     how many subjects the two counts above were read from
#   commit_style_counts {"colon":n,"dash":n,"conventional":n} — how many
#                     subjects match each notation
#   existing_systems  planning/doc dirs already present (never judged, only listed)
#   hub_docs          CLAUDE.md and/or AGENTS.md, comma-separated; "" if neither
#   has_plot_config   true when a hub already carries a `## Plot Config`
#   has_settings      true when .claude/settings.json exists
#   german_words      how many German words the hub docs' sample carried; 0
#                     when there was no doc to sample
#
# IT REPORTS COUNTS AND NEVER THE ANSWER THEY IMPLY. `commit_style`,
# `language_hint` and a thresholded `ticket_prefix` were all decisions living
# here — *two matching subjects make a style*, *three German words make a German
# repository* — and no test could reach one. They are `proposeStack`'s now, in
# `packages/domain/src/rules/stack.ts`, reached through
# `board/plot-propose-stack.mjs`. This file measures; the rule judges.
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
# The most frequent prefix and how often it occurred, both reported raw.
# Whether one occurrence is a scheme is `proposeTicket`'s decision, and it used
# to be an `awk '$1 >= 2'` here.
SUBJECT_SAMPLE=80
ticket_line=$(git log --format=%s -"$SUBJECT_SAMPLE" 2>/dev/null \
  | grep -oE '\b[A-Z][A-Z0-9]{1,9}-[0-9]+' \
  | sed 's/-[0-9]*$//' | sort | uniq -c | sort -rn | head -1)
ticket=$(printf '%s' "$ticket_line" | awk '{ print $2 }')
ticket_count=$(printf '%s' "$ticket_line" | awk '{ print $1 + 0 }')
[ -n "$ticket_count" ] || ticket_count=0
subjects_read=$(git log --format=%s -"$SUBJECT_SAMPLE" 2>/dev/null | grep -c . || true)
subjects_read=${subjects_read:-0}

# --- commit style -------------------------------------------------------
# Reviewer agents check commit subjects, so an adopted agent aligned to the
# wrong notation flags correct commits as violations. THE THREE COUNTS ARE
# REPORTED AND THE WINNER IS NOT: which one wins, and whether any clears the
# bar, is `proposeCommitStyle`'s decision.
subjects=$(git log --format=%s -30 2>/dev/null | grep -v '^Merge ' || true)
n_colon=$(printf '%s\n' "$subjects" | grep -cE '^[A-Zar]{1,2}:[ ]' || true)
n_dash=$(printf '%s\n' "$subjects" | grep -cE '^[A-Zar]{1,2} - ' || true)
n_conv=$(printf '%s\n' "$subjects" | grep -cE '^(feat|fix|chore|docs|refactor|test|style|perf|build|ci)(\([^)]*\))?!?: ' || true)

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

# --- language sample ----------------------------------------------------
# How many German words the hub docs carry, and nothing about what that means.
# `proposeLanguage` decides, and it reads `hub_docs` too: no doc at all is a
# reading nobody took, which is not the same answer as English.
de=0
if [ -n "$hubs" ]; then
  sample=$(cat CLAUDE.md AGENTS.md 2>/dev/null | head -200)
  # -o so every occurrence counts; grep -c counts matching LINES, which
  # scores a whole German paragraph on one line as 1.
  de=$(printf '%s' "$sample" | grep -oiE '\b(und|nicht|werden|muss|sollte|kann|dieser|diese)\b' | wc -l | tr -d ' ')
fi

cat <<JSON
{
  "git_host": "$(j "$host")",
  "default_branch": "$(j "$def_branch")",
  "dod_candidates": $dod,
  "ticket_prefix": "$(j "$ticket")",
  "ticket_prefix_count": ${ticket_count:-0},
  "subjects_read": ${subjects_read:-0},
  "commit_style_counts": {"colon": ${n_colon:-0}, "dash": ${n_dash:-0}, "conventional": ${n_conv:-0}},
  "existing_systems": "$(j "$systems")",
  "hub_docs": "$(j "$hubs")",
  "has_plot_config": $has_cfg,
  "has_settings": $has_settings,
  "german_words": ${de:-0}
}
JSON
