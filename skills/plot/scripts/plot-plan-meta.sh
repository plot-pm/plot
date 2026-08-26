#!/usr/bin/env bash
# Plot helper: parse plan files into structured JSON.
# Usage: plot-plan-meta.sh <plan-file>... [--prefixes 'idea|feature|bug|docs|infra']
# Output: one compact JSON object per input file, one per line (JSON lines).
#         Exit 0 always; parse problems are reported in the JSON, never as a
#         crash. Missing files yield an error object (emitted first).
# Designed for small-model consumption: structured output, no interpretation.
#
# This is the ONE place that knows what a plan file looks like. Anything that
# needs plan metadata (phase, type, branches, PR numbers) must call this
# script instead of grepping plan files itself — the parser is the format
# contract. The contract is specified by example in test/reconcile/fixtures/
# (one fixture per supported shape) and enforced by test/reconcile/.
#
# Accepts many files in one invocation and parses them in a single awk pass —
# cheap enough to run over a 100-plan repo on every /plot. (The first version
# spawned a subprocess chain per file; at ~80ms/file that priced the parser
# out of ambient use.)
#
# Two plan formats are recognized:
#
#   canonical    the plan template's `## Status` body section:
#                    - **Phase:** Approved
#                    - **Type:** feature
#                (bullet, bold, and plain `Phase: ...` variants all accepted)
#
#   frontmatter  YAML front matter at the top of the file:
#                    ---
#                    status: Approved
#                    phase: Approved
#                    type: feature
#                    ---
#                `status:` is the primary field; `phase:` is reported as the
#                alternate so callers can flag disagreement between the two.
#
# Front matter wins when both are present (it is the machine-facing surface).
# A file with neither is reported as format "none" (pre-plot / legacy plan).
#
# The IMPLEMENTATION section (which branches, in which waves, with which PRs)
# has TWO spellings, and this parser reads both:
#
#   ## Branches  (old)   the branch rides the list line, meta mixed with prose:
#                            ### Removed
#                            - `bug/foo` — loses its half → #300
#
#   ## Waves     (new)   the `### ` heading carries the meta, the line is prose:
#                            ### Removed (Branch: bug/foo, PR: #300)
#                            - loses its half
#
# Both emit the SAME branches/prs/waves arrays. The new shape is the format Plot
# writes and documents; the old one is kept readable because a format change owes
# its estate a migration that moves files one at a time, and a plan moved one
# commit before the parser learns the shape must not read as silently empty —
# the failure that makes a plan disappear from the fleet scan and pass the
# delivery gate. In the new shape the branch comes from the HEADING, so a
# backticked name in a description cannot be mistaken for a branch — the defect
# the old shape invited (a second path-shaped token on a line read as a phantom
# branch) is structurally impossible.
#
# Phase values are normalized by scanning whitespace-separated tokens for the
# first known phase word — so decorated real-world values like
# "Delivered (2026-06-29) — split done" normalize to "delivered". A non-empty
# value with no known token normalizes to "UNKNOWN"; an absent field to "NONE".
#
# JSON fields:
#   file           the path given
#   format         canonical | frontmatter | none
#   phase_raw      primary phase value as written ("" if absent)
#   phase          normalized: draft|design|approved|delivered|released|
#                  rejected|superseded|UNKNOWN|NONE
#                  `design` is a phase of its own, not a synonym for anything:
#                  a plan in Design cannot yet be handed to development because
#                  it needs a spec, a spike or a tracer bullet first. That is a
#                  different statement from "approved and nobody has started",
#                  which is a queue. (`ready-for-review`/`in-review` DO
#                  normalize onto `approved` — those are synonyms; this is not.)
#   phase_alt_raw  secondary value when the file carries two (front matter
#                  status: AND phase:), else ""
#   phase_alt      normalized phase_alt_raw (NONE when absent)
#   type           normalized plan type (feature|bug|docs|infra or "")
#   title          plan title: front matter `title:` wins, else the first H1
#                  (`# ...`) line, else "" (board-facing display field)
#   sprint         sprint slug the plan belongs to (`## Status` `Sprint:` or
#                  front matter `sprint:`); "" if absent or an HTML-comment
#                  placeholder
#   story          story slug the plan belongs to (`## Status` `Story:` or
#                  front matter `story:`); "" if absent or a placeholder
#   assignee       github handle from the `## Approval` `Assignee:` line or
#                  front matter `assignee:`; "" if absent
#   branches       branch names, sorted and unique, read from EITHER spelling:
#                  the old `## Branches` section (backtick-quoted in the list
#                  line, matching the known prefixes) OR the new `## Waves`
#                  section (`Branch:` in a `### ` heading — see below). Both
#                  spellings emit the same array; a plan carries one or the
#                  other, and the parser reads both so a migration that moves
#                  files one at a time never makes a plan silently empty.
#                  NOTE: per-branch annotations (`<!-- deferred: ... -->`,
#                  `<!-- claimed: ... -->`) bind to the LINE carrying the
#                  backticked branch name. An annotation on a wrapped
#                  continuation line is not seen — keep it on the branch line.
#                  `<!-- deferred -->` (bare, no colon) sets the flag with no
#                  reason; `waves[].branches[].deferred_reason` carries the
#                  sentence after the colon, "" where none was written.
#   prs            PR numbers, sorted and unique, read from EITHER spelling:
#                  `→ #NNN` / `→ owner/repo#NNN` links in the `## Branches`
#                  section, OR `PR: #NNN` in a `## Waves` `### ` heading. The
#                  repo part is matched but not retained: callers ask which PRs
#                  are a plan's evidence, and plot-host.sh resolves where each
#                  one lives. An absent PR contributes nothing — not "", not 0 —
#                  the same rule `Issue:` follows.
#   malformed_prs  near-miss annotations, verbatim — currently `→#NNN` with no
#                  space. Reported rather than dropped: "no annotation" is a
#                  claim the sweep acts on, so a typo that reads as absence
#                  sends a human to add an annotation already present. [] when
#                  the plan has none.
#   changelog      the plan's `## Changelog` entries, one string per bullet, in
#                  document order; [] when the plan has no changelog or an
#                  unfilled one. This is the one field that says WHAT A PLAN
#                  CHANGES, which title and story do not.
#                  ENTRIES, not lines: a bullet wrapped across several lines is
#                  one entry with the continuation lines joined by a single
#                  space (9 of the 34 changelogs in the origin repo wrap, so
#                  line-per-line would have shredded a quarter of them). An
#                  INDENTED bullet folds into the entry above it the same way:
#                  a sub-point is not a release note of its own.
#                  Non-bullet prose in the section is NOT an entry — 8 plans
#                  close their changelog with a "Board impact:" paragraph, which
#                  is a note to a reviewer rather than a release note. Comment
#                  interiors stay non-content, as everywhere else in this parser,
#                  so the template's guidance block contributes nothing.
#   long_wave_names wave names too long to be labels — a report, not a refusal.
#                  A wave name is a label (`Shaped`, `Gated`, `Offered first`);
#                  a sentence-length heading is a plan-authoring mistake the
#                  board can only render badly. Names past a threshold judgement
#                  (LONG_WAVE_NAME_MAX, set from the estate's longest legitimate
#                  name) are listed here in document order, so the reconcile
#                  sweep can surface them for a fix. Reads the SAME wave names
#                  waves[] carries — never a second scan of the file — so both
#                  the ## Branches and ## Waves spellings are covered. [] when
#                  every wave name is a label; ALWAYS present, so a consumer
#                  never reads undefined. The plan still parses in full: waves[]
#                  is unchanged and no name is shortened or dropped.
#   issues         tracker issue numbers this plan answers, from the `## Status`
#                  `Issue:` line or front matter `issue:` (sorted, unique).
#                  A DEDICATED field, never a scan of the body for `#NNN`: a
#                  body scan cannot tell a signal from a citation, which is the
#                  same reason `prs` reads only `→ #NNN`. Accepts a list
#                  (`Issue: #226, #228`) because one plan can answer several.
#   review_raw     the plan's review-channel answer as written (`## Status`
#                  `Review:` or front matter `review:`); "" if absent
#   review         normalized: pr|in-session|ballot|UNKNOWN|NONE
#   impl_raw       the plan's implementation-home answer as written
#                  (`## Status` `Impl:` or front matter `impl:`); "" if absent
#   impl           normalized: own-branches|same-branch|other-repo|none|
#                  UNKNOWN|NONE ("nowhere" is accepted for none; free-text
#                  like "here, own branches" normalizes by token)
#   released_raw   the release transition record as written (`## Status`
#                  `Released:` or front matter `released:` — date and version).
#                  Empty until /plot-release records it; the tag stays the git
#                  truth and this merely reflects it.
#   design_raw     the design transition record as written (`## Status`
#                  `Design:` or front matter `design:` — who/when, and what the
#                  design work is); "" if absent. Reported for any plan that
#                  carries the line, whatever its phase: a plan that WENT
#                  THROUGH design keeps the record after moving on, exactly as
#                  `approved_raw` outlives the Approved phase.
#   approved_raw   the approval transition record as written (`## Status`
#                  `Approved:` or front matter `approved:` — who/when/channel,
#                  e.g. "2026-07-30, alice, in-session"); "" if absent
#   delivered_raw  the delivery transition record as written (`## Status`
#                  `Delivered:` or front matter `delivered:` — a date, often
#                  bare); "" if absent. NOT the same statement as
#                  `phase: delivered`: a plan can carry the phase with the
#                  record left empty (a bookkeeping fault plot-reconcile-scan
#                  reports), and a consumer that needs a DATE must read this
#                  rather than infer one from the phase.
#   started_raw    implementation-start records, one raw string per
#                  `Started:` line in `## Status` (repeatable; front matter
#                  `started:` contributes one entry); [] if absent.
#                  Exception to "front matter wins": started is ADDITIVE —
#                  canonical entries and the front-matter entry merge
#                  (canonical first, front matter appended)
#   rounds         how many rounds of /plot:challenge-the-plan the plan has been
#                  through, read from `## Status` `Rounds:` first, YAML front
#                  matter `rounds:` second, and the `CHALLENGE-THE-PLAN-METADATA`
#                  block last. The field wins a disagreement (the file states
#                  what the reader sees), and the block remains readable so the
#                  40 plans carrying only a block go on reporting correctly.
#                  **OMITTED ENTIRELY when no source carries a readable round**
#                  — absent is not zero. A plan nobody has interrogated and a
#                  plan interrogated to no effect want opposite reactions from a
#                  reader, so the field is missing rather than 0, the same rule
#                  `claimed`/`eligible` follow on the board side. A malformed or
#                  truncated block is reported the same way: the round is simply
#                  absent, and every other field still parses.
#
# title/sprint/story/assignee are the board-facing surface (`@plot-pm/board`
# consumes this script instead of parsing plans itself). Front matter wins over
# the canonical body for every field, matching the `status:`/`phase:` rule.

