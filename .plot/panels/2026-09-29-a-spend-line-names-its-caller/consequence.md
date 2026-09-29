Position: reject
Evidence: executed

# The ledger already names the spender, and it is not this repository

Host calls made: **1** (`gh issue view 1069`). Every other reading is from the local ledger and the checkout. No writes to `~/.plot/state/budget.tsv`; `cmp` not needed — nothing was copied.

---

## 1. The premise is false: the `account` field already discriminates, and it answers the plan's own question

The plan states (`docs/plans/2026-09-29-a-spend-line-names-its-caller.md:45-51`):

> Schema version, connector, account, endpoint class, timestamp, cost, three limit fields, basis. **Nothing names the caller** — not the process, not the repository, not the command.

**"Not the repository" is wrong.** `plot-host.sh:2679-2685` defines the Bitbucket account field as exactly that:

```sh
    bitbucket)
      # `bb_identify` already resolves who bb is, and it caches; but it runs a
      # `bb` call, which is the thing being counted. The remote's owner is the
      # free approximation and is the half of the key that groups correctly:
      # two checkouts of one workspace share a budget.
      who="$(git config --get remote.origin.url 2>/dev/null | sed -E 's#^.*[:/]([^/]+)/[^/]+(\.git)?$#\1#')"
```

The Bitbucket account **is the workspace parsed out of `remote.origin.url`**. It is a repository identifier, written on every line, already.

So I ran the plan's own measurement with the account left in rather than summed away — same file, same 60-minute window:

```
bitbucket/quatico/api                    2234
github/jwloka/graphql                     682
github/jwloka/core                        160
jenkins/unknown/                          117
bitbucket/plot-pm/api                      98
bitbucket/acme/api                          3
bitbucket/a/api                             3
```

And this checkout:

```
$ git config --get remote.origin.url
https://github.com/plot-pm/plot.git
```

**The 88% is the `quatico` workspace. This repository is `plot-pm`, and it accounts for 98 calls — 3.5%.** The plan's motivation table (`:25-31`) collapses the account column, prints `bitbucket api 2497 88%` as one row, and then concludes at `:51` that nothing can attribute it. The attribution was in the field it dropped.

This is the failure mode the panel brief warned about — *a plan quoted its input as evidence for its output*. Here the plan aggregated away the discriminating field and then cited the aggregate as proof that no discriminator exists.

Issue #1069 asked the right question and the plan skipped it:

> - **Whether it is one estate or several.** Two boards run on this machine, one per checkout … A per-repo breakdown may show a single offender or an even split.

**A per-repo breakdown is one `awk` over the existing file. It shows a single offender, and it is not this one.** The plan's `Done when` bullet — *"The 88% is attributed"* — is satisfiable today, before any field is added, at zero cost.

---

## 2. The stated consequence is backwards: this board cannot see that traffic, so the field cannot explain the stretch

The plan's causal claim (`:33-35`):

> a **511 s** board interval … **The board is pinned past its ceiling by traffic that is not the board's.**

The board's cadence input is `spendRateFor` (`packages/board/src/server/fleet.ts:1870`), which shells `plot-host.sh spend-rate` with **no arguments**. That arm resolves its own defaults (`plot-host.sh`, spend-rate arm):

```sh
    # Defaults name THIS connector and THIS account, which is what a caller
    # asking "what am I spending?" means.
    [ -n "$_sr_connector" ] || _sr_connector="$be"
    [ -n "$_sr_account" ] || _sr_account="$(budget_account "$be")"
```

Executed, as the board calls it:

```
$ plot-host.sh backend
github
$ plot-host.sh spend-rate
{"connector":"github","account":"jwloka","bucket":"","spent":898,"spanMs":3583508,
 "perHour":902.13,"lines":194841,"unreadable":0,...,"basis":"unknown"}
```

**This board's cadence reads `github/jwloka` — 902/hr. The Bitbucket `quatico` 2234 is not in its window and never was**: different connector, different account, filtered out at `plot-budget.sh:250` by `if ($2 != want_c || $3 != want_a) next`.

So the stretch this board is running is driven by **902 GitHub calls an hour under this user's own account**, which is the very traffic a caller field would be least able to excuse. The plan's headline sentence — *"pinned by traffic that is not the board's"* — inverts what the reading shows. This is the same defect the brief measured in the most recent plan by this author: a consequence stated exactly backwards.

