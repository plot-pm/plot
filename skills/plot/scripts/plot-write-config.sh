#!/usr/bin/env bash
# The mechanical half of adopting Plot in a repository: ask the domain what the
# `## Plot Config` should hold, then perform the write it decided.
#
#   plot-write-config.sh --answers <file.json> [--report <file.json>] [--repo <dir>]
#   plot-write-config.sh --answers <file.json> --dry-run
#
# THE DOMAIN DECIDES, THIS PERFORMS. `composeAdoption` names four refusals and
# the write it guards lived as a markdown block in /plot-init step 3 until
# 2026-09-09 — an agent copied it and filled it in, so there was no invocation to
# check and no rule that could fire. Measured 2026-09-08 on three lifecycle
# fields in one session: that is what a hand write costs.
#
# ADOPTION IS THE ONE COMMAND THAT WRITES INTO A REPOSITORY PLOT DOES NOT OWN,
# which makes a wrong write the most expensive one in the estate. So the section
# is APPENDED and never spliced, the `.gitignore` line is appended and never
# rewritten, and an already-adopted repository is refused by name rather than
# given a second section that `plot-config.sh` would read past.
#
# A REFUSAL IS PRINTED, NOT SWALLOWED. Each of the four carries its own sentence
# and this prints it whole: a caller reporting "could not write the config"
# throws away the half a person acts on. The refusal's own JSON goes to stdout
# too, because its `unasked` list is what an unattended run turns into its
# `PLOT-UNASKED` lines.
#
# IT COMMITS NOTHING AND PUSHES NOTHING. The caller owns the commit, the way
# /plot-init's steps already do.
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
bundle="$script_dir/board/plot-adopt.mjs"

usage() {
  echo "usage: plot-write-config.sh --answers <file.json> [--report <file.json>] [--repo <dir>] [--dry-run]" >&2
}

# EVERY BUNDLE IS TRACKED IN GIT, so this refusal fires on a broken installation
# and never on a normal run — which is where naming the build command is right.
[ -f "$bundle" ] \
  || { echo "plot-write-config: cannot find $bundle — run 'pnpm build:board'." >&2; exit 1; }

answers_file=""
report_file=""
repo=""
dry_run=false
while [ $# -gt 0 ]; do
  case "$1" in
    --answers) answers_file="${2:-}"; shift 2 ;;
    --report) report_file="${2:-}"; shift 2 ;;
    --repo) repo="${2:-}"; shift 2 ;;
    --dry-run) dry_run=true; shift ;;
    -h|--help) usage; exit 0 ;;
    *) usage; exit 2 ;;
  esac
done

[ -n "$answers_file" ] || { usage; exit 2; }
[ -f "$answers_file" ] || { echo "plot-write-config: no such answers file: $answers_file" >&2; exit 2; }

if [ -z "$repo" ]; then
  repo="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
fi
cd "$repo"

# THE PROBE IS RUN HERE WHERE THE CALLER DID NOT RUN IT, so a caller with a
# report already in hand pays for one probe rather than two. Either way the
# report reaching the domain is the probe's own JSON, unmodified: a field this
# script re-derived would be a second answer to a question the probe answers.
if [ -n "$report_file" ]; then
  [ -f "$report_file" ] || { echo "plot-write-config: no such report file: $report_file" >&2; exit 2; }
  report=$(cat "$report_file")
else
  report=$("$script_dir/plot-detect-repo.sh")
fi

unattended=false
[ "${PLOT_UNATTENDED:-}" = "1" ] && unattended=true

