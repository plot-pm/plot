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
#   Plan template | Worker prompt template | Main branch | Board command
#   Worktree root       the desk root; see its entry under the agent keys below.
#   Worker bound        seconds a single prompt run may take in the worker loop
#                       before it is ended and the worker exits (no hop). Read by
#                       plot-worker-loop.sh; default 3600 (~1h), `0` disables it.
#                       Non-numeric or empty falls back to the default. It bounds
#                       a HUNG agent — one whose CLI crashed without exiting — so
#                       one dead worker cannot hold a slot for hours.
#   Temp sweep after    hours before `plot-reap.sh --sweep-temp` removes an
#                       owned `$TMPDIR/plot-*` entry or a dead pid's budget
#                       memo that a SIGKILL left behind. Default 24; a value
#                       that is not a whole number is refused by the sweep.
#   Agent registry     the directory the dispatcher writes agent manifests to,
#                       read by the board's registry. Default `.plot/agents`
#                       (repo-relative, gitignored, hence per-worktree). A board
#                       served from a worktree the dispatcher never wrote to
#                       reads an empty directory and synthesizes the whole fleet
#                       with no session ids; point this at a shared location so
#                       the board finds the registry wherever it was started.
#                       Absent = the default, so a single-checkout project is
#                       unaffected.
#   Board artifact      the board-server.mjs this repository runs, read by
#                       plot-board-probe.sh. Declared, it is resolved FIRST and
#                       reported as `artifact_source: checkout`; absent, the
#                       order stays plugin, npm, checkout — the adopting
#                       project's case, unchanged. It exists because a
#                       repository that BUILDS the artifact must run the one it
#                       built: without it `pnpm build:board` writes a file the
#                       board never reads whenever a plugin is installed, and
#                       the symptom looks like the fix not working.
#                       A relative value resolves against the MAIN CHECKOUT (the
#                       parent of `--git-common-dir`), never `--show-toplevel`,
#                       so a dispatch desk resolves the same file rather than
#                       its own copy; an absolute one is taken as given.
#                       A declared file that is missing reports `none` and does
#                       NOT fall back to the plugin — the key names which
#                       artifact runs, so a silent substitution is the wrong
#                       answer it removes. Absent = today's order.
#   Agent settings      a JSON settings file every `claude -p` the fleet starts
#                       is given, through `--settings`. It names the plugins this
#                       project's agents start WITHOUT. Every dispatched agent
#                       inherits every `SessionStart` hook the operator's plugins
#                       declare, and the fleet starts a session on every worker
#                       start, restart, retry and hop plus every agent-runner
#                       command the board runs: measured 2026-09-30, one plugin's
#                       lockless sync ran three times at once, the 1-minute load
#                       reached 195, and the supervisor did not tick for 12
#                       minutes.
#                       Resolved by `plot-agent-settings.sh`, which prints an
#                       absolute path (exit 0), nothing for an absent or empty key
#                       (exit 0), or nothing with the reason on stderr (exit 3)
#                       for a missing, unparseable or gate-disabling file. A
#                       relative value resolves against the MAIN CHECKOUT (the
#                       parent of `--git-common-dir`), never `--show-toplevel`,
#                       for `Board artifact`'s reason: a desk must resolve the
#                       same file, and one cut from an older main may not hold it.
#                       The path travels to every consumer as
#                       `PLOT_AGENT_SETTINGS`, and each command key interpolates
#                       `${PLOT_AGENT_SETTINGS:+--settings "$PLOT_AGENT_SETTINGS"}`
#                       itself — Plot rewrites no configured command.
#                       A file setting any `plot@…` plugin false, `disableAllHooks`
#                       true, or ANY `env` key is REFUSED: those switch Plot's own
#                       four gates off, and a settings `PATH` hiding the gates'
#                       tools makes them fail open. It is a check against an
#                       accidental switch-off, not a boundary — the file is
#                       project-owned and reviewed like this one.
#                       Absent or empty = no change, so an adopting project that
#                       sets nothing behaves exactly as today.
#   Worktree root       the desk root: where /plot-dispatch creates fleet
#                       worktrees and the board writes its action records. A
#                       relative value resolves against the MAIN checkout, an
#                       absolute one is taken as given. Absent or empty =
#                       `<repo>/.worktrees`. The rule is `deskRoot`, asked through
#                       `plot-desk-root.sh`; no script resolves it itself. Desks
#                       carry no prefix; `plot-wt-*` desks an older dispatch made
#                       beside the repo stay there. Every "which worktree holds
#                       this branch" read asks `git worktree list` instead.
# Agent-runner keys (optional; Plot hardcodes no agent tooling, Principle 5):
#   Worker command      how /plot-dispatch runs an agent headless on a worktree.
#                       /plot-init writes `PLOT_UNATTENDED=1 plot-worker-loop.sh`;
#                       the bare name resolves to the loop beside
#                       plot-dispatch.sh, which puts its own directory first on
#                       PATH. A free agent (`--start`) refuses a command that
#                       does not run the loop, because only the loop waits for a
#                       slice. Absent = not set up: nothing starts, and
#                       /plot-dispatch offers to write the loop. `none` = asked,
#                       and this repo starts workers by hand — a DELIBERATE
#                       absence, never run as a command.
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
#   Interrogate command how the board runs `/plot-panel <plan path>` on a Draft
#                       plan (the card's `Interrogate` button); the prompt is
#                       appended as one argument and names a FILE the board
#                       wrote. REQUIRED for the same reason as `Idea command`:
#                       a panel fans out N agents reading a plan, and no script
#                       can do that. Absent (or `none`) = the button renders
#                       disabled and names this key as the fix.
#   Brief command       how /plot-dispatch runs an agent headless to WRITE a
#                       missing hand-off brief. The prompt is appended as one
#                       argument and asks for `/plot-implement <slug>`, whose
#                       step 4 owns brief authorship — this key adds no second
#                       brief writer. Absent (or `none`) = the capability is
#                       unavailable, never an error: the brief gate refuses as
#                       it does today and names `no-brief-command` as the
#                       reason, so a project that has never set the key behaves
#                       exactly as before.
# Plot 2 posture keys (repo-declared ceremony bounds; all optional):
#   Plan PRs            required | never | optional   (never = hard gate)
#   Implementation home this repo | <repo/path list> | none
#   Hosts plans         yes | no                      (no = refuse plan files)
#   Tracker             plot | jira | github-issues | linear  (+ URL)
#                       (plot = plans in this repo ARE the tracker; absent = same)
#   Tracker delivered status
#                       the status word a plan's issues are set to when the plan
#                       reaches Delivered, in the tracker's own vocabulary
#                       (`In Review`, `Done`). Read by plot-issue-status.sh.
#                       Absent or empty = Delivered writes nothing — never an
#                       empty status, and never the released word instead.
#   Tracker released status
#                       the same for Released. A team whose *Done* means
#                       *shipped* sets only this one; a team watching progress
#                       sets both.
#   Ticket prefixes     the tracker project keys this repository's work lives
#                       in, comma-separated (`PROJ-A, PROJ-B`). NOT
#                       `Branch prefixes`, which sits next to it and holds
#                       `idea/`, `feature/`, `bug/` — that key is structural and
#                       names git branches; this one names tracker projects.
#                       Read by plot-host.sh's `issue-list` to scope the inbox:
#                       the default JQL scopes by person and state, so on a
#                       shared instance it is instance-wide and returns other
#                       customers' tickets. A LIST, because a repository mapping
#                       to several projects is the normal case; adoption seeds
#                       ONE prefix and a person adds the rest. Absent = today's
#                       unscoped query, byte for byte — a default that filtered
#                       on an undeclared key would empty every existing board's
#                       inbox on upgrade. `PLOT_JIRA_JQL` overrides both.
#                       NEVER WRITTEN EMPTY: an empty list reads as *this
#                       repository has no projects* and changes nothing about
#                       the query, so adoption omits the key instead.
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
#
# `Worker prompt template` is the same shape for the worker prompt
# plot-install-prompt.sh writes into `.plot/worker-prompt.sh` at adoption: a
# repo-root-relative path (an absolute one is taken as given), falling back to
# the shipped `skills/plot/templates/worker-prompt.sh`. It names a STARTING
# POINT, never the file the loop runs — the loop always sources
# `.plot/worker-prompt.sh`, and nothing re-reads the template after adoption.

