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
# Phase values are normalized by scanning whitespace-separated tokens for the
# first known phase word — so decorated real-world values like
# "Delivered (2026-06-29) — split done" normalize to "delivered". A non-empty
# value with no known token normalizes to "UNKNOWN"; an absent field to "NONE".
#
# JSON fields:
#   file           the path given
#   format         canonical | frontmatter | none
#   phase_raw      primary phase value as written ("" if absent)
#   phase          normalized: draft|approved|delivered|released|rejected|
#                  superseded|UNKNOWN|NONE
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
#   branches       branch names from the `## Branches` section (backtick-
#                  quoted, matching the known prefixes; sorted, unique)
#                  NOTE: per-branch annotations (`<!-- deferred: ... -->`,
#                  `<!-- claimed: ... -->`) bind to the LINE carrying the
#                  backticked branch name. An annotation on a wrapped
#                  continuation line is not seen — keep it on the branch line.
#   prs            PR numbers from `→ #NNN` links in the `## Branches`
#                  section (sorted, unique)
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
#
# title/sprint/story/assignee are the board-facing surface (`@plot-pm/board`
# consumes this script instead of parsing plans itself). Front matter wins over
# the canonical body for every field, matching the `status:`/`phase:` rule.

set -uo pipefail

prefixes='idea|feature|bug|docs|infra'
files=()
missing=()
while [ $# -gt 0 ]; do
  case "$1" in
    --prefixes) prefixes="${2:?--prefixes needs a value}"; shift 2 ;;
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
  printf '{"file":"%s","format":"none","error":"file not found","phase_raw":"","phase":"NONE","phase_alt_raw":"","phase_alt":"NONE","type":"","title":"","sprint":"","story":"","assignee":"","branches":[],"prs":[],"review_raw":"","review":"NONE","impl_raw":"","impl":"NONE","approved_raw":"","released_raw":"","delivered_raw":"","started_raw":[]}\n' \
    "$(printf '%s' "$f" | sed 's/\\/\\\\/g; s/"/\\"/g')"
done