set -uo pipefail

prefixes='idea|feature|bug|docs|infra'
tracker_override=''      # set by --tracker; overrides the config read below
tracker_override_set=0
files=()
missing=()
while [ $# -gt 0 ]; do
  case "$1" in
    --prefixes) prefixes="${2:?--prefixes needs a value}"; shift 2 ;;
    # --tracker names the tracker directly, bypassing plot-config.sh. It exists
    # for the contract tests (which parse fixtures outside any repo whose Plot
    # Config could name a tracker) and for a caller that has already resolved
    # the value once. An empty value means "GitHub", the same as no config.
    --tracker) tracker_override="${2-}"; tracker_override_set=1; shift 2 ;;
    -*) echo "plot-plan-meta: unknown flag: $1" >&2; shift ;;
    *)
      if [ -f "$1" ]; then files+=("$1"); else missing+=("$1"); fi
      shift ;;
  esac
done

if [ ${#files[@]} -eq 0 ] && [ ${#missing[@]} -eq 0 ]; then
  echo "Usage: plot-plan-meta.sh <plan-file>... [--prefixes '<alternation>']" >&2
  exit 1
fi

for f in ${missing[@]+"${missing[@]}"}; do
  printf '{"file":"%s","format":"none","error":"file not found","phase_raw":"","phase":"NONE","phase_alt_raw":"","phase_alt":"NONE","type":"","title":"","sprint":"","story":"","assignee":"","branches":[],"prs":[],"issues":[],"malformed_prs":[],"changelog":[],"long_wave_names":[],"review_raw":"","review":"NONE","impl_raw":"","impl":"NONE","design_raw":"","approved_raw":"","released_raw":"","delivered_raw":"","started_raw":[]}\n' \
    "$(printf '%s' "$f" | sed 's/\\/\\\\/g; s/"/\\"/g')"
done

[ ${#files[@]} -gt 0 ] || exit 0

# Read the tracker config to determine whether tracker-key issue references
# (`PROJ-123`) are parsed in addition to GitHub's `#N`.
#
# THIS IS THE FIRST CONFIGURATION DEPENDENCY THIS SCRIPT HAS — keep it narrow:
# read ONE key, an unreadable or missing config means GitHub (today's
# behaviour), and NEVER fail a parse for want of configuration. plot-config.sh
# exits 0 for all cases and prints an empty string when the key is absent, so a
# repo with no `## Plot Config` at all still parses exactly as it does today.
if [ "$tracker_override_set" -eq 1 ]; then
  tracker="$tracker_override"
else
  script_dir="$(dirname "${BASH_SOURCE[0]}")"
  tracker=$("$script_dir/plot-config.sh" get Tracker 2>/dev/null || true)
fi
# The value may carry a URL after the scheme (`jira https://…`), so match the
# FIRST token, lowercased. Only a tracker whose keys are `LETTERS-digits` —
# jira, linear — enables the key form; github, github-issues, plot, and absent
# all keep `#N`-only, unchanged. An unrecognized token stays GitHub too: a
# guess here would let `WONT-FIX` masquerade as an issue reference and hide a
# real ticket, which the plan interrogation explicitly rejected.
tracker_scheme=$(printf '%s' "$tracker" | tr '[:upper:]' '[:lower:]' | awk '{print $1}')
case "$tracker_scheme" in
  jira|linear) parse_key_issues=1 ;;
  *) parse_key_issues=0 ;;
esac

awk -v PREFIXES="$prefixes" -v PARSE_KEY_ISSUES="$parse_key_issues" '
function jesc(s) {
  gsub(/\\/, "\\\\", s); gsub(/"/, "\\\"", s); gsub(/\t/, "\\t", s)
  return s
}
function trim(s) { sub(/^[ \t]+/, "", s); sub(/[ \t]+$/, "", s); return s }
# Value after the first colon, stripped of bold markers / quotes / space.
function val_after_colon(s) {
  sub(/^[^:]*:/, "", s); sub(/^\**[ \t]*/, "", s)
  sub(/^"/, "", s); sub(/"$/, "", s)
  return trim(s)
}
# Template placeholders like "<!-- optional -->" mean "field absent".
function strip_placeholder(s) { return (s ~ /^<!--/) ? "" : s }
# First known phase token wins; NONE if empty; UNKNOWN otherwise.
function norm_phase(raw,   lower, toks, n, i, t) {
  if (raw == "") return "NONE"
  lower = tolower(raw)
  n = split(lower, toks, /[ \t]+/)
  for (i = 1; i <= n; i++) {
    t = toks[i]
    gsub(/^[^a-z]+/, "", t); gsub(/[^a-z-]+$/, "", t)
    if (t ~ /^(draft|design|approved|delivered|released|rejected|superseded)$/) return t
    if (t == "ready-for-review" || t == "in-review") return "approved"
  }
  return "UNKNOWN"
}
function norm_type(raw,   lower, toks, n, i, t) {
  if (raw == "") return ""
  lower = tolower(raw)
  n = split(lower, toks, /[ \t]+/)
  for (i = 1; i <= n; i++) {
    t = toks[i]
    gsub(/^[^a-z]+/, "", t); gsub(/[^a-z]+$/, "", t)
    if (t ~ /^(feature|bug|docs|infra)$/) return t
  }
  return ""
}
# Canonicalize a ceremony answer: lowercase, punctuation/space runs → "-",
# so "here, own branches" → "here-own-branches" and token checks are uniform.
function canon_answer(raw,   s) {
  s = tolower(raw)
  gsub(/[^a-z0-9]+/, "-", s)
  sub(/^-+/, "", s); sub(/-+$/, "", s)
  return s
}
function norm_review(raw,   s) {
  if (raw == "") return "NONE"
  s = "-" canon_answer(raw) "-"
  if (s ~ /-in-session-/) return "in-session"
  if (s ~ /-ballot-/) return "ballot"
  if (s ~ /-pr-/) return "pr"
  return "UNKNOWN"
}
function norm_impl(raw,   s) {
  if (raw == "") return "NONE"
  s = "-" canon_answer(raw) "-"
  if (s ~ /-own-branches-/) return "own-branches"
  if (s ~ /-same-branch-/) return "same-branch"
  if (s ~ /-other-repo-/) return "other-repo"
  if (s ~ /-none-/ || s ~ /-nowhere-/) return "none"
  return "UNKNOWN"
}
function reset_state() {
  fm_status = ""; fm_phase = ""; fm_type = ""
  fm_title = ""; fm_sprint = ""; fm_story = ""; fm_assignee = ""
  fm_review = ""; fm_impl = ""; fm_approved = ""; fm_started = ""; fm_released = ""
  fm_delivered = ""; fm_design = ""
  fm_rounds = ""
  canon_phase = ""; canon_type = ""
  canon_sprint = ""; canon_story = ""; canon_assignee = ""
  canon_review = ""; canon_impl = ""; canon_approved = ""; canon_released = ""
  canon_delivered = ""; canon_design = ""
  canon_rounds = ""
  h1_title = ""
  # "" means the plan carries no readable round — NOT zero. Emitted by omitting
  # the field, so a consumer cannot mistake "never interrogated" for "asked
  # nothing".
  block_rounds = ""
  in_fm = 0; section = ""; in_comment = 0; in_challenge = 0; in_fence = 0; branches_seen = 0; waves_seen = 0
  delete branches; n_branches = 0
  delete prs; n_prs = 0
  delete malformed_prs; n_malformed_prs = 0
  fm_issue = ""; canon_issue = ""
  delete issues; n_issues = 0
  delete wave_names; delete wave_of; delete wave_seq; delete wave_count
  delete deferred_of; delete deferred_why; delete claimed_of; delete ordered_b; n_waves = 0
  delete started; n_started = 0
  fm_changelog = ""
  delete changelog; n_changelog = 0; changelog_seen = 0; cl_open = 0
}
function emit_record(   fmt, praw, palt_raw, traw, title, sprint, story, assignee, review, impl, design, approved, delivered, issue, issue2, i, j, v, is_dup, out, sorted_b, sorted_p, sorted_i, nb, np, ni, num_issues, str_issues, n_num_i, n_str_i, issue_is_str) {
  if (fm_status != "" || fm_phase != "") {
    fmt = "frontmatter"
    praw = (fm_status != "") ? fm_status : fm_phase
    palt_raw = (fm_status != "" && fm_phase != "") ? fm_phase : ""
    traw = fm_type
  } else if (canon_phase != "") {
    fmt = "canonical"; praw = canon_phase; palt_raw = ""; traw = canon_type
  } else {
    fmt = "none"; praw = ""; palt_raw = ""; traw = ""
  }
  # Board-facing fields: front matter wins over the canonical body; H1 is the
  # title fallback. Placeholders ("<!-- ... -->") count as absent.
  title    = strip_placeholder((fm_title    != "") ? fm_title    : h1_title)
  sprint   = strip_placeholder((fm_sprint   != "") ? fm_sprint   : canon_sprint)
  story    = strip_placeholder((fm_story    != "") ? fm_story    : canon_story)
  assignee = strip_placeholder((fm_assignee != "") ? fm_assignee : canon_assignee)
  review   = strip_placeholder((fm_review   != "") ? fm_review   : canon_review)
  impl     = strip_placeholder((fm_impl     != "") ? fm_impl     : canon_impl)
  design   = strip_placeholder((fm_design   != "") ? fm_design   : canon_design)
  approved = strip_placeholder((fm_approved != "") ? fm_approved : canon_approved)
  released = strip_placeholder((fm_released != "") ? fm_released : canon_released)
  delivered = strip_placeholder((fm_delivered != "") ? fm_delivered : canon_delivered)
  if (fm_started != "" && strip_placeholder(fm_started) != "") started[++n_started] = fm_started
  # `Issue:` names the tracker signals this plan answers, and it is a DEDICATED
  # field rather than a scan of the body for `#NNN`. A body scan cannot tell a
  # signal from a citation: plans in this repo mention PR numbers constantly,
  # and one of them cites `#226`, `#227`, `#228` as history in its Motivation
  # while naming `PR #232` two sections later. That is the same ambiguity `prs`
  # already answered by reading only `-> #NNN` — one field, one meaning.
  #
  # A LIST, because one plan can answer several signals; the plan that
  # introduced this field subsumes three.
  issue = strip_placeholder((fm_issue != "") ? fm_issue : canon_issue)
  # GitHub-style `#N` is parsed everywhere, regardless of tracker.
  while (match(issue, /#[0-9]+/)) {
    issues[++n_issues] = substr(issue, RSTART + 1, RLENGTH - 1)
    issue = substr(issue, RSTART + RLENGTH)
  }
  # Jira-style `PROJ-123` is parsed ONLY when Tracker: names a non-GitHub
  # tracker (jira, linear). PARSE_KEY_ISSUES is set by the shell before the awk
  # invocation, based on plot-config.sh reading the Tracker key. Missing config
  # defaults to 0 (GitHub behaviour), so this never fires in a repo with no
  # config — the test in this branch proves that (Done-when item 6).
  #
  # THE PATTERN is `[A-Z]+-[0-9]+` anchored to word boundaries by iterating
  # through the string. A greedy match of the whole field would capture only
  # one; the loop mirrors the `#N` extraction above.
  if (PARSE_KEY_ISSUES == 1) {
    issue2 = strip_placeholder((fm_issue != "") ? fm_issue : canon_issue)
    while (match(issue2, /[A-Z][A-Z0-9]*-[0-9]+/)) {
      issues[++n_issues] = substr(issue2, RSTART, RLENGTH)
      issue2 = substr(issue2, RSTART + RLENGTH)
    }
  }
  # Insertion sort + dedupe (portable: no gawk asort).
  nb = 0
  for (i = 1; i <= n_branches; i++) {
    for (j = 1; j <= nb && sorted_b[j] != branches[i]; j++) ;
    if (j <= nb) continue
    for (j = nb; j >= 1 && sorted_b[j] > branches[i]; j--) sorted_b[j+1] = sorted_b[j]
    sorted_b[j+1] = branches[i]; nb++
  }
  np = 0
  for (i = 1; i <= n_prs; i++) {
    for (j = 1; j <= np && sorted_p[j] != prs[i]+0; j++) ;
    if (j <= np) continue
    for (j = np; j >= 1 && sorted_p[j] > prs[i]+0; j--) sorted_p[j+1] = sorted_p[j]
    sorted_p[j+1] = prs[i]+0; np++
  }
  # Issues: sort numeric (GitHub) issues first, then string (Jira) keys.
  # Separate into two arrays, sort each, then concatenate.
  n_num_i = 0; n_str_i = 0
  for (i = 1; i <= n_issues; i++) {
    v = issues[i]
    if (v ~ /^[0-9]+$/) {
      # Numeric: check for duplicate, then insert sorted.
      is_dup = 0
      for (j = 1; j <= n_num_i; j++) if (num_issues[j] == v + 0) { is_dup = 1; break }
      if (!is_dup) {
        for (j = n_num_i; j >= 1 && num_issues[j] > v + 0; j--) num_issues[j+1] = num_issues[j]
        num_issues[j+1] = v + 0; n_num_i++
      }
    } else {
      # String (Jira key): check for duplicate, then insert sorted.
      is_dup = 0
      for (j = 1; j <= n_str_i; j++) if (str_issues[j] == v) { is_dup = 1; break }
      if (!is_dup) {
        for (j = n_str_i; j >= 1 && str_issues[j] > v; j--) str_issues[j+1] = str_issues[j]
        str_issues[j+1] = v; n_str_i++
      }
    }
  }
  # Concatenate: numeric first, then string (matches the field ordering the
  # board expects — GitHub issues before Jira keys when both are present).
  ni = 0
  for (i = 1; i <= n_num_i; i++) sorted_i[++ni] = num_issues[i]
  for (i = 1; i <= n_str_i; i++) sorted_i[++ni] = str_issues[i]
  delete issue_is_str
  for (i = 1; i <= n_str_i; i++) issue_is_str[str_issues[i]] = 1
  out = "{\"file\":\"" jesc(cur_file) "\",\"format\":\"" fmt "\""
  out = out ",\"phase_raw\":\"" jesc(praw) "\",\"phase\":\"" norm_phase(praw) "\""
  out = out ",\"phase_alt_raw\":\"" jesc(palt_raw) "\",\"phase_alt\":\"" norm_phase(palt_raw) "\""
  out = out ",\"type\":\"" norm_type(traw) "\""
  out = out ",\"title\":\"" jesc(title) "\",\"sprint\":\"" jesc(sprint) "\""
  out = out ",\"story\":\"" jesc(story) "\",\"assignee\":\"" jesc(assignee) "\""
  out = out ",\"branches\":["
  for (i = 1; i <= nb; i++) out = out (i > 1 ? "," : "") "\"" jesc(sorted_b[i]) "\""
  out = out "],\"prs\":["
  for (i = 1; i <= np; i++) out = out (i > 1 ? "," : "") sorted_p[i]
  out = out "],\"issues\":["
  for (i = 1; i <= ni; i++) {
    # Numeric issues output as JSON numbers; string issues (Jira keys) as quoted.
    if (sorted_i[i] in issue_is_str)
      out = out (i > 1 ? "," : "") "\"" jesc(sorted_i[i]) "\""
    else
      out = out (i > 1 ? "," : "") sorted_i[i]
  }
  out = out "],\"malformed_prs\":["
  for (i = 1; i <= n_malformed_prs; i++) out = out (i > 1 ? "," : "") "\"" jesc(malformed_prs[i]) "\""
  out = out "]"
  # Document order, never sorted: a changelog is a narrative sequence, and the
  # first entry is the headline. Front matter wins, as it does for every other
  # field, and contributes exactly one entry.
  if (fm_changelog != "" && strip_placeholder(fm_changelog) != "") {
    delete changelog; n_changelog = 1; changelog[1] = strip_placeholder(fm_changelog)
  }
  out = out ",\"changelog\":["
  for (i = 1; i <= n_changelog; i++) out = out (i > 1 ? "," : "") "\"" jesc(changelog[i]) "\""
  out = out "]"
  # waves[]: branches grouped by `### ` subheading, in document order. A plan
  # with no subheadings yields one wave with an empty name.
  out = out ",\"waves\":["
  for (w = 1; w <= n_waves; w++) {
    out = out (w > 1 ? "," : "") "{\"name\":\"" jesc(wave_names[w]) "\",\"branches\":["
    first = 1
    for (i = 1; i <= n_branches; i++) {
      if (wave_of[i] != w) continue
      out = out (first ? "" : ",") "{\"branch\":\"" jesc(ordered_b[i]) "\",\"deferred\":" deferred_of[i] \
            ",\"deferred_reason\":\"" jesc(deferred_why[i]) "\"" \
            ",\"claimed\":\"" jesc(claimed_of[i]) "\"}"
      first = 0
    }
    out = out "]}"
  }
  out = out "]"
  # long_wave_names[]: wave names past LONG_WAVE_NAME_MAX, in document order. A
  # wave name is a label (`Shaped`, `Gated`, `Offered first`); a sentence-length
  # heading is a plan-authoring mistake the board can only render badly. This
  # REPORTS the offenders — a top-level field, never a change to waves[], so the
  # plan still parses and every existing consumer of waves[] is untouched. The
  # threshold is a JUDGEMENT baked into one constant (see LONG_WAVE_NAME_MAX):
  # the longest legitimate name in the estate is `Offered first` at 13, the
  # offender that motivated this is 53. Measured over the whole array so BOTH
  # spellings (## Branches and ## Waves) are covered from one place. length()
  # here is the awk byte length, which can exceed the character count for a name
  # with a multi-byte dash — harmless: the threshold clears every real name by
  # tens of bytes either way, so the verdict never turns on the last byte.
  out = out ",\"long_wave_names\":["
  lwn = 0
  for (w = 1; w <= n_waves; w++) {
    if (length(wave_names[w]) > LONG_WAVE_NAME_MAX) {
      out = out (lwn > 0 ? "," : "") "\"" jesc(wave_names[w]) "\""
      lwn++
    }
  }
  out = out "]"
  out = out ",\"review_raw\":\"" jesc(review) "\",\"review\":\"" norm_review(review) "\""
  out = out ",\"impl_raw\":\"" jesc(impl) "\",\"impl\":\"" norm_impl(impl) "\""
  out = out ",\"design_raw\":\"" jesc(design) "\""
  out = out ",\"approved_raw\":\"" jesc(approved) "\""
  out = out ",\"released_raw\":\"" jesc(released) "\""
  out = out ",\"delivered_raw\":\"" jesc(delivered) "\""
  out = out ",\"started_raw\":["
  for (i = 1; i <= n_started; i++) out = out (i > 1 ? "," : "") "\"" jesc(started[i]) "\""
  out = out "]"
  # Rounds: preference order: ## Status, front matter, CHALLENGE block fallback.
  # A placeholder ("<!-- optional -->") counts as absent, like Sprint/Story.
  # OMITTED, not zeroed, when no source carries a readable round.
  rounds = ""
  _r = strip_placeholder(canon_rounds)
  if (_r == "") _r = strip_placeholder(fm_rounds)
  if (_r == "") _r = block_rounds
  if (_r != "" && _r ~ /^[0-9]+$/) rounds = _r + 0
  if (rounds != "") out = out ",\"rounds\":" rounds
  out = out "}"
  print out
}
# The longest wave name that still reads as a label, not prose. A JUDGEMENT, not
# a measurement: the longest legitimate name in the estate is `Offered first`
# (13), and the offender this exists to catch is a 53-character sentence, so the
# line sits well clear of both. Reported, never enforced — a name past it makes
# `long_wave_names`, and nothing refuses the plan.
BEGIN { branch_re = "`(" PREFIXES ")/[^`]+`"; LONG_WAVE_NAME_MAX = 40 }
FNR == 1 {
  if (NR > 1) emit_record()
  reset_state()
  cur_file = FILENAME
  if ($0 ~ /^---[ \t]*$/) { in_fm = 1; next }
}
in_fm {
  if ($0 ~ /^---[ \t]*$/) { in_fm = 0; next }
  lower = tolower($0)
  if (lower ~ /^status:/ && fm_status == "") fm_status = val_after_colon($0)
  else if (lower ~ /^phase:/ && fm_phase == "") fm_phase = val_after_colon($0)
  else if (lower ~ /^type:/ && fm_type == "") fm_type = val_after_colon($0)
  else if (lower ~ /^title:/ && fm_title == "") fm_title = val_after_colon($0)
  else if (lower ~ /^sprint:/ && fm_sprint == "") fm_sprint = val_after_colon($0)
  else if (lower ~ /^story:/ && fm_story == "") fm_story = val_after_colon($0)
  else if (lower ~ /^issue:/ && fm_issue == "") fm_issue = val_after_colon($0)
  else if (lower ~ /^assignee:/ && fm_assignee == "") fm_assignee = val_after_colon($0)
  else if (lower ~ /^review:/ && fm_review == "") fm_review = val_after_colon($0)
  else if (lower ~ /^impl:/ && fm_impl == "") fm_impl = val_after_colon($0)
  else if (lower ~ /^design:/ && fm_design == "") fm_design = val_after_colon($0)
  else if (lower ~ /^approved:/ && fm_approved == "") fm_approved = val_after_colon($0)
  else if (lower ~ /^released:/ && fm_released == "") fm_released = val_after_colon($0)
  else if (lower ~ /^delivered:/ && fm_delivered == "") fm_delivered = val_after_colon($0)
  else if (lower ~ /^started:/ && fm_started == "") fm_started = val_after_colon($0)
  # A scalar `changelog:` in front matter is one entry. A YAML list is NOT read
  # here: front matter in this repo is a flat key/value surface, and guessing a
  # list grammar the format never promised would invent a contract.
  else if (lower ~ /^changelog:/ && fm_changelog == "") fm_changelog = val_after_colon($0)
  else if (lower ~ /^rounds:/ && fm_rounds == "") fm_rounds = val_after_colon($0)
  next
}
# Interior of multi-line HTML comments is non-content (template guidance
# blocks); single-line "<!-- ... -->" placeholders are unaffected.
#
# ONE exception, and it is deliberately keyed on a sentinel rather than on
# "comments that look like JSON": /plot:challenge-the-plan writes its state into
# the plan as `<!-- CHALLENGE-THE-PLAN-METADATA … END-… -->`, and the round it
# records is the only thing in there this parser reports. Everything else in the
# block (question history, category coverage) stays non-content — the script
# collects, the skill interprets.
in_comment {
  if (in_challenge && block_rounds == "" && $0 ~ /^[ \t]*"round"[ \t]*:[ \t]*[0-9]+/) {
    _r = $0
    sub(/^[ \t]*"round"[ \t]*:[ \t]*/, "", _r)
    sub(/[^0-9].*$/, "", _r)
    if (_r != "") block_rounds = _r + 0
  }
  if ($0 ~ /-->/) { in_comment = 0; in_challenge = 0 }
  next
}
/<!--/ && $0 !~ /-->/ {
  in_comment = 1
  # A truncated block never closes; it simply runs to EOF as a comment, and the
  # round stays whatever was read before the truncation — absent if the "round"
  # line was itself lost. Nothing else in the record is affected either way.
  in_challenge = ($0 ~ /CHALLENGE-THE-PLAN-METADATA/) ? 1 : 0
  next
}
# A fenced code block is illustration, never contract — the same standing rule
# comment interiors and repeated headings already follow. A plan that documents
# the plan format shows a `## Waves` or `## Branches` block inside a ``` fence,
# and those example headings must contribute no section, no branch and no PR.
#
# Measured need: waves-name-themselves shows its `## Waves` example in a fenced
# block whose `### Removed (Branch: bug/an-agent…)` headings are realistic. With
# no fence tracking the parser read them as real branches of the plan — and the
# same trick already fooled the OLD `## Branches` path (a fenced `## Branches`
# example won its first-heading-wins guard and hid the real section). Toggling on
# a fence fence-marker line closes both.
#
# A fence marker is a line whose first non-space run is ``` or ~~~ (an info
# string like ```markdown may follow). The marker line itself is never content.
/^[ \t]*(```|~~~)/ { in_fence = !in_fence; next }
in_fence { next }
# First H1 is the title fallback (front matter title: still wins in emit).
/^#[ \t]/ && h1_title == "" { h1_title = trim(substr($0, 2)) }
/^## / {
  if ($0 ~ /^## Status/) section = "status"
  # First `## Branches` wins: a plan documenting the plan format quotes the
  # section in prose, and those later headings are illustration, not contract.
  else if ($0 ~ /^## Branches/) { section = branches_seen ? "" : "branches"; branches_seen = 1 }
  # `## Waves` is the new spelling: the branch and PR live in the `### ` heading,
  # the line below is prose. First one wins, for the same reason `## Branches`
  # does. A plan carries one or the other — but the parser reads both while the
  # migration moves 85 files, so a file moved one commit early never reads
  # as silently empty.
  else if ($0 ~ /^## Waves/) { section = waves_seen ? "" : "waves"; waves_seen = 1 }
  else if ($0 ~ /^## Approval/) section = "approval"
  # First `## Changelog` wins, for the same reason `## Branches` does: a plan
  # about the plan format quotes the section in prose, and the later heading is
  # illustration rather than contract.
  else if ($0 ~ /^## Changelog/) { section = changelog_seen ? "" : "changelog"; changelog_seen = 1 }
  else section = ""
  next
}
section == "status" {
  lower = tolower($0)
  if (lower ~ /^[ \t]*[-*]?[ \t]*\**phase[:*]/ && canon_phase == "") canon_phase = val_after_colon($0)
  else if (lower ~ /^[ \t]*[-*]?[ \t]*\**type[:*]/ && canon_type == "") canon_type = val_after_colon($0)
  else if (lower ~ /^[ \t]*[-*]?[ \t]*\**sprint[:*]/ && canon_sprint == "") canon_sprint = val_after_colon($0)
  else if (lower ~ /^[ \t]*[-*]?[ \t]*\**story[:*]/ && canon_story == "") canon_story = val_after_colon($0)
  else if (lower ~ /^[ \t]*[-*]?[ \t]*\**issue[:*]/ && canon_issue == "") canon_issue = val_after_colon($0)
  else if (lower ~ /^[ \t]*[-*]?[ \t]*\**review[:*]/ && canon_review == "") canon_review = val_after_colon($0)
  else if (lower ~ /^[ \t]*[-*]?[ \t]*\**impl[:*]/ && canon_impl == "") canon_impl = val_after_colon($0)
  else if (lower ~ /^[ \t]*[-*]?[ \t]*\**design[:*]/ && canon_design == "") canon_design = val_after_colon($0)
  else if (lower ~ /^[ \t]*[-*]?[ \t]*\**rounds[:*]/ && canon_rounds == "") canon_rounds = val_after_colon($0)
  else if (lower ~ /^[ \t]*[-*]?[ \t]*\**approved[:*]/ && canon_approved == "") canon_approved = val_after_colon($0)
  else if (lower ~ /^[ \t]*[-*]?[ \t]*\**released[:*]/ && canon_released == "") canon_released = val_after_colon($0)
  else if (lower ~ /^[ \t]*[-*]?[ \t]*\**delivered[:*]/ && canon_delivered == "") canon_delivered = val_after_colon($0)
  else if (lower ~ /^[ \t]*[-*]?[ \t]*\**started[:*]/) {
    _s = strip_placeholder(val_after_colon($0))
    if (_s != "") started[++n_started] = _s
  }
  next
}
section == "approval" {
  lower = tolower($0)
  if (lower ~ /^[ \t]*[-*]?[ \t]*\**assignee[:*]/ && canon_assignee == "") canon_assignee = val_after_colon($0)
  next
}
# `## Changelog` — the release-note entries. One entry per bullet, wrapped
# continuation lines folded into the entry they belong to.
#
# A bullet opens an entry. An indented non-bullet line continues the open one.
# A blank line or a line at column zero closes it: the flush-left prose that 8
# plans use for a "Board impact:" note is a remark to a reviewer, not a release
# note, so it ends the entry rather than joining it.
section == "changelog" {
  # A line that is nothing but an HTML comment is not content, at any
  # indentation. Multi-line comments are already swallowed upstream; an INDENTED
  # single-liner would otherwise land in the continuation branch below and paste
  # its own markup into the entry above it.
  if ($0 ~ /^[ \t]*<!--.*-->[ \t]*$/) next
  # An INDENTED bullet is a sub-point of the entry above, not a release note of
  # its own, so it continues rather than opens. No changelog in the repo nests
  # today; the rule is here because the alternative silently promotes a
  # sub-point to a headline the moment one does.
  if (cl_open && $0 ~ /^[ \t]+[-*][ \t]/) {
    _n = $0
    sub(/^[ \t]*[-*][ \t]+/, "", _n)
    changelog[n_changelog] = changelog[n_changelog] " " trim(_n)
    next
  }
  if ($0 ~ /^[ \t]*[-*][ \t]/) {
    _e = $0
    sub(/^[ \t]*[-*][ \t]+/, "", _e)
    _e = strip_placeholder(trim(_e))
    if (_e != "") { changelog[++n_changelog] = _e; cl_open = 1 }
    else cl_open = 0   # an unfilled bullet opens nothing to continue
    next
  }
  if (cl_open && $0 ~ /^[ \t]+[^ \t]/) {
    changelog[n_changelog] = changelog[n_changelog] " " trim($0)
    next
  }
  # Blank line, or prose at column zero: whatever entry was open is finished.
  # The flag matters — without it a continuation-shaped line after a break would
  # glue itself onto an entry it never belonged to.
  cl_open = 0
  next
}
section == "branches" {
  # `### <name>` opens a wave. Branches before any subheading belong to an
  # unnamed wave, so a pre-wave plan parses as exactly one wave.
  if ($0 ~ /^###[ \t]/) {
    wave_names[++n_waves] = trim(substr($0, 4))
    next
  }
  # Claim reflection, written by the worker after its ref push succeeds. This is
  # a reflection, not the claim: git refs remain authoritative. Computed before
  # the branch loop below — match() clobbers RSTART/RLENGTH, which that loop
  # needs to advance.
  claim_note = ""
  if (index($0, "claimed:") > 0) {
    _c = $0
    sub(/^.*<!--[ \t]*claimed:[ \t]*/, "", _c)
    sub(/[ \t]*-->.*$/, "", _c)
    claim_note = trim(_c)
  }
  # THE REASON FOR THE DEFERRAL, and not merely the fact of one.
  #
  # `<!-- deferred: verified already implemented 2026-08-17 — startRepair() at
  # fleet.ts:806 -->` was tested for presence and the sentence after the colon
  # was dropped on the floor. So the board could say `deferred` beside `no
  # commits` and never say that the first is the REASON for the second — a
  # reader with no access to the plan file saw a branch nobody started and no
  # statement that nobody should.
  #
  # Extracted the same way and in the same place as the claim note, for the same
  # reason: `match()` in the branch loop below clobbers RSTART/RLENGTH, so
  # anything read from the whole line must be read before it runs.
  #
  # Newlines are already impossible here — awk hands this rule one line, and the
  # documented contract is that an annotation binds to the line carrying the
  # branch name. A deferral whose text is wrapped onto a continuation line is
  # not seen, exactly as `deferred` itself was not.
  defer_note = ""
  if (index($0, "deferred:") > 0) {
    _d = $0
    sub(/^.*<!--[ \t]*deferred:[ \t]*/, "", _d)
    sub(/[ \t]*-->.*$/, "", _d)
    defer_note = trim(_d)
  }
  line = $0
  while (match(line, branch_re)) {
    b = substr(line, RSTART + 1, RLENGTH - 2)
    branches[++n_branches] = b
    if (n_waves == 0) { wave_names[++n_waves] = "" }
    wave_of[n_branches] = n_waves
    wave_seq[n_branches] = ++wave_count[n_waves]
    # THE FLAG accepts the bare form as well as the annotated one.
    #
    # It matched `deferred:` only, so `<!-- deferred -->` — the annotation with
    # nothing after it — read as NOT deferred at all: the strongest statement a
    # plan can make about a branch, dropped for want of a colon. A reader
    # writing the shorter form has said the branch will not be built; the
    # parser now hears it.
    deferred_of[n_branches] = ($0 ~ /<!--[ \t]*deferred[ \t]*(:|-->)/) ? "true" : "false"
    # The reason travels with the flag. Empty on every non-deferred branch, and
    # empty is also the honest answer for the bare form: the branch IS deferred
    # and no reason was recorded, which is a different statement from a reason
    # of "".
    deferred_why[n_branches] = defer_note
    # Claim reflection, written by the worker after its ref push succeeds. This
    # is a reflection, not the claim: git refs remain authoritative.
    claimed_of[n_branches] = claim_note
    ordered_b[n_branches] = b
    line = substr(line, RSTART + RLENGTH)
  }
  line = $0
  # `→ #N` and `→ owner/repo#N` are both annotations: /plot-deliver instructs
  # implementers to write the second for `Impl: other repo` plans, and a parser
  # that dropped it reported `prs: []` for a plan whose only PR was written
  # exactly as documented. The repo part is matched but not retained — callers
  # ask which PRs are the evidence, and plot-host.sh resolves where each lives.
  while (match(line, /→ ([A-Za-z0-9._-]+\/[A-Za-z0-9._-]+)?#[0-9]+/)) {
    p = substr(line, RSTART, RLENGTH)
    sub(/^.*#/, "", p)
    prs[++n_prs] = p
    line = substr(line, RSTART + RLENGTH)
  }
  # A near-miss is REPORTED, never silently dropped. `→#44` (no space) is the
  # obvious hand-typo, and treating it as absence makes the sweep advise adding
  # an annotation the plan already carries. Accepting it would widen the
  # contract on a guess; reporting it leaves the judgement with a person.
  line = $0
  while (match(line, /→#[0-9]+/)) {
    malformed_prs[++n_malformed_prs] = substr(line, RSTART, RLENGTH)
    line = substr(line, RSTART + RLENGTH)
  }
  next
}
# `## Waves` — the new spelling. The `### ` heading carries the meta (which
# branch, which PR) and the line below is prose. This is the inverse of
# `## Branches`, where the branch rides the list line: here the branch comes
# from the HEADING, so a backticked name in a description cannot be mistaken for
# a branch — the defect the old shape invited is structurally impossible.
#
# The emitted arrays (branches, prs, waves) must be byte-identical to what the
# old shape produces for the same plan. So this shares every accumulation
# variable with the branches handler above; only the EXTRACTION differs.
section == "waves" {
  # Only the `### ` heading carries meta. Body lines are prose — never scanned
  # for a branch or a PR, which is the whole point of the new shape.
  if ($0 !~ /^###[ \t]/) next

  # A heading opens a wave whose NAME is the heading text with the
  # `(Branch: …, PR: …)` parenthetical and any trailing annotation stripped, so
  # `### Removed (Branch: bug/foo, PR: #300)` names the wave `Removed` — exactly
  # what the old shape (bare `### Removed`) produced, which is what keeps the two
  # spellings byte-identical.
  wname = trim(substr($0, 4))
  # Drop a trailing HTML comment (claimed/deferred ride the heading line now).
  sub(/[ \t]*<!--.*$/, "", wname)
  # Drop the `(Branch: …)` meta parenthetical. Anchored to `(Branch:` so a
  # parenthetical in a genuine wave name — none exist, but the grammar must not
  # assume it — is not eaten unless it is the meta block.
  sub(/[ \t]*\(Branch:.*$/, "", wname)
  wname = trim(wname)
  wave_names[++n_waves] = wname

  # Claim/deferral annotations bind to the line carrying the branch name, which
  # is the heading. Read before any match() below, which clobbers RSTART/RLENGTH.
  claim_note = ""
  if (index($0, "claimed:") > 0) {
    _c = $0
    sub(/^.*<!--[ \t]*claimed:[ \t]*/, "", _c)
    sub(/[ \t]*-->.*$/, "", _c)
    claim_note = trim(_c)
  }
  defer_note = ""
  if (index($0, "deferred:") > 0) {
    _d = $0
    sub(/^.*<!--[ \t]*deferred:[ \t]*/, "", _d)
    sub(/[ \t]*-->.*$/, "", _d)
    defer_note = trim(_d)
  }

  # The branch is the `Branch:` value, matched against the known prefixes exactly
  # as the old shape matched the backticked name. Written unquoted in the heading
  # (`Branch: bug/foo`), so the match is on a bare token, not on backticks. A
  # heading with no readable branch still opened a wave above — so a `## Waves`
  # section is never silently empty, which is the failure this plan refuses: a
  # consumer sees a wave it could not extract a branch from, not an absence.
  hmeta = $0
  if (match(hmeta, "Branch:[ \t]*(" PREFIXES ")/[^ \t,)]+")) {
    b = substr(hmeta, RSTART, RLENGTH)
    sub(/^Branch:[ \t]*/, "", b)
    branches[++n_branches] = b
    wave_of[n_branches] = n_waves
    wave_seq[n_branches] = ++wave_count[n_waves]
    # Bare `<!-- deferred -->` sets the flag with no reason, same as the old
    # shape; `deferred:` carries the reason.
    deferred_of[n_branches] = ($0 ~ /<!--[ \t]*deferred[ \t]*(:|-->)/) ? "true" : "false"
    deferred_why[n_branches] = defer_note
    claimed_of[n_branches] = claim_note
    ordered_b[n_branches] = b
  }

  # The PR is the `PR: #NNN` value in the heading. Absent PR: contributes
  # nothing — not "", not 0 — the same rule `Issue:` follows. Only a heading
  # that carries the field adds to prs.
  if (match($0, /PR:[ \t]*#[0-9]+/)) {
    p = substr($0, RSTART, RLENGTH)
    sub(/^.*#/, "", p)
    prs[++n_prs] = p
  }
  next
}
END { if (NR > 0) emit_record() }
' "${files[@]}"
