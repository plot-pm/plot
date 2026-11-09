## Implementation brief — a-merge-ignores-an-unanswered-human (wave 1: the host reads a PR conversation)

- **Plan (canonical):** `docs/plans/2026-11-09-a-merge-ignores-an-unanswered-human.md` on `main`
- **Approved:** 2026-11-09, Jan Wloka, plan-PR #3328 merged
- **Branch:** `bug/the-host-reads-a-pr-conversation` (base: `main`)
- **Ends as:** one PR to `main`, opened with `plot-open-pr.sh` once the Bitbucket measurement below passes
- **Review of the code:** `plot/review` required on `main`; issue #3327

Wave 2 (`bug/a-merge-refuses-an-unanswered-human-comment`) waits on this branch by wave order. It builds `humanCommentOpen` and the two refusals on top of the reading this slice adds, so nothing in this slice decides anything.

### What to build

On 2026-11-09 at 15:18, #3304 merged through `plot-ask.mjs merge` while Max Albrecht's question from 14:32 ("why not the other way around, everything should be CC-0?") had no answer. `mergeAt` reads the head, the checks, `plot/review` and the default branch, and none of the PR's conversation. This slice adds the read. Wave 2 adds the refusal.

The slice adds one question to the `Host` port and one op to the shell behind it, in the shape `prReview` already has:

- `Host.prConversation(pr: number): Promise<PortResult<PrConversationReading>>` in `packages/domain/src/ports/host.ts`, next to `prReview` (line 447). A GitHub read answers with every issue comment, every inline review comment and every review of the PR. A failed or partial read is a `failed` result, never an empty list. A backend with no verified read answers `unaskable`.
- `plot-host.sh pr-conversation <number>` in `skills/plot/scripts/plot-host.sh`: one JSON document on stdout, exit 3 through `die3` / `gh_fail` when any page fails. The usage header (near line 114) and the `unknown op` list (near line 6062) name the new op.
- `host-shell.ts` maps it the way line 526 maps `pr-review`: `ask(['pr-conversation', String(number)], (stdout) => asJson<…>(stdout))`.
- `host-fixture.ts` gains a `conversations` field keyed by PR number. A number not listed is a failed read, the same convention `reviews` uses (line 69), so a test can prove an unreadable conversation is named.

Each row of the reading carries what wave 2's rule needs and nothing it decides: `kind` (`issue`, `inline` or `review`), `id`, the author's login, the author's account type (`User`, `Bot`, or `''` where the host names none), the time, the body verbatim, and for a review its state (`APPROVED`, `CHANGES_REQUESTED`, `COMMENTED`, `PENDING`, `DISMISSED`). The reading does not filter. An empty review body, a marked comment and a `Bot` comment all come back, because the rule that ignores them is wave 2's and a filter here would hide the row a test needs to see.

The PR's author is not part of this reading. `Pr.author` already exists on the entity `prState` returns, and `mergeAt` already makes that read.

Bitbucket ships in this slice, not later. The Bitbucket arm reads the PR's comments and approvals through `bb` and `_bb_paged_walk` (`plot-host.sh:1173`), and until the measurement below passes it answers `unaskable`.

### The decisions the plan settles — do not re-derive them

**REST only, and no GraphQL call anywhere on the path.** `gh pr view` is GraphQL. Its secondary limit refused three reviews on 2026-11-08 while core stood at 4797 of 5000, which is why `pr-review` is REST-only (the comment above `plot-host.sh:4376`). GraphQL was exhausted again on 2026-11-09. Review threads and their "resolved" flag are readable only through GraphQL, so a resolved thread still counts as open until a reply or an `APPROVED` review follows. Do not add a thread read to recover it.

**All pages, and a failed page is a failed read.** Three endpoints, each `gh api --paginate` with `per_page=100`: `repos/{owner}/{repo}/issues/<n>/comments`, `…/pulls/<n>/comments`, `…/pulls/<n>/reviews`. The pages reach `jq` through stdin or `--slurpfile`, never `--argjson`: argv caps a single argument at 128 KB on Linux (`MAX_ARG_STRLEN`), and a large enough conversation would die there and read as "no comments" on CI while passing on macOS. `set -o pipefail` is on, so the exit code of the pipeline is `gh api`'s own. Absent is not "no comment": a conversation that cannot be read refuses `human-comment-unread` in wave 2, and that refusal only exists if this slice never turns a failure into `[]`. The same invariant the index keeps (*the index never says no*), measured on 2026-08-27 when an empty result read as "no PRs" and refused four fully merged plans.

**The time is `created_at`, and `submitted_at` for a review.** An edit moves `updated_at` and must not reopen or close a question. A review in state `PENDING` has no `submitted_at`; carry it with state `PENDING` and an empty time, and leave the decision to wave 2.

**A deleted account is a row, not a crash.** GitHub returns `"user": null` for a deleted account. `jq` on `.user.login` yields `null`, and a row with a `null` login reaches the domain. Write `// ""` for the login and the type. An empty type is not `User`, and wave 2 treats it as no human.

**The PR index does not supply this.** The index decides only whether to try a merge; a merge cannot be undone, so the conversation is read inside `mergeAt`, next to `prReview`. Nothing in this slice reads or writes `.plot/state/index/`.

