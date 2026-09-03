#!/usr/bin/env bash
# The estate sweep. It answers ONE question of everything it looks at — is
# anything here that nobody is coming back for? — and it does not care whether
# the cause was a dead agent, an interrupted dispatch, a `--stop`, or a merge
# somebody did on the host.
#
# FOUR KINDS OF LEFTOVER, and the first is the one this script started as:
#
#   1. worktrees whose work has landed, with their dead worker files, the
#      registry manifests that named them, and the agent logs that described
#      them
#   2. LOCAL BRANCHES the host merged that no worktree holds
#   3. ORPHANED CLAIM REFS a plan already recorded as deferred or moved
#   4. DIRTY TREES NOBODY OWNS — named, never deleted
#
# Kinds 2-4 were added 2026-09-03. Measured on this estate the day before:
# 85 of 98 local branches already merged and nothing looked at them, claim refs
# whose agent never existed, and 2 dirty desks holding 52 and 1 files that
# every run refused and nothing ever resolved.
#
# EVERY KIND KEEPS ONE SHAPE: `--dry-run` by default, acting on `--yes`,
# bounded by `--max N`. The bound is PER KIND, because the kinds are different
# acts on different populations — a run bounded to five worktrees has not
# thereby been asked to leave the 85th branch alone.
#
# THE ASYMMETRY BETWEEN KINDS IS DELIBERATE AND STAYS. A removed checkout comes
# back with `git worktree add` and a local branch is re-fetchable from origin,
# so both are swept estate-wide. A deleted REMOTE ref is not re-creatable at
# all, so `plot-release-refs.sh` deletes those under its own licence, its own
# five guards, and a blast radius bounded by one plan file.
#
# The gap this fills was named by a comment before it existed:
# `plot-reconcile-scan.sh:323` says "with a deferred: annotation the reaper
# would offer to DELETE real work" — describing a reaper that was never
# written. The scan reports; nothing reaped. Measured 2026-08-25 on this
# estate: 56 worktrees, 42 of them dispatch trees, of which 29 were finished.
#
# WHY A SCRIPT RATHER THAN AN AGENT (Manifesto Principle 3, and the licence
# `plot-resolve-artifact.sh` states for the one other automatic write): every
# refusal below is a MEASUREMENT, not a judgement. Is a process alive; is the
# tree dirty; did the host merge the PR. An agent asked "is this safe to
# delete?" can talk itself past any of the three. A script cannot, and
# judgement's absence is exactly what licenses the delete.
#
# AND THE DECIDING IS NOT HERE. This script GATHERS the readings, asks
# `packages/domain/src/rules/reapable.ts`, and ACTS on the answer; it holds no
# `if` about whether a worktree may go. The five refusals are named values the
# rule returns, so each is triggerable against a fixture — including the
# combinations this estate will not produce on demand, a marker and a live pid
# at once and a host that cannot be asked at all. In shell they were five
# `if`s nothing could test.
#
# SO THIS SCRIPT NEEDS NODE, where its first version deliberately did not.
# That constraint is retired rather than quietly broken: the alternative is a
# second implementation of the five refusals, in shell, where nothing can test
# it — and a copy drifting toward permissive fails in the direction that
# deletes work. A rule that cannot be asked REFUSES, so a missing `node` keeps
# every tree and says so per tree rather than skipping them silently.
#
# DEFAULT IS --dry-run. Removal happens only under --yes.
#
#   plot-reap.sh                # report what WOULD be reaped
#   plot-reap.sh --yes          # actually remove them
#   plot-reap.sh --yes --max 5  # bound it
#
# What is NEVER reaped, in the order the tests run:
#   1. a worktree with a LIVE worker process        (a desk someone is at)
#   2. a worktree with uncommitted changes           (work that exists nowhere else)
#   3. a worktree carrying a PLOT-BLOCKED* marker    (a worker waiting on a person)
#   4. a branch NO PR of which merged                (the host is the authority)
#   5. the main checkout, and any non-dispatch tree  (not ours to remove)
#
# THOSE FIVE REFUSALS ARE UNCHANGED BY THE THREE NEW KINDS, in this file and in
# `packages/domain/src/rules/reapable.ts` alike. They were written for exactly
# the population they sweep, and a backstop that guesses is worse than none.
# Each new kind brings its own gate instead, in `rules/sweepable.ts`:
#
#   local branch  the host says merged, AND no worktree holds it. NEVER
#                 `git branch -d`, which refuses a squash-merged branch for the
#                 wrong reason and would have kept all 85 of them.
#   claim ref     only what `plot-reconcile-scan.sh` section 3 ALREADY calls
#                 reapable — a `deferred:`/`moved:` annotation. A bare
#                 `claimed:` is reported and left for a person.
#   dirty tree    nothing. There is no deletion path: where this guard is
#                 wrong, destruction cannot be undone.
#
# A dispatch tree is recognised by `.plot-worker.pid`, which the dispatcher
# writes at creation, OR by the legacy `plot-wt-` path. Both are supported
# permanently. Identifying one by its path ALONE was the defect fixed on
# 2026-08-30: `plot-wt-` is only used when `Worktree root` is absent, so on a
# repo that configures one the reaper matched nothing and reported
# `reapable=0 kept=0` over nine trees.
#
# THE MANIFEST GOES WITH THE WORKTREE. `readAgentRegistry` renders one row per
# manifest, so a reap that removes only the checkout converts a finished agent
# into an `unknown` row naming a directory that no longer exists — measured
# 2026-08-26, twelve worktrees removed and seven such rows appearing at once.
# Nothing further needs deciding to remove it: an entry whose worktree the five
# tests above just cleared is covered by exactly those measurements.
#
# AND THE LOG GOES WITH THE WORKTREE TOO. Measured 2026-08-30: 190 log files,
# 2.6 MB beside the repository, the oldest from 2026-08-17, and NOT ONE
# belonging to live work. This script took the worktree and the manifest every
# time and left the log forever, so a finished agent's last act was to leave a
# file nobody would ever open again.
#
# It is the branch's own `plot-resolve-<branch>` run — log, `.state` and
# `.prompt.md` together, since a sweep that took the log alone would leave half
# a run behind. NOT the per-plan `plot-dispatch-<slug>.log`, which is appended
# to by every dispatch of a plan and outlives any one of its branches.
#
# ORDER: worktree FIRST, manifest second, log LAST. The first two are ordered
# because the reverse leaves a live worktree with no registration, which
# `readAgentRegistry` answers by SYNTHESIZING an `unknown` entry — the same bad
# row, earned a different way. A failure between them this way round leaves an
# orphaned manifest, which the sweep below clears on the next run.
#
# The log is last because it is the only one that is PURE CLEANUP: a missing
# manifest orphans an agent, a missing worktree loses a desk, and a missing log
# costs a record of work the host already merged. So a failure before it has
# cost the least, and its own failure costs nothing.
#
# A MISSING LOG IS NOT A REFUSAL. The five refusals above are about work that
# might be lost; a log describes work that has already landed. `rm -f`
# semantics — if it is not there, that is the desired state.
#
# AND IT IS NOT THE TRANSCRIPT. `<worktree>/.plot-worker.log` is the agent's own
# words and lives INSIDE the tree, so it goes when the tree does and is not
# swept here. This is the dispatcher's record of what it started. Two files,
# two lifetimes, and CLAUDE.md already distinguishes them.
set -u

