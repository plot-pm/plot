# Premise lens — a connector declares its ceiling

Read end to end on main at `a868ec7e8`: `rules/cadence.ts` (all 258 lines), `rules/budget-record.ts`, `entities/budget.ts`, `rules/concurrency.ts`, `board/src/server/fleet.ts` around every call site, and the `plot-host.sh` arms the plan cites. Named below is what I read, not what a name implied.

## 1. Every factual claim, verified

**TRUE, verified by reading:**

| claim | verification |
|---|---|
| `prRefreshMsFor(backend, rate, currentMs)` at `fleet.ts:1724` | exact — `export function prRefreshMsFor(` is on line 1724, signature matches |
| called at both refresh sites with a real backend | `fleet.ts:2006` (via `prNextDueAt`) and `fleet.ts:2410` (in `scheduleNextPr`); both take `backend` from `resolveBackend` |
| cost varies per connector through `PR_REQUESTS_PER_REFRESH` | `fleet.ts:184` — `github: 1`, `bitbucket: 4` |
| `refreshIntervalMs` at `cadence.ts:244` | exact |
| takes exactly four things, rate is `Pick<SpendRate, 'perHour'>` | `cadence.ts:247` — `rate: Pick<SpendRate, 'perHour'> \| null`. **One field. Verbatim correct.** |
| `MAX_CADENCE_STRETCH = 8` | `cadence.ts:32` |
| `CADENCE_DAMPING = 0.25` | `cadence.ts:57` |
| spend-rate reads a local file and asks no host | `fleet.ts:1737-1745` docstring + `plot-host.sh:3833` — `budget_rate` over the record; no host call |
| `BudgetKeySchema` keyed connector/account/bucket | `entities/budget.ts:24-28`, exact three fields |
| Jenkins `limit: 60` hardcoded at `plot-host.sh:3760` | exact — `'{"connector":"jenkins",…"limit":60,…"basis":"predicted"}'` |
| Jira appends `- - -` with basis `unknown` at `plot-host.sh:1648` | exact — `budget_append jira … 1 - - - unknown` |
| no ceiling config key exists today | grepped `Rate ceiling`/`rateCeiling` across `skills/ packages/ docs/` — zero hits outside this plan |
| the cadence rule is built and green | `vitest run test/cadence.test.ts` — **29 passed** |

**FALSE — three claims:**

**(a) The quoted live measurement does not reproduce, and it is the plan's headline number.** The plan prints, as "measured live on this estate, 2026-09-15":

```json
{"connector":"github","perHour":157.09,"limit":null,"remaining":null,"basis":"unknown"}
```

Run just now, same estate, same day:

```json
{"connector":"github","account":"jwloka","bucket":"","spent":1154,"spanMs":3599838,
 "perHour":1154.05,"lines":72833,"unreadable":0,
 "limit":5000,"remaining":3229,"resetAt":1789468250000,"basis":"actual"}
```

`limit: 5000`, `remaining: 3229`, `basis: actual` — **not null, not unknown.** The plan's own sentence, *"157 calls an hour against a limit the record cannot state"*, is false on the connector it is stated about. The record states it. The plan also omits the `account` field, which is present and which its own Done-when demands.

**(b) "no connector but GitHub reports a limit" — the subtitle — is false.** `plot-host.sh:1984`:

```sh
bitbucket) printf '%s\t%s\t%s\t%s\n' 1000 - - predicted ;;
```

**Bitbucket already carries `limit: 1000, basis: predicted`**, shipped in #655, long before this plan. The plan's three-connector table says Bitbucket has "no limit headers / rate only". That is right about *headers* and wrong about *the record*, and the record is what the board reads. The plan's own framing distinguishes the two everywhere else; here it collapses them and the conclusion inverts.

**(c) Jenkins is not on the path this plan changes.** The table lists three connectors as if they shared one cadence. `refreshIntervalMs` is reached only by `prRefreshMsFor`, whose `backend` comes from `plot-host.sh backend` — `github` or `bitbucket`. Jenkins is a **CI connector on a separate port**: `build-shell.ts:171` asks `ci-limit`, and `grep refreshIntervalMs|cadenceStretch|prRefreshMsFor` over `adapters/build/` and `ports/build.ts` returns **nothing**. `PR_REQUESTS_PER_REFRESH` has no jenkins entry. So Jenkins' `limit: 60` — the plan's tightest connector, and the sibling plan's stated reason this matters — cannot reach the rule this plan feeds. One of three rows is on a different port.

**Could not verify:** the operator's report that `bb` polls too hard. No artefact on the estate records it. It is the plan's motivating fact and it rests on the Notes section alone.

## 2. Is the problem real, and is this the right shape?

**Half of the premise holds; the half the plan is named for does not.**

*"Built, wired and working"* — **TRUE, and I confirmed both halves.** The rule exists, is called at both sites with a real rate, and its 29 tests pass. Nothing here repeats the sibling's error of a function that does not do what its name says.

*"Blind in exactly one direction"* — **FALSE as stated.** Two findings, and the second is the one that decides this.

**First: the limit already reaches the board.** `spendRateFor` (`fleet.ts:1754-1798`) parses `limit`, `basis` and `account` out of the same read. `fleet.ts:2461-2463` stores all three on the cache entry. The plan never mentions this. Reading its Design, a builder would conclude the board has no ceiling to pass; it has had one since the read was written, on the very line above the rate it does pass.

