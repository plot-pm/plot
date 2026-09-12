## Implementation brief — a-failed-gate-becomes-a-correction (wave 2: A failed build becomes a correction)

- **Plan (canonical):** `docs/plans/2026-09-12-a-failed-gate-becomes-a-correction.md` on `main`
- **Approved:** 2026-09-12, jwloka, in-session
- **Branch:** `feature/a-failed-gate-becomes-a-correction` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** per repo convention — PR review on GitHub

Wave 1 (`feature/an-absent-agent-is-noticed`) merged as **#900** and is on `main`. It is why this wave is eligible: it made `plot-worker-state.sh` able to tell a live agent from a dead one, which is the reading a correction loop needs before it resumes anything. Wave 3 (`feature/a-marker-names-its-writer`) is independent — it adds fields to the marker whether corrections exist or not — so do not implement it here, and do not block on it.

### What to build

**CI's verdict is measured, published, and dropped.** `plot-build-monitor.sh:370` detects a failing run and publishes `build failed` with the run URL, the head sha and the conclusion, into `$PLOT_WORKTREE/.plot-worker.monitor.build.jsonl`. Consumers of that finding on the estate: **none**. `buildMonitorPid` is read by the board's registry; the finding itself is read by nothing.

The only correction path today is a person. `plot-worker-loop.sh:1683` writes a `PLOT-BLOCKED` marker ending *"fix the invocation in the prompt file, then restart this agent."* That is right for a prompt that never ran — the case it was written for — and it is the only shape Plot has.

Build: the BuildMonitor's `build failed` finding becomes a **correction the loop consumes on its next pass**, resuming the agent's session with the failure text verbatim, bounded by an attempt budget. When the budget is spent, the marker is written and the desk waits for a person — today's behaviour, reached later rather than first.

The plan is canonical; this is orientation.

### The decisions the plan settles — do not re-derive them

**The failure text goes in verbatim.** A summarised failure is a second interpretation of something CI already stated precisely. The run URL and the conclusion are what a person would read. Paraphrasing here is the same error as a lookup table for context windows: usually right, and unexplainable when wrong. The monitor's `evidence` field already reads *"the run at <url> for <sha> concluded <conclusion>"* — pass that string through, do not rebuild it.

**The agent never controls the retry.** The budget is the loop's, read from config. An agent cannot extend it by declaring itself unfinished. That property is what separates a correction loop from an agent that never stops.

**The correction is a file in the desk, not a message, and that is structural.** A build's verdict arrives minutes after the push, so the correction cannot be a return value. The monitor publishes when it learns; the loop consumes when it next looks. The agent may be mid-slice, already hopped to another branch, or dead — a file survives all three, and the loop already reads the desk on every pass to decide whether it is resettable.

**A correction about a superseded sha is discarded, not delivered.** The monitor already distinguishes `head moved` (`plot-build-monitor.sh:335`) — *"A green result for code nobody will merge is worse than no result"* — and the same holds inverted: a failure about a sha the agent has already replaced is answered by work that is already done. Compare the finding's sha against the branch head at consumption time; a mismatch discards.

**The correction budget is TWO, it is a Plot Config key, and its comment must say it is a guess.** Nothing has measured it; the first real number comes from watching the fleet. Recording the guess as a guess is what stops it hardening into a decision nobody made.

**Do NOT reuse `START_ATTEMPT_BUDGET` for this.** `plot-worker-loop.sh:361` is a different budget with a different default (three) and a deliberately different configurability: its own comment states it is an env test seam and *"Not a Plot Config key — a project has no separate opinion about how many times a broken invocation should be retried before a person is asked."* A project **does** have an opinion about how many times a failing build is handed back. Two budgets, two defaults, two mechanisms; collapsing them contradicts the comment that is already in the file.

**`attempts` is the field a bounded automatic retry spends, and the loop already writes it.** `manifest_attempts` (`:371`) and `raise_manifest_attempts` (`:396`) exist and are used by the start-budget path. `relaunches` stays a person's record, so three manual `--restart`s never spend an automatic budget. Decide explicitly whether a correction shares `attempts` with the start budget or gets its own manifest field — they are different questions about the same agent and one counter answering both is one a reader must re-derive the split from.

**The marker is a `PLOT-BLOCKED*` FILE and never a token inside a log line.** `plot-worker-state.sh:309` settles it, and `plot-reap.sh` and `plot-fleet-scan.sh` both read it that way — a worker that only printed its question would be reaped as if it had none. `write_blocked_marker` (`:423`) already exists, already refuses to overwrite an existing marker, and is the function to call.

**The marker must say how many attempts were made and what failed each time**, or the person inherits a stopped agent with no account of what was tried.

**Resuming is `session_flag`'s decision, not the prompt file's.** `plot-worker-loop.sh:592` probes for a transcript and prints `--resume` or `--session-id`; `session_handle` (`:565`) supplies the handle from the manifest's `resumeId`. A correction resumes an existing conversation, so it takes `--resume` by the probe's own answer — do not hardcode the flag. `.plot/worker-prompt.sh` belongs to the adopting project (`plot-worker-loop.sh:19`), so a rule written there would not hold; the loop exports the flag and the prompt interpolates it.

