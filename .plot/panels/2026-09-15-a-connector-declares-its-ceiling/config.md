# Panel juror — the DECLARATION lens

*What does it cost to make a human declare a number?*

Subject: `docs/plans/2026-09-15-a-connector-declares-its-ceiling.md`

---

## 1. Is every factual claim TRUE on main right now?

I verified each claim by reading the code. **The plan's architectural claims hold. One measurement does not, and one omission matters more than either.**

### Verified true

| claim | evidence |
|---|---|
| `prRefreshMsFor(backend, rate, currentMs)` at `fleet.ts:1724` | `packages/board/src/server/fleet.ts:1724` — exact signature, exact line |
| called at both refresh sites with a real backend | `fleet.ts:2006` (`prNextDueAt`) and `fleet.ts:2410` (`scheduleNextPr`) |
| `refreshIntervalMs` takes exactly four things, rate is `Pick<SpendRate,'perHour'>` | `cadence.ts:265-270` — `rate: Pick<SpendRate, 'perHour'> \| null`. **One field. No ceiling.** Correct |
| `cadence.ts:244` is `refreshIntervalMs`'s docblock region | the docblock opens at 239; the export lands at 265. Close enough to be a fair citation |
| `MAX_CADENCE_STRETCH = 8`, `CADENCE_DAMPING = 0.25` | `cadence.ts:33` and `cadence.ts:58`. Both exact |
| cost per refresh varies per connector | `fleet.test.ts:3977` gh=1, `:3996` bb=4 |
| `spend-rate` asks no host | `fleet.ts:1734-1755` docblock and `scriptsFor(opts).hostSaid(['spend-rate'])` at `:1763`. Confirmed |
| Jenkins `limit:60` hardcoded at `plot-host.sh:3760` | exact line, exact constant |
| Jira appends `- - -` with basis `unknown` at `plot-host.sh:1648` | `budget_record_jira()` at 1646-1650. Correct |
| `BudgetKeySchema` keyed connector/account/bucket | `packages/domain/src/entities/budget.ts:24-29`. Correct |

### FALSE — the headline measurement

The plan quotes, as *"measured live on this estate, 2026-09-15"*:

```json
{"connector":"github","perHour":157.09,"limit":null,"remaining":null,"basis":"unknown"}
```

I ran the same command just now:

```json
{"connector":"github","account":"jwloka","bucket":"","spent":1157,"spanMs":3559811,
 "perHour":1170.06,"lines":72829,"unreadable":0,"limit":null,"remaining":null,
 "resetAt":null,"basis":"unknown"}
```

**1170.06, not 157.09 — 7.5x the plan's figure.** The plan builds its *"for GitHub that is harmless"* argument on 157 against 5000. At 1170 against 5000 the board is at 23% of the GitHub ceiling, and the connector the plan dismisses as comfortable is the one actually moving. A rate is a live reading and drifts, so I do not call this fabricated — but the plan's one quantitative argument rests on a number that does not reproduce, and **the direction of the error undercuts the plan's own framing of which connector matters.**

### The omission — this is the serious one

The plan says the board is blind to any ceiling. **It is not blind. It already reads one and throws it away.**

`fleet.ts:1780-1791`, in `spendRateFor`:

```ts
const limit = (parsed as { limit?: unknown }).limit;
const basis = (parsed as { basis?: unknown }).basis;
const account = (parsed as { account?: unknown }).account;
return {
  perHour: ...,
  limit: typeof limit === 'number' && Number.isFinite(limit) ? limit : null,
  basis: basis === 'actual' || basis === 'predicted' ? basis : 'unknown',
  account: typeof account === 'string' && account !== '' ? account : null,
};
```

The docblock above it, `fleet.ts:1775-1779`, says so explicitly:

> **THE CEILING AND THE ACCOUNT COME FROM THE SAME READ**, so the concurrency bound costs no extra host request and no extra `bash`. `spend-rate` already reports both — the limit the response headers carried and the account `budget_account` resolved.

So `limit`, `basis` and `account` are **already parsed, already validated, already in hand at both call sites**, and then `prRefreshMsFor(backend, rate, currentMs)` is handed `{perHour}` alone. The gap is not a missing reading. **It is three fields discarded at one function boundary.**

And `basis: 'predicted'` already exists as a first-class word, with a validator at `:1789` that deliberately refuses an unrecognised basis. `plot-host.sh:3760` already emits `{"limit":60,...,"basis":"predicted"}` for Jenkins, with a docblock at `:3752-3757` explaining that it is *"this adapter's estimate of what a shared controller tolerates, tagged for what it is."*

