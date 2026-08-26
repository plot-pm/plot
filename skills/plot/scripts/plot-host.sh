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
#   pr-ready <number>              take a PR out of draft
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
#   issue-list [--limit N]        open tracker issues as JSON lines:
#                                 {"number":N,"title":"…","url":"…",
#                                  "createdAt":"…"}
#                                 READ-ONLY, and the only issue op here: Plot
#                                 never writes to the tracker (no labels, no
#                                 assignees, no close-on-merge), because a copy
#                                 of tracker state ages into a lie.
#                                 `url` is "" when the host omits it, and a
#                                 consumer renders the number as plain text
#                                 rather than inventing an address — the rule
#                                 pr-list's `url` already follows. On bitbucket
#                                 `url` and `createdAt` are BOTH "": `bb issue
#                                 list` prints neither.
#                                 BITBUCKET NOW ANSWERS by parsing `bb issue
#                                 list` (no --json), pinned to bb 0.6.0. EXIT 4
#                                 narrows rather than disappears: it is the
#                                 tracker-DISABLED case (bb answers 404/410),
#                                 which stays *this host cannot answer* where an
#                                 empty list would say *there are none*. A call
#                                 that failed on an enabled tracker, or any error
#                                 wording this adapter does not recognise, exits
#                                 3 — guessing 4 would turn a broken call into a
#                                 confident "no tickets". A failed lookup exits
#                                 non-zero with an empty stdout, never a silent
#                                 empty list — an outage is not an answer.
#   issue-view <number>           ONE open issue as a single JSON object:
#                                 {"number":N,"title":"…","body":"…","url":"…"}
#                                 STILL READ-ONLY — the second issue op, and it
#                                 reads. The board's *Create plan* action needs
#                                 the issue's BODY as the problem statement, and
#                                 issue-list deliberately omits it: the list is
#                                 asked on a timer for every open issue, and a
#                                 body per issue per refresh is a cost the row
#                                 does not need to decide *is this worth a plan?*
#                                 So the body is fetched once, per click, for the
#                                 one issue somebody chose — a call whose cadence
#                                 is a human's.
#                                 Same three outcomes as issue-list, same codes:
#                                 BITBUCKET NOW ANSWERS via `bb issue view`
#                                 (pinned to 0.6.0); `url` comes from the view's
#                                 footer. EXIT 4 is the tracker-DISABLED case,
#                                 EXIT 3 a lookup that failed or an unrecognised
#                                 error. An issue that does not exist is a
#                                 FAILURE here, not an empty body: the caller
#                                 named a number it read off this same adapter,
#                                 so its absence is a fact worth surfacing rather
#                                 than a blank to plan on.
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

# --- Bitbucket issue support (bb issue list / view) -------------------------
#
# `bb` gained issue commands, and this adapter refused them for a year on the
# strength of a message that was true when written and stopped being true after
# an upstream release. The two ops now ANSWER for Bitbucket by parsing `bb`'s
# text — it has no `--json` for issues — and the parse is DECLARED against the
# format it targets so a column reshuffle upstream fails loudly rather than
# mis-reading a title.
#
# Everything below was MEASURED against the installed CLI on 2026-08-26:
#
#   $ bb --version   → bb version 0.6.0
#   $ bb issue list  (row)  #%03d <STATE>  <title>   by <reporter>
#   $ bb issue list  (head)  :: Showing N of M issues in ORG/SLUG
#   $ bb issue view  (line 1, bold) <title>
#   $ bb issue list  (error) An error occurred: <message>   ← on STDOUT, ANSI
#
# The format is craftamap/bb's, read from its source at the 0.6.0 tag
# (cmd/commands/issue/{list,view}): the row is printed with literal spaces, not
# a tabwriter, and the ID is zero-padded to three digits.
BB_ISSUE_VERSION="0.6.0"

# Strip ANSI SGR escapes. `bb` colours everything — the ID green, the state
# badge on a coloured background, the reporter grey — and an unstripped line
# carries `\033[...m` runs that would land inside a parsed title. `bb` also
# writes its ERRORS coloured, on stdout, so the same stripper runs before the
# error text is matched: an ANSI-wrapped "An error occurred" must be recognised
# as an error, not parsed as an issue (the trap the GitHub arm's stdout-is-data
# shape walks straight into).
bb_strip_ansi() {
  # ESC [ ... <final-byte>. LC_ALL=C so the byte class is bytes, not locale
  # graphemes — the escape is 7-bit regardless of the title's encoding.
  LC_ALL=C sed $'s/\033\\[[0-9;]*[A-Za-z]//g'
}

