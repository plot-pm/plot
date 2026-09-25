#!/usr/bin/env bash
# THE GATE THAT KEEPS A SHIPPED BUNDLE RESOLVED BESIDE ITS CALLER.
#
# Every bundle under `skills/plot/scripts/board/` ships in the plugin beside
# the script that runs it. The repository a script runs IN is the consumer's,
# and a consumer that installs Plot as a plugin has no `skills/plot/` of its
# own. So a bundle path built from `$repo_root` or `git rev-parse
# --show-toplevel` names a file that exists only in this repository.
#
# Measured 2026-09-24 (#969): 26 sites resolved a bundle from their own
# directory and one, `plot-fleetctl.sh:89`, resolved it from `$repo_root`.
# `/plot-fleet --once` refused in a consumer repository while the bundle sat
# beside the script. Nothing counted the one against the 26, so this gate
# counts it and holds it at zero.
#
# THE CHECK IS AN ALLOWLIST OF ANCHORS, not a blocklist of roots. A line that
# composes `<anchor>/…/board/<name>.mjs` passes only when the anchor is the
# script's own directory: `$script_dir`, `$here`, `$HERE`, or a command
# substitution over `BASH_SOURCE` (`plot-pr-merged.sh` inlines that form). A
# repo root read into a variable of any other name fails, because the gate
# cannot know what a new variable holds.
#
# COMMENTS AND PROSE ARE NOT COMPOSITIONS. A message such as *"is
# board/plot-sprint-score.mjs built?"* carries no `$` anchor and does not
# match; a commented line is skipped.
#
# ---------------------------------------------------------------------------
# THE EXCEPTION
# ---------------------------------------------------------------------------
#
# `plot-board-probe.sh` — REPORTS PROVENANCE, AND A CHECKOUT IS ONE OF ITS
#   ANSWERS. Its last fallback builds `$git_root/skills/plot/scripts/board/
#   board-server.mjs` and reports `artifact_source="checkout"`: in this
#   repository, and in any checkout that vendors the skills, the board artifact
#   IS in the repository. It tries the plugin and npm first, so the checkout
#   path is reached only after both are absent, and naming where the artifact
#   came from is the probe's whole output.

set -uo pipefail

# The tree to check. Defaults to this script's repo, which is what CI runs.
# An explicit root lets a test point the gate at a fixture and prove its own
# refusal. See test/reconcile/bundle-resolution-gate.test.mjs.
cd "${1:-$(dirname "${BASH_SOURCE[0]}")/..}" || exit 2

# Where SHIPPED shell lives — what a consumer runs. `skills/plot/scripts/board/`
# is bundler output. The root `scripts/` is left out: it is this repository's
# own tooling and runs only here, where `$repo_root` and a script's directory
# name one tree. `release-smoke.sh` builds its artifact path from `$ROOT` for
# exactly that reason, and is correct.
ROOTS='skills hooks'

ALLOWED='skills/plot/scripts/plot-board-probe.sh'

# The anchors that mean "this script's own directory".
ANCHORS='script_dir here HERE'

# A composed bundle path: a `$var`/`${var}` anchor, or the `)` closing a
# command substitution, then any path segments, then `board/<name>.mjs`.
SEG='(/[A-Za-z0-9_.-]+)*/board/[A-Za-z0-9_.-]+\.mjs'
VAR_FORM="\\\$\\{?[A-Za-z_][A-Za-z0-9_]*\\}?$SEG"
SUB_FORM="\\)$SEG"

violations=""
checked=0
exempt=0

while IFS= read -r hit; do
  [ -n "$hit" ] || continue
  file=${hit%%:*}
  rest=${hit#*:}
  line=${rest%%:*}
  body=${rest#*:}

  case "$(printf '%s' "$body" | sed 's/^[[:space:]]*//')" in
    '#'*) continue ;;
  esac

  if [ "$file" = "$ALLOWED" ]; then
    exempt=$((exempt + 1))
    continue
  fi

  bad=0
  while IFS= read -r m; do
    [ -n "$m" ] || continue
    anchor=$(printf '%s' "$m" | sed -E 's/^\$\{?([A-Za-z_][A-Za-z0-9_]*).*/\1/')
    ok=0
    for a in $ANCHORS; do [ "$anchor" = "$a" ] && ok=1; done
    [ "$ok" = 1 ] || bad=1
  done <<EOF
$(printf '%s\n' "$body" | grep -oE "$VAR_FORM")
EOF
  if printf '%s\n' "$body" | grep -qE "$SUB_FORM"; then
    case "$body" in
      *BASH_SOURCE*) ;;
      *) bad=1 ;;
    esac
  fi

  if [ "$bad" = 1 ]; then
    violations="${violations}${file}:${line}: ${body}
"
  else
    checked=$((checked + 1))
  fi
done <<EOF
$(grep -rEn --include='*.sh' --exclude-dir=board "($VAR_FORM|$SUB_FORM)" $ROOTS 2>/dev/null \
  | grep -vE '^([^:]*/)?(test|tests|__tests__)/')
EOF

echo "bundle paths resolved beside their script: $checked (exempt by name: $exempt)"

if [ -n "$violations" ]; then
  echo "::error::a shipped bundle is resolved against something other than its script's directory."
  echo
  echo "A bundle under skills/plot/scripts/board/ ships beside the script that"
  echo "runs it. \`\$repo_root\` and \`git rev-parse --show-toplevel\` name the"
  echo "CONSUMER's checkout, which has no skills/plot/ when Plot is a plugin —"
  echo "measured 2026-09-24 (#969), /plot-fleet --once refused there while the"
  echo "bundle sat beside the script."
  echo
  echo "Resolve it from the script's own directory instead:"
  echo "  script_dir=\"\$(cd \"\$(dirname \"\${BASH_SOURCE[0]}\")\" && pwd)\""
  echo "  bundle=\"\$script_dir/board/<name>.mjs\""
  echo
  echo "If the file genuinely reports WHERE an artifact came from, exempt it by"
  echo "name in scripts/check-bundle-resolution.sh and say there why."
  echo
  echo "Bundle paths not resolved beside their script:"
  printf '%s' "$violations"
  exit 1
fi

echo "Bundle resolution: clean."
