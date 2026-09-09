# The CI key carries its instance

> `ci_backend()` returns the whole `CI:` value and every caller matches it against the bare word `jenkins`. No repo writes the bare word, so a Jenkins estate reads `basis: unknown` where the adapter has a `predicted` limit of 60 ready to return.

## Status

- **Phase:** Approved
- **Type:** bug
- **Sprint:** the-jenkins-team-sees-its-builds
- **Review:** pr
- **Impl:** own branches
- **Rounds:** 3
- **Approved:** 2026-09-09, Jan Wloka, plan-PR #852 merged
- **Started:** 2026-09-09, Jan Wloka, `bug/the-ci-key-splits-into-scheme-and-instance`

## Changelog

- A Jenkins repo's CI limit reads `predicted`, not `unknown`, and reaches its connector instead of being filtered out as another service's. The `CI:` config value is split into its scheme and its instance, so a value carrying a host name still matches, and the `Jenkins instance` key overrides the prose where a repository states one.

Board impact: yes, and it is the point. The board renders the CI connector's limit, and it currently shows `unknown` for every Jenkins repo.

## Motivation

**Read against a real instance on 2026-09-09, and the connector answered wrong.**

`jen -I https://jenkins-ci-webbloqs.internal.quatico.dev auth status` reports
`Jenkins auth:  OK — jan.wloka@quatico.com`, Keycloak signed in, token in the
keychain. The instance is reachable and the adapter's auth grep matches it. Then:

| `CI:` value | `ci-limit` answers |
|---|---|
| `jenkins` | `limit=60 basis=predicted` |
| `` Jenkins at `jenkins-ci-ewz.internal.quatico.dev` `` | `limit=null basis=unknown` |
| `jenkins https://jenkins-ci-webbloqs.internal.quatico.dev` | `limit=null basis=unknown` |

**Only the bare word works, and no repo writes it.** Measured across the
Quatico estate: `ewz` declares `` CI: Jenkins at `jenkins-ci-ewz…` ``, another
declares `CI: Jenkins pipelines in .build/pipelines/…`. Every real Jenkins repo
falls through.

### Why it happens

`ci_backend()` (`plot-host.sh:548`) prints the **whole** config value
lowercased — scheme and everything after it — with no token split:

```bash
ci_backend() {
  if [ -n "${PLOT_CI:-}" ]; then printf '%s\n' "$PLOT_CI" | tr '[:upper:]' '[:lower:]'; return; fi
  bash "$here/plot-config.sh" get "CI" "" | tr '[:upper:]' '[:lower:]'
}
```

Its callers then match it as if it were scheme-only. **All four do**, and the
fourth only appears to work: `:2417` tests `[ "$ci" = "jenkins" ]`, `:2794` and
`:3336` open a `case` with a bare `jenkins)` arm, and `:2692` opens one with a
bare `github-actions)` arm. Measured — a `CI:` of
`github-actions (see .github/workflows/ci.yml)` misses that arm exactly as the
Jenkins values miss theirs. This repo escapes only because it happens to write
the word alone.

**The payload echoes the whole value too, and that is a SECOND defect rather
than a cosmetic one.** Measured 2026-09-09 by running the arm:

```
$ PLOT_CI='Jenkins at `jenkins-ci-ewz…`' plot-host.sh ci-limit
{"connector":"jenkins at `jenkins-ci-ewz…`","limit":null,"basis":"unknown"}

$ PLOT_CI='github-actions (see .github/workflows/ci.yml)' plot-host.sh ci-limit
{"connector":"github-actions (see …)","limit":null,"basis":"unknown"}
```

`build-shell.ts:180` then filters that list by **equality**:

```ts
readings.value.filter((reading) => reading.connector === shell.system)
```

`shell.system` is the connector's own word — `jenkins`, `github-actions` — so a
prose `CI:` value never matches, and `limit()` answers `[]`. The port's comment
defines that answer: *"A connector that meters nothing answers an empty list,
which is an answer."* **It is the wrong answer.** A Jenkins with a `predicted`
ceiling of 60 reports as a connector that meters nothing, and the caller cannot
tell the two apart.