# `bb` prints failure as `... An error occurred: <message>` on STDOUT and exits
# 1 for EVERYTHING — a disabled tracker, a network outage, "Are you sure this is
# a bitbucket repo?". The exit code cannot split them, so this matches the
# WORDING, and the split falls one way only:
#
#   recognised "tracker cannot be asked" wording → exit 4 (cannot be asked)
#   ANY other error text                         → exit 3 (the call failed)
#
# Guessing 4 from an unrecognised message would turn a broken call into a
# confident "you have no tickets" — the exact failure this branch exists to fix
# — so an unrecognised error MUST be 3. Bitbucket answers 404/410 for a repo
# whose issue tracker is disabled (and for a repo that is not a Bitbucket repo
# at all); both are *this host cannot be asked about issues*, which is what 4
# means. Reads the already-stripped, already-lowercased error text.
bb_issue_exit_code() {
  local err="$1"
  if LC_ALL=C grep -qiE 'are you sure this is a bitbucket repo|\b40[34]\b|not found|no issue tracker|issue tracker.*(disabled|not enabled)|repository not found' <<<"$err"; then
    echo 4
  else
    echo 3
  fi
}

# Assert the format the parse below was written against. `bb` puts its version
# on stdout as `bb version X.Y.Z (sha)`; a version this parse was not tested on
# fails LOUDLY rather than silently mis-reading a column that may have moved.
# `PLOT_BB_SKIP_VERSION_CHECK` exists for the test harness, whose stub bb has no
# meaningful version — the parse is exercised against captured fixture text.
bb_assert_issue_version() {
  [ -n "${PLOT_BB_SKIP_VERSION_CHECK:-}" ] && return 0
  local v
  v="$(bb --version 2>/dev/null | bb_strip_ansi | grep -oE '[0-9]+\.[0-9]+\.[0-9]+' | head -1)"
  if [ "$v" != "$BB_ISSUE_VERSION" ]; then
    echo "plot-host: bb issue parse targets $BB_ISSUE_VERSION but found '${v:-unknown}' — refusing to mis-read a format that may have moved" >&2
    return 3
  fi
  return 0
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
        # One call per state, walked newest-relevant first: an open PR for a
        # branch outranks a merged one, which outranks a declined one.
        #
        # STOP AT THE FIRST STATE THAT ANSWERS. Because the ordering already
        # decides the winner, a later state can never overturn an earlier one —
        # so asking for it is pure cost. And the cost is not small: measured
        # against a real Bitbucket on 2026-08-18, one `bb` call takes ~10s, so
        # walking all three unconditionally made every branch lookup ~26s. The
        # board's fleet scan calls this once per branch and exceeded its own
        # timeout on a five-branch plan.
        #
        # A declined-only or PR-less branch still pays for all three; those are
        # the cases where the third call is the one carrying the answer.
        out=""; bb_rc=0
        bb_all_states="$(bb_states_for all)" || exit 1
        for _s in $bb_all_states; do
          if _part="$(bb ${repo_args[@]+"${repo_args[@]}"} pr list --state "$_s" --json 2>/tmp/plot-host-err.$$)"; then
            out="$out$_part"
            # `jq -e` exits non-zero on null/false, so this asks "did this state
            # contain the branch?" without a second parse of the whole page.
            if jq -e --arg b "$ref" 'any(.[]; .source.branch.name==$b)' >/dev/null 2>&1 <<<"$_part"; then
              break
            fi
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

  pr-ready)
    # TAKE A PR OUT OF DRAFT. One call, and the ONE place that talks to the host
    # CLI keeps that property — `plot-approve.sh` needs this before it merges,
    # and reaching for `gh` there would put a second host caller in the estate.
    #
    # Bitbucket's support depends on the bb CLI version (see the caveat list at
    # the top of this file, which already names `--draft`/`--ready`), so a
    # failure here surfaces as the CLI's own message rather than being
    # swallowed: the caller must be able to tell *the host refused* from *the
    # PR is now ready*.
    num="${1:?pr-ready needs a PR number}"; shift
    if [ "$be" = "github" ]; then
      gh pr ready "$num"
    else
      bb pr update "$num" --ready
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

  issue-list)
    # Open tracker issues — the board's inbox, and READ-ONLY in both
    # directions. Nothing here writes a label, an assignee or a close: the
    # manifesto keeps issues as signals rather than commitments, and a mirror
    # of tracker state is the copy that ages into a lie.
    #
    # THREE OUTCOMES, KEPT APART. An empty list means the host answered and
    # there are none; a non-zero exit with empty stdout means the question
    # failed; exit 4 means this host cannot be asked at all. Collapsing any two
    # of them reproduces `an-outage-is-not-an-answer` — a board that says "no
    # issues" because it could not reach the tracker is stating a fact it does
    # not have.
    limit=""
    while [ $# -gt 0 ]; do
      case "$1" in
        --limit) limit="${2:?}"; shift 2 ;;
        *) die "issue-list: unknown arg $1" ;;
      esac
    done
    limit_args=()
    [ -n "$limit" ] && limit_args=(--limit "$limit")
    if [ "$be" = "github" ]; then
      # `gh issue list` — not `gh api /issues`. On GitHub every PR IS an issue,
      # so the REST endpoint returns both, and every open PR would arrive here
      # as a signal nobody had planned. The `gh` subcommand filters PRs out;
      # this note exists because that trap is invisible while it works.
      if out="$(gh issue list --state open ${limit_args[@]+"${limit_args[@]}"} \
                  --json number,title,url,createdAt 2>/tmp/plot-host-err.$$)"; then
        rm -f "/tmp/plot-host-err.$$"
        jq -c '.[] | {number:.number,title:.title,url:(.url // ""),createdAt:(.createdAt // "")}' <<<"$out"
      else
        err="$(cat "/tmp/plot-host-err.$$" 2>/dev/null)"; rm -f "/tmp/plot-host-err.$$"
        # NO empty-list fallback. `host_miss_or_fail` exists for a lookup whose
        # subject is absent — one PR that does not exist. A LIST has no absent
        # subject: if the call failed, the answer is unknown, and printing
        # nothing while exiting non-zero is what says so.
        echo "plot-host: $err" >&2
        exit 3
      fi
    else
      # `bb issue list` — measured against bb 0.6.0. Three things the GitHub arm
      # cannot be copied for, each invisible while it works (see the helpers up
      # top): (1) `bb` prints errors to STDOUT, so stdout is NOT unconditionally
      # data; (2) it has no `--limit`, so the caller's bound is honoured HERE,
      # after parsing; (3) the list carries no per-issue URL, so `url` is "" —
      # the same answer the header documents for a host that omits it.
      bb_assert_issue_version || exit $?
      # `--state new,open` is bb's own default for `issue list` and is what
      # "open tracker issues" means; stated explicitly so a bb default change
      # cannot silently widen it. bb has no `all` for issues, so this is ONE
      # call (the request-budget comment in fleet.ts counts exactly this).
      raw="$(bb issue list --state new --state open 2>&1)"; rc=$?
      raw="$(bb_strip_ansi <<<"$raw")"
      if [ "$rc" -ne 0 ]; then
        # bb's error is on stdout, now folded into `raw`. Report it and choose
        # 4-vs-3 from its wording — never parse it as an issue (Done-when 6).
        echo "plot-host: $raw" >&2
        exit "$(bb_issue_exit_code "$(tr '[:upper:]' '[:lower:]' <<<"$raw")")"
      fi
      # A row is `#NNN <STATE> <title>   by <reporter>`. Anchor on the `#NNN`
      # prefix (the header line ` :: Showing …` has none and is skipped for
      # free), lift the number, strip the known state badge word, then drop the
      # trailing `   by <reporter>` on its three-space separator. The state
      # vocabulary is bb 0.6.0's issue states — pinned by the version assert.
      count=0
      while IFS= read -r line; do
        [[ "$line" =~ ^#0*([0-9]+)[[:space:]]+(.*)$ ]] || continue
        num="${BASH_REMATCH[1]}"
        rest="${BASH_REMATCH[2]}"
        # Strip the leading state badge word (NEW/OPEN/RESOLVED/…) and its
        # padding; the title starts after it.
        rest="$(sed -E 's/^(NEW|OPEN|ON HOLD|INVALID|RESOLVED|DUPLICATE|WONTFIX|CLOSED)[[:space:]]+//' <<<"$rest")"
        # Drop the trailing reporter: bb prints three spaces then `by <name>`.
        title="$(sed -E 's/[[:space:]]{2,}by [^[:space:]].*$//' <<<"$rest")"
        # `url` is "" — bb issue list prints none; a consumer renders the number
        # as plain text, the rule the header states.
        jq -cn --argjson number "$num" --arg title "$title" \
          '{number:$number,title:$title,url:"",createdAt:""}'
        count=$((count + 1))
        # Honour the caller's --limit HERE: bb has no --limit, so a bound the
        # caller asked for is enforced by the adapter after parsing (Done-when 7).
        if [ -n "$limit" ] && [ "$count" -ge "$limit" ]; then
          break
        fi
      done <<<"$raw"
    fi
    ;;

  issue-view)
    # ONE issue, with its body — the problem statement the board hands to
    # /plot-idea. Read-only, exactly as issue-list is: nothing here writes a
    # comment, a label or a state, because a plan referencing an issue is
    # Plot's record and not the tracker's.
    #
    # The three outcomes stay apart for the reason issue-list states, and the
    # exit codes are deliberately THE SAME ONES — a consumer that already maps
    # 4 to `unsupported` and anything else to `failed` must not need a second
    # table to read this op.
    num="${1:?issue-view needs an issue number}"; shift
    if [ "$be" = "github" ]; then
      if out="$(gh issue view "$num" --json number,title,body,url 2>/tmp/plot-host-err.$$)"; then
        rm -f "/tmp/plot-host-err.$$"
        jq -c '{number:.number,title:(.title // ""),body:(.body // ""),url:(.url // "")}' <<<"$out"
      else
        err="$(cat "/tmp/plot-host-err.$$" 2>/dev/null)"; rm -f "/tmp/plot-host-err.$$"
        # NO miss/fail split here, and that is deliberate. `host_miss_or_fail`
        # exists where an absent subject is a NORMAL answer — a branch with no
        # PR. An issue number reaching this op was read off `issue-list`
        # moments earlier, so "it does not exist" is not a normal answer: it
        # means the tracker moved under the board. Both shapes exit non-zero
        # with the CLI's own words, so the caller says *could not be read*
        # rather than planning against an empty body.
        echo "plot-host: $err" >&2
        exit 3
      fi
    else
      # `bb issue view <n>` — measured against bb 0.6.0. The output, once ANSI
      # is stripped, is:
      #
      #   <title>
      #   <STATE> • <reporter> opened <createdOn>
      #   Type: … • Priority: … • Assignee: …
      #   [Component/Milestone/Version — conditional]
      #   <body, rendered markdown, possibly many lines>
      #   [comments…]
      #   View this issue on Bitbucket.org: <url>
      #
      # The same error discipline as issue-list: bb writes failures to stdout
      # and exits 1 for everything, so match the wording for 4-vs-3 and never
      # parse an error as an issue.
      bb_assert_issue_version || exit $?
      raw="$(bb issue view "$num" 2>&1)"; rc=$?
      raw="$(bb_strip_ansi <<<"$raw")"
      if [ "$rc" -ne 0 ]; then
        echo "plot-host: $raw" >&2
        exit "$(bb_issue_exit_code "$(tr '[:upper:]' '[:lower:]' <<<"$raw")")"
      fi
      # Title is the first line. URL is lifted from the footer, which is bb's
      # only place that prints one for a viewed issue — so the contract's `url`
      # is real here even though issue-list's is "".
      title="$(sed -n '1p' <<<"$raw")"
      url="$(grep -oE 'https?://[^[:space:]]+' <<<"$(grep -F 'View this issue on Bitbucket' <<<"$raw")" | head -1)"
      # Body is the block between the metadata head and the footer. The head is
      # the title + the two fixed meta lines (state, Type:) plus an optional
      # Component/Milestone/Version line; the tail is the footer. This is the
      # problem statement /plot-idea receives, read once per human click. It is
      # a best-effort lift of rendered markdown, not a byte-exact round-trip:
      # bb has no --json for issues, so the version pin is what keeps it honest.
      body="$(awk '
        NR==1 { next }                                   # title
        NR==2 { next }                                   # state • reporter
        /^Type: / { seen_type=1; next }                  # Type/Priority/Assignee
        /^(Component|Milestone|Version): / && !started { next }
        /^View this issue on Bitbucket/ { exit }         # footer ends the body
        { started=1; print }
      ' <<<"$raw" | sed -e 's/[[:space:]]*$//' )"
      # Trim leading/trailing blank lines the render leaves around the body.
      # Portable (no `tac`): awk buffers, then prints from the first non-blank
      # line to the last one seen.
      body="$(awk '
        { lines[NR]=$0; if ($0 ~ /[^[:space:]]/) { if (!first) first=NR; last=NR } }
        END { for (i=first; i<=last; i++) print lines[i] }
      ' <<<"$body")"
      jq -cn --argjson number "$num" --arg title "$title" --arg body "$body" --arg url "$url" \
        '{number:$number,title:$title,body:$body,url:$url}'
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
    die "unknown op '$op' (backend|default-branch|pr-state|pr-create|pr-merge|pr-list|issue-list|issue-view|pr-body)"
    ;;
esac
