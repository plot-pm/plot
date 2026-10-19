/**
 * The continuation prompt's filename — a leaf with no sibling imports, so a
 * caller that only needs the name (the loop bundle) does not pull in
 * `continuation.ts`'s `continue-lock.ts`, `manifest-stamp.js`, `registry.js`
 * and the rest of `continueOnDesk`'s own dependencies.
 */
export const CONTINUATION_NAME = '.plot-worker.continue.md';