So the missing split costs two things, not one: the `basis` is `unknown` where
`predicted` was ready, and the reading is then discarded before any caller sees
it.

**The `ci-limit` arm is the one that stings**, because the code is right about
Jenkins and never reaches its own answer. It carries the reasoning and the
number — *"A Jenkins instance reports no rate limit… so the ceiling is this
adapter's estimate of what a shared controller tolerates, tagged for what it
is"* — and then falls through to `*)`, whose comment says `unknown` is *"the
honest word"* for **a connector nobody has written an estimate for**. Jenkins
has one. `unknown` is the honest word for the wrong situation.

### The estate already solved this, one key over

`Tracker:` packs a scheme and a base URL into one value and splits it:

```bash
tracker_scheme()   { tracker_raw | awk '{print tolower($1)}'; }
tracker_base_url() { ... }
```

`plot-host.sh:1307` documents the shape — *"The value carries the base URL
after the scheme (`jira https://acme.atlassian.net`)"*. `CI:` has the same
shape in every real repo and none of the machinery.

### A second convention exists, and adoption now writes it

`jenkins_instance()` (`:665`) reads a **separate** `Jenkins instance` config
key, falling back to `$JENKINS_INSTANCE`. **It is not a dead convention, and a
first draft of this plan said it was.** Measured 2026-09-09 against main:
`the-probe-reads-the-ci-system` merged an entire adoption path for it —
`plot-detect-repo.sh:137` reads the Jenkins host a repository's own docs name,
`stack.ts:176` holds `CiInstanceProposal` with its `slug`/`ask`/`key` shape, and
`plot-config.sh:102` documents the key. No repo sets it because the feature that
proposes it landed last week, not because nobody wants it.

**So both keys are live, and the plan settles their precedence rather than
retiring either.** `CI:` carries the instance for the repositories that already
write it in prose — every real Jenkins repo measured above — and `Jenkins
instance` **overrides** it, because that is the key adoption proposes and the
one a repo can state exactly.

### The two readers return different shapes, and that is the risk

**`jenkins_instance()` returns `<slug>/<job/path>`; `ci_instance()` can only
ever return a slug.** `plot-host.sh:559` defines the compound — the slug is what
`jen -I` takes, the remainder is the multibranch job's container path — and
`stack.ts:98` calls the host *"the SLUG half"*. The container path is a fact
about the Jenkins job tree that **no file in a repository states**, so no amount
of reading `CI:` prose can produce it.

`jenkins_build_map()` already handles a slug-only value, and its own comment
says what happens: `job=""`, list at the root scope, and *"otherwise no branch
matches and every row reads `none` — honest, and the open point's fallback."*

**That is why `Jenkins instance` must win where both are set.** A repo that
answered adoption's question has the job path; a repo that only wrote prose
does not, and degrades to root-scope listing. `quaweb` is the case that proves
it: its job is `job/quaweb/job/release`, nested, so a `CI:`-derived slug alone
reads every row `none` while the `Jenkins instance` key reads them correctly.

**The precedence is therefore one line, and it is not the tracker's.**
`tracker_base_url()` lets `$PLOT_JIRA_BASE_URL` win over the config value
because both carry the same shape. Here the override carries *more* than the
`CI:` value can, so the order is: `Jenkins instance` key, then
`$JENKINS_INSTANCE`, then `ci_instance()`. The prose is the fallback, never the
primary.

## Design

### Approach

**`ci_scheme()` and `ci_instance()`, shaped after the tracker's pair.**
`ci_scheme()` is the first token lowercased — the word every caller meant to
match. `ci_instance()` extracts a host from the prose, and is consulted **last**,
after both explicit sources.

**Every caller asks `ci_scheme()`.** The four sites keep their `case` arms and
their `=` test unchanged; only the value they compare moves. That is what makes
this a small diff rather than a rewrite.

**`ci_backend()` is removed, not kept.** After this change it has **zero**
callers — all four move to `ci_scheme()` — and a function retained for a
hypothetical reader is the second answer to one question this repo's own rules
call a defect. Keeping it invites a future caller to match on the prose value
again, which is precisely the bug being fixed.

