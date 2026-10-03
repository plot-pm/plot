#!/usr/bin/env bash
# Plot gate: block a commit that STAGES a generated board bundle, on any
# branch — the arrival point before a 16-18 minute `validate` run ever sees it.
#
# Wired as a Claude Code PreToolUse hook on the Bash tool (see
# hooks/hooks.json), beside plot-phase-gate.sh, plot-state-gate.sh,
# plot-controller-gate.sh and plot-brief-name-gate.sh. Reads the hook JSON on
# stdin; acts only on commands containing "git commit". Exit 2 blocks with the
# merge-base restore (or `git rm`) on stderr; anything else allows.
#
# THE SET IS DERIVED, NEVER LISTED HERE — the same `shipped[A-Za-z]* =
# path.join(...)` reading `check-bundle-attributes.sh`, `main-bundles.sh` and
# `check-no-bundle-diff.sh` already share, so a fourth list can never name a
# different set. `scripts/check-no-bundle-diff.sh` is CI's backstop for the
# same question; this is the same refusal moved to the point before a commit
# exists at all, which is cheaper than a 16-18 minute `validate` run finding it
# later (measured 2026-10-02).
#
# THE SET IS NEVER THE DIRECTORY. `skills/plot/scripts/board/` holds 36 files;
# 34 are generated and 2 — `README.md` and `plot-monitor.mjs` — are written by
# hand. A gate on the directory would refuse a legitimate change to either.
#
# `bundles.generated.ts` AND `.gitattributes` ARE NEVER REFUSED, for
# `check-no-bundle-diff.sh`'s reason: two branches that each add a bundle still
# conflict there, and reading that conflict is the correct repair.
#
# THE REFUSAL PRINTS THE REPAIR FROM THE MERGE BASE AGAINST origin/main, never
# `HEAD` alone: `HEAD` cannot tell "this branch changed it" from "this branch
# never touched it", and `origin/main` may be unreachable in a scratch
# fixture, which the fail-open guard below already covers.
#
# FAIL-OPEN ON ITS OWN MACHINERY, the split every shipped gate makes. No
# `git`, no merge base, an unreadable build: the gate cannot see a set and
# allows. A staged generated path it CAN read is a refusal, because that is
# the case it exists for.

set -uo pipefail

# --- fail-open guard: any error below → allow ---
trap 'exit 0' ERR

INPUT="$(cat)"
CMD="$(printf '%s' "$INPUT" | jq -r '.tool_input.command // empty' 2>/dev/null)" || exit 0
case "$CMD" in
  *"git commit"*) ;;
  *) exit 0 ;;
esac

git rev-parse --show-toplevel >/dev/null 2>&1 || exit 0
root="$(git rev-parse --show-toplevel 2>/dev/null)" || exit 0

BUILD="$root/packages/board/build.mjs"
GENERATED_SET_TS='packages/board/src/contract/bundles.generated.ts'
ATTRIBUTES='.gitattributes'

[ -f "$BUILD" ] || exit 0

generated="$(grep -aoE "shipped[A-Za-z]* = path\.join\([^)]*'[^']*'\)" "$BUILD" \
  | sed -E "s|.*'\.\./\.\./([^']*)'.*|\1|" | sort -u)" || exit 0
[ -n "$generated" ] || exit 0

# Paths this commit's index holds staged — added or modified. A delete is not
# refused: removing a generated path is never the defect this gate exists for.
STAGED="$(git diff --cached --name-status -M 2>/dev/null)" || exit 0

staged_paths() {
  local status a b
  while IFS=$'\t' read -r status a b; do
    case "$status" in
      A|M) printf '%s\n' "$a" ;;
      R*) printf '%s\n' "$b" ;;
    esac
  done <<<"$STAGED"
}

merge_base="$(git merge-base HEAD origin/main 2>/dev/null)" || merge_base=""

touched=""
while IFS= read -r path; do
  [ -n "$path" ] || continue
  [ "$path" = "$GENERATED_SET_TS" ] && continue
  [ "$path" = "$ATTRIBUTES" ] && continue
  if printf '%s\n' "$generated" | grep -qxF "$path"; then
    touched="${touched}${path}"$'\n'
  fi
done < <(staged_paths)

[ -n "$touched" ] || exit 0

echo "plot bundle-commit gate: this commit stages a generated board bundle. main builds its own bundles after every merge; a branch must not carry one." >&2
echo "" >&2
if [ -n "$merge_base" ]; then
  echo "Restore each from the merge base, and remove one the merge base never had:" >&2
  echo "" >&2
  while IFS= read -r path; do
    [ -n "$path" ] || continue
    if git cat-file -e "$merge_base:$path" 2>/dev/null; then
      echo "    git restore --staged --worktree --source=\"$merge_base\" -- $path" >&2
    else
      echo "    git rm --cached $path" >&2
    fi
  done <<<"$touched"
else
  echo "Unstage each generated path and restore it from the merge base against origin/main:" >&2
  printf '%s' "$touched" | sed 's/^/    /' >&2
fi
echo "" >&2
echo "Staged generated paths:" >&2
printf '%s' "$touched" >&2

exit 2
