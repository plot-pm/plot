# The CI key carries its instance

> `ci_backend()` returns the whole `CI:` value and every caller matches it against the bare word `jenkins`. No repo writes the bare word, so a Jenkins estate reads `basis: unknown` where the adapter has a `predicted` limit of 60 ready to return.

## Status

- **Phase:** Draft
- **Type:** bug
- **Sprint:** the-jenkins-team-sees-its-builds
- **Review:** pr
- **Impl:** own branches
- **Rounds:** 1

## Changelog

- A Jenkins repo's CI limit reads `predicted`, not `unknown`. The `CI:` config value is split into its scheme and its instance the way `Tracker:` already is, so a value carrying a host name still matches.

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

**The payload echoes the whole value too.** `ci-limit` returns
`"connector":"github-actions (see .github/workflows/ci.yml)"` — a config note
rendered as a connector name, which is the same missing split seen from the
other end.

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

### And a second convention exists, unused

`jenkins_instance()` (`:665`) reads a **separate** `Jenkins instance` config
key, falling back to `$JENKINS_INSTANCE`. Measured 2026-09-09: **no repo sets
that key, and it appears in no documentation** — not in `CLAUDE.md`, not in
`plot/SKILL.md`.

So two conventions for one fact coexist, and the one the estate actually uses
is the one the code cannot parse. That is the decision this plan settles: **the
`CI:` value carries the instance**, and `Jenkins instance` becomes its
override rather than its rival.

## Design

### Approach

**`ci_scheme()` and `ci_instance()`, shaped exactly like the tracker's pair.**
`ci_scheme()` is the first token lowercased — the word every caller meant to
match. `ci_instance()` is what follows, with `Jenkins instance` and
`$JENKINS_INSTANCE` as explicit overrides for a repo that wants them separate.

**Every caller asks `ci_scheme()`.** The four sites keep their `case` arms and
their `=` test unchanged; only the value they compare moves. That is what makes
this a small diff rather than a rewrite.

**`ci_backend()` stays, and keeps returning the raw value.** Something may want
the whole line, and removing it would widen the change beyond the defect. What
changes is that no caller *matches* on it.

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

It is the tidier model — one key, one fact — and it is rejected because **no
repo sets it**. Adopting it means every Jenkins repo must add a key before its
CI limit works again, and the failure in the meantime is silent: the same
`unknown` this plan exists to remove.

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

### Splitting the value

- `bug/the-ci-key-splits-into-scheme-and-instance` — `ci_scheme()` and
  `ci_instance()` beside `ci_backend()`, shaped like `tracker_scheme()` /
  `tracker_base_url()`. **Asserted: `ci_scheme()` returns `jenkins` for all
  four real-world spellings** — the bare word, `` Jenkins at `host` ``,
  `Jenkins pipelines in …`, and `Jenkins (e.g. …)`. **Asserted: `ci_instance()`
  returns a host or nothing, never a fragment of prose** — `` Jenkins at
  `jenkins-ci-ewz…` `` yields the host and `Jenkins (e.g. …)` yields empty,
  and neither yields `at jenkins-ci-ewz…`. **Asserted: `Jenkins instance`
  overrides it**, which is what a prose-only `CI:` relies on.

### Asking the scheme

- `bug/the-ci-callers-match-the-scheme` — the four call sites compare
  `ci_scheme()` rather than `ci_backend()`: `:2417`, `:2692`, `:2794`, `:3336`.
  **Asserted: `ci-limit` reports `basis: predicted` for all three real Jenkins
  spellings**, which is the defect this plan was opened for. **Asserted:
  `github-actions` with a trailing note still matches its arm** — `:2692` has
  the same bug and the same fix, so the fourth caller moves with the other
  three rather than being left as the one that already worked.

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
