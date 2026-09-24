## Implementation brief — a-broken-caller-is-not-a-hedging-juror

- **Plan (canonical):** `docs/plans/2026-09-24-a-broken-caller-is-not-a-hedging-juror.md` on `main`
- **Approved:** 2026-09-24, in-session review after panel (round 1) — panel moderation at `.plot/panels/2026-09-24-a-broken-caller-is-not-a-hedging-juror/panel.md`
- **Issue:** #965
- **Branch:** `bug/the-check-refuses-an-unusable-vocabulary` (base: `main`)
- **Ends as:** one PR to `main`, opened with `skills/plot/scripts/plot-open-pr.sh`
- **Review of the code:** per repo convention — PR review, CI green

The plan has one slice. Nothing waits on this branch and it waits on nothing.

### What to build

`plot-panel.mjs check <label> <positions> <lens>` splits `<positions>` on `,` and never asks whether the result is a vocabulary. Re-measured at dispatch against the shipped bundle, one verdict file reading `Position: amend`:

```
check Position 'proceed|amend|reject'   j  → rc=3  uncommitted  'amend' is not one of proceed|amend|reject
check Position 'proceed,amend,reject'   j  → rc=0  committed    amend
check Position 'proceed, amend, reject' j  → rc=3  uncommitted  'amend' is not one of proceed,  amend,  reject
```

Exit 3 means *the juror hedged*, and `/plot-panel` step 4 re-asks a refused juror. So a broken argument makes the skill re-ask jurors that committed correctly, and the re-ask fails identically.

The fix is argument validation in the `check` branch of `run()` in `packages/board/src/server/entry/panel.ts` (line 131–139), **before** the `Commitment` is built at `:139`. An unusable vocabulary exits `EXIT.usage` (2), which the file already documents as *"a broken caller, not a hedging juror"* (`:44`) — the contract exists and is simply not reached.

The plan is canonical; this brief is orientation.

### Decisions the plan settles — do not re-derive them

**The whitespace form is the case that matters, not the pipe form.** `"proceed, amend, reject"` splits into `['proceed', ' amend', ' reject']`. A juror writing `proceed` commits; a juror writing `amend` is refused. That produces a **divided panel manufactured by a typo**, which `reconcile` reports as a real disagreement. The pipe form fails every juror loudly and is recognisable; the whitespace form is silent and partial. Both panel jurors found it independently; the plan's first draft missed it. A fix that handles only `<2 positions` and `|` passes the pipe tests and ships this regression.

**Trim-and-accept is rejected.** The estate juror proposed trimming; the moderator rejected trimming *alone*, because it accepts the typo silently and changes behaviour invisibly. The rule is: **a position that is not already trimmed is refused** with exit 2, and the message names the repair. Whitespace inside a position is never meaningful — it is caller-supplied text.

**Pipes are not accepted as a second separator.** Two separators make the parse ambiguous to save one error message. The comma stays the one separator. The contracts juror checked this: a position can never contain a comma, while a `|` inside one parses today — so the comma is the separator that cannot collide.

**Three refusals, all exit 2, all before any juror is read:**

1. fewer than two positions — a one-option commitment is not a commitment (this is also what `'proceed|amend|reject'` yields: one element);
2. a position containing `|` — name the separator and show the comma form;
3. a position with leading or trailing whitespace — name it and show the trimmed comma form.

Pick the message wording so that a caller can copy the fix straight out of it. An empty element (`"a,,b"`, trailing comma) is the same class of broken caller — refuse it too rather than let `''` become a position; the plan does not name it, so state it in the PR body.

**Out of scope, by the plan's explicit decision:**

- `commitmentLine` (`packages/domain/src/rules/panel.ts:90`) keeps rendering `<a|b|c>`. It is the conventional choice notation in a message a human reads. Do not change it.
- Exit 3 for a genuine hedge is unchanged.
- `readJuror`, `readPanel`, `reconcile` are untouched. `reconcile` takes no positions argument.

