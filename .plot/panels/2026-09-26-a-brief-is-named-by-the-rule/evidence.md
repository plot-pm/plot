# Evidence lens — a-brief-is-named-by-the-rule

Position: amend
Evidence: executed

## 1. Is the defect real? Yes, and it is worse than the plan says.

**The count is wrong. Not twelve — twenty-five.**

```
git log --all --diff-filter=A --name-only --format='' -- '.plot/briefs/*' \
  | grep -E '^\.plot/briefs/(feature|bug|infra|docs|idea)-' | sort -u | wc -l
→ 25
```

Twenty-five misnamed briefs, across **twenty-one distinct commits**, from
2026-08-24 to 2026-09-26. By month: 7 in August, 18 in September. Against 527
briefs ever added, that is a 4.7% miss rate that has been **accelerating**.

**The plan cites two commits and names them as the writer.** They are two of
twenty-one. The full list:

```
5743a2851 2026-09-01  bug-a-test-teardown-does-not-call-rmsync
691399d72 2026-08-24  bug-a-wave-renders-as-a-wave-in-every-section
2f877bbb8 2026-08-24  bug-a-wave-row-names-its-wave
4e2f62807 2026-09-25  bug-a-wave-says-which-question-it-answered
40b34e87d 2026-09-25  bug-an-insertion-point-is-not-inside-a-comment
46652defe 2026-09-24  bug-fleet-control-resolves-beside-itself
4f30c71f1 2026-08-24  bug-the-agents-tab-filters-on-membership
90b2b16a1 2026-09-25  bug-the-approval-reads-why-the-host-said-nothing
8f73c2a91 2026-09-25  bug-the-installer-writes-a-path-that-runs
4d5990856 2026-08-28  bug-the-package-carries-its-scripts        ← via PR #501 merge
d8160452e 2026-09-24  bug-the-probe-asks-the-host-for-the-default
76f24e026 2026-09-24  bug-the-probe-splits-once
101d33ad0 2026-09-24  bug-the-readers-agree-about-an-item
60df5c958 2026-09-22  bug-the-reaper-reaches-a-free-desk         ← plan cites this
63bec2bc9 2026-09-25  bug-the-rollup-is-asked-of-open-prs-only
bc8a5dcf5 2026-09-22  bug-the-row-reads-the-process
84c4be39a 2026-09-24  bug-the-scan-reads-a-branch-s-own-plans
ed9eb5057 2026-09-24  bug-the-status-says-when-it-last-ticked
c34feeea2 2026-09-01  docs-a-machine-has-an-identity
24276fb18 2026-09-26  feature-a-card-sends-its-plan-to-the-jury
d15481b58 2026-09-24  feature-the-board-knows-who-is-asking
f1fabaf2a 2026-08-24  feature-the-cap-gates-auto-dispatch        ← plan cites this
e461208dc 2026-08-29  feature-the-domain-package-exists
f1fabaf2a 2026-08-24  feature-the-fleet-carries-the-sprints-members
362d85ad4 2026-09-01  feature-the-refusals-are-domain-rules
```

Author on all 25: `Jan Wloka` / `jan.wloka@quatico.com`, with `Co-Authored-By:
Claude`. **The plan's central claim survives: no script wrote these.** But the
commit subjects tell a sharper story than the plan does — fourteen of them say
`plot-implement:` or `plot: start`, i.e. they were written *during a Plot
lifecycle command*, not in freehand editing. That matters for §4.

**The 2026-09-26 incident is verified exactly as described.** `24276fb18`, 73
insertions, subject `plot: start feature/a-card-sends-its-plan-to-the-jury`,
on `origin/main`. The correctly-named counterpart
`.plot/briefs/a-card-sends-its-plan-to-the-jury.md` is now on main — so that
repair landed.

**The repair claim is correct for main today:**

```
git ls-tree origin/main .plot/briefs/ --name-only | grep -cE '/(feature|bug|infra|docs|idea)-'
→ 0        (of 517 briefs on main)
```

## 2. Does the proposed gate work? Yes. I built it and ran it.

I wrote a prototype mirroring `plot-state-gate.sh`'s reading — hook JSON on
stdin, act only on `git commit`, read `git diff --cached --name-status -M` —
and ran three cases in a scratch repo:

