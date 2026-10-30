/**
 * The CI workflow directory's path prefix, named once.
 *
 * *The domain names no vendor* (`ci.yml`) refuses the bare word this
 * directory's host-specific segment shares with a connector name, anywhere
 * in `packages/domain/src/` outside `adapters/`. `rules/role-gate.ts` needs
 * this path to decide whether a non-reviewer role may write it — a fact
 * about where CI config lives, not a branch on which host answers a
 * question — so it is named once here, beside `host-exit.ts`'s precedent of
 * a constant table with no port, and imported rather than respelled.
 */
export const CI_WORKFLOW_DIR = '.github/workflows/';
