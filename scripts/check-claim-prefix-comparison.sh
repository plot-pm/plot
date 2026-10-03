#!/usr/bin/env bash
# THE CLAIM VOCABULARY HAS ONE HOME: `packages/domain/src/rules/empty-claim.ts`.
#
# A claim marker is a commit whose subject starts `plot: claim ` AND whose tree
# equals its first parent's. The prefix comparison — the `startsWith` half of
# that test — exists in `empty-claim.ts` and nowhere else in the domain or the
# board's TypeScript: `claim.ts`'s `claimTip` calls `realCommits`, which calls
# `isEmptyClaim`, and never re-tests the subject itself.
#
# A SUBJECT-ONLY PREDICATE WAS THE PLAN'S FIRST DRAFT, AND IT WAS WRONG. A
# commit titled `plot: claim handling refactor` that changes a file is real
# work; a second comparison of the prefix alone — in a new rule, a new adapter,
# a new test helper — is exactly how that mistake would re-enter the domain,
# because nothing would call `isEmptyClaim` to also check the tree.
#
# THIS GATE SCANS THE DOMAIN AND THE BOARD'S TYPESCRIPT ONLY, NOT THE SHELL.
# `plot-reconcile-scan.sh` and `plot-fleet-scan.sh` carry their own
# `case "$subj" in "plot: claim "*)` comparisons, declared at length in the
# surrounding prose — the shell side of the SAME rule, kept in sync with
# `isEmptyClaim` by a person rather than by a shared implementation, per
# `docs/shell-and-domain.md`'s "a shell script asks the domain" doctrine. That
# is deliberate duplication, not the undeclared kind this gate exists to catch
# in new TypeScript, and gating the shell here would refuse `main` itself.
#
# WHY THIS IS NOT A GREP FOR THE STRING `plot: claim`. `plot-worker-loop.sh`'s
# `git commit -m "plot: claim $next_branch"` WRITES the subject; it is not a
# comparison, and a gate banning the string would refuse the very commit the
# rule is about. So this looks for the shapes that COMPARE a subject against
# the prefix — `startsWith`, a `switch`/`case`, `===`, a regex test, or a
# shell `case`/`grep -q` — never for the string alone.
#
# THE EXCLUDED FILE IS NAMED, NOT INFERRED: a comparison inside
# `empty-claim.ts` itself is the rule's own implementation and is excluded by
# path rather than by re-deriving "is this the home" from the gate's own logic.
#
# Usage: check-claim-prefix-comparison.sh [repo-root]   (default: this repository)
set -uo pipefail

cd "${1:-$(dirname "${BASH_SOURCE[0]}")/..}" || exit 2

# `plot: claim ` is matched loosely enough to catch a `startsWith`/`===`
# argument, a regex literal, or a `case` pattern — all of which carry the
# phrase as a string somewhere on the line — and the shapes below narrow that
# down to an actual comparison rather than a plain mention.
PHRASE='plot:[[:space:]]*claim[[:space:]]'

# The shapes a COMPARISON of the subject takes. `grep -q` and a shell `case`
# cover the shell forms this gate still wants to catch if one appears outside
# the two declared files below; `startsWith`, `===`, `==` and a regex `test(`
# cover the TypeScript forms.
PATTERN="\\.startsWith\\(|case[[:space:]]|===|==[^=]|\\.test\\(|=~|grep -q"

ROOTS='packages/domain/src packages/board/src'

# THE ONE HOME, by path — the only file allowed to compare the prefix.
EXEMPT_FILE='packages/domain/src/rules/empty-claim.ts'

undeclared=""
checked=0

while IFS= read -r hit; do
  [ -n "$hit" ] || continue
  file=${hit%%:*}
  rest=${hit#*:}
  line=${rest%%:*}
  body=${rest#*:}

  [ "$file" = "$EXEMPT_FILE" ] && { checked=$((checked + 1)); continue; }

  # A comment ABOUT the vocabulary is not a comparison. Strip the TS comment
  # forms before testing for the comparison shapes — this repo explains the
  # rule in prose at length, and that prose must not trip the gate.
  trimmed=$(printf '%s' "$body" | sed 's/^[[:space:]]*//')
  case "$trimmed" in
    '//'*|'*'*|'/*'*) continue ;;
  esac

  # THE LINE MUST CARRY BOTH THE PHRASE AND A COMPARISON SHAPE. A file that
  # merely mentions `plot: claim` in a docstring, with no `startsWith`/`case`/
  # `===` beside it, is not what this gate refuses.
  printf '%s' "$body" | grep -qiE "$PHRASE" || continue
  printf '%s' "$body" | grep -qE "$PATTERN" || continue

  undeclared="${undeclared}${file}:${line}: ${body}
"
done <<EOF
$(grep -rEn --include='*.ts' --include='*.mjs' -i "$PHRASE" $ROOTS 2>/dev/null \
  | grep -vE '(^|/)(test|tests|__tests__)/' \
  | grep -vE '\.test\.(ts|mjs|js)|\.spec\.(ts|mjs|js)')
EOF

echo "claim-prefix comparisons outside empty-claim.ts: checked ${checked} site(s) in the home file"

if [ -n "$undeclared" ]; then
  echo "::error::a claim-prefix comparison lives outside empty-claim.ts."
  echo
  echo "The claim vocabulary — a commit titled \`plot: claim \` AND empty — has"
  echo "one home: \`${EXEMPT_FILE}\`. A second comparison of the prefix alone"
  echo "is how the plan's first, wrong draft re-enters: a commit titled"
  echo "\"plot: claim handling refactor\" that changes a file is real work, and"
  echo "a subject-only test would read it as an empty claim."
  echo
  echo "Call \`isEmptyClaim\`/\`realCommits\` from \`rules/empty-claim.ts\`"
  echo "instead of re-testing the prefix."
  echo
  echo "Undeclared sites:"
  printf '%s' "$undeclared"
  exit 1
fi

echo "Claim-prefix comparisons: clean."