**`PLOT_CI` moves onto `ci_scheme()`, and its docstring is corrected.**
`ci_backend()`'s comment calls it *"`PLOT_CI` overrides for tests"* and that has
been false since the build connectors landed: `build-actions.ts:39` passes
`buildReads({ context, system: SYSTEM }, { PLOT_CI: SYSTEM })` in **production**,
as the dispatch contract the arm reads. So the variable keeps its precedence —
env first, then the `CI` key — and is split the same way, because a connector
passing a bare `SYSTEM` word and a person writing prose must reach the same
comparison.

**`budget.ts:15` cites the function by name and moves with it.** The domain
documents `connector` as an open `z.string()` partly because *"`ci_backend()`
validates nothing at all"*. The argument survives the rename unchanged —
`ci_scheme()` validates nothing either, it only splits — so the citation is
updated rather than left pointing at a deleted function.

### The instance cannot be "everything after the first token"

**Measured against all three real Jenkins values, and the naive split fails on
every one:**

| `CI:` value | rest of the line |
|---|---|
| `` Jenkins at `jenkins-ci-ewz…` (Bitbucket PRs trigger…) `` | `at jenkins-ci-ewz… (Bitbucket PRs…` |
| `` Jenkins pipelines in `.build/pipelines/` (…) `` | `pipelines in .build/pipelines/ (…` |
| `Jenkins (e.g. continuous-build, …)` | `(e.g. continuous-build, …` |

None is a host `jen -I` can use. `Tracker:` gets away with the naive split
because its value is `jira https://acme.atlassian.net` — a scheme and a URL,
nothing else. **`CI:` is prose**, and every repo writes it as prose.

So `ci_instance()` extracts a **host**, not a remainder: the first backticked
span, or the first token that looks like a hostname or URL, and **empty when
there is none**. An empty instance is honest — `Jenkins (e.g.
continuous-build…)` names no instance, and pretending otherwise hands `jen -I`
a sentence.

**This is why `Jenkins instance` survives as an override rather than being
retired.** A repo whose `CI:` prose carries no host has somewhere to put one.

### The instance is a host name, not a URL, and both are written

`ewz` writes a bare host in backticks; the `PLOT_CI` probe used a full `https://`
URL. `jen -I` accepts either. `ci_instance()` therefore strips backticks and
returns what it finds without normalising a scheme onto it — the adapter passes
it to `jen`, which already handles both, and inventing a canonical form here
would break the callers that pass the other one.

### Not chosen: making `Jenkins instance` the only source

It is the tidier model — one key, one fact — and the first draft rejected it on
a claim that turned out to be false (*"no repo sets it"*: adoption proposes it,
and did so before this plan was written). **The real reason stands and is
different.** Every Jenkins repository measured on the Quatico estate already
declares its host in `CI:` prose, and none of them has run the adoption path
that would write the key. Making the key mandatory means each one reads
`unknown` until somebody edits it, and the failure in the meantime is the
silent one this plan exists to remove.

So the key wins where it is set, and the prose answers where it is not. That is
a fallback, not a rival.

### Not chosen: matching `jenkins*` with a glob

`case "$_ci" in jenkins*)` would fix `ci-limit` in one character. It also
matches `jenkins-ci-ewz.internal.quatico.dev` as a *scheme*, so a repo that
wrote only the host would read as configured Jenkins with no instance — and it
leaves `:2417`'s `=` test broken, since a glob is not an equality.

### Open Questions

- [ ] **Does `predicted: 60` survive contact?** The number is an estimate of
      what a shared controller tolerates, and nothing has measured it against
      a real instance under load. This plan makes it reachable; whether it is
      right is a separate question.
- [ ] **What does a repo with two Jenkins instances declare?** `ewz` and
      `webbloqs` are separate controllers with separate tokens. One `CI:` value
      carries one instance, and a repo building on both has no way to say so.

## Slices

**The regression surface is named, and it already exists.**
`test/reconcile/host.test.mjs` sets `PLOT_CI` in **11 places**, and
`packages/domain/test/host-shell.test.ts` and `build-shell.test.ts` cover the
same ops from the domain side. That suite pins the bare-word contract, so it is
what proves this change preserves behaviour for the spelling that already
worked. **Both slices keep it green without editing it** — a slice that has to
rewrite those tests has changed the contract rather than the parsing, which is
the signal to stop.

