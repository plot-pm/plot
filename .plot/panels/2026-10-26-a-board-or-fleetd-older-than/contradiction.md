# Juror: contradiction

Subject: `docs/plans/2026-10-26-a-board-or-fleetd-older-than.md` at `387736b4e` (branch `idea/a-board-or-fleetd-older-than`, merge base `df1c6d4dd`). Code read at `origin/main` `48dec508e` in `p2729-main`. Evidence: issue #2728 (ran `gh issue view`, read-only), the #2726 panel files on main (read), commit `a98afb890` (#2740, ran `git show`).

Position: amend

## Summary

The plan's account of the incident matches the #2726 panel. But the plan was written against a base older than #2740, and #2740 removed the marker from the implement run, which is the plan's lead example. The gate-message slice also contradicts the gate's own contract: a missing marker is the normal state of every desk worker, so the proposed text blames a stale spawner in the common, correct case. The spawner slice compares a bundle with itself, which is not the comparison the issue asks for, and it misses the plugin-install case completely. Each contradiction below quotes both sides.

## C1. The implement run no longer sets the marker (HIGH)

Plan, Motivation: "so `gatesMainCheckout` (`packages/domain/src/rules/main-checkout-write.ts:32`) refuses the commit that `implement-run.ts:617` is designed to make." The role list also starts with "implement (`implement-run.ts:617`)", and Approach 1 says the message "covers all seven roles at once".

Code on main (ran `grep -n WRITER packages/fleet/src/shared/implement-run.ts`): no match. The env block at `implement-run.ts:652-659` (read) holds `PLOT_UNATTENDED: '1'`, `[BRIEF_ONLY_ENV]: '1'`, `PLOT_PLAN_SLUG` and `PLOT_BRIEF_BRANCH`, and no writer marker. `git show a98afb890 -- packages/fleet/src/shared/implement-run.ts` (ran) shows `-        [MAIN_CHECKOUT_WRITER_ENV]: '1',` and the removed import. Its message: "A --brief-only implement run now books its hand-off brief and the plan's Started: record through plot-brief-book.sh ... never opening the operator's main checkout."

The #2726 panel predicted this (`rootcause.md:41`, read): "With option 1, the marker `PLOT_MAIN_CHECKOUT_WRITER` is no longer needed for implement and brief runs. A stale spawner can then not produce the failure".

So on main six spawn sites set the marker, not seven: `deliver.ts:649`, `reslice.ts:473`, `story.ts:514`, `auto-deliver.ts:272`, `brief-ask.ts:163`, `plot-dispatch.sh:827` (ran grep; those line numbers match the plan). The plan's own incident is no longer reproducible through the role it names. The domain docstring still lists implement (`main-checkout-write.ts:14-16`, read: "the implement, deliver, reslice and story runs, which commit a brief, a `Started:` record or a plan there"), and so does `gate.ts:509-510` (read). #2740 left both stale. The plan cites them as fact and does not notice.

Amend: rebase on main, drop implement from the role list and the count, cite #2740, and restate the motivation with a role that still depends on the marker (deliver, reslice, story, auto-deliver, brief-ask, dispatch brief). Fix the two stale docstrings in the gate slice.

## C2. The gate message blames a stale spawner in the state every desk worker is in by design (HIGH)

Plan, Approach 1: "the refusal text states that `PLOT_UNATTENDED=1` is set without `PLOT_MAIN_CHECKOUT_WRITER`, and that a spawner started before the marker existed produces exactly this state. The text names the board and fleetd restart as the check."

Code: `main-checkout-write.ts:16` (read): "A desk worker's launch sets it empty." `plot-dispatch.sh:1558` sets `PLOT_MAIN_CHECKOUT_WRITER=` for the desk launch (ran grep), and `continuation.ts:1110-1116` (read) clears it: "a continued desk resumes a desk session ... so it must not inherit that run's writer marker". After #2740 the implement run also runs unattended without the marker (C1).

So "unattended without the marker" is the normal state of every desk worker, every continued desk and every implement run. The gate exists to refuse exactly those callers in the main checkout (`gate.ts:503-505`, read). The proposed text would tell a correctly spawned desk worker to restart the board and fleetd. The gate reads only its own environment and cannot tell a stale spawner from a correct one. The plan's own rejection of option 3 says the same about the spawner: "A stale spawner cannot know which markers the current gate expects". The gate has the mirror problem: it cannot know which role the spawner meant.

Amend: word the refusal as conditional on intent ("if this run is a deliver, reslice, story, auto-deliver or brief run, its spawner predates the marker"), or give the gate a reading it can check, for example a role variable the spawner sets on every launch, so a missing marker on a named writer role is a fact and not a guess.

## C3. The refusal text is shared with the mixed-reset arm, which ignores the marker (MEDIUM)

Plan, Changelog: "The main-checkout gate names a missing `PLOT_MAIN_CHECKOUT_WRITER` marker". Approach 1: "it changes one message ... and needs no new state".

