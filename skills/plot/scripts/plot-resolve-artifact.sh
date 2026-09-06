#!/usr/bin/env bash
# Plot helper: repair an ARTIFACT-ONLY merge conflict on one branch.
# Usage: plot-resolve-artifact.sh [--dry-run] <branch>
#   --dry-run   print the sequence and the worktree it would use; change nothing
#   <branch>    the branch to repair — must already exist on origin
# Output: one `step:` line per stage, then a machine-countable footer:
#     summary: branch=<name> outcome=pushed|abandoned|refused reason=<word>
#
# THE ONLY AUTOMATIC WRITE THIS SYSTEM GRANTS, and it is granted for three
# verified reasons rather than for convenience:
#
#   1. `-merge` KEEPS THE FILE VALID. `.gitattributes` marks every bundle
#      `-merge`, so git keeps one side whole and writes NO conflict markers.
#      The artifact stays buildable JavaScript *through* a conflict — which is
#      why a script may touch it at all. `scripts/check-bundle-attributes.sh`
#      is the gate that keeps that true of every bundle rather than of one.
#   2. THE REBUILD IS DETERMINISTIC. Measured: `build.mjs` embeds no timestamp
#      and no randomness, so the output does not depend on which side was kept.
#   3. CI PROVES IT. The no-diff gate fails the build if the committed artifact
#      does not match a fresh rebuild.
#
# Together those make this the one repair whose correctness is checkable
# WITHOUT JUDGEMENT. That is the whole licence. No other failure has these
# three properties, and none may be added to this path — widening the entry
# condition removes the argument that grants the permission, even if the code
# looks correct.
#
# THIS IS A SCRIPT AND NOT AN AGENT, deliberately. Every step below is fixed
# and nothing between them is a decision, which is *precisely* what licenses the
# automation. Handing the sequence to an agent would introduce judgement exactly
# where its absence is the permission. (Measured on 2026-08-17: this repo has no
# `Worker command` configured either, so plot-dispatch.sh would report
# `worker=unconfigured` and start nothing — but the shape is the reason, not
# the measurement.)
#
# TESTS RUN BEFORE THE PUSH. The CI no-diff gate is what makes the repair
# checkable, and CI runs only AFTER a push — so a resolver that pushed and
# waited would manufacture exactly the state this exists to remove: a red PR in
# the queue. The sequence therefore ends on `pnpm run test:board` green in the
# branch's own worktree, and CI becomes confirmation rather than discovery.
#
# IF THE SUITE FAILS, NOTHING IS PUSHED. The repair stopped being mechanical the
# moment its own gate said so; the branch is left exactly as it was, and the
# board reports it as a conflict a human owns.
#
# IT MERGES ONLY IN A WORKTREE THAT IS IDLE. A worktree carrying modifications
# belongs to whoever made them — measured on 2026-08-17, the resolver ran its
# merge inside one an agent was actively editing. It refuses `worktree-busy`
# rather than reaching in, which the plan names the honest minimum: a second
# worktree on the same branch is not available to it anyway, since git refuses a
# second checkout of one branch.
#
# AN EMPTY CONFLICT SET IS NOT A REFUSAL ABOUT FILES. Three cases, named apart,
# because two of them were once one:
#
#   bundles only          → the licensed case                    → repair
#   other files present   → needs judgement                      → not-artifact-only
#   empty, no merge ran   → nothing was observed                 → not-observed
#
# The last is not a smaller version of the middle. `not-artifact-only` asserts
# something about the files that conflicted, and a set of zero has none to
# assert it about — saying it there sends a reader to look for files nobody ever
# examined.
#
# WHICH SIDE IS TAKEN CANNOT MATTER, and the diff is never read. `--theirs` is
# named here only because `git checkout` needs a word: the rebuild overwrites
# whichever side was kept. Never phrase it as "take ours" — under `git merge`
# *ours* is the branch being merged into, under `git rebase` it is the upstream,
# and this repo rebases routinely.
set -uo pipefail

script_dir=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)

