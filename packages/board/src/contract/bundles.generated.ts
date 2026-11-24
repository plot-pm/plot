/**
 * THE BUNDLES `build.mjs` EMITS — GENERATED, NEVER EDITED BY HAND.
 *
 * Written by `packages/board/build.mjs` from its own shipped-bundle
 * declarations, which are what an author writes when adding a bundle. Edit the
 * build; run `pnpm build:board`; this file follows.
 *
 * ## Why this file exists rather than a list in the contract
 *
 * The list was typed out in `contract/schema.ts` and drifted three times in one
 * evening — 9, then 10, then 11 entries against a build emitting one more each
 * time. Every drift surfaced as an UNRELATED branch's CI failing on a bundle it
 * never touched, which is the failure this removes: a bundle added in one PR
 * must not be able to fail another branch's CI.
 *
 * ## Why generated rather than derived at import time
 *
 * The contract is bundled INTO the artifacts it describes, and a bundle must not
 * read the repository to load. `src/server/stuck.ts` and `src/server/resolver.ts`
 * both consume this inside the served bundle, so the value has to be a
 * compile-time constant. Making the contract `import('../../build.mjs')` would
 * drag esbuild's config into the served bundle, which is the one thing this
 * change may not do.
 *
 * ## Why committed rather than ignored
 *
 * `pnpm run typecheck` runs `tsc --noEmit` with no build, and CI runs it BEFORE
 * `build:board`. An ignored file would fail typecheck on a fresh clone. Being
 * committed, its freshness is asserted by
 * `test/reconcile/bundle-attribute-gate.test.mjs`, which compares this file
 * and `build.mjs` as SETS.
 *
 * ## It is a bundle INPUT, not a bundle output
 *
 * So it carries no `-merge` mark. `.gitattributes` marks the twelve `.mjs`
 * artifacts, whose licence is a deterministic rebuild that overwrites whichever
 * side a merge kept. This is TypeScript source holding one sorted array; a
 * conflict here is a real conflict about which bundles exist, and reading it is
 * the correct resolution.
 */
