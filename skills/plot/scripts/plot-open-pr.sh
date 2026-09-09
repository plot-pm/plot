#!/usr/bin/env bash
# The mechanical half of opening a slice's pull request: take the readings, ask
# the domain what to open, then open exactly that.
#
#   plot-open-pr.sh [<branch>] [--draft] [--dry-run] [--base <branch>]
#
# THE ACTION THAT HAD NO CONTROLLER. Measured 2026-09-08 against the nine
# endpoints the board exposes: four lifecycle actions were performed by hand
# that afternoon and each had a controller nobody called — and the fifth,
# opening a PR, had none to skip. Three were opened with `gh pr create`. The
# sprint before, fifteen branches carried finished work nobody could see,
# because no PR was raised at all.
#
# THE DOMAIN DECIDES, THIS PERFORMS. `openSlicePr` names four refusals and this
# script states none of its own about the slice: it measures, asks, and calls
# `plot-host.sh pr-create` with the title and body it was handed.
#
# THE TITLE COMES FROM THE PLAN, NOT FROM `git log -1`. A slice's identity is
# the wave heading the plan names it under; its last commit subject is whatever
# the agent happened to finish with, and on this estate that is routinely
# `plot: build the board artifact`. Measured 2026-09-09 while this branch was
# being written: a PR opened for it by hand took the title
# `the rule that decides a slice's PR` from the last commit — a sentence about
# one file, on a branch whose slice is about the action.
#
# IT NAMES A BRANCH CARRYING NO WORK AND OPENS IT ANYWAY. `a-merged-pr-carried-work`
# measured 60 merged PRs: seven carried nothing and only two were the defect,
# the other five being lifecycle PRs and claim PRs whose slice finished under a
# different PR. So the notice is a question in the body and never a refusal.
#
# ONE HOST CALL AND NO OTHERS. `pr-create` is `plot-host.sh`'s, which is the ONE
# place that talks to the host CLI — `scripts/check-host-cli-callers.sh` is the
# gate, and this script never names `gh` or `bb`.
set -uo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
bundle="$script_dir/board/plot-slice-pr.mjs"

usage() {
  echo "usage: plot-open-pr.sh [<branch>] [--draft] [--dry-run] [--base <branch>]" >&2
}

# EVERY BUNDLE IS TRACKED IN GIT, so this refusal fires on a broken installation
# and never on a normal run — which is where naming the build command is right.
[ -f "$bundle" ] \
  || { echo "plot-open-pr: cannot find $bundle — run 'pnpm build:board'." >&2; exit 1; }

branch=""
base=""
draft=0
dry_run=0
while [ $# -gt 0 ]; do
  case "$1" in
    --draft) draft=1; shift ;;
    --dry-run) dry_run=1; shift ;;
    --base) base="${2:-}"; shift 2 ;;
    -h|--help) usage; exit 0 ;;
    -*) usage; exit 2 ;;
    *) branch="$1"; shift ;;
  esac
done

git rev-parse --git-dir >/dev/null 2>&1 \
  || { echo "plot-open-pr: not a git repository" >&2; exit 1; }

[ -n "$branch" ] || branch=$(git branch --show-current 2>/dev/null || true)
[ -n "$branch" ] \
  || { echo "plot-open-pr: no branch given and HEAD is detached — name the branch" >&2; exit 1; }

repo_root="$(git rev-parse --show-toplevel)"
cfg() { bash "$script_dir/plot-config.sh" get "$1" "${2:-}"; }

[ -n "$base" ] || base=$(bash "$script_dir/plot-host.sh" default-branch 2>/dev/null || echo main)
[ -n "$base" ] || base=main

