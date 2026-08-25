---
'@plot-pm/board': patch
---

A spawned agent survives the watcher, and a plan row says how often it was interrogated

Two defects found walking the v2.9.0 endgame checklist.

**The prompt was inside the watched tree.** `pnpm board` runs under `node
--watch`, which watches the whole repo and does not read `.gitignore`. All four
spawning routes — idea, commission, deliver, reslice — wrote their prompt to
`.plot/<name>.md` while keeping their log and state OUTSIDE the checkout. So the
prompt restarted the very server that had just spawned the agent. Measured
2026-08-25: clicking *Create plan* on issue #333 wrote `.plot/idea-issue-333.md`
and the board log recorded `Restarting 'board-server.mjs'` in the same second.
The prompt now joins the log and state beside the checkout, which is where the
log's placement said it belonged all along.

**A plan row never said how many rounds it had been interrogated.** 40 of 120
cards carry `rounds`, the Board tab renders every one, and the Agents tab
rendered none — the field is a fact about the PLAN, and the plan head is where a
plan fact belongs. `PlanRow` already held the card through `cardForPlanFile`;
nothing asked it. `roundsBadgeText` is reused rather than restated, so the rule
that `0 rounds` must never render lives in one place.

The four route tests moved to a nested temp dir, the shape
`implement-route.test.ts` had already established for exactly this: with the
repo AT the tmpdir root, files written to `path.resolve(repoRoot, '..')` land in
the shared temp directory and survive the cleanup. The `.log` had been leaking
that way already; nothing noticed because no test asserts a log was NOT written.
