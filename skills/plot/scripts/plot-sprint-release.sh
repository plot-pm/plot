#!/usr/bin/env bash
# Plot helper: report a sprint's release target and the state of its items.
# Usage: plot-sprint-release.sh [<sprint-slug>]
#   No slug → the single active sprint (docs/sprints/active/); if none, or more
#   than one, that is reported rather than guessed.
# Output: JSON {sprint, file, phase, release, must:[...], should:[...],
#               could:[...]} where each item is {slug, text, checked,
#               delivered, state}.
#
# THE FACTS ONLY. Whether an open Must Have refuses a release is /plot-release's
# rule to apply; this script never decides, never writes, never exits non-zero
# for an unfinished item (Manifesto Principle 3: scripts collect and report).
# A sprint with no `Release:` reports release "" — the caller reads that as
# "this sprint says nothing about a release" and behaves exactly as before.
#
# Designed for small-model consumption: structured JSON, no interpretation.

set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
root=$(git rev-parse --show-toplevel 2>/dev/null) || root="."
cd "$root" || exit 0

SPRINT_DIR="$(bash "$HERE/plot-config.sh" get "Sprint directory" "docs/sprints/")"
SPRINT_DIR="${SPRINT_DIR%/}"
DELIVERED_DIR="$(bash "$HERE/plot-config.sh" get "Delivered index" "docs/plans/delivered/")"
DELIVERED_DIR="${DELIVERED_DIR%/}"

jesc() { printf '%s' "$1" | sed -e 's/\\/\\\\/g' -e 's/"/\\"/g' -e 's/\t/\\t/g'; }

# ---------------------------------------------------------------------------
# score_items — what each Must/Should/Could line counts as.
#
# THE RULE IS THE DOMAIN'S AND THIS SCRIPT HOLDS NO COPY OF IT.
# `docs/shell-and-domain.md` puts a script that runs once per operator command
# on the calling side: `node` answers in 39 ms, and this runs when /plot-release
# asks it rather than once per agent per pass. It was 12 lines of bash until
# 2026-09-08, and those 12 lines and `scoreItem` had already drifted — the
# `none` arm below was behaviour the domain could not express.
#
# ONE HOP FOR THE WHOLE TIER, not one per item. stdin is one item per line and
# stdout is its status, in the same order; a hop per item would pay 39 ms 134
# times for a rule that is three branches.
#
# Input:  one line per item on stdin, `checked<TAB>slug<TAB>delivered`
#   checked    "true" if the line is `- [x]`, "false" if `- [ ]`
#   slug       the `[slug]` plan reference, or "" for a lightweight task
#   delivered  "true"  the plan is in the Delivered index
#              "false" the plan exists elsewhere (active/, or nowhere)
#              "none"  no slug to check, so nothing was looked up
# Output: one of done | open | disputed per line, or NOTHING when the rule
#         could not be asked — see the refusal below.
#
# THE PLAN ESTATE OUTRANKS THE CHECKBOX wherever there is one to read. A
# checkbox answers "did I complete this?" without doing the work, which
# CLAUDE.md calls a rule rather than a gate; `delivered` is the objective
# half, and a gate that trusts the self-report is a rule wearing a gate's
# clothes.
#
# So a checked box over an undelivered plan is `disputed`, never `done`.
# /plot-sprint close already refuses on exactly this and names it a
# false-positive completion — if the release gate read it as finished, the
# two commands would disagree about one line, and the RELEASE would be the
# lenient one. That is the wrong way round.
#
# `disputed` blocks a Must Have, like `open`, because the useful message is
# "this says done, the estate says otherwise" — a fact a release cutter
# needs. --ignore-sprint still clears it.
#
# An unchecked box over a DELIVERED plan is NOT the mirror case, and measuring
# said so: all four Must Haves of this repo's first sprint are unchecked with
# their plans in delivered/, because /plot-deliver moves the plan and nobody
# re-ticks the box by hand. That is bookkeeping lag, not a claim in dispute —
# and a gate that fired on it would fire on every live sprint, which is how
# --ignore-sprint becomes reflexive. So it reads `done`: the estate is the
# stronger evidence, and here it is the only one that moved.
#
# The asymmetry is deliberate. A checked box over an undelivered plan is
# someone CLAIMING completion the estate denies; the reverse is the estate
# knowing something the file has not caught up with.
#
# A lightweight task (no slug) has only its checkbox, so it is taken at face
# value. That is a stated limit, not an oversight: `delivered: "none"` keeps
# the un-checked check visible in the output rather than implying one happened.
#
# A RULE THAT CANNOT BE ASKED REFUSES. `docs/shell-and-domain.md`: node missing,
# the bundle absent or the module throwing leaves this script refusing, not
# proceeding. Silence is never permission — and the permissive direction here
# reports an unfinished Must Have as done to the release gate.
# node's own stack trace is silenced because it is not the reason a reader
# needs: a missing bundle, a missing `node` and a throwing module all mean the
# same thing here, and `emit_tier` says it in one line. The exit status is what
# carries the refusal, not the noise.
score_items() { # stdin: one `checked\tslug\tdelivered` per line → one state per line
  node "$HERE/board/plot-sprint-score.mjs" 2>/dev/null
}