**Match the monitor BY NAME, anchored on the `"monitor":"BuildMonitor"` field.** `monitor_says_idle` (`:1174`) is the precedent and its comment states why: the AgentMonitor and the WorkerMonitor write beside it under the same `.plot-worker.monitor.` prefix with different vocabularies, and taking one monitor's finding as a verdict about another's subject is exactly the Machine/Registry confusion CLAUDE.md's split exists to prevent.

**Read the LAST matching line, never any line.** The monitor publishes only on a CHANGE, and a cleared finding is a publish too — so a worktree whose build failed and then passed carries `build failed` followed by `build passed`, both forever, in one file. Grepping the file for the word would correct an agent whose build has since gone green.

**Grep, not a JSON parser.** The line is written by `printf` in `publish` (`plot-build-monitor.sh:167`) with a fixed field order, so the fields sit at known positions in a known shape. A `node -e` per poll forks an interpreter inside a worker whose whole point is to leave the machine alone for the agent — `monitor_says_idle`'s comment makes this argument and it applies unchanged.

**Rules carried over unchanged:** absent is not false — an unreadable manifest reads zero attempts, which is the permissive direction on purpose, because a manifest that cannot be read is not evidence a spin is under way. An unanswerable probe reads as *create*, never as *resume*. A finding file that does not exist is not a passing build.

### Done when

The plan's `## Done when` list is the specification — the plan carries none as a separate section, so its `## Slices` entry for this wave plus the Design section above it is the spec: the correction file, the loop's consumption of it, the attempt budget, and the superseded-sha discard.

Then lift these, which exist because a naive implementation would pass without them:

- **A `build failed` line followed by a `build passed` line produces no correction.** Catches grepping the file instead of reading the last matching line — the single most likely defect, and it corrects an agent whose build is already green.
- **A finding whose sha is not the branch head produces no correction.** Catches skipping the superseded-sha discard, which otherwise sends the agent to fix work it has already redone.
- **A line from the WorkerMonitor or AgentMonitor produces no correction.** Catches an unanchored grep for `"finding":"build failed"` that would match any monitor's vocabulary.
- **The budget ends in a marker, not in an infinite retry**, and the marker names the attempt count and what failed each time. Catches a correction loop with no floor.
- **An existing `PLOT-BLOCKED` marker is not overwritten.** `write_blocked_marker` already guarantees this; a test pins that the correction path goes through it rather than writing the file directly.
- **The budget is read from config with a default of two**, and a project that sets it to another number gets that number.

Plus the repo's gates:

```bash
nvm use                      # Node 24 — pnpm crashes on 26
pnpm install                 # if node_modules is missing
pnpm test                    # all skills parse
pnpm run test:contracts      # the helper estate + CI gates
```

`pnpm run test:board` only if you touch `packages/board`. **Do not run `pnpm run test:e2e`** — it is CI's gate, not a local one; it dispatches real workers into sandbox repos and two agents running it once produced 53 concurrent `node --test` processes.

A **changeset** is required: `.changeset/*.md` with the description FIRST and the `bumps:` block LAST, package `plot`, and a `plan:` line naming this plan. The order is not cosmetic — Changesets publishes the first line after the frontmatter, so a `bumps:` block written first becomes the release note.

Existing test files to extend rather than duplicate: `test/e2e/worker-loop-manifest.test.mjs` and `test/e2e/build-monitor-follows.test.mjs`. Note both are e2e; if the new assertions are unit-shaped, prefer a contract test under `test/contracts/`. The monitor exposes two named ports for exactly this — a test sources the file with `PLOT_MONITOR_NO_MAIN=1` and redefines them.

### Bookkeeping

Open the PR through the controller, never `gh pr create`:

```bash
skills/plot/scripts/plot-open-pr.sh          # or --draft while the work moves
```

It takes the title from the plan's wave heading. Measured 2026-09-08: three slice PRs opened with `gh pr create` each took their title from the last commit subject, which on this estate is routinely `plot: build the board artifact`.

When the PR exists, append `→ #<number>` to this branch's line in the plan's `## Branches` section on `main`. This plan annotates inside the wave heading — `(Branch: feature/a-failed-gate-becomes-a-correction, PR: #N)` — matching its two siblings; a trailing `→ #N` on the heading line parses as `prs=[]`.

Push the first real commit as soon as it exists.

### Scope guard

This branch owns:

- `skills/plot/scripts/plot-worker-loop.sh` — the consumption path, the budget, the marker call
- `skills/plot/scripts/plot-build-monitor.sh` — only if the finding needs a field it does not already publish; prefer consuming what is there
- the new or extended tests
- `CLAUDE.md` — the `## Plot Config` key for the correction budget, and the helper-script table row if behaviour changes
- `.changeset/`

**Do not touch** `PLOT-BLOCKED`'s field set — that is wave 3 (`feature/a-marker-names-its-writer`), which adds the branch and agent to every marker. If you find yourself wanting the writer's identity in the marker, that is the sibling's work; note it and move on.

Other branches in flight, verified at dispatch: `feature/a-delivery-verdict-names-what-it-ran` (delivery verdict — no overlap with the loop or the monitor) and `changeset-release/main` (the bot's release PR). `.changeset/` holds siblings' changesets — add your own, touch none.

If you find something the plan did not anticipate, report it rather than improvising outside scope. Two of the plan's Open Questions are deliberately unanswered and are **not** yours to settle: whether a correction counts against `Worker bound`, and whether a repo-gate failure (`pnpm test`) uses the same path as a CI failure. The second is explicitly out of scope.
