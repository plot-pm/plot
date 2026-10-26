#!/usr/bin/env bash
# THE GATE THAT KEEPS SHIPPED SHELL RUNNABLE ON BASH 3.2.
#
# PR #2659 added `${1^^}` to `bb_query_state` in `plot-host.sh`. Under
# `/bin/bash` 3.2.57 — the version macOS ships — that function fails with
# `bad substitution`, and all three Bitbucket PR queries break. CI was green
# on that head: every job here runs `ubuntu-latest` with bash 5, and
# `bash -n` passes because a bad substitution is a run-time error, not a
# parse error. A reviewer found it by reading (#2660).
#
# A STATIC SCAN, NOT A BASH 3.2 BINARY. The Ubuntu jobs have none installed,
# and installing one costs more than a grep. A macOS CI job catches what this
# grep cannot (wave 2 of this plan); this gate catches the eight named
# constructs in seconds, on the runner this repo already has.
#
# `bash -n` CANNOT BE THE GATE — see above. Do not substitute it.
#
# COMMENTS AND QUOTED PROSE ARE NOT CONSTRUCTS, and the distinction is
# load-bearing. Measured on this tree: `git grep` for the eight patterns
# returns six hits in `*.sh`. Four are comments that say "no `declare -A`"
# (`plot-dispatch.sh:3868`, `plot-fleet-scan.sh:3036` and `:3068`,
# `plot-reconcile-scan.sh:877`), one is a `sed` false positive (next
# paragraph), and one is real but out of scope (the paragraph after that). A
# gate that flags the comments is reverted on its first run, which is the
# lesson `check-host-cli-callers.sh` already learned.
#
# `plot-fleetctl.sh:1144` IS A FALSE POSITIVE BY DESIGN, not an exemption:
# `sed -e 's/[][\\|&.*^$]/\&/g'` carries `|&` inside a bracket expression,
# packed with no surrounding space. The real pipe operator is always written
# `cmd |& other` — a space (or line start) before it — so the match below
# requires that space, which a bracket expression never has.
#
# `.dev/scripts` IS NOT SCANNED. It holds developer/maintainer tooling run by
# a person or by CI itself, never by the operator's machine or a dispatched
# agent — `.dev/scripts/bump-skill-versions.sh:25` has the one real
# `declare -A` on this tree today. Bringing `.dev/` into scope would fail the
# gate on its own tree and require rewriting that script, which is out of
# scope for this slice. The scanned roots are `skills/**/*.sh` and
# `scripts/*.sh` — the shell this repo ships to run on an operator's machine.
#
# A DELIBERATE USE DECLARES ITSELF. A line carrying a bash-4 construct on
# purpose, guarded by a version check, names itself within five lines above
# with a `plot-bash32:` marker and the guard it relies on — mirroring
# `check-ancestry-decisions.sh`'s declared-kind marker. A marker with no
# guard comment nearby is refused: a declaration that does not say how it is
# safe is not a declaration. Zero lines carry the marker today; it exists for
# the next deliberate use, not to pre-exempt one.
#
# ABSENT IS NOT FALSE. A root with no shell files to scan is a failure of
# this gate (exit 2), not a clean pass — the caller should read the exit
# code, not conclude "zero hits" means "nothing to check".
#
# ONE `grep -rn` PER CONSTRUCT, not a per-line shell loop — this tree is
# ~33,000 lines of shipped shell across 88 files, and a per-line `sed`/`grep`
# subprocess over all of it does not finish in CI's lifetime. `grep` does the
# bulk filtering; only the (few) resulting hits pay for the per-line
# comment-strip and marker-window checks below.

set -uo pipefail

# The tree to check. Defaults to this script's repo, which is what CI runs.
# An explicit root exists so the gate can be pointed at a fixture and its own
# refusal proven. See test/reconcile/bash32-gate.test.mjs.
cd "${1:-$(dirname "${BASH_SOURCE[0]}")/..}" || exit 2

# Shipped shell only: what the plan's helper scripts and skill scripts run on
# an operator's or an agent's machine. `skills/plot/scripts/board/` is
# bundler output, excluded below like every other gate here excludes it.
# `.dev/` is maintainer/CI tooling, deliberately out of scope — see header.
#
# THIS GATE'S OWN FILE IS EXCLUDED TOO. It is itself shipped shell under
# `scripts/`, and its violation messages and pattern table necessarily spell
# out every construct's name as display text and regex source — exactly the
# "comments and quoted prose" shape this gate exists to ignore everywhere
# else, just inside its own body instead of someone else's. Excluding one
# named file is simpler and more honest than disguising the strings.
SELF=$(basename "${BASH_SOURCE[0]}")
ROOTS='skills scripts'

