#!/usr/bin/env bash
# Remove worktrees whose work has landed, their dead worker files, and the
# registry manifests that named them.
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
# ORDER: worktree FIRST, manifest second. The reverse leaves a live worktree
# with no registration, which `readAgentRegistry` answers by SYNTHESIZING an
# `unknown` entry — the same bad row, earned a different way. A failure between
# the two steps this way round leaves an orphaned manifest, which the sweep
# below clears on the next run.
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

  reap=$((reap+1))
  if [ "$DRY" -eq 1 ]; then
    printf '%-8s %-52s %s\n' "would" "$short" "$why"
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

# The branches and refs are untouched, deliberately: this removes CHECKOUTS and
# the registrations that named them. A reaped tree is re-creatable with
# `git worktree add`, so the destructive act is bounded to disk space and to a
# record of an agent that has already finished — never to history.
echo "summary: reapable=$reap removed=$removed kept=$kept cleared=$cleared dry_run=$DRY"
exit 0
