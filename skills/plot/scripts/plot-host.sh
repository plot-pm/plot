#!/usr/bin/env bash
# Plot helper: Git-host adapter — ONE interface over the host CLI, so every
# other helper and skill stays host-agnostic. GitHub (gh) and Bitbucket (bb)
# are supported; nothing outside this script may call gh or bb directly for
# the operations below.
#
# Usage: plot-host.sh <op> [args...]
#
# Ops (the ~6 operations plot actually needs):
#   backend                       print the resolved backend: github|bitbucket
#   default-branch                print the repo's default branch name
#   pr-state <number|branch> [--repo <owner/repo>]   one JSON object:
#                                   {"number":N,"state":"OPEN|MERGED|CLOSED|NONE",
#                                    "draft":true|false,"url":"..."}
#                                 NONE = no PR found (exit 0 — callers branch on
#                                 state, not exit codes)
#   pr-create --title T [--body B] [--base BR] [--head BR] [--draft]
#                                 create a PR, print its URL
#   pr-merge <number> [--squash] [--delete-branch]
#                                 merge the PR
#   pr-list [--state open|merged|closed|all] [--limit N] [--rich]
#                                 JSON lines: {"number":N,"title":"...",
#                                 "state":"...","head":"..."}
#                                 --rich adds: draft, checks, mergeable, review,
#                                 url, failing_checks — `failing_checks` names
#                                 WHICH checks failed, the detail `checks`
#                                 collapses to one word, from the same response
#                                 at no extra call; [] on bitbucket and wherever
#                                 nothing failed
#                                 — `url` so a consumer never has to
#                                 construct one (it is "" only if the host omits
#                                 it); `mergeable` is mergeable|conflicting|
#                                 unknown, and "unknown" is what a host that
#                                 cannot answer reports (absent is not false)
#                                 --limit raises the host CLI's default page of
#                                 30, which --state all exhausts immediately
#   runs <branch> [--limit N]     a branch's own recent CI runs, newest first,
#                                 as JSON lines: {"workflow":"CI",
#                                 "conclusion":"success|failure|…",
#                                 "startedAt":"…","url":"…"}
#                                 EVIDENCE, never a verdict — what proved the
#                                 2026-08-17 Playwright 403 transient was that
#                                 the same branch was green two minutes earlier,
#                                 and a real failure presents identically.
#                                 Nothing here compares runs or concludes.
#                                 METERED: ask only for a branch already known
#                                 to be failing. Empty on bitbucket (bb has no
#                                 run listing) — unavailable, never "never
#                                 failed".
#   pr-body <number> --body B     replace the PR description
#
# Backend resolution: $PLOT_HOST (github|bitbucket) wins — useful for tests —
# else the `Git host` key from `## Plot Config` (via plot-config.sh), default
# github. The bb CLI is any Bitbucket Cloud CLI exposing pr view/create/merge
# /list with --json (developed against https://bitbucket.org — adjust the
# mapping here if your bb differs; this file is the only place that knows).
#
# Documented degradations on bitbucket:
#   - no auto-merge / merge queues — pr-merge merges immediately or fails
#   - "closed" state is Bitbucket's DECLINED (normalized to CLOSED here)
#   - pr-state by BRANCH resolves via pr-list filtering (one extra call)
#   - draft flag support depends on the bb CLI version (--draft / --ready)
# Small-model consumption: structured output, no interpretation, exit 0 with
# state NONE rather than nonzero on lookup misses.

set -uo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

die() { echo "plot-host: $*" >&2; exit 1; }

