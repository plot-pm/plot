# Evidence lens — the-probe-asks-jenkins-by-its-slug

Position: amend

The central claim is TRUE and better established than the plan itself states. The amendments are about honesty of sourcing and two overstated sentences — not about the fix.

## 1. `jen -I <full-value>` vs `jen -I <slug>` — independently confirmed

The plan is right that it did not measure this. It says so once, in Notes: *"Reported from an adopting repository (`ewz/kus-portal`), not reproducible here"*. That is honest but buried — the Design section writes *"Reproduced by hand in the issue"* as if that were the plan's own measurement.

**Independent confirmation exists, and the plan cites none of it.** `jen --help` on this machine (`/Users/jwloka/.local/bin/jen`, read-only):

```
-I, --instance <val>   Jenkins instance (required; or set JENKINS_INSTANCE):
                       a slug (expands via the Quatico URL pattern) OR a full
                       host/URL — anything with a dot is used as-is
```

`-I` takes a slug **or a host/URL**, never `<slug>/<job/path>`. The disambiguation rule is *"anything with a dot"*. `ewz/kus-portal/continuous-build-multi` has no dot, so it is treated as a slug and expanded — which is exactly the nonsense hostname the issue prints: `https://jenkins-ci-ewz/kus-portal/continuous-build-multi.internal.quatico.dev`. The mechanism is confirmed from the CLI's own usage text, not from the reporter's word.

**Second independent witness, in this estate:** `plot-host.sh:1228` already splits before calling — `slug="${instance%%/*}"` then `auth_out=$(jen -I "$slug" auth status …)`. The contract is stated at `:1174` (*"The slug is what `jen -I` takes"*). So the convention is established in-repo and the probe is the one caller that breaks it. The plan mentions `plot-host.sh:702` for the contract but **does not cite `:1228`, the working implementation of the very fix it proposes** — the strongest evidence available, and it is left out.

**Amend:** cite `jen --help`'s `-I` line and `plot-host.sh:1228` in Design, and move the "not measured here, reported by the issue" disclosure out of Notes into the Design section where the claim is made.

## 2. "job is parsed correctly from the same value" — TRUE but it does NOT prove what the plan implies

Verified by running the two expansions on the reported value:

```
${v%%/*}  → ewz                              (slug — the half that is WRONG today)
${v#*/}   → kus-portal/continuous-build-multi (job — the half the probe gets right)
```

The reported `job` field matches `${v#*/}` exactly. So the JSON is consistent with the claim.

**But the plan's inference is loose.** `job` correct proves the *remainder* half works. The slug is the *other* half — `%%/*` — and `job` being right says nothing about it. They are computed by different expansions. The sentence *"One string, split for one field and passed whole to the call beside it"* is accurate as a description of the defect; *"job is parsed correctly … as proof the split works"* overreaches, because the probe's splitter does not currently produce a slug **at all**. It computes only the job remainder (`:384`). The slug is new code the slice must add.

This matters for the plan's own "Done when": **"One splitter in the file, producing both the `job` field and the slug the auth call uses"** describes work the existing splitter does not do. The hoist alone is insufficient — a `jen_slug` assignment must be added inside it. The plan reads as if hoisting were the whole change (*"Why the ordering is the whole change"*), and it is not.

**Amend:** say plainly that the slice adds a slug computation to the existing splitter; the hoist is necessary, not sufficient.

## 3. "a probe that cannot tell must report `unknown`, never `failed`" — the comment is real, and `failed` IS reachable without a real auth failure

The comment exists and is stronger than quoted. `:328-330`: *"No instance means the only runnable form is the one that verifies nothing. Report that we cannot tell, never that it is fine."* Also `:277-280`: *"the state degrades to `unknown` (cannot verify) rather than to `ok`."*

**The current code does NOT honour it on this path.** Reproduced the classify logic against the issue's verbatim output:

```
ARM=not-reachable -> failed
```