```
CASE 1  add .plot/briefs/another-good-one.md        → exit 0     (allowed)
CASE 2  add .plot/briefs/bug-the-thing-broke.md     → exit 2     (refused)
        "REFUSED: … Expected .plot/briefs/the-thing-broke.md"
CASE 3  git mv a-good-name.md → feature-a-good-name.md → exit 2  (refused)
        index reported: R100  a-good-name.md  feature-a-good-name.md
```

**PreToolUse sees a `git mv`.** The rename arrives in the staged index as
`R100 <old> <new>`; `-M` is what surfaces it, and the destination path is what
the check reads. The plan's "adds or renames" wording is mechanically
achievable — I proved it rather than assuming it.

**The gate is reachable because it reads the index, not the command string.**
`plot-state-gate.sh:57-63` takes `.tool_input.command` only to decide *is this
a commit*, then reads `git diff --cached`. Same route here. A name-shape check
needs nothing the two existing gates do not already have.

**It is not overbroad. Zero false positives, measured over the whole estate:**

| corpus | names matching `^(idea|feature|bug|docs|infra)-` |
|---|---|
| 517 briefs on `origin/main` | 0 |
| every plan slug in `docs/plans/` | 0 |
| every remote branch's last segment | 0 |
| remote branches with no prefix at all | 0 |

`Branch prefixes` reads `idea/, feature/, bug/, docs/, infra/` — confirmed via
`plot-config.sh get "Branch prefixes"`. Not one legitimate name in the estate
starts with a prefix word at all, let alone prefix-plus-dash. The plan's
"narrow test and deliberately so" is measured true.

**`plot-install-hooks.sh` reads the gate set from `hooks/hooks.json`** (`:104-132`,
basenames via `sed 's#.*/##'`), so the registration "Done when" item is
satisfied by adding the entry there. Confirmed the current file registers three
gates: phase, state, controller.

## 3. What a measurement contradicts

**(a) `test/reconcile/briefpath.test.mjs` does not exist and never has.**

