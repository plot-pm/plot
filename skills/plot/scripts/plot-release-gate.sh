#!/usr/bin/env bash
# The sprint gate in front of a release: collect the facts, ask the domain for
# its verdict, print what it said.
#
#   plot-release-gate.sh [--candidate] [--ignore-sprint] [--unattended]
#
# THE FACTS WERE ALREADY COLLECTED AND THE JUDGEMENT WAS STILL PROSE.
# `plot-sprint-release.sh` reports every MoSCoW item's state and decides nothing
# — deliberately and correctly. /plot-release then applied the rule in skill
# text: an open Must refuses, a `disputed` blocks like an open one, a
# `withdrawn` is named and never gates. `workflows/release.ts` holds that same
# rule, carries a full test file, and had no importer outside the domain package
# until 2026-09-09. This is the wire.
#
# A REFUSAL IS PRINTED, NOT SWALLOWED. `must-haves-open` names every open item,
# its sprint, and whether it is undelivered or checked-but-not; a caller
# reporting "the sprint refuses" throws away the half a person acts on.
#
# IT DECIDES THE GATE AND NOT THE RELEASE. It tags nothing, writes nothing and
# pushes nothing. A release is the one action nobody can undo, so the operator's
# approval stays required and stays separate — this is the refusal in front of
# it, not a replacement for it.
#
# Exit 0 the sprint permits the cut, 1 it refuses, 2 the facts were unreadable.
set -uo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
bundle="$script_dir/board/plot-release-gate.mjs"

# THE BUNDLES ARE TRACKED IN GIT, so this fires on a broken installation and
# never on a normal run — which is where naming the build command is right.
[ -f "$bundle" ] \
  || { echo "plot-release-gate: cannot find $bundle — run 'pnpm build:board'." >&2; exit 2; }

for arg in "$@"; do
  case "$arg" in
    --candidate|--ignore-sprint|--unattended) ;;
    *) echo "usage: plot-release-gate.sh [--candidate] [--ignore-sprint] [--unattended]" >&2; exit 2 ;;
  esac
done

# COLLECT, THEN ASK. The collector's JSON travels unchanged: a reshaping step
# between them would be a third place that reads a sprint item, and the two that
# exist are already one more than the rule needs.
facts=$(bash "$script_dir/plot-sprint-release.sh" 2>/dev/null)
if [ -z "$facts" ]; then
  echo "plot-release-gate: plot-sprint-release.sh reported nothing — the sprint estate could not be read." >&2
  exit 2
fi

# The verdict is JSON on stdout, whole, for a caller that reads the three tier
# lists; the bundle also writes a refusal's own sentence to stderr, because a
# refusal a person has to extract from a JSON field with `jq` is one they read
# second. ONE hop, not two: a second `node` to reformat what the first already
# knows would pay 39 ms to move a string.
printf '%s' "$facts" | node "$bundle" "$@"
