#!/usr/bin/env bash
# Plot helper: the plans a sprint could contain, and what each one says it does.
# Usage: plot-sprint-candidates.sh
# Output: JSON {plans:[{slug, file, phase, type, title, story, changelog:[...]}],
#               count, changelog_available}
#
# THE FACTS ONLY — and this script is deliberately the *less* interesting half
# of its feature. Sprint creation proposes the plans that serve the stated goal;
# the proposal is a semantic judgement a model makes, reading the goal against
# each plan's title, story and changelog. That judgement is not here and must
# not move here (Manifesto Principle 3: scripts collect and report, skills
# interpret and adapt).
#
# The reason is the case the feature exists for, recorded in
# docs/plans/2026-08-18-a-sprint-names-what-it-ships.md:
#
#   goal  "the board tells the truth"
#   plan  "none printed before the first fetch"
#   shared words: none
#
# Any ranking a shell script could compute scores on word overlap, and word
# overlap ranks that plan LAST. So the script collects the text and stops; a
# `score` field here would be a wrong answer wearing a helper's clothes.
#
# `changelog_available` says whether plot-plan-meta.sh reports the changelog
# field. It exists because the field arrived separately from this feature, and a
# caller that ranks on two signals while believing it read three would say so
# confidently and wrongly. False means: rank on title and story, and SAY that
# the third signal was unavailable.
#
# Which plans are candidates: every plan whose phase is not delivered or
# released — the unfinished estate. Not the `active/` index, because that is a
# symlink directory that drifts (/plot-reconcile exists for exactly that drift)
# and a plan missing from it is still unfinished work. Phase is the fact.
#
# A file with NO phase is not a plan and is skipped. `docs/plans/` holds a few
# such documents — a decision log, a blocked-worker report — and one of them
# says so in its own header: "Not a plan — it carries no Status block and no
# phase, so plot-plan-meta.sh and the board ignore it by design." The board
# ignores them; a proposal that offered them would be offering a sprint item
# that cannot be delivered, with no title to rank on either.
#
# The assembly runs through node rather than sed. That is not a preference: a
# `"title":"[^"]*"` match truncates at the first ESCAPED quote, and this repo
# titles plans things like `... is not "no commits yet"` — one such title turns
# the output into invalid JSON, silently, for the one caller that most needs to
# read it. node is already required to run the board and every test suite.
#
# Designed for small-model consumption: structured JSON, no interpretation.

set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
root=$(git rev-parse --show-toplevel 2>/dev/null) || root="."
cd "$root" || exit 0

PLAN_DIR="$(bash "$HERE/plot-config.sh" get "Plan directory" "docs/plans/")"
PLAN_DIR="${PLAN_DIR%/}"

# One plot-plan-meta.sh object per line, then reduce. A plan whose meta fails to
# parse is dropped rather than fatal: this reports candidates for a proposal,
# and one malformed file must not cost the operator the other fifty.
for f in "$PLAN_DIR"/*.md; do
  [ -f "$f" ] || continue
  bash "$HERE/plot-plan-meta.sh" "$f" 2>/dev/null
done | node -e '
let buf = "";
process.stdin.on("data", (d) => (buf += d)).on("end", () => {
  const plans = [];
  let changelogAvailable = false;

  for (const line of buf.split("\n")) {
    if (!line.trim()) continue;
    let m;
    try { m = JSON.parse(line); } catch { continue; }

    // No phase → not a plan. Delivered/released → not unfinished.
    const phase = m.phase || "";
    if (!phase || phase === "NONE") continue;
    if (phase === "delivered" || phase === "released") continue;

    if (Object.prototype.hasOwnProperty.call(m, "changelog")) changelogAvailable = true;

    // The slug a sprint item carries: the filename without its ISO date.
    const base = (m.file || "").replace(/^.*\//, "").replace(/\.md$/, "");
    const slug = base.replace(/^\d{4}-\d{2}-\d{2}-/, "");

    plans.push({
      slug,
      file: m.file || "",
      phase,
      type: m.type || "",
      title: m.title || "",
      story: m.story || "",
      changelog: Array.isArray(m.changelog) ? m.changelog : [],
    });
  }

  process.stdout.write(JSON.stringify({
    plans,
    count: plans.length,
    changelog_available: changelogAvailable,
  }) + "\n");
});
'
