# Scope decision — ADOPTION lens

Subject: `docs/plans/2026-09-15-a-connector-declares-its-ceiling.md`
Question: wiring-only, both, or neither.
Reading position: a team adopting Plot into a repo nobody here has seen, holding only `## Plot Config` and its documentation.

## 1. The facts, re-verified

Every fact in the brief holds. Three are now different numbers than the brief states, and one of the three inverts a conclusion.

**`refreshIntervalMs` takes one rate field.** `cadence.ts:244-257` — `rate: Pick<SpendRate, 'perHour'> | null`. Confirmed verbatim. No ceiling parameter.

**The ceiling already has a consumer.** `limitReadingOf` (`fleet.ts:1615`) → `prConcurrencyBound` (`fleet.ts:1642`) → `boundFromLimit` (`concurrency.ts:139`) → `concurrencyBound`. Confirmed at every hop.

**`floor(1000/900) = 1 = MIN_CONCURRENCY`.** `concurrency.ts:143` — `Math.max(MIN_CONCURRENCY, Math.floor(reading.limit / callsPerHour))` where `callsPerHour = SECONDS_PER_HOUR / SECONDS_PER_SLOT`. Any ceiling below 900 yields exactly `MIN_CONCURRENCY`. Confirmed arithmetically.

**`LimitBasisSchema` is a closed 3-enum.** `limit.ts:26` — `z.enum(['actual', 'predicted', 'unknown'])`. A fourth basis `declared` is not expressible without editing it.

**GitHub reports `actual` on 0.06% of lines.** Re-derived from the live ledger (`~/.plot/state/budget.tsv`, 132,158 lines):

```
github     42 actual · 73,252 unknown   = 0.0573%
bitbucket  48,557 predicted             = 100%,  limit=1000 on every line
jenkins    8,324 unknown                = 0%
jira       1,994 unknown                = 0%
```

Three consecutive live `spend-rate` runs, taken now:

```json
{"connector":"github","perHour":268.02,"limit":null,"basis":"unknown"}
{"connector":"github","perHour":269.48,"limit":null,"basis":"unknown"}
{"connector":"github","perHour":269.45,"limit":null,"basis":"unknown"}
```

**Nothing false. Three numbers moved, and the movement matters:**

**(a) Bitbucket saturation is 116%, not 77%.** In-window, last hour:

```
bitbucket  1157/hr against a declared ceiling of 1000  = 116%
github      269/hr
jenkins     530/hr
jira        130/hr
```

Round 2 measured 77%. It is now **over** the ceiling. The premise strengthened between rounds — which is itself the third overturn of a headline number on this plan, and the reason I weight *stability of the measurement* heavily below.

**(b) Bitbucket has THREE accounts, not one.** `plot-pm` (7,747 lines), `quatico` (40,496), `unknown` (314). In-window: `quatico` 719, `plot-pm` 424, `unknown` 12. The plan's declaration is keyed by connector **and account**. On this estate alone that is three keys for one connector — and one of the three account names is literally the string `unknown`.

**(c) The Jenkins correction is right, and its consequence is bigger than round 2 noticed.** `budget_reading` (`plot-host.sh:1978-1987`) has arms for `bitbucket)` and `*) unknown` only. The `limit: 60` at `:3760` is inside the **`ci-limit`** op — a different verb, with its own comment calling Jenkins *"the `predicted` case the design names"*. `spend-rate` never consults it. So Jenkins runs 530/hr against a ceiling that exists in the file and does not reach the reading.

## 2. Is there a connector whose ceiling is present and unused by the cadence?

**Yes. One, unambiguously, with numbers.**

Bitbucket. `plot-host.sh:1984` supplies `1000 predicted`; **48,557 of 48,557 ledger lines carry it** — 100%, with no exceptions across three accounts and the whole file's history. That ceiling reaches `boundFromLimit` and reaches `refreshIntervalMs` nowhere, because the parameter does not exist.

And it is the connector that is over its ceiling: 1157/hr against 1000.

This is the strongest fact the plan has ever had, and it is an argument for the wiring and **only** for the wiring. Bitbucket's ceiling is present, universal, and requires nobody to type anything.

## 3. Is there a connector that NEEDS the declaration?

**No. And the adoption lens is where this fails hardest.**

The test is: a ceiling **absent and unknowable without a human**. Run it against all four:

| connector | ceiling in the reading | needs a human? |
|---|---|---|
| bitbucket | `1000 predicted`, 100% of lines | **no** — the adapter already knows |
| github | `5000 actual` when the header lands | **no** — the vendor says so |
| jenkins | absent from `spend-rate` | **no** — the number `60` is already written at `plot-host.sh:3760` |
| jira | absent | unmeasured; no evidence either way |

