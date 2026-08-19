# Brief: feature/the-plan-meta-reports-a-changelog

Implement the first branch of wave *The proposal* in
`docs/plans/2026-08-18-a-sprint-names-what-it-ships.md`.
Read the plan first. Wave 1 (`a-sprint-names-its-release`, #229) is merged.

## Why this branch exists before the one beside it

Its sibling (`feature/a-sprint-proposes-its-work`) ranks plans against a sprint
goal by reading **title, story and changelog**. The changelog is the one field
that says *what a plan changes* — and `plot-plan-meta.sh` does not report it.
Verified 2026-08-19: the JSON carries `approved_raw`, `assignee`, `branches`,
`delivered_raw`, `file`, `format`, `impl`, `issues`, `phase`, `prs` — and no
`changelog`.

So this is the smaller half of a pair, and it is genuinely first: the ranking
cannot read a field that does not exist.

## What to build

**`plot-plan-meta.sh` reports the plan's `## Changelog` entries.**

**Additive to the contract.** `plot-plan-meta.sh` is *the plan-format contract*
(CLAUDE.md says so), and `test/reconcile/parser.test.mjs` pins the existing
fields. That test must keep passing **untouched** — if you find yourself editing
it to accommodate a new field, the field is not additive and something is wrong.

**Escaping is the whole risk.** The plan measured it before proposing:

| Fact | Value |
|---|---|
| largest changelog in the repo | 10 entries (re-verified today) |
| changelogs containing a code block | 0 |
| backticks, links and quotes across all of them | 72 |

Those 72 characters are what `jq -R` already handles elsewhere in this script.
**A changelog containing a backtick, a markdown link and a double quote must
survive the round trip** — that is the test the plan names explicitly, and it is
the one that will fail if you hand-roll the escaping.

**A plan with no changelog reports an empty value, not an error.** Most plans
have one, some do not, and a parser that fails on an absent optional section
would take down every consumer of this script for a section nobody promised.

## Definition of Done

- A plan with a changelog reports its entries
- A plan without one reports an empty value rather than failing
- A changelog containing backticks, a markdown link and a double quote survives
  the round trip — assert by parsing the output back, not by eyeballing it
- The existing fields are byte-identical; `parser.test.mjs` passes unedited
- `pnpm test`, `pnpm run test:reconcile` pass — one at a time
- A changeset with a `bumps:` block

## Do not

- Do not edit `parser.test.mjs` to make room for the new field
- Do not implement the ranking — that is `feature/a-sprint-proposes-its-work`,
  which may be running beside you
- Do not change any existing field's shape or name; consumers read them by key
- Do not touch `plot-fleet-scan.sh`

## Platform notes

The awk program in `plot-plan-meta.sh` lives inside a single-quoted shell
string, so **an apostrophe in a comment silently truncates the program** — a
sibling agent broke the parser that way today. If you add comments to the awk,
avoid apostrophes.

CI runs Linux; you are probably on macOS. Run the suites **one at a time**.

**Line numbers may drift** — follow the rule, not the number.

If you find something the plan did not anticipate, implement what you can and
report the discovery rather than improvising.
