# --loose checks what it promises

> `--loose` opens the next wave on work that is pushed but not merged, promising the prior wave's PRs are "green and ready". It verifies not-draft and never looks at the checks — the exact red-CI case its own comment says was fixed.

## Status

- **Phase:** Draft
- **Type:** bug
- **Sprint:** <!-- optional -->
- **Issue:** <!-- optional -->
- **Story:** <!-- optional -->
- **Review:** in-session
- **Impl:** own branches

## Changelog

- `--loose` now verifies that a prior wave's PRs are actually green before opening the next wave, instead of accepting any non-draft PR regardless of its build.

<!-- Board impact: none directly — --loose is off by default and the board uses
     the strict path. Touches skills/plot/scripts/plot-fleet-scan.sh only. -->

## Motivation

`--loose` lets a prior wave count as satisfied by **pushed** rather than merged
work, buying throughput at the cost of rebase risk. Its own comment states the
danger it exists to prevent, in `plot-fleet-scan.sh`:

> `--loose` promises *"the prior wave's PRs are green and ready"*, which needs the
> git host. An earlier version accepted ANY pushed commit — strictly weaker than
> promised, and dangerous: **red CI** or a draft PR would open the next wave, so
> it built on a seam that was not merely unlanded but possibly broken.
>
> Readiness must be VERIFIED, never assumed.

The verification is `pr_ready` (line 1540):

```sh
pr_ready() {
  local br="$1" js
  js=$("$script_dir/plot-host.sh" pr-state "$br" </dev/null 2>/dev/null) || return 1
  printf '%s' "$js" | grep -q '"state":"OPEN"' || return 1
  printf '%s' "$js" | grep -q '"draft":false'
}
```

**It checks open-and-not-draft. It never looks at the checks.**

So a PR with a **failing build** satisfies `pr_ready` and opens the next wave —
precisely the red-CI case the comment above says was fixed. Two halves of one
promise, and only the draft half is implemented.

**Why it is not merely a stale comment.** The comment is not describing an
aspiration; it is describing the fix that motivated `pr_ready`'s existence. The
function was added *because* accepting any pushed commit was dangerous, and it
addressed one of the two named dangers.

### Why `pr-state` cannot answer it

`plot-host.sh pr-state` returns `{number, state, draft, url}` — no check rollup at
all. The rollup lives in `pr-list --rich`, whose own comment records it as free:

> `failing_checks` is WHICH checks failed, by name — the same payload `checks`
> collapses to one word … **Free: same GraphQL response, same call, no extra
> request.**

So `pr_ready` is asking the one host operation that structurally cannot answer.

### Severity is bounded, and stated so it is not overstated

`--loose` is **opt-in and off by default**. The strict path — where only a
`merged` branch settles a wave — is untouched and is the only one the board uses.
Nothing on the live board is wrong because of this.

What is wrong is that the flag's documented promise is not its behaviour, and a
reader trusting the comment gets the weaker guarantee. That is worth fixing while
the flag has few users rather than after it has many.

## Design

### The fix: ask the operation that carries the rollup

The scan already calls `pr-list` **once** for the whole repo, in
`prefill_pr_states`:

```sh
js=$("$script_dir/plot-host.sh" pr-list --state all --limit "$PR_LIST_LIMIT")
```

**Without `--rich`.** Adding it returns `checks` and `mergeable` per PR from the
same GraphQL response — no extra request, by `plot-host.sh`'s own measurement —
and `pr_ready` becomes a lookup in a cache the scan already builds rather than a
per-branch host call.

That is strictly cheaper than today: `pr_ready` currently issues **one
`pr-state` per branch** on the `--loose` path, which is the N+1 shape #228 was
filed about, in the one place it survives.

### What counts as green

The rollup's vocabulary is `green · pending · failing · none · unknown`.
`--loose` should accept **only `green`**, and the four rejections each have a
different reason:

| rollup | accept? | why |
|---|---|---|
| `green` | **yes** | the promise, met |
| `failing` | no | the red-CI case this exists to prevent |
| `pending` | no | *not yet* is not *ready* — the seam is unproven |
| `none` | no | no checks ran; nothing was verified |
| `unknown` | no | the host could not say — **absent is not false** |

**`pending` and `unknown` are the ones a weaker implementation gets wrong**, and
both must reject. `--loose` degrades to strict when readiness cannot be
established, which is the rule the surrounding code already follows: *an
unverifiable claim of readiness is not readiness*.

### Overlaps `the-scan-asks-once-per-pulse-not-once-per-branch`

That plan removes the scan's per-branch host calls, and `pr_ready` is one of the
two call sites it names — so **both plans rewrite this function**, from
different motives:

- **This plan changes the PREDICATE** — accept only a `green` rollup, which is
  why `pr-list --rich` is needed at all.
- **That plan changes the SOURCE** — read from the cache `prefill_pr_states`
  already fills, so no host call is made per branch.

They compose: the source change does not decide what counts as ready, and the
predicate change does not decide where the data comes from. Whichever lands
first, the other rebases onto it. **If this plan lands first, its `pr-list
--rich` read already removes the per-branch call**, and that plan's `pr_ready`
work becomes a verification rather than an edit.

Recorded on both sides so the collision is known at dispatch time.

### Not chosen: relax the comment instead

The cheaper fix is to stop promising green. Rejected: the promise is the reason
the flag is safe to offer at all. A `--loose` that opens the next wave on a red
PR builds on a seam known to be broken, and the plan that introduced it accepted
rebase risk, not breakage risk.

### Open Questions

- [ ] Bitbucket reports `checks: "unknown"` unconditionally — `bb pr list`
      carries no rollup. So `--loose` on Bitbucket will always degrade to strict
      under this rule. That is the honest outcome and matches the adapter's
      existing stance, but it means the flag becomes a no-op there and should
      probably **say so** rather than silently doing nothing.

## Done when

- A prior wave whose PR has a **failing** rollup does **not** open the next wave
  under `--loose`. This is the defect; assert it directly with a stubbed host.
- `pending`, `none` and `unknown` also do not open it — asserted separately, since
  an implementation accepting anything-not-failing passes the test above and
  reintroduces the weaker guarantee.
- A **green** PR still opens it — `--loose` must keep working where it was right.
- `--loose` issues **no per-branch host call**: the rollup comes from the single
  `pr-list --rich` the scan already makes. Asserted by counting host invocations
  with a PATH-stubbed CLI, the technique #228 used.
- Strict mode is byte-identical — no behaviour change off the flag.
- The comment and the code agree; whichever is edited, they say the same thing.
- `pnpm test` and `pnpm run test:e2e` green.

## Branches

### Verified

- `bug/loose-checks-the-rollup` — `pr_ready` reads the check rollup from the scan's existing `pr-list` call and accepts only `green`; `--loose` degrades to strict wherever the rollup cannot be had

## Notes

Found 2026-08-23 while tracing *how does build status affect wave and plan
status* through the model. The answer is that it affects neither — the verdict
reads branch state and never a check result — and `--loose` is the single place
in Plot where a build result was ever meant to change a wave's verdict.

So this is not a gap in the model; it is the one edge the model has, and it does
not do what it says.

The bounded severity is recorded deliberately: nothing on the live board is
wrong today, and a plan that overstated this would earn a fix aimed at a problem
nobody has.