# Is <slug> in the Delivered index? File or symlink, either is delivery.
is_delivered() { # $1=slug → true|false
  [ -e "$DELIVERED_DIR/$1.md" ] && printf 'true' || printf 'false'
}

# Collapse `a/b/../c` → `a/c` textually. NOT `readlink -f` or `realpath`: the
# first differs between GNU and BSD (and CI is Linux while most authors are on
# macOS), and both would resolve to an absolute path when every other path this
# script reports is repo-relative. Only the `x/../` case occurs here — an active
# entry is a symlink to `../<file>` in the sprint dir.
norm_path() {
  local p="$1" prev=""
  while [ "$p" != "$prev" ]; do
    prev="$p"
    p=$(printf '%s' "$p" | sed -E 's#(^|/)[^/]+/\.\./#\1#g')
  done
  printf '%s' "$p"
}

# Resolve the sprint file. An explicit slug wins; otherwise the single active
# sprint. "Which sprint?" is a question, and a script that guessed would be
# answering it — so zero and many are reported, never resolved.
#
# Prints `path<TAB>note`, and the note travels WITH the path rather than in a
# variable: a command substitution runs this in a subshell, so a `resolve_note`
# assigned here would die with it and the caller would print a generic "not
# found" over a reason it had already computed. Reporting less than what was
# measured is the defect this script exists to catch, so it does not get to
# happen inside it.
resolve_sprint() { # → "path\tnote"; one side is always empty
  local slug="${1:-}" f
  if [ -n "$slug" ]; then
    f=$(ls "$SPRINT_DIR"/*-"$slug".md 2>/dev/null | head -1)
    [ -n "$f" ] || { printf '\tno sprint file for slug %s' "$slug"; return 0; }
    printf '%s\t' "$f"; return 0
  fi
  local -a act=()
  while IFS= read -r l; do [ -n "$l" ] && act+=("$l"); done < <(ls "$SPRINT_DIR"/active/*.md 2>/dev/null)
  if [ "${#act[@]}" -eq 0 ]; then printf '\tno active sprint'; return 0; fi
  # TWO ACTIVE SPRINTS MAY TARGET ONE RELEASE — two teams, one train. The plan
  # calls that legitimate, so this is not refused; the caller gets every active
  # sprint and answers to all of them. Which is why the output is an ARRAY.
  if [ "${#act[@]}" -gt 1 ]; then
    local out="" a t
    for a in "${act[@]}"; do
      t=$(cd "$SPRINT_DIR/active" && readlink "$(basename "$a")" 2>/dev/null) || t=""
      [ -n "$t" ] && a="$(norm_path "$SPRINT_DIR/active/$t")"
      out="$out$a"$'\n'
    done
    printf '%s\t' "${out%$'\n'}"
    return 0
  fi
  # An active entry is a symlink into the sprint dir; resolve it to the real file.
  local target
  target=$(cd "$SPRINT_DIR/active" && readlink "$(basename "${act[0]}")" 2>/dev/null) || target=""
  if [ -n "$target" ]; then printf '%s\t' "$(norm_path "$SPRINT_DIR/active/$target")"; else printf '%s\t' "${act[0]}"; fi
}

# Split on the FIRST tab with parameter expansion, not `read -d`: with
# IFS=$'\t', read collapses a leading empty field, so an empty path with a
# note would put the note into FILE and leave the note empty. Measured, not
# assumed — it is how this line failed the first time.
_resolved="$(resolve_sprint "${1:-}")"
FILES="${_resolved%%$'\t'*}"
resolve_note="${_resolved#*$'\t'}"

# --- Per-sprint fields. Read from `## Status` only, so a `Release:` mentioned
# --- in prose or a retrospective is not mistaken for the declared target.
status_line() { # $1=file $2=field → value or ""
  awk -v want="$2" '
    /^##[ \t]+Status[ \t]*$/ { in_s=1; next }
    /^##[ \t]/ { in_s=0 }
    in_s {
      line=$0
      sub(/^[ \t]*[-*][ \t]*/, "", line)
      gsub(/\*\*/, "", line)
      n=index(line, ":")
      if (n > 0) {
        k=substr(line, 1, n-1); v=substr(line, n+1)
        gsub(/^[ \t]+|[ \t]+$/, "", k); gsub(/^[ \t]+|[ \t]+$/, "", v)
        if (tolower(k) == tolower(want)) { print v; exit }
      }
    }
  ' "$1"
}