# WHICH PLAN NAMES THIS BRANCH, AND UNDER WHICH HEADING. `plot-plan-meta.sh` is
# the plan-format contract and answers both — the wave name is the title and the
# slug and file are the body's first line. A branch belongs to whichever plan
# lists it, and nothing else records that.
#
# THE PLAN DIRECTORY IS ASKED, NOT THE ACTIVE INDEX. Measured 2026-09-09 on this
# very branch: `the-master-agent-uses-the-controllers` is Approved and carries
# no `active/` symlink, so an index-scoped search found no plan and the rule
# refused a branch its plan names in full. `plot-reconcile-scan.sh` settled the
# same point — since the phase grouping became derived, a missing link is a
# browsing gap and gates nothing.
plan_dir=$(cfg "Plan directory" "docs/plans/")
case "$plan_dir" in /*) ;; *) plan_dir="$repo_root/$plan_dir" ;; esac

#
# THE CANDIDATES ARE GREPPED AND ONLY THEY ARE PARSED. Measured 2026-09-09:
# parsing all 253 plans here took 103 s, against 0.6 s for one `grep -l` over
# the directory and a parse of what it named. A branch name is a literal string
# and a plan that does not contain it cannot name it, so the filter cannot
# change the answer — only how many files are read to reach it.
plan_slug=""
plan_file=""
slice_name=""
candidates=$(grep -lF "$branch" "$plan_dir"*.md 2>/dev/null || true)
for link in $candidates; do
  [ -e "$link" ] || continue
  found=$(bash "$script_dir/plot-plan-meta.sh" "$link" 2>/dev/null \
    | PLOT_BRANCH="$branch" node -e '
      let s = "";
      process.stdin.on("data", (d) => (s += d)).on("end", () => {
        let meta;
        try { meta = JSON.parse(s); } catch { return; }
        const want = process.env.PLOT_BRANCH;
        for (const wave of meta.waves ?? []) {
          for (const b of wave.branches ?? []) {
            // The wave heading is the title, so a plan naming the branch under
            // no heading yields an empty name and the rule refuses on it.
            if (b.branch === want) { console.log([meta.file ?? "", wave.name ?? ""].join("\t")); return; }
          }
        }
      });
    ') || found=""
  if [ -n "$found" ]; then
    plan_file=$(printf '%s' "$found" | cut -f1)
    slice_name=$(printf '%s' "$found" | cut -f2)
    plan_slug=$(basename "$plan_file" .md | sed -E 's/^[0-9]{4}-[0-9]{2}-[0-9]{2}-//')
    break
  fi
done

# The brief, where the slice has one. Named for the branch's last segment, the
# spelling plot-dispatch.sh writes and the worker prompt reads.
brief="${branch##*/}"
brief_file=".plot/briefs/${brief}.md"
[ -f "$repo_root/$brief_file" ] || brief_file=""

