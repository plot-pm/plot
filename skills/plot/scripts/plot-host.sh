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
#   pr-merged <branch>            has ANY PR for this branch merged? prints one
#                                 word: merged|not-merged|unknown
#                                 READS `mergedAt`, NEVER `state`: a merged PR
#                                 reports CLOSED, so `state` would refuse every
#                                 squash-merged branch — the whole population
#                                 the callers of this question exist for. And
#                                 never ancestry: squash-merge rewrites the
#                                 commits, so the branch stays "ahead of main"
#                                 forever and `merge-base --is-ancestor` can
#                                 never clear it.
#                                 ASKS ABOUT ANY PR, NOT THE NEWEST. Measured
#                                 2026-08-27: three branches whose work was on
#                                 main reported unlanded, each masked by a newer
#                                 unmerged PR the fleet had opened itself on the
#                                 already-merged branch.
#                                 `unknown` IS ITS OWN ANSWER and exits 0 — a
#                                 host that cannot be asked must not answer
#                                 not-merged, because every caller of this is
#                                 deciding whether to REMOVE something and
#                                 silence is never permission. A call that
#                                 failed outright still exits 3.
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
#                                 THREE OUTCOMES, KEPT APART — the same rule
#                                 issue-list states below, which this path
#                                 collapsed until 2026-08-30. An empty list
#                                 means the host answered and there are none
#                                 (exit 0, no rows); a failed question exits
#                                 non-zero with EMPTY stdout, never a silent
#                                 empty list. EXIT 5 is a rate limit — primary
#                                 or secondary — and exit 3 is any other
#                                 failure. The two are separate because they
#                                 ask for different responses: 5 says wait, 3
#                                 says look. An unrecognised error is never
#                                 given the more specific name.
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
#   run-for-sha <branch> <sha>    the run for ONE sha — else the branch's newest
#                                 run, with `sha` saying which it is — as a
#                                 single JSON object, or nothing when the branch
#                                 has no runs at all:
#                                   {"sha":"…","status":"queued|in_progress|
#                                    completed|waiting|requested",
#                                    "conclusion":"success|failure|…|null",
#                                    "url":"…","startedAt":"…"}
#                                 PINNED TO A SHA, which is the whole reason it
#                                 exists beside `runs`. `runs` is branch-scoped
#                                 and sha-blind, and `gh run list --branch X`
#                                 returns runs for every sha that branch ever
#                                 had — the newest run is NOT necessarily for
#                                 the newest commit. A green answer read off the
#                                 wrong run reports success for code nobody will
#                                 merge, which is worse than no answer: it
#                                 invites a merge of the wrong thing. Measured
#                                 2026-08-30: two merge waiters reported on
#                                 superseded runs and had to be stopped and
#                                 re-armed.
#                                 THE FALLBACK IS WHAT MAKES THAT VISIBLE. Were
#                                 it to report nothing when the asked-for sha
#                                 has no run, a run IN FLIGHT for a superseded
#                                 commit would look exactly like no run at all,
#                                 and a caller could not tell "CI has not
#                                 started" from "CI is answering about the
#                                 past". `sha` names the run's own commit, and
#                                 comparing it to the one asked about is the
#                                 CALLER's rule — this decides nothing.
#                                 `status` AND `conclusion` ARE BOTH REPORTED,
#                                 never collapsed. A run that is `completed` has
#                                 a conclusion; one that is `waiting` or
#                                 `action_required` has none yet, and folding
#                                 the two would report a build blocked on a
#                                 human click as merely pending forever.
#                                 NOTHING on bitbucket (bb has no run listing) —
#                                 unavailable, never "no run".
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
#                                 JIRA ANSWERS when `Tracker: jira` is declared,
#                                 through the REST API (no CLI), DISPATCHED ON
#                                 `Tracker` and INDEPENDENT of `Git host` — a
#                                 Bitbucket repo tracking in Jira is normal. The
#                                 inbox is the caller's open unresolved tickets
#                                 (JQL overridable via PLOT_JIRA_JQL). There is
#                                 NO exit-4 for Jira: a configured Jira can be
#                                 asked, so a 401/403/5xx or a network failure is
#                                 the question FAILING (exit 3), never an empty
#                                 inbox — an auth gap must not read *you have no
#                                 tickets*, the failure this story is named for.
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
#                                 JIRA ANSWERS via GET /rest/api/2/issue/<key>
#                                 (v2 for a plain-string body, not v3's ADF tree)
#                                 when `Tracker: jira` — same `Tracker` dispatch
#                                 as issue-list. Jira answers 404 for a missing
#                                 key, which is exit 3 here (the tracker moved),
#                                 never an empty body.
#   pr-body <number> --body B     replace the PR description
#   rate-limit                    both GitHub budgets from `gh api rate_limit`.
#                                 SUPERSEDED BY `limit`, and kept only because
#                                 its callers have not moved: that endpoint was
#                                 measured 2026-09-01 reporting graphql
#                                 5000/5000 used=0 while a real call's header
#                                 read Remaining 1236, Used 3764. Prefer `limit`.
#   limit                         what is this connector's limit, and how well
#                                 does it know it? One JSON line per metered
#                                 bucket: {"connector","bucket","limit",
#                                 "remaining","reset","basis"} with `basis` one
#                                 of actual|predicted|unknown, and the three
#                                 numbers null where unreported. Reads the
#                                 RESPONSE HEADERS of a real call, never
#                                 `gh api rate_limit`. No output at all means
#                                 this connector meters nothing — which is not
#                                 the same fact as a limit of zero, and not
#                                 `free` either.
#   ci-limit                      the same question of the CI connector, which
#                                 is a separate axis: this repo is GitHub +
#                                 Actions, ekzweb is Bitbucket + Jenkins.
#                                 Jenkins reports no limit, so it answers
#                                 `predicted`.
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

# Exit 3 — reserved for "the op itself cannot proceed", distinct from `die`'s
# generic 1. A Jenkins overlay with no instance to ask is such a case: a config
# error a person must fix, not a transient the board should retry past.
die3() { echo "plot-host: $*" >&2; exit 3; }

# Exit 5 — the host refused to answer FOR NOW. A rate limit, primary or
# secondary: nothing is broken, nothing needs fixing, and the same question
# asked later will be answered.
#
# ITS OWN CODE BECAUSE IT ASKS FOR A DIFFERENT RESPONSE. Exit 3 says *something
# is wrong and a person must look*; this says *wait*. A caller that folded them
# would counsel one when it meant the other, and the fleet scan's summary word
# is exactly that choice made visible.
#
# NOT A RETRY, HERE OR ANYWHERE IN THIS ADAPTER. Whether to wait is the
# caller's decision — a board on a 5 s cadence, a scan inside a 90 s budget and
# a person at a terminal want three different answers — and a retry inside the
# adapter would hide the very state this code exists to surface, turning a
# reportable fact into an unexplained four-minute call.
die5() { echo "plot-host: $*" >&2; exit 5; }

# WHICH FAILURE, read off the wording — the same shape `bb_issue_exit_code`
# uses, and for the same reason: the exit code cannot split these cases. `gh`
# exits 1 for a rate limit and for a 503 alike, and puts the whole difference
# in its stderr.
#
# THE SPLIT FALLS ONE WAY ONLY. An unrecognised error is never given the more
# specific name. `throttled` counsels patience, and patience does not fix an
# outage — so anything this does not recognise stays `failed`, which counsels
# looking. That is the same direction `bb_issue_exit_code` refuses to guess in,
# where an unrecognised error must be 3 rather than 4.
#
# BOTH LIMITS, because only one of them says "rate limit". The primary limit
# announces itself (`API rate limit already exceeded`); the SECONDARY limit —
# concurrent-request throttling, which is the outage this repo actually had on
# 2026-08-27 with eight workers against a cap of seven — reports a 403 naming
# abuse detection, while `gh api rate_limit` reads 5000/5000 on both buckets.
# Matching only the first would miss the one that bit.
host_failure_kind() { # $1=stderr text → throttled|failed
  if LC_ALL=C grep -qiE 'rate limit|ratelimit|too many requests|\b429\b|secondary rate|abuse detection|exceeded a secondary' <<<"$1"; then
    echo throttled
  else
    echo failed
  fi
}

# A failed `pr-list`, reported and never swallowed.
#
# THREE OUTCOMES, KEPT APART — the rule `issue-list` states in full and this
# path collapsed until 2026-08-30. An empty list means the host answered and
# there are none; a non-zero exit with empty stdout means the question failed.
# Printing nothing while exiting non-zero is what says which.
#
# NO EMPTY-LIST FALLBACK, for the reason `issue-list` gives: `host_miss_or_fail`
# exists for a lookup whose subject is absent — one PR that does not exist. A
# LIST has no absent subject, so if the call failed, the answer is unknown.
pr_list_failed() { # $1=stderr text
  local err="$1"
  if [ "$(host_failure_kind "$err")" = throttled ]; then
    die5 "pr-list: host throttled — ${err:-the host refused the request and said nothing}"
  fi
  die3 "pr-list: ${err:-the host failed the request and said nothing}"
}