The plan asserts it twice — Motivation ("`test/reconcile/briefpath.test.mjs`
asserts the two agree", "both implementations were right **and tested**") and
Notes ("The corpus test `briefpath.test.mjs` already proves the shell and
TypeScript agree"). `brief-path.ts:28-29` makes the same claim in its own
docstring. All three are false:

```
find . -name 'briefpath*' | grep -v node_modules   → (nothing)
git log --all --diff-filter=A --name-only | grep -i briefpath  → (nothing)
```

Never added in any commit on any branch. There is no corpus test either —
`packages/domain/corpus/` holds only `sprint-score.corpus.test.ts`.
`test/reconcile/dispatch.test.mjs` writes fixture briefs at hardcoded names
(`one.md`, `two.md`, `needs.md`) and exercises the shell's lookup; it never
compares against `briefPath`. **This is the plan's inherited false claim** — it
copied a docstring's assertion without opening the path the docstring names.
The two implementations *do* agree (`briefPath` splits on `/` and takes the
last; `plot-dispatch.sh:501` is `${1##*/}`) — I read both. But *nothing proves
it*, and the plan's Notes section sells the gate as "the third party neither
can reach", resting on a second party that was never built.

**(b) "No code wrote them" is true but incomplete, and the gap it hides is the
real finding.** I grepped every `briefPath` consumer:

```
auto-dispatch.ts:841   passes it to a prompt
brief-ask.ts:65        interpolates it INTO a prompt
continue.ts:268,462    names it in a hand-off brief's text
attention.ts:414       reads it
fleet.ts:6134          reads it
```

**Not one caller writes a brief file.** `brief-ask.ts:65` builds:

> `/plot-implement <slug> — write the hand-off brief for branch \`<branch>\` at
> <briefPath(branch)>, then commit and push it to <main>.`

So the writer is *an LLM session, handed the correct path in its prompt, which
then writes the file wherever it likes*. That is not "a master agent guessing
the filename from the branch" as a lapse — it is the **only** write route the
system has. Fourteen of the twenty-five misnamed commits carry
`plot-implement:` or `plot: start` subjects, i.e. they happened inside that
very flow. The plan frames this as an unguarded hand; the measurement says it
is an unguarded *architecture* — the one place that computes the name is a
string in a prompt.

**(c) "It does not repair existing files. That was done" — true for main, and
the 25 stale blobs still exist in history and on live branches.**
`origin/feature/a-card-sends-its-plan-to-the-jury` still carries
`feature-a-card-sends-its-plan-to-the-jury.md`. Harmless (the gate only sees
new commits) but the plan's flat "the repair is done" overstates it, and a
future merge of such a branch would re-introduce a misnamed file into main —
which the gate *would* catch on the merge commit only if the merge is staged
locally, not on a host-side squash.

## 4. What the plan must say before someone builds it

1. **Correct the count to 25 across 21 commits, spanning 2026-08-24 to
   2026-09-26**, and state the 7-in-August / 18-in-September trend. A plan
   citing 12 and two commits understates a recurring, accelerating defect as an
   incident, and the "measured 2026-09-26" framing hides that it has fired
   nineteen times since the first one.
2. **Delete every claim that `briefpath.test.mjs` exists** — Motivation, Notes,
   and the "and are tested" in *What this does NOT do*. Replace with: the two
   implementations agree on inspection and **nothing asserts it**. Then either
   add that test to this slice's scope or file it. The docstring at
   `brief-path.ts:28-29` also needs the same correction; leaving it is how this
   plan came to repeat it.
3. **Name the actual writer: a prompt.** `brief-ask.ts:65` and
   `auto-dispatch.ts:841` hand the computed path to an LLM session that owns
   the write. Say so, because it changes what the gate is: not a backstop
   against careless hands, but the **only** verification of an
   LLM-string-copies-path contract. That strengthens the case for the gate and
   should be the Motivation's spine.
4. **Decide the merge case.** A `git mv` is caught (proved), an added file is
   caught (proved), but the 25 stale blobs live on remote branches. State
   whether a merge bringing one back is in scope, and that a host-side squash
   merge is outside any local gate's reach.
5. **Add the installer's prober.** `plot-install-hooks.sh:315-321` maps each
   gate basename to a `probe_*` function and `:322-331` to an "unprobeable
   reason". A new gate with neither reports `unprobeable — no self-contained
   guarded condition is known for it here`. This gate *is* self-contained (my
   three cases ran in a scratch repo with no remote), so it should ship a
   `probe_brief_name_gate`. The "Done when" item about `plot-install-hooks.sh`
   currently only asks for registration.
6. **Resolve the "Open" section.** It asks whether the refusal should offer the
   correct name. It should, and it is free: my prototype computes it by
   stripping the prefix, and `plot-state-gate.sh`'s own precedent is naming the
   exact route. Leaving this open invites the wording drift the estate keeps
   fixing.

## 5. Through the evidence lens: what executing revealed

Reading would have accepted this plan. Three things only running found:

- **The count is off by a factor of two**, and the shape of the defect changes
  with it: not an incident with a repair, a nineteen-times-since recurrence.
- **The test the plan rests on, and the docstring it quotes, name a file that
  has never existed in this repository's history.** Both halves of the plan's
  "both implementations were right and tested" — the rightness I could verify by
  reading; the testedness is invented. The plan's own thesis is that authors
  "assert mechanisms without opening the file", and it does exactly that to its
  own supporting evidence.
- **The gate works, and I can say so because I built it and got exit 2 on the
  rename.** That is the plan's strongest part and it was stated as a design
  intention; now it is a measurement, including the `R100` index line that
  proves PreToolUse sees a `git mv`.

**One incidental measurement, worth recording:** while running these checks,
`plot-controller-gate.sh` refused a read-only `sed -n` command because the
*string* `plot-dispatch.sh` appeared in it. That gate matches on the command
text, where the state gate matches on the index — a contrast the new gate's
author should note, since matching on text is what produced that false
refusal.

**Position: amend.** The gate is the right mechanism, it is reachable, it is
narrow, and I proved all three. The plan cannot be built as written because its
Motivation misstates the scale by 2× and cites a test that does not exist, and
because the real writer is a prompt rather than a hand — which the
implementation brief needs in order to know what it is protecting.
