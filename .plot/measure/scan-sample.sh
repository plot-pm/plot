#!/usr/bin/env bash
# Sample one fleet-scan run against the estate size that produced it.
#
# Appends ONE tab-separated line to .plot/measure/scan-samples.tsv:
#   iso  worktrees  branches  plans  real_s  user_s  sys_s  cpu_pct  offline
#
# Read-only with respect to the estate: it runs the scan from a detached
# worktree on origin/main, so a sample never depends on which branch the
# caller happens to be standing on — the mistake that produced a wrong
# reading earlier today.
set -u
here=$(cd "$(dirname "$0")" && pwd)
repo=$(cd "$here/../.." && git rev-parse --show-toplevel 2>/dev/null) || exit 1
out="$repo/.plot/measure/scan-samples.tsv"
offline="${1:-}"

# The estate, measured BEFORE the run so a scan that fails still yields a row.
worktrees=$(git -C "$repo" worktree list 2>/dev/null | wc -l | tr -d ' ')
branches=$(git -C "$repo" ls-remote --heads origin 2>/dev/null | wc -l | tr -d ' ')
plans=$(git -C "$repo" ls-tree --name-only -r origin/main docs/plans/ 2>/dev/null | grep -c '\.md$')

tmp=$(mktemp -d) || exit 1
trap 'git -C "$repo" worktree remove --force "$tmp/wt" >/dev/null 2>&1; rm -rf "$tmp"' EXIT
git -C "$repo" worktree add -q --detach "$tmp/wt" origin/main 2>/dev/null || exit 1

t=$(mktemp)
/usr/bin/time -p "$tmp/wt/skills/plot/scripts/plot-fleet-scan.sh" --json ${offline:+--offline} >/dev/null 2>"$t"
real=$(awk '/^real/{print $2}' "$t"); user=$(awk '/^user/{print $2}' "$t"); sys=$(awk '/^sys/{print $2}' "$t")
rm -f "$t"
[ -n "${real:-}" ] || exit 1

cpu=$(awk -v u="$user" -v s="$sys" -v r="$real" 'BEGIN{ if (r>0) printf "%.1f", (u+s)*100/r; else print "0" }')

[ -s "$out" ] || printf 'iso\tworktrees\tbranches\tplans\treal_s\tuser_s\tsys_s\tcpu_pct\toffline\n' > "$out"
printf '%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\n' \
  "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$worktrees" "$branches" "$plans" \
  "$real" "$user" "$sys" "$cpu" "${offline:+offline}" >> "$out"
tail -1 "$out"
