# Panel — who-may-approve-a-release-and, round 1

Plan: `docs/plans/2026-11-03-who-may-approve-a-release-and.md` (PR #3078, issue #3077). Jurors: layering, safety, seams, testability. Code references verified against `origin/main` at `f10abe5a4`; `packages/` is unchanged since `a518552f1`.

## Positions

| Juror | Position |
|---|---|
| layering | amend |
| safety | amend |
| seams | amend |
| testability | amend |

Unanimous `amend`. No juror proposed `reject`, and no juror found the plan's three defects false.

## Agreement

- All four found that the reviewer already loads `.plot/charters/reviewer.json` from the main checkout (`review.ts:333-336`, `:586-589`), which the plan did not name. Verified.
- layering, testability and safety found the caller expression at more sites than the plan named; layering and testability count eight entrances in two spellings, including `main.ts:156`, the site that actually sets the `release-approve` caller. Verified: seven `PLOT_UNATTENDED` ternaries plus `release-gate.ts:191`.
- layering and safety found the controller gate does not gate `release-approve` (`ci-suite.ts:247`) and allows every linked-worktree call (`gate.ts:981`). Verified.
- safety and seams found that `roleCommand` drops the reviewer's read-only flags (`--tools`, `--disallowedTools`, `--permission-mode dontAsk`, `--strict-mcp-config`, `--add-dir`). Verified.
- layering, safety and seams found that the consumed `.changeset/*.md` files are gone from `origin/<default>` after the release merge. Verified: `origin/main:.changeset/` holds no changeset.

## Disagreements

- **The source of the shipped `plan:` lines.** seams proposed the tag's section of `CHANGELOG.md`; layering and safety proposed the `.changeset/*.md` paths the release merge removed, read at the merge's first parent. The person decided for the removed paths: they hold the `plan:` line in the reader's own format and need no second parser over generated text.
- **A per-board token.** layering amendment 1(b) proposed a token checked in the HTTP controller; safety F2 showed any local process reads it from `GET /` and cited `controllers/caller.ts:24-27`. The person decided against the token and for a user-verified passkey assertion.
- **A `CLAUDECODE` reading.** testability named it as a candidate; layering showed that a board an agent starts inherits it, which inverts the #2918 defect. The plan uses neither: the gate reads the hook, and the release reads the passkey.
- **A new `Caller` value.** layering amendment 3 allowed an `agent` value with an answer in every workflow. The plan keeps `Caller` at three values and adds a `personProof` reading to `releaseApprove` only, so no other workflow changes.

## Decisions by the person (jwloka)

1. A person is proven for a release by the controller gate refusing agent tool calls (before `gate.ts:981`, no receipt escape) and by a passkey assertion verified on the board before `release-approve` runs, with the credential id in the receipt. The per-board token is dropped. One pure `callerOf` serves all eight entrances. `continue.ts:184` is a follow-up. `plot-ask merge` keeps its caller rule.
2. The reviewer's authority is `.claude/agents/reviewer.md` from a freshly fetched `origin/<default>`, through one loader shared with fixer and main-repair; the read-only flags stay as a floor and a widening role file refuses by name; the charter retires.
3. The release books a Delivered plan a shipped changeset's `plan:` line names, names the rest, and skips and names a named plan that is not Delivered. The scope rule moves into the domain.

## Amendments applied

- Threat model table naming the adversary each slice stops and the limits (safety 1, 2).
- The caller slice split into three: the gate, the caller rule, and the passkey approval (layering 1, 2).
- Acceptance criteria for `env -u` and `PLOT_UNATTENDED=0` (safety 3).
- Reviewer floor, widening refusal, charter fate, turn limit per role, fetch before read (layering 5, safety 4, 5, 6, seams 2).
- Finish source, non-Delivered handling, `groupChangesets` and `planReference` reuse, `scopeSlugs` into the domain (layering 4, safety 7, seams 4).
- `waits:` on both #3071 slices for the finish slice (seams 5); #3071's shared-issue test restated (seams 6).
- #3074 named as the fourth editor of `releaseApproveAt` and the `CLAUDE.md` sentence (seams 1); order against #3067's unblocker (seams 3).
- Open Question 1 corrected: `release-approve` had no board route (seams S9).
- A named test file and test per slice, with a WebAuthn fixture assertion; the reviewer's end-to-end proof defined as the process-free `review.test.ts` run (testability 1-5).

## Not adopted

- testability amendment 6 (move to Design before approval): the decisions above settle the approach. Whether the plan enters Design is the reviewer's call at approval.
- safety D3 (a person's review for a change to `.claude/agents/*`): not decided; named as a follow-up in the plan's Notes.
