#!/usr/bin/env bash
# Plot gate: block a commit that ADDS or RENAMES a hand-off brief to a name no
# reader computes — `.plot/briefs/<prefix>-<slug>.md`, where `<prefix>` is a
# configured branch prefix with its `/` removed.
#
# Wired as a Claude Code PreToolUse hook on the Bash tool (see hooks/hooks.json),
# beside plot-phase-gate.sh and plot-state-gate.sh. Reads the hook JSON on
# stdin; acts only on commands containing "git commit". Exit 2 blocks with the
# computed path and the `git mv` that reaches it on stderr; anything else allows.
#
# THE RULE IS brief-path.ts's. A brief lives at `.plot/briefs/<slug>.md`, the
# slug being the branch name after its LAST `/` — `feature/x` gives `x.md`,
# never `feature-x.md`. plot-dispatch.sh's brief_path() holds the same rule and
# test/reconcile/briefpath.test.mjs proves the two agree. Neither reader can
# refuse a misnamed file: by the time one looks, the file is committed and its
# honest answer is "no brief". Measured 2026-08-24 to 2026-09-26: 25 briefs in
# 21 commits were written as `<prefix>-<slug>.md`, and each held its slice on
# `no-brief` while the file sat on origin/main. Only the commit sees both the
# file and its name.
#
# SHAPE, NOT MEMBERSHIP. A brief is written before its branch exists — that is
# the normal case — so the gate cannot ask "is this a branch?". It refuses one
# shape: a direct child of `.plot/briefs/` ending in `.md` whose name starts
# with `<prefix>-` followed by at least one character. `bugfix-x.md` and
# `feature.md` pass. The prefixes come from the `Branch prefixes` config key;
# absent or empty means the default `idea/, feature/, bug/, docs/, infra/`,
# which plot-phase-gate.sh and plot-release-refs.sh already use. An absent key
# never means "no prefixes, refuse nothing".
#
# ADDS AND RENAMES, NEVER MODIFIES. The index is read with
# `git diff --cached --name-status -M`: an add is `A <path>`, a `git mv` is
# `R<score> <old> <new>` and is judged by its destination. A modify of a file
# already carrying a misnamed path passes, so a repository holding legacy
# misnamed briefs can still edit them on the way to repairing them.
#
# THE COMMAND CAN STAGE AFTER THIS HOOK RUNS. `git add x && git commit` is one
# Bash call, and the hook fires before the add. plot-state-gate.sh's
# effective_paths() answers this for modifies; here only an ADD can be
# introduced that way, so the command side reads the untracked files each
# `git add` would stage (`git ls-files --others` over the same pathspec, or the
# whole tree for `-A` / `.` / `--all`) and the destination of each `git mv`.
# A path already in HEAD is a modify and is skipped, the index rule again.
#
# FAIL-OPEN ON ITS OWN MACHINERY, the split both shipped gates make. No `jq`,
# unparseable hook JSON, not a git repository, an unreadable index or config:
# the gate cannot see a name and allows. A misnamed add or rename it CAN read is
# a refusal, because that is the case it exists for.

set -uo pipefail

# --- fail-open guard: any error below → allow ---
trap 'exit 0' ERR

INPUT="$(cat)"
CMD="$(printf '%s' "$INPUT" | jq -r '.tool_input.command // empty' 2>/dev/null)" || exit 0
case "$CMD" in
  *"git commit"*) ;;
  *) exit 0 ;;
esac

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
git rev-parse --show-toplevel >/dev/null 2>&1 || exit 0

BRIEFS_DIR=".plot/briefs"
DEFAULT_PREFIXES="idea/, feature/, bug/, docs/, infra/"

# The configured prefixes, one per line, `/` removed. Read the exit code: a
# config read that fails is the gate's own machinery failing, which allows.
PREFIX_RAW="$(bash "$HERE/plot-config.sh" get "Branch prefixes" "$DEFAULT_PREFIXES" 2>/dev/null)" || exit 0
[ -n "${PREFIX_RAW// /}" ] || PREFIX_RAW="$DEFAULT_PREFIXES"
PREFIXES="$(printf '%s\n' "$PREFIX_RAW" | tr ',' '\n' | tr -d ' \t' | sed 's#/*$##' | grep -v '^$')" || exit 0
[ -n "$PREFIXES" ] || exit 0

