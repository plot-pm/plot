#!/usr/bin/env bash
# Run the plot-2 eval suites. House pattern: OPENROUTER_API_KEY from env →
# macOS keychain item `openrouter-evals` → /tmp/evalskey. Runs every suite
# even if one fails; aggregates exit status. Results are timestamped JSON
# snapshots in results/ (gitignored); update the committed
# ../promptfoo-results.md scoreboard after meaningful runs.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")"

if [ -z "${OPENROUTER_API_KEY:-}" ]; then
  OPENROUTER_API_KEY="$(security find-generic-password -s openrouter-evals -w 2>/dev/null || true)"
fi
if [ -z "${OPENROUTER_API_KEY:-}" ] && [ -f /tmp/evalskey ]; then
  OPENROUTER_API_KEY="$(cat /tmp/evalskey)"
fi
[ -n "${OPENROUTER_API_KEY:-}" ] || { echo "no OPENROUTER_API_KEY (env, keychain 'openrouter-evals', or /tmp/evalskey)" >&2; exit 1; }
export OPENROUTER_API_KEY

STAMP="$(date +%Y%m%d-%H%M%S)"
status=0
for cfg in promptfooconfig.*.yaml; do
  suite="${cfg#promptfooconfig.}"; suite="${suite%.yaml}"
  echo "── suite: $suite ──"
  npx promptfoo eval -c "$cfg" --output "results/${suite}-${STAMP}.json" --no-cache "$@" || status=1
done
exit $status