export const BOARD_ARTIFACT_PATHS: readonly string[] = [
  'skills/plot/scripts/board/board-server.mjs',
  'skills/plot/scripts/board/plot-adopt.mjs',
  'skills/plot/scripts/board/plot-agent-settings.mjs',
  'skills/plot/scripts/board/plot-agent-state.mjs',
  'skills/plot/scripts/board/plot-approve-command.mjs',
  'skills/plot/scripts/board/plot-approve.mjs',
  'skills/plot/scripts/board/plot-ask.mjs',
  'skills/plot/scripts/board/plot-bitbucket-mergeable.mjs',
  'skills/plot/scripts/board/plot-bitbucket-slug.mjs',
  'skills/plot/scripts/board/plot-branch-state.mjs',
  'skills/plot/scripts/board/plot-brief-book.mjs',
  'skills/plot/scripts/board/plot-checkout-yield.mjs',
  'skills/plot/scripts/board/plot-ci-reuse.mjs',
  'skills/plot/scripts/board/plot-claim-answer.mjs',
  'skills/plot/scripts/board/plot-continue-command.mjs',
  'skills/plot/scripts/board/plot-deliver-command.mjs',
  'skills/plot/scripts/board/plot-deliver.mjs',
  'skills/plot/scripts/board/plot-delta.mjs',
  'skills/plot/scripts/board/plot-design.mjs',
  'skills/plot/scripts/board/plot-desk-loop.mjs',
  'skills/plot/scripts/board/plot-desk-root.mjs',
  'skills/plot/scripts/board/plot-dispatch-command.mjs',
  'skills/plot/scripts/board/plot-empty-claim.mjs',
  'skills/plot/scripts/board/plot-finding-tickets.mjs',
  'skills/plot/scripts/board/plot-fleet-size.mjs',
  'skills/plot/scripts/board/plot-fleetctl-start.mjs',
  'skills/plot/scripts/board/plot-fleetd.mjs',
  'skills/plot/scripts/board/plot-gate.mjs',
  'skills/plot/scripts/board/plot-given-up.mjs',
  'skills/plot/scripts/board/plot-issue-source.mjs',
  'skills/plot/scripts/board/plot-issue-status.mjs',
  'skills/plot/scripts/board/plot-jenkins-pr-checks.mjs',
  'skills/plot/scripts/board/plot-landed.mjs',
  'skills/plot/scripts/board/plot-listing-pages.mjs',
  'skills/plot/scripts/board/plot-listing-walk.mjs',
  'skills/plot/scripts/board/plot-local-checks.mjs',
  'skills/plot/scripts/board/plot-loose-delete-command.mjs',
  'skills/plot/scripts/board/plot-merge-subject.mjs',
  'skills/plot/scripts/board/plot-movable.mjs',
  'skills/plot/scripts/board/plot-needs-design.mjs',
  'skills/plot/scripts/board/plot-old-label.mjs',
  'skills/plot/scripts/board/plot-panel.mjs',
  'skills/plot/scripts/board/plot-plan-for-branch.mjs',
  'skills/plot/scripts/board/plot-plan-state.mjs',
  'skills/plot/scripts/board/plot-plan-undeliver.mjs',
  'skills/plot/scripts/board/plot-pr-index-lookup.mjs',
  'skills/plot/scripts/board/plot-pr-reader.mjs',
  'skills/plot/scripts/board/plot-pr-state.mjs',
  'skills/plot/scripts/board/plot-prompt-exit.mjs',
  'skills/plot/scripts/board/plot-prompt.mjs',
  'skills/plot/scripts/board/plot-propose-stack.mjs',
  'skills/plot/scripts/board/plot-reap.mjs',
  'skills/plot/scripts/board/plot-reconcile.mjs',
  'skills/plot/scripts/board/plot-record-pr.mjs',
  'skills/plot/scripts/board/plot-record-ref.mjs',
  'skills/plot/scripts/board/plot-release-chain.mjs',
  'skills/plot/scripts/board/plot-release-gate.mjs',
  'skills/plot/scripts/board/plot-released-labels.mjs',
  'skills/plot/scripts/board/plot-restart-command.mjs',
  'skills/plot/scripts/board/plot-restart-stopped-command.mjs',
  'skills/plot/scripts/board/plot-review-bypass.mjs',
  'skills/plot/scripts/board/plot-review.mjs',
  'skills/plot/scripts/board/plot-scan-walk.mjs',
  'skills/plot/scripts/board/plot-slice-chain.mjs',
  'skills/plot/scripts/board/plot-slice-claims.mjs',
  'skills/plot/scripts/board/plot-slice-pr.mjs',
  'skills/plot/scripts/board/plot-slice-spend.mjs',
  'skills/plot/scripts/board/plot-sprint-member.mjs',
  'skills/plot/scripts/board/plot-sprint-release-gate.mjs',
  'skills/plot/scripts/board/plot-sprint-score.mjs',
  'skills/plot/scripts/board/plot-sprint-transition.mjs',
  'skills/plot/scripts/board/plot-standing.mjs',
  'skills/plot/scripts/board/plot-start-command.mjs',
  'skills/plot/scripts/board/plot-state-branch.mjs',
  'skills/plot/scripts/board/plot-state-cut.mjs',
  'skills/plot/scripts/board/plot-state-sync.mjs',
  'skills/plot/scripts/board/plot-story-status.mjs',
  'skills/plot/scripts/board/plot-supersede.mjs',
  'skills/plot/scripts/board/plot-task.mjs',
  'skills/plot/scripts/board/plot-transition.mjs',
  'skills/plot/scripts/board/plot-verdicts.mjs',
  'skills/plot/scripts/board/plot-verify.mjs',
  'skills/plot/scripts/board/plot-worker-loop.mjs',
  'skills/plot/scripts/board/plot-worker-start.mjs',
  'skills/plot/scripts/board/plot-worker-wrapper.mjs',
  'skills/plot/scripts/board/plot-write-probe.mjs',
];

