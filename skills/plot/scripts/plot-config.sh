#!/usr/bin/env bash
# Plot helper: read a key from the adopting project's `## Plot Config`.
# Usage: plot-config.sh get <key> [default]
# Output: the configured value, or the default (possibly empty). Exit 0 always
#         for `get` — missing file, missing section, and missing key all fall
#         back to the default so callers can rely on the output unconditionally.
# Designed for small-model consumption: one value on stdout, no interpretation.
#
# This is the ONE place that knows where plot configuration lives (a
# `## Plot Config` section in the repo-root CLAUDE.md or AGENTS.md).
# CLAUDE.md is checked first for backwards compatibility; AGENTS.md is the
# fallback for repos that have migrated to a hub-and-spoke agent-rules layout.
# Helpers must call this instead of grepping either file themselves, so the
# storage location/format can evolve without touching every consumer.
#
# Grammar accepted inside the section (case-insensitive key, bold optional):
#     - **Plan directory:** docs/plans/
#     - Plan directory: docs/plans/
#     - **Plan directory:** `docs/plans/` (with a backticked value + prose note)
#     - **Branch prefixes:** `idea/` (plans), `feature/`, `bug/`   (list + prose)
# Backticks (markdown decoration) and `(...)` (human prose) are stripped from
# the value; no documented key's value legitimately contains either. Lines
# outside the `## Plot Config` section never match (no prose false positives),
# and neither do HTML-commented example lines.
#
# Known keys (see the plot skill's Setup section):
#   Project board | Branch prefixes | Plan directory | Active index |
#   Delivered index | Sprint directory | Story directory | Story index |
#   Plan template | Main branch | Board command
#   Worker bound        seconds a single prompt run may take in the worker loop
#                       before it is ended and the worker exits (no hop). Read by
#                       plot-worker-loop.sh; default 3600 (~1h), `0` disables it.
#                       Non-numeric or empty falls back to the default. It bounds
#                       a HUNG agent — one whose CLI crashed without exiting — so
#                       one dead worker cannot hold a slot for hours.
#   Agent registry      the directory the dispatcher writes agent manifests to,
#                       read by the board's registry. Default `.plot/agents`
#                       (repo-relative, gitignored, hence per-worktree). A board
#                       served from a worktree the dispatcher never wrote to
#                       reads an empty directory and synthesizes the whole fleet
#                       with no session ids; point this at a shared location so
#                       the board finds the registry wherever it was started.
#                       Absent = the default, so a single-checkout project is
#                       unaffected.
#   Worktree root       where /plot-dispatch creates fleet worktrees. A relative
#                       value resolves against the repo root, an absolute one is
#                       taken as given. Absent = the default `repo_root/..` with
#                       the `plot-wt-` prefix — today's behaviour, so no existing
#                       checkout moves. Under a dedicated root the prefix is
#                       dropped: the directory already says these are Plot's. Read
#                       only by the CREATION path; every "which worktree holds this
#                       branch" read asks `git worktree list` instead.
# Agent-runner keys (optional; Plot hardcodes no agent tooling, Principle 5):
#   Worker command      how /plot-dispatch runs an agent headless on a worktree.
#                       `none` = asked, and this repo starts workers by hand —
#                       a DELIBERATE absence, distinct from a missing key so
#                       /plot-dispatch stops asking at every fan-out. Never run
#                       as a command. Absent = nobody has been asked yet, and
#                       the first dispatch asks (never /plot-init: at adoption
#                       the question meets a need the answerer does not have,
#                       gets a shrug, and an answered-and-wrong key is harder
#                       to fix than a missing one).
#   Approve command     how the board runs `/plot-approve <slug>`; the prompt is
#                       appended as one argument. Absent = the board's Approve
#                       button renders disabled, naming this key as the fix.
#   Idea command        how the board runs `/plot-idea` on a tracker issue; the
#                       prompt is appended as one argument, and it names a FILE
#                       the board wrote (an issue body is free text from anyone
#                       who can file an issue, so no part of it is ever a shell
#                       word). REQUIRED for the issue row's `Create plan`
#                       action, unlike `Approve command`: approving has a
#                       script to fall back to, and creating a plan does not —
#                       every step of /plot-idea is judgement, and no script
#                       here can invoke a skill. Absent (or `none`) = the button
#                       refuses and names this key as the fix, rather than
#                       accepting the click and doing nothing.
# Plot 2 posture keys (repo-declared ceremony bounds; all optional):
#   Plan PRs            required | never | optional   (never = hard gate)
#   Implementation home this repo | <repo/path list> | none
#   Hosts plans         yes | no                      (no = refuse plan files)
#   Tracker             plot | jira | github-issues | linear  (+ URL)
#                       (plot = plans in this repo ARE the tracker; absent = same)
#   Git host            github | bitbucket            (resolves gh vs bb)
#   CI                  jenkins | github-actions | none — which CI system this
#                       project uses. Recorded by /plot-board-setup; not yet
#                       read by the board.
#   Jenkins instance    the slug or URL passed to a Jenkins CLI's -I flag.
#                       Read back by /plot-board-setup to verify auth against
#                       the right instance — without it the only runnable
#                       check verifies nothing.
#
# `Plan template` is a repo-root-relative path to the plan template /plot-idea
# instantiates; when absent, /plot-idea falls back to the shipped template.