# THE FILES THIS SCRIPT MAY RESOLVE — a SET, and derived rather than listed.
#
# It was one hardcoded filename until 2026-09-06, and that cost a repair the
# same day: PR #727 conflicted in `plot-registryd.mjs` — a `-merge` bundle with
# a deterministic rebuild, exactly the licensed case — and this script refused
# `not-artifact-only` against a list naming only `board-server.mjs`. The refusal
# was correct behaviour against a stale list. Hours later the same branch
# conflicted in `board-server.mjs` and was repaired automatically: same class of
# conflict, opposite outcome, one filename apart.
#
# DERIVED FROM `build.mjs`'S OWN DECLARATIONS, by the same pipeline
# `scripts/check-bundle-attributes.sh` uses, because a hand-written list here
# would be a fourth place to drift — and drift is the defect this replaces. The
# build declares each output as `const shippedX = path.join(here, '…')`, which
# is what an author writes when adding a bundle; nothing else has to be
# remembered. Nine bundles today; `plot-landed.mjs` arrived while the plan that
# asked for this was still in draft, and the derivation found it.
#
# `plot-monitor.mjs` IS DELIBERATELY ABSENT. It is committed and documented, and
# no `outfile` names it — nothing rebuilds it. Property 2 above is the whole
# licence, so a file with no deterministic rebuild cannot be on this list. The
# derivation reads the build, so it cannot ask for it.
#
# Still named in the board's contract as well, because the two run in different
# languages and neither can import the other's constant. The pairing is asserted
# by a test rather than trusted — and that test now asserts SET EQUALITY, since
# a set that agrees on one member and differs on another is exactly the drift
# this replaces.
#
# READ FROM THE REPOSITORY BEING REPAIRED, not from this script's own checkout.
# The script is vendored into the published package, where `packages/` does not
# exist — and it rebuilds with `pnpm build:board` inside the target repo, so the
# build that defines the set is the one that will run. Resolved below, once
# `repo_root` is known.
bundle_set() { # $1=repo root → one path per line, sorted
  grep -aoE "shipped[A-Za-z]* = path\.join\([^)]*'[^']*'\)" "$1/packages/board/build.mjs" 2>/dev/null \
    | sed -E "s|.*'\.\./\.\./([^']*)'.*|\1|" \
    | sort -u
}

dry_run=0
branch=""
while [ $# -gt 0 ]; do
  case "$1" in
    --dry-run) dry_run=1 ;;
    -*) echo "plot-resolve-artifact: unknown option '$1'" >&2; exit 2 ;;
    *) branch="$1" ;;
  esac
  shift
done

# The footer travels on EVERY exit path, including the refusals. A run that
# ends without one is indistinguishable from a crash, and a silent automatic
# write is the failure mode this whole plan exists to remove.
finish() { # $1=outcome $2=reason
  echo "summary: branch=$branch outcome=$1 reason=$2"
  case "$1" in
    pushed) exit 0 ;;
    *) exit 1 ;;
  esac
}

[ -n "$branch" ] || { echo "usage: plot-resolve-artifact.sh [--dry-run] <branch>" >&2; exit 2; }

git rev-parse --git-dir >/dev/null 2>&1 || {
  echo "plot-resolve-artifact: not a git repository" >&2
  finish refused not-a-repo
}

MAIN=$(git symbolic-ref --short refs/remotes/origin/HEAD 2>/dev/null | sed 's#^origin/##')
[ -n "$MAIN" ] || MAIN="main"

repo_root=$(git rev-parse --show-toplevel)

# THE SET, resolved against the repository this run will rebuild.
ARTIFACT_PATHS=$(bundle_set "$repo_root")

# AN EMPTY DERIVATION REFUSES, and it must: the guard below asks whether every
# unmerged path is in this set, and against an empty set that question has no
# true answer to give — but a guard written the other way round would have said
# yes to everything. The build changing shape, or a checkout with no
# `packages/`, is a reason to stop rather than a reason to repair blind.
if [ -z "$ARTIFACT_PATHS" ]; then
  echo "step: no bundles derived from packages/board/build.mjs — refusing"
  finish refused no-bundle-set
fi

