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
import { checkChangeset } from "./packages/domain/src/rules/changeset.ts";

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
for (const name of readdirSync(".changeset").filter((n) => !skip(n))) {
  const file = `.changeset/${name}`;
  for (const { refusal, detail } of checkChangeset(readFileSync(file, "utf8"), valid)) {
    console.log(`::error file=${file}::${explain[refusal](detail)}`);
    failed++;
  }
}

if (failed > 0) {
  console.log("");
  console.log("A changeset naming an unknown package makes `changeset version` abort the");
  console.log("ENTIRE release, not just that file. A changeset whose first line opens a");
  console.log("comment publishes that marker as the release note. Fix the files above.");
  process.exit(1);
}
console.log("All changesets name workspace packages and say what changed.");
NODE_EOF
