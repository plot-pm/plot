# The adapter checks the CLI it got

> A `bb` too old for the flags Plot passes makes every Bitbucket PR read as
> *no PR* — silently, because the error goes to `/dev/null` and `jq` exits 0.

## Status

- **Phase:** Draft
- **Type:** bug
- **Sprint:** the-board-serves-an-enterprise-stack
- **Story:** the-board-is-blank-where-it-matters
- **Review:** in-session
- **Impl:** own branches
- **Rounds:** 1
- **Approved:** <!-- YYYY-MM-DD, who, channel -->
- **Started:** <!-- YYYY-MM-DD, who, `branch` -->
- **Delivered:** <!-- YYYY-MM-DD -->
- **Released:** <!-- YYYY-MM-DD, version -->

## Changelog

- `plot-host.sh` establishes that the `bb` on PATH supports the flags it is
  about to pass, and says so when it does not — instead of every Bitbucket PR
  list reading as an empty one.

## Motivation

### Measured 2026-08-26

This machine has **two** `bb` binaries, and the older one wins:

```
$ which -a bb
/opt/homebrew/bin/bb      ← bb version 0.6.0   NO --json flag
/opt/homebrew/bin/bb
/Users/jwloka/.local/bin/bb   ← bb 1.0.0       has --json
```

`plot-host.sh:509` calls:

```sh
bb pr list --state "$_s" --json | jq -c '...'
```

Against 0.6.0 that is:

```
$ bb pr list --state merged --json
Error: unknown flag: --json
```

The `2>/dev/null` swallows it, `jq` receives empty input and **exits 0**, and
the op returns nothing. So every Bitbucket PR list reads as *this repo has no
PRs* — a fabricated verdict, produced confidently.

### It is worse than a wrong answer: 0.6.0 panics

Under the rate limit that the same account was already hitting, 0.6.0 does not
merely fail:

```
$ bb pr list --state merged
:: An error occurred: 429 Too Many Requests
panic: runtime error: invalid memory address or nil pointer dereference
[signal SIGSEGV: segmentation violation]
```

A segfaulting CLI behind `2>/dev/null` is indistinguishable from a quiet one.

### Five call sites, and the scan has its own

`plot-host.sh` passes `--json` to `bb` in five places (`repo view`, `pr view`,
and three `pr list` forms). `plot-reconcile-scan.sh` calls `bb pr list --json`
**directly**, not through the adapter, so a fix in one does not reach the other
— the same split [[a-degraded-scan-says-why]] records.

### This is very likely the `pr_source=degraded` incident

[[a-degraded-scan-says-why]] measured a sweep that named nine open-PR branches
as orphans, and attributed it to an HTTP 429. That diagnosis was reached by
running `bb pr list` **by hand** and reading the 429 — but a hand-run picks up
whichever `bb` is first on PATH, which is 0.6.0, which fails on `--json`
*regardless* of the rate limit.

Both faults produce "empty output, exit 0". The incident may have been this one
all along, or both at once. **That plan should not be closed on the 429
explanation without re-checking against a known-good binary.**

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
   empty list. The measured case: 0.6.0 on PATH ahead of 1.0.0.
2. **A capable `bb` behaves exactly as today.** No new failure for the version
   the adapter was written against.
3. **The reason names the binary and its version**, so a reader can find the
   shadowing without running `which -a` themselves.
4. **A segfaulting CLI is a failure, not an empty answer.** 0.6.0 panics under a
   429; a non-zero exit or a signal must not reach a consumer as `[]`.
5. **The capability is established once per run**, not per call — five call
   sites must not become five probes.
6. `pnpm run validate`, `pnpm run test:reconcile` green.

## Notes

### The version constant was right; the binary in front of it was not

`plot-host.sh:494` says *"bb returns a fixed page (50 at 1.0.0)"*, and that was
measured correctly — against `~/.local/bin/bb`. Read on a machine where
homebrew's 0.6.0 shadows it, the comment describes a binary that is not being
run. Nothing in the code was wrong; the environment was.

That is why this is a capability check rather than a version bump: Plot cannot
control which `bb` an adopter has, only whether it notices.

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
