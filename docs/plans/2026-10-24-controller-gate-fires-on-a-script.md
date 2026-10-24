# Controller gate fires on a script name inside a commit message again

> The controller gate refuses a `git commit -m "…"` whose message text names a gated script, although the command runs no script — the shape `a-gate-matches-an-invocation` (#935) was written to stop.

## Status

- **State:** Approved
- **Type:** bug
- **Sprint:** follow-ups-2-28-3
- **Issue:** #2440
- **Review:** pr
- **Impl:** own branches
- **Approved:** 2026-10-24, Jan Wloka, plan-PR #2472 merged
- **Started:** 2026-10-24, Jan Wloka, `bug/controller-gate-fires-on-a-script`

## Changelog

- The controller gate no longer refuses a command that only names a gated script in quoted message text, an unquoted heredoc body, or the reason string of a receipt call. A real invocation of the script is still refused.

<!-- Board impact: none. A PreToolUse hook's matching rule in
     `packages/domain/src/rules/` and `plot-controller-gate.sh`. No plan format,
     no template, no layout. -->

## Motivation

Issue #2440 reports a Bash call that committed a plan edit and was refused with `plot-deliver.sh is a controller-owned action`. The command ran no deliver script. The name appeared only in the `git commit -m` text and in a receipt reason string. Removing the name let the same command through.

Measured 2026-10-24 against `plot-controller-gate.sh` on `origin/main` (84b1638e4), one command per row:

| command shape | gate |
|---|---|
| `git commit -m "plot-deliver.sh flipped only the Status block"` | refuses |
| `git commit -m 'plot-deliver.sh flipped only the Status block'` | refuses |
| `git commit -F - <<EOF` with the name in an unquoted body | refuses |
| `git commit -m "$(cat <<'EOF' … EOF)"` with the name in a single-quoted body | allows |
| `plot-state-receipt.sh --unowned-action deliver <slug> "plot-deliver.sh flipped …"` | refuses |

So the regression is a scope gap rather than a revert. `a-gate-matches-an-invocation` (Released 2.19.0) stripped only single-quoted heredoc bodies, and its plan left the other shapes refusing on purpose: *"an unquoted `<<EOF` body is still tokenised, since its contents can be substituted"*. Its measured cost, a caller who writes a vaguer commit message to get past the gate, recurs in the two shapes that remain: the `-m "…"` message and the receipt reason.

## Design

### Approach

`controllerInvocation` (`packages/domain/src/rules/ci-suite.ts:208`) reads every word of every segment, with comments and the data lists of a read-only `for` loop removed. `withoutQuotedHeredocs` (`controller-gate.ts:20`) strips single-quoted heredoc bodies before that reading. Nothing strips the quoted argument of a program that cannot run it.

The fix has to keep the property `a-gate-matches-an-invocation` pinned hardest: every command refused today because it runs a gated script is refused after. That plan's panel measured that matching on command position misses a loop body (`for s in a b; do plot-dispatch.sh $s; done`), so command position is not the answer here either.

Candidate rule, to settle in review: the argument of a known message-carrying flag is data when its program is a known data sink. The sinks are `git commit -m`/`--message`, and the reason argument of `plot-state-receipt.sh --unowned-action`. The quoted span is removed for those segments only. `sh -c '<script>'`, `bash <script>` and `xargs` keep their quoted text, because those run it.

An unquoted heredoc body feeding `git commit -F -` is the same data, and the same candidate rule would cover it. Its body can hold a `$( … )` substitution, so the strip must keep any body that contains one.

### Open Questions

- [ ] Is the allow-list of data sinks (`git commit -m/--message/-F -`, the receipt reason) closed enough, or does `gh pr create --body`, `gh issue create --body` and `git tag -m` need to join it? The #935 report found `gh issue create` already passes.
- [ ] Does an unquoted heredoc body containing no `$(` and no backtick count as data, and who decides that — the strip, or `controllerInvocation`?
- [ ] Where does the fix live? `withoutQuotedHeredocs` strips before the reading; a sink-aware strip could sit beside it in `controller-gate.ts`, or inside `controllerInvocation` where segments are already split.
- [ ] Does `plot-state-gate.sh` or `plot-phase-gate.sh` show the same shape? #935 left them out because neither was reported; check before widening.

## Slices

### Gate reads message text as data

- `bug/controller-gate-fires-on-a-script` → #2518 — strip the message argument of `git commit` and the reason argument of the receipt call before `controllerInvocation` reads a command, and pin the five shapes in Motivation plus the invocation corpus from `a-gate-matches-an-invocation` in `test/reconcile/controller-gate.test.mjs`

**Done when** the three refusing rows in Motivation pass, pinned by fixtures holding the reporter's own message. The single-quoted heredoc row keeps passing. Every invocation shape the #935 corpus held still refuses: a plain call, `./relative`, an absolute path, `bash <script>`, `sh -c '<script>'`, `env FOO=1 <script>`, `for`/`while`/`if` bodies, `{ }`, `( )`, `$( )`, `source`, `.`, `xargs` and `find -exec`. A commit whose message holds a `$( plot-deliver.sh … )` substitution still refuses. `pnpm run test:contracts` passes, and `node skills/plot/scripts/board/plot-local-checks.mjs` lists nothing unrun.

## Notes

- Reported in #2440 against the plot 2.27.1 hook and 2.28.0 scripts. The plan answers #935's *Expected* paragraph, which asked for quoted message text, heredoc bodies and arguments to other commands. #935 delivered the single-quoted heredoc case only.
- This plan's own commit message must avoid naming a gated script until the fix ships.
- Unattended run: the plan starts in Draft because the prompt carried no `Design:` answer. Review channel `pr` follows `Plan PRs: required`.