# Run one `pr-list` host call, or die reporting which failure it was.
#
# SIX CALL SITES SHARE THIS, and that is the point rather than a tidy-up.
# `pr-list` branches on backend × rich × Jenkins into six separate invocations,
# each of which had its own unchecked assignment; a fix applied by hand six
# times is a fix that drifts, and the arm that drifts is the one nobody's repo
# exercises. `plot-pr-merged.sh` makes the same argument for being sourced
# rather than copied: two implementations of one gate fail toward permissive,
# and permissive here means the silent empty list this exists to remove.
#
# The output goes to STDOUT for the caller to capture; only the error text is
# spooled, because it is needed twice — once to classify and once to report.
#
# EVERY CALL SITE MUST WRITE `|| exit $?`, AND IT IS NOT OPTIONAL. This is
# invoked as `_raw="$(pr_list_call …)"` — a COMMAND SUBSTITUTION, which is a
# subshell — so the `exit` inside `die5`/`die3` leaves that subshell only. The
# outer script would carry on with `_raw` empty and `jq` would emit nothing:
# the silent empty list this whole helper exists to remove, rebuilt one layer
# further in and harder to see. The same trap `bb_states_for` documents a few
# hundred lines below, where a `die` in a subshell turned an unknown state into
# "no PRs matched".
pr_list_call() { # "$@"=the host command → payload on stdout, or dies
  local out rc err tmp="/tmp/plot-host-prlist-err.$$"
  out="$("$@" 2>"$tmp")"; rc=$?
  err="$(cat "$tmp" 2>/dev/null)"; rm -f "$tmp"
  [ "$rc" -eq 0 ] || pr_list_failed "$err"
  # A non-empty stderr on a SUCCESSFUL call is a warning, not a verdict — `gh`
  # writes deprecation notices there. Passed through so it is not lost, while
  # the payload is still returned.
  [ -n "$err" ] && echo "$err" >&2
  printf '%s' "$out"
}

# --- Jenkins CI integration ------------------------------------------------
# A repo may declare `CI: jenkins` independently of `Git host`. When it does,
# build status (`checks`) is resolved through `jen` — a multibranch job's
# branches in one call, joined locally to the PR list the host provides.
#
# The colour table (plan "i-can-see-whether-my-build-passed", measured spike):
#   blue         → passing        (last build succeeded)
#   red          → failing        (last build FAILED)
#   yellow       → failing        (UNSTABLE: ran, tests failed, no error)
#   *_anime      → pending        (a build is RUNNING)
#   disabled     → none           (no build to report)
#   absent       → none           (branch exists, job not yet built)
#
# `yellow` maps to `failing`, deliberately: a branch whose tests failed must
# not read green on a board used to decide readiness. It reports `failing`
# and names the job in `failing_checks`, so the difference is visible.
#
# Branch names arrive URL-encoded (measured: 27 of 45 names in a production
# job). Decoded before the join; Done-when 6 is the test.
#
# `jen` exits 0 while printing "NOT reachable" — Done-when 4 checks the output
# rather than $?. When Jenkins is unreachable, `checks:"unknown"` is returned
# per row rather than blanking the entire list, and exit 3 is reserved for
# when the operation itself cannot proceed.

# Resolve CI backend: $PLOT_CI (for tests), then `CI` key, default "".
# Non-jenkins values (github-actions, none, "") mean "no separate CI fetch".
# The CI system this repo runs its builds on: `jenkins`, `github-actions`, or
# `none`. Independent of the Git host — a Bitbucket repo can build on Jenkins,
# and this key is what pairs the two. `PLOT_CI` overrides for tests.
ci_backend() {
  if [ -n "${PLOT_CI:-}" ]; then
    printf '%s\n' "$PLOT_CI" | tr '[:upper:]' '[:lower:]'
    return
  fi
  bash "$here/plot-config.sh" get "CI" "" | tr '[:upper:]' '[:lower:]'
}

# Fetch Jenkins build statuses for every branch in a multibranch job, in ONE
# call, and return them as a JSON object keyed by DECODED branch name.
#
# $1 = Jenkins instance value from config: `<slug>` or `<slug>/<job/path>`.
#      The slug is what `jen -I` takes; the remainder (after the first `/`) is
#      the multibranch job's container path. The plan said the job path "derives
#      from the branch name", but a multibranch container (`webbloqs/…`) is the
#      PARENT of the branch and cannot — so the container travels here, on the
#      instance value, WITHOUT a new config key (the brief forbids one). A job
#      path in `PLOT_JENKINS_JOB` overrides, for a caller that has it separately.
#
# Output on stdout: a SINGLE object `{"status":"ok|failed|unknown","map":{…}}`.
# Status is returned IN the payload rather than in a variable because the caller
# reads this through `$(…)`, a subshell whose variable assignments never reach
# the parent — the earlier draft set a global here and it was always empty.
#
#   ok      — Jenkins answered; `map` holds branch→{color,checks,job}
#   failed  — Jenkins is unreachable (`jen auth status` says so, while EXITING
#             0 — Done-when 4: the wording decides, never `$?`), or the listing
#             was empty/garbled. `map` is {}; the caller renders rows `unknown`.
#   unknown — the auth wording was unrecognised; degrade to failure-shaped
#             (cannot verify), never to ok. `map` is {}.
jenkins_build_map() {
  local instance="$1"
  local slug job
  slug="${instance%%/*}"
  if [ -n "${PLOT_JENKINS_JOB:-}" ]; then
    job="$PLOT_JENKINS_JOB"
  elif [ "$instance" = "$slug" ]; then
    # A bare-host instance carries no job path; list at the root scope. A repo
    # whose multibranch job sits at the root joins; otherwise no branch matches
    # and every row reads `none` — honest, and the open point's fallback.
    job=""
  else
    job="${instance#*/}"
  fi

  # Auth FIRST — `jen` exits 0 even when Jenkins is unreachable, so the exit
  # code is worthless here and the `Jenkins auth:` line is the only witness.
  # `NOT reachable` must be tested BEFORE `reachable` (it contains it).
  # The `Jenkins auth:` line carries the verdict. Its FAILURE wording is stable
  # (`NOT reachable`, measured 2026-08-18) and tested first because it contains
  # the success word. Its SUCCESS wording is `OK` on jen 0.2.0 (measured live
  # 2026-08-26: `Jenkins auth:  OK — user@host`) — older notes said `reachable`,
  # so both are accepted. Anything else on that line is UNRECOGNISED → degrade to
  # failure-shaped (cannot verify), never to ok — the probe's `classify` rule.
  local auth_out=""
  auth_out=$(jen -I "$slug" auth status 2>&1) || true
  if printf '%s' "$auth_out" | grep -qiE 'jenkins auth:[[:space:]]*not reachable'; then
    printf '{"status":"failed","map":{}}\n'; return 0
  fi
  if ! printf '%s' "$auth_out" | grep -qiE 'jenkins auth:[[:space:]]*(ok|reachable)'; then
    printf '{"status":"unknown","map":{}}\n'; return 0
  fi

  # One call, every branch — the spike's whole point (Done-when 5).
  local out=""
  out=$(jen -I "$slug" job list ${job:+"$job"} --json 2>&1) || true
  if [ -z "$out" ] || ! printf '%s' "$out" | jq -e 'type=="array"' >/dev/null 2>&1; then
    printf '{"status":"failed","map":{}}\n'; return 0
  fi

  # Transform to `branch → {color, checks, job}`, decoding percent-encoded names
  # (Done-when 6: `feature%2Ffoo` → `feature/foo`, else every slashed branch
  # misses AS `none`). The plan's colour table, mapped to the FOUR `checks` words
  # the adapter already reports and the board already renders:
  #   blue                 → green    (success; the board's success word — its
  #                                     `checkWord()` maps anything but green|
  #                                     pending|failing|none to `unknown`, so the
  #                                     plan's prose word "passing" would render
  #                                     as *cannot read the checks*. The state,
  #                                     not the word, is what the plan settles.)
  #   red | yellow         → failing  (yellow is UNSTABLE — tests failed; NOT green)
  #   *_anime              → pending  (a build is running)
  #   disabled | absent    → none     (no build to report — absent is not failed)
  printf '%s' "$out" | jq -c --arg job "$job" '
    def urldecode:
      gsub("%(?<h>[0-9A-Fa-f]{2})";
        "\(.h | explode | reduce .[] as $c (0; . * 16 + (if $c >= 97 then $c - 87 elif $c >= 65 then $c - 55 else $c - 48 end)) | [.] | implode)");
    def color_to_checks:
      if . == null or . == "" then "none"
      elif endswith("_anime") then "pending"
      elif . == "blue" then "green"
      elif . == "red" or . == "yellow" then "failing"
      else "none"
      end;
    # `job` NAMES the specific failing build for `failing_checks` — the whole
    # point of naming it is so a reader knows which Jenkins job to open. That is
    # the branch job, qualified by its container: `<container>/<branch>` (or the
    # branch alone when the container is the root). NOT the container path, which
    # every branch would share and none of which is the one that failed.
    { status: "ok",
      map: ([.[]
             | (.name | urldecode) as $branch
             | { key: $branch,
                 value: { color: .color,
                          checks: (.color | color_to_checks),
                          job: (if $job == "" then $branch else "\($job)/\($branch)" end) } }]
            | from_entries) }
  '
}

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