The `NOT reachable` pre-test at `:318-319` fires **before** `classify` and hardcodes `failed`. It bypasses the three-state discipline entirely. So `failed` is reachable for a reason that is not an auth failure at all — an unreachable *host*, which here is an unreachable host **because Plot composed a garbage hostname from its own unsplit value**. The plan's characterisation is correct, and the code inspection supports it more sharply than the plan argues.

Worth noting the plan's own guard is sound: it explicitly declines to change `classify` or the `OK` matching, correctly identifying the *input* as the defect.

## 4. Failure direction — the plan OVERSTATES the blast radius

Traced every consumer of `jen.auth` in `/plot-board-setup`. There is exactly one, step 4a (`SKILL.md:448`):

```
| `failed` | not authenticated — name the exact fix, e.g. `jen -I apps auth login` |
```

Eleven lines below, `SKILL.md:462`: **"Auth failure is never a hard stop."** Nothing gates, refuses, or blocks on it. `grep` for any refusal keyed on auth state returns only that one table row.

So the plan's Changelog claim — *"a false `failed` blocks a correct configuration from being written"* — is **not supported**. Nothing is blocked. What actually happens is what issue #968 states precisely and the plan does not quote: the operator is told to run `jen -I <full value> auth login`, **a command that cannot succeed**, because the slug it names resolves to no host. That is a real and specific harm — a misdirected repair instruction — and it is a better claim than the unsupported blocking one.

Separately: the key-writing refusal at `SKILL.md:453` keys on `jen.job` being `""`, **not** on `auth`. On the reported value `jen.job` is non-empty, so that refusal does not fire either. Confirms nothing blocks.

**Amend:** replace *"blocks a correct configuration from being written"* with the measurable harm — a printed repair command that cannot work. The plan's own Motivation already gets this right (*"a positive claim that the operator's credentials do not work"*); the Changelog contradicts it.

## 5. "The same shape as #969" — accurate, and one of the plan's better-supported lines

Read #969 directly. `plot-fleetctl.sh:89` resolves the supervisor artifact against the consumer's repo root; `plot-boardctl.sh:313` resolves the same class of artifact correctly through the probe. #969's own text: *"Two commands, two resolutions for the same question — and only one knows the plugin case."*

Map to #968: `plot-host.sh:1228` splits the instance correctly; `plot-board-probe.sh:316` does not. Same structure — a correct implementation exists in a sibling script, and one caller does not use it. Both filed 2026-09-24. This is not pattern-matching; the correspondence is concrete and verifiable in both directions.

Minor imprecision: the plan says *"a rule that exists and is correct, and a caller beside it that does not use it."* In #969 and in #968 the correct implementation is in a **different file**, not beside the caller. Cosmetic.

## 6. One more thing the plan gets right, on thin evidence

The Open Question — *"Do `plot-host.sh`'s `jen` invocations have the same defect?"* — is already answerable and the answer is **no**. `:1228` splits with `%%/*`, and every subsequent call (`:1250`, `:1268`, `:1321`) passes `$slug`. The plan could resolve this from the repo rather than deferring it to the slice. Not a defect in the plan — deferring is honest — but the question is cheap to close and closing it strengthens the "convention is established" argument.

Note the plan's comment at `:381-383` flags `plot-host.sh:3197` as carrying *the same latent bug* for the scheme-stripping case. That is a different defect (URL forms), correctly scoped out.

## Summary

The fix is right, the direction of failure is right, and the mechanism is confirmed independently of the reporter by `jen --help` and by `plot-host.sh:1228`. Three amendments, none structural:

1. Cite `jen --help`'s `-I` line and `plot-host.sh:1228`; move the not-measured-here disclosure into Design.
2. Drop the unsupported *"blocks a correct configuration from being written"*; state the real harm — a repair command that cannot succeed. Nothing blocks on `jen.auth`.
3. Say the slice **adds** a slug computation; the hoist alone does not produce one, so *"the ordering is the whole change"* is false as written.
