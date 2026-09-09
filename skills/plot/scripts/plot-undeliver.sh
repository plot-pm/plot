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
if [ -z "$plan_dir" ]; then
  plan_dir="$(bash "$script_dir/plot-config.sh" get "Plan directory" "docs/plans")"
fi
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

# MEASURE THE SWEPT REFS. A branch the plan names whose remote ref is gone has
# nowhere to put the remaining work, and the domain cannot ask a remote.
swept=""
branches=$(grep -oE '\(Branch: [^,)]+' "$file" 2>/dev/null | sed 's/(Branch: //' | sort -u || true)
for b in $branches; do
  if ! git ls-remote --exit-code --heads origin "$b" >/dev/null 2>&1; then
    swept="${swept:+$swept, }$b"
  fi
done

# ASK THE DOMAIN. The header is one line and the file follows it whole, so a
# plan carrying tabs or its own `## Status` block travels unescaped.
set +e
answer=$(printf '%s\t%s\t%s\n' "$on" "$why" "$swept" | cat - "$file" | node "$bundle" 2>&1)
rc=$?
set -e

# Exit 1 is the domain's refusal: the rule that fired, a tab, and its sentence.
# Exit 2 is this script handing the bundle something unreadable, which no
# operator can act on -- so it reports as the bug it is.
if [ "$rc" != 0 ]; then
  if [ "$rc" = 1 ]; then
    echo "plot-undeliver: $(printf '%s' "$answer" | cut -f2-)" >&2
  else
    echo "plot-undeliver: $answer" >&2
  fi
  exit 1
fi

decided_state=$(printf '%s' "$answer" | cut -f1)
decided_record=$(printf '%s' "$answer" | cut -f2)

# THE DOMAIN NORMALISES THE PHASE AND THE ESTATE CAPITALISES IT. Every
# `State:` line in docs/plans reads `Approved`, and the rule answers
# `approved` -- so the case is restored here, where presentation belongs, and
# not in the rule, which would then be answering in a file format's spelling.
decided_state="$(printf '%s' "${decided_state:0:1}" | tr '[:lower:]' '[:upper:]')${decided_state:1}"

# PERFORM THE WRITE THE DOMAIN DECIDED, against a scratch copy replaced by one
# `mv`. The awk that knows where a `## Status` line lives stays here, because
# that is adaptation -- the same split plot-approve.sh draws.
tmp="$file.plot-undeliver"
awk -v want="$decided_state" -v record="$decided_record" '
  BEGIN { section = ""; done = 0; wrote = 0 }
  /^## / { section = ($0 ~ /^## Status/) ? "status" : "" }
  section == "status" && !done && tolower($0) ~ /^[ \t]*[-*][ \t]*\**state[:*]/ {
    sub(/State:\*\*[ \t]*.*$/, "State:** " want)
    done = 1
    print
    next
  }
  # The reason, recorded beside the state. An existing line is replaced so
  # re-running writes one record rather than a second.
  section == "status" && tolower($0) ~ /^[ \t]*[-*][ \t]*\**rejected[:*]/ {
    print "- **Rejected:** " record
    wrote = 1
    next
  }
  { print }
  END { exit (done ? 0 : 1) }
' "$file" > "$tmp" && awk_rc=0 || awk_rc=$?

if [ "${awk_rc:-0}" != 0 ]; then
  rm -f "$tmp"
  echo "plot-undeliver: $file has no '- **State:**' line under '## Status' — refusing rather than guessing where the phase lives." >&2
  exit 1
fi

# The record line is APPENDED where the file carried none, after the state it
# explains. A plan delivered before this verb existed has no `Rejected:` line,
# and a reversal that wrote the phase without the reason is the half-write the
# rule refuses to leave behind.
if ! grep -qiE '^[ \t]*[-*][ \t]*\*\*Rejected:' "$tmp"; then
  awk -v record="$decided_record" '
    BEGIN { section = ""; done = 0 }
    /^## / { section = ($0 ~ /^## Status/) ? "status" : "" }
    { print }
    section == "status" && !done && tolower($0) ~ /^[ \t]*[-*][ \t]*\**state[:*]/ {
      print "- **Rejected:** " record
      done = 1
    }
  ' "$tmp" > "$tmp.2" && mv "$tmp.2" "$tmp"
fi

mv "$tmp" "$file"
echo "plot-undeliver: $slug → $decided_state ($decided_record)"
echo "  the file is written; the commit is yours."
