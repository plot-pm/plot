# Evidence lens — a parsed plan joins the index

Position: amend
Evidence: executed

Every number below was re-measured on this machine, this estate, today. The
plan's symptom is real. Its stated mechanism is false by roughly two orders of
magnitude, and the remedy it proposes shipped in August.

## 1. The central claim is false: the estate already parses in ONE spawn

The plan's premise is `349 plans × ~93 ms = ~32 s of parsing per pass`. Measured:

```
350 plans, ONE invocation          0.37 s / 0.52 s / 0.74 s   (3 runs, 350 JSON lines emitted)
 30 plans, ONE invocation          0.115 s
 30 plans, 30 separate invocations 2.874 s      → 96 ms each
```

The 93 ms figure is reproducible **only** when the parser is invoked once per
file. Its own docstring line 17 says *"Accepts many files in one invocation and
parses them in a single awk pass"*. Batched, the whole corpus is **0.4 s**.

**And the scan already batches.** I instrumented `plot-plan-meta.sh` inside a
throwaway worktree and ran a real `--offline` scan:

```
SCAN TOTAL:  23.20 s
parser spawns: 1   args=355   secs=0.395
```

**One spawn. 0.40 s. 1.7 % of the scan.** `plot-fleet-scan.sh:3104` is headed
`ONE PARSE FOR THE WHOLE ESTATE`, and `:2874` already records the identical
finding — *"`plot-plan-meta.sh` TAKES A LIST and always did … one plan 0.01 s,
ALL plans 0.19 s in a single invocation — roughly 300× cheaper"*. `:2915`
`parse_plan_estate()` is called at `:3088` and `:3238` and nowhere else.

`docs/plans/2026-08-27-the-scan-parses-its-plans-once.md` is **Released**. It
delivered precisely this plan's remedy — stop re-invoking the parser per plan —
on 2026-08-28.

**So the 32 s this plan exists to remove does not exist.** A cache saving 0.40 s
of a 23 s scan cannot bring it inside 90 s, which is Done-when item 6.

## 2. Where the time actually goes — none of it is the plan's subject

Same scan, every interpreter wrapped and counted:

```
parser spawns     1     0.40 s
python3 spawns    1     0.36 s
git invocations  79
awk spawns      377            (3.1 ms startup each ≈ 1.2 s)
grep              63
sed               10
node               1
                       ─────────
total spawns     529   ≈ 2 s of startup against a 21–28 s scan
```

Three `--offline` runs: **21.01 s, 23.78 s, 28.19 s**. Roughly 19 s is
unaccounted for by any subprocess — it is the scan's own bash. The plan targets
1.7 % and its Done-when promises the 90 s bound.

The scan reports `plans=28`, not 349: `delivered_in_window` already discards the
archive. The plan concedes it does not remove that filter — but then its own
"337 re-derived answers" arithmetic is counting plans the scan never walks.

**Precedent, same estate:** `2026-08-20-the-timeout-report-blames-the-wrong-thing.md`
(Released) — a 90 s timeout blamed on worktree count; 26 of 37 pruned, scan
unchanged, the promised number *rose 33 %*. Its Approved line reads *"falsified
by acting on it"*. This plan repeats that shape: correct symptom, unmeasured
mechanism.

## 3. The load-bearing risk is REAL and the plan understates it

The plan asks whether the parse is a pure function of the file's bytes. **It is
not.** I proved it twice, identical bytes both times:

```
plan body: "- **Issue:** PROJ-123"

--tracker ''                 → issues: []
--tracker 'jira https://x'   → issues: ['PROJ-123']
--tracker 'linear'           → issues: ['PROJ-123']
```

And through the real config path, no flag:

```
no CLAUDE.md in cwd                          → issues: []
CLAUDE.md with "Tracker: jira https://…"     → issues: ['PROJ-123']
```

Mechanism, read rather than guessed: `plot-plan-meta.sh:307` shells to
`plot-config.sh get Tracker`; `:316-319` maps `jira|linear` → `parse_key_issues=1`;
that is passed to awk at `:321` as `PARSE_KEY_ISSUES` and gates the
`[A-Z][A-Z0-9]*-[0-9]+` extraction at `:516-521`. The file's own comment at `:302`
announces it: **"THIS IS THE FIRST CONFIGURATION DEPENDENCY THIS SCRIPT HAS"**.

**It is worse than a config key.** `plot-config.sh:177` resolves the config via
`git rev-parse --show-toplevel` — the **caller's cwd**. So one blob SHA maps to
different parse results depending on which worktree the parser runs in, and Plot
runs it from dispatch desks routinely. A SHA-only key is wrong for the field
`issues[]`, and `issues[]` is what `plot-reconcile-scan.sh` §23 gates on.