### Splitting the value

- `bug/the-ci-key-splits-into-scheme-and-instance` — `ci_scheme()` and
  `ci_instance()` replacing `ci_backend()`, shaped after `tracker_scheme()` /
  `tracker_base_url()`. **Asserted: `ci_scheme()` returns `jenkins` for all
  four real-world spellings** — the bare word, `` Jenkins at `host` ``,
  `Jenkins pipelines in …`, and `Jenkins (e.g. …)`. **Asserted: `ci_instance()`
  returns a host or nothing, never a fragment of prose** — `` Jenkins at
  `jenkins-ci-ewz…` `` yields the host and `Jenkins (e.g. …)` yields empty,
  and neither yields `at jenkins-ci-ewz…`. **Asserted: the `Jenkins instance`
  key WINS over `CI:` prose when both are set**, and `$JENKINS_INSTANCE` wins
  over the prose too — the override carries a job path the prose cannot express,
  so a repo that answered adoption's question keeps its nested job rather than
  degrading to root-scope listing. **Asserted: `PLOT_CI` is split like the
  config value** — `build-actions.ts:39` passes it in production, so a bare
  `SYSTEM` word and a person's prose must reach the same comparison. → #853

### Asking the scheme

- `bug/the-ci-callers-match-the-scheme` — the four call sites compare
  `ci_scheme()`, and `ci_backend()` is **deleted**: `:2417`, `:2692`, `:2794`,
  `:3336`. **Asserted: `ci-limit` reports `basis: predicted` for all three real
  Jenkins spellings**, which is the defect this plan was opened for.
  **Asserted: `github-actions` with a trailing note still matches its arm** —
  `:2692` has the same bug and the same fix, so the fourth caller moves with the
  other three rather than being left as the one that already worked.
  **Asserted: `ci-limit`'s payload reports the SCHEME as its connector** —
  `{"connector":"github-actions"}`, not
  `{"connector":"github-actions (see …)"}`. **Asserted from the domain side:
  `limit()` returns a NON-EMPTY list for a prose `CI:` value** — this is the
  assertion that catches the second defect, because `build-shell.ts:180` filters
  by equality against `shell.system` and the payload fix is what makes the
  reading survive it. A shell-only assertion would pass while the connector
  still answered *meters nothing*. **Asserted: no `ci_backend` reference
  survives** — `grep -c ci_backend` returns 0 across scripts AND
  `packages/domain/src`, since `budget.ts:15` cites it by name and its citation
  moves to `ci_scheme()` in this slice.
## Notes

Written 2026-09-09, after `the-connector-is-read-against-a-real-instance` was
finally read against one. The item wanted confirmation; it found a defect, which
is the better outcome and the reason the item existed.

**Two of my own claims died on the way here, both from a grep.** I first
reported that `plot-host.sh:583` looked for `jenkins auth: ok` while `jen 0.4.0`
emitted no such line — false; it emits `Jenkins auth:  OK` once an instance is
verified, and my probe had used an unverified slug. I then guessed a second
checked sprint explained a filter bug — also false, one sprint is Active. The
defect in this plan is the one that survived being executed rather than read,
which is why both slices assert against `ci-limit`'s actual output.

**Interrogated 2026-09-09, one round**, and it corrected the plan in both
directions — the defect is wider than stated, and the fix as stated does not
work.

**All four callers have it, not three.** `:2692` matches a bare
`github-actions)` and fails identically on
`github-actions (see .github/workflows/ci.yml)`. This repo escapes by writing
the word alone, which is what made it look like the caller that worked.

**And "everything after the first token" is not the instance.** `Tracker:`
splits cleanly because its value is a scheme and a URL. `CI:` is prose in every
repo that declares it, so the naive split yields `at jenkins-ci-ewz…`,
`pipelines in .build/pipelines/…` and `(e.g. continuous-build…)` — none a host
`jen -I` can use. `ci_instance()` extracts a host or returns empty, and
`Jenkins instance` survives as the override a prose-only value needs.
