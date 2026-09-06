#!/usr/bin/env bash
# Plot record: note a commit that set a file to content the file already held.
#
# Wired as a git `post-commit` hook (installed by plot-install-commit-record.sh).
# POST-commit, so it can never block or refuse anything — which is the whole
# point while the cause is unknown. It observes and writes; it decides nothing.
#
# WHY A RECORD AND NOT A GATE. Three explanations of this defect have been
# proposed and all three disproved in sandboxes: that an agent's push leaves a
# session's files reading as modified (a remote commit moves neither tree nor
# HEAD); that a second session shares the checkout (a process sweep found one);
# and that a session stages, pulls, then commits (git refuses to pull with a
# dirty index, in both modes). A gate needs a condition, and every condition
# offered has died. So this writes evidence instead of refusing work, and it
# deliberately proposes no fourth explanation — the next occurrence is meant to
# answer for itself rather than arrive as a reconstruction three guesses deep.
#
# WHAT IT LOOKS FOR. For each file the commit MODIFIED, whether the blob just
# committed is one that same path already held in the recent history behind the
# commit's parent. That is the signature both measured incidents share: the
# committed blob was the session's own older content, landed on a parent that
# had moved on. An ordinary edit writes a blob the path never held, so it says
# nothing. Checked against both real incidents — it names all four reverted
# plan files and stays silent on the two genuine edits committed beside them.
#
# SILENCE IS THE NORMAL CASE. A commit with no such file writes nothing at all.
# A record every commit produces is a log nobody reads, and this signal is rare:
# twice in one session, and not since.
#
# IT IS CHEAP OR IT IS NOT WORTH HAVING. It runs on every commit in the
# repository, so it reads only what git already has: the commit's own
# name-status, and a depth-bounded history of the modified paths resolved in a
# single `cat-file --batch-check`. It never fetches, never shells to the host,
# and never walks the whole history. Measured on this repository: 0.34 s on a
# 26-file commit, the largest in the last 200; well under 100 ms for the one-
# to three-file commits that are the normal case.
#
# FAIL-SILENT. Any error leaves the commit alone and exits 0. A record that
# breaks a commit is worse than the defect it was built to observe.

set -uo pipefail

# --- fail-silent guard: a broken observer must never disturb a commit ---
trap 'exit 0' ERR

# How far back a path's own history is consulted. Both measured incidents
# matched two commits back; ten is margin, and costs the same as five because
# the lookup is one batched process either way.
DEPTH="${PLOT_COMMIT_RECORD_DEPTH:-10}"

# Days of records kept. A growing log needs a bound, and the unit is the DAY
# because that is how a forensic record is asked for — "what happened on
# 2026-09-06" — and because pruning whole days is one `rm` rather than a
# rewrite of a rolling file.
KEEP_DAYS="${PLOT_COMMIT_RECORD_KEEP_DAYS:-30}"

git rev-parse --git-dir >/dev/null 2>&1 || exit 0

head_sha=$(git rev-parse HEAD 2>/dev/null) || exit 0

# A root commit has no parent and therefore nothing to have moved under it.
parent_sha=$(git rev-parse --verify --quiet "${head_sha}^" 2>/dev/null) || exit 0
[ -n "$parent_sha" ] || exit 0

# Only MODIFIED paths can carry a revert; an added file held nothing before.
modified=$(git diff-tree --no-commit-id --name-status -r "$head_sha" 2>/dev/null \
  | awk -F'\t' '$1=="M"{print $2}') || exit 0
[ -n "$modified" ] || exit 0

# For each modified path: the blob just committed, and the blobs the path held
# across the bounded history behind the parent. Every rev for every path is
# resolved in ONE `cat-file` process — the per-commit `rev-parse` fork this
# replaced cost 3.0 s on a 26-file commit against 0.34 s for the batch.
#
# `%(objectname)` echoes a rev back when it cannot resolve one, so a path that
# did not exist in some older commit degrades to a non-match rather than to a
# false record.
plan=$(
  while IFS= read -r f; do
    [ -n "$f" ] || continue
    printf 'F\t%s\n' "$f"
    printf 'N\t%s\t%s:%s\n' "$f" "$head_sha" "$f"
    git rev-list --max-count="$DEPTH" "$parent_sha" -- "$f" 2>/dev/null \
      | while IFS= read -r c; do printf 'O\t%s\t%s\t%s:%s\n' "$f" "$c" "$c" "$f"; done
  done <<< "$modified"
) || exit 0

[ -n "$plan" ] || exit 0

