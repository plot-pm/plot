# The adapter checks the CLI it got

> A `bb` too old for the flags Plot passes makes every Bitbucket PR read as
> *no PR* — silently, because the error goes to `/dev/null` and `jq` exits 0.

## Status

- **Phase:** Approved
- **Type:** bug
- **Sprint:** the-board-serves-an-enterprise-stack
- **Story:** the-board-is-blank-where-it-matters
- **Review:** in-session
- **Impl:** own branches
- **Rounds:** 1
- **Approved:** 2026-08-26, Jan Wloka, in-session
- **Started:** <!-- YYYY-MM-DD, who, `branch` -->
- **Delivered:** <!-- YYYY-MM-DD -->
- **Released:** <!-- YYYY-MM-DD, version -->
- **Started:** 2026-08-26, Jan Wloka, `bug/the-adapter-checks-the-cli-it-got`

## Changelog

- `plot-host.sh` establishes that the `bb` on PATH supports the flags it is
  about to pass, and says so when it does not — instead of every Bitbucket PR
  list reading as an empty one.

## Motivation

### Measured 2026-08-26, then corrected the same day

Two different tools share the name `bb` on this machine, and Plot has no way to
tell which one it is talking to:

```
$ which -a bb
/opt/homebrew/bin/bb        craftamap/bb — a Go binary, 0.6.0, NO --json
/Users/jwloka/.local/bin/bb a WRAPPER for Quatico's own bb (a shell script)
```

**This is not a broken install, and an earlier draft of this plan said it was.**
The wrapper is deliberate and documents itself: it runs Quatico's `bb` from the
plugin cache, and keeps craftamap's binary in place as a named fallback. Two
tools, one name, different dialects — which is exactly why the adapter must ask
rather than assume.

The versions are unrelated number lines. craftamap's 0.6.0 is not "older than"
Quatico's 1.0.0; they are different products.

### What the adapter actually hits

`plot-host.sh:509` calls:

```sh
bb pr list --state "$_s" --json | jq -c '...'
```

Against **craftamap 0.6.0** that is:

```
$ bb pr list --state merged --json
Error: unknown flag: --json
```

The `2>/dev/null` swallows it, `jq` receives empty input and **exits 0**, and the
op returns nothing. Every Bitbucket PR list reads as *this repo has no PRs* — a
fabricated verdict, produced confidently.

### It is worse than a wrong answer: craftamap 0.6.0 panics

Under the rate limit the same account was already hitting:

```
$ bb pr list --state merged
:: An error occurred: 429 Too Many Requests
panic: runtime error: invalid memory address or nil pointer dereference
[signal SIGSEGV: segmentation violation]
```

A segfaulting CLI behind `2>/dev/null` is indistinguishable from a quiet one.

### The capable `bb` is a moving target, which is the real argument

Quatico's `bb` gained `checks` in `agent-skills` **v3.11.0** (PR #61,
2026-08-18). Measured 2026-08-26:

| where | version | `--json` | `checks` |
|---|---|---|---|
| plugin **cache** (what PATH `bb` ran) | 1.0.0 | yes | **no** |
| plugin **marketplace** after update | 1.9.0 | `--json <fields>` | **yes** |
| craftamap fallback | 0.6.0 | **no** | no |

So on one machine, on one day, `bb` meant three different capability sets. A
version floor cannot express that; only asking can.

Verified after updating the marketplace, against `quatico/quaweb-website`:

```
$ bb pr list --state open --json number,headRefName,checks
[ { "number": 837, "headRefName": "infra/…", "checks": "SUCCESSFUL" }, … ]
```

### `mergeable` is permanently unavailable, and that is settled

Do not treat `mergeable:"unknown"` as a gap to close. `agent-skills` measured it
against six open PRs and abandoned it: Bitbucket's REST API v2 exposes no such
field, `merge_commit` is null while open, `links.merge` rejects token auth, and
`/diffstat` answers a different question. **`checks:"unknown"` is now stale;
`mergeable:"unknown"` is correct and stays.**

### This may be the `pr_source=degraded` incident

[[a-degraded-scan-says-why]] measured a sweep that named nine open-PR branches as
orphans and attributed it to an HTTP 429. That diagnosis came from running
`bb pr list` **by hand** — which picks up whichever `bb` is first on PATH, and
that one fails on `--json` *regardless* of any rate limit.

Both faults produce "empty output, exit 0". **That plan should not be closed on
the 429 explanation without re-checking against a known-good binary.**


## Design

### Establish the CLI's capability, once, and say what was found