The 88% is real, and it is somebody else's checkout saturating the **shared Bitbucket account**, which is a real finding worth its own issue. It is simply not the cause of *this* board's 511 s interval.

---

## 3. Attribution and rate are different questions, and the plan conflates them

The plan claims (`:57-61`) a caller field would have shortened #1059 and #1065, and that *"A caller field answers it with `sort | uniq -c`."*

Test the claim against what those refutations actually needed:

- **#1059** claimed unbundled per-branch supervisor calls. The refutation was **2 calls per tick, gated on `claimable && briefPresent`**. A caller field gives `supervisor: N/hour`. It does **not** give calls-per-tick — that is a rate over an event the ledger does not record, because the ledger has no tick boundary. **The instrumentation was still required.**
- **#1065** claimed the supervisor lacked backoff. The refutation was *it is ~8% of the account*. That is a **share of a total** — and the existing `connector/account/bucket` key already partitions the total. The supervisor is the only Plot component that calls on its own timer, so its share was derivable from the existing key plus the cadence; and in any case a share does not tell you whether a backoff helps, which is what actually settled it.

**A caller field answers *who*, at a granularity of a component name. Neither refutation turned on *who*** — #1059 turned on *how many per unit of work*, and #1065 on *does throttling this help*. The plan asserts the field would have shortened both, and neither claim survives being checked against the refutation that was made.

---

## 4. What breaks: an 11-field line is *unreadable*, not merely ignored — in three readers, one of which deletes

The plan says (`:77-79`):

> `plot-budget.sh` parses positionally (`:250` indexes `$2`, `$3`). **Appending is the safe end**, and the schema version field `b1` exists for exactly this

**Both halves are wrong.** `plot-budget.sh:248` is not positional parsing — it is an **arity gate**:

```awk
      if (NF != 10 || $1 != "b1") { unreadable++; next }
```

Executed against a two-line fixture in each shape (scratchpad, not the live file):

```
--- 10 fields ---  matched=2 spent=2 unreadable=0
--- 11 fields ---  matched=0 spent=0 unreadable=2
```

**An appended field makes every line invisible to the rate reader.** Not misparsed — *unreadable*, which is the word `budget_rate` reports and which the cadence consumes as an absent rate.

The TypeScript side is identical and **also** version-gated (`packages/domain/src/entities/budget.ts:160-180`):

```ts
/** How many fields a `b1` line carries. */
const FIELDS = 10;
…
  if (fields.length !== FIELDS || fields[0] !== FORMAT) return null;
```

with `const FORMAT = 'b1'` (`:84`), and a test that pins the rejection (`packages/domain/test/budget.test.ts:145-147`):

```ts
  it('skips a line from a format it does not know', () => {
    expect(decodeEntry('b2\tgithub\tjwloka\tgraphql\t1\t1\t1\t1\t1\tactual')).toBeNull();
  });
```

So the plan's open question — *"whether `b1` becomes `b2`"* (`:79`, `:97`) — has **no safe answer as posed**:

| | `plot-budget.sh` | `decodeEntry` |
|---|---|---|
| keep `b1`, append field | `NF != 10` → **unreadable** | `length !== 10` → **null** |
| bump to `b2` | `$1 != "b1"` → **unreadable** | `fields[0] !== FORMAT` → **null** |

**Every reader must change in the same commit as the writer, or the cadence input goes to zero.** The plan's *"Appending is the safe end"* is the one sentence a slice would act on, and acting on it ships the outage.

### And the third reader deletes

`survivors()` (`packages/domain/src/rules/budget-record.ts:170-177`) rebuilds the file through `groupByBudget`, which **drops** anything `decodeEntry` rejects (`:141-144`), and the adapter writes the result back with `encodeEntry` (`budget-file.ts:132-135`):

```ts
    truncate: async (keep: readonly BudgetEntry[]): Promise<PortResult<void>> => {
      …
      const text = keep.map(encodeEntry).join('');
```

`encodeEntry` (`entities/budget.ts:130-143`) emits a hardcoded 10-field `b1` line. Its own docstring states the drop as policy (`:161-165`):

> Unreadable lines are **DROPPED**. A torn tail describes nothing, and a line from a format this Plot cannot read is one it must not preserve on faith

**So a half-migrated estate does not merely misread the new lines — the first pruner to run silently deletes them and rewrites the survivors without the new field.** The plan's `Done when` — *"`plot-budget.sh` and the cadence rule read the same totals as before"* — would pass on a freshly-truncated file precisely because the new field was destroyed. That Done-when cannot detect the failure it is written to catch.

