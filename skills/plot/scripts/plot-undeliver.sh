#!/usr/bin/env bash
# The mechanical half of reversing a delivery: ask the domain for the
# transition, then perform the write it decided.
#
#   plot-undeliver.sh <slug> --why <reason> [--on YYYY-MM-DD] [--dir <plan dir>]
#
# THE ONE LIFECYCLE MOVE THAT RUNS BACKWARDS, AND IT HAD NO SCRIPT. Every
# forward move has one owning its write -- plot-approve.sh, plot-deliver.sh --
# and returning a Delivered plan to Approved had none, so it was done by editing
# the `State:` line by hand. That is the shortcut this closes.
#
# THE DOMAIN DECIDES, THIS PERFORMS. Seven refusals can fire and this prints
# each whole: a caller reporting "could not reverse" throws away the half a
# person acts on.
#
# THE SWEPT REFS ARE MEASURED HERE, because resolving a ref needs a git remote
# the domain cannot reach. An empty reading means this looked and found none --
# never that it did not look, which is why a plan naming no branches sends an
# empty field rather than skipping the measurement.
#
# IT WRITES ONLY WHAT THE DOMAIN DECIDED, and never on a refusal: the file is
# replaced by one `mv` from a scratch copy, so a plan that was refused is the
# plan that was found. It commits nothing and pushes nothing -- the caller owns
# the commit, the way /plot-approve's steps already do.
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
bundle="$script_dir/board/plot-plan-undeliver.mjs"

usage() {
  echo "usage: plot-undeliver.sh <slug> --why <reason> [--on YYYY-MM-DD] [--dir <plan dir>]" >&2
}

# EVERY BUNDLE IS TRACKED IN GIT, so this fires on a broken installation and
# never on a normal run -- which is where naming the build command is right.
[ -f "$bundle" ] \
  || { echo "plot-undeliver: cannot find $bundle — run 'pnpm build:board'." >&2; exit 1; }

slug="${1:-}"
[ -n "$slug" ] || { usage; exit 2; }
case "$slug" in --*) usage; exit 2 ;; esac
shift

why=""
on="$(date +%Y-%m-%d)"
plan_dir=""
while [ $# -gt 0 ]; do
  case "$1" in
    --why) why="${2:-}"; shift 2 ;;
    --on) on="${2:-}"; shift 2 ;;
    --dir) plan_dir="${2:-}"; shift 2 ;;
    *) usage; exit 2 ;;
  esac
done

repo_root="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
[ -z "$plan_dir" ] && plan_dir="$(bash "$script_dir/plot-config.sh" get "Plan directory" "docs/plans")"
case "$plan_dir" in /*) ;; *) plan_dir="$repo_root/$plan_dir" ;; esac

# The slug is the filename without its date prefix. A slug matching more than
# one file is refused rather than resolved by date: two plans sharing a slug is
# a collision the estate must fix, and picking one would hide it.
matches=$(find "$plan_dir" -maxdepth 1 -name "*-${slug}.md" -not -path '*/active/*' -not -path '*/delivered/*' 2>/dev/null | sort)
count=$(printf '%s' "$matches" | grep -c . || true)
if [ "$count" -eq 0 ]; then
  echo "plot-undeliver: no plan file for '$slug' under $plan_dir" >&2
  exit 1
fi
if [ "$count" -gt 1 ]; then
  echo "plot-undeliver: '$slug' names $count files — a slug carries its own date and must be unique:" >&2
  printf '%s\n' "$matches" >&2
  exit 1
fi
file="$matches"

# READ EACH BRANCH, DECIDE NOTHING. One line per non-deferred branch: the ref
# (`ls-remote` exit 0 present, 2 absent, anything else unknown -- an unreachable
# origin exits 128 and is not "deleted"), and, only where the ref is gone, what
# the host says: a merge (`mergedAt`, never ancestry) and a closed unmerged PR.
# shellcheck source=plot-pr-merged.sh
. "$script_dir/plot-pr-merged.sh"
# shellcheck source=plot-state-receipt.sh
. "$script_dir/plot-state-receipt.sh"
readings=""
n=0
for b in $(bash "$script_dir/plot-plan-meta.sh" "$file" | jq -r '.waves[].branches[] | select(.deferred | not) | .branch' | sort -u); do
  git ls-remote --exit-code --heads origin "$b" >/dev/null 2>&1 && ref=present || { rc=$?; [ "$rc" = 2 ] && ref=absent || ref=unknown; }
  merged=-; closed=-
  if [ "$ref" = absent ]; then
    case "$(_plot_merged_lookup "$b")" in found) merged=merged ;; none) merged=not-merged ;; *) merged=unknown ;; esac
    closed=unknown
    if out=$(bash "$script_dir/plot-host.sh" pr-list --state closed --branch "$b" --limit 100 2>&1) && [[ "$out" != *'possibly truncated'* ]]; then
      cnt=$(printf '%s' "$out" | jq -Rn --arg b "$b" '[inputs | fromjson? | select(.head == $b and ((.mergedAt // "") == ""))] | length' 2>/dev/null) || cnt=x
      case "$cnt" in 0) closed=no ;; x) ;; *) closed=yes ;; esac
    fi
  fi
  readings="$readings$b	$ref	$merged	$closed
"
  n=$((n + 1))
done

# ASK THE DOMAIN. The header is one line, the readings follow it, and the file
# follows them whole, so a plan carrying tabs or its own `## Status` block
# travels unescaped.
# THE DOMAIN WRITES THE FILE TOO: the answer is `<State>\t<record>`, a newline,
# then the plan with the reversal applied. It goes to a scratch copy that one
# `mv` replaces, so a refused plan is the plan that was found.
tmp="$file.plot-undeliver"
set +e
{ printf '%s\t%s\t%s\t%s\n%s' "$on" "$why" "$slug" "$n" "$readings"; cat "$file"; } | node "$bundle" >"$tmp" 2>"$tmp.err"
rc=$?
set -e
err=$(cat "$tmp.err"); rm -f "$tmp.err"
# Exit 1 is the domain's refusal: the rule that fired, a tab, and its sentence.
# Exit 2 is this script handing the bundle something unreadable, which no
# operator can act on -- so it reports as the bug it is.
if [ "$rc" != 0 ]; then
  rm -f "$tmp"
  echo "plot-undeliver: ${err/$'\t'/: }" >&2
  exit 1
fi
head=$(head -n 1 "$tmp")
decided_state=${head%%$'\t'*}
decided_record=${head#*$'\t'}
tail -n +2 "$tmp" > "$tmp.2" && mv "$tmp.2" "$tmp"

mv "$tmp" "$file"
record_state_receipt "$file" "$decided_state"
# The index follows the state: the delivered entry becomes an active one.
mkdir -p "$plan_dir/active"
ln -sfn "../$(basename "$file")" "$plan_dir/active/$slug.md"
rm -f "$plan_dir/delivered/$slug.md"
echo "plot-undeliver: $slug → $decided_state ($decided_record)"
echo "  the file is written; the commit is yours."
