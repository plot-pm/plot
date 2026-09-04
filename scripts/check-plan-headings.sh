#!/usr/bin/env bash
# THE GATE THAT KEEPS THE WORD. A plan's branch section is `## Slices`.
#
# `plot-plan-meta.sh:736` accepts `## Branches`, `## Waves` and `## Slices` in
# one rule, and it must keep accepting all three: a plan file may have been
# written a year ago, and refusing to READ the old word would make Plot worse at
# its own job. Reading them is compatibility. WRITING one is drift.
#
# Measured 2026-09-05: three plans authored that day — every plan written under
# the story that exists to fix this vocabulary — carried `## Branches`, months
# after `scripts/migrate-plans-to-slices.sh` had renamed the estate. Nothing
# refused them, so nothing stopped the next one. Prose said Slices; the files
# said Branches; the gap lasted until a person read a plan and objected.
#
# HISTORY IS NOT DRIFT. A delivered or released plan says what was true when it
# was written, and rewriting it to match today's vocabulary destroys the record
# this repo keeps deliberately. So the gate reads the plan's own phase and asks
# only of the ones still being worked on.
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
meta="$here/skills/plot/scripts/plot-plan-meta.sh"
bad=""

for f in "$here"/docs/plans/*.md; do
  [ -e "$f" ] || continue
  grep -q '^## Branches\|^## Waves' "$f" || continue
  # The phase decides. A plan the estate has finished with keeps its words.
  phase=$(bash "$meta" "$f" 2>/dev/null \
          | python3 -c 'import json,sys;print(json.load(sys.stdin).get("phase",""))' 2>/dev/null || true)
  case "$phase" in
    delivered|released) continue ;;
  esac
  bad="$bad  ${f#"$here"/}  (phase=${phase:-unreadable})
"
done

if [ -n "$bad" ]; then
  echo "::error::a plan still names its branch section '## Branches' or '## Waves'."
  echo "A slice holds one branch and belongs to one plan — the section is '## Slices'."
  echo "The parser reads all three spellings and always will; this gate is about"
  echo "what Plot WRITES. Delivered and released plans are exempt: they are history."
  printf '%s' "$bad"
  exit 1
fi

echo "plan headings: every unfinished plan names its section '## Slices'."