**Second, and decisive: a declared ceiling already has a consumer, and it is not the cadence.** `limitReadingOf` (`fleet.ts:1619`) shapes `prLimit`/`prResetAt`/`prLimitBasis` into a `LimitReading`; `prConcurrencyBound` (`fleet.ts:1642`) feeds it to `boundFromLimit` (`concurrency.ts:139`), which converts an hourly ceiling into a simultaneous-call bound and is enforced by `withHostSlot` around every host call (`fleet.ts:2476`).

So **the estate already answers *"how close am I to the wall?"*** — the exact question the plan says is never asked. It answers it as a **concurrency cap**, not a cadence stretch. `boundFromLimit`'s own docstring states the unit conversion explicitly: *"A limit is requests per hour; a concurrency bound is requests at one moment. The two are not the same quantity, so a bound cannot be READ off a limit."*

That is the gap correctly located. It is **narrower and differently shaped** than the plan describes: not *"no connector declares a ceiling"* (Bitbucket and Jenkins both do, in the shell) and not *"nothing consumes a ceiling"* (concurrency does), but **the cadence and the concurrency bound read the same reading and only one of them is wired to it.** Both already flow through `entry.prLimit`. The work is plausibly smaller than the plan implies — pass `limitReadingOf(entry)` where `rate` is passed — and the config key may be unnecessary for two of the three connectors, since the shell already supplies their numbers.

**The reasoning that survives intact:** "a probe spends the budget it is protecting" is sound and matches `fleet.ts:1647-1660`'s measurement that `rate_limit` reported 5000 against headers reading 0. "The ceiling is an account property" is sound and `BudgetKey.account` models it. Neither is damaged by the above.

## 3. What `Done when` fails to pin

**An implementation can satisfy every stated gate and be wrong, and the cheapest such implementation is the likely one.** Add a `Rate ceiling` config key, read it, pass it to `refreshIntervalMs`, have the rule ignore it or use it only in a branch nothing reaches. Then: a declared ceiling "reaches" the function (it is an argument); no connector reports a real limit *in the new key's terms*, so "prefers it" is vacuous; the byte-identical test passes trivially **because nothing changed**; no new host call is made; the constants are untouched; the suites pass. Every gate green, behaviour unchanged.

Specifically unpinned:

- **No gate says the interval must actually differ** for a connector near its ceiling. There is no assertion of the form *"at 90% spent, the interval is longer than at 10%"*. Without one, the feature's entire purpose is untested.
- **"prefers a vendor-reported limit where one exists" is untestable as written**, because the plan asserts no such limit exists outside GitHub. Live, GitHub reports `limit: 5000, basis: actual` and Bitbucket reports `1000, predicted` — so `predicted` versus `actual` versus declared is a **three-way** precedence the plan treats as two-way and never resolves. Which wins for Bitbucket, the shell's `1000` or the operator's key?
- **No gate requires the existing consumer to keep working.** `boundFromLimit` reads the same `prLimit`. A change to how the limit is read or keyed can move the concurrency cap, and nothing in the Done-when names `prConcurrencyBound`, `withHostSlot`, or `pr-concurrency.test.ts`.
- **"keyed by connector and account" is not checked against how the board actually asks.** `fleet.ts:1764` calls bare `hostSaid(['spend-rate'])` with no `--connector`/`--account`; the script defaults to `budget_account(backend)` (`plot-host.sh:1882`). A config key keyed by account must resolve against *that* account string — derived from `gh hosts.yml` for GitHub and from the **remote URL owner** for Bitbucket — and nothing pins that agreement.
- **The byte-identical test is specified over "gh, bb and jen"** — one of which never reaches this code path.

## 4. The strongest argument against doing this at all

**The measurement that motivates it says the opposite of what the plan concludes, and the mechanism it asks for already exists one layer over.**

The plan's case is *"157/hour against a limit the record cannot state"*. The record states the limit — 5000 — and states what remains, 3229. It also states 1154/hour, seven times the plan's figure. So the one number offered as evidence of blindness is a number the record produced *while being read*, and the connector it describes is the one the plan itself calls harmless.

Meanwhile the ceiling question is already answered for spend: `boundFromLimit` derives a bound from exactly this reading and `withHostSlot` enforces it on every call. Adding a second, differently-shaped consumer of the same reading — a declared key for connectors whose numbers the shell already hardcodes — buys a cadence stretch on top of a concurrency cap that is already gating, and risks the two policies compounding. `cadence.ts:9-31` warns about precisely this: *"reacting to an error here would compound with the division already happening and drift the cadence down with nothing to bring it back."* The plan quotes that file's constants and not its warning.

The honest next step is a reading, not a branch: on the repository whose `bb` board polls too hard, run `plot-host.sh spend-rate` and see whether it reports `limit: 1000, basis: predicted` and whether `prConcurrencyBound` is already bounding it. That is one command, and it decides whether the remaining gap is a config key, a cadence input, or a concurrency cap that is not firing.

**Not a rejection.** Unlike the sibling, this plan's central code reading is correct: `refreshIntervalMs` genuinely takes one rate field and no ceiling, and no config key exists. A real gap sits where it points. But its subtitle, its headline measurement and one of its three table rows are each false on main, and it does not know that its own key fact — the limit — is already read, already stored, and already consumed. Those are amendments to the Design and the Done-when, not grounds to abandon it.

**What an amended plan needs:** the live `spend-rate` output replacing the quoted one; the subtitle corrected, since Bitbucket declares 1000; Jenkins removed or re-scoped as the separate CI port it is; `entry.prLimit` and `boundFromLimit` named as the existing reader, with the gap restated as *the cadence does not read the ceiling the concurrency bound already reads*; a three-way precedence among `actual`, `predicted` and declared; and one gate asserting an interval that **actually moves** when the ceiling is near.

Verdict: amend
