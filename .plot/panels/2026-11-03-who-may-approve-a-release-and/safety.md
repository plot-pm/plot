# Safety juror — who-may-approve-a-release-and

Position: amend

Lens: whether the caller mechanism can be forged by a desk agent, a master agent or an unattended process under the same OS user and `gh` login; what booking plans outside the sprint can release wrongly; and what a reviewer role file read from the default branch protects against. Line references are against `origin/main` at `f017f976e`.

## Summary

The plan names three real defects and correctly refuses to choose a mechanism before Design. Its open questions are the right ones. It does not yet state a threat model, so the Design phase can pick a mechanism that looks like identity and is not. Under one OS user and one `gh` login, every reading the plan's questions list (an env var, a flag, a file, an HTTP header, a token held by the served page) is forgeable by any process that can run a command. The plan must say which adversary each slice stops, and it must keep the reviewer's code-held sandbox when the reviewer moves onto role files. The plan also misses the reviewer's current definition source.

## Findings

### F1 — The current caller reading is forged by one word (HIGH, confirms the plan)

- `plot-ask.mjs release-approve` takes its caller from `process.env.PLOT_UNATTENDED === '1' ? 'unattended' : 'person'` (`packages/board/src/server/entry/main.ts:156`, through `mergePortsFor` at `:139`, used at `:221`). `env -u PLOT_UNATTENDED node …/plot-ask.mjs release-approve <pr> <sha>` or `PLOT_UNATTENDED=0 …` reads as `person`. The same holds for the board's restart route (`packages/board/src/server/restart.ts:70`) and deliver (`entry/deliver.ts:791`).
- The controller gate does not close this for a desk: `controllerGateOf` returns `null` (allow) for any call inside a linked worktree (`packages/board/src/server/entry/gate.ts:974`, `if (linked) return null;`), and `release-approve` is not a `GatedAction` (`packages/domain/src/rules/ci-suite.ts:68` lists `dispatch | approve | deliver | release | restart`). `plot-ask.mjs` also writes its own action receipt before it decides (`main.ts:220`), so a receipt proves nothing about the caller.
- From the master agent's session nothing is needed at all: that session has no `PLOT_UNATTENDED`, so it is `person` by construction. This is the #2927 defect, and the plan states it correctly (`release-approve.ts:73`, `decision.ts:23`).

### F2 — No same-user reading tells a person from an agent; the plan must say so before Design picks one (HIGH)

Open Question 2 offers "a per-board token only the served page holds". Under one OS user that token is not held only by the page:

- Any process can `GET /` from the loopback board and read the token out of the HTML, or read it from wherever the board stores it, the same way the browser gets it. A cookie, `HttpOnly` or not, is also returned to `curl`.
- The write routes already check `Origin` (`isSameOrigin`, e.g. `packages/board/src/server/approve.ts:272`, `continue.ts:139`). `curl -H 'Origin: http://localhost:<port>'` passes it. A token adds CSRF protection against a foreign web page, which `Origin` already gives; it adds nothing against a local agent.
- `controllers/caller.ts:24-27` already records this repository's position: "a hand-rolled token in a URL would look like security while being a shared secret in shell history." The plan should cite it, not reopen it silently.

The readings that a same-user agent cannot produce with a plain command are few, and each has a cost a person must accept:

1. **A PreToolUse hook that refuses `release-approve` from any model tool call.** The hook's own environment is the Claude Code session's (here: `CLAUDECODE`, `CLAUDE_CODE_SESSION_ID` are set in every tool shell; the shell has no TTY). An inline `env -u` in the command does not change what the hook reads. This stops the rationalising master agent and the desk agent that follow the documented route. It does not stop a determined agent: the hook matches command text, so a script written to a file and run, or a `curl` to the board, evades it. It is a gate against habit, not against intent. The person then runs the command from their own terminal (or the `!` prefix, if a person verifies that it bypasses PreToolUse).
2. **User-verifying WebAuthn (Touch ID) on the board's release and restart buttons.** `localhost` is a secure context, so the board can require an assertion with `userVerification: 'required'` against a key registered once. No process under the same user produces a fingerprint. This is the only listed option that tells a person from any local process. Its cost is a registration step and a browser-only path.
3. **A host-side approval by a second account.** Not available: the agents and the person share one `gh` login (`jwloka`), so a host approval by that account proves nothing.

