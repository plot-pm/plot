#!/usr/bin/env bash
# Migrate plan files from ## Branches to ## Waves format.
# Usage: migrate-branches-to-waves.sh <plan-file>...
#
# Transforms the old format:
#   ## Branches
#   ### WaveName
#   - `branch/name` — description text here that may
#     wrap across multiple lines → #PR <!-- deferred/claimed -->
#
# Into the new format:
#   ## Waves
#   ### WaveName (Branch: branch/name, PR: #PR) <!-- deferred/claimed -->
#   - description text here that may
#     wrap across multiple lines
#
# Plans without wave subheadings (unnamed waves) get a derived name
# "Implementation" — all are Released or Delivered, so the derived name is
# defensible.
#
# CONSTRAINT: The new format only supports one branch per wave heading. Plans
# with multi-branch waves (multiple branches under one ### heading) CANNOT be
# converted without changing their wave structure, which would violate the
# byte-identical parser output requirement. These plans are SKIPPED with a
# message explaining why.
#
# The migration is byte-for-byte reversible via plot-plan-meta.sh: the parser
# emits identical JSON from both formats, so a successful migration is proven
# by comparing pre- and post-migration parser output.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PLAN_META="${SCRIPT_DIR}/../skills/plot/scripts/plot-plan-meta.sh"

if [ $# -eq 0 ]; then
  echo "Usage: migrate-branches-to-waves.sh <plan-file>..." >&2
  exit 1
fi

# Known branch prefixes (same as plot-plan-meta.sh)
PREFIXES='idea|feature|bug|docs|infra'

for file in "$@"; do
  if [ ! -f "$file" ]; then
    echo "SKIP (not a file): $file" >&2
    continue
  fi

  # Skip if already in new format
  if grep -q '^## Waves' "$file"; then
    echo "SKIP (already new format): $file" >&2
    continue
  fi

  # Skip if no ## Branches section
  if ! grep -q '^## Branches' "$file"; then
    echo "SKIP (no ## Branches): $file" >&2
    continue
  fi

  # Parse the file once to check for unconvertible structures
  plan_json=$("$PLAN_META" "$file" 2>/dev/null)

  # Check if any wave has multiple branches using the parser
  # The new format only supports one branch per wave, so multi-branch waves
  # cannot be converted without changing the structure
  #
  # Note: We check for existence first, then get the name, because an unnamed
  # wave has name "" which would be indistinguishable from "no result" in shell
  has_multi_branch=$(
    echo "$plan_json" | \
    jq -r 'if any(.waves[]; .branches | length > 1) then "yes" else "no" end'
  )
  if [ "$has_multi_branch" = "yes" ]; then
    multi_branch_wave=$(
      echo "$plan_json" | \
      jq -r '.waves[] | select(.branches | length > 1) | .name' | head -1
    )
    wave_display="${multi_branch_wave:-<unnamed>}"
    echo "SKIP (multi-branch wave '$wave_display'): $file" >&2
    continue
  fi

  # Check if any wave has ZERO branches (documentation-only wave headings)
  # The new format requires a branch in the heading, so empty waves
  # cannot be converted without changing the structure
  #
  # Note: Same logic as multi-branch check - check existence first, then get name
  has_empty_wave=$(
    echo "$plan_json" | \
    jq -r 'if any(.waves[]; .branches | length == 0) then "yes" else "no" end'
  )
  if [ "$has_empty_wave" = "yes" ]; then
    empty_wave=$(
      echo "$plan_json" | \
      jq -r '.waves[] | select(.branches | length == 0) | .name' | head -1
    )
    wave_display="${empty_wave:-<unnamed>}"
    echo "SKIP (empty wave '$wave_display'): $file" >&2
    continue
  fi

  # Check if file has wave subheadings under ## Branches
  has_subheadings=$(awk '/^## Branches/{in_sec=1; next} /^## [A-Z]/{in_sec=0} in_sec && /^### /{print "yes"; exit}' "$file")

  # Perform the migration using awk
  # This is more complex because descriptions can span multiple lines
  # and the → #PR annotation is at the end of the entire description block
  awk -v PREFIXES="$PREFIXES" -v HAS_SUB="$has_subheadings" '
BEGIN {
  in_branches = 0
  wave_name = ""
  branch = ""
  pr = ""
  annotation = ""
  desc_lines[0] = ""
  n_desc = 0
  pending_header_text = ""  # Text between ## Branches and first ### or branch
  need_derived_wave = 0
}

function flush_branch() {
  if (branch == "") return

  # Build the new wave heading
  if (wave_name == "") {
    wave_name = "Implementation"
  }

  # Build meta part
  meta = "Branch: " branch
  if (pr != "") {
    meta = meta ", PR: " pr
  }

  # Print wave heading
  printf "### %s (%s)", wave_name, meta
  if (annotation != "") {
    printf " %s", annotation
  }
  print ""

  # Print description lines
  for (i = 1; i <= n_desc; i++) {
    print desc_lines[i]
  }

  # Reset state
  branch = ""
  pr = ""
  annotation = ""
  delete desc_lines
  n_desc = 0
  wave_name = ""
}

# Rename ## Branches to ## Waves
/^## Branches/ {
  print "## Waves"
  in_branches = 1
  if (HAS_SUB != "yes") {
    need_derived_wave = 1
  }
  next
}