**A declared ceiling is exactly a `predicted` limit.** The estate has already built the vocabulary, the transport, the parser and the honesty-tagging for it. The plan names `limit: 60` as evidence that a declaration is needed, without noticing that the mechanism carrying that 60 to the board is the mechanism it is proposing to build.

---

## 2. Is the problem real, and is this the right shape? — both halves

**"Built, wired and working": TRUE.** Verified at both call sites, with a real backend, real per-connector cost, and 20+ tests in `fleet.test.ts:3920-4790`.

**"Blind in exactly one direction": FALSE as stated.** It is blind at the *cadence signature*, not at the *reading*. That distinction is the whole plan. The plan's Design section reads as though the ceiling must be sourced from somewhere new; it is already sourced and already dropped one call short.

**The shape is therefore wrong in its expensive half.** Widening `refreshIntervalMs` to take a ceiling is right and small. Introducing an operator-declared, connector-and-account-keyed config key to *supply* that ceiling is a large new surface for a value the estate can already obtain — and, for the connector that prompted the report, **can obtain better.**

Note what the plan itself concedes: *"The operator's report was `bb` polling too hard."* Bitbucket's cost is already 4x GitHub's (`fleet.test.ts:3996`), its interval already 240s against 60s, and the fair-share stretch already applies to it independently. Before adding a declaration, nobody has established that a Bitbucket ceiling is what was missing rather than the 4x multiplier being wrong, or `MAX_CADENCE_STRETCH` binding at 8. **The diagnosis skips straight to a remedy that requires a human to supply a number.**

---

## 3. What `Done when` fails to pin

The list is unusually careful about *not regressing*. It is silent about *the declaration being right*, which is the only new risk this plan creates.

An implementation could satisfy **every stated gate** and still be wrong:

> Read `plot-config.sh get "Rate ceiling"` into a `number | null`, pass it as a fifth argument to `refreshIntervalMs`, prefer `rate.limit` where non-null, and pin gh/bb/jen byte-identical with no key set.

That passes every clause — declared ceiling reaches the rule; vendor limit preferred; no-config byte-identical across three backends; no new host call; both constants untouched; suites green — and it **ignores the account entirely**, silently reads a malformed value as a real ceiling, and is never once exercised with a key actually set. The gates test the *absence* path exhaustively and the *presence* path not at all.

Specifically unpinned:

1. **No gate requires a test with a ceiling declared.** Every clause is satisfiable with the key absent.
2. **"Keyed by connector and account" is unpinned as to how.** No key spelling, no lookup order, no precedence rule. §4 shows the spellings are not interchangeable.
3. **No validation clause.** Nothing says what a non-numeric, negative, zero or absurd value does.
4. **No precedence clause between declared and `predicted`.** The gate says vendor-reported wins over declared. Jenkins' 60 is `basis: predicted` — an adapter's *guess*. Does an operator's declaration beat a guess? The plan's own argument says it must (*"whether that matches a given instance is a question only its operator can answer"*), but the gate as written makes the guess win.
5. **"No new host call" is checked by asserting the spend-rate path still asks no host** — which was already true and stays true no matter what the implementation does. A gate that cannot fail.
6. **No observability clause.** Nothing surfaces the ceiling in use, so §4's silent failures stay silent.

---

## 4. MY LENS — what does the declaration actually cost?

### How `## Plot Config` keys work

`plot-config.sh:141-165`. One `awk` pass extracts the `## Plot Config` section; one `grep -m1 -iE "^[[:space:]]*[-*]?[[:space:]]*\**${key}[:*]"` finds the first line whose text matches the key; one `sed` strips the marker, bold, backticks and **any parenthetical**. `get` **exits 0 unconditionally** (`:5-7`) — missing file, missing section, missing key and malformed value are indistinguishable from a deliberate default.

**Critically: `${key}` is interpolated raw into an `grep -E` pattern, matched as a PREFIX** — the pattern is not anchored at its end, only followed by `[:*]`.

### Is there precedent for a compound key? No. None.

I enumerated every key this estate declares (`CLAUDE.md:11-92`) and every key any script reads. **All ~30 are fixed, closed-vocabulary names**: `Plan directory`, `Worker bound`, `Agent registry`, `Git host`, `Tracker`, `CI`, `Ticket prefixes`, `Board command`. Where a key must carry several values, the estate's answer is **always a list in the value**, never a name that varies:

- `Branch prefixes:` `idea/, feature/, bug/, docs/, infra/`
- `Ticket prefixes:` a comma-separated list, documented at `plot-config.sh:99-113` as *"A LIST, because a repository mapping to several projects is the normal case"*

**Not one key on this estate has a name that varies with runtime data.** The plan proposes the first — and proposes it two levels deep, varying by connector *and* account. It does not acknowledge that it is setting a precedent, and it does not say what the key is called.

### What the compound key actually does — measured

I ran the parser against each plausible spelling.

**Spelling A — `- **Rate ceiling bitbucket:** 1000` (space-separated).** Works, and creates a **prefix-collision hazard**. Because the pattern is prefix-matched, a lookup for the generic `Rate ceiling` matches a line reading `Rate ceiling bitbucket:` — so with:

```
- **Rate ceiling bitbucket:** 1000
- **Rate ceiling:** 5000
```

a lookup for `Rate ceiling` returns **1000**, the Bitbucket value, because `grep -m1` takes the first matching line. **Reordering the two lines changes the answer.** A generic key and a specific one cannot coexist safely, and the failure is file-order-dependent — invisible in review, unreproducible on another machine whose CLAUDE.md lists them the other way.

**Spelling B — `- **Rate ceiling (bitbucket):** 1000` (parenthesised).** **Returns the empty string.** The `s/\([^)]*\)//g` strip at `plot-config.sh:158` — designed to drop human prose — eats the account, the key `Rate ceiling (bitbucket)` never matches, and `get` **exits 0 with the default**. The operator's declaration is silently discarded and nothing anywhere says so. This is the most natural spelling a human would reach for, and it is the one that fails hardest.

**Spelling C — `Rate ceiling: bitbucket/jwloka=1000, jenkins/ci=60` (list in the value).** The only spelling with estate precedent. Survives parsing intact. **The plan does not propose it** — it proposes a key *"per connector"*, keyed by connector and account, which is spelling A or B.

**Spelling D — value validation.** `- **Rate ceiling bitbucket:** 1oo0 per hour` returns the literal string `1oo0 per hour`. Nothing on this estate validates a config value as numeric — `Worker bound` (`plot-worker-loop.sh:128`) and `Claim stale after` (`plot-reconcile-scan.sh:279`) both read through `cfg` with a string default and no check. A typo'd ceiling reaches the cadence as `NaN` or as a coerced default, depending on the implementation the plan does not specify.

### Absent, wrong, stale, or too low — and who would ever know

| state | what happens | who notices |
|---|---|---|
| **absent** | default; behaves as today. The plan's gates pin this well. **The overwhelmingly common case** | n/a |
| **wrong spelling** (paren form) | silently empty, exit 0, behaves as absent | **nobody** |
| **wrong value** (typo) | unvalidated string into arithmetic | **nobody** |
| **stale** (account upgraded, limit raised) | board stays slow forever | **nobody** — the board has no second source to disagree with |
| **too low** (cautious guess) | board stretches to `MAX_CADENCE_STRETCH = 8` and stops there — 8 minutes between refreshes | **an operator who thinks the board is broken**, with no indication a config line caused it |
| **too high** (optimistic guess) | no protection; exactly today's behaviour | **nobody**, until the host refuses |

**Every failure mode is silent, and there is no feedback path at all.** The reason is structural and the plan states it as a virtue: *"A probe spends the budget it is protecting."* True — and the consequence is that **a declared ceiling can never be checked against reality by anything.** The estate's own doctrine is *"Gates Over Rules"* (`CLAUDE.md:504-508`), whose test is *"Can you answer 'Did I complete this?' without actually doing the work?"* A declared ceiling fails that test completely: an operator can answer *"yes, I declared it"* while having declared a number that is wrong in either direction, and no gate, test, script or board view can contradict them.

Compare what the estate already does for the same question. `plot-host.sh:3752-3757` makes Jenkins' guess **honest** by tagging it `basis: predicted`, and `fleet.ts:1789` refuses to read an unrecognised basis as `actual` because *"reading it as `actual` would let an unrecognised value license a bound — the direction that spends."* The estate has thought carefully about exactly this hazard and built a vocabulary for it. **A config-read ceiling has no basis field and no tag — it would arrive at the cadence indistinguishable from a measured one.**

### The alternative the plan rejects

The plan rejects a probe on two grounds. **The first is correct** — a rate-limit probe spends the budget it protects, and `fleet.ts:1743-1746` records that `gh api rate_limit` was measured *both metered and wrong* (reported 5000 against headers reading 0).

