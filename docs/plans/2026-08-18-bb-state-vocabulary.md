# `plot-host.sh` speaks Bitbucket's `--state` vocabulary, not GitHub's

> Translate the caller's host-neutral `--state` into what `bb` accepts, so a
> history-wide PR query on Bitbucket returns PRs instead of an error.

## Status

- **Phase:** Approved
- **Type:** bug
- **Sprint:**
- **Story:** plot-board
- **Review:** in-session
- **Impl:** same branch
- **Approved:** 2026-08-18, Jan Wloka, in-session

## Approval

- **Assignee:** jwloka

## Changelog

- `plot-host.sh pr-list --state all` now works against Bitbucket, where it
  previously failed outright — the board's PR-dependent groups fall back to
  "unavailable" no more.
- `--limit` is reported as unhonourable on Bitbucket rather than silently
  dropped: `bb` has no such flag and returns a fixed page.

<!-- Board impact: none to the plan format or the docs/plans layout. The board
     is the CONSUMER that surfaced this — it calls
     `pr-list --rich --state all --limit 300` — but no rebuild is required,
     because only the adapter script changes. -->

## Motivation

The board renders a PR condition beside each branch row. On a Bitbucket repo
every PR-dependent group instead reports:

```
PR data unavailable (Command failed: bash …/plot-host.sh pr-list --rich
--state all --limit 300
  error: invalid --state 'ALL' (must be open, merged, declined, or superseded))
— the two groups above that depend on it may be incomplete.
```

Observed 2026-08-18 against `bitbucket.org/quatico/ekzweb` with `bb` 1.0.0.

### The translation was only ever built in one direction

`plot-host.sh` is Plot's single adapter over both hosts, and it already knows
Bitbucket's vocabulary differs — line 60 says so, and every response mapper
carries `if .state=="DECLINED" then "CLOSED"`. That is the *reading* direction.
The *writing* direction was never built: the caller's GitHub word goes to `bb`
unchanged.

`bb pr list --help` (1.0.0) states the accepted set:

| | accepts | `all` token | `closed` |
|---|---|---|---|
| `gh pr list` | open, closed, merged, all | yes | yes |
| `bb pr list` | open, merged, declined, superseded | **no** | **no** (it is `declined`) |

Three call sites pass the untranslated word:

| Line | Call | Effect on Bitbucket |
|---|---|---|
| 203 | `bb pr list --state all` (`pr-state` by branch) | branch→PR resolution fails |
| 386 | `bb pr list --state "$state" …` (`pr-list --rich`) | the board's call fails |
| 389 | `bb pr list --state "$state" …` (`pr-list` plain) | same, without check fields |

### A second defect hides behind the first

The same three sites forward `--limit N`. **`bb pr list` has no `--limit`
flag** — it errors with `unknown flag: --limit`. Measured 2026-08-18:

```
$ bb pr list --state declined --limit 2 --json
unknown flag: --limit
```

This matters for sequencing: fixing only the state word would leave the board's
call (`--state all --limit 300`) failing with a *different* error at the same
place. Both defects sit on the same line and must be fixed together, or the fix
reads as ineffective.

### What `bb` returns instead of a page size

`bb pr list --json` returns a fixed page — 50 PRs at 1.0.0. A caller asking for
300 cannot be served, and serving 50 silently would read as *that is all there
is*: the same class of quiet wrong answer the adapter refuses elsewhere
("An honest gap beats an invented answer, and absent is not false", line ~384).

## Design

### Approach

**Translate at the call, in a single helper.** The three sites share one
mapping, so it belongs in one function beside `backend()` rather than inlined
three times:

| caller says | `bb` gets |
|---|---|
| `open` / `merged` | unchanged |
| `closed` | `declined` |
| `all` | three separate calls: open, merged, declined |
| anything else | `die` — an unknown state is a caller bug, not a silent empty list |

**`all` needs three calls, not three flags.** The obvious shortcut —
`--state open --state merged --state declined` — is accepted by `bb` and is
**wrong**: repeated flags do not accumulate, the last one wins, silently.
Measured 2026-08-18 against `quatico/ekzweb`:

| invocation | returned |
|---|---|
| `--state open` | 3, all OPEN |
| `--state open --state merged` | 50, all MERGED — the 3 open ones are gone |
| `--state open --state merged --state declined` | 21, all DECLINED |

No error, no warning, a plausible list. This is a `bb` defect and is reported
separately (see Notes); the adapter must not depend on it being fixed, so it
issues one call per state and concatenates:

```
for s in open merged declined; do bb pr list --state "$s" --json; done
```

Verified against the same repo: 74 PRs (3 OPEN, 50 MERGED, 21 DECLINED),
74 unique ids, **0 duplicates** — the states partition the set, so no
deduplication is needed.

**`superseded` is deliberately excluded from `all`.** Such a PR is replaced by
a newer one for the same branch; including it would show one branch twice in a
board built around one row per branch. `gh`'s `all` has no equivalent state, so
omitting it breaks no cross-host expectation. A caller wanting it can still ask
for `--state superseded` explicitly.

**`--limit` is reported, not dropped.** On the Bitbucket branch, a `--limit`
above the page size writes one line to stderr saying it cannot be honoured, and
the call proceeds. Dropping it silently is the failure mode this plan exists to
remove; failing hard would break the board's working call over a cap it cannot
influence.

### The real fix is the test, not the translation

The mistranslation survived because **Plot develops on GitHub**: this repo's own
backend is `github`, so the Bitbucket branch has no daily user and no CI
coverage. A corrected adapter with no test decays the same way.

The test must exercise the bb branch without a Bitbucket account: a stub `bb`
on `PATH` that records its argv and emits canned JSON. Assertions:

1. `--state all` invokes `bb` three times, with open, merged and declined
2. `--state closed` sends `declined`, never `closed`
3. `--limit` never reaches `bb`'s argv
4. an unknown state exits non-zero instead of returning an empty list

That stub is worth more than the fix: it is the first coverage the Bitbucket
path has, and every future adapter change gets it for free.

### Open Questions

- [ ] Does `pr-state`-by-branch (line 203) want `all` at all? It resolves one
      branch to one PR; `open` + `merged` would cover every live case and save
      a call. Deliberately left as-is in this plan — narrowing it is a
      behaviour change, not a bug fix.
- [ ] Should the page-size ceiling be discoverable rather than assumed? The
      adapter would then say *50 of an unknown total*. Needs a `bb` capability
      this plan does not assume.

## Branches

- `bug/bb-state-vocabulary` — the helper, the three call sites, and the stub-`bb` test

## Notes

- Found while running the board against a Bitbucket repo
  (`bitbucket.org/quatico/ekzweb`) on 2026-08-18. The board itself was fine;
  only its PR-dependent groups were empty.
- **A separate `bb` defect was found and is not fixed here:** repeated
  `--state` flags silently keep the last value instead of accumulating or
  rejecting. `bb` lives in `agent-skills`
  (`skills/working-with-bitbucket-api/bin/bb`), a different repo with its own
  plan flow, and that repo already has `idea/bb-reports-pr-mergeability` open
  against the same `bb pr list` surface. Reported there rather than folded in.
  This plan's fix does not depend on it: one call per state works either way.
- A local patch was written and **reverted** during investigation — it used the
  repeated-flag shortcut and therefore returned only DECLINED PRs. The measured
  table under Approach is what replaced that assumption. `plot-host.sh` is
  unmodified as of this plan.
