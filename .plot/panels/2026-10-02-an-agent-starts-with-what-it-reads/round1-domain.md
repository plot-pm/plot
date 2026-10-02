# Round 1 — domain lens

Position: amend

Subject: `docs/plans/2026-10-02-an-agent-starts-with-what-it-reads.md` on `origin/main`. Lens: Plot the product versus this repository's own configuration, gates versus rules, project-agnostic design.

## Summary

Slice 1 is sound and is the only slice that changes Plot the product: it ships a new file, `skills/plot/scripts/README.md`, to every adopting project. Slices 2 and 3 change only this repository's configuration and are correctly scoped there. Slice 4 measures a lever that governs no measured spend: panel jurors are `Task` agents, not charter-launched agents, so `.plot/charters/reviewer.json` does not set their model. The plan also misses `AGENTS.md`, which holds a second, stale Helper Scripts table, and it keeps "a new script gets a row there" as a rule when moving the table makes it cheap to gate.

## 1. Does each slice remove what it claims?

- **CLAUDE.md size, verified.** `git show origin/main:CLAUDE.md | wc -c` gives 137,491. The section from `## Helper Scripts` (line 183) to `## Model Tiers` (line 254) is 82,596 chars, 60% of the total. Both match Motivation line 33. Removing it leaves 54,895 chars, so the 56k target holds with about 1.1k chars of headroom before the two pointer lines are added.
- **Token claim, plausible.** 82.6k chars of backtick-dense markdown is about 20–24k tokens. A 15k-token floor in Done-when is a conservative bound.
- **"No code reads it", verified.** `git grep -nE "Helper Scripts" origin/main -- skills test scripts .github packages .plot/worker-prompt.sh README.md` returns nothing. No test reads the real repository `CLAUDE.md`: every `CLAUDE.md` reference under `test/` and `packages/*/test` writes a fixture (e.g. `test/reconcile/boardctl.test.mjs:73`, `packages/board/test/helpers.mjs:385`). `plot-config.sh:231` reads only `## Plot Config`, which stays.
- **One reader the plan does not name:** `skills/plot/scripts/plot-detect-repo.sh:276` samples `head -200` of `CLAUDE.md` for the German-word count. Lines 183–200 of that sample are table rows today. After the move the sample holds other English prose, so the count for this repository does not change in kind. This is harmless and needs no action.
- **Slice 2 settings.** `.plot/agent-settings.json` on main disables only `episodic-memory@superpowers-marketplace`, as line 54 says. `agentSettingsRefusal` (`packages/domain/src/rules/agent-settings.ts:20,81,88–97,104`) refuses `plot@…: false`, `disableAllHooks: true` and any `env` key, as line 57 says.
- **Slice 4 does not touch the spend it cites.** `skills/plot-panel/SKILL.md` step 2 says "Launch one `Task` agent per lens". Jurors are subagents of the master session, and no charter governs them (`skills/plot-panel/SKILL.md:186`: "It does not bound a juror's tools. A panel works unbounded."). `.plot/charters/reviewer.json` reaches an agent only through a dispatch that selects it (`plot-dispatch.sh:860,1635`) via an `agent: reviewer` annotation. `git grep "agent: *reviewer" origin/main -- docs/plans` finds only the illustrative example in `2026-09-15-a-slice-names-the-agent-it-needs.md:62,133`. No plan on main routes a real slice to the charter. Changing its model saves close to zero. The juror spend that Motivation line 37 measures is set by the master session's `Agent` call (and, for board-launched panels, by the `Interrogate command` key in `## Plot Config`, which pins `--model opus`).

## 2. What breaks, and what a fleet agent loses

- **`AGENTS.md` is missed.** `AGENTS.md:38` holds its own `## Helper Scripts` table with 11 rows, which is stale against the 62 rows in `CLAUDE.md`. `plot-config.sh:229–231` falls back to `AGENTS.md`, `plot-board-probe.sh:134` and `plot-detect-repo.sh:186` read it as a hub document, and `skills/plot-deliver/SKILL.md:394` and `skills/plot-release/SKILL.md:273` tell the agent to read it. A non-Claude harness (`PLOT_HARNESS`) loads `AGENTS.md` and not `CLAUDE.md`. After slice 1, the two hub documents disagree about where the script reference is.
- **The new file ships to adopters.** `skills/plot/scripts/` is part of the plugin, so `README.md` there is product documentation. This is the right home, because the table describes Plot's scripts and not this repository. But the rows are full of this estate's measurements ("measured on this estate", PR numbers, "this repo titles plans …"). Those rows now reach every adopting project. This does not violate Project-Agnostic Design, because the rows name Plot's own behaviour and no adopter's configuration. The plan should still say that the file ships, and the `## Changelog` should state it as an adopter-visible change.
- **The changelog mixes product and repository.** Changelog lines 16–18 (plugins, master-agent spawn rule, charter model) describe this repository's own `.plot/` and `CLAUDE.md`. An adopting project gets none of them. A changeset that publishes them reads as a Plot feature that no adopter receives.
- **`/plot-init` and the skills are unaffected.** `git grep -niE "helper|scripts table" origin/main -- skills/plot-init` returns nothing, and `skills/plot-implement/SKILL.md` (the brief step, lines 207–330) never names the table. The "add a row to the Helper Scripts table in `CLAUDE.md`" text in 6 briefs under `.plot/briefs/` comes from the brief writer reading `CLAUDE.md`, not from skill text. The plan's conditional at line 50 ("if its text names the table at all") resolves to: it does not, so the slice edits no skill text.
- **Slice 2 and the operator's global instructions.** `~/.claude/CLAUDE.md` is the oh-my-claudecode hub ("Route code to `executor`", `oh-my-claudecode:*` agent types). A settings file cannot remove that file. If slice 2 disables the `oh-my-claudecode` plugin, every worker still reads instructions to delegate to agent types that no longer exist. The oh-my-claudecode decision must weigh this, not only the 24k chars of hook output.
- **Slice 2's plugin list is one machine's list.** The transcripts are local to the operator's machine, and `.plot/agent-settings.json` is committed. A second operator (`People:` names `eins78`) runs workers with a different plugin set. Disabling a plugin that is not installed is harmless, but the method cannot see a plugin that only the other machine's workers use. The plan should say the list is derived from one machine, and the slice should record which machine.
- **The method sees invoked skills and tools, not passive plugins.** A plugin that contributes only hooks or SessionStart context leaves no "invoked" trace in a transcript. The plot plugin is protected by `agentSettingsRefusal`, but any other hook-only plugin a workflow depends on reads as "unused".
- **`--strict-mcp-config` also removes plugin MCP servers**, not only the claude.ai connectors. The measurement must check both, and must confirm that a worker keeps every MCP tool its slices use.

