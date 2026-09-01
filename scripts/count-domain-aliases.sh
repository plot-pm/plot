#!/usr/bin/env bash
# Counts the domain names production still aliases: a rule that moved, whose
# old name was kept alive by a re-export.
#
# Prints one `file:line: old -> new` per alias on stdout and the count on the
# last line as `count=N`. Exits 0 whatever it finds — the CI step applies the
# threshold, this decides nothing.
#
# THE SUBJECT IS THE RE-EXPORT, NOT ITS CALL SITES. Measured 2026-08-30, one
# `export { allSlicesMerged as allWavesMerged }` carried three callers. Counting
# callers goes red on a refactor that touches them without changing the seam,
# and green when a fourth call joins an alias that should not exist.
#
# WHAT COUNTS AS AN ALIAS — the definition the brief asked for, and its reason.
#
# A renaming re-export whose ORIGINAL name is exported from exactly one module.
# That clause is the whole test, and it is mechanical rather than a judgement:
#
#   - `export { allSlicesMerged as allWavesMerged }` — `allSlicesMerged` is
#     exported by one module, `rules/deliverable.ts`. Nothing collides with it,
#     so the second name buys no clarity: it exists only to keep a moved rule
#     reachable under the name it had before it moved. THIS is the residue.
#
#   - `export { approve as approveTransition }` in the domain barrel —
#     `approve` is a real export of BOTH `transitions/plan.ts` and
#     `workflows/approve.ts`. Two live functions collide in the one module where
#     both are in scope, and one of them must be renamed for the barrel to
#     compile at all. Nothing was kept alive; nothing is owed. Not counted.
#
# So the gate asks of the ORIGINAL name: "did anything force this rename?" A
# collision forces it. A name that is alone in the workspace forces nothing, so
# a rename of it is a name somebody chose to preserve.
#
# TESTING THE NEW NAME INSTEAD DOES NOT WORK, and the estate says so: measured
# 2026-08-30, `approveTransition` is declared nowhere either — it is coined at
# the barrel, exactly like `allWavesMerged`. Both alias targets are undeclared,
# so that test cannot tell them apart and reported all three barrel entries.
# The collision on the SOURCE side is what differs.
#
# TWO SHAPES DELIBERATELY NOT COUNTED, because the brief asked for the reason
# and not only the ruling:
#
#   - A RENAMING IMPORT (`import { x as y }`) is local to one file and rebinds
#     nothing for anyone else. It cannot keep a name alive across the estate,
#     which is what this gate is about. The one in the tree today —
#     `type Machine as MachineEntity` in `machine-reading.ts` — renames to avoid
#     a collision with a local symbol, the disambiguating shape again.
#
#   - A FORWARDING WRAPPER (`const y = (…) => x(…)`) is not counted, and this
#     is the honest limit of the gate rather than a claim it is complete. It is
#     indistinguishable by grep from an adapter, a partial application, or a
#     narrowing — all legitimate. Counting it would need the type checker, and a
#     pattern that guessed would fail in the direction that teaches evasion: the
#     lesson `.github/workflows/ci.yml`'s vocabulary gate already records, where
#     a too-broad rule made the correct name the expensive one and a worker
#     invented `Cohort` to escape it. A wrapper that exists only to preserve an
#     old name is a review finding here, not a gate finding.
#
# MULTI-LINE BLOCKS ARE PARSED, not grepped line by line. Measured 2026-08-30:
# the three aliases in `packages/domain/src/index.ts` sit inside a multi-line
# `export { … } from '…'`, and a single-line pattern misses every one of them —
# a gate that reports zero because it cannot see is worse than no gate.
set -uo pipefail

roots=("packages/board/src" "packages/domain/src")

# How many modules DECLARE each exported name. An alias's original name is
# looked up here: two or more declaring modules is a genuine collision, one is a
# name that needed no second spelling.
#
# Declarations only — a re-export is not a declaration, or the barrel line under
# test would count itself as the collision that excuses it.
declared=$(
  grep -rhoE '^\s*export (const|function|class|type|interface|enum) [A-Za-z_][A-Za-z0-9_]*' \
    --include='*.ts' "${roots[@]}" 2>/dev/null \
    | awk '{print $NF}' \
    | sort | uniq -c
)

aliases=$(
  for root in "${roots[@]}"; do
    find "$root" -name '*.ts' -type f 2>/dev/null | while read -r file; do
      # Join each `export { … }` block onto one logical line, then split the
      # specifiers, so single-line and multi-line blocks read the same.
      awk -v F="$file" '
        /^[[:space:]]*export[[:space:]]*\{/ { inblk=1; buf=""; start=NR }
        inblk {
          buf = buf " " $0
          if (index($0, "}") > 0) {
            inblk = 0
            sub(/.*\{/, "", buf); sub(/\}.*/, "", buf)
            n = split(buf, parts, ",")
            for (i = 1; i <= n; i++) {
              s = parts[i]
              gsub(/^[[:space:]]+|[[:space:]]+$/, "", s)
              sub(/^type[[:space:]]+/, "", s)
              if (s ~ /[[:space:]]as[[:space:]]/) {
                split(s, ab, /[[:space:]]+as[[:space:]]+/)
                gsub(/^[[:space:]]+|[[:space:]]+$/, "", ab[1])
                gsub(/^[[:space:]]+|[[:space:]]+$/, "", ab[2])
                if (ab[2] != "default") print F ":" start "\t" ab[1] "\t" ab[2]
              }
            }
          }
        }
      ' "$file"
    done
  done
)

count=0
while IFS=$'\t' read -r loc old new; do
  [ -n "${new:-}" ] || continue
  # The test: did a collision force this rename? Two or more modules declaring
  # the original name means yes.
  declarations=$(printf '%s\n' "$declared" | awk -v n="$old" '$2 == n {print $1; found=1} END {if (!found) print 0}')
  if [ "${declarations:-0}" -gt 1 ]; then
    continue
  fi
  echo "$loc: $old -> $new"
  count=$((count + 1))
done <<< "$aliases"

echo "count=$count"