The plan must make the threat model a decision, not an implied property: either "refuse an agent that follows the routes" (option 1, cheap, documented as evadable) or "refuse any local process" (option 2). A slice built on a token or a header and documented as telling "a person from a master agent" ships a false claim.

### F3 — Board routes inherit the board's process identity, in both directions (MEDIUM, confirms the plan's LOW and widens it)

The restart route reads the board process's `PLOT_UNATTENDED`, not the request's (`restart.ts:68-70`). The plan names one direction (an unattended-started board refuses a person). The other direction is the safety one: a board a person started answers every loopback POST as `person`, so a desk agent's `curl -X POST /api/restart` or `/api/release` passes as a person today. Any per-request reading the slice adds must be refused when absent, never defaulted to `person`; otherwise the fix for #2918 widens the hole the #2927 fix tries to close. The plan's Open Question 1 names this risk; the slice line (`feature/release-approve-names-its-caller`) must carry it as an acceptance criterion: "a POST with no person proof refuses with a named reason, whatever the board's own environment".

### F4 — The reviewer slice would remove the reviewer's code-held sandbox (HIGH, not in the plan)

- Today the reviewer's command is built in code by `reviewerCommand` (`packages/domain/src/rules/review-verdict.ts:157-188`): `--tools Read,Grep,Glob` (`:124`), `--disallowedTools Write,Edit,NotebookEdit,Bash,Agent,Task,WebFetch,WebSearch` (`:127-129`), `--setting-sources user`, `--permission-mode dontAsk`, `--strict-mcp-config`.
- The role path the slice would reuse is `roleCommand` (`packages/domain/src/rules/role-command.ts:62-82`). It passes `--agents` JSON built from the role file's frontmatter, whose accepted keys include `tools`, `disallowedTools` and `permissionMode` (`role-command.ts`, `JSON_KEYS`), plus a `--settings` file. It sets no `--permission-mode dontAsk`, no `--strict-mcp-config` and no code-held tool list.
- Moving the reviewer onto it makes `.claude/agents/reviewer.md` the only definition of what the reviewer may do. A merged edit to that file (adding `Bash`, or `permissionMode: bypassPermissions`) gives the one agent whose verdict is the required `plot/review` check (`Review required since` in Plot Config) the tools to write its own status. `role-gate.ts` exempts the reviewer from the non-reviewer deny list (`packages/domain/src/rules/role-gate.ts:2`, `:69`, `:277`), so nothing else stops it.

### F5 — The plan misses the reviewer's current definition source (MEDIUM, a claim to correct)

"No code loads `.claude/agents/reviewer.md`" is true, but the reviewer does load a definition: the charter `.plot/charters/reviewer.json` (`CHARTER_DIRECTORY = '.plot/charters'`, `packages/domain/src/entities/charter.ts:14`), read from the main checkout's working tree (`packages/board/src/server/entry/review.ts:586-589`) and checked at `:333-336`. Its model and effort feed `reviewerCommand`. The plan must decide whether the charter or the role file is authoritative after the move, and remove the other. Two definitions of one role is the defect the plan's Motivation already names for fixer and main-repair.

### F6 — What "read from `origin/<default>`" protects against, and what it does not (MEDIUM)

It protects against: a PR head rewriting the reviewer that reviews it; a dirty or off-branch main checkout (today `review.ts:586` reads the working tree, and the fixer reads `fixer.md` the same way, `packages/fleet/src/shared/auto-fixer.ts:454-455`).

It does not protect against:

- **A merged weakening.** A slice PR that edits `reviewer.md` is reviewed by the current reviewer, under the same rules as any other PR, and merges on green. After that, every later review runs under the weakened file. `role-gate.ts:28` protects `.claude/` from the fixer, unblocker and main-repair roles only, not from a slice desk, and `.plot/charters/` is not in `PROTECTED_PATH_PREFIXES` at all.
- **A local ref.** `origin/<default>` is a local remote-tracking ref. `repair-role.ts:111-113` reads it through `Refs.showFile` with no fetch before the read. Any same-user process can move it (`git update-ref refs/remotes/origin/main <sha>`) to a commit holding any role text. The loader should fetch the default branch immediately before reading, and refuse with a named reason when the fetch fails, as `release-finish.ts` already does (`default-branch-unfetched`).

### F7 — Booking plans outside the sprint can release wrongly or block every release (MEDIUM)

