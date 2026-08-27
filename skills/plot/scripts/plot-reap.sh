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
    -h|--help) sed -n '2,42p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
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
# `merged` is read, NEVER `state`: a merged PR reports state CLOSED, and
# trusting `state` would refuse every squash-merged branch — which is the whole
# population this script exists for. Squash-merge rewrites the commits, so the
# branch stays "ahead of main" forever and ancestry alone can never clear it.
#
# AND THE QUESTION IS "ANY", NOT "THE NEWEST". This asked with `--limit 1`
# until 2026-08-27, which returns only the most recent PR — so a newer,
# unmerged PR sitting in front of the real merge made the reaper report
# `unlanded work — no merged PR` about a branch whose work was on main.
# Measured that day against the live host:
#
#   an-unreachable-host-says-so         newest #473 null → real merge #446
#   the-scan-sees-a-stale-sprint-tally  newest #464 null → real merge #463
#   a-plan-cites-a-jira-key             newest #476 null → real merge #447
#
# The masking PRs were ones the fleet opened ITSELF on already-merged waves,
# which closes a loop: a leftover worktree lets auto-dispatch adopt a merged
# branch, its worker opens a duplicate, the duplicate is newer, the reaper
# keeps the worktree — the input to step one. Reading only the newest PR is
# the SAME error as reading `state`, one level out: the newest PR is not the
# merge, just as the state is not the merge.
#
# 100 rather than unbounded: `gh` has no "all" sentinel, and this runs on the
# reap path where the estate may hold dozens of trees. A branch carrying more
# than 100 PRs whose only merge is the oldest would still be missed — a far
# narrower window than "any duplicate at all", and it fails SAFE, toward
# keeping a worktree.
pr_merged() {
  local br="$1" out
  command -v gh >/dev/null 2>&1 || return 1
  out=$(gh pr list --head "$br" --state all --limit 100 --json mergedAt 2>/dev/null) || return 1
  case "$out" in *'"mergedAt":"'*) return 0 ;; *) return 1 ;; esac
}

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
  case "$wt" in *"/plot-wt-"*) ;; *) continue ;; esac
  [ "$wt" = "$ROOT" ] && continue

  # 1. A live worker outranks every other signal. Checked FIRST because it is
  #    the only one describing a person or process acting right now.
  if [ -f "$wt/.plot-worker.pid" ]; then
    pid=$(cat "$wt/.plot-worker.pid" 2>/dev/null)
    if [ -n "$pid" ] && ps -p "$pid" >/dev/null 2>&1; then
      printf '%-8s %-52s %s\n' "keep" "$short" "worker alive (pid $pid)"; kept=$((kept+1)); continue
    fi
  fi

  # 3. A marker means a worker stopped to ask a person something. Reaping it
  #    discards the question along with the tree.
  if ls "$wt"/PLOT-BLOCKED* >/dev/null 2>&1; then
    printf '%-8s %-52s %s\n' "keep" "$short" "PLOT-BLOCKED marker — needs a person"; kept=$((kept+1)); continue
  fi

  # 2. Uncommitted work exists in exactly one place. The tiny-garden pulse is
  #    excused because every board suite rewrites it — a worker that did
  #    nothing but run the tests would otherwise never be reapable. Any OTHER
  #    dirty path still keeps the tree, which is what keeps this an exception
  #    rather than a hole.
  dirty=$(git -C "$wt" status --porcelain 2>/dev/null \
            | grep -v 'tiny-garden/\.plot/state' | head -1)
  if [ -n "$dirty" ]; then
    printf '%-8s %-52s %s\n' "keep" "$short" "uncommitted: ${dirty:0:40}"; kept=$((kept+1)); continue
  fi

  # 4a. A tree sitting ON the default branch answers the ancestry test
  #     trivially — `origin/main..main` is empty — and would be reaped with the
  #     reason "merged into main", which says nothing about the work it was
  #     dispatched for. Measured here 2026-08-25: one dispatch tree had been
  #     left on `main` by its worker, and the first draft of this script
  #     offered to reap it for a reason that was true and irrelevant.
  #
  #     It is KEPT and named. Deleting a tree whose dispatched branch is no
  #     longer checked out means deleting something whose state was never
  #     measured — and "probably fine" is the judgement this script exists to
  #     not make.
  if [ "$short" = "$DEFAULT" ]; then
    printf '%-8s %-52s %s\n' "keep" "$short" "on $DEFAULT — dispatched branch not checked out"
    kept=$((kept+1)); continue
  fi

  # 4b. Landed, by either route: ancestry for a merge commit, the host for a
  #     squash. Ancestry is tried first because it needs no network.
  why=""
  if [ -n "$short" ] && [ "$(git -C "$wt" rev-list --count "origin/$DEFAULT..$short" 2>/dev/null || echo 1)" = "0" ]; then
    why="merged into $DEFAULT"
  elif [ -n "$short" ] && pr_merged "$short"; then
    why="PR merged (squash)"
  else
    printf '%-8s %-52s %s\n' "keep" "$short" "unlanded work — no merged PR"; kept=$((kept+1)); continue
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