# A LOOKUP MISS AND A TRANSPORT FAILURE ARE TWO ANSWERS, AND THE CLI GIVES ONE
# EXIT CODE FOR BOTH.
#
# Measured 2026-08-17, against a real `gh`:
#
#   gh pr view no-such-branch   → exit 1, stderr "no pull requests found for ..."
#   gh pr view 1 (host unreachable) → exit 1, stderr "none of the git remotes ..."
#
# So the exit code cannot decide it and stderr is the only place the difference
# survives. Before this, both fell into one `|| echo '{"state":"NONE"}'` — and
# the board, reading NONE with exit 0, could not tell "this branch has no PR"
# from "GitHub answered 503". On 2026-08-17 GitHub returned 503 all afternoon
# and every branch read as having no PR, which is the reassuring direction to be
# wrong in and therefore the worst one.
#
# The RULE, and the direction it fails in: a miss is recognised by its message,
# and everything else is a transport failure. An unrecognised miss-phrasing
# therefore reports "cannot ask" — noisy but honest — rather than "no PR",
# which would be silent and false. A blocklist here would go stale into silence
# the first time the CLI rewords itself.
#
# `LC_ALL=C` on the match: the CLI localises its messages, and a matcher that
# only works in English would silently reclassify every miss as an outage for
# anyone else.
is_lookup_miss() {
  LC_ALL=C grep -qiE 'no (pull request|pullrequest)s? (found|match)|could not find.*pull request|not found' <<<"$1"
}

# Emits the miss payload on a genuine miss and exits non-zero on anything else,
# after putting the CLI's own words on stderr. Callers get: stdout parseable or
# empty, exit code decisive.
# A FAILURE WITH NO DIAGNOSTIC AT ALL IS TREATED AS A MISS, and that is a
# deliberate exception to the allowlist above rather than an oversight.
#
# Three things can arrive here, not two:
#
#   a recognised miss phrasing  → miss    (the CLI said so)
#   an unrecognised message     → failure (something happened; report it)
#   NO message whatsoever       → miss    (this line)
#
# A transport failure is loud by nature — a socket error, an HTTP status, an
# auth message. Silence is what a lookup miss has always looked like through a
# CLI that does not explain itself, and `test/reconcile/host.test.mjs` has
# pinned that expectation since before this change. Reading empty stderr as an
# outage would give every caller of a quiet or wrapped CLI a permanent
# "cannot ask" for branches that simply have no PR.
#
# The cost is stated rather than hidden: a transport failure that manages to say
# nothing at all is still reported as NONE. That is the one case this change
# does not fix, and it is narrower than the one it does.
host_miss_or_fail() {
  local err="$1" payload="$2"
  if [ -z "$err" ] || is_lookup_miss "$err"; then
    echo "$payload"
    return 0
  fi
  echo "plot-host: $err" >&2
  return 3
}

# Bitbucket's --state vocabulary is not GitHub's, and this adapter used to
# translate in one direction only: every response mapper turns DECLINED into
# CLOSED, while the request carried the caller's GitHub word unchanged. `bb`
# then rejects `--state all` and `--state closed` outright, so every
# history-wide query failed with an invalid --state error.
#
# `all` becomes SEPARATE CALLS, not repeated flags. `bb` 1.0.0 accepts
# `--state open --state merged` and silently keeps only the last — measured
# 2026-08-18: that pair returned 50 PRs, all MERGED, with the 3 open ones
# gone. No error, a plausible list. One call per state avoids depending on a
# `bb` fix, and the three states partition the set (74 PRs, 74 unique ids,
# 0 duplicates on the repo measured).
#
# `superseded` is deliberately NOT part of `all`: such a PR is replaced by a
# newer one for the same branch, and a board with one row per branch would
# show that branch twice. `gh`'s `all` has no equivalent, so nothing is lost.
# A caller wanting it asks for it by name.
bb_states_for() {
  case "$1" in
    all)    printf 'open\nmerged\ndeclined\n' ;;
    closed) printf 'declined\n' ;;
    open|merged|declined|superseded) printf '%s\n' "$1" ;;
    *) die "unknown --state '$1' for the bitbucket backend (open|merged|closed|declined|superseded|all)" ;;
  esac
}

backend() {
  if [ -n "${PLOT_HOST:-}" ]; then
    case "$PLOT_HOST" in
      github|bitbucket) echo "$PLOT_HOST"; return ;;
      *) die "unknown PLOT_HOST '$PLOT_HOST' (github|bitbucket)" ;;
    esac
  fi
  local v
  v="$(bash "$here/plot-config.sh" get "Git host" "github" | tr '[:upper:]' '[:lower:]')"
  case "$v" in
    bitbucket|bb) echo "bitbucket" ;;
    *) echo "github" ;;
  esac
}