set -uo pipefail

cmd="${1:?Usage: plot-config.sh get <key> [default]}"
key="${2:?Usage: plot-config.sh get <key> [default]}"
default="${3:-}"

if [ "$cmd" != "get" ]; then
  echo "plot-config: unknown subcommand '$cmd' (only 'get' is supported)" >&2
  exit 1
fi

# THE CALLER'S ROOT IS TAKEN WHERE IT OFFERS ONE. `git rev-parse` is ~5 ms and
# this script runs once per config key, so a caller reading several keys pays
# for the same constant repeatedly. Measured on CI 2026-09-25: one board build
# spawned `git rev-parse --show-toplevel` 21 times out of 42 git processes
# total, which `plan-read-shape.test.mjs` caught as the spawn count crossing
# its bound. The board already exports `PLOT_REPO_ROOT` (`index.ts:65`) and
# `plot-deliver.sh` and `plot-issue-status.sh` already read it.
#
# IT MUST BE A DIRECTORY, and a wrong one falls back rather than failing: an
# exported stale path would otherwise make every config read answer from a
# repository that is not this one, silently. Asking git is the safe answer and
# stays the default for every caller that offers nothing.
if [ -n "${PLOT_REPO_ROOT:-}" ] && [ -d "$PLOT_REPO_ROOT" ]; then
  root="$PLOT_REPO_ROOT"
else
  root=$(git rev-parse --show-toplevel 2>/dev/null) || root="."
fi

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
