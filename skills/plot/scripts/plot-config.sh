#!/usr/bin/env bash
# Plot helper: read a key from the adopting project's `## Plot Config`.
# Usage: plot-config.sh get <key> [default]
# Output: the configured value, or the default (possibly empty). Exit 0 always
#         for `get` — missing file, missing section, and missing key all fall
#         back to the default so callers can rely on the output unconditionally.
# Designed for small-model consumption: one value on stdout, no interpretation.
#
# This is the ONE place that knows where plot configuration lives (currently a
# `## Plot Config` section in the repo-root CLAUDE.md). Helpers must call this
# instead of grepping CLAUDE.md themselves, so the storage location/format can
# evolve without touching every consumer.
#
# Grammar accepted inside the section (case-insensitive key, bold optional):
#     - **Plan directory:** docs/plans/
#     - Plan directory: docs/plans/
# Lines outside the `## Plot Config` section never match (no prose false
# positives), and neither do HTML-commented example lines.
#
# Known keys (see the plot skill's Setup section):
#   Project board | Branch prefixes | Plan directory | Active index |
#   Delivered index | Sprint directory | Main branch

set -uo pipefail

cmd="${1:?Usage: plot-config.sh get <key> [default]}"
key="${2:?Usage: plot-config.sh get <key> [default]}"
default="${3:-}"

if [ "$cmd" != "get" ]; then
  echo "plot-config: unknown subcommand '$cmd' (only 'get' is supported)" >&2
  exit 1
fi

root=$(git rev-parse --show-toplevel 2>/dev/null) || root="."
config_file="$root/CLAUDE.md"

value=""
if [ -f "$config_file" ]; then
  # Extract the `## Plot Config` section (case-insensitive, portable awk).
  section=$(awk '
    /^##[[:space:]]/ { in_section = (tolower($0) ~ /^##[[:space:]]+plot config[[:space:]]*$/) ; next }
    in_section { print }
  ' "$config_file")
  value=$(printf '%s\n' "$section" \
    | grep -m1 -iE "^[[:space:]]*[-*]?[[:space:]]*\**${key}[:*]" \
    | sed -E 's/^[^:]*:[[:space:]]*//; s/^\**[[:space:]]*//; s/[[:space:]`]*$//; s/^[[:space:]`]*//')
fi

if [ -n "$value" ]; then
  printf '%s\n' "$value"
else
  printf '%s\n' "$default"
fi
