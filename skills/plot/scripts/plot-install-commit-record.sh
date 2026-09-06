#!/usr/bin/env bash
# Plot helper: install the `post-commit` record hook, or report what is there.
# Usage: plot-install-commit-record.sh [--check]
# Output: one line naming what happened; the outcome word is the exit status.
#
#   written    no post-commit hook existed and ours was installed   (exit 0)
#   current    our hook is installed and calls the record script    (exit 0)
#   present    a post-commit hook exists and is somebody else's     (exit 3)
#
# `--check` writes nothing and reports the same words, so /plot-init can ask
# before it acts.
#
# INSTALLING IS A DECISION THE REPO MAKES, NOT A SIDE EFFECT OF CLONING. A git
# hook is a change to every contributor's machine and git deliberately does not
# ship hooks on clone. So this is never run by default: /plot-init offers it
# only where the probe found the signal, and the operator answers.
#
# NOTHING IS EVER OVERWRITTEN. An existing `post-commit` belongs to whoever
# wrote it — a repository may already run one for its own reasons, and this
# script cannot tell an important one from an abandoned one. It reports
# `present` and names the file; the caller offers the one line to add.
#
# The hook is a two-line shim that calls the script from the checkout, so an
# updated Plot takes effect without reinstalling — the installed file carries
# no logic of its own.

set -uo pipefail

check_only=0
[ "${1:-}" = "--check" ] && check_only=1

script_dir=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
recorder="$script_dir/plot-commit-record.sh"

root=$(git rev-parse --show-toplevel 2>/dev/null) || {
  echo "plot-install-commit-record: not a git repository" >&2
  exit 1
}

# Hooks live in the COMMON git dir: a worktree shares them with the checkout it
# was cut from, so installing once covers every dispatch desk.
common=$(git rev-parse --git-common-dir 2>/dev/null) || common="$root/.git"
case "$common" in /*) ;; *) common="$root/$common" ;; esac

# `core.hooksPath` overrides the default location, and a repository that sets
# it runs nothing from `.git/hooks`. Honour it rather than writing a file git
# will never execute.
configured_path=$(git config --get core.hooksPath 2>/dev/null) || configured_path=''
if [ -n "$configured_path" ]; then
  case "$configured_path" in /*) hooks_dir="$configured_path" ;; *) hooks_dir="$root/$configured_path" ;; esac
else
  hooks_dir="$common/hooks"
fi

target="$hooks_dir/post-commit"

if [ ! -f "$recorder" ]; then
  echo "plot-install-commit-record: no recorder at $recorder" >&2
  exit 1
fi

if [ -f "$target" ]; then
  if grep -q 'plot-commit-record.sh' "$target" 2>/dev/null; then
    echo "current — $target calls plot-commit-record.sh"
    exit 0
  fi
  echo "present — $target exists and is not Plot's; add this line to it, and keep the rest:" >&2
  echo "  \"\$(git rev-parse --show-toplevel)\"/skills/plot/scripts/plot-commit-record.sh || true" >&2
  exit 3
fi

if [ "$check_only" = 1 ]; then
  echo "absent — $target would be written"
  exit 3
fi

mkdir -p "$hooks_dir" 2>/dev/null || exit 1

# The shim resolves the recorder through the checkout rather than baking an
# absolute path: a moved clone keeps working, and `|| true` keeps a missing or
# failing recorder from ever touching the commit's exit status.
cat > "$target" <<'HOOK'
#!/usr/bin/env bash
# Plot's commit record — see skills/plot/scripts/plot-commit-record.sh.
# Post-commit and `|| true`: it observes, and can never affect a commit.
root=$(git rev-parse --show-toplevel 2>/dev/null) || exit 0
[ -x "$root/skills/plot/scripts/plot-commit-record.sh" ] || exit 0
"$root/skills/plot/scripts/plot-commit-record.sh" || true
HOOK

chmod +x "$target" 2>/dev/null

echo "written — $target"
exit 0