# Resolve every rev named in the plan, in order, in one process.
blobs=$(
  printf '%s\n' "$plan" | awk -F'\t' '$1=="N"{print $3} $1=="O"{print $4}' \
    | git cat-file --batch-check='%(objectname)' 2>/dev/null
) || exit 0

# Walk the plan and the resolved blobs together; both are in the same order.
records=$(
  paste -d'\t' \
    <(printf '%s\n' "$plan" | awk -F'\t' '$1!="F"') \
    <(printf '%s\n' "$blobs") 2>/dev/null \
  | awk -F'\t' '
      $1=="N" { new[$2] = $NF; next }
      $1=="O" {
        b = $NF
        if (b != "" && b !~ / / && b !~ /missing/ && b == new[$2] && !(($2) in hit)) {
          hit[$2] = $3
        }
      }
      END { for (f in hit) printf "%s\t%s\t%s\n", f, new[f], hit[f] }
    '
) || exit 0

# Drop any path whose parent ALREADY held the committed content: nothing was
# undone there, so there is nothing to observe.
records=$(
  printf '%s\n' "$records" | while IFS=$'\t' read -r f new_blob match_commit; do
    [ -n "$f" ] || continue
    parent_blob=$(git rev-parse --verify --quiet "$parent_sha:$f" 2>/dev/null || true)
    [ "$parent_blob" = "$new_blob" ] && continue
    printf '%s\t%s\t%s\t%s\n' "$f" "$new_blob" "$parent_blob" "$match_commit"
  done
) || exit 0

[ -n "$records" ] || exit 0

# --- there is something to record ---

root=$(git rev-parse --show-toplevel 2>/dev/null) || exit 0
dir="$root/.plot/state/commit-records"
mkdir -p "$dir" 2>/dev/null || exit 0

day=$(date -u +%Y-%m-%d)
log="$dir/$day.jsonl"

# `origin/<main>` as it stands at this moment — read from the ref that is
# already local. NOT fetched: this runs on every commit, and the question is
# what the shared ref said when the commit was made, not what it says now.
# Every lookup here is allowed to fail: a repository with no remote must still
# get its record, and `symbolic-ref` exits non-zero exactly there. The `|| true`
# is what keeps the ERR trap from discarding a record already computed.
main_branch=$(git symbolic-ref --quiet --short refs/remotes/origin/HEAD 2>/dev/null || true)
main_branch="${main_branch#origin/}"
[ -n "$main_branch" ] || main_branch=main
origin_sha=$(git rev-parse --verify --quiet "refs/remotes/origin/$main_branch" 2>/dev/null || true)

esc() { printf '%s' "$1" | sed 's|\\|\\\\|g; s|"|\\"|g'; }

files_json=''
while IFS=$'\t' read -r f new_blob parent_blob match_commit; do
  [ -n "$f" ] || continue
  origin_blob=''
  if [ -n "$origin_sha" ]; then
    origin_blob=$(git rev-parse --verify --quiet "$origin_sha:$f" 2>/dev/null || true)
  fi
  entry=$(printf '{"path":"%s","committed":"%s","parent":"%s","heldBy":"%s","origin":"%s"}' \
    "$(esc "$f")" "$new_blob" "$parent_blob" "$match_commit" "$origin_blob")
  if [ -z "$files_json" ]; then files_json="$entry"; else files_json="$files_json,$entry"; fi
done <<< "$records"

[ -n "$files_json" ] || exit 0

printf '{"version":1,"at":"%s","commit":"%s","parent":"%s","originRef":"%s","origin":"%s","branch":"%s","files":[%s]}\n' \
  "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
  "$head_sha" "$parent_sha" \
  "$(esc "origin/$main_branch")" "$origin_sha" \
  "$(esc "$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo '')")" \
  "$files_json" >> "$log" 2>/dev/null || exit 0

# Prune whole days beyond the bound. Names sort lexically because they are
# ISO dates, so "everything past the newest N" is one list.
ls -1 "$dir" 2>/dev/null | grep -E '^[0-9]{4}-[0-9]{2}-[0-9]{2}\.jsonl$' | sort -r \
  | tail -n +$((KEEP_DAYS + 1)) \
  | while IFS= read -r old; do rm -f "$dir/$old" 2>/dev/null; done

# Say it once, on stderr, so the person committing sees it now rather than
# finding the file weeks later. The commit is already written; this is a note.
count=$(printf '%s\n' "$records" | grep -c . 2>/dev/null || echo 0)
printf 'plot: %s file(s) in %.8s were set to content the path already held — recorded in %s\n' \
  "$count" "$head_sha" "${log#"$root/"}" >&2

exit 0