`packages/domain/corpus/` holds no budget corpus test, so the shell/TS pair is **undeclared duplication** under CLAUDE.md's *A Shell Script Asks The Domain*. Two independent 10-field readers, no test pinning them. A schema change here is exactly the drift that rule exists to catch, and nothing would catch it.

---

## 5. Privacy and growth: one is fine, the other is understated and already regressed

**Privacy — the plan is right, and for a reason it does not give.** `plot-host.sh:2377-2391` hashes the Jira account because *"THE EMAIL IS HALF A BASIC CREDENTIAL"*. A component name (`board`, `supervisor`) carries no identity, so no hash is owed. But note the field the plan proposes to add is **weaker** than the one already present: the Bitbucket `account` is a workspace name — a real organisation — and it is already written in clear on every line. The plan proposes adding a component label while the repository identifier it says is missing is already there unredacted.

**Growth — the plan says nothing, and the estate has already regressed.** Measured now:

```
43,785,795 bytes   761,659 lines   max line 71 bytes, mean 56.5 (cap 512)
```

against `docs/plans/2026-09-21-the-ledger-prunes-what-it-read.md`, which is **State: Released, Delivered 2026-09-21** and recorded `17.6 MB, 312589 lines`. **The ledger has grown 2.5× in eight days with a delivered pruner on the estate.** I find no live caller of `.truncate(` outside the fixture, and no shell path calls `survivors`/`truncationOwed` (`grep -rn 'survivors\|truncationOwed\|pruneOwed' skills/` → nothing).

This matters to *this* plan's cost case in a way it never states: `spend-rate` reported `"lines":194841` for one answer, and it is on the board's refresh path. An 11th field adds ~6 bytes per line to a file nothing prunes. Byte width is not the risk — 71 against a 512 cap is ample. **The risk is that the plan adds a field to a file whose delivered pruner is not running, and does not notice.** A plan about the ledger that measures the ledger and does not report a 2.5× regression against a released plan has not read its own subject.

---

## What I would support instead

1. **Take the reading today** — the per-account split above is the attribution the plan exists to enable, and it needs no code. File the `quatico` 2234/hr as its own issue against that checkout.
2. **Correct #1069's framing**: this board's cadence reads `github/jwloka` at 902/hr. The Bitbucket 88% is a shared-account problem, not this board's cadence input.
3. **Fix the pruner** — 43 MB, 761k lines, a delivered plan that is not running. That is a live defect with a shipped remedy.
4. **Only then**, if a component-level split within one account is still wanted, treat it as a versioned format migration: one commit touching `budget_append`, `budget_rate_read`, `encodeEntry`, `decodeEntry`, `FIELDS`, `FORMAT`, plus a corpus test pinning shell and TS — and a stated answer for the lines already on disk.

---

## Against my own position

**The strongest case for `amend` rather than `reject`:**

- **The account field does not separate components within one checkout.** Two boards, a supervisor and eleven scripts under `github/jwloka` all write `jwloka`, and my own reading shows 902/hr there with no way to split it. If the real question becomes *which of this checkout's components spends the 902*, the ledger genuinely cannot answer and a caller field is the right instrument. The plan would then be right about the mechanism and wrong only about the motivating example — which is an amend, not a reject.
- **My arity finding is a slicing objection, not a design objection.** "Every reader changes together, with a corpus test" is a paragraph the plan could absorb. It does not show the field is wrong; it shows the migration section is one sentence where it needs ten.
- **`jenkins/unknown/`** (117/hr) shows the account field degrading to `unknown` for a whole connector, so it is not a universally reliable discriminator. Where it degrades, a caller field would still carry information.

**Why I still reject rather than amend.** The plan's motivation, its headline consequence, and its two historical claims are each refuted by the file it proposes to change:

- the 88% **is** attributable today, to a different repository;
- this board **cannot see** that traffic, so it is not what pins the cadence;
- neither prior refutation turned on *who*.

Those are not gaps to fill in — they are the whole argument for the field. A plan can be amended when its reasoning holds and its scope is wrong. Here the reasoning is what failed, and it failed in the direction the panel was told to expect: **the aggregate that hid the answer was quoted as proof that no answer exists.** The right next step is the one-command reading, not a schema migration across three readers to buy a discriminator the file already has.