Code, `gate.ts:530-534` (read): "A marked writer is exempt from the gate but not from the mixed-reset refusal." `const dirs = gatesMainCheckout(process.env) ? gitWriteDirs(command) : treeStrandingResetDirs(command);` and both arms `return mainCheckoutWriteRefusal(scriptDir);`. A deliver run that carries the marker and runs a mixed `git reset` gets the same text. If that text says the marker is missing, it is false for that caller.

Amend: the slice needs two refusal texts, or a parameter that says which arm refused. That is new state in the call, so "one message" and "no new state" do not hold.

## C4. The plan names the wrong file for the message (MEDIUM)

Plan, Approach 1: "it changes one message in `packages/board/src/server/entry/gate.ts`". Slice: "with a domain test per refusal wording". Open Question 3: "Does the gate message belong in the domain rule (`main-checkout-write.ts`) or in the entry (`gate.ts`)?"

Code: the text lives in the domain, `main-checkout-write.ts:391-407` (read), `export const mainCheckoutWriteRefusal = (scriptDir: string): string =>`. `gate.ts:20` imports it and `gate.ts:534` returns it. The Approach and the slice disagree with each other, and the Open Question asks something the code already answers.

Amend: name `main-checkout-write.ts:391` as the change site, and close Open Question 3.

## C5. The spawner slice compares the wrong pair of files (HIGH)

Issue #2728, Expected (ran `gh issue view`): "A spawner whose bundle predates the gate it spawns under is detected and named".

Plan, Changelog: "The board and fleetd report themselves stale when the bundle on disk differs from the bundle they started from." Approach 2: "compare it with the bundle on disk on each status read".

These are different comparisons. The issue compares the spawner with the gate. The plan compares the spawner with its own file. The rubric's own evidence and #2726 `rootcause.md:24` (read) say the gate runs from the installed plugin: `~/.claude/plugins/cache/plot-marketplace/plot/2.28.1/.../plot-gate.mjs`, through the plugin hook `"${CLAUDE_PLUGIN_ROOT}/skills/plot/scripts/plot-gates.sh"` (ran `cat hooks.json`). In Plot's own checkout the board runs the checkout's bundle (`2026-09-29-the-board-runs-the-artifact-its-repo-built.md`, read: "A checkout that builds the board artifact runs the one it built"). So the gate's source and the spawner's source are two files from two code sources.

Consequences, each a contradiction with the plan's promise "The operator sees the gap before an agent runs into it":

- **Adopting repository.** A plugin update installs a new versioned directory and keeps the old one. `ls ~/.claude/plugins/cache/plot-marketplace/plot/` (ran) shows `2.27.0 2.27.1 2.28.0 2.28.1` side by side. A board started from `2.28.0/.../board-server.mjs` sees that file unchanged after an update to 2.28.1, so the comparison never reports stale, while the agents load the 2.28.1 gate. This is the exact skew of the issue, in every adopting repo, and the slice cannot see it.
- **Plot's checkout.** Plugin updated, checkout not fast-forwarded: same miss. Checkout fast-forwarded: `main` rebuilds its bundles after every merge (CLAUDE.md, *Testing*: "`main` builds its own bundles after every merge"; the recent log shows `48dec508e plot: build the board artifact`). The flag then turns on after nearly every pull, whether or not the gate changed. That is Open Question 4's noise, and it is the default case, not an edge.

Amend: define the reading as spawner bundle against gate bundle (both paths, both identities), or state plainly that slice 2 detects "the board is older than its own checkout" and does not detect the issue's skew. Then the Changelog must say that instead.

## C6. Open Question 4 offers an option the plan's own argument rules out (LOW)

Plan, Design: "A stale spawner cannot know which markers the current gate expects". Open Question 4: "Flagging every rebuild is noisier than flagging a marker gap, and cheaper to implement."

If the spawner cannot know which markers the gate expects, it cannot flag "a marker gap". Only the "every bundle change" answer is implementable on the plan's own terms.

Amend: close Open Question 4, or name the reading that would let a spawner detect a marker gap.

## C7. "Nothing persists it" against a status read in another process (MEDIUM)

Plan, Approach 2: "The board and fleetd record the identity of their bundle at start ... A mismatch adds `stale: true` and the two identities to `--status` output". And: "the comparison is derived fresh on each read and nothing persists it".

Code: `plot-fleetctl.sh --status` is a bash script that reads launchd and pids (`plot-fleetctl.sh:7-13`, `:808-811`, read; ran grep for `curl|http`: no match). It does not ask fleetd. The "identity at start" lives in fleetd's memory. For `--status` to show it, fleetd must write it somewhere (a persisted reading) or the script must derive it, for example from the process start time against the file's mtime. The hash option in Open Question 1 needs the first. So "nothing persists it" holds only for the mtime answer, and the plan leaves that open.

Amend: say where `--status` reads the start identity from. If it is a file, name it and its writer.

## C8. Board-impact comment against the slice (LOW)

Plan, Board impact: "no plan format, template or helper script changes." Slice 2 reports staleness in `plot-board --status` and `plot-fleet --status`.

Code: those are `plot-boardctl.sh` (574 lines) and `plot-fleetctl.sh` (1374 lines), both helper scripts (ran `wc -l`, read headers). A change there is a helper-script change, and CLAUDE.md, *A Shell Script Asks The Domain*, says `scripts/check-shell-lines.sh` "ratchets the shipped shell's line count against its merge base". The plan does not plan for that cost or for a JS entry point.