**But "probe" and "declaration" are not the only two options, and the plan does not consider the third: use what is already read.** `spendRateFor` already has `limit`, `basis` and `account` in hand at zero additional cost, from a call that already happens. For GitHub that is a real header-derived ceiling. For Jenkins it is `60`, tagged `predicted`. For Bitbucket it is null — genuinely absent, and **that one gap is the only place a declaration is needed at all.**

The plan's second ground — *"the ceiling is an account property, not a repository one"* — is sound reasoning that argues **against** its own proposal. `## Plot Config` lives in `CLAUDE.md`, which is **committed, repository-scoped, and shared by every contributor and every worktree.** An account property declared in a repository file is in the wrong place by the plan's own argument: two repositories sharing a Bitbucket account must each declare the same number and keep them in sync by hand, with nothing detecting divergence. The estate already has a machine-local, account-keyed store for exactly this — `.plot/state/`, which `plot-state-receipt.sh` uses for precisely the reason that a committed value *"would clear the gate on every checkout that pulled it"* (`CLAUDE.md`, the receipt entry). The budget record itself is machine-local and account-keyed. **The declaration is being put in the one location the estate's own precedent says account-scoped facts must not go.**

### Can an adopting project realistically get this right?

**No — and for Bitbucket, the connector that prompted this, specifically not.**

To declare a correct Bitbucket ceiling an operator must know their plan's hourly API allowance per account. Bitbucket does not publish it in a response header — which is the plan's own premise for why it cannot be discovered. So the operator is asked to supply, by hand, into a prefix-matched grep with no validation and no feedback, a number **the vendor does not tell them**, whose only failure signal is a board that feels slow. The realistic outcome is a guess, and a guess declared in config is strictly worse than a guess declared in an adapter — because `plot-host.sh:3760`'s guess is tagged `predicted`, reviewed in a PR, shared across every adopter, and correctable once for everyone.

**The declaration moves a guess from a place where it is honest, versioned and reviewable to a place where it is silent, unvalidated and per-repository.** That is the cost, and the plan does not price it.

---

## 5. The single strongest argument against doing this at all

**The board already reads the ceiling, and the plan's own connector table is the proof.**

`fleet.ts:1780-1791` parses `limit`, `basis` and `account` on every refresh, at zero extra cost, with a validator that refuses an unrecognised basis. `plot-host.sh` already emits a real limit for GitHub and a `predicted` 60 for Jenkins. The board then calls `prRefreshMsFor(backend, rate, currentMs)` and hands the rule `{perHour}` alone.

So the actual defect is **three already-validated fields dropped at one function signature** — a change of perhaps thirty lines in `cadence.ts` and two call sites, testable as arithmetic, with no config key, no new vocabulary, no precedent set, and no human asked to know a number their vendor will not tell them.

The plan proposes that thirty-line change **plus** a first-of-its-kind compound config key, and presents the second as the substance. Of the three connectors in its own table, two already have a ceiling in hand. **Only Bitbucket lacks one** — and it is the one an operator is least able to supply.

Widening the rule's signature is worth doing. Sourcing that ceiling from an operator's declaration, before wiring up the two ceilings already sitting in the parsed response, is building the expensive and unverifiable half first.

---

## Recommendation

**Amend — split the slice, and invert its order.**

1. **First, and possibly alone:** widen `refreshIntervalMs` to take a ceiling, and pass the `limit`/`basis` that `spendRateFor` **already parses**. Keep every existing `Done when` clause; they are good. Add: a test with a ceiling *present*; a clause that `basis: 'predicted'` and `basis: 'actual'` are distinguishable at the rule; and a pin that Jenkins' existing `limit: 60` now reaches the cadence.
2. **Then measure the Bitbucket report again.** With GitHub's and Jenkins' real ceilings feeding the cadence, re-read the operator's complaint. It may be answered, or it may localise to the 4x cost multiplier or to `MAX_CADENCE_STRETCH`.
3. **Only if a gap remains**, propose the declaration as its own plan — and that plan must settle, with the parser's actual behaviour measured: the key spelling (**not** the parenthesised form, which returns empty); the prefix-collision rule; numeric validation with a stated refusal; precedence against `predicted`; whether a repository-committed file is the right home for an account-scoped fact; and how an operator ever learns their declaration is wrong.

Fix the headline measurement before anything else. `perHour` reads **1170.06**, not 157.09, and the plan's *"for GitHub that is harmless"* argument does not survive the correction.

Verdict: amend
