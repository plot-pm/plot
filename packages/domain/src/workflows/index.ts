/**
 * The lifecycle workflows, each expressed as `readings -> Decision | Refusal`.
 *
 * Every one of them DECIDES AND PERFORMS NOTHING. A `Decision` says *merge
 * PR #42, set Phase: Approved, write this record* and does nothing, which is
 * what makes each testable end to end with no host and no repository — and it
 * is why a production caller repointed at one of these is pointed at something
 * that has already answered the same question about the same estate.
 *
 * `dispatch` is half the work by line count and arrived in its own slice. Its
 * fan-out lives in `dispatch.ts`; the three verbs that run BEFORE the phase
 * gate — stop, restart, migrate — live beside it in `dispatch-verbs.ts`,
 * because each reads one worktree where a fan-out reads a plan and a fleet.
 */
export * from './decision.js';
// The encoding half of the Decision/performer split: how one `Write` becomes
// plan-file text. Exported here because a module the package cannot reach is a
// module nothing can test — this file was written without its export, which is
// why it read as 0% covered rather than as unreachable.
export * from './rendering.js';
export * from './approve.js';
export * from './deliver.js';
export * from './dispatch.js';
export * from './dispatch-verbs.js';
export * from './reap.js';
export * from './implement.js';
export * from './release.js';
