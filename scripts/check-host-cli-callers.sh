#!/usr/bin/env bash
# THE GATE THAT KEEPS ONE PLACE TALKING TO THE HOST.
#
# `plot-host.sh` is the ONE script that may ask a git host a question. That has
# been the rule in CLAUDE.md — *"the ONE place that talks to the host CLI"* —
# since the adapter was written, and on 2026-09-05 four scripts violated it:
# `plot-reconcile-scan.sh`, `plot-agent-monitor.sh`, `plot-pr-state.sh` and
# `plot-pr-merged.sh` each held their own `gh` call. That is a rule failing
# exactly as CLAUDE.md predicts a rule will, so it is now a gate.
#
# WHAT A SECOND CALLER COSTS is not style. Every one of those four asked about
# GitHub and nothing else, so a Bitbucket checkout got a helper that was not
# wrong but absent — `plot-pr-state.sh` answered `{"found": false}` about a plan
# whose PR was open. And the copies drift: the adapter learned Bitbucket's
# DECLINED-is-CLOSED normalisation and its rate-limit exit codes, and none of
# the four did.
#
# THIS GATE IS A PATH CHECK WITH A NAMED EXCEPTION LIST, which is simpler than
# `check-ancestry-decisions.sh` beside it. That gate bans a DECISION and cannot
# see one in a line, so it asks each site to declare its kind. Here the line
# itself is the violation: a script outside `plot-host.sh` that invokes `gh` or
# `bb` has reached past the adapter, whatever it then does with the answer.
#
# COMMENTS ARE NOT CALLS, and the distinction is load-bearing rather than
# tidy. `plot-budget.sh` and `plot-worker-monitor.sh` mention `gh` only in
# prose, and `plot-reconcile-scan.sh` prints `inspect: gh pr view …` as ADVICE
# TO A PERSON inside a report string. A gate flagging those three would be
# reverted on its first run, and a reverted gate protects nothing.
#
# ---------------------------------------------------------------------------
# THE EXCEPTIONS, each a different question rather than a tolerated violation
# ---------------------------------------------------------------------------
#
# `plot-update-board.sh` — THE GITHUB PROJECTS API, NOT THE PR API. Its four
#   calls are `gh project view`, `item-add`, `field-list` and `item-edit`.
#   `plot-host.sh` answers `pr-state`, `pr-list`, `pr-merge`, `pr-create`,
#   `pr-body`, `issue-list` and `issue-view`, and nothing at all about
#   projects. Routing it is therefore not routing — it is widening the adapter
#   with a host surface it does not have, which is capability, and belongs in
#   its own plan rather than smuggled into this one. Exempt until someone
#   decides to add project ops, and then this line is what they delete.
#
# `plot-board-probe.sh` — ASKS WHICH CLI EXISTS, not what a PR's state is. It
#   reports `installed` and `auth` for `gh`, `bb` AND `jen` side by side, so it
#   must address each CLI directly: routed through the adapter it could only
#   ever describe the ONE configured backend, which is the opposite of a probe
#   whose whole output is the comparison. `gh auth status` asks *can this CLI
#   be used*; the adapter answers *what does the host say*. Different question,
#   different script.
#
# `ralph-sprint.sh` — the same `gh auth status` preflight, for the same reason:
#   a sprint runner refusing to start without credentials is checking the tool,
#   not asking about a PR.
#
# `plot-pr-merged.sh` — EXEMPT ON A MEASUREMENT, AND NO LONGER MERELY DATED.
#   It asks exactly what this gate is about, and its two `gh pr list` lookups
#   should route. The routing was attempted 2026-09-06 and it does not hold
#   yet, for a reason that was not visible until the two were compared
#   side by side.
#
#   THE FIRST HALF WAS FIXED ON 2026-09-06 AND THE ENTRY SHRANK RATHER THAN
#   DISAPPEARING. `plot-host.sh pr-merged` read an ABSENT CLI as `not-merged`
#   where this file answers `unaskable`, because `is_lookup_miss` matched the
#   shell's own `bash: gh: command not found` on its bare `not found`
#   alternative — one phrase, two conditions. It now excludes that phrasing:
#
#     before   pr-merged → not-merged    _plot_merged_lookup → unaskable
#     after    pr-merged → unknown       _plot_merged_lookup → unaskable
#
#   The direction was why it blocked: `not-merged` reads to `rules/landed.ts`
#   as `none` — the host spoke and said nothing merged — so `mayRemove` may
#   permit a removal where `unaskable` refuses, and `plot-release-refs.sh`
#   deletes remote refs on that answer.
#
#   WHAT REMAINS IS THE OPEN LOOKUP, AND IT IS THE WHOLE EXEMPTION NOW.
#   `pr_open` needs `found`/`none`/`unaskable` about ANY open PR. `pr-state`
#   answers about ONE PR — the newest — and collapses a failed lookup into the
#   same `state:"NONE"` payload as a real absence, so it can express neither
#   "any" nor "unaskable". Routing that half needs a new op, which is capability
#   rather than routing.
#
#   AND THE PAIR MOVES TOGETHER OR NOT AT ALL. `pr_open` vetoes a deletion, so
#   it can only ever KEEP a ref — safe only because `pr_merged` already refused
#   on the same silence. Routing one and not the other would separate two
#   answers whose safety is a property of the pair.
#
#   Pinned by two tests in test/reconcile/host.test.mjs, so this entry rests on
#   something that fails when it stops being true — and one of them has already
#   fired once, which is what shrank this entry. Delete it when an open-PR
#   lookup exists, not merely when someone reads the three words and assumes
#   they match.
#
# There is deliberately no exception for "just this one PR lookup". A site that
# would want one is a site that should be calling `plot-host.sh`.