# --- Items per tier. THE VERSION IS NEVER VALIDATED ANYWHERE: the plan is
# --- explicit that the gate checks Must Haves, never the version string.
#
# TWO PASSES, because the rule is asked once for the whole tier. The first
# gathers every item's readings; the second pairs each with the status the
# domain returned. The readings are held in arrays rather than re-parsed, so
# the line the rule scored and the line rendered here are the same line.
emit_tier() { # $1=file $2=heading regex → JSON array
  local f="$1" out="[" first=1 line checked slug text delivered i n
  local -a checkeds=() slugs=() texts=() delivereds=() states=()
  while IFS= read -r line; do
    case "$line" in
      "- [ ] "*) checked=false ;;
      "- [x] "*|"- [X] "*) checked=true ;;
      *) continue ;;
    esac
    text=$(printf '%s' "$line" | sed -E 's/^- \[[ xX]\][ ]*//')
    # Strip the automation annotation — it is machinery, not the item's text.
    text=$(printf '%s' "$text" | sed -E 's/[ ]*<!--.*-->[ ]*$//' | sed -E 's/[ \t]+$//')
    slug=$(printf '%s' "$text" | grep -oE '^\[[a-z0-9][a-z0-9-]*\]' | tr -d '[]' || true)
    if [ -n "$slug" ]; then delivered=$(is_delivered "$slug"); else delivered=none; fi
    checkeds+=("$checked"); slugs+=("$slug"); texts+=("$text"); delivereds+=("$delivered")
  done < <(awk -v want="$2" '
    /^###[ \t]/ { in_t = ($0 ~ want) ? 1 : 0; next }
    /^##[ \t]/  { in_t = 0 }
    in_t
  ' "$f")

  n=${#checkeds[@]}
  # An empty tier asks nothing. A sprint with no Coulds is normal, and starting
  # a process to score no items would make the refusal below fire on it.
  if [ "$n" -gt 0 ]; then
    while IFS= read -r line; do states+=("$line"); done < <(
      for ((i = 0; i < n; i++)); do
        printf '%s\t%s\t%s\n' "${checkeds[$i]}" "${slugs[$i]}" "${delivereds[$i]}"
      done | score_items
    )
    # THE REFUSAL. One status per item or none of them: a short answer means the
    # rule was asked and could not answer, and rendering the items it did reach
    # would report a partial sprint as a whole one.
    if [ "${#states[@]}" -ne "$n" ]; then
      printf 'plot-sprint-release: could not score items — is board/plot-sprint-score.mjs built?\n' >&2
      return 1
    fi
  fi

  for ((i = 0; i < n; i++)); do
    [ $first -eq 1 ] || out="$out,"
    first=0
    out="$out{\"slug\":\"$(jesc "${slugs[$i]}")\",\"text\":\"$(jesc "${texts[$i]}")\""
    out="$out,\"checked\":${checkeds[$i]},\"delivered\":"
    case "${delivereds[$i]}" in none) out="$out\"none\"" ;; *) out="$out${delivereds[$i]}" ;; esac
    out="$out,\"state\":\"${states[$i]}\"}"
  done
  printf '%s]' "$out"
}