## C9. "Neither reloads its bundle" against the declared Board command (LOW)

Plan, Motivation: "Neither reloads its bundle." Notes: "after a fast-forward of `main` the board and fleetd need a restart, and nothing today says so."

Code: CLAUDE.md config declares `Board command: pnpm board`, and `package.json:14` (read) runs `node --watch skills/plot/scripts/board/board-server.mjs`. `plot-boardctl.sh:53` (read): "`--watch` respawns on a file change". `plot-boardctl.sh --start` runs plain `node "$artifact"` (`:423-425`, read). So the claim holds for a board that `/plot-board --start` started, which is the incident's case (#2726 `rootcause.md:22`: "Neither runs under `node --watch`"). It is false for the declared Board command. Separately, worker loops already detect a newer bundle by content hash (`loop-restart.ts:24-29`, read: `pinnedHash`, `loadedHash`, `runningHashNow`). That answers Open Question 1's "hash or mtime" with an existing precedent, and "nothing today says so" is false for loops.

Amend: scope the claim to boards started by `plot-boardctl.sh`, and cite `loop-restart.ts` as the existing identity reading to reuse.

## C10. Which process spawned the implement runs (LOW)

Plan, Motivation: "An implement run spawned by the stale fleetd gets `PLOT_UNATTENDED=1` without the marker".

Issue #2728 (ran): "An implement run spawned by the stale board". #2726 `estate.md:28` (read): "The board that spawned these runs is pid 23604". fleetd is cited only for the brief ask: "fleetd (pid 8692, started 2026-10-17) is equally stale for `brief-ask.ts:163`'s marker."

Amend: say "board" for implement and "fleetd" for brief-ask, as the evidence does.

## C11. Continuation: the plan is right, the issue and #2726 panel are wrong (note, no amend)

Issue #2728, Gap: "implement, deliver, reslice, story, auto-deliver, brief-ask and continuation". #2726 `panel.md` (read): "(deliver, reslice, story, auto-deliver, brief-ask, continuation)".

Plan: "The continuation launch clears the marker on purpose (`continuation.ts:1116`) and is not affected." Code `continuation.ts:1116` (read): `[MAIN_CHECKOUT_WRITER_ENV]: '',`. The plan corrects the issue here. It should say so explicitly, and also name the dispatch desk launch (`plot-dispatch.sh:1558`, ran grep), which clears the marker the same way.

## C12. Type and source location (LOW)

Plan: "**Type:** feature", slices on `feature/`. The issue describes a defect ("Nothing detects the gap"), and the #2726 panel (`panel.md`, read) flagged the same `feature` versus `bug` mismatch on its subject. Plan, Notes: panel files are "on `idea/implement-leaves-its-brief-and-plan`"; they are on `origin/main` now (read under `p2729-main/.plot/panels/2026-10-26-implement-leaves-its-brief-and-plan/`).

## Rubric answers, from this lens

1. **Problem.** The incident account agrees with the #2726 panel (board pid 23604, fleetd pid 8692, `da7097509`, bundles `275a8704e` and `286e0483a`; read in `rootcause.md:22-23`). The role list contradicts main after #2740 (C1) and corrects the issue on continuation (C11). Other spawner-versus-gate contracts that can skew the same way: `BRIEF_ONLY_ENV` read by the `brief-push` gate (`implement-run.ts:656`, read: "Read by the `brief-push` gate"), the controller gate's receipts, and any future marker. The plan addresses only one variable name.
2. **Approach against the code.** The message site is the domain, not `gate.ts` (C4). The message would misattribute the normal desk state (C2) and the marked mixed-reset case (C3). The version comparison is not well defined across the two code sources (C5).
3. **Safety.** Both slices only report, so neither kills or refuses work. Misleading text is the risk: C2 can send an agent or operator to restart a healthy board and fleetd, and a fleetd stop orchestrates its agents' stop (CLAUDE.md table, `plot-fleet`).
4. **Slices against Changelog and acceptance.** Slice 2's Changelog promise ("report themselves stale" before an agent hits the gap) does not follow from its comparison (C5). Neither slice states an acceptance a test can fail on today.
5. **New defects.** Shell line ratchet on the two control scripts (C8); persisted start identity contradicts "nothing persists it" (C7); stale docstrings left by #2740 (C1).

## Required amendments

1. Rebase on main and drop implement from the marker roles; cite #2740 (C1).
2. Make the gate text conditional, or give the gate a role reading so a missing marker is checkable (C2), and split the text from the mixed-reset arm (C3). Name `main-checkout-write.ts:391` as the site (C4).
3. Define slice 2's comparison as spawner against gate, across the plugin and checkout sources, or narrow the Changelog to what it detects (C5). Say where `--status` reads the start identity (C7) and account for the shell ratchet (C8).
4. Close Open Questions 1, 3 and 4 against the code (C4, C6, C9).
5. Correct "stale fleetd" to "stale board" for implement (C10), and the Type (C12).
