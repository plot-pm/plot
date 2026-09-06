#!/usr/bin/env bash
# THE GATE THAT STOPS THE NEXT HIDDEN LIFECYCLE.
#
# `WorktreeState` read `created -> occupied -> finished -> reapable -> gone` and
# nothing refused `gone -> occupied`. Measured 2026-09-04: 37 `z.enum`
# occurrences in the domain and ONE `transitions/*.ts` rule, so thirty-six sets
# of states said nothing about which move between them is legal. Three sibling
# slices wrote the rules for Story, Agent and Worktree; this is what stops the
# next enum arriving the same way.
#
# MEASURED HERE 2026-09-06: 37 occurrences, 4 rules — 10 lifecycles, 10
# readings, 17 classifications, and six lifecycles still owed a rule.
#
# A STATE ENUM IS NOT ALWAYS A LIFECYCLE, and the gate must not pretend
# otherwise. `MoscowTier` is `must | should | could | deferred` — a PRIORITY, and
# a Could becoming a Must is a re-prioritisation rather than a transition.
# `Mergeability` is `mergeable | conflicting | unknown` — a READING of a moment
# that nothing moves between. A gate that guessed would refuse a priority for
# lacking a transition it cannot have, and the fix would be a rule that lies.
#
# WHY A HEURISTIC CANNOT DO IT, in the plan's own words and its own mistake: the
# paragraph arguing for the declaration cited `SprintState` and `PrState` as
# examples of enums that do not transition. Both are lifecycles, and `PrState`
# is the clearest one in the repo. `entities/pr.ts` is why — four enums in one
# file, of which one transitions and three do not, so reaching for the file and
# taking the first enum finds the exception. A heuristic reads exactly that way.
#
# SO THE AUTHOR DECLARES, within five lines above the enum, in one of three
# kinds. This is `check-ancestry-decisions.sh`'s act: that gate bans an
# undeclared DECISION rather than an ancestry call, for the same reason — no
# grep separates the kinds, because the difference is what the states mean.
#
#   plot-state: lifecycle <entity> — <the order, and what refuses a wrong move>
#   plot-state: reading            — <what moment it records, and what re-reads it>
#   plot-state: classification     — <why every value is reachable from every other>
#
# WHERE THE MARKER SAYS `lifecycle`, THE RULE IS ALSO REQUIRED. A marker alone
# would let a lifecycle be declared and never written; a file check alone cannot
# see WHICH enum it covers. Together they answer both halves and neither is
# satisfiable by accident.
#
# THE UNIT IS THE ENUM, NEVER THE FILE. `entities/sprint.ts` holds three enums —
# `SprintState` is a lifecycle, `MoscowTier` and `ItemStatus` are not — so a
# `transitions/sprint.ts` would satisfy a file-level gate for all three,
# including the two that must never have one. `rules/verdict.ts` is worse: it
# holds enums for entities that do not share its name. There is no reliable
# enum -> entity mapping, and the enum is also the thing that can hide.
#
# IT MATCHES `z.enum(`, NOT `export const …Schema = z.enum(`. Two of the
# occurrences are inline field enums with no name to hang a declaration on —
# `charter.ts` `atCeiling` and `fleet.ts` `host`. A gate matching the export
# shape would report a clean estate while skipping exactly those two: the blind
# spot a NUL byte already cost this repo across six gates.
#
# AND THE NUL BYTE IS HERE ALREADY, which is why the search reads `grep -a`.
# `entities/finding.ts:104` composes a key as `${monitor}\0${branch}` — a real
# NUL in a template literal, deliberately. `grep` therefore calls the whole file
# binary and reports `Binary file … matches` INSTEAD OF ITS LINES.
#
# IT WAS HIDING TWO ENUMS. `MonitorName` and `FindingName` live in that file,
# and every count taken for this slice missed both — the plan's 37, the brief's
# re-measured 35, and the hand count that wrote the declarations. The first run
# of this gate died parsing `Binary file …` as a hit; with `-a` it named the two
# at once. A gate that had swallowed that message instead would have reported a
# clean estate over a file nothing could see into, forever.
#
# THE DEBT IS COUNTED, NOT REFUSED. Six enums are declared `lifecycle` and have
# no rule yet — Sprint, PR, Build, Branch, Worker, Release. Writing six rules is
# six slices, not one, so the gate holds that number at a literal ceiling and
# fails when it GROWS. An undeclared enum, by contrast, is refused outright:
# nothing needs writing to add one line, and the declarations ARE the review that
# finds the next lifecycle nobody had noticed.
#
# `LIFECYCLE_DEBT` IS A LITERAL ON PURPOSE, like `ci.yml`'s spawn ratchet.
# Deriving it from the estate would make the gate agree with whatever it found,
# which is a check you can answer "yes" to without doing the work. Lowering it
# costs a visible line in a diff, and that line is the decision.

set -uo pipefail

# The tree to check. Defaults to this script's repo, which is what CI runs. An
# explicit root exists so the gate can be pointed at a fixture and its own
# refusal proven — a gate nothing tests is a gate that passes because nobody
# looked. See test/reconcile/state-declaration-gate.test.mjs.
cd "${1:-$(dirname "${BASH_SOURCE[0]}")/..}" || exit 2