set -uo pipefail

# The tree to check. Defaults to this script's repo, which is what CI runs.
# An explicit root exists so the gate can be pointed at a fixture and its own
# refusal proven — a gate nothing tests is a gate that passes because nobody
# looked. See test/reconcile/host-cli-gate.test.mjs.
cd "${1:-$(dirname "${BASH_SOURCE[0]}")/..}" || exit 2

# Where production shell lives. `skills/plot/scripts/board/` is bundler output.
ROOTS='skills scripts hooks'

# The adapter itself, and the scripts exempted above by name and with a reason.
#
# The first three are different questions; the fourth is a gap, and its entry
# above says which is which.
ALLOWED='skills/plot/scripts/plot-host.sh
skills/plot/scripts/plot-update-board.sh
skills/plot/scripts/plot-board-probe.sh
skills/ralph-plot-sprint/ralph-sprint.sh
skills/plot/scripts/plot-pr-merged.sh'

# A COMMAND INVOCATION, not a mention. `gh`/`bb` must sit where a command
# starts: at the start of a line, or after `|`, `;`, `&`, `(`, `{`, `!`, or a
# `$(`/backtick opening a substitution. `&&` and `||` are covered by the bare
# `&` and `|` in that set.
#
# That is what excludes `inspect: gh pr view` inside a report string and every
# prose mention, without excluding a real call. `{` is in the set because a
# one-line function body — `open_prs() { bb pr list --json; }` — is a shape this
# repo writes and an earlier version of this pattern missed.
PATTERN='(^|[|;&({]|\$\(|`|[[:space:]]!)[[:space:]]*(gh|bb)[[:space:]]+[a-z]'

violations=""
checked=0

while IFS= read -r hit; do
  [ -n "$hit" ] || continue
  file=${hit%%:*}
  rest=${hit#*:}
  line=${rest%%:*}
  body=${rest#*:}

  # A comment ABOUT a host call is not a call. Strip the shell comment form.
  case "$(printf '%s' "$body" | sed 's/^[[:space:]]*//')" in
    '#'*) continue ;;
  esac

  # An exempted file, by exact path.
  skip=0
  while IFS= read -r allowed; do
    [ -n "$allowed" ] || continue
    [ "$file" = "$allowed" ] && { skip=1; break; }
  done <<EOF
$ALLOWED
EOF
  [ "$skip" = 1 ] && { checked=$((checked + 1)); continue; }

  violations="${violations}${file}:${line}: ${body}
"
done <<EOF
$(grep -rEn --include='*.sh' "$PATTERN" $ROOTS 2>/dev/null \
  | grep -v '/scripts/board/' \
  | grep -vE '(^|/)(test|tests|__tests__)/')
EOF

echo "host CLI call sites in exempted scripts: $checked"

if [ -n "$violations" ]; then
  echo "::error::a script outside plot-host.sh calls the host CLI directly."
  echo
  echo "\`plot-host.sh\` is the ONE place that talks to \`gh\`/\`bb\`. A second"
  echo "caller asks about ONE host: measured 2026-09-05, four such scripts each"
  echo "answered about GitHub and nothing else, so a Bitbucket checkout got a"
  echo "helper that was absent rather than wrong."
  echo
  echo "Ask through the adapter instead:"
  echo "  plot-host.sh pr-state <number|branch>   one PR's state"
  echo "  plot-host.sh pr-merged <branch>         did any PR for it merge"
  echo "  plot-host.sh pr-list [--state S] [--repo R]   the repo's PRs"
  echo "  plot-host.sh issue-list | issue-view | pr-body | pr-create | pr-merge"
  echo
  echo "If this genuinely asks a DIFFERENT question — the Projects API, or"
  echo "whether a CLI is installed at all — exempt the file by name in"
  echo "scripts/check-host-cli-callers.sh and say there why it is not routing."
  echo
  echo "Direct host CLI calls:"
  printf '%s' "$violations"
  exit 1
fi

echo "Host CLI callers: clean."
