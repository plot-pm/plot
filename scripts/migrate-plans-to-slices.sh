#!/usr/bin/env bash
# Renames every plan's `## Branches` / `## Waves` heading to `## Slices`.
#
# THE RENAME IS A WORD, AND THE GUARD IS THE WHOLE SCRIPT. `plot-plan-meta.sh`
# decides a section's LAYOUT from its first `### ` heading rather than from the
# heading word, so all three spellings read either shape and a rename changes
# nothing. That is the property this script verifies per file rather than
# assumes: it parses the plan before and after, and reverts the file unless the
# two are byte-identical.
#
# Before that property existed the rename was silently destructive. Measured
# 2026-09-04 on `2026-08-14-parallel-agent-fleet.md`: renaming its `## Branches`
# to `## Slices` took the plan from **6 branches to 0**, with no error — the old
# dispatch sent the new word to the new grammar, which looks for branches in
# `### ` headings that the old shape does not have.
#
# Usage: scripts/migrate-plans-to-slices.sh [--yes]
#   default is a dry run; --yes writes.
set -euo pipefail

cd "$(dirname "$0")/.."
META="skills/plot/scripts/plot-plan-meta.sh"
APPLY=0
[ "${1:-}" = "--yes" ] && APPLY=1

renamed=0; skipped=0; refused=0

for f in docs/plans/*.md; do
  [ -e "$f" ] || continue
  # Only a plan has a Phase. `docs/plans/` also holds decision logs and worker
  # reports, and the scan applies the same rule.
  grep -qE '^\- \*\*Phase:' "$f" || { skipped=$((skipped + 1)); continue; }
  grep -qE '^## (Branches|Waves)$' "$f" || { skipped=$((skipped + 1)); continue; }

  # THE `file` FIELD IS DROPPED FROM BOTH SIDES, and only that one. The parser
  # echoes the path it was handed, so the candidate — a temp copy — always
  # reports a different `file` than the original and every plan would be
  # refused for a difference the rename did not cause. Measured: the first run
  # refused 182 of 182 on exactly this.
  strip_file() { sed 's/{"file":"[^"]*"/{"file":""/'; }

  before="$(bash "$META" "$f" 2>/dev/null | strip_file)"
  tmp="$(mktemp)"
  sed -E 's/^## (Branches|Waves)$/## Slices/' "$f" > "$tmp"
  after="$(bash "$META" "$tmp" 2>/dev/null | strip_file)"

  if [ "$before" != "$after" ]; then
    # THE ONE REFUSAL, AND IT IS NOT RECOVERABLE BY RETRYING. A file whose
    # parsed form moved is one this rename would damage; it needs a person.
    echo "REFUSED  ${f##*/} — parsed output changed"
    rm -f "$tmp"
    refused=$((refused + 1))
    continue
  fi

  if [ "$APPLY" = 1 ]; then
    mv "$tmp" "$f"
  else
    rm -f "$tmp"
  fi
  renamed=$((renamed + 1))
done

verb=$([ "$APPLY" = 1 ] && echo renamed || echo "would rename")
echo "summary: $verb=$renamed refused=$refused skipped=$skipped"
[ "$refused" -gt 0 ] && exit 1
exit 0
