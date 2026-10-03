## Implementation brief — an-agent-starts-with-what-it-reads (slice 3: the master agent briefs rather than forks)

- **Plan (canonical):** `docs/plans/2026-10-02-an-agent-starts-with-what-it-reads.md` on main
- **Approved:** 2026-10-02, jwloka, in-session
- **Branch:** `docs/the-master-agent-briefs-rather-than-forks` (base: `main`)
- **Ends as:** one PR to main
- **Review of the code:** repo convention (CI green + review)

Last of three slices. Slices 1 (#1238) and 2 (#1241) are merged, and this slice waits on neither.

### What to build

One rule in `CLAUDE.md`, in the section *The Master Agent Uses The Controllers*: above about 200k context, the master agent starts a `general-purpose` subagent with a written brief instead of a `fork`. Mechanical subtasks (search, git, test runs, verification) run with `model: sonnet`.

The failure it addresses, measured 2026-10-02 in the master session: 34 `fork` subagents started at a median 336k tokens and cost 84M weighted, 16% of all spend. 65 `general-purpose` subagents started at a median 100k. A fork copies the parent's whole context, so its cost follows the parent's size at spawn time, not the size of its task.

The change is prose in one file, plus the mirror `AGENTS.md`. The plan is canonical; this brief orients.

### The decisions the plan settles — do not re-derive them

**This is a rule, not a gate, and the section must say so.** The spawn decision happens inside a model turn. No hook reads the parent's context size, so a PreToolUse gate on `Agent` has nothing to compare against. The repo's *Gates Over Rules* section asks for a gate where one is possible; this rule states why none is. Do not add a hook, a script or a CI check for it.

**What makes the rule checkable is a measurement seven days after merge.** The plan's Done when records the master session's fork count and median fork start size against 34 and 336k. That is a dated Notes entry, written by a person or the master agent after 2026-10-10 at the earliest. This slice does not write it, and it does not claim the rule worked.

**The threshold is "about 200k", not a measured cutoff.** 336k is the fork median and 100k the briefed median; 200k sits between them and matches the figure already in the user-level `CLAUDE.md`. Do not invent a derivation for the number. Write it as "about 200k".

**The Sonnet tier applies `## Model Tiers` to Agent calls, it adds no new tier.** `## Model Tiers` (CLAUDE.md:194) already maps mechanical work to Small and Mid tiers. The rule names the four mechanical kinds and says they take `model: sonnet`. Judgement work (review, design, root cause) keeps the model the task needs. The plan states the change removes context the model does not use and does not lower the tier where a judgement is made; the wording must not read as "use Sonnet for subagents".

**A fork is not banned.** Below about 200k a fork is cheaper than writing a brief, and a fork can see what the parent saw. The rule is about size at spawn time.

**The section's own scope is the master agent**, as the section already says. Dispatched workers' subagents are not covered here; do not widen it.

**The rule exists at user level already.** `~/.claude/CLAUDE.md` carries *"Above ~200k context, brief a subagent instead of forking"* under the Quatico shared preferences. That file is outside this repository and other operators do not load it. The repository's `CLAUDE.md` states the rule for anyone working here and cites this plan; do not edit or copy from the user-level file.

**Rules carried over unchanged from slices 1 and 2:** `CLAUDE.md` holds `## Plot Config` and nothing in this slice moves or edits it. State current behaviour: no "until 2026-10-03" history in the paragraph, which belongs in the plan's Notes and the commit message. Measured facts go in with their date and source (the usage report's sha256 is in the plan's Notes).

### Done when

The plan's `## Done when` list for slice 3 is the specification: the rule stands in `CLAUDE.md`'s master-agent section. The seven-day measurement is a later Notes entry and not this branch's work.

Assertions that exist because a naive implementation would pass without them:

- **`AGENTS.md` mirrors the change.** Run `./scripts/check-agents-md.sh --write` after editing `CLAUDE.md`, then `./scripts/check-agents-md.sh`. Editing `CLAUDE.md` alone passes locally and fails CI, which refuses a mirror that differs.
- **The rule sits inside *The Master Agent Uses The Controllers***, not in a new top-level section and not under `## Model Tiers`. Check with `grep -n '^## ' CLAUDE.md` that the section count is unchanged.
- **The paragraph names both numbers and the date** (34 forks at a median 336k, against 65 briefed at a median 100k, measured 2026-10-02). A rule without them reads as preference and gets re-litigated.
- **No hard-wrapped prose.** One paragraph is one line.

Plus: this branch ships no skill or board change, so it needs no `pnpm build:board`. Add a changeset only if `node skills/plot/scripts/board/plot-local-checks.mjs` or `./scripts/check-changeset-packages.sh` asks for one; the plan's board-impact comment says slices 2 and 3 publish no changelog entry. Run `plot-local-checks.mjs` before each push and run what it prints. The suites in the `CI suites` config key run in CI, and a failure there comes back as a correction. Use `trash`, not `rm`.

### Bookkeeping

Open the PR with `skills/plot/scripts/plot-open-pr.sh` (never `gh pr create`), then append `→ #<number>` to this branch's line under `## Slices` in the plan, from a scratch worktree on `origin/main`. Add a dated line to the plan's `## Notes` saying the rule landed and that the seven-day measurement is due on or after 2026-10-10 for the merge date plus seven days. Push the first real commit as soon as it exists. Do not edit `State:`.

### Scope guard

This branch owns: `CLAUDE.md`, the generated `AGENTS.md`, and the plan's `## Notes` and slice line.

In flight, verified 2026-10-03: `docs/plans/2026-10-02-an-agent-starts-with-what-it-reads.md` slice 2 (#1241) is merged and no other plan names `CLAUDE.md`'s master-agent section for this work. Other open branches may touch `CLAUDE.md` elsewhere; take a rebase over a conflict and re-run `./scripts/check-agents-md.sh --write`.

If you find something the plan did not anticipate, report it rather than improvising outside scope.