Jenkins is the only candidate that looks like one, and it disqualifies itself. The plan's own words: *"`limit: 60` for Jenkins is a default in the shell today; whether that matches a given instance is a question only its operator can answer, which is the argument for declaring it."*

**That argument proves the opposite of what it claims.** The number exists. It is in the repository. It is tagged `predicted`, which is precisely the basis meaning *"the adapter's own number from experience, wrong until something proves it"* (`limit.ts`). What Jenkins needs is for `budget_reading` to grow a `jenkins)` arm returning the 60 that is already written four lines of shell — not for every adopting team to discover their controller's tolerance and type it into a markdown bullet.

**So the declaration's only named beneficiary needs a one-line adapter fix instead.** There is no connector on this estate whose ceiling is absent and unknowable. If one exists in some adopting repo, nobody has met it, and the plan names none.

## 4. What each option costs if the premise turns out wrong again

The premise on this plan has been overturned **twice** and moved a third time under my own hand. That frequency is a fact about the plan, and it should price the options.

**`wiring-only` costs one parameter.** A ceiling passed beside the rate into a function that already runs at both refresh sites. If the Bitbucket premise evaporates — the board stops polling `bb`, the 116% turns out to be a test suite — the parameter sits unused and the no-ceiling path is byte-identical to today. Nothing was asked of any human. **It is reversible by deleting an argument**, and on a repo that never sees Bitbucket it is invisible.

**`both` costs a vocabulary, permanently, and the cost does not fall on us.** A config key is Plot's public surface. Adopting teams read it, copy it between repos, paste it into onboarding docs, and cargo-cult it into repos where it means nothing. Removing a shipped `## Plot Config` key later means every adopting repo carries a line Plot no longer reads — and, as §5 shows, **nothing will ever tell them.** If the premise moves a third time, `wiring-only` is a revert and `both` is a deprecation.

**`neither` costs the one solid fact on the table.** Bitbucket at 116% of a ceiling that is present on 100% of its lines and reaches the cadence rule nowhere — that is not speculation, and refusing it leaves a measured over-saturation unaddressed while the rule that could use it already runs. `neither` also has a real argument behind it (§6), and I weigh it before committing.

## 5. What the declaration asks a human to know, and what happens when they get it wrong

**This is my lens, and it is where `both` dies.**

I probed `plot-config.sh` directly rather than reading the panel's claim. Round 1's specific charge — that a generic `Rate ceiling` prefix-matches `Rate ceiling bitbucket:` — is **false**. The regex at `:165` is `^[[:space:]]*[-*]?[[:space:]]*\**${key}[:*]`, requiring `:` or `*` immediately after the key, so a generic lookup returns the default:

```
get "Rate ceiling"            → NONE     (correctly does not match)
get "Rate ceiling bitbucket"  → 1000
get "Rate ceiling BITBUCKET"  → 1000     (case-insensitive)
```

**The panel was wrong about the mechanism. It was right about the consequence, and the real consequence is worse than the one it named.** Every wrong declaration is silent. Measured in a sandbox repo:

```
declared "Rate ceiling gitub: 5000" (typo), asked "Rate ceiling github"
  → ABSENT, exit 0

declared "Rate ceiling bitbucket: 1000 requests/hour"
  → "1000 requests/hour"   — the unit rides along into a number

declared "Rate ceiling jenkins: one thousand"
  → "one thousand"          — prose, accepted

declared twice, 1000 then 500
  → 1000                    — first wins, silently; the second is invisible
```

`get` exits 0 in every case. **Plot cannot tell a wrong declaration from an absent one**, which was the brief's question and the answer is a flat no. A misspelt connector name, a misspelt account name, a unit, a word, a duplicate — all indistinguishable from *"this team chose the default."*

Now compose that with the arithmetic. A team declares `Rate ceiling bitbucket: 1000` — the correct number, the one the adapter already holds — and `floor(1000/900) = 1` serialises every Bitbucket call on their board. They get a board that crawls, from a declaration that was *right*. And per `regression`'s ratchet finding at `applyReaction` (`fleet.ts:1594`), `loweredConcurrency` only ever falls, so correcting the config does not recover it. **A restart does.** Nothing in the config documentation will say so.

