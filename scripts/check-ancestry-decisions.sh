#!/usr/bin/env bash
# THE GATE THAT BANS THE DECISION, NOT THE CALL.
#
# "Did this branch's work land?" has ONE answer in this repo and it is the
# host's — `plot-pr-merged.sh`, which reads `mergedAt`, never `state`, and never
# ancestry. Measured 2026-09-04 on this estate: ten merged branches still
# carried a remote ref and `git merge-base --is-ancestor` disagreed with the
# host on TEN OF TEN. Squash-merge does not make ancestry occasionally wrong —
# the squashed commit is not the branch's commit, so it is wrong every time.
#
# WHY THIS IS NOT A GREP FOR `--is-ancestor`. Two of the ancestry callers here
# are correct and must survive:
#
#   * `plot-merge-queue.sh` skips a branch already in main before predicting
#     conflicts. A wrong answer costs one wasted `merge-tree`, not a hidden
#     branch.
#   * `refs-git.ts` names its export `isMergedByAncestry` and answers `unknown`
#     when it cannot tell — the exact honesty this rule asks for everywhere
#     else. A gate banning every ancestry call would ban that `unknown`.
#
# Neither asks *did this land*. They ask *can I skip this cheaply*, and the two
# differ in what a wrong answer costs: extra work, versus finished work
# reported as outstanding.
#
# A GREP CANNOT TELL THEM APART, because the difference is what the answer flows
# INTO and no line-oriented match sees that. So the gate asks the AUTHOR to say
# which one it is, in a marker beside the call, and refuses a site that declares
# nothing. That is what makes it a gate rather than a rule: "did I complete
# this?" cannot be answered yes without the marker being in the diff, and the
# marker is a line a reviewer reads.
#
#   plot-ancestry: prefilter — <why a wrong answer only costs work>
#   plot-ancestry: evidence  — <why this reports rather than decides>
#
# `prefilter` means the answer only ever SKIPS work. `evidence` means it is
# handed on as one input and something else decides — including answering
# `unknown`. There is deliberately no third kind: a site that would need one is
# a site that should be reading `plot-pr-merged.sh`.
#
# WITHIN FIVE LINES ABOVE THE CALL, so the declaration and the call are read
# together. A marker at the top of a 200-line file is a claim about a file; this
# is a claim about a line.
#
# GENERATED ARTIFACTS ARE EXCLUDED. `board-server.mjs` and `plot-ask.mjs` are
# bundler output — minified, unreadable, and re-derived from the sources this
# gate already checks. Marking them would mean marking a build product, and a
# rebuild would drop it.
#
# TESTS ARE EXCLUDED for the same reason a test may call anything: a fixture
# that BUILDS an ancestry shape is proving the production code answers it
# correctly, and requiring a licence there would ask a test to justify the very
# thing it exists to reproduce.

set -uo pipefail

# The tree to check. Defaults to this script's repo, which is what CI runs.
# An explicit root exists so the gate can be pointed at a fixture and its own
# refusal proven — a gate nothing tests is a gate that passes because nobody
# looked. See test/reconcile/ancestry-gate.test.mjs.
cd "${1:-$(dirname "${BASH_SOURCE[0]}")/..}" || exit 2

# The shapes that ask git an ancestry question. Not exhaustive over everything
# git can express — a gate on every reachability idiom is a gate on a pattern
# nobody maintains. What it catches is the shape that actually happened.
PATTERN='merge-base[^|;&]*--is-ancestor|--no-merged|branch -r --merged|'"'"'--merged'"'"'|"--merged"'

# Where production code lives. `skills/plot/scripts/board/` is bundler output.
ROOTS='skills packages/domain/src packages/board/src'

MARKER='plot-ancestry:[[:space:]]*(prefilter|evidence)[[:space:]]*—'

undeclared=""
declared=0

while IFS= read -r hit; do
  [ -n "$hit" ] || continue
  file=${hit%%:*}
  rest=${hit#*:}
  line=${rest%%:*}
  # A comment ABOUT ancestry is not a call. Strip the shell/JS/TS comment forms.
  case "$rest" in
    *:[[:space:]]*'#'*|*:[[:space:]]*'//'*|*:[[:space:]]*'*'*) ;;
  esac
  body=${rest#*:}
  case "$(printf '%s' "$body" | sed 's/^[[:space:]]*//')" in
    '#'*|'//'*|'*'*|'/*'*) continue ;;
  esac
  # The five lines above the call, where the licence must sit.
  from=$(( line > 5 ? line - 5 : 1 ))
  window=$(sed -n "${from},$((line - 1))p" "$file" 2>/dev/null)
  if printf '%s' "$window" | grep -qE "$MARKER"; then
    declared=$((declared + 1))
    continue
  fi
  undeclared="${undeclared}${file}:${line}: ${body}
"
done <<EOF
$(grep -rEn --include='*.sh' --include='*.ts' --include='*.mjs' \
    "$PATTERN" $ROOTS 2>/dev/null \
  | grep -v '/board/plot-ask.mjs:' \
  | grep -v '/scripts/board/' \
  | grep -vE '(^|/)(test|tests|__tests__)/' \
  | grep -vE '\.test\.(ts|mjs|js)|\.spec\.(ts|mjs|js)')
EOF

echo "ancestry call sites declared: $declared"

if [ -n "$undeclared" ]; then
  echo "::error::an ancestry call decides merge state, or declares nothing about it."
  echo
  echo "\"Did this branch's work land?\" is the host's answer, not git's:"
  echo "  read \`plot-pr-merged.sh\` (shell) or the host port's PR state (TypeScript)."
  echo "  Ancestry disagreed with the host on 10 of 10 merged branches here on"
  echo "  2026-09-04 — squash-merge makes it wrong every time."
  echo
  echo "If this call only SKIPS work, or is handed on as evidence for something"
  echo "else to decide, say so within five lines above it:"
  echo
  echo "  # plot-ancestry: prefilter — a wrong answer costs one extra <thing>."
  echo "  # plot-ancestry: evidence  — handed to <what decides>, which may answer unknown."
  echo
  echo "Undeclared sites:"
  printf '%s' "$undeclared"
  exit 1
fi

echo "Ancestry decisions: clean."
