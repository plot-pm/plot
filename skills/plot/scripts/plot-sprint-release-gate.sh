#!/usr/bin/env bash
# The sprint-owner gate in front of a Jira Release comparison: collect the
# facts, ask the domain for its verdict, print what it said.
#
#   plot-sprint-release-gate.sh
#
# THE SPRINT-OWNER DECLINE IS A REFUSAL HERE, NOT A SENTENCE A SKILL PRINTS.
# `sprintOwner()` had zero callers before this bundle: the decline existed as
# prose in `plot-sprint/SKILL.md` and `plot-release/SKILL.md`, which a reader —
# or a future edit — could skip past. An externally-owned sprint exits 3 and
# nothing past it runs.
#
# NO TRACKER, OR A NON-JIRA ONE, IS NOT A REFUSAL. A repository naming no
# tracker, or a GitHub-issues one, answers `sprints: []` with no entries —
# nothing is being checked, because there is nothing to compare.
#
# Exit 0 the gate ran (checked or not, per sprint), 2 the facts were
# unreadable, 3 an external tracker owns this repository's sprints.
set -uo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
bundle="$script_dir/board/plot-sprint-release-gate.mjs"

# THE BUNDLES ARE TRACKED IN GIT, so this fires on a broken installation and
# never on a normal run — which is where naming the build command is right.
[ -f "$bundle" ] \
  || { echo "plot-sprint-release-gate: cannot find $bundle — run 'pnpm build:board'." >&2; exit 2; }

# COLLECT, THEN ASK. The collector's JSON travels unchanged: a reshaping step
# between them would be a third place that reads a sprint item, and the two
# that exist are already one more than the rule needs.
facts=$(bash "$script_dir/plot-sprint-release.sh" 2>/dev/null)
if [ -z "$facts" ]; then
  echo "plot-sprint-release-gate: plot-sprint-release.sh reported nothing — the sprint estate could not be read." >&2
  exit 2
fi

# The verdict is JSON on stdout, whole, for a caller that reads each sprint's
# comparison; the bundle also writes a refusal's own sentence to stderr. ONE
# hop, not two: a second `node` to reformat what the first already knows would
# pay 39 ms to move a string.
printf '%s' "$facts" | node "$bundle"