op="${1:-}"; [ -n "$op" ] || die "usage: plot-host.sh <op> [args...] (see header)"
shift
be="$(backend)" || exit 1

case "$op" in
  backend)
    echo "$be"
    ;;

  default-branch)
    if [ "$be" = "github" ]; then
      gh repo view --json defaultBranchRef --jq '.defaultBranchRef.name'
    else
      # Symbolic ref of origin/HEAD is host-neutral and offline; fall back to
      # the bb API only when the local clone has no origin/HEAD.
      git symbolic-ref --short refs/remotes/origin/HEAD 2>/dev/null | sed 's|^origin/||' \
        || bb repo view --json 2>/dev/null | jq -r '.mainbranch.name'
    fi
    ;;

  pr-state)
    ref="${1:?pr-state needs a PR number or branch}"; shift || true
    repo_args=()
    while [ $# -gt 0 ]; do
      case "$1" in
        --repo) repo_args=(-R "${2:?}"); shift 2 ;;
        *) die "pr-state: unknown arg $1" ;;
      esac
    done
    if [ "$be" = "github" ]; then
      # mergeCommit is what lets a caller ask "which release contains this?" —
      # `git tag --contains <sha>` answers exactly, where dates cannot. It is ""
      # for anything unmerged, which is the honest answer rather than a guess.
      if out="$(gh ${repo_args[@]+"${repo_args[@]}"} pr view "$ref" --json number,state,isDraft,url,mergeCommit 2>/tmp/plot-host-err.$$)"; then
        rm -f "/tmp/plot-host-err.$$"
        jq -c '{number:.number,state:.state,draft:.isDraft,url:.url,mergeCommit:(.mergeCommit.oid // "")}' <<<"$out"
      else
        err="$(cat "/tmp/plot-host-err.$$" 2>/dev/null)"; rm -f "/tmp/plot-host-err.$$"
        host_miss_or_fail "$err" \
          '{"number":0,"state":"NONE","draft":false,"url":"","mergeCommit":""}' || exit $?
      fi
    else
      if [[ "$ref" =~ ^[0-9]+$ ]]; then
        if out="$(bb ${repo_args[@]+"${repo_args[@]}"} pr view "$ref" --json 2>/tmp/plot-host-err.$$)"; then
          rm -f "/tmp/plot-host-err.$$"
          jq -c '{number:.id,state:(if .state=="DECLINED" then "CLOSED" else .state end),draft:(.draft // false),url:.links.html.href}' <<<"$out"
        else
          err="$(cat "/tmp/plot-host-err.$$" 2>/dev/null)"; rm -f "/tmp/plot-host-err.$$"
          host_miss_or_fail "$err" '{"number":0,"state":"NONE","draft":false,"url":""}' || exit $?
        fi
      else
        # The list CALL succeeding and the branch being absent FROM the list are
        # two different things, and only the second is a miss: an empty list that
        # arrived is evidence, an list that never arrived is not. The `jq` NONE
        # below is therefore kept (it reads a real answer) while the failure path
        # goes through `host_miss_or_fail` like the others.
        # One call per state, concatenated into a single JSON array before the
        # filter below runs — the filter takes the FIRST match, so the states
        # are walked newest-relevant first: an open PR for a branch outranks a
        # merged one, which outranks a declined one.
        out=""; bb_rc=0
        bb_all_states="$(bb_states_for all)" || exit 1
        for _s in $bb_all_states; do
          if _part="$(bb ${repo_args[@]+"${repo_args[@]}"} pr list --state "$_s" --json 2>/tmp/plot-host-err.$$)"; then
            out="$out$_part"
          else
            bb_rc=1; break
          fi
        done
        if [ "$bb_rc" = 0 ]; then
          rm -f "/tmp/plot-host-err.$$"
          out="$(jq -c -s 'add // []' <<<"$out")"
          jq -c --arg b "$ref" '[.[] | select(.source.branch.name==$b)][0] // null
               | if .==null then {number:0,state:"NONE",draft:false,url:""}
                 else {number:.id,state:(if .state=="DECLINED" then "CLOSED" else .state end),draft:(.draft // false),url:.links.html.href} end' <<<"$out"
        else
          err="$(cat "/tmp/plot-host-err.$$" 2>/dev/null)"; rm -f "/tmp/plot-host-err.$$"
          host_miss_or_fail "$err" '{"number":0,"state":"NONE","draft":false,"url":""}' || exit $?
        fi
      fi
    fi
    ;;

  pr-create)
    title=""; body=""; base=""; head=""; draft=0
    while [ $# -gt 0 ]; do
      case "$1" in
        --title) title="${2:?}"; shift 2 ;;
        --body)  body="${2:?}";  shift 2 ;;
        --base)  base="${2:?}";  shift 2 ;;
        --head)  head="${2:?}";  shift 2 ;;
        --draft) draft=1; shift ;;
        *) die "pr-create: unknown arg $1" ;;
      esac
    done
    [ -n "$title" ] || die "pr-create needs --title"
    if [ "$be" = "github" ]; then
      args=(pr create --title "$title" --body "$body")
      [ -n "$base" ] && args+=(--base "$base")
      [ -n "$head" ] && args+=(--head "$head")
      [ "$draft" = 1 ] && args+=(--draft)
      gh "${args[@]}"
    else
      args=(pr create --title "$title" --body "$body")
      [ -n "$base" ] && args+=(--base "$base")
      [ -n "$head" ] && args+=(--head "$head")
      [ "$draft" = 1 ] && args+=(--draft)
      bb "${args[@]}"
    fi
    ;;

  pr-merge)
    num="${1:?pr-merge needs a PR number}"; shift
    squash=0; delbranch=0
    while [ $# -gt 0 ]; do
      case "$1" in
        --squash) squash=1; shift ;;
        --delete-branch) delbranch=1; shift ;;
        *) die "pr-merge: unknown arg $1" ;;
      esac
    done
    if [ "$be" = "github" ]; then
      args=(pr merge "$num")
      [ "$squash" = 1 ] && args+=(--squash) || args+=(--merge)
      [ "$delbranch" = 1 ] && args+=(--delete-branch)
      gh "${args[@]}"
    else
      args=(pr merge "$num")
      [ "$squash" = 1 ] && args+=(--squash)
      [ "$delbranch" = 1 ] && args+=(--delete-branch)
      bb "${args[@]}"
    fi
    ;;

  pr-list)
    state="open"
    rich=0
    # `gh pr list` and `bb pr list` both cap at 30 by default. That is invisible
    # with --state open (few repos have 30 open PRs) and bites immediately with
    # --state all, where the newest 30 crowd out every older merged PR. A caller
    # that wants history says how much; the default stays the host's, so no
    # existing caller's result changes.
    limit=""
    while [ $# -gt 0 ]; do
      case "$1" in
        --state) state="${2:?}"; shift 2 ;;
        --limit) limit="${2:?}"; shift 2 ;;
        --rich) rich=1; shift ;;
        *) die "pr-list: unknown arg $1" ;;
      esac
    done
    limit_args=()
    [ -n "$limit" ] && limit_args=(--limit "$limit")
    if [ "$be" = "github" ]; then
      if [ "$rich" = 1 ]; then
        # `checks` has FOUR states, and two of them mean "a person is the
        # blocker" rather than "a machine is busy":
        #
        #   none     — empty rollup. GitHub starts no workflows for bot PRs
        #              until a human approves the run. Reporting this as pending
        #              would show CI running while nothing runs, and nobody
        #              would look.
        #   failing  — includes ACTION_REQUIRED, which is the same situation
        #              seen from the other side: the run exists but waits on a
        #              human. It is deliberately NOT pending.
        #   pending  — genuinely queued or in progress. Only this one means a
        #              machine is working.
        #   green    — everything concluded successfully.
        #
        # One red check among green ones counts red: `any` is checked before
        # the pending branch, so a mixed rollup never reads as "still running".
        #
        # `mergeable` is a SEPARATE question from `checks`, and asking it is
        # what lets a consumer tell two situations apart that look identical
        # through `checks` alone. GitHub starts no workflow for a PR that does
        # not merge cleanly, so a conflicting PR reports an EMPTY rollup —
        # `checks:"none"`, exactly like a bot PR whose run awaits a human click.
        # One wants a rebase, the other wants a click, and `checks` cannot say
        # which. Measured on PR #149 and #160: `mergeable=CONFLICTING`,
        # `mergeStateStatus=DIRTY`, `statusCheckRollup` genuinely empty.
        #
        # Three values, and `unknown` is a real answer rather than a gap in the
        # data: GitHub computes mergeability lazily, so a PR opened seconds ago
        # legitimately reports UNKNOWN until the background job finishes. A
        # consumer must not read that as clean.
        #
        # `mergeStateStatus` is consulted only to CORROBORATE — DIRTY is its
        # word for the same conflict — and never to overrule: it needs a scope
        # some tokens lack and is absent for them, where `mergeable` is not.
        #
        # `review` stays informational: a repo that does not review through the
        # host emits "" here, and no consumer may turn that into a gate.
        # `url` comes from the host, never from a consumer. A board or a report
        # that templated github.com from a config key would produce a plausible
        # link and a wrong one for GitHub Enterprise or self-hosted Bitbucket —
        # this script is the ONE place that knows what a host URL looks like
        # (Principle 3), and pr-state already reads it from exactly here.
        #
        # `failing_checks` is WHICH checks failed, by name — the same payload
        # `checks` collapses to one word, kept rather than thrown away.
        #
        # `checks:"failing"` names a symptom and withholds which machine
        # produced it. On 2026-08-17 a markdown-only branch failed `validate`
        # because the Playwright CDN answered `403 — this service is not
        # available in your location`, and reaching that sentence took ten
        # minutes of opening logs, from a row that already held the check name
        # and did not say it.
        #
        # NAMES ONLY, and nothing here interprets them. A heuristic mapping a
        # failing check to the paths a branch changed was explicitly rejected:
        # that table is unmaintained by construction and goes silently wrong the
        # first time a workflow is restructured. Principle 3 — this collects, a
        # human concludes.
        #
        # Free: same GraphQL response, same call, no extra request.
        gh pr list --state "$state" ${limit_args[@]+"${limit_args[@]}"} \
          --json number,title,state,headRefName,isDraft,statusCheckRollup,mergeable,mergeStateStatus,reviewDecision,url \
          | jq -c '.[] | {
              number:.number, title:.title, state:.state, head:.headRefName,
              draft:.isDraft,
              checks:(
                if (.statusCheckRollup|length) == 0 then "none"
                elif any(.statusCheckRollup[]; (if (.conclusion // "") != "" then .conclusion else (.status // .state) end) as $c
                         | $c=="FAILURE" or $c=="ERROR" or $c=="CANCELLED"
                           or $c=="TIMED_OUT" or $c=="ACTION_REQUIRED") then "failing"
                elif any(.statusCheckRollup[]; (if (.conclusion // "") != "" then .conclusion else (.status // .state) end) as $c
                         | $c=="PENDING" or $c=="IN_PROGRESS" or $c=="QUEUED"
                           or $c=="WAITING" or $c==null) then "pending"
                else "green" end),
              mergeable:(
                if .mergeable=="CONFLICTING" or .mergeStateStatus=="DIRTY" then "conflicting"
                elif .mergeable=="MERGEABLE" then "mergeable"
                else "unknown" end),
              review:(.reviewDecision // ""),
              url:.url,
              failing_checks:[
                .statusCheckRollup[]? | select((if (.conclusion // "") != "" then .conclusion else (.status // .state) end) as $c
                  | $c=="FAILURE" or $c=="ERROR" or $c=="CANCELLED"
                    or $c=="TIMED_OUT" or $c=="ACTION_REQUIRED")
                | (.name // .context // "")] | map(select(. != ""))
            }'
      else
        gh pr list --state "$state" ${limit_args[@]+"${limit_args[@]}"} \
          --json number,title,state,headRefName \
          | jq -c '.[] | {number:.number,title:.title,state:.state,head:.headRefName}'
      fi
    else
      # Bitbucket carries no check rollup through `bb pr list`, and no
      # mergeability verdict either. Rather than guess, --rich reports
      # checks:"unknown" and mergeable:"unknown" — a consumer must render those
      # as "unavailable", never as green and never as clean. An honest gap beats
      # an invented answer, and absent is not false.
      # `bb pr list` has no --limit: it returns a fixed page (50 at 1.0.0).
      # Forwarding it errors with `unknown flag`, and dropping it silently
      # would serve a short page as if it were the whole set — the quiet wrong
      # answer this adapter refuses elsewhere. So it is dropped AND said.
      if [ -n "$limit" ]; then
        echo "plot-host: bitbucket ignores --limit $limit; bb returns a fixed page (50 at 1.0.0)" >&2
      fi
      # Resolve the states BEFORE the loop. `for s in $(bb_states_for …)` runs
      # the helper in a subshell, where `die` exits that subshell only: the
      # loop would then iterate an empty list and the command would succeed
      # with no output — an unknown state reading as "no PRs matched", which
      # is the exact failure this translation exists to remove.
      bb_states="$(bb_states_for "$state")" || exit 1
      if [ "$rich" = 1 ]; then
        for _s in $bb_states; do
          bb pr list --state "$_s" --json \
            | jq -c '.[] | {number:.id,title:.title,state:(if .state=="DECLINED" then "CLOSED" else .state end),head:.source.branch.name,draft:(.draft // false),checks:"unknown",mergeable:"unknown",review:"",url:(.links.html.href // ""),failing_checks:[]}'
        done
      else
        for _s in $bb_states; do
          bb pr list --state "$_s" --json \
            | jq -c '.[] | {number:.id,title:.title,state:(if .state=="DECLINED" then "CLOSED" else .state end),head:.source.branch.name}'
        done
      fi
    fi
    ;;

  runs)
    # A branch's OWN recent CI runs, newest first — the third line of the
    # evidence a failing check is reported with.
    #
    # Why it matters, measured: on 2026-08-17 a `403` from the Playwright CDN
    # failed a markdown-only branch, and what proved it transient was the run
    # history — the same branch was green two minutes earlier. A real failure
    # presents identically in every other respect, which is exactly why this
    # reports the history and draws no conclusion from it.
    #
    # FACTS, NEVER A VERDICT. No rule here compares runs, decides "transient",
    # or reruns anything. The plan calls the shape *foreign* deliberately: this
    # collects, a human concludes (Principle 3).
    #
    # METERED, so callers must ask only where the question arises — a branch
    # whose PR is already known to be failing. One REST call per such branch,
    # and failing branches are rare by construction; a caller that asked for
    # every branch would spend a budget the board has already exhausted once.
    #
    # Bitbucket reports nothing here rather than something invented. `bb` has no
    # run listing, and an empty history renders as "unavailable" — never as
    # "this branch has never failed before".
    branch="${1:?runs needs a branch}"; shift
    limit=10
    while [ $# -gt 0 ]; do
      case "$1" in
        --limit) limit="${2:?}"; shift 2 ;;
        *) die "runs: unknown arg $1" ;;
      esac
    done
    if [ "$be" = "github" ]; then
      gh run list --branch "$branch" --limit "$limit" \
        --json workflowName,conclusion,status,startedAt,url 2>/dev/null \
        | jq -c '.[] | {workflow:.workflowName,
                        conclusion:(if (.conclusion // "") == "" then .status else .conclusion end),
                        startedAt:.startedAt, url:.url}' 2>/dev/null || true
    fi
    ;;

  pr-body)
    num="${1:?pr-body needs a PR number}"; shift
    body=""
    while [ $# -gt 0 ]; do
      case "$1" in
        --body) body="${2:?}"; shift 2 ;;
        *) die "pr-body: unknown arg $1" ;;
      esac
    done
    [ -n "$body" ] || die "pr-body needs --body"
    if [ "$be" = "github" ]; then
      gh pr edit "$num" --body "$body"
    else
      bb pr edit "$num" --body "$body"
    fi
    ;;

  *)
    die "unknown op '$op' (backend|default-branch|pr-state|pr-create|pr-merge|pr-list|pr-body)"
    ;;
esac