emit_sprint() { # $1=file → one JSON object
  local f="$1" base slug phase release
  base=$(basename "$f" .md)
  # `2026-W34-the-board-tells-the-truth` → `the-board-tells-the-truth`
  slug=$(printf '%s' "$base" | sed -E 's/^[0-9]{4}-W?[0-9]{2}(-[0-9]{2})?-//')
  # `State:` is the field a sprint file carries; `Phase:` is what it was called
  # before 2026-09-07, and both are read for good. The JSON key stays `phase`:
  # it is the wire, and renaming it would break every reader for no gain.
  phase=$(status_line "$f" "State")
  [ -n "$phase" ] || phase=$(status_line "$f" "Phase")
  release=$(status_line "$f" "Release")
  # A placeholder is not a declared target. `<version>`/`X.Y.Z` read as absent
  # so a template-shaped sprint behaves exactly like one with no field at all.
  case "$release" in
    "<"*">"|"X.Y.Z"|"x.y.z"|"TBD"|"tbd") release="" ;;
  esac
  # THE THREE TIERS ARE SCORED BEFORE ANYTHING IS PRINTED, so a refusal reaches
  # the caller as a refusal. Inlined in the `printf` a command substitution
  # swallows the exit status, and an unaskable rule would print `"must":[]` —
  # which reads as a sprint that promised nothing, the one direction this script
  # must never be lenient in.
  local musts shoulds coulds
  musts=$(emit_tier "$f" '[Mm]ust')     || return 1
  shoulds=$(emit_tier "$f" '[Ss]hould') || return 1
  coulds=$(emit_tier "$f" '[Cc]ould')   || return 1
  printf '{"sprint":"%s","file":"%s","phase":"%s","release":"%s"' \
    "$(jesc "$slug")" "$(jesc "$f")" "$(jesc "$phase")" "$(jesc "$release")"
  printf ',"must":%s'   "$musts"
  printf ',"should":%s' "$shoulds"
  printf ',"could":%s'  "$coulds"
  printf '}'
}

# --- Output. `sprints` is an ARRAY because two active sprints may target one
# --- release (two teams, one train) and the caller must answer to both. The
# --- top-level `release`/`must`/`should`/`could` mirror the SINGLE sprint when
# --- there is exactly one, so the common case reads without indexing.
sprints=""
first=1
while IFS= read -r f; do
  [ -n "$f" ] && [ -f "$f" ] || continue
  [ $first -eq 1 ] || sprints="$sprints,"
  first=0
  # The refusal again: this script reports the facts behind a release gate, so
  # it prints all of them or none. A sprint it could not score is not a sprint
  # with no items.
  one_sprint=$(emit_sprint "$f") || exit 1
  sprints="$sprints$one_sprint"
done <<<"$FILES"

if [ -z "$sprints" ]; then
  printf '{"sprints":[],"sprint":"","file":"","phase":"","release":"","note":"%s","must":[],"should":[],"could":[]}\n' \
    "$(jesc "${resolve_note:-sprint file not found}")"
  exit 0
fi

# Count the records without a JSON parser: emit_sprint yields exactly one
# `{"sprint":` per file, so counting that key counts sprints.
n=$(printf '%s' "$sprints" | grep -o '{"sprint":' | wc -l | tr -d ' ')
printf '{"sprints":[%s],"note":"%s"' "$sprints" "$(jesc "$resolve_note")"
if [ "$n" = "1" ]; then
  # Mirror the single sprint's fields at top level — the overwhelmingly common
  # shape, and one a caller should not have to index into.
  one="${sprints#\{}"      # drop the inner object's opening brace
  one="${one%\}}"          # and its closing one, leaving bare key:value pairs
  printf ',%s}\n' "$one"  # spliced in, then the OUTER object is closed here
else
  # Many sprints: no top-level mirror to pick, because picking one would be
  # answering "which sprint?" — the question this script refuses to answer.
  printf ',"sprint":"","file":"","phase":"","release":"","must":[],"should":[],"could":[]}\n'
fi