## 3. Order, landability, missing parts

- The four slices touch disjoint files and each is landable alone.
- **Measurement order matters.** Slices 1 and 2 both lower a worker's first-request context. If they merge on the same day, the per-slice Done-when numbers cannot be separated. Slice 1 needs its own measurement window, closed before slice 2 merges.
- **The rule "a new script gets a row there" is already broken, and the move makes it gateable.** Measured on `origin/main`: 59 `skills/plot/scripts/*.sh` files, of which 14 have no row; 36 `skills/plot/scripts/board/*.mjs` bundles, of which 19 have no row. In a dedicated file, a CI check comparing `ls skills/plot/scripts/{*.sh,board/*.mjs}` with the table's first column is a few lines. It can be a ratchet that allows today's 33 missing rows and fails when the number grows. This is the Gates Over Rules test applied to the plan's own new rule.
- **Nothing keeps the table out of `CLAUDE.md`**, and `CLAUDE.md` grows with almost every slice. A ratchet on its size (or a check that `CLAUDE.md` holds no `## Helper Scripts` heading) keeps the 56k result.
- **The measurement tool is outside the repository.** `python3 ~/claude-usage-report.py` is in the operator's home directory. No reviewer or agent can rerun it. The Notes must carry the exact command, window and raw output for each number, so the comparison is checkable later.

## 4. Done-when and Open Questions

- **56k chars:** honest and measurable, with small headroom. State it as measured at the slice's merge commit, because main grows.
- **≥15k-token drop:** plausible against about 20k removed. It needs its own window (see above), and "median over N workers" should name N.
- **Transcript-based plugin list:** measurable, but scope it to one machine and to invoked skills/tools, and say so.
- **Slice 4 Done-when** ("charter's model follows the rule") is measurable but tests the wrong lever. A single Opus-versus-Sonnet run also has no control: two Opus runs of the same panel would not produce identical named findings either, so "every juror's position and named findings match" fails for noise, not for model.
- **Open Question 1 is answered now:** no skill, script, test or worker prompt reads the table from `CLAUDE.md` (grep above). Close it with that evidence.
- **Missing Open Questions:** what happens to `AGENTS.md`'s copy; whether the plugin list should be derived per machine; whether slice 4 measures a lever that sets any measured spend.

## Amendments

1. **Slice 1:** add `AGENTS.md` to the scope. Replace its `## Helper Scripts` section with the same two-line pointer to `skills/plot/scripts/README.md`, so both hub documents agree.
2. **Slice 1:** add a CI gate in `scripts/` that fails when a `skills/plot/scripts/*.sh` or `board/*.mjs` file has no row in `skills/plot/scripts/README.md`. Make it a ratchet starting at today's 33 missing rows. Name it in Done-when. Optionally add a check that `CLAUDE.md` holds no `## Helper Scripts` heading.
3. **Slice 1:** state in Design that `skills/plot/scripts/README.md` ships to adopting projects, and keep the changeset for this slice only.
4. **`## Changelog`:** keep only the slice 1 line as a product change. Move the plugin, spawn-rule and charter lines to Notes as repository changes, or mark them as such, so no changeset publishes them to adopters.
5. **Slice 4:** replace it. Either measure the lever that sets juror spend (the model in the master session's `Agent` call for panels, and the `Interrogate command` key for board-launched panels), or drop the slice. If a side-by-side panel stays, add a control run (the same model twice) so a mismatch can be attributed to the model and not to noise.
6. **Slice 2:** record which machine's transcripts produced the list. Weigh the oh-my-claudecode decision against `~/.claude/CLAUDE.md`, which still instructs workers to use oh-my-claudecode agents. Measure `--strict-mcp-config` against plugin MCP servers as well as claude.ai connectors.
7. **Verification:** give slice 1 its own measurement window, closed before slice 2 merges. Record the command, window, worker count and raw numbers in Notes for each Done-when figure.
8. **Open Questions:** close question 1 with the grep evidence above. Add the `AGENTS.md` and per-machine questions if amendments 1 and 6 are not adopted.
