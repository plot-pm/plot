# Estate lens — a supervisor that stopped ticking is not running

Position: amend

## What I searched

The reading position was *does this already exist, in whole or in part?* I read the whole `--status` arm, grepped the estate for every tick-age / heartbeat / last-seen reading, read the board's supervisor payload end to end, checked `packages/domain` for a liveness rule, swept `docs/plans/` for prior art, and verified the two quotes the plan cites.

## The central claim: VERIFIED, exactly as written

`skills/plot/scripts/plot-fleetctl.sh`:

- `:356` is the `running` arm, and the plan quotes it verbatim — `elif [ "$sup_loaded" = 0 ] && [ -n "$sup_pid" ]; then / install_state=running / echo "supervisor: running (pid $sup_pid) — $LABEL"`. Three lines, no tick reading.
- `:374-382` is the `LOADED, NOT RUNNING` arm. The comment the plan quotes is there word for word ("THE TICK AGE IS EVIDENCE AND NEVER THE VERDICT... up to 60 s — so a reader gets the number and this derives nothing from it"), followed by the `tick_log` / `stat -f %m || stat -c %Y` / `last tick: Ns ago (evidence, not the verdict — a busy tick writes at most every 60s)` block.

The two arms are adjacent branches of one `if`. A supervisor with a live pid provably cannot reach `:374`. The plan's "one branch over" is literal and correct.

## Does anything else on the estate report tick age? NO — and this is the strongest finding

`git grep registryd.log` over `skills/ scripts/ packages/board/src packages/domain/src` returns **five hits, and exactly one is a reading**:

- `plot-fleetctl.sh:378` — the arm above. The only reader on the estate.
- `plot-fleetctl.sh:429`, `:641`, `units/README.md:57` — prose naming the path for a human to open.
- `units/com.plot-pm.registryd.plist:72` — `StandardOutPath`, the writer.

So the plan does not duplicate an existing reading, and its "reuse the reading one branch over" is the right shape rather than a second implementation.

**The board does not surface it either.** `SupervisorSchema` (`packages/board/src/contract/schema.ts:3513-3546`) carries exactly five fields — `state`, `prominence`, `shown`, `label`, `detail`. No tick age, no timestamp. `packages/board/src/server/supervisor-reading.ts` reads only the exit code plus two tokens off the `summary:` line (`SUMMARY_PREFIX`, `INSTALL_PREFIX`); it parses nothing else from stdout. The fix does not belong on the board instead — the board has no reading to render.

## The domain rule: a near-miss the plan should name

`packages/domain/src/rules/channel.ts:188` holds `monitorLiveness(lastSeen, now, toleranceMs)` → `'alive' | 'gone' | 'never-seen'`, with `missedBeatsTolerance = intervalMs * 3` at `:208`. Its docstring states exactly this plan's problem — *"SILENCE-BECAUSE-HEALTHY VERSUS SILENCE-BECAUSE-GONE is the distinction the whole design rests on"*.

**It does not apply, and I checked rather than assumed.** Its only importer is `adapters/channel/channel-socket.ts`, whose subject is monitor findings over a socket with its own heartbeat frame (`entities/channel-message.ts:49`). It is scoped to `MonitorName`, not the supervisor, and it *derives a verdict* — which is the one thing this plan correctly refuses to do. No shell-asks-domain obligation is triggered: the plan derives nothing, so there is no rule for it to ask.

Worth one line in the plan so a later reader does not re-find it and think it was missed.

## Prior art: this is a fourth pass at one defect, and the plan under-states that

Three delivered plans already widened this same `--status` arm:

- `docs/plans/2026-09-07-the-board-says-whether-anything-supervises.md` — Released 2.14.0. Same failure class: *"Six workers ran 23–25 hours past an 8-hour bound with the supervisor down."*
- `docs/plans/2026-09-09-the-supervisor-is-loaded-or-it-is-reported.md` — Released 2.16.0. Added `interrupted` / `installed`.
- `docs/plans/2026-09-22-a-loaded-label-is-not-a-running-daemon.md` — Released 2.20.0. Added `loaded-not-running` and the tick-age block this plan reuses.

