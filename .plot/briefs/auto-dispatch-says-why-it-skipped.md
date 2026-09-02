## Implementation brief — auto-dispatch-says-why-it-skipped (wave Reporting)

- **Plan (canonical):** `docs/plans/2026-09-01-a-refused-dispatch-asks-for-a-brief.md` on `main`
- **Approved:** 2026-09-01, Jan Wloka, in-session
- **Branch:** `feature/auto-dispatch-says-why-it-skipped` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** in-session, per the plan's `Review:` field

The plan's third and last wave, and the smallest. `Naming` landed as #603 — `briefPath()` computes a brief's path for every reader and writer. `Asking` landed as #647 — `plot-dispatch.sh` reads a `Brief command` (`brief_command()` at `:377`), invokes it when the gate fires (`request_brief()` at `:415`), refuses by name with `no-brief-command` at `:419`, and counts what it did in `brief_asked=` on the summary line. Consume both; add no third brief writer and no second path computation.

### What to build

`auto-dispatch.ts` records the PLAN-level decision it currently makes in silence. At `auto-dispatch.ts:455` a plan whose every startable branch was filtered out reaches `if (startable === 0) continue;` and leaves no trace: the plan is dropped from the candidate list and nothing says which plan, or why.

### The gap is narrower than the plan's Motivation reads, and the code says so

**A branch-level log already exists.** `auto-dispatch.ts:812` prints `auto-dispatch: skipping branch(es) with no brief on origin/main (run /plot-implement first): …` once per pulse, and `:784` does the same for claimed branches. The plan's own Motivation states the residue precisely: *"the row says this branch needs a brief; nothing says auto-dispatch skipped this plan for that reason."*

**The row already carries the branch fact too.** `BriefStateSchema` at `packages/domain/src/rules/verdict.ts:25` is `present | missing | unknown`, and `needs-brief` is a row verdict at `:14`. Both render. Do not add a fourth spelling of *this branch has no brief*.

**So the deliverable is one sentence about a PLAN**, not a branch, and the plan says as much: *"the smallest of the three, and it was over-scoped in the plan's first draft."* Build the smallest thing that names the plan and the reason.

### The decisions the plan settles — do not re-derive them

**The skip REASON, not the brief state.** The plan's Branches entry for this wave is explicit: *"`BriefStateSchema` and `needs-brief` already carry per-branch brief presence to the row, and both render; what nothing records is that `auto-dispatch.ts` dropped a plan from its candidates for that reason."*

**Auto-dispatch does not spawn the brief agent inline.** Rejected for budget: *"`auto-dispatch.ts` spends a bounded number of spawns per pass; a brief agent is a `claude -p` session of unknown length. It is queued and reported, and the operator or the next pass acts on it."* This wave reports; it does not call.

**Absent capability is a named refusal, never an error.** `commission.ts` models it as `no-idea-command` and `plot-dispatch.sh:419` follows with `no-brief-command`. A reason this wave records follows the same shape: a name a reader can act on, not a stack trace.

**Staleness never gates.** Out of scope here, and stated for completeness because a reporting slice invites it: a timestamp gate would have refused 3 of 3 live briefs on the day it shipped, every one a false positive.

### The defect this slice inherits

**The `Brief command` cannot reach the skill it names. Measured 2026-09-02, first real use.** Dispatching `bug/a-thinking-agent-has-a-quiet-stretch` prepared the worktree, refused to start the worker, and asked the `Brief command` to write the brief. The log it named holds 33 bytes:

```
Unknown command: /plot-implement
```

Reproduced directly: `PLOT_UNATTENDED=1 claude -p --permission-mode bypassPermissions '/plot-implement --help'` answers `Unknown command`, while the same invocation with a plain prompt answers normally. `skills/plot-implement/` exists, so a missing directory is not the cause — a headless `claude -p` in this repo does not load repo-local skills as slash commands.

**The consequence is a reporting defect, which is why it reaches this wave.** `plot-dispatch.sh:2539` increments `n_brief_asked` on `request_brief`'s exit status, and `request_brief` returns 0 once the command is *started*. It is detached and never waited on by design, so a command that fails in its first millisecond still counts. `brief_asked=1` is therefore reported for a call that wrote nothing, and the operator is told a brief was requested and finds none — worse than the refusal it replaced.

**What the plan settles and what it does not.** The plan's Notes record the measurement and stop there: *"Two fixes, and the choice is a person's: hand the agent the brief-writing INSTRUCTIONS rather than a slash command, or make the skill addressable headless and keep the prompt. The first is self-contained; the second is a harness question beyond this plan."* **Neither fix is this wave's to make.** Do not change `brief_prompt()`, and do not change what `request_brief` asks for.

**What this wave may do is report honestly about it.** `brief_asked=N` counting *started* rather than *succeeded* is a reporting claim, and this is the reporting wave. The smallest honest change is to say what the number means where it is printed, so a reader checks the log rather than trusting the count. Anything larger — waiting on the command, parsing its log, retrying it — contradicts the detachment `request_brief` documents at `:399` and the budget posture the plan settles. If the work grows past a sentence and a test, stop and say so in the PR rather than widening the slice.

### Done when

- **Auto-dispatch records why it skipped a plan**, where today it silently reduces `startable` — the plan's own `Done when`, and the whole of this wave.
- The record names the PLAN and the reason. It does not restate per-branch brief state, which `BriefStateSchema` and `needs-brief` already carry to the row.
- A plan skipped for a reason other than briefs is distinguishable from one skipped for briefs, or the reason is not a reason.
- Nothing in this wave calls the `Brief command`, waits on it, or parses its log.
- `pnpm run test:reconcile`, `pnpm run test:board`, `pnpm run typecheck`, `pnpm build:board`, changeset.

### You are exposed to a rule that may end you

The idle rule ends a worker whose subtree burns no CPU across two consecutive passes about 30 s apart. It has ended eleven desks across two days, and it does not distinguish an agent thinking from an agent stopped.

**Commits survive a kill; uncommitted work does not.** Commit early and often, and label an unfinished commit as unfinished in its message. That is a workaround and not a fix — `an-idle-agent-is-not-a-stalled-one` is the fix and its first wave is in flight.

`bug/a-thinking-agent-has-a-quiet-stretch` measured this estate on 2026-09-02: 7547 quiet stretches across 23 sessions, of which **37 exceeded the 30 s window, in 9 of 23 sessions**. **28 of those 37 were the agent waiting on its OWN command**, not on the model — `pnpm run test:board` alone goes silent for up to 600 s. Running this repo's gates is itself long enough to be read as a stall, so commit before you run them.

### Repo gates

Node 24 — `nvm use` first. Then `pnpm test`, `pnpm run test:reconcile`, `pnpm run test:board`, `pnpm run typecheck`, and `pnpm build:board` because the board artifact is generated and CI gates on it being current.

**`pnpm run typecheck` is board-only** — it is `pnpm --filter @plot-pm/board typecheck` and never reaches `packages/domain`. A change touching the domain package also needs `cd packages/domain && npx tsc --noEmit`, and that package carries `pnpm run test:corpus` on its own vitest config which `pnpm run test:board` does not run. Measured 2026-09-02: a change passed every root gate and failed CI on the corpus tier.

**Do not run `pnpm run test:e2e`.** It is CI's gate, it dispatches real workers, and two agents running it here produced 53 concurrent `node --test` processes.

### The changeset

Description FIRST, `bumps:` block LAST. Changesets publishes the first line after the frontmatter, so a `bumps:` block written first becomes the release note and the description behind it never ships.