# DOES A PR ALREADY CARRY THIS BRANCH? Asked of the host through the adapter, in
# ONE call over every state: an open PR and a merged one both mean this branch
# is already carried, and opening a second would give the fleet two answers.
# A host that cannot be asked answers 0 — the refusal it would raise is not one
# to raise on an outage, and the host itself refuses a duplicate PR.
existing_pr=0
pr_rows=$(bash "$script_dir/plot-host.sh" pr-list --state all --limit 200 2>/dev/null) || pr_rows=""
if [ -n "$pr_rows" ]; then
  existing_pr=$(printf '%s\n' "$pr_rows" | PLOT_BRANCH="$branch" node -e '
    let s = "";
    process.stdin.on("data", (d) => (s += d)).on("end", () => {
      const want = process.env.PLOT_BRANCH;
      for (const line of s.split("\n")) {
        if (!line.trim().startsWith("{")) continue;
        let row;
        try { row = JSON.parse(line); } catch { continue; }
        if (row.head === want) { console.log(row.number); return; }
      }
      console.log(0);
    });
  ' 2>/dev/null) || existing_pr=0
fi
[ -n "$existing_pr" ] || existing_pr=0

# HOW MANY COMMITS THE BRANCH HOLDS THAT ITS BASE DOES NOT, and whether they
# changed anything but a marker. The base is read from the remote where there is
# one: a stale local `main` reports commits the host would not.
base_ref="origin/$base"
git rev-parse --verify --quiet "$base_ref" >/dev/null 2>&1 || base_ref="$base"

commits=0
carried_work='"unknown"'
if git rev-parse --verify --quiet "$branch" >/dev/null 2>&1 \
  && git rev-parse --verify --quiet "$base_ref" >/dev/null 2>&1; then
  commits=$(git rev-list --count "$base_ref..$branch" 2>/dev/null || echo 0)
  # THE EXCLUSION IS `PLOT-BLOCKED*` AND NOTHING ELSE — the pair
  # `deliverability.ts`'s `isMarker` uses and `plot-reconcile-scan.sh`'s section
  # 17 already excludes. A documentation-only branch carried work: it is a slice
  # that wrote documentation. The claim commit needs no rule here because it is
  # empty and contributes no path.
  #
  # THE READING IS THE BRANCH, NOT A MERGE COMMIT, and that is the difference
  # from delivery's: at open time nothing has merged, so the range is the one
  # the PR would carry. A `git diff` that fails leaves `unknown`, which claims
  # nothing.
  if [ "$commits" -gt 0 ]; then
    if files=$(git diff --name-only "$base_ref...$branch" 2>/dev/null); then
      if printf '%s\n' "$files" | grep -qv '^PLOT-BLOCKED' 2>/dev/null; then
        carried_work=true
      else
        carried_work=false
      fi
    fi
  fi
fi

# ASK THE DOMAIN. JSON in, JSON out: the answer carries a markdown body, and a
# tab-separated wire would mean re-assembling a shape the rule just composed.
request=$(PLOT_BRANCH="$branch" PLOT_BASE="$base" PLOT_SLUG="$plan_slug" \
  PLOT_FILE="$plan_file" PLOT_SLICE="$slice_name" PLOT_BRIEF="$brief_file" \
  PLOT_PR="$existing_pr" PLOT_COMMITS="$commits" PLOT_WORK="$carried_work" \
  PLOT_DRAFT="$draft" node -e '
    const e = process.env;
    process.stdout.write(JSON.stringify({
      draft: e.PLOT_DRAFT === "1",
      readings: {
        branch: e.PLOT_BRANCH,
        base: e.PLOT_BASE,
        planSlug: e.PLOT_SLUG,
        planFile: e.PLOT_FILE,
        sliceName: e.PLOT_SLICE,
        briefFile: e.PLOT_BRIEF,
        existingPr: Number(e.PLOT_PR),
        commits: Number(e.PLOT_COMMITS),
        carriedWork: JSON.parse(e.PLOT_WORK),
      },
    }));
  ')

answer=$(printf '%s' "$request" | node "$bundle" 2>/tmp/plot-open-pr.$$.err)
rc=$?
err=$(cat "/tmp/plot-open-pr.$$.err" 2>/dev/null || true)
rm -f "/tmp/plot-open-pr.$$.err"

# Exit 1 is the domain's refusal: the rule that fired, a tab, and its sentence.
# Exit 2 is this script handing the bundle something unreadable, which no
# operator can act on — so it reports as the bug it is.
if [ "$rc" != 0 ]; then
  if [ "$rc" = 1 ]; then
    echo "plot-open-pr: $(printf '%s' "$err" | cut -f2-)" >&2
  else
    echo "plot-open-pr: $err" >&2
  fi
  exit 1
fi

title=$(printf '%s' "$answer" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>process.stdout.write(JSON.parse(s).title))')
body=$(printf '%s' "$answer" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>process.stdout.write(JSON.parse(s).body))')
notice=$(printf '%s' "$answer" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>process.stdout.write(JSON.parse(s).notice))')

# The notice goes to the operator too, not only into the body: a person running
# this reads their terminal, and the branch they just opened a PR for may be one
# they meant to finish first.
if [ "$notice" = "marker-only" ]; then
  echo "plot-open-pr: '$branch' carries no implementation outside a PLOT-BLOCKED marker — the PR says so." >&2
fi

if [ "$dry_run" = 1 ]; then
  printf '%s\n' "$answer"
  exit 0
fi

# PERFORM THE OPEN THE DOMAIN DECIDED, through the one place that talks to the
# host CLI. Nothing is composed here: the title and body are what came back.
args=(pr-create --title "$title" --body "$body" --base "$base" --head "$branch")
[ "$draft" = 1 ] && args+=(--draft)
bash "$script_dir/plot-host.sh" "${args[@]}"