Each fixed *one* way `running` could be wrong. This is the fourth. The plan cites the third only through a line number and never says it is the fourth attempt on one arm in eighteen days. That is the estate fact most worth stating — not as a reason to reject, but because the honest framing is "the `running` word has been narrowed three times and this narrows it again", and a reader deciding whether a structural fix is owed needs that count.

Note the prior plan's own amendment: `a-loaded-label-is-not-a-running-daemon` was **amended after panel** because its evidence described a leaked test unit rather than production. This plan's evidence has the same shape — a single reading, since overwritten (the plan says so at `:52`). See the amendment below.

## supervisor.ts:49 — quote resolves, file path is wrong

The plan cites `supervisor.ts:49`. The text is exact — *"A memo that outlived the tick would make the daemon hold state, which is the one property this design does not have. This is where a world drops it, so `kill -9` still costs one tick and nothing else."*

It is at `packages/board/src/server/supervisor.ts:49-51`, inside `SupervisorWorld.beginTick`'s docstring. The plan's use of it is sound: the memo is a per-tick cache, a heartbeat file is that memo promoted to disk, and the argument against one carries. Give it the full path — eight worktrees hold a `supervisor.ts` and a bare basename resolves to whichever one a reader is standing in.

## The premise gap I did want to raise, and why it does not sink the plan

The plan's reading is the log's **mtime**. I traced whether a tick always writes. `reportTick` (`packages/board/src/server/entry/registryd-main.ts:947`) writes `tickLine` unconditionally on the success path — so a quiet tick with nothing to do still moves mtime, and the 60 s caveat holds.

But an **incomplete or throwing** tick does not touch the log: `:954` sends `tickLine` to `warn`, and the loop's catch at `:853` writes `plot-registryd tick failed:` to `warn`. `warn` is stderr, which the plist routes to `registryd.err` (`:73`), a different file. Its own comment says so: *"`registryd.err` being empty on both measured deaths is why this cannot go to the tick log."*

So a daemon alive and failing every tick keeps a frozen `registryd.log` mtime and will read as stale. That is *not* a defect in this plan — a supervisor failing every tick is handing over nothing, which is precisely what the operator needs to see. It is the reading being right for a reason the plan does not state. Worth one sentence, because the alternative is a later reader "fixing" the line to also stat `registryd.err` and destroying the signal.

## Duplication, scope, slicing

Nothing else on the estate does this. One slice, one branch, ~8 lines of shell plus tests. `test/reconcile/fleetctl.test.mjs` already drives both arms through the `stubPlatform` PATH seam — `:778` asserts the running arm's `pid 4242` line, `:804` the loaded-not-running arm including its readings. The plan's three test cases (stale log, fresh log, no log) drop straight into that harness, and `:854` already locks the `summary:` shape the plan promises not to change. The "Done when" bullet protecting `supervisor=up` is the right regression to name.

## What to amend

Three additions, all one or two lines, none changing the fix:

1. **State that this is the fourth narrowing of the `running` word**, naming the three released plans (2.14.0, 2.16.0, 2.20.0). A reader should be able to see the pattern without re-deriving it.
2. **Fix the citation to `packages/board/src/server/supervisor.ts:49`** and name `rules/channel.ts:188`'s `monitorLiveness` as the existing liveness rule that deliberately does not apply — it is scoped to channel monitors and it derives a verdict, which this plan refuses.
3. **Say that a failing tick writes to `registryd.err`, not the tick log**, so a frozen mtime under a live daemon is the intended reading rather than a hole to patch later.

Everything else I checked from this lens is clean: the mechanism exists one branch over exactly as claimed, nothing on the estate duplicates it, no domain rule is being bypassed, and the board cannot render a reading nobody takes.