set -uo pipefail

cmd="${1:?Usage: plot-config.sh get <key> [default]}"
key="${2:?Usage: plot-config.sh get <key> [default]}"
default="${3:-}"

if [ "$cmd" != "get" ]; then
  echo "plot-config: unknown subcommand '$cmd' (only 'get' is supported)" >&2
  exit 1
fi

root=$(git rev-parse --show-toplevel 2>/dev/null) || root="."

# Find the first repo-root file that contains a ## Plot Config section.
# CLAUDE.md wins for backwards compatibility; AGENTS.md is the modern fallback.
config_file=""
for _candidate in "$root/CLAUDE.md" "$root/AGENTS.md"; do
  if [ -f "$_candidate" ] && grep -qi "^##[[:space:]]*plot config" "$_candidate" 2>/dev/null; then
    config_file="$_candidate"
    break
  fi
done

value=""
if [ -n "$config_file" ]; then
  # Extract the `## Plot Config` section (case-insensitive, portable awk).
  section=$(awk '
    /^##[[:space:]]/ { in_section = (tolower($0) ~ /^##[[:space:]]+plot config[[:space:]]*$/) ; next }
    in_section { print }
  ' "$config_file")
  # Value extraction. A documented key's value is a path, a prefix list, or an
  # owner/number — none of which legitimately contain backticks or parentheses.
  # So we can uniformly treat backticks as markdown decoration and `(...)` as
  # human prose, stripping both. This tolerates real-world config written like
  #     - **Plan directory:** `docs/plans/` (date-prefixed, never moved)
  #     - **Branch prefixes:** `idea/` (plans), `feature/`, `bug/`, `docs/`
  # without truncating multi-value lists to their first backtick span.
  value=$(printf '%s\n' "$section" \
    | grep -m1 -iE "^[[:space:]]*[-*]?[[:space:]]*\**${key}[:*]" \
    | sed -E '
        s/^[^:]*:[[:space:]]*//;               # drop list marker, bold, "key:"
        s/^\**[[:space:]]*//;                   # drop leading bold before value
        s/\([^)]*\)//g;                         # drop parenthetical prose
        s/`//g;                                 # drop markdown backticks
        s/[[:space:]]*,[[:space:]]*/, /g;       # normalize list separators
        s/[[:space:]]+/ /g;                     # collapse internal whitespace
        s/^[[:space:]]+//; s/[[:space:]]+$//')  # trim ends
fi

if [ -n "$value" ]; then
  printf '%s\n' "$value"
else
  printf '%s\n' "$default"
fi