# End of section
in_branches && /^## [A-Z]/ {
  flush_branch()
  in_branches = 0
  if (pending_header_text != "") {
    printf "%s", pending_header_text
    pending_header_text = ""
  }
  print
  next
}

# Wave subheading in old format
in_branches && /^### / {
  flush_branch()
  if (pending_header_text != "") {
    printf "%s", pending_header_text
    pending_header_text = ""
  }
  wave_name = $0
  sub(/^### /, "", wave_name)
  next
}

# New branch line (starts a new branch entry)
in_branches && /^- `(idea|feature|bug|docs|infra)\/[^`]+`/ {
  flush_branch()
  if (pending_header_text != "") {
    printf "%s", pending_header_text
    pending_header_text = ""
  }

  line = $0

  # Extract the branch name
  if (match(line, /`(idea|feature|bug|docs|infra)\/[^`]+`/)) {
    branch = substr(line, RSTART+1, RLENGTH-2)
  }

  # Check if this line has the PR annotation (→ #NNN)
  if (match(line, /→ ([A-Za-z0-9._-]+\/[A-Za-z0-9._-]+)?#[0-9]+/)) {
    pr_match = substr(line, RSTART, RLENGTH)
    if (match(pr_match, /#[0-9]+/)) {
      pr = substr(pr_match, RSTART, RLENGTH)
    }
  }

  # Check for annotations (<!-- claimed: ... --> or <!-- deferred: ... -->)
  # Annotations can be:
  # 1. At end of line: - `branch` — description → #PR <!-- deferred: ... -->
  # 2. After branch, before —: - `branch` <!-- deferred: ... --> — description
  # Look for the annotation pattern anywhere in the line
  if (match(line, /<!--[ \t]*(claimed|deferred):[^>]*-->/)) {
    annotation = substr(line, RSTART, RLENGTH)
  }

  # Extract description: remove branch, PR, and annotation from the line
  desc = line
  # Remove the leading "- `branch/name` " part, potentially with annotation before the —
  # Pattern: - `branch` <!-- ... --> — description
  # or:      - `branch` — description
  # First, remove the branch name
  sub(/^- `[^`]+`[ \t]*/, "", desc)
  # If there is an annotation before the —, remove it
  if (match(desc, /^<!--[^>]*-->[ \t]*/)) {
    desc = substr(desc, RSTART + RLENGTH)
  }
  # Remove the leading — separator
  sub(/^—[ \t]*/, "", desc)
  # If PR annotation is on this line, remove it and everything after
  if (pr != "") {
    sub(/[ \t]*→[ \t]*[^ \t]+([ \t]*<!--.*)?$/, "", desc)
  } else if (annotation != "") {
    sub(/[ \t]*<!--.*$/, "", desc)
  }

  if (desc != "") {
    desc_lines[++n_desc] = "- " desc
  }
  next
}

# Continuation line (indented, part of current branch description)
in_branches && branch != "" && /^  [^ ]/ {
  line = $0

  # Check if this line has the PR annotation
  if (pr == "" && match(line, /→ ([A-Za-z0-9._-]+\/[A-Za-z0-9._-]+)?#[0-9]+/)) {
    pr_match = substr(line, RSTART, RLENGTH)
    if (match(pr_match, /#[0-9]+/)) {
      pr = substr(pr_match, RSTART, RLENGTH)
    }
  }

  # Annotations are only valid on the branch line itself, not continuation lines
  # (The parser reads them from the same line as the branch name)

  # Clean up the line (remove PR and annotation for description)
  desc = line
  if (pr != "" && index(line, "→") > 0) {
    sub(/[ \t]*→[ \t]*[^ \t]+([ \t]*<!--.*)?$/, "", desc)
  } else if (annotation != "" && index(line, "<!--") > 0) {
    sub(/[ \t]*<!--.*$/, "", desc)
  }

  if (desc != "" && desc !~ /^[ \t]*$/) {
    desc_lines[++n_desc] = desc
  }
  next
}

# Blank line in branches section (could be between branches)
in_branches && /^$/ {
  if (branch != "") {
    # Blank line ends the current description
    desc_lines[++n_desc] = ""
  } else {
    pending_header_text = pending_header_text "\n"
  }
  next
}

# Other non-branch content in branches section (prose between waves)
in_branches && branch == "" && !/^### / && !/^$/ {
  pending_header_text = pending_header_text $0 "\n"
  next
}

# Lines while we have a branch but dont match continuation pattern
# (usually prose after the branch descriptions)
in_branches && branch != "" {
  # This is prose that comes after the branch list items
  # Flush current branch and treat as prose
  flush_branch()
  pending_header_text = pending_header_text $0 "\n"
  next
}

# Everything else passes through unchanged
{
  print
}

END {
  flush_branch()
  if (pending_header_text != "") {
    printf "%s", pending_header_text
  }
}
' "$file" > "${file}.new"

  # Replace original with new
  mv "${file}.new" "$file"
  echo "MIGRATED: $file"
done