DRY=1; MAX=0
while [ $# -gt 0 ]; do
  case "$1" in
    --yes) DRY=0 ;;
    --dry-run) DRY=1 ;;
    --max) MAX="${2:-0}"; shift ;;
    # The header, however long it has become. A hardcoded last line silently
    # truncates help mid-sentence the first time the header grows — measured
    # here, when it grew past 42.
    -h|--help) sed -n '2,/^[^#]/p' "$0" | sed '$d' | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "plot-reap: unknown argument: $1" >&2; exit 2 ;;
  esac
  shift
done

command -v git >/dev/null 2>&1 || { echo "plot-reap: git not found" >&2; exit 2; }
ROOT=$(git rev-parse --show-toplevel 2>/dev/null) || {
  echo "plot-reap: not a git repository" >&2; exit 2; }

# The default branch, via the host adapter when it can answer and `main`
# otherwise. A wrong answer here would only ever make the ancestry test MORE
# conservative, never less.
HOST="$(dirname "${BASH_SOURCE[0]}")/plot-host.sh"
DEFAULT=main
if [ -x "$HOST" ]; then
  d=$("$HOST" default-branch 2>/dev/null) && [ -n "$d" ] && DEFAULT="$d"
fi
git fetch origin "$DEFAULT" --quiet 2>/dev/null || true

# Does the host say ANY PR for this branch merged?
#
# SOURCED from `plot-pr-merged.sh` rather than defined here, since 2026-08-28.
# It lived in this file until `plot-release-refs.sh` needed the SAME gate: both
# scripts ask "has this branch's work landed", and a second implementation that
# drifted toward permissive would delete a ref that cannot be restored. The
# helper carries the reasoning — `mergedAt` never `state`, ANY PR never the
# newest — and defines `pr_merged` and nothing else on load.
. "$(dirname "${BASH_SOURCE[0]}")/plot-pr-merged.sh"

# Where the registry lives, resolved through `plot-config.sh` — the SAME key and
# default the board's reader uses (`resolveManifestDir` in `registry.ts` shells
# out to exactly this). Two implementations of "where is the registry" is how
# they drift, so this asks the config rather than hard-coding `.plot/agents`: a
# project whose board is served from another checkout points the key elsewhere,
# and a reaper writing to the wrong directory would report success over a
# manifest the board still renders.
# Tested with -r, not -x: the helper is invoked through `bash "$CONFIG"`, which
# needs the file READABLE and not executable. `-x` would silently fall back to
# the default on a checkout whose exec bits did not survive — and a reaper
# reading the wrong directory reports success over a manifest the board still
# renders, which is exactly the failure #420 fixed on the board's own side.
# The rule that decides whether a worktree may go. Resolved from THIS script's
# location rather than the cwd, and to a `file://` URL because `import()` needs
# one for an absolute path. Missing or unreadable, the decision below reports
# "could not be asked" and keeps every tree.
RULE_PATH="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." 2>/dev/null && pwd)/packages/domain/src/rules/reapable.ts"
RULE="file://$RULE_PATH"

CONFIG="$(dirname "${BASH_SOURCE[0]}")/plot-config.sh"
MANIFEST_DIR=".plot/agents"
if [ -r "$CONFIG" ]; then
  d=$(bash "$CONFIG" get "Agent registry" ".plot/agents" 2>/dev/null) && [ -n "$d" ] && MANIFEST_DIR="$d"
