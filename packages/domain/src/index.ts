/**
 * `@plot-pm/domain` — Plot's entities, and nothing that reaches the world.
 *
 * The package boundary is the point. `contract/schema.ts` was already pure —
 * one import, no disk, no process, no network — so a `src/domain/` directory
 * inside the board would satisfy the same grep today. What it would not do is
 * make the dependency direction ENFORCEABLE: a directory can import
 * `../server/fleet.js`, and eventually something will. A package cannot — the
 * module resolver refuses, with no grep to run and no reviewer to notice.
 *
 * That is the difference between a gate and a rule.
 */
export * from './entities/fleet.js';
export * from './port-result.js';
export * from './entities/identity.js';
export * from './entities/person.js';
export * from './entities/machine.js';
export * from './entities/worktree.js';
export * from './entities/pr.js';
export * from './entities/agent.js';
export * from './entities/release.js';
export * from './entities/build.js';
export * from './entities/story.js';
export * from './entities/sprint.js';
export * from './entities/issue.js';
export * from './entities/wave.js';
export * from './rules/deliverable.js';