**Carried-over rules this entry already keeps:** exit 3 is reserved for a juror's refusal and must never mean anything about the caller (`:141`); exit 1 is what a shell reads as a broken pipe and is not used; the entry reads stdin and opens no file. A usage refusal writes to **stderr** and prints **no** reading line on stdout — the Done-when says *"reports no juror"*, so assert stdout is empty.

### Done when

The plan's `## Done when` list is the specification. The assertions a naive implementation would pass without:

- **The partial-commit regression, asserted as partial.** Two verdict files (`Position: proceed` and `Position: amend`) checked against `"proceed, amend, reject"` must give **the same exit code, 2, for both**. Testing only the `amend` file passes a fix that trims silently; testing only `proceed` passes the unfixed code. The pair is the test.
- **`'proceed|amend|reject'` exits 2, not 3**, and stdout is empty — a fix that only improves the stderr message still exits 3 and the skill still re-asks.
- **A single word (`'proceed'`) exits 2.**
- **The comma path is unchanged, including a real hedge**: `proceed,amend,reject` with `Position: amend` → 0 and `committed\tj\tamend`; the same vocabulary with a file lacking the line, or carrying a word outside it → 3. Without this a validation that refuses too much passes every new test.
- **The usage line shows the comma form**, so the message a broken caller reads contains the fix (`:135` already does for missing args — the new refusals must as well).

Put the tests in a new `packages/board/test/unit/panel-entry.test.ts` (vitest), importing `run` from `../../src/server/entry/panel.js` the way `test/unit/sprint-transition.test.ts` imports its entry. `run` takes `write` as a parameter; capture `process.stderr.write` with `vi.spyOn` for the message assertions. The entry has **no test file today** — this is its first.

Plus the repo gates:

- `nvm use` (Node 24), then `pnpm test`, `pnpm run test:board`, `pnpm run typecheck`. Do not run `test:e2e` locally.
- **Rebuild the shipped artifact**: `pnpm build:board` regenerates `skills/plot/scripts/board/plot-panel.mjs` from `packages/board/build.mjs:314-323`. Commit it; CI's no-diff gate fails a stale bundle. Then re-run the three commands under *What to build* against the rebuilt bundle and paste the results in the PR body.
- A changeset: `'@plot-pm/board': patch`, description first, `plan: docs/plans/2026-09-24-a-broken-caller-is-not-a-hedging-juror.md` inside the trailing comment block. Run `./scripts/check-changeset-packages.sh`.

### Bookkeeping

- Push the first real commit as soon as it exists.
- Open the PR with `skills/plot/scripts/plot-open-pr.sh` (use `--draft` while it moves). Do **not** run `gh pr create`.
- When the PR exists, append `→ #<number>` to this branch's line under `## Slices` in the plan on `main`, and reference `#965` in the PR body.

### Scope guard

This branch owns:

- `packages/board/src/server/entry/panel.ts` — the `check` branch of `run()` and the usage text
- `packages/board/test/unit/panel-entry.test.ts` — new
- `skills/plot/scripts/board/plot-panel.mjs` — rebuilt artifact
- `skills/plot/scripts/board/board-server.mjs` — only if `pnpm build:board` rewrites it
- one `.changeset/*.md`

Not this branch: `packages/domain/src/rules/panel.ts`, `skills/plot-panel/SKILL.md`.

Branches in flight at dispatch (2026-09-24), verified by diff against `origin/main`: `bug/the-index-is-read-once`, `feature/one-monitor-watches-the-slice`, `feature/the-domain-knows-a-round`. **None touches any panel file.**

Two findings for the PR body, not for this branch:

- `skills/plot-panel/SKILL.md:86` writes the Draft vocabulary as `proceed|amend|reject` and never shows how `$POSITIONS` is assigned, so the skill teaches the pipe form as well as the tool. After this slice a caller who copies it gets exit 2 with the repair named, which is correct; the prose itself is a follow-up.
- `readJuror`'s own refusal (`rules/panel.ts:158`) joins positions with `', '`, so its message shows the whitespace form. After this slice that copy also exits 2 with the repair named.

If you find something the plan did not anticipate, report it rather than improvising outside scope.