/** One shipped bundle and the source file its esbuild call names as entry, both relative to the repository root. */
export interface BoardBundleEntry {
  readonly entry: string;
  readonly shipped: string;
}

/**
 * The entry source of each shipped bundle that `build.mjs` builds, sorted by
 * the shipped path. A bundle the build only copies has no pair. The CI and
 * local test selection reads it: a changed entry source selects the tests that
 * name its bundle's basename.
 */
export const BOARD_BUNDLE_ENTRIES: readonly BoardBundleEntry[] = [
  { entry: 'packages/board/src/server/index.ts', shipped: 'skills/plot/scripts/board/board-server.mjs' },
  { entry: 'packages/board/src/server/entry/adopt.ts', shipped: 'skills/plot/scripts/board/plot-adopt.mjs' },
  { entry: 'packages/board/src/server/entry/agent-settings.ts', shipped: 'skills/plot/scripts/board/plot-agent-settings.mjs' },
  { entry: 'packages/board/src/server/entry/agent-state.ts', shipped: 'skills/plot/scripts/board/plot-agent-state.mjs' },
  { entry: 'packages/board/src/server/entry/approve-command.ts', shipped: 'skills/plot/scripts/board/plot-approve-command.mjs' },
  { entry: 'packages/board/src/server/entry/approve.ts', shipped: 'skills/plot/scripts/board/plot-approve.mjs' },
  { entry: 'packages/board/src/server/entry/main.ts', shipped: 'skills/plot/scripts/board/plot-ask.mjs' },
  { entry: 'packages/board/src/server/entry/bitbucket-mergeable.ts', shipped: 'skills/plot/scripts/board/plot-bitbucket-mergeable.mjs' },
  { entry: 'packages/board/src/server/entry/bitbucket-slug.ts', shipped: 'skills/plot/scripts/board/plot-bitbucket-slug.mjs' },
  { entry: 'packages/board/src/server/entry/branch-state.ts', shipped: 'skills/plot/scripts/board/plot-branch-state.mjs' },
  { entry: 'packages/board/src/server/entry/brief-book.ts', shipped: 'skills/plot/scripts/board/plot-brief-book.mjs' },
  { entry: 'packages/board/src/server/entry/checkout-yield.ts', shipped: 'skills/plot/scripts/board/plot-checkout-yield.mjs' },
  { entry: 'packages/board/src/server/entry/ci-reuse.ts', shipped: 'skills/plot/scripts/board/plot-ci-reuse.mjs' },
  { entry: 'packages/board/src/server/entry/claim-answer.ts', shipped: 'skills/plot/scripts/board/plot-claim-answer.mjs' },
  { entry: 'packages/board/src/server/entry/deliver-command.ts', shipped: 'skills/plot/scripts/board/plot-deliver-command.mjs' },
  { entry: 'packages/board/src/server/entry/deliver.ts', shipped: 'skills/plot/scripts/board/plot-deliver.mjs' },
  { entry: 'packages/board/src/server/entry/delta.ts', shipped: 'skills/plot/scripts/board/plot-delta.mjs' },
  { entry: 'packages/board/src/server/entry/design.ts', shipped: 'skills/plot/scripts/board/plot-design.mjs' },
  { entry: 'packages/board/src/server/entry/desk-root.ts', shipped: 'skills/plot/scripts/board/plot-desk-root.mjs' },
  { entry: 'packages/board/src/server/entry/empty-claim.ts', shipped: 'skills/plot/scripts/board/plot-empty-claim.mjs' },
  { entry: 'packages/board/src/server/entry/finding-tickets.ts', shipped: 'skills/plot/scripts/board/plot-finding-tickets.mjs' },
  { entry: 'packages/board/src/server/entry/fleetctl-start.ts', shipped: 'skills/plot/scripts/board/plot-fleetctl-start.mjs' },
  { entry: 'packages/board/src/server/entry/gate.ts', shipped: 'skills/plot/scripts/board/plot-gate.mjs' },
  { entry: 'packages/board/src/server/entry/given-up.ts', shipped: 'skills/plot/scripts/board/plot-given-up.mjs' },
  { entry: 'packages/board/src/server/entry/issue-source.ts', shipped: 'skills/plot/scripts/board/plot-issue-source.mjs' },
  { entry: 'packages/board/src/server/entry/issue-status.ts', shipped: 'skills/plot/scripts/board/plot-issue-status.mjs' },
  { entry: 'packages/board/src/server/entry/jenkins-pr-checks.ts', shipped: 'skills/plot/scripts/board/plot-jenkins-pr-checks.mjs' },
  { entry: 'packages/board/src/server/entry/landed.ts', shipped: 'skills/plot/scripts/board/plot-landed.mjs' },
  { entry: 'packages/board/src/server/entry/listing-pages.ts', shipped: 'skills/plot/scripts/board/plot-listing-pages.mjs' },
  { entry: 'packages/board/src/server/entry/listing-walk.ts', shipped: 'skills/plot/scripts/board/plot-listing-walk.mjs' },
  { entry: 'packages/board/src/server/entry/local-checks.ts', shipped: 'skills/plot/scripts/board/plot-local-checks.mjs' },
  { entry: 'packages/board/src/server/entry/merge-subject.ts', shipped: 'skills/plot/scripts/board/plot-merge-subject.mjs' },
  { entry: 'packages/board/src/server/entry/movable.ts', shipped: 'skills/plot/scripts/board/plot-movable.mjs' },
  { entry: 'packages/board/src/server/entry/needs-design.ts', shipped: 'skills/plot/scripts/board/plot-needs-design.mjs' },
  { entry: 'packages/board/src/server/entry/old-label.ts', shipped: 'skills/plot/scripts/board/plot-old-label.mjs' },
  { entry: 'packages/board/src/server/entry/panel.ts', shipped: 'skills/plot/scripts/board/plot-panel.mjs' },
  { entry: 'packages/board/src/server/entry/plan-for-branch.ts', shipped: 'skills/plot/scripts/board/plot-plan-for-branch.mjs' },
  { entry: 'packages/board/src/server/entry/plan-state.ts', shipped: 'skills/plot/scripts/board/plot-plan-state.mjs' },
  { entry: 'packages/board/src/server/entry/plan-undeliver.ts', shipped: 'skills/plot/scripts/board/plot-plan-undeliver.mjs' },
  { entry: 'packages/board/src/server/entry/pr-index-lookup.ts', shipped: 'skills/plot/scripts/board/plot-pr-index-lookup.mjs' },
  { entry: 'packages/board/src/server/entry/pr-state.ts', shipped: 'skills/plot/scripts/board/plot-pr-state.mjs' },
  { entry: 'packages/board/src/server/entry/prompt-exit.ts', shipped: 'skills/plot/scripts/board/plot-prompt-exit.mjs' },
  { entry: 'packages/board/src/server/entry/propose-stack.ts', shipped: 'skills/plot/scripts/board/plot-propose-stack.mjs' },
  { entry: 'packages/board/src/server/entry/reap.ts', shipped: 'skills/plot/scripts/board/plot-reap.mjs' },
  { entry: 'packages/board/src/server/entry/reconcile.ts', shipped: 'skills/plot/scripts/board/plot-reconcile.mjs' },
  { entry: 'packages/board/src/server/entry/record-pr.ts', shipped: 'skills/plot/scripts/board/plot-record-pr.mjs' },
  { entry: 'packages/board/src/server/entry/record-ref.ts', shipped: 'skills/plot/scripts/board/plot-record-ref.mjs' },
  { entry: 'packages/board/src/server/entry/release-chain.ts', shipped: 'skills/plot/scripts/board/plot-release-chain.mjs' },
  { entry: 'packages/board/src/server/entry/release-gate.ts', shipped: 'skills/plot/scripts/board/plot-release-gate.mjs' },
  { entry: 'packages/board/src/server/entry/released-labels.ts', shipped: 'skills/plot/scripts/board/plot-released-labels.mjs' },
  { entry: 'packages/board/src/server/entry/review-bypass.ts', shipped: 'skills/plot/scripts/board/plot-review-bypass.mjs' },
  { entry: 'packages/board/src/server/entry/review.ts', shipped: 'skills/plot/scripts/board/plot-review.mjs' },
  { entry: 'packages/board/src/server/entry/scan-walk.ts', shipped: 'skills/plot/scripts/board/plot-scan-walk.mjs' },
  { entry: 'packages/board/src/server/entry/slice-chain.ts', shipped: 'skills/plot/scripts/board/plot-slice-chain.mjs' },
  { entry: 'packages/board/src/server/entry/slice-claims.ts', shipped: 'skills/plot/scripts/board/plot-slice-claims.mjs' },
  { entry: 'packages/board/src/server/entry/slice-pr.ts', shipped: 'skills/plot/scripts/board/plot-slice-pr.mjs' },
  { entry: 'packages/board/src/server/entry/slice-spend.ts', shipped: 'skills/plot/scripts/board/plot-slice-spend.mjs' },
  { entry: 'packages/board/src/server/entry/sprint-member.ts', shipped: 'skills/plot/scripts/board/plot-sprint-member.mjs' },
  { entry: 'packages/board/src/server/entry/sprint-release-gate.ts', shipped: 'skills/plot/scripts/board/plot-sprint-release-gate.mjs' },
  { entry: 'packages/board/src/server/entry/sprint-score.ts', shipped: 'skills/plot/scripts/board/plot-sprint-score.mjs' },
  { entry: 'packages/board/src/server/entry/sprint-transition.ts', shipped: 'skills/plot/scripts/board/plot-sprint-transition.mjs' },
  { entry: 'packages/board/src/server/entry/standing.ts', shipped: 'skills/plot/scripts/board/plot-standing.mjs' },
  { entry: 'packages/board/src/server/entry/start-command.ts', shipped: 'skills/plot/scripts/board/plot-start-command.mjs' },
  { entry: 'packages/board/src/server/entry/state-branch.ts', shipped: 'skills/plot/scripts/board/plot-state-branch.mjs' },
  { entry: 'packages/board/src/server/entry/state-cut.ts', shipped: 'skills/plot/scripts/board/plot-state-cut.mjs' },
  { entry: 'packages/board/src/server/entry/state-sync.ts', shipped: 'skills/plot/scripts/board/plot-state-sync.mjs' },
  { entry: 'packages/board/src/server/entry/story-status.ts', shipped: 'skills/plot/scripts/board/plot-story-status.mjs' },
  { entry: 'packages/board/src/server/entry/supersede.ts', shipped: 'skills/plot/scripts/board/plot-supersede.mjs' },
  { entry: 'packages/board/src/server/entry/task.ts', shipped: 'skills/plot/scripts/board/plot-task.mjs' },
  { entry: 'packages/board/src/server/entry/transition.ts', shipped: 'skills/plot/scripts/board/plot-transition.mjs' },
  { entry: 'packages/board/src/server/entry/verdicts.ts', shipped: 'skills/plot/scripts/board/plot-verdicts.mjs' },
  { entry: 'packages/board/src/server/entry/verify.ts', shipped: 'skills/plot/scripts/board/plot-verify.mjs' },
  { entry: 'packages/board/src/server/entry/write-probe.ts', shipped: 'skills/plot/scripts/board/plot-write-probe.mjs' },
];