# WHICH WORKTREE HOLDS THIS BRANCH — ASK GIT, do not reconstruct the path from
# the branch name.
#
# MEASURED, and recorded at length in plot-dispatch.sh's held_worktree: a
# hand-made worktree is named for the branch with its TYPE dropped, so a gate
# that guessed `plot-wt-<flattened>` missed a worktree with six modified files
# in it. This site had the same shape — it composed `plot-wt-<flattened>` under
# `repo_root/..` — and this change would make the guess worse, not better: the
# new `Worktree root:` key introduces a SECOND naming convention, giving a
# path guess a second way to be wrong. So the read asks git, and only the
# CREATE-a-fresh-one fallback below composes a name (via dispatch's rule, so the
# fresh worktree lands where dispatch would have put it).
#
# `git worktree list --porcelain` emits `worktree <path>` then `branch
# refs/heads/<name>` per entry; the branch line is matched and the path taken
# from the preceding one. A branch already dispatched is thus repaired in the
# worktree it is already checked out in rather than in a second copy of itself —
# git refuses a second checkout of one branch, and the two would fight over the
# same index if it did not.
wt=$(git worktree list --porcelain </dev/null 2>/dev/null | awk -v want="refs/heads/$branch" '
  /^worktree /  { path = substr($0, 10) }
  /^branch /    { if (substr($0, 8) == want) { print path; exit } }')

# No existing worktree holds it — compose the path a fresh one will take, by the
# same root+prefix rule plot-dispatch.sh uses. Under a `Worktree root:` key the
# root moves and the `plot-wt-` prefix drops; absent it, today's behaviour.
if [ -z "$wt" ]; then
  wt_root=$("$script_dir/plot-config.sh" get "Worktree root" "")
  if [ -z "$wt_root" ]; then
    wt_root=$(cd "$repo_root/.." && pwd)
    wt="$wt_root/plot-wt-$(printf '%s' "$branch" | tr '/' '-')"
  else
    case "$wt_root" in
      /*) : ;;
      *)  wt_root="$repo_root/$wt_root" ;;
    esac
    wt="${wt_root%/}/$(printf '%s' "$branch" | tr '/' '-')"
  fi
fi

if [ "$dry_run" = 1 ]; then
  echo "step: would use worktree $wt"
  echo "step: would merge origin/$MAIN, take a side of each conflicted bundle, rebuild, test"
  printf 'step: bundle set (%s): %s\n' \
    "$(printf '%s\n' "$ARTIFACT_PATHS" | grep -c .)" \
    "$(printf '%s' "$ARTIFACT_PATHS" | tr '\n' ' ')"
  echo "step: would push only if pnpm run test:board passes"
  finish refused dry-run
fi

git fetch -q origin "$MAIN" "$branch" 2>/dev/null || true

# ONE REPAIR AT A TIME, AND NEVER TWO ON ONE BRANCH.
#
# A second run while the first is working would fight over the same worktree:
# the merge, the rebuild and the five-minute suite all write into it, and two of
# them interleaved produce an artifact belonging to neither run. The lock is a
# DIRECTORY rather than a file because `mkdir` is atomic on every filesystem
# this runs on — two processes racing it, one wins, and the loser learns it lost
# from the exit code rather than from a check-then-write that both pass.
#
# The board guards its own in-flight repairs too, in memory. Both are needed and
# neither is redundant: the board's registry cannot see a repair started by a
# second board or by a human at a shell, and this lock cannot stop the board
# from spawning (it learns only after the spawn). The lock is the authority.
lock="$repo_root/.plot/state/resolve-$(printf '%s' "$branch" | tr '/' '-').lock"
mkdir -p "$(dirname "$lock")" 2>/dev/null || true
if ! mkdir "$lock" 2>/dev/null; then
  echo "step: a repair is already in flight for $branch ($lock)"
  finish refused already-in-flight
fi
# Released on every exit, including a kill. A lock that outlives its process
# would make one interrupted repair block the branch forever — and the repair is
# idempotent, so there is nothing to protect after the process is gone.
trap 'rmdir "$lock" 2>/dev/null || true' EXIT INT TERM

if [ -d "$wt" ] && git worktree list --porcelain | grep -qx "worktree $wt"; then
  # A REUSED WORKTREE MAY BELONG TO SOMEONE ELSE, and on 2026-08-17 one did: the
  # resolver ran `git merge` inside a worktree an agent was actively editing —
  # zero unmerged paths, three modified files, work in progress. It refused
  # before writing anything, but that was luck rather than design.
  #
  # Reuse is right when the worktree is IDLE; the name alone does not say so. A
  # worktree with modifications is one whose owner is mid-thought, and merging
  # into it would either fail on "local changes would be overwritten" or, worse,
  # succeed and fold a stranger's uncommitted work into a merge commit this
  # script then pushes.
  #
  # The honest minimum is to refuse, and the plan names it acceptable: creating a
  # scratch worktree is impossible anyway while git holds this branch checked out
  # here, since git refuses a second checkout of one branch.
  #
  # `--porcelain` rather than a parsed `git status`: it is the stable interface,
  # and an untracked file is deliberately NOT counted — a stray log or an
  # editor's scratch file is not work in progress, and `merge` does not touch it.
  echo "step: reusing worktree $wt"
  busy=$(git -C "$wt" status --porcelain --untracked-files=no 2>/dev/null)
  if [ -n "$busy" ]; then
    echo "step: worktree has modifications that are not this repair's — refusing"
    printf 'step: modified: %s\n' "$(printf '%s' "$busy" | sed 's/^...//' | tr '\n' ' ')"
    finish refused worktree-busy
  fi
else
  if ! git worktree add -q "$wt" "$branch" 2>/dev/null; then
    if ! git worktree add -q -b "$branch" "$wt" "origin/$branch" 2>/dev/null; then
      echo "plot-resolve-artifact: cannot create a worktree for $branch at $wt" >&2
      finish refused no-worktree
    fi
  fi
  echo "step: worktree $wt"
fi

# THE FIXED SEQUENCE. Five steps, no decision between them.

# 1. Merge. The conflict is EXPECTED — that is why we are here — so a non-zero
#    exit is not yet a failure. What decides is which paths came back
#    unmerged, checked next.
git -C "$wt" merge --no-edit "origin/$MAIN" >/dev/null 2>&1
merge_status=$?

if [ "$merge_status" -eq 0 ]; then
  # Nothing conflicted after all — the prediction was made from refs that have
  # since moved, which is the direction this repo already knows they move in.
  # The merge stands; there is nothing to repair and nothing to prove, so this
  # pushes nothing rather than pushing a merge nobody asked for.
  git -C "$wt" merge --abort >/dev/null 2>&1 || true
  git -C "$wt" reset -q --hard "HEAD" >/dev/null 2>&1 || true
  echo "step: no conflict on merge — nothing to repair"
  finish refused no-conflict
fi

# 2. VERIFY THE SET, HERE, AGAINST THE REAL MERGE.
#
# The board classified from `merge-tree`, which predicts IN MEMORY from the refs
# this machine holds. This is the merge itself, and it is the only place the set
# is a fact rather than a forecast — a stale ref makes the prediction wrong in
# the reassuring direction, so the entry condition is re-checked against reality
# before anything is written.
#
# The set is read once and asked TWO questions, in order: was anything observed
# at all, and — only then — was it exactly the artifact.
unmerged=$(git -C "$wt" diff --name-only --diff-filter=U)
n_unmerged=$(printf '%s\n' "$unmerged" | grep -c . || true)

# AN EMPTY SET IS NOT A SMALL SET — it is the absence of a reading.
#
# The merge exited non-zero, so something went wrong; but a conflict is not the
# only thing that ends a merge non-zero. A merge that never STARTED — refused
# because the worktree was dirty, because a merge was already in progress, or
# because the ref could not be resolved — exits non-zero too and leaves no
# unmerged paths behind. Zero paths therefore answers a different question than
# one or three do: those say WHICH files conflicted, zero says NOBODY LOOKED.
#
# Measured on 2026-08-17, and the defect this branch exists for: the resolver
# reused a worktree in which no merge was running, read zero paths, compared
# zero against one, and reported `not-artifact-only` — a name asserting
# something about files it had never examined. The refusal was right; its reason
# was wrong, and the wrong reason sent a reader looking for conflicts that did
# not exist.
#
# So the two refusals are named apart. `not-artifact-only` is a claim about an
# observed set and may only be said when there was one.
if [ "$n_unmerged" = "0" ]; then
  git -C "$wt" merge --abort >/dev/null 2>&1 || true
  echo "step: the merge reported failure but left no unmerged paths — nothing was observed"
  finish refused not-observed
fi

# EVERY unmerged path is a bundle: the conflict set is a SUBSET of the bundle
# set, and nothing else is in it. NOT "a bundle is among the conflicts" — an
# implementation asking that passes every bundle-only case and silently repairs
# merges that need judgement as a whole. The claim stayed exact when the list
# grew from one file to nine; only the thing each path is checked against
# changed. A merge conflicting in a bundle AND anything else still needs a
# person, even though one of its files does not.
#
# WALKED PER PATH rather than compared as a whole, because the conflict set is
# an arbitrary subset of nine and there is no single string to compare it to.
# The direction is what keeps it exact: every element of the observed set must
# appear in the licensed set, so an unlicensed path can only ever refuse.
outside=""
while IFS= read -r conflict; do
  [ -n "$conflict" ] || continue
  if ! printf '%s\n' "$ARTIFACT_PATHS" | grep -qxF -- "$conflict"; then
    outside="${outside}${outside:+ }$conflict"
  fi
done <<EOF
$unmerged
EOF

if [ -n "$outside" ]; then
  git -C "$wt" merge --abort >/dev/null 2>&1 || true
  echo "step: conflict set is not bundles only — refusing"
  printf 'step: unmerged: %s\n' "$(printf '%s' "$unmerged" | tr '\n' ' ')"
  printf 'step: outside the bundle set: %s\n' "$outside"
  finish refused not-artifact-only
fi

# 3. Take a side of EACH conflicted bundle. WHICH SIDE CANNOT MATTER — the
#    rebuild overwrites it — and the diff is never read. `--theirs` because the
#    command needs a word.
#
#    Only the paths that actually conflicted, never the whole set: a bundle git
#    merged cleanly has no side to take, and `checkout --theirs` on an unmerged-
#    stage-free path errors rather than doing nothing useful.
while IFS= read -r conflict; do
  [ -n "$conflict" ] || continue
  git -C "$wt" checkout --theirs -- "$conflict" 2>/dev/null \
    || git -C "$wt" checkout --ours -- "$conflict" 2>/dev/null \
    || true
  git -C "$wt" add -- "$conflict" 2>/dev/null || true
  echo "step: took a side of $conflict (either — the rebuild decides)"
done <<EOF
$unmerged
EOF

# 4. Rebuild, in the branch's OWN worktree. This is what makes the kept side
#    irrelevant, and it is the property CI's no-diff gate then re-checks.
if ! (cd "$wt" && pnpm build:board >/dev/null 2>&1); then
  git -C "$wt" merge --abort >/dev/null 2>&1 || true
  echo "step: rebuild failed — pushing nothing"
  finish abandoned build-failed
fi
# EVERY bundle is staged after the rebuild, not just the ones that conflicted.
# `pnpm build:board` regenerates all nine, and a rebuild triggered by one
# conflict can legitimately move another — the merge brought in source changes
# for the whole package. Staging only the conflicted paths would leave those
# modifications unstaged, and CI's no-diff gate would then fail the push for a
# file this run had already rebuilt correctly.
while IFS= read -r bundle; do
  [ -n "$bundle" ] || continue
  git -C "$wt" add -- "$bundle" 2>/dev/null || true
done <<EOF
$ARTIFACT_PATHS
EOF
printf 'step: rebuilt and staged %s bundle(s)\n' "$(printf '%s\n' "$ARTIFACT_PATHS" | grep -c .)"

# The merge commit exists only once the rebuild has produced the artifact it
# will carry. Committing before the build would leave a commit holding a stale
# artifact if the build then failed — exactly what CI's no-diff gate catches,
# arriving as a push instead of as a refusal.
if ! git -C "$wt" commit -q --no-edit 2>/dev/null; then
  echo "step: nothing to commit after the rebuild"
  finish abandoned nothing-to-commit
fi

# 5. THE GATE. Green in this worktree BEFORE the push, never CI after it.
#    A resolver that pushed and let CI decide passes every correctness check
#    above and manufactures a red PR in the queue — the exact stuck state this
#    plan exists to remove.
echo "step: running pnpm run test:board"
if ! (cd "$wt" && pnpm run test:board >/dev/null 2>&1); then
  # NOTHING IS PUSHED, and the merge is undone so the branch is left exactly as
  # it was found. A half-repaired branch would be a third state nobody named.
  git -C "$wt" reset -q --hard "HEAD~1" 2>/dev/null || true
  echo "step: test:board failed — pushing nothing, this is a conflict a human owns"
  finish abandoned tests-failed
fi
echo "step: test:board passed"

if ! git -C "$wt" push -q origin "HEAD:$branch" 2>/dev/null; then
  echo "step: push rejected — the branch moved under us; leaving the repair local"
  finish abandoned push-failed
fi

echo "step: pushed $branch"
finish pushed artifact-conflict-resolved
