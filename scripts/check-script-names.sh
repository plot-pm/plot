#!/usr/bin/env bash
# THE GATE THAT COUNTS NAMES, WHERE THE SPAWN RATCHET COUNTS SYSCALLS.
#
# `ci.yml`'s *One place reaches a process* walks a count of `spawn`/`execFile`
# sites down toward zero, and *One place reaches a script* refuses a `plot-*.sh`
# handed straight to one. Both watch the CALL. This watches the DEPENDENCY, and
# the difference is not academic:
#
#   registry.ts:318   const WORKER_STATE_SCRIPT = 'plot-worker-state.sh';
#   registry.ts:855   scriptsShell(...).sourced(WORKER_STATE_SCRIPT, program, worktrees)
#
# The syscall names `sh`. The dependency is a Plot script. One spawn line can
# carry any number of scripts, so the syscall count can FALL while the number of
# boundary crossings rises — and it did. Measured 2026-09-07: 19 spawn sites
# against `allowed=28`, a ratchet reading healthy, over seven files each naming
# a script the board has no business knowing.
#
# WHAT A NAME COSTS is that the controller holds the knowledge. A port exists so
# a caller can ask a question without knowing what answers it; a controller that
# spells `plot-fleet-scan.sh` has learned the answer's filename, and the next
# reader learns it from the controller. Two of the nine sites below duplicate an
# adapter that already exists — `refs-git.ts:135` reaches `plot-fleet-scan.sh`
# and `processes-shell.ts:79` reaches `plot-worker-state.sh`, both behind ports
# the board could call instead.
#
# THE FILE THIS GATE WAS WRITTEN FROM. `supervisor-reading.ts` shells to
# `plot-fleetctl.sh` from the board server. It was written on 2026-09-07, hours
# after its own plan quoted *"scripts can only be called from an adapter
# implementation"*, by an author who had just read the rule. The rule was known,
# recent and quoted, and the violation shipped anyway — which is the argument
# for a gate rather than for more care.
#
# A RATCHET, NOT A REFUSAL. Nine sites cannot move in one branch: seven of them
# are lifecycle commands no port answers yet, and inventing seven ports to clear
# a gate is the gate driving the design. `ALLOWED` may only fall, and lowering
# it costs a visible line in a diff — which is the decision, made where a
# reviewer sees it.
#
# ---------------------------------------------------------------------------
# WHAT IT MATCHES, AND WHY THAT SHAPE
# ---------------------------------------------------------------------------
#
# A string that is EXACTLY a script name, quote to quote: `'plot-deliver.sh'`.
# Not a name inside a sentence.
#
# THAT SINGLE RULE SEPARATES A DEPENDENCY FROM PROSE, and it has to, because in
# TypeScript both are string literals. Measured on this tree, four sites name a
# script inside advice a person reads:
#
#   workflows/supervise.ts:203   "...restart it with `plot-dispatch.sh --restart`..."
#   rules/supervisor-reading.ts:208  "The board could not ask `plot-fleetctl.sh --status`..."
#
# Those are the same case `check-host-cli-callers.sh` excludes when
# `plot-reconcile-scan.sh` prints `inspect: gh pr view` — a suggestion to an
# operator, not a dependency this code has. A gate flagging them would push the
# explanations out and leave the constants it exists to catch. So the boundary
# is the quote: a whole literal is something the code intends to USE, and a name
# inside a sentence is something it intends to SAY.
#
# COMMENTS ARE STRIPPED FIRST, on the precedent of *The domain names no vendor*.
# 44 KB of this tree's `plot-*.sh` mentions are TSDoc, nearly all of them
# arguments FOR the boundary — `contract/schema.ts` explains eleven times why
# `plot-plan-meta.sh` is the one parser. Matching those would delete the
# explanations to satisfy the gate.
#
# `adapters/` IS EXCLUDED, and that exclusion IS the layer boundary made
# mechanical rather than a hole. An adapter's whole job is to name the script it
# wraps. What the gate asserts is that every module doing so lives in one place.

set -uo pipefail

# The tree to check. Defaults to this script's repo, which is what CI runs. An
# explicit root exists so the gate can be pointed at a fixture and its own
# refusal proven — a gate nothing tests is a gate that passes because nobody
# looked. See test/reconcile/script-name-gate.test.mjs.
cd "${1:-$(dirname "${BASH_SOURCE[0]}")/..}" || exit 2

# The measured count on 2026-09-07: nine sites across seven files. It may only
# fall. A LITERAL ON PURPOSE — deriving it from the estate would make the gate
# agree with whatever it found, which is a check you can answer "yes" to without
# doing the work.
ALLOWED=9

ROOTS='packages/board/src packages/domain/src'