- `releaseFinish` refuses the whole finish when any scope plan is not Delivered or Released (`packages/domain/src/workflows/release-finish.ts:126-134`, `plan-unbookable`). If the new slice adds `plan:`-named plans to `scope`, any changeset that names a Draft or Approved plan, or a mistyped path, refuses every release. A desk writes changesets, so one desk line blocks the release. Plans found through `plan:` lines must be named and skipped when not Delivered, never added to the refusing scope.
- The `plan:` line is free text written by the desk (`packages/domain/src/rules/changeset.ts:77`). It can name a plan the change did not implement. The booking must read only the changesets the release consumed (the `.changeset/*.md` files the release commit deletes), not `.changeset/` on main at finish time; a plan delivered after the release PR last regenerated has no changeset in the tag.
- A wrong booking is not reversible by an agent: the state gate refuses a hand edit of `State:`, and `plot-reject` moves Delivered to Approved only. So a wrong Released record needs a person and a receipt path. This supports the plan's safety proposal (book only `plan:`-named plans, name the rest) and adds the two conditions above.

### F8 — Sprint fit

The sprint goal ends at the release PR (`docs/sprints/2026-W45-follow-ups-2-30-1.md:3`). Refusing an agent at `release-approve` adds no intervention inside that goal. The reviewer slice is inside it: if the reviewer fails to start, `review-not-passed` stops every slice merge. The plan already requires the end-to-end test that a review still writes `plot/review` (Open Question 8); keep it.

## Amendments required

1. Add a `### Threat model` subsection that states the adversary for each slice: an agent that follows the documented routes, or any process under the same OS user. State that the agents and the person share one `gh` login, so no host reading separates them.
2. Remove "a per-board token only the served page holds" as a person proof from Open Question 2, or record it as CSRF hardening only, citing `controllers/caller.ts:24-27`. Add user-verifying WebAuthn and a session-environment PreToolUse refusal as the two candidates, with what each one stops (F2).
3. On `feature/release-approve-names-its-caller`, add acceptance criteria: an absent or invalid person proof refuses with a named reason on `plot-ask.mjs release-approve`, `POST /api/release` and `POST /api/restart`, whatever the process's own `PLOT_UNATTENDED` reads; `env -u PLOT_UNATTENDED` and `PLOT_UNATTENDED=0` in the command do not change the outcome (a test for each).
4. On `feature/the-reviewer-loads-its-role-file`, add: the reviewer keeps `--permission-mode dontAsk`, `--strict-mcp-config`, `REVIEWER_TOOLS` and `REVIEWER_DENY` from code as a floor; the loader refuses (named reason) a reviewer role file whose `tools` exceed `REVIEWER_TOOLS` or that sets `permissionMode`; one test proves a role file adding `Bash` does not reach the command.
5. Correct the Motivation: the reviewer reads `.plot/charters/reviewer.json` from the main checkout (`review.ts:586-589`). Decide which definition survives.
6. The shared role-file loader fetches the default branch before `Refs.showFile` and refuses on a failed fetch.
7. On `feature/release-finish-names-unbooked-plans`: read `plan:` lines only from changesets the release commit consumed; name and skip a named plan that is not Delivered; never add it to the scope that `plan-unbookable` refuses.

## Decisions for a person

- D1: the threat model per slice (amendment 1). An agent cannot choose how much forgery to accept.
- D2: whether the release button needs user verification (WebAuthn), with its registration cost, or a habit gate is enough.
- D3: whether a change to `.claude/agents/*.md`, `.claude/settings/*` or `.plot/charters/*` needs a person's review before merge. Reading from the default branch moves the trust to whatever merges there; today the reviewer reviews changes to its own definition.

## Ran versus read

Ran (read-only): `git fetch origin main`; `git show`/`git grep`/`git ls-tree` on `origin/main` for the files cited; `gh issue view 3077`; `gh pr view 3078 --json files,headRefName`; `env` and a TTY test in this agent's own shell to see which variables a Claude Code tool shell carries.

Only read, not executed: every forgery path above (`env -u`, `curl` with a forged `Origin`, `git update-ref` on `origin/main`) is reasoned from the source, not tried. I did not verify that the Claude Code `!` prefix bypasses PreToolUse hooks, nor that `roleCommand`'s `--agents` JSON honours `permissionMode` at runtime.
