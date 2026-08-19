---
"plot": minor
---

plot: plot-plan-meta.sh reports the plan's changelog

`plot-plan-meta.sh` is the plan-format contract, and it reported everything
about a plan except what the plan *changes*. `title` says what it is called,
`story` says what it belongs to, `phase` says how far along it is — and the one
section that states the change in a sentence was unreadable to every consumer.
`/plot-release` extracts it by hand today; the sprint proposal that ranks plans
against a goal cannot rank on a field that does not exist.

**`changelog` reports ENTRIES, not lines**, and that is the one place the
measurement corrected the plan. The plan proposed the field on the finding that
no changelog in the repo contains a code block, and concluded from it that
entries are single lines. Re-measured on 2026-08-19 across all 34 changelogs:
**9 of them wrap a bullet across two or more lines**, and 8 close the section
with a flush-left `Board impact:` paragraph. Line-per-line would have shredded a
quarter of the estate into fragments, and handed a ranking consumer the reviewer
note as if it were a release note. So a bullet opens an entry, an indented line
continues it, and a blank or flush-left line closes it. An indented *bullet*
folds in the same way — no changelog nests today, and the rule is what stops a
sub-point being promoted to a headline beside its own parent the day one does.

**Additive, and `test/reconcile/parser.test.mjs` is the proof — untouched.** The
new assertions live in their own file for that reason: a contract test that had
to be edited to make room would have disproved the claim it was there to
support. Every existing field stays byte-identical.

**Escaping is asserted by parsing the output back, never by reading it.** A
changelog carrying backticks, a markdown link, double quotes and backslashes
round-trips through `JSON.parse`, and the whole 64-plan estate is parsed as a
final check — because the failure mode of hand-rolled escaping is output that
still looks like JSON and no longer is. `jesc()` already handled all of it; the
test is what says so.

A plan with no changelog reports `[]`. An unfilled template section reports `[]`
too: the template's `## Changelog` is a guidance comment plus a placeholder
bullet, and a plan that changes nothing yet must not claim a placeholder as a
release note. The board needs no change to receive the field — `PlanMetaSchema`
is a plain `z.object`, which strips unknown keys rather than rejecting them, so
the new key reaches consumers that ask for it and is invisible to the rest.

<!--
bumps:
  skills:
    plot: minor
-->