fi
case "$MANIFEST_DIR" in /*) ;; *) MANIFEST_DIR="$ROOT/$MANIFEST_DIR" ;; esac

# Where the agent logs live, resolved through `plot-config.sh` from the SAME
# `Worktree root` key `resolve_wt_root()` and `agentLogDir` read. Three readers
# of one key, and none of them may invent a second: a reaper sweeping a
# directory the board never writes to reports success over a file that is still
# there, which is the failure this slice exists to stop.
#
# THE FALLBACK IS THE PARENT DIRECTORY, NOT AN ERROR — `agentLogDir`'s rule,
# stated the same way here. A repository with no key has no `.worktrees/`, and
# the logs it wrote are beside it; a reaper that refused to look there would
# clean nothing on exactly the repositories that never migrated.
#
# The case split is `resolve_wt_root()`'s: absolute taken as given, relative
# joined onto the repo root, trailing slash trimmed as pure string work because
# the directory need not exist. A second convention for resolving a configured
# directory is a second way to be wrong.
LOG_DIR="$(cd "$ROOT/.." && pwd)"
if [ -r "$CONFIG" ]; then
  d=$(bash "$CONFIG" get "Worktree root" "" 2>/dev/null) || d=""
  if [ -n "$d" ]; then
    case "$d" in
      /*) LOG_DIR="$d" ;;
      *)  LOG_DIR="$ROOT/$d" ;;
    esac
    LOG_DIR="${LOG_DIR%/}"
  fi
fi

# The files ONE branch's agent run leaves beside its worktree, removed with it.
#
# WHICH LOG THIS IS, since the plan says "the dispatcher log" and the estate
# holds two shapes of one. `plot-resolve-<branch>` is keyed by BRANCH with its
# slashes flattened (`repairLogPath`), so it maps one-to-one onto the worktree
# this loop is removing. `plot-dispatch-<slug>` is keyed by PLAN and opened for
# APPEND across every dispatch of that plan — `dispatch.ts:150` states it: "a
# dispatcher log belongs to a plan, a worker log to a branch". Reaping one
# branch of a five-branch plan must not delete the record the other four are
# still writing to, so the per-plan log is deliberately NOT swept here. It dies
# with its plan, which is a different lifetime and so a different question.
#
# All three extensions go together. `agent-log.ts` puts the `.state` and
# `.prompt.md` beside the log precisely so a sweep takes the whole run: one
# that knew about the log alone would leave half of it behind, which is the
# accumulation this plan measured rather than a smaller version of it.
#
# `rm -f` semantics, and A MISSING LOG IS NOT A REFUSAL. The five refusals
# guard work that might be lost; a log describes work the host already merged.
# Not being there is the desired state, so it is reported as nothing at all.
branch_log_files() { # $1=branch → the paths this branch's run may have left
  local flat=${1//\//-}
  printf '%s\n' \
    "$LOG_DIR/plot-resolve-$flat.log" \
    "$LOG_DIR/plot-resolve-$flat.state" \
    "$LOG_DIR/plot-resolve-$flat.prompt.md"
}

# The ones that are actually there, as a comma-separated list of basenames for
# the report, or empty. Reading is separated from removing so `--dry-run` can
# NAME what a real run would take — the plan asks for that by name, and a
# preview that said "and its log" without checking would promise a file that is
# not there.
present_logs() { # $1=branch → "plot-resolve-x.log, plot-resolve-x.state" or ""
  local f out=""
  while IFS= read -r f; do
    [ -f "$f" ] || continue
    out="${out:+$out, }$(basename "$f")"
  done < <(branch_log_files "$1")
  printf '%s' "$out"
}

# The manifest naming a given worktree, or nothing.
#
# Manifests are keyed by SESSION id, not by branch, so the file cannot be
# derived from the worktree path — it is found by reading the `worktree` field
# out of each one. The match is on the exact recorded path: a prefix match would
# let `plot-wt-foo` claim `plot-wt-foo-bar`'s manifest.
#
# Parsed with `sed`, not a JSON reader, deliberately — this script must run
# where node does not, and the field it needs is one flat string written by the
# dispatcher. A manifest whose `worktree` cannot be read simply does not match,
# which keeps an unparseable file OUT of the removal set rather than in it.
# A path with its symlinks resolved, or the path unchanged when it does not
# exist (nothing to resolve, and the caller still needs a string to compare).
#
# NOT cosmetic. `git worktree list` reports RESOLVED paths, while a manifest
# records whatever the dispatcher was handed — and on macOS `/tmp`, `/var` and
# `/etc` are symlinks into `/private`, so the same directory arrives as two
# different strings. Measured while writing this: a worktree git called
# `/private/var/.../repo` against a manifest saying `/var/.../repo`, matching
# nothing and stranding the manifest the reap was supposed to take.
canonical() {
  local p="$1"
  [ -n "$p" ] || return 0
  # Resolve through the filesystem while the directory is still there — the
  # authoritative answer, and the only one that handles an arbitrary symlink.
  if [ -d "$p" ]; then
    p=$( (cd "$p" 2>/dev/null && pwd -P) || printf '%s' "$p" )
  fi
  # Then normalise the macOS `/private` prefix TEXTUALLY, because the manifest
  # side is compared AFTER its directory has been removed and there is no
  # longer anything to resolve. `/tmp`, `/var` and `/etc` are symlinks into
  # `/private`, so git's `/private/var/...` and a manifest's `/var/...` name
  # one directory; stripping the prefix from both makes them one string
  # whether or not either still exists.
  case "$p" in
    /private/tmp/*|/private/var/*|/private/etc/*) p=${p#/private} ;;
  esac
  printf '%s\n' "$p"
}

manifest_for() {
  local target="$1" f wt
  [ -d "$MANIFEST_DIR" ] || return 1
  target=$(canonical "$target")
  for f in "$MANIFEST_DIR"/*.json; do
    [ -f "$f" ] || continue
    wt=$(sed -n 's/.*"worktree"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$f" | head -1)
    [ -n "$wt" ] || continue
    [ "$(canonical "$wt")" = "$target" ] && { printf '%s\n' "$f"; return 0; }
  done
  return 1
}

reap=0; kept=0; removed=0; cleared=0
printf '%-8s %-52s %s\n' "verdict" "branch" "why"

while IFS=$'\t' read -r wt br; do
  [ -n "$wt" ] || continue
  short=${br#refs/heads/}

  # 5. Only dispatch trees. A hand-made worktree and the main checkout are not
  #    this script's to remove, whatever state they are in.
  #
  #    ASKED OF THE DISK, NOT OF THE PATH. `.plot-worker.pid` is written by the
  #    dispatcher at creation, so it is a marker Plot itself left rather than a
  #    name Plot hopes was used. The path test alone recognised only the LEGACY
  #    `plot-wt-` layout, which `plot-dispatch.sh:129` uses when `Worktree root`
  #    is absent — so on this repo, which sets `Worktree root: .worktrees`,
  #    every tree is `.worktrees/<branch-with-dashes>` and matched nothing.
  #    Measured 2026-08-30: nine dispatch trees, `kept=0` rather than `kept=9`.
  #    A refusal counts and a skip does not, so `reapable=0` read as *nothing to
  #    clean* and meant *nothing was looked at*.
  #
  #    Both signals are accepted and neither is in transition: `plot-wt-` is
  #    supported permanently, and a legacy tree predating the marker keeps
  #    being recognised by its name. A dispatch tree whose pid file was deleted
  #    and whose path does not match goes unrecognised — which fails by
  #    REFUSING, the same safe direction the path test failed in, and for one
  #    tree instead of all of them.
  if [ ! -f "$wt/.plot-worker.pid" ]; then
    case "$wt" in *"/plot-wt-"*) ;; *) continue ;; esac
  fi
  [ "$wt" = "$ROOT" ] && continue

  # THE READINGS. Everything from here to the rule call MEASURES; nothing
  # decides. Each of the four sources that can answer is read once, into a
  # variable named for what it holds rather than for the verdict it implies.

  # The process table: the live worker's pid, or empty. Read but not judged —
  # an empty pid file is not a live process, and which of those two it is is
  # the rule's to say.
  pid=""
  if [ -f "$wt/.plot-worker.pid" ]; then
    p=$(cat "$wt/.plot-worker.pid" 2>/dev/null)
    if [ -n "$p" ] && ps -p "$p" >/dev/null 2>&1; then pid="$p"; fi
  fi

  # The tree: a PLOT-BLOCKED marker, and the first uncommitted path.
  #
  # The tiny-garden pulse is excused because every board suite rewrites it — a
  # worker that did nothing but run the tests would otherwise never be
  # reapable. Any OTHER dirty path is still reported, which keeps this an
  # exception rather than a hole. It is filtered HERE, in the reading, because
  # it is a fact about this repository's fixtures and not about whether a
  # worktree may go.
  marker=false
  ls "$wt"/PLOT-BLOCKED* >/dev/null 2>&1 && marker=true
  dirty=$(git -C "$wt" status --porcelain 2>/dev/null \
            | grep -v 'tiny-garden/\.plot/state' | head -1)

  # The host: whether ANY PR for this branch merged.
  #
  # `merged` never `state` — a merged PR reports CLOSED — and ANY PR never the
  # newest, both of which `plot-pr-merged.sh` carries. Ancestry is consulted
  # FIRST only because it needs no network; it can only ever ADD a merged
  # answer, never withhold one, since a squash-merge leaves the branch
  # permanently ahead and falls through to the host.
  #
  # `unreachable` is not distinguished from `not-merged` here: `pr_merged`
  # returns one exit code for both, deliberately, since both must keep the
  # tree. The rule accepts the distinction so a fixture can trigger it; this
  # reading simply cannot supply it, and reporting the stronger claim would be
  # a lie about what was measured.
  merge=not-merged; why=""
  if [ -n "$short" ] && [ "$(git -C "$wt" rev-list --count "origin/$DEFAULT..$short" 2>/dev/null || echo 1)" = "0" ]; then
    merge=merged; why="merged into $DEFAULT"
  elif [ -n "$short" ] && pr_merged "$short"; then
    merge=merged; why="PR merged (squash)"
  fi

  # THE DECISION. One call, and the script holds no `if` about whether a
  # worktree may go — only about what to do with the answer.
  #
  # The rule is `packages/domain/src/rules/reapable.ts`, imported directly:
  # node 24 strips the types, so there is no build step between this script and
  # the decision it asks for. The same shape, and the same reason, as
  # `scripts/check-changeset-packages.sh` — the JS arrives on STDIN from a
  # QUOTED heredoc so the shell expands none of it.
  #
  # THIS SCRIPT NOW NEEDS NODE, and its header said it must run where node does
  # not. That constraint is retired rather than quietly broken: the alternative
  # is a second implementation of the five refusals living in shell where
  # nothing can test it, and a copy that drifted toward permissive would delete
  # work. `manifest_for` keeps its `sed` parser, which is a different question
  # — reading one flat string out of a file Plot wrote, not deciding anything.
  #
  # A rule that cannot be asked REFUSES: `node` missing, the import failing,
  # the module throwing all leave `verdict` empty, and an empty verdict keeps
  # the tree and says why. Silence is never permission, on this path either.
  verdict=$(PLOT_BRANCH="$short" PLOT_DEFAULT="$DEFAULT" PLOT_PID="$pid" \
            PLOT_DIRTY="$dirty" PLOT_MARKER="$marker" PLOT_MERGE="$merge" \
            PLOT_RULE="$RULE" \
            node --input-type=module - <<'NODE_EOF' 2>/dev/null
// Imported from an ABSOLUTE path derived from this script, never from the
// cwd. The reaper runs with its cwd wherever the operator invoked it and the
// reconcile suite runs it against sandbox repos in the temp directory, so a
// relative specifier resolves to a `packages/` that is not there — which the
// fail-safe turns into "rule could not be asked" and every tree kept. Correct
// direction, useless reaper. Same discipline as `plot-host.sh`,
// `plot-config.sh` and `plot-pr-merged.sh`, which are all found via
// `BASH_SOURCE`.
const { firstReapRefusal } = await import(process.env.PLOT_RULE);

const problem = firstReapRefusal({
  branch: process.env.PLOT_BRANCH,
  defaultBranch: process.env.PLOT_DEFAULT,
  // The main checkout is excluded before the loop reaches here, so the only
  // way this reading is true is the branch test the rule makes anyway.
  isMain: false,
  workerPid: process.env.PLOT_PID === "" ? null : process.env.PLOT_PID,
  dirtyPath: process.env.PLOT_DIRTY,
  blockedMarker: process.env.PLOT_MARKER === "true",
  merge: process.env.PLOT_MERGE,
});

// `reap` when nothing refused; otherwise the refusal and its reading, which
// the shell renders into the prose an operator reads.
process.stdout.write(problem === null ? "reap\t" : `${problem.refusal}\t${problem.detail}`);
NODE_EOF
  )

  refusal=${verdict%%$'\t'*}
  detail=${verdict#*$'\t'}

  # RENDERING, not deciding. The rule named the measurement; this names what it
  # means to someone reading the report, which is the caller's half because
  # only the caller knows it is printing a table.
  if [ "$refusal" != "reap" ]; then
    case "$refusal" in
      live-worker)         reason="worker alive (pid $detail)" ;;
      blocked-marker)      reason="PLOT-BLOCKED marker — needs a person" ;;
      uncommitted-changes) reason="uncommitted: ${detail:0:40}" ;;
      on-default-branch)   reason="on $DEFAULT — dispatched branch not checked out" ;;
      no-merged-pr)        reason="unlanded work — no merged PR" ;;
      *)                   reason="rule could not be asked — keeping" ;;
    esac
    printf '%-8s %-52s %s\n' "keep" "$short" "$reason"; kept=$((kept+1)); continue
  fi

  if [ "$MAX" -gt 0 ] && [ "$reap" -ge "$MAX" ]; then
    printf '%-8s %-52s %s\n' "keep" "$short" "--max $MAX reached"; kept=$((kept+1)); continue
  fi

  # Resolved BEFORE the removal, because `canonical` needs the directory to
  # still exist to resolve it. After `git worktree remove` there is nothing to
  # follow, and the manifest's spelling would never converge with git's.
  wt_real=$(canonical "$wt")

  # Read BEFORE the removal for the same reason `wt_real` is: the report names
  # what was there when the run decided, and a dry run must name exactly what a
  # real run would take. Empty when the branch left no log, which is silent —
  # a missing log is the desired state, not an event.
  logs=$(present_logs "$short")

  reap=$((reap+1))
  if [ "$DRY" -eq 1 ]; then
    printf '%-8s %-52s %s\n' "would" "$short" "$why${logs:+, log $logs}"
  else
    if git worktree remove --force "$wt" 2>/dev/null; then
      # The worktree is gone; NOW the manifest may go. Inside the success arm
      # and nowhere else — a manifest removed before a removal that then
      # refuses leaves a live worktree unregistered, which the registry answers
      # by synthesizing an `unknown` row. Failing this way round strands a
      # manifest instead, which the sweep below clears.
      if m=$(manifest_for "$wt_real"); then
        rm -f "$m" && why="$why, manifest cleared"
      fi
      # AND THE LOG LAST, because it is the only one that is pure cleanup. A
      # missing manifest orphans an agent and a missing worktree loses a desk;
      # a missing log costs a record of work the host already merged. So it
      # goes where a failure before it has cost the least, and its own failure
      # costs nothing at all.
      #
      # Inside the success arm with the manifest: a log describes the worktree,
      # so a removal that refused must keep it — an operator sent to look at a
      # tree that survived needs the words explaining why it is there.
      #
      # `rm -f` and the result ignored. Not being there is the desired state,
      # and a log that cannot be unlinked is not a reason to report a reap that
      # happened as one that did not.
      if [ -n "$logs" ]; then
        while IFS= read -r f; do rm -f "$f" 2>/dev/null; done < <(branch_log_files "$short")
        why="$why, log removed"
      fi
      printf '%-8s %-52s %s\n' "reaped" "$short" "$why"; removed=$((removed+1))
    else
      printf '%-8s %-52s %s\n' "FAILED" "$short" "git worktree remove refused"; kept=$((kept+1))
    fi
  fi
done < <(git worktree list --porcelain \
          | awk '/^worktree /{p=$2} /^branch /{print p"\t"$2}')

[ "$DRY" -eq 0 ] && git worktree prune 2>/dev/null

# The manifests whose worktree is ALREADY gone.
#
# Every reap before this script learned about the registry left one, and the
# board renders each as an `unknown` row naming a directory that does not
# exist. They are the population this plan was written from — seven of them,
# measured 2026-08-26 — and a fix that only stops NEW ones leaves those on the
# board forever.
#
# The predicate is the same one the loop above satisfies by construction: the
# recorded worktree is not there. It needs no PR check and no liveness check —
# nothing runs in a directory that does not exist, which is the strongest
# evidence of "dead" available, not the weakest.
#
# A manifest recording NO worktree path is left alone: it names an agent
# between checkouts, and absence of a path is not absence of an agent.
if [ -d "$MANIFEST_DIR" ]; then
  for m in "$MANIFEST_DIR"/*.json; do
    [ -f "$m" ] || continue
    mwt=$(sed -n 's/.*"worktree"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$m" | head -1)
    [ -n "$mwt" ] || continue
    [ -d "$mwt" ] && continue
    cleared=$((cleared+1))
    if [ "$DRY" -eq 1 ]; then
      printf '%-8s %-52s %s\n' "would" "$(basename "${mwt}")" "orphaned manifest — worktree absent"
    else
      rm -f "$m"
      printf '%-8s %-52s %s\n' "cleared" "$(basename "${mwt}")" "orphaned manifest — worktree absent"
    fi
  done
fi


# ===========================================================================
# THE OTHER THREE KINDS OF LEFTOVER.
#
# The sweep answers ONE question — is anything here that nobody is coming back
# for? — and it does not care whether the cause was a dead agent, an
# interrupted dispatch, a `--stop`, or a merge somebody did on the host.
# Everything above answers it about WORKTREES. Measured 2026-09-02 on this
# estate, three more populations answer it and nothing looks at them:
#
#   local branches        85 of 98 already merged   ← the largest, swept below
#   orphaned claim refs   a claim whose agent never existed
#   dirty trees nobody owns   2 desks, 52 and 1 files   ← reported, never deleted
#
# EVERY KIND KEEPS THE SHAPE THIS SCRIPT ALREADY HAS: `--dry-run` by default,
# acting on `--yes`, bounded by `--max N`. The bound is per kind, because the
# kinds are different acts on different populations — a run bounded to five
# worktrees has not therefore been asked to leave the 85th branch alone.
#
# AND THE DECIDING IS NOT HERE EITHER. Each kind gathers readings and asks
# `packages/domain/src/rules/sweepable.ts`, exactly as the worktree loop asks
# `reapable.ts`. `reapable.ts` is UNTOUCHED: its five refusals were written for
# the population it sweeps, and a backstop that guesses is worse than none.
# A rule that cannot be asked REFUSES, so a missing `node` sweeps nothing.
# ===========================================================================

SWEEP_RULE_PATH="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." 2>/dev/null && pwd)/packages/domain/src/rules/sweepable.ts"
SWEEP_RULE="file://$SWEEP_RULE_PATH"

swept_branches=0; deleted_branches=0; kept_branches=0
swept_claims=0; deleted_claims=0; kept_claims=0
dirty_trees=0

# ---------------------------------------------------------------------------
# KIND 2: LOCAL BRANCHES.
#
# THE GATE IS THE REAPER'S, NOT GIT'S:
#
#     the host says merged, AND no worktree holds it → delete
#
# `git branch -d` is NOT the gate. It refuses an unmerged branch, which sounds
# like the safety this needs — except squash-merge leaves a branch permanently
# ahead of main, the trap `plot-pr-merged.sh` exists for, so `-d` would refuse
# all 85 for the wrong reason. This uses `-D` and puts the safety in the two
# measurements above it, where a test can reach it.
#
# WHY A LOCAL BRANCH JOINS THE ESTATE-WIDE SIDE. The asymmetry between kinds is
# deliberate: a removed checkout comes back with `git worktree add`, a deleted
# REMOTE ref does not, so `plot-release-refs.sh` stays plan-scoped. A local
# branch whose PR merged is re-fetchable from origin — it is A copy, not THE
# copy — so the argument that protects remote refs does not transfer, and this
# sweeps estate-wide like the worktrees do.
#
# REPORT-ONLY WAS THE ALTERNATIVE, AND 85 ROWS IS THE ARGUMENT AGAINST IT. A
# sweep that reports and never acts becomes one more thing a person has to
# clear — the problem this plan exists to remove, reintroduced one level up.
# ---------------------------------------------------------------------------

# Every branch checked out ANYWHERE, for the second half of the gate.
#
# Read once before the loop, the same reading and the same reason as
# `plot-release-refs.sh:126` — that file's guard 4 collects exactly this, and
# the brief asks for it to be reused rather than written twice. A worktree
# created mid-run holds a branch this run has not yet reached, and the next run
# sees it.
sweep_checked_out=$(git worktree list --porcelain 2>/dev/null \
                      | sed -n 's|^branch refs/heads/||p')

sweep_is_checked_out() {
  printf '%s\n' "$sweep_checked_out" | grep -qxF "$1"
}

# Ask the rule about one branch. Empty output means the rule could not be
# asked, which the caller renders as a refusal — silence is never permission.
sweep_branch_verdict() { # $1=branch $2=merged(true/false) $3=checked_out(true/false)
  PLOT_BRANCH="$1" PLOT_DEFAULT="$DEFAULT" PLOT_MERGED="$2" PLOT_CHECKED="$3" \
  PLOT_RULE="$SWEEP_RULE" \
  node --input-type=module - <<'NODE_EOF' 2>/dev/null
const { firstBranchRefusal } = await import(process.env.PLOT_RULE);
const refusal = firstBranchRefusal({
  branch: process.env.PLOT_BRANCH,
  defaultBranch: process.env.PLOT_DEFAULT,
  hasMergedPr: process.env.PLOT_MERGED === "true",
  checkedOut: process.env.PLOT_CHECKED === "true",
});
process.stdout.write(refusal === null ? "sweep" : refusal);
NODE_EOF
}

echo
echo "-- local branches --"

while IFS= read -r br; do
  [ -n "$br" ] || continue

  # The host, asked exactly as the worktree loop asks it. Ancestry FIRST only
  # because it needs no network; it can only ever ADD a merged answer, never
  # withhold one, since squash-merge leaves the branch permanently ahead and
  # falls through to `pr_merged`.
  merged=false
  if [ "$(git rev-list --count "origin/$DEFAULT..$br" 2>/dev/null || echo 1)" = "0" ]; then
    merged=true; bwhy="merged into $DEFAULT"
  elif pr_merged "$br"; then
    merged=true; bwhy="PR merged (squash)"
  fi

  held=false
  sweep_is_checked_out "$br" && held=true

  bverdict=$(sweep_branch_verdict "$br" "$merged" "$held")

  if [ "$bverdict" != "sweep" ]; then
    case "$bverdict" in
      default-branch) breason="the default branch — never deleted" ;;
      no-merged-pr)   breason="unlanded work — no merged PR" ;;
      checked-out)    breason="checked out in a worktree — somebody is reading it" ;;
      *)              breason="rule could not be asked — keeping" ;;
    esac
    printf '%-8s %-52s %s\n' "keep" "$br" "$breason"; kept_branches=$((kept_branches+1)); continue
  fi

  if [ "$MAX" -gt 0 ] && [ "$swept_branches" -ge "$MAX" ]; then
    printf '%-8s %-52s %s\n' "keep" "$br" "--max $MAX reached"; kept_branches=$((kept_branches+1)); continue
  fi

  swept_branches=$((swept_branches+1))
  if [ "$DRY" -eq 1 ]; then
    printf '%-8s %-52s %s\n' "would" "$br" "$bwhy, no worktree holds it"
  else
    # `-D`, not `-d`. The safety is the two measurements above, and `-d` would
    # veto every squash-merged branch — the whole population — for a reason
    # that has nothing to do with whether the work landed.
    if git branch -D "$br" >/dev/null 2>&1; then
      printf '%-8s %-52s %s\n' "deleted" "$br" "$bwhy, local ref deleted"; deleted_branches=$((deleted_branches+1))
    else
      printf '%-8s %-52s %s\n' "FAILED" "$br" "git branch -D refused"; kept_branches=$((kept_branches+1))
    fi
  fi
done < <(git for-each-ref --format='%(refname:short)' refs/heads/ 2>/dev/null)

# ---------------------------------------------------------------------------
# KIND 3: ORPHANED CLAIM REFS.
#
# A claim whose agent never existed. `plot-reconcile-scan.sh:423` defines the
# marker precisely and this uses THE SAME definition: a claim commit is titled
# `plot: claim ...` AND empty, its tree equal to its parent's. The subject
# alone is not evidence — a human commit titled "plot: claim handling
# refactor" carrying real files would otherwise read as an empty claim, and
# the sweep would offer to delete real work.
#
# ONLY WHAT THE SCAN ALREADY CALLS REAPABLE IS SWEPT. Section 3 classifies
# these: a `deferred:`/`moved:` annotation in the plan means reapable, a bare
# `claimed:` needs judgment. The judgment cases are left for a person and keep
# being reported — a slow worker and a dead one leave the identical empty
# branch, and one of them is doing real work.
#
# Git cannot answer how a claim ended, so the plan annotation is the only
# signal. Reading it here is the same deliberate exception the scan states: it
# decides CLEANUP, not work, so a wrong annotation costs at most a missed
# cleanup — never lost or duplicated work.
# ---------------------------------------------------------------------------

ACTIVE_DIR_SWEEP="docs/plans/active/"
if [ -r "$CONFIG" ]; then
  d=$(bash "$CONFIG" get "Active index" "docs/plans/active/" 2>/dev/null) && [ -n "$d" ] && ACTIVE_DIR_SWEEP="$d"
fi
case "$ACTIVE_DIR_SWEEP" in /*) ;; *) ACTIVE_DIR_SWEEP="$ROOT/$ACTIVE_DIR_SWEEP" ;; esac

# Does this branch carry ONLY empty claim commits? The scan's definition,
# applied to a LOCAL ref — this sweep runs over local branches, where the scan
# reads `origin/`.
sweep_is_empty_claim() { # $1=branch
  local br="$1" ahead c subj real=0
  ahead=$(git rev-list --count "origin/$DEFAULT..$br" 2>/dev/null || echo 0)
  [ "${ahead:-0}" -gt 0 ] || return 1   # nothing of its own → merged work, not a claim
  for c in $(git rev-list "origin/$DEFAULT..$br" </dev/null 2>/dev/null); do
    subj=$(git log -1 --format=%s "$c" </dev/null 2>/dev/null)
    case "$subj" in
      "plot: claim "*)
        # Titled AND empty. Both, or it counts as real work.
        if [ "$(git rev-parse "$c^{tree}" </dev/null 2>/dev/null)" \
             = "$(git rev-parse "$c^^{tree}" </dev/null 2>/dev/null)" ]; then
          continue
        fi ;;
    esac
    real=$((real+1))
  done
  [ "$real" = "0" ]
}

# How the plan annotation classified this claim — the scan's `claim_disposition`,
# same predicate, same directory.
sweep_claim_disposition() { # $1=branch → abandoned | unresolved
  local br="$1" l line
  for l in "$ACTIVE_DIR_SWEEP"/*.md; do
    [ -e "$l" ] || continue
    line=$(grep -F -- "\`$br\`" "$l" 2>/dev/null | head -1)
    [ -n "$line" ] || continue
    case "$line" in
      *"<!-- deferred:"*|*"<!-- moved:"*) echo "abandoned"; return ;;
    esac
  done
  echo "unresolved"
}

sweep_claim_verdict() { # $1=branch $2=empty(true/false) $3=disposition
  PLOT_BRANCH="$1" PLOT_EMPTY="$2" PLOT_DISP="$3" PLOT_RULE="$SWEEP_RULE" \
  node --input-type=module - <<'NODE_EOF' 2>/dev/null
const { firstClaimRefusal } = await import(process.env.PLOT_RULE);
const refusal = firstClaimRefusal({
  branch: process.env.PLOT_BRANCH,
  isEmptyClaim: process.env.PLOT_EMPTY === "true",
  disposition: process.env.PLOT_DISP === "abandoned" ? "abandoned" : "unresolved",
});
process.stdout.write(refusal === null ? "sweep" : refusal);
NODE_EOF
}

echo
echo "-- orphaned claim refs --"

while IFS= read -r br; do
  [ -n "$br" ] || continue
  [ "$br" = "$DEFAULT" ] && continue

  empty=false
  sweep_is_empty_claim "$br" && empty=true
  # Only branches that ARE empty claims belong to this kind at all. Anything
  # else is another kind's population or none, and reporting it here would say
  # "this is a claim we declined" about a branch carrying real work.
  [ "$empty" = "true" ] || continue

  disp=$(sweep_claim_disposition "$br")
  cverdict=$(sweep_claim_verdict "$br" "$empty" "$disp")

  if [ "$cverdict" != "sweep" ]; then
    case "$cverdict" in
      needs-judgment)     creason="still claimed, no commits → needs judgment (worker thinking, or dead)" ;;
      not-an-empty-claim) creason="carries real work — not a claim" ;;
      *)                  creason="rule could not be asked — keeping" ;;
    esac
    printf '%-8s %-52s %s\n' "keep" "$br" "$creason"; kept_claims=$((kept_claims+1)); continue
  fi

  if [ "$MAX" -gt 0 ] && [ "$swept_claims" -ge "$MAX" ]; then
    printf '%-8s %-52s %s\n' "keep" "$br" "--max $MAX reached"; kept_claims=$((kept_claims+1)); continue
  fi

  swept_claims=$((swept_claims+1))
  if [ "$DRY" -eq 1 ]; then
    printf '%-8s %-52s %s\n' "would" "$br" "abandoned claim (plan says deferred/moved)"
  else
    if git branch -D "$br" >/dev/null 2>&1; then
      printf '%-8s %-52s %s\n' "deleted" "$br" "abandoned claim — local ref deleted"; deleted_claims=$((deleted_claims+1))
    else
      printf '%-8s %-52s %s\n' "FAILED" "$br" "git branch -D refused"; kept_claims=$((kept_claims+1))
    fi
  fi
done < <(git for-each-ref --format='%(refname:short)' refs/heads/ 2>/dev/null)

# ---------------------------------------------------------------------------
# KIND 4: DIRTY TREES NOBODY OWNS.
#
# REFUSED TODAY AND NEVER RESOLVED, and this KEEPS it refused. `uncommitted-
# changes` is a refusal for the same reason the create-or-reset guard does not
# `reset --hard`: the case where the guard is wrong is exactly the case where
# destruction cannot be undone. A guard that misjudges should leave a desk the
# sweep reports, not deleted work.
#
# SO THIS KIND HAS NO `--yes` PATH AT ALL, and that absence is the design. What
# it adds is the NAME: the tree is reported as a leftover whose owner is
# `nobody`, loudly enough that a person clears it. The population was refused
# and never resolved precisely because nothing ever said whose it was.
#
# It runs over EVERY worktree, not only dispatch trees: a tree nobody owns is
# by construction one that may carry no `.plot-worker.pid`, so the marker the
# reap loop gates on is exactly what a leftover of this kind lacks.
#
# EXCEPT THE MAIN CHECKOUT, which is a person's desk by definition. Measured
# while writing this: the operator's own checkout carried 2 uncommitted files
# and no `.plot-worker.pid`, so it read as a leftover nobody owns — and it is
# the one tree on the estate somebody is certainly at. `$ROOT` is not the test,
# because this script runs from whichever worktree invoked it; the main
# checkout is the PARENT of `--git-common-dir`, which every worktree agrees on.
# ---------------------------------------------------------------------------

MAIN_CHECKOUT=$(cd "$(git rev-parse --git-common-dir 2>/dev/null)/.." 2>/dev/null && pwd -P) || MAIN_CHECKOUT=""

sweep_dirty_owner() { # $1=pid $2=manifest → owner word
  PLOT_PID="$1" PLOT_MANIFEST="$2" PLOT_RULE="$SWEEP_RULE" \
  node --input-type=module - <<'NODE_EOF' 2>/dev/null
const { dirtyTreeOwner } = await import(process.env.PLOT_RULE);
process.stdout.write(dirtyTreeOwner({
  path: "",
  branch: "",
  dirtyCount: 1,
  workerPid: process.env.PLOT_PID === "" ? null : process.env.PLOT_PID,
  manifest: process.env.PLOT_MANIFEST,
}));
NODE_EOF
}

echo
echo "-- dirty trees nobody owns --"

while IFS=$'\t' read -r wt br; do
  [ -n "$wt" ] || continue
  [ -d "$wt" ] || continue
  # The main checkout is a person's desk, and its dirt is a person's work in
  # progress. Compared canonically, since git reports resolved paths and macOS
  # spells `/tmp`, `/var` and `/etc` two ways.
  [ -n "$MAIN_CHECKOUT" ] && [ "$(canonical "$wt")" = "$(canonical "$MAIN_CHECKOUT")" ] && continue
  dshort=${br#refs/heads/}

  dcount=$(git -C "$wt" status --porcelain 2>/dev/null \
             | grep -v 'tiny-garden/\.plot/state' | wc -l | tr -d ' ')
  [ "${dcount:-0}" -gt 0 ] || continue

  dpid=""
  if [ -f "$wt/.plot-worker.pid" ]; then
    p=$(cat "$wt/.plot-worker.pid" 2>/dev/null)
    if [ -n "$p" ] && ps -p "$p" >/dev/null 2>&1; then dpid="$p"; fi
  fi

  dmanifest=""
  if m=$(manifest_for "$(canonical "$wt")"); then dmanifest=$(basename "$m"); fi

  downer=$(sweep_dirty_owner "$dpid" "$dmanifest")
  # A rule that could not be asked answers nothing, and nothing is not
  # `nobody`. An unaskable rule must not be what promotes a tree to a finding.
  [ "$downer" = "nobody" ] || continue

  dirty_trees=$((dirty_trees+1))
  # NEVER a `would` or a `deleted`: there is no act to preview. `LEFTOVER` is
  # the verdict, and the owner is the finding.
  printf '%-8s %-52s %s\n' "LEFTOVER" "${dshort:-(detached)}" \
    "$dcount uncommitted, owner: nobody — clear it by hand: $wt"
done < <(git worktree list --porcelain \
          | awk '/^worktree /{p=$2} /^branch /{print p"\t"$2} /^detached/{print p"\t"}')

if [ "$dirty_trees" -gt 0 ]; then
  echo "  ^ $dirty_trees dirty tree(s) nobody owns. Nothing was deleted from them,"
  echo "    deliberately: where this guard is wrong, destruction cannot be undone."
fi

# THE REMOTE refs are untouched, deliberately. This deletes LOCAL branches,
# which are re-fetchable from origin — a copy, not the copy — so the act is
# bounded to a local ref and a reflog. A remote ref is not re-creatable at all,
# which is why `plot-release-refs.sh` deletes those, plan-scoped, under its own
# licence and its own five guards. The asymmetry between the kinds is the whole
# safety argument and it stays.
echo "summary: reapable=$reap removed=$removed kept=$kept cleared=$cleared branches=$swept_branches branches_deleted=$deleted_branches branches_kept=$kept_branches claims=$swept_claims claims_deleted=$deleted_claims claims_kept=$kept_claims dirty_trees=$dirty_trees dry_run=$DRY"
exit 0
