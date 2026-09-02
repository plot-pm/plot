## Implementation brief — an-ended-worker-names-its-reading (wave Saying what happened)

- **Plan (canonical):** `docs/plans/2026-09-01-an-idle-agent-is-not-a-stalled-one.md` on `main`
- **Approved:** 2026-09-02, Jan Wloka, in-session
- **Branch:** `bug/an-ended-worker-names-its-reading` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** in-session, per the plan's `Review:` field

The plan's last wave, and it delivers the plan. `Measuring what a working agent looks like` merged as #649 and produced the numbers; `Reading the agent instead of the machine` has merged too, and `sample_verdict` at `plot-worker-monitor.sh:465` now asks the transcript first and consults the CPU only for what it can prove. This wave reports what those two decided. **It changes what an operator is told, not what ends a worker** — a diff that alters a threshold, a verdict or a kill belongs to wave 2 and is already spent.

### What to build

Three endings that mean three different things say three different things, in the log line and in what the board renders from it.

### The three readings, and which two are conflated today

**Read the code before the plan's prose here, because the plan's claim has aged.** Its `## Branches` says *"today two of them print the same sentence"*, and that was true when it was written. #543 (`A working agent is not a hung one`) has since split the log line, so `plot-worker-loop.sh:585` already carries a `case "$_ended_by"` with two arms:

| reading | trap | `_ended_by` | what the operator sees |
|---|---|---|---|
| the bound expired | `_on_alarm`, `plot-worker-loop.sh:419` | `bound` | *"prompt exceeded the Ns bound … no monitor finding said why"* (`:590`) |
| the agent went quiet | `_on_monitor`, `:431` | `monitor` | *"the WorkerMonitor reported idle … burned no CPU and changed nothing across two passes"* (`:587`) |
| **nobody could tell** | — | — | **nothing. It arrives as the bound arm above.** |

**So the conflated pair is not the one the plan names.** `bound` and `monitor` are already distinct. The pair that collapses is *the bound genuinely expired* and *the transcript could not be read*, and wave 2 is what created it: `sample_verdict` at `plot-worker-monitor.sh:495` turns `unavailable` into `unknown`, `unknown` publishes no finding, no `USR1` is ever sent, and the worker runs to its 8-hour floor and ends through `_on_alarm`. The operator then reads *"no monitor finding said why"* — which is literally true and hides that the monitor could not have said anything, ever, on this desk.

**That is the plan's own fallback working as designed and reporting as though it were not.** The Design settles the behaviour — *"Where no transcript can be read, there is no reading that distinguishes thinking from stuck, and the plan should say so rather than invent one"* — and `plot-worker-monitor.sh:487` records the same intent in the code. The behaviour is right. The saying-so is this wave.

**The monitor's own comment names the second message it now owes.** `plot-worker-loop.sh:587` reads *"the agent is alive and has committed but burned no CPU and changed nothing across two passes"*. Wave 2 stopped deciding that way: the verdict is now transcript silence past `PLOT_MONITOR_QUIET_SECONDS` with the CPU consulted only to prove a child is on a core (`plot-worker-monitor.sh:503-515`). The sentence describes the rejected rule. Correcting it is naming the reading, which is this wave's subject.

### The decisions the plan settles — do not re-derive them

**Three readings, three meanings, and the operator triages them differently.** `plot-worker-loop.sh:577` states it: a monitor verdict says *"the worktree holds finished-looking work worth rescuing"*, while the floor *"says only that time passed … so nobody knows what state the desk is in."* The third case — no transcript — is a desk nobody could measure at all, and it deserves its own sentence rather than borrowing the floor's.

**`unavailable` is not `failed`.** `the-registry-supervises-its-agents` settled it and `plot-worker-monitor.sh:366` carries the word through: *"`unavailable` where no transcript can be read, and that word travels all the"*. Report it; do not turn it into an error.

**The fallback stays the bound.** Do not add a kill for the unavailable case. The plan's Design prices it — *"a genuinely stuck agent then holds a desk for up to 8 hours, which is smaller than the measured cost of the rule this replaces"* — and the two watchers already race deliberately (`plot-worker-loop.sh:414`, *"TWO SIGNALS, NOT ONE SHARED FLAG"*).

**Which side of the Worker/Agent split this belongs on.** `CLAUDE.md` divides the eight states: `running`, `finished`, `failed`, `ended`, `none` and `elsewhere` are **Worker** facts read from the process, while `waiting` and `stalled` are **Agent** facts read from the desk. *Why* a worker ended is a fact about the process's death, so it refines `ended` on the Worker side — it does not add a ninth state to `AgentStateSchema` at `packages/domain/src/entities/agent.ts:10`. `plot-worker-state.sh:50` records that `ended` is deliberately not refined by the tree, and `:26` names the six. **Prefer carrying the reason as a field beside the state over widening the enum**, and if the board renders it, the derivation is a domain property rather than a computation in a `.tsx` — `CLAUDE.md`'s "Every rendered state is a domain property".