This does not fire on this estate today (`Tracker` is empty → GitHub → `0`), so
a cache built and tested here would pass every gate and corrupt the first
adopting repo that declares Jira or Linear. The plan calls this "exactly the
shape that breaks the property" and still keys slice 2 on the blob SHA alone.

## 4. Smaller numbers that are wrong

- **`git ls-files -s` is 0–50 ms, not 134 ms.** Five runs: `0.05, 0.00, 0.00, 0.00, 0.00`.
  Harmless — the key is cheaper than claimed.
- **Bare `bash -c true` is 42 ms, not 26 ms** (20 runs, 0.843 s).
- **Cost DOES vary with file size**, contradicting "the cost is per invocation,
  not per plan": 40-line plan **65 ms**, 1119-line plan **194 ms** (5 runs each).
  The plan's two-sample inversion (165→198 ms, 268→156 ms) is startup noise at
  n=1; the parser is ~3× slower on the largest file than the smallest.
- **350 plans, not 349.**
- **`318 of 319` is now `319 of 319`.** I parsed all 319 resolved `delivered/`
  links: **zero** not in `{Delivered, Released}`. The named exception,
  `the-ci-key-carries-its-instance`, reads `Phase: Released` — not an empty
  `State:`. The plan's own "wrong oracle" evidence has evaporated.
- **`bash -x` trace is 27 lines** (plan says 26) — accurate.
- **`all 99 active/ links also appear in delivered/` — CONFIRMED**, 99 both, 0 active-only.
- `FLEET_SCAN_BUDGET_MS = 90_000` (`fleet.ts:1083`) and the
  `A DERIVATION, NEVER A RECORD` rule (`fleet.ts:2173`) — both cited accurately.

## 5. `PrIndexStore` is not reusable for this subject

`ports/pr-index.ts` is typed `read(connector: string): Promise<PortResult<PrIndex | null>>`
and `write(connector: string, index: PrIndex)`. `entities/pr-index.ts:96` holds
`rows: z.array(PrIndexRowSchema)` **"keyed by PR number"**, whose row carries
`number, head, state, draft, checks, review, url, mergeable, failing_checks`.
Nothing is generic over subject; the parameter is a *connector*, a remote-service
concept a plan file does not have. Its docstring's reason for existing —
*"`Host` is a CONNECTOR … every one of its operations spends a remote budget"* —
does not transfer to a local parse.

So "the same shape for a different subject" is false as written. Reuse means
extracting a generic keyed store first, which the plan neither scopes nor slices.

## What the plan must say before anyone builds it

1. **Re-measure with the parser batched, and state the batched figure.** The
   32 s premise must be withdrawn: the scan spawns the parser once, for 0.40 s.
2. **Name the real 19 s.** 529 spawns account for ~2 s of a 21–28 s scan. Until
   the remainder is attributed, no plan can promise the 90 s bound — and this
   one's Done-when item 6 does.
3. **Say what `the-scan-parses-its-plans-once` (Released) left undone**, or drop
   the plan. Right now it re-proposes a shipped fix.
4. **Fix the key or drop the cache.** `Tracker` changes `issues[]`, and
   `plot-config.sh` reads it from the caller's cwd. Either key on
   `(blob SHA, tracker scheme)`, or make the parse pure by requiring `--tracker`
   from the caller. Slice 1 must state which — "establish whether" is already
   answered: it is impure, measured twice.
5. **Withdraw the `delivered/` evidence.** 319 of 319 agree today.
6. **Drop the `PrIndexStore` precedent or rescope it.** It is keyed by PR number
   over connector-shaped rows.

If 3 has no answer, this is a **reject**. I say amend because finding 3 is a
genuine latent defect worth its own plan — *the parse is not a pure function of
the file's bytes, and a Jira estate parses differently from a GitHub one* — which
is real, currently undetectable on this estate, and nothing to do with caching.

## What executing revealed that reading would not

Reading the plan, the 93 ms/plan figure is credible and internally consistent —
it is even reproducible. Only running the parser **both ways** exposes that it
measures a call pattern the scan abandoned in August; and only instrumenting a
live scan shows one spawn where the plan assumes 349. Likewise, the purity
question reads as a risk to investigate; executing it with two config values
settles it as a defect in four seconds. And profiling — rather than trusting the
`Last scan failed` banner — shows the 90 s bound is missed by something that
spawns nothing, so every subprocess-cache plan aimed at it is aimed wrong.

Repository left exactly as found: scratch worktree removed, `git worktree prune`
run, `git status --porcelain` empty, all pre-existing worktrees untouched.