# A whole string literal, in any of TypeScript's three quotes.
PATTERN="'plot-[a-z0-9-]+\.sh'|\"plot-[a-z0-9-]+\.sh\"|\`plot-[a-z0-9-]+\.sh\`"

# ---------------------------------------------------------------------------
# THE PORT THAT ALREADY ANSWERS EACH SCRIPT
# ---------------------------------------------------------------------------
#
# A gate that says only *you crossed a line* leaves the reader to find the seam.
# Each entry is `script<TAB>the sentence the error prints`.
#
# TWO OF THESE NAME A PORT THAT ANSWERS TODAY, and both were verified by reading
# the adapter rather than by reasoning about the name. The other seven say so
# plainly instead of inventing a port — the migration is `the-agent-gets-a-
# repository`'s work, and a gate that names a seam which does not exist sends
# the reader somewhere they cannot go.
ANSWERS=$(cat <<'MAP'
plot-worker-state.sh	the `processes` port answers this — `workerState(worktree, hasPr)`, implemented at adapters/processes/processes-shell.ts:79 over this same script.
plot-fleet-scan.sh	the `refs` port answers this — `pulse()`, implemented at adapters/refs/refs-git.ts:135 over this same script.
plot-fleetctl.sh	no port answers this yet. It reads whether a supervisor is loaded; that is a `machine` question and the port has no op for it.
plot-dispatch.sh	no port answers this yet. Starting an agent is the `performer` port's shape (`startFreeAgent`), and fanning a slice out is the op it lacks.
plot-approve.sh	no port answers this yet. Approving is a plan lifecycle write and `plan-store` reads only.
plot-deliver.sh	no port answers this yet. Delivering is a plan lifecycle write and `plan-store` reads only.
plot-reap.sh	no port answers this yet. Removing a desk is a `trees` write beside `add` and `prune`.
plot-release-refs.sh	no port answers this yet. Deleting a remote ref is a `refs` write, and `refs` carries none.
plot-resolve-artifact.sh	no port answers this yet. It merges, rebuilds and pushes — the widest of these, and the least like an existing port's question.
MAP
)

answer_for() {
  local script="$1" line
  while IFS= read -r line; do
    [ -n "$line" ] || continue
    case "$line" in
      "$script	"*) printf '%s' "${line#*	}"; return ;;
    esac
  done <<EOF
$ANSWERS
EOF
  printf '%s' "no port answers this yet — say in the PR which concept owns it."
}

# `-a` FORCES EVERY FILE TO BE READ AS TEXT, AND IT IS NOT A FLAG FOR TIDINESS.
# `entities/finding.ts:112` holds a literal NUL byte — a deliberate key
# separator in `findingKey` — so grep classifies the file as binary and prints
# `Binary file ... matches` INSTEAD OF THE LINE. Measured while writing this
# gate: that one line counted as a tenth site, named no line number, and hid the
# file's actual content, which is a TSDoc mention this gate must not flag. A
# gate that both miscounts and cannot show what it counted is worse than none,
# and any file gaining a NUL would silently become a place to hide a violation.
hits=$(grep -raEn --include='*.ts' "$PATTERN" $ROOTS 2>/dev/null \
       | grep -v '/adapters/' \
       | grep -vE ':[0-9]+:[[:space:]]*(\*|//|/\*)' \
       || true)

count=$(printf '%s' "$hits" | grep -c . || true)

echo "plot-*.sh names outside adapters/: $count (allowed $ALLOWED, target 0)"

if [ "$count" -gt "$ALLOWED" ]; then
  echo "::error::a script is named outside an adapter — $count sites, allowed $ALLOWED."
  echo
  echo "A port exists so a caller can ask a question without knowing what"
  echo "answers it. Naming a \`plot-*.sh\` outside \`adapters/\` puts that"
  echo "knowledge in a controller, where the spawn ratchet cannot see it: one"
  echo "\`spawn\` line carries any number of scripts."
  echo
  echo "The sites, and the port for each:"
  echo
  while IFS= read -r hit; do
    [ -n "$hit" ] || continue
    script=$(printf '%s' "$hit" | grep -oE 'plot-[a-z0-9-]+\.sh' | head -1)
    printf '  %s\n' "$hit"
    printf '      %s\n\n' "$(answer_for "$script")"
  done <<EOF
$hits
EOF
  echo "If this genuinely names a script in ADVICE a person reads rather than a"
  echo "dependency this code has, put the name inside the sentence rather than"
  echo "alone in a literal — that is the distinction this gate draws."
  exit 1
fi

if [ "$count" -lt "$ALLOWED" ]; then
  echo "::notice::the ratchet can tighten — $count sites, allowed still $ALLOWED."
fi

echo "A script is named in an adapter: clean."