file_count=$(find $ROOTS -type f -name '*.sh' 2>/dev/null \
  | grep -v '/scripts/board/' \
  | grep -vE '(^|/)(test|tests|__tests__)/' \
  | grep -v "/${SELF}\$" \
  | wc -l | tr -d '[:space:]')

if [ "$file_count" = 0 ]; then
  echo "::error::no shipped shell files found under: $ROOTS"
  echo "that is a failure of this gate, not a clean pass — check the root."
  exit 2
fi

# The eight bash-4+ constructs, each a label plus an extended-regex fragment
# for `grep -E`. `${x^^}`/`${x,,}`/`${x@Q}` anchor on a parameter shape so
# they do not fire on an unrelated `${...}` that merely contains `^^`, `,,`
# or `@Q` as data. A parameter is not only an identifier: PR #2659's own
# defect was `${1^^}`, a POSITIONAL parameter, so the class also covers
# digits and the special parameters (`@`, `*`, `#`, `?`, `-`, `$`, `!`, `_`).
NAME_CLASS='[a-zA-Z0-9_@*#?$!-][a-zA-Z0-9_]*'
LABELS=(
  'declare -A'
  '${x^^}'
  '${x,,}'
  'mapfile'
  'readarray'
  '|&'
  '&>>'
  '${x@Q}'
)
PATS=(
  'declare[[:space:]]+-A'
  "\\$\\{$NAME_CLASS(\\[[^]]*\\])?\\^\\^"
  "\\$\\{$NAME_CLASS(\\[[^]]*\\])?,,"
  '(^|[|;&(){[:space:]])mapfile([[:space:]]|$)'
  '(^|[|;&(){[:space:]])readarray([[:space:]]|$)'
  '(^|[[:space:]])\|&'
  '&>>'
  "\\$\\{$NAME_CLASS@Q\\}"
)

MARKER='plot-bash32:[[:space:]]*deliberate[[:space:]]*—'
GUARD='BASH_VERSINFO'

violations=""

for i in "${!PATS[@]}"; do
  pat="${PATS[$i]}"
  label="${LABELS[$i]}"

  while IFS= read -r hit; do
    [ -n "$hit" ] || continue
    file=${hit%%:*}
    rest=${hit#*:}
    line_no=${rest%%:*}
    body=${rest#*:}

    # A comment ABOUT the construct is not the construct. Strip a full-line
    # comment, and a trailing `# …` comment, before deciding this is a hit.
    case "$(printf '%s' "$body" | sed 's/^[[:space:]]*//')" in
      '#'*) continue ;;
    esac
    code_only=$(printf '%s' "$body" | sed -E 's/(^|[^\\])#.*$/\1/')
    [ -n "$(printf '%s' "$code_only" | grep -E "$pat")" ] || continue

    # A deliberate use declares itself within five lines above, with a guard
    # comment naming BASH_VERSINFO nearby. Both must hold, or this is a
    # violation — a marker with no guard is not a declaration.
    from=$(( line_no > 5 ? line_no - 5 : 1 ))
    window=$(sed -n "${from},${line_no}p" "$file" 2>/dev/null)
    if printf '%s' "$window" | grep -qE "$MARKER" \
      && printf '%s' "$window" | grep -q "$GUARD"; then
      continue
    fi

    violations="${violations}${file}:${line_no}: ${label}
"
  done <<EOF
$(grep -rEn --include='*.sh' "$pat" $ROOTS 2>/dev/null \
  | grep -v '/scripts/board/' \
  | grep -vE '(^|/)(test|tests|__tests__)/' \
  | grep -v "/${SELF}:")
EOF
done

if [ -n "$violations" ]; then
  echo "::error::shipped shell uses a bash-4+ construct; macOS ships bash 3.2."
  echo
  echo "PR #2659 added \`\${1^^}\` to \`bb_query_state\` and CI stayed green —"
  echo "every job here runs bash 5, and \`bash -n\` cannot catch a run-time"
  echo "failure. Under bash 3.2 the function failed with \"bad substitution\"."
  echo
  echo "Bash-3.2 equivalents:"
  echo "  \${x^^} / \${x,,}   ->  tr '[:lower:]' '[:upper:]' (or the reverse)"
  echo "  declare -A        ->  a newline-delimited string, or two parallel arrays"
  echo "  mapfile/readarray ->  a \`while read\` loop"
  echo "  |& / &>>          ->  2>&1 | ... / >>file 2>&1"
  echo "  \${x@Q}            ->  printf '%q' \"\$x\""
  echo
  echo "If this use is deliberate and guarded by a BASH_VERSINFO check, declare"
  echo "it within five lines above the line:"
  echo "  # plot-bash32: deliberate — guarded by a BASH_VERSINFO[0] check above."
  echo
  echo "Violations:"
  printf '%s' "$violations" | sort -u
  exit 1
fi

echo "Bash 3.2 syntax: clean."