# Did the host refuse this call for RATE, rather than answer it?
#
# The gap `graphql_budget_spent` names in its own docblock: *"`rate_limit` does
# not report the secondary limit and cannot, so this gate would have read 5000
# available at the exact moment nothing worked. Backing off on the 403 itself is
# a separate change and is not this one."* This is that change.
#
# Measured 2026-09-01. A polling burst tripped GitHub's secondary limit on
# GraphQL while BOTH buckets read `5000/5000`, so `graphql_budget_spent` was
# false, the cheap path was chosen, and every `gh pr` call returned
# `API rate limit already exceeded`. REST answered the same questions normally
# throughout. The estate's whole reap stalled on it — 18 worktrees read
# `rule could not be asked` and every one was kept.
#
# THE CHEAP PATH STAYS THE DEFAULT. This does not prefer REST; the trade is
# measured at one GraphQL call against ~186 REST calls for a 93-branch scan. It
# only says that a call REFUSED for rate has not been answered, so the second
# path is worth trying before reporting an outage.
#
# `LC_ALL=C` for the reason `is_lookup_miss` gives: the CLI localises, and an
# English-only matcher would misread every other locale.
is_rate_refusal() {
  LC_ALL=C grep -qiE 'rate limit|secondary rate|abuse detection|403.*forbidden' <<<"$1"
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

# WHY A SECOND PATH EXISTS AT ALL: GitHub meters GraphQL and REST separately,
# so a spent GraphQL bucket leaves a full REST one. `gh pr view` spends GraphQL;
# `gh api` spends REST. When the first budget is gone the second is sitting
# there unused, and the same question can still be answered — degraded and more
# expensive, but answered.
#
# BE HONEST ABOUT WHAT THIS BUYS. It is a second path when one bucket is
# GENUINELY spent, which is a real state a long-running board reaches. It is NOT
# immunity from throttling. The outage this repo actually had on 2026-08-27 was
# GitHub's SECONDARY limit — concurrent-request throttling, eight workers
# against a cap of seven — and during it both budgets read:
#
#   graphql: 5000/5000  used=0  reset_in=3599s
#   core:    5000/5000  used=0  reset_in=3599s
#
# Both full, nothing spent, every call refused. `rate_limit` does not report the
# secondary limit and cannot, so this gate would have read 5000 available at the
# exact moment nothing worked. Backing off on the 403 itself is a separate
# change and is not this one.
#
# THE CHEAP PATH STAYS THE DEFAULT, and the reason is measured. For 93 branches:
# ONE GraphQL call (`pr-list` with the check rollup) versus ~186 REST calls,
# because REST's list endpoint returns `mergeable_state: null` and no rollup, so
# full data costs two calls per PR. "Use REST whenever possible" trades one cheap
# call for a hundred and eighty. This returns true only when GraphQL is
# ACTUALLY spent.
#
# UNKNOWN IS NOT ZERO. #485 pinned that rule where it was informational; here is
# where it bites. A host that cannot be asked reports `unknown`, and reading
# that as "exhausted" would send every branch down the expensive path forever,
# for as long as the budget query kept failing. So anything that is not a
# number that is not greater than zero leaves the default alone.
graphql_budget_spent() {
  local rate remaining
  # The budget query is FREE — `gh api rate_limit` consumes neither bucket
  # (measured 2026-08-27: three consecutive readings, all used=0) — so asking
  # before each lookup costs nothing against either limit.
  rate="$(gh api rate_limit 2>/dev/null)" || return 1
  remaining="$(jq -r '.resources.graphql.remaining // "unknown"' <<<"$rate" 2>/dev/null)" || return 1
  # `== 0` and not `<= 0`: only a number can be spent. `unknown`, an empty
  # string and a malformed payload all fall through to false, which is the
  # cheap path — the honest direction to be wrong in.
  [[ "$remaining" =~ ^[0-9]+$ ]] && [ "$remaining" -eq 0 ]
}

# BOTH PATHS MUST PRODUCE ONE VOCABULARY, or the adapter's contract forks in two
# and every caller has to learn which route answered.
#
# This is stricter than it looks. `plot-fleet-scan.sh` reads the state with a
# regex over the JSON TEXT (`sed -n 's/.*"state":"\([A-Z]*\)".*/\1/p'`), so a
# lowercase REST `state` would read as NO ANSWER AT ALL rather than as a wrong
# one — a silent failure, not a loud one.
#
# REST'S `state` IS NOT GRAPHQL'S, and that is the trap this function exists
# for. A merged PR reports `state: "closed"` over REST, with the merge in a
# SEPARATE field; GraphQL says `MERGED` outright. An adapter that merely
# uppercases `.state` reports every merged PR as CLOSED — the same confusion
# `plot-reap.sh` was built around, and the reason it reads `mergedAt` rather
# than `state`.
#
# THE MERGE SIGNAL HAS TWO SPELLINGS, because the two endpoints disagree:
#
#   /repos/{repo}/pulls/{number}          → `merged`     (boolean)
#   /repos/{repo}/pulls?head=owner:branch → `merged_at`  (timestamp, or null)
#
# The list row carries no `merged` key at all — measured against this repo
# 2026-08-28, where PR #494's row has `has("merged") == false`. Reading only
# `.merged` there reports every merged branch as CLOSED, so both are consulted
# and either one suffices.
# REST NEEDS AN `owner/repo` IN THE PATH, where the GraphQL path needed nothing:
# `gh pr view 7` infers the repo from the git remote, but `gh api repos/.../pulls/7`
# has to be told. So the fallback needs one more fact than the path it replaces.
#
# `--repo` may already carry it (the caller passed `-R owner/repo`), in which
# case no call is needed at all. Otherwise it has to be resolved.
#
# TODO(decision): resolve the repo when `--repo` was not supplied.
gh_rest_repo() {
  if [ ${#repo_args[@]} -gt 0 ]; then
    echo "${repo_args[1]}"
    return 0
  fi
  echo "TODO"
}

rest_pr_to_state() {
  jq -c '
    (if (.merged == true) or (.merged_at != null) then "MERGED"
     else (.state // "" | ascii_upcase) end) as $state
    | { number: .number,
        state: $state,
        draft: (.draft // false),
        url: (.html_url // ""),
        mergeCommit: (.merge_commit_sha // "") }
  '
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

# --- bb capability check (--json support) ------------------------------------
#
# TWO TOOLS SHARE THE NAME `bb`. craftamap/bb is a Go binary that does NOT
# support `--json` for PR commands. Quatico's `bb` (a shell wrapper) does.
# Their version numbers name different products: craftamap 0.6.0 is not
# "older than" Quatico 1.0.0 — they are unrelated.
#
# The adapter passes `--json` to `bb pr list`. Against craftamap that is
# `Error: unknown flag: --json`, swallowed by any 2>/dev/null, and jq exits 0
# on empty input — so every Bitbucket PR list reads as *no PRs*.
#
# Worse: craftamap 0.6.0 panics (SIGSEGV) under an HTTP 429. A segfaulting CLI
# is indistinguishable from a quiet one when stderr is discarded.
#
# The capability is per-FLAG, not per-version. On one machine, on one day:
#   plugin cache (bb 1.0.0)  : --json yes, checks no
#   plugin marketplace (1.9.0): --json yes, checks yes
#   craftamap fallback (0.6.0): --json NO
#
# So: CHECK THE CAPABILITY, ONCE PER RUN. `BB_CAP_*` are cached on first call.
# A bb without `--json` exits 3 with the reason naming WHICH bb answered.

# Cached capability state — empty until first call to bb_require_json.
BB_CAP_CHECKED=""
BB_CAP_HAS_JSON=""
BB_CAP_IDENTITY=""    # "craftamap/0.6.0" or "quatico/1.2.3" or "unknown/<ver>"

# Identify which bb is on PATH. Returns a string like "quatico/1.9.0" or
# "craftamap/0.6.0" or "unknown/<version>" or "unknown/unknown".
#
# The identification is BEHAVIOURAL, not by reading a vendor field that may not
# exist: craftamap/bb prints `bb version X.Y.Z (sha)` and Quatico's prints
# `bb version X.Y.Z` (no sha) with a distinctive banner. The shape decides.
bb_identify() {
  local ver_out ver_stripped
  ver_out="$(bb --version 2>&1)" || {
    # bb not found or exited non-zero — cannot proceed
    echo "unknown/unavailable"
    return
  }
  ver_stripped="$(bb_strip_ansi <<<"$ver_out")"

  local version
  version="$(grep -oE '[0-9]+\.[0-9]+\.[0-9]+' <<<"$ver_stripped" | head -1)"
  [ -z "$version" ] && version="unknown"

  # craftamap/bb includes a git sha in parentheses: `bb version 0.6.0 (abc1234)`
  # Quatico's does not — it prints only `bb version X.Y.Z`.
  if grep -qE '\([0-9a-f]+\)' <<<"$ver_stripped"; then
    echo "craftamap/$version"
  elif grep -qi 'quatico\|plugin' <<<"$ver_stripped"; then
    echo "quatico/$version"
  else
    # Unknown provenance — report the version so a human can tell
    echo "unknown/$version"
  fi
}

# Test whether the bb on PATH supports `--json` for PR commands.
# Returns 0 if it does, non-zero otherwise.
#
# The test is BEHAVIOURAL: call `bb pr list --json --help` (or similar) and
# see if it rejects `--json`. We cannot rely on version numbers because two
# products share the name and their versions are unrelated.
#
# Note: `bb pr list --json --state open` would contact the network; we want a
# purely local check. craftamap's `bb pr list --help --json` exits 1 with
# "unknown flag: --json" on stderr (and sometimes stdout). Quatico's accepts it.
bb_test_json_support() {
  # Ask for help with --json — a bb that does not understand it will complain.
  # Capture both streams since bb writes errors to stdout.
  local out rc
  out="$(bb pr list --help --json 2>&1)"; rc=$?

  # craftamap 0.6.0 rejects --json with `Error: unknown flag: --json`
  if grep -qiE 'unknown flag.*--json|invalid.*--json|--json.*not' <<<"$out"; then
    return 1
  fi

  # If help succeeded (even partially), assume --json is supported
  if [ "$rc" = 0 ]; then
    return 0
  fi

  # Non-zero exit with no clear rejection — inspect further
  # A "not a bitbucket repo" error is about the repo, not the flag
  if grep -qiE 'not a bitbucket repo|repository not found' <<<"$out"; then
    # Could not test properly, but that is a repo issue, not a capability one.
    # We will discover the real failure when the actual call is made.
    return 0
  fi

  # Unknown failure — treat as unsupported to be safe
  return 1
}

# Require that bb supports --json. Called once before the first bb PR call.
# Exits 3 with a diagnostic if bb cannot do what the adapter needs.
# Caches the result so subsequent calls are free.
bb_require_json() {
  # Skip check if already done
  [ -n "$BB_CAP_CHECKED" ] && return 0
  BB_CAP_CHECKED=1

  # Allow tests to skip this (their stubs may not implement --help)
  if [ -n "${PLOT_BB_SKIP_CAP_CHECK:-}" ]; then
    BB_CAP_HAS_JSON=1
    BB_CAP_IDENTITY="stub/test"
    return 0
  fi

  BB_CAP_IDENTITY="$(bb_identify)"

  if ! bb_test_json_support; then
    BB_CAP_HAS_JSON=0
    die3 "bb on PATH ($BB_CAP_IDENTITY) does not support --json for PR commands — install Quatico's bb or ensure it is first on PATH"
  fi

  BB_CAP_HAS_JSON=1
  return 0
}

# --- Jira issue support (REST, no CLI) --------------------------------------
#
# `Tracker` is a `## Plot Config` key INDEPENDENT of `Git host`: a Bitbucket
# repo tracking in Jira is the normal enterprise case. So the two issue ops
# dispatch on `tracker()`, NOT `backend()` — the PR ops keep dispatching on
# `backend()`, and `jira` is never a value of it (it is not a git host).
#
# Absent (or `plot`/`github-issues`/an unrecognised scheme) means today's
# behaviour: the issue ops resolve through `backend()` exactly as before. This
# is opt-in; a GitHub repo that declares no `Tracker` is unaffected (Done-when 2).
#
# The value carries the base URL after the scheme (`jira https://acme.atlassian.net`),
# the same shape `plot-plan-meta.sh` reads the FIRST token of to gate the key
# form and the Jenkins arm reads the container path off `Jenkins instance` —
# so no new config key is needed. `PLOT_TRACKER` overrides for tests.
#
# NO CLI DEPENDENCY, deliberately (the plan settles this): `gh` and `bb` are
# already two binaries an adopter installs, and Jira is the tracker most likely
# behind corporate SSO — a third binary would make it the hardest path to adopt.
# The REST API is reached with `curl` and shaped with `jq`, as the other ops
# shell out and shape.
#
# READ-ONLY in both directions, like every issue op: only GET is ever issued,
# never a POST/PUT that would write a label, an assignee or a transition. A plan
# referencing an issue is Plot's record, not the tracker's.
#
# The v2 REST endpoints are used, not v3, for ONE reason: v3 returns `description`
# as an ADF document (a nested JSON tree), while v2 returns it as a plain string.
# The board wants the body as a problem statement for /plot-idea, and the
# Bitbucket arm already treats the body as a best-effort text lift — a string is
# the honest match, and walking an ADF tree in jq would be ceremony for no gain.
# `summary` is a plain string in both. See the PR for this judgement call.

# Resolve the tracker scheme and its base URL from config. Prints two lines:
# the lowercased scheme (`jira`, `github-issues`, `plot`, …) and the base URL
# (possibly empty). `PLOT_TRACKER` overrides — a test passes `jira https://…`.
tracker_raw() {
  if [ -n "${PLOT_TRACKER:-}" ]; then
    printf '%s\n' "$PLOT_TRACKER"
    return
  fi
  bash "$here/plot-config.sh" get "Tracker" ""
}

tracker_scheme() {
  tracker_raw | awk '{print tolower($1)}'
}

tracker_base_url() {
  # The base URL is the SECOND token; a bare `jira` with no URL yields "".
  # PLOT_JIRA_BASE_URL overrides, for a caller that has the URL separately.
  if [ -n "${PLOT_JIRA_BASE_URL:-}" ]; then
    printf '%s\n' "$PLOT_JIRA_BASE_URL"
    return
  fi
  tracker_raw | awk '{print $2}' | sed 's:/*$::'
}

# The env var scheme for Jira auth. The plan left the EXACT names open, to be
# confirmed against a real instance; these follow Jira Cloud's documented Basic
# scheme (email + API token, base64'd into an Authorization header):
#   JIRA_EMAIL      the account email
#   JIRA_API_TOKEN  a Jira Cloud API token (id.atlassian.com/manage/api-tokens)
# A missing token is a CONFIG error the op cannot proceed past — exit 3, never
# an empty inbox. An empty inbox says *you have no tickets*, the exact failure
# this whole story is named for; an auth gap must never wear that mask.
#
# This guard is called in the MAIN shell, BEFORE the `$(jira_curl …)` capture —
# `die3` exits the whole script only from there, not from inside a command
# substitution where it would end only the subshell and leak a second error.
jira_require_config() {
  if [ -z "$(tracker_base_url)" ]; then
    die3 "Tracker is jira but no base URL is configured (write 'Tracker: jira https://your.atlassian.net' or set PLOT_JIRA_BASE_URL)"
  fi
  if [ -z "${JIRA_EMAIL:-}" ] || [ -z "${JIRA_API_TOKEN:-}" ]; then
    die3 "Jira needs JIRA_EMAIL and JIRA_API_TOKEN in the environment — an unauthenticated Jira must not read as an empty inbox"
  fi
}

jira_curl() {
  # $1 = path (e.g. /rest/api/2/search/jql?...), remaining args appended to curl.
  # Config is assumed present — jira_require_config ran in the caller's shell.
  local path="$1"; shift
  local base
  base="$(tracker_base_url)"
  # -sS: quiet progress, but keep errors. -w writes the HTTP status on its own
  # line AFTER the body so the caller can split the two. --user does the Basic
  # base64 for us; the token never appears in argv of any child process here.
  curl -sS \
    --user "${JIRA_EMAIL}:${JIRA_API_TOKEN}" \
    -H 'Accept: application/json' \
    -w '\n%{http_code}' \
    "$base$path" "$@"
}

# Split a jira_curl response into (body, status) and enforce the three outcomes.
# Prints the JSON body on stdout on success; on failure prints nothing on stdout,
# the diagnostic on stderr, and returns 3. A transport failure (curl non-zero:
# DNS, TLS, connection refused) and an HTTP error (401/403/404/5xx) are BOTH the
# question failing — exit 3. There is no exit-4 case for Jira: a configured Jira
# CAN be asked; if it cannot be reached, that is a failure to answer, not a host
# that structurally has no tracker (the bitbucket-DISABLED case exit 4 is for).
jira_check() {
  local raw="$1" curl_rc="$2"
  local status body
  if [ "$curl_rc" -ne 0 ]; then
    echo "plot-host: jira request failed (curl exit $curl_rc) — a network failure is not an empty inbox" >&2
    return 3
  fi
  # The status is the last line; the body is everything before it.
  status="$(printf '%s' "$raw" | tail -n1)"
  body="$(printf '%s' "$raw" | sed '$d')"
  if [ "$status" -lt 200 ] || [ "$status" -ge 300 ]; then
    # Name the status AND Jira's own errorMessages if it sent any (it returns
    # {"errorMessages":[…],"errors":{…}} on 4xx). 401/403 are the auth failures
    # this story exists to keep out of the inbox; 5xx is an outage. Both are 3.
    local detail
    detail="$(printf '%s' "$body" | jq -r 'try (.errorMessages | join("; ")) catch empty' 2>/dev/null)"
    echo "plot-host: jira HTTP $status${detail:+ — $detail}" >&2
    return 3
  fi
  printf '%s' "$body"
}

# --- pr-list truncation detection (#333) ------------------------------------
#
# `pr-list` returns a bulk page that two consumers (plot-fleet-scan.sh:474 and
# fleet.ts:1552) JOIN LOCALLY. If the host truncated that page, every branch
# beyond it joins to nothing and reads as "no PR" — the fabricated verdict the
# scan refuses everywhere else. Measured 2026-08-26 against a real Bitbucket:
# `bb` returned 50 merged PRs (ids 836→787) against a repo numbering to 836, so
# ~780 older merged PRs were invisible to the join.
#
# THE DETECTOR IS AGAINST THE REQUESTED LIMIT, NEVER THE CONSTANT 50. A future
# `bb` page size of 100 must not make a truncated 100-row list report complete —
# this plan's own defect restored. So the rule names no page size:
#
#   github (HONOURS --limit)  : a state is possibly truncated when it returned
#                               AT LEAST the requested limit — the host may have
#                               had more that the limit hid. Fewer rows than the
#                               limit PROVES completeness.
#   bitbucket (IGNORES --limit): `bb pr list` has no --limit and cannot report a
#                               total or a cursor, so it can NEVER prove
#                               completeness for a --limit call. Any non-empty
#                               page is therefore possibly truncated. An empty
#                               page had nothing to truncate.
#
# No --limit was requested → the caller accepted the host's default page and is
# owed no report, so no existing no-limit caller's behaviour changes.
#
# THE REPORT GOES TO STDERR, not a stdout sentinel. Both consumers parse every
# stdout line as a PR record (fleet.ts casts each line to a PrRecord with no
# discriminator check), so a sentinel line would enter the join as a phantom
# {number:undefined} — a NEW silent corruption while fixing an old one, and the
# plan holds both callers untouched. stderr is the channel the plan asks the
# fallback to announce itself on, and the one an untouched caller already drops.
#
# WHY STDERR-ONLY IS THE WHOLE FIX HERE: closing the ~780-PR gap by asking `bb`
# per id is unaffordable — ~10s per call, no bulk primitive — so no per-branch
# fallback is shipped. The honest-truncated half makes the incompleteness
# VISIBLE (an operator sees why a pulse is short) and machine-readable for a
# future diff that teaches the scan to fall back, without moving the failure
# into a minutes-long pulse. See the plan's Done-when item 3.
#
# $1 backend  $2 requested limit (may be "")  $3 state word  $4 row count
pr_list_report_truncation() {
  local be="$1" limit="$2" state="$3" count="$4"
  [ -n "$limit" ] || return 0            # no --limit → no completeness claim owed
  [ "$count" -gt 0 ] 2>/dev/null || return 0   # an empty page had nothing to hide
  if [ "$be" = "github" ]; then
    # github honours the limit: complete unless the page came back AT the limit.
    [ "$count" -ge "$limit" ] 2>/dev/null || return 0
  fi
  # bitbucket: any non-empty page for a --limit call is unprovable, so it falls
  # through to the report. Named per state so a future caller can resolve exactly
  # the states that were capped, not a whole-call flag that over-reports.
  echo "plot-host: $be pr-list state=$state possibly truncated ($count rows, requested limit $limit unprovable) — a join against this page may read older branches as 'no PR' (#333)" >&2
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
      # THE ROUTE IS CHOSEN ONCE, HERE, and the cheap path is the default. See
      # `graphql_budget_spent` above for why REST is the exception rather than
      # the rule (~186 calls versus one for a 93-branch scan) and for what this
      # fallback honestly does and does not buy.
      if [ "${PLOT_HOST_FORCE_REST:-0}" = "1" ] || graphql_budget_spent; then
        # THE GRAPHQL PATH IS NOT ATTEMPTED FIRST once its budget is known to be
        # gone. Trying it anyway would spend a call that is already refused, to
        # learn what was just read for free.
        #
        # A number and a branch name need DIFFERENT endpoints, and their
        # payload shapes differ too — see `rest_pr_to_state`, which is the one
        # place that knows how to read either.
        rest_repo="$(gh_rest_repo)" || exit $?
        if [[ "$ref" =~ ^[0-9]+$ ]]; then
          if out="$(gh api "repos/$rest_repo/pulls/$ref" 2>/tmp/plot-host-err.$$)"; then
            rm -f "/tmp/plot-host-err.$$"
            rest_pr_to_state <<<"$out"
          else
            err="$(cat "/tmp/plot-host-err.$$" 2>/dev/null)"; rm -f "/tmp/plot-host-err.$$"
            host_miss_or_fail "$err" \
              '{"number":0,"state":"NONE","draft":false,"url":"","mergeCommit":""}' || exit $?
          fi
        else
          # `?head=owner:branch` is the list form. AN EMPTY ARRAY IS AN ANSWER —
          # the branch has no PR — while a call that never arrived is not, which
          # is why the empty case is handled here and the failure goes through
          # `host_miss_or_fail` like every other transport error.
          #
          # `state=all`, because the default is `open` and a merged PR would
          # otherwise read as NONE — wrong in the reassuring direction.
          rest_owner="${rest_repo%%/*}"
          if out="$(gh api "repos/$rest_repo/pulls?head=$rest_owner:$ref&state=all&per_page=1" 2>/tmp/plot-host-err.$$)"; then
            rm -f "/tmp/plot-host-err.$$"
            if [ "$(jq -r 'length' <<<"$out" 2>/dev/null)" = "0" ]; then
              echo '{"number":0,"state":"NONE","draft":false,"url":"","mergeCommit":""}'
            else
              jq -c '.[0]' <<<"$out" | rest_pr_to_state
            fi
          else
            err="$(cat "/tmp/plot-host-err.$$" 2>/dev/null)"; rm -f "/tmp/plot-host-err.$$"
            host_miss_or_fail "$err" \
              '{"number":0,"state":"NONE","draft":false,"url":"","mergeCommit":""}' || exit $?
          fi
        fi
      # mergeCommit is what lets a caller ask "which release contains this?" —
      # `git tag --contains <sha>` answers exactly, where dates cannot. It is ""
      # for anything unmerged, which is the honest answer rather than a guess.
      elif out="$(gh ${repo_args[@]+"${repo_args[@]}"} pr view "$ref" --json number,state,isDraft,url,mergeCommit 2>/tmp/plot-host-err.$$)"; then
        rm -f "/tmp/plot-host-err.$$"
        jq -c '{number:.number,state:.state,draft:.isDraft,url:.url,mergeCommit:(.mergeCommit.oid // "")}' <<<"$out"
      else
        err="$(cat "/tmp/plot-host-err.$$" 2>/dev/null)"; rm -f "/tmp/plot-host-err.$$"
        # REFUSED FOR RATE IS NOT ANSWERED. The budget gate above could not see
        # this coming — `rate_limit` does not report the secondary limit — so the
        # cheap path was chosen and then declined. The second path is the one
        # thing left to try before calling the host unreachable, and re-entering
        # the op is how it is reached without a second copy of the REST code.
        if is_rate_refusal "$err"; then
          PLOT_HOST_FORCE_REST=1 "$0" pr-state "$ref" ${repo_args[@]+"${repo_args[@]}"} && exit 0
        fi
        host_miss_or_fail "$err" \
          '{"number":0,"state":"NONE","draft":false,"url":"","mergeCommit":""}' || exit $?
      fi
    else
      # Establish that bb supports --json BEFORE calling it — Done-when 5.
      bb_require_json
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

  # HAS ANY PR FOR THIS BRANCH MERGED?
  #
  # The one operation `plot-reap.sh` and `plot-release-refs.sh` reached past
  # this adapter for. `pr-state` returns `mergeCommit` and not `mergedAt`, and
  # `mergeCommit` is empty for a branch whose merge this port never saw — so
  # the gate that decides whether work has landed had to source its own
  # implementation rather than ask here.
  #
  # THREE ANSWERS, ON EXIT 0. `unknown` is a payload, not a failure: a host
  # that cannot be asked must not answer `not-merged`, because every caller is
  # deciding whether to remove something. Exit 3 is still reserved for the call
  # itself failing in a way this adapter does not recognise as a miss.
  pr-merged)
    ref="${1:?pr-merged needs a branch}"; shift || true
    repo_args=()
    while [ $# -gt 0 ]; do
      case "$1" in
        --repo) repo_args=(-R "${2:?}"); shift 2 ;;
        *) die "pr-merged: unknown arg $1" ;;
      esac
    done
    if [ "$be" = "github" ]; then
      # --state all, because a merged PR reports CLOSED and the default `open`
      # would hide every one of them. --limit 100 rather than 1: the newest PR
      # is not the merge, exactly as the state is not the merge.
      if out="$(gh ${repo_args[@]+"${repo_args[@]}"} pr list --head "$ref" --state all --limit 100 --json mergedAt 2>/tmp/plot-host-err.$$)"; then
        rm -f "/tmp/plot-host-err.$$"
        if jq -e 'any(.[]; .mergedAt != null)' >/dev/null 2>&1 <<<"$out"; then
          echo "merged"
        else
          echo "not-merged"
        fi
      else
        err="$(cat "/tmp/plot-host-err.$$" 2>/dev/null)"; rm -f "/tmp/plot-host-err.$$"
        # A LOOKUP MISS IS AN ANSWER — the branch has no PR, so nothing merged.
        # Anything else is the host failing to be asked, and that is `unknown`
        # rather than exit 3: the caller asked a question with a third value
        # for exactly this case, and the answer fails safe toward keeping.
        if [ -z "$err" ] || is_lookup_miss "$err"; then
          echo "not-merged"
        else
          echo "plot-host: $err" >&2
          echo "unknown"
        fi
      fi
    else
      bb_require_json
      # Bitbucket has no `--head` filter, so the branch is matched locally.
      # MERGED is bb's own state word here rather than a timestamp: the API
      # exposes no `mergedAt`, so this is the closest fact the backend holds,
      # and it is a positive statement about the merge rather than an inference
      # from CLOSED — `DECLINED` is bb's closed-unmerged word and is distinct.
      if out="$(bb ${repo_args[@]+"${repo_args[@]}"} pr list --state merged --json 2>/tmp/plot-host-err.$$)"; then
        rm -f "/tmp/plot-host-err.$$"
        if jq -e --arg b "$ref" 'any(.[]; .source.branch.name==$b)' >/dev/null 2>&1 <<<"$out"; then
          echo "merged"
        else
          echo "not-merged"
        fi
      else
        err="$(cat "/tmp/plot-host-err.$$" 2>/dev/null)"; rm -f "/tmp/plot-host-err.$$"
        if [ -z "$err" ] || is_lookup_miss "$err"; then
          echo "not-merged"
        else
          echo "plot-host: $err" >&2
          echo "unknown"
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

    # --- Jenkins CI integration (orthogonal to Git host) ---
    # When `CI: jenkins` is configured, build status comes from Jenkins rather
    # than the Git host. One call per refresh, joined locally — Done-when 5.
    #
    # `CI` and `Git host` are SEPARATE keys, so this runs ABOVE the backend
    # branch and overlays whichever backend produced the rows (Done-when 3).
    #
    # Two failure directions, kept apart deliberately:
    #   - The OP CANNOT PROCEED (`CI: jenkins` but no instance to ask) — a config
    #     error only a person can fix. EXIT 3, the code the header reserves for
    #     "the op itself cannot proceed". Blanking would look like a transient.
    #   - Jenkins is UNREACHABLE — the rows survive as `checks:"unknown"` and the
    #     op still exits 0. A hard exit here would blank the WHOLE PR list, since
    #     the board rejects a non-zero pr-list and keeps its last good map; one
    #     dead Jenkins must not darken every row. This reconciles Done-when 4's
    #     "exits 3" with the brief's "prefer unknown on the affected rows".
    ci="$(ci_backend)"
    jen_map=""
    jen_status=""
    if [ "$ci" = "jenkins" ] && [ "$rich" = 1 ]; then
      jen_instance=$(bash "$here/plot-config.sh" get "Jenkins instance" "" 2>/dev/null || echo "")
      [ -n "$jen_instance" ] || jen_instance="${JENKINS_INSTANCE:-}"
      if [ -z "$jen_instance" ]; then
        die3 "CI is jenkins but no Jenkins instance is configured (set a 'Jenkins instance' key)"
      fi
      jen_payload=$(jenkins_build_map "$jen_instance")
      jen_status=$(printf '%s' "$jen_payload" | jq -r '.status // "failed"' 2>/dev/null || echo "failed")
      jen_map=$(printf '%s' "$jen_payload" | jq -c '.map // {}' 2>/dev/null || echo "{}")
      # A failed/unknown Jenkins is still an active overlay: it marks rows
      # `unknown` rather than leaving them at the backend's answer. So the arm is
      # "on" whenever CI is jenkins, and $jen_status carries whether it answered.
      if [ "$jen_status" != "ok" ]; then
        echo "plot-host: jenkins unreachable ($jen_status) — checks reported as unknown" >&2
      fi
    fi

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
        #
        # --- Jenkins override ---
        # When `CI: jenkins` is configured, checks come from Jenkins instead of
        # GitHub's statusCheckRollup. Done-when 3 verifies this is orthogonal:
        # a GitHub repo without Jenkins still reads its own rollup exactly as
        # before.
        if [ "$ci" = "jenkins" ]; then
          # GitHub PR list, but `checks` comes from Jenkins, joined on branch
          # name. `statusCheckRollup` is NOT even requested — the GitHub rollup
          # is irrelevant for a Jenkins team, and asking for it would be a slower
          # query for a field this arm discards.
          #   $jstatus != "ok"  → Jenkins could not answer; every row `unknown`.
          #   $jentry == null   → the branch has no Jenkins job; `none`.
          #   otherwise         → the joined colour's `checks`, job named on fail.
          _gh_raw="$(pr_list_call gh pr list --state "$state" ${limit_args[@]+"${limit_args[@]}"} \
            --json number,title,state,headRefName,isDraft,mergeable,mergeStateStatus,reviewDecision,url)" || exit $?
          pr_list_report_truncation github "$limit" "$state" \
            "$(jq 'length' <<<"$_gh_raw" 2>/dev/null || echo 0)"
          printf '%s' "$_gh_raw" \
            | jq -c --argjson jmap "$jen_map" --arg jstatus "$jen_status" '.[] |
              ($jmap[.headRefName] // null) as $jentry |
              {
                number:.number, title:.title, state:.state, head:.headRefName,
                draft:.isDraft,
                checks:(
                  if $jstatus != "ok" then "unknown"
                  elif $jentry == null then "none"
                  else $jentry.checks
                end),
                mergeable:(
                  if .mergeable=="CONFLICTING" or .mergeStateStatus=="DIRTY" then "conflicting"
                  elif .mergeable=="MERGEABLE" then "mergeable"
                  else "unknown" end),
                review:(.reviewDecision // ""),
                url:.url,
                failing_checks:(
                  if $jentry != null and $jentry.checks == "failing"
                  then [$jentry.job]
                  else []
                end)
              }'
        else
          # GitHub without Jenkins (or Jenkins not configured): use GitHub rollup
          _gh_raw="$(pr_list_call gh pr list --state "$state" ${limit_args[@]+"${limit_args[@]}"} \
            --json number,title,state,headRefName,isDraft,statusCheckRollup,mergeable,mergeStateStatus,reviewDecision,url)" || exit $?
          pr_list_report_truncation github "$limit" "$state" \
            "$(jq 'length' <<<"$_gh_raw" 2>/dev/null || echo 0)"
          printf '%s' "$_gh_raw" \
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
        fi
      else
        _gh_raw="$(pr_list_call gh pr list --state "$state" ${limit_args[@]+"${limit_args[@]}"} \
          --json number,title,state,headRefName)" || exit $?
        pr_list_report_truncation github "$limit" "$state" \
          "$(jq 'length' <<<"$_gh_raw" 2>/dev/null || echo 0)"
        printf '%s' "$_gh_raw" \
          | jq -c '.[] | {number:.number,title:.title,state:.state,head:.headRefName}'
      fi
    else
      # Bitbucket carries no check rollup through `bb pr list`, and no
      # mergeability verdict either. Rather than guess, --rich reports
      # checks:"unknown" and mergeable:"unknown" — a consumer must render those
      # as "unavailable", never as green and never as clean. An honest gap beats
      # an invented answer, and absent is not false.
      #
      # --- Jenkins CI fills that gap ---
      # When `CI: jenkins` is configured, checks come from Jenkins — the same
      # integration GitHub uses, which is why it is ABOVE the backend branch.
      # Bitbucket's `unknown` becomes a real value.
      #
      # `bb pr list` has no --limit: it returns a fixed page (50 at 1.0.0).
      # Forwarding it errors with `unknown flag`, and dropping it silently
      # would serve a short page as if it were the whole set — the quiet wrong
      # answer this adapter refuses elsewhere. So it is dropped AND said.
      if [ -n "$limit" ]; then
        echo "plot-host: bitbucket ignores --limit $limit; bb returns a fixed page (50 at 1.0.0)" >&2
      fi
      # Establish that bb supports --json BEFORE calling it — Done-when 5.
      bb_require_json
      # Resolve the states BEFORE the loop. `for s in $(bb_states_for …)` runs
      # the helper in a subshell, where `die` exits that subshell only: the
      # loop would then iterate an empty list and the command would succeed
      # with no output — an unknown state reading as "no PRs matched", which
      # is the exact failure this translation exists to remove.
      bb_states="$(bb_states_for "$state")" || exit 1
      if [ "$rich" = 1 ]; then
        if [ "$ci" = "jenkins" ]; then
          # Bitbucket PR list, `checks` filled from Jenkins — the SAME overlay
          # the GitHub arm uses, which is why it lives above the backend branch.
          # `bb`'s standing `unknown` becomes a real value where Jenkins answers.
          for _s in $bb_states; do
            _bb_raw="$(pr_list_call bb pr list --state "$_s" --json)" || exit $?
            pr_list_report_truncation bitbucket "$limit" "$_s" \
              "$(jq 'length' <<<"$_bb_raw" 2>/dev/null || echo 0)"
            printf '%s' "$_bb_raw" \
              | jq -c --argjson jmap "$jen_map" --arg jstatus "$jen_status" '.[] |
                ($jmap[.source.branch.name] // null) as $jentry |
                {
                  number:.id, title:.title,
                  state:(if .state=="DECLINED" then "CLOSED" else .state end),
                  head:.source.branch.name,
                  draft:(.draft // false),
                  checks:(
                    if $jstatus != "ok" then "unknown"
                    elif $jentry == null then "none"
                    else $jentry.checks
                  end),
                  mergeable:"unknown",
                  review:"",
                  url:(.links.html.href // ""),
                  failing_checks:(
                    if $jentry != null and $jentry.checks == "failing"
                    then [$jentry.job]
                    else []
                  end)
                }'
          done
        else
          # Bitbucket without Jenkins: checks remain unknown
          for _s in $bb_states; do
            _bb_raw="$(pr_list_call bb pr list --state "$_s" --json)" || exit $?
            pr_list_report_truncation bitbucket "$limit" "$_s" \
              "$(jq 'length' <<<"$_bb_raw" 2>/dev/null || echo 0)"
            printf '%s' "$_bb_raw" \
              | jq -c '.[] | {number:.id,title:.title,state:(if .state=="DECLINED" then "CLOSED" else .state end),head:.source.branch.name,draft:(.draft // false),checks:"unknown",mergeable:"unknown",review:"",url:(.links.html.href // ""),failing_checks:[]}'
          done
        fi
      else
        for _s in $bb_states; do
          _bb_raw="$(pr_list_call bb pr list --state "$_s" --json)" || exit $?
          pr_list_report_truncation bitbucket "$limit" "$_s" \
            "$(jq 'length' <<<"$_bb_raw" 2>/dev/null || echo 0)"
          printf '%s' "$_bb_raw" \
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

  run-for-sha)
    # The newest run for ONE sha — the BuildMonitor's only host question.
    #
    # WHY THIS IS NOT `runs`. `runs` is branch-scoped and reports no sha at all,
    # so a caller cannot tell which commit an answer is about. `gh run list
    # --branch X` returns runs for every sha the branch ever had, and the newest
    # run is not necessarily for the newest commit — a branch pushed twice in
    # quick succession has the first sha's run finishing after the second sha's
    # started. Reading a conclusion off that run answers about the past.
    #
    # WHY THAT MATTERS MORE THAN IT SOUNDS. A green result for superseded code
    # is worse than no result: it invites a merge of the wrong thing. Measured
    # 2026-08-30, in the session that wrote the plan: two merge waiters reported
    # on superseded runs and had to be stopped and re-armed.
    #
    # FACTS, NEVER A VERDICT (Principle 3). It reports `status` and `conclusion`
    # as the host gives them and compares nothing. Whether `action_required`
    # means "blocked" or `null` means "still going" is the monitor's rule, not
    # this collector's — and keeping the two words separate is what lets the
    # monitor tell a build awaiting a human click from one merely running. A
    # collector that folded them into one word would make that distinction
    # unrecoverable downstream.
    #
    # ONE OBJECT OR NOTHING. Empty output means the host has no run for this sha
    # — which is a real, common answer (the run has not been created yet) and
    # deliberately NOT an error: a monitor polling a fresh push sees it on every
    # pass until CI wakes up.
    #
    # Bitbucket reports nothing rather than something invented, exactly as
    # `runs` does: `bb` has no run listing, and silence here reads as
    # unavailable, never as "this sha has no build".
    branch="${1:?run-for-sha needs a branch}"; shift
    sha="${1:?run-for-sha needs a sha}"; shift
    # Enough runs to find the sha among its neighbours. A branch accumulates
    # runs per push and per workflow, so the sha being asked about can sit
    # several entries down even when it is the current head.
    limit=20
    while [ $# -gt 0 ]; do
      case "$1" in
        --limit) limit="${2:?}"; shift 2 ;;
        *) die "run-for-sha: unknown arg $1" ;;
      esac
    done
    if [ "$be" = "github" ]; then
      # `headSha` is the field that makes this answerable at all; `runs` omits
      # it, which is why that op cannot be reused here.
      #
      # NEWEST FIRST, then the FIRST match is taken: `gh run list` returns runs
      # newest-first, and a sha can carry several (a rerun, or several
      # workflows). The newest is the live answer; older ones for the same sha
      # are superseded by the same argument that superseded runs for older shas.
      # THE SHA ASKED ABOUT IF THERE IS ONE, ELSE THE NEWEST RUN ON THE BRANCH —
      # and `sha` in the output says WHICH, because a caller that could not tell
      # the two apart would be back to the branch-scoped guessing this op exists
      # to end.
      #
      # WHY IT FALLS BACK AT ALL, rather than reporting nothing. Filtering to
      # the asked-for sha and stopping makes the most important case invisible:
      # a run IN FLIGHT for a commit the branch has already moved past reports
      # identically to no run at all, so a caller cannot distinguish *CI has not
      # started yet* from *CI is busy answering about the past*. The second is
      # the state that had two merge waiters reporting on superseded runs on
      # 2026-08-30, and it is exactly what a caller needs to see.
      #
      # IT STILL DECIDES NOTHING (Principle 3). It reports the run it found and
      # the sha that run is for; whether that sha being different from the one
      # asked about means "superseded" is the caller's rule. This collects.
      gh run list --branch "$branch" --limit "$limit" \
        --json headSha,conclusion,status,startedAt,url 2>/dev/null \
        | jq -c --arg sha "$sha" \
            '(map(select(.headSha == $sha)) | .[0]) // .[0]
             | select(. != null)
             | {sha:.headSha, status:.status,
                conclusion:(if (.conclusion // "") == "" then null else .conclusion end),
                url:.url, startedAt:.startedAt}' 2>/dev/null || true
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
    if [ "$(tracker_scheme)" = "jira" ]; then
      # Jira, resolved through the REST API — DISPATCHED ON `Tracker`, never on
      # `backend()`: a Bitbucket repo tracking in Jira is the normal enterprise
      # case, so the git host is irrelevant here (see the Jira helpers up top).
      #
      # The inbox is "my open tickets": assigned to me and unresolved. That is
      # the story's title — *my Jira tickets are in the inbox* — and it maps the
      # board's "open tracker issues no plan references" onto the person reading
      # the board. `PLOT_JIRA_JQL` overrides it for a team that wants a wider or
      # narrower inbox. ORDER BY created DESC so the newest ticket is first, the
      # same order `createdAt` gives the GitHub arm.
      jira_require_config
      jql="${PLOT_JIRA_JQL:-assignee = currentUser() AND resolution = EMPTY ORDER BY created DESC}"
      # maxResults bounds ONE page. The inbox is small by construction (a
      # person's open tickets), so no nextPageToken loop is needed; the caller's
      # --limit caps it, else Jira's default page. v2 `search/jql` takes the same
      # params as v3 but returns `summary`/`description` as plain strings.
      max="${limit:-50}"
      # jq builds the query string so a JQL with spaces/quotes is encoded once,
      # not hand-escaped. --data-urlencode via curl -G keeps the token out of the
      # URL and the JQL correctly encoded.
      raw="$(jira_curl "/rest/api/2/search/jql" \
               -G \
               --data-urlencode "jql=$jql" \
               --data-urlencode "fields=summary,created" \
               --data-urlencode "maxResults=$max")"; curl_rc=$?
      body="$(jira_check "$raw" "$curl_rc")" || exit $?
      # `number` is the Jira KEY (PROJ-123), a string — #447 taught the parser to
      # read that form. `url` is built from the base + /browse/<key>; Jira's
      # search payload carries no browse URL, and the base is ours to know
      # (Principle 3: this script is the one place that knows a host URL's shape).
      base="$(tracker_base_url)"
      printf '%s' "$body" | jq -c --arg base "$base" '.issues[]? | {
          number: .key,
          title: (.fields.summary // ""),
          url: ($base + "/browse/" + .key),
          createdAt: (.fields.created // "")
        }'
    elif [ "$be" = "github" ]; then
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
    if [ "$(tracker_scheme)" = "jira" ]; then
      # Jira, dispatched on `Tracker` not `backend()` — the same rule issue-list
      # follows. `num` is a Jira KEY (PROJ-123), read off issue-list moments ago.
      #
      # v2, not v3: `description` arrives as a plain string here, where v3 returns
      # an ADF tree. The body is a problem statement for /plot-idea, so a string
      # is the right shape — see the Jira helpers up top for the full reasoning.
      #
      # A missing issue is a FAILURE, not an empty body — exactly as the GitHub
      # and Bitbucket arms treat it: the caller named a key it read off this same
      # adapter, so its absence (Jira answers 404) means the tracker moved under
      # the board. jira_check turns that 404 into exit 3 with empty stdout.
      jira_require_config
      raw="$(jira_curl "/rest/api/2/issue/$num" \
               -G --data-urlencode "fields=summary,description")"; curl_rc=$?
      body_json="$(jira_check "$raw" "$curl_rc")" || exit $?
      base="$(tracker_base_url)"
      printf '%s' "$body_json" | jq -c --arg base "$base" '{
          number: .key,
          title: (.fields.summary // ""),
          body: (.fields.description // ""),
          url: ($base + "/browse/" + .key)
        }'
    elif [ "$be" = "github" ]; then
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

  rate-limit)
    # Report the remaining API budget, per API. GitHub has TWO separate budgets
    # (GraphQL and REST/core), and exhausting one says nothing about the other.
    # Bitbucket has a single budget and no way to query it, so it reports unknown.
    #
    # Output: JSON object with the remaining budget per API:
    #   {"graphql":{"remaining":N,"limit":N,"reset":N},"core":{"remaining":N,"limit":N,"reset":N}}
    #   where N is a number, or each field is "unknown" when the host cannot answer.
    #
    # `reset` is epoch seconds — when the budget resets. A caller that wants
    # "time until reset" computes it from now.
    #
    # The call itself is FREE — `gh api rate_limit` consumes neither bucket.
    # Measured 2026-08-27: three consecutive readings, all `used=0`.
    #
    # This op REPORTS; it does not decide. A caller that wants to fall back when
    # one budget is spent reads this, compares remaining to zero, and acts.
    if [ "$be" = "github" ]; then
      if out="$(gh api rate_limit 2>/tmp/plot-host-err.$$)"; then
        rm -f "/tmp/plot-host-err.$$"
        # The payload has `resources.graphql` and `resources.core`, each with
        # `remaining`, `limit`, and `reset`. Extract the two we care about.
        jq -c '{
          graphql: {
            remaining: .resources.graphql.remaining,
            limit: .resources.graphql.limit,
            reset: .resources.graphql.reset
          },
          core: {
            remaining: .resources.core.remaining,
            limit: .resources.core.limit,
            reset: .resources.core.reset
          }
        }' <<<"$out"
      else
        err="$(cat "/tmp/plot-host-err.$$" 2>/dev/null)"; rm -f "/tmp/plot-host-err.$$"
        # The host could not be asked. Report unknown rather than failing outright,
        # because this is informational — a caller that cannot read the budget
        # should proceed with the default path, not error out.
        echo '{"graphql":{"remaining":"unknown","limit":"unknown","reset":"unknown"},"core":{"remaining":"unknown","limit":"unknown","reset":"unknown"}}'
        echo "plot-host: rate-limit query failed: $err" >&2
      fi
    else
      # Bitbucket has no budget reporting. `unknown` is not `zero` — a host that
      # cannot answer the budget question must report unknown, because zero means
      # *spent*, and a caller that reads "cannot ask" as "exhausted" will take
      # the expensive fallback path forever.
      echo '{"graphql":{"remaining":"unknown","limit":"unknown","reset":"unknown"},"core":{"remaining":"unknown","limit":"unknown","reset":"unknown"}}'
    fi
    ;;

  limit)
    # WHAT IS THIS CONNECTOR'S LIMIT, AND HOW WELL DOES IT KNOW IT?
    #
    # One JSON line per bucket the connector meters:
    #   {"connector":"github","bucket":"graphql","limit":5000,
    #    "remaining":1236,"reset":1788269670,"basis":"actual"}
    #
    # `basis` is `actual` where the connector reported the numbers, `predicted`
    # where this adapter supplied them from experience, and `unknown` where it
    # reports nothing and there is nothing to predict. `limit`, `remaining` and
    # `reset` are numbers or null; `reset` is epoch SECONDS.
    #
    # NOT `gh api rate_limit`, AND THAT IS THE WHOLE POINT OF THIS OP. Measured
    # 2026-09-01 in a quiet moment, same account, seconds apart:
    #
    #   gh api rate_limit    graphql: 5000/5000, used 0
    #   a real call's header X-Ratelimit-Remaining: 1236, Used: 3764
    #
    # 3764 calls spent, reported as zero. The endpoint is wrong when nothing is
    # wrong, so `graphql_budget_spent()` above — which reads it and tests
    # `-eq 0` — has never been able to fire. The authority is the header on a
    # response that actually came back.
    #
    # THIS CALL SPENDS ONE REQUEST, AND SAYS SO. The design wants the headers of
    # a call that was going to happen anyway, and the hot call is `gh pr list`,
    # which is `gh`'s own GraphQL wrapper and exposes no headers. Rewriting it
    # as `gh api graphql` is the transport choice, which belongs to
    # `bug/one-router-chooses-the-path`. Until then this asks the cheapest real
    # question there is — `{viewer{login}}` — and reports what its response
    # carried. One request against the bucket it reports is an honest cost; a
    # free reading of the wrong number is not.
    #
    # ONE BUCKET, NOT TWO. A response reports the bucket IT spent, in
    # `X-RateLimit-Resource`. Reporting `core` from a GraphQL response would be
    # inventing a reading nobody took — the mistake `rate_limit` makes by
    # answering for both at once.
    if [ "$be" = "github" ]; then
      _hdr_tmp="/tmp/plot-host-limit.$$"
      if gh api graphql -f query='{viewer{login}}' --include >"$_hdr_tmp" 2>/dev/null; then
        # `--include` prints the headers, then a blank line, then the body.
        # Header names are matched case-insensitively: `gh` prints
        # `X-Ratelimit-Limit` while GitHub documents `X-RateLimit-Limit`, and a
        # case-sensitive match reads a present header as absent.
        _hv() { LC_ALL=C grep -im1 "^$1:" "$_hdr_tmp" | sed 's/^[^:]*:[[:space:]]*//' | tr -d '\r'; }
        _lim="$(_hv 'X-RateLimit-Limit')"
        _rem="$(_hv 'X-RateLimit-Remaining')"
        _rst="$(_hv 'X-RateLimit-Reset')"
        _res="$(_hv 'X-RateLimit-Resource')"
        rm -f "$_hdr_tmp"
        # A number or null — never a quoted "unknown", and never 0 standing in
        # for absent. `jq -n` with `--argjson` refuses a non-number, so each
        # value is tested first and passed as the literal `null` otherwise.
        _num() { [[ "$1" =~ ^[0-9]+$ ]] && echo "$1" || echo null; }
        if [ -n "$_lim" ]; then
          jq -cn \
            --arg bucket "${_res:-graphql}" \
            --argjson limit "$(_num "$_lim")" \
            --argjson remaining "$(_num "$_rem")" \
            --argjson reset "$(_num "$_rst")" \
            '{connector:"github",bucket:$bucket,limit:$limit,remaining:$remaining,reset:$reset,basis:"actual"}'
        else
          # The call answered and carried no limit header. GitHub always sends
          # them, so this is a proxy or an enterprise instance that strips them:
          # unknown, and never free.
          echo '{"connector":"github","bucket":"","limit":null,"remaining":null,"reset":null,"basis":"unknown"}'
        fi
      else
        rm -f "$_hdr_tmp"
        # The host could not be asked. Exit 3 rather than printing `unknown`:
        # *could not ask* and *asked, and it reports no limit* are different
        # facts, and the port keeps them apart as `failed` versus an answered
        # `unknown` reading.
        die3 "limit: could not read the host's rate-limit headers"
      fi
    elif [ "$be" = "bitbucket" ]; then
      # Bitbucket meters, and sends no `X-RateLimit-*`. So the number is this
      # adapter's, from experience — 1000 requests/hour for an authenticated
      # account — and it is tagged `predicted` because that is what it is.
      #
      # A PREDICTION IS NOT A LIE AND NOT A FAILURE. It is answered: the adapter
      # is telling the truth about what it knows. A caller reads the basis and
      # decides how much to trust it; a `throttled` observed during the session
      # is what corrects it.
      echo '{"connector":"bitbucket","bucket":"api","limit":1000,"remaining":null,"reset":null,"basis":"predicted"}'
    else
      echo "{\"connector\":\"$be\",\"bucket\":\"\",\"limit\":null,\"remaining\":null,\"reset\":null,\"basis\":\"unknown\"}"
    fi
    ;;

  ci-limit)
    # The CI connector's limit, which is a THIRD axis and does not follow the
    # git host. This repo runs GitHub Actions on a GitHub remote; `ekzweb` runs
    # Jenkins against Bitbucket. `ci_backend()` already resolves it separately.
    #
    # JENKINS IS THE `predicted` CASE THE DESIGN NAMES. A Jenkins instance
    # reports no rate limit — there is no header and no endpoint to ask — so the
    # ceiling is this adapter's estimate of what a shared controller tolerates,
    # tagged for what it is. It is NOT unlimited: a Jenkins that is hammered
    # refuses, and the refusal is what corrects the estimate.
    _ci="$(ci_backend)"
    case "$_ci" in
      jenkins)
        echo '{"connector":"jenkins","bucket":"","limit":60,"remaining":null,"reset":null,"basis":"predicted"}'
        ;;
      '' | none)
        # No CI connector configured, so there is nothing to meter. An empty
        # answer, not a limit of zero.
        ;;
      *)
        # `ci_backend()` validates nothing, and neither does this — the list is
        # open, and GitLab and Trello are named as next. A connector nobody has
        # written an estimate for answers `unknown`, which is the honest word.
        echo "{\"connector\":\"$_ci\",\"bucket\":\"\",\"limit\":null,\"remaining\":null,\"reset\":null,\"basis\":\"unknown\"}"
        ;;
    esac
    ;;

  *)
    die "unknown op '$op' (backend|default-branch|pr-state|pr-create|pr-merge|pr-list|issue-list|issue-view|pr-body|rate-limit|limit|ci-limit)"
    ;;
esac
