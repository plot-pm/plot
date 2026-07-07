#!/usr/bin/env bash
# Plot helper: parse one plan file into structured JSON.
# Usage: plot-plan-meta.sh <plan-file> [--prefixes 'idea|feature|bug|docs|infra']
# Output: single JSON object on stdout. Exit 0 always; parse problems are
#         reported in the JSON, never as a crash.
# Designed for small-model consumption: structured output, no interpretation.
#
# This is the ONE place that knows what a plan file looks like. Anything that
# needs plan metadata (phase, type, branches, PR numbers) must call this
# script instead of grepping plan files itself — the parser is the format
# contract. The contract is specified by example in test/reconcile/fixtures/
# (one fixture per supported shape) and enforced by test/reconcile/.
#
# Two plan formats are recognized:
#
#   canonical    the plan template's `## Status` body section:
#                    - **Phase:** Approved
#                    - **Type:** feature
#                (bullet, bold, and plain `Phase: ...` variants all accepted)
#
#   frontmatter  YAML front matter at the top of the file:
#                    ---
#                    status: Approved
#                    phase: Approved
#                    type: feature
#                    ---
#                `status:` is the primary field; `phase:` is reported as the
#                alternate so callers can flag disagreement between the two.
#
# Front matter wins when both are present (it is the machine-facing surface).
# A file with neither is reported as format "none" (pre-plot / legacy plan).
#
# Phase values are normalized by scanning whitespace-separated tokens for the
# first known phase word — so decorated real-world values like
# "Delivered (2026-06-29) — split done" normalize to "delivered". A non-empty
# value with no known token normalizes to "UNKNOWN"; an absent field to "NONE".
#
# JSON fields:
#   file           the path given
#   format         canonical | frontmatter | none
#   phase_raw      primary phase value as written ("" if absent)
#   phase          normalized: draft|approved|delivered|released|rejected|
#                  superseded|UNKNOWN|NONE
#   phase_alt_raw  secondary value when the file carries two (front matter
#                  status: AND phase:), else ""
#   phase_alt      normalized phase_alt_raw (NONE when absent)
#   type           normalized plan type (feature|bug|docs|infra or "")
#   branches       branch names from the `## Branches` section (backtick-
#                  quoted, matching the known prefixes)
#   prs            PR numbers from `→ #NNN` links in the `## Branches` section

set -uo pipefail

file="${1:?Usage: plot-plan-meta.sh <plan-file> [--prefixes '<alternation>']}"
shift
prefixes='idea|feature|bug|docs|infra'
while [ $# -gt 0 ]; do
  case "$1" in
    --prefixes) prefixes="${2:?--prefixes needs a value}"; shift 2 ;;
    *) echo "plot-plan-meta: unknown flag: $1" >&2; shift ;;
  esac
done

if [ ! -f "$file" ]; then
  jq -n --arg file "$file" '{file: $file, format: "none", error: "file not found",
    phase_raw: "", phase: "NONE", phase_alt_raw: "", phase_alt: "NONE",
    type: "", branches: [], prs: []}'
  exit 0
fi

# --- Front matter block (file starts with a `---` line) -----------------------
fm_block=""
if head -n1 "$file" | grep -qE '^---[[:space:]]*$'; then
  fm_block=$(awk 'NR==1 {next} /^---[[:space:]]*$/ {exit} {print}' "$file")
fi
fm_get() { # $1=key — first match, trimmed of quotes/space
  printf '%s\n' "$fm_block" | grep -m1 -iE "^$1:" \
    | sed -E 's/^[^:]*:[[:space:]]*//; s/^"//; s/"$//; s/[[:space:]]*$//'
}

# --- Canonical `## Status` section fields -------------------------------------
status_section=$(sed -n '/^## Status/,/^## /p' "$file")
canon_get() { # $1=key — accepts "- **Key:** v", "**Key:** v", "Key: v"
  printf '%s\n' "$status_section" \
    | grep -m1 -iE "^[[:space:]]*[-*]?[[:space:]]*\**$1[:*]" \
    | sed -E 's/^[^:]*:[[:space:]]*//; s/^\**[[:space:]]*//; s/[[:space:]]*$//'
}

# --- Normalization -------------------------------------------------------------
norm_phase() { # $1=raw — first known token wins; NONE if empty; UNKNOWN otherwise
  local raw tok t
  raw=$(printf '%s' "${1:-}" | tr '[:upper:]' '[:lower:]')
  [ -n "$raw" ] || { echo NONE; return; }
  for tok in $raw; do
    t=$(printf '%s' "$tok" | sed -E 's/^[^a-z]+//; s/[^a-z-]+$//')
    case "$t" in
      draft|approved|delivered|released|rejected|superseded) echo "$t"; return ;;
      ready-for-review|in-review) echo approved; return ;;
    esac
  done
  echo UNKNOWN
}

norm_type() { # $1=raw — first known token or ""
  local raw tok t
  raw=$(printf '%s' "${1:-}" | tr '[:upper:]' '[:lower:]')
  for tok in $raw; do
    t=$(printf '%s' "$tok" | sed -E 's/^[^a-z]+//; s/[^a-z]+$//')
    case "$t" in
      feature|bug|docs|infra) echo "$t"; return ;;
    esac
  done
  echo ""
}

fm_status=$(fm_get status)
fm_phase=$(fm_get phase)
canon_phase=$(canon_get Phase)

format="none"; phase_raw=""; phase_alt_raw=""; type_raw=""
if [ -n "$fm_status" ] || [ -n "$fm_phase" ]; then
  format="frontmatter"
  phase_raw="${fm_status:-$fm_phase}"
  [ -n "$fm_status" ] && [ -n "$fm_phase" ] && phase_alt_raw="$fm_phase"
  type_raw=$(fm_get type)
elif [ -n "$canon_phase" ]; then
  format="canonical"
  phase_raw="$canon_phase"
  type_raw=$(canon_get Type)
fi

# --- Branches section: branch names + PR links ---------------------------------
branches_section=$(sed -n '/^## Branches/,/^## /p' "$file")
branches_json=$(printf '%s\n' "$branches_section" \
  | grep -oE "\`($prefixes)/[^\`]+\`" | tr -d '`' \
  | jq -R . | jq -s 'unique')
prs_json=$(printf '%s\n' "$branches_section" \
  | grep -oE '→ #[0-9]+' | grep -oE '[0-9]+' \
  | jq -R 'tonumber' | jq -s 'unique')

jq -n \
  --arg file "$file" \
  --arg format "$format" \
  --arg phase_raw "$phase_raw" \
  --arg phase "$(norm_phase "$phase_raw")" \
  --arg phase_alt_raw "$phase_alt_raw" \
  --arg phase_alt "$(norm_phase "$phase_alt_raw")" \
  --arg type "$(norm_type "$type_raw")" \
  --argjson branches "$branches_json" \
  --argjson prs "$prs_json" \
  '{file: $file, format: $format, phase_raw: $phase_raw, phase: $phase,
    phase_alt_raw: $phase_alt_raw, phase_alt: $phase_alt, type: $type,
    branches: $branches, prs: $prs}'
