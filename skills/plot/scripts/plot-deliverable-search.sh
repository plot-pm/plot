#!/usr/bin/env bash
# Plot helper: search the estate for a deliverable a plan proposes to build.
# Usage: plot-deliverable-search.sh <deliverable phrase> [...]
# Output: candidates as `<corpus> :: <term>` headings over `<file>:<line>: <text>`
#         lines. Empty stdout means the estate has nothing by that name.
# Exit:   0 ALWAYS, whether it found candidates or none.
#
# IT REPORTS AND NEVER REFUSES. A plan may legitimately propose replacing
# something that exists — two of the five duplications measured below were doing
# exactly that. So the exit code carries no verdict, and a caller reading it
# learns only that the search ran. The author reads the candidates and says
# *"yes, I am replacing that"*, which is the same posture as /plot-idea's
# title-similarity check one level up.
#
# WHY THIS EXISTS, MEASURED. Five plans in one week on this repo proposed
# something the estate already had: `normalizeVersion` (10 callers),
# `check-host-cli-callers.sh`, reconcile scan section 7, `readingLoss`,
# `computeStatusDrift`. Every one was found by a grep and none by an
# interrogation round.
#
# WHAT IT SEARCHES IS NAMED, NOT GUESSED — four corpora, the four places those
# five were hiding:
#
#   packages/*/src              the domain and the board
#   skills/plot/scripts         the helper scripts
#   scripts/                    the repo's gates
#   the reconcile scan's `== N. ... ==` section headings
#
# A search over the whole tree matches documentation and comments, and a check
# that fires on prose is one an author learns to skip. The code paths are read
# from `## Plot Config`, so a project whose code lives elsewhere is searched
# where its code is.
#
# EACH CORPUS IS SEARCHED SEPARATELY, AND THAT IS WHAT FINDS THE HARD CASE
# rather than a nicety of presentation. `check-host-cli-callers.sh` was missed
# by a search for `check-*gh*`: the plan said *gh* and the estate says *host
# CLI*. Measured — `gh` matches **30 files** across the four corpora together,
# which is noise, and **exactly one file** inside `scripts/`, which is the
# answer. Merging the corpora into one search buries the rare hit under the
# common one; keeping them apart is what lets `scripts/` speak.
#
# THE DECLARED NAME IS EXPANDED BEFORE IT IS SEARCHED, because a name-based
# search only works when the author already guesses the estate's vocabulary, and
# an author proposing a thing is precisely the person who does not know what it
# is called:
#
#   - the phrase's own tokens, whole-word            `gh`, `callers`
#   - each token's bare nouns, split on case and     `normalizeVersion` also
#     on `-` `_` `.`, where the token is compound     searches `normalize`,
#                                                     `Version`
#
# The bare-noun rule is what finds `computeStatusDrift`, whose exact name has
# since been refactored away while `Drift` still names two files. A rule name
# also searches its bare noun.
#
# NO TERM IS DROPPED FOR BEING SHORT, and that is a correction rather than an
# omission. A `length >= 3` filter was written here first, to keep `a`, `of` and
# `is` out of the report — and it silently deleted `gh`, the two characters that
# ARE the hard case. The noise floor refuses a term by MEASUREMENT (`for` names
# 282 files) rather than by a proxy for one (`for` is short).
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
config="$here/plot-config.sh"

repo_root="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
cd "$repo_root"

if [ "$#" -eq 0 ]; then
  echo "usage: plot-deliverable-search.sh <deliverable phrase> [...]" >&2
  exit 2
fi

phrase="$*"