**Two levels deep is the part I cannot defend at all.** The key varies by connector *and* account. On this estate that is three Bitbucket accounts, one of them named `unknown` — so a complete declaration reads `Rate ceiling bitbucket unknown: 1000`, and a team is being asked to write a config key containing the word "unknown" as data. An adopting team must know: which connectors their board touches, which account each resolves to, what the account string is spelled as **in a TSV file they have never seen**, and what their vendor's per-hour ceiling is. Four facts, three of them internal to Plot, and every one of them wrong-silently.

**The precedent cost.** I enumerated the estate's keys myself: ~30, every one a fixed closed-vocabulary name. Where several values are needed the answer is always a list in the value — `Branch prefixes: idea/, feature/, bug/, docs/, infra/` returns all five from one fixed key. That is not an accident of taste; it is what makes a misspelt key *findable*, because the key set is enumerable and a doc can list it. **A key whose name varies with runtime data cannot be enumerated, cannot be validated, and cannot be documented as a list** — Plot would have to document a *grammar*, and the first grammar on an estate of thirty literals is a change to what `## Plot Config` is. The plan proposes this and **never says what the key is called**, which is itself the finding: nobody has had to write the documentation sentence yet, and the sentence is the hard part.

**Can a declared number ever be trusted more than a measured one?** No — and the plan agrees in principle, ranking `actual` above declared. But the ranking is unreachable as built: `declared` is a fourth basis that `LimitBasisSchema` (`limit.ts:26`) does not contain and `fleet.ts:1789` normalises to `unknown` by a guard whose comment literally predicts *"a record written by a newer Plot could name a fourth word."* Through `spend-rate` the declaration is discarded and the feature is a no-op. Through `## Plot Config` — which is what the slice line actually says — the guard is bypassed by construction and an unvalidated human number walks straight into `boundFromLimit`. **The only two routes are "does nothing" and "bypasses the safety rail."**

## 6. Why not `neither`

`neither` is the serious alternative and I gave it real weight. Its case: this plan's headline has been overturned twice, the panel asked for seven things and got an amendment that introduced a new false number, and round 2 explicitly said *"not dispatchable."* A plan with that record arguably deserves rejection on process alone.

Three things hold me back.

**The wiring's premise is the one that got stronger, not weaker.** Every overturn has been about **GitHub's** oscillating `basis` field — a 0.06% sample read as standing fact, twice, in opposite directions. The Bitbucket reading has moved once, from 77% to 116%, and in the direction that strengthens it. It rests on 48,557 ledger lines at 100% coverage, not on a single command's output. These are different qualities of evidence and the plan's failures all belong to the weaker one.

**The wiring is not what failed review.** Round 2's own words: *"the one-line wiring is justified."* What it refused was the config key. Rejecting both punishes the half that survived three rounds of interrogation because the other half did not.

**`neither` leaves a measured over-saturation on the floor** while the rule that would consume the fix already runs at both refresh sites. That is a real cost, and unlike the declaration's costs it is being paid now.

What `neither` is right about is that the plan as written must not ship. That is satisfied by cutting it to the wiring, not by rejecting it.

## 7. The conditions

`wiring-only` is my choice **as scoped by round 2's item 3** — the ceiling travels in **its own parameter**, never inside a `LimitReading`. That separation is the whole safety argument from this lens: a ceiling in its own parameter cannot reach `boundFromLimit`, so the `floor(1000/900) = 1` regression is impossible by construction rather than by a test somebody has to keep passing. A ceiling smuggled inside a `LimitReading` re-creates every hazard in §5 with no human typing anything.

Three further things the slice must carry, each because an adopting team cannot see them:

- **Gate `prConcurrencyBound(entry)`, not `boundFromLimit`.** The pure function cannot fail; a new caller constructing a new reading is the regression.
- **The movement gate must be directional and thresholded.** `cadence.ts:143-147` says a board may only ever be slowed; *"two different numbers"* is satisfied by 1 ms and by the wrong direction.
- **Gate the `unknown` path explicitly.** It is GitHub's standing state on 99.94% of readings, and it is Jenkins' and Jira's state on 100%.

And one finding to file rather than build: **`budget_reading` has no `jenkins` arm.** The `60 predicted` exists at `plot-host.sh:3760` under `ci-limit` and never reaches `spend-rate`. Jenkins runs 530/hr with no ceiling in its reading. That is a four-line adapter fix, it delivers a ceiling for a third connector, and it asks no human for anything — which makes it strictly better than the declaration at the declaration's own stated job.

## 8. The one-sentence reason

The wiring asks a human to know nothing and is deleted by removing an argument; the declaration asks an adopting team for four facts they cannot verify, fails silently on every one of them, and its only named beneficiary already has its number written in the repository.

Choice: wiring-only
