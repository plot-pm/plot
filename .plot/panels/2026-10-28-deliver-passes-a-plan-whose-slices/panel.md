# Panel moderation: deliver-passes-a-plan-whose-slices, round 1

**Reconciliation:** unanimous `amend` (adopter, lifecycle, parser, testability). Every verdict passed `plot-panel.mjs check` on the first send.

## What each juror looked at

| Juror | Ran |
|---|---|
| adopter | the parser, the domain reader and a detector over this repo's 601 plans, ewz-kus-portal's 51 and the real 3853 plan; foreign slices in the proposed form |
| lifecycle | `plot-plan-meta.sh` on scratch plans; `crossRepoReferences` under Node 24; a scratch vitest against the real `deliverabilityOf` (3 assertions, all defects on main) |
| parser | the parser on fixtures of the issue's shape; three detector sweeps over 601 + 42 plans and the 3853 plan |
| testability | board-unit reproductions with no git and no host (`deliverable: true, merged: 1`); `crossRepoReferences` with #11 merged and #22, #33 open |

All four executed. The detector measurements and the board-unit reproductions carry the most weight.

## Where the jurors agree

1. **The refusal belongs in the domain, not in step 4b's prose.** The deliver script is a launcher; the decision is `deliverabilityOf` (`deliverability.ts:227,250,316`) → the domain `deliver()`, which also serves the board, `plot-ask.mjs deliverable` and fleet auto-deliver (`auto-deliver.ts:106,370`). A new refusal (`slices-unread`) must reach `deliver()` through `PlanRecord`, and the pulse must carry the fact or auto-deliver stalls in `inFlight` (`deliverable.ts:85-89`).
2. **The proposed authoring form fails the issue's own case.** `owner/repo@X` already means a commit in another repository (`skills/plot/SKILL.md:316,323`) and reads `cannot-tell` forever for a branch. `→ owner/repo#N` collapses when several repositories share one branch name — the 3853 plan uses one name in six: `crossRepoReferences` keeps the first reference (`cross-repo-reference.ts:49-53`), `branchesOf` merges by name (`deliverability.ts:74-85`), `plot-impl-status.sh:118,142` does the same. Reproduced: #11 merged, #22 and #33 open → `deliverable: true`. References must be keyed by (repository, branch) before the docs teach the form.
3. **The plan's board claim is false.** No code under `packages/*/src` reads any `unread_*` field and `schema.ts` declares none; the new field needs contract work and a `KNOWN_UNCARRIED` entry, or `plan-store.corpus.test.ts:229` fails.
4. **A second live case:** ewz-kus-portal plan 3819 is Approved and its `- Umsetzung: \`bug/…\`` line parses to zero branches; deliver prints "no branches found — proceeding".
5. **The `vnull` tag line names no branch**, so six of the seven lines are detectable, not seven.

## Where they differ: the detector

- parser: "`Branch` + a `<prefix>/name` token, or a backticked `<prefix>/name` lead before ` — `": 0 hits over this repo, 6 of 6 on 3853, 2 true hits on 3819.
- adopter: language-neutral — a bare token matching the configured branch prefixes in a non-claim list item of a slice section, code spans removed: 6 of 6 on ewz's foreign lines, 1 borderline hit in 601 plans. Keyword rules miss "Zweig", "branche", "siehe".
- testability: the keyword rule misses 3819's shape; prefix-only with `idea/` excluded: 2 hits here (prose in a Released plan), 2 on 3819.
- lifecycle: count every non-backtick list item in a slice section.
A trade between missed shapes (keyword) and false hits (prefix-anywhere). All agree a `<!-- deferred: -->` marker on an unread line must count as a person's explicit accept, which the parser honours today only on claim lines.

## Added by single jurors

- adopter: `crossRepoReferences` ignores the heading form `PR: owner/repo#N` that the shell reads; shell and domain disagree today — a separate bug.
- adopter: the reconcile finding must print the rewrite and say it blocks delivery; repositories with their own template never see a template change.
- testability: `check-shell-lines.sh` refuses shell growth; the parser slice must name the lines it removes.
- lifecycle: new open questions — how to defer an unread line, how to name a foreign branch before its PR exists, and whether `prs` flattening cross-repo numbers to bare integers misleads `releasePr`.

## Shared blind spot

All four judged detection and delivery. None measured how many Delivered or Released plans across ewz-kus-portal would now read as having unread slices, and what the reconcile scan says about plans already shipped.

## Amendments the panel asks for

- Slices: (1) the parser reports unread branch items, `PlanRecord` and the pulse carry them, reconcile lists them with the rewrite; (2) the domain refusal `slices-unread` in `deliver()`, honouring a deferred marker; (3) cross-repo references keyed by (repository, branch), read per line; (4) the authoring docs, after (3).
- Pick the detector; drop the `owner/repo@branch` form; correct the board claim and the "seven lines" count; name 3819 as a second case.