**Shell collects and reports; the domain decides** (Manifesto principle 3, and `docs/shell-and-domain.md`). The `jq` in the new op projects fields. It holds no rule about who counts as a person, what a marker is or what answers what. That is wave 2's `humanCommentOpen`, in `packages/domain/src/rules/`.

**The Bitbucket gate, settled by Jan Wloka on 2026-11-09.** The arm reads comments and approvals over Bitbucket's REST API and is measured read-only against `ewz-kus-portal` before this slice opens its PR. Until it passes, the arm answers `unaskable`. Wave 2 never runs while the arm answers `unaskable`, by wave order. Read only: a write there needs Jan's go. The measurement must answer three things this brief does not know, because nobody has measured them: where Bitbucket carries the time of an approval (the PR's `participants` array holds an `approved` flag with no date, and `…/activity` may be where the date lives), whether `user.type` separates a person from an app account, and how `_bb_paged_walk` pages `…/comments`. Record the measured answers in the PR description. Open no PR, draft included, before the measurement passes. Push commits freely.

**Where the Bitbucket fold lives.** `pr-review`'s Bitbucket arm pipes its pages into `node board/plot-jenkins-pr-checks.mjs review` instead of folding in `jq` (`plot-host.sh:4368`), and `rules/bitbucket-pr-reading.ts` is the same pattern for PR states. Follow it for the Bitbucket rows: a fold in the domain, asked through a bundle, adds no shell and carries a test. A new `jq` fold in `plot-host.sh` pays for itself in lines (see Done when).

### Done when

The slice line in the plan and its Design section are the specification; the plan has no separate `## Done when` list. The assertions below exist because a naive implementation would pass without them:

- **A conversation of more than 100 comments returns the one on page 2.** A `gh api` without `--paginate`, or with it dropped on one of the three calls, returns the first page and passes every small fixture. The contract test stubs several pages per endpoint, as `host-pr-review.test.mjs` does with `commentPages`.
- **A failing page exits 3 and prints no rows.** The stub's `failOn` fails page two of each endpoint in turn. An implementation that ends the pipeline in `|| true` or `// []` returns the rows it holds and passes a happy-path test.
- **Any `pr view` or `api graphql` call fails the test.** The stub exits 9 on them, as the `pr-review` stub does, so a GraphQL read cannot pass.
- **A row with `user: null` comes back with empty login and type.** Without it `jq` prints `null` into a string field.
- **A review with an empty body and no inline comments still comes back**, with its state. A filter in the shell would hide it from the rule that should ignore it.
- **An edited comment keeps its `created_at`.** A fixture whose `updated_at` is later than `created_at` proves the time is the first.
- **`host-fixture.ts` answers `failed` for a PR it does not list**, and the `host-shell.test.ts` case maps a failing exit to `failed` and the Bitbucket arm to `unaskable`.
- **Every implementer of `Host` still typechecks.** The port gains a method, so each object that satisfies `Host` needs it: `host-fixture.ts`, `host-shell.ts`, and the test doubles in `packages/board/test/unit/` and `packages/fleet/test/` (`census/stub-host.ts`). Run the domain, board and fleet typechecks, not only the domain's.

Plus the repo's gates. Run `node skills/plot/scripts/board/plot-local-checks.mjs` before each push and run what it prints. The suites in the `CI suites` key run in CI, and a failure there comes back as a correction. Do not run `test:e2e` locally.

`scripts/check-shell-lines.sh` refuses a pull request whose shell under `skills/` is longer than at its merge base. This slice touches `plot-host.sh`, so growth is paid for in the same change: remove shell elsewhere, or write the fold in the domain and ask it through a bundle. The gate counts commands, not lines, so joining statements with `;` or `&&`, or folding `fi` or `done` onto the line before, is not a payment. It stores no number and has no override.

A changeset is required, in the order the versioning section demands: the description first, the `bumps:` block last, package `plot`. The new op is expanded coverage in the `plot` skill. Do not edit versions by hand. A generated bundle under `skills/plot/scripts/board/` must not appear in the diff (`check-no-bundle-diff.sh`); run `pnpm build:board` only to test locally and restore the generated paths before you push.

### Bookkeeping

When the PR is opened, open it with `skills/plot/scripts/plot-open-pr.sh`, never `gh pr create`. Then append `→ #<number>` to this branch's line in the plan's `## Slices` section. Push the first real commit as soon as it exists.

### Scope guard

This branch owns: `packages/domain/src/ports/host.ts`, `packages/domain/src/adapters/host/host-shell.ts`, `packages/domain/src/adapters/host/host-fixture.ts`, the new op in `skills/plot/scripts/plot-host.sh`, a Bitbucket fold if you put one in the domain, the contract test `test/reconcile/host-pr-conversation.test.mjs`, the cases in `packages/domain/test/host-shell.test.ts`, and the one-line additions to test doubles that the port change forces.

It does not own, and must not touch: `packages/domain/src/workflows/merge.ts`, `packages/fleet/src/shared/auto-merge.ts`, `packages/domain/src/workflows/release-approve.ts` and any `humanCommentOpen` rule. Those are wave 2, `bug/a-merge-refuses-an-unanswered-human-comment`, and the only other branch the plan holds. A new function you write is an arrow (`export const f = (…) => …`), and a TSDoc block states what an export does and how it fails without narrating the decision.

If you find something the plan did not anticipate, report it rather than improvising outside scope.