# The index, read once. A failed diff exits 0 through `|| exit 0` rather than
# reading as "nothing staged", because the ERR trap does not see a failure
# inside a command substitution that is only assigned.
STAGED="$(git diff --cached --name-status -M 2>/dev/null)" || exit 0

# Where this command runs, relative to the repository root, so a `git mv`
# destination typed from a subdirectory resolves to the path the index uses.
SHOW_PREFIX="$(git rev-parse --show-prefix 2>/dev/null)" || exit 0

# The name a misnamed brief should carry, or nothing when the path is not a
# misnamed brief. Direct children of the briefs directory only.
computed_path() { # $1=repo-relative path → prints the computed path, or nothing
  local path="$1" base stem p
  case "$path" in
    "$BRIEFS_DIR"/*) ;;
    *) return 0 ;;
  esac
  base="${path#"$BRIEFS_DIR"/}"
  case "$base" in
    */*) return 0 ;;
    *.md) ;;
    *) return 0 ;;
  esac
  stem="${base%.md}"
  while IFS= read -r p; do
    [ -n "$p" ] || continue
    case "$stem" in
      "$p"-?*)
        printf '%s/%s.md\n' "$BRIEFS_DIR" "${stem#"$p"-}"
        return 0 ;;
    esac
  done <<<"$PREFIXES"
  return 0
}

# Paths this commit ADDS or RENAMES TO, read from the index.
index_candidates() {
  local status a b
  while IFS=$'\t' read -r status a b; do
    case "$status" in
      A) printf '%s\n' "$a" ;;
      R*) printf '%s\n' "$b" ;;
    esac
  done <<<"$STAGED"
}

# Paths the command itself would add before it commits — the chained case.
# Only new files: a path already in HEAD is a modify.
command_candidates() {
  local segment tok last
  printf '%s\n' "$CMD" | sed -E 's/&&|;|\|/\n/g' | while IFS= read -r segment; do
    case "$segment" in
      *"git add"*)
        for tok in ${segment#*git add}; do
          case "$tok" in
            -A|--all|.) git ls-files --others --exclude-standard --full-name 2>/dev/null ;;
            -*) ;;
            *) git ls-files --others --exclude-standard --full-name -- "$tok" 2>/dev/null ;;
          esac
        done ;;
      *"git mv"*)
        last=""
        for tok in ${segment#*git mv}; do
          case "$tok" in -*) ;; *) last="$tok" ;; esac
        done
        [ -n "$last" ] && printf '%s%s\n' "$SHOW_PREFIX" "${last#./}" ;;
    esac
  done
}

in_head() { git cat-file -e "HEAD:$1" 2>/dev/null; }

blocked=0
while IFS= read -r f; do
  [ -n "$f" ] || continue
  want="$(computed_path "$f")"
  [ -n "$want" ] || continue

  if [ "$blocked" = 0 ]; then
    echo "plot brief-name gate: a brief is named by the rule, and this name is not the one it computes." >&2
    blocked=1
  fi
  echo "" >&2
  echo "  $f" >&2
  echo "    The branch prefix is dropped, not flattened: this brief belongs at $want" >&2
  if git ls-files --error-unmatch -- "$f" >/dev/null 2>&1; then
    echo "    Rename it:  git mv $f $want" >&2
  else
    echo "    Rename it:  mv $f $want" >&2
  fi
  if [ -e "$want" ]; then
    echo "    $want already exists — compare the two before replacing it." >&2
  fi
done < <(
  {
    index_candidates
    command_candidates | while IFS= read -r c; do
      [ -n "$c" ] || continue
      in_head "$c" || printf '%s\n' "$c"
    done
  } | sort -u
)

if [ "$blocked" = 1 ]; then
  echo "" >&2
  echo "Every reader — brief-path.ts and plot-dispatch.sh's brief_path() — takes the branch" >&2
  echo "name after its last '/'. A brief under any other name is present and unread, and the" >&2
  echo "registry holds its slice on no-brief until somebody renames it." >&2
  exit 2
fi

exit 0