[ ${#files[@]} -gt 0 ] || exit 0

awk -v PREFIXES="$prefixes" '
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
    if (t ~ /^(draft|approved|delivered|released|rejected|superseded)$/) return t
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
  fm_delivered = ""
  canon_phase = ""; canon_type = ""
  canon_sprint = ""; canon_story = ""; canon_assignee = ""
  canon_review = ""; canon_impl = ""; canon_approved = ""; canon_released = ""
  canon_delivered = ""
  h1_title = ""
  in_fm = 0; section = ""; in_comment = 0; branches_seen = 0
  delete branches; n_branches = 0
  delete prs; n_prs = 0
  delete wave_names; delete wave_of; delete wave_seq; delete wave_count
  delete deferred_of; delete claimed_of; delete ordered_b; n_waves = 0
  delete started; n_started = 0
}
function emit_record(   fmt, praw, palt_raw, traw, title, sprint, story, assignee, review, impl, approved, delivered, i, j, out, sorted_b, sorted_p, nb, np) {
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
  approved = strip_placeholder((fm_approved != "") ? fm_approved : canon_approved)
  released = strip_placeholder((fm_released != "") ? fm_released : canon_released)
  delivered = strip_placeholder((fm_delivered != "") ? fm_delivered : canon_delivered)
  if (fm_started != "" && strip_placeholder(fm_started) != "") started[++n_started] = fm_started
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
            ",\"claimed\":\"" jesc(claimed_of[i]) "\"}"
      first = 0
    }
    out = out "]}"
  }
  out = out "]"
  out = out ",\"review_raw\":\"" jesc(review) "\",\"review\":\"" norm_review(review) "\""
  out = out ",\"impl_raw\":\"" jesc(impl) "\",\"impl\":\"" norm_impl(impl) "\""
  out = out ",\"approved_raw\":\"" jesc(approved) "\""
  out = out ",\"released_raw\":\"" jesc(released) "\""
  out = out ",\"delivered_raw\":\"" jesc(delivered) "\""
  out = out ",\"started_raw\":["
  for (i = 1; i <= n_started; i++) out = out (i > 1 ? "," : "") "\"" jesc(started[i]) "\""
  out = out "]}"
  print out
}
BEGIN { branch_re = "`(" PREFIXES ")/[^`]+`" }
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
  else if (lower ~ /^assignee:/ && fm_assignee == "") fm_assignee = val_after_colon($0)
  else if (lower ~ /^review:/ && fm_review == "") fm_review = val_after_colon($0)
  else if (lower ~ /^impl:/ && fm_impl == "") fm_impl = val_after_colon($0)
  else if (lower ~ /^approved:/ && fm_approved == "") fm_approved = val_after_colon($0)
  else if (lower ~ /^released:/ && fm_released == "") fm_released = val_after_colon($0)
  else if (lower ~ /^delivered:/ && fm_delivered == "") fm_delivered = val_after_colon($0)
  else if (lower ~ /^started:/ && fm_started == "") fm_started = val_after_colon($0)
  next
}
# Interior of multi-line HTML comments is non-content (template guidance
# blocks); single-line "<!-- ... -->" placeholders are unaffected.
in_comment { if ($0 ~ /-->/) in_comment = 0; next }
/<!--/ && $0 !~ /-->/ { in_comment = 1; next }
# First H1 is the title fallback (front matter title: still wins in emit).
/^#[ \t]/ && h1_title == "" { h1_title = trim(substr($0, 2)) }
/^## / {
  if ($0 ~ /^## Status/) section = "status"
  # First `## Branches` wins: a plan documenting the plan format quotes the
  # section in prose, and those later headings are illustration, not contract.
  else if ($0 ~ /^## Branches/) { section = branches_seen ? "" : "branches"; branches_seen = 1 }
  else if ($0 ~ /^## Approval/) section = "approval"
  else section = ""
  next
}
section == "status" {
  lower = tolower($0)
  if (lower ~ /^[ \t]*[-*]?[ \t]*\**phase[:*]/ && canon_phase == "") canon_phase = val_after_colon($0)
  else if (lower ~ /^[ \t]*[-*]?[ \t]*\**type[:*]/ && canon_type == "") canon_type = val_after_colon($0)
  else if (lower ~ /^[ \t]*[-*]?[ \t]*\**sprint[:*]/ && canon_sprint == "") canon_sprint = val_after_colon($0)
  else if (lower ~ /^[ \t]*[-*]?[ \t]*\**story[:*]/ && canon_story == "") canon_story = val_after_colon($0)
  else if (lower ~ /^[ \t]*[-*]?[ \t]*\**review[:*]/ && canon_review == "") canon_review = val_after_colon($0)
  else if (lower ~ /^[ \t]*[-*]?[ \t]*\**impl[:*]/ && canon_impl == "") canon_impl = val_after_colon($0)
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
  line = $0
  while (match(line, branch_re)) {
    b = substr(line, RSTART + 1, RLENGTH - 2)
    branches[++n_branches] = b
    if (n_waves == 0) { wave_names[++n_waves] = "" }
    wave_of[n_branches] = n_waves
    wave_seq[n_branches] = ++wave_count[n_waves]
    deferred_of[n_branches] = ($0 ~ /<!--[ \t]*deferred:/) ? "true" : "false"
    # Claim reflection, written by the worker after its ref push succeeds. This
    # is a reflection, not the claim: git refs remain authoritative.
    claimed_of[n_branches] = claim_note
    ordered_b[n_branches] = b
    line = substr(line, RSTART + RLENGTH)
  }
  line = $0
  while (match(line, /→ #[0-9]+/)) {
    p = substr(line, RSTART, RLENGTH)
    gsub(/[^0-9]/, "", p)
    prs[++n_prs] = p
    line = substr(line, RSTART + RLENGTH)
  }
  next
}
END { if (NR > 0) emit_record() }
' "${files[@]}"