**Where the reason has to survive.** The wrapper writes `.plot-worker.exit` with the agent's numeric exit code (`plot-dispatch.sh:797`) and the loop returns 124 for both endings (`plot-worker-loop.sh:564`). An exit code cannot carry three meanings; whatever records the reading has to be something the loop writes and the state reader can find after the process is gone.

### Done when

- **Each of the three endings prints a sentence naming its own reading**, and the unavailable case no longer borrows the bound's *"no monitor finding said why"*.
- **The monitor-verdict sentence describes wave 2's reading rather than the rejected one.** `plot-worker-loop.sh:587` still says *"burned no CPU and changed nothing across two passes"*, which is no longer how the verdict is reached.
- **A genuinely stopped agent is still ended, and the reading that ended it is named in the log** — the plan's own `Done when`.
- **Where the transcript cannot be read, the log says so** and the bound is still what ends the worker. Assert it against a desk with no readable transcript, since that is the configuration Plot cannot control.
- **`PLOT_MONITOR_ENDS_WORKER` is gone, or documented as the escape it became** — the plan's `Done when`, and this is the wave that owns saying what happened. A seam kept past its replacement is a second implementation.
- **Nothing about the verdict changes.** No new threshold, no new kill, no edit to `sample_verdict`. Wave 2 owns those.
- `pnpm run test:reconcile`, `pnpm run test:board`, `pnpm run typecheck`, `pnpm build:board`, changeset.

### You are exposed to the bug you are fixing

The rule wave 2 replaced has ended twelve dispatched desks across two days, and **both earlier waves of this plan were killed by it while writing their own fix**. Wave 2 is on main now, so your dispatch may be quieter than theirs were — do not rely on that.

**Commits survive a kill; uncommitted work does not.** Wave 1's worker was ended mid-session and lost nothing, because it had committed three times. Wave 2's worker made two commits it never pushed, and they were recovered by hand from its worktree — the fix existed for hours while CI tested a commit titled *"(unfinished)"*.

So commit early, commit often, label an unfinished commit as unfinished, and **push what you commit**. A commit nobody can see is a commit somebody has to find.

**Commit before you run the gates.** `pnpm run test:board` is a 600 s silence on this estate and `pnpm run test:reconcile` is 585 s — long enough that running the repo's own gates reads as a stall to a sampler.

### Repo gates

Node 24 — `nvm use` first. Then, as your diff touches them:

- `pnpm test` — every skill parses
- `pnpm run test:reconcile` — the plan-format contract and the shell suites, including `workermonitor.test.mjs`
- `pnpm run test:board` — rebuilds the board artifact and runs its tests
- `pnpm run typecheck` — **board only.** It is `pnpm --filter @plot-pm/board typecheck` and never reaches `packages/domain`. A change touching that package also needs `cd packages/domain && npx tsc --noEmit`, and that package carries `pnpm run test:corpus` on its own vitest config, which `test:board` does not run.
- `pnpm build:board` — the artifact is generated and CI gates on it being current.

**If you change a shell script that is vendored into the board package, re-vendor it.** Wave 2 needed a separate commit for exactly that (`board: re-vendor plot-transcript-quiet.sh after the stat fix`), and a source fix without the re-vendor passes some checks and fails others.

Do **not** run `pnpm run test:e2e`. It is CI's gate, it dispatches real workers into sandbox repositories, and two agents running it here produced 53 concurrent `node --test` processes.

**Shell portability is a real gate here.** Wave 2 shipped a bug where `stat -f` on Linux means *filesystem info* and **succeeds**, so the usual `stat -c … || stat -f …` fallback never fired and fed `Namelen: 255 Type: ext2/ext3` into an arithmetic expression. It passed on macOS and failed on CI. Validate what a command returns rather than trusting its exit code.

### The changeset

Description **first**, `bumps:` block **last**. Changesets publishes the first line after the frontmatter, so a `bumps:` block written first becomes the release note and the description behind it never ships.

### Scope guard

This branch owns the messages and whatever carries the reading to them. It owns no verdict.

**Do not touch** `sample_verdict`, `monitor_transcript_quiet`, `PLOT_MONITOR_QUIET_SECONDS`, `monitor_activity`, or the threshold. Wave 2 settled those and its PR argued the numbers.

Do not commit `packages/board/test/fixtures/tiny-garden/.plot/state/last-pulse.json` — every board suite rewrites it.

The board artifact `skills/plot/scripts/board/board-server.mjs` is generated and marked `-merge`. Never read its diff on a conflict: take either side, run `pnpm build:board`, and commit the rebuild.

**If the code contradicts this brief, the code wins and the contradiction is worth reporting.** This brief already corrects the plan on which two readings are conflated; the same may be true again by the time you read it.