Before the first `bb` call that needs a flag, resolve the binary's version and
whether it carries the flags this adapter passes. Where it does not, **exit 3
with the reason** — the op failed, and that is not the same as an empty answer.

This is the discipline `plot-board-probe.sh` already encodes for auth: an
unrecognised output degrades to *cannot verify*, never to *fine*.

### Not chosen: pass `--json` and inspect the failure text

Tempting and cheaper. Rejected: `bb` writes its errors to **stdout**, so the
parse would have to distinguish an error message from data on the same stream —
the trap [[my-bitbucket-issues-are-in-the-inbox]] documents for `issue list`.
Asking the binary what it is costs one call and answers definitively.

### Not chosen: require a minimum `bb` and refuse below it

A hard floor would refuse a repo whose `bb` is old but adequate for the ops it
actually uses. The capability is per-flag, and the check should be too.

### The stderr must stop being discarded

`2>/dev/null` on a call whose failure mode is *silence* converts every error
into a wrong answer. The stderr is captured and reported, exactly as
[[a-degraded-scan-says-why]] concludes for the scan's own arms.

## Waves

### Checked (Branch: bug/the-adapter-checks-the-cli-it-got)

`plot-host.sh` establishes `bb`'s capability before relying on it, stops
discarding its stderr, and exits 3 with the reason where the CLI cannot do what
is being asked.

## Done when

1. **A `bb` without `--json` produces exit 3 and a named reason**, never an
   empty list. The measured case: craftamap 0.6.0 resolving as `bb`.
2. **A capable `bb` behaves exactly as today.** No new failure for the version
   the adapter was written against.
3. **The reason names the binary and its version**, so a reader can tell WHICH
   `bb` answered without running `which -a` themselves. Two unrelated tools
   share the name; a version number alone does not identify one.
4. **A segfaulting CLI is a failure, not an empty answer.** craftamap 0.6.0
   panics under a 429; a non-zero exit or a signal must not reach a consumer
   as `[]`.
4b. **The check is per-CAPABILITY, not per-version.** Quatico's `bb` went 1.0.0
   → 1.9.0 on this machine in one day and gained `checks` in the process, while
   craftamap's 0.6.0 numbers a different product entirely. A version floor
   cannot express "does this binary support the flag I am about to pass".
5. **The capability is established once per run**, not per call — five call
   sites must not become five probes.
6. `pnpm run validate`, `pnpm run test:reconcile` green.

## Approval

- **Assignee:** Jan Wloka

## Notes

### The first draft of this plan was wrong about the cause

It said homebrew's `bb` "shadows" the local one, as though an install had gone
wrong. It has not: `~/.local/bin/bb` is a **wrapper**, written deliberately, that
runs Quatico's `bb` from the plugin cache and documents craftamap's binary as a
fallback it keeps on purpose.

The correction matters because it changes the fix. A shadowing problem is solved
by fixing PATH — a one-machine, one-time repair. **Two tools sharing one name is
not solvable that way**, and Plot cannot control which one an adopter has. Only
asking works.

The same day sharpened the point: Quatico's `bb` went **1.0.0 → 1.9.0** here
(the plugin cache was 133 commits behind its marketplace) and gained `checks` in
the move. `plot-host.sh:494`'s *"50 at 1.0.0"* was measured correctly and is
still true — the cap survives in 1.9.0 — but the sentence attributes a fact to a
version number that names one of two unrelated products.

### `checks` is NOT free on Bitbucket

Worth recording where a sibling plan assumes otherwise:

> `checks` costs one extra API call per PR (build statuses are per-commit), so
> it is computed only when named.  — `bb pr list --help`, 1.9.0

On GitHub the rollup rides the same GraphQL response and is genuinely free.
On Bitbucket it is **N+1**, against a host that produced an account-wide 429
today. Any plan reaching for `checks` per PR on Bitbucket must budget for it —
see [[loose-checks-what-it-promises]].

<!-- CHALLENGE-THE-PLAN-METADATA
{
  "round": 1,
  "questionHistory": [
    {
      "q": "Two bb binaries found while measuring the page cap — separate plan or a note?",
      "a": "Separate plan: no answer at all is a different bug from a partial one",
      "category": "technical"
    }
  ],
  "deferredItems": [],
  "categoriesCovered": {
    "technical": { "stack": true, "architecture": true, "implementation": false },
    "domain": false,
    "ux": { "happyPath": false, "edgeCases": false, "errors": true, "accessibility": false },
    "nonFunctional": { "security": false, "performance": false, "scalability": false },
    "tradeOffs": true
  }
}
END-CHALLENGE-THE-PLAN-METADATA -->