# THREE BOUNDS, AND THEY ANSWER THREE DIFFERENT QUESTIONS.
#
# `NOISE_FLOOR` decides whether a term found anything AT ALL, counted in FILES
# within one corpus. A deliverable phrase carries words like `shared`, `gate`
# and `for` beside the name, and those name most of the estate. A term over the
# floor is reported as one line saying so — never silently dropped, because an
# author who wants that grep should be able to see it was skipped and why.
#
# `MAX_PER_TERM` bounds what is PRINTED for a term under the floor. Eight lines
# give the file and line the author needs; the ninth is the same answer again.
#
# `MAX_LINE` truncates a matched line. Measured before generated bundles were
# excluded: one matched line in `plot-delta.mjs` was 230,598 characters, and the
# whole report was 339 KB. The file and line number are the answer; the rest of
# a minified line is not.
NOISE_FLOOR="${PLOT_DELIVERABLE_NOISE_FLOOR:-6}"
MAX_PER_TERM="${PLOT_DELIVERABLE_MAX:-8}"
MAX_LINE="${PLOT_DELIVERABLE_MAX_LINE:-200}"

# --- the corpora ------------------------------------------------------------
#
# Declared where the adopting project declares them, defaulted to this repo's
# layout. A missing directory is skipped silently: a project with no
# `packages/` is not misconfigured, it just has no packages.
code_globs="$(bash "$config" get "Deliverable corpora" "packages/*/src skills/plot/scripts scripts")"

corpora=()
for g in $code_globs; do
  for d in $g; do
    [ -d "$d" ] && corpora+=("$d")
  done
done

scan="$here/plot-reconcile-scan.sh"

# --- what is generated, and therefore not a place anything was duplicated ----
#
# `skills/plot/scripts/board/*.mjs` are BUILT ARTIFACTS — `pnpm build:board`
# reproduces every one of them from `packages/board/src`, which this search
# already reads. A hit in a bundle is the same code found twice: once where an
# author could have written it, once where nobody can.
#
# THE LIST IS READ FROM `.gitattributes`, never hardcoded here. That file marks
# each bundle `-merge`, and `scripts/check-bundle-attributes.sh` derives its
# contents from `build.mjs` and fails when one is missing — so the exclusion
# tracks the build's real output, and a tenth bundle added tomorrow is excluded
# without anyone remembering this script exists. A repo with no `.gitattributes`
# excludes nothing, the honest answer for a repo that declared no generated
# files.
excludes=()
if [ -f .gitattributes ]; then
  while IFS= read -r path; do
    [ -n "$path" ] && excludes+=(":(exclude)$path")
  done < <(awk '$2 == "-merge" { print $1 }' .gitattributes)
fi

# --- expand the declared name ----------------------------------------------
#
# Tokens first, then each token's bare nouns. Order is preserved and duplicates
# are dropped case-insensitively, so the term the author actually wrote is
# reported first and a noun equal to its token is not searched twice.
expand() {
  printf '%s\n' "$1" \
  | sed 's/[^A-Za-z0-9_.-]\{1,\}/\n/g' \
  | while IFS= read -r tok; do
      [ -n "$tok" ] || continue
      printf '%s\n' "$tok"
      printf '%s\n' "$tok" \
      | sed -e 's/\([a-z0-9]\)\([A-Z]\)/\1\n\2/g' -e 's/[-_.]/\n/g'
    done \
  | sed 's/^[^A-Za-z0-9]*//; s/[^A-Za-z0-9]*$//' \
  | awk 'length($0) > 0 && !seen[tolower($0)]++'
}

terms="$(expand "$phrase")"
[ -n "$terms" ] || exit 0

# Terms the floor refused, collected and reported once below the findings.
skipped=""
# Whether anything at all was reported. The footer is CONTEXT for findings, and
# on its own it is the noise this check exists to avoid.
found_any=0