# ASK THE DOMAIN. The request is assembled by `node` rather than by string
# concatenation: an answers file holds a Definition of Done and a tracker URL
# written by a person, and a quote in either would break a hand-built JSON
# document in the direction that silently changes what is asked.
# A PARSE FAILURE IS NAMED, not a stack trace. The answers file is written by a
# person or by whatever asked them, and an unreadable one is the most likely bad
# input this script sees — `node`'s own `SyntaxError` dump names a line inside an
# `-e` string the operator never wrote.
set +e
request=$(REPORT="$report" ANSWERS_FILE="$answers_file" UNATTENDED="$unattended" node -e '
const fs = require("node:fs");
const named = (what, file, err) => {
  process.stderr.write(`${what} (${file}) is not readable JSON: ${err.message}\n`);
  process.exit(3);
};
let report, answers;
try { report = JSON.parse(process.env.REPORT); }
catch (err) { named("the probe report", "plot-detect-repo.sh", err); }
try { answers = JSON.parse(fs.readFileSync(process.env.ANSWERS_FILE, "utf8")); }
catch (err) { named("the answers", process.env.ANSWERS_FILE, err); }
process.stdout.write(JSON.stringify({
  report,
  answers,
  unattended: process.env.UNATTENDED === "true",
}));
' 2>/tmp/plot-write-config.$$.req)
req_rc=$?
set -e
if [ "$req_rc" != 0 ]; then
  echo "plot-write-config: $(cat /tmp/plot-write-config.$$.req)" >&2
  rm -f /tmp/plot-write-config.$$.req
  exit 2
fi
rm -f /tmp/plot-write-config.$$.req

set +e
answer=$(printf '%s' "$request" | node "$bundle" 2>/tmp/plot-write-config.$$.err)
rc=$?
said=$(cat /tmp/plot-write-config.$$.err 2>/dev/null || true)
rm -f /tmp/plot-write-config.$$.err
set -e

# Exit 1 is the domain's refusal: the rule that fired, a tab, and its sentence.
# Exit 2 is this script handing the bundle something unreadable, which no
# operator can act on — so it reports as the bug it is. The refusal's JSON is
# printed either way, because the caller reads `unasked` out of it.
if [ "$rc" != 0 ]; then
  [ -n "$answer" ] && printf '%s\n' "$answer"
  if [ "$rc" = 1 ]; then
    echo "plot-write-config: $(printf '%s' "$said" | cut -f2-)" >&2
  else
    echo "plot-write-config: $said" >&2
  fi
  exit 1
fi

hub=$(printf '%s' "$answer" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>process.stdout.write(JSON.parse(s).hub))')
ignore_line=$(printf '%s' "$answer" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>process.stdout.write(JSON.parse(s).ignoreLine))')

# The section the domain decided, rendered. The RENDERING is this script's — the
# `- **Key:** value` spelling is what `plot-config.sh` reads and the domain
# returns keys and values rather than markdown, so the two spellings a hub doc
# allows stay the performer's problem.
#
# THE EVIDENCE GOES IN A BLOCK BELOW THE KEYS, NOT ON THE LINES. A trailing
# `<!-- 38 of 80 subjects -->` was written first and measured 2026-09-09:
# `plot-config.sh` strips backticks and `(...)` and nothing else, so
# `get "Definition of Done"` answered `test, lint <!-- confirmed -->` and every
# consumer of that key would have taken the comment as part of the value. The
# parser is the config-format contract and is not widened for a note — so the
# note moves to where the parser already ignores it, and every VALUE is exactly
# what a reader gets back.
section=$(printf '%s' "$answer" | node -e '
let s = "";
process.stdin.on("data", (d) => (s += d)).on("end", () => {
  const decided = JSON.parse(s);
  const lines = ["## Plot Config", ""];
  for (const k of decided.keys) lines.push(`- **${k.key}:** ${k.value}`);
  const measured = decided.keys.filter((k) => k.evidence !== "");
  if (measured.length > 0 || decided.gaps.length > 0) {
    lines.push("", "<!-- Written by /plot-init.");
    for (const k of measured) lines.push(`     ${k.key}: ${k.evidence}`);
    for (const gap of decided.gaps) lines.push(`     ${gap}`);
    lines.push("-->");
  }
  process.stdout.write(lines.join("\n") + "\n");
});
')

if [ "$dry_run" = true ]; then
  echo "--- would append to $hub:"
  printf '%s\n' "$section"
  [ -n "$ignore_line" ] && echo "--- would append to .gitignore: $ignore_line"
  printf '%s\n' "$answer"
  exit 0
fi

# APPENDED, NEVER SPLICED. A hub doc is the adopting project's own file and this
# is the one command that writes into a repository Plot does not own — so the
# section goes at the end, where nothing it did not write can be lost.
if [ -f "$hub" ]; then
  # A file not ending in a newline would otherwise take `## Plot Config` onto the
  # end of its last line, and a heading mid-line is a heading nothing parses.
  [ -n "$(tail -c 1 "$hub")" ] && printf '\n' >> "$hub"
  printf '\n' >> "$hub"
else
  mkdir -p "$(dirname "$hub")"
fi
# `printf '%s\n'` RATHER THAN `'%s'`: command substitution strips the trailing
# newline `node` wrote, so `'%s'` leaves the hub doc ending in `-->` with no
# newline — which is what the `tail -c 1` guard above then has to repair on the
# next run, and what makes `git diff` report "\ No newline at end of file" on a
# file adoption just wrote.
printf '%s\n' "$section" >> "$hub"

# The `.gitignore` line, matching the `Worktree root` just written — the half of
# that decision that cannot be skipped. A configured root with no ignore rule
# turns every dispatched desk into untracked files, and the operator's next
# `git add -A` stages a whole checkout. An absolute root lies outside the
# repository and the domain answers `''` for it, so nothing is written.
if [ -n "$ignore_line" ]; then
  if [ -f .gitignore ] && grep -qxF "$ignore_line" .gitignore; then
    :
  else
    [ -f .gitignore ] && [ -n "$(tail -c 1 .gitignore)" ] && printf '\n' >> .gitignore
    {
      printf '\n'
      printf '# The dispatch worktrees, gathered here by the `Worktree root` key rather than\n'
      printf '# scattered beside the checkout. They are CHECKOUTS — every one is re-creatable\n'
      printf '# with `git worktree add`, and none of them is content this repo carries.\n'
      printf '%s\n' "$ignore_line"
    } >> .gitignore
  fi
fi

printf '%s\n' "$answer"