# How many `lifecycle` declarations may still lack their rule. The target is
# zero; this is the debt, not a budget.
LIFECYCLE_DEBT=6

# Where the domain's state lives. Only this package: the board holds hand-copied
# duplicates of some of these, which is a known defect with its own plan, and a
# gate demanding declarations on a copy would license the copy.
ROOTS='packages/domain/src'

MARKER='plot-state:[[:space:]]*(lifecycle[[:space:]]+[a-z-]+|reading|classification)[[:space:]]*—'

undeclared=""
missing_rule=""
lifecycles=0
readings=0
classifications=0

while IFS= read -r hit; do
  [ -n "$hit" ] || continue
  file=${hit%%:*}
  rest=${hit#*:}
  line=${rest%%:*}
  body=${rest#*:}
  # A comment ABOUT an enum is not an enum. This repo carries a great deal of
  # prose naming `z.enum`, and a gate forcing it out would remove the reasoning
  # and leave the declarations it exists to require.
  case "$(printf '%s' "$body" | sed 's/^[[:space:]]*//')" in
    '//'*|'*'*|'/*'*) continue ;;
  esac

  # The five lines above the enum, where the declaration must sit. A marker at
  # the top of a file is a claim about a file; this is a claim about a set of
  # states, and `sprint.ts` holds three sets of two kinds.
  #
  # AND THE WINDOW STOPS AT THE PREVIOUS ENUM, which the contract test found by
  # failing. Two enums three lines apart — the `finding.ts` and `identity.ts`
  # shape — put the first one's marker inside the second one's window, so a
  # single declaration licensed BOTH sets of states. That is the file-level gate
  # this one exists to avoid, arriving through the back door: a declaration
  # cannot reach past a set of states it has already described.
  from=$(( line > 5 ? line - 5 : 1 ))
  prev=$(sed -n "${from},$((line - 1))p" "$file" 2>/dev/null \
    | grep -nE 'z\.enum\(' | tail -n 1 | cut -d: -f1)
  [ -n "$prev" ] && from=$(( from + prev ))
  window=$(sed -n "${from},$((line - 1))p" "$file" 2>/dev/null)
  marker=$(printf '%s' "$window" | grep -oE "$MARKER" | tail -n 1)

  if [ -z "$marker" ]; then
    undeclared="${undeclared}${file}:${line}:${body}
"
    continue
  fi

  case "$marker" in
    *lifecycle*)
      lifecycles=$((lifecycles + 1))
      entity=$(printf '%s' "$marker" | sed -E 's/.*lifecycle[[:space:]]+([a-z-]+).*/\1/')
      # The other half: a declared lifecycle must have somewhere the legal moves
      # are written. Named by the DECLARATION rather than by the file the enum
      # sits in — `rules/phase.ts` declares the Plan's, and no path derives that.
      if [ ! -f "packages/domain/src/transitions/${entity}.ts" ]; then
        missing_rule="${missing_rule}${file}:${line}: declares lifecycle '${entity}', no transitions/${entity}.ts
"
      fi
      ;;
    *reading*) readings=$((readings + 1)) ;;
    *classification*) classifications=$((classifications + 1)) ;;
  esac
done <<EOF
$(grep -rEna --include='*.ts' 'z\.enum\(' $ROOTS 2>/dev/null \
  | grep -vE '(^|/)(test|tests|__tests__)/' \
  | grep -vE '\.test\.ts|\.spec\.ts')
EOF

echo "state enums declared: lifecycle=$lifecycles reading=$readings classification=$classifications"

status=0

if [ -n "$undeclared" ]; then
  echo "::error::a set of states says nothing about whether it is a lifecycle."
  echo
  echo "An enum either names an order something passes through, or it does not."
  echo "No grep can tell those apart — the paragraph that argued for this gate"
  echo "named PrState and SprintState as non-lifecycles, and both transition."
  echo
  echo "Say which it is, within five lines above the enum:"
  echo
  echo "  // plot-state: lifecycle <entity> — <the order, and what refuses a wrong move>"
  echo "  // plot-state: reading            — <what moment it records, and what re-reads it>"
  echo "  // plot-state: classification     — <why every value reaches every other>"
  echo
  echo "A 'lifecycle' declaration also needs packages/domain/src/transitions/<entity>.ts."
  echo
  echo "Undeclared enums:"
  printf '%s' "$undeclared"
  status=1
fi

if [ -n "$missing_rule" ]; then
  count=$(printf '%s' "$missing_rule" | grep -c . )
  echo
  echo "lifecycles awaiting a rule: $count (debt allowed: $LIFECYCLE_DEBT)"
  printf '%s' "$missing_rule"
  if [ "$count" -gt "$LIFECYCLE_DEBT" ]; then
    echo
    echo "::error::a new lifecycle was declared with no transitions rule behind it."
    echo
    echo "Write packages/domain/src/transitions/<entity>.ts — the legal moves and"
    echo "the refusals — or, if this is migration debt somebody has decided to"
    echo "carry, raise LIFECYCLE_DEBT in this script. That line is the decision."
    status=1
  fi
fi

[ "$status" -eq 0 ] && echo "State declarations: clean."
exit "$status"
