## Implementation brief — an-agent-starts-with-what-it-reads (slice 1: The helper table leaves CLAUDE.md)

- **Plan (canonical):** `docs/plans/2026-10-02-an-agent-starts-with-what-it-reads.md` on `main`
- **Approved:** 2026-10-02, jwloka, in-session
- **Branch:** `infra/the-helper-table-leaves-claude-md` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** per repo convention (CI is the authority)

This is slice 1 of 3. Slices 2 and 3 (`infra/a-worker-starts-without-unused-context`, `docs/the-master-agent-briefs-rather-than-forks`) are independent of it, except that slice 1 is measured before slice 2 merges.

### What to build

Every Plot session, fleet worker and subagent loads `CLAUDE.md` on its first request, and `## Helper Scripts` is 83,209 of its 138,122 characters (measured 2026-10-02 on `main` at `abc0f784f`, lines 183–253). No gate, test, skill, CI step or worker prompt parses that table. The slice moves it, unchanged, to a file nobody loads by default, and keeps it from coming back.

1. **`skills/plot/scripts/README.md`** is new and holds the table verbatim (heading, intro sentence, every row). Move it; do not rewrite or shorten a row.
2. **`CLAUDE.md`** keeps two lines where the section was: the README's path, and the rule "a new script gets a row there". `## Plot Config`, `## Architecture` and the rest stay.
3. **`AGENTS.md:38`** has a stale 11-row copy of the table. Replace it with the same pointer. `plot-config.sh` falls back to `AGENTS.md`, so touch only the table section.
4. **`plot-deliverable-search.sh`** searches `skills/plot/scripts` (corpus list near `:115`). Add the README to the excludes (`excludes=(…)` near line 154). The existing list is the script itself plus the `-merge` files from `.gitattributes`; the README is a hand-written file, so name it directly. Add a test in `test/reconcile/deliverable-search.test.mjs`: a term naming a script (for example the script's own basename) does not match the README.
5. **`scripts/check-helper-table.sh`** is the gate, wired into `.github/workflows/ci.yml` next to *No desk marker is tracked*. It refuses (a) a `## Helper Scripts` heading in `CLAUDE.md`, (b) a `` | `plot- `` table row in `CLAUDE.md`, and (c) a shipped `skills/plot/scripts/*.sh` or `skills/plot/scripts/board/*.mjs` with no row in the README. (c) is a ratchet: record the baseline of rows still missing and fail when the count grows. Model the script's shape on `scripts/check-desk-markers.sh` (header with the measurement, `repo-root` argument, `::error::` line, one success line).
6. **`/plot-implement`'s brief step** names the new file where it names the old table. The briefs already on `main` that name the old table are history; leave them.
7. A **changeset** in `.changeset/` (copy the format from `.changeset/_template` and a sibling), package `plot`, patch, description first and `bumps:` block last. The plan's `## Changelog` line is the description's source.

### The decisions the plan settles — do not re-derive them

- **The table cannot stay with a pointer plus a summary.** The measurement is context paid on every request; any residue in `CLAUDE.md` is paid again. Two lines, no digest.
- **`## Plot Config` stays in `CLAUDE.md`.** `plot-config.sh` and `agent-log.ts` read its keys there. Moving the table must not move or reflow that section.
- **The README must be excluded from the deliverable search.** `plot-deliverable-search.sh` searches `skills/plot/scripts`, and an 83k-character table mentioning nearly every script name there would match almost every `/plot-idea` search. This is why the exclusion has its own test.
- **The row check is a ratchet, not a zero.** The plan measured 14 of 59 `.sh` and 19 of 36 `board/*.mjs` with no row (33). Re-measured 2026-10-02 against the table as it now stands: 9 of 59 `.sh` and 17 of 37 `board/*.mjs` (26), counting a backticked name anywhere in the section, with `board/` prefixed for bundles. The two counts differ because the table grew and because of the matching rule. **Take the baseline from the gate's own matching rule at build time, and state that rule in the script's header.** Do not copy 33 or 26 in. `board/plot-quiet-stretch.mjs` and any file the gate cannot name a rule for are a judgement; if a file is not a shipped bundle, exclude it by name with the reason.
- **Rows are matched on the first cell, not on the section.** Reading "any backtick anywhere" passes a script mentioned only in another row's prose. The ratchet's honest form is *a row whose first cell is this name*. If that count differs from the loose one, record the strict one.
- **The gate reads what git tracks** (`git ls-files`), as `check-desk-markers.sh` does, so an untracked scratch file never fails it.
- **Rules carried over unchanged:** read exit codes, not output emptiness; a gate that cannot read its inputs fails loudly, never passes. The gate must not itself match the heading it bans inside a fenced code block of another section; test with a fenced example.

### Done when

The plan's `## Done when` list for slice 1 is the specification:

- `CLAUDE.md` is at least 80,000 chars smaller than its parent commit (`git show HEAD~1:CLAUDE.md | wc -c` against the working file). The table is 83,209 chars today, so two pointer lines leave about 3k of margin. Another branch adding rows lowers it; measure, do not assume.
- `scripts/check-helper-table.sh` runs in CI and passes.
- `AGENTS.md` holds the pointer, and no table.
- The README is excluded from the deliverable search, and a test proves it.
- **The controlled pair is measured and recorded in the plan's Notes**: one `claude -p` start on `main` before the slice and one after, same machine, same prompt and settings, first-request token count of both read from their transcripts. Record the `~/claude-usage-report.py` sha256 and its raw output beside it. This is the slice's evidence; without it the plan's central claim is unverified.

Assertions that exist because a naive implementation would pass without them:

- **A mutation test of the gate:** put one row back into `CLAUDE.md` in a scratch copy and see the gate fail; delete one README row and see the ratchet fail. A gate never seen failing proves nothing.
- **The exclusion test must fail without the exclusion.** Run it once with the exclude removed.
- **The README holds every row the old table held.** Compare the row count (and a diff of the table body) against `git show origin/main:CLAUDE.md`; a move that drops a row passes every other check.

Plus: run `node skills/plot/scripts/board/plot-local-checks.mjs` before each push and run what it prints. The suites in the `CI suites` config key run in CI, and a failure there comes back as a correction. Run `./scripts/check-script-names.sh` and the other `scripts/check-*.sh` the checker prints; a new script must satisfy the existing gates.

### Bookkeeping

Open the PR with `skills/plot/scripts/plot-open-pr.sh` (never `gh pr create`), then append `→ #<number>` to this branch's line under `## Slices` in the plan. Push the first real commit as soon as it exists. Do not edit `State:`.

### Scope guard

This branch owns: `skills/plot/scripts/README.md`, `CLAUDE.md` (the Helper Scripts section only), `AGENTS.md` (the table section only), `skills/plot/scripts/plot-deliverable-search.sh`, `test/reconcile/deliverable-search.test.mjs`, `scripts/check-helper-table.sh`, `.github/workflows/ci.yml` (one step), the `/plot-implement` brief step in `skills/plot-implement/SKILL.md`, and one changeset.

In flight, verified 2026-10-02: `origin/bug/the-scripts-own-the-approval-and-the-release` changes two lines of `CLAUDE.md`, in its own section; a rebase is clean unless it edits a table row, and then its row moves to the README. Slice 3 edits `CLAUDE.md`'s *The Master Agent Uses The Controllers*, a different section. Slice 2 edits `.plot/worker-prompt.sh` and `.plot/agent-settings.json`. None of the three share a file with this slice beyond `CLAUDE.md`.

If you find something the plan did not anticipate, report it rather than improvising outside scope.
