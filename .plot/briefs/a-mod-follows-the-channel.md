## Implementation brief — the-fleet-reports-what-changed-on-the-host (wave 7: A mod follows the channel)

- **Plan (canonical):** `docs/plans/2026-10-09-the-fleet-reports-what-changed-on-the-host.md` on `main`
- **Approved:** 2026-10-10, Jan Wloka, plan-PR #1451 merged
- **Branch:** `feature/a-mod-follows-the-channel` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** per repo convention (PR review)

Nothing waits on this branch and it waits on nothing. Its inputs have merged: the channel's publishers (#1464, #1466) and the board's page subscription (#1469). Wave 8 (`a-merge-is-a-controller`) is independent of it.

### What to build

**The failure it fixes.** On 2026-10-09 the master agent learned that `main` was red, that a PR had merged and that a desk owed an answer by polling `gh` and reading files. The channel now carries those facts (`checks failing`, `pr merged`, `default branch red`, `owes an answer`). The operator's own Claude Code session still hears none of them. The mod is that subscriber: a plugin that draws the current findings in a pane, shows a toast on three of them, and wakes the session with a turn only on names the operator lists.

It is a **separate plugin that only the operator installs** (owner decision, 2026-10-09, plan *Open Questions*). Fleet agents load the Plot plugin for its gates and never load the mod, so the mod needs no `PLOT_UNATTENDED` guard and the Plot plugin gains no Claude-Code-only dependency. Do not add the mod to the `plot` plugin's `hooks/`.

The behaviour, from plan step 7:

1. The mod gets the channel's current findings (the `welcome`) and every later `finding` and `clear`. It makes no host call.
2. It draws a pane from the current findings (`$.ui.open` plus a `ui.render` hook on `{ component: 'Pane', requestId }`).
3. It shows a toast (`$.ui.toast`) on `checks failing`, `pr merged` and `owes an answer`.
4. It starts a turn (`$.prompt.submit`) only on a finding name the operator lists, at most once per 5 minutes and at most 24 times per day. Findings that arrive inside the 5 minutes join the next turn's text.

### The decisions the plan settles — do not re-derive them

**Open question closed: the mod cannot call `subscribe`.** The plan's *Open Questions* ask the brief to verify the mod API facts before any code. Verified 2026-10-10 against the mods reference and `claude-code.d.ts` of Claude Code 2.1.291:

- A mod runs "in an environment of its own, with no DOM and no Node". `channel-client.ts` imports `node:net`, so the file cannot load in the mod. Plan step 7 says the mod subscribes "through `channel-client`'s `subscribe`"; that sentence is wrong as written, and the brief supersedes it. Amend the plan's step 7 and Open Question in the same PR.
- `$.http.fetch(url, { socketPath })` reaches a unix socket but speaks HTTP. The channel speaks NDJSON (`SubscribeRequest` line in, `ChannelMessage` lines out), so `fetch` cannot be the transport.
- `$.process.spawn({ argv })` streams a child's output piece by piece, "a child for the session's life: the loop runs on after the hook returns, and ends with the child or with the module" (the type's own example). That is the transport. A spawned child may run `node`, so it may use `subscribe`.

**So the slice adds one small bundle: a follower.** It calls `subscribe` with purpose `{ kind: 'everything' }`, prints each `ChannelMessage` as one JSON line on stdout and exits when `onEnd` fires. The mod spawns it from `session.start` and parses the lines. Rejected alternative: `nc -U .plot/fleet.sock` with the request piped in. BSD and GNU `nc` differ on `-U` and on when a closed stdin ends the connection, and it writes the wire framing a second time, which is the exact reason `channel-client.ts` exists (its header: "every subscriber writing its own framing is how two implementations of one wire format come to disagree"). Build the follower beside `plot-ask.mjs` as its own bundle; `plot-ask.mjs` is its own bundle for the stated reason that a caller asking one thing should not load another controller.

**The channel path.** The socket is `<repoRoot>/.plot/fleet.sock` (`CHANNEL_SOCKET`, `registryd-main.ts:1635`; the board uses the same at `packages/board/src/server/index.ts:106`). The mod must not hard-code a path: the follower takes the repo root as an argument and the mod passes the session's `cwd`. When no channel is listening the follower exits with a reason; the mod shows a status line `fleet channel: not running` and retries on a timer (`$.clock.every`, 30 s) rather than failing the session. A subscriber that cannot connect must not block a prompt: `session.start` is awaited before the first prompt, so start the follower in a detached `void (async () => …)()` as the type's own example does.

**The turn bound is a domain rule, not mod code.** Decisions are domain properties (CLAUDE.md, *Every rendered state is a domain property*). The 5-minute and 24-a-day bounds, the operator's name list, and "findings in the window join the next turn" are one pure function in `packages/domain/src/rules/` — for example `turnGate(state, finding, now, listed)` returning `{ start, text, state }`. It follows the domain's style: an arrow function, a TSDoc block that states behaviour and not history, zod-only imports. The mod holds the state in `$.state`/`$.store` and calls the function; the mod file decides nothing. If the mod's environment cannot import from `@plot-pm/domain`, bundle the rule into the mod's file at build time and test the rule where it lives. **The day counter must survive a reload and a new session** (`$.store`, not module variables): the plugin-authoring reference says a reload restarts the module's own variables, and a counter in one resets to 0 on every edit.

**Rejected: the mod starts a turn on every finding.** Cost row 7 of the plan: "agent turns, at most one per 5 minutes and 24 per day, only on the listed names". An unlisted name never starts a turn, whatever its severity. The default list is empty. A mod that starts turns by default is a mod that spends the operator's budget on a first install.

**Rejected: a `PLOT_UNATTENDED` guard.** A fleet agent never loads the mod (separate plugin). A guard would hide the fact that the safety is the install boundary.

**Rules carried over unchanged:**

- **Absent is not false.** A mod that cannot connect shows `not running`, never `all green`. A pane built from no `welcome` says it has heard nothing.
- **The channel holds current state, not history.** A new subscriber's `welcome` lists each current finding. The pane renders that set; it does not reconstruct a past. A `clear` removes the slot (`findingKey`: monitor plus branch).
- **A `served` message ends a subscription.** With purpose `everything` it should not arrive; if it does, treat it as an end and reconnect.
- **Read the exit code, not the emptiness.** The follower's silence is not "no findings". The mod tells a quiet channel from a dead follower by the process result (`{ code, signal }`), not by the absence of lines.

### Done when

The plan's slice line is the specification: *`claude plugin test` passes for the mod against a fixture channel, and a test shows no turn start for a second finding inside 5 minutes and none past 24 in a day.* The assertions that exist because a naive mod passes without them:

- **A second listed finding at minute 4 starts no turn, and the same finding at minute 6 starts one whose text includes the minute-4 finding.** Catches a throttle that drops findings, not just delays them.
- **The 25th listed finding in a day starts no turn, with the 5-minute gap respected each time, and the day boundary resets the count.** Catches a counter held in a module variable that a reload zeroes: run the test across a simulated reload.
- **A finding whose name is not on the list shows a toast (if one of the three) and starts no turn.** Catches a default-on list.
- **With no channel running the module loads, shows `not running` and starts nothing.** Catches a mod that throws in `session.start` and blocks the first prompt.
- **A `clear` removes the finding from the pane.** Catches a pane that only grows.
- **The follower's own test:** one `welcome` and one `finding` published on a real `startChannel` socket arrive as two JSON lines, and the process exits when the channel closes.
- **The mod makes no host call.** A test or `claude plugin validate` output shows no `gh`, `bb` or `plot-host.sh` argv in the module's `$.process` calls; the only spawn is the follower.

Plus: run `claude plugin validate` and `claude plugin test` on the mod folder; add the changeset (package `plot`, description first and the `bumps:` block last, `plan:` line inside the block). The mod's own `plugin.json` version starts at `0.1.0`. List the mod in `.claude-plugin/marketplace.json` as a second plugin so `/plot-…` users can install it with `/plugin install <mod> --marketplace <owner>/<repo>`; keep the three Plot version files consistent (`./scripts/check-changeset-packages.sh`). The follower is a bundle: it is built by `pnpm build:board` and **a PR carries no generated bundle** (`scripts/check-no-bundle-diff.sh`), so test locally and restore the generated paths before pushing.

For tests, run the local checks command before each push and run what it prints: `node skills/plot/scripts/board/plot-local-checks.mjs`. The suites in the `CI suites` config key run in CI, and a failure there comes back as a correction. Run no full suite. In particular do not run `test:e2e` and do not run board tests while the operator's board is open.

`scripts/check-shell-lines.sh` refuses a pull request whose shell under `skills/` is longer than at its merge base. This slice should touch no `.sh` file; if it does, pay for the growth in the same change by removing shell elsewhere or by writing the rule in the domain and asking it through a bundle. The gate stores no number and has no override.

Also: a function you write is an arrow. Run `./scripts/check-agents-md.sh` if you touch `CLAUDE.md`; this slice should not.

### Bookkeeping

- Open the PR with `skills/plot/scripts/plot-open-pr.sh` (add `--draft` while the work moves). Do not run `gh pr create`.
- When the PR exists, append `→ #<number>` to this branch's line under `### A mod follows the channel` in the plan's `## Slices` section.
- Push the first real commit as soon as it exists.
- Amend the plan in this PR: step 7's "through `channel-client`'s `subscribe`" becomes the follower bundle, and the Open Question for slice 7 becomes checked with the three verified facts above. Plan edits that change no `State:` line pass `plot-state-gate.sh`.

### Scope guard

This branch owns: the mod folder (a new plugin directory; propose `mods/plot-follow/` and state the choice in the PR), the follower's entry file under `packages/board/src/server/entry/` and its test, the turn-gate rule under `packages/domain/src/rules/` with its test, the second `marketplace.json` entry, the changeset, and the plan edits named above.

It does not touch: `channel-client.ts`, `channel-socket.ts` or `rules/channel.ts` (the channel's wire format is settled by #584, #1464 and #1466; if the follower needs a change there, report it), `packages/fleet/**`, `packages/board/src/app/**`, or any file of the `plot` plugin's own `hooks/`.

In flight on origin as of 2026-10-10: only `feature/a-merged-pending-check-is-asked-again` carries a remote ref, and it holds the PR refresh, which this branch does not touch. `feature/a-merge-is-a-controller` has no ref and waits on `feature/the-controllers-are-commands`. No collision is known.

If you find something the plan did not anticipate, report it rather than improvising outside scope.