# --- search -----------------------------------------------------------------
#
# One pass per corpus per term. The FILE COUNT gates; the lines are the report.
report_corpus() {
  corpus_label="$1"; shift
  term="$1"; shift

  files="$(git grep -Ilw --no-color -- "$term" -- "$@" "${excludes[@]+"${excludes[@]}"}" 2>/dev/null || true)"
  [ -n "$files" ] || return 0

  n_files="$(printf '%s\n' "$files" | grep -c . || true)"
  if [ "$n_files" -gt "$NOISE_FLOOR" ]; then
    # SKIPPED, AND SAID SO ONCE AT THE END rather than here. Measured on
    # `a grep gate for gh callers`: six terms over four corpora produced 30
    # skip lines above the two that were the answer, and the answer is what the
    # author must see first. The skips are still reported — an author who
    # wants that grep learns it was skipped and how common the term is — just
    # not interleaved with the findings.
    skipped="${skipped}${corpus_label} :: ${term} (${n_files} files)
"
    return 0
  fi

  hits="$(git grep -Inw --no-color -- "$term" -- "$@" "${excludes[@]+"${excludes[@]}"}" 2>/dev/null || true)"
  [ -n "$hits" ] || return 0
  n_hits="$(printf '%s\n' "$hits" | grep -c . || true)"

  found_any=1
  echo "$corpus_label :: $term — $n_files file(s), $n_hits line(s)"
  printf '%s\n' "$hits" | head -n "$MAX_PER_TERM" | cut -c "1-$MAX_LINE" | sed 's/^/  /'
  if [ "$n_hits" -gt "$MAX_PER_TERM" ]; then
    echo "  … $((n_hits - MAX_PER_TERM)) more"
  fi
}

while IFS= read -r term; do
  [ -n "$term" ] || continue

  for c in "${corpora[@]+"${corpora[@]}"}"; do
    report_corpus "$c" "$term" "$c"
  done

  # THE SCAN'S SECTION HEADINGS ARE THE FOURTH CORPUS, and they are LINES in one
  # file rather than a directory. A plan proposing a reconcile finding proposes
  # a SECTION, so the headings are what it collides with — the script's other
  # 2,000 lines are that script's implementation and match every word in the
  # language. This corpus is therefore filtered to the `echo "== N. ... =="`
  # lines the scan emits.
  #
  # ITS FLOOR IS A FRACTION, NOT A COUNT, and that is the corpus size talking
  # rather than a second policy. Seventeen headings is small enough that a count
  # cannot separate signal from English: `a` matches five of them and sits
  # comfortably under a count of six while naming nothing at all. The other
  # corpora hold hundreds of files, where six is already a strong signal.
  #
  # A QUARTER, measured against this estate's headings: `a` takes 5 of 17 and is
  # refused; `slice` and `branch` take 2 each — the terms that actually found
  # section 7 — and are reported. The rule is one sentence, *a term matching a
  # quarter of a corpus has not named anything in it*, expressed in each
  # corpus's own unit.
  if [ -f "$scan" ]; then
    scan_all="$(grep -c '^echo "== ' "$scan" 2>/dev/null || echo 0)"
    scan_hits="$(grep -nw -- "$term" "$scan" 2>/dev/null | grep '^[0-9]*:echo "== ' || true)"
    if [ -n "$scan_hits" ]; then
      n="$(printf '%s\n' "$scan_hits" | grep -c . || true)"
      if [ "$scan_all" -gt 0 ] && [ $((n * 4)) -gt "$scan_all" ]; then
        skipped="${skipped}reconcile scan sections :: ${term} (${n} of ${scan_all} headings)
"
        continue
      fi
      found_any=1
      echo "reconcile scan sections :: $term — $n heading(s)"
      printf '%s\n' "$scan_hits" \
        | head -n "$MAX_PER_TERM" \
        | sed "s|^|  ${scan#"$repo_root"/}:|" \
        | cut -c "1-$MAX_LINE"
    fi
  fi
done <<EOF
$terms
EOF

# THE FOOTER ONLY PRINTS BESIDE FINDINGS, and that is what makes silence
# silence. A deliverable the estate does not have still expands into words like
# `a` and `new` that name half the tree, so a footer printed unconditionally
# turns the Done-when's "a plan declaring a new one gets silence" into ten lines
# about `a`. Beside findings the footer earns its place — it says which terms
# were not pursued and how common each was, so an author can run that grep
# themselves. Alone it says nothing and costs the author's attention.
if [ "$found_any" -eq 1 ] && [ -n "$skipped" ]; then
  echo "too common to name a deliverable, not searched further:"
  printf '%s' "$skipped" | sed 's/^/  /'
fi

# Silence is the answer the Done-when asks for: "a plan declaring a new one gets
# silence". Nothing is refused, so the exit code says only that the search ran.
exit 0
