#!/usr/bin/env bash
# Every changeset names a real package AND says what changed.
#
# WHY THIS EXISTS. Two failures, both silent, both measured on this repo:
#
# 1. `changeset version` refuses OUTRIGHT on a single unknown package name — it
#    does not skip the file, it aborts the whole run:
#
#        Found changeset X for package @plot-pm/plot which is not in the workspace
#
#    Measured 2026-08-26: six changesets named `@plot-pm/plot` (x4),
#    `@plot-pm/skills` and `plot-deliver`, none a workspace package. The release
#    PR could therefore never regenerate. It sat at 8 of 98 changesets for FOUR
#    DAYS, 355 commits behind main, and nothing reported why.
#
# 2. Changesets publishes the FIRST line after the frontmatter. A `bumps:` block
#    written first makes that line the comment-open marker, so the release note
#    reads as a bare marker and the description behind it never ships.
#    Measured 2026-08-30: 19 of 169 published entries, 11%.
#
# The failure mode is the point, and it is the same one twice: a refusal nobody
# sees is indistinguishable from nothing needing to be done. This turns both
# into a red PR check the day the file is written.
#
# THIS SCRIPT DECIDES NOTHING. It reads the world — which packages the
# workspace has, what the changeset files contain — and hands both to
# `packages/domain/src/rules/changeset.ts`, which answers with named refusals.
# The exit code is this script's translation of that answer, and the only `if`
# below is about whether there were any.
#
# Why the rule lives there: `scripts/` has no tests, `packages/domain/` runs
# under a 100% coverage gate, so the cases a real repository will not produce on
# demand are reachable from a plain function call. Reaching it through `node` is
# settled precedent — seven scripts already do, and Node 24 runs the package's
# TypeScript directly, so this needs no build step.
#
# THE VALID NAMES ARE DERIVED, never hardcoded. They come from the workspace's
# own package.json files, so adding a package cannot leave this check stale.
set -euo pipefail

cd "$(dirname "$0")/.."

# The workspace's real package names: the root, plus every packages/* that has
# a package.json. Mirrors `pnpm-workspace.yaml` ("." and "packages/*").
valid=$(
  {
    node -pe "require('./package.json').name"
    for d in packages/*/; do
      [ -f "$d/package.json" ] && node -pe "require('./$d/package.json').name"
    done
  } | sort -u
)

[ -n "$valid" ] || { echo "check-changeset-packages: no workspace packages found" >&2; exit 2; }

# The adapter: read each changeset, ask the rule, render its refusals. Exits 1
# when the rule returned any, 0 when it returned none.
# The JS is fed on STDIN from a QUOTED heredoc, not passed with `node -e`.
# An apostrophe in the JS would close a single-quoted -e string, and this
# script's messages contain them; `<<'EOF'` also stops the shell expanding
# the `${...}` template literals before node ever sees them.
VALID_PACKAGES="$valid" node --input-type=module - <<'NODE_EOF'
import { readFileSync, readdirSync } from "node:fs";
import { checkChangeset, parseChangeset } from "./packages/domain/src/rules/changeset.ts";

const valid = process.env.VALID_PACKAGES.split("\n").filter(Boolean);

// A changeset directory that does not exist is not a failure: a branch may
// legitimately carry none, and the separate "Check for changeset" CI step is
// what requires one.
let entries = [];
try {
  entries = readdirSync(".changeset");
} catch {}

const skip = (name) => !name.endsWith(".md") || name === "README.md" || name.startsWith("_template");

// What each refusal means to someone who has to fix it. The rule names the
// measurement; this names the repair, because only the caller knows the file.
const explain = {
  "unknown-package": (d) =>
    `changeset names "${d}", which is not a workspace package. Valid: ${valid.join(" ")}`,
  "no-description": (d) =>
    d === ""
      ? "changeset has no description. Changesets publishes the first line after the frontmatter; there is none."
      : `changeset publishes "${d}" as its whole description. Put the prose FIRST and the bumps comment LAST — Changesets publishes the first line after the frontmatter.`,
};

let failed = 0;
let linked = 0;
let total = 0;
// THE FILES, NOT JUST THE NUMBER. A bare `1 of 28` is not actionable, and a
// finding must be actionable the day it fires — so the names collected here
// are what a person opens, and what the ratchet reads once adoption is
// non-zero. Same shape as the `fs.rmSync` ratchet in ci.yml: the count, then
// the hits.
const unlinked = [];
for (const name of readdirSync(".changeset").filter((n) => !skip(n))) {
  const file = `.changeset/${name}`;
  const text = readFileSync(file, "utf8");
  total++;
  for (const { refusal, detail } of checkChangeset(text, valid)) {
    console.log(`::error file=${file}::${explain[refusal](detail)}`);
    failed++;
  }
  // COUNTED, NEVER REFUSED. The link is optional: 0 of 19 changesets carried
  // one when it was introduced, so a gate demanding it would refuse every
  // changeset in flight. Whether to require it is a later decision, and this
  // number is what it will be taken against.
  //
  // ASKED OF THE RULE, NOT RE-DERIVED HERE. `parseChangeset` owns what a plan
  // reference looks like, down to the leading `#` some authors write inside
  // the comment block — a second reading in this script would be a third
  // implementation of a question the domain already answers, and the two would
  // drift the first time the form changed.
  if (parseChangeset(text).plan !== undefined) linked++;
  else unlinked.push(file);
}

if (failed > 0) {
  console.log("");
  console.log("A changeset naming an unknown package makes `changeset version` abort the");
  console.log("ENTIRE release, not just that file. A changeset whose first line opens a");
  console.log("comment publishes that marker as the release note. Fix the files above.");
  process.exit(1);
}
console.log("All changesets name workspace packages and say what changed.");

// COUNT FIRST, GATE LATER. This number is REPORTED and never enforced: 0 of 14
// named a plan when the convention was introduced, so a refusal would have
// failed every changeset in flight. It is printed on every run so the figure
// is visible in CI output and can be read back later — the ratchet's input,
// not yet the ratchet.
//
// `::notice::` rather than `::error::`, deliberately. The other ratchets in
// `ci.yml` bound a number that must not GROW; this one watches a number that
// should grow, so there is no count at which this line becomes a failure. The
// exit code below is unchanged whatever it says.
console.log(`changesets naming a plan: ${linked} of ${total}`);
if (unlinked.length > 0) {
  console.log(`::notice::${unlinked.length} changeset(s) name no plan. Optional today; add a \`plan:\` line to the bumps comment to link one.`);
  for (const file of unlinked) console.log(`  ${file}`);
}
NODE_EOF
