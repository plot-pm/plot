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
